import { v4 as uuidv4 } from 'uuid'

const INJECTION_MEDS = {
  INES2: { tradeName: 'NESP', unit: 'mcg' },
  IREC1: { tradeName: 'Recormon', unit: 'KIU' },
  IFER2: { tradeName: 'Good-Fe', unit: 'mg' },
  ICAC: { tradeName: 'Cacare', unit: 'amp' },
  IPAR1: { tradeName: 'Parsabiv', unit: 'mg' },
}

// 每日應打清單刻意不列的針劑藥碼：
// IGEN2（Gentamicin，permcath lock 用）書記已有獨立的 Gentamycin 開立清單，
// 且區間格式上傳把所有 I 開頭藥碼都歸為 injection，若不排除會在改讀頻率欄後突然出現。
export const DAILY_INJECTION_EXCLUDED_CODES = new Set(['IGEN2'])

function normalizeFullWidth(text) {
  return String(text || '')
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ')
}

function isValidDate(month, day) {
  if (month < 1 || month > 12) return false
  if (day < 1 || day > 31) return false
  if (month === 2 && day > 29) return false
  if ([4, 6, 9, 11].includes(month) && day > 30) return false
  return true
}

function hasMeaningfulDose(dose) {
  const value = String(dose || '').trim()
  return value !== '' && value !== '0'
}

const CHINESE_WEEKDAY = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 }

function getDateContext(targetDate) {
  const dateObj = new Date(`${targetDate}T00:00:00Z`)
  const targetDayOfWeek = dateObj.getUTCDay() || 7
  const year = dateObj.getUTCFullYear()
  // 當月第幾週：採「日曆週、週日為一週之始」，含 1 號之週為第 1 週。
  // firstWeekday = 當月 1 號的星期（週日=0）。例：2026-07 的 7/6(週一)、7/5(週日) 皆為第 2 週。
  // （勿改回「每 7 天一塊」的日期分塊法：那會讓 7/6 誤判成第 1 週、Q2W 多打。）
  const firstWeekday = new Date(Date.UTC(year, dateObj.getUTCMonth(), 1)).getUTCDay()
  const weekOfMonth = Math.ceil((dateObj.getUTCDate() + firstWeekday) / 7)
  return { targetDayOfWeek, year, weekOfMonth }
}

/**
 * 解析一段規則文字（備註欄、頻率服法欄、或使用者確認的規則）。
 * 回傳：
 *  - isHold        : 含 hold/暫停/停打 → 明確停打
 *  - hasDateRule / dateMatched : 明確日期（MMDD、MM/DD、民國年、西元）
 *  - intervalN     : Q{N}W 的 N（不論其後有無星期幾）；QW/無 → null
 *  - intervalDays  : Q{N}W 後接的星期幾（如 Q2W4 → [4]）；無 → null
 *  - wDays         : QW/W 後接的星期幾（QW135 → [1,3,5]），含中文「每周三」→ [3]；無 → null
 */
