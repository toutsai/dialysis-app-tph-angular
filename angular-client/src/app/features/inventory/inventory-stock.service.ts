// src/app/features/inventory/inventory-stock.service.ts
// 庫存推算單一權威：所有「盤點 → 到貨 → 消耗 → 推估庫存 → 安全庫存 → 訂購量」的公式集中在這裡。
// 元件（inventory.component）只負責呼叫與呈現，不得自己再算一套。
//
// 名詞：
//   - 盤點（inventory_count_docs）：某一天實際清點的數量，是所有推算的基準點。
//   - 實際消耗：耗材消耗紀錄上傳的區間資料（consumables_reports 的 data.ranges）。
//   - 推估消耗：由排程推算（ConsumptionEngineService），用於「還沒上傳實際資料」的日子。
import { Injectable, inject } from '@angular/core';
import { ConsumptionEngineService } from '@services/consumption-engine.service';
import {
  ApiManagerService,
  type ApiManager,
  type FirestoreRecord,
} from '@services/api-manager.service';

/** category → itemName → 數量 */
export type Grouped = Record<string, Record<string, number>>;

export const STOCK_CATEGORIES = ['artificialKidney', 'dialysateCa', 'bicarbonateType'] as const;

/** consumables_reports 的一段實際消耗區間（跨病人已加總） */
export interface ActualRange {
  /** 原始 key，例如 '20260824-20260828' */
  key: string;
  /** YYYY-MM-DD */
  start: string;
  /** YYYY-MM-DD */
  end: string;
  grouped: Grouped;
}

/** 一段期間的消耗量，附帶「幾天用實際、幾天用推估」 */
export interface ConsumptionBreakdown {
  grouped: Grouped;
  actualDays: number;
  estimatedDays: number;
}

/** 盤點文件（後端 GET/PUT /api/system/inventory/counts/:date） */
export interface CountDoc extends FirestoreRecord {
  id?: string;
  countDate: string;
  counts: Grouped;
  countBoxes: Grouped;
  notes?: string;
  createdBy?: { uid?: string; name?: string } | null;
  updatedBy?: { uid?: string; name?: string } | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface StockEstimate {
  /** 推估庫存 = 盤點量 + 盤點後到貨 − 盤點後消耗 */
  stock: Grouped;
  /** 盤點後到貨（已到貨） */
  arrivals: Grouped;
  /** 盤點後消耗（實際優先、缺的日子推估） */
  consumption: Grouped;
  actualDays: number;
  estimatedDays: number;
  /** 基準盤點日；無盤點時為空字串 */
  countDate: string;
}

@Injectable({ providedIn: 'root' })
export class InventoryStockService {
  private readonly engine = inject(ConsumptionEngineService);
  private readonly apiManagerService = inject(ApiManagerService);
  private readonly reportsApi: ApiManager<FirestoreRecord>;

  /** 安全庫存天數（使用者拍板：日均消耗 × 9 天） */
  readonly SAFETY_DAYS = 9;

  private actualRangesPromise: Promise<ActualRange[]> | null = null;

  constructor() {
    this.reportsApi = this.apiManagerService.create<FirestoreRecord>('consumables_reports');
  }

  // =========================================================================
  // 日期工具（一律本地年月日組字串，不用 toISOString —— 會跨日）
  // =========================================================================

  private pad(n: number): string {
    return String(n).padStart(2, '0');
  }

  toDateString(d: Date): string {
    return `${d.getFullYear()}-${this.pad(d.getMonth() + 1)}-${this.pad(d.getDate())}`;
  }

  private parseDate(s: string): Date {
    return new Date(`${s}T00:00:00`);
  }

  todayString(): string {
    return this.toDateString(new Date());
  }

  addDays(dateStr: string, delta: number): string {
    const d = this.parseDate(dateStr);
    d.setDate(d.getDate() + delta);
    return this.toDateString(d);
  }

  /** 含頭含尾的天數 */
  daysInclusive(start: string, end: string): number {
    const diff = this.parseDate(end).getTime() - this.parseDate(start).getTime();
    return Math.round(diff / 86400000) + 1;
  }

