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
// 書記補登的「紙本申請」佔位紀錄：醫師未在系統建表、只由書記記錄送出日期；form_data.source 標記
const PAPER_SOURCE = 'clerk_paper'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
function isValidDateOrEmpty(v) {
  return v === '' || v === null || v === undefined || (typeof v === 'string' && DATE_RE.test(v))
}

function pdToApiShape(row) {
  return {
    id: row.id,
    name: row.name,
    medicalRecordNumber: row.medical_record_number || '',
    idNumber: row.id_number || '',
    gender: row.gender || '',
    birthDate: row.birth_date || '',
    physician: row.physician || '',
    isPd: true,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/** 重大傷病申請頁的病人可在 patients 表或 PD 專用表；回 { name, physician } 或 null */
function findCiPatient(db, patientId) {
  const hd = db.prepare('SELECT name, physician FROM patients WHERE id = ?').get(patientId)
  if (hd) return hd
  const pd = db.prepare('SELECT name, physician FROM catastrophic_illness_pd_patients WHERE id = ?').get(patientId)
  return pd || null
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
      .map((row) => {
        let formData = {}
        try { formData = JSON.parse(row.form_data || '{}') } catch { /* 留空物件 */ }
        return { ...row, formData }
      })

    if (req.user.role === 'contributor') {
      // 醫師看自己建立的；另外書記補登的紙本申請（PAPER_SOURCE）若負責醫師是自己也要看得到
      rows = rows.filter((row) => {
        let createdByUid = null
        try { createdByUid = JSON.parse(row.created_by || '{}').uid } catch { /* 視為非本人 */ }
        if (createdByUid === req.user.id) return true
        return row.formData.source === PAPER_SOURCE && !!req.user.name && row.formData.physicianName === req.user.name
      })
    }

    const expiryMap = new Map(
      db.prepare('SELECT patient_id, expiry_date, renewal_registered_date, renewal_form_date, renewal_docs_date, physician_name, updated_at FROM catastrophic_illness_expiry').all()
        .map((r) => [r.patient_id, r])
    )
    // PD 專用病人：總覽列標 PD 標籤；只有到期日的列姓名也由此表補查
    const pdMap = new Map(
      db.prepare('SELECT id, name FROM catastrophic_illness_pd_patients').all().map((r) => [r.id, r.name])
    )

    // 依病人彙整：初次取最新一筆 initial；再次起為 renewal 依建立順序全列（第 N 筆＝第 N+1 次申請）
    const byPatient = new Map()
    for (const row of rows) {
      if (!byPatient.has(row.patient_id)) {
        byPatient.set(row.patient_id, { patientName: row.patient_name, physicianName: '', initials: [], renewals: [], latestUpdatedAt: '' })
      }
      const entry = byPatient.get(row.patient_id)
      const formData = row.formData
      const slot = {
        id: row.id,
        physicianDate: formData.physicianDate || '',
        physicianName: formData.physicianName || '',
        clerkSentDate: row.clerk_sent_date || '',
        paper: formData.source === PAPER_SOURCE // 書記補登的紙本申請（醫師未在系統建表）
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
        isPd: pdMap.has(patientId),
        // 申請表填的負責醫師優先；沒有時退回書記補登時指定的醫師
        physicianName: entry.physicianName || expiry.physician_name || '',
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

    // 只有到期日、沒有申請紀錄的病人也要列出（舊病人在系統外已辦過重大傷病，書記手動補到期日追蹤續辦）
    // 醫師（contributor）視角維持只列自己建立的申請，不混入
    if (req.user.role !== 'contributor') {
      const patientNameStmt = db.prepare('SELECT name FROM patients WHERE id = ?')
      for (const [patientId, expiry] of expiryMap) {
        if (byPatient.has(patientId)) continue
        if (!expiry.expiry_date && !expiry.renewal_registered_date && !expiry.renewal_form_date && !expiry.renewal_docs_date) continue
        result.push({
          patientId,
          patientName: patientNameStmt.get(patientId)?.name || pdMap.get(patientId) || '(查無病人)',
          isPd: pdMap.has(patientId),
          physicianName: expiry.physician_name || '',
          applications: [null],
          expiryDate: expiry.expiry_date || '',
          renewalRegisteredDate: expiry.renewal_registered_date || '',
          renewalFormDate: expiry.renewal_form_date || '',
          renewalDocsDate: expiry.renewal_docs_date || '',
          latestUpdatedAt: expiry.updated_at || ''
        })
      }
    }
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
 * POST /api/catastrophic-illness/clerk-paper
 * 書記補登紙本申請：醫師沒在系統建申請表（手寫附表）時，書記直接記錄送出日期
 * 建一筆 form_data = { source: 'clerk_paper', physicianName } 的佔位申請，沿用 clerk_sent_date 欄；
 * 總覽完成日期欄顯示「紙本」；醫師仍可從總覽 ✎ 接手補填表單
 * body: { patientId, applicationType: 'initial'|'renewal', clerkSentDate, physicianName? }
 * 負責醫師未帶時退回病人資料的主治醫師（contributor 視角靠此欄看到自己病人的紙本列）
 */
router.post('/clerk-paper', ...isClerkRole, (req, res) => {
  try {
    const { patientId, applicationType, clerkSentDate, physicianName } = req.body
    if (!patientId) {
      return res.status(400).json({ error: true, message: '病人為必填' })
    }
    if (!VALID_TYPES.includes(applicationType)) {
      return res.status(400).json({ error: true, message: '申請類別必須為 initial 或 renewal' })
    }
    if (!clerkSentDate || !isValidDateOrEmpty(clerkSentDate)) {
      return res.status(400).json({ error: true, message: '送出日期格式必須為 YYYY-MM-DD' })
    }
    if (physicianName !== undefined && typeof physicianName !== 'string') {
      return res.status(400).json({ error: true, message: '負責醫師格式錯誤' })
    }
    const db = getDatabase()
    const patient = findCiPatient(db, patientId) // HD（patients 表）或 PD 專用病人皆可
    if (!patient) {
      return res.status(404).json({ error: true, message: '病人不存在' })
    }
    if (applicationType === 'initial') {
      const hasInitial = db.prepare(
        "SELECT 1 FROM catastrophic_illness_applications WHERE patient_id = ? AND application_type = 'initial' LIMIT 1"
      ).get(patientId)
      if (hasInitial) {
        return res.status(409).json({ error: true, message: '此病人已有初次申請紀錄，請改填再次申請' })
      }
    }

    const id = uuidv4()
    const userJson = JSON.stringify({ uid: req.user.id, name: req.user.name })
    const formData = { source: PAPER_SOURCE, physicianName: (physicianName || patient.physician || '').trim() }
    db.prepare(`
      INSERT INTO catastrophic_illness_applications
        (id, patient_id, patient_name, application_type, form_data, clerk_sent_date, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, patientId, patient.name, applicationType, JSON.stringify(formData), clerkSentDate, userJson, userJson)

    const created = db.prepare('SELECT * FROM catastrophic_illness_applications WHERE id = ?').get(id)
    res.status(201).json(toApiShape(created))
  } catch (error) {
    console.error('補登紙本重大傷病申請錯誤:', error)
    res.status(500).json({ error: true, message: '補登紙本申請失敗' })
  }
})

/**
 * DELETE /api/catastrophic-illness/clerk-paper/:id
 * 書記移除自己補登的紙本佔位紀錄（誤點補救）；醫師已接手填表（有簽章日期）的紀錄不可由此刪除
 */
router.delete('/clerk-paper/:id', ...isClerkRole, (req, res) => {
  try {
    const db = getDatabase()
    const row = db.prepare('SELECT form_data FROM catastrophic_illness_applications WHERE id = ?').get(req.params.id)
    if (!row) {
      return res.status(404).json({ error: true, message: '申請紀錄不存在' })
    }
    let formData = {}
    try { formData = JSON.parse(row.form_data || '{}') } catch { /* 留空物件 */ }
    if (formData.source !== PAPER_SOURCE) {
      return res.status(403).json({ error: true, message: '只能移除書記補登的紙本紀錄' })
    }
    if (formData.physicianDate) {
      return res.status(409).json({ error: true, message: '醫師已接手填寫此申請表，請由醫師在總覽刪除' })
    }
    db.prepare('DELETE FROM catastrophic_illness_applications WHERE id = ?').run(req.params.id)
    res.json({ success: true, message: '紙本紀錄已移除' })
  } catch (error) {
    console.error('移除紙本重大傷病申請錯誤:', error)
    res.status(500).json({ error: true, message: '移除紙本紀錄失敗' })
  }
})

/**
 * PUT /api/catastrophic-illness/expiry/:patientId
 * 書記填該病人的重大傷病到期日（YYYY-MM-DD，空字串=清除）
 * body 可帶 physicianName（負責醫師，補登入口用）；未帶則不動既有值＝守衛式部分更新
 * 到期日「變動」＝進入新一輪續辦週期：清空續辦追蹤三欄（否則上一輪的「已掛號」會永遠壓掉下一輪到期提醒）
 */
router.put('/expiry/:patientId', ...isClerkRole, (req, res) => {
  try {
    const { expiryDate, physicianName } = req.body
    if (!isValidDateOrEmpty(expiryDate)) {
      return res.status(400).json({ error: true, message: '到期日格式必須為 YYYY-MM-DD' })
    }
    if (physicianName !== undefined && typeof physicianName !== 'string') {
      return res.status(400).json({ error: true, message: '負責醫師格式錯誤' })
    }
    const db = getDatabase()
    const prev = db.prepare('SELECT expiry_date FROM catastrophic_illness_expiry WHERE patient_id = ?').get(req.params.patientId)
    const renewalReset = prev !== undefined && (prev.expiry_date || '') !== (expiryDate || '')
    db.prepare(`
      INSERT INTO catastrophic_illness_expiry (patient_id, expiry_date, physician_name, updated_by, updated_at)
      VALUES (?, ?, ?, ?, datetime('now', 'localtime'))
      ON CONFLICT(patient_id) DO UPDATE SET
        expiry_date = excluded.expiry_date,
        physician_name = ${physicianName !== undefined ? 'excluded.physician_name' : 'physician_name'},
        ${renewalReset ? 'renewal_registered_date = NULL, renewal_form_date = NULL, renewal_docs_date = NULL,' : ''}
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
    `).run(
      req.params.patientId,
      expiryDate || null,
      physicianName !== undefined ? (physicianName || null) : null,
      JSON.stringify({ uid: req.user.id, name: req.user.name })
    )
    res.json({ success: true, expiryDate: expiryDate || '', renewalReset })
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
 * GET /api/catastrophic-illness/pd-patients
 * 重大傷病申請專用 PD（腹膜透析）病人清單：不在 patients 表，僅此頁選人用
 * 書記（viewer）也要：補登到期日入口選人
 * ⚠️ 必須定義在 GET /:id 之前
 */
router.get('/pd-patients', ...isOverviewRole, (req, res) => {
  try {
    const db = getDatabase()
    const rows = db.prepare('SELECT * FROM catastrophic_illness_pd_patients ORDER BY created_at DESC').all()
    res.json(rows.map(pdToApiShape))
  } catch (error) {
    console.error('取得 PD 病人清單錯誤:', error)
    res.status(500).json({ error: true, message: '取得 PD 病人清單失敗' })
  }
})

/**
 * POST /api/catastrophic-illness/pd-patients
 * 建立 PD 病人（搜尋查無病人時「是否為 PD 病人」入口）
 * body: { name, medicalRecordNumber?, idNumber?, gender?, birthDate?, physician? }
 * 病歷號/身分證同時比對 patients 表與 PD 表，避免同一人兩個身分
 */
router.post('/pd-patients', ...isCatastrophicIllnessRole, (req, res) => {
  try {
    const { name, medicalRecordNumber, idNumber, gender, birthDate, physician } = req.body || {}
    const str = (v) => (typeof v === 'string' ? v.trim() : '')
    const nameVal = str(name)
    if (!nameVal) {
      return res.status(400).json({ error: true, message: '姓名為必填' })
    }
    const mrn = str(medicalRecordNumber)
    const idNo = str(idNumber).toUpperCase()
    const birth = str(birthDate)
    if (!isValidDateOrEmpty(birth)) {
      return res.status(400).json({ error: true, message: '出生日期格式必須為 YYYY-MM-DD' })
    }
    const genderVal = str(gender)
    if (genderVal && !['男', '女'].includes(genderVal)) {
      return res.status(400).json({ error: true, message: '性別必須為 男 或 女' })
    }

    const db = getDatabase()
    if (mrn) {
      const dupHd = db.prepare('SELECT name FROM patients WHERE medical_record_number = ? LIMIT 1').get(mrn)
      if (dupHd) {
        return res.status(409).json({ error: true, message: `病歷號 ${mrn} 已存在於病人清單（${dupHd.name}），請直接搜尋選取` })
      }
      const dupPd = db.prepare('SELECT name FROM catastrophic_illness_pd_patients WHERE medical_record_number = ? LIMIT 1').get(mrn)
      if (dupPd) {
        return res.status(409).json({ error: true, message: `病歷號 ${mrn} 已建立為 PD 病人（${dupPd.name}），請直接搜尋選取` })
      }
    }
    if (idNo) {
      const dupHd = db.prepare('SELECT name FROM patients WHERE UPPER(id_number) = ? LIMIT 1').get(idNo)
      if (dupHd) {
        return res.status(409).json({ error: true, message: `身分證 ${idNo} 已存在於病人清單（${dupHd.name}），請直接搜尋選取` })
      }
      const dupPd = db.prepare('SELECT name FROM catastrophic_illness_pd_patients WHERE UPPER(id_number) = ? LIMIT 1').get(idNo)
      if (dupPd) {
        return res.status(409).json({ error: true, message: `身分證 ${idNo} 已建立為 PD 病人（${dupPd.name}），請直接搜尋選取` })
      }
    }

    const id = uuidv4()
    const userJson = JSON.stringify({ uid: req.user.id, name: req.user.name })
    db.prepare(`
      INSERT INTO catastrophic_illness_pd_patients
        (id, name, medical_record_number, id_number, gender, birth_date, physician, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, nameVal, mrn || null, idNo || null, genderVal || null, birth || null, str(physician) || null, userJson, userJson)
    const created = db.prepare('SELECT * FROM catastrophic_illness_pd_patients WHERE id = ?').get(id)
    res.status(201).json(pdToApiShape(created))
  } catch (error) {
    console.error('建立 PD 病人錯誤:', error)
    res.status(500).json({ error: true, message: '建立 PD 病人失敗' })
  }
})

/**
 * PUT /api/catastrophic-illness/pd-patients/:id
 * 修改 PD 病人基本資料（守衛式部分更新：未帶欄位不動）
 */
router.put('/pd-patients/:id', ...isCatastrophicIllnessRole, (req, res) => {
  try {
    const db = getDatabase()
    const existing = db.prepare('SELECT * FROM catastrophic_illness_pd_patients WHERE id = ?').get(req.params.id)
    if (!existing) {
      return res.status(404).json({ error: true, message: 'PD 病人不存在' })
    }
    const FIELD_MAP = {
      name: 'name',
      medicalRecordNumber: 'medical_record_number',
      idNumber: 'id_number',
      gender: 'gender',
      birthDate: 'birth_date',
      physician: 'physician'
    }
    const updates = []
    const values = []
    for (const [key, column] of Object.entries(FIELD_MAP)) {
      if (req.body[key] === undefined) continue
      if (typeof req.body[key] !== 'string') {
        return res.status(400).json({ error: true, message: `${key} 格式錯誤` })
      }
      let v = req.body[key].trim()
      if (key === 'name' && !v) return res.status(400).json({ error: true, message: '姓名不可為空' })
      if (key === 'birthDate' && !isValidDateOrEmpty(v)) return res.status(400).json({ error: true, message: '出生日期格式必須為 YYYY-MM-DD' })
      if (key === 'gender' && v && !['男', '女'].includes(v)) return res.status(400).json({ error: true, message: '性別必須為 男 或 女' })
      if (key === 'idNumber') v = v.toUpperCase()
      updates.push(`${column} = ?`)
      values.push(key === 'name' ? v : (v || null))
    }
    if (updates.length === 0) {
      return res.status(400).json({ error: true, message: '未提供任何欄位' })
    }
    db.prepare(`
      UPDATE catastrophic_illness_pd_patients
      SET ${updates.join(', ')}, updated_by = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(...values, JSON.stringify({ uid: req.user.id, name: req.user.name }), req.params.id)
    // 姓名變更同步到申請紀錄的 patient_name（總覽顯示用）
    if (req.body.name !== undefined) {
      db.prepare('UPDATE catastrophic_illness_applications SET patient_name = ? WHERE patient_id = ?')
        .run(req.body.name.trim(), req.params.id)
    }
    const updated = db.prepare('SELECT * FROM catastrophic_illness_pd_patients WHERE id = ?').get(req.params.id)
    res.json(pdToApiShape(updated))
  } catch (error) {
    console.error('更新 PD 病人錯誤:', error)
    res.status(500).json({ error: true, message: '更新 PD 病人失敗' })
  }
})

/**
 * DELETE /api/catastrophic-illness/pd-patients/:id
 * 刪除 PD 病人（誤建補救）；已有申請紀錄或到期日者拒絕，需先刪除申請
 */
router.delete('/pd-patients/:id', ...isCatastrophicIllnessRole, (req, res) => {
  try {
    const db = getDatabase()
    const hasApp = db.prepare('SELECT 1 FROM catastrophic_illness_applications WHERE patient_id = ? LIMIT 1').get(req.params.id)
    const hasExpiry = db.prepare('SELECT 1 FROM catastrophic_illness_expiry WHERE patient_id = ? LIMIT 1').get(req.params.id)
    if (hasApp || hasExpiry) {
      return res.status(409).json({ error: true, message: '此 PD 病人已有申請紀錄或到期日，請先刪除相關紀錄' })
    }
    const result = db.prepare('DELETE FROM catastrophic_illness_pd_patients WHERE id = ?').run(req.params.id)
    if (result.changes === 0) {
      return res.status(404).json({ error: true, message: 'PD 病人不存在' })
    }
    res.json({ success: true })
  } catch (error) {
    console.error('刪除 PD 病人錯誤:', error)
    res.status(500).json({ error: true, message: '刪除 PD 病人失敗' })
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
