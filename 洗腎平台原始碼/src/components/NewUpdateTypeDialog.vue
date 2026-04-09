<!-- 檔案路徑: src/components/NewUpdateTypeDialog.vue (完整修正版) -->
<template>
  <div v-if="isVisible" class="dialog-overlay" v-overlay-close="close">
    <div class="dialog-content">
      <header class="dialog-header">
        <h2>發起新的預約變更</h2>
        <button class="close-button" @click="close">×</button>
      </header>
      <main class="dialog-body">
        <fieldset class="step-group">
          <legend>步驟 1: 選擇變更類型</legend>
          <div class="form-group">
            <!-- ✨ 順序調整：先選類型 -->
            <select v-model="selectedChangeType">
              <option disabled value="">請選擇...</option>
              <option value="UPDATE_STATUS">身分變更 (門/急/住)</option>
              <option value="UPDATE_MODE">透析模式變更</option>
              <option value="UPDATE_FREQ">透析頻率變更</option>
              <option value="UPDATE_BASE_SCHEDULE_RULE">總表規則變更 (床位/班別)</option>
              <option value="DELETE_PATIENT">預約刪除病人</option>
              <option value="RESTORE_PATIENT">預約復原病人</option>
            </select>
          </div>
        </fieldset>

        <fieldset class="step-group" :class="{ disabled: !selectedChangeType }">
          <legend>步驟 2: 選擇病人</legend>
          <button
            class="select-btn"
            @click="isPatientDialogVisible = true"
            :disabled="!selectedChangeType"
          >
            <span v-if="selectedPatient"
              >{{ selectedPatient.name }} ({{ selectedPatient.medicalRecordNumber }})</span
            >
            <span v-else class="text-muted">點擊以選擇病人...</span>
          </button>
        </fieldset>
      </main>
      <footer class="dialog-footer">
        <button class="btn btn-secondary" @click="close">取消</button>
        <button class="btn btn-primary" @click="handleContinue" :disabled="!isValid">下一步</button>
      </footer>
    </div>
  </div>

  <PatientSelectDialog
    :is-visible="isPatientDialogVisible"
    :patients="allPatients"
    :show-fill-options="false"
    :title="patientDialogTitle"
    :patient-status-filter="patientDialogFilter"
    @confirm="handlePatientSelected"
    @cancel="isPatientDialogVisible = false"
  />
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import PatientSelectDialog from '@/components/PatientSelectDialog.vue'

const props = defineProps({
  isVisible: Boolean,
  allPatients: Array,
})
const emit = defineEmits(['close', 'continue'])

const isPatientDialogVisible = ref(false)
const selectedPatient = ref(null)
const selectedChangeType = ref('')

// ✨ computed 屬性，根據選擇的類型動態改變傳給 Dialog 的 prop
const patientDialogFilter = computed(() => {
  return selectedChangeType.value === 'RESTORE_PATIENT' ? 'deleted' : 'active'
})

const patientDialogTitle = computed(() => {
  return selectedChangeType.value === 'RESTORE_PATIENT' ? '選擇要復原的病人' : '選擇病人'
})

const isValid = computed(() => selectedPatient.value && selectedChangeType.value)

watch(
  () => props.isVisible,
  (newVal) => {
    if (newVal) {
      selectedPatient.value = null
      selectedChangeType.value = ''
    }
  },
)

// ✨ 當變更類型改變時，清空已選擇的病人，因為列表不同了
watch(selectedChangeType, () => {
  selectedPatient.value = null
})

function close() {
  emit('close')
}

function handlePatientSelected({ patientId }) {
  // ✨ 從 allPatients (包含已刪除) 中尋找
  selectedPatient.value = props.allPatients.find((p) => p.id === patientId)
  isPatientDialogVisible.value = false
}

function handleContinue() {
  if (isValid.value) {
    emit('continue', {
      patient: selectedPatient.value,
      changeType: selectedChangeType.value,
    })
  }
}
</script>

<style scoped>
/* ... (樣式保持不變) ... */
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
  z-index: 1010;
}
.dialog-content {
  background: #fff;
  border-radius: 12px;
  width: 100%;
  max-width: 500px;
}
.dialog-header {
  padding: 1rem 1.5rem;
  border-bottom: 1px solid #e9ecef;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.dialog-header h2 {
  margin: 0;
  font-size: 1.25rem;
}
.close-button {
  border: none;
  background: none;
  font-size: 1.5rem;
  cursor: pointer;
  color: #888;
}
.dialog-body {
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}
.dialog-footer {
  padding: 1rem 1.5rem;
  border-top: 1px solid #e9ecef;
  display: flex;
  justify-content: flex-end;
  gap: 1rem;
}
.btn {
  padding: 0.6rem 1.2rem;
  border-radius: 8px;
  border: 1px solid transparent;
  cursor: pointer;
  font-weight: 500;
}
.btn-primary {
  background-color: #007bff;
  color: white;
}
.btn-secondary {
  background-color: #6c757d;
  color: white;
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.step-group {
  border: 1px solid #dee2e6;
  border-radius: 8px;
  padding: 1.5rem;
  margin: 0;
}
.step-group.disabled {
  opacity: 0.5;
  pointer-events: none;
}
.step-group legend {
  font-weight: 600;
  color: #0056b3;
  padding: 0 0.5rem;
}
.form-group select {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid #ced4da;
  border-radius: 6px;
  font-size: 1rem;
}
.select-btn {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid #ced4da;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  text-align: left;
  font-size: 1rem;
}
.text-muted {
  color: #6c757d;
}
</style>
