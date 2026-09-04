// 系統相關路由 (任務、通知、庫存、配置等)
import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { getDatabase } from '../db/init.js'
import { authenticate, isAdmin, isEditor, isContributor, logAudit, requireAnyRole } from '../middleware/auth.js'
import { getTaipeiTodayString } from '../utils/dateUtils.js'
import { countCurrentCensus, getMonthlyCensus, getMonthlyCensusChanges } from '../services/patientCensus.js'

const router = Router()
const isInventoryRole = [authenticate, requireAnyRole('admin', 'viewer')]

// ========================================
// 健康檢查 API (用於 Electron 啟動檢測)
// ========================================

/**
 * GET /api/system/health
 * 健康檢查端點 (不需要認證)
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  })
})

// ========================================
// 任務 API
// ========================================

/**
 * GET /api/system/tasks
 * 取得任務列表
 */
router.get('/tasks', authenticate, (req, res) => {
  try {
    const { status, assignedTo, assignee, assigneeRole, creator, category, patientId, targetDate, since } = req.query
    const db = getDatabase()

    let query = 'SELECT * FROM tasks WHERE status != ?'
    const params = ['deleted']

    if (status) {
      query += ' AND status = ?'
      params.push(status)
    }

    if (assignedTo) {
      query += ' AND assigned_to = ?'
      params.push(assignedTo)
    }

    if (category) {
      query += ' AND category = ?'
      params.push(category)
    }

    if (patientId) {
      query += ' AND patient_id = ?'
      params.push(patientId)
    }

    if (targetDate) {
      query += ' AND target_date = ?'
      params.push(targetDate)
    }

    if (since) {
      query += ` AND (
        status = 'pending'
        OR created_at >= ?
        OR resolved_at >= ?
        OR completed_at >= ?
        OR updated_at >= ?
      )`
      params.push(since, since, since, since)
    }

    query += ' ORDER BY created_at DESC'

    const tasks = db.prepare(query).all(...params)

    res.json(
      tasks.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        content: t.content,
        status: t.status,
        priority: t.priority,
        category: t.category,
        type: t.type,
        patientId: t.patient_id,
        patientName: t.patient_name,
        targetDate: t.target_date,
        assignedTo: t.assigned_to,
        assignee: JSON.parse(t.assignee || '{}'),
        creator: JSON.parse(t.creator || t.created_by || '{}'),
        createdBy: JSON.parse(t.created_by || '{}'),
        resolvedBy: JSON.parse(t.resolved_by || '{}'),
        resolvedAt: t.resolved_at,
        dueDate: t.due_date,
        completedAt: t.completed_at,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
      })).filter((task) => {
        if (assignee) {
          const taskAssignee = task.assignee || {}
          const isAssignedToUser = taskAssignee.value === assignee || taskAssignee.uid === assignee
          // assigneeRole 可為逗號分隔的多角色 (user.role + 職稱對照角色)，命中其一即可
          const isAssignedToRole =
            assigneeRole &&
            assigneeRole.split(',').some((r) => {
              const role = r.trim()
              return role && (taskAssignee.value === role || taskAssignee.role === role)
            })
          if (!isAssignedToUser && !isAssignedToRole) return false
        }
        if (creator) {
          const taskCreator = task.creator || task.createdBy || {}
          if (taskCreator.uid !== creator) return false
        }
        return true
      }),
    )
  } catch (error) {
    console.error('取得任務列表錯誤:', error)
    res.status(500).json({
      error: true,
      message: '取得任務列表失敗',
    })
  }
})

/**
 * POST /api/system/tasks
 * 新增任務
 */
router.post('/tasks', authenticate, async (req, res) => {
  try {
    const {
      id: providedId,
      title,
      description,
      content,
      priority,
      category,
      type,
      patientId,
      patientName,
      targetDate,
      assignedTo,
      assignee,
      dueDate,
    } = req.body

    // 允許沒有 title，但內容相關的 task/message 需要有 content
    const id = providedId || uuidv4()
    const db = getDatabase()

    const creator = JSON.stringify({ uid: req.user.id, name: req.user.name })

    db.prepare(
      `
      INSERT INTO tasks (
        id, title, description, content, priority, category, type,
        patient_id, patient_name, target_date, assigned_to, assignee,
        due_date, creator, created_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      id,
      title || '',
      description || '',
      content || '',
      priority || 'normal',
      category || 'task',
      type || '常規',
      patientId || null,
      patientName || null,
      targetDate || null,
      assignedTo || null,
      assignee ? JSON.stringify(assignee) : '{}',
      dueDate || null,
      creator,
      creator,
    )


    res.status(201).json({
      success: true,
      id,
    })
  } catch (error) {
    console.error('新增任務錯誤:', error)
    res.status(500).json({
      error: true,
      message: '新增任務失敗',
    })
  }
})

/**
 * PUT /api/system/tasks/:id
 * 更新任務
 * (Angular 前端用 PATCH 做部分更新，TPH 後端用 PUT；兩者共用同一 handler)
 */
async function updateTaskHandler(req, res) {
  try {
    const { id } = req.params
    const updateData = req.body

    const db = getDatabase()

    const updates = ["updated_at = datetime('now', 'localtime')"]
    const params = []

    // 支援所有可能的欄位更新
    if (updateData.title !== undefined) {
      updates.push('title = ?')
      params.push(updateData.title)
    }
    if (updateData.description !== undefined) {
      updates.push('description = ?')
      params.push(updateData.description)
    }
    if (updateData.content !== undefined) {
      updates.push('content = ?')
      params.push(updateData.content)
    }
    if (updateData.status !== undefined) {
      updates.push('status = ?')
      params.push(updateData.status)
      if (updateData.status === 'completed') {
        updates.push("completed_at = datetime('now', 'localtime')")
      }
    }
    if (updateData.priority !== undefined) {
      updates.push('priority = ?')
      params.push(updateData.priority)
    }
    if (updateData.assignedTo !== undefined) {
      updates.push('assigned_to = ?')
      params.push(
        typeof updateData.assignedTo === 'object'
          ? JSON.stringify(updateData.assignedTo)
          : updateData.assignedTo,
      )
    }
    if (updateData.assignee !== undefined) {
      updates.push('assignee = ?')
      params.push(JSON.stringify(updateData.assignee))
    }
    if (updateData.dueDate !== undefined) {
      updates.push('due_date = ?')
      params.push(updateData.dueDate)
    }
    if (updateData.targetDate !== undefined) {
      updates.push('target_date = ?')
      params.push(updateData.targetDate)
    }
    if (updateData.resolvedBy !== undefined) {
      updates.push('resolved_by = ?')
      params.push(JSON.stringify(updateData.resolvedBy))
    }
    if (updateData.resolvedAt !== undefined) {
      updates.push('resolved_at = ?')
      params.push(updateData.resolvedAt)
    }
    if (updateData.patientId !== undefined) {
      updates.push('patient_id = ?')
      params.push(updateData.patientId)
    }
    if (updateData.patientName !== undefined) {
      updates.push('patient_name = ?')
      params.push(updateData.patientName)
    }
    if (updateData.category !== undefined) {
      updates.push('category = ?')
      params.push(updateData.category)
    }
    if (updateData.type !== undefined) {
      updates.push('type = ?')
      params.push(updateData.type)
    }

    params.push(id)

    db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).run(...params)

    res.json({
      success: true,
      message: '任務已更新',
    })
  } catch (error) {
    console.error('更新任務錯誤:', error)
    res.status(500).json({
      error: true,
      message: '更新任務失敗',
    })
  }
}
router.put('/tasks/:id', authenticate, updateTaskHandler)

/**
 * DELETE /api/system/tasks/:id
 * 刪除任務
 */
router.delete('/tasks/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const db = getDatabase()

    // 使用軟刪除：將狀態設為 deleted
    db.prepare(
      `
      UPDATE tasks
      SET status = 'deleted', updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `,
    ).run(id)


    res.json({
      success: true,
      message: '任務已刪除',
    })
  } catch (error) {
    console.error('刪除任務錯誤:', error)
    res.status(500).json({
      error: true,
      message: '刪除任務失敗',
    })
  }
})

// ========================================
// 通知 API
// ========================================

/**
 * GET /api/system/notifications
 * 取得通知列表
 */
router.get('/notifications', authenticate, (req, res) => {
  try {
    const db = getDatabase()

    // INDEXED BY：MULTI-INDEX OR 對 recipient_id 索引會導致 ORDER BY 走 TEMP B-TREE，
    // 強制走 created_at 索引改以掃描順序取代排序（效能批次 2A，語意不變，已用 EXPLAIN QUERY PLAN 驗證結果集一致）
    const notifications = db
      .prepare(
        `
      SELECT * FROM notifications INDEXED BY idx_notifications_created_at
      WHERE recipient_id = ? OR recipient_id IS NULL
      ORDER BY created_at DESC
      LIMIT 100
    `,
      )
      .all(req.user.id)


    res.json(
      notifications.map((n) => {
        const data = JSON.parse(n.data || '{}')
        const createdBy = data.createdBy || null
        let createdByName = null
        if (createdBy && typeof createdBy === 'object') {
          createdByName = createdBy.name || createdBy.displayName || null
        } else if (typeof createdBy === 'string' && createdBy) {
          const user = db
            .prepare(`SELECT name, username FROM users WHERE id = ? OR username = ?`)
            .get(createdBy, createdBy)
          createdByName = user?.name || user?.username || null
        }
        return {
          id: n.id,
          type: n.type,
          title: n.title,
          message: n.message,
          recipientId: n.recipient_id,
          isRead: n.is_read === 1,
          data,
          createdBy,
          createdByName,
          metadata: data.metadata || null,
          createdAt: n.created_at,
        }
      }),
    )
  } catch (error) {
    console.error('取得通知錯誤:', error)
    res.status(500).json({
      error: true,
      message: '取得通知失敗',
    })
  }
})

/**
 * POST /api/system/notifications
 * 建立通知
 */
router.post('/notifications', authenticate, async (req, res) => {
  try {
    const { type, title, message, recipientId, data, createdBy, createdByName, metadata, expireAt } = req.body

    const id = uuidv4()
    const db = getDatabase()

    // 將 createdBy, metadata, expireAt 合併到 data JSON 中保存
    const enrichedData = {
      ...(data || {}),
      createdBy: createdBy
        ? (typeof createdBy === 'string'
          ? { uid: createdBy, name: createdByName || req.user.name }
          : createdBy)
        : { uid: req.user.id, name: req.user.name },
      metadata: metadata || null,
      expireAt: expireAt || null,
    }

    db.prepare(
      `
      INSERT INTO notifications (id, type, title, message, recipient_id, data)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    ).run(
      id,
      typeof type === 'string' && type ? type : 'info',
      typeof title === 'string' ? title : '',
      typeof message === 'string' ? message : '',
      typeof recipientId === 'string' && recipientId ? recipientId : null,
      JSON.stringify(enrichedData),
    )


    res.status(201).json({
      success: true,
      id,
    })
  } catch (error) {
    console.error('建立通知錯誤:', error)
    res.status(500).json({
      error: true,
      message: '建立通知失敗',
    })
  }
})

