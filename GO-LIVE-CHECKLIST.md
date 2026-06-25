# Angular 版上線前 — 行為對照檢查清單（vs TPH 現役版）

> 產生日期：2026-06-19
> 基準：TPH（`D:\dialysis-app`，現役 production，port 3000）= 128 endpoints
> 目標：Angular（`D:\dialysis-app-angular`，測試中，port 3001）= 175 endpoints
> 結論：**Angular 是 TPH 的嚴格超集**（TPH 沒有任何 Angular 缺的 endpoint）。差異 = Angular 多出的 47 個 endpoint + 共用端點上的行為強化。
>
> 使用方式：逐項在 Angular 版實測，與 TPH 現況/院內預期行為對照後打勾。
> 圖例：🆕 = Angular 全新功能（TPH 沒有，上線後使用者「多」出來的能力）；⚠️ = 共用功能但邏輯可能與 TPH 不同（高風險，重點回歸測試）。

---

## Part 1 — 🆕 Angular 新增功能（TPH 沒有，逐項確認可用）

### A. 床邊看板 / 裝置管理（全新模組 `dashboard.js`）
- [ ] `POST /dashboard/bed-login` 床邊登入流程可用
- [ ] `GET /dashboard/bed/:bedKey` 取得單一床位看板資料正確
- [ ] `GET /dashboard/pins`、`GET/PUT/DELETE /dashboard/devices/:bedKey` 裝置綁定 CRUD 正常
- [ ] 確認此功能是否真的要在第一版上線（若否，確認入口已隱藏）

### B. 排程進階（`schedules.js` 大幅擴充）
- [ ] `GET /schedules/range`、`GET /schedules/archived`、`POST /schedules/archived/batch` 歷史/批次查詢
- [ ] `GET /schedules/exceptions`、`GET /schedules/exception-tasks` 調班清單/任務
- [ ] `PUT /schedules/exceptions/:id`、`POST /schedules/exceptions/:id/resolve-conflict` 調班編輯與衝突解決
- [ ] `POST /schedules/first-dialysis-plan` 首次透析計畫
- [ ] `PUT /schedules/:date/with-teams` 排程含團隊分派
- [ ] 護理分派版本：`GET /schedules/nurse-assignments/:date/revisions`、`POST .../restore` 還原舊版本
- [ ] 總表 PATCH 系列：`base/MASTER_SCHEDULE`、`base/master`、`.../patient/:patientId` 各別更新

### C. 護理作業
- [ ] `GET /nursing/schedules/:id`、`POST /nursing/save-schedule` 班表存取
- [ ] `GET /nursing/group-config/:id` 分組設定讀取
- [ ] `GET /nursing/daily-logs/:date/revisions` 每日日誌歷史版本

### D. 醫囑 / 設備 / 檢驗
- [ ] `GET/PUT /orders/bed-settings` 床位設定
- [ ] `GET/PUT /orders/machine-bicarbonate-config` 機台碳酸氫鹽設定
- [ ] `POST /orders/lab-alert-analyses/query` 檢驗警示分析查詢
- [ ] `GET /patients/lab-reports`、`POST /patients/lab-reports/query` 檢驗報告查詢

### E. 系統 / 設定 / 認證
- [ ] `POST /auth/refresh-token` Token 自動續期（驗證久掛不會被登出）
- [ ] `GET/PUT /system/auto-assign-config/current` 自動排床設定
- [ ] `GET/PUT /system/config/:key`、`PATCH /system/tasks/:id` 設定別名/任務部分更新
- [ ] `GET /events/exceptions` 事件流

---

## Part 2 — ⚠️ 共用功能、但行為可能與 TPH 不同（重點回歸測試）

> 這些 endpoint 路徑兩邊都有，但 Angular 的內部邏輯較新/不同。使用者有 TPH 的操作慣性，這類「看起來一樣、結果不同」最容易出錯。

- [ ] **每日應打針劑**（`POST /medications/daily-injections`）
  本 session 已把兩邊邏輯對齊（2026-06-19）。仍建議回歸：QW/W 規則、`QW 1 & 5`、日期+W 並存「以日期為準」、濾空劑量、同藥碼去重、跨月沿用最近一份。

- [ ] **藥囑 Excel 上傳**（`POST /orders/medications/upload`）
  確認 Angular 同月重傳為「整月覆蓋」、月份取上傳當下系統時間（非 Excel 異動日期）。

