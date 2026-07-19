// src/services/optimizedApiService.ts
// Backward-compatible bridge file (Phase 5 migration)
// Re-exports functions that components still import from '@/services/optimizedApiService'
import ApiManager from '@/services/localApiClient';
import { localApi } from '@/services/localApiClient';
import { getNowISO, formatDateToYYYYMMDD } from '@/utils/dateUtils';

// Cache
const cache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 30000;

function getCacheKey(operation: string, collection: string, id: string | null = null): string {
  return `${operation}:${collection}${id ? `:${id}` : ''}`;
}
function setCache(key: string, data: any): void {
  cache.set(key, { data, timestamp: Date.now() });
}
function getCache(key: string): any {
  const cached = cache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return cached.data;
}
function clearCacheByPattern(pattern: string): void {
  for (const key of cache.keys()) {
    if (key.includes(pattern)) cache.delete(key);
  }
}

// Batch processing
const batchQueue = new Map<string, { items: any[]; timeout: any }>();
const BATCH_DELAY = 50;

function addToBatch(operation: string, collection: string, id: string | null, data: any): void {
  const batchKey = `${operation}:${collection}`;
  if (!batchQueue.has(batchKey)) {
    batchQueue.set(batchKey, { items: [], timeout: null });
  }
  const batch = batchQueue.get(batchKey)!;
  batch.items.push({ id, data });
  if (batch.timeout) clearTimeout(batch.timeout);
  batch.timeout = setTimeout(() => {
    processBatch(operation, collection, batch.items);
    batchQueue.delete(batchKey);
  }, BATCH_DELAY);
}

async function processBatch(operation: string, collection: string, items: any[]): Promise<void> {
  const api = ApiManager(collection);
  try {
    if (operation === 'update') {
      await Promise.all(items.map((item) => api.update(item.id, item.data)));
    } else if (operation === 'save') {
      await Promise.all(items.map((item) => api.save(item.data)));
    } else if (operation === 'delete') {
      await Promise.all(items.map((item) => api.delete(item.id)));
    }
    clearCacheByPattern(collection);
  } catch (error) {
    console.error(`[Batch] ${operation} batch operation failed:`, error);
    throw error;
  }
}

// Data validation
function sanitizePatientData(patientData: any): any {
  const cleaned = { ...patientData };
  if (cleaned.medicalRecordNumber) cleaned.medicalRecordNumber = cleaned.medicalRecordNumber.toString().trim();
  if (cleaned.name) cleaned.name = cleaned.name.toString().trim();
  return cleaned;
}
function validatePatientData(patientData: any): void {
  const errors: string[] = [];
  if (!patientData.medicalRecordNumber || !patientData.medicalRecordNumber.trim()) errors.push('病歷號不能為空');
  if (!patientData.name || !patientData.name.trim()) errors.push('病人姓名不能為空');
  if (errors.length > 0) throw new Error(errors.join(', '));
}

// Schedule functions
export async function fetchAllSchedules(queries: any[] = []): Promise<any[]> {
  const api = ApiManager('schedules');
  return api.fetchAll(queries);
}
export async function saveSchedule(scheduleData: any): Promise<any> {
  const api = ApiManager('schedules');
  const result = await api.save(scheduleData);
  clearCacheByPattern('schedules');
  return result;
}
export async function updateSchedule(scheduleId: string, updateData: any): Promise<any> {
  const api = ApiManager('schedules');
  const result = await api.update(scheduleId, updateData);
  clearCacheByPattern('schedules');
  return result;
}

// Patient functions
export async function fetchAllPatients(): Promise<any[]> {
  const cacheKey = getCacheKey('fetchAll', 'patients_with_rules');
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const patientsApi = ApiManager('patients');
  const schedulesApi = ApiManager('base_schedules');
  const [patients, masterScheduleDoc] = await Promise.all([
    patientsApi.fetchAll(),
    schedulesApi.fetchById('MASTER_SCHEDULE'),
  ]);
  const masterRules = (masterScheduleDoc as any)?.schedule || {};
  const rulesMap = new Map(Object.entries(masterRules));
  const patientsWithRules = (patients as any[]).map((patient: any) => ({
    ...patient,
    scheduleRule: rulesMap.get(patient.id) || null,
  }));
  setCache(cacheKey, patientsWithRules);
  return patientsWithRules;
}
export async function savePatient(patientData: any): Promise<any> {
  const cleanedData = sanitizePatientData(patientData);
  validatePatientData(cleanedData);
  const api = ApiManager('patients');
  const result = await api.save(cleanedData);
  clearCacheByPattern('patients');
  return result;
}
export async function updatePatient(patientId: string, updateData: any): Promise<void> {
  const cleanedData = { ...updateData };
  if (cleanedData.medicalRecordNumber) cleanedData.medicalRecordNumber = cleanedData.medicalRecordNumber.toString().trim();
  const api = ApiManager('patients');
  await api.update(patientId, cleanedData);
  clearCacheByPattern('patients');
}

