<!-- 檔案路徑: src/components/MemoDisplayDialog.vue (最終修正版) -->
<template>
  <dialog ref="dialogRef" class="memo-dialog">
    <div v-if="isVisible">
      <header class="dialog-header">
        <h3>{{ patientName }} 的待辦留言</h3>
        <button class="close-btn" @click="emit('close')" title="關閉">×</button>
      </header>
      <main class="dialog-content">
        <div v-if="taskStore.isLoading" class="empty-state">載入中...</div>
        <ul v-else-if="pendingMessages.length > 0" class="memo-list-in-dialog">
          <li v-for="memo in pendingMessages" :key="memo.id" class="memo-item-in-dialog">
            <p class="memo-text">
              <span class="message-type-icon" :title="memo.type || '一般交班'">
                {{ getMessageTypeIcon(memo.type) }}
              </span>
              {{ memo.content }}
            </p>
            <div class="memo-meta-in-dialog">
              <span>建立於: {{ memo.createdAt.toLocaleDateString() }}</span>
              <span v-if="memo.targetDate"
                >| 目標日期: <strong>{{ memo.targetDate }}</strong></span
              >
            </div>
          </li>
        </ul>
        <div v-else class="empty-state">該病人沒有待處理的留言。</div>
      </main>
      <footer class="dialog-footer">
        <button class="btn-primary" @click="emit('close')">關閉</button>
      </footer>
    </div>
  </dialog>
</template>

<script setup>
import { ref, watch, computed } from 'vue'
import { useTaskStore } from '@/stores/taskStore' // ✨ 引入 taskStore

const props = defineProps({
  isVisible: Boolean,
  patientId: String, // ✨ props 改為接收 patientId
  patientName: String,
})

const emit = defineEmits(['close'])
const dialogRef = ref(null)

const taskStore = useTaskStore() // ✨ 實例化 store

// ✨ computed 屬性，從 store 中篩選出特定病人的未讀留言
const pendingMessages = computed(() => {
  if (!props.patientId) return []
  return taskStore.sortedFeedMessages.filter(
    (msg) => msg.patientId === props.patientId && msg.status === 'pending',
  )
})

function getMessageTypeIcon(type) {
  switch (type) {
    case '抽血':
      return '🩸'
    case '衛教':
      return '🎓'
    case '常規':
    default:
      return '📝'
  }
}

watch(
  () => props.isVisible,
  (newValue) => {
    if (dialogRef.value) {
      if (newValue) {
        dialogRef.value.showModal()
      } else {
        dialogRef.value.close()
      }
    }
  },
)

function handleDialogClose() {
  emit('close')
}

// ✨ onMounted/onUnmounted 來處理事件監聽
import { onMounted, onUnmounted } from 'vue'
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
/* ✨ 新增圖示樣式 */
.message-type-icon {
  display: inline-block;
  margin-right: 0.5rem;
  font-size: 1.2rem;
  vertical-align: middle;
}

.memo-dialog {
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

.memo-dialog::backdrop {
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

.memo-list-in-dialog {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.memo-item-in-dialog {
  background-color: #f8f9fa;
  padding: 16px;
  border-radius: 8px;
  border-left: 4px solid var(--primary-color, #007bff);
}
.memo-text {
  white-space: pre-wrap;
  word-wrap: break-word;
  font-size: 1rem;
  margin: 0 0 12px 0;
  color: #212529;
}
.memo-meta-in-dialog {
  font-size: 0.85rem;
  color: #6c757d;
  text-align: right;
}
.memo-meta-in-dialog strong {
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
