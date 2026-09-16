// 門診 CKD：解析結果 → 可 JSON 序列化的純資料列（子程序／CLI 與主程序之間的契約）
// parsers.js 輸出的日期是 Date 物件；跨程序傳遞前一律轉成 'YYYY-MM-DD'（台北本地日，與原版 iso() 一致）。
import { iso, clinicLabs } from './parsers.js'

export function plain(v) {
  if (v instanceof Date) return isNaN(v) ? null : iso(v)
  if (Array.isArray(v)) return v.map(plain)
  if (v && typeof v === 'object') {
    const o = {}
    for (const k of Object.keys(v)) o[k] = plain(v[k])
    return o
  }
  return v === undefined ? null : v
}

/** 解析結果整包正規化：{ kind, rows, extraLabs }；門診清單自帶的檢驗值在這裡先算好（需要 Date 才能組 no） */
export function toPayload(kind, rows) {
  const extraLabs = kind === 'clinic' ? clinicLabs(rows) : []
  return { kind, rows: plain(rows), extraLabs: plain(extraLabs) }
}

/** 日期欄（已是字串）取區間 */
export function dateRange(rows, field) {
  let lo = null, hi = null
  for (const r of rows) {
    const d = r[field]
    if (!d) continue
    if (lo == null || d < lo) lo = d
    if (hi == null || d > hi) hi = d
  }
  return { start: lo, end: hi }
}

export const DATE_FIELD = { case: 'visit', clinic: 'date', lab: 'date', bill: 'visit' }
