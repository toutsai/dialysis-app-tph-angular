<!-- 檔案路徑: src/components/StatsToolbar.vue (條件式修改版) -->
<script setup>
import { computed } from 'vue'
import { ORDERED_SHIFT_CODES, SHIFT_DISPLAY_NAMES } from '@/constants/scheduleConstants'

const props = defineProps({
  statsData: {
    type: Array,
    required: true,
  },
  weekdays: {
    type: Array,
    required: true,
  },
  columnWidths: {
    type: Array,
    default: () => [],
  },
  size: {
    type: String,
    default: 'normal', // 'normal' 或 'compact'
  },
  // 🔥 新增：控制顯示模式的 prop
  showPatientNumbers: {
    type: Boolean,
    default: false, // 預設為 false，保持原有樣式
  },
})

const shiftOrder = computed(() => {
  return ORDERED_SHIFT_CODES.map((code) => ({
    code: code,
    display: SHIFT_DISPLAY_NAMES[code].replace('班', ''),
  }))
})

const getBarStyles = (shiftCount) => {
  const defaultStyles = {
    opdStyle: { width: '0%' },
    ipdStyle: { width: '0%' },
    erStyle: { width: '0%' },
  }

  if (!shiftCount || shiftCount.total === 0) {
    return defaultStyles
  }

  const opdPercent = ((shiftCount.opd || 0) / shiftCount.total) * 100
  const ipdPercent = ((shiftCount.ipd || 0) / shiftCount.total) * 100
  const erPercent = ((shiftCount.er || 0) / shiftCount.total) * 100

  return {
    opdStyle: { width: `${opdPercent}%` },
    ipdStyle: { width: `${ipdPercent}%` },
    erStyle: { width: `${erPercent}%` },
  }
}

// 🔥 新增：格式化急住門數字顯示（返回分段數據）
const formatPatientCounts = (shiftCount) => {
  if (!shiftCount || shiftCount.total === 0) {
    return []
  }

  const parts = []
  if (shiftCount.er > 0) parts.push({ text: `急${shiftCount.er}`, type: 'er' })
  if (shiftCount.ipd > 0) parts.push({ text: `住${shiftCount.ipd}`, type: 'ipd' })
  if (shiftCount.opd > 0) parts.push({ text: `門${shiftCount.opd}`, type: 'opd' })

  return parts
}
</script>

<template>
  <div class="stats-toolbar" :class="`size-${size}`">
    <div
      v-for="(dayData, index) in statsData"
      :key="index"
      class="stat-item"
      :style="{ width: columnWidths[index] ? `${columnWidths[index]}px` : 'auto' }"
    >
      <div class="day-summary">
        <strong>{{ weekdays[index] }}</strong>
        <!-- 🔥 條件顯示：只有不是數字模式才顯示總人數 -->
        <span v-if="!showPatientNumbers" class="day-total-count">{{ dayData.total }}</span>
      </div>

      <div class="stat-shift-group">
        <div v-for="shift in shiftOrder" :key="shift.code" class="shift-tag">
          <div class="shift-info">
            {{ shift.display }} {{ dayData.counts[shift.code]?.total || 0 }}
          </div>

          <!-- 🔥 條件顯示：數字模式 vs 色條模式 -->
          <div
            v-if="showPatientNumbers"
            class="patient-counts"
            v-show="dayData.counts[shift.code]?.total > 0"
          >
            <span
              v-for="(item, idx) in formatPatientCounts(dayData.counts[shift.code])"
              :key="idx"
              :class="{ 'opd-number': item.type === 'opd' }"
            >
              {{ item.text
              }}{{ idx < formatPatientCounts(dayData.counts[shift.code]).length - 1 ? ' ' : '' }}
            </span>
          </div>

          <div v-else class="ratio-bar">
            <div
              class="bar-segment er-bar"
              :style="getBarStyles(dayData.counts[shift.code]).erStyle"
              :title="`急診: ${dayData.counts[shift.code]?.er || 0}`"
            ></div>
            <div
              class="bar-segment ipd-bar"
              :style="getBarStyles(dayData.counts[shift.code]).ipdStyle"
              :title="`住院: ${dayData.counts[shift.code]?.ipd || 0}`"
            ></div>
            <div
              class="bar-segment opd-bar"
              :style="getBarStyles(dayData.counts[shift.code]).opdStyle"
              :title="`門診: ${dayData.counts[shift.code]?.opd || 0}`"
            ></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stats-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  background-color: #f8f9fa;
  transition: width 0.2s ease-in-out;
  box-sizing: border-box;
}

