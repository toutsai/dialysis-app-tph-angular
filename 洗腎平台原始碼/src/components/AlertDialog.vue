<!-- src/components/AlertDialog.vue -->
<template>
  <dialog :open="isVisible" class="alert-dialog" @close="handleConfirm">
    <header class="dialog-header" v-if="title">
      <h3>{{ title }}</h3>
    </header>
    <main class="dialog-content">
      <!--
        使用 <pre> 標籤可以保留文字中的換行和空格，
        非常適合顯示格式化的警告訊息。
      -->
      <pre>{{ message }}</pre>
    </main>
    <footer class="dialog-footer">
      <button class="btn-primary" @click="handleConfirm">確定</button>
    </footer>
  </dialog>
</template>

<script setup>
defineProps({
  isVisible: Boolean,
  title: String,
  message: String,
})
const emit = defineEmits(['confirm'])

function handleConfirm() {
  emit('confirm')
}
</script>

<style scoped>
.alert-dialog {
  border: 1px solid #dee2e6; /* 更柔和的邊框顏色 */
  border-radius: 12px;
  padding: 0; /* 移除預設 padding，由內部控制 */
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15); /* 更柔和的陰影 */
  width: 90%;
  max-width: 500px; /* 稍微調整寬度 */
  z-index: 1000;
  animation: fadeIn 0.3s ease-out;
  /* ======================= 【置中的關鍵修正】 ======================= */
  /* 將這段樣式從 ConfirmDialog 複製過來 */
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  /* ============================================================= */
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.alert-dialog::backdrop {
  background-color: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(2px); /* 增加毛玻璃效果 */
}

.dialog-header {
  padding: 16px 24px;
  border-bottom: 1px solid #e9ecef;
  font-size: 1.25rem; /* 稍微加大字體 */
  font-weight: 600; /* 加粗 */
  color: #343a40;
}
.dialog-header h3 {
  margin: 0;
}

.dialog-content {
  padding: 24px;
  line-height: 1.6;
  color: #495057; /* 調整文字顏色 */
}

.dialog-content pre {
  white-space: pre-wrap;
  word-wrap: break-word;
  font-family: inherit;
  font-size: 1rem;
  margin: 0;
}

.dialog-footer {
  padding: 16px 24px;
  border-top: 1px solid #e9ecef;
  display: flex;
  justify-content: flex-end; /* 按鈕靠右 */
}

/* ======================= 【統一按鈕樣式】 ======================= */
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
/* ============================================================= */
</style>
