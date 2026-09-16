/* ============================================================
   門診 CKD — 近日異常檢驗（交接包 src/labalert.js:14-74 搬 ESM；階段 5）
   0204 每日匯入後，掃所有已收案者在近 N 天內的報告：危急值、腎功能急降、蛋白尿惡化、
   首次跨入 Stage 5 / eGFR < 20（透析準備觸發）。不限明天門診。

   ⚠️ 規則零改動：九條單值規則的門檻與文字、eGFR 前值取樣窗（30～400 天，以原始碼為準）、
      UPCR 三條件（含 ≥1000）、去重（同人同規則只留近 N 天內最新一筆）、排序 皆照原版。
   差異：
     - 「已處理」改存 DB（ckd_alert_done），跨使用者共享（原版 localStorage.ckdAlertDone 每台電腦各自為政）
     - AUD／B 的姓名查詢先建 Map（原版在迴圈內 find，母體近五千人時是 O(n²)）
   ⚠️ data 是 loadDataset 的共用快取物件 —— 本檔只讀不改。
   ============================================================ */
import { iso, DAY } from './parsers.js'

/* 規則：回傳 {sev:"crit"|"warn", t:標題, m:說明}；每個規則以 (mrn|報告日|規則碼) 當已處理鍵（labalert.js:14-24 逐字） */
export const ALERT_RULES = [
  { id: 'k6', key: 'k', sev: 'crit', f: (v) => v >= 6.0, t: 'K ≥ 6.0 高血鉀(危急)', m: (v) => 'K ' + v + ' mmol/L,請立即通知醫師並聯絡病人' },
  { id: 'k55', key: 'k', sev: 'warn', f: (v) => v >= 5.5 && v < 6.0, t: 'K ≥ 5.5 高血鉀', m: (v) => 'K ' + v + ' mmol/L,檢視用藥(ACEI/ARB、保鉀利尿劑)與飲食' },
  { id: 'hb8', key: 'hb', sev: 'crit', f: (v) => v < 8, t: 'Hb < 8 重度貧血', m: (v) => 'Hb ' + v + ' g/dL,請通知醫師評估 ESA/鐵劑或輸血' },
  { id: 'hb10', key: 'hb', sev: 'warn', f: (v) => v >= 8 && v < 10, t: 'Hb < 10 貧血', m: (v) => 'Hb ' + v + ' g/dL,依 CKD 貧血處置流程追蹤鐵蛋白/TSAT' },
  { id: 'na', key: 'na', sev: 'crit', f: (v) => v < 130 || v > 150, t: 'Na 異常(< 130 或 > 150)', m: (v) => 'Na ' + v + ' mmol/L' },
  { id: 'p55', key: 'phos', sev: 'warn', f: (v) => v > 5.5, t: 'P > 5.5 高血磷', m: (v) => 'P ' + v + ' mg/dL,檢視磷結合劑與飲食' },
  { id: 'hco3', key: 'hco3', sev: 'warn', f: (v) => v < 18, t: 'HCO3 < 18 代謝性酸中毒', m: (v) => 'HCO3 ' + v + ' mmol/L' },
  { id: 'a1c9', key: 'a1c', sev: 'warn', f: (v) => v >= 9, t: 'HbA1c ≥ 9 血糖控制不佳', m: (v) => 'HbA1c ' + v + '%,與糖尿病照護團隊聯繫' },
  { id: 'upcr3', key: 'upcr', sev: 'warn', f: (v) => v >= 3000, t: 'UPCR ≥ 3,000 腎病症候群範圍蛋白尿', m: (v) => 'UPCR ' + v + ' mg/g' },
]

function indexBy(arr) {
  const map = new Map()
  for (const r of (arr || [])) { let a = map.get(r.mrn); if (!a) map.set(r.mrn, a = []); a.push(r) }
  return map
}

/**
 * @param {object} data     loadDataset() 結果（只讀）
 * @param {object} R        analyze(..., { withAudit: true }) 結果
 * @param {object} C        makeCfg() 結果（判讀日）
 * @param {Map}    doneMap  loadAlertDone() → Map(key → { done, doneBy })
 * @param {object} opts     { mrnSet?: Set<string>, win?: number }（win = settings.alertWin）
 * @returns {object[]} 已排序的異常列
 */
