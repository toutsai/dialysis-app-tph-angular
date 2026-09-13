import { Component, OnInit, ViewChild, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiConfigService } from '@services/api-config.service';
import { AuthService } from '@services/auth.service';
import { PatientStoreService } from '@services/patient-store.service';
import { ConsumptionEngineService } from '@services/consumption-engine.service';
import { AlertDialogComponent } from '@app/components/dialogs/alert-dialog/alert-dialog.component';
import { ClerkPhysicianPrintComponent } from './clerk-physician-print.component';
import { ClerkRegistrationComponent } from './clerk-registration.component';
import { ClerkInjectionPrintComponent } from './clerk-injection-print.component';
import { ClerkGentamycinListComponent } from './clerk-gentamycin-list.component';
import { CatastrophicIllnessComponent } from '../catastrophic-illness/catastrophic-illness.component';
import {
  PurchaseCalendarComponent,
  type PurchaseEntry,
  type CalendarDaySelection,
  type CalendarWeekSelection,
  type CalendarMonthSelection,
  type CalendarUploadRange,
  type CalendarDailyForecast,
} from './purchase-calendar.component';
import { InventoryDayPanelComponent } from './inventory-day-panel.component';
import { InventoryWeekPanelComponent } from './inventory-week-panel.component';
import { InventoryMonthPanelComponent } from './inventory-month-panel.component';
import { InventoryUploadComponent } from './inventory-upload.component';
import {
  ApiManagerService,
  type ApiManager,
  type FirestoreRecord,
} from '@services/api-manager.service';
import { formatRangeKey } from '@/utils/consumablesReport';
import { InventoryStockService, type CountDoc } from './inventory-stock.service';

const CATEGORY_NAMES: Record<string, string> = {
  artificialKidney: '人工腎臟',
  dialysateCa: '透析藥水CA',
  bicarbonateType: 'B液種類',
};

const DEFAULT_ITEMS: Record<string, string[]> = {
  artificialKidney: ['15S', '17UX', '25H', '34', 'APS21S', 'BG1.8', 'CAT/2000', 'FX80', 'HI:23'],
  dialysateCa: ['2.5', '3.0', '3.5'],
  bicarbonateType: ['0_袋裝Bicarbonate 500mg', '1_瓶裝Bicarbonate 500mg', '2_Hemodialysis 5L B液'],
};

const WEEKDAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

/** 作業面板狀態（依行事曆選取的日/週/月切換） */
type PanelState =
  | { kind: 'day'; ymd: string; entries: PurchaseEntry[] }
  | { kind: 'week'; isoWeek: string; start: string; end: string }
  | { kind: 'month'; month: string };

@Component({
  selector: 'app-inventory',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    AlertDialogComponent,
    ClerkPhysicianPrintComponent,
    ClerkRegistrationComponent,
    ClerkInjectionPrintComponent,
    ClerkGentamycinListComponent,
    CatastrophicIllnessComponent,
    PurchaseCalendarComponent,
    InventoryDayPanelComponent,
    InventoryWeekPanelComponent,
    InventoryMonthPanelComponent,
    InventoryUploadComponent,
  ],
  templateUrl: './inventory.component.html',
  styleUrl: './inventory.component.css',
})
export class InventoryComponent implements OnInit {
  private readonly firebaseService = inject(ApiConfigService);
  protected readonly authService = inject(AuthService);
  private readonly patientStore = inject(PatientStoreService);
  private readonly consumptionEngine = inject(ConsumptionEngineService);
  private readonly apiManagerService = inject(ApiManagerService);
  /** 庫存推算單一權威（盤點/到貨/消耗/安全庫存/訂購量） */
  private readonly stock = inject(InventoryStockService);

  // API managers
  private readonly machineConfigApi: ApiManager<FirestoreRecord>;
  private readonly bedSettingsApi: ApiManager<FirestoreRecord>;
  private readonly inventoryItemsApi: ApiManager<FirestoreRecord>;
  private readonly purchasesApi: ApiManager<FirestoreRecord>;
  private readonly countsApi: ApiManager<FirestoreRecord>;
  private readonly consumablesReportsApi: ApiManager<FirestoreRecord>;

  readonly CATEGORY_NAMES = CATEGORY_NAMES;
  readonly categoryKeys = Object.keys(CATEGORY_NAMES);

  /** 書記專用主頁籤：醫師班表列印 / 常規病人掛號 / 針劑發放名單 / Gentamycin 開立清單 / 重大傷病申請 / 庫存管理 */
  mainTab = signal<'physician' | 'register' | 'injection' | 'gentamycin' | 'catastrophic' | 'inventory'>('physician');

  /** 庫存管理內層：作業行事曆 / 設定 */
  activeTab = signal<'calendar' | 'settings'>('calendar');
  settingsTab = signal<'items' | 'beds'>('items');

