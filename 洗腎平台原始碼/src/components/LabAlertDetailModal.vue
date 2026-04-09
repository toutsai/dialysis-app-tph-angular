<!-- 檔案路徑: src/components/LabAlertDetailModal.vue (全新元件) -->
<template>
  <div v-if="isVisible" class="modal-overlay" v-overlay-close="handleClose">
    <div class="modal-container large">
      <div class="modal-header">
        <div class="header-title">
          <h2>{{ patient?.name }} - 警示報告分析</h2>
          <span class="abnormality-tag">{{
            labItemDisplayNames[abnormalityKey] || abnormalityKey
          }}</span>
        </div>
        <button @click="handleClose" class="close-btn">×</button>
      </div>
      <div class="tabs-navigation">
        <button :class="{ active: activeTab === 'analysis' }" @click="activeTab = 'analysis'">
          病因分析
        </button>
        <button :class="{ active: activeTab === 'suggestion' }" @click="activeTab = 'suggestion'">
          建議處置
        </button>
        <button :class="{ active: activeTab === 'labs' }" @click="activeTab = 'labs'">檢驗</button>
        <button :class="{ active: activeTab === 'correlation' }" @click="activeTab = 'correlation'">
          開藥
        </button>
      </div>
      <div class="modal-body">
        <!-- 病因分析頁籤 -->
        <div v-show="activeTab === 'analysis'" class="tab-panel selection-panel">
          <h3>請勾選可能的病因：</h3>
          <div v-for="(group, category) in groupedCauses" :key="category" class="selection-group">
            <h4>{{ category }}</h4>
            <div class="options-grid">
              <label v-for="cause in group" :key="cause.text" class="checkbox-label">
                <input type="checkbox" v-model="selectedCauses" :value="cause.text" />
                <span class="checkbox-custom"></span>
                {{ cause.text }}
              </label>
            </div>
          </div>
          <div class="other-input-section">
            <h4>其他原因：</h4>
            <textarea v-model="otherCauseText" rows="3" placeholder="請在此輸入其他病因"></textarea>
          </div>
        </div>

        <!-- 建議處置頁籤 -->
        <div v-show="activeTab === 'suggestion'" class="tab-panel selection-panel">
          <h3>請勾選建議的處置：</h3>
          <div
            v-for="(group, category) in groupedSuggestions"
            :key="category"
            class="selection-group"
          >
            <h4>{{ category }}</h4>
            <div class="options-grid">
              <label v-for="suggestion in group" :key="suggestion.text" class="checkbox-label">
                <input type="checkbox" v-model="selectedSuggestions" :value="suggestion.text" />
                <span class="checkbox-custom"></span>
                {{ suggestion.text }}
              </label>
            </div>
          </div>
          <div class="other-input-section">
            <h4>其他處置：</h4>
            <textarea
              v-model="otherSuggestionText"
              rows="3"
              placeholder="請在此輸入其他建議處置"
            ></textarea>
          </div>
        </div>

        <!-- 檢驗報告頁籤 -->
        <div v-show="activeTab === 'labs'" class="tab-panel">
          <PatientLabSummaryPanel v-if="patient" :patient="patient" />
        </div>

        <!-- 開藥頁籤 -->
        <div v-show="activeTab === 'correlation'" class="tab-panel">
          <LabMedCorrelationView v-if="patient && activeTab === 'correlation'" :patient="patient" />
        </div>
      </div>
      <div class="modal-footer">
        <button @click="handleClose" class="cancel-btn">取消</button>
        <button @click="handleConfirm" class="confirm-btn">確認並回填</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, computed, defineAsyncComponent } from 'vue'
import {
  ALERT_CAUSES,
  ALERT_SUGGESTIONS,
  LAB_ITEM_DISPLAY_NAMES,
} from '@/constants/labAlertConstants.js'

// 非同步載入子元件
const PatientLabSummaryPanel = defineAsyncComponent(() => import('./PatientLabSummaryPanel.vue'))
const LabMedCorrelationView = defineAsyncComponent(() => import('./LabMedCorrelationView.vue'))

const props = defineProps({
  isVisible: Boolean,
  patient: Object,
  abnormalityKey: String,
  initialAnalysis: String,
  initialSuggestion: String,
})
const emit = defineEmits(['close', 'confirm'])

const activeTab = ref('analysis')
const selectedCauses = ref([])
const otherCauseText = ref('')
const selectedSuggestions = ref([])
const otherSuggestionText = ref('')
const labItemDisplayNames = ref(LAB_ITEM_DISPLAY_NAMES)

const parseInitialText = (text) => {
  if (!text) return { selected: [], other: '' }
  const items = text.split('; ').filter(Boolean)
  const predefined =
    ALERT_CAUSES[props.abnormalityKey]
      ?.map((c) => c.text)
      .concat(ALERT_SUGGESTIONS[props.abnormalityKey]?.map((s) => s.text)) || []

  const selected = items.filter((item) => predefined.includes(item))
  const other = items.filter((item) => !predefined.includes(item)).join('; ')
  return { selected, other }
}

