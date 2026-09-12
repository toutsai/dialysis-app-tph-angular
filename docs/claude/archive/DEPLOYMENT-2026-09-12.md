# Angular 院內版：測試與部署

本文件適用目前 Angular 專案。舊版 Linux/Vue 部署步驟已撤下。

| 用途 | 目錄 | 服務 | Port |
| --- | --- | --- | --- |
| Angular 正式站 | D:\dialysis-app-angular | dialysis-server-angular | 3000 |
| 舊 Vue 站 | D:\dialysis-app | dialysis-server | 3001 |
| 既有 dev | D:\dialysis-app-angular-dev | 沿用該測試站設定 | 3002 |
| 本分支操作測試 | 另外建立的 onsite-main-dev checkout | npm run start:review | 3003 |

以 ecosystem.config.cjs 的設定為準。不要把 Angular 更新複製到舊 Vue 目錄。

## 先在獨立測試站驗證

依 [測試說明](docs/onsite-main-dev-testing.md) 取得 onsite-main-dev，使用 .nvmrc 指定的 Node 22。
依序執行 npm ci、npm ci --prefix angular-client、npm run check:syntax、
npm test、npm run build:angular、npm run smoke:tph-angular，每步成功才繼續。

npm run start:review 啟動本機 3003，沿用該 checkout 的 data-dev/dialysis.db。
不讀正式 .env、不連 HIS、定時排程停用。帳號與資料庫均不隨 Git 提交。
庫存不是本輪修改驗收範圍；請以模擬資料驗證其他操作。

## 發布前準備

1. 記錄已驗收的 commit、完整變更清單與測試結果。只發布已 commit 的版本。
2. 在建置環境使用鎖檔安裝，保留完整 vendor/（含 xlsx-0.20.3.tgz）。
3. 確認 Node 版本與 .nvmrc 一致，來源包含最新 dist/browser/index.html。
4. 執行 deploy.ps1；它現在只檢查檔案和目標設定，不停止服務、不複製或刪除檔案。
5. 核對主機 PM2 程序的 name、cwd、port 與上表一致，單一 fork process。
6. 核對正式 .env 已設定 JWT_SECRET，備份路徑與正式 DB_PATH 正確。
   請勿把密鑰或整份環境設定貼進驗證紀錄。
7. 在正式目錄執行 npm run backup，確認 online backup 已成功產生，檔案可讀且非空。
   備份現行程式、dist、package.json、package-lock.json、vendor 與 PM2 設定，
   記下版本和備份位置；正式資料與密鑰各自保存。

## 人工發布

本分支測試完成不代表核准正式發布。正式部署請在院內安排的維護時段執行。

- 程式來源須是已驗收的 commit，目標固定為 D:\dialysis-app-angular。
- 後端或依賴更新時，先停止 dialysis-server-angular，再更新已驗收的程式檔案；
  純前端更新只需更新完整 dist/browser 產出。
- 依賴有變時，在目標安裝 npm ci --omit=dev。先放入匹配的 lockfile、package.json
  與 vendor/；不要複製另一台電腦的 node_modules。
- 不覆蓋 .env、data/、logs/，也不把 data-dev、測試帳號或測試資料放進正式站。
- 一般更新**不要執行 npm run migrate 或 migrations/migrate.js**：
  它們是 Firestore 一次性資料匯入工具。schema 檢查由伺服器啟動時自動執行。
- 後端更新使用 pm2 restart dialysis-server-angular --update-env；
  首次設定才使用 pm2 start ecosystem.config.cjs --only dialysis-server-angular。
  不使用 cluster 模式，不用其他服務名稱的 delete/restart。
- 任一步失敗就停止更新，依下方回復程序處理，不繼續啟動不完整的套件。

## 驗證與回復

更新後檢查 PM2 狀態與 http://localhost:3000/api/health；
比對首頁 main-*.js 的檔名與本次 dist/browser 產出，確認前端不是舊快取。
在正式站做登入與唯讀抽查，寫入型 smoke 只在獨立測試庫執行。

若程式驗證失敗，停止 Angular 程序，還原上一套完整程式、dist、lockfile 與 vendor，
重新安裝匹配的依賴，再啟動同一個 Angular 程序。
純程式回復不要直接倒回資料庫，以免丟失部署後新增資料。

若需要資料庫還原，先保存目前資料庫的 online backup，確認要還原的備份已在
隔離資料庫通過 integrity_check 與必要資料核對，並確認需要保留的部署後資料。
由維護人員在停止所有該資料庫連線後執行既定還原程序；不要直接覆蓋仍開啟的 WAL 資料庫。
最後核對健康狀態、資料日期、排程與已發布版本。
