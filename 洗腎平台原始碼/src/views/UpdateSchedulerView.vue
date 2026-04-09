<!-- 檔案路徑: src/views/UpdateSchedulerView.vue (整合新增功能版) -->
<template>
  <div class="page-container">
    <div class="page-header-section">
      <div class="header-toolbar">
        <!-- ✨ 將 toolbar-left 應用到一個新的 div 上 -->
        <div class="toolbar-left">
          <h1 class="page-title">預約變更(長期變更)</h1>
          <!-- ✨ 將按鈕移動到這裡 -->
          <button class="btn btn-primary" @click="openNewUpdateDialog" :disabled="isPageLocked">
            <i class="fas fa-plus-circle"></i> 新增預約變更
          </button>
        </div>
      </div>
      <p class="page-description">
        針對身分、頻率與長期床位的變動，顯示所有已排程的病人屬性或總表規則變更。變更將在「生效日期」當天凌晨由系統自動執行。
      </p>
    </div>

    <main class="page-main-content">
      <div class="updates-list-container">
        <div class="custom-calendar-header">
          <div class="date-navigator">
            <button @click="handlePrev">&lt;</button>
            <span class="calendar-title-text">{{ calendarTitle }}</span>
            <button @click="handleNext">&gt;</button>
          </div>
          <div class="view-actions">
            <button @click="handleToday">今天</button>
          </div>
        </div>

        <div v-if="isLoading" class="loading-state">
          <div class="spinner"></div>
          正在載入預約變更資料...
        </div>

        <div v-else class="calendar-wrapper">
          <FullCalendar ref="fullCalendar" :options="calendarOptions" />
          <div v-if="!isLoading && scheduledUpdates.length === 0" class="empty-state">
            <i class="fas fa-calendar-check"></i>
            <p>目前沒有任何預約變更記錄。</p>
          </div>
        </div>
      </div>
    </main>

    <NewUpdateTypeDialog
      :is-visible="isNewTypeDialogVisible"
      :all-patients="allPatients"
      @close="isNewTypeDialogVisible = false"
      @continue="handleNewTypeSelected"
    />

    <!-- ✨ 2. 將 @close 的值改為呼叫新函式 -->
    <PatientUpdateSchedulerDialog
      :is-visible="isSchedulerDialogVisible"
      :patient="patientForScheduler"
      :change-type="changeTypeForScheduler"
      :all-patients="allPatients"
      :is-editing="isEditingUpdate"
      :initial-data="isEditingUpdate ? currentUpdateForAction : null"
      @close="closeSchedulerDialogs"
      @submit="handleScheduledUpdate"
    />

    <!-- ✨ 核心修改：將 ConfirmDialog 改為自訂 Footer -->
    <ConfirmDialog
      :is-visible="isConfirmDialogVisible"
      :title="confirmDialogTitle"
      :message="confirmDialogMessage"
      @cancel="isConfirmDialogVisible = false"
    >
      <!-- 當 ConfirmDialog 看到這個 template, $slots.footer 就會為 true -->
      <template #footer>
        <!-- ✨ 1. 在這裡加上 dialog-footer class -->
        <div class="dialog-footer dialog-footer-custom">
          <button class="btn btn-secondary" @click="isConfirmDialogVisible = false">關閉</button>
          <div>
            <button
              v-if="currentUpdateForAction && currentUpdateForAction.status === 'pending'"
              class="btn btn-primary"
              @click="handleEdit"
              :disabled="isPageLocked"
            >
              修改
            </button>
            <button
              v-if="
                currentUpdateForAction &&
                currentUpdateForAction.status === 'pending' &&
                new Date(currentUpdateForAction.effectiveDate) >=
                  new Date(new Date().toISOString().split('T')[0])
              "
              class="btn btn-danger"
              @click="handleDelete"
              :disabled="isPageLocked"
            >
              撤銷此預約
            </button>
          </div>
        </div>
      </template>
    </ConfirmDialog>
  </div>
