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
  /** 檢驗報告衛教單頁尾的聯絡電話（空白 = 印空白線） */
  handoutPhone: string;
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

// ---------- 病人彙整視窗（2026-09-20） ----------

/** 登錄簿的一段收案（同人可多段：重收案、轉方案） */
export interface CkdEnrollEpisode {
  serial: string;
  enroll: string | null;
  /** 登錄簿原文：Pre-ESRD／Early-CKD／DKD／AKD */
  cat: string;
  prog: string;
  doctor: string;
  reenroll: boolean;
  nextDue: string | null;
  closed: boolean;
  closeDate: string | null;
  reason: string;
}

/** 衛教時間軸一列：care = 方案照護就診、p8101 = 治療方式衛教、note = 個案紀錄（追蹤紀錄·衛教） */
export interface CkdEduRow {
  date: string;
  kind: 'care' | 'p8101' | 'note';
  label: string;
  code: string;
  doctor: string;
  src: string[];
  text: string;
  author: string;
  recordId: string | null;
}

/** 單一病人判讀：kind A = 已收案（a）、B = 未收案且判讀日有本科掛號（b）、none = 兩者皆無 */
export interface CkdPatientCase {
  mrn: string;
  name: string;
  date: string;
  kind: 'A' | 'B' | 'none';
  /** true = 判讀日在診次清單內（與 A／B 區同一列）；false = 取全名單稽核列 */
  inSession: boolean;
  a: CkdRowA | null;
  b: CkdRowB | null;
  episodes: CkdEnrollEpisode[];
  edu: CkdEduRow[];
  cfg: { preGap: number; earlyGap: number; over: number };
}

/** 檢驗報告衛教單的一個檢驗項目（本次／前次；dir = 偏高 H／偏低 L；by = 判定來源：HIS 標記或既有 9 條門檻） */
export interface CkdHandoutItem {
  key: string;
  label: string;
  /** 衛教單上給病人看的名稱 */
  name: string;
  unit: string;
  group: string;
  groupLabel: string;
  v: number | string;
  q: string;
  date: string;
  dir: 'H' | 'L' | '';
  by: 'his' | 'rule' | '';
  prev: { v: number | string; q: string; date: string } | null;
}

export interface CkdHandoutCaution { keys: string[]; title: string; dir: 'H' | 'L'; text: string }

