<!-- 檔案路徑: src/components/InpatientRoundsDialog.vue -->
<template>
  <div v-if="isVisible" class="dialog-overlay" v-overlay-close="closeDialog">
    <div class="dialog-content">
      <div class="dialog-header">
        <h3>住院病人趴趴走總覽</h3>
        <div class="header-actions">
          <!-- 按鈕文字和事件處理函式已更新 -->
          <button @click="handleSaveAndPrint" class="btn-primary-dialog" :disabled="isSaving">
            <i class="fas fa-save"></i> 儲存並列印
          </button>
          <button @click="closeDialog" class="close-btn" title="關閉">×</button>
        </div>
      </div>
      <div class="dialog-body" id="inpatient-rounds-content">
        <div class="print-header">
          <h4>住院病人趴趴走總覽 - {{ todayDate }}</h4>
        </div>

        <!-- 早班表格 -->
        <div v-if="earlyShiftPatients.length > 0" class="shift-section">
          <h4 class="shift-title">早班 ({{ earlyShiftPatients.length }} 人)</h4>
          <table class="rounds-table">
            <thead>
              <tr>
                <th>洗腎床位</th>
                <th>病歷號</th>
                <th>姓名</th>
                <th>病房號</th>
                <th>來洗腎室方式</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="patient in earlyShiftPatients" :key="patient.id">
                <td>{{ patient.dialysisBed }}</td>
                <td>{{ patient.medicalRecordNumber }}</td>
                <td>{{ patient.name }}</td>
                <td>{{ patient.wardNumber }}</td>
                <td>
                  <div
                    @click="toggleTransportMethod(patient)"
                    class="transport-display"
                    :class="{ unconfirmed: patient.transportMethod === 'unconfirmed' }"
                  >
                    {{
                      patient.transportMethod === 'unconfirmed'
                        ? '推床 / 輪椅'
                        : patient.transportMethod
                    }}
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 午班表格 -->
        <div v-if="noonShiftPatients.length > 0" class="shift-section">
          <h4 class="shift-title">午班 ({{ noonShiftPatients.length }} 人)</h4>
          <table class="rounds-table">
            <thead>
              <tr>
                <th>洗腎床位</th>
                <th>病歷號</th>
                <th>姓名</th>
                <th>病房號</th>
                <th>來洗腎室方式</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="patient in noonShiftPatients" :key="patient.id">
                <td>{{ patient.dialysisBed }}</td>
                <td>{{ patient.medicalRecordNumber }}</td>
                <td>{{ patient.name }}</td>
                <td>{{ patient.wardNumber }}</td>
                <td>
                  <div
                    @click="toggleTransportMethod(patient)"
                    class="transport-display"
                    :class="{ unconfirmed: patient.transportMethod === 'unconfirmed' }"
                  >
                    {{
                      patient.transportMethod === 'unconfirmed'
                        ? '推床 / 輪椅'
                        : patient.transportMethod
                    }}
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 晚班表格 -->
        <div v-if="lateShiftPatients.length > 0" class="shift-section">
          <h4 class="shift-title">晚班 ({{ lateShiftPatients.length }} 人)</h4>
          <table class="rounds-table">
            <thead>
              <tr>
                <th>洗腎床位</th>
                <th>病歷號</th>
                <th>姓名</th>
                <th>病房號</th>
                <th>來洗腎室方式</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="patient in lateShiftPatients" :key="patient.id">
                <td>{{ patient.dialysisBed }}</td>
                <td>{{ patient.medicalRecordNumber }}</td>
                <td>{{ patient.name }}</td>
                <td>{{ patient.wardNumber }}</td>
                <td>
                  <div
                    @click="toggleTransportMethod(patient)"
                    class="transport-display"
                    :class="{ unconfirmed: patient.transportMethod === 'unconfirmed' }"
                  >
                    {{
                      patient.transportMethod === 'unconfirmed'
                        ? '推床 / 輪椅'
                        : patient.transportMethod
                    }}
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p v-if="patientsOnSchedule.length === 0" class="no-data">今日排程無住院/急診病人。</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch, nextTick } from 'vue'

const props = defineProps({
  isVisible: Boolean,
  patientsOnSchedule: {
    type: Array,
    default: () => [],
  },
  targetDate: {
    type: String, // 格式 YYYY-MM-DD
    required: true,
  },
})

const emit = defineEmits(['close', 'save'])

const isSaving = ref(false) // 新增一個狀態來防止重複點擊
const localPatients = ref([])