</template>

<script setup>
import { ref, onUnmounted, onMounted, watch, computed, nextTick } from 'vue'
import { useAuth } from '@/composables/useAuth'
import { useGlobalNotifier } from '@/composables/useGlobalNotifier.js'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import FullCalendar from '@fullcalendar/vue3'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin from '@fullcalendar/interaction'
import zhTwLocale from '@fullcalendar/core/locales/zh-tw'
// ✨ 3. 引入 Pinia Store 和新 Dialog
import { usePatientStore } from '@/stores/patientStore'
import { storeToRefs } from 'pinia'
import NewUpdateTypeDialog from '@/components/NewUpdateTypeDialog.vue'
import PatientUpdateSchedulerDialog from '@/components/PatientUpdateSchedulerDialog.vue'
import ApiManager from '@/services/api_manager'

const scheduledUpdatesApi = ApiManager('scheduled_patient_updates')

// --- Composables & Constants ---
const { canEditSchedules } = useAuth()
const { createGlobalNotification } = useGlobalNotifier()
const isPageLocked = computed(() => !canEditSchedules.value)
// ✨ 4. 初始化 Store
const patientStore = usePatientStore()
const { allPatients } = storeToRefs(patientStore)

const TYPE_MAP = {
  UPDATE_STATUS: '身分變更',
  UPDATE_MODE: '模式變更',
  UPDATE_FREQ: '頻率變更',
  UPDATE_BASE_SCHEDULE_RULE: '總表規則變更',
  DELETE_PATIENT: '刪除病人',
  RESTORE_PATIENT: '復原病人',
}

const STATUS_MAP = {
  pending: { text: '待執行', color: '#ffc107', prefix: '[待]' },
  processed: { text: '已完成', color: '#198754', prefix: '[✓]' },
  failed: { text: '執行失敗', color: '#dc3545', prefix: '[!]' },
  cancelled: { text: '已取消', color: '#6c757d', prefix: '[✗]' },
}

// --- Reactive State ---
const scheduledUpdates = ref([])
const isLoading = ref(true)

const isConfirmDialogVisible = ref(false)
const confirmDialogTitle = ref('')
const confirmDialogMessage = ref('')
const currentUpdateForAction = ref(null)

// ✨✨✨【核心修正：在這裡補上遺漏的 ref 宣告】✨✨✨
const isNewTypeDialogVisible = ref(false)
const isSchedulerDialogVisible = ref(false)
const patientForScheduler = ref(null)
const changeTypeForScheduler = ref('')
const isEditingUpdate = ref(false)

const fullCalendar = ref(null)
const calendarApi = ref(null)
const calendarTitle = ref('') // <-- ✨ 補上這一行

// --- Computed Properties ---
const calendarEvents = computed(() => {
  return scheduledUpdates.value.map((update) => {
    const statusInfo = STATUS_MAP[update.status] || {
      text: '未知',
      color: '#6c757d',
      prefix: '[?]',
    }
    const typeText = TYPE_MAP[update.changeType] || '未知變更'
    const title = `${statusInfo.prefix} ${update.patientName} - ${typeText}`

    return {
      id: update.id,
      title: title,
      start: update.effectiveDate,
      allDay: true,
      backgroundColor: statusInfo.color,
      borderColor: statusInfo.color,
      extendedProps: update,
    }
  })
})

const calendarOptions = computed(() => ({
  plugins: [dayGridPlugin, interactionPlugin],
  initialView: 'dayGridMonth',
  locale: zhTwLocale,
  headerToolbar: false,
  dayMaxEvents: true,
  events: calendarEvents.value,
  datesSet: (arg) => {
    calendarTitle.value = arg.view.title
  },
  eventClick: (info) => {
    handleEventClick(info.event.extendedProps)
  },
}))

