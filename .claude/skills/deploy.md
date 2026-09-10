# Angular 院內部署參考

現行操作文件是 [DEPLOYMENT.md](../../DEPLOYMENT.md)，請完整閱讀後操作。

- Angular 正式目錄 D:\dialysis-app-angular，程序 dialysis-server-angular，port 3000。
- D:\dialysis-app 是舊 Vue 站，不是此專案的部署目標。
- deploy.ps1 已改為唯讀檢查，不會複製、刪除檔案或停止 PM2。
- 依賴按鎖檔安裝，完整交付 vendor/ 與 dist/browser；不複製 node_modules、.env、data/。
- npm run migrate / migrations/migrate.js 是 Firestore 一次性匯入，不是一般更新步驟。
  schema 檢查由伺服器啟動時執行。
- 發布前先在獨立測試庫驗收並準備程式與資料備份；不要對正式站執行寫入型 smoke。
- 保持單一 fork process，SSE 與排程事件匯流排仍是單進程設計。
