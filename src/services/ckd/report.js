/* ============================================================
   門診 CKD — 月報儀表板（交接包 src/report.js:9-88 buildReport 搬 ESM；階段 5）
   以判讀日為基準：收案現況（方案 × 分期、本月新收／結案與原因）、追蹤品質（準時率、逾期）、年度評估、
   Early-CKD 完整追蹤率（健保門檻）、檢驗完整率、獎勵候選、透析準備、本月入帳。

   ⚠️ 規則零改動：九張卡的門檻（180／365／90／180 天、P3404C／P7002C／P4302C／P7001C、
      Q4 新收排除與 need 規則、退場線 20%）、closeKind 分類、billN 用列數而各碼用 Σn 皆照原版。
   刻意差異（使用者拍板，2026-09-16）：
     - 「透析準備」卡片門檻改讀 settings.rrtEgfr（原版 report.js:42 寫死 20，與管線畫面對不上）；回應帶 rrtEgfr
     - grace 由 settings.recallGrace 注入（原版讀 localStorage，每台電腦不同值）
     - 召回 tally 由呼叫端（路由）以 buildRecall 算一次後傳入（原版 report.js:74 會再跑一次召回）
   ⚠️ data 是 loadDataset 的共用快取物件 —— 本檔只讀不改。
   ============================================================ */
import { iso, roc, dGap, DAY } from './parsers.js'
import { closeKind } from './engine.js'

/** 結案分類中文（report.js:87 逐字） */
export const CLOSE_TW = { dead: '死亡', dialysis: '透析', transfer: '轉院/轉診', lapse: '逾一年未照護/失聯', other: '其他' }

export const monthOf = (d) => (d ? iso(d).slice(0, 7) : '')

function indexBy(arr) {
  const map = new Map()
  for (const r of (arr || [])) { let a = map.get(r.mrn); if (!a) map.set(r.mrn, a = []); a.push(r) }
  return map
}

/**
 * @param {object} data loadDataset() 結果（只讀）
 * @param {object} R    analyze(..., { withAudit: true }) 結果
 * @param {object} C    makeCfg() 結果（判讀日）
 * @param {object} opts { ym, grace, rrtEgfr, recallTally }
 */
