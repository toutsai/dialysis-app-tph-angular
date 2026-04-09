<!-- 檔案路徑: src/components/BedAssignmentDialog.vue (智慧排序修正版) -->
<template>
  <div>
    <div v-if="isVisible" class="dialog-overlay" v-overlay-close="closeDialog">
      <div class="dialog-content" :class="{ 'no-patient-list': hidePatientList }">
        <div class="dialog-header">
          <h2>{{ dialogTitle }}</h2>
          <button @click="closeDialog" class="close-btn">×</button>
        </div>
        <div class="dialog-body">
          <div class="assignment-grid">
            <div v-if="!hidePatientList" class="column patient-column">
              <div class="column-header">
                <h4>{{ leftColumnTitle }}</h4>
                <select v-if="showFreqSelector && !isEditMode" v-model="selectedFreq">
                  <option value="all">所有頻率</option>
                  <option v-for="(days, freq) in freqMap" :key="freq" :value="freq">
                    {{ freq }}
                  </option>
                </select>
              </div>

              <div v-if="isEditMode" class="current-patient-info">
                <div class="patient-card current-patient">
                  <div class="patient-name">{{ currentPatient.name }}</div>
                  <div class="patient-details">
                    病歷號：{{ currentPatient.medicalRecordNumber }}<br />
                    狀態：{{ getStatusText(currentPatient.status) }}<br />
                    目前頻率：{{ currentPatient.freq }}
                  </div>

                  <div v-if="context?.mode === 'change_freq_and_bed'" class="freq-change-section">
                    <label>新頻率：</label>
                    <select v-model="newFreqSelection" @change="handleFreqChange">
                      <option value="">請選擇新頻率</option>
                      <option v-for="(days, freq) in freqMap" :key="freq" :value="freq">
                        {{ freq }}
                      </option>
                    </select>
                  </div>
                </div>
              </div>

              <div v-else class="patient-groups-container">
                <div
                  v-for="(patients, groupName) in patientGroups"
                  :key="groupName"
                  class="patient-group"
                >
                  <h5 v-if="patients.length > 0" class="group-title">{{ groupName }}</h5>
                  <ul v-if="patients.length > 0" class="item-list patient-list">
                    <li
                      v-for="patient in patients"
                      :key="patient.id"
                      :class="{
                        selected: patient.id === selectedPatientId,
                        pending: isPendingAssignment(patient.id),
                      }"
                      @click="handlePatientClick(patient.id)"
                    >
                      <span class="patient-info-name">
                        {{ patient.name }}
                        <span class="patient-freq">({{ patient.freq || 'N/A' }})</span>
                        <span class="patient-status">
                          -
                          {{
                            patient.status === 'ipd'
                              ? '住院'
                              : patient.status === 'er'
                                ? '急診'
                                : '門診'
                          }}
                        </span>
                        <span v-if="patient.mode && patient.mode !== 'HD'"
                          >- {{ patient.mode }}</span
                        >
                        <span v-if="isPendingAssignment(patient.id)" class="pending-indicator">
                          → {{ getPendingBedInfo(patient.id) }}
                        </span>
                      </span>
                      <div
                        v-if="patient.diseases && patient.diseases.length > 0"
                        class="disease-tags-container"
                      >
                        <span
                          v-for="disease in patient.diseases"
                          :key="disease"
                          class="disease-tag"
                        >
                          {{ disease }}
                        </span>
                      </div>
                    </li>
                  </ul>
                </div>
                <div
                  v-if="Object.values(patientGroups).every((p) => p.length === 0)"
                  class="empty-state"
                >
                  無符合條件的病人
                </div>
              </div>
            </div>

            <div class="column bed-column">
              <div class="column-header">
                <h4>{{ availableBedsTitle }}</h4>
                <select v-model="selectedShiftFilter">
                  <option value="all">所有班別</option>
                  <option v-for="shift in shifts" :key="shift" :value="shift">
                    {{ shiftDisplayNames[shift] }}
                  </option>
                </select>
              </div>

              <div v-if="!canShowBeds" class="empty-state-full">
                {{ bedEmptyMessage }}
              </div>
              <div v-else class="bed-results-grid">
                <div
                  v-for="(beds, shiftCode) in availableBeds"
                  :key="shiftCode"
                  class="shift-group"
                >
                  <h5>{{ shiftDisplayNames[shiftCode] }}</h5>
                  <ul v-if="beds.length > 0" class="item-list bed-list">
                    <li
                      v-for="bed in beds"
                      :key="bed"
                      @click="handleBedClick(bed, shiftCode)"
                      :class="{ 'hepatitis-bed': isHepatitisBed(bed) }"
                    >
                      {{ typeof bed === 'string' ? `外圍 ${bed.split('-')[1]}` : bed }}
                    </li>
                  </ul>
                  <p v-else class="empty-state-small">無可用空床</p>
                </div>
                <div
                  v-if="Object.values(availableBeds).every((b) => b.length === 0) && canShowBeds"
                  class="empty-state-full"
                >
                  此條件下無任何可用空床
                </div>
              </div>
            </div>
          </div>

          <div
            v-if="!isEditMode && pendingAssignments.length > 0 && !hidePatientList"
            class="pending-section"
          >
            <div class="pending-header">
              <h4>待確認排床 ({{ pendingAssignments.length }} 位)</h4>
              <div class="pending-actions">
                <button @click="clearPendingAssignments" class="btn-clear">清空</button>
                <button @click="confirmAllAssignments" class="btn-confirm">確認排床</button>
              </div>
            </div>
            <div class="pending-list">
              <div
                v-for="(assignment, index) in pendingAssignments"
                :key="index"
                class="pending-item"
              >
                <span class="patient-name">{{ assignment.patientName }}</span>
                <span class="assignment-arrow">→</span>
                <span class="bed-info">
                  {{
                    typeof assignment.bedNum === 'string'
                      ? `外圍 ${assignment.bedNum.split('-')[1]}`
                      : assignment.bedNum
                  }}床
                  {{ shiftDisplayNames[assignment.shiftCode] }}
                </span>
                <button @click="removePendingAssignment(index)" class="btn-remove">×</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <AlertDialog
      :is-visible="alertInfo.isVisible"
      :title="alertInfo.title"
      :message="alertInfo.message"
      @confirm="alertInfo.isVisible = false"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount, onMounted } from 'vue'
