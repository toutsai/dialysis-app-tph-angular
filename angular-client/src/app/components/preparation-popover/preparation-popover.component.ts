import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';


@Component({
  selector: 'app-preparation-popover',
  standalone: true,
  imports: [],
  templateUrl: './preparation-popover.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './preparation-popover.component.css',
})
export class PreparationPopoverComponent {
  @Input() isVisible = false;
  @Input() patients: any[] = [];
  /** 保留以相容呼叫端的綁定；改為置中視窗後不再用於定位 */
  @Input() targetElement: any = null;
  @Output() closeEvent = new EventEmitter<void>();
  @Output() openOrderModal = new EventEmitter<any>();

  get hasPatients(): boolean {
    return this.patients && this.patients.length > 0;
  }

  handleNameClick(patient: any): void {
    this.openOrderModal.emit(patient);
  }

  close(): void {
    this.closeEvent.emit();
  }
}
