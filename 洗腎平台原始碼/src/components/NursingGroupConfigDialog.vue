<!-- 檔案路徑: src/components/NursingGroupConfigDialog.vue -->
<template>
  <Teleport to="body">
    <div v-if="modelValue" class="dialog-overlay" @click.self="closeDialog">
      <div class="dialog-container">
        <!-- Header -->
        <header class="dialog-header">
          <h2>護理組別配置</h2>
          <span class="month-badge" v-if="yearMonth">{{ yearMonth }}</span>
          <button class="close-btn" @click="closeDialog" title="關閉">
            &times;
          </button>
        </header>

        <!-- Content -->
        <main class="dialog-content">
          <!-- 載入中 -->
          <div v-if="isLoading" class="loading-container">
            <div class="spinner"></div>
            <span>正在載入配置...</span>
          </div>

          <template v-else>
            <!-- 配置來源提示 -->
            <div v-if="sourceMonth && sourceMonth !== yearMonth" class="source-info">
              此配置繼承自 <strong>{{ sourceMonth === 'default' ? '預設配置' : sourceMonth }}</strong>，
              儲存後將建立 {{ yearMonth }} 專屬配置
            </div>

            <!-- 狀態訊息 -->
            <div v-if="statusMessage" :class="['status-message', statusMessage.type]">
              {{ statusMessage.text }}
            </div>

            <!-- 驗證錯誤訊息 -->
            <div v-if="validationErrors.length > 0" class="validation-errors">
              <strong>配置驗證錯誤：</strong>
              <ul>
                <li v-for="(error, index) in validationErrors" :key="index">{{ error }}</li>
              </ul>
            </div>

            <!-- ===== 第一區：組數設定 ===== -->
            <section class="config-section">
              <h3 class="section-title">組數設定</h3>
              <p class="section-desc">設定一三五和二四六的早班、晚班組數（組別代碼依字母順序自動產生）</p>

              <div class="group-counts-grid">
                <!-- 一三五 -->
                <div class="count-card">
                  <div class="count-header">一、三、五</div>
                  <div class="count-row">
                    <label class="count-label">早班：</label>
                    <select v-model.number="config.groupCounts['135'].dayShiftCount" class="count-select" @change="onDayCountChange('135')">
                      <option v-for="n in maxDayShiftGroups" :key="`135-day-${n}`" :value="n">{{ n }} 組</option>
                    </select>
                    <span class="groups-preview">{{ dayGroups135.join(', ') }}</span>
                  </div>
                  <div class="count-row">
                    <label class="count-label">晚班：</label>
                    <select v-model.number="config.groupCounts['135'].nightShiftCount" class="count-select">
                      <option v-for="n in maxNightShiftGroups" :key="`135-night-${n}`" :value="n">{{ n }} 組</option>
                    </select>
                    <span class="groups-preview">{{ nightGroups135.join(', ') }}</span>
                  </div>
                </div>

                <!-- 二四六 -->
                <div class="count-card">
                  <div class="count-header">二、四、六</div>
                  <div class="count-row">
                    <label class="count-label">早班：</label>
                    <select v-model.number="config.groupCounts['246'].dayShiftCount" class="count-select" @change="onDayCountChange('246')">
                      <option v-for="n in maxDayShiftGroups" :key="`246-day-${n}`" :value="n">{{ n }} 組</option>
                    </select>
                    <span class="groups-preview">{{ dayGroups246.join(', ') }}</span>
                  </div>
                  <div class="count-row">
                    <label class="count-label">晚班：</label>
                    <select v-model.number="config.groupCounts['246'].nightShiftCount" class="count-select">
                      <option v-for="n in maxNightShiftGroups" :key="`246-night-${n}`" :value="n">{{ n }} 組</option>
                    </select>
                    <span class="groups-preview">{{ nightGroups246.join(', ') }}</span>
                  </div>
                </div>
              </div>

              <!-- 固定分配說明 -->
              <div class="fixed-rules-info">
                <span class="fixed-item"><b>74/L</b> → A組</span>
                <span class="fixed-item"><b>816</b> → 外圍</span>
                <span class="fixed-item"><b>311C</b> → C組（夜班）</span>
              </div>
            </section>

            <!-- ===== 第二區：75班組別設定 ===== -->
            <section class="config-section">
              <h3 class="section-title">75班組別設定</h3>
              <p class="section-desc">從早班可用組別中選擇75班使用的組別（74班自動取得剩餘組別）</p>

              <div class="weekday-grid">
                <!-- 一三五 -->
                <div class="weekday-card">
                  <div class="weekday-header">一、三、五</div>
                  <div class="shift-row">
                    <span class="shift-label">75班：</span>
                    <div class="checkbox-group compact">
                      <label
                        v-for="group in dayGroups135"
                        :key="`135-75-${group}`"
                        class="checkbox-label small"
                      >
                        <input
                          type="checkbox"
                          :value="group"
                          v-model="config.dayShiftRules['135'].shift75Groups"
                        />
                        <span class="checkbox-text">{{ group }}</span>
                      </label>
                    </div>
                    <span class="count-badge">{{ config.dayShiftRules['135'].shift75Groups.length }}組</span>
                  </div>
                  <div class="auto-calculated">
                    <span class="calc-label">74班（自動）：</span>
                    <span class="calc-groups">{{ calculated74Groups135.join(', ') || '無' }}</span>
                    <span class="count-badge secondary">{{ calculated74Groups135.length }}組</span>
                  </div>
                </div>

                <!-- 二四六 -->
                <div class="weekday-card">
                  <div class="weekday-header">二、四、六</div>
                  <div class="shift-row">
                    <span class="shift-label">75班：</span>
                    <div class="checkbox-group compact">
                      <label
                        v-for="group in dayGroups246"
                        :key="`246-75-${group}`"
                        class="checkbox-label small"
                      >
                        <input
                          type="checkbox"
                          :value="group"
                          v-model="config.dayShiftRules['246'].shift75Groups"
                        />
                        <span class="checkbox-text">{{ group }}</span>
                      </label>
                    </div>
                    <span class="count-badge">{{ config.dayShiftRules['246'].shift75Groups.length }}組</span>
                  </div>
                  <div class="auto-calculated">
                    <span class="calc-label">74班（自動）：</span>
                    <span class="calc-groups">{{ calculated74Groups246.join(', ') || '無' }}</span>
                    <span class="count-badge secondary">{{ calculated74Groups246.length }}組</span>
                  </div>
                </div>
              </div>
            </section>

            <!-- ===== 第三區：人員限制 ===== -->
            <section class="config-section">
              <h3 class="section-title">不可擔任晚班組長</h3>
              <p class="section-desc">勾選的護理師將不可分配到晚班 A 組</p>

              <div v-if="nurses.length === 0" class="no-data">
                尚無護理師資料
              </div>

              <div v-else class="nurse-restriction-list">
                <div class="search-box">
                  <input
                    type="text"
                    v-model="nurseSearchQuery"
                    placeholder="搜尋護理師..."
                    class="search-input"
                  />
                </div>
                <div class="nurse-checkbox-grid">
                  <label
                    v-for="nurse in filteredNurses"
                    :key="nurse.uid"
                    class="checkbox-label nurse-item"
                  >
                    <input
                      type="checkbox"
                      :value="nurse.uid"
                      v-model="config.cannotBeNightLeader"
                    />
                    <span class="checkbox-text">{{ nurse.name || nurse.displayName }}</span>
                  </label>
                </div>
                <div class="selected-info">
                  已限制 {{ config.cannotBeNightLeader.length }} 位
                </div>
              </div>
            </section>

            <!-- ===== 第四區：夜班組別限制 ===== -->
            <section class="config-section">
              <h3 class="section-title">夜班組別限制</h3>
              <p class="section-desc">設定特定護理師不可分配到特定夜班組別</p>

              <div v-if="nurses.length === 0" class="no-data">
                尚無護理師資料
              </div>

              <div v-else class="night-restriction-container">
                <!-- 已設定限制的護理師列表 -->
                <div v-if="nightRestrictionList.length > 0" class="restriction-list">
                  <div
                    v-for="item in nightRestrictionList"
                    :key="item.nurseId"
                    class="restriction-item"
                  >
                    <span class="nurse-name">{{ item.nurseName }}</span>
                    <div class="restricted-groups">
                      <span
                        v-for="group in item.groups"
                        :key="group"
                        class="group-tag"
                      >
                        {{ group }}組
                        <button
                          type="button"
                          class="remove-group-btn"
                          @click="removeNightRestrictionGroup(item.nurseId, group)"
                          title="移除"
                        >&times;</button>
                      </span>
                    </div>
                    <button
                      type="button"
                      class="remove-btn"
                      @click="removeNightRestriction(item.nurseId)"
                      title="移除此護理師的所有限制"
                    >
                      全部移除
                    </button>
                  </div>
                </div>

                <!-- 新增限制 -->
                <div class="add-restriction-form">
                  <select v-model="newRestrictionNurseId" class="nurse-select">
                    <option value="">選擇護理師...</option>
                    <option
                      v-for="nurse in availableNursesForNightRestriction"
                      :key="nurse.uid"
                      :value="nurse.uid"
                    >
                      {{ nurse.name || nurse.displayName }}
                    </option>
                  </select>
                  <div class="group-checkboxes">
                    <label
                      v-for="group in nightShiftGroupOptions"
                      :key="group"
                      class="checkbox-label small"
                    >
                      <input
                        type="checkbox"
                        :value="group"
                        v-model="newRestrictionGroups"
                        :disabled="!newRestrictionNurseId"
                      />
                      <span class="checkbox-text">{{ group }}</span>
                    </label>
                  </div>
                  <button
                    type="button"
                    class="btn-add"
                    @click="addNightRestriction"
                    :disabled="!newRestrictionNurseId || newRestrictionGroups.length === 0"
                  >
                    新增限制
                  </button>
                </div>
              </div>
            </section>

            <!-- ===== 第五區：新進護理師暫不分組 ===== -->
            <section class="config-section">
              <h3 class="section-title">新進護理師暫不分組</h3>
              <p class="section-desc">勾選的護理師將暫時不參與分組，可隨時取消勾選以加入分組</p>

              <div v-if="nurses.length === 0" class="no-data">
                尚無護理師資料
              </div>

              <div v-else class="nurse-restriction-list">
                <div class="search-box">
                  <input
                    type="text"
                    v-model="excludedNurseSearchQuery"
                    placeholder="搜尋護理師..."
                    class="search-input"
                  />
                </div>
                <div class="nurse-checkbox-grid">
                  <label
                    v-for="nurse in filteredNursesForExcluded"
                    :key="nurse.uid"
                    class="checkbox-label nurse-item"
                  >
                    <input
                      type="checkbox"
                      :value="nurse.uid"
                      v-model="config.excludedNurses"
                    />
                    <span class="checkbox-text">{{ nurse.name || nurse.displayName }}</span>
                  </label>
                </div>
                <div class="selected-info">
                  已設定 {{ config.excludedNurses?.length || 0 }} 位暫不分組
                </div>
              </div>
            </section>
          </template>
        </main>

        <!-- Footer -->
        <footer class="dialog-footer">
          <button @click="resetToDefault" class="btn-secondary" :disabled="isSaving">
            重設預設值
          </button>
          <div class="footer-right">
            <button @click="closeDialog" class="btn-secondary">
              取消
            </button>
            <button
              @click="saveConfig"
              class="btn-primary"
              :disabled="isSaving || validationErrors.length > 0"
            >
              {{ isSaving ? '儲存中...' : '儲存配置' }}
            </button>
          </div>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useAuth } from '@/composables/useAuth'
