// src/utils/firestoreUtils.ts
// Backward-compatible bridge file (Phase 5 migration)
// Re-exports queryWithInChunks that components still import from '@/utils/firestoreUtils'
import { localApi } from '@/services/localApiClient';

const COLLECTION_ROUTE_MAP: Record<string, string> = {
  patients: '/patients',
  schedules: '/schedules',
  base_schedules: '/schedules/base',
  medication_orders: '/medications/injections',
  tasks: '/system/tasks',
  memos: '/memos',
  lab_reports: '/patients/lab-reports',
  kidit_logbook: '/system/kidit-logbook',
};

export async function queryWithInChunks(
  collectionName: string,
  fieldToQuery: string,
  values: any[],
  additionalWheres: any[] = [],
): Promise<any[]> {
  if (!values || values.length === 0) {
    return [];
  }

  const route = COLLECTION_ROUTE_MAP[collectionName] || `/${collectionName}`;

  try {
    const data = await localApi.post(`${route}/query`, {
      field: fieldToQuery,
      values,
    });

    return Array.isArray(data) ? data : (data?.data || []);
  } catch (error) {
    try {
      const params = new URLSearchParams();
      params.set(fieldToQuery, values.join(','));
      const data = await localApi.get(`${route}?${params}`);
      return Array.isArray(data) ? data : (data?.data || []);
    } catch (fallbackError) {
      console.error(`[firestoreUtils] queryWithInChunks failed for ${collectionName}:`, fallbackError);
      return [];
    }
  }
}
