// 血液傳染病四項四態（病人清單）：HBsAg / Anti-HCV / HIV / RPR（梅毒）
// 每項值：Y 陽性、N 陰性、O 未做、F 已作待追蹤；每項另有「檢驗日期」（Y/N/F 皆應填，O 不填）
// B/C 肝兩項與 KiDit 病史表單 33/34 同碼（HIV/RPR 不進 KiDit）。
// 病人清單為權威；diseases 標籤由四態衍生（Y→HBV/HCV/HIV/RPR；F→「HBV待追蹤」等；N/O 不出標籤），
// 供排程備註縮寫（B/C/H/R，待追蹤 B?/C?/H?/R?）、分組、統計等既有消費端沿用。
//
// 沿革：2026-08-27 B/C 肝四態上線（沒勾＝N、BC肝?＝F、HBV/HCV/C肝治癒＝Y）；
// 2026-08-30 擴為四項＋檢驗日期（舊 *FollowDate → *Date；HIV/RPR 舊標籤有＝Y、無＝N），BC肝? 標籤停用。
// 前端對應 angular-client/src/utils/hepatitis.ts（規則須一致）

export const HEPATITIS_VALUES = ['Y', 'N', 'O', 'F']
export const INFECTION_KEYS = ['hbsag', 'antihcv', 'hiv', 'rpr']
export const INFECTION_META = {
  hbsag: { tag: 'HBV', abbr: 'B', label: 'HBsAg（B 肝）' },
  antihcv: { tag: 'HCV', abbr: 'C', label: 'Anti-HCV（C 肝）' },
  hiv: { tag: 'HIV', abbr: 'H', label: 'HIV' },
  rpr: { tag: 'RPR', abbr: 'R', label: 'RPR（梅毒）' },
}
export const PENDING_SUFFIX = '待追蹤'
export const dateKeyOf = (key) => `${key}Date`
export const pendingTagOf = (key) => `${INFECTION_META[key].tag}${PENDING_SUFFIX}`

/** C 肝已治癒（治癒後 Anti-HCV 仍陽性）：antihcvCured 'Y'|''，antihcvCuredDate 治癒日期；標籤 C肝治癒 由此衍生 */
export const CURED_TAG = 'C肝治癒'

/** 其他隔離疾病（diseases 自由標籤，非四態）：COVID／疥瘡／多重抗藥菌／其他（存 `其他:文字`） */
export const ISOLATION_OPTIONS = ['COVID', '疥瘡', '多重抗藥菌']
export const ISOLATION_OTHER_PREFIX = '其他:'
const ISOLATION_ABBR = { COVID: '冠', 疥瘡: '疥', 多重抗藥菌: 'MDR', 隔離: '隔' }

/** 由四態管理的標籤（寫入時先剝掉再依四態重建） */
const MANAGED_TAGS = new Set([
  ...INFECTION_KEYS.map((k) => INFECTION_META[k].tag),
  ...INFECTION_KEYS.map(pendingTagOf),
  'BC肝?',
  CURED_TAG,
])

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function normValue(v) {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
  return HEPATITIS_VALUES.includes(s) ? s : ''
}

function normDate(v) {
  return typeof v === 'string' && DATE_RE.test(v.trim()) ? v.trim() : ''
}

/** 正規化前端送來的 hepatitisStatus；非法值視為空字串（未填）；O 不保留日期；相容舊 *FollowDate 鍵 */
export function normalizeHepatitisStatus(input) {
  const src = input && typeof input === 'object' ? input : {}
  const out = {}
  for (const key of INFECTION_KEYS) {
    const value = normValue(src[key])
    out[key] = value
    out[dateKeyOf(key)] =
      value && value !== 'O' ? normDate(src[dateKeyOf(key)]) || normDate(src[`${key}FollowDate`]) : ''
  }
  const cured = src.antihcvCured === 'Y' || src.antihcvCured === true
  out.antihcvCured = cured ? 'Y' : ''
  out.antihcvCuredDate = cured ? normDate(src.antihcvCuredDate) : ''
  return out
}

