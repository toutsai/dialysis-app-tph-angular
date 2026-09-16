/* ============================================================
   門診 CKD 收案追蹤 — HIS 報表解析核心（ESM 版）
   來源：「CKD 收案追蹤工作台·部北版」交接包 src/parsers.js（2026-08-25 版）。
   2026-09-15 搬進本站後端（docs/2026-09-15-ckd-clinic-tab-plan.md 階段 0）。

   ⚠️ 規則零改動：日期/病歷號正規化、四種報表辨識、欄位對映、P 碼表、分期公式全部照原版。
      唯一差異是模組格式（UMD → ESM）與 XLSX 來源（本站 utils/spreadsheet.js）。
      若要改判定規則，先對照交接包 HANDOFF.md 與 tests/ckd-parsers.test.mjs。

   四種部北報表：追蹤清冊(收案登錄簿) / CKD-病患清單查詢(門診名單) /
   【0204】腎臟科檢驗結果病患明細(逐項長表) / 醫令明細清單(P 碼申報)。
   ============================================================ */
import XLSX from '../../utils/spreadsheet.js'

export const DAY = 86400000

/* ---------- 日期 ---------- */
export function rocToDate(v) {
  if (v == null) return null
  if (v instanceof Date) return isNaN(v) ? null : v
  let s = String(v).trim(); if (!s) return null; let m
  if ((m = s.match(/^(\d{2,3})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/))) return mk(+m[1] + 1911, +m[2], +m[3])
  if ((m = s.match(/^(\d{3})(\d{2})(\d{2})$/))) return mk(+m[1] + 1911, +m[2], +m[3])
  if ((m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/))) return mk(+m[1], +m[2], +m[3])
  if (/^\d{5}$/.test(s)) return new Date(Date.UTC(1899, 11, 30) + (+s) * DAY)
  return null
}
export function mk(y, mo, d) { const dt = new Date(y, mo - 1, d); return isNaN(dt) ? null : dt }
/* 部北四種檔的日期寫法全不同：2026-08-24 / 20260826 / 20260820141408(含時分秒) / 1150707(民國 7 碼) / 039/01/01 / 1962/01/01 */
export function anyDate(v) {
  if (v == null) return null
  if (v instanceof Date) return isNaN(v) ? null : v
  const s = String(v).trim(); if (!s) return null; let m
  if ((m = s.match(/^(19|20)(\d{2})(\d{2})(\d{2})(?:\d{6})?$/))) return mk(+(m[1] + m[2]), +m[3], +m[4])     // yyyymmdd(+hhmmss)
  if ((m = s.match(/^(\d{3})(\d{2})(\d{2})$/))) return mk(+m[1] + 1911, +m[2], +m[3])                        // 民國 yyymmdd
  if ((m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/))) return mk(+m[1], +m[2], +m[3])
  if ((m = s.match(/^(\d{2,3})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/))) return mk(+m[1] + 1911, +m[2], +m[3])
  if (/^\d{5}$/.test(s)) return new Date(Date.UTC(1899, 11, 30) + (+s) * DAY)
  return null
}
/* 病歷號正規化：部北門診清單是補零 10 碼(0000602991)，其他報表不補零 → 純數字一律去前導 0 再比對 */
export function normMrn(v) { const s = String(v == null ? '' : v).trim(); if (/^\d+$/.test(s)) { const z = s.replace(/^0+/, ''); return z || '0' } return s }
export const isMrn = s => /^\d{3,}$/.test(s)
export function ageAt(birth, at) { if (!birth || !at) return null; let a = at.getFullYear() - birth.getFullYear(); if (at.getMonth() < birth.getMonth() || (at.getMonth() === birth.getMonth() && at.getDate() < birth.getDate())) a--; return a >= 0 && a < 130 ? a : null }
export const iso = d => d ? d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') : ''
export const roc = d => d ? String(d.getFullYear() - 1911).padStart(3, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0') : '—'
export const addD = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
export const dGap = (a, b) => (!a || !b) ? null : Math.round((b - a) / DAY)
export const numOf = v => { const n = parseFloat(String(v == null ? '' : v).replace(/[^\d.\-]/g, '')); return isFinite(n) ? n : null }

/* ---------- 遮蔽 ---------- */
export function maskName(n) { if (!n) return ''; const a = [...n]; if (a.length <= 1) return n; if (a.length === 2) return a[0] + '○'; return a[0] + '○'.repeat(a.length - 2) + a[a.length - 1] }
export const maskMrn = m => m ? m.slice(0, 2) + '****' + m.slice(-2) : ''
export const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

/* ---------- 分期與 eGFR ---------- */
export function stageOf(e) {
  if (e == null) return null
  if (e >= 90) return 'G1'; if (e >= 60) return 'G2'; if (e >= 45) return 'G3a'
  if (e >= 30) return 'G3b'; if (e >= 15) return 'G4'; return 'G5'
}
export const stageFromText = t => { const m = String(t || '').match(/stage\s*([12345][ab]?)/i); return m ? 'G' + m[1].toLowerCase() : null }
export function ckdEpi(cr, age, sexF) {
  if (!cr || !age) return null
  const k = sexF ? 0.7 : 0.9, a = sexF ? -0.241 : -0.302
  return 142 * Math.pow(Math.min(cr / k, 1), a) * Math.pow(Math.max(cr / k, 1), -1.2) * Math.pow(0.9938, age) * (sexF ? 1.012 : 1)
}
export function mdrdS(cr, age, sexF) { if (!cr || !age) return null; return 175 * Math.pow(cr, -1.154) * Math.pow(age, -0.203) * (sexF ? 0.742 : 1) }

/* ============================================================
   讀檔
   ============================================================ */
/* HIS「匯出 Excel」可能是 XML 試算表 / HTML 表格（副檔名仍叫 .xlsx）：開頭是 "<" 就改走文字路徑，
   否則 SheetJS 會做每位元組一格的陣列而炸掉（交接包 HANDOFF B-1）。Node 端 buf 可能是 Buffer。
   讀「所有工作表」串成一份 AoA（原版行為；本站 spreadsheetParser 只讀第一張，故不共用）。 */
export function toAoa(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let wb
  let i = (u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) ? 3 : 0
  while (i < u8.length && (u8[i] === 0x20 || u8[i] === 0x0A || u8[i] === 0x0D || u8[i] === 0x09)) i++
  if (u8[i] === 0x3C && typeof TextDecoder !== 'undefined') {
    let head = ''; for (let j = 0; j < Math.min(u8.length, 4096); j++) head += String.fromCharCode(u8[j])
    const m = head.match(/(?:encoding|charset)\s*=\s*["']?\s*([\w-]+)/i); let cs = m ? m[1].toLowerCase() : 'utf-8', txt
    try { txt = new TextDecoder(cs).decode(u8) } catch (e) { txt = new TextDecoder('utf-8').decode(u8); cs = 'utf-8' }
    if (/^utf-?8$/.test(cs) && (txt.slice(0, 2000000).match(/�/g) || []).length > 500) { try { txt = new TextDecoder('big5').decode(u8) } catch (e) { /* 保留 utf-8 結果 */ } }
    if (txt.length > 40000000) throw new Error('文字型報表超過 4,000 萬字元，請縮短匯出區間或分檔')
    wb = XLSX.read(txt, { type: 'string', cellDates: false, raw: false, dense: true })
  } else {
    wb = XLSX.read(u8, { type: 'array', cellDates: false, raw: false, dense: true })   // dense：0204 檢驗檔 150k 列讀取快 40%、記憶體少 40%
  }
  const out = []
  wb.SheetNames.forEach(n => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '', blankrows: true })
    .forEach(r => out.push(r.map(c => String(c == null ? '' : c)))))
  return out
}
export function detectKind(aoa) {
  /* 部北四種報表：標題判別優先（鐵律 3），再看表頭。
     - 醫令明細清單(入帳)：第 1 列標題「醫令明細清單 …」，表頭 病歷號碼/看診日期/醫令代碼
     - 0204 檢驗結果病患明細：標題「…檢驗結果病患明細…」，表頭 病歷號/報告日/醫令/細項名稱/結果
     - CKD-病患清單查詢(門診)：標題「CKD-病患清單查詢」，表頭 看診日期/午別/科別/醫師/號碼/病歷號
     - 追蹤清冊(收案登錄簿)：沒有標題列，表頭 收案日期/收案類別/病歷號/給付別 */
  const t0 = aoa.slice(0, 4).map(r => r.join('|')).join('\n')
  if (/醫令明細清單/.test(t0)) return 'bill'
  if (/檢驗結果病患明細/.test(t0)) return 'lab'
  if (/CKD-?病患清單查詢/.test(t0)) return 'clinic'
  if (findHeader(aoa, ['病歷號碼', '看診日期', '醫令代碼']) >= 0) return 'bill'
  if (findHeader(aoa, ['病歷號', '報告日', '醫令', '細項名稱']) >= 0) return 'lab'
  if (findHeader(aoa, ['收案日期', '收案類別', '病歷號']) >= 0) return 'case'
  if (findHeader(aoa, ['看診日期', '病歷號', '號碼', '醫師']) >= 0) return 'clinic'
  return null
}
export function findHeader(aoa, keys) {
  for (let i = 0; i < Math.min(aoa.length, 40); i++) {
    const set = aoa[i].map(c => c.trim())
    if (keys.every(k => set.some(c => c === k || c.replace(/\s+/g, '') === k))) return i
  }
  return -1
}
export function pick(c) {
  const names = Array.prototype.slice.call(arguments, 1)
  for (const n of names) if (c[n] != null) return c[n]
  const keys = Object.keys(c)
  for (const n of names) { const k = keys.find(x => x.indexOf(n) === 0); if (k) return c[k] }
  return null
}
export function colIndex(row) { const m = {}; row.forEach((c, i) => { const k = c.trim().replace(/\s+/g, ''); if (k && !(k in m)) m[k] = i }); return m }

/* P 碼 → 方案別與照護類別對照 */
export const PCODE = {
  P3402C: { prog: 'pre', ctype: '新收案' }, P3403C: { prog: 'pre', ctype: '追蹤' },
  P3404C: { prog: 'pre', ctype: '年度' }, P3405C: { prog: 'pre', ctype: '結案' },
  P3406C: { prog: 'pre', ctype: '獎勵' }, P3407C: { prog: 'pre', ctype: '獎勵' },
  P3408C: { prog: 'pre', ctype: '獎勵' }, P3409C: { prog: 'pre', ctype: '獎勵' },
  P8101C: { prog: 'pre', ctype: '衛教' },   /* CKD5 末期腎病治療方式衛教：一次性衛教費，不是追蹤照護，不算間隔與次數（部北入帳檔實見） */
  P4301C: { prog: 'early', ctype: '新收案' }, P4302C: { prog: 'early', ctype: '追蹤' },
  P4303C: { prog: 'early', ctype: '獎勵' },   /* 轉診照護獎勵費 200 點（每人一次）；不是年度評估、不算照護就診 */
  P7001C: { prog: 'early', ctype: '追蹤' }, P7002C: { prog: 'early', ctype: '年度' },
  P7003C: { prog: 'early', ctype: '獎勵' },   /* 糖尿病合併 Early-CKD 之轉診照護獎勵費 200 點 */
  /* 急性腎損傷(AKD)方案：部北登錄簿會出現；照護語意比照 新收案/追蹤/年度/結案 */
  P6802C: { prog: 'early', ctype: '新收案' }, P6803C: { prog: 'early', ctype: '追蹤' },
  P6806C: { prog: 'early', ctype: '年度' }, P6807C: { prog: 'early', ctype: '年度' },
  P6808C: { prog: 'early', ctype: '結案' }, P6809C: { prog: 'early', ctype: '獎勵' }
}
export const CAT_PROG = { 'Pre-ESRD': 'pre', 'Early-CKD': 'early', 'DKD': 'early', 'AKD': 'early' }
export const STAGE_TOKEN = t => { const m = String(t || '').trim().toLowerCase().match(/^(?:g|stage\s*)?([12345])([ab])?$/); return m ? 'G' + m[1] + (m[2] || '') : stageFromText(t) }
export const blankCase = () => ({ sex: '', id: '', age: null, sbp: null, dbp: null, bh: null, bw: null, smoke: '', cr: null, egfr: null, stage: null,
  upcr: null, uacr: null, ldl: null, tg: null, alb: null, hb: null, a1c: null, bp: '', bmi: null, waist: null, edu: '', educator: '', eduTo: '' })

/* ---------- 追蹤清冊(收案登錄簿) ----------
   每列一段收案（同人可多列：重收案、轉方案），不是每次照護。欄位：
   編號 | 收案日期 | 收案類別 | 病歷號 | 重收案 | 姓名 | 間隔天數 | 給付別 | eGFR(MDRD) | eGFR(EPI) | Stage | 結案 | 結案日期 | 結案原因 | 醫師 | 最後衛教日 | 下次評估日
   給付別 = 該段收案最近一次申報的 P 碼（開放中的個案幾乎都有；結案者常為 0 / 空）。
   轉成工作台時間軸：收案列(新收案) + 最後照護列(帶 P 碼) + 結案列；中間各次照護由入帳檔補齊。 */
export function parseCases(aoa) {
  const h = findHeader(aoa, ['收案日期', '收案類別', '病歷號'])
  if (h < 0) throw new Error('找不到欄位標題列（追蹤清冊需含「收案日期」「收案類別」「病歷號」）')
  const c = colIndex(aoa[h]), out = []
  const g = function (r) { const i = pick.apply(null, [c].concat(Array.prototype.slice.call(arguments, 1))); return i != null ? String(r[i] == null ? '' : r[i]).trim() : '' }
  for (let i = h + 1; i < aoa.length; i++) {
    const r = aoa[i], mrn = normMrn(g(r, '病歷號'))
    if (!isMrn(mrn)) continue
    const enroll = anyDate(g(r, '收案日期')), lastEdu = anyDate(g(r, '最後衛教日')), nextDue = anyDate(g(r, '下次評估日'))
    const cat = g(r, '收案類別'), codeRaw = g(r, '給付別').toUpperCase(), code = /^P\d{4}C$/.test(codeRaw) ? codeRaw : ''
    const prog = CAT_PROG[cat] || (/^P34/.test(code) ? 'pre' : 'early')
    const dm = cat === 'DKD' || /^P70/.test(code)
    const closed = /^Y/i.test(g(r, '結案')), closeD = anyDate(g(r, '結案日期'))
    const base = Object.assign(blankCase(), {
      mrn, name: g(r, '姓名'), prog, enroll, cat, dm,
      egfr: numOf(g(r, 'eGFR(EPI)', 'eGFR(CKD-EPI)', 'eGFR')), egfrMdrd: numOf(g(r, 'eGFR(MDRD)')),
      stage: STAGE_TOKEN(g(r, 'Stage', '分期')), doctor: g(r, '醫師'), nextDue,
      reenroll: /^Y/i.test(g(r, '重收案')), serial: g(r, '編號'), gapDays: numOf(g(r, '間隔天數')),
      closed, closeDate: closeD, reason: g(r, '結案原因'), price: null, src: 'case'
    })
    if (!enroll && !lastEdu) continue
    const lastVisit = (lastEdu && enroll && lastEdu > enroll) ? lastEdu : (enroll || lastEdu)
    if (lastVisit !== enroll && enroll) {
      out.push(Object.assign({}, base, { visit: enroll, code: '', ctype: '新收案' }))
      out.push(Object.assign({}, base, { visit: lastVisit, code, ctype: code ? ((PCODE[code] || {}).ctype || '追蹤') : '追蹤' }))
    } else {
      out.push(Object.assign({}, base, { visit: lastVisit, code, ctype: code ? ((PCODE[code] || {}).ctype || '新收案') : '新收案' }))
    }
    if (closed) {
      const at = closeD || lastVisit
      if (at) out.push(Object.assign({}, base, { visit: at, code: code === 'P3405C' || code === 'P6808C' ? code : '', ctype: '結案' }))
    }
  }
  if (!out.length) throw new Error('標題列有找到，但沒有讀到任何收案資料列')
  return out
}

/* ---------- CKD-病患清單查詢(全院門診名單) ----------
   看診日期 | 午別 | 診間 | 科別 | 醫師 | 號碼 | 病歷號 | 病患姓名 | 身分證 | 生日 | ACR採檢日期 | ACR數值 | PCR採檢日期 | PCR數值 |
   EGFR採檢日期 | EGFR數值(MDRD,整數) | CKDEPI採檢日期 | CKDEPI數值 | 行動電話
   日期為 yyyymmdd；午別 1/2/3；沒有退掛/狀態欄。自帶最近一次 ACR/PCR/eGFR：parseClinic 回傳掛號列，clinicLabs() 另轉成檢驗紀錄。 */
export const HALF = { '1': '上午', '2': '下午', '3': '夜間', '上午': '上午', '下午': '下午', '夜間': '夜間', '晚上': '夜間' }
/* 部北門診清單沒有性別欄：由身分證第 2 碼推（1/8 男、2/9 女；脫敏假號 X9 開頭則不推） */
export function sexFromId(id) { const m = String(id || '').trim().match(/^[A-WYZ]([1289])\d{8}$/); return m ? (m[1] === '1' || m[1] === '8' ? '男' : '女') : '' }
export function parseClinic(aoa) {
  const h = findHeader(aoa, ['看診日期', '病歷號', '號碼'])
  if (h < 0) throw new Error('找不到欄位標題列（CKD-病患清單查詢需含「看診日期」「病歷號」「號碼」）')
  const c = colIndex(aoa[h]), out = []
  const g = function (r) { const i = pick.apply(null, [c].concat(Array.prototype.slice.call(arguments, 1))); return i != null ? String(r[i] == null ? '' : r[i]).trim() : '' }
  const num = v => { const n = numOf(v); return /^[-.\s]*$/.test(String(v || '')) ? null : n }
  for (let i = h + 1; i < aoa.length; i++) {
    const r = aoa[i], mrn = normMrn(g(r, '病歷號'))
    if (!isMrn(mrn)) continue
    const date = anyDate(g(r, '看診日期')), birth = anyDate(g(r, '生日'))
    const half = g(r, '午別')
    out.push({
      mrn, name: g(r, '病患姓名', '姓名'), id: g(r, '身分證'), sex: g(r, '性別') || sexFromId(g(r, '身分證')), birth,
      age: ageAt(birth, date || new Date()), date,
      half: HALF[half] || half, dept: g(r, '科別'), room: g(r, '診間'),
      doctor: g(r, '醫師'), no: g(r, '號碼'), state: g(r, '狀態'), revisit: '',
      pCKD: '', pPRE: '', pDM: '',
      acrDate: anyDate(g(r, 'ACR採檢日期')), acr: num(g(r, 'ACR數值')),
      pcrDate: anyDate(g(r, 'PCR採檢日期')), pcr: num(g(r, 'PCR數值')),
      egfrMdrdDate: anyDate(g(r, 'EGFR採檢日期')), egfrMdrd: num(g(r, 'EGFR數值')),
      egfrDate: anyDate(g(r, 'CKDEPI採檢日期')), egfr: num(g(r, 'CKDEPI數值'))
    })
  }
  if (!out.length) throw new Error('標題列有找到，但沒有讀到任何掛號資料列')
  return out
}
/* 門診清單自帶的最近檢驗值 → 檢驗紀錄（與 0204 檢驗檔同一資料模型；no 以 clinic| 開頭避免互相覆蓋） */
export function clinicLabs(rows) {
  const out = [], seen = {}
  const push = (p, spec, kind, date, v) => {
    if (!date) return
    const no = 'clinic|' + p.mrn + '|' + iso(date) + '|' + spec
    let rec = seen[no]
    if (!rec) { rec = seen[no] = { mrn: p.mrn, name: p.name, id: '', dept: '', dx: '', spec, kind, no, date, v: {}, flag: {}, q: {}, src: 'clinic' }; out.push(rec) }
    for (const k in v) if (v[k] != null && !(k in rec.v)) rec.v[k] = v[k]
  }
  for (const p of rows) {
    if (p.acr != null) push(p, 'U', '尿液', p.acrDate, { uacr: p.acr })
    if (p.pcr != null) push(p, 'U', '尿液', p.pcrDate, { upcr: p.pcr })
    if (p.egfr != null) push(p, 'B', '生化', p.egfrDate, { egfr: p.egfr })
    if (p.egfrMdrd != null) push(p, 'B', '生化', p.egfrMdrdDate, { egfrMdrd: p.egfrMdrd })
  }
  return out
}

/* ---------- 檢驗報告 ---------- */
export const BLOOD_ALIAS = {
  cr: ['cr', 'crea', 'creatinine', 'screatinine'], egfr: ['egfr', 'egfrckdepi', 'egfrmdrd', 'gfr', 'ccr'],
  hb: ['hb', 'hgb', 'hemoglobin'], a1c: ['hba1c', 'a1c'], k: ['k', 'potassium'], na: ['na', 'sodium'],
  alb: ['albumin', 'alb'], ldl: ['ldl', 'ldlc'], tg: ['tg', 'triglyceride'], chol: ['cholesterol', 'tchol'],
  bun: ['bun'], ua: ['uricacid'], ca: ['ca', 'calcium'], phos: ['p', 'phosphorus', 'ip'],
  ipth: ['ipth', 'pth'], hco3: ['hco3', 'tco2', 'co2'], glu: ['gluac', 'glucoseac', 'glucose', 'gluc']
}
export const URINE_ALIAS = {
  upcr: ['pc', 'pcratio', 'upcr', 'utpcre', 'tpcre', 'proteincreatinineratio', 'protcre'],
  uacr: ['ac', 'acratio', 'uacr', 'ualbcre', 'albcre', 'microalbumincreatinine', 'microalbcre'],
  uprot: ['protein', 'totalprotein', 'urineprotein'], ualb: ['albumin', 'microalbumin', 'malb'],
  ucr: ['cr', 'crea', 'creatinine']
}
const mkMap = o => { const m = {}; for (const k in o) o[k].forEach(a => { if (!(a in m)) m[a] = k }); return m }
export const BLOOD_KEY = mkMap(BLOOD_ALIAS), URINE_KEY = mkMap(URINE_ALIAS)
export const normItem = s => String(s || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]/g, '')
export const ITEM_RE = /^\s{1,8}([A-Za-z][A-Za-z0-9()\-\/.\s]{0,30}?)\s{2,}(?:([HL])\s+)?([<>]?)\s*(-?\d+(?:\.\d+)?)\s*([A-Za-z%\/0-9^.]*)/

