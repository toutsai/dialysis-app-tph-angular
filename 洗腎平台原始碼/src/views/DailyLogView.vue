<!-- 檔案路徑: src/views/DailyLogView.vue -->
<template>
  <div class="log-page-container" id="pdf-export-area">
    <div v-if="isLoading" class="loading-overlay">
      <div class="loading-spinner"></div>
      <p>正在載入 {{ selectedDate }} 的日誌與排班資料...</p>
    </div>

    <header class="log-page-header">
      <div class="header-left">
        <h1>工作日誌</h1>

        <div class="date-navigator">
          <button @click="changeDate(-1)">❮ 上一日</button>

          <div class="date-display-wrapper">
            <input type="date" v-model="selectedDate" class="hidden-date-input" />
            <span class="current-date-text" @click="triggerDateInput">{{
              selectedDateDisplay
            }}</span>
            <span class="weekday-display">{{ weekdayDisplay }}</span>
          </div>

          <button @click="changeDate(1)">下一日 ❯</button>
          <button @click="goToToday">今日</button>
        </div>
        <!-- 只有非鎖定狀態(Editor/Admin)才能點擊 -->
        <button
          class="btn btn-handover"
          @click="isHandoverDialogVisible = true"
          :disabled="isPageLocked"
        >
          <i class="fas fa-clipboard-list"></i> 組長交班
        </button>
        <button
          class="btn btn-marquee-settings"
          @click="isMarqueeDialogVisible = true"
          :disabled="isPageLocked"
        >
          <i class="fas fa-bullhorn"></i> 公告設定
        </button>
      </div>
      <div class="header-right">
        <!-- 如果是 Viewer，狀態文字可以稍微調整，或保持原樣 -->
        <span class="status-indicator">{{ statusText }}</span>
        <!-- 匯出 PDF 是 Viewer 唯一可以做的操作，保持開啟 -->
        <button @click="exportToPDF" class="export-pdf-btn" :disabled="isLoading">匯出 PDF</button>
      </div>
    </header>

    <main class="log-page-main">
      <!-- ================================== -->
      <!-- ✨ 桌面版容器 ✨ -->
      <!-- ================================== -->
      <div class="desktop-only">
        <!-- 營運統計 -->
        <section class="log-section">
          <div class="section-header">
            <h2>營運統計</h2>
          </div>

          <div class="stats-grid">
            <!-- Grid Headers -->
            <div class="grid-header cell-item">項目</div>
            <div class="grid-header cell-category">班別</div>
            <div class="grid-header cell-shift">第一班 (7-12)</div>
            <div class="grid-header cell-shift">第二班 (12-3)</div>
            <div class="grid-header cell-shift">第三班 (3-11)</div>
            <div class="grid-header cell-total">合計</div>

            <!-- 洗腎中心床位 (唯讀數據，保持原樣) -->
            <div class="cell-item rowspan-4">洗腎中心床位 (限44床)</div>
            <div class="cell-category">門診</div>
            <div class="cell-data">{{ dailyLog.stats.main_beds.early.opd }}</div>
            <div class="cell-data">{{ dailyLog.stats.main_beds.noon.opd }}</div>
            <div class="cell-data">{{ dailyLog.stats.main_beds.late.opd }}</div>
            <div class="cell-total">
              {{
                (dailyLog.stats.main_beds.early.opd || 0) +
                (dailyLog.stats.main_beds.noon.opd || 0) +
                (dailyLog.stats.main_beds.late.opd || 0)
              }}
            </div>

            <div class="cell-category">住院</div>
            <div class="cell-data">{{ dailyLog.stats.main_beds.early.ipd }}</div>
            <div class="cell-data">{{ dailyLog.stats.main_beds.noon.ipd }}</div>
            <div class="cell-data">{{ dailyLog.stats.main_beds.late.ipd }}</div>
            <div class="cell-total">
              {{
                (dailyLog.stats.main_beds.early.ipd || 0) +
                (dailyLog.stats.main_beds.noon.ipd || 0) +
                (dailyLog.stats.main_beds.late.ipd || 0)
              }}
            </div>

            <div class="cell-category">急診</div>
            <div class="cell-data">{{ dailyLog.stats.main_beds.early.er }}</div>
            <div class="cell-data">{{ dailyLog.stats.main_beds.noon.er }}</div>
            <div class="cell-data">{{ dailyLog.stats.main_beds.late.er }}</div>
            <div class="cell-total">
              {{
                (dailyLog.stats.main_beds.early.er || 0) +
                (dailyLog.stats.main_beds.noon.er || 0) +
                (dailyLog.stats.main_beds.late.er || 0)
              }}
            </div>

            <div class="cell-category">HDR開床數 (A)</div>
            <div class="cell-data total-a">{{ dailyLog.stats.main_beds.early.total }}</div>
            <div class="cell-data total-a">{{ dailyLog.stats.main_beds.noon.total }}</div>
            <div class="cell-data total-a">{{ dailyLog.stats.main_beds.late.total }}</div>
            <div class="cell-total total-a">
              {{
                (dailyLog.stats.main_beds.early.total || 0) +
                (dailyLog.stats.main_beds.noon.total || 0) +
                (dailyLog.stats.main_beds.late.total || 0)
              }}
            </div>

            <!-- 急重症床位 (唯讀數據) -->
            <div class="cell-item rowspan-2">急重症 (外圍)</div>
            <div class="cell-category">加護病房+RCC (B)</div>
            <div class="cell-data">{{ dailyLog.stats.peripheral_beds.early.ipd }}</div>
            <div class="cell-data">{{ dailyLog.stats.peripheral_beds.noon.ipd }}</div>
            <div class="cell-data">{{ dailyLog.stats.peripheral_beds.late.ipd }}</div>
            <div class="cell-total">
              {{
                (dailyLog.stats.peripheral_beds.early.ipd || 0) +
                (dailyLog.stats.peripheral_beds.noon.ipd || 0) +
                (dailyLog.stats.peripheral_beds.late.ipd || 0)
              }}
            </div>

            <div class="cell-category">急診 (C)</div>
            <div class="cell-data">{{ dailyLog.stats.peripheral_beds.early.er }}</div>
            <div class="cell-data">{{ dailyLog.stats.peripheral_beds.noon.er }}</div>
            <div class="cell-data">{{ dailyLog.stats.peripheral_beds.late.er }}</div>
            <div class="cell-total">
              {{
                (dailyLog.stats.peripheral_beds.early.er || 0) +
                (dailyLog.stats.peripheral_beds.noon.er || 0) +
                (dailyLog.stats.peripheral_beds.late.er || 0)
              }}
            </div>

            <!-- 總人次 -->
            <div class="cell-item">總人次</div>
            <div class="cell-category">(A)+(B)+(C)</div>
            <div class="cell-data total-final">{{ totalPatients.early }}</div>
            <div class="cell-data total-final">{{ totalPatients.noon }}</div>
            <div class="cell-data total-final">{{ totalPatients.late }}</div>
            <div class="cell-total total-final">
              {{ totalPatients.early + totalPatients.noon + totalPatients.late }}
            </div>

            <!-- 病人照護 (需要鎖定輸入框) -->
            <div class="cell-item rowspan-3">病人照護</div>
            <div class="cell-category">ON D/L 病患</div>
            <!-- ✨ 修改：加入 disabled -->
            <div class="cell-input">
              <input
                type="text"
                v-model="dailyLog.stats.patient_care.onDL.early"
                :disabled="isPageLocked"
              />
            </div>
            <div class="cell-input">
              <input
                type="text"
                v-model="dailyLog.stats.patient_care.onDL.noon"
                :disabled="isPageLocked"
              />
            </div>
            <div class="cell-input">
              <input
                type="text"
                v-model="dailyLog.stats.patient_care.onDL.late"
                :disabled="isPageLocked"
              />
            </div>
            <div class="cell-total">-</div>

            <div class="cell-category">AK 凝固更換病患</div>
            <div class="cell-input">
              <input
                type="text"
                v-model="dailyLog.stats.patient_care.akChange.early"
                :disabled="isPageLocked"
              />
            </div>
            <div class="cell-input">
              <input
                type="text"
                v-model="dailyLog.stats.patient_care.akChange.noon"
                :disabled="isPageLocked"
              />
            </div>
            <div class="cell-input">
              <input
                type="text"
                v-model="dailyLog.stats.patient_care.akChange.late"
                :disabled="isPageLocked"
              />
            </div>
            <div class="cell-total">-</div>

            <div class="cell-category">預約未到病患</div>
            <div class="cell-input">
              <input
                type="text"
                v-model="dailyLog.stats.patient_care.noShow.early"
                :disabled="isPageLocked"
              />
            </div>
            <div class="cell-input">
              <input
                type="text"
                v-model="dailyLog.stats.patient_care.noShow.noon"
                :disabled="isPageLocked"
              />
            </div>
            <div class="cell-input">
              <input
                type="text"
                v-model="dailyLog.stats.patient_care.noShow.late"
                :disabled="isPageLocked"
              />
            </div>
            <div class="cell-total">-</div>

            <!-- 護理人力總計列 -->
            <div class="cell-item">護理人力</div>
            <div class="cell-category">
              <button @click="toggleStaffingDetails" class="toggle-details-btn">
                {{ isStaffingDetailsVisible ? '收合計' : '展開計算' }}
                <i
                  class="fas"
                  :class="isStaffingDetailsVisible ? 'fa-chevron-up' : 'fa-chevron-down'"
                ></i>
              </button>
            </div>
            <div class="cell-data total-final">{{ calculatedStaffingTotals.early.toFixed(3) }}</div>
            <div class="cell-data total-final">{{ calculatedStaffingTotals.noon.toFixed(3) }}</div>
            <div class="cell-data total-final">{{ calculatedStaffingTotals.late.toFixed(3) }}</div>
            <div class="cell-total total-final">
              {{ calculatedStaffingTotals.total.toFixed(3) }}
            </div>

            <!-- 護理人力計算明細 (條件渲染) -->
            <template v-if="isStaffingDetailsVisible">
              <!-- 子標題列 -->
              <div class="cell-item nested-header"></div>
              <div class="cell-category nested-header label-count-header">
                <span>班別</span>
                <span>人數</span>
              </div>
              <div class="nested-header">第一班 比例</div>
              <div class="nested-header">第二班 比例</div>
              <div class="nested-header">第三班 比例</div>
              <div class="nested-header">操作</div>

              <!-- 明細項目 v-for -->
              <template v-for="(item, index) in dailyLog.stats.staffing.details" :key="item.id">
                <div class="cell-item nested-item"></div>
                <div class="cell-category nested-item label-count-cell">
                  <!-- ✨ 修改：加入 disabled -->
                  <input
                    type="text"
                    v-model="item.label"
                    placeholder="項目名稱"
                    class="label-input"
                    :disabled="isPageLocked"
                  />
                  <input
                    type="number"
                    min="0"
                    v-model.number="item.count"
                    class="count-input"
                    :disabled="isPageLocked"
                  />
                </div>
                <div class="cell-input nested-item">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    v-model.number="item.ratio1"
                    :disabled="isPageLocked || item.isLocked"
                  />
                </div>
                <div class="cell-input nested-item">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    v-model.number="item.ratio2"
                    :disabled="isPageLocked || item.isLocked"
                  />
                </div>
                <div class="cell-input nested-item">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    v-model.number="item.ratio3"
                    :disabled="isPageLocked || item.isLocked"
                  />
                </div>
                <div class="cell-input nested-item action-cell">
                  <!-- ✨ 修改：隱藏移除按鈕 -->
                  <button
                    v-if="!isPageLocked"
                    @click="deleteStaffingRow(index)"
                    class="delete-btn mini"
                  >
                    移除
                  </button>
                </div>
              </template>

              <!-- 調整時數行 -->
              <div class="cell-item nested-item deduction-row"></div>
              <div class="cell-category nested-item deduction-row">
                調整時數 (加班+/早退-)[會自動幫忙乘0.125]
              </div>
              <div class="cell-input nested-item deduction-row">
                <input
                  type="number"
                  step="0.01"
                  v-model.number="dailyLog.stats.staffing.adjustments.shift1"
                  placeholder="例: +2 或 -1.5小時"
                  :disabled="isPageLocked"
                />
              </div>
              <div class="cell-input nested-item deduction-row">
                <input
                  type="number"
                  step="0.01"
                  v-model.number="dailyLog.stats.staffing.adjustments.shift2"
                  placeholder="例: +2 或 -1.5小時"
                  :disabled="isPageLocked"
                />
              </div>
              <div class="cell-input nested-item deduction-row">
                <input
                  type="number"
                  step="0.01"
                  v-model.number="dailyLog.stats.staffing.adjustments.shift3"
                  placeholder="例: +2 或 -1.5小時"
                  :disabled="isPageLocked"
                />
              </div>
              <div class="cell-input nested-item deduction-row"></div>

              <!-- 新增按鈕行 -->
              <div class="cell-item nested-item"></div>
              <div class="add-row-cell">
                <!-- ✨ 修改：隱藏新增按鈕 -->
                <button v-if="!isPageLocked" @click="addStaffingRow" class="add-row-btn-header">
                  新增計算項目
                </button>
              </div>
            </template>

            <!-- 護病比 -->
            <div class="cell-item">護病比</div>
            <div class="cell-category">總人次 / 護理人力</div>
            <div class="cell-data">{{ nursePatientRatios.early }}</div>
            <div class="cell-data">{{ nursePatientRatios.noon }}</div>
            <div class="cell-data">{{ nursePatientRatios.late }}</div>
            <div class="cell-total">{{ nursePatientRatios.total }}</div>
          </div>
        </section>

        <!-- 病人動態表 -->
        <section class="log-section">
          <div class="section-header">
            <h2>病人動態表</h2>
            <!-- ✨ 修改：隱藏新增按鈕 -->
            <button
              v-if="!isPageLocked"
              @click="addRow('patientMovements')"
              class="add-row-btn-header"
            >
              新增手動動態
            </button>
          </div>
          <div v-if="dailyLog.patientMovements.length > 0" class="dynamic-table-container">
            <table class="dynamic-table">
              <thead>
                <tr>
                  <th class="col-type">類型</th>
                  <th class="col-name">姓名</th>
                  <th class="col-mrn">病歷號</th>
                  <th class="col-bed">床號</th>
                  <th class="col-date">住院日</th>
                  <th class="col-date">出院日</th>
                  <th class="col-physician">會診醫師</th>
                  <th class="col-reason-wide">住院原因</th>
                  <th class="col-remarks-wide">備註</th>
                  <th class="col-actions">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(item, index) in dailyLog.patientMovements"
                  :key="item.id"
                  :class="{ 'is-edited-row': isRowInEditMode(item) }"
                >
                  <td class="col-type">
                    <select v-if="isRowInEditMode(item)" v-model="item.type" class="type-select">
                      <option value="手動">手動</option>
                      <option value="首透">首透</option>
                      <option value="暫停透析">暫停透析</option>
                      <option value="刪除排程">刪除排程</option>
                      <option value="更改模式">更改模式</option>
                      <option value="更改頻率">更改頻率</option>
                      <option value="轉常規門診">轉常規門診</option>
                      <option value="其他">其他</option>
                    </select>
                    <span
                      v-else
                      :class="['movement-type-badge', `type-${normalizeMovementType(item.type)}`]"
                    >
                      {{ normalizeMovementType(item.type) }}
                    </span>
                  </td>
                  <td class="col-name">
                    <div class="autocomplete-wrapper">
                      <input
                        type="text"
                        :ref="(el) => (inputRefs[`movements-${index}`] = el)"
                        v-model="item.name"
                        :disabled="!isRowInEditMode(item)"
                        @input="handlePatientSearch(index, 'movements')"
                        @focus="showAutocomplete($event, index, 'movements')"
                        @blur="hideAutocomplete"
                        placeholder="搜尋病人..."
                      />
                    </div>
                  </td>
                  <td class="col-mrn">
                    <input
                      type="text"
                      v-model="item.medicalRecordNumber"
                      :disabled="!isRowInEditMode(item)"
                    />
                  </td>
                  <td class="col-bed">
                    <div
                      class="bed-change-cell"
                      :class="{
                        'is-clickable':
                          isRowInEditMode(item) &&
                          ['ipd', 'er'].includes(patientMap.get(item.patientId)?.status),
                      }"
                      @click="isRowInEditMode(item) && promptWardNumber(index)"
                    >
                      {{
                        patientMap.get(item.patientId)?.wardNumber ||
                        (isRowInEditMode(item) ? '點擊設定' : '-')
                      }}
                    </div>
                  </td>
                  <td class="col-date">
                    <input
                      type="date"
                      v-model="item.admissionDate"
                      :disabled="!isRowInEditMode(item)"
                    />
                  </td>
                  <td class="col-date">
                    <input
                      type="date"
                      v-model="item.dischargeDate"
                      :disabled="!isRowInEditMode(item)"
                    />
                  </td>
                  <td class="col-physician">
                    <input
                      type="text"
                      v-model="item.physician"
                      :disabled="!isRowInEditMode(item)"
                    />
                  </td>
                  <td class="col-reason-wide">
                    <textarea
                      v-if="isRowInEditMode(item)"
                      v-model="item.reason"
                      rows="2"
                      class="wrap-textarea"
                    ></textarea>
                    <span v-else class="wrap-text">{{ item.reason || '' }}</span>
                  </td>
                  <td class="col-remarks-wide">
                    <textarea
                      v-if="isRowInEditMode(item)"
                      v-model="item.remarks"
                      rows="2"
                      class="wrap-textarea"
                    ></textarea>
                    <span v-else class="wrap-text">{{ item.remarks || '' }}</span>
                  </td>
                  <td class="col-actions">
                    <!-- ✨ 修改：隱藏編輯/儲存按鈕 -->
                    <button
                      v-if="!isRowInEditMode(item) && !isPageLocked"
                      @click="unlockMovement(item)"
                      class="edit-btn"
                    >
                      編輯
                    </button>
                    <div v-else-if="isRowInEditMode(item)" class="action-buttons-group">
                      <button @click="saveMovement(item)" class="save-btn">儲存</button>
                      <button @click="deleteRow(index, 'patientMovements')" class="delete-btn">
                        移除
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- 血管通路阻塞 -->
        <section class="log-section">
          <div class="section-header">
            <h2>血管通路阻塞</h2>
            <!-- ✨ 修改：隱藏新增按鈕 -->
            <button
              v-if="!isPageLocked"
              @click="addRow('vascularAccessLog')"
              class="add-row-btn-header"
            >
              新增處置
            </button>
          </div>
          <div v-if="dailyLog.vascularAccessLog.length > 0" class="dynamic-table-container">
            <table class="dynamic-table">
              <thead>
                <tr>
                  <th class="col-name">姓名</th>
                  <th class="col-mrn">病歷號</th>
                  <th class="col-date">日期</th>
                  <th class="col-interventions-wide">處置</th>
                  <th class="col-location">處置院所</th>
                  <th class="col-actions">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(item, index) in dailyLog.vascularAccessLog" :key="item.id">
                  <td class="col-name">
                    <div class="autocomplete-wrapper">
                      <!-- ✨ 修改：disabled -->
                      <input
                        type="text"
                        :ref="(el) => (inputRefs[`vascular-${index}`] = el)"
                        v-model="item.name"
                        @input="handlePatientSearch(index, 'vascular')"
                        @focus="showAutocomplete($event, index, 'vascular')"
                        @blur="hideAutocomplete"
                        placeholder="搜尋病人..."
                        :disabled="isPageLocked"
                      />
                    </div>
                  </td>
                  <!-- ✨ 修改：disabled -->
                  <td class="col-mrn">
                    <input
                      type="text"
                      v-model="item.medicalRecordNumber"
                      :disabled="isPageLocked"
                    />
                  </td>
                  <td class="col-date">
                    <input type="date" v-model="item.date" :disabled="isPageLocked" />
                  </td>
                  <td class="col-interventions-wide">
                    <div class="checkbox-group">
                      <label
                        ><input
                          type="checkbox"
                          value="PTA"
                          v-model="item.interventions"
                          :disabled="isPageLocked"
                        />PTA</label
                      >
                      <label
                        ><input
                          type="checkbox"
                          value="新建"
                          v-model="item.interventions"
                          :disabled="isPageLocked"
                        />新建</label
                      >
                      <label
                        ><input
                          type="checkbox"
                          value="重建"
                          v-model="item.interventions"
                          :disabled="isPageLocked"
                        />重建</label
                      >
                      <label
                        ><input
                          type="checkbox"
                          value="清血塊"
                          v-model="item.interventions"
                          :disabled="isPageLocked"
                        />清血塊</label
                      >
                      <label
                        ><input
                          type="checkbox"
                          value="PERM-Cath"
                          v-model="item.interventions"
                          :disabled="isPageLocked"
                        />PERM-Cath</label
                      >
                      <label
                        ><input
                          type="checkbox"
                          value="例行返診"
                          v-model="item.interventions"
                          :disabled="isPageLocked"
                        />例行返診</label
                      >
                    </div>
                  </td>
                  <td class="col-location">
                    <input type="text" v-model="item.location" :disabled="isPageLocked" />
                  </td>
                  <td class="col-actions">
                    <!-- ✨ 修改：隱藏移除按鈕 -->
                    <button
                      v-if="!isPageLocked"
                      @click="deleteRow(index, 'vascularAccessLog')"
                      class="delete-btn"
                    >
                      移除
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- 其他事項 -->
        <section class="log-section">
          <h2>其他事項</h2>
          <div class="autoresize-textarea-wrapper">
            <!-- ✨ 修改：disabled -->
            <textarea
              v-model="dailyLog.otherNotes"
              ref="otherNotesTextarea"
              class="handover-textarea"
              rows="1"
              placeholder="請輸入其他事項..."
              @input="handleTextareaInput"
              :disabled="isPageLocked"
            ></textarea>
            <div class="notes-display-for-pdf">{{ dailyLog.otherNotes }}</div>
          </div>
        </section>

        <!-- 簽核 -->
        <footer class="log-page-footer">
          <div class="leader-signature-grid">
            <div class="leader-title">組長簽核</div>
            <div class="signature-slot">
              <span class="shift-label">第一班：</span>
              <div v-if="dailyLog.leader?.early?.name" class="signature-display">
                <div class="signature-info">
                  <span class="leader-name leader-stamp">{{ dailyLog.leader.early.name }}</span>
                  <span class="signature-time">{{
                    formatSignTime(dailyLog.leader.early.signedAt)
                  }}</span>
                </div>
                <!-- ✨ 修改：隱藏操作按鈕 -->
                <div class="signature-actions" v-if="!isPageLocked">
                  <button
                    @click="signAsLeader('early')"
                    class="action-text-btn edit-btn"
                    title="修正或更新簽核"
                  >
                    <i class="fas fa-pen"></i>
                    <span class="btn-text">修正</span>
                  </button>
                  <button
                    @click="unsignLeader('early')"
                    class="action-text-btn unsign-btn"
                    title="撤銷簽核"
                  >
                    <i class="fas fa-undo-alt"></i>
                    <span class="btn-text">撤銷</span>
                  </button>
                </div>
              </div>
              <!-- ✨ 修改：隱藏簽核按鈕 -->
              <button v-else-if="!isPageLocked" @click="signAsLeader('early')" class="sign-btn">
                <i class="fas fa-signature"></i>
                <span class="btn-text">簽核</span>
              </button>
            </div>
            <div class="signature-slot">
              <span class="shift-label">第二班：</span>
              <div v-if="dailyLog.leader?.noon?.name" class="signature-display">
                <div class="signature-info">
                  <span class="leader-name leader-stamp">{{ dailyLog.leader.noon.name }}</span>
                  <span class="signature-time">{{
                    formatSignTime(dailyLog.leader.noon.signedAt)
                  }}</span>
                </div>
                <div class="signature-actions" v-if="!isPageLocked">
                  <button
                    @click="signAsLeader('noon')"
                    class="action-text-btn edit-btn"
                    title="修正或更新簽核"
                  >
                    <i class="fas fa-pen"></i>
                    <span class="btn-text">修正</span>
                  </button>
                  <button
                    @click="unsignLeader('noon')"
                    class="action-text-btn unsign-btn"
                    title="撤銷簽核"
                  >
                    <i class="fas fa-undo-alt"></i>
                    <span class="btn-text">撤銷</span>
                  </button>
                </div>
              </div>
              <button v-else-if="!isPageLocked" @click="signAsLeader('noon')" class="sign-btn">
                <i class="fas fa-signature"></i>
                <span class="btn-text">簽核</span>
              </button>
            </div>
            <div class="signature-slot">
              <span class="shift-label">第三班：</span>
              <div v-if="dailyLog.leader?.late?.name" class="signature-display">
                <span class="leader-name leader-stamp">{{ dailyLog.leader.late.name }}</span>
                <span class="signature-time">{{
                  formatSignTime(dailyLog.leader.late.signedAt)
                }}</span>
                <div class="signature-actions" v-if="!isPageLocked">
                  <button
                    @click="signAsLeader('late')"
                    class="action-text-btn edit-btn"
                    title="修正或更新簽核"
                  >
                    <i class="fas fa-pen"></i>
                    <span class="btn-text">修正</span>
                  </button>
                  <button
                    @click="unsignLeader('late')"
                    class="action-text-btn unsign-btn"
                    title="撤銷簽核"
                  >
                    <i class="fas fa-undo-alt"></i>
                    <span class="btn-text">撤銷</span>
                  </button>
                </div>
              </div>
              <button v-else-if="!isPageLocked" @click="signAsLeader('late')" class="sign-btn">
                <i class="fas fa-signature"></i>
                <span class="btn-text">簽核</span>
              </button>
            </div>
          </div>
        </footer>
      </div>

      <!-- ================================== -->
      <!-- ✨ 全新的行動版容器 ✨ -->
      <!-- ================================== -->
      <div class="mobile-only">
        <!-- (行動版內容多為純文字顯示，本身就是唯讀的，不需要大量修改，保持原樣即可) -->
        <!-- 行動版：營運統計 -->
        <div class="mobile-section-card">
          <h2 class="mobile-section-title">營運統計</h2>
          <div class="mobile-stats-container">
            <!-- ... (保持不變) ... -->
            <!-- 總人次 -->
            <div class="stat-highlight-card">
              <div class="stat-value">
                {{ totalPatients.early + totalPatients.noon + totalPatients.late }}
              </div>
              <div class="stat-label">總人次</div>
            </div>
            <!-- HDR 開床數 -->
            <div class="stat-card">
              <div class="stat-value">
                {{
                  dailyLog.stats.main_beds.early.total +
                  dailyLog.stats.main_beds.noon.total +
                  dailyLog.stats.main_beds.late.total
                }}
              </div>
              <div class="stat-label">HDR開床數 (A)</div>
            </div>
            <!-- 加護病房+RCC -->
            <div class="stat-card">
              <div class="stat-value">
                {{
                  dailyLog.stats.peripheral_beds.early.ipd +
                  dailyLog.stats.peripheral_beds.noon.ipd +
                  dailyLog.stats.peripheral_beds.late.ipd
                }}
              </div>
              <div class="stat-label">加護病房+RCC (B)</div>
            </div>
            <!-- 急診 -->
            <div class="stat-card">
              <div class="stat-value">
                {{
                  dailyLog.stats.peripheral_beds.early.er +
                  dailyLog.stats.peripheral_beds.noon.er +
                  dailyLog.stats.peripheral_beds.late.er
                }}
              </div>
              <div class="stat-label">急診 (C)</div>
            </div>
          </div>
          <!-- 病人照護文字顯示 -->
          <div class="mobile-text-stats">
            <div class="text-stat-item">
              <strong>ON D/L:</strong>
              <span>{{
                [
                  dailyLog.stats.patient_care.onDL.early,
                  dailyLog.stats.patient_care.onDL.noon,
                  dailyLog.stats.patient_care.onDL.late,
                ]
                  .filter(Boolean)
                  .join(', ') || '無'
              }}</span>
            </div>
            <div class="text-stat-item">
              <strong>AK 更換:</strong>
              <span>{{
                [
                  dailyLog.stats.patient_care.akChange.early,
                  dailyLog.stats.patient_care.akChange.noon,
                  dailyLog.stats.patient_care.akChange.late,
                ]
                  .filter(Boolean)
                  .join(', ') || '無'
              }}</span>
            </div>
            <div class="text-stat-item">
              <strong>預約未到:</strong>
              <span>{{
                [
                  dailyLog.stats.patient_care.noShow.early,
                  dailyLog.stats.patient_care.noShow.noon,
                  dailyLog.stats.patient_care.noShow.late,
                ]
                  .filter(Boolean)
                  .join(', ') || '無'
              }}</span>
            </div>
          </div>
        </div>

        <!-- 行動版：病人動態表 -->
        <div class="mobile-section-card">
          <h2 class="mobile-section-title">病人動態表</h2>
          <div v-if="dailyLog.patientMovements.length > 0" class="log-entry-list">
            <div v-for="item in dailyLog.patientMovements" :key="item.id" class="log-entry-card">
              <div class="entry-header">
                <strong>{{ item.name }}</strong> ({{ item.medicalRecordNumber }})
                <span
                  v-if="item.type"
                  :class="['movement-type-badge', `type-${normalizeMovementType(item.type)}`]"
                >
                  {{ normalizeMovementType(item.type) }}
                </span>
              </div>
              <div class="entry-body">
                <div><strong>會診醫師:</strong> {{ item.physician || 'N/A' }}</div>
                <div><strong>住院原因:</strong> {{ item.reason || 'N/A' }}</div>
                <div><strong>備註:</strong> {{ item.remarks || 'N/A' }}</div>
              </div>
            </div>
          </div>
          <p v-else class="no-data-text">本日無病人動態</p>
        </div>

        <!-- 行動版：血管通路阻塞 -->
        <div class="mobile-section-card">
          <h2 class="mobile-section-title">血管通路阻塞</h2>
          <div v-if="dailyLog.vascularAccessLog.length > 0" class="log-entry-list">
            <div v-for="item in dailyLog.vascularAccessLog" :key="item.id" class="log-entry-card">
              <div class="entry-header">
                <strong>{{ item.name }}</strong> ({{ item.medicalRecordNumber }})
              </div>
              <div class="entry-body">
                <div><strong>處置:</strong> {{ item.interventions.join(', ') || 'N/A' }}</div>
                <div><strong>院所:</strong> {{ item.location || 'N/A' }}</div>
              </div>
            </div>
          </div>
          <p v-else class="no-data-text">本日無血管通路處置記錄</p>
        </div>

        <!-- 其他事項 -->
        <div class="mobile-section-card">
          <h2 class="mobile-section-title">其他事項</h2>
          <p v-if="dailyLog.otherNotes" class="handover-notes-display">
            {{ dailyLog.otherNotes }}
          </p>
          <p v-else class="no-data-text">無其他事項</p>
        </div>

        <!-- 行動版：組長簽核 -->
        <div class="mobile-section-card">
          <h2 class="mobile-section-title">組長簽核</h2>
          <div class="mobile-signatures">
            <div class="signature-item">
              <strong>第一班:</strong>
              <span :class="{ signed: dailyLog.leader.early.name }">{{
                dailyLog.leader.early.name || '未簽核'
              }}</span>
            </div>
            <div class="signature-item">
              <strong>第二班:</strong>
              <span :class="{ signed: dailyLog.leader.noon.name }">{{
                dailyLog.leader.noon.name || '未簽核'
              }}</span>
            </div>
            <div class="signature-item">
              <strong>第三班:</strong>
              <span :class="{ signed: dailyLog.leader.late.name }">{{
                dailyLog.leader.late.name || '未簽核'
              }}</span>
            </div>
          </div>
        </div>
      </div>
    </main>

    <!-- 下方 Dialog 等保持原樣，只要沒有被觸發就不會顯示，或者內部也有權限判斷 -->
    <ul v-if="isAutocompleteVisible" class="global-autocomplete-results" :style="autocompleteStyle">
      <li
        v-for="p in patientSearchResults"
        :key="p.id"
        @mousedown.prevent="selectPatient(p, activeSearch.index, activeSearch.type)"
      >
        {{ p.name }} ({{ p.medicalRecordNumber }})
      </li>
      <li v-if="patientSearchResults.length === 0" class="no-results">無符合結果</li>
    </ul>

    <WardNumberDialog
      :is-visible="isWardDialogVisible"
      :current-value="
        currentEditingMovementIndex > -1
          ? patientMap.get(dailyLog.patientMovements[currentEditingMovementIndex].patientId)
              ?.wardNumber
          : ''
      "
      @confirm="handleWardNumberConfirm"
      @cancel="handleWardNumberCancel"
    />
    <ConfirmDialog
      :is-visible="isConfirmDialogVisible"
      :title="confirmDialogTitle"
      :message="confirmDialogMessage"
      @confirm="handleConfirm"
      @cancel="handleCancel"
    />
    <AlertDialog
      :is-visible="isAlertDialogVisible"
      :title="alertDialogTitle"
      :message="alertDialogMessage"
      @confirm="isAlertDialogVisible = false"
    />
    <HandoverNotesDialog
      :is-visible="isHandoverDialogVisible"
      :initial-notes="handoverNotes"
      :target-date="selectedDate"
      @close="isHandoverDialogVisible = false"
      @notes-updated="onNotesUpdated"
    />
    <MarqueeEditDialog
      :is-visible="isMarqueeDialogVisible"
      :initial-content="marqueeHtmlContent"
      @close="isMarqueeDialogVisible = false"
      @save="handleMarqueeSave"
    />
  </div>
