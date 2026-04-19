# 排程頁面功能對比測試報告

**產出日期**: 2026-04-18
**更新日期**: 2026-04-19 (新增 Patients/Stats 分析、完成 P0/P1/P2 修正)
**對比基準**: `toutsai/dialysis-app-angular` (Firebase 原版) vs `angular-client/` (TPH REST 對接版)
**測試範圍**: 4 個排程核心頁面 + 2 個延伸頁面 (Patients / Stats 護理分組)
**方法**: 靜態程式碼分析 + 手動驗證 checklist

---

## 總摘要

| 頁面 | 操作總數 | 🟢 Both OK | 🟡 Diff | 🔴 Missing | ⚠️ Bug |
|------|---------|-----------|---------|-----------|--------|
| ScheduleView | 38 | 38 | 0 | 0 | 5 (code smell) |
| WeeklyView | 22 | 20 | 2 | 0 | 1 (效能) |
| BaseScheduleView | 17 | 17 | 0 | 0 | 5 (code smell) |
| ExceptionManagerView | 23 | 18 | 4 | 1 | 1 (實質 Bug，已修) |
| PatientsView | 20 | 12 | 8 | 0 | 5 (效能/架構) |
| StatsView (護理分組) | 40 | 40 | 0 | 0 | 5 (code smell) |
| **合計** | **160** | **145** | **14** | **1** | **22** |

**整體評估**：angular-client 功能面與 Firebase 版 **90.6% 對等**。6 頁面 UI 操作完整移植。原本 1 個實質 Bug（modeOverride 靜默失效）**已於本輪修復**。其他差異集中在資料層：Firebase SDK 直連 vs REST API、Firestore `where` 伺服器篩選 vs 客戶端篩選、`onSnapshot` 實時 vs 輪詢。

---

## ✅ 本輪修復摘要 (2026-04-19)

| 優先 | 項目 | 狀態 | 修改檔案 |
|------|------|------|----------|
| P0 | modeOverride Bug（mode 改存 `to.mode`） | ✅ | `exception-create-dialog.component.ts` |
| P0 | 列表檢視按鈕（listMonth） | ✅ | `exception-manager.component.html` |
| P1 | 輪詢間隔 30s → 10s | ✅ | `exception-manager.component.ts` |
| P1 | BaseSchedule 嚴格比較 | ✅ | `base-schedule.component.ts:360` |
| P1 | FREQ_MAP 無效值警告（`resolveFreqDays` helper） | ✅ | `base-schedule.component.ts` |
| P2 | `ApiManager.fetchWhere()` + 後端 tasks `targetDate` 篩選 | ✅ | `api-manager.service.ts`, `system.js`, `exception-manager`, `weekly` |
| P2 | SSE 即時更新（`/api/events/exceptions` + EventSource，失敗回退輪詢） | ✅ | `src/services/eventBus.js`, `src/routes/events.js`, `schedules.js`（emit）, `exception-manager.component.ts`（consume） |

**設計筆記**:
- SSE 以 `?token=<JWT>` 驗證（EventSource 無法帶自訂 header）
- SSE 只廣播事件通知，不送資料本體；前端收到後重取列表（避免資料同步複雜化）
- SSE 連線失敗時自動退回 30 秒輪詢，保持可用性
- 未來若部署 PM2 cluster，需改為 Redis pub/sub

---

## 🔴 關鍵發現：modeOverride 實質 Bug（已修）

### 問題描述
CLAUDE.md 記載 Phase 2 已完成「modeOverride 排程支援」，但前後端資料路徑不一致：

**後端期望路徑** (`src/services/exceptionHandler.js:153-154, 272-273`)：
```javascript
if (to.mode) {
  newSlotData.modeOverride = to.mode   // 從 data.to.mode 讀取
}
```

**前端實際送出** (`angular-client/src/app/features/exception-manager/exception-manager.component.ts:550, 559-561`)：
```typescript
const dataToSave: any = {
  ...
  to: formData.to,              // to 物件未包含 mode
  ...
};
if (formData.mode) {
  dataToSave.mode = formData.mode;   // mode 放在頂層，不在 to 內
}
```

**ExceptionCreateDialog 輸出** (`exception-create-dialog.component.ts:174`)：
```typescript
dataToSubmit.mode = this.formData.mode || 'HD';   // 同樣放頂層
```

### 影響
- ADD_SESSION 臨時加洗與 MOVE 換班設定 HDF/SLED/CVVHDF 等非 HD 模式時，**後端不會寫入 modeOverride**，排程顯示的仍是病人原透析模式
- 訊息通知文字 `[HDF]` 正常顯示（因前端自己讀 `formData.mode` 組訊息），但實際排程記錄無 mode 標記

