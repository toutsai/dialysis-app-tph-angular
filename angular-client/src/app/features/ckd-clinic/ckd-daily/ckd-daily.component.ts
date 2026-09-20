import { Component, EventEmitter, OnInit, Output, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CkdApiService, CkdDaily, CkdMergedLab, CkdRecType, CkdRowA, CkdRowB } from '@app/core/services/ckd-api.service';
import { CkdRecordsComponent } from '../ckd-records/ckd-records.component';
import { exportACsv, exportBCsv, exportDayEnrollXlsx, exportPharmCsv } from '../ckd-export';

type AFilter = 'all' | 'pre' | 'early' | 'due' | 'wait' | 'ann' | 'miss' | 'alert';
type BFilter = 'all' | 'pre' | 'early' | 'check' | 'nodata' | 'no' | 'noen' | 'closed' | 'ord' | 'ext';

/** 統計列（原版 renderA/renderB 的 tally；篩選定義 = engine.js A_FILTERS / B_FILTERS） */
const A_FILTERS: Record<AFilter, (x: CkdRowA) => boolean> = {
  all: () => true, pre: x => x.prog === 'pre', early: x => x.prog === 'early',
  due: x => x.status === 'ok' || x.status === 'over', wait: x => x.status === 'wait',
  ann: x => x.ann.ok, miss: x => x.miss.length > 0, alert: x => x.alerts.length > 0,
};
const B_FILTERS: Record<BFilter, (x: CkdRowB) => boolean> = {
  all: () => true,
  pre: x => x.verdict === 'pre' && !x.noEn, early: x => x.verdict === 'early' && !x.noEn,
  check: x => x.verdict === 'check' && !x.noEn, nodata: x => x.verdict === 'nodata' && !x.noEn,
  no: x => x.verdict === 'no' && !x.noEn,
  noen: x => !!x.noEn, closed: x => !!x.closed,
  ord: x => (x.verdict === 'pre' || x.verdict === 'early') && !x.noEn && (x.ord || []).length > 0,
  ext: x => !!x.ext && x.ext.result === '已於他院收案',
};
const STB: Record<string, [string, string]> = { ok: ['early', '可申報追蹤'], over: ['pre', '逾期 應追蹤'], cap: ['none', '年度已達上限'], wait: ['wait', '未滿間隔'], none: ['none', '資料不足'], dkd: ['none', 'DKD 收案 · 不適用'] };
const BREAKS = [0, 15, 30, 45, 60, 90, 120];

/**
 * 門診 CKD：明日追蹤（A 已收案可否追蹤）＋ 收案評估（B 未收案可否收案）＋ 個案紀錄（E）
 * 判定全在後端（services/ckd/engine.js，照單機版）；本元件只畫：診次按鈕列、統計列篩選、兩張表、判定欄。
 * 姓名／判定欄行動列可跳到下方個案紀錄區（原版 gotoRecords）；紀錄異動後重判讀。
 */
@Component({
  selector: 'app-ckd-daily',
  standalone: true,
  imports: [CommonModule, CkdRecordsComponent],
  templateUrl: './ckd-daily.component.html',
  styleUrl: './ckd-daily.component.css',
})
export class CkdDailyComponent implements OnInit {
  private readonly ckdApi = inject(CkdApiService);
  @ViewChild(CkdRecordsComponent) records?: CkdRecordsComponent;

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly daily = signal<CkdDaily | null>(null);
  readonly aFilter = signal<AFilter>('all');
  readonly bFilter = signal<BFilter>('all');
  /** 展開「判定依據」的列（mrn） */
  readonly expanded = signal<ReadonlySet<string>>(new Set());

  readonly aTally = computed(() => {
    const A = this.daily()?.A || [];
    const cnt = (k: string) => A.filter(x => x.status === k).length;
    const t: { k: string; v: number; c?: string; f: AFilter }[] = [
      { k: '已收案', v: A.length, f: 'all' },
      { k: 'Pre-ESRD', v: A.filter(x => x.prog === 'pre').length, c: 'pre', f: 'pre' },
      { k: 'Early-CKD', v: A.filter(x => x.prog === 'early').length, c: 'early', f: 'early' },
      { k: '可申報追蹤', v: cnt('ok') + cnt('over'), c: 'early', f: 'due' },
      { k: '未滿間隔', v: cnt('wait'), c: 'wait', f: 'wait' },
      { k: '年度評估到期', v: A.filter(x => x.ann.ok).length, c: 'pre', f: 'ann' },
      { k: '必要檢驗缺項', v: A.filter(x => x.miss.length).length, c: 'wait', f: 'miss' },
      { k: '轉出/獎勵提醒', v: A.filter(x => x.alerts.length).length, c: 'wait', f: 'alert' },
    ];
    return t;
  });
  readonly bTally = computed(() => {
    const B = this.daily()?.B || [];
    const cnt = (k: string) => B.filter(x => x.verdict === k && !x.noEn).length;
    const t: { k: string; v: number; c?: string; f: BFilter }[] = [
      { k: '未收案', v: B.length, f: 'all' },
      { k: '符合 Pre-ESRD', v: cnt('pre'), c: 'pre', f: 'pre' },
      { k: '符合 Early-CKD', v: cnt('early'), c: 'early', f: 'early' },
      { k: '待補檢驗', v: cnt('check'), c: 'wait', f: 'check' },
      { k: '無檢驗資料', v: cnt('nodata'), c: 'none', f: 'nodata' },
      { k: '須先開單補驗', v: B.filter(B_FILTERS.ord).length, c: 'wait', f: 'ord' },
      { k: '不予收案', v: B.filter(x => !!x.noEn).length, c: 'none', f: 'noen' },
      { k: '已外院收案', v: B.filter(B_FILTERS.ext).length, c: 'pre', f: 'ext' },
      { k: '目前不符', v: cnt('no'), c: 'none', f: 'no' },
      { k: '曾收案已結案', v: B.filter(x => x.closed).length, c: 'wait', f: 'closed' },
    ];
    return t;
  });
  readonly rowsA = computed(() => (this.daily()?.A || []).filter(A_FILTERS[this.aFilter()]));
  readonly rowsB = computed(() => (this.daily()?.B || []).filter(B_FILTERS[this.bFilter()]));

