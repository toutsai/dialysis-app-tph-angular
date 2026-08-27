# 病人基本資料單一權威（期 1）實作計畫

日期：2026-08-27　狀態：待動工
決策脈絡：使用者拍板「一份資料、多個入口」——病人層級是唯一權威，KiDit 建檔表單與病人清單「基本資料」頁籤都是它的編輯入口，KiDit 事件上的 `kidit_profile` 保留為申報快照（不追溯）。未來 HIS 串接只是多一個寫入者，不需反向同步。
欄位對照（KiDit 官方 ↔ HIS 截圖）：見同日對話；地址存整串 + 郵遞區號、血型單欄（HIS 優先序 檢驗>血庫>自述，期 3 才用）。

## 0. 關鍵事實（動工前必知）

- `patients.patient_category` **已存在**且意義是 `opd_regular/non_regular`（schema.sql:71、migrate.js:93、backfill-patient-census.mjs:53）。KiDit 02 病患類別（00 健保/11 自費）必須另用欄位 **`kidit_patient_category`**。
- `formatPatient`（patients.js:307-360）與 `toDbFormat`（367-449）都是白名單；不加就不會回傳、不會寫入。
- `GET /patients/:id` 從不回 `kiditProfile`；`kidit-patient-form.component.ts:62` 的 `p.kiditProfile || {}` 是死碼。
- `PUT /patients/:id`（updatePatientHandler 1394-1700）純人口學修改**不會**寫 patient_history / 工作日誌（分支只看 status/isDeleted/mode），但它是 `isContributor`、又帶一堆副作用，故基本資料另開端點。
- KiDit 存檔路徑：前端 `kiditService.updateEventKiDitData` → `PUT /nursing/kidit-logbook/:date/events`（nursing.js:1905）整包覆寫；`stampKiditSavedMeta`（1874-1899）已逐事件 diff `kidit_profile` 新舊 → **回寫 hook 放這裡**。
- 「每人最新 kidit_profile」掃描已有兩處實作：catastrophicIllness.js:553-588、nursing.js:1756-1788；回填腳本沿用同一判準（有 idNumber 的最新事件）。
- KiDit 表單**沒有** mobile/postal_code/registered_city/is_foreign；這四個是病人層級獨有。
- RBAC：`isEditor`（auth.js:463）；前端 `authService.canEditPatients`（auth.service.ts:119）。

## 1. 欄位與對照

### patients 新增欄位（migrate.js `addColumnIfNotExists`）
`mobile, postal_code, registered_city, is_foreign, blood_type, marital_status, education, occupation, is_indigenous, is_welfare, kidit_patient_category, contact_relationship, basic_source DEFAULT 'manual', his_synced_at`（全 TEXT；Y/N 存 KiDit 碼字串）
沿用既有：`name, medical_record_number, id_number, birth_date, gender('男'/'女'), phone, address, emergency_contact, emergency_phone, first_dialysis_date`

### 新表 patient_kidit_profile（KiDit 獨有 6 欄，1:1）
```sql
CREATE TABLE IF NOT EXISTS patient_kidit_profile (
  patient_id TEXT PRIMARY KEY,
  dialysis_code TEXT, kidit_status TEXT, hospital_start_date TEXT,
  diagnosis_category TEXT, diagnosis_subcategory TEXT, catastrophic_card_no TEXT,
  updated_by TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
)
```
schema.sql 同步補上。

### kidit_profile → 病人層級對照
| kidit_profile | 目標 | 規則 |
|---|---|---|
| idNumber | patients.id_number | 覆寫 |
| medicalRecordNumber | patients.medical_record_number | **只補空，永不覆寫**（識別鍵） |
| birthDate | birth_date | 覆寫 |
| gender '1'/'2' | gender '男'/'女' | 雙向轉換在邊界 |
| patientCategory | kidit_patient_category | 覆寫 |
| bloodType / maritalStatus / education / occupation | 同名 snake | 覆寫 |
| isIndigenous / isWelfare | is_indigenous / is_welfare | 覆寫 |
| phone / address | phone / address | 覆寫 |
| contactPerson | **emergency_contact**（沿用） | 覆寫 |
| relationship | contact_relationship | 覆寫 |
| firstDialysisDate | first_dialysis_date | 只補空（顯示權威仍是 patientStatus.isFirstDialysis.date） |
| dialysisCode / status / hospitalStartDate / diagnosisCategory / diagnosisSubcategory / catastrophicCardNo | patient_kidit_profile.* | 覆寫 |
| name | 忽略 | patients.name 是權威 |

## 2. 後端步驟

B1 `src/db/migrate.js`：在 `if (patientsExists)` 區塊（~124 之後）加 14 欄；另加 `patient_kidit_profile` 建表（pattern 747-763）。
B2 `src/routes/patients.js`：`formatPatient` 補 14 個 camelCase 鍵；`toDbFormat` 鏡像。列表 `PATIENT_SELECT_COLUMNS`（263）不動。
B3 新服務 `src/services/patientBasicProfile.js`：
  - `upsertPatientBasicProfile(db, patientId, fields, kiditProfile, { source, user })`（單一 transaction：UPDATE patients + UPSERT patient_kidit_profile + logAudit）
  - `mapKiditProfileToBasic(profile)` / `mapKiditProfileToKidit(profile)`（含性別轉換、只補空欄位規則）
  - 未來 HIS adapter 直接呼叫同一支。