.day-summary {
  display: flex;
  align-items: baseline;
  gap: 4px;
  padding-right: 8px;
  border-right: 1px solid #dee2e6;
}

.day-summary strong {
  font-size: 1em;
  color: #343a40;
}

.day-total-count {
  font-size: 1em;
  font-weight: bold;
  color: var(--primary-color, #007bff);
}

.stat-shift-group {
  display: flex;
  gap: 6px;
  flex-grow: 1;
  justify-content: space-between;
}

.shift-tag {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 45px;
}

.shift-info {
  padding: 3px 8px;
  border-radius: 12px;
  font-weight: bold;
  color: #fff;
  font-size: 0.85em;
  background-color: #6c757d;
  width: 100%;
  text-align: center;
  box-sizing: border-box;
  white-space: nowrap;
}

.shift-tag:nth-child(1) .shift-info {
  background-color: var(--success-color, #28a745);
}
.shift-tag:nth-child(2) .shift-info {
  background-color: var(--warning-color, #ffc107);
  color: #212529;
}
.shift-tag:nth-child(3) .shift-info {
  background-color: var(--info-color, #17a2b8);
}

/* 原有的色條樣式 */
.ratio-bar {
  display: flex;
  width: 100%;
  height: 4px;
  border-radius: 2px;
  overflow: hidden;
  margin-top: 3px;
  background-color: #e9ecef;
}

.bar-segment {
  height: 100%;
  transition: width 0.3s ease;
}

.opd-bar {
  background-color: var(--success-color, #28a745);
}

.ipd-bar {
  background-color: var(--danger-color, #dc3545);
}

.er-bar {
  background-color: var(--purple-main, #9a34ff);
}

/* 🔥 新增：急住門數字顯示樣式 */
.patient-counts {
  font-size: 0.7em;
  color: #495057;
  margin-top: 2px;
  text-align: center;
  font-weight: 600;
  white-space: nowrap;
  min-height: 12px;
}

/* 🔥 新增：門診數字特殊樣式（粗體紅字） */
.patient-counts .opd-number {
  color: #dc3545;
  font-weight: 900;
}

/* size 相關樣式 */
.stats-toolbar.size-normal .day-summary strong,
.stats-toolbar.size-normal .day-total-count {
  font-size: 1.1em;
}
.stats-toolbar.size-normal .shift-info {
  font-size: 0.9em;
  padding: 4px 10px;
}
.stats-toolbar.size-normal .patient-counts {
  font-size: 0.75em;
}
.stats-toolbar.size-normal .patient-counts .opd-number {
  font-weight: 900;
}

.stats-toolbar.size-compact .stat-item {
  padding: 4px 6px;
  gap: 6px;
}
.stats-toolbar.size-compact .day-summary {
  padding-right: 6px;
}
.stats-toolbar.size-compact .day-summary strong,
.stats-toolbar.size-compact .day-total-count {
  font-size: 0.9em;
}
.stats-toolbar.size-compact .shift-info {
  font-size: 0.75em;
  padding: 2px 6px;
}
.stats-toolbar.size-compact .shift-tag {
  min-width: 40px;
}
.stats-toolbar.size-compact .ratio-bar {
  height: 3px;
}
.stats-toolbar.size-compact .patient-counts {
  font-size: 0.65em;
  margin-top: 1px;
}
.stats-toolbar.size-compact .patient-counts .opd-number {
  font-weight: 900;
}
</style>