import { useUserDirectory } from '@/composables/useUserDirectory'
import {
  fetchNursingGroupConfig,
  saveNursingGroupConfig,
  getDefaultConfig,
  validateConfig,
  generateDayShiftGroups,
  generateNightShiftGroups,
  calculate74Groups,
  MAX_DAY_SHIFT_GROUPS,
  MAX_NIGHT_SHIFT_GROUPS,
} from '@/services/nursingGroupConfigService'

// Props & Emits
const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false,
  },
  yearMonth: {
    type: String,
    default: null, // YYYY-MM 格式
  },
})

const emit = defineEmits(['update:modelValue', 'saved'])

// Composables
const auth = useAuth()
const { ensureUsersLoaded, users } = useUserDirectory()

// 常數
const maxDayShiftGroups = MAX_DAY_SHIFT_GROUPS
const maxNightShiftGroups = MAX_NIGHT_SHIFT_GROUPS

// 狀態
const isLoading = ref(true)
const isSaving = ref(false)
const statusMessage = ref(null)
const nurseSearchQuery = ref('')
const excludedNurseSearchQuery = ref('')
const config = ref(getDefaultConfig())
const sourceMonth = ref(null) // 配置來源月份

// 夜班組別限制相關狀態
const newRestrictionNurseId = ref('')
const newRestrictionGroups = ref([])
const nightShiftGroupOptions = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']

