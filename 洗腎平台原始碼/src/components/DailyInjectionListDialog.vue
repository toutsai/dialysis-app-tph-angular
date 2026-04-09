<!-- 檔案路徑: src/components/DailyInjectionListDialog.vue (最終版) -->
<template>
  <div v-if="isVisible" class="dialog-overlay" v-overlay-close="closeDialog">
    <div class="dialog-content">
      <div class="dialog-header">
        <h3>
          本日應打針劑清單
          <span v-if="titleDate">- {{ titleDate }} ({{ injections.length }} 筆)</span>
        </h3>
        <div class="header-actions">
          <button @click="handlePrint" class="btn-primary-dialog">
            <i class="fas fa-print"></i> 匯出/列印
          </button>
          <button @click="closeDialog" class="close-btn" title="關閉">×</button>
        </div>
      </div>
      <div class="dialog-body" id="injection-list-content">
        <div class="print-header">
          <h4>本日應打針劑清單 - {{ titleDate }}</h4>
        </div>

        <div v-if="isLoading" class="panel-loading">
          <div class="loading-spinner"></div>
          <span>正在計算針劑資料...</span>
        </div>

        <div v-else-if="injections.length > 0" class="shift-section">
          <table class="injection-table">
            <thead>
              <tr>
                <th>班別</th>
                <th>床號</th>
                <th>姓名</th>
                <th>藥品名稱</th>
                <th>劑量</th>
                <th>備註 (規則)</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(injection, index) in injections"
                :key="`${injection.patientId}-${injection.orderCode}-${index}`"
              >
                <td>{{ formatShift(injection.shift) }}</td>
                <td>{{ injection.bedNum }}</td>
                <td>{{ injection.patientName }}</td>
                <td>{{ injection.orderName }}</td>
                <td>{{ injection.dose }} {{ getMedicationUnit(injection) }}</td>
                <td>{{ injection.note }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-else class="panel-empty">
          <p><i class="fas fa-check-circle"></i> 今日無應打針劑項目</p>
        </div>
      </div>

      <!-- ✨ [核心修改 1] 使用 v-if="showFilter" 來控制頁尾的顯示 -->
      <footer v-if="showFilter" class="dialog-footer">
        <label class="filter-checkbox">
          <input
            type="checkbox"
            :checked="filterActive"
            @change="emit('update:filterActive', $event.target.checked)"
          />
          僅顯示特定針劑 (Cacare, Fe-back, Parsabiv)
        </label>
      </footer>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { getMedicationUnit } from '@/utils/medicationUtils.js'

// ✨ [核心修改 2] 在 props 中新增 showFilter
const props = defineProps({
  isVisible: Boolean,
  injections: {
    type: Array,
    default: () => [],
  },
  isLoading: {
    type: Boolean,
    default: false,
  },
  targetDate: {
    type: String, // 格式 YYYY-MM-DD
    required: true,
  },
  filterActive: {
    type: Boolean,
    default: false,
  },
  showFilter: {
    // 新增這個 prop
    type: Boolean,
    default: false, // 預設為 false (不顯示)
  },
})

const emit = defineEmits(['close', 'update:filterActive'])

const closeDialog = () => {
  emit('close')
}

const titleDate = computed(() => {
  if (!props.targetDate) return ''
  try {
    const date = new Date(props.targetDate + 'T00:00:00')
    return date.toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' })
  } catch {
    return props.targetDate
  }
})

const shiftMap = {
  early: '早',
  noon: '午',
  late: '晚',
}

function formatShift(shiftCode) {
  return shiftMap[shiftCode] || '未知'
}

const handlePrint = () => {
  const contentToPrint = document.getElementById('injection-list-content')
  if (!contentToPrint) {
    console.error('找不到列印內容區塊！')
    return
  }

  const iframe = document.createElement('iframe')
  iframe.style.position = 'absolute'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  iframe.setAttribute('title', 'Print Frame')

  document.body.appendChild(iframe)
  const iframeDoc = iframe.contentWindow.document

  const htmlContent = `
    <html>
      <head>
        <title>本日應打針劑清單</title>
        <style>
          body { font-family: 'Microsoft JhengHei', 'Segoe UI', sans-serif; margin: 20px; font-size: 12pt; }
          .print-header { text-align: center; margin-bottom: 1.5rem; }
          .print-header h4 { font-size: 1.5rem; margin: 0; }
          .injection-table { width: 100%; border-collapse: collapse; font-size: 1em; }
          .injection-table th, .injection-table td { border: 1px solid #aaa; padding: 8px; text-align: center; vertical-align: middle; }
          .injection-table th { background-color: #f2f2f2; font-weight: bold; }
          tr { page-break-inside: avoid; }
        </style>
      </head>
      <body>
        ${contentToPrint.innerHTML}
      </body>
    </html>
  `

  iframeDoc.open()
  iframeDoc.write(htmlContent)
  iframeDoc.close()

  iframe.onload = function () {
    try {
      iframe.contentWindow.focus()
      iframe.contentWindow.print()
    } catch (e) {
      console.error('列印失敗:', e)
    } finally {
      setTimeout(() => {
        document.body.removeChild(iframe)
      }, 500)
    }
  }
}
</script>

<style scoped>
/* Dialog 基本樣式 */
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.6);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1050;
}
.dialog-content {
  background: white;
  border-radius: 12px;
  box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
  width: 90%;
  max-width: 800px;
  display: flex;
  flex-direction: column;
  max-height: 90vh;
}
.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid #e5e5e5;
}
.dialog-header h3 {
  margin: 0;
  font-size: 1.5rem;
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 1rem;
}
.close-btn {
  background: none;
  border: none;
  font-size: 2rem;
  cursor: pointer;
  color: #aaa;
  padding: 0;
  line-height: 1;
}
.dialog-body {
  padding: 1.5rem;
  overflow-y: auto;
}
.btn-primary-dialog {
  padding: 0.5rem 1rem;
  background-color: #007bff;
  color: white;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 500;
}
.btn-primary-dialog:hover {
  background-color: #0056b3;
}

/* 元件特定樣式 */
.injection-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 1rem;
}
.injection-table th,
.injection-table td {
  border: 1px solid #ddd;
  padding: 10px 12px;
  text-align: center;
  vertical-align: middle;
}
.injection-table th {
  background-color: #f8f9fa;
  font-weight: 600;
  position: sticky;
  top: 0;
}
.panel-loading,
.panel-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 2rem;
  color: #6c757d;
  min-height: 200px;
}
.panel-empty i {
  font-size: 1.5rem;
  margin-bottom: 0.5rem;
  opacity: 0.7;
}
.loading-spinner {
  width: 30px;
  height: 30px;
  border: 3px solid #f3f3f3;
  border-top: 3px solid #007bff;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 1rem;
}
@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

/* 列印專用樣式 */
.print-header {
  display: none;
}

.dialog-footer {
  padding: 1rem 1.5rem;
  border-top: 1px solid #e9ecef;
  background-color: #f8f9fa;
  display: flex;
  justify-content: flex-start;
  align-items: center;
  border-bottom-left-radius: 12px;
  border-bottom-right-radius: 12px;
}

.filter-checkbox {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 1rem;
  cursor: pointer;
  user-select: none; /* 讓文字不可選取 */
}

.filter-checkbox input {
  width: 1.2em;
  height: 1.2em;
  cursor: pointer;
}
</style>
