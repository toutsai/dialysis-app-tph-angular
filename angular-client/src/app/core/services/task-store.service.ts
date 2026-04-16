// src/app/core/services/task-store.service.ts
// Standalone 版：已移除 Firebase，改用 REST API + polling
import {
  Injectable,
  inject,
  signal,
  computed,
  OnDestroy,
  DestroyRef,
} from '@angular/core';
import { ApiConfigService } from './api-config.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaskItem {
  id: string;
  patientId?: string;
  patientName?: string;
  content: string;
  type?: string;
  category?: 'task' | 'message';
  status: 'pending' | 'resolved' | 'cancelled';
  targetDate?: string;
  creator: { uid: string; name: string };
  assignee?: { uid: string; name: string };
  createdAt: string | Date;
  resolvedAt?: string | Date | null;
  resolvedBy?: { uid: string; name: string } | null;
  [key: string]: unknown;
}

export interface FeedMessage {
  id: string;
  patientId?: string;
  patientName?: string;
  content: string;
  type?: string;
  category?: string;
  status: string;
  creator: { uid: string; name: string };
  createdAt: string | Date;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get an ISO date string N days ago from today (Taipei timezone). */
function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
}

/** Get today's date as YYYY-MM-DD (Taipei timezone). */
function todayStr(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
}

/** Normalise timestamp / string / Date to a JS Date. */
function toDate(value: string | Date | undefined | null): Date {
  if (!value) return new Date(0);
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') return new Date(value);
  return new Date(0);
}

/** Returns YYYY-MM-DD from a timestamp. */
function toDateStr(
  value: string | Date | undefined | null,
): string {
  const d = toDate(value);
  return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
}

// Retention window
const RETENTION_DAYS = 7;

// Polling interval
const POLL_INTERVAL = 15_000; // 15 seconds

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable({ providedIn: 'root' })
export class TaskStoreService implements OnDestroy {
  private readonly firebaseService = inject(ApiConfigService);
  private readonly destroyRef = inject(DestroyRef);

  // -----------------------------------------------------------------------
  // State signals
  // -----------------------------------------------------------------------
  readonly myTasks = signal<TaskItem[]>([]);
  readonly mySentTasks = signal<TaskItem[]>([]);
  readonly feedMessages = signal<FeedMessage[]>([]);
  readonly feedMessagesVersion = signal<number>(0);
  readonly isLoading = signal<boolean>(false);
  readonly conditionRecordPatientIds = signal<Set<string>>(new Set());

  // -----------------------------------------------------------------------
  // Computed signals
  // -----------------------------------------------------------------------

  /** Feed messages sorted newest-first. */
  readonly sortedFeedMessages = computed<FeedMessage[]>(() => {
    return [...this.feedMessages()].sort(
      (a, b) => toDate(b.createdAt).getTime() - toDate(a.createdAt).getTime(),
    );
  });

  /** Number of pending tasks assigned to the current user today. */
  readonly todayTaskCount = computed<number>(() => {
    const today = todayStr();
    return this.myTasks().filter(
      (t) => t.status === 'pending' && toDateStr(t.targetDate) === today,
    ).length;
  });

