// 全院 AKI Map 路由（專師專用）
import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { getDatabase } from '../db/init.js'
import { isSpecialist, logAuditWithRequest } from '../middleware/auth.js'
import { getTaipeiTodayString } from '../utils/dateUtils.js'
import { normalizeDialysisMode } from '../utils/dialysisMode.js'
import { parseInpatients, parseLabs, stageForSeries, AKI_CATEGORIES } from '../services/akiService.js'

const router = Router()

// 全部端點限專師/admin
router.use(...isSpecialist)

// 病歷號寬鬆正規化：去前導 0 後比對。
// AKI 檔的 mrn 為 10 碼補零(0000032674)，透析病人 medical_record_number 為 6~7 碼無前導 0(616069)，
// 直接對會 0 筆，去前導 0 才對得起來。
function looseMrn(v) {
  return String(v == null ? '' : v).trim().replace(/^0+/, '')
}

// 建立「透析病人病歷號(寬鬆) → 透析模式」對照表。
// Map 中有 key = 是本院透析病人；value 為正規化 mode（無 mode 則空字串）。
function buildDialysisModeMap(db) {
  const rows = db
    .prepare("SELECT medical_record_number AS mrn, dialysis_orders FROM patients WHERE is_deleted = 0")
    .all()
  const map = new Map()
  for (const r of rows) {
    const key = looseMrn(r.mrn)
    if (!key) continue
    let mode = ''
    try {
      const o = JSON.parse(r.dialysis_orders || '{}')
      if (o && o.mode != null && String(o.mode).trim()) mode = normalizeDialysisMode(String(o.mode))
    } catch {}
    map.set(key, mode)
  }
  return map
}

// 由對照表取得顯示用透析模式：非透析病人 → null；透析病人無 mode → '透析'
function dialysisModeFor(modeMap, mrn) {
  const key = looseMrn(mrn)
  if (!modeMap.has(key)) return null
  return modeMap.get(key) || '透析'
}

function decodeBuffer(req) {
  const { fileContentBase64, fileName } = req.body || {}
  if (!fileContentBase64 || !fileName) {
    const err = new Error('缺少檔案內容或檔名')
    err.status = 400
    throw err
  }
  return { buffer: Buffer.from(fileContentBase64, 'base64'), fileName }
}

// ---------- 上傳：留院病人清單（覆蓋該快照日） ----------
router.post('/upload/inpatients', (req, res) => {
  try {
    const { buffer, fileName } = decodeBuffer(req)
    const parsed = parseInpatients(buffer)
    const snapshotDate =
      (req.body.snapshotDate && String(req.body.snapshotDate).trim()) ||
      parsed.rangeEnd ||
      getTaipeiTodayString()

    const db = getDatabase()
    const batchId = uuidv4()

    const insertPatient = db.prepare(`
      INSERT OR REPLACE INTO aki_inpatients
        (id, snapshot_date, mrn, name, ward, bed, dept, physician, sex, age,
         admit_date, discharge_date, diagnoses, batch_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
    `)

    const tx = db.transaction(() => {
      // 覆蓋同快照日舊資料
      db.prepare('DELETE FROM aki_inpatients WHERE snapshot_date = ?').run(snapshotDate)
      for (const p of parsed.patients) {
        insertPatient.run(
          uuidv4(), snapshotDate, p.mrn, p.name, p.ward, p.bed, p.dept, p.physician,
          p.sex, p.age, p.admitDate, p.dischargeDate, JSON.stringify(p.diagnoses || []), batchId,
        )
      }
      db.prepare(`
        INSERT INTO aki_upload_batches
          (id, kind, file_name, snapshot_date, range_start, range_end, row_count, imported_count, uploaded_by)
        VALUES (?, 'inpatients', ?, ?, ?, ?, ?, ?, ?)
      `).run(batchId, fileName, snapshotDate, parsed.rangeStart, parsed.rangeEnd, parsed.rowCount, parsed.patients.length, req.user?.name || req.user?.username || '')
    })
    tx()

    logAuditWithRequest(req, 'AKI_UPLOAD_INPATIENTS', 'aki_inpatients', snapshotDate, { count: parsed.patients.length, fileName })
    res.json({ success: true, snapshotDate, patients: parsed.patients.length, rowCount: parsed.rowCount })
  } catch (error) {
    res.status(error.status || 500).json({ error: true, message: error.message || '匯入留院清單失敗' })
  }
})

