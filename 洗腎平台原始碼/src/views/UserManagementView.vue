<script setup>
import { ref, onMounted, computed } from 'vue'
import ApiManager from '@/services/api_manager'
import { useAuth } from '@/composables/useAuth'
import { useGlobalNotifier } from '@/composables/useGlobalNotifier.js'
import UserFormModal from '@/components/UserFormModal.vue'
import AlertDialog from '@/components/AlertDialog.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { formatDateToChinese, parseFirestoreTimestamp } from '@/utils/dateUtils.js'
import { authApi } from '@/services/localApiClient'

// --- API and State ---
const usersApi = ApiManager('users')
const users = ref([])
const isLoading = ref(true)
const searchTerm = ref('')
const isModalVisible = ref(false)
const isEditing = ref(false)
const userToEdit = ref(null)
const selectedRole = ref('all')
const sortBy = ref('name')
const sortOrder = ref('asc')
const isSubmitting = ref(false)
const isDeletingUser = ref(null)

// --- Admin Tools State ---
const isMigrationLoading = ref(false)
const isExpireLoading = ref(false)
const isUploadingToDrive = ref(false)
const selectedFileForDrive = ref(null)
const isResyncLoading = ref(false) // ✨ 新增: 強制同步按鈕的載入狀態

// --- Dialog State ---
const alertInfo = ref({ isVisible: false, title: '', message: '' })
const confirmInfo = ref({
  isVisible: false,
  title: '',
  message: '',
  onConfirm: () => {},
  onCancel: () => {},
  // ✨ 新增: 自訂按鈕文字
  confirmText: '確認',
  cancelText: '取消',
})

// --- 權限控制 ---
const { isAdmin } = useAuth()
const { createGlobalNotification: createGlobalNotifier } = useGlobalNotifier()

// --- Helper Functions ---
function formatDate(timestamp) {
  if (!timestamp) return 'N/A'
  const date = parseFirestoreTimestamp(timestamp)
  if (isNaN(date)) return '無效日期'
  return formatDateToChinese(date)
}

const roleOptions = [
  { value: 'all', label: '全部角色' },
  { value: 'admin', label: '管理員' },
  { value: 'editor', label: '編輯者' },
  { value: 'contributor', label: '貢獻者' },
  { value: 'viewer', label: '查看者' },
]

const sortOptions = [
  { value: 'name', label: '姓名' },
  { value: 'username', label: '帳號' },
  { value: 'role', label: '角色' },
  { value: 'createdAt', label: '建立時間' },
]

// --- Computed Properties ---
const userStats = computed(() => ({
  total: users.value.length,
  filtered: filteredUsers.value.length,
}))

const filteredUsers = computed(() => {
  let result = users.value
  if (selectedRole.value !== 'all') {
    result = result.filter((user) => user.role === selectedRole.value)
  }
  if (searchTerm.value) {
    const search = searchTerm.value.toLowerCase()
    result = result.filter(
      (user) =>
        user.name?.toLowerCase().includes(search) ||
        user.username?.toLowerCase().includes(search) ||
        user.email?.toLowerCase().includes(search) ||
        user.title?.toLowerCase().includes(search),
    )
  }
  return [...result].sort((a, b) => {
    if (a.role === 'admin' && b.role !== 'admin') return -1
    if (b.role === 'admin' && a.role !== 'admin') return 1
    let aValue = a[sortBy.value]
    let bValue = b[sortBy.value]
    if (sortBy.value.includes('At') && aValue && bValue) {
      aValue = aValue.toDate ? aValue.toDate() : new Date(aValue)
      bValue = bValue.toDate ? bValue.toDate() : new Date(bValue)
    }
    if (typeof aValue === 'string' && typeof bValue === 'string') {
      aValue = aValue.toLowerCase()
      bValue = bValue.toLowerCase()
    }
    if (sortOrder.value === 'asc') {
      return aValue > bValue ? 1 : aValue < bValue ? -1 : 0
    } else {
      return aValue < bValue ? 1 : aValue > bValue ? -1 : 0
    }
  })
})

// --- Dialog Helper Functions ---
function showAlert(title, message) {
  alertInfo.value = { isVisible: true, title, message }
}
function handleAlertConfirm() {
  alertInfo.value.isVisible = false
}