- [ ] **透析模式正規化**（Angular 多了 `utils/dialysisMode.js`，TPH 無）
  驗證 `SLEDD`/`SLEDF` → 存成 `SLED`，大小寫/空白容錯。TPH 不會正規化 → 兩邊歷史資料的 mode 寫法可能不同。

- [ ] **工作日誌 / KiDit / 病人歷史 同步鏈**（Angular 多了 `dailyLogMovementSync.js`、`patientHistory.js`，TPH 無對應模組）
  驗證：新增/刪除/復原/狀態轉移/更改模式會寫入工作日誌病人動態並連動 KiDit；「更改模式」刻意**不進** KiDit；純改頻率/床位**不寫**工作日誌。這會直接影響 KiDit 申報內容與交班日誌。

- [ ] **調班處理**（`exceptionHandler.js` 288→351 行 + 新增 `exceptionReconcile.js`）
  驗證：ADD_SESSION/MOVE 帶入透析模式（modeOverride，如 HD→HDF）、SWAP/MOVE 來源驗證（避免鬼魂病人/同人雙位置）、排程重建後的 reconcile 結果。

- [ ] **預約變更生效**（`scheduler.js` 603→726 行）
  驗證每日定時套用 `UPDATE_STATUS/UPDATE_MODE/DELETE/RESTORE` 時，是否比照即時操作同步工作日誌 + KiDit + 歷史；歷史只在生效日寫。

- [ ] **排程同步引擎**（`scheduleSync.js`）
  以同一份總表在兩版各跑一次未來 60 天排程，比對結果是否一致（頻率展開、調班整合）。

- [ ] **病人 CRUD**（`patients.js` 798→1029 行）
  驗證病人歷史/快照（`patientHistory`）、`PATCH /patients/:id` 部分更新、軟刪除時連帶清理排程相依（總表規則 + pending 調班）。

---

## Part 3 — 上線前一般檢查

- [ ] **資料同步基準點**：記錄最後一次 TPH→Angular DB 手動同步的時間；上線切換當下做最終一次同步，避免遺漏切換前的異動
- [ ] **帳號 / 權限 / Session**：使用者帳號、RBAC（admin/editor/contributor/viewer）、單一裝置 session、登入鎖定行為與 TPH 一致
- [ ] **環境**：port（3001 → 對外導向）、反向代理、CORS 白名單（`ALLOWED_ORIGINS`）、`.env`（JWT_SECRET）、前端 `dist/` 已用正式設定 build
- [ ] **PM2**：上線版以正式 `ecosystem.config.cjs` 啟動；確認開機自啟（pm2 save / startup）
- [ ] **備份**：自動備份排程運作正常、可成功還原
- [ ] **列印 / 報表**：ICU 列印排版、各式報表（日/月/年）輸出正確
- [ ] **回退方案**：上線後若需退回 TPH，確認 TPH 仍可立即接手（DB、port）

---

## 附錄：Angular 多出的 47 個 endpoint（完整清單）

POST auth/refresh-token
POST dashboard/bed-login ; GET dashboard/bed/:bedKey ; GET dashboard/pins ; GET dashboard/devices ; PUT dashboard/devices/:bedKey ; DELETE dashboard/devices/:bedKey
GET events/exceptions
POST medications/injections ; GET medications/injections ; POST medications/daily-drafts
GET nursing/schedules/:id ; POST nursing/save-schedule ; GET nursing/group-config/:id ; GET nursing/daily-logs/:date/revisions
POST orders/lab-alert-analyses/query ; GET/PUT orders/bed-settings ; GET/PUT orders/machine-bicarbonate-config
POST patients/lab-reports/query ; GET patients/lab-reports ; PATCH patients/:id
GET schedules/expired ; GET/POST schedules/archived(/batch) ; GET schedules/range ; GET schedules/exceptions ; GET schedules/exception-tasks ;
GET/PUT schedules/base/MASTER_SCHEDULE ; PATCH schedules/base/master(/MASTER_SCHEDULE)(/patient/:patientId) ;
POST schedules/first-dialysis-plan ; PUT schedules/exceptions/:id ; POST schedules/exceptions/:id/resolve-conflict ; PUT schedules/:date/with-teams ;
GET schedules/nurse-assignments/:date/revisions ; POST schedules/nurse-assignments/:date/revisions/:revisionId/restore
PATCH system/tasks/:id ; GET/PUT system/auto-assign-config/current ; GET/PUT system/config/:key
