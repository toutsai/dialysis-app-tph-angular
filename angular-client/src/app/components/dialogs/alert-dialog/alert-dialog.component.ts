import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';


@Component({
  selector: 'app-alert-dialog',
  standalone: true,
  imports: [],
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
