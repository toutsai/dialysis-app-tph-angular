import { Component, computed, Input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { addMonths, formatDateToYYYYMMDD, getToday } from '@/utils/dateUtils';
import {
  changePillClass,
  changeTypeLabel,
  formatFieldChange,
  formatUploadedAt,
  orderTypeLabel,
  ruleKindLabel,
  type InjectionChangeRecord,
  type InjectionFieldChange,
  type InjectionHistoryOrder,
  type InjectionHistoryResponse,
} from './injection-shared';

interface TimelineSegment {
  id: string;
  /** 百分比 */
  left: number;
  width: number;
  lane: number;
  label: string;
  title: string;
  openEnded: boolean;
  orderType: string;
  attention: boolean;
}

interface TimelineGroup {
  orderCode: string;
  orderName: string;
  orderType: string;
  laneCount: number;
  segments: TimelineSegment[];
}

interface AxisTick {
  left: number;
  label: string;
  showLabel: boolean;
}

const LANE_HEIGHT = 24;
const MS_PER_DAY = 86400000;

/**
 * 藥物時間軸：一藥一列，處方區間以 CSS 百分比橫條呈現（純 CSS，不用圖表庫）。
 * 資料由父層（藥囑查詢 → 個人搜尋）透過 @Input 傳入（GET /medications/injection-history/:patientId）。
 */
@Component({
  selector: 'app-injection-history-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './injection-history-panel.component.html',
  styleUrl: './injection-history-panel.component.css',
})
export class InjectionHistoryPanelComponent {
  private readonly historySignal = signal<InjectionHistoryResponse | null>(null);
  private readonly patientNameSignal = signal('');

  @Input() set history(value: InjectionHistoryResponse | null | undefined) {
    this.historySignal.set(value ?? null);
  }
  @Input() set patientName(value: string | null | undefined) {
    this.patientNameSignal.set(value ?? '');
  }
  @Input() isLoading = false;

  readonly displayName = computed(() => this.patientNameSignal());
  readonly orders = computed<InjectionHistoryOrder[]>(() => this.historySignal()?.orders ?? []);
  readonly changes = computed<InjectionChangeRecord[]>(() => {
    const list = [...(this.historySignal()?.changes ?? [])];
    // 最新在前（uploadedAt 為本地時間字串，可直接字串比較）
    list.sort((a, b) => String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')));
    return list;
  });

  readonly today = getToday();

  /** 軸起訖（日）：最早開始日所在月初 ～ 今天 + 1 個月的次月月初 */
  readonly axis = computed(() => {
    const orders = this.orders();
    const todayDate = this.parse(this.today);
    let minStart: Date | null = null;
    for (const o of orders) {
      const d = o.startDate ? this.parse(o.startDate) : null;
      if (d && (!minStart || d < minStart)) minStart = d;
    }
    const startBase = minStart ?? addMonths(todayDate, -6);
    const start = new Date(startBase.getFullYear(), startBase.getMonth(), 1);
    const endBase = addMonths(todayDate, 1);
    const end = new Date(endBase.getFullYear(), endBase.getMonth() + 1, 1);
    const spanDays = Math.max(1, this.daysBetween(start, end));
    return { start, end, spanDays };
  });

  readonly ticks = computed<AxisTick[]>(() => {
    const { start, end, spanDays } = this.axis();
    const out: AxisTick[] = [];
    const cursor = new Date(start);
    const totalMonths = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
    const labelEvery = Math.max(1, Math.ceil(totalMonths / 18));
    let i = 0;
    while (cursor < end) {
      const left = (this.daysBetween(start, cursor) / spanDays) * 100;
      out.push({
        left,
        label: `${cursor.getFullYear()}/${String(cursor.getMonth() + 1).padStart(2, '0')}`,
        showLabel: i % labelEvery === 0,
      });
      cursor.setMonth(cursor.getMonth() + 1);
      i++;
    }
    return out;
  });

  readonly todayLeft = computed(() => {
    const { start, spanDays } = this.axis();
    return this.clampPct((this.daysBetween(start, this.parse(this.today)) / spanDays) * 100);
  });

  /** 依藥碼分組：針劑在前、口服在後；同組內依開始日排序並分車道避免重疊 */
  readonly groups = computed<TimelineGroup[]>(() => {
    const { start, end, spanDays } = this.axis();
    const map = new Map<string, TimelineGroup>();
    const sorted = [...this.orders()].sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
    for (const o of sorted) {
      const key = o.orderCode || o.orderName || o.id;
      let group = map.get(key);
      if (!group) {
        group = { orderCode: o.orderCode, orderName: o.orderName || o.rawName || o.orderCode, orderType: o.orderType, laneCount: 1, segments: [] };
        map.set(key, group);
      }
      const segStart = o.startDate ? this.parse(o.startDate) : start;
      const segEndRaw = o.endDate ? this.parse(o.endDate) : null;
      // endDate 為含當日 → +1 天；持續中延伸到軸尾
      const segEnd = segEndRaw ? new Date(segEndRaw.getTime() + MS_PER_DAY) : end;
      const s = Math.max(0, this.daysBetween(start, segStart));
      const e = Math.min(spanDays, Math.max(s + 1, this.daysBetween(start, segEnd)));
      const left = this.clampPct((s / spanDays) * 100);
      const width = Math.max(0.4, this.clampPct((e / spanDays) * 100) - left);
      group.segments.push({
        id: o.id,
        left,
        width,
        lane: 0,
        label: this.segmentLabel(o),
        title: this.segmentTitle(o),
        openEnded: !o.endDate,
        orderType: o.orderType,
        attention: o.ruleKind === 'uncertain' || o.ruleKind === 'hold',
      });
    }
    // 車道配置（greedy）：與同車道前一段重疊就換下一道
    for (const group of map.values()) {
      const laneEnds: number[] = [];
      for (const seg of group.segments) {
        let lane = laneEnds.findIndex((endPct) => endPct <= seg.left + 0.01);
        if (lane === -1) {
          lane = laneEnds.length;
          laneEnds.push(0);
        }
        laneEnds[lane] = seg.left + seg.width;
        seg.lane = lane;
      }
      group.laneCount = Math.max(1, laneEnds.length);
    }
    const typeRank = (t: string): number => (t === 'injection' ? 0 : t === 'oral' ? 1 : 2);
    return [...map.values()].sort(
      (a, b) => typeRank(a.orderType) - typeRank(b.orderType) || a.orderName.localeCompare(b.orderName),
    );
  });

  readonly hasData = computed(() => this.orders().length > 0 || this.changes().length > 0);

  // ---------- 顯示輔助 ----------
  trackHeight(group: TimelineGroup): number {
    return group.laneCount * LANE_HEIGHT + 6;
  }

  segmentTop(seg: TimelineSegment): number {
    return seg.lane * LANE_HEIGHT + 3;
  }

  orderTypeLabel(type: string): string {
    return orderTypeLabel(type);
  }

  changeTypeLabel(type: string): string {
    return changeTypeLabel(type);
  }

  changePillClass(type: string): string {
    return changePillClass(type);
  }

  formatFieldChange(change: InjectionFieldChange): string {
    return formatFieldChange(change);
  }

  formatUploadedAt(value: string): string {
    return formatUploadedAt(value);
  }

  axisStartLabel(): string {
    return formatDateToYYYYMMDD(this.axis().start);
  }

  axisEndLabel(): string {
    return formatDateToYYYYMMDD(new Date(this.axis().end.getTime() - MS_PER_DAY));
  }

  trackGroup(_: number, group: TimelineGroup): string {
    return group.orderCode;
  }

  trackSegment(_: number, seg: TimelineSegment): string {
    return seg.id;
  }

  trackChange(_: number, change: InjectionChangeRecord): string {
    return change.id;
  }

  // ---------- 內部 ----------
  private segmentLabel(o: InjectionHistoryOrder): string {
    const dose = `${o.dose ?? ''}${o.unit ?? ''}`.trim();
    const rule = o.ruleText || o.frequency || (o.orderType === 'injection' ? o.note : '') || '';
    return [dose, rule].filter(Boolean).join(' ') || o.orderName || o.orderCode;
  }

  private segmentTitle(o: InjectionHistoryOrder): string {
    const lines: string[] = [];
    lines.push(`${o.orderName || o.rawName || o.orderCode}（${o.orderCode}，${orderTypeLabel(o.orderType)}）`);
    if (o.dose) lines.push(`劑量：${o.dose}${o.unit ?? ''}`);
    if (o.frequency) lines.push(`頻率：${o.frequency}`);
    if (o.note) lines.push(`備註：${o.note}`);
    if (o.ruleText || o.ruleKind) {
      lines.push(`規則：${o.ruleText || '-'}${o.ruleKind ? `（${ruleKindLabel(o.ruleKind)}${o.ruleSource ? `／${o.ruleSource}` : ''}）` : ''}`);
    }
    lines.push(`期間：${o.startDate || '?'} ～ ${o.endDate || '持續中'}`);
    if (o.changeDate) lines.push(`異動日：${o.changeDate}`);
    if (o.prescriber) lines.push(`開立：${o.prescriber}`);
    if (o.reason) lines.push(`說明：${o.reason}`);
    if (o.overrideId) lines.push('（已套用人工確認規則）');
    return lines.join('\n');
  }

  private parse(dateStr: string): Date {
    const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
    if (!y || !m || !d) return new Date(NaN);
    return new Date(y, m - 1, d);
  }

  private daysBetween(a: Date, b: Date): number {
    return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
  }

  private clampPct(v: number): number {
    if (Number.isNaN(v)) return 0;
    return Math.min(100, Math.max(0, v));
  }
}
