// 病人管理路由
import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { getDatabase } from '../db/init.js'
import { authenticate, isContributor, isEditor, logAudit } from '../middleware/auth.js'
import { formatDateToYYYYMMDD, getTaipeiTodayString } from '../utils/dateUtils.js'
import { validate } from '../middleware/validate.js'
import { syncEventsToKiditLogbook } from '../services/kiditSync.js'
import { emitExceptionChange, emitScheduleSaved } from '../services/eventBus.js'
import { rebuildSingleDaySchedule, isTodayScheduleFrozen } from '../services/scheduleSync.js'
import { removeAutoMovementFromDailyLog } from '../services/dailyLogMovementSync.js'
import { normalizeDialysisMode, normalizeDialysisOrdersMode } from '../utils/dialysisMode.js'
import { recordPatientHistory, createPatientSnapshot } from '../services/patientHistory.js'

const router = Router()

// 狀態碼的中文對照表
const STATUS_MAP = {
  opd: '門診',
  ipd: '住院',
  er: '急診',
}

/**
 * 將病人動態加入當日工作日誌
 * 注意：Kidit 同步統一由工作日誌保存時處理 (PUT /api/nursing/daily-logs/:date)
 */
function addMovementToDailyLog(db, movementData) {
  const todayStr = getTaipeiTodayString()
  const movement = {
    ...movementData,
    timestamp: movementData.timestamp || new Date().toISOString(),
  }

  try {
    // 取得現有日誌
    const dailyLog = db.prepare(`SELECT * FROM daily_logs WHERE date = ?`).get(todayStr)

    if (dailyLog) {
      const movements = JSON.parse(dailyLog.patient_movements || '[]')

      // 檢查是否已存在相同 ID 的記錄（避免重複）
      const existingIndex = movements.findIndex(m => m.id === movementData.id)
      if (existingIndex >= 0) {
        // 如果有 originalAutoId 表示已被手動編輯，跳過
        if (movements[existingIndex].originalAutoId) {
          console.log(`[DailyLog] 動態 ${movementData.id} 已被手動編輯，跳過`)
          return
        }
        // 更新現有記錄
        movements[existingIndex] = movement
      } else {
        // 新增記錄
        movements.push(movement)
      }

      db.prepare(`
        UPDATE daily_logs
        SET patient_movements = ?, updated_at = datetime('now', 'localtime')
        WHERE date = ?
      `).run(JSON.stringify(movements), todayStr)
    } else {
      const movements = [movement]
      // 建立新的日誌
      db.prepare(`
        INSERT INTO daily_logs (id, date, patient_movements, announcements, created_at, updated_at)
        VALUES (?, ?, ?, '[]', datetime('now', 'localtime'), datetime('now', 'localtime'))
      `).run(todayStr, todayStr, JSON.stringify(movements))
    }

    console.log(`[DailyLog] 已記錄動態: ${movementData.type} - ${movementData.name}`)

    // 同步到 Kidit 日誌本
    const updatedLog = db.prepare(`SELECT * FROM daily_logs WHERE date = ?`).get(todayStr)
    if (updatedLog) {
      syncEventsToKiditLogbook(todayStr, {
        patientMovements: JSON.parse(updatedLog.patient_movements || '[]'),
        vascularAccessLog: JSON.parse(updatedLog.vascular_access_log || '[]'),
        createdAt: updatedLog.created_at,
      }).catch(err => console.error('[DailyLog] Kidit 同步失敗 (非致命):', err))
    }
  } catch (error) {
    console.error('[DailyLog] 記錄失敗:', error)
  }
}

function safeJsonParse(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback
  } catch {
    return fallback
  }
}

function getDialysisMode(patient) {
  const dialysisOrders = safeJsonParse(patient?.dialysis_orders, {})
  return dialysisOrders.mode || null
}

function exceptionBelongsToPatient(exception, patientId) {
  if (exception.patient_id === patientId) return true

  const patient1 = safeJsonParse(exception.patient1)
  const patient2 = safeJsonParse(exception.patient2)

  return (
    patient1?.patientId === patientId ||
    patient1?.id === patientId ||
    patient2?.patientId === patientId ||
    patient2?.id === patientId
  )
}

function collectFutureExceptionDates(exception, todayStr) {
  const dates = new Set()
  const from = safeJsonParse(exception.from_data)
  const to = safeJsonParse(exception.to_data)

  if (exception.type === 'SUSPEND' && exception.start_date && exception.end_date) {
    const start = new Date(`${exception.start_date}T00:00:00Z`)
    const end = new Date(`${exception.end_date}T00:00:00Z`)
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
      for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
        const dateStr = formatDateToYYYYMMDD(d)
        if (dateStr >= todayStr) dates.add(dateStr)
      }
    }
  } else {
    [
      exception.date,
      exception.start_date,
      exception.end_date,
      from?.sourceDate,
      to?.goalDate,
    ].filter(Boolean).forEach((dateStr) => {
      if (dateStr >= todayStr) dates.add(dateStr)
    })
  }

  return Array.from(dates)
}

function rebuildSchedulesForDates(db, dates, modifiedBy) {
  if (dates.length === 0) return

  const masterDoc = db.prepare(`
    SELECT schedule FROM base_schedules WHERE id = 'MASTER_SCHEDULE'
  `).get()
  const masterRules = masterDoc ? safeJsonParse(masterDoc.schedule) : {}
  const patients = db.prepare(`SELECT * FROM patients WHERE is_deleted = 0`).all()
  const patientsMap = new Map(patients.map(patient => [patient.id, patient]))
  const activeMasterRules = Object.fromEntries(
    Object.entries(masterRules).filter(([patientId]) => patientsMap.has(patientId)),
  )

  for (const dateStr of dates) {
    // 今日排程整天凍結（06:00 起）：跳過重建，今天由現場組長手動調整。
    // 凌晨（預約變更/預約刪除 cron）不凍結，生效日當天的清理照常執行。
    if (isTodayScheduleFrozen(dateStr)) {
      console.log(`[PatientCleanup] ${dateStr} 今日排程已凍結，跳過重建（由現場手動調整）`)
      continue
    }
    const finalSchedule = rebuildSingleDaySchedule(dateStr, activeMasterRules, patientsMap)
    db.prepare(`
      INSERT INTO schedules (id, date, schedule, sync_method, last_modified_by, created_at, updated_at)
      VALUES (?, ?, ?, 'patient_exception_cleanup', ?, datetime('now', 'localtime'), datetime('now', 'localtime'))
      ON CONFLICT(date) DO UPDATE SET
        schedule = excluded.schedule,
        sync_method = excluded.sync_method,
        last_modified_by = excluded.last_modified_by,
        updated_at = datetime('now', 'localtime')
    `).run(
      dateStr,
      dateStr,
      JSON.stringify(finalSchedule),
      JSON.stringify(modifiedBy || {}),
    )
  }
}

function deleteFutureScheduleExceptionsForPatient(db, patientId, reason, modifiedBy) {
  const todayStr = getTaipeiTodayString()
  const candidates = db.prepare(`SELECT * FROM schedule_exceptions`).all()
  const related = candidates
    .filter((exception) => exceptionBelongsToPatient(exception, patientId))
    .map((exception) => ({
      exception,
      futureDates: collectFutureExceptionDates(exception, todayStr),
    }))
    .filter((item) => item.futureDates.length > 0)

  if (related.length === 0) return []

  const deleteById = db.prepare(`DELETE FROM schedule_exceptions WHERE id = ?`)
  const datesToRebuild = new Set()
  const deleted = []

  for (const { exception, futureDates } of related) {
    const to = safeJsonParse(exception.to_data)
    if (exception.type === 'ADD_SESSION' && to?.goalDate && to.goalDate >= todayStr) {
      removeAutoMovementFromDailyLog(db, to.goalDate, `auto_add_session_${exception.id}`)
    }

    deleteById.run(exception.id)
    futureDates.forEach(date => datesToRebuild.add(date))
    emitExceptionChange('deleted', {
      id: exception.id,
      type: exception.type,
      patientId,
      affectedDates: futureDates,
      reason,
    })

    deleted.push({
      id: exception.id,
      type: exception.type,
      status: exception.status,
      affectedDates: futureDates,
    })
  }

  rebuildSchedulesForDates(db, Array.from(datesToRebuild).sort(), modifiedBy)
  return deleted
}

/**
 * 軟刪病人「未來且未完成」的訊息/交辦（tasks 表，訊息中心 category=task/message）。
 * 病人刪除後，未來日期的交辦/留言已失去意義，一併清掉避免訊息中心殘留。
 * 與調班清理一致：只處理 target_date >= 今天；已完成/已刪除者保留為歷史。
 */
function deleteFutureMessagesForPatient(db, patientId) {
  const todayStr = getTaipeiTodayString()
  const rows = db.prepare(`
    SELECT id, target_date, category FROM tasks
    WHERE patient_id = ?
      AND status NOT IN ('completed', 'deleted')
      AND target_date IS NOT NULL
      AND target_date >= ?
  `).all(patientId, todayStr)

  if (rows.length === 0) return []

  const softDelete = db.prepare(`
    UPDATE tasks
    SET status = 'deleted', updated_at = datetime('now', 'localtime')
    WHERE id = ?
  `)
  const deleted = []
  for (const row of rows) {
    softDelete.run(row.id)
    deleted.push({ id: row.id, category: row.category, targetDate: row.target_date })
  }
  return deleted
}

/**
 * 建立病人快照（用於歷史記錄）
 */
/**
 * 將資料庫記錄轉換為 API 回應格式
 */
const PATIENT_SELECT_COLUMNS = `
  p.*,
  (
    SELECT MAX(h.timestamp)
    FROM patient_history h
    WHERE h.patient_id = p.id AND h.event_type = 'DELETE'
  ) AS history_deleted_at
`

