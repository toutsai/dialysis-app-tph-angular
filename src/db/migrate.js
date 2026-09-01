// 資料庫遷移腳本 - 用於更新現有資料庫結構
import Database from 'better-sqlite3'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync } from 'fs'
import { parseHepatitisStatus, upgradeHepatitisStatus, syncTagsFromHepatitis } from '../utils/hepatitis.js'

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

      // B/C 肝四態（2026-08-27）：hbsag/antihcv = Y/N/O/F（與 KiDit 病史 33/34 同碼）＋待追蹤日期
      // 回填規則（使用者裁定）：沒勾 HBV/HCV ＝ N；BC肝? ＝ F；HBV/HCV/C肝治癒 ＝ Y。含已刪除病人一併回填
      if (addColumnIfNotExists(db, 'patients', 'hepatitis_status', 'TEXT')) migrationsApplied++
      const hepRows = db.prepare('SELECT id, diseases FROM patients WHERE hepatitis_status IS NULL').all()
      if (hepRows.length > 0) {
        const upd = db.prepare('UPDATE patients SET hepatitis_status = ? WHERE id = ?')
        const tx = db.transaction((rows) => {
          for (const r of rows) {
            let tags = []
            try { tags = JSON.parse(r.diseases || '[]') } catch { tags = [] }
            const pending = tags.includes('BC肝?')
            const status = {
              hbsag: tags.includes('HBV') ? 'Y' : pending ? 'F' : 'N',
              antihcv: tags.includes('HCV') || tags.includes('C肝治癒') ? 'Y' : pending ? 'F' : 'N',
              hbsagFollowDate: '',
              antihcvFollowDate: ''
            }
            upd.run(JSON.stringify(status), r.id)
          }
        })
        tx(hepRows)
        console.log(`📋 回填 ${hepRows.length} 位病人的 B/C 肝四態（hepatitis_status）`)
        migrationsApplied++
      }

      // 血液傳染病四項（2026-08-30）：hepatitis_status 由 B/C 兩項擴為 hbsag/antihcv/hiv/rpr ＋ 各自檢驗日期 *Date
      // （舊 *FollowDate 改名；HIV/RPR 舊標籤有＝Y、無＝N；日期只有原 F 有，Y/N 待組長補填）。
      // diseases 標籤同步重算：BC肝? 停用，改為「HBV待追蹤」等；含已刪除病人。
      // C 肝治癒併入四態（antihcvCured/antihcvCuredDate，由 C肝治癒 標籤補）。以 JSON 內含 "antihcvCured" 鍵判定已升級。
      const infRows = db
        .prepare(`SELECT id, diseases, hepatitis_status FROM patients WHERE hepatitis_status IS NULL OR hepatitis_status NOT LIKE '%"antihcvCured"%'`)
        .all()
      if (infRows.length > 0) {
        const upd = db.prepare('UPDATE patients SET hepatitis_status = ?, diseases = ? WHERE id = ?')
        const tx = db.transaction((rows) => {
          for (const r of rows) {
            let tags = []
            try { tags = JSON.parse(r.diseases || '[]') } catch { tags = [] }
            const status = upgradeHepatitisStatus(parseHepatitisStatus(r.hepatitis_status), tags)
            upd.run(JSON.stringify(status), JSON.stringify(syncTagsFromHepatitis(tags, status)), r.id)
          }
        })
        tx(infRows)
        console.log(`📋 升級 ${infRows.length} 位病人的血液傳染病四項（hepatitis_status：+hiv/rpr、*FollowDate→*Date；標籤重算）`)
        migrationsApplied++
      }

      // 病人基本資料單一權威（2026-08-27）：KiDit 建檔表單／病人清單「基本資料」共用病人層級欄位。
      // Y/N 類欄位存 KiDit 碼字串；kidit_patient_category = KiDit 02 病患類別（00 健保/11 自費），
      // 與既有 patient_category（opd_regular/non_regular）意義不同，勿混用。
      // basic_source = 最後寫入來源（manual/kidit/kidit_backfill/his）；his_synced_at 供未來 HIS 串接。
      for (const [col, def] of [
        ['mobile', 'TEXT'],
        ['postal_code', 'TEXT'],
        ['registered_city', 'TEXT'],
        ['is_foreign', 'TEXT'],
        ['blood_type', 'TEXT'],
        ['marital_status', 'TEXT'],
        ['education', 'TEXT'],
        ['occupation', 'TEXT'],
        ['is_indigenous', 'TEXT'],
        ['is_welfare', 'TEXT'],
        ['kidit_patient_category', 'TEXT'],
        ['contact_relationship', 'TEXT'],
        ['basic_source', "TEXT DEFAULT 'manual'"],
        ['his_synced_at', 'TEXT'],
      ]) {
        if (addColumnIfNotExists(db, 'patients', col, def)) migrationsApplied++
      }
    }

    // ========================================
    // patient_kidit_profile：KiDit 獨有 6 欄（1:1 病人），與 patients 人口學欄位合為病人基本資料權威（2026-08-27）
    // KiDit 事件上的 kidit_profile 保留為申報快照；此表由 PUT /patients/:id/basic-profile 與 KiDit 存檔回寫
    // ========================================
    const patientKiditProfileExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='patient_kidit_profile'")
      .get()
    if (!patientKiditProfileExists) {
      console.log('📋 建立 patient_kidit_profile 表格...')
      db.exec(`
        CREATE TABLE IF NOT EXISTS patient_kidit_profile (
          patient_id TEXT PRIMARY KEY,
          dialysis_code TEXT,
          kidit_status TEXT,
          hospital_start_date TEXT,
          diagnosis_category TEXT,
          diagnosis_subcategory TEXT,
          catastrophic_card_no TEXT,
          updated_by TEXT DEFAULT '{}',
          created_at TEXT DEFAULT (datetime('now', 'localtime')),
          updated_at TEXT DEFAULT (datetime('now', 'localtime'))
        )
      `)
      migrationsApplied++
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
      // 紙本衛教(病人層級)：paper_education=以紙本進行衛教、paper_completed=紙本衛教已完成
      if (addColumnIfNotExists(db, 'education_records', 'paper_education', 'INTEGER DEFAULT 0')) migrationsApplied++
      if (addColumnIfNotExists(db, 'education_records', 'paper_completed', 'INTEGER DEFAULT 0')) migrationsApplied++
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
      // 2026-09-01 叫貨/到貨行事曆：status 'ordered'（已叫貨待到貨）/ 'arrived'（已到貨=入庫）；
      // order_date 叫貨日、expected_date 預計到貨日（YYYY-MM-DD）、batch_id 批次新增的群組；
      // purchase_date 維持「實際到貨(入庫)日」語意，庫存計算只算 arrived。舊資料一律視為 arrived。
      if (addColumnIfNotExists(db, 'inventory_purchases', 'status', "TEXT DEFAULT 'arrived'")) migrationsApplied++
      if (addColumnIfNotExists(db, 'inventory_purchases', 'order_date', 'TEXT')) migrationsApplied++
      if (addColumnIfNotExists(db, 'inventory_purchases', 'expected_date', 'TEXT')) migrationsApplied++
      if (addColumnIfNotExists(db, 'inventory_purchases', 'batch_id', 'TEXT')) migrationsApplied++
      if (addColumnIfNotExists(db, 'inventory_purchases', 'arrived_by', 'TEXT')) migrationsApplied++
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

    // ========================================
    // 藥囑區間模型（2026-07-18）：Excel 改含開始日/結束日
    // ========================================
    const injectionOrdersExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='injection_orders'")
      .get()
    if (injectionOrdersExists) {
      console.log('📋 檢查 injection_orders 表格...')
      if (addColumnIfNotExists(db, 'injection_orders', 'start_date', 'TEXT')) migrationsApplied++
      if (addColumnIfNotExists(db, 'injection_orders', 'end_date', 'TEXT')) migrationsApplied++
      if (addColumnIfNotExists(db, 'injection_orders', 'prescriber', 'TEXT')) migrationsApplied++
    }

    // ========================================
    // 效能批次 2A：notifications/tasks 索引
    // ========================================
    const notificationsExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='notifications'")
      .get()
    if (notificationsExists) {
      console.log('📋 檢查 notifications 索引...')
      db.exec('CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at)')
    }
    if (tasksExists) {
      console.log('📋 檢查 tasks 部分索引...')
      db.exec(
        "CREATE INDEX IF NOT EXISTS idx_tasks_active ON tasks(created_at) WHERE status != 'deleted'",
      )
    }

    // ========================================
    // 排程/護理分組樂觀鎖版本欄位（2026-07-19）
    // 兩人同編排程/護理分組會整包互蓋(last-write-wins)，加 version 欄位供存檔端點做版本檢查。
    // Trigger 設計意圖：只要 UPDATE 語句的 SET 子句包含 schedule/teams 欄位就會觸發（SQLite
    // 「UPDATE OF」語意，不比較新舊值），系統重建路徑（scheduleSync/exceptionHandler/
    // exceptionReconcile 等）因此完全免改程式碼即自動遞增版本。SQLite recursive_triggers
    // 預設關閉，trigger 內的 UPDATE 不會遞迴自我觸發。
    // ========================================
    const schedulesTableExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schedules'")
      .get()
    if (schedulesTableExists) {
      console.log('📋 檢查 schedules 表格 (樂觀鎖版本)...')
      if (addColumnIfNotExists(db, 'schedules', 'version', 'INTEGER NOT NULL DEFAULT 0'))
        migrationsApplied++
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_schedules_version_bump
        AFTER UPDATE OF schedule ON schedules
        BEGIN
          UPDATE schedules SET version = version + 1 WHERE id = NEW.id;
        END
      `)
    }

    const nurseAssignmentsTableExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='nurse_assignments'")
      .get()
    if (nurseAssignmentsTableExists) {
      console.log('📋 檢查 nurse_assignments 表格 (樂觀鎖版本)...')
      if (addColumnIfNotExists(db, 'nurse_assignments', 'version', 'INTEGER NOT NULL DEFAULT 0'))
        migrationsApplied++
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_nurse_assignments_version_bump
        AFTER UPDATE OF teams ON nurse_assignments
        BEGIN
          UPDATE nurse_assignments SET version = version + 1 WHERE id = NEW.id;
        END
      `)
    }

    // ========================================
    // 血管通路事件（2026-07-21）：主護填寫→組長確認→KiDit造管申報
    // 唯一權威來源；工作日誌/KiDit 清單皆為視圖，kiditSync rebuild 會納入 confirmed 事件
    // ========================================
    const vascularEventsExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='vascular_access_events'")
      .get()
    if (!vascularEventsExists) {
      console.log('📋 建立 vascular_access_events 表格...')
      db.exec(`
        CREATE TABLE IF NOT EXISTS vascular_access_events (
          id TEXT PRIMARY KEY,
          patient_id TEXT NOT NULL,
          patient_name TEXT NOT NULL,
          medical_record_number TEXT,
          event_date TEXT NOT NULL,
          event_type TEXT NOT NULL,
          failure_reason TEXT,
          repair_method TEXT,
          repair_method_other TEXT,
          new_access_type TEXT,
          new_access_side TEXT,
          new_access_site TEXT,
          location TEXT,
          notes TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          update_patient_master INTEGER DEFAULT 1,
          reject_reason TEXT,
          created_by TEXT DEFAULT '{}',
          confirmed_by TEXT DEFAULT '{}',
          confirmed_at TEXT,
          created_at TEXT DEFAULT (datetime('now', 'localtime')),
          updated_at TEXT DEFAULT (datetime('now', 'localtime'))
        )
      `)
      migrationsApplied++
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_vae_date ON vascular_access_events(event_date)')
    db.exec('CREATE INDEX IF NOT EXISTS idx_vae_patient ON vascular_access_events(patient_id)')
    db.exec('CREATE INDEX IF NOT EXISTS idx_vae_status ON vascular_access_events(status)')

    const vascularQuarterExportsExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='vascular_quarter_exports'")
      .get()
    if (!vascularQuarterExportsExists) {
      console.log('📋 建立 vascular_quarter_exports 表格...')
      db.exec(`
        CREATE TABLE IF NOT EXISTS vascular_quarter_exports (
          id TEXT PRIMARY KEY,
          quarter TEXT NOT NULL,
          patient_id TEXT NOT NULL,
          overrides TEXT DEFAULT '{}',
          updated_by TEXT DEFAULT '{}',
          created_at TEXT DEFAULT (datetime('now', 'localtime')),
          updated_at TEXT DEFAULT (datetime('now', 'localtime'))
        )
      `)
      migrationsApplied++
    }
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_vqe_quarter_patient ON vascular_quarter_exports(quarter, patient_id)')

    // ========================================
    // 季度病人 KiDit 輸入（2026-08-02）：透析紀錄/醫療狀況評估/合併症
    // 主護每季為分配病人填寫；只存人工值，預帶值前端即時計算
    // ========================================
    const kiditQuarterRecordsExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='kidit_quarter_records'")
      .get()
    if (!kiditQuarterRecordsExists) {
      console.log('📋 建立 kidit_quarter_records 表格...')
      db.exec(`
        CREATE TABLE IF NOT EXISTS kidit_quarter_records (
          id TEXT PRIMARY KEY,
          quarter TEXT NOT NULL,
          patient_id TEXT NOT NULL,
          data TEXT DEFAULT '{}',
          updated_by TEXT DEFAULT '{}',
          created_at TEXT DEFAULT (datetime('now', 'localtime')),
          updated_at TEXT DEFAULT (datetime('now', 'localtime'))
        )
      `)
      migrationsApplied++
    }
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_kqr_quarter_patient ON kidit_quarter_records(quarter, patient_id)')

    // ========================================
    // 重大傷病申請（2026-07-24）：慢性腎衰竭定期透析重大傷病證明申請附表（初次/再次）
    // 限 admin/contributor（醫師與專師）檢視編輯；表單內容存 form_data JSON
    // ========================================
    const catastrophicIllnessExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='catastrophic_illness_applications'")
      .get()
    if (!catastrophicIllnessExists) {
      console.log('📋 建立 catastrophic_illness_applications 表格...')
      db.exec(`
        CREATE TABLE IF NOT EXISTS catastrophic_illness_applications (
          id TEXT PRIMARY KEY,
          patient_id TEXT NOT NULL,
          patient_name TEXT NOT NULL,
          application_type TEXT NOT NULL DEFAULT 'initial',
          form_data TEXT DEFAULT '{}',
          created_by TEXT DEFAULT '{}',
          updated_by TEXT DEFAULT '{}',
          created_at TEXT DEFAULT (datetime('now', 'localtime')),
          updated_at TEXT DEFAULT (datetime('now', 'localtime'))
        )
      `)
      migrationsApplied++
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_cia_patient ON catastrophic_illness_applications(patient_id)')
    db.exec('CREATE INDEX IF NOT EXISTS idx_cia_type ON catastrophic_illness_applications(application_type)')

    // 重大傷病申請進度總覽（2026-07-24）：書記送出日期（每筆申請）＋ 重大傷病到期日（每病人，書記手動輸入）
    if (addColumnIfNotExists(db, 'catastrophic_illness_applications', 'clerk_sent_date', 'TEXT')) {
      migrationsApplied++
    }
    const ciExpiryExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='catastrophic_illness_expiry'")
      .get()
    if (!ciExpiryExists) {
      console.log('📋 建立 catastrophic_illness_expiry 表格...')
      db.exec(`
        CREATE TABLE IF NOT EXISTS catastrophic_illness_expiry (
          patient_id TEXT PRIMARY KEY,
          expiry_date TEXT,
          updated_by TEXT DEFAULT '{}',
          updated_at TEXT DEFAULT (datetime('now', 'localtime'))
        )
      `)
      migrationsApplied++
    }

    // 重大傷病到期續辦準備追蹤（2026-08-02）：已掛號/已填寫申請書/已收齊證件診斷書（書記填日期，非終身到期者用）
    for (const col of ['renewal_registered_date', 'renewal_form_date', 'renewal_docs_date']) {
      if (addColumnIfNotExists(db, 'catastrophic_illness_expiry', col, 'TEXT')) {
        migrationsApplied++
      }
    }

    // 重大傷病補登負責醫師（2026-08-12）：書記補登到期日時一併指定，供到期提醒卡「協助掛 {醫師}」與總覽負責醫師欄
    if (addColumnIfNotExists(db, 'catastrophic_illness_expiry', 'physician_name', 'TEXT')) {
      migrationsApplied++
    }

    // 重大傷病申請專用 PD 病人（2026-08-27）：腹膜透析病人不在 patients 表，另建小表供申請頁選人
    // ⚠️ 刻意不寫入 patients 表（避免流入排程/護理/KiDit）；申請紀錄/到期日以此表 id 作為 patient_id
    const ciPdExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='catastrophic_illness_pd_patients'")
      .get()
    if (!ciPdExists) {
      console.log('📋 建立 catastrophic_illness_pd_patients 表格...')
      db.exec(`
        CREATE TABLE IF NOT EXISTS catastrophic_illness_pd_patients (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          medical_record_number TEXT,
          id_number TEXT,
          gender TEXT,
          birth_date TEXT,
          physician TEXT,
          created_by TEXT DEFAULT '{}',
          updated_by TEXT DEFAULT '{}',
          created_at TEXT DEFAULT (datetime('now', 'localtime')),
          updated_at TEXT DEFAULT (datetime('now', 'localtime'))
        )
      `)
      migrationsApplied++
    }

    // ========================================
    // 病史與問題列表（2026-08-19）：病人清單操作欄新彈窗
    // patient_problems = 問題列表（問題/起始/治療處置/解決時間）
    // patient_problem_profiles = 相關性系統疾病手動勾選（KiDit 病史無資料時的備援，
    //   systemic_diseases 存 index 陣列、對照前端 KIDIT_HISTORY_OPTIONS.systemicDiseases；不回寫 KiDit）
    // ========================================
    const patientProblemsExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='patient_problems'")
      .get()
    if (!patientProblemsExists) {
      console.log('📋 建立 patient_problems 表格...')
      db.exec(`
        CREATE TABLE IF NOT EXISTS patient_problems (
          id TEXT PRIMARY KEY,
          patient_id TEXT NOT NULL,
          problem TEXT NOT NULL,
          start_date TEXT,
          treatment TEXT DEFAULT '',
          resolved_date TEXT,
          created_by TEXT DEFAULT '{}',
          created_at TEXT DEFAULT (datetime('now', 'localtime')),
          updated_at TEXT DEFAULT (datetime('now', 'localtime'))
        )
      `)
      migrationsApplied++
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_patient_problems_patient ON patient_problems(patient_id)')

    const patientProblemProfilesExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='patient_problem_profiles'")
      .get()
    if (!patientProblemProfilesExists) {
      console.log('📋 建立 patient_problem_profiles 表格...')
      db.exec(`
        CREATE TABLE IF NOT EXISTS patient_problem_profiles (
          patient_id TEXT PRIMARY KEY,
          systemic_diseases TEXT DEFAULT '[]',
          other_description TEXT DEFAULT '',
          updated_by TEXT DEFAULT '{}',
          created_at TEXT DEFAULT (datetime('now', 'localtime')),
          updated_at TEXT DEFAULT (datetime('now', 'localtime'))
        )
      `)
      migrationsApplied++
    }

    // ========================================
    // schedule_exceptions.status CHECK 納入 'error'（2026-08-15）
    // exceptionHandler 失敗路徑寫 status='error' 被舊 CHECK 擋下，記錄會卡在 processing；
    // 前端調班管理本就支援「錯誤」終態。SQLite 不能改 CHECK，只能重建表搬資料。
    // ========================================
    const seDdl = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='schedule_exceptions'")
      .get()
    if (seDdl && seDdl.sql.includes("'expired'") && !seDdl.sql.includes("'error'")) {
      const expectedCols = [
        'id', 'type', 'status', 'patient_id', 'patient_name',
        'from_data', 'to_data', 'patient1', 'patient2',
        'start_date', 'end_date', 'date', 'reason', 'cancel_reason',
        'error_message', 'created_by', 'cancelled_at', 'created_at', 'updated_at',
      ]
      const seCols = db.prepare('PRAGMA table_info(schedule_exceptions)').all().map((c) => c.name)
      if (seCols.length === expectedCols.length && expectedCols.every((c) => seCols.includes(c))) {
        console.log('📋 重建 schedule_exceptions（status CHECK 納入 error）...')
        const colList = expectedCols.join(', ')
        db.transaction(() => {
          db.exec(`
            CREATE TABLE schedule_exceptions_new (
              id TEXT PRIMARY KEY,
              type TEXT NOT NULL CHECK (type IN ('MOVE', 'ADD_SESSION', 'SWAP', 'SUSPEND')),
              status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'cancelled', 'conflict_requires_resolution', 'processing', 'expired', 'error')),
              patient_id TEXT,
              patient_name TEXT,
              from_data TEXT DEFAULT '{}',
              to_data TEXT DEFAULT '{}',
              patient1 TEXT DEFAULT '{}',
              patient2 TEXT DEFAULT '{}',
              start_date TEXT,
              end_date TEXT,
              date TEXT,
              reason TEXT,
              cancel_reason TEXT,
              error_message TEXT,
              created_by TEXT DEFAULT '{}',
              cancelled_at TEXT,
              created_at TEXT DEFAULT (datetime('now', 'localtime')),
              updated_at TEXT DEFAULT (datetime('now', 'localtime'))
            )
          `)
          db.exec(`INSERT INTO schedule_exceptions_new (${colList}) SELECT ${colList} FROM schedule_exceptions`)
          db.exec('DROP TABLE schedule_exceptions')
          db.exec('ALTER TABLE schedule_exceptions_new RENAME TO schedule_exceptions')
          db.exec('CREATE INDEX IF NOT EXISTS idx_exceptions_status ON schedule_exceptions(status)')
          db.exec('CREATE INDEX IF NOT EXISTS idx_exceptions_patient ON schedule_exceptions(patient_id)')
          db.exec('CREATE INDEX IF NOT EXISTS idx_exceptions_date ON schedule_exceptions(date)')
        })()
        migrationsApplied++
      } else {
        console.warn('⚠️ schedule_exceptions 欄位與預期不符，跳過 status CHECK 遷移（需人工確認）')
      }
    }

    // ========================================
    // patient_census_daily：每日病人數快照（2026-08-22）
    // 每晚 23:45 cron 記錄當日常規門診/門診/住院/急診人數；年度報表取每月最後一天呈現「常規門診病人數」。
    // source='cron' 為實際快照、'backfill' 為由 patient_history 倒推的估算值（scripts/backfill-patient-census.mjs）
    // ========================================
    const censusExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='patient_census_daily'")
      .get()
    if (!censusExists) {
      console.log('📋 建立 patient_census_daily 表格...')
      db.exec(`
        CREATE TABLE IF NOT EXISTS patient_census_daily (
          date TEXT PRIMARY KEY,
          opd_regular_count INTEGER NOT NULL DEFAULT 0,
          opd_count INTEGER NOT NULL DEFAULT 0,
          ipd_count INTEGER NOT NULL DEFAULT 0,
          er_count INTEGER NOT NULL DEFAULT 0,
          source TEXT NOT NULL DEFAULT 'cron',
          created_at TEXT DEFAULT (datetime('now', 'localtime'))
        )
      `)
      migrationsApplied++
    }

    // ========================================
    // consumables_reports：report_data 補上 ranges（各上傳區間明細，2026-09-01）
    // 改制前同月同類別再上傳會整批覆蓋；改為以「起日-迄日」為 key 去重+累積，月聚合欄位由 ranges 加總重算。
    // 既有列沒有 ranges → 由 source_file 檔名的 MMDD-MMDD 推出區間（A2...0824-0828.xls → 20260824-20260828），
    // 推不出者歸 'legacy'（下次同類別上傳時視為被取代，見 orders.js 上傳處理）。
    // ========================================
    const consumablesTableExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='consumables_reports'")
      .get()
    if (consumablesTableExists && columnExists(db, 'consumables_reports', 'source_file')) {
      const CATS = ['artificialKidney', 'dialysateCa', 'bicarbonateType']
      const rows = db
        .prepare(`SELECT id, report_date, report_data, source_file FROM consumables_reports WHERE report_data IS NOT NULL AND report_data != '{}'`)
        .all()
      const pending = []
      for (const row of rows) {
        let data
        try {
          data = JSON.parse(row.report_data)
        } catch {
          continue
        }
        if (!data || typeof data !== 'object' || Array.isArray(data)) continue
        if (data.ranges && typeof data.ranges === 'object') continue
        const cats = CATS.filter((c) => Array.isArray(data[c]) && data[c].length > 0)
        if (cats.length === 0) continue
        const year = String(row.report_date || '').substring(0, 4)
        const m = String(row.source_file || '').match(/(\d{4})-(\d{4})/)
        const key = m && /^\d{4}$/.test(year) ? `${year}${m[1]}-${year}${m[2]}` : 'legacy'
        const entry = {}
        for (const c of cats) entry[c] = data[c].map((x) => ({ item: String(x.item), count: Number(x.count) || 0 }))
        if (row.source_file && cats.length === 1) entry.sourceFiles = { [cats[0]]: row.source_file }
        data.ranges = { [key]: entry }
        pending.push({ id: row.id, json: JSON.stringify(data), key })
      }
      if (pending.length > 0) {
        const update = db.prepare('UPDATE consumables_reports SET report_data = ? WHERE id = ?')
        db.transaction(() => {
          for (const p of pending) update.run(p.json, p.id)
        })()
        const keys = [...new Set(pending.map((p) => p.key))].join(', ')
        console.log(`  📦 consumables_reports 補上 ranges：${pending.length} 列（區間：${keys}）`)
        migrationsApplied++
      }
    }

    // ========================================
    // inventory_count_docs：盤點文件（2026-09-01）
    // 週二週盤點/月底盤點統一為「某盤點日各品項實際數量」一份文件（counts/count_boxes JSON）。
    // 舊 inventory_counts 逐品項流水保留，由 PUT /system/inventory/counts/:date 同步重寫。
    // ========================================
    const countDocsExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='inventory_count_docs'")
      .get()
    if (!countDocsExists) {
      console.log('📋 建立 inventory_count_docs 表格...')
      db.exec(`
        CREATE TABLE IF NOT EXISTS inventory_count_docs (
          count_date TEXT PRIMARY KEY,
          counts TEXT NOT NULL DEFAULT '{}',
          count_boxes TEXT NOT NULL DEFAULT '{}',
          notes TEXT,
          created_by TEXT DEFAULT '{}',
          updated_by TEXT DEFAULT '{}',
          created_at TEXT DEFAULT (datetime('now', 'localtime')),
          updated_at TEXT DEFAULT (datetime('now', 'localtime'))
        )
      `)
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
