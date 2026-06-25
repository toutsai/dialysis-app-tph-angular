import { Component, Input, Output, EventEmitter, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiManagerService, type ApiManager, type FirestoreRecord } from '@app/core/services/api-manager.service';
import { addDaysToDateString, getTaipeiWeekdayIndex, getToday } from '@/utils/dateUtils';

@Component({
  selector: 'app-patient-form-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './patient-form-modal.component.html',
  styleUrl: './patient-form-modal.component.css'
})
export class PatientFormModalComponent implements OnInit {
  private readonly apiManager = inject(ApiManagerService);
  private readonly baseSchedulesApi: ApiManager<FirestoreRecord>;
  private readonly schedulesApi: ApiManager<FirestoreRecord>;

  @Input() patientData: any = {};
  @Input() patientType = '';
  @Output() close = new EventEmitter<void>();
  @Output() save = new EventEmitter<any>();

  form: any = {};
  isFirstPlanVisible = false;
  firstPlanLoading = false;
  firstPlanError = '';
  masterRules: Record<string, any> = {};
  dailySchedules: Record<string, Record<string, any>> = {};
  firstPlan: any = {
    startDate: '',
    continuousDays: 3,
    regularFreq: '',
    regularAssignment: null,
    selectedExtraDate: '',
    extraSessions: [],
  };

  readonly PHYSICIANS = ['廖丁瑩', '蔡宜潔', '蘇哲弘', '蔡亨政'];
  readonly FREQ_OPTIONS = [
    '一三五', '二四六', '一四', '二五', '三六',
    '一五', '二六', '每日',
    '每周一', '每周二', '每周三', '每周四', '每周五', '每周六',
    '臨時',
  ];
  readonly MODES = ['HD', 'SLED', 'CVVHDF', 'PP', 'DFPP', 'Lipid'];
  readonly SHIFTS = ['early', 'noon', 'late'];
  readonly SHIFT_LABELS: Record<string, string> = { early: '早班', noon: '午班', late: '晚班' };
  readonly WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六'];
  readonly HEPATITIS_BEDS = [31, 32, 33, 35, 36];
  readonly BED_LAYOUT: (number | string)[] = [
    1, 2, 3, 5, 6, 7, 8, 9, 11, 12, 13, 15, 16, 17, 18, 19,
    21, 22, 23, 25, 26, 27, 28, 29, 31, 32, 33, 35, 36, 37, 38, 39,
    51, 52, 53, 55, 56, 57, 58, 59, 61, 62, 63, 65,
    ...Array.from({ length: 6 }, (_, i) => `peripheral-${i + 1}`),
  ];
  readonly FREQ_MAP_TO_DAY_INDEX: Record<string, number[]> = {
    '一三五': [0, 2, 4],
    '二四六': [1, 3, 5],
    '一四': [0, 3],
    '二五': [1, 4],
    '三六': [2, 5],
    '一五': [0, 4],
    '二六': [1, 5],
    '每日': [0, 1, 2, 3, 4, 5],
    '每周一': [0],
    '每周二': [1],
    '每周三': [2],
    '每周四': [3],
    '每周五': [4],
    '每周六': [5],
  };
  readonly VASC_ACCESSES = ['Double lumen', 'PERM', '左臂AVF', '右臂AVF', '左臂AVG', '右臂AVG'];
  readonly DISEASES = ['HIV', 'RPR', 'BC肝?', 'HBV', 'HCV', 'C肝治癒', 'COVID', '隔離'];

  constructor() {
    this.baseSchedulesApi = this.apiManager.create<FirestoreRecord>('base_schedules');
    this.schedulesApi = this.apiManager.create<FirestoreRecord>('schedules');
  }

  get isEditing(): boolean {
    return !!(this.form && this.form.id);
  }

  get patientTypeText(): string {
    const map: Record<string, string> = { ipd: '住院', opd: '門診', er: '急診' };
    return map[this.patientType] || '';
  }