  // ==================== 作業行事曆 ====================
  /** 庫存總覽可收合（預設展開） */
  overviewCollapsed = signal(false);
  /** 上傳消耗 Excel 視窗 */
  showUpload = signal(false);
  /** 行事曆：有盤點文件的日期 */
  countDates = signal<string[]>([]);
  /** 行事曆：實際消耗已上傳的區間覆蓋條 */
  uploadRanges = signal<CalendarUploadRange[]>([]);
  /** 行事曆：可見範圍的每日排程推估消耗（格子小字） */
  dailyForecast = signal<CalendarDailyForecast>({});
  private dailyForecastSeq = 0;
  /** 日面板（@if 內，只有 kind='day' 時存在）；工具列「今日盤點」用來捲到盤點區 */
  @ViewChild(InventoryDayPanelComponent) private dayPanelCmp?: InventoryDayPanelComponent;
  /** 行事曆高亮 */
  selectedDate = signal<string | null>(null);
  selectedWeekStart = signal<string | null>(null);
  /** 目前作業面板 */
  panel = signal<PanelState>({ kind: 'day', ymd: this.stock.todayString(), entries: [] });
  /** 遞增 → 行事曆重抓叫貨/到貨（面板建立叫貨後行事曆才會出現） */
  calendarRefresh = signal(0);

  readonly dayPanel = computed(() => {
    const p = this.panel();
    return p.kind === 'day' ? p : null;
  });
  readonly weekPanel = computed(() => {
    const p = this.panel();
    return p.kind === 'week' ? p : null;
  });
  readonly monthPanel = computed(() => {
    const p = this.panel();
    return p.kind === 'month' ? p : null;
  });

  /** 面板上方的標題（目前選取） */
  readonly panelTitle = computed(() => {
    const p = this.panel();
    if (p.kind === 'day') return `${p.ymd}（${this.weekdayOf(p.ymd)}）`;
    if (p.kind === 'week') return `${p.isoWeek} ${this.monthDay(p.start)}～${this.monthDay(p.end)}`;
    return `${p.month} 月報表`;
  });

  /** 行事曆目前可見範圍（翻頁時更新，用來重載盤點日徽章） */
  private visibleRange: { start: string; end: string } = { start: '', end: '' };

  // ==================== Dashboard ====================
  dashboardLoading = signal(false);
  dashboardLoaded = signal(false);
  dashboardItems = signal<{ category: string; itemName: string; estimatedStock: number; safeLevel: number; autoSafeLevel: number; dailyUsage: number; todayConsumption: number; remainingAfterToday: number; pending: number; status: 'safe' | 'warning' | 'danger' | 'critical'; statusLabel: string }[]>([]);
  dashboardLastCountDate = signal('');
  /** 是否找得到任何盤點紀錄（false → 畫面顯示「請先盤點」而不是全 0） */
  dashboardHasCount = signal(false);
  /** 盤點基礎距今幾天 */
  dashboardCountAgeDays = signal(0);
  /** 上一個完整週消耗的資料來源說明 */
  dashboardConsumptionNote = signal('');

  // Alert dialog
  isAlertDialogVisible = signal(false);
  alertDialogTitle = signal('');
  alertDialogMessage = signal('');

  // ==================== 設定：品項設定 ====================
  inventoryItems = signal<any[]>([]);
  filteredInventoryItems = signal<any[]>([]);
  itemsLoading = signal(false);
  itemFilter = { category: '', search: '' };
  showItemModal = signal(false);
  editingItem = signal<any>(null);
  itemForm = {
    category: '',
    name: '',
    unitsPerBox: null as number | null,
    safeInventoryLevel: 0 as number,
    hospitalCode: '',
    brand: '',
    vendorPhone: '',
  };

  get isItemFormValid(): boolean {
    return !!(this.itemForm.category && this.itemForm.name);
  }

  // ==================== 設定：床位預設用物 ====================
  bedsSettings = signal<any[]>([]);
  bedsLoading = signal(false);

  // Machine type → B-liquid mapping
  machineConfigs = signal<{ id?: string; machineType: string; defaultBicarbonate: string }[]>([]);
  machineConfigLoading = signal(false);
  showMachineConfigModal = signal(false);
  machineConfigForm = { machineType: '', defaultBicarbonate: '' };
  editingMachineConfig = signal<any>(null);

  get isMachineConfigFormValid(): boolean {
    return !!(this.machineConfigForm.machineType && this.machineConfigForm.defaultBicarbonate);
  }

  get machineTypeNames(): string[] {
    return this.machineConfigs().map(c => c.machineType);
  }

  // ==================== 叫貨/到貨資料（總覽與面板共用） ====================
  purchases = signal<any[]>([]);
  purchaseLoading = signal(false);
  /** 給行事曆/面板子元件用：每箱個數 */
  readonly unitsPerBoxFn = (category: string, item: string) => this.getUnitsPerBox(category, item);

  knownItems: Record<string, string[]> = {
    artificialKidney: [],
    dialysateCa: [],
    bicarbonateType: [],
  };

  constructor() {
    this.machineConfigApi = this.apiManagerService.create<FirestoreRecord>('machine_bicarbonate_config');
    this.bedSettingsApi = this.apiManagerService.create<FirestoreRecord>('bed_inventory_settings');
    this.inventoryItemsApi = this.apiManagerService.create<FirestoreRecord>('inventory_items');
    this.purchasesApi = this.apiManagerService.create<FirestoreRecord>('inventory_purchases');
    this.countsApi = this.apiManagerService.create<FirestoreRecord>('inventory_counts');
    this.consumablesReportsApi = this.apiManagerService.create<FirestoreRecord>('consumables_reports');
  }