</template>

<script setup>
// ===================================================================
// 1. Imports
// ===================================================================
import { ref, reactive, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useAuth } from '@/composables/useAuth'
import { SHIFT_CODES } from '@/constants/scheduleConstants.js'
import { usePatientStore } from '@/stores/patientStore'
import { storeToRefs } from 'pinia'
import { updatePatient as optimizedUpdatePatient } from '@/services/optimizedApiService.js'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import { systemApi, nursingApi, schedulesApi } from '@/services/localApiClient'

// Component Imports
import WardNumberDialog from '@/components/WardNumberDialog.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import AlertDialog from '@/components/AlertDialog.vue'
import HandoverNotesDialog from '@/components/HandoverNotesDialog.vue'
import MarqueeEditDialog from '@/components/MarqueeEditDialog.vue'

// ===================================================================
// 2. Composables, Stores, and APIs
// ===================================================================
const { currentUser, canEditSchedules } = useAuth()
const patientStore = usePatientStore()
const { allPatients, patientMap, hasFetched } = storeToRefs(patientStore)

// ===================================================================
// 3. Core Component State
// ===================================================================
const isLoading = ref(false)
const selectedDate = ref(formatDate(new Date()))
const hasUnsavedChanges = ref(false)
const isPageLocked = computed(() => !canEditSchedules.value)
const currentSchedule = ref({})
const dailyLog = reactive(initialLogState())

