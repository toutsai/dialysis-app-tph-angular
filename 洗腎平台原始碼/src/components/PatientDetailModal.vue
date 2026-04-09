<template>
  <div v-if="isVisible" class="modal-overlay" v-overlay-close="handleClose">
    <div class="modal-container large">
      <!-- ✨ 1. 新增 Wrapper 來定位遮罩 -->
      <div class="modal-body-wrapper">
        <!-- ✨ 2. 新增權限鎖定遮罩 (內部無內容) -->
        <div v-if="isLockedForThisUser" class="readonly-overlay"></div>

        <!-- 3. 您原本的所有內容都放在這裡 -->
        <div class="modal-header">
          <div class="header-title-area">
            <h2>{{ patient?.name }} - 詳細資料</h2>
          </div>

          <!-- 病人導覽列 -->
          <div v-if="slotList.length > 1" class="patient-navigator">
            <button
              @click="switchToPatient(currentIndex - 1)"
              :disabled="currentIndex === 0"
              class="nav-btn"
              title="前一床病人"
            >
              <i class="fas fa-chevron-left"></i> 前一床
            </button>

            <span class="nav-counter"
              >{{ currentSlotInfo.shift }} / {{ currentSlotInfo.bedNum }}</span
            >

            <button
              @click="switchToPatient(currentIndex + 1)"
              :disabled="currentIndex >= slotList.length - 1"
              class="nav-btn"
              title="後一床病人"
            >
              後一床 <i class="fas fa-chevron-right"></i>
            </button>
          </div>

          <button @click="handleClose" class="close-btn">×</button>
        </div>

        <!-- 頁籤導覽列 -->
        <div class="tabs-navigation">
          <button :class="{ active: activeTab === 'records' }" @click="activeTab = 'records'">
            紀錄
          </button>
          <button :class="{ active: activeTab === 'memos' }" @click="activeTab = 'memos'">
            <span v-if="hasPendingMemosForPatient" class="memo-indicator">!</span>
            備忘
          </button>
          <button :class="{ active: activeTab === 'labs' }" @click="activeTab = 'labs'">
            檢驗
          </button>
          <button
            :class="{ active: activeTab === 'correlation' }"
            @click="activeTab = 'correlation'"
          >
            開藥
          </button>
          <button :class="{ active: activeTab === 'imaging' }" @click="activeTab = 'imaging'">
            影像
          </button>
        </div>

        <!-- 頁籤內容 -->
        <div class="modal-body">
          <!-- 病情紀錄頁籤 -->
          <div v-show="activeTab === 'records'" class="tab-panel">
            <ConditionRecordPanel
              v-if="patient"
              :patient="patient"
              :current-date="currentDate"
              @save="handleSaveConditionRecord"
              @update="handleUpdateConditionRecord"
              @delete="handleDeleteConditionRecord"
            />
          </div>

          <!-- 備忘頁籤 -->
          <div v-show="activeTab === 'memos'" class="tab-panel">
            <MemoPanel v-if="patient" :patient-id="patient.id" />
          </div>

          <!-- 影像頁籤 -->
          <div v-show="activeTab === 'imaging'" class="tab-panel imaging-panel">
            <!-- 上傳區塊 -->
            <div class="image-uploader">
              <!-- 階段一：初始狀態，顯示拍照按鈕與PACS連結 -->
              <div v-if="cameraState === 'idle'" class="idle-buttons">
                <button @click="startCamera" class="btn-primary">
                  <i class="fas fa-camera"></i> 開啟相機拍照
                </button>
                <a
                  href="https://ulite.tph.mohw.gov.tw:8080"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="btn-pacs"
                >
                  <i class="fas fa-x-ray"></i> 手機版PACS連結
                </a>
              </div>

              <!-- 階段二：相機開啟狀態 -->
              <div v-if="cameraState === 'streaming'" class="camera-view">
                <video ref="videoPlayer" autoplay playsinline class="video-preview"></video>
                <div class="camera-controls">
                  <button @click="captureImage" class="btn-capture" title="拍照">
                    <i class="fas fa-circle"></i>
                  </button>
                  <button @click="stopCamera" class="btn-cancel">取消</button>
                </div>
              </div>

              <!-- 階段三：照片預覽與上傳狀態 -->
              <div
                v-if="cameraState === 'captured' || cameraState === 'uploading'"
                class="preview-view"
              >
                <img :src="capturedImage" alt="Captured image preview" class="image-preview" />
                <div class="preview-controls">
                  <button @click="uploadToDrive" :disabled="isUploading" class="btn-success">
                    <i v-if="isUploading" class="fas fa-spinner fa-spin"></i>
                    {{ isUploading ? '上傳中...' : '確認上傳' }}
                  </button>
                  <button @click="retakePhoto" :disabled="isUploading" class="btn-secondary">
                    重新拍照
                  </button>
                </div>
              </div>

              <!-- 上傳錯誤訊息顯示 -->
              <div v-if="cameraErrorMessage" class="error-message">
                {{ cameraErrorMessage }}
              </div>
            </div>

            <!-- 分隔線 -->
            <hr class="panel-divider" />

            <!-- 查詢與顯示區塊 -->
            <div class="image-viewer">
              <div class="viewer-header">
                <h3>歷史影像紀錄</h3>
                <button @click="fetchDriveFiles" :disabled="isFetchingFiles" class="btn-secondary">
                  <i v-if="isFetchingFiles" class="fas fa-spinner fa-spin"></i>
                  {{ isFetchingFiles ? '查詢中...' : '重新整理影像' }}
                </button>
              </div>

              <!-- 日期篩選區塊 -->
              <div class="date-filter">
                <div class="filter-mode-selector">
                  <label>
                    <input type="radio" v-model="dateFilterMode" value="recent" />
                    近6個月
                  </label>
                  <label>
                    <input type="radio" v-model="dateFilterMode" value="custom" />
                    自訂區間
                  </label>
                  <label>
                    <input type="radio" v-model="dateFilterMode" value="all" />
                    全部
                  </label>
                </div>
                <div v-if="dateFilterMode === 'custom'" class="custom-date-range">
                  <input type="date" v-model="customStartDate" placeholder="開始日期" />
                  <span>至</span>
                  <input type="date" v-model="customEndDate" placeholder="結束日期" />
                </div>
                <div v-if="hasSearched && driveFiles.length > 0" class="filter-summary">
                  顯示 {{ filteredDriveFiles.length }} / {{ driveFiles.length }} 筆影像
                </div>
              </div>

              <!-- 狀態顯示 -->
              <div v-if="isFetchingFiles" class="loading-state">正在從雲端硬碟讀取資料...</div>
              <div v-else-if="fetchError" class="error-message">{{ fetchError }}</div>
              <div v-else-if="driveFiles.length === 0 && hasSearched" class="empty-state">
                找不到此病人的相關影像紀錄。
              </div>
              <div
                v-else-if="filteredDriveFiles.length === 0 && driveFiles.length > 0"
                class="empty-state"
              >
                在選取的日期區間內沒有影像紀錄。
              </div>

              <!-- 影像列表 -->
              <div v-else-if="filteredDriveFiles.length > 0" class="image-grid">
                <div v-for="file in filteredDriveFiles" :key="file.id" class="image-card">
                  <a :href="file.webViewLink" target="_blank" title="點擊在新分頁中開啟原始圖片">
                    <img :src="file.thumbnailLink" :alt="file.name" class="thumbnail-img" />
                  </a>
                  <div class="image-info">
                    <div class="file-name-row">
                      <p class="file-name" :title="file.name">{{ file.name }}</p>
                      <button
                        @click="startEditFileName(file)"
                        class="btn-edit-name"
                        title="編輯檔名"
                      >
                        <i class="fas fa-pencil-alt"></i>
                      </button>
                    </div>
                    <p class="created-time">{{ formatDateTime(file.createdTime) }}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 檢驗報告頁籤 -->
          <div v-show="activeTab === 'labs'" class="tab-panel">
            <PatientLabSummaryPanel
              v-if="patient"
              :patient="patient"
              @save-record="handleSaveLabSummaryAsRecord"
            />
          </div>

          <div v-show="activeTab === 'correlation'" class="tab-panel">
            <LabMedCorrelationView
              v-if="patient && activeTab === 'correlation'"
              :patient="patient"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- 編輯檔名 Modal -->
    <div v-if="isEditingFileName" class="rename-modal-overlay" @click.self="cancelEditFileName">
      <div class="rename-modal">
        <h4>編輯檔案名稱</h4>
        <div class="rename-input-group">
          <input
            v-model="newFileName"
            type="text"
            class="rename-input"
            placeholder="輸入新檔名"
            @keyup.enter="saveFileName"
            @keyup.escape="cancelEditFileName"
          />
          <span v-if="editingFile?.extension" class="file-extension"
            >.{{ editingFile.extension }}</span
          >
        </div>
        <div v-if="renameError" class="error-message">{{ renameError }}</div>
        <div class="rename-actions">
          <button @click="saveFileName" :disabled="isRenaming" class="btn-success">
            <i v-if="isRenaming" class="fas fa-spinner fa-spin"></i>
            {{ isRenaming ? '儲存中...' : '儲存' }}
          </button>
          <button @click="cancelEditFileName" :disabled="isRenaming" class="btn-secondary">
            取消
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, computed } from 'vue'
import { useRealtimeNotifications } from '@/composables/useRealtimeNotifications.js'
import { patientsApi } from '@/services/localApiClient'
import { useAuth } from '@/composables/useAuth'
import { useTaskStore } from '@/stores/taskStore'
import { getShiftDisplayName as getShiftName } from '@/constants/scheduleConstants.js'

