// 全院 AKI Map 路由（專師專用）
import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { getDatabase } from '../db/init.js'
import { isSpecialist, logAuditWithRequest } from '../middleware/auth.js'
import { getTaipeiTodayString } from '../utils/dateUtils.js'
import { normalizeDialysisMode } from '../utils/dialysisMode.js'
import { parseInpatientsRows, parseLabsRows, stageForSeries, analyzeSeries, AKI_CATEGORIES } from '../services/akiService.js'

import { parseFirstSheet } from '../services/spreadsheetParser.js'
import { getIcuDialysisStats } from '../services/icuDialysisDaily.js'
import {
  listActiveCandidates, loadActiveCandidateMap, getActiveCandidateByMrn, createCandidate, updateCandidate, deleteCandidate,
  syncConsultPhysicianFromCare, mrnKey, CANDIDATE_RISK_ITEMS, CANDIDATE_INDICATIONS,
} from '../services/icuCandidates.js'

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
router.post('/upload/inpatients', async (req, res) => {
  try {
    const { buffer, fileName } = decodeBuffer(req)
    const parsed = parseInpatientsRows(await parseFirstSheet(buffer, { header: 1, defval: '', raw: false }))
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

// ---------- 上傳：檢驗明細（累積歷史，去重；8.1 報表含 eGFR） ----------
router.post('/upload/labs', async (req, res) => {
  try {
    const { buffer, fileName } = decodeBuffer(req)
    const parsed = parseLabsRows(await parseFirstSheet(buffer, { header: 1, defval: '', raw: false }))

    const db = getDatabase()
    const batchId = uuidv4()

    const insertLab = db.prepare(`
      INSERT OR IGNORE INTO aki_lab_results
        (id, mrn, name, source, test_date, creatinine, egfr, order_code, batch_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
    `)
    // 同一點已存在（唯一索引擋掉）時，把 eGFR 補寫回舊資料
    const backfillEgfr = db.prepare(`
      UPDATE aki_lab_results SET egfr = ?
      WHERE mrn = ? AND source = ? AND test_date = ? AND creatinine = ? AND egfr IS NULL
    `)
    // eGFR-only 點（無 Cr）：唯一索引對 NULL 不去重，需自行檢查
    const egfrOnlyExists = db.prepare(`
      SELECT 1 FROM aki_lab_results
      WHERE mrn = ? AND source = ? AND test_date = ? AND creatinine IS NULL AND egfr = ? LIMIT 1
    `)

    let imported = 0
    let egfrBackfilled = 0
    const tx = db.transaction(() => {
      for (const p of parsed.points) {
        const egfr = p.egfr ?? null
        if (p.creatinine == null) {
          if (egfr == null) continue
          if (egfrOnlyExists.get(p.mrn, p.source, p.testDate, egfr)) continue
          insertLab.run(uuidv4(), p.mrn, p.name, p.source, p.testDate, null, egfr, p.orderCode, batchId)
          imported++
          continue
        }
        const info = insertLab.run(uuidv4(), p.mrn, p.name, p.source, p.testDate, p.creatinine, egfr, p.orderCode, batchId)
        if (info.changes > 0) {
          imported++
        } else if (egfr != null) {
          const u = backfillEgfr.run(egfr, p.mrn, p.source, p.testDate, p.creatinine)
          if (u.changes > 0) egfrBackfilled++
        }
      }
      db.prepare(`
        INSERT INTO aki_upload_batches
          (id, kind, file_name, snapshot_date, range_start, range_end, row_count, imported_count, uploaded_by)
        VALUES (?, 'labs', ?, NULL, ?, ?, ?, ?, ?)
      `).run(batchId, fileName, parsed.rangeStart, parsed.rangeEnd, parsed.rowCount, imported, req.user?.name || req.user?.username || '')
    })
    tx()

    logAuditWithRequest(req, 'AKI_UPLOAD_LABS', 'aki_lab_results', batchId, { imported, egfrBackfilled, total: parsed.points.length, fileName })
    res.json({ success: true, imported, egfrBackfilled, total: parsed.points.length, range: { start: parsed.rangeStart, end: parsed.rangeEnd } })
  } catch (error) {
    res.status(error.status || 500).json({ error: true, message: error.message || '匯入檢驗明細失敗' })
  }
})

// ---------- 取得某病歷號的 Cr/eGFR 散點 ----------
function normalizePointRow(r) {
  return {
    ...r,
    creatinine: r.creatinine == null ? null : Number(r.creatinine),
    egfr: r.egfr == null ? null : Number(r.egfr),
  }
}

function getPointsByMrn(db, mrn) {
  return db
    .prepare('SELECT source, test_date AS testDate, creatinine, egfr, order_code AS orderCode FROM aki_lab_results WHERE mrn = ? ORDER BY test_date')
    .all(mrn)
    .map(normalizePointRow)
}

// 一次載入全部散點依 mrn 分組（/map、關懷名單整批計算用，避免逐病人 N+1 查詢）
function loadAllPointsGrouped(db) {
  const rows = db
    .prepare('SELECT mrn, name, source, test_date AS testDate, creatinine, egfr, order_code AS orderCode FROM aki_lab_results ORDER BY test_date')
    .all()
  const map = new Map()
  for (const r of rows) {
    const p = normalizePointRow(r)
    let arr = map.get(r.mrn)
    if (!arr) {
      arr = []
      map.set(r.mrn, arr)
    }
    arr.push(p)
  }
  return map
}

// 病程分析 → 清單用的扁平欄位（badge/篩選/匯出）
function flattenCourse(a) {
  if (!a) {
    return { ckdSuspected: false, ckdBand: null, akd: false, admissionAkiStage: null, akiCourse: null, todayAkiStage: null }
  }
  return {
    ckdSuspected: a.ckd.suspected,
    ckdBand: a.ckd.band,
    akd: a.akd.active,
    admissionAkiStage: a.admission?.hasAki ? a.admission.stage : null,
    akiCourse: a.admission?.course || null,
    todayAkiStage: a.daily?.active ? a.daily.stage : null,
  }
}

function courseFieldsFor(points, admitDate, today, dataDate) {
  if (!points || !points.length) return flattenCourse(null)
  return flattenCourse(analyzeSeries(points, { admitDate: admitDate || null, today, dataDate }))
}

// 全庫最新資料日（「當日 AKI」的判定基準日；上傳多為早上補前一日+當日報告）
function getLatestDataDate(db) {
  return db.prepare('SELECT MAX(test_date) AS d FROM aki_lab_results').get()?.d || null
}

// 關懷紀錄欄位（snake_case → camelCase）；三名單共用一份紀錄，各頁籤顯示自己的子集
const CARE_COLUMNS = `ckd_history AS ckdHistory, nephrology_consult AS nephrologyConsult, aki_cause AS akiCause,
       dialysis_status AS dialysisStatus, care_result AS careResult,
       nephrotoxin_review AS nephrotoxinReview, urine_output AS urineOutput,
       preesrd_enrolled AS preesrdEnrolled, ckd_education AS ckdEducation, vascular_prep AS vascularPrep,
       followup_appt AS followupAppt, followup_appt_date AS followupApptDate, followup_lab AS followupLab,
       contact_status AS contactStatus, closure_status AS closureStatus,
       care_physician AS carePhysician, signed_at AS signedAt, consult_physician AS consultPhysician`

// 一次載入全部關懷紀錄（名單歸類要用到人工 CKD 病史，逐筆查會 N+1）
function loadCareRecords(db) {
  const rows = db.prepare(`SELECT mrn, ${CARE_COLUMNS} FROM aki_care_records`).all()
  return new Map(rows.map((r) => [r.mrn, r]))
}

// 關懷紀錄攤平到名單項目（無紀錄時給空字串）
function careFields(care) {
  return {
    ckdHistory: care?.ckdHistory || '',
    consultPhysician: care?.consultPhysician || '',
    nephrologyConsult: care?.nephrologyConsult || '',
    akiCause: care?.akiCause || '',
    dialysisStatus: care?.dialysisStatus || '',
    careResult: care?.careResult || '',
    nephrotoxinReview: care?.nephrotoxinReview || '',
    urineOutput: care?.urineOutput || '',
    preesrdEnrolled: care?.preesrdEnrolled || '',
    ckdEducation: care?.ckdEducation || '',
    vascularPrep: care?.vascularPrep || '',
    followupAppt: care?.followupAppt || '',
    followupApptDate: care?.followupApptDate || '',
    followupLab: care?.followupLab || '',
    contactStatus: care?.contactStatus || '',
    closureStatus: care?.closureStatus || '',
    carePhysician: care?.carePhysician || '',
    signedAt: care?.signedAt || null,
  }
}

// 名單歸類（使用者決策 2026-07-07）：
// - CKD 名單：有 eGFR 慢性證據（ckd.suspected）；或疑似 ESRD 且為本院透析確定病人、且人工 CKD 病史已填（非「無」）
// - AKI 名單：全段 stage>=1；或疑似 ESRD 但未歸入 CKD（不確定以 AKI 論）
function classifyForLists(analysis, staging, dialysisMode, careRecord) {
  if (!analysis) return { inCkd: false, inAki: false }
  const manualCkd = String(careRecord?.ckdHistory || '').trim() !== '' && careRecord?.ckdHistory !== '無'
  const esrdToCkd = analysis.isEsrd && (analysis.ckd.suspected || (dialysisMode && manualCkd))
  const inCkd = analysis.ckd.suspected || esrdToCkd
  const inAki = (staging.stage != null && staging.stage >= 1) || (analysis.isEsrd && !esrdToCkd)
  return { inCkd, inAki }
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
    const pointsByMrn = loadAllPointsGrouped(db)
    const today = getTaipeiTodayString()
    const dataDate = getLatestDataDate(db)

    const patients = inpatients.map((p) => {
      inpatientMrns.add(p.mrn)
      const pts = pointsByMrn.get(p.mrn) || []
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
        ...courseFieldsFor(pts, p.admitDate, today, dataDate),
      }
    })

    // 觀察名單：在 Cr 資料中但不在住院快照、且達 stage>=1 或 esrd（門急尚未收治的 AKI）。
    // 歷史回填後全庫涵蓋數月，僅列「近 14 天內仍有檢驗」者，避免早已出院/失聯的舊個案灌爆名單。
    const WATCH_RECENT_DAYS = 14
    const watchCutoff = new Date(`${today}T00:00:00`)
    watchCutoff.setDate(watchCutoff.getDate() - WATCH_RECENT_DAYS)
    const cutoffStr = `${watchCutoff.getFullYear()}-${String(watchCutoff.getMonth() + 1).padStart(2, '0')}-${String(watchCutoff.getDate()).padStart(2, '0')}`
    const watchList = []
    for (const [mrn, pts] of pointsByMrn) {
      if (inpatientMrns.has(mrn)) continue
      if (!pts.length || pts[pts.length - 1].testDate < cutoffStr) continue
      const staging = stageForSeries(pts)
      if (staging.stage >= 1 || staging.category === 'esrd') {
        watchList.push({
          mrn, name: pts.find((p) => p.name)?.name || '', category: staging.category, stage: staging.stage,
          latestCr: staging.latest?.value ?? null, latestDate: staging.latest?.date ?? null,
          baselineCr: staging.baseline?.value ?? null, peakCr: staging.peak?.value ?? null, ratio: staging.ratio ?? null,
          dialysisMode: dialysisModeFor(modeMap, mrn),
          ...courseFieldsFor(pts, null, today, dataDate),
        })
      }
    }
    watchList.sort((a, b) => (b.stage || 0) - (a.stage || 0))

    const availableDates = db
      .prepare('SELECT DISTINCT snapshot_date AS d FROM aki_inpatients ORDER BY snapshot_date DESC LIMIT 60')
      .all().map((r) => r.d)

    res.json({ snapshotDate, latestDataDate: dataDate, patients, summary, wardSummary, watchList, availableDates, categoryMeta: AKI_CATEGORIES })
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
    const analysis = pts.length
      ? analyzeSeries(pts, { admitDate: info?.admitDate || null, today: getTaipeiTodayString(), dataDate: getLatestDataDate(db) })
      : null
    res.json({
      mrn,
      info: info ? { ...info, diagnoses: safeJson(info.diagnoses) } : null,
      staging,
      analysis,
      points: pts,
      dialysisMode: dialysisModeFor(modeMap, mrn),
    })
  } catch (error) {
    res.status(500).json({ error: true, message: error.message || '取得病人明細失敗' })
  }
})

