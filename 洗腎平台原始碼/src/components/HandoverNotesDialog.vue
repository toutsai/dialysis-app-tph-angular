<!-- 檔案路徑: src/components/HandoverNotesDialog.vue (儲存邏輯更新版) -->
<template>
  <div v-if="isVisible" class="dialog-overlay">
    <div class="dialog-container">
      <header class="dialog-header">
        <h2>組長交班事項 ({{ targetDate }})</h2>
        <button @click="close" class="close-btn">&times;</button>
      </header>
      <main class="dialog-body">
        <textarea
          v-model="editableNotes"
          class="notes-textarea"
          rows="15"
          placeholder="請輸入交班事項..."
        ></textarea>
      </main>
      <footer class="dialog-footer">
        <span class="save-status">{{ saveStatus }}</span>
        <button @click="close" class="btn btn-secondary">取消</button>
        <button @click="handleSave" class="btn btn-primary" :disabled="isSaving">
          {{ isSaving ? '儲存中...' : '儲存並同步' }}
        </button>
      </footer>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { useAuth } from '@/composables/useAuth'
import { nursingApi } from '@/services/localApiClient'

const props = defineProps({
  isVisible: Boolean,
  initialNotes: String,
  targetDate: String,
})

const emit = defineEmits(['close', 'notes-updated'])

const { currentUser } = useAuth()
const editableNotes = ref('')
const isSaving = ref(false)
const saveStatus = ref('')

watch(
  () => props.isVisible,
  (newVal) => {
    if (newVal) {
      editableNotes.value = props.initialNotes || ''
      saveStatus.value = ''
    }
  },
)

async function handleSave() {
  if (!currentUser.value) {
    alert('您必須登入才能儲存。')
    return
  }
  isSaving.value = true
  saveStatus.value = '儲存中...'

  const handoverContent = editableNotes.value.trim()

  try {
    const handoverData = {
      content: handoverContent,
      updatedBy: {
        uid: currentUser.value.uid,
        name: currentUser.value.name,
      },
      updatedAt: new Date().toISOString(),
      sourceDate: props.targetDate, // 記錄是從哪一天的日誌發起的更新
    }

    // 使用 local API 儲存
    await nursingApi.saveHandoverLog(handoverData)

    // 觸發事件，將更新後的內容即時傳回給 DailyLogView
    emit('notes-updated', handoverContent)

    saveStatus.value = `儲存成功！ (${new Date().toLocaleTimeString()})`

    setTimeout(() => {
      close()
    }, 1000)
  } catch (error) {
    console.error('儲存交班事項失敗:', error)
    saveStatus.value = '儲存失敗，請重試。'
  } finally {
    isSaving.value = false
  }
}

function close() {
  emit('close')
}
</script>

<style scoped>
/* 此處樣式與您提供的 DailyLogView.vue 中推斷的樣式一致，無需修改 */
.dialog-overlay {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1001;
}
.dialog-container {
  background: white;
  border-radius: 8px;
  width: 90%;
  max-width: 600px;
  display: flex;
  flex-direction: column;
}
.dialog-header {
  padding: 1rem 1.5rem;
  border-bottom: 1px solid #e9ecef;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
h2 {
  margin: 0;
  font-size: 1.25rem;
}
.close-btn {
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
}
.dialog-body {
  padding: 1.5rem;
}
.notes-textarea {
  width: 100%;
  padding: 0.75rem;
  font-size: 1rem;
  line-height: 1.6;
  border: 1px solid #ced4da;
  border-radius: 6px;
  resize: vertical;
}
.dialog-footer {
  padding: 1rem 1.5rem;
  border-top: 1px solid #e9ecef;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 0.75rem;
}
.save-status {
  margin-right: auto;
  font-style: italic;
  color: #6c757d;
}
.btn {
  padding: 0.6rem 1.2rem;
  border-radius: 6px;
  border: 1px solid transparent;
  cursor: pointer;
}
.btn-primary {
  background-color: #007bff;
  color: white;
}
.btn-secondary {
  background-color: #6c757d;
  color: white;
}
.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
