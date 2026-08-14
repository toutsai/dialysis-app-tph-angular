/**
 * Kidit 日誌同步服務
 * 當 daily_logs 更新時，同步事件到 kidit_logbook
 */

import { getDatabase } from '../db/init.js'
import { normalizeDialysisMode } from '../utils/dialysisMode.js'

// 不納入 KiDit 申報的病人動態類型。
// KiDit 日誌本以入院/出院/轉床等異動申報為主；「更改模式」「勿動」只記在工作日誌。
const KIDIT_EXCLUDED_MOVEMENT_TYPES = new Set(['更改模式', '勿動'])

// 血管通路事件代碼 → 顯示文字（與前端 vascular-access-codes.ts 對齊）
const VAE_FAILURE_LABELS = {
  1: '感染', 2: '阻塞', 3: '血液流量過小', 4: '血液流量過小',
  5: '長期導管移位', 6: '竊流症候群', 9: '其他',
}
const VAE_REPAIR_LABELS = { 1: 'PTA', 2: '外科手術', 3: 'PTA+外科手術', 9: '其他' }
const VAE_TYPE_LABELS = { AVF: '自體廔管', AVG: '人工廔管', PERM: '長期導管', TEMP: '短期導管' }
const VAE_FISTULA_SITE_LABELS = { 1: '前臂', 2: '上臂', 3: '大腿', 4: '小腿', 9: '其他' }
const VAE_CATHETER_SITE_LABELS = { 1: '內頸靜脈', 2: '鎖骨下靜脈', 3: '股靜脈', 9: '其他' }

function describeVaeEvent(row) {
  const failure = VAE_FAILURE_LABELS[row.failure_reason] || ''
  if (row.event_type === 'reconstruction') {
    const side = row.new_access_side === 'R' ? '右' : row.new_access_side === 'L' ? '左' : ''
    const typeLabel = VAE_TYPE_LABELS[row.new_access_type] || row.new_access_type || ''
    const siteLabels =
      row.new_access_type === 'AVF' || row.new_access_type === 'AVG'
        ? VAE_FISTULA_SITE_LABELS
        : VAE_CATHETER_SITE_LABELS
    const site = siteLabels[row.new_access_site] ? `(${siteLabels[row.new_access_site]})` : ''
    return `血管重建-${side}${typeLabel}${site}${failure ? `,前次原因:${failure}` : ''}`
  }
  const repair = VAE_REPAIR_LABELS[row.repair_method] || ''
  const repairOther = row.repair_method === '9' && row.repair_method_other ? `(${row.repair_method_other})` : ''
  return `介入治療${failure ? `-${failure}` : ''}${repair ? `→${repair}${repairOther}` : ''}`
}

// 查該日已確認 (confirmed) 的血管通路事件，轉成 kidit_logbook 的 ACCESS 事件形狀。
// id 前綴 vae_ 穩定不變（rebuild 時 merge 才能保留使用者已勾的 isRegistered），
// 與舊版工作日誌 JSON 產生的 access_<date>_<id> 不衝突（access_ 已停產，僅相容保留舊資料）。
function buildConfirmedVaeEvents(db, dateStr) {
  const rows = db
    .prepare(
      `SELECT * FROM vascular_access_events WHERE event_date = ? AND status = 'confirmed' ORDER BY created_at`,
    )
    .all(dateStr)

  return rows.map(row => ({
    id: `vae_${row.id}`,
    type: 'ACCESS',
    timestamp: row.confirmed_at || row.created_at || `${dateStr}T12:00:00`,
    patientName: row.patient_name,
    patientId: row.patient_id,
    medicalRecordNumber: row.medical_record_number || '',
    details: `通路處置: ${describeVaeEvent(row)} (${row.location || '未知院所'})${row.notes ? `；備註：${row.notes}` : ''}`,
  }))
}

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
    // 0. 已確認的血管通路事件（vascular_access_events 表，主護填寫→組長確認）。
    //    不論日誌存在/刪除/無事件，這批都要保留——rebuild 的三條寫入路徑都納入。
    const vaeEvents = buildConfirmedVaeEvents(db, dateStr)

    // 1. 處理刪除事件（僅保留已確認的血管通路事件，不再無條件清空）
    if (!dailyLogData) {
      console.log(`[KIDIT Sync] 日期 ${dateStr} 的日誌已刪除，重建 kidit_logbook 事件（保留 ${vaeEvents.length} 筆已確認通路事件）...`)
      dailyLogData = { patientMovements: [], vascularAccessLog: [] }
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

    // 2-2. 工作日誌手動血管通路列（vascular_access_log JSON）已停產 access_ 事件（2026-07-23）：
    // 通路事件改走 vascular_access_events 主護填寫→組長確認→vae_ 事件；每日動態只顯示病人動態與已確認通路。
    // 既有掛了申報手填資料的舊 access_ 事件由步驟 4 的合併邏輯保留，勿在此恢復產生。

    // 2-2b. 併入已確認的血管通路事件（一樣吃 2-3 的透析模式快照補值）
    dailyLogEvents.push(...vaeEvents)

    console.log(`[KIDIT Sync] 從 daily_log 提取了 ${dailyLogEvents.length} 個事件（含 ${vaeEvents.length} 筆已確認通路事件）`)

    // 2-3. 補上病人當前透析模式（同步當下的快照；重新同步時會更新）。
    // 查無模式時不設欄位，讓合併時保留既有值，避免病人資料被清空後抹掉歷史正確模式。
    if (dailyLogEvents.length > 0) {
      const modeMap = buildPatientModeMap(db, dailyLogEvents.map(e => e.patientId))
      dailyLogEvents.forEach(e => {
        const mode = modeMap.get(e.patientId)
        if (mode) e.dialysisMode = mode
      })
    }

    // 3. 即使今日無新產生事件也要走合併——既有 access_ 事件可能掛著申報手填資料需保留，
    //    不能像舊版直接把 events 清成 '[]'。

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
      } else if (
        String(existing.id || '').startsWith('access_') &&
        (existing.kidit_profile || existing.kidit_history || existing.kidit_vascular ||
          existing.isRegistered || existing.transferOutHospital)
      ) {
        // 相容舊資料：access_ 事件已停產，但上面掛了建檔/造管手填資料或勾選者原樣保留，
        // 避免該日重建時連申報資料一起消失；純顯示用的 access_ 事件則隨重建淘汰
        eventsMap.set(existing.id, existing)
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
      dialysisMode: e.dialysisMode || '',
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
 * 以 DB 現況重新同步某日的 kidit_logbook。
 * 供血管通路事件 confirm/reject/編輯/刪除後呼叫（那些操作不經工作日誌整包 PUT）。
 * 無日誌 row 時傳空結構而非 null——避免誤走「日誌刪除」訊息路徑。
 */
export async function resyncKiditForDate(dateStr) {
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM daily_logs WHERE date = ?').get(dateStr)
  const dailyLogData = row
    ? {
        patientMovements: row.patient_movements,
        vascularAccessLog: row.vascular_access_log,
        createdAt: row.created_at,
      }
    : { patientMovements: [], vascularAccessLog: [] }
  return syncEventsToKiditLogbook(dateStr, dailyLogData)
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
  resyncKiditForDate,
  getKiditLogbook,
  updateKiditEvent,
  updateKiditEvents,
  listKiditLogbooks,
}
