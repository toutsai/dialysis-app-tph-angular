<!-- 檔案路徑: src/views/BaseScheduleView.vue (最終修正版) -->
<template>
  <div class="page-container" :class="{ 'is-locked': isPageLocked }">
    <header class="page-header">
      <div class="header-toolbar">
        <div class="toolbar-left">
          <h1 class="page-title">床位總表</h1>
          <button class="btn btn-warning" @click="handleScheduleCheck">排程檢視</button>
          <button class="btn btn-info" @click="openBaseAssignmentDialog" :disabled="isPageLocked">
            智慧排床
          </button>

          <div class="search-container">
            <input
              type="text"
              v-model="searchQuery"
              class="patient-search-input"
              placeholder="搜尋病人姓名/病歷號..."
              @focus="isSearchFocused = true"
              @blur="handleSearchBlur"
            />
            <ul v-if="searchResults.length > 0 && isSearchFocused" class="search-results">
              <li
                v-for="patient in searchResults"
                :key="patient.id"
                @click="locatePatientOnGrid(patient.id)"
              >
                {{ patient.name }} - {{ patient.medicalRecordNumber }}
              </li>
            </ul>
          </div>
        </div>
        <div class="toolbar-right">
          <span class="status-text">{{ statusText }}</span>
          <button class="btn btn-secondary" @click="exportBaseScheduleToExcel">匯出總表</button>
        </div>
      </div>
    </header>

    <main class="page-main-content">
      <div class="schedule-area">
        <div class="stats-toolbar-wrapper" :style="{ paddingLeft: `${leftOffset}px` }">
          <StatsToolbar
            :stats-data="statsToolbarData"
            :weekdays="statsToolbarWeekdays"
            :column-widths="columnWidths"
            size="normal"
            :show-patient-numbers="true"
          />
        </div>
        <ScheduleTable
          v-if="masterRecord"
          :key="tableKey"
          class="schedule-table-component"
          :layout="bedLayout"
          :schedule-data="weekScheduleMap"
          :patient-map="patientMap"
          :shifts="SHIFTS"
          :weekdays="WEEKDAYS"
          :week-dates="[]"
          :hepatitis-beds="hepatitisBeds"
          :get-style-func="getBaseCellStyle"
          :is-page-locked="isPageLocked"
          @grid-click="handleGridClick"
          @drop="onDrop"
          @drag-start="onDragStart"
          @drag-over="onDragOver"
          @dragleave="onDragLeave"
          @update:column-widths="updateColumnWidths"
          @update:left-offset="updateLeftOffset"
        />
        <div v-else class="loading-state">正在載入總床位表資料...</div>
      </div>
    </main>

    <!-- Dialogs -->
    <SelectionDialog
      :is-visible="isActionDialogVisible"
      :title="`操作病人：${actionTarget.patientName}`"
      :options="ACTION_OPTIONS"
      @select="handleActionSelect"
      @cancel="isActionDialogVisible = false"
    />
    <BedAssignmentDialog
      :is-visible="isAssignmentDialogVisible"
      :all-patients="allPatients"
      :bed-layout="bedLayout"
      :schedule-data="weekScheduleMap"
      :shifts="SHIFTS"
      :freq-map="FREQ_MAP_TO_DAY_INDEX"
      :context="assignmentContext"
      :is-page-locked="isPageLocked"
      @close="isAssignmentDialogVisible = false"
      @assign-bed="handleBedAssigned"
    />
    <PatientSelectDialog
      :is-visible="isPatientSelectDialogVisible"
      title="選擇病人排班 (總表)"
      :patients="allPatients.filter((p) => p.freq)"
      :show-fill-options="false"
      :is-page-locked="isPageLocked"
      @confirm="handlePatientSelect"
      @cancel="isPatientSelectDialogVisible = false"
    />
    <AlertDialog
      :is-visible="isAlertDialogVisible"
      :title="alertDialogTitle"
      :message="alertDialogMessage"
      @confirm="isAlertDialogVisible = false"
    />
    <ConfirmDialog
      :is-visible="isConfirmDialogVisible"
      :title="confirmDialogTitle"
      :message="confirmDialogMessage"
      @confirm="handleConfirm"
      @cancel="handleCancel"
    />
  </div>
</template>

<script setup>
import { ref, onMounted, computed, nextTick, onUnmounted } from 'vue'
import * as XLSX from 'xlsx'
import { updatePatient } from '@/services/optimizedApiService.js'
import { schedulesApi as localSchedulesApi } from '@/services/localApiClient'
import { useAuth } from '@/composables/useAuth'
import { ORDERED_SHIFT_CODES } from '@/constants/scheduleConstants'
import {
  generateAutoNote,
  getUnifiedCellStyle,
  hasFrequencyConflict,
} from '@/utils/scheduleUtils.js'
import { getToday } from '@/utils/dateUtils'
import SelectionDialog from '@/components/SelectionDialog.vue'
import StatsToolbar from '@/components/StatsToolbar.vue'
import ScheduleTable from '@/components/ScheduleTable.vue'
import AlertDialog from '@/components/AlertDialog.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import BedAssignmentDialog from '@/components/BedAssignmentDialog.vue'
import PatientSelectDialog from '@/components/PatientSelectDialog.vue'

