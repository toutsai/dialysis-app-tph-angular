// Standalone 版：已移除 Firebase，改用 REST API + polling
import {
  Component,
  OnInit,
  OnDestroy,
  ViewChild,
  inject,
  signal,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FullCalendarComponent, FullCalendarModule } from '@fullcalendar/angular';
import { CalendarOptions, CalendarApi } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import zhTwLocale from '@fullcalendar/core/locales/zh-tw';
import { AuthService } from '@app/core/services/auth.service';
import { PatientStoreService } from '@app/core/services/patient-store.service';
import { NotificationService } from '@app/core/services/notification.service';
import { ApiManagerService, type ApiManager, type FirestoreRecord } from '@app/core/services/api-manager.service';
import { ConfirmDialogComponent } from '@app/components/dialogs/confirm-dialog/confirm-dialog.component';
import { NewUpdateTypeDialogComponent } from '@app/components/dialogs/new-update-type-dialog/new-update-type-dialog.component';
import { PatientUpdateSchedulerDialogComponent } from '@app/components/dialogs/patient-update-scheduler-dialog/patient-update-scheduler-dialog.component';

@Component({
  selector: 'app-update-scheduler',
  standalone: true,
  imports: [
    CommonModule,
    FullCalendarModule,
    ConfirmDialogComponent,
    NewUpdateTypeDialogComponent,
    PatientUpdateSchedulerDialogComponent,
  ],
  templateUrl: './update-scheduler.component.html',
  styleUrl: './update-scheduler.component.css',
})
export class UpdateSchedulerComponent implements OnInit, OnDestroy {
  private readonly authService = inject(AuthService);
  private readonly patientStore = inject(PatientStoreService);
  private readonly notificationService = inject(NotificationService);
  private readonly apiManagerService = inject(ApiManagerService);
  private readonly scheduledUpdatesApi: ApiManager<FirestoreRecord>;

  readonly allPatients = this.patientStore.allPatients;
  isPageLocked = computed(() => !this.authService.canEditSchedules());

  scheduledUpdates = signal<any[]>([]);
  isLoading = signal(true);

  isConfirmDialogVisible = signal(false);
  confirmDialogTitle = signal('');
  confirmDialogMessage = signal('');
  currentUpdateForAction = signal<any>(null);

  isNewTypeDialogVisible = signal(false);
  isSchedulerDialogVisible = signal(false);
  patientForScheduler = signal<any>(null);
  changeTypeForScheduler = signal('');
  isEditingUpdate = signal(false);

  calendarTitle = signal('');

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private calendarApi: CalendarApi | null = null;
  @ViewChild('fullCalendar') fullCalendarRef?: FullCalendarComponent;

  constructor() {
    this.scheduledUpdatesApi = this.apiManagerService.create<FirestoreRecord>('scheduled_updates');
  }

  TYPE_MAP: Record<string, string> = {
    UPDATE_STATUS: '身分變更',
    UPDATE_MODE: '模式變更',
    UPDATE_FREQ: '頻率變更',
    UPDATE_BASE_SCHEDULE_RULE: '總表規則變更',
    DELETE_PATIENT: '刪除病人',
    RESTORE_PATIENT: '復原病人',
  };

  STATUS_MAP: Record<string, { text: string; color: string; prefix: string }> = {
    pending: { text: '待執行', color: '#ffc107', prefix: '[待]' },
    // 現行後端 cron 寫入 processed/failed；completed/error 為舊版相容值，兩代都要涵蓋
    processed: { text: '已完成', color: '#198754', prefix: '[✓]' },
    completed: { text: '已完成', color: '#198754', prefix: '[✓]' },
    failed: { text: '執行失敗', color: '#dc3545', prefix: '[!]' },
    error: { text: '執行失敗', color: '#dc3545', prefix: '[!]' },
    cancelled: { text: '已取消', color: '#6c757d', prefix: '[—]' },
  };

  calendarEvents = computed(() => {
    return this.scheduledUpdates().map((update: any) => {
      const statusInfo = this.STATUS_MAP[update.status] || {
        text: '未知',
        color: '#6c757d',
        prefix: '[?]',
      };
      const typeText = this.TYPE_MAP[update.changeType] || '未知變更';
      const title = `${statusInfo.prefix} ${typeText} ${update.patientName} ${this.buildEventContent(update)}`.trim();
      return {
        id: update.id,
        title: title,
        start: update.effectiveDate,
        allDay: true,
        backgroundColor: statusInfo.color,
        borderColor: statusInfo.color,
        extendedProps: update,
      };
    });
  });

  calendarOptions = computed<CalendarOptions>(() => ({
    plugins: [dayGridPlugin, interactionPlugin, listPlugin],
    initialView: 'dayGridWeek',
    locale: zhTwLocale,
    headerToolbar: false,
    dayMaxEvents: true,
    events: this.calendarEvents(),
    datesSet: (arg) => {
      this.calendarTitle.set(arg.view.title);
    },
    eventClick: (info) => {
      this.handleEventClick(info.event.extendedProps);
    },
  }));

