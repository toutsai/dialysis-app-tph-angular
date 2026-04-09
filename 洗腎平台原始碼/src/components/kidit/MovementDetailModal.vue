<!-- src/components/kidit/MovementDetailModal.vue -->
<template>
  <div v-if="visible" class="modal-overlay" @click.self="close">
    <div class="modal-content">
      <!-- 標題區 -->
      <header class="modal-header">
        <div class="header-title">
          <i class="fas fa-clipboard-list icon"></i>
          <h3>{{ date }} 工作日誌詳情</h3>
        </div>
        <button class="close-btn" @click="close">
          <i class="fas fa-times"></i>
        </button>
      </header>

      <!-- 頁籤導航 -->
      <div class="tabs-header">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          :class="['tab-btn', { active: activeTab === tab.key }]"
          @click="handleTabClick(tab.key)"
          :title="tab.requiresSelection && !selectedPatient ? '請先點選一位病人' : ''"
        >
          {{ tab.label }}
          <span v-if="tab.key !== 'movement' && selectedPatient" class="patient-tag">
            {{ selectedPatient.name }}
          </span>
        </button>
      </div>

      <div class="modal-body">
        <!-- 頁籤 1: 當日病患動態 -->
        <div v-show="activeTab === 'movement'" class="tab-pane">
          <div class="action-bar">
            <p class="hint-text">
              <i class="fas fa-info-circle"></i>
              點擊列表中的病人以編輯詳細資料。若該項目無需申報，可點擊垃圾桶刪除。
            </p>
          </div>

          <div class="table-responsive">
            <table class="modern-table">
              <thead>
                <tr>
                  <th width="10%">類型</th>
                  <th width="12%">姓名</th>
                  <th width="12%">病歷號</th>
                  <th width="26%">詳細內容</th>
                  <th width="20%">轉出院所</th>
                  <th width="10%" class="text-center">KiDit 登錄</th>
                  <th width="10%" class="text-center">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(event, index) in localEvents"
                  :key="event.id"
                  :class="{ 'is-selected': selectedPatientId === event.patientId }"
                  @click="selectPatient(event)"
                >
                  <td>
                    <span class="status-badge" :class="getBadgeClass(event.type)">
                      {{ translateType(event.type) }}
                    </span>
                  </td>
                  <td class="font-medium">{{ event.patientName }}</td>
                  <td class="text-gray-600">{{ event.medicalRecordNumber || '-' }}</td>
                  <td class="text-gray-600">{{ event.details }}</td>
                  <td>
                    <input
                      type="text"
                      v-model="event.transferOutHospital"
                      placeholder="輸入院所..."
                      class="form-input"
                      @click.stop
                    />
                  </td>
                  <!-- KiDit 登錄欄位 -->
                  <td class="text-center" @click.stop>
                    <label class="checkbox-container">
                      <input type="checkbox" v-model="event.isRegistered" />
                      <span class="checkmark"></span>
                    </label>
                  </td>

                  <!-- 操作欄位 -->
                  <td class="text-center action-cell">
                    <!-- 刪除按鈕 -->
                    <button
                      class="icon-btn delete-btn"
                      @click.stop="deleteEvent(index)"
                      title="從列表中移除"
                    >
                      <i class="fas fa-trash-alt"></i>
                    </button>

                    <!-- 資料完整性提示 -->
                    <div class="status-indicator" @click.stop>
                      <!-- 如果資料完整 -> 綠色勾勾 -->
                      <i
                        v-if="isKiDitDataComplete(event)"
                        class="fas fa-check-circle text-green-500"
                        title="KiDit 資料已完整"
                      ></i>

                      <!-- 如果資料不全 -> 紅色驚嘆號 (點擊可切換到資料頁籤) -->
                      <button
                        v-else
                        class="icon-btn warning-btn"
                        @click.stop="handleIncompleteClick(event)"
                        title="KiDit 資料尚未填寫完整，點擊填寫"
                      >
                        <i class="fas fa-exclamation-triangle"></i>
                      </button>
                    </div>
                  </td>
                </tr>
                <tr v-if="localEvents.length === 0">
                  <td colspan="7" class="empty-row">本日無相關動態紀錄</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="footer-actions">
            <button class="btn-primary" @click="saveAllEvents">
              <i class="fas fa-save"></i> 儲存動態列表變更
            </button>
          </div>
        </div>

        <!-- 其他頁籤 -->
        <div v-show="activeTab !== 'movement'" class="tab-pane details-pane">
          <div v-if="!selectedPatient" class="empty-state">
            <i class="fas fa-hand-point-left bounce-icon"></i>
            <p>請先回到「當日病患動態」頁籤，點選一位病人。</p>
          </div>

          <div v-else class="details-content">
            <!-- 頁籤 2: 血管通路處置 -->
            <div v-if="activeTab === 'vascular'" class="vascular-container">
              <div class="sub-tabs">
                <button :class="{ active: subTab === 'current' }" @click="subTab = 'current'">
                  目前使用
                </button>
                <button :class="{ active: subTab === 'unused' }" @click="subTab = 'unused'">
                  其他未使用
                </button>
                <button :class="{ active: subTab === 'events' }" @click="subTab = 'events'">
                  當日事件
                </button>
              </div>

              <div class="sub-content">
                <VascularAccessForm
                  v-if="subTab === 'current' || subTab === 'unused'"
                  :type="subTab"
                  :date="date"
                  :event-id="selectedEvent.id"
                  :initial-data="getEventData('kidit_vascular')"
                  :master-patient="selectedPatientData"
                  @updated="handleDataUpdated"
                />
                <div v-if="subTab === 'events'" class="event-list-container">
                  <ul class="event-list">
                    <li v-for="ev in selectedPatientVascularEvents" :key="ev.id">
                      <span class="time-badge">{{ formatTime(ev.timestamp) }}</span>
                      <span class="event-text">{{ ev.details }}</span>
                    </li>
                    <li v-if="selectedPatientVascularEvents.length === 0" class="no-data">
                      本日無紀錄
                    </li>
                  </ul>
                </div>
              </div>
            </div>

            <!-- 頁籤 3: KiDit病患資料 -->
            <KiDitPatientForm
              v-if="activeTab === 'profile'"
              :date="date"
              :event-id="selectedEvent.id"
              :initial-data="getEventData('kidit_profile')"
              :master-patient="selectedPatientData"
              @updated="handleDataUpdated"
            />

            <!-- 頁籤 4: 病史原發病 -->
            <KiDitHistoryForm
              v-if="activeTab === 'history'"
              :date="date"
              :event-id="selectedEvent.id"
              :initial-data="getEventData('kidit_history')"
              :master-patient="selectedPatientData"
              @updated="handleDataUpdated"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- ✨ 整合 Alert Dialog (提示訊息) ✨ -->
    <AlertDialog
      :is-visible="isAlertDialogVisible"
      :title="alertDialogTitle"
      :message="alertDialogMessage"
      @confirm="isAlertDialogVisible = false"
    />

    <!-- ✨ 整合 Confirm Dialog (刪除確認) ✨ -->
    <ConfirmDialog
      :is-visible="isConfirmDialogVisible"
      :title="confirmDialogTitle"
      :message="confirmDialogMessage"
      confirm-text="刪除"
      confirm-class="btn-danger"
      @confirm="executeDelete"
      @cancel="isConfirmDialogVisible = false"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { kiditService } from '@/services/kiditService'
