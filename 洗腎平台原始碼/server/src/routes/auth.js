// 認證路由
import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { v4 as uuidv4 } from 'uuid'
import { getDatabase } from '../db/init.js'
import {
  generateToken,
  authenticate,
  isAdmin,
  logAudit,
  registerSession,
  removeSession,
  blacklistToken,
  getClientIp,
} from '../middleware/auth.js'

const router = Router()

// 登入鎖定設定 (B級資安合規)
const LOGIN_LOCKOUT_CONFIG = {
  MAX_ATTEMPTS: 5, // 最大失敗次數
  LOCKOUT_MINUTES: 30, // 鎖定時間 (分鐘)
}

/**
 * 使用 HIS API 驗證員工登入
 * @param {string} userId - 員工編號
 * @param {string} password - 密碼
 * @returns {Promise<boolean>} - 驗證是否成功
 */
async function verifyWithHisApi(userId, password) {
  try {
    // 員工編號格式化為 7 位數字（前面補零）
    const formattedUserId = String(parseInt(userId, 10) || userId).padStart(7, '0')
    const params = new URLSearchParams({
      UserID: formattedUserId,
      Password: password,
    })

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000) // 5 秒超時

    const response = await fetch(
      `http://192.168.24.217:90/HIS_Simple_API/API/CheckEmpLogin?${params}`,
      { signal: controller.signal },
    )
    clearTimeout(timeoutId)

    const text = await response.text()
    console.log(`[HIS API] 驗證結果 (${formattedUserId}): ${text}`)
    return text === 'PASS'
  } catch (error) {
    console.error('[HIS API] 驗證請求失敗:', error.message)
    return false
  }
}

/**
 * 檢查帳號是否被鎖定
 */
function isAccountLocked(user) {
  if (!user.locked_until) return false
  const lockUntil = new Date(user.locked_until)
  return lockUntil > new Date()
}

/**
 * 取得剩餘鎖定時間 (分鐘)
 */
function getRemainingLockMinutes(user) {
  if (!user.locked_until) return 0
  const lockUntil = new Date(user.locked_until)
  const now = new Date()
  const diffMs = lockUntil - now
  return Math.ceil(diffMs / (1000 * 60))
}

