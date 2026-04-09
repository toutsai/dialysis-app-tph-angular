<template>
  <div v-if="isVisible" class="modal-overlay" v-overlay-close="close">
    <div class="modal-container">
      <header class="modal-header">
        <h2>{{ isEditMode ? '修改交辦 / 留言' : '新增交辦 / 留言' }}</h2>
        <button class="close-btn" @click="close">&times;</button>
      </header>
      <main class="modal-body">
        <!-- 類型選擇 -->
        <div class="form-group">
          <label class="form-label">類型</label>
          <div class="radio-group">
            <label class="radio-label"
              ><input
                type="radio"
                v-model="formData.category"
                value="message"
                :disabled="isEditMode"
              /><span>病人留言</span></label
            >
            <label class="radio-label"
              ><input
                type="radio"
                v-model="formData.category"
                value="task"
                :disabled="isEditMode"
              /><span>交辦事項</span></label
            >
          </div>
        </div>

        <!-- 備忘類型 (僅留言顯示) -->
        <div v-if="formData.category === 'message'" class="form-group">
          <label for="messageType" class="form-label">備忘類型</label>
          <div class="assignee-btn-group">
            <button
              v-for="msgType in messageTypeOptions"
              :key="msgType.value"
              @click="formData.messageType = msgType.value"
              :class="{ active: formData.messageType === msgType.value }"
              class="btn-assignee"
            >
              <span class="message-type-icon">{{ msgType.icon }}</span>
              {{ msgType.label }}
            </button>
          </div>
        </div>

        <!-- 交辦給 (僅交辦事項顯示) -->
        <div v-if="formData.category === 'task'" class="form-group">
          <label for="assignee" class="form-label">交辦給</label>
          <div class="assignee-btn-group">
            <button
              v-for="assignee in assigneeOptions"
              :key="assignee.value"
              @click="selectAssigneeRole(assignee.value)"
              :class="{ active: formData.assigneeRole === assignee.value }"
              class="btn-assignee"
            >
              {{ assignee.label }}
            </button>
          </div>

          <!-- ✨ [核心修改] 下拉選單：只有在非「護理師組長」時才顯示 -->
          <div
            v-if="formData.assigneeRole && formData.assigneeRole !== 'nurse_leader'"
            class="assignee-select-wrapper"
          >
            <label class="select-label" for="assigneeUser">選擇成員</label>
            <select id="assigneeUser" v-model="formData.assigneeUserId" class="form-control">
              <option value="" disabled>請選擇 {{ selectedAssigneeLabel }} 名單</option>
              <option v-for="user in filteredAssigneeUsers" :key="user.uid" :value="user.uid">
                {{ user.name }}<span v-if="user.title">（{{ user.title }}）</span>
              </option>
            </select>
          </div>

          <!-- ✨ [核心修改] 提示文字：如果是組長，顯示提示 -->
          <div v-else-if="formData.assigneeRole === 'nurse_leader'" class="assignee-info-text">
            <i class="fas fa-info-circle"></i> 此任務將發送給所有護理師（組長），由當值人員處理。
          </div>
        </div>

        <!-- 關聯病人 -->
        <div class="form-group">
          <label for="patient" class="form-label">關聯病人 (可選)</label>
          <div v-if="selectedPatient" class="selected-patient-display">
            <span>{{ selectedPatient.name }} ({{ selectedPatient.medicalRecordNumber }})</span>
            <button
              class="clear-patient-btn"
              @click="clearPatient"
              title="清除選擇"
              :disabled="isEditMode"
            >
              ×
            </button>
          </div>
          <button
            v-else
            @click="isPatientDialogVisible = true"
            class="btn btn-outline"
            :disabled="isEditMode"
          >
            選擇病人
          </button>
        </div>

        <!-- 目標日期 (僅在病人留言顯示) -->
        <div v-if="formData.category === 'message'" class="form-group">
          <label for="targetDate" class="form-label">目標日期</label>
          <input type="date" id="targetDate" v-model="formData.targetDate" class="form-control" />
        </div>

        <!-- 內容輸入區 -->
        <div class="form-group">
          <label for="content" class="form-label">內容</label>

          <!-- 書記耗材介面 -->
          <div
            v-if="isClerkSupplyTask"
            class="supply-container"
            :class="{ 'disabled-view': isEditMode }"
          >
            <div
              v-for="(item, index) in dynamicSupplyItems"
              :key="item.id"
              class="dynamic-supply-item"
            >
              <select
                v-model="item.type"
                @change="onItemTypeChange(item)"
                class="supply-type-select"
                :disabled="isEditMode"
              >
                <option disabled value="">選擇類型</option>
                <option v-for="opt in supplyTypeOptions" :key="opt.value" :value="opt.value">
                  {{ opt.label }}
                </option>
              </select>

              <select
                v-if="item.type === 'AK'"
                v-model="item.spec"
                class="supply-spec-select"
                :disabled="isEditMode"
              >
                <option disabled value="">選擇AK規格</option>
                <option v-for="ak in akOptions" :key="ak" :value="ak">{{ ak }}</option>
              </select>
              <select
                v-else-if="item.type === 'A液'"
                v-model="item.spec"
                class="supply-spec-select"
                :disabled="isEditMode"
              >
                <option disabled value="">選擇A液規格</option>
                <option v-for="a in aLiquidOptions" :key="a" :value="a">{{ a }}</option>
              </select>
              <select
                v-else-if="item.type === 'B液'"
                v-model="item.spec"
                class="supply-spec-select"
                :disabled="isEditMode"
              >
                <option disabled value="">選擇B液規格</option>
                <option v-for="b in bLiquidOptions" :key="b" :value="b">{{ b }}</option>
              </select>
              <select
                v-else-if="item.type === '耗衛材'"
                v-model="item.spec"
                class="supply-spec-select"
                :disabled="isEditMode"
              >
                <option disabled value="">選擇衛材品項</option>
                <option v-for="supply in medicalSuppliesOptions" :key="supply" :value="supply">
                  {{ supply }}
                </option>
              </select>

              <div v-else class="spec-placeholder"></div>

              <div class="quantity-stepper">
                <button
                  @click="item.quantity > 0 && item.quantity--"
                  class="quantity-btn"
                  :disabled="isEditMode"
                >
                  -
                </button>
                <span class="quantity-display">{{ item.quantity }}</span>
                <button @click="item.quantity++" class="quantity-btn" :disabled="isEditMode">
                  +
                </button>
              </div>

              <button
                @click="removeSupplyItem(index)"
                class="remove-item-btn"
                title="移除此項"
                :disabled="isEditMode"
              >
                ×
              </button>
            </div>

            <button @click="addSupplyItem" class="btn btn-add-supply" :disabled="isEditMode">
              <i class="fas fa-plus"></i> 新增耗材項目
            </button>

            <textarea
              v-model="otherSupplyInfo"
              placeholder="其他備註..."
              rows="2"
              class="other-supply-input"
              :disabled="isEditMode"
            ></textarea>
          </div>

          <textarea
            v-else
            id="content"
            v-model="formData.content"
            rows="4"
            placeholder="請輸入詳細內容..."
            class="form-control"
          ></textarea>
        </div>
      </main>
      <footer class="modal-footer">
        <button class="btn btn-secondary" @click="close">取消</button>
        <button
          class="btn btn-primary"
          @click="handleSubmit"
          :disabled="!isFormValid || isSubmitting"
        >
          {{ isSubmitting ? '處理中...' : isEditMode ? '更新' : '送出' }}
        </button>
      </footer>
    </div>

    <PatientSelectDialog
      :is-visible="isPatientDialogVisible"
      title="選擇關聯病人"
      :patients="allPatients"
      :show-fill-options="false"
      @confirm="handlePatientSelected"
      @cancel="isPatientDialogVisible = false"
    />
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { useAuth } from '@/composables/useAuth'
import { systemApi } from '@/services/localApiClient'
import PatientSelectDialog from '@/components/PatientSelectDialog.vue'
import { useGlobalNotifier } from '@/composables/useGlobalNotifier'
import { useUserDirectory } from '@/composables/useUserDirectory'
import { getToday } from '@/utils/dateUtils'

