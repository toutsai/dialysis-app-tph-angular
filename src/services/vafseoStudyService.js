// Vafseo (vadadustat) 真實世界分析服務（研究專用頁 /api/research）
// 資料來源：injection_orders（區間模型藥囑：OVAF / INES2 / IREC1）+ lab_reports（results JSON）
// 全部唯讀；分析參數（換算比、時間窗、排除名單）由 site_config id='vafseo_study_config' 提供
import { getDatabase } from '../db/init.js'

export const DEFAULT_CONFIG = {
  // 1 mcg darbepoetin ≈ 200 IU epoetin（仿單換算；敏感度分析常用 300）
  darbeRatio: 200,
  // 事件時間窗（相對 Vafseo 起始月的月位移）
  baselineFrom: -3,
  baselineTo: -1,
  postFrom: 3,
  postTo: 6,
  offsetMin: -6,
  offsetMax: 12,
  excludedPatientIds: [],
  notes: ''
}

const ESA_UNIT_TO_IU = {
  INES2: (dose, ratio) => dose * ratio, // dose 單位 mcg (darbepoetin)
  IREC1: (dose) => dose * 1000 // dose 單位 KIU (epoetin beta)
}

// ---- 頻率字串 → 每週次數 ----------------------------------------------------
// 實際資料樣態：QW246/QW135/QW26/QW/QW1、Q2W1/Q2W/「Q2W W2」、Q7D、QOD、QD、W2、qw4
export function parseFreqPerWeek(raw) {
  if (raw === null || raw === undefined) return null
  const s = String(raw).trim().toUpperCase().replace(/\s+/g, '')
  if (!s || s === 'STAT') return null
  if (s === 'QD') return 7
  if (s === 'QOD') return 3.5
  let m = s.match(/^Q(\d*)W(\d*)$/)
  if (m) {
    const interval = m[1] ? parseInt(m[1], 10) : 1
    const perWeekDays = m[2] ? m[2].length : 1
    return interval > 0 ? perWeekDays / interval : null
  }
  m = s.match(/^Q(\d+)D$/)
  if (m) return 7 / parseInt(m[1], 10)
  m = s.match(/^W\d+$/)
  if (m) return 1
  m = s.match(/^Q2WW\d+/) // 「Q2W W2」空白已移除
  if (m) return 0.5
  return null
}

// ---- 日期/月份工具（皆為 YYYY-MM-DD 字串運算，不經 Date 時區） ----------------
function monthIndexOf(dateStr) {
  const y = parseInt(dateStr.slice(0, 4), 10)
  const mo = parseInt(dateStr.slice(5, 7), 10)
  if (!y || !mo) return null
  return y * 12 + (mo - 1)
}
function monthKeyFromIndex(idx) {
  const y = Math.floor(idx / 12)
  const mo = (idx % 12) + 1
  return `${y}-${String(mo).padStart(2, '0')}`
}
function daysInMonthOfIndex(idx) {
  const y = Math.floor(idx / 12)
  const mo = (idx % 12) + 1
  return new Date(y, mo, 0).getDate() // 月長度計算，無時區疑慮
}
function monthStartKey(idx) { return `${monthKeyFromIndex(idx)}-01` }
function monthEndKey(idx) { return `${monthKeyFromIndex(idx)}-${String(daysInMonthOfIndex(idx)).padStart(2, '0')}` }
function dayOfMonth(dateStr) { return parseInt(dateStr.slice(8, 10), 10) || 1 }

// 該藥囑列在指定月份的活躍天數比例（0~1），支援區間跨月與月中起訖
function activeFractionInMonth(row, monthIdx) {
  const start = row.start_date
  if (!start) return 0
  const end = row.end_date && row.end_date !== '' ? row.end_date : '9999-12-31'
  const mStart = monthStartKey(monthIdx)
  const mEnd = monthEndKey(monthIdx)
  if (start > mEnd || end < mStart) return 0
  const from = start > mStart ? dayOfMonth(start) : 1
  const to = end < mEnd ? dayOfMonth(end) : daysInMonthOfIndex(monthIdx)
  const days = to - from + 1
  return days > 0 ? days / daysInMonthOfIndex(monthIdx) : 0
}