// 引入 "內容面板" 元件
import ConditionRecordPanel from './ConditionRecordPanel.vue'
import MemoPanel from './MemoPanel.vue'
import LabMedCorrelationView from './LabMedCorrelationView.vue'
import PatientLabSummaryPanel from './PatientLabSummaryPanel.vue'

// --- Props & Emits ---
const props = defineProps({
  isVisible: Boolean,
  patient: Object,
  currentDate: Date,
  slotList: {
    type: Array,
    default: () => [],
  },
  currentIndex: {
    type: Number,
    default: 0,
  },
})
const emit = defineEmits(['close', 'record-updated', 'switch-patient'])

// --- Component State ---
const activeTab = ref('records')
const { addLocalNotification } = useRealtimeNotifications()
const auth = useAuth()
const taskStore = useTaskStore()

// --- Computed Properties ---
const isLockedForThisUser = computed(() => {
  return !auth.canEditClinicalNotesAndOrders.value
})

const currentSlotInfo = computed(() => {
  if (!props.slotList || props.slotList.length === 0) {
    return { bedNum: 'N/A', shift: '未知' }
  }
  const currentSlot = props.slotList[props.currentIndex]
  if (!currentSlot || !currentSlot.shiftId) {
    return { bedNum: 'N/A', shift: '未知' }
  }
  const shiftId = currentSlot.shiftId
  const parts = shiftId.split('-')
  const shiftCode = parts[2]
  const bedNum = parts[0] === 'peripheral' ? `外${parts[1]}` : parts[1]
  const shift = getShiftName(shiftCode)
  return { bedNum, shift }
})