// Nursing duties (TPH backend: GET/PUT /nursing/duties, always operates on 'main' internally)
export async function fetchDuties(): Promise<any> {
  const cacheKey = getCacheKey('fetch', 'nursing_duties', 'main');
  const cached = getCache(cacheKey);
  if (cached) return cached;

  try {
    const data = await localApi.get('/nursing/duties');
    if (data) {
      setCache(cacheKey, data);
      return data;
    }
    return null;
  } catch (error) {
    console.error('Failed to fetch nursing duties:', error);
    throw new Error('無法從資料庫獲取護理職責資料。');
  }
}
export async function saveDuties(data: any): Promise<void> {
  try {
    await localApi.put('/nursing/duties', data);
    clearCacheByPattern('nursing_duties');
  } catch (error) {
    console.error('Failed to save nursing duties:', error);
    throw new Error('儲存護理職責到資料庫時發生錯誤。');
  }
}

// Dialysis order history
export async function fetchDialysisOrderHistory(queryConstraints: any = null): Promise<any[]> {
  const api = ApiManager('dialysis_orders_history');
  return api.fetchAll(queryConstraints || []);
}
export async function saveDialysisOrderHistory(historyData: any): Promise<any> {
  const api = ApiManager('dialysis_orders_history');
  const completeData = {
    ...historyData,
    createdAt: historyData.createdAt || getNowISO(),
    updatedAt: historyData.updatedAt || getNowISO(),
    operationType: historyData.operationType || 'CREATE',
  };
  return api.save(completeData);
}