export function buildLabAlerts(data, R, C, doneMap, { mrnSet, win = 14 } = {}) {
  const today = C.date
  const since = +today - win * DAY
  const done = doneMap || new Map()
  const AUD = R.AUD || []
  const audBy = new Map()
  for (const x of AUD) if (!audBy.has(x.mrn)) audBy.set(x.mrn, x)
  const nameB = new Map()
  for (const r of (R.B || [])) if (r.p && r.p.mrn && !nameB.has(r.p.mrn)) nameB.set(r.p.mrn, r.p.name || '')
  const enrolled = mrnSet || new Set(AUD.map((x) => x.mrn))
  const labsIdx = indexBy(data.labs), casesIdx = indexBy(data.cases)
  const out = []
  enrolled.forEach((mrn) => {
    const labs = (labsIdx.get(mrn) || []).filter((l) => l.date && +l.date <= +today).sort((a, b) => a.date - b.date)
    if (!labs.length) return
    const recent = labs.filter((l) => +l.date >= since)
    if (!recent.length) return
    const aud = audBy.get(mrn) || null
    const name = (aud && (aud.p ? aud.p.name : (aud.last && aud.last.name))) || nameB.get(mrn) || ''
    const hits = []
    /* 單值規則：近 N 天內每份報告都看（依日期由舊到新，後者覆寫 → 同人同規則只留最新一筆） */
    const byRule = {}
    recent.forEach((l) => ALERT_RULES.forEach((r) => {
      const v = l.v && l.v[r.key]
      if (v == null || (l.q && l.q[r.key])) return            // 有定性符號(< >)一律略過
      if (r.f(+v)) byRule[r.id] = { rule: r, v: +v, date: l.date }
    }))
    Object.keys(byRule).forEach((id) => { const h = byRule[id]; hits.push({ id: h.rule.id, sev: h.rule.sev, t: h.rule.t, m: h.rule.m(h.v), date: h.date, v: h.v }) })
    /* eGFR 變化：近 N 天內最新 eGFR（必須來自檢驗報告）與前一個值（30~400 天前，含登錄簿基準）比 */
    const eg = labs.filter((l) => l.v && l.v.egfr != null && !(l.q && l.q.egfr)).map((l) => ({ t: +l.date, v: +l.v.egfr, src: 'lab' }))
    ;(casesIdx.get(mrn) || []).forEach((c) => { if (c.src === 'case' && c.egfr != null && c.visit) eg.push({ t: +c.visit, v: +c.egfr, src: 'case' }) })
    eg.sort((a, b) => a.t - b.t)
    const latest = eg.length && eg[eg.length - 1].t >= since && eg[eg.length - 1].src === 'lab' ? eg[eg.length - 1] : null
    if (latest) {
      const prev = eg.filter((p) => p.t < latest.t - 30 * DAY && p.t >= latest.t - 400 * DAY).slice(-1)[0] || null
      if (prev && prev.v > 0) {
        const drop = (prev.v - latest.v) / prev.v, days = Math.round((latest.t - prev.t) / DAY)
        if (drop >= 0.25 && prev.v - latest.v >= 5) {
          hits.push({ id: 'egfrdrop', sev: 'crit', t: 'eGFR 急降 ≥ 25%', m: 'eGFR ' + prev.v.toFixed(1) + ' → ' + latest.v.toFixed(1) + '(' + days + ' 天內降 ' + Math.round(drop * 100) + '%),排除 AKI 誘因(脫水、NSAID、顯影劑、感染)', date: new Date(latest.t), v: latest.v })
        } else if (drop >= 0.15 && prev.v - latest.v >= 5 && days <= 120) {
          hits.push({ id: 'egfrfast', sev: 'warn', t: 'eGFR 下降 ≥ 15%', m: 'eGFR ' + prev.v.toFixed(1) + ' → ' + latest.v.toFixed(1) + '(' + days + ' 天)', date: new Date(latest.t), v: latest.v })
        }
      }
      const before = eg.filter((p) => p.t < latest.t)
      const minBefore = before.length ? Math.min.apply(null, before.map((p) => p.v)) : null
      if (latest.v < 15 && (minBefore == null || minBefore >= 15)) {
        hits.push({ id: 'stage5', sev: 'crit', t: '首次 eGFR < 15(Stage 5)', m: 'eGFR ' + latest.v.toFixed(1) + ',啟動透析準備:SDM、血管通路、腎移植評估', date: new Date(latest.t), v: latest.v })
      } else if (latest.v < 20 && (minBefore == null || minBefore >= 20)) {
        hits.push({ id: 'egfr20', sev: 'warn', t: '首次 eGFR < 20', m: 'eGFR ' + latest.v.toFixed(1) + ',安排 RRT 共享決策(SDM)', date: new Date(latest.t), v: latest.v })
      }
    }
    /* 蛋白尿惡化：近 N 天內最新 UPCR 較前次升 ≥ 50%、絕對值升 ≥ 500 且 ≥ 1000（三條件同時成立） */
    const up = labs.filter((l) => l.v && l.v.upcr != null && !(l.q && l.q.upcr)).map((l) => ({ t: +l.date, v: +l.v.upcr }))
    if (up.length >= 2 && up[up.length - 1].t >= since) {
      const a = up[up.length - 2], b = up[up.length - 1]
      if (b.v >= a.v * 1.5 && b.v - a.v >= 500 && b.v >= 1000) {
        hits.push({ id: 'upcrup', sev: 'warn', t: 'UPCR 較前次升 ≥ 50%', m: 'UPCR ' + Math.round(a.v) + ' → ' + Math.round(b.v) + ' mg/g', date: new Date(b.t), v: b.v })
      }
    }
    hits.forEach((h) => {
      const key = mrn + '|' + iso(h.date) + '|' + h.id
      const d = done.get(key) || null
      out.push(Object.assign(h, { mrn, name, key, done: d ? d.done || null : null, doneBy: d ? d.doneBy || null : null, aud }))
    })
  })
  out.sort((a, b) => (a.sev === b.sev ? 0 : a.sev === 'crit' ? -1 : 1) || (b.date - a.date) || String(a.mrn).localeCompare(String(b.mrn)))
  return out
}

