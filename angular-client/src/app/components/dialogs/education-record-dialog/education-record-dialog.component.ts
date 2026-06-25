import { Component, EventEmitter, Input, OnInit, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { localApi } from '@/services/localApiClient';

interface EducationSession {
  index: number;
  topic: string;
  educator: string;
  educatedDate: string;
  signature: string;
}

@Component({
  selector: 'app-education-record-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './education-record-dialog.component.html',
  styleUrl: './education-record-dialog.component.css',
})
export class EducationRecordDialogComponent implements OnInit {
  @Input() patientId = '';
  @Input() patientName = '';
  @Input() firstDialysisDate: string | null = null;
  /** 是否可編輯（viewer / 鎖定時傳 false） */
  @Input() canEdit = true;
  @Output() close = new EventEmitter<void>();

  readonly sessions = signal<EducationSession[]>([]);
  readonly topics = signal<string[]>([]);
  readonly isLoading = signal(false);
  readonly isSaving = signal(false);

  async ngOnInit(): Promise<void> {
    if (!this.patientId) return;
    this.isLoading.set(true);
    try {
      // 主題下拉選項（site_config: education_topics），尚未設定時為空，欄位仍可自由輸入
      this.loadTopics();
      const data: any = await localApi.get(`/patients/${this.patientId}/education`);
      if (data) {
        this.patientName = data.patientName || this.patientName;
        this.firstDialysisDate = data.firstDialysisDate ?? this.firstDialysisDate;
        this.sessions.set(this.normalize(data.sessions));
      } else {
        this.sessions.set(this.normalize([]));
      }
    } catch (error) {
      console.error('載入衛教紀錄失敗:', error);
      this.sessions.set(this.normalize([]));
    } finally {
      this.isLoading.set(false);
    }
  }

  private async loadTopics(): Promise<void> {
    try {
      const resp: any = await localApi.get('/system/config/education_topics');
      const list = resp?.configData?.topics;
      this.topics.set(Array.isArray(list) ? list : []);
    } catch {
      this.topics.set([]);
    }
  }

  private normalize(input: any): EducationSession[] {
    return Array.from({ length: 12 }, (_, i) => {
      const s = Array.isArray(input) ? input[i] : null;
      return {
        index: i + 1,
        topic: s?.topic || '',
        educator: s?.educator || '',
        educatedDate: s?.educatedDate || '',
        signature: s?.signature || '',
      };
    });
  }

  get completedCount(): number {
    return this.sessions().filter((s) => !!s.educatedDate).length;
  }

  async save(): Promise<void> {
    if (!this.canEdit || this.isSaving()) return;
    this.isSaving.set(true);
    try {
      await localApi.put(`/patients/${this.patientId}/education`, { sessions: this.sessions() });
      this.close.emit();
    } catch (error: any) {
      console.error('儲存衛教紀錄失敗:', error);
      alert(`儲存失敗：${error?.message || error}`);
    } finally {
      this.isSaving.set(false);
    }
  }

  onClose(): void {
    this.close.emit();
  }

  print(): void {
    const rows = this.sessions()
      .map(
        (s) => `<tr>
          <td style="text-align:center">${s.index}</td>
          <td>${this.esc(s.topic)}</td>
          <td>${this.esc(s.educator)}</td>
          <td>${this.esc(s.educatedDate)}</td>
          <td>${this.esc(s.signature)}</td>
        </tr>`,
      )
      .join('');

    const html = `<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8">
      <title>初透病人衛教紀錄</title>
      <style>
        body { font-family: "Microsoft JhengHei", sans-serif; padding: 24px; color: #000; }
        h2 { text-align: center; margin: 0 0 8px; }
        .meta { margin: 8px 0 16px; font-size: 14px; }
        .meta span { margin-right: 24px; }
        table { width: 100%; border-collapse: collapse; font-size: 14px; }
        th, td { border: 1px solid #000; padding: 8px 10px; }
        th { background: #f0f0f0; }
        td { height: 28px; }
      </style></head><body>
      <h2>初透病人衛教紀錄</h2>
      <div class="meta">
        <span>姓名：${this.esc(this.patientName)}</span>
        <span>首透日期：${this.esc(this.firstDialysisDate || '')}</span>
      </div>
      <table>
        <thead><tr>
          <th style="width:48px">次數</th><th>主題</th><th style="width:120px">衛教者</th>
          <th style="width:120px">衛教日期</th><th style="width:160px">被衛教者簽名</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      </body></html>`;

    const w = window.open('', '_blank');
    if (!w) {
      alert('無法開啟列印視窗，請檢查瀏覽器是否封鎖彈出視窗。');
      return;
    }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  }

  private esc(v: string): string {
    return String(v || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] || c));
  }
}
