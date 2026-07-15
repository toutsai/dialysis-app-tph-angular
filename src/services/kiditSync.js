/**
 * Kidit 日誌同步服務
 * 當 daily_logs 更新時，同步事件到 kidit_logbook
 */

import { getDatabase } from '../db/init.js'
import { normalizeDialysisMode } from '../utils/dialysisMode.js'

// 不納入 KiDit 申報的病人動態類型。
// KiDit 日誌本以入院/出院/轉床等異動申報為主；「更改模式」「勿動」只記在工作日誌。
const KIDIT_EXCLUDED_MOVEMENT_TYPES = new Set(['更改模式', '勿動'])

// 建立「病人 id → 正規化透析模式」對照表（含已刪除病人：結案事件仍需顯示模式）
function buildPatientModeMap(db, patientIds) {
  const map = new Map()
  const ids = [...new Set(patientIds)].filter(Boolean)
  if (!ids.length) return map
  const placeholders = ids.map(() => '?').join(',')
  const rows = db
    .prepare(`SELECT id, dialysis_orders FROM patients WHERE id IN (${placeholders})`)
    .all(...ids)
  for (const row of rows) {
    try {
      const orders = JSON.parse(row.dialysis_orders || '{}')
      if (orders && orders.mode != null && String(orders.mode).trim()) {
        map.set(row.id, normalizeDialysisMode(String(orders.mode)))
      }
    } catch {}
  }
  return map
}

/**
 * 同步每日日誌到 Kidit 日誌本
 * @param {string} dateStr - 日期字串 (YYYY-MM-DD)
 * @param {Object} dailyLogData - 每日日誌資料
 */
export async function syncEventsToKiditLogbook(dateStr, dailyLogData) {
  console.log(`🚀 [KIDIT Sync] 開始同步 ${dateStr} 的事件...`)

  const db = getDatabase()

  try {
    // 1. 處理刪除事件
    if (!dailyLogData) {
      console.log(`[KIDIT Sync] 日期 ${dateStr} 的日誌已刪除，清空 kidit_logbook 事件...`)

      db.prepare(`
        INSERT INTO kidit_logbook (id, date, events, updated_at)
        VALUES (?, ?, '[]', datetime('now', 'localtime'))
        ON CONFLICT(id) DO UPDATE SET
          events = '[]',
          updated_at = datetime('now', 'localtime')
      `).run(dateStr, dateStr)

      return { success: true, message: '已清空事件' }
    }

    // 2. 從 Daily Log 提取事件
    const dailyLogEvents = []
    const fallbackTimestamp = dailyLogData.createdAt || new Date().toISOString()

    // 2-1. 處理病人動態 (Patient Movements)
    const patientMovements = typeof dailyLogData.patientMovements === 'string'
      ? JSON.parse(dailyLogData.patientMovements || '[]')
      : (dailyLogData.patientMovements || [])

    patientMovements.forEach(item => {
      if (item.patientId && item.name && !KIDIT_EXCLUDED_MOVEMENT_TYPES.has(item.type)) {
        let eventTime = fallbackTimestamp
        if (item.timestamp) {
          eventTime = typeof item.timestamp === 'string'
            ? item.timestamp
            : new Date(item.timestamp).toISOString()
        }

        dailyLogEvents.push({
          id: `move_${dateStr}_${item.id || Date.now()}`,
          type: item.type || 'MOVEMENT',
          timestamp: eventTime,
          patientName: item.name,
          patientId: item.patientId,
          medicalRecordNumber: item.medicalRecordNumber || '',
          details: item.remarks || item.reason || '手動記錄於工作日誌',
        })
      }
    })

    // 2-2. 處理血管通路事件 (Vascular Access)
    const vascularAccessLog = typeof dailyLogData.vascularAccessLog === 'string'
      ? JSON.parse(dailyLogData.vascularAccessLog || '[]')
      : (dailyLogData.vascularAccessLog || [])

    vascularAccessLog.forEach(item => {
      if (item.patientId && item.name) {
        let eventTime = fallbackTimestamp
        if (item.timestamp) {
          eventTime = typeof item.timestamp === 'string'
            ? item.timestamp
            : new Date(item.timestamp).toISOString()
        }

        const interventions = Array.isArray(item.interventions)
          ? item.interventions.join(', ')
          : (item.interventions || '')

        dailyLogEvents.push({
          id: `access_${dateStr}_${item.id || Date.now()}`,
          type: 'ACCESS',
          timestamp: eventTime,
          patientName: item.name,
          patientId: item.patientId,
          medicalRecordNumber: item.medicalRecordNumber || '',
          details: `通路處置: ${interventions} (${item.location || '未知院所'})`,
        })
      }
    })

    console.log(`[KIDIT Sync] 從 daily_log 提取了 ${dailyLogEvents.length} 個事件`)

    // 2-3. 補上病人當前透析模式（同步當下的快照；重新同步時會更新）
    if (dailyLogEvents.length > 0) {
      const modeMap = buildPatientModeMap(db, dailyLogEvents.map(e => e.patientId))
      dailyLogEvents.forEach(e => {
        e.dialysisMode = modeMap.get(e.patientId) || ''
      })
    }

    // 3. 如果沒有事件，清空並返回
    if (dailyLogEvents.length === 0) {
      db.prepare(`
        INSERT INTO kidit_logbook (id, date, events, updated_at)
        VALUES (?, ?, '[]', datetime('now', 'localtime'))
        ON CONFLICT(id) DO UPDATE SET
          events = '[]',
          updated_at = datetime('now', 'localtime')
      `).run(dateStr, dateStr)

      return { success: true, message: '無事件需要同步' }
    }

    // 4. 取得現有的 kidit_logbook 資料（保留使用者的手動勾選狀態）
    const existingDoc = db.prepare(`
      SELECT events FROM kidit_logbook WHERE id = ?
    `).get(dateStr)

    const existingEvents = existingDoc
      ? JSON.parse(existingDoc.events || '[]')
      : []

    // 建立事件映射，保留現有的勾選狀態
    const eventsMap = new Map()
    dailyLogEvents.forEach(e => eventsMap.set(e.id, e))

    existingEvents.forEach(existing => {
      if (eventsMap.has(existing.id)) {
        const current = eventsMap.get(existing.id)
        // 以既有事件為底（保留使用者已填的申報表單欄位與勾選狀態），
        // 再以 daily_log 重新產生的受管欄位（type/timestamp/病人資訊/details）覆蓋
        eventsMap.set(existing.id, { ...existing, ...current })
      }
    })

    // 5. 排序事件（按時間）
    const finalEvents = Array.from(eventsMap.values())
    finalEvents.sort((a, b) => {
      const timeA = new Date(a.timestamp).getTime()
      const timeB = new Date(b.timestamp).getTime()
      return timeA - timeB
    })

    // 6. 儲存到 kidit_logbook
    const eventsToSave = finalEvents.map(e => ({
      ...e,
      isRegistered: e.isRegistered || false,
      transferOutHospital: e.transferOutHospital || '',
    }))

    db.prepare(`
      INSERT INTO kidit_logbook (id, date, events, updated_at)
      VALUES (?, ?, ?, datetime('now', 'localtime'))
      ON CONFLICT(id) DO UPDATE SET
        events = excluded.events,
        updated_at = datetime('now', 'localtime')
    `).run(dateStr, dateStr, JSON.stringify(eventsToSave))

    console.log(`[KIDIT Sync] ✅ 成功同步 ${eventsToSave.length} 個事件到 kidit_logbook`)

    return {
      success: true,
      message: `已同步 ${eventsToSave.length} 個事件`,
      eventCount: eventsToSave.length,
    }

  } catch (error) {
    console.error(`[KIDIT Sync] ❌ 同步失敗:`, error)
    throw error
  }
}