const props = defineProps({
  isVisible: Boolean,
  preselectedPatient: Object,
  allPatients: Array,
  initialData: {
    type: Object,
    default: null,
  },
})
const emit = defineEmits(['close', 'submit'])

const { currentUser } = useAuth()
const { createGlobalNotification } = useGlobalNotifier()
const { ensureUsersLoaded, users: directoryUsers } = useUserDirectory()

const isSubmitting = ref(false)
const isPatientDialogVisible = ref(false)
const selectedPatient = ref(null)
const isEditMode = computed(() => !!props.initialData)

const formData = reactive({
  id: null,
  category: 'message',
  assigneeRole: '',
  assigneeUserId: '',
  targetDate: getToday(),
  content: '',
  messageType: '常規',
})

const messageTypeOptions = [
  { value: '常規', label: '一般交班', icon: '📝' },
  { value: '抽血', label: '抽血提醒', icon: '🩸' },
  { value: '衛教', label: '衛教事項', icon: '📢' },
]

// ✨ [核心修改] 1. 更新選項，將護理師拆分
const assigneeOptions = [
  { value: 'clerk', label: '書記' },
  { value: 'doctor', label: '醫師' },
  { value: 'np', label: '專科護理師' },
  { value: 'nurse_individual', label: '護理師 (指定)' }, // 指定人
  { value: 'nurse_leader', label: '護理師組長' }, // 不指定人 (Role Editor)
]

