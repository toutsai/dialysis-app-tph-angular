<!-- 檔案路徑: src/views/OrdersView.vue (新增匯出 Excel 功能版) -->
<template>
  <div class="page-container">
    <header class="page-header">
      <h1>藥囑管理</h1>
      <p>上傳並查詢病患的口服藥與針劑藥囑紀錄。</p>
    </header>

    <div class="tabs-navigation">
      <button :class="{ active: activeTab === 'query' }" @click="activeTab = 'query'">
        藥囑查詢
      </button>
      <button :class="{ active: activeTab === 'upload' }" @click="activeTab = 'upload'">
        資料上傳
      </button>
    </div>

    <main class="page-main-content">
      <!-- (A) 藥囑查詢頁籤 -->
      <div v-show="activeTab === 'query'" class="tab-panel query-panel">
        <!-- 1. 搜尋控制項 -->
        <div class="search-controls">
          <div class="search-type-toggle">
            <button :class="{ active: searchType === 'group' }" @click="searchType = 'group'">
              群組搜尋
            </button>
            <button
              :class="{ active: searchType === 'individual' }"
              @click="searchType = 'individual'"
            >
              個人搜尋
            </button>
          </div>

          <!-- 群組搜尋條件 -->
          <div v-if="searchType === 'group'" class="group-filters">
            <select v-model="groupSearchParams.freq">
              <option value="一三五">一三五</option>
              <option value="二四六">二四六</option>
              <option value="other">其他</option>
            </select>
            <select v-model="groupSearchParams.shift">
              <option value="early">早班</option>
              <option value="noon">午班</option>
              <option value="late">晚班</option>
            </select>
            <input type="month" v-model="groupSearchParams.month" />
          </div>

          <!-- 個人搜尋條件 -->
          <div v-if="searchType === 'individual'" class="individual-filters">
            <input
              type="text"
              v-model="individualSearchTerm"
              placeholder="輸入姓名或病歷號..."
              @keyup.enter="handleSearch"
            />
            <div class="year-selector">
              <button @click="changeYear(-1)">&lt; 上一年</button>
              <span>{{ individualSearchYear }} 年</span>
              <button @click="changeYear(1)">下一年 ></button>
            </div>
          </div>

          <button @click="handleSearch" :disabled="isLoading" class="search-btn">
            <i class="fas fa-search"></i> {{ isLoading ? '查詢中...' : '查詢' }}
          </button>

          <!-- ✨ 核心修改 1: 新增匯出 Excel 按鈕 -->
          <button
            @click="exportOrdersToExcel"
            :disabled="isLoading || searchResult.length === 0"
            class="export-btn"
          >
            <i class="fas fa-file-excel"></i> 匯出 Excel
          </button>
        </div>

        <!-- 2. 查詢結果顯示區 (此處結構不變) -->
        <div class="results-display">
          <div v-if="isLoading" class="loading-state">
            <div class="loading-spinner"></div>
            正在查詢藥囑資料...
          </div>
          <div v-else-if="!searchPerformed" class="placeholder-text">請選擇條件並點擊查詢。</div>
          <div v-else-if="searchResult.length === 0" class="empty-state">
            查無符合條件的藥囑資料。
          </div>
          <div v-else class="table-container">
            <!-- 群組搜尋結果表格 -->
            <table v-if="searchType === 'group'">
              <thead>
                <tr>
                  <th class="sticky-col col-freq">頻率</th>
                  <th class="sticky-col col-shift">班別</th>
                  <th class="sticky-col col-bed">床號</th>
                  <th class="sticky-col col-name">姓名</th>
                  <th v-for="med in allMedications" :key="med.code">{{ med.tradeName }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="patientRow in searchResult" :key="patientRow.patientId">
                  <td class="sticky-col col-freq">{{ patientRow.freq }}</td>
                  <td class="sticky-col col-shift">{{ formatShift(patientRow.shiftIndex) }}</td>
                  <td class="sticky-col col-bed">{{ patientRow.bedNum }}</td>
                  <td class="sticky-col col-name">{{ patientRow.patientName }}</td>
                  <td v-for="med in allMedications" :key="med.code">
                    {{ formatOrderCell(patientRow.orders[med.code]) }}
                  </td>
                </tr>
              </tbody>
            </table>

            <!-- 個人搜尋結果表格 -->
            <table v-if="searchType === 'individual'">
              <thead>
                <tr>
                  <th class="sticky-col col-month">月份</th>
                  <th v-for="med in allMedications" :key="med.code">{{ med.tradeName }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="monthRow in searchResult" :key="monthRow.month">
                  <td class="sticky-col col-month">{{ monthRow.month }}</td>
                  <td v-for="med in allMedications" :key="med.code">
                    {{ formatOrderCell(monthRow.orders[med.code]) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- (B) 資料上傳頁籤 (此處結構不變) -->
      <div v-show="activeTab === 'upload'" class="tab-panel upload-panel">
        <div class="upload-core-panel">
          <h4>批次上傳藥囑 Excel</h4>
          <div
            class="upload-drop-zone"
            :class="{ 'is-dragover': isDragOver }"
            @dragover.prevent="isDragOver = true"
            @dragleave.prevent="isDragOver = false"
            @drop.prevent="handleFileDrop"
          >
            <div class="upload-icon">💊</div>
            <h3 v-if="!selectedFile">拖曳藥囑 Excel 檔案至此，或點擊按鈕選擇</h3>
            <h3 v-else>
              已選擇檔案：<strong>{{ selectedFile.name }}</strong>
            </h3>
            <p class="upload-hint">
              支援 .xlsx, .xls 格式。請確保檔案包含 '病歷號', '醫令碼', '名稱', '異動日期' 等欄位。
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
            :class="{
              'has-error': uploadResult.errorCount > 0,
              'is-success': uploadResult.errorCount === 0,
            }"
          >
            <p>{{ uploadResult.message }}</p>
            <ul v-if="uploadResult.errors && uploadResult.errors.length > 0">
              <li v-for="(error, index) in uploadResult.errors" :key="index">
                第 {{ error.rowNumber }} 行: {{ error.reason }}
              </li>
            </ul>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed } from 'vue'
import * as XLSX from 'xlsx' // ✨ 核心修改 2: 引入 xlsx 函式庫
import { usePatientStore } from '@/stores/patientStore'
import { storeToRefs } from 'pinia'
import { useMedicationStore } from '@/stores/medicationStore'
import { formatDateToYYYYMM } from '@/utils/dateUtils.js'
import { ordersApi as localOrdersApi, baseSchedulesApi } from '@/services/localApiClient'

// --- Stores and APIs ---
const patientStore = usePatientStore()
const { opdPatients } = storeToRefs(patientStore)
const medicationStore = useMedicationStore()

// --- Component State & Parameters ---
const activeTab = ref('query')
const isLoading = ref(false)
const searchPerformed = ref(false)
const searchType = ref('group')
const groupSearchParams = reactive({
  freq: '一三五',
  shift: 'early',
  month: formatDateToYYYYMM(new Date()),
})
const individualSearchTerm = ref('')
const individualSearchYear = ref(new Date().getFullYear())
const searchResult = ref([])

// --- Medication Master Data ---
const INJECTION_MEDS_MASTER = [
  { code: 'INES2', tradeName: 'NESP', unit: 'mcg' },
  { code: 'IREC1', tradeName: 'Recormon', unit: 'KIU' },
  { code: 'IFER2', tradeName: 'Fe-back', unit: 'mg' },
  { code: 'ICAC', tradeName: 'Cacare', unit: 'amp' },
  { code: 'IPAR1', tradeName: 'Parsabiv', unit: 'mg' },
]
const ORAL_MEDS_MASTER = [
  { code: 'OCAL1', tradeName: 'A-Cal', unit: '顆' },
  { code: 'OCAA', tradeName: 'Pro-Cal', unit: '顆' },
  { code: 'OFOS4', tradeName: 'Lanclean', unit: '顆' },
  { code: 'OALK1', tradeName: 'Alkantin', unit: '顆' },
  { code: 'OVAF', tradeName: 'Vafseo', unit: '顆' },
  { code: 'OORK', tradeName: 'Orkedia', unit: '顆' },
  { code: 'OUCA1', tradeName: 'U-Ca', unit: '顆' },
]
const allMedications = computed(() => [...INJECTION_MEDS_MASTER, ...ORAL_MEDS_MASTER])

// --- Upload Tab State ---
const selectedFile = ref(null)
const isUploading = ref(false)
const uploadResult = ref(null)
const isDragOver = ref(false)

// --- Lifecycle ---
onMounted(async () => {
  await patientStore.fetchPatientsIfNeeded()
})

// --- Helper Functions ---
const SHIFT_MAP = { early: 0, noon: 1, late: 2 }
const SHIFT_INDEX_MAP = { 0: '早班', 1: '午班', 2: '晚班' }
function formatShift(shiftIndex) {
  return SHIFT_INDEX_MAP[shiftIndex] ?? 'N/A'
}

function formatOrderCell(order) {
  if (!order) return '-'
  const dose = order.dose || ''
  if (!dose) return '-'
  const masterMed = allMedications.value.find((med) => med.code === order.orderCode)
  const unit = masterMed?.unit ? ` ${masterMed.unit}` : ''
  let details = ''
  if (order.orderType === 'injection') {
    details = order.note || ''
  } else if (order.orderType === 'oral') {
    details = order.frequency || ''
  }
  if (details) {
    return `${dose}${unit} (${details})`
  }
  return `${dose}${unit}`
}

// --- Core Search Logic (此處邏輯不變) ---
async function handleSearch() {
  isLoading.value = true
  searchPerformed.value = true
  searchResult.value = []
  try {
    if (searchType.value === 'group') {
      await searchGroupOrders()
    } else {
      await searchIndividualOrders()
    }
  } catch (error) {
    console.error('查詢藥囑失敗:', error)
    alert('查詢藥囑時發生錯誤，請稍後再試。')
  } finally {
    isLoading.value = false
  }
}

async function searchGroupOrders() {
  const masterScheduleDoc = await baseSchedulesApi.fetchById('MASTER_SCHEDULE')
  const masterRules = masterScheduleDoc?.schedule || {}
  const shiftIndex = SHIFT_MAP[groupSearchParams.shift]
  const regularFreqs = ['一三五', '二四六']

  const patientList = Object.values(opdPatients.value)
    .filter((p) => {
      const rule = masterRules[p.id]
      if (!rule) return false
      const isOtherFreqSelected = groupSearchParams.freq === 'other'
      const shiftCondition = isOtherFreqSelected || rule.shiftIndex === shiftIndex
      const freqCondition = isOtherFreqSelected
        ? !regularFreqs.includes(rule.freq)
        : rule.freq === groupSearchParams.freq
      return shiftCondition && freqCondition
    })
    .map((p) => ({
      patientId: p.id,
      patientName: p.name,
      bedNum: masterRules[p.id]?.bedNum,
      freq: masterRules[p.id]?.freq,
      shiftIndex: masterRules[p.id]?.shiftIndex,
    }))

  if (patientList.length === 0) return

  const [year, month] = groupSearchParams.month.split('-').map(Number)
  const patientIds = patientList.map((p) => p.patientId)

  let allOrders = []

  // 從 injection_orders 表查詢
  const uploadMonth = groupSearchParams.month // 格式: YYYY-MM
  allOrders = await localOrdersApi.fetchInjectionOrders({ uploadMonth })
  // 過濾出符合病人清單的訂單
  allOrders = allOrders.filter((order) => patientIds.includes(order.patientId))

  const patientOrdersMap = new Map()
  patientList.forEach((p) => patientOrdersMap.set(p.patientId, { ...p, orders: {} }))

  allOrders.forEach((order) => {
    const patientData = patientOrdersMap.get(order.patientId)
    if (patientData) {
      const existingOrder = patientData.orders[order.orderCode]
      if (!existingOrder || new Date(order.changeDate) > new Date(existingOrder.changeDate)) {
        patientData.orders[order.orderCode] = order
      }
    }
  })

  searchResult.value = Array.from(patientOrdersMap.values()).sort((a, b) =>
    String(a.bedNum).localeCompare(String(b.bedNum), undefined, { numeric: true }),
  )
}

async function searchIndividualOrders() {
  const term = individualSearchTerm.value.trim().toLowerCase()
  if (!term) {
    alert('請輸入姓名或病歷號')
    return
  }
  const foundPatient = opdPatients.value.find(
    (p) => p.name.toLowerCase().includes(term) || p.medicalRecordNumber.includes(term),
  )

  if (!foundPatient) {
    searchResult.value = []
    return
  }

  const year = individualSearchYear.value
  let allYearlyOrders = []

  // 從 injection_orders 表查詢該病人整年的資料
  allYearlyOrders = await localOrdersApi.fetchInjectionOrders({
    patientId: foundPatient.id,
  })
  // 過濾出該年度的資料
  allYearlyOrders = allYearlyOrders.filter((order) => {
    const orderMonth = order.uploadMonth // 格式: YYYY-MM
    return orderMonth && orderMonth.startsWith(String(year))
  })

  const monthlyOrdersMap = new Map()
  for (let i = 1; i <= 12; i++) {
    const monthKey = `${year}-${String(i).padStart(2, '0')}`
    monthlyOrdersMap.set(monthKey, { month: monthKey, orders: {} })
  }

  allYearlyOrders.forEach((order) => {
    const monthKey = order.uploadMonth // 格式: YYYY-MM
    const monthData = monthlyOrdersMap.get(monthKey)
    if (monthData) {
      const existingOrder = monthData.orders[order.orderCode]
      if (!existingOrder || new Date(order.changeDate) > new Date(existingOrder.changeDate)) {
        monthData.orders[order.orderCode] = order
      }
    }
  })

  searchResult.value = Array.from(monthlyOrdersMap.values()).sort((a, b) =>
    b.month.localeCompare(a.month),
  )
}

function changeYear(offset) {
  individualSearchYear.value += offset
  if (individualSearchTerm.value.trim()) handleSearch()
}

// ✨ 核心修改: 這是更新後的匯出函式
function exportOrdersToExcel() {
  if (!searchResult.value || searchResult.value.length === 0) {
    alert('沒有可匯出的資料。')
    return
  }

  try {
    let title = '藥囑查詢結果'
    let headers = []
    let dataRows = []
    let sheetData = []
    let fileName = '藥囑查詢結果.xlsx'

    const medHeaders = allMedications.value.map((med) => med.tradeName)

    if (searchType.value === 'group') {
      // 處理群組搜尋的匯出
      const { freq, shift, month } = groupSearchParams
      const shiftNameMap = { early: '早班', noon: '午班', late: '晚班' }
      const shiftName = shiftNameMap[shift] || shift

      title = `藥囑查詢結果：群組 ${freq} / ${shiftName} / ${month}`
      fileName = `藥囑查詢_群組_${freq}_${shiftName}_${month}.xlsx`

      headers = ['頻率', '班別', '床號', '姓名', ...medHeaders]
      dataRows = searchResult.value.map((patientRow) => {
        const row = [
          patientRow.freq,
          formatShift(patientRow.shiftIndex),
          patientRow.bedNum,
          patientRow.patientName,
        ]
        allMedications.value.forEach((med) => {
          const order = patientRow.orders[med.code]
          row.push(formatOrderCell(order))
        })
        return row
      })
    } else {
      // searchType === 'individual'
      // 處理個人搜尋的匯出
      const patientName = individualSearchTerm.value.trim()
      const year = individualSearchYear.value

      title = `藥囑查詢結果：個人 ${patientName} / ${year} 年`
      fileName = `藥囑查詢_個人_${patientName}_${year}.xlsx`

      headers = ['月份', ...medHeaders]
      dataRows = searchResult.value.map((monthRow) => {
        const row = [monthRow.month]
        allMedications.value.forEach((med) => {
          const order = monthRow.orders[med.code]
          row.push(formatOrderCell(order))
        })
        return row
      })
    }

    // 組合最終的工作表資料：標題 + 空行 + 表頭 + 資料
    sheetData = [[title], [], headers, ...dataRows]

    const ws = XLSX.utils.aoa_to_sheet(sheetData)

    // 設定標題儲存格合併
    if (!ws['!merges']) ws['!merges'] = []
    ws['!merges'].push({ s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } })

    // 設定欄寬 (可選，但建議)
    const colWidths = headers.map((h, index) => {
      if (index < 4 && searchType.value === 'group') return { wch: 12 } // 固定欄位
      if (index === 0 && searchType.value === 'individual') return { wch: 15 } // 月份欄位
      return { wch: 20 } // 藥品欄位
    })
    ws['!cols'] = colWidths

    // 使用 Blob 觸發瀏覽器下載 (與 ConsumablesView 相同)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '藥囑查詢結果')

    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    const blob = new Blob([wbout], { type: 'application/octet-stream' })

    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = fileName
    document.body.appendChild(link)

    link.click()

    document.body.removeChild(link)
    URL.revokeObjectURL(link.href)
  } catch (error) {
    console.error('匯出 Excel 失敗:', error)
    alert('匯出 Excel 時發生錯誤，請檢查主控台。')
  }
}

// --- Upload Tab Methods (此處邏輯不變) ---
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

  isUploading.value = true
  uploadResult.value = null

  try {
    const base64Data = await toBase64(selectedFile.value)
    const fileName = selectedFile.value.name

    // 呼叫本地 API
    const result = await localOrdersApi.uploadMedications(base64Data, fileName)

    uploadResult.value = {
      message: result.message,
      processedCount: result.processedCount,
      errorCount: result.errorCount,
      errors: result.errors || [],
    }

    // 上傳成功後清除選擇的檔案
    if (result.success && result.errorCount === 0) {
      selectedFile.value = null
    }
  } catch (error) {
    console.error('上傳藥囑 Excel 失敗:', error)
    uploadResult.value = {
      message: `上傳失敗：${error.message || '未知錯誤'}`,
      errorCount: 1,
      errors: [],
    }
  } finally {
    isUploading.value = false
  }
}
</script>

