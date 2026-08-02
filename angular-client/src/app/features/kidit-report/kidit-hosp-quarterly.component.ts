import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PatientStoreService } from '@services/patient-store.service';
import { localApi } from '@/services/localApiClient';
import { quarterRange, currentQuarter } from '@/services/kiditVascularCsvService';
import { fetchQuarterRecords, saveQuarterRecord } from '@/services/kiditQuarterInputService';
import { HospEpisodeOverride, HospExportRow, downloadHospCsv } from '@/services/kiditHospService';
import {
  HOSP_CATEGORY_CODES,
  HOSP_SUBCATEGORY_CODES,
  subcodesForCategory,
} from '@app/core/constants/hosp-reason-codes';

/** 與 kiditSync.js 的 KIDIT_EXCLUDED_MOVEMENT_TYPES 對齊（更改模式/勿動不申報） */
const EXCLUDED_TYPES = new Set(['更改模式', '勿動']);

interface QuarterMovement {
  date: string;
  type: string;
  detail: string;
  admissionDate: string;
  dischargeDate: string;
}

interface HospRow {
  patientId: string;
  episodeKey: string;
  name: string;
  medicalRecordNumber: string;
  idNumber: string;
  /** 病程備註鏈（判讀住院原因用） */
  chain: string;
  /** 動態配對出的原始日期（覆寫前） */
  autoAdmit: string;
  autoDischarge: string;
  admitDate: string;
  dischargeDate: string;
  cat: string;
  sub: string;
  excluded: boolean;
}

/**
 * 住出院季度工作檯（工作站「住出院」頁籤內嵌）：
 * 由季度內工作日誌病人動態自動配對住院/出院日期（切段邏輯同季度病人動態），
 * 專師補住院原因大類/細類後匯出官方 CSV。
 * 人工欄存 kidit_quarter_records.data.hosp = { [episodeKey]: override }（頂層鍵淺合併）。
 */
@Component({
  selector: 'app-kidit-hosp-quarterly',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './kidit-hosp-quarterly.component.html',
  styleUrl: './kidit-hosp-quarterly.component.css',
})
export class KiditHospQuarterlyComponent implements OnInit, OnDestroy {
  private readonly patientStore = inject(PatientStoreService);

  readonly categoryCodes = HOSP_CATEGORY_CODES;

  readonly year = signal(currentQuarter().year);
  readonly q = signal(currentQuarter().q);
  readonly quarter = computed(() => `${this.year()}Q${this.q()}`);
  readonly isLoading = signal(false);
  readonly rows = signal<HospRow[]>([]);
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

  subOptions(cat: string) {
    return subcodesForCategory(cat);
  }

  subLabel(code: string): string {
    return HOSP_SUBCATEGORY_CODES.find((s) => s.code === code)?.label || '';
  }

  async load(): Promise<void> {
    this.isLoading.set(true);
    this.rows.set([]);
    this.saveState.set('');
    try {
      const { startDate, endDate } = quarterRange(this.year(), this.q());
      await this.patientStore.fetchPatientsIfNeeded();
      const [logsRes, records] = await Promise.all([
        localApi.get(`/nursing/daily-logs?startDate=${startDate}&endDate=${endDate}`),
        fetchQuarterRecords(this.quarter()),
      ]);
      const logs: any[] = Array.isArray(logsRes) ? logsRes : (logsRes?.data || []);

      const hospByPatient = new Map<string, Record<string, HospEpisodeOverride>>();
      for (const r of records) {
        const hosp = (r.data as any)?.hosp;
        if (hosp && typeof hosp === 'object') hospByPatient.set(r.patientId, hosp);
      }

      // 病人動態分組（納入條件同 kiditSync/季度動態）
      const byPatient = new Map<string, { name: string; mrn: string; movements: QuarterMovement[] }>();
      for (const log of logs) {
        if (!log?.date || log.date < startDate || log.date > endDate) continue;
        for (const m of log.patientMovements || []) {
          if (!m || EXCLUDED_TYPES.has(m.type) || !m.patientId || !m.name) continue;
          const entry = byPatient.get(m.patientId) || { name: m.name, mrn: m.medicalRecordNumber || '', movements: [] };
          entry.name = m.name || entry.name;
          entry.mrn = m.medicalRecordNumber || entry.mrn;
          entry.movements.push({
            date: log.date,
            type: m.type || '動態',
            detail: (m.remarks || m.reason || '').trim(),
            admissionDate: (m.admissionDate || '').slice(0, 10),
            dischargeDate: (m.dischargeDate || '').slice(0, 10),
          });
          byPatient.set(m.patientId, entry);
        }
      }

      const patientMap = this.patientStore.patientMap();
      const built: HospRow[] = [];
      for (const [patientId, entry] of byPatient) {
        entry.movements.sort((a, b) => a.date.localeCompare(b.date));
        const overrides = hospByPatient.get(patientId) || {};
        for (const episode of this.splitEpisodes(entry.movements)) {
          const autoAdmit = episode.find((m) => m.admissionDate)?.admissionDate || '';
          const autoDischarge = [...episode].reverse().find((m) => m.dischargeDate)?.dischargeDate || '';
          // 沒有任何住院/出院日期的段落（純門診動態）不屬住出院申報
          if (!autoAdmit && !autoDischarge) continue;
          const episodeKey = autoAdmit || episode[0].date;
          const ov = overrides[episodeKey] || {};
          const p: any = patientMap.get(patientId);
          built.push({
            patientId,
            episodeKey,
            name: entry.name,
            medicalRecordNumber: entry.mrn || p?.medicalRecordNumber || '',
            idNumber: p?.idNumber || '',
            chain: episode.map((m) => `${this.toMd(m.date)} ${m.type}${m.detail ? '：' + m.detail : ''}`).join(' → '),
            autoAdmit,
            autoDischarge,
            admitDate: ov.admitDate ?? autoAdmit,
            dischargeDate: ov.dischargeDate ?? autoDischarge,
            cat: ov.cat || '',
            sub: ov.sub || '',
            excluded: !!ov.excluded,
          });
        }
      }

      built.sort(
        (a, b) => (a.admitDate || a.episodeKey).localeCompare(b.admitDate || b.episodeKey) ||
          a.name.localeCompare(b.name, 'zh-Hant'),
      );
      this.rows.set(built);
    } catch (error) {
      console.error('載入住出院季度資料失敗:', error);
      alert('載入住出院季度資料失敗，請稍後再試。');
    } finally {
      this.isLoading.set(false);
    }
  }