import AlertDialog from '@/components/AlertDialog.vue'

const props = defineProps({
  isVisible: Boolean,
  title: { type: String, default: null },
  allPatients: { type: Array, required: true },
  bedLayout: { type: Array, required: true },
  scheduleData: { type: Object, required: true },
  targetDate: { type: String, default: null },
  shifts: { type: Array, required: true },
  freqMap: { type: Object, required: true },
  predefinedPatientGroups: { type: Object, default: null },
  assignmentMode: { type: String, default: 'frequency' },
  dayOfWeek: { type: Number, default: 1 },
  context: { type: Object, default: null },
  hidePatientList: { type: Boolean, default: false },
})

const emit = defineEmits(['close', 'assign-bed'])

const selectedFreq = ref('all')
const selectedShiftFilter = ref('all')
const selectedPatientId = ref(null)
const alertInfo = ref({ isVisible: false, title: '', message: '' })
const localAssignedPatientIds = ref(new Set())
const isComponentMounted = ref(false)
const closeDialog = () => {
  if (!isComponentMounted.value) return
  emit('close')
}
const pendingAssignments = ref([])
const newFreqSelection = ref('')

onMounted(() => {
  isComponentMounted.value = true
})
onBeforeUnmount(() => {
  isComponentMounted.value = false
  pendingAssignments.value = []
  localAssignedPatientIds.value.clear()
})

const effectiveDayOfWeek = computed(() => {
  if (props.targetDate) {
    const date = new Date(props.targetDate)
    const day = date.getDay()
    if (day === 0) return 6
    return day - 1
  }
  return props.dayOfWeek
})

const isEditMode = computed(
  () => props.context?.mode === 'change_freq_and_bed' || props.context?.mode === 'change_bed_only',
)
const currentPatient = computed(() =>
  isEditMode.value && props.context?.patient ? props.context.patient : null,
)

const dialogTitle = computed(() => {
  if (props.title) return props.title
  if (props.hidePatientList) return '選擇目標床位'
  if (props.context?.mode === 'change_freq_and_bed')
    return `變更頻率與床位：${currentPatient.value?.name || ''}`
  if (props.context?.mode === 'change_bed_only')
    return `更換床位：${currentPatient.value?.name || ''}`
  return '智慧排班助理'
})

