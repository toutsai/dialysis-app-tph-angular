// 重大傷病申請工作檯：初次/再次兩頁籤，選病人自動帶入基本資料與最近檢驗值，
// 儲存至 catastrophic_illness_applications，並可依官方附表版面列印匯出
// 權限：admin/contributor（醫師與專師）——page-access.ts DOCTOR_ROLES
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

  constructor(
    private api: ApiService,
    private apiManager: ApiManagerService,
    private auth: AuthService,
    public patientStore: PatientStoreService,
  ) {
    this.labsApi = this.apiManager.create<LabReportRecord>('lab_reports');
  }

  async ngOnInit(): Promise<void> {
    await this.patientStore.fetchPatientsIfNeeded();
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
      await Promise.all([this.loadApplications(), this.loadLatestLabs()]);
    } finally {
      this.loading = false;
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

    // 負責醫師預設目前登入者、簽章日期預設今天（本地時區）
    const user = this.auth.currentUser();
    f.physicianName = user?.displayName || user?.name || '';
    f.physicianDate = new Date().toLocaleDateString('sv-SE');

    this.form = f;
    this.currentId = null;
    this.formLoaded = true;
    this.statusMessage = '';
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
      await this.loadApplications();
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
      await this.loadApplications();
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
  }
}
