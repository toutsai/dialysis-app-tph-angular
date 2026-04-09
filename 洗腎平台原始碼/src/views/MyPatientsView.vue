<!-- 檔案路徑: src/views/MyPatientsView.vue (✨ 新版面配置 ✨) -->
<template>
  <div class="my-patients-container">
    <!-- ✨ 核心修改 1: 重構 page-header 結構 ✨ -->
    <div class="page-header">
      <div class="header-main-row">
        <h1 class="page-title">今日病人清單</h1>

        <!-- 將跑馬燈元件移動到這裡 -->
        <div class="header-marquee-container">
          <MarqueeBanner />
        </div>

        <!-- ✨ 核心修改 1: 為按鈕加上 'desktop-only-flex' class ✨ -->
        <div class="header-actions desktop-only-flex">
          <button
            @click="openCreateModal(null)"
            class="btn btn-primary"
            :disabled="!hasPermission('viewer')"
          >
            <i class="fas fa-plus"></i> 新增交辦/留言
          </button>
          <button @click="reloadData" :disabled="isLoading" class="btn-refresh">
            <i class="fas fa-sync-alt" :class="{ 'fa-spin': isLoading }"></i>
            {{ isLoading ? '載入中...' : '重新整理' }}
          </button>
        </div>
      </div>
      <div class="view-filters">
        <div v-if="canSwitchUser" class="filter-item">
          <label for="user-select">檢視對象:</label>
          <select id="user-select" v-model="selectedUserId">
            <option :value="currentUser.uid">我自己</option>
            <option v-for="user in selectableUsers" :key="user.uid" :value="user.uid">
              {{ user.name }}
            </option>
          </select>
        </div>
        <div class="filter-item">
          <label for="date-select">檢視日期:</label>
          <input type="date" id="date-select" v-model="selectedDate" />
        </div>
      </div>
    </div>

    <div v-if="isLoading && !hasAnyPatients" class="status-panel">
      <div class="spinner"></div>
      <p>正在為您準備今日的病人照護列表...</p>
    </div>

    <div v-else-if="!hasAnyPatients" class="status-panel">
      <i class="fas fa-check-circle icon-success"></i>
      <p>您今天沒有被分配到照護病人，或班表尚未更新。</p>
    </div>

    <div v-else class="tables-container">
      <template v-for="(shiftPatients, shiftCode) in patientListByShift" :key="shiftCode">
        <div v-if="shiftPatients.length > 0" class="shift-table-section">
          <h2 class="shift-title">{{ getShiftTitle(shiftCode) }}</h2>
          <div class="table-wrapper">
            <table class="patient-table">
              <thead>
                <tr>
                  <th class="col-bed">床位</th>
                  <th class="col-name">姓名</th>
                  <th class="col-prep">AK</th>
                  <th class="col-prep">Ca</th>
                  <th class="col-prep">Heparin</th>
                  <th class="col-prep">BF</th>
                  <th class="col-access">通路/穿刺針</th>
                  <th class="col-meds">須施打藥物</th>
                  <th class="col-memos">交班備忘</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="patient in shiftPatients" :key="patient.id">
                  <td data-label="床位">{{ patient.bedNum }}</td>
                  <td
                    data-label="姓名"
                    class="patient-name clickable"
                    @click="openOrderModal(patient)"
                    title="點擊以編輯此病人醫囑"
                  >
                    <!-- ✨ 核心修改 2: 姓名設為粗體 ✨ -->
                    <strong>{{ patient.name }}</strong>
                  </td>
                  <td data-label="AK">{{ patient.preparation.ak }}</td>
                  <td data-label="Ca">{{ patient.preparation.dialysateCa }}</td>
                  <td data-label="Heparin">{{ patient.preparation.heparin }}</td>
                  <td data-label="BF">{{ patient.preparation.bloodFlow }}</td>
                  <td data-label="通路/穿刺針">{{ patient.preparation.vascAccess }}</td>
                  <td data-label="須施打藥物">
                    <ul v-if="patient.injections.length > 0" class="info-list">
                      <li v-for="injection in patient.injections" :key="injection.orderCode">
                        {{ formatInjection(injection) }}
                      </li>
                    </ul>
                    <span v-else class="no-data">–</span>
                  </td>
                  <td data-label="交班備忘">
                    <ul v-if="patient.memos.length > 0" class="info-list memo-list">
                      <li v-for="memo in patient.memos" :key="memo.id" class="memo-item">
                        <div class="memo-content">
                          <span class="memo-icon" :title="memo.type || '一般'">{{
                            getMessageTypeIcon(memo.type)
                          }}</span>
                          <span v-if="memo.targetDate" class="memo-date"
                            >[{{ memo.targetDate.slice(5) }}]</span
                          >
                          {{ memo.content }}
                        </div>
                        <div class="memo-actions">
                          <button @click="openEditModal(memo)" title="編輯">
                            <i class="fas fa-edit"></i>
                          </button>
                          <button @click="confirmDeleteTask(memo)" title="刪除">
                            <i class="fas fa-trash"></i>
                          </button>
                          <button
                            v-if="memo.type !== '衛教'"
                            @click="updateTaskStatus(memo, 'completed')"
                            class="btn-complete"
                            title="標示已讀"
                          >
                            <i class="fas fa-check"></i> 已讀
                          </button>
                          <span v-else class="education-task-tag" title="衛教事項"
                            ><i class="fas fa-chalkboard-teacher"></i
                          ></span>
                        </div>
                      </li>
                    </ul>
                    <span v-else class="no-data">–</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </template>
    </div>

    <!-- Dialogs -->
    <TaskCreateDialog
      :is-visible="isCreateModalVisible"
      :all-patients="patientStore.allPatients"
      :initial-data="editingItem"
      @close="closeCreateModal"
      @submit="handleTaskSubmit"
    />
    <ConfirmDialog
      :is-visible="isConfirmDeleteVisible"
      title="確認刪除"
      message="您確定要永久刪除此項目嗎？此操作無法復原。"
      confirm-text="刪除"
      cancel-text="取消"
      confirm-class="btn-danger"
      @confirm="executeDeleteTask"
      @cancel="isConfirmDeleteVisible = false"
    />
    <DialysisOrderModal
      :is-visible="isOrderModalVisible"
      :patient-data="selectedPatientForOrder"
      @close="closeOrderModal"
      @save="handleOrderSave"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useMyPatientList } from '@/composables/useMyPatientList.js'
