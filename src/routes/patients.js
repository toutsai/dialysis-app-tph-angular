// 病人管理路由
import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { getDatabase } from '../db/init.js'
import { authenticate, isContributor, isEditor, logAudit } from '../middleware/auth.js'
import { getTaipeiTodayString } from '../utils/dateUtils.js'
import { validate } from '../middleware/validate.js'
import { syncEventsToKiditLogbook } from '../services/kiditSync.js'

const router = Router()

// 狀態碼的中文對照表
const STATUS_MAP = {
  opd: '門診',
  ipd: '住院',
  er: '急診',
}

/**
 * 自動記錄病人歷史
 */
function recordPatientHistory(db, patientId, patientName, eventType, eventDetails, snapshot = {}) {
  const id = `ph_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  const now = new Date().toISOString()

  try {
    db.prepare(`
      INSERT INTO patient_history (id, patient_id, patient_name, event_type, event_details, snapshot, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      patientId,
      patientName,
      eventType,
      JSON.stringify(eventDetails),
      JSON.stringify(snapshot),
      now
    )
    console.log(`[PatientHistory] 記錄 ${eventType} 事件: ${patientName}`)
  } catch (error) {
    console.error('[PatientHistory] 記錄失敗:', error)
  }
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

/**
 * 建立病人快照（用於歷史記錄）
 */
function createPatientSnapshot(patient) {
  return {
    medicalRecordNumber: patient.medical_record_number || null,
    status: patient.status || null,
    firstDialysisDate: patient.first_dialysis_date || null,
    vascAccess: patient.vasc_access || null,
    accessCreationDate: patient.access_creation_date || null,
    hospitalInfo: JSON.parse(patient.hospital_info || '{}'),
    inpatientReason: patient.inpatient_reason || null,
    dialysisReason: patient.dialysis_reason || null,
  }
}

/**
 * 將資料庫記錄轉換為 API 回應格式
 */
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
    deleteReason: row.delete_reason,
    dialysisOrders: dialysisOrders,
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
  if (data.deleteReason !== undefined) result.delete_reason = data.deleteReason

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

    let query = 'SELECT * FROM patients'
    if (includeDeleted !== 'true') {
      query += ' WHERE is_deleted = 0'
    }
    query += ' ORDER BY name'

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
      SELECT * FROM patients WHERE is_deleted = 0 ORDER BY name
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

/**
 * GET /api/patients/:id
 * 取得單一病人
 */
router.get('/:id', authenticate, (req, res) => {
  try {
    const { id } = req.params
    const db = getDatabase()

    const patient = db.prepare(`SELECT * FROM patients WHERE id = ?`).get(id)


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

    const newPatient = db.prepare(`SELECT * FROM patients WHERE id = ?`).get(id)

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
router.put('/:id', ...isContributor, async (req, res) => {
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

    const updated = db.prepare(`SELECT * FROM patients WHERE id = ?`).get(id)

    // 🔥 檢查刪除/復原狀態變更
    const wasDeleted = existing.is_deleted === 1
    const isNowDeleted = data.isDeleted === true || updated.is_deleted === 1

    if (!wasDeleted && isNowDeleted) {
      // 刪除操作：從正常狀態 → 已刪除
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
        physician: existing.physician || '',
        reason: data.deleteReason || '',
        remarks: `從「${STATUS_MAP[existing.status] || existing.status}」刪除`,
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
          physician: updated.physician || '',
          reason: data.inpatientReason || '',
          remarks: `從「${STATUS_MAP[fromStatus]}」轉入「${STATUS_MAP[toStatus]}」`,
        })
      } else if ((fromStatus === 'ipd' || fromStatus === 'er') && toStatus === 'opd') {
        // 住院/急診 → 門診 (轉出)
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
      }
    }



    await logAudit('PATIENT_UPDATE', req.user.id, req.user.name, 'patients', id, {
      updatedFields: Object.keys(data)
    })

    res.json(formatPatient(updated))

  } catch (error) {
    console.error('更新病人錯誤:', error)
    res.status(500).json({
      error: true,
      message: '更新病人失敗'
    })
  }
})

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
          delete_reason = ?,
          last_modified_by = ?,
          updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(
      reason || '未提供原因',
      JSON.stringify({ uid: req.user.id, name: req.user.name }),
      id
    )

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
      physician: existing.physician || '',
      reason: reason || '',
      remarks: `從「${STATUS_MAP[existing.status] || existing.status}」刪除`,
    })



    await logAudit('PATIENT_DELETE', req.user.id, req.user.name, 'patients', id, {
      name: existing.name,
      reason
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
          status = ?,
          last_modified_by = ?,
          updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(
      status || 'opd',
      JSON.stringify({ uid: req.user.id, name: req.user.name }),
      id
    )

    const restored = db.prepare(`SELECT * FROM patients WHERE id = ?`).get(id)
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
