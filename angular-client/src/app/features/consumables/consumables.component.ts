import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiConfigService } from '@services/api-config.service';
import { PatientStoreService } from '@services/patient-store.service';
import {
  ApiManagerService,
  type ApiManager,
  type FirestoreRecord,
} from '@services/api-manager.service';
// Standalone 版：已移除 Firebase
import { formatDateToYYYYMM } from '@/utils/dateUtils';
import {
  buildDynamicHeaders,
  buildPatientConsumptionRows,
  summarizeUploadedRanges,
  type ConsumableReport,
  type UploadedRangeSummary,
} from '@/utils/consumablesReport';
import { shiftMonthString } from '@/utils/dateStep';

const SHIFT_INDEX_MAP: Record<number, string> = { 0: '早班', 1: '午班', 2: '晚班' };

@Component({
  selector: 'app-consumables',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './consumables.component.html',
  styleUrl: './consumables.component.css',
})
export class ConsumablesComponent implements OnInit {
  private firebaseService = inject(ApiConfigService);
  private patientStore = inject(PatientStoreService);
  private apiManagerService = inject(ApiManagerService);
  private consumablesReportsApi: ApiManager<FirestoreRecord>;

  // --- Tab state ---
  activeTab = signal<string>('query');

  // --- Query tab state ---
  isLoading = signal(false);
  searchPerformed = signal(false);
  rawConsumablesData = signal<any[]>([]);
  processedData = signal<any[]>([]);

  // 以「該月有上傳紀錄的病人」為主體（含已刪除病人），頻率/班別 'all' 不篩
  groupSearchParams = {
    freq: 'all',
    shift: 'all',
    keyword: '',
    month: formatDateToYYYYMM(new Date()),
  };
  /** 該月已上傳的區間 × 類別摘要 */
  uploadedRanges = signal<UploadedRangeSummary[]>([]);

  dynamicHeaders = signal<{
    artificialKidney: string[];
    dialysateCa: string[];
    bicarbonateType: string[];
  }>({
    artificialKidney: [],
    dialysateCa: [],
    bicarbonateType: [],
  });

  readonly flattenedHeaders = computed(() => {
    const h = this.dynamicHeaders();
    return [
      ...h.artificialKidney,
      ...h.dialysateCa,
      ...h.bicarbonateType,
    ];
  });

  // --- Upload tab state ---
  selectedFile = signal<File | null>(null);
  isUploading = signal(false);
  uploadResult = signal<{ message: string; errorCount: number } | null>(null);
  isDragOver = signal(false);

  constructor() {
    this.consumablesReportsApi = this.apiManagerService.create<FirestoreRecord>('consumables_reports');
  }

  ngOnInit(): void {
    this.patientStore.fetchPatientsIfNeeded();
  }

  /** 盤點月份「‹ ›」導航 */
  stepMonth(delta: number): void {
    this.groupSearchParams.month = shiftMonthString(this.groupSearchParams.month, delta);
  }

  formatShift(shiftIndex: number | undefined): string {
    if (shiftIndex === undefined || shiftIndex === null) return '-';
    return SHIFT_INDEX_MAP[shiftIndex] ?? '-';
  }

  async handleSearch(): Promise<void> {
    this.isLoading.set(true);
    this.searchPerformed.set(true);
    this.rawConsumablesData.set([]);
    this.processedData.set([]);
    this.dynamicHeaders.set({ artificialKidney: [], dialysateCa: [], bicarbonateType: [] });
    this.uploadedRanges.set([]);

    try {
      const reportMonth = this.groupSearchParams.month;
      if (!reportMonth) {
        alert('請先選擇盤點月份。');
        return;
      }
      await this.patientStore.fetchPatientsIfNeeded();

      // 以該月報表為主體（後端 GET /orders/consumables 帶病人刪除狀態），不再從在籍病人清單出發
      const monthlyReports = (await this.consumablesReportsApi.fetchWhere({
        startDate: `${reportMonth}-01`,
        endDate: `${reportMonth}-31`,
      })) as unknown as ConsumableReport[];
      this.rawConsumablesData.set(monthlyReports);
      this.uploadedRanges.set(summarizeUploadedRanges(monthlyReports));
      this.dynamicHeaders.set(buildDynamicHeaders(monthlyReports));

      const processed = buildPatientConsumptionRows(
        monthlyReports,
        this.patientStore.patientMap(),
        {
          freq: this.groupSearchParams.freq,
          shift: this.groupSearchParams.shift,
          keyword: this.groupSearchParams.keyword,
        },
        this.flattenedHeaders(),
      );

      this.processedData.set(processed);
    } catch (error) {
      console.error('查詢耗材資料失敗:', error);
      alert('查詢耗材資料時發生錯誤，請檢查主控台。');
    } finally {
      this.isLoading.set(false);
    }
  }

