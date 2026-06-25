# 透析管理平台後端優化計畫書

**版本**: v1.0  
**日期**: 2026-04-01  
**適用範圍**: dialysis-app-tph 後端（Node.js + Express + SQLite）  
**目標讀者**: 開發團隊

---

## Context

此專案是透析排程管理系統，從 Vue + Firebase 遷移至院內 Windows 虛擬主機。目前 repo **只有後端程式碼**（Node.js + Express + SQLite），前端 Vue 3 + Vuetify 原始碼不在此 repo。

**注意**：資料庫實際是 **SQLite**（better-sqlite3），非 MySQL。

---

## 一、現況總覽

| 項目 | 數值 |
|------|------|
| 總程式碼 | ~11,274 行 JS |
| 路由檔案 | 8 個（8,195 行），其中 orders.js 1,865 行、system.js 1,836 行 |
| 服務 | 4 個（2,028 行） |
| 中介軟體 | 3 個（597 行） |
| 資料表 | 25+ 張（schema.sql 621 行） |
| 測試覆蓋率 | 0% |

**做得好的地方（保持不變）**：
- B 級資安合規：帳號鎖定、稽核日誌、Token 黑名單、單一裝置登入
- SQLite WAL 模式 + busy_timeout
- Graceful shutdown
- 完整的 Linux/Windows 部署文件
- Firebase 遷移工具、自動備份機制

---

## 二、短期優化（第 1-2 週）：快速修復與安全加固

### 2.1 [P0] 安全加固：helmet 中介軟體

- **問題**: `src/index.js` 沒有設定安全 HTTP headers
- **修改**: 安裝 `helmet`，在 CORS 之後加入 `app.use(helmet())`
- **檔案**: `package.json`, `src/index.js`
- **風險**: 低。CSP 可能需要根據前端調整

### 2.2 [P0] Rate Limit Map 加上上限保護

- **問題**: `src/middleware/rateLimit.js` 的 Map 無 size 上限，可被 DDoS 耗盡記憶體
- **修改**: Map.size 超過 10,000 時強制清理最舊記錄
- **檔案**: `src/middleware/rateLimit.js`
- **風險**: 極低

### 2.3 [P0] 強制首次登入修改預設密碼

- **問題**: `src/db/init.js:83` 硬編碼密碼 `admin123`，無強制修改機制
- **修改**: users 表新增 `must_change_password` 欄位，登入回應增加旗標
- **檔案**: `src/db/schema.sql`, `src/db/migrate.js`, `src/db/init.js`, `src/routes/auth.js`
- **風險**: 低。需前端配合，後端可先回傳旗標

### 2.4 [P1] 建立 .env.example

- **修改**: 列出所有環境變數及說明（PORT, NODE_ENV, JWT_SECRET, DB_PATH, BACKUP_DIR, STATIC_PATH, ALLOWED_ORIGINS）
- **檔案**: 新增 `.env.example`
- **風險**: 無

### 2.5 [P1] 統一錯誤回應格式

- **問題**: 大部分用 `{ error: true, message }`，但 `exceptionHandler.js` 用 `{ success: false }`
- **修改**: 新增 `src/utils/response.js` 統一 helper，修正不一致處
- **檔案**: 新增 `src/utils/response.js`, `src/services/exceptionHandler.js`
- **風險**: 極低

### 2.6 [P1] 清理 Firebase 殘留註解

- **檔案**: `src/services/scheduler.js`, `src/routes/orders.js`, `src/routes/medications.js`, `src/routes/nursing.js`
- **風險**: 無

### 2.7 [P2] 改善開發環境 JWT 安全性

- **問題**: `src/middleware/auth.js:11` 非 production 使用硬編碼預設密鑰
- **修改**: 開發環境啟動時以 console.warn 發出警告，或自動產生隨機密鑰
- **檔案**: `src/middleware/auth.js`
- **風險**: 低

---

## 三、中期優化（第 2-4 週）：架構改善與測試建立

### 3.1 [P0] 路由層拆分與 Service 分層

**這是最大的技術債。**

**第一批：system.js (1,836 行, 35 端點) 拆分為 5 個路由檔**