// ---------- 上傳：CKD-AKI 明細（累積歷史，去重） ----------
router.post('/upload/labs', (req, res) => {
  try {
    const { buffer, fileName } = decodeBuffer(req)
    const parsed = parseLabs(buffer)

    const db = getDatabase()
    const batchId = uuidv4()

    const insertLab = db.prepare(`
      INSERT OR IGNORE INTO aki_lab_results
        (id, mrn, name, source, test_date, creatinine, order_code, batch_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
    `)

    let imported = 0
    const tx = db.transaction(() => {
      for (const p of parsed.points) {
        const info = insertLab.run(uuidv4(), p.mrn, p.name, p.source, p.testDate, p.creatinine, p.orderCode, batchId)
        if (info.changes > 0) imported++
      }
      db.prepare(`
        INSERT INTO aki_upload_batches
          (id, kind, file_name, snapshot_date, range_start, range_end, row_count, imported_count, uploaded_by)
        VALUES (?, 'labs', ?, NULL, ?, ?, ?, ?, ?)
      `).run(batchId, fileName, parsed.rangeStart, parsed.rangeEnd, parsed.rowCount, imported, req.user?.name || req.user?.username || '')
    })
    tx()

    logAuditWithRequest(req, 'AKI_UPLOAD_LABS', 'aki_lab_results', batchId, { imported, total: parsed.points.length, fileName })
    res.json({ success: true, imported, total: parsed.points.length, range: { start: parsed.rangeStart, end: parsed.rangeEnd } })
  } catch (error) {
    res.status(error.status || 500).json({ error: true, message: error.message || '匯入 CKD-AKI 明細失敗' })
  }
})

// ---------- 取得某病歷號的 Cr 散點 ----------
function getPointsByMrn(db, mrn) {
  return db
    .prepare('SELECT source, test_date AS testDate, creatinine, order_code AS orderCode FROM aki_lab_results WHERE mrn = ? ORDER BY test_date')
    .all(mrn)
    .map((r) => ({ ...r, creatinine: r.creatinine == null ? null : Number(r.creatinine) }))
}