import { useAuth } from '@/composables/useAuth'
import { usePatientStore } from '@/stores/patientStore'
import { useTaskStore } from '@/stores/taskStore'
import { useGlobalNotifier } from '@/composables/useGlobalNotifier'
import { useUserDirectory } from '@/composables/useUserDirectory'
import { formatDateToYYYYMMDD } from '@/utils/dateUtils' // ✨ 1. 引入您的日期工具函式
import { systemApi, patientsApi, ordersApi } from '@/services/localApiClient'

// Component Imports
import TaskCreateDialog from '@/components/TaskCreateDialog.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import DialysisOrderModal from '@/components/DialysisOrderModal.vue'
import MarqueeBanner from '@/components/MarqueeBanner.vue' // ✨ 核心修改 2: 引入跑馬燈元件

// Shared Logic Imports
import { handleTaskCreated } from '@/utils/taskHandlers.js'

// --- 初始化 Composables 和 Stores ---
const { currentUser, hasPermission } = useAuth()
const patientStore = usePatientStore()
const taskStore = useTaskStore()
const { createGlobalNotification } = useGlobalNotifier()
const { ensureUsersLoaded, users: userDirectoryUsers, clearCachedUsers } = useUserDirectory()

// ✨ 核心修改 3: 重構 useMyPatientList 的使用方式 ✨
const selectedUserId = ref(currentUser.value?.uid)
const selectedDate = ref(formatDateToYYYYMMDD()) // ✨ 3. 使用新的函式來初始化日期

// 將 useMyPatientList 的呼叫放到 computed 中，使其能響應 selectedUserId 和 selectedDate 的變化
const { isLoading, patientListByShift, fetchMyPatientData } = useMyPatientList(
  computed(() => selectedUserId.value),
  computed(() => selectedDate.value),
)

const selectableUsers = ref([])
const canSwitchUser = computed(() => !!currentUser.value)
const SELECTABLE_USERS_TTL = 10 * 60 * 1000
let lastSelectableUsersUpdatedAt = 0

