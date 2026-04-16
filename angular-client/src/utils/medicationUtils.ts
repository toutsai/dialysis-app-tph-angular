// src/utils/medicationUtils.ts

/** 醫囑物件介面 */
export interface MedicationOrder {
  orderCode?: string;
  orderName?: string;
  [key: string]: unknown;
}

const MEDICATION_UNITS_MAP: Record<string, string> = {
  INES2: 'mcg',
  IREC1: 'KIU',
  IFER2: 'mg',
  ICAC: 'mcg',
  IPAR1: 'mg',
  // ... 其他您知道單位的藥物
}

/**
 * 根據醫囑的 Code 或 Name 獲取其單位
 * @param order - 醫囑物件，應包含 orderCode 和 orderName
 * @returns 藥物單位字串，或空字串
 */
export function getMedicationUnit(order: MedicationOrder | null | undefined): string {
  if (!order) return ''

  const { orderCode, orderName } = order

  if (orderCode && MEDICATION_UNITS_MAP[orderCode]) {
    return MEDICATION_UNITS_MAP[orderCode]
  }

  if (orderName) {
    for (const key in MEDICATION_UNITS_MAP) {
      if (orderName.includes(key)) {
        return MEDICATION_UNITS_MAP[key]
      }
    }
  }

  return ''
}
