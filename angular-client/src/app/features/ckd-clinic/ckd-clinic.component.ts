import { Component, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  CkdApiService,
  CkdReportKind,
  CkdSettings,
  CkdSourceSummary,
  CkdStatus,
  CkdUploadBatch,
  CkdUploadResult,
} from '@app/core/services/ckd-api.service';
import { CkdDailyComponent } from './ckd-daily/ckd-daily.component';
import { CkdAuditComponent } from './ckd-audit/ckd-audit.component';
import { CkdWideComponent } from './ckd-wide/ckd-wide.component';

/** 頁內檢視：daily = 明日追蹤／收案評估／個案紀錄；audit = 全名單稽核；wide = 檢驗總表；import = 匯入與設定 */
type CkdView = 'daily' | 'audit' | 'wide' | 'import';

/** 上傳卡片：四種 HIS 報表（順序＝個管師匯入順序） */
interface UploadCard {
  kind: CkdReportKind;
  title: string;
  hint: string;
  required: boolean;
}
const UPLOAD_CARDS: UploadCard[] = [
  { kind: 'case', title: '追蹤清冊（收案登錄簿）', hint: '每次匯出都是全表現況：同一人的舊列整批換成新列', required: true },
  { kind: 'lab', title: '0204 檢驗結果病患明細', hint: '每日／每三日匯出後直接上傳即累積（同人同日取聯集）；首次長區間大檔請聯絡管理員命令列匯入', required: true },
  { kind: 'clinic', title: 'CKD-病患清單查詢', hint: '看診日期＋腎臟內科＋主治醫師；請涵蓋未來數週的預約掛號，自帶 ACR／PCR／eGFR 一併採計', required: true },
  { kind: 'bill', title: '醫令明細清單（P 碼申報）', hint: '入帳對帳用：漏帳、間隔異常、年度上限；未匯入時回到推估模式', required: false },
];

/** 單一檔案的上傳進度／結果 */
interface UploadItem {
  name: string;
  size: number;
  state: 'queued' | 'uploading' | 'done' | 'dup' | 'error';
  result?: CkdUploadResult;
  message?: string;
}

const NUMERIC_SETTING_KEYS = ['preGap', 'earlyNew', 'earlyGap', 'dmGap', 'over', 'labWin', 'recallGrace', 'alertWin', 'rrtEgfr'] as const;

/**
 * 門診 CKD 收案追蹤（Angular 重寫版）
 * 階段 0：骨架＋狀態；階段 1（2026-09-15）：匯入與設定（四種報表上傳、批次紀錄、判定參數）。
 * 功能邏輯照「CKD 收案追蹤工作台·部北版」單機版；計畫見 docs/2026-09-15-ckd-clinic-tab-plan.md。
 */
@Component({
  selector: 'app-ckd-clinic',
  standalone: true,
  imports: [CommonModule, FormsModule, CkdDailyComponent, CkdAuditComponent, CkdWideComponent],
  templateUrl: './ckd-clinic.component.html',
  styleUrl: './ckd-clinic.component.css',
})
export class CkdClinicComponent implements OnInit {
  private readonly ckdApi = inject(CkdApiService);
  @ViewChild(CkdDailyComponent) daily?: CkdDailyComponent;

  readonly view = signal<CkdView>('daily');

  /** 稽核／總表的姓名連結 → 切到主線檢視並跳到該病人的個案紀錄（原版 gotoRecords 跨區） */
  goRecords(mrn: string): void {
    this.view.set('daily');
    const tryOpen = (n: number) => {
      if (this.daily) { this.daily.openRecords(mrn); return; }
      if (n > 0) setTimeout(() => tryOpen(n - 1), 100);
    };
    setTimeout(() => tryOpen(20), 0);
  }
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly status = signal<CkdStatus | null>(null);
  readonly showPhases = signal(false);

  // ---------- 匯入 ----------
  readonly cards = UPLOAD_CARDS;
  readonly uploads = signal<UploadItem[]>([]);
  readonly uploading = signal(false);
  readonly dragOver = signal<CkdReportKind | 'all' | null>(null);
  readonly batches = signal<CkdUploadBatch[]>([]);
  readonly showAllBatches = signal(false);

