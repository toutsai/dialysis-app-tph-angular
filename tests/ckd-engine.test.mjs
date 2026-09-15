// 門診 CKD：判定引擎回歸測試（純函式，合成資料；門檻與文字照交接包 app.js）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyze, makeCfg, sessionGroups, verdictA, verdictB, closeKind, closedByRows, mergedLabOf, deptMatch, OTHER_SESSION } from '../src/services/ckd/engine.js'
import { DEFAULT_SETTINGS } from '../src/services/ckd/settings.js'

const d = (s) => new Date(s + 'T00:00:00')
const TODAY = '2026-09-16'
const C = () => makeCfg(DEFAULT_SETTINGS, TODAY)
const caseRow = (o) => ({ src: 'case', mrn: '1', visit: null, code: '', ctype: '追蹤', name: 'A', prog: 'pre', cat: 'Pre-ESRD', dm: false, enroll: null, egfr: null, egfrMdrd: null, stage: null, doctor: '王', nextDue: null, reenroll: false, serial: '', gapDays: null, closed: false, closeDate: null, reason: '', price: null, sex: '', id: '', age: null, cr: null, upcr: null, uacr: null, ...o })
const clinicRow = (o) => ({ mrn: '1', name: 'A', id: '', sex: '男', birth: d('1950-01-01'), age: 76, date: d(TODAY), half: '上午', dept: '腎臟內科', room: '', doctor: '王', no: '5', state: '', revisit: '', pCKD: '', pPRE: '', pDM: '', manual: false, ...o })
const labRow = (o) => ({ mrn: '1', name: 'A', date: d('2026-09-01'), spec: 'B', kind: '生化', no: '1|2026-09-01|B', v: {}, flag: {}, q: {}, src: 'lab', ...o })
const data = (o) => ({ cases: [], clinic: [], labs: [], billing: [], records: [], manual: [], ...o })

test('helpers：deptMatch / closeKind / closedByRows / mergedLab UPCR 推算', () => {
  assert.equal(deptMatch('腎臟內科', '腎臟'), true)
  assert.equal(deptMatch('心臟內科', '腎臟內科、新陳代謝'), false)
  assert.equal(deptMatch('x', ''), true)
  assert.equal(closeKind('已洗腎'), 'dialysis'); assert.equal(closeKind('轉他院'), 'transfer'); assert.equal(closeKind('死亡'), 'dead'); assert.equal(closeKind('未執行超過一年'), 'lapse'); assert.equal(closeKind('其他'), 'other')
  const rows = [caseRow({ visit: d('2026-01-01'), ctype: '新收案', closed: true }), caseRow({ visit: d('2026-03-01'), ctype: '結案', closed: true })]
  assert.ok(closedByRows(rows, rows.filter(r => r.ctype !== '結案')), '無開放段且結案後無照護 → 結案列')
  assert.equal(closedByRows([...rows, caseRow({ visit: d('2026-05-01'), ctype: '追蹤', closed: false })], rows), null, '有開放段 → 未結案')
  const lab = mergedLabOf([labRow({ date: d('2026-08-01'), v: { cr: 2.0 } }), labRow({ no: 'x', date: d('2026-09-01'), spec: 'U', v: { uprot: 80, ucr: 100 } })])
  assert.equal(lab.v.upcr, 800); assert.equal(lab.calcUpcr, true); assert.equal(lab.v.cr, 2.0); assert.equal(lab.src, 2)
})

