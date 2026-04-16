import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '@app/core/services/auth.service';
import { ApiManagerService, type ApiManager, type FirestoreRecord } from '@services/api-manager.service';
// Standalone 版：已移除 Firebase

@Component({
  selector: 'app-condition-record-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './condition-record-panel.component.html',
  styleUrl: './condition-record-panel.component.css'
})
export class ConditionRecordPanelComponent implements OnChanges {
  private readonly apiManagerService = inject(ApiManagerService);
  private readonly conditionRecordsApi: ApiManager<FirestoreRecord>;
  readonly auth = inject(AuthService);

  @Input() patientId = '';
  @Input() patientName = '';
  @Input() targetDate = '';
  @Input() isReadOnly = false;
  @Output() recordsChanged = new EventEmitter<void>();

  records = signal<any[]>([]);
  newContent = '';
  newRecordContent = '';
  editingRecordId: string | null = null;
  error: string | null = null;
  isLoading = signal(false);
  isSaving = signal(false);

  constructor() {
    this.conditionRecordsApi = this.apiManagerService.create<FirestoreRecord>('condition_records');
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['patientId'] || changes['targetDate']) {
      this.fetchRecords();
    }
  }

  async fetchRecords(): Promise<void> {
    if (!this.patientId) {
      this.records.set([]);
      return;
    }
    this.isLoading.set(true);
    try {
      const allRecords = await this.conditionRecordsApi.fetchAll();
      const filtered = (allRecords as any[]).filter(
        (r: any) => r.patientId === this.patientId
      ).sort((a: any, b: any) => {
        const aDate = typeof a.createdAt === 'string' ? a.createdAt : '';
        const bDate = typeof b.createdAt === 'string' ? b.createdAt : '';
        return bDate.localeCompare(aDate);
      }).slice(0, 20);
      this.records.set(filtered);
    } catch (err) {
      console.error('讀取病情紀錄失敗:', err);
      this.records.set([]);
    } finally {
      this.isLoading.set(false);
    }
  }

  async addRecord(): Promise<void> {
    const content = this.newContent.trim();
    if (!content || !this.patientId) return;

    const currentUser = this.auth.currentUser();
    if (!currentUser) return;

    this.isSaving.set(true);
    try {
      await this.conditionRecordsApi.create({
        patientId: this.patientId,
        patientName: this.patientName,
        content,
        authorName: currentUser.name,
        authorId: currentUser.uid,
        recordDate: this.targetDate || new Date().toISOString().split('T')[0],
        createdAt: new Date().toISOString(),
      } as any);
      this.newContent = '';
      await this.fetchRecords();
      this.recordsChanged.emit();
    } catch (err) {
      console.error('新增病情紀錄失敗:', err);
      alert('新增失敗，請稍後再試');
    } finally {
      this.isSaving.set(false);
    }
  }

  async deleteRecord(recordId: string): Promise<void> {
    if (!confirm('確定要刪除此紀錄？')) return;
    try {
      await this.conditionRecordsApi.delete(recordId);
      await this.fetchRecords();
      this.recordsChanged.emit();
    } catch (err) {
      console.error('刪除紀錄失敗:', err);
    }
  }

  get history(): any[] {
    return this.records();
  }

  handleSave(): void {
    if (this.editingRecordId) {
      // TODO: implement update
    } else {
      this.newContent = this.newRecordContent;
      this.addRecord();
    }
  }

  cancelEditing(): void {
    this.editingRecordId = null;
    this.newRecordContent = '';
  }

  startEditing(record: any): void {
    this.editingRecordId = record.id;
    this.newRecordContent = record.content;
  }

  handleDelete(recordId: string): void {
    this.deleteRecord(recordId);
  }

  formatTimestamp(ts: any): string {
    if (!ts) return '未知時間';
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    return date.toLocaleString('zh-TW', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  }
}
