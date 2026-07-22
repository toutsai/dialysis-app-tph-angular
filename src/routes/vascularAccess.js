// 血管通路事件路由：主護填寫 → 組長確認 → KiDit 造管申報
// vascular_access_events 是唯一權威來源；工作日誌與 KiDit 清單都是視圖。
// 刻意不寫進 daily_logs 的 vascular_access_log JSON（整包 PUT 無樂觀鎖會被互蓋），
// 也刻意不套 isDailyLogLockedForUser（組長常隔天才確認前一日事件，事件表有自己的狀態機）。
import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { getDatabase } from '../db/init.js'
import { authenticate, isContributor, isEditor, hasPermission, logAudit } from '../middleware/auth.js'
import { resyncKiditForDate } from '../services/kiditSync.js'

const router = Router()

// 造管 CSV 代碼表（與前端 vascular-access-codes.ts 對齊）
const EVENT_TYPES = new Set(['intervention', 'reconstruction'])
// 官方代碼 4 與 3 文字重複（皆「血液流量過小」），前端 UI 不提供 4，後端刻意放行以容忍官方資料
const FAILURE_REASONS = new Set(['1', '2', '3', '4', '5', '6', '9'])
const REPAIR_METHODS = new Set(['1', '2', '3', '9'])
const ACCESS_TYPES = new Set(['AVF', 'AVG', 'PERM', 'TEMP'])
const ACCESS_SIDES = new Set(['L', 'R'])
const FISTULA_SITES = new Set(['1', '2', '3', '4', '9'])
const CATHETER_SITES = new Set(['1', '2', '3', '9'])
const STATUSES = new Set(['pending', 'confirmed', 'rejected'])

function parseJsonSafe(str, fallback) {
  try {
    const parsed = JSON.parse(str)
    return parsed == null ? fallback : parsed
  } catch {
    return fallback
  }
}

function formatEvent(row) {
  return {
    id: row.id,
    patientId: row.patient_id,
    patientName: row.patient_name,
    medicalRecordNumber: row.medical_record_number,
    eventDate: row.event_date,
    eventType: row.event_type,
    failureReason: row.failure_reason,
    repairMethod: row.repair_method,
    repairMethodOther: row.repair_method_other,
    newAccessType: row.new_access_type,
    newAccessSide: row.new_access_side,
    newAccessSite: row.new_access_site,
    location: row.location,
    notes: row.notes,
    status: row.status,
    updatePatientMaster: !!row.update_patient_master,
    rejectReason: row.reject_reason,
    createdBy: parseJsonSafe(row.created_by, {}),
    confirmedBy: parseJsonSafe(row.confirmed_by, {}),
    confirmedAt: row.confirmed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // LEFT JOIN patients 附帶的現況（病人可能已轉住院/軟刪除）
    patientCurrentStatus: row.p_status ?? null,
    patientIsDeleted: row.p_is_deleted != null ? !!row.p_is_deleted : null,
  }
}

// 驗證事件欄位；回傳錯誤訊息字串，合法回傳 null
function validateEventPayload(body) {
  const { eventDate, eventType, failureReason, repairMethod, newAccessType, newAccessSide, newAccessSite } = body

  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate || '')) return '事件日期格式錯誤'
  if (!EVENT_TYPES.has(eventType)) return '事件類型錯誤'
  if (failureReason != null && failureReason !== '' && !FAILURE_REASONS.has(String(failureReason)))
    return '失敗原因代碼錯誤'

  if (eventType === 'intervention') {
    if (repairMethod != null && repairMethod !== '' && !REPAIR_METHODS.has(String(repairMethod)))
      return '重建方式代碼錯誤'
  } else {
    // reconstruction
    if (!ACCESS_TYPES.has(newAccessType)) return '新通路型態錯誤'
    if (newAccessSide != null && newAccessSide !== '' && !ACCESS_SIDES.has(newAccessSide))
      return '左右側值錯誤'
    if (newAccessSite != null && newAccessSite !== '') {
      const validSites = newAccessType === 'AVF' || newAccessType === 'AVG' ? FISTULA_SITES : CATHETER_SITES
      if (!validSites.has(String(newAccessSite))) return '通路位置代碼錯誤'
    }
  }
  return null
}