/**
 * PUT /api/system/notifications/:id/read（前端送 PATCH，由 index.js 全域轉為 PUT）
 * 標記通知為已讀
 */
router.put('/notifications/:id/read', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const db = getDatabase()

    db.prepare(`UPDATE notifications SET is_read = 1 WHERE id = ?`).run(id)

    res.json({
      success: true,
    })
  } catch (error) {
    console.error('更新通知錯誤:', error)
    res.status(500).json({
      error: true,
      message: '更新通知失敗',
    })
  }
})

// ========================================
// 庫存 API
// ========================================

/**
 * GET /api/system/inventory
 * 取得庫存列表
 */
router.get('/inventory', ...isInventoryRole, (req, res) => {
  try {
    const db = getDatabase()

    const items = db.prepare(`SELECT * FROM inventory_items ORDER BY name`).all()

    // 消耗紀錄品名別名（上傳對照確認時記住的），依品項分組
    const aliasesByItem = new Map()
    for (const a of db
      .prepare(`SELECT id, alias, item_id FROM inventory_item_aliases ORDER BY alias`)
      .all()) {
      if (!aliasesByItem.has(a.item_id)) aliasesByItem.set(a.item_id, [])
      aliasesByItem.get(a.item_id).push({ id: a.id, alias: a.alias })
    }

    res.json(
      items.map((i) => ({
        id: i.id,
        name: i.name,
        category: i.category,
        aliases: aliasesByItem.get(i.id) || [],
        unit: i.unit,
        unitsPerBox: i.units_per_box,
        currentQuantity: i.current_quantity,
        minQuantity: i.min_quantity,
        safeInventoryLevel: i.safe_inventory_level || 0,
        hospitalCode: i.hospital_code,
        brand: i.brand,
        vendorPhone: i.vendor_phone,
        location: i.location,
        notes: i.notes,
        createdAt: i.created_at,
        updatedAt: i.updated_at,
      })),
    )
  } catch (error) {
    console.error('取得庫存錯誤:', error)
    res.status(500).json({
      error: true,
      message: '取得庫存失敗',
    })
  }
})

/**
 * POST /api/system/inventory
 * 新增庫存項目
 */