<style scoped>
/* 樣式與 LabReportView.vue 非常相似 */
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
p {
  margin-top: 0.5rem;
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
}
.query-panel {
  padding: 1.5rem;
  gap: 1.5rem;
}
.search-controls {
  flex-shrink: 0;
  display: flex;
  gap: 1rem;
  align-items: center;
  flex-wrap: wrap;
  padding-bottom: 1.5rem;
  border-bottom: 1px solid #e9ecef;
}
.search-type-toggle {
  display: flex;
  border: 1px solid #007bff;
  border-radius: 6px;
  overflow: hidden;
}
.search-type-toggle button {
  background: none;
  border: none;
  padding: 0.5rem 1rem;
  cursor: pointer;
  font-weight: 500;
}
.search-type-toggle button.active {
  background-color: #007bff;
  color: white;
}
.group-filters,
.individual-filters {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}
.group-filters select,
.group-filters input,
.individual-filters input {
  padding: 0.5rem;
  border-radius: 4px;
  border: 1px solid #ccc;
  font-size: 1rem;
  height: 38px;
  box-sizing: border-box;
}
.search-btn,
.export-btn {
  /* ✨ 核心修改 4: 將 export-btn 加入樣式群組 */
  padding: 0.5rem 1.5rem;
  border-radius: 4px;
  border: 1px solid #007bff;
  background-color: #007bff;
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  height: 38px;
  box-sizing: border-box;
}
.search-btn:disabled,
.export-btn:disabled {
  /* ✨ 核心修改 4: 將 export-btn 加入樣式群組 */
  background-color: #6c757d;
  border-color: #6c757d;
  cursor: not-allowed;
}

