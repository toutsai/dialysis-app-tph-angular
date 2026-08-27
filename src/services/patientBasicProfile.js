// 病人基本資料單一權威（2026-08-27）
// 病人層級（patients 人口學欄位 + patient_kidit_profile 六欄）是唯一權威；
// KiDit 建檔表單、病人清單「基本資料」頁籤、未來 HIS 串接都是寫入者，統一走 upsertPatientBasicProfile。
// KiDit 事件上的 kidit_profile 保留為申報快照，不由此處回改。
// 設計：db 由呼叫端傳入（route 用 getDatabase()、回填腳本用自己的連線），本模組不開連線。

/** API camelCase → patients snake_case 白名單（可覆寫欄位） */
export const BASIC_FIELD_MAP = {
  idNumber: 'id_number',
  birthDate: 'birth_date',
  gender: 'gender',
  phone: 'phone',
  mobile: 'mobile',
  postalCode: 'postal_code',
  address: 'address',
  registeredCity: 'registered_city',
  isForeign: 'is_foreign',
  bloodType: 'blood_type',
  maritalStatus: 'marital_status',
  education: 'education',
  occupation: 'occupation',
  isIndigenous: 'is_indigenous',
  isWelfare: 'is_welfare',
  kiditPatientCategory: 'kidit_patient_category',
  emergencyContact: 'emergency_contact',
  emergencyPhone: 'emergency_phone',
  contactRelationship: 'contact_relationship',
  // 只補空、永不覆寫：病歷號是識別鍵；初透日顯示權威仍是 patientStatus.isFirstDialysis.date
  medicalRecordNumber: 'medical_record_number',
  firstDialysisDate: 'first_dialysis_date',
}

/** 不論 fillOnlyEmpty 與否，一律只補空的 patients 欄位 */
export const FILL_ONLY_EMPTY_FIELDS = new Set(['medicalRecordNumber', 'firstDialysisDate'])

/** API camelCase → patient_kidit_profile snake_case */
export const KIDIT_PROFILE_FIELD_MAP = {
  dialysisCode: 'dialysis_code',
  kiditStatus: 'kidit_status',
  hospitalStartDate: 'hospital_start_date',
  diagnosisCategory: 'diagnosis_category',
  diagnosisSubcategory: 'diagnosis_subcategory',
  catastrophicCardNo: 'catastrophic_card_no',
}

function parseJsonSafe(str, fallback) {
  try {
    return str ? JSON.parse(str) : fallback
  } catch {
    return fallback
  }
}