/**
 * POST /api/auth/login
 * 使用者登入
 */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body

    if (!username || !password) {
      return res.status(400).json({
        error: true,
        message: '使用者名稱和密碼為必填',
      })
    }

    const db = getDatabase()

    // 查詢使用者 (包含登入嘗試資訊)
    const user = db
      .prepare(
        `
      SELECT * FROM users WHERE username = ? AND is_active = 1
    `,
      )
      .get(username)

    if (!user) {
      db.close()
      await logAudit(
        'LOGIN_FAILED',
        username,
        username,
        'users',
        null,
        { reason: '使用者不存在' },
        false,
      )
      return res.status(401).json({
        error: true,
        message: '使用者名稱或密碼錯誤',
      })
    }

    // 檢查帳號是否被鎖定
    if (isAccountLocked(user)) {
      const remainingMinutes = getRemainingLockMinutes(user)
      db.close()
      await logAudit(
        'LOGIN_BLOCKED',
        user.id,
        user.name,
        'users',
        user.id,
        {
          reason: '帳號已鎖定',
          remainingMinutes,
          lockedUntil: user.locked_until,
        },
        false,
      )
      return res.status(423).json({
        error: true,
        message: `帳號已被鎖定，請於 ${remainingMinutes} 分鐘後再試`,
        locked: true,
        remainingMinutes,
      })
    }

    // 驗證密碼：Admin 使用本地 bcrypt，其他用戶使用 HIS API
    let isValidPassword = false
    if (username === 'admin') {
      // Admin 帳號使用本地 bcrypt 驗證
      isValidPassword = bcrypt.compareSync(password, user.password_hash)
    } else {
      // 其他用戶使用 HIS API 驗證
      isValidPassword = await verifyWithHisApi(username, password)
    }

    if (!isValidPassword) {
      // 增加失敗次數
      const newFailedCount = (user.failed_login_count || 0) + 1

      // 判斷是否要鎖定帳號
      if (newFailedCount >= LOGIN_LOCKOUT_CONFIG.MAX_ATTEMPTS) {
        const lockUntil = new Date()
        lockUntil.setMinutes(lockUntil.getMinutes() + LOGIN_LOCKOUT_CONFIG.LOCKOUT_MINUTES)
        const lockUntilStr = lockUntil.toISOString().slice(0, 19).replace('T', ' ')

        db.prepare(
          `
          UPDATE users
          SET failed_login_count = ?, locked_until = ?, updated_at = datetime('now', 'localtime')
          WHERE id = ?
        `,
        ).run(newFailedCount, lockUntilStr, user.id)

        db.close()
        await logAudit(
          'ACCOUNT_LOCKED',
          user.id,
          user.name,
          'users',
          user.id,
          {
            reason: '登入失敗次數過多',
            failedCount: newFailedCount,
            lockedUntil: lockUntilStr,
          },
          false,
        )

        return res.status(423).json({
          error: true,
          message: `登入失敗次數過多，帳號已被鎖定 ${LOGIN_LOCKOUT_CONFIG.LOCKOUT_MINUTES} 分鐘`,
          locked: true,
          remainingMinutes: LOGIN_LOCKOUT_CONFIG.LOCKOUT_MINUTES,
        })
      } else {
        // 只增加失敗次數
        db.prepare(
          `
          UPDATE users
          SET failed_login_count = ?, updated_at = datetime('now', 'localtime')
          WHERE id = ?
        `,
        ).run(newFailedCount, user.id)

        db.close()
        const remainingAttempts = LOGIN_LOCKOUT_CONFIG.MAX_ATTEMPTS - newFailedCount
        await logAudit(
          'LOGIN_FAILED',
          user.id,
          user.name,
          'users',
          user.id,
          {
            reason: '密碼錯誤',
            failedCount: newFailedCount,
            remainingAttempts,
          },
          false,
        )

        return res.status(401).json({
          error: true,
          message: `使用者名稱或密碼錯誤 (剩餘 ${remainingAttempts} 次嘗試機會)`,
          remainingAttempts,
        })
      }
    }

    // 登入成功：重置失敗次數和鎖定狀態
    db.prepare(
      `
      UPDATE users
      SET last_login = datetime('now', 'localtime'),
          failed_login_count = 0,
          locked_until = NULL,
          updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `,
    ).run(user.id)

    db.close()

    // 產生 JWT Token
    const token = generateToken(user)

    // 註冊 Session（單一裝置限制）
    // 如果有重複登入，會自動將舊 Token 加入黑名單
    const kickedSession = await registerSession(user.id, token, req)

    // 取得客戶端 IP
    const clientIp = getClientIp(req)

    // 記錄稽核日誌（含 IP）
    await logAudit(
      'LOGIN_SUCCESS',
      user.id,
      user.name,
      'users',
      user.id,
      {
        ip: clientIp,
        userAgent: req.headers['user-agent'],
        kickedPreviousSession: !!kickedSession,
      },
      true,
      clientIp,
    )

    // 如果踢掉了舊 session，記錄額外日誌
    if (kickedSession) {
      await logAudit(
        'SESSION_KICKED',
        user.id,
        user.name,
        'users',
        user.id,
        {
          previousIp: kickedSession.ip,
          previousUserAgent: kickedSession.userAgent,
          previousLoginAt: kickedSession.createdAt,
          newIp: clientIp,
        },
        true,
        clientIp,
      )
    }

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        uid: user.id,
        username: user.username,
        name: user.name,
        title: user.title,
        role: user.role,
        email: user.email,
      },
      // 通知前端有其他裝置被登出
      ...(kickedSession && {
        previousSessionKicked: true,
        kickedSessionInfo: {
          ip: kickedSession.ip,
          time: kickedSession.createdAt,
        },
      }),
    })
  } catch (error) {
    console.error('登入錯誤:', error)
    res.status(500).json({
      error: true,
      message: '登入處理失敗',
    })
  }
})

/**
 * POST /api/auth/logout
 * 使用者登出
 */
router.post('/logout', authenticate, async (req, res) => {
  const clientIp = getClientIp(req)

  // 將當前 Token 加入黑名單
  await blacklistToken(req.token, req.user.id, 'logout')

  // 移除 Session 記錄
  removeSession(req.user.id)

  // 記錄稽核日誌
  await logAudit(
    'LOGOUT',
    req.user.id,
    req.user.name,
    'users',
    req.user.id,
    {
      ip: clientIp,
    },
    true,
    clientIp,
  )

  res.json({
    success: true,
    message: '已成功登出',
  })
})

/**
 * GET /api/auth/me
 * 取得當前使用者資訊
 */
