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
    version INTEGER NOT NULL DEFAULT 0,  -- 樂觀鎖版本號（存檔衝突偵測）；由 trigger 隨 schedule 欄位更新自動遞增
    last_modified_by TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_schedules_date ON schedules(date);

-- 樂觀鎖版本自動遞增：只要 UPDATE 語句的 SET 子句包含 schedule 欄位就會觸發（SQLite「UPDATE OF」語意，
-- 不比較新舊值是否相同），系統重建路徑（scheduleSync/exceptionHandler/exceptionReconcile 等）因此
-- 完全免改程式碼即自動遞增版本。SQLite recursive_triggers 預設關閉，trigger 內的 UPDATE 不會遞迴自我觸發。
CREATE TRIGGER IF NOT EXISTS trg_schedules_version_bump
AFTER UPDATE OF schedule ON schedules
BEGIN
    UPDATE schedules SET version = version + 1 WHERE id = NEW.id;
END;

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
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'cancelled', 'conflict_requires_resolution', 'processing', 'expired', 'error')),

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

-- 初透病人衛教紀錄（一位病人一列，sessions JSON 存 12 次）
CREATE TABLE IF NOT EXISTS education_records (
    id TEXT PRIMARY KEY,            -- = patient_id（一對一）
    patient_id TEXT NOT NULL UNIQUE,
    sessions TEXT DEFAULT '[]',     -- JSON: [{index, topic, educator, educatedDate, signature} ×12]
    admission_date TEXT,            -- 入院日期（可編輯，預設帶入病人入院/新增日）
    topic_queue TEXT,               -- JSON: 此病人的衛教主題輪序佇列（跳過的主題移到最後）；NULL=尚未初始化
    paper_education INTEGER DEFAULT 0,  -- 已紙本衛教（此病人衛教以紙本進行，電子未衛教判定跳過）
    paper_completed INTEGER DEFAULT 0,  -- 紙本衛教已完成（需 paper_education=1；視為全數通過）
    created_by TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_education_patient ON education_records(patient_id);

-- ========================================
-- 護理相關表格
-- ========================================

-- 護理人員分配
CREATE TABLE IF NOT EXISTS nurse_assignments (
    id TEXT PRIMARY KEY,  -- 使用日期作為 ID
    date TEXT UNIQUE NOT NULL,
    teams TEXT DEFAULT '{}',  -- JSON: {patientId-shift: nurseId}
    version INTEGER NOT NULL DEFAULT 0,  -- 樂觀鎖版本號（存檔衝突偵測）；由 trigger 隨 teams 欄位更新自動遞增
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_nurse_assignments_date ON nurse_assignments(date);

-- 樂觀鎖版本自動遞增：同 trg_schedules_version_bump 設計，系統重建/還原路徑免改程式碼即自動遞增版本
CREATE TRIGGER IF NOT EXISTS trg_nurse_assignments_version_bump
AFTER UPDATE OF teams ON nurse_assignments
BEGIN
    UPDATE nurse_assignments SET version = version + 1 WHERE id = NEW.id;
END;

-- 護理分組歷史快照 (每小時 + 每次儲存前；用於異常快速復原)
CREATE TABLE IF NOT EXISTS nurse_assignment_revisions (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,           -- 對應的分組日期
    teams TEXT DEFAULT '{}',      -- nurse_assignments.teams 的完整 JSON 快照
    snapshot_type TEXT,           -- hourly | pre_save | pre_restore | manual
    created_by TEXT DEFAULT '{}', -- {uid, name} 或 {name:'system'}
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_nar_date_time ON nurse_assignment_revisions(date, created_at);

-- 護理師固定照護病人分配（單一 JSON 文件；與每日護理分組 nurse_assignments 無關）
CREATE TABLE IF NOT EXISTS nurse_patient_care (
    id TEXT PRIMARY KEY DEFAULT 'main',
    assignments TEXT DEFAULT '[]',        -- JSON: [{nurseId, nurseName, patientIds: [...]}]
    excluded_nurse_ids TEXT DEFAULT '[]', -- JSON: 排除不列入照護分配的護理師 id
    updated_by TEXT DEFAULT '{}',         -- {uid, name}
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

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

-- 工作日誌修改快照
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
);

CREATE INDEX IF NOT EXISTS idx_daily_log_revisions_date ON daily_log_revisions(date);
CREATE INDEX IF NOT EXISTS idx_daily_log_revisions_log ON daily_log_revisions(daily_log_id);

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
-- 部分索引：涵蓋列表查詢的 status != 'deleted' + ORDER BY created_at DESC（效能批次 2A）
CREATE INDEX IF NOT EXISTS idx_tasks_active ON tasks(created_at) WHERE status != 'deleted';

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
-- 效能批次 2A：支援 ORDER BY created_at DESC 列表查詢
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);

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
-- 藥囑（Excel 匯入）。2026-07-18 起支援區間模型：start_date/end_date（結束日空=持續使用）
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

-- 透析醫囑（HIS「備藥前置作業」Excel 匯入）。全數保留歷次醫囑；
-- 同病人 + 同醫囑日期(effective_date) 視為同一筆（UNIQUE，重傳更新不重複累積）
CREATE TABLE IF NOT EXISTS dialysis_order_uploads (
    id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL,
    patient_name TEXT,
    medical_record_number TEXT NOT NULL,
    effective_date TEXT NOT NULL,
    orders TEXT NOT NULL,           -- JSON，key 對齊 DialysisOrderModal（mode/dialysisTimeHours…）
    source_file TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime')),
    UNIQUE(medical_record_number, effective_date)
);

CREATE INDEX IF NOT EXISTS idx_dialysis_order_uploads_patient ON dialysis_order_uploads(patient_id);
CREATE INDEX IF NOT EXISTS idx_dialysis_order_uploads_date ON dialysis_order_uploads(effective_date);

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

-- 站點配置 (床位設定、假日主檔等鍵值存放)
CREATE TABLE IF NOT EXISTS site_config (
    id TEXT PRIMARY KEY,
    config_data TEXT DEFAULT '{}',  -- JSON
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- KiDit 日誌
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
);

CREATE INDEX IF NOT EXISTS idx_bed_dashboard_devices_bed_key ON bed_dashboard_devices(bed_key);
CREATE INDEX IF NOT EXISTS idx_bed_dashboard_devices_active ON bed_dashboard_devices(is_active);

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
-- 全院 AKI Map（專師專用）
-- 資料來源：HIS 匯出的「留院病人清單」+「CKD-AKI 病患明細」Excel
-- 以病歷號(mrn, 10碼補零字串)為對接鍵，累積歷史快照
-- ========================================

-- 每日住院病人快照（AKI map 畫布）
CREATE TABLE IF NOT EXISTS aki_inpatients (
    id TEXT PRIMARY KEY,
    snapshot_date TEXT NOT NULL,     -- 此快照對應的日期 (YYYY-MM-DD)
    mrn TEXT NOT NULL,               -- 病歷號（字串，保留前導0）
    name TEXT,
    ward TEXT,                       -- 護理站
    bed TEXT,                        -- 床號
    dept TEXT,                       -- 科別
    physician TEXT,                  -- 主治醫師
    sex TEXT,
    age TEXT,
    admit_date TEXT,                 -- 入院日 (YYYY-MM-DD)
    discharge_date TEXT,             -- 出院日 (YYYY-MM-DD，留院者為空)
    diagnoses TEXT DEFAULT '[]',     -- JSON 陣列 [{code, name}]
    batch_id TEXT,                   -- 來源上傳批次
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS idx_aki_inpatients_snapshot ON aki_inpatients(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_aki_inpatients_mrn ON aki_inpatients(mrn);
-- 同一快照日同一病人只保留一筆（重新上傳可覆蓋）
CREATE UNIQUE INDEX IF NOT EXISTS idx_aki_inpatients_uniq ON aki_inpatients(snapshot_date, mrn);

-- 肌酸酐檢驗散點（累積歷史，跨日去重）
CREATE TABLE IF NOT EXISTS aki_lab_results (
    id TEXT PRIMARY KEY,
    mrn TEXT NOT NULL,               -- 病歷號
    name TEXT,
    source TEXT,                     -- OPD / ER / IPD（門診/急診/住院）
    test_date TEXT NOT NULL,         -- 檢驗日 (YYYY-MM-DD)
    creatinine REAL,                 -- Cr 值 (mg/dL)
    egfr REAL,                       -- 腎絲球過濾率 eGFR（同次抽血配對，CKD 追蹤用；可為 NULL）
    order_code TEXT,                 -- 醫令碼（E09015C 等，皆為肌酸酐）
    batch_id TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS idx_aki_lab_mrn_date ON aki_lab_results(mrn, test_date);
-- 同病人同來源同日同值視為同一筆（跨日重複上傳不重覆累積）
CREATE UNIQUE INDEX IF NOT EXISTS idx_aki_lab_uniq ON aki_lab_results(mrn, source, test_date, creatinine);

-- 上傳批次紀錄
CREATE TABLE IF NOT EXISTS aki_upload_batches (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,              -- 'inpatients' | 'labs'
    file_name TEXT,
    snapshot_date TEXT,              -- inpatients 用
    range_start TEXT,                -- labs 用（檔案標題的起日）
    range_end TEXT,                  -- labs 用（檔案標題的迄日）
    row_count INTEGER DEFAULT 0,     -- 解析出的原始列數
    imported_count INTEGER DEFAULT 0,-- 實際寫入/更新筆數
    uploaded_by TEXT,
    uploaded_at TEXT DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS idx_aki_batches_kind ON aki_upload_batches(kind, uploaded_at);

-- AKI 關懷名單追蹤紀錄（每位病人一筆，以病歷號為鍵，跨快照延續）
CREATE TABLE IF NOT EXISTS aki_care_records (
    id TEXT PRIMARY KEY,
    mrn TEXT NOT NULL UNIQUE,          -- 病歷號
    ckd_history TEXT,                  -- CKD 病史（無/G1/G2/G3a/G3b/G4/G5/未知）
    nephrology_consult TEXT,           -- 腎臟科會診（已會診/未會診/會診中）
    aki_cause TEXT,                    -- AKI 原因
    dialysis_status TEXT,              -- 是否透析（HD/SLED/CVVHDF/無，預填本院模式）
    care_result TEXT,                  -- 關懷結果（三名單共用照護歷程）
    -- AKI 名單專屬
    nephrotoxin_review TEXT,           -- 腎毒性藥物檢視（已檢視無/已停用調整/檢視中/未檢視）
    urine_output TEXT,                 -- 尿量狀態（正常/寡尿/無尿/未評估）
    -- CKD 名單專屬
    preesrd_enrolled TEXT,             -- Pre-ESRD 照護收案（已收案/擬收案/未收案/不適用）
    ckd_education TEXT,                -- 腎臟保健衛教（已完成/待安排/不適用）
    vascular_prep TEXT,                -- 透析準備-血管通路（已建立/評估中/未評估/不適用）
    -- 出院待追蹤名單專屬
    followup_appt TEXT,                -- 回診安排（已約門診/未約/不需）
    followup_appt_date TEXT,           -- 回診日期
    followup_lab TEXT,                 -- 追蹤抽血（已排/未排/不需）
    contact_status TEXT,               -- 電訪狀態（已電訪/待電訪/失聯）
    closure_status TEXT,               -- 結案狀態（持續追蹤/已結案·恢復/已結案·轉腎臟科/死亡）
    care_physician TEXT,               -- 關懷醫師簽核（姓名）
    signed_at TEXT,                    -- 簽核時間
    updated_by TEXT,
    updated_at TEXT DEFAULT (datetime('now', 'localtime')),
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS idx_aki_care_mrn ON aki_care_records(mrn);

-- ========================================
-- 血管通路事件（主護填寫 → 組長確認 → KiDit 造管申報）
-- 唯一權威來源；工作日誌與 KiDit 清單皆為視圖，勿寫回 daily_logs 的 vascular_access_log JSON
-- ========================================

CREATE TABLE IF NOT EXISTS vascular_access_events (
    id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL,
    patient_name TEXT NOT NULL,              -- 快照（病人可能軟刪除）
    medical_record_number TEXT,              -- 快照
    event_date TEXT NOT NULL,                -- YYYY-MM-DD
    event_type TEXT NOT NULL,                -- intervention(介入治療) | reconstruction(血管重建)
    failure_reason TEXT,                     -- 造管CSV代碼：1感染 2阻塞 3血液流量過小 5長期導管移位 6竊流症候群 9其他（介入=失敗原因；重建=前次失敗原因）
    repair_method TEXT,                      -- 介入專用：1=PTA 2=外科手術 3=PTA+手術 9=其他
    repair_method_other TEXT,                -- repair_method=9 時的文字說明
    new_access_type TEXT,                    -- 重建專用：AVF | AVG | PERM | TEMP
    new_access_side TEXT,                    -- L | R
    new_access_site TEXT,                    -- 廔管:1前臂 2上臂 3大腿 4小腿 9其他；導管:1內頸 2鎖骨下 3股 9其他
    location TEXT,                           -- 處置院所
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'pending',  -- pending | confirmed | rejected
    update_patient_master INTEGER DEFAULT 1, -- 重建確認時是否連動病人主檔 vasc_access
    reject_reason TEXT,
    created_by TEXT DEFAULT '{}',            -- JSON {uid, name}（主護）
    confirmed_by TEXT DEFAULT '{}',          -- JSON（組長）
    confirmed_at TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_vae_date ON vascular_access_events(event_date);
CREATE INDEX IF NOT EXISTS idx_vae_patient ON vascular_access_events(patient_id);
CREATE INDEX IF NOT EXISTS idx_vae_status ON vascular_access_events(status);

-- 季度造管CSV匯出的人工欄與覆寫（快照/事件欄每次載入即時重算，只存 overrides 避免資料過期）
CREATE TABLE IF NOT EXISTS vascular_quarter_exports (
    id TEXT PRIMARY KEY,                     -- `${quarter}_${patient_id}`
    quarter TEXT NOT NULL,                   -- 例 2026Q3
    patient_id TEXT NOT NULL,
    overrides TEXT DEFAULT '{}',             -- JSON：血流量/accessFlow/遠紅外線/並存通路/快照修正/excluded
    updated_by TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vqe_quarter_patient ON vascular_quarter_exports(quarter, patient_id);

-- 季度病人 KiDit 輸入（透析紀錄/醫療狀況評估/合併症）：主護每季為分配病人填寫
-- 只存人工填寫值與完成註記，預帶值（EPO藥囑/Hb/Hct/門住診）由前端載入時即時計算
CREATE TABLE IF NOT EXISTS kidit_quarter_records (
    id TEXT PRIMARY KEY,                     -- `${quarter}_${patient_id}`
    quarter TEXT NOT NULL,                   -- 例 2026Q3
    patient_id TEXT NOT NULL,
    data TEXT DEFAULT '{}',                  -- JSON：{ hdrecord:{}, diagnose:{}, comorbid:{}, completed:{}, nurse:{} }
    updated_by TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_kqr_quarter_patient ON kidit_quarter_records(quarter, patient_id);

-- 重大傷病申請（初次/再次）：慢性腎衰竭定期透析重大傷病證明申請附表
-- 限 admin/contributor（醫師與專師）；表單內容存 form_data JSON（欄位對應官方附表）
CREATE TABLE IF NOT EXISTS catastrophic_illness_applications (
    id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL,
    patient_name TEXT NOT NULL,
    application_type TEXT NOT NULL DEFAULT 'initial',  -- initial=初次 / renewal=再次
    form_data TEXT DEFAULT '{}',
    clerk_sent_date TEXT,                              -- 書記送出日期（總覽列表由書記填）
    created_by TEXT DEFAULT '{}',
    updated_by TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_cia_patient ON catastrophic_illness_applications(patient_id);
CREATE INDEX IF NOT EXISTS idx_cia_type ON catastrophic_illness_applications(application_type);

-- 重大傷病到期日（每病人一筆，總覽列表由書記手動輸入）
-- renewal_* 三欄＝到期續辦準備追蹤（已掛號/已填寫申請書/已收齊證件診斷書，書記填日期）
-- physician_name＝書記補登時指定的負責醫師（無申請紀錄的病人以此顯示；有申請紀錄則以申請表的醫師優先）
CREATE TABLE IF NOT EXISTS catastrophic_illness_expiry (
    patient_id TEXT PRIMARY KEY,
    expiry_date TEXT,
    renewal_registered_date TEXT,
    renewal_form_date TEXT,
    renewal_docs_date TEXT,
    physician_name TEXT,
    updated_by TEXT DEFAULT '{}',
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- 重大傷病申請專用 PD（腹膜透析）病人（2026-08-27）
-- PD 病人不在 patients 表（無排程/KiDit），僅供重大傷病申請頁選人；
-- 申請紀錄與到期日以此表 id 作為 patient_id，⚠️ 刻意不進 patients 表，避免流入排程/護理/KiDit
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
);

-- ========================================
-- 初始化預設資料
-- ========================================

-- 確保 MASTER_SCHEDULE 存在
INSERT OR IGNORE INTO base_schedules (id, schedule) VALUES ('MASTER_SCHEDULE', '{}');

-- 確保 nursing_duties main 文件存在
INSERT OR IGNORE INTO nursing_duties (id, duties) VALUES ('main', '{}');
