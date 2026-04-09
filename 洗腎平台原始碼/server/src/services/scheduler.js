/**
 * 定時任務調度器
 * 使用 node-cron 替代 Firebase Cloud Functions 的 onSchedule
 */

import cron from 'node-cron'
import { getDatabase } from '../db/init.js'
import { createBackup } from '../utils/backup.js'
import { initializeFutureSchedules } from './scheduleSync.js'
import { cleanupExpiredBlacklist, cleanupExpiredSessions } from '../middleware/auth.js'

// ========================================
// 工具函式
// ========================================

/**
 * 取得台北時區的今天日期字串 (YYYY-MM-DD)
 */
function getTaipeiTodayString() {
  return new Date()
    .toLocaleDateString('zh-TW', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    .replace(/\//g, '-')
}

/**
 * 取得台北時區的昨天日期字串 (YYYY-MM-DD)
 */
function getTaipeiYesterdayString() {
  const today = new Date()
  today.setDate(today.getDate() - 1)
  return today
    .toLocaleDateString('zh-TW', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    .replace(/\//g, '-')
}

/**
 * 格式化日期為 YYYY-MM-DD
 */
function formatDateToYYYYMMDD(date) {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// 頻率對應星期索引
const FREQ_MAP_TO_DAY_INDEX = {
  一三五: [0, 2, 4],
  二四六: [1, 3, 5],
  一四: [0, 3],
  二五: [1, 4],
  三六: [2, 5],
  一五: [0, 4],
  二六: [1, 5],
  每日: [0, 1, 2, 3, 4, 5],
  每周一: [0],
  每周二: [1],
  每周三: [2],
  每周四: [3],
  每周五: [4],
  每周六: [5],
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
      db.close()
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
  } finally {
    db.close()
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
      db.close()
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
      db.close()
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
          slot.archivedPatientInfo = {
            status: patient.status || 'unknown',
            mode: patient.mode || null,
            wardNumber: patient.ward_number || null,
            medicalRecordNumber: patient.medical_record_number || null,
            freq: patient.freq || null,
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
  } finally {
    db.close()
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
      db.close()
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
            // 更新病人屬性
            // 分離 DB 欄位與 JSON 欄位 (mode, freq 在 dialysis_orders 中)
            const updateFields = []
            const updateValues = []
            const jsonUpdates = {}
            let hasJsonUpdates = false

            for (const [key, value] of Object.entries(payload)) {
              if (key === 'mode' || key === 'freq') {
                jsonUpdates[key] = value
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
              const patientRow = db
                .prepare('SELECT dialysis_orders FROM patients WHERE id = ?')
                .get(patientId)
              const dialysisOrders = JSON.parse(patientRow?.dialysis_orders || '{}')

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

            console.log(`    - 成功更新 patient/${patientId} 和總表規則`)
            break

          case 'DELETE_PATIENT':
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
  } finally {
    db.close()
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
}

export default {
  startScheduler,
  checkExpiredTasks,
  scheduledInitializeFutureSchedules,
  scheduledDataBackup,
  archiveDailySchedule,
  applyScheduledPatientUpdates,
  cleanupExpiredTokensAndSessions,
}
