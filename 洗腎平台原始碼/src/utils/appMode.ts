/**
 * 應用程式模式工具
 * 純單機離線版本 - 使用本地 Express.js + SQLite 後端
 */

export type AppMode = 'standalone'

/**
 * 取得當前應用程式模式
 * 永遠返回 standalone（純單機版本）
 */
export function getAppMode(): AppMode {
  return 'standalone'
}

/**
 * 是否為單機模式（永遠為 true）
 */
export function isStandaloneMode(): boolean {
  return true
}

/**
 * 是否為 Firebase 模式（永遠為 false，保留以維持向後相容）
 * @deprecated 純單機版本不使用 Firebase
 */
export function isFirebaseMode(): boolean {
  return false
}

/**
 * 取得 API 基礎 URL
 */
export function getApiBaseUrl(): string {
  return import.meta.env.VITE_LOCAL_API_URL || 'http://localhost:3000/api'
}

/**
 * 記錄當前模式
 */
export function logAppMode(): void {
  console.log('🖥️ 運行模式: 單機離線模式 (Standalone)')
  console.log(`📍 API 位址: ${getApiBaseUrl()}`)
}
