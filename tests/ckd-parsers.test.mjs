// 門診 CKD 收案：HIS 報表解析器回歸測試
// 測資依交接包 fixtures.js 合成（欄位與部北真實檔一致），驗證搬移後的 ESM 版與原版行為一致。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import XLSX from '../src/utils/spreadsheet.js'
import {
  toAoa, detectKind, parseByKind, parseCases, parseClinic, clinicLabs, parseLabs, parseBilling,
  anyDate, normMrn, iso, stageOf, ckdEpi, labVal, PCODE, KIND_LABEL,
} from '../src/services/ckd/parsers.js'

const wbOf = (aoa) => {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Sheet1')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}
const yyyymmdd = s => s ? String(s).replace(/-/g, '') : ''
const roc7 = s => { if (!s) return ''; const [y, m, d] = String(s).split('-'); return String(+y - 1911).padStart(3, '0') + m + d }

/* 追蹤清冊：無標題列，第 1 列即表頭 */
function caseFile(rows) {
  const H = ['編號', '收案日期', '收案類別', '病歷號', '重收案', '姓名', '間隔天數', '給付別', 'eGFR(MDRD)', 'eGFR(EPI)', 'Stage', '結案', '結案日期', '結案原因', '醫師', '最後衛教日', '下次評估日']
  return wbOf([H].concat(rows.map((r, i) => [r.serial || String(i + 1), r.enroll || '', r.cat || 'Early-CKD', r.mrn, r.reenroll || 'N', r.name || '', r.gap == null ? '' : String(r.gap),
    r.code == null ? '0' : r.code, r.mdrd == null ? '' : '(' + r.mdrd + ')', r.epi == null ? '' : String(r.epi), r.stage || '', r.closed ? 'Y' : 'N', r.closeDate || '', r.reason || '', r.doctor || '', r.lastEdu || '', r.nextDue || ''])))
}
/* CKD-病患清單查詢：標題 2 列 + 表頭；日期 yyyymmdd；午別 1/2/3 */
function clinicFile(rows) {
  const H = ['看診日期', '午別', '診間', '科別', '醫師', '號碼', '病歷號', '病患姓名', '身分證', '生日', 'ACR採檢日期', 'ACR數值', 'PCR採檢日期', 'PCR數值', 'EGFR採檢日期', 'EGFR數值', 'CKDEPI採檢日期', 'CKDEPI數值', '行動電話']
  const ds = rows.map(r => yyyymmdd(r.date)).sort()
  return wbOf([['CKD-病患清單查詢'], ['&起日' + ds[0] + '&迄日' + ds[ds.length - 1]], H].concat(rows.map(r => [yyyymmdd(r.date), r.half || '1', r.room || '內科九診', r.dept || '腎臟內科', r.doctor || '測試醫師', String(r.no || ''), r.mrn, r.name || '', r.id || 'X900000000', r.birth || '1950/01/01',
    yyyymmdd(r.acrDate), r.acr == null ? '' : String(r.acr), yyyymmdd(r.pcrDate), r.pcr == null ? '' : String(r.pcr), yyyymmdd(r.mdrdDate), r.mdrd == null ? '' : String(r.mdrd), yyyymmdd(r.epiDate), r.epi == null ? '' : String(r.epi), ''])))
}
/* 0204 檢驗結果病患明細：逐項長表 */
const ITEM = {
  cr: ['09015C', '肌酸酐(血液)', 'mg/dL'], epi: ['09015C', '腎絲球過濾率', ''], mdrd: ['09015C', 'eGFR', ''],
  a1c: ['09006C', '糖化血色素', '%'], hb: ['08011C', '血色素', 'g/dL'], alb: ['09038C', '白蛋白(BCG法)', 'g/dL'], k: ['09022C', '血中鉀', 'mmol/L'],
  ldl: ['09044C', '低密度脂蛋白', 'mg/dL'], tg: ['09004C', '三酸甘油酯(血)', 'mg/dL'], ucr: ['09016C', '肌酸酐(尿)', 'mg/dL'],
  ualb: ['12111C', '微量白蛋白(尿)', 'mg/L'], uacr: ['ACR', '白蛋白/肌酐酸 比值', 'mg/g'], uprot: ['09040CD', '微量總蛋白(尿)', 'mg/dL'], upcr: ['PCR', '蛋白/肌酐酸 比值', 'mg/g']
}
function labFile(rows) {
  const H = ['病歷號', '姓名', '報告日', '醫令', '序號', '細項名稱', '結果', '參考值', '單位', '判別']
  const out = [['0204腎臟科檢驗結果病患明細-日期區間'], ['&起日:YYYYMMDD20260101&迄日:YYYYMMDD20260825'], H]
  rows.forEach(r => { let seq = 1; for (const k in r.v) { const it = ITEM[k]; const v = r.v[k]
    out.push([r.mrn, r.name || '', yyyymmdd(r.date) + (r.time || '101500'), it[0], String(seq++), it[1], String(v), '', it[2], (r.flag && r.flag[k]) || '  ']) } })
  return wbOf(out)
}
/* 醫令明細清單：標題 1 列 + 表頭；看診日期 民國 7 碼 */
function billFile(rows) {
  const H = ['報', '類別', '看診日期', '病歷號碼', '病患姓名', '身分證號', '出生日期', '年齡', '性別', '住院號', '切帳號', '床號', '醫令代碼', '醫令名稱', '自', '計', '術', '健保碼', '健保歸屬', '單價', '數量', '劑型單位', '原始成數', '金額', '執行醫師', '科別', '科別名', '執行日期-起', '執行日期-訖', '就醫序號', '健保點數1', '成數 ', '業績醫師', '申報醫師']
  return wbOf([['醫令明細清單   查詢時間就醫(報)日期：1150101～1150825  醫令代碼：P4301C,P4302C,P3402C,P3403C,P3404C,P3405C'], H].concat(rows.map(r => ['N', '1-門診', roc7(r.date), r.mrn, r.name || '', 'X900000000', '040/01/01', '075', r.sex || '男', ' ', ' ', ' ',
    r.code, r.codeName || r.code, r.self || 'N', 'Y', ' ', r.code, '治療處置費', String(r.price || 200), '1', '次', '1', String(r.price || 200), r.doctor || '測試醫師', '0204', r.dept || '腎臟內科', ' ', ' ', '', String(r.price || 200), '1', r.doctor || '測試醫師', r.doctor || '測試醫師'])))
}

test('原子函式：日期／病歷號／分期／eGFR', () => {
  assert.equal(iso(anyDate('20260826')), '2026-08-26')
  assert.equal(iso(anyDate('20260820141408')), '2026-08-20', 'yyyymmddHHMMSS 只取日期')
  assert.equal(iso(anyDate('1150707')), '2026-07-07', '民國 7 碼')
  assert.equal(iso(anyDate('039/01/01')), '1950-01-01', '民國斜線')
  assert.equal(iso(anyDate('1962/01/01')), '1962-01-01')
  assert.equal(iso(anyDate('2026-08-24')), '2026-08-24')
  assert.equal(anyDate(''), null)
  assert.equal(normMrn('0000602991'), '602991', '門診清單補零 10 碼去前導 0')
  assert.equal(normMrn('602991'), '602991')
  assert.equal(normMrn('0'), '0')
  assert.equal(stageOf(92), 'G1'); assert.equal(stageOf(44.9), 'G3b'); assert.equal(stageOf(14), 'G5')
  assert.ok(Math.abs(ckdEpi(1.0, 60, false) - 86.2) < 0.5, 'CKD-EPI 2021 男 60 歲 Cr 1.0 ≈ 86.2')
  assert.ok(Math.abs(ckdEpi(1.0, 60, true) - 64.5) < 0.5, 'CKD-EPI 2021 女 60 歲 Cr 1.0 ≈ 64.5')
  assert.deepEqual(labVal('< 2.00'), { v: 2, q: '<' })
  assert.deepEqual(labVal('Reactive(827.36)'), { v: 827.36, q: '' })
  assert.equal(labVal('-'), null)
  assert.equal(PCODE.P3403C.ctype, '追蹤'); assert.equal(PCODE.P7001C.prog, 'early')
  assert.deepEqual(Object.keys(KIND_LABEL), ['case', 'clinic', 'lab', 'bill'])
})

test('追蹤清冊：辨識、時間軸展開（新收案＋最後照護＋結案）', () => {
  const aoa = toAoa(caseFile([
    { mrn: '0000123', enroll: '2026-01-10', cat: 'Pre-ESRD', code: 'P3403C', lastEdu: '2026-06-15', epi: 28.4, mdrd: 30, stage: 'Stage 4', doctor: '王醫師', name: '甲' },
    { mrn: '456', enroll: '2026-03-01', cat: 'Early-CKD', code: '0', name: '乙' },
    { mrn: '789', enroll: '2025-05-05', cat: 'DKD', code: 'P7001C', lastEdu: '2026-02-02', closed: true, closeDate: '2026-03-03', reason: '轉出', name: '丙' },
    { mrn: 'ABC', enroll: '2026-01-01', name: '非病歷號要略過' },
  ]))
  assert.equal(detectKind(aoa), 'case')
  const rows = parseCases(aoa)
  const a = rows.filter(r => r.mrn === '123')
  assert.equal(a.length, 2, '收案列 + 最後照護列')
  assert.deepEqual(a.map(r => r.ctype), ['新收案', '追蹤'])
  assert.equal(iso(a[0].visit), '2026-01-10'); assert.equal(a[0].code, '')
  assert.equal(iso(a[1].visit), '2026-06-15'); assert.equal(a[1].code, 'P3403C')
  assert.equal(a[0].prog, 'pre'); assert.equal(a[0].stage, 'G4'); assert.equal(a[0].egfr, 28.4); assert.equal(a[0].egfrMdrd, 30)
  const b = rows.filter(r => r.mrn === '456')
  assert.equal(b.length, 1); assert.equal(b[0].ctype, '新收案'); assert.equal(b[0].code, ''); assert.equal(b[0].prog, 'early')
  const c = rows.filter(r => r.mrn === '789')
  assert.deepEqual(c.map(r => r.ctype), ['新收案', '追蹤', '結案'])
  assert.equal(c[0].dm, true, 'DKD → dm'); assert.equal(iso(c[2].visit), '2026-03-03'); assert.equal(c[2].code, '', '非 P3405C 結案列不帶碼')
  assert.equal(rows.some(r => r.mrn === 'ABC'), false)
  assert.equal(parseByKind(aoa).kind, 'case')
})

test('CKD-病患清單查詢：標題優先辨識、性別由身分證推、自帶檢驗轉 clinicLabs', () => {
  const aoa = toAoa(clinicFile([
    { date: '2026-09-16', half: '1', no: 5, mrn: '0000602991', name: '丁', id: 'A123456789', birth: '1950/01/01', acrDate: '2026-08-01', acr: 45, epiDate: '2026-08-01', epi: 38.2, mdrdDate: '2026-08-01', mdrd: 40 },
    { date: '2026-09-16', half: '2', no: 12, mrn: '777', name: '戊', id: 'B223456789', birth: '1980/05/05', pcrDate: '2026-07-20', pcr: 1200 },
  ]))
  assert.equal(detectKind(aoa), 'clinic')
  const rows = parseClinic(aoa)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].mrn, '602991'); assert.equal(rows[0].sex, '男'); assert.equal(rows[1].sex, '女')
  assert.equal(rows[0].half, '上午'); assert.equal(rows[1].half, '下午')
  assert.equal(rows[0].age, 76); assert.equal(rows[0].egfr, 38.2); assert.equal(rows[0].egfrMdrd, 40); assert.equal(rows[0].acr, 45)
  assert.equal(rows[1].pcr, 1200); assert.equal(rows[1].acr, null)
  const labs = clinicLabs(rows)
  const u = labs.find(l => l.mrn === '602991' && l.spec === 'U'), b = labs.find(l => l.mrn === '602991' && l.spec === 'B')
  assert.equal(u.no, 'clinic|602991|2026-08-01|U'); assert.deepEqual(u.v, { uacr: 45 })
  assert.deepEqual(b.v, { egfr: 38.2, egfrMdrd: 40 }); assert.equal(b.src, 'clinic')
})