// 計算早班可用組別（根據組數）
const dayGroups135 = computed(() => {
  return generateDayShiftGroups(config.value.groupCounts?.['135']?.dayShiftCount || 8)
})

const dayGroups246 = computed(() => {
  return generateDayShiftGroups(config.value.groupCounts?.['246']?.dayShiftCount || 9)
})

// 計算晚班可用組別（根據組數）
const nightGroups135 = computed(() => {
  return generateNightShiftGroups(config.value.groupCounts?.['135']?.nightShiftCount || 9)
})

const nightGroups246 = computed(() => {
  return generateNightShiftGroups(config.value.groupCounts?.['246']?.nightShiftCount || 8)
})

// 計算74班組別（自動）
const calculated74Groups135 = computed(() => {
  const dayGroups = dayGroups135.value
  const shift75Groups = config.value.dayShiftRules?.['135']?.shift75Groups || []
  return calculate74Groups(dayGroups, shift75Groups)
})

const calculated74Groups246 = computed(() => {
  const dayGroups = dayGroups246.value
  const shift75Groups = config.value.dayShiftRules?.['246']?.shift75Groups || []
  return calculate74Groups(dayGroups, shift75Groups)
})

// 當早班組數變更時，過濾掉不在範圍內的75班組別
const onDayCountChange = (weekday) => {
  const dayGroups = weekday === '135' ? dayGroups135.value : dayGroups246.value
  const currentShift75 = config.value.dayShiftRules[weekday].shift75Groups || []
  // 過濾掉超出範圍的組別
  config.value.dayShiftRules[weekday].shift75Groups = currentShift75.filter((g) => dayGroups.includes(g))
}

