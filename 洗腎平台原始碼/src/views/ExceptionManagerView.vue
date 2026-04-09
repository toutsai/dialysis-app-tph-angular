<!-- 檔案路徑: src/views/ExceptionManagerView.vue (最終修正版) -->
<template>
  <div class="page-container">
    <div class="page-header-section">
      <div class="header-toolbar">
        <div class="toolbar-left">
          <h1 class="page-title">調班管理(單次或區間調整班別)</h1>
          <button
            class="btn btn-primary desktop-only"
            @click="openCreateDialog"
            :disabled="isPageLocked"
          >
            <i class="fas fa-plus-circle"></i> 新增調班申請
          </button>
        </div>
      </div>
      <p class="page-description">
        處理單次或區間調整，如「臨時調班」、「區間暫停」或「臨時加洗」等。建立的申請將會自動更新對應日期的排班表。
      </p>
    </div>

    <main class="page-main-content">
      <div class="exceptions-list-container">
        <div class="custom-calendar-header">
          <div class="date-navigator">
            <button @click="handlePrev">&lt;</button>
            <span class="calendar-title-text is-clickable" @click="openMonthPicker">{{
              calendarTitle
            }}</span>
            <button @click="handleNext">&gt;</button>
          </div>
          <div class="view-actions">
            <button @click="handleToday">今天</button>
            <button @click="handleViewChange('dayGridMonth')">月</button>
            <button @click="handleViewChange('dayGridWeek')">週</button>
          </div>
        </div>

        <div v-if="isLoading" class="loading-state">正在載入調班申請資料...</div>
        <div v-else class="calendar-wrapper">
          <FullCalendar ref="fullCalendar" :options="calendarOptions" />
          <div v-if="!isLoading && exceptions.length === 0" class="empty-state">
            <i class="fas fa-check-circle"></i>
            <p>目前沒有任何待處理或已生效的調班。</p>
          </div>
        </div>
      </div>
    </main>

    <button class="fab mobile-only" @click="openCreateDialog" :disabled="isPageLocked">
      <i class="fas fa-plus"></i>
    </button>

    <ExceptionCreateDialog
      :is-visible="isCreateDialogVisible"
      :all-patients="allPatients"
      :is-page-locked="isPageLocked"
      :initial-data="exceptionToReEdit"
      @close="closeCreateDialog"
      @submit="handleCreateException"
      @delete="handleDeleteFromChild"
    />

    <ConfirmDialog
      :is-visible="isActionDialogVisible"
      :title="actionDialogTitle"
      :message="actionDialogMessage"
      @cancel="isActionDialogVisible = false"
    >
      <template #footer>
        <div class="dialog-footer-custom">
          <button class="btn btn-secondary" @click="isActionDialogVisible = false">關閉</button>
          <div class="footer-actions">
            <!-- 🔥🔥🔥【核心修正】🔥🔥🔥 -->
            <!-- 將 v-if 條件從只檢查 pending 改為呼叫 isCancellable 函式 -->
            <button
              v-if="currentActionData && isCancellable(currentActionData)"
              class="btn btn-primary"
              @click="handleEdit"
              :disabled="isPageLocked"
            >
              修改
            </button>
            <button
              v-if="currentActionData && isCancellable(currentActionData)"
              class="btn btn-danger"
              @click="handleDelete"
              :disabled="isPageLocked"
            >
              撤銷此申請
            </button>
          </div>
        </div>
      </template>
    </ConfirmDialog>

    <AlertDialog
      :is-visible="isAlertDialogVisible"
      :title="alertDialogTitle"
      :message="alertDialogMessage"
      @confirm="isAlertDialogVisible = false"
    />

    <!-- 合併確認 Dialog -->
    <ConfirmDialog
      :is-visible="isMergeDialogVisible"
      title="發現相同調班申請"
      :message="mergeDialogMessage"
      confirm-text="整併"
      cancel-text="取消"
      @confirm="handleMergeConfirm"
      @cancel="handleMergeCancel"
    />

    <MonthYearPicker
      :is-visible="isMonthPickerVisible"
      :initial-date="currentCalendarDate"
      @close="isMonthPickerVisible = false"
      @date-selected="handleDateSelected"
    />
  </div>
</template>

<script setup>
import { ref, onUnmounted, watch, computed, nextTick, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuth } from '@/composables/useAuth'
import { useGlobalNotifier } from '@/composables/useGlobalNotifier.js'
import { useRealtimeNotifications } from '@/composables/useRealtimeNotifications.js'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import AlertDialog from '@/components/AlertDialog.vue'
import FullCalendar from '@fullcalendar/vue3'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin from '@fullcalendar/interaction'
import listPlugin from '@fullcalendar/list'
import zhTwLocale from '@fullcalendar/core/locales/zh-tw'
import MonthYearPicker from '@/components/MonthYearPicker.vue'
import { useBreakpoints } from '@/composables/useBreakpoints.js'
import { usePatientStore } from '@/stores/patientStore'
import { storeToRefs } from 'pinia'
import ExceptionCreateDialog from '@/components/ExceptionCreateDialog.vue'
import { formatDateTimeToLocal, parseFirestoreTimestamp } from '@/utils/dateUtils.js'
import { schedulesApi, systemApi } from '@/services/localApiClient'

const patientStore = usePatientStore()
const { allPatients } = storeToRefs(patientStore)
const { isMobile } = useBreakpoints()
const router = useRouter()
const route = useRoute()
const { createGlobalNotification } = useGlobalNotifier()
const { addLocalNotification, refreshNotifications } = useRealtimeNotifications()
const { currentUser, canEditSchedules } = useAuth()

