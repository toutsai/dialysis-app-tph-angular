<!-- 檔案路徑: src/views/LabReportView.vue (已修正，加入頻率與班別欄位) -->
<template>
  <div class="page-container">
    <header class="page-header">
      <button v-if="showBackButton" @click="router.back()" class="back-button">返回查房名單</button>
      <div class="header-main-content">
        <h1>檢驗報告管理</h1>
        <p class="page-description">
          請從HIS報表產生器>護理>個管-CKD>0240洗腎科檢驗結果病患明細-月報下載原始資料。。
        </p>
      </div>
    </header>

    <div class="tabs-navigation">
      <button :class="{ active: activeTab === 'query' }" @click="setActiveTab('query')">
        報告查詢
      </button>
      <button :class="{ active: activeTab === 'alert' }" @click="setActiveTab('alert')">
        警示報告
      </button>
      <button :class="{ active: activeTab === 'upload' }" @click="setActiveTab('upload')">
        資料上傳
      </button>
    </div>

    <main class="page-main-content">
      <!-- (A) 報告查詢頁籤 -->
      <div v-show="activeTab === 'query'" class="tab-panel query-panel">
        <button class="search-toggle-btn" @click="isSearchVisible = !isSearchVisible">
          {{ isSearchVisible ? '收合搜尋條件' : '展開搜尋條件' }}
          <span :class="['toggle-icon', { 'is-toggled': !isSearchVisible }]">▼</span>
        </button>
        <div v-show="isSearchVisible" class="search-controls">
          <div class="search-field">
            <label for="search-type">查詢模式</label>
            <select id="search-type" v-model="searchType">
              <option value="group">依群組查詢</option>
              <option value="individual">依個人查詢</option>
            </select>
          </div>
          <div v-if="searchType === 'group'" class="filter-wrapper">
            <div class="group-filters">
              <div class="search-field">
                <label for="group-freq">頻率</label>
                <select id="group-freq" v-model="groupSearchParams.freq">
                  <option value="一三五">一三五</option>
                  <option value="二四六">二四六</option>
                  <option value="other">其他</option>
                </select>
              </div>
              <div class="search-field">
                <label for="group-shift">班別</label>
                <!-- ✨ UI 優化：當頻率為 'other' 時，禁用班別選擇 -->
                <select
                  id="group-shift"
                  v-model="groupSearchParams.shift"
                  :disabled="groupSearchParams.freq === 'other'"
                >
                  <option value="early">早班</option>
                  <option value="noon">午班</option>
                  <option value="late">晚班</option>
                </select>
              </div>
              <div class="search-field">
                <label for="group-month">月份</label>
                <input type="month" id="group-month" v-model="groupSearchParams.month" />
              </div>
            </div>
            <button @click="handleSearch" :disabled="isLoadingReports" class="search-btn">
              {{ isLoadingReports ? '查詢中...' : '查詢報告' }}
            </button>
            <button
              @click="exportGroupReportToExcel"
              :disabled="isLoadingReports || reportData.length === 0"
              class="export-btn"
            >
              匯出 Excel
            </button>
          </div>
          <div v-if="searchType === 'individual'" class="filter-wrapper">
            <div class="individual-filters">
              <div class="search-field">
                <label>病人 (姓名/病歷號):</label>
                <input
                  type="text"
                  v-model="individualSearchQuery"
                  @keyup.enter="handleSearch"
                  placeholder="輸入後按 Enter..."
                />
              </div>
              <div class="year-selector">
                <button @click="changeYear(-1)">&lt; 上一年</button>
                <span>{{ individualSearchYear }} 年</span>
                <button @click="changeYear(1)">下一年 &gt;</button>
              </div>
            </div>
            <button @click="handleSearch" :disabled="isLoadingReports" class="search-btn">
              {{ isLoadingReports ? '查詢中...' : '查詢報告' }}
            </button>
          </div>
        </div>
        <div class="report-display">
          <div v-if="isLoadingReports" class="loading-state">正在查詢報告...</div>
          <div v-else-if="!searchPerformed" class="placeholder-text">請選擇條件並點擊查詢。</div>
          <div
            v-else-if="
              (searchType === 'group' && reportData.length === 0) ||
              (searchType === 'individual' && reportColumns.length === 0)
            "
            class="empty-state"
          >
            查無符合條件的報告。
          </div>
          <div v-else class="table-container">
            <!-- ✨ 更新群組查詢的表格結構 -->
            <table v-if="searchType === 'group'">
              <thead>
                <tr>
                  <th class="sticky-col col-freq">頻率</th>
                  <th class="sticky-col col-shift">班別</th>
                  <th class="sticky-col col-bed">床號</th>
                  <th class="sticky-col col-name">姓名</th>
                  <th v-for="itemKey in prioritizedLabItems" :key="itemKey">
                    {{ labItemDisplayNames[itemKey] || itemKey }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in reportData" :key="row.patientId">
                  <td class="sticky-col col-freq">{{ row.freq || '-' }}</td>
                  <td class="sticky-col col-shift">{{ formatShift(row.shiftIndex) }}</td>
                  <td class="sticky-col col-bed">{{ row.bedNum || '-' }}</td>
                  <td class="sticky-col col-name">{{ row.patientName }}</td>
                  <td v-for="itemKey in prioritizedLabItems" :key="itemKey">
                    {{ row.labData[itemKey] !== undefined ? row.labData[itemKey] : '-' }}
                  </td>
                </tr>
              </tbody>
            </table>
            <table v-if="searchType === 'individual'">
              <thead>
                <tr>
                  <th class="sticky-col">月份</th>
                  <th v-for="itemKey in prioritizedLabItems" :key="itemKey">
                    {{ labItemDisplayNames[itemKey] || itemKey }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="month in reportColumns" :key="month">
                  <td class="sticky-col">{{ month }}</td>
                  <td v-for="itemKey in prioritizedLabItems" :key="itemKey">
                    {{ reportData[itemKey]?.[month] || '-' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- (B) 警示報告頁籤 -->
      <div v-show="activeTab === 'alert'" class="tab-panel alert-panel">
        <div class="alert-controls">
          <button @click="changeAlertMonth(-1)">&lt; 前三個月</button>
          <span class="month-range-display"
            >{{ alertMonthRange.start }} ~ {{ alertMonthRange.end }}</span
          >
          <button @click="changeAlertMonth(1)">後三個月 &gt;</button>
          <button @click="exportToExcel" class="export-btn" :disabled="groupedAlerts.length === 0">
            匯出 Excel
          </button>
          <!-- ✨ 新增：儲存按鈕 -->
          <button
            @click="saveAlertAnalyses"
            class="save-btn"
            :disabled="isLoadingAlerts || groupedAlerts.length === 0"
          >
            儲存分析
          </button>
        </div>

        <div class="alert-report-display">
          <div v-if="isLoadingAlerts" class="loading-state">
            <div class="loading-spinner"></div>
            正在分析 {{ alertMonthRange.start }} 至 {{ alertMonthRange.end }} 的數據...
          </div>
          <div v-else-if="groupedAlerts.length === 0" class="empty-state">
            太棒了！此區間內沒有病人符合連續不合格的警示條件。
          </div>
          <div v-else class="grouped-tables-container">
            <div v-for="group in groupedAlerts" :key="group.key" class="alert-group">
              <h3 class="group-title">
                {{ labItemDisplayNames[group.key] || group.key }} - 不合格名單
              </h3>
              <table class="alert-table">
                <thead>
                  <tr>
                    <th>頻率</th>
                    <th>班別</th>
                    <th>床號</th>
                    <th>姓名</th>
                    <th>累積報告</th>
                    <th class="col-analysis">病因分析</th>
                    <th class="col-suggestion">建議處置</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in sortAlertItems(group.items)" :key="item.patient.id">
                    <td>{{ item.patient.freq || 'N/A' }}</td>
                    <td>{{ item.patient.defaultShift || 'N/A' }}</td>
                    <td>{{ item.patient.defaultBed || 'N/A' }}</td>
                    <!-- ✨ 修改：點擊姓名和詳情都會觸發新 Modal -->
                    <td class="clickable" @click="openAlertDetailModal(item, group.key)">
                      {{ item.patient.name }}
                    </td>
                    <td class="clickable" @click="openAlertDetailModal(item, group.key)">
                      <div v-html="formatAbnormalityReason(item.abnormality)"></div>
                    </td>
                    <!-- ✨ 修改：使用 div 顯示內容，增加可讀性 -->
                    <td>
                      <div class="analysis-cell-content">{{ item.analysisText }}</div>
                    </td>
                    <td>
                      <div class="analysis-cell-content">{{ item.suggestionText }}</div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <!-- (C) 資料上傳頁籤 - 全新結構 -->
      <div v-show="activeTab === 'upload'" class="tab-panel upload-panel expanded">
        <!-- 左側：上傳功能 -->
        <div class="upload-core-panel">
          <h4>批次上傳報告</h4>
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
            <p class="upload-hint">支援 .xlsx, .xls 格式</p>
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
          <!-- 上傳結果通知 -->
          <div
            v-if="uploadResult"
            class="upload-result-toast"
            :class="uploadResult.errorCount > 0 ? 'has-error' : 'is-success'"
          >
            {{ uploadResult.message }}
          </div>
        </div>

        <!-- 右側：手動補登功能 (已獨立) -->
        <div class="manual-entry-panel">
          <h4>手動查詢與補登缺漏報告</h4>
          <p class="panel-description">
            選擇群組與月份，系統將比對同群組病人的報告日期，找出報告筆數不足的病人。
          </p>
          <div class="manual-controls">
            <select v-model="manualEntryGroup.freq">
              <option value="一三五">一三五</option>
              <option value="二四六">二四六</option>
              <option value="other">其他</option>
            </select>
            <!-- ✨ UI 優化：手動補登區塊也同步禁用 -->
            <select v-model="manualEntryGroup.shift" :disabled="manualEntryGroup.freq === 'other'">
              <option value="early">早班</option>
              <option value="noon">午班</option>
              <option value="late">晚班</option>
            </select>
            <input type="month" v-model="manualEntryGroup.month" />
            <button @click="findMissingPatients" :disabled="isFindingMissing">
              {{ isFindingMissing ? '查詢中...' : '查詢缺漏' }}
            </button>
          </div>
          <div class="missing-patients-list">
            <div v-if="isFindingMissing" class="placeholder-item">正在從資料庫比對缺漏名單...</div>
            <div
              v-else-if="searchedForMissing && missingPatients.length === 0"
              class="placeholder-item"
            >
              太棒了！此群組在此月份沒有缺漏報告的病人。
            </div>
            <div v-else-if="missingPatients.length > 0">
              <div class="manual-entry-global-date">
                <label for="manual-report-date">所有補登報告的統一報告日：</label>
                <input type="date" id="manual-report-date" v-model="manualReportDate" />
              </div>
              <div
                v-for="patient in missingPatients"
                :key="patient.id"
                class="missing-patient-item"
              >
                <span class="patient-info"
                  >{{ patient.name }} ({{ patient.medicalRecordNumber }})
                  <span style="color: #888; font-size: 0.85em; margin-left: 0.5em;">
                    已有 {{ patient.existingCount }}/{{ patient.expectedCount }} 筆，缺: {{ patient.missingDates?.join(', ') || '全部' }}
                  </span>
                </span>
                <div class="input-grid">
                  <div v-for="item in manualEntryItems" :key="item.key" class="input-field">
                    <label>{{ item.label }}</label>
                    <input type="text" v-model="patient.labData[item.key]" />
                  </div>
                </div>
              </div>
              <button
                @click="generateAndUploadManualData"
                class="save-manual-btn"
                :disabled="isUploading"
              >
                生成 Excel 並上傳補登資料
              </button>
            </div>
            <div v-else class="placeholder-item">請選擇群組和月份，然後點擊「查詢缺漏」。</div>
          </div>
        </div>
      </div>
    </main>
    <!-- ✨ 修改：使用新的 LabAlertDetailModal 並移除舊的 -->
    <LabAlertDetailModal
      :is-visible="isAlertDetailModalVisible"
      :patient="selectedAlertItem?.patient"
      :abnormality-key="selectedAlertItem?.key"
      :initial-analysis="selectedAlertItem?.analysisText"
      :initial-suggestion="selectedAlertItem?.suggestionText"
      @close="isAlertDetailModalVisible = false"
      @confirm="handleAlertUpdate"
    />
  </div>
</template>

<script setup>
// src/views/LabReportView.vue - <script setup> 部分

import { ref, onMounted, reactive, watch, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ordersApi, labReportsApi, labAnalysesApi, baseSchedulesApi } from '@/services/localApiClient'
import * as XLSX from 'xlsx'
// ✨ 修改：引入新的 Modal
import LabAlertDetailModal from '@/components/LabAlertDetailModal.vue'
import { usePatientStore } from '@/stores/patientStore'
import { storeToRefs } from 'pinia'
// ✨ 新增：從 constants 引入 LAB_ITEM_DISPLAY_NAMES
import { LAB_ITEM_DISPLAY_NAMES } from '@/constants/labAlertConstants.js'
// 引入 dateUtils 函數
import { formatDateToYYYYMM, formatDateToYYYYMMDD } from '@/utils/dateUtils.js'
import { escapeHtml } from '@/utils/sanitize.js'

const patientStore = usePatientStore()
const { allPatients, patientMap } = storeToRefs(patientStore)
const route = useRoute()
const router = useRouter()
const showBackButton = ref(false)
const activeTab = ref('query')
const isSearchVisible = ref(true)
const selectedFile = ref(null)
const isUploading = ref(false)
const uploadResult = ref(null)
const isDragOver = ref(false)
const isFindingMissing = ref(false)
const manualEntryGroup = reactive({
  freq: '一三五',
  shift: 'early',
  month: formatDateToYYYYMM(new Date()),
})
const missingPatients = ref([])
const searchedForMissing = ref(false)
const manualReportDate = ref(formatDateToYYYYMMDD(new Date()))

const manualEntryItems = [
  { key: 'WBC', label: '白血球' },
  { key: 'Hb', label: '血色素' },
  { key: 'Platelet', label: '血小板' },
  { key: 'BUN', label: 'BUN(Blood)' },
  { key: 'Creatinine', label: '肌酐、血(洗腎專用)' },
  { key: 'Albumin', label: '白蛋白(BCG法)' },
  { key: 'Na', label: '血中鈉' },
  { key: 'K', label: '血中鉀' },
  { key: 'Ca', label: 'Calcium(Blood)' },
  { key: 'P', label: '磷' },
  { key: 'Iron', label: 'Iron' },
  { key: 'TIBC', label: '總鐵結合能力TIBC' },
  { key: 'Ferritin', label: '鐵蛋白' },
  { key: 'iPTH', label: '副甲狀腺素' },
  { key: 'PostBUN', label: '血中尿素氮(洗後專用)' },
]

const searchType = ref('group')
const groupSearchParams = reactive({
  freq: '一三五',
  shift: 'early',
  month: formatDateToYYYYMM(new Date()),
})
const individualSearchQuery = ref('')
const individualSearchYear = ref(new Date().getFullYear())
const isLoadingReports = ref(false)
const searchPerformed = ref(false)
const reportData = ref([])
const reportColumns = ref([])

const isLoadingAlerts = ref(false)
const alertList = ref([])
const alertCurrentMonth = ref(new Date())
const CONSECUTIVE_ABNORMAL_CRITERIA = {
  Hb: { max: 8.5 },
  Albumin: { max: 3.5 },
  URR: { max: 65 },
  CaXP: { min: 60 },
}

// ✨ 新增：Modal 相關狀態
const isAlertDetailModalVisible = ref(false)
const selectedAlertItem = ref(null)

const SHIFT_MAP = { early: 0, noon: 1, late: 2 }
const SHIFT_INDEX_MAP = { 0: '早班', 1: '午班', 2: '晚班' }

const FREQ_CUSTOM_ORDER = {
  一四: 10,
  二五: 11,
  三六: 12,
  一五: 13,
  二六: 14,
  一: 20,
  二: 21,
  三: 22,
  四: 23,
  五: 24,
  六: 25,
  日: 26,
  每日: 30,
}

const prioritizedLabItems = [
  'WBC',
  'Platelet',
  'Hb',
  'Ferritin',
  'TSAT',
  'GlucoseAC',
  'Triglyceride',
  'LDL',
  'Albumin',
  'ALT',
  'Na',
  'K',
  'P',
  'Ca',
  'CaXP',
  'iPTH',
  'BUN',
  'PostBUN',
  'Creatinine',
  'Kt/V',
  'URR',
]
const labItemDisplayNames = ref(LAB_ITEM_DISPLAY_NAMES)

// labReportsApi, labAnalysesApi, baseSchedulesApi 已從 localApiClient import

const alertMonthRange = computed(() => {
  const end = new Date(alertCurrentMonth.value)
  const start = new Date(alertCurrentMonth.value)
  start.setMonth(start.getMonth() - 2)
  const formatDate = (date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  return { start: formatDate(start), end: formatDate(end) }
})

const groupedAlerts = computed(() => {
  const groups = {}
  alertList.value.forEach((item) => {
    item.abnormalities.forEach((abnormality) => {
      const key = abnormality.key
      if (!groups[key]) {
        groups[key] = { key: key, items: [] }
      }
      // ✨ 修改：確保 item 包含 analysisText 和 suggestionText
      groups[key].items.push({
        patient: item.patient,
        abnormality: abnormality,
        analysisText: item.analysisTexts?.[key] || '',
        suggestionText: item.suggestionTexts?.[key] || '',
      })
    })
  })
  return Object.values(groups).sort((a, b) => a.key.localeCompare(b.key))
})

const FREQ_ORDER = { 一三五: 1, 二四六: 2, 一四: 3, 二五: 4, 三六: 5, 一五: 6, 二六: 7 }

function formatShift(shiftIndex) {
  return SHIFT_INDEX_MAP[shiftIndex] ?? 'N/A'
}

function sortAlertItems(items) {
  return [...items].sort((a, b) => {
    const freqA = FREQ_ORDER[a.patient.freq] || 99
    const freqB = FREQ_ORDER[b.patient.freq] || 99
    if (freqA !== freqB) return freqA - freqB
    const shiftA = a.patient.shiftIndex ?? 99
    const shiftB = b.patient.shiftIndex ?? 99
    if (shiftA !== shiftB) return shiftA - shiftB
    return String(a.patient.defaultBed).localeCompare(String(b.patient.defaultBed), undefined, {
      numeric: true,
    })
  })
}

function formatAbnormalityReason(abnormality) {
  if (!abnormality || !abnormality.values || abnormality.values.length < 3) {
    // ✨ XSS 防護：對原因進行轉義
    return escapeHtml(abnormality.reason || 'N/A')
  }

  // 確保月份是按時間順序排列的
  const sortedValues = [...abnormality.values].sort((a, b) => a.month.localeCompare(b.month))

  // ✨ XSS 防護：對月份和數值進行轉義
  const monthsHtml = sortedValues
    .map((item) => `${parseInt(item.month.split('-')[1], 10)}月`)
    .join(' → ')

  const valuesHtml = sortedValues.map((item) => escapeHtml(String(item.value))).join(' → ')

  // 趨勢判斷邏輯
  const firstValue = parseFloat(sortedValues[0].value)
  const lastValue = parseFloat(sortedValues[sortedValues.length - 1].value)
  let trendIndicator = ''
  let trendClass = 'trend-stable'

  // 定義哪些項目升高是惡化
  const worseningIfIncreased = ['CaXP']
  // 定義哪些項目降低是惡化
  const worseningIfDecreased = ['Hb', 'Albumin', 'URR']

  if (lastValue > firstValue) {
    trendIndicator = '▲'
    trendClass = worseningIfIncreased.includes(abnormality.key) ? 'is-worsening' : 'is-improving'
  } else if (lastValue < firstValue) {
    trendIndicator = '▼'
    trendClass = worseningIfDecreased.includes(abnormality.key) ? 'is-worsening' : 'is-improving'
  } else {
    trendIndicator = '―'
  }

  const indicatorHtml = `<span class="trend-indicator ${trendClass}">${trendIndicator}</span>`

  // 生成最終的 HTML 結構
  return `
    <div class="abnormality-details">
      <div class="months-row">${monthsHtml}</div>
      <div class="values-row">${valuesHtml} ${indicatorHtml}</div>
    </div>
  `
}

function setActiveTab(tabName) {
  activeTab.value = tabName
  if (tabName === 'alert' && alertList.value.length === 0 && !isLoadingAlerts.value) {
    generateAlertReport()
  }
}

function changeAlertMonth(monthOffset) {
  alertCurrentMonth.value.setMonth(alertCurrentMonth.value.getMonth() + monthOffset)
  alertCurrentMonth.value = new Date(alertCurrentMonth.value)
  generateAlertReport()
}

async function generateAlertReport() {
  isLoadingAlerts.value = true
  alertList.value = []
  try {
    await patientStore.fetchPatientsIfNeeded()
    const allOpdPatients = patientStore.opdPatients

    const range = alertMonthRange.value
    const startDateStr = range.start + '-01'
    const endDate = new Date(range.end + '-01')
    endDate.setMonth(endDate.getMonth() + 1)
    const endDateStr = endDate.toISOString().slice(0, 10)
    const scheduleDoc = await baseSchedulesApi.fetchById('MASTER_SCHEDULE')
    const scheduleRules = scheduleDoc?.schedule || {}

    for (const patient of allOpdPatients) {
      const reports = await labReportsApi.fetchAll({
        patientId: patient.id,
        startDate: startDateStr,
        endDate: endDateStr,
      })
      if (reports.length < 3) continue
      const cleanedReports = reports.map((r) => ({
        ...r,
        reportDate: r.reportDate.toDate
          ? r.reportDate.toDate().toISOString().slice(0, 10)
          : r.reportDate,
      }))
      const { processedData, months } = processReports(cleanedReports)
      const requiredMonths = [
        alertMonthRange.value.end,
        new Date(
          new Date(alertMonthRange.value.end + '-01').setMonth(
            new Date(alertMonthRange.value.end + '-01').getMonth() - 1,
          ),
        )
          .toISOString()
          .slice(0, 7),
        alertMonthRange.value.start,
      ]
      if (!requiredMonths.every((m) => months.includes(m))) continue
      const abnormalities = findAbnormalities(processedData, requiredMonths)
      if (abnormalities.length > 0) {
        const scheduleInfo = scheduleRules[patient.id]
        const patientDataForReport = { ...patient } // Create a copy
        patientDataForReport.shiftIndex = scheduleInfo?.shiftIndex
        patientDataForReport.defaultShift = ['早', '午', '晚'][scheduleInfo?.shiftIndex] || 'N/A'
        patientDataForReport.defaultBed = scheduleInfo?.bedNum || 'N/A'

        // ✨ 新增：初始化儲存分析的物件
        alertList.value.push({
          patient: patientDataForReport,
          abnormalities,
          analysisTexts: {},
          suggestionTexts: {},
        })
      }
    }

    // ✨ 新增：讀取已儲存的分析資料並回填
    const patientIdsInList = alertList.value.map((item) => item.patient.id)
    if (patientIdsInList.length > 0) {
      const monthRangeKey = `${alertMonthRange.value.start}_${alertMonthRange.value.end}`
      const savedAnalyses = await labAnalysesApi.fetchAll({ monthRange: monthRangeKey })

      // 過濾出屬於當前病人列表的分析
      const relevantAnalyses = savedAnalyses.filter((analysis) =>
        patientIdsInList.includes(analysis.patientId),
      )

      relevantAnalyses.forEach((analysis) => {
        const targetItem = alertList.value.find((item) => item.patient.id === analysis.patientId)
        if (targetItem) {
          targetItem.analysisTexts[analysis.abnormalityKey] = analysis.analysis
          targetItem.suggestionTexts[analysis.abnormalityKey] = analysis.suggestion
        }
      })
    }
  } catch (error) {
    console.error('生成警示報告失敗:', error)
    alert('生成警示報告時發生錯誤，請檢查主控台。')
  } finally {
    isLoadingAlerts.value = false
  }
}

function processReports(rawReports) {
  const data = {}
  const monthSet = new Set()
  rawReports.forEach((report) => {
    const monthKey = report.reportDate.slice(0, 7)
    monthSet.add(monthKey)
    for (const itemKey in report.data) {
      if (!data[itemKey]) data[itemKey] = {}
      data[itemKey][monthKey] = report.data[itemKey]
    }
  })
  const reportMonths = Array.from(monthSet).sort().reverse()
  for (const monthKey of reportMonths) {
    const bun = data['BUN']?.[monthKey]
    const postBun = data['PostBUN']?.[monthKey]
    const ca = data['Ca']?.[monthKey]
    const p = data['P']?.[monthKey]
    const iron = data['Iron']?.[monthKey]
    const tibc = data['TIBC']?.[monthKey]
    if (ca && p) {
      if (!data['CaXP']) data['CaXP'] = {}
      data['CaXP'][monthKey] = (ca * p).toFixed(2)
    }
    if (iron && tibc > 0) {
      if (!data['TSAT']) data['TSAT'] = {}
      data['TSAT'][monthKey] = ((iron / tibc) * 100).toFixed(1)
    }
    if (bun && postBun > 0) {
      if (!data['URR']) data['URR'] = {}
      if (!data['Kt/V']) data['Kt/V'] = {}
      data['URR'][monthKey] = (((bun - postBun) / bun) * 100).toFixed(1)
      data['Kt/V'][monthKey] = Math.log(bun / postBun).toFixed(2)
    }
  }
  return { processedData: data, months: reportMonths }
}

function findAbnormalities(processedData, months) {
  const abnormalities = []
  if (months.length < 3) return abnormalities
  const last3MonthsSorted = [...months.slice(0, 3)].sort()
  for (const key in CONSECUTIVE_ABNORMAL_CRITERIA) {
    const valuesWithMonths = last3MonthsSorted.map((month) => ({
      month: month,
      value: processedData[key]?.[month],
    }))
    if (valuesWithMonths.some((item) => item.value === undefined)) continue
    const rule = CONSECUTIVE_ABNORMAL_CRITERIA[key]
    const isValueAbnormal = (v) => {
      if (rule.max !== undefined && v < rule.max) return true
      if (rule.min !== undefined && v > rule.min) return true
      return false
    }
    const allAbnormal = valuesWithMonths.every((item) => isValueAbnormal(item.value))
    if (allAbnormal) {
      abnormalities.push({
        key,
        values: valuesWithMonths.map((item) => ({ month: item.month, value: item.value })),
      })
    }
  }
  return abnormalities
}

// ✨ 新增：開啟新 Modal 的方法
function openAlertDetailModal(item, key) {
  selectedAlertItem.value = { ...item, key }
  isAlertDetailModalVisible.value = true
}

// ✨ 新增：處理 Modal 回傳資料的方法
function handleAlertUpdate({ analysisText, suggestionText }) {
  if (!selectedAlertItem.value) return

  const { patient, key } = selectedAlertItem.value

  const targetItem = alertList.value.find((item) => item.patient.id === patient.id)
  if (targetItem) {
    targetItem.analysisTexts[key] = analysisText
    targetItem.suggestionTexts[key] = suggestionText
  }
}

// ✨ 新增：儲存分析資料的方法
async function saveAlertAnalyses() {
  if (!confirm('您確定要儲存目前所有的病因分析與建議處置嗎？此操作將會覆蓋先前的儲存。')) {
    return
  }

  isLoadingAlerts.value = true
  try {
    const promises = []
    const monthRangeKey = `${alertMonthRange.value.start}_${alertMonthRange.value.end}`

    alertList.value.forEach((item) => {
      const patientId = item.patient.id
      // 遍歷該病患所有不合格的項目
      item.abnormalities.forEach((abnormality) => {
        const key = abnormality.key
        const analysis = item.analysisTexts[key] || ''
        const suggestion = item.suggestionTexts[key] || ''

        // 只有在有內容時才儲存
        if (analysis || suggestion) {
          const docId = `${patientId}_${key}_${monthRangeKey}`
          const dataToSave = {
            patientId: patientId,
            patientName: item.patient.name,
            abnormalityKey: key,
            monthRange: monthRangeKey,
            analysis: analysis,
            suggestion: suggestion,
            updatedAt: new Date(),
          }
          // 使用 save (set with merge) 來新增或更新
          promises.push(labAnalysesApi.save(docId, dataToSave))
        }
      })
    })

    await Promise.all(promises)
    alert('分析儲存成功！')
  } catch (error) {
    console.error('儲存分析失敗:', error)
    alert(`儲存失敗: ${error.message}`)
  } finally {
    isLoadingAlerts.value = false
  }
}

function exportToExcel() {
  if (groupedAlerts.value.length === 0) {
    alert('目前沒有可匯出的警示報告資料。')
    return
  }
  const wb = XLSX.utils.book_new()
  const { start, end } = alertMonthRange.value
  groupedAlerts.value.forEach((group) => {
    const title = `警示報告 (${labItemDisplayNames.value[group.key] || group.key}) - 區間: ${start} ~ ${end}`
    const headers = [
      '頻率',
      '預設班別',
      '預設床號',
      '姓名',
      '不合格項目詳情',
      '病因分析',
      '建議處置',
    ]
    const sortedItems = sortAlertItems(group.items)
    // ✨ 修改：加入 analysisText 和 suggestionText
    const dataRows = sortedItems.map((item) => [
      item.patient.freq || 'N/A',
      item.patient.defaultShift || 'N/A',
      item.patient.defaultBed || 'N/A',
      item.patient.name,
      formatAbnormalityReason(item.abnormality),
      item.analysisText,
      item.suggestionText,
    ])
    const sheetData = [[title], [], headers, ...dataRows]
    const ws = XLSX.utils.aoa_to_sheet(sheetData)
    const numCols = headers.length
    if (!ws['!merges']) ws['!merges'] = []
    ws['!merges'].push({ s: { r: 0, c: 0 }, e: { r: 0, c: numCols - 1 } })
    ws['!cols'] = [
      { wch: 8 },
      { wch: 10 },
      { wch: 10 },
      { wch: 12 },
      { wch: 30 },
      { wch: 40 },
      { wch: 40 },
    ]
    const sheetName = (labItemDisplayNames.value[group.key] || group.key).replace(/[%()/]/g, '')
    XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31))
  })
  const fileName = `警示報告_${start}_${end}.xlsx`
  XLSX.writeFile(wb, fileName)
}

async function findMissingPatients() {
  if (!manualEntryGroup.month) {
    alert('請先選擇要查詢的月份。')
    return
  }
  isFindingMissing.value = true
  searchedForMissing.value = true
  missingPatients.value = []
  try {
    const shiftIndex = SHIFT_MAP[manualEntryGroup.shift]
    const masterScheduleDoc = await baseSchedulesApi.fetchById('MASTER_SCHEDULE')
    const masterRules = masterScheduleDoc?.schedule || {}

    const regularFreqs = ['一三五', '二四六']
    const allPatientIdsInGroup = Object.keys(masterRules).filter((id) => {
      const rule = masterRules[id]
      if (!rule) return false

      const isOtherFreqSelected = manualEntryGroup.freq === 'other'
      const shiftCondition = isOtherFreqSelected || rule.shiftIndex === shiftIndex
      const freqCondition = isOtherFreqSelected
        ? !regularFreqs.includes(rule.freq)
        : rule.freq === manualEntryGroup.freq

      return shiftCondition && freqCondition
    })

    if (allPatientIdsInGroup.length === 0) {
      return
    }
    const [year, month] = manualEntryGroup.month.split('-').map(Number)
    const startDateStr = `${year}-${String(month).padStart(2, '0')}-01`
    const endDate = new Date(year, month, 1)
    const endDateStr = endDate.toISOString().slice(0, 10)

    // 獲取該月份的所有相關報告
    const reportsInMonth = await labReportsApi.fetchAll({
      startDate: startDateStr,
      endDate: endDateStr,
    })
    // 過濾出屬於該群組病人的報告
    const relevantReports = reportsInMonth.filter((report) =>
      allPatientIdsInGroup.includes(report.patientId),
    )

    // 統計每位病人擁有的不重複報告日期數
    const patientReportDates = new Map()
    allPatientIdsInGroup.forEach((id) => patientReportDates.set(id, new Set()))
    relevantReports.forEach((report) => {
      if (patientReportDates.has(report.patientId)) {
        patientReportDates.get(report.patientId).add(report.reportDate)
      }
    })

    // 計算群組中的最大報告日期數（即多數人應有的筆數）
    const reportCounts = Array.from(patientReportDates.values()).map((dates) => dates.size)
    const maxReportCount = Math.max(...reportCounts, 0)

    if (maxReportCount === 0) {
      // 整個群組都沒有報告，全部列出
    }

    // 找出報告日期數少於最大值的病人（即有缺漏的）
    const missingIds = allPatientIdsInGroup.filter((id) => {
      const count = patientReportDates.get(id)?.size || 0
      return count < maxReportCount
    })
    if (missingIds.length === 0) {
      return
    }

    // 找出缺漏的具體日期，供補登參考
    const allReportDates = new Set()
    relevantReports.forEach((report) => {
      if (allPatientIdsInGroup.includes(report.patientId)) {
        allReportDates.add(report.reportDate)
      }
    })

    // 從 patientStore 獲取缺漏病人的詳細資料
    const missingPatientDetails = missingIds
      .map((id) => {
        const p = patientMap.value.get(id)
        if (!p) return null
        const ownDates = patientReportDates.get(id) || new Set()
        const missingDates = Array.from(allReportDates).filter((d) => !ownDates.has(d)).sort()
        return {
          id: p.id,
          name: p.name,
          medicalRecordNumber: p.medicalRecordNumber,
          existingCount: ownDates.size,
          expectedCount: maxReportCount,
          missingDates,
        }
      })
      .filter(Boolean)
    missingPatients.value = missingPatientDetails.map((patientData) => {
      const labData = {}
      manualEntryItems.forEach((item) => {
        labData[item.key] = ''
      })
      return {
        id: patientData.id,
        name: patientData.name,
        medicalRecordNumber: patientData.medicalRecordNumber,
        labData: reactive(labData),
      }
    })
  } catch (error) {
    console.error('查找缺漏病人失敗:', error)
    alert('查找缺漏病人時發生錯誤。')
  } finally {
    isFindingMissing.value = false
  }
}

async function generateAndUploadManualData() {
  if (!manualReportDate.value) {
    alert('請選擇所有補登報告的統一報告日。')
    return
  }
  const formattedDate = manualReportDate.value.replace(/-/g, '')
  const dataToUpload = []
  missingPatients.value.forEach((patient) => {
    manualEntryItems.forEach((item) => {
      const value = patient.labData[item.key]
      if (value !== null && value !== '') {
        dataToUpload.push({
          病歷號: patient.medicalRecordNumber,
          報告日: formattedDate,
          細項名稱: item.label,
          結果: value,
        })
      }
    })
  })
  if (dataToUpload.length === 0) {
    alert('沒有可上傳的補登資料。請至少為一位病人填寫一項數據。')
    return
  }
  try {
    const ws = XLSX.utils.json_to_sheet(dataToUpload)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'ManualEntry')
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    const blob = new Blob([wbout], { type: 'application/octet-stream' })
    const fileName = `manual_entry_${formatDateToYYYYMMDD(new Date())}.xlsx`
    const mockFile = new File([blob], fileName, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    selectedFile.value = mockFile
    await handleUpload()
    missingPatients.value = []
    searchedForMissing.value = false
  } catch (error) {
    console.error('生成或上傳手動資料失敗:', error)
    alert('處理手動補登資料時發生錯誤。')
  }
}

onMounted(async () => {
  await patientStore.fetchPatientsIfNeeded()

  const patientIdFromQuery = route.query.patientId
  const tabFromQuery = route.query.tab
  if (patientIdFromQuery) {
    showBackButton.value = true
    setActiveTab('query')
    searchType.value = 'individual'
    isSearchVisible.value = true
    const patient = patientStore.patientMap.get(patientIdFromQuery)
    if (patient) {
      individualSearchQuery.value = patient.name
      handleSearch()
    }
  } else if (tabFromQuery === 'alert') {
    setActiveTab('alert')
  } else if (window.innerWidth <= 768) {
    isSearchVisible.value = false
  }
})

function handleFileSelect(event) {
  selectedFile.value = event.target.files[0]
  uploadResult.value = null
}

async function handleUpload() {
  if (!selectedFile.value) {
    alert('請先選擇一個檔案！')
    return
  }

  isUploading.value = true
  uploadResult.value = null

  try {
    // 將檔案轉換為 Base64
    const base64Data = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const base64 = reader.result.split(',')[1]
        resolve(base64)
      }
      reader.onerror = reject
      reader.readAsDataURL(selectedFile.value)
    })

    // 呼叫本地 API 上傳
    const result = await ordersApi.uploadLabReports(base64Data, selectedFile.value.name)

    uploadResult.value = {
      message: result.message,
      errorCount: result.errorCount || 0,
      processedCount: result.processedCount || 0,
      errors: result.errors || [],
    }

    // 清除已選檔案
    if (result.processedCount > 0) {
      selectedFile.value = null
    }
  } catch (error) {
    console.error('上傳檢驗報告失敗:', error)
    uploadResult.value = {
      message: `上傳失敗: ${error.message || '未知錯誤'}`,
      errorCount: 1,
    }
  } finally {
    isUploading.value = false
  }
}

