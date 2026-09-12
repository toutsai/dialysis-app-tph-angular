import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-period-navigation',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="period-navigation" role="group" [attr.aria-label]="navigationLabel">
      <button type="button" [disabled]="disabled" (click)="previous.emit()" [attr.aria-label]="previousLabel || previousText">‹ {{ previousLabel || previousText }}</button>
      <div class="period-value">
        @if (label) { <strong aria-live="polite">{{ label }}</strong> }
        <ng-content></ng-content>
      </div>
      <button type="button" [disabled]="disabled" (click)="next.emit()" [attr.aria-label]="nextLabel || nextText">{{ nextLabel || nextText }} ›</button>
      @if (showCurrent) { <button type="button" class="current-period" [disabled]="disabled" (click)="current.emit()">{{ currentLabel || currentText }}</button> }
    </div>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .period-navigation { display: flex; align-items: center; flex-wrap: wrap; gap: .4rem; }
    button { min-height: 36px; padding: .4rem .65rem; border: 1px solid #cbd5e1; border-radius: 6px; background: white; color: #334155; cursor: pointer; font: inherit; white-space: nowrap; }
    button:hover:not(:disabled) { background: #f1f5f9; border-color: #64748b; }
    button:focus-visible { outline: 3px solid #0891b2; outline-offset: 2px; }
    button:disabled { cursor: wait; opacity: .55; }
    .period-value { display: flex; align-items: center; flex-wrap: wrap; gap: .45rem; min-width: 0; }
    strong { color: #0f172a; font-variant-numeric: tabular-nums; }
    .current-period { color: #036575; border-color: #69aab5; }
    @media (max-width: 600px) { button { min-height: 40px; } .period-value { flex-wrap: wrap; } }
  `],
})
export class PeriodNavigationComponent {
  @Input() period: 'day' | 'week' | 'month' | 'year' = 'day';
  @Input() label = '';
  @Input() navigationLabel = '切換資料期間';
  @Input() disabled = false;
  @Input() showCurrent = true;
  @Input() previousLabel = '';
  @Input() nextLabel = '';
  @Input() currentLabel = '';
  @Output() previous = new EventEmitter<void>();
  @Output() next = new EventEmitter<void>();
  @Output() current = new EventEmitter<void>();
  get previousText(): string { return { day: '前一天', week: '上一週', month: '上個月', year: '上一年' }[this.period]; }
  get nextText(): string { return { day: '後一天', week: '下一週', month: '下個月', year: '下一年' }[this.period]; }
  get currentText(): string { return { day: '今天', week: '本週', month: '本月', year: '本年' }[this.period]; }
}
