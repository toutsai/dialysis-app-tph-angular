import { generateDailyScheduleFromRules } from './scheduleSync.js'
import { getDailyInjections } from './dailyInjectionService.js'
import { getTaipeiDayIndex, getTaipeiTodayString } from '../utils/dateUtils.js'
import { normalizeAkAliases, resolveDailyRotationValue } from '../utils/scheduleUtils.js'

export const DASHBOARD_SHIFTS = ['early', 'noon', 'late']

const SHIFT_LABELS = {
  early: '早班',
  noon: '午班',
  late: '晚班',
}

function safeJsonParse(value, fallback) {
  if (!value) return fallback
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function getValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value
    }
  }
  return ''
}

function getNumericValue(...values) {
  const value = getValue(...values)
  if (value === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : value
}

function parseWholeNumber(value) {
  if (value === undefined || value === null || value === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : null
}

function normalizeDialysisTimeParts(hours, minutes) {
  if (hours === null && minutes === null) return { hours: null, minutes: null }
  const totalMinutes = (hours || 0) * 60 + (minutes || 0)
  return {
    hours: Math.floor(totalMinutes / 60),
    minutes: totalMinutes % 60,
  }
}

function parseDialysisTime(orders = {}) {
  let normalized = normalizeDialysisTimeParts(
    parseWholeNumber(getValue(orders.dialysisTimeHours, orders.dialysisHour, orders.dialysisHoursHour)),
    parseWholeNumber(getValue(orders.dialysisTimeMinutes, orders.dialysisMinute, orders.dialysisMinutes)),
  )

  if (normalized.hours === null && normalized.minutes === null) {
    const rawTime = getValue(orders.dialysisTimeText, orders.dialysisHours, orders.hours, orders.duration)
    if (rawTime !== '') {
      const text = String(rawTime)
      const hourMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:時|小時|h|hr|hour)/i)
      const minuteMatch = text.match(/(\d+)\s*(?:分|分鐘|m|min|minute)/i)

      if (hourMatch || minuteMatch) {
        normalized = normalizeDialysisTimeParts(
          hourMatch ? parseWholeNumber(hourMatch[1]) : null,
          minuteMatch ? parseWholeNumber(minuteMatch[1]) : null,
        )
      } else {
        const decimalHours = Number(rawTime)
        if (Number.isFinite(decimalHours)) {
          const hours = Math.floor(decimalHours)
          const minutes = Math.round((decimalHours - hours) * 60)
          normalized = normalizeDialysisTimeParts(hours, minutes)
        }
      }
    }
  }

  if (normalized.hours === null && normalized.minutes === null) {
    return { hours: null, minutes: null, text: '' }
  }

  const hours = normalized.hours || 0
  const minutes = normalized.minutes || 0
  return {
    hours,
    minutes,
    text: `${hours}時${minutes}分`,
  }
}

function splitHeparinDose(...values) {
  const raw = getValue(...values)
  if (!raw) return { loading: '', maintain: '' }

  const match = String(raw).match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/)
  return {
    loading: match?.[1] || '',
    maintain: match?.[2] || '',
  }
}

function subtractDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}

function calculateAge(birthDate, targetDate) {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}/.test(birthDate)) return null
  const birth = new Date(`${birthDate.slice(0, 10)}T00:00:00Z`)
  const target = new Date(`${targetDate}T00:00:00Z`)
  let age = target.getUTCFullYear() - birth.getUTCFullYear()
  const monthDiff = target.getUTCMonth() - birth.getUTCMonth()
  if (monthDiff < 0 || (monthDiff === 0 && target.getUTCDate() < birth.getUTCDate())) {
    age -= 1
  }
  return Number.isFinite(age) && age >= 0 ? age : null
}

function getTaipeiMinutes(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value || 0)
  return hour * 60 + minute
}

export function resolveDashboardShift(now = new Date()) {
  const minutes = getTaipeiMinutes(now)
  if (minutes >= 17 * 60) return 'late'
  if (minutes >= 12 * 60) return 'noon'
  return 'early'
}