const leftColumnTitle = computed(() =>
  isEditMode.value ? '當前病人資訊' : props.predefinedPatientGroups ? '問題病人列表' : '選擇病人',
)
const showFreqSelector = computed(
  () =>
    (props.assignmentMode === 'frequency' || props.assignmentMode === 'base') &&
    !props.predefinedPatientGroups,
)

const availableBedsTitle = computed(() => {
  const patient = props.allPatients[0]
  const freq = targetFrequency.value
  if (props.hidePatientList)
    return patient && freq ? `選擇目標空床 (${patient.name} - ${freq})` : '選擇目標空床'
  if (freq && freq !== 'all') return `可用空床 (${freq})`
  return '可用空床'
})

const targetFrequency = computed(() => {
  if (props.hidePatientList) return props.allPatients[0]?.freq || null
  if (isEditMode.value) {
    if (props.context?.mode === 'change_freq_and_bed')
      return newFreqSelection.value || currentPatient.value?.freq || null
    return currentPatient.value?.freq || null
  }
  if (selectedPatientId.value) {
    const patient = props.allPatients.find((p) => p.id === selectedPatientId.value)
    return patient?.freq || null
  }
  if (selectedFreq.value !== 'all') return selectedFreq.value
  return null
})

const canShowBeds = computed(() => {
  if (props.hidePatientList) {
    const patient = props.allPatients[0]
    return !!patient?.freq
  }
  if (isEditMode.value) return !!targetFrequency.value
  return !!selectedPatientId.value || selectedFreq.value !== 'all'
})

const bedEmptyMessage = computed(() => {
  if (props.hidePatientList) return '病人無有效頻率，無法查詢空床。'
  if (isEditMode.value) {
    if (props.context?.mode === 'change_freq_and_bed') return '請先選擇新頻率以查詢空床。'
    return currentPatient.value?.freq ? '正在查詢...' : '病人頻率資訊不完整。'
  }
  return '請從左側選擇病人，或從上方選擇一個頻率來查詢空床。'
})

// 🔥🔥 核心修改：重寫 patientGroups 的邏輯以實現自訂排序 🔥🔥
const FREQ_ORDER_MAP = {
  每日: 1,
  一三五: 2,
  二四六: 2,
  一四: 3,
  二五: 3,
  三六: 3,
  一五: 3,
  二六: 3,
  每周一: 4,
  每周二: 4,
  每周三: 4,
  每周四: 4,
  每周五: 4,
  每周六: 4,
}

const patientGroups = computed(() => {
  if (props.predefinedPatientGroups) {
    return props.predefinedPatientGroups
  }

  if (props.assignmentMode === 'frequency' || props.assignmentMode === 'base') {
    const groups = { '未排床 - 急診': [], '未排床 - 住院': [], '未排床 - 門診': [] }
    const unassignedPatients = props.allPatients.filter(
      (p) =>
        !p.isDeleted && !p.isDiscontinued && !localAssignedPatientIds.value.has(p.id) && p.freq,
    )
    const filteredPatients =
      selectedFreq.value === 'all'
        ? unassignedPatients
        : unassignedPatients.filter((p) => p.freq === selectedFreq.value)
    filteredPatients.forEach((patient) => {
      if (patient.status === 'er') groups['未排床 - 急診'].push(patient)
      else if (patient.status === 'ipd') groups['未排床 - 住院'].push(patient)
      else if (patient.status === 'opd') groups['未排床 - 門診'].push(patient)
    })
    return groups
  }

  if (props.assignmentMode === 'singleDay') {
    // 1. 建立所有可能的分組
    const tempGroups = {
      should_ipd: [],
      should_er: [],
      should_opd: [],
      not_should_ipd: [],
      not_should_er: [],
      not_should_opd: [],
    }
    if (!props.allPatients) return {}

    // 2. 將病人放入對應的臨時分組
    props.allPatients.forEach((p) => {
      if (p.isDeleted || localAssignedPatientIds.value.has(p.id) || p.isDiscontinued) return
      const shouldSchedule = shouldPatientBeScheduled(p, effectiveDayOfWeek.value)
      const prefix = shouldSchedule ? 'should' : 'not_should'
      const suffix = p.status // 'ipd', 'er', 'opd'
      const groupKey = `${prefix}_${suffix}`
      if (tempGroups[groupKey]) {
        tempGroups[groupKey].push(p)
      }
    })

    // 3. 定義排序函式
    const sortPatientsByFreq = (a, b) => {
      const orderA = FREQ_ORDER_MAP[a.freq] || 99 // 未定義的頻率先排到後面
      const orderB = FREQ_ORDER_MAP[b.freq] || 99
      return orderA - orderB
    }

    // 4. 對每個臨時分組進行排序
    for (const key in tempGroups) {
      tempGroups[key].sort(sortPatientsByFreq)
    }

    // 5. 按照您要求的順序組裝最終的結果物件
    return {
      '今日應排 - 住院': tempGroups.should_ipd,
      '今日應排 - 急診': tempGroups.should_er,
      '今日應排 - 門診': tempGroups.should_opd,
      '今日非排 (臨洗) - 住院': tempGroups.not_should_ipd,
      '今日非排 (臨洗) - 急診': tempGroups.not_should_er,
      '今日非排 (臨洗) - 門診': tempGroups.not_should_opd,
    }
  }
  return {}
})

