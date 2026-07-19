// 醫師藥物調整：單一病人調藥工作檯（唯讀）
// 上半三頁籤（醫囑調整/貧血藥物/鈣磷恆定）× 下半每月累積報告，同一月份軸對照，
// 供醫師依趨勢開立下個月藥物。群組篩選+上一位/下一位輪巡。
import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ApiManagerService,
  type ApiManager,
  type FirestoreRecord,
} from '@services/api-manager.service';
import { PatientStoreService } from '@services/patient-store.service';
import { LAB_ITEM_DISPLAY_NAMES } from '@/constants/labAlertConstants';

interface DrugDef {
  label: string;
  codes: string[];
  unit: string;
}

interface PatientEntry {
  patientId: string;
  patientName: string;
  bedNum: string | number;
  freq: string;
  shiftIndex: number;
}

@Component({
  selector: 'app-med-adjustment',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './med-adjustment.component.html',
  styleUrl: './med-adjustment.component.css',
})
export class MedAdjustmentComponent implements OnInit {
  private readonly apiManager = inject(ApiManagerService);
  private readonly patientStore = inject(PatientStoreService);

  private readonly baseSchedulesApi: ApiManager<FirestoreRecord>;
  private readonly historyApi: ApiManager<FirestoreRecord>;
  private readonly medsApi: ApiManager<FirestoreRecord>;
  private readonly labsApi: ApiManager<FirestoreRecord>;

  // --- 篩選與輪巡 ---
  groupFreq = '一三五';
  groupShift = 'early';
  readonly patientList = signal<PatientEntry[]>([]);
  readonly selectedIndex = signal(0);
  readonly isLoading = signal(false);

  // --- 月份窗（預帶近6個月，可往前翻） ---
  readonly monthOffset = signal(0);
  readonly months = computed(() => {
    const now = new Date();
    const list: string[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i - this.monthOffset(), 1);
      list.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return list;
  });

  // --- 頁籤 ---
  activeTab: 'orders' | 'anemia' | 'capho' = 'orders';

  readonly ANEMIA_DRUGS: DrugDef[] = [
    { label: 'NESP', codes: ['INES2'], unit: 'mcg' },
    { label: 'EPO (Recormon)', codes: ['IREC1'], unit: 'KIU' },
    { label: 'Vafseo', codes: ['OVAF'], unit: '顆' },
    { label: 'Fe-back', codes: ['IFER2'], unit: 'mg' },
  ];
  readonly CAPHO_DRUGS: DrugDef[] = [
    { label: 'Pro-Cal', codes: ['OCAA'], unit: '顆' },
    { label: 'A-Cal', codes: ['OCAL1'], unit: '顆' },
    { label: '鋁片 (Alkantin)', codes: ['OALK1'], unit: '顆' },
    { label: 'Lanclean', codes: ['OFOS4', 'OFOS5'], unit: '顆' },
    { label: 'U-Ca', codes: ['OUCA1'], unit: '顆' },
    { label: 'Cacare', codes: ['ICAC'], unit: 'amp' },
    { label: 'Parsabiv', codes: ['IPAR1'], unit: 'mg' },
    { label: 'Evocalcet (Orkedia)', codes: ['OORK'], unit: '顆' },
  ];
  readonly ORDER_ROWS = [
    { key: 'bf', label: 'BF 血流速' },
    { key: 'df', label: 'DF 透析液流速' },
    { key: 'time', label: '透析時間' },
    { key: 'ak', label: 'AK 人工腎臟' },
    { key: 'dialysateCa', label: '透析液鈣離子 (Ca)' },
  ];
  // 下半每月報告的項目與順序：比照檢驗報告管理頁 prioritizedLabItems（值取當月最後一次報告）
  readonly LAB_ROWS = [
    'WBC', 'Platelet', 'Hb', 'Ferritin', 'TSAT', 'GlucoseAC', 'Triglyceride',
    'LDL', 'UricAcid', 'Albumin', 'ALT', 'Na', 'K', 'P', 'Ca', 'CaXP', 'iPTH',
    'BUN', 'PostBUN', 'Creatinine', 'Kt/V', 'URR',
  ];
  /** 依上半頁籤強化下半報告的對應檢驗欄位 */
  private readonly TAB_FOCUS_LABS: Record<string, string[]> = {
    orders: ['Ca', 'URR', 'Kt/V'],
    anemia: ['Hb', 'Ferritin', 'TSAT'],
    capho: ['Ca', 'P', 'CaXP', 'iPTH'],
  };

