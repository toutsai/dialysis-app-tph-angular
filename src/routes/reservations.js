// 預約洗腎登記本（2026-09-05）：本院既有病人 / 他院待排病人 的預約登記，
// 並依「預約頻率（星期多選）＋預約班別＋B/C 肝」比對床位總表的長期空床。
// 權限：admin/editor（與 KiDit 申報同）。
// ⚠️ 他院待排病人刻意不寫入 patients 表（同重大傷病 PD 病人作法），避免流入排程/護理/KiDit；
//    排定後由組長在病人管理另行建檔（第二階段再做一鍵建檔）。
import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { getDatabase } from '../db/init.js'
import { isEditor } from '../middleware/auth.js'
import { getTaipeiTodayString, getTaipeiDayIndex } from '../utils/dateUtils.js'
import {
  FREQ_MAP_TO_DAY_INDEX,
  SHIFTS,
  MAIN_BED_NUMBERS,
  HEPATITIS_BED_NUMBERS,
  getScheduleKey,
  getFreqFromDayIndices,
} from '../utils/scheduleUtils.js'
import { HEPATITIS_VALUES, parseHepatitisStatus, upgradeHepatitisStatus } from '../utils/hepatitis.js'

const router = Router()

const KINDS = ['existing', 'external']
const STATUSES = ['pending', 'scheduled', 'cancelled']
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DAY_LABELS = ['一', '二', '三', '四', '五', '六']

const str = (v) => (typeof v === 'string' ? v.trim() : '')

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback
  } catch {
    return fallback
  }
}

/** 星期索引陣列正規化（0=週一…5=週六，去重排序）；非陣列回 null */
function normalizeFreqDays(input) {
  if (input === undefined || input === null) return []
  if (!Array.isArray(input)) return null
  const days = [...new Set(input.map((d) => Number(d)))]
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 5)
    .sort((a, b) => a - b)
  return days
}

function normalizeHepatitisValue(v) {
  const s = str(v).toUpperCase()
  return HEPATITIS_VALUES.includes(s) ? s : ''
}

/** 由 patients 列取出 B/C 肝四態（缺項由 diseases 標籤補）與原透析院所 */
function snapshotFromPatient(patientRow) {
  const hep = upgradeHepatitisStatus(
    parseHepatitisStatus(patientRow.hepatitis_status),
    parseJson(patientRow.diseases, []),
  )
  const hospitalInfo = parseJson(patientRow.hospital_info, {})
  return {
    name: patientRow.name,
    medicalRecordNumber: patientRow.medical_record_number || '',
    hbsag: hep.hbsag || '',
    antihcv: hep.antihcv || '',
    originClinic: str(hospitalInfo?.source),
    isDeleted: Number(patientRow.is_deleted) === 1,
  }
}