// 護理師列表
const nurses = computed(() => {
  return users.value
    .filter((user) => user.title === '護理師' || user.title === '護理師組長')
    .sort((a, b) => {
      const nameA = a.name || a.displayName || ''
      const nameB = b.name || b.displayName || ''
      return nameA.localeCompare(nameB, 'zh-TW')
    })
})

// 篩選後的護理師列表
const filteredNurses = computed(() => {
  if (!nurseSearchQuery.value) return nurses.value
  const query = nurseSearchQuery.value.toLowerCase()
  return nurses.value.filter((nurse) => {
    const name = (nurse.name || nurse.displayName || '').toLowerCase()
    return name.includes(query)
  })
})

// 篩選後的護理師列表（暫不分組用）
const filteredNursesForExcluded = computed(() => {
  if (!excludedNurseSearchQuery.value) return nurses.value
  const query = excludedNurseSearchQuery.value.toLowerCase()
  return nurses.value.filter((nurse) => {
    const name = (nurse.name || nurse.displayName || '').toLowerCase()
    return name.includes(query)
  })
})

// 夜班組別限制列表（用於顯示）
const nightRestrictionList = computed(() => {
  const restrictions = config.value.nightShiftRestrictions || {}
  const list = []
  Object.entries(restrictions).forEach(([nurseId, groups]) => {
    if (groups && groups.length > 0) {
      const nurse = nurses.value.find((n) => n.uid === nurseId)
      list.push({
        nurseId,
        nurseName: nurse?.name || nurse?.displayName || nurseId,
        groups: [...groups].sort(),
      })
    }
  })
  // 依護理師名稱排序
  list.sort((a, b) => a.nurseName.localeCompare(b.nurseName, 'zh-TW'))
  return list
})

