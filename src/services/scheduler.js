/**
 * 定時任務調度器
 * 使用 node-cron 替代 Firebase Cloud Functions 的 onSchedule
 */

import cron from 'node-cron'
import { getDatabase } from '../db/init.js'
import { createBackup } from '../utils/backup.js'
import { initializeFutureSchedules, syncMasterScheduleToFuture } from './scheduleSync.js'
import { cleanupExpiredBlacklist, cleanupExpiredSessions } from '../middleware/auth.js'
import { getTaipeiTodayString, getTaipeiYesterdayString, formatDateToYYYYMMDD } from '../utils/dateUtils.js'
import { FREQ_MAP_TO_DAY_INDEX } from '../utils/scheduleUtils.js'
import { normalizeDialysisMode } from '../utils/dialysisMode.js'
import { addAutoMovementToDailyLog } from './dailyLogMovementSync.js'
import { recordPatientHistory, createPatientSnapshot } from './patientHistory.js'
import { hourlyNurseAssignmentSnapshot } from './nurseAssignmentRevisions.js'

// 狀態碼中文對照（與 routes/patients.js 一致）
const SCHED_STATUS_MAP = { opd: '門診', ipd: '住院', er: '急診' }

function parseDialysisMode(dialysisOrdersStr) {
  try {
    return JSON.parse(dialysisOrdersStr || '{}').mode || null
  } catch {
    return null
  }
}

/**
 * 預約變更生效時，比照即時操作同步「身分變更」到工作日誌 / KiDit / 病人歷史。
 * before/after 為變更前後的病人資料列 (snake_case)。
 */
function syncScheduledStatusChange(db, dateStr, before, after, payload, taskId) {
  if (payload.status === undefined) return
  const fromStatus = before.status
  const toStatus = after.status
  if (!toStatus || fromStatus === toStatus) return

  if (fromStatus === 'opd' && (toStatus === 'ipd' || toStatus === 'er')) {
    recordPatientHistory(db, before.id, before.name, 'TRANSFER',
      { fromStatus, toStatus, reason: payload.inpatientReason || '' }, createPatientSnapshot(after))
    addAutoMovementToDailyLog(db, dateStr, {
      id: `auto_scheduled_transfer_in_${taskId}`,
      type: '轉移', name: before.name, patientId: before.id,
      medicalRecordNumber: before.medical_record_number,
      ...(toStatus === 'ipd' ? { admissionDate: dateStr } : {}),
      physician: after.physician || '', reason: payload.inpatientReason || '',
      remarks: `從「${SCHED_STATUS_MAP[fromStatus]}」轉入「${SCHED_STATUS_MAP[toStatus]}」（預約變更）`,
    })
  } else if ((fromStatus === 'ipd' || fromStatus === 'er') && toStatus === 'opd') {
    recordPatientHistory(db, before.id, before.name, 'TRANSFER',
      { fromStatus, toStatus }, createPatientSnapshot(after))
    addAutoMovementToDailyLog(db, dateStr, {
      id: `auto_scheduled_transfer_out_${taskId}`,
      type: '轉移', name: before.name, patientId: before.id,
      medicalRecordNumber: before.medical_record_number,
      dischargeDate: dateStr, physician: after.physician || '', reason: '',
      remarks: `從「${SCHED_STATUS_MAP[fromStatus]}」轉回「${SCHED_STATUS_MAP[toStatus]}」（預約變更）`,
    })
  } else {
    recordPatientHistory(db, before.id, before.name, 'STATUS_CHANGE',
      { fromStatus, toStatus }, createPatientSnapshot(after))
    if (toStatus === 'ipd' || toStatus === 'opd') {
      addAutoMovementToDailyLog(db, dateStr, {
        id: `auto_scheduled_transfer_${taskId}`,
        type: '轉移', name: before.name, patientId: before.id,
        medicalRecordNumber: before.medical_record_number,
        ...(toStatus === 'ipd' ? { admissionDate: dateStr } : {}),
        ...(toStatus === 'opd' ? { dischargeDate: dateStr } : {}),
        physician: after.physician || '', reason: payload.inpatientReason || '',
        remarks: toStatus === 'ipd'
          ? `從「${SCHED_STATUS_MAP[fromStatus] || fromStatus}」轉入「${SCHED_STATUS_MAP[toStatus] || toStatus}」（預約變更）`
          : `從「${SCHED_STATUS_MAP[fromStatus] || fromStatus}」轉回「${SCHED_STATUS_MAP[toStatus] || toStatus}」（預約變更）`,
      })
    }
  }
}

