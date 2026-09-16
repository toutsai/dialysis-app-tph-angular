// 門診 CKD：月報儀表板（buildReport）回歸測試（合成資料；規則照 report.js 逐字）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeCfg } from '../src/services/ckd/engine.js'
import { buildReport } from '../src/services/ckd/report.js'

const d = (s) => new Date(s + 'T00:00:00')
const TODAY = '2026-09-16'
const C = () => makeCfg({}, TODAY)
const aud = (o) => ({ mrn: '1', prog: 'early', isDM: false, dkd: false, stage: 'G2', gap: null, need: 161, tenure: null, ann: { ok: false }, labOk: false, lab: null, alerts: [], egfr: null, caseDoctor: '', enroll: null, ...o })
const caseRow = (o) => ({ src: 'case', mrn: '1', ctype: '追蹤', enroll: null, visit: null, reason: '', ...o })
const billRow = (o) => ({ mrn: '1', code: '', codeName: '', doctor: '', price: 0, n: 1, visit: null, ...o })
const base = (extra = {}) => ({ cases: [], clinic: [], labs: [], billing: [], records: [], ...extra })

test('收案現況：pre/early/dm 計數（early 含 DKD 開放段）；stageCnt', () => {
  const AUD = [
    aud({ mrn: '1', prog: 'pre', stage: 'G4' }),
    aud({ mrn: '2', prog: 'pre', isDM: true, stage: 'G4' }),
    aud({ mrn: '3', prog: 'early', stage: 'G3a' }),
    aud({ mrn: '4', prog: 'early', isDM: true, stage: 'G2' }),
    aud({ mrn: '5', prog: 'early', isDM: true, dkd: true, stage: 'G3a' }),
  ]
  const r = buildReport(base(), { AUD }, C(), {})
  assert.equal(r.pre, 2); assert.equal(r.early, 3, 'early = prog!=="pre"，含 DKD 開放段'); assert.equal(r.dm, 3)
  assert.deepEqual(r.stageCnt, { G4: 2, G3a: 2, G2: 1 })
})

test('登錄簿：本月新收(月/年)、結案分類(closeKind)，且只計本月(ym)的結案/新收', () => {
  const cases = [
    caseRow({ mrn: '1', ctype: '新收案', enroll: d('2026-09-05') }),
    caseRow({ mrn: '6', ctype: '新收案', enroll: d('2026-08-01') }),
    caseRow({ mrn: '2', ctype: '結案', visit: d('2026-09-10'), reason: '已洗腎' }),
    caseRow({ mrn: '3', ctype: '結案', visit: d('2026-09-12'), reason: '轉他院' }),
    caseRow({ mrn: '4', ctype: '結案', visit: d('2025-01-01'), reason: '死亡' }),   // 不同月不算
  ]
  const r = buildReport(base({ cases }), { AUD: [] }, C(), { ym: '2026-09' })
  assert.equal(r.newM, 1); assert.equal(r.newY, 2, '本年內新收(含 8 月)')
  assert.equal(r.closeMn, 2)
  assert.deepEqual(r.closeM, { dialysis: 1, transfer: 1 })
})

test('追蹤品質：onTime/over180/over365/noGap；grace 由呼叫端注入(非讀 localStorage)', () => {
  const AUD = [
    aud({ mrn: '1', gap: 70, need: 77 }),      // 70<=77+30 → onTime
    aud({ mrn: '2', gap: 200, need: 77 }),     // over180
    aud({ mrn: '3', gap: 400, need: 161 }),    // over180 且 over365
    aud({ mrn: '4', gap: null }),              // noGap
  ]
  let r = buildReport(base(), { AUD }, C(), { grace: 30 })
  assert.equal(r.onTime, 1); assert.equal(r.over180, 2); assert.equal(r.over365, 1); assert.equal(r.noGap, 1)
  assert.equal(r.grace, 30)
  r = buildReport(base(), { AUD }, C(), { grace: 130 })
  assert.equal(r.onTime, 2, 'grace 加大後 mrn2(gap200,need77) 也變成 onTime(200<=77+130)')
})

