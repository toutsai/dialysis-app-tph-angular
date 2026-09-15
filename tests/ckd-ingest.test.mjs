// 門診 CKD：匯入合併規則回歸測試（暫存 SQLite，套 schema.sql）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ingestPayload, ingestCases, ingestLabs, ingestClinic, ingestBilling, sourceSummary, listBatches } from '../src/services/ckd/ingest.js'
import { toPayload } from '../src/services/ckd/rows.js'

const schema = fs.readFileSync(new URL('../src/db/schema.sql', import.meta.url), 'utf8')
function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ckd-test-'))
  const db = new Database(path.join(dir, 't.db'))
  db.exec(schema)
  return db
}
const d = (s) => new Date(s + 'T00:00:00')

test('追蹤清冊：逐人取代（新檔出現的人舊列整批換掉，其他人不動）', () => {
  const db = tempDb()
  const r1 = toPayload('case', [
    { mrn: '1', visit: d('2026-01-10'), code: '', ctype: '新收案', name: 'A', prog: 'pre', cat: 'Pre-ESRD', enroll: d('2026-01-10') },
    { mrn: '1', visit: d('2026-06-15'), code: 'P3403C', ctype: '追蹤', name: 'A', prog: 'pre', cat: 'Pre-ESRD', enroll: d('2026-01-10') },
    { mrn: '2', visit: d('2026-03-01'), code: '', ctype: '新收案', name: 'B', prog: 'early', cat: 'Early-CKD', enroll: d('2026-03-01') },
  ])
  const a = ingestPayload(db, r1, { fileName: 'f1.xlsx', fileHash: 'h1' })
  assert.deepEqual([a.stats.added, a.stats.updated, a.stats.removed, a.stats.dup], [3, 0, 0, 0])
  // 第二檔：只有病人 1，最後照護日推進到 8/20 → 1 的舊列全換，2 保留
  const r2 = toPayload('case', [
    { mrn: '1', visit: d('2026-01-10'), code: '', ctype: '新收案', name: 'A', prog: 'pre', cat: 'Pre-ESRD', enroll: d('2026-01-10') },
    { mrn: '1', visit: d('2026-08-20'), code: 'P3403C', ctype: '追蹤', name: 'A', prog: 'pre', cat: 'Pre-ESRD', enroll: d('2026-01-10') },
  ])
  const b = ingestPayload(db, r2, { fileName: 'f2.xlsx', fileHash: 'h2' })
  assert.deepEqual([b.stats.added, b.stats.dup, b.stats.removed], [1, 1, 1], '新 8/20 列 +1、新收案列重複、舊 6/15 列移除')
  const rows = db.prepare(`SELECT mrn, visit_date, ctype FROM ckd_cases ORDER BY mrn, visit_date`).all()
  assert.deepEqual(rows, [
    { mrn: '1', visit_date: '2026-01-10', ctype: '新收案' },
    { mrn: '1', visit_date: '2026-08-20', ctype: '追蹤' },
    { mrn: '2', visit_date: '2026-03-01', ctype: '新收案' },
  ])
  // 同內容檔（同 hash）略過
  const c = ingestPayload(db, r2, { fileName: 'f2-again.xlsx', fileHash: 'h2' })
  assert.equal(c.dup, true); assert.equal(c.prevBatch.file_name, 'f2.xlsx')
  assert.equal(listBatches(db).length, 2)
  assert.equal(sourceSummary(db).case.persons, 2)
})

