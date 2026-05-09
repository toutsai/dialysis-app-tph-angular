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
 * 通用 API rate limiter (sliding window)
 * 限制：每個 IP 在最近 60 秒內最多 600 次 request
 *
 * 為什麼要用 sliding window：
 *   舊的 fixed-window 實作只記 firstAttempt + count，越界後計數會持續上累，
 *   要等整個視窗過完才解鎖，導致頁面切換的爆衝會卡上將近一分鐘。
 *   現在改成記每次 request 的時間戳，每次檢查只算最近 60 秒內的數量，
 *   爆衝過後只要稍等就能逐步恢復。
 *
 * 為什麼是 600：醫院內部多台工作站可能透過 NAT 共享同一來源 IP，
 *   再加上前端 10s 通知輪詢 + 30s 任務輪詢 + 切頁時的批次載入，
 *   100/min 太容易被誤判。600/min ≈ 10/sec 仍可阻擋濫用流量。
 */
const apiTimestamps = new Map()
const API_WINDOW_MS = 60 * 1000
const API_MAX_REQUESTS = 600

setInterval(() => {
  const cutoff = Date.now() - API_WINDOW_MS
  for (const [key, timestamps] of apiTimestamps) {
    const trimmed = timestamps.filter((t) => t > cutoff)
    if (trimmed.length === 0) {
      apiTimestamps.delete(key)
    } else if (trimmed.length !== timestamps.length) {
      apiTimestamps.set(key, trimmed)
    }
  }
}, 60 * 1000)

// 本機 loopback 不受限速保護（Electron 桌面版、伺服器自連、健康檢查等都從 127.0.0.1/::1 進來，
// 全部共用同一個 IP 桶會把 600/min 很快耗光，且這類流量本來就不需要外部限速）
const LOOPBACK_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

export function apiRateLimit(req, res, next) {
  const key = req.ip || req.socket?.remoteAddress || 'unknown'

  if (LOOPBACK_IPS.has(key)) {
    return next()
  }

  const now = Date.now()
  const cutoff = now - API_WINDOW_MS

  const existing = apiTimestamps.get(key) || []
  // 丟掉視窗外的舊紀錄
  const recent = existing.length && existing[0] <= cutoff
    ? existing.filter((t) => t > cutoff)
    : existing

  if (recent.length >= API_MAX_REQUESTS) {
    const retryAfter = Math.max(1, Math.ceil((recent[0] + API_WINDOW_MS - now) / 1000))
    res.set('Retry-After', String(retryAfter))
    return res.status(429).json({
      error: true,
      message: 'API 請求過於頻繁，請稍後再試',
      retryAfterSeconds: retryAfter,
    })
  }

  recent.push(now)
  apiTimestamps.set(key, recent)
  next()
}
