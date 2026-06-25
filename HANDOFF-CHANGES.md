# 線上修正交接清單（2026-05，需同步回 GitHub 原始 repo）

## 背景 / 重要

- 本機 `D:\dialysis-app-angular` **無 git、非 git 工作樹**；以下改動是直接套在部署副本並已 build + PM2(`dialysis-server-angular`, port 3001)重啟上線。
- **這些原始碼檔案即最終正確版本**（只有 `dist/` 是建置產物）。同步方式：用本機這些檔案去比對/覆蓋真正的 GitHub repo 對應檔，再於該 repo commit。
- `dist/` **不要直接複製**；於原 repo 改完原始碼後跑 `npm run build:angular` 重新產生（若該 repo 慣例有 commit dist 才一併處理）。
- ⚠️ Part B 是「使用者管理」模組的行為變更（讓專科護理師也能存員編/電話），非單純前端；review 時注意。

---

## 後端 `src/`

### 1. `src/routes/orders.js`
- **`LAB_ITEM_MAPPING`**（約 line 110-155）末端新增別名（保留原有 key）：
  - 病毒標記：`HBsAg:'HBsAg'`、`'Anti-HBs':'AntiHBs'`、`'Anti-HCV':'AntiHCV'`
  - 真實 HIS 名別名：`'尿酸(血)':'UricAcid'`、`'肌酐(血)(洗腎專用)':'Creatinine'`、`平均血球容積:'MCV'`、`紅血球分佈寬度:'RDW'`、`腎絲球過濾率:'eGFR'`、`三酸甘油脂:'Triglyceride'`、`膽固醇:'Cholesterol'`、`高密度脂蛋白膽固醇:'HDL'`、`低密度脂蛋白膽固醇:'LDL'`、`完整型副甲狀腺素:'iPTH'`、`總鐵結合能:'TIBC'`、`總蛋白:'TotalProtein'`、`'B型肝炎表面抗原':'HBsAg'`、`'B型肝炎表面抗體':'AntiHBs'`、`'C型肝炎抗體':'AntiHCV'`
  - 原因：HIS Excel 細項名稱與舊 mapping key 不符 → 該項匯入被丟棄 → 缺漏比對假性缺項。
- **`GET /lab-alert-analyses`**：`patient_id = ?` 改為支援逗號多 ID 的 `IN (...)`（比照 `patients.js` `/lab-reports` 慣例）。
- **新增 `POST /lab-alert-analyses/query`**：收 `{field,values}` → `WHERE col IN (...)`，比照 `patients.js:640` `/lab-reports/query`。修「警示報告」404。

### 2. `src/routes/system.js`
- **新增 `GET /api/system/physician-schedules`**（list，放在 `/physician-schedules/:date` GET 之前）：撈全部 `physician_schedules`，由 id（`YYYY-MM`）解出 `year/month`，spread 解析後的 `schedule_data`。修「醫師班表→今年累計」全 0（前端 `fetchAll()` 之前打不到 list 端點）。

### 3. `src/routes/auth.js`（Part B）
4 處 `=== '主治醫師'` → `['主治醫師','專科護理師'].includes(...)`：
- directory 合併 `if (u.title === '主治醫師' && physicianMap[u.id])`（兩處：directory 與 admin list，replace-all）
- POST 建立 upsert `if (title === '主治醫師')`
- PUT 更新 upsert `if (finalTitle === '主治醫師')`
讓專科護理師也寫入/回傳 `physicians.staff_id/phone`。（已確認 `/api/system/physicians` 消費端僅當 id→記錄查表用，不污染。）

---

## 前端 `angular-client/src/`

### 4. `utils/firestoreUtils.ts`
`COLLECTION_ROUTE_MAP` 新增 `lab_alert_analyses: '/orders/lab-alert-analyses'`（修警示報告 404；此檔的 map 與 api.service 的是不同份）。

### 5. `app/features/update-scheduler/update-scheduler.component.ts`
- `STATUS_MAP` 補 `processed/failed/cancelled` 並保留舊 `completed/error`（後端 cron 寫 processed/failed，前端原只認 completed/error → 灰底問號）。
- 詳情錯誤訊息判斷 `status === 'error'` → 加 `|| 'failed'`。
- `calendarOptions` `initialView: 'dayGridMonth'` → `'dayGridWeek'`（預設週檢視）。

