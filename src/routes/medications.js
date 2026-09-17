// 用藥管理路由
import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { getDatabase } from '../db/init.js'
import { authenticate, isEditor, logAudit } from '../middleware/auth.js'
import {
  getDailyInjections,
  getUncertainInjections,
  listInjectionRuleOverrides,
  upsertInjectionRuleOverride,
  deleteInjectionRuleOverride,
} from '../services/dailyInjectionService.js'
import {
  getInjectionReview,
  getMonthlyInjectionMatrix,
  getPatientMedicationHistory,
  listUploadBatches,
  listBatchChanges,
} from '../services/injectionRulesService.js'
import { getTaipeiTodayString } from '../utils/dateUtils.js'

const router = Router()

/**
 * POST /api/medications/daily-injections/review
 * 針劑待審清單（解讀層）：判不出星期幾 + 交叉檢查警告（星期與洗腎日不符 / 日期非洗腎日 / 日期已用盡）。
 * body: { targetDate?: YYYY-MM-DD（預設今天）, patientIds?: string[]（省略=全院） }
 * 回 { targetDate, items:[{...InjectionRecord, category, categoryLabel, warnings:[{code,message}], reason, dialysisDays, masterFreq}], counts:{uncertain,dates_exhausted,weekday_mismatch,date_not_dialysis_day,total}, latestBatch }
 */
router.post('/daily-injections/review', authenticate, (req, res) => {
  try {
    const targetDate = req.body?.targetDate || getTaipeiTodayString()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      return res.status(400).json({ error: true, message: '請提供有效的目標日期 (YYYY-MM-DD)' })
    }
    const patientIds = Array.isArray(req.body?.patientIds) ? req.body.patientIds : null
    return res.json(getInjectionReview(getDatabase(), targetDate, patientIds))
  } catch (error) {
    console.error('查詢針劑待審清單錯誤:', error)
    res.status(500).json({ error: true, message: '查詢針劑待審清單失敗' })
  }
})

/**
 * GET /api/medications/injection-monthly?month=YYYY-MM&shift=early|noon|late&codes=IFER2,ICAC&kinds=weekly,interval,dates
 * 醫師當月針劑總覽：列＝病人（班別/床位排序）、欄＝每天、格＝當天該打的針劑。
 */
router.get('/injection-monthly', authenticate, (req, res) => {
  try {
    const month = String(req.query.month || getTaipeiTodayString().slice(0, 7))
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return res.status(400).json({ error: true, message: 'month 須為 YYYY-MM' })
    }
    const split = (v) => (v ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : null)
    const shift = req.query.shift && req.query.shift !== 'all' ? String(req.query.shift) : null
    return res.json(
      getMonthlyInjectionMatrix(getDatabase(), month, { shift, codes: split(req.query.codes), kinds: split(req.query.kinds) }),
    )
  } catch (error) {
    console.error('查詢當月針劑總覽錯誤:', error)
    res.status(500).json({ error: true, message: '查詢當月針劑總覽失敗' })
  }
})

/** GET /api/medications/injection-history/:patientId — 個人藥物歷史（所有處方區間 + 歷次上傳異動） */
router.get('/injection-history/:patientId', authenticate, (req, res) => {
  try {
    return res.json(getPatientMedicationHistory(getDatabase(), req.params.patientId))
  } catch (error) {
    console.error('查詢個人藥物歷史錯誤:', error)
    res.status(500).json({ error: true, message: '查詢個人藥物歷史失敗' })
  }
})

/** GET /api/medications/injection-upload-batches?limit=50 — 歷次藥囑上傳批次與摘要 */
router.get('/injection-upload-batches', authenticate, (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200)
    return res.json(listUploadBatches(getDatabase(), limit))
  } catch (error) {
    console.error('查詢上傳批次錯誤:', error)
    res.status(500).json({ error: true, message: '查詢上傳批次失敗' })
  }
})

