<!-- src/components/BedChangeDialog.vue (已修改) -->
<script setup>
import { ref, computed, watch } from 'vue'
import { SHIFT_CODES, getShiftDisplayName } from '@/constants/scheduleConstants.js'

const props = defineProps({
  isVisible: Boolean,
  patientInfo: Object,
  currentSchedule: Object,
  // ✨ 1. 新增 prop，用來接收要篩選的目標班次
  targetShiftFilter: {
    type: String,
    default: null, // e.g., 'early', 'noon', 'late'
  },
})

const emit = defineEmits(['confirm', 'cancel'])
const cancelDialog = () => emit('cancel')

const selectedNewBedId = ref(null)

const hepatitisBedNumbers = [31, 32, 33, 35, 36]
function isHepatitisBed(bedNum) {
  return typeof bedNum === 'number' && hepatitisBedNumbers.includes(bedNum)
}

// ✨ 2. 修改 computed，使其能夠根據 prop 進行篩選
const availableBedsByShift = computed(() => {
  if (!props.isVisible || !props.currentSchedule) return {}

  const allPossibleBeds = [
    ...Array.from({ length: 65 }, (_, i) => i + 1).filter(
      (i) => ![4, 10, 14, 20, 24, 30, 34, 40, 50, 54, 60, 64].includes(i),
    ),
    ...Array.from({ length: 6 }, (_, i) => `peripheral-${i + 1}`),
  ]

  const occupiedBedShiftIds = new Set(Object.keys(props.currentSchedule))
  const allShifts = Object.values(SHIFT_CODES)

  const available = {}
  allShifts.forEach((s) => (available[s] = []))

  allPossibleBeds.forEach((bedNum) => {
    allShifts.forEach((shiftCode) => {
      const bedIdPart = typeof bedNum === 'string' ? bedNum : `bed-${bedNum}`
      const shiftId = `${bedIdPart}-${shiftCode}`
      if (!occupiedBedShiftIds.has(shiftId)) {
        available[shiftCode].push(bedNum)
      }
    })
  })

  Object.values(available).forEach((beds) => {
    beds.sort((a, b) => {
      const numA = typeof a === 'number' ? a : Infinity
      const numB = typeof b === 'number' ? b : Infinity
      if (numA !== Infinity || numB !== Infinity) return numA - numB
      return String(a).localeCompare(String(b))
    })
  })

  // 如果有傳入篩選條件，只回傳該班次的空床
  if (props.targetShiftFilter && available[props.targetShiftFilter]) {
    return {
      [props.targetShiftFilter]: available[props.targetShiftFilter],
    }
  }

  return available
})

// ✨ 3. 動態設定對話框標題和提示訊息
const dialogTitle = computed(() => {
  if (props.targetShiftFilter && props.patientInfo) {
    return `為【${props.patientInfo.name}】選擇新的空床位`
  }
  return '更換床位'
})

const patientInfoDisplay = computed(() => {
  if (props.targetShiftFilter && props.patientInfo) {
    const targetShiftName = getShiftDisplayName(props.targetShiftFilter)
    return {
      ...props.patientInfo,
      targetShift: targetShiftName,
    }
  }
  return props.patientInfo
})

watch(
  () => props.isVisible,
  (newVal) => {
    if (newVal) {
      selectedNewBedId.value = null
    }
  },
)

function handleBedClick(bedNum, shiftCode) {
  const bedIdPart = typeof bedNum === 'string' ? bedNum : `bed-${bedNum}`
  selectedNewBedId.value = `${bedIdPart}-${shiftCode}`
}

function confirmChange() {
  if (!selectedNewBedId.value) {
    alert('請選擇一個新的床位！')
    return
  }
  emit('confirm', {
    oldShiftId: props.patientInfo.shiftId,
    newShiftId: selectedNewBedId.value,
  })
}

function getBedDisplay(bed) {
  if (typeof bed === 'string' && bed.startsWith('peripheral-')) {
    return `外圍 ${bed.split('-')[1]}`
  }
  return bed
}
</script>

