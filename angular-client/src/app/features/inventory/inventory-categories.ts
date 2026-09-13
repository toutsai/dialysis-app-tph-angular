// 庫存品項類別的單一權威（2026-09-14 新增「其他耗材」時集中管理；之前散在各元件各寫一份）。
// 新增類別只改這裡 + 後端 src/routes/system.js 的 COUNT_CATEGORIES（盤點文件的類別白名單）。
//
// 「其他耗材」（IV set、輸血 set、迴路管…）沒有排程推估、也不在 HIS 消耗 Excel 裡，
// 所以消耗一律視為 0：庫存 = 盤點 + 到貨，訂購量只看品項設定的手動安全庫存。

export const INVENTORY_CATEGORIES = ['artificialKidney', 'dialysateCa', 'bicarbonateType', 'otherSupplies'] as const;
export type InventoryCategory = (typeof INVENTORY_CATEGORIES)[number];

export const INVENTORY_CATEGORY_NAMES: Record<string, string> = {
  artificialKidney: '人工腎臟',
  dialysateCa: '透析藥水CA',
  bicarbonateType: 'B液種類',
  otherSupplies: '其他耗材',
};

/** 行事曆 chip / 格子小字用的短名 */
export const INVENTORY_CATEGORY_SHORT: Record<string, string> = {
  artificialKidney: 'AK',
  dialysateCa: 'A液',
  bicarbonateType: 'B液',
  otherSupplies: '其他',
};

/** 有消耗資料來源（排程推估 + HIS 實際上傳）的類別；「實際 vs 推估」對照表只列這些 */
export const CONSUMPTION_TRACKED_CATEGORIES: readonly string[] = ['artificialKidney', 'dialysateCa', 'bicarbonateType'];

export function isConsumptionTracked(category: string): boolean {
  return CONSUMPTION_TRACKED_CATEGORIES.includes(category);
}

/** { 類別: {} } × 全部類別 */
export function emptyGroupedByCategory<T = Record<string, number>>(): Record<string, T> {
  const out: Record<string, T> = {};
  for (const c of INVENTORY_CATEGORIES) out[c] = {} as T;
  return out;
}

/** { 類別: [] } × 全部類別（knownItems 預設值） */
export function emptyItemLists(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const c of INVENTORY_CATEGORIES) out[c] = [];
  return out;
}