  /** 依住院/出院切段（同季度病人動態）：遇帶住院日的動態且目前段已有住院或已出院 → 收段開新段 */
  private splitEpisodes(movements: QuarterMovement[]): QuarterMovement[][] {
    const episodes: QuarterMovement[][] = [];
    let current: QuarterMovement[] = [];
    let hasAdmission = false;
    let discharged = false;
    for (const m of movements) {
      if (m.admissionDate && current.length > 0 && (hasAdmission || discharged)) {
        episodes.push(current);
        current = [];
        hasAdmission = false;
        discharged = false;
      }
      current.push(m);
      if (m.admissionDate) hasAdmission = true;
      if (m.dischargeDate) discharged = true;
    }
    if (current.length > 0) episodes.push(current);
    return episodes;
  }

  private toMd(dateStr: string): string {
    if (!dateStr || dateStr.length < 10) return '';
    return `${Number(dateStr.slice(5, 7))}/${Number(dateStr.slice(8, 10))}`;
  }

  missingReasonCount(): number {
    return this.rows().filter((r) => !r.excluded && (!r.cat || !r.sub)).length;
  }

  onFieldChange(row: HospRow, key: 'admitDate' | 'dischargeDate' | 'cat' | 'sub', value: string): void {
    (row as any)[key] = String(value ?? '');
    // 換大類時清掉不相符的細類
    if (key === 'cat' && row.sub && !row.sub.startsWith(row.cat + '-')) row.sub = '';
    this.scheduleSave(row.patientId);
  }

  onExcludedChange(row: HospRow, checked: boolean): void {
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
    try {
      for (const pid of ids) {
        // 該病人全部段落的人工欄整包存（只存與自動配對不同的日期＋原因碼＋排除）
        const hosp: Record<string, HospEpisodeOverride> = {};
        for (const r of this.rows()) {
          if (r.patientId !== pid) continue;
          const ov: HospEpisodeOverride = {};
          if (r.admitDate !== r.autoAdmit) ov.admitDate = r.admitDate;
          if (r.dischargeDate !== r.autoDischarge) ov.dischargeDate = r.dischargeDate;
          if (r.cat) ov.cat = r.cat;
          if (r.sub) ov.sub = r.sub;
          if (r.excluded) ov.excluded = true;
          if (Object.keys(ov).length) hosp[r.episodeKey] = ov;
        }
        await saveQuarterRecord(this.quarter(), pid, { hosp } as any);
      }
      this.saveState.set('saved');
    } catch (error) {
      console.error('儲存住出院資料失敗:', error);
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
    if (!rows.length) { alert('本季沒有可匯出的住出院紀錄。'); return; }
    const missingReason = rows.filter((r) => !r.cat || !r.sub).length;
    if (missingReason > 0 && !confirm(`有 ${missingReason} 段住院尚未填住院原因（大類/細類），仍要匯出？`)) {
      return;
    }
    const missingAdmit = rows.filter((r) => !r.admitDate).length;
    if (missingAdmit > 0 && !confirm(`有 ${missingAdmit} 段缺住院日期（只有出院動態），仍要匯出？`)) {
      return;
    }
    const missingId = rows.filter((r) => !r.idNumber).length;
    if (missingId > 0 && !confirm(`有 ${missingId} 位病人缺身份證號（病人管理未填），匯出後需人工補上。仍要匯出？`)) {
      return;
    }
    const { startDate, endDate } = quarterRange(this.year(), this.q());
    const exportRows: HospExportRow[] = rows.map((r) => ({
      idNumber: r.idNumber,
      medicalRecordNumber: r.medicalRecordNumber,
      admitDate: r.admitDate,
      dischargeDate: r.dischargeDate,
      cat: r.cat,
      sub: r.sub,
    }));
    try {
      downloadHospCsv(exportRows, startDate, endDate);
    } catch (error) {
      console.error('匯出失敗:', error);
      alert('匯出失敗，請稍後再試。');
    }
  }

  trackByEpisode(_i: number, row: HospRow): string {
    return `${row.patientId}_${row.episodeKey}`;
  }
}
