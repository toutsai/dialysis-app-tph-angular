// 檔案路徑: src/composables/useRealtimeNotifications.js
// ✨ Standalone 版本 - 使用輪詢取代 Firebase onSnapshot

import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { systemApi } from '@/services/localApiClient'

const notifications = ref([])
let pollingInterval = null
const MAX_NOTIFICATIONS = 10
const POLLING_INTERVAL = 10000 // 10 秒（從 30 秒改為 10 秒）

const NOTIFICATION_CONFIG = {
  schedule: { icon: '📅', bgColor: '#3498db', textColor: '#fff' },
  team: { icon: '👥', bgColor: '#27ae60', textColor: '#fff' },
  patient: { icon: '👤', bgColor: '#f39c12', textColor: '#fff' },
  memo: { icon: '📝', bgColor: '#9b59b6', textColor: '#fff' },
  conflict: { icon: '⚠️', bgColor: '#e74c3c', textColor: '#fff' },
  exception: { icon: '⚡️', bgColor: '#c0392b', textColor: '#fff' },
  default: { icon: '🔔', bgColor: '#7f8c8d', textColor: '#fff' },
}

function formatDateTime(date) {
  if (!date || !(date instanceof Date)) return ''
  return date
    .toLocaleString('zh-TW', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Taipei',
    })
    .replace('/', '-')
}

const processNotification = (notification, router) => {
  const createdAt = notification.createdAt ? new Date(notification.createdAt) : new Date()
  const action = notification.metadata?.routePath
    ? () => router.push(notification.metadata.routePath)
    : null
  const createdByName = notification.createdBy?.name || '系統'

  return {
    id: notification.id,
    message: notification.message,
    type: notification.type,
    time: formatDateTime(createdAt),
    createdAt,
    config: NOTIFICATION_CONFIG[notification.type] || NOTIFICATION_CONFIG.default,
    action,
    createdByName,
  }
}

// 全局刷新函式，供其他模組呼叫
let globalRefreshFn = null

export function useRealtimeNotifications() {
  const router = useRouter()

  const fetchNotifications = async () => {
    try {
      const data = await systemApi.fetchNotifications()
      const serverNotifications = (data || [])
        .slice(0, MAX_NOTIFICATIONS)
        .map((n) => processNotification(n, router))

      // 保留本地通知
      const localNotifications = notifications.value.filter((n) => n.isLocal)
      const merged = [...localNotifications, ...serverNotifications]
      notifications.value = merged.slice(0, MAX_NOTIFICATIONS)
    } catch (error) {
      console.error('[useRealtimeNotifications] 取得通知失敗:', error)
    }
  }

  // 設置全局刷新函式
  globalRefreshFn = fetchNotifications

  const startListening = () => {
    if (pollingInterval) return

    // 立即取得一次
    void fetchNotifications()

    // 設定輪詢
    pollingInterval = setInterval(() => {
      void fetchNotifications()
    }, POLLING_INTERVAL)

    console.log('[useRealtimeNotifications] 🖥️ 已啟動通知輪詢')
  }

  const stopListening = () => {
    if (pollingInterval) {
      clearInterval(pollingInterval)
      pollingInterval = null
    }
    notifications.value = []
    console.log('[useRealtimeNotifications] 🖥️ 已停止通知輪詢')
  }

  // 本地通知仍然保留，用於即時的操作反饋
  const addLocalNotification = (message, type = 'default', options = {}) => {
    const id = Date.now() + Math.random()
    const now = new Date()
    const newNotification = {
      id,
      message,
      type,
      time: formatDateTime(now),
      createdAt: now,
      config: NOTIFICATION_CONFIG[type] || NOTIFICATION_CONFIG.default,
      action: options.action || null,
      isLocal: true,
      createdByName: '您',
    }
    // 插入到列表頂部，並保持總數不超過上限
    const currentServerNotifications = notifications.value.filter((n) => !n.isLocal)
    const newNotifications = [newNotification, ...currentServerNotifications]
    notifications.value = newNotifications.slice(0, MAX_NOTIFICATIONS)
  }

  // 手動刷新通知（供外部呼叫）
  const refreshNotifications = () => {
    return fetchNotifications()
  }

  return {
    notifications,
    startListening,
    stopListening,
    addLocalNotification,
    refreshNotifications,
  }
}

// 導出全局刷新函式，供非 composable 環境使用
export function triggerNotificationRefresh() {
  if (globalRefreshFn) {
    return globalRefreshFn()
  }
}