test('0204 檢驗明細：逐項長表彙整成每人每日一份 B/U，同鍵取最晚報告時間，定性 < 保留', () => {
  const aoa = toAoa(labFile([
    { mrn: '123', name: '甲', date: '2026-09-01', time: '080000', v: { cr: 2.3, epi: 28.4, mdrd: 30, hb: 9.8, k: 5.6 }, flag: { k: '偏高', hb: '偏低' } },
    { mrn: '123', name: '甲', date: '2026-09-01', time: '150000', v: { cr: 2.5 } },       // 同日較晚 → 覆蓋 cr
    { mrn: '123', name: '甲', date: '2026-09-01', v: { ucr: 80, ualb: '< 2.00', uacr: 25, upcr: 300 } },
    { mrn: '0000456', name: '乙', date: '2026-09-02', v: { a1c: 7.2 } },
  ]))
  assert.equal(detectKind(aoa), 'lab')
  const labs = parseLabs(aoa)
  const b = labs.find(l => l.no === '123|2026-09-01|B'), u = labs.find(l => l.no === '123|2026-09-01|U')
  assert.ok(b && u, '生化與尿液各一份')
  assert.equal(b.v.cr, 2.5, '同鍵同日多筆留最晚'); assert.equal(b.v.egfr, 28.4); assert.equal(b.v.egfrMdrd, 30)
  assert.equal(b.flag.k, 'H'); assert.equal(b.flag.hb, 'L'); assert.equal(b.kind, '生化')
  assert.equal(u.v.ualb, 2); assert.equal(u.q.ualb, '<'); assert.equal(u.v.uacr, 25); assert.equal(u.v.upcr, 300); assert.equal(u.kind, '尿液')
  assert.equal(b.t, undefined, '內部時間戳不外露')
  assert.equal(labs.find(l => l.mrn === '456').v.a1c, 7.2)
})

