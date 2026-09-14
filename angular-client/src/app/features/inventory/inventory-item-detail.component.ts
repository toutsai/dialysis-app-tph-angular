// src/app/features/inventory/inventory-item-detail.component.ts
// 庫存總覽卡片 → 單一品項明細視窗：最近盤點 → 盤後到貨/消耗 → 目前推估 → 未來 14 天逐日餘量 → 預計不足日。
// 摘要數字直接沿用父元件卡片（dashItem），逐日拆解由 InventoryStockService.itemTimeline 產生，兩者同一套推算規則。
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiManagerService, type ApiManager, type FirestoreRecord } from '@services/api-manager.service';
import { InventoryStockService, type CountDoc, type ItemTimeline } from './inventory-stock.service';
import { INVENTORY_CATEGORY_NAMES, isConsumptionTracked } from './inventory-categories';

/** 父元件庫存總覽卡片的一筆（loadDashboard 產出） */
export interface DashboardItemSummary {
  category: string;
  itemName: string;
  estimatedStock: number;
  safeLevel: number;
  autoSafeLevel: number;
  dailyUsage: number;
  todayConsumption: number;
  remainingAfterToday: number;
  pending: number;
  status: 'safe' | 'warning' | 'danger' | 'critical';
  statusLabel: string;
  /** 品名不在「品項設定」（來自病人醫囑的舊拼法或未建檔型號）→ 卡片標示「未設定品項」 */
  unregistered?: boolean;
}

@Component({
  selector: 'app-inventory-item-detail',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './inventory-item-detail.component.html',
  styleUrl: './inventory-item-detail.component.css',
})
export class InventoryItemDetailComponent implements OnChanges {
  private readonly stock = inject(InventoryStockService);
  private readonly apiManagerService = inject(ApiManagerService);
  private readonly countsApi: ApiManager<FirestoreRecord>;

  @Input({ required: true }) dashItem!: DashboardItemSummary;
  @Input() purchases: any[] = [];
  @Input() inventoryItems: any[] = [];
  @Output() close = new EventEmitter<void>();

  readonly CATEGORY_NAMES = INVENTORY_CATEGORY_NAMES;
  loading = signal(true);
  timeline = signal<ItemTimeline | null>(null);
  error = signal('');
  private seq = 0;

  constructor() {
    this.countsApi = this.apiManagerService.create<FirestoreRecord>('inventory_counts');
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['dashItem'] || changes['purchases']) void this.load();
  }

  private async load(): Promise<void> {
    const seq = ++this.seq;
    this.loading.set(true);
    this.error.set('');
    try {
      // 與庫存總覽同一個基準：後端 /counts/latest（今天或之前最近一次盤點）
      const countDoc = (await this.countsApi.fetchById('latest').catch(() => null)) as CountDoc | null;
      const t = await this.stock.itemTimeline(this.dashItem.category, this.dashItem.itemName, countDoc, this.purchases);
      if (seq !== this.seq) return;
      this.timeline.set(t);
    } catch (e: any) {
      if (seq !== this.seq) return;
      console.error('品項明細載入失敗:', e);
      this.error.set(e?.message || '載入失敗');
    } finally {
      if (seq === this.seq) this.loading.set(false);
    }
  }

  get item(): any {
    return (this.inventoryItems || []).find((i) => i?.category === this.dashItem.category && i?.name === this.dashItem.itemName) || null;
  }

  get unitsPerBox(): number {
    return Number(this.item?.unitsPerBox) || 1;
  }

  get tracked(): boolean {
    return isConsumptionTracked(this.dashItem.category);
  }

  /** 建議訂購 = max(0, 安全庫存 − 推估庫存 − 待到貨)，與週面板同公式 */
  get orderQuantity(): number {
    return this.stock.orderQuantity(this.dashItem.safeLevel, this.dashItem.estimatedStock, this.dashItem.pending);
  }

  get orderBoxes(): number {
    return this.unitsPerBox > 1 ? Math.round(this.orderQuantity / this.unitsPerBox) : this.orderQuantity;
  }

  /** 撐幾天（以日均計；日均 0 → 無法估） */
  get daysOfStock(): string {
    const d = this.dashItem.dailyUsage;
    if (!d || d <= 0) return this.tracked ? '日均 0，無法估' : '無消耗來源';
    const days = this.dashItem.remainingAfterToday / d;
    return days < 0 ? '已不足' : `約 ${Math.floor(days)} 天`;
  }

  get nextDelivery(): { date: string; quantity: number } | null {
    const t = this.timeline();
    const next = t?.pending.find((p) => !p.overdue);
    return next ? { date: next.date, quantity: next.quantity } : null;
  }

  get deficitLabel(): string {
    const t = this.timeline();
    if (!t) return '—';
    if (t.firstDeficitDate) return t.firstDeficitDate;
    if (t.baseline === null) return '尚無盤點，無法判定';
    return `${t.horizonEnd} 前不會不足`;
  }

  boxes(units: number): string {
    return this.unitsPerBox > 1 ? `${(units / this.unitsPerBox).toFixed(1)} 箱` : '';
  }

  fmt(n: number | null | undefined): string {
    if (n === null || n === undefined || !Number.isFinite(n)) return '—';
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
  }

  onOverlayClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.close.emit();
  }
}