### 修復建議（不在本次範圍）
兩個可行方案擇一：
1. **前端改**：在 `exception-create-dialog.component.ts:174` 改為 `dataToSubmit.to.mode = this.formData.mode`
2. **後端改**：在 `exceptionHandler.js:152-154` 改為讀 `data.mode || to.mode`

---

## ScheduleView 詳細分析

### 操作對照表（38 項）

| # | 操作/按鈕 | 狀態 | 備註 |
|---|----------|------|------|
| 1 | 日期切換 (前/後一天) | 🟢 | 確認未儲存變更 |
| 2 | 回到今天 | 🟢 | 同樣確認未儲存 |
| 3 | 排程檢視 runScheduleCheck | 🟢 | 檢查重複/頻率不符/未排 |
| 4 | 簡化檢視切換 | 🟢 | |
| 5 | 住院趴趴走 Dialog | 🟢 | transportMethod 更新 |
| 6 | ICU 醫囑單 Dialog | 🟢 | 含日期切換 |
| 7 | 智慧排床 Dialog | 🟢 | BedAssignmentDialog |
| 8 | 自動分組護理 | 🟢 | executeAutoAssignment |
| 9 | 自動分組設定 ⚙️ | 🟢 | AutoAssignConfigDialog |
| 10 | 儲存排程 | 🟢 | optimizedSaveSchedule + saveTeams |
| 11 | 匯出 Excel | 🟢 | XLSX.writeFile |
| 12 | 拖放換床 onDrop | 🟢 | 重複/佔用檢查 |
| 13 | 拖曳開始 | 🟢 | sourceShiftId 設定 |
| 14 | 拖曳懸停 | 🟢 | drag-over class |
| 15 | 拖曳離開 | 🟢 | 移除 class |
| 16 | 側邊欄拖曳 | 🟢 | sourceShiftId='sidebar' |
| 17 | 病人選擇 | 🟢 | 重複排班警告 |
| 18 | 智慧排床指派 | 🟢 | handleAssignBed |
| 19 | 班次記錄總覽 | 🟢 | DailyRecordsSummaryDialog |
| 20 | 應打針劑 | 🟢 | DailyInjectionListDialog |
| 21 | 藥囑草稿 | 🟢 | DailyDraftListDialog |
| 22 | 關閉班次記錄 | 🟢 | |
| 23 | 設定住院床號 | 🟢 | 僅 ipd/er 可設定 |
| 24 | 確認床號 | 🟢 | optimizedUpdatePatient |
| 25 | 開啟醫囑單 | 🟢 | DialysisOrderModal |
| 26 | 開啟 CRRT 醫囑單 | 🟢 | CrrtOrderModal |
| 27 | 儲存醫囑 | 🟢 | createDialysisOrderAndUpdatePatient |
| 28 | 儲存 CRRT 醫囑 | 🟢 | |
| 29 | ICU 醫囑批量儲存 | 🟢 | |
| 30 | ICU 日期切換 | 🟢 | |
| 31 | 住院趴趴走儲存 | 🟢 | |
| 32 | 更新護理分組 | 🟢 | single/in/out 三類型 |
| 33 | 病人詳情點擊 | 🟢 | PatientDetailModal |
| 34 | 病人卡片切換 | 🟢 | 上一個/下一個 |
| 35 | 複製病歷號 | 🟢 | navigator.clipboard |
| 36 | 訊息圖示點擊 | 🟢 | 備忘錄/狀況紀錄 |
| 37 | 關閉備忘錄 | 🟢 | |
| 38 | 關閉狀況紀錄 | 🟢 | |

### 程式碼異味（非阻斷）
1. `handleSaveOrder:915-935` — 未檢查 `patient?.name` 是否存在
2. `exportScheduleToExcel:956` — 無 await，若 getPatientCellStyle 非同步會競態
3. `loadDataForDay:1364-1396` — `formatDate()` 無 try-catch
4. `onDrop:1169-1204` — 重複排班判斷條件分散
5. 護理分組狀態：空分組刪除無事務性保證