/** 衛教單內容（用語由使用者審定，組裝在後端 services/ckd/handout.js；前端只負責排版成 Word） */
export interface CkdHandout {
  mrn: string;
  name: string;
  hospital: string;
  title: string;
  footer: string;
  phone: string;
  windowDays: number;
  reportDates: string[];
  enroll: { cat: string; doctor: string; date: string | null; nextDue: string | null } | null;
  nextVisit: { date: string; half: string; doctor: string; dept: string } | null;
  handout: {
    reportDate: string;
    windowFrom: string;
    items: CkdHandoutItem[];
    cautions: CkdHandoutCaution[];
    stage: { code: string; label: string; text: string; egfr: number; date: string } | null;
  } | null;
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

// ---------- 階段 4：全名單稽核 ----------

export interface CkdAuditRow {
  mrn: string;
  name: string;
  age: number | null;
  isDM: boolean;
  dkd: boolean;
  prog: 'pre' | 'early';
  code: string | null;
  egfr: number | null;
  stage: string | null;
  upcr: number | null;
  uacr: number | null;
  last: { visit: string | null; enroll: string | null } | null;
  gap: number | null;
  need: number | null;
  status: 'ok' | 'over' | 'cap' | 'wait' | 'none' | 'dkd';
  nYear: number;
  n12: number;
  tenure: number | null;
  ann: { ok: boolean; code: string | null };
  inds: CkdIndicator[];
  miss: string[];
  unk: string[];
  alerts: CkdAlert[];
  slope: { v: number; mo: number } | null;
  recon: { anchor: string | null; misses: { visit: string; code: string }[]; shortBilled: { at: string; code: string; gap: number; need: number }[] } | null;
  tooSoon: boolean;
  chips: CkdRecChips | null;
}

export interface CkdAudit {
  date: string;
  spanFrom: string | null;
  hasCases: boolean;
  rows: CkdAuditRow[];
  timing: { loadMs: number; analyzeMs: number };
}

// ---------- 階段 4：檢驗總表 ----------

export type CkdWideScope = 'all' | 'clinic' | 'enrolled' | 'unlisted';
export type CkdWideMode = 'long' | 'wide';
/** [key, 顯示名, 單位, 群組] */
export type CkdWideLab = [string, string, string, string];

export interface CkdWideTally { persons: number; rows: number; clinic: number; unlisted: number; slopeOk: number; noProt: number }

/** 每人每日期一列：21 項值在 row[key]、旗標 row[key+'_f']、定性 row[key+'_q']、推算 row['upcr_c'] */
export interface CkdWideDayRow {
  date: string | null;
  src: string;
  stage: string | null;
  bp?: string | null;
  bmi?: number | null;
  smoke?: string | null;
  educator?: string | null;
  no?: string | null;
  [k: string]: any;
}

export interface CkdWideLongRow { mrn: string; name: string; prog: string; inClinic: boolean; clinicNo: string; row: CkdWideDayRow }

export interface CkdWidePerson {
  mrn: string;
  name: string;
  sex: string;
  age: number | null;
  enroll: string | null;
  enrolled: boolean;
  prog: string;
  stage: string | null;
  egfr: number | null;
  upcr: number | null;
  slope: number | null;
  slWeak: boolean;
  slN: number;
  slSpan: number;
  n: number;
  first: string | null;
  last: string | null;
  inClinic: boolean;
  clinicNo: string;
  labOnly: boolean;
  latest: Record<string, any>;
}

export interface CkdWide {
  scope: CkdWideScope;
  q: string;
  mode: CkdWideMode;
  tally: CkdWideTally;
  buildMs: number | null;
  labs: CkdWideLab[];
  groups: [string, string][];
  listed: number;
  total: number;
  rows?: CkdWideLongRow[];
  persons?: CkdWidePerson[];
}

export interface CkdWideExport { persons: number; d1: (string | number)[][]; d2: (string | number)[][] }

export interface CkdSessions { groups: CkdSessionGroup[]; others: Record<string, number>; otherGroups: Record<string, { key: string; dept: string; doctor: string; n: number }[]> }

export interface CkdDaily {
  date: string;
  doctorSel: string;
  otherSession: string;
  sessions: CkdSessions;
  deptInfo: { total: number; matched: number; filter: string; undated: number; allDates: string[]; selDate: string | null; depts: string[] };
  cfg: { preGap: number; earlyNew: number; earlyGap: number; dmGap: number; over: number; labWin: number; dept: string; allA: boolean };
  hasCases: boolean;
  hasClinic: boolean;
  A: CkdRowA[];
  B: CkdRowB[];
  timing: { loadMs: number; analyzeMs: number };
}

// ---------- 階段 5：召回／異常檢驗／透析準備／月報／檢核 P 碼 ----------
// 規格：scratchpad spec-stage5.md（原版 recall.js／labalert.js／rrt.js／report.js／workbench_layer.html buildPcheck）
// 所有日期都是 'YYYY-MM-DD' 字串（後端 plain()），民國顯示在前端 roc()。

export type CkdRecallBucket = 'call' | 'grace' | 'appt' | 'hold' | 'close';

export interface CkdRecallRow {
  mrn: string;
  name: string;
  age: number | null;
  manual: boolean;
  prog: 'pre' | 'early';
  stage: string | null;
  egfr: number | null;
  lastVisit: string | null;
  /** 原版 x.lastCode || x.lastType || '' */
  lastCode: string;
  need: number | null;
  gap: number | null;
  appt: { date: string; doctor: string; dept: string; inDept: boolean } | null;
  ctAppt: string | null;
  ct: CkdRecord | null;
  snooze: string | null;
  stopped: boolean;
  bucket: CkdRecallBucket;
  chips: CkdRecChips | null;
}

export interface CkdRecall {
  date: string;
  grace: number;
  hasCases: boolean;
  rows: CkdRecallRow[];
  tally: Record<CkdRecallBucket, number>;
  timing: { loadMs: number; analyzeMs: number };
}

export type CkdAlertSev = 'crit' | 'warn';
export type CkdAlertId = 'k6' | 'k55' | 'hb8' | 'hb10' | 'na' | 'p55' | 'hco3' | 'a1c9' | 'upcr3' | 'egfrdrop' | 'egfrfast' | 'stage5' | 'egfr20' | 'upcrup';

export interface CkdAlertRow {
  /** mrn|YYYY-MM-DD|id，標示已處理的鍵 */
  key: string;
  id: CkdAlertId;
  sev: CkdAlertSev;
  t: string;
  m: string;
  date: string;
  v: number;
  mrn: string;
  name: string;
  done: string | null;
  doneBy: CkdActor | null;
  aud: { prog: 'pre' | 'early'; caseDoctor: string; lastVisit: string | null; gap: number | null; hasAppt: boolean; apptDoctor: string } | null;
}

export interface CkdAlerts {
  date: string;
  win: number;
  hasCases: boolean;
  rows: CkdAlertRow[];
  tally: { open: number; crit: number; warn: number; done: number; all: number };
  timing: { loadMs: number; analyzeMs: number };
}

/** 一位病人的累積檢驗報告（原版 wbFlowPanel；欄位同檢驗總表 long 列） */
export interface CkdPatientLabs {
  mrn: string;
  name: string;
  labs: CkdWideLab[];
  groups: [string, string][];
  rows: CkdWideDayRow[];
}

export type CkdRrtStation = 's0' | 's1' | 's2' | 's3' | 's4' | 's5';

export interface CkdRrtRow {
  mrn: string;
  name: string;
  age: number | null;
  manual: boolean;
  prog: 'pre' | 'early';
  egfr: number | null;
  stage: string | null;
  labDate: string | null;
  sdm: CkdRecord | null;
  acc: CkdRecord | null;
  leaning: string;
  decided: boolean;
  modality: 'HD' | 'PD' | 'TX' | 'CKM' | '';
  accStatus: string;
  station: CkdRrtStation;
  next: string;
  chips: CkdRecChips | null;
}

export interface CkdRrt {
  date: string;
  egfrThreshold: number;
  hasCases: boolean;
  rows: CkdRrtRow[];
  tally: Record<CkdRrtStation, number>;
  stations: Record<CkdRrtStation, string>;
  timing: { loadMs: number; analyzeMs: number };
}

export interface CkdReportBillRow { code: string; name: string; n: number; pts: number; people: number }
export interface CkdReportDoc { doc: string; n: number; ok: number }

export interface CkdReport {
  ym: string;
  today: string;
  hasCases: boolean;
  enrolled: number; pre: number; early: number; dm: number;
  stageCnt: Record<string, number>;
  newM: number; newY: number;
  closeM: Record<string, number>;
  closeMn: number;
  /** 結案分類中文（dead／dialysis／transfer／lapse／other） */
  closeLabels: Record<string, string>;
  onTime: number; over180: number; over365: number; noGap: number; grace: number;
  annDue: number; annDone: number; annReady: number;
  labOk: number; eg90: number; prot180: number;
  reward: number; rewardCodes: Record<string, number>;
  /** 透析準備門檻：與 settings.rrtEgfr 連動（原版寫死 20） */
  rrtEgfr: number;
  low: number; hasSdm: number; hasAcc: number;
  billRows: CkdReportBillRow[];
  billTot: number; billN: number; billPeople: number;
  kpi: { n: number; ok: number; docs: CkdReportDoc[] };
  lastYearN: number; lastYearOk: number;
  billYear: boolean; billSpan: string; yNow: number;
  recall: Record<CkdRecallBucket, number> | null;
  timing: { loadMs: number; analyzeMs: number };
}

export type CkdPcheckRes = 'ok' | 'miss' | 'early' | 'none' | 'new' | 'unexp' | 'cand' | 'extra' | 'nobill';

export interface CkdPcheckBill { code: string; codeName: string; doctor: string; price: number | null; n: number }

export interface CkdPcheckRow {
  kind: 'A' | 'B' | 'X';
  mrn: string;
  name: string;
  no: string | null;
  half: string | null;
  dr: string | null;
  bills: CkdPcheckBill[];
  res: CkdPcheckRes;
  note: string;
  verdict: string;
}

export interface CkdPcheck {
  date: string;
  doctorSel: string;
  otherSession: string;
  sessions: CkdSessions;
  hasCases: boolean;
  hasClinic: boolean;
  billed: boolean;
  rows: CkdPcheckRow[];
  extra: CkdPcheckRow[];
  issues: number;
  A: { total: number; ok: number; miss: number; early: number; none: number };
  B: { total: number; new: number; cand: number; unexp: number };
  /** res → [標籤文字, css class]（原版 PC_LBL） */
  labels: Record<CkdPcheckRes, [string, string]>;
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