test('A：Pre-ESRD 已收案 — 滿 77 天可 key P3403C；未滿 → wait；>180 → over；年度評估需近 12 月 3 次', () => {
  const cases = [
    caseRow({ visit: d('2025-10-01'), ctype: '新收案', enroll: d('2025-10-01'), egfr: 28 }),
    caseRow({ visit: d('2026-01-10'), ctype: '追蹤', code: 'P3403C', enroll: d('2025-10-01') }),
    caseRow({ visit: d('2026-04-10'), ctype: '追蹤', code: 'P3403C', enroll: d('2025-10-01') }),
    caseRow({ visit: d('2026-06-20'), ctype: '追蹤', code: 'P3403C', enroll: d('2025-10-01'), stage: 'G4' }),
  ]
  const labs = [labRow({ v: { cr: 2.8, egfr: 24.5, hb: 10, bun: 40, ua: 7, na: 138, k: 4.5, ca: 9, phos: 4, alb: 4, tg: 120, ldl: 90 } }), labRow({ no: 'u', spec: 'U', kind: '尿液', v: { uprot: 50, ucr: 100, upcr: 500 } })]
  let R = analyze(data({ cases, clinic: [clinicRow()], labs }), C())
  assert.equal(R.A.length, 1); assert.equal(R.B.length, 0)
  const a = R.A[0]
  assert.equal(a.prog, 'pre'); assert.equal(a.code, 'P3403C'); assert.equal(a.need, 77)
  assert.equal(a.gap, 88); assert.equal(a.status, 'ok')
  assert.equal(a.egfr, 24.5); assert.equal(a.stage, 'G4'); assert.equal(a.src, '檢驗報告')
  assert.equal(a.n12, 3); assert.equal(a.ann.ok, true, '近 12 月 3 次追蹤且滿 77 天 → P3404C 可評估'); assert.equal(a.ann.code, 'P3404C')
  assert.ok(a.why.some(w => /已滿 P3403C 的 77 天間隔/.test(w)))
  assert.deepEqual(a.ord, [], '18 項只缺診間項目（血壓/身高/體重）→ 不算缺項'); assert.deepEqual(a.bed, ['血壓', '身高', '體重'])
  const box = verdictA(a, C())
  assert.equal(box.tone, 'y'); assert.ok(/今日可 key P3403C/.test(box.head)); assert.equal(box.act.lab, '另可 key')
  // 未滿間隔
  R = analyze(data({ cases: [...cases, caseRow({ visit: d('2026-08-20'), ctype: '追蹤', code: 'P3403C', enroll: d('2025-10-01') })], clinic: [clinicRow()], labs }), C())
  assert.equal(R.A[0].status, 'wait'); assert.ok(/最快 115\/11\/05/.test(verdictA(R.A[0], C()).head), '8/20 + 77 天 = 11/05')
  // 逾期（1/10 → 9/16 = 249 天 > 180）；未達 300 天不出 Q6-3
  R = analyze(data({ cases: cases.slice(0, 2), clinic: [clinicRow()], labs }), C())
  assert.equal(R.A[0].gap, 249); assert.equal(R.A[0].status, 'over'); assert.ok(!R.A[0].alerts.some(x => /Q6-3/.test(x.m)))
  assert.ok(/已逾 180 天未追蹤/.test(verdictA(R.A[0], C()).head))
  // ≥300 天 → Q6-3 將結案提醒；≥365 → 可能已主動結案
  R = analyze(data({ cases: cases.slice(0, 1), clinic: [clinicRow()], labs }), C())
  assert.equal(R.A[0].gap, 350); assert.ok(R.A[0].alerts.some(x => /Q6-3/.test(x.m) && x.t === '注意'))
})

test('A：Early-CKD 年度上限 2 次 → cap；DKD 開放段 → dkd 不評估；DM 但 Early 收案仍 P4302C', () => {
  const cases = [
    caseRow({ visit: d('2025-12-01'), ctype: '新收案', code: 'P4301C', prog: 'early', cat: 'Early-CKD', enroll: d('2025-12-01') }),
    caseRow({ visit: d('2026-01-05'), ctype: '追蹤', code: 'P4302C', prog: 'early', cat: 'Early-CKD', enroll: d('2025-12-01') }),
    caseRow({ visit: d('2026-03-25'), ctype: '追蹤', code: 'P4302C', prog: 'early', cat: 'Early-CKD', enroll: d('2025-12-01') }),
  ]
  let R = analyze(data({ cases, clinic: [clinicRow()] }), C())
  assert.equal(R.A[0].gap, 175, '3/25 → 9/16；≥161 未逾 180 → 本應 ok');
  assert.equal(R.A[0].status, 'cap'); assert.ok(/每年最多 2 次/.test(R.A[0].why[0]))
  assert.equal(verdictA(R.A[0], C()).head, '今日不可 key,年度已達上限')
  // 逾期優先於年度上限（cap 只在 ok 時判）
  R = analyze(data({ cases: [cases[0], cases[1], caseRow({ visit: d('2026-02-20'), ctype: '追蹤', code: 'P4302C', prog: 'early', cat: 'Early-CKD', enroll: d('2025-12-01') })], clinic: [clinicRow()] }), C())
  assert.equal(R.A[0].status, 'over')
  // DKD 唯一開放段
  R = analyze(data({ cases: [caseRow({ visit: d('2026-05-01'), ctype: '追蹤', code: 'P7001C', prog: 'early', cat: 'DKD', dm: true, enroll: d('2026-01-01') })], clinic: [clinicRow()] }), C())
  assert.equal(R.A[0].status, 'dkd'); assert.equal(R.A[0].dkd, true); assert.ok(/DKD 方案收案/.test(verdictA(R.A[0], C()).head))
  // Early 收案 + 登錄簿另一列 DKD 已結案 → isDM 但用 P4302C
  R = analyze(data({ cases: [caseRow({ visit: d('2026-01-01'), ctype: '追蹤', code: 'P4302C', prog: 'early', cat: 'Early-CKD', enroll: d('2025-01-01') }), caseRow({ visit: d('2024-01-01'), ctype: '結案', cat: 'DKD', dm: true, closed: true, reason: '轉方案' })], clinic: [clinicRow()] }), C())
  assert.equal(R.A[0].code, 'P4302C'); assert.equal(R.A[0].isDM, true); assert.ok(R.A[0].why.some(w => /追蹤碼仍用 P4302C/.test(w)))
})

