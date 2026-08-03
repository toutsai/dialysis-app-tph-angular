// 醫囑與相關資料路由
import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import XLSX from 'xlsx'
import { getDatabase } from '../db/init.js'
import { authenticate, isContributor, isEditor, logAudit, requireAnyRole } from '../middleware/auth.js'
import { getTaipeiMonthString, getTaipeiTodayString } from '../utils/dateUtils.js'
import { normalizeDialysisMode, normalizeDialysisOrdersMode } from '../utils/dialysisMode.js'
import { FREQ_MAP_TO_DAY_INDEX } from '../utils/scheduleUtils.js'

const router = Router()
const isDoctorRole = isContributor
const isInventoryRole = [authenticate, requireAnyRole('admin', 'viewer')]

// ========================================
// 重端點短 TTL 記憶體快取（檢驗報告 / 藥囑列表）
// 前端 fetchAll 會整表抓取；每次開病人 modal 都重查+序列化 9000+ 筆。
// 30 秒 TTL 讓連續切換病人秒開；上傳後主動清除避免「匯入卻看不到」。
// ========================================
const _listCache = new Map() // key -> { exp, body }
const LIST_TTL = 30000

function cacheGet(key) {
  const e = _listCache.get(key)
  if (e && e.exp > Date.now()) return e.body
  if (e) _listCache.delete(key)
  return null
}
function cacheSet(key, body) {
  _listCache.set(key, { exp: Date.now() + LIST_TTL, body })
}
function invalidateListCache() {
  _listCache.clear()
}

// ========================================
// Excel 檔案處理工具函式
// ========================================

/**
 * 從檔名中解析民國年月，轉換為西元 YYYY-MM 格式
 * 支援格式：
 *   - YYYMM (5位數): 民國年3位 + 月份2位，如 11311 = 2024-11
 *   - YYMM (4位數): 民國年2位 + 月份2位，如 1311 = 2024-11 (假設為 113 年)
 *   - YYYYMM (6位數): 西元年4位 + 月份2位，如 202411 = 2024-11
 *   - YYY + 單一數字 (4位數): 民國年3位 + 月份1位，如 1139 = 2024-09
 *
 * @param {string} fileName - 檔案名稱
 * @returns {string|null} - 西元 YYYY-MM 格式，或 null 表示無法解析
 */
function parseMonthFromFileName(fileName) {
  if (!fileName) return null

  // 移除副檔名
  const nameWithoutExt = fileName.replace(/\.(xlsx?|csv)$/i, '')

  // 尋找檔名中的數字序列 (從後往前找，因為日期通常在檔名結尾)
  const digitMatches = nameWithoutExt.match(/\d+/g)
  if (!digitMatches || digitMatches.length === 0) return null

  // 從後往前嘗試解析
  for (let i = digitMatches.length - 1; i >= 0; i--) {
    const digits = digitMatches[i]

    // 嘗試 5 位數格式: YYYMM (民國年3位 + 月份2位)
    if (digits.length === 5) {
      const rocYear = parseInt(digits.substring(0, 3), 10)
      const month = parseInt(digits.substring(3, 5), 10)
      if (rocYear >= 100 && rocYear <= 150 && month >= 1 && month <= 12) {
        const westernYear = rocYear + 1911
        return `${westernYear}-${String(month).padStart(2, '0')}`
      }
    }

    // 嘗試 4 位數格式 - 情況1: YYMM (民國年2位 + 月份2位)
    if (digits.length === 4) {
      const first2 = parseInt(digits.substring(0, 2), 10)
      const last2 = parseInt(digits.substring(2, 4), 10)

      // 情況1: YYMM - 民國年2位 + 月份2位 (例如 1311 = 113年11月)
      if (first2 >= 10 && first2 <= 15 && last2 >= 1 && last2 <= 12) {
        const rocYear = 100 + first2 // 例如 13 -> 113
        const westernYear = rocYear + 1911
        return `${westernYear}-${String(last2).padStart(2, '0')}`
      }

      // 情況2: YYYM - 民國年3位 + 月份1位 (例如 1139 = 113年9月, 1131 = 113年1月)
      const rocYear3 = parseInt(digits.substring(0, 3), 10)
      const month1 = parseInt(digits.substring(3, 4), 10)
      if (rocYear3 >= 100 && rocYear3 <= 150 && month1 >= 1 && month1 <= 9) {
        const westernYear = rocYear3 + 1911
        return `${westernYear}-${String(month1).padStart(2, '0')}`
      }
    }

    // 嘗試 6 位數格式: YYYYMM (西元年4位 + 月份2位)
    if (digits.length === 6) {
      const year = parseInt(digits.substring(0, 4), 10)
      const month = parseInt(digits.substring(4, 6), 10)
      if (year >= 2020 && year <= 2050 && month >= 1 && month <= 12) {
        return `${year}-${String(month).padStart(2, '0')}`
      }
    }
  }

  return null
}

/**
 * 檢驗報告項目對應表
 */
const LAB_ITEM_MAPPING = {
  白血球: 'WBC',
  紅血球: 'RBC',
  血色素: 'Hb',
  血球容積比: 'Hct',
  平均紅血球容積: 'MCV',
  平均紅血球血紅素量: 'MCH',
  平均紅血球血紅素濃度: 'MCHC',
  血小板: 'Platelet',
  '總膽固醇(血)': 'Cholesterol',
  'BUN(Blood)': 'BUN',
  '三酸甘油酯(血)': 'Triglyceride',
  飯前血糖: 'GlucoseAC',
  'Calcium(Blood)': 'Ca',
  磷: 'P',
  'Uric Acid (B)': 'UricAcid',
  eGFR: 'eGFR',
  '肌酐、血(洗腎專用)': 'Creatinine',
  血中鈉: 'Na',
  血中鉀: 'K',
  總鐵結合能力TIBC: 'TIBC',
  Iron: 'Iron',
  '白蛋白(BCG法)': 'Albumin',
  '總蛋白(血)': 'TotalProtein',
  高密度脂蛋白: 'HDL',
  低密度脂蛋白: 'LDL',
  副甲狀腺素: 'iPTH',
  '血中尿素氮(洗後專用)': 'PostBUN',
  鐵蛋白: 'Ferritin',
  丙胺酸轉胺酶: 'ALT',
  // 病毒標記（質性結果，以字串存；僅供手動補登，無 HIS 中文名）
  HBsAg: 'HBsAg',
  'Anti-HBs': 'AntiHBs',
  'Anti-HCV': 'AntiHCV',
  // 真實 HIS Excel 細項名稱別名（與上方舊 key 並存；修正缺漏比對對不到的問題）
  '尿酸(血)': 'UricAcid',
  '肌酐(血)(洗腎專用)': 'Creatinine',
  平均血球容積: 'MCV',
  紅血球分佈寬度: 'RDW',
  腎絲球過濾率: 'eGFR',
  // 季/半年/年套真實 HIS 名（與舊 key 並存）
  三酸甘油脂: 'Triglyceride',
  膽固醇: 'Cholesterol',
  高密度脂蛋白膽固醇: 'HDL',
  低密度脂蛋白膽固醇: 'LDL',
  完整型副甲狀腺素: 'iPTH',
  總鐵結合能: 'TIBC',
  總蛋白: 'TotalProtein',
  'B型肝炎表面抗原': 'HBsAg',
  'B型肝炎表面抗體': 'AntiHBs',
  'C型肝炎抗體': 'AntiHCV',
}

/**
 * 口服藥物代碼列表
 */
const ORAL_MED_CODES = ['OALK1', 'OCAA', 'OCAL1', 'OFOS4', 'OUCA1', 'OVAF', 'OORK']

/**
 * 針劑藥物代碼列表
 */
const INJECTION_MED_CODES = ['INES2', 'IPAR1', 'ICAC', 'IFER2', 'IREC1']

/**
 * 確保資料表存在
 */
