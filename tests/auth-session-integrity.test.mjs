import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import express from 'express'
import bcrypt from 'bcryptjs'

process.env.NODE_ENV = 'test'
process.env.DB_PATH = ':memory:'
process.env.JWT_SECRET = randomUUID() + randomUUID()
process.env.LOCAL_AUTH_BYPASS = '1'
const { initDatabase, closeDatabase } = await import('../src/db/init.js')
const db = initDatabase()
const auth = await import('../src/middleware/auth.js')
const { subscribeSessionRevocations } = await import('../src/services/sessionEvents.js')
const { emitEvent } = await import('../src/services/eventBus.js')
const notifications = []
const unsubscribe = subscribeSessionRevocations(event => {
  assert.equal(db.inTransaction, false, 'Session invalidation must follow the database commit')
  notifications.push(event)
})
const app = express()
app.use(express.json())
app.use('/auth', (await import('../src/routes/auth.js')).default)
app.use('/events', (await import('../src/routes/events.js')).default)
const server = app.listen(0, '127.0.0.1')
await new Promise(resolve => server.once('listening', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const password = 'synthetic-session-password'
const passwordHash = bcrypt.hashSync(password, 4)
const controllers = []
const request = { headers: { 'user-agent': 'Synthetic session test' }, socket: { remoteAddress: '127.0.0.1' } }

after(async () => {
  controllers.forEach(controller => controller.abort())
  unsubscribe()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  closeDatabase()
})

function newUser() {
  const user = { id: randomUUID(), username: randomUUID(), name: 'Synthetic', role: 'admin', title: '管理員' }
  db.prepare('INSERT INTO users (id, username, password_hash, name, role, title) VALUES (?, ?, ?, ?, ?, ?)')
    .run(user.id, user.username, passwordHash, user.name, user.role, user.title)
  return user
}
async function newSession() {
  const user = newUser()
  const token = auth.generateToken(user)
  await auth.registerSession(user.id, token, request)
  return { user, token }
}
async function api(path, token, body) {
  const response = await fetch(base + '/auth' + path, {
    method: path === '/me' ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    ...(body && { body: JSON.stringify(body) }),
  })
  return { status: response.status, body: await response.json() }
}
function sessionState() {
  return {
    sessions: db.prepare('SELECT * FROM active_sessions ORDER BY user_id').all(),
    blacklist: db.prepare('SELECT * FROM token_blacklist ORDER BY token_hash').all(),
    notifications: [...notifications],
  }
}
async function connect(token) {
  const controller = new AbortController()
  controllers.push(controller)
  const res = await fetch(`${base}/events/exceptions?token=${encodeURIComponent(token)}`, { signal: controller.signal })
  assert.equal(res.status, 200)
  const reader = res.body.getReader()
  assert.match(new TextDecoder().decode((await reader.read()).value), /event: hello/)
  return { reader, controller }
}
async function readStream(reader) {
  let timer
  try {
    return await Promise.race([
      reader.read(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Stream did not respond')), 3000) }),
    ])
  } finally { clearTimeout(timer) }
}

test('two actual logins in the same second issue distinct tokens and only retire the first', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() })
  const user = newUser()
  const first = await api('/login', null, { username: user.username, password })
  const second = await api('/login', null, { username: user.username, password })
  assert.equal(first.status, 200)
  assert.equal(second.status, 200)
  assert.notEqual(second.body.token, first.body.token)
  assert.equal(auth.decodeToken(second.body.token).iat, auth.decodeToken(first.body.token).iat)
  assert.notEqual(auth.decodeToken(second.body.token).jti, auth.decodeToken(first.body.token).jti)
  assert.equal(second.body.previousSessionKicked, true)
  assert.equal((await api('/me', first.body.token)).status, 401)
  assert.equal((await api('/me', second.body.token)).status, 200)
})