/* ---------- 已處理狀態（DB；原版 localStorage.ckdAlertDone） ---------- */
/** key = mrn|YYYY-MM-DD|ruleId */
export const ALERT_KEY_RE = /^[0-9A-Za-z-]+\|\d{4}-\d{2}-\d{2}\|[a-z0-9]+$/

export function loadAlertDone(db) {
  const map = new Map()
  for (const r of db.prepare(`SELECT key, done_at, done_by FROM ckd_alert_done`).all()) {
    map.set(r.key, { done: r.done_at || null, doneBy: safeJson(r.done_by) })
  }
  return map
}

/** done=false 即刪除該列（原版 delete d[key]）；回 { key, done, doneBy } */
export function setAlertDone(db, key, done, user) {
  const k = String(key || '')
  if (!ALERT_KEY_RE.test(k)) throw Object.assign(new Error('異常鍵格式不正確'), { status: 400 })
  if (!done) {
    db.prepare(`DELETE FROM ckd_alert_done WHERE key = ?`).run(k)
    return { key: k, done: null, doneBy: null }
  }
  const [mrn, reportDate, ruleId] = k.split('|')
  const doneAt = iso(new Date())
  const by = user ? { uid: user.uid || user.id || null, name: user.name || user.username || '' } : null
  db.prepare(`
    INSERT INTO ckd_alert_done (key, mrn, report_date, rule_id, done_at, done_by)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET done_at = excluded.done_at, done_by = excluded.done_by
  `).run(k, mrn, reportDate, ruleId, doneAt, by ? JSON.stringify(by) : null)
  return { key: k, done: doneAt, doneBy: by }
}

function safeJson(s) { try { return s ? JSON.parse(s) : null } catch { return null } }