// --- Functions ---
function formatPayload(update) {
  const { changeType } = update
  // 相容 changeData (後端) 和 payload (舊格式)
  const payload = update.changeData || update.payload || {}
  const statusMap = { opd: '門診', ipd: '住院', er: '急診' }
  switch (changeType) {
    case 'UPDATE_STATUS':
      return `新身分: ${statusMap[payload.status] || (payload.status || '').toUpperCase()}${payload.wardNumber ? ` (${payload.wardNumber})` : ''}`
    case 'UPDATE_MODE':
      return `新模式: ${payload.mode || ''}`
    case 'UPDATE_FREQ':
      return `新頻率: ${payload.freq || ''}`
    case 'UPDATE_BASE_SCHEDULE_RULE':
      const shiftMap = { 0: '早', 1: '午', 2: '晚' }
      const bed = String(payload.bedNum || '').startsWith('p')
        ? `外圍${String(payload.bedNum).slice(-1)}`
        : `${payload.bedNum}床`
      return `新規則: ${bed} / ${shiftMap[payload.shiftIndex]}班 / ${payload.freq || ''}`
    case 'DELETE_PATIENT':
      return `原因: ${payload.deleteReason || ''}${payload.remarks ? ` (${payload.remarks})` : ''}`
    case 'RESTORE_PATIENT':
      return `復原至: ${statusMap[payload.status] || (payload.status || '').toUpperCase()}${payload.wardNumber ? ` (${payload.wardNumber})` : ''}`

    default:
      return JSON.stringify(payload)
  }
}

// ✨ 核心修改：重寫 handleEventClick 函式
function handleEventClick(update) {
  currentUpdateForAction.value = update // 保存當前操作的整個 update 物件
  const statusInfo = STATUS_MAP[update.status] || { text: '未知' }

  confirmDialogTitle.value = '預約變更詳情'
  confirmDialogMessage.value =
    `病人: ${update.patientName}\n` +
    `類型: ${TYPE_MAP[update.changeType] || '未知'}\n` +
    `生效日: ${update.effectiveDate}\n` +
    `狀態: ${statusInfo.text}\n` +
    `詳情: ${formatPayload(update)}\n`

  if (update.status === 'failed' && update.errorMessage) {
    confirmDialogMessage.value += `\n錯誤訊息: ${update.errorMessage}`
  }

  isConfirmDialogVisible.value = true
}

// ✨ 新增：處理修改按鈕點擊的函式
function handleEdit() {
  if (!currentUpdateForAction.value) return

  // 準備傳給 Dialog 的資料
  patientForScheduler.value = {
    id: currentUpdateForAction.value.patientId,
    name: currentUpdateForAction.value.patientName,
  }
  changeTypeForScheduler.value = currentUpdateForAction.value.changeType
  isEditingUpdate.value = true // 標記為編輯模式

  isConfirmDialogVisible.value = false
  setTimeout(() => {
    isSchedulerDialogVisible.value = true
  }, 150)
}

// ✨ 新增：處理撤銷按鈕點擊的函式
async function handleDelete() {
  if (!currentUpdateForAction.value?.id) return
  const updateIdToDelete = currentUpdateForAction.value.id
  const updateData = currentUpdateForAction.value

  isConfirmDialogVisible.value = false

  try {
    await scheduledUpdatesApi.delete(updateIdToDelete)
    const typeText = TYPE_MAP[updateData.changeType] || '預約'
    createGlobalNotification(`成功撤銷 ${updateData.patientName} 的 ${typeText}`, 'success')
    // 立即刷新列表
    await initializeListener()
  } catch (error) {
    console.error('撤銷預約失敗:', error)
    createGlobalNotification(`撤銷失敗: ${error.message}`, 'error')
  } finally {
    currentUpdateForAction.value = null
  }
}

function executeConfirmAction() {
  if (typeof confirmDialogAction.value === 'function') {
    confirmDialogAction.value()
  }
  isConfirmDialogVisible.value = false
}