const availableBeds = computed(() => {
  const results = {}
  props.shifts.forEach((shiftCode) => {
    if (selectedShiftFilter.value === 'all' || selectedShiftFilter.value === shiftCode) {
      results[shiftCode] = []
    }
  })

  const isSingleDayMode = props.hidePatientList || props.assignmentMode === 'singleDay'
  if (isSingleDayMode) {
    props.bedLayout.forEach((bedNum) => {
      props.shifts.forEach((shiftCode) => {
        if (!results[shiftCode]) return
        const bedIdPart =
          typeof bedNum === 'string' && bedNum.startsWith('peripheral-') ? bedNum : `bed-${bedNum}`
        const dailySlotId = `${bedIdPart}-${shiftCode}`
        if (!props.scheduleData[dailySlotId]?.patientId) {
          results[shiftCode].push(bedNum)
        }
      })
    })
    return results
  }

  const targetFreq = targetFrequency.value
  if (!targetFreq) return {}
  const dayIndices = props.freqMap[targetFreq]
  if (!dayIndices || dayIndices.length === 0) return {}
  const targetPatientId = isEditMode.value ? currentPatient.value?.id : null
  const temporarilyAssignedBeds = new Set(
    pendingAssignments.value.map((a) => `${a.bedNum}-${a.shiftCode}`),
  )
  props.bedLayout.forEach((bedNum) => {
    props.shifts.forEach((shiftCode, shiftIndex) => {
      if (!results[shiftCode] || temporarilyAssignedBeds.has(`${bedNum}-${shiftCode}`)) return
      let isFullyAvailable = true
      for (const dayIndex of dayIndices) {
        const slotIdToCheck = `${bedNum}-${shiftIndex}-${dayIndex}`
        const currentSlotData = props.scheduleData[slotIdToCheck]
        if (currentSlotData?.patientId && currentSlotData.patientId !== targetPatientId) {
          isFullyAvailable = false
          break
        }
      }
      if (isFullyAvailable) {
        results[shiftCode].push(bedNum)
      }
    })
  })
  return results
})

watch(
  () => props.isVisible,
  (newValue) => {
    if (newValue) {
      isComponentMounted.value = true
      const ids = new Set()
      if (props.scheduleData) {
        for (const slotData of Object.values(props.scheduleData)) {
          if (slotData?.patientId) ids.add(slotData.patientId)
        }
      }
      localAssignedPatientIds.value = ids
      if (isEditMode.value) {
        selectedPatientId.value = currentPatient.value?.id || null
        newFreqSelection.value = ''
      } else {
        selectedFreq.value = 'all'
        selectedPatientId.value = null
      }
    } else {
      selectedPatientId.value = null
      selectedShiftFilter.value = 'all'
      newFreqSelection.value = ''
      pendingAssignments.value = []
    }
  },
  { immediate: true },
)

watch(selectedFreq, () => {
  selectedPatientId.value = null
})

