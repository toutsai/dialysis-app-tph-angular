// Shared patient/order side effects. Strict mode rolls back required database writes.
import { v4 as uuidv4 } from 'uuid'
import { formatDateToYYYYMMDD, getTaipeiTodayString } from '../utils/dateUtils.js'
import { syncEventsToKiditLogbook } from './kiditSync.js'
import { emitExceptionChange, emitScheduleSaved } from './eventBus.js'
import { rebuildAndSaveSchedules, isTodayScheduleFrozen } from './scheduleSync.js'
import { removeAutoMovementFromDailyLog } from './dailyLogMovementSync.js'
import { snapshotNurseAssignmentForDate } from './nurseAssignmentRevisions.js'
import { normalizeDialysisMode } from '../utils/dialysisMode.js'
import { recordPatientHistory, createPatientSnapshot } from './patientHistory.js'

function afterCommit(options, callback) {
  if (options.afterCommit) options.afterCommit.push(callback)
  else callback()
}

// The order transaction cannot swallow log write failures or publish uncommitted changes.
function removeOrderAutoMovement(db, date, movementId, options) {
  const dailyLog = db.prepare('SELECT * FROM daily_logs WHERE date = ?').get(date)
  if (!dailyLog) return
  const movements = JSON.parse(dailyLog.patient_movements || '[]')
  const next = movements.filter(item => item.id !== movementId)
  if (next.length === movements.length) return
  db.prepare("UPDATE daily_logs SET patient_movements = ?, updated_at = datetime('now', 'localtime') WHERE date = ?").run(JSON.stringify(next), date)
  afterCommit(options, () => syncEventsToKiditLogbook(date, {
    patientMovements: next,
    vascularAccessLog: JSON.parse(dailyLog.vascular_access_log || '[]'),
    createdAt: dailyLog.created_at,
  }).catch(error => console.error('[DailyLog] Kidit sync failed:', error)))
}

function recordModeHistory(db, id, name, details, snapshot, options) {
  if (!options.strict) return recordPatientHistory(db, id, name, 'MODE_CHANGE', details, snapshot)
  db.prepare(`INSERT INTO patient_history (id, patient_id, patient_name, event_type, event_details, snapshot, timestamp)
    VALUES (?, ?, ?, 'MODE_CHANGE', ?, ?, datetime('now', 'localtime'))`).run(
    uuidv4(), id, name, JSON.stringify(details), JSON.stringify(snapshot),
  )
}

/**
 * 將病人動態加入當日工作日誌
 * 注意：Kidit 同步統一由工作日誌保存時處理 (PUT /api/nursing/daily-logs/:date)
 */
export function addMovementToDailyLog(db, movementData, options = {}) {
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
    const syncKidit = () => {
      const updatedLog = db.prepare(`SELECT * FROM daily_logs WHERE date = ?`).get(todayStr)
      if (updatedLog) {
        syncEventsToKiditLogbook(todayStr, {
          patientMovements: JSON.parse(updatedLog.patient_movements || '[]'),
          vascularAccessLog: JSON.parse(updatedLog.vascular_access_log || '[]'),
          createdAt: updatedLog.created_at,
        }).catch(err => console.error('[DailyLog] Kidit 同步失敗 (非致命):', err))
      }
    }
    afterCommit(options, syncKidit)
  } catch (error) {
    if (options.strict) throw error
    console.error('[DailyLog] 記錄失敗:', error)
  }
}

export function safeJsonParse(value, fallback = {}) {
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

  const rebuildDates = dates.filter(dateStr => {
    // 今日排程整天凍結（06:00 起）：跳過重建，今天由現場組長手動調整。
    // 凌晨（預約變更/預約刪除 cron）不凍結，生效日當天的清理照常執行。
    if (isTodayScheduleFrozen(dateStr)) {
      console.log(`[PatientCleanup] ${dateStr} 今日排程已凍結，跳過重建（由現場手動調整）`)
      return false
    }
    return true
  })
  rebuildAndSaveSchedules(rebuildDates, activeMasterRules, patientsMap,
    modifiedBy || {}, 'patient_exception_cleanup')
}

