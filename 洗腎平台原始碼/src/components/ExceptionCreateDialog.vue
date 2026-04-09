<!-- 檔案路徑: src/components/ExceptionCreateDialog.vue (功能增強版) -->
<template>
  <div v-if="isVisible" class="dialog-overlay" v-overlay-close="close">
    <div class="dialog-content">
      <header class="dialog-header">
        <h2>{{ dialogTitle }}</h2>
        <button class="close-button" @click="close">×</button>
      </header>
      <main class="dialog-body">
        <!-- 步驟 1: 選擇病人 -->
        <fieldset class="step-group">
          <legend>步驟 1: 選擇主要病人</legend>
          <button
            class="select-btn"
            @click="isPatientDialogVisible = true"
            :disabled="isSubmitting || isEditingMode"
          >
            <div
              v-if="formData.patientId"
              class="patient-display-content"
              v-html="selectedPatientDisplay"
            ></div>
            <span v-else class="text-muted">點擊以選擇病人...</span>
          </button>
        </fieldset>

        <div class="subsequent-steps" :class="{ disabled: !formData.patientId }">
          <!-- 步驟 2: 選擇調班類型 -->
          <fieldset class="step-group">
            <legend>步驟 2: 選擇調班類型</legend>
            <div class="radio-group">
              <label
                ><input
                  type="radio"
                  v-model="formData.type"
                  value="MOVE"
                  :disabled="isEditingMode"
                />
                臨時調班</label
              >
              <label
                ><input
                  type="radio"
                  v-model="formData.type"
                  value="SUSPEND"
                  :disabled="isEditingMode"
                />
                區間暫停</label
              >
              <label
                ><input
                  type="radio"
                  v-model="formData.type"
                  value="ADD_SESSION"
                  :disabled="isEditingMode"
                />
                臨時加洗</label
              >
              <label
                ><input
                  type="radio"
                  v-model="formData.type"
                  value="SWAP"
                  :disabled="isEditingMode"
                />
                同日互調</label
              >
            </div>
          </fieldset>

          <!-- 步驟 3: 設定調班資訊 -->
          <fieldset class="step-group" v-if="formData.type">
            <legend>步驟 3: 設定調班資訊</legend>

            <!-- MOVE -->
            <div v-if="formData.type === 'MOVE'" class="details-section">
              <div class="form-group-grid">
                <div class="form-group">
                  <label for="sourceDate">原始日期</label>
                  <input
                    type="date"
                    id="sourceDate"
                    v-model="formData.from.sourceDate"
                    @change="fetchSourceSchedule"
                    :disabled="isEditingMode"
                  />
                </div>
                <div class="form-group">
                  <label>原始排班</label>
                  <div class="info-box">{{ sourceBedDisplay }}</div>
                </div>
              </div>
              <div class="form-group-grid" v-if="formData.from.bedNum">
                <div class="form-group">
                  <label for="targetDate">目標日期</label>
                  <input type="date" id="targetDate" v-model="formData.to.goalDate" />
                </div>
                <div class="form-group">
                  <label>目標床位</label>
                  <button
                    class="select-btn"
                    @click="openBedAssignmentForTarget"
                    :disabled="!formData.to.goalDate || isSubmitting"
                  >
                    {{ targetBedDisplay }}
                  </button>
                </div>
              </div>
            </div>

            <!-- SUSPEND -->
            <div v-if="formData.type === 'SUSPEND'" class="details-section">
              <div class="form-group-grid">
                <div class="form-group">
                  <label for="startDate">開始日期 (包含)</label>
                  <input
                    type="date"
                    id="startDate"
                    v-model="formData.startDate"
                    :disabled="isEditingMode"
                  />
                </div>
                <div class="form-group">
                  <label for="endDate">結束日期 (包含)</label>
                  <input
                    type="date"
                    id="endDate"
                    v-model="formData.endDate"
                    :disabled="isEditingMode"
                  />
                </div>
              </div>
            </div>

            <!-- ADD_SESSION -->
            <div v-if="formData.type === 'ADD_SESSION'" class="details-section">
              <div class="form-group-grid">
                <div class="form-group">
                  <label for="addSessionDate">加洗日期</label>
                  <input type="date" id="addSessionDate" v-model="formData.to.goalDate" />
                </div>
                <div class="form-group">
                  <label>目標床位</label>
                  <button
                    class="select-btn"
                    @click="openBedAssignmentForTarget"
                    :disabled="!formData.to.goalDate || isSubmitting"
                  >
                    {{ targetBedDisplay }}
                  </button>
                </div>
              </div>
            </div>

            <!-- SWAP -->
            <div v-if="formData.type === 'SWAP'" class="details-section">
              <div class="form-group">
                <label for="swapDate">互調日期</label>
                <input
                  type="date"
                  id="swapDate"
                  v-model="formData.date"
                  @change="fetchScheduleForSwap"
                  :disabled="isEditingMode"
                />
              </div>
              <div class="form-group-grid" v-if="formData.date">
                <div class="form-group">
                  <label>病人 A (主要病人)</label>
                  <div class="info-box">{{ patientA_SwapDisplay }}</div>
                </div>
                <div class="form-group">
                  <label>病人 B (選擇互調對象)</label>
                  <select
                    v-model="patientB_SwapSelection"
                    class="swap-select"
                    :disabled="!formData.patient1 || isFetchingSwapSchedule"
                  >
                    <option disabled value="">
                      {{ formData.patient1 ? '請選擇...' : '請先確認病人A排班' }}
                    </option>
                    <option
                      v-for="slot in availableSlotsForPatientB"
                      :key="slot.key"
                      :value="slot.key"
                    >
                      {{ slot.displayText }}
                    </option>
                  </select>
                </div>
              </div>
            </div>
          </fieldset>

          <!-- 步驟 4: 原因說明 -->
          <fieldset class="step-group">
            <legend>步驟 4: 原因說明</legend>
            <div class="form-group">
              <textarea v-model="formData.reason" rows="2" placeholder="請簡要說明原因"></textarea>
            </div>
          </fieldset>
        </div>
      </main>
      <!-- 🔥🔥🔥【核心修改 #1】🔥🔥🔥 -->
      <footer class="dialog-footer">
        <!-- 如果是編輯模式 (解決衝突)，顯示三個按鈕 -->
        <div v-if="isEditingMode" class="footer-editing-mode">
          <button class="btn btn-danger" @click="handleDelete" :disabled="isSubmitting">
            撤銷此申請
          </button>
          <div>
            <button class="btn btn-secondary" @click="close">取消修改</button>
            <button
              class="btn btn-primary"
              @click="submitForm"
              :disabled="!isFormValid || isSubmitting"
            >
              {{ isSubmitting ? '提交中...' : '重新提交申請' }}
            </button>
          </div>
        </div>
        <!-- 否則，顯示正常的兩個按鈕 -->
        <div v-else class="footer-normal-mode">
          <button class="btn btn-secondary" @click="close">取消</button>
          <button
            class="btn btn-primary"
            @click="submitForm"
            :disabled="!isFormValid || isSubmitting"
          >
            {{ isSubmitting ? '提交中...' : '提交申請' }}
          </button>
        </div>
      </footer>
    </div>
  </div>

  <!-- Child Dialogs -->
  <PatientSelectDialog
    :is-visible="isPatientDialogVisible"
    :patients="allPatients"
    :show-fill-options="false"
    title="選擇病人"
    @confirm="handlePatientSelected"
    @cancel="isPatientDialogVisible = false"
  />
  <BedAssignmentDialog
    v-if="isBedAssignmentVisible"
    :is-visible="isBedAssignmentVisible"
    :all-patients="[allPatients.find((p) => p.id === formData.patientId)]"
    :bed-layout="bedLayout"
    :schedule-data="bedAssignmentProps.scheduleData"
    :target-date="bedAssignmentProps.targetDate"
    :shifts="shifts"
    :freq-map="freqMap"
    :assignment-mode="bedAssignmentProps.assignmentMode"
    :hide-patient-list="true"
    @close="isBedAssignmentVisible = false"
    @assign-bed="handleTargetBedAssigned"
  />
