<!-- 檔案路徑: src/components/IcuOrdersDialog.vue (動態卡片最終版) -->
<template>
  <div v-if="isVisible" class="modal-overlay" v-overlay-close="closeDialog">
    <div class="modal-content">
      <header class="modal-header">
        <!-- ✨ 核心修改 1: 新增日期導覽按鈕 ✨ -->
        <div class="date-navigator">
          <button @click="navigateDate(-1)" class="nav-btn">&lt; 上一天</button>
          <h2>{{ targetDate }} 外圍病房透析醫囑單</h2>
          <button @click="navigateDate(1)" class="nav-btn">下一天 &gt;</button>
        </div>

        <div class="header-actions">
          <button v-if="canEdit" @click="handleSaveAndPrint" class="btn-print">
            <i class="fas fa-print"></i> 儲存並列印
          </button>
          <button @click="closeDialog" class="btn-close">×</button>
        </div>
      </header>

      <div class="modal-body" id="icu-orders-printable-area">
        <h1 class="printable-header">{{ targetDate }} 外圍病房透析醫囑單</h1>

        <section class="order-section">
          <h3 class="section-title">當日透析病患</h3>

          <!-- 早班 -->
          <div class="shift-group">
            <h4>早班</h4>
            <div v-if="earlyPeripheralPatients.length > 0" class="patient-grid">
              <div v-for="p in earlyPeripheralPatients" :key="p.id" class="patient-order-card">
                <div class="patient-header">
                  <div class="info-item"><strong>床號:</strong> {{ p.wardNumber || '____' }}</div>
                  <div
                    class="info-item name"
                    @click="canEdit && $emit('open-order-modal', p)"
                    title="點擊編輯醫囑"
                    :style="{ cursor: canEdit ? 'pointer' : 'default' }"
                  >
                    <strong>姓名:</strong> {{ p.name }}
                  </div>
                  <div class="info-item"><strong>病歷號:</strong> {{ p.medicalRecordNumber }}</div>
                </div>

                <div class="card-body">
                  <div
                    v-if="p.dialysisOrders?.mode === 'PP' || p.dialysisOrders?.mode === 'DFPP'"
                    class="order-details"
                  >
                    <div>
                      <strong>會診醫師:</strong> {{ p.dialysisOrders?.physician || '____' }}
                    </div>
                    <div><strong>透析模式:</strong> {{ p.dialysisOrders?.mode || '____' }}</div>
                    <div class="highlight-field">
                      <strong>血漿交換量:</strong>
                      {{
                        p.dialysisOrders?.exchangeVolume
                          ? p.dialysisOrders.exchangeVolume.toFixed(0) + ' ml'
                          : '____'
                      }}
                    </div>
                    <div class="highlight-field">
                      <strong>血液流速:</strong>
                      {{
                        p.dialysisOrders?.bloodFlow
                          ? p.dialysisOrders.bloodFlow + ' ml/min'
                          : '____'
                      }}
                    </div>
                    <div>
                      <strong>體重/Hct:</strong> {{ p.dialysisOrders?.bw || '____' }}kg /
                      {{ p.dialysisOrders?.hct || '____' }}%
                    </div>
                    <div><strong>Heparin:</strong> {{ p.dialysisOrders?.heparin || '____' }}</div>
                  </div>
                  <div v-else class="order-details">
                    <div>
                      <strong>會診醫師:</strong> {{ p.dialysisOrders?.physician || '____' }}
                    </div>
                    <div><strong>透析模式:</strong> {{ p.dialysisOrders?.mode || '____' }}</div>
                    <div><strong>頻次:</strong> {{ p.dialysisOrders?.freq || '____' }}</div>

                    <!-- 1. AK: 保留 highlight -->
                    <div class="highlight-field">
                      <span>
                        <!-- ✨ 新增一個 span 來包裹內容 ✨ -->
                        <strong>AK:</strong> {{ p.dialysisOrders?.ak || '____' }}
                      </span>
                    </div>

                    <!-- 2. 藥水: 保留 highlight -->
                    <div class="highlight-field">
                      <span>
                        <!-- ✨ 新增一個 span 來包裹內容 ✨ -->
                        <strong>藥水:</strong> {{ p.dialysisOrders?.dialysate || '____' }}
                      </span>
                    </div>

                    <!-- 3. 時間: 新增 highlight -->
                    <div class="highlight-field">
                      <span>
                        <!-- ✨ 新增一個 span 來包裹內容 ✨ -->
                        <strong>時間(hr):</strong> {{ p.dialysisOrders?.dialysisHours || '____' }}
                      </span>
                    </div>

                    <div>
                      <strong>Heparin:</strong> {{ p.dialysisOrders?.heparinRinse || '____' }} /
                      {{ p.dialysisOrders?.heparinLM || '____' }}
                    </div>
                    <div>
                      <strong>BF/DF:</strong> {{ p.dialysisOrders?.bloodFlow || '____' }} /
                      {{ p.dialysisOrders?.dialysateFlow || '____' }}
                    </div>

                    <!-- 4. 脫水量: 保留 highlight -->
                    <div class="highlight-field">
                      <span>
                        <!-- ✨ 新增一個 span 來包裹內容 ✨ -->
                        <strong>脫水量:</strong> {{ p.dialysisOrders?.dehydration || '____' }}
                      </span>
                    </div>

                    <!-- 5. Mannitol: 移除 highlight -->
                    <div><strong>Mannitol:</strong> {{ p.dialysisOrders?.mannitol || '____' }}</div>
                  </div>
                  <div class="notes-section">
                    <strong>備註：</strong>
                    <input
                      type="text"
                      class="notes-input"
                      v-model="localNotes[p.id]"
                      @input="updateLocalNote(p.id, $event.target.value)"
                      placeholder="點此輸入備註..."
                      :readonly="!canEdit"
                    />
                  </div>
                </div>
              </div>
            </div>
            <p v-else class="no-patients-text">早班無外圍病房病人</p>
          </div>

          <!-- 午班 -->
          <div class="shift-group">
            <h4>午班</h4>
            <div v-if="noonPeripheralPatients.length > 0" class="patient-grid">
              <div v-for="p in noonPeripheralPatients" :key="p.id" class="patient-order-card">
                <div class="patient-header">
                  <div class="info-item"><strong>床號:</strong> {{ p.wardNumber || '____' }}</div>
                  <div
                    class="info-item name"
                    @click="canEdit && $emit('open-order-modal', p)"
                    title="點擊編輯醫囑"
                    :style="{ cursor: canEdit ? 'pointer' : 'default' }"
                  >
                    <strong>姓名:</strong> {{ p.name }}
                  </div>
                  <div class="info-item"><strong>病歷號:</strong> {{ p.medicalRecordNumber }}</div>
                </div>
                <div class="card-body">
                  <div
                    v-if="p.dialysisOrders?.mode === 'PP' || p.dialysisOrders?.mode === 'DFPP'"
                    class="order-details"
                  >
                    <div>
                      <strong>會診醫師:</strong> {{ p.dialysisOrders?.physician || '____' }}
                    </div>
                    <div><strong>透析模式:</strong> {{ p.dialysisOrders?.mode || '____' }}</div>
                    <div class="highlight-field">
                      <span>
                        <!-- ✨ 新增一個 span 來包裹內容 ✨ -->
                        <strong>血漿交換量:</strong>
                        {{
                          p.dialysisOrders?.exchangeVolume
                            ? p.dialysisOrders.exchangeVolume.toFixed(0) + ' ml'
                            : '____'
                        }}
                      </span>
                    </div>
                    <div class="highlight-field">
                      <span>
                        <!-- ✨ 新增一個 span 來包裹內容 ✨ -->
                        <strong>血液流速:</strong>
                        {{
                          p.dialysisOrders?.bloodFlow
                            ? p.dialysisOrders.bloodFlow + ' ml/min'
                            : '____'
                        }}
                      </span>
                    </div>
                    <div>
                      <strong>體重/Hct:</strong> {{ p.dialysisOrders?.bw || '____' }}kg /
                      {{ p.dialysisOrders?.hct || '____' }}%
                    </div>
                    <div><strong>Heparin:</strong> {{ p.dialysisOrders?.heparin || '____' }}</div>
                  </div>
                  <div v-else class="order-details">
                    <div>
                      <strong>會診醫師:</strong> {{ p.dialysisOrders?.physician || '____' }}
                    </div>
                    <div><strong>透析模式:</strong> {{ p.dialysisOrders?.mode || '____' }}</div>
                    <div><strong>頻次:</strong> {{ p.dialysisOrders?.freq || '____' }}</div>

                    <!-- 1. AK: 保留 highlight -->
                    <div class="highlight-field">
                      <span>
                        <!-- ✨ 新增一個 span 來包裹內容 ✨ -->
                        <strong>AK:</strong> {{ p.dialysisOrders?.ak || '____' }}
                      </span>
                    </div>

                    <!-- 2. 藥水: 保留 highlight -->
                    <div class="highlight-field">
                      <span>
                        <strong>藥水:</strong> {{ p.dialysisOrders?.dialysate || '____' }}
                      </span>
                    </div>

                    <!-- 3. 時間: 新增 highlight -->
                    <div class="highlight-field">
                      <span>
                        <strong>時間(hr):</strong> {{ p.dialysisOrders?.dialysisHours || '____' }}
                      </span>
                    </div>

                    <div>
                      <strong>Heparin:</strong> {{ p.dialysisOrders?.heparinRinse || '____' }} /
                      {{ p.dialysisOrders?.heparinLM || '____' }}
                    </div>
                    <div>
                      <strong>BF/DF:</strong> {{ p.dialysisOrders?.bloodFlow || '____' }} /
                      {{ p.dialysisOrders?.dialysateFlow || '____' }}
                    </div>

                    <!-- 4. 脫水量: 保留 highlight -->
                    <div class="highlight-field">
                      <span>
                        <strong>脫水量:</strong> {{ p.dialysisOrders?.dehydration || '____' }}
                      </span>
                    </div>

                    <!-- 5. Mannitol: 移除 highlight -->
                    <div><strong>Mannitol:</strong> {{ p.dialysisOrders?.mannitol || '____' }}</div>
                  </div>
                  <div class="notes-section">
                    <strong>備註：</strong>
                    <input
                      type="text"
                      class="notes-input"
                      v-model="localNotes[p.id]"
                      @input="updateLocalNote(p.id, $event.target.value)"
                      placeholder="點此輸入備註..."
                      :readonly="!canEdit"
                    />
                  </div>
                </div>
              </div>
            </div>
            <p v-else class="no-patients-text">午班無外圍病房病人</p>
          </div>

          <!-- 晚班 -->
          <div class="shift-group">
            <h4>晚班</h4>
            <div v-if="latePeripheralPatients.length > 0" class="patient-grid">
              <div v-for="p in latePeripheralPatients" :key="p.id" class="patient-order-card">
                <div class="patient-header">
                  <div class="info-item"><strong>床號:</strong> {{ p.wardNumber || '____' }}</div>
                  <div
                    class="info-item name"
                    @click="canEdit && $emit('open-order-modal', p)"
                    title="點擊編輯醫囑"
                    :style="{ cursor: canEdit ? 'pointer' : 'default' }"
                  >
                    <strong>姓名:</strong> {{ p.name }}
                  </div>
                  <div class="info-item"><strong>病歷號:</strong> {{ p.medicalRecordNumber }}</div>
                </div>
                <div class="card-body">
                  <div
                    v-if="p.dialysisOrders?.mode === 'PP' || p.dialysisOrders?.mode === 'DFPP'"
                    class="order-details"
                  >
                    <div>
                      <strong>會診醫師:</strong> {{ p.dialysisOrders?.physician || '____' }}
                    </div>
                    <div><strong>透析模式:</strong> {{ p.dialysisOrders?.mode || '____' }}</div>
                    <div class="highlight-field">
                      <span>
                        <strong>血漿交換量:</strong>
                        {{
                          p.dialysisOrders?.exchangeVolume
                            ? p.dialysisOrders.exchangeVolume.toFixed(0) + ' ml'
                            : '____'
                        }}
                      </span>
                    </div>
                    <div class="highlight-field">
                      <span>
                        <strong>血液流速:</strong>
                        {{
                          p.dialysisOrders?.bloodFlow
                            ? p.dialysisOrders.bloodFlow + ' ml/min'
                            : '____'
                        }}
                      </span>
                    </div>
                    <div>
                      <strong>體重/Hct:</strong> {{ p.dialysisOrders?.bw || '____' }}kg /
                      {{ p.dialysisOrders?.hct || '____' }}%
                    </div>
                    <div><strong>Heparin:</strong> {{ p.dialysisOrders?.heparin || '____' }}</div>
                  </div>
                  <div v-else class="order-details">
                    <div>
                      <strong>會診醫師:</strong> {{ p.dialysisOrders?.physician || '____' }}
                    </div>
                    <div><strong>透析模式:</strong> {{ p.dialysisOrders?.mode || '____' }}</div>
                    <div><strong>頻次:</strong> {{ p.dialysisOrders?.freq || '____' }}</div>

                    <!-- 1. AK: 保留 highlight -->
                    <div class="highlight-field">
                      <span> <strong>AK:</strong> {{ p.dialysisOrders?.ak || '____' }} </span>
                    </div>

                    <!-- 2. 藥水: 保留 highlight -->
                    <div class="highlight-field">
                      <span>
                        <strong>藥水:</strong> {{ p.dialysisOrders?.dialysate || '____' }}
                      </span>
                    </div>

                    <!-- 3. 時間: 新增 highlight -->
                    <div class="highlight-field">
                      <span>
                        <strong>時間(hr):</strong> {{ p.dialysisOrders?.dialysisHours || '____' }}
                      </span>
                    </div>

                    <div>
                      <strong>Heparin:</strong> {{ p.dialysisOrders?.heparinRinse || '____' }} /
                      {{ p.dialysisOrders?.heparinLM || '____' }}
                    </div>
                    <div>
                      <strong>BF/DF:</strong> {{ p.dialysisOrders?.bloodFlow || '____' }} /
                      {{ p.dialysisOrders?.dialysateFlow || '____' }}
                    </div>

                    <!-- 4. 脫水量: 保留 highlight -->
                    <div class="highlight-field">
                      <span>
                        <strong>脫水量:</strong> {{ p.dialysisOrders?.dehydration || '____' }}
                      </span>
                    </div>

                    <!-- 5. Mannitol: 移除 highlight -->
                    <div><strong>Mannitol:</strong> {{ p.dialysisOrders?.mannitol || '____' }}</div>
                  </div>
                  <div class="notes-section">
                    <strong>備註：</strong>
                    <input
                      type="text"
                      class="notes-input"
                      v-model="localNotes[p.id]"
                      @input="updateLocalNote(p.id, $event.target.value)"
                      placeholder="點此輸入備註..."
                      :readonly="!canEdit"
                    />
                  </div>
                </div>
              </div>
            </div>
            <p v-else class="no-patients-text">晚班無外圍病房病人</p>
          </div>
        </section>

        <!-- CRRT 區塊 -->
        <section class="order-section">
          <h3 class="section-title">CRRT 病人名單</h3>

          <!-- 桌面版表格 -->
          <div v-if="cvvhPatients.length > 0" class="crrt-container desktop-only">
            <div v-for="p in cvvhPatients" :key="p.id" class="crrt-patient-card">
              <table class="crrt-table">
                <thead>
                  <tr>
                    <th style="width: 80px">床號</th>
                    <th style="width: 100px">姓名</th>
                    <th style="width: 100px">病歷號</th>
                    <th style="width: 100px">會診醫師</th>
                    <th style="width: 100px">透析模式</th>
                    <th style="width: auto">
                      <div class="crrt-header-with-btn">
                        <span>CRRT 醫囑</span>
                        <button
                          v-if="canEdit"
                          class="btn-edit-crrt"
                          @click="$emit('open-crrt-order-modal', p)"
                          title="新增/修正 CRRT 醫囑"
                        >
                          <i class="fas fa-edit"></i> 新增/修正
                        </button>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{{ p.wardNumber || '____' }}</td>
                    <td>{{ p.name }}</td>
                    <td>{{ p.medicalRecordNumber }}</td>
                    <td>{{ p.physician || '____' }}</td>
                    <td>{{ p.mode || 'CVVHDF' }}</td>
                    <td class="crrt-orders-cell">
                      <div class="order-info" v-if="p.crrtOrders?.physician">
                        <span class="physician-info">
                          {{ p.crrtOrders.isModified ? '修正醫師' : '開立醫師' }}:
                          {{ p.crrtOrders.physician }}
                          <span v-if="p.crrtOrders?.timestamp" class="timestamp-info">
                            ({{ formatDateTime(p.crrtOrders.timestamp) }})</span
                          >
                        </span>
                      </div>
                      <div class="crrt-order-content">
                        <div class="crrt-order-item">
                          <span class="order-label">模式:</span><span>{{ getCRRTMode(p) }}</span>
                        </div>
                        <!-- ✨✨✨ 1. 新增血液流速顯示 ✨✨✨ -->
                        <div class="crrt-order-item">
                          <span class="order-label">血液流速:</span>
                          <span>{{
                            p.crrtOrders?.bloodFlow ? `${p.crrtOrders.bloodFlow} ml/min` : '____'
                          }}</span>
                        </div>
                        <div class="crrt-order-item">
                          <span class="order-label">PBP:</span
                          ><span>{{ p.crrtOrders?.pbp || '____' }}</span>
                        </div>
                        <div class="crrt-order-item">
                          <span class="order-label">透析液流速:</span
                          ><span>{{
                            p.crrtOrders?.dialysateFlowRate
                              ? `${p.crrtOrders.dialysateFlowRate} ml/hr`
                              : '____'
                          }}</span>
                        </div>
                        <div class="crrt-order-item">
                          <span class="order-label">補充液流速:</span
                          ><span>{{
                            p.crrtOrders?.replacementFlowRate
                              ? `${p.crrtOrders.replacementFlowRate} ml/hr`
                              : '____'
                          }}</span>
                        </div>
                        <div class="crrt-order-item">
                          <span class="order-label">前/後稀釋:</span
                          ><span>{{ p.crrtOrders?.dilutionRatio || '____' }}</span>
                        </div>
                        <div class="crrt-order-item">
                          <span class="order-label">Heparin:</span
                          ><span>{{ p.crrtOrders?.heparin || '____' }}</span>
                        </div>
                        <div class="crrt-order-item">
                          <span class="order-label">脫水速率:</span
                          ><span>{{ getDehydrationRateDisplay(p.crrtOrders) }}</span>
                        </div>
                        <div class="crrt-order-item">
                          <span class="order-label">是否加KCL:</span
                          ><span>{{ p.crrtOrders?.addKCL ? '是' : '否' }}</span>
                        </div>
                      </div>
                    </td>
                  </tr>
                  <tr class="emergency-row">
                    <td colspan="6">
                      <div class="emergency-content">
                        <span class="emergency-label">緊急時是否可撤：</span>
                        <div class="withdraw-options">
                          <label class="checkbox-label">
                            <input
                              type="radio"
                              v-model="crrtEmergencyData[p.id].withdraw"
                              value="yes"
                              :disabled="!canEdit"
                            />可
                          </label>
                          <label class="checkbox-label">
                            <input
                              type="radio"
                              v-model="crrtEmergencyData[p.id].withdraw"
                              value="no"
                              :disabled="!canEdit"
                            />否
                          </label>
                        </div>
                        <input
                          type="text"
                          class="withdraw-note"
                          v-model="crrtEmergencyData[p.id].note"
                          placeholder="備註..."
                          :readonly="!canEdit"
                        />
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- 行動版卡片 -->
          <div v-if="cvvhPatients.length > 0" class="crrt-cards-container mobile-only">
            <div v-for="p in cvvhPatients" :key="p.id" class="crrt-mobile-card">
              <div class="crrt-card-header">
                <div class="crrt-patient-info">
                  <div class="crrt-bed">床號: {{ p.wardNumber || '____' }}</div>
                  <div class="crrt-name">{{ p.name }}</div>
                  <div class="crrt-mrn">{{ p.medicalRecordNumber }}</div>
                </div>
                <button
                  v-if="canEdit"
                  class="btn-edit-crrt-mobile"
                  @click="$emit('open-crrt-order-modal', p)"
                  title="新增/修正 CRRT 醫囑"
                >
                  <i class="fas fa-edit"></i> 修正
                </button>
              </div>

              <div class="crrt-card-body">
                <div class="crrt-physician-info" v-if="p.crrtOrders?.physician">
                  <span class="physician-label">
                    {{ p.crrtOrders.isModified ? '修正醫師' : '開立醫師' }}:
                  </span>
                  <span>{{ p.crrtOrders.physician }}</span>
                  <span v-if="p.crrtOrders?.timestamp" class="timestamp">
                    ({{ formatDateTime(p.crrtOrders.timestamp) }})
                  </span>
                </div>
                <div class="crrt-params-grid">
                  <div class="param-item">
                    <span class="param-label">模式:</span>
                    <span class="param-value">{{ getCRRTMode(p) }}</span>
                  </div>
                  <!-- ✨✨✨ 2. 新增血液流速顯示 (行動版) ✨✨✨ -->
                  <div class="param-item">
                    <span class="param-label">血液流速:</span>
                    <span class="param-value">{{
                      p.crrtOrders?.bloodFlow ? `${p.crrtOrders.bloodFlow} ml/min` : '____'
                    }}</span>
                  </div>
                  <div class="param-item">
                    <span class="param-label">PBP:</span>
                    <span class="param-value">{{ p.crrtOrders?.pbp || '____' }}</span>
                  </div>
                  <div class="param-item">
                    <span class="param-label">透析液:</span>
                    <span class="param-value">
                      {{
                        p.crrtOrders?.dialysateFlowRate
                          ? `${p.crrtOrders.dialysateFlowRate} ml/hr`
                          : '____'
                      }}
                    </span>
                  </div>
                  <div class="param-item">
                    <span class="param-label">補充液:</span>
                    <span class="param-value">
                      {{
                        p.crrtOrders?.replacementFlowRate
                          ? `${p.crrtOrders.replacementFlowRate} ml/hr`
                          : '____'
                      }}
                    </span>
                  </div>
                  <div class="param-item">
                    <span class="param-label">稀釋:</span>
                    <span class="param-value">{{ p.crrtOrders?.dilutionRatio || '____' }}</span>
                  </div>
                  <div class="param-item">
                    <span class="param-label">Heparin:</span>
                    <span class="param-value">{{ p.crrtOrders?.heparin || '____' }}</span>
                  </div>
                  <div class="param-item highlight">
                    <span class="param-label">脫水速率:</span>
                    <span class="param-value">{{ getDehydrationRateDisplay(p.crrtOrders) }}</span>
                  </div>
                  <div class="param-item">
                    <span class="param-label">加KCL:</span>
                    <span class="param-value">{{ p.crrtOrders?.addKCL ? '是' : '否' }}</span>
                  </div>
                </div>
              </div>

              <div class="crrt-card-footer">
                <div class="emergency-section">
                  <span class="emergency-label">緊急時是否可撤：</span>
                  <div class="emergency-options">
                    <label class="radio-option">
                      <input
                        type="radio"
                        v-model="crrtEmergencyData[p.id].withdraw"
                        value="yes"
                        :disabled="!canEdit"
                      />
                      <span>可</span>
                    </label>
                    <label class="radio-option">
                      <input
                        type="radio"
                        v-model="crrtEmergencyData[p.id].withdraw"
                        value="no"
                        :disabled="!canEdit"
                      />
                      <span>否</span>
                    </label>
                  </div>
                </div>
                <input
                  type="text"
                  class="emergency-note"
                  v-model="crrtEmergencyData[p.id].note"
                  placeholder="備註..."
                  :readonly="!canEdit"
                />
              </div>
            </div>
          </div>

          <p v-else class="no-patients-text">本日無 CRRT 病患</p>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive, watch } from 'vue'
