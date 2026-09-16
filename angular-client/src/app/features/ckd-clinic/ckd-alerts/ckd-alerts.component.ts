import { Component, EventEmitter, OnInit, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CkdAlertRow, CkdAlerts, CkdApiService, CkdPatientLabs } from '@app/core/services/ckd-api.service';
import { roc } from '../ckd-export';
import { exportAlertsCsv, exportPatientLabsCsv } from '../ckd-export-followup';
import { CkdQuickFormComponent } from '../ckd-quick-form/ckd-quick-form.component';

type AlertFilter = 'all' | 'open' | 'done' | 'crit' | 'warn';

const CAP = 300;

/** 篩選邏輯（原版 labalert.js:95，逐字） */
const FILTERS: Record<AlertFilter, (a: CkdAlertRow) => boolean> = {
  all: () => true,
  open: (a) => !a.done,
  done: (a) => !!a.done,
  crit: (a) => !a.done && a.sev === 'crit',
  warn: (a) => !a.done && a.sev === 'warn',
};

interface AlertVm {
  a: CkdAlertRow;
  sevText: string;
  dateText: string;
  prog: string;
  caseDoctor: string;
  careLine: string;
  doneText: string;
}

/**
 * 門診 CKD：近日異常檢驗（原版 labalert.js 的 secL）
 * 每日匯入 0204 後掃全部已收案者近 N 天報告：危急值、eGFR 急降、蛋白尿惡化、首次跨門檻。
 * 規則判定在後端 GET /ckd/alerts；本元件只做篩選、前 300 列顯示、標示已處理、列內聯絡紀錄、累積報告與 CSV。
 * 與原版差異：已處理存 DB（跨使用者共享），按鈕一律帶該列 key（修原版「同人多筆永遠動到第一筆」的 bug）。
 */
@Component({
  selector: 'app-ckd-alerts',
  standalone: true,
  imports: [CommonModule, CkdQuickFormComponent],
  templateUrl: './ckd-alerts.component.html',
  styleUrl: './ckd-alerts.component.css',
})
export class CkdAlertsComponent implements OnInit {
  private readonly ckdApi = inject(CkdApiService);
  @Output() openRecords = new EventEmitter<string>();

  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly alerts = signal<CkdAlerts | null>(null);
  readonly filter = signal<AlertFilter>('open');
  readonly win = signal(14);
  /** 展開聯絡表單／累積報告的那一列 key */
  readonly formKey = signal<string | null>(null);
  readonly formDefaults = signal<Record<string, unknown>>({});
  readonly flowKey = signal<string | null>(null);
  readonly flowLabs = signal<CkdPatientLabs | null>(null);
  readonly flowLoading = signal(false);
  readonly flowError = signal<string | null>(null);

  private loadSeq = 0;
  private flowSeq = 0;
  readonly today = new Date().toLocaleDateString('sv-SE');

  /**
   * 統計格（原版 tallyL，標題逐字）。
   * 由 rows 現算而非用後端 tally：標示已處理是就地更新，不重載整頁。
   */
  readonly tally = computed(() => {
    const rows = this.alerts()?.rows || [];
    const open = rows.filter((a) => !a.done);
    return [
      { k: '待處理', v: open.length, c: 'wait', f: 'open' as AlertFilter },
      { k: '危急', v: open.filter((a) => a.sev === 'crit').length, c: 'pre', f: 'crit' as AlertFilter },
      { k: '警示', v: open.filter((a) => a.sev === 'warn').length, c: 'wait', f: 'warn' as AlertFilter },
      { k: '已處理', v: rows.length - open.length, c: 'ok', f: 'done' as AlertFilter },
      { k: '全部', v: rows.length, c: '', f: 'all' as AlertFilter },
    ];
  });

