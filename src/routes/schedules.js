// 排程管理路由
import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { getDatabase } from '../db/init.js'
import { authenticate, isEditor, logAudit } from '../middleware/auth.js'
import { syncMasterScheduleToFuture, initializeFutureSchedules, mergeExceptionsIntoSchedules, generateDailyScheduleFromRules, rebuildSingleDaySchedule } from '../services/scheduleSync.js'
import { processScheduleException } from '../services/exceptionHandler.js'
import { getTaipeiTodayString, formatDateToYYYYMMDD, getTaipeiDayIndex } from '../utils/dateUtils.js'
import { SHIFTS, FREQ_MAP_TO_DAY_INDEX, getScheduleKey } from '../utils/scheduleUtils.js'

const router = Router()

// Angular 前端使用 PATCH 做部分更新，TPH 後端使用 PUT
// 此 middleware 將 PATCH 請求轉為 PUT，讓既有的 PUT handler 處理
router.use((req, res, next) => {
  if (req.method === 'PATCH') {
    req.method = 'PUT'
  }
  next()
})

// ========================================
// 每日排程 API
// ========================================

/**
 * GET /api/schedules
 * 取得排程列表 (可選日期範圍)
 */
router.get('/', authenticate, (req, res) => {
  try {
    const { startDate, endDate, date } = req.query
    const db = getDatabase()

    let query = 'SELECT * FROM schedules'
    const params = []

    if (date) {
      query += ' WHERE date = ?'
      params.push(date)
    } else if (startDate && endDate) {
      query += ' WHERE date >= ? AND date <= ?'
      params.push(startDate, endDate)
    } else if (startDate) {
      query += ' WHERE date >= ?'
      params.push(startDate)
    }

    query += ' ORDER BY date'

    const schedules = db.prepare(query).all(...params)

    res.json(schedules.map(s => ({
      id: s.id,
      date: s.date,
      schedule: JSON.parse(s.schedule || '{}'),
      syncMethod: s.sync_method,
      lastModifiedBy: JSON.parse(s.last_modified_by || '{}'),
      createdAt: s.created_at,
      updatedAt: s.updated_at
    })))

  } catch (error) {
    console.error('取得排程錯誤:', error)
    res.status(500).json({
      error: true,
      message: '取得排程失敗'
    })
  }
})

/**
 * GET /api/schedules/expired/:date
 * 取得特定日期的歸檔排程（用於周排班檢視）
 * 注意：此路由必須放在 /:date 之前
 */
function getExpiredSchedule(req, res) {
  try {
    const { date } = req.params
    const db = getDatabase()

    // 嘗試從歸檔排程表取得資料
    const archived = db.prepare(`
      SELECT * FROM archived_schedules WHERE date = ?
    `).get(date)

    // 如果歸檔表沒有，嘗試從一般排程表取得
    if (!archived) {
      const schedule = db.prepare(`SELECT * FROM schedules WHERE date = ?`).get(date)

      // 不管有沒有資料都回傳成功，避免 404 錯誤
      if (!schedule) {
        return res.json({
          id: date,
          date,
          schedule: {},
          createdAt: null,
          updatedAt: null
        })
      }

      return res.json({
        id: schedule.id,
        date: schedule.date,
        schedule: JSON.parse(schedule.schedule || '{}'),
        syncMethod: schedule.sync_method,
        lastModifiedBy: JSON.parse(schedule.last_modified_by || '{}'),
        createdAt: schedule.created_at,
        updatedAt: schedule.updated_at
      })
    }

    res.json({
      id: archived.id,
      date: archived.date,
      schedule: JSON.parse(archived.schedule || '{}'),
      lastModifiedBy: JSON.parse(archived.last_modified_by || '{}'),
      createdAt: archived.created_at,
      updatedAt: archived.updated_at
    })

  } catch (error) {
    console.error('取得歸檔排程錯誤:', error)
    res.status(500).json({
      error: true,
      message: '取得歸檔排程失敗'
    })
  }
}
router.get('/expired/:date', authenticate, getExpiredSchedule)

/**
 * POST /api/schedules/archived/batch
 * 批次取得多個日期的歸檔排程（用於週排班檢視）
 */