const hasPendingMemosForPatient = computed(() => {
  if (!props.patient?.id) return false
  return taskStore.sortedFeedMessages.some(
    (msg) =>
      msg.patientId === props.patient.id &&
      msg.status === 'pending' &&
      msg.content &&
      !msg.content.startsWith('【'),
  )
})

// --- Methods ---
function handleClose() {
  stopCamera()
  driveFiles.value = []
  hasSearched.value = false
  fetchError.value = ''
  emit('close')
}

async function handleSaveConditionRecord(recordData) {
  try {
    const recordWithTimestamp = {
      ...recordData,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    await patientsApi.saveConditionRecord(recordWithTimestamp)
    addLocalNotification(`已為 ${recordData.patientName} 新增病情紀錄`, 'schedule')
    emit('record-updated')
  } catch (error) {
    console.error('儲存病情紀錄失敗:', error)
  }
}

async function handleUpdateConditionRecord({ id, content }) {
  try {
    const updateData = {
      content,
      updatedAt: new Date().toISOString(),
    }
    await patientsApi.updateConditionRecord(id, updateData)
    addLocalNotification('病情紀錄已更新', 'schedule')
    emit('record-updated')
  } catch (error) {
    console.error('更新病情紀錄失敗:', error)
  }
}

async function handleDeleteConditionRecord(recordId) {
  if (confirm('您確定要永久刪除這筆病情紀錄嗎？')) {
    try {
      await patientsApi.deleteConditionRecord(recordId)
      addLocalNotification('病情紀錄已刪除', 'schedule')
      emit('record-updated')
    } catch (error) {
      console.error('刪除病情紀錄失敗:', error)
    }
  }
}

async function handleSaveLabSummaryAsRecord({ patient, content }) {
  if (!auth.isContributor.value || !auth.currentUser.value) {
    alert('權限不足或未登入，無法儲存紀錄。')
    return
  }

  try {
    const recordData = {
      patientId: patient.id,
      patientName: patient.name,
      recordDate: props.currentDate
        ? props.currentDate.toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10),
      content: content,
      authorId: auth.currentUser.value.uid,
      authorName: auth.currentUser.value.name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    await patientsApi.saveConditionRecord(recordData)
    addLocalNotification(`已為 ${patient.name} 新增檢驗報告處置紀錄`, 'schedule')
    emit('record-updated')
    activeTab.value = 'records'
  } catch (error) {
    console.error('儲存檢驗摘要紀錄失敗:', error)
  }
}

function switchToPatient(newIndex) {
  if (newIndex >= 0 && newIndex < props.slotList.length) {
    emit('switch-patient', newIndex)
  }
}

// --- Camera, Upload & Viewer State ---
const cameraState = ref('idle')
const videoPlayer = ref(null)
const capturedImage = ref(null)
const cameraStream = ref(null)
const cameraErrorMessage = ref('')
const isUploading = ref(false)
const driveFiles = ref([])
const isFetchingFiles = ref(false)
const fetchError = ref('')
const hasSearched = ref(false)

// --- Date Filter State ---
const dateFilterMode = ref('recent') // 'recent' = 近6個月, 'custom' = 自訂區間, 'all' = 全部
const customStartDate = ref('')
const customEndDate = ref('')

// --- File Rename State ---
const isEditingFileName = ref(false)
const editingFile = ref(null)
const newFileName = ref('')
const isRenaming = ref(false)
const renameError = ref('')

// 計算預設的6個月前日期
function getDefaultStartDate() {
  const date = new Date()
  date.setMonth(date.getMonth() - 6)
  return date
}

// 根據篩選條件過濾影像
const filteredDriveFiles = computed(() => {
  if (!driveFiles.value || driveFiles.value.length === 0) return []

  if (dateFilterMode.value === 'all') {
    return driveFiles.value
  }

  let startDate, endDate

  if (dateFilterMode.value === 'recent') {
    startDate = getDefaultStartDate()
    endDate = new Date()
  } else if (dateFilterMode.value === 'custom') {
    startDate = customStartDate.value ? new Date(customStartDate.value) : null
    endDate = customEndDate.value ? new Date(customEndDate.value) : null
    // 將結束日期設為當天的 23:59:59
    if (endDate) {
      endDate.setHours(23, 59, 59, 999)
    }
  }

  return driveFiles.value.filter((file) => {
    const fileDate = new Date(file.createdTime)
    if (startDate && fileDate < startDate) return false
    if (endDate && fileDate > endDate) return false
    return true
  })
})

// --- Camera, Upload & Viewer Methods ---

async function startCamera() {
  cameraErrorMessage.value = ''
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    try {
      // 設定高解析度約束，優先使用後置鏡頭
      cameraStream.value = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1920, min: 1280 },
          height: { ideal: 1080, min: 720 },
        },
      })
      cameraState.value = 'streaming'
      await new Promise((resolve) => setTimeout(resolve, 0))
      if (videoPlayer.value) {
        videoPlayer.value.srcObject = cameraStream.value
      }
    } catch (error) {
      console.error('相機啟動失敗:', error)
      cameraErrorMessage.value = `無法開啟相機: ${error.message}`
      cameraState.value = 'idle'
    }
  } else {
    cameraErrorMessage.value = '您的瀏覽器不支援相機功能。'
  }
}

