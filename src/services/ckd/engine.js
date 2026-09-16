/* ============================================================
   門診 CKD 收案追蹤 — 判定引擎（純函式；ESM 版）
   來源：交接包 src/app.js 的 規則引擎（cfg / REQ_* / pool / missingReq / indicators / analyze / evalCase）、
   helpers（deptMatch / isCare / closedByRows / closeKind / mergedLab）、sessionGroups、verdictA / verdictB。
   2026-09-15 搬進本站後端（階段 2）。

   ⚠️ 規則零改動：判定門檻、文字說明、排序全部照原版。差異只有：
     - 資料與設定改由參數注入（原版讀全域 S 與 DOM 的 cfg()）
     - 個案紀錄四個掛鉤（claimFixesOf / enrollFixOf / noEnrollOf / extEnrollOf）由 hooks 參數注入，
       階段 3 實作前一律回 null / []（原版用 typeof fn === 'function' 鬆耦合，語意相同）
     - 手動加入病歷號（S.manual）暫不支援（列表恆為空）
   若要改判定規則，先對照交接包 HANDOFF.md 與 tests/ckd-engine.test.mjs。
   ============================================================ */
import { iso, roc, addD, dGap, stageOf, ckdEpi, mdrdS, meets, qv } from './parsers.js'

/* ---------- helpers（app.js:75-102） ---------- */
/* 「只看此科別」比對：空白 = 全院；可用 、 / | 或空白分隔多個科別（任一命中即算），子字串比對 */
export function deptMatch(dept, filter) {
  const f = String(filter || '').trim()
  if (!f) return true
  const d = String(dept || '')
  return f.split(/[、,，/|;;\s]+/).filter(Boolean).some(x => d.indexOf(x) >= 0)
}
/* 照護紀錄判定（三處共用）：獎勵/結案/一次性衛教/其他代碼 都不是照護就診 */
const NON_CARE = { '獎勵': 1, '結案': 1, '衛教': 1, '其他': 1 }
export const isCare = r => !NON_CARE[r.ctype]
/* 結案判定：登錄簿有開放中的收案段 → 未結案；否則取最新結案列，其後若仍有照護/入帳 → 活動中；都沒有 → 已結案 */
export function closedByRows(all, care) {
  if (all.some(r => r.src === 'case' && r.closed === false)) return null
  const closeRow = all.filter(r => r.ctype === '結案' && r.visit).sort((a, b) => b.visit - a.visit)[0] || null
  if (!closeRow) return null
  const lastCare = care.filter(r => r.visit).sort((a, b) => b.visit - a.visit)[0] || null
  if (lastCare && lastCare.visit > closeRow.visit) return null
  return closeRow
}
/* 結案原因分類（部北登錄簿「結案原因」自由字串） */
export function closeKind(reason) {
  const r = String(reason || '')
  if (/死亡|往生|過世/.test(r)) return 'dead'
  if (/透析|洗腎|移植|ESRD.*(治療|透析)/.test(r)) return 'dialysis'
  if (/轉診|轉他院|轉院|他院|外院/.test(r)) return 'transfer'
  if (/未執行|失聯|超過.*年|180/.test(r)) return 'lapse'
  return 'other'
}
/* 合併同一人的多張檢驗單（app.js:28）：最新在前，同鍵取最新；UPCR 缺時以 U-Prot/U-Cr×1000 推算 */
export function mergedLabOf(labRows) {
  const rs = (labRows || []).slice().sort((a, b) => (b.date || 0) - (a.date || 0))
  if (!rs.length) return null
  const out = { date: rs[0].date, v: {}, flag: {}, q: {}, dateOf: {}, src: rs.length, kinds: [...new Set(rs.map(r => r.kind).filter(Boolean))] }
  for (const r of rs) for (const k in r.v) if (!(k in out.v)) { out.v[k] = r.v[k]; out.flag[k] = r.flag[k]; out.q[k] = r.q ? r.q[k] : undefined; out.dateOf[k] = r.date }
  if (out.v.upcr == null && out.v.uprot != null && out.v.ucr) { out.v.upcr = Math.round(out.v.uprot / out.v.ucr * 1000 * 10) / 10; out.calcUpcr = true }
  return out
}
const KEY_BILL = r => r.mrn + '|' + iso(r.visit) + '|' + r.code
function indexBy(arr) {
  const map = new Map()
  for (const r of arr) { let a = map.get(r.mrn); if (!a) map.set(r.mrn, a = []); a.push(r) }
  return map
}

/* ---------- 設定（app.js:220-232；DOM cfg() → 參數） ---------- */
export function makeCfg(settings, dateStr) {
  const s = settings || {}
  const date = dateStr ? new Date(dateStr + 'T00:00:00') : new Date()
  return {
    date: isNaN(date) ? new Date() : date,
    preGap: +s.preGap || 77,
    earlyNew: +s.earlyNew || 77,
    earlyGap: +s.earlyGap || 161,
    dmGap: +s.dmGap || 70,
    over: +s.over || 180,
    labWin: +s.labWin || 90,
    dept: String(s.dept || '').trim(),
    allA: !!s.allA,
  }
}

/* ---------- 必要項目（app.js:233-294） ---------- */
export const REQ_PRE = [
  ['sbp', '血壓'], ['bh', '身高'], ['bw', '體重'], ['egfr', 'eGFR'], ['hb', 'Hb'], ['bun', 'BUN'],
  ['cr', 'Creatinine'], ['ua', 'Uric acid'], ['na', 'Na'], ['k', 'K'], ['ca', 'Total Ca'], ['phos', 'P'],
  ['alb', 'Albumin'], ['tg', 'TG'], ['ldl', 'LDL-C'], ['uprot', 'Urine Total Protein'],
  ['ucr', 'Urine Creatinine'], ['upcr', 'Urine PCR'],
]
export const REQ_PRE_DM = [['glu', 'AC Sugar'], ['a1c', 'HbA1c']]
export const REQ_EARLY = [
  ['sbp', '血壓'], ['bh', '身高'], ['bw', '體重'], ['smoke', '抽菸'],
  ['uOrA', 'UPCR 或 UACR'], ['cr', 'Serum creatinine'], ['egfr', 'eGFR'], ['ldl', 'LDL-C(當年度 1 次)'],
]
/* Q29-2：LDL-C 為 Early-CKD 必要檢查，但頻率是「當年度至少 1 次、不限時間」 */
const ANNUAL_KEY = { ldl: 1 }
export const REQ_EARLY_DM = [['a1c', 'HbA1c']]