const groupedCauses = computed(() => {
  const causes = ALERT_CAUSES[props.abnormalityKey] || []
  return causes.reduce((acc, cause) => {
    ;(acc[cause.category] = acc[cause.category] || []).push(cause)
    return acc
  }, {})
})

const groupedSuggestions = computed(() => {
  const suggestions = ALERT_SUGGESTIONS[props.abnormalityKey] || []
  return suggestions.reduce((acc, suggestion) => {
    ;(acc[suggestion.category] = acc[suggestion.category] || []).push(suggestion)
    return acc
  }, {})
})

watch(
  () => props.isVisible,
  (newVal) => {
    if (newVal) {
      const analysisParsed = parseInitialText(props.initialAnalysis)
      selectedCauses.value = analysisParsed.selected
      otherCauseText.value = analysisParsed.other

      const suggestionParsed = parseInitialText(props.initialSuggestion)
      selectedSuggestions.value = suggestionParsed.selected
      otherSuggestionText.value = suggestionParsed.other

      activeTab.value = 'analysis'
    }
  },
)

function handleConfirm() {
  const finalAnalysisText = [...selectedCauses.value, otherCauseText.value.trim()]
    .filter(Boolean)
    .join('; ')
  const finalSuggestionText = [...selectedSuggestions.value, otherSuggestionText.value.trim()]
    .filter(Boolean)
    .join('; ')

  emit('confirm', {
    analysisText: finalAnalysisText,
    suggestionText: finalSuggestionText,
  })
  handleClose()
}

function handleClose() {
  emit('close')
}
</script>

<style scoped>
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
  z-index: 2000;
  backdrop-filter: blur(2px);
}
.modal-container {
  background-color: #f8f9fa;
  border-radius: 12px;
  box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
  width: 90%;
  max-width: 1200px;
  height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.modal-header {
  padding: 1rem 1.5rem;
  border-bottom: 1px solid #dee2e6;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
}
.header-title {
  display: flex;
  align-items: center;
  gap: 1rem;
}
.header-title h2 {
  margin: 0;
  font-size: 1.5rem;
}
.abnormality-tag {
  font-size: 1rem;
  font-weight: bold;
  background-color: #dc3545;
  color: white;
  padding: 0.3rem 0.8rem;
  border-radius: 1rem;
}
.close-btn {
  background: none;
  border: none;
  font-size: 2rem;
  cursor: pointer;
  color: #6c757d;
}
.tabs-navigation {
  display: flex;
  background-color: #e9ecef;
  padding: 0.5rem 1.5rem 0 1.5rem;
  flex-shrink: 0;
  gap: 0.5rem;
}
.tabs-navigation button {
  padding: 0.75rem 1.5rem;
  font-size: 1.1rem;
  font-weight: 500;
  border: 1px solid transparent;
  border-bottom: none;
  background-color: transparent;
  color: #6c757d;
  cursor: pointer;
  border-radius: 8px 8px 0 0;
}
.tabs-navigation button.active {
  background-color: #fff;
  color: #007bff;
  border-color: #dee2e6;
}
.modal-body {
  flex-grow: 1;
  overflow: hidden;
  background-color: #fff;
  padding: 1.5rem;
  display: flex;
}
.tab-panel {
  width: 100%;
  display: flex;
  flex-direction: column;
}
.selection-panel {
  overflow-y: auto;
  padding-right: 1rem;
}
.selection-group {
  margin-bottom: 1.5rem;
}
.selection-group h4 {
  margin: 0 0 0.75rem 0;
  font-size: 1.1rem;
  color: #0056b3;
  border-bottom: 1px solid #e0e0e0;
  padding-bottom: 0.5rem;
}
.options-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 0.75rem;
}
.checkbox-label {
  display: flex;
  align-items: center;
  cursor: pointer;
  padding: 0.5rem;
  border-radius: 4px;
  transition: background-color 0.2s;
}
.checkbox-label:hover {
  background-color: #e7f1ff;
}
.checkbox-label input {
  display: none;
}
.checkbox-custom {
  width: 20px;
  height: 20px;
  border: 2px solid #007bff;
  border-radius: 4px;
  margin-right: 0.75rem;
  display: inline-block;
  position: relative;
}
.checkbox-label input:checked + .checkbox-custom::after {
  content: '✔';
  font-size: 16px;
  color: #007bff;
  position: absolute;
  top: -2px;
  left: 2px;
}
.other-input-section {
  margin-top: 2rem;
}
.other-input-section h4 {
  margin: 0 0 0.5rem 0;
}
.other-input-section textarea {
  width: 100%;
  padding: 0.75rem;
  font-size: 1rem;
  border: 1px solid #ced4da;
  border-radius: 6px;
}
.modal-footer {
  padding: 1rem 1.5rem;
  border-top: 1px solid #dee2e6;
  display: flex;
  justify-content: flex-end;
  gap: 1rem;
  flex-shrink: 0;
  background-color: #f8f9fa;
}
.modal-footer button {
  padding: 0.6rem 1.5rem;
  font-size: 1rem;
  font-weight: 500;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid;
}
.cancel-btn {
  background-color: #6c757d;
  color: white;
  border-color: #6c757d;
}
.confirm-btn {
  background-color: #007bff;
  color: white;
  border-color: #007bff;
}
</style>