export function deleteFutureScheduleExceptionsForPatient(db, patientId, reason, modifiedBy, options = {}) {
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
      if (options.strict) {
        removeOrderAutoMovement(db, to.goalDate, `auto_add_session_${exception.id}`, options)
      } else {
        removeAutoMovementFromDailyLog(db, to.goalDate, `auto_add_session_${exception.id}`)
      }
    }

    deleteById.run(exception.id)
    futureDates.forEach(date => datesToRebuild.add(date))
    afterCommit(options, () => emitExceptionChange('deleted', {
      id: exception.id,
      type: exception.type,
      patientId,
      affectedDates: futureDates,
      reason,
    }))

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


export function snapshotPatientScheduleChange(db, existing, updated, data, user, options = {}) {
  const id = existing.id
  const wasDeleted = existing.is_deleted === 1
  const isNowDeleted = updated.is_deleted === 1
  const modifiedBy = { uid: user.id, name: user.name }
  try {
    const oldOrders = JSON.parse(existing.dialysis_orders || '{}')
    const newOrders = JSON.parse(updated.dialysis_orders || '{}')
    const statusChanged = updated.status !== existing.status
    const modeChanged = (newOrders.mode || null) !== (oldOrders.mode || null)
    const freqChanged = (newOrders.freq || null) !== (oldOrders.freq || null)
    const todayStr = getTaipeiTodayString()
    const effectiveShiftScope =
      data.effectiveShiftScope === 'current'
        ? 'current'
        : data.effectiveShiftScope === 'next' || data.effectiveFromNextShift === true
          ? 'next'
          : 'all'
    const SHIFT_ORDER = ['early', 'noon', 'late']
    const SHIFT_START_TIMES = { early: '07:30', noon: '12:30', late: '17:30' }
    const nowTaipeiHM = new Date()
      .toLocaleTimeString('en-GB', { timeZone: 'Asia/Taipei', hour12: false })
      .slice(0, 5)
    // 目前進行中的班別 = 最後一個已開始的班別（07:30 前為 null）
    const currentShift = SHIFT_ORDER.filter((s) => nowTaipeiHM >= SHIFT_START_TIMES[s]).pop() || null
    // 未知班別（外圍等非標準 key 已涵蓋於 early/noon/late 尾碼；防呆保守視為已開始/已結束 → 照舊快照）
    const isShiftStarted = (shift) => {
      const start = SHIFT_START_TIMES[shift]
      return start ? nowTaipeiHM >= start : true
    }
    const isShiftEnded = (shift) => {
      const idx = SHIFT_ORDER.indexOf(shift)
      if (idx < 0) return true
      return currentShift ? idx < SHIFT_ORDER.indexOf(currentShift) : false
    }
    // 該格是否在「維持原顯示」範圍（要寫快照）
    const shouldSnapshot = (shift) => {
      if (effectiveShiftScope === 'next') return isShiftStarted(shift)
      if (effectiveShiftScope === 'current') return isShiftEnded(shift)
      return true
    }
    const isDeleting = !wasDeleted && isNowDeleted
    // 僅在今日凍結窗（06:00 起）內寫快照：凌晨的變更依既有設計本來就算今天的，
    // 不該把變更前狀態凍進今天（與 isTodayScheduleFrozen 的重建放行邊界一致）
    if (
      (statusChanged || modeChanged || freqChanged || isDeleting) &&
      isTodayScheduleFrozen(todayStr)
    ) {
      const todayRow = db.prepare(`SELECT schedule FROM schedules WHERE date = ?`).get(todayStr)
      if (todayRow) {
        const todaySchedule = JSON.parse(todayRow.schedule || '{}')
        let snapshotWritten = false
        const removedShifts = new Set()
        for (const [slotKey, slot] of Object.entries(todaySchedule)) {
          if (slot?.patientId !== id) continue
          const slotShift = slot.shiftId || String(slotKey).split('-').pop()
          if (!shouldSnapshot(slotShift)) {
            // 生效範圍內的格：刪除 → 自今日排程移除；其他變更 → 不快照即時渲染新資料
            if (isDeleting && effectiveShiftScope !== 'all') {
              delete todaySchedule[slotKey]
              removedShifts.add(slotShift)
              snapshotWritten = true
            } else if (effectiveShiftScope !== 'all' && slot.archivedPatientInfo) {
              // 同日先前變更留下的快照會把這格鎖在舊顯示；使用者明確選定生效範圍時以本次為準
              delete slot.archivedPatientInfo
              snapshotWritten = true
            }
            continue
          }
          if (!slot.archivedPatientInfo) {
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
          // 今日格被移除的班別，一併清掉護理分組的 `${patientId}-${shift}` key（避免孤兒分組）
          let teamsVersion = null
          if (removedShifts.size > 0) {
            const teamsRow = db.prepare(`SELECT teams FROM nurse_assignments WHERE date = ?`).get(todayStr)
            if (teamsRow) {
              const teamsData = JSON.parse(teamsRow.teams || '{}')
              const teamsMap = teamsData.teams || teamsData // 兼容舊格式（整包即 teams）
              let teamsChanged = false
              for (const shift of removedShifts) {
                if (teamsMap[`${id}-${shift}`] !== undefined) {
                  delete teamsMap[`${id}-${shift}`]
                  teamsChanged = true
                }
              }
              if (teamsChanged) {
                snapshotNurseAssignmentForDate(db, todayStr, { type: 'pre_save', createdBy: modifiedBy })
                db.prepare(
                  `UPDATE nurse_assignments SET teams = ?, updated_at = datetime('now', 'localtime') WHERE date = ?`,
                ).run(JSON.stringify(teamsData), todayStr)
                teamsVersion = db.prepare(`SELECT version FROM nurse_assignments WHERE date = ?`).get(todayStr)?.version ?? null
              }
            }
          }
          try {
            afterCommit(options, () => emitScheduleSaved({
              kind: teamsVersion !== null ? 'both' : 'schedule',
              date: todayStr,
              savedBy: user ? { uid: user.id, name: user.name } : null,
              scheduleVersion: bumped?.version ?? null,
              teamsVersion,
              ts: Date.now(),
            }))
          } catch (emitErr) {
            console.warn('[eventBus] emitScheduleSaved failed:', emitErr.message)
          }
        }
      }
    }
  } catch (snapErr) {
    if (options.strict) throw snapErr
    console.warn('[patients] 當日排程快照寫入失敗（非致命）:', snapErr.message)
  }

}

export function applyPatientModeChange(db, existing, updated, user, options = {}) {
  const id = existing.id
  const wasDeleted = existing.is_deleted === 1
  const isNowDeleted = updated.is_deleted === 1
  const modifiedBy = { uid: user.id, name: user.name }
  let deletedFutureExceptions = []
  const previousMode = getDialysisMode(existing)
  const currentMode = getDialysisMode(updated)
  if (!wasDeleted && !isNowDeleted && previousMode !== currentMode) {
    recordModeHistory(db, id, existing.name, {
      fromMode: previousMode,
      toMode: currentMode,
    }, createPatientSnapshot(updated), options)

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
    }, options)

    // CVVHDF 每日洗、不排常規床（2026-09-03 使用者裁定）：改為 CVVHDF 時前端已自總表移除固定排班，
    // 這裡同步取消該病人的未來調班（比照住院轉回門診）。改回其他模式不自動處理（前端詢問恢復床位）。
    if (normalizeDialysisMode(currentMode) === 'CVVHDF') {
      deletedFutureExceptions = deletedFutureExceptions.concat(
        deleteFutureScheduleExceptionsForPatient(db, id, 'mode_changed_to_cvvhdf', modifiedBy, options),
      )
    }
  }

  // 「勿動」標記不寫工作日誌（2026-08-06 使用者裁定移除同步）；
  // kiditSync 的 KIDIT_EXCLUDED_MOVEMENT_TYPES 仍保留「勿動」，保護歷史動態不被 resync 進 KiDit

  return deletedFutureExceptions
}
