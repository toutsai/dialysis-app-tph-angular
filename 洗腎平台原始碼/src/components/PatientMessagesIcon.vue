<template>
  <div v-if="messageTypes.length > 0" class="messages-icon-container">
    <span
      v-for="type in messageTypes"
      :key="type"
      class="message-icon-wrapper"
      :title="getTooltipText(type)"
      @click.stop="handleClick(type)"
    >
      {{ getMessageTypeIcon(type) }}
    </span>
  </div>
</template>

<script setup>
import { computed, inject } from 'vue'
import { useTaskStore } from '@/stores/taskStore'

const props = defineProps({
  patientId: {
    type: String,
    required: true,
  },
  context: {
    type: String,
    default: 'detail',
  },
  // ✨ 新增：支援直接傳入 typesMap（用於 WeeklyView 的 ScheduleTable）
  typesMap: {
    type: Map,
    default: null,
  },
})

const taskStore = useTaskStore()

// 注入來自父層 (如 ScheduleView) 的正在檢視的日期
// 如果沒有提供，就預設為 null
const viewingDate = inject('viewingDate', null)

// ✨ [核心修改] messageTypes 支援兩種模式：
// 1. 如果有傳入 typesMap prop，直接使用（WeeklyView 模式）
// 2. 否則從 taskStore 根據 viewingDate 計算（ScheduleView/StatsView 模式）
const messageTypes = computed(() => {
  if (!props.patientId) return []

  // 模式 1：使用傳入的 typesMap（優先）
  if (props.typesMap && props.typesMap instanceof Map) {
    return props.typesMap.get(props.patientId) || []
  }

  // 模式 2：從 taskStore 根據 viewingDate 計算
  const mapForDate = taskStore.getPatientMessageTypesMapForDate(viewingDate?.value)
  return mapForDate.get(props.patientId) || []
})

// handleIconClick 的注入保持不變
const handleIconClick = inject('handleIconClick', (patientId, context) => {
  console.warn(
    `[PatientMessagesIcon] handleIconClick function was not provided. Clicked on patient ${patientId} with context ${context}.`,
  )
})

function getMessageTypeIcon(type) {
  switch (type) {
    case '抽血':
      return '🩸'
    case '衛教':
      return '📢'
    case 'record':
      return '🩺'
    case 'memo':
    case '常規':
    default:
      return '📝'
  }
}

function getTooltipText(type) {
  switch (type) {
    case '抽血':
      return '有抽血提醒'
    case '衛教':
      return '有衛教事項'
    case 'record':
      return '有病情紀錄'
    case 'memo':
    case '常規':
    default:
      return '有交班事項'
  }
}

function handleClick(type) {
  if (props.patientId) {
    handleIconClick(props.patientId, props.context, type)
  }
}
</script>

<style scoped>
.messages-icon-container {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  position: relative;
  z-index: 10;
}
.message-icon-wrapper {
  display: inline-block;
  vertical-align: middle;
  cursor: pointer;
  font-size: 1.2em;
  transition: transform 0.2s;
  line-height: 1;
}
.message-icon-wrapper:hover {
  transform: scale(1.4);
}
</style>
