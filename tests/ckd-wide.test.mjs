// 門診 CKD：檢驗總表（buildWide／wideRows／wideSheets）回歸測試（合成資料；規則照交接包 app.js:1391-1590）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWide, wideRows, wideSheets, wideTally, WIDE_LABS, WIDE_KEYS } from '../src/services/ckd/wide.js'
import { roc } from '../src/services/ckd/parsers.js'

const d = (s) => new Date(s + 'T00:00:00')
const caseRow = (o) => ({ src: 'case', mrn: '1', visit: null, code: '', ctype: '追蹤', name: 'A', prog: 'pre', cat: 'Pre-ESRD', dm: false, enroll: null, egfr: null, egfrMdrd: null, stage: null, doctor: '王', nextDue: null, reenroll: false, serial: '', gapDays: null, closed: false, closeDate: null, reason: '', price: null, sex: '', id: '', age: null, cr: null, upcr: null, uacr: null, ...o })
const clinicRow = (o) => ({ mrn: '1', name: 'A', id: '', sex: '男', birth: d('1950-01-01'), age: 76, date: d('2026-09-16'), half: '上午', dept: '腎臟內科', room: '', doctor: '王', no: '5', state: '', revisit: '', pCKD: '', pPRE: '', pDM: '', manual: false, ...o })
const labRow = (o) => ({ mrn: '1', name: 'A', date: d('2026-09-01'), spec: 'B', kind: '生化', no: '1|2026-09-01|B', v: {}, flag: {}, q: {}, src: 'lab', ...o })

test('21 項定義與分群', () => {
  assert.equal(WIDE_LABS.length, 21)
  assert.deepEqual(WIDE_KEYS.slice(0, 4), ['cr', 'egfr', 'bun', 'ua'])
  assert.deepEqual(WIDE_LABS.filter(x => x[3] === 'ele').map(x => x[0]), ['na', 'k', 'ca', 'phos', 'ipth', 'hco3'])
})

test('合併：同日血液＋尿液併一列、追蹤表先寫入、UPCR 補算、分期補推、最新值、方案推估、排序', () => {
  const cases = [
    caseRow({ visit: d('2026-01-10'), ctype: '新收案', enroll: d('2026-01-10'), egfr: 30, stage: 'G3b' }),
    caseRow({ visit: d('2026-09-01'), ctype: '追蹤', code: 'P3403C', enroll: d('2026-01-10'), egfr: 26 }),
    caseRow({ mrn: '2', name: 'B', visit: d('2026-05-01'), ctype: '新收案', enroll: d('2026-05-01'), egfr: 70 }),
    caseRow({ mrn: '3', name: 'C', visit: d('2026-02-01'), ctype: '新收案', enroll: d('2026-02-01'), closed: true }),
    caseRow({ mrn: '3', name: 'C', visit: d('2026-03-01'), ctype: '結案', closed: true, reason: '已洗腎' }),
  ]
  const labs = [
    labRow({ date: d('2026-09-01'), v: { cr: 2.5, egfr: 25.5, k: 5.6 }, flag: { k: 'H' } }),
    labRow({ no: 'u', date: d('2026-09-01'), spec: 'U', kind: '尿液', v: { uprot: 80, ucr: 100 } }),
    labRow({ mrn: '9', name: 'Z', date: d('2026-08-01'), v: { cr: 1.1, egfr: 65 } }),
  ]
  const W = buildWide({ cases, clinic: [clinicRow({ mrn: '2', name: 'B', no: '7' })], labs, billing: [], records: [], manual: [] })
  const byM = Object.fromEntries(W.map(p => [p.mrn, p]))
  const a = byM['1']
  assert.equal(a.n, 2, '1/10 追蹤表一列 + 9/01 三來源併一列')
  const r = a.rows[1]
  assert.equal(r.src, '追蹤表+生化+尿液')
  assert.equal(r.egfr, 26, '追蹤表先寫入，檢驗單 25.5 不覆蓋')
  assert.equal(r.cr, 2.5); assert.equal(r.k_f, 'H')
  assert.equal(r.upcr, 800); assert.equal(r.upcr_c, 1, 'U-Prot/U-Cr×1000 補算')
  assert.equal(a.rows[0].stage, 'G3b'); assert.equal(r.stage, 'G4', '無 stage 時由 egfr 推')
  assert.equal(a.latest.egfr, 26); assert.equal(a.latest.cr, 2.5); assert.equal(a.latest.upcr, 800)
  assert.equal(a.enrolled, true); assert.equal(a.prog, 'Pre-ESRD'); assert.equal(a.stage, 'G4')
  assert.equal(byM['2'].prog, 'Early-CKD'); assert.equal(byM['2'].inClinic, true); assert.equal(byM['2'].clinicNo, '7'); assert.equal(byM['2'].age, 76)
  assert.equal(byM['3'].enrolled, false); assert.equal(byM['3'].prog, '未收案'); assert.equal(byM['3'].labOnly, true, '已結案 → 未收案')
  assert.equal(byM['9'].labOnly, true, '名單外只有檢驗')
  assert.deepEqual(W.map(p => p.mrn), ['2', '1', '3', '9'], '明日門診先 → 已收案先 → mrn')
  // 範圍與搜尋
  assert.deepEqual(wideRows(W, 'clinic').map(p => p.mrn), ['2'])
  assert.deepEqual(wideRows(W, 'unlisted').map(p => p.mrn), ['3', '9'])
  assert.deepEqual(wideRows(W, 'enrolled').map(p => p.mrn), ['2', '1'])
  assert.deepEqual(wideRows(W, 'all', 'Z').map(p => p.mrn), ['9'])
  const t = wideTally(W)
  assert.equal(t.persons, 4); assert.equal(t.rows, 6); assert.equal(t.clinic, 1); assert.equal(t.unlisted, 2); assert.equal(t.noProt, 3)
})