function getStatusText(status) {
  return { opd: '門診', ipd: '住院', er: '急診' }[status] || status
}
function handleFreqChange() {}
function handlePatientClick(patientId) {
  selectedPatientId.value = patientId
  selectedFreq.value = 'all'
}
function handleBedClick(bedNum, shiftCode) {
  if (!isComponentMounted.value) return
  let patientIdToAssign = selectedPatientId.value
  if (props.hidePatientList) {
    patientIdToAssign = props.allPatients[0]?.id
  }
  if (!patientIdToAssign && !isEditMode.value) {
    alertInfo.value = {
      isVisible: true,
      title: '操作提示',
      message: '請先從左側選擇一位病人才能排床！',
    }
    return
  }
  const patient = props.allPatients.find((p) => p.id === patientIdToAssign)
  const finalFreq = isEditMode.value
    ? props.context?.mode === 'change_freq_and_bed'
      ? newFreqSelection.value
      : currentPatient.value?.freq
    : patient?.freq
  if (!finalFreq && !props.hidePatientList && props.assignmentMode !== 'singleDay') {
    alertInfo.value = { isVisible: true, title: '操作提示', message: '病人頻率資訊不完整！' }
    return
  }
  const bedIdPart =
    typeof bedNum === 'string' && bedNum.startsWith('peripheral-') ? bedNum : `bed-${bedNum}`
  const shiftId = `${bedIdPart}-${shiftCode}`
  if (isEditMode.value || props.hidePatientList) {
    emit('assign-bed', {
      patientId: patientIdToAssign,
      bedNum,
      shiftCode,
      shiftId,
      newFreq:
        isEditMode.value && props.context?.mode === 'change_freq_and_bed' ? finalFreq : undefined,
    })
    return
  }
  if (!patient) return
  const existingIndex = pendingAssignments.value.findIndex((a) => a.patientId === patientIdToAssign)
  const newAssignment = {
    patientId: patientIdToAssign,
    patientName: patient.name,
    bedNum,
    shiftCode,
    shiftId,
  }
  if (existingIndex !== -1) {
    pendingAssignments.value[existingIndex] = newAssignment
  } else {
    pendingAssignments.value.push(newAssignment)
  }
  localAssignedPatientIds.value.add(patientIdToAssign)
  selectedPatientId.value = null
}
function isPendingAssignment(patientId) {
  return pendingAssignments.value.some((a) => a.patientId === patientId)
}
function getPendingBedInfo(patientId) {
  const assignment = pendingAssignments.value.find((a) => a.patientId === patientId)
  if (!assignment) return ''
  const bedDisplay =
    typeof assignment.bedNum === 'string'
      ? `外圍 ${assignment.bedNum.split('-')[1]}`
      : assignment.bedNum
  return `${bedDisplay}床 ${shiftDisplayNames[assignment.shiftCode]}`
}
function removePendingAssignment(index) {
  const assignment = pendingAssignments.value.splice(index, 1)[0]
  if (assignment) localAssignedPatientIds.value.delete(assignment.patientId)
}
function clearPendingAssignments() {
  pendingAssignments.value.forEach((a) => localAssignedPatientIds.value.delete(a.patientId))
  pendingAssignments.value = []
}
function confirmAllAssignments() {
  if (pendingAssignments.value.length === 0 || !isComponentMounted.value) return
  pendingAssignments.value.forEach((a) => emit('assign-bed', a))
  alertInfo.value = {
    isVisible: true,
    title: '批量排床成功',
    message: `總共排入 ${pendingAssignments.value.length} 位病人，請記得點選右上角"儲存床位"。`,
  }
  pendingAssignments.value = []
}
function shouldPatientBeScheduled(patient, dayOfWeek) {
  if (patient.freq === '臨時') return true
  if (!patient.freq || !props.freqMap) return false
  const scheduledDays = props.freqMap[patient.freq]
  return scheduledDays ? scheduledDays.includes(dayOfWeek) : false
}
const hepatitisBedNumbers = [31, 32, 33, 35, 36]
function isHepatitisBed(bedNum) {
  return typeof bedNum === 'number' && hepatitisBedNumbers.includes(bedNum)
}
const shiftDisplayNames = { early: '早班', noon: '午班', late: '晚班' }
</script>