export function analyzeRuleText(text, targetDate) {
  const result = {
    isHold: false,
    hasDateRule: false,
    dateMatched: false,
    intervalN: null,
    intervalDays: null,
    wDays: null,
  }
  const trimmed = String(text || '').trim()
  if (!trimmed || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) return result

  const { year } = getDateContext(targetDate)
  const normalized = normalizeFullWidth(trimmed).toUpperCase()

  if (/\bHOLD\b/.test(normalized) || /暫停|停打/.test(normalized)) {
    result.isHold = true
  }

  const wDays = new Set()
  const wRegex = /\b(?:QW|W)\s*([1-7][1-7\s.,，、&]*)/g
  let wMatch
  while ((wMatch = wRegex.exec(normalized)) !== null) {
    if (/\d{4}/.test(wMatch[0])) continue
    for (const day of wMatch[1].match(/[1-7]/g) || []) wDays.add(parseInt(day, 10))
  }
  // 中文星期：每周三打 / 每週三 / 週三 / 星期三 / 禮拜三 / 每周一三五
  const zhRegex = /(?:每)?(?:周|週|星期|禮拜)\s*([一二三四五六日天](?:[\s、,，.及和]*[一二三四五六日天])*)/g
  let zhMatch
  while ((zhMatch = zhRegex.exec(normalized)) !== null) {
    for (const ch of zhMatch[1]) {
      if (CHINESE_WEEKDAY[ch]) wDays.add(CHINESE_WEEKDAY[ch])
    }
  }
  if (wDays.size > 0) result.wDays = [...wDays].sort()

  // 間隔週規則 Q{N}W[days] / Q{N}W W[days]（如 Q2W4、Q2W W4、Q2W5）。
  // 語意：每 N 週一次，當月第 1 週起算 → 第 weekOfMonth 符合 (weekOfMonth-1)%N===0
  // 的週才打；N=2 → 第 1/3/5 週（遇第 5 週該月多打一次）。星期幾由其後數字決定。
  // 注意與「QW（每週）」區別：QW2=每週二；Q2W2=每兩週的週二（僅奇數週）。
  // 容許 Q{N}W 與星期幾間有空白/逗號/頓號分隔，並相容 "Q2W, W3" / "Q2W W3" 的重複 W。
  const intervalDays = new Set()
  const intervalRegex = /\bQ(\d+)W[\s,，、]*(?:W[\s,，、]*)?([1-7][1-7\s.,，、&]*)?/g
  let ivMatch
  while ((ivMatch = intervalRegex.exec(normalized)) !== null) {
    const interval = parseInt(ivMatch[1], 10)
    if (!interval || interval < 1) continue
    if (result.intervalN === null) result.intervalN = interval
    const dayPart = ivMatch[2]
    if (!dayPart) continue
    for (const d of dayPart.match(/[1-7]/g) || []) intervalDays.add(parseInt(d, 10))
  }
  if (intervalDays.size > 0) result.intervalDays = [...intervalDays].sort()

  const markDate = (parsed) => {
    result.hasDateRule = true
    if (parsed === targetDate) result.dateMatched = true
  }

  const slashDateRegex = /(?:(\d{4})[/-])?(\d{1,2})[/-](\d{1,2})/g
  let dateMatch
  while ((dateMatch = slashDateRegex.exec(normalized)) !== null) {
    const nextText = normalized.slice(dateMatch.index + dateMatch[0].length).replace(/^\s+/, '')
    if (!dateMatch[1] && /^(AMP|VIAL|PC|TAB|MG|ML|A\b|V\b|M\b)/.test(nextText)) continue
    const parsedYear = dateMatch[1] ? parseInt(dateMatch[1], 10) : year
    const month = parseInt(dateMatch[2], 10)
    const day = parseInt(dateMatch[3], 10)
    if (!isValidDate(month, day)) continue
    markDate(`${parsedYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
  }

  // 民國年日期：1150605（7 碼 = 民國年YYY+MM+DD）或 115/06/05、115-06-05（3 碼民國年）。
  // 民國年 + 1911 = 西元年。限民國 100~200 年，避免誤判一般數字。
  const rocRegex = /(?:^|[^\d])(\d{3})[/-]?(\d{2})[/-]?(\d{2})(?=[^\d]|$)/g
  let rocMatch
  while ((rocMatch = rocRegex.exec(normalized)) !== null) {
    const rocYear = parseInt(rocMatch[1], 10)
    if (rocYear < 100 || rocYear > 200) continue
    const month = parseInt(rocMatch[2], 10)
    const day = parseInt(rocMatch[3], 10)
    if (!isValidDate(month, day)) continue
    markDate(`${rocYear + 1911}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
  }

  const mmddRegex = /(?:^|[^\d])(\d{2})(\d{2})(?=[^\d]|$)/g
  let mmddMatch
  while ((mmddMatch = mmddRegex.exec(normalized)) !== null) {
    const month = parseInt(mmddMatch[1], 10)
    const day = parseInt(mmddMatch[2], 10)
    if (!isValidDate(month, day)) continue
    markDate(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
  }

  return result
}

/** 規則文字是否含任何可判定施打日的資訊（供覆寫規則驗證用） */
export function ruleTextIsDecidable(text) {
  const a = analyzeRuleText(text, '2026-01-01')
  return a.isHold || a.hasDateRule || !!a.intervalDays || !!a.wDays
}

/**
 * 依「備註 → 頻率服法」判定某筆針劑處方在 targetDate 是否施打。
 * 優先序：明確日期 > 間隔週(Q{N}W) > 每週(QW)；備註優先於頻率欄。
 *  - 備註含 hold → hold（不列、也不算疑慮）
 *  - 備註有明確日期 → 只在列出的日期施打（即使另含 W/Q2W）
 *  - 星期幾：備註的 Q{N}W 後數字 > 備註的 QW/W/中文星期 > 頻率欄的 Q{N}W 後數字 > 頻率欄的 QW 後數字
 *  - 間隔週 N：備註的 Q{N}W > 頻率欄的 Q{N}W > 1（每週）。例：頻率 Q2W + 備註 QW2 → 每兩週的週二
 *  - 兩邊都找不到星期幾（如頻率只有 QW、備註空白）→ uncertain，系統不自行判定
 * overrideRule（使用者在疑慮清單確認的規則）若有值則取代備註。
 */
export function resolveInjectionSchedule(order, targetDate, overrideRule = null) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    return { status: 'skip', source: null, effectiveRule: '', reason: 'invalid date' }
  }
  const usingOverride = overrideRule !== null && overrideRule !== undefined && String(overrideRule).trim() !== ''
  const noteText = usingOverride ? String(overrideRule) : order.note || ''
  const note = analyzeRuleText(noteText, targetDate)
  const freq = analyzeRuleText(order.frequency || '', targetDate)
  const noteSource = usingOverride ? 'override' : 'note'

  if (note.isHold) {
    return { status: 'hold', source: noteSource, effectiveRule: noteText.trim(), reason: '' }
  }
  if (note.hasDateRule) {
    return {
      status: note.dateMatched ? 'scheduled' : 'skip',
      source: noteSource,
      effectiveRule: noteText.trim(),
      reason: '',
    }
  }
  if (freq.isHold && !note.wDays && !note.intervalDays) {
    return { status: 'hold', source: 'frequency', effectiveRule: String(order.frequency || '').trim(), reason: '' }
  }

  let days = null
  let source = null
  if (note.intervalDays || note.wDays) {
    days = note.intervalDays || note.wDays
    source = noteSource
  } else if (freq.intervalDays || freq.wDays) {
    days = freq.intervalDays || freq.wDays
    source = 'frequency'
  }
  const intervalN = note.intervalN || freq.intervalN || 1

  if (!days) {
    const freqText = String(order.frequency || '').trim()
    let reason
    if (freq.intervalN) reason = `頻率 ${freqText} 未註明星期幾`
    else if (/^QW$/i.test(freqText)) reason = '頻率 QW 未註明星期幾'
    else reason = '備註與頻率皆無可判讀的施打規則'
    return { status: 'uncertain', source: null, effectiveRule: '', reason }
  }

  const { targetDayOfWeek, weekOfMonth } = getDateContext(targetDate)
  const weekOk = intervalN <= 1 || (weekOfMonth - 1) % intervalN === 0
  const matched = weekOk && days.includes(targetDayOfWeek)
  const effectiveRule = `${intervalN > 1 ? `Q${intervalN}W` : 'QW'}${days.join('')}`
  return { status: matched ? 'scheduled' : 'skip', source, effectiveRule, reason: '' }
}

