# 深度架構參考

CLAUDE.md 放的是不變式與陷阱；本檔放子系統細節。**動到哪個子系統才讀哪一節**，不用整檔讀完。

## 檔案規模地圖（決定要不要派 subagent 讀）

| 檔案 | 行數 | 備註 |
|------|------|------|
| `src/routes/orders.js` | ~2100 | 醫囑歷史、Excel 匯入、檢驗報告、設備設定 |
| `src/routes/system.js` | ~2100 | 任務/通知/庫存/醫師/配置/預約變更/備份 |
| `src/routes/schedules.js` | ~2000 | 每日排程、總表、調班、護理分配 |
| `src/routes/patients.js` | ~1600 | 病人 CRUD、軟刪除、狀態流轉、歷史 |
| `src/routes/nursing.js` | ~1450 | 護理排班、交班、工作日誌、KiDit 日誌本 |
| `src/routes/auth.js` | ~1000 | 登入/登出/使用者 CRUD/refresh-token |
| `src/services/scheduler.js` | ~860 | node-cron 全部定時任務 |
| `src/services/scheduleSync.js` | ~770 | 總表→60 天排程同步引擎 |

超過 ~800 行的檔案，主對話不要整檔 Read：先 Grep 找目標函式，只讀該區段；要全面理解就派 Explore agent（見 `docs/claude/delegation.md`）。

## 排程系統

- **總表**（`base_schedules`）：病人的固定排程規則（頻率 + 床位 + 班別）。
- **每日排程**（`schedules`）：由總表同步產生，可手動覆寫。
- **同步引擎**（`scheduleSync.js`）：從總表產生未來 60 天排程，整合調班例外。
- **調班**（`schedule_exceptions`）：MOVE / SUSPEND / ADD_SESSION / SWAP 四種，由 `exceptionHandler.js` 處理。
- **調班整併**（`exceptionReconcile.js`）：「隔日換床」的單日 MOVE — 同病人同日多次調動只保留一筆（from 錨定常規原位、to 為最新位置；拖回原位即取消），鏡像對（甲↔乙互換）收斂成一筆 SWAP。
- **班別**：`early` / `noon` / `late`。
- **頻率**：一三五 / 二四六 / 一四 / 二五 / 三六 等，對應表在 `scheduleUtils.js` 的 `FREQ_MAP_TO_DAY_INDEX`，不要 hardcode。
- **床位 key**：一律用 `getScheduleKey()` 產生，不要手動拼接。
- **modeOverride**：ADD_SESSION / MOVE 可帶臨時透析模式（如 HD→HDF），存在 schedule JSON slot 內的 `modeOverride` key，無獨立欄位。

## 工作日誌 / KiDit / 病人歷史 同步鏈路

病人異動會寫入「工作日誌病人動態」（`daily_logs.patient_movements`），並連動 KiDit 日誌本與病人歷史。

- **鏈路**：病人操作 → `addAutoMovementToDailyLog` / `addMovementToDailyLog`（`dailyLogMovementSync.js`，寫工作日誌動態）→ `syncEventsToKiditLogbook`（`kiditSync.js`，連動 KiDit）。歷史另由 `patientHistory.js` 的 `recordPatientHistory` 寫入。
- **即時操作**（`routes/patients.js`）：新增/刪除/復原/狀態轉移/更改模式 → 即時產生動態 + 歷史。**純改頻率/床位不寫工作日誌**（屬排程規則，不是病人動態）。
- **預約變更生效**（`scheduler.js` 的 `applyScheduledPatientUpdates`，每日 01:00）：`UPDATE_STATUS` / `UPDATE_MODE` / `DELETE_PATIENT` / `RESTORE_PATIENT` 套用時比照即時操作同步工作日誌 + KiDit + 歷史（同步包在 try/catch，失敗不影響任務）。`UPDATE_FREQ` / `UPDATE_BASE_SCHEDULE_RULE` 不寫工作日誌。**歷史只在生效日套用當下寫，預約建立時不寫。**
- **調班**：`ADD_SESSION`（臨時加洗）經 `addAutoMovementToDailyLog` 寫動態（type `臨時加洗`），取消時由 `removeAutoMovementFromDailyLog` 移除；其餘調班類型不寫病人動態。
- **⚠️ 刻意決策 — 「更改模式」不進 KiDit**：由 `kiditSync.js` 的 `KIDIT_EXCLUDED_MOVEMENT_TYPES = Set(['更改模式', '勿動'])`（kiditSync.js:10）過濾，同時影響即時與預約兩條路徑。原因：KiDit 是入院/出院/轉床異動申報，模式變更非申報項目；動態仍留在工作日誌。**勿誤改回。**

