import { getTaipeiTodayString } from '../utils/dateUtils.js'
import { syncEventsToKiditLogbook } from './kiditSync.js'

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
        movements[existingIndex] = movement
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

export function removeAutoMovementFromDailyLog(db, date, movementId) {
  if (!date || !movementId) return

  try {
    const dailyLog = db.prepare(`SELECT * FROM daily_logs WHERE date = ?`).get(date)
    if (!dailyLog) return

    const movements = parseJson(dailyLog.patient_movements, [])
    const nextMovements = movements.filter((item) => item.id !== movementId)
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