// UI State
const otherNotesTextarea = ref(null)
const isStaffingDetailsVisible = ref(false)
let marqueeUnsubscribe = null
const dailyLogCache = new Map()

// Dialog State
const isWardDialogVisible = ref(false)
const isConfirmDialogVisible = ref(false)
const isAlertDialogVisible = ref(false)
const isHandoverDialogVisible = ref(false)
const isMarqueeDialogVisible = ref(false)

// Dialog Data
const handoverNotes = ref('')
const marqueeHtmlContent = ref('')
const confirmDialogTitle = ref('')
const confirmDialogMessage = ref('')
const confirmAction = ref(null)
const alertDialogTitle = ref('')
const alertDialogMessage = ref('')
const currentEditingMovementIndex = ref(-1)

// Dynamic Table & Autocomplete State
const newMovementId = ref(null)
const activeSearch = ref({ type: null, index: -1 })
const patientSearchResults = ref([])
const inputRefs = reactive({})
const isAutocompleteVisible = ref(false)
const autocompleteStyle = reactive({ top: '0px', left: '0px', width: '0px' })

// ===================================================================
// 4. Computed Properties
// ===================================================================
const selectedDateDisplay = computed(() => {
  const d = new Date(selectedDate.value)
  if (isNaN(d.getTime())) return selectedDate.value
  const year = d.getFullYear()
  const month = (d.getMonth() + 1).toString().padStart(2, '0')
  const day = d.getDate().toString().padStart(2, '0')
  return `${year}/${month}/${day}`
})

const weekdayDisplay = computed(() => {
  try {
    const d = new Date(selectedDate.value)
    return ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
  } catch {
    return ''
  }
})

const statusText = computed(() => {
  if (hasUnsavedChanges.value) return '有未儲存的變更'
  const isSigned = Object.values(dailyLog.leader).some((l) => l && l.userId)
  return isSigned ? '變更已儲存' : '尚未簽核'
})