// ---------- AKI Map（住院清單 join 分期） ----------
router.get('/map', (req, res) => {
  try {
    const db = getDatabase()
    // 決定快照日：預設取最新一筆
    let snapshotDate = (req.query.date && String(req.query.date).trim()) || null
    if (!snapshotDate) {
      const row = db.prepare('SELECT snapshot_date FROM aki_inpatients ORDER BY snapshot_date DESC LIMIT 1').get()
      snapshotDate = row?.snapshot_date || null
    }
    if (!snapshotDate) {
      return res.json({ snapshotDate: null, patients: [], summary: {}, wardSummary: {}, watchList: [], availableDates: [] })
    }

    const inpatients = db
      .prepare(`SELECT mrn, name, ward, bed, dept, physician, sex, age, admit_date AS admitDate,
                       discharge_date AS dischargeDate, diagnoses
                FROM aki_inpatients WHERE snapshot_date = ? ORDER BY ward, bed`)
      .all(snapshotDate)

    const summary = {}
    const wardSummary = {}
    const inpatientMrns = new Set()
    const modeMap = buildDialysisModeMap(db)

    const patients = inpatients.map((p) => {
      inpatientMrns.add(p.mrn)
      const pts = getPointsByMrn(db, p.mrn)
      const staging = pts.length ? stageForSeries(pts) : { category: 'no-data', stage: null, pointCount: 0, points: [] }
      summary[staging.category] = (summary[staging.category] || 0) + 1
      wardSummary[p.ward] = wardSummary[p.ward] || {}
      wardSummary[p.ward][staging.category] = (wardSummary[p.ward][staging.category] || 0) + 1
      return {
        ...p,
        diagnoses: safeJson(p.diagnoses),
        category: staging.category,
        stage: staging.stage,
        latestCr: staging.latest?.value ?? null,
        latestDate: staging.latest?.date ?? null,
        baselineCr: staging.baseline?.value ?? null,
        peakCr: staging.peak?.value ?? null,
        ratio: staging.ratio ?? null,
        pointCount: staging.pointCount ?? 0,
        dialysisMode: dialysisModeFor(modeMap, p.mrn),
      }
    })

    // 觀察名單：在 Cr 資料中但不在住院快照、且達 stage>=1 或 esrd（門急尚未收治的 AKI）
    const otherMrns = db
      .prepare('SELECT DISTINCT mrn, name FROM aki_lab_results WHERE mrn NOT IN (SELECT mrn FROM aki_inpatients WHERE snapshot_date = ?)')
      .all(snapshotDate)
    const watchList = []
    for (const o of otherMrns) {
      const staging = stageForSeries(getPointsByMrn(db, o.mrn))
      if (staging.stage >= 1 || staging.category === 'esrd') {
        watchList.push({
          mrn: o.mrn, name: o.name, category: staging.category, stage: staging.stage,
          latestCr: staging.latest?.value ?? null, latestDate: staging.latest?.date ?? null,
          baselineCr: staging.baseline?.value ?? null, peakCr: staging.peak?.value ?? null, ratio: staging.ratio ?? null,
          dialysisMode: dialysisModeFor(modeMap, o.mrn),
        })
      }
    }
    watchList.sort((a, b) => (b.stage || 0) - (a.stage || 0))

    const availableDates = db
      .prepare('SELECT DISTINCT snapshot_date AS d FROM aki_inpatients ORDER BY snapshot_date DESC LIMIT 60')
      .all().map((r) => r.d)

    res.json({ snapshotDate, patients, summary, wardSummary, watchList, availableDates, categoryMeta: AKI_CATEGORIES })
  } catch (error) {
    res.status(500).json({ error: true, message: error.message || '取得 AKI Map 失敗' })
  }
})

// ---------- 單一病人明細（趨勢 + 分期依據） ----------
router.get('/patient/:mrn', (req, res) => {
  try {
    const db = getDatabase()
    const mrn = String(req.params.mrn).trim()
    const pts = getPointsByMrn(db, mrn)
    const staging = stageForSeries(pts)
    const info = db
      .prepare(`SELECT mrn, name, ward, bed, dept, physician, sex, age, admit_date AS admitDate,
                       discharge_date AS dischargeDate, diagnoses, snapshot_date AS snapshotDate
                FROM aki_inpatients WHERE mrn = ? ORDER BY snapshot_date DESC LIMIT 1`)
      .get(mrn)
    const modeMap = buildDialysisModeMap(db)
    res.json({
      mrn,
      info: info ? { ...info, diagnoses: safeJson(info.diagnoses) } : null,
      staging,
      points: pts,
      dialysisMode: dialysisModeFor(modeMap, mrn),
    })
  } catch (error) {
    res.status(500).json({ error: true, message: error.message || '取得病人明細失敗' })
  }
})

// ---------- AKI 關懷名單 ----------

function getCareRecord(db, mrn) {
  return (
    db
      .prepare(
        `SELECT ckd_history AS ckdHistory, nephrology_consult AS nephrologyConsult, aki_cause AS akiCause,
                dialysis_status AS dialysisStatus, care_result AS careResult,
                care_physician AS carePhysician, signed_at AS signedAt,
                updated_by AS updatedBy, updated_at AS updatedAt
         FROM aki_care_records WHERE mrn = ?`,
      )
      .get(mrn) || null
  )
}

