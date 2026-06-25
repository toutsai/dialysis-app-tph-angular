const INJECTION_MEDS = {
  INES2: { tradeName: 'NESP', unit: 'mcg' },
  IREC1: { tradeName: 'Recormon', unit: 'KIU' },
  IFER2: { tradeName: 'Fe-back', unit: 'mg' },
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

  // 有明確日期 → 以日期為準（即使另含 W 也只在列出的日期那幾天才施打）
  if (hasDateRule) return dateRuleMatched
  // 只有 W → 用 W 規則
  if (hasWRule) return wRuleMatched
  return false
}

function queryLatestInjectionOrders(db, patientIds, targetMonth) {
  if (patientIds.length === 0) return []
  const placeholders = patientIds.map(() => '?').join(',')
  // 每位病人取「<= 目標月份」的最新一份上傳檔。
  // 同月上傳為整月覆蓋，故每個 upload_month 僅一份權威資料；跨月時自動沿用最近一份。
  return db
    .prepare(
      `
      WITH latest_per_patient AS (
        SELECT patient_id, MAX(upload_month) AS effective_month
        FROM injection_orders
        WHERE patient_id IN (${placeholders})
          AND order_type = 'injection'
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

  const orders = queryLatestInjectionOrders(db, uniquePatientIds, targetDate.slice(0, 7))

  const latestByPatientAndCode = new Map()
  for (const order of orders) {
    const key = `${order.patient_id}-${order.order_code || ''}`
    const existing = latestByPatientAndCode.get(key)
    const currentSort = `${order.change_date || ''}|${order.created_at || ''}`
    const existingSort = existing ? `${existing.change_date || ''}|${existing.created_at || ''}` : ''
    if (!existing || currentSort > existingSort) {
      latestByPatientAndCode.set(key, order)
    }
  }

  const patientNameMap = getPatientNameMap(db, uniquePatientIds)

  return Array.from(latestByPatientAndCode.values())
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