## 透析模式正規化

`dialysis_orders.mode` 是自由文字（無 enum）。標準值 = `['HD','SLED','CVVHDF','PP','DFPP','Lipid']`（對齊前端 `patient-form-modal` 的 MODES）。

- 共用 helper：`utils/dialysisMode.js` — `normalizeDialysisMode`（`SLEDD`/`SLEDF`→`SLED`、大小寫不敏感、去空白、未知值保留原樣）與 `normalizeDialysisOrdersMode`。
- 套用於所有寫 mode 的後端路徑：`patients.js toDbFormat`、`orders.js POST /history`、`scheduler.js UPDATE_*`。新增會寫 mode 的路徑時必須套用同一 helper。
- **⚠️ 使用者口語的「SLEDD」在資料庫實際存為 `SLED`**（單一 D）。查資料時用 `SLED`。

## 2026-05 之後新增的子系統（原 CLAUDE.md 未收錄）

- **AKI Map**（`routes/aki.js` + `services/akiService.js`）：全院 AKI 地圖，專師專用。資料來源是 HIS 匯出的兩份 Excel。
- **床邊智慧儀表板**（`routes/dashboard.js` + `dashboardDataService.js` / `dashboardPinService.js`）：路由 `/bed-dashboard/:bedKey`，床位 PIN 登入（`POST /api/dashboard/bed-login`、`GET /api/dashboard/bed/:bedKey`），30 秒自動刷新，非當班病人姓名去識別化（`麥O珍`）。
- **SSE 即時通知**（`routes/events.js` + `services/eventBus.js`）：排程例外變更推播。EventSource 不支援自訂 header，改用 `?token=<JWT>` query 驗證。eventBus 是純記憶體單進程 — **若改 PM2 cluster 模式會壞**，需換 Redis pub/sub。
- **護理分組歷史快照**（`services/nurseAssignmentRevisions.js`）：每小時 cron 快照。
- **每日應打針劑**（`services/dailyInjectionService.js`）：Q{N}W 週數用日曆週（週日起算）計算。

## 前端（Angular 19，`angular-client/`）

### 頁面總覽

| 類別 | 頁面 | 功能 |
|------|------|------|
| 排程核心 | ScheduleView | 每日排程 — 44 床 × 3 班，拖放排床 |
| | WeeklyView | 週排班表 — 7 天 × 3 班，側欄未排病人 |
| | BaseScheduleView | 門急住床位總表（長期固定規則） |
| | ExceptionManagerView | 調班管理（MOVE/SUSPEND/ADD_SESSION/SWAP） |
| | UpdateSchedulerView | 預約變更（狀態/床位長期異動） |
| 護理作業 | MyPatientsView | 護理師每日病人清單，含備藥/通路/醫囑 |
| | StatsView | 護理分組檢視（A–K 組） |
| | NursingScheduleView | 護理班表（Excel 匯入） |
| | CollaborationView | 訊息中心 — 交辦/留言/每日公告 |
| | DailyLogView | 工作日誌 — 各班統計/交班/跑馬燈 |
| 病人/臨床 | PatientsView | 病人管理 — CRUD/統計/匯出 |
| | OrdersView | 藥囑查詢與上傳 |
| | LabReportView | 檢驗報告查詢/警示/上傳 |
| | PatientMovementReportView | KiDit 申報工作站 |
| 管理 | PhysicianScheduleView | 醫師查房/會診/緊急班表 |
| | InventoryView | 庫存管理（人工腎臟/透析液等） |
| | UserManagementView | 使用者管理（admin only） |
| | ReportingView | 統計報表（日/月/年） |

### 路由守衛與角色

- 未登入 → `/login`；權限守衛用 `canActivate: [roleGuard]` + `data: { roles: PAGE_ACCESS.<頁>.roles }`（`core/guards/role.guard.ts` + `core/config/page-access.ts`），沒有 `requiresAdmin` 這種欄位。
- 職稱導向：護理師/組長 → `/my-patients`；其他 → `/collaboration`。
- Viewer 唯讀，僅能看排程/病人/日誌/協作。

### 關鍵元件

- **ScheduleTable**：核心排程表格，拖放/色碼（門=綠/住=紅/急=紫）。
- **BedAssignmentDialog**：智慧排床（自動推薦/手動/頻率篩選）。
- **DialysisOrderModal**：透析醫囑編輯（AK/透析液/抗凝/針劑/模式/頻率）。
- **ExceptionCreateDialog**：調班申請。
- **PatientFormModal / PatientDetailModal**：病人新增/詳情。
- **DailyStaffDisplay**：每日醫師/專師顯示（依時段切換會診醫師）。
- **NursingGroupConfigDialog**：護理分組設定（A–K 組 ↔ 床位映射）。
- **KiDit 系列**：KiDitPatientForm / VascularAccessForm / MovementDetailModal。