/** GET /api/medications/injection-upload-batches/:id/changes?patientId=&orderType=injection|oral — 該批次逐筆異動 */
router.get('/injection-upload-batches/:id/changes', authenticate, (req, res) => {
  try {
    const rows = listBatchChanges(getDatabase(), req.params.id, {
      patientId: req.query.patientId ? String(req.query.patientId) : null,
      orderType: req.query.orderType ? String(req.query.orderType) : null,
    })
    if (rows === null) return res.status(404).json({ error: true, message: '找不到該批次' })
    return res.json(rows)
  } catch (error) {
    console.error('查詢批次異動錯誤:', error)
    res.status(500).json({ error: true, message: '查詢批次異動失敗' })
  }
})

/**
 * POST /api/medications/daily-injections
 * 計算每日應打針劑（實際邏輯在 dailyInjectionService.getDailyInjections / resolveInjectionSchedule）
 * 支援：QW規則 (QW135, QW 135, QW3.6, QW3,6, QW3、6, QW 1 & 5)、Q{N}W 間隔週、中文「每周三」、
 * 日期規則 (MM/DD, MMDD, 民國年, YYYY-MM-DD)；備註無規則時改讀「頻率服法」欄；
 * 兩邊都判不出星期幾 → 不列，改進疑慮清單（/daily-injections/uncertain）。
 */
router.post('/daily-injections', authenticate, async (req, res) => {
  try {
    const { targetDate, patientIds } = req.body

    if (!targetDate || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      return res.status(400).json({ error: true, message: '請提供有效的目標日期 (YYYY-MM-DD)' })
    }

    if (!patientIds?.length) return res.json([])

    const db = getDatabase()
    return res.json(getDailyInjections(db, targetDate, patientIds))
  } catch (error) {
    console.error('計算每日應打針劑錯誤:', error)
    res.status(500).json({ error: true, message: '計算每日應打針劑失敗' })
  }
})

/**
 * POST /api/medications/daily-injections/uncertain
 * 疑慮清單：targetDate（預設今天）仍有效、但備註與頻率欄都判不出星期幾的針劑處方。
 * body.patientIds 省略 → 全部未刪除病人。
 */
router.post('/daily-injections/uncertain', authenticate, (req, res) => {
  try {
    const targetDate = req.body?.targetDate || getTaipeiTodayString()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      return res.status(400).json({ error: true, message: '請提供有效的目標日期 (YYYY-MM-DD)' })
    }
    const patientIds = Array.isArray(req.body?.patientIds) ? req.body.patientIds : null
    const db = getDatabase()
    return res.json(getUncertainInjections(db, targetDate, patientIds))
  } catch (error) {
    console.error('查詢針劑疑慮清單錯誤:', error)
    res.status(500).json({ error: true, message: '查詢針劑疑慮清單失敗' })
  }
})

/** GET /api/medications/injection-rule-overrides — 已確認的施打規則覆寫 */
router.get('/injection-rule-overrides', authenticate, (req, res) => {
  try {
    return res.json(listInjectionRuleOverrides(getDatabase()))
  } catch (error) {
    console.error('查詢施打規則覆寫錯誤:', error)
    res.status(500).json({ error: true, message: '查詢施打規則覆寫失敗' })
  }
})

/**
 * PUT /api/medications/injection-rule-overrides — 疑慮清單確認（新增或更新）
 * body: { patientId, orderCode, startDate, dose, frequency, rule }
 * rule 須可判讀（W4 / QW135 / Q2W4 / 0923.0930 / hold），否則 400。
 */
router.put('/injection-rule-overrides', isEditor, async (req, res) => {
  try {
    const db = getDatabase()
    const saved = upsertInjectionRuleOverride(db, req.body || {}, req.user)
    await logAudit('INJECTION_RULE_OVERRIDE', req.user.id, req.user.name, 'injection_rule_overrides', saved.id, {
      patientId: saved.patientId,
      orderCode: saved.orderCode,
      startDate: saved.startDate,
      rule: saved.rule,
    })
    return res.json(saved)
  } catch (error) {
    console.error('儲存施打規則覆寫錯誤:', error)
    res.status(400).json({ error: true, message: error.message || '儲存施打規則覆寫失敗' })
  }
})