test('consecutive immediate refreshes remain usable and record token_refresh revocations', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() })
  const { user, token } = await newSession()
  const first = await api('/refresh-token', token)
  assert.equal(first.status, 200)
  const second = await api('/refresh-token', first.body.token)
  assert.equal(second.status, 200)
  assert.equal(new Set([token, first.body.token, second.body.token]).size, 3)
  for (const oldToken of [token, first.body.token]) {
    assert.equal((await api('/me', oldToken)).status, 401)
    assert.equal(db.prepare('SELECT reason FROM token_blacklist WHERE token_hash = ?').get(auth.hashToken(oldToken)).reason, 'token_refresh')
  }
  assert.equal((await api('/me', second.body.token)).status, 200)
  assert.equal(db.prepare('SELECT token_hash FROM active_sessions WHERE user_id = ?').get(user.id).token_hash, auth.hashToken(second.body.token))
})

test('registration write failure rejects and rolls back the old token blacklist', async () => {
  const { user, token } = await newSession()
  const before = sessionState()
  db.exec("CREATE TEMP TRIGGER fail_session BEFORE INSERT ON active_sessions BEGIN SELECT RAISE(ABORT, 'synthetic session failure'); END")
  try {
    await assert.rejects(auth.registerSession(user.id, auth.generateToken(user), request), /synthetic session failure/)
    assert.deepEqual(sessionState(), before)
    assert.equal((await api('/me', token)).status, 200)
  } finally { db.exec('DROP TRIGGER fail_session') }
})

test('login returns 500 without a token when session persistence fails', async () => {
  for (const previousLogin of [false, true]) {
    const { user } = previousLogin ? await newSession() : { user: newUser() }
    const before = sessionState()
    db.exec("CREATE TEMP TRIGGER fail_session BEFORE INSERT ON active_sessions BEGIN SELECT RAISE(ABORT, 'synthetic session failure'); END")
    try {
      const result = await api('/login', null, { username: user.username, password })
      assert.equal(result.status, 500)
      assert.equal(result.body.error, true)
      assert.equal(result.body.token, undefined)
      assert.deepEqual(sessionState(), before)
    } finally { db.exec('DROP TRIGGER fail_session') }
  }
})

for (const table of ['token_blacklist', 'active_sessions']) {
  test(`refresh failure writing ${table} preserves the previous session and its live stream`, async () => {
    const { token } = await newSession()
    const stream = await connect(token)
    const before = sessionState()
    db.exec(`CREATE TEMP TRIGGER fail_refresh BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'synthetic refresh failure'); END`)
    try {
      const result = await api('/refresh-token', token)
      assert.equal(result.status, 500)
      assert.equal(result.body.token, undefined)
      assert.deepEqual(sessionState(), before)
      assert.equal((await api('/me', token)).status, 200)
      emitEvent('exception', { synthetic: 'old-session-still-active' })
      assert.match(new TextDecoder().decode((await readStream(stream.reader)).value), /old-session-still-active/)
    } finally {
      db.exec('DROP TRIGGER fail_refresh')
      stream.controller.abort()
    }
    const retry = await api('/refresh-token', token)
    assert.equal(retry.status, 200)
    assert.equal((await api('/me', retry.body.token)).status, 200)
  })
}

test('successful refresh closes the old stream and the replacement receives events', async () => {
  const { token } = await newSession()
  const previous = await connect(token)
  const result = await api('/refresh-token', token)
  assert.equal(result.status, 200)
  assert.equal((await readStream(previous.reader)).done, true)
  const current = await connect(result.body.token)
  emitEvent('exception', { synthetic: 'replacement-active' })
  assert.match(new TextDecoder().decode((await readStream(current.reader)).value), /replacement-active/)
  current.controller.abort()
})

test('refresh preserves legacy missing-session behavior while still revoking the supplied token', async () => {
  const user = newUser()
  const token = auth.generateToken(user)
  const result = await api('/refresh-token', token)
  assert.equal(result.status, 200)
  assert.equal((await api('/me', token)).status, 401)
  assert.equal((await api('/me', result.body.token)).status, 200)
  assert.equal(db.prepare('SELECT token_hash FROM active_sessions WHERE user_id = ?').get(user.id).token_hash, auth.hashToken(result.body.token))
})

test('rate limiter housekeeping does not keep a stopped server process alive', () => {
  const moduleUrl = new URL('../src/middleware/rateLimit.js', import.meta.url).href
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(moduleUrl)}); console.log('ready')`], {
    encoding: 'utf8', timeout: 5000, windowsHide: true,
  })
  assert.equal(result.error, undefined)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /ready/)
})
