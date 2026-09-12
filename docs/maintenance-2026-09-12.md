# 2026-09-12 維護與測試分支交接

本輪工作位於 `onsite-main-dev`。本機已完成建置、回歸與瀏覽器驗證；主機拉取時應另確認所拉取提交的 GitHub Actions 狀態。這是測試分支交接，不代表正式站已部署。正式病人資料與臨床政策未作為測試素材。

## 已納入本輪的功能

- **日誌歷史與復原**：相同內容保存為 no-op，不增加快照或版本。版本清單僅回傳摘要，分頁讀取；選定後才讀完整版本與差異。先保存或取消未存草稿，再選擇要復原的區塊；病人動態可逐列核對。復原需目前版本，衝突回 409，保留復原前與完成後快照、稽核，完整交易失敗即回滾。日誌復原不回滾病人狀態或排程，KiDit 手填欄位與既有除外規則保留。內容變更 revision 亦涵蓋自動 writer，防止 A→B→A 重用舊版本。
- **備份狀態**：管理員 `/backup` 可查看最後成功／失敗、DB／WAL 大小、檔案可用性與最近驗證，並建立手動備份。SQLite online backup 使用唯一檔名、有界排隊，新副本通過 `quick_check` 才記成功。自動 30 份／手動 10 份保留政策不變，缺檔或不安全紀錄不占有效副本名額。詳細 API、限制及離線復原見 [backup-recovery.md](backup-recovery.md)。
- **耗材 Excel**：庫存耗材上傳的工作表解析也改由 spreadsheet worker 執行；資料驗證、完整類別判定、歷史區間與交易寫入仍走既有後端規則。背景解析不代表可以省略品名核對，也不改變耗用計算政策。
- **日誌輸入保護與 PDF**：載入／復原期間鎖定主表及可修改資料的浮層，避免晚到回應覆蓋鍵盤輸入。PDF 改用離屏副本與連續、不重疊的圖片切片，在文字行／表格列邊界分頁；保留日期、完整欄位與簽核內容，隱藏操作按鈕。
- **API 查詢參數**：Promise 與 Observable 查詢入口使用共同規則，保留 0 與正確編碼；拒絕傳入會被忽略的非空 fetchAll 條件，要求明確使用 fetchWhere。
- **瀏覽器回歸**：`npm run test:browser` 使用真實 Angular 編譯產物與後端路由、獨立合成 SQLite、固定日期，禁外連與排程。驗證日誌保存／差異／選擇復原、備份權限與成功、庫存日終數字／明細關閉，以及中文 PDF 匯出；更多遷移互動檢查仍在驗收中。CI 的獨立 Linux Chromium job 保存合成 PDF／截圖，供字形及跨頁核對。

## 套件版本

Angular 依 19→20→21→22 逐版遷移。目前 manifest 為 core／compiler 22.1.6、CLI／build-angular 22.1.8、TypeScript `~6.0.0`。兩份 `package.json` 的 Node 範圍皆為 `>=22.22.3 <23`，建議 `.nvmrc` 的 **22.23.2**。Playwright Test 為 1.63.0。實際安裝依兩份 lockfile；不要在院內主機自行執行 `npm update` 或混用舊 `node_modules`。

## Windows 測試主機更新

1. 先核對是獨立 `onsite-main-dev` checkout、目前 commit、服務名稱、DB_PATH／BACKUP_DIR 與原有機密設定。Angular 正式站目錄為 `D:\dialysis-app-angular`，程序名為 `dialysis-server-angular`；舊 Vue 的 `D:\dialysis-app`／`dialysis-server` 不適用。本段流程先用測試站，不直接更新正式站。
2. 在更新前取得已驗證備份並記錄位置，再停止**該測試站**服務，保留目前程式、dist、lockfile 與設定。若停止後從 CLI 備份，先載入已核實的原有環境變數；PM2 的 env_file 不會自動套用到另一個 shell。不要把 `.env`、密鑰或真實資料放進 Git／測試產物。
3. 確認工作目錄沒有未處理的本機修改，再執行 `git pull --ff-only origin onsite-main-dev`。分支分歧或更新失敗就停下核對，不覆蓋本機資料。使用 `node --version` 確認 Node 22.23.2。
4. 依序執行下列指令，每一步成功才繼續；編譯需 devDependencies，不使用 `--omit=dev`：

   ```powershell
   npm ci
   npm ci --prefix angular-client
   npm run check:syntax
   npm test
   npm run build:angular
   npm run smoke:tph-angular
   npx playwright install chromium
   npm run test:browser
   ```

5. 依原測試站設定啟動。本機操作預覽可用 `npm run start:review`，網址 `http://127.0.0.1:3003`；它沿用該 checkout 的 data-dev，停用排程與 HIS。瀏覽器自動測試另用自行建立的暫存庫，兩者不同。不要用初始化指令覆蓋既有測試資料，也不要把 smoke 指向正式資料庫。
6. 人工核對日誌歷史、備份頁、庫存明細及中文 PDF，再記下提交與結果。正式發布仍依 [DEPLOYMENT.md](../DEPLOYMENT.md) 的維護時段、備份與核准流程，不因測試分支通過而自動部署。

## 復原與驗證狀態

離線工具只建立**全新目的目錄**，不覆蓋既有檔案、不刪 WAL、不替管理員切換正式 DB_PATH。已完成一次合成 CLI 演練：來源仍開啟且資料留在已提交 WAL 時，新副本可讀；對同一目的目錄重試會拒絕。這不是正式院內復原演練，異機備份／VM 快照仍未核實。

| 驗證項目 | 狀態 |
| --- | --- |
| 測試主機提交紀錄 | 拉取後以 `git rev-parse HEAD` 記錄，並核對該提交的 Actions |
| Angular 22 最終 build | 通過，`main-U5E637FH.js` |
| 語法／完整回歸／smoke | 98／98、182／182、75／75 通過；最後 PDF 調整另通過對應單元與瀏覽器驗證 |
| Chromium 流程與 PDF 視覺核對 | 9／9 通過，無跳過；三頁中文 PDF 已逐頁核對標題、表格與連續長文 |
| 套件公告檢查 | 前後端完整 npm audit（含開發套件）均為 0 個已知問題 |
| GitHub Windows／Linux／Chromium CI | 每次推送由 Verify development changes 執行；拉取時確認當前提交三個 job 皆通過 |
| 正式部署／院內異機還原 | 未執行／未核實 |
