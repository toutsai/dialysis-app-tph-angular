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
import { type FirestoreRecord } from '@services/api-manager.service';

import { ApiService } from '@services/api.service';
import { firstValueFrom } from 'rxjs';
import { consumptionPlan, anchorStart, itemAnchor, projectBalances, addLocalDays, type Coverage, type ActualRange, type Grouped, STOCK_CATEGORIES } from './inventory-calculation';
export { type ActualRange, type Grouped, STOCK_CATEGORIES } from './inventory-calculation';

/** 一段期間的消耗量，附帶「幾天用實際、幾天用推估」 */
export interface ConsumptionBreakdown {
  grouped: Grouped;
  warnings?: string[];
  categorySources?: Record<string, { actualDays: number; estimatedDays: number; ranges: ActualRange[]; warnings: string[] }>;
  actualDays: number;
  estimatedDays: number;
}

/** 盤點文件（後端 GET/PUT /api/system/inventory/counts/:date） */
export interface CountDoc extends FirestoreRecord {
  id?: string;
  countDate: string;
  cutoff?: 'start-of-day' | 'end-of-day';
  countType?: 'weekly' | 'monthly' | 'both';
  revision?: number;
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

interface ForecastSource {
  grouped: Grouped;
  unknownCategories?: string[];
  warnings?: string[];
}

@Injectable({ providedIn: 'root' })
export class InventoryStockService {
  private readonly api = inject(ApiService);
  private readonly engine = inject(ConsumptionEngineService);

  /** 安全庫存天數（使用者拍板：日均消耗 × 9 天） */
  readonly SAFETY_DAYS = 9;

  private readonly forecastRequests = new Map<string,{at:number;request:Promise<ForecastSource>}>();
  /** A refresh invalidates both HIS and forecast sources; concurrent item views share work. */
  private forecast(start:string,end:string):Promise<ForecastSource> {
    const key=`${start}/${end}`;
    const cached=this.forecastRequests.get(key);
    if(cached && Date.now()-cached.at<30000) return cached.request;
    const request: Promise<ForecastSource> = this.engine.calculateTheoreticalConsumption(start,end);
    this.forecastRequests.set(key,{at:Date.now(),request});
    request.catch(() => {
      if (this.forecastRequests.get(key)?.request === request) this.forecastRequests.delete(key);
    });
    return request;
  }

