<!-- src/components/kidit/VascularAccessForm.vue -->
<template>
  <div class="access-form">
    <div class="form-section">
      <!-- 標題根據 type 變化 -->
      <h4 class="section-title">
        {{ type === 'current' ? '目前使用血管通路' : '其他未使用血管通路' }}
      </h4>

      <div class="form-content" v-if="localData">
        <!-- 1. 自體動靜脈瘻管 (AV-Fistula) -->
        <div class="form-row">
          <label class="checkbox-label">
            <input type="checkbox" v-model="localData.isAutoCap" />
            <span class="label-text">自體動靜脈瘻管 (AV-Fistula)</span>
          </label>
          <div v-if="localData.isAutoCap" class="sub-options">
            <select v-model="localData.autoCapSide">
              <option value="">側別</option>
              <option value="L">左</option>
              <option value="R">右</option>
            </select>
            <select v-model="localData.autoCapSite">
              <option value="">部位</option>
              <option value="1">前臂</option>
              <option value="2">上臂</option>
              <option value="3">大腿</option>
            </select>
          </div>
        </div>

        <!-- 2. 人工動靜脈瘻管 (AV-Graft) -->
        <div class="form-row">
          <label class="checkbox-label">
            <input type="checkbox" v-model="localData.isManuCap" />
            <span class="label-text">人工動靜脈瘻管 (AV-Graft)</span>
          </label>
          <div v-if="localData.isManuCap" class="sub-options">
            <select v-model="localData.manuCapSide">
              <option value="">側別</option>
              <option value="L">左</option>
              <option value="R">右</option>
            </select>
            <select v-model="localData.manuCapSite">
              <option value="">部位</option>
              <option value="1">前臂直型</option>
              <option value="2">前臂彎型</option>
              <option value="3">上臂</option>
              <option value="4">大腿</option>
            </select>
          </div>
        </div>

        <!-- 3. 長期導管 (Perm Cath) -->
        <div class="form-row">
          <label class="checkbox-label">
            <input type="checkbox" v-model="localData.isPermCath" />
            <span class="label-text">長期導管 (Perm Cath)</span>
          </label>
          <div v-if="localData.isPermCath" class="sub-options">
            <select v-model="localData.permCathSide">
              <option value="">側別</option>
              <option value="L">左</option>
              <option value="R">右</option>
            </select>
            <select v-model="localData.permCathSite">
              <option value="">部位</option>
              <option value="1">頸靜脈</option>
              <option value="2">鎖骨下靜脈</option>
              <option value="3">股靜脈</option>
            </select>
          </div>
        </div>

        <!-- 4. 雙腔導管 (Double Lumen) -->
        <div class="form-row">
          <label class="checkbox-label">
            <input type="checkbox" v-model="localData.isDoubleLumen" />
            <span class="label-text">雙腔導管 (Double Lumen)</span>
          </label>
          <div v-if="localData.isDoubleLumen" class="sub-options">
            <select v-model="localData.dlSide">
              <option value="">側別</option>
              <option value="L">左</option>
              <option value="R">右</option>
            </select>
            <select v-model="localData.dlSite">
              <option value="">部位</option>
              <option value="1">頸靜脈</option>
              <option value="2">鎖骨下靜脈</option>
              <option value="3">股靜脈</option>
            </select>
          </div>
        </div>

        <div class="actions">
          <button class="save-btn" @click="saveData" :disabled="isSaving">
            <i class="fas fa-save"></i> {{ isSaving ? '儲存中...' : '儲存設定' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { kiditService } from '@/services/kiditService'

const props = defineProps({
  type: String, // 'current' 或 'unused'
  date: String, // '2025-11-21'
  eventId: String, // 'move_...'
  initialData: Object, // 來自 kidit_logbook 的資料 (本月快照)
  masterPatient: Object, // 來自 patients 的資料 (用於預填)
})

const emit = defineEmits(['updated'])
const isSaving = ref(false)
const localData = ref({})

// 初始化邏輯： Logbook資料 > Master資料 > 預設空值
watch(
  () => [props.initialData, props.masterPatient, props.type],
  () => {
    // 1. 優先：如果 Logbook 已經有存過資料 (Snapshot)，直接使用
    if (props.initialData && props.initialData[props.type]) {
      localData.value = JSON.parse(JSON.stringify(props.initialData[props.type]))
    }
    // 2. 次要：如果 Logbook 沒資料，嘗試從病人主檔帶入 (預填功能)
    else if (
      props.masterPatient &&
      props.masterPatient.vascularAccessInfo &&
      props.masterPatient.vascularAccessInfo[props.type]
    ) {
      localData.value = JSON.parse(
        JSON.stringify(props.masterPatient.vascularAccessInfo[props.type]),
      )
    }
    // 3. 最後：如果都沒有，初始化為空值
    else {
      localData.value = {
        isAutoCap: false,
        autoCapSide: '',
        autoCapSite: '',
        isManuCap: false,
        manuCapSide: '',
        manuCapSite: '',
        isPermCath: false,
        permCathSide: '',
        permCathSite: '',
        isDoubleLumen: false,
        dlSide: '',
        dlSite: '',
      }
    }
  },
  { immediate: true, deep: true },
)

async function saveData() {
  isSaving.value = true
  try {
    const currentCompleteData = props.initialData || {}
    const newData = {
      ...currentCompleteData,
      [props.type]: localData.value,
    }

    await kiditService.updateEventKiDitData(props.date, props.eventId, 'kidit_vascular', newData)

    // ✨✨✨ 關鍵修改：傳遞欄位名稱和新資料給父元件 ✨✨✨
    emit('updated', 'kidit_vascular', newData)
  } catch (error) {
    console.error('儲存血管通路資料失敗:', error)
    alert('儲存失敗，請稍後再試') // 這裡可以用 inject 的 showAlert 若有需要
  } finally {
    isSaving.value = false
  }
}
</script>

<style scoped>
.access-form {
  padding: 10px;
}

.form-section {
  background: #fff;
  border: 1px solid #eee;
  border-radius: 8px;
  padding: 15px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.02);
}

.section-title {
  margin: 0 0 15px 0;
  padding-bottom: 8px;
  border-bottom: 2px solid #9b59b6; /* 紫色系，區分血管通路 */
  color: #2c3e50;
  font-size: 1.1rem;
  font-weight: 600;
}

.form-row {
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px dashed #eee;
}

.form-row:last-child {
  border-bottom: none;
}

.checkbox-label {
  display: flex;
  align-items: center;
  cursor: pointer;
  font-weight: 500;
  color: #333;
}

.checkbox-label input {
  margin-right: 8px;
  width: 16px;
  height: 16px;
  cursor: pointer;
}

.sub-options {
  margin-left: 28px;
  margin-top: 8px;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

select {
  padding: 6px 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background-color: #fff;
  font-size: 0.9rem;
  min-width: 100px;
}

select:focus {
  border-color: #9b59b6;
  outline: none;
}

.actions {
  margin-top: 20px;
  text-align: right;
  border-top: 1px solid #eee;
  padding-top: 10px;
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
</style>
