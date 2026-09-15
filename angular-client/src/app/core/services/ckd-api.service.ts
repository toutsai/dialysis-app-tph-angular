// 門診 CKD 收案追蹤 API（/api/ckd；admin / editor / contributor）
// 2026-09-15 起 Angular 重寫，分階段擴充；計畫見 docs/2026-09-15-ckd-clinic-tab-plan.md
import { Injectable, inject } from '@angular/core';
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

export interface CkdUploadBatch {
  id: string;
  kind: CkdReportKind;
  kindLabel: string;
  fileName: string;
  rowCount: number;
  inserted: number;
  replaced: number;
  uploadedBy: { uid?: string; name?: string } | null;
  createdAt: string;
}

export interface CkdStatus {
  phases: CkdPhase[];
  counts: { cases: number; clinicVisits: number; labs: number; billing: number; records: number };
  batches: CkdUploadBatch[];
  settings: CkdSettings;
  settingsUpdatedBy: { uid?: string; name?: string } | null;
  settingsUpdatedAt: string | null;
  supportedKinds: { kind: CkdReportKind; label: string }[];
}

export interface CkdSettingsResponse {
  settings: CkdSettings;
  defaults: CkdSettings;
  updatedBy: { uid?: string; name?: string } | null;
  updatedAt: string | null;
}

@Injectable({ providedIn: 'root' })
export class CkdApiService {
  private readonly api = inject(ApiService);

  getStatus(): Promise<CkdStatus> {
    return firstValueFrom(this.api.get<CkdStatus>('/ckd/status'));
  }

  getSettings(): Promise<CkdSettingsResponse> {
    return firstValueFrom(this.api.get<CkdSettingsResponse>('/ckd/settings'));
  }

  saveSettings(patch: Partial<CkdSettings>): Promise<CkdSettingsResponse> {
    return firstValueFrom(this.api.put<CkdSettingsResponse>('/ckd/settings', patch));
  }
}
