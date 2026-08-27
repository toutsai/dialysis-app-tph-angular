// 倒推歷史「每月月底病人數」寫入 patient_census_daily（source='backfill'，估算值）
// 用法：node scripts/backfill-patient-census.mjs [--db=path] [--from=2025-08] [--dry] [--force]
//   --force：連 source='cron' 的實際快照也覆蓋（常規門診「定義」變更後重算用；2026-08-28 定義改為不論身分）
//
// 原理：共用 src/services/patientCensus.js 的 loadCensusReplay()——以目前 patients 表為終點，
// 依 patient_history 由新到舊「倒放」事件還原各月底的病人身分，再以同一套常規門診定義計數。
// 限制（故標為估算）：patient_category 變更未留歷史→用現值；patient_history 2025-07-29 起才有→更早月份不倒推；
// 查無事件細節的 RESTORE 以快照 status 為準。未加 --force 時已有 cron 實際快照的日期不覆蓋。
import Database from 'better-sqlite3'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCensusReplay } from '../src/services/patientCensus.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? true] : [a, true] }))
const DB_PATH = args.db || process.env.DB_PATH || path.join(__dirname, '..', 'data', 'dialysis.db')
const FROM = args.from || '2025-08'
const DRY = !!args.dry
const FORCE = !!args.force

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')

const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='patient_census_daily'").get()
if (!tableExists) {
  console.error('patient_census_daily 不存在：請先啟動一次伺服器跑 migration（或 npm run backup）')
  process.exit(1)
}

const { events, earliest, undo, countAt } = loadCensusReplay(db)
console.log(`DB=${DB_PATH}  事件 ${events.length} 筆，最早 ${earliest}；倒推 ${FROM} 起各月底${DRY ? '（dry-run）' : ''}${FORCE ? '（--force 覆蓋 cron）' : ''}`)

// 月底清單：從本月往回到 FROM
const today = new Date()
const monthEnds = []
for (let y = today.getFullYear(), m = today.getMonth(); ; m--) {
  if (m < 0) { m = 11; y-- }
  const ym = `${y}-${String(m + 1).padStart(2, '0')}`
  if (ym < FROM) break
  const last = new Date(y, m + 1, 0)
  const lastStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`
  // 本月未結束不倒推（由 cron 快照負責）
  if (last >= new Date(today.getFullYear(), today.getMonth(), today.getDate())) continue
  monthEnds.push(lastStr)
}

let idx = 0
const results = []
for (const monthEnd of monthEnds) {
  // 倒放所有「晚於月底」的事件
  while (idx < events.length && events[idx].date > monthEnd) { undo(events[idx]); idx++ }
  if (earliest && monthEnd < earliest) { console.log(`${monthEnd} 早於歷史起點，跳過`); continue }
  results.push({ date: monthEnd, ...countAt(monthEnd) })
}

const upsert = db.prepare(`
  INSERT INTO patient_census_daily (date, opd_regular_count, opd_count, ipd_count, er_count, source, created_at)
  VALUES (?, ?, ?, ?, ?, 'backfill', datetime('now','localtime'))
  ON CONFLICT(date) DO UPDATE SET
    opd_regular_count=excluded.opd_regular_count, opd_count=excluded.opd_count,
    ipd_count=excluded.ipd_count, er_count=excluded.er_count, source='backfill', created_at=excluded.created_at
  WHERE patient_census_daily.source <> 'cron' OR ${FORCE ? 1 : 0} = 1`)

const tx = db.transaction(() => {
  for (const r of results) {
    console.log(`${r.date}  常規門診 ${r.opdRegular}  門診 ${r.opd}  住院 ${r.ipd}  急診 ${r.er}`)
    if (!DRY) upsert.run(r.date, r.opdRegular, r.opd, r.ipd, r.er)
  }
})
tx()
console.log(DRY ? 'dry-run 完成（未寫入）' : `已寫入 ${results.length} 個月底（source=backfill，${FORCE ? '--force 連 cron 快照一併覆蓋' : '不覆蓋 cron 實際快照'}）`)
db.close()