/**
 * 把資料庫時間字串正規化成 UTC 毫秒，用於跨欄位比較「誰最新」。
 * - 含 Z / 時區偏移（如 ISO `2026-06-24T02:09:05.492Z`）：直接當帶時區解析。
 * - naive 字串（如 `2026-06-24 13:23:54`，由 SQLite datetime('now','localtime') 產生）：視為台北時間 (+08:00)。
 * 回傳 null 表示無法解析。
 */
function timeStringToMs(s) {
  if (!s) return null
  const str = String(s).trim()
  if (!str) return null
  const hasTz = /[zZ]$|[+\-]\d\d:?\d\d$/.test(str)
  const d = hasTz ? new Date(str) : new Date(str.replace(' ', 'T') + '+08:00')
  const t = d.getTime()
  return Number.isNaN(t) ? null : t
}

/**
 * 取已刪除病人「最新的刪除/異動時間」。
 * deleted_at / history_deleted_at(DELETE 歷史 MAX) / updated_at 三者各有可能殘留舊值，
 * 取時間最新者並回傳其「原始字串」（保留原本記錄值，交給前端 formatDate 顯示）。
 */
function pickLatestDeletedAt(row) {
  const candidates = [row.deleted_at, row.history_deleted_at, row.updated_at]
  let best = null
  let bestMs = -Infinity
  for (const c of candidates) {
    const ms = timeStringToMs(c)
    if (ms != null && ms > bestMs) {
      bestMs = ms
      best = c
    }
  }
  return best
}

