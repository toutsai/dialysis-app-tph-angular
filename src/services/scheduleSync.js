/**
 * 排程同步服務
 * 當總表 (MASTER_SCHEDULE) 更新時，同步到未來 60 天的排程
 */

import { getDatabase } from '../db/init.js'
import { getTaipeiTodayString, getTaipeiDayIndex, formatDateToYYYYMMDD } from '../utils/dateUtils.js'
import { FREQ_MAP_TO_DAY_INDEX, SHIFTS, getScheduleKey } from '../utils/scheduleUtils.js'

// 兩班頻率定義
const BIWEEKLY_FREQUENCIES = ['一四', '二五', '三六', '一五', '二六']
const FREQ_NUMBER_MAP = {
  '一四': '14',
  '二五': '25',
  '三六': '36',
  '一五': '15',
  '二六': '26',
}

import { infectionAbbrFromTags, isolationAbbrFromTags, CURED_TAG } from '../utils/hepatitis.js'

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
    // 傳染病縮寫 B/C/H/R、待追蹤 B?/C?/H?/R?（規則在 utils/hepatitis.js，與前端 scheduleUtils 同源）
    for (const abbr of infectionAbbrFromTags(diseases)) autoNotes.add(abbr)
    if (diseases.includes(CURED_TAG)) autoNotes.add('C癒')
    // 其他隔離疾病：冠/疥/MDR/隔
    for (const abbr of isolationAbbrFromTags(diseases)) autoNotes.add(abbr)
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

            // createSlotObject 產生的是全新物件，接送方式（住院趴趴走）要從舊 slot 跟人帶走
            const prevSlot =
              currentSchedule[oldKey]?.patientId === patientId
                ? currentSchedule[oldKey]
                : currentSchedule[newKey]?.patientId === patientId
                  ? currentSchedule[newKey]
                  : null
            if (prevSlot?.transportMethod) {
              newSlot.transportMethod = prevSlot.transportMethod
            }

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

        // 防禦性清掃：總表同步產生的格（帶 baseRuleId）每人每天只該有一格，
        // 且必須在目前規則的位置上。若過去某次規則變更沒同步到未來排程
        // （如 2026-07-14 前的預約變更 cron 漏同步），舊位置會留下 diff 引擎
        // 再也看不見的孤兒格，這裡一併移除。帶 exceptionId 的格（調班產生，
        // SWAP 重建時會連 baseRuleId 一起帶過來）一律不碰，交給第二階段調班整合。
        let keepKey = null
        let canSweep = true
        if (isScheduled) {
          const afterShiftCode = SHIFTS[ruleAfter.shiftIndex]
          if (afterShiftCode && ruleAfter.bedNum !== undefined) {
            keepKey = getScheduleKey(ruleAfter.bedNum, afterShiftCode)
          } else {
            canSweep = false // 規則不完整、無法確定正確位置時不清掃
          }
        }
        if (canSweep) {
          for (const [key, slot] of Object.entries(currentSchedule)) {
            if (key !== keepKey && slot?.patientId === patientId && slot?.baseRuleId === patientId && !slot?.exceptionId) {
              delete currentSchedule[key]
              hasChanges = true
            }
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

    console.log(`✅ [ScheduleSync] 初始化完成！創建 ${createdCount} 份排程`)

    return {
      success: true,
      message: `初始化完成：創建 ${createdCount} 份排程`,
      createdCount,
    }

  } catch (error) {
    console.error('❌ [ScheduleSync] 初始化失敗:', error)
    throw error
  }
}

// ===================================================================
// 調班整合功能
// ===================================================================

/**
 * 將床位 / 班別組成方便閱讀的字串（給錯誤訊息用）
 */
function formatSlotLabel(bedNum, shiftCode) {
  if (bedNum === undefined || bedNum === null) return '未知床位'
  const bedStr = String(bedNum)
  const bedLabel = bedStr.startsWith('peripheral-') ? `外圍 ${bedStr.split('-')[1]}` : `${bedStr} 床`
  const shiftLabelMap = { early: '早班', noon: '午班', late: '晚班' }
  const shiftLabel = shiftLabelMap[shiftCode] || shiftCode || ''
  return shiftLabel ? `${bedLabel} ${shiftLabel}` : bedLabel
}

