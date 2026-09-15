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
  openRows?: number;
  days?: number;
  fromClinic?: number;
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

// ---------- 階段 3：個案紀錄 ----------

export type CkdRecType = 'access' | 'sdm' | 'contact' | 'extEnroll' | 'claimFix' | 'enrollFix' | 'noEnroll' | 'note';

export interface CkdRecField {
  k: string;
  t: string;
  type: 'select' | 'text' | 'textarea' | 'date' | 'checks';
  req?: number;
  opts?: string[];
  ph?: string;
}

export interface CkdRecTypeDef {
  key: CkdRecType;
  label: string;
  tag: string;
  color: string;
  fields: CkdRecField[];
}

export interface CkdRecord {
  id: string;
  type: CkdRecType;
  mrn: string;
  name: string;
  created: string;
  updated: string;
  createdBy: CkdActor | null;
  updatedBy: CkdActor | null;
  line?: string;
  when?: string;
  typeLabel?: string;
  [field: string]: any;
}

/** 第一、二區的小標記 */
export interface CkdRecChips {
  total: number;
  access: { status: string; type: string } | null;
  sdm: { leaning: string; at: string } | null;
  extPos: boolean;
  extHospital: string;
  notes: number;
}

export interface CkdPcodeRow {
  visit: string;
  code: string;
  ctype: string;
  prog: string;
  doctor: string;
  price: number | null;
  src: string[];
  voided?: boolean;
  gapPrev?: number;
  needPrev?: number;
}

export interface CkdRecordStats {
  total: number;
  byType: Partial<Record<CkdRecType, number>>;
  accessPersons: number;
  sdmFollow: number;
}

export interface CkdPatientSummary {
  mrn: string;
  name: string;
  records: CkdRecord[];
  chips: CkdRecChips | null;
  pcode: { rows: CkdPcodeRow[]; stat: { total: number; billed: number; unbilled: number; thisYear: number; annThisYear: number; points: number; short: number } };
  ext: CkdRecord | null;
  noEn: any;
}

// ---------- 階段 2：判讀 ----------

export interface CkdClinicSlot {
  mrn: string;
  name: string;
  sex: string;
  age: number | null;
  date: string | null;
  half: string;
  dept: string;
  room: string;
  doctor: string;
  no: string;
  pDM: string;
  manual: boolean;
}

export interface CkdMergedLab {
  date: string | null;
  v: Record<string, number>;
  flag: Record<string, string>;
  q: Record<string, string | undefined>;
  dateOf: Record<string, string>;
  src: number;
  kinds: string[];
  calcUpcr: boolean;
}

export interface CkdVerdictBox {
  tone: 'y' | 'n' | 'q' | 'off';
  head: string;
  sub: string;
  act: { cls: string; lab: string; txt: string; vpn?: string; rec?: string } | null;
}

export interface CkdAlert { t: string; m: string }
export interface CkdIndicator { n: string; v: string | number; ok: boolean }

export interface CkdRowA {
  mrn: string;
  p: CkdClinicSlot | null;
  name: string;
  prog: 'pre' | 'early';
  dkd: boolean;
  isDM: boolean;
  isNew: boolean;
  otherDept: boolean;
  egfr: number | null;
  src: string;
  mdrd: number | null;
  stage: string | null;
  upcr: number | null;
  uacr: number | null;
  lab: CkdMergedLab | null;
  labOk: boolean;
  labGap: number | null;
  last: { visit: string | null; enroll: string | null; code: string; ctype: string; doctor: string; src: string } | null;
  timeline: { visit: string | null; code: string; ctype: string; src: string; doctor: string; price: number | null }[];
  nextDue: string | null;
  nextApp: string | null;
  caseDoctor: string;
  gap: number | null;
  need: number | null;
  code: string | null;
  status: 'ok' | 'over' | 'cap' | 'wait' | 'none' | 'dkd';
  why: string[];
  nYear: number;
  n12: number;
  tenure: number | null;
  enroll: string | null;
  ann: { ok: boolean; code: string | null; why: string[] };
  alerts: CkdAlert[];
  slope: { v: number; mo: number } | null;
  recon: { anchor: string | null; misses: { visit: string; code: string }[]; shortBilled: { at: string; code: string; gap: number; need: number }[] } | null;
  miss: string[];
  unk: string[];
  bed: string[];
  ord: string[];
  inds: CkdIndicator[];
  age: number | null;
  box: CkdVerdictBox;
  chips: CkdRecChips | null;
}