</template>

<script setup>
import { ref, reactive, computed, watch } from 'vue'
import ApiManager from '@/services/api_manager'
import PatientSelectDialog from '@/components/PatientSelectDialog.vue'
import BedAssignmentDialog from '@/components/BedAssignmentDialog.vue'
import { ORDERED_SHIFT_CODES } from '@/constants/scheduleConstants.js'
import { formatDateToYYYYMMDD } from '@/utils/dateUtils'
import { escapeHtml } from '@/utils/sanitize.js'

const exceptionsApi = ApiManager('schedule_exceptions')

// Props & Emits
const props = defineProps({
  isVisible: Boolean,
  allPatients: Array,
  isPageLocked: Boolean,
  initialData: { type: Object, default: null },
})
// 🔥【核心修改 #3】新增 'delete' 事件
const emit = defineEmits(['close', 'submit', 'delete'])

// ... (其他 API 和 Constants 保持不變) ...
const schedulesApi = ApiManager('schedules')
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

// ... (所有 Dialog State 和 Form State 保持不變) ...
const isPatientDialogVisible = ref(false)
const isBedAssignmentVisible = ref(false)
const bedAssignmentProps = ref(null)
const isSubmitting = ref(false)
const isFetchingSource = ref(false)
const sourceScheduleMessage = ref('')
const dailyScheduleForSwap = ref(null)
const isFetchingSwapSchedule = ref(false)
const patientB_SwapSelection = ref('')
const defaultFormData = () => ({
  id: null,
  patientId: '',
  patientName: '',
  type: null,
  date: '',
  startDate: '',
  endDate: '',
  reason: '',
  from: { sourceDate: '', bedNum: null, shiftCode: null },
  to: { goalDate: '', bedNum: null, shiftCode: null },
  patient1: null,
  patient2: null,
})
const formData = reactive(defaultFormData())

