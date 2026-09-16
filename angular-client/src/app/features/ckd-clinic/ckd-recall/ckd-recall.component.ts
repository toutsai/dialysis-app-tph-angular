import { Component, EventEmitter, OnInit, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CkdApiService, CkdRecall, CkdRecallBucket, CkdRecallRow } from '@app/core/services/ckd-api.service';
import { roc } from '../ckd-export';
import { exportRecallCsv } from '../ckd-export-followup';
import { CkdQuickFormComponent } from '../ckd-quick-form/ckd-quick-form.component';

type RecallFilter = CkdRecallBucket | 'all';

const CAP = 300;

/** 提示列（原版 recall.js:71-73，逐字） */
const HINTS: Record<RecallFilter, string> = {
  call: '依逾期天數排序;點「記錄聯絡」填結果,已約回診或暫緩者會自動移出此清單',
  appt: '門診清單已有本科未來掛號,或聯絡紀錄已約定回診日;不必再打電話',
  hold: '暫緩至某日、或最近一年內結果為拒絕/失聯/他院/轉透析/往生;要重新召回請新增一筆其他結果的聯絡紀錄',
  close: '逾一年未照護,依方案規定應於 HIS 結案(結案後重匯追蹤清冊即消失);若仍想召回,先記錄聯絡',
  grace: '追蹤剛到期、仍在寬限天數內,多半會自行回診;寬限天數可在上方調整',
  all: '',
};

/** 每列的顯示字串先算好，模板不再重算（避免模板呼叫函式） */
interface RecallVm {
  r: CkdRecallRow;
  prog: string;
  sub: string;
  lastText: string;
  lastCode: string;
  gapText: string;
  hot: boolean;
  needText: string;
  apptShow: boolean;
  apptMain: string;
  apptSub: string;
  apptOther: boolean;
  ctResult: string;
  ctLine: string;
  snoozeText: string;
  noteShort: string;
}

/**
 * 門診 CKD：召回工作清單（原版 recall.js 的 secR）
 * 已收案且追蹤到期／逾期者，先扣掉已有本科未來掛號的人，其餘依逾期天數排序供電話召回。
 * 分桶（call／grace／appt／hold／close）與排序都在後端 GET /ckd/recall；本元件只做篩選、前 300 列顯示、列內聯絡紀錄與 CSV。
 * 寬限天數存 DB settings.recallGrace（原版存 localStorage，每台電腦不同值）。
 */
@Component({
  selector: 'app-ckd-recall',
  standalone: true,
  imports: [CommonModule, CkdQuickFormComponent],
  templateUrl: './ckd-recall.component.html',
  styleUrl: './ckd-recall.component.css',
})
export class CkdRecallComponent implements OnInit {
  private readonly ckdApi = inject(CkdApiService);
  @Output() openRecords = new EventEmitter<string>();

  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly recall = signal<CkdRecall | null>(null);
  readonly filter = signal<RecallFilter>('call');
  readonly grace = signal(30);
  /** 目前展開聯絡表單的病歷號 */
  readonly formMrn = signal<string | null>(null);

  /** 回應序號：連點重新整理／改寬限天數時只採最後一次 */
  private loadSeq = 0;

  readonly today = new Date().toLocaleDateString('sv-SE');
  /** 固定參考，避免每次變更偵測都換新物件 */
  readonly contactDefaults: Record<string, unknown> = { at: this.today };

  /** 統計格（原版 tallyR，標題逐字，含動態寬限天數） */
  readonly tally = computed(() => {
    const r = this.recall();
    const t = r?.tally;
    return [
      { k: '待聯絡', v: t?.call || 0, c: 'wait', f: 'call' as RecallFilter },
      { k: `剛到期(寬限 ${this.grace()} 天內)`, v: t?.grace || 0, c: 'none', f: 'grace' as RecallFilter },
      { k: '已預約', v: t?.appt || 0, c: 'ok', f: 'appt' as RecallFilter },
      { k: '暫緩/暫停', v: t?.hold || 0, c: 'none', f: 'hold' as RecallFilter },
      { k: '應結案(逾 1 年)', v: t?.close || 0, c: 'pre', f: 'close' as RecallFilter },
      { k: '全部到期', v: r?.rows.length || 0, c: '', f: 'all' as RecallFilter },
    ];
  });

