<template>
  <div v-if="isVisible" class="dialog-overlay">
    <div class="dialog-container">
      <header class="dialog-header">
        <h2>設定全域跑馬燈公告</h2>
        <button @click="close" class="close-btn">&times;</button>
      </header>
      <main class="dialog-body">
        <!-- ✨ 核心：Quill 富文本編輯器 ✨ -->
        <QuillEditor
          v-model:content="editableContent"
          theme="snow"
          :toolbar="toolbarOptions"
          contentType="html"
          placeholder="在此輸入並編輯公告內容..."
          style="height: 200px"
        />
      </main>
      <footer class="dialog-footer">
        <button @click="close" class="btn btn-secondary">取消</button>
        <button @click="handleSave" class="btn btn-primary" :disabled="isSaving">
          {{ isSaving ? '儲存中...' : '儲存公告' }}
        </button>
      </footer>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
// 引入 QuillEditor 元件和它的 CSS
import { QuillEditor } from '@vueup/vue-quill'

const props = defineProps({
  isVisible: Boolean,
  initialContent: String, // 現在接收的是 HTML 字串
})

const emit = defineEmits(['close', 'save'])

const editableContent = ref('')
const isSaving = ref(false)

// ✨ 定義我們想要的工具欄選項
const toolbarOptions = [
  ['bold', 'italic'], // 粗體、斜體
  [{ size: ['small', false, 'large', 'huge'] }], // 字體大小
  [{ color: [] }], // 文字顏色
  ['clean'], // 清除格式
]

watch(
  () => props.isVisible,
  (newVal) => {
    if (newVal) {
      // 當彈窗打開時，設定初始內容
      editableContent.value = props.initialContent || ''
    }
  },
)

function handleSave() {
  // 觸發 save 事件，將編輯器產生的 HTML 內容傳遞給父元件
  emit('save', editableContent.value)
}

function close() {
  emit('close')
}
</script>

<style scoped>
/* 這裡的樣式與您之前的 Dialog 類似 */
.dialog-overlay {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1002;
}
.dialog-container {
  background: white;
  border-radius: 8px;
  width: 90%;
  max-width: 700px;
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
.dialog-footer {
  padding: 1rem 1.5rem;
  border-top: 1px solid #e9ecef;
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
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