const isPageLocked = computed(() => !canEditSchedules.value)
const exceptions = ref([])
const isLoading = ref(true)
const isCreateDialogVisible = ref(false)
const exceptionToReEdit = ref(null)
const isAlertDialogVisible = ref(false)
const alertDialogTitle = ref('')
const alertDialogMessage = ref('')
let unsubscribe = null
const fullCalendar = ref(null)
const calendarApi = ref(null)
const calendarTitle = ref('')
const isMonthPickerVisible = ref(false)

const isActionDialogVisible = ref(false)
const actionDialogTitle = ref('')
const actionDialogMessage = ref('')
const currentActionData = ref(null)

// 合併確認 Dialog 狀態
const isMergeDialogVisible = ref(false)
const mergeDialogMessage = ref('')
const pendingFormData = ref(null) // 待處理的新申請表單資料
const existingExceptionsToMerge = ref([]) // 找到的所有可合併申請（陣列）

const statusMap = {
  pending: '待處理',
  processing: '處理中',
  applied: '已生效',
  error: '錯誤',
  expired: '已過期',
  conflict_requires_resolution: '衝突待解決',
  cancelled: '已撤銷',
}

// 輪詢檢查調班狀態更新
const pollingIntervals = ref(new Map())

/**
 * 開始輪詢某個調班申請的狀態
 * @param {string} exceptionId - 調班申請 ID
 * @param {string} patientName - 病患名稱（用於通知）
 * @param {string} type - 調班類型
 */
function startPollingExceptionStatus(exceptionId, patientName, type) {
  // 如果已經在輪詢，不重複啟動
  if (pollingIntervals.value.has(exceptionId)) return

  let attempts = 0
  const maxAttempts = 10 // 最多輪詢 10 次（約 10 秒）

  const intervalId = setInterval(async () => {
    attempts++

    try {
      const updatedException = await schedulesApi.fetchExceptionById(exceptionId)

      if (!updatedException) {
        // 申請可能被刪除了
        stopPollingExceptionStatus(exceptionId)
        return
      }

      // 檢查狀態是否已更新
      if (updatedException.status !== 'pending' && updatedException.status !== 'processing') {
        stopPollingExceptionStatus(exceptionId)

        // 更新本地列表
        const index = exceptions.value.findIndex(ex => ex.id === exceptionId)
        if (index !== -1) {
          exceptions.value[index] = updatedException
        } else {
          exceptions.value.unshift(updatedException)
        }

        // 顯示結果通知
        const typeText = typeMap[type] || '調班'
        if (updatedException.status === 'applied') {
          createGlobalNotification(`✓ ${patientName} ${typeText}申請已生效`, 'success')
        } else if (updatedException.status === 'error') {
          addLocalNotification(`✗ ${patientName} ${typeText}申請失敗: ${updatedException.errorMessage || '處理錯誤'}`)
        } else if (updatedException.status === 'conflict_requires_resolution') {
          addLocalNotification(`⚠ ${patientName} ${typeText}申請有衝突，需要處理`)
        }

        // 🔥 立即刷新側邊欄通知
        refreshNotifications()
        return
      }

      // 達到最大嘗試次數，停止輪詢
      if (attempts >= maxAttempts) {
        stopPollingExceptionStatus(exceptionId)
        // 重新載入整個列表以確保同步
        await refreshExceptionsList()
      }
    } catch (error) {
      console.error('輪詢調班狀態失敗:', error)
      if (attempts >= maxAttempts) {
        stopPollingExceptionStatus(exceptionId)
      }
    }
  }, 1000) // 每秒輪詢一次

  pollingIntervals.value.set(exceptionId, intervalId)
}

/**
 * 停止輪詢某個調班申請
 */
function stopPollingExceptionStatus(exceptionId) {
  const intervalId = pollingIntervals.value.get(exceptionId)
  if (intervalId) {
    clearInterval(intervalId)
    pollingIntervals.value.delete(exceptionId)
  }
}

/**
 * 重新載入調班列表
 */
async function refreshExceptionsList() {
  try {
    const data = await schedulesApi.fetchExceptions()
    exceptions.value = (data || []).sort((a, b) => {
      const dateA = new Date(a.createdAt).getTime()
      const dateB = new Date(b.createdAt).getTime()
      return dateB - dateA
    })
  } catch (error) {
    console.error('重新載入調班列表失敗:', error)
  }
}
const typeMap = {
  MOVE: '臨時調班',
  SUSPEND: '區間暫停',
  ADD_SESSION: '臨時加洗',
  RANGE_MOVE: '區間調班',
  SWAP: '同日互調',
}
const shiftMap = { early: '早班', noon: '午班', late: '晚班' }