import { SHIFT_CODES } from '@/constants/scheduleConstants.js'
import { useAuth } from '@/composables/useAuth' // ✨ 1. 引入 useAuth
import { useRealtimeNotifications } from '@/composables/useRealtimeNotifications.js'
import { formatDateTimeToLocal, parseFirestoreTimestamp } from '@/utils/dateUtils'

const auth = useAuth() // ✨ 2. 實例化 auth
const { addLocalNotification } = useRealtimeNotifications()

const props = defineProps({
  isVisible: Boolean,
  targetDate: String,
  schedule: Object,
  patientMap: Map,
  // ✨ 3. 新增 isEditable prop，並設定預設值為 true
  isEditable: {
    type: Boolean,
    default: true,
  },
})

// ✨ 4. 建立一個 computed 屬性來結合 prop 和權限
const canEdit = computed(() => {
  return props.isEditable && auth.canEditClinicalNotesAndOrders.value
})

// ✨ 核心修改 2: 增加 'change-date' 到 emits 中 ✨
const emit = defineEmits([
  'close',
  'open-order-modal',
  'open-crrt-order-modal',
  'save-and-print',
  'change-date',
])
const closeDialog = () => emit('close')

// ✨ 核心修改 3: 新增一個方法來觸發事件 ✨
function navigateDate(days) {
  // 向父元件發出請求，要求變更日期
  emit('change-date', days)
}