import { usePatientStore } from '@/stores/patientStore'
import { storeToRefs } from 'pinia'

const patientStore = usePatientStore()
const { allPatients, patientMap } = storeToRefs(patientStore)
const { removeRuleFromMasterSchedule } = patientStore

const SHIFTS = ORDERED_SHIFT_CODES
const WEEKDAYS = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
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
].sort((a, b) => {
  const numA = typeof a === 'number' ? a : Infinity
  const numB = typeof b === 'number' ? b : Infinity
  if (numA !== Infinity || numB !== Infinity) return numA - numB
  return String(a).localeCompare(String(b))
})
const hepatitisBeds = [31, 32, 33, 35, 36]
const FREQ_MAP_TO_DAY_INDEX = {
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
const ACTION_OPTIONS = [
  { value: 'delete_rule', text: '刪除此排班規則' },
  { value: 'change_freq_and_bed', text: '變更頻率與床位' },
  { value: 'change_bed_only', text: '僅更換床位 (同頻率)' },
]

const masterRecord = ref(null)
const statusText = ref('')
const draggedItem = ref(null)
const columnWidths = ref([])
const leftOffset = ref(0)
const isAlertDialogVisible = ref(false)
const alertDialogTitle = ref('')
const alertDialogMessage = ref('')
const isConfirmDialogVisible = ref(false)
const confirmDialogTitle = ref('')
const confirmDialogMessage = ref('')
const confirmAction = ref(null)
const isPatientSelectDialogVisible = ref(false)
const currentSlotId = ref(null)
const searchQuery = ref('')
const isSearchFocused = ref(false)
const auth = useAuth()
const isActionDialogVisible = ref(false)
const actionTarget = ref({ patientId: null, patientName: '' })
const isAssignmentDialogVisible = ref(false)
const assignmentContext = ref({ mode: 'base', patient: null })
const tableKey = ref(Date.now())

const isPageLocked = computed(() => !auth.canEditSchedules.value)

const weekScheduleMap = computed(() => {
  const combinedSchedule = {}
  if (!masterRecord.value || !masterRecord.value.schedule || !patientMap.value)
    return combinedSchedule
  for (const patientId in masterRecord.value.schedule) {
    const patient = patientMap.value.get(patientId)
    // ✨ 過濾已刪除的病人（預約刪除後的同步處理）
    if (patient && !patient.isDeleted) {
      const ruleData = masterRecord.value.schedule[patientId]
      if (ruleData?.freq) {
        const dayIndices = FREQ_MAP_TO_DAY_INDEX[ruleData.freq] || []
        const { bedNum, shiftIndex } = ruleData
        if (bedNum !== undefined && shiftIndex !== undefined && !isNaN(shiftIndex)) {
          dayIndices.forEach((dayIndex) => {
            const weeklySlotId = `${bedNum}-${shiftIndex}-${dayIndex}`
            combinedSchedule[weeklySlotId] = {
              ...ruleData,
              patientId: patientId,
              shiftId: SHIFTS[shiftIndex],
            }
          })
        }
      }
    }
  }
  return combinedSchedule
})

const weeklyCellStyleMap = computed(() => {
  const styleMap = new Map()
  for (const slotId in weekScheduleMap.value) {
    const slotData = weekScheduleMap.value[slotId]
    const patient = patientMap.value.get(slotData?.patientId)
    styleMap.set(slotId, getUnifiedCellStyle(slotData, patient))
  }
  return styleMap
})

const statsToolbarData = computed(() => {
  const dailyCounts = Array.from({ length: 6 }, () => ({
    counts: {
      early: { total: 0, opd: 0, ipd: 0, er: 0 },
      noon: { total: 0, opd: 0, ipd: 0, er: 0 },
      late: { total: 0, opd: 0, ipd: 0, er: 0 },
    },
    total: 0,
  }))
  if (!masterRecord.value || !masterRecord.value.schedule) return dailyCounts
  for (const patientId in masterRecord.value.schedule) {
    const ruleData = masterRecord.value.schedule[patientId]
    if (ruleData?.freq && ruleData.shiftIndex !== undefined) {
      const patient = patientMap.value.get(patientId)
      // ✨ 過濾已刪除的病人（預約刪除後的同步處理）
      if (!patient || patient.isDeleted) continue
      const shiftCode = SHIFTS[ruleData.shiftIndex]
      const dayIndices = FREQ_MAP_TO_DAY_INDEX[ruleData.freq] || []
      dayIndices.forEach((dayIndex) => {
        if (dayIndex >= 0 && dayIndex < 6 && shiftCode && dailyCounts[dayIndex].counts[shiftCode]) {
          const shiftStats = dailyCounts[dayIndex].counts[shiftCode]
          shiftStats.total++
          dailyCounts[dayIndex].total++
          if (patient.status === 'opd') shiftStats.opd++
          else if (patient.status === 'ipd') shiftStats.ipd++
          else if (patient.status === 'er') shiftStats.er++
        }
      })
    }
  }
  return dailyCounts
})

const statsToolbarWeekdays = computed(() => WEEKDAYS.map((w) => w.slice(-1)))

const searchResults = computed(() => {
  if (!searchQuery.value) return []
  const query = searchQuery.value.toLowerCase()
  return allPatients.value
    .filter(
      (p) =>
        (p.name && p.name.toLowerCase().includes(query)) ||
        (p.medicalRecordNumber && p.medicalRecordNumber.includes(query)),
    )
    .slice(0, 5)
})

// --- Functions ---

/**
 * 將單一規則的變更原子性地更新到本地資料庫。
 * @param {string} patientId - 病人 ID
 * @param {object} newRuleData - 新的規則物件
 */
async function updateRuleInCloud(patientId, newRuleData) {
  if (isPageLocked.value) {
    showAlert('權限不足', '您沒有權限執行此操作。')
    return
  }
  statusText.value = '儲存中...'
  try {
    // 使用本地 API 更新病人規則
    await localSchedulesApi.updatePatientRule(patientId, newRuleData)
    statusText.value = '總表已更新'
    await loadAllData()
  } catch (error) {
    statusText.value = '儲存失敗'
    showAlert('操作失敗', `儲存規則時發生錯誤: ${error.message}`)
    console.error(`❌ [BaseScheduleView] 更新規則失敗 for ${patientId}:`, error)
    // 如果更新失敗，也重新載入一次資料，以恢復到操作前的正確狀態
    await loadAllData()
  }
}

function showAlert(title, message) {
  alertDialogTitle.value = title
  alertDialogMessage.value = message
  isAlertDialogVisible.value = true
}

function onDragStart(event, slotId) {
  if (isPageLocked.value) {
    event.preventDefault()
    return
  }
  const slotData = weekScheduleMap.value[slotId]
  if (!slotData || !slotData.patientId) {
    event.preventDefault()
    return
  }
  draggedItem.value = { sourcePatientId: slotData.patientId }
  event.dataTransfer.effectAllowed = 'move'
}

async function onDrop(event, targetSlotId) {
  if (isPageLocked.value) return
  event.preventDefault()
  document.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'))

  const itemToDrop = draggedItem.value
  if (!itemToDrop || !itemToDrop.sourcePatientId) {
    draggedItem.value = null
    return
  }

  const { sourcePatientId } = itemToDrop
  const sourceRuleData = masterRecord.value.schedule[sourcePatientId]
  if (!sourceRuleData) {
    console.error(`❌ 在 masterRecord 中找不到病人 ${sourcePatientId} 的規則資料`)
    draggedItem.value = null
    return
  }

  const targetParts = targetSlotId.split('-')
  let bedNum, shiftIndex
  if (targetParts[0] === 'peripheral') {
    bedNum = `${targetParts[0]}-${targetParts[1]}`
    shiftIndex = parseInt(targetParts[2], 10)
  } else {
    bedNum = targetParts[0]
    shiftIndex = parseInt(targetParts[1], 10)
  }

  if (sourceRuleData.bedNum == bedNum && sourceRuleData.shiftIndex == shiftIndex) {
    draggedItem.value = null
    return
  }

  const draggedPatientFreq = sourceRuleData.freq
  const currentSchedule = masterRecord.value.schedule
  for (const patientId in currentSchedule) {
    if (patientId === sourcePatientId) continue
    const rule = currentSchedule[patientId]
    if (
      rule.bedNum == bedNum &&
      rule.shiftIndex == shiftIndex &&
      hasFrequencyConflict(draggedPatientFreq, rule.freq)
    ) {
      const conflictPatient = patientMap.value.get(patientId)
      showAlert(
        '排班衝突',
        `無法放置！目標床位的 ${conflictPatient?.name || '未知病人'} (${rule.freq}) 與您拖曳的病人的頻率 (${draggedPatientFreq}) 有時間衝突。`,
      )
      draggedItem.value = null
      return
    }
  }

  const newRuleData = { ...sourceRuleData, bedNum, shiftIndex }
  await updateRuleInCloud(sourcePatientId, newRuleData)
  draggedItem.value = null
}

async function handleBedAssigned({ patientId, bedNum, shiftCode, newFreq }) {
  const patient = patientMap.value.get(patientId)
  if (!patient) return
  const newShiftIndex = SHIFTS.indexOf(shiftCode)
  if (newShiftIndex === -1) return

  const currentRule = masterRecord.value.schedule[patientId]
  const finalFreq = newFreq || currentRule?.freq || patient.freq
  if (!finalFreq) {
    showAlert('操作失敗', `病人 ${patient.name} 沒有設定頻率，無法排入總表。`)
    return
  }

  for (const pId in masterRecord.value.schedule) {
    if (pId === patientId) continue
    const rule = masterRecord.value.schedule[pId]
    if (
      rule.bedNum == bedNum &&
      rule.shiftIndex == newShiftIndex &&
      hasFrequencyConflict(finalFreq, rule.freq)
    ) {
      const conflictPatient = patientMap.value.get(pId)
      showAlert(
        '排班衝突',
        `此床位已有 ${conflictPatient?.name || '其他病人'} (${rule.freq})，與您選擇的頻率 (${finalFreq}) 有時間衝突。`,
      )
      return
    }
  }

  if (newFreq && patient.freq !== newFreq) {
    try {
      await updatePatient(patientId, { freq: newFreq })
      await patientStore.forceRefreshPatients()
    } catch (error) {
      console.error('更新病人頻率失敗:', error)
      showAlert('錯誤', '更新病人頻率失敗，請稍後再試。')
      return
    }
  }

  const newRuleData = {
    ...(currentRule || {}),
    bedNum: bedNum,
    shiftIndex: newShiftIndex,
    freq: finalFreq,
    autoNote: generateAutoNote({ ...patient, freq: finalFreq }),
    manualNote: currentRule?.manualNote || patient.baseNote || '',
  }

  await updateRuleInCloud(patientId, newRuleData)
  isAssignmentDialogVisible.value = false
}

async function handleDeleteRule() {
  const patientId = actionTarget.value.patientId
  const patientName = actionTarget.value.patientName
  if (!patientId) return

  confirmDialogTitle.value = '刪除排班規則'
  confirmDialogMessage.value = `您確定要將 ${patientName} 從總表中移除嗎？\n\n此操作將立即從後台刪除其固定規則，並自動取消所有相關的未來調班申請。\n\n注意：病人的透析頻率資料會被保留，不會受到影響。`

  confirmAction.value = async () => {
    statusText.value = `正在移除 ${patientName} 的規則...`
    try {
      // 🔥【修正】在刪除總表規則之前，先確保病人資料中有 freq
      // 這可以避免因為回填邏輯導致頻率資料遺失
      const patient = patientMap.value.get(patientId)
      const ruleData = masterRecord.value?.schedule?.[patientId]

      if (patient && ruleData?.freq && !patient.dialysisOrders?.freq) {
        // 病人資料中沒有 freq，但總表規則中有，先同步到病人資料
        console.log(`🔄 [BaseScheduleView] 保留病人 ${patientName} 的頻率: ${ruleData.freq}`)
        await updatePatient(patientId, { freq: ruleData.freq })
      }

      await removeRuleFromMasterSchedule(patientId)
      await loadAllData()
      showAlert('操作成功', `已成功將 ${patientName} 從總表中移除。\n\n病人的透析頻率資料已保留。`)
      statusText.value = '總表規則已更新'
    } catch (error) {
      console.error('❌ [BaseScheduleView] 刪除規則失敗:', error)
      showAlert('操作失敗', `移除排班規則時發生錯誤: ${error.message}`)
      statusText.value = '操作失敗'
    }
  }
  isConfirmDialogVisible.value = true
}

async function handlePatientSelect({ patientId }) {
  if (isPageLocked.value || !patientId || !currentSlotId.value) return
  const patient = patientMap.value.get(patientId)
  if (!patient || !patient.freq) {
    showAlert('操作失敗', `病人 ${patient?.name || '未知'} 沒有設定頻率，無法排入總表。`)
    return
  }
  if (masterRecord.value.schedule && masterRecord.value.schedule[patientId]) {
    showAlert('操作失敗', `病人 ${patient.name} 已存在於總床位表中。`)
    return
  }

  const parts = currentSlotId.value.split('-')
  let bedNum, shiftIndex
  if (parts[0] === 'peripheral') {
    bedNum = `${parts[0]}-${parts[1]}`
    shiftIndex = parseInt(parts[2], 10)
  } else {
    bedNum = parts[0]
    shiftIndex = parseInt(parts[1], 10)
  }
  isPatientSelectDialogVisible.value = false

  const newRuleData = {
    bedNum: bedNum,
    shiftIndex: shiftIndex,
    freq: patient.freq,
    manualNote: patient.baseNote || '',
    autoNote: generateAutoNote(patient),
  }

  await updateRuleInCloud(patientId, newRuleData)
  currentSlotId.value = null
}

function exportBaseScheduleToExcel() {
  if (!masterRecord.value || !masterRecord.value.schedule) {
    showAlert('提示', '沒有總表資料可匯出。')
    return
  }
  const data = []
  const exportDate = getToday()
  data.push(['部立台北醫院 透析排程總表 (固定規則)'])
  data.push([`匯出日期: ${exportDate}`])
  data.push([])
  const headers = [
    '病人姓名',
    '病歷號',
    '目前身分別',
    '固定床位',
    '固定班別',
    '固定頻率',
    '手動備註',
    '自動備註',
  ]
  data.push(headers)
  const sortedRules = Object.entries(masterRecord.value.schedule).sort(([, ruleA], [, ruleB]) => {
    const bedA = String(ruleA.bedNum).startsWith('p')
      ? 9999 + parseInt(String(ruleA.bedNum).slice(-1))
      : parseInt(ruleA.bedNum)
    const bedB = String(ruleB.bedNum).startsWith('p')
      ? 9999 + parseInt(String(ruleB.bedNum).slice(-1))
      : parseInt(ruleB.bedNum)
    if (bedA !== bedB) return bedA - bedB
    return ruleA.shiftIndex - ruleB.shiftIndex
  })
  const shiftDisplayMap = { early: '早班', noon: '午班', late: '晚班' }
  const statusMap = { opd: '門診', ipd: '住院', er: '急診' }
  sortedRules.forEach(([patientId, rule]) => {
    const patient = patientMap.value.get(patientId)
    if (patient) {
      data.push([
        patient.name,
        patient.medicalRecordNumber,
        statusMap[patient.status] || '未知',
        rule.bedNum,
        shiftDisplayMap[SHIFTS[rule.shiftIndex]] || '未知',
        rule.freq,
        rule.manualNote || '',
        rule.autoNote || '',
      ])
    }
  })
  const worksheet = XLSX.utils.aoa_to_sheet(data)
  worksheet['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: headers.length - 1 } },
  ]
  worksheet['!cols'] = [
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 10 },
    { wch: 10 },
    { wch: 12 },
    { wch: 30 },
    { wch: 30 },
  ]
  const ensureCellAndStyle = (r, c) => {
    const cellAddress = XLSX.utils.encode_cell({ r, c })
    if (!worksheet[cellAddress]) worksheet[cellAddress] = { t: 's', v: '' }
    if (!worksheet[cellAddress].s) worksheet[cellAddress].s = {}
    return worksheet[cellAddress]
  }
  for (let r = 0; r < data.length; r++) {
    for (let c = 0; c < (data[r] ? data[r].length : 0); c++) {
      const cell = ensureCellAndStyle(r, c)
      if (!cell.s.alignment) cell.s.alignment = {}
      cell.s.alignment = { vertical: 'center', horizontal: 'center', wrapText: true }
      if (!cell.s.border) cell.s.border = {}
      cell.s.border = {
        top: { style: 'thin' },
        bottom: { style: 'thin' },
        left: { style: 'thin' },
        right: { style: 'thin' },
      }
    }
  }
  const titleCell = ensureCellAndStyle(0, 0)
  if (!titleCell.s.font) titleCell.s.font = {}
  titleCell.s.font = { sz: 18, bold: true }
  const dateCell = ensureCellAndStyle(1, 0)
  if (!dateCell.s.font) dateCell.s.font = {}
  dateCell.s.font = { sz: 12 }
  headers.forEach((_, c) => {
    const cell = ensureCellAndStyle(3, c)
    if (!cell.s.font) cell.s.font = {}
    cell.s.font = { bold: true }
    if (!cell.s.fill) cell.s.fill = {}
    cell.s.fill = { fgColor: { rgb: 'FFF2F2F2' } }
  })
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, '總床位表')
  XLSX.writeFile(workbook, `總床位表_備份_${exportDate}.xlsx`)
}

