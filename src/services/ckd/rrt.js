/* ============================================================
   門診 CKD — 透析準備管線（交接包 src/rrt.js:10-47 搬 ESM；階段 5）
   母體：已收案且最近 eGFR < 門檻（settings.rrtEgfr，預設 20）的人，加上任何有 SDM／血管通路紀錄的人
   （未收案者即使有紀錄也不進管線 —— 原版 byMrn 守門，刻意）。
   站別：SDM（未談／討論中／已決定 HD|PD|移植|CKM）→ 通路（未規劃／規劃中／已轉介／已建立／使用中…）→ 成熟評估／首次使用。

   ⚠️ 規則零改動：母體（嚴格 <）、最新紀錄排序、modality/decided 推導、11 條站別 if 鏈與「下一步」文字、
      eGFR 排序（null 視為 99 排最後） 皆照原版。
   ⚠️ data 是 loadDataset 的共用快取物件 —— 本檔只讀不改。
   ============================================================ */
import { recWhen } from './records.js'

/** 站別中文（rrt.js:47 逐字） */
export const RRT_STAGE = {
  s0: '未談 SDM',
  s1: 'SDM 討論中',
  s2: '待建通路',
  s3: '通路建立/成熟中',
  s4: '已使用(透析中)',
  s5: '移植 / 保守療法',
}

/** 同人同類型的紀錄：when 新→舊，再建立時間新→舊（rrt.js:10-13） */
function recsByMrn(records, type) {
  const map = new Map()
  for (const r of (records || [])) {
    if (r.type !== type || r.deleted) continue
    let a = map.get(r.mrn); if (!a) map.set(r.mrn, a = [])
    a.push(r)
  }
  for (const [, a] of map) a.sort((x, y) => String(recWhen(y) || '').localeCompare(String(recWhen(x) || '')) || String(y.created || '').localeCompare(String(x.created || '')))
  return map
}

/**
 * @param {object} data     loadDataset() 結果（只讀）
 * @param {object} R        analyze(..., { withAudit: true }) 結果
 * @param {object} C        makeCfg() 結果（本模組不用日期，保留簽章一致）
 * @param {number} rrtEgfr  settings.rrtEgfr
 * @returns {{ rows: object[], tally: Record<'s0'|'s1'|'s2'|'s3'|'s4'|'s5', number> }}
 */
export function buildRrt(data, R, C, rrtEgfr = 20) {
  const AUD = R.AUD || []
  const byMrn = {}
  AUD.forEach((x) => { byMrn[x.mrn] = x })
  const mrns = new Set()
  AUD.forEach((x) => { if (x.egfr != null && x.egfr < rrtEgfr) mrns.add(x.mrn) })
  for (const r of (data.records || [])) {
    if ((r.type === 'sdm' || r.type === 'access') && !r.deleted && byMrn[r.mrn]) mrns.add(r.mrn)
  }
  const sdmBy = recsByMrn(data.records, 'sdm'), accBy = recsByMrn(data.records, 'access')
  const rows = []
  mrns.forEach((mrn) => {
    const x = byMrn[mrn]; if (!x) return
    const sdm = (sdmBy.get(mrn) || [])[0] || null, acc = (accBy.get(mrn) || [])[0] || null
    const leaning = sdm ? (sdm.leaning || '') : ''
    const decided = !!(sdm && /^是/.test(sdm.decided || ''))
    const modality = /HD/.test(leaning) ? 'HD' : /PD/.test(leaning) ? 'PD' : /移植/.test(leaning) ? 'TX' : /CKM|保守/.test(leaning) ? 'CKM' : ''
    const accStatus = acc ? (acc.status || '') : ''
    let stage, next
    if (!sdm) { stage = 's0'; next = x.egfr != null && x.egfr < 15 ? 'eGFR 已 < 15,儘速安排 SDM 談 RRT 選項' : '安排 RRT 共享決策(SDM)' }
    else if (!decided || modality === '') { stage = 's1'; next = '持續 SDM,協助決定治療方式' + (sdm.followUp ? '(待追:' + sdm.followUp + ')' : '') }
    else if (modality === 'CKM') { stage = 's5'; next = '保守療法照護:症狀控制、預立醫療、安寧轉介' }
    else if (modality === 'TX') { stage = 's5'; next = '腎移植評估:轉介移植團隊、登錄等候' }
    else if (!acc) { stage = 's2'; next = modality === 'HD' ? '轉介建立血管通路(AVF 優先)' : '轉介置入 PD 導管' }
    else if (/規劃中/.test(accStatus)) { stage = 's2'; next = '追蹤手術安排' + (acc.planDate ? '(安排日 ' + acc.planDate + ')' : '') }
    else if (/已轉介/.test(accStatus)) { stage = 's3'; next = '確認手術完成、記錄建立日' }
    else if (/已建立未使用/.test(accStatus)) { stage = 's3'; next = acc.matureDate ? '已成熟評估,待首次使用' : '安排成熟評估(AVF 4~6 週、AVG 2~3 週)' }
    else if (/使用中/.test(accStatus)) { stage = 's4'; next = '已開始透析:確認登錄簿結案(透析)' }
    else if (/功能不良|已廢棄/.test(accStatus)) { stage = 's2'; next = '通路功能不良/廢棄,重新規劃通路' }
    else { stage = 's2'; next = '更新通路狀態' }
    rows.push({ mrn, x, sdm, acc, leaning, decided, modality, accStatus, stage, next })
  })
  rows.sort((a, b) => ((a.x.egfr == null ? 99 : a.x.egfr) - (b.x.egfr == null ? 99 : b.x.egfr)) || String(a.mrn).localeCompare(String(b.mrn)))
  const n = (k) => rows.filter((r) => r.stage === k).length
  return { rows, tally: { s0: n('s0'), s1: n('s1'), s2: n('s2'), s3: n('s3'), s4: n('s4'), s5: n('s5') } }
}