// ---------- AKI / CKD 關懷名單 ----------

function getCareRecord(db, mrn) {
  return (
    db
      .prepare(`SELECT ${CARE_COLUMNS}, updated_by AS updatedBy, updated_at AS updatedAt FROM aki_care_records WHERE mrn = ?`)
      .get(mrn) || null
  )
}

// 關懷名單排序：AKI 發生日新→舊（無日期者沉底），同日再 Stage 3→2→1→ESRD，其次床號
const CARE_RANK = { 'stage-3': 0, 'stage-2': 1, 'stage-1': 2, esrd: 3 }
// CKD 名單排序：G5 → G3a
const CKD_RANK = { G5: 0, G4: 1, G3b: 2, G3a: 3 }

// 在院關懷名單共用計算：回傳每位在院病人的 staging/analysis/歸類/關懷紀錄
function buildCareCandidates(db, snapshotDate) {
  const inpatients = db
    .prepare(`SELECT mrn, name, ward, bed, dept, physician, admit_date AS admitDate FROM aki_inpatients WHERE snapshot_date = ?`)
    .all(snapshotDate)
  const modeMap = buildDialysisModeMap(db)
  const pointsByMrn = loadAllPointsGrouped(db)
  const careMap = loadCareRecords(db)
  const today = getTaipeiTodayString()
  const dataDate = getLatestDataDate(db)

  return inpatients.map((p) => {
    const pts = pointsByMrn.get(p.mrn) || []
    const staging = pts.length ? stageForSeries(pts) : { category: 'no-data', stage: null }
    const analysis = pts.length ? analyzeSeries(pts, { admitDate: p.admitDate || null, today, dataDate }) : null
    const dialysisMode = dialysisModeFor(modeMap, p.mrn)
    const care = careMap.get(p.mrn) || null
    const { inCkd, inAki } = classifyForLists(analysis, staging, dialysisMode, care)
    return { p, pts, staging, analysis, dialysisMode, care, inCkd, inAki }
  })
}

