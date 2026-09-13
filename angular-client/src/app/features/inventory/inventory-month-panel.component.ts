// src/app/features/inventory/inventory-month-panel.component.ts
// 庫存作業行事曆重構：月面板（契約 D 節）。
// 內容：① 月報表（沿用 counts 頁籤月報表演算法）② 每月消耗量（含匯出 Excel）
// ③ 自訂區間排程推算（可收合，預設收合）。
// 邏輯照抄 inventory.component.ts，一律透過 InventoryStockService 推算，不另算一套。
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '@services/api.service';
import { ConsumptionEngineService, type ConsumptionResult } from '@services/consumption-engine.service';
import { ApiManagerService, type ApiManager, type FirestoreRecord } from '@services/api-manager.service';
import { shiftDateLike, type DateStepKind } from '@/utils/dateStep';
import { InventoryStockService, type CountDoc } from './inventory-stock.service';

const CATEGORY_NAMES: Record<string, string> = {
  artificialKidney: '人工腎臟',
  dialysateCa: '透析藥水CA',
  bicarbonateType: 'B液種類',
};

interface CountReportRow {
  category: string;
  categoryName: string;
  item: string;
  opening: number | null;
  arrived: number;
  consumed: number;
  daysLabel: string;
  closing: number | null;
  counted: number | null;
  diff: number | null;
}