/**
 * 預約變更生效時，同步「透析模式變更」到工作日誌與病人歷史。
 * 注意：「更改模式」動態由 kiditSync 過濾，不會進 KiDit 申報。
 */
function syncScheduledModeChange(db, dateStr, before, after, payload, taskId) {
  if (payload.mode === undefined) return
  const prevMode = parseDialysisMode(before.dialysis_orders)
  const curMode = parseDialysisMode(after.dialysis_orders)
  if (prevMode === curMode) return

  recordPatientHistory(db, before.id, before.name, 'MODE_CHANGE',
    { fromMode: prevMode, toMode: curMode }, createPatientSnapshot(after))
  addAutoMovementToDailyLog(db, dateStr, {
    id: `auto_scheduled_mode_${taskId}`,
    type: '更改模式', name: after.name, patientId: before.id,
    medicalRecordNumber: after.medical_record_number,
    wardNumber: after.ward_number || '', physician: after.physician || '', reason: '',
    remarks: `透析模式由「${prevMode || '未設定'}」改為「${curMode || '未設定'}」（預約變更）`,
  })
}

// ========================================
// 定時任務：檢查過期任務
// 每日凌晨 02:00 執行
// ========================================

async function checkExpiredTasks() {
  console.log('[Scheduler] 🔍 執行每日過期任務檢查...')
  const todayStr = getTaipeiTodayString()

  const db = getDatabase()

  try {
    // 查詢過期的待處理任務（category = message 且 targetDate < 今天）
    const expiredTasks = db
      .prepare(
        `
      SELECT id, type FROM tasks
      WHERE status = 'pending'
        AND category = 'message'
        AND target_date < ?
    `,
      )
      .all(todayStr)

    if (expiredTasks.length === 0) {
      console.log('[Scheduler] ✅ 沒有過期的任務需要處理')
      return
    }

    let expiredCount = 0

    for (const task of expiredTasks) {
      // 跳過衛教類型的任務
      if (task.type === '衛教') {
        console.log(`[Scheduler] ⏭️ 跳過任務 ${task.id}，因為是「衛教」類型`)
        continue
      }

      db.prepare(
        `
        UPDATE tasks
        SET status = 'expired', updated_at = datetime('now', 'localtime')
        WHERE id = ?
      `,
      ).run(task.id)
      expiredCount++
    }

    console.log(`[Scheduler] ✅ 已將 ${expiredCount} 個任務標記為過期`)
  } catch (error) {
    console.error('[Scheduler] ❌ 檢查過期任務失敗:', error)
  }
}

// ========================================
// 定時任務：初始化未來排程
// 每日凌晨 03:00 執行
// ========================================

async function scheduledInitializeFutureSchedules() {
  console.log('[Scheduler] 📅 執行每日未來排程初始化...')

  try {
    const result = await initializeFutureSchedules({ uid: 'system', name: 'System Scheduler' })
    console.log(`[Scheduler] ✅ ${result.message}`)
  } catch (error) {
    console.error('[Scheduler] ❌ 初始化未來排程失敗:', error)
  }
}

// ========================================
// 定時任務：每日資料備份
// 每日晚上 23:30 執行
// ========================================

async function scheduledDataBackup() {
  console.log('[Scheduler] 💾 執行每日資料備份...')

  try {
    const backupFile = await createBackup('auto')
    console.log(`[Scheduler] ✅ 備份完成: ${backupFile}`)
  } catch (error) {
    console.error('[Scheduler] ❌ 資料備份失敗:', error)
  }
}

// ========================================
// 定時任務：清理過期 Token 和 Session
// 每 6 小時執行
// ========================================

async function cleanupExpiredTokensAndSessions() {
  console.log('[Scheduler] 🧹 執行過期 Token 和 Session 清理...')

  try {
    cleanupExpiredBlacklist()
    cleanupExpiredSessions()
    console.log('[Scheduler] ✅ Token 和 Session 清理完成')
  } catch (error) {
    console.error('[Scheduler] ❌ 清理失敗:', error)
  }
}

// ========================================
// 定時任務：每日排程歸檔
// 每日凌晨 00:05 執行
// ========================================

