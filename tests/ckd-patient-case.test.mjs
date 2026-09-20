// 門診 CKD：病人彙整視窗的單人判讀、收案段落、衛教時間軸（純函式，不碰 DB）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evalPatient, eduTimeline, enrollEpisodes } from '../src/services/ckd/patientCase.js'
import { analyze, makeCfg, OTHER_SESSION } from '../src/services/ckd/engine.js'
import { makeHooks, pcodeTimeline } from '../src/services/ckd/records.js'
import { DEFAULT_SETTINGS } from '../src/services/ckd/settings.js'

const d = (s) => new Date(s + 'T00:00:00')
const TODAY = '2026-09-16'
const caseRow = (o) => ({ src: 'case', mrn: '1', visit: null, code: '', ctype: '追蹤', name: 'A', prog: 'pre', cat: 'Pre-ESRD', dm: false, enroll: null, egfr: null, egfrMdrd: null, stage: null, doctor: '王', nextDue: null, reenroll: false, serial: '', gapDays: null, closed: false, closeDate: null, reason: '', price: null, sex: '', id: '', age: null, cr: null, upcr: null, uacr: null, ...o })
const clinicRow = (o) => ({ mrn: '1', name: 'A', id: '', sex: '男', birth: d('1950-01-01'), age: 76, date: d(TODAY), half: '上午', dept: '腎臟內科', room: '', doctor: '王', no: '5', state: '', revisit: '', pCKD: '', pPRE: '', pDM: '', manual: false, ...o })
const labRow = (o) => ({ mrn: '1', name: 'A', date: d('2026-09-01'), spec: 'B', kind: '生化', no: '1|2026-09-01|B', v: {}, flag: {}, q: {}, src: 'lab', ...o })
const billRow = (o) => ({ src: 'bill', mrn: '1', visit: null, code: '', codeName: '', prog: 'pre', ctype: '追蹤', name: 'A', doctor: '王', dept: '腎臟內科', sex: '', birth: null, price: 0, n: 1, ...o })

function dataset() {
  return {
    cases: [
      // 1：Pre-ESRD 已收案、今天有掛號
      caseRow({ mrn: '1', serial: 'S1', enroll: d('2025-01-10'), visit: d('2025-01-10'), ctype: '新收案' }),
      caseRow({ mrn: '1', serial: 'S1', enroll: d('2025-01-10'), visit: d('2026-05-01'), code: 'P3403C', ctype: '追蹤', nextDue: d('2026-08-01') }),
      // 1 的舊一段 Early-CKD（已結案、轉 Pre-ESRD）
      caseRow({ mrn: '1', serial: 'S0', prog: 'early', cat: 'Early-CKD', doctor: '李', enroll: d('2023-02-01'), visit: d('2023-02-01'), ctype: '新收案', closed: true, closeDate: d('2024-12-31'), reason: '轉 Pre-ESRD' }),
      caseRow({ mrn: '1', serial: 'S0', prog: 'early', cat: 'Early-CKD', doctor: '李', enroll: d('2023-02-01'), visit: d('2024-12-31'), ctype: '結案', closed: true, closeDate: d('2024-12-31'), reason: '轉 Pre-ESRD' }),
      // 3：已收案、今天沒掛號（只會出現在稽核列）
      caseRow({ mrn: '3', name: 'C', serial: 'S3', enroll: d('2025-06-01'), visit: d('2026-06-01'), code: 'P3403C', ctype: '追蹤' }),
    ],
    clinic: [
      clinicRow({ mrn: '1' }),
      clinicRow({ mrn: '2', name: 'B', no: '6' }), // 2：未收案、今天有掛號
    ],
    labs: [
      labRow({ mrn: '1', v: { egfr: 25, cr: 2.4 } }),
      labRow({ mrn: '2', name: 'B', no: '2|2026-09-01|B', v: { egfr: 28, cr: 2.2 } }),
      labRow({ mrn: '3', name: 'C', no: '3|2026-09-01|B', v: { egfr: 22, cr: 2.8 } }),
    ],
    billing: [
      billRow({ mrn: '1', visit: d('2026-05-01'), code: 'P3403C', ctype: '追蹤', price: 600 }),
      billRow({ mrn: '1', visit: d('2026-02-01'), code: 'P8101C', ctype: '衛教', price: 300 }),
    ],
    records: [
      { id: 'r1', type: 'note', mrn: '1', deleted: false, at: '2026-06-15', cat: '衛教', content: '低蛋白飲食衛教', author: '個管師' },
      { id: 'r2', type: 'note', mrn: '1', deleted: false, at: '2026-06-20', cat: '電話追蹤', content: '提醒回診', author: '個管師' },
      { id: 'r3', type: 'note', mrn: '9', deleted: false, at: '2026-06-15', cat: '衛教', content: '別人的', author: '個管師' },
    ],
    manual: [],
  }
}

