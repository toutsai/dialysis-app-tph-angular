<!-- 檔案路徑: src/components/DailyDraftListDialog.vue (完整替換) -->
<template>
  <div v-if="isVisible" class="dialog-overlay" v-overlay-close="closeDialog">
    <div class="dialog-container large">
      <div class="dialog-header">
        <h3>{{ targetDate }} - {{ shiftDisplayName }} 藥囑草稿查核表</h3>
        <button @click="closeDialog" class="close-btn">×</button>
      </div>
      <div class="dialog-controls">
        <button
          @click="exportToExcel"
          class="btn-primary"
          :disabled="isLoading || checklistData.length === 0"
        >
          <i class="fas fa-file-excel"></i> 匯出為 Excel
        </button>
      </div>
      <div class="dialog-body">
        <div v-if="isLoading" class="loading-state">
          <div class="spinner"></div>
          <p>正在載入藥囑草稿...</p>
        </div>
        <div v-else-if="patientsInShift.length === 0" class="empty-state">
          <p>此班次沒有排班病人。</p>
        </div>
        <div v-else class="table-wrapper">
          <table class="draft-table" id="draft-export-table">
            <thead>
              <!-- 藥物分類標頭 -->
              <tr class="group-header-row">
                <th class="sticky-col name-col" rowspan="2">床號</th>
                <th class="sticky-col name-col" rowspan="2">姓名</th>
                <th
                  v-for="group in medicationGroups"
                  :key="group.title"
                  :colspan="group.meds.length"
                >
                  {{ group.title }}
                </th>
              </tr>
              <!-- 藥物名稱標頭 -->
              <tr class="med-header-row">
                <th v-for="med in allMeds" :key="med.code" :title="med.code">
                  {{ med.tradeName }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="patientRow in checklistData" :key="patientRow.patient.id">
                <td class="sticky-col name-col">{{ patientRow.patient.bedNum }}</td>
                <td class="sticky-col name-col">{{ patientRow.patient.name }}</td>
                <td
                  v-for="med in allMeds"
                  :key="med.code"
                  :class="{ 'has-data': patientRow.meds[med.code] }"
                >
                  <!-- 修改此處的 span 內部結構 -->
                  <span
                    v-if="patientRow.meds[med.code]"
                    :title="`頻率/備註: ${patientRow.meds[med.code].freqOrNote}`"
                  >
                    {{ patientRow.meds[med.code].dose }}
                    <small class="unit">{{ patientRow.meds[med.code].unit }}</small>
                    <!-- ✨ 新增這一段：如果 freqOrNote 存在，就顯示它 ✨ -->
                    <small v-if="patientRow.meds[med.code].freqOrNote" class="freq-note">
                      ({{ patientRow.meds[med.code].freqOrNote }})
                    </small>
                  </span>
                  <span v-else class="empty-cell">-</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import * as XLSX from 'xlsx'
import { getShiftDisplayName as getShiftName } from '@/constants/scheduleConstants.js'
import { CORRELATION_GROUPS, ALL_MEDS_MASTER } from '@/constants/medicationConstants.js'

const props = defineProps({
  isVisible: Boolean,
  isLoading: Boolean,
  drafts: { type: Array, default: () => [] },
  patientsInShift: { type: Array, default: () => [] },
  targetDate: String,
})

const emit = defineEmits(['close'])
const closeDialog = () => emit('close')

const medicationGroups = CORRELATION_GROUPS
const allMeds = ALL_MEDS_MASTER

const shiftDisplayName = computed(() => {
  if (props.patientsInShift.length === 0) return '全日'
  const shiftCode = props.patientsInShift[0].shift
  return getShiftName(shiftCode) || '未知班別'
})

// 核心計算屬性：將病人和草稿資料組合成查核表所需的結構
const checklistData = computed(() => {
  if (props.isLoading || props.patientsInShift.length === 0) {
    return []
  }

  // 為了快速查找，將草稿陣列轉換為 Map
  const draftsMap = new Map()
  props.drafts.forEach((draft) => {
    const key = `${draft.patientId}-${draft.orderCode}`
    draftsMap.set(key, draft)
  })

  // 遍歷班內所有病人，為每位病人建立一橫列的資料
  return props.patientsInShift.map((patient) => {
    const patientMeds = {}
    // 遍歷所有可能的藥物
    allMeds.forEach((med) => {
      const key = `${patient.id}-${med.code}`
      const draft = draftsMap.get(key)
      if (draft) {
        patientMeds[med.code] = {
          dose: draft.dose,
          unit: draft.unit,
          freqOrNote: draft.orderType === 'injection' ? draft.note : draft.frequency,
        }
      } else {
        patientMeds[med.code] = null // 代表沒有開立此藥草稿
      }
    })
    return {
      patient: patient,
      meds: patientMeds,
    }
  })
})

function exportToExcel() {
  const dataToExport = []

  // 建立表頭
  const headers = ['床號', '姓名', ...allMeds.map((med) => med.tradeName)]
  dataToExport.push(headers)

  // 建立資料列
  checklistData.value.forEach((patientRow) => {
    const row = [patientRow.patient.bedNum, patientRow.patient.name]
    allMeds.forEach((med) => {
      const draftData = patientRow.meds[med.code]
      if (draftData) {
        let cellValue = `${draftData.dose} ${draftData.unit}`
        if (draftData.freqOrNote) {
          cellValue += ` (${draftData.freqOrNote})`
        }
        row.push(cellValue)
      } else {
        row.push('') // 留白
      }
    })
    dataToExport.push(row)
  })

  const worksheet = XLSX.utils.aoa_to_sheet(dataToExport)
  // 設定欄寬
  worksheet['!cols'] = [
    { wch: 8 },
    { wch: 12 },
    ...allMeds.map(() => ({ wch: 15 })), // 為每種藥物設定一個寬度
  ]

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, '藥囑草稿查核表')
  XLSX.writeFile(workbook, `${props.targetDate}_${shiftDisplayName.value}_藥囑草稿.xlsx`)
}
</script>

