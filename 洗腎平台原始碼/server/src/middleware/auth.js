// 認證中介軟體
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { getDatabase } from '../db/init.js'

// ========================================
// JWT 配置
// ========================================

// JWT 密鑰 - 生產環境必須設定環境變數
const JWT_SECRET = process.env.JWT_SECRET || 'dialysis-local-secret-key-change-in-production'
const JWT_EXPIRES_IN = '24h'

// 檢查是否在生產環境使用預設密鑰
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  console.error('❌ 嚴重錯誤：生產環境必須設定 JWT_SECRET 環境變數')
  process.exit(1)
}

// ========================================
// Token 工具函式
// ========================================

/**
 * 計算 Token 的 Hash 值（用於黑名單和 session 追蹤）
 */
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/**
 * 產生 JWT Token
 */
export function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      uid: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      title: user.title,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN },
  )
}

/**
 * 驗證 JWT Token
 */
export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET)
  } catch (error) {
    return null
  }
}

/**
 * 解碼 JWT Token（不驗證）
 */
export function decodeToken(token) {
  try {
    return jwt.decode(token)
  } catch (error) {
    return null
  }
}

// ========================================
// Token 黑名單機制
// ========================================

/**
 * 將 Token 加入黑名單
 * @param {string} token - JWT Token
 * @param {string} userId - 使用者 ID
 * @param {string} reason - 原因 ('logout', 'duplicate_login', 'admin_revoke')
 */
export async function blacklistToken(token, userId, reason = 'logout') {
  try {
    const db = getDatabase()
    const tokenHash = hashToken(token)
    const decoded = decodeToken(token)

    if (!decoded || !decoded.exp) {
      db.close()
      return false
    }

    // Token 過期時間
    const expiresAt = new Date(decoded.exp * 1000).toISOString()

    db.prepare(
      `
      INSERT OR REPLACE INTO token_blacklist (token_hash, user_id, reason, expires_at, created_at)
      VALUES (?, ?, ?, ?, datetime('now', 'localtime'))
    `,
    ).run(tokenHash, userId, reason, expiresAt)

    db.close()
    return true
  } catch (error) {
    console.error('加入黑名單失敗:', error)
    return false
  }
}

/**
 * 檢查 Token 是否在黑名單中
 */
export function isTokenBlacklisted(token) {
  try {
    const db = getDatabase()
    const tokenHash = hashToken(token)

    const result = db
      .prepare(
        `
      SELECT 1 FROM token_blacklist WHERE token_hash = ?
    `,
      )
      .get(tokenHash)

    db.close()
    return !!result
  } catch (error) {
    console.error('檢查黑名單失敗:', error)
    return false
  }
}

/**
 * 清理過期的黑名單記錄（定時任務呼叫）
 */
export function cleanupExpiredBlacklist() {
  try {
    const db = getDatabase()

    const result = db
      .prepare(
        `
      DELETE FROM token_blacklist 
      WHERE expires_at < datetime('now', 'localtime')
    `,
      )
      .run()

    if (result.changes > 0) {
      console.log(`🧹 已清理 ${result.changes} 筆過期的黑名單記錄`)
    }

    db.close()
  } catch (error) {
    console.error('清理黑名單失敗:', error)
  }
}

// ========================================
// 單一裝置登入 Session 管理
// ========================================

/**
 * 註冊新的 Session（會自動使前一個 Session 失效）
 * @param {string} userId - 使用者 ID
 * @param {string} token - 新的 JWT Token
 * @param {object} req - Express request 物件（用於取得 IP 和 User-Agent）
 * @returns {object|null} - 被踢下線的舊 session 資訊，如無則返回 null
 */
export async function registerSession(userId, token, req) {
  const { v4: uuidv4 } = await import('uuid')

  try {
    const db = getDatabase()
    const tokenHash = hashToken(token)
    const decoded = decodeToken(token)

    if (!decoded || !decoded.exp) {
      db.close()
      return null
    }

    const expiresAt = new Date(decoded.exp * 1000).toISOString()
    const ipAddress = getClientIp(req)
    const userAgent = req.headers['user-agent'] || 'unknown'

    // 檢查是否有既存的 session
    const existingSession = db
      .prepare(
        `
      SELECT * FROM active_sessions WHERE user_id = ?
    `,
      )
      .get(userId)

    let kickedSession = null

    if (existingSession) {
      // 將舊 Token 加入黑名單
      const oldToken = existingSession.token_hash
      const oldExpiresAt = existingSession.expires_at

      db.prepare(
        `
        INSERT OR REPLACE INTO token_blacklist (token_hash, user_id, reason, expires_at, created_at)
        VALUES (?, ?, 'duplicate_login', ?, datetime('now', 'localtime'))
      `,
      ).run(oldToken, userId, oldExpiresAt)

      kickedSession = {
        ip: existingSession.ip_address,
        userAgent: existingSession.user_agent,
        createdAt: existingSession.created_at,
      }

      console.log(`⚠️ 使用者 ${userId} 重複登入，已將舊 session 加入黑名單`)
    }

    // 建立/更新 session（使用 REPLACE 確保每個 user_id 只有一筆）
    db.prepare(
      `
      INSERT OR REPLACE INTO active_sessions (id, user_id, token_hash, ip_address, user_agent, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
    `,
    ).run(uuidv4(), userId, tokenHash, ipAddress, userAgent, expiresAt)

    db.close()
    return kickedSession
  } catch (error) {
    console.error('註冊 session 失敗:', error)
    return null
  }
}

