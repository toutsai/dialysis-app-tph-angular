# 透析排程系統 (dialysis-app-tph)

台北醫院血液透析中心管理平台。院內使用的全功能透析排程、病人管理、護理與醫囑系統。

## 技術棧

- **Backend**: Node.js (ESM) + Express.js
- **Database**: SQLite via better-sqlite3 (同步 API，全域單例連線)
- **Auth**: JWT + bcryptjs, Token 黑名單 + 單一裝置 Session
- **Frontend**: Angular 19 + TypeScript (原始碼在 `angular-client/`)
- **Build**: Angular CLI，建置輸出到 `dist/browser`
- **排程任務**: node-cron
- **部署**: Windows VM, PM2 process manager / Electron 離線桌面版
- **Package**: 後端 `"type": "module"` — ES module (`import`/`export`)

## 常用指令

```bash
npm start              # 啟動伺服器
npm run dev            # 開發模式 (--watch)
npm run migrate        # 執行資料庫遷移 (獨立腳本)
npm run backup         # 手動備份資料庫
npm run init-db        # 初始化資料庫 + 建立預設管理員
```

## 專案結構

```
src/
  index.js                     # Express 入口，CORS, 路由掛載, graceful shutdown
  db/
    init.js                    # DB 全域單例 (initDatabase/getDatabase/closeDatabase)
    schema.sql                 # 25+ 張表 (CREATE IF NOT EXISTS)
    migrate.js                 # 漸進式 ALTER TABLE 遷移 (獨立腳本，自管連線)
  middleware/
    auth.js                    # JWT 驗證, RBAC (admin/editor/contributor/viewer), 稽核日誌
    rateLimit.js               # 登入 + API rate limiting (in-memory Map)
    validate.js                # 通用 input validation middleware
  routes/
    auth.js                    # 登入/登出/使用者 CRUD, HIS API 驗證
    patients.js                # 病人 CRUD, 軟刪除/復原, 狀態流轉 (opd/ipd/er)
    schedules.js               # 每日排程, 總表 (base_schedules), 調班, 護理分配
    orders.js                  # 透析醫囑歷史, Excel 匯入 (針劑/口服/檢驗/耗材)
    medications.js             # 用藥管理, 每日應打針劑計算 (QW 頻率規則)
    nursing.js                 # 護理排班/職責/交班日誌/每日工作日誌/KiDit 日誌本
    system.js                  # 任務/通知/庫存/醫師/配置/預約變更/備份
    memos.js                   # 備忘錄 CRUD
  services/
    scheduler.js               # node-cron 定時任務 (歸檔/備份/清理/排程初始化)
    scheduleSync.js            # 總表 -> 未來 60 天排程同步引擎
    exceptionHandler.js        # 調班處理器 (MOVE/SUSPEND/ADD_SESSION/SWAP)
    kiditSync.js               # 工作日誌 -> KiDit 日誌本同步
  utils/
    dateUtils.js               # 台北時區日期工具 (getTaipeiTodayString 等)
    scheduleUtils.js           # 排程常數與工具 (FREQ_MAP, SHIFTS, getScheduleKey)
    backup.js                  # 資料庫備份

ecosystem.config.cjs           # PM2 設定 (production)
migrations/migrate.js          # DB 遷移腳本入口
dist/                          # Angular 前端建置產出 (`dist/browser` 由 Express serve)

angular-client/                 # ★ Angular 19 前端完整原始碼
  src/
    main.ts                    # Angular 入口
    app/
      app.routes.ts            # Angular 路由與權限守衛
      layouts/                 # 主佈局與側欄
      features/                # 各頁面功能模組
      components/              # 共用元件與 dialogs
      core/                    # services / guards / models / config
    constants/                 # 常數定義
    services/                  # 舊 Firebase/standalone 相容 API 通訊層
    utils/                     # 工具函數
```

## 架構重點

### 資料庫

- **連線模式**: 全域單例。`getDatabase()` 回傳共用的 better-sqlite3 實例，不需要也不應該呼叫 `db.close()`
- **better-sqlite3 是同步的**: `db.prepare().run/get/all()` 不需要 await
- **WAL mode**: 已啟用，支援並行讀取
- **JSON 欄位**: 大量 TEXT 欄位存 JSON (`dialysis_orders`, `schedule`, `patient_status` 等)，需 `JSON.parse()` / `JSON.stringify()`
- **migrate.js 例外**: 此檔案是獨立執行的腳本 (`npm run migrate`)，保留自己的 `new Database()` + `db.close()` 模式