function ensureTablesExist(db) {
  // 確保 injection_orders 表存在 (用於 Excel 匯入的藥囑記錄)
  db.exec(`
    CREATE TABLE IF NOT EXISTS injection_orders (
      id TEXT PRIMARY KEY,
      patient_id TEXT,
      patient_name TEXT,
      medical_record_number TEXT,
      order_code TEXT,
      order_name TEXT,
      change_date TEXT,
      upload_month TEXT,
      dose TEXT,
      frequency TEXT,
      note TEXT,
      action TEXT DEFAULT 'MODIFY',
      order_type TEXT,
      source_file TEXT,
      start_date TEXT,
      end_date TEXT,
      prescriber TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_injection_orders_patient ON injection_orders(patient_id);
    CREATE INDEX IF NOT EXISTS idx_injection_orders_month ON injection_orders(upload_month);
    CREATE INDEX IF NOT EXISTS idx_injection_orders_type ON injection_orders(order_type);
  `)

  // 確保 dialysis_order_uploads 表存在（HIS「備藥前置作業」透析醫囑 Excel 匯入；
  // 全數保留歷次醫囑，同病人+同醫囑日期視為同一筆）
  db.exec(`
    CREATE TABLE IF NOT EXISTS dialysis_order_uploads (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL,
      patient_name TEXT,
      medical_record_number TEXT NOT NULL,
      effective_date TEXT NOT NULL,
      orders TEXT NOT NULL,
      source_file TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime')),
      UNIQUE(medical_record_number, effective_date)
    );
    CREATE INDEX IF NOT EXISTS idx_dialysis_order_uploads_patient ON dialysis_order_uploads(patient_id);
    CREATE INDEX IF NOT EXISTS idx_dialysis_order_uploads_date ON dialysis_order_uploads(effective_date);
  `)

  // 確保 consumables_reports 有 patient_id 欄位
  const tableInfo = db.prepare(`PRAGMA table_info(consumables_reports)`).all()
  const hasPatientId = tableInfo.some((col) => col.name === 'patient_id')
  if (!hasPatientId) {
    db.exec(`
      ALTER TABLE consumables_reports ADD COLUMN patient_id TEXT;
      ALTER TABLE consumables_reports ADD COLUMN patient_name TEXT;
      ALTER TABLE consumables_reports ADD COLUMN medical_record_number TEXT;
      ALTER TABLE consumables_reports ADD COLUMN source_file TEXT;
    `)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_consumables_patient ON consumables_reports(patient_id)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_consumables_date ON consumables_reports(report_date)`)
  }
}

// ========================================
// 透析醫囑歷史 API
// ========================================

/**
 * GET /api/orders/history
 * 取得透析醫囑歷史
 */
router.get('/history', authenticate, (req, res) => {
  try {
    const { patientId, effectiveDateBefore, limit: queryLimit } = req.query
    const db = getDatabase()

    let query = 'SELECT * FROM dialysis_orders_history WHERE 1=1'
    const params = []

    if (patientId) {
      query += ' AND patient_id = ?'
      params.push(patientId)
    }

    // 支援篩選 effectiveDate <= 指定日期
    if (effectiveDateBefore) {
      query += ` AND json_extract(orders, '$.effectiveDate') <= ?`
      params.push(effectiveDateBefore)
    }

    query += ' ORDER BY created_at DESC'

    if (queryLimit) {
      query += ' LIMIT ?'
      params.push(parseInt(queryLimit))
    }

    const history = db.prepare(query).all(...params)

    res.json(
      history.map((h) => ({
        id: h.id,
        patientId: h.patient_id,
        patientName: h.patient_name,
        operationType: h.operation_type,
        orders: JSON.parse(h.orders || '{}'),
        createdAt: h.created_at,
        updatedAt: h.updated_at,
      })),
    )
  } catch (error) {
    console.error('取得醫囑歷史錯誤:', error)
    res.status(500).json({
      error: true,
      message: '取得醫囑歷史失敗',
    })
  }
})

/**
 * POST /api/orders/history/batch
 * 批次取得多位病人的透析醫囑歷史
 * 用於解決 N+1 查詢問題
 */
router.post('/history/batch', authenticate, (req, res) => {
  try {
    const { patientIds, effectiveDateBefore } = req.body

    if (!patientIds || !Array.isArray(patientIds) || patientIds.length === 0) {
      return res.status(400).json({
        error: true,
        message: '請提供病人 ID 陣列',
      })
    }

    // 限制單次查詢數量避免過載
    if (patientIds.length > 100) {
      return res.status(400).json({
        error: true,
        message: '單次查詢最多 100 位病人',
      })
    }

    const db = getDatabase()
    const results = {}

    // 為每位病人取得最新的有效醫囑
    const placeholders = patientIds.map(() => '?').join(',')

    // 使用 window function 取得每位病人最新的一筆醫囑
    let query = `
      SELECT * FROM (
        SELECT *,
          ROW_NUMBER() OVER (PARTITION BY patient_id ORDER BY created_at DESC) as rn
        FROM dialysis_orders_history
        WHERE patient_id IN (${placeholders})
    `
    const params = [...patientIds]

    if (effectiveDateBefore) {
      query += ` AND json_extract(orders, '$.effectiveDate') <= ?`
      params.push(effectiveDateBefore)
    }

    query += `) WHERE rn = 1`

    const history = db.prepare(query).all(...params)

    // 將結果轉換為以 patientId 為 key 的物件
    history.forEach((h) => {
      results[h.patient_id] = {
        id: h.id,
        patientId: h.patient_id,
        patientName: h.patient_name,
        operationType: h.operation_type,
        orders: JSON.parse(h.orders || '{}'),
        createdAt: h.created_at,
        updatedAt: h.updated_at,
      }
    })

    // 對於沒有醫囑的病人，返回空物件
    patientIds.forEach((patientId) => {
      if (!results[patientId]) {
        results[patientId] = null
      }
    })

    res.json(results)
  } catch (error) {
    console.error('批次取得醫囑歷史錯誤:', error)
    res.status(500).json({
      error: true,
      message: '批次取得醫囑歷史失敗',
    })
  }
})

/**
 * POST /api/orders/history
 * 新增透析醫囑記錄
 */
router.post('/history', ...isDoctorRole, async (req, res) => {
  try {
    const { patientId, patientName, operationType, orders } = req.body

    if (!patientId) {
      return res.status(400).json({
        error: true,
        message: '病人 ID 為必填',
      })
    }

    const id = uuidv4()
    const db = getDatabase()

    // 正規化透析模式拼法（統一 SLED / CVVHDF 等），歷史與當前醫囑一致
    const normalizedOrders = normalizeDialysisOrdersMode({ ...(orders || {}) })

    db.prepare(
      `
      INSERT INTO dialysis_orders_history (id, patient_id, patient_name, operation_type, orders)
      VALUES (?, ?, ?, ?, ?)
    `,
    ).run(id, patientId, patientName || '', operationType || 'CREATE', JSON.stringify(normalizedOrders))

    // 同時更新病人的當前醫囑
    db.prepare(
      `
      UPDATE patients
      SET dialysis_orders = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `,
    ).run(JSON.stringify(normalizedOrders), patientId)


    await logAudit(
      'DIALYSIS_ORDER_CREATE',
      req.user.id,
      req.user.name,
      'dialysis_orders_history',
      id,
      {
        patientId,
        patientName,
      },
    )

    res.status(201).json({
      id,
      patientId,
      patientName,
      operationType,
      orders,
    })
  } catch (error) {
    console.error('新增醫囑記錄錯誤:', error)
    res.status(500).json({
      error: true,
      message: '新增醫囑記錄失敗',
    })
  }
})

/**
 * DELETE /api/orders/history/:id
 * 刪除透析醫囑記錄
 */
router.delete('/history/:id', ...isDoctorRole, async (req, res) => {
  try {
    const { id } = req.params
    const db = getDatabase()

    const result = db.prepare(`DELETE FROM dialysis_orders_history WHERE id = ?`).run(id)

    if (result.changes === 0) {
      return res.status(404).json({
        error: true,
        message: '醫囑記錄不存在',
      })
    }

    await logAudit(
      'DIALYSIS_ORDER_DELETE',
      req.user.id,
      req.user.name,
      'dialysis_orders_history',
      id,
      {},
    )

    res.json({
      success: true,
      message: '醫囑記錄已刪除',
    })
  } catch (error) {
    console.error('刪除醫囑記錄錯誤:', error)
    res.status(500).json({
      error: true,
      message: '刪除醫囑記錄失敗',
    })
  }
})

// ========================================
// 藥物訂單 API
// ========================================

/**
 * GET /api/orders/medications
 * 取得藥物訂單列表
 *
 * 注意：實際藥囑歷史寫入 injection_orders 表（藥囑 Excel 上傳，見
 * /medications/upload）；medication_orders 表為 Firebase 遷移後的空殼，
 * 從未被填入內容。前端 lab-med-correlation-view / OrdersView 透過
 * apiManagerService('medication_orders') 走此路徑，且都期望攤平的單筆
 * 藥囑形狀（orderCode/orderType/dose/frequency/note + uploadTimestamp），
 * 因此此 GET 直接服務 injection_orders。
 */
router.get('/medications', authenticate, (req, res) => {
  try {
    const { patientId } = req.query

    const cacheKey = `med:${patientId || ''}`
    const cached = cacheGet(cacheKey)
    if (cached) return res.json(cached)

    const db = getDatabase()

    let query = 'SELECT * FROM injection_orders WHERE 1=1'
    const params = []

    if (patientId) {
      query += ' AND patient_id = ?'
      params.push(patientId)
    }

    query += ' ORDER BY change_date DESC'

    const orders = db.prepare(query).all(...params)

    const body = orders.map((o) => ({
      id: o.id,
      patientId: o.patient_id,
      patientName: o.patient_name,
      medicalRecordNumber: o.medical_record_number,
      orderCode: o.order_code,
      orderName: o.order_name,
      orderType: o.order_type,
      changeDate: o.change_date,
      // 區間模型列（新版含停止日 Excel）以「開始日所屬月」作為月份鍵，
      // 讓沿用 uploadMonth 分月的讀取端（個人查詢、檢驗-用藥對照）維持可用
      uploadMonth: o.start_date ? o.start_date.slice(0, 7) : o.upload_month,
      // 前端以 uploadTimestamp 過濾/排序（無此欄位則整筆被丟棄）
      uploadTimestamp: o.created_at || o.change_date,
      dose: o.dose,
      frequency: o.frequency,
      note: o.note,
      action: o.action,
      sourceFile: o.source_file,
      startDate: o.start_date || '',
      endDate: o.end_date || '',
      prescriber: o.prescriber || '',
      createdAt: o.created_at,
      updatedAt: o.updated_at,
    }))

    cacheSet(cacheKey, body)
    res.json(body)
  } catch (error) {
    console.error('取得藥物訂單錯誤:', error)
    res.status(500).json({
      error: true,
      message: '取得藥物訂單失敗',
    })
  }
})

/**
 * POST /api/orders/medications
 * 新增藥物訂單
 */
router.post('/medications', ...isDoctorRole, async (req, res) => {
  try {
    const { patientId, patientName, medications, orderDate } = req.body

    const id = uuidv4()
    const db = getDatabase()

    db.prepare(
      `
      INSERT INTO medication_orders (id, patient_id, patient_name, medications, order_date, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    ).run(
      id,
      patientId,
      patientName,
      JSON.stringify(medications || []),
      orderDate || getTaipeiTodayString(),
      JSON.stringify({ uid: req.user.id, name: req.user.name }),
    )


    res.status(201).json({
      success: true,
      id,
    })
  } catch (error) {
    console.error('新增藥物訂單錯誤:', error)
    res.status(500).json({
      error: true,
      message: '新增藥物訂單失敗',
    })
  }
})

/**
 * PUT /api/orders/medications/:id
 * 更新藥物訂單
 */
router.put('/medications/:id', ...isDoctorRole, async (req, res) => {
  try {
    const { id } = req.params
    const { medications, status, orderDate } = req.body
    const db = getDatabase()

    const updates = []
    const params = []

    if (medications !== undefined) {
      updates.push('medications = ?')
      params.push(JSON.stringify(medications))
    }

    if (status !== undefined) {
      updates.push('status = ?')
      params.push(status)
    }

    if (orderDate !== undefined) {
      updates.push('order_date = ?')
      params.push(orderDate)
    }

    updates.push("updated_at = datetime('now', 'localtime')")
    params.push(id)

    const query = `UPDATE medication_orders SET ${updates.join(', ')} WHERE id = ?`
    const result = db.prepare(query).run(...params)

    if (result.changes === 0) {
      return res.status(404).json({
        error: true,
        message: '藥物訂單不存在',
      })
    }

    res.json({
      success: true,
      message: '藥物訂單已更新',
    })
  } catch (error) {
    console.error('更新藥物訂單錯誤:', error)
    res.status(500).json({
      error: true,
      message: '更新藥物訂單失敗',
    })
  }
})

/**
 * DELETE /api/orders/medications/:id
 * 刪除藥物訂單
 */
router.delete('/medications/:id', ...isDoctorRole, async (req, res) => {
  try {
    const { id } = req.params
    const db = getDatabase()

    const result = db.prepare(`DELETE FROM medication_orders WHERE id = ?`).run(id)

    if (result.changes === 0) {
      return res.status(404).json({
        error: true,
        message: '藥物訂單不存在',
      })
    }

    res.json({
      success: true,
      message: '藥物訂單已刪除',
    })
  } catch (error) {
    console.error('刪除藥物訂單錯誤:', error)
    res.status(500).json({
      error: true,
      message: '刪除藥物訂單失敗',
    })
  }
})

// ========================================
// 藥物草稿 API
// ========================================

/**
 * GET /api/orders/medication-drafts
 * 取得藥物草稿列表
 */
