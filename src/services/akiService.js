// 全院 AKI Map 核心邏輯（專師專用）
//
// 資料來源為 HIS 匯出的兩份 Excel：
//   1.「留院病人清單明細表」→ 住院病人快照（map 畫布）
//   2. 檢驗明細 → 肌酸酐(Cr)/腎絲球過濾率(eGFR)散點（門診/急診/住院三源）
//      自動偵測格式：「CKD-AKI 病患明細」寬表、「檢驗結果(住院病人)-檢驗日期」長表、
//      「8.1 報告區間明細門急住--檢驗院內碼」長表（含 eGFR，同次抽血配對）
//
// 兩檔以「病歷號 mrn」對接。分期採 KDIGO AKI（僅 Cr，無尿量）。
//
// ⚠️ 刻意決策（與使用者確認鎖定）：
//   1. baseline「優先採門診(OPD)值」：有門診 Cr 時，以門診最低值當 baseline 錨點，
//      拿之後的急診/住院值跟它比 —— 避免用已升高的急診值當 baseline 而漏判。
//      無門診時退回「時序前值最低」（rolling），仍尊重時間方向。
//   2. 全段最低 Cr >= ESRD_MIN(4.0) 直接歸「ESRD」，不當 AKI（慢性腎衰）。
//   3. 只有單筆 Cr → 無法判定 baseline，歸「single」。
//   4. 時間方向：baseline 必須早於 peak；天真的「窗內min/窗內max」會把恢復中的
//      病人誤判為新發 AKI，切勿改回。

import XLSX from 'xlsx'

// 全段最低 Cr >= 此值視為慢性腎衰/ESRD（≈ eGFR<15）
export const ESRD_MIN_CR = 4.0
// Stage 3 的絕對高值門檻
const STAGE3_ABS_CR = 4.0
// KDIGO 絕對上升門檻 (mg/dL)
const ABS_DELTA = 0.3

// 分期分類的顯示中繼資料（前端色碼對照用）
export const AKI_CATEGORIES = {
  'stage-3': { label: 'AKI Stage 3', order: 1 },
  'stage-2': { label: 'AKI Stage 2', order: 2 },
  'stage-1': { label: 'AKI Stage 1', order: 3 },
  esrd: { label: '疑似 ESRD/慢性', order: 4 },
  'stage-0': { label: '無 AKI', order: 5 },
  single: { label: '僅單筆·無法判定', order: 6 },
  'no-data': { label: '無 Cr 資料', order: 7 },
}

// ---------- 正規化工具 ----------

/** 病歷號一律當字串處理（保留前導 0） */
export function normalizeMrn(v) {
  return String(v == null ? '' : v).trim()
}

/** 民國/西元 YYYYMMDD 或已帶分隔的日期 → YYYY-MM-DD；空白/無效回 null */
export function normalizeDate(v) {
  const s = String(v == null ? '' : v).trim()
  if (!s) return null
  // 純數字 8 碼
  const digits = s.replace(/[^\d]/g, '')
  if (digits.length === 8) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
  }
  // 已是 YYYY-MM-DD / YYYY/MM/DD
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/)
  if (m) {
    return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  }
  return null
}

function toNumber(v) {
  const n = parseFloat(String(v == null ? '' : v).trim())
  return isNaN(n) ? null : n
}

/** 解析標題列的「&起日YYYYMMDD&迄日YYYYMMDD」（新版報表為「&起日:YYYYMMDD20260615」，中間夾非數字字樣） */
export function parseTitleRange(rows) {
  for (let i = 0; i < Math.min(rows.length, 4); i++) {
    for (const cell of rows[i] || []) {
      const s = String(cell == null ? '' : cell)
      const m = s.match(/起日\D*?(\d{8}).*?迄日\D*?(\d{8})/)
      if (m) return { rangeStart: normalizeDate(m[1]), rangeEnd: normalizeDate(m[2]) }
    }
  }
  return { rangeStart: null, rangeEnd: null }
}

