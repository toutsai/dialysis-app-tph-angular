// 門診 CKD 收案追蹤：判定參數（單一列 ckd_settings.id='main'，JSON 存）
// 預設值 = 交接包 app_head.html #cfg* 的 value（app.js cfg() 的 fallback 同值）。
// ⚠️ README 寫 earlyGap 180 是舊值，程式實際 161（Q8：6 個月放寬 ≥161 天），以程式為準。
import { getDatabase } from '../../db/init.js'

export const DEFAULT_SETTINGS = Object.freeze({
  preGap: 77,        // Pre-ESRD 追蹤間隔（天）
  earlyNew: 77,      // Early-CKD 新收案 → 首次追蹤（3 個月放寬 ≥77 天）
  earlyGap: 161,     // Early-CKD 之後每次追蹤（6 個月放寬 ≥161 天）
  dmGap: 70,         // DKD（P7001C）追蹤間隔
  over: 180,         // 逾期門檻（天）
  labWin: 90,        // 檢驗回溯視窗（±天）
  dept: '腎臟內科',   // 門診清單科別篩選
  allA: false,       // 已收案者全院比對（部北：多科會收 Early-CKD）
  recallGrace: 30,   // 召回清單到期後寬限（天）
  alertWin: 14,      // 近日異常檢驗掃描天數
  rrtEgfr: 20,       // 透析準備管線 eGFR 門檻
})

const NUMERIC_KEYS = ['preGap', 'earlyNew', 'earlyGap', 'dmGap', 'over', 'labWin', 'recallGrace', 'alertWin', 'rrtEgfr']

export function getSettings() {
  const db = getDatabase()
  const row = db.prepare(`SELECT settings_json, updated_by, updated_at FROM ckd_settings WHERE id = 'main'`).get()
  let stored = {}
  try { stored = row?.settings_json ? JSON.parse(row.settings_json) : {} } catch { stored = {} }
  return {
    settings: { ...DEFAULT_SETTINGS, ...sanitize(stored) },
    updatedBy: row?.updated_by || null,
    updatedAt: row?.updated_at || null,
  }
}

/** 只接受已知鍵；數值鍵必須是正數，否則回預設 */
export function sanitize(input) {
  const out = {}
  if (!input || typeof input !== 'object') return out
  for (const k of NUMERIC_KEYS) {
    if (input[k] == null || input[k] === '') continue
    const n = Number(input[k])
    if (Number.isFinite(n) && n > 0) out[k] = n
  }
  if (typeof input.dept === 'string') out.dept = input.dept.trim()
  if (typeof input.allA === 'boolean') out.allA = input.allA
  return out
}

export function saveSettings(patch, user) {
  const db = getDatabase()
  const current = getSettings().settings
  const next = { ...current, ...sanitize(patch) }
  const by = user ? JSON.stringify({ uid: user.uid || user.id || null, name: user.name || user.username || '' }) : null
  db.prepare(`
    INSERT INTO ckd_settings (id, settings_json, updated_by, updated_at)
    VALUES ('main', ?, ?, datetime('now','localtime'))
    ON CONFLICT(id) DO UPDATE SET settings_json = excluded.settings_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at
  `).run(JSON.stringify(next), by)
  return getSettings()
}