### 手動驗證 Checklist（Schedule）
- [ ] 前一天/後一天切換，未儲存時跳確認對話框
- [ ] 回到今天功能正常
- [ ] 排程檢視報告重複/頻率不符/未排病人
- [ ] 床位互拖：床 A ↔ 床 B 成功換位
- [ ] 空床拖曳：病人移至空床，原床清空
- [ ] 側邊欄拖入空床成功
- [ ] 重複排班警告正常彈出
- [ ] 護理分組下拉選單修改並儲存
- [ ] 午班 in/out 分組獨立控制
- [ ] 自動分組執行後三班皆有推薦
- [ ] 自動分組設定對話框儲存
- [ ] 智慧排床 dialog 寫入正確
- [ ] ICU 醫囑單日期變更與排程同步
- [ ] 班次記錄 / 針劑 / 藥囑圖示開啟正確
- [ ] 住院床號設定持久化
- [ ] 儲存排程成功，重整後保留

---

## WeeklyView 詳細分析

### 操作對照表（22 項，節錄關鍵差異）

| # | 操作/按鈕 | 狀態 | 備註 |
|---|----------|------|------|
| 1-22 | 週切換 / 頻率映射 / 拖放 / 搜尋 / 匯出 等 | 🟢 | 詳見 Explore agent 完整分析 |
| ★ | `fetchLiveSchedulesForWeek` 查詢 | 🟡 | Firebase 用 `where('date','in',...)` 伺服器篩選；angular-client 取全部後記憶體篩（`weekly.component.ts:268-273`） |
| ★ | `getWeeklyCellStyle` 返回型別 | 🟡 | Firebase: `Record<string,string>` vs angular-client: `Record<string,boolean>`（`weekly.component.ts:331`） |

### 潛在問題
1. **效能隱患**：`fetchLiveSchedulesForWeek` 客戶端篩選，資料量大時 (>1000 筆排程) 可能變慢
2. **型別定義不一致**：`Record<string,boolean>` 可能來自 `getUnifiedCellStyle` 返回型別調整，不影響 UI 但型別不嚴謹

### 手動驗證 Checklist（Weekly）
- [ ] 上/下一週切換，未儲存時確認對話框
- [ ] 回到本週（週一為起點）
- [ ] 排程檢視顯示衝突
- [ ] 智慧排床對話框，頻率自動排多日
- [ ] 搜尋病人並捲動至位置、高亮 2 秒
- [ ] 點擊空床→單次排班
- [ ] 點擊空床→依頻率排班 (一三五/二四六/一四/二五/三六/一五/二六/每日)
- [ ] 拖放換床：已排 → 空床移動、已排 → 已排交換
- [ ] 側邊欄拖到空床
- [ ] 清除單床
- [ ] 刪除病人本週全部排程
- [ ] 備忘錄對話框開啟（鎖定頁或已過日期）
- [ ] B 肝床位 [31-36] 特殊色碼
- [ ] 儲存變更成功
- [ ] 匯出 Excel 格式正確

---

## BaseScheduleView 詳細分析

### 操作對照表（17 項）

| # | 操作/按鈕 | 狀態 | 備註 |
|---|----------|------|------|
| 1 | 開啟總表編輯模式 | 🟢 | isPageLocked guard |
| 2 | 新增規則 (病人+頻率+床位) | 🟢 | PatientSelectDialog |
| 3 | 刪除規則 | 🟢 | removeRuleFromMasterSchedule |
| 4 | 變更頻率+床位 | 🟢 | change_freq_and_bed mode |
| 5 | 僅變更床位 | 🟢 | change_bed_only mode |
| 6 | 頻率衝突檢查 | 🟢 | hasFrequencyConflict |
| 7 | 拖放變更床位 | 🟢 | 保持頻率 |
| 8 | 儲存規則 | 🟢 | baseSchedulesApi.update('MASTER_SCHEDULE') |
| 9 | SelectionDialog 開啟 | 🟢 | 刪除/變更選單 |
| 10 | PatientSelectDialog | 🟢 | 只顯示已設頻率病人 |
| 11 | BedAssignmentDialog 三模式 | 🟢 | |
| 12 | 頻率顯示（8 種） | 🟢 | 一三五/二四六/一四/二五/三六/一五/二六/每日 |
| 13 | 班次切換 early/noon/late | 🟢 | 早班/午班/晚班 |
| 14 | 門/急/住色碼 | 🟢 | getUnifiedCellStyle |
| 15 | 排程檢視 | 🟢 | 3 類檢查 |
| 16 | 病人搜尋定位 | 🟢 | 2 秒高亮 |
| 17 | 匯出總表 Excel | 🟢 | |

