# 【史料】Angular 前端遷移計畫與稽核（2026-04，已全部完成）

> **狀態：已完成，僅供考古。不要照本檔開工。**
> 遷移於 2026-04-16 完成：Angular 前端已整合進 `angular-client/`，Phase 1–5、7 已實作，Phase 6（病人照片上傳）確認為孤兒功能後刪除。
> 完整原文（含 endpoint 對照清單與 7 Phase 細節）保存在 `docs/claude/archive/CLAUDE-2026-07-06.md` 的「Angular 前端遷移計畫」一節。

## 最終結果摘要

- 相關歷史專案：`dialysis-app-angular`（Firebase 雲端版）、`dialysis-app-angular-standalone`（自帶 Express/SQLite）、本 repo（醫院正式後端，PM2 部署）。
- 2026-04-15 稽核結論：TPH 後端 107+ endpoint 覆蓋 ~90% 前端需求，真正缺的只有 7 個 Phase 的補齊工作。
- 已完成項目：
  - Firebase 殘留清理（shims、environment configs、firebase.service.ts）
  - COLLECTION_ROUTE_MAP 對齊 TPH 後端
  - Phase 1: `POST /api/auth/refresh-token`
  - Phase 2: modeOverride 排程支援（exceptionHandler.js handleMove/handleAddSession）
  - Phase 3: `GET/PUT /api/system/auto-assign-config/current`
  - Phase 4: `GET/PUT /api/orders/bed-settings`、`machine-bicarbonate-config`
  - Phase 5: PATCH→PUT middleware（schedules.js、nursing.js）
  - Phase 7: `GET/PUT /api/system/config/:key`（site-config 別名）
- ❌ Phase 6（病人照片上傳）：前端元件未被使用，功能移除，未實作後端。
