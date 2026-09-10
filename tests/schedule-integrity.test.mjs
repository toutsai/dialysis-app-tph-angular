import { test, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'

// 必須在 import DB 單例之前設定；測試不載入 .env，也不碰任何磁碟資料庫。
process.env.DB_PATH = ':memory:'
process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'schedule-integrity-synthetic-only'
const { initDatabase, closeDatabase } = await import('../src/db/init.js')
const {
  generateDailyScheduleFromRules, initializeFutureSchedules, mergeExceptionsIntoSchedules,
  rebuildAndSaveSchedules, syncMasterScheduleToFutureSync,
} = await import('../src/services/scheduleSync.js')
const { processScheduleException } = await import('../src/services/exceptionHandler.js')
const { retargetConflict, resolveSourceConflict, reconcileSingleDayMove } = await import('../src/services/exceptionReconcile.js')
const { applyScheduledPatientUpdates } = await import('../src/services/scheduler.js')
const { default: router } = await import('../src/routes/schedules.js')

const TODAY = '2030-01-07' // Monday, 05:00 Taipei; before today's freeze.
const SOURCE = '2030-01-14'
const TARGET = '2030-01-15'
let db
beforeEach(() => {
  mock.timers.enable({ apis: ['Date'], now: new Date(`${TODAY}T05:00:00+08:00`) })
  mock.method(console, 'log', () => {})
  mock.method(console, 'error', () => {})
  db = initDatabase()
})
afterEach(() => { closeDatabase(); mock.restoreAll(); mock.timers.reset() })

const rule = (patientName, bedNum, freq) => ({ patientName, bedNum, shiftIndex: 0, freq })
const RULES = { A: rule('Synthetic A', 1, '每周一'), B: rule('Synthetic B', 2, '每周二') }
function seed(rules = RULES, dates = [SOURCE, TARGET]) {
  db.prepare('INSERT INTO base_schedules(id,schedule) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET schedule=excluded.schedule').run('MASTER_SCHEDULE', JSON.stringify(rules))
  for (const [id, value] of Object.entries(rules)) {
    db.prepare(`INSERT INTO patients(id,medical_record_number,name,dialysis_orders,bed_number,schedule_rule)
      VALUES (?,?,?,?,?,?)`).run(id, `SYNTH-${id}`, value.patientName, JSON.stringify({ freq: value.freq }), value.bedNum, JSON.stringify(value))
  }
  for (const date of dates) db.prepare('INSERT INTO schedules(id,date,schedule) VALUES (?,?,?)')
    .run(date, date, JSON.stringify(generateDailyScheduleFromRules(rules, date)))
}
const patientMap = () => new Map(db.prepare('SELECT * FROM patients').all().map(row => [row.id, row]))
const read = date => JSON.parse(db.prepare('SELECT schedule FROM schedules WHERE date=?').get(date)?.schedule || '{}')
const positions = (date, id = 'A') => Object.entries(read(date)).filter(([,slot]) => slot.patientId === id).map(([key]) => key)
const ledger = id => db.prepare('SELECT * FROM schedule_exceptions WHERE id=?').get(id)
const snapshot = () => ({ schedules: db.prepare('SELECT * FROM schedules ORDER BY date').all(), exceptions: db.prepare('SELECT * FROM schedule_exceptions ORDER BY id').all() })

function exception(data, id = 'synthetic-exception') {
  db.prepare(`INSERT INTO schedule_exceptions(id,type,status,patient_id,patient_name,from_data,to_data,
    patient1,patient2,start_date,end_date,date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, data.type, data.status || 'pending', data.patientId || 'A', data.patientName || 'Synthetic A',
    JSON.stringify(data.from || {}), JSON.stringify(data.to || {}), JSON.stringify(data.patient1 || {}),
    JSON.stringify(data.patient2 || {}), data.startDate || null, data.endDate || null, data.date || null)
  return { status: 'pending', patientId: 'A', patientName: 'Synthetic A', ...data }
}
const move = (bedNum = 2) => ({ type: 'MOVE', from: { sourceDate: SOURCE, bedNum: 1, shiftCode: 'early' },
  to: { goalDate: TARGET, bedNum, shiftCode: 'early' } })
async function conflictingMove() {
  const data = exception(move())
  const result = await processScheduleException('synthetic-exception', data)
  assert.equal(result.success, false)
  assert.equal(ledger('synthetic-exception').status, 'conflict_requires_resolution')
  assert.deepEqual(positions(SOURCE), ['bed-1-early'])
}
function invokeRoute(method, routePath, req) {
  const layer = router.stack.find(layer => layer.route?.path === routePath && layer.route.methods[method])
  const handler = layer.route.stack.at(-1).handle
  const response = { code: 200, body: null, status(code) { this.code = code; return this }, json(body) { this.body = body; return this } }
  return Promise.resolve(handler(req, response)).then(() => response)
}

test('GET preserves an intentionally empty suspended schedule', async () => {
  seed({ A: RULES.A }, [SOURCE])
  await processScheduleException('synthetic-exception', exception({ type: 'SUSPEND', startDate: SOURCE, endDate: SOURCE }))
  assert.deepEqual(read(SOURCE), {})
  const before = snapshot()
  const response = await invokeRoute('get', '/:date', { params: { date: SOURCE } })
  assert.equal(response.code, 200)
  assert.deepEqual(response.body.schedule, {})
  assert.deepEqual(snapshot(), before)
})

test('GET creates missing dates with the active suspension applied', async () => {
  seed({ A: RULES.A }, [])
  exception({ type: 'SUSPEND', status: 'applied', startDate: SOURCE, endDate: SOURCE })
  const response = await invokeRoute('get', '/:date', { params: { date: SOURCE } })
  assert.deepEqual(response.body.schedule, {})
  assert.ok(db.prepare('SELECT id FROM schedules WHERE date=?').get(SOURCE))
})

test('initializer applies a long suspension as new dates enter its horizon', async () => {
  seed({ A: RULES.A }, [])
  exception({ type: 'SUSPEND', status: 'applied', startDate: TODAY, endDate: '2030-05-01' })
  await initializeFutureSchedules()
  assert.deepEqual(positions(SOURCE), [])
  mock.timers.setTime(new Date('2030-01-15T05:00:00+08:00').getTime())
  await initializeFutureSchedules()
  assert.deepEqual(positions('2030-03-11'), [])
  assert.ok(db.prepare('SELECT id FROM schedules WHERE date=?').get('2030-03-11'))
})

test('cross-day conflict retarget moves the source and destination together', async () => {
  seed(); await conflictingMove()
  const result = retargetConflict(db, 'synthetic-exception', { bedNum: 3, shiftCode: 'early' }, RULES, patientMap())
  assert.equal(result.ok, true)
  assert.deepEqual(positions(SOURCE), [])
  assert.deepEqual(positions(TARGET), ['bed-3-early'])
  assert.equal(ledger('synthetic-exception').status, 'applied')
  assert.deepEqual([...result.affectedDates].sort(), [SOURCE, TARGET])
  const stable = [read(SOURCE), read(TARGET)]
  await mergeExceptionsIntoSchedules(RULES, [SOURCE, TARGET], patientMap())
  assert.deepEqual([read(SOURCE), read(TARGET)], stable)
})

test('conflicting cross-day remerge keeps the original source session', async () => {
  seed(); await conflictingMove()
  await mergeExceptionsIntoSchedules(RULES, [SOURCE, TARGET], patientMap())
  assert.deepEqual(positions(SOURCE), ['bed-1-early'])
  assert.deepEqual(positions(TARGET), [])
  assert.equal(ledger('synthetic-exception').status, 'conflict_requires_resolution')
})

test('master change creating a target conflict preserves the cross-day source', async () => {
  seed(); await processScheduleException('synthetic-exception', exception(move(3)))
  syncMasterScheduleToFutureSync(RULES, { ...RULES, B: { ...RULES.B, bedNum: 3 } })
  assert.deepEqual(positions(SOURCE), ['bed-1-early'])
  assert.deepEqual(positions(TARGET), [])
  assert.deepEqual(positions(TARGET, 'B'), ['bed-3-early'])
  assert.equal(ledger('synthetic-exception').status, 'conflict_requires_resolution')
})

test('a newly conflicting MOVE with a frozen source rejects the rebuild and preserves both days', async () => {
  const tomorrow = '2030-01-08'
  seed(RULES, [TODAY, tomorrow])
  const data = exception({ type: 'MOVE', from: { sourceDate: TODAY, bedNum: 1, shiftCode: 'early' },
    to: { goalDate: tomorrow, bedNum: 3, shiftCode: 'early' } })
  assert.equal((await processScheduleException('synthetic-exception', data)).success, true)
  mock.timers.setTime(new Date(`${TODAY}T12:00:00+08:00`).getTime())
  // A successful partial replay remains allowed and never rewrites the frozen source.
  const sourceBefore = db.prepare('SELECT * FROM schedules WHERE date=?').get(TODAY)
  rebuildAndSaveSchedules([tomorrow], RULES, patientMap())
  assert.deepEqual(db.prepare('SELECT * FROM schedules WHERE date=?').get(TODAY), sourceBefore)
  assert.deepEqual(positions(TODAY), [])
  assert.deepEqual(positions(tomorrow), ['bed-3-early'])
  const before = snapshot()
  const nextRules = { ...RULES, B: { ...RULES.B, bedNum: 3 } }
  assert.throws(() => rebuildAndSaveSchedules([tomorrow], nextRules, patientMap()), /無法安全重建/)
  assert.deepEqual(snapshot(), before)
  assert.equal(ledger('synthetic-exception').status, 'applied')
})

test('a MOVE source excluded by the tomorrow-only boundary rolls back the full sync on new conflict', async () => {
  const tomorrow = '2030-01-08'
  seed(RULES, [TODAY, tomorrow])
  const data = exception({ type: 'MOVE', from: { sourceDate: TODAY, bedNum: 1, shiftCode: 'early' },
    to: { goalDate: tomorrow, bedNum: 3, shiftCode: 'early' } })
  assert.equal((await processScheduleException('synthetic-exception', data)).success, true)
  const before = snapshot()
  const nextRules = { ...RULES, B: { ...RULES.B, bedNum: 3 } }
  assert.throws(() => syncMasterScheduleToFutureSync(RULES, nextRules), /無法安全重建/)
  assert.deepEqual(snapshot(), before)
  assert.deepEqual(positions(TODAY), [])
  assert.deepEqual(positions(tomorrow), ['bed-3-early'])
  assert.equal(ledger('synthetic-exception').status, 'applied')
})

test('initial MOVE status-write failure does not commit either schedule', async () => {
  seed(); const data = exception(move(3))
  const before = snapshot().schedules
  db.exec(`CREATE TRIGGER synthetic_fail BEFORE UPDATE OF status ON schedule_exceptions
    WHEN NEW.status='applied' BEGIN SELECT RAISE(ABORT,'synthetic ledger failure'); END`)
  const result = await processScheduleException('synthetic-exception', data)
  assert.equal(result.success, false)
  assert.deepEqual(snapshot().schedules, before)
  assert.equal(ledger('synthetic-exception').status, 'error')
})

test('retarget SQL failure rolls back both schedules and the exception ledger', async () => {
  seed(); await conflictingMove()
  const before = snapshot()
  db.exec(`CREATE TRIGGER synthetic_fail BEFORE UPDATE OF schedule ON schedules
    WHEN NEW.date='${TARGET}' BEGIN SELECT RAISE(ABORT,'synthetic target failure'); END`)
  const result = retargetConflict(db, 'synthetic-exception', { bedNum: 3, shiftCode: 'early' }, RULES, patientMap())
  assert.equal(result.ok, false)
  assert.deepEqual(snapshot(), before)
})

test('cancelling a cross-day move restores the original and removes the destination', async () => {
  seed(); const data = exception(move(3)); await processScheduleException('synthetic-exception', data)
  const result = resolveSourceConflict(db, 'synthetic-exception', 'keep_base', RULES, patientMap())
  assert.equal(result.ok, true)
  assert.deepEqual(positions(SOURCE), ['bed-1-early'])
  assert.deepEqual(positions(TARGET), [])
})

test('delete failure restores the exception ledger and both days', async () => {
  seed(); await processScheduleException('synthetic-exception', exception(move(3)))
  const before = snapshot()
  db.exec(`CREATE TRIGGER synthetic_fail BEFORE UPDATE OF schedule ON schedules
    WHEN NEW.date='${TARGET}' BEGIN SELECT RAISE(ABORT,'synthetic delete failure'); END`)
  const result = await invokeRoute('delete', '/exceptions/:id', { params: { id: 'synthetic-exception' }, user: { id: 'tester', name: 'Synthetic tester' } })
  assert.equal(result.code, 500)
  assert.deepEqual(snapshot(), before)
})

test('same-day MOVE reconciliation and cancellation preserve their original semantics', () => {
  seed({ A: RULES.A }, [SOURCE])
  const data = { patientId: 'A', patientName: 'Synthetic A', type: 'MOVE',
    from: { sourceDate: SOURCE, bedNum: 1, shiftCode: 'early' }, to: { goalDate: SOURCE, bedNum: 3, shiftCode: 'early' } }
  reconcileSingleDayMove(db, data, { A: RULES.A }, patientMap())
  assert.deepEqual(positions(SOURCE), ['bed-3-early'])
  reconcileSingleDayMove(db, { ...data, to: { ...data.to, bedNum: 1 } }, { A: RULES.A }, patientMap())
  assert.deepEqual(positions(SOURCE), ['bed-1-early'])
})

test('SWAP still replays correctly', () => {
  const rules = { A: RULES.A, B: rule('Synthetic B', 2, '每周一') }
  seed(rules, [SOURCE])
  exception({ type: 'SWAP', status: 'applied', date: SOURCE,
    patient1: { patientId: 'A', patientName: 'Synthetic A', fromBedNum: 1, fromShiftCode: 'early' },
    patient2: { patientId: 'B', patientName: 'Synthetic B', fromBedNum: 2, fromShiftCode: 'early' } })
  rebuildAndSaveSchedules([SOURCE], rules, patientMap())
  assert.deepEqual(positions(SOURCE), ['bed-2-early'])
  assert.deepEqual(positions(SOURCE, 'B'), ['bed-1-early'])
})

test('chained cross-day moves retry after their destination is vacated', () => {
  seed()
  exception({ ...move(), status: 'applied' }, 'a-move')
  exception({ type: 'MOVE', status: 'applied', patientId: 'B', patientName: 'Synthetic B',
    from: { sourceDate: TARGET, bedNum: 2, shiftCode: 'early' },
    to: { goalDate: '2030-01-16', bedNum: 3, shiftCode: 'early' } }, 'b-move')
  rebuildAndSaveSchedules([SOURCE], RULES, patientMap())
  assert.deepEqual(positions(SOURCE), [])
  assert.deepEqual(positions(TARGET), ['bed-2-early'])
  assert.deepEqual(positions('2030-01-16', 'B'), ['bed-3-early'])
  assert.equal(ledger('a-move').status, 'applied')
})

test('cross-day retarget carries the existing source transport registration', async () => {
  seed(); await conflictingMove()
  const schedule = read(SOURCE); schedule['bed-1-early'].transportMethod = 'wheelchair'
  db.prepare('UPDATE schedules SET schedule=? WHERE date=?').run(JSON.stringify(schedule), SOURCE)
  const result = retargetConflict(db, 'synthetic-exception', { bedNum: 3, shiftCode: 'early' }, RULES, patientMap())
  assert.equal(result.ok, true)
  assert.equal(read(TARGET)['bed-3-early'].transportMethod, 'wheelchair')
})

test('rebuild retains an ADD_SESSION mode override and transport registration', async () => {
  seed({ A: RULES.A }, [TARGET])
  await processScheduleException('synthetic-exception', exception({ type: 'ADD_SESSION', to: { goalDate: TARGET, bedNum: 3, shiftCode: 'noon', mode: 'PP' } }))
  const schedule = read(TARGET); schedule['bed-3-noon'].transportMethod = 'wheelchair'
  db.prepare('UPDATE schedules SET schedule=? WHERE date=?').run(JSON.stringify(schedule), TARGET)
  rebuildAndSaveSchedules([TARGET], { A: RULES.A }, patientMap())
  assert.equal(read(TARGET)['bed-3-noon'].modeOverride, 'PP')
  assert.equal(read(TARGET)['bed-3-noon'].shiftId, 'noon')
  assert.equal(read(TARGET)['bed-3-noon'].transportMethod, 'wheelchair')
})

test('full master synchronization SQL failure rolls back the whole future range', () => {
  seed()
  const before = snapshot()
  db.exec(`CREATE TRIGGER synthetic_fail BEFORE UPDATE OF schedule ON schedules
    WHEN NEW.date='${TARGET}' BEGIN SELECT RAISE(ABORT,'synthetic second-day failure'); END`)
  assert.throws(() => syncMasterScheduleToFutureSync(RULES, { ...RULES, A: { ...RULES.A, manualNote: 'changed' } }), /synthetic/)
  assert.deepEqual(snapshot(), before)
})

test('frozen today and historical dates are not overwritten by a linked rebuild', () => {
  seed({ A: RULES.A }, [TODAY, SOURCE])
  mock.timers.setTime(new Date(`${TODAY}T12:00:00+08:00`).getTime())
  const before = read(TODAY)
  rebuildAndSaveSchedules([TODAY, '2030-01-01'], {}, patientMap())
  assert.deepEqual(read(TODAY), before)
  assert.equal(db.prepare('SELECT id FROM schedules WHERE date=?').get('2030-01-01'), undefined)
})

function scheduledTask() {
  db.prepare(`INSERT INTO scheduled_patient_updates(id,patient_id,patient_name,change_type,change_data,effective_date,status)
    VALUES(?,?,?,?,?,?,?)`).run('synthetic-task', 'A', 'Synthetic A', 'UPDATE_BASE_SCHEDULE_RULE',
    JSON.stringify({ bedNum: 3, shiftIndex: 0, freq: '每日' }), TODAY, 'pending')
}
test('scheduled rule sync failure rolls back patient, master and all days and records failed', async () => {
  const rules = { A: rule('Synthetic A', 1, '每日') }
  seed(rules, [TODAY, '2030-01-08']); scheduledTask()
  const before = { patient: db.prepare('SELECT * FROM patients').get(), master: db.prepare('SELECT * FROM base_schedules').get(), schedules: snapshot().schedules }
  db.exec(`CREATE TRIGGER synthetic_fail BEFORE UPDATE OF schedule ON schedules
    WHEN NEW.date='2030-01-08' BEGIN SELECT RAISE(ABORT,'synthetic scheduled failure'); END`)
  await applyScheduledPatientUpdates()
  assert.deepEqual(db.prepare('SELECT * FROM patients').get(), before.patient)
  assert.deepEqual(db.prepare('SELECT * FROM base_schedules').get(), before.master)
  assert.deepEqual(snapshot().schedules, before.schedules)
  const task = db.prepare('SELECT * FROM scheduled_patient_updates').get()
  assert.equal(task.status, 'failed'); assert.match(task.error_message, /synthetic scheduled failure/)
  assert.equal(task.processed_at, null)
})

test('scheduled success preserves the current tomorrow-only sync and no catch-up contract', async () => {
  seed({ A: rule('Synthetic A', 1, '每日') }, [TODAY, '2030-01-08']); scheduledTask()
  await applyScheduledPatientUpdates()
  assert.equal(db.prepare('SELECT status FROM scheduled_patient_updates').get().status, 'processed')
  assert.deepEqual(positions(TODAY), ['bed-1-early'])
  assert.deepEqual(positions('2030-01-08'), ['bed-3-early'])
  db.prepare('UPDATE scheduled_patient_updates SET status=?,effective_date=?').run('pending', '2030-01-06')
  await applyScheduledPatientUpdates()
  assert.equal(db.prepare('SELECT status FROM scheduled_patient_updates').get().status, 'failed')
})
