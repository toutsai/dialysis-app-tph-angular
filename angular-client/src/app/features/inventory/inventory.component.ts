import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiConfigService } from '@services/api-config.service';
import { ApiService } from '@services/api.service';
import { AuthService } from '@services/auth.service';
import { PatientStoreService } from '@services/patient-store.service';
import { ConsumptionEngineService, type ConsumptionResult } from '@services/consumption-engine.service';
import { AlertDialogComponent } from '@app/components/dialogs/alert-dialog/alert-dialog.component';
import {
  ConsumableItemMappingDialogComponent,
  type ConsumableItemMappingRequest,
  type ConsumableItemMappings,
} from '@app/components/dialogs/consumable-item-mapping-dialog/consumable-item-mapping-dialog.component';
import { ClerkPhysicianPrintComponent } from './clerk-physician-print.component';
import { ClerkRegistrationComponent } from './clerk-registration.component';
import { ClerkInjectionPrintComponent } from './clerk-injection-print.component';
import { ClerkGentamycinListComponent } from './clerk-gentamycin-list.component';
import { CatastrophicIllnessComponent } from '../catastrophic-illness/catastrophic-illness.component';
import { PurchaseCalendarComponent } from './purchase-calendar.component';
import {
  ApiManagerService,
  type ApiManager,
  type FirestoreRecord,
} from '@services/api-manager.service';
// Standalone 版：已移除 Firebase
import { queryWithInChunks } from '@/utils/firestoreUtils';
import {
  buildDynamicHeaders,
  buildPatientConsumptionRows,
  summarizeUploadedRanges,
  type ConsumableReport,
  type UploadedRangeSummary,
} from '@/utils/consumablesReport';
import { shiftDateLike, type DateStepKind } from '@/utils/dateStep';
import {
  InventoryStockService,
  type CountDoc,
  type Grouped,
} from './inventory-stock.service';

const CATEGORY_NAMES: Record<string, string> = {
  artificialKidney: '人工腎臟',
  dialysateCa: '透析藥水CA',
  bicarbonateType: 'B液種類',
};

