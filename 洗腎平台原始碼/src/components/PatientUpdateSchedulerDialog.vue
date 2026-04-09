<!-- 檔案路徑: src/components/PatientUpdateSchedulerDialog.vue -->
<template>
  <div v-if="isVisible" class="dialog-overlay" v-overlay-close="close">
    <div class="dialog-content">
      <header class="dialog-header">
        <h2>{{ dialogTitle }}</h2>
        <button class="close-button" @click="close">×</button>
      </header>
      <main class="dialog-body">
        <!-- 步驟 1: 顯示病人資訊 -->
        <fieldset class="step-group">
          <legend>病人資訊</legend>
          <div class="patient-display-content" v-html="selectedPatientDisplay"></div>
        </fieldset>

        <!-- 步驟 2: 設定變更內容 -->
        <fieldset class="step-group">
          <legend>設定變更內容</legend>
          <div class="form-group">
            <label for="effectiveDate">生效日期</label>
            <input type="date" id="effectiveDate" v-model="formData.effectiveDate" />
          </div>

          <!-- 根據 changeType 顯示不同欄位 -->
          <!-- 讓 UPDATE_STATUS 和 RESTORE_PATIENT 共用同一個 UI 區塊 -->
          <div
            v-if="changeType === 'UPDATE_STATUS' || changeType === 'RESTORE_PATIENT'"
            class="form-group"
          >
            <label for="newStatus">
              {{ changeType === 'RESTORE_PATIENT' ? '復原至' : '新身分' }}
            </label>
            <select id="newStatus" v-model="formData.payload.status" @change="onStatusChange">
              <option value="opd">門診</option>
              <option value="ipd">住院</option>
              <option value="er">急診</option>
            </select>
            <input
              v-if="formData.payload.status === 'ipd' || formData.payload.status === 'er'"
              type="text"
              v-model="formData.payload.wardNumber"
              placeholder="請輸入住院床號 (可選)"
              class="ward-number-input"
            />
          </div>

          <div v-if="changeType === 'UPDATE_MODE'" class="form-group">
            <label for="newMode">新透析模式</label>
            <select id="newMode" v-model="formData.payload.mode">
              <option value="HD">HD</option>
              <option value="SLED">SLED</option>
              <option value="CVVHDF">CVVHDF</option>
              <option value="PP">PP</option>
              <option value="DFPP">DFPP</option>
            </select>
          </div>

          <div v-if="changeType === 'UPDATE_FREQ'" class="form-group">
            <label for="newFreq">新透析頻率</label>
            <select id="newFreq" v-model="formData.payload.freq">
              <option v-for="freq in FREQ_OPTIONS" :key="freq" :value="freq">{{ freq }}</option>
            </select>
          </div>

          <div v-if="changeType === 'UPDATE_BASE_SCHEDULE_RULE'" class="details-section">
            <div class="form-group">
              <label>新總表規則</label>
              <button class="select-btn" @click="openBedAssignmentDialog">
                {{ baseRuleDisplay }}
              </button>
            </div>
          </div>

          <div v-if="changeType === 'DELETE_PATIENT'" class="details-section">
            <div class="form-group">
              <label for="deleteReason">刪除原因</label>
              <select id="deleteReason" v-model="formData.payload.deleteReason">
                <option v-for="reason in DELETE_REASONS" :key="reason.value" :value="reason.value">
                  {{ reason.text }}
                </option>
              </select>
            </div>
            <div class="form-group">
              <label for="deleteRemarks">備註</label>
              <textarea
                id="deleteRemarks"
                v-model="formData.payload.remarks"
                rows="2"
                placeholder="請簡要說明 (可選)"
              ></textarea>
            </div>
          </div>
        </fieldset>
      </main>
      <footer class="dialog-footer">
        <button class="btn btn-secondary" @click="close">取消</button>
        <button
          class="btn btn-primary"
          @click="submitForm"
          :disabled="!isFormValid || isSubmitting"
        >
          {{ isSubmitting ? '提交中...' : '提交預約' }}
        </button>
      </footer>
    </div>

    <!-- 子對話框 -->
    <BedAssignmentDialog
      v-if="isBedAssignmentVisible"
      :is-visible="isBedAssignmentVisible"
      :all-patients="allPatients"
      :bed-layout="bedLayout"
      :schedule-data="bedAssignmentScheduleData"
      :shifts="shifts"
      :freq-map="freqMap"
      :context="{ mode: 'change_freq_and_bed', patient: patient }"
      :is-page-locked="false"
      @close="isBedAssignmentVisible = false"
      @assign-bed="handleBedAssigned"
    />
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch } from 'vue'
import ApiManager from '@/services/api_manager'
import BedAssignmentDialog from '@/components/BedAssignmentDialog.vue'
import { ORDERED_SHIFT_CODES } from '@/constants/scheduleConstants.js'
import { useAuth } from '@/composables/useAuth'
import { formatDateToYYYYMMDD, getTomorrow } from '@/utils/dateUtils'
import { escapeHtml } from '@/utils/sanitize.js'

