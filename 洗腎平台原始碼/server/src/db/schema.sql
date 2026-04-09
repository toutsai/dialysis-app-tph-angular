-- ========================================
-- 透析排程系統 SQLite Schema
-- 版本: 1.0.0
-- ========================================

-- 啟用外鍵約束
PRAGMA foreign_keys = ON;

-- ========================================
-- 使用者相關表格
-- ========================================

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    title TEXT DEFAULT '',
    role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'contributor', 'viewer')),
    email TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime')),
    last_login TEXT,
    -- 登入失敗鎖定相關欄位 (B級資安合規)
    failed_login_count INTEGER DEFAULT 0,
    locked_until TEXT DEFAULT NULL
);

-- ========================================
-- 病人相關表格
-- ========================================

CREATE TABLE IF NOT EXISTS patients (
    id TEXT PRIMARY KEY,
    medical_record_number TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'opd' CHECK (status IN ('opd', 'ipd', 'er', 'deleted')),
    original_status TEXT,  -- 刪除前的原始狀態 (用於復原)
    is_deleted INTEGER DEFAULT 0,
    delete_reason TEXT,
    deleted_at TEXT,

    -- 透析相關欄位 (JSON 格式儲存複雜資料)
    dialysis_orders TEXT DEFAULT '{}',  -- JSON: 透析醫囑

    -- 基本資料
    birth_date TEXT,
    gender TEXT,
    id_number TEXT,
    phone TEXT,
    address TEXT,
    emergency_contact TEXT,
    emergency_phone TEXT,

    -- 醫療資訊
    physician TEXT,
    first_dialysis_date TEXT,
    vasc_access TEXT,
    access_creation_date TEXT,
    ward_number TEXT,
    bed_number TEXT,

    -- 附加資訊 (JSON 格式)
    hospital_info TEXT DEFAULT '{}',   -- JSON: {source, transferOut}
    inpatient_reason TEXT,
    dialysis_reason TEXT,
    notes TEXT,

    -- 病人分類與狀態
    patient_category TEXT DEFAULT 'opd_regular',  -- opd_regular/non_regular
    diseases TEXT DEFAULT '[]',       -- JSON array: 須注意疾病列表

    -- 病人狀態 (JSON 格式)
    patient_status TEXT DEFAULT '{}',  -- JSON: {isFirstDialysis, isPaused, hasBloodDraw}
    is_hepatitis INTEGER DEFAULT 0,    -- 是否為肝炎病人

    -- 排程規則關聯
    schedule_rule TEXT DEFAULT '{}',   -- JSON: 排程規則

    -- 追蹤欄位
    last_modified_by TEXT DEFAULT '{}', -- JSON: {uid, name}
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_patients_mrn ON patients(medical_record_number);
CREATE INDEX IF NOT EXISTS idx_patients_status ON patients(status);
CREATE INDEX IF NOT EXISTS idx_patients_name ON patients(name);
CREATE INDEX IF NOT EXISTS idx_patients_deleted ON patients(is_deleted);

-- ========================================
-- 排程相關表格
-- ========================================

-- 每日排程表
CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY,  -- 使用日期作為 ID: YYYY-MM-DD
    date TEXT UNIQUE NOT NULL,
    schedule TEXT DEFAULT '{}',  -- JSON: {bedNum-shift: {patientId, patientName, ...}}
    sync_method TEXT,
    last_modified_by TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_schedules_date ON schedules(date);

-- 歸檔排程表 (用於周排班檢視歷史紀錄)
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
);

CREATE INDEX IF NOT EXISTS idx_archived_schedules_date ON archived_schedules(date);

