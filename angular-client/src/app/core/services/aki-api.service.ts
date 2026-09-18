// 全院 AKI Map API 服務（專師專用）
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';

export type AkiCategory =
  | 'stage-3' | 'stage-2' | 'stage-1' | 'esrd' | 'stage-0' | 'single' | 'no-data';

export type AkiCourse = 'ongoing' | 'recovering' | 'recovered';

// 病程分析的扁平欄位（badge / 篩選 / 匯出共用）
export interface AkiCourseFields {
  ckdSuspected: boolean;
  ckdBand: string | null;
  akd: boolean;
  admissionAkiStage: number | null;
  akiCourse: AkiCourse | null;
  todayAkiStage: number | null;
}

export interface AkiPatient extends AkiCourseFields {
  mrn: string;
  name: string;
  ward: string;
  bed: string;
  dept: string;
  physician: string;
  sex: string;
  age: string;
  admitDate: string | null;
  dischargeDate: string | null;
  diagnoses: { code: string; name: string }[];
  category: AkiCategory;
  stage: number | null;
  latestCr: number | null;
  latestDate: string | null;
  baselineCr: number | null;
  peakCr: number | null;
  ratio: number | null;
  pointCount: number;
  dialysisMode: string | null;
}

export interface AkiWatchItem extends AkiCourseFields {
  mrn: string;
  name: string;
  category: AkiCategory;
  stage: number | null;
  latestCr: number | null;
  latestDate: string | null;
  baselineCr: number | null;
  peakCr: number | null;
  ratio: number | null;
  dialysisMode: string | null;
}

// 病人詳情的完整病程分析（含判定依據）
export interface AkiAnalysis {
  isEsrd: boolean;
  ckd: {
    suspected: boolean;
    band: string | null;
    basis: string | null;
    latestEgfr: number | null;
    spanDays: number | null;
    lowCount: number | null;
    egfrCount: number;
  };
  akd: {
    active: boolean;
    onsetDate: string | null;
    daysSinceOnset: number | null;
    latestCr: number | null;
    latestRatio: number | null;
  };
  admission: {
    admitDate: string;
    hasAki: boolean;
    stage: number | null;
    baseline: { date: string; value: number } | null;
    baselineMode: string | null;
    eventRef?: { date: string; value: number };
    peak: { date: string; value: number } | null;
    latest: { date: string; value: number } | null;
    course: AkiCourse | null;
  } | null;
  daily?: { active: boolean; date: string | null; stage: number | null; cr: number | null };
}

export interface AkiMapResponse {
  snapshotDate: string | null;
  latestDataDate?: string | null;
  patients: AkiPatient[];
  summary: Partial<Record<AkiCategory, number>>;
  wardSummary: Record<string, Partial<Record<AkiCategory, number>>>;
  watchList: AkiWatchItem[];
  availableDates: string[];
  categoryMeta?: Record<string, { label: string; order: number }>;
}

export interface AkiLabPoint {
  source: 'OPD' | 'ER' | 'IPD';
  testDate: string;
  creatinine: number | null;
  egfr: number | null;
  orderCode: string;
}

export interface AkiStaging {
  category: AkiCategory;
  stage: number | null;
  ratio?: number;
  absDelta?: number;
  baseline?: { source: string; date: string; value: number };
  peak?: { source: string; date: string; value: number };
  baselineMode?: string;
  overallMin?: number;
  latest?: { source: string; date: string; value: number };
  pointCount: number;
  points: { source: string; date: string; value: number }[];
}

export interface AkiPatientDetail {
  mrn: string;
  info: (Omit<AkiPatient, 'category' | 'stage' | 'latestCr' | 'latestDate' | 'baselineCr' | 'peakCr' | 'ratio' | 'pointCount' | 'dialysisMode' | keyof AkiCourseFields> & { snapshotDate: string }) | null;
  staging: AkiStaging;
  analysis: AkiAnalysis | null;
  points: AkiLabPoint[];
  dialysisMode: string | null;
}

export interface AkiUploadBatch {
  id: string;
  kind: 'inpatients' | 'labs';
  fileName: string;
  snapshotDate: string | null;
  rangeStart: string | null;
  rangeEnd: string | null;
  rowCount: number;
  importedCount: number;
  uploadedBy: string;
  uploadedAt: string;
}