  readonly filtered = computed(() => (this.alerts()?.rows || []).filter(FILTERS[this.filter()]));
  readonly view = computed<AlertVm[]>(() => this.filtered().slice(0, CAP).map((a) => this.toVm(a)));
  readonly hidden = computed(() => Math.max(0, this.filtered().length - CAP));
  readonly emptyText = computed(() => `近 ${this.win()} 天內${this.filter() === 'open' ? '沒有待處理的異常' : '此分類 0 筆'}。`);

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    const seq = ++this.loadSeq;
    this.loading.set(true);
    this.error.set(null);
    try {
      const a = await this.ckdApi.getAlerts();
      if (seq !== this.loadSeq) return;
      this.alerts.set(a);
      this.win.set(a.win);
    } catch (e: any) {
      if (seq !== this.loadSeq) return;
      this.error.set(e?.error?.message || e?.message || '近日異常檢驗失敗');
    } finally {
      if (seq === this.loadSeq) this.loading.set(false);
    }
  }

  setFilter(f: AlertFilter): void {
    this.filter.set(f);
    this.formKey.set(null);
  }

  /** 掃描天數：原版寫 localStorage，重寫版寫 settings.alertWin（DB）後重載 */
  async setWin(value: string): Promise<void> {
    const n = parseInt(value, 10);
    const w = isNaN(n) ? 14 : Math.max(1, Math.min(90, n));
    if (w === this.win()) return;
    this.win.set(w);
    this.saving.set(true);
    this.error.set(null);
    try {
      await this.ckdApi.saveSettings({ alertWin: w });
      await this.load();
    } catch (e: any) {
      this.error.set(e?.error?.message || e?.message || '儲存掃描天數失敗');
    } finally {
      this.saving.set(false);
    }
  }

  // ---------- 處理狀態（就地更新，不整頁重載） ----------

  async setDone(a: CkdAlertRow, done: boolean): Promise<void> {
    this.error.set(null);
    try {
      const res = await this.ckdApi.setAlertDone(a.key, done);
      this.applyDone(a.key, res.done, res.doneBy);
    } catch (e: any) {
      this.error.set(e?.error?.message || e?.message || (done ? '標示已處理失敗' : '復原失敗'));
    }
  }

  private applyDone(key: string, done: string | null, doneBy: any): void {
    const cur = this.alerts();
    if (!cur) return;
    this.alerts.set({ ...cur, rows: cur.rows.map((r) => (r.key === key ? { ...r, done, doneBy } : r)) });
  }

  // ---------- 列內聯絡紀錄 ----------

  toggleForm(a: CkdAlertRow): void {
    if (this.formKey() === a.key) { this.formKey.set(null); return; }
    // 備註預帶「標題 · 說明」（原版 labalert.js:109）
    this.formDefaults.set({ at: this.today, note: `${a.t} · ${a.m}` });
    this.formKey.set(a.key);
  }

  /** 原版：存完聯絡紀錄同時把這筆異常標示已處理 */
  async onSaved(a: CkdAlertRow): Promise<void> {
    this.formKey.set(null);
    await this.setDone(a, true);
  }

  // ---------- 累積報告 ----------

  toggleFlow(a: CkdAlertRow): void {
    if (this.flowKey() === a.key) { this.flowKey.set(null); this.flowLabs.set(null); return; }
    this.flowKey.set(a.key);
    void this.loadFlow(a.mrn);
  }

  private async loadFlow(mrn: string): Promise<void> {
    const seq = ++this.flowSeq;
    this.flowLabs.set(null);
    this.flowError.set(null);
    this.flowLoading.set(true);
    try {
      const d = await this.ckdApi.getPatientLabs(mrn);
      if (seq !== this.flowSeq) return;
      this.flowLabs.set(d);
    } catch (e: any) {
      if (seq !== this.flowSeq) return;
      this.flowError.set(e?.error?.message || e?.message || '讀取累積報告失敗');
    } finally {
      if (seq === this.flowSeq) this.flowLoading.set(false);
    }
  }

  exportFlowCsv(): void {
    const d = this.flowLabs();
    if (!d || !d.rows.length) return;
    exportPatientLabsCsv(d);
  }

  exportCsv(): void {
    const a = this.alerts();
    if (!a || !a.rows.length) return;
    exportAlertsCsv(a.rows, a.date);
  }

  // ---------- 顯示輔助 ----------

  roc = roc;

  private toVm(a: CkdAlertRow): AlertVm {
    const aud = a.aud;
    return {
      a,
      sevText: a.sev === 'crit' ? '危急' : '警示',
      dateText: roc(a.date),
      prog: aud ? (aud.prog === 'pre' ? 'Pre-ESRD' : 'Early-CKD') : '',
      caseDoctor: aud ? aud.caseDoctor || '' : '',
      careLine: aud
        ? `上次照護 ${roc(aud.lastVisit)}${aud.gap != null ? ' · ' + aud.gap + ' 天' : ''}${aud.hasAppt ? ' · 明日有掛號' + (aud.apptDoctor ? '(' + aud.apptDoctor + ')' : '') : ''}`
        : '',
      doneText: a.done ? roc(a.done) : '',
    };
  }
}