// --- 藥品對照表和轉換函式 ---
const INJECTION_MEDS_MASTER = [
  { code: 'INES2', tradeName: 'NESP', unit: 'mcg' },
  { code: 'IREC1', tradeName: 'Recormon', unit: 'KIU' },
  { code: 'IFER2', tradeName: 'Fe-back', unit: 'mg' },
  { code: 'ICAC', tradeName: 'Cacare', unit: 'amp' },
  { code: 'IPAR1', tradeName: 'Parsabiv', unit: 'mg' },
]
const injectionMasterMap = new Map(INJECTION_MEDS_MASTER.map((med) => [med.code, med]))

function formatInjection(injection) {
  const masterInfo = injectionMasterMap.get(injection.orderCode)
  const displayName = masterInfo?.tradeName || injection.orderName || '未知藥品'
  const unit = masterInfo?.unit || ''
  const doseStr = injection.dose ? `${injection.dose}${unit ? ' ' + unit : ''}` : ''

  const parts = [displayName, doseStr].filter(Boolean)
  return parts.join(' ')
}

// --- Dialog 狀態管理 ---
const isCreateModalVisible = ref(false)
const editingItem = ref(null)
const isConfirmDeleteVisible = ref(false)
const itemToDelete = ref(null)
const isOrderModalVisible = ref(false)
const selectedPatientForOrder = ref(null)

// --- Computed Properties ---
const todayDateString = computed(() =>
  new Date().toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' }),
)
const hasAnyPatients = computed(() => {
  if (!patientListByShift.value) return false
  return Object.values(patientListByShift.value).some((list) => list.length > 0)
})

const statusMessage = computed(() => {
  if (selectedUserId.value !== currentUser.value?.uid) {
    const selectedUserName =
      selectableUsers.value.find((u) => u.uid === selectedUserId.value)?.name || ''
    return `${selectedUserName} 在 ${selectedDate.value} 沒有被分配到照護病人。`
  }
  return '您今天沒有被分配到照護病人，或班表尚未更新。'
})

// --- 輔助函式 ---
const getShiftTitle = (shiftCode) => {
  const map = {
    early: '早班 (主責)',
    noonOn: '午班 (上針)',
    noonOff: '午班 (收針)',
    late: '晚班 (主責)',
  }
  return map[shiftCode] || shiftCode
}

function getMessageTypeIcon(type) {
  switch (type) {
    case '抽血':
      return '🩸'
    case '衛教':
      return '📢'
    case '常規':
    default:
      return '📝'
  }
}

// --- 事件處理函式 ---

function openCreateModal(itemToEdit = null) {
  if (!hasPermission('viewer')) {
    createGlobalNotification('您的權限不足，無法執行此操作。', 'error')
    return
  }
  editingItem.value = itemToEdit
  isCreateModalVisible.value = true
}

function closeCreateModal() {
  isCreateModalVisible.value = false
  editingItem.value = null
}

async function handleTaskSubmit(data) {
  if (data.id) {
    const { id, ...updateData } = data
    try {
      await systemApi.updateTask(id, updateData)
      createGlobalNotification('備忘已更新', 'success')
    } catch (error) {
      console.error('更新項目失敗:', error)
      createGlobalNotification('更新失敗，請稍後再試', 'error')
    }
  } else {
    try {
      await handleTaskCreated(data, currentUser.value)
      createGlobalNotification('交辦/留言已成功新增！', 'success')
    } catch (error) {
      console.error('新增項目失敗:', error)
      createGlobalNotification(`新增失敗: ${error.message}`, 'error')
    }
  }
  closeCreateModal()
  // 立即刷新任務列表，讓新任務馬上顯示
  await taskStore.refreshTasks()
}

async function updateTaskStatus(task, newStatus) {
  if (!currentUser.value) return
  try {
    const updateData = {
      status: newStatus,
      resolvedBy: { uid: currentUser.value.uid, name: currentUser.value.name },
      resolvedAt: new Date().toISOString(),
    }
    await systemApi.updateTask(task.id, updateData)
    createGlobalNotification(
      newStatus === 'completed' ? '狀態已更新為已讀' : '狀態已移回待辦',
      'success',
    )
    // 立即刷新任務列表
    await taskStore.refreshTasks()
  } catch (error) {
    console.error('更新任務狀態失敗:', error)
    createGlobalNotification('更新失敗，請稍後再試', 'error')
  }
}

function confirmDeleteTask(item) {
  itemToDelete.value = item
  isConfirmDeleteVisible.value = true
}

