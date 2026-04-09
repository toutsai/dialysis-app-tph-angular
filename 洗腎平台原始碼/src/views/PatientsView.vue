<!-- 檔案路徑: src/views/PatientsView.vue -->
<script setup>
import { ref, onMounted, computed, watch, onUnmounted } from 'vue'
import {
  savePatient as optimizedSavePatient,
  updatePatient as optimizedUpdatePatient,
  createDialysisOrderAndUpdatePatient,
} from '@/services/optimizedApiService.js'
import {
  systemApi,
  schedulesApi as localSchedulesApi,
  patientsApi,
} from '@/services/localApiClient'
import { usePatientStore } from '@/stores/patientStore'
import { storeToRefs } from 'pinia'
import * as XLSX from 'xlsx'
import PatientFormModal from '@/components/PatientFormModal.vue'
import SelectionDialog from '@/components/SelectionDialog.vue'
import AlertDialog from '@/components/AlertDialog.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import DialysisOrderModal from '@/components/DialysisOrderModal.vue'
import PatientHistoryModal from '@/components/PatientHistoryModal.vue'
import WardNumberDialog from '@/components/WardNumberDialog.vue'
import PatientUpdateSchedulerDialog from '@/components/PatientUpdateSchedulerDialog.vue'
import { useAuth } from '@/composables/useAuth'
import { useGlobalNotifier } from '@/composables/useGlobalNotifier.js'
import { formatDateToYYYYMMDD, parseFirestoreTimestamp } from '@/utils/dateUtils.js'
import { escapeHtml } from '@/utils/sanitize.js'

const patientStore = usePatientStore()
const { allPatients } = storeToRefs(patientStore)
const { forceRefreshPatients, removeRuleFromMasterSchedule } = patientStore

const activeTab = ref('opd')
const currentSort = ref({ column: 'updatedAt', order: 'desc' })
const erListFilter = ref('')
const ipdListFilter = ref('')
const opdListFilter = ref('')
const deletedSearchTerm = ref('')
const globalSearchTerm = ref('')
const patientStats = ref({
  source: { er: 0, ipd: 0, opd: 0, deleted: 0 },
  mode: {},
  disease: {},
  freq: {},
  opdChanges: {
    lastMonth: { new: 0, transferOut: 0, death: 0, details: {} },
    thisMonth: { new: 0, transferOut: 0, death: 0, details: {} },
  },
})
const activePopover = ref(null)
const isModalVisible = ref(false)
const editingPatient = ref(null)
const modalType = ref('ipd')
const isDeleteDialogVisible = ref(false)
const patientToDeleteId = ref(null)
const isAlertDialogVisible = ref(false)
const alertDialogTitle = ref('')
const alertDialogMessage = ref('')
const isConfirmDialogVisible = ref(false)
const confirmDialogTitle = ref('')
const confirmDialogMessage = ref('')
const confirmAction = ref(null)
const isOrderModalVisible = ref(false)
const editingPatientForOrder = ref(null)
const isHistoryModalVisible = ref(false)
const selectedPatientForHistory = ref(null)
const newPatientDataForConflict = ref(null)
const existingPatientForConflict = ref(null)
const isRestoreDialogVisible = ref(false)
const patientToRestoreId = ref(null)
const isWardDialogVisible = ref(false)
const currentWardNumber = ref('')
const editingPatientForWardNumber = ref(null)

// ✨ 新增：預約變更對話框相關狀態
const isSchedulerDialogVisible = ref(false)
const schedulerPatient = ref(null)
const schedulerChangeType = ref('')

// ✨ 新增：當日排程衝突確認相關狀態
const isScheduleConflictDialogVisible = ref(false)
const scheduleConflictTitle = ref('')
const scheduleConflictMessage = ref('')
const pendingOperationType = ref('') // 'delete' 或 'transfer'
const pendingPatientId = ref(null)
const pendingNewStatus = ref(null) // 用於轉移操作

const { createGlobalNotification } = useGlobalNotifier()
const auth = useAuth()
const { isLoggedIn } = auth
const isPageLocked = computed(() => auth.isReadOnly.value)
// ✨✨✨ [新增] 專門給刪除按鈕用的鎖定狀態 ✨✨✨
// 如果是唯讀(Viewer) 或者 角色是 contributor，都鎖起來
const isDeleteLocked = computed(() => {
  return isPageLocked.value || auth.currentUser.value?.role === 'contributor'
})
const FREQ_COLOR_MAP = {
  一三五: 'freq-blue',
  二四六: 'freq-green',
  一四: 'freq-orange',
  二五: 'freq-orange',
  三六: 'freq-orange',
  一五: 'freq-orange',
  二六: 'freq-orange',
  每日: 'freq-purple',
  每周一: 'freq-teal',
  每周二: 'freq-teal',
  每周三: 'freq-teal',
  每周四: 'freq-teal',
  每周五: 'freq-teal',
  每周六: 'freq-teal',
  臨時: 'freq-red',
  未設定: 'freq-grey',
}
const DELETE_REASONS = [
  { value: '死亡', text: '死亡' },
  { value: '轉外院透析', text: '轉外院透析' },
  { value: '轉PD', text: '轉PD' },
  { value: '腎臟移植', text: '腎臟移植' },
  { value: '轉安寧', text: '轉安寧' },
  { value: '腎功能恢復不須透析', text: '腎功能恢復不須透析' },
  { value: '出院', text: '出院' },
  { value: '結束治療', text: '結束治療' },
]
const RESTORE_OPTIONS = [
  { value: 'opd', text: '復原至 門診' },
  { value: 'ipd', text: '復原至 住院' },
  { value: 'er', text: '復原至 急診' },
]

function normalizeDateObject(dateInput) {
  if (!dateInput) return null
  if (typeof dateInput.toDate === 'function') return dateInput.toDate()
  const date = new Date(dateInput)
  return isNaN(date.getTime()) ? null : date
}

const displayedPatients = computed(() => {
  let patientsToDisplay
  let searchTerm = ''
  if (!allPatients.value) return []

  if (activeTab.value === 'er') {
    patientsToDisplay = allPatients.value.filter((p) => p.status === 'er' && !p.isDeleted)
    searchTerm = erListFilter.value.toLowerCase()
  } else if (activeTab.value === 'ipd') {
    patientsToDisplay = allPatients.value.filter((p) => p.status === 'ipd' && !p.isDeleted)
    searchTerm = ipdListFilter.value.toLowerCase()
  } else if (activeTab.value === 'opd') {
    patientsToDisplay = allPatients.value.filter((p) => p.status === 'opd' && !p.isDeleted)
    searchTerm = opdListFilter.value.toLowerCase()
  } else if (activeTab.value === 'deleted') {
    patientsToDisplay = allPatients.value.filter((p) => p.isDeleted)
    searchTerm = deletedSearchTerm.value.toLowerCase()
  } else {
    patientsToDisplay = []
  }

  if (searchTerm) {
    patientsToDisplay = patientsToDisplay.filter(
      (p) =>
        (p.name && p.name.toLowerCase().includes(searchTerm)) ||
        (p.medicalRecordNumber && p.medicalRecordNumber.includes(searchTerm)),
    )
  }

  return [...patientsToDisplay].sort((a, b) => {
    const sortColumn = currentSort.value.column
    let valA = a[sortColumn]
    let valB = b[sortColumn]

    if (sortColumn === 'patientStatus') {
      const statusA = a.patientStatus || {}
      const statusB = b.patientStatus || {}
      valA =
        (statusA.isFirstDialysis?.active ? '1' : '0') +
        (statusA.isPaused?.active ? '1' : '0') +
        (statusA.hasBloodDraw?.active ? '1' : '0')
      valB =
        (statusB.isFirstDialysis?.active ? '1' : '0') +
        (statusB.isPaused?.active ? '1' : '0') +
        (statusB.hasBloodDraw?.active ? '1' : '0')
    }

    const dateA = normalizeDateObject(valA)
    const dateB = normalizeDateObject(valB)

    let compareResult

    if (dateA && dateB) {
      compareResult = dateA.getTime() - dateB.getTime()
    } else {
      const strA = valA || ''
      const strB = valB || ''
      compareResult = String(strA).localeCompare(String(strB), 'zh-Hant')
    }

    return currentSort.value.order === 'asc' ? compareResult : -compareResult
  })
})

const sortedFreqStats = computed(() => {
  if (!patientStats.value.freq) return []
  const FREQ_SORT_ORDER = {
    一三五: 1,
    二四六: 2,
    一四: 11,
    二五: 12,
    三六: 13,
    一五: 14,
    二六: 15,
    每周一: 21,
    每周二: 22,
    每周三: 23,
    每周四: 24,
    每周五: 25,
    每周六: 26,
    每日: 31,
    臨時: 99,
  }
  return Object.entries(patientStats.value.freq).sort((a, b) => {
    const orderA = FREQ_SORT_ORDER[a[0]] || 100
    const orderB = FREQ_SORT_ORDER[b[0]] || 100
    return orderA - orderB
  })
})

async function fetchPatientHistoryForStats() {
  try {
    // 使用本地 API 獲取病人歷史
    return await patientsApi.fetchHistory()
  } catch (error) {
    console.error('讀取病人歷史紀錄失敗:', error)
    showAlert('讀取失敗', '讀取病人歷史統計資料失敗！')
    return []
  }
}

