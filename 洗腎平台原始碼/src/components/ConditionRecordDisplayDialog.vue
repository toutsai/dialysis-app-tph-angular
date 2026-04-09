<!-- 檔案路徑: src/components/ConditionRecordDisplayDialog.vue -->
<template>
  <dialog ref="dialogRef" class="condition-record-dialog">
    <div v-if="isVisible">
      <header class="dialog-header">
        <h3>{{ patientName }} 的近期病情紀錄</h3>
        <button class="close-btn" @click="emit('close')" title="關閉">×</button>
      </header>
      <main class="dialog-content">
        <div v-if="isLoading" class="empty-state">載入中...</div>
        <ul v-else-if="records.length > 0" class="record-list">
          <li v-for="record in records" :key="record.id" class="record-item">
            <p class="record-content">{{ record.content }}</p>
            <div class="record-meta">
              <span class="author">紀錄者: {{ record.authorName || '未知' }}</span>
              <span class="timestamp">{{ formatTimestamp(record.createdAt) }}</span>
            </div>
          </li>
        </ul>
        <div v-else class="empty-state">該病人近 7 天內沒有病情紀錄。</div>
      </main>
      <footer class="dialog-footer">
        <button class="btn-primary" @click="emit('close')">關閉</button>
      </footer>
    </div>
  </dialog>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
import ApiManager from '@/services/api_manager'

const props = defineProps({
  isVisible: Boolean,
  patientId: String,
  patientName: String,
  targetDate: String, // 可選：用於篩選特定日期的紀錄
})

const emit = defineEmits(['close'])
const dialogRef = ref(null)
const records = ref([])
const isLoading = ref(false)

const conditionRecordsApi = ApiManager('condition_records')

async function fetchRecords() {
  if (!props.patientId) {
    records.value = []
    return
  }

  isLoading.value = true
  try {
    // 查詢近 7 天內建立的病情紀錄（與圖示顯示邏輯一致）
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    const allRecords = await conditionRecordsApi.fetchAll()
    // Filter by patientId, date range, and sort by createdAt descending
    records.value = allRecords
      .filter((record) => {
        if (record.patientId !== props.patientId) return false
        const createdAt = record.createdAt?.toDate ? record.createdAt.toDate() : new Date(record.createdAt)
        return createdAt >= sevenDaysAgo
      })
      .sort((a, b) => {
        const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt)
        const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt)
        return dateB - dateA
      })
  } catch (err) {
    console.error('讀取病情紀錄失敗:', err)
    records.value = []
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

watch(
  () => props.isVisible,
  (newValue) => {
    if (dialogRef.value) {
      if (newValue) {
        fetchRecords()
        dialogRef.value.showModal()
      } else {
        dialogRef.value.close()
      }
    }
  },
)

watch(
  () => props.patientId,
  () => {
    if (props.isVisible) {
      fetchRecords()
    }
  },
)

function handleDialogClose() {
  emit('close')
}

onMounted(() => {
  if (dialogRef.value) {
    dialogRef.value.addEventListener('close', handleDialogClose)
  }
})

onUnmounted(() => {
  if (dialogRef.value) {
    dialogRef.value.removeEventListener('close', handleDialogClose)
  }
})
</script>

<style scoped>
.condition-record-dialog {
  border: 1px solid #dee2e6;
  border-radius: 12px;
  padding: 0;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  width: 90%;
  max-width: 650px;
  z-index: 1001;
  animation: fadeIn 0.3s ease-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.condition-record-dialog::backdrop {
  background-color: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(2px);
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  border-bottom: 1px solid #e9ecef;
}

.dialog-header h3 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: #343a40;
}

.close-btn {
  background: none;
  border: none;
  font-size: 2rem;
  line-height: 1;
  cursor: pointer;
  padding: 0;
  color: #adb5bd;
  transition: color 0.2s;
}

.close-btn:hover {
  color: #495057;
}

.dialog-content {
  padding: 16px 24px;
  max-height: 60vh;
  overflow-y: auto;
}

.record-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.record-item {
  background-color: #f8f9fa;
  padding: 16px;
  border-radius: 8px;
  border-left: 4px solid #17a2b8;
}

.record-content {
  white-space: pre-wrap;
  word-wrap: break-word;
  font-size: 1rem;
  margin: 0 0 12px 0;
  color: #212529;
}

.record-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.85rem;
  color: #6c757d;
}

.author {
  font-weight: 500;
  color: #495057;
}

.empty-state {
  text-align: center;
  color: #6c757d;
  font-size: 1.1rem;
  padding: 40px 20px;
}

.dialog-footer {
  padding: 16px 24px;
  border-top: 1px solid #e9ecef;
  display: flex;
  justify-content: flex-end;
}

.btn-primary {
  padding: 10px 24px;
  font-size: 1rem;
  font-weight: 500;
  background-color: var(--primary-color, #007bff);
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.2s ease-in-out;
}

.btn-primary:hover {
  background-color: var(--primary-color-dark, #0056b3);
}
</style>
