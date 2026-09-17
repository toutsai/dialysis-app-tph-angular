import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiConfigService } from '@services/api-config.service';
import {
  REVIEW_LABEL,
  RULE_KIND_LABEL,
  changePillClass,
  changeTypeLabel,
  formatFieldChange,
  formatUploadedAt,
  orderTypeLabel,
  type InjectionBatchChange,
  type InjectionFieldChange,
  type InjectionUploadBatch,
  type InjectionUploadSummary,
} from './injection-shared';

type OrderTypeFilter = 'all' | 'injection' | 'oral';

/**
 * 上傳異動紀錄：左側批次清單（GET /medications/injection-upload-batches），
 * 選取後右側載入該批次異動（GET /medications/injection-upload-batches/:id/changes）。
 * 針劑/口服與文字篩選皆在前端做（單批次資料量小）。
 */
@Component({
  selector: 'app-upload-changes-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './upload-changes-panel.component.html',
  styleUrl: './upload-changes-panel.component.css',
})
export class UploadChangesPanelComponent implements OnInit {
  private readonly apiConfig = inject(ApiConfigService);

  readonly batches = signal<InjectionUploadBatch[]>([]);
  readonly isLoadingBatches = signal(false);
  readonly batchesError = signal('');
  readonly batchesLoaded = signal(false);

  readonly selectedBatchId = signal<string | null>(null);
  readonly changes = signal<InjectionBatchChange[]>([]);
  readonly isLoadingChanges = signal(false);
  readonly changesError = signal('');

  readonly typeFilter = signal<OrderTypeFilter>('all');
  readonly textFilter = signal('');

  readonly selectedBatch = computed<InjectionUploadBatch | null>(() => {
    const id = this.selectedBatchId();
    return id ? (this.batches().find((b) => b.id === id) ?? null) : null;
  });

  readonly filteredChanges = computed<InjectionBatchChange[]>(() => {
    const type = this.typeFilter();
    const term = this.textFilter().trim().toLowerCase();
    return this.changes().filter((c) => {
      if (type !== 'all' && c.orderType !== type) return false;
      if (!term) return true;
      return (
        (c.patientName || '').toLowerCase().includes(term) ||
        (c.medicalRecordNumber || '').toLowerCase().includes(term) ||
        (c.orderName || '').toLowerCase().includes(term) ||
        (c.orderCode || '').toLowerCase().includes(term)
      );
    });
  });

  ngOnInit(): void {
    void this.loadBatches();
  }

  async loadBatches(): Promise<void> {
    this.isLoadingBatches.set(true);
    this.batchesError.set('');
    try {
      const res = await fetch(`${this.apiConfig.apiBaseUrl}/medications/injection-upload-batches?limit=50`, {
        headers: this.apiConfig.getHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as unknown;
      const list = Array.isArray(body) ? (body as InjectionUploadBatch[]) : [];
      this.batches.set(list);
      this.batchesLoaded.set(true);
      // 保留原選取；沒有或已不存在 → 自動選第一筆（最新）
      const current = this.selectedBatchId();
      if (list.length && (!current || !list.some((b) => b.id === current))) {
        void this.selectBatch(list[0]);
      } else if (!list.length) {
        this.selectedBatchId.set(null);
        this.changes.set([]);
      }
    } catch (error) {
      console.error('載入上傳批次失敗:', error);
      this.batchesError.set('載入上傳批次失敗，請稍後再試。');
      this.batches.set([]);
    } finally {
      this.isLoadingBatches.set(false);
    }
  }

  async selectBatch(batch: InjectionUploadBatch): Promise<void> {
    if (this.selectedBatchId() === batch.id && this.changes().length) return;
    this.selectedBatchId.set(batch.id);
    this.changes.set([]);
    this.changesError.set('');
    this.isLoadingChanges.set(true);
    try {
      const res = await fetch(
        `${this.apiConfig.apiBaseUrl}/medications/injection-upload-batches/${encodeURIComponent(batch.id)}/changes`,
        { headers: this.apiConfig.getHeaders() },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as unknown;
      // 使用者在載入期間切換了批次 → 丟棄舊回應
      if (this.selectedBatchId() !== batch.id) return;
      this.changes.set(Array.isArray(body) ? (body as InjectionBatchChange[]) : []);
    } catch (error) {
      console.error('載入批次異動失敗:', error);
      if (this.selectedBatchId() === batch.id) this.changesError.set('載入批次異動失敗，請稍後再試。');
    } finally {
      if (this.selectedBatchId() === batch.id) this.isLoadingChanges.set(false);
    }
  }

  // ---------- 顯示輔助 ----------
  formatUploadedAt(value: string): string {
    return formatUploadedAt(value);
  }

  changeTypeLabel(type: string): string {
    return changeTypeLabel(type);
  }

  changePillClass(type: string): string {
    return changePillClass(type);
  }

  orderTypeLabel(type: string): string {
    return orderTypeLabel(type);
  }

  formatFieldChange(change: InjectionFieldChange): string {
    return formatFieldChange(change);
  }

  /** 解讀統計一行：每週 3 · 隔週 1 · 指定日期 2 · hold 0 · 判不出 1 */
  interpretationText(summary: InjectionUploadSummary | undefined): string {
    const i = summary?.interpretation;
    if (!i) return '-';
    return (['weekly', 'interval', 'dates', 'hold', 'uncertain'] as const)
      .map((k) => `${RULE_KIND_LABEL[k]} ${i[k] ?? 0}`)
      .join(' · ');
  }

  /** 需複核統計一行（只列非 0 項） */
  reviewText(summary: InjectionUploadSummary | undefined): string {
    const r = summary?.review;
    if (!r || !r.total) return '';
    const parts = (['uncertain', 'dates_exhausted', 'weekday_mismatch', 'date_not_dialysis_day'] as const)
      .filter((k) => (r[k] ?? 0) > 0)
      .map((k) => `${REVIEW_LABEL[k]} ${r[k]}`);
    return `需複核 ${r.total}${parts.length ? `（${parts.join('、')}）` : ''}`;
  }

  trackBatch(_: number, batch: InjectionUploadBatch): string {
    return batch.id;
  }

  trackChange(_: number, change: InjectionBatchChange): string {
    return change.id;
  }
}
