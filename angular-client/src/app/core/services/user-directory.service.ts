// src/app/core/services/user-directory.service.ts
// Standalone 版：已移除 Firebase，改用 REST API
import { Injectable, inject, signal, computed } from '@angular/core';
import { ApiConfigService } from './api-config.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DirectoryUser {
  id: string;
  uid: string;
  name: string;
  displayName?: string;
  role: string;
  title: string;
  email: string;
  username?: string;
  isActive?: boolean;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable({ providedIn: 'root' })
export class UserDirectoryService {
  private readonly firebaseService = inject(ApiConfigService);

  // -----------------------------------------------------------------------
  // State signals
  // -----------------------------------------------------------------------
  readonly allUsers = signal<DirectoryUser[]>([]);
  readonly isLoading = signal<boolean>(false);

  // -----------------------------------------------------------------------
  // Computed signals
  // -----------------------------------------------------------------------

  /** Map of user ID to DirectoryUser for O(1) lookup. */
  readonly userMap = computed<Map<string, DirectoryUser>>(() => {
    const map = new Map<string, DirectoryUser>();
    for (const user of this.allUsers()) {
      if (user.id) {
        map.set(user.id, user);
      }
      // Also index by uid if it differs from id
      if (user.uid && user.uid !== user.id) {
        map.set(user.uid, user);
      }
    }
    return map;
  });

  /** Map of user name to DirectoryUser for lookup by display name. */
  readonly userNameMap = computed<Map<string, DirectoryUser>>(() => {
    const map = new Map<string, DirectoryUser>();
    for (const user of this.allUsers()) {
      if (user.name) {
        map.set(user.name, user);
      }
    }
    return map;
  });

  /** Only active users. */
  readonly activeUsers = computed<DirectoryUser[]>(() =>
    this.allUsers().filter((u) => u.isActive !== false),
  );

  // -----------------------------------------------------------------------
  // Internal state
  // -----------------------------------------------------------------------
  private hasFetched = false;
  private fetchPromise: Promise<void> | null = null;
  private nextRetryAt = 0;
  private readonly failedRetryDelayMs = 30_000;

  // -----------------------------------------------------------------------
  // Public methods
  // -----------------------------------------------------------------------

  async fetchUsersIfNeeded(): Promise<void> {
    if (this.hasFetched && this.allUsers().length > 0) {
      return;
    }
    if (this.fetchPromise) {
      return this.fetchPromise;
    }

    if (Date.now() < this.nextRetryAt) {
      return;
    }

    this.fetchPromise = this.loadUsers()
      .catch(() => {
        // loadUsers logs the concrete HTTP error. Swallow here so callers do
        // not start independent retry loops when the directory is temporarily unavailable.
      })
      .finally(() => {
        this.fetchPromise = null;
      });

    return this.fetchPromise;
  }

  async refresh(): Promise<void> {
    this.hasFetched = false;
    this.nextRetryAt = 0;

    if (this.fetchPromise) {
      return this.fetchPromise;
    }

    this.fetchPromise = this.loadUsers()
      .catch(() => {
        // See fetchUsersIfNeeded().
      })
      .finally(() => {
        this.fetchPromise = null;
      });

    return this.fetchPromise;
  }

  getUserById(id: string): DirectoryUser | undefined {
    return this.userMap().get(id);
  }

  getUserByName(name: string): DirectoryUser | undefined {
    return this.userNameMap().get(name);
  }

  getDisplayName(idOrUid: string): string {
    const user = this.getUserById(idOrUid);
    return user?.name || idOrUid;
  }

  async ensureUsersLoaded(): Promise<void> {
    return this.fetchUsersIfNeeded();
  }

  get users() {
    return this.allUsers;
  }

  async clearCache(): Promise<void> {
    this.hasFetched = false;
    this.nextRetryAt = 0;
    this.allUsers.set([]);
  }

  // -----------------------------------------------------------------------
  // Private methods
  // -----------------------------------------------------------------------

  private async loadUsers(): Promise<void> {
    if (this.isLoading()) return;

    try {
      this.isLoading.set(true);

      const res = await fetch(`${this.firebaseService.apiBaseUrl}/auth/users/directory`, {
        headers: this.firebaseService.getHeaders(),
      });

      if (!res.ok) {
        const retryAfterSeconds = Number(res.headers.get('Retry-After') || '0');
        const error = new Error(`HTTP ${res.status}: ${res.statusText}`) as Error & {
          retryAfterMs?: number;
        };
        if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
          error.retryAfterMs = retryAfterSeconds * 1000;
        }
        throw error;
      }

      const data = await res.json();
      const rawUsers = Array.isArray(data) ? data : (data.data || data.users || []);

      const users: DirectoryUser[] = rawUsers.map((u: any) => ({
        id: u.id,
        uid: u.uid || u.id,
        name: u.name || '',
        role: u.role || 'viewer',
        title: u.title || '',
        email: u.email || '',
        username: u.username || '',
        isActive: u.isActive !== false,
        ...u,
      }));

      this.allUsers.set(users);
      this.hasFetched = true;

      console.log(
        `[UserDirectoryService] Loaded ${users.length} users`,
      );
    } catch (error) {
      const retryAfterMs =
        typeof (error as { retryAfterMs?: unknown })?.retryAfterMs === 'number'
          ? (error as { retryAfterMs: number }).retryAfterMs
          : this.failedRetryDelayMs;
      this.nextRetryAt = Date.now() + retryAfterMs;
      console.error('[UserDirectoryService] Failed to load users:', error);
      throw error;
    } finally {
      this.isLoading.set(false);
    }
  }
}