// ✨ [核心修改] 2. 更新職稱對應，讓護理師對應到 nurse_individual 以供篩選
const titleToRoleValue = {
  書記: 'clerk',
  主治醫師: 'doctor',
  專科護理師: 'np',
  護理師: 'nurse_individual', // 這樣選「護理師(指定)」時才能篩出人名
  護理長: 'nurse_individual', // 如果有護理長，也歸類在此
}

const akOptions = [
  '13M',
  '15S',
  '17UX',
  '17HX',
  'FX80',
  'BG-1.8U',
  'Pro-19H',
  '21S',
  'Hi23',
  '25S',
  'CTA2000',
]
const aLiquidOptions = ['2.5', '3.0', '3.5']
const bLiquidOptions = ['5L B液', '罐裝B粉', '袋裝B粉']
const medicalSuppliesOptions = [
  '傷口照護包',
  '住院包',
  'EKG貼片',
  'OP site(每周)',
  'OP site(每三天)',
  '鼻導管',
]
const supplyTypeOptions = ref([
  { value: 'AK', label: 'AK' },
  { value: 'A液', label: 'A液' },
  { value: 'B液', label: 'B液' },
  { value: 'Tubing', label: 'Tubing' },
  { value: 'NS500', label: 'NS (500cc)' },
  { value: 'NS1000', label: 'NS (1000cc)' },
  { value: '耗衛材', label: '耗衛材' },
])

const dynamicSupplyItems = ref([])
const otherSupplyInfo = ref('')
const isClerkSupplyTask = computed(
  () => formData.category === 'task' && formData.assigneeRole === 'clerk' && !isEditMode.value,
)

// ✨ [核心修改] 3. 篩選人員名單
const filteredAssigneeUsers = computed(() => {
  if (!formData.assigneeRole) return []

  // 如果是組長模式，不需要顯示下拉選單，直接回傳空陣列
  if (formData.assigneeRole === 'nurse_leader') return []

  return directoryUsers.value
    .filter((user) => titleToRoleValue[user.title] === formData.assigneeRole)
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
})

const selectedAssigneeLabel = computed(() => {
  const matched = assigneeOptions.find((opt) => opt.value === formData.assigneeRole)
  return matched?.label || '指定職務'
})

const selectedAssigneeUser = computed(
  () => directoryUsers.value.find((user) => user.uid === formData.assigneeUserId) || null,
)