/** 在前幾列中找出含指定關鍵字的表頭列 index */
function findHeaderRow(rows, keyword, maxScan = 12) {
  for (let i = 0; i < Math.min(rows.length, maxScan); i++) {
    if ((rows[i] || []).some((c) => String(c == null ? '' : c).trim() === keyword)) return i
  }
  return -1
}

function readSheetRows(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false })
}

// ---------- 留院病人清單解析 ----------
// 欄位: 護理站,住院號,切帳號,留院日,科別碼,科別,醫師,床號,病歷號,姓名,年齡,性別,入院日,出院日,主診斷碼,診斷名稱,轉歸

export function parseInpatients(buffer) {
  const rows = readSheetRows(buffer)
  const { rangeStart, rangeEnd } = parseTitleRange(rows)
  const headerIdx = findHeaderRow(rows, '病歷號')
  if (headerIdx < 0) throw new Error('找不到表頭（缺「病歷號」欄），請確認是「留院病人清單明細表」')

  const C = {
    ward: 0, admitNo: 1, bed: 7, mrn: 8, name: 9, age: 10, sex: 11,
    admitDate: 12, dischargeDate: 13, dxCode: 14, dxName: 15,
  }
  const map = new Map()
  let rowCount = 0
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i]
    const mrn = normalizeMrn(r?.[C.mrn])
    if (!mrn) continue
    rowCount++
    let rec = map.get(mrn)
    if (!rec) {
      rec = {
        mrn,
        name: String(r[C.name] || '').trim(),
        ward: String(r[C.ward] || '').trim(),
        bed: String(r[C.bed] || '').trim(),
        dept: String(r[4] || '').trim(),
        physician: String(r[6] || '').trim(),
        sex: String(r[C.sex] || '').trim(),
        age: String(r[C.age] || '').trim(),
        admitDate: normalizeDate(r[C.admitDate]),
        dischargeDate: normalizeDate(r[C.dischargeDate]),
        diagnoses: [],
      }
      map.set(mrn, rec)
    }
    // 多列 = 多診斷，合併去重
    const code = String(r[C.dxCode] || '').trim()
    const dxName = String(r[C.dxName] || '').trim()
    if (code || dxName) {
      if (!rec.diagnoses.some((d) => d.code === code && d.name === dxName)) {
        rec.diagnoses.push({ code, name: dxName })
      }
    }
  }
  return { rangeStart, rangeEnd, rowCount, patients: [...map.values()] }
}

// ---------- 檢驗明細解析（Cr/eGFR 散點，自動偵測 HIS 格式） ----------
// 格式 A「CKD-AKI 病患明細」（寬表）:
//   病歷號,姓名,性別,年齡,主治醫師,病床號,住院日期,
//   門診檢驗日期,門診醫令,門診檢驗數值, 急診檢驗日期,急診醫令,急診檢驗數值, 住院檢驗日期,住院醫令,住院檢驗數值
// 格式 B「檢驗結果(住院病人)-檢驗日期」（長表，一列一筆）:
//   病歷號,姓名,...,開單日,報告日期,病床號,來源(門/急/住),醫令,序號,細項名稱,結果
// 格式 C「8.1 報告區間明細門急住--檢驗院內碼」（長表，一列一筆，同次抽血 Cr 與 eGFR 各一列）:
//   來源(門診/急診/住院),病歷號,開單日,姓名,身份證字號,出生日期,年齡,性別,簽收日,醫令,細項序號,細項名稱,報告日,結果,買,醫師,科別
// 長表 B/C 共用一個解析器：欄位以表頭名稱定位，「腎絲球過濾率」列配對到同次抽血的 Cr 點。

const LONG_SOURCE_MAP = { 門: 'OPD', 急: 'ER', 住: 'IPD', 門診: 'OPD', 急診: 'ER', 住院: 'IPD' }

