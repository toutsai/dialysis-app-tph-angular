import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { DashboardData, DashboardService, DashboardShift } from '@services/dashboard.service';
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
      this.needsPin.set(!this.dashboardService.hasStoredToken(this.bedKey()) && !localStorage.getItem('auth_token'));
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
      if (!this.needsPin()) void this.loadDashboard(false);
    }, 30_000);
  }

  ngOnDestroy(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
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
      if (!localStorage.getItem('auth_token')) {
        this.needsPin.set(true);
      }
    } finally {
      if (showLoading) this.isLoading.set(false);
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
    this.needsPin.set(!localStorage.getItem('auth_token'));
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

  itemSourceLabel(source: string): string {
    const labels: Record<string, string> = {
      task: '交班留言',
      condition_record: '病情紀錄',
      handover_log: '交班日誌',
    };
    return labels[source] || source;
  }
}