test('年度評估：annDue(滿一年且 pre 或 DM)、annDone(近12月已申報P3404C/P7002C)、annReady', () => {
  const AUD = [
    aud({ mrn: '1', prog: 'pre', tenure: 400, ann: { ok: true } }),
    aud({ mrn: '2', prog: 'pre', isDM: true, tenure: 500 }),
    aud({ mrn: '3', prog: 'early', isDM: true, tenure: 400 }),
    aud({ mrn: '4', prog: 'early', isDM: false, tenure: 400 }),   // 非 pre 非 DM → 不算 annDue
    aud({ mrn: '5', prog: 'pre', tenure: 100 }),                   // 未滿一年
  ]
  const billing = [
    billRow({ mrn: '1', code: 'P3404C', visit: d('2026-08-01') }),   // 近一年內
    billRow({ mrn: '3', code: 'P7002C', visit: d('2020-01-01') }),   // 太舊不算
  ]
  const r = buildReport(base({ billing }), { AUD }, C(), {})
  assert.equal(r.annDue, 3, 'mrn1,2,3 滿一年且屬 pre 或 DM')
  assert.equal(r.annDone, 1, '只有 mrn1 近一年已申報')
  assert.equal(r.annReady, 1, 'ann.ok 僅 mrn1')
})

test('檢驗完整率：labOk、eg90(3個月內eGFR報告)、prot180(6個月內UPCR/UACR，來自 data.labs)', () => {
  const AUD = [
    aud({ mrn: '1', labOk: true, lab: { v: { egfr: 24 }, date: d('2026-09-01') } }),   // 15 天內
    aud({ mrn: '2', labOk: true, lab: { v: { egfr: 50 }, date: d('2025-01-01') } }),   // 逾 90 天
    aud({ mrn: '3', labOk: false }),
  ]
  const labs = [{ mrn: '2', date: d('2026-08-01'), v: { upcr: 300 } }]   // 46 天內
  const r = buildReport(base({ labs }), { AUD }, C(), {})
  assert.equal(r.labOk, 2); assert.equal(r.eg90, 1); assert.equal(r.prot180, 1)
})

test('獎勵候選：alerts 內 t=獎勵 者計數；訊息含 P340[6-9]C 才歸該碼，否則歸「其他」', () => {
  const AUD = [
    aud({ mrn: '1', alerts: [{ t: '獎勵', m: 'eGFR 年變化優於門檻,可評估 P3406C 1,500 點' }] }),
    aud({ mrn: '2', alerts: [{ t: '獎勵', m: '收案已滿 3 年,若已完成 3 次 P3404C,可評估 P3409C' }] }),
    aud({ mrn: '3', alerts: [{ t: '注意', m: '其他提醒' }] }),
  ]
  const r = buildReport(base(), { AUD }, C(), {})
  assert.equal(r.reward, 2)
  assert.deepEqual(r.rewardCodes, { P3406C: 1, P3409C: 1 })
})

test('透析準備門檻連動 settings.rrtEgfr（刻意差異,非寫死20）；hasSdm/hasAcc 依 low 母體計算', () => {
  const AUD = [aud({ mrn: '1', egfr: 18 }), aud({ mrn: '2', egfr: 22 })]
  const records = [{ type: 'sdm', mrn: '1', deleted: false }, { type: 'access', mrn: '2', deleted: false }]
  let r = buildReport(base({ records }), { AUD }, C(), { rrtEgfr: 20 })
  assert.equal(r.rrtEgfr, 20); assert.equal(r.low, 1); assert.equal(r.hasSdm, 1)
  assert.equal(r.hasAcc, 0, 'mrn2 egfr22 不在 low 母體,access 不算')
  r = buildReport(base({ records }), { AUD }, C(), { rrtEgfr: 25 })
  assert.equal(r.low, 2, '門檻拉高到 25 後 mrn2 也算 low'); assert.equal(r.hasAcc, 1)
})

