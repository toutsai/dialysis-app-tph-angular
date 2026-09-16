// 門診 CKD：檢核 P 碼輸入（buildPcheck）回歸測試（合成資料；規則照 pcheck.js 逐字）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildPcheck } from '../src/services/ckd/pcheck.js'
import { makeHooks } from '../src/services/ckd/records.js'
import { DEFAULT_SETTINGS } from '../src/services/ckd/settings.js'

const TODAY = '2026-09-16'
const d = (s) => new Date(s + 'T00:00:00')
const caseRow = (o) => ({ src: 'case', mrn: '1', visit: null, code: '', ctype: '追蹤', name: 'A', prog: 'pre', cat: 'Pre-ESRD', dm: false, enroll: null, egfr: null, egfrMdrd: null, stage: null, doctor: '王', nextDue: null, reenroll: false, serial: '', gapDays: null, closed: false, closeDate: null, reason: '', price: null, sex: '', id: '', age: null, cr: null, upcr: null, uacr: null, ...o })
const clinicRow = (o) => ({ mrn: '1', name: 'A', id: '', sex: '男', birth: d('1950-01-01'), age: 76, date: d(TODAY), half: '上午', dept: '腎臟內科', room: '', doctor: '王', no: '5', state: '', revisit: '', pCKD: '', pPRE: '', pDM: '', manual: false, ...o })
const labRow = (o) => ({ mrn: '1', name: 'A', date: d('2026-09-01'), spec: 'B', kind: '生化', no: '1|2026-09-01|B', v: {}, flag: {}, q: {}, src: 'lab', ...o })
const billRow = (o) => ({ mrn: '1', visit: null, code: '', name: '', doctor: '', price: null, n: 1, ...o })

/** A：p1 ok / p2 miss / p4 early(未到期即入帳) / p5 none / p6 DKD收案卻入帳追蹤碼(覆寫early)
 *  B：p7 new / p8 unexp / p9 cand(預設) / p9b cand(曾收案已結案) / p9c cand(他院收案不可收) / p10 none
 *  X：p11 名單外入帳 extra */
