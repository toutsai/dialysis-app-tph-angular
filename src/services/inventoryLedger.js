import { createHash, randomUUID } from 'node:crypto'

export function inventoryError(message, status = 400) {
  return Object.assign(new Error(message), { status })
}

export function initializeInventoryLedger(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(inventory_count_docs)').all().map(c => c.name))
  for (const [name, type] of Object.entries({ cutoff: "TEXT NOT NULL DEFAULT 'start-of-day'", count_type: "TEXT NOT NULL DEFAULT 'weekly'", revision: 'INTEGER NOT NULL DEFAULT 0', unit_snapshot: "TEXT NOT NULL DEFAULT '{}'" })) {
    if (!columns.has(name)) db.exec(`ALTER TABLE inventory_count_docs ADD COLUMN ${name} ${type}`)
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_count_versions (
      id TEXT PRIMARY KEY, count_date TEXT NOT NULL, revision INTEGER NOT NULL,
      operation TEXT NOT NULL, document TEXT NOT NULL, actor TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS inventory_count_versions_date ON inventory_count_versions(count_date,revision);
    CREATE TABLE IF NOT EXISTS inventory_requests (
      request_key TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, response TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS consumables_import_versions (
      id TEXT PRIMARY KEY, range_key TEXT NOT NULL, category TEXT NOT NULL,
      document TEXT NOT NULL, actor TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS consumables_import_sources (
      range_key TEXT NOT NULL, category TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL,
      complete INTEGER NOT NULL DEFAULT 0, source_file TEXT NOT NULL, uploaded_at TEXT NOT NULL,
      PRIMARY KEY(range_key, category)
    );
  `)
}

export function validateCountMap(input) {
  const out = {}
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw inventoryError('盤點數量格式不正確')
  for (const [category, entries] of Object.entries(input)) {
    if (!['artificialKidney','dialysateCa','bicarbonateType'].includes(category)) throw inventoryError('盤點類別不正確')
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw inventoryError('盤點品項格式不正確')
    out[category] = {}
    for (const [name, value] of Object.entries(entries)) {
      if (!name.trim() || value === null || typeof value === 'boolean' || !['string','number'].includes(typeof value) || String(value).trim() === '' || !Number.isFinite(Number(value)) || Number(value) < 0) throw inventoryError('盤點數量不可空白、負數或非數字；未盤品項請省略')
      out[category][name.trim()] = Number(value)
    }
  }
  return out
}

export function assertCountRevision(existing, expected) {
  const revision = existing?.revision || 0
  if (expected === undefined && revision === 0) return
  if (!Number.isInteger(expected) || expected < 0) throw inventoryError('請提供 expectedRevision 以防止覆寫其他人的盤點', 409)
  if (expected !== revision) throw inventoryError('盤點已更新，請重新載入後再儲存', 409)
}

export function recordCountVersion(db, date, revision, operation, document, actor) {
  db.prepare('INSERT INTO inventory_count_versions (id,count_date,revision,operation,document,actor) VALUES (?,?,?,?,?,?)').run(randomUUID(), date, revision, operation, JSON.stringify(document), actor)
}

export function idempotentInventoryRequest(db, actorId, scope, key, payload, write) {
  return db.transaction(() => {
    if (key === undefined || key === null || key === '') {
      const response = write()
      if (response.error) throw inventoryError(response.error)
      return response
    }
    if (typeof key !== 'string' || key.length > 200) throw inventoryError('idempotencyKey 格式不正確')
    const requestKey = `${actorId}:${scope}:${key}`
    const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex')
    const prior = db.prepare('SELECT * FROM inventory_requests WHERE request_key=?').get(requestKey)
    if (prior) {
      if (prior.payload_hash !== hash) throw inventoryError('相同請求識別碼不可用於不同訂單', 409)
      return JSON.parse(prior.response)
    }
    const response = write()
    if (response.error) throw inventoryError(response.error)
    db.prepare('INSERT INTO inventory_requests (request_key,payload_hash,response) VALUES (?,?,?)').run(requestKey, hash, JSON.stringify(response))
    return response
  })()
}

export function assertNoConsumableOverlap(db, rangeKey, startDate, endDate, category) {
  if (!startDate || startDate > endDate) throw inventoryError('耗用匯入需明確且有效的起迄日期')
  const keys = new Set(db.prepare('SELECT range_key FROM consumables_import_sources WHERE category=?').all(category).map(r => r.range_key))
  for (const row of db.prepare('SELECT report_date,report_data FROM consumables_reports').all()) {
    const data = JSON.parse(row.report_data || '{}')
    // Legacy reports retain month provenance; they must not block unrelated future months.
    const month = /^(\d{4})-(\d{2})/.exec(row.report_date || '')
    const legacyStart = month ? `${month[1]}${month[2]}01` : null
    const legacyEnd = month ? `${month[1]}${month[2]}${new Date(Number(month[1]),Number(month[2]),0).getDate()}` : null
    const checkLegacy = () => {
      if (!legacyStart || (legacyStart <= endDate && legacyEnd >= startDate)) {
        throw inventoryError(`耗用區間與舊月報 ${row.report_date || '日期不明'} 重疊，需先確認舊資料來源；未寫入任何資料`, 409)
      }
    }
    for (const [key, range] of Object.entries(data.ranges || {})) {
      if (Array.isArray(range[category]) && range[category].length) {
        if (key === 'legacy') checkLegacy()
        else keys.add(key)
      }
    }
    if (!data.ranges && Array.isArray(data[category]) && data[category].length) checkLegacy()
  }
  for (const key of keys) {
    if (key === rangeKey) continue
    const match = /^(\d{8})-(\d{8})$/.exec(key)
    if (!match || (match[1] <= endDate && match[2] >= startDate)) throw inventoryError(`耗用區間與既有同類別來源 ${key} 重疊或日期不明；請改用原區間完整重傳`, 409)
  }
}