router.post('/inventory', ...isInventoryRole, async (req, res) => {
  try {
    const { name, category, unit, unitsPerBox, currentQuantity, minQuantity, safeInventoryLevel, hospitalCode, brand, vendorPhone, location, notes } = req.body

    const id = uuidv4()
    const db = getDatabase()

    db.prepare(
      `
      INSERT INTO inventory_items (id, name, category, unit, units_per_box, current_quantity, min_quantity, safe_inventory_level, hospital_code, brand, vendor_phone, location, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(id, name, category, unit ?? null, unitsPerBox || 1, currentQuantity || 0, minQuantity || 0, safeInventoryLevel || 0, hospitalCode ?? null, brand ?? null, vendorPhone ?? null, location ?? null, notes ?? null)


    res.status(201).json({
      success: true,
      id,
    })
  } catch (error) {
    console.error('新增庫存錯誤:', error)
    res.status(500).json({
      error: true,
      message: '新增庫存失敗',
    })
  }
})

/**
 * PUT /api/system/inventory/:id
 * 更新庫存項目
 */
router.put('/inventory/:id', ...isInventoryRole, async (req, res) => {
  try {
    const { id } = req.params
    const db = getDatabase()

    // 只更新有送的欄位（前端表單不含庫存量等欄位，整包 SET 會把它們洗成 NULL）
    const FIELD_COLUMN_MAP = {
      name: 'name',
      category: 'category',
      unit: 'unit',
      unitsPerBox: 'units_per_box',
      currentQuantity: 'current_quantity',
      minQuantity: 'min_quantity',
      safeInventoryLevel: 'safe_inventory_level',
      hospitalCode: 'hospital_code',
      brand: 'brand',
      vendorPhone: 'vendor_phone',
      location: 'location',
      notes: 'notes',
    }
    const updates = [`updated_at = datetime('now', 'localtime')`]
    const params = []
    for (const [field, column] of Object.entries(FIELD_COLUMN_MAP)) {
      if (req.body[field] !== undefined) {
        updates.push(`${column} = ?`)
        params.push(req.body[field])
      }
    }
    params.push(id)

    const result = db.prepare(`UPDATE inventory_items SET ${updates.join(', ')} WHERE id = ?`).run(...params)
    if (result.changes === 0) {
      return res.status(404).json({ error: true, message: '庫存項目不存在' })
    }

    res.json({
      success: true,
      message: '庫存已更新',
    })
  } catch (error) {
    console.error('更新庫存錯誤:', error)
    res.status(500).json({
      error: true,
      message: '更新庫存失敗',
    })
  }
})

/**
 * DELETE /api/system/inventory/:id
 * 刪除庫存項目
 */
router.delete('/inventory/:id', ...isInventoryRole, async (req, res) => {
  try {
    const { id } = req.params
    const db = getDatabase()

    db.transaction(() => {
      db.prepare('DELETE FROM inventory_item_aliases WHERE item_id = ?').run(id)
      db.prepare('DELETE FROM inventory_items WHERE id = ?').run(id)
    })()

    res.json({
      success: true,
      message: '庫存項目已刪除',
    })
  } catch (error) {
    console.error('刪除庫存錯誤:', error)
    res.status(500).json({
      error: true,
      message: '刪除庫存失敗',
    })
  }
})

// ========================================
// 消耗紀錄品名別名 API（inventory_item_aliases）
// 別名由「消耗紀錄上傳 → 品項對照確認」視窗建立（POST /orders/consumables/upload 的 itemMappings），這裡只提供查詢與刪除
// ========================================

/**
 * GET /api/system/inventory/aliases
 * 取得所有品名別名（含對應品項名稱）
 */
router.get('/inventory/aliases', ...isInventoryRole, (req, res) => {
  try {
    const db = getDatabase()
    const rows = db
      .prepare(
        `SELECT a.id, a.category, a.alias, a.item_id, a.created_by, a.created_at, i.name AS item_name
         FROM inventory_item_aliases a
         LEFT JOIN inventory_items i ON i.id = a.item_id
         ORDER BY a.category, a.alias`,
      )
      .all()
    res.json(
      rows.map((r) => ({
        id: r.id,
        category: r.category,
        alias: r.alias,
        itemId: r.item_id,
        itemName: r.item_name,
        createdBy: r.created_by,
        createdAt: r.created_at,
      })),
    )
  } catch (error) {
    console.error('取得品名別名錯誤:', error)
    res.status(500).json({ error: true, message: '取得品名別名失敗' })
  }
})

/**
 * DELETE /api/system/inventory/aliases/:id
 * 刪除一筆品名別名（之後上傳同名品項會再次要求確認）
 */
router.delete('/inventory/aliases/:id', ...isInventoryRole, (req, res) => {
  try {
    const db = getDatabase()
    const result = db.prepare('DELETE FROM inventory_item_aliases WHERE id = ?').run(req.params.id)
    if (result.changes === 0) {
      return res.status(404).json({ error: true, message: '別名不存在' })
    }
    res.json({ success: true, message: '別名已刪除' })
  } catch (error) {
    console.error('刪除品名別名錯誤:', error)
    res.status(500).json({ error: true, message: '刪除品名別名失敗' })
  }
})



/**
 * GET /api/system/inventory/purchases
 * 取得進貨紀錄列表
 */
router.get('/inventory/purchases', ...isInventoryRole, (req, res) => {
  try {
    const { month, category } = req.query
    const db = getDatabase()

    let query = `
      SELECT p.*, i.name as item_name, i.category as item_category, i.unit as item_unit, i.units_per_box
      FROM inventory_purchases p
      LEFT JOIN inventory_items i ON p.item_id = i.id
      WHERE 1=1
    `
    const params = []

    if (month) {
      query += ` AND strftime('%Y-%m', p.purchase_date) = ?`
      params.push(month)
    }

    if (category) {
      // 這裡需要透過 item_category 篩選
      query += ` AND i.category = ?`
      params.push(category)
    }

    query += ` ORDER BY p.purchase_date DESC, p.created_at DESC`

    const purchases = db.prepare(query).all(...params)

    res.json(purchases.map(mapPurchaseRow))
  } catch (error) {
    console.error('取得進貨紀錄錯誤:', error)
    res.status(500).json({
      error: true,
      message: '取得進貨紀錄失敗',
    })
  }
})

/**
 * inventory_purchases 列 → API 形狀
 * status：'ordered' 已叫貨待到貨 / 'arrived' 已到貨（入庫，庫存計算只算這種）；舊資料 NULL 視為 arrived
 * date = purchase_date = 實際到貨(入庫)日；orderDate 叫貨日；expectedDate 預計到貨日；batchId 批次群組
 */
function mapPurchaseRow(p) {
  return {
    id: p.id,
    itemId: p.item_id,
    item: p.item_name, // Mapping for frontend
    category: p.item_category, // Mapping for frontend
    quantity: p.quantity,
    boxQuantity: p.box_quantity || (p.units_per_box ? p.quantity / p.units_per_box : 0), // Fallback calculation if column missing
    unitPrice: p.unit_price,
    supplier: p.supplier,
    date: p.purchase_date,
    status: p.status || 'arrived',
    orderDate: p.order_date || null,
    expectedDate: p.expected_date || null,
    batchId: p.batch_id || null,
    arrivedBy: (() => {
      if (!p.arrived_by) return null
      try {
        return JSON.parse(p.arrived_by)
      } catch {
        return { name: String(p.arrived_by) }
      }
    })(),
    notes: p.notes,
    createdBy: JSON.parse(p.created_by || '{}').name || '未知',
    createdAt: p.created_at,
    updatedAt: p.updated_at || null,
  }
}

const PURCHASE_STATUSES = new Set(['ordered', 'arrived'])

/**
 * 由 itemId 或（品名 + 分類）解析庫存品項 id。
 * Angular 進貨表單送的是品名（item）而非 itemId；品名不存在時自動建立最小品項，
 * 讓進貨紀錄與月結/耗量統計（JOIN inventory_items）保持連結。
 */
function resolveInventoryItemId(db, { itemId, item, category }) {
  if (itemId) return itemId
  if (!item) return null

  const existing = category
    ? db.prepare(`SELECT id FROM inventory_items WHERE name = ? AND category = ?`).get(item, category)
    : db.prepare(`SELECT id FROM inventory_items WHERE name = ?`).get(item)
  if (existing) return existing.id

  const newId = uuidv4()
  db.prepare(`INSERT INTO inventory_items (id, name, category) VALUES (?, ?, ?)`)
    .run(newId, item, category ?? null)
  return newId
}

/**
 * POST /api/system/inventory/purchases
 * 新增進貨紀錄（接受 itemId 或 item 品名 + category；quantity = 總量、boxQuantity = 箱數）
 */
router.post('/inventory/purchases', ...isInventoryRole, async (req, res) => {
  try {
    const db = getDatabase()
    const createdBy = JSON.stringify({ uid: req.user.id, name: req.user.name })
    const result = insertPurchaseRow(db, req.body, createdBy)
    if (result.error) {
      return res.status(400).json({ error: true, message: result.error })
    }

    res.status(201).json({
      success: true,
      id: result.id,
    })
  } catch (error) {
    console.error('新增進貨紀錄錯誤:', error)
    res.status(500).json({
      error: true,
      message: '新增進貨紀錄失敗',
    })
  }
})

/**
 * 寫入一列 inventory_purchases（POST 單筆與 /batch 共用）
 * status 預設 'arrived'（相容舊的「新增進貨」= 直接入庫）；'ordered' 時 purchase_date 可為空（到貨時才填）
 */
function insertPurchaseRow(db, body, createdBy, batchId = null) {
  const { itemId, item, category, quantity, boxQuantity, unitPrice, supplier, date, notes, status, orderDate, expectedDate } = body || {}
  const resolvedItemId = resolveInventoryItemId(db, { itemId, item, category })
  if (!resolvedItemId) return { error: '缺少品項（itemId 或 item 品名）' }
  const finalStatus = PURCHASE_STATUSES.has(status) ? status : 'arrived'
  if (finalStatus === 'ordered' && !expectedDate) return { error: '叫貨需填預計到貨日' }

  const id = uuidv4()
  db.prepare(
    `
    INSERT INTO inventory_purchases (
      id, item_id, quantity, box_quantity, unit_price, supplier, purchase_date, notes, created_by,
      status, order_date, expected_date, batch_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    id,
    resolvedItemId,
    quantity ?? null,
    boxQuantity ?? null,
    unitPrice || 0,
    supplier ?? null,
    date ?? null,
    notes ?? null,
    createdBy,
    finalStatus,
    orderDate ?? null,
    expectedDate ?? null,
    batchId ?? body?.batchId ?? null,
  )
  return { id }
}

/**
 * POST /api/system/inventory/purchases/batch
 * 批次新增叫貨（行事曆「起訖日 + 每週/隔週 星期幾」展開後的多筆），同一 batch_id，交易寫入
 * body: { entries: [{ item, category, boxQuantity, quantity, expectedDate, orderDate, status? , notes? }] }
 */
router.post('/inventory/purchases/batch', ...isInventoryRole, async (req, res) => {
  try {
    const entries = Array.isArray(req.body?.entries) ? req.body.entries : []
    if (entries.length === 0) {
      return res.status(400).json({ error: true, message: '沒有要新增的資料' })
    }
    if (entries.length > 200) {
      return res.status(400).json({ error: true, message: '一次最多 200 筆' })
    }
    const db = getDatabase()
    const createdBy = JSON.stringify({ uid: req.user.id, name: req.user.name })
    const batchId = uuidv4()
    const ids = []
    let failed = null
    db.transaction(() => {
      for (const entry of entries) {
        const r = insertPurchaseRow(db, { status: 'ordered', ...entry }, createdBy, batchId)
        if (r.error) {
          failed = r.error
          throw new Error(r.error)
        }
        ids.push(r.id)
      }
    })()
    res.status(201).json({ success: true, batchId, ids, count: ids.length })
  } catch (error) {
    if (error && /缺少品項|預計到貨日/.test(error.message)) {
      return res.status(400).json({ error: true, message: error.message })
    }
    console.error('批次新增叫貨錯誤:', error)
    res.status(500).json({ error: true, message: '批次新增叫貨失敗' })
  }
})

/**
 * DELETE /api/system/inventory/purchases/batch/:batchId
 * 刪除同一批次中「尚未到貨」的叫貨（已到貨的保留，避免動到庫存）
 */
router.delete('/inventory/purchases/batch/:batchId', ...isInventoryRole, async (req, res) => {
  try {
    const { batchId } = req.params
    const db = getDatabase()
    const result = db
      .prepare(`DELETE FROM inventory_purchases WHERE batch_id = ? AND status = 'ordered'`)
      .run(batchId)
    res.json({ success: true, deleted: result.changes })
  } catch (error) {
    console.error('刪除批次叫貨錯誤:', error)
    res.status(500).json({ error: true, message: '刪除批次叫貨失敗' })
  }
})

/**
 * PUT /api/system/inventory/purchases/:id
 * 更新進貨紀錄
 */
router.put('/inventory/purchases/:id', ...isInventoryRole, async (req, res) => {
  try {
    const { id } = req.params
    const { itemId, item, category, quantity, boxQuantity, unitPrice, supplier, date, notes, status, orderDate, expectedDate } = req.body
    const db = getDatabase()

    const updates = [`updated_at = datetime('now', 'localtime')`]
    const params = []

    if (status !== undefined) {
      if (!PURCHASE_STATUSES.has(status)) {
        return res.status(400).json({ error: true, message: 'status 只能是 ordered 或 arrived' })
      }
      updates.push('status = ?')
      params.push(status)
      if (status === 'arrived') {
        // 標記到貨：記錄由誰確認；到貨日由 date 帶入（前端預設今天）
        updates.push('arrived_by = ?')
        params.push(JSON.stringify({ uid: req.user.id, name: req.user.name }))
      }
    }
    if (orderDate !== undefined) {
      updates.push('order_date = ?')
      params.push(orderDate)
    }
    if (expectedDate !== undefined) {
      updates.push('expected_date = ?')
      params.push(expectedDate)
    }

    if (itemId !== undefined || item !== undefined) {
      const resolvedItemId = resolveInventoryItemId(db, { itemId, item, category })
      if (resolvedItemId) {
        updates.push('item_id = ?')
        params.push(resolvedItemId)
      }
    }
    if (quantity !== undefined) {
      updates.push('quantity = ?')
      params.push(quantity)
    }
    if (boxQuantity !== undefined) {
      updates.push('box_quantity = ?')
      params.push(boxQuantity)
    }
    if (unitPrice !== undefined) {
      updates.push('unit_price = ?')
      params.push(unitPrice)
    }
    if (supplier !== undefined) {
      updates.push('supplier = ?')
      params.push(supplier)
    }
    if (date !== undefined) {
      updates.push('purchase_date = ?')
      params.push(date)
    }
    if (notes !== undefined) {
      updates.push('notes = ?')
      params.push(notes)
    }

    params.push(id)

    const result = db.prepare(`UPDATE inventory_purchases SET ${updates.join(', ')} WHERE id = ?`).run(...params)
    if (result.changes === 0) {
      return res.status(404).json({ error: true, message: '進貨紀錄不存在' })
    }

    res.json({
      success: true,
      message: '進貨紀錄已更新',
    })
  } catch (error) {
    console.error('更新進貨紀錄錯誤:', error)
    res.status(500).json({
      error: true,
      message: '更新進貨紀錄失敗',
    })
  }
})

/**
 * DELETE /api/system/inventory/purchases/:id
 */
router.delete('/inventory/purchases/:id', ...isInventoryRole, async (req, res) => {
  try {
    const { id } = req.params
    const db = getDatabase()

    db.prepare('DELETE FROM inventory_purchases WHERE id = ?').run(id)

    res.json({
      success: true,
      message: '進貨紀錄已刪除',
    })
  } catch (error) {
    console.error('刪除進貨紀錄錯誤:', error)
    res.status(500).json({
      error: true,
      message: '刪除進貨紀錄失敗',
    })
  }
})

// ========================================
// 盤點文件 API（2026-09-01 整合）
// 盤點 = 某盤點日各品項「實際數量」一份文件（單位：個；count_boxes 另存箱數輸入）。
// 週二週盤點與月底盤點是同一種紀錄。庫存總覽/每週訂單/月報表以「最近一次盤點」為基準：
//   推估庫存   = 盤點量 + 盤點日後已到貨(arrived) − 盤點日後消耗
//               （消耗：有上傳實際區間的日子用實際紀錄，缺的日子用排程推估；算法在前端 inventory-stock.service.ts）
//   下週訂單量 = max(0, 安全庫存(日均消耗 × 9 天) − 推估庫存 − 已叫貨待到貨)
// 舊的 /inventory/monthly/*、/inventory/weekly/*、/inventory/consumables/{upload,query}、/inventory/consumption/monthly-summary
// 讀寫的是 Vue 時代 report_data 扁平格式（row.consumableCounts），與現行 ranges 格式不符且前端無人呼叫，已於同日移除。
// ========================================

const COUNT_CATEGORIES = ['artificialKidney', 'dialysateCa', 'bicarbonateType']
const COUNT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function parseJsonObject(text) {
  try {
    const value = JSON.parse(text || '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch {
    return {}
  }
}

function isValidCountDate(value) {
  if (typeof value !== 'string' || !COUNT_DATE_RE.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
}

/** 只保留三類別 × 品名 → 非負數字；其餘鍵值丟棄 */
function sanitizeCountMap(input) {
  const out = {}
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out
  for (const category of COUNT_CATEGORIES) {
    const src = input[category]
    if (!src || typeof src !== 'object' || Array.isArray(src)) continue
    out[category] = {}
    for (const [name, value] of Object.entries(src)) {
      const key = String(name).trim()
      if (!key) continue
      const n = Number(value)
      out[category][key] = Number.isFinite(n) && n >= 0 ? n : 0
    }
  }
  return out
}

function mapCountDocRow(row) {
  const parseActor = (text) => {
    const obj = parseJsonObject(text)
    return obj.name || obj.uid ? obj : null
  }
  return {
    id: row.count_date,
    countDate: row.count_date,
    counts: parseJsonObject(row.counts),
    countBoxes: parseJsonObject(row.count_boxes),
    notes: row.notes || '',
    createdBy: parseActor(row.created_by),
    updatedBy: parseActor(row.updated_by),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * 品項反查表：`${category}:${name}` → id[]（inventory_items 對 (category,name) 沒有 UNIQUE，
 * 重複品項一律全部套用，避免只有其中一筆吃到盤點數量）
 */
function buildInventoryItemIdMap(db) {
  const items = db.prepare('SELECT id, name, category FROM inventory_items').all()
  const map = new Map()
  for (const i of items) {
    const key = `${i.category}:${i.name}`
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(i.id)
  }
  return map
}

/** 把某盤點文件的數量套到 inventory_items.current_quantity（品名+分類反查；查無者略過，不自動建品項） */
function applyCountDocToItemQuantities(db, counts) {
  const itemMap = buildInventoryItemIdMap(db)
  const updateQty = db.prepare('UPDATE inventory_items SET current_quantity = ? WHERE id = ?')
  let applied = 0
  for (const category of Object.keys(counts)) {
    for (const [name, qty] of Object.entries(counts[category])) {
      for (const itemId of itemMap.get(`${category}:${name}`) || []) {
        updateQty.run(qty, itemId)
        applied++
      }
    }
  }
  return applied
}

/**
 * GET /api/system/inventory/counts?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=N
 * 盤點文件列表（新→舊）
 */
router.get('/inventory/counts', ...isInventoryRole, (req, res) => {
  try {
    const { from, to, limit } = req.query
    const db = getDatabase()
    let sql = 'SELECT * FROM inventory_count_docs WHERE 1=1'
    const params = []
    if (from && isValidCountDate(String(from))) {
      sql += ' AND count_date >= ?'
      params.push(String(from))
    }
    if (to && isValidCountDate(String(to))) {
      sql += ' AND count_date <= ?'
      params.push(String(to))
    }
    sql += ' ORDER BY count_date DESC LIMIT ?'
    const lim = Math.min(Math.max(parseInt(limit, 10) || 500, 1), 500)
    params.push(lim)
    const rows = db.prepare(sql).all(...params)
    res.json(rows.map(mapCountDocRow))
  } catch (error) {
    console.error('取得盤點列表錯誤:', error)
    res.status(500).json({ error: true, message: '取得盤點列表失敗' })
  }
})

/**
 * GET /api/system/inventory/counts/latest?before=YYYY-MM-DD
 * 取 before（預設今天，台北）當天或之前最近一次盤點；沒有回 404
 */
router.get('/inventory/counts/latest', ...isInventoryRole, (req, res) => {
  try {
    const before = req.query.before && isValidCountDate(String(req.query.before))
      ? String(req.query.before)
      : getTaipeiTodayString()
    const db = getDatabase()
    const row = db
      .prepare('SELECT * FROM inventory_count_docs WHERE count_date <= ? ORDER BY count_date DESC LIMIT 1')
      .get(before)
    if (!row) {
      return res.status(404).json({ error: true, message: `${before} 之前沒有盤點紀錄` })
    }
    res.json(mapCountDocRow(row))
  } catch (error) {
    console.error('取得最近盤點錯誤:', error)
    res.status(500).json({ error: true, message: '取得最近盤點失敗' })
  }
})

/**
 * GET /api/system/inventory/counts/:date
 */
router.get('/inventory/counts/:date', ...isInventoryRole, (req, res) => {
  try {
    const { date } = req.params
    if (!isValidCountDate(date)) {
      return res.status(400).json({ error: true, message: '盤點日格式須為 YYYY-MM-DD' })
    }
    const db = getDatabase()
    const row = db.prepare('SELECT * FROM inventory_count_docs WHERE count_date = ?').get(date)
    if (!row) {
      return res.status(404).json({ error: true, message: `${date} 沒有盤點紀錄` })
    }
    res.json(mapCountDocRow(row))
  } catch (error) {
    console.error('取得盤點錯誤:', error)
    res.status(500).json({ error: true, message: '取得盤點失敗' })
  }
})

/**
 * PUT /api/system/inventory/counts/:date
 * 新增/覆寫該盤點日文件。body: { counts:{category:{item:個數}}, countBoxes:{category:{item:箱數}}, notes }
 * 同交易內：重寫 inventory_counts 該日流水；若此日是（含）最新盤點，套用到 inventory_items.current_quantity。
 */
router.put('/inventory/counts/:date', ...isInventoryRole, async (req, res) => {
  try {
    const { date } = req.params
    if (!isValidCountDate(date)) {
      return res.status(400).json({ error: true, message: '盤點日格式須為 YYYY-MM-DD' })
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const counts = sanitizeCountMap(body.counts)
    const countBoxes = sanitizeCountMap(body.countBoxes)
    const notes = typeof body.notes === 'string' ? body.notes.trim() : ''
    const actor = JSON.stringify({ uid: req.user.id, name: req.user.name })
    const db = getDatabase()

    const latest = db.prepare('SELECT MAX(count_date) AS d FROM inventory_count_docs').get()
    const isLatest = !latest?.d || date >= latest.d

    const upsert = db.prepare(`
      INSERT INTO inventory_count_docs (count_date, counts, count_boxes, notes, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(count_date) DO UPDATE SET
        counts = excluded.counts,
        count_boxes = excluded.count_boxes,
        notes = excluded.notes,
        updated_by = excluded.updated_by,
        updated_at = datetime('now', 'localtime')
    `)
    const deleteRows = db.prepare('DELETE FROM inventory_counts WHERE count_date = ?')
    const insertRow = db.prepare(`
      INSERT INTO inventory_counts (id, item_id, counted_quantity, count_date, discrepancy, notes, counted_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    db.transaction(() => {
      upsert.run(date, JSON.stringify(counts), JSON.stringify(countBoxes), notes, actor, actor)
      deleteRows.run(date)
      const itemMap = buildInventoryItemIdMap(db)
      for (const category of Object.keys(counts)) {
        for (const [name, qty] of Object.entries(counts[category])) {
          for (const itemId of itemMap.get(`${category}:${name}`) || []) {
            insertRow.run(uuidv4(), itemId, qty, date, 0, 'count-doc', actor)
          }
        }
      }
      if (isLatest) applyCountDocToItemQuantities(db, counts)
    })()

    await logAudit('INVENTORY_COUNT_SAVE', req.user.id, req.user.name, 'inventory_count_docs', date, {
      itemCount: Object.values(counts).reduce((n, m) => n + Object.keys(m).length, 0),
      isLatest,
    })

    const row = db.prepare('SELECT * FROM inventory_count_docs WHERE count_date = ?').get(date)
    res.json(mapCountDocRow(row))
  } catch (error) {
    console.error('儲存盤點錯誤:', error)
    res.status(500).json({ error: true, message: '儲存盤點失敗' })
  }
})

/**
 * DELETE /api/system/inventory/counts/:date
 * 刪除盤點文件與該日 inventory_counts 流水；若刪的是最新盤點，品項 current_quantity 改套用新的最新盤點。
 */
router.delete('/inventory/counts/:date', ...isInventoryRole, async (req, res) => {
  try {
    const { date } = req.params
    if (!isValidCountDate(date)) {
      return res.status(400).json({ error: true, message: '盤點日格式須為 YYYY-MM-DD' })
    }
    const db = getDatabase()
    const existing = db.prepare('SELECT count_date FROM inventory_count_docs WHERE count_date = ?').get(date)
    if (!existing) {
      return res.status(404).json({ error: true, message: `${date} 沒有盤點紀錄` })
    }
    const latest = db.prepare('SELECT MAX(count_date) AS d FROM inventory_count_docs').get()
    const wasLatest = latest?.d === date

    db.transaction(() => {
      db.prepare('DELETE FROM inventory_count_docs WHERE count_date = ?').run(date)
      db.prepare('DELETE FROM inventory_counts WHERE count_date = ?').run(date)
      if (wasLatest) {
        const next = db.prepare('SELECT counts FROM inventory_count_docs ORDER BY count_date DESC LIMIT 1').get()
        if (next) applyCountDocToItemQuantities(db, parseJsonObject(next.counts))
      }
    })()

    await logAudit('INVENTORY_COUNT_DELETE', req.user.id, req.user.name, 'inventory_count_docs', date, {
      wasLatest,
    })

    res.json({ success: true, message: '盤點紀錄已刪除', countDate: date })
  } catch (error) {
    console.error('刪除盤點錯誤:', error)
    res.status(500).json({ error: true, message: '刪除盤點失敗' })
  }
})


// ========================================
// 站點配置 API
// ========================================

/**
 * GET /api/system/site-config/:id
 * 取得站點配置
 */
router.get('/site-config/:id', authenticate, (req, res) => {
  try {
    const { id } = req.params
    const db = getDatabase()

    const config = db.prepare(`SELECT * FROM site_config WHERE id = ?`).get(id)

    if (!config) {
      return res.json({
        id,
        configData: {},
      })
    }

    res.json({
      id: config.id,
      configData: JSON.parse(config.config_data || '{}'),
      createdAt: config.created_at,
      updatedAt: config.updated_at,
    })
  } catch (error) {
    console.error('取得站點配置錯誤:', error)
    res.status(500).json({
      error: true,
      message: '取得站點配置失敗',
    })
  }
})

/**
 * PUT /api/system/site-config/:id
 * 更新站點配置
 */
router.put('/site-config/:id', ...isContributor, async (req, res) => {
  try {
    const { id } = req.params
    const configData = req.body

    const db = getDatabase()

    db.prepare(
      `
      INSERT INTO site_config (id, config_data, updated_at)
      VALUES (?, ?, datetime('now', 'localtime'))
      ON CONFLICT(id) DO UPDATE SET
        config_data = excluded.config_data,
        updated_at = datetime('now', 'localtime')
    `,
    ).run(id, JSON.stringify(configData))


    res.json({
      success: true,
      message: '站點配置已更新',
    })
  } catch (error) {
    console.error('更新站點配置錯誤:', error)
    res.status(500).json({
      error: true,
      message: '更新站點配置失敗',
    })
  }
})

// ========================================
// Auto-Assign 設定 API (Angular 前端使用)
// ========================================

/**
 * GET /api/system/auto-assign-config/current
 * 取得自動分配設定（使用 site_config table, id='auto_assign_config'）
 */
router.get('/auto-assign-config/current', authenticate, (req, res) => {
  try {
    const db = getDatabase()
    const config = db.prepare(`SELECT * FROM site_config WHERE id = 'auto_assign_config'`).get()

    if (!config) {
      return res.json({
        id: 'auto_assign_config',
        configData: {},
      })
    }

    res.json({
      id: config.id,
      configData: JSON.parse(config.config_data || '{}'),
      createdAt: config.created_at,
      updatedAt: config.updated_at,
    })
  } catch (error) {
    console.error('取得自動分配設定錯誤:', error)
    res.status(500).json({
      error: true,
      message: '取得自動分配設定失敗',
    })
  }
})

/**
 * PUT /api/system/auto-assign-config/current
 * 更新自動分配設定
 */
router.put('/auto-assign-config/current', ...isContributor, async (req, res) => {
  try {
    const configData = req.body
    const db = getDatabase()

    db.prepare(
      `
      INSERT INTO site_config (id, config_data, updated_at)
      VALUES ('auto_assign_config', ?, datetime('now', 'localtime'))
      ON CONFLICT(id) DO UPDATE SET
        config_data = excluded.config_data,
        updated_at = datetime('now', 'localtime')
    `,
    ).run(JSON.stringify(configData))

    res.json({
      success: true,
      message: '自動分配設定已更新',
    })
  } catch (error) {
    console.error('更新自動分配設定錯誤:', error)
    res.status(500).json({
      error: true,
      message: '更新自動分配設定失敗',
    })
  }
})

// ========================================
// Config Key 別名 (Angular 前端使用 /config/:key)
// ========================================

/**
 * GET /api/system/config/:key
 * 別名 → site-config/:key（Angular 前端統一使用 config 路徑）
 */
router.get('/config/:key', authenticate, (req, res) => {
  try {
    const { key } = req.params
    const db = getDatabase()

    const config = db.prepare(`SELECT * FROM site_config WHERE id = ?`).get(key)

    if (!config) {
      return res.json({ id: key, configData: {} })
    }

    res.json({
      id: config.id,
      configData: JSON.parse(config.config_data || '{}'),
      createdAt: config.created_at,
      updatedAt: config.updated_at,
    })
  } catch (error) {
    console.error('取得配置錯誤:', error)
    res.status(500).json({ error: true, message: '取得配置失敗' })
  }
})

/**
 * PUT /api/system/config/:key
 * 別名 → site-config/:key
 */
router.put('/config/:key', ...isContributor, async (req, res) => {
  try {
    const { key } = req.params
    const configData = req.body
    const db = getDatabase()

    db.prepare(`
      INSERT INTO site_config (id, config_data, updated_at)
      VALUES (?, ?, datetime('now', 'localtime'))
      ON CONFLICT(id) DO UPDATE SET
        config_data = excluded.config_data,
        updated_at = datetime('now', 'localtime')
    `).run(key, JSON.stringify(configData))

    res.json({ success: true, message: '配置已更新' })
  } catch (error) {
    console.error('更新配置錯誤:', error)
    res.status(500).json({ error: true, message: '更新配置失敗' })
  }
})

// ========================================
// 稽核日誌 API (僅管理員)
// ========================================

/**
 * GET /api/system/audit-logs
 * 取得稽核日誌
 */
router.get('/audit-logs', ...isAdmin, (req, res) => {
  try {
    const { action, userId, startDate, endDate, limit = 100 } = req.query
    const db = getDatabase()

    let query = 'SELECT * FROM audit_logs WHERE 1=1'
    const params = []

    if (action) {
      query += ' AND action = ?'
      params.push(action)
    }

    if (userId) {
      query += ' AND user_id = ?'
      params.push(userId)
    }

    if (startDate) {
      query += ' AND created_at >= ?'
      params.push(startDate)
    }

    if (endDate) {
      query += ' AND created_at <= ?'
      params.push(endDate)
    }

    query += ' ORDER BY created_at DESC LIMIT ?'
    params.push(parseInt(limit))

    const logs = db.prepare(query).all(...params)

    res.json(
      logs.map((l) => ({
        id: l.id,
        action: l.action,
        userId: l.user_id,
        userName: l.user_name,
        collection: l.collection_name,
        documentId: l.document_id,
        details: JSON.parse(l.details || '{}'),
        ipAddress: l.ip_address,
        success: l.success === 1,
        createdAt: l.created_at,
      })),
    )
  } catch (error) {
    console.error('取得稽核日誌錯誤:', error)
    res.status(500).json({
      error: true,
      message: '取得稽核日誌失敗',
    })
  }
})

// ========================================
// 醫師相關 API
// ========================================

/**
 * GET /api/system/physicians
 * 取得醫師列表 (從 physicians 表)
 */
router.get('/physicians', authenticate, (req, res) => {
  try {
    const db = getDatabase()

    // 依名稱分組避免重複，選取最新更新的記錄
    const physicians = db
      .prepare(
        `
      SELECT p.* FROM physicians p
      INNER JOIN (
        SELECT name, MAX(updated_at) as max_updated
        FROM physicians
        WHERE is_active = 1
        GROUP BY name
      ) latest ON p.name = latest.name AND p.updated_at = latest.max_updated
      WHERE p.is_active = 1
      ORDER BY p.name
    `,
      )
      .all()

    console.log(`[Physicians API] 回傳 ${physicians.length} 位醫師`)
    physicians.forEach((p) => {
      console.log(`  - ${p.name}: defaultSchedules=${p.default_schedules}`)
    })


    res.json(
      physicians.map((p) => ({
        id: p.id,
        name: p.name,
        specialty: p.specialty,
        staffId: p.staff_id,
        phone: p.phone,
        clinicHours: JSON.parse(p.clinic_hours || '[]'),
        defaultSchedules: JSON.parse(p.default_schedules || '[]'),
        defaultConsultationSchedules: JSON.parse(p.default_consultation_schedules || '[]'),
        isActive: p.is_active === 1,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
      })),
    )
  } catch (error) {
    console.error('取得醫師列表錯誤:', error)
    res.status(500).json({
      error: true,
      message: '取得醫師列表失敗',
    })
  }
})

/**
 * POST /api/system/physicians
 * 新增醫師
 */
router.post('/physicians', ...isAdmin, async (req, res) => {
  try {
    const { name, specialty } = req.body

    const id = uuidv4()
    const db = getDatabase()

    db.prepare(
      `
      INSERT INTO physicians (id, name, specialty)
      VALUES (?, ?, ?)
    `,
    ).run(id, name, specialty)


    res.status(201).json({
      success: true,
      id,
    })
  } catch (error) {
    console.error('新增醫師錯誤:', error)
    res.status(500).json({
      error: true,
      message: '新增醫師失敗',
    })
  }
})

// ========================================
// 醫師班表 API
// ========================================

/**
 * GET /api/system/physician-schedules
 * 取得所有醫師班表（供年度累計統計；id 為 YYYY-MM，攤平 year/month + schedule_data）
 */
router.get('/physician-schedules', authenticate, (req, res) => {
  try {
    const db = getDatabase()
    const rows = db.prepare(`SELECT * FROM physician_schedules ORDER BY id`).all()
    const list = rows.map((row) => {
      let data = {}
      try {
        data = JSON.parse(row.schedule_data || '{}')
      } catch {
        data = {}
      }
      const m = /^(\d{4})-(\d{2})$/.exec(row.id || '')
      return {
        id: row.id,
        year: m ? Number(m[1]) : undefined,
        month: m ? Number(m[2]) : undefined,
        ...data,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }
    })
    res.json(list)
  } catch (error) {
    console.error('取得醫師班表清單錯誤:', error)
    res.status(500).json({ error: true, message: '取得醫師班表清單失敗' })
  }
})

/**
 * GET /api/system/physician-schedules/:date
 * 取得特定日期的醫師班表
 */
router.get('/physician-schedules/:date', authenticate, (req, res) => {
  try {
    const { date } = req.params
    console.log(`[PhysicianSchedule] 查詢 id=${date}`)
    const db = getDatabase()

    const schedule = db
      .prepare(
        `
      SELECT * FROM physician_schedules WHERE id = ?
    `,
      )
      .get(date)

    // 檢查資料表中有多少筆資料
    const count = db.prepare(`SELECT COUNT(*) as count FROM physician_schedules`).get()
    console.log(`[PhysicianSchedule] 資料表共有 ${count.count} 筆資料`)


    if (!schedule) {
      console.log(`[PhysicianSchedule] 找不到 id=${date} 的資料，回傳空班表`)
      return res.json({
        id: date,
        scheduleData: {},
        createdAt: null,
        updatedAt: null,
      })
    }

    console.log(
      `[PhysicianSchedule] 找到資料，schedule_data 長度: ${(schedule.schedule_data || '').length}`,
    )
    res.json({
      id: schedule.id,
      scheduleData: JSON.parse(schedule.schedule_data || '{}'),
      createdAt: schedule.created_at,
      updatedAt: schedule.updated_at,
    })
  } catch (error) {
    console.error('取得醫師班表錯誤:', error)
    res.status(500).json({
      error: true,
      message: '取得醫師班表失敗',
    })
  }
})

/**
 * PUT /api/system/physician-schedules/:date
 * 更新特定日期的醫師班表
 */
router.put('/physician-schedules/:date', ...isContributor, async (req, res) => {
  try {
    const { date } = req.params
    const scheduleData = req.body

    const db = getDatabase()

    db.prepare(
      `
      INSERT INTO physician_schedules (id, schedule_data, updated_at)
      VALUES (?, ?, datetime('now', 'localtime'))
      ON CONFLICT(id) DO UPDATE SET
        schedule_data = excluded.schedule_data,
        updated_at = datetime('now', 'localtime')
    `,
    ).run(date, JSON.stringify(scheduleData))

    const updated = db
      .prepare(
        `
      SELECT * FROM physician_schedules WHERE id = ?
    `,
      )
      .get(date)


    await logAudit(
      'PHYSICIAN_SCHEDULE_UPDATE',
      req.user.id,
      req.user.name,
      'physician_schedules',
      date,
      scheduleData,
    )

    res.json({
      success: true,
      id: updated.id,
      scheduleData: JSON.parse(updated.schedule_data || '{}'),
      updatedAt: updated.updated_at,
    })
  } catch (error) {
    console.error('更新醫師班表錯誤:', error)
    res.status(500).json({
      error: true,
      message: '更新醫師班表失敗',
    })
  }
})

// ========================================
// 國定假日主檔 API（同步政府行政機關辦公日曆表）
// 存放：site_config id='holiday_calendar'，config_data = { "2026": { holidays:[{date,name}], syncedAt, source } }
// 資料來源：政府資料開放平臺 dataset 14718（人事行政總處，每年公告一次）
// ========================================

const HOLIDAY_CONFIG_ID = 'holiday_calendar'
const GOV_CALENDAR_DATASET_API = 'https://data.gov.tw/api/v2/rest/dataset/14718'

function readHolidayCalendarMap(db) {
  const row = db.prepare(`SELECT config_data FROM site_config WHERE id = ?`).get(HOLIDAY_CONFIG_ID)
  if (!row) return {}
  try {
    return JSON.parse(row.config_data || '{}')
  } catch {
    return {}
  }
}

function saveHolidayCalendarYear(db, year, entry) {
  const map = readHolidayCalendarMap(db)
  map[String(year)] = entry
  db.prepare(`
    INSERT INTO site_config (id, config_data, updated_at)
    VALUES (?, ?, datetime('now', 'localtime'))
    ON CONFLICT(id) DO UPDATE SET
      config_data = excluded.config_data,
      updated_at = datetime('now', 'localtime')
  `).run(HOLIDAY_CONFIG_ID, JSON.stringify(map))
}

// 政府 CSV 可能是 UTF-8(BOM) 或 Big5；先照提示解碼，出現亂碼替換字元再換另一套
function decodeGovCsvBuffer(buffer, encodingHint) {
  const tryDecode = (encoding) => {
    try {
      return new TextDecoder(encoding).decode(buffer)
    } catch {
      return null
    }
  }
  const candidates = []
  const hint = (encodingHint || '').toLowerCase()
  if (hint.includes('big5')) candidates.push('big5', 'utf-8')
  else candidates.push('utf-8', 'big5')
  for (const encoding of candidates) {
    const text = tryDecode(encoding)
    if (text && !text.includes('�')) return text
  }
  return tryDecode('utf-8') || ''
}

// 解析辦公日曆表 CSV：西元日期(yyyymmdd),星期,是否放假(0/2),備註
// 回傳指定年份的國定假日（放假且備註非空 → 含補假與新法定節日）。
// 注意：一般週末備註為空所以排除，但「撞週末的國定假日」（如國慶撞週六）備註是節日名、會收入清單。
// 此清單只是前端下拉/「帶入本月假日」的候選參考（手動觸發、只加不刪），不會自動套進任何月份；
// 醫院放假與政府行事曆可能不同，各月實際假日以該月手動設定存檔為準（2026-08-14 使用者裁定）。
function parseGovCalendarCsv(csvText, year) {
  const holidays = []
  const lines = csvText.replace(/^\uFEFF/, '').split(/\r?\n/)
  for (const line of lines) {
    if (!line.trim()) continue
    const fields = line.split(',').map((f) => f.trim().replace(/^"|"$/g, ''))
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec(fields[0] || '')
    if (!m) continue // 表頭或格式不符的列
    if (Number(m[1]) !== year) continue
    const isDayOff = (fields[2] || '') === '2'
    const note = (fields[3] || '').trim()
    if (isDayOff && note) {
      holidays.push({ date: `${m[1]}-${m[2]}-${m[3]}`, name: note })
    }
  }
  holidays.sort((a, b) => a.date.localeCompare(b.date))
  return holidays
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * GET /api/system/holidays/:year
 * 取得某年度的國定假日主檔（未同步過回空陣列）
 */
router.get('/holidays/:year', authenticate, (req, res) => {
  try {
    const year = Number(req.params.year)
    if (!/^\d{4}$/.test(req.params.year)) {
      return res.status(400).json({ error: true, message: '年份格式錯誤' })
    }
    const db = getDatabase()
    const entry = readHolidayCalendarMap(db)[String(year)] || {}
    res.json({
      year,
      holidays: Array.isArray(entry.holidays) ? entry.holidays : [],
      syncedAt: entry.syncedAt || null,
      source: entry.source || null,
    })
  } catch (error) {
    console.error('取得國定假日主檔錯誤:', error)
    res.status(500).json({ error: true, message: '取得國定假日主檔失敗' })
  }
})

/**
 * POST /api/system/holidays/:year/sync
 * 從政府資料開放平臺抓取該年度辦公日曆表 CSV，解析後存入主檔
 */
router.post('/holidays/:year/sync', ...isContributor, async (req, res) => {
  try {
    const year = Number(req.params.year)
    if (!/^\d{4}$/.test(req.params.year)) {
      return res.status(400).json({ error: true, message: '年份格式錯誤' })
    }

    // 下載網址每年變動（隨機檔名），需先查 dataset API 找當年度檔案
    let dataset
    try {
      const metaRes = await fetchWithTimeout(GOV_CALENDAR_DATASET_API, 15000)
      if (!metaRes.ok) throw new Error(`dataset API HTTP ${metaRes.status}`)
      dataset = await metaRes.json()
    } catch (err) {
      console.error('查詢政府資料平臺失敗:', err)
      return res.status(502).json({
        error: true,
        message: '無法連線政府資料開放平臺，請稍後再試或改用「匯入 CSV」',
      })
    }

    const rocYear = year - 1911
    const wantedDescription = `${rocYear}年中華民國政府行政機關辦公日曆表`
    const distributions = dataset?.result?.distribution || []
    const target = distributions.find(
      (d) =>
        (d.resourceFormat || '').toUpperCase() === 'CSV' &&
        (d.resourceDescription || '').trim() === wantedDescription,
    )
    if (!target || !target.resourceDownloadUrl) {
      return res.status(404).json({
        error: true,
        message: `政府平臺尚未提供 ${year} 年（民國 ${rocYear} 年）辦公日曆表，通常於前一年 6~7 月公告`,
      })
    }

    let csvText
    try {
      const csvRes = await fetchWithTimeout(target.resourceDownloadUrl, 20000)
      if (!csvRes.ok) throw new Error(`CSV 下載 HTTP ${csvRes.status}`)
      const buffer = await csvRes.arrayBuffer()
      csvText = decodeGovCsvBuffer(buffer, target.resourceCharacterEncoding)
    } catch (err) {
      console.error('下載辦公日曆表 CSV 失敗:', err)
      return res.status(502).json({
        error: true,
        message: '下載辦公日曆表檔案失敗，請稍後再試或改用「匯入 CSV」',
      })
    }

    const holidays = parseGovCalendarCsv(csvText, year)
    if (holidays.length === 0) {
      return res.status(422).json({ error: true, message: '解析結果為空，檔案格式可能已變更，請改用「匯入 CSV」或回報管理者' })
    }

    const db = getDatabase()
    const entry = {
      holidays,
      syncedAt: new Date().toLocaleString('sv-SE'),
      source: 'data.gov.tw',
    }
    saveHolidayCalendarYear(db, year, entry)

    await logAudit('HOLIDAY_CALENDAR_SYNC', req.user.id, req.user.name, 'site_config', HOLIDAY_CONFIG_ID, {
      year,
      count: holidays.length,
      source: 'data.gov.tw',
    })

    res.json({ success: true, year, count: holidays.length, ...entry })
  } catch (error) {
    console.error('同步國定假日錯誤:', error)
    res.status(500).json({ error: true, message: '同步國定假日失敗' })
  }
})

/**
 * POST /api/system/holidays/:year/import
 * 手動上傳辦公日曆表 CSV（base64），格式同政府檔案；外網不通時的備援
 */
router.post('/holidays/:year/import', ...isContributor, async (req, res) => {
  try {
    const year = Number(req.params.year)
    if (!/^\d{4}$/.test(req.params.year)) {
      return res.status(400).json({ error: true, message: '年份格式錯誤' })
    }
    const { csvBase64 } = req.body || {}
    if (!csvBase64 || typeof csvBase64 !== 'string') {
      return res.status(400).json({ error: true, message: '缺少 CSV 檔案內容' })
    }

    let buffer
    try {
      buffer = Buffer.from(csvBase64, 'base64')
    } catch {
      return res.status(400).json({ error: true, message: 'CSV 檔案內容格式錯誤' })
    }
    const csvText = decodeGovCsvBuffer(buffer, null)
    const holidays = parseGovCalendarCsv(csvText, year)
    if (holidays.length === 0) {
      return res.status(422).json({
        error: true,
        message: `檔案中找不到 ${year} 年的國定假日，請確認上傳的是該年度「政府行政機關辦公日曆表」CSV`,
      })
    }

    const db = getDatabase()
    const entry = {
      holidays,
      syncedAt: new Date().toLocaleString('sv-SE'),
      source: '手動匯入',
    }
    saveHolidayCalendarYear(db, year, entry)

    await logAudit('HOLIDAY_CALENDAR_IMPORT', req.user.id, req.user.name, 'site_config', HOLIDAY_CONFIG_ID, {
      year,
      count: holidays.length,
      source: '手動匯入',
    })

    res.json({ success: true, year, count: holidays.length, ...entry })
  } catch (error) {
    console.error('匯入國定假日錯誤:', error)
    res.status(500).json({ error: true, message: '匯入國定假日失敗' })
  }
})

// ========================================
// 預約變更 API
// ========================================

/**
 * GET /api/system/scheduled-updates
 * 取得預約變更列表
 */
router.get('/scheduled-updates', authenticate, (req, res) => {
  try {
    const { status, patientId } = req.query
    const db = getDatabase()

    let query = 'SELECT * FROM scheduled_patient_updates WHERE 1=1'
    const params = []

    if (status) {
      query += ' AND status = ?'
      params.push(status)
    }

    if (patientId) {
      query += ' AND patient_id = ?'
      params.push(patientId)
    }

    query += ' ORDER BY effective_date ASC, created_at DESC'

    const updates = db.prepare(query).all(...params)

    res.json(
      updates.map((u) => ({
        id: u.id,
        patientId: u.patient_id,
        patientName: u.patient_name,
        changeType: u.change_type,
        changeData: JSON.parse(u.change_data || '{}'),
        effectiveDate: u.effective_date,
        status: u.status,
        createdBy: JSON.parse(u.created_by || '{}'),
        createdAt: u.created_at,
        processedAt: u.processed_at,
        errorMessage: u.error_message,
      })),
    )
  } catch (error) {
    console.error('取得預約變更列表錯誤:', error)
    res.status(500).json({
      error: true,
      message: '取得預約變更列表失敗',
    })
  }
})

/**
 * POST /api/system/scheduled-updates
 * 建立預約變更
 */
router.post('/scheduled-updates', ...isContributor, async (req, res) => {
  try {
    const { patientId, patientName, changeType, effectiveDate, notes } = req.body
    // 前端（Angular 預約變更對話框）以 `payload` 傳送變更內容，舊路徑用 `changeData`；兩者皆相容
    const changeData = req.body.changeData ?? req.body.payload

    // 生效日必須在未來：套用 cron 只在生效日凌晨 01:00 跑一次，
    // 生效日填今天/過去的單永遠不會被套用（永久 pending 殭屍）
    if (!effectiveDate || String(effectiveDate) <= getTaipeiTodayString()) {
      return res.status(400).json({
        error: true,
        message: '生效日期必須是明天（含）以後；當天的變更請改用病人編輯的「立即變更」',
      })
    }

    const id = uuidv4()
    const db = getDatabase()

    const createdBy = JSON.stringify({
      id: req.user.id,
      name: req.user.name,
    })

    db.prepare(
      `
      INSERT INTO scheduled_patient_updates (
        id, patient_id, patient_name, change_type, change_data,
        effective_date, notes, status, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `,
    ).run(
      id,
      patientId,
      patientName,
      changeType,
      JSON.stringify(changeData || {}),
      effectiveDate,
      notes || '',
      createdBy,
    )


    await logAudit(
      'SCHEDULED_UPDATE_CREATE',
      req.user.id,
      req.user.name,
      'scheduled_patient_updates',
      id,
      {
        patientId,
        changeType,
        effectiveDate,
      },
    )

    res.status(201).json({
      success: true,
      id,
    })
  } catch (error) {
    console.error('建立預約變更錯誤:', error)
    res.status(500).json({
      error: true,
      message: '建立預約變更失敗',
    })
  }
})

/**
 * PUT /api/system/scheduled-updates/:id
 * 更新預約變更
 */
router.put('/scheduled-updates/:id', ...isEditor, async (req, res) => {
  try {
    const { id } = req.params
    const { effectiveDate, notes } = req.body
    // 前端以 `payload` 傳送變更內容，舊路徑用 `changeData`；兩者皆相容
    const changeData = req.body.changeData ?? req.body.payload

    // 同 POST：生效日必須在未來，否則改出殭屍單
    if (!effectiveDate || String(effectiveDate) <= getTaipeiTodayString()) {
      return res.status(400).json({
        error: true,
        message: '生效日期必須是明天（含）以後；當天的變更請改用病人編輯的「立即變更」',
      })
    }

    const db = getDatabase()

    const result = db
      .prepare(
        `
      UPDATE scheduled_patient_updates
      SET change_data = ?, effective_date = ?, notes = ?
      WHERE id = ? AND status = 'pending'
    `,
      )
      .run(JSON.stringify(changeData || {}), effectiveDate, notes || '', id)


    if (result.changes === 0) {
      return res.status(404).json({
        error: true,
        message: '找不到該預約變更或已被處理',
      })
    }

    await logAudit(
      'SCHEDULED_UPDATE_MODIFY',
      req.user.id,
      req.user.name,
      'scheduled_patient_updates',
      id,
      { changeData, effectiveDate },
    )

    res.json({ success: true, id })
  } catch (error) {
    console.error('更新預約變更錯誤:', error)
    res.status(500).json({
      error: true,
      message: '更新預約變更失敗',
    })
  }
})

/**
 * DELETE /api/system/scheduled-updates/:id
 * 取消預約變更
 */
router.delete('/scheduled-updates/:id', ...isEditor, async (req, res) => {
  try {
    const { id } = req.params
    const db = getDatabase()

    const result = db
      .prepare(
        `
      UPDATE scheduled_patient_updates
      SET status = 'cancelled'
      WHERE id = ? AND status = 'pending'
    `,
      )
      .run(id)


    if (result.changes === 0) {
      return res.status(404).json({
        error: true,
        message: '找不到該預約變更或已被處理',
      })
    }

    await logAudit(
      'SCHEDULED_UPDATE_CANCEL',
      req.user.id,
      req.user.name,
      'scheduled_patient_updates',
      id,
      {},
    )

    res.json({ success: true })
  } catch (error) {
    console.error('取消預約變更錯誤:', error)
    res.status(500).json({
      error: true,
      message: '取消預約變更失敗',
    })
  }
})

// ========================================
// 資料備份 API
// ========================================

/**
 * POST /api/system/backup
 * 手動備份資料庫
 */
router.post('/backup', ...isAdmin, async (req, res) => {
  try {
    const { createBackup } = await import('../utils/backup.js')
    const backupFile = await createBackup('manual')

    await logAudit('DATABASE_BACKUP', req.user.id, req.user.name, 'system', null, {
      backupFile,
      type: 'manual',
    })

    res.json({
      success: true,
      message: '備份完成',
      backupFile,
    })
  } catch (error) {
    console.error('備份錯誤:', error)
    res.status(500).json({
      error: true,
      message: '備份失敗',
    })
  }
})

/**
 * GET /api/system/backups
 * 取得備份列表
 */
router.get('/backups', ...isAdmin, (req, res) => {
  try {
    const db = getDatabase()

    const backups = db
      .prepare(
        `
      SELECT * FROM backup_history ORDER BY created_at DESC LIMIT 50
    `,
      )
      .all()


    res.json(
      backups.map((b) => ({
        id: b.id,
        backupFile: b.backup_file,
        backupType: b.backup_type,
        fileSize: b.file_size,
        createdAt: b.created_at,
      })),
    )
  } catch (error) {
    console.error('取得備份列表錯誤:', error)
    res.status(500).json({
      error: true,
      message: '取得備份列表失敗',
    })
  }
})

/**
 * GET /api/system/patient-census?year=YYYY
 * 年度每月「月底」病人數快照（常規門診/門診/住院/急診），供年度報表「常規門診病人數（月底）」列。
 * 每月取最新一筆快照；當月未結束＝截至最新快照日。source 'cron'=實際快照、'backfill'=倒推估算。
 * 另回 today＝目前即時人數（快照尚未建立的當天可直接看）。
 */
router.get('/patient-census', authenticate, (req, res) => {
  try {
    const year = Number(req.query.year)
    if (!year || year < 2000 || year > 2100) {
      return res.status(400).json({ error: true, message: 'year 需為 4 位數年份' })
    }
    const db = getDatabase()
    res.json({
      year,
      months: getMonthlyCensus(db, year),
      today: { date: getTaipeiTodayString(), ...countCurrentCensus(db) },
    })
  } catch (error) {
    console.error('取得病人數快照錯誤:', error)
    res.status(500).json({ error: true, message: '取得病人數快照失敗' })
  }
})

/**
 * GET /api/system/patient-census-changes?year=YYYY&month=M
 * 某月常規門診人數的異動明細（新增/刪除含日期原因/轉入轉出門診），由 patient_history 整理。
 * 供年度報表點「常規門診人數」格子開啟彈窗。
 */
router.get('/patient-census-changes', authenticate, (req, res) => {
  try {
    const year = Number(req.query.year)
    const month = Number(req.query.month)
    if (!year || year < 2000 || year > 2100) {
      return res.status(400).json({ error: true, message: 'year 需為 4 位數年份' })
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return res.status(400).json({ error: true, message: 'month 需為 1–12' })
    }
    const db = getDatabase()
    res.json(getMonthlyCensusChanges(db, year, month))
  } catch (error) {
    console.error('取得病人數異動明細錯誤:', error)
    res.status(500).json({ error: true, message: '取得病人數異動明細失敗' })
  }
})

export default router
