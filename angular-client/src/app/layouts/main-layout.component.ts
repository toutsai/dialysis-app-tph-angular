// src/app/layouts/main-layout.component.ts
// Standalone 版：已移除 Firebase，改用 REST API + polling
import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  signal,
  computed,
  effect,
  untracked,
  DestroyRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  Router,
  ActivatedRoute,
  RouterOutlet,
  RouterLink,
  RouterLinkActive,
  NavigationEnd,
} from '@angular/router';
import { filter, map } from 'rxjs/operators';
import { Subscription } from 'rxjs';
import { environment } from '@env/environment';
import { AuthService } from '@services/auth.service';
import { SseEventsService } from '@services/sse-events.service';
import {
  NotificationService,
  type AppNotification,
} from '@services/notification.service';
import { TaskStoreService } from '@services/task-store.service';
import { PatientStoreService } from '@services/patient-store.service';
import { ApiConfigService } from '@services/api-config.service';
import {
  ApiManagerService,
  type ApiManager,
  type FirestoreRecord,
} from '@services/api-manager.service';
import { MemoDisplayDialogComponent } from '@app/components/dialogs/memo-display-dialog/memo-display-dialog.component';
import { UpdateBannerComponent } from '@app/components/update-banner/update-banner.component';
import { getToday } from '@/utils/dateUtils';
import {
  canAccessPage as userCanAccessPage,
  type PageKey,
} from '@app/core/config/page-access';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EnvironmentTag {
  text: string;
  class: string;
}

interface MemoItem {
  id: string;
  patientId?: string;
  patientName?: string;
  status?: string;
  [key: string]: unknown;
}

interface AssignmentRecord extends FirestoreRecord {
  date?: string;
  names?: Record<string, string>;
  teams?: Record<
    string,
    { nurseTeam?: string; nurseTeamIn?: string; nurseTeamOut?: string }
  >;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MemoDisplayDialogComponent,
    UpdateBannerComponent,
  ],
  templateUrl: './main-layout.component.html',
  styleUrl: './main-layout.component.css',
})
export class MainLayoutComponent implements OnInit, OnDestroy {
  // -------------------------------------------------------------------------
  // Injected services
  // -------------------------------------------------------------------------
  readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly activatedRoute = inject(ActivatedRoute);
  readonly notificationService = inject(NotificationService);
  readonly taskStoreService = inject(TaskStoreService);
  private readonly patientStoreService = inject(PatientStoreService);
  private readonly firebaseService = inject(ApiConfigService);
  private readonly apiManagerService = inject(ApiManagerService);
  private readonly sseEvents = inject(SseEventsService);
  private readonly destroyRef = inject(DestroyRef);

  // -------------------------------------------------------------------------
  // Sidebar state
  // -------------------------------------------------------------------------
  readonly isSidebarOpen = signal(false);
  readonly isManagementSectionCollapsed = signal(true);

  // -------------------------------------------------------------------------
  // Conflict count (schedule_exceptions with unresolved conflicts)
  // -------------------------------------------------------------------------
  readonly conflictCount = signal(0);
  private conflictPollTimer: ReturnType<typeof setInterval> | null = null;
  private conflictSseSubscriptions: Subscription[] = [];
  private conflictBadgeDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  // -------------------------------------------------------------------------
  // Session Timeout 警告（閒置自動登出，B級資安合規）
  // -------------------------------------------------------------------------
  readonly sessionTimeoutWarning = this.authService.sessionTimeoutWarning;
  readonly formattedRemainingTime = computed(() => {
    const seconds = this.authService.sessionRemainingSeconds();
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return minutes > 0 ? `${minutes} 分 ${remainingSeconds} 秒` : `${remainingSeconds} 秒`;
  });

  extendSession(): void {
    this.authService.extendSession();
  }

  // -------------------------------------------------------------------------
  // Today's assigned patient IDs (for memo notification count)
  // -------------------------------------------------------------------------
  readonly todayMyPatientIds = signal<string[]>([]);
  private assignmentsApi: ApiManager<AssignmentRecord>;