const calendarEvents = computed(() => {
  if (!exceptions.value) return []
  return exceptions.value.flatMap((ex) => {
    const statusStyles = {
      pending: { color: '#ffc107', prefix: '[待]' },
      processing: { color: '#0dcaf0', prefix: '[中]' },
      applied: { color: '#198754', prefix: '[✓]' },
      error: { color: '#dc3545', prefix: '[!] ' },
      conflict_requires_resolution: { color: '#fd7e14', prefix: '[衝突]' },
      cancelled: { color: '#6c757d', prefix: '[撤銷]' },
    }
    const baseColorMap = {
      MOVE: '#17a2b8',
      SUSPEND: '#6610f2',
      ADD_SESSION: '#20c997',
      RANGE_MOVE: '#e83e8c',
      SWAP: '#fd7e14',
    }
    const style = statusStyles[ex.status] || { color: '#6c757d', prefix: '[?]' }
    let finalColor = style.color
    if (ex.status === 'applied') {
      finalColor = baseColorMap[ex.type] || '#6c757d'
    }
    let baseTitle = ''
    if (ex.type === 'SWAP') {
      baseTitle = `${ex.patient1?.patientName || ''} <=> ${ex.patient2?.patientName || ''}`
    } else {
      baseTitle = `${ex.patientName || ''} - ${typeMap[ex.type] || '未知'}`
    }
    const title = `${style.prefix} ${baseTitle}`
    let description = ''
    if (ex.type === 'MOVE' && ex.from && ex.to) {
      description = `從 ${formatShiftInfo({ ...ex.from, date: ex.from.sourceDate })} 移至 ${formatShiftInfo({ ...ex.to, date: ex.to.goalDate })}`
    } else if (ex.type === 'ADD_SESSION' && ex.to) {
      description = `新增於 ${formatShiftInfo({ ...ex.to, date: ex.to.goalDate })}`
    } else if (ex.type === 'RANGE_MOVE' && ex.to) {
      description = `區間內移至: ${formatBedAndShift(ex.to)}`
    } else if (ex.type === 'SWAP' && ex.patient1 && ex.patient2) {
      const from1 = formatBedAndShift(ex.patient1)
      const from2 = formatBedAndShift(ex.patient2)
      description = `${ex.patient1.patientName} (${from1}) 與 ${ex.patient2.patientName} (${from2}) 互換`
    } else {
      description = ex.reason
    }
    if (ex.type === 'MOVE' && ex.from && ex.to) {
      const fromEvent = {
        id: `${ex.id}-from`,
        title: `[原班] ${ex.patientName}`,
        start: ex.from.sourceDate,
        allDay: true,
        backgroundColor: '#adb5bd',
        borderColor: '#adb5bd',
        extendedProps: { ...ex, formattedDetails: description },
      }
      const toEvent = {
        id: ex.id,
        title: title.replace('調班', '[新班]'),
        start: ex.to.goalDate,
        allDay: true,
        backgroundColor: finalColor,
        borderColor: finalColor,
        extendedProps: { ...ex, formattedDetails: description },
      }
      return [fromEvent, toEvent]
    }
    let exclusiveEndDate = null
    if (ex.endDate && ex.endDate !== ex.startDate) {
      const endDateObj = new Date(ex.endDate + 'T00:00:00Z')
      endDateObj.setUTCDate(endDateObj.getUTCDate() + 1)
      exclusiveEndDate = endDateObj.toISOString().split('T')[0]
    }
    return [
      {
        id: ex.id,
        title: title,
        start: ex.startDate,
        end: exclusiveEndDate,
        allDay: true,
        backgroundColor: finalColor,
        borderColor: finalColor,
        extendedProps: { ...ex, formattedDetails: description },
      },
    ]
  })
})

const calendarOptions = computed(() => ({
  plugins: [dayGridPlugin, interactionPlugin, listPlugin],
  initialView: isMobile.value ? 'dayGridWeek' : 'dayGridMonth',
  locale: zhTwLocale,
  headerToolbar: false,
  dayMaxEvents: true,
  events: calendarEvents.value,
  eventDisplay: isMobile.value ? 'list-item' : 'block',
  datesSet: (arg) => {
    calendarTitle.value = arg.view.title
  },
  eventClick: (info) => {
    const exData = info.event.extendedProps
    currentActionData.value = exData

    let patientDisplayName = exData.patientName
    if (exData.type === 'SWAP') {
      patientDisplayName = `${exData.patient1?.patientName} & ${exData.patient2?.patientName}`
    }

    actionDialogTitle.value = '調班詳細資訊'
    actionDialogMessage.value =
      `病患: ${patientDisplayName}\n` +
      `類型: ${typeMap[exData.type] || '未知'}\n` +
      `狀態: ${statusMap[exData.status] || '未知'}\n` +
      `區間: ${exData.startDate} ~ ${exData.endDate || exData.startDate}\n` +
      `詳細: ${exData.formattedDetails}\n` +
      `申請時間: ${formatTimestamp(exData.createdAt)}`

    if (exData.status === 'error' && exData.errorMessage) {
      actionDialogMessage.value += `\n\n錯誤訊息: ${exData.errorMessage}`
    }

    isActionDialogVisible.value = true
  },
}))

const currentCalendarDate = computed(() =>
  calendarApi.value ? calendarApi.value.getDate() : new Date(),
)

// ✨✨✨【核心修正：強化 isCancellable 函式】✨✨✨
/**
 * 判斷一個調班申請是否還可以被使用者撤銷或修改。
 * @param {object} exceptionData - 調班申請的資料。
 * @returns {boolean} - 如果可以撤銷/修改，則返回 true。
 */
