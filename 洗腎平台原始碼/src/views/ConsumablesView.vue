<!-- 檔案路徑: src/views/ConsumablesView.vue -->
<template>
  <div class="page-container">
    <header class="page-header">
      <div class="header-main-content">
        <h1>每月耗材總表</h1>
        <p class="page-description">依據排班群組查詢病患每月使用的耗材，並支援資料上傳。</p>
      </div>
    </header>

    <div class="tabs-navigation">
      <button :class="{ active: activeTab === 'query' }" @click="activeTab = 'query'">
        耗材查詢
      </button>
      <button :class="{ active: activeTab === 'upload' }" @click="activeTab = 'upload'">
        資料上傳
      </button>
    </div>

    <main class="page-main-content">
      <!-- (A) 耗材查詢頁籤 -->
      <div v-show="activeTab === 'query'" class="tab-panel query-panel">
        <div class="search-controls">
          <div class="group-filters">
            <div class="search-field">
              <!-- ✨ --- 修改點 1：簡化頻率選項 --- ✨ -->
              <label for="group-freq">頻率</label>
              <select id="group-freq" v-model="groupSearchParams.freq">
                <option value="一三五">一三五</option>
                <option value="二四六">二四六</option>
                <option value="other">其他</option>
              </select>
            </div>
            <div class="search-field">
              <label for="group-shift">班別</label>
              <select id="group-shift" v-model="groupSearchParams.shift">
                <option value="early">早班</option>
                <option value="noon">午班</option>
                <option value="late">晚班</option>
              </select>
            </div>
            <div class="search-field">
              <label for="group-month">盤點月份</label>
              <input type="month" id="group-month" v-model="groupSearchParams.month" />
            </div>
          </div>
          <button @click="handleSearch" :disabled="isLoading" class="search-btn">
            {{ isLoading ? '查詢中...' : '查詢耗材' }}
          </button>
          <button
            @click="exportConsumablesToExcel"
            :disabled="isLoading || processedData.length === 0"
            class="export-btn"
          >
            匯出 Excel
          </button>
        </div>

        <div class="report-display">
          <div v-if="isLoading" class="loading-state">正在查詢耗材資料...</div>
          <div v-else-if="!searchPerformed" class="placeholder-text">請選擇條件並點擊查詢。</div>
          <div v-else-if="processedData.length === 0" class="empty-state">
            查無符合條件的病人或耗材資料。
          </div>
          <div v-else class="table-container">
            <table>
              <thead>
                <tr>
                  <th rowspan="2" class="sticky-col col-freq">頻率</th>
                  <th rowspan="2" class="sticky-col col-shift">班別</th>
                  <th rowspan="2" class="sticky-col col-bed">床號</th>
                  <th rowspan="2" class="sticky-col col-mrn">病歷號</th>
                  <th rowspan="2" class="sticky-col col-name">姓名</th>
                  <th
                    v-if="dynamicHeaders.artificialKidney.length > 0"
                    :colspan="dynamicHeaders.artificialKidney.length"
                  >
                    人工腎臟
                  </th>
                  <th
                    v-if="dynamicHeaders.dialysateCa.length > 0"
                    :colspan="dynamicHeaders.dialysateCa.length"
                  >
                    透析藥水CA
                  </th>
                  <th
                    v-if="dynamicHeaders.bicarbonateType.length > 0"
                    :colspan="dynamicHeaders.bicarbonateType.length"
                  >
                    B液種類
                  </th>
                </tr>
                <tr>
                  <th v-for="header in flattenedHeaders" :key="header">{{ header }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in processedData" :key="row.patientId">
                  <td class="sticky-col col-freq">{{ row.freq || '-' }}</td>
                  <td class="sticky-col col-shift">{{ formatShift(row.shiftIndex) }}</td>
                  <td class="sticky-col col-bed">{{ row.bedNum || '-' }}</td>
                  <td class="sticky-col col-mrn">{{ row.medicalRecordNumber || '-' }}</td>
                  <td class="sticky-col col-name">{{ row.patientName }}</td>
                  <td v-for="header in flattenedHeaders" :key="header">
                    {{ row.consumableCounts[header] || '' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- (B) 資料上傳頁籤 (此部分無變動) -->
      <div v-show="activeTab === 'upload'" class="tab-panel upload-panel">
        <div class="upload-core-panel">
          <h4>批次上傳每月耗材 Excel</h4>
          <div
            class="upload-drop-zone"
            :class="{ 'is-dragover': isDragOver }"
            @dragover.prevent="isDragOver = true"
            @dragleave.prevent="isDragOver = false"
            @drop.prevent="handleFileDrop"
          >
            <div class="upload-icon">📤</div>
            <h3 v-if="!selectedFile">拖曳 Excel 檔案至此，或點擊按鈕選擇</h3>
            <h3 v-else>
              已選擇檔案：<strong>{{ selectedFile.name }}</strong>
            </h3>
            <p class="upload-hint">
              支援 .xlsx, .xls 格式。請確保標題行包含 '人工腎臟', '透析藥水CA', 或 'B液種類'。
            </p>
            <input
              id="file-input"
              type="file"
              @change="handleFileSelect"
              accept=".xlsx, .xls"
              :disabled="isUploading"
            />
            <label for="file-input" class="file-input-label">{{
              selectedFile ? '重新選擇檔案' : '選擇檔案'
            }}</label>
          </div>
          <button
            class="upload-btn-main"
            @click="handleUpload"
            :disabled="!selectedFile || isUploading"
          >
            {{ isUploading ? '處理中...' : '開始上傳' }}
          </button>
          <div
            v-if="uploadResult"
            class="upload-result-toast"
            :class="uploadResult.errorCount > 0 ? 'has-error' : 'is-success'"
          >
            {{ uploadResult.message }}
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup>
import { ref, onMounted, reactive, computed } from 'vue'
import * as XLSX from 'xlsx'
import { usePatientStore } from '@/stores/patientStore'
import { storeToRefs } from 'pinia'
import { formatDateToYYYYMM } from '@/utils/dateUtils.js'
import ApiManager from '@/services/api_manager'

const consumablesReportsApi = ApiManager('consumables_reports')

// --- Store & State ---
const patientStore = usePatientStore()
const { opdPatients, patientMap } = storeToRefs(patientStore)

const activeTab = ref('query')
const isLoading = ref(false)
const searchPerformed = ref(false)
const rawConsumablesData = ref([])
const processedData = ref([])

const groupSearchParams = reactive({
  freq: 'other', // 將預設改為 'other' 可能更符合使用情境
  shift: 'early',
  month: formatDateToYYYYMM(new Date()),
})

const selectedFile = ref(null)
const isUploading = ref(false)
const uploadResult = ref(null)
const isDragOver = ref(false)

// --- Constants ---
const SHIFT_MAP = { early: 0, noon: 1, late: 2 }
const SHIFT_INDEX_MAP = { 0: '早班', 1: '午班', 2: '晚班' }

// --- 動態表頭相關 (無變動) ---
const dynamicHeaders = ref({
  artificialKidney: [],
  dialysateCa: [],
  bicarbonateType: [],
})

const flattenedHeaders = computed(() => {
  return [
    ...dynamicHeaders.value.artificialKidney,
    ...dynamicHeaders.value.dialysateCa,
    ...dynamicHeaders.value.bicarbonateType,
  ]
})

// --- Methods ---

onMounted(async () => {
  await patientStore.fetchPatientsIfNeeded()
})

// ✨ --- 修改點 3：新增一個輔助函式來格式化班別 --- ✨
function formatShift(shiftIndex) {
  return SHIFT_INDEX_MAP[shiftIndex] ?? '-' // 使用 ?? 運算子處理 undefined 或 null 的情況
}

async function handleSearch() {
  isLoading.value = true
  searchPerformed.value = true
  rawConsumablesData.value = []
  processedData.value = []
  dynamicHeaders.value = { artificialKidney: [], dialysateCa: [], bicarbonateType: [] }

  try {
    // 1. 從 Pinia Store 獲取病人列表 (邏輯不變)
    const shiftIndex = SHIFT_MAP[groupSearchParams.shift]
    const regularFreqs = ['一三五', '二四六']

    const patientsInGroup = opdPatients.value.filter((p) => {
      const rule = p.scheduleRule
      if (!rule) return false
      const matchesShift = rule.shiftIndex === shiftIndex
      if (!matchesShift) return false
      if (groupSearchParams.freq === 'other') {
        return !regularFreqs.includes(rule.freq)
      } else {
        return rule.freq === groupSearchParams.freq
      }
    })

    const allPatientIdsInGroup = patientsInGroup.map((p) => p.id)

    if (allPatientIdsInGroup.length === 0) {
      isLoading.value = false
      return
    }

    // 2. 獲取原始耗材資料
    const reportMonth = groupSearchParams.month
    const reportIdsForMonth = allPatientIdsInGroup.map((id) => `${reportMonth}_${id}`)

    const reportPromises = reportIdsForMonth.map((id) =>
      consumablesReportsApi.fetchById(id).catch(() => null)
    )
    const results = await Promise.all(reportPromises)
    const monthlyReports = results.filter(Boolean)
    rawConsumablesData.value = monthlyReports

    // 3. 資料預處理 (邏輯不變)
    const reportsMap = new Map(rawConsumablesData.value.map((r) => [r.patientId, r]))
    const headers = {
      artificialKidney: new Set(),
      dialysateCa: new Set(),
      bicarbonateType: new Set(),
    }
    for (const report of reportsMap.values()) {
      const data = report.data || {}
      for (const category in headers) {
        if (data[category] && Array.isArray(data[category])) {
          data[category].forEach((item) => headers[category].add(item.item))
        }
      }
    }
    dynamicHeaders.value.artificialKidney = [...headers.artificialKidney].sort()
    dynamicHeaders.value.dialysateCa = [...headers.dialysateCa].sort()
    dynamicHeaders.value.bicarbonateType = [...headers.bicarbonateType].sort()

    // ✨ --- 修改點 4：組合資料時，增加 freq 和 shiftIndex --- ✨
    processedData.value = allPatientIdsInGroup
      .map((patientId) => {
        const patient = patientMap.value.get(patientId)
        const report = reportsMap.get(patientId)
        const consumables = report?.data || {}

        const consumableCounts = {}
        for (const header of flattenedHeaders.value) {
          for (const category in dynamicHeaders.value) {
            if (consumables[category] && Array.isArray(consumables[category])) {
              const foundItem = consumables[category].find((c) => c.item === header)
              if (foundItem) {
                consumableCounts[header] = foundItem.count
                break
              }
            }
          }
        }

        return {
          patientId: patientId,
          patientName: patient?.name || report?.patientName || '未知病人',
          medicalRecordNumber: patient?.medicalRecordNumber || report?.medicalRecordNumber || 'N/A',
          bedNum: patient?.scheduleRule?.bedNum || 'N/A',
          freq: patient?.scheduleRule?.freq || 'N/A', // 新增頻率
          shiftIndex: patient?.scheduleRule?.shiftIndex, // 新增班別索引
          consumableCounts,
        }
      })
      .sort((a, b) =>
        String(a.bedNum).localeCompare(String(b.bedNum), undefined, { numeric: true }),
      )
  } catch (error) {
    console.error('查詢耗材資料失敗:', error)
    alert('查詢耗材資料時發生錯誤，請檢查主控台。')
  } finally {
    isLoading.value = false
  }
}

// ✨ --- 最終修正版：包含「頻率」、「班別」並修正下載問題 (繁體中文註解) --- ✨
function exportConsumablesToExcel() {
  if (!processedData.value || processedData.value.length === 0) {
    alert('沒有可匯出的資料。')
    return
  }

  try {
    const { freq, shift, month } = groupSearchParams
    const shiftNameMap = { early: '早班', noon: '午班', late: '晚班' }
    const shiftName = shiftNameMap[shift] || shift
    const title = `每月耗材總表: ${freq} / ${shiftName} / ${month}`

    // 步驟 1：建立包含「頻率」和「班別」的複雜表頭
    const headerRow1 = ['頻率', '班別', '床號', '病歷號', '姓名']
    const headerRow2 = ['', '', '', '', ''] // 對應固定欄位的第二行是空的

    for (const category in dynamicHeaders.value) {
      const items = dynamicHeaders.value[category]
      if (items && Array.isArray(items) && items.length > 0) {
        const categoryName = {
          artificialKidney: '人工腎臟',
          dialysateCa: '透析藥水CA',
          bicarbonateType: 'B液種類',
        }[category]

        headerRow1.push(categoryName)
        for (let i = 1; i < items.length; i++) {
          headerRow1.push('')
        }
        items.forEach((item) => headerRow2.push(String(item || '')))
      }
    }

    // 步驟 2：建立包含「頻率」和「班別」的資料行
    const dataRows = processedData.value.map((row) => {
      const dataRow = [
        row.freq || '-',
        formatShift(row.shiftIndex), // 使用我們之前定義的 formatShift 函式
        row.bedNum || '',
        row.medicalRecordNumber || '',
        row.patientName || '',
      ]
      flattenedHeaders.value.forEach((header) => {
        const count = row.consumableCounts[header]
        dataRow.push(count !== undefined && count !== null ? count : '')
      })
      return dataRow
    })

    // 步驟 3：組合所有資料
    const sheetData = [[title], [], headerRow1, headerRow2, ...dataRows]
    const ws = XLSX.utils.aoa_to_sheet(sheetData, { skipHidden: true })

    // 步驟 4：設定合併儲存格 (已更新欄位數量)
    ws['!merges'] = []
    // 總標題合併 (現在有 5 個固定欄位)
    const totalColumnCount = flattenedHeaders.value.length + 5
    ws['!merges'].push({ s: { r: 0, c: 0 }, e: { r: 0, c: totalColumnCount - 1 } })

    // 合併 5 個固定欄位的表頭
    for (let i = 0; i < 5; i++) {
      ws['!merges'].push({ s: { r: 2, c: i }, e: { r: 3, c: i } })
    }

    // 動態合併耗材類別的表頭 (起始欄位已更新)
    let currentCol = 5
    for (const category in dynamicHeaders.value) {
      const items = dynamicHeaders.value[category]
      if (items && Array.isArray(items) && items.length > 0) {
        ws['!merges'].push({
          s: { r: 2, c: currentCol },
          e: { r: 2, c: currentCol + items.length - 1 },
        })
        currentCol += items.length
      }
    }

    // 步驟 5：使用 Blob 觸發瀏覽器下載
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '耗材總表')

    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    const blob = new Blob([wbout], { type: 'application/octet-stream' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    const fileName = `耗材總表_${freq}_${shiftName}_${month}.xlsx`
    link.download = fileName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(link.href)
  } catch (error) {
    console.error('匯出 Excel 失敗:', error)
    alert('匯出 Excel 時發生嚴重錯誤，請檢查主控台以獲取詳細資訊。')
  }
}

function handleFileSelect(event) {
  selectedFile.value = event.target.files[0]
  uploadResult.value = null
}

function handleFileDrop(event) {
  isDragOver.value = false
  const files = event.dataTransfer.files
  if (files.length > 0) {
    selectedFile.value = files[0]
    uploadResult.value = null
  }
}

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = () => resolve(reader.result.toString().replace(/^data:(.*,)?/, ''))
    reader.onerror = (error) => reject(error)
  })
}

async function handleUpload() {
  if (!selectedFile.value) {
    alert('請先選擇一個檔案！')
    return
  }

  uploadResult.value = {
    message: '離線模式下暫不支援上傳功能，請使用線上模式進行批次上傳。',
    errorCount: 1,
  }
}
</script>

<style scoped>
/* --- 複製 LabReportView 的樣式 --- */
.page-container {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 2rem);
  padding: 0.5rem;
  background-color: #f8f9fa;
}
.page-header {
  flex-shrink: 0;
  padding-bottom: 1rem;
  margin-bottom: 1rem;
  border-bottom: 1px solid #dee2e6;
}
h1 {
  font-size: 2rem;
  margin: 0;
}
.page-description {
  font-size: 1rem;
  color: #6c757d;
}
.tabs-navigation {
  display: flex;
  gap: 0.5rem;
  flex-shrink: 0;
  margin-bottom: -1px;
}
.tabs-navigation button {
  padding: 0.75rem 1.5rem;
  font-size: 1.1rem;
  font-weight: 500;
  border: 1px solid transparent;
  border-bottom: none;
  background-color: transparent;
  color: #6c757d;
  cursor: pointer;
  border-radius: 8px 8px 0 0;
  transition: all 0.2s;
}
.tabs-navigation button.active {
  background-color: #fff;
  color: #007bff;
  border-color: #dee2e6;
}
.page-main-content {
  flex-grow: 1;
  background-color: #fff;
  border: 1px solid #dee2e6;
  border-radius: 0 8px 8px 8px;
  display: flex;
  overflow: hidden;
}
.tab-panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 1.5rem;
}
.query-panel {
  gap: 1.5rem;
}
.search-controls {
  flex-shrink: 0;
  display: flex;
  gap: 1.5rem;
  align-items: flex-end;
  flex-wrap: wrap;
  padding-bottom: 1.5rem;
  border-bottom: 1px solid #e9ecef;
}
.report-display {
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.table-container {
  flex-grow: 1;
  overflow: auto;
  border: 1px solid #dee2e6;
  border-radius: 4px;
}
.group-filters {
  display: flex;
  gap: 1rem;
  align-items: flex-end;
  flex-wrap: wrap;
}
.search-field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.search-field label {
  font-weight: 500;
  font-size: 0.9rem;
  color: #495057;
}
.search-field input,
.search-field select {
  padding: 0.5rem;
  border-radius: 4px;
  border: 1px solid #ccc;
  min-width: 150px;
  height: 38px;
  box-sizing: border-box;
}
.search-btn,
.export-btn {
  padding: 0.5rem 1.5rem;
  border-radius: 4px;
  border: 1px solid #007bff;
  background-color: #007bff;
  color: white;
  cursor: pointer;
  height: 38px;
  box-sizing: border-box;
}
.export-btn {
  background-color: #198754;
  border-color: #198754;
}
.search-btn:disabled,
.export-btn:disabled {
  background-color: #6c757d;
  border-color: #6c757d;
  cursor: not-allowed;
}
.loading-state,
.placeholder-text,
.empty-state {
  text-align: center;
  color: #6c757d;
  padding: 2rem;
}
table {
  width: 100%;
  border-collapse: collapse;
}
th,
td {
  padding: 0.75rem;
  border: 1px solid #e9ecef;
  text-align: center;
  white-space: nowrap;
}
th {
  background-color: #f8f9fa;
  font-weight: 600;
  position: sticky;
  top: 0;
  z-index: 20;
}
/* 第二層表頭的 sticky 定位 */
thead tr:nth-child(2) th {
  top: 45.5px; /* 假設第一層表頭高度約為 45.5px，您可能需要微調 */
  z-index: 19;
}
.sticky-col {
  position: sticky;
  left: 0;
  z-index: 10;
  background-color: #f8f9fa;
  min-width: 80px;
}
/* ✨ --- 新增：為病歷號欄位設定 sticky 定位 --- ✨ */
.sticky-col.col-mrn {
  left: 80px; /* 床號寬度 (80px) */
  min-width: 120px;
}
/* ✨ --- 修改：更新姓名欄位的 sticky 定位 --- ✨ */
.sticky-col.col-name {
  left: 200px; /* 床號寬度 (80px) + 病歷號寬度 (120px) */
  min-width: 120px;
}
tbody .sticky-col {
  background-color: #fff;
  font-weight: bold;
}
tbody tr:nth-child(even) {
  background-color: #f8f9fa;
}
tbody tr:nth-child(even) .sticky-col {
  background-color: #f8f9fa;
}
.upload-panel {
  display: flex;
  justify-content: center;
  align-items: flex-start;
}
.upload-core-panel {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  align-items: center;
  padding: 2rem;
  width: 100%;
  max-width: 600px;
}
.upload-result-toast {
  width: 100%;
  padding: 1rem;
  border-radius: 6px;
  font-weight: 500;
  text-align: center;
}
.upload-result-toast.is-success {
  color: #155724;
  background-color: #d4edda;
  border: 1px solid #c3e6cb;
}
.upload-result-toast.has-error {
  color: #721c24;
  background-color: #f8d7da;
  border: 1px solid #f5c6cb;
}
.upload-drop-zone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2.5rem;
  border: 2px dashed #adb5bd;
  border-radius: 12px;
  background-color: #f8f9fa;
  width: 100%;
  text-align: center;
  transition: all 0.2s ease-in-out;
}
.upload-drop-zone.is-dragover {
  border-color: #007bff;
  background-color: #e7f1ff;
}
.upload-icon {
  font-size: 3rem;
  color: #007bff;
  margin-bottom: 1rem;
}
.upload-drop-zone h3 {
  margin: 0 0 0.5rem 0;
  color: #495057;
}
.upload-hint {
  color: #6c757d;
  margin: 0 0 1.5rem 0;
}
input[type='file'] {
  display: none;
}
.file-input-label {
  display: inline-block;
  padding: 0.6rem 1.2rem;
  background-color: #fff;
  border: 1px solid #6c757d;
  color: #495057;
  border-radius: 6px;
  cursor: pointer;
  margin-bottom: 1rem;
  transition: all 0.2s;
}
.file-input-label:hover {
  background-color: #e9ecef;
}
.upload-btn-main {
  padding: 0.75rem 2rem;
  font-size: 1.1rem;
  font-weight: 500;
  background-color: #007bff;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.2s;
}
.upload-btn-main:disabled {
  background-color: #6c757d;
  cursor: not-allowed;
}
.sticky-col {
  position: sticky;
  left: 0;
  z-index: 10;
  background-color: #f8f9fa;
}
.sticky-col.col-freq {
  /* 第一欄，位置為 0 */
  left: 0;
  min-width: 80px;
}
.sticky-col.col-shift {
  /* 第二欄，位置為第一欄的寬度 */
  left: 80px;
  min-width: 80px;
}
.sticky-col.col-bed {
  /* 第三欄，位置為前兩欄的寬度總和 */
  left: 160px; /* 80 + 80 */
  min-width: 80px;
}
.sticky-col.col-mrn {
  /* 第四欄 */
  left: 240px; /* 160 + 80 */
  min-width: 120px;
}
.sticky-col.col-name {
  /* 第五欄 */
  left: 360px; /* 240 + 120 */
  min-width: 120px;
}
</style>
