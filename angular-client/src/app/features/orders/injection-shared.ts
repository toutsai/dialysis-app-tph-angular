/**
 * 針劑總覽 / 上傳異動紀錄 / 藥物時間軸 共用型別與顯示小工具
 * （對應後端 GET /medications/injection-monthly、injection-history、injection-upload-batches）
 */

// ---------- A) GET /medications/injection-monthly ----------
export type InjectionRuleKind = 'hold' | 'dates' | 'weekly' | 'interval' | 'uncertain';
export type InjectionShift = 'early' | 'noon' | 'late' | '';

export interface InjectionMonthlyDay {
  date: string; // YYYY-MM-DD
  day: number;
  /** 1=一 … 7=日 */
  dow: number;
}

export interface InjectionMonthlyMed {
  code: string;
  name: string;
  unit: string;
}

export interface InjectionRuleWarning {
  code: string;
  message: string;
}

export interface InjectionMonthlyOrder {
  orderCode: string;
  orderName: string;
  dose: string;
  unit: string;
  frequency: string;
  note: string;
  startDate: string;
  endDate: string;
  prescriber: string;
  ruleKind: InjectionRuleKind;
  ruleSource: string;
  effectiveRule: string;
  reason: string;
  warnings: InjectionRuleWarning[];
}

export interface InjectionMonthlyCell {
  orderCode: string;
  orderName: string;
  dose: string;
  unit: string;
  /** 落在非洗腎日 */
  mismatch: boolean;
}

export interface InjectionMonthlyRow {
  patientId: string;
  patientName: string;
  medicalRecordNumber: string;
  bedNum: number | null;
  shift: InjectionShift;
  freq: string;
  dialysisDays: number[] | null;
  orders: InjectionMonthlyOrder[];
  cells: Record<string, InjectionMonthlyCell[]>;
}

export interface InjectionMonthlyResponse {
  month: string;
  days: InjectionMonthlyDay[];
  meds: InjectionMonthlyMed[];
  rows: InjectionMonthlyRow[];
}

// ---------- B) GET /medications/injection-history/:patientId ----------
export type InjectionOrderType = 'injection' | 'oral';
export type InjectionChangeType = 'new' | 'stopped' | 'removed' | 'modified';
export type InjectionChangeField = 'dose' | 'frequency' | 'note' | 'end_date' | 'order_name';

export interface InjectionFieldChange {
  field: InjectionChangeField;
  before: string | null;
  after: string | null;
}

export interface InjectionHistoryOrder {
  id: string;
  orderCode: string;
  orderName: string;
  rawName: string;
  orderType: InjectionOrderType;
  dose: string;
  unit: string;
  frequency: string;
  note: string;
  startDate: string;
  /** '' = 持續中 */
  endDate: string;
  changeDate: string;
  prescriber: string;
  ruleKind: InjectionRuleKind | '';
  ruleText: string;
  ruleSource: string;
  reason: string;
  overrideId: string | null;
}

export interface InjectionChangeRecord {
  id: string;
  batchId: string;
  uploadedAt: string;
  sourceFile: string;
  uploadedByName: string;
  orderCode: string;
  orderName: string;
  orderType: InjectionOrderType;
  startDate: string;
  changeType: InjectionChangeType;
  changes: InjectionFieldChange[];
  before: unknown;
  after: unknown;
}

export interface InjectionHistoryResponse {
  patientId: string;
  orders: InjectionHistoryOrder[];
  changes: InjectionChangeRecord[];
}

// ---------- C/D) 上傳批次 ----------
export interface InjectionUploadSummary {
  counts: { new: number; stopped: number; removed: number; modified: number };
  interpretation: {
    weekly: number;
    interval: number;
    dates: number;
    hold: number;
    uncertain: number;
    total: number;
  };
  warnings: Record<string, number>;
  review: {
    uncertain: number;
    dates_exhausted: number;
    weekday_mismatch: number;
    date_not_dialysis_day: number;
    total: number;
  };
  isFirstBatch: boolean;
}