  readonly filtered = computed(() => {
    const rows = this.recall()?.rows || [];
    const f = this.filter();
    return f === 'all' ? rows : rows.filter((r) => r.bucket === f);
  });
  readonly view = computed<RecallVm[]>(() => this.filtered().slice(0, CAP).map((r) => this.toVm(r)));
  readonly hidden = computed(() => Math.max(0, this.filtered().length - CAP));
  readonly hint = computed(() => HINTS[this.filter()]);

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    const seq = ++this.loadSeq;
    this.loading.set(true);
    this.error.set(null);
    try {
      const r = await this.ckdApi.getRecall();
      if (seq !== this.loadSeq) return;
      this.recall.set(r);
      this.grace.set(r.grace);
    } catch (e: any) {
      if (seq !== this.loadSeq) return;
      this.error.set(e?.error?.message || e?.message || '召回工作清單失敗');
    } finally {
      if (seq === this.loadSeq) this.loading.set(false);
    }
  }

  /** 統計格三段式：點同一格 → 回全部 */
  clickTally(f: RecallFilter): void {
    this.filter.set(this.filter() === f && f !== 'all' ? 'all' : f);
    this.formMrn.set(null);
  }

  toggleForm(mrn: string): void {
    this.formMrn.set(this.formMrn() === mrn ? null : mrn);
  }

  /** 存好聯絡紀錄後重新取清單：已約回診／暫緩者會自動移出待聯絡（原版行為） */
  onSaved(): void {
    this.formMrn.set(null);
    void this.load();
  }

  /** 寬限天數：原版寫 localStorage，重寫版寫 settings.recallGrace（DB）後重載 */
  async setGrace(value: string): Promise<void> {
    const n = parseInt(value, 10);
    const g = isNaN(n) ? 30 : Math.max(0, Math.min(180, n));
    if (g === this.grace()) return;
    this.grace.set(g);
    this.saving.set(true);
    this.error.set(null);
    try {
      await this.ckdApi.saveSettings({ recallGrace: g });
      await this.load();
    } catch (e: any) {
      this.error.set(e?.error?.message || e?.message || '儲存寬限天數失敗');
    } finally {
      this.saving.set(false);
    }
  }

  exportCsv(): void {
    const r = this.recall();
    if (!r || !r.rows.length) return;
    exportRecallCsv(r.rows, this.filter(), r.date);
  }

  // ---------- 顯示輔助 ----------

  private toVm(r: CkdRecallRow): RecallVm {
    const ct: any = r.ct || null;
    const note = ct && ct['note'] != null ? String(ct['note']) : '';
    return {
      r,
      prog: r.prog === 'pre' ? 'Pre-ESRD' : 'Early-CKD',
      sub: `${r.stage || '—'}${r.egfr != null ? ' · eGFR ' + r.egfr.toFixed(1) : ''}`,
      lastText: roc(r.lastVisit),
      lastCode: r.lastCode || '',
      gapText: r.gap == null ? '—' : `${r.gap}天`,
      hot: r.gap != null && r.gap > 365,
      needText: `需 ${r.need || '—'}`,
      apptShow: !!(r.appt || r.ctAppt),
      apptMain: r.appt ? roc(r.appt.date) : (r.ctAppt ? roc(r.ctAppt) : ''),
      apptSub: r.appt
        ? `${r.appt.dept}${r.appt.doctor ? ' · ' + r.appt.doctor : ''}${!r.appt.inDept ? '(他科)' : ''}`
        : (r.ctAppt ? '聯絡紀錄約定' : ''),
      apptOther: !!(r.appt && !r.appt.inDept),
      ctResult: ct ? String(ct['result'] || '') : '',
      ctLine: ct ? `${roc(ct['at'])}${ct['how'] ? ' · ' + ct['how'] : ''}` : '',
      snoozeText: r.snooze ? `暫緩至 ${roc(r.snooze)}` : '',
      // 原版是 esc(note).slice(0,60) 會截斷 HTML entity；這裡先截再由 Angular 逸出
      noteShort: note.slice(0, 60),
    };
  }
}
