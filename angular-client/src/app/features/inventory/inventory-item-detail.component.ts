import { AfterViewInit, Component, ElementRef, EventEmitter, Input, OnDestroy, Output, ViewChild, ChangeDetectionStrategy } from '@angular/core';
import { addLocalDays, localDay } from './inventory-calculation';

@Component({ selector: 'app-inventory-item-detail', standalone: true, templateUrl: './inventory-item-detail.component.html', changeDetection: ChangeDetectionStrategy.Eager,
 styleUrl: './inventory-item-detail.component.css' })
export class InventoryItemDetailComponent implements AfterViewInit, OnDestroy {
  @Input({ required: true }) selected!: { category: string; item: string };
  @Input() detail: any = null;
  @Input() loading = false;
  @Input() unit = '';
  @Input() purchases: any[] = [];
  @Output() closed = new EventEmitter<void>();
  @Output() calendarRequested = new EventEmitter<void>();
  @ViewChild('dialog', { static: true }) dialog!: ElementRef<HTMLDialogElement>;
  ngAfterViewInit(): void { this.dialog.nativeElement.showModal(); }
  ngOnDestroy(): void { this.dialog.nativeElement.close(); }
  cancel(event: Event): void { event.preventDefault(); this.closed.emit(); }
  amount(value: unknown): string {
    return typeof value === 'number' && Number.isFinite(value) ? new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 2 }).format(value) + (this.unit ? ' ' + this.unit : '') : '未知';
  }
  get asOf(): string { return this.detail?.asOf || localDay(new Date()); }
  get baseline(): number | null { return this.detail?.anchor?.counts?.[this.selected.category]?.[this.selected.item] ?? null; }
  get cutoffLabel(): string {
    if (!this.detail?.anchor) return '尚無基準';
    return this.detail.anchor.cutoff === 'end-of-day' ? '全部班別後（日終）' : this.detail.anchor.cutoff === 'start-of-day' ? '當日班別前（日初）' : '舊盤點沿用日初，時點未核實';
  }
  get receipts(): any[] {
    const anchor = this.detail?.anchor;
    if (!anchor) return [];
    const start = anchor.cutoff === 'end-of-day' ? addLocalDays(anchor.countDate, 1) : anchor.countDate;
    return this.purchases.filter(row => row.category === this.selected.category && row.item === this.selected.item && (!row.status || row.status === 'arrived') && String(row.date || '').slice(0, 10) >= start && String(row.date || '').slice(0, 10) <= this.asOf).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }
  get deficitLabel(): string {
    if (this.detail?.firstDeficitDate) return this.detail.firstDeficitDate;
    if (this.detail?.current == null || this.detail?.days?.some((day: any) => day.projectedBalance == null)) return '資料不足，尚無法判定';
    return '查詢期間未見不足';
  }
  rangeCoverage(range: any): any { return range.categoryCoverage?.[this.selected.category]; }
  rangeQuantity(range: any): number | null {
    const value = range.grouped?.[this.selected.category]?.[this.selected.item];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    return this.rangeCoverage(range)?.complete === true ? 0 : null;
  }
  dayArrivals(date: string): string {
    const rows = this.purchases.filter(row => row.category === this.selected.category && row.item === this.selected.item && String(row.status === 'ordered' ? row.expectedDate || '' : row.date || '').slice(0, 10) === date);
    if (!rows.length) return '無';
    const pending = rows.some(row => row.status === 'ordered');
    const arrived = rows.some(row => !row.status || row.status === 'arrived');
    return pending && arrived ? '含待到貨與已到貨' : pending ? '待到貨' : '已到貨';
  }
}