async function archiveDailySchedule() {
  const dateStr = getTaipeiYesterdayString()
  console.log(`[Scheduler] 📁 歸檔昨日排程: ${dateStr}`)

  const db = getDatabase()

  try {
    // 檢查來源排程是否存在
    const sourceSchedule = db
      .prepare(
        `
      SELECT * FROM schedules WHERE date = ?
    `,
      )
      .get(dateStr)

    if (!sourceSchedule) {
      console.log(`[Scheduler] ⚠️ 日期 ${dateStr} 的排程不存在，無需歸檔`)
      return
    }

    // 檢查是否已經歸檔
    const existingArchive = db
      .prepare(
        `
      SELECT id FROM archived_schedules WHERE date = ?
    `,
      )
      .get(dateStr)

    if (existingArchive) {
      console.log(`[Scheduler] ⚠️ 日期 ${dateStr} 已有歸檔，刪除原始排程`)
      db.prepare(`DELETE FROM schedules WHERE date = ?`).run(dateStr)
      return
    }

    const scheduleData = JSON.parse(sourceSchedule.schedule || '{}')

    // 收集所有病人 ID
    const patientIds = [
      ...new Set(
        Object.values(scheduleData)
          .map((slot) => slot.patientId)
          .filter(Boolean),
      ),
    ]

    console.log(`[Scheduler] 🔍 找到 ${patientIds.length} 位病人，處理歸檔資料...`)

    // 查詢病人資料
    const patientsMap = new Map()
    if (patientIds.length > 0) {
      const placeholders = patientIds.map(() => '?').join(',')
      const patients = db
        .prepare(
          `
        SELECT * FROM patients WHERE id IN (${placeholders})
      `,
        )
        .all(...patientIds)

      patients.forEach((p) => patientsMap.set(p.id, p))
    }

    // 為每個排程項目添加病人快照
    let missingCount = 0
    for (const shiftId in scheduleData) {
      const slot = scheduleData[shiftId]
      if (slot?.patientId) {
        const patient = patientsMap.get(slot.patientId)
        if (patient) {
          const dialysisOrders = JSON.parse(patient.dialysis_orders || '{}')
          slot.archivedPatientInfo = {
            status: patient.status || 'unknown',
            mode: dialysisOrders.mode || null,
            wardNumber: patient.ward_number || null,
            medicalRecordNumber: patient.medical_record_number || null,
            freq: dialysisOrders.freq || null,
          }
        } else {
          missingCount++
          slot.archivedPatientInfo = {
            status: 'deleted',
            mode: 'N/A',
            wardNumber: null,
            medicalRecordNumber: null,
            name: slot.patientName || '未知 (已刪除)',
            note: 'Patient data not found during archival',
          }
        }
      }
    }

    if (missingCount > 0) {
      console.log(`[Scheduler] ⚠️ 有 ${missingCount} 位病人資料找不到`)
    }

    // 插入歸檔資料
    db.prepare(
      `
      INSERT INTO archived_schedules (
        id, date, schedule, last_modified_by,
        archived_at, archive_method, patient_count, missing_patient_count,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, datetime('now', 'localtime'), 'daily_scheduled', ?, ?, ?, ?)
    `,
    ).run(
      dateStr,
      dateStr,
      JSON.stringify(scheduleData),
      sourceSchedule.last_modified_by || '{}',
      patientIds.length,
      missingCount,
      sourceSchedule.created_at,
      sourceSchedule.updated_at,
    )

    // 刪除原始排程
    db.prepare(`DELETE FROM schedules WHERE date = ?`).run(dateStr)

    console.log(`[Scheduler] ✅ 成功歸檔並刪除原始排程 ${dateStr}`)
  } catch (error) {
    console.error(`[Scheduler] ❌ 歸檔排程 ${dateStr} 失敗:`, error)
  }

  expireStaleConflicts()
}

// ========================================
// 過期衝突自動失效
// 影響日期整個已過的衝突旗已無法就地處理（過去日不再重算、自動收回永不觸發），
// 不清理會永遠掛在調班管理頁。隨每日歸檔任務執行。
// ========================================

export function expireStaleConflicts() {
  const db = getDatabase()
  const todayStr = getTaipeiTodayString()
  try {
    const result = db.prepare(`
      UPDATE schedule_exceptions
      SET status = 'expired',
          updated_at = datetime('now', 'localtime')
      WHERE status = 'conflict_requires_resolution'
        AND MAX(
          COALESCE(end_date, ''),
          COALESCE(date, ''),
          COALESCE(json_extract(from_data, '$.sourceDate'), ''),
          COALESCE(json_extract(to_data, '$.goalDate'), '')
        ) != ''
        AND MAX(
          COALESCE(end_date, ''),
          COALESCE(date, ''),
          COALESCE(json_extract(from_data, '$.sourceDate'), ''),
          COALESCE(json_extract(to_data, '$.goalDate'), '')
        ) < ?
    `).run(todayStr)
    if (result.changes > 0) {
      console.log(`[Scheduler] ⏳ 已將 ${result.changes} 筆過期衝突調班標記為 expired`)
    }
  } catch (error) {
    console.error('[Scheduler] 過期衝突清理失敗:', error)
  }
}

