// 每日病人數快照（patient_census_daily）
// 用途：年度報表「常規門診病人數（月底）」列——取每月最後一天的快照。
// 常規門診定義與主護病人照護清單一致：status='opd'、未刪除、patient_category 空或 'opd_regular'。
// 寫入者：scheduler.js 每晚 23:45 cron（source='cron'）；scripts/backfill-patient-census.mjs 倒推歷史（source='backfill'，估算）。

import { getTaipeiTodayString } from '../utils/dateUtils.js'

/** 以目前 patients 表計算當下各身分人數 */
export function countCurrentCensus(db) {
  const rows = db
    .prepare(
      `SELECT status, patient_category, COUNT(*) AS c
       FROM patients
       WHERE is_deleted = 0
       GROUP BY status, patient_category`,
    )
    .all()
  const census = { opdRegular: 0, opd: 0, ipd: 0, er: 0 }
  for (const r of rows) {
    const n = Number(r.c) || 0
    if (r.status === 'opd') {
      census.opd += n
      if (!r.patient_category || r.patient_category === 'opd_regular') census.opdRegular += n
    } else if (r.status === 'ipd') {
      census.ipd += n
    } else if (r.status === 'er') {
      census.er += n
    }
  }
  return census
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

const STATUS_LABEL = { opd: '門診', ipd: '住院', er: '急診' }

/** patient_history.timestamp 多為 ISO(UTC)，轉台北本地 YYYY-MM-DD */
function toTaipeiDate(ts) {
  const d = new Date(ts)
  if (isNaN(d.getTime())) return String(ts || '').slice(0, 10)
  return d.toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' }).slice(0, 10)
}

/** 純日期字串運算（不涉時區）：某年某月的最後一天 / 前一個月的最後一天 */
function utcDateStr(y, m0, d) {
  return new Date(Date.UTC(y, m0, d)).toISOString().slice(0, 10)
}

const isRegularOpd = (v) => !v.deleted && v.status === 'opd' && (!v.category || v.category === 'opd_regular')

/**
 * 某月常規門診人數「月底對月底」的異動明細（使用者定義，2026-08-28）：
 *   上月底人數 ＋ 新增 － 轉出 ＝ 當月底人數
 * - 新增＝上月底不在常規門診名單、當月底在名單上的人（月中新增又刪除者不算）
 * - 轉出＝上月底在名單、當月底不在的人（附該月最後一次離開的日期與原因：刪除原因／轉住院／轉急診）
 * 名單由目前 patients 表＋patient_history 事件倒放還原（方法同 backfill 腳本，屬估算：
 * patient_category 未留歷史→以現值判斷；歷史起點之前無法還原）。
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

  // 終點狀態（現在）
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
       WHERE event_type IN ('CREATE','DELETE','TRANSFER','STATUS_CHANGE','RESTORE','RESTORE_AND_TRANSFER')
       ORDER BY timestamp DESC`,
    )
    .all()
    .map((e) => {
      let d = {}, s = {}
      try { d = JSON.parse(e.event_details || '{}') } catch {}
      try { s = JSON.parse(e.snapshot || '{}') } catch {}
      return { pid: e.patient_id, pname: e.patient_name, type: e.event_type, d, s, date: toTaipeiDate(e.timestamp) }
    })

  /** 倒放一個事件：把 state 退回事件發生「之前」（同 backfill 腳本） */
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
  const regularSet = () => new Set([...state.entries()].filter(([, v]) => isRegularOpd(v)).map(([id]) => id))

  let idx = 0
  while (idx < events.length && events[idx].date > asOf) undo(events[idx++])
  const endSet = regularSet()
  const endInfo = new Map([...state.entries()].map(([id, v]) => [id, { ...v }]))
  while (idx < events.length && events[idx].date > prevEnd) undo(events[idx++])
  const prevSet = regularSet()
  const prevInfo = new Map([...state.entries()].map(([id, v]) => [id, { ...v }]))

  const earliest = events.length ? events[events.length - 1].date : null
  const monthEvents = events.filter((e) => e.date > prevEnd && e.date <= asOf) // DESC：第一個命中＝該月最後一次

  const base = (id, info) => ({
    patientId: id,
    name: info?.name || null,
    medicalRecordNumber: info?.mrn || null,
    isDeletedNow: !!info?.isDeletedNow,
    currentStatus: info?.currentStatus || null,
  })

  const added = []
  for (const id of endSet) {
    if (prevSet.has(id)) continue
    const info = endInfo.get(id)
    // 該月最後一次「進入門診」的事件
    const ev = monthEvents.find((e) => e.pid === id && (
      e.type === 'CREATE' || e.type === 'RESTORE' || e.type === 'RESTORE_AND_TRANSFER' ||
      ((e.type === 'TRANSFER' || e.type === 'STATUS_CHANGE') && (e.d.toStatus || e.s?.status) === 'opd')))
    let howLabel = '—'
    if (ev?.type === 'CREATE') howLabel = '新建檔'
    else if (ev?.type === 'RESTORE' || ev?.type === 'RESTORE_AND_TRANSFER') howLabel = '復原'
    else if (ev) howLabel = `${STATUS_LABEL[ev.d.fromStatus] || ev.d.fromStatus || '?'}→門診`
    added.push({ ...base(id, info), date: ev?.date || null, howLabel })
  }

  const removed = []
  for (const id of prevSet) {
    if (endSet.has(id)) continue
    const info = endInfo.get(id) || prevInfo.get(id)
    // 該月最後一次「離開門診」的事件
    const ev = monthEvents.find((e) => e.pid === id && (
      e.type === 'DELETE' ||
      ((e.type === 'TRANSFER' || e.type === 'STATUS_CHANGE') && e.d.fromStatus === 'opd')))
    let howLabel = '—', reason = ''
    if (ev?.type === 'DELETE') { howLabel = '刪除'; reason = ev.d.reason || '' }
    else if (ev) { howLabel = `轉${STATUS_LABEL[ev.d.toStatus] || ev.d.toStatus || '?'}`; reason = ev.d.reason || '' }
    else if (info && info.category && info.category !== 'opd_regular') { howLabel = '改為非常規' }
    removed.push({
      ...base(id, info),
      date: ev?.type === 'DELETE' ? (ev.d.eventDate || ev.date) : (ev?.date || null),
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
