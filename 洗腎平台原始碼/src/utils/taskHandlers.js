// 檔案路徑: src/utils/taskHandlers.js
// ✨ Standalone 版本 - 使用本地 API

import { systemApi, memosApi } from '@/services/localApiClient'
import { getNowISO } from '@/utils/dateUtils'

/**
 * 處理新增交辦/留言的通用函式
 * @param {object} data - 從 TaskCreateDialog 元件 submit 事件傳來的表單資料
 * @param {object} currentUser - 當前登入的使用者物件 (來自 useAuth)
 * @returns {Promise<void>}
 */
export async function handleTaskCreated(data, currentUser) {
  // 1. 安全檢查：確保有使用者資料
  if (!currentUser) {
    console.error('[handleTaskCreated] Error: currentUser is not available.')
    throw new Error('使用者未登入，無法新增項目。')
  }

  // 2. 準備要寫入資料庫的 payload 物件
  const payload = {
    ...data, // 包含從 dialog 傳來的 patientId, content, type, targetDate 等
    creator: {
      uid: currentUser.uid,
      name: currentUser.name,
    },
    status: 'pending',
    createdAt: getNowISO(), // 使用本地時間
    resolvedAt: null,
    resolvedBy: null,
  }

  // 3. 根據 data.category 決定要寫入哪個集合
  //    'task' -> 交辦事項 (使用 systemApi.createTask)
  //    'message' -> 留言 (使用 memosApi.create)
  const isTask = data.category === 'task'

  try {
    // 4. 使用對應的 API 寫入資料
    if (isTask) {
      const result = await systemApi.createTask(payload)
      console.log(`[handleTaskCreated] Task created with ID: ${result.id}`)
    } else {
      const result = await memosApi.create({
        ...payload,
        date: data.targetDate || payload.createdAt.split('T')[0],
        content: data.content,
      })
      console.log(`[handleTaskCreated] Memo created with ID: ${result.id}`)
    }
  } catch (error) {
    console.error(`[handleTaskCreated] Error adding ${isTask ? 'task' : 'memo'}:`, error)
    throw error
  }
}