router.post('/archived/batch', authenticate, (req, res) => {
  try {
    const { dates } = req.body
    if (!Array.isArray(dates) || dates.length === 0) {
      return res.json([])
    }

    const db = getDatabase()
    const results = []

    for (const date of dates) {
      // 先查歸檔表
      let record = db.prepare(`SELECT * FROM archived_schedules WHERE date = ?`).get(date)

      if (record) {
        results.push({
          id: record.id,
          date: record.date,
          schedule: JSON.parse(record.schedule || '{}'),
          lastModifiedBy: JSON.parse(record.last_modified_by || '{}'),
          createdAt: record.created_at,
          updatedAt: record.updated_at
        })
        continue
      }

      // 再查一般排程表
      record = db.prepare(`SELECT * FROM schedules WHERE date = ?`).get(date)

      if (record) {
        results.push({
          id: record.id,
          date: record.date,
          schedule: JSON.parse(record.schedule || '{}'),
          syncMethod: record.sync_method,
          lastModifiedBy: JSON.parse(record.last_modified_by || '{}'),
          createdAt: record.created_at,
          updatedAt: record.updated_at
        })
      }
    }

    res.json(results)

  } catch (error) {
    console.error('批次取得歸檔排程錯誤:', error)
    res.status(500).json({
      error: true,
      message: '批次取得歸檔排程失敗'
    })
  }
})

/**
 * GET /api/schedules/archived?date=YYYY-MM-DD
 * Angular 前端用此路由取得歸檔排程（對應後端 /expired/:date）
 */
router.get('/archived', authenticate, (req, res) => {
  const date = req.query.date
  if (!date) {
    return res.status(400).json({ error: true, message: '需要 date 參數' })
  }
  req.params.date = date
  getExpiredSchedule(req, res)
})

/**
 * GET /api/schedules/range?start=&end=
 * Angular 前端用此路由取得日期範圍排程（別名，對應 GET /api/schedules?startDate=&endDate=）
 */
router.get('/range', authenticate, (req, res) => {
  const { start, end } = req.query
  const db = getDatabase()
  try {
    let query = 'SELECT * FROM schedules'
    const params = []
    if (start && end) {
      query += ' WHERE date >= ? AND date <= ?'
      params.push(start, end)
    } else if (start) {
      query += ' WHERE date >= ?'
      params.push(start)
    }
    query += ' ORDER BY date'
    const schedules = db.prepare(query).all(...params)
    res.json(schedules.map(s => ({
      id: s.id,
      date: s.date,
      schedule: JSON.parse(s.schedule || '{}'),
      syncMethod: s.sync_method,
      lastModifiedBy: JSON.parse(s.last_modified_by || '{}'),
      createdAt: s.created_at,
      updatedAt: s.updated_at
    })))
  } catch (error) {
    console.error('取得排程範圍錯誤:', error)
    res.status(500).json({ error: true, message: '取得排程範圍失敗' })
  }
})


/**
 * GET /api/schedules/:date
 * 取得特定日期的排程
 * 如果排程不存在或為空，自動從總表生成
 */
router.get('/:date', authenticate, (req, res) => {
  try {
    const { date } = req.params
    const db = getDatabase()

    let schedule = db.prepare(`SELECT * FROM schedules WHERE date = ?`).get(date)
    let scheduleData = schedule ? JSON.parse(schedule.schedule || '{}') : {}

    // 如果排程不存在或為空，從總表自動生成
    if (!schedule || Object.keys(scheduleData).length === 0) {
      console.log(`[Schedules] 排程 ${date} 不存在或為空，從總表自動生成...`)

      // 取得總表
      const masterDoc = db.prepare(`
        SELECT schedule FROM base_schedules WHERE id = 'MASTER_SCHEDULE'
      `).get()

      if (masterDoc) {
        const masterRules = JSON.parse(masterDoc.schedule || '{}')

        // 載入病人資料用於生成 autoNote
        const patients = db.prepare(`
          SELECT * FROM patients WHERE is_deleted = 0
        `).all()
        const patientsMap = new Map()
        patients.forEach(p => patientsMap.set(p.id, p))

        // 生成排程
        scheduleData = generateDailyScheduleFromRules(masterRules, date, patientsMap)

        if (Object.keys(scheduleData).length > 0) {
          // 儲存生成的排程
          if (schedule) {
            // 更新現有的空排程
            db.prepare(`
              UPDATE schedules
              SET schedule = ?, sync_method = 'auto_generate', updated_at = datetime('now', 'localtime')
              WHERE date = ?
            `).run(JSON.stringify(scheduleData), date)
          } else {
            // 創建新排程
            db.prepare(`
              INSERT INTO schedules (id, date, schedule, sync_method, created_at, updated_at)
              VALUES (?, ?, ?, 'auto_generate', datetime('now', 'localtime'), datetime('now', 'localtime'))
            `).run(date, date, JSON.stringify(scheduleData))
          }
          console.log(`[Schedules] 已自動生成 ${date} 排程，共 ${Object.keys(scheduleData).length} 個床位`)

          // 重新讀取更新後的記錄
          schedule = db.prepare(`SELECT * FROM schedules WHERE date = ?`).get(date)
        }
      }
    }


    if (!schedule) {
      return res.json({
        id: date,
        date,
        schedule: {},
        createdAt: null,
        updatedAt: null
      })
    }

    res.json({
      id: schedule.id,
      date: schedule.date,
      schedule: JSON.parse(schedule.schedule || '{}'),
      syncMethod: schedule.sync_method,
      lastModifiedBy: JSON.parse(schedule.last_modified_by || '{}'),
      createdAt: schedule.created_at,
      updatedAt: schedule.updated_at
    })

  } catch (error) {
    console.error('取得排程錯誤:', error)
    res.status(500).json({
      error: true,
      message: '取得排程失敗'
    })
  }
})