/**
 * 取得 Kidit 日誌本
 * @param {string} dateStr - 日期字串 (YYYY-MM-DD)
 */
export function getKiditLogbook(dateStr) {
  const db = getDatabase()

  try {
    const doc = db.prepare(`
      SELECT * FROM kidit_logbook WHERE id = ?
    `).get(dateStr)

    if (!doc) {
      return {
        id: dateStr,
        date: dateStr,
        events: [],
      }
    }

    return {
      id: doc.id,
      date: doc.date,
      events: JSON.parse(doc.events || '[]'),
      createdAt: doc.created_at,
      updatedAt: doc.updated_at,
    }

  } catch (error) {
    console.error(`[KIDIT] 取得日誌本失敗:`, error)
    throw error
  }
}

/**
 * 更新 Kidit 日誌本事件狀態
 * @param {string} dateStr - 日期字串
 * @param {string} eventId - 事件 ID
 * @param {Object} updates - 更新資料 {isRegistered, transferOutHospital}
 */
export function updateKiditEvent(dateStr, eventId, updates) {
  const db = getDatabase()

  try {
    const doc = db.prepare(`
      SELECT events FROM kidit_logbook WHERE id = ?
    `).get(dateStr)

    if (!doc) {
      throw new Error(`日期 ${dateStr} 的 kidit_logbook 不存在`)
    }

    const events = JSON.parse(doc.events || '[]')
    const eventIndex = events.findIndex(e => e.id === eventId)

    if (eventIndex === -1) {
      throw new Error(`事件 ${eventId} 不存在`)
    }

    // 更新事件
    events[eventIndex] = {
      ...events[eventIndex],
      ...updates,
    }

    db.prepare(`
      UPDATE kidit_logbook
      SET events = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(JSON.stringify(events), dateStr)

    return { success: true }

  } catch (error) {
    console.error(`[KIDIT] 更新事件失敗:`, error)
    throw error
  }
}

export function updateKiditEvents(dateStr, events = []) {
  const db = getDatabase()

  try {
    const safeEvents = Array.isArray(events) ? events : []

    db.prepare(
      `
      INSERT INTO kidit_logbook (id, date, events, updated_at)
      VALUES (?, ?, ?, datetime('now', 'localtime'))
      ON CONFLICT(id) DO UPDATE SET
        events = excluded.events,
        updated_at = datetime('now', 'localtime')
    `,
    ).run(dateStr, dateStr, JSON.stringify(safeEvents))

    return { success: true, count: safeEvents.length }
  } catch (error) {
    console.error(`[KIDIT] 更新事件列表失敗:`, error)
    throw error
  }
}

export function listKiditLogbooks({ startDate, endDate }) {
  const db = getDatabase()

  try {
    const rows = db
      .prepare(
        `
        SELECT * FROM kidit_logbook
        WHERE date >= ? AND date < ?
        ORDER BY date
      `,
      )
      .all(startDate, endDate)

    return rows.map(row => ({
      id: row.id,
      date: row.date,
      events: JSON.parse(row.events || '[]'),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
  } catch (error) {
    console.error(`[KIDIT] 取得區間日誌本失敗:`, error)
    throw error
  }
}

export default {
  syncEventsToKiditLogbook,
  getKiditLogbook,
  updateKiditEvent,
  updateKiditEvents,
  listKiditLogbooks,
}
