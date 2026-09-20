import { Component, EventEmitter, HostListener, Input, OnChanges, Output, SimpleChanges, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  CkdApiService, CkdEnrollEpisode, CkdPatientCase, CkdPatientLabs, CkdPatientSummary, CkdRecType, CkdWideDayRow,
} from '@app/core/services/ckd-api.service';
import { CkdQuickFormComponent } from '../ckd-quick-form/ckd-quick-form.component';
import { exportPatientLabsCsv } from '../ckd-export-followup';
import { CkdHandoutPanelComponent } from '../ckd-handout-panel/ckd-handout-panel.component';

type DialogTab = 'labs' | 'pcode' | 'edu' | 'records';

/** 檢驗摘要卡：每項取最近一次有值的報告，並與前一次有值的報告比較 */
interface LabLatest {
  key: string;
  label: string;
  unit: string;
  group: string;
  v: number | string;
  q: string;
  f: string;
  date: string | null;
  prev: number | string | null;
  prevDate: string | null;
  /** 1 上升、-1 下降、0 持平或無法比較 */
  dir: 1 | -1 | 0;
}

const STATUS_BADGE: Record<string, [string, string]> = {
  ok: ['b-ok', '可申報追蹤'], over: ['b-pre', '逾期 應追蹤'], cap: ['b-none', '年度已達上限'],
  wait: ['b-wait', '未滿間隔'], none: ['b-none', '資料不足'], dkd: ['b-none', 'DKD 收案 · 不適用'],
};
const VERDICT_BADGE: Record<string, [string, string]> = {
  pre: ['b-pre', '符合 Pre-ESRD'], early: ['b-ok', '符合 Early-CKD'], check: ['b-wait', '待補檢驗'],
  nodata: ['b-none', '無檢驗資料'], no: ['b-none', '目前不符'],
};
/** 視窗內可直接新增的紀錄類型（其餘類型與編輯／刪除到完整個案紀錄做） */
const QUICK_TYPES: { type: CkdRecType; label: string }[] = [
  { type: 'contact', label: '聯絡紀錄' },
  { type: 'note', label: '追蹤紀錄' },
  { type: 'sdm', label: 'RRT SDM' },
  { type: 'access', label: '血管通路' },
];
const LAB_ROWS_COLLAPSED = 6;

/**
 * 門診 CKD：病人彙整視窗（本站新增，2026-09-20 使用者拍板；原版單機版沒有）
 * 各清單點病人姓名 → 開這個視窗：收案基本資料、現況判讀與建議、檢驗彙整、P 碼紀錄、衛教與追蹤、其他紀錄。
 * 判讀內容全部來自後端引擎（GET /ckd/patients/:mrn/case），這裡不做任何臨床判斷；
 * 「近期異常」只是把 HIS 報告自帶的 H／L 標記挑出來，不是本站自訂的參考值。
 * 視窗不取代個案紀錄區：可快速新增四類紀錄，編輯／刪除／其他類型按「完整個案紀錄」過去做。
 */
@Component({
  selector: 'app-ckd-patient-dialog',
  standalone: true,
  imports: [CommonModule, CkdQuickFormComponent, CkdHandoutPanelComponent],
  templateUrl: './ckd-patient-dialog.component.html',
  styleUrl: './ckd-patient-dialog.component.css',
})
export class CkdPatientDialogComponent implements OnChanges {
  private readonly ckdApi = inject(CkdApiService);

  @Input() mrn = '';
  /** 判讀日（YYYY-MM-DD）；空 = 今天。從明日追蹤／收案評估開啟時帶該頁的判讀日，判讀才會和清單同一列 */
  @Input() date = '';

  @Output() closed = new EventEmitter<void>();
  /** 到完整個案紀錄區（type 有值 = 直接開該類型的新增表單，例如外院收案查核） */
  @Output() openRecords = new EventEmitter<{ mrn: string; type: CkdRecType | null }>();
  /** 視窗內新增了紀錄（外層清單可重判讀） */
  @Output() changed = new EventEmitter<void>();

  readonly quickTypes = QUICK_TYPES;
  readonly today = new Date().toLocaleDateString('sv-SE');

  readonly loading = signal(false);
  readonly caseError = signal<string | null>(null);
  readonly summaryError = signal<string | null>(null);
  readonly labsError = signal<string | null>(null);
  readonly pcase = signal<CkdPatientCase | null>(null);
  readonly summary = signal<CkdPatientSummary | null>(null);
  readonly labs = signal<CkdPatientLabs | null>(null);

  readonly tab = signal<DialogTab>('labs');
  readonly showAllLabRows = signal(false);
  readonly showWhy = signal(true);
  /** 開著的快速表單類型與預帶值 */
  readonly addType = signal<CkdRecType | null>(null);
  readonly addDefaults = signal<Record<string, unknown>>({});

  readonly addLabel = computed(() => QUICK_TYPES.find((q) => q.type === this.addType())?.label || '紀錄');
  readonly age = computed(() => this.rowA()?.age ?? this.rowB()?.age ?? null);