export interface AkiCareItem extends AkiCourseFields {
  mrn: string;
  name: string;
  ward: string;
  bed: string;
  dept: string;
  physician: string;
  category: AkiCategory;
  stage: number | null;
  // 最近一次 AKI 事件起始日（含已緩解；ESRD/資料不足者為 null）
  akiOnsetDate?: string | null;
  latestEgfr?: number | null;
  ckdBasis?: string | null;
  autoDialysisMode: string | null;
  ckdHistory: string;
  nephrologyConsult: string;
  akiCause: string;
  dialysisStatus: string;
  careResult: string;
  // AKI 名單專屬
  nephrotoxinReview: string;
  urineOutput: string;
  // CKD 名單專屬
  preesrdEnrolled: string;
  ckdEducation: string;
  vascularPrep: string;
  // 出院待追蹤名單專屬
  followupAppt: string;
  followupApptDate: string;
  followupLab: string;
  contactStatus: string;
  closureStatus: string;
  carePhysician: string;
  signedAt: string | null;
  /** 會診醫師（與 ICU 待透析評估紀錄雙向同步） */
  consultPhysician: string;
  /** 高機率透析＝ICU 透析頁「待透析評估」名單上有這位病人（後端推導，不是獨立欄位） */
  highDialysisProbability?: boolean;
  icuCandidate?: IcuCandidateBrief | null;
  dischargeDate?: string | null;
  lastSeenDate?: string | null;
}

export interface AkiCareListResponse {
  snapshotDate: string | null;
  items: AkiCareItem[];
}

export interface AkiDischargedListResponse {
  latestDate: string | null;
  items: AkiCareItem[];
}

export interface AkiCareSavePayload {
  ckdHistory?: string;
  nephrologyConsult?: string;
  akiCause?: string;
  dialysisStatus?: string;
  careResult?: string;
  nephrotoxinReview?: string;
  urineOutput?: string;
  preesrdEnrolled?: string;
  ckdEducation?: string;
  vascularPrep?: string;
  followupAppt?: string;
  followupApptDate?: string;
  followupLab?: string;
  contactStatus?: string;
  closureStatus?: string;
  consultPhysician?: string;
  highDialysisProbability?: boolean;
  sign?: boolean;
  clearSign?: boolean;
}

// ---------- ICU 透析病人（腎臟病地圖 ICU 頁籤） ----------

/** 是/否欄位：'有' / '無'；空字串 = 尚未評估 */
export type IcuYesNo = '' | '有' | '無';

export interface IcuDialysisStatusFields {
  vasopressor: IcuYesNo;
  vasopressorDetail: string;
  ecmo: IcuYesNo;
  ecmoDetail: string;
  oxygen: string;
  oxygenDetail: string;
  ufDifficulty: IcuYesNo;
  ufDetail: string;
  /** CRRT 風險檢核人工勾選項 */
  vasoHigh: IcuYesNo;
  mapLow: IcuYesNo;
  lactateHigh: IcuYesNo;
  brainInjury: IcuYesNo;
  statusUpdatedBy: string;
  statusUpdatedAt: string | null;
}

/** 後端計算的 CRRT 需求風險（HD/SLED 適用；門檻由後端回傳） */
export interface IcuCrrtRisk {
  crrtApplicable: boolean;
  crrtScore: number;
  crrtMax: number;
  crrtThreshold: number;
  crrtDirect: boolean;
  crrtFlag: boolean;
  crrtItems: string[];
}

export interface IcuDialysisPatient extends IcuDialysisStatusFields, IcuCrrtRisk {
  firstDialysis: boolean;
  id: string;
  mrn: string;
  name: string;
  status: 'ipd' | 'er';
  wardNumber: string;
  unit: string;
  bedNo: string;
  bedSort: number;
  gender: string;
  age: number | null;
  physician: string;
  vascAccess: string;
  mode: string;
  freq: string;
  bedNum: string | number | null;
  shiftIndex: number | null;
  dryWeight: number | string | null;
  dialysisTimeText: string;
  inpatientReason: string;
  doNotMove: boolean;
  akiCategory: AkiCategory | null;
  akiStage: number | null;
  latestCr: number | null;
  latestCrDate: string | null;
}

export interface IcuDialysisUnit {
  key: string;
  label: string;
  patients: IcuDialysisPatient[];
}

export interface IcuDialysisResponse {
  units: IcuDialysisUnit[];
  total: number;
  /** 待透析評估名單（已會診、可能需要 HD／SLED／CVVHDF） */
  candidates?: IcuCandidate[];
}

