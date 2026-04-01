// Rate Limiting 中介軟體

const loginAttempts = new Map()

// 定期清理過期記錄（每 30 分鐘）
setInterval(() => {
  const now = Date.now()
  for (const [key, record] of loginAttempts) {
    if (now - record.firstAttempt > 15 * 60 * 1000) {
      loginAttempts.delete(key)
    }
  }
}, 30 * 60 * 1000)

/**
 * 登入端點的 rate limiter
 * 限制：每個 IP 在 15 分鐘內最多 20 次嘗試
 */
export function loginRateLimit(req, res, next) {
  const key = req.ip || req.socket?.remoteAddress || 'unknown'
  const now = Date.now()
  const windowMs = 15 * 60 * 1000  // 15 分鐘
  const maxAttempts = 20

  let record = loginAttempts.get(key)

  if (!record || (now - record.firstAttempt > windowMs)) {
    record = { count: 0, firstAttempt: now }
  }

  record.count++
  loginAttempts.set(key, record)

  if (record.count > maxAttempts) {
    const retryAfter = Math.ceil((record.firstAttempt + windowMs - now) / 1000)
    res.set('Retry-After', String(retryAfter))
    return res.status(429).json({
      error: true,
      message: '登入嘗試次數過多，請稍後再試',
      retryAfterSeconds: retryAfter,
    })
  }

  next()
}

/**
 * 通用 API rate limiter
 * 限制：每個 IP 在 1 分鐘內最多 100 次 request
 */
const apiAttempts = new Map()

setInterval(() => {
  const now = Date.now()
  for (const [key, record] of apiAttempts) {
    if (now - record.firstAttempt > 60 * 1000) {
      apiAttempts.delete(key)
    }
  }
}, 60 * 1000)

export function apiRateLimit(req, res, next) {
  const key = req.ip || req.socket?.remoteAddress || 'unknown'
  const now = Date.now()
  const windowMs = 60 * 1000
  const maxRequests = 100

  let record = apiAttempts.get(key)

  if (!record || (now - record.firstAttempt > windowMs)) {
    record = { count: 0, firstAttempt: now }
  }

  record.count++
  apiAttempts.set(key, record)

  if (record.count > maxRequests) {
    return res.status(429).json({
      error: true,
      message: 'API 請求過於頻繁，請稍後再試',
    })
  }

  next()
}
