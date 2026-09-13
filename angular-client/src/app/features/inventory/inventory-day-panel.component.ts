// src/app/features/inventory/inventory-day-panel.component.ts
// 庫存管理 > 作業行事曆 > 日面板：
//   ① 當日叫貨/到貨明細（唯讀）② 當日排程預估消耗 ③ 盤點（庫存推算的唯一基準）
// 盤點輸入/儲存/刪除/紀錄邏輯照抄自 inventory.component.ts 的 counts 頁籤（ts:1473-1650），
// 只把 date 改成 @Input、showAlert 改成 alert.emit、盤點紀錄列點擊改成 dateSelected.emit。
import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnInit,
  Output,
  SimpleChanges,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '@services/api.service';
import { ApiManagerService, type ApiManager, type FirestoreRecord } from '@services/api-manager.service';
import { ConsumptionEngineService } from '@services/consumption-engine.service';
import { InventoryStockService, type CountDoc, type CountVersion, type Grouped } from './inventory-stock.service';
import type { PurchaseEntry } from './purchase-calendar.component';
import { INVENTORY_CATEGORY_NAMES, emptyGroupedByCategory, emptyItemLists } from './inventory-categories';

const CATEGORY_NAMES = INVENTORY_CATEGORY_NAMES;

@Component({
  selector: 'app-inventory-day-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './inventory-day-panel.component.html',
  styleUrl: './inventory-day-panel.component.css',
})
export class InventoryDayPanelComponent implements OnInit, OnChanges {
  private readonly apiManagerService = inject(ApiManagerService);
  private readonly api = inject(ApiService);
  private readonly consumptionEngine = inject(ConsumptionEngineService);
  private readonly stock = inject(InventoryStockService);
  private readonly countsApi: ApiManager<FirestoreRecord>;

  @Input() date!: string;
  @Input() entries: PurchaseEntry[] = [];
  @Input() inventoryItems: any[] = [];
  @Input() knownItems: Record<string, string[]> = emptyItemLists();
  @Input() unitsPerBoxFn: (category: string, item: string) => number = () => 1;

  /** 只顯示 ③ 盤點區（工具列「今日盤點」視窗用；隱藏叫貨明細與預估消耗） */
  @Input() countOnly = false;

  @Output() changed = new EventEmitter<void>();
  @Output() alert = new EventEmitter<{ title: string; message: string }>();
  @Output() dateSelected = new EventEmitter<string>();

  readonly CATEGORY_NAMES = CATEGORY_NAMES;
  readonly categoryKeys = Object.keys(CATEGORY_NAMES);
  /** 判斷叫貨/到貨明細「逾期」用；一次性讀取即可，不需要跨午夜反應 */
  private readonly today = this.stock.todayString();

  constructor() {
    this.countsApi = this.apiManagerService.create<FirestoreRecord>('inventory_counts');
  }