router.get('/medication-drafts', authenticate, (req, res) => {
  try {
    const { patientId, authorId } = req.query
    const db = getDatabase()

    let query = 'SELECT * FROM medication_drafts WHERE 1=1'
    const params = []

    if (patientId) {
      query += ' AND patient_id = ?'
      params.push(patientId)
    }

    if (authorId) {
      query += ' AND author_id = ?'
      params.push(authorId)
    }

    query += ' ORDER BY created_at DESC'

    const drafts = db.prepare(query).all(...params)

    res.json(
      drafts.map((d) => ({
        id: d.id,
        authorId: d.author_id,
        patientId: d.patient_id,
        ...JSON.parse(d.draft_data || '{}'),
        createdAt: d.created_at,
        updatedAt: d.updated_at,
      })),
    )
  } catch (error) {
    console.error('取得藥物草稿錯誤:', error)
    res.status(500).json({
      error: true,
      message: '取得藥物草稿失敗',
    })
  }
})

/**
 * POST /api/orders/medication-drafts
 * 新增藥物草稿
 */
router.post('/medication-drafts', ...isDoctorRole, async (req, res) => {
  try {
    const draftData = req.body
    const { patientId } = draftData

    if (!patientId) {
      return res.status(400).json({
        error: true,
        message: '病人 ID 為必填',
      })
    }

    const id = uuidv4()
    const db = getDatabase()

    db.prepare(
      `
      INSERT INTO medication_drafts (id, author_id, patient_id, draft_data)
      VALUES (?, ?, ?, ?)
    `,
    ).run(id, req.user.id, patientId, JSON.stringify(draftData))


    res.status(201).json({
      success: true,
      id,
      ...draftData,
    })
  } catch (error) {
    console.error('新增藥物草稿錯誤:', error)
    res.status(500).json({
      error: true,
      message: '新增藥物草稿失敗',
    })
  }
})

/**
 * PUT /api/orders/medication-drafts/:id（前端送 PATCH，由 index.js 全域轉為 PUT）
 * 部分更新藥物草稿（合併進 draft_data JSON，如歸檔時把 status 改為 completed）
 */
router.put('/medication-drafts/:id', ...isDoctorRole, async (req, res) => {
  try {
    const { id } = req.params
    const db = getDatabase()

    const row = db.prepare(`SELECT draft_data FROM medication_drafts WHERE id = ?`).get(id)
    if (!row) {
      return res.status(404).json({
        error: true,
        message: '藥物草稿不存在',
      })
    }

    const merged = { ...JSON.parse(row.draft_data || '{}'), ...req.body }
    db.prepare(
      `UPDATE medication_drafts SET draft_data = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`,
    ).run(JSON.stringify(merged), id)

    res.json({ success: true, id, ...merged })
  } catch (error) {
    console.error('更新藥物草稿錯誤:', error)
    res.status(500).json({
      error: true,
      message: '更新藥物草稿失敗',
    })
  }
})

/**
 * DELETE /api/orders/medication-drafts/:id
 * 刪除藥物草稿
 */
router.delete('/medication-drafts/:id', ...isDoctorRole, async (req, res) => {
  try {
    const { id } = req.params
    const db = getDatabase()

    const result = db.prepare(`DELETE FROM medication_drafts WHERE id = ?`).run(id)

    if (result.changes === 0) {
      return res.status(404).json({
        error: true,
        message: '藥物草稿不存在',
      })
    }

    res.json({
      success: true,
      message: '藥物草稿已刪除',
    })
  } catch (error) {
    console.error('刪除藥物草稿錯誤:', error)
    res.status(500).json({
      error: true,
      message: '刪除藥物草稿失敗',
    })
  }
})

// ========================================
// 檢驗報告 API
// ========================================

/**
 * GET /api/orders/lab-reports
 * 取得檢驗報告列表
 */
router.get('/lab-reports', authenticate, (req, res) => {
  try {
    const { patientId, startDate, endDate } = req.query

    const cacheKey = `lab:${patientId || ''}:${startDate || ''}:${endDate || ''}`
    const cached = cacheGet(cacheKey)
    if (cached) return res.json(cached)

    const db = getDatabase()

    let query = 'SELECT * FROM lab_reports WHERE 1=1'
    const params = []

    if (patientId) {
      query += ' AND patient_id = ?'
      params.push(patientId)
    }

    if (startDate) {
      query += ' AND report_date >= ?'
      params.push(startDate)
    }

    if (endDate) {
      query += ' AND report_date <= ?'
      params.push(endDate)
    }

    query += ' ORDER BY report_date DESC'

    const reports = db.prepare(query).all(...params)

    // 僅回 data（前端只讀 report.data）；移除重複的 results 以砍半 payload
    const body = reports.map((r) => ({
      id: r.id,
      patientId: r.patient_id,
      reportDate: r.report_date,
      reportType: r.report_type,
      data: JSON.parse(r.results || '{}'),
      filePath: r.file_path,
      uploadedBy: JSON.parse(r.uploaded_by || '{}'),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }))

    cacheSet(cacheKey, body)
    res.json(body)
  } catch (error) {
    console.error('取得檢驗報告錯誤:', error)
    res.status(500).json({
      error: true,
      message: '取得檢驗報告失敗',
    })
  }
})

/**
 * POST /api/orders/lab-reports
 * 新增檢驗報告
 */
router.post('/lab-reports', ...isDoctorRole, async (req, res) => {
  try {
    const { patientId, reportDate, reportType, results } = req.body

    const id = uuidv4()
    const db = getDatabase()

    db.prepare(
      `
      INSERT INTO lab_reports (id, patient_id, report_date, report_type, results, uploaded_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    ).run(
      id,
      patientId,
      reportDate,
      reportType,
      JSON.stringify(results || {}),
      JSON.stringify({ uid: req.user.id, name: req.user.name }),
    )


    res.status(201).json({
      success: true,
      id,
    })
  } catch (error) {
    console.error('新增檢驗報告錯誤:', error)
    res.status(500).json({
      error: true,
      message: '新增檢驗報告失敗',
    })
  }
})

// ========================================
// 檢驗警示分析 API
// ========================================

/**
 * GET /api/orders/lab-alert-analyses
 * 取得檢驗警示分析列表
 */
router.get('/lab-alert-analyses', authenticate, (req, res) => {
  try {
    const { patientId, monthRange } = req.query
    const db = getDatabase()

    let query = 'SELECT * FROM lab_alert_analyses WHERE 1=1'
    const params = []

    if (patientId) {
      const ids = String(patientId)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      if (ids.length > 0) {
        query += ` AND patient_id IN (${ids.map(() => '?').join(',')})`
        params.push(...ids)
      }
    }

    if (monthRange) {
      query += ' AND month_range = ?'
      params.push(monthRange)
    }

    query += ' ORDER BY updated_at DESC'

    const analyses = db.prepare(query).all(...params)

    res.json(
      analyses.map((a) => ({
        id: a.id,
        patientId: a.patient_id,
        monthRange: a.month_range,
        abnormalityKey: a.abnormality_key,
        analysis: a.analysis,
        suggestion: a.suggestion,
        updatedAt: a.updated_at,
        createdAt: a.created_at,
      })),
    )
  } catch (error) {
    console.error('取得檢驗警示分析錯誤:', error)
    res.status(500).json({ error: true, message: '取得檢驗警示分析失敗' })
  }
})

/**
 * POST /api/orders/lab-alert-analyses/query
 * 批次查詢檢驗警示分析 (field IN values)，供 queryWithInChunks 使用
 */
router.post('/lab-alert-analyses/query', authenticate, (req, res) => {
  try {
    const { field, values } = req.body || {}
    if (!Array.isArray(values) || values.length === 0) {
      return res.json([])
    }

    const FIELD_MAP = { patientId: 'patient_id', monthRange: 'month_range' }
    const column = FIELD_MAP[field]
    if (!column) {
      return res.status(400).json({
        error: true,
        message: `不支援的查詢欄位: ${field}`,
      })
    }

    const db = getDatabase()
    const placeholders = values.map(() => '?').join(',')
    const analyses = db
      .prepare(
        `SELECT * FROM lab_alert_analyses WHERE ${column} IN (${placeholders}) ORDER BY updated_at DESC`,
      )
      .all(...values)

    res.json(
      analyses.map((a) => ({
        id: a.id,
        patientId: a.patient_id,
        monthRange: a.month_range,
        abnormalityKey: a.abnormality_key,
        analysis: a.analysis,
        suggestion: a.suggestion,
        updatedAt: a.updated_at,
        createdAt: a.created_at,
      })),
    )
  } catch (error) {
    console.error('批次查詢檢驗警示分析錯誤:', error)
    res.status(500).json({ error: true, message: '查詢檢驗警示分析失敗' })
  }
})

/**
 * PUT /api/orders/lab-alert-analyses/:id
 * 新增或更新檢驗警示分析 (upsert)
 */
router.put('/lab-alert-analyses/:id', ...isDoctorRole, async (req, res) => {
  try {
    const { id } = req.params
    const { patientId, monthRange, abnormalityKey, analysis, suggestion } = req.body
    const db = getDatabase()

    // 檢查是否已存在
    const existing = db.prepare('SELECT id FROM lab_alert_analyses WHERE id = ?').get(id)

    if (existing) {
      // 更新
      db.prepare(
        `
        UPDATE lab_alert_analyses
        SET analysis = ?, suggestion = ?, updated_at = datetime('now', 'localtime')
        WHERE id = ?
      `,
      ).run(analysis || '', suggestion || '', id)
    } else {
      // 新增
      db.prepare(
        `
        INSERT INTO lab_alert_analyses (id, patient_id, month_range, abnormality_key, analysis, suggestion)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      ).run(id, patientId, monthRange, abnormalityKey, analysis || '', suggestion || '')
    }

    res.json({ success: true, id })
  } catch (error) {
    console.error('儲存檢驗警示分析錯誤:', error)
    res.status(500).json({ error: true, message: '儲存檢驗警示分析失敗' })
  }
})

// ========================================
// 病情記錄 API
// ========================================

/**
 * GET /api/orders/condition-records
 * 取得病情記錄
 */
router.get('/condition-records', authenticate, (req, res) => {
  try {
    const { patientId, startDate, endDate, limit: queryLimit } = req.query
    const db = getDatabase()

    let query = 'SELECT * FROM condition_records WHERE 1=1'
    const params = []

    if (patientId) {
      query += ' AND patient_id = ?'
      params.push(patientId)
    }

    if (startDate) {
      query += ' AND record_date >= ?'
      params.push(startDate)
    }

    if (endDate) {
      query += ' AND record_date <= ?'
      params.push(endDate)
    }

    query += ' ORDER BY record_date DESC, created_at DESC'

    if (queryLimit) {
      query += ' LIMIT ?'
      params.push(parseInt(queryLimit))
    }

    const records = db.prepare(query).all(...params)

    res.json(
      records.map((r) => {
        const createdBy = JSON.parse(r.created_by || '{}')
        return {
          id: r.id,
          patientId: r.patient_id,
          recordDate: r.record_date,
          content: r.content,
          authorId: createdBy.uid,
          authorName: createdBy.name,
          createdBy: createdBy,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        }
      }),
    )
  } catch (error) {
    console.error('取得病情記錄錯誤:', error)
    res.status(500).json({
      error: true,
      message: '取得病情記錄失敗',
    })
  }
})

