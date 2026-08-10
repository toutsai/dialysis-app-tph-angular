// 書記專用 > 常規病人掛號
// 呈現比照每日排程「臨床查閱」簡表：列=床位、欄=班別，格內病歷號可點擊複製，
// 身分（門診/住院/急診/兩班頻率）用與每日排程相同的格子底色，住院/急診另帶病房號徽章。
// 資料源＝床位總表 (MASTER_SCHEDULE) 依頻率展開至星期；頻率認定與病人清單一致（patient.freq 合併欄位）。
import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PatientStoreService } from '@services/patient-store.service';
import { ORDERED_SHIFT_CODES, getShiftDisplayName } from '@/constants/scheduleConstants';
import { getUnifiedCellStyle } from '@/utils/scheduleUtils';

// 與總表頁 (base-schedule) 同一份前端頻率對照：0=週一 … 5=週六
const FREQ_MAP_TO_DAY_INDEX: Record<string, number[]> = {
  '一三五': [0, 2, 4], '二四六': [1, 3, 5], '一四': [0, 3], '二五': [1, 4],
  '三六': [2, 5], '一五': [0, 4], '二六': [1, 5], '每日': [0, 1, 2, 3, 4, 5],
  '每周一': [0], '每周二': [1], '每周三': [2], '每周四': [3], '每周五': [4], '每周六': [5],
};

const STATUS_LABELS: Record<string, string> = { opd: '門診', ipd: '住院', er: '急診' };

// 與總表頁 (base-schedule) 相同的床位配置：一般床 + 外圍 1~6
const BED_LAYOUT: (number | string)[] = [
  1, 2, 3, 5, 6, 7, 8, 9, 11, 12, 13, 15, 16, 17, 18, 19,
  21, 22, 23, 25, 26, 27, 28, 29, 31, 32, 33, 35, 36, 37, 38, 39,
  51, 52, 53, 55, 56, 57, 58, 59, 61, 62, 63, 65,
  ...Array.from({ length: 6 }, (_, i) => `peripheral-${i + 1}`),
];

interface RegCell {
  patientId: string;
  name: string;
  medicalRecordNumber: string;
  freq: string;
  status: string;
  /** 住院/急診 才有值，含病房號，如「住院(7B-12)」 */
  statusBadge: string;
  /** 與每日排程一致的格子底色 class（status-opd/ipd/er/biweekly…） */
  cellStyle: Record<string, boolean>;
  shiftIndex: number;
  bedLabel: string;
  bedSortKey: number;
}

interface BedRow {
  label: string;
  sortKey: number;
}

@Component({
  selector: 'app-clerk-registration',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './clerk-registration.component.html',
  styleUrl: './clerk-registration.component.css',
})
export class ClerkRegistrationComponent implements OnInit {
  protected readonly patientStore = inject(PatientStoreService);

  readonly WEEKDAY_LABELS = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  readonly SHIFT_INDICES = [0, 1, 2];
  readonly SHIFT_HEADERS = ORDERED_SHIFT_CODES.map((code: string) => getShiftDisplayName(code));

  /** 0=週一 … 5=週六；預設今天（週日則顯示週一） */
  selectedDay = signal(this.defaultDayIndex());
  searchTerm = signal('');
  /** 剛複製的病歷號（顯示「已複製」提示用） */
  copiedMrn = signal('');
  private copiedTimer: ReturnType<typeof setTimeout> | null = null;

  /** 選定星期的全部格子：key = `${bedLabel}|${shiftIndex}` */
  private dayCellMap = computed<Map<string, RegCell[]>>(() => {
    const day = this.selectedDay();
    const pMap = this.patientStore.patientMap();
    const rules = this.patientStore.masterScheduleRules();
    const map = new Map<string, RegCell[]>();
    for (const [patientId, ruleRaw] of Object.entries(rules)) {
      const rule = ruleRaw as any;
      const patient = pMap.get(patientId);
      if (!patient || (patient as any).isDeleted) continue;
      // 頻率認定與病人清單一致：patient.freq（總表 scheduleRule.freq 優先，缺時退回病人頂層 freq）
      const freq = String((patient as any).freq || '');
      if (!freq) continue;
      const dayIndices = FREQ_MAP_TO_DAY_INDEX[freq] ?? [];
      if (!dayIndices.includes(day)) continue;
      const shiftIndex = Number(rule?.shiftIndex);
      if (!ORDERED_SHIFT_CODES[shiftIndex]) continue;
      const bed = this.parseBed(rule.bedNum);
      const status = String((patient as any).status || '');
      const ward = String((patient as any).wardNumber || '');
      const statusBadge =
        status === 'ipd' || status === 'er'
          ? `${STATUS_LABELS[status]}${ward ? `(${ward})` : ''}`
          : '';
      const cell: RegCell = {
        patientId,
        name: patient.name || '',
        medicalRecordNumber: patient.medicalRecordNumber || '',
        freq,
        status,
        statusBadge,
        cellStyle: getUnifiedCellStyle({ patientId, freq } as any, patient as any, freq),
        shiftIndex,
        bedLabel: bed.label,
        bedSortKey: bed.sortKey,
      };
      const key = `${bed.label}|${shiftIndex}`;
      const list = map.get(key);
      if (list) list.push(cell);
      else map.set(key, [cell]);
    }
    return map;
  });