/** DELETE /api/medications/injection-rule-overrides/:id */
router.delete('/injection-rule-overrides/:id', isEditor, async (req, res) => {
  try {
    const db = getDatabase()
    const changes = deleteInjectionRuleOverride(db, req.params.id)
    if (!changes) return res.status(404).json({ error: true, message: '找不到該筆覆寫' })
    await logAudit('INJECTION_RULE_OVERRIDE_DELETE', req.user.id, req.user.name, 'injection_rule_overrides', req.params.id, {})
    return res.json({ success: true })
  } catch (error) {
    console.error('刪除施打規則覆寫錯誤:', error)
    res.status(500).json({ error: true, message: '刪除施打規則覆寫失敗' })
  }
})

/**
 * POST /api/medications/injections
 * Angular 前端別名（對應 POST /api/medications/daily-injections）
 */
router.post('/injections', authenticate, async (req, res) => {
  // 若 body 含 patientIds + uploadMonth，查詢 injection_orders
  const { patientIds, orderType, uploadMonth } = req.body
  if (patientIds && uploadMonth) {
    try {
      const db = getDatabase()
      const placeholders = patientIds.map(() => '?').join(',')
      let query = `SELECT * FROM injection_orders WHERE patient_id IN (${placeholders})`
      const params = [...patientIds]
      if (uploadMonth) {
        query += ' AND upload_month = ?'
        params.push(uploadMonth)
      }
      if (orderType) {
        query += ' AND order_type = ?'
        params.push(orderType)
      }
      const rows = db.prepare(query).all(...params)
      return res.json(rows.map(r => ({
        id: r.id,
        patientId: r.patient_id,
        patientName: r.patient_name,
        medicalRecordNumber: r.medical_record_number,
        orderCode: r.order_code,
        orderName: r.order_name,
        changeDate: r.change_date,
        uploadMonth: r.upload_month,
        dose: r.dose,
        frequency: r.frequency,
        note: r.note,
        action: r.action,
        orderType: r.order_type,
        sourceFile: r.source_file,
        createdAt: r.created_at
      })))
    } catch (error) {
      console.error('查詢 injection_orders 錯誤:', error)
      return res.status(500).json({ error: true, message: '查詢失敗' })
    }
  }
  // 否則 fallback 到 daily-injections 邏輯
  req.url = '/daily-injections'
  router.handle(req, res, () => res.status(404).json({ error: true, message: 'Not found' }))
})

/**
 * GET /api/medications/injections?orderType=&uploadMonth=&patientIds=
 * Angular 前端別名（查詢 injection_orders）
 */
router.get('/injections', authenticate, (req, res) => {
  try {
    const { orderType, uploadMonth, patientIds } = req.query
    const db = getDatabase()

    let query = 'SELECT * FROM injection_orders WHERE 1=1'
    const params = []

    if (patientIds) {
      const ids = patientIds.split(',')
      query += ` AND patient_id IN (${ids.map(() => '?').join(',')})`
      params.push(...ids)
    }
    if (uploadMonth) {
      query += ' AND upload_month = ?'
      params.push(uploadMonth)
    }
    if (orderType) {
      query += ' AND order_type = ?'
      params.push(orderType)
    }

    const rows = db.prepare(query).all(...params)
    res.json(rows.map(r => ({
      id: r.id,
      patientId: r.patient_id,
      patientName: r.patient_name,
      medicalRecordNumber: r.medical_record_number,
      orderCode: r.order_code,
      orderName: r.order_name,
      changeDate: r.change_date,
      uploadMonth: r.upload_month,
      dose: r.dose,
      frequency: r.frequency,
      note: r.note,
      action: r.action,
      orderType: r.order_type,
      sourceFile: r.source_file,
      createdAt: r.created_at
    })))
  } catch (error) {
    console.error('查詢 injection_orders 錯誤:', error)
    res.status(500).json({ error: true, message: '查詢失敗' })
  }
})