// ... (所有 Computed Properties 保持不變) ...
const dialogTitle = computed(() => {
  if (isEditingMode.value) return '解決排程衝突'
  const typeMap = {
    MOVE: '臨時調班',
    SUSPEND: '區間暫停',
    ADD_SESSION: '臨時加洗',
    SWAP: '同日互調',
  }
  const title = typeMap[formData.type] ? ` - ${typeMap[formData.type]}` : ''
  return `新增調班申請${title}`
})
const isEditingMode = computed(() => !!props.initialData)
const selectedPatientDisplay = computed(() => {
  if (!formData.patientId) return ''
  const patient = props.allPatients.find((p) => p.id === formData.patientId)
  if (!patient) return ''
  // ✨ XSS 防護：對病人資料進行轉義
  const nameAndMRN = `${escapeHtml(patient.name)} (${escapeHtml(patient.medicalRecordNumber)})`
  const freqText = patient.freq
    ? ` <span class="patient-info-tag freq-tag">[${escapeHtml(patient.freq)}]</span>`
    : ''
  let diseasesText = ''
  if (patient.diseases && patient.diseases.length > 0) {
    diseasesText = patient.diseases
      .map((d) => `<span class="patient-info-tag disease-tag">${escapeHtml(d)}</span>`)
      .join(' ')
  }
  return `${nameAndMRN}${freqText} ${diseasesText}`
})
const sourceBedDisplay = computed(() => {
  if (isFetchingSource.value) return '查詢中...'
  if (sourceScheduleMessage.value) return sourceScheduleMessage.value
  if (formData.from.bedNum && formData.from.shiftCode) {
    const shiftDisplayMap = { early: '早', noon: '午', late: '晚' }
    const shiftText = shiftDisplayMap[formData.from.shiftCode] || formData.from.shiftCode
    const bedText = String(formData.from.bedNum).startsWith('peripheral')
      ? `外圍 ${formData.from.bedNum.split('-')[1]}`
      : `${formData.from.bedNum}床`
    return `${bedText} / ${shiftText}班`
  }
  return '待查詢...'
})
const targetBedDisplay = computed(() => {
  if (formData.to.bedNum && formData.to.shiftCode) {
    const shiftDisplayMap = { early: '早', noon: '午', late: '晚' }
    const shiftText = shiftDisplayMap[formData.to.shiftCode] || formData.to.shiftCode
    const bedText = String(formData.to.bedNum).startsWith('peripheral')
      ? `外圍 ${formData.to.bedNum.split('-')[1]}`
      : `${formData.to.bedNum}床`
    return `${bedText} / ${shiftText}班`
  }
  return '點擊以選擇目標床位...'
})
const patientA_SwapDisplay = computed(() => {
  if (!formData.date) return '請先選擇日期...'
  if (isFetchingSwapSchedule.value) return '查詢排班中...'
  if (!formData.patient1) return `當日無 ${formData.patientName} 的排班`
  const { fromBedNum, fromShiftCode } = formData.patient1
  const shiftDisplayMap = { early: '早', noon: '午', late: '晚' }
  const shiftText = shiftDisplayMap[fromShiftCode] || fromShiftCode
  const bedText = String(fromBedNum).startsWith('peripheral')
    ? `外圍 ${fromBedNum.split('-')[1]}`
    : `${fromBedNum}床`
  return `${formData.patientName} (${bedText} / ${shiftText}班)`
})
const availableSlotsForPatientB = computed(() => {
  if (!dailyScheduleForSwap.value || !formData.patient1) return []
  const shiftDisplayMap = { early: '早', noon: '午', late: '晚' }
  const shiftOrderMap = { early: 1, noon: 2, late: 3 }
  const getSortableBedNumber = (bedNum) => {
    if (typeof bedNum === 'string' && bedNum.startsWith('peripheral-')) {
      return 1000 + parseInt(bedNum.split('-')[1], 10)
    }
    return parseInt(bedNum, 10)
  }
  const slots = Object.entries(dailyScheduleForSwap.value)
    .filter(([key, slot]) => slot && slot.patientId && slot.patientId !== formData.patientId)
    .map(([key, slot]) => {
      const patient = props.allPatients.find((p) => p.id === slot.patientId)
      const patientName = patient ? patient.name : slot.patientName || `ID: ${slot.patientId}`
      const parts = key.split('-')
      const shiftCode = parts.pop()
      const bedNum = key.replace(`-${shiftCode}`, '').replace('bed-', '')
      const shiftText = shiftDisplayMap[shiftCode] || shiftCode
      const bedText = String(bedNum).startsWith('peripheral')
        ? `外圍 ${bedNum.split('-')[1]}`
        : `${bedNum}床`
      return {
        key: key,
        displayText: `${patientName} (${bedText} / ${shiftText}班)`,
        data: {
          patientId: slot.patientId,
          patientName: patientName,
          fromBedNum: bedNum,
          fromShiftCode: shiftCode,
        },
      }
    })
  return slots.sort((a, b) => {
    const shiftOrderA = shiftOrderMap[a.data.fromShiftCode] || 99
    const shiftOrderB = shiftOrderMap[b.data.fromShiftCode] || 99
    if (shiftOrderA !== shiftOrderB) {
      return shiftOrderA - shiftOrderB
    }
    const bedA = getSortableBedNumber(a.data.fromBedNum)
    const bedB = getSortableBedNumber(b.data.fromBedNum)
    return bedA - bedB
  })
})
const isDetailsComplete = computed(() => {
  if (!formData.type) return false
  switch (formData.type) {
    case 'MOVE':
      return !!formData.from.bedNum && !!formData.to.bedNum && !!formData.to.goalDate
    case 'SUSPEND':
      return !!formData.startDate && !!formData.endDate && formData.endDate >= formData.startDate
    case 'ADD_SESSION':
      return !!formData.to.goalDate && !!formData.to.bedNum && !!formData.to.shiftCode
    case 'SWAP':
      return !!formData.date && !!formData.patient1 && !!formData.patient2
    default:
      return false
  }
})
const isFormValid = computed(
  () => isDetailsComplete.value && (isEditingMode.value || !!formData.reason.trim()),
) // 編輯模式下原因非必填

