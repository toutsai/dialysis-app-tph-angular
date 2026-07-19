// 一次性回填：依現有旗標為既有病人生成透析來源履歷 patientStatus.dialysisOrigin
// 用法：node scripts/backfill-dialysis-origin.mjs [DB路徑，預設 ./data/dialysis.db]
// 規則：isFirstDialysis.active → first；僅 hospitalFirstDialysis.active → transfer；
//       已有 dialysisOrigin.type 或無任何標記者跳過。含已刪除（軟刪除）病人。
import Database from 'better-sqlite3'

const dbPath = process.argv[2] || './data/dialysis.db'
const db = new Database(dbPath)
const rows = db.prepare('SELECT id, name, patient_status FROM patients').all()
const now = new Date().toLocaleString('sv-SE')
const upd = db.prepare('UPDATE patients SET patient_status = ? WHERE id = ?')

let filled = 0
const tx = db.transaction(() => {
  for (const r of rows) {
    let ps
    try {
      ps = JSON.parse(r.patient_status || '{}')
    } catch {
      continue
    }
    if (ps?.dialysisOrigin?.type) continue
    let type = null
    if (ps?.isFirstDialysis?.active) type = 'first'
    else if (ps?.hospitalFirstDialysis?.active) type = 'transfer'
    if (!type) continue
    ps.dialysisOrigin = {
      type,
      firstDialysisDate: type === 'first' ? ps.isFirstDialysis?.date || null : null,
      hospitalFirstDate: ps.hospitalFirstDialysis?.date || ps.isFirstDialysis?.date || null,
      setBy: 'backfill',
      setAt: now,
    }
    upd.run(JSON.stringify(ps), r.id)
    filled++
    console.log(`  ${type === 'first' ? '本院首透' : '外院轉入'}: ${r.name}`)
  }
})
tx()
console.log(`完成：回填 ${filled} 位病人（共掃描 ${rows.length} 位）`)
db.close()
