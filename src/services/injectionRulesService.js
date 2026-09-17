// 針劑解讀層 — 審核清單 / 當月總覽 / 個人藥物歷史 / 上傳 diff。
// 讀取一律經 dailyInjectionService.loadActiveInjectionRules（injection_order_rules 快照），
// 交叉檢查（規則星期 vs 病人洗腎日、日期已用盡）在讀取時即時算，因總表會變動、今天會前進。
import { v4 as uuidv4 } from 'uuid'
import { FREQ_MAP_TO_DAY_INDEX, SHIFTS } from '../utils/scheduleUtils.js'
import { getTaipeiTodayString } from '../utils/dateUtils.js'
import {
  INJECTION_MEDS,
  DAILY_INJECTION_EXCLUDED_CODES,
  isRuleScheduledOn,
  ruleDatesForYear,
  loadActiveInjectionRules,
  rebuildInjectionRules,
  getPatientNameMap,
  toInjectionRecord,
  sortByPatientThenCode,
} from './dailyInjectionService.js'

const WEEKDAY_ZH = ['', '一', '二', '三', '四', '五', '六', '日']

// ---------------------------------------------------------------------------
// 總表 / 病人 輔助
// ---------------------------------------------------------------------------
export function loadMasterRules(db) {
  const row = db.prepare(`SELECT schedule FROM base_schedules WHERE id = 'MASTER_SCHEDULE'`).get()
  try {
    return row ? JSON.parse(row.schedule || '{}') : {}
  } catch {
    return {}
  }
}

/** 病人洗腎日（1=週一 … 6=週六；injection 規則同一套編號）。無總表規則 → null */
export function dialysisDaysOf(masterRule) {
  const idx = masterRule?.freq ? FREQ_MAP_TO_DAY_INDEX[masterRule.freq] : null
  if (!idx) return null
  return idx.map((d) => d + 1)
}

function dowOf(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay() || 7
}

// ---------------------------------------------------------------------------
// 交叉檢查
// ---------------------------------------------------------------------------
/**
 * 回傳 [{ code, message }]：
 *  WEEKDAY_MISMATCH      規則星期不在病人洗腎日
 *  DATE_NOT_DIALYSIS_DAY 明確日期落在非洗腎日
 *  DATES_EXHAUSTED       日期制、日期全過期、HIS 未填停止日（會靜默消失，最危險）
 */
export function computeWarnings(row, rule, dialysisDays, today) {
  const warnings = []
  const freqLabel = row.masterFreq ? `（${row.masterFreq}）` : ''
  if (rule.kind === 'weekly' || rule.kind === 'interval') {
    if (dialysisDays) {
      const off = rule.days.filter((d) => !dialysisDays.includes(d))
      if (off.length) {
        warnings.push({
          code: 'WEEKDAY_MISMATCH',
          message: `規則週${off.map((d) => WEEKDAY_ZH[d]).join('、')} 非病人洗腎日${freqLabel}`,
        })
      }
    }
  } else if (rule.kind === 'dates') {
    const year = parseInt(today.slice(0, 4), 10)
    // 未寫年的 MMDD 先以今年解析；若早於處方開始日（如 12 月開立寫 0105），視為隔年
    const startDate = row.start_date || ''
    const dates = ruleDatesForYear(rule, year).map((d, i) =>
      !rule.dateTokens[i]?.year && startDate && d < startDate ? ruleDatesForYear(rule, year + 1)[i] : d,
    )
    if (dialysisDays) {
      const off = dates.filter((d) => !dialysisDays.includes(dowOf(d)))
      if (off.length) {
        warnings.push({
          code: 'DATE_NOT_DIALYSIS_DAY',
          message: `${off.map((d) => d.slice(5).replace('-', '/')).join('、')} 非洗腎日${freqLabel}`,
        })
      }
    }
    const endDate = row.end_date || ''
    if (!endDate && dates.length && dates.every((d) => d < today)) {
      warnings.push({
        code: 'DATES_EXHAUSTED',
        message: `列出的日期（${dates.map((d) => d.slice(5).replace('-', '/')).join('、')}）已全部過期，HIS 未填停止日`,
      })
    }
  }
  return warnings
}

const CATEGORY_ORDER = ['uncertain', 'dates_exhausted', 'weekday_mismatch', 'date_not_dialysis_day']
const CATEGORY_LABEL = {
  uncertain: '判不出星期幾',
  dates_exhausted: '日期已用盡',
  weekday_mismatch: '星期與洗腎日不符',
  date_not_dialysis_day: '日期非洗腎日',
}
export { CATEGORY_LABEL as INJECTION_REVIEW_CATEGORY_LABEL }

