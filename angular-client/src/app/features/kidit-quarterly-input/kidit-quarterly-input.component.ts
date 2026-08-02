import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '@services/auth.service';
import { PatientStoreService } from '@services/patient-store.service';
import { localApi } from '@/services/localApiClient';
import { quarterRange, currentQuarter } from '@/services/kiditVascularCsvService';
import {
  KiditQuarterData,
  fetchQuarterRecords,
  saveQuarterRecord,
  buildPrefill,
  mergeWithPrefill,
  YN_OPTIONS,
  EPO_TYPE_OPTIONS,
  IS_LIVING_OPTIONS,
  FE_METHOD_OPTIONS,
  LIFE_EVALU_OPTIONS,
  GENE_EVALU_OPTIONS,
  COMORBID_OPTIONS,
} from '@/services/kiditQuarterInputService';

type FormTab = 'hdrecord' | 'diagnose' | 'comorbid';

interface NurseAssignment {
  nurseId: string;
  nurseName: string;
  patientIds: string[];
}

/**
 * 季度病人 KiDit 輸入：主護為照護清單分配病人填寫每季申報表單
 * （透析紀錄／醫療狀況評估／合併症；日期＝當季最後一次抽血日）。
 * 資料存 kidit_quarter_records（只存人工值；EPO藥囑/Hb/Hct/門住診/疾病標籤為載入時預帶）。
 * 工作站「季度輸入」頁籤彙整各主護進度並匯出官方 CSV。
 */
@Component({
  selector: 'app-kidit-quarterly-input',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './kidit-quarterly-input.component.html',
  styleUrl: './kidit-quarterly-input.component.css',
})
export class KiditQuarterlyInputComponent implements OnInit, OnDestroy {
  private readonly authService = inject(AuthService);
  private readonly patientStore = inject(PatientStoreService);
  private readonly router = inject(Router);

  readonly ynOptions = YN_OPTIONS;
  readonly epoTypeOptions = EPO_TYPE_OPTIONS;
  readonly isLivingOptions = IS_LIVING_OPTIONS;
  readonly feMethodOptions = FE_METHOD_OPTIONS;
  readonly lifeEvaluOptions = LIFE_EVALU_OPTIONS;
  readonly geneEvaluOptions = GENE_EVALU_OPTIONS;
  readonly comorbidOptions = COMORBID_OPTIONS;

  readonly year = signal(currentQuarter().year);
  readonly q = signal(currentQuarter().q);
  readonly quarter = computed(() => `${this.year()}Q${this.q()}`);
  readonly range = computed(() => quarterRange(this.year(), this.q()));

  readonly isLoading = signal(false);
  readonly loadError = signal('');
  readonly assignments = signal<NurseAssignment[]>([]);
  readonly targetNurseId = signal<string | null>(null);
  readonly patients = signal<any[]>([]);
  readonly selectedPatientId = signal<string | null>(null);
  readonly activeFormTab = signal<FormTab>('hdrecord');
  readonly saveState = signal<'' | 'saving' | 'saved' | 'error'>('');

  /** 病人 → 合併後表單資料（saved 蓋 prefill；ngModel 直接綁定物件屬性） */
  private dataByPatient: Record<string, KiditQuarterData> = {};

  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingSaves = new Set<string>();

  /** admin/editor 可切換檢視的主護；contributor 鎖定自己 */
  readonly canPickNurse = computed(() => {
    const role = this.authService.currentUser()?.role;
    return role === 'admin' || role === 'editor';
  });

