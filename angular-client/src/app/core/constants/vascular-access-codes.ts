// 血管通路事件代碼表（KiDit「病患血液透析造管CSV檔」官方代碼）
// 與後端 src/routes/vascularAccess.js、src/services/kiditSync.js 的代碼對齊，勿單邊修改。

export type VascularEventType = 'intervention' | 'reconstruction';
export type VascularAccessType = 'AVF' | 'AVG' | 'PERM' | 'TEMP';
export type VascularEventStatus = 'pending' | 'confirmed' | 'rejected';

export interface VascularAccessEvent {
  id: string;
  patientId: string;
  patientName: string;
  medicalRecordNumber: string;
  eventDate: string;
  eventType: VascularEventType;
  failureReason: string | null;
  repairMethod: string | null;
  repairMethodOther: string | null;
  newAccessType: VascularAccessType | null;
  newAccessSide: 'L' | 'R' | null;
  newAccessSite: string | null;
  location: string | null;
  notes: string | null;
  status: VascularEventStatus;
  updatePatientMaster: boolean;
  rejectReason: string | null;
  createdBy: { uid?: string; name?: string };
  confirmedBy: { uid?: string; name?: string };
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
  patientCurrentStatus: string | null;
  patientIsDeleted: boolean | null;
}

/** 失敗原因（介入=血管通路失敗原因；重建=前次血管通路失敗原因）。
 *  官方說明檔 4 與 3 文字重複（皆「血液流量過小」），UI 不提供 4。 */
export const VASCULAR_FAILURE_REASONS: { code: string; label: string }[] = [
  { code: '1', label: '感染' },
  { code: '2', label: '阻塞' },
  { code: '3', label: '血液流量過小' },
  { code: '5', label: '長期導管移位' },
  { code: '6', label: '竊流症候群' },
  { code: '9', label: '其他' },
];

/** 原有血管重建方式（介入治療用） */
export const VASCULAR_REPAIR_METHODS: { code: string; label: string }[] = [
  { code: '1', label: '血管成型術(PTA)' },
  { code: '2', label: '外科手術' },
  { code: '3', label: '血管成型術+外科手術' },
  { code: '9', label: '其他' },
];

/** 新通路型態（血管重建用）。注意：造管 CSV 重建區塊（欄50–82）沒有 TEMP 短期導管型態欄。 */
export const VASCULAR_ACCESS_TYPES: { code: VascularAccessType; label: string }[] = [
  { code: 'AVF', label: '自體動靜脈廔管 (AVF)' },
  { code: 'AVG', label: '人工動靜脈廔管 (AVG)' },
  { code: 'PERM', label: 'PermCath 或其他長期導管' },
  { code: 'TEMP', label: '其他短期導管' },
];

export const VASCULAR_ACCESS_SIDES: { code: 'L' | 'R'; label: string }[] = [
  { code: 'L', label: '左' },
  { code: 'R', label: '右' },
];

/** 廔管位置（AVF/AVG） */
export const VASCULAR_FISTULA_SITES: { code: string; label: string }[] = [
  { code: '1', label: '前臂(含腕部)' },
  { code: '2', label: '上臂(含肘部)' },
  { code: '3', label: '大腿' },
  { code: '4', label: '小腿' },
  { code: '9', label: '其他' },
];

/** 導管位置（PERM/TEMP） */
export const VASCULAR_CATHETER_SITES: { code: string; label: string }[] = [
  { code: '1', label: '內頸靜脈' },
  { code: '2', label: '鎖骨下靜脈' },
  { code: '3', label: '股靜脈' },
  { code: '9', label: '其他' },
];

/** 處置院所（沿用工作日誌血管通路區塊的選項） */
export const VASCULAR_LOCATIONS = ['本院', '新泰', '新仁', '宏仁', '新光', '振興', '其他'];

const toMap = (items: { code: string; label: string }[]) =>
  Object.fromEntries(items.map((i) => [i.code, i.label])) as Record<string, string>;

export const FAILURE_REASON_LABELS = toMap(VASCULAR_FAILURE_REASONS);
export const REPAIR_METHOD_LABELS = toMap(VASCULAR_REPAIR_METHODS);
export const ACCESS_TYPE_LABELS = toMap(VASCULAR_ACCESS_TYPES);
export const FISTULA_SITE_LABELS = toMap(VASCULAR_FISTULA_SITES);
export const CATHETER_SITE_LABELS = toMap(VASCULAR_CATHETER_SITES);

export function siteOptionsForType(type: VascularAccessType | null | undefined) {
  return type === 'AVF' || type === 'AVG' ? VASCULAR_FISTULA_SITES : VASCULAR_CATHETER_SITES;
}

export function siteLabelForType(type: string | null | undefined, site: string | null | undefined): string {
  if (site == null || site === '') return '';
  const labels = type === 'AVF' || type === 'AVG' ? FISTULA_SITE_LABELS : CATHETER_SITE_LABELS;
  return labels[String(site)] || '';
}

/** 事件摘要文字（工作日誌事件列 / KiDit 清單 / 病人事件歷史共用） */
export function describeVascularEvent(ev: Pick<VascularAccessEvent,
  'eventType' | 'failureReason' | 'repairMethod' | 'repairMethodOther' | 'newAccessType' | 'newAccessSide' | 'newAccessSite'>): string {
  const failure = ev.failureReason ? FAILURE_REASON_LABELS[ev.failureReason] || '' : '';
  if (ev.eventType === 'reconstruction') {
    const side = ev.newAccessSide === 'R' ? '右' : ev.newAccessSide === 'L' ? '左' : '';
    const type = ev.newAccessType ? ACCESS_TYPE_LABELS[ev.newAccessType] || ev.newAccessType : '';
    const site = siteLabelForType(ev.newAccessType, ev.newAccessSite);
    return `血管重建-${side}${type}${site ? `(${site})` : ''}${failure ? `,前次原因:${failure}` : ''}`;
  }
  const repair = ev.repairMethod ? REPAIR_METHOD_LABELS[ev.repairMethod] || '' : '';
  const repairOther = ev.repairMethod === '9' && ev.repairMethodOther ? `(${ev.repairMethodOther})` : '';
  return `介入治療${failure ? `-${failure}` : ''}${repair ? `→${repair}${repairOther}` : ''}`;
}

export const VASCULAR_EVENT_TYPE_LABELS: Record<VascularEventType, string> = {
  intervention: '介入治療',
  reconstruction: '血管重建',
};

export const VASCULAR_EVENT_STATUS_LABELS: Record<VascularEventStatus, string> = {
  pending: '待確認',
  confirmed: '已確認',
  rejected: '已退回',
};
