<template>
  <div v-if="isVisible" class="modal-overlay" v-overlay-close="close">
    <div class="modal-content">
      <div class="modal-header">
        <h3>「{{ patientName }}」的動向歷史</h3>
        <button @click="close" class="close-button">×</button>
      </div>
      <div class="modal-body">
        <div v-if="isLoading" class="loading-spinner">讀取中...</div>
        <div v-else-if="groupedHistory.length === 0" class="no-history">沒有歷史紀錄</div>
        <div v-else class="episodes-container">
          <!-- 外層迴圈：遍歷每個就診週期 -->
          <div v-for="(episode, index) in groupedHistory" :key="index" class="episode-card">
            <!-- 【修改 1/3】: 將標題與時間軸結合 -->
            <div class="timeline-wrapper">
              <div class="episode-title">歷程 #{{ groupedHistory.length - index }}</div>
              <ul class="timeline">
                <!-- 內層迴圈：遍歷週期內的每個事件 -->
                <li v-for="(entry, entryIndex) in episode" :key="entry.id" class="timeline-item">
                  <div class="timeline-content" :class="`marker-${entry.eventType.toLowerCase()}`">
                    <span class="timestamp">{{ formatTimestamp(entry.timestamp) }}</span>
                    <p class="event-description" v-html="formatEvent(entry)"></p>
                  </div>
                  <!-- 【修改 2/3】: 在項目之間加入箭頭 -->
                  <div v-if="entryIndex < episode.length - 1" class="timeline-arrow">→</div>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, computed } from 'vue'
import ApiManager from '@/services/api_manager'
import { escapeHtml } from '@/utils/sanitize.js'

const props = defineProps({
  isVisible: Boolean,
  patientId: String,
  patientName: String,
})

const emit = defineEmits(['close'])

const historyApi = ApiManager('patient_history')
const history = ref([])
const isLoading = ref(false)

const statusMap = {
  ipd: '住院',
  opd: '門診',
  er: '急診',
}

watch(
  () => props.isVisible,
  (newVal) => {
    if (newVal && props.patientId) {
      fetchHistory()
    } else {
      history.value = []
    }
  },
)

const groupedHistory = computed(() => {
  if (!history.value || history.value.length === 0) return []

  const episodes = []
  let currentEpisode = []

  // ✨ 修正: 先對 history 進行一次排序，確保時間順序正確
  const sortedHistory = [...history.value].sort((a, b) => {
    const timeA = a.timestamp?.toDate
      ? a.timestamp.toDate().getTime()
      : new Date(a.timestamp).getTime()
    const timeB = b.timestamp?.toDate
      ? b.timestamp.toDate().getTime()
      : new Date(b.timestamp).getTime()
    return timeA - timeB
  })

  sortedHistory.forEach((entry) => {
    const isStartEvent = entry.eventType === 'CREATE' || entry.eventType === 'RESTORE_AND_TRANSFER' // 簡化判斷邏輯

    if (isStartEvent && currentEpisode.length > 0) {
      episodes.push(currentEpisode)
      currentEpisode = []
    }

    currentEpisode.push(entry)

    if (entry.eventType === 'DELETE') {
      episodes.push(currentEpisode)
      currentEpisode = []
    }
  })

  if (currentEpisode.length > 0) {
    episodes.push(currentEpisode)
  }

  return episodes.reverse()
})

async function fetchHistory() {
  isLoading.value = true
  try {
    // Fetch all history and filter client-side
    const allHistory = await historyApi.fetchAll()
    const filteredHistory = allHistory
      .filter((h) => h.patientId === props.patientId)
      .sort((a, b) => {
        const timeA = a.timestamp?.toDate ? a.timestamp.toDate().getTime() : (a.timestamp ? new Date(a.timestamp).getTime() : 0)
        const timeB = b.timestamp?.toDate ? b.timestamp.toDate().getTime() : (b.timestamp ? new Date(b.timestamp).getTime() : 0)
        return timeA - timeB
      })
    history.value = filteredHistory
  } catch (error) {
    console.error('讀取歷史紀錄失敗:', error)
    history.value = []
  } finally {
    isLoading.value = false
  }
}

