// Standalone 版：已移除 Firebase
import {
  Component,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import * as XLSX from 'xlsx';
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
  updatedAt?: string;
}

@Component({
  selector: 'app-orders',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './orders.component.html',
  styleUrl: './orders.component.css',
})
export class OrdersComponent implements OnInit {
  private readonly firebaseService = inject(ApiConfigService);
  private readonly apiManagerService = inject(ApiManagerService);
  private readonly patientStore = inject(PatientStoreService);
  private readonly medicationStore = inject(MedicationStoreService);

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

  // --- Medication Master Data ---
  readonly INJECTION_MEDS_MASTER: MedicationMaster[] = [
    { code: 'INES2', tradeName: 'NESP', unit: 'mcg' },
    { code: 'IREC1', tradeName: 'Recormon', unit: 'KIU' },
    { code: 'IFER2', tradeName: 'Fe-back', unit: 'mg' },
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
  readonly filteredDialysisRows = computed(() => {
    const term = this.dialysisSearchTerm().trim();
    let rows = this.dialysisRows();
    if (!this.showDeletedDialysis()) rows = rows.filter((r) => !r.isDeleted);
    if (!term) return rows;
    return rows.filter(
      (r) =>
        (r.patientName || '').includes(term) ||
        (r.medicalRecordNumber || '').includes(term) ||
        String(r.orders?.['mode'] || '').toUpperCase().includes(term.toUpperCase()),
    );
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
    this.patientStore.fetchPatientsIfNeeded();
  }

  // --- Helper Functions ---
  formatShift(shiftIndex: number): string {
    return this.SHIFT_INDEX_MAP[shiftIndex] ?? 'N/A';
  }

  formatOrderCell(orders: OrderRecord[] | undefined, monthKey?: string): string {
    if (!orders || orders.length === 0) return '-';
    // 同藥同月多筆（不同頻率/開立日期）全部顯示，依開始日/開立日期排序。
    // 不標日期：以各筆自帶的頻率/備註(formatSingleOrder 的括號內容)區分即可（例：NESP QW2 / QW4）
    const parts = [...orders]
      .sort(
        (a, b) =>
          new Date(a.startDate || a.changeDate || 0).getTime() -
          new Date(b.startDate || b.changeDate || 0).getTime(),
      )
      .map((o) => this.formatSingleOrder(o, monthKey))
      .filter((text) => text !== '-');
    return parts.length ? parts.join('；') : '-';
  }

  private formatSingleOrder(order: OrderRecord, monthKey?: string): string {
    const dose = order.dose || '';
    if (!dose) return '-';
    const masterMed = this.allMedications().find(
      (med) => med.code === order.orderCode,
    );
    const unit = masterMed?.unit ? ` ${masterMed.unit}` : '';
    const detailParts: string[] = [];
    if (order.orderCode === 'XX88') {
      // 自備藥：實際藥名在備註欄
      if (order.note) detailParts.push(order.note);
      if (order.frequency) detailParts.push(order.frequency);
    } else if (order.orderType === 'injection') {
      if (order.note) detailParts.push(order.note);
    } else if (order.frequency) {
      detailParts.push(order.frequency);
    }
    // 區間模型：處方在查詢月內（或之前）結束 → 標記停用日；仍持續中不標
    if (order.endDate && monthKey && order.endDate <= `${monthKey}-31`) {
      const [, m, d] = order.endDate.split('-');
      detailParts.push(`至${Number(m)}/${Number(d)}止`);
    }
    if (detailParts.length) {
      return `${dose}${unit} (${detailParts.join('，')})`;
    }
    return `${dose}${unit}`;
  }

  // --- Core Search Logic ---
  async handleSearch(): Promise<void> {
    this.isLoading.set(true);
    this.searchPerformed.set(true);
    this.searchResult.set([]);
    try {
      if (this.searchType() === 'group') {
        await this.searchGroupOrders();
      } else {
        await this.searchIndividualOrders();
      }
    } catch (error) {
      console.error('查詢藥囑失敗:', error);
      alert('查詢藥囑時發生錯誤，請稍後再試。');
    } finally {
      this.isLoading.set(false);
    }
  }

  private async searchGroupOrders(): Promise<void> {
    const masterScheduleDoc = await this.baseSchedulesApi.fetchById(
      'MASTER_SCHEDULE'
    );
    const masterRules: Record<string, any> =
      (masterScheduleDoc as any)?.schedule || {};
    const shiftIndex = this.SHIFT_MAP[this.groupSearchParams.shift];
    const regularFreqs = ['一三五', '二四六'];
    const opdPatients = this.patientStore.opdPatients();

    const patientList = opdPatients
      .filter((p: any) => {
        const rule = masterRules[p.id!];
        if (!rule) return false;
        const isOtherFreqSelected = this.groupSearchParams.freq === 'other';
        const shiftCondition =
          isOtherFreqSelected || rule.shiftIndex === shiftIndex;
        const freqCondition = isOtherFreqSelected
          ? !regularFreqs.includes(rule.freq)
          : rule.freq === this.groupSearchParams.freq;
        return shiftCondition && freqCondition;
      })
      .map((p: any) => ({
        patientId: p.id!,
        patientName: p.name,
        bedNum: masterRules[p.id!]?.bedNum,
        freq: masterRules[p.id!]?.freq,
        shiftIndex: masterRules[p.id!]?.shiftIndex,
      }));

    // Build patient map first -- always show the patient list
    const patientOrdersMap = new Map<string, GroupSearchResult>();
    patientList.forEach((p: any) =>
      patientOrdersMap.set(p.patientId, { ...p, orders: {} })
    );

    // Try to query medication orders and merge into patient map
    if (patientList.length > 0) {
      const [year, month] = this.groupSearchParams.month
        .split('-')
        .map(Number);
      const effectiveMonth = `${year}-${String(month).padStart(2, '0')}`;

      try {
        // 使用 effectiveMonth：每位病人取 <= 該月份的「最新一次上傳月份」並只回該月資料。
        // 院內流程：每月第一週抽血、第二週才依結果改藥，故當月尚未上傳時前兩週沿用上月藥物；
        // 當月一旦有新上傳即改用當月。注意：每位病人只取單一月份，不會跨月混合（非「合併」）。
        const params = new URLSearchParams({ effectiveMonth });
        const res = await fetch(
          `${this.firebaseService.apiBaseUrl}/orders/injection-orders?${params}`,
          { headers: this.firebaseService.getHeaders() },
        );
        const data = res.ok ? await res.json() : [];
        const allOrders: any[] = Array.isArray(data) ? data : data.data || [];
        const patientIdSet = new Set(patientList.map((p: any) => p.patientId));
        const filteredOrders = allOrders.filter((o: any) => patientIdSet.has(o.patientId));
        // 動態欄位：master 清單外的藥碼也要呈現
        this.collectExtraMeds(filteredOrders);
        // 不整併：同一藥物同月的每一筆（含不同頻率/開立日期）全部保留
        filteredOrders.forEach((order: any) => {
          const patientData = patientOrdersMap.get(order.patientId);
          if (patientData) {
            if (!patientData.orders[order.orderCode]) {
              patientData.orders[order.orderCode] = [];
            }
            patientData.orders[order.orderCode].push(order);
          }
        });
      } catch (orderError) {
        console.warn('查詢藥囑資料時發生錯誤 (可能需要建立 Firestore 索引):', orderError);
      }
    }

    this.searchResult.set(
      Array.from(patientOrdersMap.values()).sort((a, b) =>
        String(a.bedNum).localeCompare(String(b.bedNum), undefined, {
          numeric: true,
        })
      )
    );
  }

  private async searchIndividualOrders(): Promise<void> {
    const term = this.individualSearchTerm().trim().toLowerCase();
    if (!term) {
      alert('請輸入姓名或病歷號');
      return;
    }

    const opdPatients = this.patientStore.opdPatients();
    const foundPatient = opdPatients.find(
      (p: any) =>
        p.name.toLowerCase().includes(term) ||
        p.medicalRecordNumber.includes(term)
    );

    if (!foundPatient) {
      this.searchResult.set([]);
      return;
    }

    const year = this.individualSearchYear();

    // 2B 效能批次：已知 foundPatient.id，改帶 ?patientId= 讓後端 injection_orders 查詢
    // 直接篩選（src/routes/orders.js:477-497，含 patientId-aware cache key），不再整表下載
    // 再前端 filter。年份篩選仍在下方 monthlyOrdersMap 迴圈以 change_date 逐月比對，語意不變。
    const patientOrders = await this.ordersApi.fetchWhere({
      patientId: foundPatient.id,
    });
    this.collectExtraMeds(patientOrders);

    const monthlyOrdersMap = new Map<string, IndividualSearchResult>();
    for (let i = 1; i <= 12; i++) {
      const monthKey = `${year}-${String(i).padStart(2, '0')}`;
      monthlyOrdersMap.set(monthKey, { month: monthKey, orders: {} });
    }

    const pushToMonth = (monthKey: string, order: any) => {
      const monthData = monthlyOrdersMap.get(monthKey);
      if (!monthData) return;
      if (!monthData.orders[order.orderCode]) {
        monthData.orders[order.orderCode] = [];
      }
      monthData.orders[order.orderCode].push(order);
    };

    // 不整併：同一藥物同月的每一筆（含不同頻率/開立日期）全部保留
    patientOrders.forEach((order: any) => {
      if (order.startDate) {
        // 區間模型：處方涵蓋的每個月都呈現（開始日 <= 月底，且未結束或結束日 >= 月初）
        for (let i = 1; i <= 12; i++) {
          const monthKey = `${year}-${String(i).padStart(2, '0')}`;
          const activeInMonth =
            order.startDate <= `${monthKey}-31` &&
            (!order.endDate || order.endDate >= `${monthKey}-01`);
          if (activeInMonth) pushToMonth(monthKey, order);
        }
      } else if (
        order.uploadMonth >= `${year}-01` &&
        order.uploadMonth <= `${year}-12`
      ) {
        // 舊月快照模型：依上傳月份歸檔
        pushToMonth(order.uploadMonth, order);
      }
    });

    this.searchResult.set(
      Array.from(monthlyOrdersMap.values()).sort((a, b) =>
        b.month.localeCompare(a.month)
      )
    );
  }

  changeYear(offset: number): void {
    this.individualSearchYear.update((y) => y + offset);
    if (this.individualSearchTerm().trim()) {
      this.handleSearch();
    }
  }

  // --- Excel Export ---
  exportOrdersToExcel(): void {
    const results = this.searchResult();
    if (!results || results.length === 0) {
      alert('沒有可匯出的資料。');
      return;
    }

    try {
      let title = '藥囑查詢結果';
      let headers: string[] = [];
      let dataRows: string[][] = [];
      let sheetData: string[][] = [];
      let fileName = '藥囑查詢結果.xlsx';

      const medHeaders = this.allMedications().map((med) => med.tradeName);

      if (this.searchType() === 'group') {
        const { freq, shift, month } = this.groupSearchParams;
        const shiftNameMap: Record<string, string> = {
          early: '早班',
          noon: '午班',
          late: '晚班',
        };
        const shiftName = shiftNameMap[shift] || shift;

        title = `藥囑查詢結果：群組 ${freq} / ${shiftName} / ${month}`;
        fileName = `藥囑查詢_群組_${freq}_${shiftName}_${month}.xlsx`;

        headers = ['頻率', '班別', '床號', '姓名', ...medHeaders];
        dataRows = (results as GroupSearchResult[]).map((patientRow) => {
          const row = [
            patientRow.freq,
            this.formatShift(patientRow.shiftIndex),
            patientRow.bedNum,
            patientRow.patientName,
          ];
          this.allMedications().forEach((med) => {
            const order = patientRow.orders[med.code];
            row.push(this.formatOrderCell(order, month));
          });
          return row;
        });
      } else {
        const patientName = this.individualSearchTerm().trim();
        const year = this.individualSearchYear();

        title = `藥囑查詢結果：個人 ${patientName} / ${year} 年`;
        fileName = `藥囑查詢_個人_${patientName}_${year}.xlsx`;

        headers = ['月份', ...medHeaders];
        dataRows = (results as IndividualSearchResult[]).map((monthRow) => {
          const row = [monthRow.month];
          this.allMedications().forEach((med) => {
            const order = monthRow.orders[med.code];
            row.push(this.formatOrderCell(order, monthRow.month));
          });
          return row;
        });
      }

      sheetData = [[title], [], headers, ...dataRows];

      const ws = XLSX.utils.aoa_to_sheet(sheetData);

      if (!ws['!merges']) ws['!merges'] = [];
      ws['!merges'].push({
        s: { r: 0, c: 0 },
        e: { r: 0, c: headers.length - 1 },
      });

      const colWidths = headers.map((_h, index) => {
        if (index < 4 && this.searchType() === 'group') return { wch: 12 };
        if (index === 0 && this.searchType() === 'individual')
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
      const res = await fetch(`${this.firebaseService.apiBaseUrl}/orders/dialysis-orders`, {
        headers: this.firebaseService.getHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = (await res.json()) as DialysisOrderRow[];
      this.dialysisRows.set(Array.isArray(rows) ? rows : []);
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

  exportDialysisOrdersToExcel(): void {
    try {
      const rows = this.filteredDialysisRows();
      const header = ['病歷號', '姓名', '透析模式', '透析時間', '乾體重', 'AK', '藥水Ca', '血液流速', '透析液流速', '外循沖洗', '初劑量', '維持劑', '醫囑日期', '歷次筆數'];
      const aoa = [header, ...rows.map((r) => {
        const o = r.orders || {};
        return [
          r.medicalRecordNumber, r.patientName, o['mode'] || '', this.formatDialysisTime(o),
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
