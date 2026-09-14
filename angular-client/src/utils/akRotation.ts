/**
 * AK（人工腎臟）週模型工具。
 *
 * 資料模型：`dialysisOrders.akWeekly` = 6 格（索引 0=週一 … 5=週六）是唯一權威（與 HIS 備藥前置作業同模型）；
 * `dialysisOrders.ak` 是由它自動產生的「輪替字串」（依透析日序以 / 串接，全同 → 單值），下游病人卡/備物/KiDit 沿用。
 * 這裡集中三份原本各自複製的邏輯（透析醫囑視窗、藥物調整頁、後端 orders.js buildAkRotation），
 * 後端版在 src/routes/orders.js，改演算法要兩邊同步。
 */
import { getTaipeiWeekdayIndex } from './dateUtils'

/** 透析頻率 → 星期索引（0=週一 … 5=週六），與後端 src/utils/scheduleUtils.js FREQ_MAP_TO_DAY_INDEX 一致 */
export const FREQ_MAP_TO_DAY_INDEX: Record<string, number[]> = {
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

export const AK_WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六'] as const

export function emptyAkWeekly(): string[] {
  return ['', '', '', '', '', '']
}

/** 正規化成 6 格字串陣列；不是合法 6 格陣列回 null */
export function normalizeAkWeekly(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length !== 6) return null
  const weekly = value.map((v) => String(v ?? '').trim())
  return weekly.some(Boolean) ? weekly : null
}

/**
 * 週欄位 → 輪替字串（與後端 Excel 匯入 buildAkRotation 同邏輯）：
 * 有頻率取透析日對應值依序串接（勿去重、勿錯序；全同 → 單值）；無頻率取六天非空去重依日序串接。
 */
export function buildAkRotation(akWeekly: readonly string[], freq: string | null | undefined): string {
  const weekly = Array.from({ length: 6 }, (_, i) => String(akWeekly?.[i] ?? '').trim())
  const days = FREQ_MAP_TO_DAY_INDEX[freq || ''] || []
  const sessionValues = days.map((d) => weekly[d]).filter((v) => v)
  if (sessionValues.length > 0) {
    return new Set(sessionValues).size === 1 ? sessionValues[0] : sessionValues.join('/')
  }
  const uniq = [...new Set(weekly.filter((v) => v))]
  return uniq.join('/')
}

/**
 * 舊資料反推：輪替字串 → 六格。
 * 整串本身就是一個正式品名（如 CAT/2000）→ 六天全填，不拆；單值 → 六天全填；
 * 多段 → 依透析日序展開（其餘天留空）；無頻率 → 依序填入週一起。
 */
export function deriveAkWeeklyFromRotation(
  akString: string | null | undefined,
  freq: string | null | undefined,
  isWholeName?: (name: string) => boolean,
): string[] {
  const weekly = emptyAkWeekly()
  const value = String(akString ?? '').trim()
  if (!value) return weekly
  if (isWholeName?.(value)) return weekly.map(() => value)
  const segments = value.split('/').map((s) => s.trim()).filter(Boolean)
  if (segments.length === 0) return weekly
  if (segments.length === 1) return weekly.map(() => segments[0])
  const days = FREQ_MAP_TO_DAY_INDEX[freq || ''] || []
  if (days.length > 0) {
    days.forEach((d, i) => {
      weekly[d] = segments[i % segments.length]
    })
  } else {
    segments.forEach((seg, i) => {
      if (i < 6) weekly[i] = seg
    })
  }
  return weekly
}

/**
 * 某一天該用的 AK：優先 akWeekly[該日星期]；沒有 akWeekly 的舊資料才退回輪替字串
 * （整串是正式品名不拆；否則依頻率取當次段，無法判斷回整串）。
 * date 為 YYYY-MM-DD（台北時區）；週日回 ''（akWeekly 只有週一～六）。
 * resolveRotation 的 dayOfWeek 採 scheduleUtils 慣例（1=週一 … 6=週六），可直接接 resolveDailyRotationValue。
 */
export function akForDate(
  orders: { akWeekly?: unknown; ak?: unknown; artificialKidney?: unknown } | null | undefined,
  date: string,
  freq: string | null | undefined,
  isWholeName?: (name: string) => boolean,
  resolveRotation?: (raw: string, freq: string | null | undefined, dayOfWeek: number) => string,
): string {
  const dow = getTaipeiWeekdayIndex(date) // dateUtils 慣例：0=週一 … 5=週六，6=週日
  const isSunday = dow === 6
  const weekly = normalizeAkWeekly(orders?.akWeekly)
  if (weekly) {
    if (isSunday) return ''
    return weekly[dow] || ''
  }
  const raw = String(orders?.ak ?? orders?.artificialKidney ?? '').trim()
  if (!raw) return ''
  if (isWholeName?.(raw) || !raw.includes('/')) return raw
  if (isSunday || !resolveRotation) return raw
  return resolveRotation(raw, freq, dow + 1)
}