  /** 床位列：固定配置 + 資料中出現的額外床位，數字床升冪、外圍床排後 */
  bedRows = computed<BedRow[]>(() => {
    const rows = new Map<string, BedRow>();
    for (const bedNum of BED_LAYOUT) {
      const bed = this.parseBed(bedNum);
      rows.set(bed.label, { label: bed.label, sortKey: bed.sortKey });
    }
    for (const cells of this.dayCellMap().values()) {
      for (const cell of cells) {
        if (!rows.has(cell.bedLabel)) {
          rows.set(cell.bedLabel, { label: cell.bedLabel, sortKey: cell.bedSortKey });
        }
      }
    }
    return [...rows.values()].sort((a, b) => a.sortKey - b.sortKey);
  });

  /** 套用搜尋後要顯示的床位列（搜尋時只留有命中的床） */
  visibleBedRows = computed<BedRow[]>(() => {
    const term = this.searchTerm().trim().toLowerCase();
    if (!term) return this.bedRows();
    const map = this.dayCellMap();
    return this.bedRows().filter((row) =>
      this.SHIFT_INDICES.some((si) =>
        (map.get(`${row.label}|${si}`) ?? []).some((c) => this.matches(c, term)),
      ),
    );
  });

  /** 各班人數（依選定星期，未套搜尋） */
  shiftCounts = computed(() => {
    const counts = [0, 0, 0];
    for (const cells of this.dayCellMap().values()) {
      for (const cell of cells) counts[cell.shiftIndex]++;
    }
    return counts;
  });

  totalCount = computed(() => this.shiftCounts().reduce((a, b) => a + b, 0));

  ngOnInit(): void {
    this.patientStore.fetchPatientsIfNeeded().catch((error) => {
      console.error('載入病人/總表資料失敗:', error);
    });
  }

  /** 模板取格資料（搜尋時只顯示命中的病人） */
  cellsFor(bedLabel: string, shiftIndex: number): RegCell[] {
    const cells = this.dayCellMap().get(`${bedLabel}|${shiftIndex}`) ?? [];
    const term = this.searchTerm().trim().toLowerCase();
    if (!term) return cells;
    return cells.filter((c) => this.matches(c, term));
  }

  cellStyleFor(bedLabel: string, shiftIndex: number): Record<string, boolean> {
    const cells = this.cellsFor(bedLabel, shiftIndex);
    return cells.length > 0 ? cells[0].cellStyle : {};
  }

  /** 與每日排程簡表同款：點病歷號複製（HTTP 非 secure context 用 execCommand fallback） */
  async copyMedicalRecordNumber(mrn: string): Promise<void> {
    if (!mrn) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(mrn);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = mrn;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      this.copiedMrn.set(mrn);
      if (this.copiedTimer) clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => this.copiedMrn.set(''), 1500);
    } catch (err) {
      console.error('複製失敗:', err);
    }
  }

  async exportExcel(): Promise<void> {
    const XLSX = await import('xlsx');
    const flat: RegCell[] = [];
    for (const cells of this.dayCellMap().values()) flat.push(...cells);
    if (flat.length === 0) return;
    flat.sort((a, b) => a.shiftIndex - b.shiftIndex || a.bedSortKey - b.bedSortKey);
    const dayLabel = this.WEEKDAY_LABELS[this.selectedDay()];
    const title = `${dayLabel} 常規病人掛號名單`;
    const header = ['班別', '床位', '病人姓名', '病歷號', '身分', '頻率'];
    const aoa: any[][] = [[title], header];
    flat.forEach((c) => {
      aoa.push([
        getShiftDisplayName(ORDERED_SHIFT_CODES[c.shiftIndex]),
        c.bedLabel,
        c.name,
        c.medicalRecordNumber,
        c.statusBadge || STATUS_LABELS[c.status] || '',
        c.freq,
      ]);
    });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: header.length - 1 } }];
    ws['!cols'] = [{ wch: 8 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '掛號名單');
    XLSX.writeFile(wb, `常規病人掛號_${dayLabel}.xlsx`);
  }

  private matches(cell: RegCell, term: string): boolean {
    return (
      cell.name.toLowerCase().includes(term) ||
      cell.medicalRecordNumber.toLowerCase().includes(term)
    );
  }

  private parseBed(bedNum: unknown): { label: string; sortKey: number } {
    if (typeof bedNum === 'number' && !isNaN(bedNum)) {
      return { label: String(bedNum), sortKey: bedNum };
    }
    const str = String(bedNum ?? '');
    const peripheralMatch = str.match(/^peripheral-?(\d+)$/);
    if (peripheralMatch) {
      const n = Number(peripheralMatch[1]);
      // 外圍床排在一般床之後
      return { label: `外${n}`, sortKey: 1000 + n };
    }
    const asNumber = Number(str);
    if (str && !isNaN(asNumber)) return { label: str, sortKey: asNumber };
    return { label: str || '—', sortKey: 9999 };
  }

  private defaultDayIndex(): number {
    const mondayBased = (new Date().getDay() + 6) % 7;
    return mondayBased > 5 ? 0 : mondayBased;
  }
}
