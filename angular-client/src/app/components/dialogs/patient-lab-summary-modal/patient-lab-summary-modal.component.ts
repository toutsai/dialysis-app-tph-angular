import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';

import { PatientLabSummaryPanelComponent } from '../../patient-lab-summary-panel/patient-lab-summary-panel.component';

@Component({
  selector: 'app-patient-lab-summary-modal',
  standalone: true,
  imports: [PatientLabSummaryPanelComponent],
  templateUrl: './patient-lab-summary-modal.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './patient-lab-summary-modal.component.css'
})
export class PatientLabSummaryModalComponent {
  @Input() isVisible = false;
  @Input() patient: any = null;
  @Output() closeEvent = new EventEmitter<void>();
  @Output() saveRecordEvent = new EventEmitter<any>();

  handleClose(): void {
    this.closeEvent.emit();
  }

  handleSaveRecord(payload: any): void {
    this.saveRecordEvent.emit(payload);
    this.handleClose();
  }
}
