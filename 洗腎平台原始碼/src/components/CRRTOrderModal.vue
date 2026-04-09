<!-- 檔案路徑: src/components/CRRTOrderModal.vue (最終使用者姓名修正版) -->
<template>
  <div v-if="isVisible" class="modal-overlay" v-overlay-close="closeModal">
    <div class="modal-container">
      <header class="modal-header">
        <h2>CRRT 醫囑開立</h2>
        <button @click="closeModal" class="btn-close">×</button>
      </header>

      <div class="modal-body">
        <!-- 病人基本資訊 -->
        <section class="info-section">
          <div class="patient-info-compact">
            <span class="info-item"><strong>姓名：</strong>{{ patientData?.name || 'N/A' }}</span>
            <span class="info-item"
              ><strong>病歷號：</strong>{{ patientData?.medicalRecordNumber || 'N/A' }}</span
            >
            <span class="info-item"
              ><strong>床號：</strong>{{ patientData?.wardNumber || 'N/A' }}</span
            >
            <span class="info-item"
              ><strong>年齡：</strong>{{ calculateAge(patientData?.dateOfBirth) }} 歲</span
            >
          </div>
        </section>

        <!-- 醫師資訊與備註 -->
        <section class="physician-section">
          <div class="physician-grid">
            <div class="form-group">
              <label for="physician" class="required">開立/修正醫師：</label>
              <input
                id="physician"
                type="text"
                v-model="formData.physician"
                class="form-control"
                disabled
              />
            </div>
            <div class="form-group">
              <label for="notes">備註：</label>
              <textarea
                id="notes"
                v-model="formData.notes"
                class="form-control"
                rows="1"
                placeholder="其他注意事項..."
              ></textarea>
            </div>
          </div>
        </section>

        <!-- CRRT 參數設定 -->
        <section class="parameters-section">
          <h3>CRRT 參數設定</h3>
          <div class="form-grid">
            <div class="form-group">
              <label for="mode" class="required">模式：</label
              ><select id="mode" v-model="formData.mode" class="form-control">
                <option value="">請選擇</option>
                <option value="CVVH">CVVH</option>
                <option value="CVVHDF">CVVHDF</option>
                <option value="CVVHD">CVVHD</option>
              </select>
            </div>
            <div class="form-group">
              <label for="weight" class="required">體重 (kg)：</label
              ><input
                id="weight"
                type="number"
                v-model.number="formData.weight"
                class="form-control"
                min="0"
                step="0.1"
                placeholder="輸入體重"
              />
            </div>
            <!-- ✨✨✨ 1. 新增血液流速 (Blood Flow) 輸入欄位 ✨✨✨ -->
            <div class="form-group">
              <label for="bloodFlow">血液流速 (ml/min)：</label>
              <input
                id="bloodFlow"
                type="number"
                v-model.number="formData.bloodFlow"
                class="form-control"
                min="0"
                step="10"
                placeholder="Blood Flow"
              />
            </div>
            <div class="form-group">
              <label for="pbp">PBP (ml/hr)：</label
              ><input
                id="pbp"
                type="number"
                v-model.number="formData.pbp"
                class="form-control"
                min="0"
                step="10"
                placeholder="Pre-blood pump 流速"
              />
            </div>
            <div class="form-group">
              <label for="dialysateFlow">透析液流速 (ml/hr)：</label
              ><input
                id="dialysateFlow"
                type="number"
                v-model.number="formData.dialysateFlowRate"
                class="form-control"
                min="0"
                step="50"
                placeholder="0"
              />
            </div>
            <div class="form-group">
              <label for="replacementFlow">補充液流速 (ml/hr)：</label
              ><input
                id="replacementFlow"
                type="number"
                v-model.number="formData.replacementFlowRate"
                class="form-control"
                min="0"
                step="50"
                placeholder="0"
              />
            </div>
            <div class="form-group">
              <label for="dilutionRatio">前/後稀釋比例：</label
              ><input
                id="dilutionRatio"
                type="text"
                v-model="formData.dilutionRatio"
                class="form-control"
                placeholder="例：50/50 或 前稀釋"
              />
            </div>
            <div class="form-group">
              <label for="heparin">Heparin：</label
              ><input
                id="heparin"
                type="text"
                v-model="formData.heparin"
                class="form-control"
                placeholder="抗凝劑設定"
              />
            </div>

            <div class="form-group dehydration-group">
              <label for="dehydrationRateLower">脫水速率 (ml/hr)：</label>
              <div class="dehydration-range-inputs">
                <input
                  id="dehydrationRateLower"
                  type="number"
                  v-model.number="formData.dehydrationRateLower"
                  class="form-control"
                  min="0"
                  step="10"
                  placeholder="下限"
                />
                <span>-</span>
                <input
                  id="dehydrationRateUpper"
                  type="number"
                  v-model.number="formData.dehydrationRateUpper"
                  class="form-control"
                  min="0"
                  step="10"
                  placeholder="上限"
                />
              </div>
            </div>

            <div class="form-group">
              <label>是否加 KCL：</label>
              <div class="radio-group">
                <label class="radio-label"
                  ><input type="radio" v-model="formData.addKCL" :value="true" />是</label
                ><label class="radio-label"
                  ><input type="radio" v-model="formData.addKCL" :value="false" />否</label
                >
              </div>
            </div>
          </div>
        </section>

        <!-- 計算輔助區 -->
        <section class="calculation-section">
          <h3>計算輔助</h3>
          <div class="calculation-grid">
            <div class="calc-item">
              <label>總液體移除率：</label
              ><span class="calc-value">{{ totalFluidRemoval }} ml/hr</span>
            </div>
            <div class="calc-item">
              <label>劑量 (ml/kg/hr)：</label><span class="calc-value">{{ dosePerKg }}</span>
            </div>
            <div class="calc-item">
              <label>建議劑量範圍：</label><span class="calc-info">20-35 ml/kg/hr</span>
            </div>
          </div>
          <div class="formula-display">
            <strong>計算公式：</strong>
            <div class="formula">
              總液體移除率 = PBP流速 + 透析液流速 + 補充液流速 + 脫水速率(上限)
            </div>
            <div class="formula">劑量 = 總液體移除率 ÷ 體重</div>
          </div>
        </section>

        <!-- 歷史紀錄 -->
        <section class="history-section" v-if="orderHistory && orderHistory.length > 0">
          <h3>修改紀錄</h3>
          <div class="history-list">
            <div v-for="(record, index) in orderHistory" :key="index" class="history-item">
              <span class="history-time">{{ formatDateTime(record.timestamp) }}</span>
              <span class="history-physician">{{ record.physician }}</span>
              <span class="history-action">{{ record.action }}</span>
            </div>
          </div>
        </section>
      </div>

      <footer class="modal-footer">
        <button @click="closeModal" class="btn btn-secondary">取消</button>
        <button @click="handleSave" class="btn btn-primary" :disabled="!isFormValid">
          儲存醫囑
        </button>
      </footer>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useAuth } from '@/composables/useAuth'

