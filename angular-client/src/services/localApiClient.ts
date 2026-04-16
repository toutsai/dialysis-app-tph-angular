// src/services/localApiClient.ts
// Standalone 版：共用 REST API 客戶端
// 提供與 Firebase 無關的 fetch wrapper，供 JS service 檔案使用

function getApiBaseUrl(): string {
  const port = window.location.port;
  const isDev = port === '5173' || port === '4200' || port === '4201';
  return isDev ? 'http://localhost:3000/api' : '/api';
}

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const token = localStorage.getItem('auth_token');
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
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
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return res.json();
  },

  async put(path: string, body: any): Promise<any> {
    const res = await fetch(`${getApiBaseUrl()}${path}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return res.json();
  },

  async patch(path: string, body: any): Promise<any> {
    const res = await fetch(`${getApiBaseUrl()}${path}`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return res.json();
  },

  async delete(path: string): Promise<any> {
    const res = await fetch(`${getApiBaseUrl()}${path}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
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
  memos: '/memos',
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
  marquee_settings: '/system/marquee',               // TODO: 待後端實作
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
    save,
    update,
    delete: deleteDocument,
    fetchById,
    create,
  };
};

export default ApiManager;
