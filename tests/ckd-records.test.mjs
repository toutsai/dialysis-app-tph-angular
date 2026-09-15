// 門診 CKD：個案紀錄 CRUD、驗證、判定掛鉤、P 碼總覽（暫存 SQLite）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { REC_TYPES, validateRecord, createRecord, updateRecord, deleteRecord, listRecords, makeHooks, pcodeTimeline, recLine, searchPatients, lookupName, recordStats } from '../src/services/ckd/records.js'
import { analyze, makeCfg } from '../src/services/ckd/engine.js'
import { DEFAULT_SETTINGS } from '../src/services/ckd/settings.js'

const schema = fs.readFileSync(new URL('../src/db/schema.sql', import.meta.url), 'utf8')
function tempDb() {
  const db = new Database(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ckd-rec-')), 't.db'))
  db.exec(schema)
  return db
}
const d = (s) => new Date(s + 'T00:00:00')
const TODAY = '2026-09-16'
const user = { uid: 'u1', name: '個管師' }
const caseRow = (o) => ({ src: 'case', mrn: '1', visit: null, code: '', ctype: '追蹤', name: 'A', prog: 'pre', cat: 'Pre-ESRD', dm: false, enroll: null, egfr: null, egfrMdrd: null, stage: null, doctor: '王', nextDue: null, reenroll: false, serial: '', gapDays: null, closed: false, closeDate: null, reason: '', price: null, sex: '', id: '', age: null, cr: null, upcr: null, uacr: null, ...o })
const clinicRow = (o) => ({ mrn: '1', name: 'A', id: '', sex: '男', birth: d('1950-01-01'), age: 76, date: d(TODAY), half: '上午', dept: '腎臟內科', room: '', doctor: '王', no: '5', state: '', revisit: '', pCKD: '', pPRE: '', pDM: '', manual: false, ...o })
const labRow = (o) => ({ mrn: '1', name: 'A', date: d('2026-09-01'), spec: 'B', kind: '生化', no: '1|2026-09-01|B', v: {}, flag: {}, q: {}, src: 'lab', ...o })

test('驗證：必填、選項、日期格式、checks 陣列', () => {
  assert.equal(Object.keys(REC_TYPES).length, 8)
  let v = validateRecord('noEnroll', { at: '2026-09-01', reason: '不存在的原因' })
  assert.equal(v.ok, false); assert.match(v.message, /不是有效選項/)
  v = validateRecord('noEnroll', { reason: '檢驗收集困難' })
  assert.equal(v.ok, false); assert.match(v.message, /請填寫：決定日期/)
  v = validateRecord('sdm', { at: '2026-09-01', leaning: '尚未決定', options: ['血液透析 HD', '不存在'] })
  assert.equal(v.ok, true); assert.deepEqual(v.data.options, ['血液透析 HD'])
  v = validateRecord('note', { at: '9/1', cat: '衛教', content: 'x' })
  assert.equal(v.ok, false); assert.match(v.message, /日期格式/)
  assert.equal(validateRecord('bogus', {}).ok, false)
  assert.equal(recLine({ type: 'claimFix', action: '註銷(這筆不算,誤登或已核刪)', code: 'P3403C Pre-ESRD 追蹤' }), '註銷 · P3403C')
  assert.equal(recLine({ type: 'noEnroll', reason: '檢驗收集困難' }), '檢驗收集困難 · 長期排除')
})

test('CRUD：新增／修改／軟刪除／列表排序（when 新→舊）', () => {
  const db = tempDb()
  const a = createRecord(db, { mrn: '1', name: 'A', type: 'note', data: { at: '2026-09-01', cat: '衛教', content: '第一筆' }, user })
  const b = createRecord(db, { mrn: '1', name: 'A', type: 'note', data: { at: '2026-09-10', cat: '電話追蹤', content: '第二筆' }, user })
  assert.equal(a.createdBy.name, '個管師'); assert.equal(a.content, '第一筆')
  let list = listRecords(db, { mrn: '1' })
  assert.deepEqual(list.map((r) => r.content), ['第二筆', '第一筆'])
  const u = updateRecord(db, a.id, { data: { at: '2026-09-20', cat: '衛教', content: '改過' }, user })
  assert.equal(u.content, '改過'); assert.equal(listRecords(db, { mrn: '1' })[0].id, a.id, '改日期後排序跟著變')
  assert.throws(() => updateRecord(db, a.id, { data: { at: '2026-09-20', cat: '衛教' }, user }), /請填寫：內容/)
  deleteRecord(db, b.id, user)
  list = listRecords(db, { mrn: '1' })
  assert.equal(list.length, 1); assert.equal(updateRecord(db, b.id, { data: {}, user }), null, '已刪除的不能改')
  assert.equal(lookupName(db, '1'), 'A')
  assert.deepEqual(searchPatients(db, 'A'), [{ mrn: '1', name: 'A' }])
  // 統計條：已刪除不算；SDM 待追 = 有 followUp 且未決定；通路人數以人計
  createRecord(db, { mrn: '2', name: 'B', type: 'sdm', data: { at: '2026-09-02', leaning: '尚未決定', followUp: '下次問家屬' }, user })
  createRecord(db, { mrn: '2', name: 'B', type: 'sdm', data: { at: '2026-09-03', leaning: '血液透析 HD', decided: '是,已決定', followUp: '安排通路' }, user })
  createRecord(db, { mrn: '2', name: 'B', type: 'access', data: { accessType: 'AVF 自體動靜脈廔管', status: '規劃中' }, user })
  createRecord(db, { mrn: '2', name: 'B', type: 'access', data: { accessType: 'AVG 人工血管', status: '已轉介手術' }, user })
  const st = recordStats(db)
  assert.equal(st.total, 5); assert.equal(st.byType.note, 1); assert.equal(st.byType.sdm, 2)
  assert.equal(st.accessPersons, 1); assert.equal(st.sdmFollow, 1)
})

test('掛鉤：不予收案（含暫緩過期）、外院查核、收案更正、P 碼補登／註銷 進入判讀', () => {
  const recs = [
    { id: 'r1', type: 'noEnroll', mrn: '2', at: '2026-09-01', reason: '住在機構難以追蹤', until: '', created: '2026-09-01' },
    { id: 'r2', type: 'noEnroll', mrn: '3', at: '2026-05-01', reason: '檢驗收集困難', until: '2026-08-01', created: '2026-05-01' },
    { id: 'r3', type: 'extEnroll', mrn: '4', at: '2026-09-02', result: '已於他院收案', hospital: 'X 醫院', created: '2026-09-02' },
    { id: 'r4', type: 'enrollFix', mrn: '5', at: '2026-09-03', state: '已收案 — 檔案未反映,請納入追蹤', prog: 'Pre-ESRD', enrollDate: '2026-03-01', lastVisit: '2026-06-01', created: '2026-09-03' },
    { id: 'r5', type: 'claimFix', mrn: '1', at: '2026-05-01', action: '補登(確實有申報,檔案沒抓到)', code: 'P3403C Pre-ESRD 追蹤', doctor: '王', created: '2026-09-04' },
    { id: 'r6', type: 'claimFix', mrn: '1', at: '2026-06-20', action: '註銷(這筆不算,誤登或已核刪)', code: 'P3403C Pre-ESRD 追蹤', created: '2026-09-04' },
    { id: 'r7', type: 'enrollFix', mrn: '6', at: '2026-09-03', state: '未收案 — 取消收案或誤判,請退回評估', created: '2026-09-03' },
  ]
  const hooks = makeHooks(recs)
  const C = makeCfg(DEFAULT_SETTINGS, TODAY)
  assert.ok(hooks.noEnrollOf('2', C.date)); assert.equal(hooks.noEnrollOf('3', C.date), null, '暫緩至 8/1 已過 → 恢復評估')
  assert.equal(hooks.extEnrollOf('4').hospital, 'X 醫院')
  assert.deepEqual(hooks.claimFixesOf('1').map((f) => f.action), ['add', 'void'])
  assert.equal(hooks.enrollFixOf('5').on, true); assert.equal(hooks.enrollFixOf('6').on, false)
  const cases = [
    caseRow({ mrn: '1', visit: d('2025-10-01'), ctype: '新收案', enroll: d('2025-10-01') }),
    caseRow({ mrn: '1', visit: d('2026-06-20'), ctype: '追蹤', code: 'P3403C', enroll: d('2025-10-01') }),   // 被註銷
    caseRow({ mrn: '6', visit: d('2026-06-01'), ctype: '追蹤', code: 'P3403C', enroll: d('2025-10-01') }),   // enrollFix 未收案 → 退回 B
  ]
  const clinic = [clinicRow({ mrn: '1' }), clinicRow({ mrn: '2', no: '2' }), clinicRow({ mrn: '4', no: '4' }), clinicRow({ mrn: '5', no: '5' }), clinicRow({ mrn: '6', no: '6' })]
  const labs = [labRow({ mrn: '4', no: '4|2026-09-01|B', v: { egfr: 22 } })]
  const records = recs.map((r) => ({ ...r, deleted: false }))
  const R = analyze({ cases, clinic, labs, billing: [], records, manual: [] }, C, { hooks })
  const A1 = R.A.find((a) => a.mrn === '1')
  assert.equal(A1.last.src, 'fix'); assert.equal(A1.gap, 138, '6/20 註銷後最後照護 = 補登的 5/01；5/01→9/16 = 138')
  assert.ok(R.A.find((a) => a.mrn === '5'), 'enrollFix 已收案 → 進 A')
  assert.equal(R.A.find((a) => a.mrn === '5').code, 'P3403C')
  const B = Object.fromEntries(R.B.map((b) => [b.p.mrn, b]))
  assert.ok(B['2'].noEn, '不予收案標記'); assert.match(B['2'].why[0], /個管標記不予收案/)
  assert.ok(B['6'], 'enrollFix 未收案 → 退回收案評估'); assert.equal(B['6'].enrollFix.on, false)
  assert.equal(R.B[R.B.length - 1].p.mrn, '2', '不予收案排最後')
  // P 碼總覽：註銷列標 voided、補登來源
  const t = pcodeTimeline({ cases, billing: [] }, '1', C, hooks)
  assert.equal(t.rows.find((r) => r.code === 'P3403C' && r.src.includes('登錄')).voided, true)
  assert.ok(t.rows.some((r) => r.src.includes('手動補登')))
  assert.equal(t.stat.total, 2); assert.equal(t.stat.thisYear, 1)
})