/**
 * PUT /api/schedules/:date
 * 更新特定日期的排程
 */
router.put('/:date', ...isEditor, async (req, res) => {
  try {
    const { date } = req.params
    const { schedule } = req.body

    const db = getDatabase()

    const existing = db.prepare(`SELECT id FROM schedules WHERE date = ?`).get(date)

    const lastModifiedBy = JSON.stringify({ uid: req.user.id, name: req.user.name })

    if (existing) {
      db.prepare(`
        UPDATE schedules
        SET schedule = ?,
            last_modified_by = ?,
            updated_at = datetime('now', 'localtime')
        WHERE date = ?
      `).run(JSON.stringify(schedule), lastModifiedBy, date)
    } else {
      db.prepare(`
        INSERT INTO schedules (id, date, schedule, last_modified_by)
        VALUES (?, ?, ?, ?)
      `).run(date, date, JSON.stringify(schedule), lastModifiedBy)
    }

    const updated = db.prepare(`SELECT * FROM schedules WHERE date = ?`).get(date)

    await logAudit('SCHEDULE_UPDATE', req.user.id, req.user.name, 'schedules', date, {
      slotCount: Object.keys(schedule).length
    })

    res.json({
      id: updated.id,
      date: updated.date,
      schedule: JSON.parse(updated.schedule || '{}'),
      lastModifiedBy: JSON.parse(updated.last_modified_by || '{}'),
      updatedAt: updated.updated_at
    })

  } catch (error) {
    console.error('更新排程錯誤:', error)
    res.status(500).json({
      error: true,
      message: '更新排程失敗'
    })
  }
})

// ========================================
// 基礎排班總表 API
// ========================================

/**
 * GET /api/schedules/base/master (或 /base/MASTER_SCHEDULE)
 * 取得主要排班總表
 */
function getBaseScheduleMaster(req, res) {
  try {
    const db = getDatabase()

    const masterSchedule = db.prepare(`
      SELECT * FROM base_schedules WHERE id = 'MASTER_SCHEDULE'
    `).get()


    if (!masterSchedule) {
      return res.json({
        id: 'MASTER_SCHEDULE',
        schedule: {}
      })
    }

    res.json({
      id: masterSchedule.id,
      schedule: JSON.parse(masterSchedule.schedule || '{}'),
      createdAt: masterSchedule.created_at,
      updatedAt: masterSchedule.updated_at
    })

  } catch (error) {
    console.error('取得排班總表錯誤:', error)
    res.status(500).json({
      error: true,
      message: '取得排班總表失敗'
    })
  }
}
router.get('/base/master', authenticate, getBaseScheduleMaster)
router.get('/base/MASTER_SCHEDULE', authenticate, getBaseScheduleMaster)

/**
 * PUT /api/schedules/base/master (或 /base/MASTER_SCHEDULE)
 * 更新主要排班總表（並自動同步到未來 60 天排程）
 */
