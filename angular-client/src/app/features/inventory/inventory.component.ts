import { loadXlsx } from '@/utils/xlsxLoader';
import { Component, OnInit, ViewChild, HostListener, inject, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
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
import { InventoryItemDetailComponent } from './inventory-item-detail.component';
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
    InventoryItemDetailComponent,
  ],
  templateUrl: './inventory.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
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
  inventoryView = signal('overview');
  private readonly route = inject(ActivatedRoute);
  @ViewChild(PurchaseCalendarComponent) calendar?:PurchaseCalendarComponent;
  @ViewChild(CatastrophicIllnessComponent) applicationEditor?: CatastrophicIllnessComponent;
  calendarCategory = '';
  calendarDate = '';
  summarySources=signal<any[]>([]);
  showSourceInCalendar(source:any):void {this.calendarCategory=source.category;this.calendarItem='';this.calendarDate=source.startDate;this.navigateInventory('calendar');}
  calendarItem = '';
  selectedStockItem = signal<{category:string;item:string}|null>(null);
  itemDetail = signal<any>(null);
  itemDetailLoading = signal(false);
  itemDetailPurchases=signal<any[]>([]);
  private itemDetailRequest=0;
  completeCategory = false;
  confirmEmptyCategory = false;
  hisWorkDate = localToday();
  uploadHeader=signal('');
  uploadHeaderLoading=signal(false);
  uploadDatesReviewed=false;
  async inspectUploadFile(file:File):Promise<void>{this.uploadHeader.set('');this.uploadHeaderLoading.set(true);this.uploadDatesReviewed=false;this.completeCategory=false;this.confirmEmptyCategory=false;try{const XLSX=await loadXlsx();const wb=XLSX.read(await file.arrayBuffer(),{type:'array'});const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1}) as any[][];const headers=rows.slice(0,5).flat().map(String).filter(cell=>/起日|迄日/.test(cell));if(this.selectedFile()===file)this.uploadHeader.set(headers.join(' / ')||'找不到起迄日標頭，請確認 HIS 原始檔案。');}catch{this.uploadHeader.set('無法讀取來源日期，請重新選取有效 Excel 檔。');}finally{this.uploadHeaderLoading.set(false);}}
  countLoose: Record<string, Record<string, number|null>> = { artificialKidney:{}, dialysateCa:{}, bicarbonateType:{} };
  countCutoff = 'end-of-day';
  countType = 'weekly';
  countRevision = 0;
  private countOwnerDate = '';
  private countSnapshot = '';
  countDraftInfo=signal('');
  private draftKey(date=this.countOwnerDate):string {const user=this.authService.currentUser() as any;return 'inventory-count-draft:'+String(user?.id||user?.uid||user?.name||'anonymous')+':'+date;}
  saveCountDraft():void {if(!this.countOwnerDate||this.countsLoading()||this.countsSaving())return;try{sessionStorage.setItem(this.draftKey(),JSON.stringify({date:this.countOwnerDate,baseRevision:this.countRevision,boxes:this.countBoxes,loose:this.countLoose,notes:this.countNotes,cutoff:this.countCutoff,countType:this.countType,savedAt:new Date().toLocaleString()}));this.countDraftInfo.set('草稿已暫存在此使用者／日期；尚未變更庫存。');}catch{this.showAlert('草稿未儲存','瀏覽器儲存空間不可用，請先儲存實盤。');}}
  restoreCountDraft():void {try{const raw=sessionStorage.getItem(this.draftKey());if(!raw){this.countDraftInfo.set('此使用者／日期尚無草稿。');return;}const draft=JSON.parse(raw);if(draft.date!==this.countOwnerDate)return;const conflict=draft.baseRevision!==this.countRevision;this.countBoxes=draft.boxes;this.countLoose=draft.loose;this.countNotes=draft.notes;this.countCutoff=draft.cutoff;this.countType=draft.countType;this.countRevision=draft.baseRevision;this.syncCountUnits();this.countDraftInfo.set(conflict?'草稿與伺服器版本不同；保留原版本以阻止覆蓋。請核對並重新載入後再修改。':'已還原草稿（尚未儲存實盤）。');}catch{this.countDraftInfo.set('草稿無法讀取。');}}
  private inspectCountDraft():void {try{const raw=sessionStorage.getItem(this.draftKey());if(!raw){this.countDraftInfo.set('');return;}const draft=JSON.parse(raw);this.countDraftInfo.set(draft.baseRevision===this.countRevision?'此使用者／日期有草稿，可按「還原草稿」。':'有舊版本草稿；伺服器盤點已變更，還原後須核對衝突。');}catch{this.countDraftInfo.set('草稿無法讀取。');}}

  private countRequest = 0;
  orderRetryPayload:any[]|null=null;
  weeklyBlockedItems=signal<string[]>([]);
  orderCreating = signal(false);
  orderCreated = signal(false);
  private orderIdempotencyKey = '';
  private lastFocused: HTMLElement|null = null;
  unitLabel(category:string,item:string):string {
    return this.inventoryItems().find(i=>i.category===category && i.name===item)?.unit || '單位（未設定）';
  }
  private draftSnapshot():string { return JSON.stringify([this.countBoxes,this.countLoose,this.countNotes,this.countCutoff,this.countType]); }
  hasUnsavedChanges():boolean { return !!this.countOwnerDate && this.countSnapshot!==this.draftSnapshot(); }
  canLeave():boolean {
    if(this.applicationEditor && !this.applicationEditor.canLeave())return false;
    if(this.calendar && !this.calendar.canLeave())return false;
    if(this.countsSaving() || this.isUploading() || this.orderCreating()) { this.showAlert('作業進行中','請等待儲存或上傳完成。'); return false; }
    if(this.showOrderPreview()&&!this.orderCreated()&&!confirm('補貨安排尚未建立，確定離開？'))return false;
    if(this.hasUnsavedChanges()){if(!confirm('盤點尚未儲存，確定離開並捨棄變更？'))return false;this.countSnapshot=this.draftSnapshot();}return true;
  }
  @HostListener('window:beforeunload',['$event']) onBeforeUnload(event:BeforeUnloadEvent):void { if(this.hasUnsavedChanges() || this.countsSaving() || this.orderCreating() || this.isUploading()) {event.preventDefault();event.returnValue='';} }
  switchMain(tab:any):void { if(this.canLeave()) { this.mainTab.set(tab); if(tab==='inventory') this.loadDashboard(); } }
  navigateInventory(view:string,tab?:string):void {
    if(!this.canLeave()) return;
    this.inventoryView.set(view); this.activeTab.set(tab || ({overview:'dashboard',calendar:'purchase',reports:'consumption',settings:'items'} as any)[view]);
    if(view==='overview') this.loadDashboard();
    if(view==='reports') this.consumptionSubTab.set('query');
  }
  async openCountDate(date:string):Promise<void> { if(!this.canLeave()) return; this.countSnapshot=this.draftSnapshot();this.inventoryView.set('calendar');this.activeTab.set('counts');this.countFilter.date=date;await this.loadCountDoc();await this.loadCountRecords(); }
  openHisDate(date:string):void { if(!this.canLeave()) return;this.activeTab.set('consumption');this.inventoryView.set('calendar');this.consumptionSubTab.set('upload');this.hisWorkDate=date;this.theoreticalFilter.startDate=date;this.theoreticalFilter.endDate=date; }
  async openStockItem(category:string,item:string):Promise<void> {
    const request=++this.itemDetailRequest;this.lastFocused=document.activeElement as HTMLElement;this.selectedStockItem.set({category,item});this.itemDetailPurchases.set([]);this.itemDetail.set(null);this.itemDetailLoading.set(true);
    try { const docs=await this.countsApi.fetchAll() as unknown as CountDoc[]; const purchases=await this.purchasesApi.fetchAll();const today=this.stock.todayString();const detail=await this.stock.itemTimeline(category,item,today,this.stock.addDays(today,13),docs,purchases); if(request===this.itemDetailRequest&&this.selectedStockItem()?.category===category&&this.selectedStockItem()?.item===item){this.itemDetailPurchases.set(purchases as any[]);const start=detail.anchor?.cutoff==='end-of-day'?this.stock.addDays(detail.anchor.countDate,1):detail.anchor?.countDate||today;const receiptRows=(purchases as any[]).filter(p=>p.category===category&&p.item===item&&(!p.status||p.status==='arrived')&&String(p.date||'').slice(0,10)>=start&&String(p.date||'').slice(0,10)<=today);const ranges=(detail.actualRanges||[]).map(r=>({...r,itemQuantity:r.grouped?.[category]?.[item]??0,source:r.categoryCoverage?.[category]}));const covered=new Set(ranges.flatMap(r=>this.stock.enumerateDays(r.start,r.end)));const forecastDates=this.stock.enumerateDays(start,today).filter(d=>!covered.has(d));this.itemDetail.set({...detail,receipts:receiptRows,actualRanges:ranges,forecastDates,anchorQuantity:detail.anchor?.counts?.[category]?.[item]??null});} }
    catch(e:any){if(request===this.itemDetailRequest)this.showAlert('明細載入失敗',e?.message || String(e));}finally{if(request===this.itemDetailRequest)this.itemDetailLoading.set(false);}
  }
  closeStockItem():void {++this.itemDetailRequest;this.selectedStockItem.set(null);this.itemDetailPurchases.set([]);setTimeout(()=>this.lastFocused?.focus());}
  itemToCalendar():void {const item=this.selectedStockItem();if(!item)return;this.calendarCategory=item.category;this.calendarItem=item.item;this.calendarDate=this.stock.todayString();this.closeStockItem();this.navigateInventory('calendar');}



  // ==================== Dashboard ====================
  dashboardLoading = signal(false);
  dashboardLoaded = signal(false);
  dashboardItems = signal<{ category: string; itemName: string; estimatedStock: number|null; lastCountDate:string; firstDeficitDate:string|null; nextDelivery:any; safeLevel: number|null; autoSafeLevel: number|null; dailyUsage: number|null; todayConsumption: number|null; remainingAfterToday: number|null; pending: number; status: 'safe' | 'warning' | 'danger' | 'critical'; statusLabel: string }[]>([]);
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
  forecastWarnings=signal<string[]>([]);

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
    unit: '',
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
  readonly unitLabelFn=(category:string,item:string)=>this.unitLabel(category,item);
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
    consumed: number|null;
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
    firstDeficitDate:string|null;
    anchorDate:string;
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

  orderDate = '';
  orderPreviewDates: string[] = []; // 6 dates: Mon-Sat
  orderPreviewDayLabels: string[] = [];
  orderPreviewItems: { category: string; item: string; label: string; hospitalCode: string }[] = [];
  orderPreviewGrid: Record<string, number[]> = {}; // key = "category|item", value = [mon,tue,wed,thu,fri,sat]

  get hasOrderData(): boolean {
    return this.weeklyBlockedItems().length===0 && this.weeklyRows().some((r) => r.orderQuantity > 0);
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
    this.route.queryParamMap.subscribe(params=>{ if(params.get('section')==='inventory'){this.mainTab.set('inventory');const view=params.get('view')||'overview';this.inventoryView.set(view);this.activeTab.set(({overview:'dashboard',calendar:'purchase',reports:'consumption',settings:'items'} as any)[view]||'dashboard');this.consumptionSubTab.set(params.get('report')==='monthly'?'summary':'query');} });
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
      this.itemForm.unit=item.unit||'';
      this.itemForm.unitsPerBox = item.unitsPerBox || null;
      this.itemForm.safeInventoryLevel = item.safeInventoryLevel || 0;
      this.itemForm.hospitalCode = item.hospitalCode || '';
      this.itemForm.brand = item.brand || '';
      this.itemForm.vendorPhone = item.vendorPhone || '';
    } else {
      this.editingItem.set(null);
      this.itemForm.category = '';
      this.itemForm.name = '';
      this.itemForm.unit='';
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
        unit:this.itemForm.unit || null,
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
    const XLSX = await loadXlsx();
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
      this.selectedFile.set(input.files[0]);this.inspectUploadFile(input.files[0]);
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
      this.selectedFile.set(files[0]);this.inspectUploadFile(files[0]);
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
    if(!this.uploadDatesReviewed){this.showAlert('請核對來源日期','確認原始檔的起迄日後再上傳，行事曆作業日期不會改寫 HIS 來源日期。');return;}
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
          completeCategory:this.completeCategory,
          confirmEmptyCategory:this.completeCategory && this.confirmEmptyCategory,
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
      const grouped={...result.grouped};for(const category of result.unknownCategories||[])delete grouped[category];this.theoreticalResult.set({...result,grouped});
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
  async loadDashboard():Promise<void>{
    if(this.dashboardLoading())return;this.stock.invalidateActualRanges();this.dashboardLoading.set(true);this.forecastLoading.set(true);
    try{const today=this.stock.todayString();const docs=await this.countsApi.fetchAll() as unknown as CountDoc[];const purchases=await this.purchasesApi.fetchAll();const weekStart=this.stock.lastCompleteWeekMonday(today);const week=await this.stock.weeklyConsumption(weekStart);
      this.dashboardHasCount.set(docs.some(d=>d.countDate<=today));this.dashboardLastCountDate.set(docs.filter(d=>d.countDate<=today).map(d=>d.countDate).sort().pop()||'');this.dashboardConsumptionNote.set('安全量沿用上週用量與品項設定；'+(week.warnings||[]).join('；'));
      const [forecast,tomorrow]=await Promise.all([this.consumptionEngine.calculateTheoreticalConsumption(today,today),this.consumptionEngine.calculateTheoreticalConsumption(this.stock.addDays(today,1),this.stock.addDays(today,1))]);this.forecastWarnings.set([...(forecast.warnings||[]),...(tomorrow.warnings||[])]);const todayGroup={...forecast.grouped},tomorrowGroup={...tomorrow.grouped};for(const c of forecast.unknownCategories||[])delete todayGroup[c];for(const c of tomorrow.unknownCategories||[])delete tomorrowGroup[c];this.todayForecast.set(todayGroup);this.tomorrowForecast.set(tomorrowGroup);
      const rows:ReturnType<typeof this.dashboardItems>=[];
      for(const category of this.categoryKeys){for(const itemName of this.getItemsForCategory(category)){
        const timeline=await this.stock.itemTimeline(category,itemName,today,this.stock.addDays(today,9),docs,purchases);const usage=this.stock.value(week.grouped,category,itemName);const usageUnknown=!!week.warnings?.some(w=>w.startsWith(category)&&w.includes('數量未知'));const manualSafe=Number(this.inventoryItems().find(i=>i.category===category&&i.name===itemName)?.safeInventoryLevel)||0;const autoSafeLevel=usageUnknown?null:this.stock.safetyStock(usage);const safeLevel=autoSafeLevel===null?(manualSafe>0?manualSafe:null):Math.max(autoSafeLevel,manualSafe);const estimatedStock=timeline.current;const dailyUsage=usageUnknown?null:+this.stock.dailyAverage(usage).toFixed(1);const pending=this.stock.value(this.stock.pendingArrivals(purchases),category,itemName);
        const demandUnknown=!!forecast.unknownCategories?.includes(category)||timeline.days.some(day=>day.need===null||day.projectedBalance===null);
        let status:'safe'|'warning'|'danger'|'critical'='safe';
        let statusLabel='充足';
        if(estimatedStock!==null&&estimatedStock<0){status='critical';statusLabel='預計不足';}
        else if(timeline.firstDeficitDate){status='danger';statusLabel='預計 '+timeline.firstDeficitDate+' 不足';}
        else if(estimatedStock===null){status='warning';statusLabel='缺少實盤或來源';}
        else if(demandUnknown){status='warning';statusLabel='後續需求待核對';}
        else if(usageUnknown){status='warning';statusLabel='安全量來源待核對';}
        else if(dailyUsage!==null&&dailyUsage>0&&estimatedStock<dailyUsage*2){status='danger';statusLabel='預計不足 2 天';}
        else if(safeLevel!==null&&estimatedStock<safeLevel){status='warning';statusLabel='低於安全量';}
        rows.push({category,itemName,estimatedStock,lastCountDate:timeline.anchor?.countDate||'',firstDeficitDate:timeline.firstDeficitDate,nextDelivery:timeline.nextDelivery,safeLevel,autoSafeLevel,dailyUsage,todayConsumption:forecast.unknownCategories?.includes(category)?null:this.stock.value(forecast.grouped as Grouped,category,itemName),remainingAfterToday:estimatedStock,pending,status,statusLabel});
      }}this.dashboardItems.set(rows);this.dashboardLoaded.set(true);
    }catch(error:any){this.showAlert('庫存總覽載入失敗',error?.message||String(error));}finally{this.dashboardLoading.set(false);this.forecastLoading.set(false);}
  }

  isForecastEmpty(forecast:Record<string,Record<string,number>>):boolean {
    // A missing category means unknown data, not a zero-usage day.
    return this.categoryKeys.every(category=>forecast[category]!=null&&Object.values(forecast[category]).every(value=>Number.isFinite(value)&&value===0));
  }
  editMachineConfigInline(config:any):void {this.openMachineConfigModal(config);}
  cancelMachineConfigEdit():void {this.openMachineConfigModal();}

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
      const sources=await firstValueFrom(this.api.get<any[]>('/orders/consumables/coverage'));this.summarySources.set(sources.map(source=>({...source,startDate:String(source.startDate).replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'),endDate:String(source.endDate).replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3')})).filter(source=>source.endDate.startsWith(this.summaryMonth)));
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
    const XLSX = await loadXlsx();
    const rows: any[][] = [['歸檔月份',this.summaryMonth,'跨月區間不拆分；本表不是曆月實耗'],['來源區間',...this.summarySources().map(s=>s.startDate+'～'+s.endDate+' '+s.category)],['類別', '品項', '每箱數量', '來源合計（品項單位）', '來源合計(箱)']];

    for (const category of Object.keys(CATEGORY_NAMES)) {
      const items = this.monthlySummaryData[category] || {};
      for (const [item, count] of Object.entries(items)) {
        rows.push([
          CATEGORY_NAMES[category],
          item+'（'+this.unitLabel(category,item)+'）',
          this.getUnitsPerBox(category, item),
          count,
          this.calculateBoxes(category, item, count),
        ]);
      }
    }

    rows.push([]);
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '當月消耗總量');

    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/octet-stream' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `歸檔來源合計_${this.summaryMonth}.xlsx`;
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

  private resetCountInputs():void { for(const category of this.categoryKeys){this.countBoxes[category]={};this.countUnits[category]={};this.countLoose[category]={};} }
  syncCountUnits():void {
    for(const category of this.categoryKeys){this.countUnits[category]={};for(const item of new Set([...Object.keys(this.countBoxes[category]),...Object.keys(this.countLoose[category])])){
      const boxes=this.countBoxes[category][item];const loose=this.countLoose[category][item];
      if(boxes==null && loose==null)continue;
      this.countUnits[category][item]=Number(boxes||0)*this.getUnitsPerBox(category,item)+Number(loose||0);
    }}
  }
  markCountZero(category:string,item:string):void {this.countBoxes[category][item]=0;this.countLoose[category][item]=0;this.syncCountUnits();}
  async loadCountDoc():Promise<void> {
    const date=this.countFilter.date;if(!date)return;
    if(this.hasUnsavedChanges() && !confirm('盤點尚未儲存，確定切換日期並捨棄變更？')){this.countFilter.date=this.countOwnerDate;return;}
    const request=++this.countRequest;this.countsLoading.set(true);
    try {let missingRevision=0;const doc=await firstValueFrom(this.api.get<CountDoc>('/system/inventory/counts/'+date)).catch((error:any)=>{if(error.status===404){missingRevision=Number(error.error?.revision)||0;return null;}throw error;});if(request!==this.countRequest)return;
      this.resetCountInputs();this.countOwnerDate=date;this.countNotes=doc?.notes||'';this.countRevision=(doc as any)?.revision||missingRevision;this.countCutoff=(doc as any)?.cutoff||(doc?'start-of-day':'end-of-day');this.countType=(doc as any)?.countType||'weekly';this.countDocExists.set(!!doc);this.countDocInfo.set(null);
      if(doc){for(const category of this.categoryKeys){for(const [item,value] of Object.entries(doc.counts?.[category]||{})){const amount=Number(value),perBox=this.getUnitsPerBox(category,item);this.countUnits[category][item]=amount;this.countBoxes[category][item]=Math.floor(amount/perBox);this.countLoose[category][item]=+(amount%perBox).toFixed(6);}}
      this.countDocInfo.set({createdBy:doc.createdBy?.name||'未知',updatedBy:doc.updatedBy?.name||doc.createdBy?.name||'未知',updatedAt:doc.updatedAt||doc.createdAt||''});}
      this.countSnapshot=this.draftSnapshot();this.inspectCountDraft();
    }catch(error:any){this.showAlert('載入失敗',error?.error?.message||error?.message||String(error));this.countFilter.date=this.countOwnerDate;}finally{if(request===this.countRequest)this.countsLoading.set(false);}
  }
  async saveCountDoc():Promise<void> {
    const date=this.countFilter.date;if(this.countsSaving()||this.countsLoading())return;
    if(!date || date!==this.countOwnerDate){this.showAlert('請重新載入','日期已變更，請先載入該日盤點。');return;}
    this.syncCountUnits();const quantities=Object.values(this.countUnits).flatMap(Object.values);
    const inputs=[...Object.values(this.countBoxes),...Object.values(this.countLoose)].flatMap(Object.values).filter(v=>v!=null);
    if(!quantities.length||inputs.some(v=>!Number.isFinite(Number(v))||Number(v)<0)||quantities.some(v=>!Number.isFinite(v)||v<0)){this.showAlert('請檢查數量','至少填寫一項實盤數量；不可為負數。空白表示未盤點，零請明確輸入或按「確認零」。');return;}
    const savedSnapshot=this.draftSnapshot();const savedRevision=this.countRevision;
    this.countsSaving.set(true);
    try {const doc=await this.countsApi.save(date,{counts:this.buildGroupedCopy(this.countUnits),countBoxes:Object.fromEntries(this.categoryKeys.map(c=>[c,Object.fromEntries(Object.entries(this.countBoxes[c]).filter(([,v])=>v!=null))])),notes:this.countNotes,cutoff:this.countCutoff,countType:this.countType,expectedRevision:savedRevision} as any) as CountDoc;
      if(date!==this.countOwnerDate||date!==this.countFilter.date)return;
      this.countRevision=(doc as any).revision;this.countSnapshot=savedSnapshot;try{sessionStorage.removeItem(this.draftKey(date));}catch{/* A successful server save must remain successful if browser storage is unavailable. */}this.countDraftInfo.set('');this.countDocExists.set(true);this.countDocInfo.set({createdBy:doc.createdBy?.name||'未知',updatedBy:doc.updatedBy?.name||'未知',updatedAt:doc.updatedAt||''});await this.loadCountRecords();this.dashboardLoaded.set(false);this.weeklyDataLoaded.set(false);this.showAlert('已儲存',date+' 盤點已儲存，可使用同一份盤點計算補貨。');
    }catch(error:any){this.showAlert(error?.status===409?'盤點已被其他人更新':'儲存失敗',(error?.error?.message||error?.message||String(error))+'；您的輸入保留在畫面，請核對後重新載入。');}finally{this.countsSaving.set(false);}
  }

  /** 刪除盤點日的文件 */
  async deleteCountDoc():Promise<void>{
    const date=this.countFilter.date;if(!date||!this.countDocExists()||this.countsSaving()||this.countsLoading())return;
    if(!confirm('確定刪除 '+date+' 的盤點紀錄？'))return;
    const revision=this.countRevision;this.countsSaving.set(true);
    try{await firstValueFrom(this.api.delete('/system/inventory/counts/'+date,{expectedRevision:String(revision)}));if(date!==this.countOwnerDate)return;this.resetCountInputs();this.countNotes='';this.countDocExists.set(false);this.countDocInfo.set(null);this.countSnapshot=this.draftSnapshot();await this.loadCountDoc();await this.loadCountRecords();this.dashboardLoaded.set(false);this.weeklyDataLoaded.set(false);this.showAlert('已刪除',date+' 盤點已刪除，可重新填寫儲存。');}
    catch(error:any){this.showAlert('刪除失敗',error?.error?.message||error?.message||String(error));}finally{this.countsSaving.set(false);}
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
  async exportCountMonthReport():Promise<void>{if(!this.countReportLoaded())return;const XLSX=await loadXlsx();const rows:any[][]=[['月份',this.countReportFilter.month],['類別','品項','單位','期初推估','已到貨','耗用','來源','期末推估','最後實盤','盤點差異']];for(const row of this.countReportRows())rows.push([row.categoryName,row.item,this.unitLabel(row.category,row.item),row.opening??'待核對',row.arrived,row.consumed??'待核對',row.daysLabel,row.closing??'待核對',row.counted??'未盤',row.diff??'待核對']);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),'庫存月報');XLSX.writeFile(wb,'庫存月報_'+this.countReportFilter.month+'.xlsx');}
  async loadCountMonthReport():Promise<void>{
    this.countReportLoading.set(true);this.countReportLoaded.set(false);this.countReportRows.set([]);
    try{const {start,end}=this.stock.monthRange(this.countReportFilter.month);const docs=await this.countsApi.fetchAll() as unknown as CountDoc[];const purchases=await this.purchasesApi.fetchAll();const arrived=this.stock.arrivedBetween(purchases,start,end);const consumed=await this.stock.consumptionBetween(start,end);const rows:ReturnType<typeof this.countReportRows>=[];
      for(const category of this.categoryKeys){for(const item of this.getItemsForCategory(category)){
        const before=this.stock.addDays(start,-1);const opening=await this.stock.itemTimeline(category,item,before,before,docs,purchases);const closing=await this.stock.itemTimeline(category,item,end,end,docs,purchases);const latest=docs.filter(d=>d.countDate>=start&&d.countDate<=end&&d.counts?.[category]?.[item]!=null).sort((a,b)=>b.countDate.localeCompare(a.countDate))[0];
        let difference:number|null=null;const counted=latest?.counts[category][item]??null;
        if(latest){const at=latest.cutoff==='end-of-day'?latest.countDate:this.stock.addDays(latest.countDate,-1);const previous=await this.stock.itemTimeline(category,item,at,at,docs.filter(d=>d.countDate<latest.countDate),purchases);if(previous.current!==null)difference=counted!-previous.current;}
        const source=consumed.categorySources?.[category];rows.push({category,categoryName:CATEGORY_NAMES[category],item,opening:opening.current,arrived:this.stock.value(arrived,category,item),consumed:consumed.warnings?.some(w=>w.startsWith(category)&&w.includes('數量未知'))?null:this.stock.value(consumed.grouped,category,item),daysLabel:this.stock.daysLabel(source?.actualDays||0,source?.estimatedDays||0),closing:closing.current,counted,diff:difference});
      }}this.countReportRows.set(rows);this.countReportBaseDate.set('各品項最近實盤');this.countReportLastCountDate.set(docs.filter(d=>d.countDate>=start&&d.countDate<=end).map(d=>d.countDate).sort().pop()||'');this.countReportNote.set('各品項依自己的最近實盤截止時點計算；空白實盤不視為零。期末採用當月後續實盤重新校準，差異不自動轉成耗用。');this.countReportLoaded.set(true);
    }catch(error:any){this.showAlert('月報載入失敗',error?.message||String(error));}finally{this.countReportLoading.set(false);}
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
  async loadWeeklyData():Promise<void>{
    if(this.weeklyLoading())return;this.weeklyLoading.set(true);this.weeklyDataLoaded.set(false);this.weeklyRows.set([]);this.weeklyBlockedItems.set([]);
    try{const docs=await this.countsApi.fetchAll() as unknown as CountDoc[];const count=docs.find(d=>d.countDate===this.weeklyFilter.countDate);if(!count){this.weeklyCountSavedInfo.set('該日尚無實盤，請先開啟同一份盤點表儲存。');this.weeklyDataLoaded.set(true);return;}
      const purchases=await this.purchasesApi.fetchAll() as any[];const today=this.stock.todayString();if(count.countDate>today){this.weeklyCountSavedInfo.set('未來盤點不可作為目前現貨，請選已完成的盤點。');this.weeklyDataLoaded.set(true);return;}
      const {start:weekStart}=this.getWeekDateRange(this.weeklyFilter.week);const coverageEnd=this.stock.addDays(weekStart,12);const week=await this.stock.weeklyConsumption(this.stock.addDays(weekStart,-7));
      this.weeklyCountSavedInfo.set(count.countDate+' 已儲存 · '+(count.updatedBy?.name||count.createdBy?.name||'未知')+' · '+(count.cutoff==='end-of-day'?'收班後':'開班前'));
      this.weeklyStockNote.set('截至 '+today+' 收班推估；只抵扣明日到 '+coverageEnd+' 的預計到貨。逾期及更晚到貨不抵扣本次建議；不足日另列。');this.weeklyConsumptionNote.set('每週補貨安全庫存 = 上週日均 × 9 天（維持原規則）；總覽另外比較手動安全量。');
      const rows:ReturnType<typeof this.weeklyRows>=[];
      for(const category of this.categoryKeys){for(const item of this.getItemsForCategory(category)){
        const timeline=await this.stock.itemTimeline(category,item,today,coverageEnd,docs.filter(d=>d.countDate<=count.countDate),purchases);
        if(timeline.current===null){this.weeklyBlockedItems.update(items=>[...items,item+'：無有效現貨基準，補貨建議待核對']);continue;}
        const anchor=timeline.anchor!;const start=anchor.cutoff==='end-of-day'?this.stock.addDays(anchor.countDate,1):anchor.countDate;const consumption=await this.stock.consumptionBetween(start,today);const arrivals=this.stock.arrivedBetween(purchases,start,today);
        if(week.warnings?.some(w=>w.startsWith(category)&&w.includes('數量未知'))){this.weeklyBlockedItems.update(items=>[...items,item+'：上週需求未知，補貨建議待核對']);continue;}
        const lastWeekConsumption=this.stock.value(week.grouped,category,item);const safetyStock=this.stock.safetyStock(lastWeekConsumption);
        const pending=purchases.filter(p=>p.status==='ordered'&&p.category===category&&p.item===item&&p.expectedDate>today&&p.expectedDate<=coverageEnd).reduce((sum,p)=>sum+Number(p.quantity||0),0);const orderQuantity=this.stock.orderQuantity(safetyStock,timeline.current,pending);
        rows.push({category,categoryName:CATEGORY_NAMES[category],item,unitsPerBox:this.getUnitsPerBox(category,item),lastWeekConsumption,sourceLabel:this.stock.sourceLabel(week.categorySources?.[category]?.actualDays||0,week.categorySources?.[category]?.estimatedDays||0),dailyAvg:this.stock.dailyAverage(lastWeekConsumption).toFixed(1),safetyStock,countUnits:anchor.counts[category][item],arrivedSinceCount:this.stock.value(arrivals,category,item),consumedSinceCount:this.stock.value(consumption.grouped,category,item),estimatedStock:timeline.current,pending,orderQuantity,orderBoxes:this.calculateBoxesRounded(category,item,orderQuantity),firstDeficitDate:timeline.firstDeficitDate,anchorDate:anchor.countDate});
      }}this.weeklyRows.set(rows);this.weeklyDataLoaded.set(true);
    }catch(error:any){this.showAlert('補貨計算失敗',error?.message||String(error));}finally{this.weeklyLoading.set(false);}
  }
  private recomputeWeeklyRows():void { /* Saved counts are immutable in the replenishment view. */ }

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
  async saveWeeklyCount():Promise<void> {await this.openCountDate(this.weeklyFilter.countDate);}

  getOrderQuantity(category: string, item: string): number {
    const row = this.weeklyRows().find((r) => r.category === category && r.item === item);
    return row ? row.orderQuantity : 0;
  }

  exportWeeklyOrder(): void {
    this.openOrderPreview();
  }

  openOrderPreview(): void {
    if(this.orderRetryPayload){this.showOrderPreview.set(true);return;}
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
        const boxes=this.calculateBoxesRounded(category,item,orderQty);
        const half1 = Math.ceil(boxes / 2);
        const half2 = boxes - half1;
        this.orderPreviewGrid[key] = [half1, 0, half2, 0, 0, 0];
      }
    }

    this.orderIdempotencyKey=crypto.randomUUID();this.orderCreated.set(false);
    this.showOrderPreview.set(true);
  }

  async confirmExportOrder(): Promise<void> {
    if(this.orderCreating()||this.orderRetryPayload){this.showAlert('請先確認叫貨結果','上次建單結果尚未確認；重試使用原叫貨，確認後再匯出。');return;}
    if(!this.validOrderPreview())return;
    const XLSX = await loadXlsx();
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

    this.showAlert('匯出成功','訂單已下載，匯出不會建立叫貨。');
  }

  /**
   * 訂單預覽表 → 行事曆叫貨（inventory_purchases status=ordered，同一 batch）
   * 訂單數量是「個」，行事曆以整箱計：箱數 = 無條件進位(個數 / 每箱個數)，個數 = 箱數 × 每箱個數。
   * 同品項同預計到貨日已有待到貨時先確認，避免重複叫。
   */
  validOrderPreview():boolean {if(Object.values(this.orderPreviewGrid).flat().some(v=>!Number.isInteger(Number(v))||Number(v)<0)){this.showAlert('請檢查箱數','補貨安排須填零或正整數箱。');return false;}return true;}
  closeOrderPreview():void {if(this.orderCreating())return;if(!this.orderCreated()&&!confirm('補貨安排尚未建立，確定關閉？'))return;this.showOrderPreview.set(false);}
  async confirmCreateOrder():Promise<void> {if(this.orderCreating()||this.orderCreated()||!this.validOrderPreview())return;this.orderCreating.set(true);try{const result=await this.createCalendarOrdersFromPreview();this.showAlert('建立叫貨',result);}finally{this.orderCreating.set(false);}}
  private async createCalendarOrdersFromPreview(): Promise<string> {
    if(this.orderRetryPayload){return this.sendOrderPayload(this.orderRetryPayload);}
    const entries: any[] = [];
    for (const entry of this.orderPreviewItems) {
      const grid = this.orderPreviewGrid[`${entry.category}|${entry.item}`] || [];
      const unitsPerBox = this.getUnitsPerBox(entry.category, entry.item) || 1;
      grid.forEach((units: number, idx: number) => {
        const u = Number(units) || 0;
        if (u <= 0 || !this.orderPreviewDates[idx]) return;
        const boxQuantity = u;
        entries.push({
          category: entry.category,
          item: entry.item,
          boxQuantity,
          quantity: boxQuantity * unitsPerBox,
          expectedDate: this.orderPreviewDates[idx],
          orderDate: this.orderDate,
          status: 'ordered',
          notes: `每週訂單 ${this.weeklyFilter.week}（訂單量 ${u} 箱）`,
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
        return `已有相同品項及日期的叫貨（${sample}），本次未重複建立。請在行事曆核對或修改原單。`;
      }
      this.orderRetryPayload=JSON.parse(JSON.stringify(entries));return this.sendOrderPayload(this.orderRetryPayload!);
    } catch (error: any) {
      console.error('建立行事曆叫貨失敗:', error);
      return `但建立行事曆叫貨失敗：${error?.error?.message || error?.message || error}`;
    }
  }

  private async sendOrderPayload(entries:any[]):Promise<string>{try{const res:any=await firstValueFrom(this.api.post('/system/inventory/purchases/batch',{entries,idempotencyKey:this.orderIdempotencyKey}));this.orderCreated.set(true);this.orderRetryPayload=null;await this.fetchPurchases();return '已建立 '+(res?.count??entries.length)+' 筆叫貨，重複匯出不會建單。';}catch(error:any){return '建立結果尚未確認：'+(error?.error?.message||error?.message||String(error))+'；重試會使用原始訂單與同一識別碼，避免重複。';}}

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