// 可選擇新增限制的護理師（排除已設定的）
const availableNursesForNightRestriction = computed(() => {
  const restrictions = config.value.nightShiftRestrictions || {}
  return nurses.value.filter((nurse) => {
    // 已有限制設定的也可以選（可以追加組別）
    return true
  })
})

// 新增夜班組別限制
const addNightRestriction = () => {
  if (!newRestrictionNurseId.value || newRestrictionGroups.value.length === 0) return

  if (!config.value.nightShiftRestrictions) {
    config.value.nightShiftRestrictions = {}
  }

  const nurseId = newRestrictionNurseId.value
  const existingGroups = config.value.nightShiftRestrictions[nurseId] || []
  const newGroups = [...new Set([...existingGroups, ...newRestrictionGroups.value])].sort()

  config.value.nightShiftRestrictions[nurseId] = newGroups

  // 重置表單
  newRestrictionNurseId.value = ''
  newRestrictionGroups.value = []
}

// 移除護理師的特定夜班組別限制
const removeNightRestrictionGroup = (nurseId, group) => {
  if (!config.value.nightShiftRestrictions || !config.value.nightShiftRestrictions[nurseId]) return

  const groups = config.value.nightShiftRestrictions[nurseId]
  const newGroups = groups.filter((g) => g !== group)

  // 如果沒有剩餘組別，移除整個護理師的設定
  if (newGroups.length === 0) {
    const { [nurseId]: removed, ...rest } = config.value.nightShiftRestrictions
    config.value.nightShiftRestrictions = rest
  } else {
    config.value.nightShiftRestrictions = {
      ...config.value.nightShiftRestrictions,
      [nurseId]: newGroups,
    }
  }
}

// 移除護理師的所有夜班組別限制
const removeNightRestriction = (nurseId) => {
  if (!config.value.nightShiftRestrictions) return
  const { [nurseId]: removed, ...rest } = config.value.nightShiftRestrictions
  config.value.nightShiftRestrictions = rest
}

// 驗證錯誤
const validationErrors = computed(() => {
  const result = validateConfig(config.value)
  return result.errors
})

// 當 Dialog 開啟時載入配置
watch(
  () => props.modelValue,
  async (isOpen) => {
    if (isOpen) {
      await loadConfig()
    }
  }
)

// 載入配置
const loadConfig = async () => {
  isLoading.value = true
  statusMessage.value = null
  sourceMonth.value = null
  try {
    await ensureUsersLoaded()
    const result = await fetchNursingGroupConfig(props.yearMonth)
    const data = result.config
    sourceMonth.value = result.sourceMonth
    const defaultConfig = getDefaultConfig()

    config.value = {
      ...defaultConfig,
      ...data,
      groupCounts: {
        '135': {
          ...defaultConfig.groupCounts['135'],
          ...(data.groupCounts?.['135'] || {}),
        },
        '246': {
          ...defaultConfig.groupCounts['246'],
          ...(data.groupCounts?.['246'] || {}),
        },
      },
      dayShiftRules: {
        '135': {
          ...defaultConfig.dayShiftRules['135'],
          ...(data.dayShiftRules?.['135'] || {}),
        },
        '246': {
          ...defaultConfig.dayShiftRules['246'],
          ...(data.dayShiftRules?.['246'] || {}),
        },
      },
      nightShiftRestrictions: data.nightShiftRestrictions || {},
      excludedNurses: data.excludedNurses || [],
    }
  } catch (error) {
    console.error('載入配置失敗:', error)
    statusMessage.value = {
      type: 'error',
      text: '載入配置失敗：' + error.message,
    }
  } finally {
    isLoading.value = false
  }
}

