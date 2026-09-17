import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '@app/core/services/api.service';
import { AuthService } from '@app/core/services/auth.service';

/**
 * 針劑疑慮清單：targetDate 仍有效、但 HIS 備註與頻率服法欄都判不出星期幾的針劑處方。
 * 系統不自行判定施打頻率；使用者在此逐筆輸入規則（W4 / QW135 / Q2W4 / 0923.0930 / hold）
 * 確認後存 injection_rule_overrides，當日應打清單即依此計算。
 *
 * 狀態一律用 signal：此元件會巢狀在 daily-injection-list-dialog 內，
 * 曾出現 HTTP 回來後畫面停在「載入中」不重繪（2026-09-17 無頭驗證抓到），signal 寫入可保證排程重繪。
 */
export interface UncertainInjection {
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
  reason: string;
  overrideKey: string;
}

interface UncertainRow extends UncertainInjection {
  ruleInput: string;
  saving: boolean;
  error: string;
}

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
  /** 有任何一筆確認成功 → 父層應清快取並重算應打清單 */
  @Output() changed = new EventEmitter<void>();

  readonly rows = signal<UncertainRow[]>([]);
  readonly loading = signal(false);
  readonly errorMsg = signal('');
  /** 勾選後忽略 patientIds，改列全院 */
  readonly showAll = signal(false);
  private dirty = false;

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
      const list = await firstValueFrom(
        this.api.post<UncertainInjection[]>('/medications/daily-injections/uncertain', body),
      );
      this.rows.set((Array.isArray(list) ? list : []).map((r) => ({ ...r, ruleInput: '', saving: false, error: '' })));
    } catch (e) {
      console.error('[UncertainInjections] 載入失敗:', e);
      this.errorMsg.set('載入疑慮清單失敗');
      this.rows.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  toggleShowAll(checked: boolean): void {
    this.showAll.set(checked);
    void this.load();
  }

  private patchRow(row: UncertainRow, patch: Partial<UncertainRow>): void {
    this.rows.update((list) => list.map((r) => (r === row ? { ...r, ...patch } : r)));
  }

  async confirmRow(row: UncertainRow): Promise<void> {
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
      this.rows.update((list) => list.filter((r) => r.overrideKey !== row.overrideKey));
    } catch (e: unknown) {
      const err = e as { error?: { message?: string }; message?: string };
      this.rows.update((list) =>
        list.map((r) =>
          r.overrideKey === row.overrideKey
            ? { ...r, saving: false, error: err?.error?.message || err?.message || '儲存失敗' }
            : r,
        ),
      );
    }
  }

  closeDialog(): void {
    if (this.dirty) this.changed.emit();
    this.closeEvent.emit();
  }
}
