<template>
  <div>
    <div v-if="isVisible" class="dialog-overlay" v-overlay-close="handleClose">
      <div class="dialog-content">
        <div class="dialog-header">
          <h2>{{ patientData?.name }} - 透析醫囑</h2>
          <button @click="handleClose" class="close-btn">×</button>
        </div>

        <div class="modal-body">
          <div class="form-section">
            <form @submit.prevent="handleSave" class="order-form">
              <div class="form-grid">
                <!-- Group 1: 生效日期與血管通路 -->
                <div class="form-group">
                  <label for="effectiveDate">醫囑生效日期</label>
                  <input id="effectiveDate" v-model="localOrderData.effectiveDate" type="date" />
                </div>
                <div class="form-group">
                  <label for="vascAccess">血管通路</label>
                  <select id="vascAccess" v-model="localOrderData.vascAccess">
                    <option disabled value="">請選擇...</option>
                    <option v-for="option in vascAccessOptions" :key="option" :value="option">
                      {{ option }}
                    </option>
                  </select>
                </div>
                <div v-if="shouldShowNeedleSize" class="form-group needle-group-inline">
                  <div class="sub-group">
                    <label for="arterialNeedle">動/靜脈穿刺針</label>
                    <div class="needle-inputs">
                      <select id="arterialNeedle" v-model="localOrderData.arterialNeedle">
                        <option disabled value="">A...</option>
                        <option v-for="size in needleSizeOptions" :key="`a-${size}`" :value="size">
                          {{ size }}
                        </option>
                      </select>
                      <select id="venousNeedle" v-model="localOrderData.venousNeedle">
                        <option disabled value="">V...</option>
                        <option v-for="size in needleSizeOptions" :key="`v-${size}`" :value="size">
                          {{ size }}
                        </option>
                      </select>
                    </div>
                  </div>
                </div>
                <div v-else class="form-group"></div>

                <!-- Group 2: 病人基本設定 -->
                <div class="form-group">
                  <label for="physician">會診醫師</label>
                  <input id="physician" v-model="localOrderData.physician" type="text" />
                </div>
                <div class="form-group">
                  <label for="mode">透析模式</label>
                  <select id="mode" v-model="localOrderData.mode">
                    <option value="">請選擇...</option>
                    <option value="HD">HD</option>
                    <option value="SLED">SLED</option>
                    <option value="CVVHDF">CVVHDF</option>
                    <option value="PP">PP</option>
                    <option value="DFPP">DFPP</option>
                  </select>
                </div>
                <div class="form-group">
                  <label for="freq">頻次</label>
                  <input id="freq" v-model="localOrderData.freq" type="text" />
                </div>

                <!-- Group 3: 核心醫囑 -->
                <div class="form-group ak-dynamic-group">
                  <label>人工腎臟 (AK)</label>
                  <div
                    v-for="(ak, index) in localOrderData.aks"
                    :key="index"
                    class="ak-select-wrapper"
                  >
                    <select v-model="localOrderData.aks[index]">
                      <option disabled value="">請選擇...</option>
                      <option v-for="option in akOptions" :key="option" :value="option">
                        {{ option }}
                      </option>
                    </select>
                    <button
                      v-if="localOrderData.aks.length > 1"
                      type="button"
                      class="btn-ak-action remove"
                      @click="removeAkSelect(index)"
                    >
                      –
                    </button>
                  </div>
                  <button
                    v-if="localOrderData.aks.length < 3"
                    type="button"
                    class="btn-ak-action add"
                    @click="addAkSelect"
                  >
                    +
                  </button>
                </div>
                <div class="form-group">
                  <label for="dialysateCa">透析液鈣離子 (Ca)</label>
                  <select id="dialysateCa" v-model="localOrderData.dialysateCa">
                    <option disabled value="">請選擇...</option>
                    <option v-for="option in caOptions" :key="option" :value="option">
                      {{ option }}
                    </option>
                  </select>
                </div>
                <div class="form-group">
                  <label for="dialysisHours">透析時間 (hr)</label>
                  <input
                    id="dialysisHours"
                    v-model.number="localOrderData.dialysisHours"
                    type="number"
                    placeholder="小時"
                  />
                </div>

                <!-- Group 4: 體重與脫水 -->
                <div class="form-group">
                  <label for="dryWeight">乾體重 (DW)</label>
                  <input
                    id="dryWeight"
                    v-model="localOrderData.dryWeight"
                    type="text"
                    placeholder="單位: kg"
                  />
                </div>
                <div class="form-group">
                  <label for="dehydration">脫水量</label>
                  <input
                    id="dehydration"
                    v-model="localOrderData.dehydration"
                    type="text"
                    placeholder="e.g., 100ml/hr 或 2.5KG"
                  />
                </div>
                <div class="form-group">
                  <label for="mannitol">Mannitol</label>
                  <select id="mannitol" v-model="localOrderData.mannitol">
                    <option value="不用">不用</option>
                    <option value="用">用</option>
                  </select>
                </div>

                <!-- Group 5: 流速設定 -->
                <div class="form-group">
                  <label for="bloodFlow">血液流速 (BF)</label>
                  <input
                    id="bloodFlow"
                    v-model.number="localOrderData.bloodFlow"
                    type="number"
                    placeholder="ml/min"
                  />
                </div>
                <div class="form-group">
                  <label for="dialysateFlow">透析液流速 (DF)</label>
                  <input
                    id="dialysateFlow"
                    v-model.number="localOrderData.dialysateFlow"
                    type="number"
                    placeholder="ml/hr"
                  />
                </div>
                <div class="form-group">
                  <label>補充液流速 (RF)</label>
                  <input
                    type="number"
                    placeholder="ml/hr"
                    v-model.number="localOrderData.replacementFlow"
                  />
                </div>

                <!-- Group 6: Heparin 設定 -->
                <div class="form-group">
                  <label for="heparinInitial">Heparin 初劑量</label>
                  <input
                    id="heparinInitial"
                    v-model="localOrderData.heparinInitial"
                    type="text"
                    placeholder="單位: u"
                  />
                </div>
                <div class="form-group">
                  <label for="heparinMaintenance">Heparin 維持劑量</label>
                  <input
                    id="heparinMaintenance"
                    v-model="localOrderData.heparinMaintenance"
                    type="text"
                    placeholder="單位: u/hr"
                  />
                </div>
                <div class="form-group heparin-rinse-group">
                  <label>Heparin Rinse</label>
                  <div class="radio-group">
                    <label
                      ><input type="radio" v-model="localOrderData.heparinRinse" value="可" />
                      可</label
                    >
                    <label
                      ><input type="radio" v-model="localOrderData.heparinRinse" value="不可" />
                      不可</label
                    >
                  </div>
                </div>
              </div>
            </form>
          </div>

          <div class="history-section">
            <h3 class="history-title">醫囑歷史</h3>
            <div class="history-table-wrapper">
              <div v-if="isLoadingHistory" class="loading-state">載入中...</div>
              <table v-else-if="orderHistory.length > 0">
                <!-- ✅ 4. [核心修改] 擴充歷史表格，顯示所有關鍵欄位 -->
                <thead>
                  <tr>
                    <th class="col-action">操作</th>
                    <th>狀態</th>
                    <th>修改日期</th>
                    <th>生效日</th>
                    <th>通路/穿刺針</th>
                    <th>DW</th>
                    <th>脫水</th>
                    <th>BF/DF/RF</th>
                    <th>時間</th>
                    <th>AK</th>
                    <th>Ca</th>
                    <th>Heparin</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="activeOrder" class="active-order">
                    <td class="col-action">
                      <button @click="requestDeleteOrder(activeOrder)" class="btn-delete">×</button>
                    </td>
                    <td><span class="status-tag active">最新</span></td>
                    <td>{{ formatDate(activeOrder.updatedAt) }}</td>
                    <td>{{ formatDate(activeOrder.orders.effectiveDate) }}</td>
                    <td>
                      {{ activeOrder.orders.vascAccess || '–' }}
                      <span
                        v-if="activeOrder.orders.arterialNeedle || activeOrder.orders.venousNeedle"
                      >
                        ({{ activeOrder.orders.arterialNeedle || 'N/A' }}/{{
                          activeOrder.orders.venousNeedle || 'N/A'
                        }})
                      </span>
                    </td>
                    <td>{{ activeOrder.orders.dryWeight || '–' }}</td>
                    <td>{{ activeOrder.orders.dehydration || '–' }}</td>
                    <td>
                      {{ activeOrder.orders.bloodFlow || '–' }}/{{
                        activeOrder.orders.dialysateFlow || '–'
                      }}/{{ activeOrder.orders.replacementFlow || '–' }}
                    </td>
                    <td>{{ activeOrder.orders.dialysisHours || '–' }}</td>
                    <td>{{ activeOrder.orders.ak || '–' }}</td>
                    <td>{{ activeOrder.orders.dialysateCa || '–' }}</td>
                    <td>
                      {{
                        activeOrder.orders.heparinInitial ??
                        activeOrder.orders.heparinLM?.split('/')[0] ??
                        '–'
                      }}/{{
                        activeOrder.orders.heparinMaintenance ??
                        activeOrder.orders.heparinLM?.split('/')[1] ??
                        '–'
                      }}
                    </td>
                  </tr>
                  <tr
                    v-for="record in pendingOrders"
                    :key="`pending-${record.id}`"
                    class="pending-order"
                  >
                    <td class="col-action">
                      <button @click="requestDeleteOrder(record)" class="btn-delete">×</button>
                    </td>
                    <td><span class="status-tag pending">未生效</span></td>
                    <td>{{ formatDate(record.updatedAt) }}</td>
                    <td>{{ formatDate(record.orders.effectiveDate) }}</td>
                    <td>
                      {{ record.orders.vascAccess || '–' }}
                      <span v-if="record.orders.arterialNeedle || record.orders.venousNeedle">
                        ({{ record.orders.arterialNeedle || 'N/A' }}/{{
                          record.orders.venousNeedle || 'N/A'
                        }})
                      </span>
                    </td>
                    <td>{{ record.orders.dryWeight || '–' }}</td>
                    <td>{{ record.orders.dehydration || '–' }}</td>
                    <td>
                      {{ record.orders.bloodFlow || '–' }}/{{
                        record.orders.dialysateFlow || '–'
                      }}/{{ record.orders.replacementFlow || '–' }}
                    </td>
                    <td>{{ record.orders.dialysisHours || '–' }}</td>
                    <td>{{ record.orders.ak || '–' }}</td>
                    <td>{{ record.orders.dialysateCa || '–' }}</td>
                    <td>
                      {{ record.orders.heparinInitial || '–' }}/{{
                        record.orders.heparinMaintenance || '–'
                      }}
                    </td>
                  </tr>
                  <tr v-for="record in archivedOrders" :key="`archived-${record.id}`">
                    <td class="col-action">
                      <button @click="requestDeleteOrder(record)" class="btn-delete">×</button>
                    </td>
                    <td><span class="status-tag history">歷史</span></td>
                    <td>{{ formatDate(record.updatedAt) }}</td>
                    <td>{{ formatDate(record.orders.effectiveDate) }}</td>
                    <td>
                      {{ record.orders.vascAccess || '–' }}
                      <span v-if="record.orders.arterialNeedle || record.orders.venousNeedle">
                        ({{ record.orders.arterialNeedle || 'N/A' }}/{{
                          record.orders.venousNeedle || 'N/A'
                        }})
                      </span>
                    </td>
                    <td>{{ record.orders.dryWeight || '–' }}</td>
                    <td>{{ record.orders.dehydration || '–' }}</td>
                    <td>
                      {{ record.orders.bloodFlow || '–' }}/{{
                        record.orders.dialysateFlow || '–'
                      }}/{{ record.orders.replacementFlow || '–' }}
                    </td>
                    <td>{{ record.orders.dialysisHours || '–' }}</td>
                    <td>{{ record.orders.ak || '–' }}</td>
                    <td>{{ record.orders.dialysateCa || '–' }}</td>
                    <td>
                      {{ record.orders.heparinInitial || '–' }}/{{
                        record.orders.heparinMaintenance || '–'
                      }}
                    </td>
                  </tr>
                </tbody>
              </table>
              <div v-else class="empty-state">無歷史紀錄</div>
            </div>
          </div>
        </div>

        <div class="dialog-footer">
          <button @click="handleSave" class="btn-save">儲存醫囑</button>
          <button @click="handleClose" class="btn-cancel">取消</button>
        </div>
      </div>
    </div>

    <ConfirmDialog
      :is-visible="isConfirmDeleteVisible"
      title="確認刪除"
      message="您確定要永久刪除這筆醫囑歷史紀錄嗎？此操作無法復原。"
      @confirm="confirmDelete"
      @cancel="isConfirmDeleteVisible = false"
    />
  </div>
