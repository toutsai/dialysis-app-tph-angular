import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { DashboardData, DashboardHandoverItem, DashboardService, DashboardShift } from '@services/dashboard.service';
import { formatDateToYYYYMMDD } from '@/utils/dateUtils';

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

  // 全螢幕：平板瀏覽器開啟時可隱藏網址列/工具列。瀏覽器規定必須由使用者在本頁點擊觸發，
  // 無法在「我的病人」開新分頁時自動全螢幕，所以在儀表板本頁提供切換鈕。
  readonly isFullscreen = signal(false);
  readonly supportsFullscreen =
    typeof document !== 'undefined' && typeof document.documentElement?.requestFullscreen === 'function';
  private readonly onFullscreenChange = () => this.isFullscreen.set(!!document.fullscreenElement);

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
      if (date) this.selectedDate.set(date);
      if (shift && ['auto', 'early', 'noon', 'late'].includes(shift)) this.selectedShift.set(shift);
      void this.loadDashboard();
    });

    this.refreshTimer = setInterval(() => {
      if (!document.hidden && !this.needsPin()) void this.loadDashboard(false);
    }, 30_000);

    document.addEventListener('fullscreenchange', this.onFullscreenChange);
    this.onFullscreenChange();
  }

  ngOnDestroy(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }
    document.removeEventListener('fullscreenchange', this.onFullscreenChange);
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
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { date, shift: this.selectedShift() },
      queryParamsHandling: 'merge',
    });
    void this.loadDashboard();
  }

  lockDevice(): void {
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

  formatHeparinOrder(order: DashboardData['dialysisOrder']): string {
    if (!order) return '-';

    const rinse = this.value(order.heparinRinse);
    const loading = this.value(order.heparinLoading);
    const maintain = this.value(order.heparinMaintain);
    const hasStructuredValue = [rinse, loading, maintain].some((part) => part !== '-');

    if (!hasStructuredValue) return this.value(order.heparin);

    return `Rinse：${rinse} / Loading：${loading} / Maintain：${maintain}`;
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
