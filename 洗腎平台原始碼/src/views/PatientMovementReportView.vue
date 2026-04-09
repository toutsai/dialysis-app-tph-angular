<template>
  <div class="report-container">
    <!-- 標題區 -->
    <header class="page-header">
      <div class="header-left">
        <h2 class="page-title"><i class="fas fa-file-medical-alt icon"></i> KiDit 申報工作站</h2>
      </div>

      <!-- 月份導航 -->
      <div class="month-navigator">
        <button class="nav-btn" @click="changeMonth(-1)">
          <i class="fas fa-chevron-left"></i>
        </button>
        <span class="current-month">
          {{ currentYear }} 年 <span class="month-number">{{ currentMonth }}</span> 月
        </span>
        <button class="nav-btn" @click="changeMonth(1)">
          <i class="fas fa-chevron-right"></i>
        </button>
      </div>

      <!-- 右側功能區 -->
      <div class="header-right">
        <button class="action-btn export-btn" @click="exportToCSV" :disabled="isLoading">
          <i class="fas fa-file-export"></i> 匯出本月資料
        </button>
      </div>
    </header>

    <!-- 月曆主體 (保持不變) -->
    <div class="calendar-wrapper" v-if="!isLoading">
      <!-- ... (略，保持原樣) ... -->
      <div class="weekdays-header">
        <div v-for="day in weekDays" :key="day" class="weekday">{{ day }}</div>
      </div>

      <div class="calendar-grid">
        <div v-for="n in firstDayOffset" :key="'empty-' + n" class="day-cell empty"></div>

        <div
          v-for="day in daysData"
          :key="day.dateStr"
          class="day-cell"
          :class="{
            'has-data': day.events.length > 0,
            'is-today': isToday(day.dateStr),
            'has-alert': day.unregistered > 0,
          }"
          @click="openModal(day)"
        >
          <div class="cell-header">
            <span class="day-number">{{ day.dayNum }}</span>
            <span v-if="isToday(day.dateStr)" class="today-badge">今天</span>
          </div>

          <div class="cell-content">
            <div v-if="day.events.length > 0" class="event-indicator">
              <div class="stat-row">
                <span class="count-badge primary">
                  <i class="fas fa-list-ul"></i> {{ day.events.length }} 筆
                </span>
              </div>
              <div class="stat-row" v-if="day.unregistered > 0">
                <span class="count-badge danger">
                  <i class="fas fa-exclamation-circle"></i> {{ day.unregistered }} 未
                </span>
              </div>
            </div>
            <div v-else class="no-event">
              <span class="dot"></span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="loading-container">
      <div class="spinner"></div>
      <p>正在讀取申報資料...</p>
    </div>

    <MovementDetailModal
      :visible="showModal"
      :date="selectedDate"
      :events="selectedEvents"
      @close="showModal = false"
      @refresh="fetchData"
    />
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { kiditService } from '@/services/kiditService'
import MovementDetailModal from '@/components/kidit/MovementDetailModal.vue'
// ✨ 引入 Store 和 工具
import { usePatientStore } from '@/stores/patientStore'
import { toRocDate } from '@/utils/kiditHelpers'
import { exportKiDitExcel } from '@/services/kiditExportService' // 引入新服務

const patientStore = usePatientStore()
const currentYear = ref(new Date().getFullYear())
const currentMonth = ref(new Date().getMonth() + 1)
const daysData = ref([])
const isLoading = ref(false)
const weekDays = ['日', '一', '二', '三', '四', '五', '六']

// Modal 狀態
const showModal = ref(false)
const selectedDate = ref('')
const selectedEvents = ref([])

const firstDayOffset = computed(() => {
  return new Date(currentYear.value, currentMonth.value - 1, 1).getDay()
})

function isToday(dateStr) {
  const today = new Date()
  const y = today.getFullYear()
  const m = String(today.getMonth() + 1).padStart(2, '0')
  const d = String(today.getDate()).padStart(2, '0')
  return dateStr === `${y}-${m}-${d}`
}

async function fetchData() {
  isLoading.value = true
  try {
    // 確保病人資料已載入 (為了匯出時能對照到詳細資料)
    if (patientStore.allPatients.length === 0) {
      await patientStore.fetchPatientsIfNeeded()
    }

    const logs = await kiditService.fetchMonthLogs(currentYear.value, currentMonth.value)
    const daysInMonth = new Date(currentYear.value, currentMonth.value, 0).getDate()
    const tempDays = []
    const logMap = {}

    logs.forEach((l) => (logMap[l.date] = l.events || []))

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${currentYear.value}-${String(currentMonth.value).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      const events = logMap[dateStr] || []

      tempDays.push({
        dateStr,
        dayNum: d,
        events,
        unregistered: events.filter((e) => !e.isRegistered).length,
      })
    }
    daysData.value = tempDays
  } catch (e) {
    console.error(e)
  } finally {
    isLoading.value = false
  }
}

function changeMonth(offset) {
  let m = currentMonth.value + offset
  let y = currentYear.value
  if (m > 12) {
    m = 1
    y++
  } else if (m < 1) {
    m = 12
    y--
  }

  currentMonth.value = m
  currentYear.value = y
  fetchData()
}