async function executeDeleteTask() {
  if (!itemToDelete.value) return
  try {
    await systemApi.deleteTask(itemToDelete.value.id)
    createGlobalNotification('訊息已刪除', 'info')
    // 立即刷新任務列表
    await taskStore.refreshTasks()
  } catch (error) {
    console.error('刪除任務失敗:', error)
    createGlobalNotification('刪除失敗，請稍後再試', 'error')
  }
  isConfirmDeleteVisible.value = false
  itemToDelete.value = null
}

function openEditModal(itemToEdit) {
  openCreateModal(itemToEdit)
}

function openOrderModal(patientFromList) {
  const fullPatientData = patientStore.allPatients.find((p) => p.id === patientFromList.patientId)
  if (fullPatientData) {
    selectedPatientForOrder.value = fullPatientData
    isOrderModalVisible.value = true
  } else {
    console.error('找不到完整的病人資料:', patientFromList.patientId)
    createGlobalNotification('無法載入病人醫囑，請稍後再試', 'error')
  }
}

function closeOrderModal() {
  isOrderModalVisible.value = false
  selectedPatientForOrder.value = null
}

async function handleOrderSave(updatedOrders) {
  if (!selectedPatientForOrder.value) return

  try {
    await patientsApi.update(selectedPatientForOrder.value.id, {
      dialysisOrders: updatedOrders,
    })

    await ordersApi.createHistory({
      patientId: selectedPatientForOrder.value.id,
      patientName: selectedPatientForOrder.value.name,
      orders: updatedOrders,
      operationType: 'UPDATE',
    })

    createGlobalNotification(`${selectedPatientForOrder.value.name} 的醫囑已更新`, 'success')
    patientStore.updatePatientOrders(selectedPatientForOrder.value.id, updatedOrders)
    closeOrderModal()
  } catch (error) {
    console.error('儲存醫囑失敗:', error)
    createGlobalNotification('醫囑儲存失敗，請檢查網路連線', 'error')
  }
}
// ✨ 核心修改 4: 新增或修改的事件處理函式 ✨
function reloadData() {
  fetchMyPatientData(selectedDate.value)
}

async function loadSelectableUsers({ force = false } = {}) {
  if (!canSwitchUser.value) {
    selectableUsers.value = []
    return
  }

  const now = Date.now()
  if (
    !force &&
    selectableUsers.value.length > 0 &&
    now - lastSelectableUsersUpdatedAt < SELECTABLE_USERS_TTL
  ) {
    return
  }

  try {
    await ensureUsersLoaded(force)
    const filteredUsers = userDirectoryUsers.value
      .filter((user) => ['護理師', '護理師組長'].includes(user.title) && user.username)
      .map((user) => ({
        uid: user.uid,
        name: user.name,
        username: user.username,
      }))

    selectableUsers.value = filteredUsers.sort((a, b) => {
      const idA = parseInt(a.username, 10)
      const idB = parseInt(b.username, 10)
      if (!isNaN(idA) && !isNaN(idB)) {
        return idA - idB
      }
      return String(a.username).localeCompare(String(b.username), undefined, { numeric: true })
    })
    lastSelectableUsersUpdatedAt = now
  } catch (error) {
    console.error('無法載入使用者列表:', error)
  }
}

watch(
  () => currentUser.value,
  (newUser) => {
    if (newUser) {
      selectedUserId.value = newUser.uid
      loadSelectableUsers({ force: true })
    } else {
      selectedUserId.value = null
      selectableUsers.value = []
      clearCachedUsers()
      lastSelectableUsersUpdatedAt = 0
    }
  },
  { immediate: true },
)
</script>

<style scoped>
/* ================================== */
/*         通用及桌面版樣式            */
/* ================================== */
.my-patients-container {
  padding: 10px;
  background-color: #f8f9fa;
  height: 100%;
  display: flex;
  flex-direction: column;
}

/* ✨ 核心修改 2: 更新 page-header 的樣式 ✨ */
.page-header {
  display: flex;
  flex-direction: column; /* 改為垂直堆疊 */
  gap: 1rem; /* 標題列和篩選器列之間的間距 */
  margin-bottom: 1rem; /* 與下方內容的間距 */
  flex-shrink: 0;
}

