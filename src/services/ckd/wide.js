/* ============================================================
   門診 CKD — 檢驗總表（交接包 app.js:1365-1590 buildWide / wideRows / wideSheets 搬 ESM）
   追蹤記錄表 × 檢驗報告 合併成一張寬表：每人每日期一列；21 項檢驗依臨床意義分群。
   ⚠️ 規則零改動：合併順序（追蹤表先寫入、同鍵先出現者為準）、UPCR 補算、方案推估、
      eGFR 年變化率（最小平方法回歸；<3 點或跨度 <180 天視為不可靠）、排序 皆照原版。
   差異只有：資料由參數注入（原版讀全域 S）；結果以資料集簽章快取。
   ============================================================ */
import { iso, dGap, stageOf, DAY } from './parsers.js'
import { isCare, closedByRows } from './engine.js'

/* 依臨床意義分組排列，顏色只用來分群，不代表數值好壞 */
export const WIDE_GROUPS = [
  ['kid', '腎功能'], ['uri', '尿液'], ['hem', '血液'], ['met', '代謝與血脂'], ['ele', '電解質與骨代謝'],
]
export const WIDE_LABS = [
  ['cr', 'Cr', 'mg/dL', 'kid'], ['egfr', 'eGFR', 'mL/min', 'kid'], ['bun', 'BUN', 'mg/dL', 'kid'], ['ua', 'UA', 'mg/dL', 'kid'],
  ['upcr', 'UPCR', 'mg/gm', 'uri'], ['uacr', 'UACR', 'mg/gm', 'uri'], ['uprot', 'U-Prot', 'mg/dL', 'uri'], ['ucr', 'U-Cr', 'mg/dL', 'uri'],
  ['hb', 'Hb', 'g/dL', 'hem'], ['alb', 'Alb', 'g/dL', 'hem'],
  ['a1c', 'HbA1c', '%', 'met'], ['glu', 'Glu', 'mg/dL', 'met'], ['ldl', 'LDL', 'mg/dL', 'met'], ['tg', 'TG', 'mg/dL', 'met'], ['chol', 'Chol', 'mg/dL', 'met'],
  ['na', 'Na', 'mEq/L', 'ele'], ['k', 'K', 'mEq/L', 'ele'], ['ca', 'Ca', 'mg/dL', 'ele'], ['phos', 'P', 'mg/dL', 'ele'],
  ['ipth', 'iPTH', 'pg/mL', 'ele'], ['hco3', 'HCO3', 'mEq/L', 'ele'],
]
export const WIDE_KEYS = WIDE_LABS.map(x => x[0])
const CASE_KEYS = ['cr', 'egfr', 'upcr', 'uacr', 'hb', 'alb', 'a1c', 'ldl', 'tg']