const localNotes = reactive({})
const crrtEmergencyData = reactive({})

function updateLocalNote(patientId, value) {
  localNotes[patientId] = value
}

const handleSaveAndPrint = () => {
  // ✨ 5. 在處理函式中也加上權限檢查，作為雙重保險
  if (!canEdit.value) {
    alert('權限不足，無法儲存。')
    return
  }
  const payload = {
    notes: { ...localNotes },
    crrtEmergency: { ...crrtEmergencyData },
  }
  emit('save-and-print', payload, printContent)
}

const shifts = computed(() => [
  { name: 'early', displayName: '早班', patients: earlyPeripheralPatients.value },
  { name: 'noon', displayName: '午班', patients: noonPeripheralPatients.value },
  { name: 'late', displayName: '晚班', patients: latePeripheralPatients.value },
])

const getCRRTMode = (patient) => {
  if (patient.crrtOrders?.mode) return patient.crrtOrders.mode
  if (patient.mode === 'CVVHDF') return 'CVVHDF'
  if (patient.mode === 'CVVH') return 'CVVH'
  if (patient.mode === 'CVVHD') return 'CVVHD'
  return '____'
}

const getDehydrationRateDisplay = (crrtOrders) => {
  if (!crrtOrders) return '____'
  const lower = crrtOrders.dehydrationRateLower
  const upper = crrtOrders.dehydrationRateUpper
  if (typeof lower === 'number' || typeof upper === 'number') {
    const displayLower = typeof lower === 'number' ? lower : '____'
    const displayUpper = typeof upper === 'number' ? upper : '____'
    if (displayLower === displayUpper) return `${displayLower} ml/hr`
    return `${displayLower} - ${displayUpper} ml/hr`
  }
  if (typeof crrtOrders.dehydrationRate === 'number') {
    return `${crrtOrders.dehydrationRate} ml/hr`
  }
  return '____'
}