const props = defineProps({
  isVisible: Boolean,
  patientData: Object,
  orderHistory: Array,
  // 雖然醫師是自動帶入，但保留這個 prop 以防未來需要顯示醫師列表
  physicianList: {
    type: Array,
    default: () => [],
  },
})

const emit = defineEmits(['close', 'save'])
const closeModal = () => emit('close')

const auth = useAuth()

const createDefaultFormData = () => ({
  mode: '',
  weight: null,
  bloodFlow: null,
  pbp: null,
  dialysateFlowRate: null,
  replacementFlowRate: null,
  dilutionRatio: '',
  heparin: '',
  dehydrationRateLower: null,
  dehydrationRateUpper: null,
  addKCL: false,
  // ✅ [核心修正] 根據您提供的線索，將 .displayName 改為 .name
  physician: auth.currentUser.value?.name || '',
  notes: '',
})

const formData = ref(createDefaultFormData())

const totalFluidRemoval = computed(() => {
  const pbp = formData.value.pbp || 0
  const dialysate = formData.value.dialysateFlowRate || 0
  const replacement = formData.value.replacementFlowRate || 0
  const dehydration = formData.value.dehydrationRateUpper || 0
  return pbp + dialysate + replacement + dehydration
})

const dosePerKg = computed(() => {
  if (!formData.value.weight || formData.value.weight <= 0) return 'N/A'
  const dose = totalFluidRemoval.value / formData.value.weight
  return `${dose.toFixed(1)} ml/kg/hr`
})

