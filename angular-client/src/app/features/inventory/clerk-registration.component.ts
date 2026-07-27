// 書記專用 > 常規病人掛號
// 從床位總表 (MASTER_SCHEDULE) 依頻率展開至星期幾，依班別/床位列出病人姓名與病歷號，供書記掛號。
import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PatientStoreService } from '@services/patient-store.service';
import { ORDERED_SHIFT_CODES, getShiftDisplayName } from '@/constants/scheduleConstants';
import * as XLSX from 'xlsx';

// 與總表頁 (base-schedule) 同一份前端頻率對照：0=週一 … 5=週六
const FREQ_MAP_TO_DAY_INDEX: Record<string, number[]> = {
  '一三五': [0, 2, 4], '二四六': [1, 3, 5], '一四': [0, 3], '二五': [1, 4],
  '三六': [2, 5], '一五': [0, 4], '二六': [1, 5], '每日': [0, 1, 2, 3, 4, 5],
  '每周一': [0], '每周二': [1], '每周三': [2], '每周四': [3], '每周五': [4], '每周六': [5],
};

interface RegistrationRow {
  patientId: string;
  name: string;
  medicalRecordNumber: string;
  bedLabel: string;
  bedSortKey: number;
  shiftIndex: number;
  shiftLabel: string;
  freq: string;
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
  readonly SHIFT_OPTIONS: { value: 'all' | 0 | 1 | 2; label: string }[] = [
    { value: 'all', label: '全部班別' },
    { value: 0, label: '早班' },
    { value: 1, label: '午班' },
    { value: 2, label: '晚班' },
  ];

  /** 0=週一 … 5=週六；預設今天（週日則顯示週一） */
  selectedDay = signal(this.defaultDayIndex());
  shiftFilter = signal<'all' | 0 | 1 | 2>('all');
  searchTerm = signal('');

  /** 選定星期的全部常規排班（未套班別/搜尋過濾），供各班人數統計 */
  private dayRows = computed<RegistrationRow[]>(() => {
    const day = this.selectedDay();
    const pMap = this.patientStore.patientMap();
    const rules = this.patientStore.masterScheduleRules();
    const rows: RegistrationRow[] = [];
    for (const [patientId, ruleRaw] of Object.entries(rules)) {
      const rule = ruleRaw as any;
      if (!rule?.freq) continue;
      const dayIndices = FREQ_MAP_TO_DAY_INDEX[rule.freq] ?? [];
      if (!dayIndices.includes(day)) continue;
      const shiftIndex = Number(rule.shiftIndex);
      if (!ORDERED_SHIFT_CODES[shiftIndex]) continue;
      const patient = pMap.get(patientId);
      if (!patient || (patient as any).isDeleted) continue;
      const bed = this.parseBed(rule.bedNum);
      rows.push({
        patientId,
        name: patient.name || '',
        medicalRecordNumber: patient.medicalRecordNumber || '',
        bedLabel: bed.label,
        bedSortKey: bed.sortKey,
        shiftIndex,
        shiftLabel: getShiftDisplayName(ORDERED_SHIFT_CODES[shiftIndex]),
        freq: rule.freq,
      });
    }
    rows.sort((a, b) => a.shiftIndex - b.shiftIndex || a.bedSortKey - b.bedSortKey);
    return rows;
  });

  /** 套用班別 + 搜尋後的顯示列 */
  filteredRows = computed<RegistrationRow[]>(() => {
    const shift = this.shiftFilter();
    const term = this.searchTerm().trim().toLowerCase();
    return this.dayRows().filter((row) => {
      if (shift !== 'all' && row.shiftIndex !== shift) return false;
      if (term) {
        return (
          row.name.toLowerCase().includes(term) ||
          row.medicalRecordNumber.toLowerCase().includes(term)
        );
      }
      return true;
    });
  });

  /** 各班人數（依選定星期，未套搜尋） */
  shiftCounts = computed(() => {
    const counts = [0, 0, 0];
    for (const row of this.dayRows()) counts[row.shiftIndex]++;
    return counts;
  });

  ngOnInit(): void {
    this.patientStore.fetchPatientsIfNeeded().catch((error) => {
      console.error('載入病人/總表資料失敗:', error);
    });
  }

  exportExcel(): void {
    const rows = this.filteredRows();
    if (rows.length === 0) return;
    const dayLabel = this.WEEKDAY_LABELS[this.selectedDay()];
    const shift = this.shiftFilter();
    const shiftLabel =
      shift === 'all' ? '' : ` ${this.SHIFT_OPTIONS.find((o) => o.value === shift)?.label ?? ''}`;
    const title = `${dayLabel}${shiftLabel} 常規病人掛號名單`;
    const header = ['班別', '床位', '病人姓名', '病歷號', '頻率'];
    const aoa: any[][] = [[title], header];
    rows.forEach((r) => {
      aoa.push([r.shiftLabel, r.bedLabel, r.name, r.medicalRecordNumber, r.freq]);
    });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: header.length - 1 } }];
    ws['!cols'] = [{ wch: 8 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '掛號名單');
    XLSX.writeFile(wb, `常規病人掛號_${dayLabel}${shiftLabel.trim() ? '_' + shiftLabel.trim() : ''}.xlsx`);
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
