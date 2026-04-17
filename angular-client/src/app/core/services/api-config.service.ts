// src/app/core/services/api-config.service.ts
// API 設定服務：提供 baseUrl、token 管理、headers (原 FirebaseService)

import { Injectable } from '@angular/core';

/**
 * 提供本地 API 的基本設定（baseUrl, token 管理等）。
 * 從 FirebaseService 重新命名而來，移除了 db/functions/auth 相容性 stubs。
 */
@Injectable({ providedIn: 'root' })
export class ApiConfigService {
  /**
   * 本地 API 的基底 URL。
   * 開發時指向 localhost:3000，部署後自動使用相對路徑。
   */
  readonly apiBaseUrl: string;

  constructor() {
    // 統一使用相對路徑，開發模式由 proxy.conf.json 轉發到 Express:3000
    this.apiBaseUrl = '/api';
  }

  /**
   * 取得儲存在 localStorage 的 JWT token。
   */
  getToken(): string | null {
    return localStorage.getItem('auth_token');
  }

  /**
   * 儲存 JWT token 到 localStorage。
   */
  setToken(token: string): void {
    localStorage.setItem('auth_token', token);
  }

  /**
   * 移除 JWT token。
   */
  removeToken(): void {
    localStorage.removeItem('auth_token');
  }

  /**
   * 取得帶 Authorization header 的通用 fetch options。
   */
  getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }
}