/** patient_kidit_profile 列 → camelCase；無列回 null */
export function formatKiditProfile(row) {
  if (!row) return null
  return {
    patientId: row.patient_id,
    dialysisCode: row.dialysis_code,
    kiditStatus: row.kidit_status,
    hospitalStartDate: row.hospital_start_date,
    diagnosisCategory: row.diagnosis_category,
    diagnosisSubcategory: row.diagnosis_subcategory,
    catastrophicCardNo: row.catastrophic_card_no,
    updatedBy: parseJsonSafe(row.updated_by, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** KiDit 性別碼 '1'/'2' → '男'/'女'（其他值原樣） */
export function kiditGenderToBasic(v) {
  if (v === '1' || v === 1) return '男'
  if (v === '2' || v === 2) return '女'
  return v
}

/** '男'/'女' → KiDit 性別碼 '1'/'2'（其他值原樣） */
export function basicGenderToKidit(v) {
  if (v === '男') return '1'
  if (v === '女') return '2'
  return v
}

/**
 * KiDit 事件 kidit_profile → 病人層級 fields（BASIC_FIELD_MAP 的 camelCase key）
 * 缺的 key 回 undefined，讓 upsert 不覆寫；name 刻意忽略（patients.name 是權威）。
 */
export function mapKiditProfileToBasic(profile) {
  const p = profile || {}
  const pick = (k) => (p[k] === undefined ? undefined : p[k])
  return {
    idNumber: pick('idNumber'),
    medicalRecordNumber: pick('medicalRecordNumber'),
    birthDate: pick('birthDate'),
    gender: p.gender === undefined ? undefined : kiditGenderToBasic(p.gender),
    kiditPatientCategory: pick('patientCategory'),
    bloodType: pick('bloodType'),
    maritalStatus: pick('maritalStatus'),
    education: pick('education'),
    occupation: pick('occupation'),
    isIndigenous: pick('isIndigenous'),
    isWelfare: pick('isWelfare'),
    phone: pick('phone'),
    address: pick('address'),
    emergencyContact: pick('contactPerson'),
    contactRelationship: pick('relationship'),
    firstDialysisDate: pick('firstDialysisDate'),
  }
}

/** KiDit 事件 kidit_profile → patient_kidit_profile 六欄（camelCase key；缺的回 undefined） */
export function mapKiditProfileToKidit(profile) {
  const p = profile || {}
  const pick = (k) => (p[k] === undefined ? undefined : p[k])
  return {
    dialysisCode: pick('dialysisCode'),
    kiditStatus: pick('status'),
    hospitalStartDate: pick('hospitalStartDate'),
    diagnosisCategory: pick('diagnosisCategory'),
    diagnosisSubcategory: pick('diagnosisSubcategory'),
    catastrophicCardNo: pick('catastrophicCardNo'),
  }
}

function isEmpty(v) {
  return v === null || v === undefined || String(v).trim() === ''
}

function normalizeValue(v) {
  if (v === null) return null
  if (typeof v === 'boolean') return v ? 'Y' : 'N'
  return String(v)
}

/**
 * 寫入病人基本資料（單一 transaction：UPDATE patients + UPSERT patient_kidit_profile）
 * @param {import('better-sqlite3').Database} db
 * @param {string} patientId
 * @param {object} fields         BASIC_FIELD_MAP 的 camelCase key；undefined 的 key 不動
 * @param {object} kiditProfile   KIDIT_PROFILE_FIELD_MAP 的 camelCase key；undefined 的 key 不動
 * @param {object} opts { source: 'manual'|'kidit'|'kidit_backfill'|'his', user: {id|uid,name}, fillOnlyEmpty }
 *   fillOnlyEmpty=true：patients 全部欄位只補空（回填用；patient_kidit_profile 仍覆寫）
 *   skipEmpty=true：來源的空值視為「沒填」而非「清除」，不寫入（KiDit 回寫用——舊事件 kidit_profile
 *                   常有空字串欄位，重存一次不能把基本資料頁填好的值洗掉；基本資料頁手動清除不設此旗標）
 * @returns {{ patientFieldsWritten: string[], kiditFieldsWritten: string[], found: boolean }}
 */
export function upsertPatientBasicProfile(db, patientId, fields = {}, kiditProfile = {}, opts = {}) {
  const { source = 'manual', user = null, fillOnlyEmpty = false, skipEmpty = false } = opts
  const result = { patientFieldsWritten: [], kiditFieldsWritten: [], found: false }

  const existing = db.prepare('SELECT * FROM patients WHERE id = ?').get(patientId)
  if (!existing) return result
  result.found = true

  const userJson = JSON.stringify({ uid: user?.id || user?.uid || '', name: user?.name || '' })

  // ---- patients ----
  const sets = []
  const values = []
  for (const [camel, snake] of Object.entries(BASIC_FIELD_MAP)) {
    if (!(camel in (fields || {})) || fields[camel] === undefined) continue
    const onlyIfEmpty = fillOnlyEmpty || FILL_ONLY_EMPTY_FIELDS.has(camel)
    const next = normalizeValue(fields[camel])
    if (skipEmpty && isEmpty(next)) continue
    if (onlyIfEmpty && (!isEmpty(existing[snake]) || isEmpty(next))) continue
    if ((existing[snake] ?? null) === next) continue
    sets.push(`${snake} = ?`)
    values.push(next)
    result.patientFieldsWritten.push(camel)
  }

  // ---- patient_kidit_profile（覆寫，但值相同者不算寫入、不動 updated_at） ----
  const existingKidit = db.prepare('SELECT * FROM patient_kidit_profile WHERE patient_id = ?').get(patientId) || null
  const kSets = []
  const kCols = []
  const kValues = []
  for (const [camel, snake] of Object.entries(KIDIT_PROFILE_FIELD_MAP)) {
    if (!(camel in (kiditProfile || {})) || kiditProfile[camel] === undefined) continue
    const next = normalizeValue(kiditProfile[camel])
    if (skipEmpty && isEmpty(next)) continue
    if (existingKidit && (existingKidit[snake] ?? null) === next) continue
    kCols.push(snake)
    kValues.push(next)
    kSets.push(`${snake} = excluded.${snake}`)
    result.kiditFieldsWritten.push(camel)
  }

  const tx = db.transaction(() => {
    if (sets.length > 0) {
      sets.push('basic_source = ?')
      values.push(source)
      sets.push('last_modified_by = ?')
      values.push(userJson)
      sets.push("updated_at = datetime('now', 'localtime')")
      db.prepare(`UPDATE patients SET ${sets.join(', ')} WHERE id = ?`).run(...values, patientId)
    }
    if (kCols.length > 0) {
      const placeholders = kCols.map(() => '?').join(', ')
      db.prepare(`
        INSERT INTO patient_kidit_profile (patient_id, ${kCols.join(', ')}, updated_by, updated_at)
        VALUES (?, ${placeholders}, ?, datetime('now', 'localtime'))
        ON CONFLICT(patient_id) DO UPDATE SET
          ${kSets.join(', ')},
          updated_by = excluded.updated_by,
          updated_at = excluded.updated_at
      `).run(patientId, ...kValues, userJson)
    }
  })
  tx()

  return result
}