/** 原版 buildWide()：回傳每人一筆 { mrn, name, sex, age, enroll, enrolled, prog, stage, egfr, upcr, slope, slWeak, slN, slSpan, rows, n, first, last, inClinic, clinicNo, labOnly, latest } */
export function buildWide(S) {
  const clinicBy = {}; S.clinic.forEach(p => { clinicBy[p.mrn] = p })
  const caseBy = {}; S.cases.forEach(c => { (caseBy[c.mrn] = caseBy[c.mrn] || []).push(c) })
  const P = {}
  const touch = (mrn, name, sex, id) => {
    if (!P[mrn]) P[mrn] = { mrn, name: '', sex: '', id: '', enroll: null, rows: {} }
    const x = P[mrn]
    if (!x.name && name) x.name = name
    if (!x.sex && sex) x.sex = sex
    if (!x.id && id) x.id = id
    return x
  }
  const at = (x, d, tag) => {
    const key = iso(d) || '無日期'
    if (!x.rows[key]) x.rows[key] = { date: d, srcs: {} }
    x.rows[key].srcs[tag] = 1
    return x.rows[key]
  }

  // 追蹤記錄表：每一筆就診 = 一列
  for (const c of S.cases) {
    const x = touch(c.mrn, c.name, c.sex, c.id)
    if (c.enroll && (!x.enroll || c.enroll < x.enroll)) x.enroll = c.enroll
    if (c.age != null) x.age = c.age
    const r = at(x, c.visit, '追蹤表')
    CASE_KEYS.forEach(k => { if (c[k] != null && r[k] == null) r[k] = c[k] })
    if (c.stage && !r.stage) r.stage = c.stage
    if (c.bp && !r.bp) r.bp = c.bp
    if (c.bmi != null && r.bmi == null) r.bmi = c.bmi
    if (c.smoke && !r.smoke) r.smoke = c.smoke
    if (c.educator && !r.educator) r.educator = c.educator
    if (c.edu && !r.edu) r.edu = c.edu
  }
  // 檢驗報告：同一天的血液單＋尿液單併入同一列
  for (const l of S.labs) {
    const x = touch(l.mrn, l.name, l.sex, l.id)
    const r = at(x, l.date, l.kind || (l.spec === 'U' ? '尿液' : '生化'))
    WIDE_KEYS.forEach(k => {
      if (l.v[k] != null && r[k] == null) {
        r[k] = l.v[k]
        if (l.q && l.q[k]) r[k + '_q'] = l.q[k]
        if (l.flag && l.flag[k]) r[k + '_f'] = l.flag[k]
      }
    })
    if (l.dx && !r.dx) r.dx = l.dx
    if (l.no) r.no = l.no
  }

  const out = []
  for (const mrn in P) {
    const x = P[mrn]
    const rows = Object.keys(x.rows).map(k => x.rows[k]).sort((a, b) => (a.date || 0) - (b.date || 0))
    rows.forEach(r => {
      r.src = Object.keys(r.srcs).join('+')
      delete r.srcs
      // 尿液單有 U-Prot 與 U-Cr 但沒印 P/C 時，依計畫算法補算
      if (r.upcr == null && r.uprot != null && r.ucr) { r.upcr = Math.round(r.uprot / r.ucr * 1000 * 10) / 10; r.upcr_c = 1 }
      if (!r.stage && r.egfr != null) r.stage = stageOf(r.egfr)
    })
    const lastOf = k => { for (let i = rows.length - 1; i >= 0; i--) if (rows[i][k] != null) return rows[i][k]; return null }
    const mine = caseBy[mrn] || []
    const care = mine.filter(isCare)
    const lastCare = care.sort((a, b) => (b.visit || 0) - (a.visit || 0))[0]
    const enrolled = !!lastCare && !closedByRows(mine, care)
    const cl = clinicBy[mrn] || null
    const egfr = lastOf('egfr'), upcr = lastOf('upcr')
    const stage = stageOf(egfr) || rows.map(r => r.stage).filter(Boolean).pop() || null
    const prog = !enrolled ? '未收案'
      : (((egfr != null && egfr < 45) || (upcr != null && upcr > 1000) || ['G3b', 'G4', 'G5'].indexOf(stage) >= 0) ? 'Pre-ESRD' : 'Early-CKD')
    // eGFR 年變化率（最小平方法）
    const pts = rows.filter(r => r.date && r.egfr != null)
    const spanD = pts.length >= 2 ? dGap(pts[0].date, pts[pts.length - 1].date) : 0
    let sl = null, slWeak = false
    if (pts.length >= 2) {
      slWeak = pts.length < 3 || spanD < 180
      const t = pts.map(r => r.date.getTime() / (365.25 * DAY))
      const mx = t.reduce((a, b) => a + b, 0) / t.length
      const my = pts.reduce((a, b) => a + b.egfr, 0) / pts.length
      let n = 0, d = 0
      t.forEach((v, i) => { n += (v - mx) * (pts[i].egfr - my); d += (v - mx) * (v - mx) })
      if (d) sl = n / d
    }
    out.push({
      mrn, name: x.name, sex: x.sex, id: x.id, age: (cl && cl.age != null) ? cl.age : (x.age == null ? null : x.age),
      enroll: x.enroll, enrolled, prog, stage, egfr, upcr, slope: sl, slWeak, slN: pts.length, slSpan: spanD, rows, n: rows.length,
      first: rows.length ? rows[0].date : null, last: rows.length ? rows[rows.length - 1].date : null,
      inClinic: !!cl, clinicNo: cl ? cl.no : '', labOnly: !enrolled,
      latest: WIDE_KEYS.reduce((o, k) => { o[k] = lastOf(k); return o }, { bp: lastOf('bp'), bmi: lastOf('bmi') }),
    })
  }
  out.sort((a, b) => (b.inClinic - a.inClinic) || (a.labOnly - b.labOnly) || a.mrn.localeCompare(b.mrn))
  return out
}