  async ngOnInit(): Promise<void> {
    await this.patientStore.fetchPatientsIfNeeded();
    await this.initializeDefaultItems();
    await this.fetchInventoryItems();
    await this.fetchMachineConfigs(); // Load machine configs BEFORE beds
    await this.fetchBedsSettings();
    await this.fetchPurchases();
    await this.loadKnownItems();
    this.selectedDate.set(this.stock.todayString());
    this.refreshDayPanelEntries();
    await this.loadUploadRanges();
    await this.loadCountDates();
    this.loadDashboard();
  }

  // ==================== 作業行事曆：事件接線 ====================

  /**
   * 點格子 → 日面板。
   * 明細一律由父元件的 purchases 依日期篩（不用行事曆帶來的 entries：行事曆套了類別/品項篩選時會漏）。
   */
  onDaySelected(e: CalendarDaySelection): void {
    this.selectedDate.set(e.ymd);
    this.selectedWeekStart.set(null);
    this.panel.set({ kind: 'day', ymd: e.ymd, entries: this.entriesForDate(e.ymd) });
  }

  /** 日面板的盤點紀錄列 → 切換日期 */
  onDayPanelDateSelected(ymd: string): void {
    this.onDaySelected({ ymd, entries: [] });
  }

  /** 該日的叫貨/到貨明細：已到貨看到貨日、待到貨看預計到貨日（與行事曆 displayDate 同規則） */
  private entriesForDate(ymd: string): PurchaseEntry[] {
    const day = (v: unknown): string => {
      const s = typeof v === 'string' ? v : '';
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      if (!s) return '';
      const d = new Date(s);
      if (isNaN(d.getTime())) return s.substring(0, 10);
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };
    return (this.purchases() as any[])
      .map((p) => ({ ...p, status: p?.status === 'ordered' ? 'ordered' : 'arrived' }) as PurchaseEntry)
      .filter((p) => (p.status === 'ordered' ? day(p.expectedDate) : day(p.date) || day(p.expectedDate)) === ymd);
  }

  /** purchases 重載後，讓日面板的明細跟著更新 */
  private refreshDayPanelEntries(): void {
    const p = this.panel();
    if (p.kind !== 'day') return;
    this.panel.set({ kind: 'day', ymd: p.ymd, entries: this.entriesForDate(p.ymd) });
  }

  /** 點週次 → 週面板 */
  onWeekSelected(e: CalendarWeekSelection): void {
    this.selectedWeekStart.set(e.start);
    this.selectedDate.set(null);
    this.panel.set({ kind: 'week', isoWeek: e.isoWeek, start: e.start, end: e.end });
  }

  /** 點月份標題 → 月面板 */
  onMonthSelected(e: CalendarMonthSelection): void {
    this.selectedDate.set(null);
    this.selectedWeekStart.set(null);
    this.panel.set({ kind: 'month', month: e.month });
  }

  /** 行事曆翻頁/切換檢視 → 重載可見範圍的盤點日徽章 + 每日推估消耗 */
  async onVisibleRangeChanged(range: { start: string; end: string }): Promise<void> {
    this.visibleRange = { start: range.start, end: range.end };
    void this.loadDailyForecast();
    await this.loadCountDates();
  }

  /** 可見範圍的每日排程推估消耗（一次抓整段排程；翻頁很快時只採用最後一次的結果） */
  private async loadDailyForecast(): Promise<void> {
    const { start, end } = this.visibleRange;
    if (!start || !end) return;
    const seq = ++this.dailyForecastSeq;
    try {
      const byDate = await this.consumptionEngine.calculateDailyTheoreticalConsumption(start, end);
      if (seq !== this.dailyForecastSeq) return;
      const out: CalendarDailyForecast = {};
      for (const [ymd, day] of byDate) out[ymd] = day.grouped;
      this.dailyForecast.set(out);
    } catch (error) {
      console.warn('載入每日推估消耗失敗:', error);
      if (seq === this.dailyForecastSeq) this.dailyForecast.set({});
    }
  }

  /** 工具列「今日盤點」：切到今天的日面板並捲到盤點輸入區 */
  goTodayCount(): void {
    const today = this.stock.todayString();
    this.onDaySelected({ ymd: today, entries: [] });
    // 日面板在 @if 內，等 change detection 建好元件再捲動
    setTimeout(() => this.dayPanelCmp?.focusCount(), 0);
  }

  /** 行事曆/面板改了資料 → 盤點日、叫貨紀錄、總覽全部重載 */
  async onInventoryChanged(): Promise<void> {
    await this.loadCountDates();
    await this.fetchPurchases();
    this.refreshDayPanelEntries();
    this.calendarRefresh.update((n) => n + 1);
    await this.loadDashboard();
  }