### 程式碼異味
1. **命名錯誤** `base-schedule.component.ts:43` — `firebaseService = inject(ApiConfigService)` 應改名或移除（實際未使用）
2. **寬鬆比較** line 360 — `rule.bedNum == bedNum` 應改 `===`
3. **FREQ_MAP 無驗證** line 109, 161, 237, 619 — `FREQ_MAP_TO_DAY_INDEX[ruleData.freq] || []` 無效頻率靜默跳過
4. **Race condition** 搜尋 blur line 221-225 — `setTimeout 200ms` 可能被快速點擊搶先
5. `getBaseCellStyle:209-211` — 空物件 `{}` 作為 fallback 可能掩蓋 UI 不一致

### 手動驗證 Checklist（BaseSchedule）
- [ ] 新增規則：選病人（有頻率）→ 寫入成功
- [ ] 頻率衝突：一三五 + 二四六 OK；一三五 + 一四 應擋
- [ ] 變更頻率+床位 → 頻率下拉可選
- [ ] 僅換床 → 頻率下拉 disabled
- [ ] 刪除規則 → 確認 → 消失
- [ ] 拖放病人至空位、拖至衝突位置擋下
- [ ] 排程檢視：病床衝突、未排 IPD/ER、頻率不符
- [ ] 無頻率病人 → 「沒有設定頻率」警示
- [ ] 鎖頁模式（無權限）所有按鈕 disable
- [ ] 8 種頻率在統計列都顯示
- [ ] 早/午/晚班標籤正確
- [ ] 門/住/急色碼 (teal/red/orange)
- [ ] 病人搜尋→高亮 2 秒
- [ ] 儲存提示 "儲存中..." → "總表已更新"
- [ ] 雙分頁同步（30 秒內）
- [ ] 重複排班擋下
- [ ] peripheral-1 ~ peripheral-6 可指派

---

## ExceptionManagerView 詳細分析

### 操作對照表（23 項）

| # | 操作/按鈕 | 狀態 | 備註 |
|---|----------|------|------|
| 1 | FullCalendar 月檢視 | 🟢 | dayGrid + list 插件 |
| 2-4 | 前月/下月/Today | 🟢 | calendarApi.prev/next/today |
| 5 | **列表檢視切換** | 🔴 | **angular-client HTML 無列表按鈕** |
| 6 | 月份選擇器 | 🟢 | MonthYearPicker |
| 7 | 新增調班 openCreateDialog | 🟢 | isPageLocked 守衛 |
| 8 | MOVE 建立 | 🟢 | |
| 9 | SUSPEND 建立 | 🟢 | startDate/endDate/reason |
| 10 | **ADD_SESSION + modeOverride** | ⚠️ **BUG** | **mode 存頂層，後端讀 to.mode** |
| 11 | SWAP 建立 | 🟢 | |
| 12 | 調班合併 | 🟢 | findMergeableExceptions |
| 13 | 編輯調班 | 🟢 | |
| 14 | 刪除調班 | 🟡 | Firebase 直連 Firestore；angular-client 經 ApiManager |
| 15 | **刪除訊息任務篩選** | 🟡 | Firebase 伺服器 where；angular-client 全載再記憶體篩 |
| 16 | 確認 Dialog | 🟢 | |
| 17 | 警告 Dialog | 🟢 | |
| 18 | 狀態色碼顯示 | 🟢 | pending/applied/cancelled |
| 19 | isPageLocked 權限鎖定 | 🟢 | |
| 20 | 載入狀態 | 🟢 | |
| 21 | **即時更新機制** | 🟡 | Firebase: onSnapshot 實時；angular-client: 30 秒輪詢 |
| 22 | 訊息建立 | 🟢 | createMessageTask |
| 23 | modeText 訊息顯示 | 🟢 | [HDF] 前綴正常 |

### ⚠️ 關鍵 Bug 詳情
見報告頂端「關鍵發現」。修復後需同步回歸測試：
- 建立 ADD_SESSION 並選 HDF → DB `schedule_exceptions` 欄應包含 `to: {..., mode: 'HDF'}`
- 該日期的 `schedules` 欄應有 `modeOverride: 'HDF'`

### 其他差異（非阻斷）
1. **30 秒輪詢 vs 即時** `exception-manager.component.ts:762` — 多人協作最多延遲 30 秒；短期可降至 5-10 秒
2. **訊息篩選效能** line 658-671 — 任務數量成長後會慢；需後端支援 where filter
3. **列表檢視按鈕缺失** HTML line 30-34 — 需新增 `(click)="handleViewChange('listDayGridMonth')"`
4. **ApiConfigService 冗餘** line 49 — 未使用

