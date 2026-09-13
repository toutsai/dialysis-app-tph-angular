import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const password = randomBytes(24).toString('base64url')
let folder, db, server, baseUrl, tokens, today
let serverOutput = ''
const events = []

before(async () => {
  folder = mkdtempSync(join(tmpdir(), 'dialysis-integrity-'))
  const dbPath = join(folder, 'synthetic.db')
  db = new Database(dbPath)
  db.exec(readFileSync(join(root, 'src/db/schema.sql'), 'utf8'))
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 5000')
  server = fork(join(root, 'tests/helpers/backend-test-server.mjs'), [], {
    execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, NODE_ENV: 'test', DB_PATH: dbPath, LOCAL_AUTH_BYPASS: '1', JWT_SECRET: randomBytes(48).toString('hex'), TEST_PASSWORD: password },
  })
  server.stdout.on('data', data => { serverOutput += data.toString() })
  server.stderr.on('data', data => { serverOutput += data.toString() })
  const ready = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Test server did not start:\n${serverOutput}`)), 30_000)
    server.on('message', message => {
      if (message.type === 'event') events.push(message)
      if (message.type === 'ready') { clearTimeout(timeout); resolve(message) }
    })
    server.once('error', reject)
    server.once('exit', code => { clearTimeout(timeout); reject(new Error(`Test server exited ${code}:\n${serverOutput}`)) })
  })
  tokens = ready.tokens
  today = ready.today
  baseUrl = `http://127.0.0.1:${ready.port}`
})

after(async () => {
  if (server && server.exitCode === null) {
    await new Promise(resolve => {
      const timeout = setTimeout(() => server.kill(), 5_000)
      server.once('exit', () => { clearTimeout(timeout); resolve() })
      server.send({ type: 'shutdown' })
    })
  }
  db?.close()
  if (folder) {
    const location = relative(tmpdir(), folder)
    assert(location && !location.startsWith('..') && !isAbsolute(location))
    rmSync(folder, { recursive: true, force: true })
  }
})

async function api(method, path, body, token = tokens.admin) {
  const response = await fetch(`${baseUrl}${path}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: response.status, data: await response.json() }
}

function patient(orders = {}, isDeleted = false) {
  const id = randomUUID()
  db.prepare('INSERT INTO patients (id, medical_record_number, name, status, dialysis_orders, is_deleted, ward_number, physician) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, `SYN-${id}`, 'Synthetic Patient', 'ipd', JSON.stringify({ mode: 'HD', freq: '一三五', ...orders }), Number(isDeleted), 'SYN-101', 'Synthetic Physician')
  return id
}

const current = id => JSON.parse(db.prepare('SELECT dialysis_orders FROM patients WHERE id = ?').get(id).dialysis_orders)
const histories = id => db.prepare('SELECT * FROM dialysis_orders_history WHERE patient_id = ?').all(id)
const count = table => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n
const saveOrder = (id, orders, token) => api('POST', '/api/orders/history', { patientId: id, operationType: 'UPDATE', orders }, token)

// Reject checks compare all potentially affected tables, including history, logs, and audit.
function databaseSnapshot() {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  return JSON.stringify(tables.map(({ name }) => [name, db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`).all()]))
}

test('one order save preserves omitted metadata and stores the complete merged history', async () => {
  const metadata = { memo: 'Synthetic memo', crrtOrders: { flow: 100 }, firstDialysisPlan: { regularRule: { freq: '一三五' } } }
  const id = patient(metadata)
  const result = await saveOrder(id, { bloodFlow: 250 })
  assert.equal(result.status, 201)
  assert.deepEqual(current(id), { mode: 'HD', freq: '一三五', ...metadata, bloodFlow: 250 })
  assert.deepEqual(JSON.parse(histories(id)[0].orders), current(id))
  assert.deepEqual(result.data.orders, current(id))
  assert.equal(count('patient_history'), 0, 'ordinary field changes do not add patient movements')
})

test('explicit empty and null values clear metadata in current orders and history', async () => {
  const id = patient({ memo: 'Synthetic', crrtOrders: { flow: 100 }, firstDialysisPlan: { first: true } })
  assert.equal((await saveOrder(id, { memo: '', crrtOrders: null, firstDialysisPlan: {} })).status, 201)
  assert.equal(current(id).memo, '')
  assert.equal(current(id).crrtOrders, null)
  assert.deepEqual(current(id).firstDialysisPlan, {})
  assert.deepEqual(JSON.parse(histories(id)[0].orders), current(id))
})

