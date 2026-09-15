# 門診 CKD 收案頁籤（Angular 重寫）計畫

建立：2026-09-15。使用者拍板：不走 iframe（A/B），直接以 Angular + Express + SQLite 重做，
「基本概念與邏輯先照單機版，做成 Angular 若能更好用更好」。不急、分階段，每階段做完在 3002 用真資料驗。

## 來源

- `D:\CKD工作台-部北版-分支交接包.zip`（原始碼；HANDOFF.md 80KB 是規則與決策的權威）
- `D:\部北版-單機免安裝 (14).html`（build 產物，行為對照用）
- 盤點結論見記憶 `ckd-workstation-integration`（同 session 派 agent 讀完交接包）

## 三個結構決定（與單機版不同）

1. **運算放後端**：上傳即入 SQLite；判定由 Express service 算好回傳；前端只畫。理由：多人共用、備份、稽核、不卡瀏覽器（原版 heap 93MB）。
2. **解析器與判定引擎照搬**：`parsers.js`（UMD 純函式）、`analyze/evalCase`（零 DOM）、四個 `build*` 搬進 `src/services/ckd/`，
   用交接包 `fixtures.js` 與 `scratch/validate2*.js` 的測資對照，判定結果須與原版逐字一致。**規則不改**，改的只有輸入輸出介面（`cfg()` 讀 DOM → 參數）。
3. **畫面依個管師一天的流程重排**：前一天看明天名單 → 隔天檢核 P 碼 → 召回。不照原版 nav 順序。

## 位置與權限（2026-09-15 使用者拍板）

- **獨立頁面**，不是腎臟病地圖的頁籤：側欄「住院腎臟病地圖」下方新增「門診CKD收案」，路由 `/ckd-clinic`。
- 原「腎臟病地圖」頁改名「**住院腎臟病地圖**」（側欄與頁首 h1），權限不變（admin／contributor／專科護理師）。
- 門診CKD收案 權限：**admin、contributor、editor**（= viewer 以外全部；本站階層 admin > editor > contributor > viewer，後端用 contributor 門檻）。後端路由 `/api/ckd` 獨立掛權限，不掛在 aki router 下。
- 頁面標題顯示「門診CKD收案（開發中）」直到階段 4 完成。

## 分階段

| 階段 | 內容 | 後端 | 前端 | 狀態 |
|---|---|---|---|---|
| 0 | 骨架 | `routes/ckd.js` 掛 `/api/ckd`（contributor 門檻）；schema 加 `ckd_cases / ckd_clinic_visits / ckd_labs / ckd_billing / ckd_records / ckd_settings / ckd_upload_batches`；`services/ckd/parsers.js` 搬移＋測試 | 側欄改名住院腎臟病地圖＋新增門診CKD收案；路由 `/ckd-clinic` + guard；`features/ckd-clinic/` 開發中頁（進度／筆數／參數） | 完成 2026-09-15（dev） |
| 1 | 匯入與設定 | POST `/upload`（raw 二進位、8MB 上限、獨立子程序解析）、`services/ckd/ingest.js` 合併規則照原版（case 逐人取代／lab 聯集新值覆蓋／clinic、bill 同鍵略過／sha1 同檔略過）、批次紀錄、判定參數 CRUD；`scripts/ckd-import.mjs` 命令列大批匯入 | 四張上傳卡（拖放／選檔／多檔自動分流）、本次上傳進度、上傳紀錄、參數表單（預設值／還原） | 完成 2026-09-15（dev） |
| 2 | 明日追蹤＋收案評估 | `services/ckd/engine.js`（app.js 規則引擎逐字搬純函式；階段 3 掛鉤留介面）、`dataset.js`（SQLite→Date 快取）、GET `/daily?date&doctor`（本科醫師／全部／他科掛號已收案） | `ckd-daily` 元件：診次按鈕列、A/B 統計列篩選、兩張表、判定欄＋可展開依據；頁內檢視「明日追蹤 · 收案評估」／「匯入與設定」 | 完成 2026-09-15（dev） |
| 3 | 個案紀錄八類 | `services/ckd/records.js`（REC_TYPES 欄位定義照原版、validateRecord、CRUD 軟刪除、makeHooks 四掛鉤＋chipsOf、pcodeTimeline、recordStats、lookupName/searchPatients）；`/api/ckd/records*`、`/patients/search`、`/patients/:mrn/summary`；`dataset.js` 載入紀錄進判讀；schema 加 `name`/`updated_by` | `ckd-records` 子元件（原版第五區）：病人搜尋、八顆新增鈕、動態表單、VPN 三態狀態列、不予收案狀態、P 碼總覽、紀錄卡編輯／刪除、全部紀錄；A／B 列姓名可點跳轉、chips、判定欄行動列可點（VPN／個管）、判定依據 VPN 註記、B 統計列「已外院收案」 | 完成 2026-09-15（dev） |
| 4 | 稽核與匯出 | 全名單稽核、檢驗總表（21 項＋eGFR 斜率）、XLSX（當日可收案名單）／CSV | 兩張總表＋匯出鈕 | 未開始 |
| 5 | 進階模組 | 召回清單、近日異常檢驗、透析準備管線、月報、檢核 P 碼 | 各一頁 | 未開始 |
| 6 | 與本站打通 | 透析準備管線 ↔ 預約洗腎登記本／首透；病歷號連到病人詳情 | | 未開始 |