const isFormValid = computed(() => {
  return formData.value.mode && formData.value.weight > 0 && formData.value.physician
})

const calculateAge = (dateOfBirth) => {
  if (!dateOfBirth) return 'N/A'
  const birth = new Date(dateOfBirth)
  const today = new Date()
  let age = today.getFullYear() - birth.getFullYear()
  const m = today.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--
  return age
}

const formatDateTime = (timestamp) => {
  if (!timestamp) return ''
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp)
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

const handleSave = () => {
  if (!isFormValid.value) {
    alert('請填寫必要欄位')
    return
  }
  const orderData = {
    ...formData.value,
    timestamp: new Date(),
    isModified: !!props.patientData?.crrtOrders,
  }
  emit('save', orderData)
}

const initializeForm = () => {
  const defaultValues = createDefaultFormData()
  if (props.patientData?.crrtOrders) {
    formData.value = {
      ...defaultValues,
      ...props.patientData.crrtOrders,
      // ✅ [核心修正] 確保編輯時也使用 .name
      physician: auth.currentUser.value?.name || '',
    }
  } else {
    formData.value = defaultValues
  }
}

watch(
  () => props.isVisible,
  async (newVal) => {
    if (newVal) {
      await auth.waitForAuthInit()
      initializeForm()
    }
  },
)
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.6);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 2000;
}
.modal-container {
  background-color: white;
  width: 90%;
  max-width: 900px;
  height: 90vh;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
}
.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.25rem 1.5rem;
  border-bottom: 2px solid #e9ecef;
  background-color: #f8f9fa;
  border-radius: 8px 8px 0 0;
}
.modal-header h2 {
  margin: 0;
  font-size: 1.5rem;
  color: #212529;
}
.btn-close {
  background: none;
  border: none;
  font-size: 2rem;
  font-weight: bold;
  cursor: pointer;
  color: #6c757d;
  padding: 0;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.2s;
}
.btn-close:hover {
  color: #000;
}
.modal-body {
  flex-grow: 1;
  overflow-y: auto;
  padding: 1.5rem;
}

.info-section {
  margin-bottom: 1.5rem;
}
.physician-section {
  margin-bottom: 2rem;
}
.parameters-section,
.calculation-section,
.history-section {
  margin-bottom: 2rem;
}

h3 {
  margin-top: 0;
  margin-bottom: 1rem;
  font-size: 1.2rem;
  color: #495057;
  border-bottom: 1px solid #dee2e6;
  padding-bottom: 0.5rem;
}

.patient-info-compact {
  display: flex;
  flex-wrap: wrap;
  gap: 1.5rem;
  background-color: #f8f9fa;
  padding: 0.75rem 1rem;
  border-radius: 6px;
}
.info-item {
  font-size: 1rem;
}

.physician-grid {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 1.25rem;
  align-items: flex-end;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1.25rem;
}
.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.form-group label {
  font-weight: 600;
  color: #495057;
  font-size: 0.95rem;
}
.form-group label.required::after {
  content: ' *';
  color: #dc3545;
}
.form-control {
  padding: 0.5rem 0.75rem;
  border: 1px solid #ced4da;
  border-radius: 4px;
  font-size: 1rem;
  transition: border-color 0.15s;
}
.form-control:focus {
  outline: none;
  border-color: #007bff;
  box-shadow: 0 0 0 0.2rem rgba(0, 123, 255, 0.25);
}
input.form-control:disabled {
  background-color: #e9ecef;
  opacity: 1;
  cursor: not-allowed;
  color: #212529; /* 確保文字顏色清晰 */
}

textarea.form-control {
  resize: none;
}

.dehydration-group {
  grid-column: span 2;
}
.dehydration-range-inputs {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 0.5rem;
}
.dehydration-range-inputs span {
  font-weight: bold;
  color: #6c757d;
}

.radio-group {
  display: flex;
  gap: 1.5rem;
  align-items: center;
  height: 100%;
}
.radio-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  font-weight: normal;
}
.radio-label input[type='radio'] {
  cursor: pointer;
}

