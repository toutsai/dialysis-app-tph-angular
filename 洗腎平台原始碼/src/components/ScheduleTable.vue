<!-- 檔案路徑: src/components/ScheduleTable.vue (Pinia 整合修正版) -->
<template>
  <div class="schedule-table-container">
    <table class="schedule-table">
      <thead ref="theadRef">
        <tr>
          <th class="bed-header-cell">床位</th>
          <th class="shift-header-cell">班次</th>
          <th v-for="(day, index) in weekdays" :key="index" class="day-header-cell">
            {{ day }}
            <span v-if="weekDates[index]" class="date-display">{{ weekDates[index] }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <template v-for="bedNum in layout" :key="`bed-${bedNum}`">
          <tr class="bed-row">
            <td
              class="bed-number-cell"
              :rowspan="shifts.length"
              :class="{ 'hepatitis-bed': hepatitisBeds.includes(bedNum) }"
            >
              {{ getBedDisplayName(bedNum) }}
            </td>
            <td class="shift-name-cell">{{ getShiftDisplayName(shifts[0]) }}</td>
            <td v-for="(day, dayIndex) in weekdays" :key="`slot-${bedNum}-0-${dayIndex}`">
              <div
                class="schedule-slot"
                :data-slot-id="`${bedNum}-0-${dayIndex}`"
                :class="[
                  getStyleFunc(`${bedNum}-0-${dayIndex}`),
                  { 'is-past': !isSlotInteractive(dayIndex) && props.isDateInPast(dayIndex) },
                ]"
                :draggable="
                  getPatientDetails(`${bedNum}-0-${dayIndex}`) && isSlotInteractive(dayIndex)
                    ? 'true'
                    : 'false'
                "
                @click="
                  isSlotInteractive(dayIndex) && emit('grid-click', `${bedNum}-0-${dayIndex}`)
                "
                @drop="
                  isSlotInteractive(dayIndex) && emit('drop', $event, `${bedNum}-0-${dayIndex}`)
                "
                @dragstart="
                  isSlotInteractive(dayIndex) &&
                  emit('drag-start', $event, `${bedNum}-0-${dayIndex}`)
                "
                @dragover.prevent="isSlotInteractive(dayIndex) && emit('drag-over', $event)"
                @dragleave="emit('drag-leave', $event)"
              >
                <div v-if="getPatientDetails(`${bedNum}-0-${dayIndex}`)" class="patient-details">
                  <div class="patient-name">
                    {{ getPatientDetails(`${bedNum}-0-${dayIndex}`).name }}

                    <!-- ✨ 核心修改 #1: 將 typesMap 傳遞給 PatientMessagesIcon -->
                    <PatientMessagesIcon
                      :patient-id="scheduleData[`${bedNum}-0-${dayIndex}`]?.patientId"
                      :typesMap="props.typesMap"
                    />

                    <span
                      v-for="disease in getPatientDetails(`${bedNum}-0-${dayIndex}`).diseases"
                      :key="disease"
                      class="disease-tag-in-table"
                      >{{ disease }}</span
                    >
                  </div>
                  <div class="patient-mrn">
                    {{ getPatientDetails(`${bedNum}-0-${dayIndex}`).medicalRecordNumber }}
                    <span
                      v-if="
                        getPatientDetails(`${bedNum}-0-${dayIndex}`).patient.mode &&
                        getPatientDetails(`${bedNum}-0-${dayIndex}`).patient.mode !== 'HD'
                      "
                      class="special-dialysis-label"
                    >
                      ({{ getPatientDetails(`${bedNum}-0-${dayIndex}`).patient.mode }})
                    </span>
                  </div>
                </div>
                <div v-else-if="isSlotInteractive(dayIndex)" class="empty-slot-placeholder">+</div>
              </div>
            </td>
          </tr>
          <tr v-for="shiftIndex in shifts.length - 1" :key="`shift-row-${bedNum}-${shiftIndex}`">
            <td class="shift-name-cell">{{ getShiftDisplayName(shifts[shiftIndex]) }}</td>
            <td
              v-for="(day, dayIndex) in weekdays"
              :key="`slot-${bedNum}-${shiftIndex}-${dayIndex}`"
            >
              <div
                class="schedule-slot"
                :data-slot-id="`${bedNum}-${shiftIndex}-${dayIndex}`"
                :class="[
                  getStyleFunc(`${bedNum}-${shiftIndex}-${dayIndex}`),
                  { 'is-past': !isSlotInteractive(dayIndex) && props.isDateInPast(dayIndex) },
                ]"
                :draggable="
                  getPatientDetails(`${bedNum}-${shiftIndex}-${dayIndex}`) &&
                  isSlotInteractive(dayIndex)
                    ? 'true'
                    : 'false'
                "
                @click="
                  isSlotInteractive(dayIndex) &&
                  emit('grid-click', `${bedNum}-${shiftIndex}-${dayIndex}`)
                "
                @drop="
                  isSlotInteractive(dayIndex) &&
                  emit('drop', $event, `${bedNum}-${shiftIndex}-${dayIndex}`)
                "
                @dragstart="
                  isSlotInteractive(dayIndex) &&
                  emit('drag-start', $event, `${bedNum}-${shiftIndex}-${dayIndex}`)
                "
                @dragover.prevent="isSlotInteractive(dayIndex) && emit('drag-over', $event)"
                @dragleave="emit('drag-leave', $event)"
              >
                <div
                  v-if="getPatientDetails(`${bedNum}-${shiftIndex}-${dayIndex}`)"
                  class="patient-details"
                >
                  <div class="patient-name">
                    {{ getPatientDetails(`${bedNum}-${shiftIndex}-${dayIndex}`).name }}

                    <!-- ✨ 核心修改 #1 (重複): 將 typesMap 傳遞給 PatientMessagesIcon -->
                    <PatientMessagesIcon
                      :patient-id="scheduleData[`${bedNum}-${shiftIndex}-${dayIndex}`]?.patientId"
                      :typesMap="props.typesMap"
                    />

                    <span
                      v-for="disease in getPatientDetails(`${bedNum}-${shiftIndex}-${dayIndex}`)
                        .diseases"
                      :key="disease"
                      class="disease-tag-in-table"
                      >{{ disease }}</span
                    >
                  </div>
                  <div class="patient-mrn">
                    {{
                      getPatientDetails(`${bedNum}-${shiftIndex}-${dayIndex}`).medicalRecordNumber
                    }}
                    <span
                      v-if="
                        getPatientDetails(`${bedNum}-${shiftIndex}-${dayIndex}`).patient.mode &&
                        getPatientDetails(`${bedNum}-${shiftIndex}-${dayIndex}`).patient.mode !==
                          'HD'
                      "
                      class="special-dialysis-label"
                    >
                      ({{ getPatientDetails(`${bedNum}-${shiftIndex}-${dayIndex}`).patient.mode }})
                    </span>
                  </div>
                </div>
                <div v-else-if="isSlotInteractive(dayIndex)" class="empty-slot-placeholder">+</div>
              </div>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { getShiftDisplayName } from '@/constants/scheduleConstants'
