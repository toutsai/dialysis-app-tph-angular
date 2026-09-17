import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '@app/core/services/api.service';
import { AuthService } from '@app/core/services/auth.service';

/**
 * 針劑待審清單：後端 /medications/daily-injections/review 回傳四類需人工確認的針劑處方：
 *   - uncertain            判不出星期幾（頻率服法與備註都看不出）
 *   - dates_exhausted      日期已用盡（HIS 沒填停止日，備註列的日期都過了）
 *   - weekday_mismatch     星期與洗腎日不符（規則星期與總表洗腎日不同）
 *   - date_not_dialysis_day 日期非洗腎日（備註指定日期落在非洗腎日）
 * 使用者可逐筆輸入規則（W4 / QW135 / Q2W4 / 0923.0930 / hold）確認後存 injection_rule_overrides，
 * 當日應打清單即依此計算；已確認但仍有警告者可「取消確認」刪除 override。
 *
 * 狀態一律用 signal：此元件會巢狀在 daily-injection-list-dialog 內，
 * 曾出現 HTTP 回來後畫面停在「載入中」不重繪（2026-09-17 無頭驗證抓到），signal 寫入可保證排程重繪。
 */
export type ReviewCategory = 'uncertain' | 'dates_exhausted' | 'weekday_mismatch' | 'date_not_dialysis_day';
export type ReviewFilter = 'all' | ReviewCategory;

export interface ReviewWarning {
  code: string;
  message: string;
}

export interface ReviewInjection {
  id: string;
  patientId: string;
  patientName: string;
  medicalRecordNumber?: string;
  orderCode: string;
  orderName: string;
  dose: string;
  unit: string;
  frequency: string;
  note: string;
  startDate: string;
  endDate: string;
  prescriber: string;
  ruleKind: 'hold' | 'dates' | 'weekly' | 'interval' | 'uncertain';
  ruleSource: 'override' | 'note' | 'frequency' | null;
  effectiveRule: string;
  overrideId: string | null;
  overrideKey: string;
  reason: string;
  category: ReviewCategory;
  categoryLabel: string;
  warnings: ReviewWarning[];
  dialysisDays: number[] | null;
  masterFreq: string;
}

export interface ReviewCounts {
  uncertain: number;
  dates_exhausted: number;
  weekday_mismatch: number;
  date_not_dialysis_day: number;
  total: number;
}

export interface ReviewResponse {
  targetDate: string;
  items: ReviewInjection[];
  counts: ReviewCounts;
  latestBatch: unknown;
}

interface ReviewRow extends ReviewInjection {
  ruleInput: string;
  saving: boolean;
  error: string;
  /** 類別說明：後端 reason，或 warnings 的訊息合併 */
  detail: string;
  /** 規則輸入框的建議文字（依類別/洗腎日產生） */
  placeholder: string;
}

interface CategoryChip {
  key: ReviewFilter;
  label: string;
  count: number;
}

const EMPTY_COUNTS: ReviewCounts = {
  uncertain: 0,
  dates_exhausted: 0,
  weekday_mismatch: 0,
  date_not_dialysis_day: 0,
  total: 0,
};

const CATEGORY_LABELS: Record<ReviewCategory, string> = {
  uncertain: '判不出星期幾',
  dates_exhausted: '日期已用盡',
  weekday_mismatch: '星期與洗腎日不符',
  date_not_dialysis_day: '日期非洗腎日',
};

const CATEGORY_ORDER: ReviewCategory[] = ['uncertain', 'dates_exhausted', 'weekday_mismatch', 'date_not_dialysis_day'];