// ========================================
// 定時任務：應用預約病人更新
// 每日凌晨 01:00 執行
// ========================================

async function applyScheduledPatientUpdates() {
  const todayStr = getTaipeiTodayString()
  console.log(`[Scheduler] 🔄 執行 ${todayStr} 的預約病人變更...`)

  const db = getDatabase()

  try {
    // 查詢今天待處理的預約變更
    const pendingUpdates = db
      .prepare(
        `
      SELECT * FROM scheduled_patient_updates
      WHERE effective_date = ? AND status = 'pending'
    `,
      )
      .all(todayStr)

    if (pendingUpdates.length === 0) {
      console.log('[Scheduler] ✅ 今天沒有待處理的預約變更')
      return
    }

    console.log(`[Scheduler] 找到 ${pendingUpdates.length} 個待處理的預約`)

    // 頻率衝突檢測函式
    const hasFrequencyConflict = (freq1, freq2) => {
      if (!freq1 || !freq2) return false
      const days1 = FREQ_MAP_TO_DAY_INDEX[freq1] || []
      const days2 = FREQ_MAP_TO_DAY_INDEX[freq2] || []
      return days1.some((day) => days2.includes(day))
    }

    for (const updateTask of pendingUpdates) {
      const taskId = updateTask.id
      const patientId = updateTask.patient_id
      const changeType = updateTask.change_type
      const payload = JSON.parse(updateTask.change_data || '{}')

      console.log(`  - 處理任務 ${taskId} for patient ${patientId} (${changeType})...`)

      try {
        switch (changeType) {
          case 'UPDATE_STATUS':
          case 'UPDATE_MODE':
            // 內容為空則明確失敗（避免像空 change_data 一樣假成功、實際沒改）
            if (changeType === 'UPDATE_STATUS' && !payload.status) {
              throw new Error('UPDATE_STATUS 缺少目標 status（change_data 為空）')
            }
            if (changeType === 'UPDATE_MODE' && !payload.mode) {
              throw new Error('UPDATE_MODE 缺少 mode（change_data 為空）')
            }
            // 欄位白名單：payload 的 key 會轉成 UPDATE 的欄位名，不能放行任意 key
            {
              const allowedKeys =
                changeType === 'UPDATE_STATUS'
                  ? new Set(['status', 'wardNumber'])
                  : new Set(['mode'])
              const unknownKeys = Object.keys(payload).filter((k) => !allowedKeys.has(k))
              if (unknownKeys.length > 0) {
                throw new Error(`${changeType} 含未允許的欄位: ${unknownKeys.join(', ')}`)
              }
            }
            // 更新病人屬性
            // 分離 DB 欄位與 JSON 欄位 (mode, freq 在 dialysis_orders 中)
            // 先擷取變更前的病人資料，供工作日誌/歷史比對
            const beforePatient = db
              .prepare('SELECT * FROM patients WHERE id = ?')
              .get(patientId)

            const updateFields = []
            const updateValues = []
            const jsonUpdates = {}
            let hasJsonUpdates = false

            for (const [key, value] of Object.entries(payload)) {
              if (key === 'mode' || key === 'freq') {
                jsonUpdates[key] = key === 'mode' ? normalizeDialysisMode(value) : value
                hasJsonUpdates = true
              } else {
                // 將 camelCase 轉為 snake_case
                const snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
                updateFields.push(`${snakeKey} = ?`)
                updateValues.push(value)
              }
            }

            // 如果有 JSON 更新，需要先讀取目前的 dialysis_orders
            if (hasJsonUpdates) {
              const dialysisOrders = JSON.parse(beforePatient?.dialysis_orders || '{}')

              Object.assign(dialysisOrders, jsonUpdates)

              updateFields.push('dialysis_orders = ?')
              updateValues.push(JSON.stringify(dialysisOrders))
            }

            if (updateFields.length > 0) {
              updateValues.push(patientId)
              db.prepare(
                `
                UPDATE patients
                SET ${updateFields.join(', ')}, updated_at = datetime('now', 'localtime')
                WHERE id = ?
              `,
              ).run(...updateValues)
              console.log(`    - 成功更新 patient/${patientId} 的屬性`)
            }

            // 同步工作日誌 / KiDit / 病人歷史（比照即時操作；非致命）
            try {
              if (beforePatient) {
                const afterPatient = db
                  .prepare('SELECT * FROM patients WHERE id = ?')
                  .get(patientId)
                syncScheduledStatusChange(db, todayStr, beforePatient, afterPatient, payload, taskId)
                syncScheduledModeChange(db, todayStr, beforePatient, afterPatient, payload, taskId)
              }
            } catch (syncErr) {
              console.error(`    - ⚠️ 工作日誌同步失敗 (非致命): ${syncErr.message}`)
            }
            break

          case 'UPDATE_FREQ':
            if (!payload.freq) {
              throw new Error("Payload for UPDATE_FREQ is missing 'freq'")
            }

            // 讀取目前的 dialysis_orders
            const freqPatientRow = db
              .prepare('SELECT dialysis_orders FROM patients WHERE id = ?')
              .get(patientId)
            const freqDialysisOrders = JSON.parse(freqPatientRow?.dialysis_orders || '{}')
            freqDialysisOrders.freq = payload.freq

            db.prepare(
              `
              UPDATE patients
              SET dialysis_orders = ?, updated_at = datetime('now', 'localtime')
              WHERE id = ?
            `,
            ).run(JSON.stringify(freqDialysisOrders), patientId)
            console.log(`    - 成功更新 patient/${patientId} 的頻率為 ${payload.freq}`)
            break

          case 'UPDATE_BASE_SCHEDULE_RULE':
            const { bedNum, shiftIndex, freq } = payload
            if (bedNum === undefined || shiftIndex === undefined || !freq) {
              throw new Error('Payload for UPDATE_BASE_SCHEDULE_RULE is incomplete')
            }

            // 取得總表
            const masterDoc = db
              .prepare(
                `
              SELECT schedule FROM base_schedules WHERE id = 'MASTER_SCHEDULE'
            `,
              )
              .get()

            if (!masterDoc) {
              throw new Error('MASTER_SCHEDULE not found')
            }

            const schedule = JSON.parse(masterDoc.schedule || '{}')
            // 變更前規則快照（獨立 parse 取得深拷貝，供未來排程同步 diff 用）
            const beforeMasterRules = JSON.parse(masterDoc.schedule || '{}')

            // 檢查床位衝突
            for (const otherPatientId in schedule) {
              if (otherPatientId === patientId) continue
              const otherRule = schedule[otherPatientId]
              if (
                otherRule.bedNum === bedNum &&
                otherRule.shiftIndex === shiftIndex &&
                hasFrequencyConflict(freq, otherRule.freq)
              ) {
                const otherPatientName = otherRule.patientName || `ID:${otherPatientId}`
                throw new Error(
                  `床位衝突：目標位置已被 ${otherPatientName} (${otherRule.freq}) 佔用`,
                )
              }
            }

            // 更新病人資料 (dialysis_orders.freq, bed_number, schedule_rule)
            const baseRulePatientRow = db
              .prepare('SELECT dialysis_orders, schedule_rule FROM patients WHERE id = ?')
              .get(patientId)

            const baseRuleDialysisOrders = JSON.parse(baseRulePatientRow?.dialysis_orders || '{}')
            baseRuleDialysisOrders.freq = freq

            // 同步 schedule_rule
            const newScheduleRule = {
              bedNum,
              shiftIndex,
              freq,
            }

            db.prepare(
              `
              UPDATE patients
              SET dialysis_orders = ?, 
                  bed_number = ?,
                  schedule_rule = ?,
                  updated_at = datetime('now', 'localtime')
              WHERE id = ?
            `,
            ).run(
              JSON.stringify(baseRuleDialysisOrders),
              bedNum,
              JSON.stringify(newScheduleRule),
              patientId,
            )

            // 更新總表規則
            const existingRule = schedule[patientId] || {}
            schedule[patientId] = {
              ...existingRule,
              bedNum,
              shiftIndex,
              freq,
              patientName: updateTask.patient_name || existingRule.patientName,
            }

            db.prepare(
              `
              UPDATE base_schedules
              SET schedule = ?, updated_at = datetime('now', 'localtime')
              WHERE id = 'MASTER_SCHEDULE'
            `,
            ).run(JSON.stringify(schedule))

            // 同步變更到未來 60 天既有排程（與總表 PUT 路徑 schedules.js 一致，
            // 否則既有排程列仍顯示舊床位/班別）
            try {
              await syncMasterScheduleToFuture(beforeMasterRules, schedule, {
                uid: 'system-scheduler',
                name: '預約變更自動套用',
              })
              console.log(`    - 已同步總表變更到未來 60 天排程`)
            } catch (syncErr) {
              console.error(`    - ⚠️ 未來排程同步失敗 (非致命): ${syncErr.message}`)
            }

            console.log(`    - 成功更新 patient/${patientId} 和總表規則`)
            break

          case 'DELETE_PATIENT':
            // 擷取刪除前的病人資料（供工作日誌/歷史；刪除後 status 會變成 'deleted'）
            const beforeDeletePatient = db
              .prepare('SELECT * FROM patients WHERE id = ?')
              .get(patientId)

            // 軟刪除病人
            db.prepare(
              `
              UPDATE patients
              SET is_deleted = 1,
                  original_status = status,
                  status = 'deleted',
                  delete_reason = ?,
                  notes = ?,
                  deleted_at = datetime('now', 'localtime'),
                  updated_at = datetime('now', 'localtime')
              WHERE id = ?
            `,
            ).run(payload.deleteReason || '預約刪除', payload.remarks || '', patientId)

            // 同步工作日誌 / KiDit / 病人歷史（比照即時刪除；非致命）
            try {
              if (beforeDeletePatient) {
                recordPatientHistory(db, patientId, beforeDeletePatient.name, 'DELETE',
                  { reason: payload.deleteReason || '預約刪除', fromStatus: beforeDeletePatient.status },
                  createPatientSnapshot(beforeDeletePatient))
                addAutoMovementToDailyLog(db, todayStr, {
                  id: `auto_scheduled_delete_${taskId}`,
                  type: '刪除', name: beforeDeletePatient.name, patientId,
                  medicalRecordNumber: beforeDeletePatient.medical_record_number,
                  dischargeDate: todayStr, physician: beforeDeletePatient.physician || '',
                  reason: payload.deleteReason || '',
                  remarks: payload.deleteReason
                    ? `從「${SCHED_STATUS_MAP[beforeDeletePatient.status] || beforeDeletePatient.status}」刪除；原因：${payload.deleteReason}（預約變更）`
                    : `從「${SCHED_STATUS_MAP[beforeDeletePatient.status] || beforeDeletePatient.status}」刪除（預約變更）`,
                })
              }
            } catch (syncErr) {
              console.error(`    - ⚠️ 工作日誌同步失敗 (非致命): ${syncErr.message}`)
            }

            // 從總表移除
            const masterDocForDelete = db
              .prepare(
                `
              SELECT schedule FROM base_schedules WHERE id = 'MASTER_SCHEDULE'
            `,
              )
              .get()

            if (masterDocForDelete) {
              const scheduleForDelete = JSON.parse(masterDocForDelete.schedule || '{}')
              delete scheduleForDelete[patientId]

              db.prepare(
                `
                UPDATE base_schedules
                SET schedule = ?, updated_at = datetime('now', 'localtime')
                WHERE id = 'MASTER_SCHEDULE'
              `,
              ).run(JSON.stringify(scheduleForDelete))
            }

            // 清理未來 60 天排程中該病人的項目
            console.log(`    - 開始清理 ${patientId} 的排程...`)
            let cleanupCount = 0

            for (let i = 0; i <= 60; i++) {
              const targetDate = new Date(todayStr + 'T00:00:00Z')
              targetDate.setUTCDate(targetDate.getUTCDate() + i)
              const dateStr = formatDateToYYYYMMDD(targetDate)

              const scheduleDoc = db
                .prepare(
                  `
                SELECT schedule FROM schedules WHERE date = ?
              `,
                )
                .get(dateStr)

              if (scheduleDoc) {
                const dailySchedule = JSON.parse(scheduleDoc.schedule || '{}')
                let needsUpdate = false

                for (const key in dailySchedule) {
                  if (dailySchedule[key].patientId === patientId) {
                    delete dailySchedule[key]
                    needsUpdate = true
                    cleanupCount++
                  }
                }

                if (needsUpdate) {
                  db.prepare(
                    `
                    UPDATE schedules
                    SET schedule = ?, updated_at = datetime('now', 'localtime')
                    WHERE date = ?
                  `,
                  ).run(JSON.stringify(dailySchedule), dateStr)
                }
              }
            }
            console.log(`    - 共清理了 ${cleanupCount} 個排程項目`)

            // 清理護理師分組
            console.log(`    - 開始清理 ${patientId} 的護理師分組...`)
            let assignmentCount = 0

            const assignments = db
              .prepare(
                `
              SELECT id, date, teams FROM nurse_assignments WHERE date > ?
            `,
              )
              .all(todayStr)

            for (const assignment of assignments) {
              const teamsData = JSON.parse(assignment.teams || '{}')
              let needsUpdate = false

              for (const teamKey in teamsData) {
                if (teamKey.startsWith(patientId + '-')) {
                  delete teamsData[teamKey]
                  needsUpdate = true
                  assignmentCount++
                }
              }

              if (needsUpdate) {
                db.prepare(
                  `
                  UPDATE nurse_assignments
                  SET teams = ?, updated_at = datetime('now', 'localtime')
                  WHERE id = ?
                `,
                ).run(JSON.stringify(teamsData), assignment.id)
              }
            }
            console.log(`    - 共清理了 ${assignmentCount} 個護理分組`)

            // 取消該病人的未來調班申請
            console.log(`    - 開始取消 ${patientId} 的調班申請...`)
            const cancelResult = db
              .prepare(
                `
              UPDATE schedule_exceptions
              SET status = 'cancelled',
                  cancel_reason = '病人已刪除',
                  cancelled_at = datetime('now', 'localtime')
              WHERE patient_id = ?
                AND status IN ('pending', 'applied', 'processing', 'conflict_requires_resolution')
            `,
              )
              .run(patientId)
            console.log(`    - 取消了 ${cancelResult.changes} 個調班申請`)

            console.log(`    - 成功將 patient/${patientId} 標記為刪除並完成所有清理`)
            break

          case 'RESTORE_PATIENT':
            // 復原病人
            db.prepare(
              `
              UPDATE patients
              SET is_deleted = 0,
                  status = ?,
                  ward_number = ?,
                  deleted_at = NULL,
                  updated_at = datetime('now', 'localtime')
              WHERE id = ?
            `,
            ).run(payload.status, payload.wardNumber || null, patientId)
            console.log(`    - 成功復原 patient/${patientId} 為 ${payload.status}`)

            // 同步工作日誌 / KiDit / 病人歷史（比照即時復原；非致命）
            try {
              const afterRestorePatient = db
                .prepare('SELECT * FROM patients WHERE id = ?')
                .get(patientId)
              if (afterRestorePatient) {
                const restoreStatus = payload.status || afterRestorePatient.status
                recordPatientHistory(db, patientId, afterRestorePatient.name, 'RESTORE_AND_TRANSFER',
                  { restoredTo: restoreStatus }, createPatientSnapshot(afterRestorePatient))
                addAutoMovementToDailyLog(db, todayStr, {
                  id: `auto_scheduled_restore_${taskId}`,
                  type: '復原', name: afterRestorePatient.name, patientId,
                  medicalRecordNumber: afterRestorePatient.medical_record_number,
                  ...(restoreStatus === 'ipd' ? { admissionDate: todayStr } : {}),
                  physician: afterRestorePatient.physician || '', reason: '',
                  remarks: `復原至「${SCHED_STATUS_MAP[restoreStatus] || restoreStatus}」（預約變更）`,
                })
              }
            } catch (syncErr) {
              console.error(`    - ⚠️ 工作日誌同步失敗 (非致命): ${syncErr.message}`)
            }
            break

          default:
            console.log(`    - ⚠️ 未知的變更類型: ${changeType}`)
        }

        // 標記任務為已處理
        db.prepare(
          `
          UPDATE scheduled_patient_updates
          SET status = 'processed', processed_at = datetime('now', 'localtime')
          WHERE id = ?
        `,
        ).run(taskId)
      } catch (taskError) {
        console.error(`    - ❌ 處理任務 ${taskId} 失敗:`, taskError.message)

        // 標記任務為失敗
        db.prepare(
          `
          UPDATE scheduled_patient_updates
          SET status = 'failed', error_message = ?
          WHERE id = ?
        `,
        ).run(taskError.message, taskId)
      }
    }

    console.log('[Scheduler] ✅ 預約變更處理完成')
  } catch (error) {
    console.error('[Scheduler] ❌ 應用預約變更失敗:', error)
  }
}

