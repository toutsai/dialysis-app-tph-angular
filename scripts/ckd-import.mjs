// 門診 CKD 收案：命令列批次匯入 HIS 報表（首次大批匯入用；網頁上傳限 8MB）
// 用法：node --max-old-space-size=3072 scripts/ckd-import.mjs <檔案或資料夾...> [--db=path] [--kind=case|clinic|lab|bill] [--dry]
//   實測 0204 檢驗明細 31MB／76 萬列：解析 ~30 秒、heap ~1.3GB → 請在離峰時段跑，且勿在 PM2 主程序內做。
//   合併規則與網頁上傳完全相同（services/ckd/ingest.js）；同內容檔（sha1）會略過。
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { toAoa, detectKind, parseByKind, KIND_LABEL } from '../src/services/ckd/parsers.js'
import { toPayload } from '../src/services/ckd/rows.js'
import { ingestPayload } from '../src/services/ckd/ingest.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const opts = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return [m[1], m[2] ?? true] }))
const targets = args.filter((a) => !a.startsWith('--'))
const DB_PATH = opts.db || process.env.DB_PATH || path.join(__dirname, '..', 'data', 'dialysis.db')
const DRY = !!opts.dry
const FORCED = opts.kind && KIND_LABEL[opts.kind] ? opts.kind : ''

if (!targets.length) {
  console.error('用法：node --max-old-space-size=3072 scripts/ckd-import.mjs <檔案或資料夾...> [--db=path] [--kind=case|clinic|lab|bill] [--dry]')
  process.exit(1)
}

const files = []
for (const t of targets) {
  if (!fs.existsSync(t)) { console.error('找不到：' + t); continue }
  if (fs.statSync(t).isDirectory()) {
    for (const n of fs.readdirSync(t)) if (/\.(xlsx?|xlsm|csv)$/i.test(n) && !n.startsWith('~$')) files.push(path.join(t, n))
  } else files.push(t)
}

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ckd_upload_batches'").get()) {
  console.error('ckd_* 資料表不存在：請先啟動一次伺服器跑 migration')
  process.exit(1)
}
console.log(`DB=${DB_PATH}  檔案 ${files.length} 個${DRY ? '（dry-run，不寫入）' : ''}`)

const mb = (n) => (n / 1048576).toFixed(1) + 'MB'
for (const f of files) {
  const name = path.basename(f)
  const t0 = performance.now()
  const buf = fs.readFileSync(f)
  const hash = crypto.createHash('sha1').update(buf).digest('hex')
  let aoa
  try { aoa = toAoa(buf) } catch (e) { console.log(`[跳過] ${name}：不是可讀的試算表：${e.message}`); continue }
  const kind = detectKind(aoa) || FORCED
  if (!kind) { console.log(`[跳過] ${name}：認不出報表種類`); continue }
  let parsed
  try { parsed = parseByKind(aoa, kind) } catch (e) { console.log(`[跳過] ${name}：解析失敗：${e.message}`); continue }
  const payload = toPayload(kind, parsed.rows)
  aoa = null
  const t1 = performance.now()
  if (DRY) {
    console.log(`[dry] ${name} (${mb(buf.length)}) ${KIND_LABEL[kind]}：${payload.rows.length} 筆${payload.extraLabs.length ? `，附帶檢驗 ${payload.extraLabs.length} 份` : ''}，解析 ${((t1 - t0) / 1000).toFixed(1)}s`)
    continue
  }
  const res = ingestPayload(db, payload, { fileName: name, fileHash: hash, user: { name: 'CLI 匯入' } })
  const t2 = performance.now()
  if (res.dup) { console.log(`[略過] ${name}：內容與 ${res.prevBatch.created_at} 匯入的「${res.prevBatch.file_name}」相同`); continue }
  const s = res.stats
  console.log(`[OK] ${name} (${mb(buf.length)}) ${res.kindLabel}：讀到 ${s.rows} 筆／${s.persons} 人，新增 ${s.added}${s.updated != null ? `、更新 ${s.updated}` : ''}${s.removed != null ? `、移除 ${s.removed}` : ''}、重複 ${s.dup ?? 0}` +
    (res.labStats ? `；附帶檢驗 新增 ${res.labStats.added}、更新 ${res.labStats.updated}` : '') +
    `；區間 ${res.range.start || '-'} ~ ${res.range.end || '-'}；解析 ${((t1 - t0) / 1000).toFixed(1)}s、寫入 ${((t2 - t1) / 1000).toFixed(1)}s`)
}
db.close()
