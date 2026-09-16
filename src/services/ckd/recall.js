/* ============================================================
   門診 CKD — 召回工作清單（交接包 src/recall.js:7-45 buildRecall 搬 ESM；階段 5）
   已收案（登錄簿開放中）且追蹤已到期／逾期的人 → 先和門診清單的「未來掛號」比對 →
   其餘依逾期天數排序；每人可記錄聯絡結果（REC_TYPES.contact）、約定回診日、暫緩至某日；
   超過一年未照護者另列「應結案」。

   ⚠️ 規則零改動：未來掛號取代規則、RECALL_STOP、五桶 if/else 優先序、排序 皆照原版。
   差異只有：資料與寬限天數由參數注入（原版讀全域 S 與 localStorage.ckdRecallGrace）；
            lastContactOf 由 hooks 注入（records.js makeHooks）。
   ⚠️ data 是 loadDataset 的共用快取物件 —— 本檔只讀不改。
   ============================================================ */
import { iso, dGap } from './parsers.js'
import { deptMatch } from './engine.js'

/* 這些結果 = 暫停召回（要再召回請新增一筆其他結果的聯絡紀錄）；recall.js:10 逐字 */
export const RECALL_STOP = /拒絕|失聯|他院|轉透析|往生/

const parseDay = (s) => { if (!s) return null; const d = new Date(String(s).slice(0, 10) + 'T00:00:00'); return isNaN(+d) ? null : d }

/**
 * @param {object} data   loadDataset() 結果（只讀）
 * @param {object} R      analyze(..., { withAudit: true }) 結果
 * @param {object} C      makeCfg() 結果（判讀日與科別過濾）
 * @param {object} hooks  makeHooks() —— 需要 lastContactOf
 * @param {number} grace  settings.recallGrace（到期後寬限天數）
 * @returns {{ rows: object[], tally: { call:number, grace:number, appt:number, hold:number, close:number } }}
 */
export function buildRecall(data, R, C, hooks, grace = 30) {
  const today = C.date
  const deptF = C.dept
  const AUD = R.AUD || []
  /* 未來掛號（判讀日之後）：本科優先，同為本科或同為他科時取最早那一筆（recall.js:17-24） */
  const fut = {}
  for (const p of (data.clinic || [])) {
    if (!p.date || !today || p.date <= today || /退掛|取消|作廢/.test(p.state || '')) continue
    const inD = deptMatch(p.dept, deptF)
    const cur = fut[p.mrn]
    const cand = { date: p.date, doctor: p.doctor || '', dept: p.dept || '', inDept: inD }
    if (!cur || (inD && !cur.inDept) || (inD === cur.inDept && p.date < cur.date)) fut[p.mrn] = cand
  }
  const todayIso = iso(today)
  const rows = []
  for (const x of AUD) {
    if (x.status !== 'ok' && x.status !== 'over') continue   // 未到期(wait)／年度已達上限(cap)／DKD／none 不用召回
    const gap = x.gap == null ? null : x.gap
    const appt = fut[x.mrn] || null
    const ct = hooks && hooks.lastContactOf ? hooks.lastContactOf(x.mrn) : null
    const ctAppt = ct && ct.apptDate && ct.apptDate >= todayIso ? ct.apptDate : null
    const snooze = ct && ct.until && ct.until >= todayIso ? ct.until : null
    const ctAt = ct ? parseDay(ct.at) : null
    const stopped = !!(ct && RECALL_STOP.test(ct.result || '') && ctAt && dGap(ctAt, today) <= 365)
    let bucket
    if ((appt && appt.inDept) || ctAppt) bucket = 'appt'
    else if (snooze || stopped) bucket = 'hold'
    else if (gap != null && gap > 365) bucket = 'close'
    else if (gap != null && x.need && gap <= x.need + grace) bucket = 'grace'
    else bucket = 'call'
    rows.push({ x, mrn: x.mrn, gap, appt, ctAppt, ct, snooze, stopped, bucket })
  }
  rows.sort((a, b) => ((b.gap == null ? -1 : b.gap) - (a.gap == null ? -1 : a.gap)) || String(a.mrn).localeCompare(String(b.mrn)))
  const n = (k) => rows.filter((r) => r.bucket === k).length
  return { rows, tally: { call: n('call'), grace: n('grace'), appt: n('appt'), hold: n('hold'), close: n('close') } }
}
