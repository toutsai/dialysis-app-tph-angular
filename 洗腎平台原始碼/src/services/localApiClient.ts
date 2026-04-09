/**
 * 本地 API 客戶端
 * 用於單機離線模式，取代 Firebase SDK
 */

// 使用相對路徑，讓 vite dev server 代理處理
const API_BASE_URL = import.meta.env.VITE_LOCAL_API_URL || '/api'

// Token 儲存
let authToken: string | null = null

/**
 * 設定認證 Token
 */
export function setAuthToken(token: string | null) {
  authToken = token
  if (token) {
    localStorage.setItem('auth_token', token)
  } else {
    localStorage.removeItem('auth_token')
  }
}

/**
 * 取得認證 Token
 */
export function getAuthToken(): string | null {
  if (!authToken) {
    authToken = localStorage.getItem('auth_token')
  }
  return authToken
}

/**
 * 清除認證 Token
 */
export function clearAuthToken() {
  authToken = null
  localStorage.removeItem('auth_token')
}

/**
 * 通用 API 請求函式
 */
async function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`
  const token = getAuthToken()

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  }

  if (token) {
    ;(headers as Record<string, string>)['Authorization'] = `Bearer ${token}`
  }

  const response = await fetch(url, {
    ...options,
    headers,
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    const error = new Error(errorData.message || `API 錯誤: ${response.status}`)
    ;(error as any).status = response.status
    ;(error as any).data = errorData
    throw error
  }

  return response.json()
}

// ========================================
// 認證 API
// ========================================

export const authApi = {
  /**
   * 登入
   */
  async login(username: string, password: string) {
    const result = await apiRequest<{
      success: boolean
      token: string
      user: {
        id: string
        uid: string
        username: string
        name: string
        title: string
        role: string
        email: string | null
      }
    }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })

    if (result.token) {
      setAuthToken(result.token)
    }

    return result
  },

  /**
   * 登出
   */
  async logout() {
    try {
      await apiRequest('/auth/logout', { method: 'POST' })
    } finally {
      clearAuthToken()
    }
  },

  /**
   * 取得當前使用者
   */
  async getCurrentUser() {
    return apiRequest<{
      id: string
      uid: string
      username: string
      name: string
      title: string
      role: string
      email: string | null
      lastLogin: string
    }>('/auth/me')
  },

  /**
   * 修改密碼
   */
  async changePassword(oldPassword: string, newPassword: string) {
    return apiRequest<{ success: boolean }>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword, newPassword }),
    })
  },

  /**
   * 取得使用者列表 (管理員)
   */
  async getUsers() {
    return apiRequest<any[]>('/auth/users')
  },

  /**
   * 建立使用者 (管理員)
   */
  async createUser(userData: {
    username: string
    password: string
    name: string
    title?: string
    role: string
    email?: string
    // 醫師專屬欄位
    staffId?: string
    phone?: string
    clinicHours?: string[]
    defaultSchedules?: string[]
    defaultConsultationSchedules?: string[]
  }) {
    return apiRequest<{ success: boolean; id: string }>('/auth/users', {
      method: 'POST',
      body: JSON.stringify(userData),
    })
  },

  /**
   * 更新使用者 (管理員)
   */
  async updateUser(
    id: string,
    userData: Partial<{
      name: string
      title: string
      role: string
      email: string
      is_active: boolean
      password: string
      // 醫師專屬欄位
      staffId: string
      phone: string
      clinicHours: string[]
      defaultSchedules: string[]
      defaultConsultationSchedules: string[]
    }>,
  ) {
    return apiRequest<{ success: boolean }>(`/auth/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(userData),
    })
  },

  /**
   * 刪除使用者 (管理員)
   */
  async deleteUser(id: string) {
    return apiRequest<{ success: boolean }>(`/auth/users/${id}`, {
      method: 'DELETE',
    })
  },

  /**
   * 重設使用者密碼 (管理員)
   */
  async resetPassword(userId: string, newPassword: string) {
    return apiRequest<{ success: boolean }>(`/auth/users/${userId}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ newPassword }),
    })
  },
}

// ========================================
// 病人 API
// ========================================

export const patientsApi = {
  /**
   * 取得所有病人
   */
  async fetchAll(includeDeleted = false) {
    const query = includeDeleted ? '?includeDeleted=true' : ''
    return apiRequest<any[]>(`/patients${query}`)
  },

  /**
   * 取得病人（含排班規則）
   */
  async fetchAllWithRules() {
    return apiRequest<any[]>('/patients/with-rules')
  },

  /**
   * 取得單一病人
   */
  async fetchById(id: string) {
    return apiRequest<any>(`/patients/${id}`)
  },

  /**
   * 新增病人
   */
  async create(data: any) {
    return apiRequest<any>('/patients', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  /**
   * 更新病人
   */
  async update(id: string, data: any) {
    return apiRequest<any>(`/patients/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  },

  /**
   * 刪除病人
   */
  async delete(id: string, reason?: string) {
    return apiRequest<{ success: boolean }>(`/patients/${id}`, {
      method: 'DELETE',
      body: JSON.stringify({ reason }),
    })
  },

  /**
   * 復原病人
   */
  async restore(id: string, status?: string) {
    return apiRequest<any>(`/patients/${id}/restore`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    })
  },

  /**
   * 取得病人歷史
   */
  async fetchHistory(patientId?: string) {
    if (patientId) {
      return apiRequest<any[]>(`/patients/history/${patientId}`)
    }
    // 如果沒有指定 patientId，返回所有病人的歷史（或空陣列）
    return apiRequest<any[]>(`/patients/history`)
  },

  /**
   * 建立病人歷史記錄
   */
  async createHistory(data: {
    patientId: string
    changeType: string
    changeData?: any
    notes?: string
  }) {
    return apiRequest<any>('/patients/history', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  // ========================================
  // 病情紀錄 API (Condition Records)
  // ========================================

  /**
   * 取得病情紀錄
   */
  async fetchConditionRecords(patientId?: string) {
    const query = patientId ? `?patientId=${patientId}` : ''
    return apiRequest<any[]>(`/orders/condition-records${query}`)
  },

  /**
   * 儲存病情紀錄
   */
  async saveConditionRecord(data: {
    patientId: string
    patientName?: string
    recordDate?: string
    content: string
    authorId?: string
    authorName?: string
    createdAt?: string | Date
    updatedAt?: string | Date
    expireAt?: Date
  }) {
    return apiRequest<any>('/orders/condition-records', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  /**
   * 更新病情紀錄
   */
  async updateConditionRecord(id: string, data: { content?: string; updatedAt?: string }) {
    return apiRequest<any>(`/orders/condition-records/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  },

  /**
   * 刪除病情紀錄
   */
  async deleteConditionRecord(id: string) {
    return apiRequest<{ success: boolean }>(`/orders/condition-records/${id}`, {
      method: 'DELETE',
    })
  },
}

// ========================================
// 排程 API
// ========================================

export const schedulesApi = {
  /**
   * 取得排程列表
   */
  async fetchAll(params?: { startDate?: string; endDate?: string; date?: string }) {
    const query = new URLSearchParams()
    if (params?.startDate) query.set('startDate', params.startDate)
    if (params?.endDate) query.set('endDate', params.endDate)
    if (params?.date) query.set('date', params.date)
    const queryStr = query.toString()
    return apiRequest<any[]>(`/schedules${queryStr ? `?${queryStr}` : ''}`)
  },

  /**
   * 取得特定日期排程
   */
  async fetchByDate(date: string) {
    return apiRequest<any>(`/schedules/${date}`)
  },

  /**
   * 更新排程
   */
  async updateByDate(date: string, schedule: any) {
    return apiRequest<any>(`/schedules/${date}`, {
      method: 'PUT',
      body: JSON.stringify({ schedule }),
    })
  },

  /**
   * 取得排班總表
   */
  async fetchMasterSchedule() {
    return apiRequest<any>('/schedules/base/master')
  },

  /**
   * 更新排班總表
   */
  async updateMasterSchedule(schedule: any) {
    return apiRequest<any>('/schedules/base/master', {
      method: 'PUT',
      body: JSON.stringify({ schedule }),
    })
  },

  /**
   * 更新單一病人的排班規則
   */
  async updatePatientRule(patientId: string, rule: any) {
    return apiRequest<any>(`/schedules/base/master/patient/${patientId}`, {
      method: 'PATCH',
      body: JSON.stringify(rule),
    })
  },

  /**
   * 取得調班申請列表
   */
  async fetchExceptions(params?: { status?: string; patientId?: string }) {
    const query = new URLSearchParams()
    if (params?.status) query.set('status', params.status)
    if (params?.patientId) query.set('patientId', params.patientId)
    const queryStr = query.toString()
    return apiRequest<any[]>(`/schedules/exceptions/list${queryStr ? `?${queryStr}` : ''}`)
  },

  /**
   * 建立調班申請
   */
  async createException(data: any) {
    return apiRequest<any>('/schedules/exceptions', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  /**
   * 更新調班申請狀態
   */
  async updateException(id: string, data: { status?: string; cancelReason?: string }) {
    return apiRequest<any>(`/schedules/exceptions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  },

  /**
   * 刪除調班申請
   */
  async deleteException(id: string) {
    return apiRequest<{ success: boolean }>(`/schedules/exceptions/${id}`, {
      method: 'DELETE',
    })
  },

  /**
   * 取得單一調班申請（用於輪詢狀態更新）
   */
  async fetchExceptionById(id: string) {
    const list = await apiRequest<any[]>(`/schedules/exceptions/list?id=${id}`)
    return list?.[0] || null
  },

  /**
   * 取得已歸檔排程
   */
  async fetchExpiredSchedule(date: string) {
    return apiRequest<any>(`/schedules/expired/${date}`)
  },

  /**
   * 取得護理分配
   */
  async fetchNurseAssignments(date: string) {
    return apiRequest<any>(`/schedules/nurse-assignments/${date}`)
  },

  /**
   * 更新護理分配
   */
  async updateNurseAssignments(date: string, data: any) {
    // 傳送完整資料：teams, names, takeoffEnabled
    const payload = {
      teams: data.teams || {},
      names: data.names || {},
      takeoffEnabled: data.takeoffEnabled || false,
    }
    return apiRequest<any>(`/schedules/nurse-assignments/${date}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
  },
}

// ========================================
// 備忘錄 API
// ========================================

export const memosApi = {
  async fetchAll(params?: { date?: string; startDate?: string; endDate?: string }) {
    const query = new URLSearchParams()
    if (params?.date) query.set('date', params.date)
    if (params?.startDate) query.set('startDate', params.startDate)
    if (params?.endDate) query.set('endDate', params.endDate)
    const queryStr = query.toString()
    return apiRequest<any[]>(`/memos${queryStr ? `?${queryStr}` : ''}`)
  },

  async create(data: { date: string; content: string }) {
    return apiRequest<any>('/memos', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  async update(id: string, data: { content: string }) {
    return apiRequest<any>(`/memos/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  },

  async delete(id: string) {
    return apiRequest<{ success: boolean }>(`/memos/${id}`, {
      method: 'DELETE',
    })
  },
}

// ========================================
// 醫囑 API
// ========================================

export const ordersApi = {
  /**
   * 取得透析醫囑歷史
   */
  async fetchHistory(params?: {
    patientId?: string
    effectiveDateBefore?: string
    limit?: number
  }) {
    const query = new URLSearchParams()
    if (params?.patientId) query.set('patientId', params.patientId)
    if (params?.effectiveDateBefore) query.set('effectiveDateBefore', params.effectiveDateBefore)
    if (params?.limit) query.set('limit', params.limit.toString())
    const queryStr = query.toString()
    return apiRequest<any[]>(`/orders/history${queryStr ? `?${queryStr}` : ''}`)
  },

  /**
   * 新增透析醫囑
   */
  async createHistory(data: {
    patientId: string
    patientName?: string
    operationType?: string
    orders: any
  }) {
    return apiRequest<any>('/orders/history', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  /**
   * 刪除透析醫囑歷史
   */
  async deleteHistory(id: string) {
    return apiRequest<{ success: boolean }>(`/orders/history/${id}`, {
      method: 'DELETE',
    })
  },

  /**
   * 取得檢驗報告
   */
  async fetchLabReports(params?: { patientId?: string; startDate?: string; endDate?: string }) {
    const query = new URLSearchParams()
    if (params?.patientId) query.set('patientId', params.patientId)
    if (params?.startDate) query.set('startDate', params.startDate)
    if (params?.endDate) query.set('endDate', params.endDate)
    const queryStr = query.toString()
    return apiRequest<any[]>(`/orders/lab-reports${queryStr ? `?${queryStr}` : ''}`)
  },

  /**
   * 新增檢驗報告
   */
  async createLabReport(data: any) {
    return apiRequest<any>('/orders/lab-reports', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  /**
   * 上傳檢驗報告 Excel
   */
  async uploadLabReports(base64Data: string, fileName: string) {
    return apiRequest<{
      success: boolean
      message: string
      processedCount: number
      errorCount: number
      errors?: Array<{ rowData: string; reason: string }>
    }>('/orders/lab-reports/upload', {
      method: 'POST',
      body: JSON.stringify({ fileContent: base64Data, fileName }),
    })
  },

  /**
   * 取得病情記錄
   */
  async fetchConditionRecords(params?: {
    patientId?: string
    startDate?: string
    endDate?: string
    limit?: number
  }) {
    const query = new URLSearchParams()
    if (params?.patientId) query.set('patientId', params.patientId)
    if (params?.startDate) query.set('startDate', params.startDate)
    if (params?.endDate) query.set('endDate', params.endDate)
    if (params?.limit) query.set('limit', params.limit.toString())
    const queryStr = query.toString()
    return apiRequest<any[]>(`/orders/condition-records${queryStr ? `?${queryStr}` : ''}`)
  },

  /**
   * 新增病情記錄
   */
  async createConditionRecord(data: { patientId: string; recordDate?: string; content: string }) {
    return apiRequest<any>('/orders/condition-records', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  /**
   * 取得藥物訂單
   */
  async fetchMedicationOrders(params?: {
    patientId?: string
    startDate?: string
    endDate?: string
  }) {
    const query = new URLSearchParams()
    if (params?.patientId) query.set('patientId', params.patientId)
    if (params?.startDate) query.set('startDate', params.startDate)
    if (params?.endDate) query.set('endDate', params.endDate)
    const queryStr = query.toString()
    return apiRequest<any[]>(`/orders/medications${queryStr ? `?${queryStr}` : ''}`)
  },

  /**
   * 新增藥物訂單
   */
  async createMedicationOrder(data: any) {
    return apiRequest<any>('/orders/medications', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  /**
   * 更新藥物訂單
   */
  async updateMedicationOrder(id: string, data: any) {
    return apiRequest<any>(`/orders/medications/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  },

  /**
   * 刪除藥物訂單
   */
  async deleteMedicationOrder(id: string) {
    return apiRequest<{ success: boolean }>(`/orders/medications/${id}`, {
      method: 'DELETE',
    })
  },

  /**
   * 取得藥物草稿
   */
  async fetchMedicationDrafts(params?: { patientId?: string; authorId?: string }) {
    const query = new URLSearchParams()
    if (params?.patientId) query.set('patientId', params.patientId)
    if (params?.authorId) query.set('authorId', params.authorId)
    const queryStr = query.toString()
    return apiRequest<any[]>(`/orders/medication-drafts${queryStr ? `?${queryStr}` : ''}`)
  },

  /**
   * 新增藥物草稿
   */
  async createMedicationDraft(data: any) {
    return apiRequest<any>('/orders/medication-drafts', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  /**
   * 刪除藥物草稿
   */
  async deleteMedicationDraft(id: string) {
    return apiRequest<{ success: boolean }>(`/orders/medication-drafts/${id}`, {
      method: 'DELETE',
    })
  },

  /**
   * 批次取得多位病人的透析醫囑歷史
   * 用於解決 N+1 查詢問題，一次取得多位病人的最新醫囑
   * @param patientIds - 病人 ID 陣列
   * @param effectiveDateBefore - 可選，篩選生效日期
   * @returns 以 patientId 為 key 的醫囑物件
   */
  async fetchHistoryBatch(params: { patientIds: string[]; effectiveDateBefore?: string }) {
    return apiRequest<Record<string, any | null>>('/orders/history/batch', {
      method: 'POST',
      body: JSON.stringify(params),
    })
  },

  /**
   * 取得透析醫囑歷史 (DialysisOrderModal 用)
   */
  async getDialysisOrderHistory(patientId: string) {
    return apiRequest<any[]>(`/orders/history?patientId=${patientId}`)
  },

  /**
   * 刪除透析醫囑歷史 (DialysisOrderModal 用)
   */
  async deleteDialysisOrderHistory(id: string) {
    return apiRequest<{ success: boolean }>(`/orders/history/${id}`, {
      method: 'DELETE',
    })
  },

  /**
   * 上傳藥囑 Excel (針劑/口服藥)
   */
  async uploadMedications(base64Data: string, fileName: string) {
    return apiRequest<{
      success: boolean
      message: string
      processedCount: number
      errorCount: number
      errors?: Array<{ rowNumber: number; reason: string }>
    }>('/orders/medications/upload', {
      method: 'POST',
      body: JSON.stringify({ fileContent: base64Data, fileName }),
    })
  },

  /**
   * 取得注射藥囑訂單 (Excel 匯入的)
   */
  async fetchInjectionOrders(params?: {
    patientId?: string
    uploadMonth?: string
    orderType?: string
  }) {
    const query = new URLSearchParams()
    if (params?.patientId) query.set('patientId', params.patientId)
    if (params?.uploadMonth) query.set('uploadMonth', params.uploadMonth)
    if (params?.orderType) query.set('orderType', params.orderType)
    const queryStr = query.toString()
    return apiRequest<any[]>(`/orders/injection-orders${queryStr ? `?${queryStr}` : ''}`)
  },
}

// ========================================
// 用藥 API
// ========================================

export const medicationsApi = {
  /**
   * 取得每日針劑清單
   */
  async getDailyInjections(targetDate: string, patientIds: string[]) {
    return apiRequest<any[]>('/medications/daily-injections', {
      method: 'POST',
      body: JSON.stringify({ targetDate, patientIds }),
    })
  },

  /**
   * 取得病人用藥列表
   */
  async fetchByPatient(patientId: string) {
    return apiRequest<any[]>(`/medications/patient/${patientId}`)
  },

  /**
   * 新增用藥記錄
   */
  async create(data: any) {
    return apiRequest<any>('/medications', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  /**
   * 更新用藥記錄
   */
  async update(id: string, data: any) {
    return apiRequest<any>(`/medications/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  },

  /**
   * 刪除用藥記錄
   */
  async delete(id: string) {
    return apiRequest<{ success: boolean }>(`/medications/${id}`, {
      method: 'DELETE',
    })
  },
}

// ========================================
// 檢驗報告 API
// ========================================

export const labReportsApi = {
  /**
   * 取得檢驗報告列表
   * @param params.patientId - 病人 ID (可選)
   * @param params.startDate - 開始日期 YYYY-MM-DD (可選)
   * @param params.endDate - 結束日期 YYYY-MM-DD (可選)
   */
  async fetchAll(params?: { patientId?: string; startDate?: string; endDate?: string }) {
    const query = new URLSearchParams()
    if (params?.patientId) query.set('patientId', params.patientId)
    if (params?.startDate) query.set('startDate', params.startDate)
    if (params?.endDate) query.set('endDate', params.endDate)
    const queryStr = query.toString()
    const reports = await apiRequest<any[]>(`/orders/lab-reports${queryStr ? `?${queryStr}` : ''}`)
    // 將後端的 results 欄位映射為 data，確保與前端元件邏輯相容
    return reports.map((r: any) => ({
      ...r,
      data: r.results || r.data || {},
    }))
  },

  /**
   * 新增檢驗報告
   */
  async create(data: { patientId: string; reportDate: string; reportType?: string; results: any }) {
    return apiRequest<any>('/orders/lab-reports', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  /**
   * 批次新增檢驗報告
   */
  async createBatch(reports: Array<{ patientId: string; reportDate: string; data: any }>) {
    return apiRequest<{ success: boolean; processedCount: number }>('/orders/lab-reports/batch', {
      method: 'POST',
      body: JSON.stringify({ reports }),
    })
  },
}

// ========================================
// 檢驗警示分析 API
// ========================================

export const labAnalysesApi = {
  /**
   * 取得檢驗警示分析列表
   */
  async fetchAll(params?: { patientId?: string; monthRange?: string }) {
    const query = new URLSearchParams()
    if (params?.patientId) query.set('patientId', params.patientId)
    if (params?.monthRange) query.set('monthRange', params.monthRange)
    const queryStr = query.toString()
    return apiRequest<any[]>(`/orders/lab-alert-analyses${queryStr ? `?${queryStr}` : ''}`)
  },

  /**
   * 新增或更新檢驗警示分析 (upsert)
   */
  async save(
    id: string,
    data: {
      patientId: string
      monthRange: string
      abnormalityKey: string
      analysis?: string
      suggestion?: string
    },
  ) {
    return apiRequest<{ success: boolean; id: string }>(`/orders/lab-alert-analyses/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  },
}

// ========================================
// 基礎排班總表 API (兼容 ApiManager 的 fetchById 介面)
// ========================================

export const baseSchedulesApi = {
  /**
   * 取得排班總表 (兼容 ApiManager.fetchById 介面)
   * @param id - 文件 ID，目前只支援 'MASTER_SCHEDULE'
   */
  async fetchById(id: string) {
    if (id === 'MASTER_SCHEDULE') {
      return schedulesApi.fetchMasterSchedule()
    }
    console.warn(`[baseSchedulesApi] 不支援的 ID: ${id}`)
    return null
  },

  /**
   * 更新排班總表 (兼容 ApiManager.update 介面)
   */
  async update(id: string, data: { schedule: any }) {
    if (id === 'MASTER_SCHEDULE') {
      return schedulesApi.updateMasterSchedule(data.schedule)
    }
    console.warn(`[baseSchedulesApi] 不支援更新 ID: ${id}`)
    return null
  },
}

// ========================================
// 護理 API
// ========================================

export const nursingApi = {
  /**
   * 取得護理職責
   */
  async fetchDuties() {
    return apiRequest<any>('/nursing/duties')
  },

  /**
   * 更新護理職責
   */
  async saveDuties(data: any) {
    return apiRequest<any>('/nursing/duties', {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  },

  /**
   * 取得交班日誌
   */
  async fetchHandoverLogs(params?: { date?: string; startDate?: string; endDate?: string }) {
    const query = new URLSearchParams()
    if (params?.date) query.set('date', params.date)
    if (params?.startDate) query.set('startDate', params.startDate)
    if (params?.endDate) query.set('endDate', params.endDate)
    const queryStr = query.toString()
    return apiRequest<any[]>(`/nursing/handover-logs${queryStr ? `?${queryStr}` : ''}`)
  },

  /**
   * 新增交班日誌
   */
  async createHandoverLog(data: any) {
    return apiRequest<any>('/nursing/handover-logs', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  /**
   * 更新交班日誌
   */
  async updateHandoverLog(id: string, data: any) {
    return apiRequest<any>(`/nursing/handover-logs/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  },

  /**
   * 儲存最新交班日誌 (覆蓋 'latest' 文件)
   * 對應 Firebase 版本的 handover_logs/latest
   */
  async saveHandoverLog(data: any) {
    return apiRequest<any>('/nursing/handover-logs/latest', {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  },

  /**
   * 取得最新交班日誌
   */
  async fetchLatestHandoverLog() {
    return apiRequest<any>('/nursing/handover-logs/latest')
  },

  /**
   * 取得每日工作日誌
   */
  async fetchDailyLog(date: string) {
    return apiRequest<any>(`/nursing/daily-logs/${date}`)
  },

  /**
   * 更新每日工作日誌
   */
  async updateDailyLog(date: string, data: any) {
    return apiRequest<any>(`/nursing/daily-logs/${date}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  },

  /**
   * 取得護理組別配置
   */
  async fetchGroupConfig() {
    return apiRequest<any[]>('/nursing/group-config')
  },

  /**
   * 更新護理組別配置
   */
  async updateGroupConfig(id: string, config: any) {
    return apiRequest<any>(`/nursing/group-config/${id}`, {
      method: 'PUT',
      body: JSON.stringify(config),
    })
  },

  /**
   * 上傳護理班表 Excel
   */
  async uploadSchedule(base64Data: string, fileName: string) {
    return apiRequest<{
      success: boolean
      documentId: string
      title: string
      nurseCount: number
    }>('/nursing/schedules/upload', {
      method: 'POST',
      body: JSON.stringify({ fileContentBase64: base64Data, fileName }),
    })
  },

  /**
   * 取得所有護理班表
   */
  async fetchSchedules() {
    return apiRequest<any[]>('/nursing/schedules')
  },

  /**
   * 取得單一護理班表
   */
  async fetchScheduleById(id: string) {
    try {
      return await apiRequest<any>(`/nursing/schedules?id=${id}`)
    } catch (error: any) {
      // 404 表示排班不存在，返回 null 而非拋出錯誤
      if (error.status === 404) {
        return null
      }
      throw error
    }
  },

  /**
   * 更新護理班表
   */
  async updateSchedule(id: string, data: any) {
    return apiRequest<any>(`/nursing/schedules/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  },
}

// ========================================
// Kidit 日誌本 API
// ========================================

export const kiditApi = {
  /**
   * 取得指定日期範圍的 Kidit 日誌本
   */
  async fetchLogbooks(params: {
    year?: number
    month?: number
    startDate?: string
    endDate?: string
  }) {
    const query = new URLSearchParams()
    if (params.year) query.set('year', String(params.year))
    if (params.month) query.set('month', String(params.month))
    if (params.startDate) query.set('startDate', params.startDate)
    if (params.endDate) query.set('endDate', params.endDate)
    const queryStr = query.toString()
    return apiRequest<any[]>(`/nursing/kidit-logbook${queryStr ? `?${queryStr}` : ''}`)
  },

  /**
   * 取得單日 Kidit 日誌本
   */
  async fetchLogbookByDate(date: string) {
    return apiRequest<any>(`/nursing/kidit-logbook/${date}`)
  },

  /**
   * 取代整個事件列表
   */
  async replaceEvents(date: string, events: any[]) {
    return apiRequest<any>(`/nursing/kidit-logbook/${date}/events`, {
      method: 'PUT',
      body: JSON.stringify({ events }),
    })
  },

  /**
   * 更新單筆事件
   */
  async updateEvent(date: string, eventId: string, updates: Record<string, unknown>) {
    return apiRequest<any>(`/nursing/kidit-logbook/${date}/events/${eventId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    })
  },
}

// ========================================
// 系統 API
// ========================================

export const systemApi = {
  /**
   * 健康檢查
   */
  async healthCheck() {
    return apiRequest<{ status: string; timestamp: string; version: string }>('/health')
  },

  /**
   * 取得任務列表
   */
  async fetchTasks(params?: { status?: string; assignedTo?: string }) {
    const query = new URLSearchParams()
    if (params?.status) query.set('status', params.status)
    if (params?.assignedTo) query.set('assignedTo', params.assignedTo)
    const queryStr = query.toString()
    return apiRequest<any[]>(`/system/tasks${queryStr ? `?${queryStr}` : ''}`)
  },

  /**
   * 建立任務
   */
  async createTask(data: any) {
    return apiRequest<any>('/system/tasks', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  /**
   * 儲存任務 (createTask 的別名，保持相容性)
   */
  async saveTask(data: any) {
    return apiRequest<any>('/system/tasks', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  /**
   * 更新任務
   */
  async updateTask(id: string, data: any) {
    return apiRequest<any>(`/system/tasks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  },

  /**
   * 刪除任務
   */
  async deleteTask(id: string) {
    return apiRequest<{ success: boolean }>(`/system/tasks/${id}`, {
      method: 'DELETE',
    })
  },

  /**
   * 取得通知列表
   */
  async fetchNotifications() {
    return apiRequest<any[]>('/system/notifications')
  },

  /**
   * 標記通知已讀
   */
  async markNotificationRead(id: string) {
    return apiRequest<any>(`/system/notifications/${id}/read`, {
      method: 'PATCH',
    })
  },

  /**
   * 建立通知
   */
  async createNotification(data: {
    message: string
    type: string
    createdBy?: { uid: string; name: string }
    expireAt?: string
    metadata?: any
  }) {
    return apiRequest<any>('/system/notifications', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  /**
   * 取得庫存
   */
  async fetchInventory() {
    return apiRequest<any[]>('/system/inventory')
  },

  /**
   * 新增庫存項目
   */
  async createInventoryItem(data: any) {
    return apiRequest<any>('/system/inventory', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  /**
   * 更新庫存項目
   */
  async updateInventoryItem(id: string, data: any) {
    return apiRequest<any>(`/system/inventory/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  },

  /**
   * 刪除庫存項目
   */
  async deleteInventoryItem(id: string) {
    return apiRequest<{ success: boolean }>(`/system/inventory/${id}`, {
      method: 'DELETE',
    })
  },

  /**
   * 取得進貨紀錄列表
   */
  async fetchPurchases(params?: { month?: string; category?: string }) {
    const query = new URLSearchParams()
    if (params?.month) query.set('month', params.month)
    if (params?.category) query.set('category', params.category)
    const queryStr = query.toString()
    return apiRequest<any[]>(`/system/inventory/purchases${queryStr ? `?${queryStr}` : ''}`)
  },

  /**
   * 新增進貨紀錄
   */
  async createPurchase(data: any) {
    return apiRequest<any>('/system/inventory/purchases', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  /**
   * 更新進貨紀錄
   */
  async updatePurchase(id: string, data: any) {
    return apiRequest<any>(`/system/inventory/purchases/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  },

  /**
   * 刪除進貨紀錄
   */
  async deletePurchase(id: string) {
    return apiRequest<{ success: boolean }>(`/system/inventory/purchases/${id}`, {
      method: 'DELETE',
    })
  },

  /**
   * 上傳耗材報表
   */
  async uploadConsumablesReport(data: { reportDate: string; reportData: any[] }) {
    return apiRequest<any>('/system/inventory/consumables/upload', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  /**
   * 查詢耗材消耗
   */
  async fetchConsumablesQuery(params: { month?: string; freq?: string; shift?: string }) {
    const query = new URLSearchParams()
    if (params.month) query.set('month', params.month)
    if (params.freq) query.set('freq', params.freq)
    if (params.shift) query.set('shift', params.shift)
    return apiRequest<any[]>(`/system/inventory/consumables/query?${query.toString()}`)
  },

  /**
   * 取得當月消耗總量
   */
  async fetchMonthlyConsumptionSummary(month: string) {
    return apiRequest<any>(
      `/system/inventory/consumption/monthly-summary?month=${encodeURIComponent(month)}`,
    )
  },

  /**
   * 計算每月盤點
   */
  async fetchMonthlyCalculation(startDate: string, endDate: string) {
    return apiRequest<any>(
      `/system/inventory/monthly/calculation?startDate=${startDate}&endDate=${endDate}`,
    )
  },

  /**
   * 儲存盤點結果
   */
  async saveMonthlyCount(data: any) {
    return apiRequest<any>('/system/inventory/monthly/count', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  /**
   * 取得每週訂單資料
   */
  async fetchWeeklyData(date: string, month: string) {
    return apiRequest<any>(
      `/system/inventory/weekly/data?date=${date}&month=${month}`,
    )
  },

  /**
   * 儲存週盤點
   */
  async saveWeeklyCount(data: any) {
    return apiRequest<any>('/system/inventory/weekly/count', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  /**
   * 取得站點配置
   */
  async fetchSiteConfig(id: string) {
    return apiRequest<any>(`/system/site-config/${id}`)
  },

  /**
   * 更新站點配置
   */
  async updateSiteConfig(id: string, data: any) {
    return apiRequest<any>(`/system/site-config/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  },

  /**
   * 取得稽核日誌 (管理員)
   */
  async fetchAuditLogs(params?: { action?: string; userId?: string; limit?: number }) {
    const query = new URLSearchParams()
    if (params?.action) query.set('action', params.action)
    if (params?.userId) query.set('userId', params.userId)
    if (params?.limit) query.set('limit', params.limit.toString())
    const queryStr = query.toString()
    return apiRequest<any[]>(`/system/audit-logs${queryStr ? `?${queryStr}` : ''}`)
  },

  /**
   * 手動備份資料庫 (管理員)
   */
  async createBackup() {
    return apiRequest<{ success: boolean; backupFile: string }>('/system/backup', {
      method: 'POST',
    })
  },

  /**
   * 取得備份列表 (管理員)
   */
  async fetchBackups() {
    return apiRequest<any[]>('/system/backups')
  },

  /**
   * 取得醫師列表
   */
  async fetchPhysicians() {
    return apiRequest<any[]>('/system/physicians')
  },

  /**
   * 新增醫師
   */
  async createPhysician(data: { name: string; specialty?: string }) {
    return apiRequest<any>('/system/physicians', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  /**
   * 取得醫師班表
   */
  async fetchPhysicianSchedule(date: string) {
    return apiRequest<{
      id: string
      scheduleData: any
      createdAt: string | null
      updatedAt: string | null
    }>(`/system/physician-schedules/${date}`)
  },

  /**
   * 更新醫師班表
   */
  async updatePhysicianSchedule(date: string, scheduleData: any) {
    return apiRequest<any>(`/system/physician-schedules/${date}`, {
      method: 'PUT',
      body: JSON.stringify(scheduleData),
    })
  },

  /**
   * 取得預約變更列表
   */
  async fetchScheduledUpdates(params?: { status?: string; patientId?: string }) {
    const query = new URLSearchParams()
    if (params?.status) query.set('status', params.status)
    if (params?.patientId) query.set('patientId', params.patientId)
    const queryStr = query.toString()
    return apiRequest<any[]>(`/system/scheduled-updates${queryStr ? `?${queryStr}` : ''}`)
  },

  /**
   * 建立預約變更
   */
  async createScheduledUpdate(data: {
    patientId: string
    patientName?: string
    changeType: string
    changeData?: any
    effectiveDate: string
    notes?: string
  }) {
    return apiRequest<{ success: boolean; id: string }>('/system/scheduled-updates', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  /**
   * 更新預約變更
   */
  async updateScheduledUpdate(
    id: string,
    data: {
      changeData?: any
      effectiveDate?: string
      notes?: string
    },
  ) {
    return apiRequest<{ success: boolean; id: string }>(`/system/scheduled-updates/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  },

  /**
   * 取消預約變更
   */
  async cancelScheduledUpdate(id: string) {
    return apiRequest<{ success: boolean }>(`/system/scheduled-updates/${id}`, {
      method: 'DELETE',
    })
  },
}

// ========================================
// 匯出統一介面
// ========================================

export const localApi = {
  auth: authApi,
  patients: patientsApi,
  schedules: schedulesApi,
  baseSchedules: baseSchedulesApi,
  memos: memosApi,
  orders: ordersApi,
  medications: medicationsApi,
  labReports: labReportsApi,
  labAnalyses: labAnalysesApi,
  nursing: nursingApi,
  kidit: kiditApi,
  system: systemApi,
}

export default localApi
