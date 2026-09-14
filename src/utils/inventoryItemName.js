/**
 * 庫存品名對照工具（品項設定 inventory_items 為唯一權威）
 *
 * 三條路徑共用同一套規則，改這裡就同時生效：
 *  - 消耗紀錄（A1 人工腎臟統計表）上傳：POST /orders/consumables/upload
 *  - 透析醫囑（E1 備藥前置作業）上傳：POST /orders/dialysis-orders/upload 的星期一～六 AK 欄
 *  - 前端 angular-client/src/utils/inventoryItemName.ts 是同邏輯的 TS 版（排程推估/醫囑視窗用），改一邊要同步另一邊
 *
 * 解析順序：品名完全相同 → 別名表 inventory_item_aliases → 寬鬆比對（全形/空白/大小寫）
 *          → 本次請求的 itemMappings（使用者在確認視窗的決定：map/create/skip）→ unmatched
 */
import { v4 as uuidv4 } from 'uuid'

/**
 * 品名寬鬆比對 key：全形轉半形、去所有空白、轉大寫
 * （HIS 與品項設定只差大小寫/空白時視為同一品項，不用再問使用者）
 */
export function looseItemKey(name) {
  return String(name ?? '')
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, '')
    .toUpperCase()
}

/**
 * HIS 備藥前置作業的 AK 格偶爾帶「;Y」之類的旗標後綴（如 `19H;Y`、`BG-2.1U;Y`）。
 * 2026-09-15 使用者裁定：上傳時自動去掉分號後綴，只留型號。
 */
export function stripAkCellSuffix(raw) {
  return String(raw ?? '')
    .trim()
    .replace(/\s*;.*$/, '')
    .trim()
}

/**
 * 建立「上傳品名 → 品項設定品項」解析器。
 * 回傳 resolve(rawTrimmed) => { canonical: string|null, via: 'exact'|'auto'|'map'|'create'|'skip'|'unmatched' }
 * map/create 的副作用（新建品項、記住別名）先收在 pendingCreates/pendingAliases，由呼叫端在交易內寫入
 * （用 applyPendingItemChanges）。
 */
export function createInventoryItemResolver(db, category, itemMappings) {
  const inventoryItems = db
    .prepare(`SELECT id, name FROM inventory_items WHERE category = ? ORDER BY name`)
    .all(category)
  const itemById = new Map(inventoryItems.map((i) => [i.id, i]))
  const itemByExact = new Map()
  const itemByLoose = new Map()
  for (const it of inventoryItems) {
    if (!itemByExact.has(it.name)) itemByExact.set(it.name, it)
    const loose = looseItemKey(it.name)
    if (!itemByLoose.has(loose)) itemByLoose.set(loose, it)
  }
  const itemByAlias = new Map()
  for (const a of db
    .prepare(`SELECT alias, item_id FROM inventory_item_aliases WHERE category = ?`)
    .all(category)) {
    const target = itemById.get(a.item_id)
    if (!target) continue // 品項已刪除的殘留別名，忽略
    itemByAlias.set(a.alias, target)
    const loose = looseItemKey(a.alias)
    if (!itemByAlias.has(loose)) itemByAlias.set(loose, target)
  }

  const mappings =
    itemMappings && typeof itemMappings === 'object' && !Array.isArray(itemMappings) ? itemMappings : {}
  const cache = new Map()
  const pendingCreates = [] // [{ id, name }]
  const pendingAliases = [] // [{ alias, itemId, itemName }]
  const mapped = [] // [{ from, to, remembered }]
  const skipped = [] // [name]

  const resolve = (rawTrimmed) => {
    if (cache.has(rawTrimmed)) return cache.get(rawTrimmed)
    const loose = looseItemKey(rawTrimmed)
    let result
    const exact = itemByExact.get(rawTrimmed)
    const auto = exact || itemByAlias.get(rawTrimmed) || itemByAlias.get(loose) || itemByLoose.get(loose)
    if (auto) {
      result = { canonical: auto.name, via: exact ? 'exact' : 'auto' }
    } else {
      const m = mappings[rawTrimmed]
      const action = m && typeof m === 'object' ? m.action : null
      if (action === 'skip') {
        skipped.push(rawTrimmed)
        result = { canonical: null, via: 'skip' }
      } else if (action === 'create') {
        const created = { id: uuidv4(), name: rawTrimmed }
        pendingCreates.push(created)
        itemById.set(created.id, created)
        itemByExact.set(created.name, created)
        itemByLoose.set(loose, created)
        result = { canonical: created.name, via: 'create' }
      } else if (action === 'map' && m.itemId && itemById.has(String(m.itemId))) {
        const target = itemById.get(String(m.itemId))
        const remembered = m.remember !== false && target.name !== rawTrimmed
        if (remembered) pendingAliases.push({ alias: rawTrimmed, itemId: target.id, itemName: target.name })
        mapped.push({ from: rawTrimmed, to: target.name, remembered })
        result = { canonical: target.name, via: 'map' }
      } else {
        result = { canonical: null, via: 'unmatched' }
      }
    }
    cache.set(rawTrimmed, result)
    return result
  }

  return { inventoryItems, resolve, pendingCreates, pendingAliases, mapped, skipped }
}

/**
 * 把解析器累積的「新增品項 / 記住別名」寫進 DB。必須在呼叫端的 db.transaction 內呼叫。
 */
export function applyPendingItemChanges(db, resolver, category, createdByJson) {
  const { pendingCreates, pendingAliases } = resolver
  if (pendingCreates.length === 0 && pendingAliases.length === 0) return
  const insertItemStmt = db.prepare(`INSERT INTO inventory_items (id, name, category) VALUES (?, ?, ?)`)
  const upsertAliasStmt = db.prepare(`
    INSERT INTO inventory_item_aliases (id, category, alias, item_id, created_by)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(category, alias) DO UPDATE SET
      item_id = excluded.item_id,
      created_by = excluded.created_by,
      created_at = datetime('now', 'localtime')
  `)
  for (const c of pendingCreates) insertItemStmt.run(c.id, c.name, category)
  for (const a of pendingAliases) upsertAliasStmt.run(uuidv4(), category, a.alias, a.itemId, createdByJson)
}

/**
 * 給前端用的 AK 目錄（品項設定 + 別名），GET /orders/ak-catalog
 */
export function loadAkCatalog(db) {
  const items = db
    .prepare(
      `SELECT id, name, units_per_box FROM inventory_items WHERE category = 'artificialKidney' ORDER BY name`,
    )
    .all()
    .map((i) => ({ id: i.id, name: i.name, unitsPerBox: i.units_per_box }))
  const nameById = new Map(items.map((i) => [i.id, i.name]))
  const aliases = {}
  for (const a of db
    .prepare(`SELECT alias, item_id FROM inventory_item_aliases WHERE category = 'artificialKidney'`)
    .all()) {
    const name = nameById.get(a.item_id)
    if (name) aliases[a.alias] = name
  }
  return { category: 'artificialKidney', items, aliases }
}