### 前端效能策略

- 路由懶載入 `import()`；vendor/excel/schedule/patient/admin 分離 chunk。
- optimizedApiService：30 秒 TTL 快取 + pattern-based 失效；50ms 佇列合併批次請求。
- 防抖：儲存 10 秒、搜尋 300ms。
- `@/` 路徑別名指向 `angular-client/src/`。

### 前端效能優化接續計畫（2026-08-11 基準）

**第一階段已完成**（commit `87f9039`）：XLSX、jsPDF、html2canvas 改為操作時才 dynamic import；Quill CSS 移出全域首包；5 個低風險元件改用 OnPush；主要網路輪詢在 `document.hidden` 時暫停。Production build 與 `npm run smoke:tph-angular`（69/69）通過。

量測基準（`npm run build:angular`）：initial 由 525.24 kB 降至 501.00 kB（傳輸估計 137.67 → 134.68 kB）；全域 CSS 88.70 → 64.47 kB；daily-log chunk 543.23 → 156.13 kB（傳輸估計 136.36 → 27.26 kB）。XLSX/PDF/Canvas 現為獨立 lazy chunks；CommonJS 警告仍存在但不再阻塞首屏。

**第二階段（下一優先）**：

1. 拆分大型頁面容器：依序處理 `schedule`（TS 約 121 kB）、`stats`、`patients`、`inventory`、`my-patients`，分離 toolbar/table/dialog 與資料存取責任。
2. 排程表建立預先計算的 cell view model；template 不得在床位 × 班別熱路徑重複呼叫 `getPatientCellStyle`、`getPatientMode`、`getPatientWardNumber`、`getCombinedNote` 等方法。
3. 大型 dialog/次要區塊採 `@defer` 或動態建立，避免進入 route 時一併解析未開啟的 dialog。
4. 將 polling、SSE 與 API refresh 收斂到單一 store；加入 in-flight request deduplication，SSE 為主、低頻 polling 只作容錯，並避免上一個請求未完成時重送。

**第三階段（第二階段穩定後）**：

1. 漸進啟用 TypeScript/Angular strict：新程式先禁新增 `any`，再依序處理 `noImplicitReturns`、`strictNullChecks`、`strictTemplates`；不得一次全開後大量 `$any()` 掩蓋問題。
2. 建立 bundle regression gate：initial budget 維持 500 kB 並逐步下修；處理目前超過 16 kB 的 component CSS，而不是提高 budget。
3. 建立瀏覽器效能基準（Lighthouse/Performance）：記錄登入後首頁、schedule、daily-log 的 LCP、INP、長任務與 API 次數，優化前後用相同資料與裝置比較。
4. 對大型病人/報表清單評估 CDK virtual scroll 或分頁；只有實測 DOM 數量與捲動成本達瓶頸才導入。

每一階段完成條件：`npm run build:angular`、`npm run smoke:tph-angular`、手動驗證 Excel 匯出／Daily Log PDF／跑馬燈編輯器，並記錄修改前後 chunk 數據。純前端 build 不需重啟 PM2。

## 部署

- **Angular 正式環境**：本 repo `D:\dialysis-app-angular\`，PM2 程序 `dialysis-server-angular`，port 3000，Express 直接服務本 repo 的 `dist/browser`。`D:\dialysis-app\` 是舊 Vue 站（PM2 `dialysis-server`，port 3001），不得拿來部署 Angular 修改。
- **前端建置**：`npm run build:angular` → `dist/browser`；純 `.ts/.html/.css` 修改 build 後即可由正式 Express 提供，**不需重啟 PM2**。以 `/` 回傳的 `main-*.js` hash 核對是否為最新 build。
- **後端部署**：修改 `src/**` 才執行 `pm2 restart dialysis-server-angular --update-env`，之後檢查 `pm2 list` 與 `http://localhost:3000/api/health`。
- **隔離開發驗證**：worktree `D:\dialysis-app-angular-dev\`、branch `dev`、port 3002、測試 DB；smoke test 必須設定 `PORT` 與 `SMOKE_BASE_URL` 指向 dev，不得對正式 3000 執行寫入型驗證。
- **一般開發**：`npm run dev`（後端 watch）+ `npm run dev:angular`（port 5173，proxy → Express:3000）。
- **備份**：`npm run backup` 手動；scheduler.js cron 自動。WAL mode 注意事項見 `.claude/skills/db-backup.md`。
