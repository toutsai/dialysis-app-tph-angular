// 檔案路徑: src/services/optimizedApiService.js (✨ Standalone 版本 ✨)
import {
  schedulesApi,
  patientsApi,
  memosApi,
  ordersApi,
  nursingApi,
} from '@/services/localApiClient'
import { getNowISO, formatDateToYYYYMMDD } from '@/utils/dateUtils'

// 快取系統... (保持不變)
const cache = new Map()
const CACHE_TTL = 30000
function getCacheKey(operation, collection, id = null) {
  return `${operation}:${collection}${id ? `:${id}` : ''}`
}
function setCache(key, data) {
  cache.set(key, { data, timestamp: Date.now() })
}
function getCache(key) {
  const cached = cache.get(key)
  if (!cached) return null
  const isExpired = Date.now() - cached.timestamp > CACHE_TTL
  if (isExpired) {
    cache.delete(key)
    return null
  }
  return cached.data
}
function clearCacheByPattern(pattern) {
  const keysToDelete = []
  for (const key of cache.keys()) {
    if (key.includes(pattern)) {
      keysToDelete.push(key)
    }
  }
  keysToDelete.forEach((key) => cache.delete(key))
}

// 批次處理系統... (保持不變)
const batchQueue = new Map()
const BATCH_DELAY = 50
function addToBatch(operation, collection, id, data) {
  const batchKey = `${operation}:${collection}`
  if (!batchQueue.has(batchKey)) {
    batchQueue.set(batchKey, { items: [], timeout: null })
  }
  const batch = batchQueue.get(batchKey)
  batch.items.push({ id, data })
  if (batch.timeout) {
    clearTimeout(batch.timeout)
  }
  batch.timeout = setTimeout(() => {
    processBatch(operation, collection, batch.items)
    batchQueue.delete(batchKey)
  }, BATCH_DELAY)
}
async function processBatch(operation, collection, items) {
  const startTime = performance.now()
  try {
    console.log(`🚀 [Batch] 開始處理 ${operation} 批次操作 (${items.length} 項目)`)

    // 依據 collection 取得對應的 API
    const getApiForCollection = (col) => {
      switch (col) {
        case 'schedules': return schedulesApi
        case 'patients': return patientsApi
        case 'memos': return memosApi
        default: throw new Error(`不支援的 collection: ${col}`)
      }
    }

    if (operation === 'update') {
      if (collection === 'schedules') {
        await Promise.all(items.map((item) => schedulesApi.updateByDate(item.id, item.data.schedule)))
      } else if (collection === 'patients') {
        await Promise.all(items.map((item) => patientsApi.update(item.id, item.data)))
      }
    } else if (operation === 'save') {
      if (collection === 'memos') {
        await Promise.all(items.map((item) => memosApi.create(item.data)))
      }
    } else if (operation === 'delete') {
      if (collection === 'memos') {
        await Promise.all(items.map((item) => memosApi.delete(item.id)))
      }
    }
    const endTime = performance.now()
    console.log(`✅ [Batch] ${operation} 批次操作完成，耗時 ${(endTime - startTime).toFixed(2)}ms`)
    clearCacheByPattern(collection)
  } catch (error) {
    console.error(`❌ [Batch] ${operation} 批次操作失敗:`, error)
    throw error
  }
}

// 資料驗證... (保持不變)
function sanitizePatientData(patientData) {
  const cleaned = { ...patientData }
  if (cleaned.medicalRecordNumber) {
    cleaned.medicalRecordNumber = cleaned.medicalRecordNumber.toString().trim()
  }
  if (cleaned.name) {
    cleaned.name = cleaned.name.toString().trim()
  }
  return cleaned
}
function validatePatientData(patientData) {
  const errors = []
  if (!patientData.medicalRecordNumber || !patientData.medicalRecordNumber.trim()) {
    errors.push('病歷號不能為空')
  }
  if (!patientData.name || !patientData.name.trim()) {
    errors.push('病人姓名不能為空')
  }
  if (errors.length > 0) {
    throw new Error(errors.join(', '))
  }
}

// 排程相關函式 (Standalone 版本)
export async function fetchAllSchedules(params = {}) {
  // params 可包含 { startDate, endDate, date }
  return schedulesApi.fetchAll(params)
}
export async function saveSchedule(scheduleData) {
  // 使用 updateByDate 取代 save，因為 standalone 使用日期作為主鍵
  const result = await schedulesApi.updateByDate(scheduleData.date, scheduleData.schedule)
  clearCacheByPattern('schedules')
  return result
}
export async function updateSchedule(scheduleId, updateData) {
  // scheduleId 在 standalone 模式下就是日期
  await schedulesApi.updateByDate(scheduleId, updateData.schedule)
  clearCacheByPattern('schedules')
}

