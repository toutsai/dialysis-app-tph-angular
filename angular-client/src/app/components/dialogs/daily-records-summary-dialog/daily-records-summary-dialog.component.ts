import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiManagerService, type ApiManager, type FirestoreRecord } from '@services/api-manager.service';
// Standalone 版：已移除 Firebase

@Component({
  selector: 'app-daily-records-summary-dialog',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './daily-records-summary-dialog.component.html',
  styleUrl: './daily-records-summary-dialog.component.css'
})
export class DailyRecordsSummaryDialogComponent implements OnChanges {
  private readonly apiManagerService = inject(ApiManagerService);
  private readonly conditionRecordsApi: ApiManager<FirestoreRecord>;

  @Input() isVisible = false;
  @Input() targetDate = '';
  @Input() shiftCode: string | null = null;
  @Input() patientIds: string[] = [];
  @Input() patientInfoMap: Record<string, any> = {};
  @Output() closeEvent = new EventEmitter<void>();

  isLoading = signal(false);
  allRecords = signal<any[]>([]);

  constructor() {
    this.conditionRecordsApi = this.apiManagerService.create<FirestoreRecord>('condition_records');
  }

  get formattedDate(): string {
    if (!this.targetDate) return '';
    try {
      const date = new Date(this.targetDate + 'T00:00:00');
      return date.toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' });
    } catch {
      return this.targetDate;
    }
  }

  get dialogTitle(): string {
    if (this.shiftCode) {
      return `${this.getShiftDisplayName(this.shiftCode)} 病情紀錄摘要 - ${this.formattedDate}`;
    }
    return `本日病情紀錄摘要 - ${this.formattedDate}`;
  }

  sortedRecords = computed(() => {
    const records = this.allRecords();
    if (!records || records.length === 0) return [];
    return [...records].sort((a, b) => {
      const infoA = this.getPatientInfo(a.patientId);
      const infoB = this.getPatientInfo(b.patientId);
      const bedA = infoA.bedNum || '';
      const bedB = infoB.bedNum || '';
      const isPeripheralA = bedA.startsWith('外');
      const isPeripheralB = bedB.startsWith('外');
      if (isPeripheralA !== isPeripheralB) return isPeripheralA ? 1 : -1;
      const numA = parseInt(bedA.replace('外', ''), 10) || 0;
      const numB = parseInt(bedB.replace('外', ''), 10) || 0;
      if (numA !== numB) return numA - numB;
      const timeA = typeof a.createdAt === 'string' ? new Date(a.createdAt).getTime() : 0;
      const timeB = typeof b.createdAt === 'string' ? new Date(b.createdAt).getTime() : 0;
      return timeA - timeB;
    });
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isVisible'] && this.isVisible) {
      this.fetchRecords(this.targetDate, this.patientIds);
    }
  }

  getShiftDisplayName(shiftCode: string): string {
    const map: Record<string, string> = { early: '早班', noon: '午班', late: '晚班' };
    return map[shiftCode] || '未知班別';
  }

  formatTime(timestamp: any): string {
    if (!timestamp) return 'N/A';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
  }

  getPatientInfo(patientId: string): any {
    return this.patientInfoMap[patientId] || { bedNum: '-', medicalRecordNumber: '' };
  }

  async copyMedicalRecordNumber(mrn: string): Promise<void> {
    if (!mrn) return;
    try {
      await navigator.clipboard.writeText(mrn);
    } catch (err) {
      console.error('複製失敗:', err);
    }
  }

  async fetchRecords(date: string, patientIdList: string[]): Promise<void> {
    this.isLoading.set(true);
    this.allRecords.set([]);
    if (!date || !patientIdList || patientIdList.length === 0) {
      this.isLoading.set(false);
      return;
    }
    try {
      const patientIdSet = new Set(patientIdList);
      const allRecords = await this.conditionRecordsApi.fetchAll();
      const filtered = (allRecords as any[]).filter(
        (r: any) => r.recordDate === date && patientIdSet.has(r.patientId)
      );
      filtered.sort((a: any, b: any) => {
        const timeA = typeof a.createdAt === 'string' ? new Date(a.createdAt).getTime() : 0;
        const timeB = typeof b.createdAt === 'string' ? new Date(b.createdAt).getTime() : 0;
        return timeA - timeB;
      });
      this.allRecords.set(filtered);
    } catch (error) {
      console.error(`讀取 ${date} 的病情紀錄失敗:`, error);
    } finally {
      this.isLoading.set(false);
    }
  }

  closeDialog(): void {
    this.closeEvent.emit();
  }
}