/**
 * 舊介面：只看單一段文字（備註）判定是否施打。保留給既有呼叫端／測試；
 * 新邏輯請走 resolveInjectionSchedule（會合併頻率欄與覆寫規則）。
 */
export function shouldAdministerOnDate(note, targetDate) {
  const r = resolveInjectionSchedule({ note, frequency: '' }, targetDate)
  return r.status === 'scheduled'
}

function queryLatestInjectionOrders(db, patientIds, targetMonth) {
  if (patientIds.length === 0) return []
  const placeholders = patientIds.map(() => '?').join(',')
  // 每位病人取「<= 目標月份」的最新一份上傳檔。
  // 同月上傳為整月覆蓋，故每個 upload_month 僅一份權威資料；跨月時自動沿用最近一份。
  //
  // ⚠️ 有效月份的判定「不限 order_type」：只要病人有出現在該月上傳（針劑或口服皆算），
  // 該月就是其權威月份。否則某月已上傳、但該病人當月「只有口服、無針劑」
  // （如 NESP 已停，洗腎醫囑檔「不含停止日」故不含該筆），會被誤判成「當月無針劑資料」
  // 而沿用上月、復活已停的針劑。主查詢仍只回 order_type='injection' 的列，
  // 故有效月份若無針劑列 → 正確顯示「無針劑」；真正整月未上傳者才沿用上月。
  return db
    .prepare(
      `
      WITH latest_per_patient AS (
        SELECT patient_id, MAX(upload_month) AS effective_month
        FROM injection_orders
        WHERE patient_id IN (${placeholders})
          AND upload_month <= ?
        GROUP BY patient_id
      )
      SELECT io.*
      FROM injection_orders io
      JOIN latest_per_patient lp
        ON io.patient_id = lp.patient_id
       AND io.upload_month = lp.effective_month
      WHERE io.order_type = 'injection'
      ORDER BY io.patient_id, io.order_code, io.change_date DESC, io.created_at DESC
    `,
    )
    .all(...patientIds, targetMonth)
}