### 手動驗證 Checklist（ExceptionManager）
- [ ] FullCalendar 月檢視顯示調班事件
- [ ] 前月/下月/Today 按鈕切換正確
- [ ] 週檢視切換
- [ ] **列表檢視按鈕是否存在**（預期缺失）
- [ ] 月份選擇器點擊標題開啟、跳轉正確
- [ ] 新增調班（有權限）可點，無權限 disable
- [ ] MOVE 完整流程：選病人 → 原日期 → 目標日期+床位
- [ ] **ADD_SESSION 選 HDF：DB 檢查 schedule_exceptions.to.mode 是否存在**（預期失敗）
- [ ] **ADD_SESSION 套用後 schedules 是否有 modeOverride**（預期失敗）
- [ ] SUSPEND 區間暫停建立
- [ ] SWAP 兩病人互調建立
- [ ] 編輯：事件 → 修改 → 舊記錄刪、新記錄建
- [ ] 撤銷：事件 → 撤銷 → 訊息任務與備註刪除
- [ ] 調班合併：快速建兩筆重複 ADD_SESSION 觸發整併
- [ ] 狀態標記色：待 (黃)、✓ (綠)、撤銷 (灰)
- [ ] 無 canEditSchedules 權限：所有操作 disable
- [ ] 多分頁：A 改動 B 最多 30 秒看到

---

## PatientsView 詳細分析（2026-04-19 新增）

### 操作對照表（20 項）

| # | 操作/按鈕 | 狀態 | 備註 |
|---|----------|------|------|
| 1 | 新增病人 (globalSearch) | 🟢 | PatientFormModal |
| 2 | 編輯病人 | 🟡 | Firebase: updateDoc；angular: patientsApi.update |
| 3 | 刪除病人（軟刪除） | 🟡 | 同上 |
| 4 | 復原病人 | 🟡 | Firebase 設 patientCategory；angular 無此欄位 |
| 5 | 病人狀態轉移 | 🟡 | API 層差異 |
| 6 | 排程衝突檢查 | 🔴 | Firebase: `where('date','==',dateStr)`；angular: fetchAll 全載再篩（`patients.component.ts:826`） |
| 7 | 預約變更排程 | 🟢 | scheduledChangesApi.save |
| 8 | 設定床號 | 🟡 | API 層差異 |
| 9 | 編輯透析醫囑 | 🟡 | API 層差異 |
| 10 | 暫停/中止透析 | 🟡 | 邏輯相同 |
| 11 | 自動建立任務（首透衛教/抽血） | 🟢 | createAutomatedTask |
| 12 | 病人衝突處理 | 🟡 | API 層差異 |
| 13 | 排序 | 🟢 | |
| 14 | 搜尋/篩選（er/ipd/opd） | 🟢 | |
| 15 | 全域搜尋 | 🟢 | |
| 16 | 統計顯示 | 🔴 | Firebase 用 where 時間篩選；angular: fetchAll |
| 17 | OPD 變動統計 | 🟢 | |
| 18 | 匯出已刪除清單 | 🟢 | XLSX |
| 19 | 病人歷史紀錄 | 🟢 | PatientHistoryModalComponent |
| 20 | 權限判定 (isPageLocked, isDeleteLocked) | 🟢 | |

### 程式碼異味
1. **無條件查詢效能** `patients.component.ts:826` — `checkPatientInTodaySchedule` 全載所有排程，應改 `fetchWhere({date})`
2. **統計資料全載** 行 390-395 — `fetchPatientHistoryForStats` 應支援時間範圍參數
3. **patientCategory 欄位遺失** 行 1070 — 復原時未寫入，統計可能受影響
4. **patientsApi 臨時建立** 行 712、716-717 — 應於 constructor 中建立一次，避免狀態不一致
5. **無錯誤回退** — ApiManager 連接失敗時無備援

### 手動驗證 Checklist（Patients）
- [ ] 建立新病人：輸入不存在病歷號 → PatientFormModal 開啟
- [ ] 編輯病人：修改名字/醫師 → 儲存成功
- [ ] 刪除病人並選原因 → isDeleted + deleteReason 寫入
- [ ] 復原已刪除病人 → status 恢復
- [ ] 轉移病人狀態 OPD→IPD → wardNumber 設定
- [ ] 排程衝突流程 → SchedulerDialog 開啟
- [ ] 設定/編輯床號持久化
- [ ] 編輯透析醫囑：dialysisOrders 儲存
- [ ] 暫停/中止透析 → removeRuleFromMasterSchedule 呼叫
- [ ] 首透衛教勾選 → Task 自動建立
- [ ] 全域搜尋存在病人 → 轉移對話
- [ ] 統計顯示：新增/轉出/死亡數字正確
- [ ] 匯出已刪除清單 → Excel 檔產出
- [ ] Viewer 權限：編輯按鈕 disabled
- [ ] 病人歷史紀錄 modal 正確顯示