// candidateMap：病歷號(去前導0) → 進行中的 ICU 待透析評估紀錄；「高機率透析」＝名單上有他
function toCareItem(c, candidateMap) {
  const candidate = candidateMap?.get(mrnKey(c.p.mrn)) || null
  return {
    highDialysisProbability: !!candidate,
    icuCandidate: candidate
      ? { id: candidate.id, status: candidate.status, plannedMode: candidate.plannedMode, unit: candidate.unit, bedNo: candidate.bedNo, needsAssessment: candidate.needsAssessment }
      : null,
    mrn: c.p.mrn,
    name: c.p.name,
    ward: c.p.ward,
    bed: c.p.bed,
    dept: c.p.dept,
    physician: c.p.physician,
    category: c.staging.category,
    stage: c.staging.stage,
    ...flattenCourse(c.analysis),
    // 最近一次 AKI 事件起始日（含已緩解；ESRD/資料不足者為 null）
    akiOnsetDate: c.analysis?.akd?.lastOnsetDate ?? null,
    latestEgfr: c.analysis?.ckd?.latestEgfr ?? null,
    ckdBasis: c.analysis?.ckd?.basis || (c.analysis?.isEsrd ? '全段 Cr≥4.0 疑似 ESRD' : null),
    autoDialysisMode: c.dialysisMode,
    ...careFields(c.care),
  }
}

function resolveSnapshotDate(db, req) {
  let snapshotDate = (req.query.date && String(req.query.date).trim()) || null
  if (!snapshotDate) {
    const row = db.prepare('SELECT snapshot_date FROM aki_inpatients ORDER BY snapshot_date DESC LIMIT 1').get()
    snapshotDate = row?.snapshot_date || null
  }
  return snapshotDate
}