// ---- 統計工具 ---------------------------------------------------------------
function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null }
function sd(arr) {
  if (arr.length < 2) return null
  const m = mean(arr)
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) * (b - m), 0) / (arr.length - 1))
}
function round(v, d = 2) { return v === null || v === undefined || Number.isNaN(v) ? null : Math.round(v * 10 ** d) / 10 ** d }

// Student t 分布雙尾 p 值（incomplete beta，Numerical Recipes 標準作法）
function lnGamma(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5]
  let y = x
  let tmp = x + 5.5
  tmp -= (x + 0.5) * Math.log(tmp)
  let ser = 1.000000000190015
  for (let j = 0; j < 6; j++) ser += c[j] / ++y
  return -tmp + Math.log(2.5066282746310005 * ser / x)
}
function betacf(a, b, x) {
  const MAXIT = 200; const EPS = 3e-12; const FPMIN = 1e-300
  const qab = a + b; const qap = a + 1; const qam = a - 1
  let c = 1
  let d = 1 - qab * x / qap
  if (Math.abs(d) < FPMIN) d = FPMIN
  d = 1 / d
  let h = d
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    h *= d * c
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < EPS) break
  }
  return h
}
function betai(a, b, x) {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x))
  if (x < (a + 1) / (a + b + 2)) return bt * betacf(a, b, x) / a
  return 1 - bt * betacf(b, a, 1 - x) / b
}
function tTwoTailedP(t, df) {
  if (!Number.isFinite(t) || df <= 0) return null
  return betai(df / 2, 0.5, df / (df + t * t))
}
function normalTwoTailedP(z) {
  // Abramowitz–Stegun 7.1.26 erf 近似（|誤差| < 1.5e-7）
  const x = Math.abs(z) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * x)
  const poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t
  const erf = 1 - poly * Math.exp(-x * x)
  const p = 2 * (1 - 0.5 * (1 + erf))
  return Math.min(1, Math.max(0, p))
}
// Wilcoxon signed-rank（常態近似 + 同分修正），回傳雙尾 p
function wilcoxonSignedRankP(pairsA, pairsB) {
  const diffs = pairsA.map((a, i) => a - pairsB[i]).filter((d) => d !== 0)
  const n = diffs.length
  if (n < 6) return null // 樣本太小常態近似不可靠
  const sorted = diffs.map((d) => ({ d, abs: Math.abs(d) })).sort((a, b) => a.abs - b.abs)
  const ranks = new Array(n)
  let i = 0
  let tieCorrection = 0
  while (i < n) {
    let j = i
    while (j + 1 < n && sorted[j + 1].abs === sorted[i].abs) j++
    const avgRank = (i + j + 2) / 2
    const tieLen = j - i + 1
    if (tieLen > 1) tieCorrection += tieLen ** 3 - tieLen
    for (let k = i; k <= j; k++) ranks[k] = avgRank
    i = j + 1
  }
  let wPlus = 0
  sorted.forEach((s, idx) => { if (s.d > 0) wPlus += ranks[idx] })
  const mu = n * (n + 1) / 4
  const sigma = Math.sqrt(n * (n + 1) * (2 * n + 1) / 24 - tieCorrection / 48)
  if (sigma === 0) return null
  const z = (wPlus - mu - Math.sign(wPlus - mu) * 0.5) / sigma
  return normalTwoTailedP(z)
}
// 成對比較：回傳 n、前後平均、差值、95%CI、配對 t 與 Wilcoxon p
function pairedCompare(pairs) {
  const a = pairs.map((p) => p[0])
  const b = pairs.map((p) => p[1])
  const n = pairs.length
  if (n < 2) return { n, baselineMean: round(mean(a)), postMean: round(mean(b)), meanDiff: null, ci95: null, tP: null, wilcoxonP: null }
  const diffs = pairs.map((p) => p[1] - p[0])
  const md = mean(diffs)
  const sdd = sd(diffs)
  const se = sdd / Math.sqrt(n)
  const t = se > 0 ? md / se : 0
  const p = se > 0 ? tTwoTailedP(t, n - 1) : null
  return {
    n,
    baselineMean: round(mean(a)),
    baselineSd: round(sd(a)),
    postMean: round(mean(b)),
    postSd: round(sd(b)),
    meanDiff: round(md),
    ci95: se > 0 ? [round(md - 1.96 * se), round(md + 1.96 * se)] : null,
    tP: p === null ? null : round(p, 4),
    wilcoxonP: (() => { const w = wilcoxonSignedRankP(b, a); return w === null ? null : round(w, 4) })()
  }
}