// ✨ 修改 showConfirm 以支援自訂按鈕文字
function showConfirm(title, message, confirmAction, options = {}) {
  confirmInfo.value = {
    isVisible: true,
    title,
    message,
    onConfirm: () => {
      confirmInfo.value.isVisible = false
      confirmAction()
    },
    onCancel: () => {
      confirmInfo.value.isVisible = false
    },
    confirmText: options.confirmText || '確認',
    cancelText: options.cancelText || '取消',
  }
}

// --- Functions ---
function clearSearch() {
  searchTerm.value = ''
  selectedRole.value = 'all'
}

async function fetchUsers() {
  isLoading.value = true
  try {
    users.value = await usersApi.fetchAll()
  } catch (error) {
    console.error('載入用戶失敗:', error)
  } finally {
    isLoading.value = false
  }
}

function handleAddUser() {
  if (!isAdmin.value) return
  isEditing.value = false
  userToEdit.value = null
  isModalVisible.value = true
}

function handleEditUser(user) {
  if (!isAdmin.value) return
  isEditing.value = true
  userToEdit.value = JSON.parse(JSON.stringify(user))
  isModalVisible.value = true
}

async function handleDeleteUser(userId, userName) {
  if (!isAdmin.value) return
  showConfirm('確認刪除', `您確定要刪除使用者 "${userName}" 嗎？此操作無法復原。`, async () => {
    isDeletingUser.value = userId
    const userIndex = users.value.findIndex((user) => user.id === userId)
    let removedUser = null
    if (userIndex !== -1) {
      removedUser = users.value.splice(userIndex, 1)[0]
    }
    try {
      await usersApi.delete(userId)
      showAlert('成功', '使用者已成功刪除。')
    } catch (error) {
      if (removedUser && userIndex !== -1) {
        users.value.splice(userIndex, 0, removedUser)
      }
      showAlert('刪除失敗', '刪除使用者時發生錯誤，請稍後再試。')
    } finally {
      isDeletingUser.value = null
    }
  })
}

async function handleSaveUser(userData) {
  if (!isAdmin.value) return
  isSubmitting.value = true
  try {
    if (isEditing.value) {
      const { id, password, ...updateData } = userData
      updateData.updatedAt = new Date()

      if (password) {
        try {
          // Use local API for password reset
          await authApi.resetPassword(id, password)
        } catch (pwError) {
          console.error('密碼更新失敗:', pwError)
          showAlert('密碼更新失敗', pwError.message || '密碼更新時發生錯誤。')
          isSubmitting.value = false
          return
        }
      }

      const userIndex = users.value.findIndex((user) => user.id === id)
      let originalUser = null
      if (userIndex !== -1) {
        originalUser = { ...users.value[userIndex] }
        users.value[userIndex] = { ...users.value[userIndex], ...updateData }
      }
      try {
        await usersApi.update(id, updateData)
        showAlert('成功', '使用者資料已更新。')
      } catch (error) {
        if (originalUser && userIndex !== -1) {
          users.value[userIndex] = originalUser
        }
        throw error
      }
    } else {
      const { id, ...dataToSave } = userData
      try {
        const result = await authApi.createUser(dataToSave)
        // 重新載入整個使用者列表以確保資料同步
        await fetchUsers()
        showAlert('成功', '使用者已新增。')
      } catch (createError) {
        console.error('建立用戶失敗:', createError)
        showAlert('建立失敗', createError.message || '建立使用者時發生錯誤。')
        isSubmitting.value = false
        return
      }
    }
    isModalVisible.value = false
  } catch (error) {
    showAlert('儲存失敗', '儲存使用者資料時發生錯誤。')
  } finally {
    isSubmitting.value = false
  }
}

async function copyEmail(email) {
  try {
    await navigator.clipboard.writeText(email)
    showAlert('已複製', `Email 地址 "${email}" 已複製到剪貼簿`)
  } catch (err) {
    showAlert('Email 地址', `請手動複製: ${email}`)
  }
}

// --- Admin Tools Functions ---

async function triggerForceResync() {
  showAlert('功能不可用', '此管理功能僅在線上模式下可用。')
}

async function triggerMigration() {
  showAlert('功能不可用', '此管理功能僅在線上模式下可用。')
}

async function triggerManualExpire() {
  showAlert('功能不可用', '此管理功能僅在線上模式下可用。')
}

function handleFileSelectForDrive(event) {
  selectedFileForDrive.value = event.target.files[0]
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = () => {
      const base64String = reader.result.split(',')[1]
      resolve(base64String)
    }
    reader.onerror = (error) => reject(error)
  })
}

