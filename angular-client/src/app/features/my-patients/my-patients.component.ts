// Standalone 版：已移除 Firebase
import {
  Component,
  inject,
  signal,
  computed,
  effect,
  untracked,
  OnInit,
  OnDestroy,
  ViewChild,
  ElementRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '@app/core/services/api.service';
import { ApiConfigService } from '@services/api-config.service';
import { AuthService, type AppUser } from '@services/auth.service';
import { PatientStoreService } from '@services/patient-store.service';
import { NotificationService } from '@services/notification.service';
import { TaskStoreService } from '@services/task-store.service';
import { UserDirectoryService } from '@services/user-directory.service';
import { ArchiveStoreService } from '@services/archive-store.service';
import { MedicationStoreService } from '@services/medication-store.service';
import {
  ApiManagerService,
  type ApiManager,
  type FirestoreRecord,
} from '@services/api-manager.service';
import { formatDateToYYYYMMDD, getTaipeiWeekdayIndex } from '@/utils/dateUtils';
import { resolveDailyRotationValue, getUnifiedCellStyle } from '@/utils/scheduleUtils';
import { ORDERED_SHIFT_CODES, getShiftDisplayName } from '@/constants/scheduleConstants';
import { handleTaskCreated } from '@/utils/taskHandlers';
import {
  createDialysisOrderAndUpdatePatient,
  updatePatient as optimizedUpdatePatient,
} from '@/services/optimizedApiService';
import { fetchEffectiveOrders } from '@/services/effectiveOrdersService';
import { localApi } from '@/services/localApiClient';
import { kiditService } from '@/services/kiditService';

// Component Imports
import { TaskCreateDialogComponent } from '@app/components/dialogs/task-create-dialog/task-create-dialog.component';
import { ConfirmDialogComponent } from '@app/components/dialogs/confirm-dialog/confirm-dialog.component';
import { DialysisOrderModalComponent } from '@app/components/dialogs/dialysis-order-modal/dialysis-order-modal.component';
import { MarqueeBannerComponent } from '@app/components/marquee-banner/marquee-banner.component';
import { EducationRecordDialogComponent } from '@app/components/dialogs/education-record-dialog/education-record-dialog.component';
import { VascularAccessEventDialogComponent } from '@app/components/dialogs/vascular-access-event-dialog/vascular-access-event-dialog.component';
import { PatientDetailModalComponent } from '@app/components/dialogs/patient-detail-modal/patient-detail-modal.component';
import { PatientMessagesIconComponent } from '@app/components/patient-messages-icon/patient-messages-icon.component';
import { DailyRecordsSummaryDialogComponent } from '@app/components/dialogs/daily-records-summary-dialog/daily-records-summary-dialog.component';
import { DailyInjectionListDialogComponent } from '@app/components/dialogs/daily-injection-list-dialog/daily-injection-list-dialog.component';
import { IcuOrdersDialogComponent } from '@app/components/dialogs/icu-orders-dialog/icu-orders-dialog.component';
import { CrrtOrderModalComponent } from '@app/components/dialogs/crrt-order-modal/crrt-order-modal.component';
import type { VascularAccessEvent } from '@app/core/constants/vascular-access-codes';
import * as XLSX from 'xlsx';

// 臨床查閱的檢驗異常判定：沿用藥檢關聯視圖同一組參考範圍（min/max 為字面上下限）
const CLINICAL_LAB_RANGES: Record<string, { min?: number; max?: number }> = {
  Hb: { min: 8, max: 12 },
  P: { max: 5.5 },
  iPTH: { min: 150, max: 300 },
  Ca: { min: 8.6, max: 10.3 },
  Ferritin: { max: 800 },
  Albumin: { min: 3.5 },
  K: { min: 3.5, max: 5.5 },
};

/** 一項異常檢驗值（供簡表格內徽章顯示） */
interface LabAbnormal {
  key: string;
  value: number;
  direction: 'high' | 'low';
}

// 醫師臨床查閱簡表的床位配置（與 base-schedule / 書記掛號頁同一份配置）
const CLINICAL_BED_LAYOUT: number[] = [
  1, 2, 3, 5, 6, 7, 8, 9, 11, 12, 13, 15, 16, 17, 18, 19,
  21, 22, 23, 25, 26, 27, 28, 29, 31, 32, 33, 35, 36, 37, 38, 39,
  51, 52, 53, 55, 56, 57, 58, 59, 61, 62, 63, 65,
];
const CLINICAL_PERIPHERAL_COUNT = 6;

// 列印簡表僅保留的 B/C 肝相關標籤（來源同格內 note 的標籤集，與排程格線 generateAutoNotes 同一套代碼）
const HEPATITIS_PRINT_TAGS = new Set(['B', 'C', 'BC?', 'C癒']);

/** 臨床查閱簡表的一格（無病人時為 null） */
interface ClinicalCell {
  shiftId: string;
  patientId: string;
  medicalRecordNumber: string;
  name: string;
  mode: string | null;
  wardNumber: string;
  note: string;
  cellStyle: Record<string, boolean>;
  isDoNotMove: boolean;
  doNotMoveReason: string;
  messageTypes: string[];
  /** 當月檢驗異常（點格子看病人總覽可查完整報告） */
  labAbnormals: LabAbnormal[];
  /** 今日交班留言（tasks category=message） */
  handovers: string[];
  /** 列印專用：B/C 肝標籤（螢幕版顯示完整 note，列印時只印這個） */
  hepatitisTags: string;
}

interface ClinicalRow {
  bedLabel: string;
  cells: (ClinicalCell | null)[];
}

interface MedicationMaster {
  code: string;
  tradeName: string;
  unit: string;
}

interface MyPatientItem {
  id: string;
  patientId: string;
  name: string;
  bedNum: string;
  preparation: {
    ak: string;        // 完整 AK 醫囑 (病人卡片顯示用，可能含 / 輪替)
    akToday: string;   // 當天該次透析的 AK (備物數量計算用)
    dialysateCa: string;
    heparin: string;
    bloodFlow: string;
    vascAccess: string;
  };
  injections: {
    orderCode: string;
    orderName?: string;
    dose?: string;
    unit?: string;
    note?: string;
  }[];
  memos: {
    id: string;
    content: string;
    type?: string;
    targetDate?: string;
    [key: string]: unknown;
  }[];
  // 是否為「初透衛教對象」（沿用 openEduModal 同一 predicate，非主護簽核完成者），
  // 於 fetchMyPatientData 建卡時一併算好存欄位，模板不重算。
  isEduTarget?: boolean;
  // 待辦抽血留言（type='抽血'）：不列留言區，改以「需抽血」書籤呈現
  bloodMemos: { id: string; content: string }[];
}

interface SelectableUser {
  uid: string;
  name: string;
  username: string;
}

@Component({
  selector: 'app-my-patients',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TaskCreateDialogComponent,
    ConfirmDialogComponent,
    DialysisOrderModalComponent,
    MarqueeBannerComponent,
    EducationRecordDialogComponent,
    VascularAccessEventDialogComponent,
    PatientDetailModalComponent,
    PatientMessagesIconComponent,
    DailyRecordsSummaryDialogComponent,
    DailyInjectionListDialogComponent,
    IcuOrdersDialogComponent,
    CrrtOrderModalComponent,
  ],
  templateUrl: './my-patients.component.html',
  styleUrl: './my-patients.component.css',
})
export class MyPatientsComponent implements OnInit, OnDestroy {
  private readonly firebaseService = inject(ApiConfigService);
  private readonly authService = inject(AuthService);
  private readonly patientStore = inject(PatientStoreService);
  private readonly notificationService = inject(NotificationService);
  private readonly userDirectory = inject(UserDirectoryService);
  private readonly apiManagerService = inject(ApiManagerService);
  private readonly taskStore = inject(TaskStoreService);
  private readonly archiveStore = inject(ArchiveStoreService);
  private readonly medicationStore = inject(MedicationStoreService);
  private readonly router = inject(Router);
  private readonly api = inject(ApiService);

  // --- State ---
  readonly selectedUserId = signal<string | null>(null);
  readonly selectedDate = signal(formatDateToYYYYMMDD());
  readonly isLoading = signal(false);
  readonly patientListByShift = signal<Record<string, MyPatientItem[]>>({});
  readonly selectableUsers = signal<SelectableUser[]>([]);
  readonly nurseGroupLabel = signal('');
  readonly nurseGroupDuties = signal<string[]>([]);

  private readonly SELECTABLE_USERS_TTL = 10 * 60 * 1000;
  private lastSelectableUsersUpdatedAt = 0;

  // Injection medication master data
  private readonly INJECTION_MEDS_MASTER: MedicationMaster[] = [
    { code: 'INES2', tradeName: 'NESP', unit: 'mcg' },
    { code: 'IREC1', tradeName: 'Recormon', unit: 'KIU' },
    { code: 'IFER2', tradeName: 'Fe-back', unit: 'mg' },
    { code: 'ICAC', tradeName: 'Cacare', unit: 'amp' },
    { code: 'IPAR1', tradeName: 'Parsabiv', unit: 'mg' },
  ];
  private readonly injectionTradeNameMap = new Map(
    this.INJECTION_MEDS_MASTER.map((med) => [med.code, med.tradeName])
  );