  /** 消耗 Excel 上傳成功（視窗留著讓書記看結果摘要，由關閉鈕關） */
  async onUploaded(): Promise<void> {
    this.stock.invalidateActualRanges();
    await this.loadUploadRanges();
    // 對照確認視窗可能新增了品項/別名
    await this.fetchInventoryItems();
    await this.loadDashboard();
  }

  onPanelAlert(e: { title: string; message: string }): void {
    this.showAlert(e.title, e.message);
  }

  /** 盤點日徽章：可見範圍內的盤點文件日期 */
  private async loadCountDates(): Promise<void> {
    const { start, end } = this.visibleRange;
    try {
      const list = start && end
        ? await this.countsApi.fetchWhere({ from: start, to: end })
        : await this.countsApi.fetchAll();
      this.countDates.set(
        ((list || []) as any[]).map((d) => String(d?.countDate || '')).filter(Boolean),
      );
    } catch (error) {
      console.warn('載入盤點日期失敗:', error);
      this.countDates.set([]);
    }
  }

  /** 實際消耗已上傳區間 → 行事曆覆蓋條 */
  private async loadUploadRanges(): Promise<void> {
    try {
      const ranges = await this.stock.ensureActualRanges();
      this.uploadRanges.set(
        ranges.map((r) => ({ start: r.start, end: r.end, label: formatRangeKey(r.key) })),
      );
    } catch (error) {
      console.warn('載入實際消耗區間失敗:', error);
      this.uploadRanges.set([]);
    }
  }

  /** 'YYYY-MM-DD' → 星期中文（不用 new Date(str) 以免時區偏移） */
  private weekdayOf(ymd: string): string {
    const [y, m, d] = (ymd || '').split('-').map((n) => parseInt(n, 10));
    if (!y || !m || !d) return '';
    return WEEKDAY_NAMES[new Date(y, m - 1, d).getDay()] || '';
  }

  /** 'YYYY-MM-DD' → 'MM/DD' */
  private monthDay(ymd: string): string {
    const parts = (ymd || '').split('-');
    return parts.length === 3 ? `${parts[1]}/${parts[2]}` : ymd || '';
  }

  // ==================== 設定：床位 / 機型對照 ====================

  async fetchMachineConfigs(): Promise<void> {
    this.machineConfigLoading.set(true);
    try {
      const configs = await this.machineConfigApi.fetchAll();
      (configs as any[]).sort((a: any, b: any) => (a.machineType || '').localeCompare(b.machineType || ''));
      this.machineConfigs.set(configs as any[]);
    } catch (error) {
      console.warn('無法載入洗腎機設定:', error);
      this.machineConfigs.set([]);
    } finally {
      this.machineConfigLoading.set(false);
    }
  }

  openMachineConfigModal(config: any = null): void {
    if (config) {
      this.editingMachineConfig.set(config);
      this.machineConfigForm.machineType = config.machineType;
      this.machineConfigForm.defaultBicarbonate = config.defaultBicarbonate;
    } else {
      this.editingMachineConfig.set(null);
      this.machineConfigForm.machineType = '';
      this.machineConfigForm.defaultBicarbonate = '';
    }
    this.showMachineConfigModal.set(true);
  }

  /** 視窗內清單點「編輯」：把該筆帶進下方表單（不關視窗） */
  editMachineConfigInline(config: any): void {
    this.editingMachineConfig.set(config);
    this.machineConfigForm.machineType = config?.machineType || '';
    this.machineConfigForm.defaultBicarbonate = config?.defaultBicarbonate || '';
  }

  cancelMachineConfigEdit(): void {
    this.editingMachineConfig.set(null);
    this.machineConfigForm.machineType = '';
    this.machineConfigForm.defaultBicarbonate = '';
  }

  closeMachineConfigModal(): void {
    this.showMachineConfigModal.set(false);
    this.editingMachineConfig.set(null);
  }

  async saveMachineConfig(): Promise<void> {
    if (!this.isMachineConfigFormValid) return;
    try {
      const currentUser = this.authService.currentUser();
      const data: any = {
        machineType: this.machineConfigForm.machineType,
        defaultBicarbonate: this.machineConfigForm.defaultBicarbonate,
        updatedAt: new Date().toISOString(),
        updatedBy: currentUser?.name || '未知',
      };
      const editing = this.editingMachineConfig();
      if (editing) {
        await this.machineConfigApi.update(editing.id, data);
      } else {
        data.createdAt = new Date().toISOString();
        await this.machineConfigApi.create(data);
      }
      this.cancelMachineConfigEdit();
      await this.fetchMachineConfigs();
      this.showAlert('操作成功', editing ? '更新成功' : '新增成功');
    } catch (error: any) {
      console.error('儲存洗腎機設定失敗:', error);
      this.showAlert('儲存失敗', error.message);
    }
  }

  async deleteMachineConfig(config: any): Promise<void> {
    if (!confirm(`確定要刪除「${config.machineType}」的設定嗎？`)) return;
    try {
      await this.machineConfigApi.delete(config.id);
      await this.fetchMachineConfigs();
      this.showAlert('操作成功', '刪除成功');
    } catch (error: any) {
      console.error('刪除洗腎機設定失敗:', error);
      this.showAlert('刪除失敗', error.message);
    }
  }

