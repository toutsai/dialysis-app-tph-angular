import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';


@Component({
  selector: 'app-patient-action-modal',
  standalone: true,
  imports: [],
  templateUrl: './patient-action-modal.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './patient-action-modal.component.css'
})
export class PatientActionModalComponent {
  @Input() isVisible = false;
  @Input() patient: any = null;
  @Input() hasMemo = false;
  @Output() selectEvent = new EventEmitter<string>();
  @Output() closeEvent = new EventEmitter<void>();

  closeModal(): void {
    this.closeEvent.emit();
  }

  emitAction(actionType: string): void {
    this.selectEvent.emit(actionType);
  }
}