### API 慣例

- **命名轉換**: DB 欄位用 `snake_case`，API 回應用 `camelCase`，轉換在 route handler 手動進行
- **ID 格式**: UUID v4 (`uuid` 套件)
- **錯誤回應**: `{ error: true, message: "..." }`
- **日期格式**: `YYYY-MM-DD` 字串，時區為台北 (Asia/Taipei)
- **RBAC 角色**: admin > editor > contributor > viewer

### 排程系統

- **總表** (`base_schedules`): 定義病人的固定排程規則 (頻率 + 床位 + 班別)
- **每日排程** (`schedules`): 由總表同步產生，可手動覆寫
- **調班** (`schedule_exceptions`): 類型有 MOVE / SUSPEND / ADD_SESSION / SWAP
- **同步引擎** (`scheduleSync.js`): 從總表產生未來 60 天排程，整合調班例外
- **班別**: `early` / `noon` / `late`
- **透析頻率**: 一三五 / 二四六 / 一四 / 二五 / 三六 等 (見 `FREQ_MAP_TO_DAY_INDEX`)

### 安全性

- **CORS**: 白名單模式，透過 `ALLOWED_ORIGINS` 環境變數設定
- **Rate Limiting**: 登入 20 次/15 分鐘，API 100 次/分鐘 (in-memory)
- **JWT_SECRET**: 從 `.env` 載入，生產環境未設定會 `process.exit(1)`
- **登入鎖定**: 失敗次數追蹤 (`failed_login_count`, `locked_until`)

## 前端架構重點

### 頁面總覽

| 類別 | 頁面 | 功能 |
|------|------|------|
| **排程核心** | ScheduleView | 每日排程 — 44 床 × 3 班，拖放排床 |
| | WeeklyView | 週排班表 — 7 天 × 3 班，側欄未排病人 |
| | BaseScheduleView | 門急住床位總表（長期固定規則） |
| | ExceptionManagerView | 調班管理 (MOVE/SUSPEND/ADD_SESSION/SWAP) |
| | UpdateSchedulerView | 預約變更（狀態/頻率/床位長期異動） |
| **護理作業** | MyPatientsView | 護理師每日病人清單，含備藥/通路/醫囑 |
| | StatsView | 護理分組檢視 (A-K 組) |
| | NursingScheduleView | 護理班表（Excel 匯入） |
| | CollaborationView | 訊息中心 — 交辦/留言/每日公告 |
| | DailyLogView | 工作日誌 — 各班統計/交班/跑馬燈 |
| **病人/臨床** | PatientsView | 病人管理 — CRUD/統計/匯出 |
| | OrdersView | 藥囑查詢與上傳 |
| | LabReportView | 檢驗報告查詢/警示/上傳 |
| | PatientMovementReportView | KiDit 申報工作站 |
| **管理** | PhysicianScheduleView | 醫師查房/會診/緊急班表 |
| | InventoryView | 庫存管理（人工腎臟/透析液等） |
| | UserManagementView | 使用者管理 (admin only) |
| | ReportingView | 統計報表（日/月/年） |

### 路由導航守衛

- **Auth 檢查**: 未登入 → `/login`
- **RBAC 路由**: `requiresAdmin: true` 頁面限 admin 存取
- **職稱導向**: 護理師/組長 → `/my-patients`；其他 → `/collaboration`
- **Viewer 限制**: 唯讀，僅能看排程/病人/日誌/協作

### 前端效能策略

- **Code Splitting**: 路由懶載入 `import()`，vendor/excel/schedule/patient/admin 分離 chunk
- **API 快取**: optimizedApiService 30 秒 TTL + pattern-based 失效
- **批次合併**: 50ms 佇列合併多個 API 請求
- **Angular Service 快取**: 病人資料全域快取，避免重複載入
- **防抖**: 儲存 10 秒、搜尋 300ms

### 前端關鍵元件

- **ScheduleTable**: 核心排程表格，拖放/色碼（門=綠/住=紅/急=紫）
- **BedAssignmentDialog**: 智慧排床演算法（自動推薦/手動/頻率篩選）
- **DialysisOrderModal**: 透析醫囑編輯（AK/透析液/抗凝/針劑/模式/頻率）
- **ExceptionCreateDialog**: 調班申請（MOVE/SUSPEND/ADD_SESSION/SWAP）
- **PatientFormModal / PatientDetailModal**: 病人新增/詳情
- **DailyStaffDisplay**: 每日醫師/專師顯示（依時段自動切換會診醫師）
- **NursingGroupConfigDialog**: 護理分組設定 (A-K 組 ↔ 床位映射)
- **KiDit 系列**: KiDitPatientForm / VascularAccessForm / MovementDetailModal