// 關懷名單排序：Stage 3→2→1→ESRD，其次床號
const CARE_RANK = { 'stage-3': 0, 'stage-2': 1, 'stage-1': 2, esrd: 3 }

// GET /api/aki/care-list?date= —— 當前快照的 AKI(1-3)+疑似ESRD 病人 + 關懷欄位
router.get('/care-list', (req, res) => {
  try {
    const db = getDatabase()
    let snapshotDate = (req.query.date && String(req.query.date).trim()) || null
    if (!snapshotDate) {
      const row = db.prepare('SELECT snapshot_date FROM aki_inpatients ORDER BY snapshot_date DESC LIMIT 1').get()
      snapshotDate = row?.snapshot_date || null
    }
    if (!snapshotDate) return res.json({ snapshotDate: null, items: [] })

    const inpatients = db
      .prepare(`SELECT mrn, name, ward, bed, dept, physician FROM aki_inpatients WHERE snapshot_date = ?`)
      .all(snapshotDate)
    const modeMap = buildDialysisModeMap(db)

    const items = []
    for (const p of inpatients) {
      const pts = getPointsByMrn(db, p.mrn)
      const staging = pts.length ? stageForSeries(pts) : { category: 'no-data', stage: null }
      const included = (staging.stage != null && staging.stage >= 1) || staging.category === 'esrd'
      if (!included) continue
      const care = getCareRecord(db, p.mrn)
      items.push({
        mrn: p.mrn,
        name: p.name,
        ward: p.ward,
        bed: p.bed,
        dept: p.dept,
        physician: p.physician,
        category: staging.category,
        stage: staging.stage,
        autoDialysisMode: dialysisModeFor(modeMap, p.mrn),
        ckdHistory: care?.ckdHistory || '',
        nephrologyConsult: care?.nephrologyConsult || '',
        akiCause: care?.akiCause || '',
        dialysisStatus: care?.dialysisStatus || '',
        careResult: care?.careResult || '',
        carePhysician: care?.carePhysician || '',
        signedAt: care?.signedAt || null,
      })
    }
    items.sort(
      (a, b) =>
        (CARE_RANK[a.category] ?? 9) - (CARE_RANK[b.category] ?? 9) ||
        String(a.bed || '').localeCompare(String(b.bed || ''), undefined, { numeric: true }),
    )
    res.json({ snapshotDate, items })
  } catch (error) {
    res.status(500).json({ error: true, message: error.message || '取得關懷名單失敗' })
  }
})

// GET /api/aki/discharged-care-list —— 曾為 AKI/ESRD、但已不在最新留院名單（推測出院）的病人
router.get('/discharged-care-list', (req, res) => {
  try {
    const db = getDatabase()
    const latest = db.prepare('SELECT snapshot_date FROM aki_inpatients ORDER BY snapshot_date DESC LIMIT 1').get()?.snapshot_date
    if (!latest) return res.json({ latestDate: null, items: [] })

    // 所有「不在最新快照」的病歷號之歷史列
    const rows = db
      .prepare(
        `SELECT mrn, name, ward, bed, dept, physician, admit_date AS admitDate,
                discharge_date AS dischargeDate, snapshot_date AS snapshotDate
         FROM aki_inpatients
         WHERE mrn NOT IN (SELECT mrn FROM aki_inpatients WHERE snapshot_date = ?)`,
      )
      .all(latest)

    // 每個病歷號取最後一次出現的列（最近快照）
    const lastByMrn = new Map()
    for (const r of rows) {
      const prev = lastByMrn.get(r.mrn)
      if (!prev || String(r.snapshotDate) > String(prev.snapshotDate)) lastByMrn.set(r.mrn, r)
    }

    const modeMap = buildDialysisModeMap(db)
    const items = []
    for (const r of lastByMrn.values()) {
      const staging = stageForSeries(getPointsByMrn(db, r.mrn))
      const included = (staging.stage != null && staging.stage >= 1) || staging.category === 'esrd'
      if (!included) continue
      const care = getCareRecord(db, r.mrn)
      items.push({
        mrn: r.mrn,
        name: r.name,
        ward: r.ward,
        bed: r.bed,
        dept: r.dept,
        physician: r.physician,
        category: staging.category,
        stage: staging.stage,
        autoDialysisMode: dialysisModeFor(modeMap, r.mrn),
        dischargeDate: r.dischargeDate || null,
        lastSeenDate: r.snapshotDate,
        ckdHistory: care?.ckdHistory || '',
        nephrologyConsult: care?.nephrologyConsult || '',
        akiCause: care?.akiCause || '',
        dialysisStatus: care?.dialysisStatus || '',
        careResult: care?.careResult || '',
        carePhysician: care?.carePhysician || '',
        signedAt: care?.signedAt || null,
      })
    }
    items.sort(
      (a, b) =>
        String(b.lastSeenDate).localeCompare(String(a.lastSeenDate)) ||
        (CARE_RANK[a.category] ?? 9) - (CARE_RANK[b.category] ?? 9),
    )
    res.json({ latestDate: latest, items })
  } catch (error) {
    res.status(500).json({ error: true, message: error.message || '取得出院關懷名單失敗' })
  }
})

