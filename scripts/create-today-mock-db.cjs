const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const bcrypt = require('bcryptjs')
const Database = require('better-sqlite3')

const ROOT_DIR = path.resolve(__dirname, '..')
const DATA_DIR = path.join(ROOT_DIR, 'data')
const SOURCE_DB = path.resolve(process.env.SOURCE_DB_PATH || path.join(DATA_DIR, 'dialysis.db'))
const TARGET_DB = path.resolve(process.env.MOCK_DB_PATH || path.join(DATA_DIR, 'dialysis_mock_today.db'))
const MOCK_TODAY = process.env.MOCK_TODAY || '2026-05-09'
const MOCK_DAYS = Number.parseInt(process.env.MOCK_DAYS || '15', 10)
const USER_TEST_PASSWORD = process.env.MOCK_USER_PASSWORD || 'test1234'
const BED_PIN = process.env.MOCK_BED_PIN || '1234'

const SHIFT_RE = /-(early|noon|late)$/
const MOCK_AUTHOR = JSON.stringify({ uid: 'mock-today', name: 'Local mock DB generator' })

function assertSafeTarget() {
  const resolvedDataDir = `${path.resolve(DATA_DIR)}${path.sep}`
  if (!TARGET_DB.startsWith(resolvedDataDir)) {
    throw new Error(`Refusing to write mock DB outside data directory: ${TARGET_DB}`)
  }
  if (path.basename(TARGET_DB) !== 'dialysis_mock_today.db') {
    throw new Error(`Refusing to overwrite unexpected file: ${TARGET_DB}`)
  }
}

function removeTargetFiles() {
  assertSafeTarget()
  for (const file of [TARGET_DB, `${TARGET_DB}-wal`, `${TARGET_DB}-shm`]) {
    if (fs.existsSync(file)) {
      fs.rmSync(file, { force: true })
    }
  }
}

async function copySourceDatabase() {
  if (!fs.existsSync(SOURCE_DB)) {
    throw new Error(`Source DB not found: ${SOURCE_DB}`)
  }

  fs.mkdirSync(DATA_DIR, { recursive: true })
  removeTargetFiles()

  const sourceDb = new Database(SOURCE_DB, { readonly: true, fileMustExist: true })
  try {
    if (typeof sourceDb.backup === 'function') {
      await sourceDb.backup(TARGET_DB)
    } else {
      fs.copyFileSync(SOURCE_DB, TARGET_DB)
    }
  } finally {
    sourceDb.close()
  }
}

function parseJson(value, fallback) {
  if (!value) return fallback
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function stringify(value) {
  return JSON.stringify(value ?? {})
}

function addDays(dateString, days) {
  const [year, month, day] = dateString.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

function hashInt(seed) {
  return crypto.createHash('sha256').update(String(seed)).digest().readUInt32BE(0)
}

function shortHash(seed) {
  return crypto.createHash('sha1').update(String(seed)).digest('hex').slice(0, 16)
}

function pick(seed, values) {
  return values[hashInt(seed) % values.length]
}

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== ''
}

function hasAnyValue(source, keys) {
  return keys.some((key) => hasValue(source?.[key]))
}

function ensureOne(source, keys, value) {
  if (!hasAnyValue(source, keys)) {
    source[keys[0]] = value
  }
}

function getTableNames(db) {
  return new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name),
  )
}

function ensureMockTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bed_dashboard_devices (
      id TEXT PRIMARY KEY,
      bed_key TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      pin_hash TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      last_login_at TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_bed_dashboard_devices_bed_key ON bed_dashboard_devices(bed_key);
    CREATE INDEX IF NOT EXISTS idx_bed_dashboard_devices_active ON bed_dashboard_devices(is_active);
  `)
}

function countNursingNames(assignment) {
  const names = assignment?.names || {}
  return Object.values(names).filter((name) => hasValue(name)).length
}

function findTemplateDay(db) {
  const rows = db
    .prepare(
      `
      SELECT
        na.date,
        na.teams,
        COALESCE(s.schedule, a.schedule) AS schedule
      FROM nurse_assignments na
      LEFT JOIN schedules s ON s.date = na.date
      LEFT JOIN archived_schedules a ON a.date = na.date
      ORDER BY na.date DESC
    `,
    )
    .all()

  for (const row of rows) {
    const assignment = parseJson(row.teams, {})
    const schedule = parseJson(row.schedule, {})
    if (countNursingNames(assignment) > 0 && Object.keys(schedule).length > 0) {
      return { date: row.date, assignment, schedule }
    }
  }

  throw new Error('No template date found with nursing names and schedule data.')
}

function loadPatients(db, patientIds) {
  if (patientIds.length === 0) return new Map()
  const placeholders = patientIds.map(() => '?').join(',')
  const rows = db
    .prepare(`SELECT * FROM patients WHERE id IN (${placeholders})`)
    .all(...patientIds)
  return new Map(rows.map((row) => [row.id, row]))
}

function collectScheduleInfo(schedule) {
  const patientIds = new Set()
  const bedKeys = new Set()
  const slots = []

  for (const [slotKey, slot] of Object.entries(schedule)) {
    if (!slot || typeof slot !== 'object') continue
    const match = slotKey.match(SHIFT_RE)
    if (!match) continue

    const patientId = slot.patientId || slot.patient_id
    const bedKey = slotKey.replace(SHIFT_RE, '')
    if (patientId) patientIds.add(patientId)
    bedKeys.add(bedKey)
    slots.push({ slotKey, bedKey, shift: match[1], patientId, slot })
  }

  return { patientIds: [...patientIds], bedKeys: [...bedKeys], slots }
}

function normalizeSchedulePatients(schedule, patientsById) {
  const cloned = JSON.parse(JSON.stringify(schedule))
  for (const slot of Object.values(cloned)) {
    if (!slot || typeof slot !== 'object' || !slot.patientId) continue
    const patient = patientsById.get(slot.patientId)
    if (patient && !hasValue(slot.patientName)) {
      slot.patientName = patient.name
    }
  }
  return cloned
}

function copyScheduleAndAssignments(db, template, scheduleJson, assignmentJson) {
  const upsertSchedule = db.prepare(`
    INSERT INTO schedules (id, date, schedule, sync_method, last_modified_by, created_at, updated_at)
    VALUES (@date, @date, @schedule, 'mock_today', @lastModifiedBy, datetime('now', 'localtime'), datetime('now', 'localtime'))
    ON CONFLICT(date) DO UPDATE SET
      schedule = excluded.schedule,
      sync_method = 'mock_today',
      last_modified_by = excluded.last_modified_by,
      updated_at = datetime('now', 'localtime')
  `)

  const upsertAssignment = db.prepare(`
    INSERT INTO nurse_assignments (id, date, teams, created_at, updated_at)
    VALUES (@date, @date, @teams, datetime('now', 'localtime'), datetime('now', 'localtime'))
    ON CONFLICT(date) DO UPDATE SET
      teams = excluded.teams,
      updated_at = datetime('now', 'localtime')
  `)

  const generatedDates = []
  for (let offset = 0; offset < MOCK_DAYS; offset += 1) {
    const date = addDays(MOCK_TODAY, offset)
    generatedDates.push(date)
    upsertSchedule.run({
      date,
      schedule: scheduleJson,
      lastModifiedBy: MOCK_AUTHOR,
    })
    upsertAssignment.run({
      date,
      teams: assignmentJson,
    })
  }

  return generatedDates
}

function getLatestOrdersForPatient(db, patient) {
  const history = db
    .prepare(
      `
      SELECT orders
      FROM dialysis_orders_history
      WHERE patient_id = ?
      ORDER BY
        COALESCE(json_extract(orders, '$.effectiveDate'), '') DESC,
        created_at DESC
      LIMIT 1
    `,
    )
    .get(patient.id)

  return {
    ...parseJson(patient.dialysis_orders, {}),
    ...parseJson(history?.orders, {}),
  }
}

function buildMockOrders(patient) {
  const orders = getLatestOrdersForPatient.currentDb
    ? getLatestOrdersForPatient.currentDb(patient)
    : parseJson(patient.dialysis_orders, {})

  const seed = patient.id || patient.medical_record_number || patient.name
  const dryWeight = Number((45 + (hashInt(`${seed}:dryWeight`) % 480) / 10).toFixed(1))
  const targetUf = Number((1.5 + (hashInt(`${seed}:uf`) % 26) / 10).toFixed(1))
  const heparinInitial = 300 + (hashInt(`${seed}:heparinI`) % 4) * 200
  const heparinMaintenance = 300 + (hashInt(`${seed}:heparinM`) % 4) * 100

  orders.effectiveDate = MOCK_TODAY
  ensureOne(orders, ['mode'], pick(`${seed}:mode`, ['HD', 'HDF']))
  ensureOne(orders, ['ak', 'dialyzer', 'artificialKidney'], pick(`${seed}:ak`, ['FX80', 'FX100', '15H', '17H']))
  ensureOne(orders, ['dialysateCa', 'dialysate', 'dialysateA'], pick(`${seed}:ca`, ['2.5', '3.0']))
  ensureOne(orders, ['bicarbonate', 'dialysateB', 'bPowder'], pick(`${seed}:bicarb`, ['B powder', 'B solution']))
  ensureOne(orders, ['heparinLM', 'heparin'], `Heparin ${heparinInitial}/${heparinMaintenance}`)
  ensureOne(orders, ['vascAccess', 'vascularAccess'], patient.vasc_access || pick(`${seed}:access`, ['Left AVF', 'Right AVF', 'PermCath']))
  ensureOne(orders, ['bloodFlow', 'blood_flow'], pick(`${seed}:flow`, ['250', '280', '300']))
  ensureOne(orders, ['dialysisHours', 'hours', 'duration'], pick(`${seed}:hours`, ['3.5', '4']))
  ensureOne(orders, ['dryWeight', 'dry_weight'], dryWeight)
  ensureOne(orders, ['dehydration', 'uf', 'targetUf'], targetUf)

  orders.mockTodayGenerated = true
  return orders
}

function ensureDialysisOrders(db, patientIds) {
  const patientsById = loadPatients(db, patientIds)
  const upsertHistory = db.prepare(`
    INSERT INTO dialysis_orders_history (id, patient_id, patient_name, operation_type, orders, created_at, updated_at)
    VALUES (@id, @patientId, @patientName, 'MOCK_TODAY', @orders, datetime('now', 'localtime'), datetime('now', 'localtime'))
    ON CONFLICT(id) DO UPDATE SET
      patient_name = excluded.patient_name,
      operation_type = excluded.operation_type,
      orders = excluded.orders,
      updated_at = datetime('now', 'localtime')
  `)
  const updatePatient = db.prepare(`
    UPDATE patients
    SET dialysis_orders = ?,
        vasc_access = COALESCE(NULLIF(vasc_access, ''), ?),
        updated_at = datetime('now', 'localtime')
    WHERE id = ?
  `)

  getLatestOrdersForPatient.currentDb = (patient) => getLatestOrdersForPatient(db, patient)

  let count = 0
  for (const patient of patientsById.values()) {
    const orders = buildMockOrders(patient)
    const ordersJson = stringify(orders)
    const historyId = `mock-order-${shortHash(`${patient.id}:${MOCK_TODAY}`)}`
    upsertHistory.run({
      id: historyId,
      patientId: patient.id,
      patientName: patient.name,
      orders: ordersJson,
    })
    updatePatient.run(ordersJson, orders.vascAccess || orders.vascularAccess || '', patient.id)
    count += 1
  }

  getLatestOrdersForPatient.currentDb = null
  return { count, patientsById }
}

function ensureInjectionOrdersForMonth(db, patientIds) {
  if (patientIds.length === 0) return { existing: 0, copied: 0, sourceMonth: null }

  const targetMonth = MOCK_TODAY.slice(0, 7)
  const placeholders = patientIds.map(() => '?').join(',')
  const existing = db
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM injection_orders
      WHERE upload_month = ?
        AND order_type = 'injection'
        AND patient_id IN (${placeholders})
    `,
    )
    .get(targetMonth, ...patientIds).count

  if (existing > 0) return { existing, copied: 0, sourceMonth: targetMonth }

  const sourceMonth = db
    .prepare(
      `
      SELECT upload_month
      FROM injection_orders
      WHERE order_type = 'injection'
        AND upload_month IS NOT NULL
        AND upload_month != ''
      GROUP BY upload_month
      ORDER BY upload_month DESC
      LIMIT 1
    `,
    )
    .get()?.upload_month

  if (!sourceMonth) return { existing: 0, copied: 0, sourceMonth: null }

  const rows = db
    .prepare(
      `
      SELECT *
      FROM injection_orders
      WHERE upload_month = ?
        AND order_type = 'injection'
        AND patient_id IN (${placeholders})
    `,
    )
    .all(sourceMonth, ...patientIds)

  const insert = db.prepare(`
    INSERT INTO injection_orders (
      id, patient_id, patient_name, medical_record_number, order_code, order_name,
      change_date, upload_month, dose, frequency, note, action, order_type, source_file,
      created_at, updated_at
    )
    VALUES (
      @id, @patient_id, @patient_name, @medical_record_number, @order_code, @order_name,
      @change_date, @upload_month, @dose, @frequency, @note, @action, @order_type, @source_file,
      datetime('now', 'localtime'), datetime('now', 'localtime')
    )
    ON CONFLICT(id) DO UPDATE SET
      patient_name = excluded.patient_name,
      medical_record_number = excluded.medical_record_number,
      order_code = excluded.order_code,
      order_name = excluded.order_name,
      change_date = excluded.change_date,
      upload_month = excluded.upload_month,
      dose = excluded.dose,
      frequency = excluded.frequency,
      note = excluded.note,
      action = excluded.action,
      order_type = excluded.order_type,
      source_file = excluded.source_file,
      updated_at = datetime('now', 'localtime')
  `)

  for (const row of rows) {
    insert.run({
      id: `mock-inj-${shortHash(`${row.id}:${targetMonth}`)}`,
      patient_id: row.patient_id,
      patient_name: row.patient_name,
      medical_record_number: row.medical_record_number,
      order_code: row.order_code,
      order_name: row.order_name,
      change_date: MOCK_TODAY,
      upload_month: targetMonth,
      dose: row.dose,
      frequency: row.frequency,
      note: row.note,
      action: row.action,
      order_type: row.order_type,
      source_file: 'mock_today',
    })
  }

  return { existing: 0, copied: rows.length, sourceMonth }
}