### 前端部署模式

- **開發**: `npm run standalone` — Vite dev server + proxy → Express:3000
- **Electron**: `npm run electron:dev` / `npm run dist` — Windows .exe 離線桌面版
- **生產**: 建置 `dist/` 複製到後端，由 Express 靜態 serve

## Angular 前端遷移計畫

醫院已完成前端遷移，現行主要前端為 Angular。相關歷史專案：

- `dialysis-app-angular` — Angular 19 + Firebase 原始雲端版 (67 commits)
- `dialysis-app-angular-standalone` — Angular 19 + 自帶 Express/SQLite（已從 Firebase 遷移 95%）
- `dialysis-app-tph` (本 repo) — 醫院正式後端 (PM2 部署, 107+ API endpoints)

### 遷移策略

**目標**: Angular standalone 前端 → 對接 TPH 後端（不使用 angular-standalone 自帶的 server/）

### API 對接狀態（2026-04-15 審計結果）

**已匹配 (~90%)**：分析 Angular 67 個 commits 後，大部分（~50 個）為純前端改動，TPH 後端已有 107+ 個 endpoint，覆蓋率遠高於原先預估的 60%。

**原先列為「缺少」但實際已存在的 endpoint**：
- `GET /api/patients/with-rules` → `patients.js:271`
- `GET/POST /api/patients/history` → `patients.js:312,383`
- `POST /api/orders/history/batch` → `orders.js:234`
- `GET/POST /api/orders/medications` → `orders.js:419,467`
- `GET /api/orders/medication-drafts` → `orders.js:595`
- `POST /api/orders/lab-reports/upload` → `orders.js:1079`
- `GET/PUT /api/orders/lab-alert-analyses` → `orders.js:812,856`
- `POST /api/schedules/sync/initialize` → `schedules.js:429`
- `POST /api/schedules/admin/force-resync` → `schedules.js:901`
- `GET /api/schedules/expired/:date` → `schedules.js:68`
- `GET /api/system/scheduled-updates` → `system.js:1568`
- `PATCH /api/system/notifications/:id/read` → `system.js:387`
- `GET/PUT /api/system/site-config/:id` → `system.js:1232,1265`
- `POST /api/nursing/schedules/upload` → `nursing.js:337`
- `GET/PATCH /api/system/kidit-logbook` → `nursing.js:1116,1152,1171`
- 庫存進階功能（進貨/月/週/耗材）→ `system.js:539-1148` 全部已有

### 真正需要補齊的後端改動（7 Phase）

#### Phase 1: Auth Token Refresh（高優先，0.5 天）
- **新增** `POST /api/auth/refresh-token`
- **修改檔案**: `src/routes/auth.js`, `src/middleware/auth.js`
- 接收已過期但在 grace period 內的 token，發新 JWT
- 新增 `verifyTokenForRefresh()` 函式
- **對應 Angular commit**: `3b8416d`

#### Phase 2: modeOverride 排程支援（高優先，1 天）
- **修改** 排程例外處理，支援 ADD_SESSION 帶入透析模式（如 HD→HDF）
- **修改檔案**: `src/services/exceptionHandler.js`, `src/services/scheduleSync.js`
- `handleAddSession()` (line 243): 讀 `data.to.mode` → 設 `newSlotData.modeOverride`
- `handleMove()`: 同樣傳遞 modeOverride
- 無需 schema migration（JSON text 欄位內加新 key）
- **對應 Angular commits**: `4422a89`, `7632b8c`, `2978a3d`, `1d64a68`, `2486a1e`

#### Phase 3: Auto-Assign 設定 API（中優先，0.5 天）
- **新增** `GET/PUT /api/system/auto-assign-config/current`
- **修改檔案**: `src/routes/system.js`
- 複用 `site_config` table，`id='auto_assign_config'`
- **對應 Angular commits**: `5cb116c`, `e28f29c`, `0ea5773`, `4e5509e`, `0990c93`, `b200414`

#### Phase 4: 設備設定 API（中優先，0.5 天）
- **新增** `GET/PUT /api/orders/bed-settings`
- **新增** `GET/PUT /api/orders/machine-bicarbonate-config`
- **修改檔案**: `src/routes/orders.js`
- 都是 `site_config` 的薄包裝

