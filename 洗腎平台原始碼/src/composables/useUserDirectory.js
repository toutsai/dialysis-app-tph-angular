// 檔案路徑: src/composables/useUserDirectory.js
// ✨ Standalone 版本

import { ref, readonly } from 'vue'
import { authApi } from '@/services/localApiClient'

const cachedUsers = ref([])
const cachedUserMap = ref(new Map())
const lastFetchedAt = ref(0)
const CACHE_TTL = 10 * 60 * 1000 // 10 minutes
let inflightPromise = null

async function fetchUsersFromBackend() {
  const users = await authApi.getUsers()
  const normalizedUsers = users.map((user) => ({
    uid: user.uid || user.id,
    ...user,
  }))
  cachedUsers.value = normalizedUsers
  cachedUserMap.value = new Map(normalizedUsers.map((user) => [user.uid, user]))
  lastFetchedAt.value = Date.now()
}

export function useUserDirectory() {
  async function ensureUsersLoaded(force = false) {
    const now = Date.now()
    const cacheIsFresh = cachedUsers.value.length > 0 && now - lastFetchedAt.value < CACHE_TTL
    if (!force && cacheIsFresh) {
      return cachedUsers.value
    }

    if (!inflightPromise) {
      inflightPromise = fetchUsersFromBackend()
        .catch((error) => {
          console.error('[useUserDirectory] 無法載入使用者列表:', error)
          throw error
        })
        .finally(() => {
          inflightPromise = null
        })
    }

    await inflightPromise
    return cachedUsers.value
  }

  function clearCachedUsers() {
    cachedUsers.value = []
    cachedUserMap.value = new Map()
    lastFetchedAt.value = 0
  }

  return {
    ensureUsersLoaded,
    clearCachedUsers,
    users: readonly(cachedUsers),
    userMap: readonly(cachedUserMap),
  }
}
