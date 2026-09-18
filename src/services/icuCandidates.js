// ICU 待透析評估名單（已會診、可能需要 HD／SLED／CVVHDF 的 ICU 病人，2026-09-19）
//
// 雙入口、單一名單：
// ・ICU 透析頁由醫師直接新增（最明確：醫師覺得有需要才會有）
// ・AKI 關懷名單勾「高機率透析」帶入（只帶基本資料，預計模式未定＝待補評估）
// 「高機率透析」不另存欄位，就是「此病歷號有進行中的待評估紀錄」→ 兩邊不會各說各話。
// 病歷號比對一律去前導 0（AKI 檔 10 碼補零、透析病人 6~7 碼）。
import { v4 as uuidv4 } from 'uuid'

export const CANDIDATE_UNITS = ['ICUA', 'ICUB', 'ICUD']
export const CANDIDATE_MODES = ['HD', 'SLED', 'CVVHDF']
export const CANDIDATE_ACTIVE_STATUSES = ['觀察中', '已排定']
export const CANDIDATE_CLOSED_STATUSES = ['已開始透析', '不需透析', '轉出／死亡']
export const CANDIDATE_URGENCIES = ['今日', '24 小時內', '觀察中']
export const CANDIDATE_ACCESS = ['無', '待放', '已放']
export const CANDIDATE_INDICATIONS = ['高血鉀', '代謝性酸中毒', '體液過多／肺水腫', '尿毒症狀', '中毒', '寡尿／無尿']

// 血行動力學／器官支持：沿用 ICU 透析卡片的 CRRT 風險項目與配分（非驗證分數，只作提示）
export const CANDIDATE_RISK_ITEMS = [
  { key: 'vasopressor', label: '使用升壓劑', pts: 2 },
  { key: 'vasoHigh', label: 'NE ≥0.3／24h 加量', pts: 1, needs: 'vasopressor' },
  { key: 'mapLow', label: 'MAP <65', pts: 1 },
  { key: 'lactateHigh', label: '乳酸 >2／CRT ≥3s', pts: 1 },
  { key: 'ventilator', label: '呼吸器', pts: 1 },
  { key: 'ecmo', label: 'ECMO', pts: 1 },
  { key: 'brainInjury', label: '腦損傷／肝衰竭', pts: 0, direct: true },
]
const RISK_KEYS = CANDIDATE_RISK_ITEMS.map((i) => i.key)

export const mrnKey = (v) => String(v == null ? '' : v).trim().replace(/^0+/, '')

function httpError(status, message, extra = {}) {
  return Object.assign(new Error(message), { status, ...extra })
}

