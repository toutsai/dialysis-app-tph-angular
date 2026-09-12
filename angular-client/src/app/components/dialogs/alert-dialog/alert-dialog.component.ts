import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { ModalFocusDirective } from '../../../core/directives/modal-focus.directive';


@Component({
  selector: 'app-alert-dialog',
  standalone: true,
  imports: [ModalFocusDirective],
  templateUrl: './alert-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './alert-dialog.component.css'
})
export class AlertDialogComponent {
  @Input() isVisible = false;
  @Input() title = '';
  @Input() message = '';
  @Output() confirm = new EventEmitter<void>();

  handleConfirm(): void {
    this.confirm.emit();
  }
}