test('evalPatient：診次內已收案 → 與 analyze 的 A 區同一列', () => {
  const data = dataset(), hooks = makeHooks(data.records)
  const ev = evalPatient(data, DEFAULT_SETTINGS, hooks, '1', TODAY)
  assert.equal(ev.kind, 'A'); assert.equal(ev.inSession, true)
  const R = analyze(data, makeCfg(DEFAULT_SETTINGS, TODAY), { doctorSel: '', withAudit: false, hooks })
  const a = R.A.find((r) => r.mrn === '1')
  assert.ok(a, '基準：A 區應有這位病人')
  for (const k of ['status', 'gap', 'need', 'code', 'prog', 'caseDoctor', 'nYear', 'n12']) assert.deepEqual(ev.row[k], a[k], k)
  assert.deepEqual(ev.row.why, a.why)
})

test('evalPatient：診次內未收案 → B 區同一列；不在診次的已收案者 → 稽核列；查無 → none', () => {
  const data = dataset(), hooks = makeHooks(data.records)
  const b = evalPatient(data, DEFAULT_SETTINGS, hooks, '2', TODAY)
  assert.equal(b.kind, 'B'); assert.equal(b.inSession, true); assert.equal(b.row.p.mrn, '2'); assert.equal(b.row.verdict, 'pre')

  const c = evalPatient(data, DEFAULT_SETTINGS, hooks, '3', TODAY)
  assert.equal(c.kind, 'A'); assert.equal(c.inSession, false)
  const full = analyze(data, makeCfg(DEFAULT_SETTINGS, TODAY), { doctorSel: '', withAudit: true, hooks })
  const aud = full.AUD.find((r) => r.mrn === '3')
  for (const k of ['status', 'gap', 'need', 'code', 'prog']) assert.deepEqual(c.row[k], aud[k], k)

  const n = evalPatient(data, DEFAULT_SETTINGS, hooks, '404', TODAY)
  assert.equal(n.kind, 'none'); assert.equal(n.row, null)
})

test('analyze 的 auditMrn：只稽核一人，且不影響 A／B 區與未帶參數時的全名單', () => {
  const data = dataset(), hooks = makeHooks(data.records), C = makeCfg(DEFAULT_SETTINGS, TODAY)
  const full = analyze(data, C, { doctorSel: '', withAudit: true, hooks })
  const one = analyze(data, C, { doctorSel: '', withAudit: true, auditMrn: '3', hooks })
  assert.deepEqual(full.AUD.map((r) => r.mrn).sort(), ['1', '3'])
  assert.deepEqual(one.AUD.map((r) => r.mrn), ['3'])
  assert.deepEqual(one.A.map((r) => r.mrn), full.A.map((r) => r.mrn))
  assert.deepEqual(one.B.map((r) => r.p.mrn), full.B.map((r) => r.p.mrn))
  assert.deepEqual(analyze(data, C, { doctorSel: '', withAudit: true, auditMrn: '404', hooks }).AUD, [])
})