// ... (所有 Watchers 保持不變) ...
watch(
  () => props.isVisible,
  (isVisible) => {
    if (isVisible) {
      if (props.initialData) {
        Object.assign(formData, {
          ...defaultFormData(),
          ...JSON.parse(JSON.stringify(props.initialData)),
          reason: '',
          to: {
            goalDate:
              props.initialData.to?.goalDate ||
              props.initialData.from?.sourceDate ||
              formatDateToYYYYMMDD(),
            bedNum: null,
            shiftCode: null,
          },
        })
      } else {
        Object.assign(formData, defaultFormData())
      }
    }
  },
)
watch(
  () => formData.type,
  (newType) => {
    const keptData = {
      patientId: formData.patientId,
      patientName: formData.patientName,
      type: newType,
    }
    Object.assign(formData, { ...defaultFormData(), ...keptData })
    sourceScheduleMessage.value = ''
    dailyScheduleForSwap.value = null
    patientB_SwapSelection.value = ''
  },
)
watch(patientB_SwapSelection, (selectionKey) => {
  const selectedSlot = availableSlotsForPatientB.value.find((s) => s.key === selectionKey)
  formData.patient2 = selectedSlot ? selectedSlot.data : null
})

// ... (close, handlePatientSelected, fetchSourceSchedule, fetchScheduleForSwap, openBedAssignmentForTarget, handleTargetBedAssigned, submitForm 這些 Methods 保持不變) ...
function close() {
  emit('close')
}
function handlePatientSelected({ patientId }) {
  const patient = props.allPatients.find((p) => p.id === patientId)
  if (patient) {
    formData.patientId = patient.id
    formData.patientName = patient.name
  }
  isPatientDialogVisible.value = false
}
async function fetchSourceSchedule() {
  if (!formData.from.sourceDate || !formData.patientId) return
  isFetchingSource.value = true
  sourceScheduleMessage.value = ''
  formData.from.bedNum = null
  formData.from.shiftCode = null
  try {
    const record = await schedulesApi.fetchById(formData.from.sourceDate)
    if (record && record.schedule) {
      for (const shiftId in record.schedule) {
        if (record.schedule[shiftId].patientId === formData.patientId) {
          const parts = shiftId.split('-')
          const shiftCode = parts.pop()
          const bedNum = shiftId.replace(`-${shiftCode}`, '').replace('bed-', '')
          formData.from.bedNum = bedNum
          formData.from.shiftCode = shiftCode
          return
        }
      }
    }
    sourceScheduleMessage.value = '當日無此病人排班'
  } catch (error) {
    console.error('查詢原始排班失敗:', error)
    sourceScheduleMessage.value = '查詢失敗'
  } finally {
    isFetchingSource.value = false
  }
}
async function fetchScheduleForSwap() {
  if (!formData.date || !formData.patientId) {
    dailyScheduleForSwap.value = null
    formData.patient1 = null
    return
  }
  isFetchingSwapSchedule.value = true
  dailyScheduleForSwap.value = null
  formData.patient1 = null
  patientB_SwapSelection.value = ''
  try {
    const record = await schedulesApi.fetchById(formData.date)
    const schedule = record && record.schedule ? record.schedule : null
    dailyScheduleForSwap.value = schedule
    if (schedule) {
      for (const [key, slot] of Object.entries(schedule)) {
        if (slot.patientId === formData.patientId) {
          const parts = key.split('-')
          const shiftCode = parts.pop()
          const bedNum = key.replace(`-${shiftCode}`, '').replace('bed-', '')
          formData.patient1 = {
            patientId: formData.patientId,
            patientName: formData.patientName,
            fromBedNum: bedNum,
            fromShiftCode: shiftCode,
          }
          break
        }
      }
    }
  } catch (error) {
    console.error('取得互調排班資料失敗:', error)
  } finally {
    isFetchingSwapSchedule.value = false
  }
}
async function openBedAssignmentForTarget() {
  const patient = props.allPatients.find((p) => p.id === formData.patientId)
  if (!patient) return
  try {
    const dateForSchedule = formData.to.goalDate
    if (!dateForSchedule) return
    const scheduleRecord = await schedulesApi.fetchById(dateForSchedule)
    const dailyScheduleData = scheduleRecord ? scheduleRecord.schedule : {}
    bedAssignmentProps.value = {
      scheduleData: dailyScheduleData,
      targetDate: dateForSchedule,
      assignmentMode: 'singleDay',
    }
    isBedAssignmentVisible.value = true
  } catch (error) {
    console.error('開啟智慧排床失敗:', error)
    alert('開啟智慧排床失敗，請稍後再試。')
  }
}
function handleTargetBedAssigned({ bedNum, shiftCode }) {
  formData.to.bedNum = bedNum
  formData.to.shiftCode = shiftCode
  isBedAssignmentVisible.value = false
}
function submitForm() {
  if (!isFormValid.value) return
  const dataToSubmit = JSON.parse(JSON.stringify(formData))
  switch (dataToSubmit.type) {
    case 'MOVE':
      dataToSubmit.startDate = dataToSubmit.from.sourceDate
      dataToSubmit.endDate = dataToSubmit.to.goalDate
      break
    case 'ADD_SESSION':
      dataToSubmit.startDate = dataToSubmit.to.goalDate
      dataToSubmit.endDate = dataToSubmit.to.goalDate
      dataToSubmit.from = null
      break
    case 'SWAP':
      dataToSubmit.startDate = dataToSubmit.date
      dataToSubmit.endDate = dataToSubmit.date
      dataToSubmit.from = null
      dataToSubmit.to = null
      break
  }
  emit('submit', dataToSubmit)
}