---

## StatsView 詳細分析（護理分組 A-K，2026-04-19 新增）

### 操作對照表（40 項，歸類節錄）

| # | 操作/按鈕 | 狀態 | 備註 |
|---|----------|------|------|
| 1 | A-K 分組 + 外圍 + 未分組顯示 | 🟢 | 13 個 team；外圍排序魔數 100 |
| 2-4 | 日期切換（前/後/今日） | 🟢 | 未儲存確認對話框 |
| 5-8 | 班次切換（早班/午班上針/午班收針/晚班） | 🟢 | toggleNoonTakeoff |
| 9-12 | 病人卡片（名稱/訊息圖標/狀態標籤/HDF 模式） | 🟢 | |
| 13 | 點擊病人 → 換床對話框 | 🟢 | isPageLocked 守衛 |
| 14-18 | 拖放、team 變更（nurseTeam/In/Out、跨班次） | 🟢 | 5 種 responsibility |
| 19 | 跨班次拖放 → applyTeamAndScheduleChange | 🟢 | **無原子性保證，網路中斷可能遺失** |
| 20 | 儲存排程 | 🟢 | 清除 team 屬性後 save |
| 21 | 護理長名稱顯示 | 🟢 | currentTeamsRecord.names |
| 22 | 分組設定 | 🟢 | 透過 nurseName 存在 teams.names |
| 23-24 | 新增/移除夜班收針分組 | 🟢 | duplicateLateShiftForTakeOff |
| 25-26 | 列印 / 匯出 Excel | 🟢 | XLSX，三班分開 |
| 27-28 | 自動更新 / 手動重新整理 | 🟢 | loadData 循環 |
| 29 | 未排床位警告（未分組欄） | 🟢 | |
| 30-32 | 交辦 / 調班申請 / 預約變更 dialog | 🟢 | |
| 33-36 | 備物清單 / 針劑 / 醫囑 / Memo | 🟢 | |
| 37 | 病況記錄 | 🟢 | |
| 38-39 | 權限檢查（編輯保護、按鈕禁用） | 🟢 | isPageLocked |
| 40 | 護理長預科（loadDailyStaffInfo） | 🟢 | physician_schedules |
| ★ | `getEffectiveOrdersForDate` 查詢 | 🟡 | Firebase 用 where+orderBy+limit；angular fetchAll 後本地處理 |
| ★ | 時間戳記 | 🟡 | Firebase serverTimestamp vs angular new Date().toISOString() |

### 程式碼異味
1. **N+1 查詢** `stats.component.ts:489-507` — `getEffectiveOrdersForDate` 全載醫囑歷史後本地過濾
2. **時間戳記不一致** 行 1169 — 客戶端時間可能有時鐘差
3. **未使用方法** 行 489 — `getEffectiveOrdersForDate` 似未被呼叫，建議移除
4. **跨班次拖放無事務** 行 729-738 — 網路中斷可能遺失指派
5. **外圍床位排序魔數** 行 383-384 — 假設床號 < 100，未來擴充可能失效

### 手動驗證 Checklist（Stats）
- [ ] A-K + 外圍 + 未分組 13 欄完整顯示
- [ ] 日期切換：前/後/回今日，statusIndicator 正常
- [ ] 拖曳病人早班→晚班 → hasUnsavedScheduleChanges = true
- [ ] 拖曳 A 組→B 組（同班次）僅改 nurseTeam
- [ ] 點擊病人 → BedChangeDialog
- [ ] 新增夜班收針分組 → 第三 section 出現
- [ ] 夜班收針內拖曳 → nurseTeamTakeOff 設定
- [ ] 移除夜班收針分組 → section 消失
- [ ] 匯出 Excel：早/晚/夜班收針分開，A-K+未分組欄
- [ ] isPageLocked 時拖放被擋
- [ ] 調班申請 / 預約變更 / 交辦 dialog
- [ ] 病人訊息圖標 → Memo / 病況 / 針劑 / 醫囑
- [ ] 應打針劑圖示 → showInjectionList 按床號排序

---

## 已完成項目（本輪落地）

所有 P0/P1/P2 建議皆已實作完成：

| 優先 | 項目 | 狀態 |
|------|------|------|
| P0 | modeOverride Bug 修復 | ✅ |
| P0 | 列表檢視按鈕（listMonth） | ✅ |
| P1 | 輪詢 30s → 10s（SSE 失敗 fallback） | ✅ |
| P1 | BaseSchedule `==` → 嚴格比較（String / Number 轉型） | ✅ |
| P1 | FREQ_MAP 無效值 `resolveFreqDays` + console.warn | ✅ |
| P2 | `ApiManager.fetchWhere()` + 後端 tasks `targetDate` 篩選 | ✅ |
| P2 | SSE 即時更新（`/api/events/exceptions`）+ 輪詢 fallback | ✅ |