const calculateStats = (allPatientsWithDeleted, patientHistory) => {
  const toUTCDateString = (dateInput) => {
    const date = normalizeDateObject(dateInput)
    if (!date) return ''
    return date.toISOString().split('T')[0]
  }
  const transferOutReasons = ['轉外院透析', '轉PD', '腎臟移植', '轉安寧', '腎功能恢復不須透析']
  const opdChangesDetailsTemplate = {}
  transferOutReasons.forEach((r) => {
    opdChangesDetailsTemplate[r] = 0
  })
  const statsResult = {
    source: { er: 0, ipd: 0, opd: 0, deleted: 0 },
    mode: { HD: 0, SLED: 0, CVVHDF: 0, PP: 0, DFPP: 0, Lipid: 0 },
    disease: { HBV: 0, HCV: 0, HIV: 0, RPR: 0, COVID: 0, 隔離: 0 },
    freq: {},
    opdChanges: {
      lastMonth: { new: 0, transferOut: 0, death: 0, details: { ...opdChangesDetailsTemplate } },
      thisMonth: { new: 0, transferOut: 0, death: 0, details: { ...opdChangesDetailsTemplate } },
    },
  }
  const today = new Date()
  const currentYear = today.getUTCFullYear()
  const currentMonth = today.getUTCMonth()
  const firstDayThisMonthStr = new Date(Date.UTC(currentYear, currentMonth, 1))
    .toISOString()
    .split('T')[0]
  const firstDayLastMonthStr = new Date(Date.UTC(currentYear, currentMonth - 1, 1))
    .toISOString()
    .split('T')[0]
  const lastDayLastMonthStr = new Date(Date.UTC(currentYear, currentMonth, 0))
    .toISOString()
    .split('T')[0]
  const todayStr = toUTCDateString(today)
  allPatientsWithDeleted.forEach((p) => {
    if (p.isDeleted) {
      statsResult.source.deleted++
    } else if (p.status) {
      if (!statsResult.source[p.status]) statsResult.source[p.status] = 0
      statsResult.source[p.status]++
    }
    if (!p.isDeleted) {
      if (p.mode && statsResult.mode.hasOwnProperty(p.mode)) statsResult.mode[p.mode]++
      if (p.diseases)
        p.diseases.forEach((d) => {
          if (statsResult.disease.hasOwnProperty(d)) statsResult.disease[d]++
        })
      if (p.freq) {
        if (!statsResult.freq[p.freq]) statsResult.freq[p.freq] = 0
        statsResult.freq[p.freq]++
      }
    }
    if (p.isDeleted && p.originalStatus === 'opd') {
      const deletedAtStr = toUTCDateString(p.deletedAt)
      if (deletedAtStr) {
        const period =
          deletedAtStr >= firstDayLastMonthStr && deletedAtStr <= lastDayLastMonthStr
            ? 'lastMonth'
            : deletedAtStr >= firstDayThisMonthStr && deletedAtStr <= todayStr
              ? 'thisMonth'
              : null
        if (period) {
          if (p.deleteReason === '死亡') {
            statsResult.opdChanges[period].death++
          } else if (transferOutReasons.includes(p.deleteReason)) {
            statsResult.opdChanges[period].transferOut++
            if (statsResult.opdChanges[period].details.hasOwnProperty(p.deleteReason)) {
              statsResult.opdChanges[period].details[p.deleteReason]++
            }
          }
        }
      }
    }
  })
  patientHistory.forEach((history) => {
    const eventTimeStr = toUTCDateString(history.timestamp)
    if (eventTimeStr) {
      const period =
        eventTimeStr >= firstDayLastMonthStr && eventTimeStr <= lastDayLastMonthStr
          ? 'lastMonth'
          : eventTimeStr >= firstDayThisMonthStr && eventTimeStr <= todayStr
            ? 'thisMonth'
            : null
      if (period) {
        if (
          (history.eventType === 'CREATE' && history.eventDetails?.status === 'opd') ||
          (history.eventType === 'TRANSFER' && history.eventDetails?.to === 'opd') ||
          (history.eventType === 'RESTORE_AND_TRANSFER' &&
            history.eventDetails?.restoredTo === 'opd')
        ) {
          statsResult.opdChanges[period].new++
        }
      }
    }
  })
  patientStats.value = statsResult
}

async function refreshAllData() {
  const [allPatientsWithDeleted, patientHistoryForStats] = await Promise.all([
    forceRefreshPatients(),
    fetchPatientHistoryForStats(),
  ])
  calculateStats(allPatientsWithDeleted, patientHistoryForStats)
}

const togglePopover = (popoverName) => {
  activePopover.value = activePopover.value === popoverName ? null : popoverName
}
const closePopovers = (event) => {
  if (event && event.target.closest('.stats-popover-wrapper')) return
  activePopover.value = null
}
function showAlert(title, message) {
  alertDialogTitle.value = title
  alertDialogMessage.value = message
  isAlertDialogVisible.value = true
}
function showConfirm(title, message, onConfirm) {
  confirmDialogTitle.value = title
  confirmDialogMessage.value = message
  confirmAction.value = onConfirm
  isConfirmDialogVisible.value = true
}

// ✨ 檢查病人是否在當日排程中
async function checkPatientInTodaySchedule(patientId) {
  try {
    const today = new Date()
    const dateStr = today.toISOString().split('T')[0]
    const record = await localSchedulesApi.fetchByDate(dateStr)

    if (!record?.schedule) return false

    const schedule = record.schedule || {}
    // 遍歷排程，檢查是否有這個病人
    for (const slotData of Object.values(schedule)) {
      if (slotData && slotData.patientId === patientId) {
        return true
      }
    }
    return false
  } catch (error) {
    console.error('檢查當日排程失敗:', error)
    return false // 發生錯誤時，默認允許操作
  }
}

// ✨ 新增：顯示排程衝突確認對話框
function showScheduleConflictDialog(title, message, operationType, patientId, newStatus = null) {
  scheduleConflictTitle.value = title
  scheduleConflictMessage.value = message
  pendingOperationType.value = operationType
  pendingPatientId.value = patientId
  pendingNewStatus.value = newStatus
  isScheduleConflictDialogVisible.value = true
}

// ✨ 新增：處理排程衝突確認 - 用戶選擇「是，繼續操作」
async function handleScheduleConflictConfirm() {
  isScheduleConflictDialogVisible.value = false

  if (pendingOperationType.value === 'delete') {
    // 繼續原本的刪除流程
    patientToDeleteId.value = pendingPatientId.value
    isDeleteDialogVisible.value = true
  } else if (pendingOperationType.value === 'transfer') {
    // 繼續原本的轉移流程
    await executeTransferPatient(pendingPatientId.value, pendingNewStatus.value)
  }

  // 清理狀態
  pendingOperationType.value = ''
  pendingPatientId.value = null
  pendingNewStatus.value = null
}

// ✨ 新增：處理排程衝突確認 - 用戶選擇「否，使用預約變更」
function handleScheduleConflictCancel() {
  isScheduleConflictDialogVisible.value = false

  const patient = allPatients.value.find((p) => p.id === pendingPatientId.value)
  if (!patient) return

  // 根據操作類型設定預約變更的類型
  if (pendingOperationType.value === 'delete') {
    schedulerChangeType.value = 'DELETE_PATIENT'
  } else if (pendingOperationType.value === 'transfer') {
    schedulerChangeType.value = 'UPDATE_STATUS'
  }

  schedulerPatient.value = patient
  isSchedulerDialogVisible.value = true

  // 清理狀態
  pendingOperationType.value = ''
  pendingPatientId.value = null
  pendingNewStatus.value = null
}

// ✨ 處理預約變更對話框的提交
async function handleSchedulerSubmit(dataToSubmit) {
  try {
    await systemApi.createScheduledUpdate(dataToSubmit)
    isSchedulerDialogVisible.value = false
    schedulerPatient.value = null
    schedulerChangeType.value = ''

    const changeTypeText = {
      DELETE_PATIENT: '刪除病人',
      UPDATE_STATUS: '身分變更',
      UPDATE_MODE: '透析模式變更',
      UPDATE_FREQ: '頻率變更',
    }[dataToSubmit.changeType] || '變更'

    createGlobalNotification(
      `預約${changeTypeText}：${dataToSubmit.patientName} (${dataToSubmit.effectiveDate} 生效)`,
      'schedule',
    )
    showAlert(
      '預約成功',
      `已成功建立預約${changeTypeText}。\n\n病人：${dataToSubmit.patientName}\n生效日期：${dataToSubmit.effectiveDate}`,
    )
  } catch (error) {
    console.error('保存預約變更失敗:', error)
    showAlert('操作失敗', `保存預約變更失敗：${error.message}`)
  }
}

async function handleGlobalSearch(query) {
  if (!query || !query.trim()) {
    showAlert('提示', '請輸入病人姓名或病歷號進行搜尋。')
    return
  }
  const searchTerm = query.trim()
  const searchTermLower = searchTerm.toLowerCase()
  const searchResults = allPatients.value.filter(
    (p) =>
      (p.medicalRecordNumber && p.medicalRecordNumber.includes(searchTerm)) ||
      (p.name && p.name.toLowerCase().includes(searchTermLower)),
  )
  if (searchResults.length > 1) {
    showAlert('找到多位病人', `符合 "${query}" 的病人不只一位，請用更完整的資料查找。`)
    return
  }
  const foundPatient = searchResults.length === 1 ? searchResults[0] : null
  const statusMap = { ipd: '住院', opd: '門診', er: '急診' }
  const targetStatusText = statusMap[activeTab.value] || '列表'
  if (foundPatient) {
    if (foundPatient.isDeleted) {
      const originalStatusText = statusMap[foundPatient.originalStatus] || '未知'
      showConfirm(
        '找到已刪除病人',
        `病人 "${foundPatient.name}" (${foundPatient.medicalRecordNumber}) 已被刪除 (原為${originalStatusText}，原因: ${foundPatient.deleteReason || '未知'})。\n\n是否要復原並移至「${targetStatusText}」清單？`,
        () => restorePatient(foundPatient.id),
      )
    } else if (foundPatient.status !== activeTab.value) {
      const currentStatusText = statusMap[foundPatient.status] || '未知'
      showConfirm(
        '找到病人 (不同表單)',
        `病人 "${foundPatient.name}" (${foundPatient.medicalRecordNumber}) 目前在「${currentStatusText}」清單中。\n\n是否要移至「${targetStatusText}」清單？`,
        () => transferPatient(foundPatient.id, activeTab.value),
      )
    } else {
      showAlert('病人已存在', `病人 "${foundPatient.name}" 已在「${targetStatusText}」清單中。`)
    }
  } else {
    const newPatientTemplate = { diseases: [] }
    if (/^\d{6,}$/.test(searchTerm)) {
      newPatientTemplate.medicalRecordNumber = searchTerm
    } else {
      newPatientTemplate.name = searchTerm
    }
    editingPatient.value = newPatientTemplate
    modalType.value = activeTab.value
    isModalVisible.value = true
  }
}