function getBaseCellStyle(slotId) {
  return weeklyCellStyleMap.value.get(slotId) || {}
}
function updateLeftOffset(newOffset) {
  leftOffset.value = newOffset
}
function updateColumnWidths(newWidths) {
  columnWidths.value = newWidths
}
function handleSearchBlur() {
  setTimeout(() => {
    isSearchFocused.value = false
  }, 200)
}

function locatePatientOnGrid(patientId) {
  searchQuery.value = ''
  isSearchFocused.value = false
  if (!masterRecord.value || !masterRecord.value.schedule) return
  const ruleData = masterRecord.value.schedule[patientId]
  if (!ruleData) {
    showAlert('提示', '該病人未被排入總床位表。')
    return
  }
  const dayIndices = FREQ_MAP_TO_DAY_INDEX[ruleData.freq] || []
  if (dayIndices.length === 0) return
  const { bedNum, shiftIndex } = ruleData
  const firstDayIndex = dayIndices[0]
  const targetSlotId = `${bedNum}-${shiftIndex}-${firstDayIndex}`
  nextTick(() => {
    const targetElement = document.querySelector(`[data-slot-id="${targetSlotId}"]`)
    if (targetElement) {
      targetElement.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
      targetElement.classList.add('highlight-flash')
      setTimeout(() => {
        targetElement.classList.remove('highlight-flash')
      }, 2000)
    }
  })
}