export function normalizeBedKey(rawBedKey) {
  const value = decodeURIComponent(String(rawBedKey || '').trim())
    .replace(/-(early|noon|late)$/i, '')
    .replace(/\s+/g, '')

  if (!value) return ''
  if (/^bed-\d+$/i.test(value)) return `bed-${value.split('-')[1]}`
  if (/^peripheral-\d+$/i.test(value)) return `peripheral-${value.split('-')[1]}`
  if (/^peripheral\d+$/i.test(value)) return value.replace(/^peripheral/i, 'peripheral-')
  if (/^\d+$/.test(value)) return `bed-${value}`

  return value
}

export function formatBedLabel(bedKey) {
  if (bedKey.startsWith('bed-')) return bedKey.replace('bed-', '')
  if (bedKey.startsWith('peripheral-')) return `外圍${bedKey.replace('peripheral-', '')}`
  return bedKey
}

function getScheduleForDate(db, date) {
  let row = db.prepare('SELECT * FROM schedules WHERE date = ?').get(date)
  let schedule = row ? safeJsonParse(row.schedule, {}) : {}

  if (Object.keys(schedule).length === 0 && date < getTaipeiTodayString()) {
    const archived = db.prepare('SELECT * FROM archived_schedules WHERE date = ?').get(date)
    if (archived) {
      return {
        row: archived,
        schedule: safeJsonParse(archived.schedule, {}),
        source: 'archived_schedules',
      }
    }
  }

  if (Object.keys(schedule).length > 0) {
    return { row, schedule, source: 'schedules' }
  }

  // 過去日期查無資料就是無資料：不從今日總表編造（偽造歷史）、不寫回
  if (date < getTaipeiTodayString()) {
    return { row, schedule: {}, source: 'empty' }
  }

  const masterDoc = db.prepare("SELECT schedule FROM base_schedules WHERE id = 'MASTER_SCHEDULE'").get()
  if (!masterDoc) return { row, schedule: {}, source: 'empty' }

  const patients = db.prepare('SELECT * FROM patients WHERE is_deleted = 0').all()
  const patientsMap = new Map(patients.map((patient) => [patient.id, patient]))
  const masterRules = safeJsonParse(masterDoc.schedule, {})
  schedule = generateDailyScheduleFromRules(masterRules, date, patientsMap)

  if (Object.keys(schedule).length > 0) {
    if (row) {
      db.prepare(
        `
        UPDATE schedules
        SET schedule = ?, sync_method = 'auto_generate', updated_at = datetime('now', 'localtime')
        WHERE date = ?
      `,
      ).run(JSON.stringify(schedule), date)
    } else {
      db.prepare(
        `
        INSERT INTO schedules (id, date, schedule, sync_method, created_at, updated_at)
        VALUES (?, ?, ?, 'auto_generate', datetime('now', 'localtime'), datetime('now', 'localtime'))
      `,
      ).run(date, date, JSON.stringify(schedule))
    }
    row = db.prepare('SELECT * FROM schedules WHERE date = ?').get(date)
  }

  return { row, schedule, source: 'schedules' }
}

function getLatestDialysisOrders(db, patient, date) {
  if (!patient) return { orders: {}, source: 'none', effectiveDate: null }

  const history = db
    .prepare(
      `
      SELECT *
      FROM dialysis_orders_history
      WHERE patient_id = ?
        AND (
          json_extract(orders, '$.effectiveDate') IS NULL
          OR json_extract(orders, '$.effectiveDate') = ''
          OR json_extract(orders, '$.effectiveDate') <= ?
        )
      ORDER BY
        COALESCE(json_extract(orders, '$.effectiveDate'), '') DESC,
        created_at DESC
      LIMIT 1
    `,
    )
    .get(patient.id, date)

  if (history) {
    const orders = safeJsonParse(history.orders, {})
    return {
      orders,
      source: 'dialysis_orders_history',
      effectiveDate: orders.effectiveDate || history.created_at,
      historyId: history.id,
    }
  }

  const orders = safeJsonParse(patient.dialysis_orders, {})
  return {
    orders,
    source: 'patients.dialysis_orders',
    effectiveDate: orders.effectiveDate || null,
  }
}

