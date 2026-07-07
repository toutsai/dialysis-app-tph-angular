import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import * as XLSX from 'xlsx';
import {
  AkiApiService,
  AkiCareItem,
  AkiCategory,
  AkiCourseFields,
  AkiMapResponse,
  AkiPatient,
  AkiPatientDetail,
  AkiUploadBatch,
} from '@app/core/services/aki-api.service';

// 病程篩選（與分期篩選 AND 疊加）
type CourseFilter = 'all' | 'ckd' | 'akd' | 'admission-aki' | 'recovering' | 'recovered';

const COURSE_DEFS: { key: Exclude<CourseFilter, 'all'>; label: string; color: string }[] = [
  { key: 'ckd', label: '疑似 CKD', color: '#6d4c41' },
  { key: 'akd', label: 'AKD', color: '#e65100' },
  { key: 'admission-aki', label: '本次住院 AKI', color: '#c62828' },
  { key: 'recovering', label: '恢復中', color: '#00897b' },
  { key: 'recovered', label: '已恢復', color: '#43a047' },
];

function matchCourse(p: AkiCourseFields, f: CourseFilter): boolean {
  switch (f) {
    case 'ckd': return p.ckdSuspected;
    case 'akd': return p.akd;
    case 'admission-aki': return p.admissionAkiStage != null;
    case 'recovering': return p.akiCourse === 'recovering';
    case 'recovered': return p.akiCourse === 'recovered';
    default: return true;
  }
}

// 上傳結果彈窗內容
interface UploadResult {
  ok: boolean;
  title: string;
  fileName: string;
  lines: string[];
  hint?: string;
}

interface CategoryDef {
  key: AkiCategory;
  label: string;
  color: string;
}

// 分期顯示順序、標籤、色碼（與後端 AKI_CATEGORIES 對齊）
const CATEGORY_DEFS: CategoryDef[] = [
  { key: 'stage-3', label: 'Stage 3', color: '#d32f2f' },
  { key: 'stage-2', label: 'Stage 2', color: '#f57c00' },
  { key: 'stage-1', label: 'Stage 1', color: '#f9a825' },
  { key: 'esrd', label: '疑似 ESRD', color: '#7b1fa2' },
  { key: 'stage-0', label: '無 AKI', color: '#388e3c' },
  { key: 'single', label: '單筆無法判定', color: '#607d8b' },
  { key: 'no-data', label: '無 Cr 資料', color: '#b0bec5' },
];

interface WardGroup {
  ward: string;
  patients: AkiPatient[];
  counts: Partial<Record<AkiCategory, number>>;
}

interface WardStat {
  ward: string;
  total: number;
  hit: number;
  pct: number;
}

// 護理站顯示規則（依院方要求）：
//   1) 第一/二/三加護病房最前  2) 5–7 樓 A–D 護理站  3) 其他(如 9A 急性精神科)  4) GC 最後
//   隱藏：單托嬰、嬰兒病床
function wardCode(ward: string): string {
  const i = ward.indexOf('_');
  return i >= 0 ? ward.slice(0, i) : ward;
}
function isHiddenWard(ward: string): boolean {
  const code = wardCode(ward);
  return code === 'DBBB' || code === 'DBBP' || ward.includes('單托嬰') || ward.includes('嬰兒病床');
}
function isIcuWard(ward: string): boolean {
  return ward.includes('加護') || wardCode(ward).startsWith('DBI');
}
function wardSortKey(ward: string): [number, number, number] {
  const code = wardCode(ward);
  const icu = code.match(/^DBI(\d)/); // 加護病房 DBI1/2/3
  if (icu) return [0, Number(icu[1]), 0];
  if (code.startsWith('GC')) return [3, 0, 0]; // 戒護病房最後
  const ns = code.match(/^D(\d)([A-Z])/); // 一般護理站 D<樓><區>
  if (ns) return [1, Number(ns[1]), ns[2].charCodeAt(0)];
  return [2, 0, 0];
}
function compareWard(a: string, b: string): number {
  const ka = wardSortKey(a);
  const kb = wardSortKey(b);
  return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2] || a.localeCompare(b);
}

@Component({
  selector: 'app-aki-map',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './aki-map.component.html',
  styleUrl: './aki-map.component.css',
})
export class AkiMapComponent implements OnInit {
  private readonly akiApi = inject(AkiApiService);

  readonly categoryDefs = CATEGORY_DEFS;