  /** 該日所屬那週的週一 */
  mondayOf(dateStr: string): string {
    const d = this.parseDate(dateStr);
    const day = d.getDay() || 7; // Mon=1..Sun=7
    d.setDate(d.getDate() - (day - 1));
    return this.toDateString(d);
  }

  /** 上一個完整週（週一~週日）的週一 */
  lastCompleteWeekMonday(fromDate: string = this.todayString()): string {
    return this.addDays(this.mondayOf(fromDate), -7);
  }

  /** 月份 'YYYY-MM' → { start, end } */
  monthRange(month: string): { start: string; end: string } {
    const [y, m] = month.split('-').map((v) => parseInt(v, 10));
    const start = `${y}-${this.pad(m)}-01`;
    const last = new Date(y, m, 0); // 該月最後一天
    return { start, end: this.toDateString(last) };
  }

  enumerateDays(start: string, end: string): string[] {
    const out: string[] = [];
    if (!start || !end || start > end) return out;
    let cur = start;
    let guard = 0;
    while (cur <= end && guard++ < 4000) {
      out.push(cur);
      cur = this.addDays(cur, 1);
    }
    return out;
  }

  // =========================================================================
  // Grouped 工具
  // =========================================================================

  emptyGrouped(): Grouped {
    const g: Grouped = {};
    for (const c of STOCK_CATEGORIES) g[c] = {};
    return g;
  }

  /** 把任意來源（可能缺類別）正規化成完整的 Grouped */
  normalizeGrouped(src: unknown): Grouped {
    const g = this.emptyGrouped();
    const obj = (src || {}) as Record<string, Record<string, unknown>>;
    for (const c of STOCK_CATEGORIES) {
      for (const [item, v] of Object.entries(obj[c] || {})) {
        g[c][item] = Number(v) || 0;
      }
    }
    return g;
  }

  /** target += src × factor（就地累加） */
  addGrouped(target: Grouped, src: Grouped, factor = 1): void {
    for (const c of STOCK_CATEGORIES) {
      for (const [item, v] of Object.entries(src[c] || {})) {
        target[c][item] = (target[c][item] || 0) + (Number(v) || 0) * factor;
      }
    }
  }

  private roundGrouped(g: Grouped): void {
    for (const c of STOCK_CATEGORIES) {
      for (const item of Object.keys(g[c])) {
        g[c][item] = Math.round(g[c][item]);
      }
    }
  }

  value(g: Grouped | null | undefined, category: string, item: string): number {
    return g?.[category]?.[item] || 0;
  }

