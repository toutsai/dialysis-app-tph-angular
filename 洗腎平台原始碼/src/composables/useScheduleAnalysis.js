// 檔案路徑: src/composables/useScheduleAnalysis.js (最終增強版)

import { computed } from 'vue'

/**
 * 輔助函式：判斷病患是否應在指定日期排班。
 * @param {Object} patient - 病患物件。
 * @param {Number} dayOfWeek - 星期幾 (1-7)。
 * @param {Object} freqMap - 頻率對應表。
 * @returns {Boolean}
 */
function shouldPatientBeScheduled(patient, dayOfWeek, freqMap) {
  // 臨時病人總是可被考慮排班
  if (patient.freq === '臨時') {
    return true
  }
  if (!patient.freq || !freqMap) return false
  const scheduledDays = freqMap[patient.freq]
  return scheduledDays ? scheduledDays.includes(dayOfWeek) : false
}

/**
 * 一個用於分析排程資料的 Vue Composition API Composable。
 * @param {Ref<Array>} allPatients - 包含所有病患資料的 ref。
 * @param {Ref<Object>} scheduleData - 排程資料的 ref (可以是週排程圖或日排程)。
 * @param {Object} freqMap - 頻率與星期索引的對應物件。
 * @returns {Object} - 包含各種分析結果的物件。
 */
export function useScheduleAnalysis(allPatients, scheduleData, freqMap) {
  const scheduledPatientIds = computed(() => {
    const ids = new Set()
    const currentSchedule = scheduleData.value || {}
    for (const slotData of Object.values(currentSchedule)) {
      if (slotData?.patientId) {
        ids.add(slotData.patientId)
      }
    }
    return ids
  })

  const globallyUnassignedPatients = computed(() => {
    return allPatients.value.filter(
      (patient) =>
        patient.freq &&
        !patient.isDeleted &&
        !patient.isDiscontinued &&
        !scheduledPatientIds.value.has(patient.id),
    )
  })

  /**
   * [用於 ScheduleView]
   * 回傳一個函式，用於計算在指定的 "星期幾" 中，應到而未到的病人。
   * @param {Ref<Number>} dayOfWeek - 代表星期幾的 ref (1=週一, ..., 7=週日)。
   * @returns {ComputedRef<Array>} - 包含當日應到未到病人的 computed ref。
   */
  const getDailyUnassignedPatients = (dayOfWeek) => {
    return computed(() => {
      const today = dayOfWeek.value
      if (!today) return []

      return allPatients.value.filter((p) => {
        if (p.isDeleted || p.isDiscontinued || scheduledPatientIds.value.has(p.id)) {
          return false
        }
        // ✨ 核心邏輯：找出「應該」排班的
        return shouldPatientBeScheduled(p, today, freqMap)
      })
    })
  }

  /**
   * ✨ [新增功能]
   * [用於 ScheduleView]
   * 回傳一個函式，用於計算在指定的 "星期幾" 中，可作為臨時洗腎的病人。
   * @param {Ref<Number>} dayOfWeek - 代表星期幾的 ref (1=週一, ..., 7=週日)。
   * @returns {ComputedRef<Array>} - 包含當日可臨洗病人的 computed ref。
   */
  const getDailyTemporaryPatients = (dayOfWeek) => {
    return computed(() => {
      const today = dayOfWeek.value
      if (!today) return []

      return allPatients.value.filter((p) => {
        if (p.isDeleted || p.isDiscontinued || scheduledPatientIds.value.has(p.id)) {
          return false
        }
        // ✨ 核心邏輯：找出「不應該」排班的 (也就是可以臨洗的)
        return !shouldPatientBeScheduled(p, today, freqMap)
      })
    })
  }

  return {
    scheduledPatientIds,
    globallyUnassignedPatients,
    getDailyUnassignedPatients,
    getDailyTemporaryPatients, // ✨ 導出新函式
  }
}