// ========================================
// 定時任務：清理過期 notifications / tasks
// 每日凌晨 02:30 執行（效能批次 2A）
// notifications：created_at 早於 90 天整批刪除
// tasks：deleted/expired 依「轉為終態時間」(updated_at) 早於 90 天刪除；
//        completed 依「完成時間」(completed_at，缺值時退回 updated_at/created_at) 早於 180 天刪除
//        （比照收件匣顯示規則 completed 保留 90 天，180 天為加倍保守）；pending 永不刪除
// ========================================

async function cleanupOldNotificationsAndTasks() {
  console.log('[Scheduler] 🧹 執行 notifications/tasks 資料清理...')
  const db = getDatabase()

  try {
    const runCleanup = db.transaction(() => {
      const notifResult = db
        .prepare(
          `DELETE FROM notifications WHERE created_at < datetime('now', 'localtime', '-90 days')`,
        )
        .run()

      const deletedTasksResult = db
        .prepare(
          `DELETE FROM tasks WHERE status = 'deleted' AND updated_at < datetime('now', 'localtime', '-90 days')`,
        )
        .run()

      const expiredTasksResult = db
        .prepare(
          `DELETE FROM tasks WHERE status = 'expired' AND updated_at < datetime('now', 'localtime', '-90 days')`,
        )
        .run()

      const completedTasksResult = db
        .prepare(
          `DELETE FROM tasks WHERE status = 'completed' AND COALESCE(completed_at, updated_at, created_at) < datetime('now', 'localtime', '-180 days')`,
        )
        .run()

      return {
        notifications: notifResult.changes,
        deletedTasks: deletedTasksResult.changes,
        expiredTasks: expiredTasksResult.changes,
        completedTasks: completedTasksResult.changes,
      }
    })

    const result = runCleanup()
    console.log(`[Scheduler] ✅ 清理完成：notifications ${result.notifications} 筆、tasks(deleted) ${result.deletedTasks} 筆、tasks(expired) ${result.expiredTasks} 筆、tasks(completed) ${result.completedTasks} 筆`)
  } catch (error) {
    console.error('[Scheduler] ❌ notifications/tasks 清理失敗:', error)
  }
}

