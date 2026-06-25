/**
 * 護理分組歷史快照服務
 * - 每小時 cron 快照 (type='hourly')
 * - 每次儲存前快照 (type='pre_save')
 * - 還原前快照 (type='pre_restore')
 * 用於組長誤改 / 衝突覆蓋後的快速復原。內容未變則不重複存（去重）。
 */
import { getTaipeiTodayString } from '../utils/dateUtils.js'

const MAX_REVISIONS_PER_DATE = 72 // 每個日期最多保留份數
const RETENTION_DAYS = 14 // 只保留近 N 天日期的快照

function genId() {
  return `nar_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

function getLatestRevisionTeams(db, date) {
  const row = db
    .prepare(
      `SELECT teams FROM nurse_assignment_revisions WHERE date = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    )
    .get(date)
  return row ? row.teams : null
}

/**
 * 對單一日期快照當前 nurse_assignments.teams（與最新快照相同則跳過）。
 * @returns {boolean} 是否實際寫入快照
 */
export function snapshotNurseAssignmentForDate(db, date, { type = 'manual', createdBy = null } = {}) {
  if (!date) return false
  const row = db.prepare(`SELECT teams FROM nurse_assignments WHERE date = ?`).get(date)
  if (!row) return false
  const teams = row.teams || '{}'

  // 去重：與該日期最新快照完全相同就不存
  const latest = getLatestRevisionTeams(db, date)
  if (latest !== null && latest === teams) return false

  db.prepare(
    `INSERT INTO nurse_assignment_revisions (id, date, teams, snapshot_type, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))`,
  ).run(genId(), date, teams, type, JSON.stringify(createdBy || { name: 'system' }))
  return true
}

/**
 * 快照今天及未來所有有分組的日期（每小時 cron 用）。
 * @returns {number} 實際寫入的快照數
 */
export function snapshotCurrentNurseAssignments(db, { type = 'hourly', createdBy = null } = {}) {
  const today = getTaipeiTodayString()
  const rows = db
    .prepare(`SELECT date FROM nurse_assignments WHERE date >= ? ORDER BY date`)
    .all(today)
  let count = 0
  for (const r of rows) {
    if (snapshotNurseAssignmentForDate(db, r.date, { type, createdBy })) count++
  }
  return count
}

/** 保留策略：刪除過舊日期、每個日期只留最近 N 份。 */
export function pruneNurseAssignmentRevisions(db) {
  const today = getTaipeiTodayString()
  const d = new Date(today + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - RETENTION_DAYS)
  const cutoff = d.toISOString().slice(0, 10)

  db.prepare(`DELETE FROM nurse_assignment_revisions WHERE date < ?`).run(cutoff)

  const dates = db.prepare(`SELECT DISTINCT date FROM nurse_assignment_revisions`).all()
  for (const { date } of dates) {
    const keep = db
      .prepare(
        `SELECT id FROM nurse_assignment_revisions WHERE date = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      )
      .all(date, MAX_REVISIONS_PER_DATE)
      .map((r) => r.id)
    if (keep.length === 0) continue
    const placeholders = keep.map(() => '?').join(',')
    db.prepare(
      `DELETE FROM nurse_assignment_revisions WHERE date = ? AND id NOT IN (${placeholders})`,
    ).run(date, ...keep)
  }
}

/** 每小時 cron 進入點：快照 + 修剪。 */
export function hourlyNurseAssignmentSnapshot(db) {
  try {
    const n = snapshotCurrentNurseAssignments(db, { type: 'hourly' })
    pruneNurseAssignmentRevisions(db)
    if (n > 0) console.log(`📸 [NurseAssignSnapshot] 每小時快照完成，新增 ${n} 份`)
  } catch (error) {
    console.error('[NurseAssignSnapshot] 每小時快照失敗:', error)
  }
}