// 只在 dialog 打開時初始化 localPatients，避免在儲存後被錯誤覆蓋
watch(
  () => props.isVisible,
  (newVisible, oldVisible) => {
    // 只在 dialog 從關閉變為打開時初始化數據
    if (newVisible && !oldVisible) {
      localPatients.value = JSON.parse(JSON.stringify(props.patientsOnSchedule)).map((p) => ({
        ...p,
        transportMethod: ['推床', '輪椅'].includes(p.transportMethod)
          ? p.transportMethod
          : 'unconfirmed',
      }))
    }
  },
  { immediate: true },
)

const closeDialog = () => {
  emit('close')
}

const earlyShiftPatients = computed(() => localPatients.value.filter((p) => p.shift === 'early'))
const noonShiftPatients = computed(() => localPatients.value.filter((p) => p.shift === 'noon'))
const lateShiftPatients = computed(() => localPatients.value.filter((p) => p.shift === 'late'))

// ✨ 2. 修改 todayDate 的計算邏輯
const todayDate = computed(() => {
  if (!props.targetDate) return ''
  try {
    // 直接使用傳入的 YYYY-MM-DD 字串
    return props.targetDate.replace(/-/g, '/') // 將 2025-08-29 轉為 2025/08/29
  } catch {
    return props.targetDate // 如果出錯，直接顯示原始字串
  }
})

// ✨ [核心修改] 新增點擊切換狀態的函式
function toggleTransportMethod(patient) {
  const currentMethod = patient.transportMethod
  if (currentMethod === 'unconfirmed' || currentMethod === '輪椅') {
    patient.transportMethod = '推床'
  } else if (currentMethod === '推床') {
    patient.transportMethod = '輪椅'
  }
}

// ✨ [核心修改] handleSaveAndPrint 保持不變，但現在更有意義，因為 'unconfirmed' 狀態只在初始時存在
const handleSaveAndPrint = async () => {
  if (isSaving.value) return
  isSaving.value = true
  try {
    const patientsToSave = localPatients.value.map((p) => ({
      ...p,
      transportMethod: p.transportMethod === 'unconfirmed' ? '推床' : p.transportMethod, // ✨ 優化：如果使用者沒點過，直接存為預設的 '推床'
    }))

    await emit('save', patientsToSave)
    await nextTick()
    printContent()
  } catch (error) {
    console.error('Save operation failed, printing is cancelled.', error)
  } finally {
    isSaving.value = false
  }
}