export function parseLabs(buffer) {
  const rows = readSheetRows(buffer)
  const { rangeStart, rangeEnd } = parseTitleRange(rows)
  const headerIdx = findHeaderRow(rows, '病歷號')
  if (headerIdx < 0) throw new Error('找不到表頭（缺「病歷號」欄），請確認是「CKD-AKI 病患明細」或「檢驗結果(住院病人)」報表')

  const header = (rows[headerIdx] || []).map((c) => String(c == null ? '' : c).trim())
  const isLongFormat = header.includes('來源') && header.includes('結果')
  const parsed = isLongFormat ? parseLabsLong(rows, headerIdx, header) : parseLabsWide(rows, headerIdx)
  return { rangeStart, rangeEnd, ...parsed }
}

// 格式 A：寬表（門診/急診/住院各三欄攤開）
function parseLabsWide(rows, headerIdx) {
  // (日期欄, 醫令欄, 數值欄, 來源代碼)
  const SRC = [
    { d: 7, o: 8, v: 9, source: 'OPD' },
    { d: 10, o: 11, v: 12, source: 'ER' },
    { d: 13, o: 14, v: 15, source: 'IPD' },
  ]
  const seen = new Set()
  const points = []
  let rowCount = 0
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i]
    const mrn = normalizeMrn(r?.[0])
    if (!mrn) continue
    rowCount++
    const name = String(r[1] || '').trim()
    for (const s of SRC) {
      const date = normalizeDate(r[s.d])
      const cr = toNumber(r[s.v])
      if (!date || cr == null) continue
      const key = `${mrn}|${s.source}|${date}|${cr}`
      if (seen.has(key)) continue
      seen.add(key)
      points.push({ mrn, name, source: s.source, testDate: date, creatinine: cr, orderCode: String(r[s.o] || '').trim() })
    }
  }
  return { rowCount, points }
}

// 格式 B/C：長表（一列一筆結果），欄位位置以表頭名稱定位
function parseLabsLong(rows, headerIdx, header) {
  const col = (...names) => {
    for (const n of names) {
      const i = header.indexOf(n)
      if (i >= 0) return i
    }
    return -1
  }
  const C = {
    mrn: col('病歷號'),
    name: col('姓名'),
    reportDate: col('報告日期', '報告日'),
    orderDate: col('開單日'),
    source: col('來源'),
    order: col('醫令'),
    item: col('細項名稱'),
    value: col('結果'),
  }
  const seen = new Set()
  const points = []
  const byGroup = new Map() // (病歷號|來源|日期) -> 該組 Cr 點，供 eGFR 配對
  const egfrRows = []
  let rowCount = 0
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i]
    const mrn = normalizeMrn(r?.[C.mrn])
    if (!mrn) continue
    rowCount++
    // 細項防呆：只收肌酸酐與腎絲球過濾率，其他細項略過（eGFR 數值誤當 Cr 會嚴重誤判分期）
    const item = C.item >= 0 ? String(r[C.item] || '').trim() : ''
    const isCr = item.includes('肌酸酐')
    const isEgfr = item.includes('過濾率')
    if (item && !isCr && !isEgfr) continue
    // 檢驗時點以報告日為主，缺值退回開單日
    const date = normalizeDate(r[C.reportDate]) || normalizeDate(r[C.orderDate])
    // 低於偵測極限的「<0.2」等非數值結果略過（沿用寬表行為，避免當 baseline 灌高比值）
    const val = toNumber(r[C.value])
    if (!date || val == null) continue
    const rawSource = String(r[C.source] || '').trim()
    const source = LONG_SOURCE_MAP[rawSource] || rawSource || 'IPD'
    const name = String(r[C.name] || '').trim()
    const orderCode = String(r[C.order] || '').trim()
    const gkey = `${mrn}|${source}|${date}`
    if (isEgfr) {
      egfrRows.push({ gkey, mrn, name, source, date, value: val, orderCode })
      continue
    }
    const key = `${gkey}|${val}`
    if (seen.has(key)) continue
    seen.add(key)
    const pt = { mrn, name, source, testDate: date, creatinine: val, egfr: null, orderCode }
    points.push(pt)
    if (!byGroup.has(gkey)) byGroup.set(gkey, [])
    byGroup.get(gkey).push(pt)
  }
  // eGFR 依 (病歷號|來源|日期) 配對到同組 Cr 點；同日多次抽血依出現順序依序配對
  const usedCount = new Map()
  for (const e of egfrRows) {
    const group = byGroup.get(e.gkey)
    const used = usedCount.get(e.gkey) || 0
    if (group && used < group.length) {
      if (group[used].egfr == null) group[used].egfr = e.value
      usedCount.set(e.gkey, used + 1)
    } else {
      // 無 Cr 可配（如該次 Cr 為 <0.2 被略過）→ 保留為 eGFR-only 點，仍可用於 CKD 追蹤
      const key = `${e.gkey}|egfr|${e.value}`
      if (seen.has(key)) continue
      seen.add(key)
      points.push({ mrn: e.mrn, name: e.name, source: e.source, testDate: e.date, creatinine: null, egfr: e.value, orderCode: e.orderCode })
    }
  }
  return { rowCount, points }
}

