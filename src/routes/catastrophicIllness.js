// 重大傷病申請路由（慢性腎衰竭定期透析重大傷病證明申請附表：初次/再次）
// 限 admin/contributor（醫師與專師）——刻意排除 editor，勿改成階層式 requireRole
import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { getDatabase } from '../db/init.js'
import { authenticate, requireAnyRole } from '../middleware/auth.js'

const router = Router()

const isCatastrophicIllnessRole = [authenticate, requireAnyRole('admin', 'contributor')]

const VALID_TYPES = ['initial', 'renewal']

function toApiShape(row) {
  let formData = {}
  let createdBy = {}
  let updatedBy = {}
  try { formData = JSON.parse(row.form_data || '{}') } catch { /* 留空物件 */ }
  try { createdBy = JSON.parse(row.created_by || '{}') } catch { /* 留空物件 */ }
  try { updatedBy = JSON.parse(row.updated_by || '{}') } catch { /* 留空物件 */ }
  return {
    id: row.id,
    patientId: row.patient_id,
    patientName: row.patient_name,
    applicationType: row.application_type,
    formData,
    createdBy,
    updatedBy,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/**
 * GET /api/catastrophic-illness
 * 申請紀錄列表（可用 ?patientId= 過濾）
 */
router.get('/', ...isCatastrophicIllnessRole, (req, res) => {
  try {
    const { patientId } = req.query
    const db = getDatabase()

    let query = 'SELECT * FROM catastrophic_illness_applications'
    const params = []
    if (patientId) {
      query += ' WHERE patient_id = ?'
      params.push(patientId)
    }
    query += ' ORDER BY updated_at DESC'

    const rows = db.prepare(query).all(...params)
    res.json(rows.map(toApiShape))
  } catch (error) {
    console.error('取得重大傷病申請列表錯誤:', error)
    res.status(500).json({ error: true, message: '取得重大傷病申請列表失敗' })
  }
})

/**
 * GET /api/catastrophic-illness/:id
 * 單筆申請
 */
router.get('/:id', ...isCatastrophicIllnessRole, (req, res) => {
  try {
    const db = getDatabase()
    const row = db.prepare('SELECT * FROM catastrophic_illness_applications WHERE id = ?').get(req.params.id)
    if (!row) {
      return res.status(404).json({ error: true, message: '申請紀錄不存在' })
    }
    res.json(toApiShape(row))
  } catch (error) {
    console.error('取得重大傷病申請錯誤:', error)
    res.status(500).json({ error: true, message: '取得重大傷病申請失敗' })
  }
})

/**
 * POST /api/catastrophic-illness
 * 新增申請
 */
router.post('/', ...isCatastrophicIllnessRole, (req, res) => {
  try {
    const { patientId, patientName, applicationType, formData } = req.body

    if (!patientId || !patientName) {
      return res.status(400).json({ error: true, message: '病人為必填' })
    }
    if (!VALID_TYPES.includes(applicationType)) {
      return res.status(400).json({ error: true, message: '申請類別必須為 initial 或 renewal' })
    }

    const id = uuidv4()
    const db = getDatabase()
    const userJson = JSON.stringify({ uid: req.user.id, name: req.user.name })

    db.prepare(`
      INSERT INTO catastrophic_illness_applications
        (id, patient_id, patient_name, application_type, form_data, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, patientId, patientName, applicationType, JSON.stringify(formData || {}), userJson, userJson)

    const created = db.prepare('SELECT * FROM catastrophic_illness_applications WHERE id = ?').get(id)
    res.status(201).json(toApiShape(created))
  } catch (error) {
    console.error('新增重大傷病申請錯誤:', error)
    res.status(500).json({ error: true, message: '新增重大傷病申請失敗' })
  }
})

/**
 * PUT /api/catastrophic-illness/:id
 * 更新申請（表單內容/類別）
 */
router.put('/:id', ...isCatastrophicIllnessRole, (req, res) => {
  try {
    const { id } = req.params
    const { applicationType, formData } = req.body
    const db = getDatabase()

    const existing = db.prepare('SELECT * FROM catastrophic_illness_applications WHERE id = ?').get(id)
    if (!existing) {
      return res.status(404).json({ error: true, message: '申請紀錄不存在' })
    }

    const nextType = applicationType !== undefined ? applicationType : existing.application_type
    if (!VALID_TYPES.includes(nextType)) {
      return res.status(400).json({ error: true, message: '申請類別必須為 initial 或 renewal' })
    }
    const nextFormData = formData !== undefined ? JSON.stringify(formData || {}) : existing.form_data

    db.prepare(`
      UPDATE catastrophic_illness_applications
      SET application_type = ?, form_data = ?, updated_by = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(nextType, nextFormData, JSON.stringify({ uid: req.user.id, name: req.user.name }), id)

    const updated = db.prepare('SELECT * FROM catastrophic_illness_applications WHERE id = ?').get(id)
    res.json(toApiShape(updated))
  } catch (error) {
    console.error('更新重大傷病申請錯誤:', error)
    res.status(500).json({ error: true, message: '更新重大傷病申請失敗' })
  }
})

/**
 * DELETE /api/catastrophic-illness/:id
 * 刪除申請
 */
router.delete('/:id', ...isCatastrophicIllnessRole, (req, res) => {
  try {
    const db = getDatabase()
    const result = db.prepare('DELETE FROM catastrophic_illness_applications WHERE id = ?').run(req.params.id)
    if (result.changes === 0) {
      return res.status(404).json({ error: true, message: '申請紀錄不存在' })
    }
    res.json({ success: true, message: '申請紀錄已刪除' })
  } catch (error) {
    console.error('刪除重大傷病申請錯誤:', error)
    res.status(500).json({ error: true, message: '刪除重大傷病申請失敗' })
  }
})

export default router
