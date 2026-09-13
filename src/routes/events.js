// EventSource uses a query token; requestLogger excludes all query strings.
import express from 'express'
import { verifyToken, hashToken, isBedDashboardToken } from '../middleware/auth.js'
import { getDatabase } from '../db/init.js'
import { subscribeEvents } from '../services/eventBus.js'
import { subscribeSessionRevocations } from '../services/sessionEvents.js'

const router = express.Router()
router.get('/exceptions', (req, res) => {
  const token = req.query.token
  const payload = typeof token === 'string' && verifyToken(token)
  if (!payload || !payload.id || !Number.isFinite(payload.exp) || isBedDashboardToken(payload)) {
    return res.status(401).json({ error: true, message: 'Invalid token or token scope' })
  }
  const tokenHash = hashToken(token)
  const isAuthorized = () => {
    if (Date.now() >= payload.exp * 1000) return false
    try {
      const db = getDatabase()
      if (db.prepare('SELECT 1 FROM token_blacklist WHERE token_hash = ?').get(tokenHash)) return false
      const user = db.prepare('SELECT is_active, role, title FROM users WHERE id = ?').get(payload.id)
      if (!user?.is_active || user.role !== payload.role || (user.title || '') !== (payload.title || '')) return false
      const session = db.prepare('SELECT token_hash FROM active_sessions WHERE user_id = ?').get(payload.id)
      return session?.token_hash === tokenHash
    } catch {
      return false // Authorization lookup failures must not release an event.
    }
  }
  if (!isAuthorized()) return res.status(401).json({ error: true, message: 'Session expired or revoked' })

  let closed = false
  let heartbeat
  let expiry
  let unsubscribe = () => {}
  let unsubscribeRevocations = () => {}
  const cleanup = () => {
    if (closed) return
    closed = true
    clearInterval(heartbeat)
    clearTimeout(expiry)
    unsubscribe()
    unsubscribeRevocations()
    req.off('close', cleanup)
    req.off('aborted', cleanup)
    res.off('error', cleanup)
    res.end()
  }
  const send = text => {
    if (closed) return
    if (!isAuthorized()) return cleanup()
    try { res.write(text) } catch { cleanup() }
  }
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.flushHeaders?.()
  unsubscribe = subscribeEvents((topic, msg) => send(`event: ${topic}\ndata: ${JSON.stringify(msg)}\n\n`))
  unsubscribeRevocations = subscribeSessionRevocations(event => {
    if (event.userId === payload.id && (!event.tokenHash || event.tokenHash === tokenHash)) cleanup()
  })
  heartbeat = setInterval(() => send(`: ping ${Date.now()}\n\n`), 25000)
  expiry = setTimeout(cleanup, Math.max(0, Math.min(payload.exp * 1000 - Date.now(), 2147483647)))
  heartbeat.unref?.()
  expiry.unref?.()
  req.on('close', cleanup)
  req.on('aborted', cleanup)
  res.on('error', cleanup)
  send(`event: hello\ndata: ${JSON.stringify({ userId: payload.id })}\n\n`)
})
export default router
