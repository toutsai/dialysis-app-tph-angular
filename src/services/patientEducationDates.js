/** Expand each schedule JSON once for the whole education list, retaining individual start dates. */
export function getEducationDialysisDatesBatch(db, requests, todayStr) {
  const valid = requests.filter(({ patientId, firstDate }) =>
    patientId && firstDate && /^\d{4}-\d{2}-\d{2}$/.test(firstDate) && firstDate <= todayStr)
  const result = new Map(requests.map(({ patientId }) => [patientId, []]))
  if (!valid.length) return result
  const earliest = valid.reduce((date, item) => item.firstDate < date ? item.firstDate : date, todayStr)
  // A single patient needs no shared materialization; retain the original narrow query.
  const rows = valid.length === 1 ? db.prepare(`
    SELECT DISTINCT date, slotKey FROM (
      SELECT date, je.key AS slotKey FROM schedules, json_each(schedule) je
      WHERE json_extract(je.value, '$.patientId') = ? AND date >= ? AND date <= ?
      UNION
      SELECT date, je.key AS slotKey FROM archived_schedules, json_each(schedule) je
      WHERE json_extract(je.value, '$.patientId') = ? AND date >= ? AND date <= ?
    ) ORDER BY date ASC
  `).all(valid[0].patientId, earliest, todayStr, valid[0].patientId, earliest, todayStr)
    .map(row => ({ ...row, patientId: valid[0].patientId })) : db.prepare(`
    WITH wanted AS MATERIALIZED (
      SELECT json_extract(value, '$.patientId') AS patientId,
             json_extract(value, '$.firstDate') AS firstDate FROM json_each(?)
    ), slots AS MATERIALIZED (
      SELECT date, je.key AS slotKey, json_extract(je.value, '$.patientId') AS patientId
      FROM schedules, json_each(schedule) je WHERE date >= ? AND date <= ?
      UNION
      SELECT date, je.key AS slotKey, json_extract(je.value, '$.patientId') AS patientId
      FROM archived_schedules, json_each(schedule) je WHERE date >= ? AND date <= ?
    )
    SELECT s.patientId, s.date, s.slotKey FROM slots s
    JOIN wanted w ON s.patientId = w.patientId AND s.date >= w.firstDate
    ORDER BY s.date ASC, s.slotKey ASC
  `).all(JSON.stringify(valid), earliest, todayStr, earliest, todayStr)
  const byPatient = new Map(valid.map(item => [item.patientId, { firstDate: item.firstDate, firstFound: false, dates: new Map() }]))
  for (const row of rows) {
    const patient = byPatient.get(row.patientId)
    if (row.date === patient.firstDate) patient.firstFound = true
    if (String(row.slotKey || '').startsWith('peripheral')) continue
    if (!patient.dates.has(row.date)) patient.dates.set(row.date, String(row.slotKey).split('-').pop() || '')
  }
  for (const [id, patient] of byPatient) {
    if (!patient.firstFound) patient.dates.set(patient.firstDate, '')
    result.set(id, [...patient.dates.entries()].map(([date, shift]) => ({ date, shift }))
      .sort((a, b) => a.date.localeCompare(b.date)))
  }
  return result
}