export interface InjectionUploadBatch {
  id: string;
  sourceFile: string;
  uploadedAt: string;
  uploadedByName: string;
  rowCount: number;
  changeCount: number;
  summary: InjectionUploadSummary;
}

export interface InjectionBatchChange extends InjectionChangeRecord {
  patientId: string;
  patientName: string;
  medicalRecordNumber: string;
}

// ---------- E) 上傳回應的解讀報告 ----------
export interface InjectionUploadReportChange {
  patientName: string;
  medicalRecordNumber: string;
  orderCode: string;
  orderName: string;
  orderType: InjectionOrderType;
  startDate: string;
  changeType: InjectionChangeType;
  changes: InjectionFieldChange[];
}

export interface InjectionUploadReport {
  batchId: string;
  summary: InjectionUploadSummary;
  changeCount: number;
  /** 前 200 筆 */
  changes: InjectionUploadReportChange[];
}

// ---------- 顯示小工具 ----------
export const CHANGE_TYPE_LABEL: Record<InjectionChangeType, string> = {
  new: '新增',
  stopped: '停止',
  modified: '修改',
  removed: '移除',
};

export const CHANGE_FIELD_LABEL: Record<InjectionChangeField, string> = {
  dose: '劑量',
  frequency: '頻率',
  note: '備註',
  end_date: '停止日',
  order_name: '名稱',
};

export const ORDER_TYPE_LABEL: Record<string, string> = {
  injection: '針劑',
  oral: '口服',
};

export const RULE_KIND_LABEL: Record<string, string> = {
  weekly: '每週',
  interval: '隔週',
  dates: '指定日期',
  hold: 'hold',
  uncertain: '判不出',
};

export const REVIEW_LABEL: Record<string, string> = {
  uncertain: '判不出',
  dates_exhausted: '日期用盡',
  weekday_mismatch: '星期不符',
  date_not_dialysis_day: '非洗腎日',
};

/** 針劑短名（總覽格子用）：藥碼 → 縮寫 */
export const INJECTION_SHORT_NAME: Record<string, string> = {
  INES2: 'NESP',
  IREC1: 'Rec',
  IFER2: 'Fe',
  ICAC: 'Ca',
  IPAR1: 'Par',
};

export function changeTypeLabel(type: string): string {
  return CHANGE_TYPE_LABEL[type as InjectionChangeType] ?? type;
}

/** 異動 pill 的 CSS class（new=綠 / stopped=紅 / modified=琥珀 / removed=灰） */
export function changePillClass(type: string): string {
  return `change-pill change-${type}`;
}

export function orderTypeLabel(type: string): string {
  return ORDER_TYPE_LABEL[type] ?? type;
}

export function ruleKindLabel(kind: string): string {
  return RULE_KIND_LABEL[kind] ?? kind;
}

/** `欄位: before → after`（空值顯示「(空)」） */
export function formatFieldChange(change: InjectionFieldChange): string {
  const label = CHANGE_FIELD_LABEL[change.field] ?? change.field;
  const before = change.before === null || change.before === undefined || change.before === '' ? '(空)' : String(change.before);
  const after = change.after === null || change.after === undefined || change.after === '' ? '(空)' : String(change.after);
  return `${label}: ${before} → ${after}`;
}

/** DB 本地時間字串（'YYYY-MM-DD HH:mm:ss' 或 ISO）→ 'YYYY-MM-DD HH:mm' */
export function formatUploadedAt(value: string | null | undefined): string {
  if (!value) return '-';
  const str = String(value).replace('T', ' ');
  return str.length >= 16 ? str.slice(0, 16) : str;
}

/** 頻率字串（如「一三五」）→ 星期索引（1=一 … 7=日） */
export function freqToDows(freq: string | null | undefined): number[] {
  if (!freq) return [];
  const map: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
  const out: number[] = [];
  for (const ch of freq) {
    const v = map[ch];
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

export const DOW_LABEL: Record<number, string> = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '日', 0: '日' };

export const SHIFT_LABEL: Record<string, string> = { early: '早', noon: '午', late: '晚', '': '-' };
