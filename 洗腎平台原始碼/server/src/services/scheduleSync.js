/**
 * 排程同步服務
 * 當總表 (MASTER_SCHEDULE) 更新時，同步到未來 60 天的排程
 */

import { getDatabase } from '../db/init.js'

// 頻率對應星期索引 (0=週一, 5=週六)
const FREQ_MAP_TO_DAY_INDEX = {
  '一三五': [0, 2, 4],
  '二四六': [1, 3, 5],
  '一四': [0, 3],
  '二五': [1, 4],
  '三六': [2, 5],
  '一五': [0, 4],
  '二六': [1, 5],
  '每日': [0, 1, 2, 3, 4, 5],
  '每周一': [0],
  '每周二': [1],
  '每周三': [2],
  '每周四': [3],
  '每周五': [4],
  '每周六': [5],
}

const SHIFTS = ['early', 'noon', 'late']

// 兩班頻率定義
const BIWEEKLY_FREQUENCIES = ['一四', '二五', '三六', '一五', '二六']
const FREQ_NUMBER_MAP = {
  '一四': '14',
  '二五': '25',
  '三六': '36',
  '一五': '15',
  '二六': '26',
}

/**
 * 取得台北時區的日期字串 (YYYY-MM-DD)
 */
function getTaipeiTodayString() {
  return new Date().toLocaleDateString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).replace(/\//g, '-')
}

/**
 * 根據日期取得台北時區的星期索引 (0=週一, 6=週日)
 */