function displayNameForBed(bedKey) {
  const bedMatch = bedKey.match(/^bed-(\d+)$/)
  if (bedMatch) return `Bed ${bedMatch[1]}`
  return bedKey
}

function ensureDashboardDevices(db, bedKeys) {
  const pinHash = bcrypt.hashSync(BED_PIN, 10)
  const upsert = db.prepare(`
    INSERT INTO bed_dashboard_devices (id, bed_key, display_name, pin_hash, is_active, created_at, updated_at)
    VALUES (@id, @bedKey, @displayName, @pinHash, 1, datetime('now', 'localtime'), datetime('now', 'localtime'))
    ON CONFLICT(bed_key) DO UPDATE SET
      display_name = excluded.display_name,
      pin_hash = excluded.pin_hash,
      is_active = 1,
      updated_at = datetime('now', 'localtime')
  `)

  for (const bedKey of bedKeys) {
    upsert.run({
      id: `mock-device-${shortHash(bedKey)}`,
      bedKey,
      displayName: displayNameForBed(bedKey),
      pinHash,
    })
  }

  return bedKeys.length
}

function resetActiveUserPasswords(db) {
  const passwordHash = bcrypt.hashSync(USER_TEST_PASSWORD, 10)
  const result = db
    .prepare(
      `
      UPDATE users
      SET password_hash = ?,
          failed_login_count = 0,
          locked_until = NULL,
          updated_at = datetime('now', 'localtime')
      WHERE is_active = 1
    `,
    )
    .run(passwordHash)
  return result.changes
}

