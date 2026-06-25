// src/app/core/services/auth.service.ts
// Standalone 版：JWT-based 本地認證
import {
  Injectable,
  inject,
  signal,
  computed,
  OnDestroy,
} from '@angular/core';
import { Router } from '@angular/router';
import { ApiConfigService } from './api-config.service';
import { DateStateService } from './date-state.service';

// ---------------------------------------------------------------------------
// Types (保持與 cloud 版完全相同)
// ---------------------------------------------------------------------------

export interface AppUser {
  id: string;
  uid: string;
  name: string;
  displayName?: string;
  role: UserRole;
  title: string;
  email: string;
  lastLogin: string;
  [key: string]: unknown;
}

export type UserRole = 'admin' | 'editor' | 'contributor' | 'viewer';

export interface AuthClaims {
  role: UserRole;
  name: string;
  title: string;
  email: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Permission hierarchy
// ---------------------------------------------------------------------------

const ROLE_HIERARCHY: Record<UserRole, number> = {
  viewer: 1,
  contributor: 2,
  editor: 3,
  admin: 4,
} as const;

// ---------------------------------------------------------------------------
// Session Timeout 設定 (B級資安合規) — 對齊 Vue 版 30/2/30
// ---------------------------------------------------------------------------
const SESSION_TIMEOUT_CONFIG = {
  TIMEOUT_MINUTES: 30, // 無活動超時時間 (分鐘)
  WARNING_BEFORE_MINUTES: 2, // 提前警告時間 (分鐘)
  CHECK_INTERVAL_SECONDS: 30, // 檢查間隔 (秒)
} as const;

const ACTIVITY_EVENTS = [
  'mousedown',
  'mousemove',
  'keydown',
  'scroll',
  'touchstart',
  'click',
] as const;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable({ providedIn: 'root' })
export class AuthService implements OnDestroy {
  private readonly firebase = inject(ApiConfigService);
  private readonly router = inject(Router);
  private readonly dateState = inject(DateStateService);

  // -----------------------------------------------------------------------
  // State signals (保持與 cloud 版相同)
  // -----------------------------------------------------------------------
  readonly currentUser = signal<AppUser | null>(null);
  readonly authLoading = signal<boolean>(true);
  readonly claims = signal<AuthClaims | null>(null);
  readonly isAuthReady = signal<boolean>(false);

  // Session Timeout 狀態 (B級資安合規)
  readonly sessionTimeoutWarning = signal<boolean>(false);
  readonly sessionRemainingSeconds = signal<number>(0);

  // -----------------------------------------------------------------------
  // Computed signals
  // -----------------------------------------------------------------------
  readonly isLoggedIn = computed(() => !!this.currentUser());
  readonly isAdmin = computed(() => this.hasPermission('admin'));
  readonly isEditor = computed(() => this.hasPermission('editor'));
  readonly isContributor = computed(() => this.hasPermission('contributor'));
  readonly isViewer = computed(() => this.currentUser()?.role === 'viewer');

  readonly canEditSchedules = computed(() => this.hasPermission('editor'));
  readonly canEditPatients = computed(() => this.hasPermission('editor'));
  readonly canManageOrders = computed(() => this.hasPermission('contributor'));
  readonly canManagePhysicianSchedule = computed(() =>
    this.hasPermission('editor'),
  );
  readonly canEditClinicalNotesAndOrders = computed(() => {
    const role = this.currentUser()?.role;
    return role === 'admin' || role === 'contributor';
  });

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------
  private authReadyResolve: (() => void) | null = null;
  private readonly authReadyPromise: Promise<void>;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  // Session Timeout 內部狀態
  private lastActivityTime = Date.now();
  private sessionCheckInterval: ReturnType<typeof setInterval> | null = null;
  private activityHandler: (() => void) | null = null;
  private activityThrottleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.authReadyPromise = new Promise<void>((resolve) => {
      this.authReadyResolve = resolve;
    });

    // 嘗試從 localStorage 恢復登入狀態
    this.restoreSession();
  }