function openModal(day) {
  selectedDate.value = day.dateStr
  selectedEvents.value = day.events
  showModal.value = true
}

// 修改 exportToCSV 函式
function exportToCSV() {
  if (!daysData.value.length) {
    alert('目前無資料可匯出')
    return
  }

  // 1. 收集整個月所有的 events (攤平)
  const allEvents = daysData.value.flatMap((day) => day.events)

  if (allEvents.length === 0) {
    alert('本月份尚無任何事件紀錄。')
    return
  }

  // 2. 呼叫匯出服務
  const filename = `KiDit_Export_${currentYear.value}_${String(currentMonth.value).padStart(2, '0')}.xlsx`

  try {
    exportKiDitExcel(allEvents, filename)
    // alert('匯出成功！'); // XLSX.writeFile 會自動觸發下載，通常不需要 alert
  } catch (error) {
    console.error('匯出失敗:', error)
    alert('匯出失敗，請檢查資料格式')
  }
}

function translateType(type) {
  const map = { MOVEMENT: '動態', ACCESS: '通路', TRANSFER: '轉移', CREATE: '新收', DELETE: '結案' }
  return map[type] || type
}

onMounted(() => {
  fetchData()
})
</script>

<style scoped>
/* --- 樣式調整 --- */
.report-container {
  padding: 10px;
  background-color: #f8f9fa;
  min-height: 100vh;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 25px;
  background: white;
  padding: 10px;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

/* Header 分區 */
.header-left,
.header-right {
  flex: 1;
  display: flex;
  align-items: center;
}
.header-right {
  justify-content: flex-end;
}

.page-title {
  font-size: 32px;
  color: #2c3e50;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}
.page-title .icon {
  color: #3498db;
}

.month-navigator {
  flex: 2;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 20px;
}

.nav-btn {
  background: #f1f3f5;
  border: none;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  cursor: pointer;
  color: #555;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}
.nav-btn:hover {
  background: #e9ecef;
  color: #333;
  transform: scale(1.1);
}

.current-month {
  font-size: 1.2rem;
  font-weight: bold;
  color: #333;
  min-width: 120px;
  text-align: center;
}
.month-number {
  color: #3498db;
  font-size: 1.4em;
}

/* --- 匯出按鈕 --- */
.action-btn {
  padding: 10px 20px;
  border: none;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.2s;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.export-btn {
  background-color: #27ae60;
  color: white;
}
.export-btn:hover {
  background-color: #219150;
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(39, 174, 96, 0.2);
}
.export-btn:disabled {
  background-color: #95a5a6;
  cursor: not-allowed;
}

/* --- 月曆樣式 (保持之前美化版) --- */
.calendar-wrapper {
  background: white;
  border-radius: 12px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05);
  padding: 20px;
}
.weekdays-header {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  text-align: center;
  margin-bottom: 10px;
  border-bottom: 2px solid #f1f3f5;
  padding-bottom: 10px;
}
.weekday {
  font-weight: 600;
  color: #95a5a6;
}
.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 12px;
}
.day-cell {
  background: #fff;
  border: 1px solid #e9ecef;
  border-radius: 10px;
  min-height: 120px;
  padding: 10px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  flex-direction: column;
}
.day-cell:hover {
  border-color: #3498db;
  box-shadow: 0 4px 12px rgba(52, 152, 219, 0.15);
  transform: translateY(-3px);
  z-index: 1;
}
.day-cell.has-data {
  background: #fbfdff;
  border-color: #d6eaf8;
}
.day-cell.has-alert {
  border-left: 4px solid #e74c3c;
}
.day-cell.is-today {
  background: #fff9e6;
  border: 2px solid #f1c40f;
}
.day-cell.empty {
  background: transparent;
  border: none;
  cursor: default;
  pointer-events: none;
}

.cell-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
}
.day-number {
  font-size: 1.1rem;
  font-weight: 700;
  color: #555;
}
.today-badge {
  background: #f1c40f;
  color: white;
  font-size: 0.7rem;
  padding: 2px 6px;
  border-radius: 4px;
}

.cell-content {
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.stat-row {
  margin-bottom: 4px;
}
.count-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 0.85rem;
  padding: 4px 8px;
  border-radius: 6px;
  width: 100%;
}
.count-badge.primary {
  background: #e3f2fd;
  color: #1976d2;
}
.count-badge.danger {
  background: #ffebee;
  color: #c62828;
}
.no-event .dot {
  display: block;
  width: 6px;
  height: 6px;
  background: #eee;
  border-radius: 50%;
  margin: 0 auto;
}

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 400px;
  color: #666;
}
.spinner {
  border: 4px solid #f3f3f3;
  border-top: 4px solid #3498db;
  border-radius: 50%;
  width: 40px;
  height: 40px;
  animation: spin 1s linear infinite;
  margin-bottom: 15px;
}
@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

@media (max-width: 768px) {
  .page-header {
    flex-direction: column;
    gap: 15px;
  }
  .calendar-grid {
    grid-template-columns: repeat(1, 1fr);
  }
  .weekdays-header {
    display: none;
  }
}
</style>