## 本輪 Batch A + B 修復（2026-04-19 晚段）

### Batch A（code smell 清理，8 項）
| # | 頁面 | 項目 | 修改檔案 | 狀態 |
|---|------|------|----------|------|
| A1 | Schedule | `handleSaveOrder` 加 `patient.name` fallback 訊息 | `schedule.component.ts:930` | ✅ |
| A2 | Schedule | `loadDataForDay` 把 `formatDate` 包入 try-catch | `schedule.component.ts:1369-1378` | ✅ |
| A3 | Schedule | `exportScheduleToExcel` 檢視後確認非 bug（同步 XLSX） | — | ⏭️ 跳過 |
| A4 | Weekly | `getWeeklyCellStyle` 型別問題 | — | ⏭️ 跳過（angular-client 已是正確 `CellStyleResult` 型別） |
| A5 | BaseSchedule | 刪除未使用的 `firebaseService` 注入（重命名過於表面） | `base-schedule.component.ts` | ✅ |
| A6 | BaseSchedule | `handleSearchBlur` setTimeout 200ms | — | ⏭️ 跳過（click-outside 標準模式） |
| A7 | BaseSchedule | `getBaseCellStyle` 返回型別 `any` → `CellStyleResult` | `base-schedule.component.ts:218` | ✅ |
| A8 | Exception | 移除 `ApiConfigService` 冗餘 | — | ⏭️ 保留（SSE getToken 使用中） |
| A9 | Exception | 移除 memos 清理 dead code（TPH memos 表無 patientId/targetDate 欄位） | `exception-manager.component.ts:662-695` | ✅ |
| A10 | Stats | 移除未使用方法 `getEffectiveOrdersForDate` + `ordersHistoryApi` 注入 | `stats.component.ts:489-507` | ✅ |
| A11 | Stats | 外圍床位 `100` → `PERIPHERAL_BED_SORT_ORDER = 9999` 常數 | `stats.component.ts:381-383` | ✅ |
| A12 | Stats | `serverTimestamp()` vs ISO | — | ⏭️ 跳過（ISO 字串格式足夠，客戶端時差無實務影響） |

### Batch B（效能優化，3 項）
| # | 項目 | 修改檔案 | 狀態 |
|---|------|----------|------|
| B1 | Patients `checkPatientInTodaySchedule` 改用 `fetchWhere({ date })` | `patients.component.ts:826` | ✅ |
| B2 | Patients `fetchPatientHistoryForStats` 改用 `fetchWhere({ since })` | `patients.component.ts:395` | ✅ |
| B3 | 後端 `GET /api/patients/history` 新增 `since`/`until`/`patientId`/`eventType`/`limit` query params | `src/routes/patients.js:312` | ✅ |

### 設計說明
- **memos dead code 移除**：TPH `memos` 表僅有 `date / content / author_id / author_name` 欄位，沒有 `patientId` 或 `targetDate`，Firebase 版的 memo 清理邏輯在 TPH 後端不可能匹配任何資料。移除該段邏輯而非強行擴充 schema，因為該清理功能在 TPH 從未真的作用過。
- **patient_history limit 策略**：無 query params 時維持 `LIMIT 100`（向下相容）；加了篩選才允許至 1000，極限 5000。避免無意中全表掃描。
- **PERIPHERAL_BED_SORT_ORDER = 9999**：原本魔數 100 在床號擴充超過 100 時會排錯。9999 為 SQLite INTEGER 慣用 sentinel，預留擴充空間。

## Batch C 處理結果（2026-04-19 深夜）

| # | 項目 | 處理方式 | 狀態 |
|---|------|----------|------|
| C1 | Schedule `onDrop` 條件重構 | 依使用者規格：床位↔床位 互換/搬移；側欄→已排病人 = 提示禁止（取消原確認對話框） | ✅ |
| C2 | Schedule 護理分組儲存事務性 | 新後端 `PUT /api/schedules/:date/with-teams` 包 `db.transaction()`；Schedule 與 Stats 雙頁改用新 endpoint | ✅ |
| C3 | Patients `patientCategory` 欄位恢復 | 驗證發現 angular-client 早已寫入此欄位（`patients.component.ts:1073`），後端 schema 亦有 `patient_category` 欄（`schema.sql:71`），原 Explore 報告為誤報 | ✅ 無需修改 |
| C4 | Patients `patientsApi` 初始化 | 移除 `patients.component.ts:721` 的臨時 `const patientsApi = ...`，統一用 `this.patientsApi` | ✅ |
| C5 | Stats 跨班次拖放原子性 | 與 C2 共用新 endpoint `PUT /:date/with-teams`；當 schedule + teams 同時 dirty 時走原子路徑 | ✅ |
| C6 | 自動化測試基建 | Karma/Playwright 擇一尚未決定 | ⏸️ 待決策 |