## 資料模型（鍵沿用原版，見 HANDOFF §輸出契約）

- 病歷號 mrn 去前導 0。
- `ckd_cases` 唯一鍵 `mrn|visit|code|ctype`；`ckd_clinic_visits` `mrn|date|no`；`ckd_labs` `no` 或 `mrn|date|kind`；`ckd_billing` `mrn|visit|code`。
- `ckd_settings` 單列：preGap 77、earlyNew 77、earlyGap 161、dmGap 70、逾期 120、檢驗回溯 ±90（以原版 app.js:220-232 為準，README 的 180 是舊值）。

## 真檔驗證結果（2026-09-15，D:\建置相關資料\CKD 四份）

- 四份都是真 xlsx／xls（zip／OLE），不是 HTML 偽裝 → HTML 路徑的 ISO 日期問題暫不需處理。
- 0204 八個月 31MB／76 萬列：`toAoa` 30 秒、heap 1.3GB。**PM2 `max_memory_restart: 500M`、VM 8GB** → 網頁上傳限 8MB 且在獨立子程序解析（PM2 不計子程序）；首次大批用 `node --max-old-space-size=2048 scripts/ckd-import.mjs <檔>`（實測 33 秒寫入 71,209 份／26,591 人）。之後每日／每週匯出（<1MB）走網頁。
- 追蹤清冊 25,976 列 → DB 25,168 列：同人同日同碼同類的重複列以 UNIQUE 鍵去重（原版陣列會保留重複列，只影響筆數顯示不影響判定）。
- 醫令明細檔名 1050701 但內容民國 115 年；含心臟內科等他科 P 碼（Early-CKD 多科會收，對應 allA 設定）。
- 門診清單 4 天 3,474 列、29 位醫師、他科佔多數（腎臟內科 338）；19 列身分證推不出性別。

## 階段 1 原本要用真檔驗證的事項（保留原文）

- HIS「匯出 Excel」若其實是 HTML／XML（開頭 `<`），SheetJS 文字路徑 `raw:false` 會把 ISO 日期字串改寫成 `m/d/yy`，`anyDate` 讀不回來（原版同樣行為）。拿真實 HTML 匯出檔確認日期格式；若真有 ISO 日期，改 `toAoa` 文字路徑為 `raw:true` 或在 `anyDate` 加 `m/d/yy`（屬額外相容，不動原規則）。
- 0204 檔 15 萬列在後端主執行緒 `toAoa` 的耗時與記憶體；必要時搬進 spreadsheetParser 的 worker（需擴充成讀全部工作表＋文字路徑）。

## 已知雷（來自交接包）

- 解析器 `toAoa` 要先看檔頭：`<` 開頭是 XML/HTML 假 xlsx。
- 門診清單空白科別列不理；DKD 不評 Early 碼（假設待 Henry 確認）；不予收案仍列 B 區。
- 原版 SheetJS 0.18.5 有已知 CVE；後端解析改用本站現有維護中的套件，前端不再內嵌 SheetJS。
- 與本站既有「CKD 關懷名單」（住院 AKI 快照來源）是兩套來源，並存不合併。

## 進度紀錄

- 2026-09-15：階段 3 完成（dev 未上線）：`tests/ckd-records.test.mjs` 3 組（驗證／CRUD＋統計／掛鉤進判讀＋P 碼總覽）；3002 真資料驗證 21 項 API（VPN pend→pos→neg 判定句、不予收案沉底與暫緩過期恢復、P 碼補登改變 A 區最後照護日、註銷列 voided、全部刪除後判定還原）＋ 10 項 UI（行動列跳轉開表單、必填提示、送出、確認框刪除、清除、搜尋下拉）全過；smoke 74/74。與原版的刻意差異：紀錄區是常駐子元件不是搬 DOM 節點；刪除／切病人確認用站內 `app-confirm-dialog`；表單錯誤顯示在表單內不用 alert；紀錄卡多顯示建檔者／修改者；P 碼總覽鈕多「+ 不予收案」；病人搜尋改後端 API（原版 datalist）。未做：紀錄 CSV 匯出（併入階段 4）、工作台列內展開版面（本站無工作台檢視）。

- 2026-09-15：階段 2 完成（dev 未上線）：真資料 8/28 全部醫師 A=50／B=32、五個醫師診次與他科診次（77 人）皆正確；資料集載入 1.6 秒（快取後 0）、判讀 0.14 秒；6 組引擎測試。已知：手動加入病歷號未做；年度評估到期 0 人屬預期（登錄簿時間軸只有收案列＋最後照護列，需入帳史累積）。
- 2026-09-15：階段 1 完成（dev 未上線）：四份真檔經 API／CLI 匯入全部正確、重複／超限／垃圾檔處理正確、參數表單可存；`tests/ckd-ingest.test.mjs` 5 組。
- 2026-09-15：盤點完成、計畫拍板。階段 0 完成（dev）：解析器 ESM 版 6 組測試通過；/api/ckd status+settings；七張表已在 3002 測試 DB 建立；頁面／側欄／改名經無頭驗證。
