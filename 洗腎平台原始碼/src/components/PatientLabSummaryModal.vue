<!-- 檔案路徑: src/components/PatientLabSummaryModal.vue (引用 Panel 的新版本) -->
<template>
  <div v-if="isVisible" class="modal-overlay" v-overlay-close="handleClose">
    <div class="modal-container">
      <div class="modal-header">
        <h2>{{ patient?.name }} - 檢驗報告摘要</h2>
        <button @click="handleClose" class="close-btn">×</button>
      </div>

      <div class="modal-body">
        <!-- 核心：直接在此處引用我們的 Panel 元件 -->
        <!-- v-if="patient" 確保只有在 patient prop 存在時才渲染 Panel -->
        <PatientLabSummaryPanel v-if="patient" :patient="patient" @save-record="handleSaveRecord" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { defineAsyncComponent } from 'vue' // 正確：只 import 真正的函式

const PatientLabSummaryPanel = defineAsyncComponent(() => import('./PatientLabSummaryPanel.vue'))

// defineProps 和 defineEmits 不需要 import
const props = defineProps({
  isVisible: Boolean,
  patient: Object,
})

const emit = defineEmits(['close', 'save-record'])

// --- Methods ---
function handleClose() {
  emit('close')
}

// 當 Panel 內部觸發 'save-record' 事件時，這個函式會被呼叫
function handleSaveRecord(payload) {
  // 將從 Panel 收到的資料原封不動地再次 emit 出去
  emit('save-record', payload)
  // 通常儲存後會關閉視窗
  handleClose()
}
</script>

<style scoped>
/* 這裡只需要 Modal 外框的樣式即可，Panel 的樣式由它自己管理 */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal-container {
  background-color: #f8f9fa;
  border-radius: 12px;
  box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
  width: 90%;
  max-width: 1000px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
}
.modal-header {
  padding: 1rem 1.5rem;
  border-bottom: 1px solid #dee2e6;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.modal-header h2 {
  margin: 0;
  font-size: 1.5rem;
  color: #343a40;
}
.close-btn {
  background: none;
  border: none;
  font-size: 2rem;
  font-weight: bold;
  cursor: pointer;
  color: #6c757d;
}

/* --- ✨ 關鍵修改 ✨ --- */
.modal-body {
  padding: 1.5rem;
  overflow: hidden; /* ✨ 1. 隱藏 body 自身的滾動條 */
  flex-grow: 1; /* ✨ 2. 讓 body 填滿 modal 剩餘空間 */
  display: flex; /* ✨ 3. 將 body 設為 flex 容器 */
  flex-direction: column; /* ✨ 4. 讓子元素（Panel）垂直排列 */
  min-height: 0; /* ✨ 5. 允許 body 在 flex 佈局中被壓縮 */
}

/* ✨ 新增：行動版樣式，讓 modal-body 恢復滾動 ✨ */
@media (max-width: 992px) {
  .modal-body {
    overflow-y: auto;
  }
}
</style>
