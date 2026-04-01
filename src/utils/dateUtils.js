/**
 * 日期工具函式
 * 統一管理台北時區相關的日期格式化
 */

/**
 * 取得台北時區的今天日期字串 (YYYY-MM-DD)
 */
export function getTaipeiTodayString() {
  return new Date().toLocaleDateString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).replace(/\//g, '-')
}

/**
 * 取得台北時區的昨天日期字串 (YYYY-MM-DD)
 */
export function getTaipeiYesterdayString() {
  const today = new Date()
  today.setDate(today.getDate() - 1)
  return today.toLocaleDateString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).replace(/\//g, '-')
}

/**
 * 格式化 Date 物件為 YYYY-MM-DD（UTC）
 */
export function formatDateToYYYYMMDD(date) {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * 根據日期取得台北時區的星期索引 (0=週一, 6=週日)
 */
export function getTaipeiDayIndex(date) {
  const taipeiDateStr = date.toLocaleDateString('zh-TW', {
    timeZone: 'Asia/Taipei',
    weekday: 'short',
  })
  const dayMap = { '週一': 0, '週二': 1, '週三': 2, '週四': 3, '週五': 4, '週六': 5, '週日': 6 }
  return dayMap[taipeiDateStr] ?? date.getDay()
}

/**
 * 取得台北時間今天的 YYYY-MM 格式
 */
export function getTaipeiMonthString() {
  return new Date().toLocaleDateString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
  }).replace(/\//g, '-')
}
