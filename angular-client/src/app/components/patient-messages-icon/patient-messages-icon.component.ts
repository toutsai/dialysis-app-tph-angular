import { ChangeDetectionStrategy, Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-patient-messages-icon',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './patient-messages-icon.component.html',
  styleUrl: './patient-messages-icon.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PatientMessagesIconComponent {
  @Input() patientId = '';
  @Input() context = 'detail';
  @Input() typesMap: Map<string, string[]> | null = null;
  @Input() messageTypes: string[] = [];

  @Output() iconClick = new EventEmitter<{ patientId: string; context: string; type: string }>();

  getMessageTypeIcon(type: string): string {
    switch (type) {
      case '抽血': return '🩸';
      case '衛教': return '📢';
      case 'record': return '🩺';
      case 'memo':
      case '常規':
      default: return '📝';
    }
  }

  getTooltipText(type: string): string {
    switch (type) {
      case '抽血': return '有抽血提醒';
      case '衛教': return '有衛教事項';
      case 'record': return '有病情紀錄';
      case 'memo':
      case '常規':
      default: return '有交班事項';
    }
  }

  get computedMessageTypes(): string[] {
    if (!this.patientId) return [];
    const types = (this.typesMap && this.typesMap instanceof Map)
      ? this.typesMap.get(this.patientId) || []
      : this.messageTypes;
    // 調班留言不出圖示：改班資訊由排程格備註 (換班)/(臨時加洗)/(互調) 呈現即可
    return types.filter((type) => type !== '調班');
  }

  handleClick(type: string): void {
    if (this.patientId) {
      this.iconClick.emit({ patientId: this.patientId, context: this.context, type });
    }
  }
}