export function buildReport(data, R, C, { ym: ymIn = '', grace = 30, rrtEgfr = 20, recallTally = null } = {}) {
  const today = C.date, AUD = R.AUD || []
  const ym = ymIn || monthOf(today)
  const y12 = new Date(+today - 365 * DAY)
  const pre = AUD.filter((x) => x.prog === 'pre'), early = AUD.filter((x) => x.prog !== 'pre')
  const dm = AUD.filter((x) => x.isDM)
  const stageCnt = {}; AUD.forEach((x) => { const k = x.stage || '未知'; stageCnt[k] = (stageCnt[k] || 0) + 1 })
  /* 登錄簿：本月新收、本月結案（原因） */
  const caseRows = (data.cases || []).filter((c) => c.src === 'case')
  const newM = new Set(), newY = new Set(), closeM = {}, closeMn = new Set()
  caseRows.forEach((c) => {
    if (c.ctype === '新收案' && c.enroll) {
      if (monthOf(c.enroll) === ym) newM.add(c.mrn)
      if (+c.enroll >= +y12 && +c.enroll <= +today) newY.add(c.mrn)
    }
    if (c.ctype === '結案' && c.visit && monthOf(c.visit) === ym) {
      closeMn.add(c.mrn)
      const k = closeKind(c.reason)
      closeM[k] = (closeM[k] || 0) + 1
    }
  })
  /* 追蹤品質（180／365 為寫死門檻，不讀 cfg.over） */
  const onTime = AUD.filter((x) => x.gap != null && x.need && x.gap <= x.need + grace).length
  const over180 = AUD.filter((x) => x.gap != null && x.gap > 180).length
  const over365 = AUD.filter((x) => x.gap != null && x.gap > 365).length
  const noGap = AUD.filter((x) => x.gap == null).length
  /* 年度評估（Pre-ESRD P3404C / DKD P7002C）：收案滿一年者，近 12 月已申報比例 */
  const billIdx = {}; (data.billing || []).forEach((b) => { (billIdx[b.mrn] = billIdx[b.mrn] || []).push(b) })
  const annDue = AUD.filter((x) => x.tenure != null && x.tenure >= 365 && (x.prog === 'pre' || x.isDM))
  const annDone = annDue.filter((x) => (billIdx[x.mrn] || []).some((b) => (b.code === 'P3404C' || b.code === 'P7002C') && b.visit && +b.visit >= +y12 && +b.visit <= +today)).length
  const annReady = AUD.filter((x) => x.ann && x.ann.ok).length
  /* 檢驗完整率 */
  const labsIdx = indexBy(data.labs)
  const labOk = AUD.filter((x) => x.labOk).length
  const eg90 = AUD.filter((x) => x.lab && x.lab.v && x.lab.v.egfr != null && x.lab.date && dGap(x.lab.date, today) <= 90).length
  const prot180 = AUD.filter((x) => (labsIdx.get(x.mrn) || []).some((l) => l.date && dGap(l.date, today) <= 180 && l.v && (l.v.upcr != null || l.v.uacr != null))).length
  /* 獎勵候選 */
  const reward = AUD.filter((x) => (x.alerts || []).some((a) => a.t === '獎勵')).length
  const rewardCodes = {}
  AUD.forEach((x) => (x.alerts || []).forEach((a) => {
    if (a.t !== '獎勵') return
    const m = a.m.match(/P340[6-9]C/)
    const k = m ? m[0] : '其他'
    rewardCodes[k] = (rewardCodes[k] || 0) + 1
  }))
  /* 透析準備（門檻與管線共用 settings.rrtEgfr） */
  const sdmSet = new Set(), accSet = new Set()
  for (const r of (data.records || [])) {
    if (r.deleted) continue
    if (r.type === 'sdm') sdmSet.add(r.mrn)
    else if (r.type === 'access') accSet.add(r.mrn)
  }
  const low = AUD.filter((x) => x.egfr != null && x.egfr < rrtEgfr)
  const hasSdm = low.filter((x) => sdmSet.has(x.mrn)).length
  const hasAcc = low.filter((x) => accSet.has(x.mrn)).length
  /* 本月入帳 */
  const billM = (data.billing || []).filter((b) => b.visit && monthOf(b.visit) === ym)
  const billBy = {}
  billM.forEach((b) => {
    const k = b.code
    billBy[k] = billBy[k] || { n: 0, pts: 0, people: new Set(), name: b.codeName || '' }
    billBy[k].n += (b.n || 1)
    billBy[k].pts += (b.price || 0) * (b.n || 1)
    billBy[k].people.add(b.mrn)
  })
  const billRows = Object.keys(billBy).sort().map((k) => ({ code: k, name: billBy[k].name, n: billBy[k].n, pts: billBy[k].pts, people: billBy[k].people.size }))
  const billTot = billRows.reduce((a, r) => a + r.pts, 0)
  /* Early-CKD 完整追蹤率（方案六(二)2）：分母排除 Pre、DKD-only 與第四季新收案 */
  const yNow = today.getFullYear(), q = (d) => Math.floor(d.getMonth() / 3) + 1
  const earlyOpen = AUD.filter((x) => x.prog !== 'pre' && !x.dkd)
  const kpiRows = [], byDoc = {}
  earlyOpen.forEach((x) => {
    const en = x.enroll ? new Date(x.enroll) : null
    const newThisYear = !!(en && en.getFullYear() === yNow)
    if (newThisYear && q(en) === 4) return                              // 第四季新收案排除
    const need = !newThisYear ? 2 : (q(en) === 1 ? 2 : 1)
    const done = (billIdx[x.mrn] || []).filter((b) => b.code === 'P4302C' && b.visit && b.visit.getFullYear() === yNow).length
    const ok = done >= need
    const doc = x.caseDoctor || '(未註明)'
    ;(byDoc[doc] = byDoc[doc] || { doc, n: 0, ok: 0 }).n++
    if (ok) byDoc[doc].ok++
    kpiRows.push({ mrn: x.mrn, need, done, ok, doc })
  })
  const kpi = { n: kpiRows.length, ok: kpiRows.filter((r) => r.ok).length, docs: Object.values(byDoc).sort((a, b) => b.n - a.n) }
  const lastYear = earlyOpen.filter((x) => x.enroll && new Date(x.enroll).getFullYear() < yNow)
  const lastYearOk = lastYear.filter((x) => (billIdx[x.mrn] || []).some((b) => (b.code === 'P4302C' || b.code === 'P7001C') && b.visit && b.visit.getFullYear() === yNow)).length
  const billYear = (data.billing || []).some((b) => b.visit && b.visit.getFullYear() === yNow)
  const bv = (data.billing || []).filter((b) => b.visit && b.visit.getFullYear() === yNow).map((b) => +b.visit)
  const billSpan = bv.length ? roc(new Date(Math.min.apply(null, bv))) + '~' + roc(new Date(Math.max.apply(null, bv))) : ''
  return {
    ym, today, enrolled: AUD.length, pre: pre.length, early: early.length, dm: dm.length, stageCnt,
    newM: newM.size, newY: newY.size, closeM, closeMn: closeMn.size, closeLabels: CLOSE_TW,
    onTime, over180, over365, noGap, grace,
    annDue: annDue.length, annDone, annReady,
    labOk, eg90, prot180, reward, rewardCodes,
    rrtEgfr, low: low.length, hasSdm, hasAcc,
    billRows, billTot, billN: billM.length, billPeople: new Set(billM.map((b) => b.mrn)).size,
    kpi, lastYearN: lastYear.length, lastYearOk, billYear, billSpan, yNow,
    recall: recallTally || null,
  }
}
