// 門診 CKD：解析後資料列 → SQLite 合併寫入
// 合併規則照原版（交接包 server.js mergeCases/mergeInto/combineLab、app.js mergeCasesSnapshot/handleFiles）：
//   case   追蹤清冊是登錄簿快照 → 新檔出現的人，舊列整批換成新列（逐人取代，不逐鍵累積）
//   clinic 鍵 mrn|date|no → 已有的略過（不更新）；自帶 ACR/PCR/eGFR 另併入檢驗（no 以 clinic| 開頭）
//   lab    鍵 no（mrn|date|spec）→ 同鍵取聯集，新檔的值覆蓋舊值（每日/每三日匯出同人同日項目可能分在兩檔）
//   bill   鍵 mrn|visit|code → 已有的略過
//   同內容檔（sha1 相同）直接略過不重複匯入
// 所有函式吃 db 參數（getDatabase() 或 CLI 自開連線），方便測試注入暫存 DB。
import { v4 as uuidv4 } from 'uuid'
import { dateRange, DATE_FIELD } from './rows.js'
import { KIND_LABEL } from './parsers.js'

const j = (o) => JSON.stringify(o || {})
const parse = (s) => { try { return s ? JSON.parse(s) : {} } catch { return {} } }
const keyCase = (r) => `${r.mrn}|${r.visit || ''}|${r.code || ''}|${r.ctype || ''}`

