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
// Service
// ---------------------------------------------------------------------------

@Injectable({ providedIn: 'root' })
export class AuthService implements OnDestroy {
  private readonly firebase = inject(ApiConfigService);
  private readonly router = inject(Router);

  // -----------------------------------------------------------------------
  // State signals (保持與 cloud 版相同)
  // -----------------------------------------------------------------------
  readonly currentUser = signal<AppUser | null>(null);
  readonly authLoading = signal<boolean>(true);
  readonly claims = signal<AuthClaims | null>(null);
  readonly isAuthReady = signal<boolean>(false);

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
      this.firebase.removeToken();
      localStorage.removeItem('auth_user');
      this.currentUser.set(null);
      this.claims.set(null);
      if (this.refreshTimer) {
        clearInterval(this.refreshTimer);
        this.refreshTimer = null;
      }
      this.router.navigate(['/login']);
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
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }

    this.refreshTimer = setInterval(async () => {
      try {
        const res = await fetch(
          `${this.firebase.apiBaseUrl}/auth/refresh-token`,
          {
            method: 'POST',
            headers: this.firebase.getHeaders(),
          },
        );

        if (res.ok) {
          const data = await res.json();
          if (data.token) {
            this.firebase.setToken(data.token);
          }
        } else {
          // Token refresh 失敗，可能已過期
          console.warn('[AuthService] Token refresh failed');
        }
      } catch (error) {
        console.warn('[AuthService] Token refresh error:', error);
      }
    }, 30 * 60 * 1000); // 30 minutes
  }
}