  readonly targetNurse = computed(() =>
    this.assignments().find((a) => a.nurseId === this.targetNurseId()) || null,
  );

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    this.flushPendingSaves();
  }

  quarterLabel(): string {
    const r = this.range();
    return `${r.startDate} ~ ${r.endDate}`;
  }

  async load(): Promise<void> {
    this.isLoading.set(true);
    this.loadError.set('');
    try {
      const [care] = await Promise.all([
        localApi.get('/nursing/patient-care'),
        this.patientStore.fetchPatientsIfNeeded(),
      ]);

      const excluded = new Set<string>((care as any)?.excludedNurseIds || []);
      const assignments: NurseAssignment[] = ((care as any)?.assignments || []).filter(
        (a: NurseAssignment) => !excluded.has(a.nurseId) && (a.patientIds || []).length > 0,
      );
      this.assignments.set(assignments);

      // 對應「我」：先比 uid 再比姓名（同 my-patients 慣例）
      const cu = this.authService.currentUser();
      const mine = assignments.find(
        (a) => a.nurseId === cu?.uid || a.nurseId === cu?.id || String(a.nurseName || '').trim() === String(cu?.name || '').trim(),
      );
      const target = this.targetNurseId()
        ? assignments.find((a) => a.nurseId === this.targetNurseId()) || mine || assignments[0]
        : mine || (this.canPickNurse() ? assignments[0] : undefined);
      this.targetNurseId.set(target?.nurseId || null);

      await this.loadQuarterData();
    } catch (error) {
      console.error('載入季度 KiDit 輸入失敗:', error);
      this.loadError.set('載入失敗，請稍後再試。');
    } finally {
      this.isLoading.set(false);
    }
  }

  /** 載入目前季度＋目前主護的病人資料、儲存值與預帶值 */
  private async loadQuarterData(): Promise<void> {
    const assignment = this.targetNurse();
    if (!assignment) {
      this.patients.set([]);
      this.selectedPatientId.set(null);
      return;
    }

    const all = this.patientStore.allPatients();
    const byId = new Map<string, any>(all.map((p: any) => [p.id, p]));
    const patients = (assignment.patientIds || [])
      .map((id) => byId.get(id))
      .filter((p: any) => p && !p.isDeleted)
      .sort((a: any, b: any) => String(a.name || '').localeCompare(String(b.name || '')));
    this.patients.set(patients);

    const patientIds = patients.map((p: any) => p.id);
    const { startDate, endDate } = this.range();

    const [records, medsAll, labs] = await Promise.all([
      fetchQuarterRecords(this.quarter()),
      localApi.get('/orders/medications'),
      patientIds.length
        ? localApi.post('/patients/lab-reports/query', { field: 'patientId', values: patientIds })
        : Promise.resolve([]),
    ]);

    const savedByPatient = new Map<string, KiditQuarterData>();
    for (const r of records) savedByPatient.set(r.patientId, r.data || {});

    const medsByPatient = new Map<string, any[]>();
    for (const o of Array.isArray(medsAll) ? medsAll : []) {
      if (!medsByPatient.has(o.patientId)) medsByPatient.set(o.patientId, []);
      medsByPatient.get(o.patientId)!.push(o);
    }
    const labsByPatient = new Map<string, any[]>();
    for (const r of Array.isArray(labs) ? labs : []) {
      if (!labsByPatient.has(r.patientId)) labsByPatient.set(r.patientId, []);
      labsByPatient.get(r.patientId)!.push(r);
    }

    const merged: Record<string, KiditQuarterData> = {};
    for (const p of patients) {
      const prefill = buildPrefill({
        patient: p,
        injectionOrders: medsByPatient.get(p.id) || [],
        labReports: labsByPatient.get(p.id) || [],
        quarterStart: startDate,
        quarterEnd: endDate,
      });
      merged[p.id] = mergeWithPrefill(savedByPatient.get(p.id) || {}, prefill);
    }
    this.dataByPatient = merged;

    if (!this.selectedPatientId() || !patientIds.includes(this.selectedPatientId()!)) {
      this.selectedPatientId.set(patientIds[0] || null);
    }
  }

  async changeQuarter(offset: number): Promise<void> {
    this.flushPendingSaves();
    let q = this.q() + offset;
    let y = this.year();
    if (q > 4) { q = 1; y++; }
    else if (q < 1) { q = 4; y--; }
    this.q.set(q);
    this.year.set(y);
    this.isLoading.set(true);
    try {
      await this.loadQuarterData();
    } catch (error) {
      console.error('切換季度失敗:', error);
      this.loadError.set('載入失敗，請稍後再試。');
    } finally {
      this.isLoading.set(false);
    }
  }

  async selectNurse(nurseId: string): Promise<void> {
    this.flushPendingSaves();
    this.targetNurseId.set(nurseId);
    this.selectedPatientId.set(null);
    this.isLoading.set(true);
    try {
      await this.loadQuarterData();
    } catch (error) {
      console.error('切換主護失敗:', error);
      this.loadError.set('載入失敗，請稍後再試。');
    } finally {
      this.isLoading.set(false);
    }
  }

  selectPatient(patientId: string): void {
    this.selectedPatientId.set(patientId);
  }

  setFormTab(tab: FormTab): void {
    this.activeFormTab.set(tab);
  }

  backToMyPatients(): void {
    this.router.navigate(['/my-patients']);
  }

  formData(patientId: string | null): KiditQuarterData | null {
    if (!patientId) return null;
    return this.dataByPatient[patientId] || null;
  }

  selectedPatient(): any {
    const id = this.selectedPatientId();
    return id ? this.patients().find((p: any) => p.id === id) : null;
  }

  /** 病人清單完成度圓點（透/評/併） */
  completionOf(patientId: string): { hdrecord: boolean; diagnose: boolean; comorbid: boolean } {
    const c = this.dataByPatient[patientId]?.completed || {};
    return { hdrecord: !!c.hdrecord, diagnose: !!c.diagnose, comorbid: !!c.comorbid };
  }

  completedCount(patientId: string): number {
    const c = this.completionOf(patientId);
    return (c.hdrecord ? 1 : 0) + (c.diagnose ? 1 : 0) + (c.comorbid ? 1 : 0);
  }

  isComorbidChecked(patientId: string, code: string): boolean {
    const codes = this.dataByPatient[patientId]?.comorbid?.codes || [];
    return codes.includes(code);
  }

  toggleComorbid(patientId: string, code: string, checked: boolean): void {
    const data = this.dataByPatient[patientId];
    if (!data) return;
    if (!data.comorbid) data.comorbid = {};
    const set = new Set(data.comorbid.codes || []);
    if (checked) set.add(code);
    else set.delete(code);
    data.comorbid.codes = [...set].sort();
    this.onFieldChange(patientId);
  }

  /** 任一欄位變更：標記待存並 debounce 自動儲存 */
  onFieldChange(patientId: string): void {
    this.pendingSaves.add(patientId);
    this.saveState.set('saving');
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.doSave(), 800);
  }

  private async doSave(): Promise<void> {
    const ids = [...this.pendingSaves];
    this.pendingSaves.clear();
    const cu = this.authService.currentUser();
    try {
      for (const pid of ids) {
        const data = this.dataByPatient[pid];
        if (!data) continue;
        data.nurse = { uid: String(cu?.uid || cu?.id || ''), name: String(cu?.name || '') };
        await saveQuarterRecord(this.quarter(), pid, data);
      }
      this.saveState.set('saved');
    } catch (error) {
      console.error('儲存季度 KiDit 輸入失敗:', error);
      ids.forEach((id) => this.pendingSaves.add(id));
      this.saveState.set('error');
    }
  }

  /** 離開頁面/切季度/切主護前立即送出未儲存變更 */
  private flushPendingSaves(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.pendingSaves.size) void this.doSave();
  }
}