  // -------------------------------------------------------------------------
  // Memo system (Vue provide/inject equivalent)
  // -------------------------------------------------------------------------
  // 2B 效能批次：memo 資料改由 TaskStoreService 既有 15s 輪詢(category=message)供應，
  // 不再單獨打 tasksApi.fetchAll() 整表。TaskStore 的 since 參數後端會 `OR status='pending'`
  // 恆保留所有待處理留言（src/routes/system.js:66-75），故此 computed 對 pending 留言的
  // 篩選結果與舊版 fetchActiveMemos()（fetchAll 後前端濾 category+pending）完全等價。
  readonly activeMemos = computed<MemoItem[]>(() =>
    this.taskStoreService
      .feedMessages()
      .filter((m) => m.status === 'pending')
      .map((m) => ({ ...m }) as MemoItem),
  );
  readonly isMemoDialogVisible = signal(false);
  readonly patientNameForDialog = signal('');
  readonly memosForDialog = signal<MemoItem[]>([]);
  private patientRefreshTimer: ReturnType<typeof setInterval> | null = null;

  /** Set of patient IDs that have pending memos. */
  readonly patientWithMemoIds = computed<Set<string>>(
    () =>
      new Set(
        this.activeMemos()
          .filter((memo) => memo.patientId && memo.status === 'pending')
          .map((memo) => memo.patientId!),
      ),
  );

  // -------------------------------------------------------------------------
  // Notification count (pending tasks + relevant memos)
  // -------------------------------------------------------------------------
  readonly notificationCount = computed(() => {
    if (!this.authService.currentUser()) return 0;
    const myPendingTasksCount = this.taskStoreService
      .myTasks()
      .filter((t) => t.status === 'pending').length;
    const myPendingMemosCount = this.todayRelevantMemosCount(
      this.todayMyPatientIds(),
    );
    return myPendingTasksCount + myPendingMemosCount;
  });

  // -------------------------------------------------------------------------
  // Current page title from route data
  // -------------------------------------------------------------------------
  readonly currentPageTitle = signal('\u900F\u6790\u7BA1\u7406');

  // -------------------------------------------------------------------------
  // Environment tag
  // -------------------------------------------------------------------------
  readonly environmentTag = computed<EnvironmentTag | null>(() => {
    const hostname = window.location.hostname;
    if (hostname.includes('develop') || hostname === 'localhost') {
      return { text: 'Angular版', class: 'env-tag-dev' };
    }
    return { text: 'Angular版', class: 'env-tag-prod' };
  });

  canAccessPage(pageKey: PageKey): boolean {
    return userCanAccessPage(pageKey, this.authService.currentUser()?.role);
  }

  /** 專師專用頁面（admin 或 職稱「專科護理師」） */
  canAccessSpecialist(): boolean {
    return this.authService.isSpecialist();
  }

  constructor() {
    this.assignmentsApi =
      this.apiManagerService.create<AssignmentRecord>('nurse_assignments');

    // Watch auth state: start/stop listeners when user logs in/out
    // Uses untracked() so only currentUser() is a tracked dependency
    effect(() => {
      const user = this.authService.currentUser();
      untracked(() => {
        if (user) {
          this.notificationService.startListening();
          this.startConflictListener();
          this.fetchTodayAssignedPatients();
          this.taskStoreService.startRealtimeUpdates(user.uid);
          this.startPatientRefreshTimer();
        } else {
          // activeMemos 為 computed，會隨 taskStoreService.stopRealtimeUpdates() 清空的
          // feedMessages() 自動歸零，不需再手動 set([])。
          sessionStorage.removeItem('hasCheckedSchedules');
          this.notificationService.stopListening();
          this.stopConflictListener();
          this.patientStoreService.reset();
          this.todayMyPatientIds.set([]);
          this.taskStoreService.stopRealtimeUpdates();
          this.stopPatientRefreshTimer();
        }
      });
    });
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  ngOnInit(): void {
    // Listen to route changes: update page title + close sidebar on mobile
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        map(() => this.getDeepestRouteTitle()),
      )
      .subscribe((title) => {
        this.currentPageTitle.set(
          title || '\u900F\u6790\u7BA1\u7406',
        );
        // Close sidebar on mobile when route changes (Vue: watch route.path)
        if (typeof window !== 'undefined' && window.innerWidth <= 992) {
          this.closeSidebar();
        }
      });

    // Set initial page title
    this.currentPageTitle.set(
      this.getDeepestRouteTitle() || '\u900F\u6790\u7BA1\u7406',
    );

    // Fetch patient data
    this.patientStoreService.fetchPatientsIfNeeded();

    // Register cleanup
    this.destroyRef.onDestroy(() => {
      this.cleanup();
    });
  }

