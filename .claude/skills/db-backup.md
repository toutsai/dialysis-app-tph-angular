# SQLite 資料庫備份與隔離還原

## 核對實際目標

現行 Angular PM2 程序是 `dialysis-server-angular`，工作目錄 `D:\dialysis-app-angular`；以 `ecosystem.config.cjs` 和實際 `DB_PATH`／`BACKUP_DIR` 為準，不沿用舊 Vue 路徑。`start:review` 使用專案的 `data-dev/dialysis.db`，與正式資料分開。

備份實作在 `src/utils/backup.js`。應用程式只使用 `getDatabase()` 單例的 SQLite online backup；不可用檔案複製、checkpoint 後複製或刪 WAL 取代一致性備份。

## 建立與檢查

- 已有管理員 UI/API 可建立手動備份：`POST /api/system/backup`；列表為 `GET /api/system/backups`，健康狀態為 `GET /api/system/backup-health`。都需要 admin 權限。
- 已初始化且目標環境明確的維護程序亦可執行 `npm run backup`。不要把未核對環境的命令當成測試；此命令會使用該程序的 DB_PATH。
- 排程的 auto 備份維持原設定。保留數量仍為 auto 30 份、manual 10 份，以路徑安全且實際存在的副本計算；異常或缺檔紀錄不占配額。異常路徑、連結或缺檔紀錄不自動移除，應由維護人員核對。
- 新備份檔名含 UUID，同一時間最多一個工作與兩個等待工作。超過回應忙碌，可稍後重試。
- 新副本通過隔離唯讀 worker 的 SQLite 一致性快速檢查 `quick_check` 後才列為成功。`backup_status` 記錄最後嘗試、成功、失敗與最近驗證；它不取代院內異機備援或正式還原演練。

## 還原到全新目錄

只使用 `scripts/restore-backup.mjs`。它以唯讀 SQLite 來源呼叫 backup API，包括已提交的 WAL 資料，再驗證新副本；目的目錄已存在即拒絕。沒有直接覆蓋運行中 DB 的 restore API，舊 `restoreBackup()` helper 明確拒絕操作。

```powershell
node scripts/restore-backup.mjs --source "C:\isolated-test\backup.db" --target-dir "C:\isolated-test\restore-new"
```

上例必須換成已核對的隔離測試路徑；目的父目錄應已存在，`restore-new` 必須是全新目錄。輸出包含新 `dialysis.db` 路徑、驗證結果與資料表數。失敗時保留錯誤與可能的新目錄供檢查，重試使用另一個全新目錄。

這個工具不切換正式資料庫、不停止或啟動 PM2。若要使用還原副本取代正式資料，需另行安排停機、資料取捨與驗收；不可照舊文件直接複製覆蓋 DB 或刪除 WAL/SHM。

完整操作與驗證範圍見 [備份與復原手冊](../../docs/backup-recovery.md)。本輪僅合成、隔離目的地的還原驗證；院內異機副本與實際復原能力尚無法核實。