function formatPatient(row) {
  const dialysisOrders = JSON.parse(row.dialysis_orders || '{}')
  // ✨ 從 dialysisOrders 中分離出 crrtOrders
  const crrtOrders = dialysisOrders.crrtOrders || null
  return {
    id: row.id,
    medicalRecordNumber: row.medical_record_number,
    name: row.name,
    status: row.status,
    isDeleted: row.is_deleted === 1,
    originalStatus: row.original_status || (row.is_deleted === 1 ? row.status : null),
    deleteReason: row.delete_reason,
    // 已刪除病人的「刪除/異動時間」：取 deleted_at、DELETE 歷史(history_deleted_at)、updated_at 三者中「最新」者。
    // 三個欄位各有殘留舊值的情形（deleted_at 可能 NULL 或殘留前次刪除；history 可能漏寫；updated_at 可能早於刪除），
    // 任一單獨取用都會顯示到舊日期，故取最新值才正確。見 pickLatestDeletedAt。
    deletedAt: row.is_deleted === 1
      ? pickLatestDeletedAt(row)
      : (row.deleted_at || null),
    dialysisOrders: dialysisOrders,
    firstDialysisPlan: dialysisOrders.firstDialysisPlan || null,
    crrtOrders: crrtOrders,  // ✨ 新增：回傳 CRRT 醫囑
    // 將 freq 和 mode 也放在頂層，方便前端使用
    freq: dialysisOrders.freq || null,
    mode: dialysisOrders.mode || null,
    birthDate: row.birth_date,
    gender: row.gender,
    idNumber: row.id_number,
    phone: row.phone,
    address: row.address,
    emergencyContact: row.emergency_contact,
    emergencyPhone: row.emergency_phone,
    physician: row.physician,
    firstDialysisDate: row.first_dialysis_date,
    vascAccess: row.vasc_access,
    accessCreationDate: row.access_creation_date,
    wardNumber: row.ward_number,
    bedNumber: row.bed_number,
    hospitalInfo: JSON.parse(row.hospital_info || '{}'),
    inpatientReason: row.inpatient_reason,
    dialysisReason: row.dialysis_reason,
    notes: row.notes,
    remarks: row.notes,  // 前端用 remarks，對應到 notes
    patientCategory: row.patient_category || 'opd_regular',
    diseases: JSON.parse(row.diseases || '[]'),
    patientStatus: JSON.parse(row.patient_status || '{}'),
    isHepatitis: row.is_hepatitis === 1,
    scheduleRule: JSON.parse(row.schedule_rule || '{}'),
    lastModifiedBy: JSON.parse(row.last_modified_by || '{}'),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/**
 * 將 API 請求資料轉換為資料庫格式
 * @param {object} data - API 請求資料
 * @param {object|null} existingPatient - 現有病人資料（用於合併 dialysis_orders）
 */
function toDbFormat(data, existingPatient = null) {
  const result = {}

  if (data.medicalRecordNumber !== undefined) result.medical_record_number = data.medicalRecordNumber
  if (data.name !== undefined) result.name = data.name
  if (data.status !== undefined) result.status = data.status
  if (data.isDeleted !== undefined) result.is_deleted = data.isDeleted ? 1 : 0
  if (data.originalStatus !== undefined) result.original_status = data.originalStatus
  if (data.deleteReason !== undefined) result.delete_reason = data.deleteReason
  if (data.deletedAt !== undefined) result.deleted_at = data.deletedAt

  // ✨ 核心修改：處理透析醫囑時，先讀取現有資料再合併
  // 這樣單獨更新 crrtOrders 時，不會覆蓋 freq、mode 等欄位
  const existingDialysisOrders = existingPatient
    ? JSON.parse(existingPatient.dialysis_orders || '{}')
    : {}
  
  // 如果傳入完整的 dialysisOrders，直接使用；否則基於現有資料合併
  const dialysisOrders = data.dialysisOrders !== undefined
    ? { ...existingDialysisOrders, ...data.dialysisOrders }
    : { ...existingDialysisOrders }
  
  if (data.freq !== undefined) dialysisOrders.freq = data.freq
  if (data.mode !== undefined) dialysisOrders.mode = data.mode
  // 處理 CRRT 醫囑：合併到現有資料
  if (data.crrtOrders !== undefined) dialysisOrders.crrtOrders = data.crrtOrders

  // 正規化透析模式拼法（不論來源是 data.mode 或 data.dialysisOrders）
  normalizeDialysisOrdersMode(dialysisOrders)

  // 只在有更新時才寫入 dialysis_orders
  if (data.dialysisOrders !== undefined || data.freq !== undefined || 
      data.mode !== undefined || data.crrtOrders !== undefined) {
    result.dialysis_orders = JSON.stringify(dialysisOrders)
  }

  if (data.birthDate !== undefined) result.birth_date = data.birthDate
  if (data.gender !== undefined) result.gender = data.gender
  if (data.idNumber !== undefined) result.id_number = data.idNumber
  if (data.phone !== undefined) result.phone = data.phone
  if (data.address !== undefined) result.address = data.address
  if (data.emergencyContact !== undefined) result.emergency_contact = data.emergencyContact
  if (data.emergencyPhone !== undefined) result.emergency_phone = data.emergencyPhone
  if (data.physician !== undefined) result.physician = data.physician
  if (data.firstDialysisDate !== undefined) result.first_dialysis_date = data.firstDialysisDate
  if (data.vascAccess !== undefined) result.vasc_access = data.vascAccess
  if (data.accessCreationDate !== undefined) result.access_creation_date = data.accessCreationDate
  if (data.wardNumber !== undefined) result.ward_number = data.wardNumber
  if (data.bedNumber !== undefined) result.bed_number = data.bedNumber
  if (data.hospitalInfo !== undefined) result.hospital_info = JSON.stringify(data.hospitalInfo)
  if (data.inpatientReason !== undefined) result.inpatient_reason = data.inpatientReason
  if (data.dialysisReason !== undefined) result.dialysis_reason = data.dialysisReason
  // 處理 notes/remarks (前端用 remarks，後端存 notes)
  if (data.notes !== undefined) result.notes = data.notes
  if (data.remarks !== undefined) result.notes = data.remarks
  // 病人分類與疾病
  if (data.patientCategory !== undefined) result.patient_category = data.patientCategory
  if (data.diseases !== undefined) result.diseases = JSON.stringify(data.diseases)
  if (data.patientStatus !== undefined) result.patient_status = JSON.stringify(data.patientStatus)
  if (data.isHepatitis !== undefined) result.is_hepatitis = data.isHepatitis ? 1 : 0
  if (data.scheduleRule !== undefined) result.schedule_rule = JSON.stringify(data.scheduleRule)
  if (data.lastModifiedBy !== undefined) result.last_modified_by = JSON.stringify(data.lastModifiedBy)

  return result
}

/**
 * GET /api/patients
 * 取得所有病人列表
 */
router.get('/', authenticate, (req, res) => {
  try {
    const db = getDatabase()
    const { includeDeleted } = req.query

    let query = `SELECT ${PATIENT_SELECT_COLUMNS} FROM patients p`
    if (includeDeleted !== 'true') {
      query += ' WHERE p.is_deleted = 0'
    }
    query += ' ORDER BY p.name'

    const patients = db.prepare(query).all()


    res.json(patients.map(formatPatient))

  } catch (error) {
    console.error('取得病人列表錯誤:', error)
    res.status(500).json({
      error: true,
      message: '取得病人列表失敗'
    })
  }
})

/**
 * GET /api/patients/with-rules
 * 取得所有病人（含排班規則）
 */
router.get('/with-rules', authenticate, (req, res) => {
  try {
    const db = getDatabase()

    // 取得病人列表
    const patients = db.prepare(`
      SELECT ${PATIENT_SELECT_COLUMNS} FROM patients p WHERE p.is_deleted = 0 ORDER BY p.name
    `).all()

    // 取得總表規則
    const masterSchedule = db.prepare(`
      SELECT schedule FROM base_schedules WHERE id = 'MASTER_SCHEDULE'
    `).get()



    const masterRules = masterSchedule ? JSON.parse(masterSchedule.schedule || '{}') : {}

    // 合併規則到病人資料
    const patientsWithRules = patients.map(p => {
      const formatted = formatPatient(p)
      formatted.scheduleRule = masterRules[p.id] || null
      return formatted
    })

    res.json(patientsWithRules)

  } catch (error) {
    console.error('取得病人列表錯誤:', error)
    res.status(500).json({
      error: true,
      message: '取得病人列表失敗'
    })
  }
})

/**
 * GET /api/patients/history
 * 取得所有病人歷史記錄
 * 注意：此路由必須在 /:id 之前，否則會被 /:id 攔截
 */
router.get('/history', authenticate, (req, res) => {
  try {
    const db = getDatabase()
    const { since, until, patientId, eventType, limit } = req.query

    const conditions = []
    const params = []

    if (since) {
      conditions.push('timestamp >= ?')
      params.push(since)
    }
    if (until) {
      conditions.push('timestamp <= ?')
      params.push(until)
    }
    if (patientId) {
      conditions.push('patient_id = ?')
      params.push(patientId)
    }
    if (eventType) {
      conditions.push('event_type = ?')
      params.push(eventType)
    }

    // 無篩選時維持原本 LIMIT 100，避免全表掃描；有篩選時允許至 1000
    const effectiveLimit = Math.min(parseInt(limit, 10) || (conditions.length > 0 ? 1000 : 100), 5000)

    let query = 'SELECT * FROM patient_history'
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ')
    }
    query += ' ORDER BY timestamp DESC LIMIT ?'
    params.push(effectiveLimit)

    const history = db.prepare(query).all(...params)

    res.json(history.map(h => ({
      id: h.id,
      patientId: h.patient_id,
      patientName: h.patient_name,
      eventType: h.event_type,
      eventDetails: JSON.parse(h.event_details || '{}'),
      snapshot: JSON.parse(h.snapshot || '{}'),
      timestamp: h.timestamp
    })))

  } catch (error) {
    console.error('取得所有病人歷史錯誤:', error)
    res.status(500).json({
      error: true,
      message: '取得病人歷史失敗'
    })
  }
})

/**
 * GET /api/patients/history/:patientId
 * 取得特定病人歷史記錄
 */
router.get('/history/:patientId', authenticate, (req, res) => {
  try {
    const { patientId } = req.params
    const db = getDatabase()

    const history = db.prepare(`
      SELECT * FROM patient_history
      WHERE patient_id = ?
      ORDER BY timestamp DESC
    `).all(patientId)



    res.json(history.map(h => ({
      id: h.id,
      patientId: h.patient_id,
      patientName: h.patient_name,
      eventType: h.event_type,
      eventDetails: JSON.parse(h.event_details || '{}'),
      snapshot: JSON.parse(h.snapshot || '{}'),
      timestamp: h.timestamp
    })))

  } catch (error) {
    console.error('取得病人歷史錯誤:', error)
    res.status(500).json({
      error: true,
      message: '取得病人歷史失敗'
    })
  }
})

/**
 * POST /api/patients/history
 * 建立病人歷史記錄
 */
router.post('/history', ...isContributor, async (req, res) => {
  try {
    const { patientId, changeType, changeData, notes, patientName } = req.body

    if (!patientId || !changeType) {
      return res.status(400).json({
        error: true,
        message: '缺少必要欄位：patientId, changeType'
      })
    }

    const db = getDatabase()

    // 取得病人名稱（如果沒有提供）
    let actualPatientName = patientName
    if (!actualPatientName) {
      const patient = db.prepare('SELECT name FROM patients WHERE id = ?').get(patientId)
      actualPatientName = patient?.name || '未知'
    }

    const id = `ph_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const now = new Date().toISOString()

    db.prepare(`
      INSERT INTO patient_history (id, patient_id, patient_name, event_type, event_details, snapshot, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      patientId,
      actualPatientName,
      changeType,
      JSON.stringify(changeData || {}),
      JSON.stringify({ notes: notes || '' }),
      now
    )



    res.json({
      success: true,
      id,
      message: '病人歷史記錄已建立'
    })

  } catch (error) {
    console.error('建立病人歷史記錄錯誤:', error)
    res.status(500).json({
      error: true,
      message: '建立病人歷史記錄失敗'
    })
  }
})

// ========================================
// 檢驗報告查詢別名 (對齊 Angular 前端 firestoreUtils 路由)
// 實際資料表與 /api/orders/lab-reports 共用 lab_reports
// 必須定義在 GET /:id 之前，否則會被 /:id 吃掉
// ========================================

// field 白名單：防止以欄位名做 SQL injection
const LAB_REPORT_FIELD_MAP = {
  patientId: 'patient_id',
  id: 'id',
  reportType: 'report_type',
}

const formatLabReport = (r) => ({
  id: r.id,
  patientId: r.patient_id,
  reportDate: r.report_date,
  reportType: r.report_type,
  data: JSON.parse(r.results || '{}'), // 前端只讀 report.data；移除重複 results
  filePath: r.file_path,
  uploadedBy: JSON.parse(r.uploaded_by || '{}'),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

/**
 * POST /api/patients/lab-reports/query
 * 批次查詢檢驗報告 (field IN values)，供 queryWithInChunks 使用
 */
router.post('/lab-reports/query', authenticate, (req, res) => {
  try {
    const { field, values } = req.body || {}
    if (!Array.isArray(values) || values.length === 0) {
      return res.json([])
    }

    const column = LAB_REPORT_FIELD_MAP[field]
    if (!column) {
      return res.status(400).json({
        error: true,
        message: `不支援的查詢欄位: ${field}`,
      })
    }

    const db = getDatabase()
    const placeholders = values.map(() => '?').join(',')
    const reports = db
      .prepare(
        `SELECT * FROM lab_reports WHERE ${column} IN (${placeholders}) ORDER BY report_date DESC`,
      )
      .all(...values)

    res.json(reports.map(formatLabReport))
  } catch (error) {
    console.error('批次查詢檢驗報告錯誤:', error)
    res.status(500).json({
      error: true,
      message: '查詢檢驗報告失敗',
    })
  }
})

/**
 * GET /api/patients/lab-reports
 * 取得檢驗報告列表 (fallback 路徑；patientId 支援逗號多筆)
 */
router.get('/lab-reports', authenticate, (req, res) => {
  try {
    const { patientId, startDate, endDate } = req.query
    const db = getDatabase()

    let query = 'SELECT * FROM lab_reports WHERE 1=1'
    const params = []

    if (patientId) {
      const ids = String(patientId)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      if (ids.length > 0) {
        query += ` AND patient_id IN (${ids.map(() => '?').join(',')})`
        params.push(...ids)
      }
    }

    if (startDate) {
      query += ' AND report_date >= ?'
      params.push(startDate)
    }

    if (endDate) {
      query += ' AND report_date <= ?'
      params.push(endDate)
    }

    query += ' ORDER BY report_date DESC'

    const reports = db.prepare(query).all(...params)
    res.json(reports.map(formatLabReport))
  } catch (error) {
    console.error('取得檢驗報告錯誤:', error)
    res.status(500).json({
      error: true,
      message: '取得檢驗報告失敗',
    })
  }
})

/**
 * GET /api/patients/:id
 * 取得單一病人
 */
/**
 * GET /api/patients/:id/dialysis-dates
 * 反查某病人在指定期間 (預設近一年) 實際排入的本院透析日期
 * 來源: schedules (滾動排程) + archived_schedules (歸檔)，兩表合併去重
 * 注意: 歸檔不完整，舊月份可能仍留在 schedules，故必須合併兩張表
 * Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD (皆可選)
 * 回傳: { count, from, to, dates: [{ date, shift }] }
 */
router.get('/:id/dialysis-dates', authenticate, (req, res) => {
  try {
    const { id } = req.params
    const db = getDatabase()

    // 預設區間: 近一年 (today-1年 ~ today)
    const todayStr = getTaipeiTodayString()
    const oneYearAgo = new Date(todayStr)
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
    const from = req.query.from || formatDateToYYYYMMDD(oneYearAgo)
    const to = req.query.to || todayStr

    // 用 json_each 展開每天排程的各床位槽，比對 patientId
    const rows = db.prepare(`
      SELECT date, json_extract(je.value, '$.shiftId') AS shift
      FROM schedules, json_each(schedule) je
      WHERE json_extract(je.value, '$.patientId') = ?
        AND date >= ? AND date <= ?
      UNION
      SELECT date, json_extract(je.value, '$.shiftId') AS shift
      FROM archived_schedules, json_each(schedule) je
      WHERE json_extract(je.value, '$.patientId') = ?
        AND date >= ? AND date <= ?
      ORDER BY date ASC
    `).all(id, from, to, id, from, to)

    res.json({
      count: rows.length,
      from,
      to,
      dates: rows.map((r) => ({ date: r.date, shift: r.shift || null })),
    })
  } catch (error) {
    console.error('查詢病人透析日期錯誤:', error)
    res.status(500).json({
      error: true,
      message: '查詢病人透析日期失敗',
    })
  }
})

// ── 初透病人衛教紀錄（12 次）─────────────────────────────────────
const EDUCATION_SESSION_COUNT = 12

// 簽核欄位正規化為 { name, date } 或 null（date = YYYY-MM-DD）
function normalizeSign(s) {
  if (!s || typeof s !== 'object') return null
  const name = String(s.name || '').trim()
  const date = s.date ? String(s.date).slice(0, 10) : ''
  if (!name && !date) return null
  return { name, date }
}

function buildEmptyEducationSessions() {
  return Array.from({ length: EDUCATION_SESSION_COUNT }, (_, i) => ({
    index: i + 1,
    dialysisDate: '',      // 透析日期
    topic: '',             // 主題
    educatorSign: null,    // 衛教者/日期（點選簽核 {name,date}）
    signature: '',         // 被衛教者簽名（文字）
    returnDemoSign: null,  // 回示教日期/護理師
    passSign: null,        // 回示教通過日/主護簽章
  }))
}

function normalizeEducationSessions(input) {
  return buildEmptyEducationSessions().map((empty, i) => {
    const s = Array.isArray(input) ? input[i] : null
    if (!s) return empty
    // 相容舊資料：舊欄位 educator/educatedDate → educatorSign
    const educatorSign =
      normalizeSign(s.educatorSign) ||
      (s.educator || s.educatedDate ? normalizeSign({ name: s.educator, date: s.educatedDate }) : null)
    return {
      index: i + 1,
      dialysisDate: s.dialysisDate ? String(s.dialysisDate).slice(0, 10) : '',
      topic: s.topic || '',
      educatorSign,
      signature: s.signature || '',
      returnDemoSign: normalizeSign(s.returnDemoSign),
      passSign: normalizeSign(s.passSign),
    }
  })
}

// 反查病人「應衛教」的透析日期：firstDate ~ today（含）之間實際排入排程的日期，
// 排除外圍床（slot key 前綴 peripheral，如 ICU 床邊透析 — 病人不在洗腎室，無法衛教）。
// 回傳 [{ date, shift }]（shift = early/noon/late，供反查當日照顧護理師）。
// 初透日錨點：該日排程完全查不到才補（資料缺漏仍視為有洗）；若該日只排在外圍則不補。
function getEducationDialysisDates(db, patientId, firstDate, todayStr) {
  if (!patientId || !firstDate || !/^\d{4}-\d{2}-\d{2}$/.test(firstDate)) return []
  if (firstDate > todayStr) return [] // 初透日都還沒到 → 全不帶
  const rows = db
    .prepare(
      `
      SELECT DISTINCT date, slotKey FROM (
        SELECT date, je.key AS slotKey FROM schedules, json_each(schedule) je
        WHERE json_extract(je.value, '$.patientId') = ?
          AND date >= ? AND date <= ?
        UNION
        SELECT date, je.key AS slotKey FROM archived_schedules, json_each(schedule) je
        WHERE json_extract(je.value, '$.patientId') = ?
          AND date >= ? AND date <= ?
      )
      ORDER BY date ASC
    `,
    )
    .all(patientId, firstDate, todayStr, patientId, firstDate, todayStr)

  const byDate = new Map() // date -> shift
  let firstDateInSchedule = false
  for (const r of rows) {
    if (r.date === firstDate) firstDateInSchedule = true
    if (String(r.slotKey || '').startsWith('peripheral')) continue
    if (!byDate.has(r.date)) byDate.set(r.date, String(r.slotKey).split('-').pop() || '')
  }
  if (!firstDateInSchedule) byDate.set(firstDate, '')

  return [...byDate.entries()]
    .map(([date, shift]) => ({ date, shift }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

// 主護反查：讀「護理師分配病人照護清單」（nurse_patient_care，單一 JSON 文件 id='main'），
// 建 patientId → { nurseId, nurseName } 反查表。排除名單（excluded_nurse_ids）內的護理師不列入，
// 與照護清單前端顯示規則一致。衛教紀錄「回示教通過日/主護簽章」欄的主護即由此對應。
function getPrimaryNurseMap(db) {
  const map = new Map()
  try {
    const row = db
      .prepare("SELECT assignments, excluded_nurse_ids FROM nurse_patient_care WHERE id = 'main'")
      .get()
    if (!row) return map
    const excluded = new Set(JSON.parse(row.excluded_nurse_ids || '[]'))
    const assignments = JSON.parse(row.assignments || '[]')
    for (const a of Array.isArray(assignments) ? assignments : []) {
      if (!a?.nurseId || excluded.has(a.nurseId)) continue
      for (const pid of Array.isArray(a.patientIds) ? a.patientIds : []) {
        if (!map.has(pid)) map.set(pid, { nurseId: a.nurseId, nurseName: a.nurseName || '' })
      }
    }
  } catch (error) {
    console.error('解析護理師照護清單失敗:', error)
  }
  return map
}

/**
 * GET /api/patients/education-list
 * 後台衛教進度總覽：列出「目前首透中」或「已有衛教進度」的病人 + 進度統計。
 * 注意：必須註冊在 GET /:id 之前，否則會被 :id 路由攔截。
 */
router.get('/education-list', ...isEditor, (req, res) => {
  try {
    const db = getDatabase()
    const todayStr = getTaipeiTodayString()
    const rows = db.prepare(`
      SELECT p.id, p.name, p.medical_record_number, p.status, p.ward_number,
             p.first_dialysis_date, p.patient_status, p.dialysis_orders,
             e.sessions AS edu_sessions, e.admission_date AS edu_admission, e.updated_at AS edu_updated,
             e.paper_education AS edu_paper, e.paper_completed AS edu_paper_done
      FROM patients p
      LEFT JOIN education_records e ON e.patient_id = p.id
      WHERE p.is_deleted = 0
    `).all()

    const total = EDUCATION_SESSION_COUNT
    const primaryNurseMap = getPrimaryNurseMap(db)
    // 頻率真理之源=總表規則（迴圈外讀一次），供進度表「頻率」欄
    const masterDoc = db.prepare(`
      SELECT schedule FROM base_schedules WHERE id = 'MASTER_SCHEDULE'
    `).get()
    const masterRules = masterDoc ? safeJsonParse(masterDoc.schedule) : {}
    const list = []
    for (const r of rows) {
      let firstActive = false
      let firstDate = r.first_dialysis_date || ''
      try {
        const ps = JSON.parse(r.patient_status || '{}')
        firstActive = !!ps?.isFirstDialysis?.active
        if (ps?.isFirstDialysis?.date) firstDate = ps.isFirstDialysis.date
      } catch {
        /* patient_status 解析失敗，忽略 */
      }

      // 醫囑 JSON：頻率 fallback（每日/臨時病人不在總表）＋透析模式（供預設排除判斷）
      let ordersFreq = ''
      let dialysisMode = ''
      try {
        const orders = JSON.parse(r.dialysis_orders || '{}') || {}
        ordersFreq = orders.freq || ''
        dialysisMode = normalizeDialysisMode(orders.mode || '') || ''
      } catch {
        /* dialysis_orders 解析失敗，忽略 */
      }

      let educatedCount = 0
      let returnDemoCount = 0
      let passedCount = 0
      let hasRecord = false
      let sessions = []
      if (r.edu_sessions) {
        try {
          sessions = JSON.parse(r.edu_sessions) || []
          for (const s of sessions) {
            if (s?.educatorSign) educatedCount++
            if (s?.returnDemoSign) returnDemoCount++
            if (s?.passSign) passedCount++
          }
          hasRecord = true
        } catch {
          sessions = []
          /* sessions 解析失敗，當作無進度 */
        }
      }

      // 紙本衛教（病人層級）：已紙本衛教者跳過電子未衛教判定；紙本已完成視為全數通過
      const paperEducation = !!r.edu_paper
      const paperCompleted = paperEducation && !!r.edu_paper_done

      // 納入條件：目前首透中、已有衛教進度、或已標記紙本衛教（避免自動建立的全空白紀錄混入）
      if (!firstActive && educatedCount === 0 && !paperEducation) continue

      // 應衛教日：自初透日起的非外圍透析日（有洗就應衛教，含當日），最多 12 次。
      // 已取消首透者凍結在已存的透析日期，不再往後累計。
      let expectedInfos = []
      if (firstDate) {
        if (firstActive) {
          expectedInfos = getEducationDialysisDates(db, r.id, firstDate, todayStr).slice(0, total)
        } else {
          expectedInfos = sessions
            .filter((s) => s?.dialysisDate)
            .map((s) => ({ date: String(s.dialysisDate).slice(0, 10), shift: '' }))
            .filter((d) => d.date <= todayStr)
        }
      }

      // 未衛教日 = 應衛教日中沒有衛教者簽核的日期；12 次皆已衛教即視為完成、不再列。
      // 已紙本衛教者衛教在紙本進行，電子未衛教日無意義 → 不計（改列紙本頁籤）。
      const uneducatedDates = []
      if (educatedCount < total && !paperEducation) {
        const expectedDateSet = new Set(expectedInfos.map((i) => i.date))
        const educatedOn = new Set(
          sessions
            .filter((s) => s?.educatorSign && s?.dialysisDate)
            .map((s) => String(s.dialysisDate).slice(0, 10)),
        )
        // 有簽核但「沒填透析日期」或「日期不在應衛教窗內」的格數：視為涵蓋最早的未對上日期，
        // 避免誤報未衛教。後者發生在恢復/轉出後回來續用未完成次數、且首透日期被改成回歸日時
        // （舊已衛教紀錄的日期落在新窗之外，仍應消耗應衛教格）。
        let unmatchedSigned = sessions.filter(
          (s) => s?.educatorSign && (!s?.dialysisDate || !expectedDateSet.has(String(s.dialysisDate).slice(0, 10))),
        ).length
        for (const info of expectedInfos) {
          if (educatedOn.has(info.date)) continue
          if (unmatchedSigned > 0) {
            unmatchedSigned--
            continue
          }
          uneducatedDates.push({ date: info.date, shift: info.shift, team: '', nurse: '' })
        }
      }

      list.push({
        patientId: r.id,
        patientName: r.name,
        medicalRecordNumber: r.medical_record_number,
        status: r.status,
        wardNumber: r.ward_number || '',
        freq: masterRules?.[r.id]?.freq || ordersFreq || '',
        // 進度頁預設排除：外圍床（外圍透析日不列入應衛教）或非 HD/SLED 模式
        //（CVVHDF/PP/DFPP/Lipid 等每日洗不排常規床，頻率/床位無意義）
        excluded:
          String(masterRules?.[r.id]?.bedNum || '').startsWith('peripheral') ||
          (!!dialysisMode && dialysisMode !== 'HD' && dialysisMode !== 'SLED'),
        firstDialysisActive: firstActive,
        firstDialysisDate: firstDate || '',
        admissionDate: r.edu_admission || '',
        primaryNurse: primaryNurseMap.get(r.id) || null,
        hasRecord,
        educatedCount,
        returnDemoCount,
        passedCount,
        total,
        paperEducation,
        paperCompleted,
        completed: passedCount >= total || paperCompleted,
        lastUpdated: r.edu_updated || '',
        expectedCount: expectedInfos.length,
        uneducatedCount: uneducatedDates.length,
        uneducatedDates,
      })
    }

    // 反查未衛教日的當天照顧護理師：
    // nurse_assignments.teams JSON = { teams: {`${patientId}-${shift}`: {nurseTeam..}}, names: {隊名: 姓名} }
    const allDates = [...new Set(list.flatMap((it) => it.uneducatedDates.map((d) => d.date)))]
    if (allDates.length > 0) {
      const placeholders = allDates.map(() => '?').join(',')
      const assignRows = db
        .prepare(`SELECT date, teams FROM nurse_assignments WHERE date IN (${placeholders})`)
        .all(...allDates)
      const assignByDate = new Map()
      for (const a of assignRows) {
        try {
          const raw = JSON.parse(a.teams || '{}')
          // 兼容舊扁平格式（同 GET /schedules/nurse-assignments/:date）
          assignByDate.set(a.date, { teams: raw.teams || raw, names: raw.names || {} })
        } catch {
          /* teams 解析失敗，該日查無護理師 */
        }
      }
      for (const it of list) {
        for (const d of it.uneducatedDates) {
          const payload = assignByDate.get(d.date)
          if (!payload) continue
          // 凍結日期（已取消首透）沒有班別資訊 → 三班都試
          const shifts = d.shift ? [d.shift] : ['early', 'noon', 'late']
          for (const sh of shifts) {
            const t = payload.teams?.[`${it.patientId}-${sh}`]
            const team = t?.nurseTeam || t?.nurseTeamIn || t?.nurseTeamOut || ''
            if (team) {
              d.team = team
              d.nurse = payload.names?.[team] || ''
              if (!d.shift) d.shift = sh
              break
            }
          }
        }
      }
    }

    // 排序：已衛教數少者在前（未完成優先），再依姓名
    list.sort(
      (a, b) => a.educatedCount - b.educatedCount || String(a.patientName).localeCompare(b.patientName),
    )

    res.json(list)
  } catch (error) {
    console.error('取得衛教進度清單錯誤:', error)
    res.status(500).json({ error: true, message: '取得衛教進度清單失敗' })
  }
})

/**
 * GET /api/patients/:id/education
 * 取得病人衛教紀錄；若尚無則即時建立 12 筆空白（首透自動產生的等效行為）
 */
router.get('/:id/education', authenticate, (req, res) => {
  try {
    const { id } = req.params
    const db = getDatabase()
    const patient = db.prepare('SELECT id, name, medical_record_number, first_dialysis_date, patient_status, created_at FROM patients WHERE id = ?').get(id)
    if (!patient) return res.status(404).json({ error: true, message: '病人不存在' })

    let row = db.prepare('SELECT * FROM education_records WHERE patient_id = ?').get(id)
    if (!row) {
      const sessions = buildEmptyEducationSessions()
      db.prepare(`
        INSERT INTO education_records (id, patient_id, sessions, created_by)
        VALUES (?, ?, ?, ?)
      `).run(id, id, JSON.stringify(sessions), JSON.stringify({ uid: req.user.id, name: req.user.name }))
      row = db.prepare('SELECT * FROM education_records WHERE patient_id = ?').get(id)
    }

    // 初透日期正本存在巢狀 patient_status.isFirstDialysis.date（表單存檔寫入處），
    // 攤平欄位 first_dialysis_date 不一定同步（可能為 null）。故以巢狀為主、攤平為備。
    let firstDialysisDate = patient.first_dialysis_date
    try {
      const nestedDate = JSON.parse(patient.patient_status || '{}')?.isFirstDialysis?.date
      if (nestedDate) firstDialysisDate = nestedDate
    } catch {
      /* patient_status 解析失敗時退回攤平欄位 */
    }

    // 透析日期預設：只帶入「實際已洗腎」的日期（排除外圍床 — 外圍不列入應衛教），
    // 尚未到的未來日不帶。僅填入「尚未儲存」的格子（不覆蓋已存值）。
    // 空格依序帶入「尚未被任何格使用」的透析日 —— 恢復/轉出後回來續用未完成次數時，
    // 已存格保留舊日期，空格自然接續回歸後的新透析日（勿改回以格序=日序的對位法，會跳日）。
    const sessions = normalizeEducationSessions(JSON.parse(row.sessions || '[]'))
    const usedDates = new Set(sessions.map((s) => s.dialysisDate).filter(Boolean))
    const availableDates = getEducationDialysisDates(db, id, firstDialysisDate, getTaipeiTodayString())
      .map((d) => d.date)
      .filter((d) => !usedDates.has(d))
    let nextDateIdx = 0
    sessions.forEach((s) => {
      if (!s.dialysisDate && nextDateIdx < availableDates.length) {
        s.dialysisDate = availableDates[nextDateIdx++]
      }
    })

    // 入院日期：優先用衛教紀錄已儲存值；否則帶入預設 —
    // patient_status.admissionDate（轉住院 ipd 時寫入）→ 退而求其次用病人新增日期(created_at)。
    // 皆無則回空字串，前端顯示可手動選取的日期欄位。
    let admissionDate = row.admission_date || ''
    if (!admissionDate) {
      try {
        admissionDate = JSON.parse(patient.patient_status || '{}')?.admissionDate || ''
      } catch {
        admissionDate = ''
      }
      if (!admissionDate && patient.created_at) {
        admissionDate = String(patient.created_at).slice(0, 10)
      }
    }

    // 主題輪序佇列（跳過的主題排到最後）；尚未初始化時回 null，由前端以主題清單順序建立
    let topicQueue = null
    try {
      const q = JSON.parse(row.topic_queue || 'null')
      if (Array.isArray(q)) topicQueue = q
    } catch {
      /* 解析失敗視為未初始化 */
    }

    res.json({
      patientId: id,
      patientName: patient.name,
      medicalRecordNumber: patient.medical_record_number,
      admissionDate,
      firstDialysisDate,
      primaryNurse: getPrimaryNurseMap(db).get(id) || null,
      paperEducation: !!row.paper_education,
      paperCompleted: !!(row.paper_education && row.paper_completed),
      sessions,
      topicQueue,
      updatedAt: row.updated_at,
    })
  } catch (error) {
    console.error('取得衛教紀錄錯誤:', error)
    res.status(500).json({ error: true, message: '取得衛教紀錄失敗' })
  }
})

/**
 * PUT /api/patients/:id/education
 * 儲存病人衛教紀錄（一律正規化為 12 筆）
 */
router.put('/:id/education', ...isEditor, (req, res) => {
  try {
    const { id } = req.params
    const db = getDatabase()
    const patient = db.prepare('SELECT id FROM patients WHERE id = ?').get(id)
    if (!patient) return res.status(404).json({ error: true, message: '病人不存在' })

    const sessions = normalizeEducationSessions(req.body?.sessions)
    // 入院日期：可編輯，空字串視為清空（存 null）
    const admissionDate = req.body?.admissionDate ? String(req.body.admissionDate).slice(0, 10) : null
    // 主題輪序佇列：只接受字串陣列；未帶（undefined）則不動既有值
    const topicQueue = Array.isArray(req.body?.topicQueue)
      ? JSON.stringify(req.body.topicQueue.map((t) => String(t)))
      : undefined
    // 紙本衛教旗標：兩欄各自「未帶則不動既有值」（COALESCE）
    let paperEducation
    let paperCompleted
    if (req.body?.paperEducation !== undefined) paperEducation = req.body.paperEducation ? 1 : 0
    if (req.body?.paperCompleted !== undefined) paperCompleted = req.body.paperCompleted ? 1 : 0
    if (paperEducation === 0) paperCompleted = 0 // 取消「已紙本衛教」連動清除「已完成」
    const modifiedBy = JSON.stringify({ uid: req.user.id, name: req.user.name })
    const existing = db.prepare('SELECT id, paper_education FROM education_records WHERE patient_id = ?').get(id)
    // 「紙本已完成」必須「已紙本衛教」：只送 completed 時以既有 paper_education 判斷
    if (paperCompleted === 1) {
      const effectivePaper = paperEducation ?? (existing?.paper_education ? 1 : 0)
      if (!effectivePaper) paperCompleted = 0
    }
    if (existing) {
      db.prepare(`
        UPDATE education_records
        SET sessions = ?, admission_date = ?, created_by = ?,
            topic_queue = COALESCE(?, topic_queue),
            paper_education = COALESCE(?, paper_education),
            paper_completed = COALESCE(?, paper_completed),
            updated_at = datetime('now', 'localtime')
        WHERE patient_id = ?
      `).run(
        JSON.stringify(sessions), admissionDate, modifiedBy,
        topicQueue ?? null, paperEducation ?? null, paperCompleted ?? null, id,
      )
    } else {
      db.prepare(`
        INSERT INTO education_records (id, patient_id, sessions, admission_date, topic_queue, paper_education, paper_completed, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, id, JSON.stringify(sessions), admissionDate, topicQueue ?? null, paperEducation ?? 0, paperCompleted ?? 0, modifiedBy)
    }

    res.json({ success: true, sessions, admissionDate })
  } catch (error) {
    console.error('儲存衛教紀錄錯誤:', error)
    res.status(500).json({ error: true, message: '儲存衛教紀錄失敗' })
  }
})

router.get('/:id', authenticate, (req, res) => {
  try {
    const { id } = req.params
    const db = getDatabase()

    const patient = db.prepare(`SELECT ${PATIENT_SELECT_COLUMNS} FROM patients p WHERE p.id = ?`).get(id)


    if (!patient) {
      return res.status(404).json({
        error: true,
        message: '病人不存在'
      })
    }

    res.json(formatPatient(patient))

  } catch (error) {
    console.error('取得病人錯誤:', error)
    res.status(500).json({
      error: true,
      message: '取得病人資料失敗'
    })
  }
})

/**
 * POST /api/patients
 * 新增病人
 */
router.post('/', ...isContributor, validate({
  medicalRecordNumber: { required: true, type: 'string' },
  name: { required: true, type: 'string', maxLength: 50 },
  status: { enum: ['opd', 'ipd', 'er'] },
}), async (req, res) => {
  try {
    const data = req.body

    const db = getDatabase()

    // 檢查病歷號是否已存在
    const existing = db.prepare(`
      SELECT id FROM patients WHERE medical_record_number = ? AND is_deleted = 0
    `).get(data.medicalRecordNumber)

    if (existing) {
  
      return res.status(409).json({
        error: true,
        message: '此病歷號已存在'
      })
    }

    const id = data.id || uuidv4()
    const dbData = toDbFormat(data)
    dbData.last_modified_by = JSON.stringify({ uid: req.user.id, name: req.user.name })

    const columns = ['id', ...Object.keys(dbData)]
    const placeholders = columns.map(() => '?').join(', ')
    const values = [id, ...Object.values(dbData)]

    db.prepare(`
      INSERT INTO patients (${columns.join(', ')})
      VALUES (${placeholders})
    `).run(...values)

    const newPatient = db.prepare(`SELECT ${PATIENT_SELECT_COLUMNS} FROM patients p WHERE p.id = ?`).get(id)

    // 🔥 自動記錄病人歷史
    recordPatientHistory(db, id, data.name, 'CREATE', {
      status: data.status || 'opd'
    }, createPatientSnapshot(newPatient))

    // 🔥 自動加入當日動態
    addMovementToDailyLog(db, {
      id: `auto_create_${id}`,
      type: '新增',
      name: data.name,
      patientId: id,
      medicalRecordNumber: data.medicalRecordNumber,
      ...(data.status === 'ipd' ? { admissionDate: getTaipeiTodayString() } : {}),
      physician: data.physician || '',
      reason: data.inpatientReason || data.dialysisReason || '',
      remarks: `新增至「${STATUS_MAP[data.status] || STATUS_MAP.opd}」`,
    })



    await logAudit('PATIENT_CREATE', req.user.id, req.user.name, 'patients', id, {
      medicalRecordNumber: data.medicalRecordNumber,
      name: data.name
    })

    res.status(201).json(formatPatient(newPatient))

  } catch (error) {
    console.error('新增病人錯誤:', error)
    res.status(500).json({
      error: true,
      message: '新增病人失敗'
    })
  }
})

/**
 * PUT /api/patients/:id
 * 更新病人
 */
async function updatePatientHandler(req, res) {
  try {
    const { id } = req.params
    const data = req.body

    const db = getDatabase()

    // 檢查病人是否存在
    const existing = db.prepare(`SELECT * FROM patients WHERE id = ?`).get(id)

    if (!existing) {
  
      return res.status(404).json({
        error: true,
        message: '病人不存在'
      })
    }

    // ✨ 傳入 existing 以便 toDbFormat 可以合併現有的 dialysis_orders
    const dbData = toDbFormat(data, existing)
    dbData.last_modified_by = JSON.stringify({ uid: req.user.id, name: req.user.name })
    dbData.updated_at = "datetime('now', 'localtime')"

    // 病房號只對住院/急診有意義：生效後身分是門診、或本次轉為刪除，一律清除。
    // 用「生效後」狀態判斷（payload 可能只帶 status 或只帶 isDeleted），
    // 表單整包回送舊 wardNumber 的情況也在此攔下。
    const effectiveStatus = dbData.status !== undefined ? dbData.status : existing.status
    const effectiveDeleted = dbData.is_deleted !== undefined ? dbData.is_deleted : existing.is_deleted
    if (effectiveStatus === 'opd' || effectiveDeleted === 1) {
      dbData.ward_number = null
    }

    // 從急診/住院刪除時一併清勿動紀錄（勿動是排程床位鎖，刪除後即失義；
    // 歷史快照保留原貌、復原不自動恢復。DELETE /:id 路徑亦有同步邏輯，2026-08-19）
    if (effectiveDeleted === 1 && existing.is_deleted !== 1 && ['ipd', 'er'].includes(existing.status)) {
      try {
        const ps = dbData.patient_status !== undefined
          ? JSON.parse(dbData.patient_status || '{}')
          : JSON.parse(existing.patient_status || '{}')
        if (ps && ps.doNotMove) {
          delete ps.doNotMove
          dbData.patient_status = JSON.stringify(ps)
        }
      } catch { /* patient_status 解析失敗就不動 */ }
    }

    const updates = Object.keys(dbData).map(k => {
      if (k === 'updated_at') return `${k} = datetime('now', 'localtime')`
      return `${k} = ?`
    }).join(', ')

    const values = Object.entries(dbData)
      .filter(([k]) => k !== 'updated_at')
      .map(([, v]) => v)

    db.prepare(`UPDATE patients SET ${updates} WHERE id = ?`).run(...values, id)

    const updated = db.prepare(`SELECT ${PATIENT_SELECT_COLUMNS} FROM patients p WHERE p.id = ?`).get(id)

    // 🔥 檢查刪除/復原狀態變更
    const wasDeleted = existing.is_deleted === 1
    const isNowDeleted = data.isDeleted === true || updated.is_deleted === 1
    const modifiedBy = { uid: req.user.id, name: req.user.name }
    let deletedFutureExceptions = []
    let deletedFutureMessages = []

    // 當日異動保護：身分/模式變更或刪除時，把「變更前」的快照寫進今天排程格的
    // archivedPatientInfo，今日的統計/身分底色/模式顯示維持變更前狀態。
    // 已有快照的格子不覆蓋（保留當天最早的狀態，多次變更以第一次為準）。
    // 「下一班起生效」（effectiveFromNextShift=true）：只快照「已開始的班別」格，
    // 未開始的班別無快照 → 即時渲染新身分（2026-08-04，班別開始時間為使用者定義）。
    try {
      const oldOrders = JSON.parse(existing.dialysis_orders || '{}')
      const newOrders = JSON.parse(updated.dialysis_orders || '{}')
      const statusChanged = updated.status !== existing.status
      const modeChanged = (newOrders.mode || null) !== (oldOrders.mode || null)
      const freqChanged = (newOrders.freq || null) !== (oldOrders.freq || null)
      const todayStr = getTaipeiTodayString()
      const effectiveFromNextShift = data.effectiveFromNextShift === true
      const SHIFT_START_TIMES = { early: '07:30', noon: '12:30', late: '17:30' }
      const nowTaipeiHM = new Date()
        .toLocaleTimeString('en-GB', { timeZone: 'Asia/Taipei', hour12: false })
        .slice(0, 5)
      // 未知班別（外圍等非標準 key 已涵蓋於 early/noon/late 尾碼；防呆保守視為已開始 → 照舊快照）
      const isShiftStarted = (shift) => {
        const start = SHIFT_START_TIMES[shift]
        return start ? nowTaipeiHM >= start : true
      }
      // 僅在今日凍結窗（06:00 起）內寫快照：凌晨的變更依既有設計本來就算今天的，
      // 不該把變更前狀態凍進今天（與 isTodayScheduleFrozen 的重建放行邊界一致）
      if (
        (statusChanged || modeChanged || freqChanged || (!wasDeleted && isNowDeleted)) &&
        isTodayScheduleFrozen(todayStr)
      ) {
        const todayRow = db.prepare(`SELECT schedule FROM schedules WHERE date = ?`).get(todayStr)
        if (todayRow) {
          const todaySchedule = JSON.parse(todayRow.schedule || '{}')
          let snapshotWritten = false
          for (const [slotKey, slot] of Object.entries(todaySchedule)) {
            if (slot?.patientId === id && !slot.archivedPatientInfo) {
              const slotShift = slot.shiftId || String(slotKey).split('-').pop()
              if (effectiveFromNextShift && !isShiftStarted(slotShift)) continue
              slot.archivedPatientInfo = {
                status: existing.status || 'unknown',
                mode: oldOrders.mode || null,
                wardNumber: existing.ward_number || null,
                medicalRecordNumber: existing.medical_record_number || null,
                freq: oldOrders.freq || null,
              }
              snapshotWritten = true
            }
          }
          if (snapshotWritten) {
            db.prepare(
              `UPDATE schedules SET schedule = ?, updated_at = datetime('now', 'localtime') WHERE date = ?`,
            ).run(JSON.stringify(todaySchedule), todayStr)
            const bumped = db.prepare(`SELECT version FROM schedules WHERE date = ?`).get(todayStr)
            try {
              emitScheduleSaved({
                kind: 'schedule',
                date: todayStr,
                savedBy: req.user ? { uid: req.user.id, name: req.user.name } : null,
                scheduleVersion: bumped?.version ?? null,
                teamsVersion: null,
                ts: Date.now(),
              })
            } catch (emitErr) {
              console.warn('[eventBus] emitScheduleSaved failed:', emitErr.message)
            }
          }
        }
      }
    } catch (snapErr) {
      console.warn('[patients] 當日排程快照寫入失敗（非致命）:', snapErr.message)
    }

    if (!wasDeleted && isNowDeleted) {
      // 刪除操作：從正常狀態 → 已刪除
      deletedFutureExceptions = deleteFutureScheduleExceptionsForPatient(
        db,
        id,
        'patient_deleted',
        modifiedBy,
      )
      deletedFutureMessages = deleteFutureMessagesForPatient(db, id)

      // 出院/事件日期：前端可帶 deleteEventDate（YYYY-MM-DD），未帶或格式不符則以今天計
      const deleteEventDate =
        typeof data.deleteEventDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.deleteEventDate)
          ? data.deleteEventDate
          : getTaipeiTodayString()

      recordPatientHistory(db, id, existing.name, 'DELETE', {
        reason: data.deleteReason || '未提供原因',
        eventDate: deleteEventDate,
        fromStatus: existing.status
      }, createPatientSnapshot(existing))

      addMovementToDailyLog(db, {
        id: `auto_delete_${id}_${Date.now()}`,
        type: '刪除',
        name: existing.name,
        patientId: id,
        medicalRecordNumber: existing.medical_record_number,
        dischargeDate: deleteEventDate,
        physician: existing.physician || '',
        reason: data.deleteReason || '',
        remarks: data.deleteReason
          ? `從「${STATUS_MAP[existing.status] || existing.status}」刪除；原因：${data.deleteReason}`
          : `從「${STATUS_MAP[existing.status] || existing.status}」刪除`,
      })
    } else if (wasDeleted && !isNowDeleted) {
      // 復原操作：從已刪除 → 正常狀態
      const restoreStatus = data.status || updated.status || 'opd'

      recordPatientHistory(db, id, existing.name, 'RESTORE_AND_TRANSFER', {
        restoredTo: restoreStatus
      }, createPatientSnapshot(updated))

      addMovementToDailyLog(db, {
        id: `auto_restore_${id}_${Date.now()}`,
        type: '復原',
        name: existing.name,
        patientId: id,
        medicalRecordNumber: existing.medical_record_number,
        ...(restoreStatus === 'ipd' ? { admissionDate: getTaipeiTodayString() } : {}),
        physician: updated.physician || '',
        reason: '',
        remarks: `復原至「${STATUS_MAP[restoreStatus] || restoreStatus}」`,
      })
    } else if (!wasDeleted && !isNowDeleted && data.status && existing.status !== data.status) {
      // 🔥 檢查狀態變更，自動記錄歷史和動態（只在非刪除/復原情況下）
      const fromStatus = existing.status
      const toStatus = data.status

      // 記錄歷史
      if (fromStatus === 'opd' && (toStatus === 'ipd' || toStatus === 'er')) {
        // 門診 → 住院/急診 (轉入)
        recordPatientHistory(db, id, existing.name, 'TRANSFER', {
          fromStatus,
          toStatus,
          reason: data.inpatientReason || ''
        }, createPatientSnapshot(updated))

        addMovementToDailyLog(db, {
          id: `auto_transfer_in_${id}_${Date.now()}`,
          type: '轉移',
          name: existing.name,
          patientId: id,
          medicalRecordNumber: existing.medical_record_number,
          ...(toStatus === 'ipd' ? { admissionDate: getTaipeiTodayString() } : {}),
          physician: updated.physician || '',
          reason: data.inpatientReason || '',
          remarks: `從「${STATUS_MAP[fromStatus]}」轉入「${STATUS_MAP[toStatus]}」`,
        })
      } else if ((fromStatus === 'ipd' || fromStatus === 'er') && toStatus === 'opd') {
        // 住院/急診 → 門診 (轉出)
        deletedFutureExceptions = deleteFutureScheduleExceptionsForPatient(
          db,
          id,
          'patient_transferred_to_opd',
          modifiedBy,
        )

        recordPatientHistory(db, id, existing.name, 'TRANSFER', {
          fromStatus,
          toStatus,
        }, createPatientSnapshot(updated))

        addMovementToDailyLog(db, {
          id: `auto_transfer_out_${id}_${Date.now()}`,
          type: '轉移',
          name: existing.name,
          patientId: id,
          medicalRecordNumber: existing.medical_record_number,
          dischargeDate: getTaipeiTodayString(),
          physician: updated.physician || '',
          reason: '',
          remarks: `從「${STATUS_MAP[fromStatus]}」轉回「${STATUS_MAP[toStatus]}」`,
        })
      } else {
        // 其他狀態變更
        recordPatientHistory(db, id, existing.name, 'STATUS_CHANGE', {
          fromStatus,
          toStatus,
        }, createPatientSnapshot(updated))

        if (toStatus === 'ipd' || toStatus === 'opd') {
          addMovementToDailyLog(db, {
            id: `auto_transfer_${id}_${Date.now()}`,
            type: '轉移',
            name: existing.name,
            patientId: id,
            medicalRecordNumber: existing.medical_record_number,
            ...(toStatus === 'ipd' ? { admissionDate: getTaipeiTodayString() } : {}),
            ...(toStatus === 'opd' ? { dischargeDate: getTaipeiTodayString() } : {}),
            physician: updated.physician || '',
            reason: data.inpatientReason || '',
            remarks:
              toStatus === 'ipd'
                ? `從「${STATUS_MAP[fromStatus] || fromStatus}」轉入「${STATUS_MAP[toStatus] || toStatus}」`
                : `從「${STATUS_MAP[fromStatus] || fromStatus}」轉回「${STATUS_MAP[toStatus] || toStatus}」`,
          })
        }
      }
    }

    const previousMode = getDialysisMode(existing)
    const currentMode = getDialysisMode(updated)
    if (!wasDeleted && !isNowDeleted && previousMode !== currentMode) {
      recordPatientHistory(db, id, existing.name, 'MODE_CHANGE', {
        fromMode: previousMode,
        toMode: currentMode,
      }, createPatientSnapshot(updated))

      addMovementToDailyLog(db, {
        id: `auto_mode_${id}_${Date.now()}`,
        type: '更改模式',
        name: updated.name,
        patientId: id,
        medicalRecordNumber: updated.medical_record_number,
        wardNumber: updated.ward_number || '',
        physician: updated.physician || '',
        reason: '',
        remarks: `透析模式由「${previousMode || '未設定'}」改為「${currentMode || '未設定'}」`,
      })
    }

    // 「勿動」標記不寫工作日誌（2026-08-06 使用者裁定移除同步）；
    // kiditSync 的 KIDIT_EXCLUDED_MOVEMENT_TYPES 仍保留「勿動」，保護歷史動態不被 resync 進 KiDit

    await logAudit('PATIENT_UPDATE', req.user.id, req.user.name, 'patients', id, {
      updatedFields: Object.keys(data),
      deletedFutureExceptions,
      deletedFutureMessages,
    })

    res.json(formatPatient(updated))

  } catch (error) {
    console.error('更新病人錯誤:', error)
    res.status(500).json({
      error: true,
      message: '更新病人失敗'
    })
  }
}

router.put('/:id', ...isContributor, updatePatientHandler)

/**
 * DELETE /api/patients/:id
 * 軟刪除病人
 */
router.delete('/:id', ...isEditor, async (req, res) => {
  try {
    const { id } = req.params
    const { reason } = req.body

    const db = getDatabase()

    const existing = db.prepare(`SELECT * FROM patients WHERE id = ? AND is_deleted = 0`).get(id)

    if (!existing) {
  
      return res.status(404).json({
        error: true,
        message: '病人不存在'
      })
    }

    // 從急診/住院刪除時一併清勿動紀錄（同 PUT 軟刪路徑的邏輯，2026-08-19）
    let patientStatusJson = existing.patient_status
    if (['ipd', 'er'].includes(existing.status)) {
      try {
        const ps = JSON.parse(existing.patient_status || '{}')
        if (ps && ps.doNotMove) {
          delete ps.doNotMove
          patientStatusJson = JSON.stringify(ps)
        }
      } catch { /* patient_status 解析失敗就不動 */ }
    }

    db.prepare(`
      UPDATE patients
      SET is_deleted = 1,
          original_status = ?,
          delete_reason = ?,
          ward_number = NULL,
          patient_status = ?,
          deleted_at = datetime('now', 'localtime'),
          last_modified_by = ?,
          updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(
      existing.status,
      reason || '未提供原因',
      patientStatusJson,
      JSON.stringify({ uid: req.user.id, name: req.user.name }),
      id
    )
    const deletedFutureExceptions = deleteFutureScheduleExceptionsForPatient(
      db,
      id,
      'patient_deleted',
      { uid: req.user.id, name: req.user.name },
    )
    const deletedFutureMessages = deleteFutureMessagesForPatient(db, id)

    // 🔥 自動記錄病人歷史
    recordPatientHistory(db, id, existing.name, 'DELETE', {
      reason: reason || '未提供原因',
      fromStatus: existing.status
    }, createPatientSnapshot(existing))

    // 🔥 自動加入當日動態
    addMovementToDailyLog(db, {
      id: `auto_delete_${id}_${Date.now()}`,
      type: '刪除',
      name: existing.name,
      patientId: id,
      medicalRecordNumber: existing.medical_record_number,
      dischargeDate: getTaipeiTodayString(),
      physician: existing.physician || '',
      reason: reason || '',
      remarks: reason
        ? `從「${STATUS_MAP[existing.status] || existing.status}」刪除；原因：${reason}`
        : `從「${STATUS_MAP[existing.status] || existing.status}」刪除`,
    })



    await logAudit('PATIENT_DELETE', req.user.id, req.user.name, 'patients', id, {
      name: existing.name,
      reason,
      deletedFutureExceptions,
      deletedFutureMessages,
    })

    res.json({
      success: true,
      message: '病人已刪除'
    })

  } catch (error) {
    console.error('刪除病人錯誤:', error)
    res.status(500).json({
      error: true,
      message: '刪除病人失敗'
    })
  }
})

/**
 * POST /api/patients/:id/restore
 * 復原已刪除的病人
 */
router.post('/:id/restore', ...isEditor, async (req, res) => {
  try {
    const { id } = req.params
    const { status } = req.body

    const db = getDatabase()

    const existing = db.prepare(`SELECT * FROM patients WHERE id = ? AND is_deleted = 1`).get(id)

    if (!existing) {
  
      return res.status(404).json({
        error: true,
        message: '找不到已刪除的病人'
      })
    }

    db.prepare(`
      UPDATE patients
      SET is_deleted = 0,
          delete_reason = NULL,
          deleted_at = NULL,
          original_status = NULL,
          status = ?,
          ward_number = ?,
          last_modified_by = ?,
          updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(
      status || 'opd',
      (status || 'opd') === 'opd' ? null : existing.ward_number,
      JSON.stringify({ uid: req.user.id, name: req.user.name }),
      id
    )

    const restored = db.prepare(`SELECT ${PATIENT_SELECT_COLUMNS} FROM patients p WHERE p.id = ?`).get(id)
    const restoreStatus = status || 'opd'

    // 🔥 自動記錄病人歷史
    recordPatientHistory(db, id, existing.name, 'RESTORE_AND_TRANSFER', {
      restoredTo: restoreStatus
    }, createPatientSnapshot(restored))

    // 🔥 自動加入當日動態
    addMovementToDailyLog(db, {
      id: `auto_restore_${id}_${Date.now()}`,
      type: '復原',
      name: existing.name,
      patientId: id,
      medicalRecordNumber: existing.medical_record_number,
      ...(restoreStatus === 'ipd' ? { admissionDate: getTaipeiTodayString() } : {}),
      physician: restored.physician || '',
      reason: '',
      remarks: `復原至「${STATUS_MAP[restoreStatus]}」`,
    })



    await logAudit('PATIENT_RESTORE', req.user.id, req.user.name, 'patients', id, {
      name: existing.name,
      restoredTo: restoreStatus
    })

    res.json(formatPatient(restored))

  } catch (error) {
    console.error('復原病人錯誤:', error)
    res.status(500).json({
      error: true,
      message: '復原病人失敗'
    })
  }
})

// ========================================
// 病史與問題列表（2026-08-19，病人清單操作欄彈窗）
// 區塊一：相關性系統疾病——優先帶 KiDit 病史（唯讀），無資料時前端可手動勾選存 patient_problem_profiles（不回寫 KiDit）
// 區塊二：問題列表 patient_problems（問題/起始/治療處置/解決時間）
// ========================================

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const isValidDateOrEmpty = (v) => v === null || v === undefined || v === '' || (typeof v === 'string' && DATE_RE.test(v))

function formatProblemRow(row) {
  return {
    id: row.id,
    patientId: row.patient_id,
    problem: row.problem,
    startDate: row.start_date || '',
    treatment: row.treatment || '',
    resolvedDate: row.resolved_date || '',
    createdBy: (() => { try { return JSON.parse(row.created_by || '{}') } catch { return {} } })(),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/**
 * GET /api/patients/:id/problem-list
 * 回傳 KiDit 病史相關性系統疾病（掃 kidit_logbook 取最新一筆）+ 手動勾選備援 + 問題列表
 */
router.get('/:id/problem-list', authenticate, (req, res) => {
  try {
    const { id } = req.params
    const db = getDatabase()

    // KiDit 病史：profile 與 history 可能建在不同日期，取最新含 selectedSystemicDiseases 的事件
    let kidit = null
    const rows = db.prepare('SELECT date, events FROM kidit_logbook ORDER BY date DESC').all()
    for (const row of rows) {
      let events = []
      try { events = JSON.parse(row.events || '[]') } catch { continue }
      for (const e of events) {
        if (!e || e.patientId !== id) continue
        const h = e.kidit_history
        if (h && Array.isArray(h.selectedSystemicDiseases) && h.selectedSystemicDiseases.length > 0) {
          kidit = {
            date: row.date,
            selectedSystemicDiseases: h.selectedSystemicDiseases,
            otherSystemicDescription: h.otherSystemicDescription || '',
            dmType: h.dmType || ''
          }
          break
        }
      }
      if (kidit) break
    }

    const profileRow = db.prepare('SELECT * FROM patient_problem_profiles WHERE patient_id = ?').get(id)
    const manual = profileRow
      ? {
          systemicDiseases: (() => { try { return JSON.parse(profileRow.systemic_diseases || '[]') } catch { return [] } })(),
          otherDescription: profileRow.other_description || '',
          updatedAt: profileRow.updated_at
        }
      : null

    const problems = db
      .prepare('SELECT * FROM patient_problems WHERE patient_id = ? ORDER BY CASE WHEN resolved_date IS NULL OR resolved_date = \'\' THEN 0 ELSE 1 END, start_date DESC, created_at DESC')
      .all(id)
      .map(formatProblemRow)

    res.json({ kidit, manual, problems })
  } catch (error) {
    console.error('讀取病史與問題列表錯誤:', error)
    res.status(500).json({ error: true, message: '讀取失敗' })
  }
})

/**
 * PUT /api/patients/:id/problem-profile
 * 儲存相關性系統疾病手動勾選（KiDit 無資料時的備援）
 */
router.put('/:id/problem-profile', ...isContributor, (req, res) => {
  try {
    const { id } = req.params
    const { systemicDiseases, otherDescription } = req.body || {}
    if (!Array.isArray(systemicDiseases) || systemicDiseases.some((x) => !Number.isInteger(x) || x < 0 || x > 11)) {
      return res.status(400).json({ error: true, message: 'systemicDiseases 需為 0-11 整數陣列' })
    }
    if (otherDescription !== undefined && (typeof otherDescription !== 'string' || otherDescription.length > 500)) {
      return res.status(400).json({ error: true, message: 'otherDescription 需為 ≤500 字的字串' })
    }
    const db = getDatabase()
    const updatedBy = JSON.stringify({ uid: req.user?.uid || '', name: req.user?.name || '' })
    db.prepare(`
      INSERT INTO patient_problem_profiles (patient_id, systemic_diseases, other_description, updated_by, updated_at)
      VALUES (?, ?, ?, ?, datetime('now','localtime'))
      ON CONFLICT(patient_id) DO UPDATE SET
        systemic_diseases = excluded.systemic_diseases,
        other_description = excluded.other_description,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
    `).run(id, JSON.stringify([...new Set(systemicDiseases)].sort((a, b) => a - b)), otherDescription || '', updatedBy)
    res.json({ success: true })
  } catch (error) {
    console.error('儲存系統疾病勾選錯誤:', error)
    res.status(500).json({ error: true, message: '儲存失敗' })
  }
})

/**
 * POST /api/patients/:id/problems
 * 新增問題（問題必填；起始/治療處置選填）
 */
router.post('/:id/problems', ...isContributor, (req, res) => {
  try {
    const { id } = req.params
    const { problem, startDate, treatment } = req.body || {}
    if (typeof problem !== 'string' || !problem.trim() || problem.length > 500) {
      return res.status(400).json({ error: true, message: '問題為必填（≤500 字）' })
    }
    if (!isValidDateOrEmpty(startDate)) {
      return res.status(400).json({ error: true, message: '起始時間格式需為 YYYY-MM-DD' })
    }
    if (treatment !== undefined && (typeof treatment !== 'string' || treatment.length > 2000)) {
      return res.status(400).json({ error: true, message: '治療處置需為 ≤2000 字的字串' })
    }
    const db = getDatabase()
    const newId = uuidv4()
    db.prepare(`
      INSERT INTO patient_problems (id, patient_id, problem, start_date, treatment, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      newId, id, problem.trim(), startDate || getTaipeiTodayString(), treatment || '',
      JSON.stringify({ uid: req.user?.uid || '', name: req.user?.name || '' })
    )
    const row = db.prepare('SELECT * FROM patient_problems WHERE id = ?').get(newId)
    res.status(201).json(formatProblemRow(row))
  } catch (error) {
    console.error('新增問題錯誤:', error)
    res.status(500).json({ error: true, message: '新增失敗' })
  }
})

/**
 * PUT /api/patients/:id/problems/:problemId
 * 更新問題（含標記已解決 resolvedDate、清空 = 恢復進行中）
 */
router.put('/:id/problems/:problemId', ...isContributor, (req, res) => {
  try {
    const { id, problemId } = req.params
    const { problem, startDate, treatment, resolvedDate } = req.body || {}
    const db = getDatabase()
    const existing = db.prepare('SELECT * FROM patient_problems WHERE id = ? AND patient_id = ?').get(problemId, id)
    if (!existing) {
      return res.status(404).json({ error: true, message: '找不到此問題' })
    }
    if (problem !== undefined && (typeof problem !== 'string' || !problem.trim() || problem.length > 500)) {
      return res.status(400).json({ error: true, message: '問題不可為空（≤500 字）' })
    }
    if (!isValidDateOrEmpty(startDate) || !isValidDateOrEmpty(resolvedDate)) {
      return res.status(400).json({ error: true, message: '日期格式需為 YYYY-MM-DD' })
    }
    if (treatment !== undefined && (typeof treatment !== 'string' || treatment.length > 2000)) {
      return res.status(400).json({ error: true, message: '治療處置需為 ≤2000 字的字串' })
    }
    db.prepare(`
      UPDATE patient_problems SET
        problem = ?,
        start_date = ?,
        treatment = ?,
        resolved_date = ?,
        updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(
      problem !== undefined ? problem.trim() : existing.problem,
      startDate !== undefined ? (startDate || null) : existing.start_date,
      treatment !== undefined ? treatment : existing.treatment,
      resolvedDate !== undefined ? (resolvedDate || null) : existing.resolved_date,
      problemId
    )
    const row = db.prepare('SELECT * FROM patient_problems WHERE id = ?').get(problemId)
    res.json(formatProblemRow(row))
  } catch (error) {
    console.error('更新問題錯誤:', error)
    res.status(500).json({ error: true, message: '更新失敗' })
  }
})

/**
 * DELETE /api/patients/:id/problems/:problemId
 */
router.delete('/:id/problems/:problemId', ...isEditor, (req, res) => {
  try {
    const { id, problemId } = req.params
    const db = getDatabase()
    const result = db.prepare('DELETE FROM patient_problems WHERE id = ? AND patient_id = ?').run(problemId, id)
    if (result.changes === 0) {
      return res.status(404).json({ error: true, message: '找不到此問題' })
    }
    res.json({ success: true })
  } catch (error) {
    console.error('刪除問題錯誤:', error)
    res.status(500).json({ error: true, message: '刪除失敗' })
  }
})

export default router
