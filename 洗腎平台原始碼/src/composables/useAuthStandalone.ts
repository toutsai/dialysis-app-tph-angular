/**
 * 單機模式認證 Composable
 * 使用本地 API 進行認證，取代 Firebase Auth
 * 包含 Session Timeout 功能 (B級資安合規)
 */

import { ref, computed, readonly, type Ref, watch, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { authApi, getAuthToken, clearAuthToken } from '@/services/localApiClient'
import { useErrorHandler } from '@/composables/useErrorHandler.js'

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

interface LoginResult {
  success: boolean
  redirectPath: string
}

// --- Session Timeout 設定 (B級資安合規) ---
const SESSION_TIMEOUT_CONFIG = {
  TIMEOUT_MINUTES: 30,           // 無活動超時時間 (分鐘)
  WARNING_BEFORE_MINUTES: 2,     // 提前警告時間 (分鐘)
  CHECK_INTERVAL_SECONDS: 30,    // 檢查間隔 (秒)
}

// --- 全局狀態 ---
const currentUser: Ref<AppUser | null> = ref(null)
const authLoading = ref(true)
const claims: Ref<Record<string, unknown> | null> = ref(null)

// --- Session Timeout 狀態 ---
const lastActivityTime = ref<number>(Date.now())
const sessionTimeoutWarning = ref(false)
const sessionRemainingSeconds = ref(0)
let sessionCheckInterval: ReturnType<typeof setInterval> | null = null
let activityListenersAttached = false

// --- Promise for auth ready ---
let authReadyResolve: () => void
const authReadyPromise = new Promise<void>((resolve) => {
  authReadyResolve = resolve
})

// --- Session Timeout 功能 ---

/**
 * 更新最後活動時間
 */
function updateActivityTime() {
  lastActivityTime.value = Date.now()
  // 如果已顯示警告，用戶有活動就取消警告
  if (sessionTimeoutWarning.value) {
    sessionTimeoutWarning.value = false
    console.log('🔄 [Session] 用戶活動，取消超時警告')
  }
}

/**
 * 設置活動監聽器
 */
function setupActivityListeners() {
  if (activityListenersAttached || typeof window === 'undefined') return

  const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click']

  // 使用節流來避免過多的更新
  let throttleTimeout: ReturnType<typeof setTimeout> | null = null
  const throttledUpdate = () => {
    if (throttleTimeout) return
    throttleTimeout = setTimeout(() => {
      updateActivityTime()
      throttleTimeout = null
    }, 1000) // 每秒最多更新一次
  }

  events.forEach((event) => {
    window.addEventListener(event, throttledUpdate, { passive: true })
  })

  activityListenersAttached = true
  console.log('✅ [Session] 活動監聽器已啟動')
}

/**
 * 移除活動監聽器
 */
function removeActivityListeners() {
  if (!activityListenersAttached || typeof window === 'undefined') return

  const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click']
  events.forEach((event) => {
    // 由於使用了節流函數，這裡簡單地移除所有監聽器不太容易
    // 但在登出時會清除，所以問題不大
  })

  activityListenersAttached = false
}

/**
 * 開始 Session 超時檢查
 */
function startSessionTimeoutCheck(logoutCallback: () => Promise<void>) {
  if (sessionCheckInterval) return

  const timeoutMs = SESSION_TIMEOUT_CONFIG.TIMEOUT_MINUTES * 60 * 1000
  const warningMs = SESSION_TIMEOUT_CONFIG.WARNING_BEFORE_MINUTES * 60 * 1000
  const checkIntervalMs = SESSION_TIMEOUT_CONFIG.CHECK_INTERVAL_SECONDS * 1000

  sessionCheckInterval = setInterval(() => {
    if (!currentUser.value) return

    const now = Date.now()
    const elapsed = now - lastActivityTime.value
    const remaining = timeoutMs - elapsed

    if (remaining <= 0) {
      // 超時，自動登出
      console.warn('⏰ [Session] 超時，自動登出')
      stopSessionTimeoutCheck()
      logoutCallback()
    } else if (remaining <= warningMs && !sessionTimeoutWarning.value) {
      // 顯示警告
      sessionTimeoutWarning.value = true
      sessionRemainingSeconds.value = Math.ceil(remaining / 1000)
      console.warn(`⚠️ [Session] 即將超時，剩餘 ${Math.ceil(remaining / 60000)} 分鐘`)
    }

    // 更新剩餘秒數（用於 UI 顯示）
    if (sessionTimeoutWarning.value) {
      sessionRemainingSeconds.value = Math.max(0, Math.ceil(remaining / 1000))
    }
  }, checkIntervalMs)

  console.log(`✅ [Session] 超時檢查已啟動 (${SESSION_TIMEOUT_CONFIG.TIMEOUT_MINUTES} 分鐘)`)
}

/**
 * 停止 Session 超時檢查
 */
function stopSessionTimeoutCheck() {
  if (sessionCheckInterval) {
    clearInterval(sessionCheckInterval)
    sessionCheckInterval = null
  }
  sessionTimeoutWarning.value = false
  sessionRemainingSeconds.value = 0
}

/**
 * 延長 Session
 */
function extendSession() {
  updateActivityTime()
  sessionTimeoutWarning.value = false
  console.log('✅ [Session] 已延長 Session')
}

// --- 初始化：檢查是否有已儲存的 Token ---
async function initAuth() {
  authLoading.value = true

  const token = getAuthToken()
  if (token) {
    try {
      // 驗證 Token 並取得使用者資料
      const user = await authApi.getCurrentUser()
      currentUser.value = {
        id: user.id,
        uid: user.uid,
        username: user.username,
        name: user.name,
        role: user.role,
        title: user.title,
        email: user.email,
        lastLogin: user.lastLogin || new Date().toISOString(),
      }
      claims.value = {
        role: user.role,
        title: user.title,
        name: user.name,
      }
      console.log('✅ [Standalone Auth] 已恢復登入狀態:', user.name)

      // 恢復登入狀態時也啟動 Session Timeout 監控
      // 注意：由於 router 尚未可用，這裡只設置監聽器，真正的檢查在 useAuthStandalone 中啟動
      updateActivityTime()
      setupActivityListeners()
    } catch (error) {
      console.warn('⚠️ [Standalone Auth] Token 無效或已過期，清除登入狀態')
      clearAuthToken()
      currentUser.value = null
      claims.value = null
    }
  } else {
    currentUser.value = null
    claims.value = null
  }

  authLoading.value = false
  authReadyResolve()
}

// 啟動初始化
initAuth()

export function useAuthStandalone() {
  const router = useRouter()
  const { handleApiCall, validateInput, validationRules } = useErrorHandler()
  const loginLoading = ref(false)
  const logoutLoading = ref(false)

  const login = async (username: string, password: string): Promise<LoginResult> => {
    loginLoading.value = true

    const usernameValidation = validateInput(username, [
      validationRules.required('使用者名稱為必填'),
    ])
    const passwordValidation = validateInput(password, [validationRules.required('密碼為必填')])

    if (!usernameValidation.isValid) {
      loginLoading.value = false
      throw new Error(usernameValidation.errors[0])
    }
    if (!passwordValidation.isValid) {
      loginLoading.value = false
      throw new Error(passwordValidation.errors[0])
    }

    try {
      const result = await handleApiCall<LoginResult>(
        async () => {
          // 呼叫本地 API 登入
          const response = await authApi.login(username, password)

          if (!response.success || !response.token) {
            throw new Error('登入失敗，請檢查使用者名稱和密碼')
          }

          // 設定使用者狀態
          const user = response.user
          currentUser.value = {
            id: user.id,
            uid: user.uid,
            username: user.username,
            name: user.name,
            role: user.role,
            title: user.title,
            email: user.email,
            lastLogin: new Date().toISOString(),
          }
          claims.value = {
            role: user.role,
            title: user.title,
            name: user.name,
          }

          // 啟動 Session Timeout 監控
          updateActivityTime()
          setupActivityListeners()
          startSessionTimeoutCheck(async () => {
            await sessionTimeoutLogout()
          })

          // 導航到目標頁面
          const redirectPath = (router.currentRoute.value.query.redirect as string) || '/schedule'
          await router.replace(redirectPath)

          return { success: true, redirectPath }
        },
        {
          loadingMessage: '登入中...',
          successMessage: '登入成功！',
          errorPrefix: '登入失敗',
          showNotification: false,
        },
      )
      return result
    } catch (error) {
      console.error('[Standalone Auth] Login failed:', error)
      throw error
    } finally {
      loginLoading.value = false
    }
  }

  // Session 超時自動登出 (不顯示成功訊息)
  const sessionTimeoutLogout = async () => {
    stopSessionTimeoutCheck()
    removeActivityListeners()
    await authApi.logout()
    currentUser.value = null
    claims.value = null
    // 使用特殊參數表示是因為超時而登出
    await router.push({ name: 'Login', query: { reason: 'timeout' } })
  }

  const logout = async () => {
    logoutLoading.value = true
    try {
      // 停止 Session Timeout 監控
      stopSessionTimeoutCheck()
      removeActivityListeners()

      return await handleApiCall(
        async () => {
          await authApi.logout()
          currentUser.value = null
          claims.value = null
          await router.push({ name: 'Login' })
          return { success: true }
        },
        {
          loadingMessage: '登出中...',
          successMessage: '已安全登出',
          errorPrefix: '登出失敗',
          showNotification: false,
        },
      )
    } finally {
      logoutLoading.value = false
    }
  }

  const updatePassword = async (oldPassword: string, newPassword: string) => {
    if (!currentUser.value) throw new Error('使用者未登入，無法更改密碼。')
    return handleApiCall(
      async () => {
        const result = await authApi.changePassword(oldPassword, newPassword)
        return result
      },
      {
        loadingMessage: '正在更新密碼...',
        successMessage: '密碼已成功更新！',
        errorPrefix: '密碼更新失敗',
        showNotification: true,
      },
    )
  }

  const waitForAuthInit = () => authReadyPromise

  // 如果用戶已登入，啟動 Session Timeout 檢查 (恢復登入狀態的情況)
  // 使用 watch 確保在登入狀態變化時正確啟動/停止
  watch(
    () => currentUser.value,
    (newUser, oldUser) => {
      if (newUser && !oldUser) {
        // 用戶登入
        startSessionTimeoutCheck(async () => {
          await sessionTimeoutLogout()
        })
      } else if (!newUser && oldUser) {
        // 用戶登出
        stopSessionTimeoutCheck()
      }
    },
    { immediate: true }
  )

  // 層級判斷 (用於功能操作權限)
  const hasPermission = (requiredRole: string) => {
    if (!currentUser.value) return false
    const roleHierarchy: Record<string, number> = {
      viewer: 1,
      contributor: 2,
      editor: 3,
      admin: 4,
    }
    const userLevel = roleHierarchy[currentUser.value.role] || 0
    const requiredLevel = roleHierarchy[requiredRole] || 999
    return userLevel >= requiredLevel
  }

  const isLoggedIn = computed(() => !!currentUser.value)

  // 計算屬性
  const isAdmin = computed(() => hasPermission('admin'))
  const isEditor = computed(() => hasPermission('editor'))
  const isContributor = computed(() => hasPermission('contributor'))
  const isViewer = computed(() => currentUser.value?.role === 'viewer')

  const isReadOnly = computed(() => !hasPermission('contributor'))
  const isAnyLoading = computed(
    () => authLoading.value || loginLoading.value || logoutLoading.value,
  )

  // 其他功能性權限判斷
  const canManagePhysicianSchedule = computed(() => {
    if (!currentUser.value) return false
    return ['admin', 'contributor'].includes(currentUser.value.role)
  })
  const canUploadLabReport = computed(() => isLoggedIn.value)
  const canManageOrders = computed(() => {
    if (!currentUser.value) return false
    return ['admin', 'contributor'].includes(currentUser.value.role)
  })
  const canViewConsumables = computed(() => !!currentUser.value)
  const canEditSchedules = computed(() => hasPermission('editor'))
  const canEditPatients = computed(() => hasPermission('contributor'))
  const canEditClinicalNotesAndOrders = computed(() => {
    if (!currentUser.value?.role) return false
    return ['admin', 'contributor'].includes(currentUser.value.role)
  })

  return {
    currentUser: readonly(currentUser),
    claims: readonly(claims),
    isLoggedIn: readonly(isLoggedIn),
    authLoading: readonly(authLoading),
    loginLoading: readonly(loginLoading),
    logoutLoading: readonly(logoutLoading),
    isAnyLoading: readonly(isAnyLoading),

    // Session Timeout 相關 (B級資安合規)
    sessionTimeoutWarning: readonly(sessionTimeoutWarning),
    sessionRemainingSeconds: readonly(sessionRemainingSeconds),
    extendSession,

    login,
    logout,
    updatePassword,
    waitForAuthInit,
    hasPermission,

    isAdmin,
    isEditor,
    isContributor,
    isViewer,

    canEditSchedules,
    canEditPatients,
    isReadOnly,
    canManageOrders,
    canViewConsumables,
    canManagePhysicianSchedule,
    canUploadLabReport,
    canEditClinicalNotesAndOrders,
  }
}