#### Phase 5: PATCH 路由別名（中優先，0.5 天）
- **新增** `PATCH /api/schedules/:date` → alias existing PUT
- **新增** `PATCH /api/schedules/nurse-assignments/:date` → alias existing PUT
- **新增** `PATCH /api/nursing/group-config/:id` → alias existing PUT
- **修改檔案**: `src/routes/schedules.js`, `src/routes/nursing.js`
- 把 PUT handler 抽成具名函式，同時掛載 PUT 和 PATCH

#### Phase 6: 病人照片上傳（低優先，0.5 天）
- **新增** `POST /api/patients/upload-image`
- **修改檔案**: `src/routes/patients.js`, `src/index.js`, `src/db/migrate.js`
- 存檔到 `data/patient-images/`，新增 `patients.image_path` 欄位

#### Phase 7: Config Key 別名（低優先，0.25 天）
- **新增** `GET/PUT /api/system/config/:key` → alias `site-config/:key`
- **修改檔案**: `src/routes/system.js`

### 實作優先順序

| Phase | 範圍 | 工時 | 修改檔案 | 狀態 |
|-------|------|------|----------|------|
| **1** | Auth token refresh | 0.5 天 | auth.js, middleware/auth.js | 待實作 |
| **2** | modeOverride | 1 天 | exceptionHandler.js, scheduleSync.js | 待實作 |
| **3** | Auto-assign config | 0.5 天 | system.js | 待實作 |
| **4** | Bed/machine config | 0.5 天 | orders.js | 待實作 |
| **5** | PATCH aliases | 0.5 天 | schedules.js, nursing.js | 待實作 |
| **6** | Patient image upload | 0.5 天 | patients.js, index.js, migrate.js | 待實作 |
| **7** | Config key alias | 0.25 天 | system.js | 待實作 |

**關鍵路徑**: Phase 1-3 完成後（~2 天），Angular 前端即可正常運作。Phase 4-7 逐步補齊。

### 不需後端改動的 Angular Commits（~50 個）

純前端改動，TPH 不需修改：ICU 列印排版(4)、KiDIT 重構(4)、Lab/Med 修復(6)、
角色/權限 UI(3)、UI/導航調整(4)、庫存 UI(~10)、報表圖表(1)、護理 UI(2)、文件(2)

### Angular 整合狀態（2026-04-16 完成）

Angular 前端已整合到本 repo 的 `angular-client/` 目錄，以下工作已完成：
- ✅ Firebase 殘留清理（shims, environment configs, firebase.service.ts）
- ✅ API 路由映射修正（COLLECTION_ROUTE_MAP 對齊 TPH 後端）
- ✅ Phase 1: Auth token refresh endpoint (`POST /api/auth/refresh-token`)
- ✅ Phase 2: modeOverride 排程支援（exceptionHandler.js handleMove/handleAddSession）
- ✅ Phase 3: Auto-assign config API (`GET/PUT /api/system/auto-assign-config/current`)
- ✅ Phase 4: Bed/machine settings API (`GET/PUT /api/orders/bed-settings`, `machine-bicarbonate-config`)
- ✅ Phase 5: PATCH→PUT middleware（schedules.js, nursing.js）
- ❌ Phase 6: Patient image upload — 已移除（前端孤兒元件未被使用，功能刪除）
- ✅ Phase 7: Config key alias (`GET/PUT /api/system/config/:key`)

### Angular 前端指令

```bash
npm run install:angular   # 安裝 Angular 前端依賴
npm run build:angular     # 建置 Angular 前端 → dist/
npm run dev:angular       # Angular 開發伺服器 (port 5173, proxy → Express:3000)
```

## 注意事項

- **Angular 前端原始碼**在 `angular-client/` 目錄
- `dist/` 是預建置產出，由 Express 靜態 serve
- `backup.js` 被 scheduler.js 和 system.js import，修改時保持 import 不變
- Windows 環境路徑使用反斜線 (`D:\\dialysis-app\\`)
- PM2 設定在 `ecosystem.config.cjs` (CommonJS，因為 PM2 不支援 ESM config)
- 資料庫檔案在 `data/dialysis.db`，已被 `.gitignore` 排除
- Angular 前端使用 `@/` 路徑別名指向 `angular-client/src/`
- PATCH 請求在 schedules.js 和 nursing.js 自動轉為 PUT
