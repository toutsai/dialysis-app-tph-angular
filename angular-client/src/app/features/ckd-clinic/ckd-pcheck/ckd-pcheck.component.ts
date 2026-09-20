import { Component, EventEmitter, OnInit, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CkdApiService, CkdPcheck, CkdPcheckRow } from '@app/core/services/ckd-api.service';
import { exportPcheckCsv, roc } from '../ckd-export';

/**
 * 門診 CKD：檢核 P 碼輸入（原版工作台個管師側欄第三個佇列 buildPcheck / renderPcheck）
 * 前一天備診 → 隔天匯入前一天的醫令明細 → 把判讀日切到前一天的診次，逐人比對前日判定與當日入帳。
 * 判定全在後端 GET /ckd/pcheck（後端重跑一次「拿掉當日入帳」的判讀），本元件只畫診次列與表格。
 */
@Component({
  selector: 'app-ckd-pcheck',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './ckd-pcheck.component.html',
  styleUrl: './ckd-pcheck.component.css',
})
export class CkdPcheckComponent implements OnInit {
  private readonly ckdApi = inject(CkdApiService);
  @Output() openRecords = new EventEmitter<string>();

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly pcheck = signal<CkdPcheck | null>(null);

  /** 診次按鈕：本科各醫師 + 全部醫師（多醫師時）+ 他科掛號已收案（同 ckd-daily 的 dateBar） */
  readonly sessionButtons = computed(() => {
    const p = this.pcheck();
    if (!p) return [];
    const groups = p.sessions.groups;
    const cur = p.date, sel = p.doctorSel;
    const dayDocs = groups.filter(g => g.date === cur);
    const multi = dayDocs.length > 1;
    const out = groups.map(g => ({
      date: g.date, doctor: g.doctor, label: g.doctor || '未註明醫師', n: g.n,
      on: g.date === cur && (sel === g.doctor || (!sel && !multi)),
    }));
    if (multi) out.push({ date: cur, doctor: '', label: '全部醫師', n: dayDocs.reduce((a, g) => a + g.n, 0), on: !sel });
    const others = p.sessions.others[cur];
    if (others) out.push({ date: cur, doctor: p.otherSession, label: '他科掛號已收案', n: others, on: !!sel && sel.indexOf(p.otherSession) === 0 });
    return out;
  });

  /**
   * 過去日期預設收合（2026-09-20 使用者要求，同 ckd-daily）。
   * 本頁的用途就是回頭檢核「前一個門診日」，所以最近一個過去門診日不收；更早的才收進「過去日期」。目前選中的那天一律保留。
   */
  readonly today = new Date().toLocaleDateString('sv-SE');
  readonly showPast = signal(false);
  private readonly lastPastDate = computed(() => this.sessionButtons().map(b => b.date).filter(d => d < this.today).sort().pop() || '');
  private isFolded(date: string): boolean {
    return date < this.today && date !== this.lastPastDate();
  }
  /** 收合時實際被藏起來的天數（不含目前選中的那天） */
  readonly pastDays = computed(() => {
    const cur = this.pcheck()?.date;
    return new Set(this.sessionButtons().filter(b => this.isFolded(b.date) && b.date !== cur).map(b => b.date)).size;
  });
  readonly visibleButtons = computed(() => {
    const all = this.sessionButtons();
    if (this.showPast()) return all;
    const cur = this.pcheck()?.date;
    return all.filter(b => !this.isFolded(b.date) || b.date === cur);
  });

  readonly otherSubs = computed(() => {
    const p = this.pcheck();
    if (!p || !p.doctorSel || p.doctorSel.indexOf(p.otherSession) !== 0) return [];
    return p.sessions.otherGroups[p.date] || [];
  });

  /** 表格 = rows 接 extra（原版 P.rows.concat(P.extra)：名單外入帳不參與排序，接在最後） */
  readonly allRows = computed<CkdPcheckRow[]>(() => {
    const p = this.pcheck();
    return p ? p.rows.concat(p.extra) : [];
  });

  ngOnInit(): void {
    void this.load();
  }

  async load(date?: string, doctor?: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.pcheck.set(await this.ckdApi.getPcheck(date, doctor));
    } catch (e: any) {
      this.error.set(e?.error?.message || e?.message || '檢核失敗');
    } finally {
      this.loading.set(false);
    }
  }

  select(date: string, doctor: string): void {
    void this.load(date, doctor);
  }

  selectOtherSub(dept: string, doctor: string): void {
    const p = this.pcheck();
    if (!p) return;
    void this.load(p.date, `${p.otherSession}|${dept}|${doctor}`);
  }

  exportCsv(): void {
    const p = this.pcheck();
    if (p) exportPcheckCsv(this.allRows(), p.labels, p.date);
  }

  // ---------- 顯示輔助 ----------
  roc = roc;

  kindText(kind: 'A' | 'B' | 'X'): string {
    return kind === 'A' ? '已收案' : kind === 'B' ? '未收案' : '名單外';
  }

  label(res: CkdPcheckRow['res']): string {
    return this.pcheck()?.labels?.[res]?.[0] || res;
  }

  labelCls(res: CkdPcheckRow['res']): string {
    return this.pcheck()?.labels?.[res]?.[1] || 'pc-dim';
  }

  price(n: number | null): string {
    return n == null || !n ? '' : n.toLocaleString();
  }
}
