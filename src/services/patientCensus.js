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
