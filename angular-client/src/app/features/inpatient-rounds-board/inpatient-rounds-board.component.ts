import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { ApiConfigService } from '@services/api-config.service';

interface RoundsPatient {
  id: string;
  dialysisBed: string;
  name: string;
  wardNumber: string;
  shift: string;
  transportMethod: string;
}

interface RoundsShiftView {
  code: string;
  label: string;
  patients: RoundsPatient[];
}

interface RoundsDayView {
  date: string;
  label: string;
  shifts: RoundsShiftView[];
  total: number;
}

const SHIFT_DEFS = [
  { code: 'early', label: '早班' },
  { code: 'noon', label: '午班' },
  { code: 'late', label: '晚班' },
];

/**
 * 住院趴趴走獨立展示頁（免登入，掛在 main layout 之外）。
 * 資料來自免驗證的 /api/dashboard/inpatient-rounds-board，姓名已在後端遮罩。
 * 刻意用 raw fetch：ApiService 路徑預期 staff token，401 會被踢回登入頁。
 */
@Component({
  selector: 'app-inpatient-rounds-board',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './inpatient-rounds-board.component.html',
  styleUrl: './inpatient-rounds-board.component.css',
})
export class InpatientRoundsBoardComponent implements OnInit, OnDestroy {
  private readonly apiConfig = inject(ApiConfigService);

  readonly days = signal<RoundsDayView[]>([]);
  readonly errorMessage = signal('');
  readonly lastRefreshLabel = signal('');
  readonly isLoading = signal(true);

  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    document.title = '住院趴趴走總覽';
    void this.load();
    this.refreshTimer = setInterval(() => {
      if (!document.hidden) void this.load();
    }, 60_000);
  }

  ngOnDestroy(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }
  }

  private async load(): Promise<void> {
    try {
      const res = await fetch(`${this.apiConfig.apiBaseUrl}/dashboard/inpatient-rounds-board`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || '讀取趴趴走名單失敗');
      }
      const days = (data.days || []) as { date: string; patients: RoundsPatient[] }[];
      this.days.set(days.map((day, index) => this.toView(day, index)));
      this.errorMessage.set('');
      this.lastRefreshLabel.set(new Date().toLocaleTimeString('zh-TW', { hour12: false }));
    } catch (error) {
      this.errorMessage.set(error instanceof Error ? error.message : '讀取趴趴走名單失敗');
    } finally {
      this.isLoading.set(false);
    }
  }

  private toView(day: { date: string; patients: RoundsPatient[] }, index: number): RoundsDayView {
    const patients = day.patients || [];
    const shifts = SHIFT_DEFS.map((def) => ({
      ...def,
      patients: patients.filter((p) => p.shift === def.code),
    })).filter((s) => s.patients.length > 0);

    const weekday = new Date(`${day.date}T00:00:00+08:00`).toLocaleDateString('zh-TW', {
      weekday: 'short',
    });
    const tag = index === 0 ? '今天' : '明天';

    return {
      date: day.date,
      label: `${day.date.replace(/-/g, '/')}（${weekday}）${tag}`,
      shifts,
      total: patients.length,
    };
  }

  transportLabel(method: string): string {
    return method === 'unconfirmed' ? '推床 / 輪椅' : method;
  }
}
