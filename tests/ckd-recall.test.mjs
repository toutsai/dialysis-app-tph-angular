// 門診 CKD：召回工作清單（buildRecall）回歸測試（合成資料；規則照交接包 recall.js:12-45）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyze, makeCfg } from '../src/services/ckd/engine.js'
import { makeHooks } from '../src/services/ckd/records.js'
import { buildRecall, RECALL_STOP } from '../src/services/ckd/recall.js'

const d = (s) => new Date(s + 'T00:00:00')
const TODAY = '2026-09-16'
const SET = { dept: '腎臟內科' }

const caseRow = (o) => ({ src: 'case', mrn: '1', visit: null, code: 'P3403C', ctype: '追蹤', name: '甲', prog: 'pre', cat: 'Pre-ESRD', dm: false, enroll: d('2023-01-01'), egfr: 30, egfrMdrd: null, stage: 'G3b', doctor: '王', nextDue: null, reenroll: false, serial: '', gapDays: null, closed: false, closeDate: null, reason: '', price: null, sex: '男', id: '', age: 70, cr: null, upcr: null, uacr: null, ...o })
const clinicRow = (o) => ({ mrn: '1', name: '甲', id: '', sex: '男', birth: null, age: 70, date: d(TODAY), half: '上午', dept: '腎臟內科', room: '', doctor: '王', no: '1', state: '', revisit: '', pCKD: '', pPRE: '', pDM: '', manual: false, ...o })
const rec = (o) => ({ id: 'r', type: 'contact', mrn: '1', name: '', created: '2026-09-10 10:00:00', updated: '2026-09-10 10:00:00', deleted: false, ...o })

/** 七位病人：不同 gap ＋ 未來掛號／聯絡紀錄 */
function fixture(extra = {}) {
  const cases = [
    caseRow({ mrn: '1', visit: d('2024-01-01') }),                    // gap 989 → close
    caseRow({ mrn: '2', visit: d('2026-06-01') }),                    // gap 107 = need 77 + 寬限 30 → grace
    caseRow({ mrn: '3', visit: d('2026-05-01') }),                    // gap 138 → call
    caseRow({ mrn: '4', visit: d('2026-05-01') }),                    // 本科未來掛號 → appt
    caseRow({ mrn: '5', visit: d('2026-05-01') }),                    // 只有他科未來掛號 → 仍是 call
    caseRow({ mrn: '6', visit: d('2026-05-01') }),                    // 暫緩中 → hold
    caseRow({ mrn: '7', visit: d('2026-09-10') }),                    // gap 6 → status wait，不進召回
  ]
  const clinic = [
    clinicRow({ mrn: '4', date: d('2026-10-20'), dept: '腎臟內科', doctor: '王' }),
    clinicRow({ mrn: '4', date: d('2026-10-05'), dept: '腎臟內科', doctor: '李' }),   // 同為本科取最早
    clinicRow({ mrn: '4', date: d('2026-09-20'), dept: '心臟內科', doctor: '陳' }),   // 他科不取代本科
    clinicRow({ mrn: '5', date: d('2026-10-01'), dept: '心臟內科', doctor: '陳' }),
    clinicRow({ mrn: '9', date: d('2026-09-18'), dept: '腎臟內科', doctor: '王', state: '退掛' }),
  ]
  const records = [rec({ id: 'c6', mrn: '6', at: '2026-09-10', result: '改期再聯絡', until: '2026-10-01' })]
  return { cases, clinic, labs: [], billing: [], records, manual: [], ...extra }
}

function run(data, grace = 30) {
  const C = makeCfg(SET, TODAY)
  const hooks = makeHooks(data.records)
  const R = analyze(data, C, { doctorSel: '', withAudit: true, hooks })
  return { RC: buildRecall(data, R, C, hooks, grace), R, C }
}

test('五桶優先序：appt（只認本科）> hold > close(>365) > grace > call；wait 不進母體', () => {
  const data = fixture()
  const { RC } = run(data)
  const by = Object.fromEntries(RC.rows.map((r) => [r.mrn, r]))
  assert.equal(RC.rows.length, 6, '7 人中 status wait 的那位不進召回')
  assert.equal(by['7'], undefined)
  assert.equal(by['1'].bucket, 'close'); assert.equal(by['1'].gap, 989)
  assert.equal(by['2'].bucket, 'grace'); assert.equal(by['2'].gap, 107)
  assert.equal(by['3'].bucket, 'call')
  assert.equal(by['4'].bucket, 'appt')
  assert.equal(by['5'].bucket, 'call', '他科未來掛號不算已預約')
  assert.equal(by['5'].appt.inDept, false, '他科掛號仍會顯示')
  assert.equal(by['6'].bucket, 'hold')
  assert.deepEqual(RC.tally, { call: 2, grace: 1, appt: 1, hold: 1, close: 1 })
})

test('未來掛號取代規則：本科優先、同科取最早；退掛/取消/作廢與過去掛號略過', () => {
  const { RC } = run(fixture())
  const r4 = RC.rows.find((r) => r.mrn === '4')
  assert.equal(r4.appt.dept, '腎臟內科')
  assert.equal(r4.appt.doctor, '李', '本科兩筆取較早的 10/05')
  assert.ok(!RC.rows.some((r) => r.mrn === '9'), '退掛者本來就不在登錄簿母體')
})

test('close(>365) 優先於 grace：即使在寬限內也一律應結案', () => {
  const data = fixture()
  const { RC } = run(data, 9999)          // 寬限拉到極大：仍應是 close
  assert.equal(RC.rows.find((r) => r.mrn === '1').bucket, 'close')
  assert.equal(RC.rows.find((r) => r.mrn === '3').bucket, 'grace', '寬限變大 → call 變 grace')
})

test('聯絡紀錄：約定回診日（今天含以後）→ appt；RECALL_STOP 結果一年內 → hold，超過一年回到待聯絡', () => {
  const stop = (o) => rec({ id: 'x', mrn: '3', result: '失聯(電話錯誤)', ...o })
  const a = fixture({ records: [rec({ id: 'c3', mrn: '3', at: '2026-09-01', result: '已約回診', apptDate: TODAY })] })
  assert.equal(run(a).RC.rows.find((r) => r.mrn === '3').bucket, 'appt')
  const b = fixture({ records: [stop({ at: '2026-09-01' })] })
  const rb = run(b).RC.rows.find((r) => r.mrn === '3')
  assert.equal(rb.bucket, 'hold'); assert.equal(rb.stopped, true)
  const c = fixture({ records: [stop({ at: '2025-01-01' })] })     // 逾 365 天
  const rc = run(c).RC.rows.find((r) => r.mrn === '3')
  assert.equal(rc.bucket, 'call'); assert.equal(rc.stopped, false)
  assert.ok(RECALL_STOP.test('往生') && !RECALL_STOP.test('未接/再試'))
})

test('排序：逾期天數大→小，同天數時病歷號字典序；不 mutate 資料集', () => {
  const data = fixture()
  const clinicBefore = data.clinic.slice()
  const { RC } = run(data)
  assert.deepEqual(RC.rows.map((r) => r.mrn), ['1', '3', '4', '5', '6', '2'])
  assert.deepEqual(data.clinic, clinicBefore, 'data.clinic 順序未被改動')
})