/* 必要項目的「有效」判定（Q12：就醫日前後 3 個月；Q29：LDL 當年度至少一次） */
export function pool(rec, lab, today, win) {
  const p = {}
  const fresh = (d) => !today || !win || !d ? true : Math.abs(dGap(d, today)) <= win
  const sameYear = (d) => !today || !d ? true : d.getFullYear() === today.getFullYear()
  const okFor = (k, d) => ANNUAL_KEY[k] ? sameYear(d) : fresh(d)
  const put = (k, v, d) => { if (v != null && v !== '' && !(k in p) && okFor(k, d)) p[k] = v }
  if (lab) for (const k in lab.v) put(k, lab.v[k], lab.dateOf ? lab.dateOf[k] : lab.date)
  if (rec) {
    const d = rec.visit || null
    put('sbp', rec.sbp, d); put('dbp', rec.dbp, d); put('bh', rec.bh, d); put('bw', rec.bw, d); put('smoke', rec.smoke || null, d)
    put('cr', rec.cr, d); put('egfr', rec.egfr, d); put('ldl', rec.ldl, d); put('tg', rec.tg, d)
    put('alb', rec.alb, d); put('hb', rec.hb, d); put('a1c', rec.a1c, d); put('upcr', rec.upcr, d); put('uacr', rec.uacr, d)
  }
  p.uOrA = (p.upcr != null || p.uacr != null) ? 1 : null
  return p
}
const LAB_ONLY = { bun: 1, ua: 1, na: 1, k: 1, ca: 1, phos: 1, uprot: 1, ucr: 1, glu: 1 }
/* 診間當次可直接量測登錄的項目 */
const BEDSIDE_KEY = { sbp: 1, dbp: 1, bh: 1, bw: 1, smoke: 1 }
/* 院別資料剖面（部北版）：追蹤清冊不含血壓/身高/體重/抽菸，只能在診間登錄時確認 */
export const HOSP = { bedside: false, clinicState: false, clinicSex: false }
export function missingReq(p, prog, isDM, hasLab) {
  const list = prog === 'pre' ? REQ_PRE.concat(isDM ? REQ_PRE_DM : []) : REQ_EARLY.concat(isDM ? REQ_EARLY_DM : [])
  const gone = list.filter(x => p[x[0]] == null)
  const miss = [], unk = [], bed = [], ord = []
  gone.forEach(x => {
    if (!hasLab && LAB_ONLY[x[0]]) { unk.push(x[1]); return }
    if (ANNUAL_KEY[x[0]] && !hasLab) { unk.push(x[1]); return }
    if (BEDSIDE_KEY[x[0]] && !HOSP.bedside) { bed.push(x[1]); return }
    miss.push(x[1])
    ;(BEDSIDE_KEY[x[0]] ? bed : ord).push(x[1])
  })
  return { miss, unk, bed, ord }
}
export function indicators(p, prog, isDM) {
  const out = []
  if (p.sbp != null) out.push({ n: 'BP', v: p.sbp + '/' + (p.dbp == null ? '?' : p.dbp), ok: p.sbp < 130 && (p.dbp == null || p.dbp < 80) })
  if (p.ldl != null) out.push({ n: 'LDL', v: p.ldl, ok: prog === 'pre' ? p.ldl < 100 : p.ldl < 130 })
  if (prog === 'pre' && p.tg != null) out.push({ n: 'TG', v: p.tg, ok: p.tg < 150 })
  if (isDM && p.a1c != null) out.push({ n: 'A1c', v: p.a1c, ok: prog === 'pre' ? p.a1c < 7.5 : p.a1c < 7.0 })
  return out
}

export const OTHER_SESSION = '__other__'   // 診次「他科掛號已收案」的醫師代號
const NO_HOOKS = { claimFixesOf: () => [], enrollFixOf: () => null, noEnrollOf: () => null, extEnrollOf: () => null }
const ALIVE = p => !/退掛|取消|作廢/.test(p.state || '')

/* ---------- 診次分組（app.js:959-1001）：判讀日 × 醫師 ---------- */
export function sessionGroups(data, cfg, doctorSel = '', curDate = '') {
  const deptF = cfg.dept
  const aliveAll = data.clinic.filter(ALIVE)
  const aliveDept = deptF ? aliveAll.filter(p => deptMatch(p.dept, deptF)) : aliveAll
  const alive = aliveDept.length ? aliveDept : aliveAll
  const grp = {}
  alive.forEach(p => {
    if (!p.date) return
    const k = iso(p.date) + '|' + ((p.doctor || '').trim())
    if (!grp[k]) grp[k] = { date: iso(p.date), doctor: (p.doctor || '').trim(), n: 0 }
    grp[k].n++
  })
  const groups = Object.values(grp).sort((a, b) => a.date.localeCompare(b.date) || a.doctor.localeCompare(b.doctor, 'zh-Hant'))
  const caseIdx = indexBy(data.cases)
  const hasOpenEpisode = mrn => (caseIdx.get(mrn) || []).some(r => r.src === 'case' && r.closed === false)
  const others = {}, otherGroups = {}
  if (cfg.allA && deptF) {
    const inDeptDay = {}
    alive.forEach(p => { if (p.date) (inDeptDay[iso(p.date)] = inDeptDay[iso(p.date)] || new Set()).add(p.mrn) })
    const seenDD = {}
    aliveAll.forEach(p => {
      if (!p.date || deptMatch(p.dept, deptF) || !hasOpenEpisode(p.mrn)) return
      const d = iso(p.date)
      if (inDeptDay[d] && inDeptDay[d].has(p.mrn)) return
      ;(others[d] = others[d] || new Set()).add(p.mrn)
      const k = d + '|' + (p.dept || '') + '|' + ((p.doctor || '').trim()) + '|' + p.mrn
      if (seenDD[k]) return; seenDD[k] = 1
      const gk = (p.dept || '') + '|' + ((p.doctor || '').trim())
      const arr = otherGroups[d] = otherGroups[d] || []
      let g = arr.find(x => x.key === gk); if (!g) arr.push(g = { key: gk, dept: p.dept || '', doctor: (p.doctor || '').trim(), n: 0 })
      g.n++
    })
    for (const d in otherGroups) otherGroups[d].sort((a, b) => a.dept.localeCompare(b.dept, 'zh-Hant') || a.doctor.localeCompare(b.doctor, 'zh-Hant'))
  }
  const otherN = {}; for (const d in others) otherN[d] = others[d].size
  let cur = curDate
  if (!cur) {
    /* 預設判讀日 = 本科別最近的門診日（app.js:180-184） */
    const pool = deptF && data.clinic.some(x => deptMatch(x.dept, deptF)) ? data.clinic.filter(x => deptMatch(x.dept, deptF)) : data.clinic
    const ds = pool.map(x => x.date).filter(Boolean).sort((a, b) => b - a)
    cur = ds.length ? iso(ds[0]) : iso(new Date())
  }
  let sel = doctorSel || ''
  if (sel && sel.indexOf(OTHER_SESSION) === 0) {
    const sub = sel.split('|')
    if (!otherN[cur]) sel = ''
    else if (sub.length > 1 && !(otherGroups[cur] || []).some(g => g.dept === (sub[1] || '') && g.doctor === (sub[2] || ''))) sel = OTHER_SESSION
  } else if (sel && !groups.some(g => g.date === cur && g.doctor === sel)) sel = ''
  return { groups, cur, doctorSel: sel, others: otherN, otherGroups }
}

/* ============================================================
   analyze（app.js:296-731）
   data = { cases, clinic, labs, billing, manual }（日期已是 Date）；C = makeCfg()；
   opts = { doctorSel, withAudit, hooks }
   ============================================================ */
