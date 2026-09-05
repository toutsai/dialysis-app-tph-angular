// 檔案: src/utils/scheduleUtils.ts (增強最終版)
import { infectionAbbrFromTags, isolationAbbrFromTags, CURED_TAG } from '@/utils/hepatitis';

/** 排程文件 */
export interface ScheduleDocument {
  date: string;
  schedule: Record<string, SlotData>;
  version: string;
  createdAt: Date;
  updatedAt: Date;
}

/** 時段資料 */
export interface SlotData {
  shiftId?: string;
  patientId?: string | null;
  autoNote?: string;
  manualNote?: string;
  nurseTeam?: string | null;
  nurseTeamIn?: string | null;
  nurseTeamOut?: string | null;
  wardNumber?: string | null;
  freq?: string;
  [key: string]: unknown;
}

/** 優先級標籤配置 */
export interface PriorityTagConfig {
  priority: number;
  class: string;
  color: string;
}

/** 病人資料 (用於排程計算的最小介面) */
export interface SchedulePatient {
  freq?: string;
  status?: string;
  isFirstDialysis?: boolean;
  isDeleted?: boolean;
  diseases?: (string | { name: string })[];
  [key: string]: unknown;
}

/** CSS 類名物件 */
export type CellStyleResult = Record<string, boolean>;

/**
 * 創建一個用於存入的標準化空白 Schedule 文件物件。
 * @param dateString - 日期字串，格式為 'YYYY-MM-DD'。
 * @returns 一個標準的 Schedule 文件。
 */
