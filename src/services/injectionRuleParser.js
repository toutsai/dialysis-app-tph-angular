// 針劑施打規則解析器（純函式，不碰 DB）。DB 層在 dailyInjectionService.js，解讀層/月視圖/上傳 diff 在 injectionRulesService.js。

export const INJECTION_MEDS = {
  INES2: { tradeName: 'NESP', unit: 'mcg' },
  IREC1: { tradeName: 'Recormon', unit: 'KIU' },
  IFER2: { tradeName: 'Good-Fe', unit: 'mg' },
  ICAC: { tradeName: 'Cacare', unit: 'amp' },
  IPAR1: { tradeName: 'Parsabiv', unit: 'mg' },
}

// 每日應打清單刻意不列的針劑藥碼：
// IGEN2（Gentamicin，permcath lock 用）書記已有獨立的 Gentamycin 開立清單，
// 且區間格式上傳把所有 I 開頭藥碼都歸為 injection，若不排除會在改讀頻率欄後突然出現。
export const DAILY_INJECTION_EXCLUDED_CODES = new Set(['IGEN2'])

function normalizeFullWidth(text) {
  return String(text || '')
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ')
}

function isValidDate(month, day) {
  if (month < 1 || month > 12) return false
  if (day < 1 || day > 31) return false
  if (month === 2 && day > 29) return false
  if ([4, 6, 9, 11].includes(month) && day > 30) return false
  return true
}

export function hasMeaningfulDose(dose) {
  const value = String(dose || '').trim()
  return value !== '' && value !== '0'
}

const CHINESE_WEEKDAY = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 }

export function getDateContext(targetDate) {
  const dateObj = new Date(`${targetDate}T00:00:00Z`)
  const targetDayOfWeek = dateObj.getUTCDay() || 7
  const year = dateObj.getUTCFullYear()
  // 當月第幾週：採「日曆週、週日為一週之始」，含 1 號之週為第 1 週。
  // firstWeekday = 當月 1 號的星期（週日=0）。例：2026-07 的 7/6(週一)、7/5(週日) 皆為第 2 週。
  // （勿改回「每 7 天一塊」的日期分塊法：那會讓 7/6 誤判成第 1 週、Q2W 多打。）
  const firstWeekday = new Date(Date.UTC(year, dateObj.getUTCMonth(), 1)).getUTCDay()
  const weekOfMonth = Math.ceil((dateObj.getUTCDate() + firstWeekday) / 7)
  return { targetDayOfWeek, year, weekOfMonth }
}

/**
 * 解析一段規則文字（備註欄、頻率服法欄、或使用者確認的規則）。
 * 回傳：
 *  - isHold        : 含 hold/暫停/停打 → 明確停打
 *  - hasDateRule / dateMatched : 明確日期（MMDD、MM/DD、民國年、西元）
 *  - intervalN     : Q{N}W 的 N（不論其後有無星期幾）；QW/無 → null
 *  - intervalDays  : Q{N}W 後接的星期幾（如 Q2W4 → [4]）；無 → null
 *  - wDays         : QW/W 後接的星期幾（QW135 → [1,3,5]），含中文「每周三」→ [3]；無 → null
 */