// ✨ [核心修改] 4. 表單驗證邏輯更新
const isFormValid = computed(() => {
  if (isEditMode.value) return true
  if (isClerkSupplyTask.value) {
    const allItemsValid = dynamicSupplyItems.value.every((item) => {
      if (['AK', 'A液', 'B液', '耗衛材'].includes(item.type)) {
        return item.type && item.spec && item.quantity > 0
      }
      return item.type && item.quantity > 0
    })
    if (dynamicSupplyItems.value.length === 0) {
      return otherSupplyInfo.value.trim() !== ''
    }
    return allItemsValid
  }
  if (formData.category === 'task') {
    // 如果是組長模式，不需要選人，直接通過
    if (formData.assigneeRole === 'nurse_leader') {
      return true
    }
    // 其他模式必須要有角色和選人
    if (!formData.assigneeRole || !formData.assigneeUserId) {
      return false
    }
  }
  return true
})

watch(
  () => props.isVisible,
  (newVal) => {
    if (newVal) {
      ensureUsersLoaded().catch((error) => console.error('載入使用者名單失敗', error))
      if (isEditMode.value) {
        const item = props.initialData
        formData.id = item.id
        formData.category = item.assignee ? 'task' : 'message'

        // 編輯回填邏輯：判斷是組長(Role)還是指定人(User)
        if (item.assignee) {
          if (item.assignee.type === 'role' && item.assignee.role === 'editor') {
            formData.assigneeRole = 'nurse_leader'
            formData.assigneeUserId = ''
          } else if (item.assignee.type === 'user' && item.assignee.role === 'editor') {
            formData.assigneeRole = 'nurse_individual'
            formData.assigneeUserId = item.assignee.value
          } else {
            formData.assigneeRole = item.assignee.role || item.assignee.value || ''
            formData.assigneeUserId = item.assignee.value
          }
        }

        formData.targetDate = item.targetDate || getToday()
        formData.content = item.content
        formData.messageType = item.type || '常規'
        if (item.patientId) {
          selectedPatient.value = props.allPatients.find((p) => p.id === item.patientId)
        } else {
          selectedPatient.value = null
        }
      } else {
        resetForm()
      }
    }
  },
)

onMounted(() => {
  ensureUsersLoaded().catch((error) => console.error('載入使用者名單失敗', error))
})

function addSupplyItem() {
  dynamicSupplyItems.value.push({ id: Date.now(), type: '', spec: '', quantity: 1 })
}

function removeSupplyItem(index) {
  dynamicSupplyItems.value.splice(index, 1)
}

function onItemTypeChange(item) {
  item.spec = ''
}

function selectAssigneeRole(role) {
  formData.assigneeRole = role
  formData.assigneeUserId = ''
  const candidates = filteredAssigneeUsers.value
  if (candidates.length === 1) {
    formData.assigneeUserId = candidates[0].uid
  }
}

function resetForm() {
  formData.id = null
  formData.category = 'message'
  formData.assigneeRole = ''
  formData.assigneeUserId = ''
  formData.targetDate = getToday()
  formData.content = ''
  formData.messageType = '常規'
  selectedPatient.value = props.preselectedPatient || null
  dynamicSupplyItems.value = []
  otherSupplyInfo.value = ''
}

function handlePatientSelected({ patientId }) {
  selectedPatient.value = props.allPatients.find((p) => p.id === patientId)
  isPatientDialogVisible.value = false
}

function clearPatient() {
  selectedPatient.value = null
}