import PatientMessagesIcon from './PatientMessagesIcon.vue'

const props = defineProps({
  layout: { type: Array, required: true },
  scheduleData: { type: Object, required: true },
  patientMap: { type: Map, required: true },
  shifts: { type: Array, required: true },
  weekdays: { type: Array, required: true },
  weekDates: { type: Array, default: () => [] },
  hepatitisBeds: { type: Array, default: () => [] },
  getStyleFunc: { type: Function, default: () => ({}) },
  isDateInPast: { type: Function, default: () => false },

  // ✨ 核心修正：將 typesMap 變為非必要，並提供預設值
  typesMap: {
    type: Map,
    required: false, // <-- 從 true 改為 false
    default: () => new Map(), // <-- 新增一個空的 Map 作為預設值
  },

  isPageLocked: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits([
  'grid-click',
  'drop',
  'drag-start',
  'drag-over',
  'drag-leave',
  'show-memos',
  'update:column-widths',
  'update:left-offset',
])

const isSlotInteractive = (dayIndex) => {
  return !props.isPageLocked && !props.isDateInPast(dayIndex)
}

const theadRef = ref(null)
const isMounted = ref(false)

const measureAndEmitWidths = () => {
  if (!isMounted.value) return
  nextTick(() => {
    if (!theadRef.value || !theadRef.value.isConnected) return
    const ths = Array.from(theadRef.value.querySelectorAll('th'))
    if (ths.length < 3) return
    try {
      const bedHeaderWidth = ths[0].getBoundingClientRect().width
      const shiftHeaderWidth = ths[1].getBoundingClientRect().width
      const leftOffset = bedHeaderWidth + shiftHeaderWidth
      const dayColumnWidths = ths.slice(2).map((th) => th.getBoundingClientRect().width)
      emit('update:left-offset', leftOffset)
      emit('update:column-widths', dayColumnWidths)
    } catch (e) {
      console.warn('Could not measure table widths, element might be detached.', e)
    }
  })
}

let resizeObserver = null
onMounted(() => {
  isMounted.value = true
  setTimeout(measureAndEmitWidths, 100)
  const tableContainer = theadRef.value?.closest('.schedule-table-container')
  if (tableContainer) {
    resizeObserver = new ResizeObserver(measureAndEmitWidths)
    resizeObserver.observe(tableContainer)
  }
  window.addEventListener('resize', measureAndEmitWidths)
})

onUnmounted(() => {
  isMounted.value = false
  if (resizeObserver) resizeObserver.disconnect()
  window.removeEventListener('resize', measureAndEmitWidths)
})

const getPatientDetails = (slotId) => {
  const slotData = props.scheduleData[slotId]
  if (!slotData || !slotData.patientId) return null
  const patient = props.patientMap.get(slotData.patientId)
  if (!patient) return null
  return {
    name: patient.name,
    medicalRecordNumber: patient.medicalRecordNumber,
    diseases: patient.diseases || [],
    patient: patient,
  }
}

const getBedDisplayName = (bedNum) => {
  if (typeof bedNum === 'string' && bedNum.startsWith('peripheral-')) {
    const numberPart = bedNum.split('-')[1]
    return `外圍床位 ${numberPart}`
  }
  return `${bedNum}号床`
}
</script>

<style scoped>
/* Style 區塊保持不變 */
.schedule-table-container {
  width: 100%;
  height: 100%;
  overflow: auto;
}
.schedule-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
.schedule-table th,
.schedule-table td {
  border: 1px solid #dee2e6;
  text-align: center;
  vertical-align: middle;
  padding: 0;
  height: 60px;
}
.schedule-table thead th {
  position: sticky;
  top: 0;
  background-color: #f8f9fa;
  z-index: 10;
  padding: 8px 4px;
}
.date-display {
  font-size: 0.8em;
  color: #6c757d;
  display: block;
}
.bed-header-cell {
  width: 80px;
}
.shift-header-cell {
  width: 70px;
}
.bed-number-cell {
  position: sticky;
  left: 0;
  background-color: #f8f9fa;
  z-index: 5;
  font-weight: bold;
}
.hepatitis-bed {
  background-color: var(--hepatitis-bg, #fff9c4);
}
.shift-name-cell {
  background-color: #f8f9fa;
  font-size: 0.9em;
}
.schedule-slot {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  cursor: pointer;
  transition: all 0.2s;
  overflow: hidden;
}
.patient-details {
  padding: 4px;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
}
.patient-name {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 6px;
  font-weight: bold;
  font-size: 0.95em;
  white-space: nowrap;
}
.patient-mrn {
  font-size: 0.8em;
  color: #555;
  white-space: nowrap;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.disease-tag-in-table {
  display: inline-block;
  vertical-align: middle;
  padding: 2px 6px;
  line-height: 1;
  background-color: transparent;
  border: 2px solid #dc3545;
  color: #dc3545;
  border-radius: 6px;
  font-size: 0.85em;
  font-weight: bold;
}
.empty-slot-placeholder {
  color: #adb5bd;
  font-size: 1.5rem;
  user-select: none;
}
.schedule-slot:hover .empty-slot-placeholder {
  color: #007bff;
}
.special-dialysis-label {
  font-weight: bold;
  color: #c53929;
  font-size: 1em;
}
.schedule-slot.is-past {
  cursor: not-allowed;
  opacity: 0.85;
}
.schedule-slot.is-past:not([class*='status-']):not([class*='tag-']) {
  background-color: #f5f5f5 !important;
  opacity: 1;
}
.patient-name-past {
  font-weight: normal;
  color: #333;
  font-size: 0.9em;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.schedule-slot.drag-over {
  background-color: #c8e6c9 !important;
  border: 2px dashed #4caf50;
  box-shadow: inset 0 0 10px rgba(0, 0, 0, 0.1);
}
.schedule-slot[draggable='true'] {
  cursor: grab;
}
.schedule-slot[draggable='true']:active {
  cursor: grabbing;
  transform: scale(0.98);
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
  z-index: 20;
}
</style>