// ---- 日曆月趨勢（全中心兩大區塊：貧血 / 鈣磷）--------------------------------
// dose 欄語意（2026-08-18 對照實際資料）：IFER2/IPAR1 存 mg、ICAC 存 mcg、
// OUCA1 存顆數(×0.5mcg)、OVAF 存顆數(×300mg)、INES2 存 mcg、IREC1 存 KIU
const TREND_BLOCKS = [
  {
    key: 'anemia',
    title: '貧血',
    drugs: [
      { key: 'esa', label: 'ESA (epoetin 當量)', unit: 'IU/wk', dec: 0, codes: ['INES2', 'IREC1'], toDose: (row, dose, ratio) => (row.order_code === 'INES2' ? dose * ratio : dose * 1000) },
      { key: 'vafseo', label: 'Vafseo', unit: 'mg/wk', dec: 0, codes: ['OVAF'], toDose: (row, dose) => dose * 300 },
      { key: 'goodfe', label: 'GoodFe (靜脈鐵)', unit: 'mg/wk', dec: 0, codes: ['IFER2'], toDose: (row, dose) => dose }
    ],
    labs: [
      { key: 'Hb', label: 'Hb', unit: 'g/dL', dec: 2 },
      { key: 'Ferritin', label: 'Ferritin', unit: 'ng/mL', dec: 0 },
      { key: 'TSAT', label: 'TSAT', unit: '%', dec: 1 },
      { key: 'iPTH', label: 'iPTH', unit: 'pg/mL', dec: 1 }
    ]
  },
  {
    key: 'mineral',
    title: '鈣磷',
    drugs: [
      { key: 'parsabiv', label: 'Parsabiv (etelcalcetide)', unit: 'mg/wk', dec: 2, codes: ['IPAR1'], toDose: (row, dose) => dose },
      { key: 'cacare', label: 'Cacare (calcitriol 注射)', unit: 'mcg/wk', dec: 1, codes: ['ICAC'], toDose: (row, dose) => dose },
      { key: 'uca', label: 'U-Ca (口服活性維生素D)', unit: 'mcg/wk', dec: 2, codes: ['OUCA1'], toDose: (row, dose) => dose * 0.5 }
    ],
    labs: [
      { key: 'Ca', label: 'Ca', unit: 'mg/dL', dec: 2 },
      { key: 'P', label: 'P', unit: 'mg/dL', dec: 2 },
      { key: 'iPTH', label: 'iPTH', unit: 'pg/mL', dec: 1 }
    ]
  }
]