  // ---------- 判定參數 ----------
  readonly settingsForm = signal<CkdSettings | null>(null);
  readonly settingsDefaults = signal<CkdSettings | null>(null);
  readonly savingSettings = signal(false);
  readonly settingsSaved = signal(false);
  readonly settingLabels: { key: keyof CkdSettings; label: string; unit?: string; hint: string }[] = [
    { key: 'preGap', label: 'Pre-ESRD 追蹤間隔', unit: '天', hint: 'P3403C 兩次追蹤至少間隔（健保 3 個月放寬 ≥77 天）' },
    { key: 'earlyNew', label: 'Early-CKD 新收案→首次追蹤', unit: '天', hint: 'P4301C 之後第一次 P4302C 的最小間隔' },
    { key: 'earlyGap', label: 'Early-CKD 追蹤間隔', unit: '天', hint: 'P4302C 之後每次 6 個月放寬 ≥161 天' },
    { key: 'dmGap', label: 'DKD 追蹤間隔', unit: '天', hint: 'P7001C 糖尿病腎病變追蹤間隔' },
    { key: 'over', label: '逾期門檻', unit: '天', hint: '到期後超過此天數列為逾期' },
    { key: 'labWin', label: '檢驗回溯視窗', unit: '±天', hint: '判定缺項時往前回溯多少天的檢驗' },
    { key: 'dept', label: '門診科別', hint: '門診清單科別篩選；部北全院名單以此挑腎臟內科診' },
    { key: 'recallGrace', label: '召回寬限', unit: '天', hint: '追蹤到期後幾天內不列入召回待聯絡' },
    { key: 'alertWin', label: '異常檢驗掃描', unit: '天', hint: '近日異常檢驗往回看幾天' },
    { key: 'rrtEgfr', label: '透析準備 eGFR 門檻', hint: 'eGFR 低於此值的已收案者進入透析準備管線' },
  ];

  readonly sourceList = computed<CkdSourceSummary[]>(() => {
    const s = this.status()?.sources;
    return s ? UPLOAD_CARDS.map((c) => s[c.kind]) : [];
  });
  readonly uploadMaxMb = computed(() => Math.round((this.status()?.uploadMaxBytes || 8 * 1024 * 1024) / 1048576));
  readonly settingsDirty = computed(() => {
    const f = this.settingsForm(), s = this.status()?.settings;
    return !!f && !!s && JSON.stringify(f) !== JSON.stringify(s);
  });