  ngOnInit(): void {
    document.body.classList.add('modal-open');
    const data = JSON.parse(JSON.stringify(this.patientData || {}));
    if (!data.id) {
      data.status = this.patientType;
      data.patientCategory = this.patientType === 'opd' ? 'opd_regular' : 'non_regular';
    }
    if (!data.patientCategory) data.patientCategory = 'opd_regular';
    data.diseases = data.diseases || [];
    data.patientStatus = data.patientStatus || {
      isFirstDialysis: { active: false, date: null },
      isPaused: { active: false, date: null },
      hasBloodDraw: { active: false, date: null },
    };
    data.hospitalInfo = data.hospitalInfo || { source: '', transferOut: '' };
    this.form = data;
    this.ensurePatientStatus();
    this.syncFirstDialysisStatus(this.form.firstDialysisDate);
  }

  toggleDisease(disease: string): void {
    const index = (this.form.diseases || []).indexOf(disease);
    if (index > -1) {
      this.form.diseases.splice(index, 1);
    } else {
      this.form.diseases.push(disease);
    }
  }

  isDiseaseSelected(disease: string): boolean {
    return (this.form.diseases || []).includes(disease);
  }

  toggleStatus(key: string): void {
    if (this.form.patientStatus && this.form.patientStatus[key]) {
      const status = this.form.patientStatus[key];
      status.active = !status.active;
      if (key === 'isFirstDialysis' && status.active && !status.date && this.form.firstDialysisDate) {
        status.date = this.form.firstDialysisDate;
      }
      if (!status.active) status.date = null;
    }
  }

  handleFirstDialysisDateChange(date: string | null): void {
    this.syncFirstDialysisStatus(date, true);
  }

  private ensurePatientStatus(): void {
    this.form.patientStatus = this.form.patientStatus || {};
    this.form.patientStatus.isFirstDialysis = this.form.patientStatus.isFirstDialysis || { active: false, date: null };
    this.form.patientStatus.isPaused = this.form.patientStatus.isPaused || { active: false, date: null };
    this.form.patientStatus.hasBloodDraw = this.form.patientStatus.hasBloodDraw || { active: false, date: null };
    this.form.patientStatus.doNotMove = this.form.patientStatus.doNotMove || { active: false, reason: '' };
  }

  /** 切換「勿動」鎖定；關閉時清除原因 */
  toggleDoNotMove(): void {
    this.ensurePatientStatus();
    const status = this.form.patientStatus.doNotMove;
    status.active = !status.active;
    if (!status.active) status.reason = '';
  }

  private syncFirstDialysisStatus(date: string | null | undefined, forceDate = false): void {
    this.ensurePatientStatus();
    const status = this.form.patientStatus.isFirstDialysis;
    if (date) {
      status.active = true;
      if (forceDate || !status.date) status.date = date;
    } else if (forceDate && status.active) {
      status.date = null;
    }
  }

  async openFirstDialysisPlan(): Promise<void> {
    const previousPlan = this.form.firstDialysisPlan || this.form.dialysisOrders?.firstDialysisPlan || null;
    const previousRegularRule = previousPlan?.regularRule || null;
    const previousShiftCode = previousRegularRule?.shiftCode
      || (Number.isInteger(previousRegularRule?.shiftIndex) ? this.SHIFTS[previousRegularRule.shiftIndex] : null);
    const previousRegularAssignment = previousRegularRule?.bedNum && previousShiftCode
      ? { bedNum: previousRegularRule.bedNum, shiftCode: previousShiftCode }
      : null;
    const previousExtraSessions = Array.isArray(previousPlan?.extraSessions)
      ? previousPlan.extraSessions.map((item: any) => ({
          date: item.date,
          bedNum: item.bedNum,
          shiftCode: item.shiftCode,
          reason: item.reason || '首透連續洗臨時加洗',
        }))
      : [];

    this.firstPlan = {
      startDate: previousPlan?.startDate || this.form.firstDialysisDate || getToday(),
      continuousDays: previousPlan?.continuousDays || 3,
      regularFreq: previousRegularRule?.freq || this.form.freq || '一三五',
      regularAssignment: previousRegularAssignment,
      selectedExtraDate: previousExtraSessions[0]?.date || '',
      extraSessions: previousExtraSessions,
    };
    this.firstPlanError = '';
    this.isFirstPlanVisible = true;
    await this.loadMasterRules();
    if (this.firstPlan.selectedExtraDate) {
      await this.loadDailyScheduleForFirstPlanDate(this.firstPlan.selectedExtraDate);
    }
  }