-- 基礎排班總表
CREATE TABLE IF NOT EXISTS base_schedules (
    id TEXT PRIMARY KEY DEFAULT 'MASTER_SCHEDULE',
    schedule TEXT DEFAULT '{}',  -- JSON: {patientId: {freq, bedNum, shiftCode, ...}}
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- 排程例外 (調班申請)
CREATE TABLE IF NOT EXISTS schedule_exceptions (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('MOVE', 'ADD_SESSION', 'SWAP', 'SUSPEND')),
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'cancelled', 'conflict_requires_resolution', 'processing', 'expired')),

    patient_id TEXT,
    patient_name TEXT,

    -- MOVE/ADD_SESSION 用
    from_data TEXT DEFAULT '{}',  -- JSON: {sourceDate, bedNum, shiftCode}
    to_data TEXT DEFAULT '{}',    -- JSON: {goalDate, bedNum, shiftCode}

    -- SWAP 用
    patient1 TEXT DEFAULT '{}',  -- JSON: {patientId, patientName, fromBedNum, fromShiftCode}
    patient2 TEXT DEFAULT '{}',  -- JSON: {patientId, patientName, fromBedNum, fromShiftCode}

    -- SUSPEND 用
    start_date TEXT,
    end_date TEXT,

    -- 通用欄位
    date TEXT,  -- 主要日期 (用於某些類型)
    reason TEXT,
    cancel_reason TEXT,
    error_message TEXT,

    created_by TEXT DEFAULT '{}',
    cancelled_at TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_exceptions_status ON schedule_exceptions(status);
CREATE INDEX IF NOT EXISTS idx_exceptions_patient ON schedule_exceptions(patient_id);
CREATE INDEX IF NOT EXISTS idx_exceptions_date ON schedule_exceptions(date);

-- ========================================
-- 醫囑與歷史相關表格
-- ========================================