// --- Props & Emits ---
const props = defineProps({
  isVisible: Boolean,
  patient: Object,
  changeType: String,
  allPatients: Array,
  // ✨ 新增 props
  isEditing: {
    type: Boolean,
    default: false,
  },
  initialData: {
    type: Object,
    default: null,
  },
})
const emit = defineEmits(['close', 'submit'])

// --- Composables & Constants ---
const { currentUser } = useAuth()
const schedulesApi = ApiManager('schedules')
const baseSchedulesApi = ApiManager('base_schedules')

const shifts = ORDERED_SHIFT_CODES
const bedLayout = [
  1,
  2,
  3,
  5,
  6,
  7,
  8,
  9,
  11,
  12,
  13,
  15,
  16,
  17,
  18,
  19,
  21,
  22,
  23,
  25,
  26,
  27,
  28,
  29,
  31,
  32,
  33,
  35,
  36,
  37,
  38,
  39,
  51,
  52,
  53,
  55,
  56,
  57,
  58,
  59,
  61,
  62,
  63,
  65,
  ...Array.from({ length: 6 }, (_, i) => `peripheral-${i + 1}`),
]
const freqMap = {
  一三五: [0, 2, 4],
  二四六: [1, 3, 5],
  一四: [0, 3],
  二五: [1, 4],
  三六: [2, 5],
  一五: [0, 4],
  二六: [1, 5],
  每日: [0, 1, 2, 3, 4, 5],
  每周一: [0],
  每周二: [1],
  每周三: [2],
  每周四: [3],
  每周五: [4],
  每周六: [5],
}
const FREQ_OPTIONS = Object.keys(freqMap)
const DELETE_REASONS = [
  { value: '死亡', text: '死亡' },
  { value: '轉外院透析', text: '轉外院透析' },
  { value: '轉PD', text: '轉PD' },
  { value: '腎臟移植', text: '腎臟移植' },
  { value: '轉安寧', text: '轉安寧' },
  { value: '腎功能恢復不須透析', text: '腎功能恢復不須透析' },
]

// --- Reactive State ---
const isSubmitting = ref(false)
const isBedAssignmentVisible = ref(false)
const bedAssignmentScheduleData = ref({})
const formData = reactive({
  effectiveDate: '',
  payload: {},
})

// --- Computed Properties ---
const dialogTitle = computed(() => {
  // ✨ 修改標題
  const baseTitle = props.isEditing ? '修改預約變更' : '預約變更'
  const typeMap = {
    UPDATE_STATUS: '預約身分變更',
    UPDATE_MODE: '預約透析模式變更',
    UPDATE_FREQ: '預約頻率變更',
    UPDATE_BASE_SCHEDULE_RULE: '預約總表規則變更',
    DELETE_PATIENT: '預約刪除病人',
  }
  const typeText = typeMap[props.changeType] ? ` - ${typeMap[props.changeType]}` : ''
  return baseTitle + typeText
})

const selectedPatientDisplay = computed(() => {
  if (!props.patient) return '未選擇病人'
  // ✨ XSS 防護：對病人資料進行轉義
  return `${escapeHtml(props.patient.name)} (${escapeHtml(props.patient.medicalRecordNumber)})`
})