import VascularAccessForm from './VascularAccessForm.vue'
import KiDitPatientForm from './KiDitPatientForm.vue'
import KiDitHistoryForm from './KiDitHistoryForm.vue'
import AlertDialog from '@/components/AlertDialog.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'

const props = defineProps({
  visible: Boolean,
  date: String,
  events: Array,
})

const emit = defineEmits(['close', 'refresh'])

const activeTab = ref('movement')
const subTab = ref('current')
const localEvents = ref([])
const selectedPatientId = ref(null)
const selectedPatientName = ref('')
const selectedPatientData = ref(null)

// Alert Dialog 狀態
const isAlertDialogVisible = ref(false)
const alertDialogTitle = ref('')
const alertDialogMessage = ref('')

function showAlert(title, message) {
  alertDialogTitle.value = title
  alertDialogMessage.value = message
  isAlertDialogVisible.value = true
}

// ✨ Confirm Dialog 狀態
const isConfirmDialogVisible = ref(false)
const confirmDialogTitle = ref('')
const confirmDialogMessage = ref('')
const pendingDeleteIndex = ref(-1)

const tabs = [
  { key: 'movement', label: '當日病患動態', requiresSelection: false },
  { key: 'vascular', label: '血管通路處置', requiresSelection: true },
  { key: 'profile', label: 'KiDit 病患資料', requiresSelection: true },
  { key: 'history', label: 'KiDit 病史原發病', requiresSelection: true },
]

