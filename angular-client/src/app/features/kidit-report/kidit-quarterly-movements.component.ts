// 季度病人動態彙整（KiDit 申報工作站）
// 對應手動「病患異動狀態表」月表：把季度內工作日誌的病人動態按病人分組、
// 依住院/出院切成一列一段住院歷程，並自動串出病程備註鏈（如「5/21 首透 → 6/3 刪除：家屬拒HD」）。
// 三區＝本院常規HD／新病患／外院（歸類規則見 core/utils/kidit-patient-groups.ts）。
// 先只做畫面查閱不做匯出（2026-07-26 使用者拍板）。
import { Component, EventEmitter, OnInit, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { localApi } from '@/services/localApiClient';
import { PatientStoreService } from '@services/patient-store.service';
import {
  KIDIT_GROUP_LABELS,
  KIDIT_GROUP_ORDER,
  KiditPatientGroup,
  classifyKiditPatient,
  externalHospitalName,
} from '@/app/core/utils/kidit-patient-groups';

/** 與 kiditSync.js 的 KIDIT_EXCLUDED_MOVEMENT_TYPES 對齊（更改模式/勿動不申報） */
const EXCLUDED_TYPES = new Set(['更改模式', '勿動']);

interface QuarterMovement {
  date: string;
  type: string;
  detail: string;
  physician: string;
  admissionDate: string;
  dischargeDate: string;
  isRegistered: boolean;
  /** 刪除動態的刪除原因（獨立欄顯示；病程鏈內不再重複） */
  deleteReason: string;
}

interface EpisodeRow {
  patientId: string;
  name: string;
  medicalRecordNumber: string;
  /** 外院區：原透析院所 */
  hospital: string;
  admission: string;
  discharge: string;
  physician: string;
  /** 病程備註鏈 */
  chain: string;
  /** 刪除原因（該段歷程內刪除動態的原因，多筆以「、」併） */
  deleteReason: string;
  registeredDone: number;
  registeredTotal: number;
}

interface GroupBlock {
  key: KiditPatientGroup;
  label: string;
  rows: EpisodeRow[];
}

@Component({
  selector: 'app-kidit-quarterly-movements',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './kidit-quarterly-movements.component.html',
  styleUrl: './kidit-quarterly-movements.component.css',
})
export class KiditQuarterlyMovementsComponent implements OnInit {
  @Output() closeEvent = new EventEmitter<void>();

  private readonly patientStore = inject(PatientStoreService);

  readonly year = signal(new Date().getFullYear());
  readonly q = signal(Math.floor(new Date().getMonth() / 3) + 1);
  readonly isLoading = signal(false);
  readonly groups = signal<GroupBlock[]>([]);
  readonly loadError = signal('');
  /** 三區改頁籤（2026-08-22 使用者要求，免一直往下捲）；載入後自動停在第一個有資料的區 */
  readonly activeGroup = signal<KiditPatientGroup>('regular');
  readonly activeBlock = computed(() => this.groups().find((g) => g.key === this.activeGroup()) ?? null);

  readonly totalRows = computed(() => this.groups().reduce((sum, g) => sum + g.rows.length, 0));

  readonly groupLabels = KIDIT_GROUP_LABELS;

  readonly quarterRangeLabel = computed(() => {
    const { start, end } = this.quarterRange();
    return `${start} ~ ${end}`;
  });

  ngOnInit(): void {
    this.load();
  }

  close(): void {
    this.closeEvent.emit();
  }

  changeQuarter(offset: number): void {
    let q = this.q() + offset;
    let y = this.year();
    if (q > 4) { q = 1; y++; }
    else if (q < 1) { q = 4; y--; }
    this.q.set(q);
    this.year.set(y);
    this.load();
  }

  private quarterRange(): { start: string; end: string } {
    const y = this.year();
    const q = this.q();
    const startMonth = (q - 1) * 3 + 1;
    const endMonth = startMonth + 2;
    const lastDay = new Date(y, endMonth, 0).getDate();
    return {
      start: `${y}-${String(startMonth).padStart(2, '0')}-01`,
      end: `${y}-${String(endMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
    };
  }

  async load(): Promise<void> {
    this.isLoading.set(true);
    this.loadError.set('');
    this.groups.set([]);
    const { start, end } = this.quarterRange();
    try {
      await this.patientStore.fetchPatientsIfNeeded();
      const [logsRes, kiditRes] = await Promise.all([
        localApi.get(`/nursing/daily-logs?startDate=${start}&endDate=${end}`),
        localApi.get(`/nursing/kidit-logbook?startDate=${start}&endDate=${end}`),
      ]);
      const logs: any[] = Array.isArray(logsRes) ? logsRes : (logsRes?.data || []);
      const kiditLogs: any[] = Array.isArray(kiditRes) ? kiditRes : (kiditRes?.data || []);
      const groups = this.buildGroups(logs, kiditLogs, start, end);
      this.groups.set(groups);
      // 目前頁籤若無資料，跳到第一個有資料的區（全空則留在原頁籤）
      if (!groups.find((g) => g.key === this.activeGroup())?.rows.length) {
        const firstNonEmpty = groups.find((g) => g.rows.length > 0);
        if (firstNonEmpty) this.activeGroup.set(firstNonEmpty.key);
      }
    } catch (e) {
      console.error('載入季度病人動態失敗:', e);
      this.loadError.set('載入季度病人動態失敗，請稍後再試。');
    } finally {
      this.isLoading.set(false);
    }
  }

  /** KiDit 登錄勾 join key＝kiditSync 的事件 id 規則 move_<date>_<movementId> */
  private buildRegisteredMap(kiditLogs: any[]): Map<string, boolean> {
    const map = new Map<string, boolean>();
    for (const log of kiditLogs) {
      for (const ev of log?.events || []) {
        if (ev?.id) map.set(ev.id, !!ev.isRegistered);
      }
    }
    return map;
  }

  private buildGroups(logs: any[], kiditLogs: any[], start: string, end: string): GroupBlock[] {
    const registeredMap = this.buildRegisteredMap(kiditLogs);
    const byPatient = new Map<string, { name: string; mrn: string; movements: QuarterMovement[] }>();

    for (const log of logs) {
      if (!log?.date || log.date < start || log.date > end) continue;
      for (const m of log.patientMovements || []) {
        // 與 kiditSync 相同的納入條件：排除不申報類型、必須有病人身分
        if (!m || EXCLUDED_TYPES.has(m.type) || !m.patientId || !m.name) continue;
        const kiditId = `move_${log.date}_${m.id}`;
        const entry = byPatient.get(m.patientId) || { name: m.name, mrn: m.medicalRecordNumber || '', movements: [] };
        entry.name = m.name || entry.name;
        entry.mrn = m.medicalRecordNumber || entry.mrn;
        const { detail, deleteReason } = this.splitDeleteReason(m);
        entry.movements.push({
          date: log.date,
          type: m.type || '動態',
          detail,
          physician: (m.physician || '').trim(),
          admissionDate: (m.admissionDate || '').slice(0, 10),
          dischargeDate: (m.dischargeDate || '').slice(0, 10),
          isRegistered: registeredMap.get(kiditId) === true,
          deleteReason,
        });
        byPatient.set(m.patientId, entry);
      }
    }

    const patientMap = this.patientStore.patientMap();
    const buckets: Record<KiditPatientGroup, EpisodeRow[]> = { regular: [], newPatient: [], external: [] };

    for (const [patientId, entry] of byPatient) {
      entry.movements.sort((a, b) => a.date.localeCompare(b.date));
      const patient = patientMap.get(patientId);
      const group = classifyKiditPatient(patient);
      const hospital = group === 'external' ? externalHospitalName(patient) : '';
      for (const episode of this.splitEpisodes(entry.movements)) {
        buckets[group].push(this.buildRow(patientId, entry, episode, hospital));
      }
    }

    for (const key of KIDIT_GROUP_ORDER) {
      buckets[key].sort((a, b) => (a.admission || a.chain).localeCompare(b.admission || b.chain) || a.name.localeCompare(b.name, 'zh-Hant'));
    }
    // 三區固定都回傳（含空區）：頁籤位置穩定、空區頁籤顯示 0
    return KIDIT_GROUP_ORDER.map((key) => ({ key, label: KIDIT_GROUP_LABELS[key], rows: buckets[key] }));
  }

  /**
   * 刪除動態的原因獨立成欄（2026-08-22 使用者要求）：
   * 後端刪除動態 remarks＝「從「門診」刪除；原因：xxx」、reason＝xxx（patients.js addMovementToDailyLog）。
   * 病程鏈只留「從「門診」刪除」，原因放「刪除原因」欄。
   * ⚠️ 刪除動態的判定＝type 含「刪除」**或** remarks 含「刪除」：護理師編輯過的刪除動態 type 會變成「手動」
   *   （實測 Q2-Q3 有 30+ 筆「手動／刪除排程／轉常規門診」但備註仍是「從「住院」刪除；原因：轉外院透析」），
   *   只認 type 會漏掉一大半（2026-08-22 使用者回報）。
   * 原因取值：優先 remarks「原因：」後段（最可靠，手動編輯後 reason 欄可能是護理師另外打的備註），其次 reason 欄。
   * 非刪除動態維持原樣（remarks || reason）。
   */
  private splitDeleteReason(m: any): { detail: string; deleteReason: string } {
    const remarks = String(m.remarks || '').trim();
    const reason = String(m.reason || '').trim();
    const isDelete = String(m.type || '').includes('刪除') || remarks.includes('刪除');
    if (!isDelete) return { detail: remarks || reason, deleteReason: '' };
    const match = /[；;]?\s*原因[:：]\s*([\s\S]*)$/.exec(remarks);
    const deleteReason = (match ? match[1].trim() : '') || reason;
    const detail = match ? remarks.slice(0, match.index).trim() : remarks;
    return { detail, deleteReason };
  }

  /**
   * 依住院/出院把同一病人的季度動態切段（手動月表一列＝一段住院歷程）。
   * ⚠️ 只有「前段已結束」（出現出院日，或刪除/轉回門診等結束訊號）後再遇到帶住院日的動態，
   * 才收段開新段。舊規則「目前段已有住院日就開新段」會把同一次住院拆成多列——
   * 因為轉移/手動/臨時加洗每筆動態都各自帶當次住院日（2026-08-04 修正：Q3 實測 157 列 → 104 列，
   * 剩餘多列者皆為真實多段歷程）。
   */
  private splitEpisodes(movements: QuarterMovement[]): QuarterMovement[][] {
    const episodes: QuarterMovement[][] = [];
    let current: QuarterMovement[] = [];
    let ended = false;
    for (const m of movements) {
      if (m.admissionDate && current.length > 0 && ended) {
        episodes.push(current);
        current = [];
        ended = false;
      }
      current.push(m);
      // 段落結束訊號：出院日、刪除、轉回門診（其後再出現住院日才是新一段歷程）
      if (m.dischargeDate) ended = true;
      const text = `${m.type || ''}${m.detail || ''}`;
      if (text.includes('刪除') || text.includes('轉回門診')) ended = true;
    }
    if (current.length > 0) episodes.push(current);
    return episodes;
  }

  private buildRow(
    patientId: string,
    entry: { name: string; mrn: string },
    episode: QuarterMovement[],
    hospital: string,
  ): EpisodeRow {
    const admission = episode.find((m) => m.admissionDate)?.admissionDate || '';
    const discharge = [...episode].reverse().find((m) => m.dischargeDate)?.dischargeDate || '';
    const physician = [...episode].reverse().find((m) => m.physician)?.physician || '';
    const chain = episode
      .map((m) => `${this.toMd(m.date)} ${m.type}${m.detail ? '：' + m.detail : ''}`)
      .join(' → ');
    const deleteReason = [...new Set(episode.map((m) => m.deleteReason).filter(Boolean))].join('、');
    return {
      patientId,
      name: entry.name,
      medicalRecordNumber: entry.mrn,
      hospital,
      admission: this.toMd(admission),
      discharge: this.toMd(discharge),
      physician,
      chain,
      deleteReason,
      registeredDone: episode.filter((m) => m.isRegistered).length,
      registeredTotal: episode.length,
    };
  }

  /** YYYY-MM-DD → M/D（空值回空字串） */
  private toMd(dateStr: string): string {
    if (!dateStr || dateStr.length < 10) return '';
    return `${Number(dateStr.slice(5, 7))}/${Number(dateStr.slice(8, 10))}`;
  }

  trackByRow(index: number, row: EpisodeRow): string {
    return `${row.patientId}_${index}`;
  }

  trackByGroup(_index: number, group: GroupBlock): string {
    return group.key;
  }
}