  readonly loading = signal(false);
  readonly message = signal<{ type: 'info' | 'error'; text: string } | null>(null);
  readonly data = signal<AkiMapResponse | null>(null);

  readonly selectedDate = signal<string>('');
  readonly filterCategory = signal<AkiCategory | 'all' | 'aki'>('all');
  readonly filterCourse = signal<CourseFilter>('all');
  readonly search = signal<string>('');
  readonly courseDefs = COURSE_DEFS;

  readonly uploadingInpatients = signal(false);
  readonly uploadingLabs = signal(false);

  // 上傳結果彈窗 + 上傳紀錄
  readonly uploadResult = signal<UploadResult | null>(null);
  readonly showBatches = signal(false);
  readonly batches = signal<AkiUploadBatch[]>([]);
  readonly batchesLoading = signal(false);

  // 詳情面板
  readonly detail = signal<AkiPatientDetail | null>(null);
  readonly detailLoading = signal(false);

  // 頁籤：map（全院地圖）/ care（在院關懷名單）/ discharged（出院關懷名單）
  readonly activeTab = signal<'map' | 'care' | 'discharged'>('map');

  // AKI 分期計算說明視窗
  readonly showAkiHelp = signal(false);

  // 關懷名單（在院）
  readonly careItems = signal<AkiCareItem[]>([]);
  readonly careLoading = signal(false);
  readonly careLoaded = signal(false);
  readonly careSavedMrn = signal<string | null>(null);

  // 出院關懷名單
  readonly dischargedItems = signal<AkiCareItem[]>([]);
  readonly dischargedLoading = signal(false);
  readonly dischargedLoaded = signal(false);
  readonly dischargedLatestDate = signal<string | null>(null);
  // 只看最近 N 天出院（0 = 全部）
  readonly dischargedDays = signal<number>(30);
  readonly dayOptions = [7, 14, 30, 0];

  // 依「最後在院日距最新資料日的天數」過濾出院名單
  readonly filteredDischargedItems = computed(() => {
    const n = this.dischargedDays();
    const items = this.dischargedItems();
    const ref = this.dischargedLatestDate();
    if (!n || !ref) return items;
    const refT = new Date(ref).getTime();
    return items.filter((it) => {
      const d = it.dischargeDate || it.lastSeenDate;
      if (!d) return true;
      const days = (refT - new Date(d).getTime()) / 86400000;
      return days <= n;
    });
  });

  readonly isDischargedView = computed(() => this.activeTab() === 'discharged');
  readonly currentCareItems = computed(() =>
    this.isDischargedView() ? this.filteredDischargedItems() : this.careItems(),
  );

  // 病房別篩選：全部 / 加護 / 一般病房
  readonly careWardFilter = signal<'all' | 'icu' | 'ward'>('all');
  readonly displayCareItems = computed(() => {
    const f = this.careWardFilter();
    const items = this.currentCareItems();
    if (f === 'all') return items;
    return items.filter((it) => (f === 'icu' ? isIcuWard(it.ward) : !isIcuWard(it.ward)));
  });
  readonly currentCareLoading = computed(() =>
    this.isDischargedView() ? this.dischargedLoading() : this.careLoading(),
  );
  readonly dialysisOptions = ['HD', 'SLED', 'CVVHDF', 'PD', 'Hospice', '無'];
  readonly nephrologyOptions = ['已會診', '會診中', '未會診'];
  readonly ckdOptions = ['無', 'G1', 'G2', 'G3a', 'G3b', 'G4', 'G5', '未知'];

  private readonly colorMap = new Map(CATEGORY_DEFS.map((d) => [d.key, d]));

  // 隱藏病房(單托嬰/嬰兒病床)後的病人清單 —— 摘要與地圖皆以此為準，計數才一致
  readonly visiblePatients = computed(() =>
    (this.data()?.patients || []).filter((p) => !isHiddenWard(p.ward)),
  );

  // 摘要（含 0 的分類也顯示，方便一眼看全）
  readonly summaryRow = computed(() => {
    const counts: Partial<Record<AkiCategory, number>> = {};
    for (const p of this.visiblePatients()) {
      counts[p.category] = (counts[p.category] || 0) + 1;
    }
    return CATEGORY_DEFS.map((def) => ({
      ...def,
      count: counts[def.key] || 0,
    }));
  });

  readonly totalPatients = computed(() => this.visiblePatients().length);

  // 病程摘要列（可點擊疊加篩選）
  readonly courseSummary = computed(() =>
    COURSE_DEFS.map((def) => ({
      ...def,
      count: this.visiblePatients().filter((p) => matchCourse(p, def.key)).length,
    })),
  );