async function handleSearch() {
  isLoadingReports.value = true
  searchPerformed.value = true
  if (window.innerWidth <= 768) {
    isSearchVisible.value = false
  }
  try {
    await patientStore.fetchPatientsIfNeeded()
    if (searchType.value === 'group') {
      await searchGroupReports()
    } else {
      await searchIndividualReports()
    }
  } catch (error) {
    console.error('查詢報告失敗:', error)
    if (searchType.value === 'group') {
      reportData.value = []
    } else {
      reportData.value = {}
    }
    alert(error.message)
  } finally {
    isLoadingReports.value = false
  }
}
watch(searchType, (newType) => {
  searchPerformed.value = false
  reportColumns.value = []
  if (newType === 'group') {
    reportData.value = []
  } else {
    reportData.value = {}
  }
})

async function searchGroupReports() {
  // 1. 篩選出符合條件的病人
  const masterScheduleDoc = await baseSchedulesApi.fetchById('MASTER_SCHEDULE')
  const masterRules = masterScheduleDoc?.schedule || {}
  const shiftIndex = SHIFT_MAP[groupSearchParams.shift]
  const regularFreqs = ['一三五', '二四六']
  const patientIdsInGroup = Object.keys(masterRules).filter((id) => {
    const rule = masterRules[id]
    if (!rule) return false
    const isOtherFreqSelected = groupSearchParams.freq === 'other'
    const shiftCondition = isOtherFreqSelected || rule.shiftIndex === shiftIndex
    const freqCondition = isOtherFreqSelected
      ? !regularFreqs.includes(rule.freq)
      : rule.freq === groupSearchParams.freq
    return shiftCondition && freqCondition
  })

  if (patientIdsInGroup.length === 0) {
    reportData.value = []
    return
  }

  // 2. 建立一個包含完整排班資訊的病人列表
  const patientList = patientIdsInGroup
    .map((id) => {
      const info = patientMap.value.get(id)
      const rule = masterRules[id]
      return info
        ? {
            patientId: id,
            patientName: info.name,
            bedNum: rule.bedNum,
            freq: rule.freq,
            shiftIndex: rule.shiftIndex,
          }
        : null
    })
    .filter(Boolean)

  if (patientList.length === 0) {
    reportData.value = []
    return
  }

  // 3. 獲取該月份的所有相關報告
  const [year, month] = groupSearchParams.month.split('-').map(Number)
  const startDateStr = `${year}-${String(month).padStart(2, '0')}-01`
  const endDate = new Date(year, month, 1)
  const endDateStr = endDate.toISOString().slice(0, 10)

  // 獲取該月份的所有報告
  const allReports = await labReportsApi.fetchAll({
    startDate: startDateStr,
    endDate: endDateStr,
  })
  // 過濾出屬於該群組病人的報告
  const allReportsInMonth = allReports.filter((report) =>
    patientIdsInGroup.includes(report.patientId),
  )

  // 4. 將報告聚合到每個病人底下
  const aggregatedReports = new Map()
  allReportsInMonth.forEach((report) => {
    const patientId = report.patientId
    if (!aggregatedReports.has(patientId)) {
      aggregatedReports.set(patientId, {})
    }
    const patientLabData = aggregatedReports.get(patientId)
    // 簡單的聚合邏輯：後來的數據會覆蓋先前的 (因為通常一個月只會有一份報告)
    Object.assign(patientLabData, report.data)
  })

  // 5. 組合最終的表格資料並排序
  reportData.value = patientList
    .map((p) => {
      const labData = aggregatedReports.get(p.patientId) || {}
      if (labData.Ca && labData.P) labData.CaXP = (labData.Ca * labData.P).toFixed(2)
      if (labData.Iron && labData.TIBC > 0)
        labData.TSAT = ((labData.Iron / labData.TIBC) * 100).toFixed(1)
      if (labData.BUN && labData.PostBUN > 0 && labData.BUN > 0) {
        labData.URR = (((labData.BUN - labData.PostBUN) / labData.BUN) * 100).toFixed(1)
        labData['Kt/V'] = Math.log(labData.BUN / labData.PostBUN).toFixed(2)
      }
      return { ...p, labData }
    })
    .sort((a, b) => {
      if (groupSearchParams.freq === 'other') {
        const orderA = FREQ_CUSTOM_ORDER[a.freq] || 99
        const orderB = FREQ_CUSTOM_ORDER[b.freq] || 99
        if (orderA !== orderB) return orderA - orderB
        const shiftA = a.shiftIndex ?? 99
        const shiftB = b.shiftIndex ?? 99
        if (shiftA !== shiftB) return shiftA - shiftB
      }
      return String(a.bedNum).localeCompare(String(b.bedNum), undefined, { numeric: true })
    })
}