  /** 檢驗報告衛教單面板（第二階段）。開著時 Esc／點遮罩不關視窗，免得留言打到一半不見 */
  readonly showHandout = signal(false);

  private loadSeq = 0;
  private reloadSeq = 0;

  // ---------- 衍生資料 ----------

  readonly name = computed(() => this.pcase()?.name || this.summary()?.name || this.labs()?.name || '');
  readonly rowA = computed(() => this.pcase()?.a || null);
  readonly rowB = computed(() => this.pcase()?.b || null);

  /** 目前這一段收案：未結案的最新一段；都結案了就取最新一段 */
  readonly currentEpisode = computed<CkdEnrollEpisode | null>(() => {
    const eps = this.pcase()?.episodes || [];
    return eps.find((e) => !e.closed) || eps[0] || null;
  });
  readonly pastEpisodes = computed(() => {
    const cur = this.currentEpisode();
    return (this.pcase()?.episodes || []).filter((e) => e !== cur);
  });

  readonly enrollCat = computed(() => {
    const a = this.rowA(), ep = this.currentEpisode();
    if (ep?.cat) return ep.cat;
    if (a) return a.dkd ? 'DKD' : a.prog === 'pre' ? 'Pre-ESRD' : 'Early-CKD';
    return '';
  });
  readonly enrollDoctor = computed(() => this.rowA()?.caseDoctor || this.currentEpisode()?.doctor || '');
  readonly enrollDate = computed(() => this.rowA()?.enroll || this.currentEpisode()?.enroll || null);

  readonly statusBadge = computed(() => {
    const a = this.rowA(), b = this.rowB();
    if (a) return STATUS_BADGE[a.status] || null;
    if (b) return VERDICT_BADGE[b.verdict] || null;
    return null;
  });

  readonly box = computed(() => this.rowA()?.box || this.rowB()?.box || null);
  readonly why = computed(() => this.rowA()?.why || this.rowB()?.why || []);
  readonly ord = computed(() => this.rowA()?.ord || this.rowB()?.ord || []);
  readonly bed = computed(() => this.rowA()?.bed || this.rowB()?.bed || []);
  readonly unk = computed(() => this.rowA()?.unk || this.rowB()?.unk || []);
  /** 判讀框行動列（act.cls = miss）已列出缺項時不重複：有 ord 時它列的是 ord，否則列 bed（engine.verdictA／B） */
  private readonly actIsMiss = computed(() => this.box()?.act?.cls === 'miss');
  readonly showOrd = computed(() => this.ord().length > 0 && !this.actIsMiss());
  readonly showBed = computed(() => this.bed().length > 0 && !(this.actIsMiss() && !this.ord().length));

  /** 每項檢驗的最近值（rows 已是新→舊） */
  readonly labLatest = computed<LabLatest[]>(() => {
    const d = this.labs();
    if (!d) return [];
    const out: LabLatest[] = [];
    for (const [key, label, unit, group] of d.labs) {
      let cur: CkdWideDayRow | null = null, prev: CkdWideDayRow | null = null;
      for (const row of d.rows) {
        if (row[key] == null) continue;
        if (!cur) cur = row; else { prev = row; break; }
      }
      if (!cur) continue;
      const v = cur[key], pv = prev ? prev[key] : null;
      const dir = typeof v === 'number' && typeof pv === 'number' ? (v > pv ? 1 : v < pv ? -1 : 0) : 0;
      out.push({ key, label, unit, group, v, q: cur[key + '_q'] || '', f: cur[key + '_f'] || '', date: cur.date, prev: pv, prevDate: prev ? prev.date : null, dir });
    }
    return out;
  });
  readonly labGroups = computed(() => {
    const d = this.labs();
    if (!d) return [];
    const latest = this.labLatest();
    return d.groups.map(([gk, gl]) => ({ key: gk, label: gl, items: latest.filter((x) => x.group === gk) })).filter((g) => g.items.length);
  });
  /** 近期異常：最近值帶 HIS 的 H／L 標記者 */
  readonly labFlagged = computed(() => this.labLatest().filter((x) => x.f === 'H' || x.f === 'L'));
  readonly labRows = computed(() => {
    const rows = this.labs()?.rows || [];
    return this.showAllLabRows() ? rows : rows.slice(0, LAB_ROWS_COLLAPSED);
  });
  readonly labRowsHidden = computed(() => Math.max(0, (this.labs()?.rows.length || 0) - LAB_ROWS_COLLAPSED));