  /** 蒐集多個 Grouped 中出現過的品項（category → items） */
  collectItems(sources: (Grouped | null | undefined)[]): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const c of STOCK_CATEGORIES) {
      const set = new Set<string>();
      for (const src of sources) {
        for (const item of Object.keys(src?.[c] || {})) set.add(item);
      }
      out[c] = [...set].sort();
    }
    return out;
  }

  // =========================================================================
  // 實際消耗區間
  // =========================================================================

  /**
   * 從 consumables_reports 取出實際消耗區間。
   * 每筆報告的 `data.ranges` 是 { 'YYYYMMDD-YYYYMMDD': { artificialKidney:[{item,count}], ... } }；
   * 'legacy'（改制前、區間不明）略過。同一區間跨病人加總。
   */
  loadActualRanges(reports: unknown[]): ActualRange[] {
    const map = new Map<string, Grouped>();
    for (const report of (reports || []) as Record<string, any>[]) {
      const ranges = (report?.['data'] || {})['ranges'];
      if (!ranges || typeof ranges !== 'object') continue;
      for (const [key, entry] of Object.entries(ranges as Record<string, any>)) {
        if (!key || key === 'legacy' || !/^\d{8}-\d{8}$/.test(key)) continue;
        let g = map.get(key);
        if (!g) {
          g = this.emptyGrouped();
          map.set(key, g);
        }
        for (const c of STOCK_CATEGORIES) {
          const list = entry?.[c];
          if (!Array.isArray(list)) continue;
          for (const it of list) {
            const item = String(it?.item ?? '').trim();
            if (!item) continue;
            g[c][item] = (g[c][item] || 0) + (Number(it?.count) || 0);
          }
        }
      }
    }

    const expand = (yyyymmdd: string) =>
      `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;

    const out: ActualRange[] = [];
    for (const [key, grouped] of map) {
      const [s, e] = key.split('-');
      out.push({ key, start: expand(s), end: expand(e), grouped });
    }
    out.sort((a, b) => a.start.localeCompare(b.start));
    return out;
  }

  /** 載入（並快取）實際消耗區間；force=true 重新抓 */
  ensureActualRanges(force = false): Promise<ActualRange[]> {
    if (force) this.actualRangesPromise = null;
    if (!this.actualRangesPromise) {
      this.actualRangesPromise = (async () => {
        try {
          const reports = await this.reportsApi.fetchAll();
          return this.loadActualRanges(reports as unknown[]);
        } catch (error) {
          console.warn('[InventoryStock] 載入耗材實際消耗區間失敗，全部改用排程推估:', error);
          return [];
        }
      })();
    }
    return this.actualRangesPromise;
  }

  /** 丟掉快取（上傳新的消耗紀錄後呼叫） */
  invalidateActualRanges(): void {
    this.actualRangesPromise = null;
  }

  // =========================================================================
  // 消耗（實際優先、缺的日子推估）
  // =========================================================================

  /**
   * [start, end] 每一天的消耗量：
   *   - 被某個實際區間涵蓋的日子 → 該區間總量按日比例分攤（總量 × 涵蓋天數 / 區間天數）
   *   - 沒被涵蓋的日子 → 依連續日段合併，一段呼叫一次排程推估（不逐日呼叫）
   */
  async consumptionBetween(
    start: string,
    end: string,
    ranges?: ActualRange[],
  ): Promise<ConsumptionBreakdown> {
    const grouped = this.emptyGrouped();
    if (!start || !end || start > end) {
      return { grouped, actualDays: 0, estimatedDays: 0 };
    }

    const rs = ranges ?? (await this.ensureActualRanges());
    const days = this.enumerateDays(start, end);

    const coveredByRange = new Map<number, number>();
    const uncovered: string[] = [];
    for (const day of days) {
      const idx = rs.findIndex((r) => r.start <= day && day <= r.end);
      if (idx >= 0) coveredByRange.set(idx, (coveredByRange.get(idx) || 0) + 1);
      else uncovered.push(day);
    }

    for (const [idx, coveredDays] of coveredByRange) {
      const r = rs[idx];
      const total = Math.max(1, this.daysInclusive(r.start, r.end));
      this.addGrouped(grouped, r.grouped, coveredDays / total);
    }

    for (const seg of this.toSegments(uncovered)) {
      try {
        const res = await this.engine.calculateTheoreticalConsumption(seg.start, seg.end);
        this.addGrouped(grouped, res.grouped as Grouped, 1);
      } catch (error) {
        console.warn(`[InventoryStock] 排程推估失敗 (${seg.start}~${seg.end}):`, error);
      }
    }

    this.roundGrouped(grouped);
    return {
      grouped,
      actualDays: days.length - uncovered.length,
      estimatedDays: uncovered.length,
    };
  }

  /** 已排序的日期陣列 → 連續日段 */
  private toSegments(days: string[]): { start: string; end: string }[] {
    const segs: { start: string; end: string }[] = [];
    for (const day of days) {
      const last = segs[segs.length - 1];
      if (last && this.addDays(last.end, 1) === day) last.end = day;
      else segs.push({ start: day, end: day });
    }
    return segs;
  }

  /** '實際' / '推估' / '混合(實際N天/推估M天)' */
  sourceLabel(actualDays: number, estimatedDays: number): string {
    if (actualDays > 0 && estimatedDays === 0) return '實際';
    if (actualDays === 0) return '推估';
    return '混合';
  }

  /** '實際 N 天／推估 M 天' */
  daysLabel(actualDays: number, estimatedDays: number): string {
    return `實際 ${actualDays} 天／推估 ${estimatedDays} 天`;
  }

  // =========================================================================
  // 到貨 / 待到貨
  // =========================================================================

  /** 已叫貨但還沒到貨（不看預計日，全部計入） */
  pendingArrivals(purchases: unknown[]): Grouped {
    const g = this.emptyGrouped();
    for (const p of (purchases || []) as Record<string, any>[]) {
      if (p?.['status'] !== 'ordered') continue;
      const c = String(p['category'] || '');
      const item = String(p['item'] || '');
      if (!g[c] || !item) continue;
      g[c][item] = (g[c][item] || 0) + (Number(p['quantity']) || 0);
    }
    return g;
  }

  /**
   * 已到貨且到貨日落在 [start, end]。
   * `date` 可能是舊資料的 ISO 字串（含 T…Z），一律取前 10 碼比較。
   */
  arrivedBetween(purchases: unknown[], start: string, end: string): Grouped {
    const g = this.emptyGrouped();
    if (!start || !end || start > end) return g;
    for (const p of (purchases || []) as Record<string, any>[]) {
      if (p?.['status'] === 'ordered') continue;
      const raw = typeof p?.['date'] === 'string' ? (p['date'] as string) : '';
      const day = raw.substring(0, 10);
      if (!day || day < start || day > end) continue;
      const c = String(p['category'] || '');
      const item = String(p['item'] || '');
      if (!g[c] || !item) continue;
      g[c][item] = (g[c][item] || 0) + (Number(p['quantity']) || 0);
    }
    return g;
  }

  // =========================================================================
  // 推估庫存
  // =========================================================================

  /**
   * 推估庫存 = 盤點量 + arrivedBetween(盤點日, asOf) − consumptionBetween(盤點日, asOf)。
   *
   * **盤點量視為盤點日開始前的數量**：盤點日當天的到貨與消耗都算在盤點之後
   * （亦即區間含盤點日當天）。這是刻意的保守估計——寧可低估庫存也不要缺料。
   */
  async estimateStock(
    countDoc: CountDoc | null | undefined,
    asOf: string,
    purchases: unknown[],
  ): Promise<StockEstimate> {
    const stock = this.normalizeGrouped(countDoc?.counts);
    const countDate = countDoc?.countDate || '';
    if (!countDate || countDate > asOf) {
      return {
        stock,
        arrivals: this.emptyGrouped(),
        consumption: this.emptyGrouped(),
        actualDays: 0,
        estimatedDays: 0,
        countDate,
      };
    }

    const arrivals = this.arrivedBetween(purchases, countDate, asOf);
    const consumption = await this.consumptionBetween(countDate, asOf);

    this.addGrouped(stock, arrivals, 1);
    this.addGrouped(stock, consumption.grouped, -1);

    return {
      stock,
      arrivals,
      consumption: consumption.grouped,
      actualDays: consumption.actualDays,
      estimatedDays: consumption.estimatedDays,
      countDate,
    };
  }

  // =========================================================================
  // 週消耗 / 安全庫存
  // =========================================================================

  /** 指定週一起算 7 天（週一~週日）的 hybrid 消耗 */
  weeklyConsumption(mondayOfWeek: string): Promise<ConsumptionBreakdown> {
    return this.consumptionBetween(mondayOfWeek, this.addDays(mondayOfWeek, 6));
  }

  /** 週消耗 → 日均（除以 7） */
  dailyAverage(weekTotal: number): number {
    return (Number(weekTotal) || 0) / 7;
  }

  /** 安全庫存 = ceil(日均 × SAFETY_DAYS) */
  safetyStock(weekTotal: number): number {
    return Math.ceil(this.dailyAverage(weekTotal) * this.SAFETY_DAYS);
  }

  /** 建議訂購量 = max(0, 安全庫存 − 目前推估庫存 − 已叫貨待到貨) */
  orderQuantity(safetyStock: number, estimatedStock: number, pending: number): number {
    return Math.max(0, Math.round(safetyStock - estimatedStock - pending));
  }
}