const totalPatients = computed(() => {
  const shifts = ['early', 'noon', 'late']
  const totals = { early: 0, noon: 0, late: 0 }
  shifts.forEach((shift) => {
    totals[shift] =
      (dailyLog.stats.main_beds[shift]?.total || 0) +
      (dailyLog.stats.peripheral_beds[shift]?.total || 0)
  })
  return totals
})

const calculatedStaffingTotals = computed(() => {
  const totals = { early: 0, noon: 0, late: 0, total: 0 }
  const staffingData = dailyLog.stats.staffing

  if (staffingData && Array.isArray(staffingData.details)) {
    staffingData.details.forEach((item) => {
      const count = Number(item.count) || 0
      totals.early += count * (Number(item.ratio1) || 0)
      totals.noon += count * (Number(item.ratio2) || 0)
      totals.late += count * (Number(item.ratio3) || 0)
    })
  }

  if (staffingData) {
    const adjustments = staffingData.adjustments || staffingData.deductions || {}
    totals.early += (Number(adjustments.shift1) || 0) * 0.125
    totals.noon += (Number(adjustments.shift2) || 0) * 0.125
    totals.late += (Number(adjustments.shift3) || 0) * 0.125
  }

  totals.early = Math.max(0, totals.early)
  totals.noon = Math.max(0, totals.noon)
  totals.late = Math.max(0, totals.late)
  totals.total = totals.early + totals.noon + totals.late
  return totals
})

const nursePatientRatios = computed(() => {
  const calculateRatio = (patients, staff) => {
    if (!staff || staff === 0) return 'N/A'
    return (patients / staff).toFixed(2)
  }
  const totalStaff = calculatedStaffingTotals.value.total
  const totalPatientCount =
    totalPatients.value.early + totalPatients.value.noon + totalPatients.value.late

  return {
    early: calculateRatio(totalPatients.value.early, calculatedStaffingTotals.value.early),
    noon: calculateRatio(totalPatients.value.noon, calculatedStaffingTotals.value.noon),
    late: calculateRatio(totalPatients.value.late, calculatedStaffingTotals.value.late),
    total: calculateRatio(totalPatientCount, totalStaff),
  }
})

// ===================================================================
// 5. Core Business Logic
// ===================================================================

function initialLogState() {
  return {
    id: null,
    date: selectedDate.value,
    stats: {
      main_beds: {
        early: { opd: 0, ipd: 0, er: 0, total: 0 },
        noon: { opd: 0, ipd: 0, er: 0, total: 0 },
        late: { opd: 0, ipd: 0, er: 0, total: 0 },
      },
      peripheral_beds: {
        early: { ipd: 0, er: 0, total: 0 },
        noon: { ipd: 0, er: 0, total: 0 },
        late: { ipd: 0, er: 0, total: 0 },
      },
      patient_care: {
        onDL: { early: '', noon: '', late: '' },
        akChange: { early: '', noon: '', late: '' },
        noShow: { early: '', noon: '', late: '' },
      },
      staffing: {
        details: [
          {
            id: Date.now() + 1,
            label: '7-4(洗腎室)',
            count: 0,
            ratio1: 1,
            ratio2: 1,
            ratio3: 0,
            isLocked: true,
          },
          {
            id: Date.now() + 2,
            label: '7-5(洗腎室)',
            count: 0,
            ratio1: 1,
            ratio2: 1,
            ratio3: 0.25,
            isLocked: true,
          },
          {
            id: Date.now() + 3,
            label: '8-16(ICU)',
            count: 0,
            ratio1: 1,
            ratio2: 1,
            ratio3: 0,
            isLocked: true,
          },
          {
            id: Date.now() + 4,
            label: '12-8',
            count: 0,
            ratio1: 0,
            ratio2: 0.375,
            ratio3: 0.625,
            isLocked: true,
          },
          {
            id: Date.now() + 5,
            label: '3-11(夜班)',
            count: 0,
            ratio1: 0,
            ratio2: 0,
            ratio3: 1,
            isLocked: true,
          },
        ],
        adjustments: { shift1: null, shift2: null, shift3: null },
        early: 0,
        noon: 0,
        late: 0,
      },
    },
    patientMovements: [],
    vascularAccessLog: [],
    otherNotes: '',
    leader: {
      early: { userId: null, name: null, signedAt: null },
      noon: { userId: null, name: null, signedAt: null },
      late: { userId: null, name: null, signedAt: null },
    },
  }
}

async function loadDailyLog(dateStr) {
  isLoading.value = true
  hasUnsavedChanges.value = false
  Object.assign(dailyLog, initialLogState(), { date: dateStr })
  currentSchedule.value = {}
  handoverNotes.value = ''
  newMovementId.value = null

  try {
    const patientFetchPromise = patientStore.fetchPatientsIfNeeded()

    const cachedLog = dailyLogCache.get(dateStr)
    if (cachedLog && hasFetched.value) {
      applyLoadedData(
        cloneData(cachedLog.dailyLog),
        cloneData(cachedLog.schedule),
        cachedLog.handoverNotes,
      )
      isLoading.value = false
      await nextTick()
      handleTextareaInput()
      return
    }

    await patientFetchPromise

    // 使用本地 API 獲取資料
    let logResult = null
    let scheduleData = null

    const results = await Promise.all([
      nursingApi.fetchDailyLog(dateStr).catch(() => null),
      nursingApi
        .fetchLatestHandoverLog()
        .then((log) => log?.content || '')
        .catch(() => ''),
      schedulesApi.fetchByDate(dateStr).catch(() => null),
    ])

    logResult = results[0]
    handoverNotes.value = results[1]
    scheduleData = results[2] ? [results[2]] : []

    if (logResult) {
      const defaultState = initialLogState()
      // 深度合併 stats 物件，確保所有巢狀結構都存在
      const mergedStats = {
        main_beds: {
          early: { ...defaultState.stats.main_beds.early, ...logResult.stats?.main_beds?.early },
          noon: { ...defaultState.stats.main_beds.noon, ...logResult.stats?.main_beds?.noon },
          late: { ...defaultState.stats.main_beds.late, ...logResult.stats?.main_beds?.late },
        },
        peripheral_beds: {
          early: {
            ...defaultState.stats.peripheral_beds.early,
            ...logResult.stats?.peripheral_beds?.early,
          },
          noon: {
            ...defaultState.stats.peripheral_beds.noon,
            ...logResult.stats?.peripheral_beds?.noon,
          },
          late: {
            ...defaultState.stats.peripheral_beds.late,
            ...logResult.stats?.peripheral_beds?.late,
          },
        },
        patient_care: {
          onDL: { ...defaultState.stats.patient_care.onDL, ...logResult.stats?.patient_care?.onDL },
          akChange: {
            ...defaultState.stats.patient_care.akChange,
            ...logResult.stats?.patient_care?.akChange,
          },
          noShow: {
            ...defaultState.stats.patient_care.noShow,
            ...logResult.stats?.patient_care?.noShow,
          },
        },
        staffing: logResult.stats?.staffing || defaultState.stats.staffing,
      }
      // 深度合併 leader 物件
      const mergedLeader = {
        early: { ...defaultState.leader.early, ...logResult.leader?.early },
        noon: { ...defaultState.leader.noon, ...logResult.leader?.noon },
        late: { ...defaultState.leader.late, ...logResult.leader?.late },
      }
      const mergedLog = { ...defaultState, ...logResult, stats: mergedStats, leader: mergedLeader }
      if (mergedLog.handoverNotes && typeof mergedLog.otherNotes === 'undefined') {
        mergedLog.otherNotes = mergedLog.handoverNotes
      }
      delete mergedLog.handoverNotes

      // Check if staffing.details is missing OR empty array - if so, use defaults
      if (
        logResult.stats &&
        (!logResult.stats.staffing ||
          !logResult.stats.staffing.details ||
          logResult.stats.staffing.details.length === 0)
      ) {
        const oldStaffingData = logResult.stats.staffing || {}
        const newStaffingStructure = initialLogState().stats.staffing
        const oldTotal =
          (oldStaffingData.early || 0) + (oldStaffingData.noon || 0) + (oldStaffingData.late || 0)

        if (oldTotal > 0) {
          newStaffingStructure.details = [
            {
              id: Date.now(),
              label: '舊日誌人力總計',
              count: 1,
              ratio1: oldStaffingData.early || 0,
              ratio2: oldStaffingData.noon || 0,
              ratio3: oldStaffingData.late || 0,
            },
          ]
        }
        mergedStats.staffing = newStaffingStructure
      }

      // 確保 adjustments 欄位存在
      if (mergedStats.staffing) {
        if (mergedStats.staffing.deductions && !mergedStats.staffing.adjustments) {
          mergedStats.staffing.adjustments = mergedStats.staffing.deductions
        }
        if (!mergedStats.staffing.adjustments) {
          mergedStats.staffing.adjustments = { shift1: null, shift2: null, shift3: null }
        }
      }

      // Ensure leader object has correct nested structure to prevent undefined errors
      const defaultLeader = initialLogState().leader
      mergedLog.leader = {
        early: { ...defaultLeader.early, ...(mergedLog.leader?.early || {}) },
        noon: { ...defaultLeader.noon, ...(mergedLog.leader?.noon || {}) },
        late: { ...defaultLeader.late, ...(mergedLog.leader?.late || {}) },
      }

      Object.assign(dailyLog, mergedLog)
    } else {
      dailyLog.otherNotes = ''
    }

    if (scheduleData.length > 0) {
      const scheduleRecord = scheduleData[0]
      currentSchedule.value = scheduleRecord.schedule || {}
      // 始終從排程計算最新的病人人數統計（確保營運統計自動帶入最新值）
      calculateStatsFromSchedule(scheduleRecord)
      // 只有新日誌才自動計算護理人力（避免覆蓋組長手動輸入的人力）
      if (!logResult || logResult.isNew) {
        await calculateStaffingFromNurseAssignments(dateStr)
      }
    }

    dailyLogCache.set(dateStr, {
      dailyLog: cloneData(dailyLog),
      schedule: cloneData(currentSchedule.value),
      handoverNotes: handoverNotes.value,
    })
  } catch (error) {
    console.error('載入日誌失敗:', error)
    showAlert('載入失敗', '載入日誌時發生錯誤')
  } finally {
    isLoading.value = false
    await nextTick()
    handleTextareaInput()
  }
}

async function saveLog(options = {}) {
  const { successMessage = '日誌已儲存！', showSuccessAlert = true } = options
  if (isLoading.value) return
  isLoading.value = true

  dailyLog.patientMovements = dailyLog.patientMovements.filter(
    (item) => item.name || item.medicalRecordNumber,
  )
  dailyLog.vascularAccessLog = dailyLog.vascularAccessLog.filter(
    (item) => item.name || item.medicalRecordNumber,
  )

  try {
    const dataToSave = JSON.parse(JSON.stringify(dailyLog))

    if (dataToSave.stats?.staffing) {
      if (dataToSave.stats.staffing.deductions) {
        dataToSave.stats.staffing.adjustments = dataToSave.stats.staffing.deductions
        delete dataToSave.stats.staffing.deductions
      }
      if (!dataToSave.stats.staffing.adjustments) {
        dataToSave.stats.staffing.adjustments = { shift1: null, shift2: null, shift3: null }
      }
      // 將計算好的人力統計數據儲存，供報表頁面使用
      dataToSave.stats.staffing.early = calculatedStaffingTotals.value.early
      dataToSave.stats.staffing.noon = calculatedStaffingTotals.value.noon
      dataToSave.stats.staffing.late = calculatedStaffingTotals.value.late
    }

    if ('handoverNotes' in dataToSave) {
      delete dataToSave.handoverNotes
    }

    // 將計算好的護病比儲存，供報表頁面使用
    dataToSave.nursePatientRatios = {
      early: nursePatientRatios.value.early,
      noon: nursePatientRatios.value.noon,
      late: nursePatientRatios.value.late,
    }

    // 使用本地 API 儲存日誌
    const docId = dailyLog.id || selectedDate.value
    await nursingApi.updateDailyLog(docId, dataToSave)
    if (!dailyLog.id) {
      dailyLog.id = docId
    }
    hasUnsavedChanges.value = false

    // 更新快取，避免切換頁面後返回時顯示舊資料
    dailyLogCache.set(selectedDate.value, {
      dailyLog: cloneData(dailyLog),
      schedule: cloneData(currentSchedule.value),
      handoverNotes: handoverNotes.value,
    })

    if (showSuccessAlert) {
      showAlert('操作成功', successMessage)
    }
  } catch (error) {
    console.error('儲存日誌失敗:', error)
    showAlert('儲存失敗', '儲存日誌時發生錯誤')
  } finally {
    isLoading.value = false
  }
}