function stopCamera() {
  if (cameraStream.value) {
    cameraStream.value.getTracks().forEach((track) => track.stop())
  }
  cameraStream.value = null
  if (cameraState.value === 'streaming') {
    cameraState.value = 'idle'
  }
}

function captureImage() {
  const canvas = document.createElement('canvas')
  if (videoPlayer.value) {
    canvas.width = videoPlayer.value.videoWidth
    canvas.height = videoPlayer.value.videoHeight
    const context = canvas.getContext('2d')
    context.drawImage(videoPlayer.value, 0, 0, canvas.width, canvas.height)

    // 設定 JPEG 品質為 0.95（範圍 0-1，數值越高品質越好）
    capturedImage.value = canvas.toDataURL('image/jpeg', 0.95)
    stopCamera()
    cameraState.value = 'captured'
  }
}

function retakePhoto() {
  capturedImage.value = null
  startCamera()
}

async function uploadToDrive() {
  if (!capturedImage.value || !props.patient) return

  // Google Drive 上傳功能在 standalone 模式下不可用
  cameraErrorMessage.value = 'standalone 模式下暫不支援上傳圖片功能。'
  return
}

function formatDateTime(isoString) {
  if (!isoString) return ''
  return new Date(isoString).toLocaleString('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

async function fetchDriveFiles() {
  if (!props.patient?.medicalRecordNumber) {
    fetchError.value = '錯誤：找不到病人的病歷號。'
    return
  }

  // Google Drive 查詢功能在 standalone 模式下不可用
  fetchError.value = 'standalone 模式下暫不支援查詢雲端檔案功能。'
  hasSearched.value = true
  return
}

// --- File Rename Methods ---
function startEditFileName(file) {
  editingFile.value = file
  // 移除副檔名以便編輯
  const nameParts = file.name.split('.')
  const extension = nameParts.length > 1 ? nameParts.pop() : ''
  newFileName.value = nameParts.join('.')
  editingFile.value.extension = extension
  isEditingFileName.value = true
  renameError.value = ''
}

function cancelEditFileName() {
  isEditingFileName.value = false
  editingFile.value = null
  newFileName.value = ''
  renameError.value = ''
}

async function saveFileName() {
  if (!editingFile.value || !newFileName.value.trim()) {
    renameError.value = '檔名不能為空白'
    return
  }

  // Google Drive 檔案重新命名功能在 standalone 模式下不可用
  renameError.value = 'standalone 模式下暫不支援重新命名雲端檔案功能。'
  return
}

// --- Watcher ---
watch(
  () => props.isVisible,
  (newVal) => {
    if (newVal) {
      if (activeTab.value === '') {
        activeTab.value = hasPendingMemosForPatient.value ? 'memos' : 'records'
      }
      if (props.patient) {
        fetchDriveFiles()
      }
    } else {
      stopCamera()
      driveFiles.value = []
      hasSearched.value = false
      fetchError.value = ''
      activeTab.value = ''
    }
  },
)

watch(
  () => props.patient,
  (newPatient, oldPatient) => {
    if (props.isVisible && newPatient && newPatient.id !== oldPatient?.id) {
      fetchDriveFiles()
    }
  },
)
</script>

<style scoped>
/* ✨【修改】遮罩 Wrapper 和遮罩本身的樣式 ✨ */
.modal-body-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.readonly-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(108, 117, 125, 0.2); /* 半透明的灰色 */
  z-index: 10;
  border-radius: 12px;
  cursor: not-allowed; /* 禁止圖示 */
}

/* --- 以下為您原本的樣式，保持不變 --- */
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
  backdrop-filter: blur(2px);
}
.modal-container {
  background-color: #f8f9fa;
  border-radius: 12px;
  box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
  width: 90%;
  max-width: 1100px;
  height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.modal-header {
  padding: 1rem 1.5rem;
  border-bottom: 1px solid #dee2e6;
  flex-shrink: 0;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
}
.header-title-area {
  justify-self: start;
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
  color: #6c757d;
  justify-self: end;
}
.close-btn:hover {
  color: #343a40;
}

.patient-navigator {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
}
.nav-btn {
  background-color: #e9ecef;
  border: 1px solid #dee2e6;
  color: #495057;
  padding: 0.5rem 1rem;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  transition:
    background-color 0.2s,
    color 0.2s;
}
.nav-btn:hover:not(:disabled) {
  background-color: #007bff;
  color: white;
}
.nav-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.nav-counter {
  font-size: 0.9rem;
  color: #6c757d;
  font-weight: bold;
}

.tabs-navigation {
  display: flex;
  background-color: #e9ecef;
  padding: 0.5rem 1.5rem 0 1.5rem;
  flex-shrink: 0;
  gap: 0.5rem;
}
.tabs-navigation button {
  padding: 0.75rem 1.5rem;
  font-size: 1.1rem;
  font-weight: 500;
  border: 1px solid transparent;
  border-bottom: none;
  background-color: transparent;
  color: #6c757d;
  cursor: pointer;
  border-radius: 8px 8px 0 0;
  transition: all 0.2s;
  position: relative;
}
.tabs-navigation button.active {
  background-color: #fff;
  color: #007bff;
  border-color: #dee2e6;
}
.memo-indicator {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 10px;
  height: 10px;
  background-color: #dc3545;
  border-radius: 50%;
  border: 2px solid #e9ecef;
}
.tabs-navigation button.active .memo-indicator {
  border-color: #fff;
}
.modal-body {
  flex-grow: 1;
  overflow: hidden;
  background-color: #fff;
  padding: 1.5rem;
  display: flex;
}
.tab-panel {
  width: 100%;
  display: flex;
  flex-direction: column;
}
.imaging-panel {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  overflow: hidden;
}
.panel-divider {
  border: none;
  border-top: 1px solid #e9ecef;
  width: 100%;
}
.image-uploader {
  flex-shrink: 0;
  width: 100%;
  max-width: 600px;
  margin: 0 auto;
  border: 2px dashed #ccc;
  border-radius: 8px;
  padding: 1rem;
  display: flex;
  justify-content: center;
  align-items: center;
  flex-direction: column;
  gap: 1rem;
  background-color: #f9f9f9;
}
.camera-view,
.preview-view {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}
.video-preview,
.image-preview {
  max-width: 100%;
  max-height: 40vh;
  height: auto;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  background-color: #000;
  object-fit: contain;
}
.camera-controls,
.preview-controls {
  display: flex;
  gap: 1rem;
  justify-content: center;
}
.image-uploader button,
.image-viewer button {
  padding: 0.75rem 1.5rem;
  border-radius: 8px;
  border: none;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}
.image-uploader button:disabled,
.image-viewer button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.idle-buttons {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
  justify-content: center;
}
.btn-primary {
  background-color: #007bff;
  color: white;
}
.btn-primary:hover:not(:disabled) {
  background-color: #0056b3;
}
.btn-pacs {
  padding: 0.75rem 1.5rem;
  border-radius: 8px;
  border: none;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  background-color: #17a2b8;
  color: white;
  text-decoration: none;
}
.btn-pacs:hover {
  background-color: #138496;
}
.btn-capture {
  background-color: #dc3545;
  color: white;
  border-radius: 50%;
  width: 60px;
  height: 60px;
  font-size: 1.5rem;
  justify-content: center;
  border: 4px solid white;
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.3);
}
.btn-capture:hover:not(:disabled) {
  background-color: #b02a37;
}
.btn-cancel {
  background-color: #6c757d;
  color: white;
}
.btn-cancel:hover:not(:disabled) {
  background-color: #5a6268;
}
.btn-success {
  background-color: #28a745;
  color: white;
}
.btn-success:hover:not(:disabled) {
  background-color: #218838;
}
.btn-secondary {
  background-color: #f8f9fa;
  border: 1px solid #dee2e6;
  color: #343a40;
}
.btn-secondary:hover:not(:disabled) {
  background-color: #e2e6ea;
}
.error-message {
  color: #dc3545;
  font-weight: 500;
  margin-top: 0.5rem;
}
.image-viewer {
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
  padding-right: 10px;
}
.viewer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
  flex-shrink: 0;
}
.viewer-header h3 {
  margin: 0;
  font-size: 1.2rem;
  color: #343a40;
}
.loading-state,
.empty-state {
  text-align: center;
  padding: 2rem;
  color: #6c757d;
}
.image-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 1rem;
}
.image-card {
  border: 1px solid #dee2e6;
  border-radius: 8px;
  overflow: hidden;
  text-decoration: none;
  color: inherit;
  transition: all 0.2s ease-in-out;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  display: flex;
  flex-direction: column;
}
.image-card:hover {
  transform: translateY(-5px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}
.thumbnail-img {
  width: 100%;
  height: 150px;
  object-fit: cover;
  background-color: #f8f9fa;
}
.image-info {
  padding: 0.75rem;
}
.file-name {
  font-weight: 600;
  margin: 0 0 0.25rem 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.created-time {
  font-size: 0.8rem;
  color: #6c757d;
  margin: 0;
}
/* --- Date Filter Styles --- */
.date-filter {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem 1rem;
  background-color: #f8f9fa;
  border-radius: 8px;
  margin-bottom: 1rem;
}
.filter-mode-selector {
  display: flex;
  gap: 1rem;
}
.filter-mode-selector label {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  cursor: pointer;
  font-size: 0.9rem;
}
.custom-date-range {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.custom-date-range input[type='date'] {
  padding: 0.4rem 0.6rem;
  border: 1px solid #dee2e6;
  border-radius: 4px;
  font-size: 0.9rem;
}
.filter-summary {
  margin-left: auto;
  font-size: 0.85rem;
  color: #6c757d;
}
/* --- File Name Edit Styles --- */
.file-name-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.file-name-row .file-name {
  flex: 1;
  min-width: 0;
}
.btn-edit-name {
  background: none;
  border: none;
  color: #6c757d;
  cursor: pointer;
  padding: 0.25rem;
  font-size: 0.8rem;
  opacity: 0.6;
  transition: opacity 0.2s;
}
.btn-edit-name:hover {
  opacity: 1;
  color: #007bff;
}
/* --- Rename Modal Styles --- */
.rename-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}
.rename-modal {
  background-color: white;
  border-radius: 12px;
  padding: 1.5rem;
  width: 90%;
  max-width: 450px;
  box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
}
.rename-modal h4 {
  margin: 0 0 1rem 0;
  font-size: 1.2rem;
}
.rename-input-group {
  display: flex;
  align-items: center;
  margin-bottom: 1rem;
}
.rename-input {
  flex: 1;
  padding: 0.75rem;
  border: 1px solid #dee2e6;
  border-radius: 8px;
  font-size: 1rem;
}
.rename-input:focus {
  outline: none;
  border-color: #007bff;
  box-shadow: 0 0 0 2px rgba(0, 123, 255, 0.25);
}
.file-extension {
  margin-left: 0.5rem;
  color: #6c757d;
  font-size: 0.95rem;
}
.rename-actions {
  display: flex;
  gap: 0.75rem;
  justify-content: flex-end;
}
.rename-actions button {
  padding: 0.6rem 1.25rem;
  border-radius: 6px;
  border: none;
  font-size: 0.95rem;
  font-weight: 500;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}
@media (max-width: 992px) {
  .modal-body {
    overflow-y: auto;
  }
}
</style>
