import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import express from 'express'

// These routes use a synthetic singleton only; no dotenv, production data or scheduled jobs.
process.env.DB_PATH = ':memory:'
process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'synthetic-medication-query-only'
process.env.LOCAL_AUTH_BYPASS = '1'
process.env.TZ = 'Asia/Taipei'
const { initDatabase, closeDatabase } = await import('../src/db/init.js')
const db = initDatabase()
const auth = await import('../src/middleware/auth.js')
const tokens = {}
let server, baseUrl

before(async () => {
  for (const role of ['admin', 'editor', 'viewer']) {
    const user = { id: `synthetic-${role}`, username: `synthetic-${role}`, name: role, role, title: '護理師' }
    db.prepare('INSERT INTO users(id, username, password_hash, name, role, title) VALUES(?, ?, ?, ?, ?, ?)')
      .run(user.id, user.username, 'synthetic-never-login', user.name, role, user.title)
    tokens[role] = auth.generateToken(user)
    await auth.registerSession(user.id, tokens[role], { headers: {}, socket: { remoteAddress: '127.0.0.1' } })
  }
  const app = express()
  app.use(express.json())
  app.use('/api', (req, _res, next) => {
    if (req.method === 'PATCH') req.method = 'PUT'
    next()
  })
  app.use('/api/medications', (await import('../src/routes/medications.js')).default)
  app.use('/api/system', (await import('../src/routes/system.js')).default)
  server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance))
  })
  baseUrl = `http://127.0.0.1:${server.address().port}/api`
})

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve))
  closeDatabase()
})