/**
 * POST /api/orders/condition-records
 * 新增病情記錄
 */
router.post('/condition-records', ...isContributor, async (req, res) => {
  try {
    const { patientId, recordDate, content } = req.body

    const id = uuidv4()
    const db = getDatabase()

    db.prepare(
      `
      INSERT INTO condition_records (id, patient_id, record_date, content, created_by)
      VALUES (?, ?, ?, ?, ?)
    `,
    ).run(
      id,
      patientId,
      recordDate || getTaipeiTodayString(),
      content,
      JSON.stringify({ uid: req.user.id, name: req.user.name }),
    )


    res.status(201).json({
      success: true,
      id,
    })
  } catch (error) {
    console.error('新增病情記錄錯誤:', error)
    res.status(500).json({
      error: true,
      message: '新增病情記錄失敗',
    })
  }
})

/**
 * PUT /api/orders/condition-records/:id
 * 更新病情記錄
 */
router.put('/condition-records/:id', ...isContributor, async (req, res) => {
  try {
    const { id } = req.params
    const { content, updatedAt } = req.body

    const db = getDatabase()

    const updates = []
    const params = []

    if (content !== undefined) {
      updates.push('content = ?')
      params.push(content)
    }

    updates.push("updated_at = datetime('now', 'localtime')")
    params.push(id)

    const query = `UPDATE condition_records SET ${updates.join(', ')} WHERE id = ?`
    const result = db.prepare(query).run(...params)

    if (result.changes === 0) {
      return res.status(404).json({
        error: true,
        message: '病情記錄不存在',
      })
    }

    res.json({
      success: true,
      message: '病情記錄已更新',
    })
  } catch (error) {
    console.error('更新病情記錄錯誤:', error)
    res.status(500).json({
      error: true,
      message: '更新病情記錄失敗',
    })
  }
})

/**
 * DELETE /api/orders/condition-records/:id
 * 刪除病情記錄
 */
router.delete('/condition-records/:id', ...isEditor, async (req, res) => {
  try {
    const { id } = req.params
    const db = getDatabase()

    const result = db.prepare(`DELETE FROM condition_records WHERE id = ?`).run(id)

    if (result.changes === 0) {
      return res.status(404).json({
        error: true,
        message: '病情記錄不存在',
      })
    }

    res.json({
      success: true,
      message: '病情記錄已刪除',
    })
  } catch (error) {
    console.error('刪除病情記錄錯誤:', error)
    res.status(500).json({
      error: true,
      message: '刪除病情記錄失敗',
    })
  }
})

// ========================================
// Excel 檔案上傳處理 API
// ========================================

/**
 * POST /api/orders/lab-reports/upload
 * 上傳並處理檢驗報告 Excel 檔案
 * 對應 Firebase: processLabReport
 */
