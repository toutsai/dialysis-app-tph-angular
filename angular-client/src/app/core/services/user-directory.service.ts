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

  // -----------------------------------------------------------------------
  // Public methods
  // -----------------------------------------------------------------------

  async fetchUsersIfNeeded(): Promise<void> {
    if (this.hasFetched && this.allUsers().length > 0) {
      return;
    }
    await this.loadUsers();
  }

  async refresh(): Promise<void> {
    this.hasFetched = false;
    await this.loadUsers();
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
    return this.refresh();
  }

  // -----------------------------------------------------------------------
  // Private methods
  // -----------------------------------------------------------------------

  private async loadUsers(): Promise<void> {
    if (this.isLoading()) return;

    try {
      this.isLoading.set(true);

      const res = await fetch(`${this.firebaseService.apiBaseUrl}/auth/users`, {
        headers: this.firebaseService.getHeaders(),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
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
      console.error('[UserDirectoryService] Failed to load users:', error);
      throw error;
    } finally {
      this.isLoading.set(false);
    }
  }
}