test('legacy two-request clients retain metadata in either successful request order', async () => {
  for (const historyFirst of [true, false]) {
    const metadata = { memo: 'Keep', crrtOrders: { flow: 80 }, firstDialysisPlan: { first: true } }
    const id = patient(metadata)
    const calls = [() => saveOrder(id, { bloodFlow: 280 }), () => api('PUT', `/api/patients/${id}`, { dialysisOrders: { bloodFlow: 280 } })]
    if (!historyFirst) calls.reverse()
    for (const call of calls) assert.ok([200, 201].includes((await call()).status))
    for (const [key, value] of Object.entries(metadata)) assert.deepEqual(current(id)[key], value)
    assert.deepEqual(JSON.parse(histories(id)[0].orders), current(id))
  }
})

test('invalid orders or absent patients return 400/404 with no database writes', async () => {
  const id = patient()
  for (const payload of [undefined, null, [], 'HD', 42, {}, { mode: {} }, { memo: [] }, { crrtOrders: [] }, { firstDialysisPlan: 'bad' }]) {
    const before = databaseSnapshot()
    assert.equal((await saveOrder(id, payload)).status, 400)
    assert.equal(databaseSnapshot(), before)
  }
  const before = databaseSnapshot()
  assert.equal((await saveOrder('synthetic-missing', { bloodFlow: 250 })).status, 404)
  assert.equal((await api('POST', '/api/orders/history', { orders: { bloodFlow: 250 } })).status, 400)
  assert.equal(databaseSnapshot(), before)
})

for (const target of ['patients', 'dialysis_orders_history', 'patient_history', 'daily_logs']) {
  test(`failure writing ${target} rolls back current orders, history and related changes`, async () => {
    const id = patient({ memo: 'Keep' })
    const operation = target === 'patients' ? 'UPDATE OF dialysis_orders' : 'INSERT'
    const trigger = `fail_order_${target}`
    db.exec(`CREATE TRIGGER ${trigger} BEFORE ${operation} ON ${target} BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END`)
    const before = databaseSnapshot()
    const eventsBefore = events.length
    try {
      assert.equal((await saveOrder(id, { mode: 'SLEDD' })).status, 500)
      assert.equal(databaseSnapshot(), before)
      assert.equal(events.length, eventsBefore, 'no failed transaction event is published')
    } finally { db.exec(`DROP TRIGGER ${trigger}`) }
  })
}

test('mode saves normalize SLED, retain today snapshots, record one movement and exclude it from KiDit', async () => {
  const id = patient()
  db.prepare('INSERT OR REPLACE INTO schedules (id, date, schedule) VALUES (?, ?, ?)')
    .run(today, today, JSON.stringify({ '1-early': { patientId: id, shiftId: 'early' } }))
  const result = await saveOrder(id, { mode: 'SLEDD' })
  assert.equal(result.status, 201)
  assert.equal(current(id).mode, 'SLED')
  assert.equal(JSON.parse(histories(id)[0].orders).mode, 'SLED')
  const snapshot = JSON.parse(db.prepare('SELECT schedule FROM schedules WHERE date = ?').get(today).schedule)['1-early'].archivedPatientInfo
  assert.equal(snapshot.mode, 'HD')
  assert.equal(snapshot.wardNumber, 'SYN-101')
  const eventsForPatient = db.prepare('SELECT * FROM patient_history WHERE patient_id = ?').all(id)
  assert.equal(eventsForPatient.length, 1)
  assert.equal(eventsForPatient[0].event_type, 'MODE_CHANGE')
  const movements = JSON.parse(db.prepare('SELECT patient_movements FROM daily_logs WHERE date = ?').get(today).patient_movements)
  assert.equal(movements.filter(item => item.patientId === id && item.type === '更改模式').length, 1)
  const kidit = JSON.stringify(db.prepare('SELECT * FROM kidit_logbook').all())
  assert.ok(!kidit.includes(id))
  await saveOrder(id, { bloodFlow: 300 })
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM patient_history WHERE patient_id = ?').get(id).n, 1)
})