router.post('/lab-reports/upload', ...isDoctorRole, async (req, res) => {
  try {
    const { fileName, fileContent } = req.body

    if (!fileName || !fileContent) {
      return res.status(400).json({
        error: true,
        message: '請求中缺少檔案名稱或內容。',
      })
    }

    console.log(`[LabReport] 接收到檔案 ${fileName}，開始解析...`)

    const buffer = Buffer.from(fileContent, 'base64')
    const workbook = XLSX.read(buffer, { type: 'buffer' })
    const sheetName = workbook.SheetNames[0]
    const worksheet = workbook.Sheets[sheetName]
    const sheetAsArray = XLSX.utils.sheet_to_json(worksheet, { header: 1 })

    if (sheetAsArray.length < 2) {
      return res.status(400).json({
        error: true,
        message: 'Excel 檔案內容行數不足。',
      })
    }

    // 尋找標題行
    let headerRowIndex = -1
    let headers = []
    for (let i = 0; i < sheetAsArray.length; i++) {
      const row = sheetAsArray[i]
      if (row.includes('病歷號') && row.includes('細項名稱')) {
        headerRowIndex = i
        headers = row
        break
      }
    }

    if (headerRowIndex === -1) {
      return res.status(400).json({
        error: true,
        message: "找不到有效的標題行 (需包含 '病歷號' 和 '細項名稱')。",
      })
    }

    const dataRows = sheetAsArray.slice(headerRowIndex + 1)
    const headerToIndex = {}
    headers.forEach((header, index) => {
      if (header) headerToIndex[String(header).trim()] = index
    })

    const db = getDatabase()
    const reports = new Map()
    const errors = []
    const patientCache = new Map()

    // 預先載入所有病人
    const allPatients = db
      .prepare(`SELECT id, name, medical_record_number FROM patients WHERE is_deleted = 0`)
      .all()
    console.log(`[LabReport] 載入 ${allPatients.length} 位病人`)

    // 顯示前 5 位病人的病歷號作為參考
    if (allPatients.length > 0) {
      const sampleMrns = allPatients.slice(0, 5).map((p) => p.medical_record_number)
      console.log(`[LabReport] 病歷號範例 (資料庫): ${JSON.stringify(sampleMrns)}`)
    }

    allPatients.forEach((p) => {
      if (p.medical_record_number) {
        const normalizedMrn = String(p.medical_record_number).replace(/^0+/, '')
        patientCache.set(normalizedMrn, p)
        // 同時保存原始病歷號作為備用匹配
        patientCache.set(String(p.medical_record_number), p)
      }
    })

    // 記錄第一筆 Excel 資料的病歷號
    let firstExcelMrn = null

    for (const rowArray of dataRows) {
      let medicalRecordNumber = String(rowArray[headerToIndex['病歷號']] || '').trim()

      // 記錄第一筆非空病歷號
      if (!firstExcelMrn && medicalRecordNumber) {
        firstExcelMrn = medicalRecordNumber
        console.log(`[LabReport] 病歷號範例 (Excel): "${medicalRecordNumber}"`)
      }

      if (medicalRecordNumber) {
        medicalRecordNumber = medicalRecordNumber.replace(/^0+/, '')
      }

      // 標準化日期：只取前 8 位 (YYYYMMDD)
      const originalReportDateStr = String(rowArray[headerToIndex['報告日']] || '').trim()
      const reportDateStr = originalReportDateStr.substring(0, 8)

      const labItemName = String(rowArray[headerToIndex['細項名稱']] || '').trim()
      const labResult = rowArray[headerToIndex['結果']]

      if (
        !medicalRecordNumber ||
        !reportDateStr ||
        !labItemName ||
        labResult === undefined ||
        labResult === null
      ) {
        // 跳過完全空白行
        if (
          rowArray.every(
            (cell) => cell === null || cell === undefined || String(cell).trim() === '',
          )
        )
          continue
        errors.push({
          rowData: JSON.stringify(rowArray),
          reason: '該行缺少 病歷號/報告日/細項名稱/結果',
        })
        continue
      }

      const reportKey = `${medicalRecordNumber}_${reportDateStr}`

      if (!reports.has(reportKey)) {
        const patientData = patientCache.get(medicalRecordNumber)
        if (!patientData) {
          errors.push({ rowData: `病歷號: ${medicalRecordNumber}`, reason: '找不到對應的病人' })
          continue
        }

        // 解析日期
        const year = reportDateStr.substring(0, 4)
        const month = reportDateStr.substring(4, 6)
        const day = reportDateStr.substring(6, 8)
        const reportDate = `${year}-${month}-${day}`

        reports.set(reportKey, {
          id: uuidv4(),
          patientId: patientData.id,
          patientName: patientData.name,
          medicalRecordNumber: patientData.medical_record_number,
          reportDate,
          sourceFile: fileName,
          data: {},
        })
      }

      const report = reports.get(reportKey)
      if (report) {
        const dbField = LAB_ITEM_MAPPING[labItemName]
        if (dbField) {
          const value = parseFloat(labResult)
          report.data[dbField] = isNaN(value) ? String(labResult) : value
        }
      }
    }

    // 批次寫入資料庫
    if (reports.size > 0) {
      const insertStmt = db.prepare(`
        INSERT INTO lab_reports (id, patient_id, report_date, report_type, results, file_path, uploaded_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)

      const insertMany = db.transaction((reportList) => {
        for (const report of reportList) {
          insertStmt.run(
            report.id,
            report.patientId,
            report.reportDate,
            'excel_import',
            JSON.stringify(report.data),
            report.sourceFile,
            JSON.stringify({ uid: req.user.id, name: req.user.name }),
          )
        }
      })

      insertMany(Array.from(reports.values()))
    }

    invalidateListCache() // 匯入後立即清快取，避免「匯入卻看不到」

    await logAudit('LAB_REPORT_UPLOAD', req.user.id, req.user.name, 'lab_reports', fileName, {
      processedCount: reports.size,
      errorCount: errors.length,
    })

    console.log(
      `[LabReport] 處理完成，成功匯入 ${reports.size} 份報告，${errors.length} 個問題行。`,
    )

    res.json({
      success: true,
      message: `處理完成！成功聚合並匯入 ${reports.size} 份報告，發現 ${errors.length} 個問題行。`,
      processedCount: reports.size,
      errorCount: errors.length,
      errors: errors.slice(0, 50),
    })
  } catch (error) {
    console.error('[LabReport] 處理檔案時發生錯誤:', error)
    res.status(500).json({
      error: true,
      message: `處理 Excel 檔案時發生錯誤: ${error.message}`,
    })
  }
})

/**
 * POST /api/orders/consumables/upload
 * 上傳並處理耗材報告 Excel 檔案
 * 對應 Firebase: processConsumables
 */
router.post('/consumables/upload', ...isInventoryRole, async (req, res) => {
  try {
    const { fileName, fileContent } = req.body

    if (!fileName || !fileContent) {
      return res.status(400).json({
        error: true,
        message: '請求中缺少檔案名稱或內容。',
      })
    }

    console.log(`[Consumables] 接收到檔案 ${fileName}，開始解析...`)

    const buffer = Buffer.from(fileContent, 'base64')
    const workbook = XLSX.read(buffer, { type: 'buffer' })
    const sheetName = workbook.SheetNames[0]
    const worksheet = workbook.Sheets[sheetName]
    const sheetAsArray = XLSX.utils.sheet_to_json(worksheet, { header: 1 })

    if (sheetAsArray.length < 3) {
      return res.status(400).json({
        error: true,
        message: 'Excel 檔案內容行數不足。',
      })
    }

    // 從第二列抓取「迄日」來決定報表月份
    const dateString = sheetAsArray[1][0] || ''
    const monthMatch = dateString.match(/&迄日(\d{4})(\d{2})/)

    if (!monthMatch) {
      return res.status(400).json({
        error: true,
        message: 'Excel 格式錯誤，在第二列找不到有效的迄日(需為 &迄日YYYYMM 格式)。',
      })
    }

    const reportMonth = `${monthMatch[1]}-${monthMatch[2]}`
    console.log(`[Consumables] 解析到報表月份為 (迄日): ${reportMonth}`)

    // 尋找標題行
    let headerRowIndex = -1
    for (let i = 0; i < sheetAsArray.length; i++) {
      if (sheetAsArray[i].includes('病歷號')) {
        headerRowIndex = i
        break
      }
    }

    if (headerRowIndex === -1) {
      return res.status(400).json({
        error: true,
        message: "找不到有效的標題行 (需包含 '病歷號')。",
      })
    }

    const headers = sheetAsArray[headerRowIndex]
    const dataRows = sheetAsArray.slice(headerRowIndex + 1)

    // 判斷耗材類型
    let consumableHeader = ''
    let firestoreField = ''
    if (headers.includes('人工腎臟')) {
      consumableHeader = '人工腎臟'
      firestoreField = 'artificialKidney'
    } else if (headers.includes('透析藥水CA')) {
      consumableHeader = '透析藥水CA'
      firestoreField = 'dialysateCa'
    } else if (headers.includes('B液種類')) {
      consumableHeader = 'B液種類'
      firestoreField = 'bicarbonateType'
    } else {
      return res.status(400).json({
        error: true,
        message: '在標題行中找不到關鍵的耗材欄位。',
      })
    }

    const headerToIndex = {}
    headers.forEach((header, index) => {
      if (header) headerToIndex[String(header).trim()] = index
    })

    const db = getDatabase()
    ensureTablesExist(db)

    const patientCache = new Map()
    const updatesMap = new Map()
    const errors = []
    let processedRowCount = 0

    // 預先載入所有病人
    const allPatients = db
      .prepare(`SELECT id, name, medical_record_number FROM patients WHERE is_deleted = 0`)
      .all()
    allPatients.forEach((p) => {
      if (p.medical_record_number) {
        const normalizedMrn = String(p.medical_record_number).replace(/^0+/, '')
        patientCache.set(normalizedMrn, p)
      }
    })

    for (const rowArray of dataRows) {
      let medicalRecordNumber = String(rowArray[headerToIndex['病歷號']] || '').trim()
      const consumableValue = rowArray[headerToIndex[consumableHeader]]
      const count = rowArray[headerToIndex['COUNT(*)']]

      if (!medicalRecordNumber || consumableValue === undefined || consumableValue === null) {
        if (
          rowArray.every(
            (cell) => cell === null || cell === undefined || String(cell).trim() === '',
          )
        )
          continue
        errors.push({ rowData: JSON.stringify(rowArray), reason: '該行缺少病歷號或耗材數值' })
        continue
      }

      medicalRecordNumber = medicalRecordNumber.replace(/^0+/, '')

      const patientData = patientCache.get(medicalRecordNumber)
      if (!patientData) {
        errors.push({ rowData: `病歷號: ${medicalRecordNumber}`, reason: '找不到對應的病人' })
        continue
      }

      const reportId = `${reportMonth}_${patientData.id}`
      if (!updatesMap.has(reportId)) {
        updatesMap.set(reportId, {
          id: reportId,
          patientId: patientData.id,
          patientName: patientData.name,
          medicalRecordNumber: patientData.medical_record_number,
          reportDate: `${reportMonth}-01`,
          sourceFile: fileName,
          data: {},
        })
      }

      const patientUpdate = updatesMap.get(reportId)
      if (!patientUpdate.data[firestoreField]) {
        patientUpdate.data[firestoreField] = []
      }
      patientUpdate.data[firestoreField].push({
        item: consumableValue,
        count: count || 0,
      })

      processedRowCount++
    }

    // 批次寫入資料庫 (使用 UPSERT)
    if (updatesMap.size > 0) {
      const upsertStmt = db.prepare(`
        INSERT INTO consumables_reports (id, patient_id, patient_name, medical_record_number, report_date, report_data, source_file, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          report_data = json_patch(report_data, excluded.report_data),
          source_file = excluded.source_file,
          updated_at = datetime('now', 'localtime')
      `)

      const upsertMany = db.transaction((reportList) => {
        for (const report of reportList) {
          upsertStmt.run(
            report.id,
            report.patientId,
            report.patientName,
            report.medicalRecordNumber,
            report.reportDate,
            JSON.stringify(report.data),
            report.sourceFile,
            JSON.stringify({ uid: req.user.id, name: req.user.name }),
          )
        }
      })

      upsertMany(Array.from(updatesMap.values()))
    }


    await logAudit(
      'CONSUMABLES_UPLOAD',
      req.user.id,
      req.user.name,
      'consumables_reports',
      fileName,
      {
        processedCount: updatesMap.size,
        errorCount: errors.length,
      },
    )

    console.log(
      `[Consumables] 處理完成，處理 ${processedRowCount} 筆資料，聚合為 ${updatesMap.size} 份報表。`,
    )

    res.json({
      success: true,
      message: `處理完成！成功處理 ${processedRowCount} 筆耗材資料，聚合為 ${updatesMap.size} 份月報表，發現 ${errors.length} 個問題行。`,
      processedCount: updatesMap.size,
      errorCount: errors.length,
      errors: errors.slice(0, 50),
    })
  } catch (error) {
    console.error('[Consumables] 處理檔案時發生錯誤:', error)
    res.status(500).json({
      error: true,
      message: `處理 Excel 檔案時發生錯誤: ${error.message}`,
    })
  }
})

/**
 * POST /api/orders/medications/upload
 * 上傳並處理藥囑 Excel 檔案
 * 對應 Firebase: processOrders
 */
router.post('/medications/upload', ...isDoctorRole, async (req, res) => {
  try {
    const { fileName, fileContent } = req.body

    if (!fileName || !fileContent) {
      return res.status(400).json({
        error: true,
        message: '請求中缺少檔案名稱或內容。',
      })
    }

    console.log(`[ProcessOrders] 接收到檔案 ${fileName}，開始解析...`)

    const buffer = Buffer.from(fileContent, 'base64')
    const workbook = XLSX.read(buffer, { type: 'buffer' })
    const sheetName = workbook.SheetNames[0]
    const worksheet = workbook.Sheets[sheetName]
    const dataRows = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: '',
      raw: false,
      dateNF: 'YYYY-MM-DD',
    })

    // 尋找標題行
    let headerRowIndex = -1
    let headers = []
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i].map((h) => String(h).trim())
      if (row.includes('病歷號') && row.includes('醫令碼') && row.includes('名稱')) {
        headerRowIndex = i
        headers = row
        break
      }
    }

    if (headerRowIndex === -1) {
      return res.status(400).json({
        error: true,
        message: "找不到有效的標題行 (需包含 '病歷號', '醫令碼', '名稱')。",
      })
    }

    const headerToIndex = {}
    headers.forEach((header, index) => {
      if (header) headerToIndex[header.trim()] = index
    })

    // 新版「洗腎醫囑(含停止日)」格式：含 開始日/結束日 欄位，結束日空白 = 持續使用。
    // 檔案涵蓋全部歷史處方（非月快照），採整表覆蓋 + 區間查詢模型。
    const isIntervalFormat = headerToIndex['開始日'] !== undefined

    const requiredHeaders = isIntervalFormat
      ? ['病歷號', '醫令碼', '名稱', '次劑量', '開始日']
      : ['病歷號', '醫令碼', '名稱', '異動日期', '次劑量']
    const missingHeaders = requiredHeaders.filter((h) => headerToIndex[h] === undefined)
    if (missingHeaders.length > 0) {
      return res.status(400).json({
        error: true,
        message: `Excel 檔案缺少必要的欄位: ${missingHeaders.join(', ')}`,
      })
    }

    // 日期解析：YYYYMMDD…（取前8碼）或可被 Date 解析的字串 → YYYY-MM-DD；無效回 ''
    const parseExcelDate = (raw) => {
      if (raw === undefined || raw === null) return ''
      const dateStr = String(raw).trim()
      if (!dateStr) return ''
      if (/^\d{8,}/.test(dateStr)) {
        const year = dateStr.substring(0, 4)
        const month = dateStr.substring(4, 6)
        const day = dateStr.substring(6, 8)
        if (parseInt(month) >= 1 && parseInt(month) <= 12 && parseInt(day) >= 1 && parseInt(day) <= 31) {
          return `${year}-${month}-${day}`
        }
      }
      try {
        const dateObj = new Date(dateStr)
        if (!isNaN(dateObj.getTime())) {
          const year = dateObj.getUTCFullYear()
          const month = (dateObj.getUTCMonth() + 1).toString().padStart(2, '0')
          const day = dateObj.getUTCDate().toString().padStart(2, '0')
          return `${year}-${month}-${day}`
        }
      } catch (e) {
        /* 忽略解析錯誤 */
      }
      return ''
    }

    // upload_month 統一使用當前月份，代表「這份 Excel 是哪個月上傳的藥囑單」
    const now = new Date()
    const batchUploadMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    console.log(`[ProcessOrders] 開始處理藥囑資料，整批歸入 upload_month = ${batchUploadMonth}`)


    const db = getDatabase()
    ensureTablesExist(db)

    const patientCache = new Map()
    const errors = []
    let processedCount = 0

    // 預先載入所有病人
    const allPatients = db
      .prepare(`SELECT id, name, medical_record_number FROM patients WHERE is_deleted = 0`)
      .all()
    allPatients.forEach((p) => {
      if (p.medical_record_number) {
        const normalizedMrn = String(p.medical_record_number).replace(/^0+/, '')
        patientCache.set(normalizedMrn, p)
      }
    })

    const ordersToInsert = []

    for (let i = headerRowIndex + 1; i < dataRows.length; i++) {
      const row = dataRows[i]
      if (row.every((cell) => String(cell).trim() === '')) continue

      let medicalRecordNumber = String(row[headerToIndex['病歷號']] || '')
        .trim()
        .replace(/^0+/, '')
      const orderCode = String(row[headerToIndex['醫令碼']] || '').trim()
      const orderName = String(row[headerToIndex['名稱']] || '').trim()
      const changeDate = parseExcelDate(row[headerToIndex['異動日期']])
      const startDate = isIntervalFormat ? parseExcelDate(row[headerToIndex['開始日']]) : ''
      const endDate = isIntervalFormat ? parseExcelDate(row[headerToIndex['結束日']]) : ''

      if (!medicalRecordNumber || !orderCode || !orderName) {
        errors.push({ rowNumber: i + 1, reason: '缺少病歷號/醫令碼/名稱' })
        continue
      }
      if (isIntervalFormat) {
        // 區間格式：開始日必填，異動日期缺漏時以開始日代用
        if (!startDate) {
          errors.push({
            rowNumber: i + 1,
            reason: `開始日格式錯誤或為空，讀取到的值為: "${row[headerToIndex['開始日']]}"`,
          })
          continue
        }
      } else if (!changeDate) {
        errors.push({
          rowNumber: i + 1,
          reason: `異動日期格式錯誤或為空 (應為 YYYY-MM-DD)，讀取到的值為: "${row[headerToIndex['異動日期']]}"`,
        })
        continue
      }

      const patientData = patientCache.get(medicalRecordNumber)
      if (!patientData) {
        errors.push({ rowNumber: i + 1, reason: `病歷號 ${medicalRecordNumber} 找不到對應的病人` })
        continue
      }

      // 判斷藥物類型
      let orderType = null
      // 整批使用同一個上傳月份
      const recordUploadMonth = batchUploadMonth
      const orderPayload = {
        id: uuidv4(),
        patientId: patientData.id,
        patientName: patientData.name,
        medicalRecordNumber: patientData.medical_record_number,
        orderCode,
        orderName,
        changeDate: changeDate || startDate,
        uploadMonth: recordUploadMonth,
        dose: String(row[headerToIndex['次劑量']] || ''),
        action: 'MODIFY',
        sourceFile: fileName,
        startDate,
        endDate,
        prescriber: isIntervalFormat ? String(row[headerToIndex['異動者']] || '').trim() : '',
      }

      if (isIntervalFormat) {
        // 區間格式：所有上傳的藥品都收（使用者需求「有上傳的藥品都呈現」），
        // 分類優先用既有白名單，未知藥碼以字首判斷（I=針劑，其餘視為口服/自備）
        if (INJECTION_MED_CODES.includes(orderCode)) {
          orderType = 'injection'
        } else if (ORAL_MED_CODES.includes(orderCode)) {
          orderType = 'oral'
        } else {
          orderType = orderCode.startsWith('I') ? 'injection' : 'oral'
        }
        orderPayload.frequency = String(row[headerToIndex['頻率服法']] || '').trim()
        orderPayload.note = String(row[headerToIndex['備註']] || '').trim()
      } else if (ORAL_MED_CODES.includes(orderCode)) {
        orderType = 'oral'
        orderPayload.frequency = String(row[headerToIndex['頻率服法']] || '')
      } else if (INJECTION_MED_CODES.includes(orderCode)) {
        orderType = 'injection'
        orderPayload.note = String(row[headerToIndex['備註']] || '')
      }

      if (orderType) {
        orderPayload.orderType = orderType
        ordersToInsert.push(orderPayload)
        processedCount++
      }
    }

    // 批次寫入資料庫
    if (ordersToInsert.length > 0) {
      const insertStmt = db.prepare(`
        INSERT INTO injection_orders (id, patient_id, patient_name, medical_record_number, order_code, order_name, change_date, upload_month, dose, frequency, note, action, order_type, source_file, start_date, end_date, prescriber)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      const insertMany = db.transaction((orders) => {
        if (isIntervalFormat) {
          // 區間格式檔涵蓋全部歷史處方（含起訖日），是權威資料來源：
          // 整表覆蓋，同時淘汰舊「月快照」資料（已被區間資料完整涵蓋）。
          const deleted = db.prepare(`DELETE FROM injection_orders`).run().changes
          console.log(`[ProcessOrders] 區間格式上傳：整表覆蓋，已清除 ${deleted} 筆舊藥囑。`)
        } else {
          // 舊格式：同月重傳採「整月覆蓋」：醫院每月上傳一份全院完整藥囑檔，
          // 故先清掉本次上傳月份的既有資料，避免重複累加。
          const deleted = db
            .prepare(`DELETE FROM injection_orders WHERE upload_month = ?`)
            .run(batchUploadMonth).changes
          if (deleted > 0) {
            console.log(
              `[ProcessOrders] upload_month=${batchUploadMonth} 已有 ${deleted} 筆舊藥囑，整月覆蓋前先清除。`,
            )
          }
        }
        for (const order of orders) {
          insertStmt.run(
            order.id,
            order.patientId,
            order.patientName,
            order.medicalRecordNumber,
            order.orderCode,
            order.orderName,
            order.changeDate,
            order.uploadMonth,
            order.dose,
            order.frequency || '',
            order.note || '',
            order.action,
            order.orderType,
            order.sourceFile,
            order.startDate || '',
            order.endDate || '',
            order.prescriber || '',
          )
        }
      })

      insertMany(ordersToInsert)
    }

    invalidateListCache() // 匯入後立即清快取，避免「匯入卻看不到」

    await logAudit(
      'MEDICATION_ORDERS_UPLOAD',
      req.user.id,
      req.user.name,
      'injection_orders',
      fileName,
      {
        processedCount,
        errorCount: errors.length,
      },
    )

    console.log(
      `[ProcessOrders] 處理完成，成功處理 ${processedCount} 筆藥囑，${errors.length} 個問題。`,
    )

    res.json({
      success: true,
      message: `處理完成！成功匯入 ${processedCount} 筆藥囑紀錄（依各筆異動日期歸類月份），發現 ${errors.length} 個問題行。`,
      processedCount,
      errorCount: errors.length,
      errors: errors.slice(0, 50),
    })
  } catch (error) {
    console.error('[ProcessOrders] 處理檔案時發生錯誤:', error)
    res.status(500).json({
      error: true,
      message: `處理 Excel 檔案時發生錯誤: ${error.message}`,
    })
  }
})

// ========================================
// 透析醫囑 Excel 上傳（HIS「備藥前置作業」）
// ========================================

/**
 * POST /api/orders/dialysis-orders/upload
 * 上傳 HIS「備藥前置作業」Excel。每列 = 一筆透析醫囑（同病人多列 = 歷次醫囑）。
 * 儲存策略：全數保留（歷次可查）；同病人 + 同醫囑日期視為同一筆，重傳更新不重複累積。
 * 回寫策略：每人取醫囑日期最新一筆，合併進 patients.dialysis_orders（只覆蓋 Excel 提供的欄位，
 * 血管通路/針頭/頻率等欄位保留現值）；病人現行醫囑 effectiveDate 較新（月中手動修改過）則跳過；
 * 內容有變動才寫入 dialysis_orders_history。
 */
router.post('/dialysis-orders/upload', ...isDoctorRole, async (req, res) => {
  try {
    const { fileName, fileContent } = req.body
    if (!fileName || !fileContent) {
      return res.status(400).json({ error: true, message: '請求中缺少檔案名稱或內容。' })
    }
    console.log(`[DialysisOrders] 接收到檔案 ${fileName}，開始解析...`)

    const buffer = Buffer.from(fileContent, 'base64')
    const workbook = XLSX.read(buffer, { type: 'buffer' })
    const worksheet = workbook.Sheets[workbook.SheetNames[0]]
    const dataRows = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: '',
      raw: false,
      dateNF: 'YYYY-MM-DD',
    })

    // 尋找標題行
    let headerRowIndex = -1
    let headers = []
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i].map((h) => String(h).trim())
      if (row.includes('病歷號') && row.includes('透析模式') && row.includes('醫囑日期')) {
        headerRowIndex = i
        headers = row
        break
      }
    }
    if (headerRowIndex === -1) {
      return res.status(400).json({
        error: true,
        message: "找不到有效的標題行 (需包含 '病歷號', '透析模式', '醫囑日期')。",
      })
    }
    const col = {}
    headers.forEach((h, idx) => {
      if (h) col[h] = idx
    })

    // 日期解析：YYYYMMDD…（取前8碼）→ YYYY-MM-DD；無效回 ''
    const parseExcelDate = (raw) => {
      if (raw === undefined || raw === null) return ''
      const dateStr = String(raw).trim()
      if (!dateStr) return ''
      if (/^\d{8,}/.test(dateStr)) {
        const year = dateStr.substring(0, 4)
        const month = dateStr.substring(4, 6)
        const day = dateStr.substring(6, 8)
        if (parseInt(month) >= 1 && parseInt(month) <= 12 && parseInt(day) >= 1 && parseInt(day) <= 31) {
          return `${year}-${month}-${day}`
        }
      }
      try {
        const dateObj = new Date(dateStr)
        if (!isNaN(dateObj.getTime())) {
          const year = dateObj.getUTCFullYear()
          const month = (dateObj.getUTCMonth() + 1).toString().padStart(2, '0')
          const day = dateObj.getUTCDate().toString().padStart(2, '0')
          return `${year}-${month}-${day}`
        }
      } catch (e) {
        /* 忽略解析錯誤 */
      }
      return ''
    }

    const db = getDatabase()
    ensureTablesExist(db)

    // 預先載入所有病人（含已刪除：一年份 Excel 涵蓋已離開的病人，其歷次醫囑照存、
    // 復原後可查；但回寫現行醫囑只針對未刪除者）
    const patientCache = new Map()
    const patientsById = new Map()
    db.prepare(`SELECT id, name, medical_record_number, dialysis_orders, is_deleted FROM patients`)
      .all()
      .forEach((p) => {
        patientsById.set(p.id, p)
        if (p.medical_record_number) {
          patientCache.set(String(p.medical_record_number).replace(/^0+/, ''), p)
        }
      })

    const errors = []
    const rowsToUpsert = []
    const touchedPatientIds = new Set()
    let deletedRowCount = 0
    const WEEKDAY_HEADERS = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
    const cellStr = (row, name) => (col[name] !== undefined ? String(row[col[name]] ?? '').trim() : '')

    // 總表頻率（輪替字串生成用）：ak 的 '/' 慣例 = 依透析日序每次一段（勿去重、勿錯序）
    let masterRules = {}
    try {
      const masterDoc = db.prepare(`SELECT schedule FROM base_schedules WHERE id = 'MASTER_SCHEDULE'`).get()
      masterRules = masterDoc ? JSON.parse(masterDoc.schedule || '{}') : {}
    } catch {
      masterRules = {}
    }

    // akWeekly（索引 0=週一…5=週六）+ freq → 輪替字串：
    // 有頻率：取透析日對應值依序串接，全同 → 單值；
    // 無頻率（非常規病人）：取六天非空去重，全同 → 單值，否則依日序串接
    const buildAkRotation = (akWeekly, freq) => {
      const days = FREQ_MAP_TO_DAY_INDEX[freq] || []
      const sessionValues = days.map((d) => akWeekly[d]).filter((v) => v)
      if (sessionValues.length > 0) {
        return new Set(sessionValues).size === 1 ? sessionValues[0] : sessionValues.join('/')
      }
      const uniq = [...new Set(akWeekly.filter((v) => v))]
      return uniq.join('/')
    }

    for (let i = headerRowIndex + 1; i < dataRows.length; i++) {
      const row = dataRows[i]
      if (!row || row.every((cell) => String(cell).trim() === '')) continue
      const rowNumber = i + 1
      const mrnRaw = cellStr(row, '病歷號')
      const mrn = mrnRaw.replace(/^0+/, '')
      const name = cellStr(row, '姓名')
      const effectiveDate = parseExcelDate(cellStr(row, '醫囑日期'))
      if (!mrn) {
        errors.push({ rowNumber, reason: '缺少病歷號' })
        continue
      }
      if (!effectiveDate) {
        errors.push({ rowNumber, reason: `醫囑日期無法解析: ${cellStr(row, '醫囑日期')}` })
        continue
      }
      const patient = patientCache.get(mrn)
      if (!patient) {
        errors.push({ rowNumber, reason: `病歷號 ${mrnRaw}（${name}）系統查無此病人` })
        continue
      }
      if (patient.is_deleted) deletedRowCount++

      // 透析時間：時/分兩欄，滿 60 分進位（DFPP 等無時間的列保留空白）
      const thRaw = parseInt(cellStr(row, '透析時間(時)'), 10)
      const tmRaw = parseInt(cellStr(row, '透析時間(分)'), 10)
      const hasTime = !isNaN(thRaw) || !isNaN(tmRaw)
      const totalMinutes = (isNaN(thRaw) ? 0 : thRaw) * 60 + (isNaN(tmRaw) ? 0 : tmRaw)
      const timeH = Math.floor(totalMinutes / 60)
      const timeM = totalMinutes % 60

      // AK：六天各一欄（akWeekly 為權威）；輪替字串依病人總表頻率換算
      const akWeekly = WEEKDAY_HEADERS.map((h) => cellStr(row, h))
      const akString = buildAkRotation(akWeekly, masterRules[patient.id]?.freq)

      const heparinInitial = cellStr(row, '初劑量')
      const heparinMaintenance = cellStr(row, '維持劑')
      const rinseRaw = cellStr(row, '外循').toUpperCase()

      // ⚠️ 空欄不帶 key：回寫是 { ...current, ...orders } 合併，帶空字串會把病人現值洗掉
      //（例：乾體重/透析時間在不少列是空的）。只有 Excel 有值的欄位才覆蓋。
      const orders = { effectiveDate, importSource: 'HIS_EXCEL' }
      const setIf = (key, val) => {
        if (val !== '' && val !== undefined && val !== null) orders[key] = val
      }
      setIf('mode', cellStr(row, '透析模式'))
      if (hasTime) {
        orders.dialysisTimeHours = String(timeH)
        orders.dialysisTimeMinutes = String(timeM)
        orders.dialysisHours = String(totalMinutes / 60)
        orders.dialysisTimeText = `${timeH}時${timeM}分`
      }
      setIf('dryWeight', cellStr(row, '乾體重'))
      if (rinseRaw === 'Y' || rinseRaw === 'N') orders.heparinRinse = rinseRaw === 'Y' ? '可' : '不可'
      setIf('heparinInitial', heparinInitial)
      setIf('heparinMaintenance', heparinMaintenance)
      if (heparinInitial || heparinMaintenance) {
        orders.heparinLM = `${heparinInitial || '0'}/${heparinMaintenance || '0'}`
      }
      setIf('bloodFlow', cellStr(row, '血液流速'))
      setIf('dialysateFlow', cellStr(row, '透析液流速'))
      setIf('dialysateCa', cellStr(row, '透析藥水CA'))
      if (akString) {
        orders.ak = akString
        orders.artificialKidney = akString
        orders.aks = akString.split('/')
        orders.akWeekly = akWeekly
      }
      normalizeDialysisOrdersMode(orders)

      touchedPatientIds.add(patient.id)
      rowsToUpsert.push({
        patientId: patient.id,
        patientName: patient.name || name,
        mrn: patient.medical_record_number,
        effectiveDate,
        orders,
      })
    }

    // 既有 (病歷號, 醫囑日期) 鍵，用於統計新增/更新
    const existingKeys = new Set(
      db
        .prepare(`SELECT medical_record_number || '|' || effective_date AS k FROM dialysis_order_uploads`)
        .all()
        .map((r) => r.k),
    )
    let insertedCount = 0
    let updatedCount = 0

    const upsert = db.prepare(`
      INSERT INTO dialysis_order_uploads (id, patient_id, patient_name, medical_record_number, effective_date, orders, source_file)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(medical_record_number, effective_date) DO UPDATE SET
        patient_id = excluded.patient_id,
        patient_name = excluded.patient_name,
        orders = excluded.orders,
        source_file = excluded.source_file,
        updated_at = datetime('now', 'localtime')
    `)
    db.transaction(() => {
      for (const r of rowsToUpsert) {
        upsert.run(uuidv4(), r.patientId, r.patientName, r.mrn, r.effectiveDate, JSON.stringify(r.orders), fileName)
        if (existingKeys.has(`${r.mrn}|${r.effectiveDate}`)) updatedCount++
        else insertedCount++
      }
    })()

    // 回寫病人現行醫囑：本次上傳觸及的病人，各取全表最新一筆
    const stableStringify = (obj) =>
      JSON.stringify(
        Object.keys(obj)
          .sort()
          .reduce((acc, k) => {
            acc[k] = obj[k]
            return acc
          }, {}),
      )

    let writtenBackCount = 0
    let skippedNewerCount = 0
    let unchangedCount = 0

    const latestStmt = db.prepare(`
      SELECT patient_id, patient_name, effective_date, orders FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY patient_id ORDER BY effective_date DESC, updated_at DESC) AS rn
        FROM dialysis_order_uploads
      ) WHERE rn = 1
    `)
    const historyInsert = db.prepare(`
      INSERT INTO dialysis_orders_history (id, patient_id, patient_name, operation_type, orders)
      VALUES (?, ?, ?, 'UPDATE', ?)
    `)
    const patientUpdate = db.prepare(`
      UPDATE patients SET dialysis_orders = ?, updated_at = datetime('now', 'localtime') WHERE id = ?
    `)

    db.transaction(() => {
      for (const r of latestStmt.all()) {
        if (!touchedPatientIds.has(r.patient_id)) continue
        const patient = patientsById.get(r.patient_id)
        if (!patient || patient.is_deleted) continue // 已刪除病人只存檔不回寫
        let current = {}
        try {
          current = JSON.parse(patient.dialysis_orders || '{}') || {}
        } catch {
          current = {}
        }
        // 月中手動修改保護：現行醫囑生效日比 Excel 最新一筆晚 → 不覆蓋
        if (current.effectiveDate && String(current.effectiveDate) > r.effective_date) {
          skippedNewerCount++
          continue
        }
        const merged = normalizeDialysisOrdersMode({ ...current, ...JSON.parse(r.orders) })
        if (stableStringify(merged) === stableStringify(current)) {
          unchangedCount++
          continue
        }
        patientUpdate.run(JSON.stringify(merged), r.patient_id)
        historyInsert.run(uuidv4(), r.patient_id, r.patient_name || patient.name || '', JSON.stringify(merged))
        writtenBackCount++
      }
    })()

    invalidateListCache()

    await logAudit('DIALYSIS_ORDERS_UPLOAD', req.user.id, req.user.name, 'dialysis_order_uploads', fileName, {
      processedCount: rowsToUpsert.length,
      insertedCount,
      updatedCount,
      writtenBackCount,
      skippedNewerCount,
      errorCount: errors.length,
    })

    console.log(
      `[DialysisOrders] 處理完成：儲存 ${rowsToUpsert.length} 筆（新增 ${insertedCount}／更新 ${updatedCount}），` +
        `回寫病人醫囑 ${writtenBackCount} 人、無變動 ${unchangedCount} 人、手動較新跳過 ${skippedNewerCount} 人，問題 ${errors.length} 列。`,
    )

    res.json({
      success: true,
      message:
        `處理完成！儲存 ${rowsToUpsert.length} 筆醫囑（新增 ${insertedCount}、更新 ${updatedCount}，其中已刪除病人 ${deletedRowCount} 筆僅存檔）；` +
        `回寫病人現行醫囑 ${writtenBackCount} 人、內容無變動 ${unchangedCount} 人、系統醫囑較新未覆蓋 ${skippedNewerCount} 人；` +
        `${errors.length} 個問題列。`,
      deletedRowCount,
      processedCount: rowsToUpsert.length,
      insertedCount,
      updatedCount,
      writtenBackCount,
      unchangedCount,
      skippedNewerCount,
      errorCount: errors.length,
      errors: errors.slice(0, 50),
    })
  } catch (error) {
    console.error('[DialysisOrders] 處理檔案時發生錯誤:', error)
    res.status(500).json({
      error: true,
      message: `處理 Excel 檔案時發生錯誤: ${error.message}`,
    })
  }
})

