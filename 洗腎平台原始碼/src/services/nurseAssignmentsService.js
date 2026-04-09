// 檔案路徑: src/services/nurseAssignmentsService.js
// ✨ Standalone 版本

import { schedulesApi } from '@/services/localApiClient'

/**
 * 根據日期獲取護理分組
 * @param {string} dateStr - 日期字串 (YYYY-MM-DD)
 * @returns {Promise<Object|null>} 護理分組記錄
 */
export async function fetchTeamsByDate(dateStr) {
  try {
    const data = await schedulesApi.fetchNurseAssignments(dateStr)
    if (!data) return null
    return {
      id: dateStr,
      date: dateStr,
      ...data,
    }
  } catch (error) {
    console.error('獲取護理分組失敗:', error)
    throw error
  }
}

/**
 * 儲存新的護理分組
 * @param {Object} data - 包含 date 和 teams 的資料
 * @returns {Promise<Object>} 儲存後的記錄（含 ID）
 */
export async function saveTeams(data) {
  try {
    const saveData = {
      teams: data.teams || {},
      names: data.names || {},
      takeoffEnabled: data.takeoffEnabled || false,
    }

    await schedulesApi.updateNurseAssignments(data.date, saveData)
    return { id: data.date, date: data.date, ...saveData }
  } catch (error) {
    console.error('儲存護理師分組失敗:', error)
    throw error
  }
}

/**
 * 更新現有的護理分組
 * @param {string} docId - 文件 ID (日期)
 * @param {Object} data - 更新的資料
 * @returns {Promise<void>}
 */
export async function updateTeams(docId, data) {
  try {
    await schedulesApi.updateNurseAssignments(docId, data)
    return { success: true }
  } catch (error) {
    console.error('更新護理師分組失敗:', error)
    throw error
  }
}

/**
 * 批量獲取日期範圍內的護理分組
 * @param {string} startDate - 開始日期 (YYYY-MM-DD)
 * @param {string} endDate - 結束日期 (YYYY-MM-DD)
 * @returns {Promise<Array>} 護理分組記錄陣列
 */
export async function fetchTeamsInRange(startDate, endDate) {
  try {
    // 逐日取得（後端可擴展批量 API）
    const results = []
    const start = new Date(startDate)
    const end = new Date(endDate)

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0]
      try {
        const data = await schedulesApi.fetchNurseAssignments(dateStr)
        if (data) {
          results.push({ id: dateStr, date: dateStr, ...data })
        }
      } catch {
        // 該日期無資料，略過
      }
    }

    return results
  } catch (error) {
    console.error('批量獲取護理分組失敗:', error)
    throw error
  }
}

/**
 * 複製某一天的護理分組到另一天
 * @param {string} sourceDate - 來源日期
 * @param {string} targetDate - 目標日期
 * @returns {Promise<Object>} 新建立的記錄
 */
export async function copyTeamsToDate(sourceDate, targetDate) {
  try {
    const sourceData = await fetchTeamsByDate(sourceDate)
    if (!sourceData) {
      throw new Error(`找不到 ${sourceDate} 的護理分組資料`)
    }

    // 更新目標日期
    return await saveTeams({
      date: targetDate,
      teams: sourceData.teams,
      names: sourceData.names,
    })
  } catch (error) {
    console.error('複製護理分組失敗:', error)
    throw error
  }
}

/**
 * 刪除特定日期的護理分組
 * @param {string} dateStr - 日期字串
 * @returns {Promise<boolean>} 是否刪除成功
 */
export async function deleteTeamsByDate(dateStr) {
  try {
    // 清空該日期的分組（設為空物件）
    await schedulesApi.updateNurseAssignments(dateStr, { teams: {}, names: {} })
    return true
  } catch (error) {
    console.error('刪除護理分組失敗:', error)
    throw error
  }
}

/**
 * 清空特定日期的所有護理分組（但保留記錄）
 * @param {string} dateStr - 日期字串
 * @returns {Promise<void>}
 */
export async function clearTeamsByDate(dateStr) {
  try {
    await schedulesApi.updateNurseAssignments(dateStr, { teams: {}, names: {} })
  } catch (error) {
    console.error('清空護理分組失敗:', error)
    throw error
  }
}
