<!-- src/components/DailyRecordsSummaryDialog.vue (全新邏輯版) -->
<template>
  <div v-if="isVisible" class="dialog-overlay" v-overlay-close="closeDialog">
    <div class="dialog-content">
      <div class="dialog-header">
        <h3>{{ dialogTitle }}</h3>
        <button @click="closeDialog" class="close-btn" title="關閉">×</button>
      </div>
      <div class="dialog-body">
        <div v-if="isLoading" class="panel-loading">
          <div class="loading-spinner"></div>
          <span>正在載入病情紀錄...</span>
        </div>
        <!-- ✨ 邏輯更新：現在直接檢查 allRecords 的長度 -->
        <div v-else-if="allRecords.length > 0">
          <!-- 不再需要按班別分組 -->
          <div class="shift-section">
            <table class="records-table">
              <thead>
                <tr>
                  <th class="col-bed">床號</th>
                  <th class="col-mrn">病歷號</th>
                  <th class="col-name">病人</th>
                  <th class="col-time">紀錄時間</th>
                  <th class="col-content">紀錄內容</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="record in sortedRecords" :key="record.id">
                  <td class="col-bed">{{ getPatientInfo(record.patientId).bedNum }}</td>
                  <td class="col-mrn">
                    <span
                      class="mrn-clickable"
                      @click="copyMedicalRecordNumber(getPatientInfo(record.patientId).medicalRecordNumber)"
                      :title="getPatientInfo(record.patientId).medicalRecordNumber ? '點擊以複製病歷號' : ''"
                    >
                      {{ getPatientInfo(record.patientId).medicalRecordNumber || '-' }}
                    </span>
                  </td>
                  <td class="col-name">{{ record.patientName || getPatientInfo(record.patientId).name || '-' }}</td>
                  <td class="col-time">{{ formatTime(record.createdAt) }}</td>
                  <td class="col-content">{{ record.content }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div v-else class="panel-empty">
          <p><i class="fas fa-check-circle"></i> 此班別尚無任何病情紀錄</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, computed } from 'vue'
import ApiManager from '@/services/api_manager'

const props = defineProps({
  isVisible: Boolean,
  targetDate: {
    type: String, // YYYY-MM-DD
    required: true,
  },
  // ✨ 步驟 2: 修改 props
  shiftCode: {
    // 用來顯示標題
    type: String, // 'early', 'noon', or 'late'
    default: null,
  },
  patientIds: {
    // 接收病人 ID 列表
    type: Array,
    default: () => [],
  },
  patientInfoMap: {
    // 病人資訊對應表 { patientId: { bedNum, medicalRecordNumber } }
    type: Object,
    default: () => ({}),
  },
})

const emit = defineEmits(['close'])
const closeDialog = () => emit('close')

const conditionRecordsApi = ApiManager('condition_records')
const isLoading = ref(false)
const allRecords = ref([])

const formattedDate = computed(() => {
  if (!props.targetDate) return ''
  try {
    const date = new Date(props.targetDate + 'T00:00:00')
    return date.toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' })
  } catch {
    return props.targetDate
  }
})

const dialogTitle = computed(() => {
  if (props.shiftCode) {
    return `${getShiftDisplayName(props.shiftCode)} 病情紀錄摘要 - ${formattedDate.value}`
  }
  return `本日病情紀錄摘要 - ${formattedDate.value}` // 備用標題
})

function getShiftDisplayName(shiftCode) {
  const map = { early: '早班', noon: '午班', late: '晚班' }
  return map[shiftCode] || '未知班別'
}

function formatTime(timestamp) {
  if (!timestamp) return 'N/A'
  try {
    const date = new Date(timestamp)
    if (isNaN(date.getTime())) return 'N/A'
    return date.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Taipei' })
  } catch {
    return 'N/A'
  }
}

function getPatientInfo(patientId) {
  return props.patientInfoMap[patientId] || { bedNum: '-', medicalRecordNumber: '', name: '' }
}

async function copyMedicalRecordNumber(mrn) {
  if (!mrn) return
  try {
    await navigator.clipboard.writeText(mrn)
  } catch (err) {
    console.error('複製失敗:', err)
  }
}

