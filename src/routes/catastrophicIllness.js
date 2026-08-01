// 重大傷病申請路由（慢性腎衰竭定期透析重大傷病證明申請附表：初次/再次）
// 限 admin/contributor（醫師與專師）——刻意排除 editor，勿改成階層式 requireRole
import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { getDatabase } from '../db/init.js'
import { authenticate, requireAnyRole } from '../middleware/auth.js'

const router = Router()

const isCatastrophicIllnessRole = [authenticate, requireAnyRole('admin', 'contributor')]
// 進度總覽：醫師（contributor）看自己寫的、書記（viewer）與 admin 看全部
const isOverviewRole = [authenticate, requireAnyRole('admin', 'contributor', 'viewer')]
// 書記欄位（送出日期/到期日）：由書記輸入——書記帳號是 viewer；admin 亦可
const isClerkRole = [authenticate, requireAnyRole('admin', 'viewer')]

const VALID_TYPES = ['initial', 'renewal']

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
function isValidDateOrEmpty(v) {
  return v === '' || v === null || v === undefined || (typeof v === 'string' && DATE_RE.test(v))
}

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
    clerkSentDate: row.clerk_sent_date || '',
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
 * GET /api/catastrophic-illness/overview
 * 申請進度總覽：每病人一列，含負責醫師、各次申請（初次/再次/三次/四次…不限次數）的醫師簽章日期（完成日期）、書記送出日期、重大傷病到期日
 * 醫師（contributor）只回自己建立的紀錄；admin 與書記（viewer）回全部
 * ⚠️ 必須定義在 GET /:id 之前，否則會被 /:id 攔截
 */
router.get('/overview', ...isOverviewRole, (req, res) => {
  try {
    const db = getDatabase()
    let rows = db.prepare('SELECT * FROM catastrophic_illness_applications ORDER BY created_at ASC').all()

    if (req.user.role === 'contributor') {
      rows = rows.filter((row) => {
        try { return JSON.parse(row.created_by || '{}').uid === req.user.id } catch { return false }
      })
    }

    const expiryMap = new Map(
      db.prepare('SELECT patient_id, expiry_date, renewal_registered_date, renewal_form_date, renewal_docs_date FROM catastrophic_illness_expiry').all()
        .map((r) => [r.patient_id, r])
    )

    // 依病人彙整：初次取最新一筆 initial；再次起為 renewal 依建立順序全列（第 N 筆＝第 N+1 次申請）
    const byPatient = new Map()
    for (const row of rows) {
      if (!byPatient.has(row.patient_id)) {
        byPatient.set(row.patient_id, { patientName: row.patient_name, physicianName: '', initials: [], renewals: [], latestUpdatedAt: '' })
      }
      const entry = byPatient.get(row.patient_id)
      let formData = {}
      try { formData = JSON.parse(row.form_data || '{}') } catch { /* 留空物件 */ }
      const slot = {
        id: row.id,
        physicianDate: formData.physicianDate || '',
        physicianName: formData.physicianName || '',
        clerkSentDate: row.clerk_sent_date || ''
      }
      if (row.application_type === 'initial') entry.initials.push(slot)
      else entry.renewals.push(slot)
      // 負責醫師＝最新一筆有填負責醫師姓名的申請（rows 已依 created_at ASC 排序）
      if (slot.physicianName) entry.physicianName = slot.physicianName
      if (row.updated_at > entry.latestUpdatedAt) entry.latestUpdatedAt = row.updated_at
    }

    const result = [...byPatient.entries()].map(([patientId, entry]) => {
      const expiry = expiryMap.get(patientId) || {}
      return {
        patientId,
        patientName: entry.patientName,
        physicianName: entry.physicianName,
        applications: [
          entry.initials.length > 0 ? entry.initials[entry.initials.length - 1] : null,
          ...entry.renewals
        ],
        expiryDate: expiry.expiry_date || '',
        renewalRegisteredDate: expiry.renewal_registered_date || '',
        renewalFormDate: expiry.renewal_form_date || '',
        renewalDocsDate: expiry.renewal_docs_date || '',
        latestUpdatedAt: entry.latestUpdatedAt
      }
    })
    result.sort((a, b) => b.latestUpdatedAt.localeCompare(a.latestUpdatedAt))

    res.json(result)
  } catch (error) {
    console.error('取得重大傷病申請總覽錯誤:', error)
    res.status(500).json({ error: true, message: '取得重大傷病申請總覽失敗' })
  }
})

/**
 * PUT /api/catastrophic-illness/clerk-sent/:id
 * 書記填某筆申請的送出日期（YYYY-MM-DD，空字串=清除）
 */
