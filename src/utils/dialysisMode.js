// 透析模式正規化：統一拼法與大小寫，避免 SLEDD/sled/cvvhdf 等漂移。
// 標準值對齊前端 patient-form-modal MODES。
export const CANONICAL_DIALYSIS_MODES = ['HD', 'SLED', 'CVVHDF', 'PP', 'DFPP', 'Lipid']

// 常見錯拼別名（key 以大寫比對）
const DIALYSIS_MODE_ALIASES = {
  SLEDD: 'SLED',
  SLEDF: 'SLED',
  SLEDDF: 'SLED', // HIS 備藥前置作業 Excel 出現過 SLEDDf 拼法
}

/**
 * 將透析模式字串正規化為標準拼法。
 * - 去除前後空白
 * - 已知別名（如 SLEDD）對應到標準值
 * - 大小寫不敏感對到標準值（如 lipid → Lipid、cvvhdf → CVVHDF）
 * - 未知值保留去空白後的原字串（不破壞特殊模式）
 * - 非字串原樣回傳
 */
export function normalizeDialysisMode(mode) {
  if (typeof mode !== 'string') return mode
  const trimmed = mode.trim()
  if (!trimmed) return trimmed
  const upper = trimmed.toUpperCase()
  if (DIALYSIS_MODE_ALIASES[upper]) return DIALYSIS_MODE_ALIASES[upper]
  const canonical = CANONICAL_DIALYSIS_MODES.find((m) => m.toUpperCase() === upper)
  return canonical || trimmed
}

/**
 * 就地正規化 dialysisOrders 物件的 mode 欄位（若存在）。
 * 回傳同一個物件以便鏈式使用。
 */
export function normalizeDialysisOrdersMode(dialysisOrders) {
  if (dialysisOrders && dialysisOrders.mode != null) {
    dialysisOrders.mode = normalizeDialysisMode(dialysisOrders.mode)
  }
  return dialysisOrders
}
