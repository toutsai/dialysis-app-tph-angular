import { ModalFocusDirective } from '@app/core/directives/modal-focus.directive';
// 叫貨/到貨行事曆（庫存管理 > 叫貨/到貨紀錄）
// 資料 = inventory_purchases：status 'ordered'（已叫貨待到貨，顯示在預計到貨日）/ 'arrived'（已到貨=入庫，顯示在到貨日）
// 庫存計算只算 arrived（後端 monthly/calculation 與父元件盤點皆已過濾）
import { Component, EventEmitter, Input, OnInit, OnChanges, SimpleChanges, Output, computed, inject, signal, ChangeDetectionStrategy } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '@services/api.service';
import { ApiManagerService, type ApiManager, type FirestoreRecord } from '@services/api-manager.service';
import { AuthService } from '@services/auth.service';
import { InventoryStockService, type CountDoc } from './inventory-stock.service';
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
  imports: [FormsModule, ModalFocusDirective],
  templateUrl: './purchase-calendar.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './purchase-calendar.component.css',
})
export class PurchaseCalendarComponent implements OnInit, OnChanges {
  private readonly api = inject(ApiService);
  private readonly stock = inject(InventoryStockService);
  @Input() unitLabelFn:(category:string,item:string)=>string=()=>'';
  @Input() initialDate='';
  @Input() initialMode='week';
  @Input() initialCategory='';
  @Input() initialItem='';
  @Output() countRequested=new EventEmitter<string>();
  @Output() hisRequested=new EventEmitter<string>();
  @Output() dateSelected=new EventEmitter<{date:string;category:string;item:string;mode:string}>();
  private sourceRequest=0;
  mode=signal<'week'|'month'>('week');
  selectedDate=signal(ymdOf(new Date()));
  counts=signal<CountDoc[]>([]);
  coverage=signal<any[]>([]);
  dailyDetail=signal<any>(null);
  calendarDays=signal<Record<string,any>>({});
  detailLoading=signal(false);
  selectedSource=signal<any>(null);
  private dailyRequest=0;
  private newSnapshot='';
  private detailSnapshot='';
  private newKey='';
  private formSnapshot():string{return JSON.stringify([this.newForm,this.batchRows()]);}
  canLeave():boolean {if(this.saving()){alert('請等待叫貨／到貨儲存完成。');return false;}const dirty=(this.showNewModal()&&this.formSnapshot()!==this.newSnapshot)||(this.showDetail()&&JSON.stringify([this.detailEdit,this.arriveDate])!==this.detailSnapshot);return !dirty||confirm('叫貨／到貨修改尚未儲存，確定捨棄？');}

  readonly shownWeeks=computed(()=>this.mode()==='month'?this.weeks():[this.makeWeek(this.selectedDate())]);
  private makeWeek(date:string):CalendarCell[]{const d=new Date(date+'T12:00:00');d.setDate(d.getDate()-(d.getDay()+6)%7);return Array.from({length:7},(_,i)=>{const cur=new Date(d);cur.setDate(d.getDate()+i);const ymd=ymdOf(cur);return {ymd,day:cur.getDate(),inMonth:ymd.startsWith(this.month()),isToday:ymd===this.today,entries:this.entriesByDate().get(ymd)||[]};});}
  countOn(date:string):CountDoc|undefined{return this.counts().find(c=>c.countDate===date);}
  sourcesOn(date:string):any[]{return this.coverage().filter(s=>s.startDate<=date && s.endDate>=date && (!this.filterCategory() || s.category===this.filterCategory()));}
  orderEventsOn(date:string):PurchaseEntry[]{return this.filtered().filter(e=>toLocalYmd(e.orderDate)===date && this.displayDate(e)!==date);}
  selectedEntries():PurchaseEntry[]{return this.filtered().filter(e=>this.displayDate(e)===this.selectedDate());}
  async openSource(source:any):Promise<void>{
    const request=++this.sourceRequest;
    this.selectedSource.set({...source,items:[],loading:true});
    try{const ranges=await this.stock.ensureActualRanges();const range=ranges.find(r=>r.start===source.startDate&&r.end===source.endDate);const items=Object.entries(range?.grouped?.[source.category]||{}).map(([item,quantity])=>({item,quantity}));
      if(request===this.sourceRequest&&this.selectedSource())this.selectedSource.set({...source,items,loading:false});
    }catch{if(request===this.sourceRequest&&this.selectedSource())this.selectedSource.set({...source,items:[],loadError:true,loading:false});}
  }
  closeSource():void{++this.sourceRequest;this.selectedSource.set(null);}
  ngOnDestroy():void{++this.sourceRequest;++this.dailyRequest;}
  async selectDay(date:string):Promise<void>{this.requestSelection(date);}
  private requestSelection(date=this.selectedDate(),category=this.filterCategory(),item=this.filterItem(),mode=this.mode()):void {this.dateSelected.emit({date,category,item,mode});}
  setDisplayMode(mode:'week'|'month'):void{this.requestSelection(this.selectedDate(),this.filterCategory(),this.filterItem(),mode);}
  async loadDailyDetail():Promise<void>{const request=++this.dailyRequest;this.dailyDetail.set(null);this.calendarDays.set({});if(!this.filterCategory()||!this.filterItem()){this.detailLoading.set(false);return;}this.detailLoading.set(true);try{const date=this.selectedDate();const data=await this.stock.itemTimeline(this.filterCategory(),this.filterItem(),this.stock.addDays(date,-1),date,this.counts(),this.all());if(request===this.dailyRequest)this.dailyDetail.set(data);const weeks=this.shownWeeks();const first=weeks[0]?.[0]?.ymd,last=weeks[weeks.length-1]?.[6]?.ymd;if(first&&last){const grid=await this.stock.itemTimeline(this.filterCategory(),this.filterItem(),this.stock.addDays(first,-1),last,this.counts(),this.all());if(request===this.dailyRequest)this.calendarDays.set(Object.fromEntries(grid.days.map(day=>[day.date,day])));}}catch(error:any){if(request===this.dailyRequest)this.dailyDetail.set({warnings:[error?.message||'每日需求載入失敗'],days:[]});}finally{if(request===this.dailyRequest)this.detailLoading.set(false);}}

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
  /** 篩選單一品項（空 = 全部；值 = 品項名稱） */
  filterItem = signal('');