### C1 行為對照

| 情境 | 原行為 | 新行為 |
|------|--------|--------|
| 床位 A → 空床 B | 病人從 A 搬到 B，A 清空 | 相同 |
| 床位 A → 有病人的 B | 兩人互換 | 相同 |
| 側欄 → 空床（病人當日無排班） | 寫入 | 相同 |
| 側欄 → 空床（**病人當日已排班**） | 彈確認對話框，允許重複 | **提示並禁止**（不再能重複排班） |
| 側欄 → 已佔用床 | 提示失敗 | 相同 |

### C2/C5 設計

- 後端 `PUT /api/schedules/:date/with-teams`
  - Body: `{ schedule?, names?, teams?, takeoffEnabled? }`
  - 在 `db.transaction(() => {...})` 內同時寫 `schedules` + `nurse_assignments`
  - 任一步失敗整個回滾
- 前端 `saveScheduleWithTeams(date, payload)` in `nurseAssignmentsService.ts`
- Schedule.saveDataToCloud / Stats.saveChangesToCloud：
  - 兩者皆 dirty → 走原子 endpoint
  - 只有其中一種 dirty → 維持舊的單一 endpoint（無事務需求）

---

## 執行手動驗證的指令

```bash
# 1. 啟動後端（TPH Express + SQLite）
npm run dev                  # port 3000

# 2. 啟動 Angular 前端（另一個 terminal）
npm run dev:angular          # port 5173，自動 proxy → localhost:3000

# 3. 開瀏覽器
# http://localhost:5173
# 登入後依本報告 checklist 逐項驗證

# 4. 驗證 modeOverride 修復（需查 DB）
sqlite3 data/dialysis.db "SELECT to_data FROM schedule_exceptions ORDER BY created_at DESC LIMIT 1;"
# 修復後應看到：to_data JSON 內含 "mode": "HDF"（非 HD 時）
sqlite3 data/dialysis.db "SELECT date, schedule FROM schedules WHERE date = '<YYYY-MM-DD>';"
# 排程內該床位的 slot 應含 "modeOverride": "HDF"

# 5. 驗證 SSE 即時更新
# 開兩個瀏覽器分頁都進調班管理頁，A 分頁建立新調班 → B 分頁應於 1-2 秒內自動更新
# 若後端重啟過，EventSource 會自動重連
```

---

## 附錄：對比檔案路徑

| 頁面 | angular-client | Firebase (已 clone) |
|------|---------------|---------------------|
| Schedule | `angular-client/src/app/features/schedule/schedule.component.ts` | `/tmp/dialysis-app-angular-firebase/src/app/features/schedule/schedule.component.ts` |
| Weekly | `angular-client/src/app/features/weekly/weekly.component.ts` | `/tmp/dialysis-app-angular-firebase/src/app/features/weekly/weekly.component.ts` |
| BaseSchedule | `angular-client/src/app/features/base-schedule/base-schedule.component.ts` | `/tmp/dialysis-app-angular-firebase/src/app/features/base-schedule/base-schedule.component.ts` |
| Exception | `angular-client/src/app/features/exception-manager/exception-manager.component.ts` | `/tmp/dialysis-app-angular-firebase/src/app/features/exception-manager/exception-manager.component.ts` |
| ExceptionCreateDialog | `angular-client/src/app/components/dialogs/exception-create-dialog/` | `/tmp/dialysis-app-angular-firebase/src/app/components/dialogs/exception-create-dialog/` |
| Patients | `angular-client/src/app/features/patients/patients.component.ts` | `/tmp/dialysis-app-angular-firebase/src/app/features/patients/patients.component.ts` |
| Stats (護理分組) | `angular-client/src/app/features/stats/stats.component.ts` | `/tmp/dialysis-app-angular-firebase/src/app/features/stats/stats.component.ts` |
| 後端例外處理 | `src/services/exceptionHandler.js` | (N/A Firebase 用 Cloud Functions) |
| 後端 SSE | `src/routes/events.js`, `src/services/eventBus.js` | (N/A) |