// 事件欄位 → DB 欄位（POST/PUT 共用；型態不符的欄位存 null 保持乾淨）
function extractEventColumns(body) {
  const isIntervention = body.eventType === 'intervention'
  return {
    event_date: body.eventDate,
    event_type: body.eventType,
    failure_reason: body.failureReason != null && body.failureReason !== '' ? String(body.failureReason) : null,
    repair_method: isIntervention && body.repairMethod != null && body.repairMethod !== '' ? String(body.repairMethod) : null,
    repair_method_other: isIntervention && String(body.repairMethod) === '9' ? (body.repairMethodOther || null) : null,
    new_access_type: !isIntervention ? body.newAccessType || null : null,
    new_access_side: !isIntervention ? body.newAccessSide || null : null,
    new_access_site: !isIntervention && body.newAccessSite != null && body.newAccessSite !== '' ? String(body.newAccessSite) : null,
    location: body.location || null,
    notes: body.notes || null,
    update_patient_master: body.updatePatientMaster === false ? 0 : 1,
  }
}

function canManageEvent(row, user) {
  // pending/rejected：建立者本人或 editor 以上；confirmed：僅 editor 以上
  const isEditorRole = hasPermission(user?.role, 'editor')
  if (row.status === 'confirmed') return isEditorRole
  const creator = parseJsonSafe(row.created_by, {})
  return isEditorRole || (creator.uid && creator.uid === user?.id)
}

// 重建事件寫回病人主檔的 vasc_access 字串（沿用既有值慣例：左手AVF/PERM/Double lumen）
function buildMasterVascAccess(event) {
  if (event.new_access_type === 'PERM') return 'PERM'
  const sideLabel = event.new_access_side === 'R' ? '右' : '左'
  // 位置代碼 2=上臂 用「臂」，其餘（前臂/大腿/小腿/其他）沿用最常見的「手」
  const limbLabel = String(event.new_access_site) === '2' ? '臂' : '手'
  return `${sideLabel}${limbLabel}${event.new_access_type}`
}

async function resyncKidit(dateStr) {
  try {
    await resyncKiditForDate(dateStr)
  } catch (error) {
    console.error('血管通路事件 KiDit 重新同步失敗 (非致命錯誤):', error)
  }
}

// 重建事件確認時連動病人主檔（transaction 內呼叫）。
// TEMP 短期導管不寫主檔（非長期通路型態）。回傳 {before, after} 或 null。
function applyReconstructionMasterUpdate(db, row) {
  if (
    !(
      row.event_type === 'reconstruction' &&
      row.update_patient_master &&
      row.new_access_type &&
      row.new_access_type !== 'TEMP'
    )
  ) {
    return null
  }
  const patient = db
    .prepare('SELECT id, vasc_access, access_creation_date FROM patients WHERE id = ?')
    .get(row.patient_id)
  if (!patient) return null
  const nextAccess = buildMasterVascAccess(row)
  const masterUpdate = {
    before: { vascAccess: patient.vasc_access, accessCreationDate: patient.access_creation_date },
    after: { vascAccess: nextAccess, accessCreationDate: row.event_date },
  }
  db.prepare(
    `UPDATE patients SET vasc_access = ?, access_creation_date = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`,
  ).run(nextAccess, row.event_date, patient.id)
  return masterUpdate
}

// ========================================
// 事件 CRUD
// ========================================

// 查詢事件（工作日誌合併視圖 / KiDit 清單 / 季度匯出共用）
router.get('/events', authenticate, (req, res) => {
  try {
    const { startDate, endDate, patientId, status } = req.query
    const db = getDatabase()

    const wheres = []
    const params = []
    if (startDate) {
      wheres.push('e.event_date >= ?')
      params.push(startDate)
    }
    if (endDate) {
      wheres.push('e.event_date <= ?')
      params.push(endDate)
    }
    if (patientId) {
      wheres.push('e.patient_id = ?')
      params.push(patientId)
    }
    if (status && STATUSES.has(status)) {
      wheres.push('e.status = ?')
      params.push(status)
    }

    const rows = db
      .prepare(
        `SELECT e.*, p.status AS p_status, p.is_deleted AS p_is_deleted
         FROM vascular_access_events e
         LEFT JOIN patients p ON p.id = e.patient_id
         ${wheres.length ? `WHERE ${wheres.join(' AND ')}` : ''}
         ORDER BY e.event_date, e.created_at`,
      )
      .all(...params)

    res.json({ success: true, events: rows.map(formatEvent) })
  } catch (error) {
    console.error('查詢血管通路事件錯誤:', error)
    res.status(500).json({ error: true, message: '查詢血管通路事件失敗' })
  }
})