  /** 診次按鈕：本科各醫師 + 全部醫師（多醫師時）+ 他科掛號已收案 */
  readonly sessionButtons = computed(() => {
    const dl = this.daily();
    if (!dl) return [];
    const groups = dl.sessions.groups;
    const cur = dl.date, sel = dl.doctorSel;
    const dayDocs = groups.filter(g => g.date === cur);
    const multi = dayDocs.length > 1;
    const out = groups.map(g => ({
      date: g.date, doctor: g.doctor, label: g.doctor || '未註明醫師', n: g.n,
      on: g.date === cur && (sel === g.doctor || (!sel && !multi)),
    }));
    if (multi) out.push({ date: cur, doctor: '', label: '全部醫師', n: dayDocs.reduce((a, g) => a + g.n, 0), on: !sel });
    const others = dl.sessions.others[cur];
    if (others) out.push({ date: cur, doctor: dl.otherSession, label: '他科掛號已收案', n: others, on: !!sel && sel.indexOf(dl.otherSession) === 0 });
    return out;
  });
  /**
   * 過去日期的門診預設收合（2026-09-20 使用者要求）：清單會累積好幾週的門診日，個管師平常只看今天以後的。
   * 收合時仍保留「目前選中的那一天」的按鈕，才看得出現在判讀的是哪一天、也能切同日其他醫師。
   */
  readonly today = new Date().toLocaleDateString('sv-SE');
  readonly showPast = signal(false);
  /** 收合時實際被藏起來的天數（不含目前選中的那天） */
  readonly pastDays = computed(() => {
    const cur = this.daily()?.date;
    return new Set(this.sessionButtons().filter(b => b.date < this.today && b.date !== cur).map(b => b.date)).size;
  });
  readonly visibleButtons = computed(() => {
    const all = this.sessionButtons();
    if (this.showPast()) return all;
    const cur = this.daily()?.date;
    return all.filter(b => b.date >= this.today || b.date === cur);
  });

  readonly otherSubs = computed(() => {
    const dl = this.daily();
    if (!dl || !dl.doctorSel || dl.doctorSel.indexOf(dl.otherSession) !== 0) return [];
    return dl.sessions.otherGroups[dl.date] || [];
  });

  ngOnInit(): void {
    this.load();
  }