/** 本地今日 YYYY-MM-DD（不可用 toISOString：UTC+8 在凌晨會退回前一天/上個月） */
function localToday(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

@Component({
  selector: 'app-inventory-month-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './inventory-month-panel.component.html',
  styleUrl: './inventory-month-panel.component.css',
})
export class InventoryMonthPanelComponent implements OnChanges {
  private readonly api = inject(ApiService);
  private readonly apiManagerService = inject(ApiManagerService);
  private readonly consumptionEngine = inject(ConsumptionEngineService);
  /** 庫存推算單一權威（盤點/到貨/消耗/安全庫存/訂購量） */
  private readonly stock = inject(InventoryStockService);

  private readonly countsApi: ApiManager<FirestoreRecord>;
  private readonly consumablesReportsApi: ApiManager<FirestoreRecord>;
  private readonly purchasesApi: ApiManager<FirestoreRecord>;

  constructor() {
    this.countsApi = this.apiManagerService.create<FirestoreRecord>('inventory_counts');
    this.consumablesReportsApi = this.apiManagerService.create<FirestoreRecord>('consumables_reports');
    this.purchasesApi = this.apiManagerService.create<FirestoreRecord>('inventory_purchases');
  }

  /** 父元件的 purchases 尚未載入或載入失敗時自行抓（與週面板同規則），避免「當月到貨」靜默算成 0 */
  private async resolvePurchases(): Promise<any[]> {
    if (Array.isArray(this.purchases) && this.purchases.length > 0) return this.purchases;
    try {
      return (await this.purchasesApi.fetchAll()) as any[];
    } catch (error) {
      console.warn('讀取叫貨/到貨紀錄失敗，月報表到貨以 0 計:', error);
      return [];
    }
  }

  @Input() month = '';
  @Input() inventoryItems: any[] = [];
  @Input() purchases: any[] = [];
  @Input() unitsPerBoxFn: (category: string, item: string) => number = () => 1;

  @Output() alert = new EventEmitter<{ title: string; message: string }>();

  readonly categoryKeys = Object.keys(CATEGORY_NAMES);
  readonly CATEGORY_NAMES = CATEGORY_NAMES;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['month'] && this.month) {
      this.loadCountMonthReport();
      this.loadMonthlySummary();
      return;
    }
    // 到貨/叫貨異動 → 當月到貨、期末推估要跟著重算
    if (changes['purchases'] && !changes['purchases'].firstChange && this.month) {
      this.loadCountMonthReport();
    }
  }

  private showAlert(title: string, message: string): void {
    this.alert.emit({ title, message });
  }

  /** 品項設定（inventoryItems）中，屬於某類別的品項名稱清單 */
  private getItemsForCategory(category: string): string[] {
    return (this.inventoryItems || [])
      .filter((i: any) => i?.category === category)
      .map((i: any) => i.name);
  }

  getUnitsPerBox(category: string, itemName: string): number {
    return this.unitsPerBoxFn(category, itemName) || 1;
  }

  calculateBoxes(category: string, itemName: string, units: number): string | number {
    const unitsPerBox = this.getUnitsPerBox(category, itemName);
    if (unitsPerBox <= 1) return units;
    return (units / unitsPerBox).toFixed(1);
  }

  // ==================== ① 月報表 ====================

  countReportLoading = signal(false);
  countReportLoaded = signal(false);
  countReportBaseDate = signal('');
  /** 當月最後一次盤點日（用於「差異」欄位標題） */
  countReportLastCountDate = signal('');
  countReportNote = signal('');
  countReportRows = signal<CountReportRow[]>([]);

  /** 讀「某日或之前最近一次盤點」；404 → null */
  private async fetchLatestCountBefore(before: string): Promise<CountDoc | null> {
    try {
      const doc = await firstValueFrom(
        this.api.get<CountDoc>('/system/inventory/counts/latest', { before }),
      );
      return doc || null;
    } catch (error: any) {
      if (error?.status === 404) return null;
      console.warn('讀取最近盤點失敗:', error);
      return null;
    }
  }

  /**
   * 月報表：期初（以該月第一天之前最近一次盤點推估到月初）、當月到貨、當月消耗、
   * 期末推估，以及當月最後一次盤點量與差異。
   */
  async loadCountMonthReport(): Promise<void> {
    if (!this.month) return;
    this.countReportLoading.set(true);
    this.countReportLoaded.set(false);
    this.countReportNote.set('');
    this.countReportRows.set([]);

    try {
      const { start, end } = this.stock.monthRange(this.month);
      const purchases = await this.resolvePurchases();

      // 期初基準：月初前一天（含）最近一次盤點
      const baseDoc = await this.fetchLatestCountBefore(this.stock.addDays(start, -1));
      this.countReportBaseDate.set(baseDoc?.countDate || '');

      const opening = baseDoc
        ? await this.stock.estimateStock(baseDoc, this.stock.addDays(start, -1), purchases)
        : null;
      if (!baseDoc) {
        this.countReportNote.set('該月月初之前沒有盤點紀錄，期初結存無法推算（顯示「—」）。請先補一筆盤點。');
      }

      const arrived = this.stock.arrivedBetween(purchases, start, end);
      const consumed = await this.stock.consumptionBetween(start, end);
      const daysLabel = this.stock.daysLabel(consumed.actualDays, consumed.estimatedDays);

      // 當月最後一次盤點
      const monthCounts = (await this.countsApi.fetchAll()) as unknown as CountDoc[];
      const lastCount = (monthCounts || []).find(
        (d) => d.countDate >= start && d.countDate <= end,
      ) || null;
      // 推估到「該盤點日開始前」的庫存，才能跟盤點量對比
      const estimateAtCount =
        lastCount && baseDoc
          ? await this.stock.estimateStock(baseDoc, this.stock.addDays(lastCount.countDate, -1), purchases)
          : null;

      const itemsByCategory = this.stock.collectItems([
        opening?.stock,
        arrived,
        consumed.grouped,
        lastCount ? this.stock.normalizeGrouped(lastCount.counts) : null,
      ]);

      const rows: CountReportRow[] = [];
      for (const category of this.categoryKeys) {
        const items = new Set<string>([
          ...(itemsByCategory[category] || []),
          ...this.getItemsForCategory(category),
        ]);
        for (const item of [...items].sort()) {
          const open = opening ? this.stock.value(opening.stock, category, item) : null;
          const got = this.stock.value(arrived, category, item);
          const used = this.stock.value(consumed.grouped, category, item);
          const closing = open != null ? open + got - used : null;
          const counted = lastCount
            ? this.stock.value(this.stock.normalizeGrouped(lastCount.counts), category, item)
            : null;
          const estAtCount = estimateAtCount
            ? this.stock.value(estimateAtCount.stock, category, item)
            : null;
          if (open == null && got === 0 && used === 0 && counted == null) continue;
          rows.push({
            category,
            categoryName: CATEGORY_NAMES[category],
            item,
            opening: open,
            arrived: got,
            consumed: used,
            daysLabel,
            closing,
            counted,
            diff: counted != null && estAtCount != null ? counted - estAtCount : null,
          });
        }
      }

      this.countReportRows.set(rows);
      this.countReportLastCountDate.set(lastCount?.countDate || '');
      this.countReportLoaded.set(true);
    } catch (error: any) {
      console.error('盤點月報表計算失敗:', error);
      this.showAlert('計算失敗', error?.error?.message || error?.message || String(error));
    } finally {
      this.countReportLoading.set(false);
    }
  }

  // ==================== ② 每月消耗量 ====================

  summaryLoading = signal(false);
  summaryLoaded = signal(false);
  monthlySummaryData: Record<string, Record<string, number>> = {
    artificialKidney: {},
    dialysateCa: {},
    bicarbonateType: {},
  };

  async loadMonthlySummary(): Promise<void> {
    if (!this.month) return;
    this.summaryLoading.set(true);
    this.summaryLoaded.set(false);

    for (const category of Object.keys(this.monthlySummaryData)) {
      this.monthlySummaryData[category] = {};
    }

    try {
      const consumption = await this.getMonthlyConsumption(this.month);
      for (const category of Object.keys(this.monthlySummaryData)) {
        this.monthlySummaryData[category] = consumption[category] || {};
      }
      this.summaryLoaded.set(true);
    } catch (error: any) {
      console.error('載入當月總量失敗:', error);
      this.showAlert('載入失敗', error.message);
    } finally {
      this.summaryLoading.set(false);
    }
  }

  getCategoryTotal(category: string): number {
    const data = this.monthlySummaryData[category] || {};
    return Object.values(data).reduce((sum, count) => sum + (count || 0), 0);
  }

  getSummaryItemKeys(category: string): string[] {
    return Object.keys(this.monthlySummaryData[category] || {});
  }

  private async getMonthlyConsumption(month: string): Promise<Record<string, Record<string, number>>> {
    const result: Record<string, Record<string, number>> = {
      artificialKidney: {},
      dialysateCa: {},
      bicarbonateType: {},
    };

    try {
      const allReports = await this.consumablesReportsApi.fetchAll();
      const filteredReports = (allReports as any[]).filter((r: any) => r.reportMonth === month);

      filteredReports.forEach((report: any) => {
        const data = report.data || {};
        for (const category of Object.keys(result)) {
          if (data[category] && Array.isArray(data[category])) {
            data[category].forEach((item: any) => {
              result[category][item.item] = (result[category][item.item] || 0) + (item.count || 0);
            });
          }
        }
      });
    } catch (error) {
      console.error('取得月消耗資料失敗:', error);
    }

    return result;
  }

  async exportMonthlySummary(): Promise<void> {
    const XLSX = await import('xlsx');
    const rows: any[][] = [['類別', '品項', '每箱數量', '當月消耗(個)', '當月消耗(箱)']];

    for (const category of Object.keys(CATEGORY_NAMES)) {
      const items = this.monthlySummaryData[category] || {};
      for (const [item, count] of Object.entries(items)) {
        rows.push([
          CATEGORY_NAMES[category],
          item,
          this.getUnitsPerBox(category, item),
          count,
          this.calculateBoxes(category, item, count),
        ]);
      }
    }

    rows.push([]);
    rows.push(['類別小計', '', '', '', '']);
    for (const category of Object.keys(CATEGORY_NAMES)) {
      rows.push([CATEGORY_NAMES[category], '合計', '', this.getCategoryTotal(category), '']);
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '當月消耗總量');

    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/octet-stream' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `當月消耗總量_${this.month}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  }

  // ==================== ③ 自訂區間排程推算（可收合，預設收合） ====================

  theoreticalCollapsed = signal(true);
  theoreticalLoading = signal(false);
  theoreticalResult = signal<ConsumptionResult | null>(null);
  theoreticalFilter = {
    startDate: localToday(),
    endDate: localToday(),
  };

  toggleTheoretical(): void {
    this.theoreticalCollapsed.set(!this.theoreticalCollapsed());
  }

  stepDate(target: Record<string, any>, key: string, delta: number, kind: DateStepKind): void {
    target[key] = shiftDateLike(String(target[key] || ''), delta, kind);
  }

  async runTheoreticalConsumption(): Promise<void> {
    this.theoreticalLoading.set(true);
    this.theoreticalResult.set(null);
    try {
      const result = await this.consumptionEngine.calculateTheoreticalConsumption(
        this.theoreticalFilter.startDate,
        this.theoreticalFilter.endDate,
      );
      this.theoreticalResult.set(result);
    } catch (error: any) {
      console.error('理論消耗推算失敗:', error);
      this.showAlert('推算失敗', error.message);
    } finally {
      this.theoreticalLoading.set(false);
    }
  }
}
