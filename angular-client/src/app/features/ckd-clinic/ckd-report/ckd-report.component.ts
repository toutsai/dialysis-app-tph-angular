import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CkdApiService, CkdReport } from '@app/core/services/ckd-api.service';
import { exportReportCsv, roc } from '../ckd-export';

/** 卡片一列：k = 列標題、v = 數值格（.mr-v）、s = 百分比格（.mr-s，可無） */
interface MrRow { k: string; v: string | number; s?: string }
interface MrCard { title: string; rows: MrRow[] }

/** 卡② 固定列序（缺值填 0），最後補「未知(無 eGFR)」 */
const STAGE_ORDER = ['G1', 'G2', 'G3a', 'G3b', 'G4', 'G5'];

/** 原版 report.js:88 */
function pct(a: number, b: number): string {
  return b ? Math.round((a / b) * 100) + '%' : '—';
}

/**
 * 門診 CKD：月報儀表板（原版第四區 secM / report.js）
 * 收案現況、分期分布、追蹤品質、年度評估、Early-CKD 完整追蹤率、檢驗完整率、獎勵候選、透析準備、本月入帳。
 * 全部指標在後端 GET /ckd/report 算好，本元件只畫九張卡與 CSV；換月份重新取數。
 * 與原版差異：卡⑧「透析準備」門檻走 settings.rrtEgfr（原版寫死 20，spec §4.7-1）。
 */
@Component({
  selector: 'app-ckd-report',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './ckd-report.component.html',
  styleUrl: './ckd-report.component.css',
})
export class CkdReportComponent implements OnInit {
  private readonly ckdApi = inject(CkdApiService);

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly report = signal<CkdReport | null>(null);
  /** <input type="month"> 的值；初值＝回應的 ym（原版 report.js:92 只在空值時填） */
  readonly month = signal<string>('');

