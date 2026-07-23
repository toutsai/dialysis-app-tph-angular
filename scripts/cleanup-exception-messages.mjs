// 一次性清理：把「調班申請自動產生、關聯日已過」的舊交班留言標成 completed
// 背景：2026-07 前調班留言 type='常規' 且 MOVE/ADD_SESSION 的 target_date 為空，
//       前端「過期退場」新規則（type='調班'）管不到它們，需一次清理存量。
// 用法：node scripts/cleanup-exception-messages.mjs [DB路徑，預設 ./data/dialysis.db] [--apply]
//       不帶 --apply 為 dry-run，只列出將異動的筆數與清單。
// 規則：category='message'、status IN (pending, expired)、內容為調班留言前綴；
//       到期日 = 內容中所有 YYYY-MM-DD 的最大值（fallback target_date），已過今天才標。
// 可逆：--apply 時將原狀態備份寫入 data/cleanup-exception-messages-<時間戳>.json。
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const dbPath = args.find((a) => !a.startsWith('--')) || './data/dialysis.db'

const PREFIXES = ['【臨時調班】', '【更新-臨時調班】', '【區間暫停】', '【臨時加洗', '【同日互調】']

// 台北時區今天（與 utils/dateUtils 同法，腳本自帶避免 import 伺服器模組）
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' })

const db = new Database(dbPath)
const rows = db
  .prepare(
    `SELECT id, content, target_date, status, patient_name, created_at FROM tasks
     WHERE category = 'message' AND status IN ('pending', 'expired')`,
  )
  .all()

const candidates = []
for (const r of rows) {
  const content = r.content || ''
  if (!PREFIXES.some((p) => content.startsWith(p))) continue
  const dates = content.match(/\d{4}-\d{2}-\d{2}/g) || []
  const expiry = dates.length ? dates.sort().at(-1) : r.target_date
  if (!expiry) {
    console.log(`  略過（無法判定日期）: ${r.id} ${r.patient_name || ''} ${content.split('\n')[0]}`)
    continue
  }
  if (expiry >= today) continue // 尚未過期，保留
  candidates.push({ id: r.id, prevStatus: r.status, expiry, patientName: r.patient_name, head: content.split('\n')[0] })
}

console.log(`掃描 ${rows.length} 筆未結留言，符合清理條件 ${candidates.length} 筆（今天=${today}）：`)
for (const c of candidates) {
  console.log(`  ${c.expiry} ${c.patientName || '?'} [${c.prevStatus}] ${c.head} (${c.id})`)
}

if (!apply) {
  console.log('\ndry-run 結束，未異動任何資料。確認清單無誤後加 --apply 執行。')
} else if (candidates.length > 0) {
  const backupPath = path.join(
    path.dirname(dbPath),
    `cleanup-exception-messages-${new Date().toLocaleString('sv-SE').replace(/[ :]/g, '-')}.json`,
  )
  fs.writeFileSync(backupPath, JSON.stringify(candidates, null, 2), 'utf8')
  const upd = db.prepare(
    `UPDATE tasks SET status = 'completed',
       completed_at = datetime('now', 'localtime'),
       updated_at = datetime('now', 'localtime')
     WHERE id = ?`,
  )
  const tx = db.transaction(() => {
    for (const c of candidates) upd.run(c.id)
  })
  tx()
  console.log(`\n已標記 ${candidates.length} 筆為 completed；原狀態備份：${backupPath}`)
} else {
  console.log('\n沒有需要清理的留言。')
}
db.close()