// ---------- ICU 待透析評估名單（已會診、可能需要 HD／SLED／CVVHDF） ----------

export type IcuCandidateMode = '' | 'HD' | 'SLED' | 'CVVHDF';
export type IcuCandidateStatus = '觀察中' | '已排定' | '已開始透析' | '不需透析' | '轉出／死亡';

export interface IcuCandidate {
  id: string;
  mrn: string;
  name: string;
  /** ICUA／ICUB／ICUD；空字串＝AKI 帶入但快照顯示不在 ICU（床位待確認） */
  unit: string;
  bedNo: string;
  physician: string;
  consultPhysician: string;
  consultDate: string;
  /** 空字串＝未定 */
  plannedMode: IcuCandidateMode;
  indications: string[];
  riskFlags: string[];
  urgency: string;
  vascularAccess: string;
  note: string;
  status: IcuCandidateStatus;
  active: boolean;
  source: 'icu' | 'aki';
  /** AKI 帶入後醫師還沒補預計模式／適應症／血行動力學 */
  needsAssessment: boolean;
  /** 依血行動力學勾選的模式提示（非驗證分數） */
  suggestedMode: 'HD' | 'SLED' | 'CVVHDF';
  riskScore: number;
  riskDirect: boolean;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  closedAt: string | null;
  akiCategory?: AkiCategory | null;
  akiStage?: number | null;
  latestCr?: number | null;
  latestCrDate?: string | null;
  /** 已出現在「透析中」名單＝已開始透析，提示結案 */
  startedDialysis?: { mode: string; bedNo: string } | null;
}

/** AKI 關懷名單上顯示用的精簡版 */
export interface IcuCandidateBrief {
  id: string;
  status: IcuCandidateStatus;
  plannedMode: IcuCandidateMode;
  unit: string;
  bedNo: string;
  needsAssessment: boolean;
}

export interface IcuCandidatePayload {
  mrn: string;
  name: string;
  unit: string;
  bedNo: string;
  physician: string;
  consultPhysician: string;
  consultDate: string;
  plannedMode: IcuCandidateMode;
  indications: string[];
  riskFlags: string[];
  urgency: string;
  vascularAccess: string;
  note: string;
  status: IcuCandidateStatus;
}

export interface IcuCandidateRiskItem {
  key: string;
  label: string;
  pts: number;
  /** 需先勾這一項才計分（NE 高劑量 ← 使用升壓劑） */
  needs?: string;
  /** 不計分、直接建議 CRRT */
  direct?: boolean;
}

export interface IcuCandidateOptions {
  indications: string[];
  riskItems: IcuCandidateRiskItem[];
}

export interface IcuCandidateLookupItem {
  mrn: string;
  name: string;
  ward: string;
  bed: string;
  physician: string;
  unit: string;
  bedNo: string;
  alreadyListed: boolean;
}

/** ICU 透析月／年統計：各模式人數（OTHER＝HD/SLED/CVVHDF 以外） */
export interface IcuModeCounts {
  HD: number;
  SLED: number;
  CVVHDF: number;
  OTHER: number;
  total: number;
}
export interface IcuStatsSummary {
  /** 有記錄的天數（上線前、未來、伺服器沒開的日子不算） */
  daysWithData: number;
  /** 人日＝每日人數加總 */
  patientDays: IcuModeCounts;
  /** 平均每日人數（人日／有記錄天數） */
  avg: IcuModeCounts;
  max: Record<keyof IcuModeCounts, { count: number; date: string } | null>;
  /** 期間內不重複病人數 */
  distinctPatients: IcuModeCounts;
}
export interface IcuStatsDay extends IcuModeCounts {
  date: string;
  hasData: boolean;
}
export interface IcuStatsMonth extends IcuStatsSummary {
  month: number;
}
export interface IcuDialysisStats {
  year: number;
  month: number | null;
  unit: string | null;
  today: string;
  /** 開始累積資料的第一天（更早的日期沒有資料） */
  firstDataDate: string;
  days?: IcuStatsDay[];
  months?: IcuStatsMonth[];
  summary: IcuStatsSummary;
}

export type IcuStatusSavePayload = Partial<Omit<IcuDialysisStatusFields, 'statusUpdatedBy' | 'statusUpdatedAt'>>;

@Injectable({ providedIn: 'root' })
export class AkiApiService {
  private readonly api = inject(ApiService);