<style scoped>
/* (所有樣式維持不變) */
.dialog-content.no-patient-list {
  max-width: 800px;
  min-height: 60vh;
}
.dialog-content.no-patient-list .assignment-grid {
  grid-template-columns: 1fr;
}
:root {
  --primary-color: #005a9c;
  --success-color: #16a34a;
  --danger-color: #dc3545;
  --warning-color: #f97316;
  --info-color: #0ea5e9;
}
.current-patient-info {
  padding: 1rem;
  background-color: #fff;
  border-radius: 8px;
  border: 2px solid var(--primary-color, #007bff);
}
.patient-card.current-patient {
  background-color: #f8f9fa;
  border: 1px solid #dee2e6;
  border-radius: 6px;
  padding: 1rem;
  margin-bottom: 1rem;
}
.patient-name {
  font-size: 1.2rem;
  font-weight: bold;
  color: var(--primary-color, #007bff);
  margin-bottom: 0.5rem;
}
.patient-details {
  color: #6c757d;
  line-height: 1.4;
  margin-bottom: 1rem;
}
.freq-change-section {
  border-top: 1px solid #dee2e6;
  padding-top: 1rem;
}
.freq-change-section label {
  display: block;
  font-weight: bold;
  margin-bottom: 0.5rem;
  color: #495057;
}
.freq-change-section select {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid #ced4da;
  border-radius: 4px;
  font-size: 1rem;
}
.freq-change-section select:focus {
  outline: none;
  border-color: var(--primary-color, #007bff);
  box-shadow: 0 0 0 2px rgba(0, 123, 255, 0.25);
}
.patient-list li.pending {
  background-color: #fff3cd;
  border-color: #ffeaa7;
  color: #856404;
}
.patient-list li.pending .patient-info-name {
  color: #856404;
}
.pending-indicator {
  color: #e17055;
  font-weight: 600;
  font-size: 0.9em;
}
.pending-section {
  margin-top: 1rem;
  padding: 1.2rem;
  background-color: #f8f9fa;
  border: 1px solid #dee2e6;
  border-radius: 8px;
  flex-shrink: 0;
  min-height: 120px;
  max-height: 25vh;
  display: flex;
  flex-direction: column;
}
.pending-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid #dee2e6;
  flex-shrink: 0;
}
.pending-header h4 {
  margin: 0;
  color: #495057;
  font-size: 1.1rem;
  font-weight: 600;
}
.pending-actions {
  display: flex;
  gap: 0.5rem;
}
.btn-clear,
.btn-confirm,
.btn-remove {
  padding: 6px 12px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
  transition: all 0.2s;
}
.btn-clear {
  background-color: #6c757d;
  color: white;
}
.btn-clear:hover {
  background-color: #5a6268;
}
.btn-confirm {
  background-color: #28a745;
  color: white;
  font-weight: 600;
}
.btn-confirm:hover {
  background-color: #218838;
}
.btn-remove {
  background-color: #dc3545;
  color: white;
  width: 24px;
  height: 24px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
  line-height: 1;
}
.btn-remove:hover {
  background-color: #c82333;
}
.pending-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  overflow-y: auto;
  flex: 1;
  padding-right: 0.5rem;
}
.pending-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 10px 14px;
  background-color: white;
  border: 1px solid #dee2e6;
  border-radius: 6px;
  font-size: 0.95rem;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  flex-shrink: 0;
}
.pending-item:hover {
  background-color: #f8f9fa;
  border-color: #adb5bd;
}
.pending-item .patient-name {
  font-weight: 600;
  color: #495057;
  min-width: 80px;
}
.assignment-arrow {
  color: #6c757d;
  font-weight: bold;
}
.bed-info {
  color: #007bff;
  font-weight: 500;
  flex: 1;
}
.dialog-body:has(.pending-section) .assignment-grid {
  max-height: calc(70vh - 150px);
}
.dialog-body:has(.pending-section) .column {
  max-height: calc(70vh - 200px);
}
.pending-list::-webkit-scrollbar {
  width: 6px;
}
.pending-list::-webkit-scrollbar-track {
  background: #f1f1f1;
  border-radius: 3px;
}
.pending-list::-webkit-scrollbar-thumb {
  background: #c1c1c1;
  border-radius: 3px;
}
.pending-list::-webkit-scrollbar-thumb:hover {
  background: #a8a8a8;
}
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
  transition: opacity 0.3s ease;
}
.dialog-content {
  background: white;
  padding: 1.5rem 2rem;
  border-radius: 12px;
  width: 90%;
  max-width: 1200px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  max-height: 95vh;
  min-height: 70vh;
  overflow: hidden;
}
.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #dee2e6;
  padding-bottom: 1rem;
  margin-bottom: 1.5rem;
  flex-shrink: 0;
}
.dialog-header h2 {
  margin: 0;
  font-size: 1.8rem;
  color: #333;
}
.close-btn {
  background: none;
  border: none;
  font-size: 2.5rem;
  line-height: 1;
  cursor: pointer;
  color: #888;
  padding: 0;
  transition: color 0.2s;
}
.close-btn:hover {
  color: #000;
}
.dialog-body {
  overflow: hidden;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 60vh;
}
.assignment-grid {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 2rem;
  width: 100%;
  flex: 1;
  min-height: 0;
}
.column {
  display: flex;
  flex-direction: column;
  background-color: #f8f9fa;
  border: 1px solid #e9ecef;
  border-radius: 8px;
  padding: 1rem;
  min-height: 40vh;
  max-height: calc(70vh - 100px);
}
.column-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #dee2e6;
  padding-bottom: 0.8rem;
  margin-bottom: 0.8rem;
  flex-shrink: 0;
}
.column-header h4 {
  margin: 0;
  font-size: 1.2rem;
  color: #333;
}
.column-header select {
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid #ced4da;
  background-color: white;
  font-size: 0.9rem;
}
.item-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.patient-groups-container {
  overflow-y: auto;
  flex-grow: 1;
}
.patient-group {
  margin-bottom: 1.5rem;
}
.patient-group:last-child {
  margin-bottom: 0;
}
.group-title {
  margin: 0 0 0.8rem 0;
  padding: 0.5rem 0;
  border-bottom: 2px solid #005a9c;
  color: #005a9c;
  font-size: 1.1rem;
  font-weight: 600;
  position: sticky;
  top: 0;
  background-color: #f8f9fa;
  z-index: 1;
}
.patient-list li {
  padding: 12px 14px;
  margin-bottom: 8px;
  border-radius: 8px;
  border: 1px solid #ced4da;
  cursor: pointer;
  transition: all 0.2s ease-in-out;
  background-color: #fff;
  display: flex;
  flex-direction: column;
  gap: 6px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}