  isFocusLab(item: string): boolean {
    return this.TAB_FOCUS_LABS[this.activeTab]?.includes(item) ?? false;
  }

  // --- 病人資料 ---
  private historyRows: any[] = [];
  private medRows: any[] = [];
  private labByMonth = new Map<string, Record<string, unknown>>();
  readonly dataRevision = signal(0);

  private readonly draftsApi: ApiManager<FirestoreRecord>;

  // --- 當月藥物修正（醫師填寫，存 medication_drafts，kind 區隔不干擾班次草稿） ---
  adjustNotes: Record<string, string> = {};
  readonly isDirty = signal(false);
  readonly isSaving = signal(false);
  readonly savedHint = signal('');
  readonly currentMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

  constructor() {
    this.baseSchedulesApi = this.apiManager.create<FirestoreRecord>('base_schedules');
    this.historyApi = this.apiManager.create<FirestoreRecord>('dialysis_orders_history');
    this.medsApi = this.apiManager.create<FirestoreRecord>('medication_orders');
    this.labsApi = this.apiManager.create<FirestoreRecord>('lab_reports');
    this.draftsApi = this.apiManager.create<FirestoreRecord>('medication_drafts');
  }

  markDirty(): void {
    this.isDirty.set(true);
    this.savedHint.set('');
  }

  async saveAdjustments(): Promise<void> {
    const patient = this.currentPatient;
    if (!patient || this.isSaving()) return;
    this.isSaving.set(true);
    try {
      await this.draftsApi.save({
        patientId: patient.patientId,
        kind: 'med_adjustment',
        month: this.currentMonth,
        notes: { ...this.adjustNotes },
      } as any);
      this.isDirty.set(false);
      this.savedHint.set('已儲存');
    } catch (error) {
      console.error('儲存藥物修正失敗:', error);
      this.savedHint.set('儲存失敗，請重試');
    } finally {
      this.isSaving.set(false);
    }
  }

  async ngOnInit(): Promise<void> {
    await this.patientStore.fetchPatientsIfNeeded();
    await this.rebuildPatientList();
  }

  get currentPatient(): PatientEntry | null {
    return this.patientList()[this.selectedIndex()] || null;
  }

  async rebuildPatientList(): Promise<void> {
    const masterDoc: any = await this.baseSchedulesApi.fetchById('MASTER_SCHEDULE');
    const rules: Record<string, any> = masterDoc?.schedule || {};
    const shiftMap: Record<string, number> = { early: 0, noon: 1, late: 2 };
    const shiftIndex = shiftMap[this.groupShift];
    const regularFreqs = ['一三五', '二四六'];
    const list = this.patientStore
      .opdPatients()
      .filter((p: any) => {
        const rule = rules[p.id];
        if (!rule) return false;
        const isOther = this.groupFreq === 'other';
        return (
          (isOther || rule.shiftIndex === shiftIndex) &&
          (isOther ? !regularFreqs.includes(rule.freq) : rule.freq === this.groupFreq)
        );
      })
      .map((p: any) => ({
        patientId: p.id,
        patientName: p.name,
        bedNum: rules[p.id]?.bedNum,
        freq: rules[p.id]?.freq,
        shiftIndex: rules[p.id]?.shiftIndex,
      }))
      .sort((a: any, b: any) =>
        String(a.bedNum).localeCompare(String(b.bedNum), undefined, { numeric: true }),
      );
    this.patientList.set(list);
    this.selectedIndex.set(0);
    await this.loadPatientData();
  }