// PUT /api/aki/care/:mrn —— 儲存關懷欄位；body.sign=true 時以登入者蓋章簽核
router.put('/care/:mrn', (req, res) => {
  try {
    const db = getDatabase()
    const mrn = String(req.params.mrn).trim()
    if (!mrn) return res.status(400).json({ error: true, message: '缺少病歷號' })
    const b = req.body || {}
    const updatedBy = req.user?.name || req.user?.username || ''

    db.prepare(
      `INSERT INTO aki_care_records
         (id, mrn, ckd_history, nephrology_consult, aki_cause, dialysis_status, care_result, updated_by, updated_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'), datetime('now','localtime'))
       ON CONFLICT(mrn) DO UPDATE SET
         ckd_history        = excluded.ckd_history,
         nephrology_consult = excluded.nephrology_consult,
         aki_cause          = excluded.aki_cause,
         dialysis_status    = excluded.dialysis_status,
         care_result        = excluded.care_result,
         updated_by         = excluded.updated_by,
         updated_at         = excluded.updated_at`,
    ).run(uuidv4(), mrn, b.ckdHistory ?? '', b.nephrologyConsult ?? '', b.akiCause ?? '', b.dialysisStatus ?? '', b.careResult ?? '', updatedBy)

    if (b.sign) {
      db.prepare(`UPDATE aki_care_records SET care_physician = ?, signed_at = datetime('now','localtime') WHERE mrn = ?`).run(updatedBy, mrn)
    } else if (b.clearSign) {
      db.prepare(`UPDATE aki_care_records SET care_physician = '', signed_at = NULL WHERE mrn = ?`).run(mrn)
    }

    logAuditWithRequest(req, 'AKI_CARE_SAVE', 'aki_care_records', mrn, { sign: !!b.sign })
    res.json({ success: true, care: getCareRecord(db, mrn) })
  } catch (error) {
    res.status(500).json({ error: true, message: error.message || '儲存關懷紀錄失敗' })
  }
})

// ---------- 上傳批次紀錄 ----------
router.get('/batches', (req, res) => {
  try {
    const db = getDatabase()
    const rows = db
      .prepare(`SELECT id, kind, file_name AS fileName, snapshot_date AS snapshotDate,
                       range_start AS rangeStart, range_end AS rangeEnd, row_count AS rowCount,
                       imported_count AS importedCount, uploaded_by AS uploadedBy, uploaded_at AS uploadedAt
                FROM aki_upload_batches ORDER BY uploaded_at DESC LIMIT 30`)
      .all()
    res.json({ batches: rows })
  } catch (error) {
    res.status(500).json({ error: true, message: error.message || '取得批次紀錄失敗' })
  }
})

function safeJson(s) {
  try {
    return JSON.parse(s || '[]')
  } catch {
    return []
  }
}

export default router