test('CVVHDF mode save cancels future exceptions and rebuilds their schedule in the same transaction', async () => {
  const id = patient()
  const future = '2026-09-16'
  const exceptionId = randomUUID()
  db.prepare(`INSERT INTO schedule_exceptions (id, type, patient_id, patient_name, date, to_data, status)
    VALUES (?, 'ADD_SESSION', ?, 'Synthetic Patient', ?, ?, 'applied')`)
    .run(exceptionId, id, future, JSON.stringify({ goalDate: future, bedId: '2', shiftId: 'early' }))
  db.prepare('INSERT OR REPLACE INTO schedules (id, date, schedule) VALUES (?, ?, ?)')
    .run(future, future, JSON.stringify({ '2-early': { patientId: id, shiftId: 'early' } }))
  db.prepare('INSERT OR REPLACE INTO daily_logs (id, date, patient_movements) VALUES (?, ?, ?)')
    .run(future, future, JSON.stringify([{ id: `auto_add_session_${exceptionId}`, patientId: id, type: '臨時加洗' }]))
  db.exec("CREATE TRIGGER fail_cvvhdf BEFORE INSERT ON dialysis_orders_history BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END")
  const before = databaseSnapshot()
  const eventsBefore = events.length
  try {
    assert.equal((await saveOrder(id, { mode: 'cvvhdf' })).status, 500)
    assert.equal(databaseSnapshot(), before)
    assert.equal(events.length, eventsBefore)
  } finally { db.exec('DROP TRIGGER fail_cvvhdf') }
  assert.equal((await saveOrder(id, { mode: 'cvvhdf' })).status, 201)
  assert.equal(current(id).mode, 'CVVHDF')
  assert.equal(db.prepare('SELECT id FROM schedule_exceptions WHERE id = ?').get(exceptionId), undefined)
  assert.deepEqual(JSON.parse(db.prepare('SELECT schedule FROM schedules WHERE date = ?').get(future).schedule), {})
  assert.deepEqual(JSON.parse(db.prepare('SELECT patient_movements FROM daily_logs WHERE date = ?').get(future).patient_movements), [])
})

test('contributor/viewer cannot delete or restore through PUT, PATCH, DELETE or restore endpoint', async () => {
  for (const role of ['contributor', 'viewer']) {
    for (const deleted of [false, true]) {
      const id = patient({}, deleted)
      for (const [method, route, body] of [
        ['PUT', `/api/patients/${id}`, { isDeleted: !deleted, name: 'Must not change' }],
        ['PATCH', `/api/patients/${id}`, { isDeleted: !deleted }],
        ['DELETE', `/api/patients/${id}`, { reason: 'Denied' }],
        ['POST', `/api/patients/${id}/restore`, { status: 'ipd' }],
      ]) {
        const before = databaseSnapshot()
        assert.equal((await api(method, route, body, tokens[role])).status, 403, `${role} ${method} ${route}`)
        assert.equal(databaseSnapshot(), before)
      }
    }
  }
})

test('editor/admin can still delete and restore, and contributor can update ordinary patient fields', async () => {
  for (const role of ['editor', 'admin']) {
    const id = patient()
    assert.equal((await api('PUT', `/api/patients/${id}`, { isDeleted: true }, tokens[role])).status, 200)
    assert.equal((await api('PATCH', `/api/patients/${id}`, { isDeleted: false }, tokens[role])).status, 200)
    assert.equal((await api('DELETE', `/api/patients/${id}`, { reason: 'Synthetic' }, tokens[role])).status, 200)
    assert.equal((await api('POST', `/api/patients/${id}/restore`, { status: 'ipd' }, tokens[role])).status, 200)
  }
  const id = patient()
  assert.equal((await api('PUT', `/api/patients/${id}`, { notes: 'Synthetic note' }, tokens.contributor)).status, 200)
  assert.equal(db.prepare('SELECT notes FROM patients WHERE id = ?').get(id).notes, 'Synthetic note')
})

test('contributor can submit the full patient form without changing deletion state', async () => {
  const id = patient()
  const original = await api('GET', `/api/patients/${id}`, undefined, tokens.contributor)
  assert.equal(original.status, 200)
  assert.equal(original.data.isDeleted, false)
  const body = { ...original.data, remarks: 'Updated from the full patient form' }
  delete body.id
  delete body.firstDialysisPlan
  assert.equal((await api('PUT', `/api/patients/${id}`, body, tokens.contributor)).status, 200)
  const stored = db.prepare('SELECT notes, is_deleted FROM patients WHERE id = ?').get(id)
  assert.equal(stored.notes, body.remarks)
  assert.equal(stored.is_deleted, 0)
  for (const invalid of [0, 1, 'false', null]) {
    const before = databaseSnapshot()
    assert.equal((await api('PUT', `/api/patients/${id}`, { isDeleted: invalid }, tokens.contributor)).status, 400)
    assert.equal(databaseSnapshot(), before)
  }
})

