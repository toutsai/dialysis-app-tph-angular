// 倒推歷史「每月月底病人數」寫入 patient_census_daily（source='backfill'，估算值）
// 用法：node scripts/backfill-patient-census.mjs [--db=path] [--from=2025-08] [--dry]
//
// 原理：以目前 patients 表為終點，依 patient_history（CREATE/DELETE/TRANSFER/STATUS_CHANGE/RESTORE*）
// 由新到舊「倒放」事件還原各月底 23:59:59 的病人身分，計算 status=opd 且 (patient_category 空或 opd_regular) 且未刪除的人數。
// 限制（故標為估算）：patient_category 變更未留歷史→用現值；patient_history 2025-07-29 起才有→更早月份不倒推；
// 查無事件細節的 RESTORE 以快照 status 為準。已有 cron 實際快照的日期不覆蓋。
import Database from 'better-sqlite3'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? true] : [a, true] }))
const DB_PATH = args.db || process.env.DB_PATH || path.join(__dirname, '..', 'data', 'dialysis.db')
const FROM = args.from || '2025-08'
const DRY = !!args.dry

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')

const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='patient_census_daily'").get()
if (!tableExists) {
  console.error('patient_census_daily 不存在：請先啟動一次伺服器跑 migration（或 npm run backup）')
  process.exit(1)
}

// 終點狀態：目前每位病人 { status, deleted, category }
const state = new Map()
for (const p of db.prepare('SELECT id, status, is_deleted, patient_category FROM patients').all()) {
  state.set(p.id, { status: p.status, deleted: p.is_deleted === 1, category: p.patient_category || '' })
}
// 歷史裡出現但 patients 已無此人（硬刪）：視為目前不存在
const events = db
  .prepare('SELECT patient_id, event_type, event_details, snapshot, timestamp FROM patient_history ORDER BY timestamp DESC')
  .all()
  .map((e) => {
    let d = {}, s = {}
    try { d = JSON.parse(e.event_details || '{}') } catch {}
    try { s = JSON.parse(e.snapshot || '{}') } catch {}
    // timestamp 多為 ISO(UTC)；轉台北本地日期字串比對月底
    const local = new Date(e.timestamp)
    const localDate = isNaN(local.getTime()) ? String(e.timestamp).slice(0, 10) : local.toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' }).slice(0, 10)
    return { pid: e.patient_id, type: e.event_type, d, s, localDate, ts: e.timestamp }
  })

const earliest = events.length ? events[events.length - 1].localDate : null
console.log(`DB=${DB_PATH}  事件 ${events.length} 筆，最早 ${earliest}；倒推 ${FROM} 起各月底${DRY ? '（dry-run）' : ''}`)

function countNow() {
  const c = { opdRegular: 0, opd: 0, ipd: 0, er: 0 }
  for (const v of state.values()) {
    if (v.deleted) continue
    if (v.status === 'opd') { c.opd++; if (!v.category || v.category === 'opd_regular') c.opdRegular++ }
    else if (v.status === 'ipd') c.ipd++
    else if (v.status === 'er') c.er++
  }
  return c
}

/** 倒放一個事件：把 state 退回事件發生「之前」 */
function undo(ev) {
  const cur = state.get(ev.pid) || { status: ev.s?.status || 'opd', deleted: true, category: '' }
  switch (ev.type) {
    case 'CREATE':
      state.set(ev.pid, { ...cur, deleted: true, _created: false })
      break
    case 'DELETE':
      state.set(ev.pid, { ...cur, deleted: false, status: ev.d.fromStatus || ev.s?.status || cur.status })
      break
    case 'TRANSFER':
    case 'STATUS_CHANGE':
      state.set(ev.pid, { ...cur, deleted: false, status: ev.d.fromStatus || cur.status })
      break
    case 'RESTORE':
    case 'RESTORE_AND_TRANSFER':
      // 復原前＝已刪除
      state.set(ev.pid, { ...cur, deleted: true })
      break
    default:
      break // MODE_CHANGE 等不影響身分
  }
}

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
  while (idx < events.length && events[idx].localDate > monthEnd) { undo(events[idx]); idx++ }
  if (earliest && monthEnd < earliest) { console.log(`${monthEnd} 早於歷史起點，跳過`); continue }
  const c = countNow()
  results.push({ date: monthEnd, ...c })
}

const upsert = db.prepare(`
  INSERT INTO patient_census_daily (date, opd_regular_count, opd_count, ipd_count, er_count, source, created_at)
  VALUES (?, ?, ?, ?, ?, 'backfill', datetime('now','localtime'))
  ON CONFLICT(date) DO UPDATE SET
    opd_regular_count=excluded.opd_regular_count, opd_count=excluded.opd_count,
    ipd_count=excluded.ipd_count, er_count=excluded.er_count, source='backfill', created_at=excluded.created_at
  WHERE patient_census_daily.source <> 'cron'`)

const tx = db.transaction(() => {
  for (const r of results) {
    console.log(`${r.date}  常規門診 ${r.opdRegular}  門診 ${r.opd}  住院 ${r.ipd}  急診 ${r.er}`)
    if (!DRY) upsert.run(r.date, r.opdRegular, r.opd, r.ipd, r.er)
  }
})
tx()
console.log(DRY ? 'dry-run 完成（未寫入）' : `已寫入 ${results.length} 個月底（source=backfill，不覆蓋 cron 實際快照）`)
db.close()