// 儲存配置
const saveConfig = async () => {
  if (validationErrors.value.length > 0) {
    statusMessage.value = { type: 'error', text: '請先修正驗證錯誤' }
    return
  }

  if (!props.yearMonth) {
    statusMessage.value = { type: 'error', text: '無法儲存：未指定月份' }
    return
  }

  isSaving.value = true
  statusMessage.value = null

  try {
    await saveNursingGroupConfig(config.value, props.yearMonth, auth.currentUser.value)
    statusMessage.value = { type: 'success', text: `配置已成功儲存至 ${props.yearMonth}！` }
    sourceMonth.value = props.yearMonth // 更新來源月份
    emit('saved', config.value)
    setTimeout(() => {
      closeDialog()
    }, 800)
  } catch (error) {
    console.error('儲存配置失敗:', error)
    statusMessage.value = { type: 'error', text: '儲存失敗：' + error.message }
  } finally {
    isSaving.value = false
  }
}

// 重設為預設值
const resetToDefault = () => {
  if (!confirm('確定要重設為預設值嗎？')) return
  config.value = getDefaultConfig()
  statusMessage.value = { type: 'success', text: '已重設為預設值' }
}

// 關閉 Dialog
const closeDialog = () => {
  emit('update:modelValue', false)
}
</script>

<style scoped>
/* ===== Dialog Overlay ===== */
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.dialog-container {
  background: white;
  border-radius: 8px;
  width: 95%;
  max-width: 850px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
}

/* ===== Header ===== */
.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid #dee2e6;
  flex-shrink: 0;
  background: #f8f9fa;
}

.dialog-header h2 {
  margin: 0;
  font-size: 1.2rem;
  color: #2c3e50;
}

.month-badge {
  background: #007bff;
  color: white;
  padding: 0.25rem 0.6rem;
  border-radius: 4px;
  font-size: 0.85rem;
  font-weight: 500;
  margin-left: 0.5rem;
}

.source-info {
  background: #fff3cd;
  border: 1px solid #ffc107;
  color: #856404;
  padding: 0.6rem 0.8rem;
  border-radius: 4px;
  font-size: 0.85rem;
  margin-bottom: 0.8rem;
}

.close-btn {
  background: none;
  border: none;
  font-size: 1.5rem;
  color: #6c757d;
  cursor: pointer;
  padding: 0;
  line-height: 1;
}

.close-btn:hover {
  color: #333;
}

/* ===== Content ===== */
.dialog-content {
  flex: 1;
  overflow-y: auto;
  padding: 1rem 1.25rem;
}

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem;
  color: #6c757d;
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid #f3f3f3;
  border-top: 3px solid #007bff;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 1rem;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

/* ===== Section ===== */
.config-section {
  margin-bottom: 1.5rem;
  padding-bottom: 1.5rem;
  border-bottom: 1px solid #e9ecef;
}

.config-section:last-child {
  margin-bottom: 0;
  padding-bottom: 0;
  border-bottom: none;
}

.section-title {
  font-size: 1rem;
  font-weight: 600;
  color: #2c3e50;
  margin: 0 0 0.25rem 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.section-title::before {
  content: '';
  display: inline-block;
  width: 4px;
  height: 16px;
  background: #1abc9c;
  border-radius: 2px;
}

.section-desc {
  font-size: 0.8rem;
  color: #6c757d;
  margin: 0 0 0.75rem 0;
}

/* ===== Group Counts Grid ===== */
.group-counts-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  margin-bottom: 0.75rem;
}

@media (max-width: 600px) {
  .group-counts-grid {
    grid-template-columns: 1fr;
  }
}

.count-card {
  background: #f8f9fa;
  border-radius: 6px;
  padding: 0.75rem;
}