const formatDateTime = (timestamp) => {
  if (!timestamp) return ''
  const date = parseFirestoreTimestamp(timestamp)
  return formatDateTimeToLocal(date)
}

const updateEmergencyWithdraw = (patientId, value) => {
  console.log('Update emergency withdraw:', patientId, value)
}

const updateEmergencyNote = (patientId, value) => {
  console.log('Update emergency note:', patientId, value)
}

const allPeripheralPatients = computed(() => {
  if (!props.schedule || !props.patientMap) return []
  return Object.entries(props.schedule)
    .filter(([shiftId, slot]) => shiftId.startsWith('peripheral-') && slot?.patientId)
    .map(([shiftId, slot]) => {
      const patient = props.patientMap.get(slot.patientId)
      if (
        patient &&
        (patient.status === 'ipd' || patient.status === 'er') &&
        patient.mode !== 'CVVHDF'
      ) {
        return {
          ...patient,
          bedNum: `外圍 ${shiftId.split('-')[1]}`,
          shiftCode: shiftId.split('-')[2],
        }
      }
      return null
    })
    .filter(Boolean)
})

// 新增一個排序函式
const sortPatients = (patients) => {
  const dayOfWeek = new Date(props.targetDate).getDay()

  const getUnitOrder = (wardNumber) => {
    // ✨ 新增保護機制 ✨
    // 如果 wardNumber 不存在或是空字串，直接返回一個預設排序值
    if (!wardNumber || typeof wardNumber !== 'string') {
      return 99 // 返回一個較大的數字，使其排在最後
    }

    const unit = wardNumber.toUpperCase()
    // 週二、四、六
    if ([2, 4, 6].includes(dayOfWeek)) {
      if (unit.startsWith('ICUA')) return 1
      if (unit.startsWith('ICUB')) return 2
      if (unit.startsWith('RCC')) return 3
    }
    // 週一、三、五 (以及週日)
    else {
      if (unit.startsWith('ICUB')) return 1
      if (unit.startsWith('ICUA')) return 2
      if (unit.startsWith('RCC')) return 3
    }
    return 4 // 其他單位排在後面
  }

  return patients.sort((a, b) => {
    const unitOrderA = getUnitOrder(a.wardNumber)
    const unitOrderB = getUnitOrder(b.wardNumber)

    if (unitOrderA !== unitOrderB) {
      return unitOrderA - unitOrderB
    }

    // 若單位相同，則按床號數字排序 (也加上保護)
    const bedNumA = parseInt((a.wardNumber || '').replace(/[^0-9]/g, ''), 10) || 0
    const bedNumB = parseInt((b.wardNumber || '').replace(/[^0-9]/g, ''), 10) || 0
    return bedNumA - bedNumB
  })
}

