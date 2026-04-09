<!-- src/components/MonthYearPicker.vue -->
<template>
  <div v-if="isVisible" class="picker-backdrop" v-overlay-close="closeDialog">
    <div class="picker-dialog">
      <header class="picker-header">
        <button class="nav-btn" @click="changeYear(-1)">&lt;</button>
        <span class="year-display">{{ displayYear }}</span>
        <button class="nav-btn" @click="changeYear(1)">&gt;</button>
      </header>
      <main class="picker-grid">
        <button
          v-for="(month, index) in months"
          :key="month"
          class="month-btn"
          :class="{ 'is-current': isCurrentMonth(index) }"
          @click="selectMonth(index)"
        >
          {{ month }}
        </button>
      </main>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  isVisible: Boolean,
  initialDate: {
    type: Date,
    default: () => new Date(),
  },
})

const emit = defineEmits(['close', 'date-selected'])

const displayYear = ref(props.initialDate.getFullYear())
const months = [
  '一月',
  '二月',
  '三月',
  '四月',
  '五月',
  '六月',
  '七月',
  '八月',
  '九月',
  '十月',
  '十一月',
  '十二月',
]

// 當 initialDate 變化時，同步更新選擇器裡的年份
watch(
  () => props.initialDate,
  (newDate) => {
    if (newDate) {
      displayYear.value = newDate.getFullYear()
    }
  },
)

function changeYear(delta) {
  displayYear.value += delta
}

function selectMonth(monthIndex) {
  const newDate = new Date(displayYear.value, monthIndex, 1)
  emit('date-selected', newDate)
}

function isCurrentMonth(monthIndex) {
  return (
    displayYear.value === props.initialDate.getFullYear() &&
    monthIndex === props.initialDate.getMonth()
  )
}

function closeDialog() {
  emit('close')
}
</script>

<style scoped>
.picker-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(2px);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 2000;
}

.picker-dialog {
  background-color: white;
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  width: 320px;
  animation: fadeIn 0.2s ease-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.picker-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid #e9ecef;
}

.year-display {
  font-size: 1.2rem;
  font-weight: 600;
  color: #343a40;
}

.nav-btn {
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  color: #6c757d;
  padding: 0 10px;
  transition: color 0.2s;
}
.nav-btn:hover {
  color: #007bff;
}

.picker-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  padding: 16px;
}

.month-btn {
  background-color: #f8f9fa;
  border: 1px solid #dee2e6;
  border-radius: 6px;
  padding: 12px 0;
  font-size: 0.9rem;
  cursor: pointer;
  transition: all 0.2s;
}

.month-btn:hover {
  background-color: #e9ecef;
  border-color: #ced4da;
}

.month-btn.is-current {
  background-color: #007bff;
  color: white;
  border-color: #007bff;
  font-weight: bold;
}
</style>
