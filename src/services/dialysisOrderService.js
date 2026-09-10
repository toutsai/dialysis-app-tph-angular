import { v4 as uuidv4 } from 'uuid'
import { getDatabase } from '../db/init.js'
import { normalizeDialysisOrdersMode } from '../utils/dialysisMode.js'
import { applyPatientModeChange, snapshotPatientScheduleChange } from './patientOrderEffects.js'

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)

function invalid(message) {
  return Object.assign(new Error(message), { status: 400 })
}

/**
 * 未傳欄位保留；有傳的值（包含 null、空字串、空物件）明確取代原值。
 * 不限定醫囑欄位白名單，避免丟掉其他模式及後續新增的醫囑資料。
 */
export function mergeDialysisOrders(existing, patch) {
  if (!isObject(patch) || Object.keys(patch).length === 0) {
    throw invalid('醫囑必須是包含更新欄位的物件')
  }
  for (const key of ['mode', 'freq', 'memo']) {
    if (patch[key] !== undefined && patch[key] !== null && typeof patch[key] !== 'string') {
      throw invalid(`${key} 必須是文字或 null`)
    }
  }
  for (const key of ['crrtOrders', 'firstDialysisPlan']) {
    if (patch[key] !== undefined && patch[key] !== null && !isObject(patch[key])) {
      throw invalid(`${key} 必須是物件或 null`)
    }
  }
  return normalizeDialysisOrdersMode({ ...existing, ...patch })
}

/** 單一儲存入口：目前醫囑、完整歷史、必要病人連動皆在同步交易內。 */
export function saveDialysisOrder(data, user) {
  if (!isObject(data) || typeof data.patientId !== 'string' || !data.patientId.trim()) {
    throw invalid('病人 ID 為必填')
  }
  if (data.operationType !== undefined && typeof data.operationType !== 'string') {
    throw invalid('操作類型必須是文字')
  }
  // 先驗證輸入，拒絕無效請求時不進入寫入流程。
  mergeDialysisOrders({}, data.orders)
  const db = getDatabase()
  const afterCommit = []
  const result = db.transaction(() => {
    const existing = db.prepare('SELECT * FROM patients WHERE id = ?').get(data.patientId)
    if (!existing) throw Object.assign(new Error('病人不存在'), { status: 404 })
    const orders = mergeDialysisOrders(JSON.parse(existing.dialysis_orders || '{}'), data.orders)
    const serialized = JSON.stringify(orders)
    const id = uuidv4()
    const operationType = data.operationType || 'CREATE'
    const patientName = existing.name
    const options = { strict: true, afterCommit }

    db.prepare(`UPDATE patients SET dialysis_orders = ?, last_modified_by = ?,
      updated_at = datetime('now', 'localtime') WHERE id = ?`).run(
      serialized, JSON.stringify({ uid: user.id, name: user.name }), existing.id,
    )
    const updated = db.prepare('SELECT * FROM patients WHERE id = ?').get(existing.id)
    snapshotPatientScheduleChange(db, existing, updated, data, user, options)
    const deletedFutureExceptions = applyPatientModeChange(db, existing, updated, user, options)
    db.prepare(`INSERT INTO dialysis_orders_history (id, patient_id, patient_name, operation_type, orders)
      VALUES (?, ?, ?, ?, ?)`).run(id, existing.id, patientName, operationType, serialized)

    return { id, patientId: existing.id, patientName, operationType, orders, deletedFutureExceptions }
  })()

  // SSE 與既有 KiDit 同步只能看到已提交的狀態。
  for (const notify of afterCommit) {
    try { notify() } catch (error) { console.warn('[DialysisOrder] 通知失敗:', error.message) }
  }
  return result
}
