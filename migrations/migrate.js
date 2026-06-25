/**
 * Firestore 到 SQLite 資料遷移工具
 *
 * 使用方式:
 * 1. 從 Firebase Console 匯出 Firestore 資料 (JSON 格式)
 * 2. 將匯出的 JSON 檔案放到 server/migrations/data/ 目錄
 * 3. 執行: npm run migrate
 */

import { readFileSync, existsSync, mkdirSync, readdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import bcrypt from 'bcryptjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const DATA_DIR = join(__dirname, 'data')
const DB_PATH = join(__dirname, '../data/dialysis.db')

// 確保資料目錄存在
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true })
}

// 確保資料庫目錄存在
const dbDir = dirname(DB_PATH)
if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true })
}

/**
 * 讀取 JSON 檔案
 */
function readJsonFile(filename) {
  const filePath = join(DATA_DIR, filename)
  if (!existsSync(filePath)) {
    console.log(`⚠️  檔案不存在，跳過: ${filename}`)
    return null
  }
  const content = readFileSync(filePath, 'utf-8')
  return JSON.parse(content)
}

/**
 * 遷移使用者資料
 */
function migrateUsers(db) {
  console.log('\n📦 遷移使用者資料...')
  const data = readJsonFile('users.json')
  if (!data) return

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO users (id, username, password_hash, name, title, role, email, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  let count = 0
  for (const [id, user] of Object.entries(data)) {
    // 如果有密碼雜湊就使用，否則設定預設密碼
    const passwordHash = user.passwordHash || bcrypt.hashSync('password123', 10)

    stmt.run(
      id,
      user.username || user.email?.split('@')[0] || id,
      passwordHash,
      user.name || user.displayName || '未命名',
      user.title || '',
      user.role || 'viewer',
      user.email || null,
      user.isActive !== false ? 1 : 0,
      user.createdAt || new Date().toISOString(),
      user.updatedAt || new Date().toISOString()
    )
    count++
  }

  console.log(`   ✅ 已遷移 ${count} 筆使用者資料`)
}

/**
 * 遷移病人資料
 */
function migratePatients(db) {
  console.log('\n📦 遷移病人資料...')
  const data = readJsonFile('patients.json')
  if (!data) return

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO patients (
      id, medical_record_number, name, status, is_deleted, delete_reason,
      dialysis_orders, birth_date, gender, id_number, phone, address,
      emergency_contact, emergency_phone, physician, first_dialysis_date,
      vasc_access, access_creation_date, ward_number, bed_number,
      hospital_info, inpatient_reason, dialysis_reason, notes,
      schedule_rule, last_modified_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  let count = 0
  for (const [id, patient] of Object.entries(data)) {
    stmt.run(
      id,
      patient.medicalRecordNumber || '',
      patient.name || '',
      patient.status || 'opd',
      patient.isDeleted ? 1 : 0,
      patient.deleteReason || null,
      JSON.stringify(patient.dialysisOrders || {}),
      patient.birthDate || null,
      patient.gender || null,
      patient.idNumber || null,
      patient.phone || null,
      patient.address || null,
      patient.emergencyContact || null,
      patient.emergencyPhone || null,
      patient.physician || null,
      patient.firstDialysisDate || null,
      patient.vascAccess || null,
      patient.accessCreationDate || null,
      patient.wardNumber || null,
      patient.bedNumber || null,
      JSON.stringify(patient.hospitalInfo || {}),
      patient.inpatientReason || null,
      patient.dialysisReason || null,
      patient.notes || null,
      JSON.stringify(patient.scheduleRule || {}),
      JSON.stringify(patient.lastModifiedBy || {}),
      patient.createdAt || new Date().toISOString(),
      patient.updatedAt || new Date().toISOString()
    )
    count++
  }

  console.log(`   ✅ 已遷移 ${count} 筆病人資料`)
}

/**
 * 遷移排程資料
 */
function migrateSchedules(db) {
  console.log('\n📦 遷移排程資料...')
  const data = readJsonFile('schedules.json')
  if (!data) return

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO schedules (id, date, schedule, sync_method, last_modified_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)

  let count = 0
  for (const [id, schedule] of Object.entries(data)) {
    stmt.run(
      id,
      schedule.date || id,
      JSON.stringify(schedule.schedule || {}),
      schedule.syncMethod || null,
      JSON.stringify(schedule.lastModifiedBy || {}),
      schedule.createdAt || new Date().toISOString(),
      schedule.updatedAt || new Date().toISOString()
    )
    count++
  }

  console.log(`   ✅ 已遷移 ${count} 筆排程資料`)
}

/**
 * 遷移基礎排班總表
 */
function migrateBaseSchedules(db) {
  console.log('\n📦 遷移基礎排班總表...')
  const data = readJsonFile('base_schedules.json')
  if (!data) return

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO base_schedules (id, schedule, created_at, updated_at)
    VALUES (?, ?, ?, ?)
  `)

  let count = 0
  for (const [id, baseSchedule] of Object.entries(data)) {
    stmt.run(
      id,
      JSON.stringify(baseSchedule.schedule || {}),
      baseSchedule.createdAt || new Date().toISOString(),
      baseSchedule.updatedAt || new Date().toISOString()
    )
    count++
  }

  console.log(`   ✅ 已遷移 ${count} 筆基礎排班資料`)
}

/**
 * 遷移調班申請
 */
function migrateScheduleExceptions(db) {
  console.log('\n📦 遷移調班申請...')
  const data = readJsonFile('schedule_exceptions.json')
  if (!data) return

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO schedule_exceptions (
      id, type, status, patient_id, patient_name,
      from_data, to_data, patient1, patient2,
      start_date, end_date, date, reason, cancel_reason,
      error_message, created_by, cancelled_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  let count = 0
  for (const [id, ex] of Object.entries(data)) {
    stmt.run(
      id,
      ex.type || 'MOVE',
      ex.status || 'pending',
      ex.patientId || null,
      ex.patientName || null,
      JSON.stringify(ex.from || {}),
      JSON.stringify(ex.to || {}),
      JSON.stringify(ex.patient1 || {}),
      JSON.stringify(ex.patient2 || {}),
      ex.startDate || null,
      ex.endDate || null,
      ex.date || null,
      ex.reason || null,
      ex.cancelReason || null,
      ex.errorMessage || null,
      JSON.stringify(ex.createdBy || {}),
      ex.cancelledAt || null,
      ex.createdAt || new Date().toISOString(),
      ex.updatedAt || new Date().toISOString()
    )
    count++
  }

  console.log(`   ✅ 已遷移 ${count} 筆調班申請`)
}

/**
 * 遷移透析醫囑歷史
 */
function migrateDialysisOrdersHistory(db) {
  console.log('\n📦 遷移透析醫囑歷史...')
  const data = readJsonFile('dialysis_orders_history.json')
  if (!data) return

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO dialysis_orders_history (id, patient_id, patient_name, operation_type, orders, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)

  let count = 0
  for (const [id, history] of Object.entries(data)) {
    stmt.run(
      id,
      history.patientId || '',
      history.patientName || '',
      history.operationType || 'CREATE',
      JSON.stringify(history.orders || {}),
      history.createdAt || new Date().toISOString(),
      history.updatedAt || new Date().toISOString()
    )
    count++
  }

  console.log(`   ✅ 已遷移 ${count} 筆醫囑歷史`)
}

/**
 * 遷移備忘錄
 */
function migrateMemos(db) {
  console.log('\n📦 遷移備忘錄...')
  const data = readJsonFile('memos.json')
  if (!data) return

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO memos (id, date, content, author_id, author_name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)

  let count = 0
  for (const [id, memo] of Object.entries(data)) {
    stmt.run(
      id,
      memo.date || '',
      memo.content || '',
      memo.authorId || null,
      memo.authorName || null,
      memo.createdAt || new Date().toISOString(),
      memo.updatedAt || new Date().toISOString()
    )
    count++
  }

  console.log(`   ✅ 已遷移 ${count} 筆備忘錄`)
}

/**
 * 遷移護理職責
 */
function migrateNursingDuties(db) {
  console.log('\n📦 遷移護理職責...')
  const data = readJsonFile('nursing_duties.json')
  if (!data) return

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO nursing_duties (id, duties, created_at, updated_at)
    VALUES (?, ?, ?, ?)
  `)

  let count = 0
  for (const [id, duties] of Object.entries(data)) {
    stmt.run(
      id,
      JSON.stringify(duties),
      duties.createdAt || new Date().toISOString(),
      duties.updatedAt || new Date().toISOString()
    )
    count++
  }

  console.log(`   ✅ 已遷移 ${count} 筆護理職責`)
}

/**
 * 通用遷移函式 - 用於其他簡單的集合
 */
function migrateGenericCollection(db, collectionName, tableName, mapFn) {
  console.log(`\n📦 遷移 ${collectionName}...`)
  const data = readJsonFile(`${collectionName}.json`)
  if (!data) return

  let count = 0
  for (const [id, doc] of Object.entries(data)) {
    const mapped = mapFn(id, doc)
    if (mapped) {
      const { sql, values } = mapped
      try {
        db.prepare(sql).run(...values)
        count++
      } catch (err) {
        console.error(`   ❌ 錯誤遷移 ${id}:`, err.message)
      }
    }
  }

  console.log(`   ✅ 已遷移 ${count} 筆 ${collectionName} 資料`)
}

/**
 * 主遷移程序
 */
async function runMigration() {
  console.log('========================================')
  console.log('  Firestore → SQLite 資料遷移工具')
  console.log('========================================')

  // 列出可用的 JSON 檔案
  const files = readdirSync(DATA_DIR).filter(f => f.endsWith('.json'))
  if (files.length === 0) {
    console.log('\n⚠️  在 migrations/data/ 目錄中找不到 JSON 檔案')
    console.log('   請先從 Firebase Console 匯出資料')
    console.log('\n使用步驟:')
    console.log('1. 前往 Firebase Console > Firestore')
    console.log('2. 使用 Cloud Firestore 匯出功能或手動匯出各集合')
    console.log('3. 將 JSON 檔案放到 server/migrations/data/ 目錄')
    console.log('4. 檔案命名: patients.json, schedules.json, users.json 等')
    process.exit(0)
  }

  console.log('\n📂 找到以下資料檔案:')
  files.forEach(f => console.log(`   - ${f}`))

  // 初始化資料庫
  console.log('\n🔧 初始化 SQLite 資料庫...')

  // 讀取並執行 schema
  const schemaPath = join(__dirname, '../src/db/schema.sql')
  const schema = readFileSync(schemaPath, 'utf-8')

  const db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.exec(schema)

  console.log('   ✅ 資料庫 Schema 已建立')

  // 執行各集合的遷移
  migrateUsers(db)
  migratePatients(db)
  migrateSchedules(db)
  migrateBaseSchedules(db)
  migrateScheduleExceptions(db)
  migrateDialysisOrdersHistory(db)
  migrateMemos(db)
  migrateNursingDuties(db)

  // 其他集合的通用遷移
  migrateGenericCollection(db, 'nurse_assignments', 'nurse_assignments', (id, doc) => ({
    sql: `INSERT OR REPLACE INTO nurse_assignments (id, date, teams, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    values: [id, doc.date || id, JSON.stringify(doc.teams || {}), doc.createdAt || new Date().toISOString(), doc.updatedAt || new Date().toISOString()]
  }))

  migrateGenericCollection(db, 'daily_logs', 'daily_logs', (id, doc) => ({
    sql: `INSERT OR REPLACE INTO daily_logs (id, date, patient_movements, announcements, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    values: [id, doc.date || id, JSON.stringify(doc.patientMovements || []), JSON.stringify(doc.announcements || []), doc.notes || null, doc.createdAt || new Date().toISOString(), doc.updatedAt || new Date().toISOString()]
  }))

  migrateGenericCollection(db, 'tasks', 'tasks', (id, doc) => ({
    sql: `INSERT OR REPLACE INTO tasks (id, title, description, status, priority, assigned_to, created_by, due_date, completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    values: [id, doc.title || '', doc.description || null, doc.status || 'pending', doc.priority || 'normal', doc.assignedTo || null, JSON.stringify(doc.createdBy || {}), doc.dueDate || null, doc.completedAt || null, doc.createdAt || new Date().toISOString(), doc.updatedAt || new Date().toISOString()]
  }))

  // 關閉資料庫
  db.close()

  console.log('\n========================================')
  console.log('  ✅ 資料遷移完成！')
  console.log('========================================')
  console.log(`\n資料庫位置: ${DB_PATH}`)
  console.log('\n下一步:')
  console.log('1. 啟動本地伺服器: cd server && npm start')
  console.log('2. 在瀏覽器開啟: http://localhost:3000')
}

// 執行遷移
runMigration().catch(err => {
  console.error('\n❌ 遷移失敗:', err)
  process.exit(1)
})