function toApiShape(row, patientRow = null) {
  const live = patientRow ? snapshotFromPatient(patientRow) : null
  return {
    id: row.id,
    kind: row.kind,
    patientId: row.patient_id || null,
    // 本院既有病人：姓名/病歷號/B/C 肝以病人清單即時資料為準（登記時的快照僅供病人被刪除後顯示）
    name: live?.name || row.name,
    medicalRecordNumber: live?.medicalRecordNumber || row.medical_record_number || '',
    patientDeleted: live ? live.isDeleted : (row.kind === 'existing' && !!row.patient_id),
    registeredDate: row.registered_date,
    freqDays: parseJson(row.freq_days, []),
    freq: row.freq || null,
    shift: row.shift || '',
    originClinic: row.origin_clinic || '',
    hbsag: live ? live.hbsag : (row.hbsag || ''),
    antihcv: live ? live.antihcv : (row.antihcv || ''),
    contactName: row.contact_name || '',
    contactRelation: row.contact_relation || '',
    contactPhone: row.contact_phone || '',
    status: row.status,
    matchedBed: row.matched_bed || '',
    note: row.note || '',
    createdBy: parseJson(row.created_by, {}),
    updatedBy: parseJson(row.updated_by, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const PATIENT_COLUMNS = 'id, name, medical_record_number, hepatitis_status, diseases, hospital_info, is_deleted'

function loadPatientsById(db, ids) {
  const unique = [...new Set(ids.filter(Boolean))]
  const map = new Map()
  if (unique.length === 0) return map
  const placeholders = unique.map(() => '?').join(', ')
  const rows = db.prepare(`SELECT ${PATIENT_COLUMNS} FROM patients WHERE id IN (${placeholders})`).all(...unique)
  for (const r of rows) map.set(r.id, r)
  return map
}

function getById(db, id) {
  const row = db.prepare('SELECT * FROM dialysis_reservations WHERE id = ?').get(id)
  if (!row) return null
  const patientRow = row.patient_id
    ? db.prepare(`SELECT ${PATIENT_COLUMNS} FROM patients WHERE id = ?`).get(row.patient_id)
    : null
  return toApiShape(row, patientRow)
}

/**
 * 驗證並整理寫入欄位。partial=true 時未帶的欄位不動（PUT 守衛式部分更新）。
 * 回 { ok:true, fields } 或 { ok:false, message }
 */
function buildFields(db, body, { partial, existing }) {
  const b = body || {}
  const fields = {}
  const kind = b.kind !== undefined ? str(b.kind) : existing?.kind
  if (!KINDS.includes(kind)) return { ok: false, message: 'kind 必須為 existing 或 external' }
  fields.kind = kind

  if (b.registeredDate !== undefined || !partial) {
    const d = str(b.registeredDate) || (partial ? existing.registered_date : getTaipeiTodayString())
    if (!DATE_RE.test(d)) return { ok: false, message: '登記日期格式必須為 YYYY-MM-DD' }
    fields.registered_date = d
  }

  if (b.freqDays !== undefined || !partial) {
    const days = normalizeFreqDays(b.freqDays)
    if (days === null) return { ok: false, message: '預約頻率格式錯誤' }
    fields.freq_days = JSON.stringify(days)
    fields.freq = getFreqFromDayIndices(days)
  }

  if (b.shift !== undefined || !partial) {
    const shift = str(b.shift)
    if (shift && !SHIFTS.includes(shift)) return { ok: false, message: '預約班別必須為 early/noon/late' }
    fields.shift = shift || null
  }

  for (const [key, column] of [
    ['originClinic', 'origin_clinic'],
    ['contactName', 'contact_name'],
    ['contactRelation', 'contact_relation'],
    ['contactPhone', 'contact_phone'],
    ['note', 'note'],
    ['matchedBed', 'matched_bed'],
  ]) {
    if (b[key] === undefined && partial) continue
    if (b[key] !== undefined && typeof b[key] !== 'string') return { ok: false, message: `${key} 格式錯誤` }
    fields[column] = str(b[key]) || null
  }

  if (b.status !== undefined || !partial) {
    const status = str(b.status) || 'pending'
    if (!STATUSES.includes(status)) return { ok: false, message: 'status 必須為 pending/scheduled/cancelled' }
    fields.status = status
  }

  // 病人身分：existing 由 patientId 快照；external 手填
  const patientIdGiven = b.patientId !== undefined
  if (kind === 'existing') {
    const patientId = patientIdGiven ? str(b.patientId) : (existing?.patient_id || '')
    if (!patientId) return { ok: false, message: '本院既有病人必須選擇病人' }
    if (patientIdGiven || !partial || existing?.kind !== 'existing') {
      const patientRow = db.prepare(`SELECT ${PATIENT_COLUMNS} FROM patients WHERE id = ?`).get(patientId)
      if (!patientRow) return { ok: false, message: '找不到病人' }
      const snap = snapshotFromPatient(patientRow)
      fields.patient_id = patientId
      fields.name = snap.name
      fields.medical_record_number = snap.medicalRecordNumber || null
      fields.hbsag = snap.hbsag || null
      fields.antihcv = snap.antihcv || null
      // 原透析院所：未手填時帶病人資料的原透析院所
      if (b.originClinic === undefined) {
        fields.origin_clinic = snap.originClinic || existing?.origin_clinic || null
      }
    }
  } else {
    if (b.name !== undefined || !partial || existing?.kind !== 'external') {
      const name = str(b.name) || (partial ? existing?.name : '')
      if (!name) return { ok: false, message: '病人姓名為必填' }
      fields.name = name
    }
    if (patientIdGiven || existing?.kind !== 'external') fields.patient_id = null
    if (b.medicalRecordNumber !== undefined) fields.medical_record_number = str(b.medicalRecordNumber) || null
    for (const key of ['hbsag', 'antihcv']) {
      if (b[key] === undefined && partial && existing?.kind === 'external') continue
      const v = normalizeHepatitisValue(b[key])
      if (b[key] !== undefined && str(b[key]) && !v) return { ok: false, message: `${key} 必須為 Y/N/O/F` }
      fields[key] = v || null
    }
  }

  return { ok: true, fields }
}

/**
 * GET /api/reservations?kind=existing|external&status=pending|scheduled|cancelled|all
 */
router.get('/', ...isEditor, (req, res) => {
  try {
    const db = getDatabase()
    const kind = str(req.query.kind)
    const status = str(req.query.status) || 'pending'
    const where = []
    const params = []
    if (kind) {
      if (!KINDS.includes(kind)) return res.status(400).json({ error: true, message: 'kind 參數錯誤' })
      where.push('kind = ?')
      params.push(kind)
    }
    if (status !== 'all') {
      if (!STATUSES.includes(status)) return res.status(400).json({ error: true, message: 'status 參數錯誤' })
      where.push('status = ?')
      params.push(status)
    }
    const rows = db
      .prepare(
        `SELECT * FROM dialysis_reservations ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         ORDER BY registered_date DESC, created_at DESC`,
      )
      .all(...params)
    const patientMap = loadPatientsById(db, rows.map((r) => r.patient_id))
    res.json(rows.map((r) => toApiShape(r, r.patient_id ? patientMap.get(r.patient_id) || null : null)))
  } catch (error) {
    console.error('取得預約洗腎登記錯誤:', error)
    res.status(500).json({ error: true, message: '取得預約洗腎登記失敗' })
  }
})

/**
 * POST /api/reservations/match
 * 依頻率＋班別＋B/C 肝比對 44 張主床的長期空床。
 * body: { freqDays:number[], shift, hbsag?, antihcv?, excludePatientId? }
 * 規則：
 *  - 總表（base_schedules）同床同班且頻率星期重疊 → 不可用（masterConflicts）
 *  - 未來 60 天排程（schedules）該星期同床同班有總表以外的佔用（調班/臨時加洗/手動）→ 可用但列警示（scheduleConflicts）
 *  - B/C 肝任一陽性只推薦隔離床（HEPATITIS_BED_NUMBERS），否則只推薦一般床；另一組仍回傳供組長自行判斷
 *  - excludePatientId：本院既有病人比對時排除自己目前的床位
 */
router.post('/match', ...isEditor, (req, res) => {
  try {
    const { freqDays, shift, hbsag, antihcv, excludePatientId } = req.body || {}
    const days = normalizeFreqDays(freqDays)
    if (days === null || days.length === 0) {
      return res.status(400).json({ error: true, message: '請先選擇預約頻率' })
    }
    const shiftCode = str(shift)
    const shiftIndex = SHIFTS.indexOf(shiftCode)
    if (shiftIndex < 0) {
      return res.status(400).json({ error: true, message: '請先選擇預約班別' })
    }
    const excludeId = str(excludePatientId)
    const hb = normalizeHepatitisValue(hbsag)
    const hc = normalizeHepatitisValue(antihcv)
    const isolationRequired = hb === 'Y' || hc === 'Y'
    const hepatitisUnknown = !isolationRequired && (!hb || hb === 'O' || hb === 'F' || !hc || hc === 'O' || hc === 'F')

    const db = getDatabase()
    const masterRow = db.prepare(`SELECT schedule FROM base_schedules WHERE id = 'MASTER_SCHEDULE'`).get()
    const master = parseJson(masterRow?.schedule, {})
    const patientNames = new Map(db.prepare('SELECT id, name FROM patients').all().map((p) => [p.id, p.name]))

    const masterConflicts = new Map(MAIN_BED_NUMBERS.map((b) => [b, []]))
    const scheduleConflicts = new Map(MAIN_BED_NUMBERS.map((b) => [b, []]))

    for (const [patientId, rule] of Object.entries(master)) {
      if (!rule || Number(rule.shiftIndex) !== shiftIndex) continue
      if (excludeId && patientId === excludeId) continue
      const bedNum = Number(rule.bedNum)
      if (!masterConflicts.has(bedNum)) continue
      const ruleDays = FREQ_MAP_TO_DAY_INDEX[rule.freq] || []
      const overlap = ruleDays.filter((d) => days.includes(d))
      if (overlap.length === 0) continue
      masterConflicts.get(bedNum).push({
        patientId,
        patientName: rule.patientName || patientNames.get(patientId) || '',
        freq: rule.freq,
        days: overlap.map((d) => DAY_LABELS[d]).join(''),
      })
    }

    const today = getTaipeiTodayString()
    const futureRows = db.prepare('SELECT date, schedule FROM schedules WHERE date >= ? ORDER BY date').all(today)
    let horizonEnd = today
    for (const row of futureRows) {
      horizonEnd = row.date
      const dayIndex = getTaipeiDayIndex(new Date(`${row.date}T00:00:00+08:00`))
      if (!days.includes(dayIndex)) continue
      const schedule = parseJson(row.schedule, {})
      for (const bedNum of MAIN_BED_NUMBERS) {
        const slot = schedule[getScheduleKey(bedNum, shiftCode)]
        if (!slot?.patientId || slot.patientId === excludeId) continue
        // 常規病人已由總表涵蓋；這裡只補總表以外的佔用
        if (masterConflicts.get(bedNum).some((c) => c.patientId === slot.patientId)) continue
        scheduleConflicts.get(bedNum).push({
          date: row.date,
          patientId: slot.patientId,
          patientName: slot.patientName || patientNames.get(slot.patientId) || '',
        })
      }
    }

    const beds = MAIN_BED_NUMBERS.map((bedNum) => {
      const isolation = HEPATITIS_BED_NUMBERS.includes(bedNum)
      const mc = masterConflicts.get(bedNum)
      const sc = scheduleConflicts.get(bedNum)
      const available = mc.length === 0
      return {
        bedNum,
        isolation,
        available,
        recommended: available && isolation === isolationRequired,
        masterConflicts: mc,
        scheduleConflicts: sc,
      }
    })

    res.json({
      shift: shiftCode,
      freqDays: days,
      freq: getFreqFromDayIndices(days),
      freqLabel: days.map((d) => DAY_LABELS[d]).join(''),
      isolationRequired,
      hepatitisUnknown,
      horizonStart: today,
      horizonEnd,
      beds,
    })
  } catch (error) {
    console.error('預約洗腎空床比對錯誤:', error)
    res.status(500).json({ error: true, message: '空床比對失敗' })
  }
})

/**
 * GET /api/reservations/:id
 */
router.get('/:id', ...isEditor, (req, res) => {
  try {
    const item = getById(getDatabase(), req.params.id)
    if (!item) return res.status(404).json({ error: true, message: '登記不存在' })
    res.json(item)
  } catch (error) {
    console.error('取得預約洗腎登記錯誤:', error)
    res.status(500).json({ error: true, message: '取得預約洗腎登記失敗' })
  }
})

/**
 * POST /api/reservations
 * body: { kind, patientId?, name?, registeredDate?, freqDays?, shift?, originClinic?, hbsag?, antihcv?,
 *         contactName?, contactRelation?, contactPhone?, note? }
 */
router.post('/', ...isEditor, (req, res) => {
  try {
    const db = getDatabase()
    const built = buildFields(db, req.body, { partial: false, existing: null })
    if (!built.ok) return res.status(400).json({ error: true, message: built.message })
    const f = built.fields
    const id = uuidv4()
    const userJson = JSON.stringify({ uid: req.user.id, name: req.user.name })
    db.prepare(`
      INSERT INTO dialysis_reservations
        (id, kind, patient_id, name, medical_record_number, registered_date, freq_days, freq, shift,
         origin_clinic, hbsag, antihcv, contact_name, contact_relation, contact_phone,
         status, matched_bed, note, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, f.kind, f.patient_id ?? null, f.name, f.medical_record_number ?? null, f.registered_date,
      f.freq_days, f.freq ?? null, f.shift ?? null,
      f.origin_clinic ?? null, f.hbsag ?? null, f.antihcv ?? null,
      f.contact_name ?? null, f.contact_relation ?? null, f.contact_phone ?? null,
      f.status, f.matched_bed ?? null, f.note ?? null, userJson, userJson,
    )
    res.status(201).json(getById(db, id))
  } catch (error) {
    console.error('建立預約洗腎登記錯誤:', error)
    res.status(500).json({ error: true, message: '建立預約洗腎登記失敗' })
  }
})

/**
 * PUT /api/reservations/:id（守衛式部分更新：未帶欄位不動）
 * 排定床位：{ status:'scheduled', matchedBed:'31' }；取消：{ status:'cancelled' }；復原：{ status:'pending' }
 */
router.put('/:id', ...isEditor, (req, res) => {
  try {
    const db = getDatabase()
    const existing = db.prepare('SELECT * FROM dialysis_reservations WHERE id = ?').get(req.params.id)
    if (!existing) return res.status(404).json({ error: true, message: '登記不存在' })
    const built = buildFields(db, req.body, { partial: true, existing })
    if (!built.ok) return res.status(400).json({ error: true, message: built.message })
    const entries = Object.entries(built.fields)
    if (entries.length === 0) return res.status(400).json({ error: true, message: '未提供任何欄位' })
    const setSql = entries.map(([col]) => `${col} = ?`).join(', ')
    const values = entries.map(([, v]) => (v === undefined ? null : v))
    db.prepare(`
      UPDATE dialysis_reservations
      SET ${setSql}, updated_by = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(...values, JSON.stringify({ uid: req.user.id, name: req.user.name }), req.params.id)
    res.json(getById(db, req.params.id))
  } catch (error) {
    console.error('更新預約洗腎登記錯誤:', error)
    res.status(500).json({ error: true, message: '更新預約洗腎登記失敗' })
  }
})

/**
 * DELETE /api/reservations/:id
 */
router.delete('/:id', ...isEditor, (req, res) => {
  try {
    const result = getDatabase().prepare('DELETE FROM dialysis_reservations WHERE id = ?').run(req.params.id)
    if (result.changes === 0) return res.status(404).json({ error: true, message: '登記不存在' })
    res.json({ success: true })
  } catch (error) {
    console.error('刪除預約洗腎登記錯誤:', error)
    res.status(500).json({ error: true, message: '刪除預約洗腎登記失敗' })
  }
})

export default router
