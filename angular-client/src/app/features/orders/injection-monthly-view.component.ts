import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiConfigService } from '@services/api-config.service';
import { formatDateToYYYYMM, getToday } from '@/utils/dateUtils';
import {
  DOW_LABEL,
  INJECTION_SHORT_NAME,
  SHIFT_LABEL,
  freqToDows,
  ruleKindLabel,
  type InjectionMonthlyCell,
  type InjectionMonthlyDay,
  type InjectionMonthlyMed,
  type InjectionMonthlyOrder,
  type InjectionMonthlyResponse,
  type InjectionMonthlyRow,
  type InjectionRuleKind,
} from './injection-shared';

type KindFilter = Extract<InjectionRuleKind, 'weekly' | 'interval' | 'dates'>;

/**
 * 當月針劑總覽：病人 × 日期 矩陣（GET /medications/injection-monthly）。
 * 藥品/頻率型態篩選交給後端（codes/kinds 參數），前端只負責呈現。
 */
@Component({
  selector: 'app-injection-monthly-view',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './injection-monthly-view.component.html',
  styleUrl: './injection-monthly-view.component.css',
})
export class InjectionMonthlyViewComponent implements OnInit {
  private readonly apiConfig = inject(ApiConfigService);

  readonly month = signal(formatDateToYYYYMM(new Date()));
  readonly shift = signal<'all' | 'early' | 'noon' | 'late'>('all');
  /** 已知藥品（來自回應；套藥品篩選後回應可能只剩部分，故採聯集保留 chips） */
  readonly meds = signal<InjectionMonthlyMed[]>([]);
  /** 停用的藥碼（預設全選 → 空集合） */
  readonly disabledCodes = signal<Set<string>>(new Set());
  readonly KIND_OPTIONS: { value: KindFilter; label: string }[] = [
    { value: 'weekly', label: '每週' },
    { value: 'interval', label: '隔週' },
    { value: 'dates', label: '指定日期' },
  ];
  readonly disabledKinds = signal<Set<KindFilter>>(new Set());

  readonly isLoading = signal(false);
  readonly loaded = signal(false);
  readonly errorMessage = signal('');
  readonly data = signal<InjectionMonthlyResponse | null>(null);

  readonly today = getToday();

  readonly days = computed<InjectionMonthlyDay[]>(() => this.data()?.days ?? []);
  readonly rows = computed<InjectionMonthlyRow[]>(() => this.data()?.rows ?? []);
  readonly activeMeds = computed(() => this.meds().filter((m) => !this.disabledCodes().has(m.code)));

  ngOnInit(): void {
    void this.load();
  }

  // ---------- 篩選 ----------
  onMonthChange(value: string): void {
    if (!value) return;
    this.month.set(value);
    void this.load();
  }

  onShiftChange(value: string): void {
    this.shift.set((value as 'all' | 'early' | 'noon' | 'late') || 'all');
    void this.load();
  }

  isMedActive(code: string): boolean {
    return !this.disabledCodes().has(code);
  }