@Component({
  selector: 'app-injection-uncertain-list-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './injection-uncertain-list-dialog.component.html',
  styleUrl: './injection-uncertain-list-dialog.component.css',
})
export class InjectionUncertainListDialogComponent implements OnChanges {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);

  @Input() isVisible = false;
  @Input() targetDate = '';
  /** 限定病人範圍（本班/本組）；null 或空 = 全部病人 */
  @Input() patientIds: string[] | null = null;
  @Output() closeEvent = new EventEmitter<void>();
  /** 有任何一筆確認/取消確認成功 → 父層應清快取並重算應打清單 */
  @Output() changed = new EventEmitter<void>();

  readonly rows = signal<ReviewRow[]>([]);
  readonly counts = signal<ReviewCounts>(EMPTY_COUNTS);
  readonly filter = signal<ReviewFilter>('all');
  readonly loading = signal(false);
  readonly errorMsg = signal('');
  /** 勾選後忽略 patientIds，改列全院 */
  readonly showAll = signal(false);
  private dirty = false;

  /** 類別篩選 chips（全部 + 四類，筆數 0 的類別不顯示） */
  readonly chips = computed<CategoryChip[]>(() => {
    const c = this.counts();
    const list: CategoryChip[] = [{ key: 'all', label: '全部', count: c.total }];
    for (const key of CATEGORY_ORDER) {
      if (c[key] > 0) list.push({ key, label: CATEGORY_LABELS[key], count: c[key] });
    }
    return list;
  });

  readonly filteredRows = computed<ReviewRow[]>(() => {
    const f = this.filter();
    const all = this.rows();
    return f === 'all' ? all : all.filter((r) => r.category === f);
  });

  get canConfirm(): boolean {
    return this.auth.isEditor();
  }

  get hasScope(): boolean {
    return !!(this.patientIds && this.patientIds.length > 0);
  }

  get scopeLabel(): string {
    return this.hasScope && !this.showAll() ? '本班病人' : '全部病人';
  }

  get titleDate(): string {
    if (!this.targetDate) return '';
    try {
      return new Date(this.targetDate + 'T00:00:00').toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' });
    } catch {
      return this.targetDate;
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isVisible'] && this.isVisible) {
      this.dirty = false;
      this.filter.set('all');
      this.showAll.set(!this.hasScope);
      void this.load();
    }
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.errorMsg.set('');
    try {
      const body: { targetDate?: string; patientIds?: string[] } = {};
      if (this.targetDate) body.targetDate = this.targetDate;
      if (!this.showAll() && this.hasScope) body.patientIds = this.patientIds as string[];
      const res = await firstValueFrom(this.api.post<ReviewResponse>('/medications/daily-injections/review', body));
      const items = Array.isArray(res?.items) ? res.items : [];
      this.rows.set(items.map((r) => this.toRow(r)));
      this.counts.set(this.normalizeCounts(res?.counts, items));
      // 篩選中的類別已清空 → 退回全部
      const f = this.filter();
      if (f !== 'all' && !items.some((r) => r.category === f)) this.filter.set('all');
    } catch (e) {
      console.error('[InjectionReview] 載入失敗:', e);
      this.errorMsg.set('載入待審清單失敗');
      this.rows.set([]);
      this.counts.set(EMPTY_COUNTS);
    } finally {
      this.loading.set(false);
    }
  }

  private normalizeCounts(counts: Partial<ReviewCounts> | undefined, items: ReviewInjection[]): ReviewCounts {
    if (counts && typeof counts.total === 'number') {
      return {
        uncertain: counts.uncertain ?? 0,
        dates_exhausted: counts.dates_exhausted ?? 0,
        weekday_mismatch: counts.weekday_mismatch ?? 0,
        date_not_dialysis_day: counts.date_not_dialysis_day ?? 0,
        total: counts.total,
      };
    }
    const out: ReviewCounts = { ...EMPTY_COUNTS, total: items.length };
    for (const it of items) {
      if (it.category in out) out[it.category] += 1;
    }
    return out;
  }

  private toRow(r: ReviewInjection): ReviewRow {
    const warnings = Array.isArray(r.warnings) ? r.warnings : [];
    const warningText = warnings.map((w) => w?.message).filter((m): m is string => !!m).join('；');
    return {
      ...r,
      warnings,
      categoryLabel: r.categoryLabel || CATEGORY_LABELS[r.category] || r.category,
      ruleInput: '',
      saving: false,
      error: '',
      detail: r.reason || warningText,
      placeholder: this.suggestRule(r),
    };
  }

  /** 依類別與總表洗腎日產生輸入框建議（僅提示，不預填） */
  private suggestRule(r: ReviewInjection): string {
    const days = (r.dialysisDays ?? []).filter((d) => Number.isInteger(d) && d >= 1 && d <= 6);
    const dayRule = days.length === 0 ? '' : days.length === 1 ? `W${days[0]}` : `QW${days.join('')}`;
    switch (r.category) {
      case 'weekday_mismatch':
        return dayRule ? `例：${dayRule}` : '例：QW135';
      case 'date_not_dialysis_day':
        return dayRule ? `例：${dayRule} 或 1001.1008` : '例：1001.1008';
      case 'dates_exhausted':
        return '例：hold 或 1001.1008';
      default:
        return dayRule ? `例：${dayRule}` : '例：W4';
    }
  }

  toggleShowAll(checked: boolean): void {
    this.showAll.set(checked);
    void this.load();
  }

  setFilter(key: ReviewFilter): void {
    this.filter.set(key);
  }

  private patchRow(row: ReviewRow, patch: Partial<ReviewRow>): void {
    this.rows.update((list) => list.map((r) => (r.overrideKey === row.overrideKey ? { ...r, ...patch } : r)));
  }

  private errorMessage(e: unknown, fallback: string): string {
    const err = e as { error?: { message?: string }; message?: string };
    return err?.error?.message || err?.message || fallback;
  }

  async confirmRow(row: ReviewRow): Promise<void> {
    const rule = row.ruleInput.trim();
    if (!rule) {
      this.patchRow(row, { error: '請輸入規則' });
      return;
    }
    this.patchRow(row, { saving: true, error: '' });
    try {
      await firstValueFrom(
        this.api.put('/medications/injection-rule-overrides', {
          patientId: row.patientId,
          orderCode: row.orderCode,
          startDate: row.startDate,
          dose: row.dose,
          frequency: row.frequency,
          rule,
        }),
      );
      this.dirty = true;
      // 確認後的規則仍可能有警告（例如星期與洗腎日不符）→ 重新載入讓後端重判
      await this.load();
    } catch (e: unknown) {
      this.patchRow(row, { saving: false, error: this.errorMessage(e, '儲存失敗') });
    }
  }

  async removeOverride(row: ReviewRow): Promise<void> {
    if (!row.overrideId) return;
    this.patchRow(row, { saving: true, error: '' });
    try {
      await firstValueFrom(this.api.delete<{ success: boolean }>(`/medications/injection-rule-overrides/${row.overrideId}`));
      this.dirty = true;
      await this.load();
    } catch (e: unknown) {
      this.patchRow(row, { saving: false, error: this.errorMessage(e, '取消確認失敗') });
    }
  }

  closeDialog(): void {
    if (this.dirty) this.changed.emit();
    this.closeEvent.emit();
  }
}
