<!-- 檔案路徑: src/components/SelectionDialog.vue -->
<script setup>
import { watch } from 'vue'

const props = defineProps({
  isVisible: Boolean,
  title: String,
  options: {
    type: Array,
    required: true,
    validator: (options) => {
      return options.every((opt) => typeof opt === 'object' && 'value' in opt && 'text' in opt)
    },
  },
})
const emit = defineEmits(['select', 'cancel'])

// 【核心修正】: 監聽 isVisible 屬性
// 當對話框顯示時，為 <body> 添加 class 以鎖定滾動；隱藏時，移除該 class。
watch(
  () => props.isVisible,
  (newVal) => {
    if (typeof document !== 'undefined') {
      // 確保在瀏覽器環境中執行
      if (newVal) {
        document.body.classList.add('modal-open')
      } else {
        document.body.classList.remove('modal-open')
      }
    }
  },
)

function handleSelect(selectedValue) {
  emit('select', selectedValue)
}

function handleCancel() {
  emit('cancel')
}
</script>

<template>
  <!-- 【新增】: 使用 <Transition> 包裹，實現平滑的淡入淡出效果 -->
  <Transition name="dialog-fade">
    <!-- 【修改】: dialog 元素現在由一個 overlay 包裹，以實現更好的居中和背景模糊效果 -->
    <div v-if="isVisible" class="selection-dialog-overlay" v-overlay-close="handleCancel">
      <div class="selection-dialog-content">
        <h3>{{ title }}</h3>
        <div class="button-group">
          <button v-for="option in options" :key="option.value" @click="handleSelect(option.value)">
            {{ option.text }}
          </button>
        </div>
        <div class="button-group">
          <button @click="handleCancel" class="cancel-btn">取消</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* 【新增】: body 鎖定時的樣式 */
:global(body.modal-open) {
  overflow: hidden;
}

/* 【修改】: 整個對話框的結構樣式 */
.selection-dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 2000;
}

.selection-dialog-content {
  background: white;
  padding: 25px 30px;
  border-radius: 12px;
  box-shadow: 0 5px 20px rgba(0, 0, 0, 0.2);
  width: 90%;
  max-width: 400px;
  text-align: center;
}

.selection-dialog-content h3 {
  margin-top: 0;
  margin-bottom: 25px;
  font-size: 1.5em;
  color: #333;
}

.button-group {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 15px;
}

.button-group button {
  width: 100%;
  padding: 12px 20px;
  font-size: 1.1em;
  cursor: pointer;
  border-radius: 8px;
  border: 1px solid #ddd;
  background-color: #f8f9fa;
  color: #333;
  transition: all 0.2s ease-in-out;
}

.button-group button:hover {
  border-color: #007bff;
  background-color: #e3f2fd;
  color: #007bff;
}

.button-group button.cancel-btn {
  background-color: transparent;
  color: #6c757d;
  border-color: #ced4da;
  margin-top: 10px;
}
.button-group button.cancel-btn:hover {
  background-color: #e9ecef;
  border-color: #adb5bd;
  color: #495057;
}

/* 【新增】: 過渡動畫樣式 */
.dialog-fade-enter-active,
.dialog-fade-leave-active {
  transition: opacity 0.25s ease;
}

.dialog-fade-enter-from,
.dialog-fade-leave-to {
  opacity: 0;
}
</style>