/** 將排程 key（bed-1-early / peripheral-1-noon）拆回 [bedNum, shiftCode] */
function keyToBedShift(key) {
  const parts = String(key).split('-')
  const shiftCode = parts.pop()
  const bedPart = parts.join('-')
  const bedNum = bedPart.startsWith('bed-') ? bedPart.slice(4) : bedPart
  return [bedNum, shiftCode]
}

/**
 * 將單一調班申請應用到排程物件上
 * @param {object} schedule - 正在被修改的排程物件
 * @param {object} ex - 調班申請資料
 * @param {string} dateStr - 處理的目標日期
 * @returns {'ok'|{ reason: string }} - 套用結果
 *   - 'ok'              : 成功套用或無需動作
 *   - { reason: '...' } : 套用失敗，外層應將例外標 conflict_requires_resolution 並寫入 reason
 */
function applySingleException(schedule, ex, dateStr) {
  try {
    switch (ex.type) {
      case 'MOVE':
      case 'ADD_SESSION': {
        const targetDate = ex.to?.goalDate
        const isMove = ex.type === 'MOVE'
        const sourceMatchesDay = isMove && ex.from?.sourceDate === dateStr
        const sourceKey = sourceMatchesDay
          ? getScheduleKey(ex.from.bedNum, ex.from.shiftCode)
          : null

        // 來源驗證：MOVE 來源日上若該床位已不再是這位病人，視為衝突
        // （通常是總表事後把此病人床位改了，原 from 快照已過期）
        // 改寫成可由使用者二選一解決的訊息：①維持新常規床位 ②維持調班後床位
        if (sourceMatchesDay && schedule[sourceKey]?.patientId !== ex.patientId) {
          const newBaseKey = Object.keys(schedule).find(
            (k) => schedule[k]?.patientId === ex.patientId,
          )
          const newBaseLabel = newBaseKey
            ? formatSlotLabel(...keyToBedShift(newBaseKey))
            : '當日未排'
          const targetLabel = formatSlotLabel(ex.to.bedNum, ex.to.shiftCode)
          // 病人當日已無常規位（住院/急診常見）時，「維持常規」實際上=把病人整天移出排程，
          // 必須在訊息裡明講後果，避免操作者誤以為只是回到某張床（2026-07-23 陳慕正案）
          const reason = newBaseKey
            ? `因床位總表修正後，${ex.patientName} 已不在原床位（現為常規 ${newBaseLabel}）。` +
              `請選擇：①維持新常規床位 ${newBaseLabel}　②維持調班後 ${targetLabel}。`
            : `因床位總表修正後，${ex.patientName} 已不在原床位，且當日已無常規排班。` +
              `請選擇：①維持新常規（＝撤銷調班，${ex.patientName} 當日將完全不在排程上）　②維持調班後 ${targetLabel}。`
          console.log(`[Engine] 例外 ${ex.id} 來源失效：${reason}`)
          return { reason }
        }

        if (targetDate !== dateStr) {
          // 處理只命中來源日的情況
          if (sourceMatchesDay) delete schedule[sourceKey]
          return 'ok'
        }

        const targetKey = getScheduleKey(ex.to.bedNum, ex.to.shiftCode)

        // 目標床位已被佔用（且不是自己）視為衝突；沒有 patientId 的空殼格不算佔用
        if (schedule[targetKey]?.patientId && schedule[targetKey].patientId !== ex.patientId) {
          const targetLabel = formatSlotLabel(ex.to.bedNum, ex.to.shiftCode)
          const occupantName = schedule[targetKey]?.patientName || '其他病人'
          const reason = `目標床位 ${targetLabel} 已被 ${occupantName} 佔用，請重新安排床位。`
          console.log(`[Engine] 衝突！調班 ${ex.id}：${reason}`)
          return { reason }
        }

        // 正常執行操作
        if (sourceMatchesDay) delete schedule[sourceKey]

        // 與 exceptionHandler 建立的格保持同樣欄位：shiftId 與 modeOverride 都要帶，
        // 否則總表同步/整日重建後「臨時加洗」的特殊透析模式（PP/DFPP/SLED/Lipid…）會消失，
        // 護理分組就不再顯示特殊模式標籤（2026-09-04 修）。
        const rebuiltSlot = {
          patientId: ex.patientId,
          patientName: ex.patientName,
          shiftId: ex.to.shiftCode,
          exceptionId: ex.id,
          manualNote: isMove ? '(換班)' : '(臨時加洗)',
        }
        const overrideMode = ex.to?.mode || ex.mode
        if (overrideMode) rebuiltSlot.modeOverride = overrideMode
        schedule[targetKey] = rebuiltSlot
        return 'ok'
      }

      case 'SWAP': {
        if (ex.date !== dateStr) return 'ok'

        const key1 = getScheduleKey(ex.patient1.fromBedNum, ex.patient1.fromShiftCode)
        const key2 = getScheduleKey(ex.patient2.fromBedNum, ex.patient2.fromShiftCode)

        // 嚴格驗證：兩邊位置必須真的是預期的病人才能交換，不再偽造 slot
        const slot1MismatchName = schedule[key1]?.patientName
        const slot2MismatchName = schedule[key2]?.patientName
        const slot1OK = schedule[key1]?.patientId === ex.patient1.patientId
        const slot2OK = schedule[key2]?.patientId === ex.patient2.patientId

        if (!slot1OK || !slot2OK) {
          const reasons = []
          if (!slot1OK) {
            const label = formatSlotLabel(ex.patient1.fromBedNum, ex.patient1.fromShiftCode)
            const actualText = slot1MismatchName ? `目前為 ${slot1MismatchName}` : '目前為空'
            reasons.push(`${label} 應為 ${ex.patient1.patientName}（${actualText}）`)
          }
          if (!slot2OK) {
            const label = formatSlotLabel(ex.patient2.fromBedNum, ex.patient2.fromShiftCode)
            const actualText = slot2MismatchName ? `目前為 ${slot2MismatchName}` : '目前為空'
            reasons.push(`${label} 應為 ${ex.patient2.patientName}（${actualText}）`)
          }
          const reason = `互調來源不符（${reasons.join('；')}），無法執行交換故取消。`
          console.log(`[Engine] SWAP ${ex.id} 來源驗證失敗：${reason}`)
          return { reason }
        }

        const slot1Data = { ...schedule[key1] }
        const slot2Data = { ...schedule[key2] }

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
        return 'ok'
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
        return 'ok'
      }
    }
  } catch (error) {
    console.error(`[Engine] 套用調班 ${ex.id} 時錯誤:`, error)
  }
  return 'ok'
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

  // 多輪收斂重播：連環讓位（甲讓床給乙、乙再讓給丙）若只按建立順序單輪重播，
  // 讓位者還沒重播到就會誤判「目標床被佔」，一筆誤判整串連鎖。
  // 失敗的調班留到下一輪重試（失敗路徑不動 schedule，重試安全），
  // 直到一輪內沒有任何新成功；此時仍失敗的才是真衝突。
  let pending = todaysExceptions
  while (pending.length > 0) {
    const failed = []
    for (const ex of pending) {
      const result = applySingleException(finalSchedule, ex, dateStr)
      if (result !== 'ok') {
        failed.push({ ex, reason: result.reason })
      }
    }
    if (failed.length === pending.length) {
      return { finalSchedule, conflictingExceptions: failed }
    }
    pending = failed.map(({ ex }) => ex)
  }

  return { finalSchedule, conflictingExceptions: [] }
}