// ---------- KDIGO 分期 ----------

/**
 * 對單一病人的 Cr 散點做 KDIGO 分期。
 * @param {Array<{source,testDate,creatinine}>} rawPoints
 * @returns 分期結果物件
 */
export function stageForSeries(rawPoints) {
  const pts = (rawPoints || [])
    .filter((p) => p && p.testDate && typeof p.creatinine === 'number')
    .map((p) => ({ source: p.source, date: p.testDate, value: p.creatinine }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.value - b.value)

  const base = { points: pts, pointCount: pts.length }

  if (pts.length === 0) return { ...base, category: 'no-data', stage: null }

  const overallMin = Math.min(...pts.map((p) => p.value))
  const latest = pts[pts.length - 1]

  // 慢性高值 → ESRD（優先於其他判定）
  if (overallMin >= ESRD_MIN_CR) {
    return { ...base, category: 'esrd', stage: null, overallMin, latest }
  }

  if (pts.length === 1) {
    return { ...base, category: 'single', stage: null, latest }
  }

  // baseline 優先採門診(OPD)最低值當錨點
  const opd = pts.filter((p) => p.source === 'OPD')
  const opdBaseline = opd.length ? opd.reduce((m, p) => (p.value < m.value ? p : m), opd[0]) : null

  let best = { stage: 0, ratio: 1, abs: 0, baseline: pts[0], current: pts[0] }

  for (let i = 0; i < pts.length; i++) {
    const cur = pts[i]
    // 參考 baseline：門診錨點（若存在且不晚於當前點）與「時序前值最低」取較低者
    let ref = null
    if (opdBaseline && opdBaseline.date <= cur.date && opdBaseline !== cur) ref = opdBaseline
    const prior = pts.slice(0, i)
    if (prior.length) {
      const priorMin = prior.reduce((m, p) => (p.value < m.value ? p : m), prior[0])
      if (!ref || priorMin.value < ref.value) ref = priorMin
    }
    if (!ref) continue

    const ratio = cur.value / ref.value
    const abs = cur.value - ref.value
    let stage = 0
    if (ratio >= 3 || (cur.value >= STAGE3_ABS_CR && (ratio >= 1.5 || abs >= ABS_DELTA))) stage = 3
    else if (ratio >= 2) stage = 2
    else if (ratio >= 1.5 || abs >= ABS_DELTA) stage = 1

    if (stage > best.stage || (stage === best.stage && ratio > best.ratio)) {
      best = { stage, ratio, abs, baseline: ref, current: cur }
    }
  }

  const baselineMode = opdBaseline && best.baseline === opdBaseline ? 'OPD門診' : '時序前值最低'
  return {
    ...base,
    category: `stage-${best.stage}`,
    stage: best.stage,
    ratio: Number(best.ratio.toFixed(2)),
    absDelta: Number(best.abs.toFixed(2)),
    baseline: best.baseline,
    peak: best.current,
    baselineMode,
    overallMin,
    latest,
  }
}