  // --- Auto-fill: when machine is selected for a bed, populate B-liquid ---
  onBedMachineChange(bed: any): void {
    const config = this.machineConfigs().find(c => c.machineType === bed.machineType);
    if (config) {
      bed.defaultBicarbonate = config.defaultBicarbonate;
    }
  }

  async fetchBedsSettings(): Promise<void> {
    this.bedsLoading.set(true);

    const SCHEDULE_BED_NUMBERS: number[] = [
      1, 2, 3, 5, 6, 7, 8, 9, 11, 12, 13, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 28, 29,
      31, 32, 33, 35, 36, 37, 38, 39, 51, 52, 53, 55, 56, 57, 58, 59, 61, 62, 63, 65,
    ];
    const PERIPHERAL_BED_COUNT = 6;

    const beds: any[] = [];
    for (const num of SCHEDULE_BED_NUMBERS) {
      beds.push({ id: String(num), label: `第 ${num} 床`, machineType: '', defaultBicarbonate: '', _savedMachineType: '', _savedBicarbonate: '' });
    }
    for (let i = 1; i <= PERIPHERAL_BED_COUNT; i++) {
      beds.push({ id: `外${i}`, label: `外圍 第 ${i} 床`, machineType: '', defaultBicarbonate: '', _savedMachineType: '', _savedBicarbonate: '' });
    }

    try {
      const allSettings = await this.bedSettingsApi.fetchAll();
      const settingsMap = new Map<string, any>();
      allSettings.forEach((s: any) => {
        settingsMap.set(s.id, s);
      });
      for (const bed of beds) {
        const saved = settingsMap.get(bed.id);
        if (saved) {
          bed.machineType = saved.machineType || '';
          bed.defaultBicarbonate = saved.defaultBicarbonate || '';
          bed._savedMachineType = bed.machineType;
          bed._savedBicarbonate = bed.defaultBicarbonate;
        }
      }
    } catch (error) {
      console.warn('無法載入床位設定，使用預設空白值:', error);
    }

    this.bedsSettings.set(beds);
    this.bedsLoading.set(false);
  }

  async saveBedSetting(bed: any): Promise<void> {
    try {
      const currentUser = this.authService.currentUser();
      await this.bedSettingsApi.save(bed.id, {
        machineType: bed.machineType || '',
        defaultBicarbonate: bed.defaultBicarbonate || '',
        updatedAt: new Date().toISOString(),
        updatedBy: currentUser?.name || '未知',
      } as any);
      bed._savedMachineType = bed.machineType;
      bed._savedBicarbonate = bed.defaultBicarbonate;
      console.log(`床位 ${bed.id} 設定儲存成功`);
    } catch (error: any) {
      console.error(`床位 ${bed.id} 儲存失敗:`, error);
      this.showAlert('儲存失敗', `床位 ${bed.id}: ` + error.message);
    }
  }

  // ==================== 設定：品項 ====================

  async fetchInventoryItems(): Promise<void> {
    this.itemsLoading.set(true);
    try {
      let results = await this.inventoryItemsApi.fetchAll();
      // Sort locally
      (results as any[]).sort((a: any, b: any) => {
        const catCmp = (a.category || '').localeCompare(b.category || '');
        return catCmp !== 0 ? catCmp : (a.name || '').localeCompare(b.name || '');
      });

      if (this.itemFilter.category) {
        results = results.filter((item: any) => item.category === this.itemFilter.category);
      }

      this.inventoryItems.set(results as any[]);
      this.filteredInventoryItems.set(results as any[]);

      results.forEach((item: any) => {
        if (!this.knownItems[item.category].includes(item.name)) {
          this.knownItems[item.category].push(item.name);
        }
      });
    } catch (error) {
      console.error('載入品項設定失敗:', error);
      this.useDefaultItemsAsFallback();
    } finally {
      this.itemsLoading.set(false);
    }
  }

  private useDefaultItemsAsFallback(): void {
    const fallbackItems: any[] = [];
    let id = 1;
    for (const [category, items] of Object.entries(DEFAULT_ITEMS)) {
      for (const itemName of items) {
        fallbackItems.push({
          id: `default-${id++}`,
          category,
          name: itemName,
          unitsPerBox: null,
          safeInventoryLevel: 0,
          hospitalCode: null,
          vendorPhone: null,
          createdBy: '系統預設',
        });
        if (!this.knownItems[category].includes(itemName)) {
          this.knownItems[category].push(itemName);
        }
      }
    }
    this.inventoryItems.set(fallbackItems);
    this.filteredInventoryItems.set(fallbackItems);
  }

  filterItems(): void {
    const search = this.itemFilter.search.toLowerCase();
    if (!search) {
      this.filteredInventoryItems.set(this.inventoryItems());
    } else {
      this.filteredInventoryItems.set(
        this.inventoryItems().filter(
          (item: any) =>
            item.name.toLowerCase().includes(search) ||
            (item.hospitalCode && item.hospitalCode.toLowerCase().includes(search))
        )
      );
    }
  }

