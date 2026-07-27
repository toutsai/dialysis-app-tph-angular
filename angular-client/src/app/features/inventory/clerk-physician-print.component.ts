// 書記專用 > 醫師班表列印
// 唯讀載入指定月份的醫師查房班表，預覽 + 匯出 Word（與醫師班表頁共用同一匯出 util）。
import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ApiManagerService,
  type ApiManager,
  type FirestoreRecord,
} from '@services/api-manager.service';
import { UserDirectoryService } from '@app/core/services/user-directory.service';
import {
  buildRoundingWeeks,
  exportRoundingWordDoc,
} from '@app/core/utils/physician-rounding-word';

type ShiftCode = 'early' | 'noon' | 'late';

@Component({
  selector: 'app-clerk-physician-print',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './clerk-physician-print.component.html',
  styleUrl: './clerk-physician-print.component.css',
})
export class ClerkPhysicianPrintComponent implements OnInit {
  private readonly apiManagerService = inject(ApiManagerService);
  private readonly userDirectory = inject(UserDirectoryService);
  private schedulesApi!: ApiManager<FirestoreRecord>;

  readonly SHIFT_ROWS: { label: string; shift: ShiftCode }[] = [
    { label: '早班', shift: 'early' },
    { label: '午班', shift: 'noon' },
    { label: '夜班', shift: 'late' },
  ];
  readonly WEEKDAY_HEADERS = ['一', '二', '三', '四', '五', '六'];

  /** YYYY-MM，預設當月 */
  selectedYearMonth = signal(this.formatYearMonth(new Date()));
  isLoading = signal(false);
  loadError = signal('');
  /** schedule[day][shift] = { physicianId, name } */
  private scheduleData = signal<Record<string, any>>({});
  private scheduleLoaded = signal(false);

  year = computed(() => Number(this.selectedYearMonth().slice(0, 4)));
  month = computed(() => Number(this.selectedYearMonth().slice(5, 7)));

  /** 週曆格（僅一~六，供預覽表；匯出用完整版） */
  previewWeeks = computed(() =>
    buildRoundingWeeks(this.year(), this.month()).map((week) => week.slice(0, 6)),
  );

  /** 本月是否完全沒有排班資料 */
  isEmptyMonth = computed(() => {
    if (!this.scheduleLoaded()) return false;
    const schedule = this.scheduleData();
    for (const day in schedule) {
      for (const shift of ['early', 'noon', 'late']) {
        if (schedule[day]?.[shift]?.physicianId) return false;
      }
    }
    return true;
  });

  async ngOnInit(): Promise<void> {
    this.schedulesApi = this.apiManagerService.create('physician_schedules');
    // 舊月份存檔可能只有 physicianId 沒有 name，備援用使用者目錄反查
    this.userDirectory.fetchUsersIfNeeded().catch(() => {});
    await this.loadMonth();
  }

  async loadMonth(): Promise<void> {
    this.isLoading.set(true);
    this.loadError.set('');
    this.scheduleLoaded.set(false);
    try {
      const doc = (await this.schedulesApi.fetchById(this.selectedYearMonth())) as any;
      const existing = doc?.scheduleData || doc;
      this.scheduleData.set(existing?.schedule || {});
      this.scheduleLoaded.set(true);
    } catch (error) {
      console.error(`讀取 ${this.selectedYearMonth()} 醫師班表失敗:`, error);
      this.scheduleData.set({});
      this.loadError.set('讀取班表失敗，請稍後再試。');
    } finally {
      this.isLoading.set(false);
    }
  }

  onMonthInputChange(value: string): void {
    if (/^\d{4}-\d{2}$/.test(value)) {
      this.selectedYearMonth.set(value);
      this.loadMonth();
    }
  }

  goToPreviousMonth(): void {
    this.shiftMonth(-1);
  }

  goToNextMonth(): void {
    this.shiftMonth(1);
  }

  private shiftMonth(delta: number): void {
    const d = new Date(this.year(), this.month() - 1 + delta, 1);
    this.selectedYearMonth.set(this.formatYearMonth(d));
    this.loadMonth();
  }

  /** 與醫師班表頁一致的簡稱規則：蔡亨政→政，其餘取姓氏首字 */
  displayName(day: number | null, shift: ShiftCode): string {
    if (!day) return '';
    const cell = this.scheduleData()[day]?.[shift];
    if (!cell?.physicianId) return '--';
    const fullName: string =
      cell.name || this.userDirectory.allUsers().find((u) => u.id === cell.physicianId)?.name || '';
    if (!fullName) return '--';
    return fullName === '蔡亨政' ? '政' : fullName.charAt(0);
  }

  exportWord(): void {
    exportRoundingWordDoc({
      year: this.year(),
      month: this.month(),
      weeks: buildRoundingWeeks(this.year(), this.month()),
      resolveName: (day, shift) => this.displayName(day, shift),
    });
  }

  private formatYearMonth(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
}