// ✨ 2. 新增一個可重用的輔助函式，專門用來建立自動化任務
async function createAutomatedTask(patientData, taskType, creatorInfo) {
  if (!patientData || !taskType || !creatorInfo) return

  let taskPayload

  if (taskType === '衛教') {
    const firstDialysisDate = patientData.patientStatus?.isFirstDialysis?.date
    taskPayload = {
      patientId: patientData.id,
      patientName: patientData.name,
      creator: creatorInfo,
      content: `首透衛教 (首透日期: ${firstDialysisDate || '未指定'})`,
      type: '衛教',
      category: 'message',
      status: 'pending',
      createdAt: new Date(),
      targetDate: null, // 衛教不關聯日期
    }
    console.log(`自動建立衛教任務 for ${patientData.name}`)
  } else if (taskType === '抽血') {
    const bloodDrawDate = patientData.patientStatus?.hasBloodDraw?.date
    if (bloodDrawDate) {
      taskPayload = {
        patientId: patientData.id,
        patientName: patientData.name,
        creator: creatorInfo,
        content: '抽血',
        type: '抽血',
        category: 'message',
        status: 'pending',
        createdAt: new Date(),
        targetDate: bloodDrawDate, // 抽血關聯日期
      }
      console.log(`自動建立抽血任務 for ${patientData.name} on ${bloodDrawDate}`)
    }
  }

  if (taskPayload) {
    return systemApi.createTask(taskPayload)
  }
  return Promise.resolve() // 如果沒有任務要建立，回傳一個 resolved promise
}

// ✨ 3. 重構 handleSavePatient 函式以整合新邏輯
async function handleSavePatient(patientData) {
  if (isPageLocked.value) {
    showAlert('操作失敗', '操作被鎖定：權限不足。')
    return
  }

  const creatorInfo = { uid: auth.currentUser.value.uid, name: auth.currentUser.value.name }

  // --- 編輯現有病人的邏輯 ---
  if (patientData.id) {
    const originalPatient = allPatients.value.find((p) => p.id === patientData.id)
    if (!originalPatient) {
      showAlert('錯誤', '找不到原始病人資料，無法更新。')
      return
    }

    const wasPaused = originalPatient.patientStatus?.isPaused?.active || false
    const isNowPaused = patientData.patientStatus?.isPaused?.active || false
    const wasFirstDialysis = originalPatient.patientStatus?.isFirstDialysis?.active || false
    const isNowFirstDialysis = patientData.patientStatus?.isFirstDialysis?.active || false
    const wasBloodDraw = originalPatient.patientStatus?.hasBloodDraw?.active || false
    const isNowBloodDraw = patientData.patientStatus?.hasBloodDraw?.active || false

    // (A) 處理「暫停/中止透析」
    if (!wasPaused && isNowPaused) {
      showConfirm(
        '確認暫停/中止透析',
        `您確定要將「${patientData.name}」標記為暫停/中止透析嗎？\n\n此操作將會從「總床位表」中移除该病人的固定排班规则。`,
        async () => {
          try {
            closeModal()
            const dataToUpdate = { ...patientData }
            delete dataToUpdate.id
            dataToUpdate.updatedAt = new Date().toISOString()
            await Promise.all([
              optimizedUpdatePatient(patientData.id, dataToUpdate),
              removeRuleFromMasterSchedule(patientData.id),
            ])
            await refreshAllData()
            window.dispatchEvent(new CustomEvent('patient-data-updated'))
            createGlobalNotification(`暫停/中止透析：${patientData.name}`, 'patient')
            showAlert(
              '操作成功',
              `已將 ${patientData.name} 標記為暫停/中止，並已從總表中移除其固定排班。`,
            )
          } catch (err) {
            showAlert('操作失敗', `操作失敗：${err.message}`)
          }
        },
      )
      return
    }

    // (B) 處理「一般編輯」
    try {
      const dataToUpdate = { ...patientData }
      delete dataToUpdate.id
      dataToUpdate.updatedAt = new Date().toISOString()

      const updatePromises = [optimizedUpdatePatient(patientData.id, dataToUpdate)]

      if (!wasFirstDialysis && isNowFirstDialysis) {
        updatePromises.push(createAutomatedTask(patientData, '衛教', creatorInfo))
      }
      if (!wasBloodDraw && isNowBloodDraw) {
        updatePromises.push(createAutomatedTask(patientData, '抽血', creatorInfo))
      }

      await Promise.all(updatePromises)

      await refreshAllData()
      window.dispatchEvent(new CustomEvent('patient-data-updated'))
      createGlobalNotification(`編輯病人：${patientData.name}`, 'patient')
      closeModal()
    } catch (err) {
      showAlert('操作失敗', '更新病人資料失敗！')
    }
    return
  }

  // --- 新增病人的邏輯 ---
  if (!patientData.medicalRecordNumber?.trim()) {
    showAlert('資料不完整', '請務必填寫病歷號。')
    return
  }

  const existingPatient = allPatients.value.find(
    (p) => p.medicalRecordNumber === patientData.medicalRecordNumber,
  )
  if (existingPatient) {
    const statusMap = { ipd: '住院', opd: '門診', er: '急診' }
    const currentStatusText = existingPatient.isDeleted
      ? `已刪除 (原為${statusMap[existingPatient.originalStatus] || '未知'})`
      : statusMap[existingPatient.status] || '未知'
    showConfirm(
      '病歷號重複',
      `病歷號 ${patientData.medicalRecordNumber} (${existingPatient.name}) 已存在於「${currentStatusText}」清單中。您是否要直接將其轉移並更新資料？`,
      () => handleConflictSelected(),
    )
    newPatientDataForConflict.value = patientData
    existingPatientForConflict.value = existingPatient
    return
  }

  try {
    const dataToCreate = {
      ...patientData,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isDeleted: false,
      status: modalType.value,
    }

    const savedPatient = await optimizedSavePatient(dataToCreate)

    const automatedTaskPromises = []
    if (savedPatient.patientStatus?.isFirstDialysis?.active) {
      automatedTaskPromises.push(createAutomatedTask(savedPatient, '衛教', creatorInfo))
    }
    if (savedPatient.patientStatus?.hasBloodDraw?.active) {
      automatedTaskPromises.push(createAutomatedTask(savedPatient, '抽血', creatorInfo))
    }

    if (automatedTaskPromises.length > 0) {
      await Promise.all(automatedTaskPromises)
    }

    await refreshAllData()
    const statusText = { ipd: '住院', opd: '門診', er: '急診' }[modalType.value] || '列表'
    createGlobalNotification(`新增病人：${dataToCreate.name} (${statusText})`, 'patient')
    closeModal()
  } catch (err) {
    showAlert('操作失敗', `新增病人失敗！${err.message}`)
  }
}

async function handleConflictSelected() {
  const existingPatient = existingPatientForConflict.value
  const newPatientData = newPatientDataForConflict.value
  if (!existingPatient || !newPatientData) return

  try {
    const dataToUpdate = {
      ...newPatientData,
      status: modalType.value,
      isDeleted: false,
      deletedAt: null,
      deleteReason: null,
      originalStatus: null,
    }
    delete dataToUpdate.id
    await optimizedUpdatePatient(existingPatient.id, dataToUpdate)
    await refreshAllData()

    window.dispatchEvent(new CustomEvent('patient-data-updated'))

    const statusText = { ipd: '住院', opd: '門診', er: '急診' }[modalType.value] || '列表'
    createGlobalNotification(`轉移病人：${newPatientData.name} 至 ${statusText}`, 'patient')
    showAlert('操作成功', `病人 ${newPatientData.name} 已成功更新並轉移至 ${statusText} 清單。`)
    closeModal()
  } catch (err) {
    showAlert('操作失敗', '轉移更新病人失敗！')
  } finally {
    existingPatientForConflict.value = null
    newPatientDataForConflict.value = null
  }
}

// ✨ 新增：實際執行轉移的函數（不再做排程檢查）
async function executeTransferPatient(patientId, newStatus) {
  const patient = allPatients.value.find((p) => p.id === patientId)
  if (!patient) return
  const targetStatusText = { ipd: '住院', opd: '門診', er: '急診' }[newStatus] || '未知'
  showConfirm(
    `確認轉為${targetStatusText}`,
    `您確定要將「${patient.name}」轉為${targetStatusText}嗎？`,
    async () => {
      try {
        const updateData = { status: newStatus }
        if ((patient.status === 'ipd' || patient.status === 'er') && newStatus === 'opd') {
          updateData.wardNumber = null
        }
        await optimizedUpdatePatient(patientId, updateData)
        await refreshAllData()
        window.dispatchEvent(new CustomEvent('patient-data-updated'))
        createGlobalNotification(`轉移病人：${patient.name} 至 ${targetStatusText}`, 'patient')
        showAlert('轉移成功', `${patient.name} 已成功轉至${targetStatusText}。`)
        globalSearchTerm.value = ''
      } catch (err) {
        showAlert('操作失敗', err.message || '轉床失敗！')
      }
    },
  )
}

