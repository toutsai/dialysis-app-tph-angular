# 排程頁面功能對比測試報告

**產出日期**: 2026-04-18
**對比基準**: `toutsai/dialysis-app-angular` (Firebase 原版) vs `angular-client/` (TPH REST 對接版)
**測試範圍**: 4 個排程核心頁面 (Schedule / Weekly / BaseSchedule / ExceptionManager)
**方法**: 靜態程式碼分析 + 手動驗證 checklist

---

## 總摘要

| 頁面 | 操作總數 | 🟢 Both OK | 🟡 Diff | 🔴 Missing | ⚠️ Bug |
|------|---------|-----------|---------|-----------|--------|
| ScheduleView | 38 | 38 | 0 | 0 | 5 (code smell) |
| WeeklyView | 22 | 20 | 2 | 0 | 1 (效能) |
| BaseScheduleView | 17 | 17 | 0 | 0 | 5 (code smell) |
| ExceptionManagerView | 23 | 18 | 4 | 1 | **1 (實質 Bug)** |
| **合計** | **100** | **93** | **6** | **1** | **12** |

**整體評估**：angular-client 功能面與 Firebase 版 **93% 對等**，UI 操作幾乎完整移植。**1 個實質 Bug** 發生在 ExceptionManager 的 modeOverride（臨時透析模式 HD→HDF）—前端存資料位置與後端期望不符，導致模式覆寫失效。

---

## 🔴 關鍵發現：modeOverride 實質 Bug

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

## 建議後續行動

### 立即處理（P0）
1. **modeOverride Bug 修復**：ExceptionCreateDialog 改為 `dataToSubmit.to.mode = ...`（0.25 天）
2. **列表檢視按鈕補回**：exception-manager.component.html 新增按鈕（0.1 天）

### 次要優化（P1）
3. **輪詢縮短**：exception-manager 30s → 5-10s（0.1 天）
4. **BaseSchedule 寬鬆比較修正**：`==` → `===`（0.1 天）
5. **FREQ_MAP 無效值警告**：加 `console.warn` 便於排錯（0.1 天）

### 長期（P2）
6. **ApiManagerService 支援 where 篩選**：影響 exception-manager 訊息刪除、weekly 排程載入（0.5-1 天）
7. **實時更新替代**：SSE 或 WebSocket 取代輪詢（1-2 天）
8. **自動化測試基建**：安裝 Karma/Playwright + 核心路徑覆蓋（2-3 天）

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

# 4. 驗證 modeOverride Bug（需查 DB）
sqlite3 data/dialysis.db "SELECT data FROM schedule_exceptions ORDER BY created_at DESC LIMIT 1;"
# 預期：data JSON 的頂層有 "mode"，但 to 物件內沒有 mode → 確認 Bug
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
| 後端例外處理 | `src/services/exceptionHandler.js` | (N/A Firebase 用 Cloud Functions) |
