// B/C 肝狀態（病人清單四態，與 KiDit 病史表單 33/34 同碼）
// hbsag / antihcv：Y 陽性、N 陰性、O 未做、F 已作待追蹤（＋追蹤日期站內欄）
// 病人清單為權威；diseases 標籤（HBV/HCV/BC肝?）由四態衍生，供排程備註/分組/統計等既有消費端沿用
//
// 既有資料回填規則（2026-08-27 使用者裁定）：沒勾 HBV/HCV ＝ 陰性 N；勾 BC肝? ＝ 已作待追蹤 F；勾 HBV/HCV/C肝治癒 ＝ 陽性 Y

export const HEPATITIS_VALUES = ['Y', 'N', 'O', 'F']

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function normValue(v) {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
  return HEPATITIS_VALUES.includes(s) ? s : ''
}

function normDate(v) {
  return typeof v === 'string' && DATE_RE.test(v.trim()) ? v.trim() : ''
}

/** 正規化前端送來的 hepatitisStatus；非法值視為空字串（未填） */
export function normalizeHepatitisStatus(input) {
  const src = input && typeof input === 'object' ? input : {}
  const hbsag = normValue(src.hbsag)
  const antihcv = normValue(src.antihcv)
  return {
    hbsag,
    antihcv,
    hbsagFollowDate: hbsag === 'F' ? normDate(src.hbsagFollowDate) : '',
    antihcvFollowDate: antihcv === 'F' ? normDate(src.antihcvFollowDate) : ''
  }
}

/** 由舊 diseases 標籤推導四態（回填與舊寫入路徑用） */
export function deriveHepatitisFromTags(diseases) {
  const tags = Array.isArray(diseases) ? diseases.map(String) : []
  const pending = tags.includes('BC肝?')
  const hbsag = tags.includes('HBV') ? 'Y' : pending ? 'F' : 'N'
  const antihcv = tags.includes('HCV') || tags.includes('C肝治癒') ? 'Y' : pending ? 'F' : 'N'
  return { hbsag, antihcv, hbsagFollowDate: '', antihcvFollowDate: '' }
}

/** 依四態同步 diseases 標籤：Y→HBV/HCV；任一為 O 或 F→BC肝?；其他標籤（HIV/RPR/C肝治癒/COVID/隔離）原樣保留 */
export function syncTagsFromHepatitis(diseases, status) {
  const s = normalizeHepatitisStatus(status)
  const base = (Array.isArray(diseases) ? diseases.map(String) : [])
    .filter((t) => !['HBV', 'HCV', 'BC肝?'].includes(t))
  if (s.hbsag === 'Y') base.push('HBV')
  if (s.antihcv === 'Y') base.push('HCV')
  if (['O', 'F'].includes(s.hbsag) || ['O', 'F'].includes(s.antihcv)) base.push('BC肝?')
  return base
}

export function parseHepatitisStatus(raw) {
  if (!raw) return null
  try {
    const obj = JSON.parse(raw)
    return obj && typeof obj === 'object' ? normalizeHepatitisStatus(obj) : null
  } catch {
    return null
  }
}