.count-header {
  font-size: 0.9rem;
  font-weight: 600;
  color: white;
  background: #495057;
  padding: 0.3rem 0.6rem;
  border-radius: 4px;
  margin-bottom: 0.6rem;
  text-align: center;
}

.count-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.4rem;
}

.count-row:last-child {
  margin-bottom: 0;
}

.count-label {
  font-size: 0.85rem;
  font-weight: 600;
  color: #495057;
  min-width: 45px;
}

.count-select {
  padding: 0.25rem 0.5rem;
  border: 1px solid #dee2e6;
  border-radius: 4px;
  font-size: 0.85rem;
  background: white;
  min-width: 70px;
}

.count-select:focus {
  outline: none;
  border-color: #007bff;
}

.groups-preview {
  font-size: 0.75rem;
  color: #6c757d;
  background: white;
  padding: 0.2rem 0.4rem;
  border-radius: 4px;
  border: 1px solid #e9ecef;
  flex: 1;
}

/* ===== Fixed Rules Info ===== */
.fixed-rules-info {
  padding: 0.5rem 0.75rem;
  background: #e9ecef;
  border-radius: 4px;
  font-size: 0.8rem;
  display: flex;
  align-items: center;
  gap: 1.5rem;
  flex-wrap: wrap;
}

.fixed-item {
  color: #495057;
}

.fixed-item b {
  color: #007bff;
}

/* ===== Weekday Grid ===== */
.weekday-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

@media (max-width: 600px) {
  .weekday-grid {
    grid-template-columns: 1fr;
  }
}

.weekday-card {
  background: #f8f9fa;
  border-radius: 6px;
  padding: 0.75rem;
}

.weekday-header {
  font-size: 0.9rem;
  font-weight: 600;
  color: white;
  background: #495057;
  padding: 0.3rem 0.6rem;
  border-radius: 4px;
  margin-bottom: 0.6rem;
  text-align: center;
}

.shift-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
  flex-wrap: wrap;
}

.shift-label {
  font-size: 0.8rem;
  font-weight: 600;
  color: #495057;
  min-width: 45px;
}

/* ===== Auto Calculated ===== */
.auto-calculated {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px dashed #dee2e6;
  flex-wrap: wrap;
}

.calc-label {
  font-size: 0.8rem;
  font-weight: 600;
  color: #6c757d;
  min-width: 90px;
}

.calc-groups {
  font-size: 0.8rem;
  color: #495057;
  background: white;
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
  border: 1px solid #dee2e6;
}

/* ===== Checkbox Group ===== */
.checkbox-group {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.checkbox-group.compact {
  gap: 0.3rem;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.5rem;
  background: white;
  border: 1px solid #dee2e6;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
  transition: all 0.15s;
}

.checkbox-label:hover {
  border-color: #007bff;
}

.checkbox-label.small {
  padding: 0.2rem 0.4rem;
  font-size: 0.8rem;
}

.checkbox-label input[type="checkbox"] {
  width: 14px;
  height: 14px;
  cursor: pointer;
}

.checkbox-text {
  font-weight: 500;
  color: #495057;
}

.count-badge {
  font-size: 0.75rem;
  background: #007bff;
  color: white;
  padding: 0.15rem 0.4rem;
  border-radius: 10px;
  margin-left: auto;
}

.count-badge.secondary {
  background: #6c757d;
}

.selected-info {
  margin-top: 0.5rem;
  font-size: 0.75rem;
  color: #6c757d;
}

/* ===== Nurse List ===== */
.nurse-restriction-list {
  max-height: 200px;
}

.search-box {
  margin-bottom: 0.5rem;
}

.search-input {
  width: 100%;
  padding: 0.4rem 0.6rem;
  border: 1px solid #dee2e6;
  border-radius: 4px;
  font-size: 0.85rem;
}

.search-input:focus {
  outline: none;
  border-color: #007bff;
}

.nurse-checkbox-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  gap: 0.3rem;
  max-height: 140px;
  overflow-y: auto;
  padding: 0.4rem;
  background: #f8f9fa;
  border-radius: 4px;
}