export async function createDialysisOrderAndUpdatePatient(
  patientId: string,
  patientName: string,
  orderData: any,
): Promise<void> {
  const coalesce = (...values: any[]): any =>
    values.find((value) => value !== '' && value !== null && value !== undefined);
  const parseNumeric = (v: any): number | null => (v === '' || v == null ? null : Number(v));
  const parseWholeNumber = (v: any): number | null => {
    if (v === '' || v == null) return null;
    const numeric = Number(v);
    return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : null;
  };
  const normalizeTimeParts = (hours: number | null, minutes: number | null): { hours: number | null; minutes: number | null } => {
    if (hours === null && minutes === null) return { hours: null, minutes: null };
    const totalMinutes = (hours || 0) * 60 + (minutes || 0);
    return {
      hours: Math.floor(totalMinutes / 60),
      minutes: totalMinutes % 60,
    };
  };
  const parseDialysisTime = (data: any): { hours: number | null; minutes: number | null; decimalHours: number | null; text: string | null } => {
    let normalized = normalizeTimeParts(
      parseWholeNumber(coalesce(data.dialysisTimeHours, data.dialysisHour, data.dialysisHoursHour)),
      parseWholeNumber(coalesce(data.dialysisTimeMinutes, data.dialysisMinute, data.dialysisMinutes)),
    );

    if (normalized.hours === null && normalized.minutes === null) {
      const rawTime = coalesce(data.dialysisTimeText, data.dialysisHours, data.hours, data.duration);
      if (rawTime !== undefined) {
        const text = String(rawTime);
        const hourMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:時|小時|h|hr|hour)/i);
        const minuteMatch = text.match(/(\d+)\s*(?:分|分鐘|m|min|minute)/i);

        if (hourMatch || minuteMatch) {
          normalized = normalizeTimeParts(
            hourMatch ? parseWholeNumber(hourMatch[1]) : null,
            minuteMatch ? parseWholeNumber(minuteMatch[1]) : null,
          );
        } else {
          const decimal = Number(rawTime);
          if (Number.isFinite(decimal)) {
            const hours = Math.floor(decimal);
            const minutes = Math.round((decimal - hours) * 60);
            normalized = normalizeTimeParts(hours, minutes);
          }
        }
      }
    }

    if (normalized.hours === null && normalized.minutes === null) {
      return { hours: null, minutes: null, decimalHours: null, text: null };
    }

    const hours = normalized.hours || 0;
    const minutes = normalized.minutes || 0;
    return {
      hours,
      minutes,
      decimalHours: Number((hours + minutes / 60).toFixed(2)),
      text: `${hours}時${minutes}分`,
    };
  };
  const now = getNowISO();
  const dialysisTime = parseDialysisTime(orderData);

  const historyRecord: any = {
    patientId,
    patientName,
    operationType: 'UPDATE',
    createdAt: now,
    updatedAt: now,
    orders: {
      ak: orderData.ak || '',
      dialysateCa: orderData.dialysateCa || '',
      heparinInitial: parseNumeric(orderData.heparinInitial),
      heparinMaintenance: parseNumeric(orderData.heparinMaintenance),
      heparinLM: `${orderData.heparinInitial || '0'}/${orderData.heparinMaintenance || '0'}`,
      bloodFlow: parseNumeric(coalesce(orderData.bloodFlow, orderData.blood_flow)),
      dryWeight: parseNumeric(orderData.dryWeight),
      effectiveDate: orderData.effectiveDate || formatDateToYYYYMMDD(),
      vascAccess: orderData.vascAccess || '',
      arterialNeedle: orderData.arterialNeedle || '',
      venousNeedle: orderData.venousNeedle || '',
      physician: orderData.physician || '',
      mode: orderData.mode || '',
      freq: orderData.freq || '',
      dialysisHours: dialysisTime.decimalHours,
      dialysisTimeHours: dialysisTime.hours,
      dialysisTimeMinutes: dialysisTime.minutes,
      dialysisTimeText: dialysisTime.text,
      dialysateFlow: parseNumeric(coalesce(orderData.dialysateFlow, orderData.dialysateFlowRate, orderData.dialysisFlow)),
      replacementFlow: parseNumeric(coalesce(orderData.replacementFlow, orderData.replacementFlowRate)),
      dehydration: orderData.dehydration || '',
      mannitol: orderData.mannitol || '',
      heparinRinse: orderData.heparinRinse || '',
      icuNote: orderData.icuNote || '',
      artificialKidney: orderData.ak || '',
      dialysate: orderData.dialysateCa || '',
    },
  };

  if (orderData.mode === 'PP' || orderData.mode === 'DFPP') {
    historyRecord.orders.bw = orderData.bw;
    historyRecord.orders.hct = orderData.hct;
    historyRecord.orders.exchangeMultiplier = orderData.exchangeMultiplier;
    historyRecord.orders.plasmaVolume = orderData.plasmaVolume;
    historyRecord.orders.exchangeVolume = orderData.exchangeVolume;
    historyRecord.orders.heparin = orderData.heparin;
  }

  try {
    await Promise.all([
      saveDialysisOrderHistory(historyRecord),
      updatePatient(patientId, { dialysisOrders: { ...historyRecord.orders }, updatedAt: now }),
    ]);
    clearCacheByPattern('patients');
  } catch (error: any) {
    console.error(`Failed to create order for ${patientName}:`, error);
    throw new Error(`儲存醫囑失敗: ${error.message}`);
  }
}

export async function deleteDialysisOrderHistory(historyId: string): Promise<void> {
  const api = ApiManager('dialysis_orders_history');
  await api.delete(historyId);
}

// Patient history
export async function fetchPatientHistory(queryConstraints: any = null): Promise<any[]> {
  const api = ApiManager('patient_history');
  return api.fetchAll(queryConstraints || []);
}
export async function savePatientHistory(historyData: any): Promise<any> {
  const api = ApiManager('patient_history');
  return api.save(historyData);
}

// Cache management
export function clearAllCache(): void { cache.clear(); }
export function clearCacheByCollection(collection: string): void { clearCacheByPattern(collection); }
export function getCacheStats(): any {
  const stats: any = { totalItems: cache.size, collections: {} };
  for (const key of cache.keys()) {
    const collection = key.split(':')[1];
    if (!stats.collections[collection]) stats.collections[collection] = 0;
    stats.collections[collection]++;
  }
  return stats;
}
export function batchUpdatePatients(updates: Array<{ id: string; data: any }>): void {
  updates.forEach(({ id, data }) => addToBatch('update', 'patients', id, data));
}
export function batchUpdateSchedules(updates: Array<{ id: string; data: any }>): void {
  updates.forEach(({ id, data }) => addToBatch('update', 'schedules', id, data));
}
export default {
  fetchAllSchedules, saveSchedule, updateSchedule,
  fetchAllPatients, savePatient, updatePatient,
  fetchDialysisOrderHistory, saveDialysisOrderHistory, deleteDialysisOrderHistory,
  createDialysisOrderAndUpdatePatient,
  fetchPatientHistory, savePatientHistory,
  clearAllCache, clearCacheByCollection, getCacheStats,
  batchUpdatePatients, batchUpdateSchedules,
  fetchDuties, saveDuties,
};
