// src/app/features/patients/patient-summary/patient-summary.component.ts
// 病歷查詢頁籤：選一位病人，彙整顯示初透日期、感染標記(HBV/HCV)、通路、
// 目前/歷史透析醫囑，以及近一年本院實際透析日期(次數+清單)。
import { Component, computed, inject, signal, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '@services/api.service';
import { PatientStoreService, type Patient } from '@services/patient-store.service';
import { PatientHistoryModalComponent } from '@app/components/dialogs/patient-history-modal/patient-history-modal.component';

interface DialysisDate {
  date: string;
  shift: string | null;
}
interface DialysisDatesResponse {
  count: number;
  from: string;
  to: string;
  dates: DialysisDate[];
}
interface OrderHistoryEntry {
  id: string;
  operationType?: string;
  orders?: Record<string, any>;
  createdAt?: string;
}

@Component({
  selector: 'app-patient-summary',
  standalone: true,
  imports: [CommonModule, FormsModule, PatientHistoryModalComponent],
  templateUrl: './patient-summary.component.html',
  styleUrl: './patient-summary.component.css',
})
export class PatientSummaryComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly patientStore = inject(PatientStoreService);

  /** 從病人清單「病人履歷」鈕點入時預選的病人 */
  @Input() initialPatientId: string | null = null;
  @Output() seedConsumed = new EventEmitter<void>();

  /** 動向歷史彈窗（原清單「動向歷史」鈕移入履歷內） */
  readonly showHistoryModal = signal(false);

  ngOnInit(): void {
    if (this.initialPatientId) {
      const p = this.patientStore.allPatients().find((x) => x.id === this.initialPatientId);
      if (p) void this.selectPatient(p);
      this.seedConsumed.emit();
    }
  }

  // 須注意/感染類標記(對應病人表單 DISEASES 清單)
  private readonly INFECTION_TAGS = ['HBV', 'HCV', 'HIV', 'RPR', 'BC肝?', 'C肝治癒', 'COVID', '隔離'];
  readonly shiftLabel: Record<string, string> = { early: '早', noon: '午', late: '晚' };

  // --- Picker ---
  readonly searchTerm = signal('');
  readonly selectedId = signal<string | null>(null);

  // 病人履歷：含已刪除（出院）病人，讓再次入院前可先查身分
  readonly filteredPatients = computed<Patient[]>(() => {
    const term = this.searchTerm().trim().toLowerCase();
    if (!term) return [];
    return this.patientStore
      .allPatients()
      .filter(
        (p) =>
          (p.name && p.name.toLowerCase().includes(term)) ||
          (p.medicalRecordNumber && p.medicalRecordNumber.includes(term)),
      )
      .slice(0, 20);
  });

  // --- 透析來源身分（病人履歷 patientStatus.dialysisOrigin，永久保留） ---
  readonly ORIGIN_LABELS: Record<string, string> = {
    first: '本院首透',
    transfer: '外院轉入本院初透',
    repeat: '反覆住院',
  };
  readonly originFilter = signal<'off' | 'first' | 'transfer' | 'repeat' | 'unset'>('off');

  /** 履歷 type；未回填的舊資料依現行旗標推導 */
  originType(p: Patient): 'first' | 'transfer' | 'repeat' | null {
    const ps: any = p['patientStatus'] || {};
    const t = ps.dialysisOrigin?.type;
    if (t === 'first' || t === 'transfer' || t === 'repeat') return t;
    if (ps.isFirstDialysis?.active) return 'first';
    if (ps.hospitalFirstDialysis?.active) return 'transfer';
    return null;
  }

  originLabel(p: Patient): string {
    const t = this.originType(p);
    if (!t) return '未判定';
    const o: any = (p['patientStatus'] as any)?.dialysisOrigin || {};
    const ps: any = p['patientStatus'] || {};
    const date =
      t === 'first'
        ? o.firstDialysisDate || ps.isFirstDialysis?.date
        : t === 'transfer'
          ? o.hospitalFirstDate || ps.hospitalFirstDialysis?.date
          : null;
    return this.ORIGIN_LABELS[t] + (date ? `（${date}）` : '');
  }

  /** 篩選清單：一鍵撈出某身分的全部病人（含已刪除） */
  readonly originFilteredPatients = computed<Patient[]>(() => {
    const f = this.originFilter();
    if (f === 'off') return [];
    return this.patientStore
      .allPatients()
      .filter((p) => this.originType(p) === (f === 'unset' ? null : f))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  });

  isDeleted(p: Patient): boolean {
    return !!p['isDeleted'] || p.status === 'deleted';
  }

  // --- Selected patient detail ---
  readonly patient = signal<Patient | null>(null);
  readonly dialysisDates = signal<DialysisDatesResponse | null>(null);
  readonly orderHistory = signal<OrderHistoryEntry[]>([]);
  readonly loading = signal(false);
  readonly datesExpanded = signal(false);

  // 感染標記(只取須注意/感染類)
  readonly infectionTags = computed<string[]>(() => {
    const raw = (this.patient()?.['diseases'] as unknown[]) || [];
    const names = raw.map((d) => (typeof d === 'string' ? d : (d as any)?.name)).filter(Boolean);
    return names.filter((n) => this.INFECTION_TAGS.includes(n));
  });

  // 目前透析醫囑摘要欄位
  readonly currentOrder = computed<Record<string, any>>(
    () => (this.patient()?.['dialysisOrders'] as Record<string, any>) || {},
  );

  // 初透日期：實際存在 patientStatus.isFirstDialysis.date，舊資料 fallback 到 firstDialysisDate 欄位
  readonly firstDialysisDate = computed<string | null>(() => {
    const p = this.patient();
    if (!p) return null;
    const status = (p['patientStatus'] as any)?.isFirstDialysis;
    return status?.date || (p['firstDialysisDate'] as string) || null;
  });

  // 透析院所：{ source: 原透析院所, transferOut: 轉出院所 }
  readonly hospitalInfo = computed<{ source?: string; transferOut?: string }>(
    () => (this.patient()?.['hospitalInfo'] as any) || {},
  );

  // 近一年透析日期(依月份分組，顯示用)
  readonly datesByMonth = computed<{ month: string; items: DialysisDate[] }[]>(() => {
    const dates = this.dialysisDates()?.dates || [];
    const groups = new Map<string, DialysisDate[]>();
    for (const d of dates) {
      const month = (d.date || '').slice(0, 7); // YYYY-MM
      if (!groups.has(month)) groups.set(month, []);
      groups.get(month)!.push(d);
    }
    return Array.from(groups.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([month, items]) => ({ month, items }));
  });

  async selectPatient(p: Patient): Promise<void> {
    if (!p.id) return;
    this.selectedId.set(p.id);
    this.searchTerm.set('');
    this.loading.set(true);
    this.datesExpanded.set(false);
    this.patient.set(p); // 先以清單資料快速顯示
    this.dialysisDates.set(null);
    this.orderHistory.set([]);

    try {
      const [full, dates, history] = await Promise.all([
        firstValueFrom(this.api.get<Patient>('/patients/' + p.id)),
        firstValueFrom(this.api.get<DialysisDatesResponse>('/patients/' + p.id + '/dialysis-dates')),
        firstValueFrom(
          this.api.get<OrderHistoryEntry[]>('/orders/history', { patientId: p.id }),
        ),
      ]);
      if (full) this.patient.set(full);
      this.dialysisDates.set(dates || null);
      this.orderHistory.set(Array.isArray(history) ? history : []);
    } catch (err) {
      console.error('載入病人摘要失敗:', err);
    } finally {
      this.loading.set(false);
    }
  }

  clearSelection(): void {
    this.selectedId.set(null);
    this.patient.set(null);
    this.dialysisDates.set(null);
    this.orderHistory.set([]);
  }

  // 醫囑摘要的單行顯示(略過空值)
  orderSummary(o: Record<string, any>): string {
    if (!o) return '';
    const parts: string[] = [];
    if (o.mode) parts.push(o.mode);
    if (o.dryWeight) parts.push('DW ' + o.dryWeight);
    const bf = o.bloodFlow ?? o.blood_flow;
    if (bf) parts.push('BF ' + bf);
    const df = o.dialysateFlow ?? o.dialysateFlowRate ?? o.dialysisFlow;
    if (df) parts.push('DF ' + df);
    const ca = o.dialysateCa ?? o.dialysate;
    if (ca) parts.push('Ca ' + ca);
    return parts.join('　');
  }
}