.nurse-item {
  font-size: 0.8rem;
}

.no-data {
  padding: 1rem;
  text-align: center;
  color: #6c757d;
  background: #f8f9fa;
  border-radius: 4px;
}

/* ===== Night Shift Restriction ===== */
.night-restriction-container {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.restriction-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-height: 200px;
  overflow-y: auto;
  padding: 0.5rem;
  background: #f8f9fa;
  border-radius: 4px;
}

.restriction-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.6rem;
  background: white;
  border: 1px solid #dee2e6;
  border-radius: 4px;
  flex-wrap: wrap;
}

.restriction-item .nurse-name {
  font-weight: 600;
  color: #495057;
  font-size: 0.85rem;
  min-width: 80px;
}

.restricted-groups {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  flex: 1;
}

.group-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  padding: 0.15rem 0.4rem;
  background: #dc3545;
  color: white;
  border-radius: 3px;
  font-size: 0.75rem;
  font-weight: 500;
}

.remove-group-btn {
  background: none;
  border: none;
  color: white;
  font-size: 0.9rem;
  cursor: pointer;
  padding: 0;
  line-height: 1;
  opacity: 0.8;
}

.remove-group-btn:hover {
  opacity: 1;
}

.remove-btn {
  background: #6c757d;
  color: white;
  border: none;
  padding: 0.2rem 0.5rem;
  border-radius: 3px;
  font-size: 0.75rem;
  cursor: pointer;
  margin-left: auto;
}

.remove-btn:hover {
  background: #5a6268;
}

.add-restriction-form {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  padding: 0.6rem;
  background: #e9ecef;
  border-radius: 4px;
}

.nurse-select {
  padding: 0.35rem 0.5rem;
  border: 1px solid #dee2e6;
  border-radius: 4px;
  font-size: 0.85rem;
  min-width: 140px;
  background: white;
}

.nurse-select:focus {
  outline: none;
  border-color: #007bff;
}

.group-checkboxes {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}

.btn-add {
  background: #28a745;
  color: white;
  border: none;
  padding: 0.35rem 0.75rem;
  border-radius: 4px;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
}

.btn-add:hover:not(:disabled) {
  background: #218838;
}

.btn-add:disabled {
  background: #6c757d;
  cursor: not-allowed;
  opacity: 0.65;
}

/* ===== Status Messages ===== */
.status-message {
  padding: 0.5rem 0.75rem;
  border-radius: 4px;
  font-size: 0.85rem;
  margin-bottom: 1rem;
}

.status-message.success {
  background-color: #d4edda;
  color: #155724;
  border: 1px solid #c3e6cb;
}

.status-message.error {
  background-color: #f8d7da;
  color: #721c24;
  border: 1px solid #f5c6cb;
}

.validation-errors {
  background-color: #fff3cd;
  color: #856404;
  border: 1px solid #ffeeba;
  padding: 0.5rem 0.75rem;
  border-radius: 4px;
  margin-bottom: 1rem;
  font-size: 0.8rem;
}

.validation-errors ul {
  margin: 0.3rem 0 0 0;
  padding-left: 1.2rem;
}

/* ===== Footer ===== */
.dialog-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1.25rem;
  border-top: 1px solid #dee2e6;
  flex-shrink: 0;
  background: #f8f9fa;
}

.footer-right {
  display: flex;
  gap: 0.5rem;
}

.btn-primary,
.btn-secondary {
  padding: 0.4rem 1rem;
  border: none;
  border-radius: 4px;
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-primary {
  background-color: #007bff;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background-color: #0056b3;
}

.btn-primary:disabled {
  background-color: #6c757d;
  cursor: not-allowed;
  opacity: 0.65;
}

.btn-secondary {
  background-color: #fff;
  color: #495057;
  border: 1px solid #dee2e6;
}

.btn-secondary:hover:not(:disabled) {
  background-color: #e9ecef;
}
</style>