/**
 * GET /api/orders/dialysis-orders
 * 透析醫囑檢視：預設每人最新一筆；?patientId= 查單人歷次；?all=true 全部
 */
router.get('/dialysis-orders', authenticate, (req, res) => {
  try {
    const { patientId, all } = req.query
    const db = getDatabase()
    ensureTablesExist(db)

    let rows
    if (patientId) {
      rows = db
        .prepare(`SELECT * FROM dialysis_order_uploads WHERE patient_id = ? ORDER BY effective_date DESC`)
        .all(patientId)
    } else if (all === 'true') {
      rows = db.prepare(`SELECT * FROM dialysis_order_uploads ORDER BY effective_date DESC`).all()
    } else {
      rows = db
        .prepare(
          `SELECT * FROM (
             SELECT *, ROW_NUMBER() OVER (PARTITION BY patient_id ORDER BY effective_date DESC, updated_at DESC) AS rn
             FROM dialysis_order_uploads
           ) WHERE rn = 1
           ORDER BY medical_record_number`,
        )
        .all()
    }

    const counts = new Map(
      db
        .prepare(`SELECT patient_id, COUNT(*) AS c FROM dialysis_order_uploads GROUP BY patient_id`)
        .all()
        .map((r) => [r.patient_id, r.c]),
    )
    // 血管通路不在 HIS Excel 內，由病人現行醫囑帶出（手動維護欄位）
    const patientMetaMap = new Map(
      db.prepare(`SELECT id, is_deleted, dialysis_orders FROM patients`).all().map((p) => {
        let vascAccess = ''
        try {
          vascAccess = (JSON.parse(p.dialysis_orders || '{}') || {}).vascAccess || ''
        } catch {
          vascAccess = ''
        }
        return [p.id, { isDeleted: !!p.is_deleted, vascAccess }]
      }),
    )

    res.json(
      rows.map((r) => {
        let orders = {}
        try {
          orders = JSON.parse(r.orders || '{}')
        } catch {
          orders = {}
        }
        return {
          id: r.id,
          patientId: r.patient_id,
          patientName: r.patient_name,
          medicalRecordNumber: r.medical_record_number,
          effectiveDate: r.effective_date,
          orders,
          sourceFile: r.source_file,
          recordCount: counts.get(r.patient_id) || 1,
          isDeleted: patientMetaMap.get(r.patient_id)?.isDeleted === true,
          vascAccess: patientMetaMap.get(r.patient_id)?.vascAccess || '',
          updatedAt: r.updated_at,
        }
      }),
    )
  } catch (error) {
    console.error('取得透析醫囑列表錯誤:', error)
    res.status(500).json({ error: true, message: '取得透析醫囑列表失敗' })
  }
})