/**
 * GET /api/medications/patient/:patientId
 * 取得特定病人的用藥列表
 */
router.get('/patient/:patientId', authenticate, (req, res) => {
  try {
    const { patientId } = req.params
    const db = getDatabase()

    const orders = db.prepare(`
      SELECT * FROM medication_orders
      WHERE patient_id = ?
      ORDER BY created_at DESC
    `).all(patientId)

    res.json(orders.map(o => ({
      id: o.id,
      patientId: o.patient_id,
      patientName: o.patient_name,
      medications: JSON.parse(o.medications || '[]'),
      status: o.status,
      orderDate: o.order_date,
      createdBy: JSON.parse(o.created_by || '{}'),
      createdAt: o.created_at,
      updatedAt: o.updated_at
    })))

  } catch (error) {
    console.error('取得病人用藥錯誤:', error)
    res.status(500).json({
      error: true,
      message: '取得病人用藥失敗'
    })
  }
})

/**
 * POST /api/medications
 * 新增用藥記錄
 */
router.post('/', ...isEditor, async (req, res) => {
  try {
    const data = req.body
    const id = uuidv4()

    const db = getDatabase()

    db.prepare(`
      INSERT INTO medication_orders (id, patient_id, patient_name, medications, order_date, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.patientId,
      data.patientName || '',
      JSON.stringify(data.medications || []),
      data.orderDate || getTaipeiTodayString(),
      JSON.stringify({ uid: req.user.id, name: req.user.name })
    )

    const created = db.prepare(`SELECT * FROM medication_orders WHERE id = ?`).get(id)

    await logAudit('MEDICATION_CREATE', req.user.id, req.user.name, 'medication_orders', id, {
      patientId: data.patientId
    })

    res.status(201).json({
      id: created.id,
      patientId: created.patient_id,
      patientName: created.patient_name,
      medications: JSON.parse(created.medications || '[]'),
      createdAt: created.created_at
    })

  } catch (error) {
    console.error('新增用藥記錄錯誤:', error)
    res.status(500).json({
      error: true,
      message: '新增用藥記錄失敗'
    })
  }
})

/**
 * PUT /api/medications/:id
 * 更新用藥記錄
 */
router.put('/:id', ...isEditor, async (req, res) => {
  try {
    const { id } = req.params
    const data = req.body

    const db = getDatabase()

    db.prepare(`
      UPDATE medication_orders
      SET medications = ?,
          status = ?,
          updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(
      JSON.stringify(data.medications || []),
      data.status || 'pending',
      id
    )

    await logAudit('MEDICATION_UPDATE', req.user.id, req.user.name, 'medication_orders', id, {})

    res.json({ success: true })

  } catch (error) {
    console.error('更新用藥記錄錯誤:', error)
    res.status(500).json({
      error: true,
      message: '更新用藥記錄失敗'
    })
  }
})

/**
 * DELETE /api/medications/:id
 * 刪除用藥記錄
 */
router.delete('/:id', ...isEditor, async (req, res) => {
  try {
    const { id } = req.params
    const db = getDatabase()

    const result = db.prepare(`DELETE FROM medication_orders WHERE id = ?`).run(id)

    if (result.changes === 0) {
      return res.status(404).json({
        error: true,
        message: '用藥記錄不存在'
      })
    }

    await logAudit('MEDICATION_DELETE', req.user.id, req.user.name, 'medication_orders', id, {})

    res.json({ success: true })

  } catch (error) {
    console.error('刪除用藥記錄錯誤:', error)
    res.status(500).json({
      error: true,
      message: '刪除用藥記錄失敗'
    })
  }
})

export default router