function bigFixture() {
  const cases = [
    caseRow({ mrn: 'p1', visit: d('2025-01-01'), ctype: '新收案', enroll: d('2025-01-01') }),
    caseRow({ mrn: 'p1', visit: d('2026-07-01'), ctype: '追蹤', code: 'P3403C', enroll: d('2025-01-01') }),
    caseRow({ mrn: 'p2', visit: d('2025-01-01'), ctype: '新收案', enroll: d('2025-01-01') }),
    caseRow({ mrn: 'p2', visit: d('2026-07-01'), ctype: '追蹤', code: 'P3403C', enroll: d('2025-01-01') }),
    caseRow({ mrn: 'p4', visit: d('2025-01-01'), ctype: '新收案', enroll: d('2025-01-01') }),
    caseRow({ mrn: 'p4', visit: d('2026-08-20'), ctype: '追蹤', code: 'P3403C', enroll: d('2025-01-01') }),
    caseRow({ mrn: 'p5', visit: d('2025-01-01'), ctype: '新收案', enroll: d('2025-01-01') }),
    caseRow({ mrn: 'p5', visit: d('2026-08-20'), ctype: '追蹤', code: 'P3403C', enroll: d('2025-01-01') }),
    caseRow({ mrn: 'p6', visit: d('2026-01-01'), ctype: '追蹤', code: 'P7001C', prog: 'early', cat: 'DKD', dm: true, enroll: d('2026-01-01'), closed: false }),
    caseRow({ mrn: 'p9b', visit: d('2025-01-01'), ctype: '新收案', closed: true }),
    caseRow({ mrn: 'p9b', visit: d('2025-06-01'), ctype: '結案', closed: true, reason: '轉他院' }),
  ]
  const clinic = ['p1', 'p2', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p9b', 'p9c', 'p10'].map((mrn, i) => clinicRow({ mrn, no: String(i + 1) }))
  const labs = [
    labRow({ mrn: 'p9', v: { egfr: 22 } }),
    labRow({ mrn: 'p9b', v: { egfr: 22 } }),
    labRow({ mrn: 'p9c', v: { egfr: 22 } }),
    labRow({ mrn: 'p10', v: { egfr: 70 } }),
    labRow({ mrn: 'p10', no: 'u', spec: 'U', v: { upcr: 100 } }),
  ]
  const billing = [
    billRow({ mrn: 'p1', visit: d(TODAY), code: 'P3403C' }),
    billRow({ mrn: 'p4', visit: d(TODAY), code: 'P3403C' }),
    billRow({ mrn: 'p6', visit: d(TODAY), code: 'P7001C' }),
    billRow({ mrn: 'p7', visit: d(TODAY), code: 'P4301C' }),
    billRow({ mrn: 'p8', visit: d(TODAY), code: 'P4302C' }),
    billRow({ mrn: 'p11', visit: d(TODAY), code: 'P3403C', name: '某某' }),
  ]
  const records = [
    { id: 'e1', type: 'extEnroll', mrn: 'p9c', at: '2026-09-01', result: '已於他院收案', hospital: 'X', created: '2026-09-01 00:00:00', deleted: false },
  ]
  return { cases, clinic, labs, billing, records, manual: [] }
}

function run(data, opts = {}) {
  const hooks = makeHooks(data.records)
  return buildPcheck(data, DEFAULT_SETTINGS, { date: TODAY, doctorSel: '', hooks, ...opts })
}

test('A 區：ok/miss/early(未到期即入帳)/none；DKD 收案卻入帳追蹤碼覆寫為 early', () => {
  const R = run(bigFixture())
  const by = Object.fromEntries(R.rows.filter((r) => r.kind === 'A').map((r) => [r.mrn, r]))
  assert.equal(by.p1.res, 'ok')
  assert.equal(by.p2.res, 'miss'); assert.match(by.p2.note, /當時缺 \d+ 項檢驗|可追蹤但當日無入帳/)
  assert.equal(by.p4.res, 'early'); assert.match(by.p4.note, /未到期\(尚差 \d+ 天\)即入帳/)
  assert.equal(by.p5.res, 'none'); assert.equal(by.p5.note, '未到期,不需入帳')
  assert.equal(by.p6.res, 'early'); assert.equal(by.p6.note, 'DKD 收案卻入帳 Early-CKD/追蹤碼:核對是否誤 key')
})

test('B 區：new/unexp/cand(預設訊息/曾收案已結案可重收/他院收案不可收)/none', () => {
  const R = run(bigFixture())
  const by = Object.fromEntries(R.rows.filter((r) => r.kind === 'B').map((r) => [r.mrn, r]))
  assert.equal(by.p7.res, 'new')
  assert.equal(by.p8.res, 'unexp')
  assert.equal(by.p9.res, 'cand'); assert.equal(by.p9.note, '符合條件未收案:確認 VPN 查核與醫師意願')
  assert.equal(by.p9b.res, 'cand'); assert.equal(by.p9b.note, '曾收案已結案,可重收未收')
  assert.equal(by.p9c.res, 'cand'); assert.equal(by.p9c.note, '他院收案,不可收', '修正原版死碼:改用 hooks.extEnrollOf(p.mrn)?.result')
  assert.equal(by.p10.res, 'none'); assert.equal(by.p10.note, '不符條件')
})

test('X：名單外入帳歸 extra；pri 排序非遞減；issues 與 A/B 統計正確', () => {
  const R = run(bigFixture())
  const extra = R.extra.find((r) => r.mrn === 'p11')
  assert.ok(extra); assert.equal(extra.res, 'extra'); assert.equal(extra.kind, 'X'); assert.equal(extra.note, '不在此診次名單(別的診/他科)')
  assert.ok(!R.rows.some((r) => r.mrn === 'p11'), 'extra 是獨立陣列，不併入 rows')
  const PRI = { miss: 0, unexp: 0, early: 1, cand: 2, extra: 3, new: 4, ok: 5, nobill: 6, none: 7 }
  const seenPri = R.rows.map((r) => PRI[r.res])
  assert.deepEqual(seenPri, [...seenPri].sort((a, b) => a - b), 'rows 依 pri 由小到大排序(非遞減)')
  assert.equal(R.issues, 1 + 1 + 2 + 3, 'miss(1)+unexp(1)+early(2:p4,p6)+cand(3:p9,p9b,p9c)')
  assert.deepEqual(R.A, { total: 5, ok: 1, miss: 1, early: 2, none: 1 })
  assert.deepEqual(R.B, { total: 6, new: 1, cand: 3, unexp: 1 })
})

test('billed=false(此日尚無任何入帳)：可入帳者(A/B)全部落為 nobill；不 mutate data.billing', () => {
  const cases = [
    caseRow({ mrn: 'qa', visit: d('2025-01-01'), ctype: '新收案', enroll: d('2025-01-01') }),
    caseRow({ mrn: 'qa', visit: d('2026-07-01'), ctype: '追蹤', code: 'P3403C', enroll: d('2025-01-01') }),
  ]
  const clinic = [clinicRow({ mrn: 'qa', no: '1' }), clinicRow({ mrn: 'qb', no: '2' })]
  const labs = [labRow({ mrn: 'qb', v: { egfr: 22 } })]
  const data = { cases, clinic, labs, billing: [], records: [], manual: [] }
  const R = run(data)
  assert.equal(R.billed, false)
  assert.equal(R.rows.find((r) => r.mrn === 'qa').res, 'nobill')
  assert.equal(R.rows.find((r) => r.mrn === 'qb').res, 'nobill')

  const big = bigFixture()
  const before = big.billing.map((b) => ({ ...b }))
  const beforeLen = big.billing.length
  run(big)
  assert.equal(big.billing.length, beforeLen, 'buildPcheck 不得增刪 data.billing 的元素')
  assert.deepEqual(big.billing, before, 'buildPcheck 不得 mutate data.billing 內容')
})