async function handleMarqueeSave(newContent) {
  if (isPageLocked.value) {
    showAlert('權限不足', '您沒有權限修改全域公告。')
    return
  }

  try {
    await systemApi.updateSiteConfig('marquee_announcements', {
      content: newContent,
      updatedAt: new Date().toISOString(),
      updatedBy: {
        uid: currentUser.value.uid,
        name: currentUser.value.name,
      },
    })
    marqueeHtmlContent.value = newContent
    isMarqueeDialogVisible.value = false
    showAlert('儲存成功', '全域跑馬燈公告已更新！')
  } catch (error) {
    console.error('儲存跑馬燈公告失敗:', error)
    showAlert('儲存失敗', '更新公告時發生錯誤。')
  }
}

// --- Stats Calculation ---
function calculateStatsFromSchedule(scheduleRecord) {
  const newStats = {
    main_beds: {
      early: { opd: 0, ipd: 0, er: 0, total: 0 },
      noon: { opd: 0, ipd: 0, er: 0, total: 0 },
      late: { opd: 0, ipd: 0, er: 0, total: 0 },
    },
    peripheral_beds: {
      early: { ipd: 0, er: 0, total: 0 },
      noon: { ipd: 0, er: 0, total: 0 },
      late: { ipd: 0, er: 0, total: 0 },
    },
  }
  if (!scheduleRecord || !scheduleRecord.schedule) {
    dailyLog.stats.main_beds = newStats.main_beds
    dailyLog.stats.peripheral_beds = newStats.peripheral_beds
    return
  }
  for (const shiftKey in scheduleRecord.schedule) {
    const slotData = scheduleRecord.schedule[shiftKey]
    if (!slotData?.patientId) continue
    const patient = patientMap.value.get(slotData.patientId)
    if (!patient) continue
    const shiftCode = shiftKey.split('-').pop()
    const isPeripheral = shiftKey.startsWith('peripheral')

    if (['early', 'noon', 'late'].includes(shiftCode)) {
      if (isPeripheral) {
        newStats.peripheral_beds[shiftCode].total++
        if (patient.status === 'ipd') newStats.peripheral_beds[shiftCode].ipd++
        else if (patient.status === 'er') newStats.peripheral_beds[shiftCode].er++
      } else {
        newStats.main_beds[shiftCode].total++
        if (patient.status === 'opd') newStats.main_beds[shiftCode].opd++
        else if (patient.status === 'ipd') newStats.main_beds[shiftCode].ipd++
        else if (patient.status === 'er') newStats.main_beds[shiftCode].er++
      }
    }
  }
  dailyLog.stats.main_beds = newStats.main_beds
  dailyLog.stats.peripheral_beds = newStats.peripheral_beds
}

// 自動從護理分組計算護理人力
async function calculateStaffingFromNurseAssignments(dateStr) {
  try {
    const nurseAssignments = await schedulesApi.fetchNurseAssignments(dateStr)
    if (!nurseAssignments?.names) return

    const names = nurseAssignments.names

    // 計算早班護理師數量（組別名稱以 '早' 開頭且有指派護理師）
    let earlyShiftCount = 0
    // 計算晚班護理師數量（組別名稱以 '晚' 開頭且有指派護理師）
    let lateShiftCount = 0

    for (const teamName in names) {
      const nurseName = names[teamName]
      // 只計算有實際指派護理師的組別（排除空字串和 '-- 未指派 --'）
      if (!nurseName || nurseName === '-- 未指派 --' || nurseName.trim() === '') continue

      if (teamName.startsWith('早')) {
        earlyShiftCount++
      } else if (teamName.startsWith('晚')) {
        lateShiftCount++
      }
    }

    // 如果有護理師資料，自動填入 staffing details
    // 找到對應的 staffing detail 項目並更新 count
    // 根據現有的 staffing details 結構：
    // - 7-4(洗腎室): ratio1=1, ratio2=1, ratio3=0 -> 早班+中班
    // - 7-5(洗腎室): ratio1=1, ratio2=1, ratio3=0.25 -> 早班+中班+部分晚班
    // - 8-16(ICU): ratio1=1, ratio2=1, ratio3=0 -> 早班+中班
    // - 12-8: ratio1=0, ratio2=0.375, ratio3=0.625 -> 中班+晚班
    // - 3-11(夜班): ratio1=0, ratio2=0, ratio3=1 -> 晚班

    // 簡化邏輯：將早班護理師數量填入第一個項目（7-4），晚班護理師數量填入最後一個項目（3-11）
    if (dailyLog.stats.staffing?.details) {
      const details = dailyLog.stats.staffing.details

      // 找到早班相關的項目（label 包含 '7-4' 或 '7-5' 或 '8-16'）
      const earlyItem = details.find(
        (item) => item.label.includes('7-4') || item.label.includes('7-5'),
      )
      if (earlyItem && earlyShiftCount > 0) {
        earlyItem.count = earlyShiftCount
      }

      // 找到晚班相關的項目（label 包含 '3-11' 或 '夜班'）
      const lateItem = details.find(
        (item) => item.label.includes('3-11') || item.label.includes('夜班'),
      )
      if (lateItem && lateShiftCount > 0) {
        lateItem.count = lateShiftCount
      }
    }

    console.log(
      `[DailyLog] 自動計算護理人力: 早班 ${earlyShiftCount} 人, 晚班 ${lateShiftCount} 人`,
    )
  } catch (error) {
    console.error('自動計算護理人力失敗:', error)
  }
}

// 計算 schedule 的人數統計，返回結果而不修改 dailyLog
function getStatsFromSchedule(scheduleRecord) {
  const stats = {
    main_beds: {
      early: { opd: 0, ipd: 0, er: 0, total: 0 },
      noon: { opd: 0, ipd: 0, er: 0, total: 0 },
      late: { opd: 0, ipd: 0, er: 0, total: 0 },
    },
    peripheral_beds: {
      early: { ipd: 0, er: 0, total: 0 },
      noon: { ipd: 0, er: 0, total: 0 },
      late: { ipd: 0, er: 0, total: 0 },
    },
  }
  if (!scheduleRecord || !scheduleRecord.schedule) {
    return stats
  }
  for (const shiftKey in scheduleRecord.schedule) {
    const slotData = scheduleRecord.schedule[shiftKey]
    if (!slotData?.patientId) continue
    const patient = patientMap.value.get(slotData.patientId)
    if (!patient) continue
    const shiftCode = shiftKey.split('-').pop()
    const isPeripheral = shiftKey.startsWith('peripheral')

    if (['early', 'noon', 'late'].includes(shiftCode)) {
      if (isPeripheral) {
        stats.peripheral_beds[shiftCode].total++
        if (patient.status === 'ipd') stats.peripheral_beds[shiftCode].ipd++
        else if (patient.status === 'er') stats.peripheral_beds[shiftCode].er++
      } else {
        stats.main_beds[shiftCode].total++
        if (patient.status === 'opd') stats.main_beds[shiftCode].opd++
        else if (patient.status === 'ipd') stats.main_beds[shiftCode].ipd++
        else if (patient.status === 'er') stats.main_beds[shiftCode].er++
      }
    }
  }
  return stats
}

// 比較兩邊的人數統計是否一致
function compareStats(currentStats, scheduleStats) {
  const differences = []
  const shiftLabels = { early: '第一班', noon: '第二班', late: '第三班' }
  const categoryLabels = { opd: '門診', ipd: '住院', er: '急診', total: '小計' }

  // 比較洗腎中心床位
  for (const shift of ['early', 'noon', 'late']) {
    for (const category of ['opd', 'ipd', 'er', 'total']) {
      const current = currentStats.main_beds?.[shift]?.[category] || 0
      const schedule = scheduleStats.main_beds?.[shift]?.[category] || 0
      if (current !== schedule) {
        differences.push({
          area: '洗腎中心',
          shift: shiftLabels[shift],
          category: categoryLabels[category],
          current,
          schedule,
        })
      }
    }
  }

  // 比較急重症床位
  for (const shift of ['early', 'noon', 'late']) {
    for (const category of ['ipd', 'er', 'total']) {
      const current = currentStats.peripheral_beds?.[shift]?.[category] || 0
      const schedule = scheduleStats.peripheral_beds?.[shift]?.[category] || 0
      if (current !== schedule) {
        differences.push({
          area: '急重症',
          shift: shiftLabels[shift],
          category: categoryLabels[category],
          current,
          schedule,
        })
      }
    }
  }

  return differences
}

// 格式化差異訊息
function formatDifferencesMessage(differences) {
  if (differences.length === 0) return ''

  // 按區域分組
  const mainBedsDiffs = differences.filter((d) => d.area === '洗腎中心')
  const peripheralDiffs = differences.filter((d) => d.area === '急重症')

  let message = '以下人數與排程表不符：\n\n'

  if (mainBedsDiffs.length > 0) {
    message += '【洗腎中心床位】\n'
    mainBedsDiffs.forEach((d) => {
      message += `  ${d.shift} ${d.category}: ${d.current} → ${d.schedule}\n`
    })
    message += '\n'
  }

  if (peripheralDiffs.length > 0) {
    message += '【急重症床位】\n'
    peripheralDiffs.forEach((d) => {
      message += `  ${d.shift} ${d.category}: ${d.current} → ${d.schedule}\n`
    })
  }

  return message
}

// 存檔前檢查並自動同步人數統計
async function checkAndSyncBeforeSave(onComplete) {
  try {
    // 獲取最新的 schedule 資料
    const scheduleResult = await schedulesApi.fetchByDate(selectedDate.value).catch(() => null)

    if (!scheduleResult) {
      // 沒有排程資料，直接存檔
      await onComplete()
      return
    }

    // 計算 schedule 的人數統計
    const scheduleStats = getStatsFromSchedule(scheduleResult)

    // 比較差異
    const differences = compareStats(dailyLog.stats, scheduleStats)

    if (differences.length === 0) {
      // 沒有差異，直接執行
      await onComplete()
      return
    }

    // 有差異，顯示確認對話框
    const diffMessage = formatDifferencesMessage(differences)
    showConfirm(
      '人數統計需要同步',
      `${diffMessage}\n是否同步為排程表的人數後再儲存？`,
      async () => {
        // 同步人數
        dailyLog.stats.main_beds = scheduleStats.main_beds
        dailyLog.stats.peripheral_beds = scheduleStats.peripheral_beds
        // 執行原本的操作
        await onComplete()
      },
    )
  } catch (error) {
    console.error('檢查人數統計時發生錯誤:', error)
    // 發生錯誤時仍然允許存檔
    await onComplete()
  }
}

// --- Staffing Calculation ---
function toggleStaffingDetails() {
  isStaffingDetailsVisible.value = !isStaffingDetailsVisible.value
}

function addStaffingRow() {
  dailyLog.stats.staffing.details.push({
    id: Date.now(),
    label: '',
    count: 0,
    ratio1: 0,
    ratio2: 0,
    ratio3: 0,
    isLocked: false,
  })
}

function deleteStaffingRow(index) {
  dailyLog.stats.staffing.details.splice(index, 1)
}

