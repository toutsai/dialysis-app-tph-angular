import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { PatientStoreService } from '@services/patient-store.service';
import { AuthService } from '@services/auth.service';
import { localApi } from '@/services/localApiClient';
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
  /** 照護清單主護姓名；空＝未分配 */
  nurseName: string;
  akName: string;
  /** 採用的醫囑歷史異動日（YYYY-MM-DD）；空＝季末前無歷史採病人檔現行醫囑 */
  orderDate: string;
  /** 常規病人目前非門診時的狀態註記（住院/急診） */
  statusNote: string;
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
  private readonly authService = inject(AuthService);
  private readonly route = inject(ActivatedRoute);

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
  /** 護理師篩選：''=全部、'__none__'=未分配、其餘=主護姓名（預設帶入登入者自己，方便補缺漏） */
  readonly nurseFilter = signal<string>('');
  readonly nurseNames = signal<string[]>([]);
  readonly visibleRows = computed(() => {
    const f = this.nurseFilter();
    const all = this.rows();
    if (!f) return all;
    if (f === '__none__') return all.filter((r) => !r.nurseName);
    return all.filter((r) => r.nurseName === f);
  });

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
      const [records, historyAll, care] = await Promise.all([
        fetchQuarterRecords(this.quarter()),
        // 醫囑歷史（created_at DESC）：處方可能上月/上上月開立，逐病人取「異動日 ≤ 季末」最新一筆
        localApi.get('/orders/history'),
        localApi.get('/nursing/patient-care'),
      ]);

      // 照護清單：patientId → 主護姓名（排除名單者不列入，同主護反查慣例）
      const excludedNurses = new Set<string>((care as any)?.excludedNurseIds || []);
      const nurseByPatient = new Map<string, string>();
      const assignments: { nurseId: string; nurseName: string }[] = [];
      for (const a of ((care as any)?.assignments || []) as any[]) {
        if (excludedNurses.has(a.nurseId)) continue;
        const nm = String(a.nurseName || '').trim();
        if (!nm) continue;
        assignments.push({ nurseId: String(a.nurseId || ''), nurseName: nm });
        for (const pid of a.patientIds || []) nurseByPatient.set(pid, nm);
      }
      this.nurseNames.set(assignments.map((a) => a.nurseName));

      // 預設篩選（僅首次載入）：優先用「我的病人」帶來的檢視對象（?nurse=uid&nurseName=），
      // 其次比對登入者本人（uid 先、姓名 fallback，同主護反查慣例）；都對不上維持全部
      if (!this.nurseFilter()) {
        const qp = this.route.snapshot.queryParamMap;
        const qpNurse = qp.get('nurse') || '';
        const qpNurseName = String(qp.get('nurseName') || '').trim();
        const cu = this.authService.currentUser();
        const myName = String(cu?.name || '').trim();
        const target =
          assignments.find((a) => (qpNurse && a.nurseId === qpNurse) || (qpNurseName && a.nurseName === qpNurseName)) ||
          assignments.find((a) => a.nurseId === cu?.uid || a.nurseId === (cu as any)?.id || (myName && a.nurseName === myName));
        if (target) this.nurseFilter.set(target.nurseName);
      }

      const hdrxByPatient = new Map<string, any>();
      for (const r of records) {
        if (r.data && (r.data as any).hdrx) hdrxByPatient.set(r.patientId, (r.data as any).hdrx);
      }

      // 逐病人挑季末前最新一筆醫囑歷史（清單已依 created_at DESC，取第一筆符合者）
      const latestOrderByPatient = new Map<string, { orders: any; date: string }>();
      for (const h of Array.isArray(historyAll) ? historyAll : []) {
        if (!h?.patientId || latestOrderByPatient.has(h.patientId)) continue;
        const d = String(h.createdAt || '').slice(0, 10);
        if (d && d <= endDate) {
          latestOrderByPatient.set(h.patientId, { orders: h.orders || {}, date: d });
        }
      }

      // 名單＝常規病人（含目前住院/急診中的常規病人：季度申報仍應列入，以狀態欄註記）
      const statusNoteMap: Record<string, string> = { ipd: '住院', er: '急診' };
      const patients = (this.patientStore.allPatients() as any[]).filter(
        (p) => !p.isDeleted && (p.patientCategory == null || p.patientCategory === 'opd_regular'),
      );

      const built: HdrxRow[] = patients.map((p) => {
        const hist = latestOrderByPatient.get(p.id);
        const { values: prefill, akName, warnings } = buildHdrxPrefill(p, endDate, hist?.orders);
        if (!hist) warnings.push('季末前無醫囑歷史，採病人檔現行醫囑');
        const saved = hdrxByPatient.get(p.id) || {};
        const overrideValues: Record<string, string> = { ...(saved.values || {}) };
        return {
          patientId: p.id,
          name: p.name || '',
          medicalRecordNumber: p.medicalRecordNumber || '',
          idNumber: p.idNumber || '',
          nurseName: nurseByPatient.get(p.id) || '',
          akName,
          orderDate: hist?.date || '',
          statusNote: statusNoteMap[p.status] || '',
          warnings,
          excluded: !!saved.excluded,
          prefill,
          overrideValues,
          values: { ...prefill, ...overrideValues },
        };
      });

      // 依主護分組排序（未分配排最後），組內依姓名
      built.sort(
        (a, b) =>
          (a.nurseName ? 0 : 1) - (b.nurseName ? 0 : 1) ||
          a.nurseName.localeCompare(b.nurseName, 'zh-Hant') ||
          (a.name || '').localeCompare(b.name || '', 'zh-Hant'),
      );
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
