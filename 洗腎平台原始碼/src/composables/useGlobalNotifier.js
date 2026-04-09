// 檔案路徑: src/composables/useGlobalNotifier.js
// ✨ Standalone 版本

import { useAuth } from '@/composables/useAuth'
import { systemApi } from '@/services/localApiClient'
import { addDays } from '@/utils/dateUtils'
import { triggerNotificationRefresh } from '@/composables/useRealtimeNotifications.js'

// 導出一個可複用的函式
export function useGlobalNotifier() {
  const { currentUser } = useAuth()

  /**
   * 創建並發送一條全局通知
   * @param {string} message - 通知內容
   * @param {string} type - 通知類型 (schedule, patient, memo, etc.)
   * @param {Object} [options] - 可選參數，例如 { routePath: '/weekly?date=...' }
   */
  const createGlobalNotification = async (message, type = 'schedule', options = {}) => {
    if (!currentUser.value) {
      console.warn('[GlobalNotifier] User not logged in, cannot send notification.')
      return
    }

    try {
      // 計算 30 天後的過期時間
      const expireDate = addDays(new Date(), 30)

      await systemApi.createNotification({
        message,
        type,
        createdBy: {
          uid: currentUser.value.uid,
          name: currentUser.value.name,
        },
        expireAt: expireDate.toISOString(),
        metadata: {
          routePath: options.routePath || null,
        },
      })

      // 🔥 建立通知後立即刷新側邊欄
      triggerNotificationRefresh()
    } catch (error) {
      console.error('❌ [GlobalNotifier] Failed to create global notification:', error)
    }
  }

  return {
    createGlobalNotification,
  }
}