async function searchIndividualReports() {
  if (!individualSearchQuery.value.trim()) return
  const query = individualSearchQuery.value.trim().toLowerCase()

  const foundPatient = allPatients.value.find(
    (p) =>
      p.medicalRecordNumber?.toLowerCase().includes(query) || p.name?.toLowerCase().includes(query),
  )
  if (!foundPatient) throw new Error(`找不到病人: ${individualSearchQuery.value}`)

  const year = individualSearchYear.value
  const startDateStr = `${year}-01-01`
  const endDateStr = `${year + 1}-01-01`

  // 使用本地 API 獲取報告
  const reports = await labReportsApi.fetchAll({
    patientId: foundPatient.id,
    startDate: startDateStr,
    endDate: endDateStr,
  })
  const reportsRaw = reports.map((report) => {
    if (report.reportDate && typeof report.reportDate === 'string') {
      // 確保日期格式正確
      report.reportDate = report.reportDate.slice(0, 10)
    } else if (report.reportDate?.toDate) {
      report.reportDate = report.reportDate.toDate().toISOString().slice(0, 10)
    }
    return report
  })

  const processedData = {}
  const monthSet = new Set()
  for (let i = 1; i <= 12; i++) {
    monthSet.add(`${year}-${String(i).padStart(2, '0')}`)
  }

  reportsRaw.forEach((report) => {
    const monthKey = report.reportDate.slice(0, 7)
    const labData = report.data
    for (const itemKey in labData) {
      if (!processedData[itemKey]) {
        processedData[itemKey] = {}
      }
      if (!processedData[itemKey][monthKey]) {
        processedData[itemKey][monthKey] = labData[itemKey]
      }
    }
  })

  for (const monthKey of monthSet) {
    const bun = processedData['BUN']?.[monthKey]
    const postBun = processedData['PostBUN']?.[monthKey]
    const ca = processedData['Ca']?.[monthKey]
    const p = processedData['P']?.[monthKey]
    const iron = processedData['Iron']?.[monthKey]
    const tibc = processedData['TIBC']?.[monthKey]
    if (ca && p) {
      if (!processedData['CaXP']) processedData['CaXP'] = {}
      processedData['CaXP'][monthKey] = (ca * p).toFixed(2)
    }
    if (iron && tibc > 0) {
      if (!processedData['TSAT']) processedData['TSAT'] = {}
      processedData['TSAT'][monthKey] = ((iron / tibc) * 100).toFixed(1)
    }
    if (bun && postBun > 0) {
      if (!processedData['URR']) processedData['URR'] = {}
      if (!processedData['Kt/V']) processedData['Kt/V'] = {}
      processedData['URR'][monthKey] = (((bun - postBun) / bun) * 100).toFixed(1)
      processedData['Kt/V'][monthKey] = Math.log(bun / postBun).toFixed(2)
    }
  }

  reportData.value = processedData
  reportColumns.value = Array.from(monthSet).sort().reverse()
}

