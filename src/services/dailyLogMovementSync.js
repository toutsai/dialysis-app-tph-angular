import { getTaipeiTodayString } from '../utils/dateUtils.js'
import { syncEventsToKiditLogbook } from './kiditSync.js'
import { preserveMovementMetadata } from './dailyLogVersion.js'

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback
  } catch {
    return fallback
  }
}

async function syncKiditFromDailyLog(db, date) {
  const updatedLog = db.prepare(`SELECT * FROM daily_logs WHERE date = ?`).get(date)
  if (!updatedLog) return

  await syncEventsToKiditLogbook(date, {
    patientMovements: parseJson(updatedLog.patient_movements, []),
    vascularAccessLog: parseJson(updatedLog.vascular_access_log, []),
    createdAt: updatedLog.created_at,
  }).catch((err) => console.error('[DailyLog] Kidit sync failed:', err))
}

export function addAutoMovementToDailyLog(db, date, movementData) {
  const targetDate = date || getTaipeiTodayString()
  const movement = {
    ...movementData,
    timestamp: movementData.timestamp || new Date().toISOString(),
  }

  try {
    const dailyLog = db.prepare(`SELECT * FROM daily_logs WHERE date = ?`).get(targetDate)

    if (dailyLog) {
      const movements = parseJson(dailyLog.patient_movements, [])
      const existingIndex = movements.findIndex((item) => item.id === movement.id)

      if (existingIndex >= 0) {
        if (movements[existingIndex].originalAutoId) {
          console.log(`[DailyLog] Auto movement ${movement.id} was manually edited; skipping update`)
          return
        }
        movements[existingIndex] = preserveMovementMetadata([movement], [movements[existingIndex]])[0]
      } else {
        movements.push(movement)
      }

      db.prepare(`
        UPDATE daily_logs
        SET patient_movements = ?, updated_at = datetime('now', 'localtime')
        WHERE date = ?
      `).run(JSON.stringify(movements), targetDate)
    } else {
      db.prepare(`
        INSERT INTO daily_logs (id, date, patient_movements, announcements, created_at, updated_at)
        VALUES (?, ?, ?, '[]', datetime('now', 'localtime'), datetime('now', 'localtime'))
      `).run(targetDate, targetDate, JSON.stringify([movement]))
    }

    syncKiditFromDailyLog(db, targetDate)
  } catch (error) {
    console.error('[DailyLog] Failed to add auto movement:', error)
  }
}

/**
 * 同日「刪除又復原」：清掉該日工作日誌中此病人的自動「刪除」列（auto_delete_* / auto_scheduled_delete_*），
 * 視同誤刪沒發生過，呼叫端據回傳值決定不再加「復原」列（使用者 2026-09-15 拍板）。
 * 刻意不看 originalAutoId：即使護理師改過該列也一併清掉。跨日復原不呼叫此函式（歷史日誌已鎖定、KiDit 可能已申報）。
 * @returns 清掉的列數
 */
export function removeSameDayDeleteMovements(db, date, patientId) {
  if (!date || !patientId) return 0

  try {
    const dailyLog = db.prepare(`SELECT * FROM daily_logs WHERE date = ?`).get(date)
    if (!dailyLog) return 0

    const movements = parseJson(dailyLog.patient_movements, [])
    const nextMovements = movements.filter((item) => !(
      item && item.type === '刪除' && item.patientId === patientId &&
      typeof item.id === 'string' && item.id.startsWith('auto_')
    ))
    const removed = movements.length - nextMovements.length
    if (removed === 0) return 0

    db.prepare(`
      UPDATE daily_logs
      SET patient_movements = ?, updated_at = datetime('now', 'localtime')
      WHERE date = ?
    `).run(JSON.stringify(nextMovements), date)

    console.log(`[DailyLog] 同日復原：已清掉病人 ${patientId} 的 ${removed} 筆自動「刪除」列 (${date})`)
    syncKiditFromDailyLog(db, date)
    return removed
  } catch (error) {
    console.error('[DailyLog] Failed to remove same-day delete movement:', error)
    return 0
  }
}

export function removeAutoMovementFromDailyLog(db, date, movementId) {
  if (!date || !movementId) return

  try {
    const dailyLog = db.prepare(`SELECT * FROM daily_logs WHERE date = ?`).get(date)
    if (!dailyLog) return

    const movements = parseJson(dailyLog.patient_movements, [])
    const nextMovements = movements.filter((item) => item.id !== movementId || item.originalAutoId)
    if (nextMovements.length === movements.length) return

    db.prepare(`
      UPDATE daily_logs
      SET patient_movements = ?, updated_at = datetime('now', 'localtime')
      WHERE date = ?
    `).run(JSON.stringify(nextMovements), date)

    syncKiditFromDailyLog(db, date)
  } catch (error) {
    console.error('[DailyLog] Failed to remove auto movement:', error)
  }
}
