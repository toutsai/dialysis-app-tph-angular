/**
 * 認證 Composable - Standalone 版本
 * 使用本地 Express + JWT 認證
 */

import { useAuthStandalone } from './useAuthStandalone'

// 匯出型別
export interface AppUser {
  id: string
  uid: string
  username: string
  name: string
  role: string
  title: string
  email: string | null
  lastLogin: string
}

/**
 * 統一的認證 Composable
 */
export function useAuth() {
  return useAuthStandalone()
}