function getTaipeiDayIndex(date) {
  const taipeiDateStr = date.toLocaleDateString('zh-TW', {
    timeZone: 'Asia/Taipei',
    weekday: 'short',
  })
  const dayMap = { '週一': 0, '週二': 1, '週三': 2, '週四': 3, '週五': 4, '週六': 5, '週日': 6 }
  return dayMap[taipeiDateStr] ?? date.getDay() // fallback
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

/**
 * 產生排程的 key (例如: bed-1-early)
 */
function getScheduleKey(bedNum, shiftCode) {
  const prefix = String(bedNum).startsWith('peripheral') ? '' : 'bed-'
  return `${prefix}${bedNum}-${shiftCode}`
}

/**
 * 根據病人資料產生自動備註
 */
function generateAutoNote(patient) {
  if (!patient) return ''
  const autoNotes = new Set()

  // 兩班頻率自動備註
  if (patient.freq && BIWEEKLY_FREQUENCIES.includes(patient.freq)) {
    const freqNumber = FREQ_NUMBER_MAP[patient.freq]
    if (freqNumber) autoNotes.add(freqNumber)
  }

  // 狀態標籤
  if (patient.status === 'ipd') autoNotes.add('住')
  if (patient.status === 'er') autoNotes.add('急')

  // 首透標籤
  const patientStatus = typeof patient.patient_status === 'string'
    ? JSON.parse(patient.patient_status || '{}')
    : (patient.patient_status || {})
  if (patientStatus.isFirstDialysis?.active) autoNotes.add('新')

  // 疾病標籤
  let diseases = patient.diseases
  if (typeof diseases === 'string') {
    diseases = JSON.parse(diseases || '[]')
  }
  if (Array.isArray(diseases)) {
    if (diseases.includes('HBV')) autoNotes.add('B')
    if (diseases.includes('HCV')) autoNotes.add('C')
    if (diseases.includes('HIV')) autoNotes.add('H')
    if (diseases.includes('RPR')) autoNotes.add('R')
    if (diseases.includes('隔離')) autoNotes.add('隔')
    if (diseases.includes('COVID')) autoNotes.add('冠')
    if (diseases.includes('BC肝?')) autoNotes.add('BC?')
    if (diseases.includes('C肝治癒')) autoNotes.add('C癒')
  }

  return Array.from(autoNotes).join(' ')
}

/**
 * 根據總表規則產生當日排程
 */
function generateDailyScheduleFromRules(masterRules, dateStr, patientsMap = null) {
  const dailySchedule = {}
  const targetDate = new Date(dateStr + 'T00:00:00Z')

  if (isNaN(targetDate.getTime())) {
    console.error(`[ScheduleSync] 無效的日期: ${dateStr}`)
    return {}
  }

  const dayIndex = getTaipeiDayIndex(targetDate)

  for (const patientId in masterRules) {
    const rule = masterRules[patientId]
    if (!rule || !rule.freq) continue

    const freqDays = FREQ_MAP_TO_DAY_INDEX[rule.freq] || []
    if (freqDays.includes(dayIndex)) {
      const { bedNum, shiftIndex } = rule
      if (bedNum === undefined || shiftIndex === undefined) continue

      const shiftCode = SHIFTS[shiftIndex]
      if (!shiftCode) continue

      const key = getScheduleKey(bedNum, shiftCode)

      // 動態生成 autoNote
      let autoNote = rule.autoNote || ''
      if (patientsMap) {
        const patient = patientsMap.get ? patientsMap.get(patientId) : patientsMap[patientId]
        if (patient) {
          autoNote = generateAutoNote(patient)
        }
      }

      dailySchedule[key] = {
        patientId: patientId,
        patientName: rule.patientName || '',
        shiftId: shiftCode,
        autoNote: autoNote,
        manualNote: rule.manualNote || '',
        baseRuleId: patientId,
      }
    }
  }
  return dailySchedule
}

/**
 * 同步總表變更到未來排程
 * @param {Object} beforeRules - 變更前的總表規則
 * @param {Object} afterRules - 變更後的總表規則
 * @param {Object} modifiedBy - 修改者資訊 {uid, name}
 * @returns {Object} 同步結果
 */
export async function syncMasterScheduleToFuture(beforeRules, afterRules, modifiedBy = {}) {
  console.log('🚀 [ScheduleSync] 開始同步總表到未來 60 天排程...')

  // 如果規則沒有實質變更，跳過同步
  if (JSON.stringify(beforeRules) === JSON.stringify(afterRules)) {
    console.log('✅ [ScheduleSync] 總表無實質變更，跳過同步')
    return { success: true, message: '無需同步', updatedCount: 0 }
  }

  const db = getDatabase()

  try {
    // 載入所有病人資料用於動態生成 autoNote
    const patients = db.prepare(`
      SELECT * FROM patients WHERE is_deleted = 0
    `).all()

    const patientsMap = new Map()
    patients.forEach(p => {
      patientsMap.set(p.id, p)
    })
    console.log(`  [ScheduleSync] 已載入 ${patientsMap.size} 位病人資料`)

    // 計算從明天起的 60 天日期
    const todayStr = getTaipeiTodayString()
    const futureDates = Array.from({ length: 60 }, (_, i) => {
      const futureDate = new Date(todayStr + 'T00:00:00Z')
      futureDate.setUTCDate(futureDate.getUTCDate() + i + 1) // i+1 確保從明天開始
      return formatDateToYYYYMMDD(futureDate)
    })

    console.log(`  [ScheduleSync] 同步範圍: ${futureDates[0]} ~ ${futureDates[59]}`)

    // 取得現有排程
    const existingSchedules = new Map()
    const placeholders = futureDates.map(() => '?').join(',')
    const existingRows = db.prepare(`
      SELECT id, date, schedule FROM schedules WHERE date IN (${placeholders})
    `).all(...futureDates)

    existingRows.forEach(row => {
      existingSchedules.set(row.date, JSON.parse(row.schedule || '{}'))
    })
    console.log(`  [ScheduleSync] 找到 ${existingSchedules.size} 份現有排程`)

    // 計算所有受影響的病人
    const allPatientIds = new Set([...Object.keys(beforeRules), ...Object.keys(afterRules)])
    let updatedCount = 0
    let createdCount = 0

    // 處理每一天
    for (const dateStr of futureDates) {
      const targetDate = new Date(dateStr + 'T00:00:00Z')
      const dayIndex = getTaipeiDayIndex(targetDate)

      // 如果該日期的排程不存在，創建新的
      if (!existingSchedules.has(dateStr)) {
        const newSchedule = generateDailyScheduleFromRules(afterRules, dateStr, patientsMap)

        db.prepare(`
          INSERT INTO schedules (id, date, schedule, sync_method, last_modified_by, created_at, updated_at)
          VALUES (?, ?, ?, 'sync_from_master', ?, datetime('now', 'localtime'), datetime('now', 'localtime'))
        `).run(
          dateStr,
          dateStr,
          JSON.stringify(newSchedule),
          JSON.stringify(modifiedBy)
        )
        createdCount++
        continue
      }

      // 計算需要更新的內容
      const currentSchedule = existingSchedules.get(dateStr)
      const updates = {}
      let hasChanges = false

      allPatientIds.forEach(patientId => {
        const ruleBefore = beforeRules[patientId]
        const ruleAfter = afterRules[patientId]

        const wasScheduled = ruleBefore && (FREQ_MAP_TO_DAY_INDEX[ruleBefore.freq] || []).includes(dayIndex)
        const isScheduled = ruleAfter && (FREQ_MAP_TO_DAY_INDEX[ruleAfter.freq] || []).includes(dayIndex)

        // 產生新的 slot 物件
        const createSlotObject = (rule) => {
          if (!rule) return null
          const shiftCode = SHIFTS[rule.shiftIndex]
          if (!shiftCode) return null

          const patient = patientsMap.get(patientId)
          const dynamicAutoNote = patient ? generateAutoNote(patient) : (rule.autoNote || '')

          return {
            patientId: patientId,
            patientName: rule.patientName || '',
            shiftId: shiftCode,
            autoNote: dynamicAutoNote,
            manualNote: rule.manualNote || '',
            baseRuleId: patientId,
          }
        }

        if (wasScheduled && !isScheduled) {
          // 病人被移除
          const oldShiftCode = SHIFTS[ruleBefore.shiftIndex]
          if (ruleBefore.bedNum !== undefined && oldShiftCode) {
            const oldKey = getScheduleKey(ruleBefore.bedNum, oldShiftCode)
            if (currentSchedule[oldKey]?.patientId === patientId) {
              delete currentSchedule[oldKey]
              hasChanges = true
            }
          }
        } else if (!wasScheduled && isScheduled) {
          // 新增病人
          const newSlot = createSlotObject(ruleAfter)
          if (newSlot && ruleAfter.bedNum !== undefined) {
            const newKey = getScheduleKey(ruleAfter.bedNum, newSlot.shiftId)
            currentSchedule[newKey] = newSlot
            hasChanges = true
          }
        } else if (wasScheduled && isScheduled) {
          // 病人位置或設定變更
          const oldShiftCode = SHIFTS[ruleBefore.shiftIndex]
          const newSlot = createSlotObject(ruleAfter)

          if (newSlot && ruleBefore.bedNum !== undefined && oldShiftCode && ruleAfter.bedNum !== undefined) {
            const oldKey = getScheduleKey(ruleBefore.bedNum, oldShiftCode)
            const newKey = getScheduleKey(ruleAfter.bedNum, newSlot.shiftId)

            if (oldKey !== newKey) {
              // 床位或班別變更，需要移除舊的
              if (currentSchedule[oldKey]?.patientId === patientId) {
                delete currentSchedule[oldKey]
              }
            }
            currentSchedule[newKey] = newSlot
            hasChanges = true
          }
        }
      })

      if (hasChanges) {
        db.prepare(`
          UPDATE schedules
          SET schedule = ?,
              sync_method = 'sync_from_master',
              last_modified_by = ?,
              updated_at = datetime('now', 'localtime')
          WHERE date = ?
        `).run(
          JSON.stringify(currentSchedule),
          JSON.stringify(modifiedBy),
          dateStr
        )
        updatedCount++
      }
    }

    db.close()

    console.log(`✅ [ScheduleSync] 第一階段同步完成！創建 ${createdCount} 份，更新 ${updatedCount} 份排程`)

    // 🔥 第二階段：整合現有的調班申請到受影響的日期
    console.log('🔄 [ScheduleSync] 第二階段：開始整合調班申請...')
    const mergeResult = await mergeExceptionsIntoSchedules(afterRules, futureDates, patientsMap, modifiedBy)

    return {
      success: true,
      message: `同步完成：創建 ${createdCount} 份，更新 ${updatedCount} 份排程，整合 ${mergeResult.mergedCount} 天調班`,
      createdCount,
      updatedCount,
      mergedCount: mergeResult.mergedCount,
    }

  } catch (error) {
    console.error('❌ [ScheduleSync] 同步失敗:', error)
    db.close()
    throw error
  }
}

/**
 * 初始化未來 60 天的排程（用於首次設定或重建）
 */
export async function initializeFutureSchedules(modifiedBy = {}) {
  console.log('🔄 [ScheduleSync] 初始化未來 60 天排程...')

  const db = getDatabase()

  try {
    // 取得總表規則
    const masterDoc = db.prepare(`
      SELECT schedule FROM base_schedules WHERE id = 'MASTER_SCHEDULE'
    `).get()

    const masterRules = masterDoc ? JSON.parse(masterDoc.schedule || '{}') : {}

    // 載入病人資料
    const patients = db.prepare(`
      SELECT * FROM patients WHERE is_deleted = 0
    `).all()

    const patientsMap = new Map()
    patients.forEach(p => patientsMap.set(p.id, p))

    // 計算日期範圍
    const todayStr = getTaipeiTodayString()
    const datesToCheck = Array.from({ length: 60 }, (_, i) => {
      const targetDate = new Date(todayStr + 'T00:00:00Z')
      targetDate.setUTCDate(targetDate.getUTCDate() + i)
      return formatDateToYYYYMMDD(targetDate)
    })

    // 取得已存在的排程日期
    const placeholders = datesToCheck.map(() => '?').join(',')
    const existingRows = db.prepare(`
      SELECT date FROM schedules WHERE date IN (${placeholders})
    `).all(...datesToCheck)

    const existingDates = new Set(existingRows.map(r => r.date))

    // 創建缺少的排程
    let createdCount = 0
    for (const dateStr of datesToCheck) {
      if (!existingDates.has(dateStr)) {
        const dailySchedule = generateDailyScheduleFromRules(masterRules, dateStr, patientsMap)

        db.prepare(`
          INSERT INTO schedules (id, date, schedule, sync_method, last_modified_by, created_at, updated_at)
          VALUES (?, ?, ?, 'initialize_future', ?, datetime('now', 'localtime'), datetime('now', 'localtime'))
        `).run(
          dateStr,
          dateStr,
          JSON.stringify(dailySchedule),
          JSON.stringify(modifiedBy)
        )
        createdCount++
      }
    }

    db.close()

    console.log(`✅ [ScheduleSync] 初始化完成！創建 ${createdCount} 份排程`)

    return {
      success: true,
      message: `初始化完成：創建 ${createdCount} 份排程`,
      createdCount,
    }

  } catch (error) {
    console.error('❌ [ScheduleSync] 初始化失敗:', error)
    db.close()
    throw error
  }
}

// ===================================================================
// 調班整合功能
// ===================================================================

/**
 * 將單一調班申請應用到排程物件上
 * @param {object} schedule - 正在被修改的排程物件
 * @param {object} ex - 調班申請資料
 * @param {string} dateStr - 處理的目標日期
 * @returns {boolean} - 如果發生衝突返回 true
 */
function applySingleException(schedule, ex, dateStr) {
  try {
    switch (ex.type) {
      case 'MOVE':
      case 'ADD_SESSION': {
        const targetDate = ex.to?.goalDate
        if (targetDate !== dateStr) {
          // MOVE 類型需要處理「來源」在今天的情況
          if (ex.type === 'MOVE' && ex.from?.sourceDate === dateStr) {
            const sourceKey = getScheduleKey(ex.from.bedNum, ex.from.shiftCode)
            if (schedule[sourceKey]?.patientId === ex.patientId) {
              delete schedule[sourceKey]
            }
          }
          return false
        }

        const targetKey = getScheduleKey(ex.to.bedNum, ex.to.shiftCode)

        // 目標床位已被佔用（且不是自己）視為衝突
        if (schedule[targetKey] && schedule[targetKey].patientId !== ex.patientId) {
          console.log(`[Engine] 衝突！調班 ${ex.id} 的目標床位 ${targetKey} 已被佔據`)
          return true
        }

        // 正常執行操作
        if (ex.type === 'MOVE' && ex.from?.sourceDate === dateStr) {
          const sourceKey = getScheduleKey(ex.from.bedNum, ex.from.shiftCode)
          if (schedule[sourceKey]?.patientId === ex.patientId) {
            delete schedule[sourceKey]
          }
        }

        schedule[targetKey] = {
          patientId: ex.patientId,
          patientName: ex.patientName,
          exceptionId: ex.id,
          manualNote: ex.type === 'MOVE' ? '(換班)' : '(臨時加洗)',
        }
        return false
      }

      case 'SWAP': {
        if (ex.date === dateStr) {
          const key1 = getScheduleKey(ex.patient1.fromBedNum, ex.patient1.fromShiftCode)
          const key2 = getScheduleKey(ex.patient2.fromBedNum, ex.patient2.fromShiftCode)

          const slot1Data = schedule[key1]
            ? { ...schedule[key1] }
            : { patientId: ex.patient1.patientId, patientName: ex.patient1.patientName }
          const slot2Data = schedule[key2]
            ? { ...schedule[key2] }
            : { patientId: ex.patient2.patientId, patientName: ex.patient2.patientName }

          schedule[key1] = {
            ...slot2Data,
            exceptionId: ex.id,
            manualNote: `(與${ex.patient1.patientName}互調)`,
          }
          schedule[key2] = {
            ...slot1Data,
            exceptionId: ex.id,
            manualNote: `(與${ex.patient2.patientName}互調)`,
          }
        }
        return false
      }

      case 'SUSPEND': {
        const start = new Date(ex.startDate + 'T00:00:00Z')
        const end = new Date(ex.endDate + 'T00:00:00Z')
        const current = new Date(dateStr + 'T00:00:00Z')
        if (current >= start && current <= end) {
          Object.keys(schedule).forEach((key) => {
            if (schedule[key].patientId === ex.patientId) {
              delete schedule[key]
            }
          })
        }
        return false
      }
    }
  } catch (error) {
    console.error(`[Engine] 套用調班 ${ex.id} 時錯誤:`, error)
  }
  return false
}

/**
 * 重新計算某一天的排程（含調班整合）
 * @param {string} dateStr - 目標日期
 * @param {object} masterRules - 總表規則
 * @param {Array} todaysExceptions - 當天的調班列表
 * @param {Map} patientsMap - 病人資料
 * @returns {object} - { finalSchedule, conflictingExceptions }
 */
function recalculateDailySchedule(dateStr, masterRules, todaysExceptions, patientsMap = null) {
  let finalSchedule = generateDailyScheduleFromRules(masterRules, dateStr, patientsMap)
  const conflictingExceptions = []

  for (const ex of todaysExceptions) {
    const hasConflict = applySingleException(finalSchedule, ex, dateStr)
    if (hasConflict) {
      conflictingExceptions.push(ex)
    }
  }

  return { finalSchedule, conflictingExceptions }
}

/**
 * 重建單一天的排程（含調班整合）
 * @param {string} dateStr - 目標日期
 * @param {object} masterRules - 總表規則
 * @param {Map} patientsMap - 病人資料
 * @param {object} db - 資料庫連線
 * @returns {object} - 最終排程
 */
function rebuildSingleDaySchedule(dateStr, masterRules, patientsMap, db) {
  // 取得所有已生效的調班申請
  const allExceptions = db.prepare(`
    SELECT * FROM schedule_exceptions
    WHERE status IN ('applied', 'conflict_requires_resolution')
  `).all()

  const todaysExceptions = []
  allExceptions.forEach((row) => {
    const ex = {
      id: row.id,
      type: row.type,
      status: row.status,
      patientId: row.patient_id,
      patientName: row.patient_name,
      from: JSON.parse(row.from_data || '{}'),
      to: JSON.parse(row.to_data || '{}'),
      patient1: JSON.parse(row.patient1 || '{}'),
      patient2: JSON.parse(row.patient2 || '{}'),
      startDate: row.start_date,
      endDate: row.end_date,
      date: row.date,
      createdAt: row.created_at,
    }

    // 判斷此調班是否影響這一天
    if (ex.type === 'SUSPEND' && ex.startDate && ex.endDate) {
      const start = new Date(ex.startDate + 'T00:00:00Z')
      const end = new Date(ex.endDate + 'T00:00:00Z')
      const current = new Date(dateStr + 'T00:00:00Z')
      if (current >= start && current <= end) todaysExceptions.push(ex)
    } else {
      const exDates = [ex.date, ex.startDate, ex.from?.sourceDate, ex.to?.goalDate].filter(Boolean)
      if (exDates.includes(dateStr)) todaysExceptions.push(ex)
    }
  })

  // 按創建時間排序
  todaysExceptions.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))

  // 計算最終排程
  const { finalSchedule, conflictingExceptions } = recalculateDailySchedule(
    dateStr,
    masterRules,
    todaysExceptions,
    patientsMap
  )

  // 標記衝突的調班
  if (conflictingExceptions.length > 0) {
    const updateStmt = db.prepare(`
      UPDATE schedule_exceptions
      SET status = 'conflict_requires_resolution',
          error_message = '系統重建排程時發現目標床位已被佔用，請重新安排。',
          updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `)

    conflictingExceptions.forEach((ex) => {
      console.log(`[Engine] 將調班 ${ex.id} 標記為衝突`)
      updateStmt.run(ex.id)
    })
  }

  return finalSchedule
}