</template>

<script setup>
import { ref, reactive, watch, computed } from 'vue'
import { ordersApi } from '@/services/localApiClient'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { formatDateToYYYYMMDD, parseFirestoreTimestamp, getToday } from '@/utils/dateUtils'

const props = defineProps({
  isVisible: Boolean,
  patientData: {
    type: Object,
    default: () => null,
  },
})

const emit = defineEmits(['close', 'save'])

const orderHistory = ref([])
const isLoadingHistory = ref(false)
const isConfirmDeleteVisible = ref(false)
const orderToDelete = ref(null)

// --- 選項列表 ---
const akOptions = [
  '13M',
  '15S',
  '17UX',
  '17HX',
  'FX80',
  'BG-1.8U',
  'Pro-19H',
  '21S',
  'Hi23',
  '25H',
  '25S',
  'CTA2000',
]
const caOptions = ['2.5', '3.0', '3.5']
const vascAccessOptions = ['D/L', 'Perm', 'AVF', 'AVG']
const needleSizeOptions = ['15G', '16G', '17G']

// --- 狀態管理 ---

// ✅ 1. [核心] 建立一個包含所有新舊欄位的初始狀態產生器
const createFormState = () => ({
  // 基礎醫囑
  effectiveDate: getToday(),
  aks: [''], // 改為陣列以支援多個 AK
  dialysateCa: '',
  dryWeight: '',
  bloodFlow: '',

  // 血管通路
  vascAccess: '',
  arterialNeedle: '',
  venousNeedle: '',

  // Heparin 相關
  heparinInitial: '',
  heparinMaintenance: '',
  heparinRinse: '不可',

  // ICU 相關醫囑 (包含透析時間和流速)
  physician: '',
  mode: '',
  freq: '',
  dialysisHours: null,
  dialysateFlow: null,
  replacementFlow: null,
  dehydration: '',
  mannitol: '不用',
})

