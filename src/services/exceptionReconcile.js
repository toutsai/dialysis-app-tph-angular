// 調班整併服務
// 處理「隔日換床」的單日 MOVE 調班：同病人同日多次調動只保留一筆（from 永遠錨定常規原位、
// to 換成最新位置；拖回常規原位則取消），並把鏡像對（甲↔乙互換）收斂成一筆 SWAP。
// 帳本整併後一律以 rebuildSingleDaySchedule 重算當日排程寫回，確保「存檔不會錯」。
import { v4 as uuidv4 } from 'uuid'
import { getTaipeiDayIndex, getTaipeiTodayString } from '../utils/dateUtils.js'
import { SHIFTS, FREQ_MAP_TO_DAY_INDEX, getScheduleKey } from '../utils/scheduleUtils.js'
import { rebuildSingleDaySchedule } from './scheduleSync.js'
import { removeAutoMovementFromDailyLog } from './dailyLogMovementSync.js'

// 視為「已生效或待生效」的調班狀態（整併/鏡像偵測時需納入考量）
const ACTIVE_STATUSES = ['pending', 'processing', 'applied', 'conflict_requires_resolution']

/**
 * 取得病人在某日的「常規」床位（純總表，未疊調班）
 * @returns {{ bedNum: string|number, shiftCode: string } | null}
 */
export function getPatientBasePosition(masterRules, patientId, dateStr) {
  const rule = masterRules?.[patientId]
  if (!rule || !rule.freq) return null

  const targetDate = new Date(dateStr + 'T00:00:00Z')
  if (isNaN(targetDate.getTime())) return null

  const dayIndex = getTaipeiDayIndex(targetDate)
  const freqDays = FREQ_MAP_TO_DAY_INDEX[rule.freq] || []
  if (!freqDays.includes(dayIndex)) return null

  const { bedNum, shiftIndex } = rule
  if (bedNum === undefined || shiftIndex === undefined) return null

  const shiftCode = SHIFTS[shiftIndex]
  if (!shiftCode) return null

  return { bedNum, shiftCode }
}

/** 判斷一筆調班資料是否為「單日換床」(隔日換床) —— 僅這類走整併路徑 */
export function isSingleDayMove(data) {
  return (
    data?.type === 'MOVE' &&
    !!data.from?.sourceDate &&
    !!data.to?.goalDate &&
    data.from.sourceDate === data.to.goalDate
  )
}

function parseExceptionRow(row) {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    patientId: row.patient_id,
    patientName: row.patient_name,
    from: row.from_data ? JSON.parse(row.from_data) : {},
    to: row.to_data ? JSON.parse(row.to_data) : {},
    date: row.date,
  }
}

/** 取得某日所有「生效中」的單日 MOVE 調班 */
function getActiveMovesForDate(db, dateStr) {
  const placeholders = ACTIVE_STATUSES.map(() => '?').join(',')
  const rows = db
    .prepare(`SELECT * FROM schedule_exceptions WHERE type = 'MOVE' AND status IN (${placeholders})`)
    .all(...ACTIVE_STATUSES)
  return rows
    .map(parseExceptionRow)
    .filter((ex) => ex.from?.sourceDate === dateStr && ex.to?.goalDate === dateStr)
}

/**
 * 取得本病人「跨日移入當日」的既有 MOVE（from 在他日、to 落在當日）
 * 例：把週二常規場次提前到週一（跨日），之後又在週一當日換床，應併入這筆而非另開單日 MOVE。
 */
function getActiveCrossDayMoveLandingOn(db, dateStr, patientId) {
  const placeholders = ACTIVE_STATUSES.map(() => '?').join(',')
  const rows = db
    .prepare(
      `SELECT * FROM schedule_exceptions WHERE type = 'MOVE' AND patient_id = ? AND status IN (${placeholders})`,
    )
    .all(patientId, ...ACTIVE_STATUSES)
  return (
    rows
      .map(parseExceptionRow)
      .find(
        (ex) =>
          ex.to?.goalDate === dateStr &&
          ex.from?.sourceDate &&
          ex.from.sourceDate !== dateStr,
      ) || null
  )
}