test('醫令明細清單：P 碼入帳、自費排除、非 P 碼略過、民國 7 碼日期', () => {
  const aoa = toAoa(billFile([
    { mrn: '123', date: '2026-07-07', code: 'P3403C', price: 600, doctor: '王醫師' },
    { mrn: '123', date: '2026-07-07', code: 'P3406C', price: 1500 },
    { mrn: '456', date: '2026-08-01', code: 'P4302C', self: 'Y' },     // 自費不算入帳
    { mrn: '456', date: '2026-08-01', code: '09015C' },                 // 非 P 碼
    { mrn: '789', date: '2026-08-02', code: 'P9999C' },                 // 未知 P 碼 → 其他
  ]))
  assert.equal(detectKind(aoa), 'bill')
  const rows = parseBilling(aoa)
  assert.equal(rows.length, 3)
  assert.equal(iso(rows[0].visit), '2026-07-07'); assert.equal(rows[0].prog, 'pre'); assert.equal(rows[0].ctype, '追蹤'); assert.equal(rows[0].price, 600); assert.equal(rows[0].doctor, '王醫師')
  assert.equal(rows[1].ctype, '獎勵')
  assert.equal(rows[2].code, 'P9999C'); assert.equal(rows[2].ctype, '其他'); assert.equal(rows[2].prog, 'early')
  assert.equal(rows.some(r => r.mrn === '456'), false)
})

