# Harness 診斷（2026-07-06，Fable 5 制度建立 session）

本檔是後面所有制度檔的依據。列出此環境最漏 token、最易失焦、最易出錯的前三名，各附具體修法與修法落點。

## 第 1 名：CLAUDE.md 六成是史料，且自相矛盾（最大 token 漏 + 誤導源）

**證據**（重寫前的版本已存檔於 `docs/claude/archive/CLAUDE-2026-07-06.md`）：

- 316 行中約 170 行（「Angular 前端遷移計畫」整節：endpoint 對照清單、7 Phase 計畫、工時估算）描述的是 **2026-04-16 已全部完成** 的工作。每個 session 都白付這些 token。
- 更糟的是自相矛盾：「實作優先順序」表格寫 Phase 1–7 全部「**待實作**」，往下 80 行的「Angular 整合狀態」又寫全部「**✅ 完成**」。弱模型很可能照表開工、重做已完成的 Phase。
- 結構清單過時：漏了 3 個路由（`aki.js`、`dashboard.js`、`events.js`）與 7 個 service（`akiService`、`dailyInjectionService`、`dashboardDataService`、`dashboardPinService`、`eventBus`、`exceptionReconcile`、`nurseAssignmentRevisions`），也漏了 `npm run smoke:tph-angular`。
- `AGENTS.md`（296 行）是 CLAUDE.md 的**過時舊快照**（缺同步鏈路、透析模式正規化、上述新路由），非 Claude Code 的工具會載入它，兩份檔案已 drift。

**修法**（本 session 已執行）：

- CLAUDE.md 重寫為精簡核心（不變式 + 陷阱警告 + 文件路由表），史料移入 `docs/claude/archive/migration-history-2026-04.md` 並在開頭標明「已完成，僅供考古」。
- AGENTS.md 改為短檔，內容只指向 CLAUDE.md，永不再獨立維護。
- 防再犯規則寫入 `docs/claude/maintenance.md`：「已完成的計畫不留在 CLAUDE.md，完成當天移 archive」。

## 第 2 名：無測試 + 無驗證慣例 → 「自稱完成」是最常見的失敗模式

**證據**：

- 整個 repo 沒有任何單元測試。唯一的自動驗證是 `npm run smoke:tph-angular`（會自建 server 打 API）與 `node --check`。
- 五大 route 檔平均近 2,000 行（`orders.js` 2135、`system.js` 2059、`schedules.js` 2025、`patients.js` 1571、`nursing.js` 1448）。在這種檔案裡改一段邏輯，弱模型傾向改完即宣告完成，不會主動驗證，而這是醫院正式系統，錯誤直接影響臨床排程。
- 排程同步（`scheduleSync.js` → 60 天）與調班（`exceptionHandler.js`）有大量隱性耦合，純看 diff 看不出破壞。

**修法**：

- 「完成的定義」與最低驗證梯度寫入 `docs/claude/judgment.md`：語法檢查 → build → smoke → 針對性手動驗證，缺一不得宣稱完成。
- 驗證不自驗：驗收一律派 fresh-context 的 verifier agent（定義在 `.claude/agents/verifier.md`），規則在 `docs/claude/delegation.md`。
- CLAUDE.md 常用指令區明列驗證指令，讓每個 session 第一眼就看到。

## 第 3 名：主對話下場幹粗活 → context 爆炸、後半段失焦

**證據**：

- 主對話直接 `Read` 一個 2,000 行的 route 檔就吃掉大量 context；跨檔追排程同步鏈路（patients → dailyLogMovementSync → kiditSync → patientHistory）動輒讀四五個檔，讀完 context 已過半，後續實作品質下降。
- 專案知識散落無索引：根目錄 6 個 md（BACKEND-DIFF、CHANGES-2026-05-27、HANDOFF-CHANGES、OPTIMIZATION_PLAN、GO-LIVE-CHECKLIST、DEPLOYMENT）+ `docs/` 5 個交接檔。session 要嘛全讀（漏 token）要嘛不讀（漏資訊）。實例：`docs/2026-05-08-follow-up-todos.md` 是使用者已提出但未實作的需求清單，不讀就會重複問或做出衝突設計。
- `.claude/skills/` 下的三個檔（code-review.md、db-backup.md、deploy.md）是平面 md，**不是**合法 skill 格式（需要 `<skill名>/SKILL.md` 目錄結構），所以 Skill 工具根本載不到，等於死知識。

**修法**：

- 「指揮官不下場」規則 + 派工三件套寫入 `docs/claude/delegation.md`：大量讀取/掃 repo/查網頁/批次改檔一律派 subagent，主對話只收結論與 `檔案:行號`。
- CLAUDE.md 尾端放「文件路由表」：一行一檔、何時該讀，包含 follow-up-todos。
- `.claude/skills/` 三檔視為參考文件，已納入路由表（維護協議規定新知識寫去哪，見 `docs/claude/maintenance.md`）。

## 制度檔案總覽

| 檔案 | 內容 | 讀者 |
|------|------|------|
| `CLAUDE.md` | 核心不變式 + 陷阱 + 路由表（每 session 自動載入） | 所有 session |
| `docs/claude/00-diagnosis.md` | 本檔：三大病灶與修法依據 | 使用者、維護制度時 |
| `docs/claude/architecture.md` | 深度架構：同步鏈路細節、前端頁面/元件、部署 | 動到對應子系統時 |
| `docs/claude/delegation.md` | 模型調度守則：派工、model/effort、升降級、驗證不自驗 | 每個要派 subagent 的 session |
| `docs/claude/judgment.md` | 判斷力 rubric：何時升級/完成/停下來問/換路 | 每個 session，卡住時查 |
| `docs/claude/prompt-templates.md` | 派工 prompt 模板：搜尋/實作/重構/研究/審查 | 派工時複製填空 |
| `docs/claude/maintenance.md` | 這套制度怎麼安全更新、教訓寫回哪裡 | 想改制度檔時 |
| `docs/claude/letter.md` | 給未來 session 的信：未問之事 + 制度退化預防 | 新環境接手時讀一次 |
| `.claude/agents/verifier.md` | fresh-context 驗收 agent 定義 | Agent 工具自動載入 |