// 建立事件。主護建立=pending 待組長確認；組長（editor）可帶 confirmed:true
// 直接建立為已確認（工作日誌補登用，填寫人=確認人，儲存即進 KiDit 並連動主檔）。
router.post('/events', ...isContributor, async (req, res) => {
  try {
    const db = getDatabase()
    const { patientId } = req.body
    const directConfirm = req.body.confirmed === true

    if (directConfirm && !hasPermission(req.user?.role, 'editor')) {
      return res.status(403).json({ error: true, message: '直接確認需要組長(editor)以上權限' })
    }

    const patient = db
      .prepare('SELECT id, name, medical_record_number FROM patients WHERE id = ?')
      .get(patientId)
    if (!patient) {
      return res.status(400).json({ error: true, message: '找不到病人' })
    }

    const validationError = validateEventPayload(req.body)
    if (validationError) {
      return res.status(400).json({ error: true, message: validationError })
    }

    const id = uuidv4()
    const cols = extractEventColumns(req.body)
    const userJson = JSON.stringify({ uid: req.user.id, name: req.user.name })
    const status = directConfirm ? 'confirmed' : 'pending'

    let masterUpdate = null
    const insertTx = db.transaction(() => {
      db.prepare(
        `INSERT INTO vascular_access_events (
           id, patient_id, patient_name, medical_record_number,
           event_date, event_type, failure_reason, repair_method, repair_method_other,
           new_access_type, new_access_side, new_access_site,
           location, notes, status, update_patient_master, created_by, confirmed_by,
           confirmed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
           CASE WHEN ? = 'confirmed' THEN datetime('now', 'localtime') END)`,
      ).run(
        id,
        patient.id,
        patient.name,
        patient.medical_record_number || '',
        cols.event_date,
        cols.event_type,
        cols.failure_reason,
        cols.repair_method,
        cols.repair_method_other,
        cols.new_access_type,
        cols.new_access_side,
        cols.new_access_site,
        cols.location,
        cols.notes,
        status,
        cols.update_patient_master,
        userJson,
        directConfirm ? userJson : '{}',
        status,
      )
      if (directConfirm) {
        const row = db.prepare('SELECT * FROM vascular_access_events WHERE id = ?').get(id)
        masterUpdate = applyReconstructionMasterUpdate(db, row)
      }
    })
    insertTx()

    if (directConfirm) {
      await logAudit('CONFIRM_VASCULAR_EVENT', req.user.id, req.user.name, 'vascular_access_events', id, {
        patientId: patient.id,
        patientName: patient.name,
        eventDate: cols.event_date,
        eventType: cols.event_type,
        directCreate: true,
        masterUpdate,
      })
      await resyncKidit(cols.event_date)
    }

    const row = db.prepare('SELECT * FROM vascular_access_events WHERE id = ?').get(id)
    res.json({ success: true, event: formatEvent(row), masterUpdated: !!masterUpdate })
  } catch (error) {
    console.error('建立血管通路事件錯誤:', error)
    res.status(500).json({ error: true, message: '建立血管通路事件失敗' })
  }
})