/** 由 diseases 標籤推導四態（回填與舊寫入路徑用）；日期一律空 */
export function deriveHepatitisFromTags(diseases) {
  const tags = Array.isArray(diseases) ? diseases.map(String) : []
  const legacyPending = tags.includes('BC肝?')
  const pick = (key, extraPositive = []) => {
    const meta = INFECTION_META[key]
    if (tags.includes(meta.tag) || extraPositive.some((t) => tags.includes(t))) return 'Y'
    if (tags.includes(pendingTagOf(key))) return 'F'
    if (legacyPending && (key === 'hbsag' || key === 'antihcv')) return 'F'
    return 'N'
  }
  const out = {}
  for (const key of INFECTION_KEYS) {
    out[key] = pick(key, key === 'antihcv' ? [CURED_TAG] : [])
    out[dateKeyOf(key)] = ''
  }
  out.antihcvCured = tags.includes(CURED_TAG) ? 'Y' : ''
  out.antihcvCuredDate = ''
  return out
}

/** 既有四態缺項（舊格式）時由標籤補齊，其餘原樣；回傳完整四項（含 C 肝治癒） */
export function upgradeHepatitisStatus(status, diseases) {
  const s = normalizeHepatitisStatus(status)
  const derived = deriveHepatitisFromTags(diseases)
  for (const key of INFECTION_KEYS) if (!s[key]) s[key] = derived[key]
  // 舊資料無治癒旗標但有 C肝治癒 標籤 → 補 Y（標籤由狀態衍生，取消治癒時標籤會一併移除，不會衝突；
  // 注意 parseHepatitisStatus 已正規化、鍵永遠存在，不能用「無鍵」判定）
  if (!s.antihcvCured && derived.antihcvCured) s.antihcvCured = 'Y'
  return s
}

/** 依四態同步 diseases 標籤：Y→HBV/HCV/HIV/RPR；F→「X待追蹤」；N/O 無標籤；其他標籤（C肝治癒/COVID/隔離）原樣保留 */
export function syncTagsFromHepatitis(diseases, status) {
  const s = normalizeHepatitisStatus(status)
  const base = (Array.isArray(diseases) ? diseases.map(String) : []).filter((t) => !MANAGED_TAGS.has(t))
  for (const key of INFECTION_KEYS) {
    if (s[key] === 'Y') base.push(INFECTION_META[key].tag)
    else if (s[key] === 'F') base.push(pendingTagOf(key))
  }
  if (s.antihcvCured === 'Y') base.push(CURED_TAG)
  return base
}

/** 其他隔離疾病縮寫：COVID→冠、疥瘡→疥、多重抗藥菌→MDR、其他:xxx／舊 隔離→隔 */
export function isolationAbbrFromTags(diseases) {
  const tags = Array.isArray(diseases) ? diseases.map(String) : []
  const out = []
  for (const t of tags) {
    if (ISOLATION_ABBR[t]) out.push(ISOLATION_ABBR[t])
    else if (t.startsWith(ISOLATION_OTHER_PREFIX)) out.push('隔')
  }
  return Array.from(new Set(out))
}

/** 排程備註縮寫：標籤 → B/C/H/R、待追蹤 → B?/C?/H?/R?（舊 BC肝? → BC?） */
export function infectionAbbrFromTags(diseases) {
  const tags = Array.isArray(diseases) ? diseases.map(String) : []
  const out = []
  for (const key of INFECTION_KEYS) {
    const meta = INFECTION_META[key]
    if (tags.includes(meta.tag)) out.push(meta.abbr)
    else if (tags.includes(pendingTagOf(key))) out.push(`${meta.abbr}?`)
  }
  if (tags.includes('BC肝?')) out.push('BC?')
  return out
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
