import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-operation-status',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (message) {
      <div class="operation-status" [class.error]="state === 'error' || state === 'conflict'" [class.saved]="state === 'saved'"
        [attr.role]="state === 'error' || state === 'conflict' ? 'alert' : 'status'" aria-atomic="true">
        <span>{{ message }}</span>
        @if (retryLabel) { <button type="button" [disabled]="busy" (click)="retry.emit()">{{ retryLabel }}</button> }
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .operation-status { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: .6rem; padding: .65rem .8rem; border: 1px solid #94a3b8; border-radius: 6px; color: #334155; background: #f8fafc; margin: .5rem 0; }
    .error { color: #991b1b; border-color: #fca5a5; background: #fff5f5; }
    .saved { color: #166534; border-color: #86c99d; background: #f0fdf4; }
    button { background: white; border: 1px solid currentColor; border-radius: 5px; padding: .4rem .75rem; min-height: 36px; color: inherit; font: inherit; cursor: pointer; }
    button:disabled { cursor: wait; opacity: .6; }
    button:focus-visible { outline: 3px solid #0891b2; outline-offset: 2px; }
  `],
})
export class OperationStatusComponent {
  @Input() message = '';
  @Input() state: 'idle' | 'loading' | 'dirty' | 'saved' | 'error' | 'conflict' = 'idle';
  @Input() busy = false;
  @Input() retryLabel = '';
  @Output() retry = new EventEmitter<void>();
}