export function buildMonthlyTrends(userConfig = {}) {
  const config = { ...DEFAULT_CONFIG, ...userConfig }
  const db = getDatabase()

  const allCodes = [...new Set(TREND_BLOCKS.flatMap((b) => b.drugs.flatMap((d) => d.codes)))]
  const orderRows = db.prepare(`
    SELECT patient_id, order_code, dose, frequency, note, start_date, end_date
    FROM injection_orders
    WHERE order_code IN (${allCodes.map(() => '?').join(',')})
      AND start_date IS NOT NULL AND start_date != ''
  `).all(...allCodes)

  // 月範圍：藥囑最早起始月 ~ 本月（檢驗較早的月份只有 lab 沒藥囑資訊，一併納入）
  const nowIdx = monthIndexOf(new Date().toLocaleDateString('sv-SE'))
  let minIdx = nowIdx
  for (const r of orderRows) {
    const mi = monthIndexOf(r.start_date)
    if (mi !== null && mi < minIdx) minIdx = mi
  }
  const labMin = db.prepare('SELECT MIN(report_date) a FROM lab_reports').get()
  if (labMin && labMin.a) {
    const mi = monthIndexOf(labMin.a)
    if (mi !== null && mi < minIdx) minIdx = mi
  }
  const monthIdxs = []
  for (let mi = minIdx; mi <= nowIdx; mi++) monthIdxs.push(mi)

  // 檢驗逐月彙整（全中心；TSAT = Iron/TIBC×100 即時計算）
  const labMonthly = new Map()
  for (const lr of db.prepare('SELECT report_date, results FROM lab_reports').all()) {
    const mi = monthIndexOf(lr.report_date)
    if (mi === null || mi < minIdx || mi > nowIdx) continue
    let data
    try { data = JSON.parse(lr.results || '{}') } catch { continue }
    let bucket = labMonthly.get(mi)
    if (!bucket) { bucket = {}; labMonthly.set(mi, bucket) }
    for (const key of ['Hb', 'Ferritin', 'iPTH', 'Ca', 'P']) {
      const v = parseFloat(data[key])
      if (!Number.isFinite(v)) continue
      ;(bucket[key] = bucket[key] || []).push(v)
    }
    const iron = parseFloat(data.Iron)
    const tibc = parseFloat(data.TIBC)
    if (iron > 0 && tibc > 0) (bucket.TSAT = bucket.TSAT || []).push((iron / tibc) * 100)
  }

  const blocks = TREND_BLOCKS.map((b) => ({
    key: b.key,
    title: b.title,
    drugs: b.drugs.map((d) => {
      const byPatient = new Map()
      for (const r of orderRows) {
        if (!d.codes.includes(r.order_code)) continue
        if (!byPatient.has(r.patient_id)) byPatient.set(r.patient_id, [])
        byPatient.get(r.patient_id).push(r)
      }
      const points = monthIdxs.map((mi) => {
        const values = []
        for (const prows of byPatient.values()) {
          let total = 0
          let found = false
          for (const row of prows) {
            const frac = activeFractionInMonth(row, mi)
            if (frac <= 0) continue
            const doseNum = parseFloat(row.dose)
            if (!Number.isFinite(doseNum)) continue
            let freq = parseFreqPerWeek(row.note)
            if (freq === null) freq = parseFreqPerWeek(row.frequency)
            if (freq === null) freq = 1
            total += d.toDose(row, doseNum, config.darbeRatio) * freq * frac
            found = true
          }
          if (found && total > 0) values.push(total)
        }
        return {
          month: monthKeyFromIndex(mi),
          users: values.length,
          meanWeekly: values.length ? round(mean(values), d.dec) : null
        }
      })
      return { key: d.key, label: d.label, unit: d.unit, points }
    }),
    labs: b.labs.map((l) => ({
      key: l.key,
      label: l.label,
      unit: l.unit,
      points: monthIdxs.map((mi) => {
        const vals = (labMonthly.get(mi) || {})[l.key] || []
        return { month: monthKeyFromIndex(mi), n: vals.length, mean: vals.length ? round(mean(vals), l.dec) : null }
      })
    }))
  }))

  return {
    generatedAt: new Date().toLocaleString('sv-SE'),
    months: monthIdxs.map(monthKeyFromIndex),
    blocks
  }
}

