# 專案架構說明 (Project Structure)

本文件詳細描述 `dialysis-app-standalone` 專案的所有檔案與目錄結構。

## 根目錄 (Root)

- `.agent/`: AI Agent 相關規則與 workflow 設定。
- `dist/`: 前端建置輸出目錄 (Build output)。
- `electron/`: (已不再做為主要執行方式/備用) Electron 主程序相關。
  - `main.cjs`: Electron 主程序入口。
  - `electron-builder.yml`: 打包設定檔。
- `public/`: 靜態資源與 PWA 設定。
  - `favicon.ico`: 網站圖示。
  - `icon_2048.png`: 原始高解析度應用程式圖示。
  - `icon-192x192.png`: PWA 圖示 (192x192)。
  - `icon-512x512.png`: PWA 圖示 (512x512)。
  - `apple-touch-icon.png`: iOS 裝置圖示 (180x180)。
  - `manifest.json`: PWA Web App Manifest 設定檔。
  - `sw.js`: Service Worker，提供離線支援與快取管理。
- `server/`: 後端伺服器原始碼 (詳見下方)。
- `src/`: 前端應用程式原始碼 (詳見下方)。
- `scripts/`: 輔助腳本。
- `README.md`: 專案介紹、開發與建置指令說明。
- `migrate.js`: 專案根目錄下的遷移腳本 (可能用於開發環境)。
- `package.json`: 專案相依套件與 npm scripts 指令設定 (`dev`, `electron:build` 等)。
- `vite.config.js`: Vite 設定檔 (包含代理伺服器、打包等設定)。
- `.env.electron`, `eslint.config.js`, `tsconfig.json`, `jsconfig.json`: 環境變數與各項開發工具組態設定檔。

---

## 後端結構 (server/src)

後端為 Node.js Express 應用程式，負責資料庫操作與 API 服務。

### `server/src/routes` (API 路由)

定義 RESTful API endpoints，處理 HTTP 請求並轉發給 Services。

- `auth.js`: 使用者登入、驗證、權限管理相關 API。
- `medications.js`: 藥品管理相關 API。
- `memos.js`: 備忘錄/記事相關 API。
- `nursing.js`: 護理紀錄、排班相關 API。
- `orders.js`: 醫囑 (Orders) 相關 API。
- `patients.js`: 病患資料管理 API (CRUD)。
- `schedules.js`: 透析排班管理 API。
- `system.js`: 系統設定、備份、日誌相關 API。

### `server/src/services` (業務邏輯)

封裝複雜的業務邏輯，被 Routes 或排程器呼叫。

- `exceptionHandler.js`: 處理系統異常或錯誤邏輯的服務。
- `kiditSync.js`: 與 KiDit (可能為外部系統或舊系統) 進行資料同步的服務。
- `scheduleSync.js`: 處理排班同步邏輯 (如 Google Calendar 或其他同步)。
- `scheduler.js`: 定時排程任務 (Cron Jobs)。

### `server/src/middleware` (中介軟體)

Express Middleware。

- `auth.js`: JWT 驗證 Middleware，用於保護 API 路由。

### `server/src/utils` (工具)

- `backup.js`: 資料庫備份工具腳本。

### `server/src/db` (資料庫)

- `init.js`: 初始化資料庫連線與表格。
- `migrate.js`: 資料庫遷移執行腳本。
- `schema.sql`: 定義資料庫 Schema (CREATE TABLE 語句)。

### 其他後端檔案

- `index.js`: 後端伺服器入口點 (Entry Point)。

---

## 前端結構 (src/)

前端為 Vue 3 應用程式。

### `src/views` (頁面組件)

對應 Vue Router 的路由頁面。

