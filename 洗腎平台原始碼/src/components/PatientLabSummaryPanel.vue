<!-- 檔案路徑: src/components/PatientLabSummaryPanel.vue (修正行動版佈局後) -->
<template>
  <div class="lab-summary-panel-content">
    <div v-if="isLoading" class="loading-state">
      <div class="loading-spinner"></div>
      <p>正在分析檢驗數據...</p>
    </div>

    <div v-else-if="error" class="error-state">
      <p>⚠️ 載入失敗: {{ error }}</p>
      <button @click="fetchLabData">重試</button>
    </div>

    <div v-else-if="reportMonths.length === 0" class="empty-state">
      <p>找不到該病人的檢驗報告資料。</p>
    </div>

    <div v-else class="content-grid">
      <div class="top-panel">
        <div class="summary-section">
          <h3>數據判讀摘要 ({{ latestMonth }})</h3>

          <div class="summary-item">
            <strong>本月不合格項目:</strong>
            <ul v-if="analysisResults.highItems.length > 0" class="summary-sublist">
              <li v-for="item in analysisResults.highItems" :key="item.key">
                {{ labItemDisplayNames[item.key] || item.key }}:
                <span :class="item.class">{{ item.value }}</span> (偏高)
              </li>
            </ul>
            <ul v-if="analysisResults.lowItems.length > 0" class="summary-sublist">
              <li v-for="item in analysisResults.lowItems" :key="item.key">
                {{ labItemDisplayNames[item.key] || item.key }}:
                <span :class="item.class">{{ item.value }}</span> (偏低)
              </li>
            </ul>
            <p
              v-if="analysisResults.highItems.length === 0 && analysisResults.lowItems.length === 0"
              class="no-data-text"
            >
              無
            </p>
          </div>

          <div class="summary-item">
            <strong>數據趨勢 (近三個月):</strong>
            <ul v-if="analysisResults.risingItems.length > 0" class="summary-sublist">
              <li v-for="item in analysisResults.risingItems" :key="item.key">
                {{ labItemDisplayNames[item.key] || item.key }} (連續上升)
              </li>
            </ul>
            <ul v-if="analysisResults.fallingItems.length > 0" class="summary-sublist">
              <li v-for="item in analysisResults.fallingItems" :key="item.key">
                {{ labItemDisplayNames[item.key] || item.key }} (連續下降)
              </li>
            </ul>
            <p
              v-if="
                analysisResults.risingItems.length === 0 &&
                analysisResults.fallingItems.length === 0
              "
              class="no-data-text"
            >
              無明顯連續升降趨勢
            </p>
          </div>

          <div class="summary-item">
            <strong>連續不合格項目 (特定條件):</strong>
            <ul v-if="analysisResults.consecutiveAbnormalItems.length > 0" class="summary-sublist">
              <li v-for="item in analysisResults.consecutiveAbnormalItems" :key="item.key">
                {{ labItemDisplayNames[item.key] || item.key }}
              </li>
            </ul>
            <p v-else class="no-data-text">無</p>
          </div>
        </div>

        <div class="action-section">
          <h3>處置與計畫</h3>
          <textarea
            v-model="dispositionText"
            placeholder="請根據以上摘要，輸入處置或醫囑調整..."
          ></textarea>
          <button @click="handleSave" :disabled="isSubmitting || !dispositionText.trim()">
            {{ isSubmitting ? '儲存中...' : '儲存為病情紀錄' }}
          </button>
        </div>
      </div>

      <div class="table-panel">
        <h3>歷次檢驗數據</h3>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>月份</th>
                <th v-for="itemKey in prioritizedLabItems" :key="itemKey">
                  {{ labItemDisplayNames[itemKey] || itemKey }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="month in reportMonths" :key="month">
                <td>{{ month }}</td>
                <td v-for="itemKey in prioritizedLabItems" :key="itemKey">
                  <span
                    v-if="processedReports[itemKey]?.[month] !== undefined"
                    :class="getAbnormalClass(itemKey, processedReports[itemKey][month])"
                  >
                    {{ processedReports[itemKey][month] }}
                    <span :class="getTrendArrow(itemKey, month).class">{{
                      getTrendArrow(itemKey, month).arrow
                    }}</span>
                  </span>
                  <span v-else>-</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, computed } from 'vue'
