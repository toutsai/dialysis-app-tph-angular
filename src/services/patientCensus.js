// 每日病人數快照（patient_census_daily）
// 用途：年度報表「常規門診病人數（月底）」列——取每月最後一天的快照；點格子開「月底對月底」異動明細。
//
// 常規門診定義（2026-08-28 使用者裁定）：
//   未刪除 且 patient_category 空或 'opd_regular' 且（目前為門診 或 該時點以前曾經是門診）
// ——常規病人暫時轉住院/急診仍算常規門診人數；建檔即住院/急診且從未門診者不算（舊資料常漏標 non_regular，用「曾為門診」補強）。
// ⚠️ 與主護病人照護清單（只算 status='opd'）刻意不同。
// 三個消費端（cron 快照 countCurrentCensus／scripts/backfill-patient-census.mjs／彈窗 getMonthlyCensusChanges）
// 都走同一個 loadCensusReplay() 倒放引擎，定義只在這裡改。

import { getTaipeiTodayString } from '../utils/dateUtils.js'

const STATUS_LABEL = { opd: '門診', ipd: '住院', er: '急診' }
const REPLAY_EVENT_TYPES = ['CREATE', 'DELETE', 'TRANSFER', 'STATUS_CHANGE', 'RESTORE', 'RESTORE_AND_TRANSFER']

export const isRegularCategory = (category) => !category || category === 'opd_regular'

/** patient_history.timestamp 多為 ISO(UTC)，轉台北本地 YYYY-MM-DD */
export function toTaipeiDate(ts) {
  const d = new Date(ts)
  if (isNaN(d.getTime())) return String(ts || '').slice(0, 10)
  return d.toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' }).slice(0, 10)
}

/**
 * 載入倒放引擎：以目前 patients 表為終點，patient_history 由新到舊 undo() 可把 state 退回任一日期。
 * 呼叫端自行依序 undo 所有 date > 目標日 的事件（events 已是 DESC），再用 isRegularAt / countAt 計算。
 */
export function loadCensusReplay(db) {
  const state = new Map()
  for (const p of db.prepare('SELECT id, name, medical_record_number, status, is_deleted, patient_category FROM patients').all()) {
    state.set(p.id, {
      status: p.status, deleted: p.is_deleted === 1, category: p.patient_category || '',
      name: p.name, mrn: p.medical_record_number || null, isDeletedNow: p.is_deleted === 1, currentStatus: p.status,
    })
  }

  const events = db
    .prepare(
      `SELECT patient_id, patient_name, event_type, event_details, snapshot, timestamp
       FROM patient_history
       WHERE event_type IN (${REPLAY_EVENT_TYPES.map(() => '?').join(',')})
       ORDER BY timestamp DESC`,
    )
    .all(...REPLAY_EVENT_TYPES)
    .map((e) => {
      let d = {}, s = {}
      try { d = JSON.parse(e.event_details || '{}') } catch {}
      try { s = JSON.parse(e.snapshot || '{}') } catch {}
      return { pid: e.patient_id, pname: e.patient_name, type: e.event_type, d, s, date: toTaipeiDate(e.timestamp) }
    })
  const earliest = events.length ? events[events.length - 1].date : null

  // 每位病人「最早曾為門診」的日期（由舊到新掃一次）；歷史裡看不到但目前是門診者＝早於歷史起點
  const firstOpd = new Map()
  const mark = (pid, date) => { if (!firstOpd.has(pid) || firstOpd.get(pid) > date) firstOpd.set(pid, date) }
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    const d = e.d || {}
    const wasOpd =
      (e.type === 'CREATE' && (d.status || 'opd') === 'opd') ||
      d.fromStatus === 'opd' || d.toStatus === 'opd' || d.restoredTo === 'opd' || e.s?.status === 'opd'
    if (wasOpd) mark(e.pid, e.date)
  }
  for (const [id, v] of state) {
    if (v.status === 'opd' && !v.deleted && !firstOpd.has(id)) firstOpd.set(id, '0000-00-00')
  }

  /** 倒放一個事件：把 state 退回事件發生「之前」 */
  const undo = (ev) => {
    const cur = state.get(ev.pid) || {
      status: ev.s?.status || 'opd', deleted: true, category: '',
      name: ev.pname, mrn: ev.s?.medicalRecordNumber || null, isDeletedNow: true, currentStatus: null, // 硬刪：patients 已無此人
    }
    switch (ev.type) {
      case 'CREATE':
        state.set(ev.pid, { ...cur, deleted: true })
        break
      case 'DELETE':
        state.set(ev.pid, { ...cur, deleted: false, status: ev.d.fromStatus || ev.s?.status || cur.status })
        break
      case 'TRANSFER':
      case 'STATUS_CHANGE':
        state.set(ev.pid, { ...cur, deleted: false, status: ev.d.fromStatus || cur.status })
        break
      case 'RESTORE':
      case 'RESTORE_AND_TRANSFER':
        state.set(ev.pid, { ...cur, deleted: true })
        break
      default:
        break
    }
  }

  /** 某病人在 date 當時是否算「常規門診」（state 須已退回到 date） */
  const isRegularAt = (id, v, date) =>
    !v.deleted && isRegularCategory(v.category) && (v.status === 'opd' || (firstOpd.get(id) ?? '9999-99-99') <= date)

  /** state 已退回到 date 時的各項人數 */
  const countAt = (date) => {
    const c = { opdRegular: 0, opd: 0, ipd: 0, er: 0 }
    for (const [id, v] of state) {
      if (v.deleted) continue
      if (isRegularAt(id, v, date)) c.opdRegular++
      if (v.status === 'opd') c.opd++
      else if (v.status === 'ipd') c.ipd++
      else if (v.status === 'er') c.er++
    }
    return c
  }

  return { state, events, earliest, undo, isRegularAt, countAt }
}