// 同步 props 到本地
watch(
  () => props.events,
  (newVal) => {
    localEvents.value = JSON.parse(JSON.stringify(newVal || []))
  },
  { immediate: true },
)

// 當選擇病人改變時，去抓取該病人的主檔資料 (用於預填)
watch(selectedPatientId, async (newId) => {
  if (newId) {
    selectedPatientData.value = await kiditService.fetchPatientMasterRecord(newId)
  } else {
    selectedPatientData.value = null
  }
})

const selectedPatient = computed(() => {
  if (!selectedPatientId.value) return null
  return { id: selectedPatientId.value, name: selectedPatientName.value }
})

const selectedPatientVascularEvents = computed(() => {
  if (!selectedPatientId.value) return []
  return localEvents.value.filter(
    (e) => e.patientId === selectedPatientId.value && e.type === 'ACCESS',
  )
})

const selectedEvent = computed(() => {
  return localEvents.value.find((e) => e.patientId === selectedPatientId.value) || {}
})

function getEventData(key) {
  return selectedEvent.value[key] || null
}

function translateType(type) {
  const map = { MOVEMENT: '動態', ACCESS: '通路', TRANSFER: '轉移', CREATE: '新收', DELETE: '結案' }
  return map[type] || type
}

function getBadgeClass(type) {
  const map = {
    MOVEMENT: 'bg-blue-100 text-blue-800',
    ACCESS: 'bg-purple-100 text-purple-800',
    TRANSFER: 'bg-yellow-100 text-yellow-800',
    CREATE: 'bg-green-100 text-green-800',
    DELETE: 'bg-red-100 text-red-800',
  }
  return map[type] || 'bg-gray-100 text-gray-800'
}

function formatTime(ts) {
  if (!ts) return ''
  const date = ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts)
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function selectPatient(event) {
  selectedPatientId.value = event.patientId
  selectedPatientName.value = event.patientName
}

function handleTabClick(key) {
  const tab = tabs.find((t) => t.key === key)
  if (tab.requiresSelection && !selectedPatientId.value) {
    showAlert('提示', '請先在列表中點選一位病人')
    return
  }
  activeTab.value = key
}

function handleDataUpdated(key, newData) {
  const targetEvent = localEvents.value.find((e) => e.patientId === selectedPatientId.value)
  if (targetEvent && key) {
    targetEvent[key] = JSON.parse(JSON.stringify(newData))
  }
  showAlert('成功', '資料已儲存！')
  emit('refresh')
}

// 處理點擊驚嘆號時執行
function handleIncompleteClick(event) {
  selectPatient(event)
  switchToProfileTab()
}

function switchToVascularTab() {
  handleTabClick('vascular')
}
function switchToProfileTab() {
  handleTabClick('profile')
}
function switchToHistoryTab() {
  handleTabClick('history')
}

async function refreshPatientData() {
  if (selectedPatientId.value) {
    selectedPatientData.value = await kiditService.fetchPatientMasterRecord(selectedPatientId.value)
  }
}

// 1. 點擊刪除按鈕：打開確認框
function deleteEvent(index) {
  const event = localEvents.value[index]
  pendingDeleteIndex.value = index
  confirmDialogTitle.value = '確認移除'
  confirmDialogMessage.value = `確定要移除 ${event.patientName} 的這筆紀錄嗎？\n移除後需點擊「儲存動態列表變更」才會生效。`
  isConfirmDialogVisible.value = true
}

