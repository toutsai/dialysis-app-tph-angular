# 模型調度守則

給主對話模型（指揮官）的派工規則。目的：主對話 context 留給判斷與整合，粗活派出去；驗收永遠由沒看過過程的新 agent 做。

## 1. 指揮官不下場（何時必須派 subagent）

符合任一條就派，不要自己動手：

| 情境 | 門檻 | 派誰 |
|------|------|------|
| 讀大檔 | 單檔 > ~800 行且需要整體理解（本專案五大 route 檔都超過） | `Explore` |
| 掃 repo | 要看 > 3 個檔案才能回答的問題（「X 在哪被呼叫」「這條鏈路怎麼走」） | `Explore` |
| 查網頁/文件 | 任何需要 WebSearch/WebFetch 的研究 | `general-purpose` |
| 批次改檔 | 同一模式套用到 > 3 個位置 | `claude`（或 `general-purpose`） |
| 跑長輸出指令 | build/smoke test 等會噴大量 log 的（只要結論） | `claude` |
| 驗收 | 任何「宣稱完成」的檢查 | `verifier`（見 §6） |

主對話**可以**自己做：讀單一小檔或已知行號區段、Grep 定位、改 1–2 個檔的小 edit、git 操作、與使用者對話。

派出去之後不要自己再做一遍同樣的搜尋——等結果。互相獨立的 agent 要在同一則訊息一起派（並行）。

## 2. 派工三件套（每個派工 prompt 必含）

1. **目標與動機**：做什麼 + 為什麼（動機讓 agent 在邊界情況能自己判斷）。
2. **驗收條件**：可勾選的清單，agent 完成前要自檢。
3. **回報格式**：明確規定回什麼（見 §4 回報合約）。

缺一件就是壞派工。模板直接抄 `docs/claude/prompt-templates.md`。

## 3. 顯式指定 model（與 effort）

Agent 工具有 `model` 參數。**每次派工都顯式指定**，不要留給預設（預設會繼承主模型，通常太貴）。本環境實際可用值以你 session 中 Agent 工具的 enum 為準，撰寫時（2026-07）為 `haiku` / `sonnet` / `opus`（`fable` 僅特殊 session 有，不要依賴）。

| model | 用於 | 例子 |
|-------|------|------|
| `haiku` | 機械性、模式已定案的工作 | 已驗證的修法批次套用到 10 個位置；簡單關鍵字定位；跑指令收結論 |
| `sonnet` | 預設工作馬：一般搜尋、實作、審查、驗收 | 在 orders.js 加一個 endpoint；追一條同步鏈路；verifier 驗收 |
| `opus` | 難題：跨子系統除錯、架構取捨、模糊需求拆解 | 排程同步產生錯誤結果但 diff 看不出原因；設計新子系統 |

effort：Agent 工具本身沒有 effort 參數；自訂 agent 可在 `.claude/agents/*.md` frontmatter 設定。原則上不用管 effort，用 model 分級即可。

Workflow 工具（多 agent 編排）**只在使用者明確要求時**使用（關鍵字 ultracode 或明說「用 workflow」），平時一律用 Agent 工具。

## 4. 回報合約（寫進每個派工 prompt）

Subagent 的最終回覆必須遵守：

- 只回**結論**與 `檔案:行號` 證據，不要貼整段程式碼（> 10 行的引用一律改成路徑+行號範圍）。
- 長產物（報告、清單、diff 說明）寫成檔案（scratchpad 或 docs/），回覆只給路徑 + 3 行摘要。
- 回覆上限約 30 行。回覆是給主模型看的資料，不是給人看的文章。
- 找不到/做不到就直說「找不到」+ 已嘗試的方法，**嚴禁**編造路徑、行號、API 名稱。

## 5. 升降級路徑

- **haiku 錯一次 → 直接升 sonnet**。不要重試 haiku（重試成本 > 升級差價）。
- **sonnet 同一子任務連錯兩次 → 升 opus**，且 prompt 必須附完整失敗軌跡：試過什麼、確切錯誤輸出、目前假設。不附軌跡的升級會重蹈覆轍。
- **降級**：難題被 opus/sonnet 解出「模式」後（例如確認了正確修法長什麼樣），把模式寫清楚、降回 haiku/sonnet 批次套用。
- **重試上限**：同一件事同一方法最多兩輪。兩輪還不行，代表方法錯了——換方法或帶著軌跡問使用者（判準見 `docs/claude/judgment.md` §4）。

## 6. 驗證不自驗

**做的人不能當驗的人。** 主對話（或實作 agent）自己檢查自己的產出，會系統性地漏掉自己的盲點。

- **驗收一律派 `verifier` agent**（定義在 `.claude/agents/verifier.md`，fresh context、唯讀 + 可跑指令）。若你的 Agent 工具清單裡沒有 `verifier`（自訂 agent 在 session 啟動時載入，中途新增的檔案看不到），fallback：派 `general-purpose` 並在 prompt 開頭要求它先 Read `.claude/agents/verifier.md` 並遵守其中全部規則。給它：宣稱完成的事 + 驗收條件清單，讓它自己去讀檔/跑指令，**不要**把「我改了什麼」的敘述餵給它當證據。
- **檔案產出**：verifier 用 read-back（實際打開檔案核對內容），不是看 diff 摘要。
- **程式碼產出**：verifier 實跑 `node --check` + `npm run smoke:tph-angular`（或針對性指令），不是看程式碼「長得對」。
- **高風險判斷**（動排程同步、KiDit、資料遷移、刪東西）：加第二意見——派兩個獨立 agent 各給答案，不一致就升級處理；或一個 agent 產出、另一個以「找出這裡哪裡錯」的立場審。

### 派工範例（可直接仿寫）

```
Agent(subagent_type: "Explore", model: "sonnet", prompt: "
目標：找出所有會寫入 dialysis_orders.mode 的後端程式路徑。
動機：要新增一個寫 mode 的 endpoint，必須確認每條路徑都套用 normalizeDialysisMode。
驗收條件：
- [ ] 涵蓋 src/routes/ 與 src/services/ 全部檔案
- [ ] 每條路徑標明是否已呼叫 normalizeDialysisMode
回報格式：每條路徑一行「檔案:行號 — 函式名 — 已套用/未套用」，最後一行給總數。
不要貼程式碼。找不到就說找不到並列出用過的搜尋 pattern。")
```
