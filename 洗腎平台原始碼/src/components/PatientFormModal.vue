<!-- 檔案路徑: src/components/PatientFormModal.vue (✨ UI 緊湊版 ✨) -->
<template>
  <Transition name="modal-fade">
    <div v-if="isModalVisible" class="modal-overlay" v-overlay-close="closeModal">
      <div class="modal-content">
        <div class="modal-header">
          <h2>{{ isEditing ? '編輯' : '新增' }} {{ patientTypeText }}病人</h2>
          <button class="close-button" @click="closeModal" aria-label="關閉彈窗">×</button>
        </div>
        <form class="modal-body" @submit.prevent="handleSave">
          <!-- 基本資料區 (不變) -->
          <div class="form-section">
            <div class="form-grid-3-col">
              <div class="form-field">
                <label for="name">姓名</label
                ><input type="text" id="name" v-model="form.name" required />
              </div>
              <div class="form-field">
                <label for="medical-record-number">病歷號</label
                ><input
                  type="text"
                  id="medical-record-number"
                  v-model="form.medicalRecordNumber"
                  required
                />
              </div>
              <div class="form-field">
                <label>{{ patientType === 'opd' ? '收案醫師' : '會診醫師' }}</label
                ><select v-model="form.physician">
                  <option disabled value="">請選擇</option>
                  <option v-for="p in PHYSICIANS" :key="p" :value="p">{{ p }}</option>
                </select>
              </div>
              <div class="form-field">
                <label for="freq">透析頻率</label
                ><select id="freq" v-model="form.freq">
                  <option disabled value="">請選擇</option>
                  <option v-for="f in FREQ_OPTIONS" :key="f" :value="f">{{ f }}</option>
                </select>
              </div>
              <div class="form-field">
                <label for="mode">透析模式</label
                ><select id="mode" v-model="form.mode">
                  <option disabled value="">請選擇</option>
                  <option v-for="m in MODES" :key="m" :value="m">{{ m }}</option>
                </select>
              </div>
              <div class="form-field">
                <label for="status">病人狀態</label
                ><select id="status" v-model="form.status" :disabled="isEditing">
                  <option value="er">急診</option>
                  <option value="ipd">住院</option>
                  <option value="opd">門診</option>
                </select>
              </div>
              <div class="form-field">
                <label>病人身份</label>
                <div class="radio-group">
                  <label>
                    <input type="radio" v-model="form.patientCategory" value="opd_regular" />
                    <span>常規門診病人</span>
                  </label>
                  <label>
                    <input type="radio" v-model="form.patientCategory" value="non_regular" />
                    <span>非固定病人</span>
                  </label>
                </div>
              </div>
            </div>
          </div>

          <!-- ✨ 核心修正: 門診/非門診的條件渲染 -->
          <template v-if="patientType === 'opd'">
            <div class="form-section">
              <div class="opd-extra-grid">
                <div class="form-field">
                  <label for="vasc-access">目前血管通路</label
                  ><select id="vasc-access" v-model="form.vascAccess">
                    <option disabled value="">請選擇</option>
                    <option v-for="va in VASC_ACCESSES" :key="va" :value="va">{{ va }}</option>
                  </select>
                </div>
                <div class="form-field">
                  <label for="first-dialysis-date">首次透析日期</label
                  ><input type="date" id="first-dialysis-date" v-model="form.firstDialysisDate" />
                </div>
                <div class="form-field">
                  <label for="access-creation-date">通路建立日期</label
                  ><input type="date" id="access-creation-date" v-model="form.accessCreationDate" />
                </div>
                <div class="form-field">
                  <label for="hospital-info">透析院所</label>
                  <div class="hospital-input-group">
                    <input
                      type="text"
                      id="hospital-source"
                      v-model="form.hospitalInfo.source"
                      placeholder="原透析院所"
                    />
                    <div class="divider-line"></div>
                    <input
                      type="text"
                      id="hospital-transfer-out"
                      v-model="form.hospitalInfo.transferOut"
                      placeholder="轉出院所"
                    />
                  </div>
                </div>
                <div class="form-field dialysis-reason-opd">
                  <label for="dialysis-reason">透析原因</label
                  ><input type="text" id="dialysis-reason" v-model="form.dialysisReason" />
                </div>
                <div class="form-field remarks-opd">
                  <label for="remarks">備註</label
                  ><textarea id="remarks" rows="2" v-model="form.remarks"></textarea>
                </div>
              </div>
            </div>
          </template>
          <template v-else>
            <div class="form-section">
              <div class="form-field">
                <label for="hospital-info">透析院所</label>
                <div class="hospital-input-group">
                  <input
                    type="text"
                    id="hospital-source"
                    v-model="form.hospitalInfo.source"
                    placeholder="原透析院所"
                  />
                  <div class="divider-line"></div>
                  <input
                    type="text"
                    id="hospital-transfer-out"
                    v-model="form.hospitalInfo.transferOut"
                    placeholder="轉出院所"
                  />
                </div>
              </div>
            </div>
            <div class="form-section">
              <div class="form-grid-2-col">
                <div class="form-field">
                  <label for="inpatient-reason">住院原因</label
                  ><input type="text" id="inpatient-reason" v-model="form.inpatientReason" />
                </div>
                <div class="form-field">
                  <label for="dialysis-reason">透析原因</label
                  ><input type="text" id="dialysis-reason" v-model="form.dialysisReason" />
                </div>
              </div>
              <div class="form-field">
                <label for="remarks">備註</label
                ><textarea id="remarks" rows="2" v-model="form.remarks"></textarea>
              </div>
            </div>
          </template>

          <!-- 疾病與狀態標記區 (不變) -->
          <div class="form-section">
            <fieldset class="form-group">
              <legend>須注意疾病</legend>
              <div class="custom-checkbox-container">
                <div
                  v-for="d in DISEASES"
                  :key="d"
                  class="custom-checkbox"
                  :class="{
                    selected: form.diseases?.includes(d),
                    [`disease-${d.toLowerCase()}`]: form.diseases?.includes(d),
                  }"
                  @click="toggleDisease(d)"
                >
                  {{ d }}
                </div>
              </div>
            </fieldset>
            <fieldset v-if="form.patientStatus" class="form-group">
              <legend>狀態標記</legend>
              <div class="custom-checkbox-container">
                <div
                  class="status-date-tag"
                  :class="{ active: form.patientStatus.isFirstDialysis.active }"
                  @click="toggleStatus('isFirstDialysis')"
                >
                  <span>首透</span
                  ><input
                    v-if="form.patientStatus.isFirstDialysis.active"
                    type="date"
                    v-model="form.patientStatus.isFirstDialysis.date"
                    @click.stop
                  />
                </div>
                <div
                  class="status-date-tag"
                  :class="{ active: form.patientStatus.isPaused.active }"
                  @click="toggleStatus('isPaused')"
                >
                  <span>暫停透析</span
                  ><input
                    v-if="form.patientStatus.isPaused.active"
                    type="date"
                    v-model="form.patientStatus.isPaused.date"
                    @click.stop
                  />
                </div>
                <div
                  v-if="patientType !== 'opd'"
                  class="status-date-tag"
                  :class="{ active: form.patientStatus.hasBloodDraw.active }"
                  @click="toggleStatus('hasBloodDraw')"
                >
                  <span>已抽血</span
                  ><input
                    v-if="form.patientStatus.hasBloodDraw.active"
                    type="date"
                    v-model="form.patientStatus.hasBloodDraw.date"
                    @click.stop
                  />
                </div>
              </div>
            </fieldset>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn-secondary" @click="closeModal">取消</button
            ><button type="submit" class="btn-primary">儲存</button>
          </div>
        </form>
      </div>
    </div>
  </Transition>