B4 端點：
  - `GET /patients/:id`（1291）LEFT JOIN patient_kidit_profile → 回應多 `kiditProfile: {...} | null`（僅單筆，列表不加）。
  - `PUT /patients/:id/basic-profile`（`...isEditor`，放在 `router.put('/:id')` 1702 之前；pattern 同 problem-profile 1964-1990）。Body = 平面人口學欄位 + `kiditProfile{}`；白名單 `BASIC_FIELD_MAP`；回 `formatPatient(refetch) + kiditProfile`。
B5 回寫 hook `src/routes/nursing.js` `stampKiditSavedMeta`（1883-1897）：`kidit_profile` 有變的事件收集 `{patientId, profile}`，PUT handler（1910）在 `updateKiditEvents` 後逐筆呼叫 `upsertPatientBasicProfile(..., {source:'kidit'})`，try/catch + warn（回寫失敗不能讓 KiDit 存檔失敗）。事件快照不動。`syncEventsToKiditLogbook` 重建路徑不經此 hook（正確）。

## 3. 前端步驟

F1 `core/models/patient.model.ts`：Patient 介面加 14 個 optional 欄位 + `kiditProfile?: PatientKiditProfile | null`。
F2 `patient-summary.component.html`：病人選擇器（3-48）保持共用在上方；`summary-card` 標頭（54-63）之後加子頁籤列「基本資料 / 本院履歷」（樣式沿用 patients.component 的 `stat-tag`）；既有區塊（65 起）包 `@if (subTab()==='history')`。`.ts` 加 `subTab = signal<'basic'|'history'>('history')`（預設本院履歷，回填驗證後可改）。
F3 新元件 `features/patients/patient-basic-profile/`（不嵌 `app-kidit-patient-form`：其 save 綁死事件、無四個新欄、樣式仿官方）：
  - `@Input() patient`、`@Output() saved`；`readOnly = !auth.canEditPatients()` → viewer 唯讀且身分證遮罩 `A12****789`
  - 碼表沿用 `KIDIT_OPTIONS`；民國/西元換算從 kidit-patient-form（102-139）抽到 `utils/rocDate.ts` 共用
  - 存檔 `PUT /patients/:id/basic-profile` → emit → patient-summary 更新 + patientStore 重載（讓清單的 idNumber/phone 同步）
F4 `kidit-patient-form.component.ts` initData（57-93）：`initialData`（已存快照）優先不變；否則平面欄位從 `masterPatient.*` 帶（性別 '男'→'1'）、六個 KiDit 獨有欄從 `masterPatient.kiditProfile`。不需改 plumbing（`fetchPatientMasterRecord` 就是 GET /patients/:id）。
F5 `patient-form-modal`（新增/編輯病人）：不加欄位、不改。

## 4. 回填腳本 `scripts/backfill-basic-profile-from-kidit.mjs`

- CLI 沿用 backfill-patient-census.mjs（`--db=`、`--dry`、`DB_PATH`）；先檢查 `patient_kidit_profile` 已存在（migration 已跑）。
- 非 dry：`db.backup()` 到 `data/backups/dialysis-before-basic-backfill-<stamp>.db`（.claude/skills/db-backup.md:35-41）。
- 掃 `kidit_logbook` 全部事件，每病人取 `kidit_profile_saved_at` 最新（fallback 日期最新）且有 `idNumber` 的事件。
- **規則**：patients 欄位**只補空**（清單是護理師維護的權威，快照可能較舊）；`patient_kidit_profile` 覆寫（本來是空表）。有寫到才標 `basic_source='kidit_backfill'`。
- 單一 transaction；輸出 `data/backups/basic-backfill-<stamp>.json`（每人寫了哪些欄）供逆轉；dry-run 印 diff。

## 5. 驗證

1. `node --check`：migrate.js、patients.js、nursing.js、patientBasicProfile.js、回填腳本。
2. dev 3002 smoke（必設 `PORT=3002`、`SMOKE_BASE_URL`、`DB_PATH` 指測試 DB）；新增案例：editor PUT basic-profile 200 且 GET 回 bloodType+kiditProfile；viewer 403；PUT kidit-logbook events 改 kidit_profile → patients 列更新；該病人 patient_history 筆數與 daily_logs 動態**不變**。
3. 回填：dev 測試 DB `--dry` 看 diff → 真跑 → 基本資料頁籤抽 3 人 → 確認 .db 備份存在。
4. 手動 3002：病歷查詢 → 基本資料改存 → KiDit 建檔 prefill 顯示 → 在 KiDit 改一欄存 → 回基本資料已更新；viewer 唯讀。
5. `npm run build:angular`（dev）→ merge main → build → `pm2 restart`（後端有改）→ 正式 DB 跑回填（先備份）。

## 6. 風險 / 已定

- 身分證 PDPA：`idNumber` 本來就在 GET /patients 全角色可見；UI 對 viewer 遮罩。
- `emergency_contact` 沿用為 KiDit 聯絡人（不另開 contact_person）。
- `hepatitis_status` 另有權威（四態），不碰。
- 覆寫政策：KiDit 存檔 = 覆寫病人層級（護理師剛編輯＝最新意圖），MRN/初透日只補空；**KiDit 空白＝沒填不清除**（`skipEmpty`，審查時發現舊事件空字串會洗掉基本資料頁填好的值）；回填 = 只補空 + 略過空值。基本資料頁手動清除才會寫空。頁籤 UI 加一行提示。
- `registered_city` 先自由文字（無碼表）。