-- 透析醫囑歷史
CREATE TABLE IF NOT EXISTS dialysis_orders_history (
    id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL,
    patient_name TEXT,
    operation_type TEXT DEFAULT 'CREATE',
    orders TEXT DEFAULT '{}',  -- JSON: 完整醫囑資料
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_orders_history_patient ON dialysis_orders_history(patient_id);

-- 病人歷史記錄
CREATE TABLE IF NOT EXISTS patient_history (
    id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL,
    patient_name TEXT,
    event_type TEXT NOT NULL,  -- CREATE, DELETE, TRANSFER, RESTORE_AND_TRANSFER
    event_details TEXT DEFAULT '{}',  -- JSON
    snapshot TEXT DEFAULT '{}',  -- JSON: 當時的病人資料快照
    timestamp TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_patient_history_patient ON patient_history(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_history_type ON patient_history(event_type);

-- 病情記錄
CREATE TABLE IF NOT EXISTS condition_records (
    id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL,
    record_date TEXT NOT NULL,
    content TEXT,
    created_by TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_condition_patient ON condition_records(patient_id);

-- ========================================
-- 護理相關表格
-- ========================================

-- 護理人員分配
CREATE TABLE IF NOT EXISTS nurse_assignments (
    id TEXT PRIMARY KEY,  -- 使用日期作為 ID
    date TEXT UNIQUE NOT NULL,
    teams TEXT DEFAULT '{}',  -- JSON: {patientId-shift: nurseId}
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_nurse_assignments_date ON nurse_assignments(date);

-- 護理工作職責
CREATE TABLE IF NOT EXISTS nursing_duties (
    id TEXT PRIMARY KEY DEFAULT 'main',
    duties TEXT DEFAULT '{}',  -- JSON: 職責資料
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- 護理排班
CREATE TABLE IF NOT EXISTS nursing_schedules (
    id TEXT PRIMARY KEY,
    schedule_data TEXT DEFAULT '{}',  -- JSON
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- 護理組別配置
CREATE TABLE IF NOT EXISTS nursing_group_config (
    id TEXT PRIMARY KEY,
    config TEXT DEFAULT '{}',  -- JSON
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- ========================================
-- 醫師相關表格
-- ========================================

CREATE TABLE IF NOT EXISTS physicians (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    specialty TEXT,
    staff_id TEXT,
    phone TEXT,
    clinic_hours TEXT DEFAULT '[]',  -- JSON array
    default_schedules TEXT DEFAULT '[]',  -- JSON array
    default_consultation_schedules TEXT DEFAULT '[]',  -- JSON array
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS physician_schedules (
    id TEXT PRIMARY KEY,
    schedule_data TEXT DEFAULT '{}',  -- JSON
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- ========================================
-- 日誌與備忘錄
-- ========================================

-- 備忘錄
CREATE TABLE IF NOT EXISTS memos (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    content TEXT,
    author_id TEXT,
    author_name TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_memos_date ON memos(date);

-- 交班日誌
CREATE TABLE IF NOT EXISTS handover_logs (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    shift TEXT,
    content TEXT,
    items TEXT DEFAULT '[]',  -- JSON array
    created_by TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_handover_date ON handover_logs(date);

-- 每日工作日誌
CREATE TABLE IF NOT EXISTS daily_logs (
    id TEXT PRIMARY KEY,  -- 使用日期作為 ID: YYYY-MM-DD
    date TEXT UNIQUE NOT NULL,
    patient_movements TEXT DEFAULT '[]',  -- JSON array
    vascular_access_log TEXT DEFAULT '[]',  -- JSON array: 血管通路事件
    announcements TEXT DEFAULT '[]',  -- JSON array
    notes TEXT,
    other_notes TEXT,  -- 其他備註
    stats TEXT DEFAULT '{}',  -- JSON: 統計資料 (main_beds, peripheral_beds, patient_care, staffing)
    leader TEXT DEFAULT '{}',  -- JSON: 簽核資訊 (early, noon, late)
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_daily_logs_date ON daily_logs(date);

-- ========================================
-- 任務與通知
-- ========================================

CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT,
    description TEXT,
    content TEXT,  -- 任務/留言內容
    status TEXT DEFAULT 'pending',
    priority TEXT DEFAULT 'normal',
    category TEXT DEFAULT 'task',  -- task 或 message
    type TEXT DEFAULT '常規',  -- 常規, 抽血, 衛教 等
    patient_id TEXT,
    patient_name TEXT,
    target_date TEXT,  -- 目標日期
    assigned_to TEXT,
    assignee TEXT DEFAULT '{}',  -- JSON: {type, value, name, title, role}
    creator TEXT DEFAULT '{}',  -- JSON: {uid, name}
    created_by TEXT DEFAULT '{}',  -- 向後相容
    resolved_by TEXT DEFAULT '{}',  -- JSON: {uid, name}
    resolved_at TEXT,
    due_date TEXT,
    completed_at TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks(category);
CREATE INDEX IF NOT EXISTS idx_tasks_patient ON tasks(patient_id);

CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT,
    message TEXT,
    recipient_id TEXT,
    is_read INTEGER DEFAULT 0,
    data TEXT DEFAULT '{}',  -- JSON
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_id);

-- ========================================
-- 檢驗報告
-- ========================================

CREATE TABLE IF NOT EXISTS lab_reports (
    id TEXT PRIMARY KEY,
    patient_id TEXT,
    report_date TEXT,
    report_type TEXT,
    results TEXT DEFAULT '{}',  -- JSON
    file_path TEXT,
    uploaded_by TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_lab_reports_patient ON lab_reports(patient_id);
CREATE INDEX IF NOT EXISTS idx_lab_reports_date ON lab_reports(report_date);

CREATE TABLE IF NOT EXISTS lab_alert_analyses (
    id TEXT PRIMARY KEY,
    patient_id TEXT,
    month_range TEXT,
    abnormality_key TEXT,
    analysis TEXT,
    suggestion TEXT,
    analysis_data TEXT DEFAULT '{}',  -- JSON (legacy)
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_lab_alert_analyses_patient ON lab_alert_analyses(patient_id);
CREATE INDEX IF NOT EXISTS idx_lab_alert_analyses_month ON lab_alert_analyses(month_range);

-- ========================================
-- 庫存管理
-- ========================================

CREATE TABLE IF NOT EXISTS inventory_items (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT,
    unit TEXT,
    units_per_box INTEGER DEFAULT 1,
    current_quantity INTEGER DEFAULT 0,
    min_quantity INTEGER DEFAULT 0,
    location TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS inventory_purchases (
    id TEXT PRIMARY KEY,
    item_id TEXT,
    quantity INTEGER,
    unit_price REAL,
    supplier TEXT,
    purchase_date TEXT,
    notes TEXT,
    created_by TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS inventory_counts (
    id TEXT PRIMARY KEY,
    item_id TEXT,
    counted_quantity INTEGER,
    count_date TEXT,
    discrepancy INTEGER,
    notes TEXT,
    counted_by TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- ========================================
-- 藥物訂單
-- ========================================

CREATE TABLE IF NOT EXISTS medication_orders (
    id TEXT PRIMARY KEY,
    patient_id TEXT,
    patient_name TEXT,
    medications TEXT DEFAULT '[]',  -- JSON array
    status TEXT DEFAULT 'pending',
    order_date TEXT,
    created_by TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- 針劑藥囑訂單 (Excel 匯入的藥囑記錄)
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
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_injection_orders_patient ON injection_orders(patient_id);
CREATE INDEX IF NOT EXISTS idx_injection_orders_month ON injection_orders(upload_month);
CREATE INDEX IF NOT EXISTS idx_injection_orders_type ON injection_orders(order_type);

CREATE TABLE IF NOT EXISTS medication_drafts (
    id TEXT PRIMARY KEY,
    author_id TEXT NOT NULL,
    patient_id TEXT,
    draft_data TEXT DEFAULT '{}',  -- JSON
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- ========================================
-- 耗材報告
-- ========================================

CREATE TABLE IF NOT EXISTS consumables_reports (
    id TEXT PRIMARY KEY,
    report_date TEXT,
    report_data TEXT DEFAULT '{}',  -- JSON
    created_by TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- ========================================
-- 系統配置與日誌
-- ========================================

-- 站點配置 (跑馬燈等)
CREATE TABLE IF NOT EXISTS site_config (
    id TEXT PRIMARY KEY,
    config_data TEXT DEFAULT '{}',  -- JSON
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- KiDit 日誌
CREATE TABLE IF NOT EXISTS kidit_logbook (
    id TEXT PRIMARY KEY,  -- 日期作為 ID
    date TEXT UNIQUE NOT NULL,
    log_data TEXT DEFAULT '{}',  -- JSON
    events TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- 稽核日誌 (B級合規)
CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    action TEXT NOT NULL,
    user_id TEXT,
    user_name TEXT,
    collection_name TEXT,
    document_id TEXT,
    details TEXT DEFAULT '{}',  -- JSON
    ip_address TEXT,
    success INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_date ON audit_logs(created_at);

-- 排程病人更新 (用於預約生效的變更)
CREATE TABLE IF NOT EXISTS scheduled_patient_updates (
    id TEXT PRIMARY KEY,
    patient_id TEXT,
    patient_name TEXT,
    change_type TEXT,  -- UPDATE_STATUS, UPDATE_MODE, UPDATE_FREQ, UPDATE_BASE_SCHEDULE_RULE, DELETE_PATIENT
    change_data TEXT DEFAULT '{}',  -- JSON: 變更內容
    effective_date TEXT,  -- 生效日期
    notes TEXT,
    status TEXT DEFAULT 'pending',  -- pending, processed, failed, cancelled
    error_message TEXT,
    created_by TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    processed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_scheduled_updates_date ON scheduled_patient_updates(effective_date);
CREATE INDEX IF NOT EXISTS idx_scheduled_updates_status ON scheduled_patient_updates(status);
CREATE INDEX IF NOT EXISTS idx_scheduled_updates_patient ON scheduled_patient_updates(patient_id);

-- ========================================
-- 資料備份追蹤
-- ========================================

CREATE TABLE IF NOT EXISTS backup_history (
    id TEXT PRIMARY KEY,
    backup_file TEXT NOT NULL,
    backup_type TEXT DEFAULT 'auto',  -- auto, manual
    file_size INTEGER,
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- ========================================
-- Token 黑名單 (用於登出/單一裝置登入)
-- ========================================

CREATE TABLE IF NOT EXISTS token_blacklist (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT,
    reason TEXT,  -- logout, duplicate_login, expired_cleanup
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_token_blacklist_user ON token_blacklist(user_id);
CREATE INDEX IF NOT EXISTS idx_token_blacklist_expires ON token_blacklist(expires_at);

-- ========================================
-- 使用者登入 Session 追蹤 (單一裝置限制)
-- ========================================

CREATE TABLE IF NOT EXISTS active_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,  -- 每個使用者只能有一個活躍 session
    token_hash TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_active_sessions_user ON active_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_active_sessions_expires ON active_sessions(expires_at);

-- ========================================
-- 初始化預設資料
-- ========================================

-- 確保 MASTER_SCHEDULE 存在
INSERT OR IGNORE INTO base_schedules (id, schedule) VALUES ('MASTER_SCHEDULE', '{}');

-- 確保 nursing_duties main 文件存在
INSERT OR IGNORE INTO nursing_duties (id, duties) VALUES ('main', '{}');