function isCancellable(exceptionData) {
  // 1. 基本狀態檢查：已撤銷、已過期或處理錯誤的申請，不能再操作。
  if (
    !exceptionData ||
    exceptionData.status === 'cancelled' ||
    exceptionData.status === 'expired' ||
    exceptionData.status === 'error'
  ) {
    return false
  }

  // 2. 建立一個代表「今天凌晨 0 點」的日期物件，用於比較。
  //    這樣做可以完全避免時區問題。
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // 3. 找出此調班申請「最晚會影響到的日期」。
  let latestDateStr = exceptionData.endDate || exceptionData.startDate || exceptionData.date
  if (exceptionData.type === 'MOVE' && exceptionData.to && exceptionData.from) {
    // 對於跨日調班，取較晚的那個日期
    latestDateStr =
      exceptionData.to.goalDate > exceptionData.from.sourceDate
        ? exceptionData.to.goalDate
        : exceptionData.from.sourceDate
  }

  // 如果找不到任何有效日期，為安全起見，不允許撤銷。
  if (!latestDateStr) {
    return false
  }

  // 4. 將最晚影響日期轉換為 Date 物件。
  //    加上 'T00:00:00' 是為了確保日期物件不含時間，避免比對出錯。
  const latestDate = new Date(latestDateStr + 'T00:00:00')

  // 5. 最終判斷：只有當最晚影響日期是「今天」或「未來」時，才允許撤銷/修改。
  return latestDate >= today
}