// ✨ 1. 新增這個函式，專門用來處理關閉 Dialog 後的清理工作
function closeSchedulerDialogs() {
  isSchedulerDialogVisible.value = false
  isEditingUpdate.value = false
  // 未來如果還有其他需要重置的狀態，可以一併加在這裡
}

async function initializeListener() {
  isLoading.value = true

  try {
    const data = await scheduledUpdatesApi.fetchAll()
    scheduledUpdates.value = data.sort((a, b) => {
      const dateA = new Date(a.createdAt).getTime()
      const dateB = new Date(b.createdAt).getTime()
      return dateB - dateA
    })
  } catch (error) {
    console.error('獲取預約變更失敗:', error)
  }
  isLoading.value = false
}

function handlePrev() {
  calendarApi.value?.prev()
}
function handleNext() {
  calendarApi.value?.next()
}
function handleToday() {
  calendarApi.value?.today()
}

// ✨ 6. 新增處理 Dialog 流程的函式
function openNewUpdateDialog() {
  if (isPageLocked.value) return
  isNewTypeDialogVisible.value = true
}

function handleNewTypeSelected({ patient, changeType }) {
  patientForScheduler.value = patient
  changeTypeForScheduler.value = changeType
  isNewTypeDialogVisible.value = false
  // 延遲一點打開，避免閃爍
  setTimeout(() => {
    isSchedulerDialogVisible.value = true
  }, 150)
}

// ✨ 修改：handleScheduledUpdate 函式，使其能處理更新操作
async function handleScheduledUpdate(dataToSubmit) {
  isSchedulerDialogVisible.value = false
  try {
    if (isEditingUpdate.value && currentUpdateForAction.value?.id) {
      await scheduledUpdatesApi.update(currentUpdateForAction.value.id, dataToSubmit)
      createGlobalNotification('預約變更已成功更新', 'success')
    } else {
      await scheduledUpdatesApi.create(dataToSubmit)
      createGlobalNotification('預約成功！變更將在指定日期自動生效。', 'success')
    }
    await initializeListener()
  } catch (error) {
    console.error('提交預約失敗:', error)
    createGlobalNotification(`操作失敗: ${error.message}`, 'error')
  } finally {
    isEditingUpdate.value = false
    currentUpdateForAction.value = null
  }
}

// --- Lifecycle & Watchers ---
onMounted(() => {
  // ✨ 7. 確保在監聽前先獲取病人資料
  patientStore.fetchPatientsIfNeeded().then(() => {
    initializeListener()
  })
})

onUnmounted(() => {
  // Cleanup if needed
})

watch(isLoading, (newIsLoading) => {
  if (!newIsLoading) {
    nextTick(() => {
      if (fullCalendar.value) {
        calendarApi.value = fullCalendar.value.getApi()
        if (calendarApi.value) {
          calendarTitle.value = calendarApi.value.view.title
        }
      }
    })
  }
})
</script>

<style scoped>
@import url('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.4/css/all.min.css');

/* ================================== */
/*         通用及版面樣式            */
/* ================================== */
.page-container {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  background-color: #f8f9fa;
  padding: 0.5rem;
  height: calc(100vh - 60px); /* 減去 MainLayout 頂部導航列的高度 */
}

.page-header-section {
  border-bottom: 2px solid #dee2e6;
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  flex-shrink: 0;
}

.header-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem; /* 新增間距 */
}

/* ✨ 新增 toolbar-left 樣式 */
.toolbar-left {
  display: flex;
  align-items: center;
  gap: 1.5rem; /* 標題和按鈕之間的間距 */
  flex-wrap: wrap; /* 在小螢幕時允許換行 */
}

.page-title {
  font-size: 2rem; /* 32px */
  font-weight: 700;
  color: #343a40;
  margin: 0;
}

.page-description {
  margin-top: 0.5rem;
  font-size: 1rem;
  color: #6c757d;
}