// 使用產生器來初始化響應式狀態
const localOrderData = reactive(createFormState())

// --- 動態 AK 選擇器函式 ---
function addAkSelect() {
  if (localOrderData.aks.length < 3) {
    localOrderData.aks.push('')
  }
}
function removeAkSelect(index) {
  if (localOrderData.aks.length > 1) {
    localOrderData.aks.splice(index, 1)
  }
}

// --- Computed 屬性 ---
const shouldShowNeedleSize = computed(() => {
  return localOrderData.vascAccess === 'AVF' || localOrderData.vascAccess === 'AVG'
})

const getDate = (dateValue) => {
  if (!dateValue) return null
  return parseFirestoreTimestamp(dateValue)
}

const todayStr = computed(() => getToday())

const activeOrder = computed(() => {
  const effectiveOrders = orderHistory.value
    .filter((o) => o.orders.effectiveDate <= todayStr.value)
    .sort((a, b) => getDate(b.updatedAt) - getDate(a.updatedAt))
  return effectiveOrders.length > 0 ? effectiveOrders[0] : null
})

const pendingOrders = computed(() => {
  return orderHistory.value
    .filter((o) => o.orders.effectiveDate > todayStr.value)
    .sort((a, b) => getDate(a.orders.effectiveDate) - getDate(b.orders.effectiveDate))
})

