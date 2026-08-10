// src/services/localApiClient.ts
// Standalone 版：共用 REST API 客戶端
// 提供與 Firebase 無關的 fetch wrapper，供 JS service 檔案使用

function getApiBaseUrl(): string {
  // 統一使用相對路徑，開發模式由 proxy.conf.json 轉發到 Express:3000
  return '/api';
}

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const token = sessionStorage.getItem('auth_token');
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

// ---------------------------------------------------------------------------
// 401 集中處理：由 AuthService 註冊 handler，收到 401 時帶上「被登出原因」觸發登出
// ---------------------------------------------------------------------------
export type UnauthorizedReason = 'another_device' | 'expired';
let onUnauthorized: ((reason: UnauthorizedReason) => void) | null = null;

export function setUnauthorizedHandler(fn: (reason: UnauthorizedReason) => void): void {
  onUnauthorized = fn;
}

/**
 * 收到 401 時判斷原因並通知 AuthService。
 * 後端對「已被加入黑名單」的 token 回 code: 'TOKEN_BLACKLISTED'（含 duplicate_login=他處登入）；
 * 對使用中的 session 而言，被黑名單幾乎都是「同帳號在他處登入把這台踢掉」。其餘 401 視為登入逾期。
 */
async function notifyIfUnauthorized(res: Response): Promise<void> {
  if (res.status !== 401) return;
  let code = '';
  try {
    const body = await res.clone().json();
    code = body?.code || '';
  } catch {
    /* 非 JSON 回應，忽略 */
  }
  const reason: UnauthorizedReason = code === 'TOKEN_BLACKLISTED' ? 'another_device' : 'expired';
  onUnauthorized?.(reason);
}

/**
 * 攜帶 HTTP 狀態碼與解析後 body 的錯誤。
 * fetch() 本身不像 Angular HttpClient 會自動保留錯誤回應的 body，
 * 這裡補上，讓呼叫端能判讀如 409 VERSION_CONFLICT 的 { code, currentVersion, ... } 結構。
 */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly body: any;
  constructor(status: number, body: any, message?: string) {
    super(message || `HTTP ${status}`);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = body?.code;
    this.body = body;
  }
}

