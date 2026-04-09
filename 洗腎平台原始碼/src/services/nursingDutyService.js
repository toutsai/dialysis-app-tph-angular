// 檔案路徑: src/services/nursingDutyService.js
// 🖥️ 純單機版本 - 使用本地 Express.js + SQLite 後端

import { nursingApi } from '@/services/localApiClient'

// 預設的空資料結構
const getDefaultData = () => ({
  announcement: '請在此輸入班別規則說明...',
  dayShift: { codes: '', tasks: '' },
  nightShift: [],
  checklist: [],
  teamwork: [],
  lastModified: { date: '', user: '系統' },
})

/**
 * 從本地資料庫獲取護理工作職責
 * @returns {Promise<object>}
 */
export async function fetchDuties() {
  try {
    const data = await nursingApi.fetchDuties()
    if (data) {
      console.log('✅ 從本地 API 成功獲取護理職責資料')
      return data
    } else {
      console.log('⚠️ 在本地資料庫中找不到護理職責，回傳預設值。')
      return getDefaultData()
    }
  } catch (error) {
    console.error('❌ 獲取護理職責失敗:', error)
    throw new Error('無法從資料庫獲取護理職責資料。')
  }
}

/**
 * 將護理工作職責儲存到本地資料庫
 * @param {object} data - 要儲存的完整資料物件
 * @returns {Promise<void>}
 */
export async function saveDuties(data) {
  try {
    await nursingApi.saveDuties(data)
    console.log('✅ 護理職責資料已成功儲存到本地資料庫')
  } catch (error) {
    console.error('❌ 儲存護理職責失敗:', error)
    throw new Error('儲存護理職責到資料庫時發生錯誤。')
  }
}
