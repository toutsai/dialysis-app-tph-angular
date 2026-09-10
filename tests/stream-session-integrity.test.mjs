import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { randomUUID } from 'node:crypto'
import express from 'express'
import jwt from 'jsonwebtoken'

process.env.NODE_ENV = 'test'
process.env.DB_PATH = ':memory:'
process.env.JWT_SECRET = randomUUID() + randomUUID()
const { initDatabase, closeDatabase } = await import('../src/db/init.js')
const db = initDatabase()
const auth = await import('../src/middleware/auth.js')
const { emitEvent } = await import('../src/services/eventBus.js')
const { createRequestLogger } = await import('../src/middleware/requestLogger.js')
const logs = []
const app = express()
app.use(createRequestLogger({ stream: { write: text => logs.push(text) } }))
app.use('/api/events', (await import('../src/routes/events.js')).default)
app.get('/api/secure', auth.authenticate, (_req, res) => res.json({ ok: true }))
const server = app.listen(0, '127.0.0.1')
await new Promise(resolve => server.once('listening', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const controllers = []
after(async () => {
  controllers.forEach(controller => controller.abort())
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  closeDatabase()
})

async function newSession(user, expiresIn = '1h') {
  user ||= { id: randomUUID(), username: randomUUID(), role: 'admin', title: '管理員', name: 'Synthetic' }
  db.prepare('INSERT OR IGNORE INTO users (id, username, password_hash, name, role, title) VALUES (?, ?, ?, ?, ?, ?)')
    .run(user.id, user.username, 'unused', user.name, user.role, user.title)
  const token = jwt.sign({ ...user, nonce: randomUUID() }, process.env.JWT_SECRET, { expiresIn })
  await auth.registerSession(user.id, token, { headers: { 'user-agent': 'Synthetic' }, socket: { remoteAddress: '127.0.0.1' } })
  return { user, token }
}
async function connect(token) {
  const controller = new AbortController()
  controllers.push(controller)
  const res = await fetch(`${base}/api/events/exceptions?token=${encodeURIComponent(token)}`, { signal: controller.signal })
  assert.equal(res.status, 200)
  const reader = res.body.getReader()
  assert.match(new TextDecoder().decode((await reader.read()).value), /event: hello/)
  return { reader, controller }
}
async function assertClosed(reader) {
  let timer
  try {
    const result = await Promise.race([reader.read(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Revoked stream stayed open')), 3000) })])
    assert.equal(result.done, true, 'No patient event may follow revocation')
  } finally { clearTimeout(timer) }
}

test('valid session receives events; logout immediately closes it and API rejects token', async () => {
  const { user, token } = await newSession()
  const { reader } = await connect(token)
  emitEvent('exception', { synthetic: 'before-revocation' })
  assert.match(new TextDecoder().decode((await reader.read()).value), /before-revocation/)
  await auth.blacklistToken(token, user.id)
  emitEvent('exception', { synthetic: 'must-not-arrive' })
  await assertClosed(reader)
  const api = await fetch(base + '/api/secure', { headers: { Authorization: `Bearer ${token}` } })
  assert.equal(api.status, 401)
  await api.arrayBuffer()
})

test('duplicate login closes only old session; new session receives events', async () => {
  const old = await newSession()
  const prior = await connect(old.token)
  const current = await newSession(old.user)
  await assertClosed(prior.reader)
  const next = await connect(current.token)
  emitEvent('exception', { synthetic: 'new-session' })
  assert.match(new TextDecoder().decode((await next.reader.read()).value), /new-session/)
  next.controller.abort()
})

test('administrative revocation and session removal immediately close streams', async () => {
  for (const revoke of [id => auth.revokeUserSessions(id), id => auth.removeSession(id)]) {
    const { user, token } = await newSession()
    const { reader } = await connect(token)
    revoke(user.id)
    await assertClosed(reader)
  }
})

test('account disable, role/title change, and missing session are checked before every event', async () => {
  for (const change of [
    id => db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(id),
    id => db.prepare("UPDATE users SET role = 'viewer' WHERE id = ?").run(id),
    id => db.prepare("UPDATE users SET title = 'changed' WHERE id = ?").run(id),
    id => db.prepare('DELETE FROM active_sessions WHERE user_id = ?').run(id),
  ]) {
    const { user, token } = await newSession()
    const { reader } = await connect(token)
    change(user.id)
    emitEvent('exception', { synthetic: 'must-not-arrive' })
    await assertClosed(reader)
  }
})

test('expiry closes a connection without waiting for the next event or heartbeat', async () => {
  const { token } = await newSession(undefined, '2s')
  const { reader } = await connect(token)
  await assertClosed(reader)
})

test('invalid and bed dashboard tokens cannot subscribe; real request logs omit entire query', async () => {
  const bedToken = jwt.sign({ type: 'bed_dashboard', id: 'bed', role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' })
  for (const token of ['sensitive-test-token', bedToken]) {
    const res = await fetch(`${base}/api/events/exceptions?token=${token}&search=private-synthetic-name`)
    assert.equal(res.status, 401)
    await res.arrayBuffer()
  }
  await new Promise(resolve => setImmediate(resolve))
  assert(logs.some(line => line.includes('/api/events/exceptions')))
  assert(logs.every(line => !line.includes('?') && !line.includes('private-synthetic-name') && !line.includes('sensitive-test-token') && !line.includes(bedToken)))
})