// --- PDF Export ---
async function exportToPDF() {
  if (isLoading.value) {
    showAlert('提示', '目前正在載入資料，請稍後再試。')
    return
  }
  if (hasUnsavedChanges.value && !isPageLocked.value) {
    await saveLog({ showSuccessAlert: false })
  }
  const originalLoadingText = document.querySelector('.loading-overlay p')?.textContent || ''
  const loadingOverlay = document.querySelector('.loading-overlay')
  const loadingTextElement = document.querySelector('.loading-overlay p')
  if (loadingOverlay) {
    if (loadingTextElement) {
      loadingTextElement.textContent = '正在準備匯出 PDF，請稍候...'
    }
    isLoading.value = true
  }
  await nextTick()
  try {
    const exportArea = document.getElementById('pdf-export-area')
    if (!exportArea) {
      showAlert('錯誤', '找不到要匯出的內容！')
      return
    }
    exportArea.classList.add('pdf-export-mode')
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 100))
    const canvas = await html2canvas(exportArea, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      ignoreElements: (element) =>
        element.classList.contains('header-right') || element.classList.contains('loading-overlay'),
    })
    const imgData = canvas.toDataURL('image/jpeg', 0.95)
    const pdf = new jsPDF('p', 'mm', 'a4')
    const pdfWidth = pdf.internal.pageSize.getWidth()
    const pdfHeight = pdf.internal.pageSize.getHeight()
    const imgWidth = canvas.width
    const imgHeight = canvas.height
    const ratio = imgWidth / pdfWidth
    const scaledHeight = imgHeight / ratio
    let heightLeft = scaledHeight
    let position = 0
    const margin = 10
    pdf.addImage(
      imgData,
      'JPEG',
      margin,
      position + margin,
      pdfWidth - margin * 2,
      scaledHeight - margin * 2,
    )
    heightLeft -= pdfHeight - margin * 2
    while (heightLeft > 0) {
      position -= pdfHeight - margin * 2
      pdf.addPage()
      pdf.addImage(
        imgData,
        'JPEG',
        margin,
        position + margin,
        pdfWidth - margin * 2,
        scaledHeight - margin * 2,
      )
      heightLeft -= pdfHeight - margin * 2
    }
    pdf.save(`血液透析中心工作日誌_${selectedDate.value}.pdf`)
  } catch (error) {
    console.error('匯出 PDF 失敗:', error)
    showAlert('錯誤', '匯出 PDF 時發生錯誤，請檢查主控台訊息。')
  } finally {
    const exportArea = document.getElementById('pdf-export-area')
    if (exportArea) {
      exportArea.classList.remove('pdf-export-mode')
    }
    if (loadingTextElement) {
      loadingTextElement.textContent = originalLoadingText
    }
    isLoading.value = false
  }
}

// ===================================================================
// 6. UI Event Handlers
// ===================================================================

// --- Header Controls ---
function changeDate(days) {
  const newDate = new Date(selectedDate.value)
  newDate.setDate(newDate.getDate() + days)
  selectedDate.value = formatDate(newDate)
}

function goToToday() {
  selectedDate.value = formatDate(new Date())
}

function triggerDateInput() {
  document.querySelector('.hidden-date-input').showPicker()
}

// --- Dynamic Table Row Management ---
function addRow(targetArrayKey) {
  if (newMovementId.value) {
    showAlert('提示', '請先儲存目前新增的動態，再新增下一筆。')
    return
  }
  const newId = Date.now()
  if (targetArrayKey === 'patientMovements') {
    dailyLog.patientMovements.push({
      id: newId,
      type: '手動',
      name: '',
      medicalRecordNumber: '',
      bedChange: '',
      admissionDate: '',
      dischargeDate: '',
      physician: '',
      reason: '',
      remarks: '',
    })
    newMovementId.value = newId
  } else if (targetArrayKey === 'vascularAccessLog') {
    dailyLog.vascularAccessLog.push({
      id: newId,
      name: '',
      medicalRecordNumber: '',
      date: selectedDate.value,
      interventions: [],
      location: '',
    })
  }
}

function deleteRow(index, targetArrayKey) {
  const item = dailyLog[targetArrayKey][index]
  showConfirm('確認移除', '您確定要移除這一行嗎？', () => {
    if (item.id === newMovementId.value) {
      newMovementId.value = null
    }
    dailyLog[targetArrayKey].splice(index, 1)
  })
}

function isRowInEditMode(item) {
  return item.id === newMovementId.value || !!item.isEdited
}

function unlockMovement(item) {
  item.isEdited = true
}

async function saveMovement(item) {
  if (!item.name) {
    showAlert('資料不完整', '請至少填寫病人姓名。')
    return
  }

  if (item.isEdited && item.originalType) {
    item.originalAutoId = item.id
    item.id = `edited_${item.id}`
    item.type = '手動'
  }

  if (item.id === newMovementId.value) {
    newMovementId.value = null
  }
  item.isEdited = false

  await saveJustMovements()
}

async function saveJustMovements() {
  isLoading.value = true
  try {
    const docId = selectedDate.value
    const dataToUpdate = {
      patientMovements: JSON.parse(JSON.stringify(dailyLog.patientMovements)),
    }

    // 使用本地 API 儲存日誌
    await nursingApi.updateDailyLog(docId, dataToUpdate)
    if (!dailyLog.id) {
      dailyLog.id = docId
    }
    // 注意：不設定 hasUnsavedChanges = false，因為其他區段（營運統計、血管通路、其他事項）
    // 可能仍有未儲存的變更。只有 saveLog() 全量儲存後才應該清除此標記。

    // 清除快取，確保下次載入從 DB 取得最新完整資料，避免快取中的部分資料覆蓋 DB 已存的欄位
    dailyLogCache.delete(selectedDate.value)

    showAlert('操作成功', '病人動態已更新！')
  } catch (error) {
    console.error('儲存病人動態失敗:', error)
    showAlert('儲存失敗', '更新病人動態時發生錯誤。')
  } finally {
    isLoading.value = false
  }
}

// --- Patient Autocomplete ---
function handlePatientSearch(index, type) {
  const targetArray = type === 'movements' ? dailyLog.patientMovements : dailyLog.vascularAccessLog
  const query = targetArray[index].name.toLowerCase()
  if (!query) {
    patientSearchResults.value = []
    return
  }
  patientSearchResults.value = allPatients.value.filter(
    (p) => p.name.toLowerCase().includes(query) || p.medicalRecordNumber.includes(query),
  )
}

function showAutocomplete(event, index, type) {
  activeSearch.value = { type, index }
  handlePatientSearch(index, type)
  const inputElement = event.target
  const rect = inputElement.getBoundingClientRect()
  autocompleteStyle.top = `${rect.bottom + window.scrollY}px`
  autocompleteStyle.left = `${rect.left + window.scrollX}px`
  autocompleteStyle.width = `${rect.width}px`
  isAutocompleteVisible.value = true
}

function hideAutocomplete() {
  setTimeout(() => {
    isAutocompleteVisible.value = false
  }, 200)
}

function selectPatient(patient, index, type) {
  const targetArray = type === 'movements' ? dailyLog.patientMovements : dailyLog.vascularAccessLog
  targetArray[index].name = patient.name
  targetArray[index].patientId = patient.id
  targetArray[index].medicalRecordNumber = patient.medicalRecordNumber
  if (type === 'movements') {
    targetArray[index].admissionDate = patient.admissionDate || ''
    targetArray[index].physician = patient.physician || ''
    let foundBed = ''
    if (currentSchedule.value) {
      for (const shiftKey in currentSchedule.value) {
        const slot = currentSchedule.value[shiftKey]
        if (slot.patientId === patient.id) {
          const parts = shiftKey.split('-')
          foundBed = parts[0] === 'peripheral' ? `外圍${parts[1]}` : parts[1]
          break
        }
      }
    }
    targetArray[index].bedChange = foundBed
  }
  isAutocompleteVisible.value = false
}

// --- Dialog Management ---
function showConfirm(title, message, onConfirmCallback) {
  confirmDialogTitle.value = title
  confirmDialogMessage.value = message
  confirmAction.value = onConfirmCallback
  isConfirmDialogVisible.value = true
}

function handleConfirm() {
  if (typeof confirmAction.value === 'function') {
    confirmAction.value()
  }
  handleCancel()
}

function handleCancel() {
  isConfirmDialogVisible.value = false
  confirmDialogTitle.value = ''
  confirmDialogMessage.value = ''
  confirmAction.value = null
}

function showAlert(title, message) {
  alertDialogTitle.value = title
  alertDialogMessage.value = message
  isAlertDialogVisible.value = true
}

function onNotesUpdated(newNotes) {
  handoverNotes.value = newNotes
  isHandoverDialogVisible.value = false
}

// --- Ward Number Dialog ---
function promptWardNumber(index) {
  const patientId = dailyLog.patientMovements[index]?.patientId
  if (!patientId) {
    showAlert('操作失敗', '請先透過「姓名」欄位選擇一位病人，才能設定床號。')
    return
  }
  const patient = patientMap.value.get(patientId)
  if (!patient || !['ipd', 'er'].includes(patient.status)) {
    showAlert(
      '提示',
      `病人「${patient.name}」目前的狀態是「${patient.status === 'opd' ? '門診' : '未知'}」，無法設定住院床號。`,
    )
    return
  }
  currentEditingMovementIndex.value = index
  isWardDialogVisible.value = true
}

async function handleWardNumberConfirm(newWardNumber) {
  const index = currentEditingMovementIndex.value
  if (index < 0) return
  const patientId = dailyLog.patientMovements[index]?.patientId
  if (!patientId) return
  try {
    await optimizedUpdatePatient(patientId, { wardNumber: newWardNumber })
    await patientStore.forceRefreshPatients()
    showAlert('操作成功', '住院床號已更新！')
  } catch (error) {
    console.error('更新住院床號失敗:', error)
    showAlert('操作失敗', '更新住院床號時發生錯誤。')
  } finally {
    handleWardNumberCancel()
  }
}

function handleWardNumberCancel() {
  isWardDialogVisible.value = false
  currentEditingMovementIndex.value = -1
}

// --- Leader Signature ---
async function signAsLeader(shift) {
  if (!currentUser.value) return

  // 執行簽核並存檔的函數
  const performSignAndSave = async (isOverride = false) => {
    dailyLog.leader[shift] = {
      userId: currentUser.value.uid,
      name: currentUser.value.name,
      signedAt: new Date().toISOString(),
    }
    const successMsg = isOverride ? '覆蓋簽核成功！日誌已更新。' : '簽核成功！日誌已儲存。'
    await saveLog({ successMessage: successMsg })
  }

  // 先檢查人數統計，再執行簽核
  const performSign = async (isOverride = false) => {
    await checkAndSyncBeforeSave(async () => {
      await performSignAndSave(isOverride)
    })
  }

  const existingLeader = dailyLog.leader[shift]
  let confirmMsg = `您確定要以「${currentUser.value.name}」的名義簽核此班別，並儲存所有變更嗎？`
  let confirmTitle = '確認簽核'
  if (existingLeader?.userId && existingLeader.userId !== currentUser.value.uid) {
    confirmTitle = '覆蓋簽核'
    confirmMsg = `此班別已由 ${existingLeader.name} 簽核。\n\n` + confirmMsg
  } else if (existingLeader?.userId && !hasUnsavedChanges.value) {
    showAlert('提示', '您已簽核，且日誌無未儲存的變更。')
    return
  } else if (hasUnsavedChanges.value) {
    confirmTitle = '更新簽核並儲存'
  }
  showConfirm(confirmTitle, confirmMsg, performSign)
}

async function unsignLeader(shift) {
  if (!currentUser.value) return

  // 執行撤銷簽核並存檔的函數
  const performUnsignAndSave = async () => {
    dailyLog.leader[shift] = { userId: null, name: null, signedAt: null }
    await saveLog({ successMessage: '撤銷簽核成功！日誌已更新。' })
  }

  // 先檢查人數統計，再執行撤銷
  const performUnsign = async () => {
    await checkAndSyncBeforeSave(async () => {
      await performUnsignAndSave()
    })
  }

  if (dailyLog.leader[shift]?.userId) {
    if (
      dailyLog.leader[shift]?.userId === currentUser.value.uid ||
      currentUser.value.role === 'admin'
    ) {
      showConfirm(
        '撤銷簽核',
        `您確定要撤銷 ${dailyLog.leader[shift].name} 的簽核並儲存變更嗎？`,
        performUnsign,
      )
    } else {
      showAlert('權限不足', '您沒有權限撤銷其他人的簽核。')
    }
  }
}

// --- Misc UI Handlers ---
function handleTextareaInput() {
  const textarea = otherNotesTextarea.value
  if (textarea) {
    textarea.style.height = 'auto'
    textarea.style.height = `${textarea.scrollHeight}px`
  }
}

// ===================================================================
// 7. Lifecycle Hooks & Watchers
// ===================================================================

// --- Lifecycle Hooks ---
onMounted(async () => {
  await loadDailyLog(selectedDate.value)

  // 獲取跑馬燈內容
  try {
    const config = await systemApi.fetchSiteConfig('marquee_announcements')
    marqueeHtmlContent.value = config?.configData?.content || config?.content || ''
  } catch (error) {
    console.warn('[DailyLogView] 獲取跑馬燈內容失敗:', error)
    marqueeHtmlContent.value = ''
  }
})

onUnmounted(() => {
  if (marqueeUnsubscribe) marqueeUnsubscribe()
})

// --- Watchers ---
watch(selectedDate, (newDate) => {
  if (newDate) loadDailyLog(newDate)
})

