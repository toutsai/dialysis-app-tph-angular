import { Component, Input, Output, EventEmitter, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiManagerService, type ApiManager, type FirestoreRecord } from '@app/core/services/api-manager.service';
import { UserDirectoryService } from '@app/core/services/user-directory.service';
import { addDaysToDateString, getTaipeiWeekdayIndex, getToday } from '@/utils/dateUtils';
import {
  HEPATITIS_OPTIONS,
  INFECTION_KEYS,
  INFECTION_META,
  dateKeyOf,
  normalizeHepatitisStatus,
  syncTagsFromHepatitis,
  upgradeHepatitisStatus,
  type HepatitisStatus,
  type HepatitisValue,
  type InfectionDateKey,
  type InfectionKey,
} from '@/utils/hepatitis';

@Component({
  selector: 'app-patient-form-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './patient-form-modal.component.html',
  styleUrl: './patient-form-modal.component.css'
})
export class PatientFormModalComponent implements OnInit {
  private readonly apiManager = inject(ApiManagerService);
  private readonly userDirectory = inject(UserDirectoryService);
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

  /** 主治醫師偏好排序；未列名者依姓名排在其後。後備清單（使用者目錄載入失敗時沿用）。 */
  private readonly PHYSICIAN_ORDER = ['廖丁瑩', '蔡宜潔', '蘇哲弘', '蔡亨政', '林天佑', '陳怡汝'];
  /** 會診/收案醫師選單：連動使用者管理「職稱=主治醫師」名單（見 loadPhysicians）。 */
  PHYSICIANS: string[] = [...this.PHYSICIAN_ORDER];
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
  // HBV/HCV/HIV/RPR（與待追蹤）標籤皆由「血液傳染病」四項四態衍生（2026-08-30），此清單只剩其他標籤；
  // C肝治癒獨立保留（治癒後 Anti-HCV 仍陽性）
  readonly DISEASES = ['C肝治癒', 'COVID', '隔離'];
  readonly HEPATITIS_OPTIONS = HEPATITIS_OPTIONS;
  readonly INFECTION_FIELDS: { key: InfectionKey; dateKey: InfectionDateKey; label: string }[] = INFECTION_KEYS.map(
    (key) => ({ key, dateKey: dateKeyOf(key), label: INFECTION_META[key].label }),
  );

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
    // 血液傳染病四項四態：既有病人缺項（舊兩項格式）由標籤補齊；新病人預設空白（未填）強迫組長確認
    data.hepatitisStatus = data.id
      ? upgradeHepatitisStatus(data.hepatitisStatus, data.diseases)
      : normalizeHepatitisStatus(data.hepatitisStatus || {});
    data.patientStatus = data.patientStatus || {
      isFirstDialysis: { active: false, date: null },
      isPaused: { active: false, date: null },
      hasBloodDraw: { active: false, date: null },
      hospitalFirstDialysis: { active: false, date: null },
    };
    data.hospitalInfo = data.hospitalInfo || { source: '', transferOut: '' };
    this.form = data;
    this.ensurePatientStatus();
    // 刻意不從 firstDialysisDate 自動點亮首透標記：開窗要忠實顯示「已存檔」的狀態，
    // 否則與清單星星不同步（蕭修銘案 2026-08-12）；且此欄位對轉入病人是他院初透日期，
    // 有日期≠本院首透。要標記首透請點狀態晶片。
    this.loadPhysicians();
  }

  /** 從使用者管理載入「職稱=主治醫師」名單作為會診/收案醫師選項，依偏好順序排序。 */
  private async loadPhysicians(): Promise<void> {
    try {
      await this.userDirectory.fetchUsersIfNeeded();
      const names = this.userDirectory.allUsers()
        .filter((u) => u.title === '主治醫師' && u.isActive !== false)
        .map((u) => u.name)
        .filter((name): name is string => !!name);
      // 保留目前病人已選但已不在名單中的醫師，避免選單顯示空白
      const current = this.form?.physician;
      if (current && !names.includes(current)) names.push(current);
      names.sort((a, b) => {
        const ia = this.PHYSICIAN_ORDER.indexOf(a);
        const ib = this.PHYSICIAN_ORDER.indexOf(b);
        if (ia === -1 && ib === -1) return a.localeCompare(b);
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        return ia - ib;
      });
      if (names.length > 0) this.PHYSICIANS = Array.from(new Set(names));
    } catch {
      // 使用者目錄載入失敗時保留初始後備清單
    }
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

  get hepatitis(): HepatitisStatus {
    return this.form.hepatitisStatus;
  }

  setHepatitis(key: InfectionKey, value: HepatitisValue): void {
    const status = this.hepatitis;
    status[key] = status[key] === value ? '' : value;
    // 未做（O）或清空 → 檢驗日期無意義，一併清掉；Y/N/F 保留（切換陰/陽不必重填日期）
    if (!status[key] || status[key] === 'O') status[dateKeyOf(key)] = '';
  }

  /** 檢驗日期缺漏（Y/N/F 皆應填）：高亮該列，存檔時擋下 */
  isInfectionDateMissing(key: InfectionKey): boolean {
    const v = this.hepatitis?.[key];
    return !!v && v !== 'O' && !this.hepatitis[dateKeyOf(key)];
  }

  toggleStatus(key: string): void {
    if (this.form.patientStatus && this.form.patientStatus[key]) {
      const status = this.form.patientStatus[key];
      status.active = !status.active;
      if (key === 'isFirstDialysis' && status.active && !status.date && this.form.firstDialysisDate) {
        status.date = this.form.firstDialysisDate;
      }
      // 首透 ⇒ 本院初透 連動（人生首透在本院，必為本院第一次）
      if (key === 'isFirstDialysis' && status.active) {
        this.ensurePatientStatus();
        const h = this.form.patientStatus.hospitalFirstDialysis;
        h.active = true;
        if (!h.date) h.date = status.date || null;
      }
      // 勾任一初透標記即非「反覆住院」
      if ((key === 'isFirstDialysis' || key === 'hospitalFirstDialysis') && status.active) {
        this.clearRepeatAdmissionMark();
      }
      if (!status.active) status.date = null;
    }
  }

  /** 透析來源=反覆住院（外院+本院都透析過的舊病人）；存檔時由 syncDialysisOrigin 補 setBy/setAt */
  isRepeatAdmission(): boolean {
    return this.form.patientStatus?.dialysisOrigin?.type === 'repeat';
  }

  toggleRepeatAdmission(): void {
    this.ensurePatientStatus();
    const ps = this.form.patientStatus;
    if (this.isRepeatAdmission()) {
      // 取消判定 → 回到未判定（清除履歷 type，保留日期欄位）
      ps.dialysisOrigin = { ...(ps.dialysisOrigin || {}), type: null };
    } else {
      ps.isFirstDialysis = { active: false, date: null };
      ps.hospitalFirstDialysis = { active: false, date: null };
      ps.dialysisOrigin = { ...(ps.dialysisOrigin || {}), type: 'repeat' };
    }
  }

  private clearRepeatAdmissionMark(): void {
    const origin = this.form.patientStatus?.dialysisOrigin;
    if (origin?.type === 'repeat') origin.type = null;
  }

  handleFirstDialysisDateChange(date: string | null): void {
    this.syncFirstDialysisStatus(date, true);
  }

  private ensurePatientStatus(): void {
    this.form.patientStatus = this.form.patientStatus || {};
    this.form.patientStatus.isFirstDialysis = this.form.patientStatus.isFirstDialysis || { active: false, date: null };
    this.form.patientStatus.isPaused = this.form.patientStatus.isPaused || { active: false, date: null };
    this.form.patientStatus.hasBloodDraw = this.form.patientStatus.hasBloodDraw || { active: false, date: null };
    // 本院初透：第一次在本院透析（含外院轉入），供 KiDit 建檔追蹤；與「首透」（人生第一次透析）語意不同
    this.form.patientStatus.hospitalFirstDialysis = this.form.patientStatus.hospitalFirstDialysis || { active: false, date: null };
    this.form.patientStatus.doNotMove = this.form.patientStatus.doNotMove || { active: false, reason: '' };
    // 勿動日期區間欄位（向後相容：舊資料無 rangeType → 視為持續）
    const dnm = this.form.patientStatus.doNotMove;
    if (!dnm.rangeType) dnm.rangeType = 'permanent';
    if (dnm.startDate === undefined) dnm.startDate = null;
    if (dnm.endDate === undefined) dnm.endDate = null;
  }

  /** 切換「勿動」鎖定；關閉時清除原因 */
  toggleDoNotMove(): void {
    this.ensurePatientStatus();
    const status = this.form.patientStatus.doNotMove;
    status.active = !status.active;
    if (!status.active) status.reason = '';
  }

  /** 設定勿動的日期區間模式：持續 / 單日 / 區間 */
  setDoNotMoveRange(type: 'day' | 'range' | 'permanent'): void {
    this.ensurePatientStatus();
    const dnm = this.form.patientStatus.doNotMove;
    dnm.rangeType = type;
    if (type !== 'permanent') {
      if (!dnm.startDate) dnm.startDate = getToday();
      if (type === 'range' && !dnm.endDate) dnm.endDate = dnm.startDate;
    }
  }

  /**
   * 依「首次透析日期」欄同步巢狀首透標記的日期。
   * 預設不自動開啟 active（有日期≠首透，轉入病人存的是他院日期）；
   * activate=true 只給首透連續洗計畫等明確首透情境用。
   */
  private syncFirstDialysisStatus(date: string | null | undefined, forceDate = false, activate = false): void {
    this.ensurePatientStatus();
    const status = this.form.patientStatus.isFirstDialysis;
    if (activate && date) status.active = true;
    if (!status.active) return;
    if (date) {
      if (forceDate || !status.date) status.date = date;
    } else if (forceDate) {
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
    this.syncFirstDialysisStatus(this.firstPlan.startDate, true, true);
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
    // 初透狀態開啟時必須有初透日期（衛教紀錄預帶靠此日期為錨點，避免半套狀態）
    const firstDialysis = this.form.patientStatus?.isFirstDialysis;
    if (firstDialysis?.active) {
      // 補救：上方初透日期欄位已填但巢狀 date 未同步時，先補進去
      if (!firstDialysis.date && this.form.firstDialysisDate) {
        firstDialysis.date = this.form.firstDialysisDate;
      }
      if (!firstDialysis.date) {
        alert('已開啟「初次透析」狀態，請填寫初次透析日期！');
        return;
      }
    }
    // 血液傳染病四項必填（組長建檔即確認；B/C 由此帶入 KiDit 病史 33/34），Y/N/F 另須檢驗日期
    const missingValue = INFECTION_KEYS.filter((k) => !this.hepatitis?.[k]).map((k) => INFECTION_META[k].label);
    if (missingValue.length > 0) {
      alert(`請確認血液傳染病狀態：${missingValue.join('、')} 尚未選擇！`);
      return;
    }
    const missingDate = INFECTION_KEYS.filter((k) => this.isInfectionDateMissing(k)).map((k) => INFECTION_META[k].label);
    if (missingDate.length > 0) {
      alert(`請填寫檢驗日期：${missingDate.join('、')}（陽性／陰性／待追蹤皆須填）！`);
      return;
    }
    this.form.hepatitisStatus = normalizeHepatitisStatus(this.hepatitis);
    // 標籤由四態衍生：排程備註 B/C/H/R（待追蹤 B?/C?/H?/R?）、護理分組肝炎優先、清單統計沿用 diseases 標籤
    this.form.diseases = syncTagsFromHepatitis(this.form.diseases, this.form.hepatitisStatus);
    this.save.emit(this.form);
  }
}