export function kvPairs(row) {
  const p = {}
  for (let i = 0; i < row.length; i++) {
    const c = (row[i] || '').trim()
    if (!/[：:]\s*$/.test(c)) continue
    const label = c.replace(/[：:]\s*$/, '').replace(/\s+/g, '')
    for (let j = i + 1; j < row.length; j++) {
      const v = (row[j] || '').trim()
      if (v) { if (!/[：:]\s*$/.test(v) && !(label in p)) p[label] = v; break }
    }
  }
  return p
}
/* 部北【0204】檢驗結果病患明細：逐項長表 病歷號 | 姓名 | 報告日(yyyymmddHHMMSS) | 醫令 | 序號 | 細項名稱 | 結果 | 參考值 | 單位 | 判別
   以「醫令代碼 + 細項名稱」對應到工作台鍵值；同人同日彙整成一份生化(B)與一份尿液(U)紀錄，同鍵取最晚報告時間。
   09015C 腎絲球過濾率(小數) = CKD-EPI → egfr；eGFR(整數) = MDRD → egfrMdrd（門診清單 EGFR數值/CKDEPI數值 同理）。 */
export const TPH_LAB = [
  // [醫令代碼 regex, 細項名稱 regex, 鍵, 檢體]
  [/^(09015C|09015CK|EGFR)$/, /肌酸酐|肌酐|creatinine/i, 'cr', 'B'],
  [/^(09015C|09015CK|EGFR)$/, /^腎絲球過濾率/, 'egfr', 'B'],
  [/^(09015C|09015CK|EGFR)$/, /^egfr$/i, 'egfrMdrd', 'B'],
  [/^09016C/, /肌酸酐|肌酐/, 'ucr', 'U'], [/^12111C/, /白蛋白/, 'ualb', 'U'], [/^ACR$/i, /./, 'uacr', 'U'],
  [/^09040CD/, /總蛋白/, 'uprot', 'U'], [/^PCR$/i, /./, 'upcr', 'U'],
  [/^09006C/, /糖化/, 'a1c', 'B'], [/^09044/, /低密度/, 'ldl', 'B'], [/^09004C/, /三酸甘油/, 'tg', 'B'],
  [/^09001C/, /膽固醇/, 'chol', 'B'], [/^09043C/, /高密度/, 'hdl', 'B'], [/^08011C/, /^血色素$/, 'hb', 'B'],
  [/^08011C/, /^血小板$/, 'plt', 'B'], [/^09038C/, /白蛋白/, 'alb', 'B'], [/^09040C$/, /總蛋白/, 'tp', 'B'],
  [/^09022C$/, /鉀/, 'k', 'B'], [/^09021C$/, /鈉/, 'na', 'B'], [/^09023C$/, /Cl|氯/i, 'cl', 'B'],
  [/^09002C/, /BUN|尿素氮/i, 'bun', 'B'], [/^09013C/, /尿酸/, 'ua', 'B'], [/^09011C$/, /calcium|鈣/i, 'ca', 'B'],
  [/^09012C/, /磷/, 'phos', 'B'], [/^(I?09122C)$/, /副甲狀腺/, 'ipth', 'B'], [/^09005C/, /血糖/, 'glu', 'B'],
  [/^I12116C/, /鐵蛋白/, 'ferritin', 'B'], [/^09035CU/, /^Iron$/i, 'fe', 'B'], [/^09035CU/, /TIBC/i, 'tibc', 'B'],
  [/^12015C/, /反應性蛋白/, 'crp', 'B'], [/^09026C/, /丙胺酸|ALT/i, 'alt', 'B'], [/^09025C/, /天門冬|AST/i, 'ast', 'B']
]
export const TPH_URINE_CODE = /^(09016C|12111C|ACR|09040CD|PCR|09021CA|09022CA|09023CA|09011CB|06503B)/i
export function labKeyOf(code, item) {
  for (const t of TPH_LAB) if (t[0].test(code) && t[1].test(item)) return { key: t[2], spec: t[3] }
  return null
}
/* 結果值：數字；「<7」「< 2.00」→ 定性 <；「Reactive(827.36)」→ 括號內數值；「-」→ 略過 */
export function labVal(s) {
  s = String(s == null ? '' : s).trim(); if (!s || /^[-.]+$/.test(s)) return null
  let m
  if ((m = s.match(/^([<>])\s*(-?\d+(?:\.\d+)?)/))) return { v: +m[2], q: m[1] }
  if ((m = s.match(/^(-?\d+(?:\.\d+)?)/))) return { v: +m[1], q: '' }
  if ((m = s.match(/\((-?\d+(?:\.\d+)?)\)/))) return { v: +m[1], q: '' }
  return null
}
export const FLAG = { '偏高': 'H', '偏低': 'L', '危險': 'H', 'AB': 'H', 'H': 'H', 'L': 'L' }
export function parseLabs(aoa) {
  const h = findHeader(aoa, ['病歷號', '報告日', '醫令', '細項名稱'])
  if (h < 0) throw new Error('找不到欄位標題列（0204 檢驗結果病患明細需含「病歷號」「報告日」「醫令」「細項名稱」）')
  const c = colIndex(aoa[h])
  const ci = { mrn: pick(c, '病歷號'), name: pick(c, '姓名'), date: pick(c, '報告日'), code: pick(c, '醫令'), item: pick(c, '細項名稱'),
    res: pick(c, '結果'), unit: pick(c, '單位'), flag: pick(c, '判別') }
  const recs = {}, out = []
  for (let i = h + 1; i < aoa.length; i++) {
    const r = aoa[i]; if (!r) continue
    const mrn = normMrn(r[ci.mrn]); if (!isMrn(mrn)) continue
    const code = String(r[ci.code] == null ? '' : r[ci.code]).trim(), item = String(r[ci.item] == null ? '' : r[ci.item]).trim()
    const k = labKeyOf(code, item); if (!k) continue
    const raw = String(r[ci.date] == null ? '' : r[ci.date]).trim(), date = anyDate(raw); if (!date) continue
    const val = labVal(r[ci.res]); if (!val) continue
    const spec = k.spec === 'U' || TPH_URINE_CODE.test(code) ? 'U' : 'B'
    const no = mrn + '|' + iso(date) + '|' + spec
    let rec = recs[no]
    if (!rec) { rec = recs[no] = { mrn, name: String(r[ci.name] == null ? '' : r[ci.name]).trim(), id: '', dept: '', dx: '', spec, kind: spec === 'U' ? '尿液' : '生化', no, date, v: {}, flag: {}, q: {}, t: {}, src: 'lab' }; out.push(rec) }
    const stamp = raw.length >= 14 ? raw.slice(0, 14) : raw
    if (rec.t[k.key] != null && rec.t[k.key] > stamp) continue      // 同鍵同日多筆：留最晚報告時間
    rec.t[k.key] = stamp; rec.v[k.key] = val.v
    if (val.q) rec.q[k.key] = val.q; else delete rec.q[k.key]
    const f = FLAG[String(r[ci.flag] == null ? '' : r[ci.flag]).trim()]; if (f) rec.flag[k.key] = f; else delete rec.flag[k.key]
  }
  out.forEach(x => { delete x.t })
  if (!out.length) throw new Error('讀不到任何可用的檢驗結果（需為 0204 檢驗結果病患明細格式，且含 Cr/eGFR/ACR/PCR 等項目）')
  return out
}
export const meets = (lab, key, thr, strict) => {
  if (!lab || lab.v[key] == null) return false
  if (lab.q && lab.q[key] === '<') return false
  return strict ? lab.v[key] > thr : lab.v[key] >= thr
}
export const qv = (lab, key) => lab && lab.v[key] != null ? ((lab.q && lab.q[key]) || '') + lab.v[key] : null

