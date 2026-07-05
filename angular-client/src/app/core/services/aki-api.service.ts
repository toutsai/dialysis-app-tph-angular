// 全院 AKI Map API 服務（專師專用）
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';

export type AkiCategory =
  | 'stage-3' | 'stage-2' | 'stage-1' | 'esrd' | 'stage-0' | 'single' | 'no-data';

export interface AkiPatient {
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

export interface AkiWatchItem {
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

export interface AkiMapResponse {
  snapshotDate: string | null;
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
  creatinine: number;
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
  info: (Omit<AkiPatient, 'category' | 'stage' | 'latestCr' | 'latestDate' | 'baselineCr' | 'peakCr' | 'ratio' | 'pointCount' | 'dialysisMode'> & { snapshotDate: string }) | null;
  staging: AkiStaging;
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

export interface AkiCareItem {
  mrn: string;
  name: string;
  ward: string;
  bed: string;
  dept: string;
  physician: string;
  category: AkiCategory;
  stage: number | null;
  autoDialysisMode: string | null;
  ckdHistory: string;
  nephrologyConsult: string;
  akiCause: string;
  dialysisStatus: string;
  careResult: string;
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
      this.api.post<{ success: boolean; imported: number; total: number; range: { start: string; end: string } }>(
        '/aki/upload/labs',
        { fileName, fileContentBase64 },
      ),
    );
  }
}
