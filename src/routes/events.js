// Server-Sent Events 端點：排程例外 (schedule_exceptions) 即時通知
// EventSource 不支援自訂 headers，因此採 ?token=<JWT> query param 驗證
import express from 'express'
import { verifyToken, isTokenBlacklisted } from '../middleware/auth.js'
import { subscribeExceptions } from '../services/eventBus.js'

const router = express.Router()

router.get('/exceptions', (req, res) => {
  const token = req.query.token
  if (!token || typeof token !== 'string') {
    return res.status(401).json({ error: true, message: 'Missing token' })
  }
  const payload = verifyToken(token)
  if (!payload) {
    return res.status(401).json({ error: true, message: 'Invalid token' })
  }
  if (isTokenBlacklisted(token)) {
    return res.status(401).json({ error: true, message: 'Token revoked' })
  }

  // SSE headers
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // 停用 Nginx buffering
  })
  res.flushHeaders?.()

  // 初始 hello，讓前端確認連線成功
  res.write(`event: hello\ndata: ${JSON.stringify({ userId: payload.id })}\n\n`)

  const unsubscribe = subscribeExceptions((msg) => {
    try {
      res.write(`event: exception\ndata: ${JSON.stringify(msg)}\n\n`)
    } catch (err) {
      console.warn('[SSE] write failed, closing:', err.message)
      cleanup()
    }
  })

  // 心跳：每 25 秒送註解行，避免反向代理逾時關閉
  const heartbeat = setInterval(() => {
    try {
      res.write(`: ping ${Date.now()}\n\n`)
    } catch (err) {
      cleanup()
    }
  }, 25000)

  const cleanup = () => {
    clearInterval(heartbeat)
    unsubscribe()
    try {
      res.end()
    } catch {}
  }

  req.on('close', cleanup)
  req.on('aborted', cleanup)
})

export default router