/**
 * 病人頻率來源優先序（與前端 my-patients 一致）：
 * 總表 MASTER_SCHEDULE 規則 → patients.schedule_rule → 醫囑 freq（已淘汰欄位）→ 排程 slot freq。
 */
function resolvePatientFreq(db, patient, orders, slotData) {
  if (!patient) return ''
  const masterDoc = db.prepare("SELECT schedule FROM base_schedules WHERE id = 'MASTER_SCHEDULE'").get()
  const masterRules = safeJsonParse(masterDoc?.schedule, {})
  const scheduleRule = safeJsonParse(patient.schedule_rule, {})
  return getValue(masterRules?.[patient.id]?.freq, scheduleRule?.freq, orders?.freq, slotData?.freq)
}

/**
 * AK 以 / 分隔代表一週各次輪替（第 1 段=本週第 1 次…），依日期星期與頻率取當次那一顆；
 * 無法判定（頻率未知、非透析日、段數不足）時 akToday 回傳完整原值（與備物計算相同的保守策略）。
 */
function resolveAkForDate(ak, freq, date) {
  const raw = normalizeAkAliases(ak)
  if (!raw) return { ak: '', akToday: '', akIsRotation: false }
  const dayIndex = getTaipeiDayIndex(new Date(`${date}T00:00:00Z`))
  return { ak: raw, akToday: resolveDailyRotationValue(raw, freq, dayIndex), akIsRotation: raw.includes('/') }
}

function normalizeDialysisOrder(orderSource, patient, slotData, freq = '', date = getTaipeiTodayString()) {
  const orders = orderSource.orders || {}
  const mode = getValue(slotData?.modeOverride, orders.modeOverride, orders.mode, orders.dialysisMode)
  const dialysisTime = parseDialysisTime(orders)
  const heparinDose = splitHeparinDose(orders.heparinLM, orders.heparin)
  const heparinLoading = getValue(orders.heparinInitial, orders.heparinLoading, heparinDose.loading)
  const heparinMaintain = getValue(orders.heparinMaintenance, orders.heparinMaintain, heparinDose.maintain)
  const heparin = getValue(
    orders.heparinLM,
    orders.heparin,
    heparinLoading && heparinMaintain
      ? `${heparinLoading}/${heparinMaintain}${orders.heparinRinse ? `/${orders.heparinRinse}` : ''}`
      : '',
    heparinLoading,
  )

  return {
    source: orderSource.source,
    historyId: orderSource.historyId || null,
    effectiveDate: orderSource.effectiveDate || null,
    mode,
    ak: getValue(orders.ak, orders.dialyzer, orders.artificialKidney),
    ...resolveAkForDate(getValue(orders.ak, orders.dialyzer, orders.artificialKidney), freq, date),
    freq,
    dialysateCa: getValue(orders.dialysateCa, orders.dialysate, orders.dialysateA),
    bicarbonate: getValue(orders.bicarbonate, orders.dialysateB, orders.bPowder),
    heparin,
    heparinRinse: getValue(orders.heparinRinse, orders.rinse),
    heparinLoading,
    heparinMaintain,
    vascAccess: getValue(orders.vascAccess, orders.vascularAccess, patient?.vasc_access),
    bloodFlow: getValue(orders.bloodFlow, orders.blood_flow),
    dialysateFlow: getValue(orders.dialysateFlow, orders.dialysateFlowRate, orders.dialysisFlow, orders.dialysate_flow),
    dialysisHours: dialysisTime.text || getValue(orders.dialysisHours, orders.hours, orders.duration),
    dialysisTimeHours: dialysisTime.hours,
    dialysisTimeMinutes: dialysisTime.minutes,
    dryWeight: getNumericValue(orders.dryWeight, orders.dry_weight),
    dehydration: getNumericValue(orders.dehydration, orders.uf, orders.targetUf),
    raw: orders,
  }
}

