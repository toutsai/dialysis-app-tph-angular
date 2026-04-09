/**
 * 本地 API 管理器
 * 提供與 ApiManager 相同的介面，但使用本地 REST API
 */

import { patientsApi, schedulesApi, memosApi, ordersApi, nursingApi, systemApi, authApi } from './localApiClient'

type FirestoreRecord = { id?: string; [key: string]: unknown }

type ApiManagerReturn<T extends FirestoreRecord> = {
  fetchAll: (queryConstraints?: any[]) => Promise<T[]>
  save: (idOrData: string | T, data?: T) => Promise<T>
  update: (id: string, data: Partial<T>) => Promise<T>
  delete: (id: string) => Promise<{ id: string }>
  fetchById: (id: string) => Promise<T | null>
  create: (data: T) => Promise<T>
}

// 資源類型到 API 的映射
const resourceApiMap: Record<string, any> = {
  // 病人相關
  patients: patientsApi,
  patient_history: {
    fetchAll: async () => {
      try {
        return await patientsApi.fetchHistory()
      } catch {
        console.log('[LocalApiManager] patient_history: 返回空陣列')
        return []
      }
    },
  },

  // 排程相關
  schedules: {
    fetchAll: (params?: any) => {
      // Convert params object to API format if needed
      if (params && typeof params === 'object' && !Array.isArray(params)) {
        return schedulesApi.fetchAll(params)
      }
      return schedulesApi.fetchAll()
    },
    fetchByDate: (date: string) => schedulesApi.fetchByDate(date),
    updateByDate: (date: string, schedule: any) => schedulesApi.updateByDate(date, schedule),
  },
  base_schedules: {
    fetchAll: () => schedulesApi.fetchMasterSchedule().then(s => s ? [s] : []),
    fetchById: (id: string) => {
      // For base_schedules, the ID is always 'MASTER_SCHEDULE'
      return schedulesApi.fetchMasterSchedule()
    },
    save: (_id: string, data: any) => schedulesApi.updateMasterSchedule(data),
  },
  schedule_exceptions: {
    fetchAll: () => schedulesApi.fetchExceptions(),
    create: (data: any) => schedulesApi.createException(data),
    update: (id: string, data: any) => schedulesApi.updateException(id, data),
    delete: (id: string) => schedulesApi.deleteException(id),
  },
  nurse_assignments: {
    fetchAll: () => Promise.resolve([]),
    fetchById: (date: string) => schedulesApi.fetchNurseAssignments(date),
    save: (date: string, data: any) => schedulesApi.updateNurseAssignments(date, data),
  },
  // 已歸檔排程（歷史排程）
  expired_schedules: {
    fetchAll: async (params?: any) => {
      // Use schedules API with date range for historical data
      // Note: This assumes schedules in the past are considered "expired"
      if (params?.startDate && params?.endDate) {
        return schedulesApi.fetchAll(params)
      }
      console.log('[LocalApiManager] expired_schedules.fetchAll called without date range, returning empty array')
      return []
    },
  },
  // 排程病人更新
  scheduled_patient_updates: {
    fetchAll: async (params?: any) => systemApi.fetchScheduledUpdates(params),
    create: async (data: any) => systemApi.createScheduledUpdate(data),
    update: async (id: string, data: any) => systemApi.updateScheduledUpdate(id, data),
    delete: async (id: string) => systemApi.cancelScheduledUpdate(id),
  },

  // 備忘錄
  memos: memosApi,

  // 醫囑相關
  dialysis_orders_history: {
    fetchAll: (patientId?: string) => ordersApi.fetchHistory(patientId),
    create: (data: any) => ordersApi.createHistory(data),
    delete: (id: string) => ordersApi.deleteHistory(id),
  },
  lab_reports: {
    fetchAll: (params?: any) => ordersApi.fetchLabReports(params),
    create: (data: any) => ordersApi.createLabReport(data),
  },
  condition_records: {
    fetchAll: (patientId?: string) => ordersApi.fetchConditionRecords(patientId),
    create: (data: any) => ordersApi.createConditionRecord(data),
  },
  medication_orders: {
    fetchAll: (params?: any) => ordersApi.fetchMedicationOrders(params),
    create: (data: any) => ordersApi.createMedicationOrder(data),
    update: (id: string, data: any) => ordersApi.updateMedicationOrder(id, data),
    delete: (id: string) => ordersApi.deleteMedicationOrder(id),
  },
  medication_drafts: {
    fetchAll: (params?: any) => ordersApi.fetchMedicationDrafts(params),
    create: (data: any) => ordersApi.createMedicationDraft(data),
    delete: (id: string) => ordersApi.deleteMedicationDraft(id),
  },

  // 護理相關
  nursing_duties: {
    fetchAll: () => nursingApi.fetchDuties().then(d => d ? [d] : []),
    save: (_id: string, data: any) => nursingApi.saveDuties(data),
  },
  handover_logs: {
    fetchAll: (params?: any) => nursingApi.fetchHandoverLogs(params),
    create: (data: any) => nursingApi.createHandoverLog(data),
    update: (id: string, data: any) => nursingApi.updateHandoverLog(id, data),
  },
  daily_logs: {
    fetchAll: async (params?: any) => {
      // Note: Backend doesn't support date range queries yet for daily_logs
      // This is a temporary implementation that returns empty array
      console.warn('[LocalApiManager] daily_logs.fetchAll with date range is not yet implemented in backend')
      return []
    },
    fetchById: (date: string) => nursingApi.fetchDailyLog(date),
    save: (date: string, data: any) => nursingApi.updateDailyLog(date, data),
  },
  nursing_group_config: {
    fetchAll: () => nursingApi.fetchGroupConfig(),
    update: (id: string, data: any) => nursingApi.updateGroupConfig(id, data),
  },
  nursing_schedules: {
    fetchAll: () => nursingApi.fetchSchedules(),
    fetchById: (id: string) => nursingApi.fetchScheduleById(id),
    update: (id: string, data: any) => nursingApi.updateSchedule(id, data),
  },

  // 系統相關
  tasks: {
    fetchAll: (params?: any) => systemApi.fetchTasks(params),
    create: (data: any) => systemApi.createTask(data),
    update: (id: string, data: any) => systemApi.updateTask(id, data),
  },
  notifications: {
    fetchAll: () => systemApi.fetchNotifications(),
    create: (data: any) => systemApi.createNotification(data),
    update: (id: string) => systemApi.markNotificationRead(id),
  },
  inventory_items: {
    fetchAll: () => systemApi.fetchInventory(),
    create: (data: any) => systemApi.createInventoryItem(data),
    update: (id: string, data: any) => systemApi.updateInventoryItem(id, data),
  },
  site_config: {
    fetchById: (id: string) => systemApi.fetchSiteConfig(id),
    save: (id: string, data: any) => systemApi.updateSiteConfig(id, data),
  },
  audit_logs: {
    fetchAll: (params?: any) => systemApi.fetchAuditLogs(params),
  },
  physicians: {
    fetchAll: () => systemApi.fetchPhysicians(),
    create: (data: any) => systemApi.createPhysician(data),
  },
  physician_schedules: {
    fetchAll: async () => {
      // 醫師班表沒有 fetchAll，返回空陣列
      console.log('[LocalApiManager] physician_schedules.fetchAll: 返回空陣列')
      return []
    },
    fetchById: async (id: string) => {
      // 取得班表並展開 scheduleData 到頂層
      console.log(`[LocalApiManager] physician_schedules.fetchById: 請求 id=${id}`)
      const result = await systemApi.fetchPhysicianSchedule(id)
      console.log(`[LocalApiManager] physician_schedules.fetchById: 後端回傳`, result)
      if (!result) return null
      // 後端返回 { id, scheduleData: {...}, createdAt, updatedAt }
      // 前端期望 { id, schedule: {...}, consultationSchedule: {...}, notes: "...", ... }
      const { scheduleData, ...rest } = result
      const transformed = { ...rest, ...(scheduleData || {}) }
      console.log(`[LocalApiManager] physician_schedules.fetchById: 轉換後`, transformed)
      return transformed
    },
    save: (id: string, data: any) => systemApi.updatePhysicianSchedule(id, data),
    update: (id: string, data: any) => systemApi.updatePhysicianSchedule(id, data),
  },

  // 使用者相關
  users: {
    fetchAll: () => authApi.getUsers(),
    fetchById: async (id: string) => {
      const users = await authApi.getUsers()
      return users.find((u: any) => u.id === id) || null
    },
    create: (data: any) => authApi.createUser(data),
    update: (id: string, data: any) => authApi.updateUser(id, data),
    delete: (id: string) => authApi.deleteUser(id),
  },
}