// ✨ --- START: 核心修正區域 formatTimestamp --- ✨
function formatTimestamp(timestampInput) {
  if (!timestampInput) return 'Invalid Date'

  let date

  // 情況 1: 處理 Firestore 原生的 Timestamp 物件
  if (timestampInput && typeof timestampInput.toDate === 'function') {
    date = timestampInput.toDate()
  }
  // 情況 2: 處理 ISO 格式的字串 (例如 "2025-08-20T03:48:23.979Z")
  else if (typeof timestampInput === 'string') {
    date = new Date(timestampInput)
  }
  // 情況 3: 其他可能的情況 (例如毫秒數)
  else {
    date = new Date(timestampInput)
  }

  // 最終檢查日期是否有效
  if (isNaN(date.getTime())) {
    return 'Invalid Date'
  }

  return date.toLocaleString('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
// ✨ --- END: 核心修正區域 formatTimestamp --- ✨

function formatEvent(entry) {
  const details = entry.eventDetails
  // ✨ XSS 防護：對狀態值進行轉義
  const getStatus = (s) => `<strong>${escapeHtml(statusMap[s] || s)}</strong>`

  switch (entry.eventType) {
    case 'CREATE':
      return `建立資料 ➝ ${getStatus(details.status)}`
    case 'TRANSFER':
      if (details.note) {
        return `衝突轉入 ➝ ${getStatus(details.to)}`
      }
      return `${getStatus(details.from)} ➝ ${getStatus(details.to)}`
    case 'DELETE':
      // ✨ XSS 防護：對原因進行轉義
      return `<strong>結案 (${escapeHtml(details.reason || '未說明')})</strong>`
    case 'RESTORE_AND_TRANSFER':
      return `資料復原 ➝ ${getStatus(details.restoredTo)}`
    default:
      return `未知操作: ${escapeHtml(entry.eventType)}`
  }
}

function close() {
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
  justify-content: center;
  align-items: center;
  z-index: 1000;
}
.modal-content {
  background-color: #fff;
  border-radius: 8px;
  box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
  width: 90%;
  max-width: 900px; /* 增加寬度以容納水平內容 */
  max-height: 80vh;
  display: flex;
  flex-direction: column;
}
.modal-header {
  padding: 1rem 1.5rem;
  border-bottom: 1px solid #e9ecef;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.modal-header h3 {
  margin: 0;
  font-size: 1.25rem;
  color: #333;
}
.close-button {
  background: none;
  border: none;
  font-size: 2rem;
  font-weight: 300;
  line-height: 1;
  color: #666;
  cursor: pointer;
}
.modal-body {
  padding: 1rem;
  overflow-y: auto;
  background-color: #f8f9fa;
}
.loading-spinner,
.no-history {
  text-align: center;
  padding: 2rem;
  color: #6c757d;
  font-size: 1.1rem;
}

.episodes-container {
  display: flex;
  flex-direction: column;
  gap: 1rem; /* 減少週期之間的間距 */
}
.episode-card {
  background-color: #ffffff;
  border: 1px solid #dee2e6;
  border-radius: 8px;
  padding: 1rem 1.5rem; /* 【修改】減少上下的 padding */
}

.timeline-wrapper {
  overflow-x: auto; /* 允許水平滾動 */
  padding-bottom: 0.5rem; /* 給滾動條留出空間 */
  display: flex; /* 改為 flex 佈局 */
  align-items: center; /* 讓標題和時間軸垂直居中 */
  gap: 1.5rem; /* 標題和時間軸的間距 */
}
.episode-title {
  font-size: 1.1rem;
  font-weight: bold;
  color: #495057;
  white-space: nowrap;
  flex-shrink: 0; /* 防止標題被壓縮 */
}

.timeline {
  display: flex; /* 改為 flex 佈局 */
  align-items: center; /* 讓卡片和箭頭垂直居中 */
  list-style: none;
  padding: 0;
  margin: 0;
}

.timeline-item {
  display: flex; /* 讓卡片和箭頭可以並排 */
  align-items: center; /* 垂直居中 */
}

.timeline-arrow {
  font-size: 2rem;
  color: #adb5bd;
  margin: 0 1rem; /* 箭頭左右的間距 */
}

.timeline-content {
  border: 1px solid #e9ecef;
  background-color: #ffffff;
  padding: 10px 15px;
  border-radius: 8px;
  text-align: center;
  min-width: 180px; /* 設定每個事件的最小寬度 */
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

/* 根據事件類型給卡片加上左邊框顏色 */
.timeline-content {
  border-left-width: 4px;
}
.marker-create {
  border-left-color: #28a745;
}
.marker-transfer {
  border-left-color: #17a2b8;
}
.marker-delete {
  border-left-color: #dc3545;
}
.marker-restore {
  border-left-color: #ffc107;
}

.timestamp {
  font-size: 0.8rem;
  color: #6c757d;
  margin-bottom: 5px;
  display: block;
}
.event-description {
  margin: 0;
  font-size: 1rem;
  color: #495057;
  line-height: 1.5;
  font-weight: 500;
}
:deep(strong) {
  color: #005a9c;
  font-weight: 600;
}
</style>
