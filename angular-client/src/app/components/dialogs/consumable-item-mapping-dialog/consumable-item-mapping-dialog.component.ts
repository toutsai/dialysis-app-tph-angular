import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

/** 後端 POST /consumables/process 回 needsItemMapping 時的形狀 */
export interface ConsumableItemMappingRequest {
  needsItemMapping: true;
  message: string;
  fileName: string;
  category: string;
  categoryLabel: string;
  reportMonth: string;
  rangeKey: string;
  rangeLabel: string;
  unmatchedItems: { item: string; rowCount: number; totalCount: number }[];
  inventoryItems: { id: string; name: string }[];
}

export type ConsumableItemMappingDecision =
  | { action: 'map'; itemId: string; remember: boolean }
  | { action: 'create' }
  | { action: 'skip' };

/** { [上傳品名]: 決定 }，原樣送回後端的 itemMappings */
export type ConsumableItemMappings = Record<string, ConsumableItemMappingDecision>;

interface MappingRow {
  item: string;
  rowCount: number;
  totalCount: number;
  action: 'map' | 'create' | 'skip';
  itemId: string;
  remember: boolean;
  suggested: boolean;
}

/** 寬鬆比對 key：去空白/標點、大寫（僅用於預選建議，與後端寬鬆比對無關） */
function fuzzyKey(s: string): string {
  return String(s ?? '')
    .toUpperCase()
    .replace(/[\s\-_.,/:()（）]/g, '');
}

/**
 * 消耗紀錄上傳 → 品項對照確認視窗
 * 上傳的 HIS 品名在「品項設定」找不到時，逐項讓使用者決定：對應既有品項 / 新增為品項 / 略過不匯入。
 * 品項設定是唯一權威，對應後報表一律存品項設定的正式名稱；勾「記住」會寫入別名，下次自動對應。
 */
