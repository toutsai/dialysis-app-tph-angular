<!-- src/components/kidit/KiDitHistoryForm.vue -->
<template>
  <div class="kidit-form-container" v-if="formData">
    <!-- 1. 轉入與透析史 -->
    <div class="form-section">
      <h4 class="section-title">轉入與透析史</h4>
      <div class="form-grid">
        <div class="form-group">
          <label>03 轉入院所名稱</label>
          <input type="text" v-model="formData.transferFromName" />
        </div>
        <div class="form-group">
          <label>04 轉入院所醫事代號</label>
          <input type="text" v-model="formData.transferFromCode" />
        </div>

        <!-- HD 區塊 -->
        <div class="form-group border-l pl-2">
          <label>05 開始HD日期</label>
          <input type="date" v-model="formData.startHDDate" />
        </div>
        <div class="form-group">
          <label>06 本院開始HD</label>
          <select v-model="formData.isStartHDHere">
            <option v-for="opt in opts.yesNo" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>
        <div class="form-group">
          <label>07 開始HD院所</label>
          <input type="text" v-model="formData.startHDHospital" />
        </div>

        <!-- PD 區塊 -->
        <div class="form-group border-l pl-2">
          <label>08 開始PD日期</label>
          <input type="date" v-model="formData.startPDDate" />
        </div>
        <div class="form-group">
          <label>09 本院開始PD</label>
          <select v-model="formData.isStartPDHere">
            <option v-for="opt in opts.yesNo" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>
        <div class="form-group">
          <label>10 開始PD院所</label>
          <input type="text" v-model="formData.startPDHospital" />
        </div>

        <!-- 移植 區塊 -->
        <div class="form-group border-l pl-2">
          <label>11 腎移植日期</label>
          <input type="date" v-model="formData.transplantDate" />
        </div>
        <div class="form-group">
          <label>12 本院移植</label>
          <select v-model="formData.isTransplantHere">
            <option v-for="opt in opts.yesNo" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>
        <div class="form-group">
          <label>13 移植院所</label>
          <input type="text" v-model="formData.transplantHospital" />
        </div>
      </div>
    </div>

    <!-- 2. 初始評估與慢性病 -->
    <div class="form-section">
      <h4 class="section-title">初始評估與系統性疾病</h4>
      <div class="form-grid">
        <div class="form-group">
          <label>14 知為慢性腎衰竭</label>
          <select v-model="formData.isKnownCKD">
            <option v-for="opt in opts.yesNo" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>
        <div class="form-group">
          <label>15 BUN/Cr異常</label>
          <select v-model="formData.isBUNCreatAbnormal">
            <option v-for="opt in opts.yesNo" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>
        <div class="form-group">
          <label>16 檢驗日期</label>
          <input type="date" v-model="formData.abnormalLabDate" />
        </div>
        <div class="form-group">
          <label>17 BUN</label>
          <input type="number" v-model="formData.initialBUN" step="0.1" />
        </div>
        <div class="form-group">
          <label>18 Creatinine</label>
          <input type="number" v-model="formData.initialCr" step="0.1" />
        </div>

        <div class="form-group full-width">
          <label>22 其他系統性疾病 (複選)</label>
          <div class="checkbox-grid">
            <label v-for="item in opts.systemicDiseases" :key="item.index" class="checkbox-label">
              <input
                type="checkbox"
                :value="item.index"
                v-model="formData.selectedSystemicDiseases"
              />
              {{ item.label }}
            </label>
          </div>
        </div>
        <div class="form-group full-width">
          <label>23 其他說明</label>
          <input type="text" v-model="formData.otherSystemicDescription" />
        </div>
        <div class="form-group">
          <label>24 DM型式</label>
          <select v-model="formData.dmType">
            <option v-for="opt in opts.dmType" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>
      </div>
    </div>

    <!-- 3. 初始檢驗數值 (Row 25-34) -->
    <div class="form-section">
      <h4 class="section-title">初始檢驗數值</h4>
      <div class="form-grid">
        <div class="form-group">
          <label>25 檢驗日期</label>
          <input type="date" v-model="formData.initialLabDate" />
        </div>
        <div class="form-group">
          <label>26 Hct</label><input type="number" v-model="formData.initialHct" />
        </div>
        <div class="form-group">
          <label>27 Hb</label><input type="number" v-model="formData.initialHb" />
        </div>
        <div class="form-group">
          <label>30 K</label><input type="number" v-model="formData.initialK" />
        </div>
        <div class="form-group">
          <label>32 Albumin</label><input type="number" v-model="formData.initialAlb" />
        </div>
        <div class="form-group">
          <label>體重</label><input type="number" v-model="formData.initialWeight" />
        </div>
        <div class="form-group">
          <label>身高</label><input type="number" v-model="formData.initialHeight" />
        </div>
        <div class="form-group">
          <label>eGFR</label><input type="number" v-model="formData.initialEGFR" />
        </div>
        <div class="form-group">
          <label>33 HBsAg</label>
          <select v-model="formData.hbsag">
            <option v-for="opt in opts.hepatitis" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>
        <div class="form-group">
          <label>34 Anti-HCV</label>
          <select v-model="formData.antihcv">
            <option v-for="opt in opts.hepatitis" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>
      </div>
    </div>

    <!-- 4. 症狀與緊急透析 (Row 35-50) -->
    <div class="form-section">
      <h4 class="section-title">症狀與緊急透析</h4>
      <div class="form-grid">
        <div class="form-group full-width">
          <label>35 適應症種類</label>
          <select v-model="formData.indicationType">
            <option v-for="opt in opts.indicationType" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>

        <div class="form-group full-width">
          <label>36 其他症狀 (複選)</label>
          <div class="checkbox-grid">
            <label v-for="item in opts.otherSymptoms" :key="item.index" class="checkbox-label">
              <input type="checkbox" :value="item.index" v-model="formData.selectedSymptoms" />
              {{ item.label }}
            </label>
          </div>
        </div>

        <div class="form-group full-width">
          <label>38 緊急透析原因 (複選)</label>
          <div class="checkbox-grid">
            <label v-for="item in opts.emergencyReasons" :key="item.index" class="checkbox-label">
              <input
                type="checkbox"
                :value="item.index"
                v-model="formData.selectedEmergencyReasons"
              />
              {{ item.label }}
            </label>
          </div>
        </div>

        <div class="form-group">
          <label>40 緊急檢驗日期</label>
          <input type="date" v-model="formData.emergencyLabDate" />
        </div>
        <!-- 41-49 是緊急透析的 Lab，可依需求加入，這裡簡化示範 -->
        <div class="form-group">
          <label>50 初次重大傷病</label>
          <select v-model="formData.isFirstCatastrophic">
            <option v-for="opt in opts.yesNo" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>
      </div>
    </div>

    <div class="actions">
      <button class="save-btn" @click="saveData" :disabled="isSaving">
        <i class="fas fa-save"></i> {{ isSaving ? '儲存中...' : '儲存病史資料' }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { kiditService } from '@/services/kiditService'
import { KIDIT_HISTORY_OPTIONS } from '@/utils/kiditHelpers'

const props = defineProps({
  date: String, // '2025-11-21'
  eventId: String, // 'move_...'
  initialData: Object, // 來自 kidit_logbook (優先)
  masterPatient: Object, // 來自 patients (預填用)
})

const emit = defineEmits(['updated'])
const isSaving = ref(false)
const formData = ref({})
const opts = KIDIT_HISTORY_OPTIONS

// 初始化資料：優先讀取 Logbook 快照，若無則嘗試從病患主檔帶入
watch(
  () => [props.initialData, props.masterPatient],
  () => {
    // 1. 如果 Logbook 有資料 (已存過)，直接使用
    if (props.initialData) {
      formData.value = JSON.parse(JSON.stringify(props.initialData))
    }

    // 2. 如果沒存過，從 Master Record 預填
    else if (props.masterPatient) {
      // 存放在 kiditProfile.history 下
      const h = props.masterPatient.kiditProfile?.history || {}

      formData.value = {
        transferFromName: h.transferFromName || '',
        transferFromCode: h.transferFromCode || '',
        startHDDate: h.startHDDate || '',
        isStartHDHere: h.isStartHDHere || 'N',
        startHDHospital: h.startHDHospital || '',
        startPDDate: h.startPDDate || '',
        isStartPDHere: h.isStartPDHere || 'N',
        startPDHospital: h.startPDHospital || '',
        transplantDate: h.transplantDate || '',
        isTransplantHere: h.isTransplantHere || 'N',
        transplantHospital: h.transplantHospital || '',

        isKnownCKD: h.isKnownCKD || 'N',
        isBUNCreatAbnormal: h.isBUNCreatAbnormal || 'N',
        abnormalLabDate: h.abnormalLabDate || '',
        initialBUN: h.initialBUN || '',
        initialCr: h.initialCr || '',

        // 複選題存成陣列，方便 Vue 操作
        selectedSystemicDiseases: h.selectedSystemicDiseases || [],
        otherSystemicDescription: h.otherSystemicDescription || '',
        dmType: h.dmType || '3',

        initialLabDate: h.initialLabDate || '',
        initialHct: h.initialHct || '',
        initialHb: h.initialHb || '',
        initialK: h.initialK || '',
        initialAlb: h.initialAlb || '',
        initialWeight: h.initialWeight || '',
        initialHeight: h.initialHeight || '',
        initialEGFR: h.initialEGFR || '',
        hbsag: h.hbsag || 'O',
        antihcv: h.antihcv || 'O',

        indicationType: h.indicationType || '1',
        selectedSymptoms: h.selectedSymptoms || [],
        selectedEmergencyReasons: h.selectedEmergencyReasons || [],
        emergencyLabDate: h.emergencyLabDate || '',
        isFirstCatastrophic: h.isFirstCatastrophic || 'N',
      }
    }

    // 3. 最後，給空值
    else {
      formData.value = {}
    }
  },
  { immediate: true, deep: true },
)

async function saveData() {
  isSaving.value = true
  try {
    await kiditService.updateEventKiDitData(
      props.date,
      props.eventId,
      'kidit_history',
      formData.value,
    )

    // ✨✨✨ 關鍵修改：傳遞欄位名稱和新資料 ✨✨✨
    emit('updated', 'kidit_history', formData.value)
  } catch (error) {
    console.error('儲存失敗:', error)
    alert('儲存失敗')
  } finally {
    isSaving.value = false
  }
}
</script>

<style scoped>
.kidit-form-container {
  padding: 10px;
  max-height: 70vh;
  overflow-y: auto;
}
.form-section {
  background: #fff;
  border: 1px solid #eee;
  border-radius: 8px;
  padding: 15px;
  margin-bottom: 20px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.02);
}
.section-title {
  margin: 0 0 15px 0;
  padding-bottom: 8px;
  border-bottom: 2px solid #9b59b6; /* 紫色區隔 */
  color: #2c3e50;
  font-size: 1.1rem;
}
.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 15px;
}
.form-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.full-width {
  grid-column: 1 / -1;
}
.border-l {
  border-left: 3px solid #eee;
}
label {
  font-size: 0.85rem;
  color: #666;
  font-weight: 600;
}
input,
select {
  padding: 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.95rem;
}
input:focus,
select:focus {
  border-color: #9b59b6;
  outline: none;
}

/* 複選框樣式 */
.checkbox-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 8px;
  background: #f9f9f9;
  padding: 10px;
  border-radius: 4px;
}
.checkbox-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.9rem;
  cursor: pointer;
}

.actions {
  text-align: right;
  padding-top: 10px;
  border-top: 1px solid #eee;
}
.save-btn {
  background: #27ae60;
  color: white;
  border: none;
  padding: 10px 25px;
  border-radius: 5px;
  cursor: pointer;
  transition: background 0.2s;
}
.save-btn:hover {
  background: #219150;
}
.save-btn:disabled {
  background: #ccc;
  cursor: not-allowed;
}
</style>
