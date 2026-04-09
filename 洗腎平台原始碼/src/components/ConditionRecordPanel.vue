<!-- 檔案路徑: src/components/ConditionRecordPanel.vue (作為整合式彈窗的子面板) -->
<template>
  <!-- 移除外層的 modal-overlay 和 modal-content，直接從內容區塊開始 -->
  <div class="condition-record-panel-content">
    <!-- 新增/編輯紀錄區塊 -->
    <div class="record-form" ref="recordFormElement">
      <textarea
        v-model="newRecordContent"
        :placeholder="editingRecordId ? '正在編輯紀錄...' : '請在此輸入病情、透析狀況或注意事項...'"
        rows="4"
      ></textarea>
      <div class="form-actions">
        <button v-if="editingRecordId" @click="cancelEditing" class="cancel-button">
          取消編輯
        </button>
        <button @click="handleSave" class="save-button" :disabled="isSaving">
          {{ isSaving ? '儲存中...' : editingRecordId ? '更新紀錄' : '儲存紀錄' }}
        </button>
      </div>
    </div>

    <!-- 歷史紀錄區塊 -->
    <div class="history-section">
      <h3 class="history-title">歷史紀錄</h3>
      <div v-if="isLoading" class="loading-state">
        <div class="spinner"></div>
        正在讀取歷史紀錄...
      </div>
      <div v-else-if="error" class="error-state">
        {{ error }}
      </div>
      <ul v-else-if="history.length > 0" class="history-list">
        <li v-for="record in history" :key="record.id" class="history-item">
          <p class="record-content">{{ record.content }}</p>
          <div class="record-meta">
            <span class="author">紀錄者: {{ record.authorName || '未知' }}</span>
            <span class="timestamp">{{ formatTimestamp(record.createdAt) }}</span>
          </div>
          <!-- 只有作者能看到編輯和刪除按鈕 -->
          <div
            v-if="auth.currentUser.value && record.authorId === auth.currentUser.value.uid"
            class="record-actions"
          >
            <button @click="startEditing(record)" class="action-btn edit-btn">編輯</button>
            <button @click="handleDelete(record.id)" class="action-btn delete-btn">刪除</button>
          </div>
        </li>
      </ul>
      <div v-else class="empty-state">這位病人目前沒有任何歷史病情紀錄。</div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, toRefs } from 'vue'
import ApiManager from '@/services/api_manager'
import { useAuth } from '@/composables/useAuth'
import { formatDateToYYYYMMDD } from '@/utils/dateUtils.js'

const props = defineProps({
  patient: Object,
  currentDate: Date,
})

const emit = defineEmits(['save', 'update', 'delete'])

const { patient } = toRefs(props)

const newRecordContent = ref('')
const history = ref([])
const isLoading = ref(false)
const isSaving = ref(false)
const error = ref(null)
const editingRecordId = ref(null)
const recordFormElement = ref(null)

const conditionRecordsApi = ApiManager('condition_records')
const auth = useAuth()

async function fetchHistory() {
  if (!patient.value?.id) {
    history.value = []
    return
  }
  isLoading.value = true
  error.value = null
  history.value = []
  try {
    const allRecords = await conditionRecordsApi.fetchAll()
    // Filter by patientId and sort by createdAt descending
    history.value = allRecords
      .filter((record) => record.patientId === patient.value.id)
      .sort((a, b) => {
        const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt)
        const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt)
        return dateB - dateA
      })
  } catch (err) {
    console.error('讀取歷史病情紀錄失敗:', err)
    error.value = '讀取歷史紀錄失敗。'
  } finally {
    isLoading.value = false
  }
}