function parseArray(s) {
  try {
    const v = JSON.parse(s || '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

/** 依血行動力學勾選給模式提示：≥4 分或腦損傷→CVVHDF、2–3→SLED、0–1→HD */
export function suggestMode(riskFlags) {
  const flags = new Set(riskFlags)
  let score = 0
  for (const item of CANDIDATE_RISK_ITEMS) {
    if (!flags.has(item.key)) continue
    if (item.needs && !flags.has(item.needs)) continue
    score += item.pts
  }
  const direct = flags.has('brainInjury')
  const mode = direct || score >= 4 ? 'CVVHDF' : score >= 2 ? 'SLED' : 'HD'
  return { suggestedMode: mode, riskScore: score, riskDirect: direct }
}

function toCandidate(row) {
  const indications = parseArray(row.indications)
  const riskFlags = parseArray(row.risk_flags)
  // 待補評估：從 AKI 帶入後，醫師還沒填預計模式／適應症／血行動力學
  const needsAssessment = !row.planned_mode && indications.length === 0 && riskFlags.length === 0
  return {
    id: row.id,
    mrn: row.mrn,
    name: row.name || '',
    unit: row.unit || '',
    bedNo: row.bed_no || '',
    physician: row.physician || '',
    consultPhysician: row.consult_physician || '',
    consultDate: row.consult_date || '',
    plannedMode: row.planned_mode || '',
    indications,
    riskFlags,
    urgency: row.urgency || '',
    vascularAccess: row.vascular_access || '',
    note: row.note || '',
    status: row.status,
    active: CANDIDATE_ACTIVE_STATUSES.includes(row.status),
    source: row.source,
    needsAssessment,
    ...suggestMode(riskFlags),
    createdBy: row.created_by || '',
    createdAt: row.created_at,
    updatedBy: row.updated_by || '',
    updatedAt: row.updated_at,
    closedAt: row.closed_at || null,
  }
}

export function listActiveCandidates(db) {
  const marks = CANDIDATE_ACTIVE_STATUSES.map(() => '?').join(',')
  return db
    .prepare(`SELECT * FROM icu_dialysis_candidates WHERE status IN (${marks}) ORDER BY unit, bed_no, created_at`)
    .all(...CANDIDATE_ACTIVE_STATUSES)
    .map(toCandidate)
}

export function getCandidate(db, id) {
  const row = db.prepare('SELECT * FROM icu_dialysis_candidates WHERE id = ?').get(id)
  return row ? toCandidate(row) : null
}

export function getActiveCandidateByMrn(db, mrn) {
  const marks = CANDIDATE_ACTIVE_STATUSES.map(() => '?').join(',')
  const row = db
    .prepare(`SELECT * FROM icu_dialysis_candidates WHERE mrn_key = ? AND status IN (${marks}) ORDER BY created_at DESC LIMIT 1`)
    .get(mrnKey(mrn), ...CANDIDATE_ACTIVE_STATUSES)
  return row ? toCandidate(row) : null
}

/** 病歷號(去前導0) → 進行中待評估紀錄；AKI 關懷名單一次對照用，避免逐筆查 */
export function loadActiveCandidateMap(db) {
  return new Map(listActiveCandidates(db).map((c) => [mrnKey(c.mrn), c]))
}

// 把 body（camelCase）驗證並轉成要寫入的欄位；只處理有帶的 key（部分更新）
function normalizeFields(body, { requireIcuUnit }) {
  const out = {}
  const text = (v, max = 200) => String(v ?? '').trim().slice(0, max)
  if (body.name !== undefined) out.name = text(body.name, 60)
  if (body.unit !== undefined) {
    const unit = text(body.unit, 10).toUpperCase()
    if (unit && !CANDIDATE_UNITS.includes(unit)) throw httpError(400, '加護單位只能是 ICUA／ICUB／ICUD')
    if (!unit && requireIcuUnit) throw httpError(400, '請選擇加護單位（本名單只收 ICU 病人）')
    out.unit = unit
  }
  if (body.bedNo !== undefined) out.bed_no = text(body.bedNo, 20)
  if (body.physician !== undefined) out.physician = text(body.physician, 60)
  if (body.consultPhysician !== undefined) out.consult_physician = text(body.consultPhysician, 60)
  if (body.consultDate !== undefined) {
    const d = text(body.consultDate, 10)
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw httpError(400, '會診日期格式不正確')
    out.consult_date = d
  }
  if (body.plannedMode !== undefined) {
    const mode = text(body.plannedMode, 10)
    if (mode && !CANDIDATE_MODES.includes(mode)) throw httpError(400, '預計模式只能是 HD／SLED／CVVHDF 或未定')
    out.planned_mode = mode
  }
  if (body.indications !== undefined) {
    if (!Array.isArray(body.indications) || body.indications.some((i) => !CANDIDATE_INDICATIONS.includes(i))) {
      throw httpError(400, '適應症選項不正確')
    }
    out.indications = JSON.stringify([...new Set(body.indications)])
  }
  if (body.riskFlags !== undefined) {
    if (!Array.isArray(body.riskFlags) || body.riskFlags.some((k) => !RISK_KEYS.includes(k))) {
      throw httpError(400, '血行動力學選項不正確')
    }
    out.risk_flags = JSON.stringify([...new Set(body.riskFlags)])
  }
  if (body.urgency !== undefined) {
    const u = text(body.urgency, 20)
    if (u && !CANDIDATE_URGENCIES.includes(u)) throw httpError(400, '緊急程度選項不正確')
    out.urgency = u
  }
  if (body.vascularAccess !== undefined) {
    const a = text(body.vascularAccess, 10)
    if (a && !CANDIDATE_ACCESS.includes(a)) throw httpError(400, '血管通路選項不正確')
    out.vascular_access = a
  }
  if (body.note !== undefined) out.note = text(body.note, 1000)
  if (body.status !== undefined) {
    const s = text(body.status, 20)
    if (![...CANDIDATE_ACTIVE_STATUSES, ...CANDIDATE_CLOSED_STATUSES].includes(s)) throw httpError(400, '狀態選項不正確')
    out.status = s
  }
  return out
}

// 會診醫師兩邊同步：AKI 關懷紀錄的病歷號是 10 碼補零，也可能有人工輸入的原樣
function syncConsultPhysicianToCare(db, mrn, consultPhysician) {
  const key = mrnKey(mrn)
  if (!key) return
  db.prepare(`UPDATE aki_care_records SET consult_physician = ? WHERE mrn IN (?, ?, ?)`)
    .run(consultPhysician, String(mrn).trim(), key, key.padStart(10, '0'))
}

/**
 * @param {{requireIcuUnit?:boolean, source?:'icu'|'aki'}} opts ICU 透析頁新增＝必選單位；AKI 帶入＝快照不在 ICU 時單位留空（床位待確認）
 */
export function createCandidate(db, body, userName, { requireIcuUnit = true, source = 'icu' } = {}) {
  const mrn = String(body.mrn ?? '').trim()
  if (!mrnKey(mrn)) throw httpError(400, '請填病歷號')
  if (!String(body.name ?? '').trim()) throw httpError(400, '請填姓名')
  const existing = getActiveCandidateByMrn(db, mrn)
  if (existing) throw httpError(409, '這位病人已在待透析評估名單上', { existing })

  const fields = normalizeFields({ unit: '', ...body }, { requireIcuUnit })
  const status = fields.status && CANDIDATE_ACTIVE_STATUSES.includes(fields.status) ? fields.status : '觀察中'
  const id = uuidv4()
  db.transaction(() => {
    db.prepare(
      `INSERT INTO icu_dialysis_candidates
         (id, mrn, mrn_key, name, unit, bed_no, physician, consult_physician, consult_date, planned_mode,
          indications, risk_flags, urgency, vascular_access, note, status, source, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id, mrn, mrnKey(mrn), fields.name, fields.unit || '', fields.bed_no || '', fields.physician || '',
      fields.consult_physician || '', fields.consult_date || '', fields.planned_mode || '',
      fields.indications || '[]', fields.risk_flags || '[]', fields.urgency || '', fields.vascular_access || '',
      fields.note || '', status, source, userName, userName,
    )
    if (fields.consult_physician) syncConsultPhysicianToCare(db, mrn, fields.consult_physician)
  })()
  return getCandidate(db, id)
}

export function updateCandidate(db, id, body, userName) {
  const current = getCandidate(db, id)
  if (!current) throw httpError(404, '找不到這筆待評估紀錄')
  // 已有床位的紀錄不能把單位清空；「床位待確認」的紀錄補單位時才要求
  const fields = normalizeFields(body, { requireIcuUnit: body.unit !== undefined && !!current.unit })
  if (Object.keys(fields).length === 0) throw httpError(400, '沒有要更新的欄位')

  const reopening = fields.status && CANDIDATE_ACTIVE_STATUSES.includes(fields.status) && !current.active
  if (reopening) {
    const other = getActiveCandidateByMrn(db, current.mrn)
    if (other) throw httpError(409, '這位病人已有另一筆進行中的待評估紀錄', { existing: other })
  }

  const sets = Object.keys(fields).map((col) => `${col} = ?`)
  const vals = Object.values(fields)
  if (fields.status) {
    sets.push(CANDIDATE_ACTIVE_STATUSES.includes(fields.status) ? 'closed_at = NULL' : "closed_at = datetime('now','localtime')")
  }
  sets.push('updated_by = ?', "updated_at = datetime('now','localtime')")
  db.transaction(() => {
    db.prepare(`UPDATE icu_dialysis_candidates SET ${sets.join(', ')} WHERE id = ?`).run(...vals, userName, id)
    if (fields.consult_physician !== undefined) syncConsultPhysicianToCare(db, current.mrn, fields.consult_physician)
  })()
  return getCandidate(db, id)
}

export function deleteCandidate(db, id) {
  const current = getCandidate(db, id)
  if (!current) throw httpError(404, '找不到這筆待評估紀錄')
  db.prepare('DELETE FROM icu_dialysis_candidates WHERE id = ?').run(id)
  return current
}

/** AKI 關懷改了會診醫師 → 帶到進行中的待評估紀錄 */
export function syncConsultPhysicianFromCare(db, mrn, consultPhysician, userName) {
  const active = getActiveCandidateByMrn(db, mrn)
  if (!active || active.consultPhysician === consultPhysician) return
  db.prepare(
    `UPDATE icu_dialysis_candidates SET consult_physician = ?, updated_by = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
  ).run(consultPhysician, userName, active.id)
}