  // ---------- 載入 ----------

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['mrn'] || changes['date']) {
      this.tab.set('labs');
      this.showAllLabRows.set(false);
      this.addType.set(null);
      this.showHandout.set(false);
      void this.load();
    }
  }

  /** 三支並行；任一失敗只影響自己的區塊，不擋其他資料 */
  async load(): Promise<void> {
    const mrn = this.mrn;
    if (!mrn) return;
    const seq = ++this.loadSeq;
    this.loading.set(true);
    this.pcase.set(null); this.summary.set(null); this.labs.set(null);
    this.caseError.set(null); this.summaryError.set(null); this.labsError.set(null);
    const msg = (e: any, fallback: string) => e?.error?.message || e?.message || fallback;
    const [c, s, l] = await Promise.allSettled([
      this.ckdApi.getPatientCase(mrn, this.date || undefined),
      this.ckdApi.getPatientSummary(mrn),
      this.ckdApi.getPatientLabs(mrn),
    ]);
    if (seq !== this.loadSeq) return;
    if (c.status === 'fulfilled') this.pcase.set(c.value); else this.caseError.set(msg(c.reason, '讀取病人判讀失敗'));
    if (s.status === 'fulfilled') this.summary.set(s.value); else this.summaryError.set(msg(s.reason, '讀取病人摘要失敗'));
    if (l.status === 'fulfilled') this.labs.set(l.value); else this.labsError.set(msg(l.reason, '讀取累積檢驗報告失敗'));
    this.loading.set(false);
  }

  /** 新增紀錄後：判讀（紀錄會經 hooks 影響判讀與衛教時間軸）與摘要重抓；檢驗不受影響不必重抓 */
  private async reloadAfterRecord(): Promise<void> {
    const mrn = this.mrn, seq = this.loadSeq, rseq = ++this.reloadSeq;
    const [c, s] = await Promise.allSettled([
      this.ckdApi.getPatientCase(mrn, this.date || undefined),
      this.ckdApi.getPatientSummary(mrn),
    ]);
    // 換了病人（loadSeq）或又存了一筆（reloadSeq）→ 這次的結果已過時
    if (seq !== this.loadSeq || rseq !== this.reloadSeq) return;
    if (c.status === 'fulfilled') this.pcase.set(c.value);
    if (s.status === 'fulfilled') this.summary.set(s.value);
  }

  // ---------- 操作 ----------

  /** 已有表單開著時又按了「＋」：不取代（換 defaults 會讓 quick-form 重新初始化、清空已填內容），只提示一下 */
  readonly formBusy = signal(false);
  private formBusyTimer: ReturnType<typeof setTimeout> | null = null;

  startAdd(type: CkdRecType, defaults: Record<string, unknown> = {}): void {
    if (this.addType()) {
      this.formBusy.set(true);
      if (this.formBusyTimer) clearTimeout(this.formBusyTimer);
      this.formBusyTimer = setTimeout(() => this.formBusy.set(false), 3000);
      return;
    }
    this.addDefaults.set({ at: this.today, ...defaults });
    this.addType.set(type);
  }

  startAddEdu(): void {
    this.startAdd('note', { cat: '衛教' });
  }

  async onSaved(): Promise<void> {
    this.addType.set(null);
    // 先通知外層再重抓：使用者存完馬上關視窗時，元件已銷毀、晚發的事件外層收不到，底下清單就不會重載
    this.changed.emit();
    await this.reloadAfterRecord();
  }

  /** 判讀框的行動列：外院查核（vpn）直接到完整個案紀錄開表單；rec = 到該病人的個案紀錄 */
  onAct(act: { vpn?: string; rec?: string } | null): void {
    if (!act) return;
    if (act.vpn) this.openRecords.emit({ mrn: this.mrn, type: 'extEnroll' });
    else if (act.rec) this.openRecords.emit({ mrn: this.mrn, type: null });
  }

  toggleHandout(): void {
    this.showHandout.set(!this.showHandout());
  }

  /** 衛教單面板存了一筆衛教紀錄 → 同快速表單存檔：先通知外層、再重抓判讀與紀錄 */
  async onHandoutRecorded(): Promise<void> {
    this.changed.emit();
    await this.reloadAfterRecord();
  }

  goFullRecords(): void {
    this.openRecords.emit({ mrn: this.mrn, type: null });
  }

  exportLabsCsv(): void {
    const d = this.labs();
    if (d) exportPatientLabsCsv(d);
  }

  close(): void {
    this.closed.emit();
  }

  /** 點遮罩關閉；表單開著時不關，避免填到一半不見 */
  onBackdrop(): void {
    if (!this.addType() && !this.showHandout()) this.close();
  }

  /** Esc 關視窗；表單開著時不動作（與點遮罩一致），填到一半的內容只能由表單的「取消」明確放棄 */
  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (!this.addType() && !this.showHandout()) this.close();
  }

  // ---------- 顯示輔助 ----------

  roc(s: string | null | undefined): string {
    if (!s) return '—';
    const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${String(+m[1] - 1911).padStart(3, '0')}/${m[2]}/${m[3]}` : String(s);
  }

  years(days: number | null | undefined): string {
    return days == null ? '' : (days / 365).toFixed(1) + ' 年';
  }

  fmt1(v: number | null | undefined): string {
    return v == null ? '—' : v.toFixed(1);
  }

  stageText(stage: string | null | undefined): string {
    return stage ? stage.replace('G', 'Stage ') : '';
  }

  alertCls(t: string): string {
    // 與明日追蹤區同一套分類：獎勵＝好消息、分期＝提示、其餘＝提醒
    return t === '獎勵' ? 'al-good' : t === '分期' ? 'al-info' : 'al-warn';
  }
}
