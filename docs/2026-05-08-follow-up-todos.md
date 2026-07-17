# 2026-05-08 下次待修事項

這份是 2026-05-08 追加的下次修改清單。接手時請先確認本檔，避免忘記使用者已提出但尚未實作的需求。

## 1. 預約變更：移除「透析頻率變更」 ✅ 已完成（2026-07-18）

> 已於 2026-07-18 實作：`new-update-type-dialog` 下拉移除 UPDATE_FREQ 選項、
> 總表規則變更括號文字改為「（頻率、班別、床位）」。歷史 UPDATE_FREQ 紀錄的
> 顯示映射（TYPE_MAP/formatPayload/表單分支）與後端處理分支刻意保留，舊紀錄
> 檢視/撤銷不受影響。

### 需求

- 在「發起新的預約變更」modal 的變更類型下拉選單中，刪除「透析頻率變更」。
- 原因：床位總表規則中已經可以直接修改頻率，不需要在預約變更中保留獨立的頻率變更入口。
- 「總表規則變更」的括號文字要改成：

```text
總表規則變更（頻率、班別、床位）
```

目前畫面中顯示的是：

```text
總表規則變更（床位/班別）
```

### 可能相關檔案

- `angular-client/src/app/features/update-scheduler/update-scheduler.component.*`
- `angular-client/src/app/components/dialogs/patient-update-scheduler-dialog/*`
- `src/routes/system.js` 或預約變更相關 route

### 注意事項

- 移除 UI 選項後，要確認後端仍能處理既有歷史資料中的 `frequency` 類型，不要讓舊紀錄讀取失敗。
- 如果有 enum/type guard，也要同步移除或轉換 UI label。

## 2. 檢驗報告管理：查詢/上傳失敗

### 現象

檢驗報告管理頁面出現 404：

```text
GET /api/patients/lab-reports/query 404 (Not Found)
GET /api/patients/lab-rep... 404 (Not Found)
```

使用者描述：「檢驗報告管理 上傳失敗」。

### 下一步調查方向

- 檢查 Angular 檢驗報告頁目前打的 API endpoint。
- 檢查 Express 後端是否有對應 route。
- 可能是前端路徑仍指向 `/api/patients/lab-reports/...`，但後端 route 實際掛在其他位置，或尚未實作。
- 同時測試：
  - 報告查詢
  - 資料上傳
  - 上傳後查詢結果是否能讀回

### 可能相關檔案

- `angular-client/src/app/features/lab-reports/lab-reports.component.*`
- `angular-client/src/app/core/services/api.service.ts`
- `src/routes/patients.js`
- 可能需要新增或修正 lab reports 專用 route

### 驗證

- 前端 console 不應再出現 `/api/patients/lab-reports/query` 404。
- 上傳成功後，頁面應能顯示或查詢到上傳結果。
- 若新增後端 route，需重啟後端。