function changeYear(offset) {
  individualSearchYear.value += offset
  if (individualSearchQuery.value.trim()) handleSearch()
}
function handleFileDrop(event) {
  isDragOver.value = false
  const files = event.dataTransfer.files
  if (files.length > 0) {
    selectedFile.value = files[0]
    uploadResult.value = null
  }
}

function exportGroupReportToExcel() {
  if (searchType.value !== 'group' || reportData.value.length === 0) {
    alert('目前沒有可匯出的群組報告資料。')
    return
  }
  const { freq, shift, month } = groupSearchParams

  let title = ''
  let fileNameIdentifier = ''

  if (freq === 'other') {
    title = `檢驗報告查詢結果: 其他頻率 (所有班別) / ${month}`
    fileNameIdentifier = `其他(所有班別)`
  } else {
    const shiftName = SHIFT_INDEX_MAP[SHIFT_MAP[shift]] || shift
    title = `檢驗報告查詢結果: ${freq} / ${shiftName} / ${month}`
    fileNameIdentifier = `${freq}_${shiftName}`
  }

  const headers = [
    '頻率',
    '班別',
    '床號',
    '姓名',
    ...prioritizedLabItems.map((key) => labItemDisplayNames.value[key] || key),
  ]
  const dataRows = reportData.value.map((row) => {
    return [
      row.freq || '-',
      formatShift(row.shiftIndex),
      row.bedNum || '-',
      row.patientName,
      ...prioritizedLabItems.map((itemKey) => {
        const value = row.labData[itemKey]
        return value !== undefined && value !== null ? value : '-'
      }),
    ]
  })
  const sheetData = [[title], [], headers, ...dataRows]
  const ws = XLSX.utils.aoa_to_sheet(sheetData)
  const numCols = headers.length
  if (!ws['!merges']) ws['!merges'] = []
  ws['!merges'].push({ s: { r: 0, c: 0 }, e: { r: 0, c: numCols - 1 } })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '報告查詢結果')
  const fileName = `檢驗報告查詢_${fileNameIdentifier}_${month}.xlsx`
  XLSX.writeFile(wb, fileName)
}
</script>