@Component({
  selector: 'app-consumable-item-mapping-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    @if (request) {
    <div class="cim-overlay" (click)="onOverlayClick($event)">
      <div class="cim-dialog" role="dialog" aria-modal="true" aria-labelledby="cim-title">
        <div class="cim-header">
          <h3 id="cim-title">消耗紀錄品項對照確認</h3>
          <button type="button" class="cim-close" aria-label="關閉" (click)="cancel.emit()">&times;</button>
        </div>
        <div class="cim-body">
          <div class="cim-meta">
            <span><strong>類別</strong> {{ request.categoryLabel }}</span>
            <span><strong>區間</strong> {{ request.rangeLabel }}（{{ request.reportMonth }}）</span>
            <span class="cim-file" [title]="request.fileName"><strong>檔案</strong> {{ request.fileName }}</span>
          </div>
          <p class="cim-hint">
            以下 <strong>{{ rows.length }}</strong> 個品項在「品項設定」（{{ request.categoryLabel }}）中找不到，
            <strong>尚未寫入任何資料</strong>。請逐項確認：對應到既有品項、新增為品項，或略過不匯入。
            勾選「記住」後，之後上傳同名品項會自動對應，不再詢問（可在品項設定的別名欄移除）。
          </p>
          <div class="cim-table-wrap">
            <table class="cim-table">
              <thead>
                <tr>
                  <th>上傳品名</th>
                  <th>筆數 / 數量</th>
                  <th>處理方式</th>
                  <th>對應到品項設定</th>
                  <th>記住</th>
                </tr>
              </thead>
              <tbody>
                @for (row of rows; track row.item) {
                <tr [class.is-skip]="row.action === 'skip'">
                  <td class="cim-item"><code>{{ row.item }}</code></td>
                  <td class="cim-count">{{ row.rowCount }} 筆 / {{ row.totalCount }}</td>
                  <td>
                    <select [(ngModel)]="row.action" (ngModelChange)="onActionChange(row)">
                      <option value="map">對應既有品項</option>
                      <option value="create">新增為品項「{{ row.item }}」</option>
                      <option value="skip">略過不匯入</option>
                    </select>
                  </td>
                  <td>
                    @if (row.action === 'map') {
                    <select [(ngModel)]="row.itemId" [class.is-empty]="!row.itemId">
                      <option value="">請選擇品項…</option>
                      @for (it of request.inventoryItems; track it.id) {
                      <option [value]="it.id">{{ it.name }}</option>
                      }
                    </select>
                    @if (row.suggested && row.itemId) {
                    <div class="cim-suggest">系統建議，請確認</div>
                    }
                    } @else if (row.action === 'create') {
                    <span class="cim-note">將新增品項「{{ row.item }}」（{{ request.categoryLabel }}），數量等設定請之後到品項設定補齊</span>
                    } @else {
                    <span class="cim-note cim-note-skip">此品項 {{ row.rowCount }} 筆不會寫入報表</span>
                    }
                  </td>
                  <td class="cim-remember">
                    @if (row.action === 'map') {
                    <input type="checkbox" [(ngModel)]="row.remember" title="記住此對應，之後自動套用" />
                    } @else {
                    <span class="cim-dash">—</span>
                    }
                  </td>
                </tr>
                }
              </tbody>
            </table>
          </div>
          @if (request.inventoryItems.length === 0) {
          <p class="cim-warn">「品項設定」目前沒有任何 {{ request.categoryLabel }} 品項，只能選「新增為品項」或「略過」。</p>
          }
        </div>
        <div class="cim-footer">
          <span class="cim-summary">
            對應 {{ countOf('map') }}、新增 {{ countOf('create') }}、略過 {{ countOf('skip') }}
            @if (!isValid) { <span class="cim-invalid">（尚有 {{ missingCount }} 項未選擇對應品項）</span> }
          </span>
          <button type="button" class="cim-btn cim-btn-secondary" (click)="cancel.emit()">取消上傳</button>
          <button type="button" class="cim-btn cim-btn-primary" [disabled]="!isValid" (click)="submit()">確認並匯入</button>
        </div>
      </div>
    </div>
    }
  `,
  styles: [
    `
      .cim-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1100;
      }
      .cim-dialog {
        background: #fff;
        border-radius: 8px;
        width: 94%;
        max-width: 900px;
        max-height: 90vh;
        display: flex;
        flex-direction: column;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
      }
      .cim-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 1rem 1.5rem;
        border-bottom: 1px solid #dee2e6;
        flex-shrink: 0;
      }
      .cim-header h3 {
        margin: 0;
        font-size: 1.15rem;
      }
      .cim-close {
        background: none;
        border: none;
        font-size: 1.5rem;
        line-height: 1;
        cursor: pointer;
        color: #6c757d;
      }
      .cim-body {
        padding: 1rem 1.5rem;
        overflow: auto;
        min-height: 0;
      }
      .cim-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem 1.5rem;
        font-size: 0.9rem;
        color: #495057;
        margin-bottom: 0.5rem;
      }
      .cim-meta strong {
        color: #6c757d;
        font-weight: 600;
        margin-right: 0.25rem;
      }
      .cim-file {
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .cim-hint {
        margin: 0 0 0.75rem;
        font-size: 0.9rem;
        line-height: 1.6;
        color: #495057;
        background: #fff8e1;
        border: 1px solid #ffe08a;
        border-radius: 4px;
        padding: 0.5rem 0.75rem;
      }
      .cim-table-wrap {
        overflow-x: auto;
        border: 1px solid #dee2e6;
        border-radius: 4px;
      }
      .cim-table {
        width: 100%;
        border-collapse: separate;
        border-spacing: 0;
        font-size: 0.92rem;
      }
      .cim-table th,
      .cim-table td {
        padding: 0.5rem 0.6rem;
        border-bottom: 1px solid #e9ecef;
        text-align: left;
        vertical-align: middle;
      }
      .cim-table th {
        background: #f8f9fa;
        font-weight: 600;
        white-space: nowrap;
      }
      .cim-table tr.is-skip td {
        color: #868e96;
      }
      .cim-item code {
        font-size: 1rem;
        font-weight: 600;
        background: #f1f3f5;
        padding: 0.1rem 0.4rem;
        border-radius: 3px;
      }
      .cim-count {
        white-space: nowrap;
        color: #6c757d;
      }
      .cim-table select {
        width: 100%;
        min-width: 150px;
        padding: 0.35rem 0.5rem;
        border: 1px solid #ced4da;
        border-radius: 4px;
        font-size: 0.92rem;
        background: #fff;
      }
      .cim-table select.is-empty {
        border-color: #e03131;
        background: #fff5f5;
      }
      .cim-suggest {
        font-size: 0.78rem;
        color: #0b7285;
        margin-top: 0.2rem;
      }
      .cim-note {
        font-size: 0.85rem;
        color: #495057;
      }
      .cim-note-skip {
        color: #868e96;
      }
      .cim-remember {
        text-align: center;
      }
      .cim-remember input {
        width: 1.1rem;
        height: 1.1rem;
        cursor: pointer;
      }
      .cim-dash {
        color: #adb5bd;
      }
      .cim-warn {
        margin: 0.75rem 0 0;
        font-size: 0.88rem;
        color: #c92a2a;
      }
      .cim-footer {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.75rem 1.5rem;
        border-top: 1px solid #dee2e6;
        flex-shrink: 0;
      }
      .cim-summary {
        flex: 1;
        font-size: 0.88rem;
        color: #495057;
      }
      .cim-invalid {
        color: #e03131;
      }
      .cim-btn {
        padding: 0.5rem 1.25rem;
        border-radius: 4px;
        font-size: 0.95rem;
        cursor: pointer;
        height: 38px;
      }
      .cim-btn-secondary {
        border: 1px solid #6c757d;
        background: #fff;
        color: #6c757d;
      }
      .cim-btn-primary {
        border: none;
        background: #007bff;
        color: #fff;
        font-weight: 500;
      }
      .cim-btn-primary:hover:not(:disabled) {
        background: #0056b3;
      }
      .cim-btn-primary:disabled {
        background: #6c757d;
        cursor: not-allowed;
      }
      @media (max-width: 640px) {
        .cim-dialog {
          width: 100%;
          max-height: 100vh;
          border-radius: 0;
        }
        .cim-footer {
          flex-wrap: wrap;
        }
        .cim-summary {
          flex-basis: 100%;
        }
      }
    `,
  ],
})
export class ConsumableItemMappingDialogComponent implements OnChanges {
  @Input() request: ConsumableItemMappingRequest | null = null;
  @Output() confirm = new EventEmitter<ConsumableItemMappings>();
  @Output() cancel = new EventEmitter<void>();

  rows: MappingRow[] = [];

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['request']) {
      this.rows = this.request ? this.buildRows(this.request) : [];
    }
  }

  private buildRows(req: ConsumableItemMappingRequest): MappingRow[] {
    return (req.unmatchedItems || []).map((u) => {
      const suggestion = this.suggestItem(u.item, req.inventoryItems);
      return {
        item: u.item,
        rowCount: u.rowCount,
        totalCount: u.totalCount,
        action: 'map',
        itemId: suggestion?.id ?? '',
        remember: true,
        suggested: !!suggestion,
      };
    });
  }

  /** 預選建議：寬鬆 key 互相包含（如 21S ↔ APS21S、BG-1.8U ↔ BG1.8）。多個候選則取最短名稱者；找不到不預選 */
  private suggestItem(
    alias: string,
    items: { id: string; name: string }[],
  ): { id: string; name: string } | null {
    const key = fuzzyKey(alias);
    if (key.length < 2) return null;
    const candidates = items.filter((it) => {
      const k = fuzzyKey(it.name);
      return k.length >= 2 && (k.includes(key) || key.includes(k));
    });
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => a.name.length - b.name.length);
    return candidates[0];
  }

  onActionChange(row: MappingRow): void {
    if (row.action !== 'map') row.suggested = false;
  }

  countOf(action: MappingRow['action']): number {
    return this.rows.filter((r) => r.action === action).length;
  }

  get missingCount(): number {
    return this.rows.filter((r) => r.action === 'map' && !r.itemId).length;
  }

  get isValid(): boolean {
    return this.rows.length > 0 && this.missingCount === 0;
  }

  submit(): void {
    if (!this.isValid) return;
    const mappings: ConsumableItemMappings = {};
    for (const row of this.rows) {
      if (row.action === 'map') mappings[row.item] = { action: 'map', itemId: row.itemId, remember: row.remember };
      else if (row.action === 'create') mappings[row.item] = { action: 'create' };
      else mappings[row.item] = { action: 'skip' };
    }
    this.confirm.emit(mappings);
  }

  onOverlayClick(event: MouseEvent): void {
    // 點遮罩不關閉：對照是有副作用的決定，避免誤觸；只用「取消上傳」或 × 關閉
    event.stopPropagation();
  }
}
