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
  sign?: boolean;
  clearSign?: boolean;
}

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
      this.api.put<{ success: boolean; care: any }>(`/aki/care/${mrn}`, payload),
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
