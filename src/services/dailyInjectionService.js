const INJECTION_MEDS = {
  INES2: { tradeName: 'NESP', unit: 'mcg' },
  IREC1: { tradeName: 'Recormon', unit: 'KIU' },
  IFER2: { tradeName: 'Good-Fe', unit: 'mg' },
  ICAC: { tradeName: 'Cacare', unit: 'amp' },
  IPAR1: { tradeName: 'Parsabiv', unit: 'mg' },
}

function normalizeFullWidth(text) {
  return String(text || '')
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
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

export function shouldAdministerOnDate(note, targetDate) {
  const trimmed = String(note || '').trim()
  if (!trimmed || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) return false

  const dateObj = new Date(`${targetDate}T00:00:00Z`)
  const targetDayOfWeek = dateObj.getUTCDay() || 7
  const year = dateObj.getUTCFullYear()
  // 當月第幾週：採「日曆週、週日為一週之始」，含 1 號之週為第 1 週。
  // firstWeekday = 當月 1 號的星期（週日=0）。例：2026-07 的 7/6(週一)、7/5(週日) 皆為第 2 週。
  // （勿改回「每 7 天一塊」的日期分塊法：那會讓 7/6 誤判成第 1 週、Q2W 多打。）
  const firstWeekday = new Date(Date.UTC(year, dateObj.getUTCMonth(), 1)).getUTCDay()
  const weekOfMonth = Math.ceil((dateObj.getUTCDate() + firstWeekday) / 7)
  const normalized = normalizeFullWidth(trimmed).toUpperCase()

  // 分開追蹤 W 規則與日期規則。當兩者並存（如 "Q2W W4 0423 0507"），
  // 日期才是真正施打日，W 只是頻率描述 — 故日期規則優先，W 為 fallback。
  let hasWRule = false
  let wRuleMatched = false
  let hasDateRule = false
  let dateRuleMatched = false

  const wRegex = /\b(?:QW|W)\s*([1-7][1-7\s.,，、&]*)/g
  let wMatch
  while ((wMatch = wRegex.exec(normalized)) !== null) {
    if (/\d{4}/.test(wMatch[0])) continue
    hasWRule = true
    const days = wMatch[1].match(/[1-7]/g)
    if (days?.map((day) => parseInt(day, 10)).includes(targetDayOfWeek)) {
      wRuleMatched = true
    }
  }

  // 間隔週規則 Q{N}W[days] / Q{N}W W[days]（如 Q2W4、Q2W W4、Q2W5）。
  // 語意：每 N 週一次，當月第 1 週起算 → 第 weekOfMonth 符合 (weekOfMonth-1)%N===0
  // 的週才打；N=2 → 第 1/3/5 週（遇第 5 週該月多打一次）。星期幾由其後數字決定。
  // 注意與「QW（每週）」區別：QW2=每週二；Q2W2=每兩週的週二（僅奇數週）。
  // 優先序高於 QW（見結尾 return），低於明確日期。
  let hasIntervalRule = false
  let intervalRuleMatched = false
  // 容許 Q{N}W 與星期幾間有空白/逗號/頓號分隔，並相容 "Q2W, W3" / "Q2W W3" 的重複 W。
  const intervalRegex = /\bQ(\d+)W[\s,，、]*(?:W[\s,，、]*)?([1-7][1-7\s.,，、&]*)?/g
  let ivMatch
  while ((ivMatch = intervalRegex.exec(normalized)) !== null) {
    const interval = parseInt(ivMatch[1], 10)
    if (!interval || interval < 1) continue
    const dayPart = ivMatch[2]
    if (!dayPart) continue // 只有 Q2W、無星期幾 → 交給明確日期規則
    hasIntervalRule = true
    const days = dayPart.match(/[1-7]/g)?.map((d) => parseInt(d, 10)) || []
    if ((weekOfMonth - 1) % interval === 0 && days.includes(targetDayOfWeek)) {
      intervalRuleMatched = true
    }
  }

  const slashDateRegex = /(?:(\d{4})[/-])?(\d{1,2})[/-](\d{1,2})/g
  let dateMatch
  while ((dateMatch = slashDateRegex.exec(normalized)) !== null) {
    const nextText = normalized.slice(dateMatch.index + dateMatch[0].length).replace(/^\s+/, '')
    if (!dateMatch[1] && /^(AMP|VIAL|PC|TAB|MG|ML|A\b|V\b|M\b)/.test(nextText)) {
      continue
    }

    const parsedYear = dateMatch[1] ? parseInt(dateMatch[1], 10) : year
    const month = parseInt(dateMatch[2], 10)
    const day = parseInt(dateMatch[3], 10)
    if (!isValidDate(month, day)) continue

    hasDateRule = true
    const parsed = `${parsedYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    if (parsed === targetDate) dateRuleMatched = true
  }

  // 民國年日期：1150605（7 碼 = 民國年YYY+MM+DD）或 115/06/05、115-06-05（3 碼民國年）。
  // 民國年 + 1911 = 西元年。限民國 100~200 年，避免誤判一般數字。
  // 放在 mmddRegex 之前，因為 7 碼民國日期不會被 mmddRegex（需 4 碼且前後為非數字）匹配。
  const rocRegex = /(?:^|[^\d])(\d{3})[/-]?(\d{2})[/-]?(\d{2})(?=[^\d]|$)/g
  let rocMatch
  while ((rocMatch = rocRegex.exec(normalized)) !== null) {
    const rocYear = parseInt(rocMatch[1], 10)
    if (rocYear < 100 || rocYear > 200) continue
    const month = parseInt(rocMatch[2], 10)
    const day = parseInt(rocMatch[3], 10)
    if (!isValidDate(month, day)) continue

    hasDateRule = true
    const parsed = `${rocYear + 1911}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    if (parsed === targetDate) dateRuleMatched = true
  }

  const mmddRegex = /(?:^|[^\d])(\d{2})(\d{2})(?=[^\d]|$)/g
  let mmddMatch
  while ((mmddMatch = mmddRegex.exec(normalized)) !== null) {
    const month = parseInt(mmddMatch[1], 10)
    const day = parseInt(mmddMatch[2], 10)
    if (!isValidDate(month, day)) continue

    hasDateRule = true
    const parsed = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    if (parsed === targetDate) dateRuleMatched = true
  }

  // 優先序：明確日期 > 間隔週(Q{N}W) > 每週(QW)。
  // 有明確日期 → 以日期為準（即使另含 W/Q2W 也只在列出的日期那幾天才施打）。
  if (hasDateRule) return dateRuleMatched
  // Q{N}W 間隔週規則（如 Q2W4）— 須在 QW 之前，因 "Q2W W4" 也會被 QW 規則捕捉到 W4。
  if (hasIntervalRule) return intervalRuleMatched
  // 只有 QW → 用每週規則
  if (hasWRule) return wRuleMatched
  return false
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
 */
function queryActiveInjectionOrders(db, patientIds, targetDate) {
  if (patientIds.length === 0) return []
  const placeholders = patientIds.map(() => '?').join(',')
  return db
    .prepare(
      `
      SELECT * FROM injection_orders
      WHERE patient_id IN (${placeholders})
        AND order_type = 'injection'
        AND start_date != '' AND start_date <= ?
        AND (end_date = '' OR end_date IS NULL OR end_date >= ?)
      ORDER BY patient_id, order_code, start_date DESC, created_at DESC
    `,
    )
    .all(...patientIds, targetDate, targetDate)
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

export function getDailyInjections(db, targetDate, patientIds) {
  if (!targetDate || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    throw new Error('targetDate must be in YYYY-MM-DD format')
  }

  const uniquePatientIds = [...new Set((patientIds || []).filter(Boolean))]
  if (uniquePatientIds.length === 0) return []

  const orders = hasIntervalData(db)
    ? queryActiveInjectionOrders(db, uniquePatientIds, targetDate)
    : queryLatestInjectionOrders(db, uniquePatientIds, targetDate.slice(0, 7))

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

  const patientNameMap = getPatientNameMap(db, uniquePatientIds)

  return distinctOrders
    .filter((order) => hasMeaningfulDose(order.dose))
    .filter((order) => shouldAdministerOnDate(order.note || '', targetDate))
    .map((order) => {
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
        createdAt: order.created_at,
      }
    })
    .sort((a, b) => {
      const nameCompare = String(a.patientName || '').localeCompare(String(b.patientName || ''), 'zh-Hant')
      if (nameCompare !== 0) return nameCompare
      return String(a.orderCode || '').localeCompare(String(b.orderCode || ''))
    })
}
