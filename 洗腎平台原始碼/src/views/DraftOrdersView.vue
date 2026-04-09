<!-- 檔案路徑: src/views/DraftOrdersView.vue -->
<template>
  <div class="page-container">
    <header class="page-header">
      <h1>待開立醫囑</h1>
      <p>此處列出所有已建立但尚未在 HIS 系統中開立的藥囑草稿。</p>
    </header>

    <main class="page-main-content">
      <div v-if="isLoading" class="loading-state">
        <div class="loading-spinner"></div>
        正在讀取藥囑草稿...
      </div>
      <div v-else-if="groupedDrafts.length === 0" class="empty-state">
        目前沒有待處理的藥囑草稿。
      </div>
      <div v-else class="drafts-list">
        <div v-for="group in groupedDrafts" :key="group.patientId" class="patient-draft-card">
          <div class="patient-header">
            <h3>{{ group.patientName }} ({{ group.medicalRecordNumber }})</h3>
            <span>基於 {{ group.targetMonth }} 檢驗報告</span>
          </div>
          <table class="drafts-table">
            <thead>
              <tr>
                <th>藥品名稱</th>
                <th>劑量</th>
                <th>頻率/備註</th>
                <th>建立者</th>
                <th>建立時間</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="draft in group.drafts" :key="draft.id">
                <td>{{ draft.orderName }}</td>
                <td>{{ draft.dose }}</td>
                <td>{{ draft.frequency || draft.note }}</td>
                <td>{{ draft.authorName }}</td>
                <td>{{ formatDateTime(draft.createdAt) }}</td>
              </tr>
            </tbody>
          </table>
          <div class="card-actions">
            <button @click="confirmDrafts(group)" :disabled="group.isConfirming">
              <i v-if="group.isConfirming" class="fas fa-spinner fa-spin"></i>
              {{ group.isConfirming ? '處理中...' : '確認已開立 (歸檔)' }}
            </button>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup>
// ✨ Standalone 版本
import { ref, onMounted, computed } from 'vue'
import ApiManager from '@/services/api_manager'
import { formatDateTimeToLocal, parseFirestoreTimestamp } from '@/utils/dateUtils.js'

const draftOrdersApi = ApiManager('medication_drafts')
const isLoading = ref(true)
const drafts = ref([])
const confirmingState = ref({})

onMounted(fetchDrafts)

async function fetchDrafts() {
  isLoading.value = true
  try {
    const pendingDrafts = await draftOrdersApi.fetchAll([
      where('status', '==', 'pending'),
      orderBy('createdAt', 'desc'),
    ])
    drafts.value = pendingDrafts
  } catch (error) {
    console.error('讀取藥囑草稿失敗:', error)
  } finally {
    isLoading.value = false
  }
}

const groupedDrafts = computed(() => {
  const groups = {}
  drafts.value.forEach((draft) => {
    const key = `${draft.patientId}_${draft.targetMonth}`
    if (!groups[key]) {
      groups[key] = {
        patientId: draft.patientId,
        patientName: draft.patientName,
        medicalRecordNumber: draft.medicalRecordNumber,
        targetMonth: draft.targetMonth,
        isConfirming: confirmingState.value[key] || false,
        drafts: [],
      }
    }
    groups[key].drafts.push(draft)
  })
  return Object.values(groups)
})

async function confirmDrafts(group) {
  if (!confirm(`確定要將 ${group.patientName} (${group.targetMonth}) 的所有藥囑草稿歸檔嗎？`)) {
    return
  }
  const key = `${group.patientId}_${group.targetMonth}`
  confirmingState.value[key] = true

  try {
    // 逐一更新草稿狀態
    const updatePromises = group.drafts.map((draft) =>
      draftOrdersApi.update(draft.id, { status: 'completed' })
    )
    await Promise.all(updatePromises)
    await fetchDrafts()
  } catch (error) {
    console.error('歸檔藥囑失敗:', error)
    alert('歸檔失敗，請稍後再試。')
  } finally {
    confirmingState.value[key] = false
  }
}

function formatDateTime(timestamp) {
  if (!timestamp) return ''
  const date = parseFirestoreTimestamp(timestamp)
  return formatDateTimeToLocal(date)
}
</script>

<style scoped>
.page-container {
  padding: 0.5rem;
  background-color: #f8f9fa;
}
.page-header {
  padding-bottom: 1rem;
  margin-bottom: 1rem;
  border-bottom: 1px solid #dee2e6;
}
h1 {
  font-size: 2rem;
  margin: 0;
}
p {
  margin-top: 0.5rem;
  font-size: 1rem;
  color: #6c757d;
}
.page-main-content {
  background-color: #fff;
  border: 1px solid #dee2e6;
  border-radius: 8px;
  padding: 1.5rem;
}
.loading-state,
.empty-state {
  text-align: center;
  color: #6c757d;
  padding: 2rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
}
.loading-spinner {
  width: 40px;
  height: 40px;
  border: 4px solid #f3f3f3;
  border-top: 4px solid #007bff;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}
@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

.drafts-list {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}
.patient-draft-card {
  border: 1px solid #dee2e6;
  border-radius: 8px;
  overflow: hidden;
}
.patient-header {
  background-color: #f8f9fa;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid #dee2e6;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.patient-header h3 {
  margin: 0;
  font-size: 1.2rem;
}
.patient-header span {
  color: #6c757d;
}

.drafts-table {
  width: 100%;
  border-collapse: collapse;
}
.drafts-table th,
.drafts-table td {
  padding: 0.75rem;
  text-align: left;
  border-bottom: 1px solid #e9ecef;
}
.drafts-table th {
  background-color: #f8f9fa;
  font-weight: 600;
}
.drafts-table tr:last-child td {
  border-bottom: none;
}

.card-actions {
  padding: 0.75rem;
  text-align: right;
  background-color: #f8f9fa;
}
.card-actions button {
  padding: 0.5rem 1rem;
  background-color: #007bff;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}
.card-actions button:disabled {
  background-color: #6c757d;
}
</style>