function cancelException(db, id) {
  db.prepare(`
    UPDATE schedule_exceptions
    SET status = 'cancelled',
        cancelled_at = datetime('now', 'localtime'),
        updated_at = datetime('now', 'localtime')
    WHERE id = ?
  `).run(id)
}

/** 取得某日所有「生效中」的 SWAP 調班 */
function getActiveSwapsForDate(db, dateStr) {
  const placeholders = ACTIVE_STATUSES.map(() => '?').join(',')
  const rows = db
    .prepare(`SELECT * FROM schedule_exceptions WHERE type = 'SWAP' AND status IN (${placeholders}) AND date = ?`)
    .all(...ACTIVE_STATUSES, dateStr)
  return rows.map((r) => ({
    id: r.id,
    patient1: r.patient1 ? JSON.parse(r.patient1) : {},
    patient2: r.patient2 ? JSON.parse(r.patient2) : {},
  }))
}

/** 寫入一筆已生效的 SWAP，回傳 id */
function insertSwap(db, dateStr, p1, p2, reason, createdBy) {
  const swapId = uuidv4()
  db.prepare(`
    INSERT INTO schedule_exceptions (
      id, type, status, patient_id, patient_name,
      from_data, to_data, patient1, patient2,
      start_date, end_date, date, reason, created_by
    ) VALUES (?, 'SWAP', 'applied', ?, ?, '{}', '{}', ?, ?, ?, ?, ?, ?, ?)
  `).run(
    swapId,
    p1.patientId,
    p1.patientName || null,
    JSON.stringify(p1),
    JSON.stringify(p2),
    dateStr,
    dateStr,
    dateStr,
    reason,
    JSON.stringify(createdBy),
  )
  return swapId
}

/**
 * 整併一筆新的單日 MOVE 調班（在呼叫端的 transaction 內執行）
 * 只動 schedule_exceptions 帳本，不寫 schedules（由呼叫端 rebuild 後統一寫回）
 * @returns {{ action: 'merged'|'cancelled'|'swapped'|'created', ids: string[], swappedWith?: string }}
 */