/**
 * 此調班是否「只影響本日」——用來安全地把衝突已解除的調班收回 applied。
 * 跨日 MOVE（源/目標不同日）與 SUSPEND（多日區間）排除：它們在其他日可能仍衝突，
 * 單日重算成功不足以斷定整筆已無衝突。
 */
function exceptionAffectsOnlyDay(ex, dateStr) {
  if (ex.type === 'MOVE') return ex.from?.sourceDate === dateStr && ex.to?.goalDate === dateStr
  if (ex.type === 'ADD_SESSION') return ex.to?.goalDate === dateStr
  if (ex.type === 'SWAP') return ex.date === dateStr
  return false
}

/** 此調班在 dateStr 這天涉及哪些班別（判斷「是否只碰已開始班次」用） */
function exceptionShiftsOnDate(ex, dateStr) {
  const shifts = new Set()
  if (ex.type === 'SWAP') {
    if (ex.date === dateStr) {
      if (ex.patient1?.fromShiftCode) shifts.add(ex.patient1.fromShiftCode)
      if (ex.patient2?.fromShiftCode) shifts.add(ex.patient2.fromShiftCode)
    }
  } else {
    if (ex.from?.sourceDate === dateStr && ex.from?.shiftCode) shifts.add(ex.from.shiftCode)
    if (ex.to?.goalDate === dateStr && ex.to?.shiftCode) shifts.add(ex.to.shiftCode)
  }
  return [...shifts]
}