/**
 * GET /api/orders/consumables
 * 取得耗材報告列表
 */
router.get('/consumables', ...isInventoryRole, (req, res) => {
  try {
    const { patientId, startDate, endDate } = req.query
    const db = getDatabase()

    let query = 'SELECT * FROM consumables_reports WHERE 1=1'
    const params = []

    if (patientId) {
      query += ' AND patient_id = ?'
      params.push(patientId)
    }

    if (startDate) {
      query += ' AND report_date >= ?'
      params.push(startDate)
    }

    if (endDate) {
      query += ' AND report_date <= ?'
      params.push(endDate)
    }

    query += ' ORDER BY report_date DESC'

    const reports = db.prepare(query).all(...params)

    res.json(
      reports.map((r) => ({
        id: r.id,
        patientId: r.patient_id,
        patientName: r.patient_name,
        medicalRecordNumber: r.medical_record_number,
        reportDate: r.report_date,
        data: JSON.parse(r.report_data || '{}'),
        sourceFile: r.source_file,
        createdBy: JSON.parse(r.created_by || '{}'),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    )
  } catch (error) {
    console.error('取得耗材報告錯誤:', error)
    res.status(500).json({
      error: true,
      message: '取得耗材報告失敗',
    })
  }
})

/**
 * GET /api/orders/injection-orders
 * 取得藥囑訂單列表 (Excel 匯入的)
 */
router.get('/injection-orders', authenticate, (req, res) => {
  try {
    const { patientId, uploadMonth, effectiveMonth, orderType } = req.query
    const db = getDatabase()
    ensureTablesExist(db)

    let query
    const params = []

    // 區間模型資料存在時（新版含停止日 Excel），月查詢改用起訖日判斷
    const hasIntervalData = !!db
      .prepare(`SELECT 1 FROM injection_orders WHERE start_date IS NOT NULL AND start_date != '' LIMIT 1`)
      .get()

    if (effectiveMonth && hasIntervalData) {
      // 取「該月內任一天有效」的處方：開始日 <= 月底，且（未結束 或 結束日 >= 月初）
      const monthStart = `${effectiveMonth}-01`
      const monthEnd = `${effectiveMonth}-31`
      query = `
        SELECT * FROM injection_orders
        WHERE start_date != '' AND start_date <= ?
          AND (end_date = '' OR end_date IS NULL OR end_date >= ?)
          ${patientId ? 'AND patient_id = ?' : ''}
          ${orderType ? 'AND order_type = ?' : ''}
        ORDER BY start_date DESC, created_at DESC
      `
      params.push(monthEnd, monthStart)
      if (patientId) params.push(patientId)
      if (orderType) params.push(orderType)
    } else if (effectiveMonth) {
      // 舊月快照模型：每位病人取 <= effectiveMonth 的最新上傳月份
      // (跨月時若該月未上傳新藥囑，沿用最近一次的設定)
      query = `
        WITH latest_per_patient AS (
          SELECT patient_id, MAX(upload_month) AS effective_month
          FROM injection_orders
          WHERE upload_month <= ?
            ${patientId ? 'AND patient_id = ?' : ''}
            ${orderType ? 'AND order_type = ?' : ''}
          GROUP BY patient_id
        )
        SELECT io.* FROM injection_orders io
        JOIN latest_per_patient lp
          ON io.patient_id = lp.patient_id
         AND io.upload_month = lp.effective_month
        WHERE 1=1
          ${patientId ? 'AND io.patient_id = ?' : ''}
          ${orderType ? 'AND io.order_type = ?' : ''}
        ORDER BY io.change_date DESC, io.created_at DESC
      `
      params.push(effectiveMonth)
      if (patientId) params.push(patientId)
      if (orderType) params.push(orderType)
      if (patientId) params.push(patientId)
      if (orderType) params.push(orderType)
    } else {
      query = 'SELECT * FROM injection_orders WHERE 1=1'

      if (patientId) {
        query += ' AND patient_id = ?'
        params.push(patientId)
      }

      if (uploadMonth) {
        query += ' AND upload_month = ?'
        params.push(uploadMonth)
      }

      if (orderType) {
        query += ' AND order_type = ?'
        params.push(orderType)
      }

      query += ' ORDER BY change_date DESC, created_at DESC'
    }

    const orders = db.prepare(query).all(...params)

    res.json(
      orders.map((o) => ({
        id: o.id,
        patientId: o.patient_id,
        patientName: o.patient_name,
        medicalRecordNumber: o.medical_record_number,
        orderCode: o.order_code,
        orderName: o.order_name,
        changeDate: o.change_date,
        uploadMonth: o.upload_month,
        dose: o.dose,
        frequency: o.frequency,
        note: o.note,
        action: o.action,
        orderType: o.order_type,
        sourceFile: o.source_file,
        startDate: o.start_date || '',
        endDate: o.end_date || '',
        prescriber: o.prescriber || '',
        createdAt: o.created_at,
      })),
    )
  } catch (error) {
    console.error('取得藥囑訂單錯誤:', error)
    res.status(500).json({
      error: true,
      message: '取得藥囑訂單失敗',
    })
  }
})

// ========================================
// 設備設定 API (Angular 前端使用)
// ========================================

// 儲存形狀：site_config 一列一種設定，config_data 是以 id 為 key 的物件 map
// （bed_settings 的 key = 床位編號如 "38"/"外1"；machine_bicarbonate_config 的 key = uuid）
// API 對外一律呈現為陣列 [{ id, ...entry }]，對齊前端 ApiManager 的集合語意
function readDeviceConfigMap(db, configId) {
  const row = db.prepare(`SELECT config_data FROM site_config WHERE id = ?`).get(configId)
  if (!row) return {}
  let parsed
  try {
    parsed = JSON.parse(row.config_data || '{}')
  } catch {
    return {}
  }
  const map = {}
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (item && typeof item === 'object' && item.id) {
        const { id, ...rest } = item
        map[id] = rest
      }
    }
  } else if (parsed && typeof parsed === 'object') {
    for (const [key, value] of Object.entries(parsed)) {
      if (value && typeof value === 'object') map[key] = value
    }
  }
  return map
}

function writeDeviceConfigMap(db, configId, map) {
  db.prepare(`
    INSERT INTO site_config (id, config_data, updated_at)
    VALUES (?, ?, datetime('now', 'localtime'))
    ON CONFLICT(id) DO UPDATE SET
      config_data = excluded.config_data,
      updated_at = datetime('now', 'localtime')
  `).run(configId, JSON.stringify(map))
}

const deviceConfigList = (map) => Object.entries(map).map(([id, entry]) => ({ id, ...entry }))

/**
 * GET /api/orders/bed-settings
 * 取得全部床位設備設定（陣列，每床一筆）
 */
router.get('/bed-settings', authenticate, (req, res) => {
  try {
    const db = getDatabase()
    res.json(deviceConfigList(readDeviceConfigMap(db, 'bed_settings')))
  } catch (error) {
    console.error('取得床位設備設定錯誤:', error)
    res.status(500).json({ error: true, message: '取得床位設備設定失敗' })
  }
})

/**
 * PUT /api/orders/bed-settings/:id
 * 更新單一床位的設備設定（upsert；:id 為床位編號如 38、外1）
 */
router.put('/bed-settings/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const db = getDatabase()

    const map = readDeviceConfigMap(db, 'bed_settings')
    map[id] = { ...map[id], ...req.body }
    delete map[id].id
    writeDeviceConfigMap(db, 'bed_settings', map)

    res.json({ id, ...map[id] })
  } catch (error) {
    console.error('更新床位設備設定錯誤:', error)
    res.status(500).json({ error: true, message: '更新床位設備設定失敗' })
  }
})