- `AboutView.vue`: 關於頁面。
- `AccountSettingsView.vue`: 帳號設定頁面。
- `BaseScheduleView.vue`: 基本排班/規則設定頁面。
- `CollaborationView.vue`: 協作/交班相關頁面。
- `ConsumablesView.vue`: 耗材管理頁面。
- `DailyLogView.vue`: 每日日誌/透析摘要頁面。
- `DraftOrdersView.vue`: 擬定醫囑/草稿頁面。
- `ExceptionManagerView.vue`: 異常管理頁面。
- `HomeView.vue`: 首頁。
- `InventoryView.vue`: 庫存管理頁面。
- `LabReportView.vue`: 檢驗報告頁面。
- `LoginView.vue`: 登入頁面。
- `MyPatientsView.vue`: 我的病患列表頁面。
- `NursingScheduleView.vue`: 護理排班檢視頁面。
- `OrdersView.vue`: 醫囑總覽頁面。
- `PatientMovementReportView.vue`: 病患異動報表頁面。
- `PatientsView.vue`: 病患管理總表頁面。
- `PhysicianScheduleView.vue`: 醫師排班檢視頁面。
- `ReportingView.vue`: 報表/統計中心頁面。
- `ScheduleView.vue`: 透析排班主畫面 (床位圖)。
- `StatsView.vue`: 統計資訊頁面。
- `UpdateSchedulerView.vue`: 更新排程檢視頁面。
- `UsageGuideView.vue`: 使用指南頁面。
- `UserManagementView.vue`: 使用者管理 (Admin) 頁面。
- `WeeklyView.vue`: 週排程檢視頁面。

### `src/components` (共用組件)

UI 介面元件。

- `AlertDialog.vue`: 警告對話框。
- `BedAssignmentDialog.vue`: 床位分配對話框。
- `BedChangeDialog.vue`: 換床對話框。
- `CRRTOrderModal.vue`: CRRT 醫囑開立模態框。
- `ConditionRecordDisplayDialog.vue`: 病情紀錄顯示對話框。
- `ConditionRecordPanel.vue`: 病情紀錄輸入/顯示面板。
- `ConfirmDialog.vue`: 確認操作對話框。
- `DailyDraftListDialog.vue`: 每日草稿列表對話框。
- `DailyInjectionListDialog.vue`: 每日針劑列表對話框。
- `DailyRecordsSummaryDialog.vue`: 每日紀錄摘要對話框。
- `DailyStaffDisplay.vue`: 每日人力顯示組件。
- `DialysisOrderModal.vue`: 透析醫囑開立模態框。
- `ExceptionCreateDialog.vue`: 新增異常紀錄對話框。
- `HandoverNotesDialog.vue`: 交班記事對話框。
- `HolidayManager.vue`: 假日管理組件。
- `IcuOrdersDialog.vue`: ICU 醫囑相關對話框。
- `InpatientRoundsDialog.vue`: 住院查房對話框。
- `InpatientSidebar.vue`: 住院/透析側邊欄組件。
- `LabAlertDetailModal.vue`: 檢驗異常詳細資訊模態框。
- `LabMedCorrelationView.vue`: 檢驗數值與藥物關聯檢視組件。
- `MarqueeBanner.vue`: 跑馬燈訊息組件。
- `MarqueeEditDialog.vue`: 編輯跑馬燈對話框。
- `MemoDisplayDialog.vue`: 備忘錄顯示對話框。
- `MemoPanel.vue`: 備忘錄面板。
- `MonthYearPicker.vue`: 月份/年份選擇器。
- `NewUpdateTypeDialog.vue`: 新增更新類型對話框。
- `NursingGroupConfigDialog.vue`: 護理分組設定對話框。
- `PatientActionModal.vue`: 病患操作選單模態框。
- `PatientDetailModal.vue`: 病患詳細資料模態框 (核心組件)。
- `PatientFormModal.vue`: 新增/編輯病患表單模態框。
- `PatientHistoryModal.vue`: 病患歷史紀錄模態框。
- `PatientImageUploader.vue`: 病患照片上傳組件。
- `PatientLabSummaryModal.vue`: 病患檢驗摘要模態框。
- `PatientLabSummaryPanel.vue`: 病患檢驗摘要面板。
- `PatientMessagesIcon.vue`: 病患訊息圖示組件。
- `PatientSelectDialog.vue`: 病患選擇對話框。
- `PatientUpdateSchedulerDialog.vue`: 病患更新排程對話框。
- `PreparationPopover.vue`: 備藥/準備事項提示框。
- `ScheduleTable.vue`: 排班表格組件。
- `SelectionDialog.vue`: 通用選擇對話框。
- `StatsToolbar.vue`: 統計頁面工具列。
- `SystemDiagnostic.vue`: 系統診斷資訊組件。
- `TaskCreateDialog.vue`: 建立任務對話框。
- `UserFormModal.vue`: 使用者表單模態框。
- `WardNumberBadge.vue`: 病房號碼標記。
- `WardNumberDialog.vue`: 病房號碼設定對話框。
- **`icons/`**: 圖示組件 (`IconCommunity`, `IconDocumentation`, `IconEcosystem`, `IconSupport`, `IconTooling`)。
- **`kidit/`**: KiDit 相關組件 (`KiDitHistoryForm`, `KiDitPatientForm`, `MovementDetailModal`, `VascularAccessForm`)。