test('toAoa：HTML 假 xlsx（開頭 <）走文字路徑；未知報表 detectKind=null', () => {
  // 注意：SheetJS 文字路徑 raw:false 會把 ISO 日期字串（2026-01-10）改寫成 m/d/yy，anyDate 讀不回來——
  // 這是原版工作台的既有行為；HIS HTML 匯出實際用 yyyymmdd／民國格式，階段 1 拿真檔再驗（計畫文件已列）。
  const html = '<html><head><meta charset="utf-8"></head><body><table><tr><td>收案日期</td><td>收案類別</td><td>病歷號</td><td>給付別</td></tr><tr><td>20260110</td><td>Pre-ESRD</td><td>0000123</td><td>P3403C</td></tr></table></body></html>'
  const aoa = toAoa(Buffer.from('﻿' + html, 'utf8'))
  assert.equal(detectKind(aoa), 'case')
  const first = parseCases(aoa)[0]
  assert.equal(first.mrn, '123'); assert.equal(iso(first.visit), '2026-01-10'); assert.equal(first.code, 'P3403C')
  const other = toAoa(wbOf([['隨便', '欄位'], ['1', '2']]))
  assert.equal(detectKind(other), null)
  assert.deepEqual(parseByKind(other), { kind: null, rows: [] })
})
