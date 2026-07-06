# 透析排程系統 (dialysis-app-tph)

台北醫院血液透析中心管理平台（醫院正式上線系統，錯誤直接影響臨床排程）。全功能透析排程、病人管理、護理與醫囑系統。

## 技術棧

- **Backend**: Node.js ESM + Express.js；SQLite via better-sqlite3（同步 API，全域單例連線）
- **Auth**: JWT + bcryptjs，Token 黑名單 + 單一裝置 Session
- **Frontend**: Angular 19（原始碼在 `angular-client/`，建置產出 `dist/browser` 由 Express 靜態 serve）
- **排程任務**: node-cron；**部署**: 院內 Windows VM + PM2（`ecosystem.config.cjs`）

## 常用指令

```bash
npm start                     # 啟動伺服器（port 3000）
npm run dev                   # 開發模式 (--watch)
npm run migrate               # 資料庫遷移（獨立腳本）
npm run init-db               # 初始化資料庫 + 預設管理員
npm run backup                # 手動備份資料庫
npm run build:angular         # 建置 Angular 前端 → dist/
npm run dev:angular           # 前端 dev server (5173, proxy → 3000)

# 驗證（改後端必跑，詳見 docs/claude/judgment.md 的完成定義）
node --check src/<改過的檔>.js   # 語法檢查，最低門檻
npm run smoke:tph-angular        # 端到端 smoke test（自建 server 打 API）
```

## 專案結構

```
src/
  index.js                   # Express 入口：CORS、路由掛載、graceful shutdown
  db/init.js                 # DB 全域單例 (getDatabase)；schema.sql (25+ 表)；migrate.js (獨立腳本)
  middleware/                # auth.js (JWT+RBAC+稽核)、rateLimit.js、validate.js
  routes/
    auth.js                  # 登入/登出/使用者 CRUD/refresh-token
    patients.js              # 病人 CRUD、軟刪除/復原、狀態流轉 (opd/ipd/er)
    schedules.js             # 每日排程、總表 (base_schedules)、調班、護理分配
    orders.js                # 透析醫囑歷史、Excel 匯入、檢驗報告、設備設定
    medications.js           # 用藥管理、每日應打針劑
    nursing.js               # 護理排班/交班/工作日誌/KiDit 日誌本
    system.js                # 任務/通知/庫存/醫師/配置/預約變更/備份
    memos.js                 # 備忘錄
    aki.js                   # 全院 AKI Map（專師專用，HIS Excel 匯入）
    dashboard.js             # 床邊智慧儀表板（PIN 登入）
    events.js                # SSE 排程例外即時通知 (?token= 驗證)
  services/
    scheduler.js             # node-cron 定時任務（歸檔/備份/清理/預約變更套用）
    scheduleSync.js          # 總表 → 未來 60 天排程同步引擎
    exceptionHandler.js      # 調班處理 (MOVE/SUSPEND/ADD_SESSION/SWAP)
    exceptionReconcile.js    # 單日 MOVE 整併、鏡像對收斂成 SWAP
    kiditSync.js             # 工作日誌 → KiDit 日誌本同步
    dailyLogMovementSync.js  # 病人動態 → 工作日誌 + 連動 KiDit
    patientHistory.js        # 病人歷史/快照
    dailyInjectionService.js # Q{N}W 針劑計算（日曆週，週日起算）
    akiService.js / dashboardDataService.js / dashboardPinService.js
    eventBus.js              # 記憶體事件匯流排（單進程限定）
    nurseAssignmentRevisions.js  # 護理分組每小時快照
  utils/                     # dateUtils(台北時區)、scheduleUtils(FREQ_MAP/getScheduleKey)、
                             # dialysisMode(模式正規化)、backup
angular-client/              # Angular 19 前端原始碼（頁面清單見 docs/claude/architecture.md）
```

## 不變式（違反即是 bug）