// ========================================
// 啟動所有定時任務
// ========================================

export function startScheduler() {
  console.log('\n========================================')
  console.log('  啟動定時任務調度器')
  console.log('========================================')

  // 每日凌晨 00:05 - 歸檔昨日排程
  cron.schedule('5 0 * * *', archiveDailySchedule, {
    timezone: 'Asia/Taipei',
  })
  console.log('📅 [Scheduler] 每日排程歸檔 - 00:05 (Asia/Taipei)')

  // 每日凌晨 01:00 - 應用預約病人更新
  cron.schedule('0 1 * * *', applyScheduledPatientUpdates, {
    timezone: 'Asia/Taipei',
  })
  console.log('📅 [Scheduler] 預約病人更新 - 01:00 (Asia/Taipei)')

  // 每日凌晨 02:00 - 檢查過期任務
  cron.schedule('0 2 * * *', checkExpiredTasks, {
    timezone: 'Asia/Taipei',
  })
  console.log('📅 [Scheduler] 過期任務檢查 - 02:00 (Asia/Taipei)')

  // 每日凌晨 02:30 - 清理過期 notifications / tasks
  cron.schedule('30 2 * * *', cleanupOldNotificationsAndTasks, {
    timezone: 'Asia/Taipei',
  })
  console.log('📅 [Scheduler] notifications/tasks 清理 - 02:30 (Asia/Taipei)')

  // 每日凌晨 03:00 - 初始化未來排程
  cron.schedule('0 3 * * *', scheduledInitializeFutureSchedules, {
    timezone: 'Asia/Taipei',
  })
  console.log('📅 [Scheduler] 未來排程初始化 - 03:00 (Asia/Taipei)')

  // 每日晚上 23:30 - 資料備份
  cron.schedule('30 23 * * *', scheduledDataBackup, {
    timezone: 'Asia/Taipei',
  })
  console.log('📅 [Scheduler] 資料備份 - 23:30 (Asia/Taipei)')

  // 每 6 小時 - 清理過期的黑名單和 Session
  cron.schedule('0 */6 * * *', cleanupExpiredTokensAndSessions, {
    timezone: 'Asia/Taipei',
  })
  console.log('📅 [Scheduler] Token/Session 清理 - 每 6 小時 (Asia/Taipei)')

  // 每小時整點 - 護理分組歷史快照 (異常快速復原用)
  cron.schedule('0 * * * *', () => hourlyNurseAssignmentSnapshot(getDatabase()), {
    timezone: 'Asia/Taipei',
  })
  console.log('📅 [Scheduler] 護理分組快照 - 每小時整點 (Asia/Taipei)')

  console.log('========================================\n')
}

// 導出單獨的任務函式供手動調用
export {
  checkExpiredTasks,
  scheduledInitializeFutureSchedules,
  scheduledDataBackup,
  archiveDailySchedule,
  applyScheduledPatientUpdates,
  cleanupExpiredTokensAndSessions,
  cleanupOldNotificationsAndTasks,
}

export default {
  startScheduler,
  checkExpiredTasks,
  scheduledInitializeFutureSchedules,
  scheduledDataBackup,
  archiveDailySchedule,
  applyScheduledPatientUpdates,
  cleanupExpiredTokensAndSessions,
  cleanupOldNotificationsAndTasks,
}