const archivedOrders = computed(() => {
  const activeId = activeOrder.value ? activeOrder.value.id : null
  const pendingIds = new Set(pendingOrders.value.map((p) => p.id))
  return orderHistory.value
    .filter((o) => o.id !== activeId && !pendingIds.has(o.id))
    .sort((a, b) => getDate(b.updatedAt) - getDate(a.updatedAt))
})

// --- API 函式 ---
async function fetchOrderHistory(patientId) {
  if (!patientId) return
  isLoadingHistory.value = true
  orderHistory.value = []
  try {
    const historyData = await ordersApi.getDialysisOrderHistory(patientId)

    // 加入這行來檢查資料
    console.log('讀取到的歷史資料:', historyData)
    historyData.forEach((record) => {
      console.log('Heparin 資料:', {
        initial: record.orders.heparinInitial,
        maintenance: record.orders.heparinMaintenance,
        lm: record.orders.heparinLM,
      })
    })

    orderHistory.value = historyData
  } catch (error) {
    console.error('❌ [DialysisOrderModal] 讀取醫囑歷史失敗:', error)
    alert(`載入醫囑歷史失敗：${error.message}`)
  } finally {
    isLoadingHistory.value = false
  }
}

// --- Watchers ---

// ✅ 2. [核心] 更新 watch 邏輯，填充所有欄位並兼容舊資料
watch(
  () => props.isVisible,
  (newValue) => {
    if (newValue && props.patientData) {
      const orders = props.patientData.dialysisOrders || {}
      const patient = props.patientData

      const akValue = orders.ak || ''
      localOrderData.aks = akValue && typeof akValue === 'string' ? akValue.split('/') : ['']

      const heparinLM = orders.heparinLM
        ? String(orders.heparinLM).split('/')
        : [orders.heparinInitial || '', orders.heparinMaintenance || '']

      localOrderData.effectiveDate = orders.effectiveDate || getToday()
      localOrderData.vascAccess = orders.vascAccess || ''
      localOrderData.arterialNeedle = orders.arterialNeedle || ''
      localOrderData.venousNeedle = orders.venousNeedle || ''
      localOrderData.dialysateCa = orders.dialysateCa || orders.dialysate || ''
      localOrderData.dryWeight = orders.dryWeight || ''
      localOrderData.bloodFlow = orders.bloodFlow || ''
      localOrderData.heparinInitial = heparinLM[0] || ''
      localOrderData.heparinMaintenance = heparinLM[1] || ''

      localOrderData.physician = orders.physician || patient.physician || ''
      localOrderData.mode = orders.mode || patient.mode || ''
      localOrderData.freq = orders.freq || patient.freq || ''
      localOrderData.dialysisHours = orders.dialysisHours || null
      localOrderData.dialysateFlow = orders.dialysateFlow || null
      localOrderData.replacementFlow = orders.replacementFlow || null
      localOrderData.dehydration = orders.dehydration || ''
      localOrderData.heparinRinse = orders.heparinRinse || '不可'
      localOrderData.mannitol = orders.mannitol || '不用'

      fetchOrderHistory(props.patientData.id)
    } else {
      Object.assign(localOrderData, createFormState())
      orderHistory.value = []
    }
  },
  { deep: true },
)

