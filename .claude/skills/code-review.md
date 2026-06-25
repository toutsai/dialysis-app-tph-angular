# 程式碼審查檢查清單 (Code Review)

針對本專案特性的 code review 檢查項目。

## 資料庫

- [ ] 使用 `getDatabase()` 取得單例連線，**不要** `new Database()` 或 `db.close()`
- [ ] `migrate.js` 是唯一例外，它需要自管連線
- [ ] SQL 查詢使用 `db.prepare().run/get/all()` 搭配參數化查詢（`?` placeholder），防止 SQL injection
- [ ] better-sqlite3 是同步 API，不需要 `await`（除非包在 async 函式中做其他 async 操作）
- [ ] JSON 欄位存取：寫入用 `JSON.stringify()`，讀取用 `JSON.parse()`，注意 parse 失敗時的 fallback
- [ ] 大量寫入操作使用 `db.transaction()` 包裝

## API 路由

- [ ] 敏感端點有 RBAC 權限檢查（`authenticateToken`, `isAdmin`, `isEditor` 等）
- [ ] 回應格式統一：成功回傳資料物件，失敗回傳 `{ error: true, message: "..." }`
- [ ] DB 欄位 `snake_case` 正確轉換為 API 回應的 `camelCase`
- [ ] 新的路由已在 `src/index.js` 掛載
- [ ] 適當的 HTTP status code（200/201/400/401/403/404/500）

## 安全性

- [ ] 使用者輸入經過驗證（`validate.js` middleware 或手動檢查）
- [ ] 不在日誌中輸出密碼或 JWT token
- [ ] 新的公開端點確認是否需要 rate limiting
- [ ] 沒有 hardcode 敏感資訊（密碼、secret 等），使用環境變數

## 排程系統

- [ ] 修改排程邏輯時，確認 `scheduleSync.js` 的同步引擎行為不受影響
- [ ] 調班 (exception) 的四種類型都有考慮：MOVE / SUSPEND / ADD_SESSION / SWAP
- [ ] 床位 key 使用 `getScheduleKey()` 產生，不要手動拼接
- [ ] 日期工具使用 `dateUtils.js`，不要在各檔案重複定義
- [ ] 頻率對應使用 `FREQ_MAP_TO_DAY_INDEX`，不要 hardcode

## ESM 模組

- [ ] 使用 `import`/`export`，不是 `require`/`module.exports`
- [ ] `__dirname` 需透過 `fileURLToPath(import.meta.url)` + `dirname()` 取得
- [ ] 動態 import 使用 `await import('...')`
- [ ] `ecosystem.config.cjs` 是 CommonJS（PM2 限制），其餘皆 ESM

## Windows 相容性

- [ ] 檔案路徑使用 `path.join()` 組合，不要 hardcode 分隔符
- [ ] `ecosystem.config.cjs` 中的路徑使用 `\\` 跳脫
- [ ] 確認 `node-cron` 排程在 Windows 環境正常執行
- [ ] Graceful shutdown 處理 `SIGINT` 和 `SIGTERM`

## 效能

- [ ] 頻繁查詢的欄位有建立 INDEX（參考 `schema.sql`）
- [ ] 不在迴圈中重複呼叫 `db.prepare()`，應在迴圈外 prepare 一次
- [ ] 大量資料操作考慮分頁（LIMIT/OFFSET）
