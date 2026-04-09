// 檔案路徑: src/services/baseScheduleService.js
// ✨ Standalone 版本

import { generateAutoNote } from '@/utils/scheduleUtils.js'
import { schedulesApi } from '@/services/localApiClient'

/**
 * 【重構版】從總床位表中移除指定病人的所有規則。
 * @param {string} patientId - 病人ID
 * @returns {Promise<boolean>} 操作是否成功
 */
export async function removePatientFromBaseSchedule(patientId) {
  console.log(`🗑️ [BaseScheduleService] 開始從總床位表移除病人: ${patientId}`)

  try {
    const masterSchedule = await schedulesApi.fetchMasterSchedule()
    if (masterSchedule?.schedule?.[patientId]) {
      delete masterSchedule.schedule[patientId]
      await schedulesApi.updateMasterSchedule(masterSchedule.schedule)
    }
    console.log(`✅ [BaseScheduleService] 已移除病人 ${patientId} 規則。`)
    return true
  } catch (error) {
    console.error(`❌ [BaseScheduleService] 移除病人 ${patientId} 規則失敗:`, error)
    throw new Error(`移除病人規則失敗: ${error.message}`)
  }
}

/**
 * 【重構版】更新總床位表中指定病人的頻率。
 * @param {string} patientId - 病人ID
 * @param {string} newFreq - 新頻率
 * @param {object} patientData - 完整的病人資料（用於重新生成autoNote）
 * @returns {Promise<void>}
 */
export async function updatePatientFreqInBaseSchedule(patientId, newFreq, patientData) {
  console.log(`🔄 [BaseScheduleService] 開始更新病人頻率: ${patientId} → ${newFreq}`)

  try {
    const masterSchedule = await schedulesApi.fetchMasterSchedule()
    if (!masterSchedule?.schedule?.[patientId]) {
      console.log(`ℹ️ [BaseScheduleService] 病人 ${patientId} 在總表中沒有規則，無需更新頻率。`)
      return
    }
    // 更新頻率和自動備註
    masterSchedule.schedule[patientId].freq = newFreq
    masterSchedule.schedule[patientId].autoNote = generateAutoNote(patientData)
    await schedulesApi.updateMasterSchedule(masterSchedule.schedule)
    console.log(`✅ [BaseScheduleService] 成功更新病人 ${patientId} 的頻率為 ${newFreq}`)
  } catch (error) {
    console.error(`❌ [BaseScheduleService] 更新病人 ${patientId} 頻率失敗:`, error)
    throw new Error(`更新病人頻率失敗: ${error.message}`)
  }
}

/**
 * 【重構版】檢查總床位表中是否存在指定病人的規則。
 * @param {string} patientId - 病人ID
 * @returns {Promise<boolean>}
 */
export async function hasPatientInBaseSchedule(patientId) {
  try {
    const masterSchedule = await schedulesApi.fetchMasterSchedule()
    return !!masterSchedule?.schedule?.[patientId]
  } catch (error) {
    console.error(`❌ [BaseScheduleService] 檢查病人 ${patientId} 規則失敗:`, error)
    // 在發生錯誤時，保守地返回 false
    return false
  }
}