  async exportConsumablesToExcel(): Promise<void> {
    const XLSX = await import('xlsx');
    const data = this.processedData();
    if (!data || data.length === 0) {
      alert('沒有可匯出的資料。');
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
      const title = `每月耗材總表: ${freqName} / ${shiftName} / ${month}${rangesText ? `　已上傳區間：${rangesText}` : ''}`;

      // Step 1: Build complex headers with freq and shift columns
      const FIXED_COLS = 6;
      const headerRow1: string[] = ['頻率', '班別', '床號', '病歷號', '姓名', '狀態'];
      const headerRow2: string[] = ['', '', '', '', '', ''];

      const dh = this.dynamicHeaders();
      const categoryNames: Record<string, string> = {
        artificialKidney: '人工腎臟',
        dialysateCa: '透析藥水CA',
        bicarbonateType: 'B液種類',
      };

      for (const category in dh) {
        const items = dh[category as keyof typeof dh];
        if (items && Array.isArray(items) && items.length > 0) {
          const categoryName = categoryNames[category] || category;
          headerRow1.push(categoryName);
          for (let i = 1; i < items.length; i++) {
            headerRow1.push('');
          }
          items.forEach((item: string) => headerRow2.push(String(item || '')));
        }
      }

      // Step 2: Build data rows
      const flatHeaders = this.flattenedHeaders();
      const dataRows = data.map((row: any) => {
        const dataRow: (string | number)[] = [
          row.freq || '-',
          this.formatShift(row.shiftIndex),
          row.bedNum || '',
          row.medicalRecordNumber || '',
          row.patientName || '',
          row.statusLabel || '',
        ];
        flatHeaders.forEach((header: string) => {
          const count = row.consumableCounts[header];
          dataRow.push(count !== undefined && count !== null ? count : '');
        });
        return dataRow;
      });

      // Step 3: Combine all data
      const sheetData = [[title], [], headerRow1, headerRow2, ...dataRows];
      const ws = XLSX.utils.aoa_to_sheet(sheetData, { skipHidden: true } as any);

      // Step 4: Set merged cells
      ws['!merges'] = [];
      const totalColumnCount = flatHeaders.length + FIXED_COLS;
      ws['!merges'].push({ s: { r: 0, c: 0 }, e: { r: 0, c: totalColumnCount - 1 } });

      // Merge fixed column headers
      for (let i = 0; i < FIXED_COLS; i++) {
        ws['!merges'].push({ s: { r: 2, c: i }, e: { r: 3, c: i } });
      }

      // Dynamically merge category headers
      let currentCol = FIXED_COLS;
      for (const category in dh) {
        const items = dh[category as keyof typeof dh];
        if (items && Array.isArray(items) && items.length > 0) {
          ws['!merges'].push({
            s: { r: 2, c: currentCol },
            e: { r: 2, c: currentCol + items.length - 1 },
          });
          currentCol += items.length;
        }
      }

      // Step 5: Trigger browser download
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '耗材總表');

      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([wbout], { type: 'application/octet-stream' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      const fileName = `耗材總表_${freqName}_${shiftName}_${month}.xlsx`;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
    } catch (error) {
      console.error('匯出 Excel 失敗:', error);
      alert('匯出 Excel 時發生嚴重錯誤，請檢查主控台以獲取詳細資訊。');
    }
  }

  handleFileSelect(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
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
      reader.onload = () => resolve((reader.result as string).replace(/^data:(.*,)?/, ''));
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
      const res = await fetch(`${this.firebaseService.apiBaseUrl}/consumables/process`, {
        method: 'POST',
        headers: this.firebaseService.getHeaders(),
        body: JSON.stringify({
          fileName: file.name,
          fileContent: fileContentBase64,
        }),
      });
      const resultData = await res.json();
      this.uploadResult.set(resultData as { message: string; errorCount: number });
    } catch (error: any) {
      console.error('上傳處理失敗:', error);
      this.uploadResult.set({ message: `上傳失敗: ${error.message}`, errorCount: 1 });
    } finally {
      this.isUploading.set(false);
    }
  }
}
