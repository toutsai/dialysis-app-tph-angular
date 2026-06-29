import { Component, Input, Output, EventEmitter, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import ApiManager from '@/services/api_manager';
// Standalone 版：已移除 Firebase
import { escapeHtml } from '@/utils/sanitize';

@Component({
  selector: 'app-patient-history-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './patient-history-modal.component.html',
  styleUrl: './patient-history-modal.component.css'
})
export class PatientHistoryModalComponent implements OnInit, OnDestroy {
  @Input() isVisible = true;
  @Input() patientId = '';
  @Input() patientName = '';
  @Output() close = new EventEmitter<void>();

  private historyApi = ApiManager('patient_history');
  history: any[] = [];
  isLoading = false;

  private statusMap: Record<string, string> = {
    ipd: '住院',
    opd: '門診',
    er: '急診',
  };

  /**
   * 統一解析歷史時間戳。
   * - Firestore Timestamp（toDate）相容保留。
   * - 後端有兩種字串：ISO「…Z」(UTC) 與 legacy「YYYY-MM-DD HH:MM:SS」(空格、無 Z)。
   *   兩者實際都是 UTC，但 JS 對空格格式會誤判為本地時間 → 補成 UTC 再解析，否則早 8 小時。
   */
  private parseTimestamp(input: any): Date {
    if (input && typeof input.toDate === 'function') return input.toDate();
    if (typeof input === 'string') {
      let s = input.trim();
      if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s)) s = s.replace(' ', 'T') + 'Z';
      return new Date(s);
    }
    return new Date(input);
  }

  get groupedHistory(): any[][] {
    if (!this.history || this.history.length === 0) return [];

    const episodes: any[][] = [];
    let currentEpisode: any[] = [];

    const sortedHistory = [...this.history].sort(
      (a, b) => this.parseTimestamp(a.timestamp).getTime() - this.parseTimestamp(b.timestamp).getTime()
    );

    sortedHistory.forEach((entry: any) => {
      const isStartEvent = entry.eventType === 'CREATE'
        || entry.eventType === 'RESTORE_AND_TRANSFER'
        || entry.eventType === 'RESTORE';

      if (isStartEvent && currentEpisode.length > 0) {
        episodes.push(currentEpisode);
        currentEpisode = [];
      }

      currentEpisode.push(entry);

      if (entry.eventType === 'DELETE') {
        episodes.push(currentEpisode);
        currentEpisode = [];
      }
    });

    if (currentEpisode.length > 0) {
      episodes.push(currentEpisode);
    }

    return episodes.reverse();
  }

  ngOnInit(): void {
    document.body.classList.add('modal-open');
    if (this.patientId) {
      this.fetchHistory();
    }
  }

  ngOnDestroy(): void {
    document.body.classList.remove('modal-open');
  }

  async fetchHistory(): Promise<void> {
    this.isLoading = true;
    try {
      const allHistory = await this.historyApi.fetchAll();
      this.history = (allHistory as any[]).filter(
        (h: any) => h.patientId === this.patientId
      ).sort(
        (a: any, b: any) =>
          this.parseTimestamp(a.timestamp).getTime() - this.parseTimestamp(b.timestamp).getTime()
      );
    } catch (error) {
      console.error('讀取歷史紀錄失敗:', error);
      this.history = [];
    } finally {
      this.isLoading = false;
    }
  }

  formatTimestamp(timestampInput: any): string {
    if (!timestampInput) return '—';

    const date = this.parseTimestamp(timestampInput);
    if (isNaN(date.getTime())) {
      return '—';
    }

    return date.toLocaleString('zh-TW', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  formatEvent(entry: any): string {
    const details = entry.eventDetails || {};
    const getStatus = (s: string) => `<strong>${escapeHtml(this.statusMap[s] || s || '—')}</strong>`;
    const getMode = (m: string) => `<strong>${escapeHtml(m || '—')}</strong>`;

    switch (entry.eventType) {
      case 'CREATE':
        return `建立資料 ➝ ${getStatus(details.status)}`;
      case 'TRANSFER': {
        // key 形狀並存：legacy 用 from/to（含 note=衝突轉入），現行用 fromStatus/toStatus（含 reason）
        const from = details.fromStatus ?? details.from;
        const to = details.toStatus ?? details.to;
        if (details.note) {
          return `衝突轉入 ➝ ${getStatus(to)}`;
        }
        const base = `${getStatus(from)} ➝ ${getStatus(to)}`;
        return details.reason ? `${base}（${escapeHtml(details.reason)}）` : base;
      }
      case 'STATUS_CHANGE':
        return `${getStatus(details.fromStatus ?? details.from)} ➝ ${getStatus(details.toStatus ?? details.to)}`;
      case 'MODE_CHANGE':
        return `模式變更 ${getMode(details.fromMode)} ➝ ${getMode(details.toMode)}`;
      case 'DELETE':
        return `<strong>結案 (${escapeHtml(details.reason || '未說明')})</strong>`;
      case 'RESTORE_AND_TRANSFER':
      case 'RESTORE':
        return `資料復原 ➝ ${getStatus(details.restoredTo)}`;
      default:
        return `未知操作: ${escapeHtml(entry.eventType)}`;
    }
  }

  onClose(): void {
    this.close.emit();
  }
}
