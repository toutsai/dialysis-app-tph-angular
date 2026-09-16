import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { performance } from 'node:perf_hooks'
import { countCurrentCensus, loadCensusReplay } from '../src/services/patientCensus.js'

process.env.DB_PATH = ':memory:'
process.env.NODE_ENV = 'test'
process.env.TZ = 'Asia/Taipei'
const { initDatabase, closeDatabase } = await import('../src/db/init.js')
const db = initDatabase()
after(() => closeDatabase())

test('current census retains every existing classification without loading history', () => {
  const rows = []
  const insert = db.prepare('INSERT INTO patients(id, medical_record_number, name, status, patient_category, is_deleted) VALUES(?, ?, ?, ?, ?, ?)')
  for (const status of ['opd', 'ipd', 'er', 'deleted', null]) {
    for (const category of [null, '', 'opd_regular', 'ipd', ' ']) {
      for (const deleted of [0, 1, null]) {
        const id = `synthetic-${rows.length}`
        insert.run(id, 'SYN-' + id, 'Synthetic census fixture', status, category, deleted)
        rows.push({ id, status, category, deleted })
      }
    }
  }
  const expected = {
    opdRegular: rows.filter(p => p.deleted !== 1 && (!p.category || p.category === 'opd_regular')).length,
    opd: rows.filter(p => p.deleted !== 1 && p.status === 'opd').length,
    ipd: rows.filter(p => p.deleted !== 1 && p.status === 'ipd').length,
    er: rows.filter(p => p.deleted !== 1 && p.status === 'er').length,
  }
  assert.deepEqual(expected, { opdRegular: 30, opd: 10, ipd: 10, er: 10 })
  const history = db.prepare('INSERT INTO patient_history(id, patient_id, event_type, event_details, snapshot, timestamp) VALUES(?, ?, ?, ?, ?, ?)')
  db.transaction(() => {
    for (let i = 0; i < 6000; i++) {
      history.run(`history-${i}`, rows[i % rows.length].id, i % 2 ? 'STATUS_CHANGE' : 'DELETE',
        i % 10 ? '{"fromStatus":"opd"}' : '{legacy malformed', '{}', '2026-08-01 12:00:00')
    }
  })()

  const measureReads = operation => {
    const queries = []
    const trackedDb = { prepare(sql) {
      const statement = db.prepare(sql)
      return { all(...params) {
        const values = statement.all(...params)
        queries.push({ sql, rows: values.length })
        return values
      } }
    } }
    const start = performance.now()
    const result = operation(trackedDb)
    return { result, queries, elapsedMs: +(performance.now() - start).toFixed(3) }
  }
  const baseline = measureReads(connection => loadCensusReplay(connection).countAt('2026-09-14'))
  const optimized = measureReads(countCurrentCensus)
  assert.deepEqual(baseline.result, expected)
  assert.deepEqual(optimized.result, expected)
  assert.equal(baseline.queries.length, 2)
  assert.equal(baseline.queries.find(query => query.sql.includes('patient_history')).rows, 6000)
  assert.equal(optimized.queries.length, 1)
  assert.equal(optimized.queries[0].rows, rows.length)
  assert.equal(optimized.queries.some(query => query.sql.includes('patient_history')), false)
  console.log('CURRENT CENSUS READS', JSON.stringify({
    patients: rows.length, baselineRows: rows.length + 6000, optimizedRows: rows.length,
    baselineMs: baseline.elapsedMs, optimizedMs: optimized.elapsedMs,
  }))

  // The replay engine must still react to historical undo operations after sharing its count function.
  const replay = loadCensusReplay(db)
  replay.undo({ pid: 'synthetic-0', type: 'CREATE', d: {}, s: {} })
  assert.deepEqual(replay.countAt('2026-07-31'), { ...expected, opdRegular: 29, opd: 9 })
  replay.undo({ pid: 'synthetic-0', type: 'DELETE', d: { fromStatus: 'ipd' }, s: {} })
  assert.deepEqual(replay.countAt('2026-07-30'), { ...expected, opd: 9, ipd: 11 })
})