/**
 * 創建本地 API 管理器
 * @param resourceType - 資源類型 (集合名稱)
 */
const LocalApiManager = <T extends FirestoreRecord>(resourceType: string): ApiManagerReturn<T> => {
  const api = resourceApiMap[resourceType]

  if (!api) {
    console.warn(`[LocalApiManager] 未知的資源類型: ${resourceType}，使用預設空實作`)
  }

  const fetchAll = async (queryConstraints: any = []): Promise<T[]> => {
    try {
      if (api?.fetchAll) {
        // Handle both array (old Firestore style) and object (new API style) params
        let params = queryConstraints
        if (Array.isArray(queryConstraints)) {
          // For array params (old Firestore where clauses), pass to API as-is
          // The resource-specific handler will deal with conversion if needed
          params = queryConstraints
        }
        const result = await api.fetchAll(params)
        return Array.isArray(result) ? result : []
      }
      console.warn(`[LocalApiManager] ${resourceType} 不支援 fetchAll`)
      return []
    } catch (error) {
      console.error(`[LocalApiManager] Error fetching ${resourceType}:`, error)
      throw error
    }
  }

  const fetchById = async (id: string): Promise<T | null> => {
    try {
      if (api?.fetchById) {
        return await api.fetchById(id)
      }
      // 如果沒有 fetchById，嘗試用 fetchAll 後篩選
      if (api?.fetchAll) {
        const all = await api.fetchAll()
        return all.find((item: any) => item.id === id) || null
      }
      console.warn(`[LocalApiManager] ${resourceType} 不支援 fetchById`)
      return null
    } catch (error) {
      console.error(`[LocalApiManager] Error fetching ${resourceType} by ID:`, error)
      throw error
    }
  }

  const create = async (data: T): Promise<T> => {
    try {
      if (api?.create) {
        return await api.create(data)
      }
      console.warn(`[LocalApiManager] ${resourceType} 不支援 create`)
      return data
    } catch (error) {
      console.error(`[LocalApiManager] Error creating ${resourceType}:`, error)
      throw error
    }
  }

  const save = async (idOrData: string | T, data?: T): Promise<T> => {
    try {
      // 情況一：新增 (addDoc)
      if (typeof idOrData === 'object' && data === undefined) {
        return create(idOrData)
      }
      // 情況二：指定 ID 更新/建立
      if (typeof idOrData === 'string' && typeof data === 'object') {
        if (api?.save) {
          return await api.save(idOrData, data)
        }
        if (api?.update) {
          return await api.update(idOrData, data)
        }
        console.warn(`[LocalApiManager] ${resourceType} 不支援 save`)
        return { id: idOrData, ...data }
      }
      throw new Error('Invalid arguments for save function')
    } catch (error) {
      console.error(`[LocalApiManager] Error saving ${resourceType}:`, error)
      throw error
    }
  }

  const update = async (id: string, data: Partial<T>): Promise<T> => {
    try {
      if (api?.update) {
        return await api.update(id, data)
      }
      console.warn(`[LocalApiManager] ${resourceType} 不支援 update`)
      return { id, ...(data as T) }
    } catch (error) {
      console.error(`[LocalApiManager] Error updating ${resourceType}:`, error)
      throw error
    }
  }

  const deleteDocument = async (id: string): Promise<{ id: string }> => {
    try {
      if (api?.delete) {
        await api.delete(id)
        return { id }
      }
      console.warn(`[LocalApiManager] ${resourceType} 不支援 delete`)
      return { id }
    } catch (error) {
      console.error(`[LocalApiManager] Error deleting ${resourceType}:`, error)
      throw error
    }
  }

  return {
    fetchAll,
    save,
    update,
    delete: deleteDocument,
    fetchById,
    create,
  }
}

export default LocalApiManager
