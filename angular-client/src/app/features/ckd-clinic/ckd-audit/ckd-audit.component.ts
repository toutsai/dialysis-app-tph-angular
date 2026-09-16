import { Component, EventEmitter, OnInit, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CkdApiService, CkdAudit, CkdAuditRow } from '@app/core/services/ckd-api.service';
import { exportAuditCsv, roc } from '../ckd-export';

type AuditFilter = 'all' | 'pre' | 'early' | 'due' | 'over' | 'ann' | 'refer' | 'reward' | 'stage' | 'miss' | 'yrclose' | 'drsplit' | 'soon' | 'unbilled' | 'shortbill';
type SortKey = 'last' | 'gap' | 'egfr' | 'n12';

/** 篩選定義（原版 renderAudit 的 F） */
const FILTERS: Record<AuditFilter, (x: CkdAuditRow) => boolean> = {
  all: () => true,
  pre: x => x.prog === 'pre', early: x => x.prog === 'early',
  due: x => x.status === 'ok' || x.status === 'over', over: x => x.status === 'over',
  ann: x => x.ann.ok,
  refer: x => x.alerts.some(a => a.t === '轉出'), reward: x => x.alerts.some(a => a.t === '獎勵'), stage: x => x.alerts.some(a => a.t === '分期'),
  miss: x => x.miss.length > 0,
  yrclose: x => x.alerts.some(a => /Q6-3/.test(a.m)), drsplit: x => x.alerts.some(a => /Q22/.test(a.m)),
  soon: x => x.tooSoon,
  unbilled: x => !!x.recon && x.recon.misses.length > 0, shortbill: x => !!x.recon && x.recon.shortBilled.length > 0,
};
/** 排序（原版 AUDIT_SORTS）：def = 換欄時的預設方向；-1 = 大在前 */
const SORTS: Record<SortKey, { v: (r: CkdAuditRow) => number; def: 1 | -1 }> = {
  last: { v: r => (r.last?.visit ? Date.parse(r.last.visit) : -Infinity), def: -1 },
  gap: { v: r => (r.gap == null ? -1 : r.gap), def: -1 },
  egfr: { v: r => (r.egfr == null ? Infinity : r.egfr), def: 1 },
  n12: { v: r => (r.n12 == null ? -1 : r.n12), def: -1 },
};
const STB: Record<string, [string, string]> = { ok: ['b-early', '可申報追蹤'], over: ['b-pre', '逾期 應追蹤'], cap: ['b-none', '年度已達上限'], wait: ['b-wait', '未滿間隔'], none: ['b-none', '資料不足'], dkd: ['b-none', 'DKD 收案 · 不適用'] };
const CAP = 300;
const SORT_KEY = 'ckdAuditSort';

/**
 * 門診 CKD：全名單稽核（原版第三區 secC）— 年度評估、轉出與獎勵
 * 登錄簿全部未結案且有照護紀錄者，不限當日門診；判定在後端 GET /ckd/audit，本元件只做統計格篩選、排序、前 300 列顯示、CSV。
 */
@Component({
  selector: 'app-ckd-audit',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './ckd-audit.component.html',
  styleUrl: './ckd-audit.component.css',
})
export class CkdAuditComponent implements OnInit {
  private readonly ckdApi = inject(CkdApiService);
  @Output() openRecords = new EventEmitter<string>();

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly audit = signal<CkdAudit | null>(null);
  readonly filter = signal<AuditFilter>('all');
  readonly showAll = signal(false);
  readonly sort = signal<{ key: SortKey; dir: 1 | -1 }>(this.loadSort());

  readonly chipDefs: { f: AuditFilter; k: string }[] = [
    { f: 'all', k: '全部' }, { f: 'pre', k: 'Pre-ESRD' }, { f: 'early', k: 'Early-CKD' }, { f: 'ann', k: '年度評估到期' }, { f: 'due', k: '可追蹤' }, { f: 'over', k: '逾期未追蹤' },
    { f: 'refer', k: '應轉出' }, { f: 'stage', k: '分期與 eGFR 不符' }, { f: 'reward', k: '獎勵可評估' }, { f: 'miss', k: '必要檢驗缺項' }, { f: 'soon', k: '前次間隔不足' },
    { f: 'yrclose', k: '逾年將結案' }, { f: 'drsplit', k: '追蹤換醫師' }, { f: 'unbilled', k: '漏帳待補' }, { f: 'shortbill', k: '入帳間隔異常' },
  ];