// 患者相關函式 (Standalone 版本)
export async function fetchAllPatients() {
  const cacheKey = getCacheKey('fetchAll', 'patients_with_rules')
  const cached = getCache(cacheKey)
  if (cached) return cached

  const [patients, masterScheduleDoc] = await Promise.all([
    patientsApi.fetchAll(true),
    schedulesApi.fetchMasterSchedule(),
  ])
  const masterRules = masterScheduleDoc?.schedule || {}
  const rulesMap = new Map(Object.entries(masterRules))
  const patientsWithRules = patients.map((patient) => {
    const rule = rulesMap.get(patient.id) || null
    return {
      ...patient,
      scheduleRule: rule,
      // ✅ [修正] 優先使用病人資料中的 freq/mode，若無則從排班規則取得
      freq: patient.freq || rule?.freq || null,
      mode: patient.mode || rule?.mode || null,
    }
  })
  setCache(cacheKey, patientsWithRules)
  return patientsWithRules
}
export async function savePatient(patientData) {
  const cleanedData = sanitizePatientData(patientData)
  validatePatientData(cleanedData)
  const result = await patientsApi.create(cleanedData)
  clearCacheByPattern('patients')
  return result
}
export async function updatePatient(patientId, updateData) {
  const cleanedData = { ...updateData }
  if (cleanedData.medicalRecordNumber) {
    cleanedData.medicalRecordNumber = cleanedData.medicalRecordNumber.toString().trim()
  }
  await patientsApi.update(patientId, cleanedData)
  clearCacheByPattern('patients')
}

// === 護理職責 (Nursing Duties) 相關函式 (Standalone 版本)

/**
 * 從本地資料庫獲取護理工作職責
 * @returns {Promise<object>}
 */
export async function fetchDuties() {
  const cacheKey = getCacheKey('fetch', 'nursing_duties', 'main')
  const cached = getCache(cacheKey)
  if (cached) {
    console.log('✅ [API] 從快取獲取護理職責資料')
    return cached
  }

  try {
    const data = await nursingApi.fetchDuties()
    if (data) {
      console.log('✅ [API] 從本地資料庫成功獲取護理職責資料')
      setCache(cacheKey, data)
      return data
    } else {
      console.log('⚠️ [API] 找不到護理職責文件，回傳空值。')
      return null
    }
  } catch (error) {
    console.error('❌ [API] 獲取護理職責失敗:', error)
    throw new Error('無法從資料庫獲取護理職責資料。')
  }
}

/**
 * 將護理工作職責儲存到本地資料庫
 * @param {object} data - 要儲存的完整資料物件
 * @returns {Promise<void>}
 */
export async function saveDuties(data) {
  try {
    await nursingApi.saveDuties(data)
    console.log('✅ [API] 護理職責資料已成功儲存')
    clearCacheByPattern('nursing_duties')
  } catch (error) {
    console.error('❌ [API] 儲存護理職責失敗:', error)
    throw new Error('儲存護理職責到資料庫時發生錯誤。')
  }
}

// 備忘錄相關函式 (Standalone 版本)
export async function fetchAllMemos(params = null) {
  // params 可包含 { date, startDate, endDate }
  return memosApi.fetchAll(params || {})
}
export async function saveMemo(memoData) {
  const result = await memosApi.create(memoData)
  clearCacheByPattern('memos')
  return result
}
export async function updateMemo(memoId, updateData) {
  await memosApi.update(memoId, updateData)
  clearCacheByPattern('memos')
}
export async function deleteMemo(memoId) {
  await memosApi.delete(memoId)
  clearCacheByPattern('memos')
}

// 透析醫囑歷史相關函式 (Standalone 版本)
export async function fetchDialysisOrderHistory(params = null) {
  // params 可包含 { patientId, effectiveDateBefore, limit }
  return ordersApi.fetchHistory(params || {})
}
export async function saveDialysisOrderHistory(historyData) {
  const completeData = {
    patientId: historyData.patientId,
    patientName: historyData.patientName,
    operationType: historyData.operationType || 'CREATE',
    orders: historyData.orders,
    createdAt: historyData.createdAt || getNowISO(),
    updatedAt: historyData.updatedAt || getNowISO(),
  }
  return ordersApi.createHistory(completeData)
}

