import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PatientStoreService } from '@services/patient-store.service';
import { quarterRange, currentQuarter } from '@/services/kiditVascularCsvService';
import { fetchQuarterRecords, saveQuarterRecord } from '@/services/kiditQuarterInputService';
import {
  HDRX_FIELD_KEYS,
  HDRX_MODE_OPTIONS,
  HDRX_ANTICOAG_OPTIONS,
  HDRX_BASE_OPTIONS,
  HdrxExportRow,
  buildHdrxPrefill,
  downloadHdrxCsv,
} from '@/services/kiditHdrxService';
import { AK_DIALYZER_LIST } from '@app/core/constants/ak-dialyzer-map';

interface HdrxRow {
  patientId: string;
  name: string;
  medicalRecordNumber: string;
  idNumber: string;
  akName: string;
  warnings: string[];
  excluded: boolean;
  prefill: Record<string, string>;
  overrideValues: Record<string, string>;
  values: Record<string, string>;
}

/**
 * HD處方季度工作檯（工作站「HD處方」頁籤內嵌）：
 * 名單＝常規門診病人；預帶自透析醫囑（buildHdrxPrefill），逐欄可改並自動儲存覆寫；
 * 覆寫存 kidit_quarter_records.data.hdrx（頂層鍵淺合併，與主護季度表單共存）。
 */
@Component({
  selector: 'app-kidit-hdrx-quarterly',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './kidit-hdrx-quarterly.component.html',
  styleUrl: './kidit-hdrx-quarterly.component.css',
})
export class KiditHdrxQuarterlyComponent implements OnInit, OnDestroy {
  private readonly patientStore = inject(PatientStoreService);

  readonly modeOptions = HDRX_MODE_OPTIONS;
  readonly anticoagOptions = HDRX_ANTICOAG_OPTIONS;
  readonly baseOptions = HDRX_BASE_OPTIONS;
  readonly akList = AK_DIALYZER_LIST;

  readonly year = signal(currentQuarter().year);
  readonly q = signal(currentQuarter().q);
  readonly quarter = computed(() => `${this.year()}Q${this.q()}`);
  readonly isLoading = signal(false);
  readonly rows = signal<HdrxRow[]>([]);
  readonly saveState = signal<'' | 'saving' | 'saved' | 'error'>('');

  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingSaves = new Set<string>();

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    this.flushPendingSaves();
  }

  quarterRangeLabel(): string {
    const { startDate, endDate } = quarterRange(this.year(), this.q());
    return `${startDate} ~ ${endDate}`;
  }

  changeQuarter(offset: number): void {
    this.flushPendingSaves();
    let q = this.q() + offset;
    let y = this.year();
    if (q > 4) { q = 1; y++; }
    else if (q < 1) { q = 4; y--; }
    this.q.set(q);
    this.year.set(y);
    this.load();
  }

  async load(): Promise<void> {
    this.isLoading.set(true);
    this.rows.set([]);
    this.saveState.set('');
    try {
      const { endDate } = quarterRange(this.year(), this.q());
      await this.patientStore.fetchPatientsIfNeeded();
      const records = await fetchQuarterRecords(this.quarter());

      const hdrxByPatient = new Map<string, any>();
      for (const r of records) {
        if (r.data && (r.data as any).hdrx) hdrxByPatient.set(r.patientId, (r.data as any).hdrx);
      }

      const patients = (this.patientStore.allPatients() as any[]).filter(
        (p) =>
          p.status === 'opd' && !p.isDeleted &&
          (p.patientCategory == null || p.patientCategory === 'opd_regular'),
      );

      const built: HdrxRow[] = patients.map((p) => {
        const { values: prefill, akName, warnings } = buildHdrxPrefill(p, endDate);
        const saved = hdrxByPatient.get(p.id) || {};
        const overrideValues: Record<string, string> = { ...(saved.values || {}) };
        return {
          patientId: p.id,
          name: p.name || '',
          medicalRecordNumber: p.medicalRecordNumber || '',
          idNumber: p.idNumber || '',
          akName,
          warnings,
          excluded: !!saved.excluded,
          prefill,
          overrideValues,
          values: { ...prefill, ...overrideValues },
        };
      });

      built.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh-Hant'));
      this.rows.set(built);
    } catch (error) {
      console.error('載入 HD處方季度資料失敗:', error);
      alert('載入 HD處方季度資料失敗，請稍後再試。');
    } finally {
      this.isLoading.set(false);
    }
  }

  warningCount(): number {
    return this.rows().filter((r) => !r.excluded && r.warnings.length > 0).length;
  }

  onCellChange(row: HdrxRow, key: string, value: string): void {
    const v = String(value ?? '');
    row.values[key] = v;
    if (v === (row.prefill[key] ?? '')) delete row.overrideValues[key];
    else row.overrideValues[key] = v;
    this.scheduleSave(row.patientId);
  }

  onExcludedChange(row: HdrxRow, checked: boolean): void {
    row.excluded = checked;
    this.scheduleSave(row.patientId);
  }

  private scheduleSave(patientId: string): void {
    this.pendingSaves.add(patientId);
    this.saveState.set('saving');
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.doSave(), 800);
  }

  private async doSave(): Promise<void> {
    const ids = [...this.pendingSaves];
    this.pendingSaves.clear();
    const byId = new Map(this.rows().map((r) => [r.patientId, r]));
    try {
      for (const pid of ids) {
        const row = byId.get(pid);
        if (!row) continue;
        await saveQuarterRecord(this.quarter(), pid, {
          hdrx: { excluded: row.excluded, values: row.overrideValues },
        } as any);
      }
      this.saveState.set('saved');
    } catch (error) {
      console.error('儲存 HD處方覆寫失敗:', error);
      ids.forEach((id) => this.pendingSaves.add(id));
      this.saveState.set('error');
    }
  }

  private flushPendingSaves(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.pendingSaves.size) void this.doSave();
  }

  exportCsv(): void {
    const rows = this.rows().filter((r) => !r.excluded);
    if (!rows.length) { alert('沒有可匯出的病人（全部已排除）。'); return; }
    const missingId = rows.filter((r) => !r.idNumber).length;
    if (missingId > 0 && !confirm(`有 ${missingId} 位病人缺身份證號（病人管理未填），匯出後需人工補上。仍要匯出？`)) {
      return;
    }
    const missingAk = rows.filter((r) => !r.values['dialyzerCode']).length;
    if (missingAk > 0 && !confirm(`有 ${missingAk} 位病人「透析器型號代碼」未填，仍要匯出？`)) {
      return;
    }
    const exportRows: HdrxExportRow[] = rows
      .slice()
      .sort((a, b) => a.medicalRecordNumber.localeCompare(b.medicalRecordNumber))
      .map((r) => ({
        idNumber: r.idNumber,
        medicalRecordNumber: r.medicalRecordNumber,
        values: r.values,
      }));
    try {
      downloadHdrxCsv(exportRows);
    } catch (error) {
      console.error('匯出失敗:', error);
      alert('匯出失敗，請稍後再試。');
    }
  }

  trackByPatient(_i: number, row: HdrxRow): string {
    return row.patientId;
  }

  readonly fieldKeys = HDRX_FIELD_KEYS;
}