test('B：未收案判定 — pre / early(3a) / early(1-2 併蛋白尿) / check / nodata / no；結案原因決定可否重收', () => {
  const clinic = [clinicRow()]
  const run = (labs, extra = {}) => analyze(data({ clinic, labs, ...extra }), C()).B[0]
  let b = run([labRow({ v: { egfr: 22.0, cr: 3.0 } })])
  assert.equal(b.verdict, 'pre'); assert.equal(b.code, 'P3402C 1,200 點'); assert.equal(b.stage, 'G4'); assert.ok(/Stage 4/.test(b.why[0]))
  assert.equal(verdictB(b, null).head, '先查 VPN,無他院收案即可新收 P3402C 1,200 點')
  b = run([labRow({ v: { egfr: 50 } })])
  assert.equal(b.verdict, 'early'); assert.ok(/Stage 3a/.test(b.why[0]))
  b = run([labRow({ v: { egfr: 70 } }), labRow({ no: 'u', spec: 'U', v: { upcr: 200 } })])
  assert.equal(b.verdict, 'early'); assert.ok(/UPCR 200/.test(b.why[0]))
  b = run([labRow({ v: { egfr: 70 } }), labRow({ no: 'u', spec: 'U', v: { uacr: 40 } })])
  assert.equal(b.verdict, 'check', '非糖尿病人不得單以 UACR 收案'); assert.deepEqual(b.ord, ['UPCR'])
  b = run([labRow({ v: { egfr: 70 } }), labRow({ no: 'u', spec: 'U', v: { uacr: 40 } })], { clinic: [clinicRow({ pDM: 'DM' })] })
  assert.equal(b.verdict, 'early', '糖尿病人可用 UACR ≥30')
  b = run([labRow({ v: { egfr: 70 } }), labRow({ no: 'u', spec: 'U', v: { upcr: 100 } })])
  assert.equal(b.verdict, 'no')
  b = run([labRow({ v: { hb: 12 } })])
  assert.equal(b.verdict, 'nodata'); assert.deepEqual(b.ord, ['血清 Cr(eGFR)', 'UPCR'])
  b = run([])
  assert.equal(b.verdict, 'nodata'); assert.equal(verdictB(b, null).head, '無檢驗資料,建議先開單')
  // 過期檢驗不採計（Q41：eGFR 90 天、UPCR 180 天）
  b = run([labRow({ date: d('2026-01-01'), v: { egfr: 22 } })])
  assert.equal(b.verdict, 'nodata'); assert.ok(b.why.some(w => /較舊的檢驗未採計/.test(w)))
  // 曾收案結案：透析 → no；轉他院 → 重收但 VPN 必查
  const closedDial = [caseRow({ visit: d('2025-01-01'), ctype: '新收案', closed: true }), caseRow({ visit: d('2025-06-01'), ctype: '結案', closed: true, reason: '已洗腎' })]
  b = run([labRow({ v: { egfr: 22 } })], { cases: closedDial })
  assert.equal(b.verdict, 'no'); assert.equal(b.closeKind, 'dialysis'); assert.equal(verdictB(b, null).head, '已結案(透析),不適用 CKD 收案')
  const closedTr = [caseRow({ visit: d('2025-01-01'), ctype: '新收案', closed: true }), caseRow({ visit: d('2025-06-01'), ctype: '結案', closed: true, reason: '轉他院' })]
  b = run([labRow({ v: { egfr: 22 } })], { cases: closedTr })
  assert.equal(b.verdict, 'pre'); assert.ok(/重收 .*曾轉他院,VPN 必查/.test(verdictB(b, null).head))
})