</template>

<script setup>
import { ref, watch, computed } from 'vue'
const props = defineProps({
  isModalVisible: { type: Boolean, required: true },
  patientData: { type: Object, default: () => ({}) },
  patientType: { type: String, required: true },
})
const emit = defineEmits(['close', 'save'])
const form = ref({})
const PHYSICIANS = ['廖丁瑩', '蔡宜潔', '蘇哲弘', '蔡亨政', '陳怡汝']
const FREQ_OPTIONS = [
  '一三五',
  '二四六',
  '一四',
  '二五',
  '三六',
  '一五', // <-- 新增
  '二六', // <-- 新增
  '每日',
  '每周一',
  '每周二',
  '每周三',
  '每周四',
  '每周五',
  '每周六',
  '臨時',
]
const MODES = ['HD', 'SLED', 'CVVHDF', 'PP', 'DFPP', 'Lipid']
const VASC_ACCESSES = ['Double lumen', 'PERM', '左手AVF', '右手AVF', '左手AVG', '右手AVG']
const DISEASES = ['HIV', 'RPR', 'BC肝?', 'HBV', 'HCV', 'C肝治癒', 'COVID', '隔離']
const isEditing = computed(() => !!(form.value && form.value.id))
const patientTypeText = computed(() => {
  const map = { ipd: '住院', opd: '門診', er: '急診' }
  return map[props.patientType] || ''
})

