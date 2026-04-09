// src/composables/useCache.js
import { ref, computed } from 'vue'

// 全局快取存儲
const cache = ref(new Map())
const cacheTimestamps = ref(new Map())

export function useCache() {
  const CACHE_DURATION = 5 * 60 * 1000 // 5分鐘

  /**
   * 智能快取函式
   * @param {string} key - 快取鍵值
   * @param {Function} fetchFn - 獲取資料的函式
   * @param {number} duration - 快取持續時間（毫秒）
   */
  const getCachedData = async (key, fetchFn, duration = CACHE_DURATION) => {
    const now = Date.now()
    const timestamp = cacheTimestamps.value.get(key)

    // 檢查快取是否有效
    if (timestamp && now - timestamp < duration && cache.value.has(key)) {
      console.log(`🎯 Cache hit for: ${key}`)
      return cache.value.get(key)
    }

    // 快取無效，重新獲取資料
    console.log(`🔄 Cache miss for: ${key}, fetching...`)
    try {
      const data = await fetchFn()

      // 存儲到快取
      cache.value.set(key, data)
      cacheTimestamps.value.set(key, now)

      return data
    } catch (error) {
      console.error(`❌ Failed to fetch data for key: ${key}`, error)

      // 如果獲取失敗但有舊快取，返回舊資料
      if (cache.value.has(key)) {
        console.log(`🔄 Returning stale cache for: ${key}`)
        return cache.value.get(key)
      }

      throw error
    }
  }

  /**
   * 清除特定快取
   */
  const invalidateCache = (key) => {
    cache.value.delete(key)
    cacheTimestamps.value.delete(key)
    console.log(`🗑️ Cache invalidated for: ${key}`)
  }

  /**
   * 清除所有快取
   */
  const clearAllCache = () => {
    cache.value.clear()
    cacheTimestamps.value.clear()
    console.log('🗑️ All cache cleared')
  }

  /**
   * 獲取快取統計
   */
  const getCacheStats = computed(() => ({
    totalItems: cache.value.size,
    items: Array.from(cache.value.keys()).map((key) => ({
      key,
      timestamp: cacheTimestamps.value.get(key),
      age: Date.now() - (cacheTimestamps.value.get(key) || 0),
    })),
  }))

  return {
    getCachedData,
    invalidateCache,
    clearAllCache,
    getCacheStats,
  }
}
