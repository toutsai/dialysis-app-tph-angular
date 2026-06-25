/**
 * Firebase → SQLite 資料轉移腳本
 *
 * 用途：將 Firebase Firestore 資料庫中的所有資料轉移到本地 SQLite 資料庫
 *
 * 使用方式：
 *   1. 確保 serviceAccountKey.json 存在於專案根目錄
 *   2. 執行: node server/scripts/firebase-to-sqlite.js
 *
 * 注意：
 *   - 此腳本會清空現有的 SQLite 資料（除了 users 表）
 *   - 轉移前請先備份現有資料庫
 */

import admin from 'firebase-admin'
import Database from 'better-sqlite3'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync, mkdirSync, readFileSync } from 'fs'
import { v4 as uuidv4 } from 'uuid'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// 路徑設定
const PROJECT_ROOT = join(__dirname, '../..')
const DB_PATH = join(__dirname, '../data/dialysis.db')
const SERVICE_ACCOUNT_PATH = join(PROJECT_ROOT, 'serviceAccountKey.json')

// 顏色輸出
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
}

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`)
}

function logSuccess(message) { log(`✅ ${message}`, 'green') }
function logWarning(message) { log(`⚠️  ${message}`, 'yellow') }
function logError(message) { log(`❌ ${message}`, 'red') }
function logInfo(message) { log(`📋 ${message}`, 'cyan') }
function logDim(message) { log(`   ${message}`, 'dim') }

// ========================================
// Firebase 初始化
// ========================================

function initFirebase() {
  if (!existsSync(SERVICE_ACCOUNT_PATH)) {
    logError(`找不到 Firebase 服務帳戶金鑰檔案: ${SERVICE_ACCOUNT_PATH}`)
    logInfo('請將 serviceAccountKey.json 放置於專案根目錄')
    process.exit(1)
  }

  const serviceAccount = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, 'utf-8'))

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  })

  logSuccess('Firebase 已連接')
  return admin.firestore()
}

// ========================================
// SQLite 初始化
// ========================================

function initSQLite() {
  // 確保資料目錄存在
  const dataDir = dirname(DB_PATH)
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true })
  }

  const db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  logSuccess(`SQLite 資料庫已開啟: ${DB_PATH}`)
  return db
}

// ========================================
// Firestore 時間戳轉換
// ========================================

function convertTimestamp(timestamp) {
  if (!timestamp) return null
  if (timestamp.toDate) {
    return timestamp.toDate().toISOString().replace('T', ' ').substring(0, 19)
  }
  if (timestamp instanceof Date) {
    return timestamp.toISOString().replace('T', ' ').substring(0, 19)
  }
  if (typeof timestamp === 'string') {
    return timestamp
  }
  return null
}

// ========================================
// 集合轉移函式
// ========================================

async function migrateCollection(firestore, db, collectionName, tableName, mapFn) {
  logInfo(`正在轉移 ${collectionName} → ${tableName}...`)

  const snapshot = await firestore.collection(collectionName).get()

  if (snapshot.empty) {
    logDim(`${collectionName} 集合為空，跳過`)
    return 0
  }

  let count = 0
  const errors = []

  for (const doc of snapshot.docs) {
    try {
      const data = doc.data()
      const mapped = mapFn(doc.id, data)

      if (mapped) {
        const columns = Object.keys(mapped)
        const placeholders = columns.map(() => '?').join(', ')
        const values = columns.map(col => mapped[col])

        const sql = `INSERT OR REPLACE INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`
        db.prepare(sql).run(...values)
        count++
      }
    } catch (error) {
      errors.push({ docId: doc.id, error: error.message })
    }
  }

  if (errors.length > 0) {
    logWarning(`${collectionName}: ${count} 筆成功, ${errors.length} 筆失敗`)
    errors.slice(0, 3).forEach(e => logDim(`  - ${e.docId}: ${e.error}`))
  } else {
    logSuccess(`${collectionName}: ${count} 筆資料已轉移`)
  }

  return count
}

// ========================================
// 各集合的映射函式
// ========================================

const mappers = {
  // 病人
  patients: (id, data) => ({
    id,
    medical_record_number: data.medicalRecordNumber || '',
    name: data.name || '',
    status: data.status || 'opd',
    is_deleted: data.isDeleted ? 1 : 0,
    delete_reason: data.deleteReason || null,
    dialysis_orders: JSON.stringify(data.dialysisOrders || {}),
    birth_date: data.birthDate || null,
    gender: data.gender || null,
    id_number: data.idNumber || null,
    phone: data.phone || null,
    address: data.address || null,
    emergency_contact: data.emergencyContact || null,
    emergency_phone: data.emergencyPhone || null,
    physician: data.physician || null,
    first_dialysis_date: data.firstDialysisDate || null,
    vasc_access: data.vascAccess || null,
    access_creation_date: data.accessCreationDate || null,
    ward_number: data.wardNumber || null,
    bed_number: data.bedNumber || null,
    hospital_info: JSON.stringify(data.hospitalInfo || {}),
    inpatient_reason: data.inpatientReason || null,
    dialysis_reason: data.dialysisReason || null,
    notes: data.notes || null,
    patient_category: data.patientCategory || 'opd_regular',
    diseases: JSON.stringify(data.diseases || []),
    patient_status: JSON.stringify(data.patientStatus || {}),
    is_hepatitis: data.isHepatitis ? 1 : 0,
    schedule_rule: JSON.stringify(data.scheduleRule || {}),
    last_modified_by: JSON.stringify(data.lastModifiedBy || {}),
    created_at: convertTimestamp(data.createdAt),
    updated_at: convertTimestamp(data.updatedAt),
  }),

  // 排程
  schedules: (id, data) => ({
    id,
    date: data.date || id,
    schedule: JSON.stringify(data.schedule || {}),
    sync_method: data.syncMethod || null,
    last_modified_by: JSON.stringify(data.lastModifiedBy || {}),
    created_at: convertTimestamp(data.createdAt),
    updated_at: convertTimestamp(data.updatedAt),
  }),

  // 歸檔排程
  archived_schedules: (id, data) => ({
    id,
    date: data.date || id,
    schedule: JSON.stringify(data.schedule || {}),
    last_modified_by: JSON.stringify(data.lastModifiedBy || {}),
    archived_at: convertTimestamp(data.archivedAt),
    archive_method: data.archiveMethod || null,
    patient_count: data.patientCount || 0,
    missing_patient_count: data.missingPatientCount || 0,
    created_at: convertTimestamp(data.createdAt),
    updated_at: convertTimestamp(data.updatedAt),
  }),

  // 基礎排班總表
  base_schedules: (id, data) => ({
    id,
    schedule: JSON.stringify(data.schedule || {}),
    created_at: convertTimestamp(data.createdAt),
    updated_at: convertTimestamp(data.updatedAt),
  }),

  // 排程例外 (調班申請)
  schedule_exceptions: (id, data) => ({
    id,
    type: data.type || 'MOVE',
    status: data.status || 'pending',
    patient_id: data.patientId || null,
    patient_name: data.patientName || null,
    from_data: JSON.stringify(data.fromData || data.from || {}),
    to_data: JSON.stringify(data.toData || data.to || {}),
    patient1: JSON.stringify(data.patient1 || {}),
    patient2: JSON.stringify(data.patient2 || {}),
    start_date: data.startDate || null,
    end_date: data.endDate || null,
    date: data.date || null,
    reason: data.reason || null,
    cancel_reason: data.cancelReason || null,
    error_message: data.errorMessage || null,
    created_by: JSON.stringify(data.createdBy || {}),
    cancelled_at: convertTimestamp(data.cancelledAt),
    created_at: convertTimestamp(data.createdAt),
    updated_at: convertTimestamp(data.updatedAt),
  }),

  // 透析醫囑歷史
  dialysis_orders_history: (id, data) => ({
    id,
    patient_id: data.patientId || '',
    patient_name: data.patientName || null,
    operation_type: data.operationType || 'CREATE',
    orders: JSON.stringify(data.orders || {}),
    created_at: convertTimestamp(data.createdAt),
    updated_at: convertTimestamp(data.updatedAt),
  }),

  // 病人歷史記錄
  patient_history: (id, data) => ({
    id,
    patient_id: data.patientId || '',
    patient_name: data.patientName || null,
    event_type: data.eventType || data.type || 'CREATE',
    event_details: JSON.stringify(data.eventDetails || data.details || {}),
    snapshot: JSON.stringify(data.snapshot || {}),
    timestamp: convertTimestamp(data.timestamp || data.createdAt),
  }),

  // 病情記錄
  condition_records: (id, data) => ({
    id,
    patient_id: data.patientId || '',
    record_date: data.recordDate || convertTimestamp(data.createdAt)?.substring(0, 10) || '',
    content: data.content || null,
    created_by: JSON.stringify(data.createdBy || {}),
    created_at: convertTimestamp(data.createdAt),
    updated_at: convertTimestamp(data.updatedAt),
  }),

  // 護理人員分配
  nurse_assignments: (id, data) => ({
    id,
    date: data.date || id,
    teams: JSON.stringify(data.teams || {}),
    created_at: convertTimestamp(data.createdAt),
    updated_at: convertTimestamp(data.updatedAt),
  }),

  // 護理工作職責
  nursing_duties: (id, data) => ({
    id,
    duties: JSON.stringify(data.duties || data),
    created_at: convertTimestamp(data.createdAt),
    updated_at: convertTimestamp(data.updatedAt),
  }),

  // 護理排班
  nursing_schedules: (id, data) => ({
    id,
    schedule_data: JSON.stringify(data.scheduleData || data),
    created_at: convertTimestamp(data.createdAt),
    updated_at: convertTimestamp(data.updatedAt),
  }),

  // 護理組別配置
  nursing_group_config: (id, data) => ({
    id,
    config: JSON.stringify(data.config || data),
    created_at: convertTimestamp(data.createdAt),
    updated_at: convertTimestamp(data.updatedAt),
  }),

  // 醫師班表
  physician_schedules: (id, data) => ({
    id,
    schedule_data: JSON.stringify(data.scheduleData || data),
    created_at: convertTimestamp(data.createdAt),
    updated_at: convertTimestamp(data.updatedAt),
  }),

  // 備忘錄
  memos: (id, data) => ({
    id,
    date: data.date || '',
    content: data.content || null,
    author_id: data.authorId || data.createdBy?.uid || null,
    author_name: data.authorName || data.createdBy?.name || null,
    created_at: convertTimestamp(data.createdAt),
    updated_at: convertTimestamp(data.updatedAt),
  }),

  // 交班日誌
  handover_logs: (id, data) => ({
    id,
    date: data.date || '',
    shift: data.shift || null,
    content: data.content || null,
    items: JSON.stringify(data.items || []),
    created_by: JSON.stringify(data.createdBy || {}),
    created_at: convertTimestamp(data.createdAt),
    updated_at: convertTimestamp(data.updatedAt),
  }),

  // 每日工作日誌
  daily_logs: (id, data) => ({
    id,
    date: data.date || id,
    patient_movements: JSON.stringify(data.patientMovements || []),
    vascular_access_log: JSON.stringify(data.vascularAccessLog || []),
    announcements: JSON.stringify(data.announcements || []),
    notes: data.notes || null,
    other_notes: data.otherNotes || null,
    stats: JSON.stringify(data.stats || {}),
    leader: JSON.stringify(data.leader || {}),
    created_at: convertTimestamp(data.createdAt),
    updated_at: convertTimestamp(data.updatedAt),
  }),

  // 任務
  tasks: (id, data) => ({
    id,
    title: data.title || null,
    description: data.description || null,
    content: data.content || null,
    status: data.status || 'pending',
    priority: data.priority || 'normal',
    category: data.category || 'task',
    type: data.type || '常規',
    patient_id: data.patientId || null,
    patient_name: data.patientName || null,
    target_date: data.targetDate || null,
    assigned_to: data.assignedTo || null,
    assignee: JSON.stringify(data.assignee || {}),
    creator: JSON.stringify(data.creator || {}),
    created_by: JSON.stringify(data.createdBy || {}),
    resolved_by: JSON.stringify(data.resolvedBy || {}),
    resolved_at: convertTimestamp(data.resolvedAt),
    due_date: data.dueDate || null,
    completed_at: convertTimestamp(data.completedAt),
    created_at: convertTimestamp(data.createdAt),
    updated_at: convertTimestamp(data.updatedAt),
  }),

  // 通知
  notifications: (id, data) => ({
    id,
    type: data.type || '',
    title: data.title || null,
    message: data.message || null,
    recipient_id: data.recipientId || null,
    is_read: data.isRead ? 1 : 0,
    data: JSON.stringify(data.data || data.metadata || {}),
    created_at: convertTimestamp(data.createdAt),
  }),

  // 檢驗報告
  lab_reports: (id, data) => ({
    id,
    patient_id: data.patientId || null,
    report_date: data.reportDate || null,
    report_type: data.reportType || null,
    results: JSON.stringify(data.results || data.data || {}),
    file_path: data.filePath || null,
    uploaded_by: JSON.stringify(data.uploadedBy || {}),
    created_at: convertTimestamp(data.createdAt),
    updated_at: convertTimestamp(data.updatedAt),
  }),

  // 檢驗警示分析
  lab_alert_analyses: (id, data) => ({
    id,
    patient_id: data.patientId || null,
    month_range: data.monthRange || null,
    abnormality_key: data.abnormalityKey || null,
    analysis: data.analysis || null,
    suggestion: data.suggestion || null,
    analysis_data: JSON.stringify(data.analysisData || {}),
    created_at: convertTimestamp(data.createdAt),
    updated_at: convertTimestamp(data.updatedAt),
  }),

  // 藥物訂單
  medication_orders: (id, data) => ({
    id,
    patient_id: data.patientId || null,
    patient_name: data.patientName || null,
    medications: JSON.stringify(data.medications || []),
    status: data.status || 'pending',
    order_date: data.orderDate || null,
    created_by: JSON.stringify(data.createdBy || {}),
    created_at: convertTimestamp(data.createdAt),
    updated_at: convertTimestamp(data.updatedAt),
  }),

  // 藥物草稿
  medication_drafts: (id, data) => ({
    id,
    author_id: data.authorId || '',
    patient_id: data.patientId || null,
    draft_data: JSON.stringify(data.draftData || data),
    created_at: convertTimestamp(data.createdAt),
    updated_at: convertTimestamp(data.updatedAt),
  }),

  // 耗材報告
  consumables_reports: (id, data) => ({
    id,
    report_date: data.reportDate || null,
    report_data: JSON.stringify(data.reportData || data.data || {}),
    created_by: JSON.stringify(data.createdBy || {}),
    created_at: convertTimestamp(data.createdAt),
    updated_at: convertTimestamp(data.updatedAt),
  }),

  // 站點配置
  site_config: (id, data) => ({
    id,
    config_data: JSON.stringify(data.configData || data),
    created_at: convertTimestamp(data.createdAt),
    updated_at: convertTimestamp(data.updatedAt),
  }),

  // KiDit 日誌
  kidit_logbook: (id, data) => ({
    id,
    date: data.date || id,
    log_data: JSON.stringify(data.logData || {}),
    events: JSON.stringify(data.events || []),
    created_at: convertTimestamp(data.createdAt),
    updated_at: convertTimestamp(data.updatedAt),
  }),

  // 排程病人更新
  scheduled_patient_updates: (id, data) => ({
    id,
    patient_id: data.patientId || null,
    patient_name: data.patientName || null,
    change_type: data.changeType || null,
    change_data: JSON.stringify(data.changeData || {}),
    effective_date: data.effectiveDate || null,
    notes: data.notes || null,
    status: data.status || 'pending',
    error_message: data.errorMessage || null,
    created_by: JSON.stringify(data.createdBy || {}),
    created_at: convertTimestamp(data.createdAt),
    processed_at: convertTimestamp(data.processedAt),
  }),
}

// ========================================
// 清空表格（保留 users）
// ========================================

function clearTables(db) {
  logInfo('清空現有資料表...')

  const tablesToClear = [
    'patients',
    'schedules',
    'archived_schedules',
    'base_schedules',
    'schedule_exceptions',
    'dialysis_orders_history',
    'patient_history',
    'condition_records',
    'nurse_assignments',
    'nursing_duties',
    'nursing_schedules',
    'nursing_group_config',
    'physician_schedules',
    'memos',
    'handover_logs',
    'daily_logs',
    'tasks',
    'notifications',
    'lab_reports',
    'lab_alert_analyses',
    'medication_orders',
    'medication_drafts',
    'consumables_reports',
    'site_config',
    'kidit_logbook',
    'scheduled_patient_updates',
  ]

  for (const table of tablesToClear) {
    try {
      db.exec(`DELETE FROM ${table}`)
      logDim(`已清空 ${table}`)
    } catch (error) {
      // 表格可能不存在，忽略
    }
  }

  logSuccess('資料表已清空（保留 users 表）')
}

// ========================================
// 主執行函式
// ========================================

async function main() {
  console.log('\n')
  log('╔════════════════════════════════════════════════════╗', 'cyan')
  log('║     Firebase → SQLite 資料轉移工具                  ║', 'cyan')
  log('╚════════════════════════════════════════════════════╝', 'cyan')
  console.log('\n')

  // 初始化
  const firestore = initFirebase()
  const db = initSQLite()

  // 確認轉移
  logWarning('此操作將清空現有 SQLite 資料（保留使用者帳號）')
  logInfo('按 Ctrl+C 可取消操作...')
  await new Promise(resolve => setTimeout(resolve, 3000))

  console.log('\n')
  log('========== 開始轉移 ==========', 'cyan')
  console.log('\n')

  // 清空表格
  clearTables(db)
  console.log('\n')

  // 轉移各集合
  const collections = [
    // Firebase 集合名稱 → SQLite 表格名稱
    ['patients', 'patients'],
    ['schedules', 'schedules'],
    ['archived_schedules', 'archived_schedules'],
    ['base_schedules', 'base_schedules'],
    ['schedule_exceptions', 'schedule_exceptions'],
    ['dialysis_orders_history', 'dialysis_orders_history'],
    ['patient_history', 'patient_history'],
    ['condition_records', 'condition_records'],
    ['nurse_assignments', 'nurse_assignments'],
    ['nursing_duties', 'nursing_duties'],
    ['nursing_schedules', 'nursing_schedules'],
    ['nursing_group_config', 'nursing_group_config'],
    ['physician_schedules', 'physician_schedules'],
    ['memos', 'memos'],
    ['handover_logs', 'handover_logs'],
    ['daily_logs', 'daily_logs'],
    ['tasks', 'tasks'],
    ['notifications', 'notifications'],
    ['lab_reports', 'lab_reports'],
    ['lab_alert_analyses', 'lab_alert_analyses'],
    ['medication_orders', 'medication_orders'],
    ['medication_drafts', 'medication_drafts'],
    ['consumables_reports', 'consumables_reports'],
    ['site_config', 'site_config'],
    ['kidit_logbook', 'kidit_logbook'],
    ['scheduled_patient_updates', 'scheduled_patient_updates'],
  ]

  let totalRecords = 0

  for (const [firestoreCollection, sqliteTable] of collections) {
    const mapper = mappers[sqliteTable]
    if (mapper) {
      const count = await migrateCollection(firestore, db, firestoreCollection, sqliteTable, mapper)
      totalRecords += count
    } else {
      logWarning(`找不到 ${sqliteTable} 的映射函式，跳過`)
    }
  }

  // 確保預設資料存在
  db.exec(`INSERT OR IGNORE INTO base_schedules (id, schedule) VALUES ('MASTER_SCHEDULE', '{}')`)
  db.exec(`INSERT OR IGNORE INTO nursing_duties (id, duties) VALUES ('main', '{}')`)

  // 關閉資料庫
  db.close()

  console.log('\n')
  log('========== 轉移完成 ==========', 'cyan')
  console.log('\n')
  logSuccess(`總共轉移 ${totalRecords} 筆資料`)
  logInfo(`資料庫位置: ${DB_PATH}`)
  console.log('\n')

  process.exit(0)
}

// 執行
main().catch(error => {
  logError('轉移失敗:')
  console.error(error)
  process.exit(1)
})