  // ---------- 稽核／總表 ----------

  getAudit(date?: string): Promise<CkdAudit> {
    const params: Record<string, string> = {};
    if (date) params['date'] = date;
    return firstValueFrom(this.api.get<CkdAudit>('/ckd/audit', params));
  }

  getWide(params: { scope: CkdWideScope; q: string; mode: CkdWideMode; limit?: number }): Promise<CkdWide> {
    const p: Record<string, string> = { scope: params.scope, q: params.q, mode: params.mode };
    if (params.limit) p['limit'] = String(params.limit);
    return firstValueFrom(this.api.get<CkdWide>('/ckd/wide', p));
  }

  getWideExport(params: { scope: CkdWideScope; q: string }): Promise<CkdWideExport> {
    return firstValueFrom(this.api.get<CkdWideExport>('/ckd/wide/export', { scope: params.scope, q: params.q }));
  }

  // ---------- 階段 5 ----------

  /** 召回工作清單：全部到期者（五桶），篩選在前端；不帶 date = 今天 */
  getRecall(date?: string): Promise<CkdRecall> {
    const params: Record<string, string> = {};
    if (date) params['date'] = date;
    return firstValueFrom(this.api.get<CkdRecall>('/ckd/recall', params));
  }

  /** 近日異常檢驗：全部（含已處理），篩選在前端 */
  getAlerts(date?: string): Promise<CkdAlerts> {
    const params: Record<string, string> = {};
    if (date) params['date'] = date;
    return firstValueFrom(this.api.get<CkdAlerts>('/ckd/alerts', params));
  }