  async loadMasterRules(): Promise<void> {
    this.firstPlanLoading = true;
    try {
      const master = await this.baseSchedulesApi.fetchById('MASTER_SCHEDULE');
      this.masterRules = (master?.['schedule'] as Record<string, any>) || {};
    } catch (error: any) {
      this.firstPlanError = `無法載入床位總表：${error.message || error}`;
    } finally {
      this.firstPlanLoading = false;
    }
  }

  closeFirstDialysisPlan(): void {
    this.isFirstPlanVisible = false;
  }

  private async loadDailyScheduleForFirstPlanDate(date: string): Promise<void> {
    if (!date || this.dailySchedules[date]) return;
    this.firstPlanLoading = true;
    try {
      const daySchedule = await this.schedulesApi.fetchById(date);
      this.dailySchedules[date] = (daySchedule?.['schedule'] as Record<string, any>) || {};
    } catch {
      this.dailySchedules[date] = {};
    } finally {
      this.firstPlanLoading = false;
    }
  }

  private getFreqDays(freq: string | undefined | null): number[] {
    if (!freq) return [];
    const direct = this.FREQ_MAP_TO_DAY_INDEX[freq];
    if (direct) return direct;
    const daysByOptionIndex = [
      [0, 2, 4], [1, 3, 5], [0, 3], [1, 4], [2, 5],
      [0, 4], [1, 5], [0, 1, 2, 3, 4, 5],
      [0], [1], [2], [3], [4], [5],
    ];
    const index = this.FREQ_OPTIONS.indexOf(freq);
    return daysByOptionIndex[index] || [];
  }

  private isRegularFirstPlanDate(dateStr: string): boolean {
    if (!dateStr) return false;
    const weekdayIndex = getTaipeiWeekdayIndex(dateStr);
    return this.getFreqDays(this.firstPlan.regularFreq).includes(weekdayIndex);
  }

  get regularAvailableBeds(): Record<string, (number | string)[]> {
    const result: Record<string, (number | string)[]> = { early: [], noon: [], late: [] };
    const days = this.getFreqDays(this.firstPlan.regularFreq);
    if (days.length === 0) return result;
    this.BED_LAYOUT.forEach((bedNum) => {
      this.SHIFTS.forEach((shiftCode, shiftIndex) => {
        const conflict = Object.entries(this.masterRules || {}).some(([patientId, rule]: [string, any]) => {
          if (patientId === this.form.id) return false;
          if (String(rule?.bedNum) !== String(bedNum)) return false;
          if (Number(rule?.shiftIndex) !== shiftIndex) return false;
          const otherDays = this.getFreqDays(rule?.freq);
          return days.some((day) => otherDays.includes(day));
        });
        if (!conflict) result[shiftCode].push(bedNum);
      });
    });
    return result;
  }

  get continuousDates(): any[] {
    if (!this.firstPlan.startDate) return [];
    const count = Math.max(1, Math.min(Number(this.firstPlan.continuousDays) || 3, 6));
    return Array.from({ length: count }, (_, index) => {
      const date = addDaysToDateString(this.firstPlan.startDate, index);
      const weekdayIndex = getTaipeiWeekdayIndex(date);
      return {
        date,
        weekdayIndex,
        weekdayLabel: weekdayIndex >= 0 ? this.WEEKDAY_LABELS[weekdayIndex] : '日',
        isRegular: this.getFreqDays(this.firstPlan.regularFreq).includes(weekdayIndex),
      };
    }).filter((item) => item.weekdayIndex >= 0 && item.weekdayIndex < 6);
  }

  get selectedExtraSession(): any {
    return this.firstPlan.extraSessions.find((item: any) => item.date === this.firstPlan.selectedExtraDate) || null;
  }

  async selectExtraDate(date: string): Promise<void> {
    const dateInfo = this.continuousDates.find((item) => item.date === date);
    if (!dateInfo || dateInfo.isRegular || this.isRegularFirstPlanDate(date)) return;
    this.firstPlan.selectedExtraDate = date;
    await this.loadDailyScheduleForFirstPlanDate(date);
    if (!this.selectedExtraSession) {
      this.firstPlan.extraSessions.push({ date, bedNum: null, shiftCode: null });
    }
  }