// 編輯事件（rejected 被編輯後自動回 pending 重送審；confirmed 僅 editor 可改，改後重新同步 KiDit）
router.put('/events/:id', ...isContributor, async (req, res) => {
  try {
    const db = getDatabase()
    const row = db.prepare('SELECT * FROM vascular_access_events WHERE id = ?').get(req.params.id)
    if (!row) {
      return res.status(404).json({ error: true, message: '找不到事件' })
    }
    if (!canManageEvent(row, req.user)) {
      return res.status(403).json({ error: true, message: '沒有權限編輯此事件' })
    }

    const payload = { ...formatEvent(row), ...req.body }
    const validationError = validateEventPayload(payload)
    if (validationError) {
      return res.status(400).json({ error: true, message: validationError })
    }

    const cols = extractEventColumns(payload)
    const nextStatus = row.status === 'rejected' ? 'pending' : row.status
    db.prepare(
      `UPDATE vascular_access_events SET
         event_date = ?, event_type = ?, failure_reason = ?, repair_method = ?, repair_method_other = ?,
         new_access_type = ?, new_access_side = ?, new_access_site = ?,
         location = ?, notes = ?, update_patient_master = ?,
         status = ?, reject_reason = CASE WHEN ? = 'pending' THEN NULL ELSE reject_reason END,
         updated_at = datetime('now', 'localtime')
       WHERE id = ?`,
    ).run(
      cols.event_date,
      cols.event_type,
      cols.failure_reason,
      cols.repair_method,
      cols.repair_method_other,
      cols.new_access_type,
      cols.new_access_side,
      cols.new_access_site,
      cols.location,
      cols.notes,
      cols.update_patient_master,
      nextStatus,
      nextStatus,
      row.id,
    )

    // confirmed 事件內容變動要反映到 kidit_logbook；日期被改時新舊兩天都要重算
    if (row.status === 'confirmed') {
      await resyncKidit(row.event_date)
      if (cols.event_date !== row.event_date) await resyncKidit(cols.event_date)
    }

    const saved = db.prepare('SELECT * FROM vascular_access_events WHERE id = ?').get(row.id)
    res.json({ success: true, event: formatEvent(saved) })
  } catch (error) {
    console.error('更新血管通路事件錯誤:', error)
    res.status(500).json({ error: true, message: '更新血管通路事件失敗' })
  }
})

// 組長確認（editor）：確認後進 KiDit；重建事件連動更新病人主檔通路資料
router.put('/events/:id/confirm', ...isEditor, async (req, res) => {
  try {
    const db = getDatabase()
    const row = db.prepare('SELECT * FROM vascular_access_events WHERE id = ?').get(req.params.id)
    if (!row) {
      return res.status(404).json({ error: true, message: '找不到事件' })
    }
    if (row.status === 'confirmed') {
      return res.status(400).json({ error: true, message: '事件已確認' })
    }

    let masterUpdate = null
    const confirmTx = db.transaction(() => {
      db.prepare(
        `UPDATE vascular_access_events SET
           status = 'confirmed', reject_reason = NULL,
           confirmed_by = ?, confirmed_at = datetime('now', 'localtime'),
           updated_at = datetime('now', 'localtime')
         WHERE id = ?`,
      ).run(JSON.stringify({ uid: req.user.id, name: req.user.name }), row.id)

      masterUpdate = applyReconstructionMasterUpdate(db, row)
    })
    confirmTx()

    await logAudit('CONFIRM_VASCULAR_EVENT', req.user.id, req.user.name, 'vascular_access_events', row.id, {
      patientId: row.patient_id,
      patientName: row.patient_name,
      eventDate: row.event_date,
      eventType: row.event_type,
      masterUpdate,
    })

    await resyncKidit(row.event_date)

    const saved = db.prepare('SELECT * FROM vascular_access_events WHERE id = ?').get(row.id)
    res.json({
      success: true,
      event: formatEvent(saved),
      masterUpdated: !!masterUpdate,
    })
  } catch (error) {
    console.error('確認血管通路事件錯誤:', error)
    res.status(500).json({ error: true, message: '確認血管通路事件失敗' })
  }
})

// 組長退回（editor）：pending 退回或撤銷 confirmed。
// 撤銷已確認事件不回滾病人主檔（可能已被手動改過），由回應提示自行檢查。
router.put('/events/:id/reject', ...isEditor, async (req, res) => {
  try {
    const db = getDatabase()
    const row = db.prepare('SELECT * FROM vascular_access_events WHERE id = ?').get(req.params.id)
    if (!row) {
      return res.status(404).json({ error: true, message: '找不到事件' })
    }
    if (row.status === 'rejected') {
      return res.status(400).json({ error: true, message: '事件已是退回狀態' })
    }

    const wasConfirmed = row.status === 'confirmed'
    db.prepare(
      `UPDATE vascular_access_events SET
         status = 'rejected', reject_reason = ?,
         updated_at = datetime('now', 'localtime')
       WHERE id = ?`,
    ).run(req.body?.rejectReason || null, row.id)

    await logAudit('REJECT_VASCULAR_EVENT', req.user.id, req.user.name, 'vascular_access_events', row.id, {
      patientId: row.patient_id,
      patientName: row.patient_name,
      eventDate: row.event_date,
      wasConfirmed,
      rejectReason: req.body?.rejectReason || null,
    })

    if (wasConfirmed) await resyncKidit(row.event_date)

    const saved = db.prepare('SELECT * FROM vascular_access_events WHERE id = ?').get(row.id)
    res.json({
      success: true,
      event: formatEvent(saved),
      masterCheckHint:
        wasConfirmed && row.event_type === 'reconstruction' && row.update_patient_master
          ? '此事件確認時曾更新病人主檔通路資料，請自行檢查是否需要改回'
          : null,
    })
  } catch (error) {
    console.error('退回血管通路事件錯誤:', error)
    res.status(500).json({ error: true, message: '退回血管通路事件失敗' })
  }
})