.header-main-row {
  display: flex;
  align-items: center;
  gap: 1.5rem; /* 標題、跑馬燈、按鈕之間的間距 */
  width: 100%;
}

.page-title {
  font-size: 32px;
  font-weight: bold;
  color: #2c3e50;
  margin: 0;
  white-space: nowrap; /* 確保標題本身不換行 */
}

.header-marquee-container {
  flex-grow: 1; /* 這是關鍵：讓跑馬燈容器填滿中間的空間 */
  min-width: 0; /* 允許容器在空間不足時被壓縮 */
}

/* ✨ 核心修改 3: 調整 MarqueeBanner 的樣式 ✨ */
/* 我們需要使用 :deep() 來修改子元件的根元素樣式 */
:deep(.marquee-banner) {
  margin-bottom: 0; /* 移除原本與下方內容的間距 */
  height: 45px; /* 讓高度與右側按鈕大致對齊 */
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.page-subtitle {
  font-size: 1rem;
  color: #6c757d;
  margin: 0.25rem 0 0 0;
}

.btn {
  padding: 0.5rem 1rem;
  border-radius: 5px;
  cursor: pointer;
  font-weight: 500;
  transition: background-color 0.2s;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.btn-primary {
  background-color: #007bff;
  color: white;
  border: none;
}
.btn-primary:hover:not(:disabled) {
  background-color: #0056b3;
}

.btn-refresh {
  padding: 0.5rem 1rem;
  background-color: #6c757d;
  color: white;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 500;
  transition: background-color 0.2s;
}

.btn-refresh:hover:not(:disabled) {
  background-color: #5a6268;
}

.btn-refresh:disabled {
  background-color: #adb5bd;
  cursor: not-allowed;
}

.status-panel {
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  background-color: #ffffff;
  border-radius: 8px;
  padding: 2rem;
  color: #6c757d;
  font-size: 1.1rem;
}

.icon-success {
  font-size: 3rem;
  color: #28a745;
  margin-bottom: 1rem;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 4px solid #f3f3f3;
  border-top: 4px solid #007bff;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 1rem;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

.tables-container {
  flex-grow: 1;
  overflow-y: auto;
  min-height: 0;
}

.shift-table-section {
  margin-bottom: 2.5rem;
}

.shift-title {
  font-size: 1.5rem;
  font-weight: 600;
  color: #343a40;
  margin-bottom: 1rem;
  padding-bottom: 0.5rem;
  border-bottom: 2px solid #007bff;
  position: sticky;
  top: 0;
  background-color: #f8f9fa;
  z-index: 10;
}

.table-wrapper {
  overflow-x: auto;
  background-color: #ffffff;
  border: 1px solid #dee2e6;
  border-radius: 8px;
}

.patient-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.95rem;
}

.patient-table th,
.patient-table td {
  border: 1px solid #dee2e6;
  padding: 12px 15px;
  text-align: center;
  vertical-align: middle;
}

.patient-table th {
  background-color: #f0f3f5;
  font-weight: 600;
  position: sticky;
  top: 0;
  z-index: 5;
}

.patient-table td:nth-child(1),
.patient-table td:nth-child(2) {
  background-color: #f7faff;
}
.patient-table td:nth-child(n + 3):nth-child(-n + 7) {
  background-color: #f8fcf8;
}

.patient-table tbody tr:hover td {
  background-color: #f1f7ff;
}

.patient-name {
  font-weight: 500;
}

.patient-name.clickable {
  cursor: pointer;
  color: #0056b3;
  text-decoration: underline;
  text-decoration-color: transparent;
  transition: text-decoration-color 0.2s;
}

.patient-name.clickable:hover {
  text-decoration-color: #0056b3;
}

.info-list {
  list-style-type: none;
  padding: 0;
  margin: 0;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.no-data {
  color: #adb5bd;
}

.col-bed {
  width: 4%;
}
.col-name {
  width: 7%;
}
.col-prep {
  width: 5%;
}
.col-access {
  width: 10%;
}
.col-meds {
  width: 15%;
}
.col-memos {
  width: 54%;
}

.memo-list {
  gap: 8px;
}
.memo-item {
  position: relative;
  padding: 8px 12px;
  background-color: #fff9e6;
  border-left: 3px solid #ffc107;
  border-radius: 4px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}
.memo-content {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-grow: 1;
  word-break: break-all;
}
.memo-icon {
  font-size: 1.2rem;
}
.memo-date {
  font-weight: bold;
  color: #007bff;
  white-space: nowrap;
}
.memo-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}
.memo-actions button {
  background: none;
  border: none;
  cursor: pointer;
  color: #6c757d;
  padding: 4px;
  border-radius: 4px;
  transition: all 0.2s;
}
.memo-actions button:hover {
  background-color: #e9ecef;
  color: #212529;
}
.memo-actions .btn-complete {
  background-color: #007bff;
  color: white;
  padding: 4px 8px;
  font-size: 0.8rem;
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}
.memo-actions .btn-complete:hover {
  background-color: #0056b3;
}
.education-task-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8rem;
  padding: 4px 10px;
  border-radius: 4px;
  background-color: #f0fdf4;
  color: #15803d;
  font-weight: 500;
}

/* ✨ 核心修改 5: 新增篩選器樣式 ✨ */
.view-filters {
  display: flex;
  align-items: center;
  gap: 1.5rem;
}
.filter-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.filter-item label {
  font-weight: 500;
  color: #495057;
}
.filter-item select,
.filter-item input[type='date'] {
  padding: 0.5rem;
  border-radius: 4px;
  border: 1px solid #ced4da;
  font-size: 1rem;
}

/* ✨ 核心修改 6: 病人姓名粗體 ✨ */
.patient-name strong {
  font-weight: 700; /* 使用 700 來確保粗體效果 */
}

/* ================================== */
/*         ✨✨ 行動版優化 ✨✨         */
/* ================================== */
@media (max-width: 768px) {
  .my-patients-container {
    padding: 8px;
  }

  .header-main-row {
    /* 在行動版上，讓跑馬燈佔滿剩餘空間，按鈕會被隱藏 */
    justify-content: space-between;
  }

  /*
    這是一個新的通用 class，專門用來在行動版上隱藏元素。
    我們用 'display: none !important' 來確保它的優先級最高。
    'desktop-only-flex' 只是為了語意化，表示這個 flex 容器只在桌面版顯示。
  */
  .desktop-only-flex {
    display: none !important;
  }

  .page-title {
    font-size: 2rem;
  }

  .header-actions {
    justify-content: space-between;
  }

  .header-actions .btn {
    flex-grow: 1;
    justify-content: center;
  }

  .shift-title {
    font-size: 1.2rem;
  }

  .table-wrapper {
    border: none;
    overflow-x: visible;
  }

  /* --- 核心: 表格轉卡片 --- */
  .patient-table {
    border: none;
  }

  .patient-table thead {
    /* 隱藏桌面版的表頭 */
    display: none;
  }

  .patient-table tr {
    /* 每一個 tr 變成一張卡片 */
    display: block;
    margin-bottom: 1rem;
    border: 1px solid #dee2e6;
    border-radius: 8px;
    background-color: #fff;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  }

  .patient-table td {
    /* 每一個 td 變成一行 */
    display: block;
    text-align: right; /* 資料靠右 */
    padding-left: 50%; /* 留出左半邊給標籤 */
    position: relative;
    border: none;
    border-bottom: 1px solid #f0f0f0;
    background-color: transparent !important; /* 取消分區顏色 */
  }

  .patient-table tr td:last-child {
    border-bottom: none;
  }

  /* 使用 ::before 偽元素來顯示標籤 */
  .patient-table td::before {
    content: attr(data-label); /* 讀取 data-label 的內容 */
    position: absolute;
    left: 15px;
    width: calc(50% - 25px);
    text-align: left; /* 標籤靠左 */
    font-weight: bold;
    color: #333;
  }

  /* --- 針對特殊欄位微調 --- */

  /* 姓名欄位特別樣式 */
  .patient-table td[data-label='姓名'] {
    font-size: 1.1rem;
    font-weight: bold;
    background-color: #f8f9fa;
  }

  /* 藥物和備忘欄位內容靠左對齊 */
  .patient-table td[data-label='須施打藥物'],
  .patient-table td[data-label='交班備忘'] {
    text-align: left;
    padding-top: 2.5rem; /* 給標題留出空間 */
    padding-left: 15px;
  }
  .patient-table td[data-label='須施打藥物']::before,
  .patient-table td[data-label='交班備忘']::before {
    top: 12px;
  }
}
</style>
