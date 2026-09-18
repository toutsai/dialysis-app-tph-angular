// 每日 ICU 透析病人名單與月／年統計（ICU 透析頁「月／年統計」彈窗用，2026-09-19）
//
// 為什麼要自己記：
// ・CVVHDF 病人不排常規床（已移出總表），每日排程裡沒有他們 → 無法從排程回推
// ・病房號變更沒有任何歷史紀錄（patient_history 不含 ward_number）→ 過去哪幾天在 ICU 無從得知
// 所以由 scheduler 每小時把「此刻在 ICU 的透析病人」upsert 進當日名單，自上線日起累積。
// 一位病人一天一列（當天曾在 ICU 就算，含白天洗完晚上已轉出者），模式／單位取當天最後一次看到的值。

const MODE_BUCKETS = ['HD', 'SLED', 'CVVHDF']
const bucketOf = (mode) => (MODE_BUCKETS.includes(mode) ? mode : 'OTHER')
const emptyCounts = () => ({ HD: 0, SLED: 0, CVVHDF: 0, OTHER: 0, total: 0 })
const pad2 = (n) => String(n).padStart(2, '0')
const round1 = (n) => Math.round(n * 10) / 10

/**
 * 把此刻的 ICU 透析病人寫進 date 當日名單。
 * @param {Array<{id:string,name?:string,unit:string,bedNo?:string,mode?:string}>} patients buildIcuDialysisData 攤平後的病人
 */
export function recordIcuDialysisSnapshot(db, date, patients) {
  const upsert = db.prepare(`
    INSERT INTO icu_dialysis_daily (date, patient_id, patient_name, unit, bed_no, mode)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(date, patient_id) DO UPDATE SET
      patient_name = excluded.patient_name,
      unit = excluded.unit,
      bed_no = excluded.bed_no,
      mode = excluded.mode,
      seen_count = seen_count + 1,
      last_seen_at = datetime('now', 'localtime')
  `)
  // 當天 ICU 沒有透析病人時名單是空的，靠 runs 表分辨「0 人」與「沒記錄到（伺服器沒開）」
  const markRun = db.prepare(`
    INSERT INTO icu_dialysis_daily_runs (date) VALUES (?)
    ON CONFLICT(date) DO UPDATE SET
      run_count = run_count + 1,
      last_run_at = datetime('now', 'localtime')
  `)
  db.transaction(() => {
    for (const p of patients) {
      upsert.run(date, p.id, p.name || '', p.unit, p.bedNo || null, p.mode || '')
    }
    markRun.run(date)
  })()
  return patients.length
}

function summarize(days) {
  const withData = days.filter((d) => d.hasData)
  const patientDays = emptyCounts()
  const max = { HD: null, SLED: null, CVVHDF: null, OTHER: null, total: null }
  for (const d of withData) {
    for (const key of Object.keys(patientDays)) {
      patientDays[key] += d[key]
      if (!max[key] || d[key] > max[key].count) max[key] = { count: d[key], date: d.date }
    }
  }
  const avg = emptyCounts()
  for (const key of Object.keys(avg)) avg[key] = withData.length ? round1(patientDays[key] / withData.length) : 0
  return { daysWithData: withData.length, patientDays, avg, max }
}

/**
 * @param {{year:number, month?:number|null, unit?:string|null, today:string, livePatients:Array}} opts
 *   month 有值＝月檢視（回每日）；無＝年檢視（回 12 個月彙總）。unit＝ICUA/ICUB/ICUD/OTHER 篩單位。
 *   today 當天以 livePatients（此刻名單）疊在已記錄名單上，開視窗就看得到今天、且不必為了 GET 寫 DB。
 */
export function getIcuDialysisStats(db, { year, month = null, unit = null, today, livePatients = [] }) {
  const start = month ? `${year}-${pad2(month)}-01` : `${year}-01-01`
  const end = month ? `${year}-${pad2(month)}-${pad2(new Date(year, month, 0).getDate())}` : `${year}-12-31`

  // date → Map(patientId → { unit, mode })
  const byDate = new Map()
  const put = (date, patientId, info) => {
    if (!byDate.has(date)) byDate.set(date, new Map())
    byDate.get(date).set(patientId, info)
  }
  const rows = db
    .prepare(`SELECT date, patient_id, unit, mode FROM icu_dialysis_daily WHERE date BETWEEN ? AND ?`)
    .all(start, end)
  for (const r of rows) put(r.date, r.patient_id, { unit: r.unit, mode: r.mode })

  const recordedDates = new Set(
    db.prepare(`SELECT date FROM icu_dialysis_daily_runs WHERE date BETWEEN ? AND ?`).all(start, end).map((r) => r.date),
  )
  if (today >= start && today <= end) {
    recordedDates.add(today)
    for (const p of livePatients) put(today, p.id, { unit: p.unit, mode: p.mode || '' })
  }

  const knownUnits = ['ICUA', 'ICUB', 'ICUD']
  const matchUnit = (u) => !unit || (unit === 'OTHER' ? !knownUnits.includes(u) : u === unit)

  const buildDay = (date) => {
    const day = { date, hasData: recordedDates.has(date), ...emptyCounts() }
    for (const info of (byDate.get(date) || new Map()).values()) {
      if (!matchUnit(info.unit)) continue
      day[bucketOf(info.mode)]++
      day.total++
    }
    return day
  }
  const distinctPatients = (from, to) => {
    const seen = { HD: new Set(), SLED: new Set(), CVVHDF: new Set(), OTHER: new Set(), total: new Set() }
    for (const [date, patients] of byDate) {
      if (date < from || date > to) continue
      for (const [patientId, info] of patients) {
        if (!matchUnit(info.unit)) continue
        seen[bucketOf(info.mode)].add(patientId)
        seen.total.add(patientId)
      }
    }
    return Object.fromEntries(Object.entries(seen).map(([k, s]) => [k, s.size]))
  }
  const daysOf = (y, m) => {
    const last = new Date(y, m, 0).getDate()
    return Array.from({ length: last }, (_, i) => buildDay(`${y}-${pad2(m)}-${pad2(i + 1)}`))
  }

  const firstRun = db.prepare(`SELECT MIN(date) AS d FROM icu_dialysis_daily_runs`).get()
  const base = { year, month, unit: unit || null, today, firstDataDate: firstRun?.d || today }

  if (month) {
    const days = daysOf(year, month)
    return { ...base, days, summary: { ...summarize(days), distinctPatients: distinctPatients(start, end) } }
  }
  const months = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1
    const days = daysOf(year, m)
    return {
      month: m,
      ...summarize(days),
      distinctPatients: distinctPatients(`${year}-${pad2(m)}-01`, `${year}-${pad2(m)}-31`),
    }
  })
  const allDays = Array.from({ length: 12 }, (_, i) => daysOf(year, i + 1)).flat()
  return { ...base, months, summary: { ...summarize(allDays), distinctPatients: distinctPatients(start, end) } }
}
