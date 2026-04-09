<!-- 檔案路徑: src/components/PreparationPopover.vue (✨ 點擊姓名版 ✨) -->
<script setup>
import { ref, watch, onUnmounted, nextTick, computed } from 'vue'

const props = defineProps({
  isVisible: Boolean,
  patients: Array,
  targetElement: HTMLElement,
})

// ✨ 新增 emit: open-order-modal
const emit = defineEmits(['close', 'open-order-modal'])

const popoverRef = ref(null)
const popoverStyle = ref({})

const calculatePosition = () => {
  if (!props.targetElement || !popoverRef.value) return

  const targetRect = props.targetElement.getBoundingClientRect()
  const popoverRect = popoverRef.value.getBoundingClientRect()

  let top = targetRect.top - popoverRect.height - 10
  let left = targetRect.left + targetRect.width / 2 - popoverRect.width / 2

  if (top < 10) {
    top = targetRect.bottom + 10
  }
  if (left < 10) {
    left = 10
  }
  const screenWidth = window.innerWidth
  if (left + popoverRect.width > screenWidth - 10) {
    left = screenWidth - popoverRect.width - 10
  }

  popoverStyle.value = {
    position: 'fixed',
    top: `${top}px`,
    left: `${left}px`,
  }
}

const handleClickOutside = (event) => {
  if (
    popoverRef.value &&
    !popoverRef.value.contains(event.target) &&
    props.targetElement &&
    !props.targetElement.contains(event.target)
  ) {
    emit('close')
  }
}

// ✨ 新增：處理點擊姓名的函式
const handleNameClick = (patient) => {
  // 觸發事件，並把完整的 patient 物件傳給父元件
  emit('open-order-modal', patient)
  // 順便關閉自己
  emit('close')
}

watch(
  () => props.isVisible,
  (newValue) => {
    if (newValue) {
      nextTick(() => {
        calculatePosition()
        window.addEventListener('resize', calculatePosition)
        document.addEventListener('mousedown', handleClickOutside, true)
      })
    } else {
      window.removeEventListener('resize', calculatePosition)
      document.removeEventListener('mousedown', handleClickOutside, true)
    }
  },
)

onUnmounted(() => {
  window.removeEventListener('resize', calculatePosition)
  document.removeEventListener('mousedown', handleClickOutside, true)
})

const hasPatients = computed(() => props.patients && props.patients.length > 0)
</script>

<template>
  <Teleport to="body">
    <div v-if="isVisible" ref="popoverRef" class="preparation-popover" :style="popoverStyle">
      <div v-if="hasPatients" class="popover-content">
        <table>
          <thead>
            <tr>
              <!-- ✨ 修改：調整欄位順序和內容 -->
              <th>姓名</th>
              <th>AK</th>
              <th>Ca</th>
              <th>Heparin</th>
              <th>BF</th>
              <th>通路/穿刺針</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="patient in patients" :key="patient.id">
              <!-- ✨ 核心修改：讓姓名可以點擊，並觸發事件 -->
              <td class="name-cell" @click="handleNameClick(patient)" title="點擊以編輯此病人醫囑">
                {{ patient.name }}
              </td>
              <td>{{ patient.dialysisOrders?.ak || '–' }}</td>
              <td>{{ patient.dialysisOrders?.dialysateCa || '–' }}</td>
              <td>
                {{ patient.dialysisOrders?.heparinInitial ?? '–' }}/{{
                  patient.dialysisOrders?.heparinMaintenance ?? '–'
                }}
              </td>
              <td>{{ patient.dialysisOrders?.bloodFlow ?? '–' }}</td>
              <td>
                {{ patient.dialysisOrders?.vascAccess || '–' }}
                <span
                  v-if="
                    patient.dialysisOrders?.arterialNeedle || patient.dialysisOrders?.venousNeedle
                  "
                >
                  ({{ patient.dialysisOrders?.arterialNeedle || 'N/A' }}/{{
                    patient.dialysisOrders?.venousNeedle || 'N/A'
                  }})
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="empty-state">沒有需要備物的病人</div>
    </div>
  </Teleport>
</template>

<style scoped>
.preparation-popover {
  z-index: 1010;
  background-color: white;
  border: 1px solid #ccc;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  min-width: 320px;
  max-width: 600px; /* 加寬以容納新欄位 */
}
.popover-content {
  padding: 0.5rem;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.95rem;
}
th,
td {
  border: 1px solid #e0e0e0;
  padding: 8px 10px;
  text-align: center;
}
th {
  background-color: #f5f5f5;
  font-weight: bold;
}
td:first-child {
  text-align: left;
  font-weight: 500;
  white-space: nowrap;
}
/* ✨ 新增：讓姓名看起來可以點擊 */
.name-cell {
  cursor: pointer;
  color: #007bff;
  text-decoration: underline;
}
.name-cell:hover {
  background-color: #f0f8ff;
}
.empty-state {
  padding: 1.5rem;
  text-align: center;
  color: #666;
}
</style>
