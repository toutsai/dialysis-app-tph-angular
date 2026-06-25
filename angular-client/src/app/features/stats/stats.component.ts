// Standalone 版：已移除 Firebase
import { Component, inject, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '@app/core/services/auth.service';
import { ApiConfigService } from '@services/api-config.service';
import { ApiManagerService, type FirestoreRecord } from '@services/api-manager.service';
import { PatientStoreService } from '@services/patient-store.service';
import { TaskStoreService } from '@services/task-store.service';
import { MedicationStoreService } from '@services/medication-store.service';
import { ArchiveStoreService } from '@services/archive-store.service';
import { NotificationService } from '@services/notification.service';
import { DateStateService } from '@app/core/services/date-state.service';
import { UserDirectoryService } from '@services/user-directory.service';
import { Subject, Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { SHIFT_CODES, earlyTeams as importedEarlyTeams, lateTeams as importedLateTeams, baseTeams } from '@/constants/scheduleConstants';
import { generateAutoNote, getUnifiedCellStyle } from '@/utils/scheduleUtils';
import {
  fetchTeamsByDate,
  saveTeams,
  updateTeams,
  saveScheduleWithTeams,
  fetchNurseAssignmentRevisions,
  restoreNurseAssignmentRevision,
} from '@/services/nurseAssignmentsService';
import { createDialysisOrderAndUpdatePatient } from '@/services/optimizedApiService';
import * as XLSX from 'xlsx';

// Dialog components
import { BedChangeDialogComponent } from '@app/components/dialogs/bed-change-dialog/bed-change-dialog.component';
import { TaskCreateDialogComponent } from '@app/components/dialogs/task-create-dialog/task-create-dialog.component';
import { AlertDialogComponent } from '@app/components/dialogs/alert-dialog/alert-dialog.component';
import { ConfirmDialogComponent } from '@app/components/dialogs/confirm-dialog/confirm-dialog.component';
import { MemoDisplayDialogComponent } from '@app/components/dialogs/memo-display-dialog/memo-display-dialog.component';
import { ConditionRecordDisplayDialogComponent } from '@app/components/dialogs/condition-record-display-dialog/condition-record-display-dialog.component';
import { EducationRecordDialogComponent } from '@app/components/dialogs/education-record-dialog/education-record-dialog.component';
import { fetchEffectiveOrders } from '@/services/effectiveOrdersService';
import { DailyInjectionListDialogComponent } from '@app/components/dialogs/daily-injection-list-dialog/daily-injection-list-dialog.component';
import { DialysisOrderModalComponent } from '@app/components/dialogs/dialysis-order-modal/dialysis-order-modal.component';
import { ExceptionCreateDialogComponent } from '@app/components/dialogs/exception-create-dialog/exception-create-dialog.component';
import { NewUpdateTypeDialogComponent } from '@app/components/dialogs/new-update-type-dialog/new-update-type-dialog.component';
import { PatientUpdateSchedulerDialogComponent } from '@app/components/dialogs/patient-update-scheduler-dialog/patient-update-scheduler-dialog.component';

// Display components
import { PreparationPopoverComponent } from '@app/components/preparation-popover/preparation-popover.component';
import { PatientMessagesIconComponent } from '@app/components/patient-messages-icon/patient-messages-icon.component';
import { DailyStaffDisplayComponent } from '@app/components/daily-staff-display/daily-staff-display.component';
import { StatsToolbarComponent } from '@app/components/stats-toolbar/stats-toolbar.component';

// --- Constants ---
const nurseNameList = [
  '陳素秋', '古孟麗', '謝常菁', '林玉麗', '陳聖柔', '田姿瑛', '陳韋吟', '劉姿秀',
  '劉舒婷', '李慈賢', '黃羿寧', '高佩鳳', '林沛儀', '陳芃諭', '葛孟萍', '蘇愛玲',
  '郭芳君', '林馨如', '胡國暄', '施艾利', '陳淑玲', '謝慶諭', '林佩佳', '吳思婷',
  '吳幸美', '林芳羽', '蔡靜怡', '莊明月',
];

const earlyBaseTeams = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', '外圍', '未分組'];
const lateBaseTeams = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', '外圍', '未分組'];
const earlyTeams = earlyBaseTeams.map(t => `早${t}`);
const lateTeams = lateBaseTeams.map(t => `晚${t}`);

const dutyAssignments: Record<string, Record<string, string | string[]>> = {
  early: {
    '現場指揮官': 'K',
    '安全防護班': ['A', 'B', 'J-75'],
    '引導救護班': ['C', 'D', 'E', 'G', 'H-1', 'I-2'],
    '滅火班': 'F-75',
  },
  late: {
    '現場指揮官': 'K',
    '安全防護班': ['A', 'B', 'J-75'],
    '引導救護班': ['C', 'D', 'E', 'G', 'H-1', 'I-2'],
    '滅火班': 'F-75',
  },
  night: {
    '現場指揮官': 'A',
    '安全防護班/通報班': 'B',
    '引導救護班': ['C', 'D', 'E', 'G', 'H'],
    '滅火班': 'F-128',
  },
};

@Component({
  selector: 'app-stats',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    BedChangeDialogComponent,
    TaskCreateDialogComponent,
    AlertDialogComponent,
    ConfirmDialogComponent,
    MemoDisplayDialogComponent,
    ConditionRecordDisplayDialogComponent,
    EducationRecordDialogComponent,
    DailyInjectionListDialogComponent,
    DialysisOrderModalComponent,
    ExceptionCreateDialogComponent,
    NewUpdateTypeDialogComponent,
    PatientUpdateSchedulerDialogComponent,
    PreparationPopoverComponent,
    PatientMessagesIconComponent,
    DailyStaffDisplayComponent,
    StatsToolbarComponent,
  ],
  templateUrl: './stats.component.html',
  styleUrl: './stats.component.css'
})
export class StatsComponent implements OnInit, OnDestroy {
  // 外圍床位在排序時的 sentinel 值，確保排在一般床號之後
  private static readonly PERIPHERAL_BED_SORT_ORDER = 9999;

  private readonly auth = inject(AuthService);
  private readonly firebase = inject(ApiConfigService);
  private readonly apiManager = inject(ApiManagerService);
  private readonly patientStore = inject(PatientStoreService);
  private readonly taskStore = inject(TaskStoreService);
  private readonly medicationStore = inject(MedicationStoreService);
  private readonly archiveStore = inject(ArchiveStoreService);
  private readonly notificationService = inject(NotificationService);
  private readonly dateState = inject(DateStateService);
  private readonly userDirectory = inject(UserDirectoryService);

  // API instances
  private readonly schedulesApi = this.apiManager.create<FirestoreRecord>('schedules');
  private readonly usersApi = this.apiManager.create<FirestoreRecord>('users');

  // --- Constants exposed to template ---
  readonly nurseNameList = nurseNameList;
  readonly dutyAssignments = dutyAssignments;

  // --- Core State ---
  isFireDutyDropdownVisible = false;
  currentDate = new Date();

  initDateFromSharedState(): void {
    const sharedDate = this.dateState.selectedDate;
    if (sharedDate) {
      this.currentDate = new Date(sharedDate);
    }
  }
  statusIndicator = '';
  isLoading = false;
  currentRecord: any = { id: null, date: '', schedule: {} };
  currentTeamsRecord: any = { id: null, date: '', teams: {}, names: {} };
  hasUnsavedScheduleChanges = false;
  hasUnsavedTeamChanges = false;
  private exceptionEventSource: EventSource | null = null;
  private exceptionRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  noonTakeoffVisibility: Record<string, boolean> = { early: false, late: false };

  // --- Dialog State ---
  isBedChangeDialogVisible = false;
  editingPatientInfo: any = null;
  bedChangeTargetShift: string | null = null;
  pendingChangeInfo: any = null;

  isMemoDialogVisible = false;
  isConditionRecordDialogVisible = false;
  selectedPatientForDialog: any = null;
  selectedPatientIsFirstDialysis = false;

  // 衛教紀錄視窗
  showEducationDialog = false;
  educationPatient: { id: string; name: string } | null = null;

  isAlertDialogVisible = false;
  alertDialogTitle = '';
  alertDialogMessage = '';

  isConfirmDialogVisible = false;
  confirmDialogMessage = '';
  onConfirmAction: (() => void) | null = null;

  isPrepPopoverVisible = false;
  prepPopoverData: any = { patients: [], targetElement: null };

  isCreateTaskModalVisible = false;

  dailyPhysicians: any = { early: null, noon: null, late: null };
  dailyConsultPhysicians: any = { morning: null, afternoon: null, night: null };

  isInjectionDialogVisible = false;
  dailyInjections: any[] = [];
  isInjectionLoading = false;
  lastInjectionTeamData: any = null;
  lastInjectionShiftType: string | null = null;

  isOrderModalVisible = false;
  editingPatientForOrder: any = null;

  // Exception dialog
  isExceptionDialogVisible = false;
  exceptionToEdit: any = null;
  exceptionPrefill: any = null;

  // 護理分組歷史快照 / 還原
  isHistoryDialogVisible = false;
  historyRevisions: any[] = [];
  historyLoading = false;

  // Scheduler dialogs
  // Scheduler dialogs
  isNewUpdateTypeDialogVisible = false;
  isSchedulerDialogVisible = false;
  patientForScheduler: any = null;
  changeTypeForScheduler = '';

  // --- Constants (from scheduleConstants.js + 未分組 entries) ---
  private readonly earlyTeams = [...importedEarlyTeams, '早未分組'];
  private readonly lateTeams = [...importedLateTeams, '晚未分組'];
  private readonly lateBaseTeams = [...baseTeams, '未分組'];

  // --- Cached Data Properties ---
  private updateSubject = new Subject<void>();
  private updateSubscription?: Subscription;

  sortedEarlyTeams: string[] = [];
  sortedLateTeams: string[] = [];
  sortedLateTakeOffTeams: string[] = [];
  maxTeamCount = 0;
  uniformGridColumns = '90px';
  effectiveStatsData: any = { early: {}, late: {}, lateTakeOff: {} };
  
  cachedIsPageLocked: boolean = false;
  cachedHasUnsavedChanges: boolean = false;

  // --- Computed Properties (getters) ---
  // Replaced heavy getters with cached variables.
  
  get hasUnsavedChanges(): boolean {
    return this.cachedHasUnsavedChanges;
  }

  get isPageLocked(): boolean {
    return this.cachedIsPageLocked;
  }

  get statsToolbarData(): any[] {
    const shiftCodes = ['early', 'noon', 'late'];
    const counts: Record<string, Record<string, number>> = {};
    shiftCodes.forEach(sc => { counts[sc] = { total: 0, opd: 0, ipd: 0, er: 0 }; });
    const dailyData = { counts, total: 0 };
    if (this.currentRecord?.schedule) {
      for (const [shiftKey, slotData] of Object.entries(this.currentRecord.schedule) as [string, any][]) {
        if (slotData?.patientId) {
          const patient = this.patientMap.get(slotData.patientId);
          if (!patient) continue;
          const shiftCode = shiftKey.split('-').pop()!;
          if (shiftCode && dailyData.counts[shiftCode]) {
            const shiftStats = dailyData.counts[shiftCode];
            shiftStats['total']++;
            dailyData.total++;
            const status = patient['status'] as string;
            if (status === 'opd') shiftStats['opd']++;
            else if (status === 'ipd') shiftStats['ipd']++;
            else if (status === 'er') shiftStats['er']++;
          }
        }
      }
    }
    return [dailyData];
  }

  readonly statsToolbarWeekdays = ['本日'];

  private updateLockAndChangeStatus(): void {
    this.cachedHasUnsavedChanges = this.hasUnsavedScheduleChanges || this.hasUnsavedTeamChanges;

    if (!this.auth.canEditSchedules()) {
      this.cachedIsPageLocked = true;
      return;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const currentDay = new Date(this.currentDate);
    currentDay.setHours(0, 0, 0, 0);
    this.cachedIsPageLocked = currentDay < today;
  }

  get weekdayDisplay(): string {
    return ['日', '一', '二', '三', '四', '五', '六'][new Date(this.currentDate).getDay()];
  }

  get lateShiftTakeOffExists(): boolean {
    return Object.values(this.currentTeamsRecord.teams || {}).some(
      (team: any) => team && typeof team.nurseTeamTakeOff !== 'undefined'
    );
  }

  get allPatients(): any[] {
    return this.patientStore.allPatients();
  }

  get patientMap(): Map<string, any> {
    return this.patientStore.patientMap();
  }

  /** 若病人被標記「勿動」則回傳該病人，否則 null */
  private getLockedPatient(patientId: string): any | null {
    const p = this.patientMap.get(patientId);
    return p?.patientStatus?.doNotMove?.active ? p : null;
  }

  /** 病人是否標記勿動（供模板顯示鎖定圖示） */
  isDoNotMove(patientId: string): boolean {
    return !!this.getLockedPatient(patientId);
  }

  doNotMoveReasonText(patientId: string): string {
    return this.patientMap.get(patientId)?.patientStatus?.doNotMove?.reason || '無原因說明';
  }

  private doNotMoveMessage(p: any): string {
    return (
      `病人 ${p?.name || ''} 已標記為「勿動」，無法調動。\n` +
      `原因：${p?.patientStatus?.doNotMove?.reason || '未提供'}\n` +
      `如需移動，請先至病人清單解除勿動。`
    );
  }

  updateStatsCache(): void {
    const createTeamStats = (teams: string[], shiftType: string) => {
      const stats: any = {};
      teams.forEach(team => {
        stats[team] = {
          nurseName: this.currentTeamsRecord.names?.[team] || '',
          totalOpdCount: 0,
          totalIpdCount: 0,
          totalErCount: 0,
        };
        if (shiftType === 'early') {
          stats[team].earlyShift = { patients: [], opdCount: 0, ipdCount: 0, erCount: 0 };
          stats[team].noonShiftOn = { patients: [], opdCount: 0, ipdCount: 0, erCount: 0 };
          stats[team].noonShiftOff = { patients: [], opdCount: 0, ipdCount: 0, erCount: 0 };
        } else if (shiftType === 'late') {
          stats[team].noonShiftOff = { patients: [], opdCount: 0, ipdCount: 0, erCount: 0 };
          stats[team].lateShift = { patients: [], opdCount: 0, ipdCount: 0, erCount: 0 };
        } else if (shiftType === 'lateTakeOff') {
          stats[team].lateShiftTakeOff = { patients: [], opdCount: 0, ipdCount: 0, erCount: 0 };
        }
      });
      return stats;
    };

    const lateTakeOffTeams = this.lateBaseTeams.map(t => `夜間收針${t}`);
    const earlyShiftStats = createTeamStats(this.earlyTeams, 'early');
    const lateShiftStats = createTeamStats(this.lateTeams, 'late');
    const lateTakeOffStats = createTeamStats(lateTakeOffTeams, 'lateTakeOff');

    if (this.currentRecord.schedule) {
      // 與每日排程一致：依「關聯日」當天起顯示（過期未讀續顯示、無關聯日續顯示、已讀隱藏），
      // 而非舊的 getPendingMessageTypesMap（不看關聯日、所有未讀一律顯示）。
      const messagesMap = this.taskStore.getPatientMessageTypesMapForDate(
        this.currentRecord.date || this.formatDate(this.currentDate),
      );

      for (const shiftId in this.currentRecord.schedule) {
        const shiftDetails = this.currentRecord.schedule[shiftId];
        if (!shiftDetails || !shiftDetails.patientId) continue;

        const patientInfo = this.getArchivedOrLivePatientInfo(shiftDetails);
        const patientDetails = this.patientMap.get(shiftDetails.patientId);
        if (!patientInfo || !patientDetails) continue;

        const messageTypesForPatient = [...(messagesMap.get(patientDetails.id) || [])]; // Map 值為 Set，展開成陣列
        const cellStyles = getUnifiedCellStyle(shiftDetails, patientInfo, null, messageTypesForPatient);

        const detail: any = {
          id: patientDetails.id,
          shiftId,
          name: patientDetails.name,
          medicalRecordNumber: patientDetails.medicalRecordNumber,
          status: patientInfo.status,
          mode: shiftDetails.modeOverride || patientInfo.mode,
          wardNumber: patientInfo.wardNumber || '',
          dialysisBed: shiftId.startsWith('peripheral') ? '外圍' : shiftId.split('-')[1] || '',
          finalTags: [...new Set([
            ...(shiftDetails.autoNote || '').split(' '),
            ...(shiftDetails.manualNote || '').split(' '),
          ])].filter((tag: string) => tag && !['住', '急'].includes(tag)).join(' '),
          classes: 'patient-item ' + Object.entries(cellStyles)
            .filter(([, v]) => v)
            .map(([k]) => k)
            .join(' '),
          dialysisOrders: patientDetails.dialysisOrders || {},
          messageTypes: messageTypesForPatient,
        };

        const assignAndCount = (group: any, pDetail: any) => {
          if (!group) return;
          group.patients.push(pDetail);
          if (pDetail.status === 'ipd') group.ipdCount++;
          else if (pDetail.status === 'er') group.erCount++;
          else group.opdCount++;
        };

        const shiftCode = shiftId.split('-')[2];
        const { nurseTeam, nurseTeamIn, nurseTeamOut, nurseTeamTakeOff } = shiftDetails;

        if (shiftCode === SHIFT_CODES.EARLY) {
          const targetTeam = nurseTeam || '早未分組';
          if (earlyShiftStats[targetTeam]) {
            assignAndCount(earlyShiftStats[targetTeam].earlyShift, detail);
          }
        } else if (shiftCode === SHIFT_CODES.LATE) {
          const targetTeam = nurseTeam || '晚未分組';
          if (lateShiftStats[targetTeam]) {
            assignAndCount(lateShiftStats[targetTeam].lateShift, detail);
          }
          const targetTakeOffTeam = nurseTeamTakeOff || '夜間收針未分組';
          if (lateTakeOffStats[targetTakeOffTeam]) {
            assignAndCount(lateTakeOffStats[targetTakeOffTeam].lateShiftTakeOff, detail);
          }
        } else if (shiftCode === SHIFT_CODES.NOON) {
          const targetInTeam = nurseTeamIn || '早未分組';
          if (earlyShiftStats[targetInTeam]) {
            assignAndCount(earlyShiftStats[targetInTeam].noonShiftOn, detail);
          }
          if (nurseTeamOut) {
            if (lateShiftStats[nurseTeamOut]) {
              assignAndCount(lateShiftStats[nurseTeamOut].noonShiftOff, detail);
            } else if (earlyShiftStats[nurseTeamOut]) {
              assignAndCount(earlyShiftStats[nurseTeamOut].noonShiftOff, detail);
            }
          } else {
            if (lateShiftStats['晚未分組']) {
              assignAndCount(lateShiftStats['晚未分組'].noonShiftOff, detail);
            }
          }
        }
      }

      const peripheralOrder = StatsComponent.PERIPHERAL_BED_SORT_ORDER;
      const sortPatientsByBed = (a: any, b: any) =>
        (a.dialysisBed === '外圍' ? peripheralOrder : parseInt(a.dialysisBed, 10)) -
        (b.dialysisBed === '外圍' ? peripheralOrder : parseInt(b.dialysisBed, 10));

      [earlyShiftStats, lateShiftStats, lateTakeOffStats].forEach((stats, index) => {
        for (const team in stats) {
          const teamData = stats[team];
          if (!teamData) continue;
          Object.values(teamData).forEach((group: any) => {
            if (group && Array.isArray(group.patients)) {
              group.patients.sort(sortPatientsByBed);
            }
          });
          if (index === 0) {
            teamData.totalOpdCount = (teamData.earlyShift?.opdCount || 0) + (teamData.noonShiftOn?.opdCount || 0);
            teamData.totalIpdCount = (teamData.earlyShift?.ipdCount || 0) + (teamData.noonShiftOn?.ipdCount || 0);
            teamData.totalErCount = (teamData.earlyShift?.erCount || 0) + (teamData.noonShiftOn?.erCount || 0);
          } else if (index === 1) {
            teamData.totalOpdCount = teamData.lateShift?.opdCount || 0;
            teamData.totalIpdCount = teamData.lateShift?.ipdCount || 0;
            teamData.totalErCount = teamData.lateShift?.erCount || 0;
          } else {
            teamData.totalOpdCount = teamData.lateShiftTakeOff?.opdCount || 0;
            teamData.totalIpdCount = teamData.lateShiftTakeOff?.ipdCount || 0;
            teamData.totalErCount = teamData.lateShiftTakeOff?.erCount || 0;
          }
        }
      });
    }

    this.effectiveStatsData = { early: earlyShiftStats, late: lateShiftStats, lateTakeOff: lateTakeOffStats };

    const sortFn = (a: string, b: string) => {
      if (a.includes('未分組')) return 1;
      if (b.includes('未分組')) return -1;
      if (a.includes('外圍')) return 1;
      if (b.includes('外圍')) return -1;
      return a.localeCompare(b);
    };

    this.sortedEarlyTeams = Object.keys(this.effectiveStatsData.early).sort(sortFn);
    this.sortedLateTeams = Object.keys(this.effectiveStatsData.late).sort(sortFn);
    this.sortedLateTakeOffTeams = Object.keys(this.effectiveStatsData.lateTakeOff).sort(sortFn);
    this.maxTeamCount = Math.max(this.sortedEarlyTeams.length, this.sortedLateTeams.length, this.sortedLateTakeOffTeams.length, 1);
    this.uniformGridColumns = `90px repeat(${this.maxTeamCount}, minmax(130px, 1fr))`;
    
    this.updateLockAndChangeStatus();
  }

  // --- Lifecycle Hooks ---

  ngOnInit(): void {
    this.initDateFromSharedState();
    Promise.all([this.loadData(this.currentDate), this.loadDailyStaffInfo(this.currentDate)])
      .then(() => this.startExceptionEventStream());
  }

  ngOnDestroy(): void {
    this.stopExceptionEventStream();
  }

  private startExceptionEventStream(): void {
    const token = this.firebase.getToken();
    if (!token || typeof EventSource === 'undefined') return;

    this.stopExceptionEventStream();
    try {
      const es = new EventSource(`/api/events/exceptions?token=${encodeURIComponent(token)}`);
      this.exceptionEventSource = es;

      es.addEventListener('exception', (event: MessageEvent) => {
        let payload: any = null;
        try {
          payload = JSON.parse(event.data);
        } catch {
          payload = null;
        }
        this.handleExceptionScheduleRefresh(payload);
      });

      es.onerror = () => {
        console.warn('[Stats] exception SSE disconnected; EventSource will retry automatically');
      };
    } catch (error) {
      console.warn('[Stats] exception SSE init failed:', error);
    }
  }

  private stopExceptionEventStream(): void {
    if (this.exceptionEventSource) {
      this.exceptionEventSource.close();
      this.exceptionEventSource = null;
    }
    if (this.exceptionRefreshTimer) {
      clearTimeout(this.exceptionRefreshTimer);
      this.exceptionRefreshTimer = null;
    }
  }

  private handleExceptionScheduleRefresh(payload: any): void {
    const dateStr = this.formatDate(this.currentDate);
    if (!this.exceptionAffectsDate(payload, dateStr)) return;

    if (this.hasUnsavedScheduleChanges || this.hasUnsavedTeamChanges) {
      this.statusIndicator = '調班換床已更新；請先儲存或重新整理後查看最新床位';
      return;
    }

    if (this.exceptionRefreshTimer) clearTimeout(this.exceptionRefreshTimer);
    this.exceptionRefreshTimer = setTimeout(() => {
      this.exceptionRefreshTimer = null;
      const date = new Date(this.currentDate);
      Promise.all([
        this.loadData(date),
        this.loadDailyStaffInfo(date),
      ]).catch((error) => console.warn('[Stats] exception refresh failed:', error));
    }, 800);
  }

  private exceptionAffectsDate(payload: any, dateStr: string): boolean {
    const exception = payload?.exception || payload || {};
    const affectedDates = new Set<string>();

    const addDate = (value: unknown) => {
      if (typeof value === 'string' && value.length >= 10) {
        affectedDates.add(value.substring(0, 10));
      }
    };

    if (Array.isArray(exception.affectedDates)) {
      exception.affectedDates.forEach(addDate);
    }
    addDate(exception.date);
    addDate(exception.startDate);
    addDate(exception.endDate);
    addDate(exception.from?.sourceDate);
    addDate(exception.to?.goalDate);

    if (typeof exception.startDate === 'string' && typeof exception.endDate === 'string') {
      const start = exception.startDate.substring(0, 10);
      const end = exception.endDate.substring(0, 10);
      if (dateStr >= start && dateStr <= end) return true;
    }

    return affectedDates.size === 0 || affectedDates.has(dateStr);
  }

  // --- Helper Methods ---

  hasPermission(role: string): boolean {
    return this.auth.currentUser() != null;
  }

  formatDate(date: Date | null): string {
    if (!date) return '';
    const d = new Date(date);
    return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
  }

  getDutyShiftLabel(shift: string): string {
    if (shift === 'early') return '早班';
    if (shift === 'late') return '午/晚班';
    return '夜班';
  }

  isArray(val: any): boolean {
    return Array.isArray(val);
  }

  getDutyTagClass(dutyName: string): string {
    if (dutyName.includes('指揮官')) return 'role-field-commander';
    if (dutyName.includes('安全')) return 'role-safety';
    if (dutyName.includes('引導')) return 'role-guide';
    if (dutyName.includes('滅火')) return 'role-fire';
    if (dutyName.includes('通報')) return 'role-reporter';
    return 'role-default';
  }

  objectKeys(obj: any): string[] {
    return obj ? Object.keys(obj) : [];
  }

  objectEntries(obj: any): [string, any][] {
    return obj ? Object.entries(obj) : [];
  }

  toggleNoonTakeoff(shiftType: string): void {
    if (shiftType === 'early' || shiftType === 'late') {
      this.noonTakeoffVisibility[shiftType] = !this.noonTakeoffVisibility[shiftType];
    }
  }

  // --- Data Loading ---

  async loadDailyStaffInfo(date: Date): Promise<void> {
    try {
      const dateStr = this.formatDate(date).substring(0, 7);
      const physicianSchedulesApi = this.apiManager.create<FirestoreRecord>('physician_schedules');
      const physiciansApi = this.apiManager.create<FirestoreRecord>('physicians');
      // ✅ 優化：使用預載入的 UserDirectoryService 做本地過濾，避免 Firestore 查詢
      const [, physicians, monthScheduleDoc] = await Promise.all([
        this.userDirectory.fetchUsersIfNeeded(),
        physiciansApi.fetchAll().catch(() => []),
        physicianSchedulesApi.fetchById(dateStr),
      ]);
      const usersSnapshot = this.userDirectory.allUsers()
        .filter(u => u.title === '主治醫師' || u.title === '專科護理師');
      const userMap = new Map([...physicians, ...usersSnapshot].map((u: any) => [u.id, u]));
      const resolveStaff = (entry: any) => {
        const physicianId = entry?.physicianId;
        if (!physicianId) return null;
        return userMap.get(physicianId) || (entry?.name ? { id: physicianId, name: entry.name } : null);
      };

      const dialysisPhysiciansData: any = { early: null, noon: null, late: null };
      const consultPhysiciansData: any = { morning: null, afternoon: null, night: null };

      if (monthScheduleDoc) {
        const doc = ((monthScheduleDoc as any).scheduleData || monthScheduleDoc) as any;
        const dayOfMonth = date.getDate();
        const daySchedule = doc.schedule?.[dayOfMonth];
        if (daySchedule) {
          dialysisPhysiciansData.early = resolveStaff(daySchedule.early);
          dialysisPhysiciansData.noon = resolveStaff(daySchedule.noon);
          dialysisPhysiciansData.late = resolveStaff(daySchedule.late);
        }
        const consultationDaySchedule = doc.consultationSchedule?.[dayOfMonth];
        if (consultationDaySchedule) {
          consultPhysiciansData.morning = resolveStaff(consultationDaySchedule.morning);
          consultPhysiciansData.afternoon = resolveStaff(consultationDaySchedule.afternoon);
          consultPhysiciansData.night = resolveStaff(consultationDaySchedule.night);
        }
      }

      this.dailyPhysicians = dialysisPhysiciansData;
      this.dailyConsultPhysicians = consultPhysiciansData;
    } catch (error) {
      console.error('載入每日負責人資訊失敗:', error);
      this.dailyPhysicians = { early: null, noon: null, late: null };
      this.dailyConsultPhysicians = { morning: null, afternoon: null, night: null };
    }
  }

  private async fetchArchivedSchedule(dateStr: string): Promise<any> {
    return await this.archiveStore.fetchScheduleByDate(dateStr);
  }

  private async fetchLiveSchedule(dateStr: string): Promise<any> {
    // GET /schedules/:date can auto-generate a missing daily schedule from the master table.
    const record: any =
      (await this.schedulesApi.fetchById(dateStr)) || {
        date: dateStr,
        schedule: {},
      };

    if (record.schedule) {
      for (const shiftId in record.schedule) {
        const slot = record.schedule[shiftId];
        if (slot?.patientId && this.patientMap.has(slot.patientId)) {
          const patient = this.patientMap.get(slot.patientId);
          slot.autoNote = patient ? generateAutoNote(patient) : '';
        }
      }
    }
    return record;
  }

  async loadData(date: Date): Promise<void> {
    this.hasUnsavedScheduleChanges = false;
    this.hasUnsavedTeamChanges = false;
    this.statusIndicator = '讀取中...';
    this.isLoading = true;
    const dateStr = this.formatDate(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const targetDate = new Date(date);
    targetDate.setHours(0, 0, 0, 0);

    try {
      const isPastDate = targetDate < today;
      if (!isPastDate) {
        await this.patientStore.fetchPatientsIfNeeded();
      }

      const scheduleRecord = isPastDate
        ? await this.fetchArchivedSchedule(dateStr)
        : await this.fetchLiveSchedule(dateStr);

      const teamsData = await fetchTeamsByDate(dateStr);

      Object.assign(this.currentRecord, scheduleRecord);
      this.currentTeamsRecord = teamsData || { id: null, date: dateStr, teams: {}, names: {} };

      // Note: Orders are NOT eagerly fetched here to avoid N individual Firestore queries.
      // They will be fetched lazily when a dialog that needs them is opened.

      if (this.currentRecord.schedule) {
        for (const shiftId in this.currentRecord.schedule) {
          const slot = this.currentRecord.schedule[shiftId];
          if (!slot || !slot.patientId) continue;
          const shiftCode = shiftId.split('-')[2];
          const teamKey = `${slot.patientId}-${shiftCode}`;
          const teamInfo = this.currentTeamsRecord.teams[teamKey];
          if (teamInfo) {
            Object.assign(slot, teamInfo);
          }
        }
      }

      this.updateStatsCache();
      this.statusIndicator = this.currentRecord.id ? '資料已載入' : '本日無排班資料';
    } catch (error) {
      console.error('讀取報表資料失敗:', error);
      this.statusIndicator = '讀取失敗';
    } finally {
      this.isLoading = false;
    }
  }

  getArchivedOrLivePatientInfo(slotData: any): any {
    if (!slotData || !slotData.patientId) return null;
    if (slotData.archivedPatientInfo) {
      return slotData.archivedPatientInfo;
    }
    return this.patientMap.get(slotData.patientId) || null;
  }

  // --- Save ---

  private setScheduleChange(): void {
    if (this.isPageLocked) return;
    this.hasUnsavedScheduleChanges = true;
    this.statusIndicator = '有未儲存的變更';
    this.updateStatsCache();
  }

  private setTeamChange(): void {
    if (this.isPageLocked) return;
    this.hasUnsavedTeamChanges = true;
    this.statusIndicator = '有未儲存的變更';
    this.updateStatsCache();
  }

  async saveChangesToCloud(): Promise<void> {
    if (this.isPageLocked || !this.hasUnsavedChanges) return;
    this.statusIndicator = '儲存中...';
    try {
      const scheduleDirty = this.hasUnsavedScheduleChanges;
      const teamsDirty = this.hasUnsavedTeamChanges;

      // 護理分組頁面的跨班次拖放會同時改動 schedule 與 teams，
      // 以原子性 endpoint 儲存避免其中一個成功另一個失敗導致 UI/DB 不一致。
      if (scheduleDirty && teamsDirty) {
        const scheduleToSave = this.buildCleanScheduleForSave();
        const result = await saveScheduleWithTeams(this.currentRecord.date, {
          schedule: scheduleToSave,
          teams: this.currentTeamsRecord.teams || {},
          names: this.currentTeamsRecord.names || {},
        });
        if (result.schedule?.id) this.currentRecord.id = result.schedule.id;
        if (result.teams && !this.currentTeamsRecord.id) {
          this.currentTeamsRecord.id = this.currentRecord.date;
        }
      } else if (scheduleDirty) {
        const scheduleToSave = this.buildCleanScheduleForSave();
        const scheduleData = { date: this.currentRecord.date, schedule: scheduleToSave };
        if (this.currentRecord.id) {
          await this.schedulesApi.update(this.currentRecord.id, scheduleData);
        } else if (Object.keys(scheduleData.schedule).length > 0) {
          const saved: any = await this.schedulesApi.save(scheduleData);
          this.currentRecord.id = saved.id;
        }
      } else if (teamsDirty) {
        const teamsData = {
          date: this.currentTeamsRecord.date,
          teams: this.currentTeamsRecord.teams || {},
          names: this.currentTeamsRecord.names || {},
        };
        if (this.currentTeamsRecord.id) {
          await updateTeams(this.currentTeamsRecord.id, teamsData);
        } else {
          const saved: any = await saveTeams(teamsData);
          this.currentTeamsRecord.id = saved.id;
        }
      }

      this.hasUnsavedScheduleChanges = false;
      this.hasUnsavedTeamChanges = false;
      this.statusIndicator = '變更已儲存！';
      const message = `修改護理分組: ${this.currentRecord.date}`;
      this.notificationService.createGlobalNotification(message, 'team');
      this.showAlert('操作成功', '變更儲存成功！');
      await this.loadData(this.currentDate);
    } catch (error: any) {
      console.error('儲存變更失敗:', error);
      this.statusIndicator = '儲存失敗';
      this.showAlert('儲存失敗', `儲存失敗: ${error.message}`);
    }
  }

  /** 儲存前清掉畫面用的臨時欄位（nurseTeam 等會由 nurse_assignments 表承載） */
  private buildCleanScheduleForSave(): Record<string, any> {
    const clean = JSON.parse(JSON.stringify(this.currentRecord.schedule));
    for (const key in clean) {
      delete clean[key].nurseTeam;
      delete clean[key].nurseTeamIn;
      delete clean[key].nurseTeamOut;
      delete clean[key].nurseTeamTakeOff;
      delete clean[key].autoNote;
    }
    return clean;
  }

  // --- Drag and Drop ---

  onDragStart(event: DragEvent, patientDetail: any, responsibility: string): void {
    if (this.isPageLocked) {
      event.preventDefault();
      return;
    }
    const detailWithSource = { ...patientDetail, sourceResponsibility: responsibility };
    event.dataTransfer?.setData('application/json', JSON.stringify(detailWithSource));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  onDrop(event: DragEvent, newTeam: string, newResponsibility: string): void {
    if (this.isPageLocked) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement)?.classList.remove('drag-over-active');
    const data = event.dataTransfer?.getData('application/json');
    if (!data) return;
    const patientDetail = JSON.parse(data);
    const oldShiftId = patientDetail.shiftId;
    if (!oldShiftId || !this.currentRecord.schedule[oldShiftId]) return;

    const oldShiftCode = oldShiftId.split('-')[2];
    const newShiftCode =
      newResponsibility === 'earlyShift'
        ? SHIFT_CODES.EARLY
        : newResponsibility === 'lateShift' || newResponsibility === 'lateShiftTakeOff'
          ? SHIFT_CODES.LATE
          : SHIFT_CODES.NOON;

    if (newShiftCode !== oldShiftCode) {
      // 勿動病人不可換班：在此統一擋下所有換班路徑（含未來日期轉調班申請的路徑），
      // 避免繞過 applyTeamAndScheduleChange/openBedChangeDialog 內既有的鎖定檢查
      const locked = this.getLockedPatient(patientDetail.id);
      if (locked) {
        this.showAlert('操作被鎖定', this.doNotMoveMessage(locked));
        return;
      }
      const shiftIdParts = oldShiftId.split('-');
      const newShiftId = `${shiftIdParts[0]}-${shiftIdParts[1]}-${newShiftCode}`;
      // 非當日換班 → 轉為調班申請（待組長於調班視窗確認後送出）
      if (this.isFutureViewDate()) {
        const targetBed = this.currentRecord.schedule[newShiftId] ? null : this.extractBedNum(oldShiftId);
        this.openExceptionForMove(patientDetail, oldShiftId, oldShiftCode, newShiftCode, targetBed);
        return;
      }
      if (this.currentRecord.schedule[newShiftId]) {
        this.pendingChangeInfo = { patientDetail, newTeam, newResponsibility };
        this.bedChangeTargetShift = newShiftCode;
        this.openBedChangeDialog(patientDetail);
      } else {
        this.applyTeamAndScheduleChange(patientDetail, oldShiftId, newShiftId, newTeam, newResponsibility);
      }
    } else {
      // 同班同床、僅換組別 → 直接套用（當日/未來皆可）
      this.performTeamChange(patientDetail, newTeam, newResponsibility);
    }
  }

  onDragOver(event: DragEvent): void {
    if (this.isPageLocked) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement)?.classList.add('drag-over-active');
  }

  onDragLeave(event: DragEvent): void {
    (event.currentTarget as HTMLElement)?.classList.remove('drag-over-active');
  }

  private applyTeamAndScheduleChange(
    patientDetail: any,
    oldShiftId: string,
    newShiftId: string,
    newTeam: string,
    newResponsibility: string,
  ): void {
    const locked = this.getLockedPatient(patientDetail.id);
    if (locked) {
      this.showAlert('操作被鎖定', this.doNotMoveMessage(locked));
      return;
    }
    const movingSlotData = { ...this.currentRecord.schedule[oldShiftId] };
    delete this.currentRecord.schedule[oldShiftId];
    this.currentRecord.schedule[newShiftId] = movingSlotData;
    this.setScheduleChange();

    const patientId = patientDetail.id;
    const oldShiftCode = oldShiftId.split('-')[2];
    const oldTeamKey = `${patientId}-${oldShiftCode}`;
    if (this.currentTeamsRecord.teams && this.currentTeamsRecord.teams[oldTeamKey]) {
      const sourceResp = patientDetail.sourceResponsibility;
      if (sourceResp === 'earlyShift' || sourceResp === 'lateShift') {
        delete this.currentTeamsRecord.teams[oldTeamKey].nurseTeam;
      }
      if (sourceResp === 'noonShiftOn') delete this.currentTeamsRecord.teams[oldTeamKey].nurseTeamIn;
      if (sourceResp === 'noonShiftOff') delete this.currentTeamsRecord.teams[oldTeamKey].nurseTeamOut;
      if (sourceResp === 'lateShiftTakeOff') delete this.currentTeamsRecord.teams[oldTeamKey].nurseTeamTakeOff;
      if (Object.keys(this.currentTeamsRecord.teams[oldTeamKey]).length === 0) {
        delete this.currentTeamsRecord.teams[oldTeamKey];
      }
    }

    const newShiftCode = newShiftId.split('-')[2];
    const newTeamKey = `${patientId}-${newShiftCode}`;
    if (!this.currentTeamsRecord.teams) this.currentTeamsRecord.teams = {};
    if (!this.currentTeamsRecord.teams[newTeamKey]) {
      this.currentTeamsRecord.teams[newTeamKey] = {};
    }
    this.performTeamChange({ ...patientDetail, shiftId: newShiftId }, newTeam, newResponsibility);
    this.updateStatsCache();
  }

  private performTeamChange(patientDetail: any, newTeam: string, newResponsibility: string): void {
    const patientId = patientDetail.id;
    const shiftId = patientDetail.shiftId;
    const shiftCode = shiftId.split('-')[2];
    const teamKey = `${patientId}-${shiftCode}`;
    if (!this.currentTeamsRecord.teams) this.currentTeamsRecord.teams = {};
    if (!this.currentTeamsRecord.teams[teamKey]) {
      this.currentTeamsRecord.teams[teamKey] = {};
    }
    const teamInfo = this.currentTeamsRecord.teams[teamKey];
    const slotInfo = this.currentRecord.schedule[shiftId];
    if (!slotInfo) return;

    const isUnassigned = newTeam.includes('未分組');
    const finalTeamValue = isUnassigned ? null : newTeam;

    if (newResponsibility === 'earlyShift' || newResponsibility === 'lateShift') {
      teamInfo.nurseTeam = finalTeamValue;
      slotInfo.nurseTeam = finalTeamValue;
    } else if (newResponsibility === 'noonShiftOn') {
      teamInfo.nurseTeamIn = finalTeamValue;
      slotInfo.nurseTeamIn = finalTeamValue;
    } else if (newResponsibility === 'noonShiftOff') {
      teamInfo.nurseTeamOut = finalTeamValue;
      slotInfo.nurseTeamOut = finalTeamValue;
    } else if (newResponsibility === 'lateShiftTakeOff') {
      teamInfo.nurseTeamTakeOff = finalTeamValue;
      slotInfo.nurseTeamTakeOff = finalTeamValue;
    }

    if (!teamInfo.nurseTeam && !teamInfo.nurseTeamIn && !teamInfo.nurseTeamOut && !teamInfo.nurseTeamTakeOff) {
      delete this.currentTeamsRecord.teams[teamKey];
    }
    this.setTeamChange();
  }

  // --- Bed Change Dialog ---

  openBedChangeDialog(patientDetail: any): void {
    if (this.isPageLocked) return;
    const currentShiftCode = patientDetail.shiftId?.split('-')[2];
    const locked = this.getLockedPatient(patientDetail.id);
    // 勿動病人：禁止「換班」(跨班別)，但允許「換床」(同班別)。
    // 跨班別只可能由拖放路徑帶入 bedChangeTargetShift（且已於 onDrop 先擋下），
    // 此處僅在目標班別與現行班別不同時再保險擋一次；同班換床／未來同班調班申請放行。
    if (locked && this.bedChangeTargetShift && this.bedChangeTargetShift !== currentShiftCode) {
      // 清掉拖放路徑可能已預設的待處理狀態，避免殘留影響下次操作
      this.pendingChangeInfo = null;
      this.bedChangeTargetShift = null;
      this.showAlert('操作被鎖定', this.doNotMoveMessage(locked));
      return;
    }
    // 非當日換床 → 轉為調班申請（目標床位由組長於調班視窗挑選）
    if (this.isFutureViewDate()) {
      const shiftCode = patientDetail.shiftId.split('-')[2];
      this.openExceptionForMove(patientDetail, patientDetail.shiftId, shiftCode, shiftCode, null);
      return;
    }
    if (!this.bedChangeTargetShift) {
      this.bedChangeTargetShift = currentShiftCode;
    }
    this.editingPatientInfo = patientDetail;
    this.isBedChangeDialogVisible = true;
  }

  /** 檢視日期是否為「未來」(明天以後)；沿用元件本身的本地時間慣例 */
  private isFutureViewDate(): boolean {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(this.currentDate);
    target.setHours(0, 0, 0, 0);
    return target.getTime() > today.getTime();
  }

  /** 由 shiftId (bed-1-early / peripheral-1-early) 取出 bedNum (1 / peripheral-1) */
  private extractBedNum(shiftId: string): string {
    const parts = shiftId.split('-');
    const bedPart = parts.slice(0, -1).join('-');
    return bedPart.startsWith('bed-') ? bedPart.slice(4) : bedPart;
  }

  /**
   * 非當日換班/換床：預填 MOVE 調班申請並開啟調班視窗（待組長確認後送出，流程同新申請調班）。
   * @param toBedNum 目標床位；null 表示由組長於視窗內挑選
   */
  private openExceptionForMove(
    patientDetail: any,
    fromShiftId: string,
    fromShiftCode: string,
    toShiftCode: string,
    toBedNum: string | null,
  ): void {
    const dateStr = this.formatDate(this.currentDate);
    const patientId = patientDetail.id;
    const patient = this.allPatients.find((p) => p.id === patientId);
    const patientName = patient?.name || patientDetail.name || '';

    this.exceptionToEdit = null;
    this.exceptionPrefill = {
      type: 'MOVE',
      patientId,
      patientName,
      from: { sourceDate: dateStr, bedNum: this.extractBedNum(fromShiftId), shiftCode: fromShiftCode },
      to: { goalDate: dateStr, bedNum: toBedNum, shiftCode: toShiftCode },
    };
    this.isExceptionDialogVisible = true;
    this.notificationService.createGlobalNotification(
      '非當日換班/換床，已轉為調班申請，請確認後送出。',
      'info' as any,
    );
  }

  /** 關閉調班視窗時一併清除預填資料，避免下次手動開啟沿用舊資料 */
  onExceptionDialogClose(): void {
    this.isExceptionDialogVisible = false;
    this.exceptionPrefill = null;
  }

  handleBedChange(event: any): void {
    const { oldShiftId, newShiftId } = event;
    if (this.isPageLocked || !oldShiftId || !newShiftId || !this.currentRecord.schedule[oldShiftId]) {
      this.isBedChangeDialogVisible = false;
      return;
    }
    if (this.pendingChangeInfo) {
      const { patientDetail, newTeam, newResponsibility } = this.pendingChangeInfo;
      this.applyTeamAndScheduleChange(patientDetail, oldShiftId, newShiftId, newTeam, newResponsibility);
    } else {
      const movingSlotData = { ...this.currentRecord.schedule[oldShiftId] };
      delete this.currentRecord.schedule[oldShiftId];
      this.currentRecord.schedule[newShiftId] = movingSlotData;
      this.setScheduleChange();
    }
    this.isBedChangeDialogVisible = false;
    this.pendingChangeInfo = null;
    this.bedChangeTargetShift = null;
  }

  handleDialogCancel(): void {
    this.isBedChangeDialogVisible = false;
    this.pendingChangeInfo = null;
    this.bedChangeTargetShift = null;
  }

  // --- Prep Popover ---

  async showPrepPopover(event: MouseEvent, teamData: any, shiftType: string): Promise<void> {
    const patientsInShift = teamData[shiftType]?.patients || [];
    if (patientsInShift.length === 0) return;
    // 先以現行醫囑顯示，再依「選取日期」抓對應生效日的醫囑覆蓋（無歷史者維持現行）
    this.prepPopoverData.patients = patientsInShift;
    this.prepPopoverData.targetElement = event.currentTarget;
    this.isPrepPopoverVisible = true;

    try {
      const dateStr = this.formatDate(this.currentDate);
      const effective = await fetchEffectiveOrders(
        patientsInShift.map((p: any) => p.id),
        dateStr,
      );
      this.prepPopoverData.patients = patientsInShift.map((p: any) =>
        effective[p.id] ? { ...p, dialysisOrders: effective[p.id] } : p,
      );
    } catch (error) {
      console.error('[StatsView] 取備物清單生效醫囑失敗:', error);
    }
  }

  onPrepPopoverClose(): void {
    this.isPrepPopoverVisible = false;
  }

  // --- Injection List ---

  async refreshInjections(): Promise<void> {
    this.medicationStore.clearCache();
    if (this.lastInjectionTeamData) {
      await this.showInjectionList(this.lastInjectionTeamData, this.lastInjectionShiftType);
    }
  }

  async showInjectionList(teamData: any, shiftType: string | null = null): Promise<void> {
    this.lastInjectionTeamData = teamData;
    this.lastInjectionShiftType = shiftType;
    // Build patientId → {shift, bedNum} map from teamData patients
    const patientInfoMap = new Map<string, { shift: string; bedNum: string }>();
    const patientIdsToFetch = new Set<string>();
    if (shiftType && teamData[shiftType] && Array.isArray(teamData[shiftType].patients)) {
      teamData[shiftType].patients.forEach((p: any) => {
        patientIdsToFetch.add(p.id);
        patientInfoMap.set(p.id, {
          shift: p.shiftCode || shiftType.replace('Shift', '').replace('On', '').replace('Off', '') || '',
          bedNum: p.dialysisBed || '',
        });
      });
    } else {
      for (const key in teamData) {
        if (teamData[key] && Array.isArray(teamData[key].patients)) {
          teamData[key].patients.forEach((p: any) => {
            patientIdsToFetch.add(p.id);
            if (!patientInfoMap.has(p.id)) {
              patientInfoMap.set(p.id, {
                shift: p.shiftCode || '',
                bedNum: p.dialysisBed || '',
              });
            }
          });
        }
      }
    }
    const patientIdArray = Array.from(patientIdsToFetch);

    this.isInjectionDialogVisible = true;
    this.isInjectionLoading = true;
    this.dailyInjections = [];

    if (patientIdArray.length === 0) {
      this.isInjectionLoading = false;
      return;
    }

    const targetDate = this.formatDate(this.currentDate);
    try {
      const injectionsForGroup = await this.medicationStore.fetchDailyInjections(targetDate, patientIdArray);
      // Enrich with shift/bed info from teamData
      const enriched = injectionsForGroup.map((inj: any) => {
        const info = patientInfoMap.get(inj.patientId);
        return {
          ...inj,
          shift: info?.shift || '',
          bedNum: info?.bedNum || '',
        };
      });
      // Sort by bed number
      enriched.sort((a: any, b: any) => {
        const bedA = String(a.bedNum).startsWith('外') ? 1000 + parseInt(String(a.bedNum).substring(1)) : parseInt(a.bedNum) || 999;
        const bedB = String(b.bedNum).startsWith('外') ? 1000 + parseInt(String(b.bedNum).substring(1)) : parseInt(b.bedNum) || 999;
        if (bedA !== bedB) return bedA - bedB;
        return (a.patientName || '').localeCompare(b.patientName || '');
      });
      this.dailyInjections = enriched;
    } catch (error: any) {
      console.error('[StatsView] 獲取應打針劑失敗:', error);
      this.showAlert('查詢失敗', `獲取應打針劑清單時發生錯誤: ${error.message}`);
      this.isInjectionDialogVisible = false;
    } finally {
      this.isInjectionLoading = this.medicationStore.isLoading();
    }
  }

  // --- Navigation ---

  changeDate(days: number): void {
    const performChange = () => {
      const newDate = new Date(this.currentDate);
      newDate.setDate(newDate.getDate() + days);
      this.currentDate = newDate;
      this.dateState.setDate(newDate.toISOString());
      this.onDateChanged();
    };
    if (this.hasUnsavedChanges && !this.isPageLocked) {
      this.confirmDialogMessage = '您有未儲存的變更，確定要切換日期嗎？';
      this.onConfirmAction = performChange;
      this.isConfirmDialogVisible = true;
    } else {
      performChange();
    }
  }

  goToToday(): void {
    const performChange = () => {
      const today = new Date();
      this.currentDate = today;
      this.dateState.setDate(today.toISOString());
      this.onDateChanged();
    };
    if (this.hasUnsavedChanges && !this.isPageLocked) {
      this.confirmDialogMessage = '您有未儲存的變更，確定要切換到今天嗎？';
      this.onConfirmAction = performChange;
      this.isConfirmDialogVisible = true;
    } else {
      performChange();
    }
  }

  @ViewChild('datePickerInput') datePickerInput?: ElementRef<HTMLInputElement>;

  openDatePicker(): void {
    const el = this.datePickerInput?.nativeElement;
    if (!el) return;
    const anyEl = el as any;
    if (typeof anyEl.showPicker === 'function') {
      try {
        anyEl.showPicker();
        return;
      } catch {
        // 部分瀏覽器無使用者手勢時會 throw，退回 click()
      }
    }
    el.click();
  }

  onDatePicked(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (!value) return;
    const performChange = () => {
      const newDate = new Date(`${value}T00:00:00`);
      this.currentDate = newDate;
      this.dateState.setDate(newDate.toISOString());
      this.onDateChanged();
    };
    if (this.hasUnsavedChanges && !this.isPageLocked) {
      this.confirmDialogMessage = '您有未儲存的變更，確定要切換日期嗎？';
      this.onConfirmAction = performChange;
      this.isConfirmDialogVisible = true;
    } else {
      performChange();
    }
  }

  private onDateChanged(): void {
    this.medicationStore.clearCache();
    this.noonTakeoffVisibility = { early: false, late: false };
    this.loadData(this.currentDate);
    this.loadDailyStaffInfo(this.currentDate);
  }

  // --- Dialogs ---

  handleConfirm(): void {
    if (this.onConfirmAction) this.onConfirmAction();
    this.isConfirmDialogVisible = false;
    this.onConfirmAction = null;
  }

  handleCancel(): void {
    this.isConfirmDialogVisible = false;
    this.onConfirmAction = null;
  }

  showAlert(title: string, message: string): void {
    this.alertDialogTitle = title;
    this.alertDialogMessage = message;
    this.isAlertDialogVisible = true;
  }


  handleTaskCreated(): void {
    this.showAlert('操作成功', '交辦/留言已成功新增！');
    this.isCreateTaskModalVisible = false;
  }

  handleIconClick(event: any): void {
    const { patientId, context, type } = event;
    if (context === 'dialog') {
      const patient = this.patientMap.get(patientId);
      if (patient) {
        this.selectedPatientForDialog = { id: patientId, name: patient.name };
        if (type === 'record') {
          this.isConditionRecordDialogVisible = true;
        } else {
          // 決定留言視窗內是否顯示「衛教紀錄」按鈕：
          // 點的就是衛教圖示(type==='衛教')→ 一定顯示；否則看病人是否仍為初透。
          // （不依訊息數量；避免初透旗標事後關閉、但仍有衛教留言時按鈕消失）
          const full = this.allPatients.find((p) => p.id === patientId);
          this.selectedPatientIsFirstDialysis =
            type === '衛教' || !!full?.patientStatus?.isFirstDialysis?.active;
          this.isMemoDialogVisible = true;
        }
      }
    }
  }

  openEducationFromMemo(): void {
    if (!this.selectedPatientForDialog?.id) return;
    this.educationPatient = {
      id: this.selectedPatientForDialog.id,
      name: this.selectedPatientForDialog.name || '',
    };
    this.isMemoDialogVisible = false;
    this.showEducationDialog = true;
  }

  closeEducationDialog(): void {
    this.showEducationDialog = false;
    this.educationPatient = null;
  }

  closeMemoDialog(): void {
    this.isMemoDialogVisible = false;
    this.selectedPatientForDialog = null;
  }

  closeConditionRecordDialog(): void {
    this.isConditionRecordDialogVisible = false;
    this.selectedPatientForDialog = null;
  }

  // --- Order Modal ---

  async handleSaveOrder(orderData: any): Promise<void> {
    if (this.isPageLocked) {
      this.showAlert('操作失敗', '操作被鎖定：權限不足。');
      return;
    }
    if (!this.editingPatientForOrder?.id) {
      this.showAlert('儲存失敗', '找不到有效的病人資訊。');
      return;
    }
    const patientId = this.editingPatientForOrder.id;
    const patientName = this.editingPatientForOrder.name;
    try {
      await createDialysisOrderAndUpdatePatient(patientId, patientName, orderData);
      await this.loadData(this.currentDate);
      this.isOrderModalVisible = false;
      this.notificationService.createGlobalNotification(`更新醫囑：${patientName}`, 'team');
      this.showAlert('儲存成功', `已成功更新 ${patientName} 的透析醫囑。`);
    } catch (error: any) {
      console.error('儲存醫囑失敗:', error);
      this.showAlert('操作失敗', `儲存醫囑時發生錯誤: ${error.message}`);
    }
  }

  openOrderModalFromPopover(patient: any): void {
    if (patient && patient.id) {
      this.onPrepPopoverClose();
      this.editingPatientForOrder = patient;
      this.isOrderModalVisible = true;
    }
  }

  // --- Late Shift TakeOff ---

  promptDuplicateLateShift(): void {
    if (this.isPageLocked) return;
    this.confirmDialogMessage =
      '您確定要為夜班建立一個獨立的「收針」分組嗎？\n這將會複製目前的夜班病人分配，讓您可以單獨調整。';
    this.onConfirmAction = () => this.duplicateLateShiftForTakeOff();
    this.isConfirmDialogVisible = true;
  }

  private duplicateLateShiftForTakeOff(): void {
    if (this.isPageLocked) return;
    for (const shiftId in this.currentRecord.schedule) {
      const slot = this.currentRecord.schedule[shiftId];
      if (!slot) continue;
      const shiftCode = shiftId.split('-')[2];
      if (shiftCode === SHIFT_CODES.LATE && slot.patientId) {
        const teamKey = `${slot.patientId}-${shiftCode}`;
        if (!this.currentTeamsRecord.teams) this.currentTeamsRecord.teams = {};
        const teamInfo = this.currentTeamsRecord.teams[teamKey] || {};
        if (teamInfo.nurseTeam) {
          const newTeamName = teamInfo.nurseTeam.replace('晚', '夜間收針');
          teamInfo.nurseTeamTakeOff = newTeamName;
          slot.nurseTeamTakeOff = newTeamName;
        }
        this.currentTeamsRecord.teams[teamKey] = teamInfo;
      }
    }
    if (this.currentTeamsRecord.names) {
      for (const teamName in this.currentTeamsRecord.names) {
        if (teamName.startsWith('晚')) {
          const nurseName = this.currentTeamsRecord.names[teamName];
          if (nurseName) {
            const newTakeOffTeamName = teamName.replace('晚', '夜間收針');
            this.currentTeamsRecord.names[newTakeOffTeamName] = nurseName;
          }
        }
      }
    }
    this.setTeamChange();
    this.showAlert('操作成功', '夜班收針分組已建立，您可以開始調整。');
  }

  promptRemoveLateShiftTakeOff(): void {
    if (this.isPageLocked) return;
    this.confirmDialogMessage =
      '您確定要移除「夜班收針」分組嗎？\n所有相關的收針分配將會被永久刪除，此操作無法復原。';
    this.onConfirmAction = () => this.removeLateShiftTakeOff();
    this.isConfirmDialogVisible = true;
  }

  private removeLateShiftTakeOff(): void {
    if (this.isPageLocked) return;
    for (const shiftId in this.currentRecord.schedule) {
      const slot = this.currentRecord.schedule[shiftId];
      if (slot && typeof slot.nurseTeamTakeOff !== 'undefined') {
        delete slot.nurseTeamTakeOff;
      }
    }
    if (this.currentTeamsRecord.teams) {
      for (const teamKey in this.currentTeamsRecord.teams) {
        const teamInfo = this.currentTeamsRecord.teams[teamKey];
        if (teamInfo && typeof teamInfo.nurseTeamTakeOff !== 'undefined') {
          delete teamInfo.nurseTeamTakeOff;
          if (Object.keys(teamInfo).length === 0) {
            delete this.currentTeamsRecord.teams[teamKey];
          }
        }
      }
    }
    if (this.currentTeamsRecord.names) {
      for (const teamName in this.currentTeamsRecord.names) {
        if (teamName.startsWith('夜間收針')) {
          delete this.currentTeamsRecord.names[teamName];
        }
      }
    }
    this.setTeamChange();
    this.showAlert('操作成功', '夜班收針分組已移除。請記得儲存變更。');
  }

  // --- Exception / Scheduler ---

  // --- 護理分組歷史快照 / 還原 ---

  async openHistoryDialog(): Promise<void> {
    this.isHistoryDialogVisible = true;
    this.historyLoading = true;
    this.historyRevisions = [];
    try {
      this.historyRevisions = await fetchNurseAssignmentRevisions(this.currentRecord.date);
    } catch (error: any) {
      this.showAlert('讀取失敗', `無法取得歷史快照: ${error?.message || error}`);
    } finally {
      this.historyLoading = false;
    }
  }

  snapshotTypeLabel(type: string): string {
    const map: Record<string, string> = {
      hourly: '自動 (每小時)',
      pre_save: '存檔前',
      pre_restore: '還原前',
      manual: '手動',
    };
    return map[type] || type;
  }

  confirmRestoreRevision(rev: any): void {
    this.confirmDialogMessage = `確定要把 ${this.currentRecord.date} 的護理分組還原到「${rev.createdAt}」(${this.snapshotTypeLabel(rev.snapshotType)}) 這個版本嗎？\n\n還原前會自動保留目前版本，可再還原回來。`;
    this.onConfirmAction = () => this.doRestoreRevision(rev);
    this.isConfirmDialogVisible = true;
  }

  private async doRestoreRevision(rev: any): Promise<void> {
    try {
      await restoreNurseAssignmentRevision(this.currentRecord.date, rev.id);
      this.isHistoryDialogVisible = false;
      await this.loadData(this.currentDate);
      this.showAlert('還原成功', `已還原至「${rev.createdAt}」的版本。`);
    } catch (error: any) {
      this.showAlert('還原失敗', `還原失敗: ${error?.message || error}`);
    }
  }

  async handleCreateException(formData: any): Promise<void> {
    try {
      const exceptionsApi = this.apiManager.create<FirestoreRecord>('schedule_exceptions');
      const dataToSave: any = {
        patientId: formData.patientId,
        patientName: formData.patientName,
        type: formData.type,
        reason: formData.reason,
        startDate: formData.startDate,
        endDate: formData.endDate,
        from: formData.from,
        to: formData.to,
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
      if (formData.type === 'SWAP') {
        dataToSave.date = formData.date;
        dataToSave.patient1 = formData.patient1;
        dataToSave.patient2 = formData.patient2;
      }
      const resp: any = await exceptionsApi.save(dataToSave);
      this.isExceptionDialogVisible = false;
      this.exceptionPrefill = null;
      // 後端對單日換床會自動整併（同病人合併 / 互換收斂 / 拖回原位取消），依結果提示
      const actionMsgMap: Record<string, string> = {
        merged: `已整併 ${formData.patientName} 本日調班為最新床位`,
        swapped: `偵測到互換，已整併為一筆對調：${formData.patientName}`,
        cancelled: `${formData.patientName} 已回到常規床位，原調班已取消`,
        created: `成功新增調班申請: ${formData.patientName}`,
      };
      const msg = actionMsgMap[resp?.action] || `成功新增調班申請: ${formData.patientName}`;
      this.notificationService.createGlobalNotification(msg, 'success' as any);
    } catch (error: any) {
      console.error('提交調班申請失敗:', error);
      this.showAlert('提交失敗', `無法儲存調班申請: ${error.message}`);
    }
  }

  handleNewUpdateTypeSelected(event: any): void {
    this.patientForScheduler = event.patient;
    this.changeTypeForScheduler = event.changeType;
    this.isNewUpdateTypeDialogVisible = false;
    setTimeout(() => {
      this.isSchedulerDialogVisible = true;
    }, 150);
  }

  async handleScheduledUpdate(dataToSubmit: any): Promise<void> {
    this.isSchedulerDialogVisible = false;
    try {
      const scheduledUpdatesApi = this.apiManager.create<FirestoreRecord>('scheduled_patient_updates');
      await scheduledUpdatesApi.create(dataToSubmit);
      this.notificationService.createGlobalNotification('預約成功！變更將在指定日期自動生效。', 'success' as any);
    } catch (error: any) {
      console.error('提交預約失敗:', error);
      this.showAlert('提交失敗', `無法儲存預約變更: ${error.message}`);
    }
  }

  // --- Excel Export ---

  exportAssignmentsToExcel(): void {
    if (this.isLoading) {
      this.showAlert('提示', '資料仍在載入中，請稍後再試。');
      return;
    }
    const aoa: any[][] = [];
    const data = this.effectiveStatsData;

    const formatPatientCell = (patients: any[]) => {
      if (!patients || patients.length === 0) return '';
      return patients.map(p => {
        const parts = [`${p.dialysisBed} - ${p.name}`];
        if (p.finalTags) parts.push(`(${p.finalTags})`);
        return parts.join(' ');
      }).join('\n');
    };

    // Early shift
    const earlyHeaders = ['早班', ...this.sortedEarlyTeams.map(name =>
      name.includes('未分組') ? '未分組' : name.replace('早', '') + '組')];
    aoa.push(earlyHeaders);
    aoa.push(['姓名', ...this.sortedEarlyTeams.map(name => data.early[name]?.nurseName || '-- 未指派 --')]);
    aoa.push(['早班', ...this.sortedEarlyTeams.map(name => formatPatientCell(data.early[name]?.earlyShift.patients))]);
    aoa.push(['午班(上針)', ...this.sortedEarlyTeams.map(name => formatPatientCell(data.early[name]?.noonShiftOn.patients))]);
    aoa.push(['午班(收針)', ...this.sortedEarlyTeams.map(name => formatPatientCell(data.early[name]?.noonShiftOff.patients))]);
    aoa.push([]);

    // Late shift
    const lateHeaders = ['晚班', ...this.sortedLateTeams.map(name =>
      name.includes('未分組') ? '未分組' : name.replace('晚', '') + '組')];
    aoa.push(lateHeaders);
    aoa.push(['姓名', ...this.sortedLateTeams.map(name => data.late[name]?.nurseName || '-- 未指派 --')]);
    aoa.push(['午班(收針)', ...this.sortedLateTeams.map(name => formatPatientCell(data.late[name]?.noonShiftOff.patients))]);
    aoa.push(['晚班', ...this.sortedLateTeams.map(name => formatPatientCell(data.late[name]?.lateShift.patients))]);

    // Late takeoff
    if (this.lateShiftTakeOffExists) {
      aoa.push([]);
      const ltHeaders = ['夜班收針', ...this.sortedLateTakeOffTeams.map(name =>
        name.includes('未分組') ? '未分組' : name.replace('夜間收針', '') + '組')];
      aoa.push(ltHeaders);
      aoa.push(['姓名', ...this.sortedLateTakeOffTeams.map(name => data.lateTakeOff[name]?.nurseName || '-- 未指派 --')]);
      aoa.push(['夜班收針', ...this.sortedLateTakeOffTeams.map(name => formatPatientCell(data.lateTakeOff[name]?.lateShiftTakeOff.patients))]);
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const colWidths: any[] = [{ wch: 12 }];
    for (let i = 1; i < earlyHeaders.length; i++) {
      colWidths.push({ wch: 25 });
    }
    ws['!cols'] = colWidths;

    const rowHeights: any[] = [];
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    for (let R = range.s.r; R <= range.e.r; ++R) {
      let maxLines = 1;
      for (let C = range.s.c; C <= range.e.c; ++C) {
        const cell_ref = XLSX.utils.encode_cell({ c: C, r: R });
        if (ws[cell_ref] && ws[cell_ref].v) {
          const cellValue = String(ws[cell_ref].v);
          const lines = cellValue.split('\n').length;
          if (lines > maxLines) maxLines = lines;
          ws[cell_ref].s = { alignment: { wrapText: true, vertical: 'top' } };
        }
      }
      rowHeights.push(maxLines > 1 ? { hpt: maxLines * 15 } : { hpt: 20 });
    }
    ws['!rows'] = rowHeights;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '護理分組表');
    const fileName = `護理分組表_${this.formatDate(this.currentDate)}.xlsx`;
    XLSX.writeFile(wb, fileName);
  }
}