// 2. 執行刪除動作 (按下確認後)
function executeDelete() {
  if (pendingDeleteIndex.value !== -1) {
    const deletedEvent = localEvents.value[pendingDeleteIndex.value]
    localEvents.value.splice(pendingDeleteIndex.value, 1)

    // 如果刪除的是當前選中的病人，重置選取狀態
    if (deletedEvent.patientId === selectedPatientId.value) {
      selectedPatientId.value = null
      selectedPatientName.value = ''
    }
    pendingDeleteIndex.value = -1
  }
  isConfirmDialogVisible.value = false
}

async function saveAllEvents() {
  try {
    await kiditService.updateLogEvents(props.date, localEvents.value)
    showAlert('成功', '動態列表儲存成功！')
    emit('refresh')
  } catch (e) {
    console.error(e)
    showAlert('錯誤', '儲存失敗，請稍後再試。')
  }
}

function close() {
  emit('close')
  activeTab.value = 'movement'
  selectedPatientId.value = null
}

function isKiDitDataComplete(event) {
  const hasProfile = event.kidit_profile && event.kidit_profile.idNumber
  const hasHistory = event.kidit_history && event.kidit_history.diagnosisCategory
  const v = event.kidit_vascular?.current || {}
  const hasVascular = v.isAutoCap || v.isManuCap || v.isPermCath || v.isDoubleLumen
  return hasProfile && hasHistory && hasVascular
}
</script>

<style scoped>
/* 樣式與原檔相同，此處保留不變，請使用原本的樣式即可 */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(2px);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.modal-content {
  background: #fff;
  width: 95%;
  max-width: 1100px;
  height: 90vh;
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
  overflow: hidden;
}

/* --- Header --- */
.modal-header {
  padding: 15px 25px;
  background: #f8f9fa;
  border-bottom: 1px solid #e9ecef;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.header-title {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #2c3e50;
}
.header-title h3 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
}
.header-title .icon {
  color: #3498db;
  font-size: 1.2rem;
}
.close-btn {
  background: transparent;
  border: none;
  font-size: 1.2rem;
  color: #adb5bd;
  cursor: pointer;
  transition: color 0.2s;
}
.close-btn:hover {
  color: #e74c3c;
}

/* --- Tabs --- */
.tabs-header {
  display: flex;
  background: #fff;
  border-bottom: 2px solid #f1f3f5;
  padding: 0 20px;
}
.tab-btn {
  padding: 15px 20px;
  border: none;
  background: transparent;
  color: #6c757d;
  font-weight: 600;
  cursor: pointer;
  border-bottom: 3px solid transparent;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 8px;
}
.tab-btn:hover {
  color: #3498db;
  background: #f8f9fa;
}
.tab-btn.active {
  color: #3498db;
  border-bottom-color: #3498db;
}
.patient-tag {
  background: #e3f2fd;
  color: #1976d2;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 0.75rem;
}

/* --- Body --- */
.modal-body {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: #fff;
}
.tab-pane {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
}

.action-bar {
  margin-bottom: 15px;
}
.hint-text {
  color: #666;
  font-size: 0.9rem;
  display: flex;
  align-items: center;
  gap: 6px;
}

/* --- Modern Table --- */
.table-responsive {
  flex: 1;
  overflow-y: auto;
  border: 1px solid #e9ecef;
  border-radius: 8px;
}
.modern-table {
  width: 100%;
  border-collapse: collapse;
}
.modern-table th {
  background: #f8f9fa;
  color: #495057;
  font-weight: 600;
  padding: 12px 15px;
  text-align: left;
  position: sticky;
  top: 0;
  z-index: 1;
  border-bottom: 1px solid #dee2e6;
}
.modern-table td {
  padding: 10px 15px;
  border-bottom: 1px solid #f1f3f5;
  color: #333;
}
.modern-table tr:hover {
  background-color: #f8f9fa;
  cursor: pointer;
}
.modern-table tr.is-selected {
  background-color: #e3f2fd;
}

.status-badge {
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 500;
}
/* Tailwind-like classes mock */
.bg-blue-100 {
  background: #ebf8ff;
}
.text-blue-800 {
  color: #2c5282;
}
.bg-purple-100 {
  background: #faf5ff;
}
.text-purple-800 {
  color: #553c9a;
}
.bg-yellow-100 {
  background: #fffff0;
}
.text-yellow-800 {
  color: #744210;
}
.bg-green-100 {
  background: #f0fff4;
}
.text-green-800 {
  color: #22543d;
}
.bg-red-100 {
  background: #fff5f5;
}
.text-red-800 {
  color: #822727;
}
.bg-gray-100 {
  background: #f7fafc;
}
.text-gray-800 {
  color: #1a202c;
}