function toggleDisease(disease) {
  const index = (form.value.diseases || []).indexOf(disease)
  if (index > -1) {
    form.value.diseases.splice(index, 1)
  } else {
    form.value.diseases.push(disease)
  }
}
function toggleStatus(key) {
  if (form.value.patientStatus && form.value.patientStatus[key]) {
    const status = form.value.patientStatus[key]
    status.active = !status.active
    if (!status.active) {
      status.date = null
    }
  }
}
function closeModal() {
  emit('close')
}
function handleSave() {
  if (!form.value.name || !form.value.medicalRecordNumber) {
    alert('姓名和病歷號為必填項！')
    return
  }
  emit('save', form.value)
}

watch(
  () => props.isModalVisible,
  (isVisible) => {
    if (isVisible) {
      document.body.classList.add('modal-open')
      const data = JSON.parse(JSON.stringify(props.patientData))

      if (!data.id) {
        // 只在「新增」病人時觸發
        data.status = props.patientType
        // ✅ [修正] 根據 patientType 設定不同的預設病人身份
        if (props.patientType === 'opd') {
          data.patientCategory = 'opd_regular' // 從門診新增，預設為「常規」
        } else {
          data.patientCategory = 'non_regular' // 從住院或急診新增，預設為「非固定」
        }
      }

      // 當「編輯」既有病人時，如果該病人沒有 patientCategory 欄位，給予一個預設值
      if (!data.patientCategory) {
        data.patientCategory = 'opd_regular'
      }

      // ✅ [修正] 確保 patientStatus 和其子屬性都有正確的預設值
      data.diseases = data.diseases || []
      const defaultPatientStatus = {
        isFirstDialysis: { active: false, date: null },
        isPaused: { active: false, date: null },
        hasBloodDraw: { active: false, date: null },
      }
      // 深度合併，確保即使 patientStatus 是空物件，子屬性也會被初始化
      data.patientStatus = {
        isFirstDialysis: { ...defaultPatientStatus.isFirstDialysis, ...(data.patientStatus?.isFirstDialysis || {}) },
        isPaused: { ...defaultPatientStatus.isPaused, ...(data.patientStatus?.isPaused || {}) },
        hasBloodDraw: { ...defaultPatientStatus.hasBloodDraw, ...(data.patientStatus?.hasBloodDraw || {}) },
      }
      data.hospitalInfo = data.hospitalInfo || { source: '', transferOut: '' }

      form.value = data
    } else {
      document.body.classList.remove('modal-open')
    }
  },
)
</script>