const printContent = () => {
  // 這部分的 iframe 列印邏輯完全不變，是正確的
  const contentToPrint = document.getElementById('inpatient-rounds-content')
  if (!contentToPrint) {
    console.error('找不到列印內容區塊！')
    return
  }

  const printableContent = contentToPrint.cloneNode(true)
  const selectsInClone = printableContent.querySelectorAll('select.transport-select')
  const originalSelects = contentToPrint.querySelectorAll('select.transport-select')

  selectsInClone.forEach((selectNode, index) => {
    if (originalSelects[index]) {
      const currentValue = originalSelects[index].value
      const optionToSelect = selectNode.querySelector(`option[value="${currentValue}"]`)
      if (optionToSelect) {
        selectNode.querySelectorAll('option').forEach((opt) => opt.removeAttribute('selected'))
        optionToSelect.setAttribute('selected', 'selected')
      }
    }
  })

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
            <title>住院病人趴趴走總覽</title>
            <style>
            body { font-family: 'Microsoft JhengHei', 'Segoe UI', sans-serif; margin: 20px; font-size: 14pt; line-height: 1.5; }
            .shift-section { margin-bottom: 2rem; page-break-inside: avoid; }
            .shift-title { font-size: 1.5em; margin-bottom: 0.75rem; color: #0056b3; padding-bottom: 0.5rem; border-bottom: 2px solid #007bff; }
            .rounds-table { width: 100%; border-collapse: collapse; font-size: 1em; }
            .rounds-table th, .rounds-table td { border: 1px solid #ddd; padding: 10px; text-align: center; vertical-align: middle; }
            .rounds-table th { background-color: #f2f2f2; font-weight: bold; font-size: 1.1em; }
            .print-header { text-align: center; margin-bottom: 1.5rem; }
            .print-header h4 { font-size: 1.8em; margin: 0; }
            .transport-select { -webkit-appearance: none; -moz-appearance: none; appearance: none; border: none; background: transparent; font-size: inherit; font-family: inherit; text-align: center; }
            </style>
        </head>
        <body>
            ${printableContent.innerHTML}
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
  z-index: 1050; /* 確保在最上層 */
}
.dialog-content {
  background: white;
  border-radius: 12px;
  box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
  width: 90%;
  max-width: 900px;
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

/* 元件特定樣式 */
.shift-section {
  margin-bottom: 2rem;
}
.shift-title {
  font-size: 1.25rem;
  margin-bottom: 0.75rem;
  color: #0056b3;
  padding-bottom: 0.5rem;
  border-bottom: 2px solid #007bff;
}
.rounds-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 1rem;
}
.rounds-table th,
.rounds-table td {
  border: 1px solid #ddd;
  padding: 10px 12px;
  text-align: center;
  vertical-align: middle;
}
.rounds-table th {
  background-color: #f8f9fa;
  font-weight: 600;
}
.transport-select {
  padding: 6px;
  border-radius: 4px;
  border: 1px solid #ccc;
  min-width: 80px;
  font-size: 0.95rem;
}
.no-data {
  text-align: center;
  color: #888;
  font-size: 1.2rem;
  padding: 2rem;
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

.transport-display {
  cursor: pointer;
  padding: 6px;
  border-radius: 4px;
  border: 1px solid #ced4da; /* 預設顯示邊框，讓它看起來像個按鈕 */
  background-color: #f8f9fa;
  transition: all 0.2s;
  min-width: 80px;
  text-align: center;
  font-weight: 500;
}

.transport-display:hover {
  background-color: #e9ecef;
  border-color: #adb5bd;
}

/* ✨ 新增：為未確認狀態增加特殊樣式 */
.transport-display.unconfirmed {
  color: #6c757d;
  font-style: italic;
}

/* 列印時的樣式可以簡化 */
@media print {
  body.printing-rounds-dialog .transport-display {
    padding: 0;
    font-size: inherit;
    font-family: inherit;
    text-align: center;
    border: none;
    background: none;
    color: black !important;
  }
}

/* 列印專用樣式 */
.print-header {
  display: none; /* 平常時隱藏列印專用的標題 */
}

@media print {
  /*
    核心邏輯：
    只有當 body 標籤上有 'printing-rounds-dialog' 這個 class 時，
    以下所有針對 Dialog 的列印樣式才會生效。
  */

  /* 步驟 1: 讓 Dialog 內容能夠被看見 */
  body.printing-rounds-dialog .dialog-overlay {
    /* 移除遮罩效果，讓內容可見 */
    background-color: white;
    position: static;
    display: block;
    width: 100%;
    height: 100%;
  }

  /* 步驟 2: 重設 Dialog 容器的樣式，使其填滿頁面 */
  body.printing-rounds-dialog .dialog-content {
    box-shadow: none;
    border-radius: 0;
    max-height: none;
    width: 100%;
    max-width: 100%;
    border: none;
  }

  /* 步驟 3: 隱藏不需要列印的 UI 元素 */
  body.printing-rounds-dialog .dialog-header {
    display: none;
  }

  /* 步驟 4: 調整 Dialog 主體的樣式以適應列印 */
  body.printing-rounds-dialog .dialog-body {
    padding: 0;
    overflow-y: visible; /* 確保所有內容都能被列印出來 */
  }

  /* 步驟 5: 顯示並設定列印專用標題的樣式 */
  body.printing-rounds-dialog .print-header {
    display: block;
    text-align: center;
    margin-bottom: 1.5rem;
  }
  body.printing-rounds-dialog .print-header h4 {
    font-size: 1.5rem;
    margin: 0;
  }

  /* 步驟 6: 將互動元件（下拉選單）轉換為靜態文字樣式 */
  body.printing-rounds-dialog .transport-select {
    border: none;
    -webkit-appearance: none;
    -moz-appearance: none;
    appearance: none;
    background: transparent;
    padding: 0;
    font-size: inherit; /* 確保字體大小與表格內其他文字一致 */
    pointer-events: none; /* 禁止互動 */
    color: inherit; /* 確保文字顏色一致 */
  }

  /* 步驟 7: 微調表格的列印樣式 */
  body.printing-rounds-dialog .rounds-table {
    font-size: 12pt; /* 調整列印的字體大小 */
    width: 100%;
    page-break-inside: auto; /* 允許表格跨頁 */
  }

  body.printing-rounds-dialog .rounds-table tr {
    page-break-inside: avoid; /* 盡量避免單行被切到下一頁 */
    page-break-after: auto;
  }

  body.printing-rounds-dialog .rounds-table th,
  body.printing-rounds-dialog .rounds-table td {
    padding: 8px;
  }
}
</style>