export function analyze(data, C, opts = {}) {
  const hooks = { ...NO_HOOKS, ...(opts.hooks || {}) }
  const doctorSel = opts.doctorSel || ''
  const S = { cases: data.cases || [], clinic: data.clinic || [], labs: data.labs || [], billing: data.billing || [], records: data.records || [], manual: data.manual || [] }
  const labIdx = indexBy(S.labs)
  const mergedLab = mrn => mergedLabOf(labIdx.get(mrn))
  const yr = C.date.getFullYear()
  const byMrn = {}
  S.cases.forEach(c => { (byMrn[c.mrn] = byMrn[c.mrn] || []).push(c) })
  const billSpan = S.billing.length ? {
    from: new Date(Math.min.apply(null, S.billing.map(b => +b.visit))),
    to: new Date(Math.max.apply(null, S.billing.map(b => +b.visit))),
  } : null
  const billedSet = new Set(S.billing.map(KEY_BILL))
  const billedDay = new Set(S.billing.map(b => b.mrn + '|' + iso(b.visit)))
  const priceMap = {}
  S.billing.forEach(b => { priceMap[KEY_BILL(b)] = b })
  const isBilled = c => c.code && c.visit && billedSet.has(c.mrn + '|' + iso(c.visit) + '|' + c.code)
  if (S.billing.length) {
    const caseKeys = new Set()
    for (const k in byMrn) byMrn[k].forEach(c => { if (c.code && c.visit) caseKeys.add(c.mrn + '|' + iso(c.visit) + '|' + c.code) })
    S.billing.forEach(b => {
      if (caseKeys.has(KEY_BILL(b))) return
      ;(byMrn[b.mrn] = byMrn[b.mrn] || []).push({
        src: 'bill', mrn: b.mrn, name: b.name, code: b.code, prog: b.prog, ctype: b.ctype,
        visit: b.visit, doctor: b.doctor, price: b.price, enroll: null,
        egfr: null, stage: null, upcr: null, uacr: null, cr: null, age: null, sex: '',
      })
    })
  }
  /* 手動 P 碼補登/註銷（階段 3 掛鉤） */
  const fixAll = {}, voidKeys = new Set()
  {
    const pool2 = {}
    S.records.filter(r => r.type === 'claimFix' && !r.deleted).forEach(r => { pool2[r.mrn] = 1 })
    Object.keys(pool2).forEach(m => {
      const fx = hooks.claimFixesOf(m); if (!fx || !fx.length) return
      fixAll[m] = fx
      fx.forEach(f => { if (f.action === 'void') voidKeys.add(m + '|' + iso(f.at) + '|' + f.code) })
    })
    for (const m in fixAll) {
      const exist = new Set((byMrn[m] || []).filter(c => c.code && c.visit).map(c => c.mrn + '|' + iso(c.visit) + '|' + c.code))
      fixAll[m].filter(f => f.action === 'add').forEach(f => {
        const key = m + '|' + iso(f.at) + '|' + f.code
        if (exist.has(key)) return
        ;(byMrn[m] = byMrn[m] || []).push({
          src: 'fix', mrn: m, name: '', code: f.code, prog: f.prog, ctype: f.ctype,
          visit: f.at, doctor: f.doctor, price: null, enroll: null,
          egfr: null, stage: null, upcr: null, uacr: null, cr: null, age: null, sex: '',
        })
      })
    }
    if (voidKeys.size) for (const m in byMrn)
      byMrn[m] = byMrn[m].filter(c => !(c.code && c.visit && voidKeys.has(c.mrn + '|' + iso(c.visit) + '|' + c.code)))
  }
  /* 收案狀態更正（階段 3 掛鉤） */
  const enrollFixMap = {}
  {
    const seen = {}
    S.records.filter(r => r.type === 'enrollFix' && !r.deleted).forEach(r => { seen[r.mrn] = 1 })
    Object.keys(seen).forEach(m => {
      const f = hooks.enrollFixOf(m); if (!f) return
      enrollFixMap[m] = f
      if (f.on && !(byMrn[m] || []).some(c => c.code)) {
        const lv = f.lastVisit ? new Date(f.lastVisit) : (f.enrollDate ? new Date(f.enrollDate) : null)
        if (lv && !isNaN(+lv)) (byMrn[m] = byMrn[m] || []).push({
          src: 'fix', mrn: m, name: '', code: f.prog === 'pre' ? 'P3403C' : 'P4302C', prog: f.prog, ctype: '追蹤',
          visit: lv, doctor: '', price: null, enroll: f.enrollDate ? new Date(f.enrollDate) : lv,
          egfr: null, stage: null, upcr: null, uacr: null, cr: null, age: null, sex: '',
        })
      }
    })
  }
  for (const k in byMrn) byMrn[k].sort((a, b) => (b.visit || 0) - (a.visit || 0))
  const dmSet = new Set(S.clinic.filter(p => p.pDM).map(p => p.mrn))
  S.cases.forEach(c => { if (c.dm) dmSet.add(c.mrn) })
  const closedMap = {}
  const withVisit = S.cases.filter(c => c.visit)
  const spanFrom = withVisit.length ? new Date(Math.min.apply(null, withVisit.map(c => +c.visit))) : null

  function bigProtAtEnroll(recs) {
    const first = recs[recs.length - 1]
    return !!(first && first.upcr != null && first.upcr > 1000)
  }

  function evalCase(mrn, todayClinic) {
    const ef = enrollFixMap[mrn]
    if (ef && !ef.on) return null
    const recsAll = byMrn[mrn]; if (!recsAll || !recsAll.length) return null
    const recs = recsAll.filter(isCare)
    const closeRow = closedByRows(recsAll, recs)
    if (closeRow) {
      closedMap[mrn] = { at: closeRow.visit, prog: closeRow.prog, code: closeRow.code || '', reason: closeRow.reason || '' }
      return null
    }
    if (!recs.length) return null
    const openEps = recsAll.filter(r => r.src === 'case' && r.closed === false)
    const dkdOpen = openEps.some(r => r.cat === 'DKD' || /^P70\d\dC$/.test(r.code || ''))
    const ckdOpen = openEps.some(r => !(r.cat === 'DKD' || /^P70\d\dC$/.test(r.code || '')))
    if (dkdOpen && !ckdOpen) {
      const dk = openEps.filter(r => r.cat === 'DKD' || /^P70/.test(r.code || '')).sort((a, b) => (b.enroll || 0) - (a.enroll || 0))[0]
      const lastC = recs[0], labD = mergedLab(mrn), egD = labD && labD.v.egfr != null ? labD.v.egfr : lastC.egfr
      return { mrn, p: todayClinic, last: lastC, recs, prog: 'early', dkd: true, isDM: true, egfr: egD, src: labD && labD.v.egfr != null ? '檢驗報告' : '追蹤記錄表',
        mdrd: null, stage: stageOf(egD) || lastC.stage, upcr: labD && labD.v.upcr != null ? labD.v.upcr : lastC.upcr, uacr: labD && labD.v.uacr != null ? labD.v.uacr : lastC.uacr,
        lab: labD, labOk: false, labGap: null, nextDue: dk.nextDue || null, nextApp: null, caseDoctor: String(dk.doctor || '').trim(),
        lastCode: lastC.code || null, lastType: lastC.ctype || null, code: null, need: null, gap: lastC.visit ? dGap(lastC.visit, C.date) : null,
        status: 'dkd', n12: 0, nYear: 0, tenure: dk.enroll ? dGap(dk.enroll, C.date) : null, slope: null, isNew: false, ann: { ok: false, why: [] }, miss: [], unk: [], bed: [], ord: [], inds: [], alerts: [],
        why: ['DKD 方案收案(' + (dk.code || 'P70xC') + ',收案 ' + (dk.enroll ? roc(dk.enroll) : '—') + (dk.doctor ? ' · ' + dk.doctor : '') + '):Early-CKD 追蹤碼(P4301C/P4302C)不可申報,由 DKD 方案追蹤;本工作台不做追蹤與缺項評估'],
        recon: { anchor: null, misses: [], shortBilled: [] }, enroll: dk.enroll || null, age: lastC.age != null ? lastC.age : (todayClinic ? todayClinic.age : null) }
    }
    const last = recs[0], lab = mergedLab(mrn)
    const hasCodes = !!last.code
    const isDM = dmSet.has(mrn) || !!(todayClinic && todayClinic.pDM)
    const age = last.age != null ? last.age : (todayClinic ? todayClinic.age : null)
    const sexF = /女|F/.test(last.sex || (todayClinic ? todayClinic.sex : ''))

    let egfr = lab && lab.v.egfr != null ? lab.v.egfr : null, src = '檢驗報告'
    if (egfr == null && lab && lab.v.cr != null && age) { egfr = ckdEpi(lab.v.cr, age, sexF); src = '由血清 Cr 推算' }
    if (egfr == null) { egfr = last.egfr; src = '追蹤記錄表' }
    const upcr = (lab && lab.v.upcr != null) ? lab.v.upcr : last.upcr
    const uacr = (lab && lab.v.uacr != null) ? lab.v.uacr : last.uacr
    const stage = stageOf(egfr) || last.stage
    const crUse = (lab && lab.v.cr != null) ? lab.v.cr : last.cr
    const mdrd = (crUse && age) ? mdrdS(crUse, age, sexF) : null

    const bigProt = (upcr != null && upcr > 1000)
    const baseStage = last.stage || stage
    const prog = hasCodes ? last.prog
      : ((['G3b', 'G4', 'G5'].indexOf(baseStage) >= 0 || bigProt) ? 'pre' : 'early')

    const cnt = r => !hasCodes || r.ctype === '追蹤'
    const nYear = recs.filter(r => r.visit && r.visit.getFullYear() === yr && cnt(r)).length
    const n12 = recs.filter(r => r.visit && dGap(r.visit, C.date) <= 365 && cnt(r)).length
    const gap = last.visit ? dGap(last.visit, C.date) : null
    const firstNew = recs.slice().reverse().filter(r => r.ctype === '新收案')[0] || null
    const enrollDate = last.enroll || (firstNew ? firstNew.visit : null) ||
      (hasCodes ? recs[recs.length - 1].visit : null)
    const isNew = hasCodes ? (last.ctype === '新收案')
      : (recs.length === 1 && last.enroll && last.visit && Math.abs(dGap(last.enroll, last.visit)) <= 7)
    const tenure = enrollDate ? dGap(enrollDate, C.date) : null

    let need, code, status, why = []
    if (prog === 'pre') { need = C.preGap; code = 'P3403C' }
    else if (isDM && dkdOpen) { need = C.dmGap; code = 'P7001C' }
    else { need = isNew ? C.earlyNew : C.earlyGap; code = 'P4302C'; if (isDM) why.push('有糖尿病但登錄簿為 Early-CKD 收案:追蹤碼仍用 P4302C;P7001C 屬 DKD 方案收案者') }

    const recon = { anchor: null, misses: [], shortBilled: [] }
    if (billSpan) {
      const lastB = last.src === 'bill' || isBilled(last)
      recon.anchor = lastB ? 'bill' : (last.code ? 'unbilled' : null)
      recon.misses = recs.filter(r => r.src !== 'bill' && r.visit &&
        r.visit >= billSpan.from && r.visit <= billSpan.to && isCare(r) &&
        (r.code ? !isBilled(r) : !billedDay.has(r.mrn + '|' + iso(r.visit))))
      const care = recs.filter(r => (r.src === 'bill' || isBilled(r)) && r.ctype === '追蹤' && r.visit).sort((a, b) => a.visit - b.visit)
      for (let i = 1; i < care.length; i++) {
        const g2 = dGap(care[i - 1].visit, care[i].visit)
        const nd = care[i].prog === 'pre' ? C.preGap : C.earlyGap
        if (g2 < nd) recon.shortBilled.push({ at: care[i].visit, code: care[i].code, gap: g2, need: nd })
      }
    }
    const lastBilled2 = last.src === 'bill' || isBilled(last)
    const lastPrice = last.price || (priceMap[last.mrn + '|' + (last.visit ? iso(last.visit) : '') + '|' + last.code] || {}).price
    if (hasCodes) why.push((billSpan ? (lastBilled2 ? '上次入帳 ' : '上次登錄(入帳期內查無入帳)') : '上次開立 ') +
      last.code + '(' + last.ctype + ')' +
      (last.visit ? ' 於 ' + roc(last.visit) : '') + (last.doctor ? ' · ' + last.doctor : '') +
      (lastBilled2 && lastPrice ? ' · ' + lastPrice + ' 點' : ''))
    if (recon.misses.length) why.push('⚠ 漏帳 ' + recon.misses.length + ' 次:' +
      recon.misses.slice(0, 3).map(m => roc(m.visit) + (m.code ? ' ' + m.code : '')).join('、') +
      (recon.misses.length > 3 ? ' …' : '') + ' — 已登錄照護但查無入帳,請補申報')
    if (recon.shortBilled.length) why.push('⚠ 入帳間隔異常 ' + recon.shortBilled.length + ' 筆:' +
      recon.shortBilled.slice(0, 2).map(x => roc(x.at) + ' 距前次僅 ' + x.gap + ' 天(需 ' + x.need + ')').join('、') + ' — 有核刪風險')
    if (gap == null) { status = 'none'; why.push('照護紀錄無可用日期') }
    else if (gap >= need) {
      status = gap > C.over ? 'over' : 'ok'
      why.push('距上次照護 ' + gap + ' 天,已滿 ' + code + ' 的 ' + need + ' 天間隔')
      if (gap > C.over) why.push('已逾 ' + C.over + ' 天未追蹤')
    } else {
      status = 'wait'
      why.push('距上次' + ((last.src === 'bill' || isBilled(last)) ? '入帳' : '照護') + '僅 ' + gap + ' 天,尚差 ' + (need - gap) + ' 天;' + code + ' 最快 ' + roc(addD(last.visit, need)) + ' 可申報')
    }
    if (prog === 'early') {
      const cap = isDM ? 3 : 2, capTxt = isDM ? 'P7001C 每年最多 3 次' : 'P4302C 每年最多 2 次'
      if (nYear >= cap && status === 'ok') { status = 'cap'; why = ['本年度已照護 ' + nYear + ' 次,' + capTxt + ',已達上限'] }
      else if (status === 'ok') why.push('本年度已照護 ' + nYear + ' 次(上限 ' + cap + ')')
    }

    const ann = { ok: false, code: prog === 'pre' ? 'P3404C' : (isDM ? 'P7002C' : null), why: [] }
    const lastAnn = recsAll.filter(r => r.ctype === '年度' && r.visit).sort((a, b) => b.visit - a.visit)[0] || null
    if (prog === 'pre') {
      const annBilled = lastAnn && dGap(lastAnn.visit, C.date) <= 365
      const n12ok = n12 >= 3, lastOk = gap != null && gap >= C.preGap
      ann.ok = n12ok && lastOk && !annBilled
      if (annBilled) ann.why.push('近一年已於 ' + roc(lastAnn.visit) + ' 申報 ' + lastAnn.code + '(每人每年限一次)')
      else if (lastAnn) ann.why.push('上次年度評估 ' + roc(lastAnn.visit) + '(已逾一年,可再申報)')
      ann.why.push('近 12 個月照護 ' + n12 + ' 次' + (n12ok ? '(已達 3 次)' : '(需 3 次,尚差 ' + (3 - n12) + ')'))
      if (!lastOk && gap != null) ann.why.push('距最後一次 P3403C 需 ≥' + C.preGap + ' 天,目前 ' + gap + ' 天')
      if (ann.ok) ann.why.push(lastAnn ? '符合 P3404C 年度評估費 600 點條件'
        : '符合 P3404C 年度評估費 600 點條件' + (hasCodes ? ';查無歷史申報紀錄' : ';每人每年限一次,請確認今年是否已申報'))
    } else if (isDM) {
      ann.ok = n12 >= 3 && gap != null && gap >= 70
      ann.why.push('P7002C 需 P1407C/P1408C/P1410C/P4301C/P4302C/P7001C 合計 ≥3 次且距最後一次追蹤 ≥10 週;近 12 個月 ' + n12 + ' 次')
    } else {
      ann.why.push('初期慢性腎臟病單獨收案無年度評估項目(僅 P4301C / P4302C / P4303C)')
    }

    const cont = prog === 'pre' && tenure != null && tenure >= 365 * 3
    const alerts = []
    const liveStage = stageOf(egfr)
    if (last.stage && liveStage && last.stage !== liveStage)
      alerts.push({ t: '分期', m: '登錄分期 ' + last.stage.replace('G', 'Stage ') + ',最新 eGFR ' + (egfr == null ? '?' : egfr.toFixed(1)) + ' 屬 ' + liveStage.replace('G', 'Stage ') + '(登錄值可能為收案當時分期);VPN 上傳與方案歸屬請以最新值確認' })
    if (prog === 'early' && egfr != null && egfr < 45)
      alerts.push({ t: '轉出', m: 'eGFR ' + egfr.toFixed(1) + ' < 45,已達 Stage 3b,依方案結案條件應建議轉診至 Pre-ESRD 院所。' +
        '轉診獎勵費 ' + (isDM ? 'P7003C' : 'P4303C') + ' 200 點僅限跨院或跨科轉診,且須待對方院所收案 Pre-ESRD 後(轉診回執聯／電子轉診平台回復／VPN 顯示)才可申報;' +
        '依 Q9,同院所腎臟科互轉、或轉給自己皆不符獎勵資格 —— 本院腎臟科自行承接時不申報此費' })
    if (prog === 'early' && upcr != null && upcr >= 1000)
      alerts.push({ t: '轉出', m: 'UPCR ' + upcr + ' ≥ 1000 mg/gm,依方案結案條件應建議轉診至 Pre-ESRD 院所' })
    if (prog === 'pre' && bigProtAtEnroll(recs) && upcr != null && upcr < 200)
      alerts.push({ t: '獎勵', m: '以蛋白尿收案,目前 UPCR ' + upcr + ' < 200 已達完全緩解,可評估 P3408C 獎勵費 1,000 點(每人限一次)' })
    if (prog === 'pre' && egfr != null && egfr >= 45 && !bigProt)
      alerts.push({ t: '注意', m: 'eGFR 已回復至 Stage 3A;依計畫仍可申報 P3403C,惟需留意結案時點' })
    if (cont) alerts.push({ t: '獎勵', m: '收案已滿 ' + Math.floor(tenure / 365) + ' 年;若已完成 3 次 P3404C,可評估 P3409C 持續照護獎勵費 2,000 點' })
    if (prog === 'early') {
      const yNow = C.date.getUTCFullYear()
      const fu = recs.filter(r => r.src === 'bill' && r.code === 'P4302C' && r.visit && r.visit.getUTCFullYear() === yNow)
      const docs = Array.from(new Set(fu.map(r => r.doctor).filter(Boolean)))
      if (fu.length >= 2 && docs.length > 1) alerts.push({ t: '注意',
        m: '今年 ' + fu.length + ' 次 P4302C 由不同醫師申報(' + docs.join('、') + ');依 Q22,同年度 2 次追蹤管理須為同一醫師,病人才會計入該醫師獎勵金' })
    }
    if (gap != null && gap >= 300) alerts.push({ t: gap >= 365 ? '轉出' : '注意',
      m: gap >= 365 ? '距上次照護已 ' + gap + ' 天(超過 1 年),依 Q6-3 系統可能已主動結案;如需續管請確認 VPN 狀態並重新收案'
        : '距上次照護 ' + gap + ' 天,滿 365 天未執行管理照護,系統將主動結案(Q6-3),請儘速安排回診' })

    let slope = null
    const withE = recs.filter(r => r.visit && r.egfr != null).sort((a, b) => a.visit - b.visit)
    if (withE.length >= 2) {
      const a = withE[0], b = withE[withE.length - 1], mo = dGap(a.visit, b.visit) / 30.44
      if (mo >= 1) {
        const v = (b.egfr - a.egfr) / mo * 12
        slope = { v, mo: Math.round(mo) }
        if (prog === 'pre' && mo >= 10) {
          const lim = isDM ? -6 : -4
          if (v > lim) alerts.push({ t: '獎勵', m: 'eGFR 年變化 ' + v.toFixed(1) + ' ml/min/1.73m²,優於' + (isDM ? '糖尿病人 -6' : '非糖尿病人 -4') + ' 的門檻,可評估 ' + (['G5'].indexOf(baseStage) >= 0 ? 'P3407C 3,000 點' : 'P3406C 1,500 點') })
        }
      }
    }

    const p = pool(last, lab, C.date, C.labWin)
    const mr = missingReq(p, prog, isDM, !!lab)
    const miss = mr.miss, unk = mr.unk
    const inds = indicators(p, prog, isDM)
    const labGap = (lab && lab.date) ? Math.abs(dGap(lab.date, C.date)) : null
    const labOk = labGap != null && labGap <= C.labWin
    if (!lab) why.push('無檢驗報告匯入,無法完整核對必要項目')
    else if (!labOk) why.push('最近檢驗 ' + roc(lab.date) + ' 距門診 ' + labGap + ' 天,超出 ±' + C.labWin + ' 天')

    const openEp = recsAll.filter(r => r.src === 'case' && r.closed === false && r.nextDue).sort((a, b) => (b.enroll || 0) - (a.enroll || 0))[0] || null
    const nextApp = (last.visit && need) ? addD(last.visit, need) : null
    const nextDue = openEp ? openEp.nextDue : null
    if (nextDue) {
      const diff = nextApp ? dGap(nextApp, nextDue) : null
      why.push('登錄簿下次評估日 ' + roc(nextDue) + (nextApp ? '(工作台推算 ' + roc(nextApp) + ')' : ''))
      if (diff != null && Math.abs(diff) > 14) alerts.push({ t: '核對', m: '登錄簿下次評估日 ' + roc(nextDue) + ' 與工作台推算 ' + roc(nextApp) + ' 相差 ' + Math.abs(diff) + ' 天;請核對登錄簿的最後衛教日是否已更新' })
    }
    if (!isDM && lab && lab.v.a1c != null && lab.v.a1c >= 6.5 && prog === 'early')
      alerts.push({ t: '核對', m: 'HbA1c ' + lab.v.a1c + '% ≥ 6.5 但登錄簿未標糖尿病;若已確診 DM,Early-CKD 追蹤應改 P7001C(合併 DM,≥' + C.dmGap + ' 天)並增列 HbA1c' })
    const openRow = recsAll.filter(r => r.src === 'case' && r.closed === false).sort((a, b) => (b.enroll || 0) - (a.enroll || 0))[0] || null
    const caseDoctor = openRow ? String(openRow.doctor || '').trim() : ''
    if (openEps.some(r => r.prog === 'pre') && openEps.some(r => r.prog === 'early' && !(r.cat === 'DKD' || /^P70/.test(r.code || ''))))
      alerts.push({ t: '核對', m: '登錄簿同時有 Early-CKD 與 Pre-ESRD 開放中的收案段;依 Q44 同一個案不得同時在兩方案收案,請結案其中一段' })
    if (todayClinic && !todayClinic.manual && todayClinic.doctor && caseDoctor && todayClinic.doctor.trim() !== caseDoctor && !deptMatch(todayClinic.dept, C.dept))
      alerts.push({ t: '他科', m: '本次掛 ' + (todayClinic.dept || '他科') + ' ' + todayClinic.doctor + ',非登錄簿收案醫師 ' + caseDoctor + ';追蹤費須由方案醫師申報,請先與收案醫師確認' })
    else if (todayClinic && !todayClinic.manual && todayClinic.doctor && caseDoctor && todayClinic.doctor.trim() !== caseDoctor)
      alerts.push({ t: '注意', m: '本次掛 ' + todayClinic.doctor + ',登錄簿收案醫師為 ' + caseDoctor + '(Early-CKD 同年度追蹤換醫師依 Q22 影響醫師獎勵)' })
    return { mrn, p: todayClinic, last, recs, prog, isDM, egfr, src, mdrd, stage, upcr, uacr, lab, labOk, labGap, nextDue, nextApp, caseDoctor,
      lastCode: last.code || null, lastType: last.ctype || null,
      gap, need, code, status, why, nYear, n12, tenure, enroll: enrollDate, ann, alerts, slope, recon,
      miss, unk, bed: mr.bed, ord: mr.ord, inds, age, isNew }
  }

  const caseIdx = indexBy(S.cases)
  const hasOpenEpisode = mrn => (caseIdx.get(mrn) || []).some(r => r.src === 'case' && r.closed === false)
  const alive = S.clinic.filter(ALIVE).concat(S.manual)
  const dsel = C.date ? iso(C.date) : null
  const dsel2 = doctorSel
  const inDept = p => p.manual || deptMatch(p.dept, C.dept)
  const otherSess = dsel2.indexOf(OTHER_SESSION) === 0
  const oSub = otherSess ? dsel2.split('|') : [], oDept = oSub[1] || '', oDoc = oSub[2] || ''
  const sameDay = p => (!p.date || !dsel || iso(p.date) === dsel)
  const inDeptToday = otherSess ? new Set(alive.filter(p => sameDay(p) && inDept(p)).map(p => p.mrn)) : null
  const live = alive.filter(p => sameDay(p) &&
    (p.manual || (otherSess ? (!inDept(p) && !inDeptToday.has(p.mrn) && hasOpenEpisode(p.mrn) && (!oSub[1] && !oSub[2] || ((p.dept || '') === oDept && (p.doctor || '').trim() === oDoc)))
      : (!dsel2 || (p.doctor || '').trim() === dsel2))))
  const undated = live.filter(p => !p.date).length
  const list = (otherSess ? live.slice() : live.filter(inDept)).sort((a, b) => (inDept(a) ? 0 : 1) - (inDept(b) ? 0 : 1))
  const deptInfo = { total: live.length, matched: list.length, filter: C.dept, undated,
    allDates: [...new Set(alive.filter(p => p.date).map(p => iso(p.date)))].sort(),
    selDate: dsel,
    depts: [...new Set(live.map(p => (p.dept || '').trim()).filter(Boolean))] }
  const A = [], B = [], seen = new Set()
  for (const p of list) {
    if (seen.has(p.mrn)) continue
    const e = evalCase(p.mrn, p)
    if (e) { seen.add(p.mrn); e.otherDept = !inDept(p); A.push(e); continue }
    if (!inDept(p)) continue
    seen.add(p.mrn)
    const closed = closedMap[p.mrn] || null
    const lab = mergedLab(p.mrn)
    const age = p.age != null ? p.age : (p.birth ? Math.floor(dGap(p.birth, C.date) / 365.25) : null)
    const sexF = /女|F/.test(p.sex || '')
    const ageOf = k => (lab && lab.dateOf && lab.dateOf[k]) ? Math.abs(dGap(lab.dateOf[k], C.date)) : null
    const freshB = (k, days) => lab && lab.v[k] != null && (ageOf(k) == null || ageOf(k) <= days)
    const stale = []
    if (lab && lab.v.egfr != null && !freshB('egfr', 90)) stale.push('eGFR ' + roc(lab.dateOf.egfr) + '(逾 3 個月)')
    if (lab && lab.v.upcr != null && !freshB('upcr', 180)) stale.push('UPCR ' + roc(lab.dateOf.upcr) + '(逾 6 個月)')
    if (lab && lab.v.uacr != null && !freshB('uacr', 180)) stale.push('UACR ' + roc(lab.dateOf.uacr) + '(逾 6 個月)')
    let egfr = freshB('egfr', 90) ? lab.v.egfr : null, from = '報告 eGFR'
    if (egfr == null && lab && freshB('cr', 90) && age) { egfr = ckdEpi(lab.v.cr, age, sexF); from = '由血清 Cr ' + lab.v.cr + ' 以 CKD-EPI 推算' }
    const upcr = freshB('upcr', 180) ? lab.v.upcr : null
    const uacr = freshB('uacr', 180) ? lab.v.uacr : null
    const stage = stageOf(egfr)
    let verdict, code = null, why = [], missB = { miss: [], unk: [], bed: [], ord: [] }
    const bigProt = meets(lab, 'upcr', 1000, true)
    const isDMb = !!p.pDM || dmSet.has(p.mrn)
    const protU = meets(lab, 'upcr', 150, false), protA = meets(lab, 'uacr', 30, false)
    const earlyProt = isDMb ? (protU || protA) : protU

    if (egfr == null && upcr == null && uacr == null) {
      verdict = 'nodata'
      why.push(lab ? '有 ' + lab.src + ' 張報告(' + (lab.kinds.join('+') || '檢驗') + ')但無 eGFR / 血清 Cr / 尿蛋白' : '近期無檢驗報告,建議先開單')
      missB.ord = ['血清 Cr(eGFR)', isDMb ? 'UPCR 或 UACR' : 'UPCR']
    } else if ((egfr != null && egfr < 45) || bigProt) {
      verdict = 'pre'; code = 'P3402C 1,200 點'
      if (egfr != null && egfr < 15) why.push('eGFR ' + egfr.toFixed(1) + ' → Stage 5,符合 Pre-ESRD 收案條件 (3)')
      else if (egfr != null && egfr < 30) why.push('eGFR ' + egfr.toFixed(1) + ' → Stage 4,符合 Pre-ESRD 收案條件 (2)')
      else if (egfr != null && egfr < 45) why.push('eGFR ' + egfr.toFixed(1) + ' → Stage 3b,符合 Pre-ESRD 收案條件 (1)')
      if (bigProt) why.push('UPCR ' + upcr + ' mg/gm > 1,000,符合收案條件 (4) 明顯蛋白尿,不限 Stage')
      why.push('收案須當次主診斷為 N18.3 / N18.4 / N18.5 或 N049,且院內(或轉入前他院)須有 3 個月以上腎功能異常病史')
    } else if (egfr != null && egfr >= 45 && egfr < 60) {
      verdict = 'early'; code = 'P4301C 200 點'
      why.push('eGFR ' + egfr.toFixed(1) + ' → Stage 3a(45~59.9),符合初期慢性腎臟病收案,此期不需併蛋白尿')
    } else if (egfr != null && egfr >= 60) {
      const st = egfr >= 90 ? 'Stage 1' : 'Stage 2'
      if (earlyProt) {
        verdict = 'early'; code = 'P4301C 200 點'
        why.push('eGFR ' + egfr.toFixed(1) + ' → ' + st + ',併 ' + (protU ? 'UPCR ' + upcr + ' ≥150' : 'UACR ' + uacr + ' ≥30(糖尿病人適用)') + ' mg/gm,符合初期慢性腎臟病收案')
      } else if (!isDMb && protA && upcr == null) {
        verdict = 'check'
        why.push('eGFR ' + egfr.toFixed(1) + ' → ' + st + ';UACR ' + uacr + ' ≥30 但登錄簿/清單未標糖尿病 —— VPN 的 UPCR 是必填欄位(Q30),非糖尿病人須 eGFR + UPCR≥150(Q36),請加驗 UPCR')
        if (lab && lab.v.a1c != null && lab.v.a1c >= 6.5) why.push('HbA1c ' + lab.v.a1c + '% ≥ 6.5:若病人已確診糖尿病,VPN「伴隨疾病」勾糖尿病後即可以 UACR ≥30 收案,不必加驗 UPCR')
        missB.ord = ['UPCR']
      } else if (upcr == null && uacr == null) {
        verdict = 'check'
        missB.ord = [isDMb ? 'UPCR 或 UACR' : 'UPCR']
        why.push('eGFR ' + egfr.toFixed(1) + ' → ' + st + ';此期須併 ' + (isDMb ? 'UPCR ≥150 或 UACR ≥30' : 'UPCR ≥150(非糖尿病人不可用 UACR)') + ' mg/gm 才符合收案,建議加驗尿液')
      } else {
        verdict = 'no'
        why.push('eGFR ' + egfr.toFixed(1) + ' 且 ' + (upcr != null ? 'UPCR ' + qv(lab, 'upcr') : 'UACR ' + qv(lab, 'uacr')) + ' 未達 ' + (upcr != null ? '150' : '30') + ' mg/gm,目前不符收案')
      }
    } else {
      verdict = 'check'
      why.push('只有尿液檢驗、無血清腎功能;' + (upcr != null ? 'UPCR ' + qv(lab, 'upcr') : 'UACR ' + qv(lab, 'uacr')) + ' mg/gm,建議加驗血清 Cr')
      missB.ord = ['血清 Cr(eGFR)']
    }
    if (verdict === 'pre' || verdict === 'early') {
      const labGapB = (lab && lab.date) ? Math.abs(dGap(lab.date, C.date)) : null
      if (verdict === 'pre' && labGapB != null && labGapB > 90) why.push('檢驗報告距就醫日 ' + labGapB + ' 天,超出前後 3 個月,不符 P3402C 申報規定')
      if (verdict === 'early') {
        why.push('須收案前 90 天內曾於本院所就醫(不限科別或醫師、主次診斷不限;健檢後看報告當次亦可),新收案當次以「慢性腎臟疾病」為主診斷申報')
        if (labGapB != null && labGapB > 90)
          why.push('檢驗報告距就醫日 ' + labGapB + ' 天;依 Q41 新收案 UPCR/UACR 可採計收案日前 6 個月最新值' +
            (labGapB > 180 ? ',此份已超過,請重驗' : '、eGFR 僅採計前後 3 個月,若 eGFR 取自此份請重驗'))
      }
      if (verdict === 'early') why.push('申報 P4301C／P4302C／P4303C 時,門診點數清單案件分類填「E1」、特定治療項目代號(一)填「EB」(Q7)')
      missB = missingReq(pool(null, lab, C.date, C.labWin), verdict, !!p.pDM, !!lab)
      if (p.pDM) why.push('已在糖尿病方案(' + p.pDM + ');若同時收案,追蹤須以 P7001C 於同一次就診完成兩項')
    }
    const noEn = hooks.noEnrollOf(p.mrn, C.date)
    if (noEn) {
      why.unshift('個管標記不予收案(' + (noEn.at || '') + (noEn.doctor ? ' · ' + noEn.doctor : '') + '):' +
        (noEn.reason || '') + (noEn.note ? ' — ' + noEn.note : '') +
        (noEn.until ? ';暫緩至 ' + noEn.until : ';長期排除,可於個案紀錄解除'))
    }
    const ck = closed ? closeKind(closed.reason) : null
    if (closed) {
      const head = '曾收案(' + (closed.prog === 'pre' ? 'Pre-ESRD' : 'Early-CKD') + '),已於 ' + roc(closed.at) +
        (closed.code ? ' 申報 ' + closed.code : '') + ' 結案' + (closed.reason ? '(' + closed.reason + ')' : '')
      if (ck === 'dialysis') { verdict = 'no'; code = null; why.unshift(head + ';已進入透析,不適用 CKD 收案方案') }
      else if (ck === 'dead') { verdict = 'no'; code = null; why.unshift(head + ';請核對病人身分,登錄簿記為死亡結案') }
      else if (ck === 'transfer') why.unshift(head + ';曾轉他院照護,收案前務必以 VPN 確認他院是否仍在收案')
      else why.unshift(head + ';如今符合條件可重收案(登錄簿會標重收案 Y)')
    }
    if (S.billing.length) {
      const bh = S.billing.filter(b => b.mrn === p.mrn).sort((a, b) => b.visit - a.visit)
      if (bh.length) why.push('歷史入帳 ' + bh.length + ' 筆,最近 ' + bh[0].code + '(' + bh[0].ctype + ')於 ' + roc(bh[0].visit))
    }
    if (stale.length) why.push('較舊的檢驗未採計(Q41 新收案採計期限):' + stale.join('、') + ' —— 請重驗')
    B.push({ p, lab, egfr, from, upcr, uacr, stage, verdict, code, why, age, closed: !!closed, closeKind: ck, closeInfo: closed, noEn,
      enrollFix: enrollFixMap[p.mrn] || null,
      miss: missB.miss, unk: missB.unk, bed: missB.bed, ord: missB.ord })
  }

  let AUD = []
  if (opts.withAudit) {
    const clinicIdx = indexBy(S.clinic)
    AUD = Object.keys(byMrn).map(m => evalCase(m, (clinicIdx.get(m) || [])[0] || null)).filter(Boolean)
  }
  const rank = { ok: 0, over: 1, cap: 2, wait: 3, none: 4 }
  A.sort((a, b) => (rank[a.status] - rank[b.status]) || String(a.p.no || '').localeCompare(String(b.p.no || '')))
  const rank2 = { pre: 0, early: 1, check: 2, nodata: 3, no: 4 }
  B.sort((a, b) => ((a.noEn ? 1 : 0) - (b.noEn ? 1 : 0)) ||
    (rank2[a.verdict] - rank2[b.verdict]) || String(a.p.no || '').localeCompare(String(b.p.no || '')))
  return { A, B, AUD, C, spanFrom, deptInfo }
}

