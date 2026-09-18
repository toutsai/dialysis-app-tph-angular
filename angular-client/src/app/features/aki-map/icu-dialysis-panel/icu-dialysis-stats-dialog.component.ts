import {
  AfterViewInit, Component, ElementRef, EventEmitter, HostListener, OnDestroy, Output, ViewChild,
  computed, inject, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Chart, registerables } from 'chart.js';
import {
  AkiApiService, IcuDialysisStats, IcuModeCounts, IcuStatsDay, IcuStatsMonth,
} from '@app/core/services/aki-api.service';

Chart.register(...registerables);

type StatsView = 'month' | 'year';
type ModeKey = 'HD' | 'SLED' | 'CVVHDF' | 'OTHER';

// 與 ICU 透析頁迷你卡同一組嚴重度色：HD 綠、SLED 黃、CVVHDF 紅
const MODE_META: { key: ModeKey; label: string; color: string }[] = [
  { key: 'HD', label: 'HD', color: '#43a047' },
  { key: 'SLED', label: 'SLED', color: '#fdd835' },
  { key: 'CVVHDF', label: 'CVVHDF', color: '#e53935' },
  { key: 'OTHER', label: '其他', color: '#90a4ae' },
];
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

/**
 * ICU 透析頁「月／年統計」彈窗（2026-09-19）：每日 ICU 的 HD／SLED／CVVHDF 病人數。
 * 資料由後端每小時累積的每日名單算出（icu_dialysis_daily），自上線日起才有；今天含此刻名單。
 */
@Component({
  selector: 'app-icu-dialysis-stats-dialog',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './icu-dialysis-stats-dialog.component.html',
  styleUrl: './icu-dialysis-stats-dialog.component.css',
})
export class IcuDialysisStatsDialogComponent implements AfterViewInit, OnDestroy {
  private readonly akiApi = inject(AkiApiService);

  @Output() closed = new EventEmitter<void>();
  @ViewChild('chartCanvas') chartCanvas?: ElementRef<HTMLCanvasElement>;
  private chart: Chart | null = null;

  private readonly now = new Date();
  readonly view = signal<StatsView>('month');
  readonly year = signal(this.now.getFullYear());
  readonly month = signal(this.now.getMonth() + 1);
  readonly unit = signal<string | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly data = signal<IcuDialysisStats | null>(null);

  readonly unitOptions: { key: string | null; label: string }[] = [
    { key: null, label: '全部 ICU' },
    { key: 'ICUA', label: 'ICUA' },
    { key: 'ICUB', label: 'ICUB' },
    { key: 'ICUD', label: 'ICUD' },
  ];

  /** 期間內完全沒出現「其他模式」就不佔一欄 */
  readonly modes = computed(() => {
    const summary = this.data()?.summary;
    return MODE_META.filter((m) => m.key !== 'OTHER' || (summary?.patientDays.OTHER ?? 0) > 0);
  });
  readonly periodLabel = computed(() => (this.view() === 'month' ? `${this.year()} 年 ${this.month()} 月` : `${this.year()} 年`));
  readonly hasAnyData = computed(() => (this.data()?.summary.daysWithData ?? 0) > 0);

  ngAfterViewInit(): void {
    void this.load();
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closed.emit();
  }

  setView(view: StatsView): void {
    if (this.view() === view) return;
    this.view.set(view);
    void this.load();
  }

  setUnit(unit: string | null): void {
    if (this.unit() === unit) return;
    this.unit.set(unit);
    void this.load();
  }

  shift(delta: number): void {
    if (this.view() === 'year') {
      this.year.update((y) => y + delta);
    } else {
      const index = this.year() * 12 + (this.month() - 1) + delta;
      this.year.set(Math.floor(index / 12));
      this.month.set((index % 12) + 1);
    }
    void this.load();
  }

  goToday(): void {
    const today = new Date();
    this.year.set(today.getFullYear());
    this.month.set(today.getMonth() + 1);
    void this.load();
  }

  /** 年檢視點某個月 → 跳到該月的每日明細 */
  openMonth(month: number): void {
    this.month.set(month);
    this.view.set('month');
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const month = this.view() === 'month' ? this.month() : null;
      this.data.set(await this.akiApi.getIcuDialysisStats(this.year(), month, this.unit()));
    } catch (e: any) {
      this.error.set(e?.error?.message || e?.message || '載入統計失敗');
      this.data.set(null);
    } finally {
      this.loading.set(false);
      // canvas 常駐在模板上；等這一輪變更偵測畫完再建圖
      setTimeout(() => this.renderChart());
    }
  }

  private renderChart(): void {
    this.chart?.destroy();
    this.chart = null;
    const canvas = this.chartCanvas?.nativeElement;
    const stats = this.data();
    if (!canvas || !stats || !this.hasAnyData()) return;

    const isMonth = !!stats.days;
    const labels = isMonth
      ? stats.days!.map((d) => String(Number(d.date.slice(8))))
      : stats.months!.map((m) => `${m.month}月`);
    // 沒記錄的日／月給 null（留白），不畫成 0
    const valueOf = (key: ModeKey): (number | null)[] => (isMonth
      ? stats.days!.map((d) => (d.hasData ? d[key] : null))
      : stats.months!.map((m) => (m.daysWithData ? m.avg[key] : null)));

    this.chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: this.modes().map((m) => ({ label: m.label, data: valueOf(m.key), backgroundColor: m.color, stack: 'icu' })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 14 } },
          title: { display: true, text: isMonth ? '每日 ICU 透析病人數' : '各月平均每日 ICU 透析病人數' },
          tooltip: { mode: 'index', intersect: false },
        },
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: { stacked: true, beginAtZero: true, ticks: { precision: 0 }, title: { display: true, text: '人' } },
        },
      },
    });
    // 彈窗剛開時 canvas 可能還沒有寬度（flex 版面尚未定案）
    setTimeout(() => this.chart?.resize(), 300);
  }

  weekdayOf(day: IcuStatsDay): string {
    const [y, m, d] = day.date.split('-').map(Number);
    return WEEKDAYS[new Date(y, m - 1, d).getDay()];
  }

  isWeekend(day: IcuStatsDay): boolean {
    const w = this.weekdayOf(day);
    return w === '六' || w === '日';
  }

  dayLabel(day: IcuStatsDay): string {
    return `${Number(day.date.slice(5, 7))}/${Number(day.date.slice(8))}`;
  }

  /** 沒記錄的日子：上線前、未來、或伺服器當天沒開 */
  noDataReason(day: IcuStatsDay): string {
    const stats = this.data();
    if (!stats) return '';
    if (day.date > stats.today) return '尚未到';
    if (day.date < stats.firstDataDate) return '開始記錄前';
    return '當天沒有記錄';
  }

  maxText(entry: { count: number; date: string } | null | undefined): string {
    if (!entry) return '—';
    return `${entry.count} 人（${Number(entry.date.slice(5, 7))}/${Number(entry.date.slice(8))}）`;
  }

  count(row: IcuModeCounts, key: ModeKey | 'total'): number {
    return row[key];
  }

  trackMonth(_: number, m: IcuStatsMonth): number {
    return m.month;
  }
}