async function triggerUploadToDrive() {
  showAlert('功能不可用', 'Google Drive 上傳功能僅在線上模式下可用。')
}

onMounted(() => {
  if (isAdmin.value) {
    fetchUsers()
  } else {
    isLoading.value = false
  }
})
</script>

<template>
  <div class="user-management-container">
    <header class="page-header">
      <div class="header-top">
        <h1>使用者帳號管理</h1>
        <div v-if="!isLoading && userStats.total > 0" class="user-stats">
          <span class="stats-total">總計: {{ userStats.total }}</span>
          <span v-if="userStats.filtered !== userStats.total" class="stats-filtered">
            顯示: {{ userStats.filtered }}
          </span>
        </div>
      </div>
      <div class="header-controls">
        <div class="search-filters">
          <div class="search-group">
            <input
              type="text"
              v-model="searchTerm"
              placeholder="搜尋姓名/帳號/Email/職稱..."
              class="search-input"
            />
            <button
              v-if="searchTerm || selectedRole !== 'all'"
              @click="clearSearch"
              class="clear-search-btn"
              title="清除搜尋"
            >
              ×
            </button>
          </div>
          <select v-model="selectedRole" class="role-filter">
            <option v-for="option in roleOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
          <div class="sort-group">
            <select v-model="sortBy" class="sort-select">
              <option v-for="option in sortOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
            <button
              @click="sortOrder = sortOrder === 'asc' ? 'desc' : 'asc'"
              class="sort-order-btn"
            >
              {{ sortOrder === 'asc' ? '↑' : '↓' }}
            </button>
          </div>
        </div>
        <div class="header-actions">
          <!-- ✨ 新增: 強制同步排程按鈕 ✨ -->
          <button
            v-if="isAdmin"
            class="btn btn-danger"
            @click="triggerForceResync"
            :disabled="isResyncLoading"
            title="強制使用總床位表重新生成未來60天的排程，用於修復資料錯亂。"
          >
            <i v-if="isResyncLoading" class="fas fa-spinner fa-spin"></i>
            {{ isResyncLoading ? '同步中...' : '🚨 強制同步排程' }}
          </button>

          <!-- 遷移歷史排班按鈕 -->
          <button
            v-if="isAdmin"
            class="btn btn-warning"
            @click="triggerMigration"
            :disabled="isMigrationLoading"
            title="這是一個一次性的資料庫維護操作"
          >
            <i v-if="isMigrationLoading" class="fas fa-spinner fa-spin"></i>
            {{ isMigrationLoading ? '遷移中...' : '遷移歷史排班' }}
          </button>

          <!-- 手動更新過期留言按鈕 -->
          <button
            v-if="isAdmin"
            class="btn btn-info"
            @click="triggerManualExpire"
            :disabled="isExpireLoading"
            title="手動將已過期的留言標記為 'expired' 狀態"
          >
            <i v-if="isExpireLoading" class="fas fa-spinner fa-spin"></i>
            {{ isExpireLoading ? '更新中...' : '更新過期留言' }}
          </button>

          <!-- Google Drive 上傳測試區塊 -->
          <div v-if="isAdmin" class="gdrive-upload-group">
            <input type="file" @change="handleFileSelectForDrive" class="file-input-drive" />
            <button
              class="btn btn-info"
              @click="triggerUploadToDrive"
              :disabled="!selectedFileForDrive || isUploadingToDrive"
            >
              <i v-if="isUploadingToDrive" class="fas fa-spinner fa-spin"></i>
              {{ isUploadingToDrive ? '上傳中...' : '上傳至雲端硬碟' }}
            </button>
          </div>

          <!-- 新增使用者按鈕 -->
          <button
            v-if="isAdmin"
            class="btn btn-primary"
            @click="handleAddUser"
            :disabled="isSubmitting"
          >
            <span v-if="isSubmitting">處理中...</span>
            <span v-else>+ 新增使用者</span>
          </button>
        </div>
      </div>
    </header>

    <div v-if="isLoading" class="loading-container">
      <div class="loading-spinner"></div>
      <p>正在載入用戶列表...</p>
    </div>

    <div v-else-if="filteredUsers.length > 0" class="user-table-container">
      <!-- 桌機版表格 -->
      <table class="user-table desktop-only">
        <thead>
          <tr>
            <th>姓名</th>
            <th>帳號</th>
            <th>職稱</th>
            <th>角色</th>
            <th>異動日期</th>
            <th v-if="isAdmin">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="user in filteredUsers"
            :key="user.id"
            :class="{ 'deleting-row': isDeletingUser === user.id }"
          >
            <td data-label="姓名">
              {{ user.name }}
              <span v-if="user.role === 'admin'" class="admin-badge">管理員</span>
            </td>
            <td data-label="帳號">{{ user.username }}</td>
            <td data-label="職稱">{{ user.title || '-' }}</td>
            <td data-label="角色">
              <span class="role-badge" :class="`role-${user.role}`">{{ user.role }}</span>
            </td>
            <td data-label="異動日期">{{ formatDate(user.updatedAt || user.createdAt) }}</td>
            <td v-if="isAdmin" data-label="操作" class="action-buttons-cell">
              <div class="action-buttons">
                <button
                  v-if="user.email"
                  class="btn-icon"
                  @click="copyEmail(user.email)"
                  :title="`複製 Email: ${user.email}`"
                  :disabled="isSubmitting || isDeletingUser === user.id"
                >
                  📧
                </button>
                <button
                  class="btn-icon"
                  @click="handleEditUser(user)"
                  title="編輯"
                  :disabled="isSubmitting || isDeletingUser === user.id"
                >
                  ✏️
                </button>
                <button
                  class="btn-icon"
                  @click="handleDeleteUser(user.id, user.name)"
                  title="刪除"
                  :disabled="isSubmitting || isDeletingUser === user.id"
                >
                  <span v-if="isDeletingUser === user.id" class="deleting-spinner">⏳</span>
                  <span v-else>🗑️</span>
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- 手機版卡片列表 -->
      <div class="user-cards-container mobile-only">
        <div
          v-for="user in filteredUsers"
          :key="user.id"
          class="user-card"
          :class="{ 'deleting-row': isDeletingUser === user.id }"
        >
          <div class="card-header">
            <span class="user-name">{{ user.name }}</span>
            <span class="role-badge" :class="`role-${user.role}`">{{ user.role }}</span>
          </div>
          <div class="card-body">
            <div class="info-row">
              <span class="info-label">帳號</span>
              <span class="info-value">{{ user.username }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">職稱</span>
              <span class="info-value">{{ user.title || '-' }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">異動日期</span>
              <span class="info-value">{{ formatDate(user.updatedAt || user.createdAt) }}</span>
            </div>
          </div>
          <div v-if="isAdmin" class="card-footer">
            <div class="action-buttons">
              <button
                v-if="user.email"
                class="btn-icon"
                @click="copyEmail(user.email)"
                :title="`複製 Email: ${user.email}`"
                :disabled="isSubmitting || isDeletingUser === user.id"
              >
                📧
              </button>
              <button
                class="btn-icon"
                @click="handleEditUser(user)"
                title="編輯"
                :disabled="isSubmitting || isDeletingUser === user.id"
              >
                ✏️
              </button>
              <button
                class="btn-icon"
                @click="handleDeleteUser(user.id, user.name)"
                title="刪除"
                :disabled="isSubmitting || isDeletingUser === user.id"
              >
                <span v-if="isDeletingUser === user.id" class="deleting-spinner">⏳</span>
                <span v-else>🗑️</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="empty-state">
      <div class="empty-icon">👥</div>
      <h3>{{ searchTerm || selectedRole !== 'all' ? '沒有符合條件的使用者' : '尚無使用者' }}</h3>
      <p v-if="searchTerm || selectedRole !== 'all'">嘗試調整搜尋條件或篩選器</p>
      <button v-else-if="isAdmin" @click="handleAddUser" class="btn btn-primary">
        新增第一個使用者
      </button>
    </div>

    <UserFormModal
      :is-visible="isModalVisible"
      :is-editing="isEditing"
      :user="userToEdit"
      :is-submitting="isSubmitting"
      @close="isModalVisible = false"
      @save="handleSaveUser"
    />
    <AlertDialog
      :is-visible="alertInfo.isVisible"
      :title="alertInfo.title"
      :message="alertInfo.message"
      @confirm="handleAlertConfirm"
    />
    <ConfirmDialog
      :is-visible="confirmInfo.isVisible"
      :title="confirmInfo.title"
      :message="confirmInfo.message"
      :confirm-text="confirmInfo.confirmText"
      :cancel-text="confirmInfo.cancelText"
      @confirm="confirmInfo.onConfirm"
      @cancel="confirmInfo.onCancel"
    />
  </div>
</template>

<style scoped>
/* ================================== */
/*         通用及桌面版樣式            */
/* ================================== */
.user-management-container {
  padding: 10px;
  min-height: 100vh;
  background-color: #f8f9fa; /* 淺灰色背景 */
}
.page-header {
  margin-bottom: 2rem;
}
.header-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
  gap: 1rem;
}
.page-header h1 {
  font-size: 2rem;
  color: #333;
  margin: 0;
  font-weight: 600;
}
.user-stats {
  display: flex;
  gap: 1rem;
  align-items: center;
  flex-wrap: wrap;
}
.stats-total {
  padding: 0.5rem 1rem;
  background: linear-gradient(135deg, #007bff, #0056b3);
  color: white;
  border-radius: 25px;
  font-size: 1.2rem;
  font-weight: 700;
  box-shadow: 0 4px 12px rgba(0, 123, 255, 0.3);
  letter-spacing: 0.5px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  transition: transform 0.2s ease;
}
.stats-total:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(0, 123, 255, 0.4);
}
.stats-filtered {
  padding: 0.25rem 0.75rem;
  background-color: #cce5ff;
  color: #0056b3;
  border-radius: 20px;
  font-size: 0.9rem;
  font-weight: 500;
}
.header-controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1.5rem;
  flex-wrap: wrap;
}
.search-filters {
  display: flex;
  gap: 1rem;
  align-items: center;
  flex-wrap: wrap;
}
.search-group {
  position: relative;
  display: flex;
  align-items: center;
}
.search-input {
  padding: 0.75rem 1rem;
  border: 2px solid #e9ecef;
  border-radius: 8px;
  font-size: 1rem;
  width: 280px;
  transition: border-color 0.2s;
}
.search-input:focus {
  outline: none;
  border-color: #007bff;
}
.clear-search-btn {
  position: absolute;
  right: 10px;
  background: none;
  border: none;
  font-size: 1.5rem;
  color: #6c757d;
  cursor: pointer;
  padding: 0;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.role-filter,
.sort-select {
  padding: 0.75rem 1rem;
  border: 2px solid #e9ecef;
  border-radius: 8px;
  font-size: 1rem;
  background-color: white;
  cursor: pointer;
  transition: border-color 0.2s;
}
.role-filter:focus,
.sort-select:focus {
  outline: none;
  border-color: #007bff;
}
.sort-group {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.sort-order-btn {
  padding: 0.75rem;
  border: 2px solid #e9ecef;
  border-radius: 8px;
  background-color: white;
  cursor: pointer;
  font-size: 1.2rem;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}
.sort-order-btn:hover {
  border-color: #007bff;
  background-color: #f8f9fa;
}
.header-actions {
  display: flex;
  gap: 1rem;
  align-items: center;
  flex-wrap: wrap; /* 允許換行 */
}
.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 400px;
  background-color: white;
  border-radius: 12px;
  color: #6c757d;
}
.loading-spinner {
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
.user-table-container {
  background-color: #fff;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.05);
}
.user-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
.user-table th,
.user-table td {
  padding: 1rem;
  text-align: left;
  border-bottom: 1px solid #e9ecef;
  font-size: 0.95rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.user-table th {
  background-color: #f8f9fa;
  font-weight: 600;
  color: #495057;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-size: 0.85rem;
}
.user-table tbody tr {
  transition: all 0.2s;
}
.user-table tbody tr:hover {
  background-color: #f8f9fa;
}
.user-table tbody tr:last-child td {
  border-bottom: none;
}
.deleting-row {
  opacity: 0.6;
  background-color: #fff3cd !important;
}
.deleting-spinner {
  animation: spin 1s linear infinite;
}
.empty-state {
  text-align: center;
  padding: 4rem 2rem;
  background-color: white;
  border-radius: 12px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
}
.empty-icon {
  font-size: 4rem;
  margin-bottom: 1rem;
  opacity: 0.5;
}
.empty-state h3 {
  color: #495057;
  margin: 1rem 0;
  font-size: 1.5rem;
}
.empty-state p {
  color: #6c757d;
  margin-bottom: 2rem;
}
.btn {
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
  font-size: 0.95rem;
  transition: all 0.2s ease-in-out;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}
.btn-primary {
  background: linear-gradient(135deg, #28a745, #20c997);
  color: white;
  border: none;
  box-shadow: 0 2px 8px rgba(40, 167, 69, 0.3);
}
.btn-primary:hover:not(:disabled) {
  background: linear-gradient(135deg, #218838, #1e7e34);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(40, 167, 69, 0.4);
}
.btn-danger {
  background: #dc3545;
  color: white;
}
.btn-danger:hover:not(:disabled) {
  background: #c82333;
}
.btn-warning {
  background: #ffc107;
  color: #212529;
}
.btn-warning:hover:not(:disabled) {
  background: #e0a800;
}
.btn-info {
  background-color: #17a2b8;
  color: white;
}
.btn-info:hover:not(:disabled) {
  background-color: #138496;
}
.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none;
}
.action-buttons {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}
.btn-icon {
  background: none;
  border: none;
  cursor: pointer;
  padding: 6px;
  border-radius: 50%;
  font-size: 1.2rem;
  line-height: 1;
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}
.btn-icon:hover:not(:disabled) {
  background-color: #f0f0f0;
  transform: scale(1.1);
}
.btn-icon:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}
.role-badge {
  padding: 0.3em 0.8em;
  border-radius: 16px;
  font-size: 0.85em;
  font-weight: 600;
  text-transform: uppercase;
  color: white;
  letter-spacing: 0.5px;
}
.role-admin {
  background-color: #dc3545;
}
.role-editor {
  background-color: #007bff;
}
.role-contributor {
  background-color: #28a745;
}
.role-viewer {
  background-color: #6c757d;
}
.admin-badge {
  background-color: #dc3545;
  color: white;
  font-size: 0.7rem;
  padding: 0.2rem 0.5rem;
  border-radius: 10px;
  margin-left: 0.5rem;
  font-weight: 500;
}
.action-buttons-cell {
  width: 150px;
}

.gdrive-upload-group {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem;
  border: 1px dashed #ced4da;
  border-radius: 8px;
}
.file-input-drive {
  font-size: 0.9rem;
}
.file-input-drive::file-selector-button {
  padding: 0.5rem 1rem;
  border-radius: 6px;
  border: 1px solid #ced4da;
  cursor: pointer;
  background-color: #f8f9fa;
  font-weight: 500;
  transition: all 0.2s;
}
.file-input-drive::file-selector-button:hover {
  border-color: #868e96;
  background-color: #e9ecef;
}

/* ================================== */
/*         響應式樣式 (手機版)         */
/* ================================== */

.user-table.desktop-only {
  display: table;
}
.user-cards-container.mobile-only {
  display: none;
}

@media (max-width: 768px) {
  .user-table.desktop-only {
    display: none;
  }
  .user-cards-container.mobile-only {
    display: block;
  }
  .user-management-container {
    padding: 0;
    background-color: #f8f9fa;
  }
  .page-header {
    margin-bottom: 1.5rem;
    padding: 1rem;
    background-color: #fff;
    border-bottom: 1px solid #dee2e6;
  }
  .header-top {
    flex-direction: column;
    align-items: flex-start;
  }
  .search-filters {
    flex-direction: column;
    width: 100%;
    align-items: stretch;
  }
  .search-input {
    width: 100%;
  }
  .header-controls {
    flex-direction: column;
    align-items: stretch;
  }
  .header-actions {
    width: 100%;
    flex-direction: column;
  }
  .btn-primary,
  .btn-danger,
  .btn-warning,
  .btn-info {
    width: 100%;
    justify-content: center;
  }
  .gdrive-upload-group {
    width: 100%;
    flex-direction: column;
  }
  .user-table-container {
    background: none;
    box-shadow: none;
    border-radius: 0;
  }

  .user-card {
    background-color: #fff;
    border-radius: 8px;
    margin: 0 1rem 1rem 1rem;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
    overflow: hidden;
  }
  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem 1rem;
    background-color: #f8f9fa;
    border-bottom: 1px solid #e9ecef;
  }
  .user-name {
    font-weight: 600;
    font-size: 1.1rem;
    color: #333;
  }
  .card-body {
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .info-row {
    display: flex;
    justify-content: space-between;
    font-size: 0.95rem;
  }
  .info-label {
    color: #6c757d;
  }
  .info-value {
    color: #212529;
    font-weight: 500;
  }
  .card-footer {
    padding: 0.5rem 1rem;
    border-top: 1px solid #e9ecef;
    display: flex;
    justify-content: flex-end;
  }
}
</style>
