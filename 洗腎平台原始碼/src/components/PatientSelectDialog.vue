<!-- 檔案路徑: src/components/PatientSelectDialog.vue (最終修正版 v2) -->
<template>
  <Transition name="dialog-fade">
    <div v-if="isVisible" class="dialog-overlay" v-overlay-close="onCancel">
      <div class="dialog-content">
        <header class="dialog-header">
          <h2>{{ title }}</h2>
          <button class="close-button" @click="onCancel">×</button>
        </header>
        <main class="dialog-body">
          <div class="search-controls">
            <input type="text" v-model="searchTerm" placeholder="搜尋姓名/病歷號..." />
            <!-- ✨ 只有在顯示活躍病人時，才顯示頻率和狀態篩選器 -->
            <select v-if="patientStatusFilter === 'active'" v-model="filterFreq">
              <option value="">全部頻率</option>
              <option v-for="freq in FREQ_OPTIONS" :key="freq" :value="freq">{{ freq }}</option>
            </select>
            <div v-if="patientStatusFilter === 'active'" class="status-filters">
              <button
                v-for="status in STATUS_OPTIONS"
                :key="status.value"
                :class="{ active: filterStatus === status.value }"
                @click="filterStatus = status.value"
              >
                {{ status.text }}
              </button>
            </div>
          </div>
          <div class="patient-list-container">
            <ul v-if="filteredPatients.length > 0" class="patient-list">
              <li
                v-for="patient in filteredPatients"
                :key="patient.id"
                class="patient-list-item"
                :class="{ selected: selectedPatientId === patient.id }"
                @click="selectPatient(patient.id)"
              >
                <div class="patient-info">
                  <span class="patient-name">{{ patient.name }}</span>
                  <span class="patient-mrn">({{ patient.medicalRecordNumber }})</span>
                </div>
                <div class="patient-tags">
                  <span v-if="patient.freq" class="tag freq-tag">{{ patient.freq }}</span>
                  <!-- ✨ 在刪除模式下，顯示原始狀態和刪除原因 -->
                  <span
                    v-if="patientStatusFilter === 'deleted'"
                    class="tag status-tag status-deleted"
                  >
                    {{ statusMap[patient.originalStatus] || '未知' }} ({{
                      patient.deleteReason || '未註明'
                    }})
                  </span>
                  <span v-else class="tag status-tag" :class="`status-${patient.status}`">
                    {{ statusMap[patient.status] || '未知' }}
                  </span>
                </div>
              </li>
            </ul>
            <div v-else class="empty-state">
              <p>找不到符合條件的病人。</p>
            </div>
          </div>
        </main>
        <footer class="dialog-footer">
          <button class="btn btn-secondary" @click="onCancel">取消</button>
          <button
            v-if="showFillOptions"
            class="btn btn-info"
            @click="onConfirm('single')"
            :disabled="!selectedPatientId"
          >
            單次填入
          </button>
          <button
            v-if="showFillOptions"
            class="btn btn-primary"
            @click="onConfirm('frequency')"
            :disabled="!selectedPatientId"
          >
            依頻率填入
          </button>
          <button
            v-if="!showFillOptions"
            class="btn btn-primary"
            @click="onConfirm()"
            :disabled="!selectedPatientId"
          >
            確認
          </button>
        </footer>
      </div>
    </div>
  </Transition>
</template>

<script setup>
import { ref, computed, watch } from 'vue'

const props = defineProps({
  isVisible: Boolean,
  title: {
    type: String,
    default: '選擇項目',
  },
  patients: {
    type: Array,
    required: true,
  },
  showFillOptions: {
    type: Boolean,
    default: false,
  },
  // ✨ 1. 新增 prop，用來決定要顯示的病人狀態
  patientStatusFilter: {
    type: String,
    default: 'active', // 'active', 'deleted', 'all'
  },
})

const emit = defineEmits(['confirm', 'cancel'])

const searchTerm = ref('')
const filterFreq = ref('')
const filterStatus = ref('all')
const selectedPatientId = ref(null)

const FREQ_OPTIONS = [
  '一三五',
  '二四六',
  '一四',
  '二五',
  '三六',
  '一五',
  '二六',
  '每周一次',
  '臨時',
]
const STATUS_OPTIONS = [
  { value: 'all', text: '全部' },
  { value: 'er', text: '急診' },
  { value: 'ipd', text: '住院' },
  { value: 'opd', text: '門診' },
]
const statusMap = { er: '急', ipd: '住', opd: '門' }