function handleActionSelect(actionValue) {
  isActionDialogVisible.value = false
  const patientId = actionTarget.value.patientId
  if (!patientId) return
  if (actionValue === 'delete_rule') handleDeleteRule()
  else if (actionValue === 'change_freq_and_bed') openChangeFreqAndBedDialog()
  else if (actionValue === 'change_bed_only') openChangeBedOnlyDialog()
}

function handleScheduleCheck() {
  const results = runBedCheck()
  let issueMessage = ''
  if (results.duplicates.length > 0)
    issueMessage += '【床位衝突】:\n- ' + results.duplicates.join('\n- ') + '\n\n'
  if (results.unassignedCrucial.length > 0)
    issueMessage += '【重要病人未排床】:\n- ' + results.unassignedCrucial.join('\n- ') + '\n\n'
  if (results.freqMismatch.length > 0)
    issueMessage += '【頻率不符問題】:\n- ' + results.freqMismatch.join('\n- ') + '\n\n'

  if (issueMessage) {
    alertDialogTitle.value = '排班問題檢查結果'
    alertDialogMessage.value = issueMessage
  } else {
    alertDialogTitle.value = '排程檢視完畢'
    alertDialogMessage.value = '✅ 太棒了！未發現明顯的排班問題。'
  }
  isAlertDialogVisible.value = true
}