/** 以目前 patients 表（＋曾為門診判定）計算當下各身分人數 */
export function countCurrentCensus(db) {
  return loadCensusReplay(db).countAt(getTaipeiTodayString())
}

/** 記錄某日快照（同日覆蓋；cron 覆蓋 backfill、backfill 不覆蓋 cron） */
export function recordDailyCensus(db, date, census, source = 'cron') {
  if (source === 'backfill') {
    const existing = db.prepare('SELECT source FROM patient_census_daily WHERE date = ?').get(date)
    if (existing && existing.source === 'cron') return false
  }
  db.prepare(
    `INSERT INTO patient_census_daily (date, opd_regular_count, opd_count, ipd_count, er_count, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
     ON CONFLICT(date) DO UPDATE SET
       opd_regular_count = excluded.opd_regular_count,
       opd_count = excluded.opd_count,
       ipd_count = excluded.ipd_count,
       er_count = excluded.er_count,
       source = excluded.source,
       created_at = excluded.created_at`,
  ).run(date, census.opdRegular, census.opd, census.ipd, census.er, source)
  return true
}

/** 純日期字串運算（不涉時區）：某年某月第 d 天（d=0 為上月最後一天） */
function utcDateStr(y, m0, d) {
  return new Date(Date.UTC(y, m0, d)).toISOString().slice(0, 10)
}

/**
 * 某月常規門診人數「月底對月底」的異動明細（使用者定義，2026-08-28）：
 *   上月底人數 ＋ 新增 － 轉出 ＝ 當月底人數
 * - 新增＝上月底不在常規門診名單、當月底在名單上的人（月中新增又刪除者不算）
 * - 轉出＝上月底在名單、當月底不在的人（附該月最後一次刪除的日期與原因）；常規病人轉住院/急診不算轉出
 * - 每筆附「月底當時身分」；若月底以後已刪除，另附刪除日供辨識
 * 當月尚未結束＝以今天為「月底」。
 * @param {import('better-sqlite3').Database} db
 * @param {number} year
 * @param {number} month 1–12
 */