const baseRuleDisplay = computed(() => {
  const { bedNum, shiftIndex, freq } = formData.payload
  if (bedNum !== undefined && shiftIndex !== undefined && freq) {
    const shiftDisplayMap = { 0: '早', 1: '午', 2: '晚' }
    const shiftText = shiftDisplayMap[shiftIndex]
    const bedText = String(bedNum).startsWith('peripheral')
      ? `外圍 ${bedNum.split('-')[1]}`
      : `${bedNum}床`
    return `${bedText} / ${shiftText}班 / ${freq}`
  }
  return '點擊以設定新規則...'
})

const isFormValid = computed(() => {
  if (!formData.effectiveDate) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const effective = new Date(formData.effectiveDate)

  // 生效日期必須是明天或更晚
  if (effective <= today) return false

  switch (props.changeType) {
    case 'UPDATE_STATUS':
      return !!formData.payload.status
    case 'UPDATE_MODE':
      return !!formData.payload.mode
    case 'UPDATE_FREQ':
      return !!formData.payload.freq
    case 'UPDATE_BASE_SCHEDULE_RULE':
      return (
        !!formData.payload.bedNum &&
        formData.payload.shiftIndex !== undefined &&
        !!formData.payload.freq
      )
    case 'DELETE_PATIENT':
      return !!formData.payload.deleteReason

    // ✨✨✨【核心修正】✨✨✨
    // 新增對 RESTORE_PATIENT 的判斷，確保 payload 中有 status
    case 'RESTORE_PATIENT':
      return !!formData.payload.status

    default:
      return false
  }
})

// 同時，也需要擴充 watch 來為 RESTORE_PATIENT 初始化 payload
watch(
  () => props.isVisible,
  (newVal) => {
    if (newVal && props.patient && props.changeType) {
      if (props.isEditing && props.initialData) {
        // 編輯模式：用 initialData 填充表單
        formData.effectiveDate = props.initialData.effectiveDate
        // 相容 changeData (後端) 和 payload (舊格式)
        const payloadData = props.initialData.changeData || props.initialData.payload || {}
        formData.payload = JSON.parse(JSON.stringify(payloadData))
      } else {
        // 新增模式：重置表單
        formData.effectiveDate = getTomorrow()

        switch (props.changeType) {
          case 'UPDATE_STATUS':
            formData.payload = {
              status: props.patient.status,
              wardNumber: props.patient.wardNumber || '',
            }
            break
          case 'UPDATE_MODE':
            formData.payload = { mode: props.patient.mode || 'HD' }
            break
          case 'UPDATE_FREQ':
            formData.payload = { freq: props.patient.freq || '一三五' }
            break
          case 'UPDATE_BASE_SCHEDULE_RULE':
            formData.payload = {}
            break
          case 'DELETE_PATIENT':
            formData.payload = { deleteReason: '轉外院透析', remarks: '' }
            break
          case 'RESTORE_PATIENT':
            formData.payload = { status: 'opd', wardNumber: '' }
            break
          default:
            formData.payload = {}
        }
      }
    }
  }, // ✨✨✨【核心修正】✨✨✨ -> 在這裡補上遺失的大括號
)

// --- Methods ---
function close() {
  emit('close')
}

function onStatusChange() {
  if (formData.payload.status === 'opd') {
    formData.payload.wardNumber = ''
  }
}

// ✨✨✨【核心修正 #3：重寫 openBedAssignmentDialog 函式】✨✨✨
async function openBedAssignmentDialog() {
  try {
    const masterScheduleDoc = await baseSchedulesApi.fetchById('MASTER_SCHEDULE')
    const scheduleData = masterScheduleDoc ? masterScheduleDoc.schedule : {}

    // 將從後端獲取的總表規則，轉換成 BedAssignmentDialog 能理解的 weeklyScheduleMap 格式
    const weeklyScheduleMap = {}
    if (scheduleData) {
      for (const patientId in scheduleData) {
        const rule = scheduleData[patientId]
        if (rule.freq && rule.bedNum !== undefined && rule.shiftIndex !== undefined) {
          const dayIndices = freqMap[rule.freq] || []
          dayIndices.forEach((dayIndex) => {
            const weeklySlotId = `${rule.bedNum}-${rule.shiftIndex}-${dayIndex}`
            // 我們只關心哪些位置被佔用，所以 payload 可以簡化
            weeklyScheduleMap[weeklySlotId] = { patientId }
          })
        }
      }
    }

    // 將處理好的排班資料存入 ref，以便 template 中的 Dialog 可以使用
    bedAssignmentScheduleData.value = weeklyScheduleMap
    // 打開 Dialog
    isBedAssignmentVisible.value = true
  } catch (error) {
    console.error('開啟智慧排床失敗:', error)
    alert('無法載入總表資料，請稍後再試。')
  }
}

