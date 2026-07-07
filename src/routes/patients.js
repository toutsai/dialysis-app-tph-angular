// 病人管理路由
import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { getDatabase } from '../db/init.js'
import { authenticate, isContributor, isEditor, logAudit } from '../middleware/auth.js'
import { formatDateToYYYYMMDD, getTaipeiTodayString } from '../utils/dateUtils.js'
import { validate } from '../middleware/validate.js'
import { syncEventsToKiditLogbook } from '../services/kiditSync.js'
import { emitExceptionChange } from '../services/eventBus.js'
import { rebuildSingleDaySchedule } from '../services/scheduleSync.js'
import { removeAutoMovementFromDailyLog } from '../services/dailyLogMovementSync.js'
import { normalizeDialysisOrdersMode } from '../utils/dialysisMode.js'
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
             p.first_dialysis_date, p.patient_status,
             e.sessions AS edu_sessions, e.admission_date AS edu_admission, e.updated_at AS edu_updated
      FROM patients p
      LEFT JOIN education_records e ON e.patient_id = p.id
      WHERE p.is_deleted = 0
    `).all()

    const total = EDUCATION_SESSION_COUNT
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

      // 納入條件：目前首透中，或已有衛教進度（避免自動建立的全空白紀錄混入）
      if (!firstActive && educatedCount === 0) continue

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

      // 未衛教日 = 應衛教日中沒有衛教者簽核的日期；12 次皆已衛教即視為完成、不再列
      const uneducatedDates = []
      if (educatedCount < total) {
        const educatedOn = new Set(
          sessions
            .filter((s) => s?.educatorSign && s?.dialysisDate)
            .map((s) => String(s.dialysisDate).slice(0, 10)),
        )
        // 有簽核但沒填透析日期的格數：視為涵蓋最早的未對上日期，避免誤報未衛教
        let unmatchedSigned = sessions.filter((s) => s?.educatorSign && !s?.dialysisDate).length
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
        firstDialysisActive: firstActive,
        firstDialysisDate: firstDate || '',
        admissionDate: r.edu_admission || '',
        hasRecord,
        educatedCount,
        returnDemoCount,
        passedCount,
        total,
        completed: passedCount >= total,
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
    const sessions = normalizeEducationSessions(JSON.parse(row.sessions || '[]'))
    const defaultDates = getEducationDialysisDates(db, id, firstDialysisDate, getTaipeiTodayString())
      .map((d) => d.date)
      .slice(0, EDUCATION_SESSION_COUNT)
    sessions.forEach((s, i) => {
      if (!s.dialysisDate && defaultDates[i]) s.dialysisDate = defaultDates[i]
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
    const modifiedBy = JSON.stringify({ uid: req.user.id, name: req.user.name })
    const existing = db.prepare('SELECT id FROM education_records WHERE patient_id = ?').get(id)
    if (existing) {
      db.prepare(`
        UPDATE education_records
        SET sessions = ?, admission_date = ?, created_by = ?,
            topic_queue = COALESCE(?, topic_queue),
            updated_at = datetime('now', 'localtime')
        WHERE patient_id = ?
      `).run(JSON.stringify(sessions), admissionDate, modifiedBy, topicQueue ?? null, id)
    } else {
      db.prepare(`
        INSERT INTO education_records (id, patient_id, sessions, admission_date, topic_queue, created_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, id, JSON.stringify(sessions), admissionDate, topicQueue ?? null, modifiedBy)
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

    if (!wasDeleted && isNowDeleted) {
      // 刪除操作：從正常狀態 → 已刪除
      deletedFutureExceptions = deleteFutureScheduleExceptionsForPatient(
        db,
        id,
        'patient_deleted',
        modifiedBy,
      )
      deletedFutureMessages = deleteFutureMessagesForPatient(db, id)

      recordPatientHistory(db, id, existing.name, 'DELETE', {
        reason: data.deleteReason || '未提供原因',
        fromStatus: existing.status
      }, createPatientSnapshot(existing))

      addMovementToDailyLog(db, {
        id: `auto_delete_${id}_${Date.now()}`,
        type: '刪除',
        name: existing.name,
        patientId: id,
        medicalRecordNumber: existing.medical_record_number,
        dischargeDate: getTaipeiTodayString(),
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

    // 🔥 檢查「勿動」新增（active: false → true）：寫工作日誌病人動態，勿動原因帶入備註
    // 僅在「首次標記勿動」時寫一筆；之後只改原因/區間不重複寫。刻意不進 KiDit（見 kiditSync）。
    const oldDoNotMove = safeJsonParse(existing.patient_status)?.doNotMove
    const newDoNotMove = data.patientStatus?.doNotMove
    if (!wasDeleted && !isNowDeleted && !oldDoNotMove?.active && newDoNotMove?.active) {
      addMovementToDailyLog(db, {
        id: `auto_do_not_move_${id}_${Date.now()}`,
        type: '勿動',
        name: updated.name,
        patientId: id,
        medicalRecordNumber: updated.medical_record_number,
        wardNumber: updated.ward_number || '',
        physician: updated.physician || '',
        reason: '',
        remarks: newDoNotMove.reason || '標記為勿動',
      })
    }

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
router.patch('/:id', ...isContributor, updatePatientHandler)

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

    db.prepare(`
      UPDATE patients
      SET is_deleted = 1,
          original_status = ?,
          delete_reason = ?,
          deleted_at = datetime('now', 'localtime'),
          last_modified_by = ?,
          updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(
      existing.status,
      reason || '未提供原因',
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
          last_modified_by = ?,
          updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(
      status || 'opd',
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

export default router