// ✨ [核心修改] 5. 更新 handleSubmit 函式
async function handleSubmit() {
  if (isClerkSupplyTask.value) {
    const parts = dynamicSupplyItems.value
      .filter((item) => item.type && item.quantity > 0)
      .map((item) => {
        let itemName =
          supplyTypeOptions.value.find((opt) => opt.value === item.type)?.label || item.type
        if (item.spec) itemName += ` (${item.spec})`
        return `${itemName} x${item.quantity}`
      })

    let generatedContent = parts.length > 0 ? `補帳：${parts.join('、')}` : ''
    if (otherSupplyInfo.value.trim()) {
      generatedContent += `${generatedContent ? '。' : ''}其他：${otherSupplyInfo.value.trim()}`
    }
    formData.content = generatedContent
  }

  if (!isFormValid.value) return
  isSubmitting.value = true

  if (!isEditMode.value) {
    // --- 新增模式 ---
    const expireAtDate = new Date()
    expireAtDate.setMonth(expireAtDate.getMonth() + 2)

    const dataToSave = {
      category: formData.category,
      content: formData.content.trim(),
      status: 'pending',
      creator: {
        uid: currentUser.value.uid,
        name: currentUser.value.name,
        title: currentUser.value.title,
      },
      patientId: selectedPatient.value?.id || null,
      patientName: selectedPatient.value?.name || null,
      createdAt: new Date().toISOString(),
      expireAt: expireAtDate,
    }

    if (dataToSave.category === 'task') {
      // ✨ [關鍵邏輯] 根據 UI 選項決定存檔資料結構

      if (formData.assigneeRole === 'nurse_leader') {
        // 情境 A: 給組長 (Role Task)，資料庫 role 為 editor
        dataToSave.assignee = {
          type: 'role',
          role: 'editor',
          value: 'editor',
          name: '護理師組長',
          title: '職務指派',
        }
      } else if (formData.assigneeRole === 'nurse_individual') {
        // 情境 B: 給特定護理師 (User Task)，但資料庫 role 仍為 editor
        dataToSave.assignee = {
          type: 'user',
          role: 'editor',
          value: formData.assigneeUserId,
          name: selectedAssigneeUser.value?.name || '',
          title: selectedAssigneeUser.value?.title || '',
        }
      } else {
        // 情境 C: 其他 (醫師、書記等)
        dataToSave.assignee = {
          type: 'user',
          role: formData.assigneeRole,
          value: formData.assigneeUserId,
          name: selectedAssigneeUser.value?.name || '',
          title: selectedAssigneeUser.value?.title || '',
        }
      }

      dataToSave.targetDate = getToday()
    } else {
      dataToSave.type = formData.messageType
      dataToSave.targetDate = formData.targetDate
      dataToSave.assignee = null
    }

    try {
      const savedDoc = await systemApi.saveTask(dataToSave)
      let notifMessage = ''
      let notifType = 'info'
      if (dataToSave.category === 'message') {
        const typeLabel =
          messageTypeOptions.find((opt) => opt.value === dataToSave.type)?.label || '新留言'
        const patientPart = dataToSave.patientName ? `給 ${dataToSave.patientName}` : ''
        const contentPart =
          dataToSave.content.substring(0, 15) + (dataToSave.content.length > 15 ? '...' : '')
        notifMessage = `${typeLabel}: ${patientPart} - ${contentPart}`
        notifType = 'message'
      } else {
        // 顯示交辦對象名稱
        const assigneeLabel = dataToSave.assignee.name || '指定人員'
        notifMessage = `新交辦: 給 ${assigneeLabel} - ${dataToSave.content.substring(0, 20)}...`
        notifType = 'task'
      }
      createGlobalNotification(notifMessage, notifType, { documentId: savedDoc.id })
      emit('submit', { ...dataToSave, id: savedDoc.id })
      close()
    } catch (error) {
      console.error('新增失敗:', error)
    } finally {
      isSubmitting.value = false
    }
  } else {
    // --- 編輯模式 ---
    const dataToUpdate = {
      content: formData.content.trim(),
      ...(formData.category === 'message' && {
        type: formData.messageType,
        targetDate: formData.targetDate,
      }),
      lastEditedBy: {
        uid: currentUser.value.uid,
        name: currentUser.value.name,
      },
      lastEditedAt: new Date().toISOString(),
    }
    emit('submit', { id: formData.id, ...dataToUpdate })
    isSubmitting.value = false
  }
}

function close() {
  emit('close')
}
</script>

