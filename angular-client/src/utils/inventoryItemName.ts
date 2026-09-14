/**
 * 庫存品名對照（前端版）。與後端 src/utils/inventoryItemName.js 同規則，改一邊要同步另一邊：
 *   品名完全相同 → 別名表 → 寬鬆比對（全形轉半形、去空白、大寫）
 * 品項設定（inventory_items）是唯一權威；對不上的回 null，由呼叫端決定保留原字並標示「未設定品項」。
 */

export function looseItemKey(name: string | null | undefined): string {
  return String(name ?? '')
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, '')
    .toUpperCase()
}

export interface ItemNameResolver {
  /** 正式品名清單（品項設定順序） */
  readonly names: readonly string[]
  /** 上傳/醫囑品名 → 品項設定正式名；對不上回 null */
  resolve(raw: string | null | undefined): string | null
  /** 是否為品項設定裡的正式名（完全相同） */
  isCanonical(name: string | null | undefined): boolean
}

export function buildItemNameResolver(
  names: readonly string[],
  aliases: Record<string, string> = {},
): ItemNameResolver {
  const exact = new Set<string>()
  const loose = new Map<string, string>()
  for (const n of names) {
    const name = String(n ?? '').trim()
    if (!name) continue
    exact.add(name)
    const k = looseItemKey(name)
    if (!loose.has(k)) loose.set(k, name)
  }
  const aliasExact = new Map<string, string>()
  const aliasLoose = new Map<string, string>()
  for (const [alias, target] of Object.entries(aliases || {})) {
    if (!alias || !target || !exact.has(target)) continue
    aliasExact.set(alias, target)
    const k = looseItemKey(alias)
    if (!aliasLoose.has(k)) aliasLoose.set(k, target)
  }
  const cache = new Map<string, string | null>()
  return {
    names: [...exact],
    isCanonical: (name) => exact.has(String(name ?? '').trim()),
    resolve: (raw) => {
      const value = String(raw ?? '').trim()
      if (!value) return null
      const hit = cache.get(value)
      if (hit !== undefined) return hit
      const k = looseItemKey(value)
      const result =
        (exact.has(value) ? value : null) ??
        aliasExact.get(value) ??
        aliasLoose.get(k) ??
        loose.get(k) ??
        null
      cache.set(value, result)
      return result
    },
  }
}