  openItemModal(item: any = null): void {
    if (item) {
      this.editingItem.set(item);
      this.itemForm.category = item.category;
      this.itemForm.name = item.name;
      this.itemForm.unitsPerBox = item.unitsPerBox || null;
      this.itemForm.safeInventoryLevel = item.safeInventoryLevel || 0;
      this.itemForm.hospitalCode = item.hospitalCode || '';
      this.itemForm.brand = item.brand || '';
      this.itemForm.vendorPhone = item.vendorPhone || '';
    } else {
      this.editingItem.set(null);
      this.itemForm.category = '';
      this.itemForm.name = '';
      this.itemForm.unitsPerBox = null;
      this.itemForm.safeInventoryLevel = 0;
      this.itemForm.hospitalCode = '';
      this.itemForm.brand = '';
      this.itemForm.vendorPhone = '';
    }
    this.showItemModal.set(true);
  }

  closeItemModal(): void {
    this.showItemModal.set(false);
    this.editingItem.set(null);
  }

  async saveInventoryItem(): Promise<void> {
    if (!this.isItemFormValid) return;

    try {
      const currentUser = this.authService.currentUser();
      const data: any = {
        category: this.itemForm.category,
        name: this.itemForm.name,
        unitsPerBox: this.itemForm.unitsPerBox || null,
        safeInventoryLevel: this.itemForm.safeInventoryLevel || 0,
        hospitalCode: this.itemForm.hospitalCode || null,
        brand: this.itemForm.brand || null,
        vendorPhone: this.itemForm.vendorPhone || null,
        updatedAt: new Date().toISOString(),
        updatedBy: currentUser?.name || '未知',
      };

      const editing = this.editingItem();
      if (editing) {
        await this.inventoryItemsApi.update(editing.id, data);
      } else {
        data.createdAt = new Date().toISOString();
        data.createdBy = currentUser?.name || '未知';
        await this.inventoryItemsApi.create(data);
      }

      if (!this.knownItems[this.itemForm.category].includes(this.itemForm.name)) {
        this.knownItems[this.itemForm.category].push(this.itemForm.name);
      }

      this.closeItemModal();
      await this.fetchInventoryItems();
      this.showAlert('操作成功', editing ? '更新成功' : '新增成功');
    } catch (error: any) {
      console.error('儲存品項失敗:', error);
      this.showAlert('儲存失敗', error.message);
    }
  }

  async deleteInventoryItem(id: string): Promise<void> {
    if (!confirm('確定要刪除此品項嗎？此操作不會影響已有的進貨和消耗紀錄。')) return;

    try {
      await this.inventoryItemsApi.delete(id);
      await this.fetchInventoryItems();
      this.showAlert('操作成功', '刪除成功');
    } catch (error: any) {
      console.error('刪除品項失敗:', error);
      this.showAlert('刪除失敗', error.message);
    }
  }