test('入帳併入時間軸：錨點改入帳、漏帳、入帳間隔異常', () => {
  const cases = [
    caseRow({ visit: d('2025-10-01'), ctype: '新收案', enroll: d('2025-10-01') }),
    caseRow({ visit: d('2026-03-01'), ctype: '追蹤', code: 'P3403C', enroll: d('2025-10-01') }),   // 登錄但入帳期內查無 → 漏帳
  ]
  const billing = [
    { src: 'bill', mrn: '1', visit: d('2026-01-05'), code: 'P3403C', prog: 'pre', ctype: '追蹤', name: 'A', doctor: '王', dept: '腎臟內科', price: 600, n: 1 },
    { src: 'bill', mrn: '1', visit: d('2026-02-10'), code: 'P3403C', prog: 'pre', ctype: '追蹤', name: 'A', doctor: '王', dept: '腎臟內科', price: 600, n: 1 },  // 距 1/05 僅 36 天 → 間隔異常
    { src: 'bill', mrn: '1', visit: d('2026-06-30'), code: 'P3403C', prog: 'pre', ctype: '追蹤', name: 'A', doctor: '王', dept: '腎臟內科', price: 600, n: 1 },
  ]
  const a = analyze(data({ cases, billing, clinic: [clinicRow()] }), C()).A[0]
  assert.equal(a.recon.anchor, 'bill'); assert.equal(a.last.src, 'bill'); assert.equal(a.gap, 78)
  assert.equal(a.recon.misses.length, 1); assert.equal(a.recon.shortBilled.length, 1); assert.equal(a.recon.shortBilled[0].gap, 36)
  assert.ok(a.why.some(w => /上次入帳 P3403C/.test(w) && /600 點/.test(w)))
  assert.ok(a.why.some(w => /漏帳 1 次/.test(w))); assert.ok(a.why.some(w => /入帳間隔異常 1 筆/.test(w)))
})

test('診次分組與科別過濾：本科醫師按鈕、他科掛號已收案（allA）、未收案他科不評估', () => {
  const cases = [caseRow({ mrn: '9', visit: d('2026-06-01'), ctype: '追蹤', code: 'P3403C', enroll: d('2025-01-01') })]
  const clinic = [
    clinicRow({ mrn: '1', doctor: '王', no: '1' }), clinicRow({ mrn: '2', doctor: '李', no: '2' }),
    clinicRow({ mrn: '9', doctor: '陳', dept: '心臟內科', no: '3' }),             // 他科掛號、已收案
    clinicRow({ mrn: '8', doctor: '陳', dept: '心臟內科', no: '4' }),             // 他科未收案 → 不評估
    clinicRow({ mrn: '3', doctor: '王', no: '6', date: d('2026-09-17') }),
  ]
  const cfgAll = makeCfg({ ...DEFAULT_SETTINGS, allA: true }, TODAY)
  const sg = sessionGroups(data({ cases, clinic }), cfgAll, '', TODAY)
  assert.deepEqual(sg.groups.map(g => `${g.date}|${g.doctor}|${g.n}`).sort(), ['2026-09-16|李|1', '2026-09-16|王|1', '2026-09-17|王|1'].sort())
  assert.equal(sg.groups[0].date, '2026-09-16'); assert.equal(sg.groups[2].date, '2026-09-17', '先依日期排')
  assert.equal(sg.others[TODAY], 1, '他科掛號已收案 1 人')
  assert.equal(sg.otherGroups[TODAY][0].dept, '心臟內科')
  // 預設判讀日 = 本科最近門診日
  assert.equal(sessionGroups(data({ cases, clinic }), cfgAll, '', '').cur, '2026-09-17')
  let R = analyze(data({ cases, clinic }), cfgAll, { doctorSel: '' })
  assert.deepEqual(R.B.map(b => b.p.mrn), ['1', '2'], '全部醫師：本科兩人未收案；他科不列')
  assert.equal(R.deptInfo.total, 4); assert.equal(R.deptInfo.matched, 2)
  R = analyze(data({ cases, clinic }), cfgAll, { doctorSel: '王' })
  assert.deepEqual(R.B.map(b => b.p.mrn), ['1'])
  R = analyze(data({ cases, clinic }), cfgAll, { doctorSel: OTHER_SESSION })
  assert.equal(R.A.length, 1); assert.equal(R.A[0].mrn, '9'); assert.equal(R.A[0].otherDept, true)
  assert.ok(R.A[0].alerts.some(x => x.t === '他科'), '他科掛號提醒收案醫師')
  assert.equal(R.B.length, 0)
})
