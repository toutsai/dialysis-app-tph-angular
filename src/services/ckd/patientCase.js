// 門診 CKD：病人彙整視窗用的單人資料（本站新增，非原版單機版功能；2026-09-20 使用者拍板）
// 判讀沿用 engine.js 的結果，這裡只做「挑出這個人」與「衛教時間軸合併」，不新增任何臨床規則。
import { analyze, makeCfg, OTHER_SESSION } from './engine.js'
import { iso } from './parsers.js'

/** 方案照護就診（新收案／追蹤／年度）依給付規定含個管衛教；P8101C 是一次性的「末期腎病治療方式衛教」 */
const EDU_CARE_CTYPES = { '新收案': 1, '追蹤': 1, '年度': 1 }

/**
 * 衛教時間軸（新→舊）。系統沒有單一的衛教登記處，合併三個來源（使用者 2026-09-20 同意）：
 *  1. 登錄簿（最後衛教日）／入帳／手動補登的方案照護就診 → kind 'care'
 *  2. 入帳的 P8101C 治療方式衛教 → kind 'p8101'
 *  3. 個案紀錄「追蹤紀錄」類別＝衛教 → kind 'note'（有內容與記錄者）
 * pcodeRows = pcodeTimeline().rows（visit 為 Date）；records = 該病人的個案紀錄（未刪除）。
 */
export function eduTimeline(pcodeRows, records) {
  const out = []
  /* 同一天「沒有 P 碼的登錄列」併進「有 P 碼的那一列」：登錄簿的新收案列沒有碼，入帳的 P3402C／P4301C 是同一次就診
     （pcodeTimeline 以 日期|碼 去重，碼不同併不起來）。兩列都有碼（例如同日追蹤＋年度）是兩筆申報，各留一列。 */
  const careByDate = new Map()
  for (const r of pcodeRows || []) {
    if (r.voided || !r.visit) continue
    const p8101 = r.ctype === '衛教'
    if (!p8101 && !EDU_CARE_CTYPES[r.ctype]) continue
    const date = iso(r.visit)
    const prev = p8101 ? null : careByDate.get(date)
    if (prev && (!prev.code || !r.code)) {
      if (!prev.code && r.code) { prev.code = r.code; prev.label = '方案照護（' + r.ctype + '）' }
      if (!prev.doctor && r.doctor) prev.doctor = r.doctor
      prev.src = [...new Set(prev.src.concat(r.src || []))]
      continue
    }
    const row = {
      date, kind: p8101 ? 'p8101' : 'care',
      label: p8101 ? '末期腎病治療方式衛教' : '方案照護（' + r.ctype + '）',
      code: r.code || '', doctor: r.doctor || '', src: (r.src || []).slice(), text: '', author: '', recordId: null,
    }
    if (!p8101 && !prev) careByDate.set(date, row)
    out.push(row)
  }
  for (const r of records || []) {
    if (r.type !== 'note' || r.cat !== '衛教' || r.deleted) continue
    out.push({
      date: r.at || '', kind: 'note', label: '個管衛教紀錄', code: '', doctor: '', src: ['個案紀錄'],
      text: r.content || '', author: r.author || (r.createdBy && r.createdBy.name) || '', recordId: r.id,
    })
  }
  out.sort((a, b) => String(b.date).localeCompare(String(a.date)))
  return out
}

/**
 * 登錄簿的收案段落（同人可多段：重收案、轉方案）。ckd_cases 是把每段攤成事件列，這裡依 編號＋收案日 收回成一段一列，新→舊。
 * 收案類別用登錄簿原文（Pre-ESRD／Early-CKD／DKD／AKD），不是引擎的 prog 二分。
 */
export function enrollEpisodes(cases, mrn) {
  const map = new Map()
  for (const c of cases || []) {
    if (c.mrn !== mrn || c.src !== 'case') continue
    const key = (c.serial || '') + '|' + (c.enroll ? iso(c.enroll) : '')
    if (map.has(key)) continue
    map.set(key, {
      serial: c.serial || '', enroll: c.enroll ? iso(c.enroll) : null, cat: c.cat || '', prog: c.prog || '', doctor: c.doctor || '',
      reenroll: !!c.reenroll, nextDue: c.nextDue ? iso(c.nextDue) : null,
      closed: !!c.closed, closeDate: c.closeDate ? iso(c.closeDate) : null, reason: c.reason || '',
    })
  }
  return [...map.values()].sort((a, b) => String(b.enroll || '').localeCompare(String(a.enroll || '')))
}

/**
 * 單一病人的判讀：
 *  - 判讀日有掛號且在診次清單內 → 直接用 A／B 區那一列（與使用者在清單上看到的一致）
 *  - 否則已收案者取稽核列（evalCase；不限當日門診）
 *  - 兩者皆無 → kind 'none'（未收案、判讀日也沒有本科掛號，無從評估收案）
 * 回傳 { kind, row, inSession, C }；row 是引擎原始列（呼叫端再 slim）。
 */
export function evalPatient(data, settings, hooks, mrn, dateStr) {
  const C = makeCfg(settings, dateStr)
  const R = analyze(data, C, { doctorSel: '', withAudit: true, auditMrn: mrn, hooks })
  const a = R.A.find((r) => r.mrn === mrn)
  if (a) return { kind: 'A', row: a, inSession: true, C }
  const b = R.B.find((r) => r.p && r.p.mrn === mrn)
  if (b) return { kind: 'B', row: b, inSession: true, C }
  /* 「他科掛號已收案」診次（settings.allA）：doctorSel='' 只跑本科清單，這些人要另外用 OTHER_SESSION 再跑一次，
     否則會落到稽核列——掛號列可能抓到別天的、也少了「他科」提醒（fresh-context 驗收 2026-09-20 抓到，真資料約 88 人／日） */
  if (C.allA && C.dept) { // 與 sessionGroups 產生「他科」診次的條件相同
    const o = analyze(data, C, { doctorSel: OTHER_SESSION, withAudit: false, hooks }).A.find((r) => r.mrn === mrn)
    if (o) return { kind: 'A', row: o, inSession: true, C }
  }
  const aud = R.AUD[0] || null
  if (aud) return { kind: 'A', row: aud, inSession: false, C }
  return { kind: 'none', row: null, inSession: false, C }
}