async function putBaseScheduleMaster(req, res) {
  try {
    const { schedule } = req.body

    // 保護：防止空資料覆蓋總表
    if (schedule === undefined || schedule === null) {
      return res.status(400).json({
        error: true,
        message: '缺少 schedule 欄位，無法更新總表'
      })
    }

    const db = getDatabase()

    // 先取得變更前的總表
    const beforeDoc = db.prepare(`
      SELECT schedule FROM base_schedules WHERE id = 'MASTER_SCHEDULE'
    `).get()
    const beforeRules = beforeDoc ? JSON.parse(beforeDoc.schedule || '{}') : {}

    // 更新總表
    db.prepare(`
      INSERT INTO base_schedules (id, schedule, updated_at)
      VALUES ('MASTER_SCHEDULE', ?, datetime('now', 'localtime'))
      ON CONFLICT(id) DO UPDATE SET
        schedule = excluded.schedule,
        updated_at = datetime('now', 'localtime')
    `).run(JSON.stringify(schedule))

    const updated = db.prepare(`
      SELECT * FROM base_schedules WHERE id = 'MASTER_SCHEDULE'
    `).get()


    await logAudit('BASE_SCHEDULE_UPDATE', req.user.id, req.user.name, 'base_schedules', 'MASTER_SCHEDULE', {
      patientCount: Object.keys(schedule).length
    })

    // 🔥 同步到未來 60 天排程（非同步執行，不阻塞回應）
    const modifiedBy = { uid: req.user.id, name: req.user.name }
    syncMasterScheduleToFuture(beforeRules, schedule, modifiedBy)
      .then(result => {
        console.log('📅 [MasterSchedule] 同步完成:', result.message)
      })
      .catch(err => {
        console.error('❌ [MasterSchedule] 同步失敗:', err.message)
      })

    res.json({
      id: updated.id,
      schedule: JSON.parse(updated.schedule || '{}'),
      updatedAt: updated.updated_at
    })

  } catch (error) {
    console.error('更新排班總表錯誤:', error)
    res.status(500).json({
      error: true,
      message: '更新排班總表失敗'
    })
  }
}
router.put('/base/master', ...isEditor, putBaseScheduleMaster)
router.put('/base/MASTER_SCHEDULE', ...isEditor, putBaseScheduleMaster)
router.patch('/base/master', ...isEditor, putBaseScheduleMaster)
router.patch('/base/MASTER_SCHEDULE', ...isEditor, putBaseScheduleMaster)

/**
 * PATCH /api/schedules/base/master/patient/:patientId (或 /base/MASTER_SCHEDULE/patient/:patientId)
 * 更新單一病人的排班規則（並自動同步到未來 60 天排程）
 */
async function patchBaseSchedulePatient(req, res) {
  try {
    const { patientId } = req.params
    const rule = req.body

    const db = getDatabase()

    // 取得目前的總表（變更前）
    const current = db.prepare(`
      SELECT schedule FROM base_schedules WHERE id = 'MASTER_SCHEDULE'
    `).get()

    const beforeRules = current ? JSON.parse(current.schedule || '{}') : {}
    const schedule = { ...beforeRules }

    // 更新或刪除規則
    if (rule && Object.keys(rule).length > 0) {
      schedule[patientId] = rule
    } else {
      delete schedule[patientId]
    }

    // 儲存更新
    db.prepare(`
      UPDATE base_schedules
      SET schedule = ?, updated_at = datetime('now', 'localtime')
      WHERE id = 'MASTER_SCHEDULE'
    `).run(JSON.stringify(schedule))


    await logAudit('PATIENT_SCHEDULE_RULE_UPDATE', req.user.id, req.user.name, 'base_schedules', patientId, rule)

    // 🔥 同步到未來 60 天排程（非同步執行）
    const modifiedBy = { uid: req.user.id, name: req.user.name }
    syncMasterScheduleToFuture(beforeRules, schedule, modifiedBy)
      .then(result => {
        console.log('📅 [PatientRule] 同步完成:', result.message)
      })
      .catch(err => {
        console.error('❌ [PatientRule] 同步失敗:', err.message)
      })

    res.json({
      success: true,
      patientId,
      rule: schedule[patientId] || null
    })

  } catch (error) {
    console.error('更新病人排班規則錯誤:', error)
    res.status(500).json({
      error: true,
      message: '更新病人排班規則失敗'
    })
  }
}
router.patch('/base/master/patient/:patientId', ...isEditor, patchBaseSchedulePatient)
router.patch('/base/MASTER_SCHEDULE/patient/:patientId', ...isEditor, patchBaseSchedulePatient)

/**
 * POST /api/schedules/sync/initialize
 * 手動初始化未來 60 天排程（用於首次設定或重建）
 */
router.post('/sync/initialize', ...isEditor, async (req, res) => {
  try {
    const modifiedBy = { uid: req.user.id, name: req.user.name }
    const result = await initializeFutureSchedules(modifiedBy)

    await logAudit('SCHEDULE_INITIALIZE', req.user.id, req.user.name, 'schedules', 'future_60_days', {
      createdCount: result.createdCount
    })

    res.json(result)

  } catch (error) {
    console.error('初始化排程錯誤:', error)
    res.status(500).json({
      error: true,
      message: '初始化排程失敗'
    })
  }
})

