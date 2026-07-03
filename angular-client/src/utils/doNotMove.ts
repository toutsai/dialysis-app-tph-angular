/**
 * 「勿動」日期區間工具。
 *
 * 資料結構（存於 patientStatus.doNotMove）:
 *   { active, reason, rangeType?, startDate?, endDate? }
 *   - rangeType: 'day' | 'range' | 'permanent'
 *   - 舊資料（無 rangeType）一律視為 'permanent'（持續勿動），確保向後相容。
 *
 * 判斷一律「日期感知」：某天是否落在勿動生效範圍內。
 * 排程格線 / 週表 / 護理分組各自帶入其目標日期；病人清單（無日期情境）帶入今天。
 */

export type DoNotMoveRangeType = 'day' | 'range' | 'permanent';

export interface DoNotMoveFlag {
  active?: boolean;
  reason?: string;
  rangeType?: DoNotMoveRangeType;
  startDate?: string | null;
  endDate?: string | null;
}

/**
 * 勿動是否於 targetDate（YYYY-MM-DD）當天生效。
 * - permanent：一律生效。
 * - day：僅 startDate 當天。
 * - range：startDate ~ endDate（含頭尾）；缺 endDate → 自 startDate 起持續；缺 startDate → 至 endDate 為止。
 * - 設了區間卻完全沒填日期 → 保守回傳 true（避免漏鎖）。
 */
export function isDoNotMoveActiveOn(
  dnm: DoNotMoveFlag | null | undefined,
  targetDate: string | null | undefined,
): boolean {
  if (!dnm?.active) return false;
  const type: DoNotMoveRangeType = dnm.rangeType || 'permanent';
  if (type === 'permanent') return true;

  const day = targetDate || null;
  const start = dnm.startDate || null;
  const end = (type === 'day' ? dnm.startDate : dnm.endDate) || null;

  if (!start && !end) return true; // 有設區間但沒填任何日期 → 保守鎖住
  if (!day) return true; // 無日期情境（保守）；正常呼叫端都會帶入日期

  if (type === 'day') return day === start;
  if (start && end) return day >= start && day <= end;
  if (start && !end) return day >= start;
  return day <= (end as string); // 只有結束日
}

/**
 * 病人清單顯示狀態（無日期情境用今天判斷）:
 *   'in-effect' → 今天生效（紅鎖）
 *   'inactive'  → 已設定但今天不生效（尚未開始或已過期，灰鎖）
 *   'none'      → 未設定
 */
export function doNotMoveDisplayState(
  dnm: DoNotMoveFlag | null | undefined,
  today: string,
): 'in-effect' | 'inactive' | 'none' {
  if (!dnm?.active) return 'none';
  return isDoNotMoveActiveOn(dnm, today) ? 'in-effect' : 'inactive';
}

/** 區間文字（供 tooltip）: 「持續」/「2026-07-10」/「2026-07-10 ~ 2026-07-16」。 */
export function doNotMoveRangeText(dnm: DoNotMoveFlag | null | undefined): string {
  if (!dnm?.active) return '';
  const type: DoNotMoveRangeType = dnm.rangeType || 'permanent';
  if (type === 'permanent') return '持續';
  if (type === 'day') return dnm.startDate || '單日（未設日期）';
  const start = dnm.startDate || '（未設）';
  const end = dnm.endDate || '持續';
  return `${start} ~ ${end}`;
}
