// 當日異動「本班 / 下一班」生效範圍的共用工具
// 班別開始時間與後端 src/routes/patients.js SHIFT_START_TIMES 一致（早07:30／午12:30／晚17:30）
import { ORDERED_SHIFT_CODES, getShiftDisplayName } from '@/constants/scheduleConstants';

export type ShiftCode = 'early' | 'noon' | 'late';

/** 當日立即變更的生效範圍：current=從本班（進行中的班別）起；next=下一班起（已開始班次維持原顯示） */
export type EffectiveShiftScope = 'current' | 'next';

export const SHIFT_START_HM: Record<ShiftCode, string> = { early: '07:30', noon: '12:30', late: '17:30' };

function nowHM(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(now.getHours())}:${p(now.getMinutes())}`;
}

/** 目前進行中的班別（最後一個已開始的班別）；07:30 前回 null */
export function getCurrentShiftCode(now: Date = new Date()): ShiftCode | null {
  const hm = nowHM(now);
  let current: ShiftCode | null = null;
  for (const code of ORDERED_SHIFT_CODES as ShiftCode[]) {
    if (hm >= SHIFT_START_HM[code]) current = code;
  }
  return current;
}

/** 該班別今天是否已結束（=已有更晚的班別開始） */
export function isShiftEndedToday(shift: string, now: Date = new Date()): boolean {
  const current = getCurrentShiftCode(now);
  if (!current) return false;
  const idx = ORDERED_SHIFT_CODES.indexOf(shift);
  if (idx < 0) return false;
  return idx < ORDERED_SHIFT_CODES.indexOf(current);
}

/** 由每日排程 key（bed-1-early / peripheral-2-noon）取班別 */
export function getShiftCodeFromSlotKey(slotKey: string): string {
  return String(slotKey).split('-').pop() || '';
}

/** 與後端 utils/scheduleUtils.getScheduleKey 同規則 */
export function buildScheduleKey(bedNum: string | number, shiftCode: string): string {
  const s = String(bedNum);
  if (s.startsWith('peripheral')) return `${s}-${shiftCode}`;
  if (s.startsWith('外')) return `peripheral-${s.replace('外', '')}-${shiftCode}`;
  return `bed-${s}-${shiftCode}`;
}

/** 「本班未結束」二選一對話框文案 */
export function buildShiftScopeMessage(patientName: string, shiftCode: string, actionDesc: string): string {
  const shiftName = getShiftDisplayName(shiftCode);
  return (
    `病人「${patientName}」今天${shiftName}正在排程中，${shiftName}尚未結束。\n\n` +
    `本次${actionDesc}要從哪一班開始生效？\n\n` +
    `・從本班（${shiftName}）開始：${shiftName}的格子立即改為新資料\n` +
    `・從下一班開始：${shiftName}維持原顯示到當班結束，下一班起才套用`
  );
}
