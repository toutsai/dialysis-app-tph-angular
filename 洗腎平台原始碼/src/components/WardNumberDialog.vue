<template>
  <dialog :open="isVisible" class="ward-dialog" @close="onCancel">
    <header class="dialog-header">
      <h3>{{ title || '請輸入住院床號' }}</h3>
    </header>
    <main class="dialog-content">
      <p class="dialog-message">{{ message || '請輸入住院床號（可留空移除）' }}</p>
      <input
        ref="inputRef"
        v-model="localValue"
        type="text"
        class="ward-input"
        placeholder="例如：5B12"
        @keyup.enter="onConfirm"
        @keyup.esc="onCancel"
        maxlength="20"
      />
    </main>

    <footer class="dialog-footer">
      <button class="btn-primary" @click="onConfirm">確定</button>
      <button class="btn-secondary" @click="onCancel">取消</button>
    </footer>
  </dialog>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue'

const props = defineProps({
  isVisible: Boolean,
  title: String,
  message: String,
  currentValue: String, // 目前的床號值
})

const emit = defineEmits(['confirm', 'cancel'])

const localValue = ref('')
const inputRef = ref(null)

// 當對話框開啟時，設定初始值並聚焦
watch(
  () => props.isVisible,
  (newVal) => {
    if (newVal) {
      localValue.value = props.currentValue || ''
      nextTick(() => {
        inputRef.value?.focus()
        inputRef.value?.select()
      })
    }
  },
)

function onConfirm() {
  emit('confirm', localValue.value.trim())
}

function onCancel() {
  emit('cancel')
}
</script>

<style scoped>
.ward-dialog {
  border: 1px solid #dee2e6;
  border-radius: 12px;
  padding: 0;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  width: 90%;
  max-width: 400px;
  z-index: 1001;
  animation: fadeIn 0.3s ease-out;
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translate(-50%, -45%);
  }
  to {
    opacity: 1;
    transform: translate(-50%, -50%);
  }
}

.ward-dialog::backdrop {
  background-color: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(2px);
}

.dialog-header {
  padding: 16px 24px;
  border-bottom: 1px solid #e9ecef;
  background-color: #f8f9fa;
}

.dialog-header h3 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: #343a40;
}

.dialog-content {
  padding: 24px;
  background-color: #fff;
}

.dialog-message {
  margin: 0 0 16px 0;
  color: #495057;
  line-height: 1.5;
}

.ward-input {
  width: 100%;
  padding: 10px 12px;
  font-size: 1rem;
  border: 2px solid #ced4da;
  border-radius: 6px;
  transition: all 0.2s ease-in-out;
}

.ward-input:focus {
  outline: none;
  border-color: #007bff;
  box-shadow: 0 0 0 3px rgba(0, 123, 255, 0.1);
}

.dialog-footer {
  padding: 16px 24px;
  border-top: 1px solid #e9ecef;
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  background-color: #f8f9fa;
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
  background-color: #007bff;
  border-color: #007bff;
  color: white;
}

.btn-primary:hover {
  background-color: #0056b3;
  border-color: #004085;
}
</style>