  async load(date?: string, doctor?: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.daily.set(await this.ckdApi.getDaily(date, doctor));
    } catch (e: any) {
      this.error.set(e?.error?.message || e?.message || '判讀失敗');
    } finally {
      this.loading.set(false);
    }
  }

  select(date: string, doctor: string): void {
    void this.load(date, doctor);
  }

  selectOtherSub(dept: string, doctor: string): void {
    const dl = this.daily();
    if (!dl) return;
    void this.load(dl.date, `${dl.otherSession}|${dept}|${doctor}`);
  }

  toggle(mrn: string): void {
    const next = new Set(this.expanded());
    if (next.has(mrn)) next.delete(mrn); else next.add(mrn);
    this.expanded.set(next);
  }

  // ---------- 病人彙整視窗（2026-09-20）：點姓名 → 交給外層開視窗，帶本頁判讀日讓判讀與這一列一致 ----------
  @Output() openPatient = new EventEmitter<{ mrn: string; date: string }>();

  openPatientDialog(mrn: string): void {
    this.openPatient.emit({ mrn, date: this.daily()?.date || '' });
  }

  // ---------- 個案紀錄（原版 data-gorec / data-vpncheck） ----------

  /** 跳到下方個案紀錄區；type 有值時直接開該類型的新增表單 */
  openRecords(mrn: string, type: CkdRecType | null = null): void {
    this.records?.open(mrn, type);
  }

  /** 判定欄行動列被點：vpn → 開外院收案查核表單；rec → 只跳到該病人紀錄 */
  onAct(mrn: string, act: { vpn?: string; rec?: string } | null): void {
    if (!act) return;
    if (act.vpn) this.openRecords(mrn, 'extEnroll');
    else if (act.rec) this.openRecords(mrn, null);
  }

  /** 紀錄異動後：以目前診次重判讀（原版 afterRecChange → run()） */
  onRecordsChanged(): void {
    const dl = this.daily();
    void this.load(dl?.date, dl?.doctorSel);
  }

  // ---------- 匯出（原版 btnCsvA / btnCsvB / btnXlsxDay） ----------
  readonly exportMsg = signal<string | null>(null);

  exportA(): void {
    const dl = this.daily();
    if (dl) exportACsv(dl.A, dl.date);
  }

  exportB(): void {
    const dl = this.daily();
    if (dl) exportBCsv(dl.B, dl.date);
  }

  /** 藥師名單（原版 btnPharm）：僅 Pre-ESRD，A 區已收案 + B 區今日判定符合（排除已於他院收案） */
  exportPharm(): void {
    const dl = this.daily();
    if (!dl) return;
    this.exportMsg.set(null);
    const n = exportPharmCsv(dl.A, dl.B, dl.date);
    if (!n) this.exportMsg.set('本判讀日沒有 Pre-ESRD 病人(藥師名單僅含 Pre-ESRD,不含 Early-CKD)。');
  }

  async exportDayXlsx(): Promise<void> {
    const dl = this.daily();
    if (!dl) return;
    this.exportMsg.set(null);
    try {
      const n = await exportDayEnrollXlsx(dl.B, dl.date);
      if (!n) this.exportMsg.set('當日沒有符合收案條件的病人（已排除他院收案與不予收案者）。');
    } catch (e: any) {
      this.exportMsg.set(e?.message || '匯出失敗');
    }
  }

  /** B 區判定依據內的 VPN 註記（原版 .vpnnote 三態） */
  vpnNote(r: CkdRowB): { cls: string; text: string } | null {
    const e = r.ext;
    if (!e) return null;
    if (e.result === '已於他院收案') return { cls: 'v-ext', text: `VPN ${e.hospital || '他院'}${e.extProg ? ' · ' + e.extProg : ''} · 查於 ${e.at}` };
    if (e.result === '未於他院收案') return { cls: 'v-ok', text: `VPN 已查 ${e.at} 無他院收案` };
    return { cls: 'v-pend', text: `VPN 查詢中 ${e.at}` };
  }

  // ---------- 顯示輔助（原版 ruler / gauge / lv / roc） ----------

  roc(s: string | null | undefined): string {
    if (!s) return '—';
    const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${String(+m[1] - 1911).padStart(3, '0')}/${m[2]}/${m[3]}` : String(s);
  }

  /** eGFR 尺標位置：左＝G1 → 右＝G5（與腎功能惡化方向一致） */
  rulerPos(egfr: number | null): number {
    if (egfr == null) return 0;
    let pos = 0;
    for (let i = 0; i < BREAKS.length - 1; i++) {
      if (egfr >= BREAKS[i] && egfr < BREAKS[i + 1]) { pos = (i + (egfr - BREAKS[i]) / (BREAKS[i + 1] - BREAKS[i])) / 6; break; }
      if (egfr >= BREAKS[BREAKS.length - 1]) pos = 1;
    }
    return (1 - Math.max(0, Math.min(1, pos))) * 100;
  }

  gaugePct(gap: number | null, need: number | null): number {
    if (gap == null || !need) return 0;
    return Math.max(2, Math.min(100, gap / need * 100));
  }

  gaugeCls(r: CkdRowA): string {
    const over = this.daily()?.cfg.over || 180;
    if (r.gap == null || r.need == null) return '';
    return r.gap > over ? 'over' : r.gap >= r.need ? 'done' : '';
  }

  statusBadge(status: string): [string, string] {
    return STB[status] || ['none', status];
  }

  /** 檢驗值＋旗標＋定性 */
  lv(lab: CkdMergedLab | null, key: string): { v: string; flag: string } | null {
    if (!lab || lab.v[key] == null) return null;
    return { v: `${(lab.q && lab.q[key]) || ''}${lab.v[key]}`, flag: lab.flag[key] || '' };
  }

  stageText(stage: string | null): string {
    return stage ? stage.replace('G', 'Stage ') : '';
  }

  alertCls(t: string): string {
    return t === '獎勵' ? 'gd' : t === '分期' ? 'nt' : 'wn';
  }

  fmt1(n: number | null | undefined): string {
    return n == null ? '—' : n.toFixed(1);
  }

  /** 缺項摘要（原版 missBox：ord 須開單／bed 診間登錄／unk 待核對） */
  missHead(r: { ord: string[]; bed: string[]; unk: string[] }): string {
    const n = r.ord.length;
    if (!n && !r.bed.length && !r.unk.length) return '✓ 必要項目齊全';
    return n ? `缺 ${n} 項` : `無法核對 ${r.unk.length} 項（未匯入檢驗報告）`;
  }
}