function categoryOf(ruleKind, warnings) {
  if (ruleKind === 'uncertain') return 'uncertain'
  const codes = warnings.map((w) => w.code)
  if (codes.includes('DATES_EXHAUSTED')) return 'dates_exhausted'
  if (codes.includes('WEEKDAY_MISMATCH')) return 'weekday_mismatch'
  if (codes.includes('DATE_NOT_DIALYSIS_DAY')) return 'date_not_dialysis_day'
  return null
}

function attachContext(db, rows) {
  const master = loadMasterRules(db)
  const ids = [...new Set(rows.map((r) => r.patient_id))]
  const nameMap = getPatientNameMap(db, ids)
  const deleted = new Set(
    ids.length
      ? db
          .prepare(`SELECT id FROM patients WHERE is_deleted = 1 AND id IN (${ids.map(() => '?').join(',')})`)
          .all(...ids)
          .map((r) => r.id)
      : [],
  )
  return { master, nameMap, deleted }
}

/**
 * 待審清單：uncertain + 任何交叉檢查警告。
 * 回傳 { targetDate, items:[record + category/categoryLabel/warnings/reason/dialysisDays/masterFreq], counts, latestBatch }
 */
export function getInjectionReview(db, targetDate, patientIds = null) {
  const today = getTaipeiTodayString()
  const scope = Array.isArray(patientIds) ? [...new Set(patientIds.filter(Boolean))] : null
  const rows = scope && scope.length === 0 ? [] : loadActiveInjectionRules(db, targetDate, scope)
  const { master, nameMap, deleted } = attachContext(db, rows)
  const items = []
  for (const row of rows) {
    if (deleted.has(row.patient_id)) continue
    const mr = master[row.patient_id]
    row.masterFreq = mr?.freq || ''
    const dialysisDays = dialysisDaysOf(mr)
    const warnings = computeWarnings(row, row.rule, dialysisDays, today)
    const category = categoryOf(row.rule_kind, warnings)
    if (!category) continue
    items.push({
      ...toInjectionRecord(row, nameMap),
      reason: row.reason,
      category,
      categoryLabel: CATEGORY_LABEL[category],
      warnings,
      dialysisDays,
      masterFreq: row.masterFreq,
    })
  }
  items.sort((a, b) => {
    const c = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category)
    return c !== 0 ? c : sortByPatientThenCode(a, b)
  })
  const counts = {}
  for (const c of CATEGORY_ORDER) counts[c] = items.filter((i) => i.category === c).length
  counts.total = items.length
  return { targetDate, items, counts, latestBatch: getLatestBatchSummary(db) }
}