function normalizePatient(patient, date) {
  if (!patient) return null
  return {
    id: patient.id,
    name: patient.name,
    medicalRecordNumber: patient.medical_record_number,
    age: calculateAge(patient.birth_date, date),
    gender: patient.gender || '',
    status: patient.status,
    wardNumber: patient.ward_number,
    bedNumber: patient.bed_number,
    physician: patient.physician,
    vascAccess: patient.vasc_access,
    notes: patient.notes,
  }
}

function buildWeightAssessment(order) {
  const todayWeight = null
  const dryWeight = order.dryWeight ?? null
  const targetUf =
    typeof todayWeight === 'number' && typeof dryWeight === 'number'
      ? Number((todayWeight - dryWeight).toFixed(1))
      : null

  return {
    todayWeight,
    dryWeight,
    targetUf,
    source: todayWeight === null ? 'not_connected' : 'manual',
    note: todayWeight === null ? '尚未串接體重機或手動輸入今日體重，應脫水暫不計算' : '',
  }
}

function mapTask(row) {
  return {
    id: row.id,
    source: 'task',
    type: row.type,
    title: row.title,
    content: row.content || row.description || row.title || '',
    status: row.status,
    targetDate: row.target_date,
    creator: safeJsonParse(row.creator || row.created_by, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function getHandoverItems(db, patientId, date, shift) {
  if (!patientId) return []

  const items = []
  const tasks = db
    .prepare(
      `
      SELECT *
      FROM tasks
      WHERE patient_id = ?
        AND category = 'message'
        AND status NOT IN ('completed', 'resolved', 'cancelled', 'deleted')
      ORDER BY created_at DESC
      LIMIT 8
    `,
    )
    .all(patientId)
  items.push(...tasks.map(mapTask))

  const conditionRecords = db
    .prepare(
      `
      SELECT *
      FROM condition_records
      WHERE patient_id = ?
        AND record_date >= ?
        AND record_date <= ?
      ORDER BY record_date DESC, created_at DESC
      LIMIT 6
    `,
    )
    .all(patientId, subtractDays(date, 30), date)

  items.push(
    ...conditionRecords.map((record) => ({
      id: record.id,
      source: 'condition_record',
      type: 'condition',
      title: '病情紀錄',
      content: record.content || '',
      recordDate: record.record_date,
      creator: safeJsonParse(record.created_by, {}),
      createdAt: record.created_at,
      updatedAt: record.updated_at,
    })),
  )

  const handover = db
    .prepare(
      `
      SELECT *
      FROM handover_logs
      WHERE (date IS NULL OR date = ?)
        AND (shift IS NULL OR shift = ? OR shift = '')
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 4
    `,
    )
    .all(date, shift)

  for (const log of handover) {
    const logItems = safeJsonParse(log.items, [])
    const patientItems = Array.isArray(logItems)
      ? logItems.filter((item) => !item.patientId || item.patientId === patientId)
      : []

    if (patientItems.length > 0) {
      items.push(
        ...patientItems.map((item, index) => ({
          id: `${log.id}-${index}`,
          source: 'handover_log',
          type: 'handover',
          title: '交班日誌',
          content: item.content || item.text || String(item),
          createdAt: log.created_at,
          updatedAt: log.updated_at,
        })),
      )
    } else if (log.content) {
      items.push({
        id: log.id,
        source: 'handover_log',
        type: 'handover',
        title: '交班日誌',
        content: log.content,
        createdAt: log.created_at,
        updatedAt: log.updated_at,
      })
    }
  }

  return items.slice(0, 12)
}

function buildShiftCandidates(db, schedule, bedKey, selectedShift, autoShift) {
  return DASHBOARD_SHIFTS.map((shift) => {
    const slotKey = `${bedKey}-${shift}`
    const slot = schedule[slotKey] || null
    // 排程 slot 多半只存 patientId、patientName 為空（名字靠 patientId 解析），
    // 這裡若 patientName 為空就從 patients 表補上，避免候選分頁誤顯示「空床」。
    let patientName = slot?.patientName || ''
    if (!patientName && slot?.patientId) {
      const p = db
        .prepare('SELECT name FROM patients WHERE id = ? AND is_deleted = 0')
        .get(slot.patientId)
      patientName = p?.name || ''
    }
    return {
      shift,
      label: SHIFT_LABELS[shift] || shift,
      slotKey,
      hasPatient: !!slot?.patientId,
      patientId: slot?.patientId || null,
      patientName,
      isSelected: shift === selectedShift,
      isAuto: shift === autoShift,
    }
  })
}

export function getDashboardData(db, { bedKey: rawBedKey, date, shift = 'auto' }) {
  const targetDate = date || getTaipeiTodayString()
  const bedKey = normalizeBedKey(rawBedKey)
  const autoShift = resolveDashboardShift()
  const requestedExplicitShift = DASHBOARD_SHIFTS.includes(shift)
  const { schedule, source: scheduleSource } = getScheduleForDate(db, targetDate)

  let selectedShift = requestedExplicitShift ? shift : autoShift
  // 「依床位開啟」(shift=auto) 時，若目前時間對應的班別此床沒有病人，
  // 自動改顯示當天此床有排程病人的班別，避免誤判為空床。
  // 使用者手動點選特定班別 (early/noon/late) 時則尊重其選擇，不自動跳轉。
  if (!requestedExplicitShift && !schedule[`${bedKey}-${selectedShift}`]?.patientId) {
    const occupiedShift = DASHBOARD_SHIFTS.find(
      (candidateShift) => schedule[`${bedKey}-${candidateShift}`]?.patientId,
    )
    if (occupiedShift) selectedShift = occupiedShift
  }

  const slotKey = `${bedKey}-${selectedShift}`
  const slotData = schedule[slotKey] || null
  const patient = slotData?.patientId
    ? db.prepare('SELECT * FROM patients WHERE id = ? AND is_deleted = 0').get(slotData.patientId)
    : null

  const patientInfo = normalizePatient(patient, targetDate)
  const orderSource = patient ? getLatestDialysisOrders(db, patient, targetDate) : { orders: {}, source: 'none' }
  const patientFreq = patient ? resolvePatientFreq(db, patient, orderSource.orders, slotData) : ''
  const dialysisOrder = patient ? normalizeDialysisOrder(orderSource, patient, slotData, patientFreq, targetDate) : null
  const medicationsToday = patient ? getDailyInjections(db, targetDate, [patient.id]) : []
  const handoverItems = patient ? getHandoverItems(db, patient.id, targetDate, selectedShift) : []

  const status = patient
    ? 'scheduled'
    : slotData?.patientId
      ? 'missing_patient'
      : 'empty'

  return {
    context: {
      bedKey,
      bedLabel: formatBedLabel(bedKey),
      date: targetDate,
      requestedShift: shift,
      selectedShift,
      selectedShiftLabel: SHIFT_LABELS[selectedShift] || selectedShift,
      autoShift,
      autoShiftLabel: SHIFT_LABELS[autoShift] || autoShift,
      slotKey,
      scheduleSource,
    },
    dashboardStatus: {
      status,
      message:
        status === 'scheduled'
          ? ''
          : status === 'missing_patient'
            ? '排程有病人 ID，但病人資料不存在或已刪除'
            : '此床位在目前班別沒有排程病人',
    },
    shiftCandidates: buildShiftCandidates(db, schedule, bedKey, selectedShift, autoShift),
    slot: slotData,
    patient: patientInfo,
    dialysisOrder,
    weightAssessment: dialysisOrder ? buildWeightAssessment(dialysisOrder) : null,
    medicationsToday,
    handoverItems,
    risk: {
      hypotensionProbability: null,
      modelStatus: 'not_configured',
    },
    updatedAt: new Date().toISOString(),
  }
}