| 新檔案 | 原端點 | 估計行數 |
|--------|--------|---------|
| `routes/tasks.js` | /tasks CRUD | ~240 行 |
| `routes/inventory.js` | /inventory/** | ~650 行 |
| `routes/notifications.js` | /notifications | ~110 行 |
| `routes/physicians.js` | /physicians, /physician-schedules | ~200 行 |
| `routes/system.js`（保留） | /health, /site-config, /audit-logs, /backup | ~460 行 |

**第二批：orders.js (1,865 行, 24 端點) 拆分**

| 新檔案 | 原端點 | 估計行數 |
|--------|--------|---------|
| `routes/orders.js`（精簡） | /history CRUD | ~300 行 |
| `routes/lab-reports.js` | /lab-reports, /lab-alert-analyses | ~500 行 |
| `routes/consumables.js` | /consumables | ~250 行 |
| `routes/condition-records.js` | /condition-records | ~200 行 |

**第三批：抽取 Service 層**
- `services/taskService.js`, `services/inventoryService.js`, `services/labReportService.js`, `services/scheduleService.js`

**風險**: 中。需確保 API 路徑不變，前端不需修改。

### 3.2 [P0] 建立測試基礎設施

- **框架**: `vitest` + `supertest`
- **優先**: 整合測試（auth、patients、schedules）
- **新增**: `tests/helpers/setup.js`, `tests/helpers/auth.js`, `tests/helpers/fixtures.js`
- **風險**: 低

### 3.3 [P1] 遷移機制加入版本追蹤

- **問題**: `src/db/migrate.js` (328 行) 沒有版本號追蹤，每次啟動都重新檢查
- **修改**: 建立 `schema_migrations` 表，版本化遷移檔案
- **風險**: 中。需確保現有 DB 的遷移狀態正確初始化

### 3.4 [P1] 結構化日誌

- **修改**: 引入 `pino`，建立 `src/utils/logger.js`，替換 `console.log/error/warn`
- **風險**: 低

### 3.5 [P2] 加入輸入驗證到關鍵端點

- **修改**: 考慮引入 `zod`，為高風險端點加入 schema 驗證
- **目標**: patients CRUD、schedules、auth/login、Excel 上傳
- **風險**: 低至中

---

## 四、長期優化（第 1-3 月）：大型重構與效能優化

### 4.1 [P1] JSON 欄位正規化（選擇性）

**只針對「經常查詢」的 JSON 欄位：**

| 欄位 | 建議 |
|------|------|
| `patients.diseases` | 新增 `patient_diseases` 關聯表 |
| `patients.dialysis_orders` 的 mode/freq | 提取為獨立欄位 |
| `schedules.schedule` | **保持不變**（document-style 設計合理） |
| `*_by` 欄位 | **保持不變**（輔助記錄不需查詢） |

**風險**: 高。需資料遷移，建議在測試充足後才執行。

### 4.2 [P1] API 文件（Swagger/OpenAPI）

- 使用 `swagger-jsdoc` + `swagger-ui-express`
- 在 `/api/docs` 提供互動式文件
- **風險**: 低

### 4.3 [P2] 排程效能優化

- **問題**: `scheduler.js` 的 DELETE_PATIENT 逐日查詢未來 60 天排程
- **修改**: 改為批次操作，用 transaction 包裹
- **風險**: 中

### 4.4 [P2] 資料庫交易一致性強化

- 使用 `db.transaction()` 包裹多表操作（排程歸檔、病人刪除、調班處理）
- **檔案**: `src/services/scheduler.js`, `src/services/exceptionHandler.js`, `src/services/scheduleSync.js`
- **風險**: 低至中

---

## 五、可選改善

| 項目 | 說明 | 價值 |
|------|------|------|
| ESLint + Prettier | 統一程式碼風格 | 中 |
| 健康檢查增強 | /api/health 加入 DB/磁碟/記憶體檢查 | 中 |
| TypeScript 漸進遷移 | 先加 jsconfig.json | 高（長期） |
| 備份機制改善 | 改用 better-sqlite3 的 `backup()` API | 高 |
| CORS 配置加嚴 | 限制 origin 為 null 的請求 | 低 |

---

## 六、實施時程

```
第 1 週
 ├─ 2.1 helmet                    [1 小時]
 ├─ 2.2 Rate Limit 上限            [30 分鐘]
 ├─ 2.4 .env.example              [30 分鐘]
 ├─ 2.5 統一錯誤回應 (helper)       [2 小時]
 └─ 2.6 清理 Firebase 註解         [30 分鐘]

第 2 週
 ├─ 2.3 首次登入改密碼              [3 小時]
 ├─ 2.7 JWT 開發環境警告            [1 小時]
 └─ 3.2 測試基礎設施               [4 小時]

第 3 週
 ├─ 3.1 system.js 拆分             [8 小時]
 └─ 3.2 第一批整合測試              [8 小時]

第 4 週
 ├─ 3.1 orders.js 拆分             [8 小時]
 ├─ 3.3 遷移版本追蹤               [4 小時]
 └─ 3.4 結構化日誌                  [4 小時]

第 5-6 週
 ├─ 3.1 抽取 Service 層            [12 小時]
 ├─ 3.5 輸入驗證                   [6 小時]
 └─ 4.4 Transaction 一致性         [6 小時]

第 7-12 週
 ├─ 4.1 JSON 正規化（選擇性）       [16 小時]
 ├─ 4.2 API 文件                   [12 小時]
 └─ 4.3 排程效能優化               [8 小時]
```

---

## 七、風險控管原則

1. **不改變 API 路徑**: 所有重構維持原有 URL/HTTP 方法/回應格式，前端不需修改
2. **漸進式重構**: 每次 PR 只改一個模組
3. **有測試才重構**: 先寫整合測試，再拆分
4. **備份先行**: 每次部署前確保資料庫備份
5. **灰度發布**: 先在測試虛擬機跑一天，確認無異常再更新正式環境

---

## 關鍵檔案

- `src/index.js` — 應用入口，helmet/日誌/路由掛載
- `src/routes/system.js` — 最優先拆分（1,836 行）
- `src/routes/orders.js` — 第二優先拆分（1,865 行）
- `src/middleware/rateLimit.js` — 記憶體洩漏風險
- `src/db/migrate.js` — 遷移機制重構（328 行）