export function analyzeRuleText(text, targetDate = null) {
  const result = {
    isHold: false,
    hasDateRule: false,
    dateMatched: false,
    /** 明確日期 token：{ year: 西元年或 null（MMDD 未寫年，評估時取目標年）, month, day } */
    dates: [],
    intervalN: null,
    intervalDays: null,
    wDays: null,
  }
  const trimmed = String(text || '').trim()
  if (!trimmed) return result
  const hasTarget = typeof targetDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(targetDate)
  const year = hasTarget ? getDateContext(targetDate).year : null

  const normalized = normalizeFullWidth(trimmed).toUpperCase()

  if (/\bHOLD\b/.test(normalized) || /暫停|停打/.test(normalized)) {
    result.isHold = true
  }

  const wDays = new Set()
  const wRegex = /\b(?:QW|W)\s*([1-7][1-7\s.,，、&]*)/g
  let wMatch
  while ((wMatch = wRegex.exec(normalized)) !== null) {
    if (/\d{4}/.test(wMatch[0])) continue
    for (const day of wMatch[1].match(/[1-7]/g) || []) wDays.add(parseInt(day, 10))
  }
  // 中文星期：每周三打 / 每週三 / 週三 / 星期三 / 禮拜三 / 每周一三五
  const zhRegex = /(?:每)?(?:周|週|星期|禮拜)\s*([一二三四五六日天](?:[\s、,，.及和]*[一二三四五六日天])*)/g
  let zhMatch
  while ((zhMatch = zhRegex.exec(normalized)) !== null) {
    for (const ch of zhMatch[1]) {
      if (CHINESE_WEEKDAY[ch]) wDays.add(CHINESE_WEEKDAY[ch])
    }
  }
  if (wDays.size > 0) result.wDays = [...wDays].sort()

  // 間隔週規則 Q{N}W[days] / Q{N}W W[days]（如 Q2W4、Q2W W4、Q2W5）。
  // 語意：每 N 週一次，當月第 1 週起算 → 第 weekOfMonth 符合 (weekOfMonth-1)%N===0
  // 的週才打；N=2 → 第 1/3/5 週（遇第 5 週該月多打一次）。星期幾由其後數字決定。
  // 注意與「QW（每週）」區別：QW2=每週二；Q2W2=每兩週的週二（僅奇數週）。
  // 容許 Q{N}W 與星期幾間有空白/逗號/頓號分隔，並相容 "Q2W, W3" / "Q2W W3" 的重複 W。
  const intervalDays = new Set()
  const intervalRegex = /\bQ(\d+)W[\s,，、]*(?:W[\s,，、]*)?([1-7][1-7\s.,，、&]*)?/g
  let ivMatch
  while ((ivMatch = intervalRegex.exec(normalized)) !== null) {
    const interval = parseInt(ivMatch[1], 10)
    if (!interval || interval < 1) continue
    if (result.intervalN === null) result.intervalN = interval
    const dayPart = ivMatch[2]
    if (!dayPart) continue
    for (const d of dayPart.match(/[1-7]/g) || []) intervalDays.add(parseInt(d, 10))
  }
  if (intervalDays.size > 0) result.intervalDays = [...intervalDays].sort()

  const markDate = (explicitYear, month, day) => {
    result.hasDateRule = true
    result.dates.push({ year: explicitYear, month, day })
    if (hasTarget) {
      const y = explicitYear ?? year
      const parsed = `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      if (parsed === targetDate) result.dateMatched = true
    }
  }

  const slashDateRegex = /(?:(\d{4})[/-])?(\d{1,2})[/-](\d{1,2})/g
  let dateMatch
  while ((dateMatch = slashDateRegex.exec(normalized)) !== null) {
    const nextText = normalized.slice(dateMatch.index + dateMatch[0].length).replace(/^\s+/, '')
    if (!dateMatch[1] && /^(AMP|VIAL|PC|TAB|MG|ML|A\b|V\b|M\b)/.test(nextText)) continue
    const parsedYear = dateMatch[1] ? parseInt(dateMatch[1], 10) : null
    const month = parseInt(dateMatch[2], 10)
    const day = parseInt(dateMatch[3], 10)
    if (!isValidDate(month, day)) continue
    markDate(parsedYear, month, day)
  }

  // 民國年日期：1150605（7 碼 = 民國年YYY+MM+DD）或 115/06/05、115-06-05（3 碼民國年）。
  // 民國年 + 1911 = 西元年。限民國 100~200 年，避免誤判一般數字。
  const rocRegex = /(?:^|[^\d])(\d{3})[/-]?(\d{2})[/-]?(\d{2})(?=[^\d]|$)/g
  let rocMatch
  while ((rocMatch = rocRegex.exec(normalized)) !== null) {
    const rocYear = parseInt(rocMatch[1], 10)
    if (rocYear < 100 || rocYear > 200) continue
    const month = parseInt(rocMatch[2], 10)
    const day = parseInt(rocMatch[3], 10)
    if (!isValidDate(month, day)) continue
    markDate(rocYear + 1911, month, day)
  }

  const mmddRegex = /(?:^|[^\d])(\d{2})(\d{2})(?=[^\d]|$)/g
  let mmddMatch
  while ((mmddMatch = mmddRegex.exec(normalized)) !== null) {
    const month = parseInt(mmddMatch[1], 10)
    const day = parseInt(mmddMatch[2], 10)
    if (!isValidDate(month, day)) continue
    markDate(null, month, day)
  }

  return result
}

/** 解析器版本：規則語意改動時遞增，持久化的解讀層（injection_order_rules）以此判斷是否需重建 */
export const INJECTION_PARSER_VERSION = '2026-09-18.1'

function resolveDateToken(token, targetYear) {
  const y = token.year ?? targetYear
  return `${y}-${String(token.month).padStart(2, '0')}-${String(token.day).padStart(2, '0')}`
}

/** 把日期 token 展開成指定年份的 YYYY-MM-DD 清單（未寫年的取 targetYear） */
export function ruleDatesForYear(rule, targetYear) {
  return (rule?.dateTokens || []).map((t) => resolveDateToken(t, targetYear))
}

/**
 * 建立一筆處方的「正規化施打規則」（解讀層的核心；不依賴目標日期）：
 *  kind: 'hold' | 'dates' | 'weekly' | 'interval' | 'uncertain'
 *  source: 'override' | 'note' | 'frequency' | null
 *  intervalN: 間隔週數（weekly=1）；days: 星期幾 1..7；dateTokens: 明確日期
 *  text: 人可讀的規則字串；reason: uncertain 時的原因
 * 優先序：備註（或覆寫）明確日期 > 備註 Q{N}W/QW/中文星期 > 頻率欄；備註 hold → hold。
 */
export function buildInjectionRule(order, overrideRule = null) {
  const usingOverride = overrideRule !== null && overrideRule !== undefined && String(overrideRule).trim() !== ''
  const noteText = usingOverride ? String(overrideRule) : order.note || ''
  const note = analyzeRuleText(noteText)
  const freq = analyzeRuleText(order.frequency || '')
  const noteSource = usingOverride ? 'override' : 'note'
  const base = { intervalN: 1, days: [], dateTokens: [], text: '', reason: '' }

  if (note.isHold) {
    return { ...base, kind: 'hold', source: noteSource, text: noteText.trim() }
  }
  if (note.hasDateRule) {
    return { ...base, kind: 'dates', source: noteSource, dateTokens: note.dates, text: noteText.trim() }
  }
  if (freq.isHold && !note.wDays && !note.intervalDays) {
    return { ...base, kind: 'hold', source: 'frequency', text: String(order.frequency || '').trim() }
  }

  let days = null
  let source = null
  if (note.intervalDays || note.wDays) {
    days = note.intervalDays || note.wDays
    source = noteSource
  } else if (freq.intervalDays || freq.wDays) {
    days = freq.intervalDays || freq.wDays
    source = 'frequency'
  }
  const intervalN = note.intervalN || freq.intervalN || 1

  if (!days) {
    const freqText = String(order.frequency || '').trim()
    let reason
    if (freq.intervalN) reason = `頻率 ${freqText} 未註明星期幾`
    else if (/^QW$/i.test(freqText)) reason = '頻率 QW 未註明星期幾'
    else reason = '備註與頻率皆無可判讀的施打規則'
    return { ...base, kind: 'uncertain', source: null, reason }
  }

  const text = `${intervalN > 1 ? `Q${intervalN}W` : 'QW'}${days.join('')}`
  return { ...base, kind: intervalN > 1 ? 'interval' : 'weekly', source, intervalN, days, text }
}

/** 規則在 targetDate 是否施打（hold / uncertain 一律 false） */
export function isRuleScheduledOn(rule, targetDate) {
  if (!rule || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) return false
  if (rule.kind === 'dates') {
    const year = parseInt(targetDate.slice(0, 4), 10)
    return ruleDatesForYear(rule, year).includes(targetDate)
  }
  if (rule.kind !== 'weekly' && rule.kind !== 'interval') return false
  const { targetDayOfWeek, weekOfMonth } = getDateContext(targetDate)
  const weekOk = rule.intervalN <= 1 || (weekOfMonth - 1) % rule.intervalN === 0
  return weekOk && rule.days.includes(targetDayOfWeek)
}

/** 規則文字是否含任何可判定施打日的資訊（供覆寫規則驗證用） */
export function ruleTextIsDecidable(text) {
  const a = analyzeRuleText(text, '2026-01-01')
  return a.isHold || a.hasDateRule || !!a.intervalDays || !!a.wDays
}

/**
 * 依「備註 → 頻率服法」判定某筆針劑處方在 targetDate 是否施打。
 * 優先序：明確日期 > 間隔週(Q{N}W) > 每週(QW)；備註優先於頻率欄。
 *  - 備註含 hold → hold（不列、也不算疑慮）
 *  - 備註有明確日期 → 只在列出的日期施打（即使另含 W/Q2W）
 *  - 星期幾：備註的 Q{N}W 後數字 > 備註的 QW/W/中文星期 > 頻率欄的 Q{N}W 後數字 > 頻率欄的 QW 後數字
 *  - 間隔週 N：備註的 Q{N}W > 頻率欄的 Q{N}W > 1（每週）。例：頻率 Q2W + 備註 QW2 → 每兩週的週二
 *  - 兩邊都找不到星期幾（如頻率只有 QW、備註空白）→ uncertain，系統不自行判定
 * overrideRule（使用者在疑慮清單確認的規則）若有值則取代備註。
 */
export function resolveInjectionSchedule(order, targetDate, overrideRule = null) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    return { status: 'skip', source: null, effectiveRule: '', reason: 'invalid date', rule: null }
  }
  const rule = buildInjectionRule(order, overrideRule)
  if (rule.kind === 'hold') return { status: 'hold', source: rule.source, effectiveRule: rule.text, reason: '', rule }
  if (rule.kind === 'uncertain') return { status: 'uncertain', source: null, effectiveRule: '', reason: rule.reason, rule }
  return {
    status: isRuleScheduledOn(rule, targetDate) ? 'scheduled' : 'skip',
    source: rule.source,
    effectiveRule: rule.text,
    reason: '',
    rule,
  }
}

/**
 * 舊介面：只看單一段文字（備註）判定是否施打。保留給既有呼叫端／測試；
 * 新邏輯請走 resolveInjectionSchedule（會合併頻率欄與覆寫規則）。
 */
export function shouldAdministerOnDate(note, targetDate) {
  const r = resolveInjectionSchedule({ note, frequency: '' }, targetDate)
  return r.status === 'scheduled'
}

// ---------------------------------------------------------------------------
// 覆寫規則（疑慮清單確認）：以處方的自然鍵對應，重新上傳整表覆蓋後仍能對回同一筆。
// ---------------------------------------------------------------------------
export function overrideKeyOf(order) {
  return [
    order.patient_id ?? order.patientId ?? '',
    order.order_code ?? order.orderCode ?? '',
    order.start_date ?? order.startDate ?? '',
    String(order.dose ?? '').trim(),
    String(order.frequency ?? '').trim(),
  ].join('|')
}