/**
 * 重建單一天的排程（含調班整合）
 * @param {string} dateStr - 目標日期
 * @param {object} masterRules - 總表規則
 * @param {Map} patientsMap - 病人資料
 * @returns {object} - 最終排程
 */
function rebuildSingleDaySchedule(dateStr, masterRules, patientsMap) {
  const db = getDatabase()
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

  // 重建是從總表憑空重生 slots，不帶 transportMethod（住院趴趴走接送方式），
  // 未來日期已登記的接送方式會被總表異動觸發的重建洗掉，這裡從舊排程貼回
  preserveTransportMethods(db, dateStr, finalSchedule)

  // 標記衝突的調班（含目標床位被佔、來源床位已不再是該病人 等等）
  if (conflictingExceptions.length > 0) {
    const conflictStmt = db.prepare(`
      UPDATE schedule_exceptions
      SET status = 'conflict_requires_resolution',
          error_message = ?,
          updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `)
    const expireStmt = db.prepare(`
      UPDATE schedule_exceptions
      SET status = 'expired',
          error_message = ?,
          updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `)

    // 只影響「今天已開始班次」的衝突不再要求人工解決：那些班次已凍結（排程以現場為準），
    // 解決了也不會改變任何事，衝突徽章只會誤導組長回頭處理已發生的事（2026-07-23 案），
    // 直接比照過期衝突標 expired。跨日調班不適用（其他日期可能仍需處理）。
    const startedSet = new Set(getStartedShiftsForToday(dateStr))

    conflictingExceptions.forEach(({ ex, reason }) => {
      const shifts = exceptionShiftsOnDate(ex, dateStr)
      const onlyStartedShifts =
        startedSet.size > 0 &&
        exceptionAffectsOnlyDay(ex, dateStr) &&
        shifts.length > 0 &&
        shifts.every((s) => startedSet.has(s))

      if (onlyStartedShifts) {
        console.log(`[Engine] 調班 ${ex.id} 衝突僅涉已開始班次，標記為 expired：${reason}`)
        expireStmt.run(`${reason || '系統重建排程時發現衝突。'}（該班次已開始，衝突自動失效，排程以現場實際狀況為準）`, ex.id)
      } else {
        console.log(`[Engine] 將調班 ${ex.id} 標記為衝突：${reason}`)
        conflictStmt.run(reason || '系統重建排程時發現衝突，請重新安排。', ex.id)
      }
    })
  }

  // 反向收回：先前被標衝突、但本次重算已能乾淨套用的「單日」調班 → 改回 applied、清錯誤。
  // 引擎原為單向閂鎖（只標衝突、衝突自動解除後不收回），會殘留「人已在新床卻仍顯示衝突」的殭屍旗。
  // 僅限「只影響本日」的調班（exceptionAffectsOnlyDay），跨日/暫停不在此自動收回。
  const conflictIds = new Set(conflictingExceptions.map(({ ex }) => ex.id))
  const resolvedExceptions = todaysExceptions.filter(
    (ex) =>
      ex.status === 'conflict_requires_resolution' &&
      !conflictIds.has(ex.id) &&
      exceptionAffectsOnlyDay(ex, dateStr),
  )
  if (resolvedExceptions.length > 0) {
    const resolveStmt = db.prepare(`
      UPDATE schedule_exceptions
      SET status = 'applied', error_message = NULL,
          updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `)
    resolvedExceptions.forEach((ex) => {
      console.log(`[Engine] 調班 ${ex.id} 衝突已解除，重算成功，收回為 applied`)
      resolveStmt.run(ex.id)
    })
  }

  return finalSchedule
}

