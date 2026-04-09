<!-- src/components/ConfirmDialog.vue (升級版，支援自訂 footer) -->
<template>
  <dialog ref="dialogRef" class="confirm-dialog" @close="onCancel">
    <header class="dialog-header" v-if="title">
      <h3>{{ title }}</h3>
    </header>
    <main class="dialog-content">
      <pre>{{ message }}</pre>
    </main>

    <!-- ✨✨✨ 核心升級 ✨✨✨ -->
    <!-- 1. 使用 <slot> 來檢查父元件是否提供了名為 "footer" 的插槽 -->
    <!--    - v-if="$slots.footer" 判斷插槽是否存在 -->
    <!--    - 如果存在，就渲染 <slot name="footer"></slot>，將父元件的內容插入此處 -->
    <slot v-if="$slots.footer" name="footer"></slot>

    <!-- 2. 如果沒有提供 footer 插槽，就渲染原本的預設 footer -->
    <footer v-else class="dialog-footer">
      <button :class="cancelClass" @click="onCancel">{{ cancelText }}</button>
      <button :class="confirmClass" @click="onConfirm">{{ confirmText }}</button>
    </footer>
  </dialog>
</template>

<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  isVisible: Boolean,
  title: String,
  message: String,
  confirmText: {
    type: String,
    default: '確認',
  },
  cancelText: {
    type: String,
    default: '取消',
  },
  confirmClass: {
    type: String,
    default: 'btn-primary',
  },
  cancelClass: {
    type: String,
    default: 'btn-secondary',
  },
})
const emit = defineEmits(['confirm', 'cancel'])

const dialogRef = ref(null)

// 使用 watch 來正確控制 dialog 的顯示/隱藏
watch(() => props.isVisible, (newValue) => {
  if (newValue) {
    dialogRef.value?.showModal()
  } else {
    dialogRef.value?.close()
  }
})

function onConfirm() {
  emit('confirm')
}
function onCancel() {
  emit('cancel')
}
</script>

<style scoped>
/* (您的所有 CSS 樣式都保持不變) */
.btn-danger {
  background-color: #dc3545;
  border-color: #dc3545;
  color: white;
}
.btn-danger:hover {
  background-color: #c82333;
  border-color: #c82333;
}
.confirm-dialog {
  border: 1px solid #dee2e6;
  border-radius: 12px;
  padding: 0;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  width: 90%;
  max-width: 500px;
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
.confirm-dialog::backdrop {
  background-color: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(2px);
}
.dialog-header {
  padding: 16px 24px;
  border-bottom: 1px solid #e9ecef;
  font-size: 1.25rem;
  font-weight: 600;
  color: #343a40;
}
.dialog-header h3 {
  margin: 0;
}
.dialog-content {
  padding: 24px;
  line-height: 1.6;
  color: #495057;
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
  justify-content: flex-end;
  gap: 12px;
}
.dialog-footer button {
  padding: 10px 24px;
  font-size: 1rem;
  font-weight: 500;
  border-radius: 6px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.2s ease-in-out;
}
.btn-secondary {
  background-color: #fff;
  border-color: #ced4da;
  color: #495057;
}
.btn-secondary:hover {
  background-color: #f8f9fa;
  border-color: #adb5bd;
}
.btn-primary {
  background-color: var(--primary-color, #007bff);
  border-color: var(--primary-color, #007bff);
  color: white;
}
.btn-primary:hover {
  background-color: var(--primary-color-dark, #0056b3);
  border-color: var(--primary-color-dark, #0056b3);
}
</style>