watch(
  () => localOrderData.vascAccess,
  (newValue) => {
    if (newValue !== 'AVF' && newValue !== 'AVG') {
      localOrderData.arterialNeedle = ''
      localOrderData.venousNeedle = ''
    }
  },
)

// --- 事件處理函式 ---

// ✅ 3. [核心] 更新 handleSave，確保所有表單欄位都被包含在儲存物件中
function handleSave() {
  const formattedAk = localOrderData.aks.filter((ak) => ak).join('/')
  const formattedHeparinLM = `${localOrderData.heparinInitial || '0'}/${localOrderData.heparinMaintenance || '0'}`

  const dataToSave = {
    effectiveDate: localOrderData.effectiveDate,
    ak: formattedAk,
    artificialKidney: formattedAk, // 為 ICU 醫囑單添加
    dialysateCa: localOrderData.dialysateCa,
    dialysate: localOrderData.dialysateCa, // 為 ICU 醫囑單添加
    dryWeight: localOrderData.dryWeight,
    bloodFlow: localOrderData.bloodFlow,
    vascAccess: localOrderData.vascAccess,
    arterialNeedle: localOrderData.arterialNeedle,
    venousNeedle: localOrderData.venousNeedle,
    heparinLM: formattedHeparinLM,
    heparinInitial: localOrderData.heparinInitial,
    heparinMaintenance: localOrderData.heparinMaintenance,
    heparinRinse: localOrderData.heparinRinse,
    physician: localOrderData.physician,
    mode: localOrderData.mode,
    freq: localOrderData.freq,
    dialysisHours: localOrderData.dialysisHours,
    dialysateFlow: localOrderData.dialysateFlow,
    replacementFlow: localOrderData.replacementFlow,
    dehydration: localOrderData.dehydration,
    mannitol: localOrderData.mannitol,
  }

  // 移除空值
  Object.keys(dataToSave).forEach((key) => {
    if (dataToSave[key] === null || dataToSave[key] === undefined || dataToSave[key] === '') {
      delete dataToSave[key]
    }
  })

  emit('save', dataToSave)
}