  /** 標示已處理／復原（存 DB，跨使用者共享） */
  setAlertDone(key: string, done: boolean): Promise<{ key: string; done: string | null; doneBy: CkdActor | null }> {
    return firstValueFrom(this.api.put<{ key: string; done: string | null; doneBy: CkdActor | null }>('/ckd/alerts/done', { key, done }));
  }

  /** 一位病人的累積檢驗報告（報告日新→舊） */
  getPatientLabs(mrn: string): Promise<CkdPatientLabs> {
    return firstValueFrom(this.api.get<CkdPatientLabs>(`/ckd/patients/${encodeURIComponent(mrn)}/labs`));
  }

  /** 透析準備管線：全部（六站），篩選在前端 */
  getRrt(date?: string): Promise<CkdRrt> {
    const params: Record<string, string> = {};
    if (date) params['date'] = date;
    return firstValueFrom(this.api.get<CkdRrt>('/ckd/rrt', params));
  }

  /** 月報：ym = 'YYYY-MM'（不帶 = 判讀日所在月） */
  getReport(ym?: string, date?: string): Promise<CkdReport> {
    const params: Record<string, string> = {};
    if (ym) params['ym'] = ym;
    if (date) params['date'] = date;
    return firstValueFrom(this.api.get<CkdReport>('/ckd/report', params));
  }

  /** 檢核 P 碼輸入：診次（date × doctor，同 /daily 的參數）× 當日入帳 */
  getPcheck(date?: string, doctor?: string): Promise<CkdPcheck> {
    const params: Record<string, string> = {};
    if (date) params['date'] = date;
    if (doctor) params['doctor'] = doctor;
    return firstValueFrom(this.api.get<CkdPcheck>('/ckd/pcheck', params));
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

  /** 病人彙整視窗：單一病人判讀＋收案段落＋衛教時間軸（date 不帶 = 今天） */
  getPatientCase(mrn: string, date?: string): Promise<CkdPatientCase> {
    const params: Record<string, string> = {};
    if (date) params['date'] = date;
    return firstValueFrom(this.api.get<CkdPatientCase>(`/ckd/patients/${encodeURIComponent(mrn)}/case`, params));
  }

  /** 檢驗報告衛教單內容（report 不帶 = 最近一個報告日） */
  getPatientHandout(mrn: string, report?: string): Promise<CkdHandout> {
    const params: Record<string, string> = {};
    if (report) params['report'] = report;
    return firstValueFrom(this.api.get<CkdHandout>(`/ckd/patients/${encodeURIComponent(mrn)}/handout`, params));
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