/**
 * 整合調班申請到受影響的日期
 * @param {object} masterRules - 總表規則
 * @param {Array<string>} futureDates - 未來日期列表
 * @param {Map} patientsMap - 病人資料
 * @param {object} modifiedBy - 修改者資訊
 * @returns {object} - 合併結果
 */
export async function mergeExceptionsIntoSchedules(masterRules, futureDates, patientsMap, modifiedBy = {}) {
  console.log('🔄 [ScheduleSync] 開始整合調班申請...')

  const db = getDatabase()

  try {
    // 取得所有已生效的調班申請
    const allExceptions = db.prepare(`
      SELECT * FROM schedule_exceptions
      WHERE status IN ('applied', 'conflict_requires_resolution')
    `).all()

    if (allExceptions.length === 0) {
      console.log('✅ [ScheduleSync] 沒有需要整合的調班申請')
      db.close()
      return { success: true, mergedCount: 0 }
    }

    // 計算哪些日期需要重新整合
    const datesToMerge = new Set()
    const tomorrowStr = futureDates[0] // 明天的日期

    allExceptions.forEach((row) => {
      const ex = {
        type: row.type,
        startDate: row.start_date,
        endDate: row.end_date,
        date: row.date,
        from: JSON.parse(row.from_data || '{}'),
        to: JSON.parse(row.to_data || '{}'),
      }

      if (ex.type === 'SUSPEND' && ex.startDate && ex.endDate) {
        // 暫停類型：區間內的每一天
        const start = new Date(ex.startDate + 'T00:00:00Z')
        const end = new Date(ex.endDate + 'T00:00:00Z')
        futureDates.forEach((dateStr) => {
          const current = new Date(dateStr + 'T00:00:00Z')
          if (current >= start && current <= end) {
            datesToMerge.add(dateStr)
          }
        })
      } else {
        // 其他類型：相關日期
        const relevantDates = [ex.date, ex.startDate, ex.from?.sourceDate, ex.to?.goalDate].filter(Boolean)
        relevantDates.forEach((d) => {
          if (futureDates.includes(d) && d >= tomorrowStr) {
            datesToMerge.add(d)
          }
        })
      }
    })

    if (datesToMerge.size === 0) {
      console.log('✅ [ScheduleSync] 沒有需要重新整合的日期')
      db.close()
      return { success: true, mergedCount: 0 }
    }

    console.log(`📅 [ScheduleSync] 需要重新整合 ${datesToMerge.size} 個日期的排程`)

    // 對每個需要整合的日期重新計算排程
    let mergedCount = 0
    for (const dateStr of datesToMerge) {
      const finalSchedule = rebuildSingleDaySchedule(dateStr, masterRules, patientsMap, db)

      db.prepare(`
        UPDATE schedules
        SET schedule = ?,
            sync_method = 'merge_exceptions',
            last_modified_by = ?,
            updated_at = datetime('now', 'localtime')
        WHERE date = ?
      `).run(
        JSON.stringify(finalSchedule),
        JSON.stringify(modifiedBy),
        dateStr
      )
      mergedCount++
    }

    db.close()
    console.log(`✅ [ScheduleSync] 整合完成！已重新整合 ${mergedCount} 天的調班申請`)

    return { success: true, mergedCount }

  } catch (error) {
    console.error('❌ [ScheduleSync] 整合調班申請失敗:', error)
    db.close()
    throw error
  }
}

// 導出用於自動生成排程的輔助函數
export { generateDailyScheduleFromRules, generateAutoNote }

export default {
  syncMasterScheduleToFuture,
  initializeFutureSchedules,
  mergeExceptionsIntoSchedules,
  generateDailyScheduleFromRules,
  generateAutoNote,
}
