// 調班申請處理器
import { getDatabase } from '../db/init.js'
import { getScheduleKey } from '../utils/scheduleUtils.js'

/**
 * 格式化日期為 YYYY-MM-DD
 */
function formatDate(date) {
  const d = new Date(date)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * 處理新的調班申請
 * @param {string} exceptionId - 調班申請 ID
 * @param {object} exceptionData - 調班申請資料
 * @returns {Promise<object>} 處理結果
 */
export async function processScheduleException(exceptionId, exceptionData) {
  console.log(`🚀 [ExceptionHandler] 開始處理調班: ${exceptionId} (${exceptionData.type})`)

  const db = getDatabase()

  try {
    // 驗證狀態
    if (exceptionData.status !== 'pending') {
      console.log(`[ExceptionHandler] 調班 ${exceptionId} 狀態為 ${exceptionData.status}，跳過處理`)
      return { success: false, message: '狀態不是 pending' }
    }

    // 更新狀態為處理中
    db.prepare(`
      UPDATE schedule_exceptions
      SET status = 'processing', updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(exceptionId)

    let processedDates = []
    let conflicts = []

    // ===== 處理 MOVE 類型 =====
    if (exceptionData.type === 'MOVE') {
      const result = await handleMove(db, exceptionId, exceptionData)
      processedDates = result.processedDates
      conflicts = result.conflicts

    // ===== 處理 SUSPEND 類型 =====
    } else if (exceptionData.type === 'SUSPEND') {
      const result = await handleSuspend(db, exceptionId, exceptionData)
      processedDates = result.processedDates

    // ===== 處理 ADD_SESSION 類型 =====
    } else if (exceptionData.type === 'ADD_SESSION') {
      const result = await handleAddSession(db, exceptionId, exceptionData)
      processedDates = result.processedDates
      conflicts = result.conflicts

    // ===== 處理 SWAP 類型 =====
    } else if (exceptionData.type === 'SWAP') {
      const result = await handleSwap(db, exceptionId, exceptionData)
      processedDates = result.processedDates

    } else {
      throw new Error(`不支援的調班類型: ${exceptionData.type}`)
    }

    // 更新狀態為已套用
    db.prepare(`
      UPDATE schedule_exceptions
      SET status = 'applied',
          updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(exceptionId)

    console.log(`✅ [ExceptionHandler] 調班 ${exceptionId} 已成功套用`)
    return {
      success: true,
      processedDates,
      conflicts: conflicts.length > 0 ? conflicts : null
    }

  } catch (error) {
    console.error(`❌ [ExceptionHandler] 處理調班 ${exceptionId} 失敗:`, error)

    // 更新狀態為錯誤
    try {
      db.prepare(`
        UPDATE schedule_exceptions
        SET status = 'error',
            error_message = ?,
            updated_at = datetime('now', 'localtime')
        WHERE id = ?
      `).run(error.message, exceptionId)
    } catch (e) {
      console.error('更新錯誤狀態失敗:', e)
    }

    return { success: false, error: error.message }
  }
}

/**
 * 處理 MOVE 調班
 */
async function handleMove(db, exceptionId, data) {
  const { from, to, patientId, patientName } = data

  if (!patientId || !from?.sourceDate || !from?.bedNum || !from?.shiftCode ||
      !to?.goalDate || !to?.bedNum || !to?.shiftCode) {
    throw new Error('MOVE 調班資料不完整：缺少來源或目標資訊')
  }

  const processedDates = []
  const conflicts = []

  const sourceKey = getScheduleKey(from.bedNum, from.shiftCode)
  const targetKey = getScheduleKey(to.bedNum, to.shiftCode)

  // 取得來源排程
  const sourceScheduleRow = db.prepare(`SELECT * FROM schedules WHERE date = ?`).get(from.sourceDate)
  const sourceSchedule = sourceScheduleRow ? JSON.parse(sourceScheduleRow.schedule || '{}') : {}

  // 移除來源位置
  if (sourceSchedule[sourceKey]?.patientId === patientId) {
    delete sourceSchedule[sourceKey]
    console.log(`  └─ 移除 ${patientName} 從 ${from.sourceDate} ${sourceKey}`)

    db.prepare(`
      UPDATE schedules SET schedule = ?, updated_at = datetime('now', 'localtime')
      WHERE date = ?
    `).run(JSON.stringify(sourceSchedule), from.sourceDate)
  }
  processedDates.push(from.sourceDate)

  // 取得目標排程
  const targetScheduleRow = db.prepare(`SELECT * FROM schedules WHERE date = ?`).get(to.goalDate)
  let targetSchedule = targetScheduleRow ? JSON.parse(targetScheduleRow.schedule || '{}') : {}

  // 建立新的排班資料
  const newSlotData = {
    patientId: patientId,
    patientName: patientName,
    shiftId: to.shiftCode,
    manualNote: `(換班)`,
    exceptionId: exceptionId,
    appliedAt: new Date().toISOString(),
  }

  // 支援臨時透析模式覆寫 (如 HD→HDF)
  if (to.mode) {
    newSlotData.modeOverride = to.mode
  }

  // 檢查衝突
  if (targetSchedule[targetKey]) {
    const occupant = targetSchedule[targetKey]
    if (occupant.exceptionId) {
      throw new Error(`目標床位已被 ${occupant.patientName} 的調班佔用，請選擇其他床位`)
    }
    conflicts.push({
      date: to.goalDate,
      position: targetKey,
      occupiedBy: occupant.patientName || occupant.patientId,
    })
    newSlotData.manualNote = `(換班-覆蓋)`
  }

  targetSchedule[targetKey] = newSlotData

  // 更新或建立目標排程
  if (targetScheduleRow) {
    db.prepare(`
      UPDATE schedules SET schedule = ?, updated_at = datetime('now', 'localtime')
      WHERE date = ?
    `).run(JSON.stringify(targetSchedule), to.goalDate)
  } else {
    db.prepare(`
      INSERT INTO schedules (id, date, schedule)
      VALUES (?, ?, ?)
    `).run(to.goalDate, to.goalDate, JSON.stringify(targetSchedule))
  }

  if (from.sourceDate !== to.goalDate) {
    processedDates.push(to.goalDate)
  }

  console.log(`  └─ 新增 ${patientName} 到 ${to.goalDate} ${targetKey}`)

  return { processedDates, conflicts }
}

/**
 * 處理 SUSPEND 調班 (暫停透析)
 */
async function handleSuspend(db, exceptionId, data) {
  const { patientId, patientName, startDate, endDate } = data

  if (!patientId || !startDate || !endDate) {
    throw new Error('SUSPEND 調班資料不完整：缺少 patientId 或日期區間')
  }

  const processedDates = []
  const start = new Date(startDate)
  const end = new Date(endDate)
  let removedCount = 0

  console.log(`  └─ 暫停 ${patientName} 從 ${startDate} 到 ${endDate}`)

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = formatDate(d)
    processedDates.push(dateStr)

    const scheduleRow = db.prepare(`SELECT * FROM schedules WHERE date = ?`).get(dateStr)
    if (scheduleRow) {
      const schedule = JSON.parse(scheduleRow.schedule || '{}')
      let updateNeeded = false

      for (const key in schedule) {
        if (schedule[key].patientId === patientId) {
          delete schedule[key]
          updateNeeded = true
          removedCount++
          console.log(`    └─ 移除 ${dateStr} 的 ${key}`)
          break
        }
      }

      if (updateNeeded) {
        db.prepare(`
          UPDATE schedules SET schedule = ?, updated_at = datetime('now', 'localtime')
          WHERE date = ?
        `).run(JSON.stringify(schedule), dateStr)
      }
    }
  }

  console.log(`  └─ 完成暫停：共移除 ${removedCount} 個排班`)

  return { processedDates }
}

/**
 * 處理 ADD_SESSION 調班 (臨時加洗)
 */
async function handleAddSession(db, exceptionId, data) {
  const { to, patientId, patientName } = data

  if (!patientId || !to?.goalDate || !to?.bedNum || !to?.shiftCode) {
    throw new Error('ADD_SESSION 調班資料不完整：缺少 patientId 或目標資訊')
  }

  const targetDate = to.goalDate
  const targetKey = getScheduleKey(to.bedNum, to.shiftCode)
  const conflicts = []

  const scheduleRow = db.prepare(`SELECT * FROM schedules WHERE date = ?`).get(targetDate)
  let schedule = scheduleRow ? JSON.parse(scheduleRow.schedule || '{}') : {}

  const newSlotData = {
    patientId: patientId,
    patientName: patientName,
    shiftId: to.shiftCode,
    manualNote: `(臨時加洗)`,
    exceptionId: exceptionId,
    appliedAt: new Date().toISOString(),
  }

  // 支援臨時透析模式覆寫 (如 HD→HDF)
  if (to.mode) {
    newSlotData.modeOverride = to.mode
  }

  // 檢查衝突
  if (schedule[targetKey]) {
    const occupant = schedule[targetKey]
    if (occupant.exceptionId) {
      throw new Error(`目標床位已被 ${occupant.patientName} 的調班佔用，請選擇其他床位`)
    }
    conflicts.push({
      date: targetDate,
      position: targetKey,
      occupiedBy: occupant.patientName || occupant.patientId,
    })
    newSlotData.manualNote = `(臨時加洗-覆蓋)`
  }

  schedule[targetKey] = newSlotData

  if (scheduleRow) {
    db.prepare(`
      UPDATE schedules SET schedule = ?, updated_at = datetime('now', 'localtime')
      WHERE date = ?
    `).run(JSON.stringify(schedule), targetDate)
  } else {
    db.prepare(`
      INSERT INTO schedules (id, date, schedule)
      VALUES (?, ?, ?)
    `).run(targetDate, targetDate, JSON.stringify(schedule))
  }

  console.log(`  └─ 新增 ${patientName} 到 ${targetDate} ${targetKey}`)

  return { processedDates: [targetDate], conflicts }
}

/**
 * 處理 SWAP 調班 (交換床位)
 */
async function handleSwap(db, exceptionId, data) {
  const { date, patient1, patient2 } = data

  if (!date || !patient1?.patientId || !patient1?.fromBedNum || !patient1?.fromShiftCode ||
      !patient2?.patientId || !patient2?.fromBedNum || !patient2?.fromShiftCode) {
    throw new Error('SWAP 調班資料不完整')
  }

  const key1 = getScheduleKey(patient1.fromBedNum, patient1.fromShiftCode)
  const key2 = getScheduleKey(patient2.fromBedNum, patient2.fromShiftCode)

  const scheduleRow = db.prepare(`SELECT * FROM schedules WHERE date = ?`).get(date)
  if (!scheduleRow) {
    throw new Error(`SWAP 失敗：找不到日期 ${date} 的排班表`)
  }

  const schedule = JSON.parse(scheduleRow.schedule || '{}')

  if (schedule[key1]?.patientId !== patient1.patientId) {
    throw new Error(`SWAP 驗證失敗：${patient1.patientName} 不在預期的位置 ${key1}`)
  }
  if (schedule[key2]?.patientId !== patient2.patientId) {
    throw new Error(`SWAP 驗證失敗：${patient2.patientName} 不在預期的位置 ${key2}`)
  }

  // 交換
  const slot1Data = { ...schedule[key1] }
  const slot2Data = { ...schedule[key2] }

  schedule[key1] = {
    ...slot2Data,
    manualNote: `(與${patient1.patientName}互調)`,
    exceptionId: exceptionId,
  }
  schedule[key2] = {
    ...slot1Data,
    manualNote: `(與${patient2.patientName}互調)`,
    exceptionId: exceptionId,
  }

  db.prepare(`
    UPDATE schedules SET schedule = ?, updated_at = datetime('now', 'localtime')
    WHERE date = ?
  `).run(JSON.stringify(schedule), date)

  console.log(`  └─ 成功交換 ${patient1.patientName} (${key1}) 與 ${patient2.patientName} (${key2})`)

  return { processedDates: [date] }
}