/**
 * 移除 Session（登出時呼叫）
 */
export function removeSession(userId) {
  try {
    const db = getDatabase()

    db.prepare(
      `
      DELETE FROM active_sessions WHERE user_id = ?
    `,
    ).run(userId)

    db.close()
  } catch (error) {
    console.error('移除 session 失敗:', error)
  }
}

/**
 * 清理過期的 Session 記錄
 */
export function cleanupExpiredSessions() {
  try {
    const db = getDatabase()

    const result = db
      .prepare(
        `
      DELETE FROM active_sessions 
      WHERE expires_at < datetime('now', 'localtime')
    `,
      )
      .run()

    if (result.changes > 0) {
      console.log(`🧹 已清理 ${result.changes} 筆過期的 session 記錄`)
    }

    db.close()
  } catch (error) {
    console.error('清理 session 失敗:', error)
  }
}

// ========================================
// IP 地址工具
// ========================================

/**
 * 從 request 取得客戶端真實 IP
 */
export function getClientIp(req) {
  // 考慮反向代理情況
  const forwarded = req.headers['x-forwarded-for']
  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }
  return req.socket?.remoteAddress || req.ip || 'unknown'
}

// ========================================
// 認證中介軟體
// ========================================

/**
 * 認證中介軟體 - 驗證使用者是否已登入
 */
export function authenticate(req, res, next) {
  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: true,
      message: '未提供認證令牌',
    })
  }

  const token = authHeader.split(' ')[1]

  // 檢查 Token 是否在黑名單中
  if (isTokenBlacklisted(token)) {
    return res.status(401).json({
      error: true,
      message: '此認證令牌已失效，請重新登入',
      code: 'TOKEN_BLACKLISTED',
    })
  }

  const decoded = verifyToken(token)

  if (!decoded) {
    return res.status(401).json({
      error: true,
      message: '無效或過期的認證令牌',
    })
  }

  // 將使用者資訊和 Token 附加到請求物件
  req.user = decoded
  req.token = token
  next()
}

// ========================================
// 角色權限
// ========================================

/**
 * 角色權限層級
 */
const roleHierarchy = {
  viewer: 1,
  contributor: 2,
  editor: 3,
  admin: 4,
}

/**
 * 檢查使用者是否有足夠權限
 */
export function hasPermission(userRole, requiredRole) {
  const userLevel = roleHierarchy[userRole] || 0
  const requiredLevel = roleHierarchy[requiredRole] || 999
  return userLevel >= requiredLevel
}

/**
 * 權限檢查中介軟體工廠
 * @param {string} requiredRole - 所需的最低權限角色
 */
export function requireRole(requiredRole) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: true,
        message: '請先登入',
      })
    }

    if (!hasPermission(req.user.role, requiredRole)) {
      return res.status(403).json({
        error: true,
        message: '權限不足',
      })
    }

    next()
  }
}

/**
 * 便捷的權限中介軟體
 */
export const isViewer = [authenticate]
export const isContributor = [authenticate, requireRole('contributor')]
export const isEditor = [authenticate, requireRole('editor')]
export const isAdmin = [authenticate, requireRole('admin')]

// ========================================
// 稽核日誌
// ========================================

/**
 * 記錄稽核日誌（含 IP 地址）
 * @param {string} action - 操作類型
 * @param {string} userId - 使用者 ID
 * @param {string} userName - 使用者名稱
 * @param {string} collection - 資料集合名稱
 * @param {string} documentId - 文件 ID
 * @param {object} details - 詳細資訊
 * @param {boolean} success - 是否成功
 * @param {string} ipAddress - IP 地址（可選）
 */
export async function logAudit(
  action,
  userId,
  userName,
  collection,
  documentId,
  details = {},
  success = true,
  ipAddress = null,
) {
  try {
    const db = getDatabase()
    const { v4: uuidv4 } = await import('uuid')

    db.prepare(
      `
      INSERT INTO audit_logs (id, action, user_id, user_name, collection_name, document_id, details, ip_address, success, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
    `,
    ).run(
      uuidv4(),
      action,
      userId,
      userName,
      collection,
      documentId,
      JSON.stringify(details),
      ipAddress,
      success ? 1 : 0,
    )

    db.close()
  } catch (error) {
    console.error('稽核日誌記錄失敗:', error)
  }
}

/**
 * 記錄稽核日誌（從 request 自動取得 IP）
 */
export async function logAuditWithRequest(
  req,
  action,
  collection,
  documentId,
  details = {},
  success = true,
) {
  const ipAddress = getClientIp(req)
  await logAudit(
    action,
    req.user?.id,
    req.user?.name,
    collection,
    documentId,
    details,
    success,
    ipAddress,
  )
}