export function reconcileMoveLedger(db, data, masterRules, createdBy = {}) {
  const dateStr = data.to.goalDate
  const patientId = data.patientId

  // from 永遠錨定常規原位；取不到常規位置（病人當日不在總表）才退回送入的 from
  const base = getPatientBasePosition(masterRules, patientId, dateStr)
  const fromData = base
    ? { sourceDate: dateStr, bedNum: base.bedNum, shiftCode: base.shiftCode }
    : data.from

  const fromKey = getScheduleKey(fromData.bedNum, fromData.shiftCode)
  const toKey = getScheduleKey(data.to.bedNum, data.to.shiftCode)

  const activeMoves = getActiveMovesForDate(db, dateStr)
  const activeSwaps = getActiveSwapsForDate(db, dateStr)

  // 本病人若已在某筆 SWAP 內，先取消（即將重算其位置；對方於 rebuild 自動回歸常規）
  activeSwaps
    .filter((sw) => sw.patient1?.patientId === patientId || sw.patient2?.patientId === patientId)
    .forEach((sw) => cancelException(db, sw.id))

  const existingForPatient = activeMoves.find((ex) => ex.patientId === patientId)

  // Case A：拖回常規原位 → 取消既有調班、不建立新筆
  if (base && toKey === fromKey) {
    if (existingForPatient) cancelException(db, existingForPatient.id)
    return { action: 'cancelled', ids: existingForPatient ? [existingForPatient.id] : [] }
  }

  // Case A2：本病人已有「跨日移入當日」的調班（如提前/延後洗），現又於當日換床 →
  // 就地更新那筆的 to（保留跨日來源 from），不另開單日 MOVE，避免兩筆未整併。
  // 僅在沒有同日既有 MOVE 時處理（同日既有由下方 Case C 負責）。
  if (!existingForPatient) {
    const incomingCrossDayMove = getActiveCrossDayMoveLandingOn(db, dateStr, patientId)
    if (incomingCrossDayMove) {
      db.prepare(`
        UPDATE schedule_exceptions
        SET to_data = ?, status = 'applied', error_message = NULL,
            updated_at = datetime('now', 'localtime')
        WHERE id = ?
      `).run(
        JSON.stringify({ goalDate: dateStr, bedNum: data.to.bedNum, shiftCode: data.to.shiftCode }),
        incomingCrossDayMove.id,
      )
      return { action: 'merged', ids: [incomingCrossDayMove.id] }
    }
  }

  // Case B：顯式鏡像對（對方已有反向 MOVE）→ 收斂成 SWAP
  const mirror = activeMoves.find(
    (ex) =>
      ex.patientId !== patientId &&
      getScheduleKey(ex.to.bedNum, ex.to.shiftCode) === fromKey && // 對方移入「我的常規位」
      getScheduleKey(ex.from.bedNum, ex.from.shiftCode) === toKey, // 對方常規位 == 我的目標
  )
  if (mirror) {
    const swapId = insertSwap(
      db,
      dateStr,
      { patientId, patientName: data.patientName, fromBedNum: fromData.bedNum, fromShiftCode: fromData.shiftCode },
      {
        patientId: mirror.patientId,
        patientName: mirror.patientName,
        fromBedNum: mirror.from.bedNum,
        fromShiftCode: mirror.from.shiftCode,
      },
      `${data.patientName || ''} 與 ${mirror.patientName || ''} 互換床位`,
      createdBy,
    )
    cancelException(db, mirror.id)
    if (existingForPatient) cancelException(db, existingForPatient.id)
    return { action: 'swapped', ids: [swapId], swappedWith: mirror.id }
  }

  // ⚠️ 已移除 Case B2（單拖即猜測互換）：原本「拖到某床、該床常規主人沒在動 →
  // 自動收斂成 SWAP」會把使用者單純的 MOVE 在後台變成雙邊、依賴套用順序的 SWAP，
  // 主人若其實不在席（跨日移出/暫停）會產生必敗互換而卡死（2026-06-29 林芳杏案）。
  // 決議：單拖一律走純 MOVE；要對調請走 Case B（雙方都已下反向 MOVE）或手動互換表單。
  // 拖到「在席主人」的床會如實顯示衝突，交由人決定誰去誰留。勿再加回 B2。

  // Case C：同病人已有調班 → 就地更新 to（保留原始 from = 常規原位）
  if (existingForPatient) {
    db.prepare(`
      UPDATE schedule_exceptions
      SET to_data = ?, status = 'applied', error_message = NULL,
          updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(
      JSON.stringify({ goalDate: dateStr, bedNum: data.to.bedNum, shiftCode: data.to.shiftCode }),
      existingForPatient.id,
    )
    return { action: 'merged', ids: [existingForPatient.id] }
  }

  // Case D：全新 MOVE
  const id = uuidv4()
  db.prepare(`
    INSERT INTO schedule_exceptions (
      id, type, status, patient_id, patient_name,
      from_data, to_data, patient1, patient2,
      start_date, end_date, date, reason, created_by
    ) VALUES (?, 'MOVE', 'applied', ?, ?, ?, ?, '{}', '{}', ?, ?, ?, ?, ?)
  `).run(
    id,
    patientId,
    data.patientName || null,
    JSON.stringify(fromData),
    JSON.stringify({ goalDate: dateStr, bedNum: data.to.bedNum, shiftCode: data.to.shiftCode }),
    dateStr,
    dateStr,
    dateStr,
    data.reason || null,
    JSON.stringify(createdBy),
  )
  return { action: 'created', ids: [id] }
}

/**
 * 整併單日 MOVE 並重算當日排程寫回（含 transaction）
 * @returns {{ action: string, ids: string[], swappedWith?: string, schedule: object }}
 */
export function reconcileSingleDayMove(db, data, masterRules, patientsMap, createdBy = {}) {
  const dateStr = data.to.goalDate

  const run = db.transaction(() => {
    const result = reconcileMoveLedger(db, data, masterRules, createdBy)

    // 帳本已整併 → 從乾淨常規基準重算當日（含所有生效調班），確保排程正確
    const finalSchedule = rebuildSingleDaySchedule(dateStr, masterRules, patientsMap)

    const existing = db.prepare(`SELECT id FROM schedules WHERE date = ?`).get(dateStr)
    if (existing) {
      db.prepare(`
        UPDATE schedules
        SET schedule = ?, sync_method = 'reconcile_exception',
            last_modified_by = ?, updated_at = datetime('now', 'localtime')
        WHERE date = ?
      `).run(JSON.stringify(finalSchedule), JSON.stringify(createdBy), dateStr)
    } else {
      db.prepare(`
        INSERT INTO schedules (id, date, schedule, sync_method, last_modified_by, created_at, updated_at)
        VALUES (?, ?, ?, 'reconcile_exception', ?, datetime('now', 'localtime'), datetime('now', 'localtime'))
      `).run(dateStr, dateStr, JSON.stringify(finalSchedule), JSON.stringify(createdBy))
    }

    return { ...result, schedule: finalSchedule }
  })

  return run()
}

/**
 * 解決「總表修正後病人不在原床位」的衝突
 * @param {'keep_base'|'keep_exception'} choice
 * @returns {{ ok: boolean, action: string, schedule?: object, message?: string }}
 */
export function resolveSourceConflict(db, exceptionId, choice, masterRules, patientsMap, modifiedBy = {}) {
  const row = db.prepare(`SELECT * FROM schedule_exceptions WHERE id = ?`).get(exceptionId)
  if (!row) return { ok: false, message: '調班申請不存在' }
  // MOVE 支援兩種選擇；ADD_SESSION（臨時加洗）只有「撤銷」有意義（無常規原位可回歸/錨定）
  if (row.type !== 'MOVE' && !(row.type === 'ADD_SESSION' && choice === 'keep_base')) {
    return { ok: false, message: '此調班類型僅支援撤銷或重新選床' }
  }

  const ex = parseExceptionRow(row)
  const dateStr = ex.to?.goalDate || ex.from?.sourceDate
  if (!dateStr) return { ok: false, message: '調班缺少日期資訊' }

  const run = db.transaction(() => {
    if (choice === 'keep_base') {
      // 維持新總表床位 → 取消調班，回歸常規
      if (row.type === 'ADD_SESSION') {
        // 比照 EXCEPTION_DELETE：連動移除工作日誌的「臨時加洗」自動動態
        removeAutoMovementFromDailyLog(db, dateStr, `auto_add_session_${exceptionId}`)
      }
      cancelException(db, exceptionId)
    } else {
      // 維持調班後新床位 → 把 from 重新錨定到病人的新常規位置，再重新生效
      const base = getPatientBasePosition(masterRules, ex.patientId, dateStr)
      const fromData = base
        ? { sourceDate: dateStr, bedNum: base.bedNum, shiftCode: base.shiftCode }
        : ex.from
      db.prepare(`
        UPDATE schedule_exceptions
        SET from_data = ?, status = 'applied', error_message = NULL,
            updated_at = datetime('now', 'localtime')
        WHERE id = ?
      `).run(JSON.stringify(fromData), exceptionId)
    }

    // 過去日不重算：該日已結束（多半已歸檔，即時檔不存在），重算寫不回文件，
    // 只會把當日其他調班重播一輪、誤掛新衝突旗（比照 EXCEPTION_DELETE 的過去日防護）。
    if (dateStr < getTaipeiTodayString()) return null

    const finalSchedule = rebuildSingleDaySchedule(dateStr, masterRules, patientsMap)
    const existing = db.prepare(`SELECT id FROM schedules WHERE date = ?`).get(dateStr)
    if (existing) {
      db.prepare(`
        UPDATE schedules
        SET schedule = ?, sync_method = 'reconcile_exception',
            last_modified_by = ?, updated_at = datetime('now', 'localtime')
        WHERE date = ?
      `).run(JSON.stringify(finalSchedule), JSON.stringify(modifiedBy), dateStr)
    }
    return finalSchedule
  })

  const schedule = run()
  return { ok: true, action: choice, schedule, dateStr, type: row.type }
}

/**
 * 就地修改衝突調班的目標床位（重新選床）
 * 取代前端「撤舊建新」的重提流程：保留原筆 id/歷史，只改 to_data 後重算當日。
 * 新床位在重算後仍衝突則整筆回滾（交易內），不會留下半套狀態。
 * @param {{ bedNum: string|number, shiftCode: string }} to - 新目標床位
 * @returns {{ ok: boolean, action?: string, schedule?: object, dateStr?: string, message?: string }}
 */
export function retargetConflict(db, exceptionId, to, masterRules, patientsMap, modifiedBy = {}) {
  const row = db.prepare(`SELECT * FROM schedule_exceptions WHERE id = ?`).get(exceptionId)
  if (!row) return { ok: false, message: '調班申請不存在' }
  if (row.type !== 'MOVE' && row.type !== 'ADD_SESSION') {
    return { ok: false, message: '僅支援 MOVE / ADD_SESSION 類型的重新選床' }
  }
  if (to?.bedNum === undefined || to?.bedNum === null || to?.bedNum === '' || !to?.shiftCode) {
    return { ok: false, message: '缺少新目標床位資訊' }
  }

  const ex = parseExceptionRow(row)
  const dateStr = ex.to?.goalDate || ex.date || ex.from?.sourceDate
  if (!dateStr) return { ok: false, message: '調班缺少日期資訊' }
  if (dateStr < getTaipeiTodayString()) {
    return { ok: false, message: '該調班日期已過，無法重新選床' }
  }

  const newToData = { ...ex.to, goalDate: dateStr, bedNum: to.bedNum, shiftCode: to.shiftCode }

  const run = db.transaction(() => {
    db.prepare(`
      UPDATE schedule_exceptions
      SET to_data = ?, status = 'applied', error_message = NULL,
          updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(JSON.stringify(newToData), exceptionId)

    const finalSchedule = rebuildSingleDaySchedule(dateStr, masterRules, patientsMap)

    // 防禦：picker 只給空床，但併發下新床可能剛被佔走——重算後此筆仍衝突就回滾
    const after = db
      .prepare(`SELECT status, error_message FROM schedule_exceptions WHERE id = ?`)
      .get(exceptionId)
    if (after?.status === 'conflict_requires_resolution') {
      throw new Error(after.error_message || '新選的床位仍有衝突，請重新選擇')
    }

    const existing = db.prepare(`SELECT id FROM schedules WHERE date = ?`).get(dateStr)
    if (existing) {
      db.prepare(`
        UPDATE schedules
        SET schedule = ?, sync_method = 'reconcile_exception',
            last_modified_by = ?, updated_at = datetime('now', 'localtime')
        WHERE date = ?
      `).run(JSON.stringify(finalSchedule), JSON.stringify(modifiedBy), dateStr)
    }
    return finalSchedule
  })

  try {
    const schedule = run()
    return { ok: true, action: 'retarget', schedule, dateStr, type: row.type }
  } catch (error) {
    return { ok: false, message: error?.message || '重新選床失敗' }
  }
}