<style scoped>
:global(body.modal-open) {
  overflow: hidden;
}
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal-content {
  background-color: #fff;
  padding: 1.5rem;
  border: 1px solid #dee2e6;
  width: 90%;
  max-width: 900px;
  border-radius: 12px;
  box-shadow: 0 8px 25px rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
  max-height: 90vh;
}
.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #e9ecef;
  padding-bottom: 1rem;
  margin-bottom: 0;
  flex-shrink: 0;
}
.modal-header h2 {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
}
.close-button {
  background: none;
  border: none;
  font-size: 2rem;
  line-height: 1;
  color: #adb5bd;
  cursor: pointer;
  padding: 0;
  transition: color 0.2s;
}
.close-button:hover {
  color: #495057;
}
.modal-body {
  overflow-y: auto;
  padding: 0.5rem 1.5rem 0.5rem 0;
  margin-right: -1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.form-field {
  display: flex;
  flex-direction: column;
}
.form-field label {
  margin-bottom: 6px;
  font-weight: 500;
  color: #495057;
  font-size: 0.9rem;
}
.form-field input[type='text'],
.form-field input[type='date'],
.form-field select,
.form-field textarea {
  padding: 8px 12px;
  border: 1px solid #ced4da;
  border-radius: 6px;
  width: 100%;
  box-sizing: border-box;
  font-size: 1rem;
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
}
.form-field input:focus,
.form-field select:focus,
.form-field textarea:focus {
  outline: none;
  border-color: var(--primary-color, #007bff);
  box-shadow: 0 0 0 3px rgba(0, 123, 255, 0.2);
}
.form-group {
  border: none;
  padding: 0;
  margin: 0;
}
.form-group legend {
  padding: 0 8px;
  font-weight: 500;
  color: #495057;
  font-size: 0.95rem;
  margin-bottom: 10px;
  margin-left: -8px;
}
.custom-checkbox-container {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.custom-checkbox {
  padding: 6px 14px;
  border: 1px solid #ced4da;
  border-radius: 20px;
  cursor: pointer;
  -webkit-user-select: none;
  user-select: none;
  transition: all 0.2s ease-in-out;
  font-weight: 500;
  color: #495057;
  background-color: #fff;
  font-size: 0.9rem;
}
.custom-checkbox:hover {
  border-color: #adb5bd;
  background-color: #f8f9fa;
}
.custom-checkbox.selected {
  color: #fff;
  border-color: transparent;
  background-color: var(--primary-color, #007bff);
}
.custom-checkbox.selected.disease-bc肝\? {
  background-color: var(--danger-color, #dc3545);
}
.custom-checkbox.selected.disease-covid,
.custom-checkbox.selected.disease-hbv,
.custom-checkbox.selected.disease-hcv,
.custom-checkbox.selected.disease-hiv,
.custom-checkbox.selected.disease-rpr {
  background-color: var(--danger-color, #dc3545);
}
.custom-checkbox.selected.disease-隔離 {
  background-color: var(--warning-color, #ffc107);
  color: #212529;
}
.modal-footer {
  margin-top: auto;
  padding-top: 1rem;
  border-top: 1px solid #e9ecef;
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  flex-shrink: 0;
}
.modal-footer button {
  padding: 10px 24px;
  font-size: 1rem;
  font-weight: 500;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.2s;
}
.btn-primary {
  background-color: var(--primary-color, #007bff);
  color: #fff;
}
.btn-primary:hover {
  background-color: #0056b3;
}
.btn-secondary {
  background-color: #f8f9fa;
  color: #343a40;
  border: 1px solid #ced4da;
}
.btn-secondary:hover {
  background-color: #e9ecef;
}
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.3s ease;
}
.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}
.modal-fade-enter-active .modal-content,
.modal-fade-leave-active .modal-content {
  transition: transform 0.3s ease;
}
.modal-fade-enter-from .modal-content,
.modal-fade-leave-to .modal-content {
  transform: translateY(-20px);
}
.hospital-input-group {
  display: flex;
  align-items: center;
  border: 1px solid #ced4da;
  border-radius: 6px;
  overflow: hidden;
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
}
.hospital-input-group:focus-within {
  border-color: var(--primary-color, #007bff);
  box-shadow: 0 0 0 3px rgba(0, 123, 255, 0.2);
}
.hospital-input-group input {
  border: none;
  flex: 1;
  min-width: 0;
}
.hospital-input-group input:focus {
  outline: none;
  box-shadow: none;
}
.divider-line {
  width: 1px;
  background-color: #ced4da;
  align-self: stretch;
  margin: 4px 0;
}
.status-date-tag {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border: 1px solid #ced4da;
  border-radius: 20px;
  cursor: pointer;
  -webkit-user-select: none;
  user-select: none;
  transition: all 0.2s ease-in-out;
  font-weight: 500;
  color: #495057;
  background-color: #fff;
  font-size: 0.9rem;
}
.status-date-tag:hover {
  border-color: #adb5bd;
  background-color: #f8f9fa;
}
.status-date-tag.active {
  color: #fff;
  border-color: var(--primary-color, #007bff);
  background-color: var(--primary-color, #007bff);
}
.status-date-tag input[type='date'] {
  background-color: transparent;
  border: none;
  color: #fff;
  padding: 0;
  font-size: 0.9em;
  width: 140px;
}
.status-date-tag.active input[type='date']::-webkit-calendar-picker-indicator {
  filter: invert(1);
}

.form-section {
  padding: 1rem;
  border-radius: 8px;
  background-color: #f8f9fa;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.form-section:nth-child(odd) {
  background-color: #ffffff;
}
.form-grid-3-col {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem 1.25rem;
}
.form-grid-2-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem 1.25rem;
}

/* ✨ 核心修正: 門診專用網格佈局 */
.opd-extra-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr); /* 預設三欄 */
  gap: 1rem 1.25rem;
}
.dialysis-reason-opd {
  grid-column: span 2; /* 透析原因佔兩欄 */
}
.remarks-opd {
  grid-column: 1 / -1; /* 備註佔滿整行 */
}

.radio-group {
  display: flex;
  gap: 1.5rem;
  padding: 8px 0;
}
.radio-group label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: normal; /* 覆蓋 form-field label 的粗體 */
  cursor: pointer;
}
.radio-group input[type='radio'] {
  width: auto;
  accent-color: var(--primary-color, #007bff);
}

/* 在螢幕寬度小於 700px 時，變回單欄，避免擁擠 */
@media (max-width: 700px) {
  .opd-extra-grid {
    grid-template-columns: 1fr;
  }
  .dialysis-reason-opd {
    grid-column: auto;
  }
}
</style>
