<!-- src/components/kidit/KiDitPatientForm.vue -->
<template>
  <div class="kidit-form-container" v-if="formData">
    <!-- 區塊 1: 身分與基本資料 -->
    <div class="form-section">
      <h4 class="section-title">基本身分資料</h4>
      <div class="form-grid">
        <div class="form-group">
          <label>01 姓名</label>
          <!-- 從 Master Data 讀取的姓名通常不允許修改，以保持一致性 -->
          <input type="text" v-model="formData.name" disabled class="input-disabled" />
        </div>

        <div class="form-group">
          <label>04 身分證號</label>
          <input type="text" v-model="formData.idNumber" placeholder="10碼" />
        </div>

        <div class="form-group">
          <label>08 病歷號</label>
          <input type="text" v-model="formData.medicalRecordNumber" placeholder="10碼" />
        </div>

        <div class="form-group">
          <label>02 病患類別</label>
          <select v-model="formData.patientCategory">
            <option
              v-for="opt in KIDIT_OPTIONS.patientCategory"
              :key="opt.value"
              :value="opt.value"
            >
              {{ opt.label }}
            </option>
          </select>
        </div>

        <div class="form-group">
          <label>03 生日 (西元)</label>
          <input type="date" v-model="formData.birthDate" />
          <small class="roc-date" v-if="formData.birthDate">
            民國: {{ toRocDate(formData.birthDate) }}
          </small>
        </div>

        <div class="form-group">
          <label>05 性別</label>
          <select v-model="formData.gender">
            <option v-for="opt in KIDIT_OPTIONS.gender" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>

        <div class="form-group">
          <label>15 血型</label>
          <select v-model="formData.bloodType">
            <option v-for="opt in KIDIT_OPTIONS.bloodType" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>

        <div class="form-group">
          <label>17 原住民</label>
          <select v-model="formData.isIndigenous">
            <option v-for="opt in KIDIT_OPTIONS.yesNo" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>

        <div class="form-group">
          <label>18 福保身分</label>
          <select v-model="formData.isWelfare">
            <option v-for="opt in KIDIT_OPTIONS.yesNo" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>

        <div class="form-group">
          <label>16 重大傷病卡號</label>
          <input type="text" v-model="formData.catastrophicCardNo" placeholder="10碼" />
        </div>
      </div>
    </div>

    <!-- 區塊 2: 聯絡與社會資料 -->
    <div class="form-section">
      <h4 class="section-title">聯絡與社會資料</h4>
      <div class="form-grid">
        <div class="form-group full-width">
          <label>10 地址</label>
          <input type="text" v-model="formData.address" placeholder="最多80字" />
        </div>

        <div class="form-group">
          <label>07 電話</label>
          <input type="text" v-model="formData.phone" placeholder="最多25碼" />
        </div>

        <div class="form-group">
          <label>06 婚姻</label>
          <select v-model="formData.maritalStatus">
            <option v-for="opt in KIDIT_OPTIONS.maritalStatus" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>

        <div class="form-group">
          <label>11 教育程度</label>
          <select v-model="formData.education">
            <option v-for="opt in KIDIT_OPTIONS.education" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>

        <div class="form-group">
          <label>12 職業</label>
          <select v-model="formData.occupation">
            <option v-for="opt in KIDIT_OPTIONS.occupation" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>

        <div class="form-group">
          <label>13 連絡人</label>
          <input type="text" v-model="formData.contactPerson" placeholder="姓名" />
        </div>

        <div class="form-group">
          <label>14 關係</label>
          <select v-model="formData.relationship">
            <option v-for="opt in KIDIT_OPTIONS.relation" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>
      </div>
    </div>

    <!-- 區塊 3: 透析與病史資料 -->
    <div class="form-section">
      <h4 class="section-title">透析與病史資料</h4>
      <div class="form-grid">
        <div class="form-group">
          <label>09 透析代號</label>
          <input type="text" v-model="formData.dialysisCode" placeholder="10碼" />
        </div>

        <div class="form-group span-2">
          <label>19 狀態</label>
          <select v-model="formData.status">
            <option v-for="opt in KIDIT_OPTIONS.status" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>

        <div class="form-group">
          <label>20 首次治療日期</label>
          <input type="date" v-model="formData.firstDialysisDate" />
        </div>

        <div class="form-group">
          <label>21 本院開始治療日期</label>
          <input type="date" v-model="formData.hospitalStartDate" />
        </div>

        <div class="form-group">
          <label>22 原發病大類</label>
          <select v-model="formData.diagnosisCategory">
            <option
              v-for="opt in KIDIT_OPTIONS.diagnosisCategory"
              :key="opt.value"
              :value="opt.value"
            >
              {{ opt.label }}
            </option>
          </select>
        </div>

        <div class="form-group span-2">
          <label>23 原發病細類</label>
          <select v-model="formData.diagnosisSubcategory">
            <option value="">請選擇</option>
            <option
              v-for="opt in KIDIT_OPTIONS.diagnosisSubcategory"
              :key="opt.value"
              :value="opt.value"
            >
              {{ opt.value }} - {{ opt.label }}
            </option>
          </select>
        </div>
      </div>
    </div>

    <div class="actions">
      <button class="save-btn" @click="saveData" :disabled="isSaving">
        <i class="fas fa-save"></i> {{ isSaving ? '儲存中...' : '儲存 KiDit 資料' }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { kiditService } from '@/services/kiditService'
import { KIDIT_OPTIONS, toRocDate } from '@/utils/kiditHelpers'

const props = defineProps({
  date: String, // '2025-11-21'
  eventId: String, // 'move_...'
  initialData: Object, // 來自 kidit_logbook (優先)
  masterPatient: Object, // 來自 patients (預填用)
})

const emit = defineEmits(['updated'])
const isSaving = ref(false)
const formData = ref({})

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
      const p = props.masterPatient
      // 相容舊資料 kiditProfile
      const k = p.kiditProfile || {}

      formData.value = {
        // 基本資料
        name: p.name || '',
        idNumber: k.idNumber || p.idNumber || '',
        medicalRecordNumber: k.medicalRecordNumber || p.medicalRecordNumber || '',
        patientCategory: k.patientCategory || '00', // 預設健保
        birthDate: k.birthDate || p.birthDate || '',
        gender: k.gender || (p.gender === '男' ? '1' : '2'),
        bloodType: k.bloodType || '',
        isIndigenous: k.isIndigenous || 'N', // 預設否
        isWelfare: k.isWelfare || 'N', // 預設否
        catastrophicCardNo: k.catastrophicCardNo || '',

        // 聯絡資料
        address: k.address || '',
        phone: k.phone || '',
        maritalStatus: k.maritalStatus || '',
        education: k.education || '',
        occupation: k.occupation || '',
        contactPerson: k.contactPerson || '',
        relationship: k.relationship || '',

        // 透析病史
        dialysisCode: k.dialysisCode || '',
        status: k.status || '1', // 預設長期血液透析
        firstDialysisDate: k.firstDialysisDate || '',
        hospitalStartDate: k.hospitalStartDate || '',
        diagnosisCategory: k.diagnosisCategory || '',
        diagnosisSubcategory: k.diagnosisSubcategory || '',
      }
    }

    // 3. 若兩者皆無，給空值 (通常不應發生，至少有 masterPatient)
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
      'kidit_profile',
      formData.value,
    )

    // ✨✨✨ 關鍵修改：傳遞欄位名稱和新資料 ✨✨✨
    emit('updated', 'kidit_profile', formData.value)
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
  border-bottom: 2px solid #3498db;
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

.span-2 {
  grid-column: span 2;
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
  border-color: #3498db;
  outline: none;
}

.input-disabled {
  background-color: #f5f5f5;
  cursor: not-allowed;
  color: #888;
}

.roc-date {
  font-size: 0.8rem;
  color: #e67e22;
  text-align: right;
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
  font-size: 1rem;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transition: background 0.2s;
}

.save-btn:hover {
  background: #219150;
}

.save-btn:disabled {
  background: #ccc;
  cursor: not-allowed;
}

@media (max-width: 600px) {
  .span-2 {
    grid-column: 1 / -1;
  }
}
</style>