router.put('/clerk-sent/:id', ...isClerkRole, (req, res) => {
  try {
    const { clerkSentDate } = req.body
    if (!isValidDateOrEmpty(clerkSentDate)) {
      return res.status(400).json({ error: true, message: '送出日期格式必須為 YYYY-MM-DD' })
    }
    const db = getDatabase()
    const result = db.prepare(`
      UPDATE catastrophic_illness_applications
      SET clerk_sent_date = ?, updated_by = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(clerkSentDate || null, JSON.stringify({ uid: req.user.id, name: req.user.name }), req.params.id)
    if (result.changes === 0) {
      return res.status(404).json({ error: true, message: '申請紀錄不存在' })
    }
    res.json({ success: true, clerkSentDate: clerkSentDate || '' })
  } catch (error) {
    console.error('更新書記送出日期錯誤:', error)
    res.status(500).json({ error: true, message: '更新書記送出日期失敗' })
  }
})

/**
 * PUT /api/catastrophic-illness/expiry/:patientId
 * 書記填該病人的重大傷病到期日（YYYY-MM-DD，空字串=清除）
 */
router.put('/expiry/:patientId', ...isClerkRole, (req, res) => {
  try {
    const { expiryDate } = req.body
    if (!isValidDateOrEmpty(expiryDate)) {
      return res.status(400).json({ error: true, message: '到期日格式必須為 YYYY-MM-DD' })
    }
    const db = getDatabase()
    db.prepare(`
      INSERT INTO catastrophic_illness_expiry (patient_id, expiry_date, updated_by, updated_at)
      VALUES (?, ?, ?, datetime('now', 'localtime'))
      ON CONFLICT(patient_id) DO UPDATE SET
        expiry_date = excluded.expiry_date,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
    `).run(req.params.patientId, expiryDate || null, JSON.stringify({ uid: req.user.id, name: req.user.name }))
    res.json({ success: true, expiryDate: expiryDate || '' })
  } catch (error) {
    console.error('更新重大傷病到期日錯誤:', error)
    res.status(500).json({ error: true, message: '更新重大傷病到期日失敗' })
  }
})

/**
 * PUT /api/catastrophic-illness/renewal-prep/:patientId
 * 書記填該病人的到期續辦準備追蹤日期（已掛號/已填寫申請書/已收齊證件診斷書）
 * body 只帶要改的欄位（registeredDate/formDate/docsDate），未帶欄位不動＝守衛式部分更新
 */
router.put('/renewal-prep/:patientId', ...isClerkRole, (req, res) => {
  try {
    const FIELD_MAP = {
      registeredDate: 'renewal_registered_date',
      formDate: 'renewal_form_date',
      docsDate: 'renewal_docs_date'
    }
    const updates = []
    const values = []
    for (const [key, column] of Object.entries(FIELD_MAP)) {
      if (req.body[key] === undefined) continue
      if (!isValidDateOrEmpty(req.body[key])) {
        return res.status(400).json({ error: true, message: '日期格式必須為 YYYY-MM-DD' })
      }
      updates.push(column)
      values.push(req.body[key] || null)
    }
    if (updates.length === 0) {
      return res.status(400).json({ error: true, message: '未提供任何欄位' })
    }
    const db = getDatabase()
    const updatedBy = JSON.stringify({ uid: req.user.id, name: req.user.name })
    db.prepare(`
      INSERT INTO catastrophic_illness_expiry (patient_id, ${updates.join(', ')}, updated_by, updated_at)
      VALUES (?, ${updates.map(() => '?').join(', ')}, ?, datetime('now', 'localtime'))
      ON CONFLICT(patient_id) DO UPDATE SET
        ${updates.map((c) => `${c} = excluded.${c}`).join(', ')},
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
    `).run(req.params.patientId, ...values, updatedBy)
    res.json({ success: true })
  } catch (error) {
    console.error('更新重大傷病續辦追蹤錯誤:', error)
    res.status(500).json({ error: true, message: '更新重大傷病續辦追蹤失敗' })
  }
})

/**
 * GET /api/catastrophic-illness/kidit-profile/:patientId
 * 查該病人最新一筆 KiDit 本院初透建檔基本資料（kidit_logbook.events[].kidit_profile）
 * 供表單自動帶入；查無回 { found: false }
 * ⚠️ 必須定義在 GET /:id 之前，否則會被 /:id 攔截
 */
router.get('/kidit-profile/:patientId', ...isCatastrophicIllnessRole, (req, res) => {
  try {
    const { patientId } = req.params
    const db = getDatabase()
    const rows = db.prepare('SELECT date, events FROM kidit_logbook ORDER BY date DESC').all()

    // 基本資料(kidit_profile)與病史(kidit_history)可能建在不同日期的事件上，各取最新一筆
    let profile = null
    let history = null
    let foundDate = null
    for (const row of rows) {
      let events = []
      try { events = JSON.parse(row.events || '[]') } catch { continue }
      for (const e of events) {
        if (!e || e.patientId !== patientId) continue
        if (!profile && e.kidit_profile && Object.keys(e.kidit_profile).length > 0) {
          profile = e.kidit_profile
          foundDate = foundDate || row.date
        }
        if (!history && e.kidit_history && Object.keys(e.kidit_history).length > 0) {
          history = e.kidit_history
          foundDate = foundDate || row.date
        }
      }
      if (profile && history) break
    }

    if (!profile && !history) {
      return res.json({ found: false, profile: null, history: null })
    }
    res.json({ found: true, date: foundDate, profile, history })
  } catch (error) {
    console.error('查詢 KiDit 建檔資料錯誤:', error)
    res.status(500).json({ error: true, message: '查詢 KiDit 建檔資料失敗' })
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