// ✨ [這是最重要的修改！] ✨
export async function createDialysisOrderAndUpdatePatient(patientId, patientName, orderData) {
  console.log(`📝 [API] 開始為 ${patientName} 創建/更新醫囑...`, orderData)
  const parseNumeric = (v) => (v === '' || v == null ? null : Number(v))
  const now = getNowISO()

  const historyRecord = {
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
      bloodFlow: parseNumeric(orderData.bloodFlow),
      dryWeight: parseNumeric(orderData.dryWeight),
      effectiveDate: orderData.effectiveDate || formatDateToYYYYMMDD(),
      vascAccess: orderData.vascAccess || '',
      arterialNeedle: orderData.arterialNeedle || '',
      venousNeedle: orderData.venousNeedle || '',
      physician: orderData.physician || '',
      mode: orderData.mode || '',
      freq: orderData.freq || '',
      dialysisHours: parseNumeric(orderData.dialysisHours),
      dialysateFlow: parseNumeric(orderData.dialysateFlow),
      replacementFlow: parseNumeric(orderData.replacementFlow),
      dehydration: orderData.dehydration || '',
      mannitol: orderData.mannitol || '',
      heparinRinse: orderData.heparinRinse || '',
      // ✅ [核心修正 1] 將 icuNote 加入到儲存的物件中
      icuNote: orderData.icuNote || '',
      // 相容性欄位
      artificialKidney: orderData.ak || '',
      dialysate: orderData.dialysateCa || '',
    },
  }

  // 從 PP/DFPP 醫囑複製額外欄位
  if (orderData.mode === 'PP' || orderData.mode === 'DFPP') {
    historyRecord.orders.bw = orderData.bw
    historyRecord.orders.hct = orderData.hct
    historyRecord.orders.exchangeMultiplier = orderData.exchangeMultiplier
    historyRecord.orders.plasmaVolume = orderData.plasmaVolume
    historyRecord.orders.exchangeVolume = orderData.exchangeVolume
    historyRecord.orders.heparin = orderData.heparin
  }

  const latestOrdersForPatient = { ...historyRecord.orders }

  try {
    await Promise.all([
      // ✅ [核心修正 2] 呼叫 saveDialysisOrderHistory 時傳入正確的參數
      saveDialysisOrderHistory(historyRecord),
      updatePatient(patientId, { dialysisOrders: latestOrdersForPatient }),
    ])
    console.log(`✅ [API] 成功為 ${patientName} 創建並同步醫囑。`)
    clearCacheByPattern('patients')
  } catch (error) {
    console.error(`❌ [API] 為 ${patientName} 創建醫囑時發生嚴重錯誤:`, error)
    throw new Error(`儲存醫囑失敗: ${error.message}`)
  }
}

export async function deleteDialysisOrderHistory(historyId) {
  try {
    await ordersApi.deleteHistory(historyId)
  } catch (error) {
    throw new Error(`刪除失敗：${error.message}`)
  }
}

// 患者歷史相關函式 (Standalone 版本)
// 注意：此功能在 standalone 模式下可能需要後端支援
export async function fetchPatientHistory(params = null) {
  // 目前 standalone 模式使用 patientsApi.fetchHistory
  return patientsApi.fetchHistory(params || {})
}
export async function savePatientHistory(historyData) {
  return patientsApi.createHistory(historyData)
}

// 快取與批次處理函式... (保持不變)
export function clearAllCache() {
  cache.clear()
}
export function clearCacheByCollection(collection) {
  clearCacheByPattern(collection)
}
export function getCacheStats() {
  const stats = { totalItems: cache.size, collections: {} }
  for (const key of cache.keys()) {
    const collection = key.split(':')[1]
    if (!stats.collections[collection]) stats.collections[collection] = 0
    stats.collections[collection]++
  }
  return stats
}
export function batchUpdatePatients(updates) {
  updates.forEach(({ id, data }) => addToBatch('update', 'patients', id, data))
}
export function batchUpdateSchedules(updates) {
  updates.forEach(({ id, data }) => addToBatch('update', 'schedules', id, data))
}
export function batchSaveMemos(memos) {
  memos.forEach((data) => addToBatch('save', 'memos', null, data))
}

export default {
  fetchAllSchedules,
  saveSchedule,
  updateSchedule,
  fetchAllPatients,
  savePatient,
  updatePatient,
  fetchAllMemos,
  saveMemo,
  updateMemo,
  deleteMemo,
  fetchDialysisOrderHistory,
  saveDialysisOrderHistory,
  deleteDialysisOrderHistory,
  createDialysisOrderAndUpdatePatient,
  fetchPatientHistory,
  savePatientHistory,
  clearAllCache,
  clearCacheByCollection,
  getCacheStats,
  batchUpdatePatients,
  batchUpdateSchedules,
  batchSaveMemos,
  fetchDuties,
  saveDuties,
}