// ========================================
// 調班申請 API
// ========================================

/**
 * GET /api/schedules/exceptions
 * 取得調班申請列表
 */
function getExceptionsList(req, res) {
  try {
    const { status, patientId, startDate, endDate, id } = req.query
    const db = getDatabase()

    let query = 'SELECT * FROM schedule_exceptions WHERE 1=1'
    const params = []

    // 支援單一 ID 查詢
    if (id) {
      query += ' AND id = ?'
      params.push(id)
    }

    if (status) {
      const statuses = status.split(',')
      query += ` AND status IN (${statuses.map(() => '?').join(',')})`
      params.push(...statuses)
    }

    if (patientId) {
      query += ' AND patient_id = ?'
      params.push(patientId)
    }

    if (startDate) {
      query += ' AND (date >= ? OR start_date >= ?)'
      params.push(startDate, startDate)
    }

    if (endDate) {
      query += ' AND (date <= ? OR end_date <= ?)'
      params.push(endDate, endDate)
    }

    query += ' ORDER BY created_at DESC'

    const exceptions = db.prepare(query).all(...params)

    res.json(exceptions.map(e => ({
      id: e.id,
      type: e.type,
      status: e.status,
      patientId: e.patient_id,
      patientName: e.patient_name,
      from: JSON.parse(e.from_data || '{}'),
      to: JSON.parse(e.to_data || '{}'),
      patient1: JSON.parse(e.patient1 || '{}'),
      patient2: JSON.parse(e.patient2 || '{}'),
      startDate: e.start_date,
      endDate: e.end_date,
      date: e.date,
      reason: e.reason,
      cancelReason: e.cancel_reason,
      errorMessage: e.error_message,
      createdBy: JSON.parse(e.created_by || '{}'),
      cancelledAt: e.cancelled_at,
      createdAt: e.created_at,
      updatedAt: e.updated_at
    })))

  } catch (error) {
    console.error('取得調班申請錯誤:', error)
    res.status(500).json({
      error: true,
      message: '取得調班申請失敗'
    })
  }
}
router.get('/exceptions/list', authenticate, getExceptionsList)
router.get('/exception-tasks', authenticate, getExceptionsList)

/**
 * POST /api/schedules/exceptions
 * 建立調班申請
 */
