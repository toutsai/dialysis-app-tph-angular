// src/composables/useNurseGroupSync.js
import { ref } from 'vue'
import ApiManager from '@/services/api_manager'

export function useNurseGroupSync() {
  const nursingSchedulesApi = ApiManager('nursing_schedules')

  /**
   * 從護理班表中取得特定日期的護理師組別對應
   * @param {string} dateStr - 日期字串 (YYYY-MM-DD)
   * @returns {Object} 組別與護理師姓名的對應表
   */
  async function getNurseAssignmentsForDate(dateStr) {
    try {
      // 從日期取得年月
      const [year, month, day] = dateStr.split('-')
      const yearMonth = `${year}-${month}`
      const dayIndex = parseInt(day) - 1

      // 載入該月份的護理班表
      const monthlySchedule = await nursingSchedulesApi.fetchById(yearMonth)
      if (!monthlySchedule || !monthlySchedule.scheduleByNurse) {
        return {}
      }

      // 建立組別對應表
      const assignments = {
        early: {}, // 早班組別
        late: {}, // 晚班組別
      }

      // 遍歷每個護理師的排班
      Object.entries(monthlySchedule.scheduleByNurse).forEach(([nurseId, nurseData]) => {
        const nurseName = nurseData.nurseName
        const shift = nurseData.shifts?.[dayIndex]
        const group = nurseData.groups?.[dayIndex]

        if (!nurseName || !shift || !group) return

        // 判斷是早班還是晚班
        const EARLY_SHIFTS = ['74', '75', '84', '74/L', '816', '815']
        const LATE_SHIFTS = ['3-11', '311', '311C']

        const shiftStr = String(shift).trim()

        if (EARLY_SHIFTS.some((s) => shiftStr.includes(s))) {
          // 早班組別
          const teamKey = `早${group}`
          assignments.early[teamKey] = nurseName
        } else if (LATE_SHIFTS.some((s) => shiftStr.includes(s))) {
          // 晚班組別
          const teamKey = `晚${group}`
          assignments.late[teamKey] = nurseName
        }
      })

      // 合併早晚班組別
      return { ...assignments.early, ...assignments.late }
    } catch (error) {
      console.error('取得護理師組別對應失敗:', error)
      return {}
    }
  }

  /**
   * 自動填入護理師姓名到分組統計
   * @param {string} dateStr - 日期字串
   * @param {Object} currentTeamsRecord - 當前的分組記錄
   * @returns {Object} 更新後的分組記錄
   */
  async function autoFillNurseNames(dateStr, currentTeamsRecord) {
    const assignments = await getNurseAssignmentsForDate(dateStr)

    // 更新 names 欄位
    const updatedRecord = JSON.parse(JSON.stringify(currentTeamsRecord))
    if (!updatedRecord.names) {
      updatedRecord.names = {}
    }

    // 🔥 重要修改：先清除所有自動填入的組別護理師姓名
    // 定義所有可能的組別
    const allPossibleTeams = [
      // 早班組別
      '早A',
      '早B',
      '早C',
      '早D',
      '早E',
      '早F',
      '早G',
      '早H',
      '早I',
      '早J',
      '早K',
      '早外圍',
      // 晚班組別
      '晚A',
      '晚B',
      '晚C',
      '晚D',
      '晚E',
      '晚F',
      '晚G',
      '晚H',
      '晚I',
      '晚J',
      '晚K',
      '晚外圍',
    ]

    // 清除所有組別的護理師姓名（只清除上述定義的組別，保留其他可能手動設定的）
    allPossibleTeams.forEach((teamKey) => {
      if (updatedRecord.names[teamKey]) {
        delete updatedRecord.names[teamKey]
      }
    })

    // 填入新的組別姓名
    Object.entries(assignments).forEach(([teamKey, nurseName]) => {
      updatedRecord.names[teamKey] = nurseName
    })

    return updatedRecord
  }

  /**
   * 比較兩個 names 物件是否有差異
   * @param {Object} oldNames - 舊的 names 物件
   * @param {Object} newNames - 新的 names 物件
   * @returns {boolean} 是否有差異
   */
  function hasNamesDifference(oldNames = {}, newNames = {}) {
    const allKeys = new Set([...Object.keys(oldNames), ...Object.keys(newNames)])

    for (const key of allKeys) {
      if (oldNames[key] !== newNames[key]) {
        return true
      }
    }

    return false
  }

  return {
    getNurseAssignmentsForDate,
    autoFillNurseNames,
    hasNamesDifference,
  }
}