  ngOnDestroy(): void {
    this.cleanup();
  }

  // -------------------------------------------------------------------------
  // Public methods (used in template)
  // -------------------------------------------------------------------------

  toggleSidebar(): void {
    this.isSidebarOpen.update((open) => !open);
  }

  closeSidebar(): void {
    this.isSidebarOpen.set(false);
  }

  toggleManagement(): void {
    this.isManagementSectionCollapsed.update((c) => !c);
  }

  handleNotificationClick(notif: AppNotification): void {
    const action = notif['action'];
    if (action && typeof action === 'function') {
      (action as () => void)();
    }
  }

  async handleLogout(): Promise<void> {
    await this.authService.logout();
  }

  showPatientMemos(patientId: string): void {
    if (!patientId) return;
    const patient = this.patientStoreService.patientMap().get(patientId);
    const memoPatientName = this.activeMemos().find(
      (m) => m.patientId === patientId,
    )?.patientName;
    if (!patient && !memoPatientName) return;
    this.memosForDialog.set(
      this.activeMemos().filter(
        (memo) => memo.patientId === patientId && memo.status === 'pending',
      ),
    );
    this.patientNameForDialog.set(patient?.name ?? memoPatientName ?? '');
    this.isMemoDialogVisible.set(true);
  }

  closeMemoDialog(): void {
    this.isMemoDialogVisible.set(false);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /** Count memos relevant to today's assigned patients (matches Vue todayRelevantMemosCount). */
  private todayRelevantMemosCount(patientIds: string[]): number {
    if (!patientIds || patientIds.length === 0) return 0;
    const idSet = new Set(patientIds);
    const today = getToday(); // YYYY-MM-DD
    return this.taskStoreService.feedMessages().filter(
      (memo) =>
        memo.status === 'pending' &&
        memo.patientId &&
        idSet.has(memo.patientId as string) &&
        // targetDate <= today (or no targetDate means always relevant)
        (!memo['targetDate'] || (memo['targetDate'] as string) <= today) &&
        // Must have content and not be a system-generated message
        memo['content'] &&
        !(memo['content'] as string).startsWith('【'),
    ).length;
  }

  private readonly PATIENT_REFRESH_INTERVAL = 5 * 60_000; // 5 minutes

  /**
   * 每 5 分鐘背景重抓病人主檔。
   * 病人 store 是一次性載入（hasFetched 守門），久開不重整的分頁會一直沿用舊資料；
   * 背景強制重抓讓其他使用者的異動最多 5 分鐘內反映到畫面，毋須整頁重整。
   */
  private startPatientRefreshTimer(): void {
    if (this.patientRefreshTimer) return;
    this.patientRefreshTimer = setInterval(() => {
      // 錯誤已在 store 內記錄；背景輪詢失敗不打擾使用者，等下一輪再試
      this.patientStoreService.forceRefreshPatients().catch(() => {});
    }, this.PATIENT_REFRESH_INTERVAL);
  }

  private stopPatientRefreshTimer(): void {
    if (this.patientRefreshTimer) {
      clearInterval(this.patientRefreshTimer);
      this.patientRefreshTimer = null;
    }
  }

  // 事件驅動（SSE exception$）為主；此輪詢降為 fallback，故從 20s 放寬到 120s。
  private readonly CONFLICT_POLL_INTERVAL = 120_000; // 120 seconds (fallback only)
  private readonly CONFLICT_BADGE_DEBOUNCE_MS = 500;

  /** Start polling for conflict count. Replaces Firebase onSnapshot. */
  private startConflictListener(): void {
    if (!(this.authService.isAdmin() || this.authService.isEditor())) return;
    if (this.conflictPollTimer) return;
    this.fetchConflictCount();
    this.conflictPollTimer = setInterval(() => this.fetchConflictCount(), this.CONFLICT_POLL_INTERVAL);
    // 事件驅動：調班/例外異動即觸發（輕度 debounce 防連發）；SSE 斷線恢復後也補刷一次。
    this.conflictSseSubscriptions.push(
      this.sseEvents.exception$.subscribe(() => this.debouncedFetchConflictCount()),
      this.sseEvents.connectionRestored$.subscribe(() => this.debouncedFetchConflictCount()),
    );
  }

  private debouncedFetchConflictCount(): void {
    if (this.conflictBadgeDebounceTimer) clearTimeout(this.conflictBadgeDebounceTimer);
    this.conflictBadgeDebounceTimer = setTimeout(() => {
      this.conflictBadgeDebounceTimer = null;
      this.fetchConflictCount();
    }, this.CONFLICT_BADGE_DEBOUNCE_MS);
  }

  /**
   * Fetch conflict count via REST API.
   *
   * 2B 效能批次：只帶 status=conflict_requires_resolution 給後端(exact 欄位比對,語意不變)，
   * 不帶 startDate/endDate ——後端的日期篩選只比對 schedule_exceptions 的 date/start_date/
   * end_date 三個頂層欄位(src/routes/schedules.js:1060-1068)，但 shouldShowConflictBadge 是
   * 比對 from/to/patient1/patient2 內嵌 JSON 的多個日期欄位取最大值，兩者語意不等價；
   * 若加上後端日期參數可能誤刪仍應顯示的衝突徽章，故日期篩選保留在前端不變，僅靠 status
   * 縮小資料量（大多數 exceptions 非 conflict_requires_resolution 狀態）。
   */
  private async fetchConflictCount(): Promise<void> {
    try {
      const exceptionsApi = this.apiManagerService.create<FirestoreRecord>('exception_requests');
      const conflictStatusRecords = await exceptionsApi.fetchWhere({
        status: 'conflict_requires_resolution',
      });
      const today = getToday();
      const conflicts = conflictStatusRecords.filter((e: any) =>
        this.shouldShowConflictBadge(e, today),
      );
      this.conflictCount.set(conflicts.length);
    } catch (error) {
      console.error('Conflict polling error:', error);
      this.conflictCount.set(0);
    }
  }

  private shouldShowConflictBadge(exceptionData: any, today: string): boolean {
    if (exceptionData?.status !== 'conflict_requires_resolution') return false;

    const expireAt = this.normalizeDateString(exceptionData.expireAt);
    if (expireAt && expireAt < today) return false;

    const latestAffectedDate = this.getLatestAffectedDate(exceptionData);
    // If the record is malformed, keep the badge visible so an active conflict
    // is not hidden silently.
    return !latestAffectedDate || latestAffectedDate >= today;
  }

  private getLatestAffectedDate(exceptionData: any): string | null {
    const candidates = [
      exceptionData?.date,
      exceptionData?.startDate,
      exceptionData?.endDate,
      exceptionData?.from?.sourceDate,
      exceptionData?.from?.date,
      exceptionData?.to?.goalDate,
      exceptionData?.to?.date,
      exceptionData?.patient1?.date,
      exceptionData?.patient2?.date,
    ]
      .map((value) => this.normalizeDateString(value))
      .filter((value): value is string => !!value)
      .sort();

    return candidates[candidates.length - 1] ?? null;
  }

  private normalizeDateString(value: unknown): string | null {
    if (!value) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.toISOString().slice(0, 10);
    }
    const match = String(value).match(/^\d{4}-\d{2}-\d{2}/);
    return match ? match[0] : null;
  }