### `src/stores` (Pinia 狀態管理)

- `archiveStore.ts`: 封存資料/歷史紀錄的狀態管理。
- `medicationStore.ts`: 藥品資料狀態管理。
- `patientStore.ts`: 病患資料及其排班狀態管理 (核心 Store)。
- `taskStore.ts`: 任務/待辦事項狀態管理。

### `src/services` (API Services)

前端呼叫後端 API 的封裝層。

- `localApiClient.ts`: 主要的後端 API 客戶端 (封裝 axios 或 fetch)。
- `LocalApiManager.ts`: 管理本地 API 連線的類別。
- `optimizedApiService.js`: 優化過的特定 API 服務。
- `api_manager.ts`: 基礎 API 管理器。
- `baseScheduleService.js`: 基礎排班服務。
- `kiditExportService.js`, `kiditService.js`: KiDit 匯出與整合服務。
- `mockFirestore.ts`, `useStandaloneFirestore.ts`: 模擬 Firestore 或從 Firestore 遷移的過渡服務。
- `nurseAssignmentsService.js`: 護理師分配服務。
- `nursingDutyService.js`: 護理排班/職務服務。
- `nursingGroupConfigService.js`: 護理分組設定服務。
- `scheduleService.js`: 排班核心邏輯服務。

### `src/composables` (Vue Composables)

可複用的 Vue 邏輯 (Hooks)。

- `useAuth.ts`: 舊版/通用認證邏輯。
- `useAuthStandalone.ts`: 單機版專用的認證邏輯。
- `useBreakpoints.js`: 合應式斷點偵測。
- `useCache.js`: 快取邏輯。
- `useErrorHandler.js`: 全域錯誤處理邏輯。
- `useFirebase.ts`: Firebase 相關邏輯 (可能已棄用或用於遷移)。
- `useGlobalNotifier.js`: 全域通知/Toast 邏輯。
- `useGroupAssigner.js`: 護理分組分配邏輯。
- `useMyPatientList.js`: "我的病患" 列表篩選邏輯。
- `useNurseGroupSync.js`: 護理分組同步邏輯。
- `useRealtimeNotifications.js`: 即時通知邏輯。
- `useScheduleAnalysis.js`: 排班分析邏輯。
- `useTeamAssigner.js`: 團隊分配邏輯。
- `useUserDirectory.js`: 使用者目錄邏輯。

### `src/utils` (工具函式)

前端通用工具。

- `appMode.ts`: 應用程式模式判斷。
- `dateUtils.js`: 日期時間處理 (格式化、計算)。
- `kiditHelpers.js`: KiDit 相關輔助函式。
- `medicationUtils.js`: 藥物資料處理輔助函式。
- `sanitize.js`: 資料清理/XSS 防護工具。
- `scheduleUtils.js`: 排班計算與處理輔助函式。
- `taskHandlers.js`: 任務處理輔助函式。

### `src/layouts` (佈局)

- `MainLayout.vue`: 應用程式主要佈局框架 (含導覽列、Sidebar 等)。

### `src/router` (路由)

- `index.ts`: Vue Router 設定，定義所有路由路徑與對應的 View。

### 其他前端檔案

- `App.vue`: 根元件。
- `main.ts`: 程式入口。
- `env.d.ts`: TypeScript 型別定義。
- `assets/`: 靜態圖片與樣式。