async function api(method, path, body, role = 'editor') {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(role ? { Authorization: `Bearer ${tokens[role]}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: response.status, data: await response.json() }
}

test('partial medication writes preserve omitted fields, explicit clears and editor permissions', async () => {
  const drugs = [{ name: 'Synthetic drug', dose: 'fixture', note: 'keep this value' }]
  const created = await api('POST', '/medications', { patientId: 'synthetic-patient', medications: drugs })
  assert.equal(created.status, 201)
  const id = created.data.id
  const read = () => db.prepare('SELECT medications, status, patient_id FROM medication_orders WHERE id = ?').get(id)

  assert.equal((await api('PATCH', `/medications/${id}`, { status: 'reviewed' })).status, 200)
  assert.deepEqual(JSON.parse(read().medications), drugs, 'a status-only PATCH must retain the drugs')
  assert.equal(read().status, 'reviewed')

  const replacement = [{ name: 'Replacement fixture', note: 'explicit list edit' }]
  assert.equal((await api('PUT', `/medications/${id}`, { medications: replacement })).status, 200)
  assert.deepEqual(JSON.parse(read().medications), replacement)
  assert.equal(read().status, 'reviewed', 'a list-only PUT must retain the status')

  const before = read()
  for (const body of [{ medications: {} }, { medications: null }, { status: [] }, { status: '' }]) {
    const response = await api('PUT', `/medications/${id}`, body)
    assert.equal(response.status, 400)
    assert.equal(response.data.error, true)
    assert.deepEqual(read(), before, 'invalid requests must leave medication values unchanged')
  }
  assert.equal((await api('PUT', `/medications/${id}`, { medications: [] }, 'viewer')).status, 403)
  assert.equal((await api('PUT', `/medications/${id}`, { medications: [] }, null)).status, 401)
  assert.deepEqual(read(), before)
  assert.equal((await api('PUT', '/medications/nonexistent', { status: 'reviewed' })).status, 404)
  assert.equal((await api('PUT', `/medications/${id}`, { medications: [], status: 'completed' })).status, 200)
  assert.deepEqual(JSON.parse(read().medications), [])
  assert.equal(read().status, 'completed')
  assert.equal(read().patient_id, 'synthetic-patient')
  assert.equal((await api('POST', '/medications', { medications: {} })).status, 400)
})

test('daily and monthly injection aliases retain valid results and reject malformed ID/filter inputs', async () => {
  db.prepare('INSERT INTO patients(id, medical_record_number, name) VALUES(?, ?, ?)')
    .run('synthetic-injection-patient', 'SYNTHETIC-INJECTION', 'Synthetic patient')
  db.prepare(`INSERT INTO injection_orders
    (id, patient_id, patient_name, order_code, dose, note, order_type, upload_month)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('synthetic-injection', 'synthetic-injection-patient', 'Synthetic patient', 'INES2', '10', 'QW1', 'injection', '2026-09')
  const body = { targetDate: '2026-09-14', patientIds: ['synthetic-injection-patient'] }
  const primary = await api('POST', '/medications/daily-injections', body, 'viewer')
  assert.equal(primary.status, 200)
  assert.equal(primary.data.length, 1)
  assert.equal(primary.data[0].id, 'synthetic-injection')
  assert.deepEqual(await api('POST', '/medications/injections', body, 'viewer'), primary)
  assert.deepEqual(await api('POST', '/medications/daily-injections', { ...body, patientIds: [...body.patientIds, ...body.patientIds] }), primary)
  assert.deepEqual((await api('POST', '/medications/daily-injections', { targetDate: body.targetDate })).data, [])
  for (const endpoint of ['/medications/daily-injections', '/medications/injections']) {
    for (const patientIds of ['not-an-array', {}, [''], [null], [42], Array(5001).fill('synthetic')]) {
      const response = await api('POST', endpoint, { ...body, patientIds })
      assert.equal(response.status, 400, endpoint)
      assert.equal(response.data.error, true)
    }
    assert.deepEqual((await api('POST', endpoint, { ...body, patientIds: [] })).data, [])
    assert.equal((await api('POST', endpoint, body, null)).status, 401)
  }
  const monthly = { patientIds: body.patientIds, uploadMonth: '2026-09', orderType: 'injection' }
  const byPost = await api('POST', '/medications/injections', monthly)
  assert.equal(byPost.status, 200)
  assert.equal(byPost.data.length, 1)
  const query = '/medications/injections?patientIds=synthetic-injection-patient&uploadMonth=2026-09&orderType=injection'
  assert.deepEqual(await api('GET', query), byPost)
  assert.deepEqual((await api('POST', '/medications/injections', { ...monthly, patientIds: [] })).data, [])
  for (const invalid of [{ patientIds: 'synthetic' }, { uploadMonth: {} }, { uploadMonth: '2026-13' }, { orderType: {} }]) {
    assert.equal((await api('POST', '/medications/injections', { ...monthly, ...invalid })).status, 400)
  }
  for (const query of ['patientIds[]=synthetic', 'patientIds=synthetic,,other', 'uploadMonth[]=2026-09', 'uploadMonth=2026-13', 'orderType[]=injection']) {
    assert.equal((await api('GET', '/medications/injections?' + query)).status, 400, query)
  }
})

test('notification authors are resolved once per unique reference and refreshed on every request', async () => {
  const insert = db.prepare("INSERT INTO notifications(id, title, recipient_id, data, type) VALUES(?, ?, ?, ?, 'info')")
  const references = [
    ...Array(80).fill('synthetic-editor'), ...Array(10).fill('missing-author'),
    { name: 'Embedded name' }, { displayName: 'Legacy display' }, null,
  ]
  for (let i = 0; i < references.length; i++) {
    insert.run(`synthetic-notification-${i}`, 'Synthetic', 'synthetic-editor', JSON.stringify({ createdBy: references[i] }))
  }
  insert.run('private-other-recipient', 'Hidden fixture', 'synthetic-admin', '{}')
  const originalPrepare = db.prepare
  let lookups = 0, prepared = 0
  db.prepare = function (sql) {
    const statement = originalPrepare.call(this, sql)
    if (sql.includes('SELECT name, username FROM users WHERE id = ? OR username = ?')) {
      prepared++
      const originalGet = statement.get.bind(statement)
      statement.get = (...args) => { lookups++; return originalGet(...args) }
    }
    return statement
  }
  try {
    const response = await api('GET', '/system/notifications')
    assert.equal(response.status, 200)
    assert.equal(response.data.length, references.length)
    assert.equal(prepared, 1)
    assert.equal(lookups, 2, '90 legacy notifications require only 2 author lookups, including misses')
    for (const item of response.data) {
      const ref = references[Number(item.id.replace('synthetic-notification-', ''))]
      assert.deepEqual(item.createdBy, ref)
      const expectedName = ref === 'synthetic-editor' ? 'editor' : typeof ref === 'object' && ref ? ref.name || ref.displayName : null
      assert.equal(item.createdByName, expectedName)
    }
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run('Updated editor', 'synthetic-editor')
    const refreshed = await api('GET', '/system/notifications')
    assert.equal(lookups, 4)
    assert.equal(prepared, 2)
    assert.equal(refreshed.data.find(item => item.createdBy === 'synthetic-editor').createdByName, 'Updated editor')
  } finally {
    db.prepare = originalPrepare
  }
})