  /** Stop the conflict polling timer + SSE subscriptions. */
  private stopConflictListener(): void {
    if (this.conflictPollTimer) {
      clearInterval(this.conflictPollTimer);
      this.conflictPollTimer = null;
      this.conflictCount.set(0);
    }
    this.conflictSseSubscriptions.forEach((sub) => sub.unsubscribe());
    this.conflictSseSubscriptions = [];
    if (this.conflictBadgeDebounceTimer) {
      clearTimeout(this.conflictBadgeDebounceTimer);
      this.conflictBadgeDebounceTimer = null;
    }
  }

  /** Fetch today's nurse assignment to determine assigned patients. */
  private async fetchTodayAssignedPatients(): Promise<void> {
    const currentUser = this.authService.currentUser();
    if (
      !currentUser ||
      !(this.authService.isEditor() || this.authService.isAdmin())
    ) {
      this.todayMyPatientIds.set([]);
      return;
    }
    const today = getToday();
    try {
      // nurse_assignments 沒有 list 端點，必須以 fetchById(date) 取當日分組。
      // 裸 fetchAll() 會打到不存在的 GET /schedules/nurse-assignments 而失敗，
      // 導致 todayMyPatientIds 恆為空、側欄留言徽章不顯示 (對齊可運作的 collaboration)。
      const record = (await this.assignmentsApi
        .fetchById(today)
        .catch(() => null)) as Record<string, any> | null;
      if (!record) {
        this.todayMyPatientIds.set([]);
        return;
      }
      // by-date 端點回傳 names/teams 於頂層；同時相容 names/teams 巢狀於 teams JSON 的格式。
      const rawTeams = record['teams'] as Record<string, any> | undefined;
      const payload =
        rawTeams && (rawTeams['names'] || rawTeams['teams']) ? rawTeams : record;
      const names = payload['names'] as Record<string, string> | undefined;
      const teams = payload['teams'] as
        | Record<string, { nurseTeam?: string; nurseTeamIn?: string; nurseTeamOut?: string }>
        | undefined;
      const myAssignedIds = new Set<string>();
      if (names && teams) {
        const userName = (currentUser.name || '').trim();
        // 找出指派給此護理師的隊名 (早A/早B/午C...)
        const myTeamNames = new Set<string>();
        for (const teamName in names) {
          if ((names[teamName] || '').trim() === userName) myTeamNames.add(teamName);
        }
        for (const key in teams) {
          const ta = teams[key] || {};
          if (
            myTeamNames.has(ta.nurseTeam as string) ||
            myTeamNames.has(ta.nurseTeamIn as string) ||
            myTeamNames.has(ta.nurseTeamOut as string)
          ) {
            // key = `${patientId}-${shift}`；patientId 可能是含「-」的 UUID，
            // 故取最後一個「-」之前的整段，避免被截斷。
            const patientId = key.substring(0, key.lastIndexOf('-'));
            if (patientId) myAssignedIds.add(patientId);
          }
        }
      }
      this.todayMyPatientIds.set(Array.from(myAssignedIds));
    } catch (error) {
      console.error(
        "[MainLayout] Failed to fetch today's assigned patients:",
        error,
      );
      this.todayMyPatientIds.set([]);
    }
  }

  /** Traverse the activated route tree to find the deepest child's title. */
  private getDeepestRouteTitle(): string {
    let route = this.activatedRoute;
    while (route.firstChild) {
      route = route.firstChild;
    }
    return (route.snapshot.data as { title?: string })?.title || '';
  }

  /** Cleanup all listeners on component destroy. */
  private cleanup(): void {
    this.notificationService.stopListening();
    this.stopConflictListener();
    this.taskStoreService.stopRealtimeUpdates();
    this.stopPatientRefreshTimer();
  }
}