// 依照床號排序的紀錄
const sortedRecords = computed(() => {
  if (!allRecords.value || allRecords.value.length === 0) return []

  return [...allRecords.value].sort((a, b) => {
    const infoA = getPatientInfo(a.patientId)
    const infoB = getPatientInfo(b.patientId)
    const bedA = infoA.bedNum || ''
    const bedB = infoB.bedNum || ''

    // 先區分一般床位和外圍床位
    const isPeripheralA = bedA.startsWith('外')
    const isPeripheralB = bedB.startsWith('外')

    // 一般床位排在外圍床位前面
    if (isPeripheralA !== isPeripheralB) {
      return isPeripheralA ? 1 : -1
    }

    // 同類床位依數字排序
    const numA = parseInt(bedA.replace('外', ''), 10) || 0
    const numB = parseInt(bedB.replace('外', ''), 10) || 0

    if (numA !== numB) {
      return numA - numB
    }

    // 同一床號的紀錄依時間排序
    const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0
    const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0
    return timeA - timeB
  })
})

async function fetchRecords(date, patientIdList) {
  isLoading.value = true
  allRecords.value = []

  if (!date || !patientIdList || patientIdList.length === 0) {
    isLoading.value = false
    return
  }

  try {
    // Fetch all records and filter client-side
    const allConditionRecords = await conditionRecordsApi.fetchAll()

    // Convert patientIdList to a Set for faster lookups
    const patientIdSet = new Set(patientIdList)

    // Filter by date and patient IDs
    const filteredRecords = allConditionRecords.filter((record) => {
      const recordDate = record.recordDate
      const matchesDate = recordDate === date
      const matchesPatient = patientIdSet.has(record.patientId)
      return matchesDate && matchesPatient
    })

    // Sort by createdAt
    filteredRecords.sort((a, b) => {
      const timeA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : (a.createdAt ? new Date(a.createdAt).getTime() : 0)
      const timeB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : (b.createdAt ? new Date(b.createdAt).getTime() : 0)
      return timeA - timeB
    })

    allRecords.value = filteredRecords
  } catch (error) {
    console.error(`讀取 ${date} 的病情紀錄失敗:`, error)
  } finally {
    isLoading.value = false
  }
}

watch(
  () => props.isVisible,
  (newVal) => {
    if (newVal) {
      fetchRecords(props.targetDate, props.patientIds)
    }
  },
)
</script>

<style scoped>
/* ... 您現有的 Dialog 樣式 ... */
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.6);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1050;
}
.dialog-content {
  background: white;
  border-radius: 12px;
  box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
  width: 90%;
  max-width: 900px;
  display: flex;
  flex-direction: column;
  max-height: 90vh;
}
.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid #e5e5e5;
}
.dialog-header h3 {
  margin: 0;
  font-size: 1.5rem;
}
.close-btn {
  background: none;
  border: none;
  font-size: 2rem;
  cursor: pointer;
  color: #aaa;
  padding: 0;
  line-height: 1;
}
.dialog-body {
  padding: 1.5rem;
  overflow-y: auto;
}

.shift-section {
  margin-bottom: 2rem;
}
.shift-title {
  font-size: 1.25rem;
  padding-bottom: 0.5rem;
  border-bottom: 2px solid #007bff;
  margin-bottom: 1rem;
}
.records-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 1rem;
}
.records-table th,
.records-table td {
  border: 1px solid #ddd;
  padding: 10px 12px;
  text-align: left;
  vertical-align: middle;
}
.records-table th {
  background-color: #f8f9fa;
  font-weight: 600;
}

/* 重新分配欄寬 */
.col-bed {
  width: 8%;
  text-align: center;
}
.col-mrn {
  width: 12%;
  text-align: center;
}
.col-name {
  width: 12%;
}
.col-time {
  width: 12%;
  text-align: center;
}
.col-content {
  width: 56%;
  white-space: pre-wrap;
} /* 讓內容欄更寬 */

/* 病歷號點擊複製樣式 */
.mrn-clickable {
  cursor: pointer;
  color: #007bff;
  text-decoration: underline;
  transition: color 0.2s;
}
.mrn-clickable:hover {
  color: #0056b3;
}

.panel-loading,
.panel-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 2rem;
  color: #6c757d;
  min-height: 200px;
}
.panel-empty i {
  font-size: 1.5rem;
  margin-bottom: 0.5rem;
  opacity: 0.7;
}
.loading-spinner {
  width: 30px;
  height: 30px;
  border: 3px solid #f3f3f3;
  border-top: 3px solid #007bff;
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
</style>