  // Dialog state
  readonly isCreateModalVisible = signal(false);
  readonly editingItem = signal<any>(null);
  readonly isConfirmDeleteVisible = signal(false);
  readonly itemToDelete = signal<any>(null);
  readonly isOrderModalVisible = signal(false);
  readonly selectedPatientForOrder = signal<any>(null);

  // Computed
  readonly currentUser = computed(() => this.authService.currentUser());
  // 醫師/專師檢視：同一頁改呈現臨床查閱簡表（查房用），不做護理分組比對
  readonly isDoctorView = computed(() => {
    const title = (this.currentUser() as AppUser | null)?.title || '';
    return title === '主治醫師' || title === '專科護理師';
  });

  readonly canSwitchUser = computed(() => !!this.currentUser() && !this.isDoctorView());

  // --- 臨床查閱簡表 ---
  readonly ORDERED_SHIFT_CODES = ORDERED_SHIFT_CODES;
  readonly clinicalShiftHeaders = (ORDERED_SHIFT_CODES as string[]).map((code) =>
    getShiftDisplayName(code),
  );
  /** 當日整份排程（醫師檢視用；護理師檢視不使用） */
  readonly rawSchedule = signal<Record<string, any>>({});
  readonly copiedMrn = signal('');
  private copiedTimer: ReturnType<typeof setTimeout> | null = null;
  readonly isDetailModalVisible = signal(false);
  readonly selectedPatientForDetail = signal<Record<string, unknown> | null>(null);
  readonly sortedSlotsForModal = signal<Record<string, unknown>[]>([]);
  readonly currentPatientIndexForModal = signal(0);

  /** 當月檢驗異常：patientId → 異常項目清單 */
  readonly labAbnormalMap = signal<Map<string, LabAbnormal[]>>(new Map());
  readonly isLabLoading = signal(false);

  // 班次總覽（📋）
  readonly isRecordsSummaryDialogVisible = signal(false);
  readonly shiftCodeForDialog = signal<string | null>(null);
  readonly patientIdsForDialog = signal<string[]>([]);
  readonly patientInfoMapForDialog = signal<Record<string, Record<string, string>>>({});

  // 應打針劑（💉）
  readonly isInjectionDialogVisible = signal(false);
  readonly isInjectionLoading = signal(false);
  readonly allDailyInjections = signal<Record<string, unknown>[]>([]);
  readonly injectionDialogDate = signal('');
  readonly filterSpecificInjections = signal(false);
  readonly lastInjectionShiftCode = signal('');
  readonly filteredDailyInjections = computed(() => {
    if (!this.filterSpecificInjections()) return this.allDailyInjections();
    const specificMedCodes = ['ICAC', 'IFER2', 'IPAR1'];
    return this.allDailyInjections().filter((injection) =>
      specificMedCodes.includes(injection['orderCode'] as string),
    );
  });

  // 標題列日期導覽（比照每日排程頁：可點日期開 picker、前後一天、今天）
  @ViewChild('datePickerInput') datePickerInput?: ElementRef<HTMLInputElement>;
  readonly weekdayDisplay = computed(
    () => ['一', '二', '三', '四', '五', '六', '日'][getTaipeiWeekdayIndex(this.selectedDate())],
  );

  // ICU 醫囑單（與每日排程頁同一個彈窗；過去日期唯讀，與該頁 isHistoryView 同語意）
  readonly patientMapForIcu = this.patientStore.patientMap;
  readonly isIcuOrdersDialogVisible = signal(false);
  readonly icuEffectiveOrders = signal<Record<string, any>>({});
  readonly isIcuSaving = signal(false);
  readonly isCRRTOrderModalVisible = signal(false);
  readonly editingPatientForCRRT = signal<any>(null);
  readonly isClinicalPastDate = computed(
    () => this.selectedDate() < formatDateToYYYYMMDD(new Date()),
  );

  readonly clinicalRows = computed<ClinicalRow[]>(() => {
    const schedule = this.rawSchedule();
    if (!schedule || Object.keys(schedule).length === 0) return [];
    const pMap = this.patientStore.patientMap();
    const messageMap = this.taskStore.getPatientMessageTypesMapForDate(this.selectedDate());
    const shiftCodes = ORDERED_SHIFT_CODES as string[];
    const labMap = this.labAbnormalMap();
    const handoverMap = this.handoverMessageMap();

    const buildCell = (shiftId: string): ClinicalCell | null => {
      const slot = schedule[shiftId];
      if (!slot?.patientId) return null;
      const patient = pMap.get(slot.patientId) as Record<string, any> | undefined;
      // 快照優先（當日異動保護／歸檔），與每日排程格線同一套判讀
      const info = (slot.archivedPatientInfo || patient) as Record<string, any> | undefined;
      if (!info && !patient) return null;
      const status = String(info?.['status'] || '');
      const modeRaw = String(slot.modeOverride || info?.['mode'] || patient?.['mode'] || '');
      const autoTags = String(slot.autoNote || '').split(' ').filter(Boolean);
      const manualTags = String(slot.manualNote || '').split(' ').filter(Boolean);
      const allTags = [...new Set([...autoTags, ...manualTags])];
      const note = allTags.filter((tag) => !['住', '急'].includes(tag)).join(' ');
      const hepatitisTags = allTags.filter((tag) => HEPATITIS_PRINT_TAGS.has(tag)).join(' ');
      const messageTypes = [...(messageMap.get(slot.patientId) || [])];
      const doNotMove = patient?.['patientStatus']?.doNotMove;
      return {
        shiftId,
        patientId: slot.patientId,
        medicalRecordNumber: String(
          info?.['medicalRecordNumber'] || patient?.['medicalRecordNumber'] || '',
        ),
        name: String(patient?.['name'] || info?.['name'] || ''),
        mode: modeRaw && modeRaw !== 'HD' ? modeRaw : null,
        wardNumber:
          status === 'ipd' || status === 'er'
            ? String(info?.['wardNumber'] || patient?.['wardNumber'] || '')
            : '',
        note,
        cellStyle: getUnifiedCellStyle(slot as any, info as any, null, messageTypes),
        isDoNotMove: !!doNotMove?.active,
        doNotMoveReason: String(doNotMove?.reason || '無原因說明'),
        messageTypes,
        labAbnormals: labMap.get(slot.patientId) || [],
        handovers: handoverMap.get(slot.patientId) || [],
        hepatitisTags,
      };
    };

    const rows: ClinicalRow[] = [];
    for (const bedNum of CLINICAL_BED_LAYOUT) {
      rows.push({
        bedLabel: String(bedNum),
        cells: shiftCodes.map((code) => buildCell(`bed-${bedNum}-${code}`)),
      });
    }
    for (let i = 1; i <= CLINICAL_PERIPHERAL_COUNT; i++) {
      rows.push({
        bedLabel: `外${i}`,
        cells: shiftCodes.map((code) => buildCell(`peripheral-${i}-${code}`)),
      });
    }
    return rows;
  });

  readonly hasClinicalPatients = computed(() =>
    this.clinicalRows().some((row) => row.cells.some((cell) => !!cell)),
  );

  /** 當日交班留言：patientId → 內容清單（來源 tasks category=message，與病人卡片同一份 feed） */
  private readonly handoverMessageMap = computed<Map<string, string[]>>(() => {
    const target = this.selectedDate();
    const map = new Map<string, string[]>();
    for (const msg of this.taskStore.feedMessages() as any[]) {
      const patientId = msg?.patientId;
      if (!patientId) continue;
      const status = String(msg?.status || '');
      if (['completed', 'resolved', 'cancelled', 'deleted'].includes(status)) continue;
      // 有指定日期者僅在當日顯示；未指定者視為長期留言
      const msgDate = String(msg?.targetDate || '').slice(0, 10);
      if (msgDate && msgDate !== target) continue;
      const content = String(msg?.content || msg?.title || '').trim();
      if (!content) continue;
      const type = String(msg?.type || '');
      // 調班申請自動產生的留言（臨時調班/加洗/交換皆 type='調班'）不進簡表＝使用者指定
      if (type === '調班') continue;
      const list = map.get(patientId) || [];
      list.push(type && type !== '常規' ? `[${type}] ${content}` : content);
      map.set(patientId, list);
    }
    return map;
  });

