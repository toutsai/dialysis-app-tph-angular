import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiManagerService, type ApiManager, type FirestoreRecord } from '@services/api-manager.service';
// Standalone 版：已移除 Firebase

@Component({
  selector: 'app-condition-record-display-dialog',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './condition-record-display-dialog.component.html',
  styleUrl: './condition-record-display-dialog.component.css'
})
export class ConditionRecordDisplayDialogComponent implements OnChanges {
  private readonly apiManagerService = inject(ApiManagerService);
  private readonly conditionRecordsApi: ApiManager<FirestoreRecord>;

  @Input() isVisible = false;
  @Input() patientId = '';
  @Input() patientName = '';
  @Input() targetDate = '';
  @Output() closeEvent = new EventEmitter<void>();

  records: any[] = [];
  isLoading = false;

  constructor() {
    this.conditionRecordsApi = this.apiManagerService.create<FirestoreRecord>('condition_records');
  }

  get dialogTitle(): string {
    return this.targetDate
      ? `${this.patientName} ${this.targetDate} 病情紀錄`
      : `${this.patientName} 病情紀錄`;
  }

  get emptyMessage(): string {
    return this.targetDate
      ? '此病人於此日期沒有病情紀錄。'
      : '此病人沒有病情紀錄。';
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isVisible'] && this.isVisible) {
      this.fetchRecords();
    }
    if ((changes['patientId'] || changes['targetDate']) && this.isVisible) {
      this.fetchRecords();
    }
  }

  async fetchRecords(): Promise<void> {
    if (!this.patientId) {
      this.records = [];
      return;
    }

    this.isLoading = true;
    try {
      const allRecords = await this.conditionRecordsApi.fetchAll();
      this.records = (allRecords as any[]).filter((r: any) => {
        if (r.patientId !== this.patientId) return false;
        if (this.targetDate) return r.recordDate === this.targetDate;
        return true;
      }).sort((a: any, b: any) => {
        const dateA = typeof a.createdAt === 'string' ? a.createdAt : '';
        const dateB = typeof b.createdAt === 'string' ? b.createdAt : '';
        return dateB.localeCompare(dateA);
      });
    } catch (err) {
      console.error('讀取病情紀錄失敗:', err);
      this.records = [];
    } finally {
      this.isLoading = false;
    }
  }

  formatTimestamp(ts: any): string {
    if (!ts) return '未知時間';
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    return date.toLocaleString('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  close(): void {
    this.closeEvent.emit();
  }
}

