/**
 * 排程工具函式
 * 統一管理透析頻率對應、班別、床位鍵值等
 */

/**
 * 透析頻率對應星期索引 (0=週一, 5=週六)
 */
export const FREQ_MAP_TO_DAY_INDEX = {
  '一三五': [0, 2, 4],
  '二四六': [1, 3, 5],
  '一四': [0, 3],
  '二五': [1, 4],
  '三六': [2, 5],
  '一五': [0, 4],
  '二六': [1, 5],
  '每日': [0, 1, 2, 3, 4, 5],
  '每周一': [0],
  '每周二': [1],
  '每周三': [2],
  '每周四': [3],
  '每周五': [4],
  '每周六': [5],
}

export const SHIFTS = ['early', 'noon', 'late']

/**
 * 產生排程的 key (例如: bed-1-early, peripheral-1-noon)
 */
export function getScheduleKey(bedNum, shiftCode) {
  const bedNumStr = String(bedNum)
  // 處理已經是 peripheral-X 格式的情況
  if (bedNumStr.startsWith('peripheral-')) {
    return `${bedNumStr}-${shiftCode}`
  }
  // 處理 peripheralX 格式（無 dash）
  if (bedNumStr.startsWith('peripheral')) {
    return `${bedNumStr}-${shiftCode}`
  }
  // 處理中文 外X 格式的情況
  if (bedNumStr.startsWith('外')) {
    const num = bedNumStr.replace('外', '')
    return `peripheral-${num}-${shiftCode}`
  }
  // 一般床位
  return `bed-${bedNumStr}-${shiftCode}`
}

/**
 * 病人在指定星期（0=週一 … 6=週日，同 FREQ_MAP_TO_DAY_INDEX）是一週療程中的第幾次透析（0-based）。
 * 頻率未知或當天非該病人透析日回傳 -1。與前端 utils/scheduleUtils.ts 的 getWeeklySessionIndex 同義（前端 dayOfWeek 為 1=週一）。
 */
export function getWeeklySessionIndex(freq, dayIndex) {
  if (!freq || dayIndex === null || dayIndex === undefined) return -1
  const days = FREQ_MAP_TO_DAY_INDEX[freq]
  if (!days) return -1
  return days.indexOf(dayIndex)
}

/**
 * 解析「以 / 分隔、每次透析輪替」的醫囑值（如 AK "21S/Hi23/Hi23"），取指定星期當次該用的那一段。
 * 單一值直接回傳；無法確定次序（頻率未知、當天非透析日、段數不足）時保守回傳完整原值。
 */
/**
 * AK 名稱別名：型號本身被誤寫成含 / 的字串時，先換成正式名稱再做輪替解析，
 * 否則會被當成兩顆輪替（2026-09-04 使用者裁定：CAT/2000 一律呈現為 KAWASUMI CTA2000）。
 */
export const AK_TEXT_ALIASES = [[/CAT\s*\/\s*2000/gi, 'CTA2000']]

export function normalizeAkAliases(rawValue) {
  let value = String(rawValue ?? '').trim()
  for (const [pattern, replacement] of AK_TEXT_ALIASES) value = value.replace(pattern, replacement)
  return value
}

export function resolveDailyRotationValue(rawValue, freq, dayIndex) {
  const value = normalizeAkAliases(rawValue)
  if (!value.includes('/')) return value
  const parts = value
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
  if (parts.length <= 1) return parts[0] ?? value
  const idx = getWeeklySessionIndex(freq, dayIndex)
  if (idx >= 0 && idx < parts.length) return parts[idx]
  return value
}