test('evalPatient：「他科掛號已收案」診次的病人 → 與該診次 A 區同一列（inSession、當日掛號列、他科提醒都在）', () => {
  const data = dataset(), hooks = makeHooks(data.records)
  // 3 號（已收案）今天掛心臟內科；另有一筆別天的掛號，稽核列會抓到它（clinicIdx 第一筆）
  data.clinic.unshift(clinicRow({ mrn: '3', name: 'C', date: d('2026-08-01'), dept: '心臟內科', doctor: '趙', no: '9' }))
  data.clinic.push(clinicRow({ mrn: '3', name: 'C', dept: '心臟內科', doctor: '趙', no: '12' }))
  const S = { ...DEFAULT_SETTINGS, allA: true }
  const C = makeCfg(S, TODAY)
  const other = analyze(data, C, { doctorSel: OTHER_SESSION, withAudit: false, hooks }).A.find((r) => r.mrn === '3')
  assert.ok(other, '基準：他科診次應有這位病人')
  const ev = evalPatient(data, S, hooks, '3', TODAY)
  assert.equal(ev.kind, 'A'); assert.equal(ev.inSession, true)
  assert.equal(ev.row.otherDept, true)
  assert.equal(ev.row.p.no, '12', '要是判讀日當天的掛號列，不是別天的')
  assert.deepEqual(ev.row.alerts, other.alerts)
  // allA 關閉 → 沒有他科診次，回到稽核列
  const off = evalPatient(data, { ...DEFAULT_SETTINGS, allA: false }, hooks, '3', TODAY)
  assert.equal(off.kind, 'A'); assert.equal(off.inSession, false)
})

test('enrollEpisodes：事件列收回成一段一列、新→舊、保留登錄簿原文類別', () => {
  const eps = enrollEpisodes(dataset().cases, '1')
  assert.equal(eps.length, 2)
  assert.deepEqual(eps.map((e) => [e.enroll, e.cat, e.doctor, e.closed]), [['2025-01-10', 'Pre-ESRD', '王', false], ['2023-02-01', 'Early-CKD', '李', true]])
  assert.equal(eps[1].closeDate, '2024-12-31'); assert.equal(eps[1].reason, '轉 Pre-ESRD')
  assert.deepEqual(enrollEpisodes(dataset().cases, '404'), [])
})

test('eduTimeline：三來源合併、新→舊；只收衛教類追蹤紀錄；註銷的 P 碼不算', () => {
  const data = dataset(), hooks = makeHooks(data.records), C = makeCfg(DEFAULT_SETTINGS, TODAY)
  const pc = pcodeTimeline(data, '1', C, hooks)
  const edu = eduTimeline(pc.rows, data.records.filter((r) => r.mrn === '1'))
  assert.deepEqual(edu.map((e) => [e.date, e.kind]), [
    ['2026-06-15', 'note'], ['2026-05-01', 'care'], ['2026-02-01', 'p8101'], ['2025-01-10', 'care'], ['2023-02-01', 'care'],
  ])
  const care = edu.find((e) => e.date === '2026-05-01')
  assert.equal(care.code, 'P3403C'); assert.deepEqual(care.src.slice().sort(), ['入帳', '登錄'].sort(), '登錄與入帳同日同碼併成一列')
  const note = edu[0]
  assert.equal(note.text, '低蛋白飲食衛教'); assert.equal(note.author, '個管師'); assert.equal(note.recordId, 'r1')
  assert.ok(!edu.some((e) => e.text === '提醒回診'), '電話追蹤不是衛教')
  assert.ok(!edu.some((e) => e.label.includes('結案')), '結案列不是衛教')
  // 同日：登錄簿無碼的新收案列 ＋ 入帳的新收案碼 → 併成一列；同日兩個都有碼（追蹤＋年度）→ 各留一列
  const merged = eduTimeline([
    { visit: d('2025-01-10'), code: '', ctype: '新收案', doctor: '', src: ['登錄'] },
    { visit: d('2025-01-10'), code: 'P3402C', ctype: '新收案', doctor: '王', src: ['入帳'] },
    { visit: d('2026-03-01'), code: 'P3403C', ctype: '追蹤', doctor: '王', src: ['入帳'] },
    { visit: d('2026-03-01'), code: 'P3404C', ctype: '年度', doctor: '王', src: ['入帳'] },
  ], [])
  assert.deepEqual(merged.map((e) => [e.date, e.code, e.src.slice().sort().join('+')]), [
    ['2026-03-01', 'P3403C', '入帳'], ['2026-03-01', 'P3404C', '入帳'], ['2025-01-10', 'P3402C', '入帳+登錄'],
  ])
  assert.equal(merged[2].doctor, '王')
  // 已刪除的紀錄即使混進來也不算
  assert.deepEqual(eduTimeline([], [{ id: 'x', type: 'note', cat: '衛教', at: '2026-01-01', deleted: true }]), [])
  // 註銷
  const voided =eduTimeline([{ visit: d('2026-05-01'), code: 'P3403C', ctype: '追蹤', src: ['登錄'], voided: true }], [])
  assert.deepEqual(voided, [])
})