test('本月入帳：依代碼彙總 n/pts/people，僅計本月(ym)；billTot 為總點數', () => {
  const billing = [
    billRow({ mrn: '1', code: 'P3403C', codeName: 'Pre追蹤', visit: d('2026-09-05'), price: 600, n: 1 }),
    billRow({ mrn: '2', code: 'P4302C', codeName: 'Early追蹤', visit: d('2026-09-06'), price: 200, n: 1 }),
    billRow({ mrn: '2', code: 'P4302C', codeName: 'Early追蹤', visit: d('2026-09-10'), price: 200, n: 1 }),
    billRow({ mrn: '3', code: 'P3403C', codeName: 'Pre追蹤', visit: d('2026-08-20'), price: 600, n: 1 }),   // 非本月
  ]
  const r = buildReport(base({ billing }), { AUD: [] }, C(), { ym: '2026-09' })
  assert.deepEqual(r.billRows.map((x) => [x.code, x.n, x.pts, x.people]), [['P3403C', 1, 600, 1], ['P4302C', 2, 400, 1]])
  assert.equal(r.billTot, 1000); assert.equal(r.billN, 3); assert.equal(r.billPeople, 2)
})

test('Early-CKD KPI：第四季新收案排除、need 依新收季別為 2/1(逾一年為2)、依醫師分組；DKD/Pre 不計入母體', () => {
  const AUD = [
    aud({ mrn: '1', prog: 'early', dkd: false, enroll: d('2026-02-01'), caseDoctor: '李' }),   // 今年Q1新收 → need2；2次billing → ok
    aud({ mrn: '2', prog: 'early', dkd: false, enroll: d('2026-05-01'), caseDoctor: '李' }),   // 今年Q2新收 → need1；無billing → not ok
    aud({ mrn: '3', prog: 'early', dkd: false, enroll: d('2025-01-01'), caseDoctor: '陳' }),   // 去年收案(非本年新收) → need2
    aud({ mrn: '4', prog: 'early', dkd: false, enroll: d('2026-11-01'), caseDoctor: '陳' }),   // 今年Q4新收 → 排除
    aud({ mrn: '5', prog: 'pre' }),                                                             // 非 early → 不計
    aud({ mrn: '6', prog: 'early', dkd: true, enroll: d('2026-02-01') }),                       // DKD → 不計
  ]
  const billing = [
    billRow({ mrn: '1', code: 'P4302C', visit: d('2026-03-01') }),
    billRow({ mrn: '1', code: 'P4302C', visit: d('2026-06-01') }),
    billRow({ mrn: '3', code: 'P4302C', visit: d('2026-04-01') }),
  ]
  const r = buildReport(base({ billing }), { AUD }, C(), {})
  assert.equal(r.kpi.n, 3, 'mrn1,2,3；mrn4 Q4排除、mrn5非early、mrn6 DKD排除')
  assert.equal(r.kpi.ok, 1, '僅 mrn1 達標(2次)')
  const docs = Object.fromEntries(r.kpi.docs.map((x) => [x.doc, [x.n, x.ok]]))
  assert.deepEqual(docs, { 李: [2, 1], 陳: [1, 0] })
})

test('ym 不給時預設為判讀日所在月；recallTally 由呼叫端直接透傳(未給時為 null)', () => {
  const tally = { call: 1, grace: 0, appt: 0, hold: 0, close: 0 }
  const r = buildReport(base(), { AUD: [] }, C(), { recallTally: tally })
  assert.equal(r.ym, '2026-09')
  assert.deepEqual(r.recall, tally)
  const r2 = buildReport(base(), { AUD: [] }, C(), {})
  assert.equal(r2.recall, null)
})
