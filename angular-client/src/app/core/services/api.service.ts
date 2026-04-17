// src/app/core/services/api.service.ts
// 通用 REST API 服務：使用 HttpClient，回傳 Observable<T>

import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';

// ---------------------------------------------------------------------------
// Collection → API route mapping (統一維護，取代分散在各處的重複定義)
// ---------------------------------------------------------------------------

export const COLLECTION_ROUTE_MAP: Record<string, string> = {
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
  exception_tasks: '/schedules/exception-tasks',
  scheduled_updates: '/system/scheduled-updates',
  inventory_items: '/system/inventory',
  inventory_transactions: '/system/inventory/transactions',
  consumable_records: '/orders/consumables',
  marquee_settings: '/system/marquee',
  auto_assign_configs: '/system/auto-assign-config',
  // 共用元件/服務遷移所需的映射
  condition_records: '/orders/condition-records',
  handover_logs: '/nursing/handover-logs',
  patient_history: '/patients/history',
  dialysis_orders_history: '/orders/history',
  medication_orders: '/orders/medications',
  medication_drafts: '/orders/medication-drafts',
  lab_reports: '/orders/lab-reports',
  schedule_exceptions: '/schedules/exceptions',
  physician_schedules: '/system/physician-schedules',
  site_config: '/system/site-config',
  // 庫存管理 (TPH: 全部在 /system/inventory 下)
  inventory_purchases: '/system/inventory/purchases',
  inventory_counts: '/system/inventory/monthly/count',
  consumables_reports: '/system/inventory/consumables/query',
  bed_inventory_settings: '/orders/bed-settings',
  machine_bicarbonate_config: '/orders/machine-bicarbonate-config',
  // 其他
  users: '/auth/users',
  expired_schedules: '/schedules/expired',
  scheduled_changes: '/system/scheduled-changes',
  lab_alert_analyses: '/orders/lab-alert-analyses',
  scheduled_patient_updates: '/system/scheduled-updates',
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  readonly baseUrl: string;

  constructor() {
    // 統一使用相對路徑，開發模式由 proxy.conf.json 轉發到 Express:3000
    this.baseUrl = '/api';
  }

  // -----------------------------------------------------------------------
  // 路由解析
  // -----------------------------------------------------------------------

  /** 將 collection 名稱解析為完整的 API URL */
  resolveUrl(collection: string, id?: string): string {
    const route = COLLECTION_ROUTE_MAP[collection] || `/${collection}`;
    const url = `${this.baseUrl}${route}`;
    return id ? `${url}/${id}` : url;
  }

  // -----------------------------------------------------------------------
  // 通用 CRUD 方法
  // -----------------------------------------------------------------------

  /** GET 請求 */
  get<T>(url: string, params?: Record<string, string>): Observable<T> {
    let httpParams = new HttpParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        httpParams = httpParams.set(key, value);
      });
    }
    return this.http.get<T>(`${this.baseUrl}${url}`, { params: httpParams });
  }

  /** POST 請求 */
  post<T>(url: string, body: unknown): Observable<T> {
    return this.http.post<T>(`${this.baseUrl}${url}`, body);
  }

  /** PUT 請求 */
  put<T>(url: string, body: unknown): Observable<T> {
    return this.http.put<T>(`${this.baseUrl}${url}`, body);
  }

  /** PATCH 請求 */
  patch<T>(url: string, body: unknown): Observable<T> {
    return this.http.patch<T>(`${this.baseUrl}${url}`, body);
  }

  /** DELETE 請求 */
  delete<T>(url: string): Observable<T> {
    return this.http.delete<T>(`${this.baseUrl}${url}`);
  }

  // -----------------------------------------------------------------------
  // 回應解包輔助
  // -----------------------------------------------------------------------

  /**
   * 解包 API 回應：處理 { data: [...] } 和 [...] 兩種格式
   * 用法：this.api.get('/patients').pipe(this.api.unwrapList())
   */
  unwrapList<T>() {
    return (source: Observable<unknown>): Observable<T[]> =>
      source.pipe(
        map((response: unknown) => {
          if (Array.isArray(response)) return response as T[];
          if (response && typeof response === 'object') {
            const obj = response as Record<string, unknown>;
            if (Array.isArray(obj['data'])) return obj['data'] as T[];
            if (Array.isArray(obj['items'])) return obj['items'] as T[];
          }
          return [];
        }),
      );
  }
}
