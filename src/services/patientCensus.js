// 每日病人數快照（patient_census_daily）
// 用途：年度報表「常規門診病人數（月底）」列——取每月最後一天的快照。
// 常規門診定義與主護病人照護清單一致：status='opd'、未刪除、patient_category 空或 'opd_regular'。
// 寫入者：scheduler.js 每晚 23:45 cron（source='cron'）；scripts/backfill-patient-census.mjs 倒推歷史（source='backfill'，估算）。

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

/**
 * 某月常規門診人數的「異動明細」：由 patient_history 事件整理該月
 * 新增（建檔為門診／復原為門診）、刪除（含刪除日期與原因）、轉入門診（住院/急診→門診）、轉出門診（門診→住院/急診）。
 * 常規門診定義同 countCurrentCensus；patient_category 未留歷史→以病人現值判斷（與 backfill 估算一致）。
 * @param {import('better-sqlite3').Database} db
 * @param {number} year
 * @param {number} month 1–12
 */
export function getMonthlyCensusChanges(db, year, month) {
  const mm = String(month).padStart(2, '0')
  const monthStart = `${year}-${mm}-01`
  const monthEnd = `${year}-${mm}-31`
  // timestamp 為 UTC，前後各放寬一天再以台北日期過濾
  const rows = db
    .prepare(
      `SELECT h.id, h.patient_id, h.patient_name, h.event_type, h.event_details, h.snapshot, h.timestamp,
              p.medical_record_number, p.name AS current_name, p.patient_category, p.is_deleted, p.status AS current_status
       FROM patient_history h
       LEFT JOIN patients p ON p.id = h.patient_id
       WHERE h.timestamp >= ? AND h.timestamp < ?
         AND h.event_type IN ('CREATE','DELETE','TRANSFER','STATUS_CHANGE','RESTORE','RESTORE_AND_TRANSFER')
       ORDER BY h.timestamp ASC`,
    )
    .all(new Date(Date.UTC(year, month - 1, 1) - 86400000).toISOString().slice(0, 10), `${year}-${mm}-32`)

  const added = []
  const deleted = []
  const transferredIn = []
  const transferredOut = []

  for (const r of rows) {
    // 常規門診限定：現值 patient_category 空或 opd_regular（查無病人＝硬刪，視為常規）
    if (r.patient_category && r.patient_category !== 'opd_regular') continue
    const date = toTaipeiDate(r.timestamp)
    if (date < monthStart || date > monthEnd) continue
    let d = {}, s = {}
    try { d = JSON.parse(r.event_details || '{}') } catch {}
    try { s = JSON.parse(r.snapshot || '{}') } catch {}
    const base = {
      historyId: r.id,
      patientId: r.patient_id,
      name: r.current_name || r.patient_name,
      medicalRecordNumber: r.medical_record_number || s.medicalRecordNumber || null,
      date,
      isDeletedNow: r.is_deleted === 1,
      currentStatus: r.current_status || null,
    }
    switch (r.event_type) {
      case 'CREATE':
        if ((d.status || s.status || 'opd') === 'opd') added.push({ ...base, kind: 'create', kindLabel: '新建檔' })
        break
      case 'RESTORE':
      case 'RESTORE_AND_TRANSFER':
        if ((d.restoredTo || s.status || 'opd') === 'opd') added.push({ ...base, kind: 'restore', kindLabel: '復原' })
        break
      case 'DELETE': {
        const from = d.fromStatus || s.status || null
        if (from && from !== 'opd') break
        deleted.push({
          ...base,
          kind: 'delete',
          kindLabel: '刪除',
          eventDate: d.eventDate || date,
          reason: d.reason || '',
          fromStatus: from,
          fromStatusLabel: STATUS_LABEL[from] || from || '',
        })
        break
      }
      case 'TRANSFER':
      case 'STATUS_CHANGE': {
        const from = d.fromStatus || null
        const to = d.toStatus || s.status || null
        if (from === to) break
        const item = {
          ...base,
          fromStatus: from,
          toStatus: to,
          fromStatusLabel: STATUS_LABEL[from] || from || '',
          toStatusLabel: STATUS_LABEL[to] || to || '',
          reason: d.reason || '',
        }
        if (to === 'opd' && from !== 'opd') transferredIn.push({ ...item, kind: 'transfer_in', kindLabel: '轉入門診' })
        else if (from === 'opd' && to !== 'opd') transferredOut.push({ ...item, kind: 'transfer_out', kindLabel: '轉出門診' })
        break
      }
      default:
        break
    }
  }

  // 同一人同日同類型（例：同日反覆刪除/復原）視為同一筆：保留最後一筆，mergedCount 標註合併筆數
  const mergeSameDay = (list) => {
    const map = new Map()
    for (const it of list) {
      const key = `${it.patientId}|${it.date}|${it.kind}`
      const prev = map.get(key)
      map.set(key, { ...it, mergedCount: (prev?.mergedCount || 0) + 1 })
    }
    return [...map.values()]
  }

  const snapshotRow = db
    .prepare(
      `SELECT date, opd_regular_count, source FROM patient_census_daily
       WHERE date >= ? AND date <= ? ORDER BY date DESC LIMIT 1`,
    )
    .get(monthStart, monthEnd)
  const earliest = db.prepare('SELECT MIN(timestamp) AS t FROM patient_history').get()

  return {
    year,
    month,
    monthEndSnapshot: snapshotRow
      ? { date: snapshotRow.date, opdRegular: snapshotRow.opd_regular_count, source: snapshotRow.source }
      : null,
    historySince: earliest?.t ? toTaipeiDate(earliest.t) : null,
    added: mergeSameDay(added),
    deleted: mergeSameDay(deleted),
    transferredIn: mergeSameDay(transferredIn),
    transferredOut: mergeSameDay(transferredOut),
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
