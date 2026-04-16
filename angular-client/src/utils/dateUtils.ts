// src/utils/dateUtils.ts (前端版本)

const TIME_ZONE = 'Asia/Taipei'

/** Firestore 時間戳介面 */
interface FirestoreTimestamp {
  toDate: () => Date;
  seconds?: number;
  nanoseconds?: number;
}

/** parseDateString 回傳格式 */
export interface ParsedDate {
  year: number;
  month: number;
  day: number;
}

/**
 * 將指定的 Date 物件格式化為台北時區的 'YYYY-MM-DD' 字串。
 * @param date - (可選) 要格式化的日期物件，預設為當前時間。
 * @returns 'YYYY-MM-DD' 格式的日期字串。
 */
export function formatDateToYYYYMMDD(date: Date = new Date()): string {
  // 這個方法可以穩定地在任何瀏覽器中，根據指定的時區獲取正確的 YYYY-MM-DD 字串
  return date.toLocaleDateString('sv-SE', { timeZone: TIME_ZONE })
}

/**
 * 將指定的 Date 物件格式化為台北時區的 'YYYY-MM' 字串。
 * @param date - (可選) 要格式化的日期物件，預設為當前時間。
 * @returns 'YYYY-MM' 格式的年月字串。
 */
export function formatDateToYYYYMM(date: Date = new Date()): string {
  return formatDateToYYYYMMDD(date).slice(0, 7)
}

/**
 * 將指定的 Date 物件格式化為台北時區的中文日期時間字串。
 * @param date - (可選) 要格式化的日期物件，預設為當前時間。
 * @param options - (可選) 額外的格式化選項。
 * @returns 中文格式的日期時間字串。
 */
export function formatDateTimeToLocal(
  date: Date = new Date(),
  options: Intl.DateTimeFormatOptions = {},
): string {
  const defaultOptions: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: TIME_ZONE,
    ...options,
  }
  return date.toLocaleString('zh-TW', defaultOptions)
}

/**
 * 將指定的 Date 物件格式化為中文日期字串 (YYYY/MM/DD)。
 * @param date - (可選) 要格式化的日期物件，預設為當前時間。
 * @returns 'YYYY/MM/DD' 格式的日期字串。
 */
export function formatDateToChinese(date: Date = new Date()): string {
  return date.toLocaleDateString('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: TIME_ZONE,
  })
}

/**
 * 在日期上加減指定天數。
 * @param date - 基準日期。
 * @param days - 要加減的天數（正數為加，負數為減）。
 * @returns 新的 Date 物件。
 */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

/**
 * 在日期上加減指定月份。
 * @param date - 基準日期。
 * @param months - 要加減的月份（正數為加，負數為減）。
 * @returns 新的 Date 物件。
 */
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date)
  result.setMonth(result.getMonth() + months)
  return result
}

/**
 * 取得昨天的日期字串。
 * @returns 'YYYY-MM-DD' 格式的昨天日期。
 */
export function getYesterday(): string {
  return formatDateToYYYYMMDD(addDays(new Date(), -1))
}

/**
 * 取得明天的日期字串。
 * @returns 'YYYY-MM-DD' 格式的明天日期。
 */
export function getTomorrow(): string {
  return formatDateToYYYYMMDD(addDays(new Date(), 1))
}

/**
 * 取得今天的日期字串。
 * @returns 'YYYY-MM-DD' 格式的今天日期。
 */
export function getToday(): string {
  return formatDateToYYYYMMDD(new Date())
}

/**
 * 取得指定年月的第一天。
 * @param year - 年份。
 * @param month - 月份 (1-12)。
 * @returns 該月第一天的 Date 物件。
 */
export function getStartOfMonth(year: number, month: number): Date {
  return new Date(year, month - 1, 1)
}

/**
 * 取得指定年月的最後一天。
 * @param year - 年份。
 * @param month - 月份 (1-12)。
 * @returns 該月最後一天的 Date 物件。
 */
export function getEndOfMonth(year: number, month: number): Date {
  return new Date(year, month, 0)
}

/**
 * 取得指定年月的天數。
 * @param year - 年份。
 * @param month - 月份 (1-12)。
 * @returns 該月的天數。
 */
export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

/**
 * 取得指定日期是星期幾。
 * @param date - Date 物件或日期字串。
 * @returns 星期幾 (0=週日, 1=週一, ..., 6=週六)。
 */
export function getDayOfWeek(date: Date | string): number {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.getDay()
}

/**
 * 統一處理 Firestore 時間戳，轉換為 Date 物件。
 * @param timestamp - Firestore 時間戳、Date 物件、字串或數字。
 * @returns Date 物件。
 */
export function parseFirestoreTimestamp(
  timestamp: FirestoreTimestamp | Date | string | number | null | undefined,
): Date {
  if (!timestamp) return new Date()
  if (timestamp instanceof Date) return timestamp
  if (typeof timestamp === 'object' && 'toDate' in timestamp && typeof timestamp.toDate === 'function') {
    return timestamp.toDate()
  }
  if (typeof timestamp === 'string' || typeof timestamp === 'number') return new Date(timestamp)
  return new Date()
}

/**
 * 驗證日期字串是否為有效的 YYYY-MM-DD 格式。
 * @param dateString - 要驗證的日期字串。
 * @returns 是否為有效日期。
 */
export function isValidDateString(dateString: string | null | undefined): boolean {
  if (!dateString || typeof dateString !== 'string') return false
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return false
  const date = new Date(dateString)
  return !isNaN(date.getTime())
}

/**
 * 從日期字串解析出年、月、日。
 * @param dateString - 'YYYY-MM-DD' 格式的日期字串。
 * @returns 包含年月日的物件。
 */
export function parseDateString(dateString: string): ParsedDate {
  const [year, month, day] = dateString.split('-').map(Number)
  return { year, month, day }
}

/**
 * 建立日期字串。
 * @param year - 年份。
 * @param month - 月份 (1-12)。
 * @param day - 日期，預設為 1。
 * @returns 'YYYY-MM-DD' 格式的日期字串。
 */
export function createDateString(year: number, month: number, day: number = 1): string {
  const m = String(month).padStart(2, '0')
  const d = String(day).padStart(2, '0')
  return `${year}-${m}-${d}`
}

/**
 * 取得當前時間的 ISO 字串。
 * @returns ISO 8601 格式的時間字串。
 */
export function getNowISO(): string {
  return new Date().toISOString()
}

/**
 * 比較兩個日期是否為同一天。
 * @param date1 - 第一個日期。
 * @param date2 - 第二個日期。
 * @returns 是否為同一天。
 */
export function isSameDay(date1: Date | string, date2: Date | string): boolean {
  const d1 = typeof date1 === 'string' ? date1 : formatDateToYYYYMMDD(date1)
  const d2 = typeof date2 === 'string' ? date2 : formatDateToYYYYMMDD(date2)
  return d1 === d2
}

/**
 * 判斷日期是否為今天。
 * @param date - 要判斷的日期。
 * @returns 是否為今天。
 */
export function isToday(date: Date | string): boolean {
  return isSameDay(date, new Date())
}
