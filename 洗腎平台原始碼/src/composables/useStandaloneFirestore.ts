/**
 * 單機模式 Firestore 相容層
 * 提供與 Firebase Firestore 相似的介面，在單機模式下使用本地 API
 */

import { isStandaloneMode } from '@/utils/appMode'
import { systemApi, nursingApi, patientsApi } from '@/services/localApiClient'

// 類型定義
export interface StandaloneDocRef {
  id: string
  collection: string
}

export interface StandaloneDocSnapshot {
  id: string
  exists: () => boolean
  data: () => any
}

const _isStandalone = isStandaloneMode()

/**
 * 取得集合中的文檔參考 (standalone 模式)
 */
export function standaloneDoc(collection: string, id: string): StandaloneDocRef {
  return { id, collection }
}

/**
 * 取得單一文檔 (standalone 模式)
 */
export async function standaloneGetDoc(ref: StandaloneDocRef): Promise<StandaloneDocSnapshot> {
  try {
    let data: any = null

    switch (ref.collection) {
      case 'tasks':
        // 從 tasks API 獲取
        const tasks = await systemApi.fetchTasks()
        data = tasks.find((t: any) => t.id === ref.id) || null
        break
      case 'daily_logs':
        data = await nursingApi.fetchDailyLog(ref.id)
        break
      case 'patients':
        data = await patientsApi.fetchById(ref.id)
        break
      default:
        console.warn(`[StandaloneFirestore] 不支援的集合: ${ref.collection}`)
    }

    return {
      id: ref.id,
      exists: () => data !== null,
      data: () => data,
    }
  } catch (error) {
    console.error(`[StandaloneFirestore] 取得文檔失敗:`, error)
    return {
      id: ref.id,
      exists: () => false,
      data: () => null,
    }
  }
}

/**
 * 更新文檔 (standalone 模式)
 */
export async function standaloneUpdateDoc(ref: StandaloneDocRef, data: any): Promise<void> {
  try {
    switch (ref.collection) {
      case 'tasks':
        await systemApi.updateTask(ref.id, data)
        break
      case 'daily_logs':
        await nursingApi.updateDailyLog(ref.id, data)
        break
      case 'patients':
        await patientsApi.update(ref.id, data)
        break
      default:
        console.warn(`[StandaloneFirestore] 不支援更新集合: ${ref.collection}`)
    }
  } catch (error) {
    console.error(`[StandaloneFirestore] 更新文檔失敗:`, error)
    throw error
  }
}

/**
 * 設定文檔 (standalone 模式)
 */
export async function standaloneSetDoc(
  ref: StandaloneDocRef,
  data: any,
  options?: { merge?: boolean }
): Promise<void> {
  try {
    switch (ref.collection) {
      case 'tasks':
        // 先嘗試獲取，如果存在則更新，否則創建
        try {
          await systemApi.updateTask(ref.id, data)
        } catch {
          await systemApi.createTask({ id: ref.id, ...data })
        }
        break
      case 'daily_logs':
        await nursingApi.updateDailyLog(ref.id, data)
        break
      default:
        console.warn(`[StandaloneFirestore] 不支援設定集合: ${ref.collection}`, options)
    }
  } catch (error) {
    console.error(`[StandaloneFirestore] 設定文檔失敗:`, error)
    throw error
  }
}

/**
 * 刪除文檔 (standalone 模式)
 */
export async function standaloneDeleteDoc(ref: StandaloneDocRef): Promise<void> {
  try {
    switch (ref.collection) {
      case 'tasks':
        // 使用軟刪除 - 更新狀態為 deleted
        await systemApi.updateTask(ref.id, { status: 'deleted' })
        break
      default:
        console.warn(`[StandaloneFirestore] 不支援刪除集合: ${ref.collection}`)
    }
  } catch (error) {
    console.error(`[StandaloneFirestore] 刪除文檔失敗:`, error)
    throw error
  }
}

/**
 * 模擬即時監聽 (standalone 模式 - 使用輪詢)
 * 返回取消訂閱函式
 */
export function standaloneOnSnapshot(
  ref: StandaloneDocRef | { collection: string; query?: any },
  callback: (snapshot: any) => void,
  errorCallback?: (error: Error) => void
): () => void {
  let cancelled = false
  let timeoutId: NodeJS.Timeout | null = null

  const fetchData = async () => {
    if (cancelled) return

    try {
      let data: any = null
      const collection = 'collection' in ref ? ref.collection : ref.collection

      if ('id' in ref) {
        // 單一文檔監聽
        const snapshot = await standaloneGetDoc(ref as StandaloneDocRef)
        callback(snapshot)
      } else {
        // 集合查詢監聽
        switch (collection) {
          case 'tasks':
            const tasks = await systemApi.fetchTasks()
            callback({
              docs: tasks.map((t: any) => ({
                id: t.id,
                data: () => t,
              })),
            })
            break
          case 'daily_logs':
            // 單一日期的日誌
            if (ref.query?.date) {
              data = await nursingApi.fetchDailyLog(ref.query.date)
              callback({
                exists: () => data !== null,
                data: () => data,
              })
            }
            break
          default:
            console.warn(`[StandaloneFirestore] 不支援監聽集合: ${collection}`)
            callback({ docs: [] })
        }
      }
    } catch (error) {
      console.error('[StandaloneFirestore] 輪詢錯誤:', error)
      if (errorCallback) {
        errorCallback(error as Error)
      }
    }

    // 30秒後再次輪詢 (可調整)
    if (!cancelled) {
      timeoutId = setTimeout(fetchData, 30000)
    }
  }

  // 立即執行一次
  fetchData()

  // 返回取消訂閱函式
  return () => {
    cancelled = true
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}

/**
 * 檢查是否為單機模式
 */
export function useStandaloneMode() {
  return {
    isStandalone: _isStandalone,
  }
}

export default {
  isStandalone: _isStandalone,
  doc: standaloneDoc,
  getDoc: standaloneGetDoc,
  updateDoc: standaloneUpdateDoc,
  setDoc: standaloneSetDoc,
  deleteDoc: standaloneDeleteDoc,
  onSnapshot: standaloneOnSnapshot,
}
