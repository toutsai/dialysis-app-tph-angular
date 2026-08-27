// Standalone 版：已移除 Firebase
import { Component, inject, signal, computed, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiManagerService, type ApiManager, type FirestoreRecord } from '@services/api-manager.service';
import { SHIFT_CODES, getShiftDisplayName } from '@/constants/scheduleConstants';
import { formatDateToYYYYMMDD, formatDateToYYYYMM } from '@/utils/dateUtils';
import { localApi } from '@/services/localApiClient';
import { Chart, registerables } from 'chart.js';

/** 年度報表「常規門診病人數（月底）」列的 mode 標記（非人次列：圖表與年總計排除） */
const CENSUS_ROW_MODE = '常規門診病人數';

interface MonthlyCensusCell {
  date: string;
  opdRegular: number;
  opd: number;
  ipd: number;
  er: number;
  source: 'cron' | 'backfill' | 'live' | string;
}

/** 常規門診人數彈窗：某月異動明細一筆（GET /system/patient-census-changes） */
interface CensusChangeItem {
  historyId: string;
  patientId: string;
  name: string;
  medicalRecordNumber: string | null;
  date: string;
  isDeletedNow: boolean;
  currentStatus: string | null;
  kind: 'create' | 'restore' | 'delete' | 'transfer_in' | 'transfer_out';
  kindLabel: string;
  eventDate?: string;
  reason?: string;
  fromStatusLabel?: string;
  toStatusLabel?: string;
  /** 同人同日同類型合併後的原始筆數（>1 表示當日反覆操作已合併為一筆） */
  mergedCount?: number;
}

interface CensusChangesResponse {
  year: number;
  month: number;
  monthEndSnapshot: { date: string; opdRegular: number; source: string } | null;
  historySince: string | null;
  added: CensusChangeItem[];
  deleted: CensusChangeItem[];
  transferredIn: CensusChangeItem[];
  transferredOut: CensusChangeItem[];
}

Chart.register(...registerables);

@Component({
  selector: 'app-reporting',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './reporting.component.html',
  styleUrl: './reporting.component.css'
})
export class ReportingComponent implements AfterViewInit {
  @ViewChild('chartCanvas') chartCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('staffingEarlyCanvas') staffingEarlyCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('staffingNoonCanvas') staffingNoonCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('staffingLateCanvas') staffingLateCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('staffingTotalCanvas') staffingTotalCanvas?: ElementRef<HTMLCanvasElement>;

  private readonly apiManagerService = inject(ApiManagerService);
  private readonly schedulesApi: ApiManager<FirestoreRecord>;
  private readonly expiredSchedulesApi: ApiManager<FirestoreRecord>;
  private readonly patientsApi: ApiManager<FirestoreRecord>;
  private readonly dailyLogsApi: ApiManager<FirestoreRecord>;

  private chartInstance: Chart | null = null;
  private staffingCharts: Chart[] = [];

  readonly reportTypes = [
    { value: 'daily', label: '日報表', icon: '📋' },
    { value: 'monthly', label: '月報表', icon: '📅' },
    { value: 'yearly', label: '年度報表', icon: '📊' },
    { value: 'staffing_monthly', label: '護病比', icon: '👩‍⚕️' },
  ];

  reportType = signal<string>('');
  selectedDate = signal<string>(formatDateToYYYYMMDD(new Date()));
  selectedMonth = signal<string>(formatDateToYYYYMM(new Date()));
  selectedYear = signal<number>(new Date().getFullYear());

  isLoading = signal<boolean>(false);
  hasGenerated = signal<boolean>(false);
  showTable = signal<boolean>(false);
  chartMode = signal<'absolute' | 'percent'>('absolute');
  reportDateRange = signal<{ start: string; end: string }>({ start: '', end: '' });

  dailyTableHeaders = signal<string[]>([]);
  dailyTableRows = signal<any[]>([]);
  monthlyTableHeaders = signal<number[]>([]);
  monthlyTableRows = signal<any[]>([]);
  yearlyTableHeaders = signal<string[]>([]);
  yearlyTableRows = signal<any[]>([]);
  staffingTableRows = signal<any[]>([]);

  // 常規門診人數彈窗（年度報表點月份格子）
  censusDetailOpen = signal<boolean>(false);
  censusDetailLoading = signal<boolean>(false);
  censusDetailError = signal<string>('');
  censusDetail = signal<CensusChangesResponse | null>(null);
  censusDetailMonth = signal<number>(0); // 1–12
  censusDetailTab = signal<'added' | 'deleted' | 'transfer'>('added');

  censusDetailTitle = computed(() => {
    const d = this.censusDetail();
    return `${this.selectedYear()} 年 ${this.censusDetailMonth()} 月 常規門診人數異動` +
      (d?.monthEndSnapshot ? `（${d.monthEndSnapshot.date} 人數 ${d.monthEndSnapshot.opdRegular}${d.monthEndSnapshot.source === 'backfill' ? '≈' : ''}）` : '');
  });

