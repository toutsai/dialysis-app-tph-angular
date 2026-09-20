// 門診 CKD：檢驗報告衛教單（病人彙整視窗第二階段；本站新增，非原版單機版功能）
// ★ 給病人看的文字由使用者（醫師）審定：2026-09-20 使用者裁示「照草案做」→ docs/2026-09-20-ckd-handout-wording-draft.md。
//   要改用語請改這個檔的 HANDOUT_ITEMS／STAGE_TEXT，並同步更新該文件；程式不自行增刪臨床說明。
// 異常判定來源（同草案第一節）：① HIS 報告自帶的 H／L 標記；② 既有 9 條異常檢驗門檻（labalert.js ALERT_RULES）。
// 帶 <／> 定性符號的數值不套門檻（與 labalert 同）。危急值在紙本上不標「危急」，照一般偏高／偏低段落呈現（病人由個管師／醫師當下聯絡）。
import { iso, addD, stageOf } from './parsers.js'
import { ALERT_RULES } from './labalert.js'
import { WIDE_LABS, WIDE_GROUPS } from './wide.js'

export const HANDOUT_HOSPITAL = '衛生福利部臺北醫院　腎臟科'
export const HANDOUT_TITLE = '慢性腎臟病照護　檢驗報告說明單'
export const HANDOUT_FOOTER = '本單為衛教說明，用藥與治療請依醫師指示；如有不適請提早回診。'
/** 同一次抽血的血液單與尿液單可能差幾天出報告：報告日往前這幾天內的報告併入「本次」 */
export const HANDOUT_WINDOW_DAYS = 7

/** 各項目的病人用語：name = 衛教單上的名稱；high／low = 偏高／偏低時的說明，空字串 = 不列入注意事項 */
export const HANDOUT_ITEMS = {
  cr: { name: '肌酸酐（腎功能指標）', high: '數值越高代表腎臟過濾功能越差，請配合醫師追蹤，避免自行服用止痛藥、來路不明的中草藥與保健品。', low: '' },
  egfr: { name: '腎絲球過濾率（腎功能分數）', high: '', low: '腎功能分數下降。請規律回診、控制血壓與血糖，避免傷腎藥物；若下降較快，醫師會與您討論後續安排。' },
  bun: { name: '尿素氮', high: '可能與腎功能、蛋白質吃太多、水分不足或腸胃道出血有關，請依營養師建議調整蛋白質攝取。', low: '' },
  ua: { name: '尿酸', high: '少喝含糖飲料與酒類（尤其啤酒），少吃內臟、濃肉湯；多喝水（有限水者依醫囑）。', low: '' },
  upcr: { name: '尿蛋白（UPCR）', high: '尿中蛋白偏多代表腎臟正在受損，請按時服用醫師開立的藥物、控制血壓與血糖、飲食少鹽。', low: '' },
  uacr: { name: '尿蛋白（UACR）', high: '尿中蛋白偏多代表腎臟正在受損，請按時服用醫師開立的藥物、控制血壓與血糖、飲食少鹽。', low: '' },
  uprot: { name: '尿液總蛋白', high: '', low: '' },
  ucr: { name: '尿液肌酸酐', high: '', low: '' },
  hb: { name: '血色素（貧血指標）', high: '', low: '有貧血情形，可能會容易疲倦、頭暈、喘。醫師會評估是否需要補充鐵劑或施打造血針，請勿自行購買補血產品。' },
  alb: { name: '白蛋白（營養指標）', high: '', low: '營養狀態需要加強。低蛋白飲食不等於吃不夠，請與營養師討論足夠熱量與優質蛋白質的吃法。' },
  a1c: { name: '糖化血色素（近三個月血糖平均）', high: '血糖控制需要加強。請按時用藥、注意飲食與運動，並與糖尿病照護團隊討論。', low: '' },
  glu: { name: '血糖', high: '', /* 使用者 2026-09-21 裁定：血糖只看偏低；血糖控制看 HbA1c */ low: '若有冒冷汗、手抖、心悸、飢餓感，可能是低血糖，請立即補充含糖食物並告知醫師。' },
  ldl: { name: '低密度膽固醇（壞膽固醇）', high: '少吃油炸、肥肉、奶油與糕餅類，規律運動；若醫師有開降血脂藥請按時服用。', low: '' },
  tg: { name: '三酸甘油酯', high: '少喝含糖飲料與酒，減少精緻澱粉與甜食，規律運動。', low: '' },
  chol: { name: '總膽固醇', high: '少吃油炸、肥肉、奶油與糕餅類，規律運動；若醫師有開降血脂藥請按時服用。', low: '' },
  na: { name: '鈉', high: '請告知醫師；注意水分攝取是否不足。', low: '請告知醫師；可能與水分過多或用藥有關，請勿自行大量喝水或限鹽過度。' },
  k: { name: '鉀', high: '血鉀偏高可能影響心跳，請特別注意。蔬菜先切再川燙、不喝菜湯與肉湯；避免低鈉鹽、薄鹽醬油、楊桃；高鉀水果（香蕉、奇異果、哈密瓜、番茄等）減量。若有心悸、肌肉無力請立即就醫。', low: '請告知醫師；可能與利尿劑、腹瀉或進食不足有關。' },
  ca: { name: '鈣', high: '請告知醫師；勿自行補充鈣片或維生素 D。', low: '請告知醫師；醫師會評估是否需要補充。' },
  phos: { name: '磷', high: '少吃加工食品（香腸、火腿、貢丸、泡麵）、可樂與含磷添加物的飲料、內臟、堅果、全穀類與乳製品；若醫師有開磷結合劑，請隨餐服用。', low: '' },
  ipth: { name: '副甲狀腺素', high: '與鈣磷代謝有關，控制好血磷很重要；請依醫師指示用藥與追蹤。', low: '' },
  hco3: { name: '碳酸氫根（血液酸鹼）', high: '', low: '血液偏酸，與腎功能下降有關。若醫師有開小蘇打（碳酸氫鈉），請按時服用。' },
}

