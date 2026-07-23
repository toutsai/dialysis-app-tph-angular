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
import { AuthService } from './auth.service';

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
  status: string;
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
  targetDate?: string;
  creator: { uid: string; name: string };
  createdAt: string | Date;
  [key: string]: unknown;
}

interface ConditionRecordRef {
  patientId: string;
  recordDate: string;
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

// Pending tasks/messages stay visible; these windows only limit non-pending items.
// 病人資訊流（留言）保留 7 天；收件匣/寄件匣的已完成任務保留 3 個月。
const RETENTION_DAYS = 7;
const TASK_RETENTION_DAYS = 90;

// 職稱 → 角色對照（與 Vue 版 taskStore 一致）：
// 讓收件匣角色指派也比對職稱對應的角色，而非只看 user.role。
const TITLE_TO_ROLE: Record<string, string> = {
  書記: 'clerk',
  主治醫師: 'doctor',
  專科護理師: 'np',
  護理師組長: 'editor',
};

// Polling interval
const POLL_INTERVAL = 15_000; // 15 seconds

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable({ providedIn: 'root' })
export class TaskStoreService implements OnDestroy {
  private readonly firebaseService = inject(ApiConfigService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  // -----------------------------------------------------------------------
  // State signals
  // -----------------------------------------------------------------------
  readonly myTasks = signal<TaskItem[]>([]);
  readonly mySentTasks = signal<TaskItem[]>([]);
  readonly feedMessages = signal<FeedMessage[]>([]);
  readonly feedMessagesVersion = signal<number>(0);
  readonly isLoading = signal<boolean>(false);
  readonly conditionRecordDatesByPatient = signal<Map<string, Set<string>>>(new Map());

  // -----------------------------------------------------------------------
  // Computed signals
  // -----------------------------------------------------------------------

  /**
   * 病人留言板排序：
   * 1) 先依是否已讀分兩群——未讀(含未生效/逾期，status 非 completed/resolved)在上、已讀(completed/resolved)在下。
   * 2) 群內再依「關聯日期」(targetDate) 新→舊。
   * 3) 同一關聯日期再依「建立時間」(createdAt) 新→舊。
   * 無關聯日期的留言以建立日期 fallback。
   */
  readonly sortedFeedMessages = computed<FeedMessage[]>(() => {
    const isRead = (m: FeedMessage) => m.status === 'completed' || m.status === 'resolved';
    return [...this.feedMessages()].sort((a, b) => {
      const ra = isRead(a) ? 1 : 0;
      const rb = isRead(b) ? 1 : 0;
      if (ra !== rb) return ra - rb; // 未讀(0)在上、已讀(1)在下
      const aTarget = toDateStr(a.targetDate ?? a.createdAt);
      const bTarget = toDateStr(b.targetDate ?? b.createdAt);
      if (aTarget !== bTarget) return bTarget < aTarget ? -1 : 1; // 關聯日期 新→舊
      return toDate(b.createdAt).getTime() - toDate(a.createdAt).getTime(); // 同日：建立時間 新→舊
    });
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
    this.conditionRecordDatesByPatient.set(new Map());
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
      if (!this.shouldShowMessageOnDate(msg, dateStr)) continue;
      const pid = msg.patientId;
      if (!pid) continue;
      if (!map.has(pid)) {
        map.set(pid, new Set<string>());
      }
      map.get(pid)!.add(msg.type || '常規');
    }
    for (const [pid, dates] of this.conditionRecordDatesByPatient()) {
      if (!dates.has(dateStr)) continue;
      if (!map.has(pid)) {
        map.set(pid, new Set<string>());
      }
      map.get(pid)!.add('record');
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
    // Also add 'record' for patients with condition records today.
    const today = todayStr();
    for (const [pid, dates] of this.conditionRecordDatesByPatient()) {
      if (!dates.has(today)) continue;
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

  updateItemLocally(
    id: string,
    updates: Partial<TaskItem & FeedMessage>,
  ): void {
    const applyUpdates = <T extends { id: string }>(items: T[]): T[] =>
      items.map((item) => (item.id === id ? { ...item, ...updates } : item));

    this.myTasks.update((items) => applyUpdates(items));
    this.mySentTasks.update((items) => applyUpdates(items));
    this.feedMessages.update((items) => applyUpdates(items));
    this.feedMessagesVersion.update((v) => v + 1);
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
    const taskCutoff = daysAgoISO(TASK_RETENTION_DAYS);

    try {
      const [myTasks, sentTasks, feedMessages, conditionRecords] = await Promise.all([
        this.fetchMyTasks(uid, taskCutoff),
        this.fetchSentTasks(uid, taskCutoff),
        this.fetchFeedMessages(cutoff),
        this.fetchConditionRecords(cutoff),
      ]);

      this.myTasks.set(myTasks);
      this.mySentTasks.set(sentTasks);
      this.feedMessages.set(feedMessages);
      this.feedMessagesVersion.update((v) => v + 1);
      this.conditionRecordDatesByPatient.set(this.buildConditionRecordDateMap(conditionRecords));
    } catch (error) {
      console.error('[TaskStoreService] Polling error:', error);
    }
  }

  private async fetchMyTasks(uid: string, since: string): Promise<TaskItem[]> {
    try {
      const params = new URLSearchParams({ category: 'task', assignee: uid, since });
      const user = this.auth.currentUser();
      // 目標角色 = user.role + 職稱對照角色（去重），以逗號分隔送後端比對
      const roles = new Set<string>();
      if (user?.role) roles.add(user.role);
      const mappedRole = user?.title ? TITLE_TO_ROLE[user.title] : undefined;
      if (mappedRole) roles.add(mappedRole);
      if (roles.size) params.set('assigneeRole', Array.from(roles).join(','));
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
      const params = new URLSearchParams({ category: 'task', creator: uid, since });
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

  private async fetchConditionRecords(since: string): Promise<ConditionRecordRef[]> {
    try {
      const params = new URLSearchParams({ startDate: since });
      const res = await fetch(
        `${this.firebaseService.apiBaseUrl}/orders/condition-records?${params}`,
        { headers: this.firebaseService.getHeaders() },
      );
      if (!res.ok) return [];
      const data = await res.json();
      const items = Array.isArray(data) ? data : (data.data || []);
      return items
        .filter((item: any) => item.patientId && item.recordDate)
        .map((item: any) => ({
          patientId: item.patientId as string,
          recordDate: item.recordDate as string,
        }));
    } catch {
      return [];
    }
  }

  private shouldShowMessageOnDate(msg: FeedMessage, dateStr: string): boolean {
    const excludedStatuses = new Set(['completed', 'resolved', 'cancelled']);
    if (msg.status && excludedStatuses.has(msg.status)) return false; // 已讀/已解決 → 不顯示
    // 調班申請自動產生的交班留言：沒人會手動點完成，只顯示到關聯日當天，過期即退場
    if (msg.type === '調班' && msg.targetDate && dateStr > msg.targetDate) return false;
    // 有關聯日：關聯日「當天起」顯示（dateStr >= targetDate），過期未讀仍持續顯示；
    // 無關聯日：持續顯示。
    if (msg.targetDate) return dateStr >= msg.targetDate;
    return true;
  }

  private buildConditionRecordDateMap(records: ConditionRecordRef[]): Map<string, Set<string>> {
    const map = new Map<string, Set<string>>();
    for (const record of records) {
      if (!map.has(record.patientId)) {
        map.set(record.patientId, new Set<string>());
      }
      map.get(record.patientId)!.add(record.recordDate);
    }
    return map;
  }
}
