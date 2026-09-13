// src/app/features/inventory/inventory-week-panel.component.ts
// 作業行事曆「週」面板：本週實際 vs 推估對照 + 每週訂單（盤點輸入／訂購建議／匯出訂單）。
// 週次由父元件（行事曆選取）決定，面板內不再自選週。
import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '@services/api.service';
import { AuthService } from '@services/auth.service';
import { ConsumptionEngineService } from '@services/consumption-engine.service';
import {
  ApiManagerService,
  type ApiManager,
  type FirestoreRecord,
} from '@services/api-manager.service';
import {
  InventoryStockService,
  type ActualRange,
  type CountDoc,
  type Grouped,
} from './inventory-stock.service';
import {
  INVENTORY_CATEGORY_NAMES,
  emptyGroupedByCategory,
  emptyItemLists,
  isConsumptionTracked,
} from './inventory-categories';

const CATEGORY_NAMES = INVENTORY_CATEGORY_NAMES;

/** 每週訂單建議表的一列 */
export interface WeeklyOrderRow {
  category: string;
  categoryName: string;
  item: string;
  unitsPerBox: number;
  lastWeekConsumption: number;
  sourceLabel: string;
  dailyAvg: string;
  safetyStock: number;
  countUnits: number;
  arrivedSinceCount: number;
  consumedSinceCount: number;
  estimatedStock: number;
  pending: number;
  orderQuantity: number;
  orderBoxes: number;
}

/** 「本週 實際 vs 推估」的一列 */
export interface WeeklyCompareRow {
  category: string;
  categoryName: string;
  item: string;
  estimated: number;
  actual: number;
  /** false → 本週沒有涵蓋此品項的上傳區間，實際欄顯示「未上傳」 */
  hasActual: boolean;
  diff: number;
}

@Component({
  selector: 'app-inventory-week-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './inventory-week-panel.component.html',
  styleUrl: './inventory-week-panel.component.css',
})
export class InventoryWeekPanelComponent implements OnChanges {
  private readonly stock = inject(InventoryStockService);
  private readonly engine = inject(ConsumptionEngineService);
  private readonly apiManagerService = inject(ApiManagerService);
  private readonly api = inject(ApiService);
  protected readonly authService = inject(AuthService);

  private readonly countsApi: ApiManager<FirestoreRecord>;
  private readonly purchasesApi: ApiManager<FirestoreRecord>;

  // ==================== Inputs / Outputs（契約 C 節，名稱不可改） ====================
  @Input() isoWeek = '';
  @Input() weekStart = '';
  @Input() weekEnd = '';
  @Input() inventoryItems: any[] = [];
  @Input() knownItems: Record<string, string[]> = emptyItemLists();
  @Input() purchases: any[] = [];
  @Input() unitsPerBoxFn: (category: string, item: string) => number = () => 1;

  /** 存盤點 / 建立行事曆叫貨後 */
  @Output() changed = new EventEmitter<void>();
  @Output() alert = new EventEmitter<{ title: string; message: string }>();

  readonly CATEGORY_NAMES = CATEGORY_NAMES;
  readonly categoryKeys = Object.keys(CATEGORY_NAMES);

  // ==================== 本週 實際 vs 推估 ====================
  compareRows = signal<WeeklyCompareRow[]>([]);
  /** 本週被實際上傳區間涵蓋的天數（0~7） */
  compareCoverDays = signal(0);
  compareNote = signal('');

  // ==================== 每週訂單 ====================
  weeklyLoading = signal(false);
  weeklyDataLoaded = signal(false);
  /** 盤點日（預設該週週二，可在面板內改成該週其他日） */
  countDate = '';
  weeklyCount: Record<string, Record<string, number>> = emptyGroupedByCategory();
  weeklyCountBoxes: Record<string, Record<string, number>> = emptyGroupedByCategory();
  weeklyRows = signal<WeeklyOrderRow[]>([]);
  weeklyConsumptionNote = signal('');
  weeklyStockNote = signal('');
  weeklyCountSavedInfo = signal<string>('');

  private weeklyLastWeekDays = { actual: 0, estimated: 0 };
  private weeklyCtx: {
    lastWeek: Grouped;
    arrivals: Grouped;
    consumption: Grouped;
    pending: Grouped;
  } | null = null;

