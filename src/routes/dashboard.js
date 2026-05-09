import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'
import { getDatabase } from '../db/init.js'
import { isAdmin, isTokenBlacklisted, logAudit, verifyToken } from '../middleware/auth.js'
import { getDashboardData, normalizeBedKey, formatBedLabel } from '../services/dashboardDataService.js'

const router = Router()
const JWT_SECRET = process.env.JWT_SECRET || 'dialysis-local-secret-key-change-in-production'
const DASHBOARD_TOKEN_EXPIRES_IN = '12h'

function getBearerToken(req) {
  const authHeader = req.headers.authorization || ''
  if (!authHeader.startsWith('Bearer ')) return null
  return authHeader.split(' ')[1]
}

function generateDashboardToken(device) {
  return jwt.sign(
    {
      type: 'bed_dashboard',
      deviceId: device.id,
      bedKey: device.bed_key,
      displayName: device.display_name,
    },
    JWT_SECRET,
    { expiresIn: DASHBOARD_TOKEN_EXPIRES_IN },
  )
}

function verifyDashboardAccess(req, bedKey) {
  const token = getBearerToken(req)
  if (!token) {
    return { ok: false, status: 401, message: '缺少登入憑證' }
  }

  let decoded = null
  try {
    decoded = jwt.verify(token, JWT_SECRET)
  } catch {
    return { ok: false, status: 401, message: '床位儀表板登入已過期，請重新輸入 PIN' }
  }

  if (decoded?.type === 'bed_dashboard') {
    const db = getDatabase()
    const device = db
      .prepare('SELECT * FROM bed_dashboard_devices WHERE id = ? AND is_active = 1')
      .get(decoded.deviceId)

    if (!device) {
      return { ok: false, status: 401, message: '床位裝置未啟用' }
    }

    if (device.bed_key !== bedKey) {
      return { ok: false, status: 403, message: '此裝置無權限查看其他床位' }
    }

    return { ok: true, type: 'bed_dashboard', device }
  }

  if (isTokenBlacklisted(token)) {
    return { ok: false, status: 401, message: '使用者憑證已失效' }
  }

  const user = verifyToken(token)
  if (!user) {
    return { ok: false, status: 401, message: '使用者憑證無效' }
  }

  req.user = user
  req.token = token
  return { ok: true, type: 'staff', user }
}

