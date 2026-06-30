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
import { environment } from '@env/environment';
import { AuthService } from '@services/auth.service';
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
  readonly activeMemos = signal<MemoItem[]>([]);
  readonly isMemoDialogVisible = signal(false);
  readonly patientNameForDialog = signal('');
  readonly memosForDialog = signal<MemoItem[]>([]);
  private memoPollTimer: ReturnType<typeof setInterval> | null = null;

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

  constructor() {
    this.assignmentsApi =
      this.apiManagerService.create<AssignmentRecord>('nurse_assignments');

    // Watch auth state: start/stop listeners when user logs in/out
    // Uses untracked() so only currentUser() is a tracked dependency
    effect(() => {
      const user = this.authService.currentUser();
      untracked(() => {
        if (user) {
          this.startSharedDataListeners();
          this.notificationService.startListening();
          this.startConflictListener();
          this.fetchTodayAssignedPatients();
          this.taskStoreService.startRealtimeUpdates(user.uid);
        } else {
          this.activeMemos.set([]);
          this.stopSharedDataListeners();
          sessionStorage.removeItem('hasCheckedSchedules');
          this.notificationService.stopListening();
          this.stopConflictListener();
          this.patientStoreService.reset();
          this.todayMyPatientIds.set([]);
          this.taskStoreService.stopRealtimeUpdates();
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

  private readonly MEMO_POLL_INTERVAL = 15_000; // 15 seconds

  /** Start polling for memo data. Replaces Firebase onSnapshot. */
  private startSharedDataListeners(): void {
    if (this.memoPollTimer) return;
    this.fetchActiveMemos();
    this.memoPollTimer = setInterval(() => this.fetchActiveMemos(), this.MEMO_POLL_INTERVAL);
  }

  /** Fetch active memos via REST API. */
  private async fetchActiveMemos(): Promise<void> {
    try {
      const tasksApi = this.apiManagerService.create<FirestoreRecord>('tasks');
      const allTasks = await tasksApi.fetchAll();
      const pendingMemos = allTasks
        .filter((t: any) => t.category === 'message' && t.status === 'pending')
        .map((t: any) => ({ id: t.id, ...t }) as MemoItem);
      this.activeMemos.set(pendingMemos);
    } catch (error) {
      console.error('[MainLayout] Failed to fetch active memos:', error);
    }
  }

  /** Stop the memo polling timer. */
  private stopSharedDataListeners(): void {
    if (this.memoPollTimer) {
      clearInterval(this.memoPollTimer);
      this.memoPollTimer = null;
    }
  }

  private readonly CONFLICT_POLL_INTERVAL = 20_000; // 20 seconds

  /** Start polling for conflict count. Replaces Firebase onSnapshot. */
  private startConflictListener(): void {
    if (!(this.authService.isAdmin() || this.authService.isEditor())) return;
    if (this.conflictPollTimer) return;
    this.fetchConflictCount();
    this.conflictPollTimer = setInterval(() => this.fetchConflictCount(), this.CONFLICT_POLL_INTERVAL);
  }

  /** Fetch conflict count via REST API. */
  private async fetchConflictCount(): Promise<void> {
    try {
      const exceptionsApi = this.apiManagerService.create<FirestoreRecord>('exception_requests');
      const allExceptions = await exceptionsApi.fetchAll();
      const today = getToday();
      const conflicts = allExceptions.filter((e: any) =>
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

  /** Stop the conflict polling timer. */
  private stopConflictListener(): void {
    if (this.conflictPollTimer) {
      clearInterval(this.conflictPollTimer);
      this.conflictPollTimer = null;
      this.conflictCount.set(0);
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
      const allAssignments = await this.assignmentsApi.fetchAll();
      const assignmentsSnapshot = allAssignments.filter((a: any) => a.date === today);
      if (assignmentsSnapshot.length === 0) {
        this.todayMyPatientIds.set([]);
        return;
      }
      // names/teams 巢狀包在 teams JSON 欄位 (schema 只有 teams)，需解包；同時相容扁平結構。
      const record = assignmentsSnapshot[0] as Record<string, any>;
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
    this.stopSharedDataListeners();
    this.stopConflictListener();
    this.taskStoreService.stopRealtimeUpdates();
  }
}