function formatTimestamp(ts) {
  if (!ts) return '未知時間'
  const date = ts.toDate ? ts.toDate() : new Date(ts)
  return date.toLocaleString('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

async function handleSave() {
  if (!newRecordContent.value.trim() || !patient.value || isSaving.value) return

  isSaving.value = true

  try {
    if (editingRecordId.value) {
      // 更新操作通常不需要修改 expireAt，所以這裡保持不變
      emit('update', {
        id: editingRecordId.value,
        content: newRecordContent.value.trim(),
      })
    } else {
      // ✨✨✨ 核心修改點在這裡 ✨✨✨

      // 1. 建立 createdAt 的 Date 物件
      const createdAtDate = new Date()

      // 2. 計算 6 個月後的日期
      const expireAtDate = new Date(createdAtDate)
      expireAtDate.setMonth(expireAtDate.getMonth() + 6)

      const recordData = {
        content: newRecordContent.value.trim(),
        authorId: auth.currentUser.value.uid,
        authorName: auth.currentUser.value.name,
        patientId: patient.value.id,
        patientName: patient.value.name,
        recordDate: formatDateToYYYYMMDD(props.currentDate || new Date()),
        createdAt: createdAtDate, // 使用我們剛剛建立的 Date 物件

        // 3. 將 expireAt 也加入要儲存的資料中
        expireAt: expireAtDate,
      }
      emit('save', recordData)
    }
    cancelEditing()
    await fetchHistory()
  } catch (err) {
    console.error('從 Panel 觸發儲存/更新失敗:', err)
  } finally {
    isSaving.value = false
  }
}

function startEditing(record) {
  editingRecordId.value = record.id
  newRecordContent.value = record.content
  recordFormElement.value?.scrollIntoView({ behavior: 'smooth' })
}

function cancelEditing() {
  editingRecordId.value = null
  newRecordContent.value = ''
}

async function handleDelete(recordId) {
  emit('delete', recordId)
  history.value = history.value.filter((r) => r.id !== recordId)
}

watch(
  () => patient.value?.id,
  (newPatientId) => {
    if (newPatientId) {
      cancelEditing()
      error.value = null
      fetchHistory()
    } else {
      history.value = []
    }
  },
  { immediate: true },
)
</script>

<style scoped>
.condition-record-panel-content {
  padding: 0; /* 讓父元件的 padding 控制 */
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1.5rem; /* 原本的 gap */
  height: 100%; /* 確保 Panel 填滿父容器高度 */
}

.record-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.record-form textarea {
  width: 100%;
  padding: 0.75rem;
  border-radius: 8px;
  border: 1px solid #ced4da;
  font-size: 1rem;
  line-height: 1.6;
  resize: vertical;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.save-button,
.cancel-button {
  padding: 0.6rem 1.2rem;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
}

.save-button {
  background-color: #007bff;
  color: white;
}

.cancel-button {
  background-color: #6c757d;
  color: white;
}

.save-button:disabled {
  background-color: #6c757d;
  cursor: not-allowed;
}

.history-section {
  border-top: 1px solid #e9ecef;
  padding-top: 1.5rem;
}

.history-title {
  font-size: 1.25rem;
  color: #495057;
  margin: 0 0 1rem 0;
}

.history-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.history-item {
  background-color: #f8f9fa;
  border-radius: 8px;
  padding: 1rem;
  border: 1px solid #e9ecef;
}

.record-content {
  margin: 0 0 0.5rem 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.record-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.85rem;
  color: #6c757d;
  margin-bottom: 0.5rem;
}
.author {
  font-weight: 500;
  color: #495057;
}

.record-actions {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
  border-top: 1px solid #dee2e6;
  padding-top: 0.5rem;
  margin-top: 0.5rem;
}

.action-btn {
  padding: 4px 8px;
  font-size: 0.8rem;
  border: 1px solid;
  border-radius: 4px;
  cursor: pointer;
}

.edit-btn {
  background-color: #ffc107;
  border-color: #ffc107;
  color: #212529;
}

.delete-btn {
  background-color: #dc3545;
  border-color: #dc3545;
  color: white;
}

.loading-state,
.empty-state,
.error-state {
  text-align: center;
  padding: 2rem 0;
  color: #6c757d;
}

.error-state {
  color: #dc3545;
  background-color: #f8d7da;
  border-radius: 8px;
  padding: 1rem;
}

.spinner {
  width: 24px;
  height: 24px;
  border: 3px solid #f3f3f3;
  border-top: 3px solid #007bff;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 auto 0.5rem;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}
</style>