  get extraAvailableBeds(): Record<string, (number | string)[]> {
    const result: Record<string, (number | string)[]> = { early: [], noon: [], late: [] };
    const date = this.firstPlan.selectedExtraDate;
    if (!date) return result;
    const schedule = this.dailySchedules[date] || {};
    this.BED_LAYOUT.forEach((bedNum) => {
      this.SHIFTS.forEach((shiftCode) => {
        const slotKey = this.getDailySlotKey(bedNum, shiftCode);
        const occupant = schedule[slotKey];
        if (!occupant?.patientId || occupant.patientId === this.form.id) result[shiftCode].push(bedNum);
      });
    });
    return result;
  }

  selectRegularBed(bedNum: number | string, shiftCode: string): void {
    this.firstPlan.regularAssignment = { bedNum, shiftCode };
  }

  selectExtraBed(bedNum: number | string, shiftCode: string): void {
    const session = this.selectedExtraSession;
    if (!session) return;
    session.bedNum = bedNum;
    session.shiftCode = shiftCode;
  }

  removeExtraSession(date: string, event?: Event): void {
    event?.stopPropagation();
    this.firstPlan.extraSessions = this.firstPlan.extraSessions.filter((item: any) => item.date !== date);
    if (this.firstPlan.selectedExtraDate === date) this.firstPlan.selectedExtraDate = '';
  }

  applyFirstDialysisPlan(): void {
    if (!this.firstPlan.regularFreq || !this.firstPlan.regularAssignment) {
      this.firstPlanError = '請選擇常規頻率與常規床位。';
      return;
    }
    const validExtraDates = new Set(this.continuousDates.filter((item) => !item.isRegular).map((item) => item.date));
    const extraSessions = this.firstPlan.extraSessions.filter((item: any) => validExtraDates.has(item.date));
    if (extraSessions.some((item: any) => !item.bedNum || !item.shiftCode)) {
      this.firstPlanError = '請完成每個加洗日的床位選擇，或移除不需要的加洗日。';
      return;
    }
    this.form.freq = this.firstPlan.regularFreq;
    this.form.firstDialysisDate = this.firstPlan.startDate;
    this.syncFirstDialysisStatus(this.firstPlan.startDate, true);
    this.form.firstDialysisPlan = {
      startDate: this.firstPlan.startDate,
      continuousDays: this.firstPlan.continuousDays,
      regularRule: {
        freq: this.firstPlan.regularFreq,
        ...this.firstPlan.regularAssignment,
      },
      extraSessions: extraSessions.map((item: any) => ({
        date: item.date,
        bedNum: item.bedNum,
        shiftCode: item.shiftCode,
        reason: '首透連續洗臨時加洗',
      })),
    };
    this.isFirstPlanVisible = false;
  }

  hasExtraSession(date: string): boolean {
    return this.firstPlan.extraSessions.some((item: any) => item.date === date);
  }

  isHepatitisBed(bedNum: number | string): boolean {
    return typeof bedNum === 'number' && this.HEPATITIS_BEDS.includes(bedNum);
  }

  getDailySlotKey(bedNum: number | string, shiftCode: string): string {
    return typeof bedNum === 'string' && bedNum.startsWith('peripheral-')
      ? `${bedNum}-${shiftCode}`
      : `bed-${bedNum}-${shiftCode}`;
  }

  formatBed(bedNum: number | string): string {
    return typeof bedNum === 'string' ? `外圍 ${String(bedNum).replace('peripheral-', '')}` : `${bedNum}床`;
  }

  formatAssignment(assignment: any): string {
    if (!assignment?.bedNum || !assignment?.shiftCode) return '未選擇';
    return `${this.formatBed(assignment.bedNum)} ${this.SHIFT_LABELS[assignment.shiftCode] || assignment.shiftCode}`;
  }

  formatExtraSessionsSummary(sessions: any[] = []): string {
    const validSessions = (sessions || []).filter((item) => item?.date);
    if (validSessions.length === 0) return '無';
    return validSessions
      .map((item) => `${item.date} ${this.formatAssignment(item)}`)
      .join('、');
  }

  closeModal(): void {
    document.body.classList.remove('modal-open');
    this.close.emit();
  }

  handleSave(): void {
    if (!this.form.name || !this.form.medicalRecordNumber) {
      alert('姓名和病歷號為必填項！');
      return;
    }
    this.save.emit(this.form);
  }
}