  /** 抓當月檢驗報告並算出異常項（醫師檢視專用；批次端點一次帶多位病人） */
  private async loadLabAbnormals(patientIds: string[]): Promise<void> {
    if (patientIds.length === 0) {
      this.labAbnormalMap.set(new Map());
      return;
    }
    this.isLabLoading.set(true);
    try {
      const target = this.selectedDate();
      const startDate = `${target.slice(0, 7)}-01`;
      const endDate = `${target.slice(0, 7)}-31`;
      const map = new Map<string, LabAbnormal[]>();
      // patientId 支援逗號分隔批次；分批避免 URL 過長
      const CHUNK = 40;
      for (let i = 0; i < patientIds.length; i += CHUNK) {
        const chunk = patientIds.slice(i, i + CHUNK);
        const reports = (await localApi.get(
          `/patients/lab-reports?patientId=${chunk.join(',')}&startDate=${startDate}&endDate=${endDate}`,
        )) as any[];
        if (!Array.isArray(reports)) continue;
        // 同月多份報告取最新一份
        const latestByPatient = new Map<string, any>();
        for (const report of reports) {
          const prev = latestByPatient.get(report.patientId);
          if (!prev || String(report.reportDate || '') > String(prev.reportDate || '')) {
            latestByPatient.set(report.patientId, report);
          }
        }
        for (const [patientId, report] of latestByPatient) {
          const data = report?.data || {};
          const abnormals: LabAbnormal[] = [];
          for (const [key, range] of Object.entries(CLINICAL_LAB_RANGES)) {
            const raw = data[key];
            const value = typeof raw === 'number' ? raw : parseFloat(String(raw ?? ''));
            if (!Number.isFinite(value)) continue;
            if (range.max !== undefined && value > range.max) {
              abnormals.push({ key, value, direction: 'high' });
            } else if (range.min !== undefined && value < range.min) {
              abnormals.push({ key, value, direction: 'low' });
            }
          }
          if (abnormals.length > 0) map.set(patientId, abnormals);
        }
      }
      this.labAbnormalMap.set(map);
    } catch (error) {
      console.error('[MyPatients] 載入當月檢驗異常失敗:', error);
      this.labAbnormalMap.set(new Map());
    } finally {
      this.isLabLoading.set(false);
    }
  }

  // --- 班次總覽 / 應打針劑（原掛在每日排程臨床查閱表頭） ---
  showShiftRecordsSummary(shiftCode: string): void {
    const schedule = this.rawSchedule();
    const pMap = this.patientStore.patientMap();
    const patientIds = new Set<string>();
    const infoMap: Record<string, Record<string, string>> = {};
    for (const [shiftId, slot] of Object.entries(schedule)) {
      if (!shiftId.endsWith(`-${shiftCode}`) || !(slot as any)?.patientId) continue;
      const patientId = (slot as any).patientId;
      patientIds.add(patientId);
      const parts = shiftId.split('-');
      const patient = pMap.get(patientId) as Record<string, unknown> | undefined;
      infoMap[patientId] = {
        bedNum: parts[0] === 'peripheral' ? `外${parts[1]}` : parts[1],
        patientName: (patient?.['name'] as string) || '',
        medicalRecordNumber: (patient?.['medicalRecordNumber'] as string) || '',
      };
    }
    this.shiftCodeForDialog.set(shiftCode);
    this.patientIdsForDialog.set([...patientIds]);
    this.patientInfoMapForDialog.set(infoMap);
    this.isRecordsSummaryDialogVisible.set(true);
  }

  closeRecordsSummaryDialog(): void {
    this.isRecordsSummaryDialogVisible.set(false);
    this.shiftCodeForDialog.set(null);
    this.patientIdsForDialog.set([]);
    this.patientInfoMapForDialog.set({});
  }

  async showShiftInjections(shiftCode: string): Promise<void> {
    if (!shiftCode) return;
    const schedule = this.rawSchedule();
    const patientInfoMap = new Map<string, { shift: string; bedNum: string }>();
    const patientIds: string[] = [];
    for (const [shiftId, slot] of Object.entries(schedule)) {
      if (!shiftId.endsWith(`-${shiftCode}`) || !(slot as any)?.patientId) continue;
      const patientId = (slot as any).patientId;
      patientIds.push(patientId);
      const parts = shiftId.split('-');
      patientInfoMap.set(patientId, {
        shift: shiftCode,
        bedNum: parts[0] === 'peripheral' ? `外${parts[1]}` : parts[1],
      });
    }

    this.lastInjectionShiftCode.set(shiftCode);
    this.injectionDialogDate.set(this.selectedDate());
    this.isInjectionDialogVisible.set(true);
    this.isInjectionLoading.set(true);
    this.allDailyInjections.set([]);
    this.filterSpecificInjections.set(false);
    try {
      const injections = await this.medicationStore.fetchDailyInjections(
        this.injectionDialogDate(),
        patientIds,
      );
      const enriched = injections.map((inj: any) => {
        const info = patientInfoMap.get(inj.patientId);
        return { ...inj, shift: info?.shift || shiftCode, bedNum: info?.bedNum || '' };
      });
      enriched.sort((a: any, b: any) => {
        const bedA = String(a.bedNum).startsWith('外')
          ? 1000 + parseInt(String(a.bedNum).substring(1))
          : parseInt(a.bedNum) || 999;
        const bedB = String(b.bedNum).startsWith('外')
          ? 1000 + parseInt(String(b.bedNum).substring(1))
          : parseInt(b.bedNum) || 999;
        if (bedA !== bedB) return bedA - bedB;
        return (a.patientName || '').localeCompare(b.patientName || '');
      });
      this.allDailyInjections.set(enriched);
    } catch (error) {
      console.error('[MyPatients] 獲取應打針劑失敗:', error);
      this.isInjectionDialogVisible.set(false);
    } finally {
      this.isInjectionLoading.set(this.medicationStore.isLoading());
    }
  }

  async refreshInjections(): Promise<void> {
    this.medicationStore.clearCache();
    const shiftCode = this.lastInjectionShiftCode();
    if (shiftCode) await this.showShiftInjections(shiftCode);
  }