// ---------------------------------------------------------------------------
// 當月總覽（醫師）
// ---------------------------------------------------------------------------
function monthDates(month) {
  const [y, m] = month.split('-').map((n) => parseInt(n, 10))
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const days = []
  for (let d = 1; d <= last; d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`
    days.push({ date, day: d, dow: dowOf(date) })
  }
  return days
}

/**
 * 列＝病人（總表班別/床位排序；無總表規則但有有效針劑者列在最後、班別空白），
 * 欄＝當月每天；cell = 當天該打的針劑。
 * options: { shift: 'early'|'noon'|'late'|null, codes: ['IFER2',...]|null, kinds: ['weekly','interval','dates','hold','uncertain']|null }
 */
export function getMonthlyInjectionMatrix(db, month, options = {}) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('month must be YYYY-MM')
  const today = getTaipeiTodayString()
  const days = monthDates(month)
  const monthStart = days[0].date
  const monthEnd = days[days.length - 1].date
  const codeFilter = options.codes?.length ? new Set(options.codes) : null
  const kindFilter = options.kinds?.length ? new Set(options.kinds) : null

  // 當月任一天有效的處方（用月底當 targetDate 取「開始 <= 月底」，再自行過濾結束日 >= 月初）
  const rows = loadActiveInjectionRules(db, monthEnd, null).filter((r) => !r.end_date || r.end_date >= monthStart)
  // loadActive 以 monthEnd 為基準已排除 start_date > monthEnd；但 end_date < monthEnd 的會被它排掉 → 補撈
  const extra = db
    .prepare(
      `SELECT io.*, r.rule_kind, r.rule_source, r.rule_text, r.rule_json, r.reason, r.override_id, r.order_key
       FROM injection_orders io JOIN injection_order_rules r ON r.order_id = io.id
       WHERE io.order_type = 'injection' AND io.start_date != '' AND io.start_date <= ?
         AND io.end_date != '' AND io.end_date IS NOT NULL AND io.end_date >= ? AND io.end_date < ?`,
    )
    .all(monthEnd, monthStart, monthEnd)
  const seenIds = new Set(rows.map((r) => r.id))
  for (const e of extra) {
    if (seenIds.has(e.id) || DAILY_INJECTION_EXCLUDED_CODES.has(e.order_code)) continue
    if (String(e.dose || '').trim() === '' || String(e.dose).trim() === '0') continue
    e.rule = JSON.parse(e.rule_json)
    rows.push(e)
  }

  const { master, nameMap, deleted } = attachContext(db, rows)
  const patients = db
    .prepare(`SELECT id, name, medical_record_number FROM patients WHERE is_deleted = 0`)
    .all()
  const patientInfo = new Map(patients.map((p) => [p.id, p]))

  const byPatient = new Map()
  for (const row of rows) {
    if (deleted.has(row.patient_id) || !patientInfo.has(row.patient_id)) continue
    if (codeFilter && !codeFilter.has(row.order_code)) continue
    if (kindFilter && !kindFilter.has(row.rule_kind)) continue
    if (!byPatient.has(row.patient_id)) byPatient.set(row.patient_id, [])
    byPatient.get(row.patient_id).push(row)
  }

  const result = []
  for (const [patientId, orders] of byPatient) {
    const mr = master[patientId]
    const shift = mr && mr.shiftIndex !== undefined ? SHIFTS[mr.shiftIndex] || '' : ''
    if (options.shift && shift !== options.shift) continue
    const dialysisDays = dialysisDaysOf(mr)
    const info = patientInfo.get(patientId)
    const orderSummaries = []
    const cells = {}
    for (const row of orders) {
      row.masterFreq = mr?.freq || ''
      const warnings = computeWarnings(row, row.rule, dialysisDays, today)
      const rec = toInjectionRecord(row, nameMap)
      orderSummaries.push({ ...rec, warnings, reason: row.reason })
      if (row.rule_kind === 'hold' || row.rule_kind === 'uncertain') continue
      for (const d of days) {
        if (row.start_date && d.date < row.start_date) continue
        if (row.end_date && d.date > row.end_date) continue
        if (!isRuleScheduledOn(row.rule, d.date)) continue
        if (!cells[d.date]) cells[d.date] = []
        cells[d.date].push({
          orderCode: rec.orderCode,
          orderName: rec.orderName,
          dose: rec.dose,
          unit: rec.unit,
          mismatch: dialysisDays ? !dialysisDays.includes(d.dow) : false,
        })
      }
    }
    result.push({
      patientId,
      patientName: info.name,
      medicalRecordNumber: info.medical_record_number,
      bedNum: mr?.bedNum ?? null,
      shift,
      freq: mr?.freq || '',
      dialysisDays,
      orders: orderSummaries.sort((a, b) => String(a.orderCode).localeCompare(String(b.orderCode))),
      cells,
    })
  }
  const shiftOrder = { early: 0, noon: 1, late: 2, '': 3 }
  result.sort((a, b) => {
    const s = shiftOrder[a.shift] - shiftOrder[b.shift]
    if (s !== 0) return s
    const ba = a.bedNum === null ? 9999 : Number(a.bedNum)
    const bb = b.bedNum === null ? 9999 : Number(b.bedNum)
    if (ba !== bb) return ba - bb
    return String(a.patientName).localeCompare(String(b.patientName), 'zh-Hant')
  })
  const meds = Object.entries(INJECTION_MEDS).map(([code, m]) => ({ code, name: m.tradeName, unit: m.unit }))
  return { month, days, rows: result, meds }
}

// ---------------------------------------------------------------------------
// 個人藥物歷史（時間軸）
// ---------------------------------------------------------------------------
function mapChangeRow(c, batch) {
  return {
    id: c.id,
    batchId: c.batch_id,
    uploadedAt: batch?.uploaded_at || c.created_at,
    sourceFile: batch?.source_file || '',
    uploadedByName: batch?.uploaded_by_name || '',
    patientId: c.patient_id,
    patientName: c.patient_name,
    medicalRecordNumber: c.medical_record_number,
    orderCode: c.order_code,
    orderName: c.order_name,
    orderType: c.order_type,
    startDate: c.start_date,
    changeType: c.change_type,
    changes: JSON.parse(c.changes_json || '[]'),
    before: c.before_json ? JSON.parse(c.before_json) : null,
    after: c.after_json ? JSON.parse(c.after_json) : null,
  }
}

export function getPatientMedicationHistory(db, patientId) {
  const orders = db
    .prepare(
      `SELECT io.*, r.rule_kind, r.rule_source, r.rule_text, r.reason, r.override_id
       FROM injection_orders io LEFT JOIN injection_order_rules r ON r.order_id = io.id
       WHERE io.patient_id = ?
       ORDER BY io.order_type DESC, io.order_code, io.start_date, io.created_at`,
    )
    .all(patientId)
    .map((o) => ({
      id: o.id,
      orderCode: o.order_code,
      orderName: INJECTION_MEDS[o.order_code]?.tradeName || o.order_name || o.order_code,
      rawName: o.order_name,
      orderType: o.order_type,
      dose: o.dose,
      unit: INJECTION_MEDS[o.order_code]?.unit || '',
      frequency: o.frequency,
      note: o.note,
      startDate: o.start_date || '',
      endDate: o.end_date || '',
      changeDate: o.change_date || '',
      prescriber: o.prescriber || '',
      ruleKind: o.rule_kind || null,
      ruleText: o.rule_text || '',
      ruleSource: o.rule_source || null,
      reason: o.reason || '',
      overrideId: o.override_id || null,
    }))
  const batches = new Map(db.prepare(`SELECT * FROM injection_upload_batches`).all().map((b) => [b.id, b]))
  const changes = db
    .prepare(`SELECT * FROM injection_upload_changes WHERE patient_id = ? ORDER BY created_at DESC`)
    .all(patientId)
    .map((c) => mapChangeRow(c, batches.get(c.batch_id)))
  return { patientId, orders, changes }
}

// ---------------------------------------------------------------------------
// 上傳 diff / 批次
// ---------------------------------------------------------------------------
const DIFF_FIELDS = ['dose', 'frequency', 'note', 'end_date', 'order_name']

function diffKeyBase(o) {
  return `${o.patient_id}|${o.order_code}|${o.start_date || ''}`
}

/** 同 (病人,藥碼,開始日) 多列時依 (頻率,備註,劑量) 排序加序號，讓單列的備註修改仍判成 modified */
function buildDiffMap(rows) {
  const groups = new Map()
  for (const r of rows) {
    const k = diffKeyBase(r)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(r)
  }
  const map = new Map()
  for (const [k, list] of groups) {
    list.sort((a, b) =>
      `${a.frequency}|${a.note}|${a.dose}`.localeCompare(`${b.frequency}|${b.note}|${b.dose}`),
    )
    list.forEach((r, i) => map.set(`${k}#${i}`, r))
  }
  return map
}