function mapDevice(row) {
  return {
    id: row.id,
    bedKey: row.bed_key,
    displayName: row.display_name,
    isActive: row.is_active === 1,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

router.post('/bed-login', async (req, res) => {
  try {
    const bedKey = normalizeBedKey(req.body?.bedKey)
    const pin = String(req.body?.pin || '')

    if (!bedKey || !pin) {
      return res.status(400).json({ error: true, message: '請輸入床位與 PIN' })
    }

    const db = getDatabase()
    const device = db
      .prepare('SELECT * FROM bed_dashboard_devices WHERE bed_key = ? AND is_active = 1')
      .get(bedKey)

    if (!device || !device.pin_hash || !bcrypt.compareSync(pin, device.pin_hash)) {
      return res.status(401).json({ error: true, message: '床位或 PIN 不正確' })
    }

    db.prepare(
      `
      UPDATE bed_dashboard_devices
      SET last_login_at = datetime('now', 'localtime'), updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `,
    ).run(device.id)

    res.json({
      token: generateDashboardToken(device),
      expiresIn: DASHBOARD_TOKEN_EXPIRES_IN,
      device: mapDevice({ ...device, last_login_at: new Date().toISOString() }),
    })
  } catch (error) {
    console.error('[Dashboard] bed-login error:', error)
    res.status(500).json({ error: true, message: '床位儀表板登入失敗' })
  }
})

router.get('/bed/:bedKey', (req, res) => {
  try {
    const bedKey = normalizeBedKey(req.params.bedKey)
    if (!bedKey) {
      return res.status(400).json({ error: true, message: '床位格式不正確' })
    }

    const access = verifyDashboardAccess(req, bedKey)
    if (!access.ok) {
      return res.status(access.status).json({ error: true, message: access.message })
    }

    const { date, shift = 'auto' } = req.query
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
      return res.status(400).json({ error: true, message: '日期格式需為 YYYY-MM-DD' })
    }

    const db = getDatabase()
    const data = getDashboardData(db, {
      bedKey,
      date: date ? String(date) : undefined,
      shift: String(shift),
    })

    res.json(data)
  } catch (error) {
    console.error('[Dashboard] get bed data error:', error)
    res.status(500).json({ error: true, message: '讀取床邊儀表板資料失敗' })
  }
})

router.get('/devices', ...isAdmin, (req, res) => {
  try {
    const db = getDatabase()
    const devices = db
      .prepare('SELECT * FROM bed_dashboard_devices ORDER BY bed_key COLLATE NOCASE')
      .all()
      .map(mapDevice)
    res.json(devices)
  } catch (error) {
    console.error('[Dashboard] list devices error:', error)
    res.status(500).json({ error: true, message: '讀取床位裝置設定失敗' })
  }
})

router.put('/devices/:bedKey', ...isAdmin, async (req, res) => {
  try {
    const bedKey = normalizeBedKey(req.params.bedKey)
    const displayName = String(req.body?.displayName || formatBedLabel(bedKey))
    const isActive = req.body?.isActive === undefined ? 1 : req.body.isActive ? 1 : 0
    const pin = req.body?.pin === undefined ? null : String(req.body.pin || '')

    if (!bedKey) {
      return res.status(400).json({ error: true, message: '床位格式不正確' })
    }

    const db = getDatabase()
    const existing = db.prepare('SELECT * FROM bed_dashboard_devices WHERE bed_key = ?').get(bedKey)
    if (!existing && !pin) {
      return res.status(400).json({ error: true, message: '新增床位裝置時必須設定 PIN' })
    }

    const pinHash = pin ? bcrypt.hashSync(pin, 10) : existing?.pin_hash

    if (existing) {
      db.prepare(
        `
        UPDATE bed_dashboard_devices
        SET display_name = ?, pin_hash = ?, is_active = ?, updated_at = datetime('now', 'localtime')
        WHERE bed_key = ?
      `,
      ).run(displayName, pinHash, isActive, bedKey)
    } else {
      db.prepare(
        `
        INSERT INTO bed_dashboard_devices (id, bed_key, display_name, pin_hash, is_active)
        VALUES (?, ?, ?, ?, ?)
      `,
      ).run(uuidv4(), bedKey, displayName, pinHash, isActive)
    }

    const updated = db.prepare('SELECT * FROM bed_dashboard_devices WHERE bed_key = ?').get(bedKey)
    await logAudit('DASHBOARD_DEVICE_UPSERT', req.user.id, req.user.name, 'bed_dashboard_devices', updated.id, {
      bedKey,
      isActive: !!isActive,
      pinChanged: !!pin,
    })

    res.json(mapDevice(updated))
  } catch (error) {
    console.error('[Dashboard] upsert device error:', error)
    res.status(500).json({ error: true, message: '儲存床位裝置設定失敗' })
  }
})

router.delete('/devices/:bedKey', ...isAdmin, async (req, res) => {
  try {
    const bedKey = normalizeBedKey(req.params.bedKey)
    const db = getDatabase()
    const device = db.prepare('SELECT * FROM bed_dashboard_devices WHERE bed_key = ?').get(bedKey)

    if (!device) {
      return res.status(404).json({ error: true, message: '床位裝置不存在' })
    }

    db.prepare(
      `
      UPDATE bed_dashboard_devices
      SET is_active = 0, updated_at = datetime('now', 'localtime')
      WHERE bed_key = ?
    `,
    ).run(bedKey)

    await logAudit('DASHBOARD_DEVICE_DISABLE', req.user.id, req.user.name, 'bed_dashboard_devices', device.id, {
      bedKey,
    })

    res.json({ success: true })
  } catch (error) {
    console.error('[Dashboard] disable device error:', error)
    res.status(500).json({ error: true, message: '停用床位裝置失敗' })
  }
})

export default router