  getMap(date?: string): Promise<AkiMapResponse> {
    return firstValueFrom(
      this.api.get<AkiMapResponse>('/aki/map', date ? { date } : undefined),
    );
  }

  getPatient(mrn: string): Promise<AkiPatientDetail> {
    return firstValueFrom(this.api.get<AkiPatientDetail>(`/aki/patient/${mrn}`));
  }

  getCkdCareList(date?: string): Promise<AkiCareListResponse> {
    const q = date ? `?date=${encodeURIComponent(date)}` : '';
    return firstValueFrom(this.api.get<AkiCareListResponse>(`/aki/ckd-care-list${q}`));
  }

  getBatches(): Promise<{ batches: AkiUploadBatch[] }> {
    return firstValueFrom(this.api.get<{ batches: AkiUploadBatch[] }>('/aki/batches'));
  }

  getCareList(date?: string): Promise<AkiCareListResponse> {
    return firstValueFrom(
      this.api.get<AkiCareListResponse>('/aki/care-list', date ? { date } : undefined),
    );
  }

  getDischargedCareList(): Promise<AkiDischargedListResponse> {
    return firstValueFrom(
      this.api.get<AkiDischargedListResponse>('/aki/discharged-care-list'),
    );
  }

  saveCare(mrn: string, payload: AkiCareSavePayload) {
    return firstValueFrom(
      this.api.put<{ success: boolean; care: any; highDialysisProbability?: boolean; icuCandidate?: IcuCandidateBrief | null }>(`/aki/care/${mrn}`, payload),
    );
  }

  getIcuDialysis(): Promise<IcuDialysisResponse> {
    return firstValueFrom(this.api.get<IcuDialysisResponse>('/aki/icu-dialysis'));
  }

  /** ICU 透析病人月／年統計：month 有值＝該月每日人數；無＝該年 12 個月彙總。unit＝ICUA/ICUB/ICUD/OTHER */
  getIcuDialysisStats(year: number, month: number | null, unit: string | null): Promise<IcuDialysisStats> {
    const params = [`year=${year}`];
    if (month) params.push(`month=${month}`);
    if (unit) params.push(`unit=${encodeURIComponent(unit)}`);
    return firstValueFrom(this.api.get<IcuDialysisStats>(`/aki/icu-dialysis/stats?${params.join('&')}`));
  }

  getIcuCandidateOptions(): Promise<IcuCandidateOptions> {
    return firstValueFrom(this.api.get<IcuCandidateOptions>('/aki/icu-candidates/options'));
  }

  lookupIcuCandidate(q: string): Promise<{ snapshotDate?: string; items: IcuCandidateLookupItem[] }> {
    return firstValueFrom(this.api.get<{ snapshotDate?: string; items: IcuCandidateLookupItem[] }>(`/aki/icu-candidates/lookup?q=${encodeURIComponent(q)}`));
  }

  createIcuCandidate(payload: IcuCandidatePayload) {
    return firstValueFrom(this.api.post<{ success: boolean; candidate: IcuCandidate }>('/aki/icu-candidates', payload));
  }

  updateIcuCandidate(id: string, payload: Partial<IcuCandidatePayload>) {
    return firstValueFrom(this.api.put<{ success: boolean; candidate: IcuCandidate }>(`/aki/icu-candidates/${id}`, payload));
  }

  deleteIcuCandidate(id: string) {
    return firstValueFrom(this.api.delete<{ success: boolean }>(`/aki/icu-candidates/${id}`));
  }

  saveIcuStatus(patientId: string, payload: IcuStatusSavePayload) {
    return firstValueFrom(
      this.api.put<{ success: boolean; status: IcuDialysisStatusFields & IcuCrrtRisk }>(`/aki/icu-status/${patientId}`, payload),
    );
  }

  uploadInpatients(fileName: string, fileContentBase64: string, snapshotDate?: string) {
    return firstValueFrom(
      this.api.post<{ success: boolean; snapshotDate: string; patients: number; rowCount: number }>(
        '/aki/upload/inpatients',
        { fileName, fileContentBase64, snapshotDate },
      ),
    );
  }

  uploadLabs(fileName: string, fileContentBase64: string) {
    return firstValueFrom(
      this.api.post<{ success: boolean; imported: number; egfrBackfilled?: number; total: number; range: { start: string; end: string } }>(
        '/aki/upload/labs',
        { fileName, fileContentBase64 },
      ),
    );
  }
}
