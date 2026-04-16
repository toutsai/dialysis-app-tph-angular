// src/app/core/services/notification.service.ts
// Standalone 版：已移除 Firebase，改用 REST API + polling
import {
  Injectable,
  inject,
  signal,
  OnDestroy,
  DestroyRef,
} from '@angular/core';
import { ApiConfigService } from './api-config.service';
import { AuthService } from './auth.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotificationType =
  | 'schedule_change'
  | 'patient_update'
  | 'task_assigned'
  | 'memo'
  | 'alert'
  | 'schedule'
  | 'patient'
  | 'task'
  | 'message'
  | 'order'
  | 'system'
  | 'error'
  | 'success'
  | 'warning'
  | 'info'
  | 'team'
  | 'default';

export interface NotificationConfig {
  icon: string;
  bgColor: string;
  textColor: string;
}

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  createdBy: string;
  createdByName: string;
  createdAt: string | null;
  time: string;
  config: NotificationConfig;
  read?: boolean;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Notification config per type
// ---------------------------------------------------------------------------

const NOTIFICATION_TYPE_CONFIG: Record<string, NotificationConfig> = {
  schedule_change: { icon: '📅', bgColor: '#3498db', textColor: '#fff' },
  schedule: { icon: '📅', bgColor: '#3498db', textColor: '#fff' },
  patient_update: { icon: '👤', bgColor: '#f39c12', textColor: '#fff' },
  patient: { icon: '👤', bgColor: '#f39c12', textColor: '#fff' },
  task_assigned: { icon: '✅', bgColor: '#27ae60', textColor: '#fff' },
  task: { icon: '✅', bgColor: '#e67e22', textColor: '#fff' },
  memo: { icon: '📝', bgColor: '#9b59b6', textColor: '#fff' },
  message: { icon: '💬', bgColor: '#9b59b6', textColor: '#fff' },
  order: { icon: '💊', bgColor: '#27ae60', textColor: '#fff' },
  alert: { icon: '⚠️', bgColor: '#e74c3c', textColor: '#fff' },
  system: { icon: '⚙️', bgColor: '#7f8c8d', textColor: '#fff' },
  error: { icon: '❌', bgColor: '#e74c3c', textColor: '#fff' },
  success: { icon: '✅', bgColor: '#27ae60', textColor: '#fff' },
  warning: { icon: '⚠️', bgColor: '#f39c12', textColor: '#fff' },
  info: { icon: 'ℹ️', bgColor: '#3498db', textColor: '#fff' },
  team: { icon: '👥', bgColor: '#27ae60', textColor: '#fff' },
  conflict: { icon: '⚠️', bgColor: '#e74c3c', textColor: '#fff' },
  exception: { icon: '⚡️', bgColor: '#c0392b', textColor: '#fff' },
  default: { icon: '🔔', bgColor: '#7f8c8d', textColor: '#fff' },
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_NOTIFICATIONS = 10;
const POLL_INTERVAL = 20_000; // 20 seconds

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable({ providedIn: 'root' })
export class NotificationService implements OnDestroy {
  private readonly firebase = inject(ApiConfigService);
  private readonly authService = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  // -----------------------------------------------------------------------
  // State signals
  // -----------------------------------------------------------------------
  readonly notifications = signal<AppNotification[]>([]);

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => this.stopListening());
  }

  ngOnDestroy(): void {
    this.stopListening();
  }

  // -----------------------------------------------------------------------
  // Public methods
  // -----------------------------------------------------------------------

  /**
   * Start polling for global notifications.
   * Replaces the original Firestore onSnapshot listener.
   */
  startListening(): void {
    if (this.pollTimer) return; // Already listening

    console.log('[NotificationService] Starting polling');

    // Immediate fetch
    this.fetchNotifications();

    // Start periodic polling
    this.pollTimer = setInterval(() => {
      this.fetchNotifications();
    }, POLL_INTERVAL);

    console.log('[NotificationService] Polling for notifications');
  }

  /** Backward-compatible alias for startListening(). */
  startListener(): void {
    this.startListening();
  }

  /**
   * Stop the polling and clear local notification data.
   */
  stopListening(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.notifications.set([]);
    console.log('[NotificationService] Stopped listening');
  }

  /** Backward-compatible alias for stopListening(). */
  stopListener(): void {
    this.stopListening();
  }

  /**
   * Create a new global notification via REST API.
   */
  async createGlobalNotification(
    title: string,
    type: NotificationType = 'info',
    message?: string,
  ): Promise<void> {
    try {
      const currentUser = this.authService.currentUser();
      const res = await fetch(`${this.firebase.apiBaseUrl}/system/notifications`, {
        method: 'POST',
        headers: this.firebase.getHeaders(),
        body: JSON.stringify({
          title,
          type,
          message: message || '',
          createdBy: currentUser?.uid || '',
          createdByName: currentUser?.name || '',
          read: false,
        }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      console.log(
        `[NotificationService] Created notification: "${title}" (${type})`,
      );
    } catch (error) {
      console.error(
        '[NotificationService] Failed to create notification:',
        error,
      );
      throw error;
    }
  }

  /** Backward-compatible alias. */
  async createNotification(
    title: string,
    type: NotificationType = 'info',
    message?: string,
  ): Promise<void> {
    return this.createGlobalNotification(title, type, message);
  }

  /** Simple notification convenience method. */
  async show(message: string, type: NotificationType = 'info'): Promise<void> {
    return this.createGlobalNotification(message, type);
  }

  /** Get the config (icon, colors) for a notification type. */
  getConfigForType(type: string): NotificationConfig {
    return (
      NOTIFICATION_TYPE_CONFIG[type] || NOTIFICATION_TYPE_CONFIG['default']
    );
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private async fetchNotifications(): Promise<void> {
    try {
      const params = new URLSearchParams({
        limit: MAX_NOTIFICATIONS.toString(),
        orderBy: 'createdAt',
        order: 'desc',
      });

      const res = await fetch(
        `${this.firebase.apiBaseUrl}/system/notifications?${params}`,
        { headers: this.firebase.getHeaders() },
      );

      if (!res.ok) return;

      const data = await res.json();
      const rawItems = Array.isArray(data) ? data : (data.data || []);

      const items: AppNotification[] = rawItems.map((item: any) => {
        const type = (item.type as NotificationType) || 'default';
        const createdAt = item.createdAt || null;
        const config =
          NOTIFICATION_TYPE_CONFIG[type] ||
          NOTIFICATION_TYPE_CONFIG['default'];

        return {
          id: item.id,
          type,
          title: item.title || '',
          message: item.message || '',
          createdBy: item.createdBy || '',
          createdByName: item.createdByName || '',
          createdAt,
          time: createdAt ? this.formatTime(createdAt) : '',
          config,
          read: item.read || false,
        };
      });

      this.notifications.set(items);
    } catch (error) {
      console.error('[NotificationService] Polling error:', error);
    }
  }

  private formatTime(timestamp: string | Date): string {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return '';

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);

    if (diffMin < 1) return '剛剛';
    if (diffMin < 60) return `${diffMin} 分鐘前`;

    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours} 小時前`;

    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${month}/${day} ${hours}:${minutes}`;
  }
}