  /** 臨床查閱簡表匯出 Excel（矩陣型：列＝床號、欄＝三班） */
  exportClinicalExcel(): void {
    const rows = this.clinicalRows();
    if (rows.length === 0) return;
    const data: unknown[][] = [];
    data.push([`部立台北醫院 臨床查閱 ${this.selectedDate()}`]);
    data.push([]);
    data.push(['床號', ...this.clinicalShiftHeaders]);
    for (const row of rows) {
      data.push([
        row.bedLabel,
        ...row.cells.map((cell) => {
          if (!cell) return '';
          const lines = [`${cell.medicalRecordNumber} ${cell.name}`.trim()];
          if (cell.mode) lines.push(cell.mode);
          if (cell.wardNumber) lines.push(`病房 ${cell.wardNumber}`);
          if (cell.labAbnormals.length > 0) {
            lines.push(
              '異常：' +
                cell.labAbnormals
                  .map((a) => `${a.key} ${a.value}${a.direction === 'high' ? '↑' : '↓'}`)
                  .join('、'),
            );
          }
          if (cell.handovers.length > 0) lines.push('交班：' + cell.handovers.join('；'));
          if (cell.note) lines.push(cell.note);
          return lines.join('\n');
        }),
      ]);
    }
    const worksheet = XLSX.utils.aoa_to_sheet(data);
    worksheet['!cols'] = [{ wch: 8 }, { wch: 34 }, { wch: 34 }, { wch: 34 }];
    worksheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '臨床查閱');
    XLSX.writeFile(workbook, `臨床查閱_${this.selectedDate()}.xlsx`);
  }

  printClinicalTable(): void {
    window.print();
  }

  /** 前一日/後一日快速切換 */
  shiftDate(days: number): void {
    const d = new Date(this.selectedDate() + 'T00:00:00');
    if (isNaN(d.getTime())) return;
    d.setDate(d.getDate() + days);
    this.selectedDate.set(formatDateToYYYYMMDD(d));
    this.reloadData();
  }

  goToToday(): void {
    this.selectedDate.set(formatDateToYYYYMMDD(new Date()));
    this.reloadData();
  }

  openDatePicker(): void {
    const el = this.datePickerInput?.nativeElement;
    if (!el) return;
    const anyEl = el as any;
    if (typeof anyEl.showPicker === 'function') {
      try {
        anyEl.showPicker();
        return;
      } catch {
        // 某些瀏覽器沒有使用者手勢時會 throw，退回 click()
      }
    }
    el.click();
  }

  onDatePicked(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    this.selectedDate.set(value);
    this.reloadData();
  }

  // --- ICU 醫囑單（複製自每日排程頁，醫師查房免切頁） ---
  async openIcuOrders(): Promise<void> {
    this.isIcuOrdersDialogVisible.set(true);
    await this.loadIcuEffectiveOrders();
  }

  /** 取 ipd/er + CVVHDF 病人在選取日期生效的醫囑（涵蓋 ICU 醫囑單會用到的對象） */
  private async loadIcuEffectiveOrders(): Promise<void> {
    try {
      const ids = Array.from(this.patientStore.patientMap().values())
        .filter((p: any) => !p.isDeleted && (p.status === 'ipd' || p.status === 'er' || p.mode === 'CVVHDF'))
        .map((p: any) => p.id);
      this.icuEffectiveOrders.set(await fetchEffectiveOrders(ids, this.selectedDate()));
    } catch (error) {
      console.error('[MyPatients] 取 ICU 生效醫囑失敗:', error);
    }
  }

  handleIcuDateChange(dateString: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return;
    this.selectedDate.set(dateString);
    this.reloadData();
    this.loadIcuEffectiveOrders();
  }

  async handleIcuOrdersSave(payload: { localNotes: Record<string, string>; crrtEmergencyData: Record<string, any> }): Promise<void> {
    if (this.isClinicalPastDate()) {
      this.notificationService.createNotification('歷史日期唯讀，無法修改ICU醫囑單資料', 'error');
      return;
    }
    this.isIcuSaving.set(true);
    const { localNotes: notes, crrtEmergencyData: crrtEmergency } = payload;
    const updatePromises: Promise<void>[] = [];
    for (const patientId in notes) {
      const patient = this.patientStore.patientMap().get(patientId) as any;
      if (patient) {
        const newDialysisOrders = { ...(patient.dialysisOrders || {}), memo: notes[patientId] };
        updatePromises.push(optimizedUpdatePatient(patientId, { dialysisOrders: newDialysisOrders }));
      }
    }
    for (const patientId in crrtEmergency) {
      const { withdraw, note } = crrtEmergency[patientId];
      updatePromises.push(
        optimizedUpdatePatient(patientId, {
          emergencyWithdraw: withdraw,
          emergencyWithdrawNote: note || '',
        }),
      );
    }
    try {
      if (updatePromises.length > 0) {
        await Promise.all(updatePromises);
        await this.patientStore.forceRefreshPatients();
      }
      this.notificationService.createNotification('醫囑單資料已儲存', 'success');
    } catch (error: any) {
      console.error('儲存 ICU 醫囑單資料發生錯誤：', error);
      this.notificationService.createNotification(`儲存 ICU 醫囑單失敗: ${error.message}`, 'error');
    } finally {
      this.isIcuSaving.set(false);
    }
  }

  openOrderModalFromIcu(patient: any): void {
    if (!patient?.id) return;
    // 以 store 內最新資料為準（ICU 彈窗傳來的物件混入了生效醫囑快照）
    const fresh = this.patientStore.allPatients().find((p) => p.id === patient.id);
    this.selectedPatientForOrder.set(fresh ? JSON.parse(JSON.stringify(fresh)) : patient);
    this.isOrderModalVisible.set(true);
  }

  openCrrtOrderModalFromIcu(patient: any): void {
    if (!patient?.id) return;
    this.editingPatientForCRRT.set(JSON.parse(JSON.stringify(patient)));
    this.isCRRTOrderModalVisible.set(true);
  }

  async handleSaveCrrtOrder(orderData: any): Promise<void> {
    const patient = this.editingPatientForCRRT();
    if (!patient?.id) return;
    try {
      await optimizedUpdatePatient(patient.id, { crrtOrders: orderData });
      // 樂觀更新讓 ICU 醫囑單 CRRT 卡片（讀 top-level crrtOrders）即時反映
      this.patientStore.updatePatientInStore(patient.id, { crrtOrders: orderData } as any);
      await this.patientStore.forceRefreshPatients();
      this.isCRRTOrderModalVisible.set(false);
      this.notificationService.createNotification(`已更新病人 ${patient.name} 的CRRT醫囑`, 'success');
    } catch (error: any) {
      console.error('儲存 CRRT 醫囑失敗:', error);
      this.notificationService.createNotification(`儲存 CRRT 醫囑失敗: ${error.message}`, 'error');
    }
  }

  copyMedicalRecordNumber(mrn: string): void {
    if (!mrn) return;
    const done = () => {
      this.copiedMrn.set(mrn);
      if (this.copiedTimer) clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => this.copiedMrn.set(''), 1500);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(mrn).then(done).catch(() => {});
      return;
    }
    // 非 secure context（院內 http）沒有 clipboard API，退回 execCommand
    const textarea = document.createElement('textarea');
    textarea.value = mrn;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      done();
    } catch {
      /* 複製失敗不影響查閱 */
    }
    document.body.removeChild(textarea);
  }

  /** 點格子開病人總覽；slotList＝同班別所有病人（依床號排序），供彈窗內上下床切換 */
  openClinicalDetail(cell: ClinicalCell | null): void {
    if (!cell) return;
    const shiftCode = cell.shiftId.split('-').pop() || '';
    const schedule = this.rawSchedule();
    const pMap = this.patientStore.patientMap();
    const slots: Record<string, unknown>[] = [];
    for (const [shiftId, slot] of Object.entries(schedule)) {
      if (!shiftId.endsWith(`-${shiftCode}`)) continue;
      const patientId = (slot as any)?.patientId;
      if (!patientId) continue;
      const patient = pMap.get(patientId);
      if (!patient) continue;
      const parts = shiftId.split('-');
      const isPeripheral = shiftId.startsWith('peripheral');
      slots.push({
        ...(patient as Record<string, unknown>),
        shiftId,
        bedNum: isPeripheral ? `外${parts[1]}` : parts[1],
        sortKey: isPeripheral ? 1000 + Number(parts[1]) : Number(parts[1]),
      });
    }
    slots.sort((a, b) => Number(a['sortKey']) - Number(b['sortKey']));
    const index = Math.max(0, slots.findIndex((s) => s['shiftId'] === cell.shiftId));
    this.sortedSlotsForModal.set(slots);
    this.currentPatientIndexForModal.set(index);
    this.selectedPatientForDetail.set(slots[index] || null);
    this.isDetailModalVisible.set(true);
  }

  switchClinicalPatient(index: number): void {
    const slots = this.sortedSlotsForModal();
    if (index < 0 || index >= slots.length) return;
    this.currentPatientIndexForModal.set(index);
    this.selectedPatientForDetail.set(slots[index]);
  }

  readonly hasAnyPatients = computed(() => {
    const shifts = this.patientListByShift();
    if (!shifts) return false;
    return Object.values(shifts).some((list) => list.length > 0);
  });


  readonly statusMessage = computed(() => {
    if (this.selectedUserId() !== this.currentUser()?.uid) {
      const selectedUserName =
        this.selectableUsers().find((u) => u.uid === this.selectedUserId())
          ?.name || '';
      return `${selectedUserName} 在 ${this.selectedDate()} 沒有被分配到照護病人。`;
    }
    return '您今天沒有被分配到照護病人，或班表尚未更新。';
  });

  // Watch currentUser changes — also triggers initial data fetch
  private readonly userWatcher = effect(() => {
    const user = this.authService.currentUser();
    untracked(() => {
      if (user) {
        this.selectedUserId.set(user.uid);
        this.loadSelectableUsers(true);
        // Fetch patient data after auth is confirmed
        this.fetchMyPatientData();
      } else {
        this.selectedUserId.set(null);
        this.selectableUsers.set([]);
        this.userDirectory.clearCache();
        this.lastSelectableUsersUpdatedAt = 0;
      }
    });
  });

  ngOnInit(): void {
    // Data loading is triggered by the userWatcher effect after auth completes
  }

  ngOnDestroy(): void {
    // effect cleanup is automatic
  }

  // --- Helper Functions ---
  hasPermission(role: string): boolean {
    return this.authService.hasPermission(role as any);
  }

  getShiftTitle(shiftCode: string): string {
    const map: Record<string, string> = {
      early: '早班 (主責)',
      noonOn: '午班 (上針)',
      noonOff: '午班 (收針)',
      late: '晚班 (主責)',
    };
    return map[shiftCode] || shiftCode;
  }

  getMessageTypeIcon(type: string | undefined): string {
    switch (type) {
      case '抽血':
        return '\u{1FA78}'; // blood drop
      case '衛教':
        return '\u{1F4E2}'; // loudspeaker
      case '常規':
      default:
        return '\u{1F4DD}'; // memo
    }
  }

  formatInjection(injection: any): string {
    const displayName =
      this.injectionTradeNameMap.get(injection.orderCode) ||
      injection.orderName ||
      '未知藥品';
    const parts = [
      displayName,
      `${injection.dose || ''} ${injection.unit || ''}`.trim(),
      injection.note || '',
    ];
    return parts.filter((part) => part).join(' / ');
  }

  /**
   * Extract duty descriptions for specific group letters from the hardcoded duty texts.
   * Supports both day shift and night shift duties.
   */
  private extractGroupDuties(groupLetters: string[]): string[] {
    if (groupLetters.length === 0) return [];

    const dayDuties = 'A 組：預備機化消及測餘氯。\nB 組：點班(急救車、電擊器測試)。備 12-8，午班用物。\nC 組：支援 ICU 組(含備機)，如 ICU 組被 P，接 ICU 組。\nD 組：送消、點班(衛材、庫房溫溼度)、整理供應室衛材歸位，NO.1。\nE 組：點班(氧療、冰箱溫度、補充冰箱常備藥)。NO.2。\nF 組：電訪關心病患，NO.3。\nG 組：協助準備醫師拔 D/L 備物及病人觀察。\nH 組：住院組。\nI 組：住院組。\nJ 組：W3 泡製 3 桶消毒液。W6 幫忙協助收行動 RO 機。\nK 組：擔任 Leader。';

    const nightDuties = 'A 組: 擔任 Leader，核對當日人數，將當日護理日誌、排程，隔天分組匯出轉 PDF 並存檔，下班前須到 PD 衛教室電腦開啟隔日診間叫號系統。\nB 組: 10PM 後核對隔日娃娃頭與電腦排程是否一致，並須製作隔日早班洗腎住院床病人移動方式，排主護及 Leader 牌。備隔日 B 組 AK。\nC 組: 接 ICU 組，協同 B 組核對隔日娃娃頭、W4 補充 ICU 消毒液，備隔日 C+D 組 AK。\nD 組: 點班(衛材)，備隔日 E+F 組 AK，NO.1。\nE 組: 點班(氧療、冰箱)、備隔日 I+J 組 AK，NO.2。\nF 組: 接 12-8，備隔日 G+H 組 AK。每月 1 號點消防箱物資。NO.3。\nG 組: 住院組、備隔日 K 組 AK。\nH 組: 住院組、點班(急救車)。\nI 組: 備隔日 A 組 AK。關門前結束檢查。';

    const results: string[] = [];
    const allDutyLines = [...dayDuties.split('\n'), ...nightDuties.split('\n')];

    for (const letter of groupLetters) {
      const dayLine = dayDuties.split('\n').find(l => new RegExp(`^${letter}\\s*組[：:]`).test(l));
      const nightLine = nightDuties.split('\n').find(l => new RegExp(`^${letter}\\s*組[：:]`).test(l));
      if (dayLine) results.push(`【早班】${dayLine}`);
      if (nightLine) results.push(`【晚班】${nightLine}`);
    }
    return results;
  }

  getShiftKeys(): string[] {
    const desiredOrder = ['early', 'noonOn', 'noonOff', 'late'];
    const available = this.patientListByShift();
    return desiredOrder.filter((key) => key in available);
  }

  getShiftPatients(shiftCode: string): MyPatientItem[] {
    return this.patientListByShift()[shiftCode] || [];
  }

  // --- 照護工作按鈕（初透衛教紀錄 / 本院初透建檔） ---

  readonly showEduModal = signal(false);
  readonly isLoadingEdu = signal(false);
  readonly eduRows = signal<any[]>([]);
  readonly eduError = signal('');
  readonly eduDialogPatient = signal<any | null>(null);

  // 病人卡「初透衛教」圖示：patientId -> education-list row（未完成者），供卡片 icon 顯示/點擊直達用
  private eduRowsMap = new Map<string, any>();
  readonly eduTargetPatientIds = signal<Set<string>>(new Set());

  /** 套用 /patients/education-list 回傳列，統一算出「衛教對象」= 未主護簽核完成(!completed)。
   *  openEduModal 與卡片圖示共用同一份資料，勿各自重算 predicate。 */
  private applyEducationList(rows: any[]): void {
    const targets = rows.filter((r) => !r.completed);
    this.eduRowsMap = new Map(targets.map((r) => [r.patientId, r]));
    this.eduTargetPatientIds.set(new Set(this.eduRowsMap.keys()));
  }

  /** 供卡片圖示使用：僅需重新整理衛教對象清單（不開清單彈窗時，如關閉單人視窗後回補）。 */
  private async loadEduTargets(): Promise<void> {
    try {
      const list = await localApi.get('/patients/education-list');
      this.applyEducationList(Array.isArray(list) ? list : []);
    } catch (error) {
      console.error('載入初透衛教對象清單失敗:', error);
    }
  }

  readonly showFirstDiaModal = signal(false);
  readonly isLoadingFirstDia = signal(false);
  readonly firstDiaRows = signal<any[]>([]);
  readonly firstDiaError = signal('');
  /** 基本資料表清單：預設只列自己（本院初透當日照顧護理師）需要建檔的病人，可切換看全部 */
  readonly firstDiaOnlyMine = signal(true);
  readonly firstDiaVisibleRows = computed(() =>
    this.firstDiaOnlyMine() ? this.firstDiaRows().filter((r) => r.mine) : this.firstDiaRows(),
  );

  canEditEducation(): boolean {
    return !this.authService.isViewer();
  }

  /** 目前檢視對象（支援切換使用者）的 uid 與姓名，比對方式同 fetchMyPatientData */
  private async resolveTargetUser(): Promise<{ userId: string | null; userName: string }> {
    const userId = this.selectedUserId();
    const cu = this.currentUser();
    let userName = userId === cu?.uid || userId === cu?.id ? cu?.name : undefined;
    if (!userName && userId) {
      await this.userDirectory.ensureUsersLoaded();
      const u = this.userDirectory.allUsers().find((x: any) => x.uid === userId || x.id === userId);
      userName = u?.name;
    }
    return { userId, userName: String(userName || '').trim() };
  }

  /** 照護病人初透衛教紀錄：我的照護清單病人 + 今日我負責班別的衛教中病人 */
  async openEduModal(): Promise<void> {
    this.showEduModal.set(true);
    this.isLoadingEdu.set(true);
    this.eduError.set('');
    this.eduRows.set([]);
    try {
      const [target, list, care] = await Promise.all([
        this.resolveTargetUser(),
        localApi.get('/patients/education-list'),
        localApi.get('/nursing/patient-care'),
      ]);
      const rows: any[] = Array.isArray(list) ? list : [];
      this.applyEducationList(rows);
      const assignments: any[] = (care as any)?.assignments || [];
      const myCare = assignments.find(
        (a) => a.nurseId === target.userId || String(a.nurseName || '').trim() === target.userName,
      );
      const myCareIds = new Set<string>(myCare?.patientIds || []);
      const todayIds = new Set<string>();
      for (const sc of this.getShiftKeys()) {
        for (const p of this.getShiftPatients(sc)) todayIds.add(p.patientId);
      }
      const filtered = rows
        // 主護簽核全數完成（12次通過或紙本完成）即「收藏」，不再列入待辦名單
        .filter((r) => !r.completed)
        .filter((r) => myCareIds.has(r.patientId) || todayIds.has(r.patientId))
        .map((r) => ({ ...r, todayMine: todayIds.has(r.patientId) }))
        .sort(
          (a, b) =>
            (b.todayMine ? 1 : 0) - (a.todayMine ? 1 : 0) ||
            String(a.patientName).localeCompare(b.patientName),
        );
      this.eduRows.set(filtered);
    } catch (error) {
      console.error('載入照護衛教清單失敗:', error);
      this.eduError.set('載入衛教清單失敗，請稍後再試。');
    } finally {
      this.isLoadingEdu.set(false);
    }
  }

  closeEduModal(): void {
    this.showEduModal.set(false);
  }

  openEduRecord(row: any): void {
    this.eduDialogPatient.set(row);
  }

  /** 病人卡「初透衛教」圖示點擊：直接開啟該病人的衛教紀錄視窗，不需先開清單彈窗選人 */
  openCardEduRecord(patientId: string): void {
    const row = this.eduRowsMap.get(patientId);
    if (row) this.openEduRecord(row);
  }

  async closeEduRecord(): Promise<void> {
    this.eduDialogPatient.set(null);
    if (this.showEduModal()) {
      await this.openEduModal();
    } else {
      // 關窗後可能剛完成主護簽核，重新整理卡片圖示對象清單
      await this.loadEduTargets();
    }
  }

  /** 本院初透基本資料建立：僅列組長已標記「本院初透」且 KiDit 未建檔完成者（負責人=標記日照顧護理師） */
  async openFirstDiaModal(): Promise<void> {
    this.showFirstDiaModal.set(true);
    this.isLoadingFirstDia.set(true);
    this.firstDiaError.set('');
    this.firstDiaRows.set([]);
    try {
      const [target, pending] = await Promise.all([
        this.resolveTargetUser(),
        kiditService.fetchPendingRegistrations(),
      ]);
      const rows = ((pending as any[]) || [])
        .filter((r) => r.hospitalFirstDialysisDate)
        .map((r) => ({ ...r, mine: String(r.firstNurse?.nurse || '').trim() === target.userName }))
        .sort(
          (a, b) =>
            (b.mine ? 1 : 0) - (a.mine ? 1 : 0) ||
            String(b.hospitalFirstDialysisDate || '').localeCompare(
              String(a.hospitalFirstDialysisDate || ''),
            ),
        );
      this.firstDiaRows.set(rows);
    } catch (error) {
      console.error('載入本院初透待建檔清單失敗:', error);
      this.firstDiaError.set('載入待建檔清單失敗，請稍後再試。');
    } finally {
      this.isLoadingFirstDia.set(false);
    }
  }

  closeFirstDiaModal(): void {
    this.showFirstDiaModal.set(false);
  }

  goToKiditStation(): void {
    this.showFirstDiaModal.set(false);
    this.router.navigate(['/kidit-report']);
  }

  /** 點列跳到 KiDit 申報工作站並自動開啟該病人最近事件日的建檔視窗 */
  openFirstDiaTarget(row: any): void {
    if (!row.lastEventDate) {
      alert('該病人尚無 KiDit 事件（工作日誌尚未有病人動態），請先於工作日誌新增動態後再建檔。');
      return;
    }
    this.showFirstDiaModal.set(false);
    this.router.navigate(['/kidit-report'], {
      queryParams: { openPatient: row.patientId, eventDate: row.lastEventDate },
    });
  }

  firstDiaMissingLabel(row: any): string {
    const missing: string[] = [];
    if (!row.hasProfile) missing.push('病患資料');
    if (!row.hasHistory) missing.push('病史原發病');
    return missing.length ? missing.join('、') : '資料分散於不同事件';
  }

  firstNurseLabel(row: any): string {
    const n = row.firstNurse;
    if (!n) return '—';
    return n.team && n.nurse ? `${n.team} ${n.nurse}` : n.nurse || n.team || '—';
  }

  // --- 病人卡「需填寫基本資料」標籤（本院初透待建檔） ---

  /** patientId -> pending-registration row（有本院初透標記且 KiDit 未建檔完成者），供病人卡標籤顯示/點擊直達用 */
  private pendingRegMap = new Map<string, any>();
  readonly pendingRegPatientIds = signal<Set<string>>(new Set());

  /** 載入頁面時抓一次本院初透待建檔名單，供病人卡「需填寫基本資料」標籤比對。
   *  資料來源同 openFirstDiaModal；hospitalFirstDialysisDate 為 null = 未標記本院初透，
   *  標記但沒填日期會是空字串，所以用 != null 判斷，勿改成 truthy（會漏掉沒填日期者）。 */
  private async loadPendingRegistrations(): Promise<void> {
    try {
      const pending = await kiditService.fetchPendingRegistrations();
      const rows = ((pending as any[]) || []).filter((r) => r.hospitalFirstDialysisDate != null);
      this.pendingRegMap = new Map(rows.map((r) => [r.patientId, r]));
      this.pendingRegPatientIds.set(new Set(this.pendingRegMap.keys()));
    } catch (error) {
      console.error('載入本院初透待建檔名單失敗:', error);
    }
  }

  /** 病人卡「需填寫基本資料」標籤點擊：直達 KiDit 工作站該病人的基本資料建檔頁籤 */
  openCardRegistration(patientId: string): void {
    const row = this.pendingRegMap.get(patientId);
    if (row) this.openFirstDiaTarget(row);
  }

  // --- 病人卡「需抽血」書籤（抽血留言改書籤呈現） ---

  /** 點擊需抽血書籤後的確認對象；確認＝該病人所有待辦抽血留言標記已讀 */
  readonly bloodConfirmPatient = signal<MyPatientItem | null>(null);

  bloodBookmarkTitle(patient: MyPatientItem): string {
    const contents = patient.bloodMemos.map((m) => m.content).join('；');
    return `抽血留言：${contents}。點擊確認完成抽血（留言標記已讀）`;
  }

  openBloodDrawConfirm(patient: MyPatientItem): void {
    this.bloodConfirmPatient.set(patient);
  }

  bloodConfirmMessage(): string {
    const p = this.bloodConfirmPatient();
    if (!p) return '';
    const contents = p.bloodMemos.map((m) => `「${m.content}」`).join('、');
    return `${p.name} 的抽血留言：${contents}。確認已完成抽血？確認後留言將標記為已讀。`;
  }

  async executeBloodDrawComplete(): Promise<void> {
    const p = this.bloodConfirmPatient();
    this.bloodConfirmPatient.set(null);
    if (!p) return;
    for (const m of p.bloodMemos) {
      await this.updateTaskStatus(m, 'completed');
    }
    // 重建卡片讓書籤即時消失
    await this.fetchMyPatientData();
  }

  // --- 血管通路事件（主護填寫入口；組長確認在工作日誌頁） ---

  readonly showVaModal = signal(false);
  readonly isLoadingVa = signal(false);
  readonly vaRows = signal<any[]>([]);
  readonly vaError = signal('');
  readonly vaDialogPatient = signal<{ patientId: string; patientName: string } | null>(null);
  /** 有「已退回」事件待修正的病人 id，供病人卡圖示紅點提醒 */
  readonly vaRejectedIds = signal<Set<string>>(new Set());

  private async fetchVaEvents(status: 'pending' | 'rejected'): Promise<VascularAccessEvent[]> {
    const resp = await firstValueFrom(
      this.api.get<{ success: boolean; events: VascularAccessEvent[] }>('/vascular-access/events', {
        status,
      }),
    );
    return resp?.events || [];
  }

  /** 載入頁面時抓一次已退回事件，供病人卡圖示紅點比對（關閉單人視窗後也會回補） */
  private async loadVaRejected(): Promise<void> {
    try {
      const events = await this.fetchVaEvents('rejected');
      this.vaRejectedIds.set(new Set(events.map((e) => e.patientId)));
    } catch (error) {
      console.error('載入血管通路退回事件失敗:', error);
    }
  }

  /** 血管通路事件填寫清單：我的照護清單病人 + 今日我負責班別的病人（病人範圍同 openEduModal） */
  async openVaModal(): Promise<void> {
    this.showVaModal.set(true);
    this.isLoadingVa.set(true);
    this.vaError.set('');
    this.vaRows.set([]);
    try {
      await this.patientStore.fetchPatientsIfNeeded();
      const [target, care, pendingEvents, rejectedEvents] = await Promise.all([
        this.resolveTargetUser(),
        localApi.get('/nursing/patient-care'),
        this.fetchVaEvents('pending'),
        this.fetchVaEvents('rejected'),
      ]);
      // 順手更新卡片紅點（同一份 rejected 資料）
      this.vaRejectedIds.set(new Set(rejectedEvents.map((e) => e.patientId)));
      const assignments: any[] = (care as any)?.assignments || [];
      const myCare = assignments.find(
        (a) => a.nurseId === target.userId || String(a.nurseName || '').trim() === target.userName,
      );
      const myCareIds = new Set<string>(myCare?.patientIds || []);
      const todayIds = new Set<string>();
      for (const sc of this.getShiftKeys()) {
        for (const p of this.getShiftPatients(sc)) todayIds.add(p.patientId);
      }
      const countBy = (events: VascularAccessEvent[]) => {
        const m = new Map<string, number>();
        for (const e of events) m.set(e.patientId, (m.get(e.patientId) || 0) + 1);
        return m;
      };
      const pendingCounts = countBy(pendingEvents);
      const rejectedCounts = countBy(rejectedEvents);
      const patientMap = this.patientStore.patientMap();
      const rows = [...new Set<string>([...myCareIds, ...todayIds])]
        .map((pid) => {
          const p = patientMap.get(pid);
          if (!p) return null; // 照護清單殘留的已不存在病人不列
          return {
            patientId: pid,
            patientName: p.name || '未知',
            medicalRecordNumber: p.medicalRecordNumber || '',
            todayMine: todayIds.has(pid),
            pendingCount: pendingCounts.get(pid) || 0,
            rejectedCount: rejectedCounts.get(pid) || 0,
          };
        })
        .filter((r): r is NonNullable<typeof r> => !!r)
        .sort(
          // 有退回待修正的優先，其次今日負責，再依姓名
          (a, b) =>
            (b.rejectedCount > 0 ? 1 : 0) - (a.rejectedCount > 0 ? 1 : 0) ||
            (b.todayMine ? 1 : 0) - (a.todayMine ? 1 : 0) ||
            a.patientName.localeCompare(b.patientName),
        );
      this.vaRows.set(rows);
    } catch (error) {
      console.error('載入血管通路事件清單失敗:', error);
      this.vaError.set('載入清單失敗，請稍後再試。');
    } finally {
      this.isLoadingVa.set(false);
    }
  }

  closeVaModal(): void {
    this.showVaModal.set(false);
  }

  openVaRecord(row: { patientId: string; patientName: string }): void {
    this.vaDialogPatient.set({ patientId: row.patientId, patientName: row.patientName });
  }

  /** 病人卡「血管通路事件」圖示：直接開該病人的事件視窗（不分身分，門診/住院/急診皆可填） */
  openCardVaRecord(patient: MyPatientItem): void {
    this.vaDialogPatient.set({ patientId: patient.patientId, patientName: patient.name });
  }

  async closeVaRecord(): Promise<void> {
    this.vaDialogPatient.set(null);
    if (this.showVaModal()) {
      await this.openVaModal(); // 重新彙整徽章數（也會一併更新卡片紅點）
    } else {
      // 關窗後可能剛修正了被退回的事件，回補卡片紅點
      await this.loadVaRejected();
    }
  }

  getShiftSupplySummary(shiftCode: string): { supplies: string; medications: string } {
    const patients = this.getShiftPatients(shiftCode);
    if (patients.length === 0) return { supplies: '', medications: '' };

    // Count AK types
    const akCounts = new Map<string, number>();
    for (const p of patients) {
      const akValue = p.preparation.akToday;
      if (akValue) {
        // akToday 已依頻率/日期解析成「當次」AK，正常情況為單一值。
        // 仍保留 split('/') 以涵蓋無法判斷次序時的保守後備 (整串列出)。
        for (const ak of akValue.split('/')) {
          const trimmed = ak.trim();
          if (trimmed) akCounts.set(trimmed, (akCounts.get(trimmed) || 0) + 1);
        }
      }
    }
    const akParts = Array.from(akCounts.entries()).map(([name, count]) => `${name}×${count}`);
    const tubingCount = patients.length;
    const suppliesStr = akParts.length > 0
      ? `${akParts.join(', ')} + Tubing×${tubingCount}`
      : `Tubing×${tubingCount}`;

    // Count injection medications
    const medCounts = new Map<string, number>();
    for (const p of patients) {
      if (p.injections && p.injections.length > 0) {
        for (const inj of p.injections) {
          const displayName = this.injectionTradeNameMap.get(inj.orderCode) || inj.orderName || '未知';
          medCounts.set(displayName, (medCounts.get(displayName) || 0) + 1);
        }
      }
    }
    const medParts = Array.from(medCounts.entries()).map(([name, count]) => `${name}×${count}`);
    const medicationsStr = medParts.join(', ');

    return { supplies: suppliesStr, medications: medicationsStr };
  }

  // --- Data Loading ---
  async fetchMyPatientData(date?: string): Promise<void> {
    console.log('[MyPatients DEBUG] fetchMyPatientData CALLED, date param:', date);
    this.isLoading.set(true);
    try {
      const userId = this.selectedUserId();
      const targetDate = date || this.selectedDate();
      console.log('[MyPatients DEBUG] userId:', userId, 'targetDate:', targetDate);
      if (!userId) {
        console.log('[MyPatients DEBUG] EXIT: no userId');
        this.patientListByShift.set({});
        return;
      }

      // 0. 併行載入初透衛教對象清單（供病人卡圖示用），與其他資料一起等，避免序列化多一輪往返
      const eduTargetsPromise = this.loadEduTargets();
      // 血管通路「已退回」事件（病人卡圖示紅點用）：不擋卡片渲染，載到即補上紅點
      void this.loadVaRejected();
      // 本院初透待建檔名單（病人卡「需填寫基本資料」標籤用）：同樣不擋卡片渲染
      void this.loadPendingRegistrations();

      // 1. Ensure patients are loaded
      await this.patientStore.fetchPatientsIfNeeded();
      console.log('[MyPatients DEBUG] patients loaded, count:', this.patientStore.allPatients().length);

      // 2. Look up user's name from UID. The current nurse can use the login token
      // directly; loading the whole directory is only needed when switching users.
      const currentUser = this.currentUser();
      const isCurrentUser = userId === currentUser?.uid || userId === currentUser?.id;
      let userName = isCurrentUser ? currentUser?.name : undefined;

      if (!userName) {
        await this.userDirectory.ensureUsersLoaded();
        const allUsers = this.userDirectory.allUsers();
        const targetUser = allUsers.find((u) => u.uid === userId || u.id === userId);
        userName = targetUser?.name;
      }
      if (!userName) {
        console.warn('[MyPatients DEBUG] EXIT: 找不到使用者名稱 for UID:', userId);
        this.patientListByShift.set({});
        return;
      }

      // 3. Fetch schedule and nurse assignments for this date
      // Past dates are in 'expired_schedules', today/future in 'schedules'
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const target = new Date(targetDate);
      target.setHours(0, 0, 0, 0);
      const isPastDate = target < today;

      const teamsApi = this.apiManagerService.create<FirestoreRecord>('nurse_assignments');

      console.log('[MyPatients DEBUG] fetching schedule and teams for:', targetDate, 'isPast:', isPastDate);

      let schedule: Record<string, any> = {};
      let teamsRecord: any = null;

      if (isPastDate) {
        // Past dates: use archive store
        const [archiveResult, assignmentResult] = await Promise.all([
          this.archiveStore.fetchScheduleByDate(targetDate),
          teamsApi.fetchById(targetDate),
        ]);
        schedule = (archiveResult as any)?.schedule || {};
        teamsRecord = assignmentResult;
      } else {
        // Today/future: use live schedules
        const schedulesApi = this.apiManagerService.create<FirestoreRecord>('schedules');
        const [scheduleResult, assignmentResult] = await Promise.all([
          schedulesApi.fetchById(targetDate),
          teamsApi.fetchById(targetDate),
        ]);
        schedule = (scheduleResult as any)?.schedule || {};
        teamsRecord = assignmentResult;
      }

      console.log('[MyPatients DEBUG] schedule slots:', Object.keys(schedule).length, 'hasTeams:', !!teamsRecord);

      // 醫師/專師檢視：只需要整份排程來畫臨床查閱簡表，不做護理分組比對
      this.rawSchedule.set(schedule);
      if (this.isDoctorView()) {
        this.patientListByShift.set({});
        this.nurseGroupLabel.set('');
        this.nurseGroupDuties.set([]);
        // 當月檢驗異常：非阻斷，格線先出來、徽章稍後補上
        const scheduledIds = [
          ...new Set(
            Object.values(schedule)
              .map((slot: any) => slot?.patientId)
              .filter(Boolean) as string[],
          ),
        ];
        void this.loadLabAbnormals(scheduledIds);
        return;
      }

      if (Object.keys(schedule).length === 0) {
        console.log('[MyPatients DEBUG] EXIT: no schedule data');
        this.patientListByShift.set({});
        return;
      }
      const assignmentPayload =
        (teamsRecord as any)?.teams?.teams || (teamsRecord as any)?.teams?.names
          ? (teamsRecord as any).teams
          : teamsRecord;
      const namesMap: Record<string, string> = (assignmentPayload as any)?.names || {};

      // 4. Find team keys assigned to this nurse
      const myTeamKeys = new Set<string>();
      const normalizedUserName = userName.trim();
      for (const [teamKey, nurseName] of Object.entries(namesMap)) {
        if (String(nurseName).trim() === normalizedUserName) {
          myTeamKeys.add(teamKey);
        }
      }

      // DEBUG: Log data to diagnose matching issues
      console.log('[MyPatients DEBUG] userName:', userName);
      console.log('[MyPatients DEBUG] namesMap:', JSON.stringify(namesMap));
      console.log('[MyPatients DEBUG] myTeamKeys:', [...myTeamKeys]);

      // Extract nurse group letter(s) and duties
      const groupLetters = new Set<string>();
      for (const tk of myTeamKeys) {
        const letter = tk.replace(/^[早午晚]/, '');
        if (letter) groupLetters.add(letter);
      }
      const groupArr = [...groupLetters].sort();
      this.nurseGroupLabel.set(groupArr.length > 0 ? groupArr.map(g => `${g}組`).join(' / ') : '');
      this.nurseGroupDuties.set(this.extractGroupDuties(groupArr));

      // 5. Apply teams data to schedule slots (same logic as stats.component.ts lines 590-600)
      // Teams use key format: ${patientId}-${shiftCode}
      const teamsData: Record<string, any> = (assignmentPayload as any)?.teams || {};

      // Apply team info to schedule slots in memory
      for (const slotKey of Object.keys(schedule)) {
        const slot = schedule[slotKey];
        if (!slot?.patientId) continue;
        const shiftCode = slotKey.split('-').pop() || '';
        const teamKey = `${slot.patientId}-${shiftCode}`;
        const teamInfo = teamsData[teamKey];
        if (teamInfo) {
          Object.assign(slot, teamInfo);
        }
      }

      // 6. Build initial patient list and collect all my patient IDs
      const result: Record<string, MyPatientItem[]> = {};
      const patientMap = this.patientStore.patientMap();
      const feedMessages = this.taskStore.feedMessages();
      const allMyPatientIds: string[] = [];

      // Intermediate structure to hold items before injection enrichment
      interface PendingItem {
        slotKey: string;
        slotData: any;
        roles: string[];
        patient: any;
        orders: any;
        bedLabel: string;
      }
      const pendingItems: PendingItem[] = [];

      let matchCount = 0;
      for (const slotKey of Object.keys(schedule)) {
        const slotData = schedule[slotKey];
        if (!slotData?.patientId) continue;

        const shiftCode = slotKey.split('-').pop();
        const nurseTeam = slotData.nurseTeam || '';
        const nurseTeamIn = slotData.nurseTeamIn || '';
        const nurseTeamOut = slotData.nurseTeamOut || '';

        const roles: string[] = [];

        if (shiftCode === 'early' && myTeamKeys.has(nurseTeam)) {
          roles.push('early');
        }
        if (shiftCode === 'late' && myTeamKeys.has(nurseTeam)) {
          roles.push('late');
        }
        if (shiftCode === 'noon') {
          if (myTeamKeys.has(nurseTeamIn)) {
            roles.push('noonOn');
          }
          if (myTeamKeys.has(nurseTeamOut)) {
            roles.push('noonOff');
          }
        }

        if (roles.length === 0) continue;
        matchCount++;

        const patient = patientMap.get(slotData.patientId);
        if (!patient) continue;

        const orders = (patient as any).dialysisOrders || {};
        const bedLabel = slotKey.startsWith('peripheral')
          ? `外圍${slotKey.split('-')[1]}`
          : slotKey.split('-')[1] || '';

        allMyPatientIds.push(slotData.patientId);
        pendingItems.push({ slotKey, slotData, roles, patient, orders, bedLabel });
      }

      // 7. Fetch injection data from medication_orders
      let injectionsMap = new Map<string, any[]>();
      if (allMyPatientIds.length > 0) {
        try {
          const uniqueIds = [...new Set(allMyPatientIds)];
          const allInjections = await this.medicationStore.fetchDailyInjections(targetDate, uniqueIds);
          for (const inj of allInjections) {
            if (!injectionsMap.has(inj.patientId)) injectionsMap.set(inj.patientId, []);
            injectionsMap.get(inj.patientId)!.push(inj);
          }
        } catch (err) {
          console.warn('[MyPatients] 取得針劑資料失敗，將繼續不含針劑:', err);
        }
      }

      // 8. Build final patient items with injection data
      // 當天星期幾 (1=週一 ... 7=週日)，用於從輪替醫囑解析「當次」AK
      const targetDow = getTaipeiWeekdayIndex(targetDate) + 1;
      await eduTargetsPromise; // 確保衛教對象清單已就緒，供下方 isEduTarget 判定
      const eduTargetIds = this.eduTargetPatientIds();
      for (const item of pendingItems) {
        const patientTasks = feedMessages.filter(
          (m) =>
            m.patientId === item.slotData.patientId &&
            m.status !== 'completed' &&
            m.status !== 'resolved' &&
            m.status !== 'cancelled'
        );
        // 抽血留言不列留言區，改以卡片「需抽血」書籤呈現（點書籤確認完成＝標記已讀）
        const bloodMemos = patientTasks
          .filter((m) => m.type === '抽血')
          .map((m) => ({ id: m.id, content: m.content }));
        const patientMemos = patientTasks
          // 調班申請自動產生的交班留言不在卡片顯示（調班管理/留言板仍看得到）＝使用者指定精簡
          .filter((m) => m.type !== '調班' && m.type !== '抽血')
          .map((m) => ({
            id: m.id,
            content: m.content,
            type: m.type,
            targetDate: (m as any).targetDate,
            status: m.status,
            creator: m.creator,
          }));

        const injections = injectionsMap.get(item.slotData.patientId) || [];

        const patientItem: MyPatientItem = {
          id: `${item.slotKey}`,
          patientId: item.slotData.patientId,
          name: (item.patient as any).name || '未知',
          bedNum: item.bedLabel,
          preparation: {
            ak: item.orders.ak || '',
            akToday: resolveDailyRotationValue(
              item.orders.ak,
              // freq 來源優先序：總表規則 scheduleRule.freq (現行真理之源) →
              // 舊頂層 freq (來自 dialysis_orders.freq，已淘汰) → 排程 slot freq
              (item.patient as any)?.scheduleRule?.freq ||
                (item.patient as any)?.freq ||
                item.slotData?.freq,
              targetDow,
            ),
            dialysateCa: item.orders.dialysateCa || item.orders.dialysate || '',
            heparin: item.orders.heparinLM || (item.orders.heparinInitial && item.orders.heparinMaintenance ? `${item.orders.heparinInitial}/${item.orders.heparinMaintenance}` : item.orders.heparinInitial || ''),
            bloodFlow: item.orders.bloodFlow || '',
            vascAccess: item.orders.vascAccess || (item.patient as any).vascularAccess || '',
          },
          injections,
          memos: patientMemos,
          bloodMemos,
          isEduTarget: eduTargetIds.has(item.slotData.patientId),
        };

        for (const role of item.roles) {
          if (!result[role]) result[role] = [];
          result[role].push(patientItem);
        }
      }

      // Sort each shift group by bed number
      for (const key of Object.keys(result)) {
        result[key].sort((a, b) => a.bedNum.localeCompare(b.bedNum, undefined, { numeric: true }));
      }

      console.log('[MyPatients DEBUG] matchCount:', matchCount, 'result keys:', Object.keys(result));
      this.patientListByShift.set(result);
    } catch (error) {
      console.error('載入今日病人資料失敗:', error);
      this.patientListByShift.set({});
    } finally {
      this.isLoading.set(false);
    }
  }

  reloadData(): void {
    this.fetchMyPatientData(this.selectedDate());
  }

  private async loadSelectableUsers(force = false): Promise<void> {
    if (!this.canSwitchUser()) {
      this.selectableUsers.set([]);
      return;
    }

    const now = Date.now();
    if (
      !force &&
      this.selectableUsers().length > 0 &&
      now - this.lastSelectableUsersUpdatedAt < this.SELECTABLE_USERS_TTL
    ) {
      return;
    }

    try {
      await this.userDirectory.ensureUsersLoaded();
      const allUsers = this.userDirectory.allUsers();
      const filteredUsers = allUsers
        .filter(
          (user) =>
            ['護理師', '護理師組長'].includes(user.title) && user.username
        )
        .map((user) => ({
          uid: user.uid,
          name: user.name,
          username: user.username!,
        }));

      this.selectableUsers.set(
        filteredUsers.sort((a, b) => {
          const idA = parseInt(a.username, 10);
          const idB = parseInt(b.username, 10);
          if (!isNaN(idA) && !isNaN(idB)) {
            return idA - idB;
          }
          return String(a.username).localeCompare(String(b.username), undefined, {
            numeric: true,
          });
        })
      );
      this.lastSelectableUsersUpdatedAt = now;
    } catch (error) {
      console.error('無法載入使用者列表:', error);
    }
  }

  // --- Dialog Event Handlers ---
  openCreateModal(itemToEdit: any = null): void {
    if (!this.hasPermission('viewer')) {
      this.notificationService.createNotification(
        '您的權限不足，無法執行此操作。',
        'error'
      );
      return;
    }
    this.editingItem.set(itemToEdit);
    this.isCreateModalVisible.set(true);
  }

  closeCreateModal(): void {
    this.isCreateModalVisible.set(false);
    this.editingItem.set(null);
  }

  async handleTaskSubmit(data: any): Promise<void> {
    const user = this.currentUser();
    const tasksApi = this.apiManagerService.create<FirestoreRecord>('tasks');

    if (data.id) {
      // Edit mode
      const { id, ...updateData } = data;
      try {
        await tasksApi.update(id, updateData);
        this.notificationService.createNotification('備忘已更新', 'success');
      } catch (error) {
        console.error('更新項目失敗:', error);
        this.notificationService.createNotification(
          '更新失敗，請稍後再試',
          'error'
        );
      }
    } else {
      // Create mode
      try {
        await handleTaskCreated(data, user);
        this.notificationService.createNotification(
          '交辦/留言已成功新增！',
          'success'
        );
      } catch (error: any) {
        console.error('新增項目失敗:', error);
        this.notificationService.createNotification(
          `新增失敗: ${error.message}`,
          'error'
        );
      }
    }
    this.closeCreateModal();
  }

  async updateTaskStatus(task: any, newStatus: string): Promise<void> {
    const user = this.currentUser();
    if (!user) return;
    try {
      const tasksApi = this.apiManagerService.create<FirestoreRecord>('tasks');
      await tasksApi.update(task.id, {
        status: newStatus,
        resolvedBy: { uid: user.uid, name: user.name },
        resolvedAt: new Date().toISOString(),
      });
      this.notificationService.createNotification(
        newStatus === 'completed' ? '狀態已更新為已讀' : '狀態已移回待辦',
        'success'
      );
    } catch (error) {
      console.error('更新任務狀態失敗:', error);
      this.notificationService.createNotification(
        '更新失敗，請稍後再試',
        'error'
      );
    }
  }

  confirmDeleteTask(item: any): void {
    this.itemToDelete.set(item);
    this.isConfirmDeleteVisible.set(true);
  }

  async executeDeleteTask(): Promise<void> {
    const item = this.itemToDelete();
    if (!item) return;
    try {
      const tasksApi = this.apiManagerService.create<FirestoreRecord>('tasks');
      await tasksApi.delete(item.id);
      this.notificationService.createNotification('訊息已刪除', 'info');
    } catch (error) {
      console.error('刪除任務失敗:', error);
      this.notificationService.createNotification(
        '刪除失敗，請稍後再試',
        'error'
      );
    }
    this.isConfirmDeleteVisible.set(false);
    this.itemToDelete.set(null);
  }

  openEditModal(itemToEdit: any): void {
    this.openCreateModal(itemToEdit);
  }

  openOrderModal(patientFromList: MyPatientItem): void {
    const allPatients = this.patientStore.allPatients();
    const fullPatientData = allPatients.find(
      (p) => p.id === patientFromList.patientId
    );
    if (fullPatientData) {
      this.selectedPatientForOrder.set(fullPatientData);
      this.isOrderModalVisible.set(true);
    } else {
      console.error('找不到完整的病人資料:', patientFromList.patientId);
      this.notificationService.createNotification(
        '無法載入病人醫囑，請稍後再試',
        'error'
      );
    }
  }

  // 產生床邊儀表板網址。模板以真正的 <a target="_blank"> 開新分頁，
  // 由使用者真實點擊原生開啟，避免 window.open 被瀏覽器彈窗封鎖。
  bedDashboardUrl(patientFromList: MyPatientItem, shiftCode: string): string {
    if (!patientFromList?.id) return '';
    const bedKey = patientFromList.id.replace(/-(early|noon|late)$/i, '');
    const dashboardShift = shiftCode.startsWith('noon') ? 'noon' : shiftCode;
    return this.router.serializeUrl(
      this.router.createUrlTree(['/bed-dashboard', bedKey], {
        queryParams: {
          date: this.selectedDate(),
          shift: dashboardShift,
        },
      }),
    );
  }

  closeOrderModal(): void {
    this.isOrderModalVisible.set(false);
    this.selectedPatientForOrder.set(null);
  }

  async handleOrderSave(updatedOrders: any): Promise<void> {
    const patient = this.selectedPatientForOrder();
    if (!patient) return;

    try {
      await createDialysisOrderAndUpdatePatient(patient.id, patient.name, updatedOrders);

      this.notificationService.createNotification(
        `${patient.name} 的醫囑已更新`,
        'success'
      );
      this.patientStore.updatePatientInStore(patient.id, {
        dialysisOrders: updatedOrders,
      });
      this.closeOrderModal();
      // Refresh cards and supply summary with updated orders
      this.reloadData();
    } catch (error) {
      console.error('儲存醫囑失敗:', error);
      this.notificationService.createNotification(
        '醫囑儲存失敗，請檢查網路連線',
        'error'
      );
    }
  }

  onCancelConfirmDelete(): void {
    this.isConfirmDeleteVisible.set(false);
  }
}
