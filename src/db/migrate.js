// 資料庫遷移腳本 - 用於更新現有資料庫結構
import Database from 'better-sqlite3'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync } from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// 優先使用環境變數 DB_PATH（Electron 打包後會傳入）
const DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/dialysis.db')

/**
 * 檢查表格是否存在某個欄位
 */
function columnExists(db, tableName, columnName) {
  const result = db.prepare(`PRAGMA table_info(${tableName})`).all()
  return result.some((col) => col.name === columnName)
}

/**
 * 安全地加入欄位（如果不存在）
 */
function addColumnIfNotExists(db, tableName, columnName, columnDef) {
  if (!columnExists(db, tableName, columnName)) {
    console.log(`  ➕ 新增欄位: ${tableName}.${columnName}`)
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDef}`)
    return true
  }
  return false
}

/**
 * 執行遷移
 */
export function runMigrations() {
  if (!existsSync(DB_PATH)) {
    console.log('📂 資料庫不存在，跳過遷移')
    return
  }

  console.log('🔄 檢查資料庫結構...')
  const db = new Database(DB_PATH)

  try {
    let migrationsApplied = 0

    // ========================================
    // Tasks 表格遷移
    // ========================================
    const tasksExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'")
      .get()
    if (tasksExists) {
      console.log('📋 檢查 tasks 表格...')

      // 新增缺少的欄位
      if (addColumnIfNotExists(db, 'tasks', 'content', 'TEXT')) migrationsApplied++
      if (addColumnIfNotExists(db, 'tasks', 'category', "TEXT DEFAULT 'task'")) migrationsApplied++
      if (addColumnIfNotExists(db, 'tasks', 'type', "TEXT DEFAULT '常規'")) migrationsApplied++
      if (addColumnIfNotExists(db, 'tasks', 'patient_id', 'TEXT')) migrationsApplied++
      if (addColumnIfNotExists(db, 'tasks', 'patient_name', 'TEXT')) migrationsApplied++
      if (addColumnIfNotExists(db, 'tasks', 'target_date', 'TEXT')) migrationsApplied++
      if (addColumnIfNotExists(db, 'tasks', 'assignee', "TEXT DEFAULT '{}'")) migrationsApplied++
      if (addColumnIfNotExists(db, 'tasks', 'creator', "TEXT DEFAULT '{}'")) migrationsApplied++
      if (addColumnIfNotExists(db, 'tasks', 'created_by', "TEXT DEFAULT '{}'")) migrationsApplied++
      if (addColumnIfNotExists(db, 'tasks', 'resolved_by', "TEXT DEFAULT '{}'")) migrationsApplied++
      if (addColumnIfNotExists(db, 'tasks', 'resolved_at', 'TEXT')) migrationsApplied++
      if (addColumnIfNotExists(db, 'tasks', 'due_date', 'TEXT')) migrationsApplied++
      if (addColumnIfNotExists(db, 'tasks', 'completed_at', 'TEXT')) migrationsApplied++

      // 建立索引（如果不存在）
      db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)')
      db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks(category)')
      db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_patient ON tasks(patient_id)')
    }

    // ========================================
    // Patients 表格遷移
    // ========================================
    const patientsExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='patients'")
      .get()
    if (patientsExists) {
      console.log('📋 檢查 patients 表格...')

      // 新增病人狀態欄位
      if (addColumnIfNotExists(db, 'patients', 'patient_status', "TEXT DEFAULT '{}'"))
        migrationsApplied++
      if (addColumnIfNotExists(db, 'patients', 'is_hepatitis', 'INTEGER DEFAULT 0'))
        migrationsApplied++
      // 新增病人分類與疾病欄位
      if (addColumnIfNotExists(db, 'patients', 'patient_category', "TEXT DEFAULT 'opd_regular'"))
        migrationsApplied++
      if (addColumnIfNotExists(db, 'patients', 'diseases', "TEXT DEFAULT '[]'")) migrationsApplied++
      // 新增原始狀態欄位 (用於軟刪除復原)
      if (addColumnIfNotExists(db, 'patients', 'original_status', 'TEXT')) migrationsApplied++
      // 新增刪除時間欄位
      if (addColumnIfNotExists(db, 'patients', 'deleted_at', 'TEXT')) migrationsApplied++
    }

    // ========================================
    // 其他可能需要遷移的表格
    // ========================================

    // archived_schedules 表格 (用於周排班檢視歷史紀錄)
    const archivedSchedulesExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='archived_schedules'")
      .get()
    if (!archivedSchedulesExists) {
      console.log('📋 建立 archived_schedules 表格...')
      db.exec(`
        CREATE TABLE IF NOT EXISTS archived_schedules (
          id TEXT PRIMARY KEY,
          date TEXT UNIQUE NOT NULL,
          schedule TEXT DEFAULT '{}',
          last_modified_by TEXT DEFAULT '{}',
          archived_at TEXT DEFAULT (datetime('now', 'localtime')),
          archive_method TEXT,
          patient_count INTEGER DEFAULT 0,
          missing_patient_count INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now', 'localtime')),
          updated_at TEXT DEFAULT (datetime('now', 'localtime'))
        )
      `)
      db.exec('CREATE INDEX IF NOT EXISTS idx_archived_schedules_date ON archived_schedules(date)')
      migrationsApplied++
    } else {
      // 為已存在的表添加新欄位
      if (addColumnIfNotExists(db, 'archived_schedules', 'archive_method', 'TEXT'))
        migrationsApplied++
      if (addColumnIfNotExists(db, 'archived_schedules', 'patient_count', 'INTEGER DEFAULT 0'))
        migrationsApplied++
      if (
        addColumnIfNotExists(db, 'archived_schedules', 'missing_patient_count', 'INTEGER DEFAULT 0')
      )
        migrationsApplied++
    }

    // ========================================
    // scheduled_patient_updates 表格遷移
    // ========================================
    const scheduledUpdatesExists = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='scheduled_patient_updates'",
      )
      .get()
    if (scheduledUpdatesExists) {
      console.log('📋 檢查 scheduled_patient_updates 表格...')
      if (addColumnIfNotExists(db, 'scheduled_patient_updates', 'patient_id', 'TEXT'))
        migrationsApplied++
      if (addColumnIfNotExists(db, 'scheduled_patient_updates', 'patient_name', 'TEXT'))
        migrationsApplied++
      if (addColumnIfNotExists(db, 'scheduled_patient_updates', 'change_type', 'TEXT'))
        migrationsApplied++
      if (addColumnIfNotExists(db, 'scheduled_patient_updates', 'change_data', "TEXT DEFAULT '{}'"))
        migrationsApplied++
      if (addColumnIfNotExists(db, 'scheduled_patient_updates', 'effective_date', 'TEXT'))
        migrationsApplied++
      if (addColumnIfNotExists(db, 'scheduled_patient_updates', 'notes', 'TEXT'))
        migrationsApplied++
      if (addColumnIfNotExists(db, 'scheduled_patient_updates', 'created_by', "TEXT DEFAULT '{}'"))
        migrationsApplied++
      if (addColumnIfNotExists(db, 'scheduled_patient_updates', 'error_message', 'TEXT'))
        migrationsApplied++
    }

    // ========================================
    // kidit_logbook 表格遷移
    // ========================================
    const kiditExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='kidit_logbook'")
      .get()
    if (kiditExists) {
      console.log('📋 檢查 kidit_logbook 表格...')
      if (addColumnIfNotExists(db, 'kidit_logbook', 'events', "TEXT DEFAULT '[]'"))
        migrationsApplied++
    }

    // ========================================
    // education_records 表格遷移
    // ========================================
    const eduRecordsExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='education_records'")
      .get()
    if (eduRecordsExists) {
      console.log('📋 檢查 education_records 表格...')
      // 入院日期：可編輯,儲存於衛教紀錄(預設帶入病人入院/新增日,沒有則手動選取)
      if (addColumnIfNotExists(db, 'education_records', 'admission_date', 'TEXT')) migrationsApplied++
      // 衛教主題輪序佇列(跳過的主題移到最後,每病人一條)
      if (addColumnIfNotExists(db, 'education_records', 'topic_queue', 'TEXT')) migrationsApplied++
    }

    // ========================================
    // daily_logs 表格遷移
    // ========================================
    const dailyLogsExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='daily_logs'")
      .get()
    if (dailyLogsExists) {
      console.log('📋 檢查 daily_logs 表格...')
      if (addColumnIfNotExists(db, 'daily_logs', 'vascular_access_log', "TEXT DEFAULT '[]'"))
        migrationsApplied++
      if (addColumnIfNotExists(db, 'daily_logs', 'stats', "TEXT DEFAULT '{}'")) migrationsApplied++
      if (addColumnIfNotExists(db, 'daily_logs', 'leader', "TEXT DEFAULT '{}'")) migrationsApplied++
      if (addColumnIfNotExists(db, 'daily_logs', 'other_notes', 'TEXT')) migrationsApplied++
    }

    const dailyLogRevisionsExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='daily_log_revisions'")
      .get()
    if (!dailyLogRevisionsExists) {
      console.log('📋 建立 daily_log_revisions 表格...')
      db.exec(`
        CREATE TABLE IF NOT EXISTS daily_log_revisions (
          id TEXT PRIMARY KEY,
          daily_log_id TEXT NOT NULL,
          date TEXT NOT NULL,
          patient_movements TEXT DEFAULT '[]',
          vascular_access_log TEXT DEFAULT '[]',
          announcements TEXT DEFAULT '[]',
          notes TEXT,
          other_notes TEXT,
          stats TEXT DEFAULT '{}',
          leader TEXT DEFAULT '{}',
          revision_reason TEXT,
          created_by TEXT DEFAULT '{}',
          created_at TEXT DEFAULT (datetime('now', 'localtime'))
        )
      `)
      db.exec('CREATE INDEX IF NOT EXISTS idx_daily_log_revisions_date ON daily_log_revisions(date)')
      db.exec('CREATE INDEX IF NOT EXISTS idx_daily_log_revisions_log ON daily_log_revisions(daily_log_id)')
      migrationsApplied++
    } else {
      db.exec('CREATE INDEX IF NOT EXISTS idx_daily_log_revisions_date ON daily_log_revisions(date)')
      db.exec('CREATE INDEX IF NOT EXISTS idx_daily_log_revisions_log ON daily_log_revisions(daily_log_id)')
    }

    // handover_logs 表格
    const handoverLogsExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='handover_logs'")
      .get()
    if (!handoverLogsExists) {
      console.log('📋 建立 handover_logs 表格...')
      db.exec(`
        CREATE TABLE IF NOT EXISTS handover_logs (
          id TEXT PRIMARY KEY,
          date TEXT NOT NULL,
          shift TEXT,
          content TEXT,
          items TEXT DEFAULT '[]',
          created_by TEXT DEFAULT '{}',
          created_at TEXT DEFAULT (datetime('now', 'localtime')),
          updated_at TEXT DEFAULT (datetime('now', 'localtime'))
        )
      `)
      db.exec('CREATE INDEX IF NOT EXISTS idx_handover_date ON handover_logs(date)')
      migrationsApplied++
    }

    // 確保 daily_logs 表格存在
    const dailyLogsTableExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='daily_logs'")
      .get()
    if (!dailyLogsTableExists) {
      console.log('📋 建立 daily_logs 表格...')
      db.exec(`
        CREATE TABLE IF NOT EXISTS daily_logs (
          id TEXT PRIMARY KEY,
          date TEXT UNIQUE NOT NULL,
          patient_movements TEXT DEFAULT '[]',
          announcements TEXT DEFAULT '[]',
          notes TEXT,
          vascular_access_log TEXT DEFAULT '[]',
          stats TEXT DEFAULT '{}',
          leader TEXT DEFAULT '{}',
          other_notes TEXT,
          created_at TEXT DEFAULT (datetime('now', 'localtime')),
          updated_at TEXT DEFAULT (datetime('now', 'localtime'))
        )
      `)
      db.exec('CREATE INDEX IF NOT EXISTS idx_daily_logs_date ON daily_logs(date)')
      migrationsApplied++
    } else {
      // 為已存在的表添加新欄位（處理舊版 schema）
      console.log('📋 檢查 handover_logs 表格...')
      if (addColumnIfNotExists(db, 'handover_logs', 'content', 'TEXT')) migrationsApplied++
      if (addColumnIfNotExists(db, 'handover_logs', 'updated_by', "TEXT DEFAULT '{}'"))
        migrationsApplied++
      if (addColumnIfNotExists(db, 'handover_logs', 'updated_at', 'TEXT')) migrationsApplied++
      if (addColumnIfNotExists(db, 'handover_logs', 'source_date', 'TEXT')) migrationsApplied++
    }

    // 醫師表擴充欄位
    console.log('📋 檢查 physicians 表格...')
    if (addColumnIfNotExists(db, 'physicians', 'staff_id', 'TEXT')) migrationsApplied++
    if (addColumnIfNotExists(db, 'physicians', 'phone', 'TEXT')) migrationsApplied++
    if (addColumnIfNotExists(db, 'physicians', 'clinic_hours', "TEXT DEFAULT '[]'"))
      migrationsApplied++
    if (addColumnIfNotExists(db, 'physicians', 'default_schedules', "TEXT DEFAULT '[]'"))
      migrationsApplied++
    if (
      addColumnIfNotExists(db, 'physicians', 'default_consultation_schedules', "TEXT DEFAULT '[]'")
    )
      migrationsApplied++

    // ========================================
    // Users 表格遷移 (B級資安合規 - 登入失敗鎖定)
    // ========================================
    const usersExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
      .get()
    if (usersExists) {
      console.log('📋 檢查 users 表格 (登入鎖定)...')
      if (addColumnIfNotExists(db, 'users', 'failed_login_count', 'INTEGER DEFAULT 0'))
        migrationsApplied++
      if (addColumnIfNotExists(db, 'users', 'locked_until', 'TEXT DEFAULT NULL'))
        migrationsApplied++
    }

    // ========================================
    // lab_alert_analyses 表格遷移
    // ========================================
    const labAlertAnalysesExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='lab_alert_analyses'")
      .get()
    if (labAlertAnalysesExists) {
      console.log('📋 檢查 lab_alert_analyses 表格...')
      if (addColumnIfNotExists(db, 'lab_alert_analyses', 'month_range', 'TEXT')) migrationsApplied++
      if (addColumnIfNotExists(db, 'lab_alert_analyses', 'abnormality_key', 'TEXT'))
        migrationsApplied++
      if (addColumnIfNotExists(db, 'lab_alert_analyses', 'analysis', 'TEXT')) migrationsApplied++
      if (addColumnIfNotExists(db, 'lab_alert_analyses', 'suggestion', 'TEXT')) migrationsApplied++

      // 建立索引
      db.exec(
        'CREATE INDEX IF NOT EXISTS idx_lab_alert_analyses_patient ON lab_alert_analyses(patient_id)',
      )
      db.exec(
        'CREATE INDEX IF NOT EXISTS idx_lab_alert_analyses_month ON lab_alert_analyses(month_range)',
      )
    }

    // ========================================
    // Inventory 表格遷移
    // ========================================
    const inventoryItemsExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='inventory_items'")
      .get()
    if (inventoryItemsExists) {
       console.log('📋 檢查 inventory_items 表格...')
       if (addColumnIfNotExists(db, 'inventory_items', 'units_per_box', 'INTEGER DEFAULT 1')) migrationsApplied++
       // Angular 庫存品項表單欄位（安全庫存量/院內碼/廠牌/廠商電話）
       if (addColumnIfNotExists(db, 'inventory_items', 'safe_inventory_level', 'INTEGER DEFAULT 0')) migrationsApplied++
       if (addColumnIfNotExists(db, 'inventory_items', 'hospital_code', 'TEXT')) migrationsApplied++
       if (addColumnIfNotExists(db, 'inventory_items', 'brand', 'TEXT')) migrationsApplied++
       if (addColumnIfNotExists(db, 'inventory_items', 'vendor_phone', 'TEXT')) migrationsApplied++
    }

    const inventoryPurchasesExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='inventory_purchases'")
      .get()
    if (inventoryPurchasesExists) {
      console.log('📋 檢查 inventory_purchases 表格...')
      // Angular 進貨表單以「箱數」為單位；updated_at 供編輯紀錄使用
      if (addColumnIfNotExists(db, 'inventory_purchases', 'box_quantity', 'INTEGER')) migrationsApplied++
      if (addColumnIfNotExists(db, 'inventory_purchases', 'updated_at', 'TEXT')) migrationsApplied++
    }

    const bedDashboardDevicesExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='bed_dashboard_devices'")
      .get()
    if (bedDashboardDevicesExists) {
      // PIN 暴力破解防護：失敗次數 + 鎖定時間（比照 users 表）
      if (addColumnIfNotExists(db, 'bed_dashboard_devices', 'failed_login_count', 'INTEGER DEFAULT 0')) migrationsApplied++
      if (addColumnIfNotExists(db, 'bed_dashboard_devices', 'locked_until', 'TEXT DEFAULT NULL')) migrationsApplied++
    }
    if (!bedDashboardDevicesExists) {
      console.log('?? 撱箇? bed_dashboard_devices 銵冽...')
      db.exec(`
        CREATE TABLE IF NOT EXISTS bed_dashboard_devices (
          id TEXT PRIMARY KEY,
          bed_key TEXT UNIQUE NOT NULL,
          display_name TEXT NOT NULL,
          pin_hash TEXT NOT NULL,
          is_active INTEGER DEFAULT 1,
          last_login_at TEXT,
          failed_login_count INTEGER DEFAULT 0,
          locked_until TEXT DEFAULT NULL,
          created_at TEXT DEFAULT (datetime('now', 'localtime')),
          updated_at TEXT DEFAULT (datetime('now', 'localtime'))
        )
      `)
      db.exec('CREATE INDEX IF NOT EXISTS idx_bed_dashboard_devices_bed_key ON bed_dashboard_devices(bed_key)')
      db.exec('CREATE INDEX IF NOT EXISTS idx_bed_dashboard_devices_active ON bed_dashboard_devices(is_active)')
      migrationsApplied++
    }

    // ========================================
    // AKI 關懷名單表格遷移
    // ========================================
    const akiCareExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='aki_care_records'")
      .get()
    if (akiCareExists) {
      console.log('📋 檢查 aki_care_records 表格...')
      if (addColumnIfNotExists(db, 'aki_care_records', 'ckd_history', 'TEXT')) migrationsApplied++
      // 三關懷名單分面向欄位（2026-07-07）
      for (const col of [
        'nephrotoxin_review', 'urine_output', // AKI 名單
        'preesrd_enrolled', 'ckd_education', 'vascular_prep', // CKD 名單
        'followup_appt', 'followup_appt_date', 'followup_lab', 'contact_status', 'closure_status', // 出院名單
      ]) {
        if (addColumnIfNotExists(db, 'aki_care_records', col, 'TEXT')) migrationsApplied++
      }
    }

    // AKI 檢驗散點加 eGFR 欄位（8.1 報表同次抽血 Cr+eGFR，CKD 追蹤用）
    const akiLabExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='aki_lab_results'")
      .get()
    if (akiLabExists) {
      console.log('📋 檢查 aki_lab_results 表格...')
      if (addColumnIfNotExists(db, 'aki_lab_results', 'egfr', 'REAL')) migrationsApplied++
    }

    // ========================================
    // 護理師固定照護病人分配（單一 JSON 文件）
    // ========================================
    const nursePatientCareExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='nurse_patient_care'")
      .get()
    if (!nursePatientCareExists) {
      console.log('📋 建立 nurse_patient_care 表格...')
      db.exec(`
        CREATE TABLE IF NOT EXISTS nurse_patient_care (
          id TEXT PRIMARY KEY DEFAULT 'main',
          assignments TEXT DEFAULT '[]',
          excluded_nurse_ids TEXT DEFAULT '[]',
          updated_by TEXT DEFAULT '{}',
          created_at TEXT DEFAULT (datetime('now', 'localtime')),
          updated_at TEXT DEFAULT (datetime('now', 'localtime'))
        )
      `)
      migrationsApplied++
    } else {
      // 排除護理師名單欄位（2026-07-13）
      if (addColumnIfNotExists(db, 'nurse_patient_care', 'excluded_nurse_ids', "TEXT DEFAULT '[]'"))
        migrationsApplied++
    }

    if (migrationsApplied > 0) {
      console.log(`✅ 已完成 ${migrationsApplied} 項遷移`)
    } else {
      console.log('✅ 資料庫結構已是最新')
    }
  } catch (error) {
    console.error('❌ 遷移失敗:', error.message)
    throw error
  } finally {
    db.close()
  }
}

// 如果直接執行此檔案
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
}