/** 上傳前呼叫：取整表快照供 diff */
export function snapshotOrdersForDiff(db) {
  return buildDiffMap(db.prepare(`SELECT * FROM injection_orders`).all())
}

function pick(o) {
  return {
    dose: String(o.dose ?? ''),
    frequency: o.frequency || '',
    note: o.note || '',
    end_date: o.end_date || '',
    order_name: o.order_name || '',
    prescriber: o.prescriber || '',
    change_date: o.change_date || '',
  }
}

/**
 * 上傳寫入後呼叫：與快照比對 → 寫 batch + changes，重建解讀層，回傳報告。
 * summary：{ counts:{new,stopped,removed,modified}, interpretation:{weekly,interval,dates,hold,uncertain,total},
 *            warnings:{WEEKDAY_MISMATCH,...}, review: 待審總數 }
 */
export function recordUploadBatch(db, { sourceFile, user, beforeMap, rowCount }) {
  const afterMap = buildDiffMap(db.prepare(`SELECT * FROM injection_orders`).all())
  const changes = []
  for (const [key, after] of afterMap) {
    const before = beforeMap.get(key)
    if (!before) {
      changes.push({ type: 'new', after, before: null, fields: [] })
      continue
    }
    const fields = []
    const b = pick(before)
    const a = pick(after)
    for (const f of DIFF_FIELDS) {
      if (b[f] !== a[f]) fields.push({ field: f, before: b[f], after: a[f] })
    }
    if (!fields.length) continue
    const type = !b.end_date && a.end_date ? 'stopped' : 'modified'
    changes.push({ type, after, before, fields })
  }
  for (const [key, before] of beforeMap) {
    if (!afterMap.has(key)) changes.push({ type: 'removed', after: null, before, fields: [] })
  }

  rebuildInjectionRules(db)

  const today = getTaipeiTodayString()
  const review = getInjectionReview(db, today, null)
  const kinds = db
    .prepare(`SELECT rule_kind, COUNT(*) AS c FROM injection_order_rules GROUP BY rule_kind`)
    .all()
  const interpretation = { weekly: 0, interval: 0, dates: 0, hold: 0, uncertain: 0, total: 0 }
  for (const k of kinds) {
    interpretation[k.rule_kind] = k.c
    interpretation.total += k.c
  }
  const warningCounts = {}
  for (const item of review.items) for (const w of item.warnings) warningCounts[w.code] = (warningCounts[w.code] || 0) + 1

  const counts = { new: 0, stopped: 0, removed: 0, modified: 0 }
  for (const c of changes) counts[c.type]++
  const summary = {
    counts,
    interpretation,
    warnings: warningCounts,
    review: review.counts,
    isFirstBatch: beforeMap.size === 0,
  }

  const batchId = uuidv4()
  const insertChange = db.prepare(`
    INSERT INTO injection_upload_changes
      (id, batch_id, patient_id, patient_name, medical_record_number, order_code, order_name, order_type,
       start_date, change_type, changes_json, before_json, after_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  db.transaction(() => {
    db.prepare(
      `INSERT INTO injection_upload_batches (id, source_file, uploaded_by_id, uploaded_by_name, row_count, summary_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(batchId, sourceFile || '', user?.id || null, user?.name || null, rowCount || 0, JSON.stringify(summary))
    // 第一批（表原本是空的）不逐筆記 new，避免灌進數千筆無意義的「新增」
    if (!summary.isFirstBatch) {
      for (const c of changes) {
        const src = c.after || c.before
        insertChange.run(
          uuidv4(),
          batchId,
          src.patient_id,
          src.patient_name,
          src.medical_record_number,
          src.order_code,
          src.order_name,
          src.order_type,
          src.start_date || '',
          c.type,
          JSON.stringify(c.fields),
          c.before ? JSON.stringify(pick(c.before)) : null,
          c.after ? JSON.stringify(pick(c.after)) : null,
        )
      }
    }
  })()

  const preview = changes.slice(0, 200).map((c) => {
    const src = c.after || c.before
    return {
      patientName: src.patient_name,
      medicalRecordNumber: src.medical_record_number,
      orderCode: src.order_code,
      orderName: INJECTION_MEDS[src.order_code]?.tradeName || src.order_name,
      orderType: src.order_type,
      startDate: src.start_date || '',
      changeType: c.type,
      changes: c.fields,
    }
  })
  return { batchId, summary, changeCount: changes.length, changes: preview }
}

