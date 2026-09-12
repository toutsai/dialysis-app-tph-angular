// Dedicated synthetic server: no dotenv, production database or scheduled jobs.
import assert from 'node:assert/strict'
import { realpathSync } from 'node:fs'
import { dirname, isAbsolute, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { mock } from 'node:test'
import express from 'express'
import bcrypt from 'bcryptjs'

const tempRoot = realpathSync(tmpdir())
const dbDirectory = realpathSync(dirname(process.env.DB_PATH))
const location = relative(tempRoot, dbDirectory)
assert(location && !location.startsWith('..') && !isAbsolute(location))
assert(process.env.NODE_ENV === 'test')
assert(process.env.JWT_SECRET)
assert(process.env.LOCAL_AUTH_BYPASS === '1')
globalThis.fetch = async () => { throw new Error('Outbound requests are disabled in the synthetic test server') }

// Noon in Taipei: exercise the existing frozen-today schedule behavior deterministically.
mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-14T04:00:00Z') })
const { initDatabase, closeDatabase } = await import('../../src/db/init.js')
const db = initDatabase()
const auth = await import('../../src/middleware/auth.js')
const tokens = {}
const passwordHash = bcrypt.hashSync(process.env.TEST_PASSWORD, 4)
for (const role of ['admin', 'editor', 'contributor', 'viewer']) {
  const user = { id: `synthetic-${role}`, username: `synthetic-${role}`, name: `Synthetic ${role}`, role, title: '護理師' }
  db.prepare('INSERT INTO users (id, username, name, password_hash, role, title) VALUES (?, ?, ?, ?, ?, ?)')
    .run(user.id, user.username, user.name, passwordHash, user.role, user.title)
  tokens[role] = auth.generateToken(user)
  await auth.registerSession(user.id, tokens[role], {
    headers: { 'user-agent': 'Synthetic tests' }, socket: { remoteAddress: '127.0.0.1' },
  })
}

const app = express()
app.use(express.json())
app.use('/api', (req, _res, next) => {
  if (req.method === 'PATCH') req.method = 'PUT'
  next()
})
app.use('/api/nursing', (await import('../../src/routes/nursing.js')).default)
app.use('/api/system', (await import('../../src/routes/system.js')).default)
app.use('/api/orders', (await import('../../src/routes/orders.js')).default)
app.use('/api/patients', (await import('../../src/routes/patients.js')).default)
app.use('/api/auth', (await import('../../src/routes/auth.js')).default)
app.use('/api/aki', (await import('../../src/routes/aki.js')).default)
app.use('/api/schedules', (await import('../../src/routes/schedules.js')).default)

const { subscribeEvents } = await import('../../src/services/eventBus.js')
const unsubscribe = subscribeEvents((topic, payload) => process.send?.({ type: 'event', topic, payload }))
const server = app.listen(0, '127.0.0.1', () => {
  process.send?.({ type: 'ready', port: server.address().port, tokens, today: '2026-09-14' })
})
process.on('message', message => {
  if (message?.type === 'shutdown') {
    server.close(() => {
      unsubscribe()
      closeDatabase()
      process.exit(0)
    })
  }
})