  reportTitle = computed(() => {
    if (!this.hasGenerated()) return '';
    if (this.reportType() === 'daily') return `${this.reportDateRange().start} 人次日報表`;
    if (this.reportType() === 'monthly') return `${this.selectedMonth()} 人次月報表`;
    if (this.reportType() === 'yearly') return `${this.selectedYear()} 人次年度報表`;
    if (this.reportType() === 'staffing_monthly') return `${this.selectedMonth()} 護理人力月報表`;
    return '統計報表';
  });

  noData = computed(() => {
    if (!this.hasGenerated()) return true;
    if (this.reportType() === 'daily') return this.dailyTableRows().length === 0;
    if (this.reportType() === 'monthly') return this.monthlyTableRows().length === 0;
    if (this.reportType() === 'yearly') return this.yearlyTableRows().length === 0;
    if (this.reportType() === 'staffing_monthly') return this.staffingTableRows().length === 0;
    return true;
  });

  constructor() {
    this.schedulesApi = this.apiManagerService.create<FirestoreRecord>('schedules');
    this.expiredSchedulesApi = this.apiManagerService.create<FirestoreRecord>('expired_schedules');
    this.patientsApi = this.apiManagerService.create<FirestoreRecord>('patients');
    this.dailyLogsApi = this.apiManagerService.create<FirestoreRecord>('daily_logs');
  }

  ngAfterViewInit(): void {}

  // --- UI Actions ---

  selectReportType(type: string): void {
    this.reportType.set(type);
    this.generateReport();
  }

  /** 年度報表點「常規門診人數」某月格子 → 開啟該月新增/刪除/轉入轉出明細 */
  async openCensusDetail(monthIndex: number): Promise<void> {
    const month = monthIndex + 1;
    const year = this.selectedYear();
    this.censusDetailMonth.set(month);
    this.censusDetailTab.set('added');
    this.censusDetail.set(null);
    this.censusDetailError.set('');
    this.censusDetailOpen.set(true);
    this.censusDetailLoading.set(true);
    try {
      const resp: CensusChangesResponse | null = await localApi.get(`/system/patient-census-changes?year=${year}&month=${month}`);
      if (!resp) throw new Error('查無資料');
      this.censusDetail.set(resp);
    } catch (err: any) {
      console.error('取得常規門診人數異動明細失敗:', err);
      this.censusDetailError.set(err?.message || '取得異動明細失敗');
    } finally {
      this.censusDetailLoading.set(false);
    }
  }

  closeCensusDetail(): void {
    this.censusDetailOpen.set(false);
  }

  /** 顯示 M/D */
  formatMd(date: string | null | undefined): string {
    if (!date || date.length < 10) return date || '';
    return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
  }

  onDateChange(date: string): void {
    this.selectedDate.set(date);
    if (this.reportType() === 'daily') this.generateReport();
  }

  onMonthChange(month: string): void {
    this.selectedMonth.set(month);
    if (this.reportType() === 'monthly' || this.reportType() === 'staffing_monthly') {
      this.generateReport();
    }
  }

