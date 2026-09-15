import { Component, EventEmitter, OnInit, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CkdApiService, CkdWide, CkdWideDayRow, CkdWideMode, CkdWideScope } from '@app/core/services/ckd-api.service';
import { downloadCsv, downloadXlsx, roc } from '../ckd-export';

/**
 * 門診 CKD：檢驗總表（原版第四區 secD）— 追蹤記錄表 × 檢驗報告 合併寬表
 * 合併／21 項／eGFR 斜率／方案推估在後端 services/ckd/wide.js；本元件只做模式（每次檢驗一列／每人一列）、範圍、搜尋、分組表頭、匯出。
 */
@Component({
  selector: 'app-ckd-wide',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ckd-wide.component.html',
  styleUrl: './ckd-wide.component.css',
})
export class CkdWideComponent implements OnInit {
  private readonly ckdApi = inject(CkdApiService);
  @Output() openRecords = new EventEmitter<string>();

  readonly loading = signal(false);
  readonly exporting = signal(false);
  readonly error = signal<string | null>(null);
  readonly wide = signal<CkdWide | null>(null);
  readonly mode = signal<CkdWideMode>('long');
  readonly scope = signal<CkdWideScope>('all');
  readonly q = signal('');
  private qTimer: ReturnType<typeof setTimeout> | null = null;
  /** 回應序號：切模式／範圍／搜尋連發時，只採最後一次的結果（大回應可能晚到） */
  private loadSeq = 0;

  readonly scopes: { s: CkdWideScope; k: string }[] = [{ s: 'all', k: '全部' }, { s: 'clinic', k: '明日門診' }, { s: 'enrolled', k: '已收案' }, { s: 'unlisted', k: '名單外（僅檢驗）' }];

  /** 分組表頭：每群欄數 */
  readonly groupCols = computed(() => {
    const w = this.wide();
    if (!w) return [];
    return w.groups.map(([key, label]) => ({ key, label, n: w.labs.filter((x) => x[3] === key).length }));
  });
  readonly tally = computed(() => {
    const t = this.wide()?.tally;
    if (!t) return [];
    const out: { k: string; v: number; c: string; f?: CkdWideScope }[] = [
      { k: '病人', v: t.persons, c: '', f: 'all' },
      { k: '資料列', v: t.rows, c: '' },
      { k: '明日門診', v: t.clinic, c: 'early', f: 'clinic' },
      { k: '名單外(僅檢驗)', v: t.unlisted, c: 'pre', f: 'unlisted' },
      { k: '可算 eGFR 斜率', v: t.slopeOk, c: '' },
      { k: '缺尿蛋白', v: t.noProt, c: 'wait' },
    ];
    return out;
  });

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    const seq = ++this.loadSeq;
    this.loading.set(true);
    this.error.set(null);
    try {
      const w = await this.ckdApi.getWide({ scope: this.scope(), q: this.q(), mode: this.mode() });
      if (seq !== this.loadSeq) return;
      this.wide.set(w);
    } catch (e: any) {
      if (seq !== this.loadSeq) return;
      this.error.set(e?.error?.message || e?.message || '檢驗總表失敗');
    } finally {
      if (seq === this.loadSeq) this.loading.set(false);
    }
  }

  setMode(m: CkdWideMode): void { this.mode.set(m); void this.load(); }
  setScope(s: CkdWideScope): void { this.scope.set(s); void this.load(); }
  clickTally(f?: CkdWideScope): void { if (f) this.setScope(f); }
  onQuery(v: string): void {
    this.q.set(v);
    if (this.qTimer) clearTimeout(this.qTimer);
    this.qTimer = setTimeout(() => void this.load(), 300);
  }

  /** 檢驗格（原版 wcell）：旗標 H/L、定性符號、推算標記 */
  cell(r: CkdWideDayRow, k: string): { v: string; f: string; calc: boolean } | null {
    if (r[k] == null) return null;
    return { v: `${r[k + '_q'] || ''}${r[k]}`, f: r[k + '_f'] || '', calc: !!r[k + '_c'] };
  }

  progCls(prog: string): string { return prog === 'Pre-ESRD' ? 'b-pre' : prog === 'Early-CKD' ? 'b-early' : 'b-none'; }
  slopeCls(p: { slope: number | null; slWeak: boolean }): string { return p.slWeak ? 'dim' : p.slope != null && p.slope < -4 ? 'sl-bad' : 'sl-ok'; }
  slopeTxt(v: number): string { return (v > 0 ? '+' : '') + v.toFixed(1); }
  roc = roc;

  /** 匯出 Excel（兩張工作表）／CSV（明細）：吃目前範圍與搜尋，取完整資料不受 600 列上限 */
  async exportXlsx(): Promise<void> {
    await this.export(async (d1, d2, date) => downloadXlsx([{ name: '檢驗明細', rows: d1 }, { name: '每人最新值', rows: d2 }], `CKD檢驗總表_${date}.xlsx`));
  }
  async exportCsv(): Promise<void> {
    await this.export(async (d1, _d2, date) => downloadCsv(d1, `CKD檢驗明細_${date}.csv`));
  }
  private async export(fn: (d1: (string | number)[][], d2: (string | number)[][], date: string) => Promise<void>): Promise<void> {
    if (!this.wide()?.tally.persons) return;
    this.exporting.set(true);
    this.error.set(null);
    try {
      const r = await this.ckdApi.getWideExport({ scope: this.scope(), q: this.q() });
      if (r.persons === 0) { this.error.set('沒有符合條件的病人可匯出。'); return; }
      await fn(r.d1, r.d2, new Date().toLocaleDateString('sv-SE'));
    } catch (e: any) {
      this.error.set(e?.error?.message || e?.message || '匯出失敗');
    } finally {
      this.exporting.set(false);
    }
  }
}