test('檢驗：同鍵取聯集、新值覆蓋、定性與旗標跟著新值', () => {
  const db = tempDb()
  const s1 = ingestLabs(db, [{ no: '1|2026-09-01|B', mrn: '1', name: 'A', date: '2026-09-01', spec: 'B', kind: '生化', src: 'lab', v: { cr: 2.3, k: 5.6 }, flag: { k: 'H' }, q: {} }], 'b1')
  assert.deepEqual([s1.added, s1.updated, s1.dup], [1, 0, 0])
  const s2 = ingestLabs(db, [{ no: '1|2026-09-01|B', mrn: '1', name: 'A', date: '2026-09-01', spec: 'B', kind: '生化', src: 'lab', v: { cr: 2.5, hb: 9.8 }, flag: { hb: 'L' }, q: { cr: '<' } }], 'b2')
  assert.deepEqual([s2.added, s2.updated, s2.dup], [0, 1, 0])
  const row = db.prepare(`SELECT values_json, flags_json, quals_json FROM ckd_labs WHERE no = ?`).get('1|2026-09-01|B')
  assert.deepEqual(JSON.parse(row.values_json), { cr: 2.5, k: 5.6, hb: 9.8 }, '聯集且 cr 被新值覆蓋')
  assert.deepEqual(JSON.parse(row.flags_json), { k: 'H', hb: 'L' })
  assert.deepEqual(JSON.parse(row.quals_json), { cr: '<' })
  const s3 = ingestLabs(db, [{ no: '1|2026-09-01|B', mrn: '1', name: 'A', date: '2026-09-01', spec: 'B', src: 'lab', v: { hb: 9.8 }, flag: { hb: 'L' }, q: {} }], 'b3')
  assert.equal(s3.dup, 1, '沒有變化就算重複')
})

test('門診清單：同鍵略過；自帶 ACR/eGFR 併入檢驗（no 以 clinic| 開頭）', () => {
  const db = tempDb()
  const p = toPayload('clinic', [
    { mrn: '602991', name: 'D', date: d('2026-09-16'), no: '5', half: '上午', dept: '腎臟內科', doctor: 'X', acrDate: d('2026-08-01'), acr: 45, egfrDate: d('2026-08-01'), egfr: 38.2, birth: d('1950-01-01'), age: 76, sex: '男' },
    { mrn: '602991', name: 'D', date: d('2026-09-16'), no: '5', half: '上午', dept: '腎臟內科', doctor: 'X' },  // 同鍵重複
  ])
  assert.equal(p.extraLabs.length, 2)
  const r = ingestPayload(db, p, { fileName: 'c.xls', fileHash: 'hc' })
  assert.deepEqual([r.stats.added, r.stats.dup], [1, 1])
  assert.equal(r.labStats.added, 2)
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ckd_labs WHERE src = 'clinic' AND no LIKE 'clinic|%'`).get().n, 2)
  assert.equal(db.prepare(`SELECT visit_date FROM ckd_clinic_visits`).get().visit_date, '2026-09-16')
  const sum = sourceSummary(db)
  assert.equal(sum.clinic.days, 1); assert.equal(sum.lab.fromClinic, 2); assert.equal(sum.lab.rangeStart, null, '檢驗區間只算 0204 來源')
})

test('入帳：鍵 mrn|visit|code 略過重複；缺日期列不寫', () => {
  const db = tempDb()
  const s = ingestBilling(db, [
    { mrn: '1', visit: '2026-07-07', code: 'P3403C', prog: 'pre', ctype: '追蹤', price: 600, n: 1 },
    { mrn: '1', visit: '2026-07-07', code: 'P3403C', prog: 'pre', ctype: '追蹤', price: 600, n: 1 },
    { mrn: '1', visit: '', code: 'P3406C' },
  ], 'b')
  assert.deepEqual([s.rows, s.added, s.dup], [3, 1, 2])
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ckd_billing`).get().n, 1)
})

test('ingestCases：缺 visit 的列不寫入、dm/closed 轉 0/1', () => {
  const db = tempDb()
  const s = ingestCases(db, [
    { mrn: '9', visit: '2026-01-01', code: '', ctype: '新收案', dm: true, closed: true, closeDate: '2026-02-01', cat: 'DKD' },
    { mrn: '9', visit: null, code: '', ctype: '追蹤' },
  ], 'b')
  assert.equal(s.rows, 2)
  const row = db.prepare(`SELECT dm, closed, close_date FROM ckd_cases WHERE mrn = '9'`).all()
  assert.deepEqual(row, [{ dm: 1, closed: 1, close_date: '2026-02-01' }])
})
