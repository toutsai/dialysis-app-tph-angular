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
| 1 | 匯入與設定 | POST `/upload`（detectKind 標題優先）、合併規則（追蹤清冊同人整批換、0204 同人同日聯集、醫令明細）、批次紀錄、判定參數 CRUD | 四張上傳卡＋讀取資料夾、批次列表、參數表單 | 未開始 |
| 2 | 明日追蹤＋收案評估 | `analyze/evalCase` 搬 service；GET `/daily?date&physician` | 「日期｜醫師｜人數」按鈕列、A 已收案可否追蹤、B 未收案可否收案、詳情面板 | 未開始 |
| 3 | 個案紀錄七類 | `ckd_records` CRUD；P 碼補登／收案更正／不予收案 進入判定時間軸 | 紀錄表單、VPN 三態閉環、暫緩至 | 未開始 |
| 4 | 稽核與匯出 | 全名單稽核、檢驗總表（21 項＋eGFR 斜率）、XLSX（當日可收案名單）／CSV | 兩張總表＋匯出鈕 | 未開始 |
| 5 | 進階模組 | 召回清單、近日異常檢驗、透析準備管線、月報、檢核 P 碼 | 各一頁 | 未開始 |
| 6 | 與本站打通 | 透析準備管線 ↔ 預約洗腎登記本／首透；病歷號連到病人詳情 | | 未開始 |

## 資料模型（鍵沿用原版，見 HANDOFF §輸出契約）

- 病歷號 mrn 去前導 0。
- `ckd_cases` 唯一鍵 `mrn|visit|code|ctype`；`ckd_clinic_visits` `mrn|date|no`；`ckd_labs` `no` 或 `mrn|date|kind`；`ckd_billing` `mrn|visit|code`。
- `ckd_settings` 單列：preGap 77、earlyNew 77、earlyGap 161、dmGap 70、逾期 120、檢驗回溯 ±90（以原版 app.js:220-232 為準，README 的 180 是舊值）。

## 階段 1 要用真檔驗證的事項

- HIS「匯出 Excel」若其實是 HTML／XML（開頭 `<`），SheetJS 文字路徑 `raw:false` 會把 ISO 日期字串改寫成 `m/d/yy`，`anyDate` 讀不回來（原版同樣行為）。拿真實 HTML 匯出檔確認日期格式；若真有 ISO 日期，改 `toAoa` 文字路徑為 `raw:true` 或在 `anyDate` 加 `m/d/yy`（屬額外相容，不動原規則）。
- 0204 檔 15 萬列在後端主執行緒 `toAoa` 的耗時與記憶體；必要時搬進 spreadsheetParser 的 worker（需擴充成讀全部工作表＋文字路徑）。

## 已知雷（來自交接包）

- 解析器 `toAoa` 要先看檔頭：`<` 開頭是 XML/HTML 假 xlsx。
- 門診清單空白科別列不理；DKD 不評 Early 碼（假設待 Henry 確認）；不予收案仍列 B 區。
- 原版 SheetJS 0.18.5 有已知 CVE；後端解析改用本站現有維護中的套件，前端不再內嵌 SheetJS。
- 與本站既有「CKD 關懷名單」（住院 AKI 快照來源）是兩套來源，並存不合併。

## 進度紀錄

- 2026-09-15：盤點完成、計畫拍板。階段 0 完成（dev）：解析器 ESM 版 6 組測試通過；/api/ckd status+settings；七張表已在 3002 測試 DB 建立；頁面／側欄／改名經無頭驗證。