  shiftDate(delta: number): void {
    const d = new Date(this.selectedDate() + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    this.selectedDate.set(formatDateToYYYYMMDD(d));
    this.generateReport();
  }

  shiftMonth(delta: number): void {
    const [y, m] = this.selectedMonth().split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    this.selectedMonth.set(formatDateToYYYYMM(d));
    this.generateReport();
  }

  shiftYear(delta: number): void {
    this.selectedYear.set(this.selectedYear() + delta);
    this.generateReport();
  }

  toggleTable(): void {
    this.showTable.set(!this.showTable());
  }

  toggleChartMode(): void {
    this.chartMode.set(this.chartMode() === 'absolute' ? 'percent' : 'absolute');
    setTimeout(() => this.renderChart(), 50);
  }

  // --- Chart Rendering ---

  private renderChart(): void {
    // 銷毀所有既有圖表 (單張 + 護病比四宮格)
    if (this.chartInstance) {
      this.chartInstance.destroy();
      this.chartInstance = null;
    }
    this.staffingCharts.forEach((c) => c.destroy());
    this.staffingCharts = [];

    const type = this.reportType();

    if (type === 'staffing_monthly') {
      this.renderStaffingCharts();
      return;
    }

    if (!this.chartCanvas) return;
    const ctx = this.chartCanvas.nativeElement.getContext('2d');
    if (!ctx) return;

    if (type === 'daily') {
      this.renderDailyBarChart(ctx);
    } else if (type === 'monthly') {
      this.renderMonthlyBarChart(ctx);
    } else if (type === 'yearly') {
      this.renderYearlyBarChart(ctx);
      // 保險：canvas 若在建立瞬間尚未取得寬度（版面時序），稍後補一次 resize 重繪（headless 實測年度圖曾畫成 0 寬）
      setTimeout(() => this.chartInstance?.resize(), 300);
    }
  }

  /** Fixed color mapping so same category always gets the same color. */
  private readonly CATEGORY_COLORS: Record<string, string> = {
    'HD-門診': '#e67e22',
    'HD-住院': '#4a90d9',
    'HD-急診': '#27ae60',
    'HD-未知': '#95a5a6',
    'SLED-門診': '#9b59b6',
    'SLED-住院': '#e74c3c',
    'SLED-急診': '#1abc9c',
    'SLED-未知': '#7f8c8d',
    'CVVH-門診': '#f39c12',
    'CVVH-住院': '#34495e',
    'PE-門診': '#d35400',
    'PE-住院': '#2c3e50',
  };

  private getCategoryColor(label: string): string {
    const key = label.replace(/[()（）\s]/g, '').replace(' ', '-');
    if (this.CATEGORY_COLORS[key]) return this.CATEGORY_COLORS[key];
    // Try matching "MODE-STATUS" from "MODE (STATUS)" format
    const match = label.match(/^(.+?)\s*[（(](.+?)[）)]$/);
    if (match) {
      const normalizedKey = `${match[1]}-${match[2]}`;
      if (this.CATEGORY_COLORS[normalizedKey]) return this.CATEGORY_COLORS[normalizedKey];
    }
    // Fallback
    const fallbackColors = ['#3498db', '#e67e22', '#2ecc71', '#e74c3c', '#9b59b6', '#1abc9c', '#f1c40f', '#34495e'];
    let hash = 0;
    for (let i = 0; i < label.length; i++) hash = label.charCodeAt(i) + ((hash << 5) - hash);
    return fallbackColors[Math.abs(hash) % fallbackColors.length];
  }

  private renderStackedBarChart(
    ctx: CanvasRenderingContext2D,
    rows: any[],
    labels: string[],
    dataKey: string,
  ): void {
    if (rows.length === 0 || labels.length === 0) return;

    const isPercent = this.chartMode() === 'percent';

    // 計算每個類別的總數，用於排序
    const rowsWithTotal = rows.map((row) => ({
      ...row,
      _total: (row[dataKey] as number[]).reduce((sum: number, v: number) => sum + v, 0),
    }));

    // 排序：數量最大的放最底下（先被繪製），最小的放上面
    rowsWithTotal.sort((a, b) => b._total - a._total);

    const datasets = rowsWithTotal.map((row) => {
      const label = `${row.mode} (${row.status})`;
      const color = this.getCategoryColor(label);
      return {
        label,
        data: [...row[dataKey]],
        backgroundColor: color + 'CC',
        borderColor: color,
        borderWidth: 1,
        borderRadius: 2,
      };
    });

    if (isPercent) {
      const numLabels = labels.length;
      for (let col = 0; col < numLabels; col++) {
        const total = datasets.reduce((sum, ds) => sum + (ds.data[col] || 0), 0);
        if (total > 0) {
          for (const ds of datasets) {
            ds.data[col] = +((ds.data[col] / total) * 100).toFixed(1);
          }
        }
      }
    }

    // 內聯插件：在每個堆疊段上畫數字標注
    const dataLabelPlugin = {
      id: 'stackedDataLabels',
      afterDatasetsDraw(chart: any) {
        if (isPercent) return; // 百分比模式不標數字
        const { ctx: c } = chart;
        c.save();
        c.font = 'bold 10px sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';

        chart.data.datasets.forEach((dataset: any, dsIndex: number) => {
          const meta = chart.getDatasetMeta(dsIndex);
          meta.data.forEach((bar: any, index: number) => {
            const value = dataset.data[index];
            if (!value || value === 0) return;
            const barHeight = Math.abs(bar.base - bar.y);
            // 只在段落夠高時顯示數字（避免擠在一起）
            if (barHeight < 14) return;
            c.fillStyle = '#fff';
            c.strokeStyle = 'rgba(0,0,0,0.3)';
            c.lineWidth = 2;
            const x = bar.x;
            const y = (bar.y + bar.base) / 2;
            c.strokeText(value.toString(), x, y);
            c.fillText(value.toString(), x, y);
          });
        });
        c.restore();
      },
    };

    this.chartInstance = new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: (context) => {
                const val = context.parsed.y;
                return isPercent
                  ? `${context.dataset.label}: ${val}%`
                  : `${context.dataset.label}: ${val}`;
              },
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            stacked: true,
            max: isPercent ? 100 : undefined,
            ticks: isPercent ? { callback: (v) => `${v}%` } : {},
          },
          x: { stacked: true },
        },
      },
      plugins: [dataLabelPlugin],
    });
  }

  private renderDailyBarChart(ctx: CanvasRenderingContext2D): void {
    const rows = this.dailyTableRows().filter(r => r.mode !== '每班總計');
    const headers = this.dailyTableHeaders();
    this.renderStackedBarChart(ctx, rows, headers, 'shiftCounts');
  }

  private renderMonthlyBarChart(ctx: CanvasRenderingContext2D): void {
    const rows = this.monthlyTableRows().filter(r => r.mode !== '每日總計');
    const headers = this.monthlyTableHeaders().map(String);
    this.renderStackedBarChart(ctx, rows, headers, 'dailyCounts');
  }

  private renderYearlyBarChart(ctx: CanvasRenderingContext2D): void {
    const rows = this.yearlyTableRows().filter(r => r.mode !== '每月總計' && !r.isCensus);
    const headers = this.yearlyTableHeaders();
    this.renderStackedBarChart(ctx, rows, headers, 'monthlyCounts');
  }

  /** 護病比拆成早/午/晚/整日四張獨立折線圖 (2×2)，避免曲線疊在一起難以判讀。 */
  private renderStaffingCharts(): void {
    const rows = this.staffingTableRows();
    if (rows.length === 0) return;

    const labels = rows.map((r: any) => {
      const parts = r.date.split('-');
      return `${parseInt(parts[1])}/${parseInt(parts[2])}`;
    });

    const parseNum = (v: string) => (v === 'N/A' || !v ? null : parseFloat(v));

    const configs: Array<{
      ref?: ElementRef<HTMLCanvasElement>;
      title: string;
      color: string;
      key: 'earlyRatio' | 'noonRatio' | 'lateRatio' | 'totalRatio';
    }> = [
      { ref: this.staffingEarlyCanvas, title: '早班護病比', color: '#4a90d9', key: 'earlyRatio' },
      { ref: this.staffingNoonCanvas, title: '午班護病比', color: '#e67e22', key: 'noonRatio' },
      { ref: this.staffingLateCanvas, title: '晚班護病比', color: '#27ae60', key: 'lateRatio' },
      { ref: this.staffingTotalCanvas, title: '整日護病比', color: '#e74c3c', key: 'totalRatio' },
    ];

    for (const cfg of configs) {
      const ctx = cfg.ref?.nativeElement.getContext('2d');
      if (!ctx) continue;

      const chart = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: cfg.title,
              data: rows.map((r: any) => parseNum(r[cfg.key])),
              borderColor: cfg.color,
              backgroundColor: cfg.color + '22',
              borderWidth: 2,
              tension: 0.3,
              pointRadius: 3,
              spanGaps: true,
              fill: true,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            title: { display: true, text: cfg.title, font: { size: 14 } },
          },
          scales: {
            y: { beginAtZero: true, title: { display: true, text: '護病比' } },
          },
        },
      });
      this.staffingCharts.push(chart);
    }
  }

  // --- Data Generation ---

  private getTaipeiTodayString(): string {
    const today = new Date();
    const options: Intl.DateTimeFormatOptions = { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' };
    const formatter = new Intl.DateTimeFormat('fr-CA', options);
    return formatter.format(today);
  }

  async generateReport(): Promise<void> {
    this.isLoading.set(true);
    this.hasGenerated.set(true);
    [this.dailyTableRows, this.monthlyTableRows, this.yearlyTableRows,
     this.staffingTableRows, this.dailyTableHeaders, this.monthlyTableHeaders,
     this.yearlyTableHeaders].forEach(arr => arr.set([] as any));

    try {
      let startDate: string | null = null;
      let endDate: string | null = null;

      if (this.reportType() === 'daily') {
        if (!this.selectedDate()) throw new Error('請選擇一個有效的日期。');
        startDate = this.selectedDate();
        endDate = this.selectedDate();
      } else if (this.reportType() === 'monthly' || this.reportType() === 'staffing_monthly') {
        if (!this.selectedMonth() || this.selectedMonth().indexOf('-') === -1) {
          throw new Error('請選擇一個有效的月份。');
        }
        const [year, month] = this.selectedMonth().split('-').map(Number);
        if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
          throw new Error('您選擇的月份格式不正確。');
        }
        const firstDay = new Date(year, month - 1, 1);
        const lastDay = new Date(year, month, 0);
        startDate = formatDateToYYYYMMDD(firstDay);
        endDate = formatDateToYYYYMMDD(lastDay);
      } else if (this.reportType() === 'yearly') {
        const year = Number(this.selectedYear());
        if (!year || isNaN(year) || year < 1900 || year > 2100) {
          throw new Error('請選擇一個有效的年份。');
        }
        startDate = formatDateToYYYYMMDD(new Date(year, 0, 1));
        endDate = formatDateToYYYYMMDD(new Date(year, 11, 31));
      }

      if (!startDate || !endDate) {
        throw new Error('無法計算出有效的開始或結束日期。');
      }

      this.reportDateRange.set({ start: startDate, end: endDate });

      if (this.reportType() === 'staffing_monthly') {
        const allDailyLogs = await this.dailyLogsApi.fetchAll();
        const dailyLogsData = allDailyLogs.filter((d: any) => d.date >= startDate && d.date <= endDate);
        this.processStaffingReport(dailyLogsData);
      } else {
        // 同時抓 schedules 與 archived_schedules：歸檔可能不完整,過去日期可能仍只在 schedules
        // 同日期兩表都有時,歸檔(archived)為真理之源,後寫覆蓋前者
        const [schedAll, expiredAll, patientsData] = await Promise.all([
          this.schedulesApi.fetchAll(),
          this.expiredSchedulesApi.fetchAll(),
          this.patientsApi.fetchAll(),
        ]);
        const patientMap = new Map(patientsData.map((p: any) => [p.id, p]));
        const inRange = (d: any) => d.date >= startDate! && d.date <= endDate!;
        const byDate = new Map<string, any>();
        for (const r of schedAll as any[]) if (inRange(r)) byDate.set(r.date, r);
        for (const r of expiredAll as any[]) if (inRange(r)) byDate.set(r.date, r);
        const allSchedules = Array.from(byDate.values());

        if (this.reportType() === 'daily') {
          this.processDailyReport(allSchedules, patientMap);
        } else if (this.reportType() === 'monthly') {
          this.processMonthlyReport(allSchedules, patientMap, startDate);
        } else if (this.reportType() === 'yearly') {
          // 每月月底常規門診病人數：後端每晚快照（cron）＋歷史倒推（backfill 估算），取不到不影響人次表
          let census: (MonthlyCensusCell | null)[] = [];
          try {
            const resp: any = await localApi.get(`/system/patient-census?year=${this.selectedYear()}`);
            census = Array.isArray(resp?.months) ? resp.months : [];
            // 當月尚無快照（23:45 才記）→ 以即時人數補上「截至今天」
            const t = resp?.today;
            if (t?.date && String(t.date).slice(0, 4) === String(this.selectedYear())) {
              const mi = Number(String(t.date).slice(5, 7)) - 1;
              if (mi >= 0 && mi < 12 && !census[mi]) {
                census[mi] = { date: t.date, opdRegular: t.opdRegular, opd: t.opd, ipd: t.ipd, er: t.er, source: 'live' };
              }
            }
          } catch (e) {
            console.warn('取得月底病人數快照失敗（年度報表略過此列）:', e);
          }
          this.processYearlyReport(allSchedules, patientMap, census);
        }
      }

      // Render chart after data is ready (use setTimeout to ensure canvas is visible)
      setTimeout(() => this.renderChart(), 50);
    } catch (error: any) {
      console.error('生成報表失敗:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  // --- Excel Export ---

  async exportToExcel(): Promise<void> {
    const XLSX = await import('xlsx');
    if (this.noData()) return;
    let headers!: string[];
    let dataRows!: any[][];
    let filename!: string;
    const excelTitle = this.reportTitle();

    if (this.reportType() === 'daily') {
      headers = ['透析模式', '類別', ...this.dailyTableHeaders(), '當日總計'];
      dataRows = this.dailyTableRows().map((row: any) => [
        row.mode, row.status, ...row.shiftCounts, row.dailyTotal,
      ]);
      filename = `日報表_${this.selectedDate()}.xlsx`;
    } else if (this.reportType() === 'monthly') {
      headers = ['透析模式', '類別', ...this.monthlyTableHeaders().map(String), '月總計'];
      dataRows = this.monthlyTableRows().map((row: any) => [
        row.mode, row.status, ...row.dailyCounts, row.monthlyTotal,
      ]);
      filename = `月報表_${this.selectedMonth()}.xlsx`;
    } else if (this.reportType() === 'yearly') {
      headers = ['透析模式', '類別', ...this.yearlyTableHeaders(), '年總計'];
      dataRows = this.yearlyTableRows().map((row: any) => [
        row.mode, row.status, ...row.monthlyCounts, row.yearlyTotal,
      ]);
      filename = `年度報表_${this.selectedYear()}.xlsx`;
    } else if (this.reportType() === 'staffing_monthly') {
      headers = ['日期', '第一班人次', '第一班人力', '第一班護病比', '第二班人次', '第二班人力', '第二班護病比', '第三班人次', '第三班人力', '第三班護病比', '整日人次', '整日人力', '整日護病比', '須修正'];
      dataRows = this.staffingTableRows().map((row: any) => {
        const flags: string[] = [];
        if (this.isRatioInvalid(row.earlyRatio)) flags.push('早班');
        if (this.isRatioInvalid(row.noonRatio)) flags.push('午班');
        if (this.isRatioInvalid(row.lateRatio)) flags.push('晚班');
        return [
          row.date, row.earlyPatients, row.earlyStaff, row.earlyRatio, row.noonPatients, row.noonStaff, row.noonRatio, row.latePatients, row.lateStaff, row.lateRatio, row.totalPatients, row.totalStaff, row.totalRatio,
          flags.length ? '⚠ ' + flags.join('、') : '',
        ];
      });
      filename = `護理人力月報表_${this.selectedMonth()}.xlsx`;
    } else {
      return;
    }

    const titleRow = [excelTitle];
    const emptyRow: string[] = [];
    const data = [titleRow, emptyRow, headers, ...dataRows];
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(data);
    const merge = { s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } };
    if (!worksheet['!merges']) worksheet['!merges'] = [];
    worksheet['!merges'].push(merge);
    XLSX.utils.book_append_sheet(workbook, worksheet, '報表');
    XLSX.writeFile(workbook, filename);
  }

  // --- Data Processing (unchanged) ---

  /** 護病比沒填(N/A)或為 0 → 視為須修正,表格標紅底提示。 */
  isRatioInvalid(value: any): boolean {
    if (value === null || value === undefined || value === '' || value === 'N/A') return true;
    const n = Number(value);
    return !isNaN(n) && n === 0;
  }

  private processStaffingReport(dailyLogsData: any[]): void {
    const calcRatio = (patients: number, staff: number): string => {
      if (!staff || staff === 0) return 'N/A';
      return (patients / staff).toFixed(2);
    };

    // 與 daily-log 的 calculatedStaffingTotals 一致：人力非直接存,需由 details(count×ratioN) + adjustments(×0.125) 算出
    const calcStaffTotals = (staffing: any): { early: number; noon: number; late: number } => {
      const totals = { early: 0, noon: 0, late: 0 };
      if (staffing && Array.isArray(staffing.details)) {
        staffing.details.forEach((item: any) => {
          const count = Number(item.count) || 0;
          totals.early += count * (Number(item.ratio1) || 0);
          totals.noon += count * (Number(item.ratio2) || 0);
          totals.late += count * (Number(item.ratio3) || 0);
        });
      }
      if (staffing) {
        const adjustments = staffing.adjustments || staffing.deductions || {};
        totals.early += (Number(adjustments.shift1) || 0) * 0.125;
        totals.noon += (Number(adjustments.shift2) || 0) * 0.125;
        totals.late += (Number(adjustments.shift3) || 0) * 0.125;
      }
      totals.early = Math.max(0, totals.early);
      totals.noon = Math.max(0, totals.noon);
      totals.late = Math.max(0, totals.late);
      return totals;
    };

    const reportData = dailyLogsData
      .map(log => {
        const staffing = log.stats?.staffing;
        const mainBeds = log.stats?.main_beds || {};
        const periBeds = log.stats?.peripheral_beds || {};

        // Patient counts per shift (same logic as daily log component)
        const earlyPatients = (mainBeds.early?.total || 0) + (periBeds.early?.total || 0);
        const noonPatients = (mainBeds.noon?.total || 0) + (periBeds.noon?.total || 0);
        const latePatients = (mainBeds.late?.total || 0) + (periBeds.late?.total || 0);
        const totalPatients = earlyPatients + noonPatients + latePatients;

        // Nurse staffing per shift (computed from staffing.details + adjustments)
        const staffTotals = calcStaffTotals(staffing);
        const earlyStaff = staffTotals.early;
        const noonStaff = staffTotals.noon;
        const lateStaff = staffTotals.late;
        const totalStaff = earlyStaff + noonStaff + lateStaff;

        return {
          date: log.date,
          earlyPatients,
          noonPatients,
          latePatients,
          totalPatients,
          earlyStaff: earlyStaff ? earlyStaff.toFixed(3) : 'N/A',
          noonStaff: noonStaff ? noonStaff.toFixed(3) : 'N/A',
          lateStaff: lateStaff ? lateStaff.toFixed(3) : 'N/A',
          totalStaff: totalStaff ? totalStaff.toFixed(3) : 'N/A',
          earlyRatio: calcRatio(earlyPatients, earlyStaff),
          noonRatio: calcRatio(noonPatients, noonStaff),
          lateRatio: calcRatio(latePatients, lateStaff),
          totalRatio: calcRatio(totalPatients, totalStaff),
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));
    this.staffingTableRows.set(reportData);
  }

  private processDailyReport(allSchedules: any[], patientMap: Map<string, any>): void {
    const shiftBreakdown: Record<string, Record<string, number>> = {};
    const dailyRecord = allSchedules[0];
    if (dailyRecord && dailyRecord.schedule) {
      for (const [shiftKey, slotData] of Object.entries<any>(dailyRecord.schedule)) {
        if (!slotData?.patientId) continue;
        let patientStatus: string, patientMode: string;
        if (slotData.archivedPatientInfo) {
          patientStatus = slotData.archivedPatientInfo.status || 'unknown';
          patientMode = slotData.archivedPatientInfo.mode || 'HD';
        } else {
          const patient = patientMap.get(slotData.patientId);
          patientStatus = patient ? patient.status || 'unknown' : 'unknown';
          patientMode = slotData.modeOverride || (patient ? patient.mode || 'HD' : 'HD');
        }
        if (patientMode === 'CVVHDF') continue;
        const shiftCode = shiftKey.split('-').pop();
        if (!shiftCode) continue;
        if (!shiftBreakdown[shiftCode]) shiftBreakdown[shiftCode] = {};
        const comboKey = `${patientMode}-${patientStatus}`;
        if (!shiftBreakdown[shiftCode][comboKey]) shiftBreakdown[shiftCode][comboKey] = 0;
        shiftBreakdown[shiftCode][comboKey]++;
      }
    }
    const shiftOrder = [SHIFT_CODES.EARLY, SHIFT_CODES.NOON, SHIFT_CODES.LATE];
    this.dailyTableHeaders.set(shiftOrder.map((code: string) => getShiftDisplayName(code)));
    const reportMatrix: Record<string, any> = {};
    const statusDisplay: Record<string, string> = { opd: '門診', ipd: '住院', er: '急診', unknown: '未知' };
    shiftOrder.forEach((shiftCode: string, shiftIndex: number) => {
      const shiftData = shiftBreakdown[shiftCode] || {};
      for (const comboKey in shiftData) {
        if (!reportMatrix[comboKey]) {
          const [mode, status] = comboKey.split('-');
          reportMatrix[comboKey] = {
            mode, status: statusDisplay[status] || status,
            shiftCounts: Array(shiftOrder.length).fill(0), dailyTotal: 0,
          };
        }
        const count = shiftData[comboKey];
        reportMatrix[comboKey].shiftCounts[shiftIndex] = count;
        reportMatrix[comboKey].dailyTotal += count;
      }
    });
    const shiftTotalsRow = {
      mode: '每班總計', status: '',
      shiftCounts: Array(shiftOrder.length).fill(0), dailyTotal: 0,
    };
    const sortedRows = this.sortReportRows(Object.values(reportMatrix));
    sortedRows.forEach((row: any) => {
      row.shiftCounts.forEach((count: number, index: number) => {
        shiftTotalsRow.shiftCounts[index] += count;
      });
    });
    shiftTotalsRow.dailyTotal = shiftTotalsRow.shiftCounts.reduce((sum: number, count: number) => sum + count, 0);
    this.dailyTableRows.set([...sortedRows, shiftTotalsRow]);
  }

  private processMonthlyReport(allSchedules: any[], patientMap: Map<string, any>, monthStartDate: string): void {
    const dailyBreakdown: Record<string, Record<string, number>> = {};
    for (const dailyRecord of allSchedules) {
      if (!dailyRecord.schedule) continue;
      const dateKey = dailyRecord.date;
      if (!dailyBreakdown[dateKey]) dailyBreakdown[dateKey] = {};
      for (const slotData of Object.values<any>(dailyRecord.schedule)) {
        if (!slotData?.patientId) continue;
        let patientStatus: string, patientMode: string;
        if (slotData.archivedPatientInfo) {
          patientStatus = slotData.archivedPatientInfo.status || 'unknown';
          patientMode = slotData.archivedPatientInfo.mode || 'HD';
        } else {
          const patient = patientMap.get(slotData.patientId);
          patientStatus = patient ? patient.status || 'unknown' : 'unknown';
          patientMode = slotData.modeOverride || (patient ? patient.mode || 'HD' : 'HD');
        }
        if (patientMode === 'CVVHDF') continue;
        const comboKey = `${patientMode}-${patientStatus}`;
        if (!dailyBreakdown[dateKey][comboKey]) dailyBreakdown[dateKey][comboKey] = 0;
        dailyBreakdown[dateKey][comboKey]++;
      }
    }
    const month = new Date(monthStartDate).getMonth();
    const year = new Date(monthStartDate).getFullYear();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    this.monthlyTableHeaders.set(Array.from({ length: daysInMonth }, (_, i) => i + 1));
    const reportMatrix: Record<string, any> = {};
    const statusDisplay: Record<string, string> = { opd: '門診', ipd: '住院', er: '急診', unknown: '未知' };
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = formatDateToYYYYMMDD(new Date(year, month, day));
      const dayData = dailyBreakdown[dateStr] || {};
      for (const comboKey in dayData) {
        if (!reportMatrix[comboKey]) {
          const [mode, status] = comboKey.split('-');
          reportMatrix[comboKey] = {
            mode, status: statusDisplay[status] || status,
            dailyCounts: Array(daysInMonth).fill(0), monthlyTotal: 0,
          };
        }
        const count = dayData[comboKey];
        reportMatrix[comboKey].dailyCounts[day - 1] = count;
        reportMatrix[comboKey].monthlyTotal += count;
      }
    }
    const dailyTotalsRow = {
      mode: '每日總計', status: '',
      dailyCounts: Array(daysInMonth).fill(0), monthlyTotal: 0,
    };
    const sortedRows = this.sortReportRows(Object.values(reportMatrix));
    sortedRows.forEach((row: any) => {
      row.dailyCounts.forEach((count: number, index: number) => {
        dailyTotalsRow.dailyCounts[index] += count;
      });
    });
    dailyTotalsRow.monthlyTotal = dailyTotalsRow.dailyCounts.reduce((sum: number, count: number) => sum + count, 0);
    this.monthlyTableRows.set([...sortedRows, dailyTotalsRow]);
  }

  // 日/月/年報表列順序（使用者指定）：HD門診/住院/急診 → SLED → PE(PP) → DFPP → Lipid；清單外的模式排最後
  private readonly REPORT_MODE_ORDER = ['HD', 'SLED', 'PE', 'PP', 'DFPP', 'Lipid'];
  private readonly REPORT_STATUS_ORDER = ['門診', '住院', '急診', '未知'];

  private orderRank(order: string[], value: string): number {
    const i = order.indexOf(value);
    return i === -1 ? order.length : i;
  }

  private sortReportRows(rows: any[]): any[] {
    return rows.sort(
      (a: any, b: any) =>
        this.orderRank(this.REPORT_MODE_ORDER, a.mode) - this.orderRank(this.REPORT_MODE_ORDER, b.mode) ||
        this.orderRank(this.REPORT_STATUS_ORDER, a.status) - this.orderRank(this.REPORT_STATUS_ORDER, b.status) ||
        a.mode.localeCompare(b.mode) || a.status.localeCompare(b.status),
    );
  }

  private processYearlyReport(allSchedules: any[], patientMap: Map<string, any>, census: (MonthlyCensusCell | null)[] = []): void {
    const monthlyBreakdown: Record<string, number[]> = {};
    for (const dailyRecord of allSchedules) {
      if (!dailyRecord.schedule) continue;
      const recordDate = new Date(dailyRecord.date + 'T00:00:00');
      const monthIndex = recordDate.getMonth();
      for (const slotData of Object.values<any>(dailyRecord.schedule)) {
        if (!slotData?.patientId) continue;
        let patientStatus: string, patientMode: string;
        if (slotData.archivedPatientInfo) {
          patientStatus = slotData.archivedPatientInfo.status || 'unknown';
          patientMode = slotData.archivedPatientInfo.mode || 'HD';
        } else {
          const patient = patientMap.get(slotData.patientId);
          patientStatus = patient ? patient.status || 'unknown' : 'unknown';
          patientMode = slotData.modeOverride || (patient ? patient.mode || 'HD' : 'HD');
        }
        if (patientMode === 'CVVHDF') continue;
        const comboKey = `${patientMode}-${patientStatus}`;
        if (!monthlyBreakdown[comboKey]) monthlyBreakdown[comboKey] = Array(12).fill(0);
        monthlyBreakdown[comboKey][monthIndex]++;
      }
    }
    this.yearlyTableHeaders.set(Array.from({ length: 12 }, (_, i) => `${i + 1}月`));
    const reportMatrix: Record<string, any> = {};
    const statusDisplay: Record<string, string> = { opd: '門診', ipd: '住院', er: '急診', unknown: '未知' };
    for (const comboKey in monthlyBreakdown) {
      const [mode, status] = comboKey.split('-');
      const monthlyCounts = monthlyBreakdown[comboKey];
      reportMatrix[comboKey] = {
        mode, status: statusDisplay[status] || status,
        monthlyCounts, yearlyTotal: monthlyCounts.reduce((sum: number, count: number) => sum + count, 0),
      };
    }
    const monthlyTotalsRow = {
      mode: '每月總計', status: '',
      monthlyCounts: Array(12).fill(0), yearlyTotal: 0,
    };
    const sortedRows = this.sortReportRows(Object.values(reportMatrix));
    sortedRows.forEach((row: any) => {
      row.monthlyCounts.forEach((count: number, index: number) => {
        monthlyTotalsRow.monthlyCounts[index] += count;
      });
    });
    monthlyTotalsRow.yearlyTotal = monthlyTotalsRow.monthlyCounts.reduce(
      (sum: number, count: number) => sum + count, 0
    );
    // 常規門診病人數（月底）列：放最上方、單位是「人」非人次，不計入每月總計/圖表
    // 估算值（backfill）加「≈」、當月未結束標「截至 M/D」
    const censusRow = census.length > 0 ? this.buildCensusRow(census) : null;
    this.yearlyTableRows.set([...(censusRow ? [censusRow] : []), ...sortedRows, monthlyTotalsRow]);
  }

  private buildCensusRow(census: (MonthlyCensusCell | null)[]): any {
    const year = Number(this.selectedYear());
    const today = new Date();
    const monthlyCounts = Array(12).fill(0);
    const monthlyLabels: string[] = Array(12).fill('');
    const monthlyTitles: string[] = Array(12).fill('');
    for (let i = 0; i < 12; i++) {
      const cell = census[i];
      if (!cell) continue;
      monthlyCounts[i] = cell.opdRegular;
      const lastDay = new Date(year, i + 1, 0);
      const isMonthClosed = lastDay < new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const d = cell.date;
      const md = `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
      const isLastDay = d === formatDateToYYYYMMDD(lastDay);
      const approx = cell.source === 'backfill' ? '≈' : '';
      monthlyLabels[i] = `${approx}${cell.opdRegular}${isMonthClosed && !isLastDay ? `(${md})` : (!isMonthClosed ? `(截至${md})` : '')}`;
      monthlyTitles[i] = `${d} 常規門診 ${cell.opdRegular}／門診 ${cell.opd}／住院 ${cell.ipd}／急診 ${cell.er}` +
        (cell.source === 'backfill' ? '（由病人異動紀錄倒推的估算值）' : cell.source === 'live' ? '（即時人數，今晚 23:45 存快照）' : '（每日快照）');
    }
    return {
      mode: CENSUS_ROW_MODE, status: '月底人數', isCensus: true,
      monthlyCounts, monthlyLabels, monthlyTitles, yearlyTotal: '',
    };
  }
}