.calculation-section {
  background-color: #e7f3ff;
  padding: 1.25rem;
  border-radius: 6px;
  border: 1px solid #b3d9ff;
}
.calculation-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
  margin-bottom: 1rem;
}
.calc-item label {
  font-weight: 600;
  color: #0056b3;
}
.calc-value {
  font-size: 1.1rem;
  font-weight: bold;
  color: #004085;
}
.calc-info {
  color: #004085;
  font-style: italic;
}
.formula-display {
  font-size: 0.9rem;
  color: #004085;
}
.formula {
  margin-left: 1em;
}

.history-section {
  background-color: #f8f9fa;
  padding: 1rem;
  border-radius: 6px;
}
.history-list {
  max-height: 150px;
  overflow-y: auto;
}
.history-item {
  display: grid;
  grid-template-columns: 150px 120px 1fr;
  gap: 1rem;
  padding: 0.5rem;
  border-bottom: 1px solid #dee2e6;
}
.history-item:last-child {
  border-bottom: none;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 1rem;
  padding: 1.25rem 1.5rem;
  border-top: 2px solid #e9ecef;
  background-color: #f8f9fa;
  border-radius: 0 0 8px 8px;
}
.btn {
  padding: 0.6rem 1.5rem;
  font-size: 1rem;
  border-radius: 5px;
  cursor: pointer;
  border: none;
  transition: all 0.2s;
  font-weight: 500;
}
.btn-primary {
  background-color: #007bff;
  color: white;
}
.btn-primary:hover:not(:disabled) {
  background-color: #0056b3;
}
.btn-primary:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}
.btn-secondary {
  background-color: #6c757d;
  color: white;
}
.btn-secondary:hover {
  background-color: #545b62;
}

@media (max-width: 992px) {
  .form-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .physician-grid {
    grid-template-columns: 1fr;
  }
  .dehydration-group {
    grid-column: span 1;
  }
}

/* === 行動版優化 === */
@media (max-width: 768px) {
  .modal-overlay {
    padding: 0;
  }

  .modal-container {
    width: 100%;
    height: 100vh;
    max-width: 100%;
    max-height: 100vh;
    border-radius: 0;
  }

  .modal-header {
    position: sticky;
    top: 0;
    z-index: 100;
    background-color: white;
  }

  .modal-header h2 {
    font-size: 1.1rem;
  }

  .modal-body {
    padding: 1rem 0.75rem;
  }

  /* 病人資訊精簡顯示 */
  .patient-info-compact {
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    font-size: 0.9rem;
  }

  /* 醫師資訊單欄 */
  .physician-grid {
    grid-template-columns: 1fr;
    gap: 0.75rem;
  }

  /* 參數設定單欄 */
  .form-grid {
    grid-template-columns: 1fr;
    gap: 0.75rem;
  }

  .form-control {
    min-height: 44px;
    font-size: 1rem;
  }

  /* 脫水速率輸入優化 */
  .dehydration-group {
    grid-column: 1 / -1;
  }

  .dehydration-range-inputs {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: 0.5rem;
  }

  /* 計算輔助區優化 */
  .calculation-section {
    padding: 1rem 0.75rem;
    margin: 0 -0.75rem;
  }

  .calculation-grid {
    grid-template-columns: 1fr;
    gap: 0.5rem;
  }

  .formula-display {
    font-size: 0.8rem;
  }

  .formula {
    margin: 0.5rem 0;
    padding: 0.5rem;
    background-color: white;
    border-radius: 4px;
    word-break: break-all;
  }

  /* 歷史紀錄優化 */
  .history-section {
    padding: 0.75rem;
    margin: 0 -0.75rem;
  }

  .history-list {
    max-height: 120px;
  }

  .history-item {
    grid-template-columns: 1fr;
    gap: 0.25rem;
    padding: 0.5rem;
    font-size: 0.85rem;
  }

  .history-time,
  .history-physician,
  .history-action {
    display: block;
  }

  /* 頁尾按鈕 */
  .modal-footer {
    position: sticky;
    bottom: 0;
    flex-direction: row;
    gap: 0.5rem;
  }

  .modal-footer .btn {
    flex: 1;
    min-height: 44px;
  }
}
</style>
