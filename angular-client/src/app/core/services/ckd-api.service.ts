// 門診 CKD 收案追蹤 API（/api/ckd；admin / editor / contributor）
// 2026-09-15 起 Angular 重寫，分階段擴充；計畫見 docs/2026-09-15-ckd-clinic-tab-plan.md
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';

export type CkdReportKind = 'case' | 'clinic' | 'lab' | 'bill';

export interface CkdSettings {
  preGap: number;
  earlyNew: number;
  earlyGap: number;
  dmGap: number;
  over: number;
  labWin: number;
  dept: string;
  allA: boolean;
  recallGrace: number;
  alertWin: number;
  rrtEgfr: number;
}

export interface CkdPhase {
  no: number;
  title: string;
  status: 'done' | 'wip' | 'todo';
}

export interface CkdActor { uid?: string | null; name?: string }

export interface CkdIngestStats {
  rows: number;
  persons: number;
  added: number;
  updated?: number;
  dup?: number;
  removed?: number;
}

export interface CkdUploadBatch {
  id: string;
  kind: CkdReportKind;
  kindLabel: string;
  fileName: string;
  rowCount: number;
  inserted: number;
  replaced: number;
  rangeStart: string | null;
  rangeEnd: string | null;
  uploadedBy: CkdActor | null;
  stats: CkdIngestStats & { labStats?: CkdIngestStats | null };
  createdAt: string;
}

export interface CkdSourceSummary {
  kind: CkdReportKind;
  label: string;
  rows: number;
  persons: number;
  rangeStart: string | null;
  rangeEnd: string | null;
  files: number;
  lastFile: string | null;
  lastAt: string | null;
  lastBy: CkdActor | null;
  openRows?: number;     // case：未結案列
  days?: number;         // clinic：涵蓋看診日數
  fromClinic?: number;   // lab：門診清單自帶的檢驗份數
}

export interface CkdStatus {
  phases: CkdPhase[];
  counts: { cases: number; clinicVisits: number; labs: number; billing: number; records: number };
  sources: Record<CkdReportKind, CkdSourceSummary>;
  batches: CkdUploadBatch[];
  settings: CkdSettings;
  settingsUpdatedBy: CkdActor | null;
  settingsUpdatedAt: string | null;
  supportedKinds: { kind: CkdReportKind; label: string }[];
  uploadMaxBytes: number;
}

export interface CkdSettingsResponse {
  settings: CkdSettings;
  defaults: CkdSettings;
  updatedBy: CkdActor | null;
  updatedAt: string | null;
}

export interface CkdUploadResult {
  dup: boolean;
  fileName: string;
  message?: string;
  kind?: CkdReportKind;
  kindLabel?: string;
  batchId?: string;
  aoaRows?: number;
  stats?: CkdIngestStats;
  labStats?: CkdIngestStats | null;
  range?: { start: string | null; end: string | null };
  sources?: Record<CkdReportKind, CkdSourceSummary>;
}

@Injectable({ providedIn: 'root' })
export class CkdApiService {
  private readonly api = inject(ApiService);
  private readonly http = inject(HttpClient);

  getStatus(): Promise<CkdStatus> {
    return firstValueFrom(this.api.get<CkdStatus>('/ckd/status'));
  }

  getBatches(limit = 30): Promise<{ batches: CkdUploadBatch[] }> {
    return firstValueFrom(this.api.get<{ batches: CkdUploadBatch[] }>('/ckd/batches', { limit: String(limit) }));
  }

  getSettings(): Promise<CkdSettingsResponse> {
    return firstValueFrom(this.api.get<CkdSettingsResponse>('/ckd/settings'));
  }

  saveSettings(patch: Partial<CkdSettings>): Promise<CkdSettingsResponse> {
    return firstValueFrom(this.api.put<CkdSettingsResponse>('/ckd/settings', patch));
  }

  /** 上傳一個 HIS 報表：raw 二進位（不轉 base64），檔名放 header；auth interceptor 會補 Bearer */
  uploadFile(file: File, forcedKind?: CkdReportKind): Promise<CkdUploadResult> {
    let headers = new HttpHeaders({
      'Content-Type': 'application/octet-stream',
      'X-File-Name': encodeURIComponent(file.name),
    });
    if (forcedKind) headers = headers.set('X-Force-Kind', forcedKind);
    return firstValueFrom(this.http.post<CkdUploadResult>(`${this.api.baseUrl}/ckd/upload`, file, { headers }));
  }
}