/**
 * 區間模型查詢（新版含停止日 Excel）：
 * 取目標日落在 [start_date, end_date] 內的針劑處方（end_date 空 = 持續使用）。
 * 已停用的針劑自然被過濾，不再有「沿用上月復活已停針劑」的問題。
 * patientIds 為 null → 全部病人。
 */
function queryActiveInjectionOrders(db, patientIds, targetDate) {
  const scope = patientIds === null ? '' : `AND patient_id IN (${patientIds.map(() => '?').join(',')})`
  if (patientIds !== null && patientIds.length === 0) return []
  return db
    .prepare(
      `
      SELECT * FROM injection_orders
      WHERE order_type = 'injection'
        ${scope}
        AND start_date != '' AND start_date <= ?
        AND (end_date = '' OR end_date IS NULL OR end_date >= ?)
      ORDER BY patient_id, order_code, start_date DESC, created_at DESC
    `,
    )
    .all(...(patientIds || []), targetDate, targetDate)
}

function hasIntervalData(db) {
  return !!db
    .prepare(`SELECT 1 FROM injection_orders WHERE start_date IS NOT NULL AND start_date != '' LIMIT 1`)
    .get()
}

function getPatientNameMap(db, patientIds) {
  if (patientIds.length === 0) return new Map()
  const placeholders = patientIds.map(() => '?').join(',')
  const rows = db
    .prepare(`SELECT id, name FROM patients WHERE id IN (${placeholders})`)
    .all(...patientIds)
  return new Map(rows.map((row) => [row.id, row.name]))
}

// ---------------------------------------------------------------------------
// 覆寫規則（疑慮清單確認）：以處方的自然鍵對應，重新上傳整表覆蓋後仍能對回同一筆。
// ---------------------------------------------------------------------------
export function overrideKeyOf(order) {
  return [
    order.patient_id ?? order.patientId ?? '',
    order.order_code ?? order.orderCode ?? '',
    order.start_date ?? order.startDate ?? '',
    String(order.dose ?? '').trim(),
    String(order.frequency ?? '').trim(),
  ].join('|')
}