watch(
  dailyLog,
  () => {
    if (isLoading.value) return
    hasUnsavedChanges.value = true
  },
  { deep: true },
)

watch(
  calculatedStaffingTotals,
  (newTotals) => {
    if (dailyLog.stats.staffing) {
      dailyLog.stats.staffing.early = newTotals.early
      dailyLog.stats.staffing.noon = newTotals.noon
      dailyLog.stats.staffing.late = newTotals.late
    }
  },
  { deep: true, immediate: true },
)

// ===================================================================
// 8. Utility Functions
// ===================================================================
function normalizeMovementType(type) {
  if (!type) return '手動'
  const transferLabels = ['轉入', '轉出', '轉門診', '轉急診', '轉住院']
  return transferLabels.includes(type) ? '轉移' : type
}

function formatDate(date) {
  const d = new Date(date)
  const year = d.getFullYear()
  const month = (d.getMonth() + 1).toString().padStart(2, '0')
  const day = d.getDate().toString().padStart(2, '0')
  return `${year}-${month}-${day}`
}

function cloneData(data) {
  return data ? JSON.parse(JSON.stringify(data)) : data
}

function applyLoadedData(logData, scheduleData, handoverContent) {
  const defaultState = initialLogState()
  if (logData?.stats || logData?.leader) {
    // 深度合併 stats 物件
    const mergedStats = {
      main_beds: {
        early: { ...defaultState.stats.main_beds.early, ...logData.stats?.main_beds?.early },
        noon: { ...defaultState.stats.main_beds.noon, ...logData.stats?.main_beds?.noon },
        late: { ...defaultState.stats.main_beds.late, ...logData.stats?.main_beds?.late },
      },
      peripheral_beds: {
        early: {
          ...defaultState.stats.peripheral_beds.early,
          ...logData.stats?.peripheral_beds?.early,
        },
        noon: {
          ...defaultState.stats.peripheral_beds.noon,
          ...logData.stats?.peripheral_beds?.noon,
        },
        late: {
          ...defaultState.stats.peripheral_beds.late,
          ...logData.stats?.peripheral_beds?.late,
        },
      },
      patient_care: {
        onDL: { ...defaultState.stats.patient_care.onDL, ...logData.stats?.patient_care?.onDL },
        akChange: {
          ...defaultState.stats.patient_care.akChange,
          ...logData.stats?.patient_care?.akChange,
        },
        noShow: {
          ...defaultState.stats.patient_care.noShow,
          ...logData.stats?.patient_care?.noShow,
        },
      },
      staffing: {
        details:
          Array.isArray(logData.stats?.staffing?.details) &&
          logData.stats.staffing.details.length > 0
            ? logData.stats.staffing.details
            : defaultState.stats.staffing.details,
        adjustments: {
          ...defaultState.stats.staffing.adjustments,
          ...logData.stats?.staffing?.adjustments,
        },
        early: logData.stats?.staffing?.early ?? defaultState.stats.staffing.early,
        noon: logData.stats?.staffing?.noon ?? defaultState.stats.staffing.noon,
        late: logData.stats?.staffing?.late ?? defaultState.stats.staffing.late,
      },
    }
    // 深度合併 leader 物件
    const mergedLeader = {
      early: { ...defaultState.leader.early, ...logData.leader?.early },
      noon: { ...defaultState.leader.noon, ...logData.leader?.noon },
      late: { ...defaultState.leader.late, ...logData.leader?.late },
    }
    Object.assign(dailyLog, defaultState, logData, { stats: mergedStats, leader: mergedLeader })
  } else {
    Object.assign(dailyLog, defaultState, logData || { date: selectedDate.value })
  }
  currentSchedule.value = scheduleData || {}

  // 始終從排程重新計算病人人數統計（確保快取載入時也能取得最新資料）
  if (scheduleData && Object.keys(scheduleData).length > 0) {
    calculateStatsFromSchedule({ schedule: scheduleData })
  }

  handoverNotes.value = handoverContent || ''
  hasUnsavedChanges.value = false
}

function formatSignTime(isoString) {
  if (!isoString) return ''
  const date = new Date(isoString)
  return date.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })
}
</script>

<style scoped>
@import url('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.4/css/all.min.css');

.btn-handover {
  background-color: #ffc107;
  color: #212529;
  padding: 0.6rem 1.2rem;
  font-size: 1rem;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
}

.btn-handover:hover:not(:disabled) {
  background-color: #e0a800;
}

.btn-handover:disabled {
  background-color: #e9ecef;
  color: #6c757d;
  cursor: not-allowed;
}

.btn-handover i {
  margin-right: 0.5rem;
}

/* 頁面與標題 */
.log-page-container {
  padding: 0.5rem;
  background-color: #f8f9fa;
}
.log-page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  padding-bottom: 1.5rem;
  border-bottom: 2px solid #dee2e6;
  flex-wrap: wrap;
  gap: 1rem;
}
.header-left,
.header-right {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  flex-wrap: wrap;
}
h1 {
  font-size: 2rem;
  margin: 0;
  color: #343a40;
}
.date-navigator {
  display: flex;
  align-items: center;
  gap: 10px;
}
.date-navigator button {
  padding: 0.6rem 1.2rem;
  font-size: 1rem;
  border: 1px solid #6c757d;
  background-color: #fff;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
}
.date-navigator button:hover {
  background-color: #e9ecef;
}
.date-display-wrapper {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background-color: #fff;
  border: 1px solid transparent;
  border-radius: 6px;
  padding: 0 10px;
  height: 45px;
  cursor: pointer;
}
.hidden-date-input {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}
.current-date-text {
  font-size: 1.5rem;
  font-weight: bold;
  color: #343a40;
  white-space: nowrap;
}
.weekday-display {
  font-size: 1.5rem;
  font-weight: bold;
  color: #007bff;
}
.status-indicator {
  font-style: italic;
  color: #6c757d;
  font-weight: 500;
}
.export-pdf-btn {
  padding: 0.6rem 1.2rem;
  font-size: 1rem;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s;
  white-space: nowrap;
  background-color: #17a2b8;
  color: white;
  border-color: #17a2b8;
}
.export-pdf-btn:hover:not(:disabled) {
  background-color: #138496;
}
.export-pdf-btn:disabled {
  background-color: #6c757d;
  cursor: not-allowed;
  opacity: 0.7;
}

/* 主要內容區 */
.log-page-main {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}
.log-section {
  background-color: #fff;
  padding: 1.5rem;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
}
.section-header h2 {
  margin: 0;
  padding: 0;
  border: none;
  font-size: 1.5rem;
  color: #495057;
}
.add-row-btn-header {
  padding: 0.5rem 1rem;
  font-size: 0.9rem;
  font-weight: 500;
  background-color: #007bff;
  color: white;
  border: 1px solid #007bff;
  border-radius: 6px;
  cursor: pointer;
}

/* 統計表格 */
.stats-grid {
  display: grid;
  grid-template-columns: 140px 220px repeat(3, 1fr) 120px;
  border: 1px solid #dee2e6;
  border-radius: 8px;
  overflow: hidden;
}
.stats-grid > div {
  padding: 0.75rem;
  border-bottom: 1px solid #e9ecef;
  border-right: 1px solid #e9ecef;
  display: flex;
  align-items: center;
  justify-content: center;
}
.stats-grid > div:last-child {
  border-right: none;
}
.stats-grid tr > td:last-child {
  border-right: none;
}
.stats-grid > div:nth-child(6n) {
  border-right: none;
}
.stats-grid .grid-header {
  font-weight: bold;
  background-color: #f8f9fa;
}
.cell-item {
  font-weight: 500;
  background-color: #f8f9fa;
  justify-content: flex-start;
}
.cell-category {
  justify-content: flex-start;
}
.rowspan-2 {
  grid-row: span 2;
}
.rowspan-3 {
  grid-row: span 3;
}
.rowspan-4 {
  grid-row: span 4;
}
.cell-data {
  font-size: 1.2rem;
  font-weight: bold;
}
.total-a {
  background-color: #fffbe3;
}
.total-final {
  background-color: #e3fafc;
  font-size: 1.3rem;
}
.cell-input input {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid #ced4da;
  border-radius: 4px;
  text-align: center;
  font-size: 1.1rem;
}
.cell-input input:disabled {
  background-color: #e9ecef;
  cursor: not-allowed;
  color: #6c757d;
}

/* 護理人力整合表格樣式 */
.toggle-details-btn {
  background: none;
  border: 1px solid #ced4da;
  padding: 0.4rem 0.8rem;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
  color: #495057;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  transition: all 0.2s;
}
.toggle-details-btn:hover {
  background-color: #e9ecef;
}
.nested-header {
  background-color: #f8f9fa;
  font-size: 0.9rem;
  font-weight: 500;
  color: #495057;
  padding: 0.5rem;
}
.cell-item.nested-header {
  background-color: #f0f2f5;
}
.label-count-header {
  display: flex;
  justify-content: space-between;
  width: 100%;
}
.label-count-header span:first-child {
  flex-grow: 1;
  text-align: left;
}
.label-count-header span:last-child {
  width: 60px;
  text-align: center;
}
.nested-item {
  background-color: #fff;
  padding: 0.4rem;
}
.cell-item.nested-item {
  background-color: #f0f2f5;
}
.cell-category.nested-item {
  justify-content: flex-start;
}
.label-count-cell {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}
.label-count-cell .label-input {
  flex-grow: 1;
}
.label-count-cell .count-input {
  width: 60px;
  flex-shrink: 0;
}
.nested-item input {
  width: 100%;
  padding: 0.4rem;
  border: 1px solid #ced4da;
  border-radius: 4px;
  text-align: center;
  font-size: 1rem;
}
.action-cell {
  display: flex;
  align-items: center;
  justify-content: center;
}
.delete-btn.mini {
  padding: 0.4rem 0.6rem;
  font-size: 0.8rem;
  flex-shrink: 0;
}
.deduction-row {
  background-color: #fffbe3 !important;
  font-weight: 500;
  font-style: italic;
  color: #6c757d;
}
.deduction-row.cell-category {
  justify-content: center;
}
.add-row-cell {
  grid-column: 2 / -1;
  justify-content: flex-end !important;
  padding: 0.5rem !important;
  background-color: #f0f2f5;
}

/* ================================== */
/* ✅ [核心優化區塊] 病人動態表 & 通路表 */
/* ================================== */
.dynamic-table-container {
  width: 100%;
  overflow-x: auto;
}
.dynamic-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed; /* 讓寬度設定更可控 */
}
.dynamic-table th,
.dynamic-table td {
  border: 1px solid #dee2e6;
  padding: 0.5rem 0.75rem; /* 微調 padding */
  text-align: left;
  vertical-align: middle;
  font-size: 0.95rem; /* 微調字體大小 */
  white-space: nowrap; /* ✅ 關鍵：防止內容換行 */
}
.dynamic-table th {
  background-color: #f8f9fa;
  font-weight: 500;
  text-align: center;
}
.dynamic-table input[type='text'],
.dynamic-table input[type='date'] {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid transparent;
  border-radius: 4px;
  transition: border-color 0.2s;
  font-size: inherit; /* ✅ 讓 input 字體與 td 一致 */
}
.dynamic-table input:focus {
  outline: none;
  border-color: #80bdff;
}
/* 讓可變寬度欄位內容可以換行 */
.dynamic-table .col-reason-wide,
.dynamic-table .col-remarks-wide {
  white-space: normal;
  word-wrap: break-word;
  overflow-wrap: break-word;
}
/* 顯示模式文字自動換行 */
.dynamic-table .wrap-text {
  display: block;
  white-space: pre-wrap;
  word-wrap: break-word;
  overflow-wrap: break-word;
  line-height: 1.4;
}
/* 編輯模式 textarea 樣式 */
.dynamic-table .wrap-textarea {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid #80bdff;
  border-radius: 4px;
  font-size: inherit;
  font-family: inherit;
  resize: vertical;
  line-height: 1.4;
}
/* 欄位寬度設定 */
.dynamic-table .col-type {
  width: 90px;
}
.dynamic-table .col-name {
  width: 100px;
}
.dynamic-table .col-mrn {
  width: 100px;
}
.dynamic-table .col-bed {
  width: 90px;
}
.dynamic-table .col-date {
  width: 160px;
}
.dynamic-table .col-physician {
  width: 90px;
}
.dynamic-table .col-actions {
  width: 150px; /* ✅ 增加寬度以容納兩個按鈕 */
}
.dynamic-table .col-interventions-wide {
  width: 380px;
}
.dynamic-table .col-location {
  width: 120px;
}
/* `col-reason-wide` 和 `col-remarks-wide` 不設寬度，讓它們自動分配 */