  // Order preview modal
  showOrderPreview = signal(false);
  /** 確認匯出時同時把訂單建成行事曆叫貨（待到貨） */
  createCalendarOrdersOnExport = true;
  orderDate = '';
  orderPreviewDates: string[] = []; // 6 dates: Mon-Sat
  orderPreviewDayLabels: string[] = [];
  orderPreviewItems: { category: string; item: string; label: string; hospitalCode: string }[] = [];
  orderPreviewGrid: Record<string, number[]> = {}; // key = "category|item" → [mon..sat]

  get hasOrderData(): boolean {
    return this.weeklyRows().some((r) => r.orderQuantity > 0);
  }

  constructor() {
    this.countsApi = this.apiManagerService.create<FirestoreRecord>('inventory_counts');
    this.purchasesApi = this.apiManagerService.create<FirestoreRecord>('inventory_purchases');
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isoWeek'] || changes['weekStart'] || changes['weekEnd']) {
      if (!this.weekStart || !this.weekEnd) return;
      this.countDate = this.defaultCountDate();
      this.showOrderPreview.set(false);
      void this.reload();
      return;
    }
    // 行事曆標記到貨 / 建立叫貨 → 父元件換了 purchases → 盤點後到貨、待到貨要跟著重算
    if (changes['purchases'] && !changes['purchases'].firstChange && this.weeklyDataLoaded()) {
      void this.loadWeeklyData();
    }
  }

  /** 預設盤點日 = 該週週二（weekStart + 1） */
  private defaultCountDate(): string {
    return this.stock.addDays(this.weekStart, 1);
  }

  // ==================== 共用小工具（父元件的 getUnitsPerBox 等同實作） ====================

  getUnitsPerBox(category: string, itemName: string): number {
    return this.unitsPerBoxFn(category, itemName) || 1;
  }

  calculateUnits(category: string, itemName: string, boxQty: number): number {
    return boxQty * this.getUnitsPerBox(category, itemName);
  }

  calculateBoxes(category: string, itemName: string, units: number): string | number {
    const unitsPerBox = this.getUnitsPerBox(category, itemName);
    if (unitsPerBox <= 1) return units;
    return (units / unitsPerBox).toFixed(1);
  }

  calculateBoxesRounded(category: string, itemName: string, units: number): number {
    const unitsPerBox = this.getUnitsPerBox(category, itemName);
    if (unitsPerBox <= 1) return units;
    return Math.round(units / unitsPerBox);
  }

  getHospitalCode(category: string, itemName: string): string {
    const items = this.inventoryItems || [];
    const found = items.find((i: any) => i.category === category && i.name === itemName);
    return found?.hospitalCode || '';
  }

  /** 品項設定的手動安全庫存（個） */
  private manualSafeLevel(category: string, itemName: string): number {
    const found = (this.inventoryItems || []).find((i: any) => i.category === category && i.name === itemName);
    return Number(found?.safeInventoryLevel) || 0;
  }

  getItemsForCategory(category: string): string[] {
    return this.knownItems?.[category] || [];
  }

  /** 盤點日 ‹ › 導覽（限制在本週內） */
  stepCountDate(delta: number): void {
    if (!this.countDate) return;
    const next = this.stock.addDays(this.countDate, delta);
    if (this.weekStart && next < this.weekStart) return;
    if (this.weekEnd && next > this.weekEnd) return;
    this.countDate = next;
    void this.loadWeeklyData();
  }

  /** 日期輸入框改盤點日 → 立即載入該日文件（避免把畫面上舊日期的數字存到新日期） */
  onCountDateInput(value: string): void {
    const next = value || '';
    if (!next) {
      this.countDate = '';
      return;
    }
    // [min]/[max] 只是 UI 提示，鍵盤輸入仍可跨出本週 → 這裡才是真正的守門
    if (!this.isWithinWeek(next)) {
      this.showAlert('盤點日超出本週', `盤點日須在 ${this.weekStart} ~ ${this.weekEnd} 之間，已改回 ${this.defaultCountDate()}。`);
      this.countDate = this.defaultCountDate();
    } else {
      this.countDate = next;
    }
    void this.loadWeeklyData();
  }

  private isWithinWeek(ymd: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
    if (this.weekStart && ymd < this.weekStart) return false;
    if (this.weekEnd && ymd > this.weekEnd) return false;
    return true;
  }

  private buildGroupedCopy(src: Record<string, Record<string, number>>): Grouped {
    const out: Grouped = emptyGroupedByCategory();
    for (const category of this.categoryKeys) {
      for (const [item, value] of Object.entries(src[category] || {})) {
        out[category][item] = Number(value) || 0;
      }
    }
    return out;
  }

  private showAlert(title: string, message: string): void {
    this.alert.emit({ title, message });
  }

  /** 叫貨/到貨資料：優先用父元件傳入的，沒有才自己抓 */
  private async resolvePurchases(): Promise<any[]> {
    if (Array.isArray(this.purchases) && this.purchases.length > 0) return this.purchases;
    return (await this.purchasesApi.fetchAll()) as any[];
  }

  // ==================== 載入 ====================

  async reload(): Promise<void> {
    await this.loadWeeklyData();
    await this.loadCompare();
  }

  /** 給模板的「重新計算」按鈕 */
  recalculate(): void {
    void this.reload();
  }

  /**
   * 本週「實際 vs 推估」：
   *   推估 = 排程推算 weekStart~weekEnd
   *   實際 = 與本週重疊的上傳區間，依「總量 × 重疊天數 / 區間天數」分攤（與 consumptionBetween 同規則）
   */
  private async loadCompare(): Promise<void> {
    if (!this.weekStart || !this.weekEnd) return;
    try {
      const estimated = this.stock.emptyGrouped();
      try {
        const res = await this.engine.calculateTheoreticalConsumption(this.weekStart, this.weekEnd);
        this.stock.addGrouped(estimated, this.stock.normalizeGrouped(res?.grouped), 1);
      } catch (error) {
        console.warn('[週面板] 排程推估失敗:', error);
      }

      const ranges: ActualRange[] = await this.stock.ensureActualRanges();
      const actual = this.stock.emptyGrouped();
      const actualItemKeys = new Set<string>();
      const usedLabels: string[] = [];

      for (const r of ranges) {
        if (r.end < this.weekStart || r.start > this.weekEnd) continue; // 無重疊
        const ovStart = r.start > this.weekStart ? r.start : this.weekStart;
        const ovEnd = r.end < this.weekEnd ? r.end : this.weekEnd;
        const overlapDays = this.stock.daysInclusive(ovStart, ovEnd);
        if (overlapDays <= 0) continue;
        const totalDays = Math.max(1, this.stock.daysInclusive(r.start, r.end));
        this.stock.addGrouped(actual, r.grouped, overlapDays / totalDays);
        usedLabels.push(`${r.start}~${r.end}`);
        for (const c of this.categoryKeys) {
          for (const item of Object.keys(r.grouped?.[c] || {})) actualItemKeys.add(`${c}|${item}`);
        }
      }

      // 本週被上傳涵蓋的天數
      let coverDays = 0;
      for (const day of this.stock.enumerateDays(this.weekStart, this.weekEnd)) {
        if (ranges.some((r) => r.start <= day && day <= r.end)) coverDays++;
      }
      this.compareCoverDays.set(coverDays);
      this.compareNote.set(
        usedLabels.length > 0 ? `上傳區間：${usedLabels.join('、')}` : '本週尚無實際消耗上傳',
      );

      const rows: WeeklyCompareRow[] = [];
      // 其他耗材沒有排程推估也不在 HIS 上傳裡，對照表不列
      for (const category of this.categoryKeys.filter(isConsumptionTracked)) {
        const items = new Set<string>([
          ...Object.keys(estimated[category] || {}),
          ...Object.keys(actual[category] || {}),
        ]);
        for (const item of [...items].sort()) {
          const est = Math.round(this.stock.value(estimated, category, item));
          const act = Math.round(this.stock.value(actual, category, item));
          const hasActual = coverDays > 0 && actualItemKeys.has(`${category}|${item}`);
          rows.push({
            category,
            categoryName: CATEGORY_NAMES[category],
            item,
            estimated: est,
            actual: act,
            hasActual,
            diff: hasActual ? act - est : 0,
          });
        }
      }
      this.compareRows.set(rows);
    } catch (error: any) {
      console.error('載入實際 vs 推估失敗:', error);
      this.showAlert('載入失敗', error?.error?.message || error?.message || String(error));
    }
  }

  /** 箱數改動 → 換算個數並即時重算訂購建議（只做加減，不重打 API） */
  syncWeeklyCount(): void {
    for (const category of Object.keys(this.weeklyCountBoxes)) {
      for (const [item, boxes] of Object.entries(this.weeklyCountBoxes[category])) {
        const unitsPerBox = this.getUnitsPerBox(category, item);
        this.weeklyCount[category][item] = (Number(boxes) || 0) * unitsPerBox;
      }
    }
    this.recomputeWeeklyRows();
  }

  /**
   * 每週訂單：以「盤點日的盤點文件」為基準推算。
   * 上週 = 訂單週的前一週（週一~週日）；訂購量 = max(0, 安全庫存(9天) − 目前推估庫存 − 待到貨)。
   */
  async loadWeeklyData(): Promise<void> {
    this.weeklyLoading.set(true);
    this.weeklyDataLoaded.set(false);
    this.weeklyCountSavedInfo.set('');

    for (const category of Object.keys(this.weeklyCount)) {
      this.weeklyCount[category] = {};
      this.weeklyCountBoxes[category] = {};
    }

    try {
      // 盤點日一律限制在本週內（週次由 Input 決定；超出就退回預設週二）
      if (this.countDate && !this.isWithinWeek(this.countDate)) this.countDate = this.defaultCountDate();
      const countDate = this.countDate;

      // 1. 載入盤點日的盤點文件（以「盤點日」為 key，與日面板同一份資料）
      const countDoc = countDate
        ? ((await this.countsApi.fetchById(countDate)) as CountDoc | null)
        : null;

      for (const category of Object.keys(this.weeklyCount)) {
        const units = countDoc?.counts?.[category] || {};
        const boxes = countDoc?.countBoxes?.[category] || {};
        for (const [item, value] of Object.entries(units)) {
          this.weeklyCount[category][item] = Number(value) || 0;
        }
        for (const [item, value] of Object.entries(boxes)) {
          this.weeklyCountBoxes[category][item] = Number(value) || 0;
        }
        // 舊資料沒存箱數 → 由個數回推
        for (const [item, value] of Object.entries(units)) {
          if (boxes[item] === undefined) {
            const unitsPerBox = this.getUnitsPerBox(category, item);
            const n = Number(value) || 0;
            this.weeklyCountBoxes[category][item] = unitsPerBox > 1 ? Math.round(n / unitsPerBox) : n;
          }
        }
      }
      if (countDoc) {
        const who = countDoc.updatedBy?.name || countDoc.createdBy?.name || '未知';
        this.weeklyCountSavedInfo.set(
          `已載入 ${countDate} 盤點（${who}，${countDoc.updatedAt || countDoc.createdAt || ''}）`,
        );
      } else {
        this.weeklyCountSavedInfo.set(`${countDate} 尚無盤點紀錄，請輸入後按「儲存盤點」`);
      }

      // 未來的盤點日還沒盤：盤點量全 0 會算出「每個品項都要訂滿安全庫存」的垃圾建議 → 不產生訂購建議
      if (!countDoc && countDate > this.stock.todayString()) {
        this.weeklyCtx = null;
        this.weeklyRows.set([]);
        this.weeklyConsumptionNote.set('');
        this.weeklyStockNote.set(`盤點日 ${countDate} 尚未到、尚無盤點，盤點後才會產生訂購建議`);
        this.weeklyDataLoaded.set(true);
        return;
      }

      // 2. 上週（訂單週的前一週，週一~週日）消耗 → 日均 → 安全庫存
      const lastWeekMonday = this.stock.addDays(this.weekStart, -7);
      const lastWeek = await this.stock.weeklyConsumption(lastWeekMonday);
      this.weeklyLastWeekDays = { actual: lastWeek.actualDays, estimated: lastWeek.estimatedDays };
      this.weeklyConsumptionNote.set(
        `上週 ${lastWeekMonday} ~ ${this.stock.addDays(lastWeekMonday, 6)}（${this.stock.daysLabel(lastWeek.actualDays, lastWeek.estimatedDays)}）`,
      );

      // 3. 盤點後到貨 / 盤點後消耗 / 已叫貨待到貨
      const purchases = await this.resolvePurchases();
      const today = this.stock.todayString();
      const asOf = today >= countDate ? today : countDate;
      const arrivals = countDate
        ? this.stock.arrivedBetween(purchases, countDate, asOf)
        : this.stock.emptyGrouped();
      const sinceCount = countDate
        ? await this.stock.consumptionBetween(countDate, asOf)
        : { grouped: this.stock.emptyGrouped(), actualDays: 0, estimatedDays: 0 };
      const pending = this.stock.pendingArrivals(purchases);
      this.weeklyStockNote.set(
        countDate
          ? `推估庫存基準：${countDate} 盤點，加計 ${countDate} ~ ${asOf} 到貨、扣除同期消耗（${this.stock.daysLabel(sinceCount.actualDays, sinceCount.estimatedDays)}）`
          : '尚未選擇盤點日',
      );

      this.weeklyCtx = {
        lastWeek: lastWeek.grouped,
        arrivals,
        consumption: sinceCount.grouped,
        pending,
      };

      // 4. 補齊所有已知品項的輸入格
      for (const category of this.categoryKeys) {
        for (const item of this.getItemsForCategory(category)) {
          if (this.weeklyCount[category][item] === undefined) this.weeklyCount[category][item] = 0;
          if (this.weeklyCountBoxes[category][item] === undefined) this.weeklyCountBoxes[category][item] = 0;
        }
      }

      this.recomputeWeeklyRows();
      this.weeklyDataLoaded.set(true);
    } catch (error: any) {
      console.error('載入週資料失敗:', error);
      this.showAlert('載入失敗', error?.error?.message || error?.message || String(error));
    } finally {
      this.weeklyLoading.set(false);
    }
  }

  /** 只做加減的重算（盤點量改動時呼叫），推估用的到貨/消耗來自 weeklyCtx 快取 */
  private recomputeWeeklyRows(): void {
    const ctx = this.weeklyCtx;
    if (!ctx) {
      this.weeklyRows.set([]);
      return;
    }
    const rows: WeeklyOrderRow[] = [];
    for (const category of this.categoryKeys) {
      const items = new Set<string>([
        ...this.getItemsForCategory(category),
        ...Object.keys(ctx.lastWeek[category] || {}),
        ...Object.keys(this.weeklyCount[category] || {}),
      ]);
      for (const item of [...items].sort()) {
        const lastWeekConsumption = this.stock.value(ctx.lastWeek, category, item);
        // 安全庫存 = max(日均×9 天, 品項設定的手動安全庫存)；與庫存總覽同規則。
        // 其他耗材沒有消耗來源（日均恆為 0），全靠手動安全庫存才會產生訂購建議。
        const safetyStock = Math.max(this.stock.safetyStock(lastWeekConsumption), this.manualSafeLevel(category, item));
        const countUnits = Number(this.weeklyCount[category]?.[item]) || 0;
        const arrivedSinceCount = this.stock.value(ctx.arrivals, category, item);
        const consumedSinceCount = this.stock.value(ctx.consumption, category, item);
        const estimatedStock = countUnits + arrivedSinceCount - consumedSinceCount;
        const pending = this.stock.value(ctx.pending, category, item);
        const orderQuantity = this.stock.orderQuantity(safetyStock, estimatedStock, pending);
        rows.push({
          category,
          categoryName: CATEGORY_NAMES[category],
          item,
          unitsPerBox: this.getUnitsPerBox(category, item),
          lastWeekConsumption,
          sourceLabel: this.weeklyConsumptionSource(),
          dailyAvg: this.stock.dailyAverage(lastWeekConsumption).toFixed(1),
          safetyStock,
          countUnits,
          arrivedSinceCount,
          consumedSinceCount,
          estimatedStock,
          pending,
          orderQuantity,
          orderBoxes: this.calculateBoxesRounded(category, item, orderQuantity),
        });
      }
    }
    this.weeklyRows.set(rows);
  }

  /** 上週消耗的資料來源（實際/推估/混合） */
  private weeklyConsumptionSource(): string {
    return this.stock.sourceLabel(this.weeklyLastWeekDays.actual, this.weeklyLastWeekDays.estimated);
  }

  /**
   * 儲存盤點：key = 盤點日（與日面板同一份文件），不是週次。
   */
  async saveWeeklyCount(): Promise<void> {
    const countDate = this.countDate;
    if (!countDate) {
      this.showAlert('無法儲存', '請先選擇盤點日。');
      return;
    }
    this.syncWeeklyCount();

    try {
      const doc = (await this.countsApi.save(countDate, {
        counts: this.buildGroupedCopy(this.weeklyCount),
        countBoxes: this.buildGroupedCopy(this.weeklyCountBoxes),
        notes: `每週訂單 ${this.isoWeek}`,
      } as any)) as CountDoc;

      const who = doc?.updatedBy?.name || doc?.createdBy?.name || '未知';
      this.weeklyCountSavedInfo.set(`已儲存 ${countDate} 盤點（${who}，${doc?.updatedAt || ''}）`);
      this.recomputeWeeklyRows();
      this.changed.emit();
      this.showAlert('操作成功', `${countDate} 盤點已儲存`);
    } catch (error: any) {
      console.error('儲存盤點失敗:', error);
      this.showAlert('儲存失敗', error?.error?.message || error?.message || String(error));
    }
  }

  /** 訂購量 = max(0, 安全庫存(9天) − 目前推估庫存 − 已叫貨待到貨)；查已算好的 rows */
  getOrderQuantity(category: string, item: string): number {
    const row = this.weeklyRows().find((r) => r.category === category && r.item === item);
    return row ? row.orderQuantity : 0;
  }

  exportWeeklyOrder(): void {
    this.openOrderPreview();
  }

  openOrderPreview(): void {
    const pad = (n: number) => String(n).padStart(2, '0');
    const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const fmtLabel = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
    const dayNames = ['一', '二', '三', '四', '五', '六'];

    // Today as order date
    this.orderDate = fmt(new Date());

    // Next week = selected week + 7 days (order is for NEXT week)
    const monday = new Date(`${this.weekStart}T00:00:00`);
    monday.setDate(monday.getDate() + 7);
    this.orderPreviewDates = [];
    this.orderPreviewDayLabels = [];
    for (let i = 0; i < 6; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      this.orderPreviewDates.push(fmt(d));
      this.orderPreviewDayLabels.push(`週${dayNames[i]}(${fmtLabel(d)})`);
    }

    // Only dialysateCa and bicarbonateType
    const orderCategories = ['dialysateCa', 'bicarbonateType'];
    this.orderPreviewItems = [];
    this.orderPreviewGrid = {};

    for (const category of orderCategories) {
      for (const item of this.getItemsForCategory(category)) {
        const orderQty = this.getOrderQuantity(category, item);
        if (orderQty <= 0) continue;

        const key = `${category}|${item}`;
        const label = `${CATEGORY_NAMES[category]} - ${item}`;
        const hospitalCode = this.getHospitalCode(category, item);
        this.orderPreviewItems.push({ category, item, label, hospitalCode });

        // Split order qty evenly between Mon(index 0) and Wed(index 2)
        const half1 = Math.ceil(orderQty / 2);
        const half2 = orderQty - half1;
        this.orderPreviewGrid[key] = [half1, 0, half2, 0, 0, 0];
      }
    }

    this.showOrderPreview.set(true);
  }

  async confirmExportOrder(): Promise<void> {
    const XLSX = await import('xlsx');
    const rows: any[][] = [];

    // Row 1: Order date
    rows.push(['訂購日期', this.orderDate]);
    // Row 2: Usage date range (simple)
    const firstDate = this.orderPreviewDates[0]?.replace(/^\d{4}-/, '').replace('-', '/');
    const lastDate = this.orderPreviewDates[5]?.replace(/^\d{4}-/, '').replace('-', '/');
    rows.push(['訂單使用日期', `${firstDate}-${lastDate}`]);
    // Row 3: Delivery days
    rows.push(['到貨日', '★', '', '★', '', '', '']);
    // Empty row
    rows.push([]);
    // Header row
    rows.push(['院內代碼', '品項', ...this.orderPreviewDayLabels]);

    // Data rows
    for (const entry of this.orderPreviewItems) {
      const key = `${entry.category}|${entry.item}`;
      const grid = this.orderPreviewGrid[key] || [0, 0, 0, 0, 0, 0];
      rows.push([entry.hospitalCode || '', entry.label, ...grid]);
    }

    // Signature rows
    rows.push([]);
    rows.push([]);
    const currentUser = this.authService.currentUser();
    rows.push([`製表人：${currentUser?.name || ''}`]);
    rows.push(['洗腎室護理長：']);

    const ws = XLSX.utils.aoa_to_sheet(rows);

    // Set column widths
    ws['!cols'] = [
      { wch: 14 },
      { wch: 30 },
      { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '訂單');

    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/octet-stream' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `每週訂單_${this.isoWeek}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);

    this.showOrderPreview.set(false);

    // 同步建成行事曆叫貨（每格 >0 的數量 → 一筆待到貨，預計到貨日 = 該欄日期）
    if (this.createCalendarOrdersOnExport) {
      const result = await this.createCalendarOrdersFromPreview();
      this.showAlert('匯出成功', `訂單已下載。${result}`);
    } else {
      this.showAlert('匯出成功', '訂單已下載');
    }
  }

  /**
   * 訂單預覽表 → 行事曆叫貨（inventory_purchases status=ordered，同一 batch）
   * 訂單數量是「個」，行事曆以整箱計：箱數 = 無條件進位(個數 / 每箱個數)，個數 = 箱數 × 每箱個數。
   * 同品項同預計到貨日已有待到貨時先確認，避免重複叫。
   */
  private async createCalendarOrdersFromPreview(): Promise<string> {
    const entries: any[] = [];
    for (const entry of this.orderPreviewItems) {
      const grid = this.orderPreviewGrid[`${entry.category}|${entry.item}`] || [];
      const unitsPerBox = this.getUnitsPerBox(entry.category, entry.item) || 1;
      grid.forEach((units: number, idx: number) => {
        const u = Number(units) || 0;
        if (u <= 0 || !this.orderPreviewDates[idx]) return;
        const boxQuantity = unitsPerBox > 1 ? Math.ceil(u / unitsPerBox) : u;
        entries.push({
          category: entry.category,
          item: entry.item,
          boxQuantity,
          quantity: boxQuantity * unitsPerBox,
          expectedDate: this.orderPreviewDates[idx],
          orderDate: this.orderDate,
          status: 'ordered',
          notes: `每週訂單 ${this.isoWeek}（訂單量 ${u} 個）`,
        });
      });
    }
    if (entries.length === 0) return '（訂單無數量，未建立行事曆叫貨）';

    try {
      const existing = (await this.purchasesApi.fetchAll()) as any[];
      const dup = entries.filter((e) =>
        existing.some((p) => p.status === 'ordered' && p.category === e.category && p.item === e.item && p.expectedDate === e.expectedDate),
      );
      if (dup.length > 0) {
        const sample = dup.slice(0, 3).map((d) => `${d.expectedDate} ${d.item}`).join('、');
        if (!confirm(`行事曆已有 ${dup.length} 筆同品項同到貨日的待到貨（如 ${sample}），仍要再建立 ${entries.length} 筆叫貨嗎？\n（取消 = 只匯出 Excel，不建立）`)) {
          return '（未建立行事曆叫貨）';
        }
      }
      const res: any = await firstValueFrom(this.api.post('/system/inventory/purchases/batch', { entries }));
      this.changed.emit();
      return `已建立 ${res?.count ?? entries.length} 筆行事曆叫貨（待到貨），可到行事曆查看。`;
    } catch (error: any) {
      console.error('建立行事曆叫貨失敗:', error);
      return `但建立行事曆叫貨失敗：${error?.error?.message || error?.message || error}`;
    }
  }

  getOrderRowTotal(category: string, item: string): number {
    const grid = this.orderPreviewGrid[`${category}|${item}`] || [];
    return grid.reduce((sum: number, v: number) => sum + (Number(v) || 0), 0);
  }
}