/** 原版 wideRows：範圍（all／clinic／unlisted／enrolled）＋ 病歷號／姓名子字串 */
export function wideRows(W, scope = 'all', q = '') {
  let list = W
  if (scope === 'clinic') list = list.filter(p => p.inClinic)
  else if (scope === 'unlisted') list = list.filter(p => p.labOnly)
  else if (scope === 'enrolled') list = list.filter(p => p.enrolled)
  const s = String(q || '').trim()
  if (s) list = list.filter(p => p.mrn.indexOf(s) >= 0 || (p.name || '').indexOf(s) >= 0)
  return list
}

/** 原版 tally（#tallyD） */
export function wideTally(W) {
  return {
    persons: W.length,
    rows: W.reduce((a, b) => a + b.n, 0),
    clinic: W.filter(p => p.inClinic).length,
    unlisted: W.filter(p => p.labOnly).length,
    slopeOk: W.filter(p => p.slope != null && !p.slWeak).length,
    noProt: W.filter(p => p.latest.upcr == null && p.latest.uacr == null).length,
  }
}

/** 原版 wideSheets：d1 檢驗明細（每次檢驗一列）、d2 每人最新值；roc 民國日期由呼叫端決定（這裡回 Date，路由層 plain 成 ISO，前端匯出時轉民國） */
export function wideSheets(W, fmtDate) {
  const LB = WIDE_LABS
  const h1 = ['病歷號', '姓名', '性別', '年齡', '方案', '收案日', '明日診號', '日期', '來源', '分期']
    .concat(LB.map(x => x[1] + '(' + x[2] + ')')).concat(['BP', 'BMI', '抽菸', '衛教師', '檢驗單號'])
  const d1 = [h1]
  W.forEach(p => p.rows.forEach(r => d1.push(
    [p.mrn, p.name, p.sex, p.age == null ? '' : p.age, p.prog, fmtDate(p.enroll), p.clinicNo, fmtDate(r.date), r.src, r.stage || '']
      .concat(LB.map(x => r[x[0]] == null ? '' : (r[x[0] + '_q'] || '') + r[x[0]]))
      .concat([r.bp || '', r.bmi == null ? '' : r.bmi, r.smoke || '', r.educator || '', r.no || '']))))
  const h2 = ['病歷號', '姓名', '性別', '年齡', '方案', '收案日', '明日診號', '資料筆數', '首次', '最新',
    'eGFR年變化', '斜率可靠', '分期'].concat(LB.map(x => '最新 ' + x[1])).concat(['BP', 'BMI'])
  const d2 = [h2]
  W.forEach(p => d2.push(
    [p.mrn, p.name, p.sex, p.age == null ? '' : p.age, p.prog, fmtDate(p.enroll), p.clinicNo, p.n, fmtDate(p.first), fmtDate(p.last),
      p.slope == null ? '' : p.slope.toFixed(1), p.slope == null ? '' : (p.slWeak ? '否' : '是'), p.stage || '']
      .concat(LB.map(x => p.latest[x[0]] == null ? '' : p.latest[x[0]]))
      .concat([p.latest.bp || '', p.latest.bmi == null ? '' : p.latest.bmi])))
  return { d1, d2 }
}

/* ---------- 快取：資料集簽章不變就重用（原版 getWide） ---------- */
let cache = null
export function getWide(data) {
  if (cache && cache.sig === data.sig) return cache.W
  const t0 = Date.now()
  const W = buildWide(data)
  cache = { sig: data.sig, W, buildMs: Date.now() - t0 }
  return W
}
export function wideBuildMs() { return cache ? cache.buildMs : null }