/** 分期的病人用語（草案第四節） */
export const STAGE_TEXT = {
  G1: ['第 1 期', '腎功能分數正常，但有腎臟受損的跡象（例如蛋白尿）'],
  G2: ['第 2 期', '腎功能輕度下降'],
  G3a: ['第 3a 期', '腎功能輕度至中度下降'],
  G3b: ['第 3b 期', '腎功能中度至重度下降'],
  G4: ['第 4 期', '腎功能重度下降'],
  G5: ['第 5 期', '腎功能嚴重下降，需與醫師討論後續治療方式'],
}

/** 9 條門檻各自代表偏高還是偏低（na 一條規則兩個方向，依數值判） */
const RULE_DIR = { k6: 'H', k55: 'H', hb8: 'L', hb10: 'L', p55: 'H', hco3: 'L', a1c9: 'H', upcr3: 'H' }
function ruleDir(key, v) {
  for (const r of ALERT_RULES) {
    if (r.key !== key || !r.f(v)) continue
    return r.id === 'na' ? (v < 130 ? 'L' : 'H') : RULE_DIR[r.id] || ''
  }
  return ''
}

/**
 * ★ 使用者（醫師）2026-09-21 裁定：HbA1c「≥7 才列」、血糖「只看偏低」，這兩項不採用 HIS 的 H 標記。
 * 原因：HIS 的 H 門檻很低，正式資料試算 19,773 張單有 9,881 張會印「血糖控制需要加強」，其中 57% HbA1c <6.5；血糖被標 H 的 62% <126。
 * 表格的「偏高」標示與注意事項用同一個判定，免得表上標紅卻沒有說明。勿改回看 HIS 標記；要調數字請先問使用者。
 */
export const HBA1C_LIST_FROM = 7
const DIR_OVERRIDE = {
  a1c: (v, q, his) => (typeof v === 'number' && q !== '<' && v >= HBA1C_LIST_FROM ? { dir: 'H', by: 'rule' } : { dir: his === 'L' ? 'L' : '', by: his === 'L' ? 'his' : '' }),
  glu: (v, q, his) => (his === 'L' ? { dir: 'L', by: 'his' } : { dir: '', by: '' }),
}

/** 同一句話只講一次：有 LDL 偏高就不再列總膽固醇偏高（草案第三節；血糖偏高已改為一律不列） */
const SUPPRESSED_BY = { chol: { H: 'ldl' } }

