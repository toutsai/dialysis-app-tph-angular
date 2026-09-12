import { loadXlsx } from '@/utils/xlsxLoader';
// Standalone 版：已移除 Firebase
import {
  Component,
  inject,
  signal,
  computed,
  OnInit,
  Input,
  HostBinding,
  ChangeDetectionStrategy,
  ElementRef,
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import { ApiConfigService } from '@services/api-config.service';
import {
  ApiManagerService,
  type ApiManager,
  type FirestoreRecord,
} from '@services/api-manager.service';
import { PatientStoreService } from '@services/patient-store.service';
import { MedicationStoreService } from '@services/medication-store.service';
import { queryWithInChunks } from '@/utils/firestoreUtils';
import { formatDateToYYYYMM } from '@/utils/dateUtils';
import { medicationMetadataMap, medicationCell, individualOrderMonths, matchingOrderPatients, type PatientChoice } from './orders-view-model';

interface GroupOrderQuery { type: 'group'; freq: string; shift: string; month: string }
interface IndividualOrderQuery { type: 'individual'; year: number; patientId: string; patientName: string; medicalRecordNumber: string }
type OrderQuery = GroupOrderQuery | IndividualOrderQuery;

interface MedicationMaster {
  code: string;
  tradeName: string;
  unit: string;
}

interface OrderRecord extends FirestoreRecord {
  patientId: string;
  orderCode: string;
  orderType?: string;
  dose?: string;
  note?: string;
  frequency?: string;
  startDate?: string;
  endDate?: string;
  prescriber?: string;
  changeDate?: string;
  uploadTimestamp?: { toDate: () => Date };
}

interface GroupSearchResult {
  patientId: string;
  patientName: string;
  medicalRecordNumber: string;
  bedNum: string;
  freq: string;
  shiftIndex: number;
  // 同一藥物（orderCode）同月可能有多筆（不同頻率/開立日期），全部保留不整併
  orders: Record<string, OrderRecord[]>;
}

interface IndividualSearchResult {
  month: string;
  orders: Record<string, OrderRecord[]>;
}

interface UploadResult {
  message: string;
  errorCount: number;
  errors?: { rowNumber: number; reason: string }[];
  success?: boolean;
  processedCount?: number;
}

/** 透析醫囑檢視列（GET /orders/dialysis-orders 回傳，orders key 對齊 DialysisOrderModal） */
interface DialysisOrderRow {
  id: string;
  patientId: string;
  patientName: string;
  medicalRecordNumber: string;
  effectiveDate: string;
  orders: Record<string, any>;
  sourceFile?: string;
  recordCount: number;
  isDeleted?: boolean;
  /** 病人現行醫囑的血管通路（HIS Excel 無此欄，手動維護） */
  vascAccess?: string;
  updatedAt?: string;
}

@Component({
  selector: 'app-orders',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './orders.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './orders.component.css',
})
export class OrdersComponent implements OnInit {
  /** 內嵌於「醫師專用」主頁籤時：隱藏自帶標題、改由 flex 撐滿父層（2026-09-05） */
  @HostBinding('class.embedded') @Input() embedded = false;

  private readonly firebaseService = inject(ApiConfigService);
  private readonly apiManagerService = inject(ApiManagerService);
  private readonly patientStore = inject(PatientStoreService);
  private readonly medicationStore = inject(MedicationStoreService);
  private readonly hostElement = inject<ElementRef<HTMLElement>>(ElementRef);

  private readonly baseSchedulesApi: ApiManager<FirestoreRecord>;
  private readonly ordersApi: ApiManager<OrderRecord>;

  // --- Component State ---
  readonly activeTab = signal<'query' | 'dialysis' | 'upload'>('query');
  readonly isLoading = signal(false);
  readonly searchPerformed = signal(false);
  readonly searchType = signal<'group' | 'individual'>('group');

  groupSearchParams = {
    freq: '一三五',
    shift: 'early',
    month: formatDateToYYYYMM(new Date()),
  };

  readonly individualSearchTerm = signal('');
  readonly individualSearchYear = signal(new Date().getFullYear());
  readonly searchResult = signal<(GroupSearchResult | IndividualSearchResult)[]>([]);
  readonly resultQuery = signal<OrderQuery | null>(null);
  readonly searchError = signal('');
  readonly searchNotice = signal('');
  readonly patientChoices = signal<PatientChoice[]>([]);
  readonly selectedOrderPatient = signal<PatientChoice | null>(null);
  readonly orderView = signal<'list' | 'table'>('list');
  readonly showAllItems = signal(false);
  readonly queryFiltersExpanded = signal(true);
  private searchRequest = 0;
  private lastAttempt: OrderQuery | null = null;

  // --- Medication Master Data ---
  readonly INJECTION_MEDS_MASTER: MedicationMaster[] = [
    { code: 'INES2', tradeName: 'NESP', unit: 'mcg' },
    { code: 'IREC1', tradeName: 'Recormon', unit: 'KIU' },
    { code: 'IFER2', tradeName: 'Good-Fe', unit: 'mg' },
    { code: 'ICAC', tradeName: 'Cacare', unit: 'amp' },
    { code: 'IPAR1', tradeName: 'Parsabiv', unit: 'mg' },
  ];

  readonly ORAL_MEDS_MASTER: MedicationMaster[] = [
    { code: 'OCAL1', tradeName: 'A-Cal', unit: '顆' },
    { code: 'OCAA', tradeName: 'Pro-Cal', unit: '顆' },
    { code: 'OFOS4', tradeName: 'Lanclean', unit: '顆' },
    { code: 'OALK1', tradeName: 'Alkantin', unit: '顆' },
    { code: 'OVAF', tradeName: 'Vafseo', unit: '顆' },
    { code: 'OORK', tradeName: 'Orkedia', unit: '顆' },
    { code: 'OUCA1', tradeName: 'U-Ca', unit: '顆' },
  ];

  /** master 清單外的已知藥碼顯示名（新版含停止日 Excel 會帶入更多藥品） */
  private readonly EXTRA_MED_NAMES: Record<string, string> = {
    OFOL: 'Folinate(葉酸)',
    OKEN: '維他命B群',
    OFOS5: 'Lanclean',
    XX88: '自備藥',
  };

  /** 查詢結果中出現、但不在 master 清單的藥碼（動態欄位：有上傳的藥品都呈現） */
  readonly extraMeds = signal<MedicationMaster[]>([]);

  readonly allMedications = computed(() => [
    ...this.INJECTION_MEDS_MASTER,
    ...this.ORAL_MEDS_MASTER,
    ...this.extraMeds(),
  ]);

  private readonly medicationByCode = computed(() => medicationMetadataMap(this.allMedications()));
  readonly orderRows = computed(() => {
    const query = this.resultQuery();
    const medications = this.allMedications();
    const metadata = this.medicationByCode();
    return this.searchResult().map(row => {
      const patient = row as GroupSearchResult;
      const month = query?.type === 'group' ? query.month : (row as IndividualSearchResult).month;
      const cells = medications.map(med => ({ ...medicationCell(med.code, row.orders[med.code], metadata, month), medication: med }));
      return { key: query?.type === 'group' ? patient.patientId : month, month,
        patientName: patient.patientName || '', medicalRecordNumber: patient.medicalRecordNumber || '',
        bedNum: patient.bedNum, freq: patient.freq, shift: this.formatShift(patient.shiftIndex),
        cells, hasRecords: cells.some(cell => cell.hasRecords) };
    });
  });
  readonly visibleMedications = computed(() => {
    const codes = new Set(this.orderRows().flatMap(row => row.cells.filter(cell => cell.hasRecords).map(cell => cell.code)));
    return this.allMedications().filter(med => this.showAllItems() || codes.has(med.code));
  });
  readonly displayedOrderRows = computed(() => {
    const codes = new Set(this.visibleMedications().map(med => med.code));
    return this.orderRows().map(row => ({ ...row, cells: row.cells.filter(cell => codes.has(cell.code)) }));
  });
  readonly resultTitle = computed(() => {
    const query = this.resultQuery();
    if (!query) return '';
    return query.type === 'group'
      ? `${query.month} · ${query.freq === 'other' ? '其他頻率' : query.freq}${query.freq === 'other' ? '' : ' · ' + this.formatShift(this.SHIFT_MAP[query.shift])}`
      : `${query.patientName} · 病歷號 ${query.medicalRecordNumber} · ${query.year} 年`;
  });

  /** 從查詢結果蒐集 master 清單外的藥碼，動態加欄 */
  private collectExtraMeds(orders: any[]): void {
    const knownCodes = new Set([
      ...this.INJECTION_MEDS_MASTER.map((m) => m.code),
      ...this.ORAL_MEDS_MASTER.map((m) => m.code),
    ]);
    const extras = new Map<string, MedicationMaster>();
    for (const o of orders) {
      const code = o?.orderCode;
      if (!code || knownCodes.has(code) || extras.has(code)) continue;
      extras.set(code, {
        code,
        tradeName: this.EXTRA_MED_NAMES[code] || code,
        unit: '',
      });
    }
    this.extraMeds.set(
      [...extras.values()].sort((a, b) => a.code.localeCompare(b.code)),
    );
  }

  // --- Upload Tab State ---
  readonly selectedFile = signal<File | null>(null);
  readonly isUploading = signal(false);
  readonly uploadResult = signal<UploadResult | null>(null);
  readonly isDragOver = signal(false);
  readonly uploadTargetMonth = signal(formatDateToYYYYMM(new Date()));

  // --- 透析醫囑（檢視 + 上傳）State ---
  readonly dialysisRows = signal<DialysisOrderRow[]>([]);
  readonly isDialysisLoading = signal(false);
  readonly dialysisLoaded = signal(false);
  readonly dialysisSearchTerm = signal('');
  /** 預設只顯示現行病人；勾選後含已離開（軟刪除）病人 */
  readonly showDeletedDialysis = signal(false);
  /** 檢視模式：群組（頻率+班別，床號排序，比照藥囑查詢）/ 全部清單（搜尋框） */
  readonly dialysisViewMode = signal<'group' | 'all'>('group');
  readonly dialysisGroupFreq = signal('一三五');
  readonly dialysisGroupShift = signal('early');
  /** 總表規則 patientId → {bedNum, freq, shiftIndex}（群組模式用） */
  private readonly dialysisMasterRules = signal<Record<string, any>>({});
  readonly displayedDialysisRows = computed(() => {
    let rows = this.dialysisRows();
    if (this.dialysisViewMode() === 'group') {
      const rules = this.dialysisMasterRules();
      const shiftIndex = this.SHIFT_MAP[this.dialysisGroupShift()];
      const freqSel = this.dialysisGroupFreq();
      const regularFreqs = ['一三五', '二四六'];
      return rows
        .filter((r) => !r.isDeleted)
        .map((r) => ({ ...r, rule: rules[r.patientId] }))
        .filter((r) => {
          if (!r.rule) return false;
          const isOther = freqSel === 'other';
          const shiftOk = isOther || r.rule.shiftIndex === shiftIndex;
          const freqOk = isOther ? !regularFreqs.includes(r.rule.freq) : r.rule.freq === freqSel;
          return shiftOk && freqOk;
        })
        .sort((a, b) => {
          const an = parseInt(String(a.rule?.bedNum), 10);
          const bn = parseInt(String(b.rule?.bedNum), 10);
          if (isNaN(an) && isNaN(bn)) return String(a.rule?.bedNum).localeCompare(String(b.rule?.bedNum));
          if (isNaN(an)) return 1;
          if (isNaN(bn)) return -1;
          return an - bn;
        });
    }
    // 全部清單模式：搜尋 + 已離開過濾
    if (!this.showDeletedDialysis()) rows = rows.filter((r) => !r.isDeleted);
    const term = this.dialysisSearchTerm().trim();
    const filtered = term
      ? rows.filter(
          (r) =>
            (r.patientName || '').includes(term) ||
            (r.medicalRecordNumber || '').includes(term) ||
            String(r.orders?.['mode'] || '').toUpperCase().includes(term.toUpperCase()),
        )
      : rows;
    return filtered.map((r) => ({ ...r, rule: undefined as any }));
  });
  readonly dialysisSelectedFile = signal<File | null>(null);
  readonly isDialysisUploading = signal(false);
  readonly dialysisUploadResult = signal<UploadResult | null>(null);
  readonly isDialysisDragOver = signal(false);

  // --- Helper Maps ---
  private readonly SHIFT_MAP: Record<string, number> = {
    early: 0,
    noon: 1,
    late: 2,
  };
  private readonly SHIFT_INDEX_MAP: Record<number, string> = {
    0: '早班',
    1: '午班',
    2: '晚班',
  };

  constructor() {
    this.baseSchedulesApi =
      this.apiManagerService.create<FirestoreRecord>('base_schedules');
    this.ordersApi =
      this.apiManagerService.create<OrderRecord>('medication_orders');
  }

  ngOnInit(): void {
    void this.patientStore.fetchPatientsIfNeeded().catch(() => this.searchError.set('患者資料載入失敗，請重新查詢。'));
  }

  // --- Helper Functions ---
  formatShift(shiftIndex: number): string {
    return this.SHIFT_INDEX_MAP[shiftIndex] ?? 'N/A';
  }

  formatOrderCell(orders: OrderRecord[] | undefined, monthKey?: string): string {
    return medicationCell('', orders, this.medicationByCode(), monthKey).text;
  }

  setIndividualTerm(term: string): void {
    this.individualSearchTerm.set(term);
    this.selectedOrderPatient.set(null);
    this.patientChoices.set([]);
  }

  toggleQueryFilters(): void {
    const expanded = !this.queryFiltersExpanded();
    this.queryFiltersExpanded.set(expanded);
    setTimeout(() => this.focusQueryControl(expanded ? '#order-query-filters input, #order-query-filters select' : '.query-expand-btn'));
  }

  private focusQueryControl(selector: string): void {
    const control = this.hostElement.nativeElement.querySelector<HTMLElement>(selector);
    if (control?.getClientRects().length) control.focus();
  }

  selectOrderPatient(patient: PatientChoice): void {
    this.selectedOrderPatient.set(patient);
    this.individualSearchTerm.set(patient.medicalRecordNumber || patient.name || '');
    this.patientChoices.set([]);
    void this.handleSearch();
  }

  async handleSearch(retry?: OrderQuery): Promise<void> {
    const request = ++this.searchRequest;
    const type = retry?.type || this.searchType();
    const group = { ...this.groupSearchParams };
    const term = this.individualSearchTerm();
    const year = this.individualSearchYear();
    const selected = this.selectedOrderPatient();
    this.isLoading.set(true);
    this.searchError.set('');
    this.searchNotice.set('');
    this.patientChoices.set([]);
    let query = retry;
    this.lastAttempt = retry || null;
    try {
      await this.patientStore.fetchPatientsIfNeeded();
      if (request !== this.searchRequest) return;
      if (!query) {
        if (type === 'group') {
          if (!/^\d{4}-\d{2}$/.test(group.month)) {
            this.searchNotice.set('請選擇查詢月份。');
            return;
          }
          query = { type: 'group', ...group };
        } else {
          const matches = matchingOrderPatients(this.patientStore.opdPatients(), term);
          const patient = selected && matches.find(candidate => candidate.id === selected.id)
            || (matches.length === 1 ? matches[0] : undefined);
          if (!patient?.id) {
            this.patientChoices.set(matches);
            this.searchNotice.set(!term.trim() ? '請輸入姓名或病歷號。' : matches.length ? '找到多位符合的患者，請選擇確切患者後查詢。' : '找不到符合的患者，請確認姓名或病歷號。');
            return;
          }
          query = { type: 'individual', year, patientId: patient.id, patientName: patient.name || '', medicalRecordNumber: patient.medicalRecordNumber || '' };
        }
      }
      this.lastAttempt = query;
      const { results, metadataOrders } = query.type === 'group'
        ? await this.searchGroupOrders(query).then(results => ({ results, metadataOrders: results.flatMap(row => Object.values(row.orders).flat()) }))
        : await this.searchIndividualOrders(query);
      if (request !== this.searchRequest) return;
      this.collectExtraMeds(metadataOrders);
      this.searchResult.set(results);
      this.resultQuery.set(query);
      this.searchPerformed.set(true);
      this.queryFiltersExpanded.set(false);
      setTimeout(() => {
        if (request === this.searchRequest && !this.queryFiltersExpanded()) this.focusQueryControl('.query-expand-btn');
      });
    } catch (error) {
      if (request !== this.searchRequest) return;
      this.searchError.set('查詢失敗，無法確認本次藥囑資料。請重試。');
    } finally {
      if (request === this.searchRequest) this.isLoading.set(false);
    }
  }

  retrySearch(): void { void this.handleSearch(this.lastAttempt || undefined); }

  private async searchGroupOrders(query: GroupOrderQuery): Promise<GroupSearchResult[]> {
    const masterScheduleDoc = await this.baseSchedulesApi.fetchById('MASTER_SCHEDULE');
    const masterRules: Record<string, any> = (masterScheduleDoc as any)?.schedule || {};
    const shiftIndex = this.SHIFT_MAP[query.shift];
    const regularFreqs = ['一三五', '二四六'];
    const patients: GroupSearchResult[] = this.patientStore.opdPatients().filter(p => {
      const rule = masterRules[p.id!];
      if (!rule) return false;
      return query.freq === 'other' ? !regularFreqs.includes(rule.freq) : rule.freq === query.freq && rule.shiftIndex === shiftIndex;
    }).map(p => ({ patientId: p.id!, patientName: p.name, medicalRecordNumber: p.medicalRecordNumber,
      bedNum: masterRules[p.id!].bedNum, freq: masterRules[p.id!].freq, shiftIndex: masterRules[p.id!].shiftIndex, orders: Object.create(null) }));
    const byPatient = new Map(patients.map(patient => [patient.patientId, patient]));
    if (patients.length) {
      // Backend owns interval and legacy latest-upload-month selection.
      const params = new URLSearchParams({ effectiveMonth: query.month });
      const response = await fetch(`${this.firebaseService.apiBaseUrl}/orders/injection-orders?${params}`, { headers: this.firebaseService.getHeaders() });
      if (!response.ok) throw new Error(`Orders request failed (${response.status})`);
      const body = await response.json();
      const orders = Array.isArray(body) ? body : body?.data;
      if (!Array.isArray(orders)) throw new Error('Invalid orders response');
      for (const order of orders) {
        const patient = byPatient.get(order.patientId);
        if (patient) (patient.orders[order.orderCode] ||= []).push(order);
      }
    }
    return patients.sort((a, b) => String(a.bedNum).localeCompare(String(b.bedNum), undefined, { numeric: true }));
  }

  private async searchIndividualOrders(query: IndividualOrderQuery): Promise<{ results: IndividualSearchResult[]; metadataOrders: OrderRecord[] }> {
    const patientOrders = await this.ordersApi.fetchWhere({ patientId: query.patientId });
    // Export and "all items" retain this patient's known codes from all years,
    // while active columns are derived only from the displayed year's records.
    return { results: individualOrderMonths(patientOrders, query.year), metadataOrders: patientOrders };
  }


  changeYear(offset: number): void {
    this.individualSearchYear.update((y) => y + offset);
    if (this.individualSearchTerm().trim()) {
      this.handleSearch();
    }
  }

  // --- Excel Export ---
  async exportOrdersToExcel(): Promise<void> {
    const query = this.resultQuery();
    const rows = this.orderRows();
    const medications = this.allMedications();
    if (!query || rows.length === 0) {
      alert('沒有可匯出的資料。');
      return;
    }

    try {
      const XLSX = await loadXlsx();
      let title = '藥囑查詢結果';
      let headers: string[] = [];
      let dataRows: string[][] = [];
      let sheetData: string[][] = [];
      let fileName = '藥囑查詢結果.xlsx';

      const medHeaders = medications.map((med) => med.tradeName);

      if (query.type === 'group') {
        const { freq, shift, month } = query;
        const shiftNameMap: Record<string, string> = {
          early: '早班',
          noon: '午班',
          late: '晚班',
        };
        const shiftName = shiftNameMap[shift] || shift;

        title = `藥囑查詢結果：群組 ${freq} / ${shiftName} / ${month}`;
        fileName = `藥囑查詢_群組_${freq}_${shiftName}_${month}.xlsx`;

        headers = ['頻率', '班別', '床號', '姓名', ...medHeaders];
        dataRows = rows.map(row => [row.freq, row.shift, row.bedNum, row.patientName, ...row.cells.map(cell => cell.text)]);
      } else {
        const patientName = query.patientName;
        const year = query.year;

        title = `藥囑查詢結果：個人 ${patientName} / ${year} 年`;
        fileName = `藥囑查詢_個人_${patientName}_${year}.xlsx`;

        headers = ['月份', ...medHeaders];
        dataRows = rows.map(row => [row.month, ...row.cells.map(cell => cell.text)]);
      }

      sheetData = [[title], [], headers, ...dataRows];

      const ws = XLSX.utils.aoa_to_sheet(sheetData);

      if (!ws['!merges']) ws['!merges'] = [];
      ws['!merges'].push({
        s: { r: 0, c: 0 },
        e: { r: 0, c: headers.length - 1 },
      });

      const colWidths = headers.map((_h, index) => {
        if (index < 4 && query.type === 'group') return { wch: 12 };
        if (index === 0 && query.type === 'individual')
          return { wch: 15 };
        return { wch: 20 };
      });
      ws['!cols'] = colWidths;

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '藥囑查詢結果');

      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([wbout], {
        type: 'application/octet-stream',
      });

      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
    } catch (error) {
      console.error('匯出 Excel 失敗:', error);
      alert('匯出 Excel 時發生錯誤，請檢查主控台。');
    }
  }

  // --- Upload Tab Methods ---
  handleFileSelect(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.selectedFile.set(input.files[0]);
      this.uploadResult.set(null);
    }
  }

  handleFileDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(false);
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      this.selectedFile.set(files[0]);
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

  private toBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () =>
        resolve(
          (reader.result as string).toString().replace(/^data:(.*,)?/, '')
        );
      reader.onerror = (error) => reject(error);
    });
  }

  async handleUpload(): Promise<void> {
    const file = this.selectedFile();
    if (!file) {
      alert('請先選擇一個檔案！');
      return;
    }
    this.isUploading.set(true);
    this.uploadResult.set(null);
    try {
      const fileContentBase64 = await this.toBase64(file);
      const res = await fetch(`${this.firebaseService.apiBaseUrl}/orders/process`, {
        method: 'POST',
        headers: this.firebaseService.getHeaders(),
        body: JSON.stringify({
          fileName: file.name,
          fileContent: fileContentBase64,
          targetMonth: this.uploadTargetMonth(),
        }),
      });
      const resultData = await res.json();
      this.uploadResult.set(resultData as UploadResult);

      const data = resultData as UploadResult;
      if (data && data.success && (data.processedCount ?? 0) > 0) {
        console.log('[OrdersComponent] 藥囑上傳成功，正在清除針劑快取...');
        this.medicationStore.clearCache();
      }
    } catch (error: any) {
      console.error('上傳處理失敗:', error);
      this.uploadResult.set({
        message: `上傳失敗: ${error.message}`,
        errorCount: 1,
        errors: [],
      });
    } finally {
      this.isUploading.set(false);
    }
  }

  // --- 透析醫囑檢視 ---
  openDialysisTab(): void {
    this.activeTab.set('dialysis');
    if (!this.dialysisLoaded()) {
      void this.loadDialysisOrders();
    }
  }

  async loadDialysisOrders(): Promise<void> {
    this.isDialysisLoading.set(true);
    try {
      const [res, masterScheduleDoc] = await Promise.all([
        fetch(`${this.firebaseService.apiBaseUrl}/orders/dialysis-orders`, {
          headers: this.firebaseService.getHeaders(),
        }),
        this.baseSchedulesApi.fetchById('MASTER_SCHEDULE'),
      ]);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = (await res.json()) as DialysisOrderRow[];
      this.dialysisRows.set(Array.isArray(rows) ? rows : []);
      this.dialysisMasterRules.set((masterScheduleDoc as any)?.schedule || {});
      this.dialysisLoaded.set(true);
    } catch (error) {
      console.error('載入透析醫囑失敗:', error);
      this.dialysisRows.set([]);
    } finally {
      this.isDialysisLoading.set(false);
    }
  }

  formatDialysisTime(orders: Record<string, any>): string {
    if (orders?.['dialysisTimeText']) return orders['dialysisTimeText'];
    const h = orders?.['dialysisTimeHours'];
    const m = orders?.['dialysisTimeMinutes'];
    if (h === '' || h === undefined || h === null) return '-';
    return `${h}時${m || 0}分`;
  }

  /** AK 六天明細（滑鼠提示用） */
  akWeeklyTitle(orders: Record<string, any>): string {
    const weekly = orders?.['akWeekly'];
    if (!Array.isArray(weekly)) return '';
    const labels = ['一', '二', '三', '四', '五', '六'];
    return weekly
      .map((v: string, i: number) => (v ? `${labels[i]}:${v}` : ''))
      .filter(Boolean)
      .join('　');
  }

  async exportDialysisOrdersToExcel(): Promise<void> {
    const XLSX = await loadXlsx();
    try {
      const rows = this.displayedDialysisRows();
      const isGroup = this.dialysisViewMode() === 'group';
      const header = [
        ...(isGroup ? ['床號'] : []),
        '病歷號', '姓名', '血管通路', '透析模式', '透析時間', '乾體重', 'AK', '藥水Ca', '血液流速', '透析液流速', '外循沖洗', '初劑量', '維持劑', '醫囑日期', '歷次筆數',
      ];
      const aoa = [header, ...rows.map((r) => {
        const o = r.orders || {};
        return [
          ...(isGroup ? [r.rule?.bedNum ?? ''] : []),
          r.medicalRecordNumber, r.patientName, r.vascAccess || '', o['mode'] || '', this.formatDialysisTime(o),
          o['dryWeight'] || '', o['ak'] || '', o['dialysateCa'] || '', o['bloodFlow'] || '',
          o['dialysateFlow'] || '', o['heparinRinse'] || '', o['heparinInitial'] || '',
          o['heparinMaintenance'] || '', r.effectiveDate, r.recordCount,
        ];
      })];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '透析醫囑');
      XLSX.writeFile(wb, `透析醫囑檢視_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (error) {
      console.error('匯出透析醫囑失敗:', error);
      alert('匯出 Excel 時發生錯誤，請檢查主控台。');
    }
  }

  // --- 透析醫囑上傳 ---
  handleDialysisFileSelect(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.dialysisSelectedFile.set(input.files[0]);
      this.dialysisUploadResult.set(null);
    }
  }

  handleDialysisFileDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDialysisDragOver.set(false);
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      this.dialysisSelectedFile.set(files[0]);
      this.dialysisUploadResult.set(null);
    }
  }

  onDialysisDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDialysisDragOver.set(true);
  }

  onDialysisDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.isDialysisDragOver.set(false);
  }

  async handleDialysisUpload(): Promise<void> {
    const file = this.dialysisSelectedFile();
    if (!file) {
      alert('請先選擇一個檔案！');
      return;
    }
    this.isDialysisUploading.set(true);
    this.dialysisUploadResult.set(null);
    try {
      const fileContentBase64 = await this.toBase64(file);
      const res = await fetch(`${this.firebaseService.apiBaseUrl}/dialysis-orders/process`, {
        method: 'POST',
        headers: this.firebaseService.getHeaders(),
        body: JSON.stringify({ fileName: file.name, fileContent: fileContentBase64 }),
      });
      const resultData = (await res.json()) as UploadResult;
      this.dialysisUploadResult.set(resultData);
      if (resultData && resultData.success) {
        // 檢視清單重載 + 病人快取刷新（上傳會回寫 patients.dialysis_orders）
        this.dialysisLoaded.set(false);
        void this.patientStore.forceRefreshPatients();
      }
    } catch (error: any) {
      console.error('透析醫囑上傳失敗:', error);
      this.dialysisUploadResult.set({
        message: `上傳失敗: ${error.message}`,
        errorCount: 1,
        errors: [],
      });
    } finally {
      this.isDialysisUploading.set(false);
    }
  }
}