  /** 卡①～⑧（卡⑨ 入帳表在樣板另外畫，需跨滿寬與右對齊表格） */
  readonly cards = computed<MrCard[]>(() => {
    const P = this.report();
    if (!P) return [];
    const en = P.enrolled;
    const out: MrCard[] = [];

    // ① 收案現況(開放中)
    const c1: MrRow[] = [
      { k: '已收案', v: en },
      { k: 'Pre-ESRD', v: P.pre, s: pct(P.pre, en) },
      { k: 'Early-CKD(含 DKD/AKD)', v: P.early, s: pct(P.early, en) },
      { k: '其中糖尿病(DKD/P70xx)', v: P.dm, s: pct(P.dm, en) },
      { k: `本月新收案 ${P.ym}`, v: P.newM },
      { k: '近 12 個月新收案', v: P.newY },
      { k: '本月結案', v: P.closeMn },
    ];
    Object.keys(P.closeM || {}).sort().forEach((k) => {
      c1.push({ k: '　' + ((P.closeLabels && P.closeLabels[k]) || k), v: P.closeM[k] });
    });
    out.push({ title: '收案現況(開放中)', rows: c1 });

    // ② 分期分布(最近 eGFR)
    const c2: MrRow[] = STAGE_ORDER.map((g) => {
      const v = P.stageCnt?.[g] || 0;
      return { k: g, v, s: pct(v, en) };
    });
    const unk = P.stageCnt?.['未知'] || 0;
    c2.push({ k: '未知(無 eGFR)', v: unk, s: pct(unk, en) });
    out.push({ title: '分期分布(最近 eGFR)', rows: c2 });

    // ③ 追蹤品質
    const c3: MrRow[] = [
      { k: `準時追蹤(到期 + 寬限 ${P.grace} 天內)`, v: P.onTime, s: pct(P.onTime, en) },
      { k: '逾期 > 180 天', v: P.over180, s: pct(P.over180, en) },
      { k: '逾期 > 365 天(應結案)', v: P.over365, s: pct(P.over365, en) },
      { k: '無照護日期', v: P.noGap },
    ];
    if (P.recall) c3.push({ k: '召回:待聯絡 / 剛到期 / 已預約', v: `${P.recall.call} / ${P.recall.grace} / ${P.recall.appt}` });
    out.push({ title: '追蹤品質', rows: c3 });

    // ④ 年度評估
    out.push({
      title: '年度評估(P3404C / P7002C)',
      rows: [
        { k: '收案滿一年應評估', v: P.annDue },
        { k: '近 12 個月已申報', v: P.annDone, s: pct(P.annDone, P.annDue) },
        { k: '目前可申報(條件已齊)', v: P.annReady },
      ],
    });

    // ⑤ Early-CKD 完整追蹤率
    const c5: MrRow[] = [
      { k: '分母(排除 Q4 新收案)', v: P.kpi.n },
      { k: '達成(P4302C 次數達標)', v: P.kpi.ok, s: pct(P.kpi.ok, P.kpi.n) },
      { k: '前一年度收案者本年度已追蹤(退場線 20%)', v: P.lastYearOk, s: pct(P.lastYearOk, P.lastYearN) },
    ];
    (P.kpi.docs || []).slice(0, 8).forEach((d) => {
      c5.push({ k: '　' + d.doc, v: `${d.ok} / ${d.n}`, s: pct(d.ok, d.n) + (d.n >= 5 && d.ok / d.n < 0.5 ? ' ⚠' : '') });
    });
    c5.push({ k: P.billYear ? `(入帳檔涵蓋 ${P.billSpan};未涵蓋的月份會低估)` : '(本年度尚無入帳資料,比率暫不可信)', v: '' });
    out.push({ title: `Early-CKD 完整追蹤率 ${P.yNow}(健保門檻 ≥ 50%)`, rows: c5 });

    // ⑥ 檢驗完整率
    out.push({
      title: '檢驗完整率',
      rows: [
        { k: '必要檢驗於有效窗內', v: P.labOk, s: pct(P.labOk, en) },
        { k: 'eGFR 90 天內', v: P.eg90, s: pct(P.eg90, en) },
        { k: '蛋白尿(UPCR/UACR)180 天內', v: P.prot180, s: pct(P.prot180, en) },
      ],
    });

    // ⑦ 獎勵候選
    const c7: MrRow[] = [{ k: '可評估獎勵費', v: P.reward }];
    Object.keys(P.rewardCodes || {}).sort().forEach((k) => c7.push({ k: '　' + k, v: P.rewardCodes[k] }));
    out.push({ title: '獎勵候選(依判讀提醒)', rows: c7 });

    // ⑧ 透析準備（門檻連動 settings.rrtEgfr）
    out.push({
      title: `透析準備(eGFR < ${P.rrtEgfr})`,
      rows: [
        { k: '人數', v: P.low },
        { k: '已談 SDM', v: P.hasSdm, s: pct(P.hasSdm, P.low) },
        { k: '已規劃/建立通路', v: P.hasAcc, s: pct(P.hasAcc, P.low) },
      ],
    });

    return out;
  });

  readonly footNote = computed(() => {
    const P = this.report();
    return P
      ? `基準日 = 判讀日 ${roc(P.today)};「本月」可在上方換月份。準時追蹤率以判讀日當下的間隔計算;年度評估以入帳檔為準,未匯入入帳檔時會偏低。`
      : '';
  });

  ngOnInit(): void {
    void this.load();
  }

  async load(ym?: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const r = await this.ckdApi.getReport(ym);
      this.report.set(r);
      if (!this.month()) this.month.set(r.ym);
    } catch (e: any) {
      this.error.set(e?.error?.message || e?.message || '月報失敗');
    } finally {
      this.loading.set(false);
    }
  }

  onMonth(event: Event): void {
    const v = (event.target as HTMLInputElement).value || '';
    this.month.set(v);
    void this.load(v || undefined);
  }

  refresh(): void {
    void this.load(this.month() || undefined);
  }

  exportCsv(): void {
    const P = this.report();
    if (P) exportReportCsv(P);
  }

  /** 點數欄千分位（原版 pts.toLocaleString()） */
  num(n: number): string {
    return (n || 0).toLocaleString();
  }
}