/* ============================================================
   判定句（app.js:1111-1182）：一句結論 →「今天到底能不能 key、key 什麼」
   ============================================================ */
export function vdVpn(ext) {
  if (!ext) return { st: 'none', ext: null }
  if (ext.result === '已於他院收案') return { st: 'pos', ext }
  if (ext.result === '未於他院收案') return { st: 'neg', ext }
  return { st: 'pend', ext }
}
/* 已收案（A / 稽核）：結論 = 今日可否 key 追蹤費 */
export function verdictA(r, C) {
  const pname = r.prog === 'pre' ? 'Pre-ESRD' : 'Early-CKD'
  if (r.dkd) return { tone: 'n', head: 'DKD 方案收案 — 不適用 Early-CKD 追蹤碼', sub: '由 DKD 方案(P70xC)追蹤;本工作台不評估追蹤與缺項' + (r.caseDoctor ? ' · 收案醫師 ' + r.caseDoctor : ''), act: null }
  const nMiss = (r.ord || []).length + (HOSP.bedside ? (r.bed || []).length : 0)
  let tone, head, act = null
  if (r.status === 'ok' || r.status === 'over') {
    if (nMiss) { tone = 'q'; head = '缺 ' + nMiss + ' 項檢驗,補齊才可 key ' + r.code }
    else { tone = 'y'; head = '今日可 key ' + r.code + (HOSP.bedside ? '' : '(診間登錄血壓/身高/體重後)') }
    if (r.status === 'over') head += '(已逾 ' + C.over + ' 天未追蹤)'
  } else if (r.status === 'wait') {
    tone = 'n'; head = '今日不可 key,最快 ' + roc(addD(r.last.visit, r.need))
  } else if (r.status === 'cap') {
    tone = 'n'; head = '今日不可 key,年度已達上限'
  } else { tone = 'q'; head = '資料不足,無法判定' }
  const sub = pname + ' 已收案' + (r.last && r.last.enroll ? ' ' + roc(r.last.enroll) : '') +
    (r.gap != null ? ' · 距上次 ' + r.gap + ' 天(需 ' + r.need + ')' : '')
  if (nMiss) act = { cls: 'miss', lab: (r.ord || []).length ? '須開單' : '診間登錄', txt: ((r.ord || []).length ? r.ord : r.bed).join('、') }
  else if (r.ann && r.ann.ok) act = { cls: '', lab: '另可 key', txt: r.ann.code + ' 年度評估' }
  return { tone, head, sub, act }
}
/* 未收案（B）：結論 = 今日能不能收、收之前還缺什麼；ext = 外院查核紀錄（階段 3） */
export function verdictB(r, ext) {
  const mrn = (r.p && r.p.mrn) || '', v = vdVpn(ext), qual = (r.verdict === 'pre' || r.verdict === 'early')
  const pname = r.verdict === 'pre' ? 'Pre-ESRD' : 'Early-CKD'
  const nMiss = (r.ord || []).length + (HOSP.bedside ? (r.bed || []).length : 0)
  let tone, head, act = null
  const ci = r.closeInfo || null
  const closeTxt = ci ? '曾收案 ' + (ci.prog === 'pre' ? 'Pre-ESRD' : 'Early-CKD') + ',於 ' + roc(ci.at) + ' 結案' + (ci.reason ? '(' + ci.reason + ')' : '') : ''
  if (ci && r.closeKind === 'dialysis') return { tone: 'n', head: '已結案(透析),不適用 CKD 收案', sub: closeTxt, act: null }
  if (ci && r.closeKind === 'dead') return { tone: 'n', head: '登錄簿記為死亡結案,請核對身分', sub: closeTxt, act: null }
  if (r.noEn) {
    return { tone: 'off', head: '不予收案 · ' + (r.noEn.reason || ''),
      sub: (r.noEn.at || '') + (r.noEn.doctor ? ' · ' + r.noEn.doctor : '') + (r.noEn.until ? ' · 暫緩至 ' + r.noEn.until : ' · 長期排除') + (r.noEn.note ? ' · ' + r.noEn.note : ''),
      act: { cls: 'act', rec: mrn, lab: '個管', txt: '點此查看或解除不予收案標記' } }
  }
  if (v.st === 'pos') {
    tone = 'n'; head = '已於他院收案,本院不得重複收案'
  } else if (!qual) {
    tone = 'q'
    head = r.verdict === 'check' ? '檢驗不足,尚無法判定' : r.verdict === 'nodata' ? '無檢驗資料,建議先開單' : '目前不符收案條件'
    if (r.verdict === 'no') tone = 'n'
  } else if (v.st === 'neg') {
    if (nMiss) { tone = 'q'; head = '缺 ' + nMiss + ' 項,補齊即可新收 ' + r.code }
    else { tone = 'y'; head = '可新收案,key ' + r.code }
  } else if (v.st === 'pend') {
    tone = 'q'; head = 'VPN 查詢中,確認後才可收案'
  } else {
    tone = 'q'; head = '先查 VPN,無他院收案即可新收 ' + r.code
  }
  if (ci && qual && v.st !== 'pos') head = head.replace(/新收 /, '重收 ') + (r.closeKind === 'transfer' ? '(曾轉他院,VPN 必查)' : '(重收案)')
  const sub = (r.egfr != null ? 'eGFR ' + r.egfr.toFixed(1) + (r.stage ? ' ' + r.stage.replace('G', 'Stage ') : '') + ' · ' : '') +
    (ci ? closeTxt : (qual ? '符合 ' + pname + ' 收案條件 · 本院尚未收案' : '本院尚未收案'))
  if (qual && v.st !== 'pos') {
    if (v.st === 'none') act = { cls: 'act', vpn: mrn, lab: '個管', txt: '收案前請至健保 VPN 查詢是否已於他院收案 — 點此記錄查核結果' }
    else if (v.st === 'pend') act = { cls: 'act pend', vpn: mrn, lab: 'VPN', txt: '查詢中(' + (v.ext.at || '') + ')— 點此更新結果' }
    else if (nMiss) act = { cls: 'miss', lab: (r.ord || []).length ? '須開單' : '診間登錄', txt: ((r.ord || []).length ? r.ord : r.bed).join('、') }
  }
  return { tone, head, sub, act }
}