export function getLatestBatchSummary(db) {
  const b = db.prepare(`SELECT * FROM injection_upload_batches ORDER BY uploaded_at DESC LIMIT 1`).get()
  if (!b) return null
  const changeCount = db
    .prepare(`SELECT COUNT(*) AS c FROM injection_upload_changes WHERE batch_id = ?`)
    .get(b.id).c
  return {
    id: b.id,
    sourceFile: b.source_file,
    uploadedAt: b.uploaded_at,
    uploadedByName: b.uploaded_by_name,
    rowCount: b.row_count,
    summary: JSON.parse(b.summary_json || '{}'),
    changeCount,
  }
}

export function listUploadBatches(db, limit = 50) {
  const rows = db.prepare(`SELECT * FROM injection_upload_batches ORDER BY uploaded_at DESC LIMIT ?`).all(limit)
  const counts = new Map(
    db
      .prepare(`SELECT batch_id, COUNT(*) AS c FROM injection_upload_changes GROUP BY batch_id`)
      .all()
      .map((r) => [r.batch_id, r.c]),
  )
  return rows.map((b) => ({
    id: b.id,
    sourceFile: b.source_file,
    uploadedAt: b.uploaded_at,
    uploadedByName: b.uploaded_by_name,
    rowCount: b.row_count,
    summary: JSON.parse(b.summary_json || '{}'),
    changeCount: counts.get(b.id) || 0,
  }))
}

export function listBatchChanges(db, batchId, { patientId = null, orderType = null } = {}) {
  const batch = db.prepare(`SELECT * FROM injection_upload_batches WHERE id = ?`).get(batchId)
  if (!batch) return null
  let sql = `SELECT * FROM injection_upload_changes WHERE batch_id = ?`
  const params = [batchId]
  if (patientId) {
    sql += ` AND patient_id = ?`
    params.push(patientId)
  }
  if (orderType) {
    sql += ` AND order_type = ?`
    params.push(orderType)
  }
  sql += ` ORDER BY change_type, patient_name, order_code`
  return db.prepare(sql).all(...params).map((c) => mapChangeRow(c, batch))
}