  // -----------------------------------------------------------------------
  // Internal polling management
  // -----------------------------------------------------------------------
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private currentUid: string | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => this.stopPolling());
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  // -----------------------------------------------------------------------
  // Public methods
  // -----------------------------------------------------------------------

  /**
   * Begin polling for tasks and messages related to the given user id.
   * Replaces the original Firestore onSnapshot real-time listeners.
   */
  startRealtimeUpdates(uid: string): void {
    // Avoid duplicate polling for the same user
    if (this.currentUid === uid && this.pollTimer) return;

    this.stopPolling();
    this.currentUid = uid;
    this.isLoading.set(true);

    // Do an immediate fetch
    this.pollAllData(uid).finally(() => this.isLoading.set(false));

    // Start periodic polling
    this.pollTimer = setInterval(() => {
      this.pollAllData(uid);
    }, POLL_INTERVAL);

    console.log(
      `[TaskStoreService] Polling started for user ${uid} (every ${POLL_INTERVAL / 1000}s)`,
    );
  }

  /**
   * Stop polling and clear data.
   */
  stopRealtimeUpdates(): void {
    this.stopPolling();
    this.myTasks.set([]);
    this.mySentTasks.set([]);
    this.feedMessages.set([]);
    this.conditionRecordPatientIds.set(new Set());
    this.currentUid = null;
    console.log('[TaskStoreService] Polling stopped');
  }

  /**
   * Build a map from patientId to a Set of message types for a given date.
   */
  getPatientMessageTypesMapForDate(
    dateStr: string,
  ): Map<string, Set<string>> {
    const map = new Map<string, Set<string>>();
    for (const msg of this.feedMessages()) {
      if (toDateStr(msg.createdAt) !== dateStr) continue;
      const pid = msg.patientId;
      if (!pid) continue;
      if (!map.has(pid)) {
        map.set(pid, new Set<string>());
      }
      map.get(pid)!.add(msg.type || '常規');
    }
    return map;
  }

  /**
   * Build a map from patientId to an array of message types for ALL pending
   * messages (no date filter).
   */
  getPendingMessageTypesMap(): Map<string, string[]> {
    const excludedStatuses = new Set(['completed', 'resolved', 'cancelled']);
    const map = new Map<string, Set<string>>();
    for (const msg of this.feedMessages()) {
      if (msg.status && excludedStatuses.has(msg.status)) continue;
      const pid = msg.patientId;
      if (!pid) continue;
      if (!map.has(pid)) {
        map.set(pid, new Set<string>());
      }
      map.get(pid)!.add(msg.type || '常規');
    }
    // Also add 'record' for patients with condition records
    for (const pid of this.conditionRecordPatientIds()) {
      if (!map.has(pid)) {
        map.set(pid, new Set<string>());
      }
      map.get(pid)!.add('record');
    }
    const result = new Map<string, string[]>();
    for (const [pid, types] of map) {
      result.set(pid, Array.from(types));
    }
    return result;
  }

  /**
   * Stop polling timer.
   */
  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  // -----------------------------------------------------------------------
  // Polling implementation
  // -----------------------------------------------------------------------

  private async pollAllData(uid: string): Promise<void> {
    const cutoff = daysAgoISO(RETENTION_DAYS);

    try {
      const [myTasks, sentTasks, feedMessages, conditionIds] = await Promise.all([
        this.fetchMyTasks(uid, cutoff),
        this.fetchSentTasks(uid, cutoff),
        this.fetchFeedMessages(cutoff),
        this.fetchConditionRecordIds(cutoff),
      ]);

      this.myTasks.set(myTasks);
      this.mySentTasks.set(sentTasks);
      this.feedMessages.set(feedMessages);
      this.feedMessagesVersion.update((v) => v + 1);
      this.conditionRecordPatientIds.set(new Set(conditionIds));
    } catch (error) {
      console.error('[TaskStoreService] Polling error:', error);
    }
  }

  private async fetchMyTasks(uid: string, since: string): Promise<TaskItem[]> {
    try {
      const params = new URLSearchParams({ assignee: uid, since });
      const res = await fetch(
        `${this.firebaseService.apiBaseUrl}/system/tasks?${params}`,
        { headers: this.firebaseService.getHeaders() },
      );
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : (data.data || []);
    } catch {
      return [];
    }
  }

  private async fetchSentTasks(uid: string, since: string): Promise<TaskItem[]> {
    try {
      const params = new URLSearchParams({ creator: uid, since });
      const res = await fetch(
        `${this.firebaseService.apiBaseUrl}/system/tasks?${params}`,
        { headers: this.firebaseService.getHeaders() },
      );
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : (data.data || []);
    } catch {
      return [];
    }
  }

  private async fetchFeedMessages(since: string): Promise<FeedMessage[]> {
    try {
      const params = new URLSearchParams({ category: 'message', since });
      const res = await fetch(
        `${this.firebaseService.apiBaseUrl}/system/tasks?${params}`,
        { headers: this.firebaseService.getHeaders() },
      );
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : (data.data || []);
    } catch {
      return [];
    }
  }

  private async fetchConditionRecordIds(since: string): Promise<string[]> {
    try {
      const params = new URLSearchParams({ since });
      const res = await fetch(
        `${this.firebaseService.apiBaseUrl}/orders/condition-records?${params}`,
        { headers: this.firebaseService.getHeaders() },
      );
      if (!res.ok) return [];
      const data = await res.json();
      const items = Array.isArray(data) ? data : (data.data || []);
      return items
        .filter((item: any) => item.patientId)
        .map((item: any) => item.patientId as string);
    } catch {
      return [];
    }
  }
}
