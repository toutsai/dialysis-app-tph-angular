<!-- src/components/UserFormModal.vue (已整合預設會診班表) -->
<script setup>
import { watch, reactive, computed } from 'vue'

const props = defineProps({
  isVisible: Boolean,
  isEditing: Boolean,
  user: Object,
})

const emit = defineEmits(['close', 'save'])
const closeModal = () => emit('close')

const defaultFormState = {
  id: '',
  name: '',
  username: '',
  password: '', // ✨ 移除預設密碼，改由管理員設定符合複雜度要求的密碼
  title: '護理師',
  role: 'viewer',
  email: '',
  staffId: '',
  phone: '',
  clinicHours: [],
  defaultSchedules: [],
  // ✅ 步驟 1: 在表單預設結構中，加入 defaultConsultationSchedules
  defaultConsultationSchedules: [],
}

const form = reactive({ ...defaultFormState })

const titles = ['主治醫師', '護理長', '護理師', '專科護理師', '管理員', '書記']
const roles = [
  { value: 'admin', text: 'Admin (主任/護理長/管理員)' },
  { value: 'contributor', text: 'Contributor (醫師/專師)' },
  { value: 'editor', text: 'Editor (護理師)' },
  { value: 'viewer', text: 'Viewer (書記/白板)' },
]

// 查房班表選項 (維持不變)
const scheduleOptions = computed(() => {
  const days = ['週一', '週二', '週三', '週四', '週五', '週六', '週日']
  const shifts = { early: '早', noon: '午', late: '夜' }
  const options = []
  for (let i = 0; i < days.length; i++) {
    const dayOfWeek = (i + 1) % 7
    for (const shiftCode in shifts) {
      options.push({
        value: `${dayOfWeek}-${shiftCode}`,
        label: `${days[i]}${shifts[shiftCode]}`,
      })
    }
  }
  return options
})

// ✅ 步驟 2: 新增「會診班表」的選項資料
const consultationScheduleOptions = computed(() => {
  const days = ['週一', '週二', '週三', '週四', '週五', '週六', '週日']
  // 根據您的班表圖，欄位是上午、下午、夜間
  const shifts = { morning: '上午', afternoon: '下午', night: '夜間' }
  const options = []
  for (let i = 0; i < days.length; i++) {
    const dayOfWeek = (i + 1) % 7
    for (const shiftCode in shifts) {
      options.push({
        value: `${dayOfWeek}-${shiftCode}`, // e.g., "1-morning"
        label: `${days[i]}${shifts[shiftCode]}`, // e.g., "週一上午"
      })
    }
  }
  return options
})

watch(
  () => props.isVisible,
  (newVal) => {
    if (newVal) {
      if (props.isEditing && props.user) {
        Object.assign(form, defaultFormState, {
          ...props.user,
          staffId: props.user.staffId || '',
          phone: props.user.phone || '',
          clinicHours: props.user.clinicHours || [],
          defaultSchedules: props.user.defaultSchedules || [],
          // ✅ 步驟 3: 在編輯模式下，確保能正確載入已儲存的 defaultConsultationSchedules
          defaultConsultationSchedules: props.user.defaultConsultationSchedules || [],
        })
        form.password = ''
      } else {
        Object.assign(form, defaultFormState)
      }
    }
  },
)

watch(
  () => form.title,
  (newTitle) => {
    if (newTitle !== '主治醫師') {
      form.staffId = ''
      form.phone = ''
      form.clinicHours = []
      form.defaultSchedules = []
      // ✅ 步驟 4: 當職稱不是主治醫師時，也清空預設會診班表
      form.defaultConsultationSchedules = []
    }
  },
)

function handleSubmit() {
  const dataToSave = { ...form }
  if (props.isEditing && !dataToSave.password) {
    delete dataToSave.password
  }

  if (dataToSave.title !== '主治醫師') {
    delete dataToSave.staffId
    delete dataToSave.phone
    delete dataToSave.clinicHours
    delete dataToSave.defaultSchedules
    // ✅ 步驟 5: 在儲存時，如果不是主治醫師，也移除預設會診班表欄位
    delete dataToSave.defaultConsultationSchedules
  }
  emit('save', dataToSave)
}
</script>