import ApiManager from '@/services/api_manager'

// --- Props & Emits ---
const props = defineProps({
  patient: Object,
})
const emit = defineEmits(['save-record'])

// --- API & Constants ---
const labReportsApi = ApiManager('lab_reports')
const prioritizedLabItems = [
  'WBC',
  'Platelet',
  'Hb',
  // 'Hct', // 移除
  'Ferritin',
  // 'Iron', // 移除
  // 'TIBC', // 移除
  'TSAT',
  'GlucoseAC',
  'Triglyceride', // ✨ 新增
  'LDL', // ✨ 新增
  'Albumin',
  'ALT', // ✨ 新增
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
const labItemDisplayNames = {
  BUN: 'BUN',
  Creatinine: 'Cr',
  Albumin: 'ALB',
  P: 'P',
  Ca: 'Ca',
  Hb: 'Hb',
  Hct: 'Hct', // 雖然不顯示在表格，但摘要區可能用到，保留無妨
  Platelet: 'PLT',
  WBC: 'WBC',
  Na: 'Na',
  K: 'K',
  eGFR: 'eGFR',
  GlucoseAC: 'Glucose',
  TotalProtein: 'Total Protein',
  Iron: 'Fe', // 雖然不顯示在表格，但摘要區可能用到，保留無妨
  TIBC: 'TIBC', // 雖然不顯示在表格，但摘要區可能用到，保留無妨
  Ferritin: 'Ferritin',
  iPTH: 'iPTH',
  PostBUN: 'Post-BUN',
  CaXP: 'Ca x P',
  'Kt/V': 'Kt/V',
  URR: 'URR (%)',
  TSAT: 'TSAT (%)',
  // ✨ 新增 TG, LDL, ALT 的顯示名稱
  Triglyceride: 'TG',
  LDL: 'LDL',
  ALT: 'ALT',
}
const LAB_REFERENCE_RANGES = {
  WBC: { min: 4.0, max: 10.0 },
  Hb: { min: 8, max: 12 },
  P: { max: 5.5 },
  ALT: { max: 40 },
  Triglyceride: { max: 150 },
  LDL: { max: 100 },
  Albumin: { min: 3.5 },
  'Kt/V': { min: 1.2 },
  URR: { min: 65 },
  iPTH: { min: 150, max: 300 },
  Ca: { min: 8.6, max: 10.3 },
  K: { min: 3.5, max: 5.1 },
  Ferritin: { max: 800 },
  CaXP: { max: 60 },
}
const CONSECUTIVE_ABNORMAL_CRITERIA = {
  Hb: { max: 8.5 },
  Albumin: { max: 3.5 },
  URR: { max: 65 },
  CaXP: { min: 60 },
}

// --- Component State ---
const isLoading = ref(false)
const isSubmitting = ref(false)
const error = ref(null)
const rawReports = ref([])
const dispositionText = ref('')

// --- Computed Properties ---
const processedReports = computed(() => {
  const data = {}
  rawReports.value.forEach((report) => {
    const monthKey = report.reportDate.slice(0, 7)
    for (const itemKey in report.data) {
      if (!data[itemKey]) data[itemKey] = {}
      if (!data[itemKey][monthKey]) {
        data[itemKey][monthKey] = report.data[itemKey]
      }
    }
  })
  for (const monthKey of reportMonths.value) {
    const bun = data['BUN']?.[monthKey]
    const postBun = data['PostBUN']?.[monthKey]
    const iron = data['Iron']?.[monthKey]
    const tibc = data['TIBC']?.[monthKey]
    const ca = data['Ca']?.[monthKey]
    const p = data['P']?.[monthKey]
    if (bun !== undefined && postBun !== undefined && postBun > 0 && bun > 0) {
      if (!data['URR']) data['URR'] = {}
      if (!data['Kt/V']) data['Kt/V'] = {}
      data['URR'][monthKey] = (((bun - postBun) / bun) * 100).toFixed(1)
      data['Kt/V'][monthKey] = Math.log(bun / postBun).toFixed(2)
    }
    if (iron !== undefined && tibc !== undefined && tibc > 0) {
      if (!data['TSAT']) data['TSAT'] = {}
      data['TSAT'][monthKey] = ((iron / tibc) * 100).toFixed(1)
    }
    if (ca !== undefined && p !== undefined) {
      if (!data['CaXP']) data['CaXP'] = {}
      data['CaXP'][monthKey] = (ca * p).toFixed(2)
    }
  }
  return data
})
const reportMonths = computed(() => {
  const monthSet = new Set()
  rawReports.value.forEach((r) => monthSet.add(r.reportDate.slice(0, 7)))
  return Array.from(monthSet).sort().reverse()
})
const latestMonth = computed(() => reportMonths.value[0] || '')
const analysisResults = computed(() => {
  const results = {
    highItems: [],
    lowItems: [],
    risingItems: [],
    fallingItems: [],
    consecutiveAbnormalItems: [],
  }
  if (!latestMonth.value) return results
  for (const key in processedReports.value) {
    const value = processedReports.value[key][latestMonth.value]
    if (value === undefined) continue
    const range = LAB_REFERENCE_RANGES[key]
    if (!range) continue
    if (range.min !== undefined && value < range.min) {
      results.lowItems.push({ key, value, class: 'value-low' })
    } else if (range.max !== undefined && value > range.max) {
      results.highItems.push({ key, value, class: 'value-high' })
    }
  }
  if (reportMonths.value.length < 3) return results
  const last3Months = reportMonths.value.slice(0, 3)
  for (const key of prioritizedLabItems) {
    const val1 = processedReports.value[key]?.[last3Months[0]]
    const val2 = processedReports.value[key]?.[last3Months[1]]
    const val3 = processedReports.value[key]?.[last3Months[2]]
    if (val1 === undefined || val2 === undefined || val3 === undefined) continue
    if (val1 > val2 && val2 > val3) {
      results.risingItems.push({ key })
    } else if (val1 < val2 && val2 < val3) {
      results.fallingItems.push({ key })
    }
  }
  for (const key in CONSECUTIVE_ABNORMAL_CRITERIA) {
    const val1 = processedReports.value[key]?.[last3Months[0]]
    const val2 = processedReports.value[key]?.[last3Months[1]]
    const val3 = processedReports.value[key]?.[last3Months[2]]
    if (val1 === undefined || val2 === undefined || val3 === undefined) continue
    const rule = CONSECUTIVE_ABNORMAL_CRITERIA[key]
    const isValueAbnormal = (v) => {
      if (rule.max !== undefined && v < rule.max) return true
      if (rule.min !== undefined && v > rule.min) return true
      return false
    }
    if (isValueAbnormal(val1) && isValueAbnormal(val2) && isValueAbnormal(val3)) {
      results.consecutiveAbnormalItems.push({ key })
    }
  }
  return results
})

// --- Methods ---
async function fetchLabData() {
  if (!props.patient?.id) return
  isLoading.value = true
  error.value = null
  try {
    const oneYearAgo = new Date()
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
    const oneYearAgoStr = oneYearAgo.toISOString().split('T')[0]

    // Fetch all reports and filter client-side
    const allReports = await labReportsApi.fetchAll()
    const reports = allReports
      .filter((r) => r.patientId === props.patient.id)
      .filter((r) => {
        const reportDate = r.reportDate
        if (typeof reportDate === 'string') {
          return reportDate >= oneYearAgoStr
        }
        if (reportDate && reportDate.toDate) {
          return reportDate.toDate() >= oneYearAgo
        }
        return true
      })
      .sort((a, b) => {
        const dateA =
          typeof a.reportDate === 'string'
            ? a.reportDate
            : a.reportDate?.toDate
              ? a.reportDate.toDate().toISOString().slice(0, 10)
              : ''
        const dateB =
          typeof b.reportDate === 'string'
            ? b.reportDate
            : b.reportDate?.toDate
              ? b.reportDate.toDate().toISOString().slice(0, 10)
              : ''
        return dateB.localeCompare(dateA)
      })

    rawReports.value = reports.map((r) => ({
      ...r,
      reportDate: r.reportDate.toDate
        ? r.reportDate.toDate().toISOString().slice(0, 10)
        : r.reportDate,
      // 將後端的 results 欄位映射為 data，確保與 processedReports 邏輯相容
      data: r.results || r.data || {},
    }))
  } catch (err) {
    console.error('獲取檢驗報告失敗:', err)
    error.value = err.message
  } finally {
    isLoading.value = false
  }
}

function handleSave() {
  isSubmitting.value = true
  let autoContent = `【檢驗報告處置 - ${latestMonth.value}】\n\n摘要：\n`
  const { highItems, lowItems, risingItems, fallingItems, consecutiveAbnormalItems } =
    analysisResults.value
  if (highItems.length > 0 || lowItems.length > 0) {
    autoContent += ` • 本月不合格項目:\n`
    highItems.forEach((item) => {
      autoContent += `   - ${labItemDisplayNames[item.key] || item.key}: ${item.value} (偏高)\n`
    })
    lowItems.forEach((item) => {
      autoContent += `   - ${labItemDisplayNames[item.key] || item.key}: ${item.value} (偏低)\n`
    })
  }
  if (risingItems.length > 0 || fallingItems.length > 0) {
    autoContent += ` • 數據趨勢 (近三個月):\n`
    risingItems.forEach((item) => {
      autoContent += `   - ${labItemDisplayNames[item.key] || item.key} (連續上升)\n`
    })
    fallingItems.forEach((item) => {
      autoContent += `   - ${labItemDisplayNames[item.key] || item.key} (連續下降)\n`
    })
  }
  if (consecutiveAbnormalItems.length > 0) {
    autoContent += ` • 連續不合格項目 (特定條件):\n`
    consecutiveAbnormalItems.forEach((item) => {
      autoContent += `   - ${labItemDisplayNames[item.key] || item.key}\n`
    })
  }
  autoContent += `\n處置與計畫：\n${dispositionText.value.trim()}`
  emit('save-record', { patient: props.patient, content: autoContent })
  setTimeout(() => {
    isSubmitting.value = false
    dispositionText.value = ''
  }, 300)
}

function getAbnormalClass(itemKey, value) {
  const range = LAB_REFERENCE_RANGES[itemKey]
  if (!range || value === undefined) return ''
  if (range.min !== undefined && value < range.min) return 'value-low'
  if (range.max !== undefined && value > range.max) return 'value-high'
  return ''
}
function getTrendArrow(itemKey, month) {
  const currentMonthIndex = reportMonths.value.indexOf(month)
  if (currentMonthIndex >= reportMonths.value.length - 1) return { arrow: '', class: '' }
  const prevMonth = reportMonths.value[currentMonthIndex + 1]
  const currentValue = processedReports.value[itemKey]?.[month]
  const prevValue = processedReports.value[itemKey]?.[prevMonth]
  if (currentValue === undefined || prevValue === undefined) return { arrow: '', class: '' }
  if (currentValue > prevValue) return { arrow: '▲', class: 'value-high' }
  if (currentValue < prevValue) return { arrow: '▼', class: 'value-low' }
  return { arrow: '', class: '' }
}

// --- Watcher ---
watch(
  () => props.patient?.id,
  (newPatientId) => {
    if (newPatientId) {
      rawReports.value = []
      dispositionText.value = ''
      fetchLabData()
    } else {
      rawReports.value = []
    }
  },
  { immediate: true },
)
</script>

<style scoped>
.lab-summary-panel-content {
  height: 100%;
  display: flex;
  flex-direction: column;
  /* ✨ 新增：確保在 flex 容器中可以縮小 */
  min-height: 0;
}
.loading-state,
.empty-state,
.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 300px;
  color: #6c757d;
  flex-grow: 1;
}
.loading-spinner {
  width: 40px;
  height: 40px;
  border: 4px solid #f3f3f3;
  border-top: 4px solid #007bff;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 1rem;
}
@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}
.content-grid {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  height: 100%;
  min-height: 0; /* ✨ 新增：確保 grid 容器也能被壓縮 */
}