// ---- 主分析 -----------------------------------------------------------------
export function buildVafseoStudy(userConfig = {}) {
  const config = { ...DEFAULT_CONFIG, ...userConfig }
  const db = getDatabase()
  const warnings = { unparsedFreqRows: 0 }

  // 1. 世代：曾開立 OVAF 且有開始日者；index date = 第一筆 OVAF 開始日
  const cohortRows = db.prepare(`
    SELECT patient_id, MIN(start_date) AS index_date,
           MAX(patient_name) AS patient_name, MAX(medical_record_number) AS mrn
    FROM injection_orders
    WHERE order_code = 'OVAF' AND start_date IS NOT NULL AND start_date != ''
    GROUP BY patient_id
  `).all()
  const excludedSet = new Set(config.excludedPatientIds || [])

  const ids = cohortRows.map((r) => r.patient_id)
  if (!ids.length) {
    return { generatedAt: null, config, warnings, cohort: { total: 0, included: 0, excluded: 0, startByMonth: [] }, eventTime: [], outcomes: {}, patients: [] }
  }

  // 2. 藥囑（分塊 IN 避免 SQLite 參數上限）
  const medRows = []
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500)
    medRows.push(...db.prepare(`
      SELECT patient_id, order_code, dose, frequency, note, start_date, end_date
      FROM injection_orders
      WHERE order_code IN ('OVAF','INES2','IREC1') AND patient_id IN (${chunk.map(() => '?').join(',')})
    `).all(...chunk))
  }
  const medsByPatient = new Map()
  for (const r of medRows) {
    if (!medsByPatient.has(r.patient_id)) medsByPatient.set(r.patient_id, [])
    medsByPatient.get(r.patient_id).push(r)
  }

  // 3. 檢驗（Hb/Ca/P 每月；iPTH 季月 3/6/9/12）
  const labByPatient = new Map()
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500)
    const rows = db.prepare(`
      SELECT patient_id, report_date, results
      FROM lab_reports
      WHERE patient_id IN (${chunk.map(() => '?').join(',')})
    `).all(...chunk)
    for (const r of rows) {
      if (!labByPatient.has(r.patient_id)) labByPatient.set(r.patient_id, [])
      labByPatient.get(r.patient_id).push(r)
    }
  }

  const currentMonthIdx = monthIndexOf(new Date().toLocaleDateString('sv-SE'))

  // 每週劑量計算（依月活躍天數加權，處理月中換藥/停藥）
  function weeklyValueInMonth(rows, monthIdx, calc) {
    let total = 0
    let found = false
    for (const row of rows) {
      const frac = activeFractionInMonth(row, monthIdx)
      if (frac <= 0) continue
      const doseNum = parseFloat(row.dose)
      if (!Number.isFinite(doseNum)) continue
      // 針劑頻率寫在 note、口服寫在 frequency；都解析不了以每週 1 次估計並記警告
      let freq = parseFreqPerWeek(row.note)
      if (freq === null) freq = parseFreqPerWeek(row.frequency)
      if (freq === null) { freq = 1; warnings.unparsedFreqRows++ }
      total += calc(row, doseNum) * freq * frac
      found = true
    }
    return found ? total : null
  }

  const offsets = []
  for (let o = config.offsetMin; o <= config.offsetMax; o++) offsets.push(o)

  const patients = []
  for (const c of cohortRows) {
    const indexMonthIdx = monthIndexOf(c.index_date)
    const meds = medsByPatient.get(c.patient_id) || []
    const esaRows = meds.filter((m) => m.order_code === 'INES2' || m.order_code === 'IREC1')
    const vafRows = meds.filter((m) => m.order_code === 'OVAF')

    // 檢驗值按月彙整（同月多筆取平均）
    const labMonthly = {}
    for (const lr of labByPatient.get(c.patient_id) || []) {
      const mi = monthIndexOf(lr.report_date)
      if (mi === null) continue
      let data
      try { data = JSON.parse(lr.results || '{}') } catch { continue }
      for (const key of ['Hb', 'Ca', 'P', 'iPTH']) {
        const v = parseFloat(data[key])
        if (!Number.isFinite(v)) continue
        if (!labMonthly[mi]) labMonthly[mi] = {}
        if (!labMonthly[mi][key]) labMonthly[mi][key] = []
        labMonthly[mi][key].push(v)
      }
    }

    const months = {}
    for (const o of offsets) {
      const mi = indexMonthIdx + o
      if (mi > currentMonthIdx) break
      const lab = labMonthly[mi] || {}
      const esaEqRaw = round(weeklyValueInMonth(esaRows, mi, (row, dose) => ESA_UNIT_TO_IU[row.order_code](dose, config.darbeRatio)), 0)
      const vafseoMgWk = round(weeklyValueInMonth(vafRows, mi, (row, dose) => dose * 300), 0)
      months[o] = {
        hb: round(mean(lab.Hb || [])),
        ca: round(mean(lab.Ca || [])),
        p: round(mean(lab.P || [])),
        ipth: round(mean(lab.iPTH || []), 1),
        // Vafseo 活躍月而無 ESA 藥囑 = 已停用 ESA，記 0。
        // 否則停用者的 post ESA 是 null，會被配對比較剔除→停用率永遠 0、劑量差高估
        esaEq: esaEqRaw === null && vafseoMgWk !== null ? 0 : esaEqRaw,
        vafseoMgWk
      }
    }

    const windowMean = (key, from, to, minCount = 1) => {
      const vals = []
      for (let o = from; o <= to; o++) {
        const v = months[o] ? months[o][key] : null
        if (v !== null && v !== undefined) vals.push(v)
      }
      return vals.length >= minCount ? mean(vals) : null
    }
    // iPTH 季抽血：baseline 取前 6 個月內全部值（通常 1-2 筆），post 取 +1..offsetMax
    const ipthBaseline = windowMean('ipth', -6, 0)
    const ipthPost = windowMean('ipth', 1, config.offsetMax)

    patients.push({
      patientId: c.patient_id,
      name: c.patient_name || '',
      mrn: c.mrn || '',
      indexDate: c.index_date,
      excluded: excludedSet.has(c.patient_id),
      baselineHb: round(windowMean('hb', config.baselineFrom, config.baselineTo)),
      postHb: round(windowMean('hb', config.postFrom, config.postTo)),
      baselineEsaEq: round(windowMean('esaEq', config.baselineFrom, config.baselineTo), 0),
      postEsaEq: round(windowMean('esaEq', config.postFrom, config.postTo), 0),
      baselineIpth: round(ipthBaseline, 1),
      postIpth: round(ipthPost, 1),
      baselineCa: round(windowMean('ca', config.baselineFrom, config.baselineTo)),
      postCa: round(windowMean('ca', config.postFrom, config.postTo)),
      baselineP: round(windowMean('p', config.baselineFrom, config.baselineTo)),
      postP: round(windowMean('p', config.postFrom, config.postTo)),
      months
    })
  }

  const included = patients.filter((p) => !p.excluded)

  // 事件時間聚合（僅納入未排除者）
  const eventTime = offsets.map((o) => {
    const rowsAt = included.map((p) => p.months[o]).filter(Boolean)
    const pick = (key) => rowsAt.map((m) => m[key]).filter((v) => v !== null && v !== undefined)
    const hbVals = pick('hb')
    const esaVals = pick('esaEq')
    const withEsaData = rowsAt.filter((m) => m.esaEq !== null || m.vafseoMgWk !== null)
    return {
      offset: o,
      hb: { n: hbVals.length, mean: round(mean(hbVals)), sd: round(sd(hbVals)) },
      hbInRange115Pct: hbVals.length ? round(hbVals.filter((v) => v >= 10 && v <= 11.5).length / hbVals.length * 100, 1) : null,
      hbInRange12Pct: hbVals.length ? round(hbVals.filter((v) => v >= 10 && v <= 12).length / hbVals.length * 100, 1) : null,
      esaEq: { n: esaVals.length, mean: round(mean(esaVals), 0), sd: round(sd(esaVals), 0) },
      esaUserPct: withEsaData.length ? round(rowsAt.filter((m) => (m.esaEq || 0) > 0).length / withEsaData.length * 100, 1) : null,
      vafseoMgWk: { n: pick('vafseoMgWk').length, mean: round(mean(pick('vafseoMgWk')), 0) },
      ca: { n: pick('ca').length, mean: round(mean(pick('ca'))), sd: round(sd(pick('ca'))) },
      p: { n: pick('p').length, mean: round(mean(pick('p'))), sd: round(sd(pick('p'))) },
      ipth: { n: pick('ipth').length, mean: round(mean(pick('ipth')), 1), sd: round(sd(pick('ipth')), 1) }
    }
  })

  // 主要成對比較（baseline 與 post 皆有值者）
  const pairsOf = (baseKey, postKey) => included
    .filter((p) => p[baseKey] !== null && p[postKey] !== null)
    .map((p) => [p[baseKey], p[postKey]])
  const esaBaselineUsers = included.filter((p) => (p.baselineEsaEq || 0) > 0 && p.postEsaEq !== null)
  const esaStopped = esaBaselineUsers.filter((p) => (p.postEsaEq || 0) === 0)

  const outcomes = {
    hb: pairedCompare(pairsOf('baselineHb', 'postHb')),
    esaEq: pairedCompare(pairsOf('baselineEsaEq', 'postEsaEq')),
    esaDiscontinuation: {
      baselineUsers: esaBaselineUsers.length,
      stopped: esaStopped.length,
      pct: esaBaselineUsers.length ? round(esaStopped.length / esaBaselineUsers.length * 100, 1) : null
    },
    ipth: pairedCompare(pairsOf('baselineIpth', 'postIpth')),
    ca: pairedCompare(pairsOf('baselineCa', 'postCa')),
    p: pairedCompare(pairsOf('baselineP', 'postP'))
  }

  // 起始月分布
  const startByMonthMap = new Map()
  for (const p of patients) {
    const key = p.indexDate.slice(0, 7)
    startByMonthMap.set(key, (startByMonthMap.get(key) || 0) + 1)
  }
  const startByMonth = [...startByMonthMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, n]) => ({ month, n }))

  return {
    generatedAt: new Date().toLocaleString('sv-SE'),
    config,
    warnings,
    cohort: { total: patients.length, included: included.length, excluded: patients.length - included.length, startByMonth },
    eventTime,
    outcomes,
    patients
  }
}