  /** 統計格（原版 tallyC，順序與文字逐字） */
  readonly tally = computed(() => {
    const AUD = this.audit()?.rows || [];
    const n = (f: AuditFilter) => AUD.filter(FILTERS[f]).length;
    const yr = n('yrclose'), dr = n('drsplit');
    const t: { k: string; v: number; c: string; f: AuditFilter }[] = [
      { k: '收案總數', v: AUD.length, c: '', f: 'all' },
      { k: 'Pre-ESRD', v: n('pre'), c: 'pre', f: 'pre' },
      { k: 'Early-CKD', v: n('early'), c: 'early', f: 'early' },
      { k: '可追蹤', v: n('due'), c: 'early', f: 'due' },
      { k: '逾期未追蹤', v: n('over'), c: 'pre', f: 'over' },
      { k: '年度評估到期', v: n('ann'), c: 'pre', f: 'ann' },
      { k: '應轉出', v: n('refer'), c: 'pre', f: 'refer' },
      { k: '獎勵可評估', v: n('reward'), c: 'early', f: 'reward' },
      { k: '分期與 eGFR 不符', v: n('stage'), c: 'wait', f: 'stage' },
      { k: '必要檢驗缺項', v: n('miss'), c: 'wait', f: 'miss' },
      { k: '逾年將結案', v: yr, c: yr ? 'pre' : '', f: 'yrclose' },
      { k: '追蹤換醫師', v: dr, c: dr ? 'wait' : '', f: 'drsplit' },
      { k: '前次間隔不足', v: n('soon'), c: 'wait', f: 'soon' },
      { k: '漏帳待補', v: n('unbilled'), c: 'pre', f: 'unbilled' },
      { k: '入帳間隔異常', v: n('shortbill'), c: 'wait', f: 'shortbill' },
    ];
    return t;
  });

  readonly rowsAll = computed(() => {
    const AUD = this.audit()?.rows || [];
    const sp = SORTS[this.sort().key], dir = this.sort().dir;
    return AUD.filter(FILTERS[this.filter()]).slice().sort((a, b) => {
      const x = sp.v(a), y = sp.v(b);
      return x === y ? String(a.mrn).localeCompare(String(b.mrn)) : (x < y ? -dir : dir);
    });
  });
  readonly rows = computed(() => (this.showAll() ? this.rowsAll() : this.rowsAll().slice(0, CAP)));
  readonly hidden = computed(() => this.rowsAll().length - this.rows().length);

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.audit.set(await this.ckdApi.getAudit());
    } catch (e: any) {
      this.error.set(e?.error?.message || e?.message || '全名單稽核失敗');
    } finally {
      this.loading.set(false);
    }
  }

  /** 統計格三段式（原版 app.js:848-854）：點同一格 → 回全部；否則換分類 */
  clickTally(f: AuditFilter): void {
    this.filter.set(this.filter() === f && f !== 'all' ? 'all' : f);
    this.showAll.set(false);
  }

  setFilter(f: AuditFilter): void {
    this.filter.set(f);
    this.showAll.set(false);
  }

  setSort(key: SortKey): void {
    const cur = this.sort();
    const next = cur.key === key ? { key, dir: (-cur.dir) as 1 | -1 } : { key, dir: SORTS[key].def };
    this.sort.set(next);
    try { localStorage.setItem(SORT_KEY, JSON.stringify(next)); } catch { /* 私密視窗等 */ }
  }

  private loadSort(): { key: SortKey; dir: 1 | -1 } {
    try {
      const j = JSON.parse(localStorage.getItem(SORT_KEY) || 'null');
      if (j && SORTS[j.key as SortKey] && (j.dir === 1 || j.dir === -1)) return { key: j.key, dir: j.dir };
    } catch { /* ignore */ }
    return { key: 'last', dir: -1 };
  }

  arrow(k: SortKey): string {
    const s = this.sort();
    return s.key === k ? (s.dir < 0 ? ' ▼' : ' ▲') : '';
  }

  sortHint(k: SortKey): string {
    const s = this.sort();
    return k === 'last' ? (s.key === k && s.dir < 0 ? '目前：近→遠，點一下改為遠→近' : '點一下依上次照護日期排序') : '點一下依此欄排序';
  }

  exportCsv(): void {
    const a = this.audit();
    if (!a || !a.rows.length) return;
    exportAuditCsv(a.rows, a.date);
  }

  // ---------- 顯示輔助 ----------
  roc = roc;
  stb(status: string): [string, string] { return STB[status] || ['b-none', status]; }
  f1(n: number | null | undefined): string { return n == null ? '—' : n.toFixed(1); }
  alertCls(t: string): string { return t === '獎勵' ? 'gd' : t === '分期' ? 'nt' : 'wn'; }
}