/* 部北 醫令明細清單：第 1 列標題含查詢區間與代碼清單，第 2 列表頭（45 欄）。
   用到：看診日期(民國 7 碼 1150707) | 病歷號碼 | 病患姓名 | 醫令代碼 | 醫令名稱 | 單價 | 數量 | 金額 | 執行醫師/申報醫師 | 科別名(腎臟內科) | 性別 | 出生日期 */
export function parseBilling(aoa) {
  const hi = findHeader(aoa, ['病歷號碼', '看診日期', '醫令代碼'])
  if (hi < 0) return []
  const idx = colIndex(aoa[hi])
  const out = []
  for (const r of aoa.slice(hi + 1)) {
    const c = {}
    for (const k in idx) c[k] = r[idx[k]]
    const code = String(pick(c, '醫令代碼', '健保碼') || '').trim().toUpperCase()
    if (!/^P\d{4}[A-C]$/.test(code)) continue
    if (/^Y/i.test(String(pick(c, '自') || '').trim())) continue   // 自費(自=Y)不是健保申報，不算入帳
    const mrn = normMrn(pick(c, '病歷號碼'))
    const visit = anyDate(pick(c, '看診日期'))
    if (!isMrn(mrn) || !visit) continue
    const map = PCODE[code] || null
    out.push({
      src: 'bill', mrn, code, codeName: String(pick(c, '醫令名稱') || '').trim(),
      prog: map ? map.prog : (code[1] === '3' ? 'pre' : 'early'),
      ctype: map ? map.ctype : '其他',
      name: String(pick(c, '病患姓名') || '').trim(),
      doctor: String(pick(c, '申報醫師', '執行醫師', '醫師姓名') || '').trim(),
      dept: String(pick(c, '科別名', '科別') || '').trim(),
      sex: String(pick(c, '性別') || '').trim(), birth: anyDate(pick(c, '出生日期')),
      visit,
      price: numOf(pick(c, '單價')) != null ? numOf(pick(c, '單價')) : numOf(pick(c, '金額')),
      n: numOf(pick(c, '數量', '次數')) || 1
    })
  }
  return out
}

/** 依報表種類呼叫對應解析器；回 { kind, rows }。kind=null 代表不是四種部北報表之一。 */
export function parseByKind(aoa, kind = detectKind(aoa)) {
  switch (kind) {
    case 'case': return { kind, rows: parseCases(aoa) }
    case 'clinic': return { kind, rows: parseClinic(aoa) }
    case 'lab': return { kind, rows: parseLabs(aoa) }
    case 'bill': return { kind, rows: parseBilling(aoa) }
    default: return { kind: null, rows: [] }
  }
}

export const KIND_LABEL = { case: '追蹤清冊（收案登錄簿）', clinic: 'CKD-病患清單查詢（門診名單）', lab: '0204 檢驗結果病患明細', bill: '醫令明細清單（P 碼申報）' }
