// 每日應打針劑 — DB 層。
// 解析規則的純函式在 injectionRuleParser.js（此檔 re-export，舊 import 路徑不變）；
// 審核清單/月總覽/個人歷史/上傳 diff 在 injectionRulesService.js。
//
// 解讀層：injection_order_rules 是每筆針劑處方的正規化規則快照，由 injection_orders + 覆寫重建；
// 每日應打清單、疑慮清單、月總覽都讀它，不再各自解析文字。ensureInjectionRulesFresh() 以戳記
//（解析器版本 + orders/overrides 的筆數與最新時間）判斷是否需重建，任何讀取前先呼叫即可自癒。
import { v4 as uuidv4 } from 'uuid'
import {
  INJECTION_MEDS,
  DAILY_INJECTION_EXCLUDED_CODES,
  INJECTION_PARSER_VERSION,
  buildInjectionRule,
  isRuleScheduledOn,
  ruleTextIsDecidable,
  hasMeaningfulDose,
  overrideKeyOf,
} from './injectionRuleParser.js'

export * from './injectionRuleParser.js'

// ---------------------------------------------------------------------------
// 覆寫規則（疑慮清單確認）：以處方的自然鍵對應，重新上傳整表覆蓋後仍能對回同一筆。
// ---------------------------------------------------------------------------
function mapOverrideRow(r) {
  return {
    id: r.id,
    patientId: r.patient_id,
    orderCode: r.order_code,
    startDate: r.start_date,
    dose: r.dose,
    frequency: r.frequency,
    rule: r.rule,
    confirmedById: r.confirmed_by_id,
    confirmedByName: r.confirmed_by_name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function loadOverrideMap(db) {
  const rows = db.prepare(`SELECT * FROM injection_rule_overrides`).all()
  return new Map(rows.map((r) => [overrideKeyOf(r), r]))
}

export function listInjectionRuleOverrides(db) {
  return db
    .prepare(`SELECT * FROM injection_rule_overrides ORDER BY updated_at DESC`)
    .all()
    .map(mapOverrideRow)
}

export function upsertInjectionRuleOverride(db, payload, user) {
  const patientId = String(payload.patientId || '').trim()
  const orderCode = String(payload.orderCode || '').trim()
  const startDate = String(payload.startDate || '').trim()
  const dose = String(payload.dose ?? '').trim()
  const frequency = String(payload.frequency ?? '').trim()
  const rule = String(payload.rule || '').trim()
  if (!patientId || !orderCode || !startDate) throw new Error('缺少 patientId / orderCode / startDate')
  if (!rule) throw new Error('請輸入施打規則')
  if (!ruleTextIsDecidable(rule)) throw new Error('無法判讀的規則，請用 W4、QW135、Q2W4、0923.0930 或 hold 等寫法')

  const existing = db
    .prepare(
      `SELECT id FROM injection_rule_overrides
       WHERE patient_id = ? AND order_code = ? AND start_date = ? AND dose = ? AND frequency = ?`,
    )
    .get(patientId, orderCode, startDate, dose, frequency)
  const now = new Date().toLocaleString('sv-SE')
  let id
  if (existing) {
    id = existing.id
    db.prepare(
      `UPDATE injection_rule_overrides
       SET rule = ?, confirmed_by_id = ?, confirmed_by_name = ?, updated_at = ?
       WHERE id = ?`,
    ).run(rule, user?.id || null, user?.name || null, now, id)
  } else {
    id = uuidv4()
    db.prepare(
      `INSERT INTO injection_rule_overrides
         (id, patient_id, order_code, start_date, dose, frequency, rule, confirmed_by_id, confirmed_by_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, patientId, orderCode, startDate, dose, frequency, rule, user?.id || null, user?.name || null, now, now)
  }
  rebuildInjectionRules(db)
  return mapOverrideRow(db.prepare(`SELECT * FROM injection_rule_overrides WHERE id = ?`).get(id))
}

export function deleteInjectionRuleOverride(db, id) {
  const changes = db.prepare(`DELETE FROM injection_rule_overrides WHERE id = ?`).run(id).changes
  if (changes) rebuildInjectionRules(db)
  return changes
}

// ---------------------------------------------------------------------------
// 解讀層：injection_order_rules 重建與新鮮度
// ---------------------------------------------------------------------------
function hasIntervalData(db) {
  return !!db
    .prepare(`SELECT 1 FROM injection_orders WHERE start_date IS NOT NULL AND start_date != '' LIMIT 1`)
    .get()
}

function computeRulesStamp(db) {
  const o = db
    .prepare(`SELECT COUNT(*) AS c, COALESCE(MAX(created_at), '') AS m FROM injection_orders WHERE order_type = 'injection'`)
    .get()
  const v = db.prepare(`SELECT COUNT(*) AS c, COALESCE(MAX(updated_at), '') AS m FROM injection_rule_overrides`).get()
  return `${INJECTION_PARSER_VERSION}|${o.c}|${o.m}|${v.c}|${v.m}`
}

/**
 * 全量重建 injection_order_rules（約數千筆，毫秒級）。
 * 觸發：藥囑上傳後、覆寫新增/修改/刪除後、戳記不符時（ensureInjectionRulesFresh）。
 */
export function rebuildInjectionRules(db) {
  const overrides = loadOverrideMap(db)
  const orders = db.prepare(`SELECT * FROM injection_orders WHERE order_type = 'injection'`).all()
  const insert = db.prepare(`
    INSERT INTO injection_order_rules
      (order_id, order_key, patient_id, order_code, start_date, end_date, dose, frequency, note,
       rule_kind, rule_source, rule_text, rule_json, reason, override_id, parser_version, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const now = new Date().toLocaleString('sv-SE')
  const stamp = computeRulesStamp(db)
  const run = db.transaction(() => {
    db.prepare(`DELETE FROM injection_order_rules`).run()
    for (const o of orders) {
      const key = overrideKeyOf(o)
      const override = overrides.get(key)
      const rule = buildInjectionRule(o, override?.rule ?? null)
      insert.run(
        o.id,
        key,
        o.patient_id,
        o.order_code,
        o.start_date || '',
        o.end_date || '',
        String(o.dose ?? ''),
        o.frequency || '',
        o.note || '',
        rule.kind,
        rule.source,
        rule.text,
        JSON.stringify(rule),
        rule.reason || '',
        override?.id || null,
        INJECTION_PARSER_VERSION,
        now,
      )
    }
    db.prepare(`INSERT OR REPLACE INTO injection_rules_meta (key, value) VALUES ('stamp', ?)`).run(stamp)
  })
  run()
  return orders.length
}

export function ensureInjectionRulesFresh(db, force = false) {
  const stored = db.prepare(`SELECT value FROM injection_rules_meta WHERE key = 'stamp'`).get()?.value
  const current = computeRulesStamp(db)
  if (force || stored !== current) {
    const n = rebuildInjectionRules(db)
    console.log(`[InjectionRules] 解讀層已重建：${n} 筆針劑處方（${INJECTION_PARSER_VERSION}）`)
    return true
  }
  return false
}

/**
 * 讀取「targetDate 當天有效」的針劑處方 + 規則（區間模型；舊月快照模型退回沿用上月邏輯）。
 * patientIds 為 null → 全部病人。已排除 IGEN2 等不進每日清單的藥碼與無意義劑量。
 * 同病人同藥同備註同劑量同頻率的重複列只留一筆（保留同藥多頻率各自成列）。
 */
export function loadActiveInjectionRules(db, targetDate, patientIds = null) {
  ensureInjectionRulesFresh(db)
  const scoped = Array.isArray(patientIds)
  if (scoped && patientIds.length === 0) return []
  const scope = scoped ? `AND io.patient_id IN (${patientIds.map(() => '?').join(',')})` : ''
  let rows
  if (hasIntervalData(db)) {
    rows = db
      .prepare(
        `SELECT io.*, r.rule_kind, r.rule_source, r.rule_text, r.rule_json, r.reason, r.override_id, r.order_key
         FROM injection_orders io
         JOIN injection_order_rules r ON r.order_id = io.id
         WHERE io.order_type = 'injection' ${scope}
           AND io.start_date != '' AND io.start_date <= ?
           AND (io.end_date = '' OR io.end_date IS NULL OR io.end_date >= ?)
         ORDER BY io.patient_id, io.order_code, io.start_date DESC, io.created_at DESC`,
      )
      .all(...(scoped ? patientIds : []), targetDate, targetDate)
  } else {
    // 舊「月快照」模型：每位病人取 <= 目標月份的最新一份上傳（有效月份不限 order_type，
    // 避免當月只有口服被誤判成無資料而復活已停針劑）。
    rows = db
      .prepare(
        `WITH latest_per_patient AS (
           SELECT patient_id, MAX(upload_month) AS effective_month
           FROM injection_orders
           WHERE upload_month <= ? ${scoped ? `AND patient_id IN (${patientIds.map(() => '?').join(',')})` : ''}
           GROUP BY patient_id
         )
         SELECT io.*, r.rule_kind, r.rule_source, r.rule_text, r.rule_json, r.reason, r.override_id, r.order_key
         FROM injection_orders io
         JOIN latest_per_patient lp ON io.patient_id = lp.patient_id AND io.upload_month = lp.effective_month
         JOIN injection_order_rules r ON r.order_id = io.id
         WHERE io.order_type = 'injection'
         ORDER BY io.patient_id, io.order_code, io.change_date DESC, io.created_at DESC`,
      )
      .all(targetDate.slice(0, 7), ...(scoped ? patientIds : []))
  }
  const seen = new Set()
  const out = []
  for (const row of rows) {
    if (DAILY_INJECTION_EXCLUDED_CODES.has(row.order_code)) continue
    if (!hasMeaningfulDose(row.dose)) continue
    const key = `${row.patient_id}|${row.order_code || ''}|${row.note || ''}|${row.dose || ''}|${row.frequency || ''}`
    if (seen.has(key)) continue
    seen.add(key)
    row.rule = JSON.parse(row.rule_json)
    out.push(row)
  }
  return out
}

export function getPatientNameMap(db, patientIds) {
  if (patientIds.length === 0) return new Map()
  const placeholders = patientIds.map(() => '?').join(',')
  const rows = db.prepare(`SELECT id, name FROM patients WHERE id IN (${placeholders})`).all(...patientIds)
  return new Map(rows.map((row) => [row.id, row.name]))
}

export function toInjectionRecord(order, patientNameMap) {
  const medInfo = INJECTION_MEDS[order.order_code] || null
  return {
    id: order.id,
    patientId: order.patient_id,
    patientName: patientNameMap.get(order.patient_id) || order.patient_name || '',
    medicalRecordNumber: order.medical_record_number,
    orderCode: order.order_code,
    orderName: medInfo?.tradeName || order.order_name || order.order_code || '',
    dose: order.dose,
    unit: medInfo?.unit || '',
    frequency: order.frequency,
    note: order.note,
    orderType: order.order_type,
    changeDate: order.change_date,
    uploadMonth: order.upload_month,
    sourceFile: order.source_file,
    startDate: order.start_date || '',
    endDate: order.end_date || '',
    prescriber: order.prescriber || '',
    createdAt: order.created_at,
    ruleKind: order.rule_kind,
    ruleSource: order.rule_source,
    effectiveRule: order.rule_text,
    overrideId: order.override_id || null,
    overrideKey: order.order_key,
  }
}

export function sortByPatientThenCode(a, b) {
  const nameCompare = String(a.patientName || '').localeCompare(String(b.patientName || ''), 'zh-Hant')
  if (nameCompare !== 0) return nameCompare
  return String(a.orderCode || '').localeCompare(String(b.orderCode || ''))
}

/** 每日應打針劑（每日排程臨床查閱 / 護理分組 / 書記針劑名單 / 床邊儀表板 共用） */
export function getDailyInjections(db, targetDate, patientIds) {
  if (!targetDate || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    throw new Error('targetDate must be in YYYY-MM-DD format')
  }
  const uniquePatientIds = [...new Set((patientIds || []).filter(Boolean))]
  if (uniquePatientIds.length === 0) return []

  const rows = loadActiveInjectionRules(db, targetDate, uniquePatientIds)
  const patientNameMap = getPatientNameMap(db, uniquePatientIds)
  return rows
    .filter((row) => isRuleScheduledOn(row.rule, targetDate))
    .map((row) => toInjectionRecord(row, patientNameMap))
    .sort(sortByPatientThenCode)
}

/**
 * 疑慮清單（僅「判不出星期幾」這一類；含交叉檢查的完整待審清單見 injectionRulesService.getInjectionReview）。
 */
export function getUncertainInjections(db, targetDate, patientIds = null) {
  if (!targetDate || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    throw new Error('targetDate must be in YYYY-MM-DD format')
  }
  const scope = Array.isArray(patientIds) ? [...new Set(patientIds.filter(Boolean))] : null
  if (scope && scope.length === 0) return []
  const rows = loadActiveInjectionRules(db, targetDate, scope).filter((r) => r.rule_kind === 'uncertain')
  const involved = [...new Set(rows.map((r) => r.patient_id))]
  const patientNameMap = getPatientNameMap(db, involved)
  const deleted = new Set(
    involved.length
      ? db
          .prepare(`SELECT id FROM patients WHERE is_deleted = 1 AND id IN (${involved.map(() => '?').join(',')})`)
          .all(...involved)
          .map((r) => r.id)
      : [],
  )
  return rows
    .filter((r) => !deleted.has(r.patient_id))
    .map((r) => ({ ...toInjectionRecord(r, patientNameMap), reason: r.reason }))
    .sort(sortByPatientThenCode)
}