### 6. `app/features/exception-manager/exception-manager.component.ts`
`initialView: 'dayGridMonth'` → `'dayGridWeek'`。

### 7. `app/layouts/main-layout.component.html` / `.css`
- `.html`：移除「調班換床」「預約變更」的 `<span class="nav-hint">` 兩處小字。
- `.css`：刪除已無用的 `.nav-hint` 規則；`.notification-user`/`.notification-time` 字級 `0.83rem → 0.72rem`。
- （頁面名稱靠右曾試後還原 → 維持原靠左；即時動態訊息字級曾改後還原為原值 `0.94rem`/`line-height:1.3`。最終 `.nav-item-content` 無 `justify-content`。）

### 8. `components/lab-med-correlation-view/lab-med-correlation-view.component.html`
兩處 `@if (processedLabs[labKey]?.[month] !== undefined)` → `!= null`，內層存取補 `?.`。
原因：Angular 模板 `?.` 回傳 **null** 非 undefined，`!== undefined` 守衛誤成立 → `undefined['2026-05']` 崩潰。

### 9. `components/patient-lab-summary-panel/patient-lab-summary-panel.component.html`
同 8：`processedReports[itemKey]?.[month] !== undefined` → `!= null` + 內層 `?.`。

### 10. `app/features/lab-reports/lab-reports.component.ts`（多項）
- `generateAlertReport()`：修 N+1 —— `labReportsApi.fetchAll()` 移出 for 迴圈只撈一次，用 `Map<patientId,reports[]>` 分組；`requiredMonths` 提出迴圈;新增 `patientDataForReport.freq = scheduleInfo?.freq || patient.freq || 'N/A'`（freq 改與班別/床號同源自 MASTER_SCHEDULE）。
- 新增常數 `LAB_ITEM_LABELS`（data短碼→HIS 細項名稱）、`MONTHLY/QUARTERLY/SEMI_ANNUAL/ANNUAL_ITEMS`、`requiredItemsForMonth()`。
- `findMissingPatients()`：由「整張報告全缺才列」改為**依查詢月份套組逐項比對**（聯集該病人該月所有報告已有值的項，缺項才列，每人只列缺的項）。
- 決策：CBC 以 Hb 代表；AST/GOT、Alkaline phosphatase 排除；HBsAg/AntiHBs/AntiHCV 納入。

### 11. `app/features/lab-reports/lab-reports.component.html`
- 補登清單 `*ngFor="let item of manualEntryItems"` → `*ngFor="let item of patient.missingItems"`。
- 面板說明文字改為逐項比對描述。

### 12. `app/features/physician-schedule/physician-schedule.component.ts` / `.html`
- 新增 `exportRoundingWord()`：HTML→`.doc`（`application/msword`），含 Word MSO Section 版面（A4 直式 0.5cm）、整月查房週曆表（一~六、無週日）、姓氏顯示、20pt 全粗體、列高 22pt（6 週剛好單頁）。
- `.html`：標題列（header-left）新增「匯出 Word」按鈕 `(click)="exportRoundingWord()"`。

### 13. `components/dialogs/user-form-modal/user-form-modal.component.ts` / `.html`（Part B）
- `.ts` `onTitleChange()`、`handleSubmit()`：員編/電話對「主治醫師|專科護理師」保留（門診/預設班表仍只主治醫師）。
- `.html`：員編/電話 `@if` 條件含專科護理師；預設查房/會診班表用內層 `@if (form.title === '主治醫師')` 包住。

---

## 同步後

1. 於原 repo 改完上述檔案 → `npm run build:angular` 重建 → 依該 repo 部署流程上線。
2. Part B 上線後，需管理員到「使用者管理」逐一替每位專科護理師補填員編/電話（舊資料為空）。
3. 真實 HIS 名仍以院方實際 Excel 為準；若再有對不到項目，於 `orders.js LAB_ITEM_MAPPING` 補別名即可。