// ✨ 修改：轉移身分前先檢查當日排程
async function transferPatient(patientId, newStatus) {
  if (isPageLocked.value) {
    showAlert('操作失敗', '操作被鎖定：權限不足。')
    return
  }
  const patient = allPatients.value.find((p) => p.id === patientId)
  if (!patient) return

  // 檢查病人是否在當日排程中
  const isInTodaySchedule = await checkPatientInTodaySchedule(patientId)

  if (isInTodaySchedule) {
    const targetStatusText = { ipd: '住院', opd: '門診', er: '急診' }[newStatus] || '未知'
    showScheduleConflictDialog(
      '當日排程中有此病人',
      `病人「${patient.name}」今天有排程透析。\n\n若直接轉移身分（至${targetStatusText}），當日排程不會自動更新。\n\n是否仍要繼續操作？\n選擇「否」可使用預約變更，於未來日期生效。`,
      'transfer',
      patientId,
      newStatus,
    )
  } else {
    // 沒有在當日排程中，直接執行轉移
    await executeTransferPatient(patientId, newStatus)
  }
}

// ✨✨✨ [修改] 確認刪除的邏輯檢查 ✨✨✨
async function handleDeleteReasonSelected(reason) {
  // 使用新的鎖定變數進行檢查
  if (isDeleteLocked.value) {
    showAlert('操作失敗', '權限不足：您的角色無法刪除病人資料。')
    return
  }
  const patientId = patientToDeleteId.value
  if (!patientId) return

  const patient = allPatients.value.find((p) => p.id === patientId)
  if (!patient) {
    showAlert('錯誤', '找不到該病人資料。')
    return
  }
  const patientNameForNotification = patient.name
  const statusMap = { opd: '門診', ipd: '住院', er: '急診' }
  const fromStatusText = statusMap[patient.status] || '目前列表'

  isDeleteDialogVisible.value = false
  patientToDeleteId.value = null

  try {
    await optimizedUpdatePatient(patientId, {
      isDeleted: true,
      originalStatus: patient.status,
      deleteReason: reason,
      deletedAt: new Date().toISOString(),
    })
    await removeRuleFromMasterSchedule(patientId)
    await refreshAllData()
    createGlobalNotification(`刪除病人：${patientNameForNotification} (${reason})`, 'patient')
    showAlert(
      '操作成功',
      `病人 "${patientNameForNotification}" 已從「${fromStatusText}」清單中刪除。\n系統將會同步更新並移除其未來的固定排程。`,
    )
  } catch (err) {
    showAlert('操作失敗', `刪除病人失敗。錯誤：${err.message}`)
  }
}

async function handleRestoreSelected(targetStatus) {
  isRestoreDialogVisible.value = false
  const patientId = patientToRestoreId.value
  if (!patientId || !targetStatus) return

  const patient = allPatients.value.find((p) => p.id === patientId)
  if (!patient) {
    showAlert('錯誤', '找不到該病人資料。')
    return
  }

  const statusMap = { opd: '門診', ipd: '住院', er: '急診' }
  const targetStatusText = statusMap[targetStatus] || '列表'

  try {
    const newPatientCategory = targetStatus === 'opd' ? 'opd_regular' : 'non_regular'

    await optimizedUpdatePatient(patientId, {
      isDeleted: false,
      status: targetStatus,
      deleteReason: null,
      deletedAt: null,
      originalStatus: null,
      patientCategory: newPatientCategory,
    })
    await refreshAllData()
    createGlobalNotification(`復原病人：${patient.name} 至 ${targetStatusText}`, 'patient')
    showAlert(
      '復原成功',
      `${patient.name} 已復原並移至「${targetStatusText}」清單。如需排班，請至總床位表設定。`,
    )
  } catch (err) {
    showAlert('操作失敗', '復原病人時發生錯誤！')
  } finally {
    patientToRestoreId.value = null
    globalSearchTerm.value = ''
  }
}

async function handleSaveOrder(orderData) {
  if (isPageLocked.value) {
    showAlert('操作失敗', '操作被鎖定：權限不足。')
    return
  }
  if (!editingPatientForOrder.value?.id) {
    showAlert('儲存失敗', '找不到有效的病人資訊。')
    return
  }

  const patientId = editingPatientForOrder.value.id
  const patientName = editingPatientForOrder.value.name

  try {
    await createDialysisOrderAndUpdatePatient(patientId, patientName, orderData)
    await refreshAllData()
    isOrderModalVisible.value = false
    createGlobalNotification(`更新醫囑：${patientName}`, 'patient')
    showAlert('儲存成功', `已成功更新 ${patientName} 的透析醫囑。`)
  } catch (error) {
    console.error('儲存醫囑失敗:', error)
    showAlert('操作失敗', `儲存醫囑時發生錯誤: ${error.message}`)
  }
}

function promptWardNumber(patient) {
  if (isPageLocked.value) return
  if (!patient || (patient.status !== 'ipd' && patient.status !== 'er')) {
    showAlert('提示', '只有住院或急診病人才能設定床號')
    return
  }
  editingPatientForWardNumber.value = patient
  currentWardNumber.value = patient.wardNumber || ''
  isWardDialogVisible.value = true
}

async function handleWardNumberConfirm(value) {
  const trimmedValue = value.trim()
  if (!editingPatientForWardNumber.value?.id) return
  const patientId = editingPatientForWardNumber.value.id
  const patientName = editingPatientForWardNumber.value.name
  try {
    await optimizedUpdatePatient(patientId, { wardNumber: trimmedValue })
    await refreshAllData()
    createGlobalNotification(`更新床號：${patientName} -> ${trimmedValue || '無'}`, 'patient')
  } catch (error) {
    showAlert('操作失敗', `更新床號失敗: ${error.message}`)
  } finally {
    isWardDialogVisible.value = false
    editingPatientForWardNumber.value = null
    currentWardNumber.value = ''
  }
}

function cancelDelete() {
  isDeleteDialogVisible.value = false
  patientToDeleteId.value = null
}
function openEditPatientModal(patient) {
  editingPatient.value = JSON.parse(JSON.stringify(patient))
  modalType.value = activeTab.value
  isModalVisible.value = true
}
function openHistoryModal(patientId) {
  selectedPatientForHistory.value = { id: patientId }
  isHistoryModalVisible.value = true
}
// ✨✨✨ [修改] 刪除前的邏輯檢查，加入當日排程檢查 ✨✨✨
async function deletePatient(patientId) {
  // 如果被鎖定，直接不反應
  if (isDeleteLocked.value) return

  const patient = allPatients.value.find((p) => p.id === patientId)
  if (!patient) return

  // 檢查病人是否在當日排程中
  const isInTodaySchedule = await checkPatientInTodaySchedule(patientId)

  if (isInTodaySchedule) {
    showScheduleConflictDialog(
      '當日排程中有此病人',
      `病人「${patient.name}」今天有排程透析。\n\n若直接刪除病人，當日排程不會自動更新。\n\n是否仍要繼續操作？\n選擇「否」可使用預約變更，於未來日期生效。`,
      'delete',
      patientId,
      null,
    )
  } else {
    // 沒有在當日排程中，直接顯示刪除原因選擇
    patientToDeleteId.value = patientId
    isDeleteDialogVisible.value = true
  }
}
function restorePatient(patientId) {
  if (isPageLocked.value) {
    showAlert('操作失敗', '操作被鎖定：權限不足。')
    return
  }
  patientToRestoreId.value = patientId
  isRestoreDialogVisible.value = true
}
function changeTab(tabName) {
  activeTab.value = tabName
  globalSearchTerm.value = ''
}
function handleSort(key) {
  if (currentSort.value.column === key) {
    currentSort.value.order = currentSort.value.order === 'asc' ? 'desc' : 'asc'
  } else {
    currentSort.value.column = key
    currentSort.value.order = 'asc'
  }
}
function closeModal() {
  isModalVisible.value = false
  editingPatient.value = null
  globalSearchTerm.value = ''
}
function formatDate(dateInput) {
  const date = normalizeDateObject(dateInput)
  if (!date) return ''
  return formatDateToYYYYMMDD(date)
}
function getRowClass(p) {
  if (p.patientStatus?.isPaused?.active) return 'status-discontinued'
  if (p.isDeleted) return 'status-deleted'
  const biweeklyFreq = ['一四', '二五', '三六', '一五', '二六']
  if (biweeklyFreq.includes(p.freq)) return 'status-biweekly'
  return `status-${p.status}`
}
function generateDiseaseTags(diseases) {
  if (!diseases?.length) return ''
  // ✨ XSS 防護：對疾病標籤內容進行轉義
  return diseases.map((tag) => `<span class="disease-tag">${escapeHtml(tag)}</span>`).join('')
}
function handleConfirm() {
  if (typeof confirmAction.value === 'function') confirmAction.value()
  isConfirmDialogVisible.value = false
  confirmAction.value = null
}
function handleCancel() {
  isConfirmDialogVisible.value = false
  confirmAction.value = null
}
function openOrderModal(patient) {
  editingPatientForOrder.value = JSON.parse(JSON.stringify(patient))
  isOrderModalVisible.value = true
}

function exportDeletedPatients() {
  const deletedPatients = allPatients.value.filter((p) => p.isDeleted)
  if (deletedPatients.length === 0) {
    alert('沒有已刪除的病人資料可供匯出。')
    return
  }
  const data = deletedPatients.map((p) => [
    p.name || '',
    p.medicalRecordNumber || '',
    { ipd: '住院', er: '急診', opd: '門診' }[p.originalStatus] || '未知',
    p.deleteReason || '',
    formatDate(p.deletedAt) || '',
    p.remarks || '',
  ])
  const ws = XLSX.utils.aoa_to_sheet([
    ['姓名', '病歷號', '原狀態', '刪除原因', '刪除日期', '備註'],
    ...data,
  ])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '已刪除病人')
  XLSX.writeFile(wb, `已刪除病人清單_${new Date().toISOString().slice(0, 10)}.xlsx`)
}