  ngOnInit(): void {
    this.patientStore.fetchPatientsIfNeeded().then(() => {
      this.fetchScheduledUpdates();
      this.pollTimer = setInterval(() => this.fetchScheduledUpdates(), 15_000);
    });
  }

  ngOnDestroy(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /** 上一輪輪詢是否仍在途；防止回應慢於 15 秒時請求重疊 */
  private isFetchingUpdates = false;

  /** Fetch all scheduled updates via REST API. */
  private async fetchScheduledUpdates(): Promise<void> {
    if (this.isFetchingUpdates) return;
    this.isFetchingUpdates = true;
    try {
      const results = await this.scheduledUpdatesApi.fetchAll();
      // Sort by createdAt descending (matching original Firestore orderBy)
      const sorted = [...results].sort((a: any, b: any) => {
        const dateA = new Date(a.createdAt || 0).getTime();
        const dateB = new Date(b.createdAt || 0).getTime();
        return dateB - dateA;
      });
      this.scheduledUpdates.set(sorted as any[]);
      this.isLoading.set(false);
    } catch (error) {
      console.error('監聽預約變更時發生錯誤:', error);
      this.isLoading.set(false);
    } finally {
      this.isFetchingUpdates = false;
    }
  }

  // --- Calendar Navigation ---
  private getCalendarApi(): CalendarApi | null {
    if (!this.calendarApi && this.fullCalendarRef) {
      this.calendarApi = this.fullCalendarRef.getApi();
    }
    return this.calendarApi;
  }

  handlePrev(): void {
    this.getCalendarApi()?.prev();
  }

  handleNext(): void {
    this.getCalendarApi()?.next();
  }

  handleToday(): void {
    this.getCalendarApi()?.today();
  }

  handleViewChange(viewName: string): void {
    this.getCalendarApi()?.changeView(viewName);
  }

  // --- Format ---
  private readonly STATUS_LABELS: Record<string, string> = { opd: '門診', ipd: '住院', er: '急診' };

  /** 行事曆單行內容：「舊值→新值」。舊值取病人現況——僅 pending 顯示（此時現況＝變更前值）；
   *  已執行的紀錄現況已是新值，補舊值會顯示成「住院→住院」誤導，故只顯示「→新值」。 */
  private buildEventContent(update: any): string {
    const payload = update?.payload || update?.changeData || {};
    const patient: any =
      update.status === 'pending'
        ? this.allPatients().find((p: any) => p.id === update.patientId)
        : null;
    switch (update.changeType) {
      case 'UPDATE_STATUS': {
        const from = patient ? this.STATUS_LABELS[patient.status] || patient.status || '' : '';
        const to = this.STATUS_LABELS[payload.status] || (payload.status || '?').toUpperCase();
        const ward = payload.wardNumber ? `(${payload.wardNumber})` : '';
        return `${from}→${to}${ward}`;
      }
      case 'UPDATE_MODE': {
        const from = (patient?.mode as string) || '';
        return `${from}→${payload.mode || '?'}`;
      }
      case 'UPDATE_FREQ':
        return `→${payload.freq || '?'}`;
      case 'UPDATE_BASE_SCHEDULE_RULE': {
        const shiftMap: Record<number, string> = { 0: '早', 1: '午', 2: '晚' };
        const bed = String(payload.bedNum).startsWith('p')
          ? `外圍${String(payload.bedNum).slice(-1)}`
          : `${payload.bedNum}床`;
        return `→${shiftMap[payload.shiftIndex] ?? '?'}班${bed} ${payload.freq || ''}`.trim();
      }
      case 'RESTORE_PATIENT': {
        const to = this.STATUS_LABELS[payload.status] || (payload.status || '?').toUpperCase();
        return `→${to}${payload.wardNumber ? `(${payload.wardNumber})` : ''}`;
      }
      case 'DELETE_PATIENT':
      default:
        return '';
    }
  }

  formatPayload(update: any): string {
    const changeType = update?.changeType;
    // 後端清單 API 回傳欄位是 changeData（DB 存 change_data）；payload 僅前端送出時使用
    const payload = update?.payload || update?.changeData || {};
    switch (changeType) {
      case 'UPDATE_STATUS':
        return `新身分: ${(payload.status || '?').toUpperCase()}${payload.wardNumber ? ` (${payload.wardNumber})` : ''}`;
      case 'UPDATE_MODE':
        return `新模式: ${payload.mode || '?'}`;
      case 'UPDATE_FREQ':
        return `新頻率: ${payload.freq || '?'}`;
      case 'UPDATE_BASE_SCHEDULE_RULE': {
        const shiftMap: Record<number, string> = { 0: '早', 1: '午', 2: '晚' };
        const bed = String(payload.bedNum).startsWith('p')
          ? `外圍${String(payload.bedNum).slice(-1)}`
          : `${payload.bedNum}床`;
        return `新規則: ${bed} / ${shiftMap[payload.shiftIndex] || '?'}班 / ${payload.freq || '?'}`;
      }
      case 'DELETE_PATIENT':
        return `原因: ${payload.deleteReason || '未填'}${payload.remarks ? ` (${payload.remarks})` : ''}`;
      case 'RESTORE_PATIENT': {
        const statusMap: Record<string, string> = { opd: '門診', ipd: '住院', er: '急診' };
        return `復原至: ${statusMap[payload.status] || (payload.status || '?').toUpperCase()}${payload.wardNumber ? ` (${payload.wardNumber})` : ''}`;
      }
      default:
        return JSON.stringify(payload);
    }
  }

  // --- Event Handling ---
  handleEventClick(update: any): void {
    this.currentUpdateForAction.set(update);
    const statusInfo = this.STATUS_MAP[update.status] || { text: '未知' };
    this.confirmDialogTitle.set('預約變更詳情');
    this.confirmDialogMessage.set(
      `病人: ${update.patientName}\n` +
        `類型: ${this.TYPE_MAP[update.changeType] || '未知'}\n` +
        `生效日: ${update.effectiveDate}\n` +
        `狀態: ${statusInfo.text}\n` +
        `詳情: ${this.formatPayload(update)}\n`,
    );
    if ((update.status === 'error' || update.status === 'failed') && update.errorMessage) {
      this.confirmDialogMessage.update((msg) => msg + `\n錯誤訊息: ${update.errorMessage}`);
    }
    this.isConfirmDialogVisible.set(true);
  }

  handleEdit(): void {
    const update = this.currentUpdateForAction();
    if (!update) return;
    this.patientForScheduler.set({
      id: update.patientId,
      name: update.patientName,
    });
    this.changeTypeForScheduler.set(update.changeType);
    this.isEditingUpdate.set(true);
    this.isConfirmDialogVisible.set(false);
    setTimeout(() => {
      this.isSchedulerDialogVisible.set(true);
    }, 150);
  }

  async handleDelete(): Promise<void> {
    const update = this.currentUpdateForAction();
    if (!update?.id) return;
    this.isConfirmDialogVisible.set(false);
    try {
      await this.scheduledUpdatesApi.delete(update.id);
      // Remove from local state immediately
      this.scheduledUpdates.update(list => list.filter((u: any) => u.id !== update.id));
      const typeText = this.TYPE_MAP[update.changeType] || '預約';
      this.notificationService.createGlobalNotification(
        `成功撤銷 ${update.patientName} 的 ${typeText}`,
        'success',
      );
    } catch (error: any) {
      console.error('撤銷預約失敗:', error);
      this.notificationService.createGlobalNotification(`撤銷失敗: ${error.message}`, 'error');
    } finally {
      this.currentUpdateForAction.set(null);
    }
  }

  canDeleteUpdate(update: any): boolean {
    // pending 一律可撤銷：生效日已過的 pending 是漏執行的殭屍（cron 只套用當日），
    // 更需要讓組長撤銷清掉，不做日期限制
    return update?.status === 'pending';
  }

  // --- Dialog Functions ---
  openNewUpdateDialog(): void {
    if (this.isPageLocked()) return;
    this.isNewTypeDialogVisible.set(true);
  }

  handleNewTypeSelected(event: any): void {
    this.patientForScheduler.set(event.patient);
    this.changeTypeForScheduler.set(event.changeType);
    this.isNewTypeDialogVisible.set(false);
    setTimeout(() => {
      this.isSchedulerDialogVisible.set(true);
    }, 150);
  }

  closeSchedulerDialogs(): void {
    this.isSchedulerDialogVisible.set(false);
    this.isEditingUpdate.set(false);
  }

  async handleScheduledUpdate(dataToSubmit: any): Promise<void> {
    this.isSchedulerDialogVisible.set(false);
    try {
      if (this.isEditingUpdate() && this.currentUpdateForAction()?.id) {
        await this.scheduledUpdatesApi.save(this.currentUpdateForAction().id, dataToSubmit);
        this.notificationService.createGlobalNotification('預約變更已成功更新', 'success');
      } else {
        await this.scheduledUpdatesApi.create(dataToSubmit);
        this.notificationService.createGlobalNotification(
          '預約成功！變更將在指定日期自動生效。',
          'success',
        );
      }
      // Refresh the list
      await this.fetchScheduledUpdates();
    } catch (error: any) {
      console.error('提交預約失敗:', error);
      this.notificationService.createGlobalNotification(`操作失敗: ${error.message}`, 'error');
    } finally {
      this.isEditingUpdate.set(false);
      this.currentUpdateForAction.set(null);
    }
  }

  closeConfirmDialog(): void {
    this.isConfirmDialogVisible.set(false);
  }
}
