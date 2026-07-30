// 用藥管理路由
import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { getDatabase } from '../db/init.js'
import { authenticate, isEditor, logAudit } from '../middleware/auth.js'
import { getDailyInjections } from '../services/dailyInjectionService.js'
import { getTaipeiTodayString } from '../utils/dateUtils.js'

const router = Router()

/**
 * POST /api/medications/daily-injections
 * 計算每日應打針劑（實際邏輯在 dailyInjectionService.getDailyInjections / shouldAdministerOnDate）
 * 支援：QW規則 (QW135, QW 135, QW3.6, QW3,6, QW3、6, QW 1 & 5) 和日期規則 (MM/DD, MMDD, YYYY-MM-DD)
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