  sourceWarnings: string[] = [];
  private actualRangesLoadedAt = 0;
  private actualRangesPromise: Promise<ActualRange[]> | null = null;
  private actualRangesGeneration = 0;

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
        if (v !== null && v !== '' && Number.isFinite(Number(v))) g[c][item] = Number(v);
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
    const coverage = new Map<string, Record<string, Coverage>>();
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
        coverage.set(key, { ...coverage.get(key), ...(entry?.categoryCoverage || {}) });
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
      out.push({ key, start: expand(s), end: expand(e), grouped, categoryCoverage: coverage.get(key) });
    }
    out.sort((a, b) => a.start.localeCompare(b.start));
    return out;
  }

  /** 載入（並快取）實際消耗區間；force=true 重新抓 */
  ensureActualRanges(force = false): Promise<ActualRange[]> {
    if (force || (this.actualRangesPromise && Date.now() - this.actualRangesLoadedAt > 30000)) {
      this.invalidateActualRanges();
    }
    if (!this.actualRangesPromise) {
      const generation = this.actualRangesGeneration;
      this.sourceWarnings = [];
      this.actualRangesLoadedAt = Date.now();
      this.actualRangesPromise = (async () => {
        try {
          // Quantities and completeness must come from the same database snapshot.
          const snapshot = await firstValueFrom(this.api.get<{
            reports: unknown[];
            coverage: Array<{ rangeKey: string; startDate: string; endDate: string; category: string; complete: boolean; sourceFile?: string; uploadedAt?: string }>;
          }>('/orders/consumables/stock-sources'));
          if (generation !== this.actualRangesGeneration) return this.ensureActualRanges();
          if (!Array.isArray(snapshot?.reports) || !Array.isArray(snapshot?.coverage)) throw new Error('Invalid inventory source snapshot');
          const ranges = this.loadActualRanges(snapshot.reports);
          for (const source of snapshot.coverage) {
            let range = ranges.find(r => r.key === source.rangeKey);
            if (!range) {
              const toDay = (date: string) => date.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
              range = { key: source.rangeKey, start: toDay(source.startDate), end: toDay(source.endDate), grouped: this.emptyGrouped() };
              ranges.push(range);
            }
            range.categoryCoverage ??= {};
            range.categoryCoverage[source.category] = source;
          }
          this.actualRangesLoadedAt = Date.now();
          return ranges;
        } catch (error) {
          if (generation !== this.actualRangesGeneration) return this.ensureActualRanges();
          this.sourceWarnings.push('HIS 耗材來源載入失敗，暫採排程推估；請重新整理核對');
          console.warn('[InventoryStock] 載入耗材實際消耗區間失敗，全部改用排程推估:', error);
          return [];
        }
      })();
    }
    return this.actualRangesPromise;
  }

  /** 丟掉快取（上傳新的消耗紀錄後呼叫） */
  invalidateActualRanges(): void {
    this.actualRangesGeneration++;
    this.forecastRequests.clear();
    this.actualRangesPromise = null;
  }

  // =========================================================================
  // 消耗（實際優先、缺的日子推估）
  // =========================================================================

  /**
   * [start, end] 每一天的消耗量：
   *   - 完整且無重疊的類別區間全落在查詢內 → 合計只取一次，不按日拆分
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
    const categorySources: NonNullable<ConsumptionBreakdown['categorySources']> = {};
    const warnings: string[] = [...this.sourceWarnings];
    const forecasts = new Map<string, Promise<ForecastSource>>();
    for (const category of STOCK_CATEGORIES) {
      const plan = consumptionPlan(start, end, rs, category);
      warnings.push(...plan.warnings);
      categorySources[category] = {actualDays:plan.actualDays,estimatedDays:plan.estimatedDays,ranges:plan.accepted,warnings:plan.warnings};
      for (const range of plan.accepted) this.addGrouped(grouped, {[category]:range.grouped[category] || {}});
      for (const segment of this.toSegments(plan.forecastDays)) {
        const key = `${segment.start}/${segment.end}`;
        let request = forecasts.get(key);
        if (!request) { request=this.forecast(segment.start,segment.end); forecasts.set(key,request); }
        try {
          const result = await request;
          if (result.unknownCategories?.includes(category)) {
            warnings.push(`${category} ${key}：排程或用物設定不完整，數量未知`);
          } else {
            this.addGrouped(grouped, { [category]: result.grouped[category] || {} });
          }
        }
        catch { warnings.push(`${category} ${key}：排程推估載入失敗，數量未知`); }
      }
    }
    this.roundGrouped(grouped);
    return {grouped,categorySources,warnings,
      actualDays:Math.min(...Object.values(categorySources).map(s=>s.actualDays)),
      estimatedDays:Math.max(...Object.values(categorySources).map(s=>s.estimatedDays))};
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
  pendingArrivals(purchases: unknown[], throughDate?: string): Grouped {
    const g = this.emptyGrouped();
    for (const p of (purchases || []) as Record<string, any>[]) {
      if (p?.['status'] !== 'ordered') continue;
      if (throughDate && (!p['expectedDate'] || String(p['expectedDate']).slice(0,10)>throughDate)) continue;
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
      if (p?.['status'] !== 'arrived' && p?.['status']) continue;
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
   * 新盤點依 cutoff；舊盤點維持原日初解讀。缺少品項數量不建立零庫存基準。
   */
  async estimateStock(
    countDoc: CountDoc | null | undefined,
    asOf: string,
    purchases: unknown[],
  ): Promise<StockEstimate> {
    const stock = this.normalizeGrouped(countDoc?.countDate && countDoc.countDate <= asOf ? countDoc.counts : undefined);
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

    const start = anchorStart(countDoc!);
    const arrivals = this.arrivedBetween(purchases, start, asOf);
    const consumption = await this.consumptionBetween(start, asOf);
    for (const category of STOCK_CATEGORIES) for (const item of Object.keys(stock[category])) {
      if (consumption.warnings?.some(w=>w.startsWith(category) && w.includes('數量未知'))) { delete stock[category][item]; continue; }
      stock[category][item] += this.value(arrivals,category,item)-this.value(consumption.grouped,category,item);
    }

    return {
      stock,
      arrivals,
      consumption: consumption.grouped,
      actualDays: consumption.actualDays,
      estimatedDays: consumption.estimatedDays,
      countDate,
    };
  }

  /** Shared item read model: unknown count stays null, receipts are booked on their own day. */
  async itemTimeline(category:string,item:string,asOf:string,end:string,countDocs:CountDoc[],purchases:unknown[]) {
    const anchor=itemAnchor(countDocs,category,item,asOf);
    const ranges=await this.ensureActualRanges();
    const start=anchor ? anchorStart(anchor) : asOf;
    const used=await this.consumptionBetween(start,asOf,ranges);
    const warnings=[...this.sourceWarnings,...(used.categorySources?.[category]?.warnings || [])];
    if (!anchor) warnings.push('尚無此品項實盤基準');
    else if (!anchor.cutoff) warnings.push('舊盤點沿用開班前基準，時點未核實');
    const unknown=used.warnings?.some(w=>w.startsWith(category) && w.includes('數量未知'));
    let current=anchor && !unknown ? anchor.counts[category][item]+this.value(this.arrivedBetween(purchases,start,asOf),category,item)-this.value(used.grouped,category,item) : null;
    if(unknown) warnings.push('排程推估載入失敗，數量未知');
    const orders=(purchases as Record<string,unknown>[]).filter(p=>p['category']===category && p['item']===item);
    const deliveryDate=(p:Record<string,unknown>)=>String(p['status']==='ordered' ? p['expectedDate'] || '' : p['date'] || '').slice(0,10);
    const pending=orders.filter(p=>p['status']==='ordered').map(p=>({date:deliveryDate(p),quantity:Number(p['quantity']) || 0})).filter(p=>p.date).sort((a,b)=>a.date.localeCompare(b.date));
    if(pending.some(p=>p.date<=asOf)) warnings.push('有逾期未到貨；未計入現貨或未來預到貨');
    if(pending.some(p=>p.date>asOf && p.date<=end)) warnings.push('預到貨按預計日期於當日耗用前計入；日內到貨時間尚未確認');
    const daily=[];
    for(const date of this.enumerateDays(addLocalDays(asOf,1),end)) {
      let forecast:number|null=null;
      try {
        const result = await this.forecast(date, date);
        if (result.unknownCategories?.includes(category)) warnings.push(`${date}：排程或用物設定不完整，數量未知`);
        else forecast = this.value(result.grouped, category, item);
      } catch { warnings.push(`${date}：排程推估載入失敗，數量未知`); }
      const plan=consumptionPlan(date,date,ranges,category);
      const actual=plan.accepted.length ? plan.accepted.reduce((sum,r)=>sum+this.value(r.grouped,category,item),0) : null;
      const need=actual ?? forecast;
      const dayAnchor = itemAnchor(countDocs, category, item, date);
      const dayCount = dayAnchor?.countDate === date ? dayAnchor : null;
      const closedIntervals = dayAnchor ? consumptionPlan(anchorStart(dayAnchor), date, ranges, category)
        .accepted.filter(range => range.end === date && range.start !== range.end) : [];
      let reconciledBalance: number | null | undefined;
      if (dayAnchor && closedIntervals.length) {
        const from = anchorStart(dayAnchor);
        const cumulative = await this.consumptionBetween(from, date, ranges);
        const incomplete = cumulative.warnings?.some(w => w.startsWith(category) && w.includes('數量未知'));
        const expected = pending.filter(p => p.date > asOf && p.date >= from && p.date <= date)
          .reduce((sum, p) => sum + p.quantity, 0);
        reconciledBalance = incomplete ? null : dayAnchor.counts[category][item]
          + this.value(this.arrivedBetween(purchases, from, date), category, item)
          + expected - this.value(cumulative.grouped, category, item);
        warnings.push(`${date}：HIS 區間合計於結束日核對餘量，未拆成每日實耗`);
      }
      daily.push({date,need,forecast,actual,difference:actual!==null && forecast!==null ? actual-forecast : null,source:actual!==null?'HIS 單日實耗':'排程推估',arrivals:orders.filter(p=>deliveryDate(p)===date && (p['status']==='ordered' || p['status']==='arrived')).reduce((sum,p)=>sum+(Number(p['quantity']) || 0),0),
        openingCount: dayCount && dayCount.cutoff !== 'end-of-day' ? dayCount.counts[category][item] : undefined,
        closingCount: dayCount?.cutoff === 'end-of-day' ? dayCount.counts[category][item] : undefined,
        reconciledBalance, intervalRanges: closedIntervals,
      });
    }
    const balances=projectBalances(current,daily);
    const days=daily.map((day,i)=>({...day,intervalAdjustment:balances[i].intervalAdjustment,projectedBalance:balances[i].projectedBalance}));
    return {asOf,start,current,anchor,days,firstDeficitDate:current!==null && current<0 ? asOf : days.find(d=>d.projectedBalance!==null && d.projectedBalance<0)?.date ?? null,warnings:[...new Set(warnings)].map(w=>w.replaceAll('artificialKidney','AK').replaceAll('dialysateCa','A 液').replaceAll('bicarbonateType','B 液')),nextDelivery:pending[0] || null,actualRanges:used.categorySources?.[category]?.ranges || [],provenance:used.categorySources?.[category]};
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
