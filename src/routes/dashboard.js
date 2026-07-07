import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'
import { getDatabase } from '../db/init.js'
import { isAdmin, isTokenBlacklisted, logAudit, verifyToken } from '../middleware/auth.js'
import { loginRateLimit } from '../middleware/rateLimit.js'
import { getDashboardData, normalizeBedKey, formatBedLabel } from '../services/dashboardDataService.js'
import {
  buildDashboardPinList,
  deriveDashboardPin,
  isDefaultDashboardBedKey,
  isDerivedDashboardPinValid,
  DASHBOARD_PIN_ROTATION_DAYS,
} from '../services/dashboardPinService.js'

const router = Router()
const JWT_SECRET = process.env.JWT_SECRET || 'dialysis-local-secret-key-change-in-production'
const DASHBOARD_TOKEN_EXPIRES_IN = process.env.DASHBOARD_TOKEN_EXPIRES_IN || '30d'

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

function createDerivedDevice(db, bedKey) {
  const pinInfo = deriveDashboardPin(bedKey)
  const device = {
    id: uuidv4(),
    bed_key: bedKey,
    display_name: formatBedLabel(bedKey),
    pin_hash: bcrypt.hashSync(pinInfo.pin, 10),
    is_active: 1,
    last_login_at: null,
    created_at: null,
    updated_at: null,
  }

  db.prepare(
    `
    INSERT INTO bed_dashboard_devices (id, bed_key, display_name, pin_hash, is_active)
    VALUES (?, ?, ?, ?, 1)
  `,
  ).run(device.id, device.bed_key, device.display_name, device.pin_hash)

  return db.prepare('SELECT * FROM bed_dashboard_devices WHERE id = ?').get(device.id)
}

function isValidDashboardPin(device, bedKey, pin) {
  if (isDerivedDashboardPinValid(bedKey, pin)) return true
  return !!device?.pin_hash && bcrypt.compareSync(String(pin || ''), device.pin_hash)
}

// PIN 暴力破解防護（比照 auth.js 帳號鎖定；PIN 僅 4-6 碼，必須雙層防護：IP 限速 + 裝置鎖定）
const BED_LOGIN_LOCKOUT = {
  MAX_ATTEMPTS: 5,
  LOCKOUT_MINUTES: 30,
}

// 一律存本地時間字串（'YYYY-MM-DD HH:MM:SS'），與讀取端 new Date() 的本地解析一致
function localDateTimeString(msFromNow = 0) {
  return new Date(Date.now() + msFromNow).toLocaleString('sv-SE')
}

function isDeviceLocked(device) {
  if (!device?.locked_until) return false
  return new Date(device.locked_until) > new Date()
}

router.post('/bed-login', loginRateLimit, async (req, res) => {
  try {
    const bedKey = normalizeBedKey(req.body?.bedKey)
    const pin = String(req.body?.pin || '')

    if (!bedKey || !pin) {
      return res.status(400).json({ error: true, message: '請輸入床位與 PIN' })
    }

    const db = getDatabase()
    let device = db
      .prepare('SELECT * FROM bed_dashboard_devices WHERE bed_key = ?')
      .get(bedKey)

    if (device && device.is_active !== 1) {
      return res.status(401).json({ error: true, message: '床位裝置未啟用' })
    }

    if (isDeviceLocked(device)) {
      const remainingMinutes = Math.max(1, Math.ceil((new Date(device.locked_until) - new Date()) / 60000))
      return res.status(423).json({
        error: true,
        message: `PIN 錯誤次數過多，此床位已被鎖定，請於 ${remainingMinutes} 分鐘後再試`,
        locked: true,
        remainingMinutes,
      })
    }

    if (!device && isDefaultDashboardBedKey(bedKey) && isDerivedDashboardPinValid(bedKey, pin)) {
      device = createDerivedDevice(db, bedKey)
    }

    if (!device || !isValidDashboardPin(device, bedKey, pin)) {
      if (device) {
        const newFailedCount = (device.failed_login_count || 0) + 1
        if (newFailedCount >= BED_LOGIN_LOCKOUT.MAX_ATTEMPTS) {
          const lockUntilStr = localDateTimeString(BED_LOGIN_LOCKOUT.LOCKOUT_MINUTES * 60000)
          db.prepare(
            `UPDATE bed_dashboard_devices
             SET failed_login_count = ?, locked_until = ?, updated_at = datetime('now', 'localtime')
             WHERE id = ?`,
          ).run(newFailedCount, lockUntilStr, device.id)
          logAudit(
            'BED_DASHBOARD_LOCKED',
            device.id,
            device.display_name,
            'bed_dashboard_devices',
            device.id,
            { reason: 'PIN 錯誤次數過多', failedCount: newFailedCount, lockedUntil: lockUntilStr },
            false,
          )
          return res.status(423).json({
            error: true,
            message: `PIN 錯誤次數過多，此床位已被鎖定 ${BED_LOGIN_LOCKOUT.LOCKOUT_MINUTES} 分鐘`,
            locked: true,
            remainingMinutes: BED_LOGIN_LOCKOUT.LOCKOUT_MINUTES,
          })
        }
        db.prepare(
          `UPDATE bed_dashboard_devices
           SET failed_login_count = ?, updated_at = datetime('now', 'localtime')
           WHERE id = ?`,
        ).run(newFailedCount, device.id)
      }
      return res.status(401).json({ error: true, message: '床位或 PIN 不正確' })
    }

    db.prepare(
      `
      UPDATE bed_dashboard_devices
      SET last_login_at = datetime('now', 'localtime'), updated_at = datetime('now', 'localtime'),
          failed_login_count = 0, locked_until = NULL
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

router.get('/pins', ...isAdmin, (req, res) => {
  try {
    const db = getDatabase()
    const devices = db
      .prepare('SELECT * FROM bed_dashboard_devices ORDER BY bed_key COLLATE NOCASE')
      .all()
    const pins = buildDashboardPinList(devices)

    res.json({
      generatedAt: new Date().toISOString(),
      rotationDays: DASHBOARD_PIN_ROTATION_DAYS,
      pins,
    })
  } catch (error) {
    console.error('[Dashboard] list pins error:', error)
    res.status(500).json({ error: true, message: '讀取床位 PIN 失敗' })
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