/* --- ✨ 桌面版樣式修正 ✨ --- */
.top-panel {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.5rem;
  flex-shrink: 0;
  max-height: 50%;
  min-height: 0;
}
.summary-section,
.action-section {
  background-color: #fff;
  padding: 1rem;
  border-radius: 8px;
  border: 1px solid #e9ecef;
  overflow-y: auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.action-section textarea {
  flex-grow: 1;
}
h3 {
  margin-top: 0;
  margin-bottom: 1rem;
  color: #495057;
  font-size: 1.1rem;
  border-bottom: 1px solid #f1f3f5;
  padding-bottom: 0.5rem;
}
.summary-item {
  margin-bottom: 1rem;
}
.summary-item:last-child {
  margin-bottom: 0;
}
.summary-item strong {
  color: #212529;
}
.summary-item ul {
  list-style-type: none;
  padding-left: 0.5rem;
  margin: 0.5rem 0 0 0;
  font-size: 0.95rem;
}
.summary-item ul:not(:last-child) {
  margin-bottom: 0.5rem;
}
.summary-item li {
  margin-bottom: 0.25rem;
}
.no-data-text {
  font-size: 0.95rem;
  color: #6c757d;
  margin: 0.5rem 0 0 0.5rem;
}
.action-section textarea {
  width: 100%;
  min-height: 100px;
  padding: 0.5rem;
  border-radius: 6px;
  border: 1px solid #ced4da;
  font-size: 0.95rem;
  resize: vertical;
  margin-bottom: 1rem;
}
.action-section button {
  width: 100%;
  padding: 0.75rem;
  background-color: #28a745;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 1rem;
  font-weight: bold;
  cursor: pointer;
  flex-shrink: 0;
}
.action-section button:disabled {
  background-color: #6c757d;
  cursor: not-allowed;
}
.table-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex-grow: 1;
}
.table-container {
  flex-grow: 1;
  overflow: auto;
  border: 1px solid #dee2e6;
  border-radius: 8px;
}
table {
  width: 100%;
  border-collapse: collapse;
}
th,
td {
  padding: 0.75rem;
  text-align: center;
  white-space: nowrap;
  border: 1px solid #e9ecef;
}
th {
  background-color: #f8f9fa;
  font-weight: 600;
  position: sticky;
  top: 0;
  z-index: 1;
}
tbody tr:nth-child(even) {
  background-color: #f8f9fa;
}
td:first-child,
th:first-child {
  position: sticky;
  left: 0;
  background-color: #f8f9fa;
  font-weight: bold;
  z-index: 2;
}
thead th:first-child {
  z-index: 3;
}
tbody tr:nth-child(even) td:first-child {
  background-color: #f0f3f5;
}
.value-high {
  color: #dc3545;
  font-weight: bold;
}
.value-low {
  color: #007bff;
  font-weight: bold;
}

/* ✨ 行動版響應式樣式修正 ✨ */
@media (max-width: 992px) {
  /* 在手機上，我們不希望內部滾動，而是讓整個 modal-body 滾動 */
  .lab-summary-panel-content,
  .content-grid {
    display: block; /* 改回 block 佈局 */
    height: auto; /* 解除高度限制 */
  }
  .top-panel {
    grid-template-columns: 1fr;
    max-height: none;
  }
  .summary-section,
  .action-section {
    overflow-y: visible;
  }
  .table-panel {
    margin-top: 1.5rem;
    flex-grow: 0; /* 解除 flex-grow */
  }
  /* 為了讓行動版 modal-body 可以滾動，需要一個額外的樣式 */
  /* 這個樣式需要加在 PatientDetailModal.vue 中 */
}
</style>