function handleClose() {
  emit('close')
}

function requestDeleteOrder(record) {
  if (!record || !record.id) {
    console.error('❌ [DialysisOrderModal] 無效的刪除記錄:', record)
    alert('錯誤：無法識別要刪除的記錄')
    return
  }
  orderToDelete.value = record
  isConfirmDeleteVisible.value = true
}

async function confirmDelete() {
  if (!orderToDelete.value || !orderToDelete.value.id) {
    console.error('❌ [DialysisOrderModal] 刪除操作：缺少有效的記錄ID')
    return
  }
  const recordId = orderToDelete.value.id
  const patientName = orderToDelete.value.patientName || '未知患者'
  try {
    await ordersApi.deleteDialysisOrderHistory(recordId)
    orderHistory.value = orderHistory.value.filter((item) => item.id !== recordId)
    alert(`成功刪除 ${patientName} 的醫囑歷史記錄`)
  } catch (error) {
    console.error('❌ [DialysisOrderModal] 刪除醫囑歷史失敗:', error)
    alert(`刪除失敗：${error.message}`)
  } finally {
    isConfirmDeleteVisible.value = false
    orderToDelete.value = null
  }
}

function formatDate(isoString) {
  if (!isoString) return 'N/A'
  const date = getDate(isoString)
  if (!date) return 'N/A'
  return formatDateToYYYYMMDD(date)
}

</script>