.patient-list li:hover {
  background-color: #e9ecef;
  border-color: #adb5bd;
  transform: translateY(-1px);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
}
.patient-list li.selected {
  background-color: #005a9c;
  color: white;
  border-color: #005a9c;
  font-weight: bold;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 90, 156, 0.3);
}
.patient-list li.selected .patient-info-name {
  color: white;
}
.patient-list li.selected .disease-tag {
  background-color: white;
  color: #005a9c;
  border: 1px solid white;
}
.patient-info-name {
  font-weight: 500;
  font-size: 1rem;
  line-height: 1.4;
  color: #333;
}
.patient-freq {
  font-weight: 600;
  color: #007bff;
  margin-left: 0.25rem;
}
.patient-status {
  color: #6c757d;
  font-weight: 400;
  margin-left: 0.25rem;
}
.patient-list li.selected .patient-freq {
  color: #fff;
}
.patient-list li.selected .patient-status {
  color: rgba(255, 255, 255, 0.8);
}
.disease-tags-container {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 2px;
}
.disease-tag {
  background-color: #ffe4e6;
  color: #c53030;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.75em;
  font-weight: 500;
  border: 1px solid #fbb6ce;
  white-space: nowrap;
}
.bed-results-grid {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  overflow-y: auto;
  flex-grow: 1;
}
.shift-group h5 {
  margin: 0 0 0.5rem 0;
  color: #343a40;
  font-size: 1.1rem;
  font-weight: 600;
}
.bed-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.bed-list li {
  background-color: #e3f2fd;
  text-align: center;
  flex-basis: 75px;
  font-weight: bold;
  color: #0d47a1;
  padding: 8px;
  border: 1px solid #b3e5fc;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 0.9rem;
}
.bed-list li:hover {
  background-color: #bbdefb;
  transform: scale(1.05);
  border-color: #81d4fa;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
}
.bed-list li.hepatitis-bed {
  background-color: #fff9c4;
  color: #f57f17;
  border-color: #fff176;
}
.bed-list li.hepatitis-bed:hover {
  background-color: #fff59d;
  border-color: #ffeb3b;
}
.empty-state,
.empty-state-full {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
  height: 100%;
  color: #6c757d;
  font-size: 1.2rem;
  text-align: center;
  padding: 2rem;
  background-color: #fff;
  border: 1px dashed #ced4da;
  border-radius: 6px;
}
.empty-state-small {
  color: #999;
  font-style: italic;
  margin: 0.5rem 0;
}
</style>