// ✨ 2. 修改 computed 屬性，讓它根據新的 prop 來篩選病人
const filteredPatients = computed(() => {
  let result

  // 根據 patientStatusFilter 決定初始列表
  if (props.patientStatusFilter === 'deleted') {
    result = props.patients.filter((p) => p.isDeleted)
  } else {
    // 'active' 或 'all'
    result = props.patients.filter((p) => !p.isDeleted && !p.isDiscontinued)
  }

  // 只有在 active 模式下才應用狀態和頻率篩選
  if (props.patientStatusFilter === 'active') {
    if (filterStatus.value !== 'all') {
      result = result.filter((p) => p.status === filterStatus.value)
    }
    if (filterFreq.value) {
      result = result.filter((p) => p.freq === filterFreq.value)
    }
  }

  // 應用通用搜尋
  if (searchTerm.value) {
    const term = searchTerm.value.toLowerCase()
    result = result.filter(
      (p) =>
        p.name.toLowerCase().includes(term) ||
        (p.medicalRecordNumber && p.medicalRecordNumber.includes(term)),
    )
  }

  // 排序
  if (props.patientStatusFilter === 'deleted') {
    // 對已刪除病人按刪除日期倒序排
    return result.sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt))
  } else {
    // 對活躍病人按姓名排序
    return result.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
  }
})

function selectPatient(patientId) {
  selectedPatientId.value = patientId
}

function onConfirm(fillType = null) {
  if (selectedPatientId.value) {
    const payload = { patientId: selectedPatientId.value }
    if (fillType) {
      payload.fillType = fillType
    }
    emit('confirm', payload)
  }
}

function onCancel() {
  emit('cancel')
}

watch(
  () => props.isVisible,
  (val) => {
    if (val) {
      searchTerm.value = ''
      filterFreq.value = ''
      filterStatus.value = 'all'
      selectedPatientId.value = null
    }
  },
)
</script>

<style scoped>
/* (樣式區塊保持不變) */
.dialog-footer {
  padding: 1.5rem;
  border-top: 1px solid #e9ecef;
  display: flex;
  justify-content: flex-end;
  gap: 1rem;
}
.btn {
  padding: 0.5rem 1.5rem;
  border-radius: 6px;
  border: 1px solid transparent;
  cursor: pointer;
  font-weight: 500;
  font-size: 1rem;
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn-primary {
  background-color: #007bff;
  color: white;
}
.btn-info {
  background-color: #17a2b8;
  color: white;
}
.btn-secondary {
  background-color: #6c757d;
  color: white;
}
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
  z-index: 1050;
}
.dialog-content {
  background: white;
  border-radius: 8px;
  box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
  width: 90%;
  max-width: 600px;
  display: flex;
  flex-direction: column;
  max-height: 80vh;
}
.dialog-header {
  padding: 1.5rem;
  border-bottom: 1px solid #e9ecef;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.dialog-header h2 {
  margin: 0;
  font-size: 1.5rem;
}
.close-button {
  border: none;
  background: none;
  font-size: 2rem;
  cursor: pointer;
  color: #6c757d;
}
.dialog-body {
  padding: 1.5rem;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.search-controls {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  margin-bottom: 1rem;
}
.search-controls input,
.search-controls select {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid #ced4da;
  border-radius: 6px;
  font-size: 1rem;
  box-sizing: border-box;
}
.status-filters {
  grid-column: 1 / -1;
  display: flex;
  border: 1px solid #ced4da;
  border-radius: 6px;
  overflow: hidden;
}
.status-filters button {
  flex-grow: 1;
  padding: 0.75rem;
  border: none;
  background-color: #fff;
  cursor: pointer;
  font-size: 1rem;
  transition: background-color 0.2s;
  border-right: 1px solid #ced4da;
}
.status-filters button:last-child {
  border-right: none;
}
.status-filters button.active {
  background-color: #007bff;
  color: white;
}
.status-filters button:not(.active):hover {
  background-color: #f8f9fa;
}
.patient-list-container {
  border: 1px solid #e9ecef;
  border-radius: 6px;
  min-height: 200px;
  max-height: 400px;
  overflow-y: auto;
}
.patient-list {
  list-style-type: none;
  margin: 0;
  padding: 0;
}
.patient-list-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid #e9ecef;
  cursor: pointer;
  transition: background-color 0.2s;
}
.patient-list-item:last-child {
  border-bottom: none;
}
.patient-list-item:hover {
  background-color: #f8f9fa;
}
.patient-list-item.selected {
  background-color: #e7f3ff;
  font-weight: bold;
  color: #0056b3;
}
.patient-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.patient-name {
  font-size: 1.1rem;
}
.patient-mrn {
  color: #6c757d;
  font-size: 0.9rem;
}
.patient-tags {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.tag {
  padding: 0.2em 0.6em;
  border-radius: 10px;
  font-size: 0.85em;
  font-weight: 600;
  color: white;
  white-space: nowrap;
}
.freq-tag {
  background-color: #17a2b8;
}
.status-tag {
  min-width: 24px;
  text-align: center;
}
.status-tag.status-opd {
  background-color: #28a745;
}
.status-tag.status-ipd {
  background-color: #dc3545;
}
.status-tag.status-er {
  background-color: #6f42c1;
}
/* ✨ 新增已刪除狀態的 tag 樣式 */
.status-tag.status-deleted {
  background-color: #6c757d;
  color: #fff;
}
.empty-state {
  padding: 2rem;
  text-align: center;
  color: #6c757d;
}
.dialog-fade-enter-active,
.dialog-fade-leave-active {
  transition: opacity 0.3s ease;
}
.dialog-fade-enter-from,
.dialog-fade-leave-to {
  opacity: 0;
}
</style>