// GET /api/aki/care-list?date= —— AKI 關懷名單：全段 stage>=1，或疑似 ESRD 且未歸入 CKD（不確定以 AKI 論）
router.get('/care-list', (req, res) => {
  try {
    const db = getDatabase()
    const snapshotDate = resolveSnapshotDate(db, req)
    if (!snapshotDate) return res.json({ snapshotDate: null, items: [] })

    const candidateMap = loadActiveCandidateMap(db)
    const items = buildCareCandidates(db, snapshotDate)
      .filter((c) => c.inAki)
      .map((c) => toCareItem(c, candidateMap))
    items.sort(
      (a, b) =>
        String(b.akiOnsetDate || '').localeCompare(String(a.akiOnsetDate || '')) ||
        (CARE_RANK[a.category] ?? 9) - (CARE_RANK[b.category] ?? 9) ||
        String(a.bed || '').localeCompare(String(b.bed || ''), undefined, { numeric: true }),
    )
    res.json({ snapshotDate, items })
  } catch (error) {
    res.status(500).json({ error: true, message: error.message || '取得關懷名單失敗' })
  }
})

// GET /api/aki/ckd-care-list?date= —— CKD 關懷名單：eGFR 慢性證據，或疑似 ESRD 之透析確定病人＋人工 CKD 病史
router.get('/ckd-care-list', (req, res) => {
  try {
    const db = getDatabase()
    const snapshotDate = resolveSnapshotDate(db, req)
    if (!snapshotDate) return res.json({ snapshotDate: null, items: [] })

    const candidateMap = loadActiveCandidateMap(db)
    const items = buildCareCandidates(db, snapshotDate)
      .filter((c) => c.inCkd)
      .map((c) => toCareItem(c, candidateMap))
    items.sort(
      (a, b) =>
        (CKD_RANK[a.ckdBand] ?? 9) - (CKD_RANK[b.ckdBand] ?? 9) ||
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
    const pointsByMrn = loadAllPointsGrouped(db)
    const today = getTaipeiTodayString()
    const dataDate = getLatestDataDate(db)
    const items = []
    for (const r of lastByMrn.values()) {
      const pts = pointsByMrn.get(r.mrn) || []
      const staging = pts.length ? stageForSeries(pts) : { category: 'no-data', stage: null }
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
        ...courseFieldsFor(pts, r.admitDate, today, dataDate),
        autoDialysisMode: dialysisModeFor(modeMap, r.mrn),
        dischargeDate: r.dischargeDate || null,
        lastSeenDate: r.snapshotDate,
        ...careFields(care),
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

// camelCase → DB 欄位對照（PUT 部分更新用）
const CARE_FIELD_MAP = {
  ckdHistory: 'ckd_history',
  nephrologyConsult: 'nephrology_consult',
  consultPhysician: 'consult_physician',
  akiCause: 'aki_cause',
  dialysisStatus: 'dialysis_status',
  careResult: 'care_result',
  nephrotoxinReview: 'nephrotoxin_review',
  urineOutput: 'urine_output',
  preesrdEnrolled: 'preesrd_enrolled',
  ckdEducation: 'ckd_education',
  vascularPrep: 'vascular_prep',
  followupAppt: 'followup_appt',
  followupApptDate: 'followup_appt_date',
  followupLab: 'followup_lab',
  contactStatus: 'contact_status',
  closureStatus: 'closure_status',
}

// PUT /api/aki/care/:mrn —— 儲存關懷欄位；body.sign=true 時以登入者蓋章簽核。
// 只更新 body 有帶的欄位（undefined = 不動），避免不同頁籤存檔互相洗掉對方的欄位。
router.put('/care/:mrn', (req, res) => {
  try {
    const db = getDatabase()
    const mrn = String(req.params.mrn).trim()
    if (!mrn) return res.status(400).json({ error: true, message: '缺少病歷號' })
    const b = req.body || {}
    const updatedBy = req.user?.name || req.user?.username || ''

    db.prepare('INSERT OR IGNORE INTO aki_care_records (id, mrn) VALUES (?, ?)').run(uuidv4(), mrn)
    const prevConsultPhysician = getCareRecord(db, mrn)?.consultPhysician || ''
    const sets = []
    const vals = []
    for (const [key, col] of Object.entries(CARE_FIELD_MAP)) {
      if (b[key] !== undefined) {
        sets.push(`${col} = ?`)
        vals.push(b[key] ?? '')
      }
    }
    sets.push('updated_by = ?', "updated_at = datetime('now','localtime')")
    vals.push(updatedBy)
    db.prepare(`UPDATE aki_care_records SET ${sets.join(', ')} WHERE mrn = ?`).run(...vals, mrn)

    if (b.sign) {
      db.prepare(`UPDATE aki_care_records SET care_physician = ?, signed_at = datetime('now','localtime') WHERE mrn = ?`).run(updatedBy, mrn)
    } else if (b.clearSign) {
      db.prepare(`UPDATE aki_care_records SET care_physician = '', signed_at = NULL WHERE mrn = ?`).run(mrn)
    }

    // 會診醫師與 ICU 待透析評估紀錄雙向同步。整列存檔每次都會帶這個欄位，
    // 只在「這次真的改了」才同步，免得名單開太久的舊值把醫師剛在 ICU 頁填的洗掉
    const nextConsultPhysician = b.consultPhysician !== undefined ? String(b.consultPhysician ?? '').trim() : prevConsultPhysician
    if (nextConsultPhysician !== prevConsultPhysician) syncConsultPhysicianFromCare(db, mrn, nextConsultPhysician, updatedBy)

    // 「高機率透析」＝ICU 待透析評估名單上有他：勾→帶基本資料建一筆（預計模式未定＝待補評估）；
    // 取消→把進行中那筆結案為「不需透析」（不刪，留紀錄）。快照顯示不在 ICU 時單位留空，ICU 頁列「床位待確認」。
    if (b.highDialysisProbability !== undefined) {
      const active = getActiveCandidateByMrn(db, mrn)
      if (b.highDialysisProbability && !active) {
        const inpatient = latestInpatientRow(db, mrn)
        const icu = parseIcuWard(inpatient?.bed) || parseIcuWard(inpatient?.ward)
        createCandidate(
          db,
          {
            mrn,
            name: inpatient?.name || String(b.name ?? '').trim() || mrn,
            unit: icu && ICU_UNITS.some((u) => u.key === icu.unit) ? icu.unit : '',
            bedNo: icu ? icu.bedNo : [inpatient?.ward, inpatient?.bed].filter(Boolean).join(' '),
            physician: inpatient?.physician || '',
            consultPhysician: getCareRecord(db, mrn)?.consultPhysician || '',
            consultDate: getTaipeiTodayString(),
          },
          updatedBy,
          { requireIcuUnit: false, source: 'aki' },
        )
      } else if (!b.highDialysisProbability && active) {
        updateCandidate(db, active.id, { status: '不需透析' }, updatedBy)
      }
    }

    logAuditWithRequest(req, 'AKI_CARE_SAVE', 'aki_care_records', mrn, { sign: !!b.sign })
    const candidate = getActiveCandidateByMrn(db, mrn)
    res.json({
      success: true,
      care: getCareRecord(db, mrn),
      highDialysisProbability: !!candidate,
      icuCandidate: candidate
        ? { id: candidate.id, status: candidate.status, plannedMode: candidate.plannedMode, unit: candidate.unit, bedNo: candidate.bedNo, needsAssessment: candidate.needsAssessment }
        : null,
    })
  } catch (error) {
    res.status(500).json({ error: true, message: error.message || '儲存關懷紀錄失敗' })
  }
})

// ---------- ICU 透析病人（HD / SLED / CVVHDF）分區清單 ----------
// 資料來源以透析系統 patients 表為準（護理師即時維護的住院狀態＋病房號 ICUA-xx/ICUB-xx/ICUD-xx），
// 不用 AKI 住院快照（專師定期上傳，會落後）；AKI 分期只當附加資訊以病歷號對接。
const ICU_UNITS = [
  { key: 'ICUA', label: '第一加護病房' },
  { key: 'ICUB', label: '第二加護病房' },
  { key: 'ICUD', label: '第三加護病房' },
]

// 病房號 "ICUA-01" / "ICUD-8" / "icub 15" → { unit:'ICUA', bedNo:'ICUA-08', bedSort:8 }；非 ICU → null
function parseIcuWard(wardNumber) {
  const s = String(wardNumber == null ? '' : wardNumber).trim().toUpperCase()
  const m = s.match(/^ICU\s*-?\s*([A-Z])\s*-?\s*(\d+)?/)
  if (!m) return null
  const unit = `ICU${m[1]}`
  const bedSort = m[2] ? Number(m[2]) : 999
  const bedNo = m[2] ? `${unit}-${String(bedSort).padStart(2, '0')}` : unit
  return { unit, bedNo, bedSort }
}

function safeObj(s) {
  try {
    const v = JSON.parse(s || '{}')
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

function ageFrom(birthDate, today) {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}/.test(String(birthDate))) return null
  const b = String(birthDate).slice(0, 10)
  let age = Number(today.slice(0, 4)) - Number(b.slice(0, 4))
  if (today.slice(5) < b.slice(5)) age -= 1
  return age >= 0 && age < 130 ? age : null
}

const ICU_STATUS_COLUMNS = `vasopressor, vasopressor_detail AS vasopressorDetail,
       ecmo, ecmo_detail AS ecmoDetail,
       oxygen, oxygen_detail AS oxygenDetail,
       uf_difficulty AS ufDifficulty, uf_detail AS ufDetail,
       vaso_high AS vasoHigh, map_low AS mapLow, lactate_high AS lactateHigh, brain_injury AS brainInjury,
       updated_by AS updatedBy, updated_at AS updatedAt`

// camelCase → DB 欄位（PUT 部分更新用；updated_by/updated_at 由伺服器寫）
const ICU_STATUS_FIELD_MAP = {
  vasopressor: 'vasopressor',
  vasopressorDetail: 'vasopressor_detail',
  ecmo: 'ecmo',
  ecmoDetail: 'ecmo_detail',
  oxygen: 'oxygen',
  oxygenDetail: 'oxygen_detail',
  ufDifficulty: 'uf_difficulty',
  ufDetail: 'uf_detail',
  // CRRT 風險檢核人工勾選項
  vasoHigh: 'vaso_high',
  mapLow: 'map_low',
  lactateHigh: 'lactate_high',
  brainInjury: 'brain_injury',
}

function icuStatusFields(s) {
  return {
    vasopressor: s?.vasopressor || '',
    vasopressorDetail: s?.vasopressorDetail || '',
    ecmo: s?.ecmo || '',
    ecmoDetail: s?.ecmoDetail || '',
    oxygen: s?.oxygen || '',
    oxygenDetail: s?.oxygenDetail || '',
    ufDifficulty: s?.ufDifficulty || '',
    ufDetail: s?.ufDetail || '',
    vasoHigh: s?.vasoHigh || '',
    mapLow: s?.mapLow || '',
    lactateHigh: s?.lactateHigh || '',
    brainInjury: s?.brainInjury || '',
    statusUpdatedBy: s?.updatedBy || '',
    statusUpdatedAt: s?.updatedAt || null,
  }
}

// ---------- CRRT 需求風險檢核（排程借機用；由 IHD 透析中低血壓預測因子外推，非經驗證的臨床分數） ----------
// 門檻由使用者裁定（2026-09-07）：≥4 分或「腦損傷／顱內壓↑／急性肝衰竭」直接考慮 → 建議提前借第 6 台。
// 只對 HD / SLED 病人計算；CVVHDF 病人已在 CRRT 上，不適用。
export const CRRT_RISK_THRESHOLD = 4
export const CRRT_RISK_ITEMS = [
  { key: 'vaso', label: '使用升壓劑', pts: 2, hit: (f) => f.vasopressor === '有' },
  { key: 'vasoHigh', label: 'NE ≥0.3 µg/kg/min 或 24h 內加量／加第二種', pts: 1, hit: (f) => f.vasopressor === '有' && f.vasoHigh === '有' },
  { key: 'mapLow', label: '透析前 MAP <65', pts: 1, hit: (f) => f.mapLow === '有' },
  { key: 'lactate', label: '乳酸 >2 或 CRT ≥3 秒', pts: 1, hit: (f) => f.lactateHigh === '有' },
  { key: 'uf', label: '上次 HD/SLED 脫水達不到目標或低血壓中止', pts: 2, hit: (f) => f.ufDifficulty === '有' },
  { key: 'vent', label: '侵入性機械通氣', pts: 1, hit: (f) => f.oxygen === '呼吸器' },
  { key: 'ecmo', label: 'ECMO', pts: 1, hit: (f) => f.ecmo === '有' },
]
export const CRRT_RISK_MAX = CRRT_RISK_ITEMS.reduce((s, i) => s + i.pts, 0)

export function computeCrrtRisk(fields, mode) {
  const hits = CRRT_RISK_ITEMS.filter((i) => i.hit(fields))
  const score = hits.reduce((s, i) => s + i.pts, 0)
  const direct = fields.brainInjury === '有'
  const applicable = String(mode || '').toUpperCase() !== 'CVVHDF'
  return {
    crrtApplicable: applicable,
    crrtScore: score,
    crrtMax: CRRT_RISK_MAX,
    crrtThreshold: CRRT_RISK_THRESHOLD,
    crrtDirect: direct,
    crrtFlag: applicable && (direct || score >= CRRT_RISK_THRESHOLD),
    crrtItems: hits.map((i) => `${i.label} +${i.pts}`),
  }
}

function getIcuStatus(db, patientId) {
  return db.prepare(`SELECT ${ICU_STATUS_COLUMNS} FROM icu_dialysis_status WHERE patient_id = ?`).get(patientId) || null
}

/**
 * 目前在 ICU 的透析病人，依 ICUA / ICUB / ICUD 分區（回 { units, total }）。
 * 供專師頁籤 GET /aki/icu-dialysis 與免登入唯讀展示頁（dashboard.js，回傳前另做姓名/病歷號遮罩）共用。
 */
export function buildIcuDialysisData(db) {
    const rows = db
      .prepare(`SELECT id, medical_record_number AS mrn, name, status, ward_number AS wardNumber,
                       gender, birth_date AS birthDate, physician, vasc_access AS vascAccess,
                       dialysis_orders AS dialysisOrders, schedule_rule AS scheduleRule,
                       inpatient_reason AS inpatientReason, patient_status AS patientStatus
                FROM patients
                WHERE is_deleted = 0 AND status IN ('ipd', 'er') AND UPPER(TRIM(COALESCE(ward_number, ''))) LIKE 'ICU%'`)
      .all()
    const statusMap = new Map(
      db.prepare(`SELECT patient_id AS patientId, ${ICU_STATUS_COLUMNS} FROM icu_dialysis_status`).all()
        .map((r) => [r.patientId, r]),
    )
    const today = getTaipeiTodayString()

    const items = []
    for (const r of rows) {
      const icu = parseIcuWard(r.wardNumber)
      if (!icu) continue
      const orders = safeObj(r.dialysisOrders)
      const rule = safeObj(r.scheduleRule)
      const pstatus = safeObj(r.patientStatus)
      const mode = orders.mode != null && String(orders.mode).trim() ? normalizeDialysisMode(String(orders.mode)) : ''
      // AKI 檢驗散點 mrn 為 10 碼補零；patients 病歷號 6~7 碼（偶有前導 0），去 0 再補齊
      const paddedMrn = looseMrn(r.mrn).padStart(10, '0')
      const pts = looseMrn(r.mrn) ? getPointsByMrn(db, paddedMrn) : []
      const staging = pts.length ? stageForSeries(pts) : null
      const statusFields = icuStatusFields(statusMap.get(r.id))
      items.push({
        id: r.id,
        mrn: r.mrn,
        name: r.name,
        status: r.status,
        wardNumber: r.wardNumber,
        unit: icu.unit,
        bedNo: icu.bedNo,
        bedSort: icu.bedSort,
        gender: r.gender || '',
        age: ageFrom(r.birthDate, today),
        physician: r.physician || '',
        vascAccess: r.vascAccess || orders.vascAccess || '',
        mode,
        freq: rule.freq || orders.freq || '',
        bedNum: rule.bedNum ?? null,
        shiftIndex: rule.shiftIndex ?? null,
        dryWeight: orders.dryWeight ?? null,
        dialysisTimeText: orders.dialysisTimeText || (orders.dialysisHours != null ? `${orders.dialysisHours}時` : ''),
        inpatientReason: r.inpatientReason || '',
        doNotMove: !!pstatus?.doNotMove?.active,
        // 首次透析標註（SOCRATE：首次 ICU 透析不耐受 43%）：本院初透或首次透析旗標 active
        firstDialysis: !!(pstatus?.isFirstDialysis?.active || pstatus?.hospitalFirstDialysis?.active),
        akiCategory: staging?.category || null,
        akiStage: staging?.stage ?? null,
        latestCr: staging?.latest?.value ?? null,
        latestCrDate: staging?.latest?.date ?? null,
        ...statusFields,
        ...computeCrrtRisk(statusFields, mode),
      })
    }
    items.sort((a, b) => a.unit.localeCompare(b.unit) || a.bedSort - b.bedSort || a.name.localeCompare(b.name, 'zh-Hant'))

    const units = ICU_UNITS.map((u) => ({ ...u, patients: items.filter((i) => i.unit === u.key) }))
    const others = items.filter((i) => !ICU_UNITS.some((u) => u.key === i.unit))
    if (others.length) units.push({ key: 'OTHER', label: '其他加護單位', patients: others })

    // 待透析評估（已會診、可能需要透析）：與「透析中」病人同頁呈現；免登入展示頁回傳前同樣要遮罩
    const candidates = listActiveCandidates(db).map((c) => enrichCandidate(db, c, items))

    return { units, total: items.length, candidates }
}

// GET /api/aki/icu-dialysis —— 目前在 ICU 的透析病人，依 ICUA / ICUB / ICUD 分區
router.get('/icu-dialysis', (req, res) => {
  try {
    res.json(buildIcuDialysisData(getDatabase()))
  } catch (error) {
    res.status(500).json({ error: true, message: error.message || '取得 ICU 透析病人失敗' })
  }
})

// ---------- ICU 待透析評估名單（已會診、可能需要 HD／SLED／CVVHDF） ----------

// 最新住院快照裡的這位病人（AKI 檔病歷號 10 碼補零；人工輸入可能沒補零）
function latestInpatientRow(db, mrn) {
  const key = mrnKey(mrn)
  if (!key) return null
  return (
    db
      .prepare(
        `SELECT mrn, name, ward, bed, physician FROM aki_inpatients
          WHERE mrn IN (?, ?, ?) ORDER BY snapshot_date DESC LIMIT 1`,
      )
      .get(String(mrn).trim(), key, key.padStart(10, '0')) || null
  )
}

// 待評估病人附加資訊：AKI 分期／最近 Cr；若已出現在「ICU 透析中」名單＝已開始透析，前端提示結案
function enrichCandidate(db, candidate, dialysisItems) {
  const key = mrnKey(candidate.mrn)
  const pts = key ? getPointsByMrn(db, key.padStart(10, '0')) : []
  const staging = pts.length ? stageForSeries(pts) : null
  const started = dialysisItems.find((i) => mrnKey(i.mrn) === key) || null
  return {
    ...candidate,
    akiCategory: staging?.category ?? null,
    akiStage: staging?.stage ?? null,
    latestCr: staging?.latest?.value ?? null,
    latestCrDate: staging?.latest?.date ?? null,
    startedDialysis: started ? { mode: started.mode, bedNo: started.bedNo } : null,
  }
}

// GET /api/aki/icu-candidates/options —— 表單選項（適應症／血行動力學項目與配分），前後端共用同一份定義
router.get('/icu-candidates/options', (req, res) => {
  res.json({ indications: CANDIDATE_INDICATIONS, riskItems: CANDIDATE_RISK_ITEMS })
})

// GET /api/aki/icu-candidates/lookup?q= —— 新增時用病歷號／姓名從最新住院快照帶入基本資料（查不到仍可手動填）
router.get('/icu-candidates/lookup', (req, res) => {
  try {
    const db = getDatabase()
    const q = String(req.query.q || '').trim()
    if (q.length < 2) return res.json({ items: [] })
    const latest = db.prepare('SELECT snapshot_date FROM aki_inpatients ORDER BY snapshot_date DESC LIMIT 1').get()?.snapshot_date
    if (!latest) return res.json({ items: [] })
    const key = mrnKey(q)
    const rows = db
      .prepare(
        `SELECT mrn, name, ward, bed, physician FROM aki_inpatients
          WHERE snapshot_date = ? AND (name LIKE ? OR mrn LIKE ?)
          ORDER BY bed LIMIT 12`,
      )
      .all(latest, `%${q}%`, `%${key || q}%`)
    const activeMap = loadActiveCandidateMap(db)
    res.json({
      snapshotDate: latest,
      items: rows.map((r) => {
        const icu = parseIcuWard(r.bed) || parseIcuWard(r.ward)
        const inIcu = !!icu && ICU_UNITS.some((u) => u.key === icu.unit)
        return {
          mrn: r.mrn,
          name: r.name,
          ward: r.ward,
          bed: r.bed,
          physician: r.physician,
          unit: inIcu ? icu.unit : '',
          bedNo: inIcu ? icu.bedNo : '',
          alreadyListed: activeMap.has(mrnKey(r.mrn)),
        }
      }),
    })
  } catch (error) {
    res.status(500).json({ error: true, message: error.message || '查詢住院病人失敗' })
  }
})

// POST /api/aki/icu-candidates —— ICU 透析頁由醫師直接新增（必選 ICUA／ICUB／ICUD）
router.post('/icu-candidates', (req, res) => {
  try {
    const db = getDatabase()
    const userName = req.user?.name || req.user?.username || ''
    const candidate = createCandidate(db, req.body || {}, userName, { requireIcuUnit: true, source: 'icu' })
    logAuditWithRequest(req, 'ICU_CANDIDATE_CREATE', 'icu_dialysis_candidates', candidate.id, { mrn: candidate.mrn })
    res.status(201).json({ success: true, candidate })
  } catch (error) {
    res.status(error.status || 500).json({ error: true, message: error.message || '新增待評估病人失敗', existing: error.existing })
  }
})

// PUT /api/aki/icu-candidates/:id —— 部分更新（含結案／重新開啟）
router.put('/icu-candidates/:id', (req, res) => {
  try {
    const db = getDatabase()
    const userName = req.user?.name || req.user?.username || ''
    const candidate = updateCandidate(db, req.params.id, req.body || {}, userName)
    logAuditWithRequest(req, 'ICU_CANDIDATE_UPDATE', 'icu_dialysis_candidates', candidate.id, { fields: Object.keys(req.body || {}) })
    res.json({ success: true, candidate })
  } catch (error) {
    res.status(error.status || 500).json({ error: true, message: error.message || '更新待評估病人失敗', existing: error.existing })
  }
})

// DELETE /api/aki/icu-candidates/:id —— 誤建才刪；正常流程請用結案狀態
router.delete('/icu-candidates/:id', (req, res) => {
  try {
    const removed = deleteCandidate(getDatabase(), req.params.id)
    logAuditWithRequest(req, 'ICU_CANDIDATE_DELETE', 'icu_dialysis_candidates', removed.id, { mrn: removed.mrn, name: removed.name })
    res.json({ success: true })
  } catch (error) {
    res.status(error.status || 500).json({ error: true, message: error.message || '刪除待評估病人失敗' })
  }
})

// GET /api/aki/icu-dialysis/stats?year=2026[&month=9][&unit=ICUA] —— ICU 透析病人月／年統計
// month 有值＝回該月每日 HD/SLED/CVVHDF 人數；無＝回該年 12 個月彙總。資料自上線日起由 scheduler 每小時累積，
// 今天則把此刻名單疊上去（唯讀，不在 GET 寫 DB）。
router.get('/icu-dialysis/stats', (req, res) => {
  try {
    const today = getTaipeiTodayString()
    const year = Number(req.query.year || today.slice(0, 4))
    const month = req.query.month ? Number(req.query.month) : null
    const unit = req.query.unit ? String(req.query.unit).toUpperCase() : null
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return res.status(400).json({ error: true, message: '年份不正確' })
    }
    if (month !== null && (!Number.isInteger(month) || month < 1 || month > 12)) {
      return res.status(400).json({ error: true, message: '月份不正確' })
    }
    if (unit && ![...ICU_UNITS.map((u) => u.key), 'OTHER'].includes(unit)) {
      return res.status(400).json({ error: true, message: '加護單位不正確' })
    }
    const db = getDatabase()
    const livePatients = buildIcuDialysisData(db).units.flatMap((u) => u.patients)
    res.json(getIcuDialysisStats(db, { year, month, unit, today, livePatients }))
  } catch (error) {
    res.status(500).json({ error: true, message: error.message || '取得 ICU 透析統計失敗' })
  }
})

// PUT /api/aki/icu-status/:patientId —— 儲存 ICU 臨床狀態（升壓劑/ECMO/氧氣/脫水困難）
// 只更新 body 有帶的欄位（undefined = 不動）
router.put('/icu-status/:patientId', (req, res) => {
  try {
    const db = getDatabase()
    const patientId = String(req.params.patientId || '').trim()
    if (!patientId) return res.status(400).json({ error: true, message: '缺少病人 ID' })
    const patient = db
      .prepare('SELECT id, medical_record_number AS mrn, dialysis_orders AS dialysisOrders FROM patients WHERE id = ? AND is_deleted = 0')
      .get(patientId)
    if (!patient) return res.status(404).json({ error: true, message: '找不到病人' })

    const b = req.body || {}
    const updatedBy = req.user?.name || req.user?.username || ''
    const sets = []
    const vals = []
    for (const [key, col] of Object.entries(ICU_STATUS_FIELD_MAP)) {
      if (b[key] !== undefined) {
        sets.push(`${col} = ?`)
        vals.push(b[key] == null ? '' : String(b[key]).slice(0, 500))
      }
    }
    if (!sets.length) return res.status(400).json({ error: true, message: '沒有可更新的欄位' })

    db.prepare('INSERT OR IGNORE INTO icu_dialysis_status (id, patient_id) VALUES (?, ?)').run(uuidv4(), patientId)
    sets.push('updated_by = ?', "updated_at = datetime('now','localtime')")
    vals.push(updatedBy)
    db.prepare(`UPDATE icu_dialysis_status SET ${sets.join(', ')} WHERE patient_id = ?`).run(...vals, patientId)

    logAuditWithRequest(req, 'ICU_DIALYSIS_STATUS_SAVE', 'icu_dialysis_status', patientId, { mrn: patient.mrn, fields: Object.keys(b) })
    const orders = safeObj(patient.dialysisOrders)
    const mode = orders.mode != null && String(orders.mode).trim() ? normalizeDialysisMode(String(orders.mode)) : ''
    const statusFields = icuStatusFields(getIcuStatus(db, patientId))
    res.json({ success: true, status: { ...statusFields, ...computeCrrtRisk(statusFields, mode) } })
  } catch (error) {
    res.status(500).json({ error: true, message: error.message || '儲存 ICU 狀態失敗' })
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
