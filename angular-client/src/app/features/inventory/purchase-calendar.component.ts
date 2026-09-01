// 叫貨/到貨行事曆（庫存管理 > 叫貨/到貨紀錄）
// 資料 = inventory_purchases：status 'ordered'（已叫貨待到貨，顯示在預計到貨日）/ 'arrived'（已到貨=入庫，顯示在到貨日）
// 庫存計算只算 arrived（後端 monthly/calculation 與父元件盤點皆已過濾）
import { Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '@services/api.service';
import { ApiManagerService, type ApiManager, type FirestoreRecord } from '@services/api-manager.service';
import { AuthService } from '@services/auth.service';
import { shiftMonthString, shiftDateString } from '@/utils/dateStep';

export type PurchaseStatus = 'ordered' | 'arrived';

export interface PurchaseEntry {
  id: string;
  item: string;
  category: string;
  quantity: number;
  boxQuantity: number;
  /** 實際到貨(入庫)日；舊資料可能是 ISO 字串 */
  date: string | null;
  status: PurchaseStatus;
  orderDate: string | null;
  expectedDate: string | null;
  batchId: string | null;
  notes?: string | null;
  createdBy?: string;
  arrivedBy?: { name?: string } | null;
}

interface CalendarCell {
  ymd: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
  entries: PurchaseEntry[];
}

const CATEGORY_SHORT: Record<string, string> = {
  artificialKidney: 'AK',
  dialysateCa: 'A液',
  bicarbonateType: 'B液',
};
const CATEGORY_NAMES: Record<string, string> = {
  artificialKidney: '人工腎臟',
  dialysateCa: '透析藥水CA',
  bicarbonateType: 'B液種類',
};

const pad2 = (n: number) => String(n).padStart(2, '0');
const ymdOf = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** 'YYYY-MM-DD' 原樣；ISO/其他字串 → 本地日期 */
export function toLocalYmd(value: string | null | undefined): string {
  if (!value) return '';
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return isNaN(d.getTime()) ? s.substring(0, 10) : ymdOf(d);
}

@Component({
  selector: 'app-purchase-calendar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './purchase-calendar.component.html',
  styleUrl: './purchase-calendar.component.css',
})
export class PurchaseCalendarComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly apiManager = inject(ApiManagerService);
  protected readonly authService = inject(AuthService);
  private readonly purchasesApi: ApiManager<FirestoreRecord>;

  /** 各類別可選品項（由父元件的 knownItems 提供） */
  @Input() knownItems: Record<string, string[]> = { artificialKidney: [], dialysateCa: [], bicarbonateType: [] };
  /** 每箱個數（由父元件的品項設定提供） */
  @Input() unitsPerBoxFn: (category: string, item: string) => number = () => 1;
  /** 資料異動後通知父元件（重新載入列表/盤點） */
  @Output() changed = new EventEmitter<void>();

  readonly CATEGORY_NAMES = CATEGORY_NAMES;
  readonly CATEGORY_SHORT = CATEGORY_SHORT;
  readonly categoryKeys = Object.keys(CATEGORY_NAMES);
  readonly weekdayLabels = ['一', '二', '三', '四', '五', '六', '日'];
  readonly today = ymdOf(new Date());

  month = signal(this.today.substring(0, 7));
  loading = signal(false);
  all = signal<PurchaseEntry[]>([]);
  /** 篩選類別（空 = 全部） */
  filterCategory = signal('');

  /** 行事曆格子（週一起，6 列 × 7） */
  readonly weeks = computed<CalendarCell[][]>(() => {
    const [y, m] = this.month().split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const startOffset = (first.getDay() + 6) % 7; // 週一=0
    const gridStart = new Date(y, m - 1, 1 - startOffset);
    const byDate = this.entriesByDate();
    const weeks: CalendarCell[][] = [];
    for (let w = 0; w < 6; w++) {
      const row: CalendarCell[] = [];
      for (let d = 0; d < 7; d++) {
        const cur = new Date(gridStart);
        cur.setDate(gridStart.getDate() + w * 7 + d);
        const ymd = ymdOf(cur);
        row.push({
          ymd,
          day: cur.getDate(),
          inMonth: cur.getMonth() === m - 1,
          isToday: ymd === this.today,
          entries: byDate.get(ymd) || [],
        });
      }
      weeks.push(row);
      // 最後一列全在下月就不顯示
      if (w >= 4 && weeks[w].every((c) => !c.inMonth)) {
        weeks.pop();
        break;
      }
    }
    return weeks;
  });

  /** 顯示日期 → 條目（叫貨看預計到貨日、已到貨看到貨日） */
  private readonly entriesByDate = computed(() => {
    const map = new Map<string, PurchaseEntry[]>();
    const cat = this.filterCategory();
    for (const e of this.all()) {
      if (cat && e.category !== cat) continue;
      const key = this.displayDate(e);
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.status === b.status ? 0 : a.status === 'ordered' ? -1 : 1) || a.category.localeCompare(b.category));
    }
    return map;
  });

  /** 全部待到貨（不限月份），依預計到貨日排序 */
  readonly pending = computed(() =>
    this.all()
      .filter((e) => e.status === 'ordered')
      .sort((a, b) => String(a.expectedDate || '').localeCompare(String(b.expectedDate || ''))),
  );
  readonly overdue = computed(() => this.pending().filter((e) => (e.expectedDate || '') < this.today));
  readonly monthStats = computed(() => {
    const ym = this.month();
    let ordered = 0;
    let arrived = 0;
    for (const e of this.all()) {
      if (this.displayDate(e).substring(0, 7) !== ym) continue;
      if (e.status === 'ordered') ordered++;
      else arrived++;
    }
    return { ordered, arrived };
  });

  // ---------------- 新增叫貨 modal ----------------
  showNewModal = signal(false);
  saving = signal(false);
  newForm = {
    expectedDate: '',
    orderDate: '',
    category: 'artificialKidney',
    item: '',
    boxQuantity: 1,
    notes: '',
    /** 直接標記已到貨（=舊的「新增進貨」） */
    arrivedNow: false,
    batch: false,
    rangeStart: '',
    rangeEnd: '',
    repeat: 'weekly' as 'weekly' | 'biweekly',
    weekdays: [false, false, false, false, false, false, false] as boolean[], // 一..日
  };
  /** 讓 template 在表單變動後重算預覽 */
  formVersion = signal(0);
  readonly batchPreview = computed(() => {
    this.formVersion();
    return this.expandBatchDates();
  });

  // ---------------- 明細 modal ----------------
  showDetail = signal(false);
  detail = signal<PurchaseEntry | null>(null);
  detailEdit = { boxQuantity: 1, expectedDate: '', orderDate: '', notes: '', item: '', category: '' };
  arriveDate = '';

  constructor() {
    this.purchasesApi = this.apiManager.create<FirestoreRecord>('inventory_purchases');
  }

  ngOnInit(): void {
    this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      const rows = (await this.purchasesApi.fetchAll()) as unknown as PurchaseEntry[];
      this.all.set(rows.map((r) => ({ ...r, status: r.status === 'ordered' ? 'ordered' : 'arrived' })));
    } catch (error) {
      console.error('載入叫貨/到貨紀錄失敗:', error);
    } finally {
      this.loading.set(false);
    }
  }

  displayDate(e: PurchaseEntry): string {
    return e.status === 'ordered' ? toLocalYmd(e.expectedDate) : toLocalYmd(e.date) || toLocalYmd(e.expectedDate);
  }

  stepMonth(delta: number): void {
    this.month.set(shiftMonthString(this.month(), delta));
  }
  goToday(): void {
    this.month.set(this.today.substring(0, 7));
  }
  touch(): void {
    this.formVersion.update((v) => v + 1);
  }

  entryClass(e: PurchaseEntry): string {
    if (e.status === 'arrived') return 'arrived';
    return (e.expectedDate || '') < this.today ? 'overdue' : 'ordered';
  }
  entryLabel(e: PurchaseEntry): string {
    return `${CATEGORY_SHORT[e.category] || e.category} ${e.item} ×${e.boxQuantity || 0}箱`;
  }
  statusText(e: PurchaseEntry): string {
    if (e.status === 'arrived') return '已到貨';
    return (e.expectedDate || '') < this.today ? '逾期未到' : '待到貨';
  }
  formatMd(ymd: string | null | undefined): string {
    const s = toLocalYmd(ymd);
    return s ? `${s.substring(5, 7)}/${s.substring(8, 10)}` : '-';
  }
  daysLate(e: PurchaseEntry): number {
    const exp = toLocalYmd(e.expectedDate);
    if (!exp) return 0;
    const a = new Date(exp + 'T00:00:00').getTime();
    const b = new Date(this.today + 'T00:00:00').getTime();
    return Math.round((b - a) / 86400000);
  }
  itemsFor(category: string): string[] {
    return this.knownItems[category] || [];
  }
  unitsPerBox(category: string, item: string): number {
    return this.unitsPerBoxFn(category, item) || 1;
  }

  // ---------------- 新增 ----------------
  openNew(ymd?: string): void {
    const date = ymd || this.today;
    this.newForm.expectedDate = date;
    this.newForm.orderDate = this.today;
    this.newForm.item = this.newForm.item && this.itemsFor(this.newForm.category).includes(this.newForm.item) ? this.newForm.item : '';
    this.newForm.boxQuantity = 1;
    this.newForm.notes = '';
    this.newForm.arrivedNow = false;
    this.newForm.batch = false;
    this.newForm.rangeStart = date;
    this.newForm.rangeEnd = shiftDateString(date, 27);
    this.newForm.repeat = 'weekly';
    const dow = (new Date(date + 'T00:00:00').getDay() + 6) % 7;
    this.newForm.weekdays = this.weekdayLabels.map((_, i) => i === dow);
    this.touch();
    this.showNewModal.set(true);
  }
  closeNew(): void {
    this.showNewModal.set(false);
  }
  onCategoryChange(): void {
    if (!this.itemsFor(this.newForm.category).includes(this.newForm.item)) this.newForm.item = '';
    this.touch();
  }
  toggleWeekday(i: number): void {
    this.newForm.weekdays[i] = !this.newForm.weekdays[i];
    this.touch();
  }

  /** 批次：起訖日內符合「每週/隔週 × 星期幾」的日期 */
  private expandBatchDates(): string[] {
    const f = this.newForm;
    if (!f.batch || !f.rangeStart || !f.rangeEnd || f.rangeEnd < f.rangeStart) return [];
    if (!f.weekdays.some(Boolean)) return [];
    const start = new Date(f.rangeStart + 'T00:00:00');
    const end = new Date(f.rangeEnd + 'T00:00:00');
    // 隔週：以起日所在週（週一起算）為第 0 週，只取偶數週
    const startMonday = new Date(start);
    startMonday.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const out: string[] = [];
    for (let d = new Date(start); d <= end && out.length < 200; d.setDate(d.getDate() + 1)) {
      const dow = (d.getDay() + 6) % 7;
      if (!f.weekdays[dow]) continue;
      if (f.repeat === 'biweekly') {
        const weekIndex = Math.floor((d.getTime() - startMonday.getTime()) / (7 * 86400000));
        if (weekIndex % 2 !== 0) continue;
      }
      out.push(ymdOf(d));
    }
    return out;
  }

  get isNewFormValid(): boolean {
    const f = this.newForm;
    if (!f.category || !f.item || !(f.boxQuantity > 0)) return false;
    if (f.batch) return this.batchPreview().length > 0;
    return !!f.expectedDate;
  }

  async saveNew(): Promise<void> {
    if (!this.isNewFormValid || this.saving()) return;
    const f = this.newForm;
    const unitsPerBox = this.unitsPerBox(f.category, f.item);
    const base = {
      category: f.category,
      item: f.item,
      boxQuantity: f.boxQuantity,
      quantity: f.boxQuantity * unitsPerBox,
      notes: f.notes || null,
      orderDate: f.orderDate || this.today,
    };
    this.saving.set(true);
    try {
      if (f.batch) {
        const entries = this.batchPreview().map((expectedDate) => ({ ...base, expectedDate, status: 'ordered' }));
        await firstValueFrom(this.api.post('/system/inventory/purchases/batch', { entries }));
      } else if (f.arrivedNow) {
        await this.purchasesApi.create({ ...base, status: 'arrived', expectedDate: f.expectedDate, date: f.expectedDate } as any);
      } else {
        await this.purchasesApi.create({ ...base, status: 'ordered', expectedDate: f.expectedDate } as any);
      }
      if (!this.knownItems[f.category]?.includes(f.item)) (this.knownItems[f.category] ||= []).push(f.item);
      this.showNewModal.set(false);
      await this.load();
      this.changed.emit();
    } catch (error: any) {
      console.error('新增叫貨失敗:', error);
      alert(`新增失敗：${error?.error?.message || error?.message || error}`);
    } finally {
      this.saving.set(false);
    }
  }

  // ---------------- 明細 / 到貨 / 編輯 / 刪除 ----------------
  openDetail(e: PurchaseEntry, event?: Event): void {
    event?.stopPropagation();
    this.detail.set(e);
    this.detailEdit = {
      boxQuantity: e.boxQuantity || 1,
      expectedDate: toLocalYmd(e.expectedDate),
      orderDate: toLocalYmd(e.orderDate),
      notes: e.notes || '',
      item: e.item,
      category: e.category,
    };
    const exp = toLocalYmd(e.expectedDate);
    this.arriveDate = e.status === 'arrived' ? toLocalYmd(e.date) : exp && exp <= this.today ? exp : this.today;
    this.showDetail.set(true);
  }
  closeDetail(): void {
    this.showDetail.set(false);
    this.detail.set(null);
  }
  batchSiblings(e: PurchaseEntry | null): number {
    if (!e?.batchId) return 0;
    return this.all().filter((x) => x.batchId === e.batchId && x.status === 'ordered' && x.id !== e.id).length;
  }

  async markArrived(): Promise<void> {
    const e = this.detail();
    if (!e || this.saving()) return;
    if (!this.arriveDate) {
      alert('請填到貨日');
      return;
    }
    this.saving.set(true);
    try {
      const unitsPerBox = this.unitsPerBox(e.category, e.item);
      await this.purchasesApi.update(e.id, {
        status: 'arrived',
        date: this.arriveDate,
        boxQuantity: this.detailEdit.boxQuantity,
        quantity: this.detailEdit.boxQuantity * unitsPerBox,
      } as any);
      this.closeDetail();
      await this.load();
      this.changed.emit();
    } catch (error: any) {
      alert(`標記到貨失敗：${error?.error?.message || error?.message || error}`);
    } finally {
      this.saving.set(false);
    }
  }

  async revertToOrdered(): Promise<void> {
    const e = this.detail();
    if (!e || this.saving()) return;
    if (!confirm('要把這筆改回「待到貨」嗎？（會從庫存入庫中移除）')) return;
    this.saving.set(true);
    try {
      await this.purchasesApi.update(e.id, {
        status: 'ordered',
        expectedDate: this.detailEdit.expectedDate || toLocalYmd(e.date) || this.today,
      } as any);
      this.closeDetail();
      await this.load();
      this.changed.emit();
    } catch (error: any) {
      alert(`改回待到貨失敗：${error?.error?.message || error?.message || error}`);
    } finally {
      this.saving.set(false);
    }
  }

  async saveDetailEdit(): Promise<void> {
    const e = this.detail();
    if (!e || this.saving()) return;
    const d = this.detailEdit;
    if (!d.item || !(d.boxQuantity > 0)) return;
    this.saving.set(true);
    try {
      const unitsPerBox = this.unitsPerBox(d.category, d.item);
      const payload: any = {
        item: d.item,
        category: d.category,
        boxQuantity: d.boxQuantity,
        quantity: d.boxQuantity * unitsPerBox,
        notes: d.notes || null,
        orderDate: d.orderDate || null,
      };
      if (e.status === 'ordered') payload.expectedDate = d.expectedDate;
      else payload.date = this.arriveDate || toLocalYmd(e.date);
      await this.purchasesApi.update(e.id, payload);
      this.closeDetail();
      await this.load();
      this.changed.emit();
    } catch (error: any) {
      alert(`儲存失敗：${error?.error?.message || error?.message || error}`);
    } finally {
      this.saving.set(false);
    }
  }

  async deleteOne(): Promise<void> {
    const e = this.detail();
    if (!e || this.saving()) return;
    if (!confirm(`確定刪除這筆「${this.entryLabel(e)}」？`)) return;
    this.saving.set(true);
    try {
      await this.purchasesApi.delete(e.id);
      this.closeDetail();
      await this.load();
      this.changed.emit();
    } catch (error: any) {
      alert(`刪除失敗：${error?.error?.message || error?.message || error}`);
    } finally {
      this.saving.set(false);
    }
  }

  async deleteBatchPending(): Promise<void> {
    const e = this.detail();
    if (!e?.batchId || this.saving()) return;
    const n = this.batchSiblings(e) + (e.status === 'ordered' ? 1 : 0);
    if (!confirm(`確定刪除同批次尚未到貨的 ${n} 筆叫貨？（已到貨的會保留）`)) return;
    this.saving.set(true);
    try {
      await firstValueFrom(this.api.delete(`/system/inventory/purchases/batch/${e.batchId}`));
      this.closeDetail();
      await this.load();
      this.changed.emit();
    } catch (error: any) {
      alert(`刪除批次失敗：${error?.error?.message || error?.message || error}`);
    } finally {
      this.saving.set(false);
    }
  }

  onOverlayClick(event: MouseEvent, which: 'new' | 'detail'): void {
    if (event.target === event.currentTarget) {
      if (which === 'new') this.closeNew();
      else this.closeDetail();
    }
  }
}
