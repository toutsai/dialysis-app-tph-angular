// src/utils/taskHandlers.ts
// Standalone 版：已移除 Firebase，改用 REST API
import { localApi } from '@/services/localApiClient'

/** 任務表單資料介面 */
export interface TaskFormData {
  category: 'task' | 'message' | string;
  title?: string;
  content?: string;
  type?: string;
  patientId?: string;
  patientName?: string;
  targetDate?: string;
  assignedTo?: string;
  assignee?: { type?: string; value?: string; name?: string; title?: string; role?: string };
  [key: string]: unknown;
}

/** 當前使用者介面 */
export interface CurrentUser {
  uid: string;
  name: string;
  [key: string]: unknown;
}

/** 任務建立 payload */
interface TaskPayload extends TaskFormData {
  creator: { uid: string; name: string };
  status: string;
  createdAt: string;
  resolvedAt: null;
  resolvedBy: null;
}

/**
 * 處理新增交辦/留言的通用函式
 * @param data - 從 TaskCreateDialog 元件 submit 事件傳來的表單資料
 * @param currentUser - 當前登入的使用者物件
 */
export async function handleTaskCreated(data: TaskFormData, currentUser: CurrentUser | null | undefined): Promise<void> {
  if (!currentUser) {
    console.error('[handleTaskCreated] Error: currentUser is not available.')
    throw new Error('使用者未登入，無法新增項目。')
  }

  const payload: TaskPayload = {
    ...data,
    creator: {
      uid: currentUser.uid,
      name: currentUser.name,
    },
    status: 'pending',
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    resolvedBy: null,
  }

  // 根據 category 決定 API route
  const route = data.category === 'task' ? '/system/tasks' : '/memos'

  try {
    const result = await localApi.post(route, payload) as { id?: string } | null
    console.log(
      `[handleTaskCreated] Document created with ID: ${result?.id || 'unknown'} to route: ${route}`,
    )
  } catch (error) {
    console.error(`[handleTaskCreated] Error adding document to ${route}:`, error)
    throw error
  }
}