function handleBedAssigned({ bedNum, shiftCode, newFreq }) {
  const shiftIndex = shifts.indexOf(shiftCode)
  // 將選擇的結果存入 formData.payload
  formData.payload = { bedNum, shiftIndex, freq: newFreq }
  isBedAssignmentVisible.value = false
}

async function submitForm() {
  if (!isFormValid.value) return
  isSubmitting.value = true

  const dataToSubmit = {
    patientId: props.patient.id,
    patientName: props.patient.name,
    effectiveDate: formData.effectiveDate,
    changeType: props.changeType,
    // 後端使用 changeData 欄位名稱
    changeData: JSON.parse(JSON.stringify(formData.payload)),
    status: 'pending',
    createdBy: {
      uid: currentUser.value.uid,
      name: currentUser.value.name,
    },
    createdAt: new Date(),
  }

  try {
    emit('submit', dataToSubmit)
  } catch (error) {
    console.error('提交預約失敗:', error)
  } finally {
    isSubmitting.value = false
  }
}
</script>

<style scoped>
/* 樣式與 ExceptionCreateDialog.vue 基本相同，您可以直接複製或共用 */
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
  z-index: 1000;
}
.dialog-content {
  background: #fdfdff;
  border-radius: 12px;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
  width: 100%;
  max-width: 550px;
  display: flex;
  flex-direction: column;
  max-height: 90vh;
  border: 1px solid #e0e0e0;
}
.dialog-header {
  padding: 1rem 1.5rem;
  border-bottom: 1px solid #e9ecef;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.dialog-header h2 {
  margin: 0;
  font-size: 1.3rem;
  font-weight: 600;
  color: #333;
}
.close-button {
  border: none;
  background: none;
  font-size: 2rem;
  cursor: pointer;
  color: #888;
}
.dialog-body {
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  overflow-y: auto;
}
.dialog-footer {
  padding: 1rem 1.5rem;
  border-top: 1px solid #e9ecef;
  display: flex;
  justify-content: flex-end;
  gap: 1rem;
}
.btn {
  padding: 0.6rem 1.2rem;
  border-radius: 8px;
  border: 1px solid transparent;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s ease;
}
.btn-primary {
  background-color: #007bff;
  color: white;
}
.btn-primary:hover {
  background-color: #0069d9;
}
.btn-secondary {
  background-color: #6c757d;
  color: white;
}
.btn-secondary:hover {
  background-color: #5a6268;
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.step-group {
  border: 1px solid #dee2e6;
  border-radius: 8px;
  padding: 1.5rem;
  margin: 0;
  position: relative;
}
.step-group legend {
  font-weight: 600;
  color: #0056b3;
  padding: 0 0.5rem;
  margin-left: 1rem;
  font-size: 1rem;
}
.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.form-group label {
  font-weight: 500;
  color: #495057;
}
.form-group input,
.form-group select,
.form-group textarea {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid #ced4da;
  border-radius: 6px;
  font-size: 1rem;
  box-sizing: border-box;
}
.form-group input:focus,
.form-group select:focus,
.form-group textarea:focus {
  border-color: #80bdff;
  outline: 0;
  box-shadow: 0 0 0 0.2rem rgba(0, 123, 255, 0.25);
}
.ward-number-input {
  margin-top: 0.5rem;
}
.details-section {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.select-btn {
  width: 100%;
  min-height: calc(1.5rem + 0.75rem * 2 + 2px);
  padding: 0.75rem;
  border-radius: 6px;
  border: 1px solid #ced4da;
  background-color: #fff;
  cursor: pointer;
  text-align: left;
  font-size: 1rem;
}
.patient-display-content {
  font-weight: 500;
}
</style>
