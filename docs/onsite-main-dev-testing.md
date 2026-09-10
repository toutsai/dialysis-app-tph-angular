# onsite-main-dev 主機測試

此分支從 `onsite-main@6a10fc2` 建立，供修正驗證。正式站與既有 `dev` 分支不需切換。

## 第一次取得

在主機安裝 `.nvmrc` 指定的 Node.js 22.23.2（含 npm）。開 PowerShell，將下列新目錄名稱換成你希望放置測試站的位置；若該目錄已有內容，另選新的空目錄。

```powershell
git clone --branch onsite-main-dev --single-branch https://github.com/toutsai/dialysis-app-tph-angular.git D:\dialysis-app-onsite-dev
Set-Location D:\dialysis-app-onsite-dev
node --version
npm ci
npm ci --prefix angular-client
npm run check:syntax
npm test
npm run build:angular
npm run smoke:tph-angular
npm run start:review
```

每個指令成功後再執行下一個。建置／測試任一失敗時先保留錯誤訊息，不要接續啟動。`npm ci` 的 SQLite 套件與 Node 版本綁定，請在這個新目錄安裝依賴，不要複製其他目錄的 `node_modules`。

最後會在主機開啟 [測試站](http://127.0.0.1:3003)。第一次啟動會顯示隨機產生的測試 admin 密碼；請記下，之後沿用。按 Ctrl+C 停止測試站。

`start:review` 固定使用此目錄下的 `data-dev/dialysis.db`，不讀原專案 `.env`，不使用正式資料庫或既有站的 3000／3001／3002 埠。使用本地帳號密碼，不連 HIS；定時排程關閉，預約同步透過自動測試驗證。`data-dev/` 的帳號、資料與 secrets 不會提交 Git。

首次畫面為空資料庫，可建立合成病人進行手動測試。自動測試另外使用暫存／記憶體資料庫，不會修改 `data-dev`。測試入口目前只允許主機本身連線，適合先做主機驗收；跨裝置測試需另設定測試網路與帳號。

## 之後更新修正

先用 Ctrl+C 停止測試站，再在同一個測試目錄執行：

```powershell
git status --short
git pull --ff-only origin onsite-main-dev
npm ci
npm ci --prefix angular-client
npm run check:syntax
npm test
npm run build:angular
npm run smoke:tph-angular
npm run start:review
```

若第一行顯示你自行修改過的檔案，先保存並處理該差異再更新。測試分支每次更新後都重新安裝鎖定依賴、建置及驗證。不要在這一步執行正式站的 PM2 設定；`npm run migrate` 是歷史匯入工具，並非本次測試需要的步驟。

## 手動驗收

1. **醫囑保存**：合成病人先有備註／CRRT／首透計畫，只改一般醫囑後重新整理，其他資料仍保留；明確清空欄位可以正常清空。
2. **週排程**：今天已有接送方式或臨時模式，只改備註並儲存，其餘欄位保留。兩個視窗編輯相同版本，後存的視窗應收到衝突提示並保留草稿。
3. **每日頁編輯**：儲存期間繼續修改，新修改仍顯示未儲存；快速切換日期或收到即時通知不覆蓋草稿。
4. **暫停／跨日**：暫停當日最後一個場次，重整仍空；跨日衝突改派後只有目的日保留該場次；無法完成的移班保留來源。若來源日已凍結、目的日重算出現新衝突，操作應失敗並保留原有兩日排程。
5. **權限**：測試醫師角色無法刪除病人；設備依現有書記角色矩陣限制；editor 專師撤除職稱後需重新登入，新登入採正確權限。

預約生效日與今日凍結、KiDit 排除「更改模式」、頻率與模式規則保留原行為。本次預約交易修正針對總表規則變更（UPDATE_BASE_SCHEDULE_RULE）；其他預約類型未重新設計。HIS 傳輸介面、Angular 大版本升級及完整院內效能量測仍是另行安排的項目。

GitHub workflow 對 Linux／Windows 執行安裝、語法、回歸、建置與 API smoke。測試通過後，仍需你確認主機畫面和作業結果，再決定是否合併回 `onsite-main`；本分支本身不會更新正式站。