/** 追蹤清冊：逐人取代 */
export function ingestCases(db, rows, batchId) {
  const mrns = [...new Set(rows.map((r) => r.mrn))]
  const selOld = db.prepare(`SELECT mrn, visit_date, code, ctype, name, prog, cat, dm, enroll_date, egfr, egfr_mdrd, stage, doctor, next_due, reenroll, serial, gap_days, closed, close_date, reason FROM ckd_cases WHERE mrn = ?`)
  const del = db.prepare(`DELETE FROM ckd_cases WHERE mrn = ?`)
  const ins = db.prepare(`
    INSERT OR REPLACE INTO ckd_cases
      (id, mrn, visit_date, code, ctype, name, prog, cat, dm, enroll_date, egfr, egfr_mdrd, stage, doctor, next_due, reenroll, serial, gap_days, closed, close_date, reason, batch_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  // 同鍵列「內容是否相同」：欄位正規化成寫入 DB 時的形態（undefined→null、字串空值→''）再比，否則重複列會被誤算成更新
  const rowSig = (r) => j({ n: r.name || '', p: r.prog || '', c: r.cat || '', dm: r.dm ? 1 : 0, e: r.enroll || null, g: r.egfr ?? null, gm: r.egfrMdrd ?? null, s: r.stage || null, d: r.doctor || '', nd: r.nextDue || null, re: r.reenroll ? 1 : 0, se: r.serial || '', gd: r.gapDays ?? null, cl: r.closed ? 1 : 0, cd: r.closeDate || null, rs: r.reason || '' })
  const oldSig = (o) => j({ n: o.name || '', p: o.prog || '', c: o.cat || '', dm: o.dm ? 1 : 0, e: o.enroll_date || null, g: o.egfr ?? null, gm: o.egfr_mdrd ?? null, s: o.stage || null, d: o.doctor || '', nd: o.next_due || null, re: o.reenroll ? 1 : 0, se: o.serial || '', gd: o.gap_days ?? null, cl: o.closed ? 1 : 0, cd: o.close_date || null, rs: o.reason || '' })
  return db.transaction(() => {
    const oldKeys = new Map()
    for (const mrn of mrns) for (const o of selOld.all(mrn)) oldKeys.set(`${o.mrn}|${o.visit_date}|${o.code}|${o.ctype}`, oldSig(o))
    let added = 0, dup = 0, updated = 0, removed = 0
    const newKeys = new Set()
    for (const r of rows) {
      const k = keyCase(r)
      newKeys.add(k)
      if (!oldKeys.has(k)) added++
      else if (oldKeys.get(k) === rowSig(r)) dup++
      else updated++
    }
    for (const k of oldKeys.keys()) if (!newKeys.has(k)) removed++
    for (const mrn of mrns) del.run(mrn)
    for (const r of rows) {
      if (!r.visit) continue
      ins.run(uuidv4(), r.mrn, r.visit, r.code || '', r.ctype, r.name || '', r.prog || '', r.cat || '', r.dm ? 1 : 0, r.enroll || null,
        r.egfr ?? null, r.egfrMdrd ?? null, r.stage || null, r.doctor || '', r.nextDue || null, r.reenroll ? 1 : 0, r.serial || '', r.gapDays ?? null,
        r.closed ? 1 : 0, r.closeDate || null, r.reason || '', batchId)
    }
    return { rows: rows.length, persons: mrns.length, added, dup, updated, removed }
  })()
}

/** 門診清單：鍵存在就略過 */
export function ingestClinic(db, rows, batchId) {
  const ins = db.prepare(`
    INSERT OR IGNORE INTO ckd_clinic_visits
      (id, mrn, visit_date, no, name, id_no, sex, birth, age, half, dept, room, doctor, acr_date, acr, pcr_date, pcr, egfr_mdrd_date, egfr_mdrd, egfr_date, egfr, batch_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  return db.transaction(() => {
    let added = 0
    for (const r of rows) {
      if (!r.date) continue
      const res = ins.run(uuidv4(), r.mrn, r.date, r.no || '', r.name || '', r.id || '', r.sex || '', r.birth || null, r.age ?? null, r.half || '', r.dept || '', r.room || '', r.doctor || '',
        r.acrDate || null, r.acr ?? null, r.pcrDate || null, r.pcr ?? null, r.egfrMdrdDate || null, r.egfrMdrd ?? null, r.egfrDate || null, r.egfr ?? null, batchId)
      if (res.changes) added++
    }
    return { rows: rows.length, persons: new Set(rows.map((r) => r.mrn)).size, added, dup: rows.length - added }
  })()
}

/** 檢驗：同鍵聯集、新值覆蓋（combineLab） */
export function ingestLabs(db, rows, batchId) {
  const sel = db.prepare(`SELECT id, values_json, flags_json, quals_json FROM ckd_labs WHERE no = ?`)
  const ins = db.prepare(`
    INSERT INTO ckd_labs (id, no, mrn, name, report_date, spec, kind, src, values_json, flags_json, quals_json, batch_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const upd = db.prepare(`
    UPDATE ckd_labs SET name = ?, values_json = ?, flags_json = ?, quals_json = ?, batch_id = ?, updated_at = datetime('now','localtime') WHERE id = ?
  `)
  return db.transaction(() => {
    let added = 0, updated = 0, dup = 0
    for (const r of rows) {
      if (!r.no || !r.date) continue
      const old = sel.get(r.no)
      if (!old) {
        ins.run(uuidv4(), r.no, r.mrn, r.name || '', r.date, r.spec, r.kind || '', r.src || 'lab', j(r.v), j(r.flag), j(r.q), batchId)
        added++
        continue
      }
      const v = { ...parse(old.values_json) }, q = { ...parse(old.quals_json) }, flag = { ...parse(old.flags_json) }
      for (const k in r.v || {}) {
        v[k] = r.v[k]
        if (r.q && r.q[k] != null) q[k] = r.q[k]; else delete q[k]
        if (r.flag && r.flag[k] != null) flag[k] = r.flag[k]; else delete flag[k]
      }
      if (j(v) === old.values_json && j(flag) === old.flags_json && j(q) === old.quals_json) { dup++; continue }
      upd.run(r.name || '', j(v), j(flag), j(q), batchId, old.id)
      updated++
    }
    return { rows: rows.length, persons: new Set(rows.map((r) => r.mrn)).size, added, updated, dup }
  })()
}

/** 入帳：鍵存在就略過 */
export function ingestBilling(db, rows, batchId) {
  const ins = db.prepare(`
    INSERT OR IGNORE INTO ckd_billing (id, mrn, visit_date, code, code_name, prog, ctype, name, doctor, dept, sex, birth, price, n, batch_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  return db.transaction(() => {
    let added = 0
    for (const r of rows) {
      if (!r.visit) continue
      const res = ins.run(uuidv4(), r.mrn, r.visit, r.code, r.codeName || '', r.prog || '', r.ctype || '', r.name || '', r.doctor || '', r.dept || '', r.sex || '', r.birth || null, r.price ?? null, r.n ?? 1, batchId)
      if (res.changes) added++
    }
    return { rows: rows.length, persons: new Set(rows.map((r) => r.mrn)).size, added, dup: rows.length - added }
  })()
}

export function findBatchByHash(db, hash) {
  return db.prepare(`SELECT id, kind, file_name, created_at FROM ckd_upload_batches WHERE file_hash = ? ORDER BY created_at DESC LIMIT 1`).get(hash) || null
}

/**
 * 整包匯入：{ kind, rows, extraLabs }（rows.js toPayload 的輸出）+ 檔案資訊 → 寫資料 + 批次紀錄
 * @returns {{ dup?: true, batch?: object, kind, kindLabel, stats, labStats? }}
 */
export function ingestPayload(db, payload, { fileName = '', fileHash = '', user = null } = {}) {
  const { kind, rows, extraLabs = [] } = payload
  if (!KIND_LABEL[kind]) throw Object.assign(new Error('不支援的報表種類：' + kind), { status: 422 })
  if (fileHash) {
    const prev = findBatchByHash(db, fileHash)
    if (prev) return { dup: true, kind, kindLabel: KIND_LABEL[kind], prevBatch: prev, stats: null }
  }
  const batchId = uuidv4()
  const by = user ? j({ uid: user.uid || user.id || null, name: user.name || user.username || '' }) : '{}'
  const range = dateRange(rows, DATE_FIELD[kind])
  return db.transaction(() => {
    let stats, labStats = null
    if (kind === 'case') stats = ingestCases(db, rows, batchId)
    else if (kind === 'clinic') { stats = ingestClinic(db, rows, batchId); if (extraLabs.length) labStats = ingestLabs(db, extraLabs, batchId) }
    else if (kind === 'lab') stats = ingestLabs(db, rows, batchId)
    else stats = ingestBilling(db, rows, batchId)
    const inserted = stats.added || 0
    const replaced = (stats.updated || 0) + (stats.removed || 0)
    db.prepare(`
      INSERT INTO ckd_upload_batches (id, kind, file_name, file_hash, row_count, inserted, replaced, range_start, range_end, uploaded_by, stats_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(batchId, kind, fileName, fileHash || null, rows.length, inserted, replaced, range.start, range.end, by, j({ ...stats, labStats }))
    return { kind, kindLabel: KIND_LABEL[kind], batchId, stats, labStats, range }
  })()
}

/** 四種來源的現況（給前端四張卡） */
export function sourceSummary(db) {
  const one = (sql) => db.prepare(sql).get()
  const lastBatch = db.prepare(`SELECT file_name, created_at, uploaded_by FROM ckd_upload_batches WHERE kind = ? ORDER BY created_at DESC LIMIT 1`)
  const files = db.prepare(`SELECT COUNT(*) AS n FROM ckd_upload_batches WHERE kind = ?`)
  const wrap = (kind, row) => {
    const lb = lastBatch.get(kind)
    return { kind, label: KIND_LABEL[kind], ...row, files: files.get(kind).n, lastFile: lb?.file_name || null, lastAt: lb?.created_at || null, lastBy: parse(lb?.uploaded_by) }
  }
  return {
    case: wrap('case', one(`SELECT COUNT(*) AS rows, COUNT(DISTINCT mrn) AS persons, MIN(visit_date) AS rangeStart, MAX(visit_date) AS rangeEnd, SUM(CASE WHEN closed = 0 THEN 1 ELSE 0 END) AS openRows FROM ckd_cases`)),
    clinic: wrap('clinic', one(`SELECT COUNT(*) AS rows, COUNT(DISTINCT mrn) AS persons, MIN(visit_date) AS rangeStart, MAX(visit_date) AS rangeEnd, COUNT(DISTINCT visit_date) AS days FROM ckd_clinic_visits`)),
    lab: wrap('lab', one(`SELECT COUNT(*) AS rows, COUNT(DISTINCT mrn) AS persons, MIN(CASE WHEN src = 'lab' THEN report_date END) AS rangeStart, MAX(CASE WHEN src = 'lab' THEN report_date END) AS rangeEnd, SUM(CASE WHEN src = 'clinic' THEN 1 ELSE 0 END) AS fromClinic FROM ckd_labs`)),
    bill: wrap('bill', one(`SELECT COUNT(*) AS rows, COUNT(DISTINCT mrn) AS persons, MIN(visit_date) AS rangeStart, MAX(visit_date) AS rangeEnd FROM ckd_billing`)),
  }
}

export function listBatches(db, limit = 30) {
  return db.prepare(`
    SELECT id, kind, file_name, row_count, inserted, replaced, range_start, range_end, uploaded_by, stats_json, created_at
    FROM ckd_upload_batches ORDER BY created_at DESC LIMIT ?
  `).all(limit).map((b) => ({
    id: b.id, kind: b.kind, kindLabel: KIND_LABEL[b.kind] || b.kind, fileName: b.file_name, rowCount: b.row_count,
    inserted: b.inserted, replaced: b.replaced, rangeStart: b.range_start, rangeEnd: b.range_end,
    uploadedBy: parse(b.uploaded_by), stats: parse(b.stats_json), createdAt: b.created_at,
  }))
}
