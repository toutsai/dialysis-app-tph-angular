import { createHash } from 'node:crypto'

// Content revisions include every editable field. Automatic/direct SQL writers
// invalidate a reader without relying on second-resolution timestamps or migrations.
export function dailyLogVersion(row) {
  if (!row) return 'new'
  return createHash('sha256').update(JSON.stringify([
    row.revision || 0, row.patient_movements, row.vascular_access_log, row.announcements,
    row.stats, row.leader, row.other_notes, row.notes,
  ])).digest('hex')
}

export function preserveMovementMetadata(incoming, existing) {
  const byId = new Map(existing.map(item => [String(item.id), item]))
  return incoming.map(item => {
    const old = byId.get(String(item.id))
    return old && item.completedKiDit === undefined && old.completedKiDit !== undefined
      ? { ...item, completedKiDit: old.completedKiDit } : item
  })
}