async function parseErrorBody(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * 通用 REST API 客戶端
 */
export const localApi = {
  get baseUrl() { return getApiBaseUrl(); },
  get headers() { return getAuthHeaders(); },

  async get(path: string): Promise<any> {
    const res = await fetch(`${getApiBaseUrl()}${path}`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      if (res.status === 404) return null;
      await notifyIfUnauthorized(res);
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    return res.json();
  },

  async post(path: string, body: any): Promise<any> {
    const res = await fetch(`${getApiBaseUrl()}${path}`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) { await notifyIfUnauthorized(res); throw new Error(`HTTP ${res.status}: ${res.statusText}`); }
    return res.json();
  },

  async put(path: string, body: any): Promise<any> {
    const res = await fetch(`${getApiBaseUrl()}${path}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      await notifyIfUnauthorized(res);
      const errBody = await parseErrorBody(res);
      throw new ApiRequestError(res.status, errBody, errBody?.message || `HTTP ${res.status}: ${res.statusText}`);
    }
    return res.json();
  },

  async patch(path: string, body: any): Promise<any> {
    const res = await fetch(`${getApiBaseUrl()}${path}`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      await notifyIfUnauthorized(res);
      const errBody = await parseErrorBody(res);
      throw new ApiRequestError(res.status, errBody, errBody?.message || `HTTP ${res.status}: ${res.statusText}`);
    }
    return res.json();
  },

  async delete(path: string): Promise<any> {
    const res = await fetch(`${getApiBaseUrl()}${path}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!res.ok) { await notifyIfUnauthorized(res); throw new Error(`HTTP ${res.status}: ${res.statusText}`); }
    return { success: true };
  },
};

/**
 * Collection → API route 映射
 */
const COLLECTION_ROUTE_MAP: Record<string, string> = {
  patients: '/patients',
  schedules: '/schedules',
  base_schedules: '/schedules/base',
  medications: '/medications',
  orders: '/orders',
  tasks: '/system/tasks',
  nursing_schedules: '/nursing',
  audit_logs: '/system/audit-logs',
  daily_logs: '/nursing/daily-logs',
  config: '/system/site-config',
  nurse_assignments: '/schedules/nurse-assignments',
  kidit_logbook: '/nursing/kidit-logbook',
  exception_requests: '/schedules/exceptions',
  exception_tasks: '/schedules/exception-tasks',     // TODO: 待後端實作
  scheduled_updates: '/system/scheduled-updates',
  inventory_items: '/system/inventory',
  inventory_transactions: '/system/inventory/transactions', // TODO: 待後端實作
  consumable_records: '/orders/consumables',
  auto_assign_configs: '/system/auto-assign-config', // TODO: Phase 3 待實作
  nursing_duties: '/nursing/duties',
  nursing_group_config: '/nursing/group-config',
  dialysis_orders_history: '/orders/history',
  patient_history: '/patients/history',
  bed_inventory_settings: '/orders/bed-settings',    // TODO: Phase 4 待實作
  global_notifications: '/system/notifications',
  expired_schedules: '/schedules/expired',
};

/**
 * 建立一個通用的 REST API CRUD manager。
 * 保持與舊版 Firebase ApiManager 完全相同的 API 介面。
 */
const ApiManager = <T extends { id?: string;[key: string]: unknown }>(resourceType: string) => {
  const route = COLLECTION_ROUTE_MAP[resourceType] || `/${resourceType}`;

  const fetchAll = async (_queryConstraints: any[] = []): Promise<T[]> => {
    try {
      const data = await localApi.get(route);
      return Array.isArray(data) ? data : (data?.data || data?.items || []);
    } catch (error) {
      console.error(`[ApiManager] Error fetching ${resourceType}:`, error);
      throw error;
    }
  };

  // 比照 core/services/api-manager.service.ts 的 fetchWhere$ 寫法：清掉 undefined/null/''
  // 再組 query string，供 2B 效能批次的參數化呼叫點使用（取代整表 fetchAll + 前端 filter）。
  const fetchWhere = async (
    params: Record<string, string | number | undefined>,
  ): Promise<T[]> => {
    const cleaned: Record<string, string> = {};
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') cleaned[k] = String(v);
    }
    const qs = new URLSearchParams(cleaned).toString();
    const url = qs ? `${route}?${qs}` : route;
    try {
      const data = await localApi.get(url);
      return Array.isArray(data) ? data : (data?.data || data?.items || []);
    } catch (error) {
      console.error(`[ApiManager] Error fetching ${resourceType} with params:`, error);
      throw error;
    }
  };

  const fetchById = async (id: string): Promise<T | null> => {
    if (!id || typeof id !== 'string') {
      console.warn(`[ApiManager] fetchById called with invalid ID in ${resourceType}. Returning null.`);
      return null;
    }
    try {
      return await localApi.get(`${route}/${id}`);
    } catch (error) {
      console.error(`[ApiManager] Error fetching document ${id}:`, error);
      throw error;
    }
  };

  const save = async (idOrData: string | T, data?: T): Promise<T> => {
    try {
      if (typeof idOrData === 'object' && data === undefined) {
        return await localApi.post(route, idOrData);
      } else if (typeof idOrData === 'string' && typeof data === 'object') {
        return await localApi.put(`${route}/${idOrData}`, data);
      } else {
        throw new Error('Invalid arguments for save function.');
      }
    } catch (error) {
      console.error(`[ApiManager] Error saving to ${resourceType}:`, error);
      throw error;
    }
  };

  const update = async (id: string, data: Partial<T>): Promise<T> => {
    if (!id || typeof id !== 'string') {
      throw new Error(`[ApiManager] Invalid or missing ID for update in ${resourceType}.`);
    }
    try {
      return await localApi.patch(`${route}/${id}`, data);
    } catch (error) {
      console.error(`[ApiManager] Error updating document ${id}:`, error);
      throw error;
    }
  };

  const deleteDocument = async (id: string): Promise<{ id: string }> => {
    if (!id || typeof id !== 'string') {
      throw new Error(`[ApiManager] Invalid or missing ID for deletion in ${resourceType}.`);
    }
    try {
      await localApi.delete(`${route}/${id}`);
      return { id };
    } catch (error) {
      console.error(`[ApiManager] Error deleting document ${id}:`, error);
      throw error;
    }
  };

  const create = async (data: T): Promise<T> => save(data);

  return {
    fetchAll,
    fetchWhere,
    save,
    update,
    delete: deleteDocument,
    fetchById,
    create,
  };
};

export default ApiManager;