router.post('/exceptions', ...isEditor, async (req, res) => {
  try {
    const data = req.body
    const id = uuidv4()

    const db = getDatabase()

    db.prepare(`
      INSERT INTO schedule_exceptions (
        id, type, status, patient_id, patient_name,
        from_data, to_data, patient1, patient2,
        start_date, end_date, date, reason, created_by
      ) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.type,
      data.patientId || null,
      data.patientName || null,
      JSON.stringify(data.from || {}),
      JSON.stringify(data.to || {}),
      JSON.stringify(data.patient1 || {}),
      JSON.stringify(data.patient2 || {}),
      data.startDate || null,
      data.endDate || null,
      data.date || null,
      data.reason || null,
      JSON.stringify({ uid: req.user.id, name: req.user.name })
    )

    const created = db.prepare(`SELECT * FROM schedule_exceptions WHERE id = ?`).get(id)

    await logAudit('EXCEPTION_CREATE', req.user.id, req.user.name, 'schedule_exceptions', id, {
      type: data.type,
      patientName: data.patientName
    })

    // 🔥 自動處理調班申請（非同步執行，不阻塞回應）
    const exceptionData = {
      type: data.type,
      status: 'pending',
      patientId: data.patientId,
      patientName: data.patientName,
      from: data.from,
      to: data.to,
      patient1: data.patient1,
      patient2: data.patient2,
      startDate: data.startDate,
      endDate: data.endDate,
      date: data.date
    }

    processScheduleException(id, exceptionData)
      .then(result => {
        if (result.success) {
          console.log(`✅ [Schedules] 調班 ${id} 自動處理完成`)
        } else {
          console.log(`⚠️ [Schedules] 調班 ${id} 處理失敗: ${result.error || result.message}`)
        }
      })
      .catch(err => {
        console.error(`❌ [Schedules] 調班 ${id} 處理異常:`, err.message)
      })

    res.status(201).json({
      id: created.id,
      type: created.type,
      status: created.status,
      createdAt: created.created_at
    })

  } catch (error) {
    console.error('建立調班申請錯誤:', error)
    res.status(500).json({
      error: true,
      message: '建立調班申請失敗'
    })
  }
})

/**
 * PATCH /api/schedules/exceptions/:id
 * 更新調班申請狀態
 */
router.patch('/exceptions/:id', ...isEditor, async (req, res) => {
  try {
    const { id } = req.params
    const { status, cancelReason, errorMessage } = req.body

    const db = getDatabase()

    const existing = db.prepare(`SELECT * FROM schedule_exceptions WHERE id = ?`).get(id)

    if (!existing) {
      return res.status(404).json({
        error: true,
        message: '調班申請不存在'
      })
    }

    const updates = ["updated_at = datetime('now', 'localtime')"]
    const params = []

    if (status) {
      updates.push('status = ?')
      params.push(status)
    }

    if (cancelReason) {
      updates.push('cancel_reason = ?')
      params.push(cancelReason)
    }

    if (errorMessage) {
      updates.push('error_message = ?')
      params.push(errorMessage)
    }

    if (status === 'cancelled') {
      updates.push("cancelled_at = datetime('now', 'localtime')")
    }

    params.push(id)

    db.prepare(`UPDATE schedule_exceptions SET ${updates.join(', ')} WHERE id = ?`).run(...params)


    await logAudit('EXCEPTION_UPDATE', req.user.id, req.user.name, 'schedule_exceptions', id, {
      newStatus: status
    })

    res.json({
      success: true,
      message: '調班申請已更新'
    })

  } catch (error) {
    console.error('更新調班申請錯誤:', error)
    res.status(500).json({
      error: true,
      message: '更新調班申請失敗'
    })
  }
})

/**
 * DELETE /api/schedules/exceptions/:id
 * 刪除調班申請（含排程清理）
 */
router.delete('/exceptions/:id', ...isEditor, async (req, res) => {
  try {
    const { id } = req.params
    const db = getDatabase()

    // 🔥 先取得調班資料，用於後續清理
    const exception = db.prepare(`SELECT * FROM schedule_exceptions WHERE id = ?`).get(id)

    if (!exception) {
      return res.status(404).json({
        error: true,
        message: '調班申請不存在'
      })
    }

    // 解析調班資料
    const exData = {
      type: exception.type,
      date: exception.date,
      startDate: exception.start_date,
      endDate: exception.end_date,
      from: JSON.parse(exception.from_data || '{}'),
      to: JSON.parse(exception.to_data || '{}'),
      status: exception.status,
    }

    // 刪除調班記錄
    db.prepare(`DELETE FROM schedule_exceptions WHERE id = ?`).run(id)
    console.log(`[ExceptionDelete] 已刪除調班 ${id}`)

    // 🔥 如果是已生效的調班，需要重建受影響的排程
    if (exData.status === 'applied' || exData.status === 'conflict_requires_resolution') {
      const todayStr = getTaipeiTodayString()

      // 找出受影響的日期
      const datesToRebuild = new Set()

      if (exData.type === 'SUSPEND' && exData.startDate && exData.endDate) {
        // 暫停類型：區間內所有日期
        const start = new Date(exData.startDate + 'T00:00:00Z')
        const end = new Date(exData.endDate + 'T00:00:00Z')
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          const dateStr = formatDateToYYYYMMDD(d)
          if (dateStr >= todayStr) {
            datesToRebuild.add(dateStr)
          }
        }
      } else {
        // 其他類型：相關日期
        const relevantDates = [
          exData.date,
          exData.startDate,
          exData.from?.sourceDate,
          exData.to?.goalDate
        ].filter(Boolean)

        relevantDates.forEach(d => {
          if (d >= todayStr) {
            datesToRebuild.add(d)
          }
        })
      }

      if (datesToRebuild.size > 0) {
        console.log(`[ExceptionDelete] 需要重建 ${datesToRebuild.size} 個日期的排程`)

        // 取得總表規則
        const masterDoc = db.prepare(`
          SELECT schedule FROM base_schedules WHERE id = 'MASTER_SCHEDULE'
        `).get()
        const masterRules = masterDoc ? JSON.parse(masterDoc.schedule || '{}') : {}

        // 載入病人資料
        const patients = db.prepare(`SELECT * FROM patients WHERE is_deleted = 0`).all()
        const patientsMap = new Map()
        patients.forEach(p => patientsMap.set(p.id, p))

        // 重建每個受影響日期的排程
        for (const dateStr of datesToRebuild) {
          try {
            const finalSchedule = rebuildSingleDaySchedule(dateStr, masterRules, patientsMap)

            db.prepare(`
              UPDATE schedules
              SET schedule = ?,
                  sync_method = 'rebuild_on_delete',
                  last_modified_by = ?,
                  updated_at = datetime('now', 'localtime')
              WHERE date = ?
            `).run(
              JSON.stringify(finalSchedule),
              JSON.stringify({ uid: req.user.id, name: req.user.name }),
              dateStr
            )
            console.log(`[ExceptionDelete] 已重建 ${dateStr} 的排程`)
          } catch (rebuildError) {
            console.error(`[ExceptionDelete] 重建 ${dateStr} 失敗:`, rebuildError)
          }
        }
      }
    }


    await logAudit('EXCEPTION_DELETE', req.user.id, req.user.name, 'schedule_exceptions', id, {
      type: exData.type,
      status: exData.status
    })

    res.json({
      success: true,
      message: '調班申請已刪除'
    })

  } catch (error) {
    console.error('刪除調班申請錯誤:', error)
    res.status(500).json({
      error: true,
      message: '刪除調班申請失敗'
    })
  }
})

// ========================================
// 護理人員分配 API
// ========================================

/**
 * GET /api/schedules/nurse-assignments/:date
 * 取得特定日期的護理人員分配
 */
router.get('/nurse-assignments/:date', authenticate, (req, res) => {
  try {
    const { date } = req.params
    const db = getDatabase()

    const assignment = db.prepare(`
      SELECT * FROM nurse_assignments WHERE date = ?
    `).get(date)


    if (!assignment) {
      return res.json({
        id: date,
        date,
        teams: {},
        names: {},
        takeoffEnabled: false
      })
    }

    // teams 欄位儲存完整的資料結構 (teams, names, takeoffEnabled)
    const data = JSON.parse(assignment.teams || '{}')

    res.json({
      id: assignment.id,
      date: assignment.date,
      teams: data.teams || data,  // 兼容舊格式
      names: data.names || {},
      takeoffEnabled: data.takeoffEnabled || false,
      createdAt: assignment.created_at,
      updatedAt: assignment.updated_at
    })

  } catch (error) {
    console.error('取得護理分配錯誤:', error)
    res.status(500).json({
      error: true,
      message: '取得護理分配失敗'
    })
  }
})

/**
 * PUT /api/schedules/nurse-assignments/:date
 * 更新護理人員分配
 */
router.put('/nurse-assignments/:date', ...isEditor, async (req, res) => {
  try {
    const { date } = req.params
    const { teams, names, takeoffEnabled } = req.body

    // 儲存完整的資料結構
    const dataToSave = {
      teams: teams || {},
      names: names || {},
      takeoffEnabled: takeoffEnabled || false
    }

    const db = getDatabase()

    db.prepare(`
      INSERT INTO nurse_assignments (id, date, teams, updated_at)
      VALUES (?, ?, ?, datetime('now', 'localtime'))
      ON CONFLICT(date) DO UPDATE SET
        teams = excluded.teams,
        updated_at = datetime('now', 'localtime')
    `).run(date, date, JSON.stringify(dataToSave))


    res.json({
      success: true,
      date,
      ...dataToSave
    })

  } catch (error) {
    console.error('更新護理分配錯誤:', error)
    res.status(500).json({
      error: true,
      message: '更新護理分配失敗'
    })
  }
})

// ========================================
// 管理工具 API
// ========================================

/**
 * POST /api/schedules/admin/force-resync
 * 強制重新同步所有未來排程
 */
router.post('/admin/force-resync', ...isEditor, async (req, res) => {
  try {
    console.log('[Admin] 🔄 開始強制重新同步所有排程...')

    const db = getDatabase()

    // 取得總表規則
    const masterDoc = db.prepare(`
      SELECT schedule FROM base_schedules WHERE id = 'MASTER_SCHEDULE'
    `).get()
    const masterRules = masterDoc ? JSON.parse(masterDoc.schedule || '{}') : {}

    if (Object.keys(masterRules).length === 0) {
      return res.status(400).json({
        error: true,
        message: '總表沒有任何規則'
      })
    }

    // 載入病人資料
    const patients = db.prepare(`SELECT * FROM patients WHERE is_deleted = 0`).all()
    const patientsMap = new Map()
    patients.forEach(p => patientsMap.set(p.id, p))

    // 計算未來 60 天
    const todayStr = getTaipeiTodayString()
    const futureDates = Array.from({ length: 60 }, (_, i) => {
      const date = new Date(todayStr + 'T00:00:00Z')
      date.setUTCDate(date.getUTCDate() + i)
      return formatDateToYYYYMMDD(date)
    })

    let syncedCount = 0

    for (const dateStr of futureDates) {
      const finalSchedule = rebuildSingleDaySchedule(dateStr, masterRules, patientsMap)

      db.prepare(`
        INSERT INTO schedules (id, date, schedule, sync_method, last_modified_by, created_at, updated_at)
        VALUES (?, ?, ?, 'force_resync', ?, datetime('now', 'localtime'), datetime('now', 'localtime'))
        ON CONFLICT(date) DO UPDATE SET
          schedule = excluded.schedule,
          sync_method = 'force_resync',
          last_modified_by = excluded.last_modified_by,
          updated_at = datetime('now', 'localtime')
      `).run(
        dateStr,
        dateStr,
        JSON.stringify(finalSchedule),
        JSON.stringify({ uid: req.user.id, name: req.user.name })
      )
      syncedCount++
    }


    console.log(`[Admin] ✅ 強制重新同步完成，共處理 ${syncedCount} 天`)

    await logAudit('FORCE_RESYNC', req.user.id, req.user.name, 'schedules', null, {
      daysProcessed: syncedCount
    })

    res.json({
      success: true,
      message: `強制重新同步完成，共處理 ${syncedCount} 天`,
      syncedCount
    })

  } catch (error) {
    console.error('[Admin] 強制重新同步失敗:', error)
    res.status(500).json({
      error: true,
      message: '強制重新同步失敗'
    })
  }
})

/**
 * POST /api/schedules/admin/migrate-to-archive
 * 批次將過去排程遷移到歸檔
 */
router.post('/admin/migrate-to-archive', ...isEditor, async (req, res) => {
  try {
    const { beforeDate } = req.body
    const todayStr = getTaipeiTodayString()
    const targetDate = beforeDate || todayStr

    console.log(`[Admin] 📁 開始遷移 ${targetDate} 之前的排程到歸檔...`)

    const db = getDatabase()

    // 找出需要遷移的排程
    const schedulesToMigrate = db.prepare(`
      SELECT * FROM schedules WHERE date < ?
    `).all(targetDate)

    if (schedulesToMigrate.length === 0) {
      return res.json({
        success: true,
        message: '沒有需要遷移的排程',
        migratedCount: 0
      })
    }

    let migratedCount = 0
    let skippedCount = 0

    for (const schedule of schedulesToMigrate) {
      // 檢查是否已歸檔
      const existing = db.prepare(`
        SELECT id FROM archived_schedules WHERE date = ?
      `).get(schedule.date)

      if (existing) {
        // 已存在歸檔，只刪除原排程
        db.prepare(`DELETE FROM schedules WHERE date = ?`).run(schedule.date)
        skippedCount++
        continue
      }

      const scheduleData = JSON.parse(schedule.schedule || '{}')

      // 收集病人 ID
      const patientIds = [...new Set(
        Object.values(scheduleData)
          .map(slot => slot.patientId)
          .filter(Boolean)
      )]

      // 查詢病人資料
      let missingCount = 0
      if (patientIds.length > 0) {
        const placeholders = patientIds.map(() => '?').join(',')
        const patients = db.prepare(`
          SELECT id FROM patients WHERE id IN (${placeholders})
        `).all(...patientIds)

        const foundIds = new Set(patients.map(p => p.id))
        missingCount = patientIds.filter(id => !foundIds.has(id)).length
      }

      // 插入歸檔
      db.prepare(`
        INSERT INTO archived_schedules (
          id, date, schedule, last_modified_by,
          archived_at, archive_method, patient_count, missing_patient_count,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, datetime('now', 'localtime'), 'manual_migrate', ?, ?, ?, ?)
      `).run(
        schedule.date,
        schedule.date,
        schedule.schedule,
        schedule.last_modified_by || '{}',
        patientIds.length,
        missingCount,
        schedule.created_at,
        schedule.updated_at
      )

      // 刪除原排程
      db.prepare(`DELETE FROM schedules WHERE date = ?`).run(schedule.date)
      migratedCount++
    }


    console.log(`[Admin] ✅ 遷移完成：${migratedCount} 份歸檔，${skippedCount} 份跳過`)

    await logAudit('MIGRATE_TO_ARCHIVE', req.user.id, req.user.name, 'schedules', null, {
      migratedCount,
      skippedCount,
      beforeDate: targetDate
    })

    res.json({
      success: true,
      message: `遷移完成：${migratedCount} 份歸檔，${skippedCount} 份跳過`,
      migratedCount,
      skippedCount
    })

  } catch (error) {
    console.error('[Admin] 遷移歸檔失敗:', error)
    res.status(500).json({
      error: true,
      message: '遷移歸檔失敗'
    })
  }
})

export default router