/**
 * PUT /api/orders/bed-settings
 * 整包覆寫床位設備設定（相容既有介面；接受 map 或陣列）
 */
router.put('/bed-settings', authenticate, async (req, res) => {
  try {
    const db = getDatabase()
    const body = req.body
    const map = {}
    if (Array.isArray(body)) {
      for (const item of body) {
        if (item && typeof item === 'object' && item.id) {
          const { id, ...rest } = item
          map[id] = rest
        }
      }
    } else if (body && typeof body === 'object') {
      for (const [key, value] of Object.entries(body)) {
        if (value && typeof value === 'object') map[key] = value
      }
    }
    writeDeviceConfigMap(db, 'bed_settings', map)

    res.json({ success: true, message: '床位設備設定已更新' })
  } catch (error) {
    console.error('更新床位設備設定錯誤:', error)
    res.status(500).json({ error: true, message: '更新床位設備設定失敗' })
  }
})

/**
 * GET /api/orders/machine-bicarbonate-config
 * 取得全部洗腎機 Bicarbonate 設定（陣列，每機型一筆）
 */
router.get('/machine-bicarbonate-config', authenticate, (req, res) => {
  try {
    const db = getDatabase()
    res.json(deviceConfigList(readDeviceConfigMap(db, 'machine_bicarbonate_config')))
  } catch (error) {
    console.error('取得 Bicarbonate 設定錯誤:', error)
    res.status(500).json({ error: true, message: '取得 Bicarbonate 設定失敗' })
  }
})

/**
 * POST /api/orders/machine-bicarbonate-config
 * 新增一筆洗腎機 Bicarbonate 設定
 */
router.post('/machine-bicarbonate-config', authenticate, async (req, res) => {
  try {
    const db = getDatabase()
    const id = uuidv4()

    const map = readDeviceConfigMap(db, 'machine_bicarbonate_config')
    map[id] = { ...req.body }
    delete map[id].id
    writeDeviceConfigMap(db, 'machine_bicarbonate_config', map)

    res.status(201).json({ id, ...map[id] })
  } catch (error) {
    console.error('新增 Bicarbonate 設定錯誤:', error)
    res.status(500).json({ error: true, message: '新增 Bicarbonate 設定失敗' })
  }
})

/**
 * PUT /api/orders/machine-bicarbonate-config/:id（前端送 PATCH，由 index.js 全域轉為 PUT）
 * 更新單筆洗腎機 Bicarbonate 設定
 */
router.put('/machine-bicarbonate-config/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const db = getDatabase()

    const map = readDeviceConfigMap(db, 'machine_bicarbonate_config')
    if (!map[id]) {
      return res.status(404).json({ error: true, message: 'Bicarbonate 設定不存在' })
    }
    map[id] = { ...map[id], ...req.body }
    delete map[id].id
    writeDeviceConfigMap(db, 'machine_bicarbonate_config', map)

    res.json({ id, ...map[id] })
  } catch (error) {
    console.error('更新 Bicarbonate 設定錯誤:', error)
    res.status(500).json({ error: true, message: '更新 Bicarbonate 設定失敗' })
  }
})

/**
 * DELETE /api/orders/machine-bicarbonate-config/:id
 * 刪除單筆洗腎機 Bicarbonate 設定
 */
router.delete('/machine-bicarbonate-config/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const db = getDatabase()

    const map = readDeviceConfigMap(db, 'machine_bicarbonate_config')
    if (!map[id]) {
      return res.status(404).json({ error: true, message: 'Bicarbonate 設定不存在' })
    }
    delete map[id]
    writeDeviceConfigMap(db, 'machine_bicarbonate_config', map)

    res.json({ success: true, message: 'Bicarbonate 設定已刪除' })
  } catch (error) {
    console.error('刪除 Bicarbonate 設定錯誤:', error)
    res.status(500).json({ error: true, message: '刪除 Bicarbonate 設定失敗' })
  }
})

export default router