  ngOnInit(): void {
    this.loadCountRecords();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['date']) {
      this.loadForecast();
      this.loadCountDoc();
    }
  }

  // ==================== ① 叫貨/到貨明細 ====================

  get sortedEntries(): PurchaseEntry[] {
    return [...(this.entries || [])].sort((a, b) =>
      `${a.category}${a.item}`.localeCompare(`${b.category}${b.item}`, 'zh-Hant'),
    );
  }

  entryStatus(e: PurchaseEntry): 'arrived' | 'overdue' | 'ordered' {
    if (e.status === 'arrived') return 'arrived';
    return (e.expectedDate || '') < this.today ? 'overdue' : 'ordered';
  }

  entryStatusLabel(e: PurchaseEntry): string {
    const status = this.entryStatus(e);
    if (status === 'arrived') return '已到貨';
    if (status === 'overdue') return '逾期未到';
    return '待到貨';
  }

  // ==================== ② 當日排程預估消耗 ====================

  forecastLoading = signal(false);
  forecast = signal<Grouped>(emptyGroupedByCategory());

  async loadForecast(): Promise<void> {
    if (!this.date) return;
    this.forecastLoading.set(true);
    try {
      const result = await this.consumptionEngine.calculateTheoreticalConsumption(this.date, this.date);
      this.forecast.set(result.grouped as Grouped);
    } catch (error) {
      console.warn('當日預估消耗載入失敗:', error);
      this.forecast.set(emptyGroupedByCategory());
    } finally {
      this.forecastLoading.set(false);
    }
  }

  isForecastEmpty(): boolean {
    return Object.values(this.forecast()).every((cat) => Object.keys(cat).length === 0);
  }

  // ==================== ③ 盤點 ====================

  countsLoading = signal(false);
  countsSaving = signal(false);
  countBoxes: Record<string, Record<string, number>> = emptyGroupedByCategory();
  countUnits: Record<string, Record<string, number>> = emptyGroupedByCategory();
  countNotes = '';
  /** 目前日期在後端是否已有盤點文件（決定「刪除」鈕是否可用） */
  countDocExists = signal(false);
  countDocInfo = signal<{ createdBy: string; updatedBy: string; updatedAt: string } | null>(null);
  /** 盤點紀錄列表（最近 30 筆） */
  countRecords = signal<{ countDate: string; by: string; updatedAt: string }[]>([]);
  /** 目前載入的盤點文件版本號（存檔時帶 expectedRevision；null = 尚無文件） */
  private countRevision: number | null = null;
  /** 存檔/刪除撞到別人先存 → 顯示衝突橫幅，保留使用者輸入 */
  countConflict = signal<{ message: string; by: string; at: string; currentRevision: number } | null>(null);
  /** 此日版本歷史（每次儲存/刪除一版） */
  showHistory = signal(false);
  historyLoading = signal(false);
  countHistory = signal<CountVersion[]>([]);

  /** 品項清單：優先用父元件的 knownItems；缺項時從 inventoryItems 補（同等邏輯，不另算單位） */
  getItemsForCategory(category: string): string[] {
    const known = this.knownItems?.[category];
    if (known && known.length > 0) return known;
    const set = new Set<string>();
    for (const item of this.inventoryItems || []) {
      if (item?.category === category && item?.name) set.add(String(item.name));
    }
    return [...set];
  }

  private resetCountInputs(): void {
    for (const category of this.categoryKeys) {
      this.countBoxes[category] = {};
      this.countUnits[category] = {};
      for (const item of this.getItemsForCategory(category)) {
        this.countBoxes[category][item] = 0;
        this.countUnits[category][item] = 0;
      }
    }
  }

  /** 箱數 → 個數（unitsPerBox = 1 者箱數即個數） */
  syncCountUnits(): void {
    for (const category of this.categoryKeys) {
      for (const [item, boxes] of Object.entries(this.countBoxes[category] || {})) {
        this.countUnits[category][item] = (Number(boxes) || 0) * this.unitsPerBoxFn(category, item);
      }
    }
  }

  /** 載入盤點日的文件；沒有就以全 0 起始 */
  async loadCountDoc(): Promise<void> {
    const date = this.date;
    if (!date) return;
    this.countsLoading.set(true);
    this.countDocInfo.set(null);
    this.countDocExists.set(false);
    this.countConflict.set(null);
    this.countRevision = null;
    this.resetCountInputs();
    this.countNotes = '';

    try {
      const doc = (await this.countsApi.fetchById(date)) as CountDoc | null;
      if (doc) {
        this.countDocExists.set(true);
        this.countRevision = Number(doc.revision) || 1;
        this.countNotes = doc.notes || '';
        for (const category of this.categoryKeys) {
          const units = doc.counts?.[category] || {};
          const boxes = doc.countBoxes?.[category] || {};
          for (const [item, value] of Object.entries(units)) {
            this.countUnits[category][item] = Number(value) || 0;
          }
          for (const [item, value] of Object.entries(boxes)) {
            this.countBoxes[category][item] = Number(value) || 0;
          }
          // 舊資料沒存箱數 → 由個數回推
          for (const [item, value] of Object.entries(units)) {
            if (this.countBoxes[category][item] === undefined || this.countBoxes[category][item] === 0) {
              const unitsPerBox = this.unitsPerBoxFn(category, item);
              const n = Number(value) || 0;
              if (boxes[item] === undefined && n > 0) {
                this.countBoxes[category][item] = unitsPerBox > 1 ? Math.round(n / unitsPerBox) : n;
              }
            }
          }
        }
        this.countDocInfo.set({
          createdBy: doc.createdBy?.name || '未知',
          updatedBy: doc.updatedBy?.name || doc.createdBy?.name || '未知',
          updatedAt: doc.updatedAt || doc.createdAt || '',
        });
      }
    } catch (error: any) {
      console.error('載入盤點紀錄失敗:', error);
      this.alert.emit({ title: '載入失敗', message: error?.error?.message || error?.message || String(error) });
    } finally {
      this.countsLoading.set(false);
    }
    if (this.showHistory()) void this.loadCountHistory();
  }

  /** 409：別人先存了 → 不覆蓋、不清輸入，顯示橫幅讓使用者決定重新載入 */
  private handleCountConflict(error: any): boolean {
    if (error?.status !== 409) return false;
    const body = error?.error || {};
    this.countConflict.set({
      message: body.message || '此日盤點已被他人更新',
      by: body.updatedBy?.name || '他人',
      at: body.updatedAt || '',
      currentRevision: Number(body.currentRevision) || 0,
    });
    return true;
  }

  /** 衝突橫幅「載入最新盤點」：捨棄本機輸入，重讀伺服器版本 */
  reloadLatestCount(): void {
    void this.loadCountDoc();
  }

  // ==================== 版本歷史 ====================

  toggleHistory(): void {
    this.showHistory.set(!this.showHistory());
    if (this.showHistory()) void this.loadCountHistory();
  }

  async loadCountHistory(): Promise<void> {
    const date = this.date;
    if (!date) return;
    this.historyLoading.set(true);
    try {
      const list = await firstValueFrom(this.api.get<CountVersion[]>(`/system/inventory/counts/${date}/history`));
      this.countHistory.set(Array.isArray(list) ? list : []);
    } catch (error) {
      console.warn('載入盤點版本歷史失敗:', error);
      this.countHistory.set([]);
    } finally {
      this.historyLoading.set(false);
    }
  }

  /** 把某一版的數量帶進輸入格（不寫入；按「儲存盤點」才會成為新版本） */
  applyVersion(v: CountVersion): void {
    this.resetCountInputs();
    for (const category of this.categoryKeys) {
      for (const [item, value] of Object.entries(v.counts?.[category] || {})) this.countUnits[category][item] = Number(value) || 0;
      for (const [item, value] of Object.entries(v.countBoxes?.[category] || {})) this.countBoxes[category][item] = Number(value) || 0;
      for (const [item, value] of Object.entries(v.counts?.[category] || {})) {
        if (!this.countBoxes[category][item]) {
          const n = Number(value) || 0;
          const perBox = this.unitsPerBoxFn(category, item);
          this.countBoxes[category][item] = perBox > 1 ? Math.round(n / perBox) : n;
        }
      }
    }
    this.countNotes = v.notes || '';
    this.alert.emit({ title: '已帶入歷史版本', message: `已把第 ${v.revision} 版（${v.actor?.name || '未知'} ${v.createdAt}）的數量帶入輸入格，按「儲存盤點」才會寫入成新版本。` });
  }

  historyTotal(v: CountVersion): number {
    let n = 0;
    for (const category of this.categoryKeys) for (const value of Object.values(v.counts?.[category] || {})) n += Number(value) || 0;
    return n;
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

  /** 儲存盤點（以盤點日為 key，upsert） */
  async saveCountDoc(): Promise<void> {
    const date = this.date;
    if (!date) {
      this.alert.emit({ title: '無法儲存', message: '請先選擇盤點日。' });
      return;
    }
    this.syncCountUnits();
    this.countsSaving.set(true);
    try {
      const doc = (await this.countsApi.save(date, {
        counts: this.buildGroupedCopy(this.countUnits),
        countBoxes: this.buildGroupedCopy(this.countBoxes),
        notes: this.countNotes || '',
        // 樂觀鎖：已有文件時帶目前版本，別人先存過會被 409 擋下（新文件不帶）
        ...(this.countDocExists() && this.countRevision ? { expectedRevision: this.countRevision } : {}),
      } as any)) as CountDoc;

      this.countDocExists.set(true);
      this.countRevision = Number(doc?.revision) || (this.countRevision || 0) + 1;
      this.countConflict.set(null);
      this.countDocInfo.set({
        createdBy: doc?.createdBy?.name || '未知',
        updatedBy: doc?.updatedBy?.name || doc?.createdBy?.name || '未知',
        updatedAt: doc?.updatedAt || doc?.createdAt || '',
      });
      await this.loadCountRecords();
      if (this.showHistory()) void this.loadCountHistory();
      this.changed.emit();
      this.alert.emit({ title: '操作成功', message: `${date} 盤點已儲存（第 ${this.countRevision} 版）` });
    } catch (error: any) {
      if (this.handleCountConflict(error)) return;
      console.error('儲存盤點失敗:', error);
      this.alert.emit({ title: '儲存失敗', message: error?.error?.message || error?.message || String(error) });
    } finally {
      this.countsSaving.set(false);
    }
  }

  /** 刪除盤點日的文件 */
  async deleteCountDoc(): Promise<void> {
    const date = this.date;
    if (!date || !this.countDocExists()) return;
    if (!confirm(`確定要刪除 ${date} 的盤點紀錄嗎？此動作無法復原。`)) return;

    try {
      // DELETE 沒有 body → 版本號走 query；後端不符回 409
      const q = this.countRevision ? `?expectedRevision=${this.countRevision}` : '';
      await firstValueFrom(this.api.delete(`/system/inventory/counts/${date}${q}`));
      this.countDocExists.set(false);
      this.countDocInfo.set(null);
      this.countRevision = null;
      this.countConflict.set(null);
      this.resetCountInputs();
      this.countNotes = '';
      await this.loadCountRecords();
      if (this.showHistory()) void this.loadCountHistory();
      this.changed.emit();
      this.alert.emit({ title: '操作成功', message: `${date} 盤點紀錄已刪除（版本歷史保留，可從歷史帶回）` });
    } catch (error: any) {
      if (this.handleCountConflict(error)) return;
      console.error('刪除盤點失敗:', error);
      this.alert.emit({ title: '刪除失敗', message: error?.error?.message || error?.message || String(error) });
    }
  }

  /** 盤點紀錄列表（最近 30 筆，新→舊） */
  async loadCountRecords(): Promise<void> {
    try {
      const list = (await this.countsApi.fetchAll()) as unknown as CountDoc[];
      this.countRecords.set(
        (list || []).slice(0, 30).map((d) => ({
          countDate: d.countDate,
          by: d.updatedBy?.name || d.createdBy?.name || '未知',
          updatedAt: d.updatedAt || d.createdAt || '',
        })),
      );
    } catch (error) {
      console.error('載入盤點紀錄列表失敗:', error);
      this.countRecords.set([]);
    }
  }

  /** 點盤點紀錄列 → 通知父元件切換日期（父元件改變 date 傳回來，本元件 ngOnChanges 會重載） */
  selectCountRecord(countDate: string): void {
    this.dateSelected.emit(countDate);
  }
}
