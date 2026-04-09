<!-- 檔案路徑: src/components/MemoPanel.vue (重構後) -->
<template>
  <div class="memo-panel-content">
    <!-- isLoading 現在也來自 store -->
    <div v-if="taskStore.isLoading" class="loading-state">正在讀取備忘事項...</div>
    <!-- 將 memos.length 改為 pendingMemos.length -->
    <ul v-else-if="pendingMemos.length > 0" class="memo-list-in-panel">
      <li v-for="memo in pendingMemos" :key="memo.id" class="memo-item-in-panel">
        <p class="memo-text">
          <!-- 新增：顯示訊息圖示，更一致 -->
          <span class="message-type-icon" :title="memo.type || '一般交班'">
            {{ getMessageTypeIcon(memo.type) }}
          </span>
          {{ memo.content }}
        </p>
        <div class="memo-meta-in-panel">
          <!-- ✨ 核心修正：memo.createdAt 現在保證是 Date 物件，可以直接使用 -->
          <span>建立於: {{ memo.createdAt.toLocaleDateString() }}</span>
          <span v-if="memo.targetDate"
            >| 目標日期: <strong>{{ memo.targetDate }}</strong></span
          >
        </div>
      </li>
    </ul>
    <div v-else class="empty-state">該病人沒有待處理的備忘事項。</div>
  </div>
</template>

<script setup>
import { computed } from 'vue' // ✨ 只需引入 computed
import { useTaskStore } from '@/stores/taskStore' // ✨ 引入 taskStore

const props = defineProps({
  patientId: String,
})

// 實例化 store
const taskStore = useTaskStore()

// ✨ computed 屬性，從 store 中篩選出特定病人的未讀留言
const pendingMemos = computed(() => {
  if (!props.patientId) return []
  // 從 store 中已經排序好的訊息流裡篩選
  return taskStore.sortedFeedMessages.filter(
    (msg) =>
      msg.patientId === props.patientId &&
      msg.status === 'pending' &&
      // 保持一致性：過濾掉系統自動產生的調班訊息
      msg.content &&
      !msg.content.startsWith('【'),
  )
})

// ✨ 新增：訊息圖示輔助函式 (與 CollaborationView 相同)
function getMessageTypeIcon(type) {
  switch (type) {
    case '抽血':
      return '🩸'
    case '衛教':
      return '📢'
    case '常規':
    default:
      return '📝'
  }
}
</script>

<style scoped>
/* ✨ 新增圖示樣式 */
.message-type-icon {
  display: inline-block;
  margin-right: 0.5rem;
  font-size: 1.2rem;
  vertical-align: middle;
}
/* 其他樣式保持不變... */

.memo-panel-content {
  height: 100%;
}
.memo-list-in-panel {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.memo-item-in-panel {
  background-color: #f8f9fa;
  padding: 1rem;
  border-radius: 8px;
  border-left: 4px solid #007bff;
}
.memo-text {
  white-space: pre-wrap;
  word-wrap: break-word;
  font-size: 1rem;
  margin: 0 0 0.75rem 0;
  color: #212529;
}
.memo-meta-in-panel {
  font-size: 0.85rem;
  color: #6c757d;
  text-align: right;
}
.memo-meta-in-panel strong {
  color: #495057;
}
.empty-state,
.loading-state,
.error-state {
  text-align: center;
  color: #6c757d;
  font-size: 1.1rem;
  padding: 3rem 1.5rem;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.error-state {
  color: #dc3545;
}
</style>