// 刪除事件
router.delete('/events/:id', ...isContributor, async (req, res) => {
  try {
    const db = getDatabase()
    const row = db.prepare('SELECT * FROM vascular_access_events WHERE id = ?').get(req.params.id)
    if (!row) {
      return res.status(404).json({ error: true, message: '找不到事件' })
    }
    if (!canManageEvent(row, req.user)) {
      return res.status(403).json({ error: true, message: '沒有權限刪除此事件' })
    }

    db.prepare('DELETE FROM vascular_access_events WHERE id = ?').run(row.id)

    await logAudit('DELETE_VASCULAR_EVENT', req.user.id, req.user.name, 'vascular_access_events', row.id, {
      patientId: row.patient_id,
      patientName: row.patient_name,
      eventDate: row.event_date,
      status: row.status,
    })

    if (row.status === 'confirmed') await resyncKidit(row.event_date)

    res.json({ success: true })
  } catch (error) {
    console.error('刪除血管通路事件錯誤:', error)
    res.status(500).json({ error: true, message: '刪除血管通路事件失敗' })
  }
})

// ========================================
// 季度匯出的人工欄與覆寫（血流量/並存通路等；快照與事件欄由前端即時重算）
// ========================================

router.get('/quarter-exports/:quarter', authenticate, (req, res) => {
  try {
    const { quarter } = req.params
    if (!/^\d{4}Q[1-4]$/.test(quarter)) {
      return res.status(400).json({ error: true, message: '季度格式錯誤（例：2026Q3）' })
    }
    const db = getDatabase()
    const rows = db
      .prepare('SELECT * FROM vascular_quarter_exports WHERE quarter = ?')
      .all(quarter)
    res.json({
      success: true,
      quarter,
      overrides: rows.map((row) => ({
        patientId: row.patient_id,
        overrides: parseJsonSafe(row.overrides, {}),
        updatedBy: parseJsonSafe(row.updated_by, {}),
        updatedAt: row.updated_at,
      })),
    })
  } catch (error) {
    console.error('查詢季度匯出覆寫錯誤:', error)
    res.status(500).json({ error: true, message: '查詢季度匯出覆寫失敗' })
  }
})

router.put('/quarter-exports/:quarter/:patientId', ...isEditor, (req, res) => {
  try {
    const { quarter, patientId } = req.params
    if (!/^\d{4}Q[1-4]$/.test(quarter)) {
      return res.status(400).json({ error: true, message: '季度格式錯誤（例：2026Q3）' })
    }
    const db = getDatabase()
    const overrides = req.body?.overrides && typeof req.body.overrides === 'object' ? req.body.overrides : {}
    db.prepare(
      `INSERT INTO vascular_quarter_exports (id, quarter, patient_id, overrides, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))
       ON CONFLICT(id) DO UPDATE SET
         overrides = excluded.overrides,
         updated_by = excluded.updated_by,
         updated_at = datetime('now', 'localtime')`,
    ).run(
      `${quarter}_${patientId}`,
      quarter,
      patientId,
      JSON.stringify(overrides),
      JSON.stringify({ uid: req.user.id, name: req.user.name }),
    )
    res.json({ success: true })
  } catch (error) {
    console.error('儲存季度匯出覆寫錯誤:', error)
    res.status(500).json({ error: true, message: '儲存季度匯出覆寫失敗' })
  }
})

export default router
