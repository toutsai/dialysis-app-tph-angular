// 重大傷病申請工作檯：初次/再次兩頁籤，選病人自動帶入基本資料與最近檢驗值，
// 儲存至 catastrophic_illness_applications，並可依官方附表版面列印匯出
// 權限：admin/contributor（醫師與專師）可寫表單；viewer（書記）僅進度總覽＋填送出日期/到期日
import { Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '@services/api.service';
import { ApiManagerService, type ApiManagerCrud } from '@services/api-manager.service';
import { AuthService } from '@services/auth.service';
import { PatientStoreService, type Patient } from '@services/patient-store.service';
import { UserDirectoryService } from '@app/core/services/user-directory.service';
import {
  CatastrophicFormData,
  createEmptyFormData,
  SYMPTOM_OPTIONS,
  COMORBIDITY_OPTIONS,
  ULTRASOUND_OPTIONS,
  RESTART_REASON_OPTIONS,
  PRIMARY_DISEASE_CODES,
} from './catastrophic-illness.constants';
import { buildInitialPrintHtml, buildRenewalPrintHtml, openPrintWindow } from './catastrophic-illness-print';

type AppType = 'initial' | 'renewal';

interface CiApplication {
  id: string;
  patientId: string;
  patientName: string;
  applicationType: AppType;
  formData: Partial<CatastrophicFormData>;
  createdBy?: { name?: string };
  updatedBy?: { name?: string };
  createdAt?: string;
  updatedAt?: string;
}

interface LabReportRecord {
  reportDate?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

interface CiOverviewSlot {
  id: string;
  physicianDate: string;
  physicianName: string;
  clerkSentDate: string;
  /** 書記補登的紙本申請（醫師未在系統建表）：完成日期欄顯示「紙本」 */
  paper?: boolean;
}

/** 書記補登紙本申請的 form_data.source 標記（與後端 PAPER_SOURCE 一致） */
const PAPER_SOURCE = 'clerk_paper';

interface CiOverviewRow {
  patientId: string;
  patientName: string;
  physicianName: string;
  /** 第 1 筆＝初次，之後依序再次/三次/四次…（缺該次時為 null） */
  applications: (CiOverviewSlot | null)[];
  expiryDate: string;
  renewalRegisteredDate: string;
  renewalFormDate: string;
  renewalDocsDate: string;
  latestUpdatedAt: string;
}

/** 申請次數欄位標題：有幾次就顯示幾欄 */
const APPLICATION_ORDINALS = ['初次', '再次', '三次', '四次', '五次', '六次', '七次', '八次', '九次', '十次'];

/** 到期續辦準備追蹤欄（書記填日期；API body key → 總覽列欄位） */
type RenewalPrepKey = 'registeredDate' | 'formDate' | 'docsDate';
const RENEWAL_PREP_PROPS: Record<RenewalPrepKey, 'renewalRegisteredDate' | 'renewalFormDate' | 'renewalDocsDate'> = {
  registeredDate: 'renewalRegisteredDate',
  formDate: 'renewalFormDate',
  docsDate: 'renewalDocsDate',
};

@Component({
  selector: 'app-catastrophic-illness',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './catastrophic-illness.component.html',
  styleUrls: ['./catastrophic-illness.component.css'],
})
export class CatastrophicIllnessComponent implements OnInit {
  readonly SYMPTOM_OPTIONS = SYMPTOM_OPTIONS;
  readonly COMORBIDITY_OPTIONS = COMORBIDITY_OPTIONS;
  readonly ULTRASOUND_OPTIONS = ULTRASOUND_OPTIONS;
  readonly RESTART_REASON_OPTIONS = RESTART_REASON_OPTIONS;
  readonly PRIMARY_DISEASE_CODES = PRIMARY_DISEASE_CODES;

  // 申請進度總覽（醫師看自己寫的；admin/書記(viewer)看全部並可填書記欄）
  overviewRows = signal<CiOverviewRow[]>([]);
  overviewLoading = false;
  overviewCollapsed = false; // 開啟申請表時自動收合，避免疊在表單上；可手動展開
  isClerk = false; // admin/viewer：可填書記送出日期與到期日
  canWrite = false; // admin/contributor：可選病人寫申請表

  // 病人選擇
  searchText = '';
  showDropdown = false;
  filteredPatients: Patient[] = []; // 模板勿用 getter 重算（CD 週期效能）
  selectedPatient = signal<Patient | null>(null);

  // 書記新增到期日（舊病人在系統外已辦過重大傷病、無申請紀錄，直接補到期日進入追蹤）
  expirySearchText = '';
  expiryShowDropdown = false;
  expiryFilteredPatients: Patient[] = [];
  expiryPickedPatient: Patient | null = null;
  newExpiryDate = '';
  newExpiryPhysician = ''; // 補登時一併指定負責醫師（到期提醒卡「協助掛 {醫師}」用）
  newSentDate = ''; // 補登紙本送出日期（醫師手寫附表、未在系統建表）：建一筆紙本佔位申請
  addingExpiry = false;

  /** 主治醫師偏好排序；後備清單（使用者目錄載入失敗時沿用）。比照 patient-form-modal。 */
  private readonly PHYSICIAN_ORDER = ['廖丁瑩', '蔡宜潔', '蘇哲弘', '蔡亨政', '林天佑', '陳怡汝'];
  /** 補登負責醫師選單：使用者管理「職稱=主治醫師」名單（見 loadExpiryPhysicians） */
  expiryPhysicians: string[] = [...this.PHYSICIAN_ORDER];

  // 頁籤與紀錄
  activeTab: AppType = 'initial';
  applications = signal<CiApplication[]>([]);
  currentId: string | null = null; // null = 新申請（尚未儲存）
  form: CatastrophicFormData = createEmptyFormData();
  formLoaded = false; // 是否有開啟中的表單（選了病人並新增/載入紀錄）

  loading = false;
  saving = false;
  statusMessage = '';

  private labsApi!: ApiManagerCrud<LabReportRecord>;
  private latestLabs: Record<string, unknown> = {};
  private latestLabDate = '';
  private kiditProfile: Record<string, unknown> | null = null; // 本院初透建檔（KiDit）基本資料
  private kiditHistory: Record<string, unknown> | null = null; // 本院初透建檔（KiDit）病史（症狀/系統性疾病勾選）
  kiditSource = ''; // 顯示帶入來源提示

  constructor(
    private api: ApiService,
    private apiManager: ApiManagerService,
    private auth: AuthService,
    public patientStore: PatientStoreService,
    private userDirectory: UserDirectoryService,
  ) {
    this.labsApi = this.apiManager.create<LabReportRecord>('lab_reports');
  }

  async ngOnInit(): Promise<void> {
    const role = this.auth.currentUser()?.role;
    this.isClerk = role === 'admin' || role === 'viewer';
    this.canWrite = role === 'admin' || role === 'contributor';
    if (this.isClerk) void this.loadExpiryPhysicians();
    await Promise.all([
      // 書記（isClerk）也要病人清單：總覽「新增到期日」入口選病人用
      this.canWrite || this.isClerk ? this.patientStore.fetchPatientsIfNeeded() : Promise.resolve(),
      this.loadOverview(),
    ]);
  }

  /** 從使用者管理載入「職稱=主治醫師」名單作為補登負責醫師選項，依偏好順序排序（比照 patient-form-modal） */
  private async loadExpiryPhysicians(): Promise<void> {
    try {
      await this.userDirectory.fetchUsersIfNeeded();
      const names = this.userDirectory.allUsers()
        .filter((u) => u.title === '主治醫師' && u.isActive !== false)
        .map((u) => u.name)
        .filter((name): name is string => !!name);
      names.sort((a, b) => {
        const ia = this.PHYSICIAN_ORDER.indexOf(a);
        const ib = this.PHYSICIAN_ORDER.indexOf(b);
        if (ia === -1 && ib === -1) return a.localeCompare(b);
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        return ia - ib;
      });
      if (names.length > 0) this.expiryPhysicians = Array.from(new Set(names));
    } catch {
      // 使用者目錄載入失敗時保留初始後備清單
    }
  }

  // ---------------------------------------------------------------
  // 申請進度總覽
  // ---------------------------------------------------------------

  async loadOverview(): Promise<void> {
    this.overviewLoading = true;
    try {
      const rows = await firstValueFrom(this.api.get<CiOverviewRow[]>('/catastrophic-illness/overview'));
      this.overviewRows.set(Array.isArray(rows) ? rows : []);
    } catch (err) {
      console.error('載入申請進度總覽失敗:', err);
      this.overviewRows.set([]);
    } finally {
      this.overviewLoading = false;
    }
  }

  // 申請次數欄依資料動態決定（最少 3 欄維持版面），標題初次/再次/三次/四次…
  readonly overviewColumns = computed(() => {
    const max = Math.max(3, ...this.overviewRows().map((r) => r.applications?.length || 0));
    return Array.from({ length: max }, (_, i) => (APPLICATION_ORDINALS[i] || `第${i + 1}次`) + '申請');
  });

  readonly RENEWAL_PREP_COLUMNS: { key: RenewalPrepKey; label: string }[] = [
    { key: 'registeredDate', label: '已掛號' },
    { key: 'formDate', label: '已填寫申請書' },
    { key: 'docsDate', label: '已收齊證件/診斷書' },
  ];

  /** 到期日年份 ≥2900（民國 999 年＝西元 2910）視為終身有效 */
  isLifetime(row: CiOverviewRow): boolean {
    return !!row.expiryDate && row.expiryDate >= '2900';
  }

  // 到期提醒：非終身且到期日在一個月內（含已過期，續辦完成書記更新到期日後自動退場）
  // 續辦追蹤已填「已掛號」也退場（已協助掛號不必再提醒；到期日更新＝新一輪，後端會清空三欄讓下一輪提醒回來）
  readonly expiryReminders = computed(() => {
    const today = new Date();
    const fmt = (d: Date) => d.toLocaleDateString('sv-SE');
    const todayStr = fmt(today);
    const oneMonthLater = fmt(new Date(today.getFullYear(), today.getMonth() + 1, today.getDate()));
    return this.overviewRows()
      .filter((r) => r.expiryDate && !this.isLifetime(r) && r.expiryDate <= oneMonthLater && !r.renewalRegisteredDate)
      .map((r) => ({
        patientId: r.patientId,
        patientName: r.patientName,
        physicianName: r.physicianName,
        expiryDate: r.expiryDate,
        isExpired: r.expiryDate < todayStr,
      }))
      .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
  });

  prepValue(row: CiOverviewRow, key: RenewalPrepKey): string {
    return row[RENEWAL_PREP_PROPS[key]] || '';
  }

  async onRenewalPrepChange(row: CiOverviewRow, key: RenewalPrepKey, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const value = input.value || '';
    try {
      await firstValueFrom(this.api.put(`/catastrophic-illness/renewal-prep/${row.patientId}`, { [key]: value }));
      row[RENEWAL_PREP_PROPS[key]] = value;
    } catch (err) {
      console.error('更新續辦追蹤日期失敗:', err);
      input.value = row[RENEWAL_PREP_PROPS[key]];
      alert('更新失敗，請重試');
    }
  }

  slotAt(row: CiOverviewRow, index: number): CiOverviewSlot | null {
    return row.applications?.[index] ?? null;
  }

  /**
   * 書記可在哪些空格補登紙本送出日期：初次欄（index 0）永遠可補；
   * 再次起只開放「接在既有申請之後的下一格」（applications = [初次|null, ...再次]），避免跳格填寫落到別欄
   */
  canClerkAddPaperAt(row: CiOverviewRow, index: number): boolean {
    if (!this.isClerk || this.slotAt(row, index)) return false;
    return index === 0 || index === (row.applications?.length || 0);
  }

  /** 總覽空格直接填日期 → 建一筆紙本佔位申請（初次欄=initial、其餘=renewal），負責醫師沿用該列 */
  async onClerkPaperAdd(row: CiOverviewRow, index: number, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const value = input.value || '';
    if (!value) return;
    try {
      await firstValueFrom(this.api.post('/catastrophic-illness/clerk-paper', {
        patientId: row.patientId,
        applicationType: index === 0 ? 'initial' : 'renewal',
        clerkSentDate: value,
        physicianName: row.physicianName || undefined,
      }));
      await this.loadOverview();
    } catch (err) {
      console.error('補登紙本送出日期失敗:', err);
      input.value = '';
      alert('補登紙本送出日期失敗，請重試');
    }
  }

  /** 書記移除自己補登的紙本佔位紀錄（誤點補救；醫師已接手填表者後端會拒絕） */
  async removePaperFromOverview(row: CiOverviewRow, slot: CiOverviewSlot, columnLabel: string, event: Event): Promise<void> {
    event.stopPropagation();
    if (!this.isClerk) return;
    if (!confirm(`確定要移除「${row.patientName}」的${columnLabel}紙本紀錄（送出日期 ${slot.clerkSentDate || '未填'}）嗎？`)) return;
    try {
      await firstValueFrom(this.api.delete(`/catastrophic-illness/clerk-paper/${slot.id}`));
      const sel = this.selectedPatient();
      await Promise.all([
        this.loadOverview(),
        sel && String(sel['id']) === row.patientId ? this.loadApplications() : Promise.resolve(),
      ]);
    } catch (err) {
      console.error('移除紙本紀錄失敗:', err);
      alert('移除失敗：' + ((err as { error?: { message?: string } })?.error?.message || '請重試'));
    }
  }

  /** 紀錄按鈕區：標示書記補登的紙本紀錄 */
  isPaperApp(app: CiApplication): boolean {
    return (app.formData as Record<string, unknown> | undefined)?.['source'] === PAPER_SOURCE;
  }

  toggleOverview(): void {
    this.overviewCollapsed = !this.overviewCollapsed;
  }

  /** 點總覽列 → 選定該病人（醫師/管理員限定；病人可能已刪除則提示） */
  selectFromOverview(row: CiOverviewRow): void {
    if (!this.canWrite) return;
    const p = this.patientStore.allPatients().find((x) => String(x['id']) === row.patientId);
    if (p) {
      void this.selectPatient(p);
    } else {
      alert('此病人不在病人清單中（可能已刪除），無法開啟表單');
    }
  }

  /** 總覽列的編輯鈕 → 選定病人並直接開啟該筆申請表（醫師/管理員限定） */
  async editFromOverview(row: CiOverviewRow, slot: CiOverviewSlot, event: Event): Promise<void> {
    event.stopPropagation();
    if (!this.canWrite) return;
    const p = this.patientStore.allPatients().find((x) => String(x['id']) === row.patientId);
    if (!p) {
      alert('此病人不在病人清單中（可能已刪除），無法開啟表單');
      return;
    }
    await this.selectPatient(p);
    const app = this.applications().find((a) => a.id === slot.id);
    if (!app) {
      alert('找不到該筆申請紀錄，請重新整理後再試');
      return;
    }
    this.activeTab = app.applicationType;
    this.openApplication(app);
  }

  async onClerkSentChange(row: CiOverviewRow, slot: CiOverviewSlot | null, event: Event): Promise<void> {
    if (!slot) return;
    const input = event.target as HTMLInputElement;
    const value = input.value || '';
    try {
      await firstValueFrom(this.api.put(`/catastrophic-illness/clerk-sent/${slot.id}`, { clerkSentDate: value }));
      slot.clerkSentDate = value;
    } catch (err) {
      console.error('更新書記送出日期失敗:', err);
      input.value = slot.clerkSentDate;
      alert('更新送出日期失敗，請重試');
    }
  }

  async onExpiryChange(row: CiOverviewRow, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const value = input.value || '';
    try {
      const resp = await firstValueFrom(
        this.api.put<{ renewalReset?: boolean }>(`/catastrophic-illness/expiry/${row.patientId}`, { expiryDate: value })
      );
      row.expiryDate = value;
      // 到期日變動＝新一輪續辦週期，後端已清空續辦追蹤三欄，前端同步歸零
      if (resp?.renewalReset) {
        row.renewalRegisteredDate = '';
        row.renewalFormDate = '';
        row.renewalDocsDate = '';
      }
    } catch (err) {
      console.error('更新重大傷病到期日失敗:', err);
      input.value = row.expiryDate;
      alert('更新到期日失敗，請重試');
    }
  }

  // ---------------------------------------------------------------
  // 書記新增到期日（無申請紀錄的舊病人補進總覽與到期提醒）
  // ---------------------------------------------------------------

  onExpirySearchFocus(): void {
    this.expiryFilteredPatients = this.searchPatients(this.expirySearchText);
    this.expiryShowDropdown = true;
  }

  onExpirySearchBlur(): void {
    // mousedown 先於 blur 觸發，選取不受影響
    this.expiryShowDropdown = false;
  }

  pickExpiryPatient(p: Patient): void {
    this.expiryPickedPatient = p;
    this.expirySearchText = this.patientLabel(p);
    this.expiryShowDropdown = false;
    // 預設帶入病人資料的主治醫師（可改選）；不在名單中的醫師補進選單避免下拉顯示空白
    const physician = String(p['physician'] || '');
    this.newExpiryPhysician = physician;
    if (physician && !this.expiryPhysicians.includes(physician)) {
      this.expiryPhysicians = [...this.expiryPhysicians, physician];
    }
  }

  /** 補登列：到期日、紙本送出日期至少填一項 */
  get canAddExpiry(): boolean {
    return !!this.expiryPickedPatient && (!!this.newExpiryDate || !!this.newSentDate) && !this.addingExpiry;
  }

  async addExpiry(): Promise<void> {
    const patient = this.expiryPickedPatient;
    if (!patient || (!this.newExpiryDate && !this.newSentDate)) return;
    const existing = this.overviewRows().find((r) => r.patientId === patient['id']);
    if (this.newExpiryDate && existing?.expiryDate && !confirm(`${patient['name']} 已有到期日 ${existing.expiryDate}，要改成 ${this.newExpiryDate} 嗎？`)) return;
    this.addingExpiry = true;
    try {
      if (this.newExpiryDate) {
        await firstValueFrom(this.api.put(`/catastrophic-illness/expiry/${patient['id']}`, {
          expiryDate: this.newExpiryDate,
          physicianName: this.newExpiryPhysician,
        }));
      }
      if (this.newSentDate) {
        // 紙本送出日期：該病人尚無初次申請 → 記在初次欄；已有初次 → 接在再次之後
        const hasInitial = !!existing?.applications?.[0];
        await firstValueFrom(this.api.post('/catastrophic-illness/clerk-paper', {
          patientId: String(patient['id']),
          applicationType: hasInitial ? 'renewal' : 'initial',
          clerkSentDate: this.newSentDate,
          physicianName: this.newExpiryPhysician || undefined,
        }));
      }
      this.expiryPickedPatient = null;
      this.expirySearchText = '';
      this.newExpiryDate = '';
      this.newSentDate = '';
      this.newExpiryPhysician = '';
      await this.loadOverview(); // 重新載入：新列與到期提醒卡立即出現
    } catch (err) {
      console.error('新增重大傷病到期日失敗:', err);
      alert('新增到期日失敗，請重試');
    } finally {
      this.addingExpiry = false;
    }
  }

  // ---------------------------------------------------------------
  // 病人搜尋與選擇
  // ---------------------------------------------------------------

  private searchPatients(keyword: string): Patient[] {
    const kw = keyword.trim().toLowerCase();
    const all = this.patientStore.allPatients().filter((p) => !p['isDeleted'] && p['status'] !== 'deleted');
    return (!kw
      ? all
      : all.filter((p) => {
          const name = String(p['name'] || '').toLowerCase();
          const mrn = String(p['medicalRecordNumber'] || '').toLowerCase();
          const idNo = String(p['idNumber'] || '').toLowerCase();
          return name.includes(kw) || mrn.includes(kw) || idNo.includes(kw);
        })
    ).slice(0, 30);
  }

  updateFilter(): void {
    this.filteredPatients = this.searchPatients(this.searchText);
  }

  onSearchFocus(): void {
    this.updateFilter();
    this.showDropdown = true;
  }

  onSearchBlur(): void {
    // mousedown 先於 blur 觸發，選取不受影響
    this.showDropdown = false;
  }

  patientLabel(p: Patient): string {
    const mrn = p['medicalRecordNumber'] ? `（${p['medicalRecordNumber']}）` : '';
    return `${p['name'] || ''}${mrn}`;
  }

  async selectPatient(p: Patient): Promise<void> {
    this.selectedPatient.set(p);
    this.searchText = this.patientLabel(p);
    this.showDropdown = false;
    this.currentId = null;
    this.formLoaded = false;
    this.statusMessage = '';
    this.loading = true;
    try {
      await Promise.all([this.loadApplications(), this.loadLatestLabs(), this.loadKiditProfile()]);
    } finally {
      this.loading = false;
    }
  }

  /** 查 KiDit 本院初透建檔基本資料（查無則為 null，欄位維持其他來源帶入＋手動填寫） */
  private async loadKiditProfile(): Promise<void> {
    const p = this.selectedPatient();
    this.kiditProfile = null;
    this.kiditHistory = null;
    if (!p) return;
    try {
      const resp = await firstValueFrom(
        this.api.get<{ found: boolean; profile: Record<string, unknown> | null; history: Record<string, unknown> | null }>(
          `/catastrophic-illness/kidit-profile/${String(p['id'])}`,
        ),
      );
      this.kiditProfile = resp?.found ? resp.profile : null;
      this.kiditHistory = resp?.found ? resp.history : null;
    } catch (err) {
      console.error('查詢 KiDit 建檔資料失敗:', err);
      this.kiditProfile = null;
      this.kiditHistory = null;
    }
  }

  private async loadApplications(): Promise<void> {
    const p = this.selectedPatient();
    if (!p) return;
    const rows = await firstValueFrom(
      this.api.get<CiApplication[]>('/catastrophic-illness', { patientId: String(p['id']) }),
    );
    this.applications.set(Array.isArray(rows) ? rows : []);
  }

  private async loadLatestLabs(): Promise<void> {
    const p = this.selectedPatient();
    this.latestLabs = {};
    this.latestLabDate = '';
    if (!p) return;
    try {
      const reports = await this.labsApi.fetchWhere({ patientId: String(p['id']) });
      const sorted = (reports || [])
        .filter((r) => r.reportDate)
        .sort((a, b) => String(a.reportDate).localeCompare(String(b.reportDate)));
      // 由舊到新覆蓋：每個檢驗項目留最新一筆有值的
      for (const r of sorted) {
        const data = (r.data || {}) as Record<string, unknown>;
        for (const [key, val] of Object.entries(data)) {
          if (val !== null && val !== undefined && String(val).trim() !== '') {
            this.latestLabs[key] = val;
          }
        }
        this.latestLabDate = String(r.reportDate).slice(0, 10);
      }
    } catch (err) {
      console.error('載入檢驗報告失敗:', err);
    }
  }

  // ---------------------------------------------------------------
  // 頁籤與紀錄清單
  // ---------------------------------------------------------------

  setTab(tab: AppType): void {
    if (this.activeTab === tab) return;
    this.activeTab = tab;
    this.currentId = null;
    this.formLoaded = false;
    this.statusMessage = '';
  }

  get tabApplications(): CiApplication[] {
    return this.applications().filter((a) => a.applicationType === this.activeTab);
  }

  openApplication(app: CiApplication): void {
    this.currentId = app.id;
    this.form = { ...createEmptyFormData(), ...(app.formData || {}) };
    // 陣列欄防呆（舊資料可能缺欄）
    this.form.symptoms = Array.isArray(this.form.symptoms) ? this.form.symptoms : [];
    this.form.comorbidities = Array.isArray(this.form.comorbidities) ? this.form.comorbidities : [];
    this.form.ultrasoundFindings = Array.isArray(this.form.ultrasoundFindings) ? this.form.ultrasoundFindings : [];
    this.form.restartReasons = Array.isArray(this.form.restartReasons) ? this.form.restartReasons : [];
    this.formLoaded = true;
    this.statusMessage = '';
    this.kiditSource = '';
    this.overviewCollapsed = true;
  }

  /** 新增申請：以病人資料 + 最近檢驗值預填 */
  newApplication(): void {
    const p = this.selectedPatient();
    if (!p) return;
    const f = createEmptyFormData();

    f.name = String(p['name'] || '');
    f.gender = String(p['gender'] || '');
    f.idNumber = String(p['idNumber'] || '');
    f.birthDate = this.isoDate(p['birthDate']);
    f.phone = String(p['phone'] || '');
    f.address = String(p['address'] || '');

    // 初透日期：優先 patientStatus.isFirstDialysis.date，其次頂層 firstDialysisDate
    const ps = (p['patientStatus'] || {}) as Record<string, unknown>;
    const ifd = (ps['isFirstDialysis'] || {}) as Record<string, unknown>;
    f.firstDialysisDate = this.isoDate(ifd['date']) || this.isoDate(p['firstDialysisDate']);
    f.vascularAccessDate = this.isoDate(p['accessCreationDate']);

    // 最近檢驗值
    f.labDate = this.latestLabDate;
    f.albumin = this.labStr('Albumin');
    f.hct = this.labStr('Hct');
    f.hb = this.labStr('Hb');
    f.k = this.labStr('K');
    f.bun = this.labStr('BUN');
    f.cr = this.labStr('Creatinine');
    f.egfr = this.labStr('eGFR');

    if (this.activeTab === 'renewal') {
      // 每週血液透析次數：由排程頻率的星期字數推估（例：一三五→3、二四→2）
      const rule = (p['scheduleRule'] || {}) as Record<string, unknown>;
      const freq = String(rule['freq'] || '');
      const dayCount = (freq.match(/[一二三四五六日]/g) || []).length;
      f.weeklyHdCount = dayCount > 0 ? String(dayCount) : '';
      f.applicationNo = '2';
    }

    // 帶入優先序：病人資料庫（上方已填）< KiDit 本院初透建檔 < 初次申請紀錄（限再次頁籤）
    this.kiditSource = '';
    const overlay = (target: keyof CatastrophicFormData, value: unknown): void => {
      if (value === undefined || value === null) return;
      const s = String(value).trim();
      if (s !== '') (f as unknown as Record<string, string>)[target] = s;
    };

    const kp = this.kiditProfile;
    if (kp) {
      overlay('name', kp['name']);
      overlay('idNumber', kp['idNumber']);
      overlay('birthDate', this.isoDate(kp['birthDate']));
      overlay('address', kp['address']);
      overlay('phone', kp['phone']);
      overlay('firstDialysisDate', this.isoDate(kp['firstDialysisDate']));
      // KiDit 性別存 '1'(男)/'2'(女)
      if (kp['gender'] === '1') f.gender = '男';
      else if (kp['gender'] === '2') f.gender = '女';
      // 原發病因：細類優先，其次大類（代碼格式與本表一致）
      overlay('primaryDisease', kp['diagnosisSubcategory'] || kp['diagnosisCategory']);
      this.kiditSource = '已帶入本院初透建檔資料';
    }

    // KiDit 病史勾選 → 附表伴隨症狀/相關疾病
    const kh = this.kiditHistory;
    if (kh) {
      // 其他症狀（kiditHelpers otherSymptoms index）→ 附表 s1~s10
      // ⚠️ 順序不同：KiDit 5=噁心嘔吐→附表 s7、KiDit 6=代謝性酸血症→附表 s6
      const SYMPTOM_INDEX_MAP: Record<number, string> = {
        0: 's1', 1: 's2', 2: 's3', 3: 's4', 4: 's5', 5: 's7', 6: 's6', 7: 's8', 8: 's9', 9: 's10',
      };
      const selSymptoms = Array.isArray(kh['selectedSymptoms']) ? (kh['selectedSymptoms'] as number[]) : [];
      for (const idx of selSymptoms) {
        const key = SYMPTOM_INDEX_MAP[idx];
        if (key && !f.symptoms.includes(key)) f.symptoms.push(key);
      }
      if (f.symptoms.includes('s10')) {
        overlay('symptomsOther', kh['symptomsOtherDescription']);
      }

      // 其他系統性疾病（kiditHelpers systemicDiseases index）→ 附表 c1~c9
      // 0糖尿病~7結核 一一對應 c1~c8；8痛風/9高血脂/10GERD 附表無專項 → 併入 c9 其他
      const DISEASE_INDEX_MAP: Record<number, string> = {
        0: 'c1', 1: 'c2', 2: 'c3', 3: 'c4', 4: 'c5', 5: 'c6', 6: 'c7', 7: 'c8', 11: 'c9',
      };
      const EXTRA_DISEASE_LABELS: Record<number, string> = { 8: '痛風', 9: '高血脂', 10: '胃食道逆流' };
      const selDiseases = Array.isArray(kh['selectedSystemicDiseases']) ? (kh['selectedSystemicDiseases'] as number[]) : [];
      const extraLabels: string[] = [];
      for (const idx of selDiseases) {
        const key = DISEASE_INDEX_MAP[idx];
        if (key && !f.comorbidities.includes(key)) f.comorbidities.push(key);
        if (EXTRA_DISEASE_LABELS[idx]) extraLabels.push(EXTRA_DISEASE_LABELS[idx]);
      }
      if (extraLabels.length > 0 && !f.comorbidities.includes('c9')) f.comorbidities.push('c9');
      if (f.comorbidities.includes('c9')) {
        const otherDesc = String(kh['otherSystemicDescription'] || '').trim();
        f.comorbidityOther = [...extraLabels, otherDesc].filter(Boolean).join('、');
      }

      if (selSymptoms.length > 0 || selDiseases.length > 0) {
        this.kiditSource = this.kiditSource
          ? this.kiditSource + '（含症狀/疾病勾選）'
          : '已帶入本院初透建檔的症狀/疾病勾選';
      }
    }

    if (this.activeTab === 'renewal') {
      const latestInitial = this.applications().find((a) => a.applicationType === 'initial');
      if (latestInitial?.formData) {
        const src = latestInitial.formData as Record<string, unknown>;
        const HEADER_FIELDS: (keyof CatastrophicFormData)[] = [
          'name', 'gender', 'idNumber', 'birthDate', 'firstDialysisDate', 'address', 'phone',
          'facilityName', 'facilityCode', 'dialysisType', 'vascularAccessDate', 'pdCatheterDate',
          'primaryDisease',
        ];
        for (const key of HEADER_FIELDS) overlay(key, src[key]);
        // 初次申請勾的適應症 → 再次表「初次申請之定期透析適應症」
        overlay('initialIndication', src['indication']);
        this.kiditSource = this.kiditSource
          ? this.kiditSource + '，基本資料以初次申請紀錄為準'
          : '已帶入初次申請紀錄的基本資料';
      }
    }

    // 查無檢驗報告時明示手動填寫（新初透病人 HIS 檢驗可能尚未匯入）
    if (!this.latestLabDate) {
      this.kiditSource = (this.kiditSource ? this.kiditSource + '；' : '') + '此病人系統中尚無檢驗報告，檢驗欄請手動填寫';
    }

    // 負責醫師預設目前登入者、簽章日期預設今天（本地時區）
    const user = this.auth.currentUser();
    f.physicianName = user?.displayName || user?.name || '';
    f.physicianDate = new Date().toLocaleDateString('sv-SE');

    this.form = f;
    this.currentId = null;
    this.formLoaded = true;
    this.statusMessage = '';
    this.overviewCollapsed = true;
  }

  private isoDate(v: unknown): string {
    if (!v) return '';
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v));
    return m ? m[1] : '';
  }

  private labStr(key: string): string {
    const v = this.latestLabs[key];
    return v === null || v === undefined ? '' : String(v);
  }

  // ---------------------------------------------------------------
  // 勾選輔助
  // ---------------------------------------------------------------

  toggleInList(list: string[], key: string, checked: boolean): void {
    const idx = list.indexOf(key);
    if (checked && idx < 0) list.push(key);
    if (!checked && idx >= 0) list.splice(idx, 1);
  }

  onCheckChange(list: string[], key: string, event: Event): void {
    const input = event.target as HTMLInputElement;
    this.toggleInList(list, key, input.checked);
  }

  primaryDiseaseLabel(code: string): string {
    const found = PRIMARY_DISEASE_CODES.find((c) => c.code === code);
    return found ? found.label : '';
  }

  // ---------------------------------------------------------------
  // 儲存 / 刪除 / 匯出
  // ---------------------------------------------------------------

  async save(): Promise<void> {
    const p = this.selectedPatient();
    if (!p || !this.formLoaded || this.saving) return;
    this.saving = true;
    this.statusMessage = '';
    try {
      if (this.currentId) {
        await firstValueFrom(
          this.api.put<CiApplication>(`/catastrophic-illness/${this.currentId}`, {
            applicationType: this.activeTab,
            formData: this.form,
          }),
        );
      } else {
        const created = await firstValueFrom(
          this.api.post<CiApplication>('/catastrophic-illness', {
            patientId: String(p['id']),
            patientName: String(p['name'] || ''),
            applicationType: this.activeTab,
            formData: this.form,
          }),
        );
        this.currentId = created?.id || null;
      }
      await Promise.all([this.loadApplications(), this.loadOverview()]);
      this.statusMessage = '✅ 已儲存';
    } catch (err) {
      console.error('儲存重大傷病申請失敗:', err);
      this.statusMessage = '❌ 儲存失敗，請重試';
    } finally {
      this.saving = false;
    }
  }

  /** 總覽列的刪除鈕（唯一刪除入口；紀錄按鈕區的 ✕ 因易誤觸已移除，2026-08-05 誤刪案） */
  async deleteFromOverview(row: CiOverviewRow, slot: CiOverviewSlot, columnLabel: string, event: Event): Promise<void> {
    event.stopPropagation();
    if (!this.canWrite) return;
    const dateText = slot.physicianDate ? `（完成日期 ${slot.physicianDate}）` : '';
    if (!confirm(`確定要刪除「${row.patientName}」的${columnLabel}紀錄${dateText}嗎？\n刪除後無法復原！`)) return;
    try {
      await firstValueFrom(this.api.delete(`/catastrophic-illness/${slot.id}`));
      if (this.currentId === slot.id) {
        this.currentId = null;
        this.formLoaded = false;
      }
      const sel = this.selectedPatient();
      await Promise.all([
        this.loadOverview(),
        sel && String(sel['id']) === row.patientId ? this.loadApplications() : Promise.resolve(),
      ]);
    } catch (err) {
      console.error('刪除重大傷病申請失敗:', err);
      alert('刪除失敗，請重試');
    }
  }

  exportPrint(): void {
    if (!this.formLoaded) return;
    const html = this.activeTab === 'initial' ? buildInitialPrintHtml(this.form) : buildRenewalPrintHtml(this.form);
    openPrintWindow(html);
  }

  closeForm(): void {
    this.formLoaded = false;
    this.currentId = null;
    this.statusMessage = '';
    this.overviewCollapsed = false;
  }
}