export function getMonthlyCensusChanges(db, year, month) {
  const today = getTaipeiTodayString()
  const monthStart = utcDateStr(year, month - 1, 1)
  const prevEnd = utcDateStr(year, month - 1, 0)
  const lastDay = utcDateStr(year, month, 0)
  const asOf = lastDay < today ? lastDay : today
  const isPartial = asOf !== lastDay

  const { state, events, earliest, undo, isRegularAt } = loadCensusReplay(db)
  const regularSet = (date) => new Set([...state.entries()].filter(([id, v]) => isRegularAt(id, v, date)).map(([id]) => id))
  const snapshotInfo = () => new Map([...state.entries()].map(([id, v]) => [id, { ...v }]))

  let idx = 0
  while (idx < events.length && events[idx].date > asOf) undo(events[idx++])
  const endSet = regularSet(asOf)
  const endInfo = snapshotInfo()
  while (idx < events.length && events[idx].date > prevEnd) undo(events[idx++])
  const prevSet = regularSet(prevEnd)
  const prevInfo = snapshotInfo()

  const monthEvents = events.filter((e) => e.date > prevEnd && e.date <= asOf) // DESC：第一個命中＝該月最後一次

  // 月底以後才刪除者：取月底之後最早一筆 DELETE（events 為 DESC，取最後一個符合者）
  const laterDeletedAt = (id) => {
    let found = null
    for (const e of events) {
      if (e.date <= asOf) break
      if (e.pid === id && e.type === 'DELETE') found = e.d.eventDate || e.date
    }
    return found
  }

  const base = (id, info) => ({
    patientId: id,
    name: info?.name || null,
    medicalRecordNumber: info?.mrn || null,
    isDeletedNow: !!info?.isDeletedNow,
    currentStatus: info?.currentStatus || null,
    monthEndStatus: info?.status || null,
    monthEndStatusLabel: STATUS_LABEL[info?.status] || info?.status || '',
    laterDeletedAt: info?.isDeletedNow ? laterDeletedAt(id) : null,
  })

  const added = []
  for (const id of endSet) {
    if (prevSet.has(id)) continue
    const info = endInfo.get(id)
    // 該月最後一次「進入名單」的事件（建檔／復原）
    const ev = monthEvents.find((e) => e.pid === id && (
      e.type === 'CREATE' || e.type === 'RESTORE' || e.type === 'RESTORE_AND_TRANSFER'))
    let howLabel = '改為常規' // 無建檔/復原事件＝分類由非常規改為常規或住院轉門診（分類未留歷史，僅能推定）
    if (ev?.type === 'CREATE') howLabel = '新建檔'
    else if (ev) howLabel = '復原'
    else if (monthEvents.some((e) => e.pid === id && e.d?.toStatus === 'opd')) howLabel = '首次轉門診'
    added.push({ ...base(id, info), date: ev?.date || null, howLabel })
  }

  const removed = []
  for (const id of prevSet) {
    if (endSet.has(id)) continue
    const info = { ...(prevInfo.get(id) || {}), ...(endInfo.get(id) ? { isDeletedNow: endInfo.get(id).isDeletedNow, currentStatus: endInfo.get(id).currentStatus } : {}) }
    // 該月最後一次刪除事件
    const ev = monthEvents.find((e) => e.pid === id && e.type === 'DELETE')
    let howLabel = '改為非常規', reason = ''
    if (ev) { howLabel = '刪除'; reason = ev.d.reason || '' }
    removed.push({
      ...base(id, info),
      date: ev ? (ev.d.eventDate || ev.date) : null,
      operatedAt: ev?.date || null,
      howLabel,
      reason,
    })
  }
  const byDate = (a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.name || '').localeCompare(String(b.name || ''))
  added.sort(byDate)
  removed.sort(byDate)

  const snapshotRow = db
    .prepare(
      `SELECT date, opd_regular_count, source FROM patient_census_daily
       WHERE date >= ? AND date <= ? ORDER BY date DESC LIMIT 1`,
    )
    .get(monthStart, asOf)

  return {
    year,
    month,
    prevMonthEnd: { date: prevEnd, count: prevSet.size, beforeHistory: !!earliest && prevEnd < earliest },
    monthEnd: { date: asOf, count: endSet.size, isPartial },
    monthEndSnapshot: snapshotRow
      ? { date: snapshotRow.date, opdRegular: snapshotRow.opd_regular_count, source: snapshotRow.source }
      : null,
    historySince: earliest,
    added,
    removed,
  }
}

/**
 * 某年度每月「月底」快照：每月取該月最新一筆（月份尚未結束＝截至最新快照日）。
 * 回傳 12 格陣列，無資料為 null。
 */
export function getMonthlyCensus(db, year) {
  const rows = db
    .prepare(
      `SELECT date, opd_regular_count, opd_count, ipd_count, er_count, source
       FROM patient_census_daily
       WHERE date >= ? AND date <= ?
       ORDER BY date ASC`,
    )
    .all(`${year}-01-01`, `${year}-12-31`)
  const months = Array.from({ length: 12 }, () => null)
  for (const r of rows) {
    const m = Number(r.date.slice(5, 7)) - 1
    if (m < 0 || m > 11) continue
    // 同月後寫覆蓋＝留最晚日期
    months[m] = {
      date: r.date,
      opdRegular: r.opd_regular_count,
      opd: r.opd_count,
      ipd: r.ipd_count,
      er: r.er_count,
      source: r.source,
    }
  }
  return months
}
