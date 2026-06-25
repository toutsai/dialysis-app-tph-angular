// src/services/effectiveOrdersService.ts
// 依「選取日期」取每位病人當下生效的透析醫囑（effectiveDate <= 日期 的最新一筆）。
// 後端：POST /api/orders/history/batch { patientIds, effectiveDateBefore }
//   回傳 { patientId: { orders, ... } | null }。無歷史者回 null → 由呼叫端 fallback 現行醫囑。
import { localApi } from '@/services/localApiClient';

/**
 * @returns Map patientId -> orders（僅含有生效歷史者；無者不放入，呼叫端自行 fallback）
 */
export async function fetchEffectiveOrders(
  patientIds: string[],
  date: string,
): Promise<Record<string, any>> {
  const ids = Array.from(new Set((patientIds || []).filter(Boolean)));
  if (ids.length === 0 || !date) return {};

  const map: Record<string, any> = {};
  // 後端單批上限 100，分批送
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    try {
      const resp: any = await localApi.post('/orders/history/batch', {
        patientIds: chunk,
        effectiveDateBefore: date,
      });
      if (resp && typeof resp === 'object') {
        for (const pid of Object.keys(resp)) {
          const orders = resp[pid]?.orders;
          if (orders && Object.keys(orders).length > 0) map[pid] = orders;
        }
      }
    } catch (error) {
      console.error('[effectiveOrders] 批次取生效醫囑失敗:', error);
    }
  }
  return map;
}