<template>
  <div v-if="isVisible" class="modal-overlay" v-overlay-close="closeModal">
    <div class="modal-content">
      <header class="modal-header">
        <h2>{{ isEditing ? '編輯使用者' : '新增使用者' }}</h2>
        <button class="close-btn" @click="closeModal">×</button>
      </header>
      <main class="modal-body">
        <form @submit.prevent="handleSubmit" class="user-form">
          <!-- ... 其他表單欄位 (姓名、職稱、帳號密碼等) 維持不變 ... -->
          <div class="form-row">
            <div class="form-group">
              <label for="name">姓名</label>
              <input id="name" type="text" v-model="form.name" required />
            </div>
            <div class="form-group">
              <label for="title">職稱</label>
              <select id="title" v-model="form.title">
                <option v-for="titleOption in titles" :key="titleOption" :value="titleOption">
                  {{ titleOption }}
                </option>
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label for="username">帳號 (Username)</label>
              <input
                id="username"
                type="text"
                v-model="form.username"
                required
                :disabled="isEditing"
              />
            </div>
            <div class="form-group">
              <label for="password">密碼</label>
              <input
                id="password"
                type="password"
                v-model="form.password"
                :placeholder="isEditing ? '留白表示不更改密碼' : '至少8字元，含大小寫及數字'"
                :required="!isEditing"
              />
              <small v-if="!isEditing" class="password-hint">需包含大寫、小寫字母和數字</small>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label for="role">角色 (Role)</label>
              <select id="role" v-model="form.role">
                <option
                  v-for="roleOption in roles"
                  :key="roleOption.value"
                  :value="roleOption.value"
                >
                  {{ roleOption.text }}
                </option>
              </select>
            </div>
            <div class="form-group">
              <label for="email">Email</label>
              <input id="email" type="email" v-model="form.email" />
            </div>
          </div>

          <div v-if="form.title === '主治醫師'" class="physician-fields">
            <hr class="field-separator" />
            <div class="form-row">
              <div class="form-group">
                <label for="staffId">員工編號</label>
                <input id="staffId" type="text" v-model="form.staffId" />
              </div>
              <div class="form-group">
                <label for="phone">電話</label>
                <input id="phone" type="tel" v-model="form.phone" />
              </div>
            </div>

            <!-- 預設查房班表設定 UI (維持不變) -->
            <div class="form-group">
              <label>預設查房班表 (洗腎室/ICU)</label>
              <div class="schedule-checkbox-group">
                <div v-for="option in scheduleOptions" :key="option.value" class="checkbox-wrapper">
                  <input
                    type="checkbox"
                    :id="`sched-${option.value}`"
                    :value="option.value"
                    v-model="form.defaultSchedules"
                  />
                  <label :for="`sched-${option.value}`">{{ option.label }}</label>
                </div>
              </div>
            </div>

            <!-- ✅ 步驟 6: 新增「預設會診班表」的 UI -->
            <div class="form-group">
              <label>預設會診班表</label>
              <div class="schedule-checkbox-group">
                <div
                  v-for="option in consultationScheduleOptions"
                  :key="option.value"
                  class="checkbox-wrapper"
                >
                  <input
                    type="checkbox"
                    :id="`consult-sched-${option.value}`"
                    :value="option.value"
                    v-model="form.defaultConsultationSchedules"
                  />
                  <label :for="`consult-sched-${option.value}`">{{ option.label }}</label>
                </div>
              </div>
            </div>
          </div>
        </form>
      </main>
      <footer class="modal-footer">
        <button class="btn btn-save" @click="handleSubmit">儲存</button>
        <button class="btn btn-cancel" @click="closeModal">取消</button>
      </footer>
    </div>
  </div>
</template>

<!-- Style 部分完全不需要修改，因為我們複用了 schedule-checkbox-group 的樣式 -->
<style scoped>
/* ... 您的所有 CSS 樣式 ... */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.6);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
  padding: 1rem;
}

.modal-content {
  background: white;
  padding: 2rem;
  border-radius: 8px;
  width: 100%;
  max-width: 650px;
  box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
  max-height: 90vh;
  overflow-y: auto;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #eee;
  padding-bottom: 1rem;
  margin-bottom: 1.5rem;
}

.modal-header h2 {
  margin: 0;
  font-size: 1.5rem;
}

.close-btn {
  background: none;
  border: none;
  font-size: 2rem;
  cursor: pointer;
  color: #888;
}
.close-btn:hover {
  color: #000;
}

.user-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.5rem;
}

.form-group {
  display: flex;
  flex-direction: column;
}

.form-group label {
  margin-bottom: 0.5rem;
  font-weight: 600;
  color: #333;
}

.password-hint {
  display: block;
  margin-top: 0.25rem;
  font-size: 0.8rem;
  color: #6c757d;
}

.form-group input,
.form-group select {
  padding: 0.75rem;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 1rem;
  width: 100%;
  box-sizing: border-box;
}

.modal-footer {
  margin-top: 2rem;
  padding-top: 1rem;
  border-top: 1px solid #eee;
  display: flex;
  justify-content: flex-end;
  gap: 1rem;
}

.btn {
  padding: 0.6rem 1.5rem;
  border-radius: 5px;
  border: none;
  cursor: pointer;
  font-weight: bold;
  font-size: 1rem;
  transition: all 0.2s ease;
}

.btn-cancel {
  background-color: #f0f0f0;
  border: 1px solid #ccc;
}
.btn-cancel:hover {
  background-color: #e0e0e0;
}

.btn-save {
  background-color: #007bff;
  color: white;
}
.btn-save:hover {
  background-color: #0056b3;
}

.physician-fields {
  margin-top: 1rem;
}
.field-separator {
  border: none;
  border-top: 1px solid #eee;
  margin: 1rem 0;
}

/* ✨ 8. 新增：預設班表 checkboxes 的樣式 ✨ */
.schedule-checkbox-group {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
  gap: 10px;
  padding: 10px;
  border: 1px solid #ccc;
  border-radius: 4px;
}
.checkbox-wrapper {
  display: flex;
  align-items: center;
}
.checkbox-wrapper input[type='checkbox'] {
  width: auto; /* 覆蓋 .form-group input 的 width: 100% */
  margin-right: 8px;
}
.checkbox-wrapper label {
  font-weight: normal; /* 取消 label 的粗體 */
  margin-bottom: 0; /* 覆蓋掉 .form-group label 的 margin */
  cursor: pointer; /* 增加點擊區域 */
}

/* ================================== */
/* ‼️        新增的響應式樣式        ‼️ */
/* ================================== */
@media (max-width: 768px) {
  .modal-overlay {
    align-items: flex-start;
  }

  .modal-content {
    padding: 1.5rem;
    margin-top: 5vh;
  }

  .form-row {
    grid-template-columns: 1fr;
    gap: 1rem;
  }

  .modal-footer {
    flex-direction: column-reverse;
    gap: 0.75rem;
  }

  .modal-footer .btn {
    width: 100%;
  }

  .modal-header h2 {
    font-size: 1.25rem;
  }
}
</style>
