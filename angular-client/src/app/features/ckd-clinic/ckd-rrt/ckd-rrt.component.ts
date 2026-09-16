import { Component, EventEmitter, OnInit, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CkdApiService, CkdRecType, CkdRrt, CkdRrtRow, CkdRrtStation } from '@app/core/services/ckd-api.service';
import { roc } from '../ckd-export';
import { exportRrtCsv } from '../ckd-export-followup';
import { CkdQuickFormComponent } from '../ckd-quick-form/ckd-quick-form.component';

type RrtFilter = CkdRrtStation | 'all';

interface RrtVm {
  r: CkdRrtRow;
  ageProg: string;
  egfrText: string;
  hot: boolean;
  egfrSub: string;
  sdmMain: string;
  sdmSub: string;
  accType: string;
  accSub: string;
  accNone: string;
  stationText: string;
}

/**
 * 門診 CKD：透析準備管線（原版 rrt.js 的 secP）
 * eGFR 低於門檻的已收案者（以及任何有 SDM／通路紀錄者），依紀錄自動判定六站與下一步。
 * 站別與下一步在後端 GET /ckd/rrt；本元件只做篩選、列內新增 SDM／通路紀錄與 CSV。
 * 原版無列數上限，這裡同樣不截斷。門檻存 DB settings.rrtEgfr。
 */
@Component({
  selector: 'app-ckd-rrt',
  standalone: true,
  imports: [CommonModule, CkdQuickFormComponent],
  templateUrl: './ckd-rrt.component.html',
  styleUrl: './ckd-rrt.component.css',
})
export class CkdRrtComponent implements OnInit {
  private readonly ckdApi = inject(CkdApiService);
  @Output() openRecords = new EventEmitter<string>();

  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly rrt = signal<CkdRrt | null>(null);
  readonly filter = signal<RrtFilter>('all');
  readonly egfrThreshold = signal(20);
  /** 目前展開的列內表單：同 mrn 同 type 再點即收起 */
  readonly form = signal<{ mrn: string; type: CkdRecType } | null>(null);

  private loadSeq = 0;
  readonly today = new Date().toLocaleDateString('sv-SE');
  readonly atDefaults: Record<string, unknown> = { at: this.today };

  /** 統計格（原版 tallyP，「全部」在最前，標題逐字） */
  readonly tally = computed(() => {
    const r = this.rrt();
    const t = r?.tally;
    return [
      { k: '全部', v: r?.rows.length || 0, c: '', f: 'all' as RrtFilter },
      { k: '未談 SDM', v: t?.s0 || 0, c: 'pre', f: 's0' as RrtFilter },
      { k: 'SDM 討論中', v: t?.s1 || 0, c: 'wait', f: 's1' as RrtFilter },
      { k: '待建通路', v: t?.s2 || 0, c: 'wait', f: 's2' as RrtFilter },
      { k: '通路建立/成熟中', v: t?.s3 || 0, c: 'ok', f: 's3' as RrtFilter },
      { k: '已使用(透析中)', v: t?.s4 || 0, c: 'none', f: 's4' as RrtFilter },
      { k: '移植 / 保守療法', v: t?.s5 || 0, c: 'none', f: 's5' as RrtFilter },
    ];
  });

  readonly filtered = computed(() => {
    const rows = this.rrt()?.rows || [];
    const f = this.filter();
    return f === 'all' ? rows : rows.filter((r) => r.station === f);
  });
  readonly view = computed<RrtVm[]>(() => this.filtered().map((r) => this.toVm(r)));

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    const seq = ++this.loadSeq;
    this.loading.set(true);
    this.error.set(null);
    try {
      const r = await this.ckdApi.getRrt();
      if (seq !== this.loadSeq) return;
      this.rrt.set(r);
      this.egfrThreshold.set(r.egfrThreshold);
    } catch (e: any) {
      if (seq !== this.loadSeq) return;
      this.error.set(e?.error?.message || e?.message || '透析準備管線失敗');
    } finally {
      if (seq === this.loadSeq) this.loading.set(false);
    }
  }

  /** 統計格三段式：點同一格 → 回全部 */
  clickTally(f: RrtFilter): void {
    this.filter.set(this.filter() === f && f !== 'all' ? 'all' : f);
    this.form.set(null);
  }

  toggleForm(mrn: string, type: CkdRecType): void {
    const cur = this.form();
    this.form.set(cur && cur.mrn === mrn && cur.type === type ? null : { mrn, type });
  }

  onSaved(): void {
    this.form.set(null);
    void this.load();
  }

  /** eGFR 門檻：原版寫 localStorage，重寫版寫 settings.rrtEgfr（DB）後重載 */
  async setThreshold(value: string): Promise<void> {
    const n = parseInt(value, 10);
    const v = isNaN(n) ? 20 : Math.max(5, Math.min(30, n));
    if (v === this.egfrThreshold()) return;
    this.egfrThreshold.set(v);
    this.saving.set(true);
    this.error.set(null);
    try {
      await this.ckdApi.saveSettings({ rrtEgfr: v });
      await this.load();
    } catch (e: any) {
      this.error.set(e?.error?.message || e?.message || '儲存 eGFR 門檻失敗');
    } finally {
      this.saving.set(false);
    }
  }

  exportCsv(): void {
    const r = this.rrt();
    if (!r || !r.rows.length) return;
    exportRrtCsv(r.rows, r.stations, r.date);
  }

  // ---------- 顯示輔助 ----------

  private toVm(r: CkdRrtRow): RrtVm {
    const sdm: any = r.sdm || null;
    const acc: any = r.acc || null;
    const prog = r.prog === 'pre' ? 'Pre-ESRD' : 'Early-CKD';
    const followUp = sdm && sdm['followUp'] ? String(sdm['followUp']) : '';
    const accDates = acc
      ? [
          acc['planDate'] ? '安排 ' + acc['planDate'] : '',
          acc['createDate'] ? '建立 ' + acc['createDate'] : '',
          acc['matureDate'] ? '成熟 ' + acc['matureDate'] : '',
          acc['firstUseDate'] ? '首用 ' + acc['firstUseDate'] : '',
        ].filter((x) => x)
      : [];
    return {
      r,
      ageProg: `${r.age != null ? r.age + ' 歲 · ' : ''}${prog}`,
      egfrText: r.egfr == null ? '—' : r.egfr.toFixed(1),
      hot: r.egfr != null && r.egfr < 15,
      egfrSub: `${r.stage || ''}${r.labDate ? ' · ' + roc(r.labDate) : ''}`,
      sdmMain: sdm ? (r.leaning || '尚未決定') : '',
      sdmSub: sdm ? `${roc(sdm['at'])}${followUp ? ' · 待追:' + followUp.slice(0, 40) : ''}` : '',
      accType: acc ? String(acc['accessType'] || '') : '',
      accSub: accDates.join(' · '),
      accNone: acc ? '' : (r.modality === 'CKM' || r.modality === 'TX' ? '不適用' : '未規劃'),
      stationText: (r.station && this.rrt()?.stations?.[r.station]) || r.station,
    };
  }
}