  ngOnInit(): void {
    this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const st = await this.ckdApi.getStatus();
      this.status.set(st);
      this.batches.set(st.batches);
      this.settingsForm.set({ ...st.settings });
      if (!this.settingsDefaults()) {
        const s = await this.ckdApi.getSettings();
        this.settingsDefaults.set(s.defaults);
      }
    } catch (e: any) {
      this.error.set(e?.error?.message || e?.message || '載入門診 CKD 收案狀態失敗');
    } finally {
      this.loading.set(false);
    }
  }

  // ---------- 上傳 ----------

  source(kind: CkdReportKind): CkdSourceSummary | null {
    return this.status()?.sources?.[kind] || null;
  }

  onPick(event: Event, kind?: CkdReportKind): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);
    input.value = '';
    if (files.length) void this.uploadFiles(files, kind);
  }

  onDragOver(event: DragEvent, zone: CkdReportKind | 'all'): void {
    event.preventDefault();
    this.dragOver.set(zone);
  }

  onDragLeave(): void {
    this.dragOver.set(null);
  }

  onDrop(event: DragEvent, kind?: CkdReportKind): void {
    event.preventDefault();
    this.dragOver.set(null);
    const files = Array.from(event.dataTransfer?.files || []).filter((f) => /\.(xlsx?|xlsm|csv)$/i.test(f.name));
    if (files.length) void this.uploadFiles(files, kind);
  }

  /** 逐檔上傳（後端一次只解析一個檔）；卡片指定的種類只在標題辨識失敗時作為備援 */
  async uploadFiles(files: File[], forcedKind?: CkdReportKind): Promise<void> {
    const max = this.status()?.uploadMaxBytes || 8 * 1024 * 1024;
    const items: UploadItem[] = files.map((f) => ({ name: f.name, size: f.size, state: 'queued' }));
    this.uploads.set([...items, ...this.uploads()]);
    this.uploading.set(true);
    this.error.set(null);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const item = items[i];
        if (file.size > max) {
          this.patchUpload(item, { state: 'error', message: `超過 ${Math.round(max / 1048576)}MB 上限，請縮短匯出區間或分檔；首次大批匯入請聯絡管理員命令列匯入` });
          continue;
        }
        this.patchUpload(item, { state: 'uploading' });
        try {
          const res = await this.ckdApi.uploadFile(file, forcedKind);
          this.patchUpload(item, { state: res.dup ? 'dup' : 'done', result: res, message: res.dup ? res.message : undefined });
          if (res.sources) {
            const st = this.status();
            if (st) this.status.set({ ...st, sources: res.sources });
          }
        } catch (e: any) {
          this.patchUpload(item, { state: 'error', message: e?.error?.message || e?.message || '上傳失敗' });
        }
      }
    } finally {
      this.uploading.set(false);
      await this.load();
    }
  }

  private patchUpload(item: UploadItem, patch: Partial<UploadItem>): void {
    this.uploads.set(this.uploads().map((u) => (u === item ? Object.assign(u, patch) : u)));
  }

  clearUploads(): void {
    this.uploads.set([]);
  }

  /** 上傳結果摘要（一行） */
  resultLine(u: UploadItem): string {
    const r = u.result;
    if (!r || !r.stats) return u.message || '';
    const s = r.stats;
    const parts = [`${r.kindLabel}：讀到 ${s.rows} 筆／${s.persons} 人`, `新增 ${s.added}`];
    if (s.updated) parts.push(`更新 ${s.updated}`);
    if (s.removed) parts.push(`移除舊列 ${s.removed}`);
    if (s.dup) parts.push(`重複略過 ${s.dup}`);
    if (r.labStats?.added || r.labStats?.updated) parts.push(`附帶檢驗 新增 ${r.labStats.added}、更新 ${r.labStats.updated || 0}`);
    if (r.range?.start) parts.push(`區間 ${r.range.start} ~ ${r.range.end}`);
    return parts.join('・');
  }

  batchLine(b: CkdUploadBatch): string {
    const s = b.stats || ({} as CkdUploadBatch['stats']);
    const parts = [`${b.rowCount} 筆`, `新增 ${b.inserted}`];
    if (b.replaced) parts.push(`更新／移除 ${b.replaced}`);
    if (s.dup) parts.push(`重複 ${s.dup}`);
    if (b.rangeStart) parts.push(`${b.rangeStart} ~ ${b.rangeEnd}`);
    return parts.join('・');
  }

  async loadAllBatches(): Promise<void> {
    try {
      const r = await this.ckdApi.getBatches(200);
      this.batches.set(r.batches);
      this.showAllBatches.set(true);
    } catch (e: any) {
      this.error.set(e?.error?.message || e?.message || '讀取上傳紀錄失敗');
    }
  }

  // ---------- 判定參數 ----------

  setSetting(key: keyof CkdSettings, value: string | boolean): void {
    const f = this.settingsForm();
    if (!f) return;
    const next = { ...f } as any;
    if (key === 'allA') next.allA = !!value;
    else if (key === 'dept') next.dept = String(value);
    else next[key] = Number(value);
    this.settingsForm.set(next);
    this.settingsSaved.set(false);
  }

  isNumericSetting(key: keyof CkdSettings): boolean {
    return (NUMERIC_SETTING_KEYS as readonly string[]).includes(key);
  }

  settingValue(key: keyof CkdSettings): string | number | boolean {
    const f = this.settingsForm();
    return f ? f[key] : '';
  }

  defaultValue(key: keyof CkdSettings): string {
    const d = this.settingsDefaults();
    if (!d) return '';
    const v = d[key];
    return typeof v === 'boolean' ? (v ? '是' : '否') : String(v);
  }

  isDefault(key: keyof CkdSettings): boolean {
    const f = this.settingsForm(), d = this.settingsDefaults();
    return !!f && !!d && f[key] === d[key];
  }

  resetSettings(): void {
    const d = this.settingsDefaults();
    if (d) this.settingsForm.set({ ...d });
    this.settingsSaved.set(false);
  }

  revertSettings(): void {
    const s = this.status()?.settings;
    if (s) this.settingsForm.set({ ...s });
  }

  async saveSettings(): Promise<void> {
    const f = this.settingsForm();
    if (!f) return;
    for (const k of NUMERIC_SETTING_KEYS) {
      if (!(Number(f[k]) > 0)) { this.error.set(`「${this.settingLabels.find((s) => s.key === k)?.label}」必須是正數`); return; }
    }
    this.savingSettings.set(true);
    this.error.set(null);
    try {
      const r = await this.ckdApi.saveSettings(f);
      const st = this.status();
      if (st) this.status.set({ ...st, settings: r.settings, settingsUpdatedBy: r.updatedBy, settingsUpdatedAt: r.updatedAt });
      this.settingsForm.set({ ...r.settings });
      this.settingsSaved.set(true);
    } catch (e: any) {
      this.error.set(e?.error?.message || e?.message || '儲存判定參數失敗');
    } finally {
      this.savingSettings.set(false);
    }
  }

  // ---------- 顯示輔助 ----------

  phaseClass(status: string): string {
    return status === 'done' ? 'done' : status === 'wip' ? 'wip' : 'todo';
  }

  phaseLabel(status: string): string {
    return status === 'done' ? '完成' : status === 'wip' ? '進行中' : '待做';
  }

  /** 'YYYY-MM-DD HH:MM:SS' → 'MM/DD HH:MM' */
  fmtTime(s: string | null | undefined): string {
    if (!s) return '';
    const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
    return m ? `${m[2]}/${m[3]} ${m[4]}:${m[5]}` : String(s);
  }

  fmtSize(n: number): string {
    return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  }
}