  toggleMed(code: string): void {
    this.disabledCodes.update((set) => {
      const next = new Set(set);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
    void this.load();
  }

  isKindActive(kind: KindFilter): boolean {
    return !this.disabledKinds().has(kind);
  }

  toggleKind(kind: KindFilter): void {
    this.disabledKinds.update((set) => {
      const next = new Set(set);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
    void this.load();
  }

  // ---------- 載入 ----------
  async load(): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set('');
    try {
      const params = new URLSearchParams({ month: this.month() });
      if (this.shift() !== 'all') params.set('shift', this.shift());
      const known = this.meds();
      const active = known.filter((m) => !this.disabledCodes().has(m.code)).map((m) => m.code);
      if (known.length > 0 && active.length < known.length) {
        // 全部停用時仍送一個不存在的藥碼，讓後端回空（而非回全部）
        params.set('codes', active.length ? active.join(',') : '__none__');
      }
      const activeKinds = this.KIND_OPTIONS.map((k) => k.value).filter((k) => !this.disabledKinds().has(k));
      if (activeKinds.length < this.KIND_OPTIONS.length) {
        params.set('kinds', activeKinds.length ? activeKinds.join(',') : '__none__');
      }
      const res = await fetch(`${this.apiConfig.apiBaseUrl}/medications/injection-monthly?${params}`, {
        headers: this.apiConfig.getHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as InjectionMonthlyResponse;
      this.data.set({
        month: body.month || this.month(),
        days: Array.isArray(body.days) ? body.days : [],
        meds: Array.isArray(body.meds) ? body.meds : [],
        rows: Array.isArray(body.rows) ? body.rows : [],
      });
      // 藥品 chips 採聯集（回應可能因 codes 篩選只回部分）
      this.meds.update((prev) => {
        const map = new Map(prev.map((m) => [m.code, m]));
        for (const m of body.meds ?? []) if (!map.has(m.code)) map.set(m.code, m);
        return [...map.values()];
      });
      this.loaded.set(true);
    } catch (error) {
      console.error('載入當月針劑總覽失敗:', error);
      this.errorMessage.set('載入當月針劑總覽失敗，請稍後再試。');
      this.data.set(null);
    } finally {
      this.isLoading.set(false);
    }
  }

  // ---------- 顯示輔助 ----------
  shiftLabel(shift: string): string {
    return SHIFT_LABEL[shift] ?? shift ?? '-';
  }

  dowLabel(dow: number): string {
    return DOW_LABEL[dow] ?? '';
  }

  isWeekend(day: InjectionMonthlyDay): boolean {
    return day.dow === 6 || day.dow === 7 || day.dow === 0;
  }

  isToday(day: InjectionMonthlyDay): boolean {
    return day.date === this.today;
  }

  /** 該病人的洗腎日（dialysisDays 缺時以頻率字串推導；假設 dow 與 days 同為 1=一…7=日） */
  isDialysisDay(row: InjectionMonthlyRow, day: InjectionMonthlyDay): boolean {
    const dows = row.dialysisDays && row.dialysisDays.length ? row.dialysisDays : freqToDows(row.freq);
    if (!dows.length) return false;
    const dow = day.dow === 0 ? 7 : day.dow;
    return dows.includes(dow) || (dow === 7 && dows.includes(0));
  }

  cellsOf(row: InjectionMonthlyRow, day: InjectionMonthlyDay): InjectionMonthlyCell[] {
    return row.cells?.[day.date] ?? [];
  }

  chipLabel(cell: InjectionMonthlyCell): string {
    const short = INJECTION_SHORT_NAME[cell.orderCode] ?? (cell.orderName || cell.orderCode || '').slice(0, 4);
    return `${short} ${cell.dose ?? ''}`.trim();
  }

  chipTitle(cell: InjectionMonthlyCell): string {
    const base = `${cell.orderName || cell.orderCode} ${cell.dose ?? ''}${cell.unit ?? ''}`.trim();
    return cell.mismatch ? `${base}（非洗腎日）` : base;
  }

  /** 處方摘要一行：`藥名 劑量單位 · 規則文字` */
  orderLine(order: InjectionMonthlyOrder): string {
    const name = order.orderName || order.orderCode;
    const dose = `${order.dose ?? ''}${order.unit ?? ''}`.trim();
    const rule = order.effectiveRule || order.frequency || order.note || ruleKindLabel(order.ruleKind);
    return [name, dose, rule ? `· ${rule}` : ''].filter(Boolean).join(' ');
  }

  orderNeedsAttention(order: InjectionMonthlyOrder): boolean {
    return order.ruleKind === 'uncertain' || order.ruleKind === 'hold' || (order.warnings?.length ?? 0) > 0;
  }

  orderTooltip(order: InjectionMonthlyOrder): string {
    const lines: string[] = [];
    lines.push(`規則型態：${ruleKindLabel(order.ruleKind)}${order.ruleSource ? `（${order.ruleSource}）` : ''}`);
    if (order.frequency) lines.push(`頻率：${order.frequency}`);
    if (order.note) lines.push(`備註：${order.note}`);
    if (order.startDate) lines.push(`開始：${order.startDate}${order.endDate ? ` ～ ${order.endDate}` : '（持續）'}`);
    if (order.prescriber) lines.push(`開立：${order.prescriber}`);
    if (order.reason) lines.push(`說明：${order.reason}`);
    for (const w of order.warnings ?? []) lines.push(`⚠ ${w.message}`);
    return lines.join('\n');
  }

  ruleKindLabel(kind: string): string {
    return ruleKindLabel(kind);
  }

  trackRow(_: number, row: InjectionMonthlyRow): string {
    return row.patientId;
  }

  trackDay(_: number, day: InjectionMonthlyDay): string {
    return day.date;
  }

  // ---------- 列印：另開視窗輸出純表格（避免動到全域樣式） ----------
  print(): void {
    const data = this.data();
    if (!data || !data.rows.length) {
      alert('沒有可列印的資料。');
      return;
    }
    const esc = (s: unknown): string =>
      String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    const shiftText = this.shift() === 'all' ? '全部班別' : `${this.shiftLabel(this.shift())}班`;
    const headDays = data.days
      .map(
        (d) =>
          `<th class="day${this.isWeekend(d) ? ' weekend' : ''}">${d.day}<br><small>${esc(this.dowLabel(d.dow))}</small></th>`,
      )
      .join('');
    const bodyRows = data.rows
      .map((row) => {
        const summary = row.orders
          .map((o) => `<div>${this.orderNeedsAttention(o) ? '⚠ ' : ''}${esc(this.orderLine(o))}</div>`)
          .join('');
        const cells = data.days
          .map((d) => {
            const chips = this.cellsOf(row, d)
              .map((c) => `<span class="chip${c.mismatch ? ' mismatch' : ''}">${esc(this.chipLabel(c))}</span>`)
              .join('');
            return `<td class="day${this.isDialysisDay(row, d) ? ' dialysis' : ''}${this.isWeekend(d) ? ' weekend' : ''}">${chips}</td>`;
          })
          .join('');
        return `<tr><td>${esc(this.shiftLabel(row.shift))}</td><td>${esc(row.bedNum ?? '')}</td><td class="name">${esc(row.patientName)}</td><td>${esc(row.freq)}</td><td class="summary">${summary}</td>${cells}</tr>`;
      })
      .join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>當月針劑總覽 ${esc(data.month)}</title>
<style>
  @page { size: A3 landscape; margin: 8mm; }
  body { font-family: "Microsoft JhengHei", Arial, sans-serif; font-size: 10px; margin: 0; }
  h2 { font-size: 14px; margin: 0 0 6px; }
  .meta { color: #555; margin-bottom: 6px; }
  table { border-collapse: collapse; width: 100%; table-layout: auto; }
  th, td { border: 1px solid #999; padding: 2px 3px; text-align: center; vertical-align: top; }
  th { background: #eee; }
  td.name { white-space: nowrap; font-weight: bold; }
  td.summary { text-align: left; white-space: nowrap; max-width: 220px; overflow: hidden; }
  th.day, td.day { min-width: 26px; }
  .weekend { background: #f3f3f3; }
  td.dialysis { background: #eef6ff; }
  .chip { display: inline-block; border: 1px solid #888; border-radius: 3px; padding: 0 2px; margin: 1px 0; white-space: nowrap; font-size: 9px; }
  .chip.mismatch { border-color: #d32f2f; color: #b71c1c; }
  tr { page-break-inside: avoid; }
</style></head><body>
<h2>當月針劑總覽 ${esc(data.month)}</h2>
<div class="meta">${esc(shiftText)}　藥品：${esc(this.activeMeds().map((m) => m.name).join('、') || '-')}　共 ${data.rows.length} 人　列印時間 ${esc(new Date().toLocaleString('sv-SE').slice(0, 16))}</div>
<table><thead><tr><th>班別</th><th>床號</th><th>姓名</th><th>洗腎日</th><th>處方摘要</th>${headDays}</tr></thead><tbody>${bodyRows}</tbody></table>
<script>window.onload = function(){ window.print(); };</script>
</body></html>`;
    const win = window.open('', '_blank');
    if (!win) {
      alert('無法開啟列印視窗，請允許彈出視窗。');
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
  }
}