  async selectPatient(index: number): Promise<void> {
    if (index < 0 || index >= this.patientList().length) return;
    this.selectedIndex.set(index);
    await this.loadPatientData();
  }

  prevPatient(): void { this.selectPatient(this.selectedIndex() - 1); }
  nextPatient(): void { this.selectPatient(this.selectedIndex() + 1); }
  shiftMonths(delta: number): void {
    this.monthOffset.update((v) => Math.max(0, v + delta));
  }

  onSelectChange(value: string): void {
    this.selectPatient(Number(value));
  }

  private async loadPatientData(): Promise<void> {
    const patient = this.currentPatient;
    this.historyRows = [];
    this.medRows = [];
    this.labByMonth = new Map();
    this.adjustNotes = {};
    this.isDirty.set(false);
    this.savedHint.set('');
    if (!patient) { this.dataRevision.update((v) => v + 1); return; }
    this.isLoading.set(true);
    try {
      const [history, meds, labs, drafts] = await Promise.all([
        this.historyApi.fetchWhere({ patientId: patient.patientId }),
        this.medsApi.fetchWhere({ patientId: patient.patientId }),
        this.labsApi.fetchWhere({ patientId: patient.patientId }),
        this.draftsApi.fetchWhere({ patientId: patient.patientId }),
      ]);
      // 當月藥物修正：取本月最新一份
      const adjustDoc = ((drafts as any[]) || [])
        .filter((d: any) => d.kind === 'med_adjustment' && d.month === this.currentMonth)
        .sort((a: any, b: any) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0];
      this.adjustNotes = { ...(adjustDoc?.notes || {}) };
      // 醫囑歷史：依生效日(退 createdAt)由舊到新
      this.historyRows = ((history as any[]) || [])
        .map((h: any) => ({
          date: (h.orders?.effectiveDate || h.createdAt || '').slice(0, 10),
          orders: h.orders || {},
        }))
        .filter((h) => h.date)
        .sort((a, b) => a.date.localeCompare(b.date));
      this.medRows = ((meds as any[]) || []).filter((m: any) => m.startDate);
      for (const report of ((labs as any[]) || []).sort((a: any, b: any) =>
        String(a.reportDate || '').localeCompare(String(b.reportDate || '')),
      )) {
        const month = String(report.reportDate || '').slice(0, 7);
        if (!month) continue;
        // 同月多次報告：後蓋前（取當月最後一次），逐項合併避免單項缺漏
        const bucket = this.labByMonth.get(month) || {};
        Object.assign(bucket, report.data || {});
        this.labByMonth.set(month, bucket);
      }
      this.prefillAdjustNotes();
    } catch (error) {
      console.error('載入病人資料失敗:', error);
    } finally {
      this.isLoading.set(false);
      this.dataRevision.update((v) => v + 1);
    }
  }

  /** 當月修正欄預帶目前生效值（醫囑/藥物劑量），已存草稿的欄位不覆蓋；預帶不算未儲存變更 */
  private prefillAdjustNotes(): void {
    for (const row of this.ORDER_ROWS) {
      if (!this.adjustNotes[row.key]) {
        const text = this.orderCell(row.key, this.currentMonth).text;
        if (text !== '-') this.adjustNotes[row.key] = text;
      }
    }
    for (const drug of [...this.ANEMIA_DRUGS, ...this.CAPHO_DRUGS]) {
      if (!this.adjustNotes[drug.label]) {
        const text = this.drugCell(drug, this.currentMonth);
        if (text !== '-') this.adjustNotes[drug.label] = text;
      }
    }
  }

  // --- 儲存格計算（模板呼叫；資料量小，逐月計算可接受） ---