export function createEmptyScheduleDocument(dateString: string): ScheduleDocument {
  return {
    date: dateString,
    schedule: {}, // 核心：schedule 欄位是一個空的 object
    version: '3.0', // 版本號更新，標示為英文代碼+新note模型
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

/**
 * 在前端創建一個標準的、包含所有欄位的空白 slotData 物件。
 * @param shiftId - 該床位班次的唯一標識符，例如 'bed-32-early'。
 * @returns 一個標準的 slotData 物件。
 */
export function createEmptySlotData(shiftId: string): SlotData {
  return {
    shiftId: shiftId,
    patientId: null,
    autoNote: '', // 儲存自動生成的標籤 (住, 新, B, C...)
    manualNote: '', // 儲存使用者手動輸入的文字
    nurseTeam: null,
    nurseTeamIn: null,
    nurseTeamOut: null,
    wardNumber: null, // 【新增】補上外圍床位號碼欄位，與 ScheduleView 同步
  }
}

// 【新增】頻率與星期的對應關係
const FREQ_TO_DAYS_MAP: Record<string, number[]> = {
  一三五: [1, 3, 5],
  二四六: [2, 4, 6],
  一四: [1, 4],
  二五: [2, 5],
  三六: [3, 6],
  一五: [1, 5],
  二六: [2, 6],
  每日: [1, 2, 3, 4, 5, 6, 7],
  // 根據您的系統需求，可以添加更多頻率
}

// 【新增】兩班頻率定義（一週兩次）
export const BIWEEKLY_FREQUENCIES: string[] = ['一四', '二五', '三六', '一五', '二六']

/**
 * 調班套用時後端寫進排程格 manualNote 的備註：(換班)／(臨時加洗)／(與X互調)
 * （src/services/exceptionHandler.js、scheduleSync.js）。
 * 2026-09-05 使用者裁定：每日排程、護理分組、我的病人三頁不顯示這些字（簡化畫面），
 * 資料照寫、歸檔/歷史不變；調班詳情仍在訊息中心與病人詳情的交班留言可查。
 * 顯示端一律先用 stripExceptionNotes 過濾 manualNote，再拆標籤。
 */
const EXCEPTION_NOTE_RE = /((換班|臨時加洗|與[^()]*互調))/g
export function stripExceptionNotes(note: string | null | undefined): string {
  return String(note || '').replace(EXCEPTION_NOTE_RE, ' ').replace(/s+/g, ' ').trim()
}

// 【新增】頻率數字對應表（用於自動備註）
const FREQ_NUMBER_MAP: Record<string, string> = {
  一四: '14',
  二五: '25',
  三六: '36',
  一五: '15',
  二六: '26',
}

// 【新增】統一的優先級標籤配置
export const PRIORITY_TAGS: Record<string, PriorityTagConfig> = {
  抽: { priority: 1, class: 'tag-chou', color: '#658ee0' }, // 藍色 (最高優先級)
  新: { priority: 2, class: 'tag-new', color: '#f5ec8e' }, // 金黃
  住: { priority: 3, class: 'status-ipd', color: '#ffebee' }, // 紅色
  急: { priority: 3, class: 'status-er', color: '#f3e5f5' }, // 紫色 (同等級)
  // 兩班 (橘色) 通過頻率判斷，不在標籤中
  // 門診 (綠色) 是默認，不需要特殊標記
}

/**
 * 【增強版】根據病人物件，生成標準化的自動備註字串。
 * 這是我們系統的 "唯一真理之源"，用於生成 autoNote。
 * @param patient - 完整的病人物件。
 * @returns 自動生成的備註標籤，用空格分隔。
 */
export function generateAutoNote(patient: SchedulePatient | null | undefined): string {
  if (!patient) return ''
  const autoNotes = new Set<string>()

  // 【新增】兩班頻率自動備註 (優先處理)
  if (patient.freq && BIWEEKLY_FREQUENCIES.includes(patient.freq)) {
    const freqNumber = FREQ_NUMBER_MAP[patient.freq]
    if (freqNumber) {
      autoNotes.add(freqNumber) // 例如：一四 → 14
    }
  }

  // 核心狀態標籤
  if (patient.status === 'ipd') autoNotes.add('住')
  if (patient.status === 'er') autoNotes.add('急') // 急診標籤
  if (patient.isFirstDialysis) autoNotes.add('新')

  // 疾病相關標籤
  if (patient.diseases && Array.isArray(patient.diseases)) {
    // 傳染病縮寫 B/C/H/R、待追蹤 B?/C?/H?/R?（規則在 utils/hepatitis.ts，與後端 scheduleSync 同源）
    for (const abbr of infectionAbbrFromTags(patient.diseases)) autoNotes.add(abbr)
    if (patient.diseases.includes(CURED_TAG)) autoNotes.add('C癒')
    // 其他隔離疾病：冠/疥/MDR/隔
    for (const abbr of isolationAbbrFromTags(patient.diseases)) autoNotes.add(abbr)
  }

  return Array.from(autoNotes).join(' ')
}

/**
 * 【增強版 v2】統一的細胞樣式計算函數
 * 所有視圖都應該使用這個函數來確保顏色一致性
 * @param slotData - 排程數據
 * @param patient - 病人數據
 * @param freq - 頻率 (可從 slotData 或 patient 獲取)
 * @param messageTypes - [新增] 該病人今天的任務類型陣列，例如 ['抽血', '衛教']
 * @returns CSS 類名對象
 */
export function getUnifiedCellStyle(
  slotData: SlotData | null | undefined,
  patient: SchedulePatient | null | undefined,
  freq: string | null = null,
  messageTypes: string[] = [],
): CellStyleResult {
  if (!slotData || !slotData.patientId || !patient) {
    return {}
  }

  // 檢查病人是否已被刪除（預約刪除後的同步處理）
  if (patient.isDeleted) {
    return { 'status-deleted': true }
  }

  const finalFreq = freq || slotData.freq || patient.freq
  const autoNote = slotData.autoNote || ''
  const manualNote = slotData.manualNote || ''
  const combinedNote = `${autoNote} ${manualNote}`.trim()

  let highestPriorityTag: PriorityTagConfig | null = null
  let highestPriority = 999

  // [核心修改] 將來自 taskStore 的即時任務資訊也納入優先級判斷
  // 檢查 '抽血'
  if (messageTypes.includes('抽血')) {
    const tagConfig = PRIORITY_TAGS['抽']
    if (tagConfig && tagConfig.priority < highestPriority) {
      highestPriorityTag = tagConfig
      highestPriority = tagConfig.priority
    }
  }
  // 檢查 '衛教' (對應到您定義的 '新')
  if (messageTypes.includes('衛教')) {
    const tagConfig = PRIORITY_TAGS['新']
    if (tagConfig && tagConfig.priority < highestPriority) {
      highestPriorityTag = tagConfig
      highestPriority = tagConfig.priority
    }
  }

  // 繼續檢查來自備註的標籤
  for (const [tag, config] of Object.entries(PRIORITY_TAGS)) {
    // 我們已經處理過 '抽' 和 '新'，可以跳過以免重複
    if (tag === '抽' || tag === '新') continue

    if (combinedNote.includes(tag) && config.priority < highestPriority) {
      highestPriorityTag = config
      highestPriority = config.priority
    }
  }

  // 如果找到高優先級標籤，直接返回
  if (highestPriorityTag) {
    return { [highestPriorityTag.class]: true }
  }

  // 關鍵修正：檢查兩班頻率 (在標籤檢查之後，病人狀態之前)
  if (finalFreq && BIWEEKLY_FREQUENCIES.includes(finalFreq)) {
    return { 'status-biweekly': true } // 橘色
  }

  // 最後根據病人狀態決定顏色
  if (patient.status === 'er') {
    return { 'status-er': true } // 紫色
  }
  if (patient.status === 'ipd') {
    return { 'status-ipd': true } // 紅色
  }
  if (patient.status === 'opd') {
    return { 'status-opd': true } // 綠色
  }

  return {}
}

/**
 * 【新增】檢查兩個頻率是否有時間衝突
 * @param freq1 - 第一個頻率
 * @param freq2 - 第二個頻率
 * @returns 如果有衝突返回 true
 */
export function hasFrequencyConflict(freq1: string | null | undefined, freq2: string | null | undefined): boolean {
  if (!freq1 || !freq2) return false
  if (freq1 === freq2) return true // 相同頻率一定衝突

  const days1 = FREQ_TO_DAYS_MAP[freq1] || []
  const days2 = FREQ_TO_DAYS_MAP[freq2] || []

  // 檢查是否有重疊的日期
  return days1.some((day) => days2.includes(day))
}

/**
 * 檢查病人在給定的星期幾是否應該排班
 * @param patient - 病人物件，需要包含 freq 屬性
 * @param dayOfWeek - 星期幾 (1=週一, 2=週二, ..., 7=週日)
 * @returns 如果應該排班則返回 true
 */
export function shouldPatientBeScheduled(
  patient: SchedulePatient | null | undefined,
  dayOfWeek: number | null | undefined,
): boolean {
  if (!patient || !patient.freq || !dayOfWeek) {
    return false
  }
  const scheduledDays = FREQ_TO_DAYS_MAP[patient.freq]
  return scheduledDays ? scheduledDays.includes(dayOfWeek) : false
}

/**
 * 取得病人在指定星期幾，是其一週療程中的「第幾次」透析 (0-based)。
 * 例如 一三五 [1,3,5]：週一→0、週三→1、週五→2。
 * @param freq - 病人頻率字串 (一三五 / 二四六 / 一四 ...)
 * @param dayOfWeek - 星期幾 (1=週一 ... 7=週日)
 * @returns 0-based 次序；若頻率未知或當天非該病人的透析日則回傳 -1。
 */
export function getWeeklySessionIndex(
  freq: string | null | undefined,
  dayOfWeek: number | null | undefined,
): number {
  if (!freq || !dayOfWeek) return -1
  const days = FREQ_TO_DAYS_MAP[freq]
  if (!days) return -1
  return days.indexOf(dayOfWeek)
}

/**
 * AK 名稱別名：型號本身被誤寫成含 / 的字串時，先換成正式名稱再做輪替解析，否則會被當成兩顆輪替。
 * 與後端 src/utils/scheduleUtils.js 的 AK_TEXT_ALIASES 保持一致（2026-09-04：CAT/2000 → KAWASUMI CTA2000）。
 */
const AK_TEXT_ALIASES: [RegExp, string][] = [[/CAT\s*\/\s*2000/gi, 'CTA2000']]

export function normalizeAkAliases(rawValue: string | null | undefined): string {
  let value = (rawValue ?? '').trim()
  for (const [pattern, replacement] of AK_TEXT_ALIASES) value = value.replace(pattern, replacement)
  return value
}

/**
 * 解析「以 / 分隔、每次透析輪替」的醫囑值，挑出指定日期當天該用的那一段。
 * 例：AK "21S/Hi23/Hi23" + 頻率 一三五 + 週三(第 1 次) → "Hi23"。
 *
 * 單一值 (不含 /) 直接回傳；當無法確定當天次序時 (頻率未知、當天非透析日、
 * 或段數不足以對應到當天次序) 一律保守回傳「完整原值」，避免漏備物料。
 *
 * @param rawValue - 原始醫囑值，可能含 / 分隔
 * @param freq - 病人頻率
 * @param dayOfWeek - 星期幾 (1=週一 ... 7=週日)
 */
export function resolveDailyRotationValue(
  rawValue: string | null | undefined,
  freq: string | null | undefined,
  dayOfWeek: number | null | undefined,
): string {
  const value = normalizeAkAliases(rawValue)
  if (!value.includes('/')) return value
  const parts = value
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
  if (parts.length <= 1) return parts[0] ?? value
  const idx = getWeeklySessionIndex(freq, dayOfWeek)
  if (idx >= 0 && idx < parts.length) return parts[idx]
  return value // 無法確定當天次序時，保守顯示全部
}

// 便利函數：檢查是否為兩班頻率
export function isBiweeklyFrequency(freq: string | null | undefined): boolean {
  return !!freq && BIWEEKLY_FREQUENCIES.includes(freq)
}

// 便利函數：獲取頻率對應的數字
export function getFrequencyNumber(freq: string | null | undefined): string | null {
  if (!freq) return null
  return FREQ_NUMBER_MAP[freq] || null
}