/**
 * 把某日既有排程各 slot 的 transportMethod（住院趴趴走接送方式）貼回重建後的排程。
 * 依 patientId 跟人走：換床/換班後仍保留（一天一人一筆接送方式）。
 */
function preserveTransportMethods(db, dateStr, newSchedule) {
  const row = db.prepare(`SELECT schedule FROM schedules WHERE date = ?`).get(dateStr)
  if (!row?.schedule) return
  let oldSchedule
  try {
    oldSchedule = JSON.parse(row.schedule)
  } catch {
    return
  }
  const transportByPatientId = new Map()
  for (const key in oldSchedule) {
    const slot = oldSchedule[key]
    if (slot?.patientId && slot.transportMethod) {
      transportByPatientId.set(slot.patientId, slot.transportMethod)
    }
  }
  if (transportByPatientId.size === 0) return
  for (const key in newSchedule) {
    const slot = newSchedule[key]
    if (!slot?.patientId) continue
    const method = transportByPatientId.get(slot.patientId)
    if (method) slot.transportMethod = method
  }
}

// ── 今天「已開始」班次凍結 ──────────────────────────────────────────────
// 班別開始時間（台北時間，分）。取偏早的保守界線（實際上機前就凍結）：
// 寧可讓今天已開始的班次改由現場組長於排程頁手動調整，也不可讓整天重算
// 改寫已發生的事實。noon/late 對齊 dashboardDataService 的當前班別切換點
// （12:00/17:00）再提前一小時當緩衝，early 取 06:00。
const SHIFT_START_MINUTES = { early: 6 * 60, noon: 11 * 60, late: 16 * 60 }

function getTaipeiNowMinutes() {
  const hm = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date())
  const [h, m] = hm.split(':').map(Number)
  return h * 60 + m
}

/** 回傳 dateStr 當天「已開始」的班別；dateStr 非今天一律回空陣列 */
export function getStartedShiftsForToday(dateStr) {
  if (dateStr !== getTaipeiTodayString()) return []
  const now = getTaipeiNowMinutes()
  return SHIFTS.filter(
    (shift) => SHIFT_START_MINUTES[shift] !== undefined && now >= SHIFT_START_MINUTES[shift],
  )
}

/**
 * 今日排程整天凍結（2026-07-24 拍板）：早班起算時間（06:00）之後，今天的排程檔
 * 不得被任何「整天重算」寫回——今天是現場組長的手動領域，系統性重算一律跳過，
 * 排程以排程頁手動存檔為準。呼叫端遇 true 應跳過 rebuild 寫回（連寫都不寫，
 * 保持 sync_method/updated_at 乾淨以利查案）。
 * 06:00 前不凍結：預約變更/預約刪除 cron 於凌晨清理「生效日當天」排程屬預期行為。
 * 調班「初次套用」（外科手術式單格寫入，exceptionHandler）不在此限。
 */
export function isTodayScheduleFrozen(dateStr) {
  if (dateStr !== getTaipeiTodayString()) return false
  return getTaipeiNowMinutes() >= SHIFT_START_MINUTES.early
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
      return { success: true, mergedCount: 0 }
    }

    console.log(`📅 [ScheduleSync] 需要重新整合 ${datesToMerge.size} 個日期的排程`)

    // 對每個需要整合的日期重新計算排程
    let mergedCount = 0
    for (const dateStr of datesToMerge) {
      const finalSchedule = rebuildSingleDaySchedule(dateStr, masterRules, patientsMap)

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

    console.log(`✅ [ScheduleSync] 整合完成！已重新整合 ${mergedCount} 天的調班申請`)

    return { success: true, mergedCount }

  } catch (error) {
    console.error('❌ [ScheduleSync] 整合調班申請失敗:', error)
    throw error
  }
}

// 導出用於自動生成排程的輔助函數
export { generateDailyScheduleFromRules, generateAutoNote, rebuildSingleDaySchedule }

export default {
  syncMasterScheduleToFuture,
  initializeFutureSchedules,
  mergeExceptionsIntoSchedules,
  generateDailyScheduleFromRules,
  generateAutoNote,
  rebuildSingleDaySchedule,
}