function loadOverrideMap(db, patientIds) {
  let rows
  if (patientIds === null) {
    rows = db.prepare(`SELECT * FROM injection_rule_overrides`).all()
  } else if (patientIds.length === 0) {
    rows = []
  } else {
    const placeholders = patientIds.map(() => '?').join(',')
    rows = db
      .prepare(`SELECT * FROM injection_rule_overrides WHERE patient_id IN (${placeholders})`)
      .all(...patientIds)
  }
  return new Map(rows.map((r) => [overrideKeyOf(r), r]))
}

function mapOverrideRow(r) {
  return {
    id: r.id,
    patientId: r.patient_id,
    orderCode: r.order_code,
    startDate: r.start_date,
    dose: r.dose,
    frequency: r.frequency,
    rule: r.rule,
    confirmedById: r.confirmed_by_id,
    confirmedByName: r.confirmed_by_name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export function listInjectionRuleOverrides(db) {
  return db
    .prepare(`SELECT * FROM injection_rule_overrides ORDER BY updated_at DESC`)
    .all()
    .map(mapOverrideRow)
}

export function upsertInjectionRuleOverride(db, payload, user) {
  const patientId = String(payload.patientId || '').trim()
  const orderCode = String(payload.orderCode || '').trim()
  const startDate = String(payload.startDate || '').trim()
  const dose = String(payload.dose ?? '').trim()
  const frequency = String(payload.frequency ?? '').trim()
  const rule = String(payload.rule || '').trim()
  if (!patientId || !orderCode || !startDate) throw new Error('缺少 patientId / orderCode / startDate')
  if (!rule) throw new Error('請輸入施打規則')
  if (!ruleTextIsDecidable(rule)) throw new Error('無法判讀的規則，請用 W4、QW135、Q2W4、0923.0930 或 hold 等寫法')

  const existing = db
    .prepare(
      `SELECT id FROM injection_rule_overrides
       WHERE patient_id = ? AND order_code = ? AND start_date = ? AND dose = ? AND frequency = ?`,
    )
    .get(patientId, orderCode, startDate, dose, frequency)
  const now = new Date().toLocaleString('sv-SE')
  if (existing) {
    db.prepare(
      `UPDATE injection_rule_overrides
       SET rule = ?, confirmed_by_id = ?, confirmed_by_name = ?, updated_at = ?
       WHERE id = ?`,
    ).run(rule, user?.id || null, user?.name || null, now, existing.id)
    return mapOverrideRow(db.prepare(`SELECT * FROM injection_rule_overrides WHERE id = ?`).get(existing.id))
  }
  const id = uuidv4()
  db.prepare(
    `INSERT INTO injection_rule_overrides
       (id, patient_id, order_code, start_date, dose, frequency, rule, confirmed_by_id, confirmed_by_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, patientId, orderCode, startDate, dose, frequency, rule, user?.id || null, user?.name || null, now, now)
  return mapOverrideRow(db.prepare(`SELECT * FROM injection_rule_overrides WHERE id = ?`).get(id))
}

export function deleteInjectionRuleOverride(db, id) {
  return db.prepare(`DELETE FROM injection_rule_overrides WHERE id = ?`).run(id).changes
}

// ---------------------------------------------------------------------------

function loadDistinctActiveOrders(db, targetDate, patientIds) {
  const orders = hasIntervalData(db)
    ? queryActiveInjectionOrders(db, patientIds, targetDate)
    : queryLatestInjectionOrders(db, patientIds || [], targetDate.slice(0, 7))

  // 不再以「病人+藥碼」只留最新一筆 —— 同藥同月可能有多個頻率（例 NESP QW2 與 QW4，
  // note/開立日期不同），各自決定施打日，全部保留。只去除「完全相同」的重複列。
  const seenKeys = new Set()
  const distinctOrders = []
  for (const order of orders) {
    const key = `${order.patient_id}|${order.order_code || ''}|${order.note || ''}|${order.dose || ''}|${order.frequency || ''}`
    if (seenKeys.has(key)) continue
    seenKeys.add(key)
    distinctOrders.push(order)
  }
  return distinctOrders.filter(
    (order) => hasMeaningfulDose(order.dose) && !DAILY_INJECTION_EXCLUDED_CODES.has(order.order_code),
  )
}

function toInjectionRecord(order, patientNameMap, resolution) {
  const medInfo = INJECTION_MEDS[order.order_code] || null
  return {
    id: order.id,
    patientId: order.patient_id,
    patientName: patientNameMap.get(order.patient_id) || order.patient_name || '',
    medicalRecordNumber: order.medical_record_number,
    orderCode: order.order_code,
    orderName: medInfo?.tradeName || order.order_name || order.order_code || '',
    dose: order.dose,
    unit: medInfo?.unit || '',
    frequency: order.frequency,
    note: order.note,
    orderType: order.order_type,
    changeDate: order.change_date,
    uploadMonth: order.upload_month,
    sourceFile: order.source_file,
    startDate: order.start_date || '',
    endDate: order.end_date || '',
    prescriber: order.prescriber || '',
    createdAt: order.created_at,
    ruleSource: resolution.source,
    effectiveRule: resolution.effectiveRule,
  }
}

function sortByPatientThenCode(a, b) {
  const nameCompare = String(a.patientName || '').localeCompare(String(b.patientName || ''), 'zh-Hant')
  if (nameCompare !== 0) return nameCompare
  return String(a.orderCode || '').localeCompare(String(b.orderCode || ''))
}

export function getDailyInjections(db, targetDate, patientIds) {
  if (!targetDate || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    throw new Error('targetDate must be in YYYY-MM-DD format')
  }

  const uniquePatientIds = [...new Set((patientIds || []).filter(Boolean))]
  if (uniquePatientIds.length === 0) return []

  const orders = loadDistinctActiveOrders(db, targetDate, uniquePatientIds)
  const overrides = loadOverrideMap(db, uniquePatientIds)
  const patientNameMap = getPatientNameMap(db, uniquePatientIds)

  const records = []
  for (const order of orders) {
    const override = overrides.get(overrideKeyOf(order))
    const resolution = resolveInjectionSchedule(order, targetDate, override?.rule ?? null)
    if (resolution.status !== 'scheduled') continue
    records.push(toInjectionRecord(order, patientNameMap, resolution))
  }
  return records.sort(sortByPatientThenCode)
}

/**
 * 疑慮清單：targetDate 當天仍有效、但備註與頻率欄都判不出星期幾的針劑處方
 * （典型：頻率只有 QW、備註空白）。系統不自行判定，交由使用者在清單中確認規則。
 * patientIds 省略/null → 全部未刪除病人。
 */
export function getUncertainInjections(db, targetDate, patientIds = null) {
  if (!targetDate || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    throw new Error('targetDate must be in YYYY-MM-DD format')
  }
  let scope = null
  if (Array.isArray(patientIds)) {
    scope = [...new Set(patientIds.filter(Boolean))]
    if (scope.length === 0) return []
  }
  const orders = loadDistinctActiveOrders(db, targetDate, scope)
  const overrides = loadOverrideMap(db, scope)
  const involvedIds = [...new Set(orders.map((o) => o.patient_id))]
  const patientNameMap = getPatientNameMap(db, involvedIds)
  const deletedIds = new Set(
    involvedIds.length
      ? db
          .prepare(`SELECT id FROM patients WHERE is_deleted = 1 AND id IN (${involvedIds.map(() => '?').join(',')})`)
          .all(...involvedIds)
          .map((r) => r.id)
      : [],
  )

  const list = []
  for (const order of orders) {
    if (deletedIds.has(order.patient_id)) continue
    const override = overrides.get(overrideKeyOf(order))
    const resolution = resolveInjectionSchedule(order, targetDate, override?.rule ?? null)
    if (resolution.status !== 'uncertain') continue
    list.push({
      ...toInjectionRecord(order, patientNameMap, resolution),
      reason: resolution.reason,
      overrideKey: overrideKeyOf(order),
    })
  }
  return list.sort(sortByPatientThenCode)
}