.font-medium {
  font-weight: 500;
}
.text-center {
  text-align: center;
}
.text-gray-600 {
  color: #718096;
  font-size: 0.9rem;
}

.form-input {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid #cbd5e0;
  border-radius: 4px;
  transition: border 0.2s;
}
.form-input:focus {
  border-color: #3498db;
  outline: none;
}

/* Checkbox */
.checkbox-container {
  display: inline-block;
  cursor: pointer;
  position: relative;
}
.checkbox-container input {
  position: absolute;
  opacity: 0;
  cursor: pointer;
}
.checkmark {
  height: 20px;
  width: 20px;
  background-color: #eee;
  border-radius: 4px;
  display: block;
  border: 1px solid #ccc;
}
.checkbox-container:hover input ~ .checkmark {
  background-color: #ccc;
}
.checkbox-container input:checked ~ .checkmark {
  background-color: #2196f3;
  border-color: #2196f3;
}
.checkmark:after {
  content: '';
  position: absolute;
  display: none;
  left: 6px;
  top: 2px;
  width: 5px;
  height: 10px;
  border: solid white;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}
.checkbox-container input:checked ~ .checkmark:after {
  display: block;
}

/* Buttons */
.btn-primary {
  background: #3498db;
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: background 0.2s;
}
.btn-primary:hover {
  background: #2980b9;
}

.icon-btn {
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 6px;
  border-radius: 4px;
  transition: all 0.2s;
  color: #6c757d;
}
.delete-btn:hover {
  color: #e74c3c;
  background: #fee2e2;
}

.footer-actions {
  padding-top: 15px;
  border-top: 1px solid #eee;
  text-align: right;
  display: flex;
  justify-content: flex-end;
}

/* --- Empty State --- */
.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #adb5bd;
  height: 100%;
}
.bounce-icon {
  font-size: 3rem;
  margin-bottom: 15px;
  animation: bounce 2s infinite;
}
@keyframes bounce {
  0%,
  20%,
  50%,
  80%,
  100% {
    transform: translateX(0);
  }
  40% {
    transform: translateX(-10px);
  }
  60% {
    transform: translateX(-5px);
  }
}

/* --- Sub Tabs & Content --- */
.vascular-container {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.sub-tabs {
  display: flex;
  gap: 10px;
  padding-bottom: 15px;
  border-bottom: 1px solid #eee;
  margin-bottom: 15px;
}
.sub-tabs button {
  padding: 6px 16px;
  border: 1px solid #ddd;
  background: #fff;
  border-radius: 20px;
  cursor: pointer;
  font-size: 0.9rem;
  color: #555;
  transition: all 0.2s;
}
.sub-tabs button.active {
  background: #3498db;
  color: white;
  border-color: #3498db;
  box-shadow: 0 2px 5px rgba(52, 152, 219, 0.3);
}
.sub-content {
  flex: 1;
  overflow-y: auto;
}

.event-list {
  list-style: none;
  padding: 0;
}
.event-list li {
  padding: 12px;
  border-bottom: 1px solid #f1f3f5;
  display: flex;
  align-items: center;
  gap: 12px;
}
.time-badge {
  background: #e9ecef;
  color: #495057;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.85rem;
  font-family: monospace;
}
.event-text {
  color: #333;
  line-height: 1.4;
}
.no-data {
  color: #aaa;
  text-align: center;
  padding: 20px;
  font-style: italic;
}

.action-cell {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px; /* 讓刪除按鈕和警示圖示保持距離 */
}

.text-green-500 {
  color: #27ae60;
  font-size: 1.1rem;
}

.warning-btn {
  color: #e67e22; /* 橘色警告 */
  animation: pulse 2s infinite;
}
.warning-btn:hover {
  color: #d35400;
  background: #fff3e0;
}

@keyframes pulse {
  0% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.7;
    transform: scale(1.1);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
}
</style>
