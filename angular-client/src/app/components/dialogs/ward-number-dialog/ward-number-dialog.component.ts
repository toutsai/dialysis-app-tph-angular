import { Component, Input, Output, EventEmitter, OnInit, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type { EffectiveShiftScope } from '@/utils/shiftTime';

/** 病房號設定結果：value=病房號（trim 後，空字串=移除）；scope=當日生效範圍（未問時固定 current） */
export interface WardNumberConfirmEvent {
  value: string;
  scope: EffectiveShiftScope;
}

@Component({
  selector: 'app-ward-number-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ward-number-dialog.component.html',
  styleUrl: './ward-number-dialog.component.css'
})
export class WardNumberDialogComponent implements OnInit, AfterViewChecked {
  @Input() title = '';
  @Input() message = '';
  @Input() currentValue = '';
  @Input() placeholder = '例如：5B12';
  @Input() maxLength = 20;
  /**
   * 當日異動守門（2026-09-15）：病人今天在「進行中的本班」有排程格時為 true，
   * 視窗內多一組「本班一起改／本班維持到下班」選項（與身分/模式變更同一套語意）。
   */
  @Input() askShiftScope = false;
  /** 進行中班別的顯示名稱（早班/午班/晚班），askShiftScope 為 true 時使用 */
  @Input() shiftName = '';
  /** 舊介面：只回傳輸入值（血管通路退回原因等非病房號用途沿用） */
  @Output() confirm = new EventEmitter<string>();
  /** 病房號用途：回傳輸入值 + 生效範圍 */
  @Output() confirmScope = new EventEmitter<WardNumberConfirmEvent>();
  @Output() cancel = new EventEmitter<void>();

  @ViewChild('inputRef') inputRef!: ElementRef<HTMLInputElement>;

  localValue = '';
  scope: EffectiveShiftScope = 'current';
  private shouldFocus = false;

  ngOnInit(): void {
    document.body.classList.add('modal-open');
    this.localValue = this.currentValue || '';
    this.shouldFocus = true;
  }

  ngAfterViewChecked(): void {
    if (this.shouldFocus && this.inputRef) {
      this.inputRef.nativeElement.focus();
      this.inputRef.nativeElement.select();
      this.shouldFocus = false;
    }
  }

  onConfirm(): void {
    document.body.classList.remove('modal-open');
    const value = this.localValue.trim();
    this.confirm.emit(value);
    this.confirmScope.emit({ value, scope: this.askShiftScope ? this.scope : 'current' });
  }

  onCancel(): void {
    document.body.classList.remove('modal-open');
    this.cancel.emit();
  }
}