/* ✨ 核心修改 4: 為匯出按鈕提供獨特顏色 */
.export-btn {
  background-color: #198754;
  border-color: #198754;
}

.year-selector {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.year-selector span {
  font-weight: bold;
  font-size: 1.1rem;
  width: 80px;
  text-align: center;
}
.year-selector button {
  padding: 0.5rem 1rem;
  border-radius: 4px;
  border: 1px solid #ccc;
  background-color: #f8f9fa;
  color: #333;
  cursor: pointer;
  height: 38px;
  box-sizing: border-box;
}

.results-display {
  flex-grow: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.loading-state,
.placeholder-text,
.empty-state {
  text-align: center;
  color: #6c757d;
  padding: 2rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
}
.loading-spinner {
  width: 30px;
  height: 30px;
  border: 3px solid #f3f3f3;
  border-top: 3px solid #007bff;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}
@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}
.table-container {
  flex-grow: 1;
  overflow: auto;
  border: 1px solid #dee2e6;
  border-radius: 4px;
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
.sticky-col {
  position: sticky;
  left: 0;
  z-index: 10;
  background-color: #f8f9fa;
  text-align: left;
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
.sticky-col.col-freq {
  left: 0;
  min-width: 80px;
}
.sticky-col.col-shift {
  left: 80px;
  min-width: 80px;
}
.sticky-col.col-bed {
  left: 160px;
  min-width: 80px;
}
.sticky-col.col-name {
  left: 240px;
  min-width: 120px;
}
.sticky-col.col-month {
  left: 0;
  min-width: 120px;
}

/* --- Upload Tab Styles --- */
.upload-panel {
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 1.5rem;
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
.upload-result-toast {
  width: 100%;
  padding: 1rem;
  border-radius: 6px;
  font-weight: 500;
  text-align: left;
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
.upload-result-toast ul {
  padding-left: 20px;
  margin-top: 10px;
}
</style>
