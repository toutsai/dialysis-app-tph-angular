// 用藥管理路由
import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { getDatabase } from '../db/init.js'
import { authenticate, isEditor, logAudit } from '../middleware/auth.js'

const router = Router()

/**
 * 解析彈性日期格式（參考 Firebase 版本）
 * 支援：YYYY-MM-DD, YYYY/MM/DD, MM/DD, MMDD
 */
function parseFlexibleDate(dateStr, targetDate) {
  if (!dateStr || typeof dateStr !== 'string') return null

  const str = dateStr.trim()
  const year = targetDate.getUTCFullYear()

  // 支援 YYYY-MM-DD 或 YYYY/MM/DD
  let match = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/)
  if (match) {
    return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
  }

  // 支援 MM/DD
  match = str.match(/^(\d{1,2})\/(\d{1,2})$/)
  if (match) {
    return `${year}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`
  }

  // 支援 MMDD (4位數)
  match = str.match(/^(\d{2})(\d{2})$/)
  if (match && str.length === 4) {
    const month = parseInt(match[1], 10)
    const day = parseInt(match[2], 10)
    if (month > 0 && month <= 12 && day > 0 && day <= 31) {
      return `${year}-${match[1]}-${match[2]}`
    }
  }

  return null
}

/**
 * POST /api/medications/daily-injections
 * 計算每日應打針劑（參考 Firebase 版本邏輯）
 * 支援：QW規則 (QW135, QW3.6, QW3,6, QW3、6) 和日期規則 (MM/DD, MMDD, YYYY-MM-DD)
 */
router.post('/daily-injections', authenticate, async (req, res) => {
  try {
    const { targetDate, patientIds } = req.body

    if (!targetDate || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      return res.status(400).json({ error: true, message: '請提供有效的目標日期 (YYYY-MM-DD)' })
    }

    if (!patientIds?.length) return res.json([])

    const targetMonth = targetDate.substring(0, 7)
    const db = getDatabase()

    // 查詢當月針劑藥囑
    const placeholders = patientIds.map(() => '?').join(',')
    const injectionOrders = db.prepare(`
      SELECT * FROM injection_orders
      WHERE patient_id IN (${placeholders})
        AND order_type = 'injection'
        AND upload_month = ?
      ORDER BY patient_id, order_code
    `).all(...patientIds, targetMonth)

    if (injectionOrders.length === 0) {
      return res.json([])
    }

    // 計算今天是星期幾 (醫院系統：1=週一 ~ 7=週日)
    const dateObj = new Date(targetDate + 'T00:00:00Z')
    const dayOfWeek = dateObj.getUTCDay() || 7

    // 依備註中的規則篩選
    const result = []
    for (const order of injectionOrders) {
      const note = (order.note || '').trim()
      let shouldAdminister = false

      // 用空白分割備註（保留 QW3,6 的逗號）
      const noteParts = note.split(/\s+/).filter(Boolean)

      for (const part of noteParts) {
        if (part.toUpperCase().startsWith('QW')) {
          // 解析 QW 規則（QW135, QW3.6, QW3,6, QW3、6 等）
          const dayString = part.substring(2)
          const matches = dayString.match(/[1-7]/g)
          if (matches) {
            const days = matches.map(d => parseInt(d, 10))
            if (days.includes(dayOfWeek)) {
              shouldAdminister = true
              break
            }
          }
        } else {
          // 檢查是否為日期 (MM/DD, MMDD, YYYY-MM-DD)
          const parsedDate = parseFlexibleDate(part, dateObj)
          if (parsedDate === targetDate) {
            shouldAdminister = true
            break
          }
        }
      }

      if (shouldAdminister) {
        result.push({
          patientId: order.patient_id,
          patientName: order.patient_name,
          orderCode: order.order_code,
          orderName: order.order_name,
          dose: order.dose,
          note: order.note
        })
      }
    }

    res.json(result)

  } catch (error) {
    console.error('計算每日應打針劑錯誤:', error)
    res.status(500).json({ error: true, message: '計算每日應打針劑失敗' })
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
      data.orderDate || new Date().toISOString().split('T')[0],
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
