// 檔案路徑: src/stores/taskStore.ts
// ✨ Standalone 版本

import { ref, computed, watch, type Ref } from 'vue'
import { defineStore } from 'pinia'
import { useAuth } from '@/composables/useAuth'
import { formatDateToYYYYMMDD } from '@/utils/dateUtils'
import { systemApi } from '@/services/localApiClient'

export type TaskItem = {
  id?: string
  category?: string
  status?: string
  type?: string
  patientId?: string
  createdAt?: unknown
  resolvedAt?: unknown
  targetDate?: string
  content?: string
  assignee?: any // 因為現在可能是物件 { role: string, value: string ... }
  creator?: any // 因為現在可能是物件 { uid: string, name: string ... }
  roles?: string[]
  [key: string]: unknown
}

function getSafeDate(timestamp: unknown) {
  if (!timestamp) return new Date(0)
  if (timestamp instanceof Date) return timestamp
  if (typeof (timestamp as { toDate?: () => Date }).toDate === 'function') {
    return (timestamp as { toDate: () => Date }).toDate()
  }
  const date = new Date(timestamp as string)
  return isNaN(date.getTime()) ? new Date(0) : date
}

export const useTaskStore = defineStore('task', () => {
  const { currentUser } = useAuth()
  const myTasks: Ref<TaskItem[]> = ref([])
  const mySentTasks: Ref<TaskItem[]> = ref([])
  const feedMessages: Ref<TaskItem[]> = ref([])
  const feedMessagesVersion = ref(0)
  const isLoading = ref(true) // 初始為 true
  let pollingInterval: ReturnType<typeof setInterval> | null = null
  let isPolling = false
  const conditionRecordPatientIds: Ref<Set<string>> = ref(new Set())

  const SEVEN_DAYS_IN_MS = 7 * 24 * 60 * 60 * 1000

  const isWithinSevenDays = (dateValue: unknown) => {
    const date = getSafeDate(dateValue)
    const sevenDaysAgo = new Date(Date.now() - SEVEN_DAYS_IN_MS)
    return date.getTime() >= sevenDaysAgo.getTime()
  }

  // 檢查 targetDate 字串是否在 7 天內（從 targetDate 往後算 7 天）
  const isTargetDateWithinSevenDays = (targetDateStr: string | undefined) => {
    if (!targetDateStr) return false
    const targetDate = new Date(targetDateStr)
    if (isNaN(targetDate.getTime())) return false
    const sevenDaysAgo = new Date(Date.now() - SEVEN_DAYS_IN_MS)
    return targetDate.getTime() >= sevenDaysAgo.getTime()
  }

  const applyRetentionPolicy = (items: TaskItem[]) =>
    items
      .map((item) => ({ ...item, type: item.type || '常規' }))
      .filter((item) => {
        if (item.status === 'deleted') return false

        if (item.category === 'message') {
          if (item.type === '衛教') return true
          // 保留條件：createdAt 在 7 天內，或 targetDate 在 7 天內
          return isWithinSevenDays(item.createdAt) || isTargetDateWithinSevenDays(item.targetDate)
        }

        if (item.category === 'task') {
          return isWithinSevenDays(item.createdAt)
        }

        return true
      })

  // --- Getters ---
  const sortedFeedMessages = computed(() => {
    const standardizedMessages = feedMessages.value.map((msg) => ({
      ...msg,
      createdAt: getSafeDate(msg.createdAt),
      resolvedAt: getSafeDate(msg.resolvedAt),
    }))
    return standardizedMessages.sort((a, b) => {
      const aIsDone = a.status === 'completed'
      const bIsDone = b.status === 'completed'
      if (aIsDone !== bIsDone) return aIsDone ? 1 : -1
      const dateA = aIsDone ? (a.resolvedAt as Date) : (a.createdAt as Date)
      const dateB = bIsDone ? (b.resolvedAt as Date) : (b.createdAt as Date)
      return dateB.getTime() - dateA.getTime()
    })
  })

  const getPatientMessageTypesMapForDate = computed(() => {
    return (targetDate?: string) => {
      const dateToCompare = targetDate ? new Date(targetDate) : new Date()
      const dateStr = formatDateToYYYYMMDD(dateToCompare)
      const map = new Map<string, Set<string>>()
      const pendingMessages = feedMessages.value.filter((msg) => msg.status === 'pending')
      for (const msg of pendingMessages) {
        if (!msg.patientId) continue
        let shouldDisplayIcon = false
        if (!msg.targetDate || (msg.targetDate as string) <= dateStr) {
          shouldDisplayIcon = true
        }
        if (shouldDisplayIcon) {
          if (!map.has(msg.patientId)) {
            map.set(msg.patientId, new Set())
          }
          map.get(msg.patientId)?.add(msg.type === '常規' ? 'memo' : (msg.type as string))
        }
      }
      conditionRecordPatientIds.value.forEach((patientId) => {
        if (!map.has(patientId)) {
          map.set(patientId, new Set())
        }
        map.get(patientId)?.add('record')
      })
      const finalMap = new Map<string, string[]>()
      for (const [patientId, typeSet] of map.entries()) {
        finalMap.set(patientId, Array.from(typeSet))
      }
      return finalMap
    }
  })

  const allPendingPatientMessageTypesMap = computed(() => {
    const map = new Map<string, Set<string>>()
    const pendingMessages = feedMessages.value.filter((msg) => msg.status === 'pending')
    for (const msg of pendingMessages) {
      if (!msg.patientId) continue
      if (!map.has(msg.patientId)) {
        map.set(msg.patientId, new Set())
      }
      map.get(msg.patientId)?.add((msg.type as string) || '常規')
    }
    const finalMap = new Map<string, string[]>()
    for (const [patientId, typeSet] of map.entries()) {
      finalMap.set(patientId, Array.from(typeSet))
    }
    return finalMap
  })

  const todayTaskCount = computed(() => (todayAssignedPatientIds?: string[]) => {
    if (!currentUser.value) return 0
    const myPendingTasksCount = myTasks.value.filter((t) => t.status === 'pending').length
    if (!todayAssignedPatientIds || todayAssignedPatientIds.length === 0) {
      return myPendingTasksCount
    }
    const patientIdSet = new Set(todayAssignedPatientIds)
    const myPendingMemosCount = feedMessages.value.filter(
      (item) => item.status === 'pending' && item.patientId && patientIdSet.has(item.patientId),
    ).length
    return myPendingTasksCount + myPendingMemosCount
  })

  const todayRelevantMemosCount = computed(() => {
    return (patientIdArray?: string[]) => {
      if (!patientIdArray || patientIdArray.length === 0) return 0
      const todayStr = formatDateToYYYYMMDD()
      const patientIdSet = new Set(patientIdArray)
      return feedMessages.value.filter((item) => {
        const isTargetDateRelevant = !item.targetDate || (item.targetDate as string) <= todayStr
        return (
          item.status === 'pending' &&
          item.patientId &&
          patientIdSet.has(item.patientId) &&
          isTargetDateRelevant &&
          item.content &&
          !(item.content as string).startsWith('【')
        )
      }).length
    }
  })

  // --- Actions ---
  function updateTasksFromConditionRecords(patientIdSet: Set<string>) {
    conditionRecordPatientIds.value = patientIdSet
  }

  // 🖥️ 單機模式：使用輪詢從後端取得任務資料
  async function fetchTasksFromBackend() {
    if (isPolling) return
    isPolling = true

    try {
      const user = currentUser.value
      if (!user) {
        isLoading.value = false
        return
      }

      // 取得角色對應值
      const titleToRoleValue: Record<string, string> = {
        書記: 'clerk',
        主治醫師: 'doctor',
        專科護理師: 'np',
        護理師組長: 'editor',
      }
      const myTargetAssigneeValues = new Set<string>()
      const titleBasedRole = user.title && titleToRoleValue[user.title]
      if (titleBasedRole) myTargetAssigneeValues.add(titleBasedRole)
      if (user.role) myTargetAssigneeValues.add(user.role)

      // 從後端取得所有任務
      const allTasks = await systemApi.fetchTasks({})

      // 過濾分類任務
      const roleAssignedTasks: TaskItem[] = []
      const userAssignedTasks: TaskItem[] = []
      const sentTasks: TaskItem[] = []
      const messages: TaskItem[] = []

      for (const task of allTasks) {
        // 根據狀態過濾
        const isRelevant =
          task.status === 'pending' ||
          (task.status === 'completed' && isWithinSevenDays(task.createdAt))

        if (!isRelevant && task.status !== 'pending') continue

        if (task.category === 'message') {
          // 留言分類
          if (task.status === 'pending' || isWithinSevenDays(task.createdAt)) {
            messages.push(task)
          }
        } else if (task.category === 'task') {
          // 任務分類
          // 1. 依角色指派的任務
          if (
            task.assignee?.role &&
            myTargetAssigneeValues.has(task.assignee.role) &&
            isRelevant
          ) {
            roleAssignedTasks.push(task)
          }

          // 2. 依特定人員指派的任務
          if (task.assignee?.value === user.uid && isRelevant) {
            userAssignedTasks.push(task)
          }

          // 3. 我寄出的任務
          if (task.creator?.uid === user.uid && isRelevant) {
            sentTasks.push(task)
          }
        }
      }

      // 合併並去重 myTasks
      const allRawTasks = [...roleAssignedTasks, ...userAssignedTasks]
      const uniqueTasks = Array.from(new Map(allRawTasks.map((item) => [item.id, item])).values())
      myTasks.value = applyRetentionPolicy(uniqueTasks)

      // 更新其他狀態
      mySentTasks.value = applyRetentionPolicy(sentTasks)
      feedMessages.value = applyRetentionPolicy(messages)
      feedMessagesVersion.value++
    } catch (err) {
      console.error('[TaskStore] 取得任務資料失敗:', err)
    } finally {
      isLoading.value = false
      isPolling = false
    }
  }

  function startRealtimeUpdates(uid?: string) {
    if (pollingInterval) return
    if (!uid || !currentUser.value) {
      isLoading.value = false
      return
    }

    isLoading.value = true

    // 立即執行一次
    void fetchTasksFromBackend()

    // 設定輪詢（每 30 秒）
    pollingInterval = setInterval(() => {
      void fetchTasksFromBackend()
    }, 30000)

    console.log('[TaskStore] 🖥️ 已啟動任務輪詢')
  }

  function stopRealtimeUpdates() {
    if (pollingInterval) {
      clearInterval(pollingInterval)
      pollingInterval = null
    }
    isLoading.value = false
    console.log('[TaskStore] 🖥️ 已停止任務輪詢')
  }

  // 定義 cleanupListeners 作為 stopRealtimeUpdates 的別名
  const cleanupListeners = stopRealtimeUpdates

  watch(
    () => currentUser.value?.id,
    (newUserId, oldUserId) => {
      if (newUserId !== oldUserId) {
        stopRealtimeUpdates()
        if (newUserId) startRealtimeUpdates(newUserId)
      }
    },
  )

  // 立即刷新任務資料（用於新增/更新後立即顯示）
  async function refreshTasks() {
    await fetchTasksFromBackend()
  }

  return {
    // State
    myTasks,
    mySentTasks,
    feedMessages,
    feedMessagesVersion,
    isLoading,
    conditionRecordPatientIds,

    // Getters
    sortedFeedMessages,
    getPatientMessageTypesMapForDate,
    allPendingPatientMessageTypesMap,
    todayTaskCount,
    todayRelevantMemosCount,

    // Actions
    startRealtimeUpdates,
    stopRealtimeUpdates,
    updateTasksFromConditionRecords,
    cleanupListeners,
    refreshTasks,
  }
})