router.get('/me', authenticate, (req, res) => {
  const db = getDatabase()

  const user = db
    .prepare(
      `
    SELECT id, username, name, title, role, email, last_login
    FROM users WHERE id = ?
  `,
    )
    .get(req.user.id)

  db.close()

  if (!user) {
    return res.status(404).json({
      error: true,
      message: '使用者不存在',
    })
  }

  res.json({
    id: user.id,
    uid: user.id,
    username: user.username,
    name: user.name,
    title: user.title,
    role: user.role,
    email: user.email,
    lastLogin: user.last_login,
  })
})

/**
 * POST /api/auth/change-password
 * 修改密碼
 */
router.post('/change-password', authenticate, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body

    if (!oldPassword || !newPassword) {
      return res.status(400).json({
        error: true,
        message: '舊密碼和新密碼為必填',
      })
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        error: true,
        message: '新密碼至少需要6個字元',
      })
    }

    const db = getDatabase()

    // 取得目前的密碼雜湊
    const user = db.prepare(`SELECT password_hash FROM users WHERE id = ?`).get(req.user.id)

    if (!user) {
      db.close()
      return res.status(404).json({
        error: true,
        message: '使用者不存在',
      })
    }

    // 驗證舊密碼
    const isValidOldPassword = bcrypt.compareSync(oldPassword, user.password_hash)

    if (!isValidOldPassword) {
      db.close()
      await logAudit(
        'PASSWORD_CHANGE_FAILED',
        req.user.id,
        req.user.name,
        'users',
        req.user.id,
        { reason: '舊密碼錯誤' },
        false,
      )
      return res.status(401).json({
        error: true,
        message: '舊密碼錯誤',
      })
    }

    // 更新密碼
    const newPasswordHash = bcrypt.hashSync(newPassword, 10)

    db.prepare(
      `
      UPDATE users SET password_hash = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `,
    ).run(newPasswordHash, req.user.id)

    db.close()

    await logAudit('PASSWORD_CHANGE_SUCCESS', req.user.id, req.user.name, 'users', req.user.id, {})

    res.json({
      success: true,
      message: '密碼已成功更新',
    })
  } catch (error) {
    console.error('修改密碼錯誤:', error)
    res.status(500).json({
      error: true,
      message: '修改密碼失敗',
    })
  }
})

/**
 * GET /api/auth/users
 * 取得所有使用者列表 (僅管理員)
 */
router.get('/users', ...isAdmin, (req, res) => {
  const db = getDatabase()

  const users = db
    .prepare(
      `
    SELECT id, username, name, title, role, email, is_active, last_login, created_at, updated_at
    FROM users ORDER BY created_at DESC
  `,
    )
    .all()

  // 取得所有醫師資料
  const physicians = db.prepare(`SELECT * FROM physicians`).all()
  const physicianMap = {}
  physicians.forEach((p) => {
    physicianMap[p.id] = p
  })

  db.close()

  // 轉換為 camelCase 格式，並合併醫師資料
  res.json(
    users.map((u) => {
      const result = {
        id: u.id,
        username: u.username,
        name: u.name,
        title: u.title,
        role: u.role,
        email: u.email,
        isActive: u.is_active === 1,
        lastLogin: u.last_login,
        createdAt: u.created_at,
        updatedAt: u.updated_at,
      }

      // 如果是主治醫師，合併 physician 資料
      if (u.title === '主治醫師' && physicianMap[u.id]) {
        const p = physicianMap[u.id]
        result.staffId = p.staff_id
        result.phone = p.phone
        result.clinicHours = JSON.parse(p.clinic_hours || '[]')
        result.defaultSchedules = JSON.parse(p.default_schedules || '[]')
        result.defaultConsultationSchedules = JSON.parse(p.default_consultation_schedules || '[]')
      }

      return result
    }),
  )
})

/**
 * POST /api/auth/users
 * 建立新使用者 (僅管理員)
 */