  /** 品項設定：移除一筆消耗紀錄別名（之後上傳同名品項會再次詢問） */
  async deleteItemAlias(item: any, alias: { id: string; alias: string }): Promise<void> {
    if (!confirm(`確定移除別名「${alias.alias}」→「${item.name}」？之後上傳此品名會再次要求確認。`)) return;
    try {
      const res = await fetch(`${this.firebaseService.apiBaseUrl}/system/inventory/aliases/${encodeURIComponent(alias.id)}`, {
        method: 'DELETE',
        headers: this.firebaseService.getHeaders(),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || `HTTP ${res.status}`);
      await this.fetchInventoryItems();
    } catch (error: any) {
      console.error('刪除別名失敗:', error);
      this.showAlert('刪除失敗', error.message);
    }
  }

  private async initializeDefaultItems(): Promise<void> {
    try {
      const existingItems = await this.inventoryItemsApi.fetchAll();
      if (existingItems.length > 0) {
        console.log('品項已存在，跳過初始化');
        return;
      }

      console.log('初始化預設品項...');
      const batch: Promise<any>[] = [];

      for (const [category, items] of Object.entries(DEFAULT_ITEMS)) {
        for (const itemName of items) {
          batch.push(
            this.inventoryItemsApi.create({
              category,
              name: itemName,
              unitsPerBox: null,
              safeInventoryLevel: 0,
              hospitalCode: null,
              vendorPhone: null,
              createdAt: new Date().toISOString(),
              createdBy: '系統預設',
              updatedAt: new Date().toISOString(),
              updatedBy: '系統預設',
            } as any)
          );
        }
      }

      await Promise.all(batch);
      console.log('預設品項初始化完成');
    } catch (error) {
      console.error('初始化預設品項失敗（可能是權限問題，將使用備援品項）:', error);
      for (const [category, items] of Object.entries(DEFAULT_ITEMS)) {
        items.forEach((itemName) => {
          if (!this.knownItems[category].includes(itemName)) {
            this.knownItems[category].push(itemName);
          }
        });
      }
    }
  }

  // ==================== 叫貨/到貨 ====================

  getUnitsPerBox(category: string, itemName: string): number {
    const item = this.inventoryItems().find(
      (i: any) => i.category === category && i.name === itemName
    );
    return item?.unitsPerBox || 1;
  }

  /** 全部叫貨/到貨紀錄（行事曆、週/月面板都要看跨月資料，所以不做月份篩選） */
  async fetchPurchases(): Promise<void> {
    this.purchaseLoading.set(true);
    try {
      const allPurchases = (await this.purchasesApi.fetchAll()) as any[];
      // 已到貨看到貨日、待到貨看預計到貨日
      const keyDate = (p: any): string =>
        p.status === 'ordered' ? String(p.expectedDate || '') : typeof p.date === 'string' ? p.date : '';
      const results = [...allPurchases].sort((a: any, b: any) => keyDate(b).localeCompare(keyDate(a)));

      this.purchases.set(results);

      // knownItems 只併入「當月」出現過的品項（沿用改版前的月份範圍；全歷史會把停用品項都撈進盤點/訂購表）
      const thisMonth = this.stock.todayString().slice(0, 7);
      results.forEach((p: any) => {
        if (!keyDate(p).startsWith(thisMonth)) return;
        if (p.category && this.knownItems[p.category] && !this.knownItems[p.category].includes(p.item)) {
          this.knownItems[p.category].push(p.item);
        }
      });
    } catch (error) {
      console.error('載入進貨紀錄失敗:', error);
      this.showAlert('載入失敗', '載入進貨紀錄失敗');
    } finally {
      this.purchaseLoading.set(false);
    }
  }

  // ==================== Dashboard ====================

  /**
   * 庫存總覽：以「最近一次盤點」為基準推估「今日消耗前」的庫存。
   * 推估庫存 = 盤點量 + 盤點後到貨（含今天已到貨）− 盤點後消耗（算到昨天；實際優先、缺的日子排程推估）。
   * 安全庫存 = ceil(上一個完整週消耗 / 7 × 9 天)，若品項有手動安全量則取兩者較大。
   * 今日消耗另以排程推估，餘 = 推估庫存 − 今日預估消耗（今天只扣一次，不重複）。
   * 狀態：餘 < 0 今日不足 → 餘 < 日均×2 撐不到 2 天 → 餘 < 安全庫存 低於安全量 → 充足。
   * （今日/明日預估消耗卡已移至作業行事曆的日面板；今日推估仍保留，因為 4 階狀態靠它。）
   */
  async loadDashboard(): Promise<void> {
    this.dashboardLoading.set(true);
    this.dashboardLoaded.set(false);
    try {
      const todayStr = this.stock.todayString();

      // 1. 最近一次盤點（今天或之前）；後端 /counts/latest，404 → null
      const lastCountDoc = (await this.countsApi.fetchById('latest')) as CountDoc | null;
      const countDate = lastCountDoc?.countDate || '';
      this.dashboardHasCount.set(!!countDate);
      this.dashboardLastCountDate.set(countDate);
      this.dashboardCountAgeDays.set(
        countDate ? Math.max(0, this.stock.daysInclusive(countDate, todayStr) - 1) : 0,
      );

      // 2. 推估庫存（盤點 + 到貨 − 消耗）：消耗算到昨天，到貨含今天
      const allPurchases = (await this.purchasesApi.fetchAll()) as any[];
      const yesterdayStr = this.stock.addDays(todayStr, -1);
      const estimate = await this.stock.estimateStock(lastCountDoc, yesterdayStr, allPurchases);
      const todayArrivals = countDate ? this.stock.arrivedBetween(allPurchases, todayStr, todayStr) : this.stock.emptyGrouped();
      const pendingArrivals = this.stock.pendingArrivals(allPurchases);

      // 3. 手動安全量（品項設定）
      if (this.inventoryItems().length === 0) {
        await this.fetchInventoryItems();
      }
      const safetyMap = new Map<string, number>();
      for (const item of this.inventoryItems()) {
        safetyMap.set(`${item.category}:${item.name}`, item.safeInventoryLevel || 0);
      }

      // 4. 上一個完整週（週一~週日）消耗 → 日均
      const lastWeekMonday = this.stock.lastCompleteWeekMonday(todayStr);
      const lastWeek = await this.stock.weeklyConsumption(lastWeekMonday);
      this.dashboardConsumptionNote.set(
        `日均依 ${lastWeekMonday} ~ ${this.stock.addDays(lastWeekMonday, 6)} 消耗計算（${this.stock.daysLabel(lastWeek.actualDays, lastWeek.estimatedDays)}）`,
      );

      // 5. 今日預估消耗（排程推算）：只用於「餘」與狀態判定，不再另外出卡片
      let todayForecastData: Record<string, Record<string, number>> = {};
      try {
        const todayResult = await this.consumptionEngine.calculateTheoreticalConsumption(todayStr, todayStr);
        todayForecastData = todayResult.grouped;
      } catch (e) {
        console.warn('今日預估消耗載入失敗:', e);
      }

      // 沒有盤點基準就不要顯示一堆 0，讓畫面提示先去盤點
      if (!countDate) {
        this.dashboardItems.set([]);
        this.dashboardLoaded.set(true);
        return;
      }

      // 6. 合併所有品項
      const itemsByCategory = this.stock.collectItems([
        estimate.stock,
        estimate.arrivals,
        estimate.consumption,
        todayArrivals,
        lastWeek.grouped,
      ]);
      // 品名本身可能含冒號（如 HI:23），不能把 `${cat}:${item}` 組成字串再 split 回來（曾把 HI:23 截成 HI）
      const allEntries: { category: string; itemName: string; key: string }[] = [];
      for (const cat of Object.keys(CATEGORY_NAMES)) {
        for (const item of itemsByCategory[cat] || []) {
          allEntries.push({ category: cat, itemName: item, key: `${cat}:${item}` });
        }
      }

      // 7. 每品項推估庫存 + 4 階狀態
      const dashItems: ReturnType<typeof this.dashboardItems> = [];
      allEntries.forEach(({ category, itemName, key }) => {
        // 今日消耗前的庫存 = 推估（消耗到昨天）+ 今天已到貨
        const estimatedStock =
          this.stock.value(estimate.stock, category, itemName) +
          this.stock.value(todayArrivals, category, itemName);

        // 上週消耗 → 日均用量 → 自動安全庫存（9 天）
        const weeklyUsage = this.stock.value(lastWeek.grouped, category, itemName);
        const dailyUsage = weeklyUsage > 0 ? +this.stock.dailyAverage(weeklyUsage).toFixed(1) : 0;
        const manualSafeLevel = safetyMap.get(key) || 0;
        const autoSafeLevel = this.stock.safetyStock(weeklyUsage);
        const safeLevel = Math.max(autoSafeLevel, manualSafeLevel);

        // 今日預估消耗（只在這裡扣一次）
        const todayConsumption = todayForecastData[category]?.[itemName] || 0;
        const remainingAfterToday = estimatedStock - todayConsumption;
        const pending = this.stock.value(pendingArrivals, category, itemName);

        // 4 階狀態：與每週訂單的「安全庫存 = 日均 × 9 天」同一把尺
        let status: 'safe' | 'warning' | 'danger' | 'critical' = 'safe';
        let statusLabel = '充足';
        if (remainingAfterToday < 0) {
          status = 'critical';
          statusLabel = '今日不足';
        } else if (dailyUsage > 0 && remainingAfterToday < dailyUsage * 2) {
          status = 'danger';
          statusLabel = '撐不到 2 天';
        } else if (safeLevel > 0 && remainingAfterToday < safeLevel) {
          status = 'warning';
          statusLabel = '低於安全量';
        }
        if (status !== 'safe' && pending > 0) statusLabel += '（已叫貨）';

        dashItems.push({ category, itemName, estimatedStock, safeLevel, autoSafeLevel, dailyUsage, todayConsumption, remainingAfterToday, pending, status, statusLabel });
      });

      const statusOrder: Record<string, number> = { critical: 0, danger: 1, warning: 2, safe: 3 };
      dashItems.sort(
        (a, b) => statusOrder[a.status] - statusOrder[b.status] || a.itemName.localeCompare(b.itemName, 'zh-Hant'),
      );

      this.dashboardItems.set(dashItems);
      this.dashboardLoaded.set(true);

    } catch (error: any) {
      console.error('Dashboard 載入失敗:', error);
    } finally {
      this.dashboardLoading.set(false);
    }
  }

  getDashboardItemsByCategory(category: string) {
    return this.dashboardItems().filter((i) => i.category === category);
  }

  showAlert(title: string, message: string): void {
    this.alertDialogTitle.set(title);
    this.alertDialogMessage.set(message);
    this.isAlertDialogVisible.set(true);
  }

  // ==================== Utility ====================

  private async loadKnownItems(): Promise<void> {
    try {
      const allReports = await this.consumablesReportsApi.fetchAll();
      // Sort by createdAt desc and take first 50
      const sorted = (allReports as any[]).sort((a: any, b: any) => {
        const aDate = typeof a.createdAt === 'string' ? a.createdAt : '';
        const bDate = typeof b.createdAt === 'string' ? b.createdAt : '';
        return bDate.localeCompare(aDate);
      });

      sorted.slice(0, 50).forEach((report: any) => {
        const data = report.data || {};

        for (const category of Object.keys(this.knownItems)) {
          if (data[category] && Array.isArray(data[category])) {
            data[category].forEach((item: any) => {
              if (!this.knownItems[category].includes(item.item)) {
                this.knownItems[category].push(item.item);
              }
            });
          }
        }
      });

      // 併入「品項設定」裡登記的品項，確保盤點頁一定有格子可填
      for (const item of this.inventoryItems()) {
        const list = this.knownItems[item.category];
        if (list && item.name && !list.includes(item.name)) list.push(item.name);
      }

      for (const category of Object.keys(this.knownItems)) {
        this.knownItems[category].sort();
      }
    } catch (error) {
      console.error('載入已知品項失敗:', error);
    }
  }

  onModalOverlayClick(event: MouseEvent, modal: 'item' | 'machineConfig'): void {
    if (event.target === event.currentTarget) {
      if (modal === 'machineConfig') this.closeMachineConfigModal();
      else this.closeItemModal();
    }
  }
}