  ngOnDestroy(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }
    this.stopSessionTimeoutCheck();
  }

  // -----------------------------------------------------------------------
  // Public methods
  // -----------------------------------------------------------------------

  /**
   * Login using the local Express API.
   */
  async login(
    username: string,
    password: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      this.authLoading.set(true);

      const res = await fetch(`${this.firebase.apiBaseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const result = await res.json();

      if (!res.ok || !result.token) {
        return { success: false, error: result.message || '登入失敗' };
      }

      // 儲存 JWT token
      this.firebase.setToken(result.token);

      // 設定使用者資料
      const user: AppUser = {
        id: result.user.id,
        uid: result.user.id,
        name: result.user.name || result.user.username,
        role: result.user.role || 'viewer',
        title: result.user.title || '',
        email: result.user.email || '',
        lastLogin: new Date().toISOString(),
      };

      this.currentUser.set(user);
      this.claims.set({
        role: user.role,
        name: user.name,
        title: user.title,
        email: user.email,
      });

      // 儲存使用者資料到 localStorage（用於 session 恢復）
      localStorage.setItem('auth_user', JSON.stringify(user));

      console.log(`[AuthService] User signed in: ${user.name} (${user.role})`);

      // 定時 refresh token
      this.startTokenRefresh();
      // 啟動閒置自動登出監控
      this.startSessionTimeoutCheck();

      return { success: true };
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : '登入失敗，請稍後再試';
      console.error('[AuthService] Login failed:', message);
      return { success: false, error: message };
    } finally {
      this.authLoading.set(false);
    }
  }

  /**
   * Sign out and redirect to /login.
   */
  async logout(): Promise<void> {
    try {
      // 通知 server
      await fetch(`${this.firebase.apiBaseUrl}/auth/logout`, {
        method: 'POST',
        headers: this.firebase.getHeaders(),
      }).catch(() => {});
    } finally {
      await this.clearBrowserStorage();
      this.currentUser.set(null);
      this.claims.set(null);
      if (this.refreshTimer) {
        clearInterval(this.refreshTimer);
        this.refreshTimer = null;
      }
      this.stopSessionTimeoutCheck();
      this.router.navigate(['/login']);
    }
  }

  private async clearBrowserStorage(): Promise<void> {
    this.firebase.removeToken();
    this.dateState.clear();

    try {
      localStorage.clear();
    } catch (error) {
      console.warn('[AuthService] Failed to clear localStorage:', error);
    }

    try {
      sessionStorage.clear();
    } catch (error) {
      console.warn('[AuthService] Failed to clear sessionStorage:', error);
    }

    try {
      if ('caches' in window) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
      }
    } catch (error) {
      console.warn('[AuthService] Failed to clear Cache Storage:', error);
    }
  }

  /**
   * Change the current user's password via local API.
   */
  async updatePassword(
    oldPassword: string,
    newPassword: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const res = await fetch(
        `${this.firebase.apiBaseUrl}/auth/change-password`,
        {
          method: 'POST',
          headers: this.firebase.getHeaders(),
          body: JSON.stringify({ oldPassword, newPassword }),
        },
      );

      const result = await res.json();

      if (!res.ok) {
        return { success: false, error: result.message || '密碼更新失敗' };
      }

      return { success: true };
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : '密碼更新失敗';
      console.error('[AuthService] Password change failed:', message);
      return { success: false, error: message };
    }
  }

  /**
   * Check whether the current user has at least the given role level.
   */
  hasPermission(requiredRole: UserRole): boolean {
    const user = this.currentUser();
    if (!user) return false;
    const userLevel = ROLE_HIERARCHY[user.role] ?? 0;
    const requiredLevel = ROLE_HIERARCHY[requiredRole] ?? Infinity;
    return userLevel >= requiredLevel;
  }

  /**
   * Returns a Promise that resolves once the initial auth state has been
   * determined.
   */
  waitForAuthInit(): Promise<void> {
    return this.authReadyPromise;
  }

  clearError(): void {}

  // -----------------------------------------------------------------------
  // Private methods
  // -----------------------------------------------------------------------

  /**
   * 從 localStorage 恢復之前的 session。
   */
  private async restoreSession(): Promise<void> {
    try {
      const token = this.firebase.getToken();
      const savedUser = localStorage.getItem('auth_user');

      if (token && savedUser) {
        // 驗證 token 是否仍然有效
        const res = await fetch(`${this.firebase.apiBaseUrl}/auth/me`, {
          headers: this.firebase.getHeaders(),
        });

        if (res.ok) {
          const user = JSON.parse(savedUser) as AppUser;
          this.currentUser.set(user);
          this.claims.set({
            role: user.role,
            name: user.name,
            title: user.title,
            email: user.email,
          });
          this.startTokenRefresh();
          this.startSessionTimeoutCheck();
          console.log(
            `[AuthService] Session restored: ${user.name} (${user.role})`,
          );
        } else {
          // Token 過期，清除
          this.firebase.removeToken();
          localStorage.removeItem('auth_user');
        }
      }
    } catch (error) {
      console.warn('[AuthService] Failed to restore session:', error);
      this.firebase.removeToken();
      localStorage.removeItem('auth_user');
    } finally {
      this.authLoading.set(false);
      this.isAuthReady.set(true);
      this.authReadyResolve?.();
    }
  }

  /**
   * 定時 refresh JWT token（每 30 分鐘）。
   */
  private startTokenRefresh(): void {
    // 清掉既有計時器（重新登入 / 恢復 session 時）
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }

    // ⚠️ 2026-06-25 停用 JWT token 30 分輪替，對齊醫院原本的 Vue 版（Vue 無 token 輪替，後端也無
    // /auth/refresh-token）。原本每 30 分呼叫 POST /api/auth/refresh-token 換新 token，但後端是
    // 「先作廢舊 token 再回傳新 token」，中間空窗若有背景輪詢用到舊 token 會 401 被踢。
    // 改用單純的 24h token + 30 分閒置登出（與 Vue 一致）。觀察「很快被登出」是否仍發生。
    // 若要恢復輪替：還原本方法為每 30 分 fetch('/auth/refresh-token') 成功後 setToken(新 token)。
  }

  // -----------------------------------------------------------------------
  // Session Timeout（閒置自動登出，B級資安合規）— 對齊 Vue 版 30/2/30
  // -----------------------------------------------------------------------

  /** 使用者有活動時更新時間戳；若正顯示警告則取消 */
  private updateActivityTime(): void {
    this.lastActivityTime = Date.now();
    if (this.sessionTimeoutWarning()) {
      this.sessionTimeoutWarning.set(false);
    }
  }

  /** 掛上活動監聽器（節流，每秒最多更新一次） */
  private setupActivityListeners(): void {
    if (this.activityHandler || typeof window === 'undefined') return;
    const throttled = () => {
      if (this.activityThrottleTimer) return;
      this.activityThrottleTimer = setTimeout(() => {
        this.updateActivityTime();
        this.activityThrottleTimer = null;
      }, 1000);
    };
    this.activityHandler = throttled;
    ACTIVITY_EVENTS.forEach((evt) =>
      window.addEventListener(evt, throttled, { passive: true }),
    );
  }

  /** 移除活動監聽器 */
  private removeActivityListeners(): void {
    if (typeof window !== 'undefined' && this.activityHandler) {
      ACTIVITY_EVENTS.forEach((evt) =>
        window.removeEventListener(evt, this.activityHandler!),
      );
    }
    this.activityHandler = null;
    if (this.activityThrottleTimer) {
      clearTimeout(this.activityThrottleTimer);
      this.activityThrottleTimer = null;
    }
  }

  /** 啟動閒置超時檢查 */
  private startSessionTimeoutCheck(): void {
    if (this.sessionCheckInterval) return;
    this.updateActivityTime();
    this.setupActivityListeners();

    const timeoutMs = SESSION_TIMEOUT_CONFIG.TIMEOUT_MINUTES * 60 * 1000;
    const warningMs = SESSION_TIMEOUT_CONFIG.WARNING_BEFORE_MINUTES * 60 * 1000;
    const checkMs = SESSION_TIMEOUT_CONFIG.CHECK_INTERVAL_SECONDS * 1000;

    this.sessionCheckInterval = setInterval(() => {
      if (!this.currentUser()) return;

      const remaining = timeoutMs - (Date.now() - this.lastActivityTime);

      if (remaining <= 0) {
        console.warn('[AuthService] 閒置逾時，自動登出');
        this.stopSessionTimeoutCheck();
        this.logout();
        return;
      }

      if (remaining <= warningMs) {
        if (!this.sessionTimeoutWarning()) {
          this.sessionTimeoutWarning.set(true);
        }
        this.sessionRemainingSeconds.set(Math.max(0, Math.ceil(remaining / 1000)));
      }
    }, checkMs);

    console.log(
      `[AuthService] 閒置超時檢查已啟動 (${SESSION_TIMEOUT_CONFIG.TIMEOUT_MINUTES} 分鐘)`,
    );
  }

  /** 停止閒置超時檢查 */
  private stopSessionTimeoutCheck(): void {
    if (this.sessionCheckInterval) {
      clearInterval(this.sessionCheckInterval);
      this.sessionCheckInterval = null;
    }
    this.removeActivityListeners();
    this.sessionTimeoutWarning.set(false);
    this.sessionRemainingSeconds.set(0);
  }

  /** 由警告視窗「繼續使用」呼叫，延長 session */
  extendSession(): void {
    this.updateActivityTime();
    this.sessionTimeoutWarning.set(false);
  }
}