router.post('/users', ...isAdmin, async (req, res) => {
  try {
    const {
      username,
      password,
      name,
      title,
      role,
      email,
      staffId,
      phone,
      clinicHours,
      defaultSchedules,
      defaultConsultationSchedules,
    } = req.body

    if (!username || !password || !name || !role) {
      return res.status(400).json({
        error: true,
        message: '使用者名稱、密碼、姓名和角色為必填',
      })
    }

    const validRoles = ['admin', 'editor', 'contributor', 'viewer']
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        error: true,
        message: '無效的角色',
      })
    }

    const db = getDatabase()

    // 檢查使用者名稱是否已存在
    const existing = db.prepare(`SELECT id FROM users WHERE username = ?`).get(username)

    if (existing) {
      db.close()
      return res.status(409).json({
        error: true,
        message: '使用者名稱已存在',
      })
    }

    const id = uuidv4()
    const passwordHash = bcrypt.hashSync(password, 10)

    db.prepare(
      `
      INSERT INTO users (id, username, password_hash, name, title, role, email)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(id, username, passwordHash, name, title || '', role, email || null)

    // 如果是主治醫師，同步到 physicians 表
    if (title === '主治醫師') {
      db.prepare(
        `
        INSERT INTO physicians (id, name, specialty, staff_id, phone, clinic_hours, default_schedules, default_consultation_schedules)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          specialty = excluded.specialty,
          staff_id = excluded.staff_id,
          phone = excluded.phone,
          clinic_hours = excluded.clinic_hours,
          default_schedules = excluded.default_schedules,
          default_consultation_schedules = excluded.default_consultation_schedules,
          updated_at = datetime('now', 'localtime')
      `,
      ).run(
        id,
        name,
        title,
        staffId || null,
        phone || null,
        JSON.stringify(clinicHours || []),
        JSON.stringify(defaultSchedules || []),
        JSON.stringify(defaultConsultationSchedules || []),
      )
    }

    db.close()

    await logAudit('USER_CREATE', req.user.id, req.user.name, 'users', id, { username, name, role })

    res.status(201).json({
      success: true,
      id,
      message: '使用者已建立',
    })
  } catch (error) {
    console.error('建立使用者錯誤:', error)
    res.status(500).json({
      error: true,
      message: '建立使用者失敗',
    })
  }
})

/**
 * PUT /api/auth/users/:id
 * 更新使用者 (僅管理員)
 */
router.put('/users/:id', ...isAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const {
      name,
      title,
      role,
      email,
      is_active,
      password,
      staffId,
      phone,
      clinicHours,
      defaultSchedules,
      defaultConsultationSchedules,
    } = req.body

    const db = getDatabase()

    // 檢查使用者是否存在
    const existing = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id)

    if (!existing) {
      db.close()
      return res.status(404).json({
        error: true,
        message: '使用者不存在',
      })
    }

    // 建立更新語句
    const updates = []
    const params = []

    if (name !== undefined) {
      updates.push('name = ?')
      params.push(name)
    }
    if (title !== undefined) {
      updates.push('title = ?')
      params.push(title)
    }
    if (role !== undefined) {
      const validRoles = ['admin', 'editor', 'contributor', 'viewer']
      if (!validRoles.includes(role)) {
        db.close()
        return res.status(400).json({
          error: true,
          message: '無效的角色',
        })
      }
      updates.push('role = ?')
      params.push(role)
    }
    if (email !== undefined) {
      updates.push('email = ?')
      params.push(email)
    }
    if (is_active !== undefined) {
      updates.push('is_active = ?')
      params.push(is_active ? 1 : 0)
    }
    if (password) {
      const passwordHash = bcrypt.hashSync(password, 10)
      updates.push('password_hash = ?')
      params.push(passwordHash)
    }

    // 檢查是否有醫師專屬欄位需要更新
    const hasPhysicianFields =
      staffId !== undefined ||
      phone !== undefined ||
      clinicHours !== undefined ||
      defaultSchedules !== undefined ||
      defaultConsultationSchedules !== undefined

    // 如果沒有 users 表欄位要更新，也沒有醫師欄位，才報錯
    if (updates.length === 0 && !hasPhysicianFields) {
      db.close()
      return res.status(400).json({
        error: true,
        message: '沒有提供要更新的欄位',
      })
    }

    if (updates.length > 0) {
      updates.push("updated_at = datetime('now', 'localtime')")
      params.push(id)
      db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params)
    }

    // 同步醫師資料到 physicians 表
    const finalTitle = title !== undefined ? title : existing.title
    const finalName = name !== undefined ? name : existing.name

    console.log(`[UserUpdate] 使用者 ${id} 職稱: ${finalTitle}`)
    console.log(`[UserUpdate] 收到的醫師欄位:`, {
      staffId,
      phone,
      clinicHours,
      defaultSchedules,
      defaultConsultationSchedules,
    })

    if (finalTitle === '主治醫師') {
      // 先讀取現有的 physician 資料
      const existingPhysician = db.prepare(`SELECT * FROM physicians WHERE id = ?`).get(id)
      console.log(`[UserUpdate] 現有 physician 資料:`, existingPhysician ? '存在' : '不存在')

      // 合併現有資料與新資料（只更新有傳送的欄位）
      const mergedData = {
        staffId: staffId !== undefined ? staffId : existingPhysician?.staff_id || null,
        phone: phone !== undefined ? phone : existingPhysician?.phone || null,
        clinicHours:
          clinicHours !== undefined
            ? clinicHours
            : existingPhysician
              ? JSON.parse(existingPhysician.clinic_hours || '[]')
              : [],
        defaultSchedules:
          defaultSchedules !== undefined
            ? defaultSchedules
            : existingPhysician
              ? JSON.parse(existingPhysician.default_schedules || '[]')
              : [],
        defaultConsultationSchedules:
          defaultConsultationSchedules !== undefined
            ? defaultConsultationSchedules
            : existingPhysician
              ? JSON.parse(existingPhysician.default_consultation_schedules || '[]')
              : [],
      }
      console.log(`[UserUpdate] 合併後的資料:`, mergedData)

      // 新增或更新 physicians 記錄
      db.prepare(
        `
        INSERT INTO physicians (id, name, specialty, staff_id, phone, clinic_hours, default_schedules, default_consultation_schedules)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          specialty = excluded.specialty,
          staff_id = excluded.staff_id,
          phone = excluded.phone,
          clinic_hours = excluded.clinic_hours,
          default_schedules = excluded.default_schedules,
          default_consultation_schedules = excluded.default_consultation_schedules,
          updated_at = datetime('now', 'localtime')
      `,
      ).run(
        id,
        finalName,
        finalTitle,
        mergedData.staffId,
        mergedData.phone,
        JSON.stringify(mergedData.clinicHours),
        JSON.stringify(mergedData.defaultSchedules),
        JSON.stringify(mergedData.defaultConsultationSchedules),
      )
    } else if (existing.title === '主治醫師' && finalTitle !== '主治醫師') {
      // 如果從主治醫師改成其他職稱，設為非啟用
      db.prepare(
        `UPDATE physicians SET is_active = 0, updated_at = datetime('now', 'localtime') WHERE id = ?`,
      ).run(id)
    }

    db.close()

    await logAudit('USER_UPDATE', req.user.id, req.user.name, 'users', id, {
      updates: Object.keys(req.body),
    })

    res.json({
      success: true,
      message: '使用者已更新',
    })
  } catch (error) {
    console.error('更新使用者錯誤:', error)
    res.status(500).json({
      error: true,
      message: '更新使用者失敗',
    })
  }
})

/**
 * POST /api/auth/users/:id/reset-password
 * 重設使用者密碼 (僅管理員)
 */
router.post('/users/:id/reset-password', ...isAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { newPassword } = req.body

    if (!newPassword) {
      return res.status(400).json({
        error: true,
        message: '新密碼為必填',
      })
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        error: true,
        message: '新密碼至少需要6個字元',
      })
    }

    const db = getDatabase()

    // 檢查使用者是否存在
    const existing = db.prepare(`SELECT id, name FROM users WHERE id = ?`).get(id)

    if (!existing) {
      db.close()
      return res.status(404).json({
        error: true,
        message: '使用者不存在',
      })
    }

    // 更新密碼
    const passwordHash = bcrypt.hashSync(newPassword, 10)

    db.prepare(
      `
      UPDATE users SET password_hash = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `,
    ).run(passwordHash, id)

    db.close()

    await logAudit('PASSWORD_RESET_BY_ADMIN', req.user.id, req.user.name, 'users', id, {
      targetUser: existing.name,
    })

    res.json({
      success: true,
      message: '密碼已成功重設',
    })
  } catch (error) {
    console.error('重設密碼錯誤:', error)
    res.status(500).json({
      error: true,
      message: '重設密碼失敗',
    })
  }
})

/**
 * DELETE /api/auth/users/:id
 * 刪除使用者 (僅管理員)
 */
router.delete('/users/:id', ...isAdmin, async (req, res) => {
  try {
    const { id } = req.params

    // 防止刪除自己
    if (id === req.user.id) {
      return res.status(400).json({
        error: true,
        message: '無法刪除自己的帳號',
      })
    }

    const db = getDatabase()

    const result = db.prepare(`DELETE FROM users WHERE id = ?`).run(id)

    db.close()

    if (result.changes === 0) {
      return res.status(404).json({
        error: true,
        message: '使用者不存在',
      })
    }

    await logAudit('USER_DELETE', req.user.id, req.user.name, 'users', id, {})

    res.json({
      success: true,
      message: '使用者已刪除',
    })
  } catch (error) {
    console.error('刪除使用者錯誤:', error)
    res.status(500).json({
      error: true,
      message: '刪除使用者失敗',
    })
  }
})

export default router