test('eGFR 年變化率：最小平方法；<3 點或跨度 <180 天 → 不可靠', () => {
  const cases = [
    caseRow({ visit: d('2025-01-01'), ctype: '新收案', enroll: d('2025-01-01'), egfr: 40 }),
    caseRow({ visit: d('2025-07-02'), ctype: '追蹤', egfr: 37 }),
    caseRow({ visit: d('2026-01-01'), ctype: '追蹤', egfr: 34 }),
    caseRow({ mrn: '2', name: 'B', visit: d('2026-01-01'), ctype: '新收案', enroll: d('2026-01-01'), egfr: 50 }),
    caseRow({ mrn: '2', name: 'B', visit: d('2026-03-01'), ctype: '追蹤', egfr: 45 }),
  ]
  const W = buildWide({ cases, clinic: [], labs: [], billing: [], records: [], manual: [] })
  const a = W.find(p => p.mrn === '1'), b = W.find(p => p.mrn === '2')
  assert.equal(a.slN, 3); assert.equal(a.slWeak, false)
  assert.ok(Math.abs(a.slope - (-6)) < 0.2, `3 點一年掉 6 → 斜率約 -6（實得 ${a.slope}）`)
  assert.equal(b.slWeak, true, '2 點且 59 天 → 不可靠'); assert.ok(b.slope < 0)
  assert.equal(wideTally(W).slopeOk, 1)
  const { d1, d2 } = wideSheets(W, roc)
  assert.equal(d1[0].length, 10 + 21 + 5); assert.equal(d1[0][10], 'Cr(mg/dL)'); assert.equal(d1[0][11], 'eGFR(mL/min)')
  assert.equal(d1.length, 6); assert.equal(d1[1][7], '114/01/01'); assert.equal(d1[1][8], '追蹤表')
  assert.equal(d2[0].length, 13 + 21 + 2); assert.equal(d2[0][13], '最新 Cr')
  const row2 = d2.find(r => r[0] === '2')
  assert.equal(row2[11], '否'); assert.equal(row2[14], 45)
})