<style scoped>
.dialog-container.large {
  max-width: 95%;
  width: 1400px;
}
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1050;
}
.dialog-container {
  background: white;
  border-radius: 8px;
  box-shadow: 0 5px 15px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  max-height: 90vh;
}
.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid #dee2e6;
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
}
.dialog-controls {
  padding: 1rem 1.5rem;
  border-bottom: 1px solid #dee2e6;
  text-align: right;
}
.btn-primary {
  padding: 0.5rem 1rem;
  border-radius: 6px;
  border: none;
  font-weight: 500;
  cursor: pointer;
  background-color: #198754;
  color: white;
}
.btn-primary:disabled {
  background-color: #6c757d;
  cursor: not-allowed;
}
.dialog-body {
  overflow: auto;
  padding: 0;
}
.loading-state,
.empty-state {
  text-align: center;
  padding: 2rem;
  color: #6c757d;
}
.spinner {
  width: 40px;
  height: 40px;
  border: 4px solid #f3f3f3;
  border-top: 4px solid #007bff;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 auto 1rem;
}
@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

.table-wrapper {
  width: 100%;
}
.draft-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  /* ✨ 核心修改 1: 讓表格佈局由內容決定 */
  table-layout: auto;
}
.draft-table th,
.draft-table td {
  border-bottom: 1px solid #dee2e6;
  border-right: 1px solid #e9ecef;
  padding: 0.75rem 0.6rem; /* 微調左右內距，讓表格更緊湊 */
  text-align: center;
  white-space: nowrap;
}
.draft-table th {
  background-color: #f8f9fa;
  position: sticky;
  top: 0;
  z-index: 2;
}
.draft-table .group-header-row th {
  top: 0;
  background-color: #e9ecef;
  font-weight: bold;
}
.draft-table .med-header-row th {
  top: 45px;
  font-size: 0.9em;
  /* ✨ 核心修改 2: 為藥物欄位設定一個最小寬度，避免過窄 */
  min-width: 110px;
}
.draft-table .sticky-col {
  position: sticky;
  left: 0;
  z-index: 1;
  background-color: #f8f9fa;
  border-right: 2px solid #ced4da;
}
.draft-table thead .sticky-col {
  z-index: 3;
}

/* ✨ 核心修改 3: 明確設定固定欄的寬度和位置 */
.draft-table .sticky-col.name-col:nth-child(1) {
  width: 80px;
  min-width: 80px;
  left: 0;
}
.draft-table .sticky-col.name-col:nth-child(2) {
  width: 100px;
  min-width: 100px;
  left: 80px; /* 等於第一欄的寬度 */
}

.empty-cell {
  color: #adb5bd;
}
.has-data {
  background-color: #e8f5e9;
  font-weight: bold;
}
.unit {
  font-size: 0.8em;
  color: #6c757d;
  font-weight: normal;
  margin-left: 2px;
}
.freq-note {
  font-size: 0.8em;
  color: #6c757d;
  font-weight: normal;
  margin-left: 4px;
  white-space: nowrap;
}
</style>