<template>
  <div v-if="isVisible" class="dialog-overlay" v-overlay-close="cancelDialog">
    <div class="dialog-content">
      <div class="dialog-header">
        <h3>{{ dialogTitle }}</h3>
        <button @click="cancelDialog" class="close-btn">×</button>
      </div>

      <div class="dialog-body">
        <div v-if="patientInfoDisplay" class="patient-info">
          <span><strong>病人:</strong> {{ patientInfoDisplay.name }}</span>
          <span v-if="patientInfoDisplay.targetShift"
            ><strong>目標班次:</strong> {{ patientInfoDisplay.targetShift }}</span
          >
          <span v-else><strong>目前床位:</strong> {{ patientInfoDisplay.shiftId }}</span>
        </div>

        <div class="beds-container">
          <div
            v-for="(beds, shiftCode) in availableBedsByShift"
            :key="shiftCode"
            class="shift-group"
          >
            <h4>{{ getShiftDisplayName(shiftCode) }}</h4>
            <div v-if="beds.length > 0" class="bed-grid">
              <div
                v-for="bed in beds"
                :key="`${bed}-${shiftCode}`"
                class="bed-item"
                :class="{
                  'hepatitis-bed': isHepatitisBed(bed),
                  selected:
                    `${typeof bed === 'string' ? bed : 'bed-' + bed}-${shiftCode}` ===
                    selectedNewBedId,
                }"
                @click="handleBedClick(bed, shiftCode)"
              >
                {{ getBedDisplay(bed) }}
              </div>
            </div>
            <p v-else class="no-beds-message">此班次已無可用空床</p>
          </div>
        </div>
      </div>

      <div class="dialog-actions">
        <button @click="cancelDialog" class="btn-cancel">取消</button>
        <button @click="confirmChange" :disabled="!selectedNewBedId" class="btn-confirm">
          確定更換
        </button>
      </div>
    </div>
  </div>
</template>

<!-- Style 部分與原檔案相同，故省略 -->
<style scoped>
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
  background: white;
  border-radius: 12px;
  box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
  width: 90%;
  max-width: 800px;
  display: flex;
  flex-direction: column;
  max-height: 85vh;
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
}

.dialog-body {
  padding: 1.5rem;
  overflow-y: auto;
}

.patient-info {
  display: flex;
  justify-content: space-between;
  background-color: #f8f9fa;
  padding: 0.75rem 1rem;
  border-radius: 6px;
  margin-bottom: 1.5rem;
  font-size: 1.1em;
}

.beds-container {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.shift-group h4 {
  margin: 0 0 0.75rem 0;
  font-size: 1.2rem;
  color: #333;
}

.bed-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.bed-item {
  flex-basis: calc(12.5% - 0.75rem); /* 8 items per row approx. */
  text-align: center;
  padding: 0.75rem 0;
  border: 1px solid #b3e5fc;
  background-color: #e3f2fd;
  color: #0d47a1;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s;
}

.bed-item:hover {
  background-color: #bbdefb;
  transform: translateY(-2px);
}

.bed-item.hepatitis-bed {
  background-color: #fff9c4;
  border-color: #fff176;
  color: #f57f17;
}

.bed-item.hepatitis-bed:hover {
  background-color: #fff59d;
}

.bed-item.selected {
  background-color: var(--primary-color, #007bff);
  color: white;
  border-color: var(--primary-color, #007bff);
  font-weight: bold;
  transform: scale(1.05);
}

.no-beds-message {
  color: #6c757d;
  font-style: italic;
  padding: 1rem;
  text-align: center;
  background-color: #f8f9fa;
  border-radius: 6px;
}

.dialog-actions {
  text-align: right;
  padding: 1rem 1.5rem;
  border-top: 1px solid #e5e5e5;
  background-color: #f8f9fa;
}
.dialog-actions button {
  padding: 0.6rem 1.2rem;
  border-radius: 5px;
  border: none;
  cursor: pointer;
  margin-left: 10px;
  font-weight: 500;
  font-size: 1rem;
}
.btn-confirm {
  background-color: #28a745;
  color: white;
}
.btn-confirm:disabled {
  background-color: #a5d6a7;
  cursor: not-allowed;
}
.btn-cancel {
  background-color: #6c757d;
  color: white;
}
</style>