/** 可選的報告日（新→舊）：該日至少有一項檢驗值、且不是只有登錄簿帶進來的值 */
export function handoutReportDates(rows) {
  return (rows || [])
    .filter((r) => r.date && r.src !== '追蹤表' && WIDE_LABS.some((x) => r[x[0]] != null))
    .map((r) => iso(r.date))
    .sort((a, b) => b.localeCompare(a))
}

/**
 * 組衛教單內容。rows = getWide() 該病人的每日列（date 為 Date）；reportDate = 'YYYY-MM-DD'（空 = 最近一個報告日）。
 * 回傳 { reportDate, windowFrom, items, cautions, stage }；沒有任何報告 → null。
 *  items：本次有值的項目（依檢驗總表順序）：{ key, label, name, unit, group, groupLabel, v, q, date, dir:'H'|'L'|'', by:'his'|'rule'|'', prev:{v,q,date}|null }
 *  cautions：要印在「需要注意的項目」的段落：{ keys, title, dir, text }
 */
export function buildHandout(rows, reportDate) {
  const dates = handoutReportDates(rows)
  if (!dates.length) return null
  const rd = dates.includes(reportDate) ? reportDate : dates[0]
  const rdDate = new Date(rd + 'T00:00:00')
  const from = iso(addD(rdDate, -HANDOUT_WINDOW_DAYS))
  const desc = (rows || []).filter((r) => r.date).slice().sort((a, b) => b.date - a.date)
  const groupLabel = Object.fromEntries(WIDE_GROUPS)

  const items = []
  for (const [key, label, unit, group] of WIDE_LABS) {
    const i = desc.findIndex((r) => r[key] != null && iso(r.date) <= rd && iso(r.date) >= from)
    if (i < 0) continue
    const cur = desc[i]
    const prevRow = desc.slice(i + 1).find((r) => r[key] != null) || null
    const v = cur[key], q = cur[key + '_q'] || '', his = cur[key + '_f'] || ''
    let dir = his === 'H' || his === 'L' ? his : '', by = dir ? 'his' : ''
    if (DIR_OVERRIDE[key]) ({ dir, by } = DIR_OVERRIDE[key](v, q, his))
    else if (!dir && !q && typeof v === 'number') { dir = ruleDir(key, v); if (dir) by = 'rule' }
    items.push({
      key, label, name: (HANDOUT_ITEMS[key] || {}).name || label, unit, group, groupLabel: groupLabel[group] || '',
      v, q, date: iso(cur.date), dir, by,
      prev: prevRow ? { v: prevRow[key], q: prevRow[key + '_q'] || '', date: iso(prevRow.date) } : null,
    })
  }

  const textOf = (it) => { const w = HANDOUT_ITEMS[it.key]; return !w || !it.dir ? '' : (it.dir === 'H' ? w.high : w.low) }
  const listed = new Set(items.filter((it) => textOf(it)).map((it) => it.key + it.dir))
  const cautions = []
  for (const it of items) {
    const text = textOf(it)
    if (!text) continue
    const sup = (SUPPRESSED_BY[it.key] || {})[it.dir]
    if (sup && listed.has(sup + it.dir)) continue
    // UPCR 與 UACR 同一段文字 → 併成一段「尿蛋白」
    if ((it.key === 'upcr' || it.key === 'uacr') && it.dir === 'H') {
      const prev = cautions.find((c) => c.title === '尿蛋白' && c.dir === 'H')
      if (prev) { prev.keys.push(it.key); continue }
      cautions.push({ keys: [it.key], title: '尿蛋白', dir: 'H', text })
      continue
    }
    cautions.push({ keys: [it.key], title: it.name, dir: it.dir, text })
  }

  const eg = items.find((it) => it.key === 'egfr' && typeof it.v === 'number')
  const code = eg ? stageOf(eg.v) : null
  const stage = code && STAGE_TEXT[code] ? { code, label: STAGE_TEXT[code][0], text: STAGE_TEXT[code][1], egfr: eg.v, date: eg.date } : null
  return { reportDate: rd, windowFrom: from, items, cautions, stage }
}
