import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

export interface SelectionOption {
  value: string;
  text: string;
}

@Component({
  selector: 'app-selection-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './selection-dialog.component.html',
  styleUrl: './selection-dialog.component.css'
})
export class SelectionDialogComponent implements OnChanges {
  @Input() isVisible = true;
  @Input() title = '';
  @Input() options: SelectionOption[] = [];
  /** 選填的日期欄位：設定 dateFieldLabel 即顯示，值由父層透過 template ref 讀取 dateValue */
  @Input() dateFieldLabel = '';
  dateValue = new Date().toLocaleDateString('sv-SE');
  @Output() select = new EventEmitter<string>();
  @Output() cancel = new EventEmitter<void>();

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isVisible']) {
      if (typeof document !== 'undefined') {
        if (this.isVisible) {
          document.body.classList.add('modal-open');
        } else {
          document.body.classList.remove('modal-open');
        }
      }
    }
  }

  handleSelect(selectedValue: string): void {
    this.select.emit(selectedValue);
  }

  handleCancel(): void {
    this.cancel.emit();
  }

  onOverlayClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('selection-dialog-overlay')) {
      this.handleCancel();
    }
  }
}