test('missing schedule has a distinct version and rejects a concurrent first save', async () => {
  db.prepare('DELETE FROM schedules WHERE date = ?').run(today)
  const empty = await api('GET', `/api/schedules/${today}`)
  assert.equal(empty.status, 200)
  assert.equal(empty.data.version, -1)
  assert.deepEqual(empty.data.schedule, {})
  assert.equal(db.prepare('SELECT id FROM schedules WHERE date = ?').get(today), undefined)
  const firstSchedule = { 'bed-1-early': { patientId: patient(), manualNote: 'first editor' } }
  const saved = await api('PUT', `/api/schedules/${today}`, { schedule: firstSchedule, expectedVersion: empty.data.version })
  assert.equal(saved.status, 200)
  assert(saved.data.version >= 0)
  const stale = await api('PUT', `/api/schedules/${today}`, { schedule: {}, expectedVersion: empty.data.version })
  assert.equal(stale.status, 409)
  assert.equal(stale.data.code, 'VERSION_CONFLICT')
  assert.deepEqual(JSON.parse(db.prepare('SELECT schedule FROM schedules WHERE date = ?').get(today).schedule), firstSchedule)
  db.prepare('DELETE FROM schedules WHERE date = ?').run(today)
  const removed = await api('PUT', `/api/schedules/${today}`, { schedule: firstSchedule, expectedVersion: saved.data.version })
  assert.equal(removed.status, 409)
  assert.equal(removed.data.currentVersion, -1)
  assert.equal(db.prepare('SELECT id FROM schedules WHERE date = ?').get(today), undefined)
})

test('equipment writes follow the admin/viewer matrix for every mutation route', async () => {
  const routes = [
    ['PUT', '/api/orders/bed-settings/38', { machineBrand: 'Synthetic' }],
    ['PUT', '/api/orders/bed-settings', { 38: { machineBrand: 'Synthetic' } }],
    ['POST', '/api/orders/machine-bicarbonate-config', { model: 'Synthetic' }],
    ['PATCH', '/api/orders/machine-bicarbonate-config/synthetic-machine', { model: 'Synthetic 2' }],
    ['DELETE', '/api/orders/machine-bicarbonate-config/synthetic-machine', {}],
  ]
  for (const role of ['contributor', 'editor', 'admin', 'viewer']) {
    for (const [method, path, body] of routes) {
      db.prepare(`INSERT OR REPLACE INTO site_config (id, config_data) VALUES ('machine_bicarbonate_config', ?)`)
        .run(JSON.stringify({ 'synthetic-machine': { model: 'Before' } }))
      const before = databaseSnapshot()
      const result = await api(method, path, body, tokens[role])
      if (['admin', 'viewer'].includes(role)) assert.ok([200, 201].includes(result.status), `${role} ${path}`)
      else { assert.equal(result.status, 403); assert.equal(databaseSnapshot(), before) }
    }
  }
})

test('title-only specialist demotion revokes the old session; fresh admin/contributor access remains', async () => {
  for (const role of ['editor', 'admin', 'contributor']) {
    const username = `synthetic-np-${role}`
    const user = await api('POST', '/api/auth/users', { username, password, name: 'Synthetic NP', role, title: '專科護理師' })
    assert.equal(user.status, 201)
    const id = user.data.id
    const login = await api('POST', '/api/auth/login', { username, password })
    assert.equal(login.status, 200)
    const token = login.data.token
    assert.equal((await api('GET', '/api/aki/batches', undefined, token)).status, 200)
    assert.equal((await api('PUT', `/api/auth/users/${id}`, { title: '護理師' })).status, 200)
    assert.equal(db.prepare('SELECT * FROM active_sessions WHERE user_id = ?').get(id), undefined)
    assert.equal((await api('GET', '/api/aki/batches', undefined, token)).status, 401)
    const freshLogin = await api('POST', '/api/auth/login', { username, password })
    assert.equal(freshLogin.status, 200)
    assert.equal((await api('GET', '/api/aki/batches', undefined, freshLogin.data.token)).status, role === 'editor' ? 403 : 200)
  }
})