  /** 醫囑調整：取該月底前最後一次調整的值；該月內有調整則標記 */
  orderCell(rowKey: string, month: string): { text: string; changed: boolean } {
    this.dataRevision();
    const monthEnd = `${month}-31`;
    const applicable = this.historyRows.filter((h) => h.date <= monthEnd);
    if (!applicable.length) return { text: '-', changed: false };
    const latest = applicable[applicable.length - 1].orders;
    const changed = this.historyRows.some((h) => h.date.slice(0, 7) === month);
    let text = '-';
    if (rowKey === 'bf') text = String(latest.bloodFlow ?? latest.blood_flow ?? '-');
    else if (rowKey === 'df') text = String(latest.dialysateFlow ?? latest.dialysateFlowRate ?? latest.dialysisFlow ?? '-');
    else if (rowKey === 'time') {
      const h = latest.dialysisTimeHours ?? latest.dialysisHours;
      const m = latest.dialysisTimeMinutes;
      if (h !== undefined && h !== null && h !== '') {
        text = m ? `${h}時${m}分` : `${h}時`;
      } else if (latest.dialysisTimeText) text = String(latest.dialysisTimeText);
    } else if (rowKey === 'ak') text = String(latest.ak ?? latest.artificialKidney ?? '-');
    else if (rowKey === 'dialysateCa') text = String(latest.dialysateCa ?? latest.dialysate ?? '-');
    return { text: text || '-', changed };
  }

  /** 藥物：該月內有效的處方（區間模型），多筆並列；月內停用標「至M/D止」 */
  drugCell(def: DrugDef, month: string): string {
    this.dataRevision();
    const monthStart = `${month}-01`;
    const monthEnd = `${month}-31`;
    const active = this.medRows
      .filter(
        (o: any) =>
          def.codes.includes(o.orderCode) &&
          o.startDate <= monthEnd &&
          (!o.endDate || o.endDate >= monthStart),
      )
      .sort((a: any, b: any) => a.startDate.localeCompare(b.startDate));
    if (!active.length) return '-';
    const parts = active.map((o: any) => {
      const details: string[] = [];
      const freqText = o.orderType === 'injection' ? o.note : o.frequency;
      if (freqText) details.push(freqText);
      if (o.endDate && o.endDate <= monthEnd) {
        const [, m, d] = o.endDate.split('-');
        details.push(`至${Number(m)}/${Number(d)}止`);
      }
      return `${o.dose}${def.unit ? ' ' + def.unit : ''}${details.length ? ` (${details.join('，')})` : ''}`;
    });
    return parts.join('；');
  }

  /** 檢驗：當月值（TSAT/CaxP 為衍生計算） */
  labCell(item: string, month: string): string {
    this.dataRevision();
    const data = this.labByMonth.get(month);
    if (!data) return '-';
    const num = (k: string) => {
      const v = parseFloat(String(data[k] ?? ''));
      return isNaN(v) ? null : v;
    };
    // 衍生項計算比照檢驗報告管理頁
    if (item === 'TSAT') {
      const iron = num('Iron');
      const tibc = num('TIBC');
      return iron !== null && tibc ? ((iron / tibc) * 100).toFixed(1) : '-';
    }
    if (item === 'CaXP') {
      const ca = num('Ca');
      const p = num('P');
      return ca !== null && p !== null ? (ca * p).toFixed(1) : '-';
    }
    if (item === 'URR') {
      const bun = num('BUN');
      const post = num('PostBUN');
      return bun && post !== null ? (((bun - post) / bun) * 100).toFixed(1) : '-';
    }
    if (item === 'Kt/V') {
      const bun = num('BUN');
      const post = num('PostBUN');
      return bun && post ? Math.log(bun / post).toFixed(2) : '-';
    }
    const v = data[item];
    return v === undefined || v === null || v === '' ? '-' : String(v);
  }

  labRowLabel(item: string): string {
    return (LAB_ITEM_DISPLAY_NAMES as Record<string, string>)[item] || item;
  }
}