  // 篩選後依護理站分組
  readonly wardGroups = computed<WardGroup[]>(() => {
    const cat = this.filterCategory();
    const q = this.search().trim().toLowerCase();
    const groups = new Map<string, WardGroup>();

    const course = this.filterCourse();
    for (const p of this.visiblePatients()) {
      if (cat === 'aki') {
        if (!(p.stage != null && p.stage >= 1)) continue;
      } else if (cat !== 'all' && p.category !== cat) {
        continue;
      }
      if (!matchCourse(p, course)) continue;
      if (q) {
        const hay = `${p.name} ${p.mrn} ${p.bed} ${p.physician} ${p.dept}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      let g = groups.get(p.ward);
      if (!g) {
        g = { ward: p.ward, patients: [], counts: {} };
        groups.set(p.ward, g);
      }
      g.patients.push(p);
      g.counts[p.category] = (g.counts[p.category] || 0) + 1;
    }

    const arr = [...groups.values()];
    // 卡片內依床號順序排列（numeric-aware：5A02 在 5A10 之前）
    for (const g of arr) {
      g.patients.sort((a, b) =>
        (a.bed || '').localeCompare(b.bed || '', undefined, { numeric: true, sensitivity: 'base' }),
      );
    }
    // 護理站固定順序：加護 → 5–7樓A–D → 其他 → GC
    arr.sort((a, b) => compareWard(a.ward, b.ward));
    return arr;
  });

  readonly watchList = computed(() => this.data()?.watchList || []);

  // 比例統計標題：跟隨上方篩選器（Stage 3 比例 / AKI 比例 …）
  readonly filterRatioLabel = computed(() => {
    const cat = this.filterCategory();
    return cat === 'all' || cat === 'aki' ? 'AKI 比例' : `${this.label(cat as AkiCategory)} 比例`;
  });

  // 依目前篩選器計算各站命中比例，分「加護」與「一般病房」兩組各取前2（分母 ≥5 以免小病房失真）
  readonly topWardStats = computed<{ icu: WardStat[]; ward: WardStat[] }>(() => {
    const cat = this.filterCategory();
    const hit = (p: AkiPatient) =>
      cat === 'all' || cat === 'aki' ? p.stage != null && p.stage >= 1 : p.category === cat;
    const map = new Map<string, { ward: string; total: number; hit: number }>();
    for (const p of this.visiblePatients()) {
      let e = map.get(p.ward);
      if (!e) {
        e = { ward: p.ward, total: 0, hit: 0 };
        map.set(p.ward, e);
      }
      e.total++;
      if (hit(p)) e.hit++;
    }
    const all = [...map.values()]
      .filter((e) => e.hit >= 1 && e.total >= 5)
      .map((e) => ({ ...e, pct: Math.round((e.hit / e.total) * 100) }))
      .sort((a, b) => b.pct - a.pct || b.hit - a.hit);
    return {
      icu: all.filter((e) => isIcuWard(e.ward)).slice(0, 2),
      ward: all.filter((e) => !isIcuWard(e.ward)).slice(0, 2),
    };
  });

  ngOnInit(): void {
    this.load();
  }

  color(cat: AkiCategory): string {
    return this.colorMap.get(cat)?.color || '#b0bec5';
  }

  label(cat: AkiCategory): string {
    return this.colorMap.get(cat)?.label || cat;
  }

  wardLabel(ward: string): string {
    // "D5A_5A護理站" → "5A護理站"
    const idx = ward.indexOf('_');
    return idx >= 0 ? ward.slice(idx + 1) : ward;
  }

  async load(date?: string): Promise<void> {
    this.loading.set(true);
    this.message.set(null);
    try {
      const res = await this.akiApi.getMap(date || this.selectedDate() || undefined);
      this.data.set(res);
      if (res.snapshotDate && !this.selectedDate()) this.selectedDate.set(res.snapshotDate);
    } catch (e: any) {
      this.message.set({ type: 'error', text: e?.error?.message || e?.message || '載入失敗' });
    } finally {
      this.loading.set(false);
    }
  }

  onDateChange(date: string): void {
    this.selectedDate.set(date);
    this.load(date);
    if (this.careLoaded()) this.loadCare(date);
  }

  setFilter(cat: AkiCategory | 'all' | 'aki'): void {
    this.filterCategory.set(cat);
  }

  setCourseFilter(f: CourseFilter): void {
    this.filterCourse.set(this.filterCourse() === f ? 'all' : f);
  }

  // 病程徽章（卡片 / 關懷名單共用）
  courseBadges(p: AkiCourseFields): { label: string; color: string; title: string }[] {
    const badges: { label: string; color: string; title: string }[] = [];
    if (p.ckdSuspected) badges.push({ label: p.ckdBand ? `CKD ${p.ckdBand}` : 'CKD', color: '#6d4c41', title: '疑似 CKD（eGFR<60 持續 ≥90 天）' });
    if (p.akd) badges.push({ label: 'AKD', color: '#e65100', title: 'AKI 後 7–90 天腎功能未回基準（急性腎臟病）' });
    if (p.admissionAkiStage != null) {
      if (p.akiCourse === 'recovering') badges.push({ label: `本次AKI S${p.admissionAkiStage}·恢復中`, color: '#00897b', title: '本次住院 AKI，peak 已過、Cr 下降 ≥25%' });
      else if (p.akiCourse === 'recovered') badges.push({ label: `本次AKI S${p.admissionAkiStage}·已恢復`, color: '#43a047', title: '本次住院曾 AKI，最新 Cr 已回基準範圍' });
      else badges.push({ label: `本次AKI S${p.admissionAkiStage}`, color: '#c62828', title: '本次住院 AKI 進行中' });
    }
    return badges;
  }

  courseLabel(course: string | null): string {
    return course === 'ongoing' ? '進行中' : course === 'recovering' ? '恢復中' : course === 'recovered' ? '已恢復' : '';
  }

  // ---------- 頁籤 / 關懷名單 ----------

  switchTab(tab: 'map' | 'care' | 'discharged'): void {
    this.activeTab.set(tab);
    if (tab === 'care' && !this.careLoaded()) this.loadCare();
    if (tab === 'discharged' && !this.dischargedLoaded()) this.loadDischarged();
  }

  async loadDischarged(): Promise<void> {
    this.dischargedLoading.set(true);
    try {
      const res = await this.akiApi.getDischargedCareList();
      for (const it of res.items) {
        if (!it.dialysisStatus && it.autoDialysisMode && this.dialysisOptions.includes(it.autoDialysisMode)) {
          it.dialysisStatus = it.autoDialysisMode;
        }
      }
      this.dischargedItems.set(res.items);
      this.dischargedLatestDate.set(res.latestDate);
      this.dischargedLoaded.set(true);
    } catch (e: any) {
      this.message.set({ type: 'error', text: e?.error?.message || e?.message || '載入出院關懷名單失敗' });
    } finally {
      this.dischargedLoading.set(false);
    }
  }

  async loadCare(date?: string): Promise<void> {
    this.careLoading.set(true);
    try {
      const res = await this.akiApi.getCareList(date || this.selectedDate() || undefined);
      // 是否透析：未填則以自動偵測到的 RRT 模式預填（HD/SLED/CVVHDF）
      for (const it of res.items) {
        if (!it.dialysisStatus && it.autoDialysisMode && this.dialysisOptions.includes(it.autoDialysisMode)) {
          it.dialysisStatus = it.autoDialysisMode;
        }
      }
      this.careItems.set(res.items);
      this.careLoaded.set(true);
    } catch (e: any) {
      this.message.set({ type: 'error', text: e?.error?.message || e?.message || '載入關懷名單失敗' });
    } finally {
      this.careLoading.set(false);
    }
  }

  async saveCareRow(item: AkiCareItem, extra: Record<string, unknown> = {}): Promise<void> {
    try {
      const res = await this.akiApi.saveCare(item.mrn, {
        ckdHistory: item.ckdHistory,
        nephrologyConsult: item.nephrologyConsult,
        akiCause: item.akiCause,
        dialysisStatus: item.dialysisStatus,
        careResult: item.careResult,
        ...extra,
      });
      if (res?.care) {
        item.carePhysician = res.care.carePhysician || '';
        item.signedAt = res.care.signedAt || null;
      }
      this.careSavedMrn.set(item.mrn);
    } catch (e: any) {
      this.message.set({ type: 'error', text: e?.error?.message || e?.message || '儲存失敗' });
    }
  }

  sign(item: AkiCareItem): void {
    this.saveCareRow(item, { sign: true });
  }

  unsign(item: AkiCareItem): void {
    this.saveCareRow(item, { clearSign: true });
  }

  stageLabel(item: { stage: number | null; category: AkiCategory }): string {
    if (item.stage != null && item.stage >= 1) return `Stage ${item.stage}`;
    if (item.category === 'esrd') return '疑似 ESRD';
    return '';
  }

  exportCareExcel(): void {
    const discharged = this.isDischargedView();
    const rows = this.displayCareItems().map((it) => {
      const row: Record<string, string> = {
        病歷號: it.mrn,
        姓名: it.name,
        病床號: it.bed,
        主治醫師: it.physician,
        科別: it.dept,
        'AKI Stage': this.stageLabel(it),
      };
      if (discharged) row['出院日'] = it.dischargeDate || it.lastSeenDate || '';
      row['疑似CKD'] = it.ckdSuspected ? (it.ckdBand || 'Y') : '';
      row['AKD'] = it.akd ? 'Y' : '';
      row['本次住院AKI'] = it.admissionAkiStage != null ? `S${it.admissionAkiStage}${this.courseLabel(it.akiCourse) ? '·' + this.courseLabel(it.akiCourse) : ''}` : '';
      row['CKD病史'] = it.ckdHistory;
      row['腎臟科會診'] = it.nephrologyConsult;
      row['AKI原因'] = it.akiCause;
      row['是否透析'] = it.dialysisStatus;
      row['關懷結果'] = it.careResult;
      row['關懷醫師簽核'] = it.carePhysician;
      row['簽核時間'] = it.signedAt || '';
      return row;
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, discharged ? '出院AKI關懷名單' : 'AKI關懷名單');
    const date = this.data()?.snapshotDate || this.selectedDate() || '';
    XLSX.writeFile(wb, `${discharged ? '出院' : ''}AKI關懷名單_${date}.xlsx`);
  }

  private fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        const comma = result.indexOf(',');
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  async onPickInpatients(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.uploadingInpatients.set(true);
    this.message.set(null);
    try {
      const b64 = await this.fileToBase64(file);
      const res = await this.akiApi.uploadInpatients(file.name, b64);
      this.uploadResult.set({
        ok: true,
        title: '留院清單匯入成功',
        fileName: file.name,
        lines: [
          `匯入 ${res.patients} 位在院病人`,
          `快照日期：${res.snapshotDate}`,
          `檔內資料列：${res.rowCount} 列（同病人多診斷已合併）`,
        ],
        hint: '同快照日重複上傳會以新檔覆蓋。',
      });
      this.selectedDate.set(res.snapshotDate);
      await this.load(res.snapshotDate);
      if (this.careLoaded()) await this.loadCare(res.snapshotDate);
      if (this.dischargedLoaded()) await this.loadDischarged();
    } catch (e: any) {
      this.uploadResult.set({
        ok: false,
        title: '留院清單匯入失敗',
        fileName: file.name,
        lines: [e?.error?.message || e?.message || '未知錯誤'],
        hint: '請確認檔案為「W1.1 留院病人清單明細表」原始匯出檔。',
      });
    } finally {
      this.uploadingInpatients.set(false);
      input.value = '';
    }
  }

  async onPickLabs(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.uploadingLabs.set(true);
    this.message.set(null);
    try {
      const b64 = await this.fileToBase64(file);
      const res = await this.akiApi.uploadLabs(file.name, b64);
      const dup = res.total - res.imported - (res.egfrBackfilled || 0);
      this.uploadResult.set({
        ok: true,
        title: '檢驗明細匯入成功',
        fileName: file.name,
        lines: [
          `新增 ${res.imported} 筆檢驗散點`,
          ...(res.egfrBackfilled ? [`為既有資料補上 eGFR ${res.egfrBackfilled} 筆`] : []),
          ...(dup > 0 ? [`${dup} 筆已在資料庫中（自動去重，不會重複累積）`] : []),
          `檔案區間：${res.range.start} ~ ${res.range.end}（共解析 ${res.total} 筆）`,
        ],
        hint: res.imported === 0 && !res.egfrBackfilled
          ? '新增 0 筆代表這個檔案的資料先前都已匯入過，屬正常去重，不是失敗。'
          : undefined,
      });
      await this.load();
      if (this.careLoaded()) await this.loadCare();
      if (this.dischargedLoaded()) await this.loadDischarged();
    } catch (e: any) {
      this.uploadResult.set({
        ok: false,
        title: '檢驗明細匯入失敗',
        fileName: file.name,
        lines: [e?.error?.message || e?.message || '未知錯誤'],
        hint: '請確認檔案為「8.1 報告區間明細門急住」或舊版檢驗明細的原始匯出檔。',
      });
    } finally {
      this.uploadingLabs.set(false);
      input.value = '';
    }
  }

  // 上傳紀錄
  async openBatches(): Promise<void> {
    this.showBatches.set(true);
    this.batchesLoading.set(true);
    try {
      const res = await this.akiApi.getBatches();
      this.batches.set(res.batches);
    } catch (e: any) {
      this.message.set({ type: 'error', text: e?.error?.message || e?.message || '載入上傳紀錄失敗' });
    } finally {
      this.batchesLoading.set(false);
    }
  }

  async openDetail(mrn: string): Promise<void> {
    this.detailLoading.set(true);
    this.detail.set(null);
    try {
      const res = await this.akiApi.getPatient(mrn);
      this.detail.set(res);
    } catch (e: any) {
      this.message.set({ type: 'error', text: e?.error?.message || e?.message || '載入病人明細失敗' });
    } finally {
      this.detailLoading.set(false);
    }
  }

  closeDetail(): void {
    this.detail.set(null);
  }

  sourceLabel(src: string): string {
    return src === 'OPD' ? '門診' : src === 'ER' ? '急診' : src === 'IPD' ? '住院' : src;
  }

  // 明細表列標記：達 AKI（stage≥1）時，把峰值列與基準列標色，一眼看出是哪筆
  private matchStagingPoint(p: { source: string; testDate: string; creatinine: number | null }, ref?: { source: string; date: string; value: number }): boolean {
    const d = this.detail();
    if (!d || d.staging.stage == null || d.staging.stage < 1 || !ref) return false;
    return p.testDate === ref.date && p.creatinine === ref.value && p.source === ref.source;
  }

  isPeakPoint(p: { source: string; testDate: string; creatinine: number | null }): boolean {
    return this.matchStagingPoint(p, this.detail()?.staging.peak);
  }

  isBaselinePoint(p: { source: string; testDate: string; creatinine: number | null }): boolean {
    return this.matchStagingPoint(p, this.detail()?.staging.baseline);
  }

  // 詳情頁 Cr 趨勢折線圖的座標點
  readonly trendChart = computed(() => {
    const d = this.detail();
    const pts = d?.staging.points || [];
    if (pts.length === 0) return null;
    const W = 520, H = 160, padX = 44, padY = 20;
    const values = pts.map((p) => p.value);
    const minV = Math.min(...values);
    const maxV = Math.max(...values);
    const span = maxV - minV || 1;
    const n = pts.length;
    const x = (i: number) => (n === 1 ? W / 2 : padX + (i * (W - padX - 12)) / (n - 1));
    const y = (v: number) => H - padY - ((v - minV) / span) * (H - padY * 2);
    const dots = pts.map((p, i) => ({
      cx: x(i), cy: y(p.value), value: p.value, date: p.date, source: p.source,
      color: p.source === 'OPD' ? '#1976d2' : p.source === 'ER' ? '#7b1fa2' : '#d32f2f',
    }));
    const polyline = dots.map((dt) => `${dt.cx.toFixed(1)},${dt.cy.toFixed(1)}`).join(' ');
    return { W, H, dots, polyline, minV, maxV };
  });

  // 詳情頁 eGFR 趨勢折線圖（CKD 追蹤用；60 參考線）
  readonly egfrTrendChart = computed(() => {
    const d = this.detail();
    const pts = (d?.points || []).filter((p) => p.egfr != null);
    if (pts.length === 0) return null;
    const W = 520, H = 140, padX = 44, padY = 18;
    const values = pts.map((p) => p.egfr as number);
    const minV = Math.min(...values, 55); // 讓 60 參考線常在圖內
    const maxV = Math.max(...values, 65);
    const span = maxV - minV || 1;
    const n = pts.length;
    const x = (i: number) => (n === 1 ? W / 2 : padX + (i * (W - padX - 12)) / (n - 1));
    const y = (v: number) => H - padY - ((v - minV) / span) * (H - padY * 2);
    const dots = pts.map((p, i) => ({
      cx: x(i), cy: y(p.egfr as number), value: p.egfr as number, date: p.testDate, source: p.source,
      color: (p.egfr as number) < 60 ? '#e65100' : '#43a047',
    }));
    const polyline = dots.map((dt) => `${dt.cx.toFixed(1)},${dt.cy.toFixed(1)}`).join(' ');
    return { W, H, dots, polyline, refY: y(60) };
  });
}