function openBaseAssignmentDialog() {
  if (isPageLocked.value) return
  assignmentContext.value = { mode: 'base', patient: null }
  isAssignmentDialogVisible.value = true
}

function handleGridClick(slotId) {
  const slotData = weekScheduleMap.value[slotId]
  const patientId = slotData?.patientId
  if (isPageLocked.value) return

  if (patientId) {
    actionTarget.value = {
      patientId: patientId,
      patientName: patientMap.value.get(patientId)?.name || '未知病人',
    }
    isActionDialogVisible.value = true
  } else {
    currentSlotId.value = slotId
    isPatientSelectDialogVisible.value = true
  }
}

function openChangeFreqAndBedDialog() {
  const patient = patientMap.value.get(actionTarget.value.patientId)
  if (!patient) return
  assignmentContext.value = { mode: 'change_freq_and_bed', patient: patient }
  isAssignmentDialogVisible.value = true
}

function openChangeBedOnlyDialog() {
  const patient = patientMap.value.get(actionTarget.value.patientId)
  if (!patient) return
  assignmentContext.value = { mode: 'change_bed_only', patient: patient }
  isAssignmentDialogVisible.value = true
}

function runBedCheck() {
  const validationResult = { duplicates: [], unassignedCrucial: [], freqMismatch: [] }
  if (!masterRecord.value || !masterRecord.value.schedule) return validationResult

  const schedule = masterRecord.value.schedule
  const scheduledPatientIds = new Set(Object.keys(schedule))
  const occupiedSlots = new Map()

  for (const patientId in schedule) {
    const rule = schedule[patientId]
    const slotKey = `${rule.bedNum}-${rule.shiftIndex}`
    const freqDays = FREQ_MAP_TO_DAY_INDEX[rule.freq] || []
    for (const dayIndex of freqDays) {
      const daySlotKey = `${slotKey}-${dayIndex}`
      if (occupiedSlots.has(daySlotKey)) {
        const existingPatientName =
          patientMap.value.get(occupiedSlots.get(daySlotKey))?.name || '未知病人'
        const newPatientName = patientMap.value.get(patientId)?.name || '未知病人'
        validationResult.duplicates.push(
          `床位衝突: ${newPatientName} 與 ${existingPatientName} 在 ${WEEKDAYS[dayIndex]} 的同一個床位/班別中有時間重疊。`,
        )
      } else {
        occupiedSlots.set(daySlotKey, patientId)
      }
    }
  }

  const unassignedCrucialPatients = allPatients.value.filter(
    (p) =>
      !scheduledPatientIds.has(p.id) &&
      (p.status === 'ipd' || p.status === 'er') &&
      !p.isDeleted &&
      !p.isDiscontinued,
  )
  unassignedCrucialPatients.forEach((p) =>
    validationResult.unassignedCrucial.push(`${p.name} (${p.status === 'ipd' ? '住院' : '急診'})`),
  )

  for (const patientId in schedule) {
    const ruleData = schedule[patientId]
    if (ruleData?.freq) {
      const patient = patientMap.value.get(patientId)
      if (patient && patient.freq && patient.freq !== ruleData.freq) {
        validationResult.freqMismatch.push(
          `${patient.name} - 規則頻率: ${ruleData.freq}, 病人設定頻率: ${patient.freq} (建議同步)`,
        )
      }
    }
  }
  return validationResult
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
function onDragOver(event) {
  if (isPageLocked.value) return
  event.preventDefault()
  const targetSlot = event.target.closest('.schedule-slot')
  if (targetSlot) targetSlot.classList.add('drag-over')
}
function onDragLeave(event) {
  event.target.closest('.schedule-slot')?.classList.remove('drag-over')
}

async function loadAllData() {
  statusText.value = '讀取中...'
  try {
    await patientStore.fetchPatientsIfNeeded()
    const baseScheduleDoc = await localSchedulesApi.fetchMasterSchedule()
    if (baseScheduleDoc && baseScheduleDoc.schedule) {
      masterRecord.value = {
        id: baseScheduleDoc.id || 'MASTER_SCHEDULE',
        schedule: baseScheduleDoc.schedule,
      }
    } else {
      masterRecord.value = { id: 'MASTER_SCHEDULE', schedule: {} }
    }
    statusText.value = '總床位表已載入'
    tableKey.value = Date.now()
  } catch (error) {
    console.error('❌ [BaseScheduleView] 載入資料失敗:', error)
    statusText.value = '讀取失敗'
    masterRecord.value = { id: 'MASTER_SCHEDULE', schedule: {} }
  }
}

async function handlePatientDataUpdate() {
  console.log('🔄 [BaseScheduleView] 收到病人資料更新通知，正在重新載入所有資料...')
  await loadAllData()
}

function handleScheduleUpdate() {
  console.log('🔄 [BaseScheduleView] 收到排程儲存通知，正在重新載入總表資料...')
  loadAllData()
}

onMounted(() => {
  loadAllData()
  window.addEventListener('patient-data-updated', handlePatientDataUpdate)
  window.addEventListener('schedule-updated', handleScheduleUpdate)
})

onUnmounted(() => {
  window.removeEventListener('patient-data-updated', handlePatientDataUpdate)
  window.removeEventListener('schedule-updated', handleScheduleUpdate)
})
</script>

<style scoped>
/* ... 您的 CSS 樣式保持不變 ... */
.search-container {
  position: relative;
  display: inline-block;
}
.patient-search-input {
  padding: 8px 16px;
  border: 1px solid #ced4da;
  border-radius: 6px;
  width: 220px;
  height: 45px;
  box-sizing: border-box;
  transition: all 0.2s;
  font-size: 1rem;
}
.patient-search-input:focus {
  outline: none;
  border-color: #007bff;
  box-shadow: 0 0 0 2px rgba(0, 123, 255, 0.25);
}
.search-results {
  position: absolute;
  top: 100%;
  left: 0;
  width: 100%;
  background-color: white;
  border: 1px solid #ccc;
  border-top: none;
  border-radius: 0 0 4px 4px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  list-style: none;
  padding: 0;
  margin: 0;
  max-height: 200px;
  overflow-y: auto;
  z-index: 1000;
}
.search-results li {
  padding: 8px 12px;
  cursor: pointer;
  border-bottom: 1px solid #eee;
}
.search-results li:last-child {
  border-bottom: none;
}
.search-results li:hover {
  background-color: #f0f0f0;
}
@keyframes highlight-animation {
  0% {
    background-color: #fffbe3;
    outline: 3px solid #f8c000;
  }
  100% {
    background-color: transparent;
    outline: 3px solid transparent;
  }
}
:deep(.highlight-flash) {
  animation: highlight-animation 2s ease-out;
}
.page-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  box-sizing: border-box;
  padding: 10px;
}
.page-header {
  flex-shrink: 0;
  padding: 0 0 10px 0;
  box-sizing: border-box;
}
.header-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.toolbar-left,
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 16px;
}
.page-title {
  font-size: 32px;
  font-weight: 600;
  margin: 0;
  color: #343a40;
}
.toolbar-left .btn,
.toolbar-right .btn-save,
.toolbar-left button,
.toolbar-right button {
  padding: 8px 16px;
  font-size: 1rem;
  line-height: 1.5;
  border-radius: 6px;
  border: 1px solid #ced4da;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s;
  white-space: nowrap;
  color: #212529;
}
.toolbar-left .btn:hover {
  border-color: #adb5bd;
  background-color: #f8f9fa;
}
.btn.btn-info {
  background-color: #17a2b8;
  color: white;
  border-color: #17a2b8;
}
.btn.btn-info:hover {
  background-color: #138496;
  border-color: #117a8b;
}
.btn.btn-warning {
  background-color: #ffc107;
  color: #212529;
  border-color: #ffc107;
}
.btn.btn-warning:hover {
  background-color: #e0a800;
  border-color: #d39e00;
}
.btn-save {
  background-color: #007bff;
  border-color: #007bff;
  color: white;
}
.btn-save:hover:not(:disabled) {
  background-color: #0069d9;
  border-color: #0062cc;
}
.btn-save:disabled {
  background-color: #6c757d;
  border-color: #6c757d;
  cursor: not-allowed;
  opacity: 0.65;
}
.status-text {
  color: #6c757d;
  font-style: italic;
  font-size: 0.9rem;
}
.page-main-content {
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  box-sizing: border-box;
  background-color: #fff;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid #dee2e6;
}
.schedule-area {
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.stats-toolbar-wrapper {
  flex-shrink: 0;
  padding: 8px 1rem;
  box-sizing: border-box;
  transition: padding-left 0.2s ease-in-out;
}
.schedule-table-component {
  flex-grow: 1;
  overflow: auto;
}
:deep(.schedule-slot.status-opd) {
  background-color: var(--green-bg, #e8f5e9);
}
:deep(.schedule-slot.status-ipd) {
  background-color: var(--red-bg, #ffebee);
}
:deep(.schedule-slot.status-er) {
  background-color: var(--purple-bg, #f3e5f5);
}
:deep(.schedule-slot.status-biweekly) {
  background-color: var(--orange-bg, #ffcc80);
}
/* ✨ 已刪除病人樣式（預約刪除後的同步處理） */
:deep(.schedule-slot.status-deleted) {
  background-color: #e0e0e0;
  color: #9e9e9e;
  opacity: 0.5;
  text-decoration: line-through;
}
:deep(.schedule-slot.tag-chou) {
  background-color: #e3f2fd;
}
:deep(.schedule-slot.tag-new) {
  background-color: #fffde7;
}
:deep(.schedule-slot.tag-huan) {
  background-color: #e0f7fa;
}
:deep(.schedule-slot.tag-liang) {
  background-color: #fff3e0;
}
:deep(.schedule-slot.tag-b) {
  background-color: #fff9c4;
}
.is-locked .page-header button:not(:disabled) {
  opacity: 0.65;
  pointer-events: none;
  cursor: default;
}
.is-locked .page-main-content {
  background-color: #fafafa;
}
.is-locked :deep(.schedule-slot) {
  cursor: not-allowed;
}
.is-locked :deep(.memo-icon-wrapper) {
  pointer-events: auto;
  cursor: pointer;
}
.is-locked :deep(.schedule-slot[draggable='true']) {
  cursor: not-allowed;
}
.loading-state {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100%;
  font-size: 1.5rem;
  color: #6c757d;
}
:deep(.shift-row.status-opd),
:deep(.peripheral-shift-row.status-opd),
:deep(.patient-item.status-opd) {
  background-color: #e8f5e9;
}
:deep(.shift-row.status-ipd),
:deep(.peripheral-shift-row.status-ipd),
:deep(.patient-item.status-ipd) {
  background-color: #ffebee;
}
:deep(.shift-row.status-er),
:deep(.peripheral-shift-row.status-er),
:deep(.patient-item.status-er) {
  background-color: #f3e5f5;
}
:deep(.shift-row.status-biweekly),
:deep(.peripheral-shift-row.status-biweekly),
:deep(.patient-item.status-biweekly) {
  background-color: #ffcc80;
}
/* ✨ 已刪除病人樣式（預約刪除後的同步處理） */
:deep(.shift-row.status-deleted),
:deep(.peripheral-shift-row.status-deleted),
:deep(.patient-item.status-deleted) {
  background-color: #e0e0e0;
  color: #9e9e9e;
  opacity: 0.5;
  text-decoration: line-through;
}
:deep(.shift-row.tag-chou),
:deep(.peripheral-shift-row.tag-chou),
:deep(.patient-item.tag-chou) {
  background-color: #658ee0;
}
:deep(.shift-row.tag-new),
:deep(.peripheral-shift-row.tag-new),
:deep(.patient-item.tag-new) {
  background-color: #f5ec8e;
}
:deep(.shift-row.tag-huan),
:deep(.peripheral-shift-row.tag-huan),
:deep(.patient-item.tag-huan) {
  background-color: #e0f7fa;
}
:deep(.shift-row.tag-liang),
:deep(.peripheral-shift-row.tag-liang),
:deep(.patient-item.tag-liang) {
  background-color: #fff3e0;
}
:deep(.shift-row.tag-b),
:deep(.peripheral-shift-row.tag-b),
:deep(.patient-item.tag-b) {
  background-color: #fff9c4;
}
:deep(.schedule-slot.status-biweekly) {
  background-color: #ffcc80;
}
:deep(.schedule-slot.tag-chou) {
  background-color: #658ee0;
}
:deep(.schedule-slot.tag-new) {
  background-color: #f5ec8e;
}
</style>