async function main() {
  if (!Number.isInteger(MOCK_DAYS) || MOCK_DAYS <= 0) {
    throw new Error(`MOCK_DAYS must be a positive integer, got: ${process.env.MOCK_DAYS}`)
  }

  await copySourceDatabase()

  const db = new Database(TARGET_DB)
  try {
    db.pragma('journal_mode = WAL')
    db.exec('REINDEX')
    db.exec('VACUUM')
    ensureMockTables(db)

    const tableNames = getTableNames(db)
    for (const required of ['users', 'patients', 'schedules', 'nurse_assignments', 'dialysis_orders_history', 'injection_orders']) {
      if (!tableNames.has(required)) {
        throw new Error(`Required table missing from mock DB: ${required}`)
      }
    }

    const summary = db.transaction(() => {
      const template = findTemplateDay(db)
      const initialInfo = collectScheduleInfo(template.schedule)
      const initialPatients = loadPatients(db, initialInfo.patientIds)
      const normalizedSchedule = normalizeSchedulePatients(template.schedule, initialPatients)
      const normalizedInfo = collectScheduleInfo(normalizedSchedule)
      const scheduleJson = stringify(normalizedSchedule)
      const assignmentJson = stringify(template.assignment)
      const generatedDates = copyScheduleAndAssignments(db, template, scheduleJson, assignmentJson)
      const orderResult = ensureDialysisOrders(db, normalizedInfo.patientIds)
      const injectionResult = ensureInjectionOrdersForMonth(db, normalizedInfo.patientIds)
      const deviceCount = ensureDashboardDevices(db, normalizedInfo.bedKeys.sort())
      const userCount = resetActiveUserPasswords(db)

      return {
        templateDate: template.date,
        nursingNameCount: countNursingNames(template.assignment),
        generatedDates,
        patientCount: orderResult.count,
        bedDeviceCount: deviceCount,
        userCount,
        injectionResult,
      }
    })()

    console.log('Mock DB created.')
    console.log(`Source: ${SOURCE_DB}`)
    console.log(`Target: ${TARGET_DB}`)
    console.log(`Template date: ${summary.templateDate} (${summary.nursingNameCount} nursing names)`)
    console.log(`Generated dates: ${summary.generatedDates[0]} to ${summary.generatedDates[summary.generatedDates.length - 1]}`)
    console.log(`Scheduled patients prepared: ${summary.patientCount}`)
    console.log(`Bed dashboard devices: ${summary.bedDeviceCount} (PIN ${BED_PIN})`)
    console.log(`Active user passwords reset: ${summary.userCount} (password ${USER_TEST_PASSWORD})`)
    if (summary.injectionResult.copied > 0) {
      console.log(`Injection orders copied: ${summary.injectionResult.copied} (${summary.injectionResult.sourceMonth} -> ${MOCK_TODAY.slice(0, 7)})`)
    } else {
      console.log(`Injection orders already available for ${MOCK_TODAY.slice(0, 7)}: ${summary.injectionResult.existing}`)
    }
    console.log('Test login: username 20238 / password test1234')
    console.log(`Test dashboard: http://localhost:5173/bed-dashboard/bed-1?date=${MOCK_TODAY}&shift=early`)
  } finally {
    db.close()
  }
}

main().catch((error) => {
  console.error('Failed to create mock DB:', error)
  process.exitCode = 1
})
