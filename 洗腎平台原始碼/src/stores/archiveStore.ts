// 檔案路徑: src/stores/archiveStore.ts
// ✨ Standalone 版本

import { defineStore } from 'pinia'
import { ref, type Ref } from 'vue'
import { schedulesApi } from '@/services/localApiClient'

interface ScheduleRecord {
  id?: string
  date: string
  schedule: Record<string, unknown>
}

export const useArchiveStore = defineStore('archive', () => {
  // --- State ---
  // 只儲存本次工作階段中已查詢過的排班，key 為 'YYYY-MM-DD'
  const schedulesCache: Ref<Map<string, ScheduleRecord>> = ref(new Map())
  const isLoading = ref(false)

  // --- Action ---
  /**
   * 按需獲取指定日期的已歸檔排班資料。
   * 會自動處理快取，避免重複請求。
   * @param {string} dateStr - 'YYYY-MM-DD' 格式的日期。
   * @returns {Promise<object|null>} 返回該日期的排班記錄，或在找不到時返回 null。
   */
  async function fetchScheduleByDate(dateStr: string): Promise<ScheduleRecord | null> {
    // 1. 檢查快取
    if (schedulesCache.value.has(dateStr)) {
      console.log(`[ArchiveStore] Cache hit for ${dateStr}.`)
      return schedulesCache.value.get(dateStr) ?? null
    }

    // 2. 如果快取未命中，則從本地資料庫獲取
    console.log(`[ArchiveStore] Cache miss for ${dateStr}. Fetching from local database...`)
    isLoading.value = true
    try {
      const record = await schedulesApi.fetchExpiredSchedule(dateStr)
      const scheduleRecord = record || { date: dateStr, schedule: {} }

      // 3. 將結果存入快取 (即使是空物件也存，避免重複查詢不存在的日期)
      schedulesCache.value.set(dateStr, scheduleRecord)

      return scheduleRecord
    } catch (error) {
      console.error(`[ArchiveStore] Failed to fetch archived schedule for ${dateStr}:`, error)
      return null // 發生錯誤時回傳 null
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 清空快取，通常在登出或需要強制刷新時使用。
   */
  function clearCache() {
    schedulesCache.value.clear()
  }

  return {
    schedulesCache,
    isLoading,
    fetchScheduleByDate,
    clearCache,
  }
})