async function handleDelete() {
  if (!isEditingMode.value || !props.initialData?.id) return
  isSubmitting.value = true
  try {
    await exceptionsApi.delete(props.initialData.id)
    emit('delete', props.initialData.id)
  } catch (error) {
    console.error('撤銷申請失敗:', error)
  } finally {
    isSubmitting.value = false
    close()
  }
}
</script>

<style scoped>
/* 🔥【核心修改 #5】新增 footer 樣式 */
.footer-editing-mode,
.footer-normal-mode {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.footer-editing-mode > div {
  display: flex;
  gap: 1rem;
}
.btn-danger {
  background-color: #dc3545;
  color: white;
}
.btn-danger:hover {
  background-color: #c82333;
}
/* ... 其他樣式保持不變 ... */
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
  padding: 1rem;
}
.dialog-content {
  background: #fdfdff;
  border-radius: 12px;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
  width: 100%;
  max-width: 600px;
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
  background-color: #f8f9fa;
  border-bottom-left-radius: 12px;
  border-bottom-right-radius: 12px;
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
  box-shadow: 0 2px 4px rgba(0, 123, 255, 0.2);
}
.btn-primary:hover {
  background-color: #0069d9;
  transform: translateY(-1px);
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
  transform: none;
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
.form-group input[type='date'],
.form-group textarea,
.swap-select {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid #ced4da;
  border-radius: 6px;
  font-size: 1rem;
  box-sizing: border-box;
  background-color: #fff;
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
}
.form-group input:focus,
.form-group textarea:focus,
.swap-select:focus {
  border-color: #80bdff;
  outline: 0;
  box-shadow: 0 0 0 0.2rem rgba(0, 123, 255, 0.25);
}
.form-group textarea {
  resize: vertical;
}
.radio-group {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem 1.5rem;
  align-items: center;
}
.radio-group label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
}
.radio-group input[type='radio'] {
  -webkit-appearance: none;
  appearance: none;
  background-color: #fff;
  margin: 0;
  font: inherit;
  color: currentColor;
  width: 1.15em;
  height: 1.15em;
  border: 0.15em solid #ced4da;
  border-radius: 50%;
  transform: translateY(-0.075em);
  display: grid;
  place-content: center;
}
.radio-group input[type='radio']::before {
  content: '';
  width: 0.65em;
  height: 0.65em;
  border-radius: 50%;
  transform: scale(0);
  transition: 120ms transform ease-in-out;
  box-shadow: inset 1em 1em #007bff;
}
.radio-group input[type='radio']:checked::before {
  transform: scale(1);
}
.radio-group input[type='radio']:checked {
  border-color: #007bff;
}
.details-section {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.form-group-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  align-items: flex-end;
}
.info-box {
  min-height: calc(1.5rem + 0.75rem * 2 + 2px);
  padding: 0.75rem;
  border-radius: 6px;
  border: 1px solid #ced4da;
  background-color: #e9ecef;
  display: flex;
  align-items: center;
  font-weight: 500;
  box-sizing: border-box;
  font-size: 0.95rem;
  color: #495057;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.text-muted {
  color: #6c757d;
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
  transition: border-color 0.2s;
  box-sizing: border-box;
  display: flex;
  align-items: center;
}
.select-btn:disabled {
  background-color: #e9ecef;
  cursor: not-allowed;
}
.select-btn:not(:disabled):hover {
  border-color: #007bff;
}
.patient-display-content {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 1rem;
  line-height: 1.5;
  flex-wrap: wrap;
}
:deep(.patient-info-tag) {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 0.8rem;
  font-weight: 600;
  white-space: nowrap;
}
:deep(.freq-tag) {
  background-color: #e7f3ff;
  color: #0056b3;
  border: 1px solid #b3d7ff;
}
:deep(.disease-tag) {
  background-color: #f8d7da;
  color: #721c24;
  border: 1px solid #f5c6cb;
}
.subsequent-steps.disabled {
  opacity: 0.5;
  pointer-events: none;
}
@media (max-width: 768px) {
  .form-group-grid {
    grid-template-columns: 1fr;
    gap: 1rem;
  }
  .dialog-footer {
    flex-direction: column-reverse;
    gap: 0.75rem;
  }
  .dialog-footer .btn {
    width: 100%;
  }
}
</style>