<style scoped>
/* ✨ 新增：儲存按鈕樣式 */
.save-btn {
  background-color: #0d6efd; /* Bootstrap Primary Blue */
  color: white;
  border-color: #0d6efd;
  margin-left: auto; /* 將儲存按鈕推到最右邊 */
}
.save-btn:disabled {
  background-color: #6c757d;
  border-color: #6c757d;
}

/* ✨ 新增：美化分析/處置欄位顯示 */
.analysis-cell-content {
  max-width: 300px;
  white-space: pre-wrap; /* 自動換行 */
  text-align: left;
  padding: 4px;
}

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
  display: flex;
  align-items: center;
  gap: 1.5rem;
}
.back-button {
  flex-shrink: 0;
  background-color: #6c757d;
  color: white;
  border: none;
  padding: 0.6rem 1.2rem;
  font-size: 1rem;
  font-weight: 500;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.2s;
}
.back-button:hover {
  background-color: #5a6268;
}
.header-main-content {
  flex-grow: 1;
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
.query-panel,
.alert-panel {
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
.report-display,
.alert-report-display {
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
.filter-wrapper,
.group-filters,
.individual-filters {
  display: flex;
  gap: 1rem;
  align-items: flex-end;
  flex-wrap: wrap;
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
.year-selector button {
  padding: 0.5rem 1.5rem;
  border-radius: 4px;
  border: 1px solid #007bff;
  background-color: #007bff;
  color: white;
  cursor: pointer;
  height: 38px;
  box-sizing: border-box;
}
.year-selector button {
  padding: 0.5rem 1rem;
  background-color: #f8f9fa;
  color: #333;
  border-color: #ccc;
}
.loading-state,
.placeholder-text,
.empty-state {
  text-align: center;
  color: #6c757d;
  padding: 2rem;
}
.loading-spinner {
  border: 8px solid #f3f3f3;
  border-top: 8px solid #3498db;
  border-radius: 50%;
  width: 60px;
  height: 60px;
  animation: spin 1s linear infinite;
  margin: 0 auto 1rem auto;
}
@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
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

/* --- 新的 Sticky Column 樣式 --- */
.sticky-col.col-freq {
  left: 0;
  min-width: 80px;
}
.sticky-col.col-shift {
  left: 80px; /* 頻率寬度 */
  min-width: 80px;
}
.sticky-col.col-bed {
  left: 160px; /* 頻率+班別寬度 */
  min-width: 80px;
}
.sticky-col.col-name {
  left: 240px; /* 頻率+班別+床號寬度 */
  min-width: 120px;
}
/* Individual search only has one sticky column */
table[v-if="searchType === 'individual'"] .sticky-col {
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

/* --- 警示報告頁籤樣式 (無變動，省略) --- */
.alert-controls {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 1.5rem;
  padding: 0.5rem;
  background-color: #e9ecef;
  border-radius: 8px;
}
.alert-controls button {
  padding: 0.5rem 1.5rem;
  border-radius: 4px;
  border: 1px solid #ccc; /* 給一個基礎邊框 */
  cursor: pointer;
  height: 38px;
  box-sizing: border-box;
  font-weight: 500;
  transition: background-color 0.2s;
}
.alert-controls button:not(.export-btn):not(.save-btn) {
  background-color: #f8f9fa; /* 淺灰色背景 */
  color: #333;
  border-color: #ccc;
}
.alert-controls .export-btn {
  background-color: #198754; /* 綠色 */
  color: white;
  border-color: #198754;
}
.alert-controls button:disabled {
  background-color: #6c757d;
  border-color: #6c757d;
  cursor: not-allowed;
  opacity: 0.65;
}
.search-controls .export-btn {
  padding: 0.5rem 1.5rem;
  border-radius: 4px;
  height: 38px;
  box-sizing: border-box;
  font-weight: 500;
  cursor: pointer;
  background-color: #198754; /* 綠色 */
  color: white;
  border-color: #198754;
}
.search-controls .export-btn:disabled {
  background-color: #6c757d;
  border-color: #6c757d;
}
.month-range-display {
  font-size: 1.2rem;
  font-weight: bold;
  color: #343a40;
  min-width: 220px;
  text-align: center;
}
.export-btn {
  background-color: #198754; /* 綠色 */
  border-color: #198754;
  color: white;
}
.export-btn:disabled {
  background-color: #6c757d;
  border-color: #6c757d;
}
.grouped-tables-container {
  overflow-y: auto;
  padding: 0.5rem;
}
.alert-group {
  margin-bottom: 2rem;
}
.group-title {
  font-size: 1.25rem;
  color: #343a40;
  margin-bottom: 1rem;
  padding-bottom: 0.5rem;
  border-bottom: 2px solid #007bff;
}
.alert-table td.clickable {
  color: #0056b3;
  font-weight: bold;
  cursor: pointer;
  text-decoration: underline;
}
.alert-table td.clickable:hover {
  color: #003f7e;
}
.alert-table textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 4px;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 0.9rem;
  resize: vertical;
}
.col-analysis,
.col-suggestion {
  width: 20%;
}

/* --- 資料上傳頁籤擴充樣式 (無變動，省略) --- */
.upload-panel.expanded {
  display: grid;
  grid-template-columns: 350px 1fr;
  gap: 1.5rem;
}
.upload-core-panel {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  align-items: center;
  padding: 1rem;
  background-color: #f8f9fa;
  border-radius: 8px;
}
.upload-core-panel h4 {
  margin: 0;
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
.manual-entry-panel {
  display: flex;
  flex-direction: column;
  background-color: #f8f9fa;
  border-radius: 8px;
  padding: 1rem;
  overflow-y: auto;
}
.manual-entry-panel h4 {
  margin-top: 0;
  margin-bottom: 0.5rem;
}
.panel-description {
  font-size: 0.85rem;
  color: #6c757d;
  margin-top: 0;
  margin-bottom: 1rem;
  border-bottom: 1px solid #dee2e6;
  padding-bottom: 0.5rem;
}
.missing-patients-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.placeholder-item {
  padding: 1rem;
  text-align: center;
  color: #adb5bd;
  border: 1px dashed #ced4da;
  border-radius: 4px;
}
.upload-panel {
  align-items: initial;
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
  max-width: 600px;
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
.results-card {
  width: 100%;
  max-width: 600px;
  padding: 1.5rem;
  border: 1px solid #e9ecef;
  border-radius: 8px;
  background-color: #fff;
}
.results-card h2 {
  margin-top: 0;
}
.upload-result {
  padding: 0.75rem;
  border-radius: 4px;
}
.upload-result .is-success {
  color: #155724;
  background-color: #d4edda;
}
.upload-result .has-error {
  color: #721c24;
  background-color: #f8d7da;
}
.error-details {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid #ffc107;
  text-align: left;
}
.error-details h4 {
  margin-top: 0;
  color: #856404;
}
.error-details ul {
  padding-left: 20px;
  margin: 0;
  max-height: 150px;
  overflow-y: auto;
}
.error-details li {
  margin-bottom: 0.5rem;
}
.error-data {
  font-size: 0.85rem;
  color: #666;
  font-family: monospace;
}
.manual-controls {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
}
.manual-controls select,
.manual-controls input {
  flex-grow: 1;
  padding: 0.5rem;
  border-radius: 4px;
  border: 1px solid #ccc;
}
.manual-controls button {
  padding: 0.5rem 1rem;
  border-radius: 4px;
  border: 1px solid #007bff;
  background-color: #007bff;
  color: white;
  cursor: pointer;
  flex-shrink: 0; /* 防止按鈕被壓縮 */
}
.manual-controls button:disabled {
  background-color: #6c757d;
  border-color: #6c757d;
  cursor: not-allowed;
}
.missing-patient-item {
  background: #fff;
  padding: 0.75rem;
  border: 1px solid #dee2e6;
  border-radius: 6px;
}
.patient-info {
  font-weight: bold;
  display: block;
  margin-bottom: 0.75rem;
}
.input-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
  gap: 0.75rem;
}
.input-field {
  display: flex;
  flex-direction: column;
}
.input-field label {
  font-size: 0.8rem;
  color: #6c757d;
  margin-bottom: 2px;
}
.input-field input {
  width: 100%;
  padding: 4px;
  border: 1px solid #ccc;
  border-radius: 4px;
}
.save-manual-btn {
  width: 100%;
  padding: 0.75rem;
  margin-top: 1rem;
  background-color: #198754;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 1rem;
  cursor: pointer;
}
.save-manual-btn:disabled {
  background-color: #6c757d;
}
.manual-entry-global-date {
  margin-bottom: 1rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid #dee2e6;
}
.manual-entry-global-date label {
  display: block;
  font-weight: 500;
  margin-bottom: 0.5rem;
}
.manual-entry-global-date input {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid #ccc;
  border-radius: 4px;
}

.abnormality-details {
  line-height: 1.4;
  text-align: left;
  padding: 2px 4px;
}

.months-row {
  font-size: 0.85em;
  color: #6c757d;
  white-space: nowrap;
}

.values-row {
  font-size: 1.05em;
  font-weight: bold;
  white-space: nowrap;
}

.trend-indicator {
  display: inline-block;
  margin-left: 0.5rem;
  font-size: 1.2em;
}

/* 趨勢顏色定義 */
:deep(.trend-indicator.is-worsening) {
  color: #dc3545; /* 紅色，惡化 */
}

:deep(.trend-indicator.is-improving) {
  color: #0d6efd; /* 藍色，改善 */
}

:deep(.trend-indicator.trend-stable) {
  color: #6c757d; /* 灰色，穩定 */
}

/* 確保整個儲存格都是可點擊區域 */
.alert-table td.clickable {
  /* 移除預設的 text-decoration，因為視覺上已經很清晰 */
  text-decoration: none;
}
.alert-table td.clickable:hover {
  background-color: #f0f8ff; /* 滑鼠懸停時給一點背景色回饋 */
}

/* --- 行動版響應式樣式 (無變動，省略) --- */
.search-toggle-btn {
  display: none;
}
@media (max-width: 992px) {
  .page-container {
    height: 100vh;
    padding: 0;
  }
  .page-main-content {
    border-radius: 0;
  }
  .page-header {
    padding: 1rem;
    gap: 1rem;
  }
  h1 {
    font-size: 1.2rem;
  }
  .page-description {
    display: none;
  }
  .back-button {
    padding: 0.5rem 0.8rem;
    font-size: 0.9rem;
  }
  .tabs-navigation button {
    font-size: 1rem;
    padding: 0.5rem 1rem;
  }
  .query-panel,
  .alert-panel {
    padding: 0;
  }
  .search-toggle-btn {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    padding: 0.75rem 1rem;
    background-color: #f8f9fa;
    border: none;
    border-bottom: 1px solid #dee2e6;
    font-size: 1rem;
    font-weight: 500;
    cursor: pointer;
    flex-shrink: 0;
  }
  .toggle-icon {
    transition: transform 0.3s ease;
  }
  .toggle-icon.is-toggled {
    transform: rotate(180deg);
  }
  .search-controls {
    flex-direction: column;
    align-items: stretch;
    gap: 1rem;
    padding: 1rem;
    border-bottom: 1px solid #e9ecef;
  }
  .filter-wrapper,
  .group-filters,
  .individual-filters {
    flex-direction: column;
    align-items: stretch;
    gap: 1rem;
  }
  .search-field input,
  .search-field select,
  .search-btn {
    width: 100%;
  }
  .year-selector {
    justify-content: space-between;
  }
  .report-display,
  .alert-report-display {
    padding: 0;
  }
  .table-container {
    border: none;
    border-radius: 0;
  }
  table {
    font-size: 0.8rem;
  }
  th,
  td {
    padding: 0.5rem 0.4rem;
  }
  .sticky-col.col-freq,
  .sticky-col.col-shift,
  .sticky-col.col-bed {
    min-width: 60px;
  }
  .sticky-col.col-name {
    min-width: 80px;
  }

  .sticky-col.col-shift {
    left: 60px;
  }
  .sticky-col.col-bed {
    left: 120px;
  }
  .sticky-col.col-name {
    left: 180px;
  }

  .upload-panel.expanded {
    grid-template-columns: 1fr;
  }
  .upload-history-panel {
    display: none;
  }
  .manual-entry-panel {
    margin-top: 1.5rem;
  }
  .upload-panel {
    padding: 1rem;
  }
  .upload-drop-zone {
    padding: 1.5rem;
  }
  .upload-icon {
    font-size: 2.5rem;
  }
  .upload-drop-zone h3 {
    font-size: 1.1rem;
  }
  .upload-hint {
    font-size: 0.9rem;
  }
  .file-input-label,
  .upload-btn-main {
    width: 100%;
    box-sizing: border-box;
    padding: 0.75rem;
  }
  .alert-controls {
    flex-wrap: wrap;
    gap: 0.5rem;
    padding: 0.5rem;
    border-radius: 0;
    border-bottom: 1px solid #dee2e6;
  }
  .month-range-display {
    width: 100%;
    order: -1;
    padding-bottom: 0.5rem;
  }
  .alert-controls button {
    flex-grow: 1;
  }
}
</style>
