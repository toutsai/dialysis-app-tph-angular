// 備忘錄路由
import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { getDatabase } from '../db/init.js'
import { authenticate, logAudit } from '../middleware/auth.js'

const router = Router()

/**
 * GET /api/memos
 * 取得備忘錄列表
 */
router.get('/', authenticate, (req, res) => {
  try {
    const { date, startDate, endDate } = req.query
    const db = getDatabase()

    let query = 'SELECT * FROM memos'
    const params = []

    if (date) {
      query += ' WHERE date = ?'
      params.push(date)
    } else if (startDate && endDate) {
      query += ' WHERE date >= ? AND date <= ?'
      params.push(startDate, endDate)
    }

    query += ' ORDER BY date DESC, created_at DESC'

    const memos = db.prepare(query).all(...params)
    db.close()

    res.json(memos.map(m => ({
      id: m.id,
      date: m.date,
      content: m.content,
      authorId: m.author_id,
      authorName: m.author_name,
      createdAt: m.created_at,
      updatedAt: m.updated_at
    })))

  } catch (error) {
    console.error('取得備忘錄錯誤:', error)
    res.status(500).json({
      error: true,
      message: '取得備忘錄失敗'
    })
  }
})

/**
 * POST /api/memos
 * 新增備忘錄
 */
router.post('/', authenticate, async (req, res) => {
  try {
    const { date, content } = req.body

    if (!date || !content) {
      return res.status(400).json({
        error: true,
        message: '日期和內容為必填'
      })
    }

    const id = uuidv4()
    const db = getDatabase()

    db.prepare(`
      INSERT INTO memos (id, date, content, author_id, author_name)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, date, content, req.user.id, req.user.name)

    const created = db.prepare(`SELECT * FROM memos WHERE id = ?`).get(id)
    db.close()

    res.status(201).json({
      id: created.id,
      date: created.date,
      content: created.content,
      authorId: created.author_id,
      authorName: created.author_name,
      createdAt: created.created_at
    })

  } catch (error) {
    console.error('新增備忘錄錯誤:', error)
    res.status(500).json({
      error: true,
      message: '新增備忘錄失敗'
    })
  }
})

/**
 * PUT /api/memos/:id
 * 更新備忘錄
 */
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const { content } = req.body

    const db = getDatabase()

    const existing = db.prepare(`SELECT * FROM memos WHERE id = ?`).get(id)

    if (!existing) {
      db.close()
      return res.status(404).json({
        error: true,
        message: '備忘錄不存在'
      })
    }

    db.prepare(`
      UPDATE memos
      SET content = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(content, id)

    const updated = db.prepare(`SELECT * FROM memos WHERE id = ?`).get(id)
    db.close()

    res.json({
      id: updated.id,
      date: updated.date,
      content: updated.content,
      authorId: updated.author_id,
      authorName: updated.author_name,
      updatedAt: updated.updated_at
    })

  } catch (error) {
    console.error('更新備忘錄錯誤:', error)
    res.status(500).json({
      error: true,
      message: '更新備忘錄失敗'
    })
  }
})

/**
 * DELETE /api/memos/:id
 * 刪除備忘錄
 */
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const db = getDatabase()

    const result = db.prepare(`DELETE FROM memos WHERE id = ?`).run(id)
    db.close()

    if (result.changes === 0) {
      return res.status(404).json({
        error: true,
        message: '備忘錄不存在'
      })
    }

    res.json({
      success: true,
      message: '備忘錄已刪除'
    })

  } catch (error) {
    console.error('刪除備忘錄錯誤:', error)
    res.status(500).json({
      error: true,
      message: '刪除備忘錄失敗'
    })
  }
})

export default router
