import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { DashboardData, DashboardHandoverItem, DashboardService, DashboardShift } from '@services/dashboard.service';
import { formatDateToYYYYMMDD } from '@/utils/dateUtils';

/** Screen Wake Lock 的最小型別（避免依賴各版 TS lib.dom 是否內建）。 */
interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}
type NavigatorWithWakeLock = Navigator & {
  wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> };
};

@Component({
  selector: 'app-bed-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './bed-dashboard.component.html',
  styleUrl: './bed-dashboard.component.css',
})
export class BedDashboardComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dashboardService = inject(DashboardService);

  readonly bedKey = signal('');
  readonly selectedDate = signal(formatDateToYYYYMMDD());
  readonly selectedShift = signal<DashboardShift>('auto');
  readonly pin = signal('');
  readonly data = signal<DashboardData | null>(null);
  readonly isLoading = signal(false);
  readonly isLoggingIn = signal(false);
  readonly errorMessage = signal('');
  readonly needsPin = signal(false);
  readonly lastRefreshLabel = signal('');
  readonly completingId = signal<string | null>(null);

  // 交班事項 / 藥物清單超出面板高度時，底部顯示「還有更多，往下滑」；滑到底自動消失。
  @ViewChild('handoverList') private handoverListRef?: ElementRef<HTMLElement>;
  @ViewChild('medList') private medListRef?: ElementRef<HTMLElement>;
  readonly handoverHasMore = signal(false);
  readonly medHasMore = signal(false);
  // 頁尾顯示目前視窗尺寸（CSS px），方便在平板上確認落在哪個版面斷點。
  readonly viewportLabel = signal('');
  private readonly onResize = () => {
    this.updateViewportLabel();
    this.scheduleOverflowCheck();
  };

  /** 抗凝劑分 Rinse / Loading / Maintain 三小列；沒有結構化欄位時退回單列原字串。 */
  readonly heparinLines = computed<{ label: string; value: string }[]>(() => {
    const order = this.data()?.dialysisOrder;
    if (!order) return [{ label: '', value: '-' }];
    const rinse = this.value(order.heparinRinse);
    const loading = this.value(order.heparinLoading);
    const maintain = this.value(order.heparinMaintain);
    const hasStructuredValue = [rinse, loading, maintain].some((part) => part !== '-');
    if (!hasStructuredValue) return [{ label: '', value: this.value(order.heparin) }];
    return [
      { label: 'Rinse', value: rinse },
      { label: 'Loading', value: loading },
      { label: 'Maintain', value: maintain },
    ];
  });

  // 固定床邊平板會一直開著：日期預設跟著「今天」走，跨日自動切到當天排程、班別回到自動。
  // 若網址帶了非今天的 date、或有人手動改日期，當天內尊重該選擇；到隔天再自動回到今天。
  private followToday = true;
  private manualDateSetOn = formatDateToYYYYMMDD();

  // 全螢幕：平板瀏覽器開啟時可隱藏網址列/工具列。瀏覽器規定必須由使用者在本頁點擊觸發，
  // 無法在「我的病人」開新分頁時自動全螢幕，所以在儀表板本頁提供切換鈕。
  readonly isFullscreen = signal(false);
  readonly supportsFullscreen =
    typeof document !== 'undefined' && typeof document.documentElement?.requestFullscreen === 'function';
  private readonly onFullscreenChange = () => this.isFullscreen.set(!!document.fullscreenElement);

  // 進頁面時的全螢幕提示條：固定床邊平板裝機時點一下即可；按 × 後本次瀏覽不再出現。
  private static readonly FULLSCREEN_HINT_DISMISSED_KEY = 'bed_dashboard_fullscreen_hint_dismissed';
  readonly fullscreenHintDismissed = signal(
    typeof sessionStorage !== 'undefined' &&
      sessionStorage.getItem(BedDashboardComponent.FULLSCREEN_HINT_DISMISSED_KEY) === '1',
  );
  readonly showFullscreenHint = computed(
    () => this.supportsFullscreen && !this.isFullscreen() && !this.fullscreenHintDismissed(),
  );

  // 螢幕常亮（Screen Wake Lock API）：頁面在前景時要求系統不要因閒置關螢幕/鎖屏。
  // 只在支援的瀏覽器生效（Android Chrome 84+）；切到背景會被系統釋放，回前景時重新申請。
  private wakeLock: WakeLockSentinelLike | null = null;
  private readonly onVisibilityChange = () => {
    if (document.visibilityState === 'visible') void this.requestWakeLock();
  };

  // 只有員工帳號登入時才顯示交班留言的「已讀」按鈕（床邊 PIN 裝置維持唯讀）。
  readonly canManage = computed(() => this.dashboardService.hasStaffToken());

  readonly hasPatient = computed(() => !!this.data()?.patient);
  readonly headerTitle = computed(() => {
    const patient = this.data()?.patient;
    if (!patient) return '床邊智慧儀表板';
    const meta = [patient.medicalRecordNumber, this.formatAgeGender(patient.age, patient.gender)]
      .filter(Boolean)
      .join('  ');
    return `${patient.name}${meta ? `  ${meta}` : ''}`;
  });

  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      this.bedKey.set(params.get('bedKey') || '');
      this.needsPin.set(!this.dashboardService.hasStoredToken(this.bedKey()) && !this.dashboardService.hasStaffToken());
      void this.loadDashboard();
    });

    this.route.queryParamMap.subscribe((params) => {
      const date = params.get('date');
      const shift = params.get('shift') as DashboardShift | null;
      if (date) {
        this.selectedDate.set(date);
        this.markDateChosen(date);
      }
      if (shift && ['auto', 'early', 'noon', 'late'].includes(shift)) this.selectedShift.set(shift);
      void this.loadDashboard();
    });

    // 每 30 秒重抓資料（頁面在前景且已登入時）；跨日時先把日期切到今天再抓。
    this.refreshTimer = setInterval(() => {
      if (document.hidden || this.needsPin()) return;
      if (this.rollOverToTodayIfNeeded()) return;
      void this.loadDashboard(false);
    }, 30_000);

    document.addEventListener('fullscreenchange', this.onFullscreenChange);
    this.onFullscreenChange();

    document.addEventListener('visibilitychange', this.onVisibilityChange);
    window.addEventListener('resize', this.onResize);
    this.updateViewportLabel();
    void this.requestWakeLock();
  }

  ngOnDestroy(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }
    document.removeEventListener('fullscreenchange', this.onFullscreenChange);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    window.removeEventListener('resize', this.onResize);
    void this.releaseWakeLock();
  }

  /** 申請螢幕常亮；不支援或被系統拒絕時靜默略過（改由平板系統設定處理）。 */
  private async requestWakeLock(): Promise<void> {
    const wakeLockApi = (navigator as NavigatorWithWakeLock).wakeLock;
    if (!wakeLockApi || document.visibilityState !== 'visible') return;
    if (this.wakeLock && !this.wakeLock.released) return;
    try {
      const sentinel = await wakeLockApi.request('screen');
      sentinel.addEventListener('release', () => {
        if (this.wakeLock === sentinel) this.wakeLock = null;
      });
      this.wakeLock = sentinel;
    } catch {
      this.wakeLock = null;
    }
  }

  private async releaseWakeLock(): Promise<void> {
    const sentinel = this.wakeLock;
    this.wakeLock = null;
    if (!sentinel || sentinel.released) return;
    try {
      await sentinel.release();
    } catch {
      /* 已被系統釋放，忽略 */
    }
  }

  dismissFullscreenHint(): void {
    this.fullscreenHintDismissed.set(true);
    try {
      sessionStorage.setItem(BedDashboardComponent.FULLSCREEN_HINT_DISMISSED_KEY, '1');
    } catch {
      /* 無法寫入 sessionStorage 時僅本次生效 */
    }
  }

  /** 切換瀏覽器全螢幕（需由使用者點擊觸發；平板瀏覽器會隱藏網址列）。 */
  async toggleFullscreen(): Promise<void> {
    if (!this.supportsFullscreen) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      }
    } catch {
      this.errorMessage.set('此瀏覽器不允許全螢幕，請改用瀏覽器選單的「加到主畫面」開啟');
    }
  }

  async login(): Promise<void> {
    if (!this.pin().trim()) {
      this.errorMessage.set('請輸入床位 PIN');
      return;
    }

    this.isLoggingIn.set(true);
    this.errorMessage.set('');
    try {
      await this.dashboardService.loginBed(this.bedKey(), this.pin().trim());
      this.pin.set('');
      this.needsPin.set(false);
      await this.loadDashboard();
    } catch (error) {
      this.errorMessage.set(error instanceof Error ? error.message : '床位登入失敗');
    } finally {
      this.isLoggingIn.set(false);
    }
  }

  async loadDashboard(showLoading = true): Promise<void> {
    const bedKey = this.bedKey();
    if (!bedKey || this.needsPin()) return;

    if (showLoading) this.isLoading.set(true);
    this.errorMessage.set('');
    try {
      const dashboard = await this.dashboardService.getBedDashboard(
        bedKey,
        this.selectedDate(),
        this.selectedShift(),
      );
      this.data.set(dashboard);
      this.scheduleOverflowCheck();
      this.lastRefreshLabel.set(new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }));
    } catch (error) {
      const message = error instanceof Error ? error.message : '讀取床邊儀表板失敗';
      this.errorMessage.set(message);
      if (!this.dashboardService.hasStaffToken()) {
        this.needsPin.set(true);
      }
    } finally {
      if (showLoading) this.isLoading.set(false);
    }
  }

  /** 將交班留言標記為完成/已讀（僅 source=task 的留言，限員工帳號）。 */
  async completeHandoverItem(item: DashboardHandoverItem): Promise<void> {
    if (item.source !== 'task' || this.completingId()) return;
    this.completingId.set(item.id);
    this.errorMessage.set('');
    try {
      await this.dashboardService.completeHandoverTask(item.id);
      await this.loadDashboard(false);
    } catch (error) {
      this.errorMessage.set(error instanceof Error ? error.message : '標記完成失敗');
    } finally {
      this.completingId.set(null);
    }
  }

  changeShift(shift: DashboardShift): void {
    this.selectedShift.set(shift);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { date: this.selectedDate(), shift },
      queryParamsHandling: 'merge',
    });
    void this.loadDashboard();
  }

  changeDate(date: string): void {
    this.selectedDate.set(date);
    this.markDateChosen(date);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { date, shift: this.selectedShift() },
      queryParamsHandling: 'merge',
    });
    void this.loadDashboard();
  }

  /** 記錄使用者/網址選了哪一天：選今天就繼續跟著今天走，選別天則當天內固定。 */
  private markDateChosen(date: string): void {
    const today = formatDateToYYYYMMDD();
    this.followToday = date === today;
    this.manualDateSetOn = today;
  }

  /**
   * 跨日處理：若跟著今天走、或手動選的日期已經是「前一天選的」，就切回今天並把班別設回自動。
   * 回傳 true 表示已觸發重新載入，呼叫端不必再抓一次。
   */
  private rollOverToTodayIfNeeded(): boolean {
    const today = formatDateToYYYYMMDD();
    if (!this.followToday && this.manualDateSetOn === today) return false;
    if (this.followToday && this.selectedDate() === today) return false;

    this.followToday = true;
    this.manualDateSetOn = today;
    this.selectedDate.set(today);
    this.selectedShift.set('auto');
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { date: today, shift: 'auto' },
      queryParamsHandling: 'merge',
    });
    void this.loadDashboard(false);
    return true;
  }

  /** 鎖定會清掉床位 token，固定床邊裝置之後要重輸 PIN 才能用，故先確認避免誤觸。 */
  lockDevice(): void {
    const confirmed = window.confirm('確定要鎖定此床邊裝置？\n鎖定後必須重新輸入床位 PIN 才能再看儀表板。');
    if (!confirmed) return;
    this.dashboardService.clearStoredToken(this.bedKey());
    this.needsPin.set(!this.dashboardService.hasStaffToken());
    this.data.set(null);
  }

  goBack(): void {
    void this.router.navigate(['/my-patients']);
  }

  value(value: unknown): string {
    if (value === null || value === undefined || String(value).trim() === '') return '-';
    return String(value);
  }

  /** 清單是否還有內容在可視區之下（超出 4px 才算，避免小數誤差） */
  private hasMoreBelow(el?: HTMLElement | null): boolean {
    if (!el) return false;
    return el.scrollHeight - el.scrollTop - el.clientHeight > 4;
  }

  private checkOverflow(): void {
    this.handoverHasMore.set(this.hasMoreBelow(this.handoverListRef?.nativeElement));
    this.medHasMore.set(this.hasMoreBelow(this.medListRef?.nativeElement));
  }

  /** 資料換過後 DOM 要下一輪才更新，延後一個 tick 再量。 */
  private scheduleOverflowCheck(): void {
    setTimeout(() => this.checkOverflow(), 0);
  }

  onListScroll(): void {
    this.checkOverflow();
  }

  scrollListDown(which: 'handover' | 'med'): void {
    const el = which === 'handover' ? this.handoverListRef?.nativeElement : this.medListRef?.nativeElement;
    if (!el) return;
    el.scrollBy({ top: Math.max(120, el.clientHeight * 0.8), behavior: 'smooth' });
  }

  private updateViewportLabel(): void {
    this.viewportLabel.set(`${window.innerWidth}×${window.innerHeight}`);
  }

  maskPatientName(name?: string | null): string {
    const trimmed = (name || '').trim();
    if (!trimmed) return '';

    const chars = Array.from(trimmed);
    if (chars.length === 1) return `${chars[0]}O`;
    if (chars.length === 2) return `${chars[0]}O`;

    return `${chars[0]}${'O'.repeat(chars.length - 2)}${chars[chars.length - 1]}`;
  }

  formatAgeGender(age?: number | null, gender?: string): string {
    const parts = [];
    if (age !== null && age !== undefined) parts.push(`${age}歲`);
    if (gender) parts.push(gender);
    return parts.join('/');
  }

  formatMedication(med: { orderName?: string; orderCode?: string; dose?: string; unit?: string; note?: string }): string {
    return [med.orderName || med.orderCode || '藥物', `${med.dose || ''}${med.unit || ''}`.trim(), med.note]
      .filter(Boolean)
      .join(' / ');
  }

  /** 交班事項的建立日期（留言/日誌取 createdAt、病情紀錄取 recordDate）；含時間時一併顯示。 */
  formatItemDate(item: DashboardHandoverItem): string {
    const raw = item.createdAt || item.recordDate || item.updatedAt;
    if (!raw) return '';
    const str = String(raw).replace('T', ' ');
    const m = str.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ ](\d{2}:\d{2}))?/);
    if (!m) return str.slice(0, 16);
    const date = `${m[1]}-${m[2]}-${m[3]}`;
    return m[4] ? `${date} ${m[4]}` : date;
  }

  itemSourceLabel(source: string): string {
    const labels: Record<string, string> = {
      task: '交班留言',
      condition_record: '病情紀錄',
      handover_log: '交班日誌',
    };
    return labels[source] || source;
  }
}