export interface CkdRowB {
  mrn: string;
  p: CkdClinicSlot;
  name: string;
  lab: CkdMergedLab | null;
  egfr: number | null;
  from: string;
  upcr: number | null;
  uacr: number | null;
  stage: string | null;
  verdict: 'pre' | 'early' | 'check' | 'nodata' | 'no';
  code: string | null;
  why: string[];
  age: number | null;
  closed: boolean;
  closeKind: string | null;
  closeInfo: { at: string; prog: string; code: string; reason: string } | null;
  noEn: any;
  enrollFix: any;
  miss: string[];
  unk: string[];
  bed: string[];
  ord: string[];
  box: CkdVerdictBox;
  chips: CkdRecChips | null;
  ext: { result: string; at: string; hospital: string; extProg: string } | null;
}

export interface CkdSessionGroup { date: string; doctor: string; n: number }

export interface CkdDaily {
  date: string;
  doctorSel: string;
  otherSession: string;
  sessions: { groups: CkdSessionGroup[]; others: Record<string, number>; otherGroups: Record<string, { key: string; dept: string; doctor: string; n: number }[]> };
  deptInfo: { total: number; matched: number; filter: string; undated: number; allDates: string[]; selDate: string | null; depts: string[] };
  cfg: { preGap: number; earlyNew: number; earlyGap: number; dmGap: number; over: number; labWin: number; dept: string; allA: boolean };
  hasCases: boolean;
  hasClinic: boolean;
  A: CkdRowA[];
  B: CkdRowB[];
  timing: { loadMs: number; analyzeMs: number };
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

  /** 判讀日 × 醫師 的 A/B 判讀；不帶 date = 本科最近門診日 */
  getDaily(date?: string, doctor?: string): Promise<CkdDaily> {
    const params: Record<string, string> = {};
    if (date) params['date'] = date;
    if (doctor) params['doctor'] = doctor;
    return firstValueFrom(this.api.get<CkdDaily>('/ckd/daily', params));
  }

  // ---------- 個案紀錄 ----------

  getRecordTypes(): Promise<{ types: CkdRecTypeDef[] }> {
    return firstValueFrom(this.api.get<{ types: CkdRecTypeDef[] }>('/ckd/records/types'));
  }

  listRecords(params: { mrn?: string; type?: string; limit?: number }): Promise<{ records: CkdRecord[] }> {
    const p: Record<string, string> = {};
    if (params.mrn) p['mrn'] = params.mrn;
    if (params.type) p['type'] = params.type;
    if (params.limit) p['limit'] = String(params.limit);
    return firstValueFrom(this.api.get<{ records: CkdRecord[] }>('/ckd/records', p));
  }

  getRecordStats(): Promise<CkdRecordStats> {
    return firstValueFrom(this.api.get<CkdRecordStats>('/ckd/records/stats'));
  }

  getPatientSummary(mrn: string): Promise<CkdPatientSummary> {
    return firstValueFrom(this.api.get<CkdPatientSummary>(`/ckd/patients/${encodeURIComponent(mrn)}/summary`));
  }

  searchPatients(q: string): Promise<{ patients: { mrn: string; name: string }[] }> {
    return firstValueFrom(this.api.get<{ patients: { mrn: string; name: string }[] }>('/ckd/patients/search', { q }));
  }

  createRecord(mrn: string, type: CkdRecType, data: Record<string, unknown>): Promise<{ record: CkdRecord }> {
    return firstValueFrom(this.api.post<{ record: CkdRecord }>('/ckd/records', { mrn, type, data }));
  }

  updateRecord(id: string, data: Record<string, unknown>): Promise<{ record: CkdRecord }> {
    return firstValueFrom(this.api.put<{ record: CkdRecord }>(`/ckd/records/${encodeURIComponent(id)}`, { data }));
  }

  deleteRecord(id: string): Promise<{ deleted: boolean }> {
    return firstValueFrom(this.api.delete<{ deleted: boolean }>(`/ckd/records/${encodeURIComponent(id)}`));
  }
}
