// 由 KiDit 建檔快照（kidit_logbook events[].kidit_profile）回填「病人基本資料」單一權威（2026-08-27）
// 用法：node scripts/backfill-basic-profile-from-kidit.mjs [--db=path] [--dry]
//
// 規則（docs/2026-08-27-patient-basic-profile-plan.md §4）：
// - 每位病人取 kidit_profile_saved_at 最新（無戳記者退用事件日期最新）且有 idNumber 的事件
// - patients 欄位「只補空」（清單是護理師維護的權威，快照可能較舊）；patient_kidit_profile 覆寫（本來是空表）
// - 有寫到才標 basic_source='kidit_backfill'；單一 transaction
// - 非 dry 先 db.backup() 到 data/backups/dialysis-before-basic-backfill-<stamp>.db，
//   並輸出 data/backups/basic-backfill-<stamp>.json（每人寫了哪些欄）供逆轉；--dry 只印 diff 不寫
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BASIC_FIELD_MAP,
  KIDIT_PROFILE_FIELD_MAP,
  mapKiditProfileToBasic,
  mapKiditProfileToKidit,
  upsertPatientBasicProfile,
} from '../src/services/patientBasicProfile.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? true] : [a, true] }))
const DB_PATH = args.db || process.env.DB_PATH || path.join(__dirname, '..', 'data', 'dialysis.db')
const DRY = !!args.dry
const BACKUP_DIR = path.join(path.dirname(DB_PATH), 'backups')

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')

const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='patient_kidit_profile'").get()
const colExists = db.prepare('PRAGMA table_info(patients)').all().some((c) => c.name === 'kidit_patient_category')
if (!tableExists || !colExists) {
  console.error('patient_kidit_profile 表或 patients 新欄位不存在：請先啟動一次伺服器跑 migration（或 npm run backup）')
  process.exit(1)
}

const stamp = new Date().toLocaleString('sv-SE').replace(/[-: ]/g, '').replace(/^(\d{8})(\d{6})$/, '$1-$2')

// ---- 掃 kidit_logbook：每人取最新有 idNumber 的 kidit_profile ----
const ts = (v) => {
  if (!v) return -Infinity
  const t = new Date(String(v).replace(' ', 'T')).getTime()
  return Number.isNaN(t) ? -Infinity : t
}
const latest = new Map() // patientId -> { profile, savedAt, date, eventId }
let scannedEvents = 0
for (const row of db.prepare('SELECT date, events FROM kidit_logbook ORDER BY date').all()) {
  let events
  try { events = JSON.parse(row.events || '[]') } catch { continue }
  for (const e of events) {
    scannedEvents++
    if (!e?.patientId || !e.kidit_profile?.idNumber) continue
    const cand = { profile: e.kidit_profile, savedAt: e.kidit_profile_saved_at || null, date: row.date, eventId: e.id }
    const cur = latest.get(e.patientId)
    if (!cur) { latest.set(e.patientId, cand); continue }
    // 先比 saved_at（有戳記者優先且取最新），都沒戳記才比事件日期
    const a = ts(cand.savedAt), b = ts(cur.savedAt)
    const newer = a !== b ? a > b : cand.date >= cur.date
    if (newer) latest.set(e.patientId, cand)
  }
}

const getPatient = db.prepare('SELECT * FROM patients WHERE id = ?')
const getKidit = db.prepare('SELECT * FROM patient_kidit_profile WHERE patient_id = ?')

console.log(`DB=${DB_PATH}  掃描事件 ${scannedEvents} 筆，有建檔（idNumber）病人 ${latest.size} 人${DRY ? '（dry-run，不寫入）' : ''}`)

// ---- dry-run：印 diff ----
const isEmpty = (v) => v === null || v === undefined || String(v).trim() === ''
function previewDiff(patientId, entry) {
  const p = getPatient.get(patientId)
  if (!p) return null
  const basic = mapKiditProfileToBasic(entry.profile)
  const kidit = mapKiditProfileToKidit(entry.profile)
  const k = getKidit.get(patientId) || {}
  const patientDiff = []
  for (const [camel, snake] of Object.entries(BASIC_FIELD_MAP)) {
    const v = basic[camel]
    if (v === undefined || isEmpty(v)) continue
    if (!isEmpty(p[snake])) continue
    patientDiff.push(`${camel}: (空) → ${JSON.stringify(v)}`)
  }
  const kiditDiff = []
  for (const [camel, snake] of Object.entries(KIDIT_PROFILE_FIELD_MAP)) {
    const v = kidit[camel]
    if (v === undefined || isEmpty(v)) continue // 與 skipEmpty 一致：空值不寫
    const old = k[snake] ?? null
    if ((old ?? null) === (v ?? null)) continue
    kiditDiff.push(`${camel}: ${JSON.stringify(old)} → ${JSON.stringify(v)}`)
  }
  return { name: p.name, mrn: p.medical_record_number, patientDiff, kiditDiff }
}

let backupPath = null
if (!DRY) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true })
  backupPath = path.join(BACKUP_DIR, `dialysis-before-basic-backfill-${stamp}.db`)
  await db.backup(backupPath)
  console.log(`已備份資料庫 → ${backupPath}`)
}

const report = { stamp, dbPath: DB_PATH, dry: DRY, backupPath, source: 'kidit_backfill', patients: [] }
let notFound = 0, touchedPatients = 0, patientFieldTotal = 0, kiditFieldTotal = 0, noop = 0

const tx = db.transaction(() => {
  for (const [patientId, entry] of latest) {
    if (DRY) {
      const d = previewDiff(patientId, entry)
      if (!d) { notFound++; continue }
      if (d.patientDiff.length === 0 && d.kiditDiff.length === 0) { noop++; continue }
      touchedPatients++
      patientFieldTotal += d.patientDiff.length
      kiditFieldTotal += d.kiditDiff.length
      console.log(`- ${d.name}（${d.mrn}）事件 ${entry.date}${entry.savedAt ? ` saved_at ${entry.savedAt}` : ''}`)
      for (const line of d.patientDiff) console.log(`    patients.${line}`)
      for (const line of d.kiditDiff) console.log(`    kidit.${line}`)
      continue
    }
    const r = upsertPatientBasicProfile(
      db, patientId, mapKiditProfileToBasic(entry.profile), mapKiditProfileToKidit(entry.profile),
      { source: 'kidit_backfill', user: { uid: 'backfill', name: 'backfill-basic-profile' }, fillOnlyEmpty: true, skipEmpty: true },
    )
    if (!r.found) { notFound++; continue }
    if (r.patientFieldsWritten.length === 0 && r.kiditFieldsWritten.length === 0) { noop++; continue }
    touchedPatients++
    patientFieldTotal += r.patientFieldsWritten.length
    kiditFieldTotal += r.kiditFieldsWritten.length
    report.patients.push({
      patientId,
      sourceEvent: { date: entry.date, eventId: entry.eventId, savedAt: entry.savedAt },
      patientFieldsWritten: r.patientFieldsWritten,
      kiditFieldsWritten: r.kiditFieldsWritten,
    })
  }
})
tx()

if (!DRY) {
  const jsonPath = path.join(BACKUP_DIR, `basic-backfill-${stamp}.json`)
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8')
  console.log(`已輸出回填紀錄 → ${jsonPath}`)
}

console.log(
  `${DRY ? 'dry-run 完成（未寫入）' : '回填完成'}：` +
  `寫入 ${touchedPatients} 人（patients 欄位 ${patientFieldTotal}、kidit 欄位 ${kiditFieldTotal}）、` +
  `無變動 ${noop} 人、查無病人 ${notFound} 人`,
)
db.close()