.delete-btn,
.save-btn,
.edit-btn {
  padding: 0.4rem 0.8rem;
  font-size: 0.9rem;
  border-radius: 6px;
  cursor: pointer;
  border: none;
  white-space: nowrap; /* 確保按鈕文字不換行 */
}
.delete-btn {
  background-color: #dc3545;
  color: white;
}
.delete-btn:hover {
  background-color: #c82333;
}
.edit-btn {
  background-color: #ffc107;
  color: #212529;
}
.save-btn {
  background-color: #007bff;
  color: white;
}
.save-btn:hover {
  background-color: #0056b3;
}

/* 組長簽核區塊的文字按鈕樣式 */
.action-text-btn {
  background: none;
  border: none;
  padding: 0.2rem 0.5rem;
  font-size: 0.85rem;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  cursor: pointer;
  border-radius: 4px;
  transition: background-color 0.2s;
}
.action-text-btn.edit-btn {
  color: #0d6efd;
}
.action-text-btn.edit-btn:hover {
  background-color: rgba(13, 110, 253, 0.1);
}
.action-text-btn.unsign-btn {
  color: #dc3545;
}
.action-text-btn.unsign-btn:hover {
  background-color: rgba(220, 53, 69, 0.1);
}

.action-buttons-group {
  display: flex;
  gap: 0.5rem; /* 按鈕之間的間距 */
  justify-content: center;
}

.bed-change-cell {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.5rem;
  box-sizing: border-box;
  border-radius: 4px;
  background-color: #f8f9fa;
  border: 1px dashed transparent;
  color: #495057;
  font-weight: 500;
  transition: all 0.2s;
}
.bed-change-cell.is-clickable {
  cursor: pointer;
  border-color: #ced4da;
}
.bed-change-cell.is-clickable:hover {
  border-color: #007bff;
  background-color: #e7f1ff;
  color: #0056b3;
}
.autocomplete-wrapper {
  position: relative;
}
:deep(.global-autocomplete-results) {
  position: fixed;
  max-height: 200px;
  overflow-y: auto;
  background-color: #fff;
  border: 1px solid #ced4da;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
  list-style: none;
  padding: 0;
  margin: 0;
  z-index: 1000;
  border-radius: 4px;
}
:deep(.global-autocomplete-results li) {
  padding: 0.5rem 0.75rem;
  cursor: pointer;
  white-space: nowrap;
}
:deep(.global-autocomplete-results li:hover) {
  background-color: #e9ecef;
}
:deep(.global-autocomplete-results .no-results) {
  padding: 0.5rem 0.75rem;
  color: #6c757d;
  cursor: default;
}
.checkbox-group {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}
.checkbox-group label {
  display: flex;
  align-items: center;
  gap: 0.3rem;
}
.autoresize-textarea-wrapper {
  position: relative;
}
.handover-textarea {
  width: 100%;
  padding: 1rem;
  font-size: 1.1rem;
  line-height: 1.6;
  border: 1px solid #ced4da;
  border-radius: 6px;
  resize: none;
  overflow-y: hidden;
  min-height: 50px;
  box-sizing: border-box;
}
.handover-textarea:disabled {
  background-color: #e9ecef;
  color: #6c757d;
  cursor: not-allowed;
}
.log-page-footer {
  margin-top: 1rem;
  padding-top: 1.5rem;
  border-top: 1px solid #e9ecef;
}
.leader-signature-grid {
  display: grid;
  grid-template-columns: 140px repeat(3, 1fr);
  align-items: center;
  gap: 1.5rem;
  max-width: 900px;
}
.leader-title {
  font-size: 1.2rem;
  font-weight: 500;
  color: #495057;
  justify-self: start;
}
.signature-slot {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 0.75rem;
}
.shift-label {
  font-size: 1.1rem;
  color: #495057;
  font-weight: 500;
  white-space: nowrap;
}
.sign-btn {
  width: 100px;
  padding: 0.6rem 1.2rem;
  font-size: 1rem;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
  background-color: #007bff;
  color: white;
  border: 1px solid #007bff;
}
.sign-btn:hover {
  background-color: #0056b3;
}
.signature-display {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  height: 45px;
  padding: 4px 8px;
  background-color: #f8f9fa;
  border: 1px solid #dee2e6;
  border-radius: 6px;
  gap: 0.5rem;
  min-width: 160px;
}
.signature-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.leader-name {
  font-size: 1.1rem;
  font-weight: bold;
}
.leader-stamp {
  font-family: 'KaiTi', '標楷體', serif;
  color: #c82333;
  border: 2px solid #c82333;
  border-radius: 8px;
  padding: 2px 8px;
  letter-spacing: 2px;
  font-weight: bold;
  transform: rotate(-5deg);
  user-select: none;
  box-shadow: 0 0 2px rgba(0, 0, 0, 0.2);
  white-space: nowrap;
}
.signature-time {
  font-size: 0.8rem;
  color: #6c757d;
  font-weight: 500;
  align-self: flex-end;
  padding-bottom: 2px;
}
.signature-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.loading-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(255, 255, 255, 0.8);
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}
.loading-spinner {
  border: 8px solid #f3f3f3;
  border-top: 8px solid #007bff;
  border-radius: 50%;
  width: 60px;
  height: 60px;
  animation: spin 1s linear infinite;
  margin-bottom: 1rem;
}
@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}
.notes-display-for-pdf {
  display: none;
  white-space: pre-wrap;
  font-family: inherit;
  font-size: 1.1rem;
  line-height: 1.6;
  padding: 1rem;
  border: 1px solid #dee2e6;
  border-radius: 6px;
  min-height: 50px;
  word-break: break-word;
}
.pdf-export-mode .handover-textarea {
  display: none;
}
.pdf-export-mode .notes-display-for-pdf {
  display: block;
}
.pdf-export-mode .log-page-header {
  padding-bottom: 0.5rem;
  margin-bottom: 1rem;
  border: none;
}
.pdf-export-mode .log-section {
  padding: 1rem;
  margin-bottom: 1rem !important;
  box-shadow: none;
  border: 1px solid #dee2e6;
}
.pdf-export-mode h2 {
  margin-bottom: 1rem;
  font-size: 1.3rem;
  padding-bottom: 0.5rem;
}
.pdf-export-mode .stats-grid {
  grid-template-columns: 120px 140px repeat(3, 1fr) 80px;
}
.pdf-export-mode .stats-grid > div {
  padding: 0.5rem;
}
.pdf-export-mode .dynamic-table th,
.pdf-export-mode .dynamic-table td {
  padding: 0.4rem;
}
.pdf-export-mode .dynamic-table input {
  padding: 0.3rem;
  font-size: 0.9rem;
  background-color: #f8f9fa;
}
.pdf-export-mode .add-row-btn-header {
  display: none;
}
.pdf-export-mode .leader-signature-grid {
  gap: 1rem;
}
.pdf-export-mode .sign-btn,
.pdf-export-mode .unsign-btn,
.pdf-export-mode .edit-btn {
  box-shadow: none;
  border-width: 1px;
}
.mobile-only {
  display: none;
}
.desktop-only {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

/* 病人動態相關 CSS */
.movement-type-badge {
  display: inline-block;
  padding: 3px 8px;
  border-radius: 12px;
  font-size: 0.8em;
  font-weight: bold;
  color: white;
  white-space: nowrap;
}
.movement-type-badge.type-新增 {
  background-color: #28a745;
}
.movement-type-badge.type-刪除 {
  background-color: #dc3545;
}
.movement-type-badge.type-轉移 {
  background-color: #17a2b8;
}
.movement-type-badge.type-轉入 {
  background-color: #17a2b8;
}
.movement-type-badge.type-轉出 {
  background-color: #20c997;
}
.movement-type-badge.type-復原 {
  background-color: #ffc107;
  color: #212529;
}
.movement-type-badge.type-編輯 {
  background-color: #6c757d;
}
.movement-type-badge.type-更改頻率 {
  background-color: #15990e8b;
}
.movement-type-badge.type-更改模式 {
  background-color: #1090f2;
}
.movement-type-badge.type-手動 {
  background-color: #6c757d;
}
.movement-type-badge.type-首透 {
  background-color: #fd7e14;
}
.movement-type-badge.type-暫停透析 {
  background-color: #6610f2;
}
.movement-type-badge.type-刪除排程 {
  background-color: #e83e8c;
}
.movement-type-badge.type-轉常規門診 {
  background-color: #df3bb6;
}
.movement-type-badge.type-其他 {
  background-color: #adb5bd;
}

.dynamic-table input:read-only,
.dynamic-table input:disabled {
  background-color: #f8f9fa;
  cursor: default;
  border-color: transparent;
  color: #495057;
}

.dynamic-table tr.is-edited-row {
  background-color: #fffbe3;
}

/* 下拉選單的樣式 */
.type-select {
  width: 100%;
  padding: 0.4rem;
  border: 1px solid #007bff;
  border-radius: 4px;
  background-color: #e7f1ff;
  font-weight: 500;
}

/* 行動版 */
@media (max-width: 992px) {
  .desktop-only {
    display: none !important;
  }
  .mobile-only {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .log-page-header {
    flex-direction: column;
    align-items: flex-start;
  }
  h1 {
    font-size: 1.5rem;
  }
  .date-navigator {
    width: 100%;
    justify-content: space-between;
  }
  .current-date-text,
  .weekday-display {
    font-size: 1.2rem;
  }
}

.mobile-section-card {
  background-color: #fff;
  padding: 1rem;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.mobile-section-title {
  font-size: 1.2rem;
  font-weight: 600;
  margin: 0 0 1rem 0;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid #e9ecef;
}

/* 營運統計 */
.mobile-stats-container {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  margin-bottom: 1rem;
}

.stat-card,
.stat-highlight-card {
  padding: 1rem;
  border-radius: 6px;
  text-align: center;
}

.stat-card {
  background-color: #f8f9fa;
  border: 1px solid #e9ecef;
}

.stat-highlight-card {
  grid-column: 1 / -1; /* 佔滿整行 */
  background-color: #e3fafc;
  border: 1px solid #a5f3fc;
}

.stat-value {
  font-size: 1.8rem;
  font-weight: bold;
  color: #007bff;
}

.stat-highlight-card .stat-value {
  color: #0891b2;
}

.stat-label {
  font-size: 0.9rem;
  color: #6c757d;
  font-weight: 500;
}

.mobile-text-stats {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  font-size: 0.95rem;
  background-color: #f8f9fa;
  padding: 0.75rem;
  border-radius: 6px;
}
.text-stat-item span {
  color: #343a40;
}

/* 病人動態、血管通路 */
.log-entry-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.log-entry-card {
  border: 1px solid #dee2e6;
  border-radius: 6px;
  overflow: hidden;
}

.entry-header {
  padding: 0.5rem 0.75rem;
  background-color: #f8f9fa;
  font-size: 1rem;
  font-weight: 500;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.entry-body {
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  font-size: 0.9rem;
}

.entry-body strong {
  color: #495057;
}

.no-data-text {
  color: #6c757d;
  font-style: italic;
  padding: 1rem 0;
  text-align: center;
}

/* 其他事項 */
.handover-notes-display {
  white-space: pre-wrap;
  background-color: #f8f9fa;
  padding: 0.75rem;
  border-radius: 6px;
  line-height: 1.6;
}

/* 簽核 */
.mobile-signatures {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  font-size: 1rem;
}
.signature-item {
  display: flex;
  justify-content: space-between;
  padding: 0.5rem 0;
  border-bottom: 1px solid #f1f3f5;
}
.signature-item:last-child {
  border-bottom: none;
}
.signature-item .signed {
  font-weight: bold;
  color: #16a34a; /* 綠色 */
}
/* ✨ 核心修改 8: 新增公告設定按鈕的樣式 */
.btn-marquee-settings {
  background-color: #f59e0b;
  color: white;
  padding: 0.6rem 1.2rem;
  font-size: 1rem;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  border: none;
}
.btn-marquee-settings:hover:not(:disabled) {
  background-color: #d97706;
}
.btn-marquee-settings:disabled {
  background-color: #e9ecef;
  color: #6c757d;
  cursor: not-allowed;
}
.btn-marquee-settings i {
  margin-right: 0.5rem;
}
</style>
