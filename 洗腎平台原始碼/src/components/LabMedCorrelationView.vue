<!-- 檔案路徑: src/components/LabMedCorrelationView.vue (複製到八月版) -->
<template>
  <div class="correlation-view-container">
    <div v-if="isLoading" class="loading-state">
      <div class="loading-spinner"></div>
      <p>正在載入檢驗與藥囑歷史資料...</p>
    </div>
    <div v-else-if="error" class="error-state">
      <p>⚠️ 載入失敗: {{ error }}</p>
      <button @click="fetchData">重試</button>
    </div>
    <div v-else-if="!patient" class="empty-state">
      <p>請先選擇病人。</p>
    </div>
    <div v-else class="correlation-content">
      <!-- 可收合的操作/編輯區域 -->
      <div class="actions-panel">
        <div class="actions-header">
          <div class="header-info">
            <i class="fas fa-calendar-alt"></i>
            最新報告月份: **{{ latestLabMonth || '無' }}**
          </div>
          <button @click="toggleDraftPanel" class="draft-edit-btn-main">
            <i class="fas" :class="isDraftPanelVisible ? 'fa-chevron-up' : 'fa-edit'"></i>
            {{ isDraftPanelVisible ? '收合編輯面板' : `編輯 ${draftTargetMonth} 藥囑草稿` }}
          </button>
        </div>

        <!-- 展開的草稿編輯面板 -->
        <div v-if="isDraftPanelVisible" class="draft-editor-body">
          <div class="draft-grid">
            <div v-for="group in correlationGroups" :key="group.title" class="draft-group">
              <h4>{{ group.title }}</h4>
              <div v-for="med in group.meds" :key="med.code" class="draft-input-row">
                <label>{{ med.tradeName }}</label>
                <div class="order-input-cell">
                  <input type="text" v-model="orderDraft[med.code].dose" placeholder="劑量" />
                  <span class="unit-display">{{ med.unit }}</span>
                  <input
                    type="text"
                    v-model="orderDraft[med.code].frequency"
                    :placeholder="med.type === 'injection' ? '備註' : '頻率'"
                  />
                </div>
              </div>
            </div>
          </div>
          <div class="draft-editor-footer">
            <button
              @click="saveDraftOrders"
              class="btn-primary"
              :disabled="isSubmitting || !isDraftChanged"
            >
              <i v-if="isSubmitting" class="fas fa-spinner fa-spin"></i>
              儲存草稿
            </button>
          </div>
        </div>
      </div>

      <!-- 主要內容區 -->
      <div class="main-table-area">
        <!-- 貧血管理表格 -->
        <section class="data-group-section">
          <h3>貧血管理 (Anemia)</h3>
          <div class="table-wrapper">
            <table class="correlation-table">
              <thead>
                <tr class="sub-header-row">
                  <th class="sticky-col first-col">年月</th>
                  <th v-for="labKey in anemiaGroup.labKeys" :key="labKey" class="lab-header">
                    {{ labItemDisplayNames[labKey] || labKey }}
                  </th>
                  <th v-for="med in anemiaGroup.meds" :key="med.code" class="med-group-header">
                    {{ med.tradeName }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="month in labReportMonths" :key="month">
                  <td class="sticky-col first-col">{{ month }}</td>
                  <td v-for="labKey in anemiaGroup.labKeys" :key="labKey" class="lab-data-cell">
                    <span
                      v-if="processedLabs[labKey]?.[month] !== undefined"
                      :class="getAbnormalClass(labKey, processedLabs[labKey][month])"
                    >
                      {{ processedLabs[labKey][month] }}
                    </span>
                  </td>
                  <td
                    v-for="med in anemiaGroup.meds"
                    :key="med.code + '-data'"
                    class="med-data-cell"
                  >
                    <span v-if="processedOrders[med.code]?.[month]">
                      {{ processedOrders[med.code][month].dose }} {{ med.unit }}
                      <small v-if="processedOrders[med.code][month].frequency">
                        ({{ processedOrders[med.code][month].frequency }})
                      </small>
                    </span>
                    <span v-else class="no-data">-</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- 鈣磷代謝表格 -->
        <section class="data-group-section">
          <h3>鈣磷代謝 (Mineral Metabolism)</h3>
          <div class="table-wrapper">
            <table class="correlation-table">
              <thead>
                <tr class="sub-header-row">
                  <th class="sticky-col first-col">年月</th>
                  <th v-for="labKey in mineralGroup.labKeys" :key="labKey" class="lab-header">
                    {{ labItemDisplayNames[labKey] || labKey }}
                  </th>
                  <th v-for="med in mineralGroup.meds" :key="med.code" class="med-group-header">
                    {{ med.tradeName }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="month in labReportMonths" :key="month">
                  <td class="sticky-col first-col">{{ month }}</td>
                  <td v-for="labKey in mineralGroup.labKeys" :key="labKey" class="lab-data-cell">
                    <span
                      v-if="processedLabs[labKey]?.[month] !== undefined"
                      :class="getAbnormalClass(labKey, processedLabs[labKey][month])"
                    >
                      {{ processedLabs[labKey][month] }}
                    </span>
                  </td>
                  <td
                    v-for="med in mineralGroup.meds"
                    :key="med.code + '-data'"
                    class="med-data-cell"
                  >
                    <span v-if="processedOrders[med.code]?.[month]">
                      {{ processedOrders[med.code][month].dose }} {{ med.unit }}
                      <small v-if="processedOrders[med.code][month].frequency"
                        >({{ processedOrders[med.code][month].frequency }})</small
                      >
                    </span>
                    <span v-else class="no-data">-</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, reactive } from 'vue'
import ApiManager from '@/services/api_manager'
import { useAuth } from '@/composables/useAuth'

const props = defineProps({
  patient: Object,
})

const labReportsApi = ApiManager('lab_reports')
const ordersApi = ApiManager('medication_orders')
const draftOrdersApi = ApiManager('medication_drafts')
const { currentUser } = useAuth()

const correlationGroups = [
  {
    title: '貧血管理 (Anemia)',
    labKeys: ['Hb', 'Ferritin', 'TSAT'],
    meds: [
      { code: 'INES2', tradeName: 'NESP', type: 'injection', unit: 'mcg' },
      { code: 'IREC1', tradeName: 'Recormon', type: 'injection', unit: 'KIU' },
      { code: 'OVAF', tradeName: 'Vafseo', type: 'oral', unit: '顆' },
      { code: 'IFER2', tradeName: 'Fe-back', type: 'injection', unit: 'mg' },
    ],
  },
  {
    title: '鈣磷代謝 (Mineral Metabolism)',
    labKeys: ['Ca', 'P', 'iPTH'],
    meds: [
      { code: 'OCAL1', tradeName: 'A-Cal', type: 'oral', unit: '顆' },
      { code: 'OCAA', tradeName: 'Pro-Ca', type: 'oral', unit: '顆' },
      { code: 'OFOS4', tradeName: 'Lanclean', type: 'oral', unit: '顆' },
      { code: 'OALK1', tradeName: 'Alkantin', type: 'oral', unit: '顆' },
      { code: 'ICAC', tradeName: 'Cacare', type: 'injection', unit: 'amp' },
      { code: 'OUCA1', tradeName: 'U-Ca', type: 'oral', unit: '顆' },
      { code: 'IPAR1', tradeName: 'Parsabiv', type: 'injection', unit: 'mg' },
      { code: 'OORK', tradeName: 'Orkedia', type: 'oral', unit: '顆' },
    ],
  },
]
const anemiaGroup = computed(() => correlationGroups.find((g) => g.title.includes('貧血')))
const mineralGroup = computed(() => correlationGroups.find((g) => g.title.includes('鈣磷')))
const allMedsMaster = computed(() => correlationGroups.flatMap((g) => g.meds))

const labItemDisplayNames = {
  Hb: 'Hb',
  Ferritin: 'Ferritin',
  TSAT: 'TSAT',
  Ca: 'Ca',
  P: 'P',
  iPTH: 'iPTH',
}
const LAB_REFERENCE_RANGES = {
  Hb: { min: 8, max: 12 },
  P: { max: 5.5 },
  iPTH: { min: 150, max: 300 },
  Ca: { min: 8.6, max: 10.3 },
  Ferritin: { max: 800 },
}

const isLoading = ref(true)
const isSubmitting = ref(false)
const error = ref(null)
const rawLabReports = ref([])
const rawMedOrders = ref([])
const rawMedDrafts = ref([])
const orderDraft = reactive({})
const initialDraftState = ref({})
const isDraftPanelVisible = ref(false)

const draftTargetMonth = computed(() => {
  return labReportMonths.value[0] || currentTargetMonth.value
})

const currentTargetMonth = computed(() => {
  const now = new Date()
  const year = now.getFullYear()
  const month = (now.getMonth() + 1).toString().padStart(2, '0')
  return `${year}-${month}`
})

const labReportMonths = computed(() => {
  if (!rawLabReports.value.length && !rawMedOrders.value.length && !rawMedDrafts.value.length)
    return []

  const monthSet = new Set()

  monthSet.add(currentTargetMonth.value)
  // ✨ 確保 "2025-08" 一定在時間軸中，以便顯示舊資料 ✨
  monthSet.add('2025-08')

  const addMonthIfValid = (month) => {
    if (!month) return
    if (month <= currentTargetMonth.value) {
      monthSet.add(month)
    }
  }

  rawLabReports.value.forEach((r) => {
    addMonthIfValid(r.reportDate.slice(0, 7))
  })

  rawMedOrders.value.forEach((order) => {
    addMonthIfValid(order.uploadMonth || order.changeDate?.slice(0, 7))
  })

  rawMedDrafts.value.forEach((draft) => {
    addMonthIfValid(draft.targetMonth)
  })

  return Array.from(monthSet).sort().reverse().slice(0, 12)
})

const latestLabMonth = computed(() => labReportMonths.value[0] || '')

const processedLabs = computed(() => {
  const data = {}
  rawLabReports.value.forEach((report) => {
    const monthKey = report.reportDate.slice(0, 7)
    for (const itemKey in report.data) {
      if (!data[itemKey]) data[itemKey] = {}
      if (!data[itemKey][monthKey]) {
        data[itemKey][monthKey] = report.data[itemKey]
      }
    }
  })
  return data
})

const processedOrders = computed(() => {
  const data = {}

  // 為了處理同一個月內可能有多筆上傳紀錄的邊界情況（例如更正），
  // 我們先將原始醫囑按時間排序，確保取到的是最新的。
  const sortedOrders = [...rawMedOrders.value].sort((a, b) => {
    const dateA = a.uploadTimestamp?.toDate
      ? a.uploadTimestamp.toDate()
      : new Date(a.uploadTimestamp || 0)
    const dateB = b.uploadTimestamp?.toDate
      ? b.uploadTimestamp.toDate()
      : new Date(b.uploadTimestamp || 0)
    return dateA - dateB
  })

  // 1. 直接處理排序後的歷史醫囑
  sortedOrders.forEach((order) => {
    // fetchData 函數中已經為我們加上了 uploadMonth 欄位，直接使用即可
    const monthKey = order.uploadMonth
    if (!monthKey || !order.orderCode) {
      return // 跳過沒有月份或藥物代碼的無效紀錄
    }

    if (!data[order.orderCode]) {
      data[order.orderCode] = {}
    }

    // 根據藥物代碼找到對應的單位資訊
    const medInfo = allMedsMaster.value.find((m) => m.code === order.orderCode)
    const unit = medInfo ? medInfo.unit : '' // 如果找不到則單位為空

    // 因為已經排序，所以後面的紀錄會自然覆蓋同一個月的舊紀錄，確保資料是最新
    data[order.orderCode][monthKey] = {
      dose: order.dose,
      unit: unit, // 從藥物主檔補上單位
      frequency: order.frequency || order.note,
      isDraft: false,
    }
  })

  // 2. 處理草稿 (邏輯不變，依然是覆蓋在最上層)
  rawMedDrafts.value.forEach((draft) => {
    const monthKey = draft.targetMonth
    if (!data[draft.orderCode]) {
      data[draft.orderCode] = {}
    }
    data[draft.orderCode][monthKey] = {
      dose: draft.dose,
      unit: draft.unit,
      frequency: draft.frequency || draft.note,
      isDraft: true,
    }
  })

  return data
})

const isDraftChanged = computed(() => {
  if (Object.keys(orderDraft).length === 0) return false
  return JSON.stringify(orderDraft) !== JSON.stringify(initialDraftState.value)
})

function toggleDraftPanel() {
  if (!isDraftPanelVisible.value) {
    initializeDraft()
  }
  isDraftPanelVisible.value = !isDraftPanelVisible.value
}

function initializeDraft() {
  const newDraft = {}
  const targetMonth = draftTargetMonth.value

  allMedsMaster.value.forEach((med) => {
    const orderForTargetMonth = processedOrders.value[med.code]?.[targetMonth]

    let lastOrder = null
    if (!orderForTargetMonth) {
      const historicalOrdersForMed = processedOrders.value[med.code]
      if (historicalOrdersForMed) {
        const sortedMonths = Object.keys(historicalOrdersForMed)
          .filter((m) => !historicalOrdersForMed[m].isDraft && m < targetMonth)
          .sort()
          .reverse()
        const latestHistoricalMonth = sortedMonths[0]
        if (latestHistoricalMonth) {
          lastOrder = historicalOrdersForMed[latestHistoricalMonth]
        }
      }
    }

    newDraft[med.code] = {
      dose: orderForTargetMonth?.dose || lastOrder?.dose || '',
      frequency: orderForTargetMonth?.frequency || lastOrder?.frequency || '',
    }
  })

  Object.assign(orderDraft, newDraft)
  initialDraftState.value = JSON.parse(JSON.stringify(newDraft))
}

const formatDateFromTimestamp = (timestamp) => {
  if (!timestamp) return ''
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp)
  return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`
}

async function fetchData() {
  if (!props.patient?.id) {
    isLoading.value = false
    return
  }
  isLoading.value = true
  error.value = null
  try {
    const twoYearsAgo = new Date()
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2)
    const twoYearsAgoStr = twoYearsAgo.toISOString().split('T')[0]

    const [allReports, allOrders, allDrafts] = await Promise.all([
      labReportsApi.fetchAll(),
      ordersApi.fetchAll(),
      draftOrdersApi.fetchAll(),
    ])

    // Client-side filtering for lab reports
    const reports = allReports
      .filter((r) => r.patientId === props.patient.id)
      .filter((r) => {
        const reportDate = r.reportDate
        if (typeof reportDate === 'string') {
          return reportDate >= twoYearsAgoStr
        }
        return true
      })
      .sort((a, b) => {
        const dateA = typeof a.reportDate === 'string' ? a.reportDate : ''
        const dateB = typeof b.reportDate === 'string' ? b.reportDate : ''
        return dateB.localeCompare(dateA)
      })

    rawLabReports.value = reports.map((r) => ({
      ...r,
      reportDate: formatDateFromTimestamp(r.reportDate),
      // 將後端的 results 欄位映射為 data，確保與 processedLabs 邏輯相容
      data: r.results || r.data || {},
    }))

    // Client-side filtering for medication orders
    const orders = allOrders
      .filter((o) => o.patientId === props.patient.id)
      .filter((o) => {
        const uploadTimestamp = o.uploadTimestamp
        if (!uploadTimestamp) return false
        const uploadDate =
          typeof uploadTimestamp === 'string'
            ? new Date(uploadTimestamp)
            : uploadTimestamp.toDate
              ? uploadTimestamp.toDate()
              : new Date(uploadTimestamp)
        return uploadDate >= twoYearsAgo
      })
      .sort((a, b) => {
        const dateA = a.uploadTimestamp
          ? a.uploadTimestamp.toDate
            ? a.uploadTimestamp.toDate()
            : new Date(a.uploadTimestamp)
          : new Date(0)
        const dateB = b.uploadTimestamp
          ? b.uploadTimestamp.toDate
            ? b.uploadTimestamp.toDate()
            : new Date(b.uploadTimestamp)
          : new Date(0)
        return dateB - dateA
      })

    rawMedOrders.value = orders.map((order) => {
      const uploadDate = order.uploadTimestamp?.toDate
        ? order.uploadTimestamp.toDate()
        : order.uploadTimestamp
          ? new Date(order.uploadTimestamp)
          : null
      if (uploadDate) {
        const year = uploadDate.getFullYear()
        const month = (uploadDate.getMonth() + 1).toString().padStart(2, '0')
        return { ...order, uploadMonth: `${year}-${month}` }
      }
      return order
    })

    // Client-side filtering for medication drafts
    const drafts = allDrafts.filter(
      (d) => d.patientId === props.patient.id && d.status === 'pending',
    )

    rawMedDrafts.value = drafts
  } catch (err) {
    console.error('獲取資料失敗:', err)
    error.value = err.message
  } finally {
    isLoading.value = false
  }
}

async function saveDraftOrders() {
  if (!isDraftChanged.value) {
    alert('藥囑草稿未變更，無需儲存。')
    return
  }
  isSubmitting.value = true

  try {
    // 1. 獲取並刪除舊草稿
    const allDrafts = await draftOrdersApi.fetchAll()
    const oldDrafts = allDrafts.filter(
      (d) => d.patientId === props.patient.id && d.targetMonth === draftTargetMonth.value,
    )
    const deletePromises = oldDrafts.map((draft) => draftOrdersApi.delete(draft.id))
    await Promise.all(deletePromises)

    // 2. 創建新草稿
    const createPromises = []
    for (const medCode in orderDraft) {
      const draft = orderDraft[medCode]
      if (draft.dose || draft.frequency) {
        const medInfo = allMedsMaster.value.find((m) => m.code === medCode)
        createPromises.push(
          draftOrdersApi.create({
            patientId: props.patient.id,
            patientName: props.patient.name,
            medicalRecordNumber: props.patient.medicalRecordNumber,
            targetMonth: draftTargetMonth.value,
            status: 'pending',
            createdAt: new Date(),
            authorId: currentUser.value.uid,
            authorName: currentUser.value.name,
            orderCode: medInfo.code,
            orderName: medInfo.tradeName,
            orderType: medInfo.type,
            dose: draft.dose,
            unit: medInfo.unit,
            frequency: medInfo.type === 'oral' ? draft.frequency : '',
            note: medInfo.type === 'injection' ? draft.frequency : '',
          }),
        )
      }
    }
    await Promise.all(createPromises)

    alert('藥囑草稿儲存成功！')
    await fetchData()
  } catch (error) {
    console.error('儲存藥囑草稿失敗:', error)
    alert(`儲存藥囑草稿時發生錯誤: ${error.message}`)
  } finally {
    isSubmitting.value = false
  }
}

function getAbnormalClass(itemKey, value) {
  const range = LAB_REFERENCE_RANGES[itemKey]
  if (!range || value === undefined) return ''
  if (range.min !== undefined && value < range.min) return 'value-low'
  if (range.max !== undefined && value > range.max) return 'value-high'
  return ''
}

watch(
  () => props.patient?.id,
  (newPatientId) => {
    rawLabReports.value = []
    rawMedOrders.value = []
    rawMedDrafts.value = []
    Object.keys(orderDraft).forEach((key) => delete orderDraft[key])
    initialDraftState.value = {}
    isDraftPanelVisible.value = false
    if (newPatientId) {
      fetchData()
    } else {
      isLoading.value = false
    }
  },
  { immediate: true },
)
</script>

<style scoped>
/* 所有樣式與前一版完全相同，除了 correlation-content 和 main-table-area */
.correlation-view-container {
  height: 100%;
  display: flex;
  flex-direction: column;
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

.correlation-content {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow-y: auto; /* ✨ 修改點 1: 新增此行，讓整個內容區可以滾動 */
}

/* 註解：sticky-actions-panel 樣式存在但未使用，予以保留 */
.sticky-actions-panel {
  flex-shrink: 0;
  position: sticky;
  top: 0;
  z-index: 10;
  background-color: #f8f9fa;
  margin: 1rem 1rem 0 1rem;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}
.actions-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem;
  background-color: #e9ecef;
  border-radius: 8px 8px 0 0;
  border: 1px solid #dee2e6;
  border-bottom: none;
}
.header-info {
  font-weight: 500;
  color: #495057;
}
.draft-edit-btn-main {
  padding: 0.5rem 1rem;
  border: none;
  background-color: #007bff;
  color: white;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}
.draft-edit-btn-main:hover {
  background-color: #0056b3;
}

.draft-editor-body {
  padding: 1.5rem;
  background-color: #fff;
  border: 1px solid #dee2e6;
  border-top: none;
}
.draft-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 1.5rem;
}
.draft-group h4 {
  margin: 0 0 1rem 0;
  border-bottom: 1px solid #e9ecef;
  padding-bottom: 0.5rem;
}
.draft-input-row {
  display: grid;
  grid-template-columns: 100px 1fr;
  align-items: center;
  margin-bottom: 0.75rem;
}
.draft-input-row label {
  font-weight: 500;
  font-size: 0.9rem;
}
.order-input-cell {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 8px;
  align-items: center;
}
.order-input-cell input {
  width: 100%;
  border: 1px solid #ced4da;
  border-radius: 4px;
  padding: 0.5rem;
  text-align: center;
}
.unit-display {
  padding: 0 0.5rem;
  font-size: 0.9em;
  color: #6c757d;
}
.draft-editor-footer {
  margin-top: 1.5rem;
  padding-top: 1rem;
  border-top: 1px solid #e9ecef;
  text-align: right;
}
.btn-primary {
  padding: 0.6rem 1.2rem;
  border-radius: 6px;
  border: none;
  font-weight: 500;
  cursor: pointer;
  background-color: #28a745;
  color: white;
}
.btn-primary:disabled {
  background-color: #6c757d;
}

.main-table-area {
  /* overflow-y: auto; */ /* ✨ 修改點 2: 移除此行 */
  padding: 1rem;
  /* min-height: 0; */ /* ✨ 修改點 3: 移除此行 */
}
.data-group-section:not(:last-child) {
  margin-bottom: 2rem;
}
.data-group-section h3 {
  margin: 0 0 1rem 0;
  font-size: 1.25rem;
  color: #343a40;
}

.table-wrapper {
  width: 100%;
  overflow-x: auto;
  border: 1px solid #dee2e6;
  border-radius: 8px;
}
.correlation-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  min-width: max-content;
}
.correlation-table th,
.correlation-table td {
  padding: 0.75rem;
  text-align: center;
  white-space: nowrap;
  border-bottom: 1px solid #e9ecef;
  border-right: 1px solid #e9ecef;
  min-width: 120px;
}
.correlation-table tr th:first-child,
.correlation-table tr td:first-child {
  border-left: none;
}
.correlation-table tr:last-child td {
  border-bottom: none;
}
.correlation-table th:last-of-type,
.correlation-table td:last-of-type {
  border-right: none;
}

.sub-header-row th {
  background-color: #f8f9fa;
  font-weight: 600;
  position: sticky;
  top: 0;
  z-index: 2;
}
.sticky-col.first-col {
  position: sticky;
  left: 0;
  z-index: 1;
  font-weight: bold;
  background-color: #f8f9fa;
  border-right: 2px solid #dee2e6 !important;
}
thead .sticky-col.first-col {
  z-index: 3;
}

tbody .lab-data-cell {
  background-color: #fff;
}
tbody .med-data-cell {
  background-color: #f8f9fa;
}
tbody tr:hover td {
  background-color: #e9ecef !important;
}

.value-high {
  color: #dc3545;
  font-weight: bold;
}
.value-low {
  color: #007bff;
  font-weight: bold;
}
.no-data {
  color: #adb5bd;
}
</style>