onMounted(() => {
  patientStore.fetchPatientsIfNeeded().then(() => {
    refreshAllData()
  })
  window.addEventListener('click', closePopovers)
})
onUnmounted(() => {
  window.removeEventListener('click', closePopovers)
})

watch(
  allPatients,
  (newPatients) => {
    fetchPatientHistoryForStats().then((patientHistoryForStats) => {
      calculateStats(newPatients, patientHistoryForStats)
    })
  },
  { deep: true },
)
</script>

<template>
  <div v-if="isLoggedIn">
    <link
      rel="stylesheet"
      href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css"
    />
    <div class="page-container" :class="{ 'is-locked': isPageLocked }">
      <div class="desktop-only">
        <h1 class="page-title">透析病人管理</h1>
        <div class="main-stats-bar">
          <div class="source-stats">
            <button
              class="stat-tag"
              :class="{ active: activeTab === 'er' }"
              @click="changeTab('er')"
            >
              急診 <span class="count">{{ patientStats.source.er }}</span></button
            ><button
              class="stat-tag"
              :class="{ active: activeTab === 'ipd' }"
              @click="changeTab('ipd')"
            >
              住院 <span class="count">{{ patientStats.source.ipd }}</span></button
            ><button
              class="stat-tag"
              :class="{ active: activeTab === 'opd' }"
              @click="changeTab('opd')"
            >
              門診 <span class="count">{{ patientStats.source.opd }}</span></button
            ><button
              class="stat-tag"
              :class="{ active: activeTab === 'deleted' }"
              @click="changeTab('deleted')"
            >
              已刪除 <span class="count">{{ patientStats.source.deleted }}</span>
            </button>
          </div>
          <div class="detailed-stats">
            <div class="stats-popover-wrapper">
              <button class="stat-popover-trigger" @click.stop="togglePopover('mode')">類型</button>
              <div v-if="activePopover === 'mode'" class="stats-popover">
                <div v-for="(count, key) in patientStats.mode" :key="key" class="popover-item">
                  <span>{{ key }}</span
                  ><span>{{ count }}</span>
                </div>
              </div>
            </div>
            <div class="stats-popover-wrapper">
              <button class="stat-popover-trigger" @click.stop="togglePopover('disease')">
                疾病
              </button>
              <div v-if="activePopover === 'disease'" class="stats-popover">
                <div v-for="(count, key) in patientStats.disease" :key="key" class="popover-item">
                  <span>{{ key }}</span
                  ><span>{{ count }}</span>
                </div>
              </div>
            </div>
            <div class="stats-popover-wrapper">
              <button class="stat-popover-trigger" @click.stop="togglePopover('freq')">頻率</button>
              <div v-if="activePopover === 'freq'" class="stats-popover">
                <div v-for="[key, count] in sortedFreqStats" :key="key" class="popover-item">
                  <span>{{ key }}</span>
                  <span>{{ count }}</span>
                </div>
              </div>
            </div>
            <div class="stats-popover-wrapper">
              <button class="stat-popover-trigger" @click.stop="togglePopover('opdChanges')">
                門診變動
              </button>
              <div v-if="activePopover === 'opdChanges'" class="stats-popover opd-changes-popover">
                <div class="popover-section-title">上個月</div>
                <div class="popover-item">
                  <span>新增</span><span>{{ patientStats.opdChanges.lastMonth.new }}</span>
                </div>
                <div class="popover-item">
                  <span>轉出</span><span>{{ patientStats.opdChanges.lastMonth.transferOut }}</span>
                </div>
                <div class="popover-sub-item">
                  <span>- 轉外院</span
                  ><span>{{ patientStats.opdChanges.lastMonth.details['轉外院透析'] || 0 }}</span>
                </div>
                <div class="popover-sub-item">
                  <span>- 轉 PD</span
                  ><span>{{ patientStats.opdChanges.lastMonth.details['轉PD'] || 0 }}</span>
                </div>
                <div class="popover-sub-item">
                  <span>- 腎移植</span
                  ><span>{{ patientStats.opdChanges.lastMonth.details['腎臟移植'] || 0 }}</span>
                </div>
                <div class="popover-sub-item">
                  <span>- 轉安寧</span
                  ><span>{{ patientStats.opdChanges.lastMonth.details['轉安寧'] || 0 }}</span>
                </div>
                <div class="popover-sub-item">
                  <span>- 腎功能恢復</span
                  ><span>{{
                    patientStats.opdChanges.lastMonth.details['腎功能恢復不須透析'] || 0
                  }}</span>
                </div>
                <div class="popover-item">
                  <span>死亡</span><span>{{ patientStats.opdChanges.lastMonth.death }}</span>
                </div>
                <hr class="popover-divider" />
                <div class="popover-section-title">本月至今</div>
                <div class="popover-item">
                  <span>新增</span><span>{{ patientStats.opdChanges.thisMonth.new }}</span>
                </div>
                <div class="popover-item">
                  <span>轉出</span><span>{{ patientStats.opdChanges.thisMonth.transferOut }}</span>
                </div>
                <div class="popover-sub-item">
                  <span>- 轉外院</span
                  ><span>{{ patientStats.opdChanges.thisMonth.details['轉外院透析'] || 0 }}</span>
                </div>
                <div class="popover-sub-item">
                  <span>- 轉 PD</span
                  ><span>{{ patientStats.opdChanges.thisMonth.details['轉PD'] || 0 }}</span>
                </div>
                <div class="popover-sub-item">
                  <span>- 腎移植</span
                  ><span>{{ patientStats.opdChanges.thisMonth.details['腎臟移植'] || 0 }}</span>
                </div>
                <div class="popover-sub-item">
                  <span>- 轉安寧</span
                  ><span>{{ patientStats.opdChanges.thisMonth.details['轉安寧'] || 0 }}</span>
                </div>
                <div class="popover-sub-item">
                  <span>- 腎功能恢復</span
                  ><span>{{
                    patientStats.opdChanges.thisMonth.details['腎功能恢復不須透析'] || 0
                  }}</span>
                </div>
                <div class="popover-item">
                  <span>死亡</span><span>{{ patientStats.opdChanges.thisMonth.death }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="mobile-header mobile-only">
        <h1 class="page-title">透析病人管理</h1>
        <div class="source-stats">
          <button class="stat-tag" :class="{ active: activeTab === 'er' }" @click="changeTab('er')">
            急診 <span class="count">{{ patientStats.source.er }}</span></button
          ><button
            class="stat-tag"
            :class="{ active: activeTab === 'ipd' }"
            @click="changeTab('ipd')"
          >
            住院 <span class="count">{{ patientStats.source.ipd }}</span></button
          ><button
            class="stat-tag"
            :class="{ active: activeTab === 'opd' }"
            @click="changeTab('opd')"
          >
            門診 <span class="count">{{ patientStats.source.opd }}</span></button
          ><button
            class="stat-tag"
            :class="{ active: activeTab === 'deleted' }"
            @click="changeTab('deleted')"
          >
            已刪除 <span class="count">{{ patientStats.source.deleted }}</span>
          </button>
        </div>
      </div>

      <div v-if="activeTab !== 'deleted'" class="tab-content active desktop-only">
        <div class="view-header">
          <div class="controls-left">
            <div class="search-group global-search">
              <input
                type="text"
                v-model="globalSearchTerm"
                @keydown.enter="handleGlobalSearch(globalSearchTerm)"
                placeholder="搜尋/新增/轉移病人..."
              /><button class="btn-search" @click="handleGlobalSearch(globalSearchTerm)">
                執行
              </button>
            </div>
            <div class="search-group list-filter">
              <input
                v-if="activeTab === 'er'"
                type="text"
                v-model="erListFilter"
                placeholder="篩選列表..."
              /><input
                v-if="activeTab === 'ipd'"
                type="text"
                v-model="ipdListFilter"
                placeholder="篩選列表..."
              /><input
                v-if="activeTab === 'opd'"
                type="text"
                v-model="opdListFilter"
                placeholder="篩選列表..."
              />
            </div>
          </div>
        </div>
        <div class="table-wrapper">
          <div class="flex-table-wrapper">
            <div class="flex-table-header">
              <div class="flex-cell col-name" @click="handleSort('name')">姓名</div>
              <div
                v-if="activeTab === 'ipd' || activeTab === 'er'"
                class="flex-cell col-ward-number"
                @click="handleSort('wardNumber')"
              >
                住院床號
              </div>
              <div class="flex-cell col-mrn" @click="handleSort('medicalRecordNumber')">病歷號</div>
              <div class="flex-cell col-physician" @click="handleSort('physician')">
                {{ activeTab === 'opd' ? '收案醫師' : '會診醫師' }}
              </div>
              <div class="flex-cell col-freq" @click="handleSort('freq')">頻率</div>
              <div class="flex-cell col-mode">模式</div>
              <div class="flex-cell col-status" @click="handleSort('patientStatus')">狀態</div>
              <div class="flex-cell col-hospital" @click="handleSort('hospitalInfo')">透析院所</div>
              <div class="flex-cell col-vasc-access">血管通路</div>
              <div class="flex-cell col-remarks">備註</div>
              <div class="flex-cell col-updated" @click="handleSort('updatedAt')">異動日期</div>
              <div class="flex-cell col-actions">操作</div>
            </div>
            <div class="flex-table-body">
              <div
                v-for="p in displayedPatients"
                :key="p.id"
                class="flex-table-row"
                :class="getRowClass(p)"
              >
                <div class="flex-cell col-name">
                  <div class="name-cell-content">
                    <span class="patient-name-text">{{ p.name }}</span>
                    <div
                      v-if="p.diseases && p.diseases.length"
                      class="disease-tags-container"
                      v-html="generateDiseaseTags(p.diseases)"
                    ></div>
                  </div>
                </div>
                <div
                  v-if="activeTab === 'ipd' || activeTab === 'er'"
                  class="flex-cell col-ward-number"
                >
                  <div
                    class="ward-number-cell"
                    @click="promptWardNumber(p)"
                    :class="{ 'is-editable': !isPageLocked }"
                  >
                    {{ p.wardNumber || '-' }}
                  </div>
                </div>
                <div class="flex-cell col-mrn">{{ p.medicalRecordNumber }}</div>
                <div class="flex-cell col-physician">{{ p.physician }}</div>
                <div class="flex-cell col-freq">{{ p.freq }}</div>
                <div class="flex-cell col-mode">{{ p.mode }}</div>
                <div class="flex-cell col-status">
                  <div class="status-icon-container">
                    <i
                      v-if="p.patientStatus?.isFirstDialysis?.active"
                      class="fas fa-star status-icon-first"
                      :title="`首透: ${p.patientStatus.isFirstDialysis.date || '無日期'}`"
                    ></i
                    ><i
                      v-if="p.patientStatus?.isPaused?.active"
                      class="fas fa-pause-circle status-icon-paused"
                      :title="`暫停透析: ${p.patientStatus.isPaused.date || '無日期'}`"
                    ></i
                    ><i
                      v-if="p.patientStatus?.hasBloodDraw?.active"
                      class="fas fa-vial status-icon-blood"
                      :title="`已抽血: ${p.patientStatus.hasBloodDraw.date || '無日期'}`"
                    ></i>
                  </div>
                </div>
                <div class="flex-cell col-hospital">
                  <div class="hospital-cell-content">
                    <span class="hospital-source">{{ p.hospitalInfo?.source }}</span>
                    <div
                      v-if="p.hospitalInfo?.source && p.hospitalInfo?.transferOut"
                      class="hospital-divider"
                    ></div>
                    <span class="hospital-transfer-out">{{ p.hospitalInfo?.transferOut }}</span>
                  </div>
                </div>
                <div class="flex-cell col-vasc-access">{{ p.vascAccess }}</div>
                <div class="flex-cell col-remarks">{{ p.remarks }}</div>
                <div class="flex-cell col-updated">{{ formatDate(p.updatedAt) }}</div>
                <div class="flex-cell col-actions">
                  <div class="action-buttons">
                    <button
                      class="btn-icon btn-edit"
                      @click="openEditPatientModal(p)"
                      :disabled="isPageLocked"
                      title="編輯"
                    >
                      <i class="fas fa-pencil-alt"></i></button
                    ><button
                      class="btn-icon btn-order"
                      @click="openOrderModal(p)"
                      :disabled="isPageLocked"
                      title="醫囑"
                    >
                      <i class="fas fa-notes-medical"></i></button
                    ><button
                      class="btn-icon btn-delete"
                      @click="deletePatient(p.id)"
                      :disabled="isDeleteLocked"
                      title="刪除"
                    >
                      <i class="fas fa-trash-alt"></i>
                    </button>
                    <div class="action-divider"></div>
                    <button
                      v-if="activeTab !== 'opd'"
                      class="btn btn-transfer"
                      @click="transferPatient(p.id, 'opd')"
                      :disabled="isPageLocked"
                    >
                      <i class="fas fa-clinic-medical"></i> 轉門診</button
                    ><button
                      v-if="activeTab !== 'ipd'"
                      class="btn btn-transfer"
                      @click="transferPatient(p.id, 'ipd')"
                      :disabled="isPageLocked"
                    >
                      <i class="fas fa-procedures"></i> 轉住院</button
                    ><button
                      v-if="activeTab !== 'er'"
                      class="btn btn-transfer"
                      @click="transferPatient(p.id, 'er')"
                      :disabled="isPageLocked"
                    >
                      <i class="fas fa-ambulance"></i> 轉急診
                    </button>
                    <div class="action-divider"></div>
                    <button
                      class="btn-icon btn-history"
                      @click="openHistoryModal(p.id)"
                      title="動向歷史"
                    >
                      <i class="fas fa-history"></i>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 已刪除列表：恢復為舊版簡單模式 -->
      <div v-else class="tab-content active desktop-only">
        <div class="toolbar">
          <div class="search-group">
            <input type="text" v-model="deletedSearchTerm" placeholder="搜尋已刪除病人..." />
          </div>
          <button @click="exportDeletedPatients" class="btn-export">轉出已刪除清單</button>
        </div>
        <div class="table-wrapper">
          <table class="patient-table">
            <thead>
              <tr>
                <th class="col-shrink" @click="handleSort('name')">姓名</th>
                <th class="col-shrink" @click="handleSort('medicalRecordNumber')">病歷號</th>
                <th class="col-shrink" @click="handleSort('originalStatus')">原狀態</th>
                <th class="col-shrink" @click="handleSort('deleteReason')">刪除原因</th>
                <th class="col-expand">備註</th>
                <th class="col-shrink" @click="handleSort('deletedAt')">刪除日期</th>
                <th class="col-shrink">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in displayedPatients" :key="p.id" :class="getRowClass(p)">
                <td class="col-shrink">{{ p.name }}</td>
                <td class="col-shrink">{{ p.medicalRecordNumber }}</td>
                <td class="col-shrink">
                  {{
                    p.originalStatus === 'ipd'
                      ? '住院'
                      : p.originalStatus === 'er'
                        ? '急診'
                        : '門診'
                  }}
                </td>
                <td class="col-shrink">{{ p.deleteReason }}</td>
                <td class="col-expand">{{ p.remarks }}</td>
                <td class="col-shrink">{{ formatDate(p.deletedAt) }}</td>
                <td class="col-actions action-buttons" style="justify-content: center">
                  <button
                    class="btn btn-restore"
                    @click="restorePatient(p.id)"
                    :disabled="isPageLocked"
                  >
                    復原
                  </button>
                  <!-- ✨ 新增的動向歷史按鈕 -->
                  <button
                    class="btn-icon btn-history"
                    @click="openHistoryModal(p.id)"
                    title="動向歷史"
                  >
                    <i class="fas fa-history"></i>
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="tab-content-mobile mobile-only">
        <div v-if="activeTab !== 'deleted'" class="cards-container">
          <div
            v-for="p in displayedPatients"
            :key="p.id"
            class="patient-card"
            :class="getRowClass(p)"
          >
            <div class="card-header">
              <div class="patient-name-section">
                <span class="patient-name-text">{{ p.name }}</span
                ><span class="freq-tag-card" :class="FREQ_COLOR_MAP[p.freq || '未設定']">{{
                  p.freq || '未設定'
                }}</span>
              </div>
              <div class="card-actions-header">
                <button
                  class="btn-icon btn-history"
                  @click="openHistoryModal(p.id)"
                  title="動向歷史"
                >
                  <i class="fas fa-history"></i></button
                ><button
                  class="btn-icon btn-delete"
                  @click="deletePatient(p.id)"
                  :disabled="isDeleteLocked"
                  title="刪除"
                >
                  <i class="fas fa-trash-alt"></i>
                </button>
              </div>
            </div>
            <div class="card-body">
              <div class="info-grid">
                <div v-if="activeTab === 'ipd' || activeTab === 'er'" class="info-item">
                  <span class="label">住院床號</span>
                  <span class="value" @click="promptWardNumber(p)">{{ p.wardNumber || '-' }}</span>
                </div>
                <div class="info-item">
                  <span class="label">病歷號</span
                  ><span class="value">{{ p.medicalRecordNumber }}</span>
                </div>
                <div class="info-item">
                  <span class="label">醫師</span><span class="value">{{ p.physician }}</span>
                </div>
                <div class="info-item">
                  <span class="label">模式</span><span class="value">{{ p.mode }}</span>
                </div>
                <div v-if="activeTab === 'opd'" class="info-item">
                  <span class="label">血管通路</span><span class="value">{{ p.vascAccess }}</span>
                </div>
                <div v-if="activeTab !== 'opd'" class="info-item">
                  <span class="label">首透</span
                  ><span class="value">{{
                    p.isFirstDialysis ? `✓ (${formatDate(p.firstDialysisDate)})` : '否'
                  }}</span>
                </div>
                <div class="info-item">
                  <span class="label">異動日期</span
                  ><span class="value">{{ formatDate(p.updatedAt) }}</span>
                </div>
              </div>
              <div class="info-grid" style="margin-top: 0.5rem">
                <div class="info-item">
                  <span class="label">透析院所</span
                  ><span class="value">{{
                    p.hospitalInfo?.source || p.hospitalInfo?.transferOut
                  }}</span>
                </div>
                <div class="info-item">
                  <span class="label">狀態</span>
                  <div class="status-icon-container">
                    <i
                      v-if="p.patientStatus?.isFirstDialysis?.active"
                      class="fas fa-star status-icon-first"
                      :title="`首透: ${p.patientStatus.isFirstDialysis.date || '無日期'}`"
                    ></i
                    ><i
                      v-if="p.patientStatus?.isPaused?.active"
                      class="fas fa-pause-circle status-icon-paused"
                      :title="`暫停透析: ${p.patientStatus.isPaused.date || '無日期'}`"
                    ></i
                    ><i
                      v-if="p.patientStatus?.hasBloodDraw?.active"
                      class="fas fa-vial status-icon-blood"
                      :title="`已抽血: ${p.patientStatus.hasBloodDraw.date || '無日期'}`"
                    ></i>
                  </div>
                </div>
              </div>
              <div v-if="p.remarks" class="remarks-section">
                <span class="label">備註:</span> {{ p.remarks }}
              </div>
              <div
                v-if="p.diseases && p.diseases.length"
                class="disease-tags-container"
                v-html="generateDiseaseTags(p.diseases)"
              ></div>
            </div>
            <div class="card-footer">
              <button
                class="btn btn-edit"
                @click="openEditPatientModal(p)"
                :disabled="isPageLocked"
              >
                <i class="fas fa-pencil-alt"></i> 編輯</button
              ><button class="btn btn-order" @click="openOrderModal(p)" :disabled="isPageLocked">
                <i class="fas fa-notes-medical"></i> 醫囑</button
              ><button
                v-if="activeTab !== 'ipd'"
                class="btn btn-transfer"
                @click="transferPatient(p.id, 'ipd')"
                :disabled="isPageLocked"
              >
                <i class="fas fa-procedures"></i> 轉住院</button
              ><button
                v-if="activeTab !== 'opd'"
                class="btn btn-transfer"
                @click="transferPatient(p.id, 'opd')"
                :disabled="isPageLocked"
              >
                <i class="fas fa-clinic-medical"></i> 轉門診</button
              ><button
                v-if="activeTab !== 'er'"
                class="btn btn-transfer"
                @click="transferPatient(p.id, 'er')"
                :disabled="isPageLocked"
              >
                <i class="fas fa-ambulance"></i> 轉急診
              </button>
            </div>
          </div>
        </div>
        <!-- 行動版的已刪除列表 (可根據需求實現) -->
        <div v-else>
          <!-- 您可以在此處添加行動版的已刪除病人卡片列表 -->
        </div>
      </div>
      <div class="fixed-bottom-bar mobile-only">
        <div class="search-group global-search">
          <input
            type="text"
            v-model="globalSearchTerm"
            @keydown.enter="handleGlobalSearch(globalSearchTerm)"
            placeholder="搜尋/新增/轉移病人..."
          /><button class="btn-search" @click="handleGlobalSearch(globalSearchTerm)">執行</button>
        </div>
      </div>
    </div>
    <PatientFormModal
      :is-modal-visible="isModalVisible"
      :patient-data="editingPatient"
      :patient-type="modalType"
      @close="closeModal"
      @save="handleSavePatient"
    /><SelectionDialog
      :is-visible="isDeleteDialogVisible"
      title="請選擇刪除原因"
      :options="DELETE_REASONS"
      @select="handleDeleteReasonSelected"
      @cancel="cancelDelete"
    /><AlertDialog
      :is-visible="isAlertDialogVisible"
      :title="alertDialogTitle"
      :message="alertDialogMessage"
      @confirm="isAlertDialogVisible = false"
    /><ConfirmDialog
      :is-visible="isConfirmDialogVisible"
      :title="confirmDialogTitle"
      :message="confirmDialogMessage"
      @confirm="handleConfirm"
      @cancel="handleCancel"
    /><DialysisOrderModal
      :is-visible="isOrderModalVisible"
      :patient-data="editingPatientForOrder"
      @close="isOrderModalVisible = false"
      @save="handleSaveOrder"
    /><PatientHistoryModal
      :is-visible="isHistoryModalVisible"
      :patient-id="selectedPatientForHistory?.id"
      :patient-name="selectedPatientForHistory?.name"
      @close="isHistoryModalVisible = false"
    /><SelectionDialog
      :is-visible="isRestoreDialogVisible"
      title="請選擇復原位置"
      :options="RESTORE_OPTIONS"
      @select="handleRestoreSelected"
      @cancel="isRestoreDialogVisible = false"
    />
    <WardNumberDialog
      :is-visible="isWardDialogVisible"
      :current-value="currentWardNumber"
      @confirm="handleWardNumberConfirm"
      @cancel="isWardDialogVisible = false"
    />

    <!-- ✨ 新增：當日排程衝突確認對話框 -->
    <ConfirmDialog
      :is-visible="isScheduleConflictDialogVisible"
      :title="scheduleConflictTitle"
      :message="scheduleConflictMessage"
      confirm-text="是，繼續操作"
      cancel-text="否，使用預約變更"
      @confirm="handleScheduleConflictConfirm"
      @cancel="handleScheduleConflictCancel"
    />

    <!-- ✨ 新增：預約變更對話框 -->
    <PatientUpdateSchedulerDialog
      :is-visible="isSchedulerDialogVisible"
      :patient="schedulerPatient"
      :change-type="schedulerChangeType"
      :all-patients="allPatients"
      @close="isSchedulerDialogVisible = false"
      @submit="handleSchedulerSubmit"
    />
  </div>
</template>

<style scoped>
:root {
  --primary-color: #005a9c;
  --success-color: #16a34a;
  --danger-color: #dc3545;
  --warning-color: #f97316;
  --info-color: #0ea5e9;
  --green-bg: #f0fdf4;
  --blue-bg: #eff6ff;
  --purple-bg: #e9d5ff;
  --orange-bg: #fff7ed;
  --red-bg: #fef2f2;
  --grey-bg: #f8f9fa;
  --grey-text: #6c757d;
}

.page-container {
  height: 100%;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  background-color: #fff;
  padding: 0.5rem;
}

.page-title,
.main-stats-bar,
.view-header,
.toolbar {
  flex-shrink: 0;
}

.tab-content {
  flex-grow: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.table-wrapper {
  flex-grow: 1;
  min-height: 0;
  overflow-y: auto;
}

.page-title {
  margin-bottom: 1rem;
  color: #333;
  font-weight: bold;
}
.main-stats-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
  flex-wrap: wrap;
  gap: 1rem;
  padding-bottom: 1rem;
  border-bottom: 2px solid #dee2e6;
}
.source-stats {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}
.stat-tag {
  background-color: transparent;
  border: none;
  padding: 8px 16px;
  font-size: 1.1rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  border-bottom: 3px solid transparent;
  border-radius: 4px 4px 0 0;
  color: #495057;
}
.stat-tag .count {
  font-weight: bold;
  color: #e67700;
  margin-left: 8px;
  background-color: #f1f3f5;
  padding: 2px 6px;
  border-radius: 8px;
}
.stat-tag:hover {
  background-color: #f8f9fa;
}
.stat-tag.active {
  color: var(--primary-color);
  border-bottom-color: var(--primary-color);
}
.stat-tag.active .count {
  background-color: var(--primary-color);
  color: white;
}
.detailed-stats {
  display: flex;
  gap: 0.5rem;
}
.stats-popover-wrapper {
  position: relative;
}
.stat-popover-trigger {
  background-color: #f8f9fa;
  border: 1px solid #dee2e6;
  border-radius: 6px;
  padding: 8px 16px;
  cursor: pointer;
}
.stats-popover {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 5px;
  background-color: white;
  border: 1px solid #ddd;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  width: 220px;
  z-index: 10;
  padding: 0.75rem;
}
.popover-item {
  display: flex;
  justify-content: space-between;
  padding: 0.5rem 0;
  border-bottom: 1px solid #f1f3f5;
}
.popover-item:last-child {
  border-bottom: none;
}
.popover-sub-item {
  display: flex;
  justify-content: space-between;
  padding: 0.2rem 0 0.2rem 1.5rem;
  font-size: 0.85em;
  color: #6c757d;
}
.opd-changes-popover {
  width: 250px;
}
.popover-section-title {
  font-weight: bold;
  color: #333;
  margin-top: 0.5rem;
  margin-bottom: 0.25rem;
  font-size: 0.9em;
  padding-bottom: 0.25rem;
  border-bottom: 1px solid #eee;
}
.opd-changes-popover .popover-item {
  padding: 0.25rem 0.5rem;
}
.popover-divider {
  border: none;
  border-top: 1px solid #e9ecef;
  margin: 0.5rem 0;
}
.view-header {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
  margin-bottom: 15px;
}
.controls-left {
  display: flex;
  align-items: center;
  gap: 15px;
  flex-wrap: wrap;
}
.controls-left .search-group {
  display: flex;
  align-items: center;
}
.controls-left input {
  padding: 8px;
  border: 1px solid #ccc;
  border-radius: 5px;
  height: 40px;
  font-size: 1rem;
}
.search-group.global-search input {
  min-width: 280px;
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
  border-right: none;
}
.search-group.global-search .btn-search {
  padding: 8px 15px;
  font-size: 1em;
  background-color: #17a2b8;
  color: white;
  border: 1px solid #17a2b8;
  border-radius: 5px;
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
  cursor: pointer;
  height: 40px;
  transition: background-color 0.2s;
}
.search-group.global-search .btn-search:hover:not(:disabled) {
  background-color: #138496;
}
.search-group.list-filter input {
  min-width: 200px;
  background-color: #f8f9fa;
}

.flex-table-wrapper {
  border: 1px solid #ddd;
  border-radius: 4px;
  overflow: hidden;
}
.flex-table-header,
.flex-table-row {
  display: flex;
  border-bottom: 1px solid #ddd;
}
.flex-table-body .flex-table-row:last-child {
  border-bottom: none;
}
.flex-table-header {
  background-color: #f2f2f2;
  font-weight: bold;
  position: sticky;
  top: 0;
  z-index: 2;
}
.flex-cell {
  padding: 10px 12px;
  display: flex;
  align-items: center;
  overflow: hidden;
  white-space: nowrap;
  border-right: 1px solid #ddd;
}
.flex-table-header .flex-cell:last-child,
.flex-table-row .flex-cell:last-child {
  border-right: none;
}
.col-name {
  flex: 0 0 140px;
}
.col-ward-number {
  flex: 0 0 100px;
}
.col-mrn {
  flex: 0 0 90px;
}
.col-physician {
  flex: 0 0 90px;
}
.col-freq {
  flex: 0 0 90px;
}
.col-mode {
  flex: 0 0 80px;
}
.col-status {
  flex: 0 0 100px;
}
.col-hospital {
  flex: 0 0 160px;
}
.col-vasc-access {
  flex: 0 0 110px;
}
.col-remarks {
  flex: 1 1 auto;
  white-space: normal;
  word-break: break-all;
}
.col-updated {
  flex: 0 0 110px;
}
.col-actions {
  flex: 0 0 420px;
  justify-content: flex-start;
}
.flex-table-header .flex-cell {
  cursor: pointer;
  user-select: none;
}
.name-cell-content {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: nowrap;
}
.patient-name-text {
  font-weight: bold;
}
.disease-tags-container {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
:deep(.disease-tag) {
  display: inline-block;
  padding: 2px 6px;
  font-size: 0.8em;
  font-weight: bold;
  color: var(--danger-color);
  border: 1px solid var(--danger-color);
  border-radius: 4px;
}
.status-icon-container {
  display: flex;
  gap: 12px;
  align-items: center;
  font-size: 1.2rem;
}
.status-icon-first {
  color: #f97316;
}
.status-icon-paused {
  color: #6b7280;
}
.status-icon-blood {
  color: #3b82f6;
}
.action-buttons {
  display: flex;
  flex-wrap: nowrap;
  gap: 0.5rem;
  align-items: center;
  width: 100%;
}
.btn {
  padding: 5px 10px;
  font-size: 0.9em;
  border-radius: 6px;
  border: 1px solid transparent;
  cursor: pointer;
  color: white;
  white-space: nowrap;
  transition: background-color 0.2s;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5em;
}
.btn.btn-edit {
  background-color: #007bff;
  border-color: #007bff;
}
.btn.btn-order {
  background-color: #ffc107;
  color: #212529;
  border-color: #ffc107;
}
.btn.btn-transfer {
  background-color: #17a2b8;
  border-color: #17a2b8;
}
.btn.btn-edit:hover:not(:disabled) {
  background-color: #0069d9;
}
.btn.btn-order:hover:not(:disabled) {
  background-color: #e0a800;
}
.btn.btn-transfer:hover:not(:disabled) {
  background-color: #138496;
}
.btn:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}
.btn-icon {
  background: none;
  border: none;
  cursor: pointer;
  padding: 6px;
  border-radius: 50%;
  font-size: 1rem;
  line-height: 1;
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s;
}
.btn-icon:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn-icon.btn-edit {
  color: #007bff;
}
.btn-icon.btn-order {
  color: #fd7e14;
}
.btn-icon.btn-transfer {
  color: #17a2b8;
}
.btn-icon.btn-history {
  color: #6c757d;
}
.btn-icon.btn-delete {
  color: #dc3545;
}
.btn-icon.btn-edit:hover:not(:disabled) {
  background-color: #e7f1ff;
}
.btn-icon.btn-order:hover:not(:disabled) {
  background-color: #fff3e0;
}
.btn-icon.btn-transfer:hover:not(:disabled) {
  background-color: #e2f7fa;
}
.btn-icon.btn-history:hover:not(:disabled) {
  background-color: #f1f3f5;
}
.btn-icon.btn-delete:hover:not(:disabled) {
  background-color: #fee2e2;
}
.action-divider {
  width: 1px;
  height: 24px;
  background-color: #dee2e6;
  margin: 0 0.25rem;
}
.flex-table-row.status-opd {
  background-color: var(--green-bg);
}
.flex-table-row.status-ipd {
  background-color: var(--red-bg);
}
.flex-table-row.status-er {
  background-color: #f3e8ff;
}
.flex-table-row.status-biweekly {
  background-color: var(--orange-bg);
}
.flex-table-row.status-deleted {
  background-color: var(--grey-bg);
  color: var(--grey-text);
}
.flex-table-row.status-discontinued {
  background-color: #fee2e2;
  color: #7f1d1d;
  text-decoration: line-through;
  opacity: 0.7;
}
.flex-table-row.status-discontinued button {
  text-decoration: none;
}
.toolbar {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  margin-bottom: 15px;
  flex-wrap: wrap;
  gap: 15px;
}
.toolbar button {
  padding: 8px 15px;
  font-size: 1em;
  color: white;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  transition: background-color 0.2s;
}
.toolbar .search-group {
  display: flex;
  gap: 5px;
}
.toolbar input {
  padding: 8px;
  border: 1px solid #ccc;
  border-radius: 5px;
  min-width: 250px;
  height: 40px;
}
.toolbar .btn-export {
  background-color: var(--info-color);
}
.toolbar .btn-export:hover {
  background-color: #0284c7;
}
.patient-table {
  width: 100%;
  border-collapse: collapse;
}
.patient-table th,
.patient-table td {
  border: 1px solid #ddd;
  padding: 10px 12px;
  text-align: left;
  vertical-align: middle;
}
.patient-table th {
  background-color: #f2f2f2;
  font-weight: 600;
  cursor: pointer;
}
.hospital-cell-content {
  display: flex;
  align-items: center;
  gap: 0.5em;
  width: 100%;
}
.hospital-source {
  color: #6c757d;
  text-align: right;
  flex: 1;
}
.hospital-transfer-out {
  color: #17a2b8;
  font-weight: 500;
  flex: 1;
}
.hospital-divider {
  width: 1px;
  height: 1.5em;
  background-color: #ced4da;
}
.btn-restore {
  background-color: var(--success-color);
  border-color: var(--success-color);
  color: white;
}
.btn-restore:hover:not(:disabled) {
  background-color: #15803d;
}
.mobile-only {
  display: none;
}
.desktop-only {
  display: block;
}
.ward-number-cell {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 500;
  border-radius: 4px;
  transition: background-color 0.2s;
}
.ward-number-cell.is-editable {
  cursor: pointer;
}
.ward-number-cell.is-editable:hover {
  background-color: #e9ecef;
}
@media (max-width: 1200px) {
  .desktop-only .flex-table-wrapper {
    min-width: 1200px;
  }
  .desktop-only.table-wrapper {
    overflow-x: auto;
  }
}
@media (max-width: 992px) {
  .desktop-only {
    display: none !important;
  }
  .mobile-only {
    display: block !important;
  }
  .page-container {
    padding: 0;
    background-color: #f8f9fa;
  }
  .mobile-header {
    background-color: #fff;
    padding: 1rem;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
    position: sticky;
    top: 0;
    z-index: 10;
    flex-shrink: 0;
  }
  .mobile-header .page-title {
    text-align: center;
    margin-bottom: 1rem;
    font-size: 1.5rem;
    padding: 0;
    border: none;
  }
  .mobile-header .source-stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }
  .mobile-header .stat-tag {
    width: 100%;
    text-align: center;
    padding: 8px;
    font-size: 1rem;
    border-radius: 6px;
    border: 1px solid #dee2e6;
  }
  .mobile-header .stat-tag.active {
    background-color: #28a745;
    color: white;
    border-color: #28a745;
  }
  .mobile-header .stat-tag .count {
    color: #333;
    background-color: #e9ecef;
  }
  .mobile-header .stat-tag.active .count {
    background-color: rgba(255, 255, 255, 0.2);
    color: white;
  }
  .tab-content-mobile {
    padding: 1rem;
    overflow-y: auto;
    flex-grow: 1;
    padding-bottom: 80px; /* 為固定底欄留出空間 */
  }
  .cards-container {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .patient-card {
    background-color: #fff;
    border-radius: 8px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
    overflow: hidden;
  }
  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem 1rem;
    background-color: #f8f9fa;
  }
  .patient-name-section {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .patient-name-text {
    font-size: 1.2rem;
    font-weight: bold;
  }
  .freq-tag-card {
    color: #fff;
    padding: 3px 8px;
    border-radius: 12px;
    font-size: 0.8em;
    font-weight: 500;
  }
  .freq-blue {
    background-color: #3498db;
  }
  .freq-green {
    background-color: #2ecc71;
  }
  .freq-orange {
    background-color: #f39c12;
  }
  .freq-purple {
    background-color: #9b59b6;
  }
  .freq-teal {
    background-color: #1abc9c;
  }
  .freq-red {
    background-color: #e74c3c;
  }
  .freq-grey {
    background-color: #95a5a6;
  }
  .card-actions-header {
    display: flex;
    align-items: center;
  }
  .card-actions-header .btn-icon {
    font-size: 1rem;
    width: 32px;
    height: 32px;
  }
  .card-body {
    padding: 1rem;
  }
  .info-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
    margin-bottom: 0.75rem;
  }
  .info-item {
    display: flex;
    flex-direction: column;
  }
  .info-item .label {
    font-size: 0.8rem;
    color: #6c757d;
  }
  .info-item .value {
    font-weight: 500;
  }
  .remarks-section {
    background-color: #f8f9fa;
    padding: 0.5rem;
    border-radius: 4px;
    font-size: 0.9rem;
    margin: 0.75rem 0;
  }
  .remarks-section .label {
    font-weight: bold;
    margin-right: 0.5rem;
  }
  .card-footer {
    padding: 0.75rem 1rem;
    background-color: #f8f9fa;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .card-footer .btn {
    flex-grow: 1;
    padding: 0.6rem 0.5rem;
  }
  .fixed-bottom-bar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    background-color: #fff;
    padding: 1rem;
    box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.1);
    z-index: 100;
    flex-shrink: 0;
  }
  .fixed-bottom-bar .search-group {
    display: flex;
    width: 100%;
  }
  .fixed-bottom-bar .search-group input {
    flex-grow: 1;
    min-width: 0;
    border: 1px solid #ccc;
    border-radius: 6px 0 0 6px;
    height: 40px;
    padding: 8px;
    font-size: 1rem;
  }
  .fixed-bottom-bar .search-group .btn-search {
    flex-shrink: 0;
    height: 40px;
    padding: 8px 15px;
    font-size: 1rem;
    background-color: #17a2b8;
    color: white;
    border: 1px solid #17a2b8;
    border-radius: 0 6px 6px 0;
    cursor: pointer;
  }
}
</style>
