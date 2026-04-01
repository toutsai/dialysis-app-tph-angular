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