<style scoped>
/* ================================== */
/*         通用及桌面版樣式            */
/* ================================== */

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
  z-index: 1001;
}
.dialog-content {
  background: white;
  border-radius: 8px;
  box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
  width: 90%;
  max-width: 900px;
  display: flex;
  flex-direction: column;
  max-height: 90vh;
}
.dialog-header,
.dialog-footer {
  flex-shrink: 0;
}
.modal-body {
  flex-grow: 1;
  overflow-y: auto;
  padding: 1.5rem;
}
.dialog-header {
  padding: 1rem 1.5rem;
  border-bottom: 1px solid #e5e5e5;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.dialog-header h2 {
  margin: 0;
  font-size: 1.5rem;
  color: #333;
}
.close-btn {
  background: none;
  border: none;
  font-size: 2rem;
  cursor: pointer;
  color: #aaa;
}
.form-section {
  padding-bottom: 1.5rem;
}
.history-section {
  display: flex;
  flex-direction: column;
}
.form-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
}
.form-group {
  display: flex;
  flex-direction: column;
}
.needle-group-inline {
  display: flex;
  flex-direction: column;
}
.needle-group-inline .sub-group {
  flex: 1;
  display: flex;
  flex-direction: column;
}
.needle-group-inline .needle-inputs {
  display: flex;
  gap: 10px;
}
.needle-group-inline .needle-inputs select {
  flex: 1;
}
.form-group label {
  margin-bottom: 0.5rem;
  font-weight: bold;
  color: #555;
}
.form-group input,
.form-group select {
  padding: 0.6rem;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 1rem;
  background-color: white;
}
.form-group input:focus,
.form-group select:focus {
  outline: none;
  border-color: #007bff;
  box-shadow: 0 0 0 2px rgba(0, 123, 255, 0.25);
}
.history-title {
  margin-top: 0;
  margin-bottom: 0.5rem;
  font-size: 1.2rem;
  color: #333;
}
.history-table-wrapper {
  flex-grow: 1;
  overflow-y: auto;
  border: 1px solid #ddd;
  border-radius: 4px;
}
.history-table-wrapper table {
  width: 100%;
  border-collapse: collapse;
}
.history-table-wrapper th,
.history-table-wrapper td {
  padding: 8px 12px;
  text-align: center;
  border-bottom: 1px solid #ddd;
  white-space: nowrap;
}
.history-table-wrapper th {
  background-color: #f8f9fa;
  font-weight: 600;
  position: sticky;
  top: 0;
  z-index: 1;
}
.history-table-wrapper tr:last-child td {
  border-bottom: none;
}
.col-action {
  width: 50px;
}
.btn-delete {
  background: none;
  border: 1px solid #e53e3e;
  color: #e53e3e;
  border-radius: 50%;
  width: 24px;
  height: 24px;
  cursor: pointer;
  font-weight: bold;
  line-height: 1;
  padding: 0;
  transition: all 0.2s;
}
.btn-delete:hover {
  background-color: #e53e3e;
  color: white;
}
.status-tag {
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 0.8em;
  font-weight: bold;
  color: white;
}
.status-tag.active {
  background-color: #38a169;
}
.status-tag.pending {
  background-color: #f97316;
}
.status-tag.history {
  background-color: #718096;
}
tr.active-order {
  background-color: #f0fff4;
}
tr.active-order td {
  font-weight: bold;
}
tr.active-order td:nth-child(2) {
  border-left: 4px solid #38a169;
}
tr.pending-order {
  background-color: #fffbeb;
}
tr.pending-order td:nth-child(2) {
  border-left: 4px solid #f97316;
}
.loading-state,
.empty-state {
  padding: 2rem;
  text-align: center;
  color: #6c757d;
}
.dialog-footer {
  padding: 1rem 1.5rem;
  border-top: 1px solid #e5e5e5;
  display: flex;
  justify-content: flex-end;
  gap: 1rem;
  background-color: #f8f9fa;
}
.dialog-footer button {
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 4px;
  font-size: 1rem;
  font-weight: bold;
  cursor: pointer;
}
.btn-cancel {
  background-color: #6c757d;
  color: white;
}
.btn-save {
  background-color: #007bff;
  color: white;
}
.is-changed {
  color: #dc3545;
  font-weight: bold;
}
.form-group.ak-dynamic-group {
  grid-column: span 1;
}
.ak-select-wrapper {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.ak-select-wrapper:last-child {
  margin-bottom: 0;
}
.ak-select-wrapper select {
  flex-grow: 1;
}
.btn-ak-action {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 1px solid #ccc;
  background-color: #f0f0f0;
  font-size: 1.2rem;
  font-weight: bold;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  transition: all 0.2s;
}
.btn-ak-action.add {
  color: #28a745;
  border-color: #28a745;
  background-color: #e9f7ef;
  margin-top: 4px;
}
.btn-ak-action.add:hover {
  background-color: #28a745;
  color: white;
}
.btn-ak-action.remove {
  color: #dc3545;
  border-color: #dc3545;
  background-color: #fbebee;
}
.btn-ak-action.remove:hover {
  background-color: #dc3545;
  color: white;
}
.heparin-rinse-group {
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.radio-group {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  height: 100%;
  padding-top: 0.5rem;
}
.radio-group label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
}

/* === 行動版優化 === */
@media (max-width: 768px) {
  .dialog-overlay {
    padding: 0;
  }

  .dialog-content {
    width: 100%;
    height: 100vh;
    max-width: 100%;
    max-height: 100vh;
    border-radius: 0;
  }

  .dialog-header {
    position: sticky;
    top: 0;
    z-index: 100;
    background-color: white;
    padding: 0.75rem 1rem;
  }

  .dialog-header h2 {
    font-size: 1.1rem;
  }

  .modal-body {
    padding: 1rem 0.75rem;
  }

  /* 單欄表單佈局 */
  .form-grid {
    grid-template-columns: 1fr;
    gap: 0.75rem;
  }

  .form-group {
    margin-bottom: 0.5rem;
  }

  .form-group label {
    font-size: 0.9rem;
    margin-bottom: 0.3rem;
  }

  .form-group input,
  .form-group select,
  .form-group textarea {
    padding: 0.5rem;
    font-size: 1rem;
    min-height: 44px; /* 觸控友善 */
  }

  /* AK動態選擇器優化 */
  .ak-select-wrapper {
    margin-bottom: 0.5rem;
  }

  .btn-ak-action {
    width: 36px;
    height: 36px;
  }

  /* 分針穿刺針號並排顯示 */
  .needle-group-inline {
    grid-column: 1 / -1;
  }

  .needle-inputs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }

  /* Heparin Rinse radio 優化 */
  .radio-group {
    gap: 2rem;
  }

  .radio-label {
    padding: 0.25rem;
  }

  /* 歷史紀錄表格優化 */
  .history-section {
    margin-top: 1rem;
  }

  .history-title {
    font-size: 1rem;
    background-color: #f8f9fa;
    padding: 0.5rem;
    margin: -0.5rem -0.5rem 0.5rem -0.5rem;
  }

  .history-table-wrapper {
    max-height: 200px;
    font-size: 0.8rem;
  }

  .history-table-wrapper th,
  .history-table-wrapper td {
    padding: 0.4rem;
    font-size: 0.75rem;
  }

  /* 簡化歷史表格欄位 */
  .history-table-wrapper thead tr th:nth-child(n + 7),
  .history-table-wrapper tbody tr td:nth-child(n + 7) {
    display: none;
  }

  /* 頁尾按鈕優化 */
  .dialog-footer {
    position: sticky;
    bottom: 0;
    padding: 0.75rem;
    flex-direction: row;
    gap: 0.5rem;
    background-color: white;
    border-top: 2px solid #dee2e6;
  }

  .dialog-footer button {
    flex: 1;
    padding: 0.6rem 1rem;
    font-size: 0.95rem;
    min-height: 44px;
  }
}

/* 超小螢幕優化 */
@media (max-width: 400px) {
  .dialog-header h2 {
    font-size: 1rem;
  }

  .form-group label {
    font-size: 0.85rem;
  }

  .history-table-wrapper {
    font-size: 0.7rem;
  }
}
</style>