/** 本地今日 YYYY-MM-DD（不可用 toISOString：UTC+8 在凌晨會退回前一天/上個月） */
function localToday(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** 本地當月 YYYY-MM */
function localMonth(): string {
  return localToday().slice(0, 7);
}

const SHIFT_MAP: Record<string, number> = { early: 0, noon: 1, late: 2 };
const SHIFT_INDEX_MAP: Record<number, string> = { 0: '早班', 1: '午班', 2: '晚班' };

const DEFAULT_ITEMS: Record<string, string[]> = {
  artificialKidney: ['15S', '17UX', '25H', '34', 'APS21S', 'BG1.8', 'CAT/2000', 'FX80', 'HI:23'],
  dialysateCa: ['2.5', '3.0', '3.5'],
  bicarbonateType: ['0_袋裝Bicarbonate 500mg', '1_瓶裝Bicarbonate 500mg', '2_Hemodialysis 5L B液'],
};

@Component({
  selector: 'app-inventory',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    AlertDialogComponent,
    ConsumableItemMappingDialogComponent,
    ClerkPhysicianPrintComponent,
    ClerkRegistrationComponent,
    ClerkInjectionPrintComponent,
    ClerkGentamycinListComponent,
    CatastrophicIllnessComponent,
    PurchaseCalendarComponent,
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
  private readonly api = inject(ApiService);
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

  activeTab = signal('dashboard');

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
  todayForecast = signal<Record<string, Record<string, number>>>({});
  tomorrowForecast = signal<Record<string, Record<string, number>>>({});
  forecastLoading = signal(false);

  // Alert dialog
  isAlertDialogVisible = signal(false);
  alertDialogTitle = signal('');
  alertDialogMessage = signal('');

  // ==================== Tab 0: 品項設定 ====================
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

  // ==================== Tab 0.5: 床位設定 ====================
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

  // ==================== Tab 1: 進貨紀錄 ====================
  purchases = signal<any[]>([]);
  purchaseLoading = signal(false);
  /** 叫貨/到貨紀錄：行事曆（預設）或列表 */
  purchaseView = signal<'calendar' | 'list'>('calendar');
  /** 給行事曆子元件用：每箱個數 */
  readonly unitsPerBoxFn = (category: string, item: string) => this.getUnitsPerBox(category, item);
  purchaseStatusText(p: any): string {
    if (p.status !== 'ordered') return '已到貨';
    const today = new Date();
    const t = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    return (p.expectedDate || '') < t ? '逾期未到' : '待到貨';
  }
  purchaseFilter = {
    month: localMonth(),
    category: '',
  };
  showPurchaseModal = signal(false);
  showPurchaseInlineAdd = signal(false);
  editingPurchase = signal<any>(null);
  purchaseForm = {
    date: '',
    category: '',
    item: '',
    boxQuantity: 1,
  };

  get isPurchaseFormValid(): boolean {
    return !!(
      this.purchaseForm.date &&
      this.purchaseForm.category &&
      this.purchaseForm.item &&
      this.purchaseForm.boxQuantity > 0
    );
  }

  // ==================== Tab 2: 消耗紀錄 ====================
  // 頁籤順序：資料上傳 → 病人耗材查詢 → 每月消耗量 → 排程推算消耗（2026-09-01 使用者指定），預設第一個
  consumptionSubTab = signal('upload');

  // -- Theoretical consumption (排程推算) --
  theoreticalLoading = signal(false);
  theoreticalResult = signal<ConsumptionResult | null>(null);
  theoreticalFilter = {
    startDate: localToday(),
    endDate: localToday(),
  };
  consumptionLoading = signal(false);
  consumptionSearchPerformed = signal(false);
  rawConsumptionData = signal<any[]>([]);
  processedConsumptionData = signal<any[]>([]);
  // 病人耗材查詢：以「該月有上傳紀錄的病人」為主體（含已刪除病人），頻率/班別 'all' 不篩
  groupSearchParams = {
    freq: 'all',
    shift: 'all',
    keyword: '',
    month: localMonth(),
  };
  /** 該月已上傳的區間 × 類別摘要 */
  uploadedRanges = signal<UploadedRangeSummary[]>([]);
  dynamicHeaders = signal<Record<string, string[]>>({
    artificialKidney: [],
    dialysateCa: [],
    bicarbonateType: [],
  });

  selectedFile = signal<File | null>(null);
  isUploading = signal(false);
  uploadResult = signal<any>(null);
  isDragOver = signal(false);
  /** 後端回 needsItemMapping（上傳品名對不上品項設定）→ 開對照確認視窗 */
  itemMappingRequest = signal<ConsumableItemMappingRequest | null>(null);

  summaryMonth = localMonth();
  summaryLoading = signal(false);
  summaryLoaded = signal(false);
  monthlySummaryData: Record<string, Record<string, number>> = {
    artificialKidney: {},
    dialysateCa: {},
    bicarbonateType: {},
  };

  get flattenedHeaders(): string[] {
    const h = this.dynamicHeaders();
    return [...h.artificialKidney, ...h.dialysateCa, ...h.bicarbonateType];
  }

  /**
   * 月份/日期/週次輸入欄旁的「‹ ›」導航：把 target[key] 位移 delta 個單位。
   * 用法：(click)="stepDate(purchaseFilter, 'month', -1, 'month')"
   */
  stepDate(target: Record<string, any>, key: string, delta: number, kind: DateStepKind): void {
    target[key] = shiftDateLike(String(target[key] || ''), delta, kind);
  }

  /** summaryMonth 是純字串屬性，另給一個方法 */
  stepSummaryMonth(delta: number): void {
    this.summaryMonth = shiftDateLike(this.summaryMonth, delta, 'month');
  }

  // ==================== Tab 3: 盤點（原「每月盤點」+「週二盤點」合併） ====================
  countsLoading = signal(false);
  countsSaving = signal(false);
  /** 盤點日 */
  countFilter: { date: string };
  countBoxes: Record<string, Record<string, number>> = {
    artificialKidney: {},
    dialysateCa: {},
    bicarbonateType: {},
  };
  countUnits: Record<string, Record<string, number>> = {
    artificialKidney: {},
    dialysateCa: {},
    bicarbonateType: {},
  };
  countNotes = '';
  /** 目前盤點日在後端是否已有文件（決定「刪除」鈕是否可用） */
  countDocExists = signal(false);
  countDocInfo = signal<{ createdBy: string; updatedBy: string; updatedAt: string } | null>(null);
  /** 盤點紀錄列表（最近 30 筆） */
  countRecords = signal<{ countDate: string; by: string; updatedAt: string }[]>([]);

  // -- 盤點頁的月報表 --
  countReportFilter: { month: string };
  countReportLoading = signal(false);
  countReportLoaded = signal(false);
  countReportBaseDate = signal('');
  /** 當月最後一次盤點日（用於「差異」欄位標題） */
  countReportLastCountDate = signal('');
  countReportNote = signal('');
  countReportRows = signal<{
    category: string;
    categoryName: string;
    item: string;
    opening: number | null;
    arrived: number;
    consumed: number;
    daysLabel: string;
    closing: number | null;
    counted: number | null;
    diff: number | null;
  }[]>([]);

  // ==================== Tab 4: 每週訂單 ====================
  weeklyLoading = signal(false);
  weeklyDataLoaded = signal(false);
  weeklyFilter: { countDate: string; week: string };
  weeklyCount: Record<string, Record<string, number>> = {
    artificialKidney: {},
    dialysateCa: {},
    bicarbonateType: {},
  };
  weeklyCountBoxes: Record<string, Record<string, number>> = {
    artificialKidney: {},
    dialysateCa: {},
    bicarbonateType: {},
  };
  /** 訂購建議表：載入時先算好（模板不做每格重算的 getter） */
  weeklyRows = signal<{
    category: string;
    categoryName: string;
    item: string;
    unitsPerBox: number;
    lastWeekConsumption: number;
    sourceLabel: string;
    dailyAvg: string;
    safetyStock: number;
    countUnits: number;
    arrivedSinceCount: number;
    consumedSinceCount: number;
    estimatedStock: number;
    pending: number;
    orderQuantity: number;
    orderBoxes: number;
  }[]>([]);
  weeklyConsumptionNote = signal('');
  weeklyStockNote = signal('');
  weeklyCountSavedInfo = signal<string>('');
  /**
   * 盤點量以外的推算結果（到貨/消耗/待到貨/上週消耗）。
   * 盤點量改動時只重跑加減，不重新打 API。
   */
  private weeklyLastWeekDays = { actual: 0, estimated: 0 };
  private weeklyCtx: {
    lastWeek: Grouped;
    arrivals: Grouped;
    consumption: Grouped;
    pending: Grouped;
  } | null = null;

  // Order preview modal
  showOrderPreview = signal(false);
  /** 確認匯出時同時把訂單建成行事曆叫貨（待到貨） */
  createCalendarOrdersOnExport = true;
  orderDate = '';
  orderPreviewDates: string[] = []; // 6 dates: Mon-Sat
  orderPreviewDayLabels: string[] = [];
  orderPreviewItems: { category: string; item: string; label: string; hospitalCode: string }[] = [];
  orderPreviewGrid: Record<string, number[]> = {}; // key = "category|item", value = [mon,tue,wed,thu,fri,sat]

  get hasOrderData(): boolean {
    return this.weeklyRows().some((r) => r.orderQuantity > 0);
  }

  knownItems: Record<string, string[]> = {
    artificialKidney: [],
    dialysateCa: [],
    bicarbonateType: [],
  };

  constructor() {
    const today = this.stock.todayString();
    this.countFilter = { date: today };
    this.countReportFilter = { month: today.slice(0, 7) };
    this.weeklyFilter = {
      countDate: this.getThisTuesday(),
      week: this.getISOWeek(new Date()),
    };
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
    // Auto-load dashboard since it's the default tab
    this.loadDashboard();
  }

  // ==================== Tab 0.5 Methods ====================

  // --- Machine Config CRUD ---

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
      this.closeMachineConfigModal();
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

  // --- Bed Settings ---

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

  // ==================== Tab 0 Methods ====================

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

  // ==================== Tab 1 Methods ====================

  getUnitsPerBox(category: string, itemName: string): number {
    const item = this.inventoryItems().find(
      (i: any) => i.category === category && i.name === itemName
    );
    return item?.unitsPerBox || 1;
  }

  calculateUnits(category: string, itemName: string, boxQty: number): number {
    return boxQty * this.getUnitsPerBox(category, itemName);
  }

  calculateBoxes(category: string, itemName: string, units: number): string | number {
    const unitsPerBox = this.getUnitsPerBox(category, itemName);
    if (unitsPerBox <= 1) return units;
    return (units / unitsPerBox).toFixed(1);
  }

  calculateBoxesRounded(category: string, itemName: string, units: number): number {
    const unitsPerBox = this.getUnitsPerBox(category, itemName);
    if (unitsPerBox <= 1) return units;
    return Math.round(units / unitsPerBox);
  }

  async fetchPurchases(): Promise<void> {
    this.purchaseLoading.set(true);
    try {
      const startDate = new Date(`${this.purchaseFilter.month}-01`);
      const endDate = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0, 23, 59, 59);
      const startDateStr = startDate.toISOString();
      const endDateStr = endDate.toISOString();

      const allPurchases = await this.purchasesApi.fetchAll();
      // 列表：已到貨看到貨日、待到貨看預計到貨日
      const keyDate = (p: any): string =>
        p.status === 'ordered' ? String(p.expectedDate || '') : typeof p.date === 'string' ? p.date : '';
      let results = (allPurchases as any[]).filter((p: any) => {
        const pDate = keyDate(p);
        return pDate >= startDateStr.substring(0, 10) && pDate <= endDateStr;
      }).sort((a: any, b: any) => keyDate(b).localeCompare(keyDate(a)));

      if (this.purchaseFilter.category) {
        results = results.filter((item: any) => item.category === this.purchaseFilter.category);
      }

      this.purchases.set(results);

      results.forEach((p: any) => {
        if (!this.knownItems[p.category].includes(p.item)) {
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

  openPurchaseModal(item: any = null): void {
    if (item) {
      this.editingPurchase.set(item);
      this.purchaseForm.date = this.formatDateTimeForInput(item.date);
      this.purchaseForm.category = item.category;
      this.purchaseForm.item = item.item;
      this.purchaseForm.boxQuantity = item.boxQuantity || 1;
    } else {
      this.editingPurchase.set(null);
      this.purchaseForm.date = this.getNowLocalDatetime();
      this.purchaseForm.category = '';
      this.purchaseForm.item = '';
      this.purchaseForm.boxQuantity = 1;
    }
    this.showPurchaseModal.set(true);
  }

  closePurchaseModal(): void {
    this.showPurchaseModal.set(false);
    this.editingPurchase.set(null);
  }

  async savePurchase(): Promise<void> {
    if (!this.isPurchaseFormValid) return;

    try {
      const currentUser = this.authService.currentUser();
      const unitsPerBox = this.getUnitsPerBox(this.purchaseForm.category, this.purchaseForm.item);
      const quantity = this.purchaseForm.boxQuantity * unitsPerBox;

      const data: any = {
        date: new Date(this.purchaseForm.date).toISOString(),
        category: this.purchaseForm.category,
        item: this.purchaseForm.item,
        boxQuantity: this.purchaseForm.boxQuantity,
        quantity,
        unitsPerBox,
        createdBy: currentUser?.name || '未知',
        updatedAt: new Date().toISOString(),
      };

      const editing = this.editingPurchase();
      if (editing) {
        await this.purchasesApi.update(editing.id, data);
      } else {
        data.createdAt = new Date().toISOString();
        await this.purchasesApi.create(data);
      }

      if (!this.knownItems[this.purchaseForm.category].includes(this.purchaseForm.item)) {
        this.knownItems[this.purchaseForm.category].push(this.purchaseForm.item);
      }

      this.closePurchaseModal();
      await this.fetchPurchases();
      this.showAlert('操作成功', editing ? '更新成功' : '新增成功');
    } catch (error: any) {
      console.error('儲存進貨紀錄失敗:', error);
      this.showAlert('儲存失敗', error.message);
    }
  }

  async deletePurchase(id: string): Promise<void> {
    if (!confirm('確定要刪除此筆進貨紀錄嗎？')) return;

    try {
      await this.purchasesApi.delete(id);
      await this.fetchPurchases();
      this.showAlert('操作成功', '刪除成功');
    } catch (error: any) {
      console.error('刪除進貨紀錄失敗:', error);
      this.showAlert('刪除失敗', error.message);
    }
  }

  async saveInlinePurchase(): Promise<void> {
    if (!this.isPurchaseFormValid) return;
    try {
      const currentUser = this.authService.currentUser();
      const unitsPerBox = this.getUnitsPerBox(this.purchaseForm.category, this.purchaseForm.item);
      const quantity = this.purchaseForm.boxQuantity * unitsPerBox;

      await this.purchasesApi.create({
        date: new Date(this.purchaseForm.date).toISOString(),
        category: this.purchaseForm.category,
        item: this.purchaseForm.item,
        boxQuantity: this.purchaseForm.boxQuantity,
        quantity,
        createdBy: currentUser?.name || '未知',
        createdAt: new Date().toISOString(),
      } as any);

      this.purchaseForm.category = '';
      this.purchaseForm.item = '';
      this.purchaseForm.boxQuantity = 1;
      this.showPurchaseInlineAdd.set(false);
      await this.fetchPurchases();
      this.showAlert('操作成功', '新增成功');
    } catch (error: any) {
      this.showAlert('儲存失敗', error.message);
    }
  }

  toggleInlineAdd(): void {
    this.showPurchaseInlineAdd.update((v) => !v);
    if (this.showPurchaseInlineAdd()) {
      this.purchaseForm.date = this.getNowLocalDatetime();
      this.purchaseForm.category = '';
      this.purchaseForm.item = '';
      this.purchaseForm.boxQuantity = 1;
    }
  }

  getItemSuggestions(category: string): string[] {
    return category ? this.knownItems[category] || [] : [];
  }

  // ==================== Tab 2 Methods ====================

  formatShift(shiftIndex: number): string {
    return SHIFT_INDEX_MAP[shiftIndex] ?? '-';
  }

  async handleConsumptionSearch(): Promise<void> {
    this.consumptionLoading.set(true);
    this.consumptionSearchPerformed.set(true);
    this.rawConsumptionData.set([]);
    this.processedConsumptionData.set([]);
    this.dynamicHeaders.set({ artificialKidney: [], dialysateCa: [], bicarbonateType: [] });
    this.uploadedRanges.set([]);

    try {
      const reportMonth = this.groupSearchParams.month;
      if (!reportMonth) {
        this.showAlert('提示', '請先選擇盤點月份。');
        return;
      }
      await this.patientStore.fetchPatientsIfNeeded();

      // 以該月報表為主體（後端 GET /orders/consumables 帶病人刪除狀態），不再從在籍病人清單出發
      const monthlyReports = (await this.consumablesReportsApi.fetchWhere({
        startDate: `${reportMonth}-01`,
        endDate: `${reportMonth}-31`,
      })) as unknown as ConsumableReport[];
      this.rawConsumptionData.set(monthlyReports);
      this.uploadedRanges.set(summarizeUploadedRanges(monthlyReports));

      const newDynamicHeaders = buildDynamicHeaders(monthlyReports);
      this.dynamicHeaders.set(newDynamicHeaders);
      for (const category of Object.keys(newDynamicHeaders) as (keyof typeof newDynamicHeaders)[]) {
        for (const item of newDynamicHeaders[category]) {
          if (!this.knownItems[category].includes(item)) {
            this.knownItems[category].push(item);
          }
        }
      }

      const processed = buildPatientConsumptionRows(
        monthlyReports,
        this.patientStore.patientMap(),
        {
          freq: this.groupSearchParams.freq,
          shift: this.groupSearchParams.shift,
          keyword: this.groupSearchParams.keyword,
        },
        this.flattenedHeaders,
      );

      this.processedConsumptionData.set(processed);
    } catch (error) {
      console.error('查詢耗材資料失敗:', error);
      this.showAlert('查詢失敗', '查詢耗材資料時發生錯誤');
    } finally {
      this.consumptionLoading.set(false);
    }
  }

  async exportConsumablesToExcel(): Promise<void> {
    const XLSX = await import('xlsx');
    const data = this.processedConsumptionData();
    if (!data || data.length === 0) {
      this.showAlert('提示', '沒有可匯出的資料。');
      return;
    }

    try {
      const { freq, shift, month } = this.groupSearchParams;
      const shiftNameMap: Record<string, string> = { early: '早班', noon: '午班', late: '晚班', all: '全部班別' };
      const shiftName = shiftNameMap[shift] || shift;
      const freqName = freq === 'all' ? '全部頻率' : freq === 'other' ? '其他頻率' : freq;
      const rangesText = this.uploadedRanges()
        .map((r) => `${r.label}(${r.categories.join('、')})`)
        .join('；');
      const title = `病人耗材總表: ${freqName} / ${shiftName} / ${month}${rangesText ? `　已上傳區間：${rangesText}` : ''}`;

      const FIXED_COLS = 6;
      const headerRow1: string[] = ['頻率', '班別', '床號', '病歷號', '姓名', '狀態'];
      const headerRow2: string[] = ['', '', '', '', '', ''];

      const dh = this.dynamicHeaders();
      for (const category in dh) {
        const items = dh[category];
        if (items && Array.isArray(items) && items.length > 0) {
          const categoryName = CATEGORY_NAMES[category];
          headerRow1.push(categoryName);
          for (let i = 1; i < items.length; i++) {
            headerRow1.push('');
          }
          items.forEach((item: string) => headerRow2.push(String(item || '')));
        }
      }

      const headers = this.flattenedHeaders;
      const dataRows = data.map((row: any) => {
        const dataRow: any[] = [
          row.freq || '-',
          this.formatShift(row.shiftIndex),
          row.bedNum || '',
          row.medicalRecordNumber || '',
          row.patientName || '',
          row.statusLabel || '',
        ];
        headers.forEach((header: string) => {
          const count = row.consumableCounts[header];
          dataRow.push(count !== undefined && count !== null ? count : '');
        });
        return dataRow;
      });

      const sheetData = [[title], [], headerRow1, headerRow2, ...dataRows];
      const ws = XLSX.utils.aoa_to_sheet(sheetData, { skipHidden: true } as any);

      ws['!merges'] = [];
      const totalColumnCount = headers.length + FIXED_COLS;
      ws['!merges'].push({ s: { r: 0, c: 0 }, e: { r: 0, c: totalColumnCount - 1 } });

      for (let i = 0; i < FIXED_COLS; i++) {
        ws['!merges'].push({ s: { r: 2, c: i }, e: { r: 3, c: i } });
      }

      let currentCol = FIXED_COLS;
      for (const category in dh) {
        const items = dh[category];
        if (items && Array.isArray(items) && items.length > 0) {
          ws['!merges'].push({
            s: { r: 2, c: currentCol },
            e: { r: 2, c: currentCol + items.length - 1 },
          });
          currentCol += items.length;
        }
      }

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '耗材總表');

      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([wbout], { type: 'application/octet-stream' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `病人耗材總表_${freqName}_${shiftName}_${month}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
    } catch (error) {
      console.error('匯出 Excel 失敗:', error);
      this.showAlert('匯出失敗', '匯出 Excel 時發生錯誤');
    }
  }

  onFileSelect(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      this.selectedFile.set(input.files[0]);
      this.uploadResult.set(null);
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(false);
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      this.selectedFile.set(files[0]);
      this.uploadResult.set(null);
    }
  }

  private toBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve((reader.result as string).replace(/^data:(.*,)?/, ''));
      reader.onerror = (error) => reject(error);
    });
  }

  async handleUpload(): Promise<void> {
    const file = this.selectedFile();
    if (!file) {
      this.showAlert('提示', '請先選擇一個檔案！');
      return;
    }
    await this.postConsumablesUpload(file);
  }

  /**
   * 送後端解析；品名對不上「品項設定」時後端回 needsItemMapping 且不寫入，
   * 這裡開對照確認視窗，使用者確認後帶 itemMappings 重送同一檔
   */
  private async postConsumablesUpload(file: File, itemMappings?: ConsumableItemMappings): Promise<void> {
    this.isUploading.set(true);
    this.uploadResult.set(null);
    this.itemMappingRequest.set(null);
    try {
      const fileContentBase64 = await this.toBase64(file);
      const res = await fetch(`${this.firebaseService.apiBaseUrl}/consumables/process`, {
        method: 'POST',
        headers: this.firebaseService.getHeaders(),
        body: JSON.stringify({
          fileName: file.name,
          fileContent: fileContentBase64,
          ...(itemMappings ? { itemMappings } : {}),
        }),
      });
      const resultData = await res.json();
      if (resultData?.needsItemMapping) {
        this.itemMappingRequest.set(resultData as ConsumableItemMappingRequest);
        return;
      }
      this.uploadResult.set(resultData);
      if (resultData?.success) {
        // 實際消耗區間變了，總覽/每週訂單的推估要重抓；確認視窗新增了品項則品項清單也要更新
        this.stock.invalidateActualRanges();
        if (resultData.itemMapping?.created?.length || resultData.itemMapping?.mapped?.length) {
          await this.fetchInventoryItems();
        }
      }
    } catch (error: any) {
      console.error('上傳處理失敗:', error);
      this.uploadResult.set({ message: `上傳失敗: ${error.message}`, errorCount: 1 });
    } finally {
      this.isUploading.set(false);
    }
  }

  async onItemMappingConfirm(mappings: ConsumableItemMappings): Promise<void> {
    const file = this.selectedFile();
    this.itemMappingRequest.set(null);
    if (!file) {
      this.showAlert('提示', '找不到原始檔案，請重新選擇檔案再上傳。');
      return;
    }
    await this.postConsumablesUpload(file, mappings);
  }

  onItemMappingCancel(): void {
    this.itemMappingRequest.set(null);
    this.uploadResult.set({
      message: '已取消上傳：品項對照未確認，未寫入任何資料。',
      errorCount: 0,
      cancelled: true,
    });
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

  async runTheoreticalConsumption(): Promise<void> {
    this.theoreticalLoading.set(true);
    this.theoreticalResult.set(null);
    try {
      const result = await this.consumptionEngine.calculateTheoreticalConsumption(
        this.theoreticalFilter.startDate,
        this.theoreticalFilter.endDate,
      );
      this.theoreticalResult.set(result);
    } catch (error: any) {
      console.error('理論消耗推算失敗:', error);
      this.showAlert('推算失敗', error.message);
    } finally {
      this.theoreticalLoading.set(false);
    }
  }

  // ==================== Dashboard ====================

  /**
   * 庫存總覽：以「最近一次盤點」為基準推估「今日消耗前」的庫存。
   * 推估庫存 = 盤點量 + 盤點後到貨（含今天已到貨）− 盤點後消耗（算到昨天；實際優先、缺的日子排程推估）。
   * 今日消耗另以排程推估顯示，餘 = 推估庫存 − 今日預估消耗（今天只扣一次，不重複）。
   * 安全庫存 = ceil(上一個完整週消耗 / 7 × 9 天)，若品項有手動安全量則取兩者較大。
   * 狀態：餘 < 0 今日不足 → 餘 < 日均×2 撐不到 2 天 → 餘 < 安全庫存 低於安全量 → 充足。
   */
  async loadDashboard(): Promise<void> {
    this.dashboardLoading.set(true);
    this.dashboardLoaded.set(false);
    this.forecastLoading.set(true);
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

      // 2. 推估庫存（盤點 + 到貨 − 消耗）：消耗算到昨天（今天的消耗在第 5 步另扣一次），到貨含今天
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

      // 5. 今/明日預估消耗（排程推算）
      let todayForecastData: Record<string, Record<string, number>> = {};
      try {
        const todayResult = await this.consumptionEngine.calculateTheoreticalConsumption(todayStr, todayStr);
        todayForecastData = todayResult.grouped;
        this.todayForecast.set(todayForecastData);

        const tomorrowStr = this.stock.addDays(todayStr, 1);
        const tomorrowResult = await this.consumptionEngine.calculateTheoreticalConsumption(tomorrowStr, tomorrowStr);
        this.tomorrowForecast.set(tomorrowResult.grouped);
      } catch (e) {
        console.warn('今日預估消耗載入失敗:', e);
      }
      this.forecastLoading.set(false);

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

  isForecastEmpty(forecast: Record<string, Record<string, number>>): boolean {
    return Object.values(forecast).every((cat) => Object.keys(cat).length === 0);
  }

  getDashboardItemsByCategory(category: string) {
    return this.dashboardItems().filter((i) => i.category === category);
  }

  showAlert(title: string, message: string): void {
    this.alertDialogTitle.set(title);
    this.alertDialogMessage.set(message);
    this.isAlertDialogVisible.set(true);
  }

  async loadMonthlySummary(): Promise<void> {
    this.summaryLoading.set(true);
    this.summaryLoaded.set(false);

    for (const category of Object.keys(this.monthlySummaryData)) {
      this.monthlySummaryData[category] = {};
    }

    try {
      const consumption = await this.getMonthlyConsumption(this.summaryMonth);
      for (const category of Object.keys(this.monthlySummaryData)) {
        this.monthlySummaryData[category] = consumption[category] || {};
      }
      this.summaryLoaded.set(true);
    } catch (error: any) {
      console.error('載入當月總量失敗:', error);
      this.showAlert('載入失敗', error.message);
    } finally {
      this.summaryLoading.set(false);
    }
  }

  getCategoryTotal(category: string): number {
    const data = this.monthlySummaryData[category] || {};
    return Object.values(data).reduce((sum, count) => sum + (count || 0), 0);
  }

  async exportMonthlySummary(): Promise<void> {
    const XLSX = await import('xlsx');
    const rows: any[][] = [['類別', '品項', '每箱數量', '當月消耗(個)', '當月消耗(箱)']];

    for (const category of Object.keys(CATEGORY_NAMES)) {
      const items = this.monthlySummaryData[category] || {};
      for (const [item, count] of Object.entries(items)) {
        rows.push([
          CATEGORY_NAMES[category],
          item,
          this.getUnitsPerBox(category, item),
          count,
          this.calculateBoxes(category, item, count),
        ]);
      }
    }

    rows.push([]);
    rows.push(['類別小計', '', '', '', '']);
    for (const category of Object.keys(CATEGORY_NAMES)) {
      rows.push([CATEGORY_NAMES[category], '合計', '', this.getCategoryTotal(category), '']);
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '當月消耗總量');

    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/octet-stream' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `當月消耗總量_${this.summaryMonth}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  }

  getSummaryItemKeys(category: string): string[] {
    return Object.keys(this.monthlySummaryData[category] || {});
  }

  private async getMonthlyConsumption(month: string): Promise<Record<string, Record<string, number>>> {
    const result: Record<string, Record<string, number>> = {
      artificialKidney: {},
      dialysateCa: {},
      bicarbonateType: {},
    };

    try {
      const allReports = await this.consumablesReportsApi.fetchAll();
      const filteredReports = (allReports as any[]).filter((r: any) => r.reportMonth === month);

      filteredReports.forEach((report: any) => {
        const data = report.data || {};
        for (const category of Object.keys(result)) {
          if (data[category] && Array.isArray(data[category])) {
            data[category].forEach((item: any) => {
              result[category][item.item] = (result[category][item.item] || 0) + (item.count || 0);
            });
          }
        }
      });
    } catch (error) {
      console.error('取得月消耗資料失敗:', error);
    }

    return result;
  }

  // ==================== Tab 3: 盤點 ====================
  // 「每月盤點」與「週二盤點」已合併成單一概念：一天一份盤點文件（inventory_count_docs）。
  // 總覽 / 每週訂單 / 月報表都以「最近一次盤點」為基準自動推算。

  /** 把三類別的品項輸入格重設為 0（以 knownItems 為準） */
  private resetCountInputs(): void {
    for (const category of this.categoryKeys) {
      this.countBoxes[category] = {};
      this.countUnits[category] = {};
      for (const item of this.getItemsForCategory(category)) {
        this.countBoxes[category][item] = 0;
        this.countUnits[category][item] = 0;
      }
    }
  }

  /** 箱數 → 個數（unitsPerBox = 1 者箱數即個數） */
  syncCountUnits(): void {
    for (const category of this.categoryKeys) {
      for (const [item, boxes] of Object.entries(this.countBoxes[category] || {})) {
        this.countUnits[category][item] = (Number(boxes) || 0) * this.getUnitsPerBox(category, item);
      }
    }
  }

  /** 載入盤點日的文件；沒有就以全 0 起始 */
  async loadCountDoc(): Promise<void> {
    const date = this.countFilter.date;
    if (!date) return;
    this.countsLoading.set(true);
    this.countDocInfo.set(null);
    this.countDocExists.set(false);
    this.resetCountInputs();
    this.countNotes = '';

    try {
      const doc = (await this.countsApi.fetchById(date)) as CountDoc | null;
      if (doc) {
        this.countDocExists.set(true);
        this.countNotes = doc.notes || '';
        for (const category of this.categoryKeys) {
          const units = doc.counts?.[category] || {};
          const boxes = doc.countBoxes?.[category] || {};
          for (const [item, value] of Object.entries(units)) {
            this.countUnits[category][item] = Number(value) || 0;
          }
          for (const [item, value] of Object.entries(boxes)) {
            this.countBoxes[category][item] = Number(value) || 0;
          }
          // 舊資料沒存箱數 → 由個數回推
          for (const [item, value] of Object.entries(units)) {
            if (this.countBoxes[category][item] === undefined || this.countBoxes[category][item] === 0) {
              const unitsPerBox = this.getUnitsPerBox(category, item);
              const n = Number(value) || 0;
              if (boxes[item] === undefined && n > 0) {
                this.countBoxes[category][item] = unitsPerBox > 1 ? Math.round(n / unitsPerBox) : n;
              }
            }
          }
        }
        this.countDocInfo.set({
          createdBy: doc.createdBy?.name || '未知',
          updatedBy: doc.updatedBy?.name || doc.createdBy?.name || '未知',
          updatedAt: doc.updatedAt || doc.createdAt || '',
        });
      }
    } catch (error: any) {
      console.error('載入盤點紀錄失敗:', error);
      this.showAlert('載入失敗', error?.error?.message || error?.message || String(error));
    } finally {
      this.countsLoading.set(false);
    }
  }

  /** 儲存盤點（以盤點日為 key，upsert） */
  async saveCountDoc(): Promise<void> {
    const date = this.countFilter.date;
    if (!date) {
      this.showAlert('無法儲存', '請先選擇盤點日。');
      return;
    }
    this.syncCountUnits();
    this.countsSaving.set(true);
    try {
      const doc = (await this.countsApi.save(date, {
        counts: this.buildGroupedCopy(this.countUnits),
        countBoxes: this.buildGroupedCopy(this.countBoxes),
        notes: this.countNotes || '',
      } as any)) as CountDoc;

      this.countDocExists.set(true);
      this.countDocInfo.set({
        createdBy: doc?.createdBy?.name || '未知',
        updatedBy: doc?.updatedBy?.name || doc?.createdBy?.name || '未知',
        updatedAt: doc?.updatedAt || doc?.createdAt || '',
      });
      await this.loadCountRecords();
      this.showAlert('操作成功', `${date} 盤點已儲存`);
    } catch (error: any) {
      console.error('儲存盤點失敗:', error);
      this.showAlert('儲存失敗', error?.error?.message || error?.message || String(error));
    } finally {
      this.countsSaving.set(false);
    }
  }

  /** 刪除盤點日的文件 */
  async deleteCountDoc(): Promise<void> {
    const date = this.countFilter.date;
    if (!date || !this.countDocExists()) return;
    if (!confirm(`確定要刪除 ${date} 的盤點紀錄嗎？此動作無法復原。`)) return;

    try {
      await this.countsApi.delete(date);
      this.countDocExists.set(false);
      this.countDocInfo.set(null);
      this.resetCountInputs();
      this.countNotes = '';
      await this.loadCountRecords();
      this.showAlert('操作成功', `${date} 盤點紀錄已刪除`);
    } catch (error: any) {
      console.error('刪除盤點失敗:', error);
      this.showAlert('刪除失敗', error?.error?.message || error?.message || String(error));
    }
  }

  /** 盤點紀錄列表（最近 30 筆，新→舊） */
  async loadCountRecords(): Promise<void> {
    try {
      const list = (await this.countsApi.fetchAll()) as unknown as CountDoc[];
      this.countRecords.set(
        (list || []).slice(0, 30).map((d) => ({
          countDate: d.countDate,
          by: d.updatedBy?.name || d.createdBy?.name || '未知',
          updatedAt: d.updatedAt || d.createdAt || '',
        })),
      );
    } catch (error) {
      console.error('載入盤點紀錄列表失敗:', error);
      this.countRecords.set([]);
    }
  }

  /** 點列 → 載入該日盤點 */
  async selectCountRecord(countDate: string): Promise<void> {
    this.countFilter.date = countDate;
    await this.loadCountDoc();
  }

  /** 進入「盤點」頁籤 */
  async openCountsTab(): Promise<void> {
    this.activeTab.set('counts');
    await this.loadCountRecords();
    await this.loadCountDoc();
  }

  private buildGroupedCopy(src: Record<string, Record<string, number>>): Grouped {
    const out: Grouped = { artificialKidney: {}, dialysateCa: {}, bicarbonateType: {} };
    for (const category of this.categoryKeys) {
      for (const [item, value] of Object.entries(src[category] || {})) {
        out[category][item] = Number(value) || 0;
      }
    }
    return out;
  }

  /** 讀「某日或之前最近一次盤點」；404 → null */
  private async fetchLatestCountBefore(before: string): Promise<CountDoc | null> {
    try {
      const doc = await firstValueFrom(
        this.api.get<CountDoc>('/system/inventory/counts/latest', { before }),
      );
      return doc || null;
    } catch (error: any) {
      if (error?.status === 404) return null;
      console.warn('讀取最近盤點失敗:', error);
      return null;
    }
  }

  /**
   * 月報表：期初（以該月第一天之前最近一次盤點推估到月初）、當月到貨、當月消耗、
   * 期末推估，以及當月最後一次盤點量與差異。
   */
  async loadCountMonthReport(): Promise<void> {
    this.countReportLoading.set(true);
    this.countReportLoaded.set(false);
    this.countReportNote.set('');
    this.countReportRows.set([]);

    try {
      const { start, end } = this.stock.monthRange(this.countReportFilter.month);
      const purchases = (await this.purchasesApi.fetchAll()) as any[];

      // 期初基準：月初前一天（含）最近一次盤點
      const baseDoc = await this.fetchLatestCountBefore(this.stock.addDays(start, -1));
      this.countReportBaseDate.set(baseDoc?.countDate || '');

      const opening = baseDoc
        ? await this.stock.estimateStock(baseDoc, this.stock.addDays(start, -1), purchases)
        : null;
      if (!baseDoc) {
        this.countReportNote.set('該月月初之前沒有盤點紀錄，期初結存無法推算（顯示「—」）。請先補一筆盤點。');
      }

      const arrived = this.stock.arrivedBetween(purchases, start, end);
      const consumed = await this.stock.consumptionBetween(start, end);
      const daysLabel = this.stock.daysLabel(consumed.actualDays, consumed.estimatedDays);

      // 當月最後一次盤點
      const monthCounts = (await this.countsApi.fetchAll()) as unknown as CountDoc[];
      const lastCount = (monthCounts || []).find(
        (d) => d.countDate >= start && d.countDate <= end,
      ) || null;
      // 推估到「該盤點日開始前」的庫存，才能跟盤點量對比
      const estimateAtCount =
        lastCount && baseDoc
          ? await this.stock.estimateStock(baseDoc, this.stock.addDays(lastCount.countDate, -1), purchases)
          : null;

      const itemsByCategory = this.stock.collectItems([
        opening?.stock,
        arrived,
        consumed.grouped,
        lastCount ? this.stock.normalizeGrouped(lastCount.counts) : null,
      ]);

      const rows: ReturnType<typeof this.countReportRows> = [];
      for (const category of this.categoryKeys) {
        const items = new Set<string>([
          ...(itemsByCategory[category] || []),
          ...this.getItemsForCategory(category),
        ]);
        for (const item of [...items].sort()) {
          const open = opening ? this.stock.value(opening.stock, category, item) : null;
          const got = this.stock.value(arrived, category, item);
          const used = this.stock.value(consumed.grouped, category, item);
          const closing = open != null ? open + got - used : null;
          const counted = lastCount
            ? this.stock.value(this.stock.normalizeGrouped(lastCount.counts), category, item)
            : null;
          const estAtCount = estimateAtCount
            ? this.stock.value(estimateAtCount.stock, category, item)
            : null;
          if (open == null && got === 0 && used === 0 && counted == null) continue;
          rows.push({
            category,
            categoryName: CATEGORY_NAMES[category],
            item,
            opening: open,
            arrived: got,
            consumed: used,
            daysLabel,
            closing,
            counted,
            diff: counted != null && estAtCount != null ? counted - estAtCount : null,
          });
        }
      }

      this.countReportRows.set(rows);
      this.countReportLastCountDate.set(lastCount?.countDate || '');
      this.countReportLoaded.set(true);
    } catch (error: any) {
      console.error('盤點月報表計算失敗:', error);
      this.showAlert('計算失敗', error?.error?.message || error?.message || String(error));
    } finally {
      this.countReportLoading.set(false);
    }
  }

  // ==================== Tab 4 Methods ====================

  private getThisTuesday(): string {
    const today = new Date();
    const day = today.getDay();
    if (day === 2) return this.stock.toDateString(today);
    const tuesday = new Date(today);
    if (day > 2) {
      tuesday.setDate(today.getDate() - (day - 2));
    } else {
      tuesday.setDate(today.getDate() + (2 - day));
    }
    return this.stock.toDateString(tuesday);
  }

  private getISOWeek(date: Date): string {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const yearStart = new Date(d.getFullYear(), 0, 1);
    const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return `${d.getFullYear()}-W${String(weekNo).padStart(2, '0')}`;
  }

  getItemsForCategory(category: string): string[] {
    return this.knownItems[category] || [];
  }

  /** 箱數改動 → 換算個數並即時重算訂購建議（只做加減，不重打 API） */
  syncWeeklyCount(): void {
    for (const category of Object.keys(this.weeklyCountBoxes)) {
      for (const [item, boxes] of Object.entries(this.weeklyCountBoxes[category])) {
        const unitsPerBox = this.getUnitsPerBox(category, item);
        this.weeklyCount[category][item] = (Number(boxes) || 0) * unitsPerBox;
      }
    }
    this.recomputeWeeklyRows();
  }

  /**
   * 每週訂單：以「盤點日的盤點文件」為基準推算。
   * 上週 = 訂單週的前一週（週一~週日）；訂購量 = max(0, 安全庫存(9天) − 目前推估庫存 − 待到貨)。
   */
  async loadWeeklyData(): Promise<void> {
    this.weeklyLoading.set(true);
    this.weeklyDataLoaded.set(false);
    this.weeklyCountSavedInfo.set('');

    for (const category of Object.keys(this.weeklyCount)) {
      this.weeklyCount[category] = {};
      this.weeklyCountBoxes[category] = {};
    }

    try {
      const countDate = this.weeklyFilter.countDate;

      // 1. 載入盤點日的盤點文件（以「盤點日」為 key，與「盤點」頁籤同一份資料）
      const countDoc = countDate
        ? ((await this.countsApi.fetchById(countDate)) as CountDoc | null)
        : null;

      for (const category of Object.keys(this.weeklyCount)) {
        const units = countDoc?.counts?.[category] || {};
        const boxes = countDoc?.countBoxes?.[category] || {};
        for (const [item, value] of Object.entries(units)) {
          this.weeklyCount[category][item] = Number(value) || 0;
        }
        for (const [item, value] of Object.entries(boxes)) {
          this.weeklyCountBoxes[category][item] = Number(value) || 0;
        }
        // 舊資料沒存箱數 → 由個數回推
        for (const [item, value] of Object.entries(units)) {
          if (boxes[item] === undefined) {
            const unitsPerBox = this.getUnitsPerBox(category, item);
            const n = Number(value) || 0;
            this.weeklyCountBoxes[category][item] = unitsPerBox > 1 ? Math.round(n / unitsPerBox) : n;
          }
        }
      }
      if (countDoc) {
        const who = countDoc.updatedBy?.name || countDoc.createdBy?.name || '未知';
        this.weeklyCountSavedInfo.set(`已載入 ${countDate} 盤點（${who}，${countDoc.updatedAt || countDoc.createdAt || ''}）`);
      } else {
        this.weeklyCountSavedInfo.set(`${countDate} 尚無盤點紀錄，請輸入後按「儲存盤點」`);
      }

      // 2. 上週（訂單週的前一週，週一~週日）消耗 → 日均 → 安全庫存
      const { start: weekStart } = this.getWeekDateRange(this.weeklyFilter.week);
      const lastWeekMonday = this.stock.addDays(weekStart, -7);
      const lastWeek = await this.stock.weeklyConsumption(lastWeekMonday);
      this.weeklyLastWeekDays = { actual: lastWeek.actualDays, estimated: lastWeek.estimatedDays };
      this.weeklyConsumptionNote.set(
        `上週 ${lastWeekMonday} ~ ${this.stock.addDays(lastWeekMonday, 6)}（${this.stock.daysLabel(lastWeek.actualDays, lastWeek.estimatedDays)}）`,
      );

      // 3. 盤點後到貨 / 盤點後消耗 / 已叫貨待到貨
      const purchases = (await this.purchasesApi.fetchAll()) as any[];
      const today = this.stock.todayString();
      const asOf = today >= countDate ? today : countDate;
      const arrivals = countDate
        ? this.stock.arrivedBetween(purchases, countDate, asOf)
        : this.stock.emptyGrouped();
      const sinceCount = countDate
        ? await this.stock.consumptionBetween(countDate, asOf)
        : { grouped: this.stock.emptyGrouped(), actualDays: 0, estimatedDays: 0 };
      const pending = this.stock.pendingArrivals(purchases);
      this.weeklyStockNote.set(
        countDate
          ? `推估庫存基準：${countDate} 盤點，加計 ${countDate} ~ ${asOf} 到貨、扣除同期消耗（${this.stock.daysLabel(sinceCount.actualDays, sinceCount.estimatedDays)}）`
          : '尚未選擇盤點日',
      );

      this.weeklyCtx = {
        lastWeek: lastWeek.grouped,
        arrivals,
        consumption: sinceCount.grouped,
        pending,
      };

      // 4. 補齊所有已知品項的輸入格
      for (const category of Object.keys(this.knownItems)) {
        for (const item of this.getItemsForCategory(category)) {
          if (this.weeklyCount[category][item] === undefined) this.weeklyCount[category][item] = 0;
          if (this.weeklyCountBoxes[category][item] === undefined) this.weeklyCountBoxes[category][item] = 0;
        }
      }

      this.recomputeWeeklyRows();
      this.weeklyDataLoaded.set(true);
    } catch (error: any) {
      console.error('載入週資料失敗:', error);
      this.showAlert('載入失敗', error?.error?.message || error?.message || String(error));
    } finally {
      this.weeklyLoading.set(false);
    }
  }

  /** 只做加減的重算（盤點量改動時呼叫），推估用的到貨/消耗來自 weeklyCtx 快取 */
  private recomputeWeeklyRows(): void {
    const ctx = this.weeklyCtx;
    if (!ctx) {
      this.weeklyRows.set([]);
      return;
    }
    const rows: ReturnType<typeof this.weeklyRows> = [];
    for (const category of this.categoryKeys) {
      const items = new Set<string>([
        ...this.getItemsForCategory(category),
        ...Object.keys(ctx.lastWeek[category] || {}),
        ...Object.keys(this.weeklyCount[category] || {}),
      ]);
      for (const item of [...items].sort()) {
        const lastWeekConsumption = this.stock.value(ctx.lastWeek, category, item);
        const safetyStock = this.stock.safetyStock(lastWeekConsumption);
        const countUnits = Number(this.weeklyCount[category]?.[item]) || 0;
        const arrivedSinceCount = this.stock.value(ctx.arrivals, category, item);
        const consumedSinceCount = this.stock.value(ctx.consumption, category, item);
        const estimatedStock = countUnits + arrivedSinceCount - consumedSinceCount;
        const pending = this.stock.value(ctx.pending, category, item);
        const orderQuantity = this.stock.orderQuantity(safetyStock, estimatedStock, pending);
        rows.push({
          category,
          categoryName: CATEGORY_NAMES[category],
          item,
          unitsPerBox: this.getUnitsPerBox(category, item),
          lastWeekConsumption,
          sourceLabel: this.weeklyConsumptionSource(),
          dailyAvg: this.stock.dailyAverage(lastWeekConsumption).toFixed(1),
          safetyStock,
          countUnits,
          arrivedSinceCount,
          consumedSinceCount,
          estimatedStock,
          pending,
          orderQuantity,
          orderBoxes: this.calculateBoxesRounded(category, item, orderQuantity),
        });
      }
    }
    this.weeklyRows.set(rows);
  }

  /** 上週消耗的資料來源（實際/推估/混合） */
  private weeklyConsumptionSource(): string {
    return this.stock.sourceLabel(this.weeklyLastWeekDays.actual, this.weeklyLastWeekDays.estimated);
  }

  /**
   * Convert ISO week string (e.g. "2026-W12") to start/end date strings.
   */
  private getWeekDateRange(isoWeek: string): { start: string; end: string } {
    const [yearStr, weekStr] = isoWeek.split('-W');
    const year = parseInt(yearStr, 10);
    const week = parseInt(weekStr, 10);

    // ISO 8601: Week 1 contains Jan 4th. Monday is day 1.
    const jan4 = new Date(year, 0, 4);
    const dayOfWeek = jan4.getDay() || 7; // Mon=1..Sun=7
    const monday = new Date(jan4);
    monday.setDate(jan4.getDate() - dayOfWeek + 1 + (week - 1) * 7);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const pad = (n: number) => String(n).padStart(2, '0');
    const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return { start: fmt(monday), end: fmt(sunday) };
  }

  /**
   * 儲存盤點：key = 盤點日（與「盤點」頁籤同一份文件），不是週次。
   * 舊版以 ISO 週次為 key 且打到已移除的舊路由，所以永遠存不進去。
   */
  async saveWeeklyCount(): Promise<void> {
    const countDate = this.weeklyFilter.countDate;
    if (!countDate) {
      this.showAlert('無法儲存', '請先選擇盤點日。');
      return;
    }
    this.syncWeeklyCount();

    try {
      const doc = (await this.countsApi.save(countDate, {
        counts: this.buildGroupedCopy(this.weeklyCount),
        countBoxes: this.buildGroupedCopy(this.weeklyCountBoxes),
        notes: `每週訂單 ${this.weeklyFilter.week}`,
      } as any)) as CountDoc;

      const who = doc?.updatedBy?.name || doc?.createdBy?.name || '未知';
      this.weeklyCountSavedInfo.set(`已儲存 ${countDate} 盤點（${who}，${doc?.updatedAt || ''}）`);
      this.recomputeWeeklyRows();
      this.showAlert('操作成功', `${countDate} 盤點已儲存`);
    } catch (error: any) {
      console.error('儲存盤點失敗:', error);
      this.showAlert('儲存失敗', error?.error?.message || error?.message || String(error));
    }
  }

  /** 訂購量 = max(0, 安全庫存(9天) − 目前推估庫存 − 已叫貨待到貨)；查已算好的 rows */
  getOrderQuantity(category: string, item: string): number {
    const row = this.weeklyRows().find((r) => r.category === category && r.item === item);
    return row ? row.orderQuantity : 0;
  }

  exportWeeklyOrder(): void {
    this.openOrderPreview();
  }

  openOrderPreview(): void {
    const pad = (n: number) => String(n).padStart(2, '0');
    const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const fmtLabel = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
    const dayNames = ['一', '二', '三', '四', '五', '六'];

    // Today as order date
    this.orderDate = fmt(new Date());

    // Next week = selected week + 7 days (order is for NEXT week)
    const { start: weekStart } = this.getWeekDateRange(this.weeklyFilter.week);
    const monday = new Date(weekStart);
    monday.setDate(monday.getDate() + 7);
    this.orderPreviewDates = [];
    this.orderPreviewDayLabels = [];
    for (let i = 0; i < 6; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      this.orderPreviewDates.push(fmt(d));
      this.orderPreviewDayLabels.push(`週${dayNames[i]}(${fmtLabel(d)})`);
    }

    // Only dialysateCa and bicarbonateType
    const orderCategories = ['dialysateCa', 'bicarbonateType'];
    this.orderPreviewItems = [];
    this.orderPreviewGrid = {};

    for (const category of orderCategories) {
      for (const item of this.getItemsForCategory(category)) {
        const orderQty = this.getOrderQuantity(category, item);
        if (orderQty <= 0) continue;

        const key = `${category}|${item}`;
        const label = `${CATEGORY_NAMES[category]} - ${item}`;
        const hospitalCode = this.getHospitalCode(category, item);
        this.orderPreviewItems.push({ category, item, label, hospitalCode });

        // Split order qty evenly between Mon(index 0) and Wed(index 2)
        const half1 = Math.ceil(orderQty / 2);
        const half2 = orderQty - half1;
        this.orderPreviewGrid[key] = [half1, 0, half2, 0, 0, 0];
      }
    }

    this.showOrderPreview.set(true);
  }

  async confirmExportOrder(): Promise<void> {
    const XLSX = await import('xlsx');
    const rows: any[][] = [];

    // Row 1: Order date
    rows.push(['訂購日期', this.orderDate]);
    // Row 2: Usage date range (simple)
    const firstDate = this.orderPreviewDates[0]?.replace(/^\d{4}-/, '').replace('-', '/');
    const lastDate = this.orderPreviewDates[5]?.replace(/^\d{4}-/, '').replace('-', '/');
    rows.push(['訂單使用日期', `${firstDate}-${lastDate}`]);
    // Row 3: Delivery days
    rows.push(['到貨日', '★', '', '★', '', '', '']);
    // Empty row
    rows.push([]);
    // Header row
    rows.push(['院內代碼', '品項', ...this.orderPreviewDayLabels]);

    // Data rows
    for (const entry of this.orderPreviewItems) {
      const key = `${entry.category}|${entry.item}`;
      const grid = this.orderPreviewGrid[key] || [0, 0, 0, 0, 0, 0];
      rows.push([entry.hospitalCode || '', entry.label, ...grid]);
    }

    // Signature rows
    rows.push([]);
    rows.push([]);
    const currentUser = this.authService.currentUser();
    rows.push([`製表人：${currentUser?.name || ''}`]);
    rows.push(['洗腎室護理長：']);

    const ws = XLSX.utils.aoa_to_sheet(rows);

    // Set column widths
    ws['!cols'] = [
      { wch: 14 },
      { wch: 30 },
      { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '訂單');

    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/octet-stream' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `每週訂單_${this.weeklyFilter.week}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);

    this.showOrderPreview.set(false);

    // 同步建成行事曆叫貨（每格 >0 的數量 → 一筆待到貨，預計到貨日 = 該欄日期）
    if (this.createCalendarOrdersOnExport) {
      const result = await this.createCalendarOrdersFromPreview();
      this.showAlert('匯出成功', `訂單已下載。${result}`);
    } else {
      this.showAlert('匯出成功', '訂單已下載');
    }
  }

  /**
   * 訂單預覽表 → 行事曆叫貨（inventory_purchases status=ordered，同一 batch）
   * 訂單數量是「個」，行事曆以整箱計：箱數 = 無條件進位(個數 / 每箱個數)，個數 = 箱數 × 每箱個數。
   * 同品項同預計到貨日已有待到貨時先確認，避免重複叫。
   */
  private async createCalendarOrdersFromPreview(): Promise<string> {
    const entries: any[] = [];
    for (const entry of this.orderPreviewItems) {
      const grid = this.orderPreviewGrid[`${entry.category}|${entry.item}`] || [];
      const unitsPerBox = this.getUnitsPerBox(entry.category, entry.item) || 1;
      grid.forEach((units: number, idx: number) => {
        const u = Number(units) || 0;
        if (u <= 0 || !this.orderPreviewDates[idx]) return;
        const boxQuantity = unitsPerBox > 1 ? Math.ceil(u / unitsPerBox) : u;
        entries.push({
          category: entry.category,
          item: entry.item,
          boxQuantity,
          quantity: boxQuantity * unitsPerBox,
          expectedDate: this.orderPreviewDates[idx],
          orderDate: this.orderDate,
          status: 'ordered',
          notes: `每週訂單 ${this.weeklyFilter.week}（訂單量 ${u} 個）`,
        });
      });
    }
    if (entries.length === 0) return '（訂單無數量，未建立行事曆叫貨）';

    try {
      const existing = (await this.purchasesApi.fetchAll()) as any[];
      const dup = entries.filter((e) =>
        existing.some((p) => p.status === 'ordered' && p.category === e.category && p.item === e.item && p.expectedDate === e.expectedDate),
      );
      if (dup.length > 0) {
        const sample = dup.slice(0, 3).map((d) => `${d.expectedDate} ${d.item}`).join('、');
        if (!confirm(`行事曆已有 ${dup.length} 筆同品項同到貨日的待到貨（如 ${sample}），仍要再建立 ${entries.length} 筆叫貨嗎？\n（取消 = 只匯出 Excel，不建立）`)) {
          return '（未建立行事曆叫貨）';
        }
      }
      const res: any = await firstValueFrom(this.api.post('/system/inventory/purchases/batch', { entries }));
      await this.fetchPurchases();
      return `已建立 ${res?.count ?? entries.length} 筆行事曆叫貨（待到貨），可到「叫貨/到貨紀錄」查看。`;
    } catch (error: any) {
      console.error('建立行事曆叫貨失敗:', error);
      return `但建立行事曆叫貨失敗：${error?.error?.message || error?.message || error}`;
    }
  }

  getOrderRowTotal(category: string, item: string): number {
    const grid = this.orderPreviewGrid[`${category}|${item}`] || [];
    return grid.reduce((sum: number, v: number) => sum + (v || 0), 0);
  }

  getHospitalCode(category: string, itemName: string): string {
    const items = this.inventoryItems();
    const found = items.find((i: any) => i.category === category && i.name === itemName);
    return found?.hospitalCode || '';
  }

  // ==================== Utility Methods ====================

  formatDate(timestamp: any): string {
    if (!timestamp) return '-';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString('zh-TW');
  }

  formatDateTime(timestamp: any): string {
    if (!timestamp) return '-';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString('zh-TW') + ' ' + date.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
  }

  private formatDateForInput(timestamp: any): string {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toISOString().slice(0, 10);
  }

  private formatDateTimeForInput(timestamp: any): string {
    if (!timestamp) return '';
    const d = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  private getNowLocalDatetime(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

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

  onModalOverlayClick(event: MouseEvent, modal: 'purchase' | 'item' | 'machineConfig'): void {
    if (event.target === event.currentTarget) {
      if (modal === 'purchase') this.closePurchaseModal();
      else if (modal === 'machineConfig') this.closeMachineConfigModal();
      else this.closeItemModal();
    }
  }
}