/* 統計列（renderA/renderB 的 tally 定義） */
export const A_FILTERS = {
  all: () => true, pre: x => x.prog === 'pre', early: x => x.prog === 'early',
  due: x => x.status === 'ok' || x.status === 'over', wait: x => x.status === 'wait',
  ann: x => x.ann.ok, miss: x => x.miss.length > 0, alert: x => x.alerts.length > 0,
}
export const B_FILTERS = {
  all: () => true,
  pre: x => x.verdict === 'pre' && !x.noEn, early: x => x.verdict === 'early' && !x.noEn,
  check: x => x.verdict === 'check' && !x.noEn, nodata: x => x.verdict === 'nodata' && !x.noEn,
  no: x => x.verdict === 'no' && !x.noEn,
  noen: x => !!x.noEn,
  closed: x => !!x.closed,
  ord: x => (x.verdict === 'pre' || x.verdict === 'early') && !x.noEn && (x.ord || []).length > 0,
}
export const STATUS_BADGE = { ok: ['early', '可申報追蹤'], over: ['pre', '逾期 應追蹤'], cap: ['none', '年度已達上限'], wait: ['wait', '未滿間隔'], none: ['none', '資料不足'], dkd: ['none', 'DKD 收案 · 不適用'] }
export const VERDICT_BADGE = { pre: ['pre', '符合 Pre-ESRD'], early: ['early', '符合 Early-CKD'], check: ['wait', '待補檢驗'], nodata: ['none', '無檢驗資料'], no: ['none', '目前不符'] }
