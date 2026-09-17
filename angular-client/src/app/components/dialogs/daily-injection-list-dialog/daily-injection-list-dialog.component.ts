import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '@app/core/services/api.service';
import { InjectionUncertainListDialogComponent } from '../injection-uncertain-list-dialog/injection-uncertain-list-dialog.component';

@Component({
  selector: 'app-daily-injection-list-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, InjectionUncertainListDialogComponent],
  templateUrl: './daily-injection-list-dialog.component.html',
  styleUrl: './daily-injection-list-dialog.component.css'
})
export class DailyInjectionListDialogComponent implements OnChanges {
  private readonly api = inject(ApiService);

  @Input() isVisible = false;
  @Input() injections: any[] = [];
  @Input() isLoading = false;
  @Input() targetDate = '';
  @Input() filterActive = false;
  @Input() showFilter = false;
  /** 本清單涵蓋的病人（本班/本組）；待審清單預設以此範圍查詢，可切「全部病人」 */
  @Input() patientIds: string[] | null = null;
  @Output() closeEvent = new EventEmitter<void>();
  @Output() filterActiveChange = new EventEmitter<boolean>();
  @Output() refreshEvent = new EventEmitter<void>();

  /**
   * 待審筆數（/review 的 counts.total：判不出星期幾 / 日期已用盡 / 星期與洗腎日不符 / 日期非洗腎日）；
   * null = 尚未查詢或查詢失敗。用 signal 保證 HTTP 回來後重繪
   */
  readonly uncertainCount = signal<number | null>(null);
  readonly isUncertainVisible = signal(false);

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.isVisible) return;
    if (changes['isVisible'] || changes['targetDate'] || changes['patientIds']) {
      void this.loadUncertainCount();
    }
  }

  async loadUncertainCount(): Promise<void> {
    try {
      const body: { targetDate?: string; patientIds?: string[] } = {};
      if (this.targetDate) body.targetDate = this.targetDate;
      if (this.patientIds && this.patientIds.length > 0) body.patientIds = this.patientIds;
      const res = await firstValueFrom(
        this.api.post<{ items?: unknown[]; counts?: { total?: number } }>('/medications/daily-injections/review', body),
      );
      const total = typeof res?.counts?.total === 'number' ? res.counts.total : Array.isArray(res?.items) ? res.items.length : 0;
      this.uncertainCount.set(total);
    } catch (e) {
      console.error('[DailyInjectionListDialog] 查詢待審筆數失敗:', e);
      this.uncertainCount.set(null);
    }
  }

  openUncertain(): void {
    this.isUncertainVisible.set(true);
  }

  onUncertainChanged(): void {
    // 使用者確認了規則 → 應打清單要重算（父層清快取重抓）
    void this.loadUncertainCount();
    this.refreshEvent.emit();
  }

  get titleDate(): string {
    if (!this.targetDate) return '';
    try {
      const date = new Date(this.targetDate + 'T00:00:00');
      return date.toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' });
    } catch {
      return this.targetDate;
    }
  }

  formatShift(shiftCode: string): string {
    const shiftMap: Record<string, string> = { early: '早', noon: '午', late: '晚' };
    return shiftMap[shiftCode] || '未知';
  }

  getMedicationUnit(injection: any): string {
    return injection.unit || '';
  }

  closeDialog(): void {
    this.closeEvent.emit();
  }

  onFilterChange(checked: boolean): void {
    this.filterActiveChange.emit(checked);
  }

  handlePrint(): void {
    const contentToPrint = document.getElementById('injection-list-content');
    if (!contentToPrint) {
      console.error('找不到列印內容區塊！');
      return;
    }

    const iframe = document.createElement('iframe');
    iframe.style.position = 'absolute';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.setAttribute('title', 'Print Frame');

    document.body.appendChild(iframe);
    const iframeDoc = iframe.contentWindow!.document;

    const htmlContent = `
      <html>
        <head>
          <title>本日應打針劑清單</title>
          <style>
            body { font-family: 'Microsoft JhengHei', 'Segoe UI', sans-serif; margin: 20px; font-size: 12pt; }
            .print-header { text-align: center; margin-bottom: 1.5rem; }
            .print-header h4 { font-size: 1.5rem; margin: 0; }
            .injection-table { width: 100%; border-collapse: collapse; font-size: 1em; }
            .injection-table th, .injection-table td { border: 1px solid #aaa; padding: 8px; text-align: center; vertical-align: middle; }
            .injection-table th { background-color: #f2f2f2; font-weight: bold; }
            tr { page-break-inside: avoid; }
          </style>
        </head>
        <body>
          ${contentToPrint.innerHTML}
        </body>
      </html>
    `;

    iframeDoc.open();
    iframeDoc.write(htmlContent);
    iframeDoc.close();

    iframe.onload = function() {
      try {
        iframe.contentWindow!.focus();
        iframe.contentWindow!.print();
      } catch (e) {
        console.error('列印失敗:', e);
      } finally {
        setTimeout(() => {
          document.body.removeChild(iframe);
        }, 500);
      }
    };
  }
}