.page-main-content {
  flex-grow: 1;
  background-color: #fff;
  padding: 1.5rem;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.updates-list-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* ================================== */
/*         按鈕樣式 (Btn Styles)      */
/* ================================== */
.btn {
  padding: 0.5rem 1rem;
  border-radius: 6px;
  border: 1px solid transparent;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s;
  font-size: 0.95rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  white-space: nowrap;
}

.btn-primary {
  background-color: #007bff;
  color: white;
  border-color: #007bff;
}
.btn-primary:hover:not(:disabled) {
  background-color: #0069d9;
}

.btn-danger {
  background-color: #dc3545;
  color: white;
  border-color: #dc3545;
}
.btn-danger:hover:not(:disabled) {
  background-color: #c82333;
}

button:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

/* ================================== */
/*     日曆標頭 (Calendar Header)     */
/* ================================== */
.custom-calendar-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 1.5rem;
  flex-shrink: 0;
  flex-wrap: wrap;
  gap: 1rem;
}

.date-navigator {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.calendar-title-text {
  font-weight: 600;
  font-size: 1.75rem;
  color: #343a40;
}

.view-actions {
  display: flex;
  gap: 0.5rem;
}

.custom-calendar-header button {
  padding: 0.5rem 1rem;
  border: 1px solid #ced4da;
  border-radius: 6px;
  cursor: pointer;
  background-color: #fff;
  font-weight: 500;
  font-size: 0.9rem;
  transition: all 0.2s;
}

.custom-calendar-header button:hover {
  border-color: #868e96;
  background-color: #e9ecef;
}

/* ================================== */
/*     載入 & 空白狀態 & 日曆本體     */
/* ================================== */
.loading-state,
.empty-state {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
  padding: 4rem 0;
  color: #6c757d;
  font-size: 1.2rem;
}

.spinner {
  border: 4px solid #f3f3f3;
  border-top: 4px solid #007bff;
  border-radius: 50%;
  width: 40px;
  height: 40px;
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

.empty-state i {
  font-size: 3rem;
  color: #198754;
  margin-bottom: 1rem;
}

.calendar-wrapper {
  flex-grow: 1;
  overflow-y: auto;
  min-height: 0;
}

:deep(.fc) {
  font-family: inherit;
  height: 100%;
}

:deep(.fc-view-harness) {
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
}

:deep(.fc-daygrid-event) {
  cursor: pointer;
  border-radius: 4px;
  padding: 3px 6px;
  font-size: 0.85em;
  font-weight: 500;
  border: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: opacity 0.2s;
}

:deep(.fc-event:hover) {
  opacity: 0.85;
}

:deep(.fc-day-today) {
  background-color: #eaf6ff !important;
}

:deep(.dialog-message) {
  white-space: pre-wrap;
  text-align: left;
  line-height: 1.6;
}

:deep(.dialog-footer) {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}
:deep(.footer-right) {
  display: flex;
  gap: 12px;
}

/* 讓 ConfirmDialog 的 footer 插槽能夠正確排版 */
:deep(.dialog-footer-custom) {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  padding: 1rem 1.5rem; /* ✨ 確保有 padding */
  border-top: 1px solid #e9ecef; /* ✨ 加上分隔線 */
}

:deep(.dialog-footer-custom > div) {
  display: flex;
  gap: 0.75rem; /* 按鈕之間的間距 */
}

/* ================================== */
/*        響應式 (Responsive)         */
/* ================================== */
@media (max-width: 768px) {
  .page-container {
    padding: 0.5rem;
  }
  .page-title {
    font-size: 1.5rem;
  }
  .page-description {
    font-size: 0.85rem;
  }
  .page-main-content {
    padding: 0.75rem;
  }
  .calendar-title-text {
    font-size: 1.25rem;
  }
  .custom-calendar-header button,
  .btn {
    padding: 0.4rem 0.8rem;
    font-size: 0.8rem;
  }
}
</style>