- **DB 單例**：一律 `getDatabase()`，不要 `new Database()`、不要 `db.close()`。唯一例外 `migrate.js`（獨立腳本自管連線）。
- **better-sqlite3 是同步的**：`db.prepare().run/get/all()` 不加 await；SQL 一律參數化（`?`）；大量寫入包 `db.transaction()`。
- **命名轉換**：DB 欄位 `snake_case`，API 回應 `camelCase`，在 route handler 手動轉。
- **錯誤回應**：`{ error: true, message: "..." }`；ID 用 UUID v4。
- **日期**：`YYYY-MM-DD` 字串、台北時區，一律用 `utils/dateUtils.js`，不要自己 new Date 算日期。
- **RBAC**：admin > editor > contributor > viewer；敏感端點必掛權限 middleware。
- **排程常數**：班別 `early/noon/late`；頻率查 `FREQ_MAP_TO_DAY_INDEX`；床位 key 用 `getScheduleKey()`，都不 hardcode。
- **ESM**：後端全 `import/export`；`__dirname` 用 `fileURLToPath(import.meta.url)`；只有 `ecosystem.config.cjs` 是 CommonJS。
- **Windows 相容**：路徑用 `path.join()`；生產部署目錄 `D:\dialysis-app\`。

## ⚠️ 陷阱（前人踩過，勿再踩）

1. **「更改模式」不進 KiDit 是刻意決策**：`kiditSync.js` 的 `KIDIT_EXCLUDED_MOVEMENT_TYPES = Set(['更改模式'])`，同時管即時與預約兩條路徑。勿誤改回。
2. **資料庫裡是 `SLED` 不是 `SLEDD`**：透析模式經 `utils/dialysisMode.js` 正規化（`SLEDD/SLEDF→SLED`）。任何新寫 mode 的路徑都要套 `normalizeDialysisMode`。
3. **純改頻率/床位不寫工作日誌**：那是排程規則，不是病人動態。完整同步規則見 `docs/claude/architecture.md`「同步鏈路」節。
4. **eventBus 是單進程記憶體實作**：PM2 改 cluster 模式會壞，需先換 Redis pub/sub。
5. **`backup.js` 被 scheduler.js 和 system.js import**：修改時保持既有 export 不變。
6. **PATCH 在 schedules.js / nursing.js 自動轉 PUT**：不要另寫 PATCH handler。
7. **`data/dialysis.db` 已 gitignore**；`dist/` 是建置產出，改前端要改 `angular-client/` 原始碼再 build。

## 工作方式（每個 session 適用）

- **大量讀檔/掃 repo/查網頁/批次改檔 → 派 subagent**，主對話只收結論與 `檔案:行號`。超過 ~800 行的檔案不要整檔 Read（規模地圖見 `docs/claude/architecture.md`）。派工規則與模板：`docs/claude/delegation.md`、`docs/claude/prompt-templates.md`。
- **改動後端必須驗證才能說完成**：最低 `node --check`，行為改動跑 `npm run smoke:tph-angular`，驗收派 fresh-context `verifier` agent。完成定義：`docs/claude/judgment.md`。
- **卡住、要不要問使用者、要不要換方法**：先查 `docs/claude/judgment.md` 的判準再決定。
- **要改 CLAUDE.md 或 docs/claude/ 制度檔**：先讀 `docs/claude/maintenance.md`。

## 文件路由表（需要時才讀）

| 檔案 | 何時讀 |
|------|--------|
| `docs/claude/architecture.md` | 動排程同步/KiDit/模式正規化/前端頁面/部署前 |
| `docs/claude/delegation.md` | 要派 subagent、選 model 前 |
| `docs/claude/judgment.md` | 判斷完成/升級/問使用者/換路時 |
| `docs/claude/prompt-templates.md` | 派工時複製填空 |
| `docs/claude/maintenance.md` | 想更新任何制度檔前 |
| `docs/claude/letter.md` | 新接手這個環境時讀一次 |
| `docs/2026-05-08-follow-up-todos.md` | 動預約變更/UpdateScheduler 前（使用者未實作需求清單） |
| `docs/*-handoff.md`、`CHANGES-*.md`、`HANDOFF-CHANGES.md` | 考古某功能的決策脈絡時 |
| `.claude/skills/deploy.md`、`DEPLOYMENT.md`、`GO-LIVE-CHECKLIST.md` | 部署相關工作前 |
| `.claude/skills/db-backup.md` | 動備份/資料庫檔案前 |
| `.claude/skills/code-review.md` | 審查後端 diff 時（本專案專屬 checklist） |
| `docs/claude/archive/` | 史料（遷移計畫等），平時不讀 |

> AGENTS.md 只是指向本檔的路標，不要在那裡加內容。