  /** 品項篩選下拉的選項：依類別分組，= 已知品項 ∪ 紀錄裡出現過的品項 */
  readonly itemFilterGroups = computed<{ category: string; label: string; items: string[] }[]>(() => {
    const cat = this.filterCategory();
    const rows = this.all();
    return this.categoryKeys
      .filter((c) => !cat || c === cat)
      .map((c) => {
        const set = new Set<string>(this.knownItems[c] || []);
        for (const e of rows) if (e.category === c && e.item) set.add(e.item);
        return { category: c, label: CATEGORY_NAMES[c], items: [...set].sort((a, b) => a.localeCompare(b, 'zh-Hant')) };
      })
      .filter((g) => g.items.length > 0);
  });

  /** 套用類別 + 品項篩選後的紀錄（行事曆、待到貨摘要、本月統計共用） */
  readonly filtered = computed(() => {
    const cat = this.filterCategory();
    const item = this.filterItem();
    if (!cat && !item) return this.all();
    return this.all().filter((e) => (!cat || e.category === cat) && (!item || e.item === item));
  });
  readonly hasFilter = computed(() => !!this.filterCategory() || !!this.filterItem());
  readonly filterLabel = computed(() => {
    const cat = this.filterCategory();
    const item = this.filterItem();
    const parts: string[] = [];
    if (cat) parts.push(CATEGORY_NAMES[cat] || cat);
    if (item) parts.push(item);
    return parts.join(' / ');
  });

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
    for (const e of this.filtered()) {
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

  /** 全部待到貨（不限月份、套用篩選），依預計到貨日排序 */
  readonly pending = computed(() =>
    this.filtered()
      .filter((e) => e.status === 'ordered')
      .sort((a, b) => String(a.expectedDate || '').localeCompare(String(b.expectedDate || ''))),
  );
  readonly overdue = computed(() => this.pending().filter((e) => (e.expectedDate || '') < this.today));
  readonly monthStats = computed(() => {
    const ym = this.month();
    let ordered = 0;
    let arrived = 0;
    for (const e of this.filtered()) {
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
  /** 批次新增：展開後的日期列，每列可各自填箱數（不同日期數量可不同） */
  batchRows = signal<{ date: string; boxQuantity: number }[]>([]);
  /** 使用者按 × 拿掉的日期（重算時不再加回） */
  private excludedDates = new Set<string>();

  // ---------------- 明細 modal ----------------
  showDetail = signal(false);
  detail = signal<PurchaseEntry | null>(null);
  detailEdit = { boxQuantity: 1, expectedDate: '', orderDate: '', notes: '', item: '', category: '' };
  arriveDate = '';

  constructor() {
    this.purchasesApi = this.apiManager.create<FirestoreRecord>('inventory_purchases');
  }

  ngOnChanges(changes:SimpleChanges):void {
    if(!Object.values(changes).some(change=>!change.firstChange))return;
    this.closeSource();
    if(changes['initialMode'])this.mode.set(this.initialMode==='month'?'month':'week');
    if(changes['initialCategory'])this.filterCategory.set(this.initialCategory||'');
    if(changes['initialItem'])this.filterItem.set(this.initialItem||'');
    if(changes['initialDate']){const date=this.initialDate||this.today;this.selectedDate.set(date);this.month.set(date.slice(0,7));}
    this.loadDailyDetail();
  }
  ngOnInit(): void {
    this.mode.set(this.initialMode==='month'?'month':'week');
    if(this.initialDate){this.selectedDate.set(this.initialDate);this.month.set(this.initialDate.slice(0,7));}
    this.filterCategory.set(this.initialCategory);this.filterItem.set(this.initialItem);this.load();
  }

  async load(): Promise<void> {
    this.stock.invalidateActualRanges();this.loading.set(true);
    try {
      const rows = (await this.purchasesApi.fetchAll()) as unknown as PurchaseEntry[];
      this.all.set(rows.map((r) => ({ ...r, status: r.status === 'ordered' ? 'ordered' : 'arrived' })));
      const [counts,coverage]=await Promise.all([firstValueFrom(this.api.get<CountDoc[]>('/system/inventory/counts')),firstValueFrom(this.api.get<any[]>('/orders/consumables/coverage'))]);this.counts.set(counts);this.coverage.set(coverage.map(source=>({...source,startDate:String(source.startDate).replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'),endDate:String(source.endDate).replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3')})));await this.loadDailyDetail();
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
    if(this.mode()==='week'){this.selectDay(shiftDateString(this.selectedDate(),delta*7));}else{this.selectDay(shiftMonthString(this.month(),delta)+'-01');}
  }
  goToday(): void {
    this.selectDay(this.today);
  }
  /** 改類別篩選：目前選的品項若不屬於該類別就清掉 */
  setFilterCategory(cat: string): void {
    const item=this.filterItem();
    const keep=!cat || (this.knownItems[cat] || []).includes(item);
    this.requestSelection(this.selectedDate(),cat,keep?item:'');
  }
  setFilterItem(item: string): void {
    let category=this.filterCategory();
    if(item&&!category){const owners=Object.keys(this.knownItems).filter(key=>this.knownItems[key].includes(item));if(owners.length===1)category=owners[0];}
    this.requestSelection(this.selectedDate(),category,item);
  }
  clearFilters(): void {this.requestSelection(this.selectedDate(),'','');}
  /** 表單變動 → 重算批次日期列（保留已填過的箱數） */
  touch(): void {
    if (!this.newForm.batch) {
      this.batchRows.set([]);
      return;
    }
    const prev = new Map(this.batchRows().map((r) => [r.date, r.boxQuantity]));
    const rows = this.expandBatchDates()
      .filter((d) => !this.excludedDates.has(d))
      .map((date) => ({ date, boxQuantity: prev.get(date) ?? this.newForm.boxQuantity ?? 1 }));
    this.batchRows.set(rows);
  }
  removeBatchDate(date: string): void {
    this.excludedDates.add(date);
    this.batchRows.set(this.batchRows().filter((r) => r.date !== date));
  }
  /** 把「預設箱數」套到全部日期 */
  applyDefaultBoxesToAll(): void {
    const q = this.newForm.boxQuantity > 0 ? this.newForm.boxQuantity : 1;
    this.batchRows.set(this.batchRows().map((r) => ({ ...r, boxQuantity: q })));
  }
  batchTotalBoxes(): number {
    return this.batchRows().reduce((s, r) => s + (Number(r.boxQuantity) || 0), 0);
  }
  batchRowsValid(): boolean {
    const rows = this.batchRows();
    return rows.length > 0 && rows.every((r) => Number(r.boxQuantity) > 0);
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
  weekdayOf(ymd: string): string {
    const d = new Date(ymd + 'T00:00:00');
    return isNaN(d.getTime()) ? '' : this.weekdayLabels[(d.getDay() + 6) % 7];
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
    this.excludedDates.clear();
    this.batchRows.set([]);
    this.touch();
    this.newKey=crypto.randomUUID();this.newSnapshot=this.formSnapshot();this.showNewModal.set(true);
  }
  closeNew(): void {
    if(!this.canLeave())return;this.showNewModal.set(false);
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
    if (!f.category || !f.item) return false;
    if (f.batch) return this.batchRowsValid();
    return f.boxQuantity > 0 && !!f.expectedDate;
  }

  async saveNew(): Promise<void> {
    if (!this.isNewFormValid || this.saving()) return;
    const f = this.newForm;
    const unitsPerBox = this.unitsPerBox(f.category, f.item);
    const base = {
      idempotencyKey:this.newKey,
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
        // 每個日期各自的箱數
        const entries = this.batchRows().map((row) => ({
          ...base,
          boxQuantity: Number(row.boxQuantity),
          quantity: Number(row.boxQuantity) * unitsPerBox,
          expectedDate: row.date,
          status: 'ordered',
        }));
        await firstValueFrom(this.api.post('/system/inventory/purchases/batch', { entries,idempotencyKey:this.newKey }));
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
    this.detailSnapshot=JSON.stringify([this.detailEdit,this.arriveDate]);this.showDetail.set(true);
  }
  closeDetail(): void {
    if(!this.canLeave())return;
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
    if(this.detailEdit.boxQuantity!==e.boxQuantity || this.detailEdit.item!==e.item){alert('到貨確認為整筆原單。若需更正品項或箱數，請先儲存修改後再確認。');return;}
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

      } as any);
      this.showDetail.set(false);this.detail.set(null);
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