async function scrollToCurrentWeek() {
  await nextTick()
  if (!fullCalendar.value) return
  try {
    const calendarEl = fullCalendar.value.$el
    if (!calendarEl) return
    const todayEl = calendarEl.querySelector('.fc-day-today')
    if (todayEl) {
      const weekRowEl = todayEl.closest('tr')
      if (weekRowEl) {
        weekRowEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }
  } catch (error) {
    console.error('滾動到當前週失敗:', error)
  }
}
function handlePrev() {
  calendarApi.value?.prev()
}
function handleNext() {
  calendarApi.value?.next()
}
function handleToday() {
  calendarApi.value?.today()
  scrollToCurrentWeek()
}
function handleViewChange(viewName) {
  calendarApi.value?.changeView(viewName)
}
function openMonthPicker() {
  isMonthPickerVisible.value = true
}
function handleDateSelected(newDate) {
  calendarApi.value?.gotoDate(newDate)
  isMonthPickerVisible.value = false
}
function formatTimestamp(ts) {
  if (!ts) return 'N/A'
  return formatDateTimeToLocal(parseFirestoreTimestamp(ts))
}
function formatShiftInfo(shiftData) {
  if (!shiftData) return ''
  const shiftName = shiftMap[shiftData.shiftCode] || shiftData.shiftCode
  const bedDisplay = String(shiftData.bedNum).startsWith('peripheral-')
    ? `外圍 ${String(shiftData.bedNum).split('-')[1]}`
    : `${shiftData.bedNum}床`
  return `${shiftData.date || ''} (${shiftName} ${bedDisplay})`
}
function formatBedAndShift(targetData) {
  if (!targetData) return 'N/A'
  const bedNum = targetData.fromBedNum || targetData.bedNum
  const shiftCode = targetData.fromShiftCode || targetData.shiftCode
  if (!bedNum || !shiftCode) return 'N/A'
  const shiftName = shiftMap[shiftCode] || shiftCode
  const bedDisplay = String(bedNum).startsWith('peripheral-')
    ? `外圍 ${String(bedNum).split('-')[1]}`
    : `${bedNum}床`
  return `${bedDisplay} / ${shiftName}`
}
function openCreateDialog() {
  if (isPageLocked.value) return
  exceptionToReEdit.value = null
  isCreateDialogVisible.value = true
}
function closeCreateDialog() {
  isCreateDialogVisible.value = false
  setTimeout(() => {
    exceptionToReEdit.value = null
  }, 300)
}

function handleEdit() {
  if (!currentActionData.value) return

  // 任何可撤銷的事件（pending, applied, conflict）都可以被編輯
  if (
    isCancellable(currentActionData.value) ||
    currentActionData.value.status === 'conflict_requires_resolution'
  ) {
    exceptionToReEdit.value = { ...currentActionData.value }
    isActionDialogVisible.value = false
    setTimeout(() => {
      isCreateDialogVisible.value = true
    }, 150)
  }
}

async function handleDelete() {
  if (!currentActionData.value?.id) return
  const exceptionId = currentActionData.value.id
  const exceptionData = currentActionData.value
  isActionDialogVisible.value = false

  try {
    // 先刪除對應的調班訊息
    await deleteOldExceptionMessages(exceptionData)

    // 使用本地 API 刪除
    await schedulesApi.deleteException(exceptionId)

    let message = ''
    if (exceptionData.type === 'SWAP') {
      message = `成功撤銷調班申請: ${exceptionData.patient1.patientName}與${exceptionData.patient2.patientName}`
    } else {
      const typeText = typeMap[exceptionData.type] || '調班'
      message = `成功撤銷調班申請: ${exceptionData.patientName} (${typeText})`
    }
    createGlobalNotification(message, 'success')
    // 立即刷新列表
    await refreshExceptionsList()
  } catch (error) {
    console.error('撤銷失敗:', error)
    alertDialogTitle.value = '撤銷失敗'
    alertDialogMessage.value = `執行撤銷操作時發生錯誤: ${error.message}`
    isAlertDialogVisible.value = true
  } finally {
    currentActionData.value = null
  }
}

async function handleDeleteFromChild(id) {
  createGlobalNotification('成功撤銷衝突的調班申請', 'success')
  // 立即刷新列表
  await refreshExceptionsList()
}

/**
 * 檢查是否存在可合併的現有調班申請
 * @param {object} formData - 新提交的表單資料
 * @returns {Array} - 找到的所有可合併申請陣列（可能為空）
 */
function findMergeableExceptions(formData) {
  // 如果是編輯模式（更新現有申請），不檢查合併
  if (formData.id) return []

  // 取得新申請的目標日期
  let targetDate = null
  if (formData.type === 'MOVE') {
    targetDate = formData.to?.goalDate
  } else if (formData.type === 'ADD_SESSION') {
    targetDate = formData.to?.goalDate
  } else if (formData.type === 'SUSPEND') {
    // 暫停類型用 startDate
    targetDate = formData.startDate
  } else if (formData.type === 'SWAP') {
    targetDate = formData.date
  }

  if (!targetDate) return []

  // 判斷新申請是否為「當日調班」（原始日期 = 目標日期）
  // 注意：使用 sourceDate 而非 date
  const isNewSameDayMove =
    formData.type === 'MOVE' && formData.from?.sourceDate === formData.to?.goalDate

  // 在現有申請中尋找【所有】可合併的（使用 filter 而非 find）
  return exceptions.value.filter((ex) => {
    // 必須是同病人、同類型、且狀態為 pending 或 applied
    if (ex.patientId !== formData.patientId) return false
    if (ex.type !== formData.type) return false
    if (!['pending', 'applied'].includes(ex.status)) return false

    // 檢查目標日期是否相同
    let existingTargetDate = null
    if (ex.type === 'MOVE') {
      existingTargetDate = ex.to?.goalDate
    } else if (ex.type === 'ADD_SESSION') {
      existingTargetDate = ex.to?.goalDate
    } else if (ex.type === 'SUSPEND') {
      existingTargetDate = ex.startDate
    } else if (ex.type === 'SWAP') {
      existingTargetDate = ex.date
    }

    if (existingTargetDate !== targetDate) return false

    // ✨ MOVE 類型：只有當兩者都是「當日調班」時才合併
    // 跨日調班不合併，直接新增
    if (formData.type === 'MOVE') {
      // 注意：使用 sourceDate 而非 date
      const isExistingSameDayMove = ex.from?.sourceDate === ex.to?.goalDate
      // 只有兩者都是當日調班才合併
      if (!isNewSameDayMove || !isExistingSameDayMove) {
        return false
      }
    }

    return true
  })
}

/**
 * 將調班申請串成鏈狀，找出鏈的起點（真正的原始床位）
 * 例如：A→B, B→C, C→D 應該找出 A 作為鏈頭
 * @param {Array} exceptions - 所有調班申請
 * @param {object} newFormData - 新提交的表單資料
 * @returns {object} - 鏈頭的 from 資料
 */
function findChainHead(exceptions, newFormData) {
  // 將所有申請（包含新的）合併
  const allMoves = [
    ...exceptions.map((ex) => ({
      fromKey: `${ex.from?.bedNum}-${ex.from?.shiftCode}`,
      toKey: `${ex.to?.bedNum}-${ex.to?.shiftCode}`,
      from: ex.from,
    })),
    {
      fromKey: `${newFormData.from?.bedNum}-${newFormData.from?.shiftCode}`,
      toKey: `${newFormData.to?.bedNum}-${newFormData.to?.shiftCode}`,
      from: newFormData.from,
    },
  ]

  // 收集所有的 to 床位
  const allToKeys = new Set(allMoves.map((m) => m.toKey))

  // 找出鏈頭：from 不在任何 to 中的申請
  const chainHead = allMoves.find((m) => !allToKeys.has(m.fromKey))

  // 如果找不到（可能是環狀），就用第一筆
  return chainHead?.from || exceptions[0]?.from
}

/**
 * 產生合併確認訊息（支援多筆現有申請）
 * @param {Array} existingExceptions - 所有可合併的現有申請陣列
 * @param {object} newFormData - 新提交的表單資料
 */
function generateMergeMessage(existingExceptions, newFormData) {
  const shiftDisplayMap = { early: '早班', noon: '午班', late: '晚班' }

  const formatBed = (bedNum, shiftCode) => {
    const bedText = String(bedNum).startsWith('peripheral')
      ? `外圍${String(bedNum).split('-')[1]}`
      : `${bedNum}床`
    const shiftText = shiftDisplayMap[shiftCode] || shiftCode
    return `${bedText}${shiftText}`
  }

  const count = existingExceptions.length
  const firstEx = existingExceptions[0]

  if (firstEx.type === 'MOVE') {
    // 列出所有現有調班的路徑
    const existingPaths = existingExceptions
      .map((ex) => {
        const from = formatBed(ex.from?.bedNum, ex.from?.shiftCode)
        const to = formatBed(ex.to?.bedNum, ex.to?.shiftCode)
        return `【${from} → ${to}】`
      })
      .join('\n')

    // 找出鏈的起點（真正的原始床位）
    const chainHeadFrom = findChainHead(existingExceptions, newFormData)
    const chainHeadText = formatBed(chainHeadFrom?.bedNum, chainHeadFrom?.shiftCode)
    const newTo = formatBed(newFormData.to?.bedNum, newFormData.to?.shiftCode)

    return (
      `${firstEx.patientName} 在 ${firstEx.to?.goalDate} 已有 ${count} 筆臨時調班申請：\n` +
      `${existingPaths}\n\n` +
      `是否全部整併為：\n` +
      `【${chainHeadText} → ${newTo}】？`
    )
  } else if (firstEx.type === 'ADD_SESSION') {
    const existingBeds = existingExceptions
      .map((ex) => {
        return `【${formatBed(ex.to?.bedNum, ex.to?.shiftCode)}】`
      })
      .join('\n')
    const newBed = formatBed(newFormData.to?.bedNum, newFormData.to?.shiftCode)

    return (
      `${firstEx.patientName} 在 ${firstEx.to?.goalDate} 已有 ${count} 筆臨時加洗申請：\n` +
      `${existingBeds}\n\n` +
      `是否全部整併為：\n` +
      `【${newBed}】？`
    )
  } else if (firstEx.type === 'SUSPEND') {
    const existingRanges = existingExceptions
      .map((ex) => {
        return `【${ex.startDate} ~ ${ex.endDate}】`
      })
      .join('\n')

    return (
      `${firstEx.patientName} 已有 ${count} 筆區間暫停申請：\n` +
      `${existingRanges}\n\n` +
      `是否全部整併為：\n` +
      `【${newFormData.startDate} ~ ${newFormData.endDate}】？`
    )
  } else if (firstEx.type === 'SWAP') {
    return (
      `${firstEx.patient1?.patientName} 在 ${firstEx.date} 已有 ${count} 筆同日互調申請\n\n` +
      `是否全部整併為新的互調設定？`
    )
  }

  return `發現 ${count} 筆相同類型的調班申請，是否全部整併？`
}

async function handleCreateException(formData) {
  try {
    const isUpdating = !!formData.id

    // 如果不是更新模式，檢查是否有可合併的申請
    if (!isUpdating) {
      const existingExceptions = findMergeableExceptions(formData)
      if (existingExceptions.length > 0) {
        // 找到可合併的申請，先關閉 CreateDialog，再顯示確認對話框
        closeCreateDialog()
        existingExceptionsToMerge.value = existingExceptions
        pendingFormData.value = formData
        mergeDialogMessage.value = generateMergeMessage(existingExceptions, formData)
        isMergeDialogVisible.value = true
        return // 等待用戶確認
      }
    }

    // 正常流程：處理申請
    await processExceptionSubmission(formData, isUpdating)
  } catch (error) {
    console.error('提交調班申請失敗:', error)
    addLocalNotification(`操作失敗: ${error.message || '無法儲存調班申請'}`)
  }
}

/**
 * 實際處理調班申請的提交（新增或更新）
 */
async function processExceptionSubmission(formData, isUpdating) {
  try {
    if (isUpdating) {
      await schedulesApi.deleteException(formData.id)
    }
    const dataToSave = {
      patientId: formData.patientId,
      patientName: formData.patientName,
      type: formData.type,
      reason: formData.reason,
      startDate: formData.startDate,
      endDate: formData.endDate,
      from: formData.from,
      to: formData.to,
      status: 'pending',
      createdAt: new Date().toISOString(),
    }
    if (formData.type === 'SWAP') {
      dataToSave.date = formData.date
      dataToSave.patient1 = formData.patient1
      dataToSave.patient2 = formData.patient2
    }
    const result = await schedulesApi.createException(dataToSave)
    closeCreateDialog()

    // 立即刷新列表顯示新申請
    await refreshExceptionsList()

    // 🔥 開始輪詢，等待後端處理完成後即時更新
    if (result?.id) {
      const displayName = formData.type === 'SWAP'
        ? `${formData.patient1.patientName} & ${formData.patient2.patientName}`
        : formData.patientName
      startPollingExceptionStatus(result.id, displayName, formData.type)
    }

    const actionText = isUpdating ? '重新提交' : '新增'
    let message = ''
    if (formData.type === 'SWAP') {
      message = `${actionText}申請: ${formData.patient1.patientName} 與 ${formData.patient2.patientName}`
    } else {
      const typeText = typeMap[formData.type] || '調班'
      message = `${actionText}申請: ${formData.patientName} (${typeText})`
    }
    createGlobalNotification(message, 'success')

    let messageContent = ''
    const reasonText = `\n原因: ${formData.reason}`
    switch (formData.type) {
      case 'MOVE':
        messageContent =
          `【${isUpdating ? '更新-臨時調班' : '臨時調班'}】\n原排班: ${formData.from.sourceDate} (${formatBedAndShift(formData.from)})\n新排班: ${formData.to.goalDate} (${formatBedAndShift(formData.to)})` +
          reasonText
        break
      case 'SUSPEND':
        messageContent =
          `【區間暫停】\n從 ${formData.startDate} 至 ${formData.endDate}` + reasonText
        break
      case 'ADD_SESSION':
        messageContent =
          `【臨時加洗】\n日期: ${formData.to.goalDate} (${formatBedAndShift(formData.to)})` +
          reasonText
        break
      case 'SWAP':
        messageContent =
          `【同日互調】\n日期: ${formData.date}\n${formData.patient1.patientName} (${formatBedAndShift(formData.patient1)}) <=> ${formData.patient2.patientName} (${formatBedAndShift(formData.patient2)})` +
          reasonText
        break
    }

    if (messageContent && currentUser.value) {
      const createMessageTask = (patientInfo) => ({
        category: 'message',
        type: '常規',
        content: messageContent,
        patientId: patientInfo.id,
        patientName: patientInfo.name,
        targetDate: formData.date || formData.startDate,
        status: 'pending',
        creator: {
          uid: currentUser.value.uid,
          name: currentUser.value.name,
          title: currentUser.value.title,
        },
        createdAt: new Date().toISOString(),
        expireAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        assignee: null,
      })
      if (formData.type === 'SWAP') {
        const task1 = createMessageTask({
          id: formData.patient1.patientId,
          name: formData.patient1.patientName,
        })
        const task2 = createMessageTask({
          id: formData.patient2.patientId,
          name: formData.patient2.patientName,
        })
        await Promise.all([systemApi.createTask(task1), systemApi.createTask(task2)])
      } else {
        const task = createMessageTask({ id: formData.patientId, name: formData.patientName })
        await systemApi.createTask(task)
      }
    }
  } catch (error) {
    console.error('提交調班申請失敗:', error)
    addLocalNotification(`操作失敗: ${error.message || '無法儲存調班申請'}`)
  }
}

/**
 * 刪除舊的調班訊息 (task/message)
 * @param {object} existingEx - 現有的調班申請
 */
async function deleteOldExceptionMessages(existingEx) {
  try {
    // 取得要刪除的 targetDate
    const targetDate = existingEx.date || existingEx.startDate

    if (!targetDate) return

    // 使用本地 API 查詢符合條件的 task 訊息
    const tasks = await systemApi.fetchTasks({
      category: 'message',
      patientId: existingEx.patientId,
      targetDate: targetDate,
    }).catch(() => [])

    // 調班類型對應的關鍵字
    const typeKeywords = {
      MOVE: '臨時調班',
      SUSPEND: '區間暫停',
      ADD_SESSION: '臨時加洗',
      SWAP: '同日互調',
    }
    const keyword = typeKeywords[existingEx.type]

    // 過濾並刪除包含對應關鍵字的訊息
    const deletePromises = []
    for (const task of (tasks || [])) {
      if (task.content && keyword && task.content.includes(keyword)) {
        deletePromises.push(systemApi.deleteTask(task.id))
      }
    }

    if (deletePromises.length > 0) {
      await Promise.all(deletePromises)
      console.log(`已刪除 ${deletePromises.length} 筆舊的調班訊息`)
    }
  } catch (error) {
    console.error('刪除舊訊息失敗:', error)
    // 不中斷流程，繼續執行整併
  }
}

/**
 * 使用者確認合併：刪除所有原有申請，保留鏈頭的 from，更新為新的 to
 */
async function handleMergeConfirm() {
  isMergeDialogVisible.value = false

  if (existingExceptionsToMerge.value.length === 0 || !pendingFormData.value) {
    return
  }

  try {
    const existingExceptions = existingExceptionsToMerge.value
    const newFormData = pendingFormData.value
    const firstEx = existingExceptions[0]

    // 先刪除所有舊的調班訊息
    for (const ex of existingExceptions) {
      await deleteOldExceptionMessages(ex)
    }

    // 刪除除了第一筆之外的所有現有申請
    for (let i = 1; i < existingExceptions.length; i++) {
      await schedulesApi.deleteException(existingExceptions[i].id)
    }

    // 建立合併後的資料：保留鏈頭的 from，更新 to
    const mergedData = {
      ...newFormData,
      id: firstEx.id, // 用第一筆的 id 更新
    }

    // 對於 MOVE 類型，找出鏈頭作為真正的起點
    if (firstEx.type === 'MOVE') {
      const chainHeadFrom = findChainHead(existingExceptions, newFormData)
      if (chainHeadFrom) {
        mergedData.from = { ...chainHeadFrom }
        mergedData.startDate = chainHeadFrom.sourceDate
      }
    }

    // 提交合併後的申請（會更新第一筆）
    await processExceptionSubmission(mergedData, true)

    const count = existingExceptions.length
    createGlobalNotification(`已整併 ${count} 筆調班申請`, 'success')
  } catch (error) {
    console.error('合併調班申請失敗:', error)
    addLocalNotification(`合併失敗: ${error.message || '無法合併調班申請'}`)
  } finally {
    // 清理暫存狀態
    existingExceptionsToMerge.value = []
    pendingFormData.value = null
  }
}

/**
 * 使用者取消合併：取消這次操作，不提交任何東西
 */
function handleMergeCancel() {
  isMergeDialogVisible.value = false
  // 清理暫存狀態，不提交任何東西
  existingExceptionsToMerge.value = []
  pendingFormData.value = null
}

async function initializePageData() {
  if (unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }
  isLoading.value = true
  try {
    await patientStore.fetchPatientsIfNeeded()

    // 使用本地 API 獲取資料
    const data = await schedulesApi.fetchExceptions()
    exceptions.value = (data || []).sort((a, b) => {
      const dateA = new Date(a.createdAt).getTime()
      const dateB = new Date(b.createdAt).getTime()
      return dateB - dateA
    })
    isLoading.value = false
  } catch (error) {
    console.error('載入資料失敗:', error)
    isLoading.value = false
  }
}

watch(isLoading, (newIsLoading) => {
  if (!newIsLoading) {
    nextTick(() => {
      if (fullCalendar.value) {
        calendarApi.value = fullCalendar.value.getApi()
        if (calendarApi.value) {
          calendarTitle.value = calendarApi.value.view.title
          scrollToCurrentWeek()
        }
      }
    })
  }
})
watch(
  currentUser,
  (newUser) => {
    if (newUser) {
      initializePageData()
    } else {
      if (unsubscribe) {
        unsubscribe()
        unsubscribe = null
      }
      exceptions.value = []
      isLoading.value = false
    }
  },
  { immediate: true },
)
watch(
  () => route.query.resolveConflict,
  (conflictId) => {
    if (conflictId) {
      const conflictException = exceptions.value.find((ex) => ex.id === conflictId)
      if (conflictException) {
        exceptionToReEdit.value = conflictException
        isCreateDialogVisible.value = true
        router.replace({ query: {} })
      } else {
        console.warn(`URL 帶有 conflictId ${conflictId}，但在列表中找不到對應的調班申請。`)
      }
    }
  },
  { immediate: true },
)
watch(exceptions, (newExceptions, oldExceptions) => {
  if (!oldExceptions || oldExceptions.length === 0) {
    return
  }
  const oldExceptionsMap = new Map(oldExceptions.map((ex) => [ex.id, ex]))
  newExceptions.forEach((newEx) => {
    const oldEx = oldExceptionsMap.get(newEx.id)
    if (oldEx && (oldEx.status === 'pending' || oldEx.status === 'processing')) {
      if (newEx.status === 'error') {
        addLocalNotification(
          `調班申請失敗: ${newEx.patientName || ''} (${typeMap[newEx.type] || ''}) - ${newEx.errorMessage || '未知錯誤'}`,
        )
      } else if (newEx.status === 'conflict_requires_resolution') {
        addLocalNotification(
          `調班申請衝突: ${newEx.patientName || ''} (${typeMap[newEx.type] || ''}) - ${newEx.errorMessage || '床位已被佔用'}`,
        )
      }
    }
  })
})
onUnmounted(() => {
  if (unsubscribe) {
    unsubscribe()
  }
  // 清理所有輪詢
  pollingIntervals.value.forEach((intervalId) => {
    clearInterval(intervalId)
  })
  pollingIntervals.value.clear()
})
</script>

<style scoped>
@import url('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.4/css/all.min.css');
.page-container {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  background-color: #f8f9fa;
  padding: 0.5rem;
}
.page-header-section {
  border-bottom: 2px solid #dee2e6;
  margin-bottom: 1.5rem;
  flex-shrink: 0;
}
.header-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.page-title {
  font-size: 32px;
  font-weight: 700;
  color: #343a40;
  margin: 0;
}
.page-description {
  margin-top: 0.5rem;
  font-size: 1rem;
  color: #6c757d;
}
.btn {
  padding: 0.5rem 1rem;
  border-radius: 6px;
  border: 1px solid transparent;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s;
  font-size: 1rem;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}
.btn-primary {
  background-color: #007bff;
  color: white;
  border-color: #007bff;
}
.btn-primary:hover {
  background-color: #0069d9;
}
.btn-danger {
  background-color: #dc3545;
  color: white;
  border-color: #dc3545;
}
.btn-danger:hover {
  background-color: #c82333;
}
.btn-secondary {
  background-color: #6c757d;
  color: white;
}
.btn-secondary:hover {
  background-color: #5a6268;
}
button:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}
.page-main-content {
  flex-grow: 1;
  background-color: #fff;
  padding: 0.5rem;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.loading-state,
.empty-state {
  text-align: center;
  padding: 4rem 0;
  color: #6c757d;
}
.empty-state i {
  font-size: 3rem;
  color: #28a745;
  margin-bottom: 1rem;
}
.toolbar-left {
  display: flex;
  align-items: center;
  gap: 1.5rem;
}
.custom-calendar-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 0;
  flex-wrap: wrap;
  gap: 1rem;
  flex-shrink: 0;
}
.exceptions-list-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
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
  white-space: nowrap;
}
.view-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.custom-calendar-header button {
  padding: 0.5rem 1rem;
  border: 1px solid #ced4da;
  border-radius: 6px;
  cursor: pointer;
  background-color: #f8f9fa;
  font-weight: 500;
  transition: all 0.2s;
}
.custom-calendar-header button:hover {
  border-color: #868e96;
  background-color: #e9ecef;
}
.calendar-wrapper {
  flex-grow: 1;
  overflow-y: auto;
  min-height: 0;
}
.calendar-title-text.is-clickable {
  cursor: pointer;
  transition: color 0.2s;
}
.calendar-title-text.is-clickable:hover {
  color: #007bff;
}
:deep(.fc) {
  font-family: inherit;
}
:deep(.fc-daygrid-event) {
  cursor: pointer;
  border-radius: 4px;
  padding: 3px 5px;
  font-size: 0.85em;
  font-weight: 500;
  border: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:deep(.fc-event:hover) {
  opacity: 0.85;
}
:deep(.fc-day-today) {
  background-color: #eaf6ff !important;
}
.fab.mobile-only {
  display: none;
}
.btn.desktop-only {
  display: inline-flex;
}

:deep(.dialog-footer-custom) {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  padding: 1rem 1.5rem;
  border-top: 1px solid #e9ecef;
}
:deep(.footer-actions) {
  display: flex;
  gap: 0.75rem;
}

@media (max-width: 992px) {
  .page-container {
    padding: 1rem 0 0 0;
    padding-top: 60px;
  }
  .fab.mobile-only {
    display: flex;
  }
  .btn.desktop-only,
  .desktop-only-flex {
    display: none !important;
  }
  .page-header-section {
    margin-bottom: 1rem;
    padding: 1rem 1rem 0.75rem;
    border-radius: 0;
    background-color: #fff;
  }
  .page-title {
    font-size: 28px;
  }
  .page-description {
    font-size: 0.9rem;
  }
  .page-main-content {
    padding: 1rem;
    border-radius: 0;
    box-shadow: none;
    overflow-y: auto;
  }
  .fab {
    position: fixed;
    bottom: 2rem;
    right: 1.5rem;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background-color: #007bff;
    color: white;
    border: none;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    font-size: 1.5rem;
    align-items: center;
    justify-content: center;
    z-index: 10;
  }
}
@media (max-width: 480px) {
  .page-title {
    font-size: 24px;
  }
  .page-header-section {
    padding: 1rem 1rem 0.5rem;
    margin-bottom: 1rem;
  }
  .calendar-title-text {
    font-size: 1.25rem;
  }
}
</style>