const earlyPeripheralPatients = computed(() =>
  sortPatients(allPeripheralPatients.value.filter((p) => p.shiftCode === SHIFT_CODES.EARLY)),
)

const noonPeripheralPatients = computed(() =>
  sortPatients(allPeripheralPatients.value.filter((p) => p.shiftCode === SHIFT_CODES.NOON)),
)

const latePeripheralPatients = computed(() =>
  sortPatients(allPeripheralPatients.value.filter((p) => p.shiftCode === SHIFT_CODES.LATE)),
)

const cvvhPatients = computed(() => {
  if (!props.patientMap) return []
  return Array.from(props.patientMap.values()).filter((p) => p.mode === 'CVVHDF' && !p.isDeleted)
})

watch(
  () => props.isVisible,
  (newVal) => {
    if (newVal) {
      allPeripheralPatients.value.forEach((p) => {
        localNotes[p.id] = p.dialysisOrders?.icuNote || ''
      })
      cvvhPatients.value.forEach((p) => {
        crrtEmergencyData[p.id] = {
          withdraw: p.emergencyWithdraw || null,
          note: p.emergencyWithdrawNote || '',
        }
      })
    }
  },
  { immediate: true },
)

const printContent = () => {
  const printableArea = document.getElementById('icu-orders-printable-area')
  if (!printableArea) return

  // 1. 保存使用者輸入的最新值
  printableArea.querySelectorAll('input[type="text"]').forEach((input) => {
    input.setAttribute('value', input.value)
  })
  printableArea.querySelectorAll('input[type="radio"]:checked').forEach((radio) => {
    radio.setAttribute('checked', 'checked')
  })

  // 2. 獲取頁面上的所有樣式規則
  const styles = Array.from(document.styleSheets)
    .map((styleSheet) => {
      try {
        return Array.from(styleSheet.cssRules)
          .map((rule) => rule.cssText)
          .join('\n')
      } catch (e) {
        return ''
      }
    })
    .join('\n')

  // 3. 定義一個完整的、獨立的列印專用樣式表
  const printSpecificStyles = `
    /*
     * ===================================================================
     * === 列印專用樣式表 (已整合血液流速)
     * ===================================================================
     */

    /* --- 1. 頁面與基礎設定 --- */
    @page {
      size: A4;
      margin: 15mm 10mm;
    }

    body {
      position: static !important;
      height: auto !important;
      overflow: visible !important;
      display: block !important;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      font-size: 11pt !important; /* 稍微縮小字體以容納更多內容 */
      line-height: 1.5 !important;
      background-color: white !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }

    /* --- 2. 元素顯示/隱藏 --- */
    .modal-header, .btn-edit-crrt, .btn-edit-crrt-mobile {
      display: none !important;
    }
    .printable-header {
      display: block !important;
      text-align: center;
      font-size: 1.8rem;
      font-weight: bold;
      margin-bottom: 1.5rem;
      page-break-after: avoid;
    }

    /* --- 3. 病人卡片排版與分頁 --- */
    .patient-grid {
      display: block !important;
    }
    .patient-order-card {
      display: inline-block !important;
      width: 49% !important;
      margin-right: 2% !important;
      margin-bottom: 1rem !important;
      vertical-align: top !important;
      page-break-inside: avoid !important;
      break-inside: avoid !important;
      border: 1px solid #ccc !important;
    }
    .patient-order-card:nth-child(2n) {
      margin-right: 0 !important;
    }

    /* --- 4. 卡片內容樣式 --- */
    .patient-header {
      background-color: #f0f0f0 !important;
    }
    .patient-header .info-item, .patient-header .info-item.name, .order-details, .notes-input {
      font-size: 11pt !important;
    }

    .highlight-field {
      font-weight: bold !important;
      font-size: 11pt !important;
    }

    .highlight-field span {
      display: block;
      width: 100%;
      font-weight: bold !important;
      font-size: 11pt !important;
      color: #000 !important;
      background-color: #fffacd !important;
      border: 1px solid #fadf98 !important;
      border-radius: 4px !important;
      padding: 4px 6px !important;
      box-sizing: border-box;
    }

    /* --- 5. 區塊與分頁控制 --- */
    .section-title {
      font-size: 1.5rem !important;
      margin-top: 1.5rem !important;
      border-bottom: 2px solid #333 !important;
      page-break-after: avoid !important;
    }
    .shift-group, .crrt-patient-card {
      page-break-inside: avoid !important;
    }
    .shift-group h4 {
      font-size: 1.2rem !important;
      background-color: #f0f0f0 !important;
      border-left: 4px solid #999 !important;
      page-break-after: avoid !important;
    }
    .order-section + .section {
        break-before: page;
        page-break-before: always;
    }

    /* --- 6. CRRT 表格樣式 --- */
    .crrt-table th, .crrt-table td, .crrt-order-item {
      font-size: 10pt !important; /* CRRT 內容字體再小一點以容納三欄 */
    }

    /* ✨ 核心修改：CRRT 醫囑改為三欄式佈局，容納新增的血液流速 ✨ */
    .crrt-order-content {
      display: grid !important;
      grid-template-columns: repeat(3, 1fr) !important;
      gap: 0.4rem 0.8rem !important;
    }
  `

  // 4. 組合最終的 HTML
  const finalHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>列印醫囑單</title>
      <style>
        /* 先載入原始樣式 */
        ${styles}
        /* 再用列印專用樣式覆蓋 */
        ${printSpecificStyles}
      </style>
    </head>
    <body>
      ${printableArea.innerHTML}
    </body>
    </html>
  `

  // 5. 執行列印
  const printWindow = window.open('', '_blank')
  printWindow.document.write(finalHtml)
  printWindow.document.close()
  setTimeout(() => {
    printWindow.print()
    printWindow.close()
  }, 500)
}
</script>

<style scoped>
.btn-print:disabled {
  background-color: #6c757d;
  cursor: not-allowed;
}
.notes-input:read-only,
.withdraw-note:read-only {
  background-color: #e9ecef;
  cursor: not-allowed;
  border-color: #ced4da;
}
.withdraw-options input[type='radio']:disabled + span,
.withdraw-options input[type='radio']:disabled {
  cursor: not-allowed;
  color: #6c757d;
}
.info-item.name[style*='cursor: default'] {
  text-decoration: none;
  color: #212529; /* or any color you prefer for non-clickable text */
}

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
  background-color: #f8f9fa;
  width: 95%;
  max-width: 1200px;
  height: 90vh;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
}
.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid #dee2e6;
  flex-shrink: 0;
}
.modal-header h2 {
  margin: 0;
  font-size: 1.5rem;
}

.date-navigator {
  display: flex;
  align-items: center;
  gap: 1.5rem; /* 增加間距 */
  flex-grow: 1; /* 讓它佔據中間空間 */
  justify-content: center; /* 居中對齊 */
}

.date-navigator h2 {
  margin: 0;
  font-size: 1.5rem;
  white-space: nowrap; /* 防止標題換行 */
}

.nav-btn {
  background-color: #f8f9fa;
  border: 1px solid #dee2e6;
  padding: 0.5rem 1rem;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s;
}

.nav-btn:hover {
  background-color: #e2e6ea;
  border-color: #dae0e5;
}

/* 確保 header-actions 靠右 */
.header-actions {
  justify-self: flex-end; /* 如果 header 是 grid/flex，這可以幫助靠右 */
}

.btn-print {
  background-color: #17a2b8;
  color: white;
  border: none;
  padding: 0.5rem 1rem;
  border-radius: 5px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}
.btn-close {
  background: none;
  border: none;
  font-size: 2rem;
  font-weight: bold;
  cursor: pointer;
  color: #6c757d;
}
.modal-body {
  padding: 1.5rem;
  overflow-y: auto;
  flex-grow: 1;
}
.order-section {
  margin-bottom: 2rem;
}
.section-title {
  font-size: 1.3rem;
  margin-top: 0;
  margin-bottom: 1rem;
  padding-bottom: 0.5rem;
  border-bottom: 2px solid #007bff;
}
.shift-group {
  margin-bottom: 1.5rem;
}
.shift-group h4 {
  font-size: 1.1rem;
  margin-bottom: 1rem;
  color: #495057;
}
.patient-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
  gap: 1.2rem;
}
.patient-order-card {
  background-color: #fff;
  border: 1px solid #dee2e6;
  border-radius: 6px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  display: flex;
  flex-direction: column;
  page-break-inside: avoid;
}

.card-body {
  flex-grow: 1;
  display: flex;
  flex-direction: column;
}

.order-details {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.6rem 1rem;
  padding: 1rem;
  font-size: 1.05rem;
  line-height: 1.5;
  flex-grow: 1;
}

.notes-section {
  padding: 0.75rem 1rem;
  border-top: 1px solid #e9ecef;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background-color: #f8f9fa;
  margin-top: auto;
}

.notes-section strong {
  white-space: nowrap;
  color: #495057;
}

.notes-input {
  width: 100%;
  border: 1px solid transparent;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  background-color: #f8f9fa;
  transition: all 0.2s;
  color: #212529;
  font-size: 1rem;
}

.notes-input:placeholder-shown:hover {
  border-color: #ced4da;
  background-color: #fff;
}

.notes-input:not(:placeholder-shown) {
  border-color: #ced4da;
  background-color: #fff;
}

.notes-input:focus {
  outline: none;
  border-color: #80bdff;
  background-color: #fff;
  box-shadow: 0 0 0 0.2rem rgba(0, 123, 255, 0.25);
}

.notes-input::placeholder {
  color: #6c757d;
  font-style: italic;
}
.patient-header {
  display: flex;
  justify-content: space-between;
  background-color: #e9ecef;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid #dee2e6;
}
.patient-header .info-item {
  font-size: 1.05rem;
}
.patient-header .info-item.name {
  font-weight: bold;
  cursor: pointer;
  color: #0056b3;
  text-decoration: underline;
  font-size: 1.1rem;
}
.no-patients-text {
  color: #6c757d;
  font-style: italic;
}
.crrt-table {
  width: 100%;
  border-collapse: collapse;
  background-color: #fff;
}
.crrt-table th,
.crrt-table td {
  border: 1px solid #dee2e6;
  padding: 0.75rem;
  text-align: center;
  vertical-align: middle;
}
.crrt-table th {
  background-color: #e9ecef;
  font-weight: bold;
  font-size: 1rem;
}
.crrt-container {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}
.crrt-patient-card {
  background-color: #fff;
  border-radius: 6px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  overflow: hidden;
  page-break-inside: avoid;
}
.crrt-orders-cell {
  text-align: left !important;
  padding: 1rem !important;
}
.crrt-header-with-btn {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}
.crrt-header-with-btn span {
  white-space: nowrap;
}
.btn-edit-crrt {
  background-color: #007bff;
  color: white;
  border: none;
  padding: 0.3rem 0.6rem;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
  display: flex;
  align-items: center;
  gap: 0.3rem;
  transition: background-color 0.2s;
  white-space: nowrap;
}
.btn-edit-crrt:hover {
  background-color: #0056b3;
}
.order-info {
  font-size: 0.85rem;
  color: #6c757d;
  font-style: italic;
  margin-bottom: 0.75rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid #dee2e6;
}
.physician-info,
.timestamp-info {
  font-style: italic;
}

/* ✨ 核心修改：CRRT 醫囑內容改為三欄式，以適應新增的血液流速欄位 ✨ */
.crrt-order-content {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.5rem;
}

.crrt-order-item {
  display: flex;
  align-items: center;
  font-size: 0.95rem;
}
.order-label {
  font-weight: bold;
  margin-right: 0.5rem;
  color: #495057;
}
.emergency-row {
  background-color: #f8f9fa;
  border-top: 2px solid #dee2e6 !important;
}
.emergency-content {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  padding: 0.75rem 1rem;
}
.emergency-label {
  font-weight: bold;
  color: #495057;
  white-space: nowrap;
}
.withdraw-options {
  display: flex;
  gap: 1.5rem;
}
.checkbox-label {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  cursor: pointer;
  font-size: 0.95rem;
}
.checkbox-label input[type='checkbox'] {
  cursor: pointer;
  width: 18px;
  height: 18px;
}
.withdraw-note {
  flex: 1;
  padding: 0.3rem 0.5rem;
  border: 1px solid #ced4da;
  border-radius: 4px;
  font-size: 0.9rem;
  min-width: 300px;
}
.withdraw-note::placeholder {
  color: #adb5bd;
}
.highlight-field {
  color: #d32f2f;
  font-weight: bold;
  font-size: 1.1rem;
}
.printable-header {
  display: none;
}
.crrt-cards-container.mobile-only {
  display: none;
}

/* 列印樣式 */
@media print {
  /* === 基本重置 === */
  * {
    overflow: visible !important; /* 關鍵：允許內容溢出以便分頁 */
  }
  * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    color-adjust: exact !important;
  }

  html,
  body {
    height: auto !important;
    overflow: visible !important;
    margin: 0 !important;
    padding: 0 !important;
  }

  /* === 移除所有容器的高度限制 === */
  .modal-overlay {
    position: static !important;
    height: auto !important;
    min-height: auto !important;
    max-height: none !important;
    overflow: visible !important;
    display: block !important;
    background: none !important;
  }

  .modal-content {
    position: static !important;
    height: auto !important;
    min-height: auto !important;
    max-height: none !important;
    overflow: visible !important;
    display: block !important;
    width: 100% !important;
    max-width: none !important;
    box-shadow: none !important;
    border: none !important;
  }

  .modal-body {
    position: static !important;
    height: auto !important;
    min-height: auto !important;
    max-height: none !important;
    overflow: visible !important; /* 關鍵：必須是 visible */
    display: block !important;
    padding: 0 !important;
  }

  /* === 隱藏不需要列印的元素 === */
  .modal-header,
  .btn-edit-crrt,
  .btn-edit-crrt-mobile,
  .btn-close,
  .btn-print,
  .header-actions {
    display: none !important;
  }

  /* === 顯示列印標題 === */
  .printable-header {
    display: block !important;
    text-align: center;
    font-size: 1.8rem;
    margin-bottom: 2rem;
    color: black;
    page-break-after: avoid; /* 標題不要單獨在一頁 */
  }

  /* === 頁面設定 === */
  @page {
    size: A4;
    margin: 15mm 10mm; /* 上下15mm，左右10mm */
  }

  /* === 區塊分頁控制 === */
  .order-section {
    page-break-inside: avoid; /* 避免區塊內部分頁 */
    break-inside: avoid;
    margin-bottom: 1.5rem;
  }

  .section-title {
    page-break-after: avoid; /* 標題不要和內容分離 */
    break-after: avoid;
    margin-bottom: 1rem;
  }

  /* === 班別群組分頁控制 === */
  .shift-group {
    page-break-inside: avoid; /* 盡量保持班別完整 */
    break-inside: avoid;
    margin-bottom: 1.5rem;
  }

  .shift-group h4 {
    page-break-after: avoid; /* 班別標題不要和內容分離 */
    break-after: avoid;
    margin-bottom: 0.5rem;
  }

  /* === 病人卡片排版（HD/PP） === */
  .patient-grid {
    display: block !important;
    width: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
  }

  .patient-order-card {
    display: inline-block !important;
    width: 48% !important; /* 兩欄排版 */
    margin-right: 2% !important;
    margin-bottom: 1rem !important;
    vertical-align: top !important;
    page-break-inside: avoid !important; /* 關鍵：避免卡片被切斷 */
    break-inside: avoid !important;
    box-sizing: border-box !important;
    border: 1px solid #dee2e6 !important;
  }

  /* 每兩個卡片換行 */
  .patient-order-card:nth-child(2n) {
    margin-right: 0 !important;
  }

  /* === CRRT 表格分頁控制 === */
  .crrt-container {
    display: block !important;
  }

  .crrt-patient-card {
    page-break-inside: avoid !important; /* 避免 CRRT 表格被切斷 */
    break-inside: avoid !important;
    margin-bottom: 1.5rem !important;
    width: 100% !important;
  }

  .crrt-table {
    width: 100% !important;
    table-layout: fixed !important; /* 固定表格佈局 */
  }

  /* === CRRT 行動版隱藏 === */
  .crrt-cards-container.mobile-only {
    display: none !important;
  }

  /* === 強制分頁規則 === */
  /* 如果需要在特定位置強制分頁，可以使用以下類別 */
  .page-break-before {
    page-break-before: always !important;
    break-before: page !important;
  }

  .page-break-after {
    page-break-after: always !important;
    break-after: page !important;
  }

  /* === 文字和輸入框優化 === */
  input[type='text'],
  .notes-input,
  .withdraw-note,
  .emergency-note {
    border: 1px solid #dee2e6 !important;
    background-color: white !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }

  /* 確保輸入的值顯示 */
  input[type='text']:before {
    content: attr(value);
  }

  /* === 字體大小調整 === */
  body {
    font-size: 11pt !important; /* 稍微調小以容納更多內容 */
  }

  .patient-header .info-item {
    font-size: 10pt !important;
  }

  .order-details {
    font-size: 9.5pt !important;
  }

  .crrt-order-content {
    font-size: 9.5pt !important;
  }

  /* === 顏色調整（確保列印清晰） === */
  .highlight-field {
    background-color: #fffacd !important;
    border: 1px solid #ffd700 !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }

  .patient-header {
    background-color: #f0f0f0 !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }

  /* === 邊距和間距微調 === */
  .order-details {
    padding: 0.5rem !important;
    gap: 0.3rem !important;
  }

  .notes-section {
    padding: 0.4rem !important;
  }

  .emergency-content {
    padding: 0.5rem !important;
  }

  /* === No orphans/widows === */
  p,
  div,
  section {
    orphans: 3;
    widows: 3;
  }
}

/* 行動版響應式設計 */
@media screen and (max-width: 768px) {
  /* 基礎容器修正 */
  .modal-overlay {
    padding: 0;
    overflow: hidden;
  }

  .modal-content {
    width: 100%;
    height: 100vh;
    max-width: 100vw;
    border-radius: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .modal-header {
    flex-shrink: 0;
    padding: 0.75rem;
    position: sticky;
    top: 0;
    z-index: 100;
    background: white;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  }

  .modal-header h2 {
    font-size: 1.1rem;
  }

  .modal-body {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 0.75rem;
    max-width: 100%;
    box-sizing: border-box;
  }

  /* 區塊確保不超出 */
  .order-section,
  .shift-group,
  .patient-grid,
  .patient-order-card {
    max-width: 100%;
    box-sizing: border-box;
  }

  .section-title {
    font-size: 1.1rem;
    padding: 0.5rem;
    margin: 0 -0.5rem 0.75rem -0.5rem;
    background: white;
    position: sticky;
    top: 0;
    z-index: 50;
  }

  .shift-group h4 {
    font-size: 1rem;
    background: linear-gradient(90deg, #007bff, #0056b3);
    color: white;
    padding: 0.5rem 1rem;
    border-radius: 8px;
    margin-bottom: 0.75rem;
    box-shadow: 0 2px 4px rgba(0, 123, 255, 0.2);
  }

  /* HD/PP 病人卡片 */
  .patient-grid {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    width: 100%;
  }

  .patient-order-card {
    width: 100%;
    max-width: 100%;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
  }

  .patient-header {
    background: linear-gradient(135deg, #667eea, #764ba2);
    color: white;
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .patient-header .info-item {
    display: flex;
    justify-content: space-between;
    font-size: 0.85rem;
    color: white;
  }

  .patient-header .info-item.name {
    background: rgba(255, 255, 255, 0.2);
    padding: 0.4rem;
    border-radius: 6px;
    text-align: center;
    font-size: 1rem;
    font-weight: bold;
    text-decoration: none;
    color: white;
  }

  .card-body {
    background: white;
    padding: 0;
  }

  .order-details {
    padding: 0.75rem;
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.5rem;
  }

  .order-details > div {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem;
    background: #f8f9fa;
    border-radius: 4px;
    font-size: 0.85rem;
    word-break: break-word;
    overflow-wrap: break-word;
  }

  .order-details > div strong {
    flex-shrink: 0;
    margin-right: 0.5rem;
    color: #495057;
    font-size: 0.8rem;
    min-width: 60px;
  }

  .highlight-field {
    background: #fff3cd !important;
    border-left: 3px solid #ffc107;
    font-weight: bold;
    font-size: 0.9rem !important;
  }

  .notes-section {
    padding: 0.75rem;
    background: #f0f8ff;
    border-top: 1px solid #d1ecf1;
  }

  .notes-section strong {
    display: block;
    margin-bottom: 0.5rem;
    color: #0c5460;
    font-size: 0.85rem;
  }

  .notes-input {
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    padding: 0.5rem;
    border: 1px solid #bee5eb;
    border-radius: 4px;
    font-size: 0.85rem;
    resize: none;
    min-height: 50px;
    background: white;
  }

  /* CRRT 區塊 - 隱藏桌面版表格 */
  .crrt-container.desktop-only {
    display: none !important;
    page-break-inside: auto;
  }

  /* CRRT 行動版卡片顯示 */
  .crrt-cards-container.mobile-only {
    display: flex !important;
    flex-direction: column;
    gap: 1rem;
    width: 100%;
  }

  .crrt-mobile-card {
    background: white;
    border-radius: 8px;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
    overflow: hidden;
  }

  /* CRRT 卡片頭部 */
  .crrt-card-header {
    background: linear-gradient(135deg, #00acc1, #0097a7);
    color: white;
    padding: 0.75rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .crrt-patient-info {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .crrt-bed {
    font-size: 0.8rem;
    opacity: 0.9;
  }

  .crrt-name {
    font-size: 1.1rem;
    font-weight: bold;
  }

  .crrt-mrn {
    font-size: 0.85rem;
    opacity: 0.9;
  }

  .btn-edit-crrt-mobile {
    background: rgba(255, 255, 255, 0.2);
    color: white;
    border: 1px solid rgba(255, 255, 255, 0.3);
    padding: 0.4rem 0.6rem;
    border-radius: 4px;
    font-size: 0.8rem;
    display: flex;
    align-items: center;
    gap: 0.3rem;
    cursor: pointer;
  }

  .btn-edit-crrt-mobile:active {
    background: rgba(255, 255, 255, 0.3);
  }

  /* CRRT 醫囑內容 */
  .crrt-card-body {
    padding: 0.75rem;
    background: #f8f9fa;
  }

  .crrt-physician-info {
    background: white;
    padding: 0.5rem;
    border-radius: 4px;
    margin-bottom: 0.75rem;
    font-size: 0.85rem;
    color: #495057;
  }

  .physician-label {
    font-weight: 600;
  }

  .timestamp {
    color: #6c757d;
    font-size: 0.75rem;
  }

  /* CRRT 參數網格 */
  .crrt-params-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.5rem;
  }

  .param-item {
    background: white;
    padding: 0.5rem;
    border-radius: 4px;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .param-label {
    font-size: 0.75rem;
    color: #6c757d;
    font-weight: 500;
  }

  .param-value {
    font-size: 0.9rem;
    font-weight: 600;
    color: #212529;
  }

  /* 重要參數高亮 */
  .param-item.highlight {
    background: #fff3cd;
    border: 1px solid #ffeaa7;
  }

  /* CRRT 緊急撤離區 */
  .crrt-card-footer {
    padding: 0.75rem;
    background: #e3f2fd;
    border-top: 2px solid #90caf9;
  }

  .emergency-section {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .emergency-label {
    font-size: 0.85rem;
    font-weight: 600;
    color: #1565c0;
    white-space: nowrap;
  }

  .emergency-options {
    display: flex;
    gap: 1rem;
  }

  .radio-option {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    cursor: pointer;
  }

  .radio-option input[type='radio'] {
    width: 18px;
    height: 18px;
  }

  .radio-option span {
    font-size: 0.85rem;
  }

  .emergency-note {
    width: 100%;
    padding: 0.4rem;
    border: 1px solid #90caf9;
    border-radius: 4px;
    font-size: 0.85rem;
    background: white;
  }

  /* 按鈕優化 */
  .header-actions {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .btn-print {
    padding: 0.4rem 0.6rem;
    font-size: 0.8rem;
    white-space: nowrap;
  }

  .btn-close {
    width: 32px;
    height: 32px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* 無病人文字 */
  .no-patients-text {
    text-align: center;
    padding: 2rem 1rem;
    background: #f8f9fa;
    border-radius: 8px;
  }

  /* 防止任何元素超出容器 */
  * {
    max-width: 100%;
    box-sizing: border-box;
  }

  input,
  textarea,
  select {
    max-width: 100%;
    box-sizing: border-box;
  }

  .patient-name,
  .order-details div,
  .crrt-order-content {
    word-wrap: break-word;
    overflow-wrap: break-word;
    hyphens: auto;
  }
}

/* 超小螢幕優化 */
@media screen and (max-width: 400px) {
  .modal-body {
    padding: 0.5rem;
  }

  .patient-order-card,
  .crrt-mobile-card {
    border-radius: 6px;
  }

  .patient-header,
  .crrt-card-header {
    padding: 0.6rem;
  }

  .patient-header .info-item {
    font-size: 0.75rem;
  }

  .patient-header .info-item.name {
    font-size: 0.9rem;
  }

  .order-details {
    padding: 0.5rem;
    gap: 0.4rem;
  }

  .order-details > div {
    padding: 0.4rem;
    font-size: 0.8rem;
  }

  .order-details > div strong {
    font-size: 0.75rem;
    min-width: 50px;
  }

  .modal-header h2 {
    font-size: 1rem;
  }

  .section-title {
    font-size: 0.95rem;
  }

  .shift-group h4 {
    font-size: 0.9rem;
    padding: 0.4rem 0.6rem;
    /* 讓整個班別群組盡量完整，避免標題在新的一頁，但內容卻很少 */
    page-break-before: auto;
    page-break-inside: avoid;
  }

  /* CRRT 參數單欄顯示 */
  .crrt-params-grid {
    grid-template-columns: 1fr;
  }

  .crrt-card-header {
    flex-direction: column;
    gap: 0.5rem;
    align-items: stretch;
  }

  .btn-edit-crrt-mobile {
    width: 100%;
    justify-content: center;
  }
}
</style>
