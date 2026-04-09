// 檔案路徑: src/stores/medicationStore.ts (v2 - 修正快取累加問題)
// ✨ Standalone 版本

import { defineStore } from 'pinia'
import { ref, computed, type Ref } from 'vue'
import { medicationsApi } from '@/services/localApiClient'

export interface InjectionRecord {
  patientId: string
  orderCode: string
  [key: string]: unknown
}

export const useMedicationStore = defineStore('medication', () => {
  const dailyInjectionsCache: Ref<Record<string, InjectionRecord[]>> = ref({})
  const isLoading = ref(false)
  const error = ref<unknown>(null)

  const getInjectionsForDate = computed(() => {
    return (targetDate: string) => dailyInjectionsCache.value[targetDate] || null
  })

  async function fetchDailyInjections(targetDate: string, patientIds: string[]) {
    console.log(`[Store] 接到請求: 日期=${targetDate}, 病人數=${patientIds.length}`)

    if (!patientIds || patientIds.length === 0) {
      return [] as InjectionRecord[]
    }

    isLoading.value = true
    error.value = null

    try {
      if (!dailyInjectionsCache.value[targetDate]) {
        dailyInjectionsCache.value[targetDate] = []
      }

      const cachedPatientIds = new Set(
        dailyInjectionsCache.value[targetDate].map((inj) => inj.patientId),
      )
      const idsToFetch = patientIds.filter((id) => !cachedPatientIds.has(id))

      if (idsToFetch.length > 0) {
        console.log(
          `[Store] ❌ 快取不完整，需為 ${idsToFetch.length} 位新病人請求資料。`,
          idsToFetch,
        )

        // 🖥️ 使用本地 API 取得每日針劑資料
        const CHUNK_SIZE = 30
        const promises: Promise<InjectionRecord[]>[] = []
        for (let i = 0; i < idsToFetch.length; i += CHUNK_SIZE) {
          const chunk = idsToFetch.slice(i, i + CHUNK_SIZE)
          promises.push(medicationsApi.getDailyInjections(targetDate, chunk))
        }

        const results = await Promise.all(promises)
        let newlyFetchedInjections: InjectionRecord[] = []
        for (const injections of results) {
          if (injections && Array.isArray(injections)) {
            newlyFetchedInjections = newlyFetchedInjections.concat(injections)
          }
        }

        // ✨✨✨【核心修正】✨✨✨
        // 將新抓到的資料轉換成以 'patientId-orderCode' 為 key 的 Map，自動去重
        const newInjectionsMap = new Map(
          newlyFetchedInjections.map((inj) => [`${inj.patientId}-${inj.orderCode}`, inj]),
        )

        // 過濾掉快取中已存在的、且這次新資料中也有的項目
        const updatedCache = dailyInjectionsCache.value[targetDate].filter(
          (inj) => !newInjectionsMap.has(`${inj.patientId}-${inj.orderCode}`),
        )

        // 將新資料加入，完成去重合併
        updatedCache.push(...newInjectionsMap.values())

        // 用全新的、去重後的陣列來「覆蓋」舊的快取
        dailyInjectionsCache.value[targetDate] = updatedCache

        console.log(
          `[Store] 💾 快取已更新 (去重合併)，${targetDate} 現在共有 ${dailyInjectionsCache.value[targetDate].length} 筆資料。`,
        )
      } else {
        console.log(`[Store] ✅ 快取完整！本次請求的所有病人資料都已存在。`)
      }

      const patientIdSet = new Set(patientIds)
      return dailyInjectionsCache.value[targetDate].filter((inj) => patientIdSet.has(inj.patientId))
    } catch (e) {
      console.error('[Store] 獲取每日應打針劑時發生嚴重錯誤:', e)
      error.value = e
      return []
    } finally {
      isLoading.value = false
    }
  }

  function clearCache(targetDate: string | null = null) {
    if (targetDate) {
      console.log(`[MedicationStore] 🗑️ 清除 ${targetDate} 的快取。`)
      delete dailyInjectionsCache.value[targetDate]
    } else {
      console.log('[MedicationStore] 🗑️ 清除所有針劑快取。')
      dailyInjectionsCache.value = {}
    }
  }

  return {
    dailyInjectionsCache,
    isLoading,
    error,
    getInjectionsForDate,
    fetchDailyInjections,
    clearCache,
  }
})