<style scoped>
.disabled-view {
  opacity: 0.6;
  pointer-events: none;
}
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal-container {
  background: white;
  border-radius: 8px;
  box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
  width: 100%;
  max-width: 500px;
  display: flex;
  flex-direction: column;
}
.modal-header {
  padding: 1rem 1.5rem;
  border-bottom: 1px solid #e9ecef;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.modal-header h2 {
  margin: 0;
  font-size: 1.25rem;
}
.close-btn {
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  color: #6c757d;
}
.modal-body {
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}
.modal-footer {
  padding: 1rem 1.5rem;
  border-top: 1px solid #e9ecef;
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.form-label {
  font-weight: 600;
  color: #495047;
}
.form-control,
.form-group select,
.form-group textarea {
  width: 100%;
  padding: 0.6rem;
  border: 1px solid #ced4da;
  border-radius: 4px;
  font-size: 1rem;
  box-sizing: border-box;
}
.selected-patient-display {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.6rem;
  background-color: #e9ecef;
  border-radius: 4px;
}
.clear-patient-btn {
  background: none;
  border: none;
  font-size: 1.2rem;
  cursor: pointer;
  color: #6c757d;
}
.clear-patient-btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.radio-group {
  display: flex;
  gap: 1.5rem;
  align-items: center;
}
.radio-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  font-size: 1rem;
}
.radio-label input[type='radio'] {
  width: 1.15em;
  height: 1.15em;
  cursor: pointer;
}
.radio-label input[type='radio']:disabled {
  cursor: not-allowed;
}
.btn {
  padding: 0.6rem 1.2rem;
  border-radius: 4px;
  border: 1px solid transparent;
  cursor: pointer;
  font-size: 1rem;
}
.btn-primary {
  background-color: #007bff;
  color: white;
  border-color: #007bff;
}
.btn-secondary {
  background-color: #6c757d;
  color: white;
  border-color: #6c757d;
}
.btn-outline {
  background-color: transparent;
  color: #007bff;
  border-color: #007bff;
}
.btn:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.supply-container {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.dynamic-supply-item {
  display: grid;
  grid-template-columns: 1fr 1fr auto auto;
  gap: 0.5rem;
  align-items: center;
}
.supply-type-select,
.supply-spec-select {
  padding: 0.5rem;
  border: 1px solid #ced4da;
  border-radius: 4px;
}
.spec-placeholder {
  height: 38px;
}
.quantity-stepper {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  justify-self: center;
}
.quantity-btn {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid #ced4da;
  background-color: white;
  font-size: 1.2rem;
  cursor: pointer;
  line-height: 1;
}
.quantity-display {
  font-size: 1.1rem;
  font-weight: bold;
  width: 30px;
  text-align: center;
}
.remove-item-btn {
  background: none;
  border: none;
  color: #dc3545;
  font-size: 1.5rem;
  cursor: pointer;
  justify-self: end;
}
.btn-add-supply {
  background-color: #e9ecef;
  color: #495047;
  border-color: #ced4da;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  font-weight: 500;
}
.other-supply-input {
  margin-top: 0.5rem;
}
.assignee-btn-group {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.assignee-select-wrapper {
  margin-top: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.select-label {
  font-weight: 600;
  color: #343a40;
}

.btn-assignee {
  flex: 1 1 auto;
  padding: 0.6rem 1rem;
  border-radius: 4px;
  border: 1px solid #ced4da;
  background-color: #f8f9fa;
  color: #495047;
  cursor: pointer;
  font-size: 1rem;
  font-weight: 500;
  text-align: center;
  transition: all 0.2s ease-in-out;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}

.btn-assignee:hover {
  background-color: #e9ecef;
  border-color: #adb5bd;
}

.btn-assignee.active {
  background-color: #007bff;
  color: white;
  border-color: #007bff;
  box-shadow: 0 0 0 2px rgba(0, 123, 255, 0.25);
}

/* ✨ [新增] 提示文字區塊樣式 */
.assignee-info-text {
  margin-top: 0.75rem;
  padding: 0.75rem;
  background-color: #e3f2fd; /* 淡藍色背景 */
  color: #0d47a1; /* 深藍色文字 */
  border-radius: 4px;
  font-size: 0.9rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.message-type-icon {
  font-size: 1.1em;
}
</style>
