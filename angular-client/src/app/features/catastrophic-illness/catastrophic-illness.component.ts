// 重大傷病申請工作檯：初次/再次兩頁籤，選病人自動帶入基本資料與最近檢驗值，
// 儲存至 catastrophic_illness_applications，並可依官方附表版面列印匯出
// 權限：admin/contributor（醫師與專師）可寫表單；viewer（書記）僅進度總覽＋填送出日期/到期日
import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '@services/api.service';
import { ApiManagerService, type ApiManagerCrud } from '@services/api-manager.service';
import { AuthService } from '@services/auth.service';
import { PatientStoreService, type Patient } from '@services/patient-store.service';
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
}

interface CiOverviewRow {
  patientId: string;
  patientName: string;
  initial: CiOverviewSlot | null;
  second: CiOverviewSlot | null;
  third: CiOverviewSlot | null;
  expiryDate: string;
  latestUpdatedAt: string;
}

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
  ) {
    this.labsApi = this.apiManager.create<LabReportRecord>('lab_reports');
  }

  async ngOnInit(): Promise<void> {
    const role = this.auth.currentUser()?.role;
    this.isClerk = role === 'admin' || role === 'viewer';
    this.canWrite = role === 'admin' || role === 'contributor';
    await Promise.all([
      this.canWrite ? this.patientStore.fetchPatientsIfNeeded() : Promise.resolve(),
      this.loadOverview(),
    ]);
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
      await firstValueFrom(this.api.put(`/catastrophic-illness/expiry/${row.patientId}`, { expiryDate: value }));
      row.expiryDate = value;
    } catch (err) {
      console.error('更新重大傷病到期日失敗:', err);
      input.value = row.expiryDate;
      alert('更新到期日失敗，請重試');
    }
  }

  // ---------------------------------------------------------------
  // 病人搜尋與選擇
  // ---------------------------------------------------------------

  updateFilter(): void {
    const kw = this.searchText.trim().toLowerCase();
    const all = this.patientStore.allPatients().filter((p) => !p['isDeleted'] && p['status'] !== 'deleted');
    this.filteredPatients = (!kw
      ? all
      : all.filter((p) => {
          const name = String(p['name'] || '').toLowerCase();
          const mrn = String(p['medicalRecordNumber'] || '').toLowerCase();
          const idNo = String(p['idNumber'] || '').toLowerCase();
          return name.includes(kw) || mrn.includes(kw) || idNo.includes(kw);
        })
    ).slice(0, 30);
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

  async deleteApplication(app: CiApplication, event: Event): Promise<void> {
    event.stopPropagation();
    if (!confirm(`確定刪除這筆${app.applicationType === 'initial' ? '初次' : '再次'}申請紀錄？（${(app.updatedAt || '').slice(0, 10)}）`)) return;
    try {
      await firstValueFrom(this.api.delete(`/catastrophic-illness/${app.id}`));
      if (this.currentId === app.id) {
        this.currentId = null;
        this.formLoaded = false;
      }
      await Promise.all([this.loadApplications(), this.loadOverview()]);
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
