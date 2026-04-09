<!-- 檔案路徑: src/views/NursingScheduleView.vue (完整重構版 + 日期保護) -->
<template>
  <div class="nursing-schedule-container">
    <header class="page-header">
      <div class="header-main-content">
        <h1 class="page-title">護理班表與職責</h1>
        <p class="page-description">原始Excel班表請刪除第2、3、5列後，再執行上傳功能。</p>
      </div>
    </header>

    <!-- 頁籤導覽列 -->
    <nav class="tabs-nav">
      <button :class="{ active: activeTab === 'master' }" @click="activeTab = 'master'">
        當月總班表
      </button>
      <button :class="{ active: activeTab === 'weekly' }" @click="activeTab = 'weekly'">
        當月週班表
      </button>
      <button
        :class="{ active: activeTab === 'responsibilities' }"
        @click="activeTab = 'responsibilities'"
      >
        護理當班分組工作職責
      </button>
    </nav>

    <!-- 頁籤內容區域 -->
    <main class="tab-content">
      <!-- 1. 當月總班表 -->
      <div v-if="activeTab === 'master'" class="tab-pane master-tab-layout">
        <!-- 合併的控制區域 -->
        <section class="controls-section">
          <div class="controls-left">
            <label for="schedule-month">月份：</label>
            <input
              type="month"
              id="schedule-month"
              v-model="selectedMonth"
              @change="loadMonthlySchedule"
            />
            <button @click="loadMonthlySchedule" :disabled="isLoadingSchedule" class="btn-primary">
              {{ isLoadingSchedule ? '載入中...' : '重新載入' }}
            </button>
          </div>

          <!-- ✨ 權限控制：只有 admin 才看得到上傳區塊 -->
          <div class="controls-right" v-if="auth.isAdmin.value">
            <label class="file-upload-label">
              <input
                type="file"
                @change="handleFileUpload"
                accept=".xlsx, .xls"
                :disabled="isUploading"
                class="file-input-hidden"
              />
              <span class="btn-secondary">
                <i class="fas fa-file-excel"></i>
                {{ selectedFile ? selectedFile.name : '選擇檔案' }}
              </span>
            </label>
            <button
              @click="processAndUpload"
              :disabled="!selectedFile || isUploading"
              class="btn-primary"
            >
              {{ isUploading ? '上傳中...' : '上傳班表' }}
            </button>
          </div>
        </section>

        <!-- 上傳狀態訊息 -->
        <div
          v-if="uploadStatus"
          :class="['status-message', uploadStatus.includes('成功') ? 'success' : 'error']"
        >
          {{ uploadStatus }}
        </div>

        <!-- 班表顯示區域 -->
        <section class="schedule-display-section">
          <div v-if="isLoadingSchedule" class="loading-schedule">
            <div class="spinner"></div>
            <span>正在載入班表資料...</span>
          </div>

          <div v-else-if="!monthlySchedule || !monthlySchedule.scheduleByNurse" class="no-schedule">
            <i class="fas fa-calendar-times"></i>
            <p>本月尚無班表資料</p>
            <!-- ✨ 提示文字也只對 admin 顯示 -->
            <p class="hint" v-if="auth.isAdmin.value">請點擊右上方「選擇檔案」上傳 Excel 班表</p>
          </div>

          <div v-else class="schedule-table-wrapper">
            <h3>{{ monthlySchedule.title || `${selectedMonth} 護理班表` }}</h3>

            <table class="schedule-table">
              <thead>
                <tr>
                  <th class="nurse-name-col">護理師</th>
                  <th
                    v-for="dayInfo in monthDays"
                    :key="`day-${dayInfo.day}`"
                    :class="['date-col', { weekend: dayInfo.isWeekend }]"
                  >
                    <div class="date-num">{{ dayInfo.day }}</div>
                    <div class="weekday">{{ dayInfo.weekday }}</div>
                  </th>
                </tr>
              </thead>
              <tbody v-if="sortedSchedule && monthDays && monthDays.length > 0">
                <tr v-for="(nurseData, nurseId) in sortedSchedule" :key="`nurse-${nurseId}`">
                  <td class="nurse-name">
                    {{ nurseData.nurseName }}
                    <span v-if="showUsername && nurseData.nurseUsername" class="nurse-username">
                      ({{ nurseData.nurseUsername }})
                    </span>
                  </td>
                  <td
                    v-for="(dayInfo, index) in monthDays"
                    :key="`${nurseId}-day-${index}`"
                    :class="['shift-cell', { weekend: dayInfo.isWeekend }]"
                  >
                    <span
                      v-if="nurseData.shifts && nurseData.shifts[index]"
                      :class="getShiftClass(nurseData.shifts[index])"
                    >
                      {{ nurseData.shifts[index] }}
                    </span>
                    <span v-else class="empty-cell">-</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <!-- 2. 當月週班表 -->
      <div v-if="activeTab === 'weekly'" class="tab-pane weekly-tab-layout">
        <!-- 控制按鈕 -->
        <section class="controls-section">
          <div class="controls-left">
            <label for="schedule-month-weekly">月份：</label>
            <input
              type="month"
              id="schedule-month-weekly"
              v-model="selectedMonth"
              @change="loadMonthlySchedule"
            />
          </div>

          <div class="controls-center">
            <div class="shift-filter-group">
              <button
                :class="['filter-btn', { active: shiftFilter === 'all' }]"
                @click="shiftFilter = 'all'"
              >
                全部
              </button>
              <button
                :class="['filter-btn', { active: shiftFilter === 'day' }]"
                @click="shiftFilter = 'day'"
              >
                只看白班
              </button>
              <button
                :class="['filter-btn', { active: shiftFilter === 'night' }]"
                @click="shiftFilter = 'night'"
              >
                只看夜班
              </button>
            </div>
          </div>

          <div class="controls-right">
            <!-- ✅ [修正] 將匯出按鈕移到權限判斷的外面，並且獨立存在 -->
            <button
              @click="exportWeeklyScheduleToExcel"
              :disabled="!monthlySchedule || activeWeekTab === 0"
              class="btn-success"
              title="將目前顯示的這一週班表匯出為 Excel 檔案"
            >
              <i class="fas fa-file-excel"></i> 匯出本週 Excel
            </button>

            <!-- ✨ 權限控制：將所有編輯相關的按鈕都包在 v-if="auth.isAdmin.value" 中 -->
            <template v-if="auth.isAdmin.value">
              <!-- 班別編輯按鈕 -->
              <button
                v-if="!isShiftEditMode && !isGroupEditMode"
                @click="enterShiftEditMode"
                class="btn-edit"
              >
                編輯班別
              </button>
              <template v-else-if="isShiftEditMode">
                <button @click="saveShiftChanges" :disabled="isUploading" class="btn-primary">
                  {{ isUploading ? '儲存中...' : '儲存班別' }}
                </button>
                <button @click="cancelShiftEditMode" class="btn-secondary">取消</button>
              </template>

              <!-- 組別配置按鈕 -->
              <button
                v-if="!isGroupEditMode && !isShiftEditMode"
                @click="showGroupConfigDialog = true"
                class="btn-config"
                title="設定護理師組別分配規則"
              >
                <i class="fas fa-cog"></i> 組別配置
              </button>

              <!-- 分組編輯按鈕 -->
              <button
                v-if="!isGroupEditMode && !isShiftEditMode"
                @click="enterGroupEditMode"
                class="btn-primary"
              >
                編輯組別
              </button>

              <!-- 編輯模式中的按鈕群組 -->
              <template v-else-if="isGroupEditMode">
                <template v-if="activeWeekTab > 0">
                  <button
                    @click="saveCurrentWeek"
                    :disabled="isUploading"
                    class="btn-success"
                    title="只儲存本週的分組設定"
                  >
                    {{ isUploading ? '儲存中...' : `儲存第${activeWeekTab}週` }}
                  </button>
                  <button
                    @click="redistributeRemainingWeeks"
                    class="btn-warning"
                    title="重新分配未確認週次的組別（若無已確認週次則重新產生整月）"
                  >
                    重新分配剩餘週次
                  </button>
                </template>

                <button @click="saveGroupAssignments" :disabled="isUploading" class="btn-primary">
                  {{ isUploading ? '儲存中...' : '儲存整月分組' }}
                </button>
                <button @click="cancelGroupEditMode" class="btn-secondary">取消編輯</button>
              </template>
            </template>
          </div>
        </section>

        <!-- 上傳狀態訊息 -->
        <div
          v-if="uploadStatus"
          :class="['status-message', uploadStatus.includes('成功') ? 'success' : 'error']"
        >
          {{ uploadStatus }}
        </div>

        <!-- 週班表顯示區域 -->
        <div v-if="isLoadingSchedule" class="loading-schedule">
          <div class="spinner"></div>
          <span>正在載入班表資料...</span>
        </div>
        <div v-else-if="!monthlySchedule" class="no-schedule">
          <i class="fas fa-calendar-times"></i>
          <p>本月尚無班表資料，請至「當月總班表」頁籤上傳</p>
        </div>

        <!-- 統一的頁籤化佈局 (只要有資料就顯示) -->
        <div v-else class="weekly-content-wrapper">
          <!-- 週次頁籤導覽列 (常駐) -->
          <nav class="weekly-tabs-nav">
            <button :class="{ active: activeWeekTab === 0 }" @click="activeWeekTab = 0">
              分組統計
            </button>
            <button
              v-for="(week, index) in weeklyData"
              :key="`tab-${index}`"
              :class="{
                active: activeWeekTab === index + 1,
                confirmed: (tempScheduleWithGroups?.weekConfirmed ??
                  monthlySchedule?.weekConfirmed)?.[`week${index + 1}`],
                unscheduled: !(tempScheduleWithGroups?.weekConfirmed ??
                  monthlySchedule?.weekConfirmed)?.[`week${index + 1}`],
              }"
              @click="activeWeekTab = index + 1"
            >
              第 {{ week.weekNumber }} 週
              <span
                v-if="
                  (tempScheduleWithGroups?.weekConfirmed ?? monthlySchedule?.weekConfirmed)?.[
                    `week${index + 1}`
                  ]
                "
                class="confirmed-badge"
              >
                ✓
              </span>
              <span v-else class="unscheduled-badge"> 未安排 </span>
            </button>
          </nav>

          <!-- 分組儀表板 (頁籤 0 被選中時顯示) -->
          <section v-if="activeWeekTab === 0" class="dashboard-section">
            <h3 class="dashboard-title">護理師分組統計</h3>
            <div class="dashboard-table-wrapper">
              <table class="dashboard-table">
                <thead>
                  <tr>
                    <th
                      v-for="header in groupCountsDashboard.header"
                      :key="header"
                      :class="{
                        'day-shift-header': header.startsWith('白'),
                        'night-shift-header': header.startsWith('晚'),
                        'standby-75-header': header === '預備75',
                      }"
                    >
                      {{ header }}
                    </th>
                  </tr>
                </thead>
                <tbody v-if="groupCountsDashboard">
                  <tr v-for="nurse in groupCountsDashboard.nurses" :key="nurse.id">
                    <td>{{ nurse.name }}</td>
                    <td
                      v-for="group in groupCountsDashboard.header.slice(1)"
                      :key="group"
                      :class="{
                        'day-shift-data': group.startsWith('白'),
                        'night-shift-data': group.startsWith('晚'),
                        'standby-75-data': group === '預備75',
                      }"
                    >
                      {{ nurse.counts[group] || 0 }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <!-- 週班表內容 (根據頁籤切換顯示) -->
          <div class="weekly-schedule-container" :key="`weekly-config-${groupConfigKey}`">
            <template v-for="(weekData, weekIndex) in weeklyData" :key="`week-${weekIndex}`">
              <div v-if="activeWeekTab === weekIndex + 1" class="week-section">
                <h4 class="week-title">
                  第 {{ weekData.weekNumber }} 週 ({{ weekData.startDate }} -
                  {{ weekData.endDate }})
                  <span
                    v-if="tempScheduleWithGroups?.weekConfirmed?.[`week${weekIndex + 1}`]"
                    class="week-confirmed-tag"
                  >
                    已確認
                  </span>
                </h4>
                <div class="week-table-wrapper">
                  <table class="week-table">
                    <thead>
                      <tr>
                        <!-- ✅ [新增] 員工編號的表頭 -->
                        <th class="employee-id-col-weekly">員工編號</th>
                        <th class="nurse-name-col-weekly">護理師</th>
                        <th
                          v-for="(dayInfo, dayIdx) in weekData.days"
                          :key="`header-${dayIdx}`"
                          :class="{
                            weekend: dayInfo.isWeekend,
                            'other-month-header': !dayInfo.isCurrentMonth,
                          }"
                        >
                          {{ dayInfo.displayText }} ({{ dayInfo.weekday }})
                        </th>
                      </tr>
                    </thead>
                    <tbody v-if="filteredSortedSchedule">
                      <tr
                        v-for="(nurseData, nurseId) in filteredSortedSchedule"
                        :key="`nurse-${nurseId}`"
                      >
                        <!-- ✅ [新增] 員工編號的資料格 -->
                        <td class="employee-id-weekly">{{ nurseData.nurseUsername || '-' }}</td>
                        <td class="nurse-name-weekly">{{ nurseData.nurseName }}</td>
                        <td
                          v-for="(dayInfo, dayIdx) in weekData.days"
                          :key="`cell-${nurseId}-${dayIdx}`"
                          :class="{
                            weekend: dayInfo.isWeekend,
                            'other-month': !dayInfo.isCurrentMonth,
                            dimmed: shouldDimCell(nurseData, dayInfo),
                            'is-past': dayInfo.isCurrentMonth && isDateInPast(dayInfo.date),
                          }"
                        >
                          <template v-if="dayInfo.isCurrentMonth">
                            <!-- 班別編輯模式 (只有 admin 能進入 isShiftEditMode) -->
                            <template v-if="isShiftEditMode">
                              <select
                                v-model="
                                  monthlySchedule.scheduleByNurse[nurseId].shifts[dayInfo.dayIndex]
                                "
                                class="shift-select"
                                :disabled="isDateInPast(dayInfo.date)"
                                :class="{ 'is-readonly': isDateInPast(dayInfo.date) }"
                              >
                                <option
                                  v-for="option in shiftOptions"
                                  :key="option"
                                  :value="option"
                                >
                                  {{ option }}
                                </option>
                              </select>
                            </template>
                            <!-- 一般顯示或分組編輯 -->
                            <template v-else>
                              <div
                                v-if="nurseData.shifts && nurseData.shifts[dayInfo.dayIndex]"
                                class="weekly-shift-cell"
                              >
                                <div class="shift-and-standby">
                                  <span :class="getShiftClass(nurseData.shifts[dayInfo.dayIndex])">
                                    {{ nurseData.shifts[dayInfo.dayIndex] }}
                                  </span>
                                  <span
                                    v-if="isStandby75(nurseId, dayInfo.dayIndex)"
                                    class="standby-75-marker"
                                    :class="{
                                      editable:
                                        isGroupEditMode &&
                                        canBeStandby75(nurseId, dayInfo.dayIndex) &&
                                        !isDateInPast(dayInfo.date),
                                    }"
                                    @click="
                                      isGroupEditMode &&
                                      canBeStandby75(nurseId, dayInfo.dayIndex) &&
                                      !isDateInPast(dayInfo.date) &&
                                      toggleStandby75(nurseId, dayInfo.dayIndex)
                                    "
                                    :title="
                                      isGroupEditMode && !isDateInPast(dayInfo.date)
                                        ? '點擊移除預備75班'
                                        : '預備第3個75班'
                                    "
                                  >
                                    ⭐
                                  </span>
                                  <button
                                    v-else-if="
                                      isGroupEditMode &&
                                      canBeStandby75(nurseId, dayInfo.dayIndex) &&
                                      !isDateInPast(dayInfo.date)
                                    "
                                    @click="toggleStandby75(nurseId, dayInfo.dayIndex)"
                                    class="add-standby-btn"
                                    title="設為預備75班"
                                  >
                                    +
                                  </button>
                                </div>
                                <!-- 分組編輯模式 (只有 admin 能進入 isGroupEditMode) -->
                                <template v-if="isGroupEditMode && tempScheduleWithGroups">
                                  <!-- 未來日期：可編輯 -->
                                  <select
                                    v-if="
                                      canAssignGroup(
                                        tempScheduleWithGroups.scheduleByNurse[nurseId].shifts[
                                          dayInfo.dayIndex
                                        ],
                                      ) && !isDateInPast(dayInfo.date)
                                    "
                                    v-model="
                                      tempScheduleWithGroups.scheduleByNurse[nurseId].groups[
                                        dayInfo.dayIndex
                                      ]
                                    "
                                    @change="handleGroupChange(nurseId, dayInfo.dayIndex, $event)"
                                    class="group-select"
                                  >
                                    <option value="">-</option>
                                    <option
                                      v-for="group in getAvailableGroups(
                                        tempScheduleWithGroups.scheduleByNurse[nurseId].shifts[
                                          dayInfo.dayIndex
                                        ],
                                        dayInfo.date,
                                        nurseId,
                                      )"
                                      :key="group"
                                      :value="group"
                                    >
                                      {{ group }} 組
                                    </option>
                                  </select>
                                  <!-- 過去日期：唯讀顯示 -->
                                  <span
                                    v-else-if="
                                      canAssignGroup(
                                        tempScheduleWithGroups.scheduleByNurse[nurseId].shifts[
                                          dayInfo.dayIndex
                                        ],
                                      ) &&
                                      isDateInPast(dayInfo.date) &&
                                      tempScheduleWithGroups.scheduleByNurse[nurseId].groups?.[
                                        dayInfo.dayIndex
                                      ]
                                    "
                                    class="group-badge-readonly"
                                  >
                                    {{
                                      tempScheduleWithGroups.scheduleByNurse[nurseId].groups[
                                        dayInfo.dayIndex
                                      ]
                                    }}
                                    組
                                  </span>
                                  <span
                                    v-else-if="
                                      tempScheduleWithGroups.scheduleByNurse[nurseId].groups &&
                                      tempScheduleWithGroups.scheduleByNurse[nurseId].groups[
                                        dayInfo.dayIndex
                                      ] &&
                                      !canAssignGroup(
                                        tempScheduleWithGroups.scheduleByNurse[nurseId].shifts[
                                          dayInfo.dayIndex
                                        ],
                                      )
                                    "
                                    class="group-badge-fixed"
                                  >
                                    {{
                                      tempScheduleWithGroups.scheduleByNurse[nurseId].groups[
                                        dayInfo.dayIndex
                                      ]
                                    }}
                                    組
                                  </span>
                                </template>
                                <!-- 檢視模式的分組顯示 -->
                                <template v-else>
                                  <span
                                    v-if="nurseData.groups && nurseData.groups[dayInfo.dayIndex]"
                                    :class="[
                                      'group-badge',
                                      getGroupClass(nurseData.groups[dayInfo.dayIndex]),
                                    ]"
                                  >
                                    {{ nurseData.groups[dayInfo.dayIndex] }} 組
                                  </span>
                                </template>
                              </div>
                              <div v-else class="empty-cell">-</div>
                            </template>
                          </template>
                          <!-- 非當月顯示（跨月班表） -->
                          <template v-else>
                            <div
                              class="other-month-cell"
                              :class="{
                                'adjacent-loading': adjacentMonthsLoading,
                                'adjacent-not-uploaded': getAdjacentMonthData(nurseId, dayInfo)
                                  ?.notUploaded,
                              }"
                            >
                              <template v-if="adjacentMonthsLoading">
                                <span class="loading-dot">...</span>
                              </template>
                              <template
                                v-else-if="getAdjacentMonthData(nurseId, dayInfo)?.notUploaded"
                              >
                                <span class="not-uploaded-text">未上傳</span>
                              </template>
                              <template v-else>
                                <div class="adjacent-shift-cell">
                                  <span class="adjacent-shift">{{
                                    getAdjacentMonthData(nurseId, dayInfo)?.shift || '-'
                                  }}</span>
                                  <span
                                    v-if="getAdjacentMonthData(nurseId, dayInfo)?.isStandby"
                                    class="standby-75-marker adjacent"
                                    title="預備75班"
                                  >
                                    ⭐
                                  </span>
                                  <span
                                    v-if="getAdjacentMonthData(nurseId, dayInfo)?.group"
                                    class="group-badge adjacent"
                                    :class="`group-${getAdjacentMonthData(nurseId, dayInfo)?.group}`"
                                  >
                                    {{ getAdjacentMonthData(nurseId, dayInfo)?.group }} 組
                                  </span>
                                </div>
                              </template>
                            </div>
                          </template>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>

      <!-- 3. 護理當班分組工作職責 -->
      <div v-if="activeTab === 'responsibilities'" class="tab-pane responsibilities-tab-layout">
        <header class="pane-header">
          <h2 class="table-title">洗腎中心當班分組工作職責</h2>
          <div class="header-actions">
            <span
              v-if="lastModifiedInfo.date"
              class="revision-date"
              :title="`最後修改者: ${lastModifiedInfo.user}`"
            >
              {{ lastModifiedInfo.date }} 修改
            </span>
            <!-- ✨ 權限控制：只有 admin 才看得到儲存按鈕 -->
            <button
              v-if="auth.isAdmin.value"
              @click="saveData"
              :disabled="!hasChanges"
              class="save-button"
              title="儲存所有修改"
            >
              <i class="fas fa-save"></i> 儲存
            </button>
          </div>
        </header>

        <section class="info-section">
          <div @click="enterEditMode('announcement', 0, 'content')">
            <div
              v-if="!isEditing('announcement', 0, 'content')"
              class="editable-text announcement-text"
              v-html="formatText(announcementText)"
            ></div>
            <textarea
              v-else
              :ref="(el) => setInputRef(el)"
              v-model="announcementText"
              @blur="exitEditMode"
              class="edit-input announcement-input"
            ></textarea>
          </div>
        </section>

        <section class="duties-section">
          <table class="duties-table">
            <thead>
              <tr>
                <th class="shift-type-col">班別</th>
                <th class="shift-code-col">班次代碼</th>
                <th class="tasks-col">各組負責項目</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td class="shift-type-cell"><strong>白班</strong></td>
                <td @click="enterEditMode('dayShift', 0, 'codes')">
                  <div
                    v-if="!isEditing('dayShift', 0, 'codes')"
                    class="editable-text"
                    v-html="formatText(dayShiftData.codes)"
                  ></div>
                  <textarea
                    v-else
                    :ref="(el) => setInputRef(el)"
                    v-model="dayShiftData.codes"
                    @blur="exitEditMode"
                    class="edit-input"
                  ></textarea>
                </td>
                <td @click="enterEditMode('dayShift', 0, 'tasks')">
                  <div
                    v-if="!isEditing('dayShift', 0, 'tasks')"
                    class="editable-text task-text"
                    v-html="formatText(dayShiftData.tasks)"
                  ></div>
                  <textarea
                    v-else
                    :ref="(el) => setInputRef(el)"
                    v-model="dayShiftData.tasks"
                    @blur="exitEditMode"
                    class="edit-input"
                  ></textarea>
                </td>
              </tr>
              <tr v-for="(duty, index) in nightShiftDuties" :key="`night-${index}`">
                <td v-if="index === 0" :rowspan="nightShiftDuties.length" class="shift-type-cell">
                  <strong>夜班</strong>
                </td>
                <td @click="enterEditMode('nightShift', index, 'code')">
                  <span v-if="!isEditing('nightShift', index, 'code')" class="editable-text">{{
                    duty.code
                  }}</span>
                  <input
                    v-else
                    :ref="(el) => setInputRef(el)"
                    v-model="duty.code"
                    @blur="exitEditMode"
                    class="edit-input-inline"
                  />
                </td>
                <td @click="enterEditMode('nightShift', index, 'tasks')">
                  <div
                    v-if="!isEditing('nightShift', index, 'tasks')"
                    class="editable-text task-text"
                    v-html="formatText(duty.tasks)"
                  ></div>
                  <textarea
                    v-else
                    :ref="(el) => setInputRef(el)"
                    v-model="duty.tasks"
                    @blur="exitEditMode"
                    class="edit-input"
                  ></textarea>
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <div class="closing-section">
          <div class="closing-column">
            <h3 class="table-title">關門前結束檢查</h3>
            <div class="checklist">
              <div
                v-for="(item, index) in checklistItems"
                :key="index"
                @click="enterEditMode('checklist', index, 'item')"
                class="check-item"
              >
                <span class="checkbox"></span>
                <span v-if="!isEditing('checklist', index, 'item')" class="editable-text">{{
                  item
                }}</span>
                <input
                  v-else
                  :ref="(el) => setInputRef(el)"
                  v-model="checklistItems[index]"
                  @blur="exitEditMode"
                  class="edit-input-inline"
                />
              </div>
            </div>
          </div>
          <div class="closing-column">
            <h3 class="table-title">互助合作組</h3>
            <div class="teamwork-list">
              <div
                v-for="(item, index) in teamworkItems"
                :key="index"
                @click="enterEditMode('teamwork', index, 'item')"
              >
                <div
                  v-if="!isEditing('teamwork', index, 'item')"
                  class="editable-text"
                  v-html="formatText(item)"
                ></div>
                <textarea
                  v-else
                  :ref="(el) => setInputRef(el)"
                  v-model="teamworkItems[index]"
                  @blur="exitEditMode"
                  class="edit-input"
                ></textarea>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>

    <!-- 護理組別配置 Dialog -->
    <NursingGroupConfigDialog
      v-model="showGroupConfigDialog"
      :year-month="selectedMonth"
      @saved="onGroupConfigSaved"
    />

    <!-- 組別衝突提示 Dialog -->
    <AlertDialog
      :is-visible="showGroupConflictAlert"
      title="組別衝突提示"
      :message="groupConflictMessage"
      @confirm="showGroupConflictAlert = false"
    />
  </div>
</template>

<script setup>
// ✨ Standalone 版本
// ========================================
// 1. 引入 (Imports)
// ========================================
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import * as XLSX from 'xlsx'
import ApiManager from '@/services/api_manager'
import { nursingApi } from '@/services/localApiClient'
import { useAuth } from '@/composables/useAuth'
import { useGlobalNotifier } from '@/composables/useGlobalNotifier.js'
import { useGroupAssigner } from '@/composables/useGroupAssigner.js'
import {
  fetchNursingGroupConfig,
  getDefaultConfig,
  calculate74Groups,
  generateDayShiftGroups,
  generateNightShiftGroups,
} from '@/services/nursingGroupConfigService'
import NursingGroupConfigDialog from '@/components/NursingGroupConfigDialog.vue'
import AlertDialog from '@/components/AlertDialog.vue'

// ========================================
// 2. Composables 初始化
// ========================================
const { createGlobalNotification } = useGlobalNotifier()
const auth = useAuth()

// ========================================
// 3. 狀態管理 (State)
// ========================================
// --- 通用狀態 ---
const activeTab = ref('master')
const hasChanges = ref(false)
const editingCell = ref(null)
let inputRef = null

// --- "當月總班表" 頁籤的狀態 ---
const selectedFile = ref(null)
const isUploading = ref(false)
const isLoadingSchedule = ref(true)
const uploadStatus = ref('')
const monthlySchedule = ref(null)
const selectedMonth = ref(new Date().toISOString().slice(0, 7))
const showUsername = ref(false)

// --- 跨月班表狀態 ---
const prevMonthSchedule = ref(null) // 上個月班表
const nextMonthSchedule = ref(null) // 下個月班表
const adjacentMonthsLoading = ref(false) // 載入相鄰月份中

// --- "當月週班表" 頁籤的狀態 ---
const isGroupEditMode = ref(false)
const tempScheduleWithGroups = ref(null)
const activeWeekTab = ref(1)
const isShiftEditMode = ref(false)
const hasUnsavedShiftChanges = ref(false)
const shiftFilter = ref('all') // 'all', 'day', 'night'

// --- "工作職責" 頁籤的狀態 ---
const announcementText = ref('')
const dayShiftData = ref({ codes: '', tasks: '' })
const nightShiftDuties = ref([])
const checklistItems = ref([])
const teamworkItems = ref([])
const lastModifiedInfo = ref({ date: '', user: '' })

// --- 護理組別配置 ---
const groupConfig = ref(getDefaultConfig())
const configSourceMonth = ref(null) // 配置來源月份
const showGroupConfigDialog = ref(false)
const groupConfigKey = ref(0) // 用於強制刷新組別相關元件

// --- 組別衝突提示 ---
const showGroupConflictAlert = ref(false)
const groupConflictMessage = ref('')

// ========================================
// 4. API 實例
// ========================================
const usersApi = ApiManager('users')
const nursingSchedulesApi = ApiManager('nursing_schedules')

// ========================================
// 5. 常數定義
// ========================================
const shiftOptions = ref(['', '74', '75', '816', '74/L', '311', '休', '例', '國定'])

// ========================================
// 6. 計算屬性 (Computed Properties)
// ========================================
// 動態資料來源，供 Composable 使用
const scheduleSourceForStats = computed(() => {
  return isGroupEditMode.value ? tempScheduleWithGroups.value : monthlySchedule.value
})

// 相鄰月份班表（供跨月約束檢查用）
const adjacentSchedules = computed(() => ({
  prev: prevMonthSchedule.value,
  next: nextMonthSchedule.value,
}))

// 使用 Composable (傳入配置和相鄰月份班表)
const {
  groupCountsDashboard,
  generateGroupAssignments,
  redistributeRemainingWeeks: redistributeWeeks,
  currentConfig,
} = useGroupAssigner(scheduleSourceForStats, groupConfig, adjacentSchedules)

// 檢查是否有已確認的週次
const hasConfirmedWeeks = computed(() => {
  if (!tempScheduleWithGroups.value?.weekConfirmed) return false
  return Object.values(tempScheduleWithGroups.value.weekConfirmed).some((confirmed) => confirmed)
})

const monthDays = computed(() => {
  const source = isGroupEditMode.value ? tempScheduleWithGroups.value : monthlySchedule.value
  if (!source?.yearMonth && !selectedMonth.value) return []
  const yearMonth = source?.yearMonth || selectedMonth.value
  const [year, month] = yearMonth.split('-').map(Number)
  const daysInMonth = source?.maxDaysInMonth || new Date(year, month, 0).getDate()
  const weekdays = ['日', '一', '二', '三', '四', '五', '六']
  const days = []
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month - 1, day)
    const dayOfWeek = date.getDay()
    days.push({
      day: day,
      weekday: weekdays[dayOfWeek],
      isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
    })
  }
  return days
})

// 統一排序邏輯
const sortedSchedule = computed(() => {
  const scheduleData = isGroupEditMode.value ? tempScheduleWithGroups.value : monthlySchedule.value
  if (!scheduleData || !scheduleData.scheduleByNurse) {
    return {}
  }
  const nurses = Object.entries(scheduleData.scheduleByNurse)

  if (scheduleData.processingOrder && scheduleData.processingOrder.length > 0) {
    const orderMap = new Map(scheduleData.processingOrder.map((id, index) => [id, index]))
    nurses.sort((a, b) => {
      const orderA = orderMap.get(a[0]) ?? 999
      const orderB = orderMap.get(b[0]) ?? 999
      return orderA - orderB
    })
  } else {
    nurses.sort((a, b) => {
      const numA = parseInt(a[0]) || 999
      const numB = parseInt(b[0]) || 999
      if (numA !== numB) {
        return numA - numB
      }
      return a[0].localeCompare(b[0])
    })
  }

  return Object.fromEntries(nurses)
})

const weeklyData = computed(() => {
  const source = isGroupEditMode.value ? tempScheduleWithGroups.value : monthlySchedule.value
  if (!source) return []

  // ✅ [修正] 添加備援邏輯：如果 yearMonth 不存在，使用 selectedMonth.value
  const yearMonth = source.yearMonth || selectedMonth.value
  if (!yearMonth) return []

  const [year, month] = yearMonth.split('-').map(Number)
  const weekdays = ['日', '一', '二', '三', '四', '五', '六']
  const weeks = []

  const firstDayOfMonth = new Date(year, month - 1, 1)
  const lastDayOfMonth = new Date(year, month, 0)
  const firstDayWeekday = firstDayOfMonth.getDay() // 0=週日, 1=週一, ...
  const lastDate = lastDayOfMonth.getDate()
  const lastDayWeekday = lastDayOfMonth.getDay()

  // 找到包含1號的週的週一
  // 如果1號是週日(0)，則第一週從2號(週一)開始
  // 否則，往前找到週一
  let firstWeekMonday
  if (firstDayWeekday === 0) {
    // 1號是週日，第一週從2號開始
    firstWeekMonday = new Date(year, month - 1, 2)
  } else if (firstDayWeekday === 1) {
    // 1號是週一，第一週從1號開始
    firstWeekMonday = new Date(year, month - 1, 1)
  } else {
    // 1號是週二到週六，往前找週一(可能在上個月)
    const daysBack = firstDayWeekday - 1
    firstWeekMonday = new Date(year, month - 1, 1 - daysBack)
  }

  // 找到包含最後一天的週的週六
  // 注意：週日不在班表中，所以如果最後一天是週日，最後一週結束於前一天（週六）
  let lastWeekSaturday
  if (lastDayWeekday === 6) {
    // 最後一天是週六
    lastWeekSaturday = new Date(year, month - 1, lastDate)
  } else if (lastDayWeekday === 0) {
    // 最後一天是週日，最後一週結束於前一天（週六）
    lastWeekSaturday = new Date(year, month - 1, lastDate - 1)
  } else {
    // 最後一天是週一到週五，往後找週六
    const daysForward = 6 - lastDayWeekday
    lastWeekSaturday = new Date(year, month - 1, lastDate + daysForward)
  }

  // 生成所有天數（週一到週六，排除週日）
  const allDays = []
  const currentDate = new Date(firstWeekMonday)

  while (currentDate <= lastWeekSaturday) {
    const dayOfWeek = currentDate.getDay()

    // 只包含週一(1)到週六(6)，跳過週日(0)
    if (dayOfWeek !== 0) {
      const dayYear = currentDate.getFullYear()
      const dayMonth = currentDate.getMonth() + 1
      const dayDate = currentDate.getDate()
      const isCurrentMonth = dayYear === year && dayMonth === month
      const isPrevMonth = dayYear < year || (dayYear === year && dayMonth < month)
      const isNextMonth = dayYear > year || (dayYear === year && dayMonth > month)

      let adjacentYearMonth = null
      if (isPrevMonth || isNextMonth) {
        adjacentYearMonth = `${dayYear}-${String(dayMonth).padStart(2, '0')}`
      }

      allDays.push({
        date: `${dayYear}-${String(dayMonth).padStart(2, '0')}-${String(dayDate).padStart(2, '0')}`,
        day: dayDate,
        month: dayMonth,
        year: dayYear,
        weekday: weekdays[dayOfWeek],
        isWeekend: dayOfWeek === 6, // 週六
        dayIndex: dayDate - 1, // 在該月份的 0-based index
        isCurrentMonth,
        isPrevMonth,
        isNextMonth,
        adjacentYearMonth,
        displayText: isCurrentMonth ? `${dayDate}` : `${dayMonth}/${dayDate}`,
      })
    }

    currentDate.setDate(currentDate.getDate() + 1)
  }

  // 按每6天分組（週一到週六）
  let weekNumber = 1
  for (let i = 0; i < allDays.length; i += 6) {
    const weekDays = allDays.slice(i, i + 6)
    if (weekDays.length > 0) {
      const firstDay = weekDays[0]
      const lastDay = weekDays[weekDays.length - 1]
      weeks.push({
        weekNumber: weekNumber++,
        days: weekDays,
        startDate: `${firstDay.month}/${firstDay.day}`,
        endDate: `${lastDay.month}/${lastDay.day}`,
      })
    }
  }
  return weeks
})

const filteredSortedSchedule = computed(() => {
  if (shiftFilter.value === 'all' || activeWeekTab.value === 0) {
    return sortedSchedule.value
  }
  const filtered = {}
  Object.entries(sortedSchedule.value).forEach(([nurseId, nurseData]) => {
    let hasMatchingShift = false
    let hasOnlyHolidays = true
    const currentWeek = weeklyData.value[activeWeekTab.value - 1]
    if (currentWeek) {
      currentWeek.days.forEach((day) => {
        if (day.isCurrentMonth) {
          const shift = nurseData.shifts?.[day.dayIndex]
          if (shift) {
            const s = shift.trim()
            const isHoliday = s.includes('休') || s.includes('例') || s.includes('國定') || s === ''
            if (!isHoliday) {
              hasOnlyHolidays = false
              if (shiftFilter.value === 'day' && isDayShift(shift)) {
                hasMatchingShift = true
              } else if (shiftFilter.value === 'night' && isNightShift(shift)) {
                hasMatchingShift = true
              }
            }
          }
        }
      })
    }
    if (hasMatchingShift && !hasOnlyHolidays) {
      filtered[nurseId] = nurseData
    }
  })
  return filtered
})

// ========================================
// 7. 方法定義 (Methods)
// ========================================
// --- 日期判斷函式 ---
const isDateInPast = (dateStr) => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const checkDate = new Date(dateStr)
  checkDate.setHours(0, 0, 0, 0)
  return checkDate < today
}

// --- 輔助函數 ---
const isStandby75 = (nurseId, dayIndex) => {
  const source = isGroupEditMode.value ? tempScheduleWithGroups.value : monthlySchedule.value
  if (!source || !source.scheduleByNurse[nurseId]) return false
  return source.scheduleByNurse[nurseId].standby75Days?.includes(dayIndex)
}

const canBeStandby75 = (nurseId, dayIndex) => {
  const source = isGroupEditMode.value ? tempScheduleWithGroups.value : monthlySchedule.value
  if (!source || !source.scheduleByNurse[nurseId]) return false
  const shift = source.scheduleByNurse[nurseId].shifts?.[dayIndex]
  return shift === '74'
}

const isNightShift = (shift) => {
  const s = (shift || '').trim()
  return ['311', '3-11'].some((ns) => s.includes(ns))
}

const isDayShift = (shift) => {
  const s = (shift || '').trim()
  return ['74', '74/L', '75', '816', '84', '815'].includes(s)
}

const shouldDimCell = (nurseData, dayInfo) => {
  if (!dayInfo.isCurrentMonth || shiftFilter.value === 'all') return false
  const shift = nurseData.shifts?.[dayInfo.dayIndex]
  if (!shift) return true
  const s = shift.trim()
  if (s.includes('休') || s.includes('例') || s.includes('國定')) {
    return true
  }
  if (shiftFilter.value === 'day' && !isDayShift(shift)) {
    return true
  }
  if (shiftFilter.value === 'night' && !isNightShift(shift)) {
    return true
  }
  return false
}

// 取得相鄰月份的班表資料
const getAdjacentMonthData = (nurseId, dayInfo) => {
  if (dayInfo.isCurrentMonth) return null

  const schedule = dayInfo.isPrevMonth ? prevMonthSchedule.value : nextMonthSchedule.value

  if (!schedule || !schedule.scheduleByNurse) {
    return { notUploaded: true }
  }

  const nurseData = schedule.scheduleByNurse[nurseId]
  if (!nurseData) {
    return { notFound: true }
  }

  const shift = nurseData.shifts?.[dayInfo.dayIndex] || ''
  const group = nurseData.groups?.[dayInfo.dayIndex] || ''
  const isStandby = nurseData.standby75Days?.includes(dayInfo.dayIndex) || false

  return {
    shift: shift.trim(),
    group,
    isStandby,
    notUploaded: false,
    notFound: false,
  }
}

const canAssignGroup = (shift) => {
  const s = (shift || '').trim()
  if (!s || s.includes('休') || s.includes('例') || s.includes('國定')) return false
  return s === '74' || s === '75' || isNightShift(s)
}

const getAvailableGroups = (shift, date, nurseId) => {
  const s = (shift || '').trim()
  const dayOfWeek = new Date(date).getDay()
  const config = groupConfig.value || getDefaultConfig()

  // 根據星期別取得對應設定
  const getWeekdayKey = () => {
    if ([1, 3, 5].includes(dayOfWeek)) return '135'
    return '246' // 二四六及星期日都用246
  }

  // 取得早班星期別設定的輔助函式
  // 74班 = 早班全部組別 - 75班組別（自動計算）
  const getDayShiftGroups = () => {
    const weekdayKey = getWeekdayKey()
    const groupCounts = config.groupCounts || {}
    const dayRules = config.dayShiftRules || {}

    // 根據組數產生早班可用組別
    const dayShiftCount = groupCounts[weekdayKey]?.dayShiftCount || 8
    const dayShiftAvailable = generateDayShiftGroups(dayShiftCount)

    // 取得75班設定的組別
    const shift75Groups = dayRules[weekdayKey]?.shift75Groups || ['F']

    // 74班 = 早班可用組別 - 75班組別
    const shift74Groups = calculate74Groups(dayShiftAvailable, shift75Groups)

    return {
      groups74: shift74Groups,
      groups75: shift75Groups,
    }
  }

  // 取得晚班可用組別
  const getNightShiftGroups = () => {
    const weekdayKey = getWeekdayKey()
    const groupCounts = config.groupCounts || {}
    const nightShiftCount = groupCounts[weekdayKey]?.nightShiftCount || 9
    return generateNightShiftGroups(nightShiftCount)
  }

  if (s === '74') {
    // 從配置讀取74班可用組別（根據星期別，自動計算）
    return getDayShiftGroups().groups74
  }
  if (s === '75') {
    // 從配置讀取75班可用組別（根據星期別）
    return getDayShiftGroups().groups75
  }
  if (['311', '3-11'].some((ns) => s.includes(ns))) {
    // 根據組數產生晚班可用組別
    let groups = [...getNightShiftGroups()]
    // 檢查是否為不能當晚班組長的護理師
    if (nurseId && isGroupEditMode.value && tempScheduleWithGroups.value) {
      const cannotBeNightLeaderIds = config.cannotBeNightLeader || []
      if (cannotBeNightLeaderIds.includes(nurseId)) {
        groups = groups.filter((g) => g !== 'A')
      }
    }
    return groups
  }
  return []
}

const getGroupClass = (group) => {
  if (!group) return ''
  const groupChar = group.charAt(0).toUpperCase()
  if (group === '外圍') return 'group-peripheral'
  return `group-${groupChar}`
}

// 處理組別變更，檢測衝突
const handleGroupChange = (nurseId, dayIndex, event) => {
  const newGroup = event.target.value
  if (!newGroup || !tempScheduleWithGroups.value) return

  // 取得當天已有相同組別的護理師
  const conflictingNurses = []
  const currentNurseData = tempScheduleWithGroups.value.scheduleByNurse[nurseId]
  const currentShift = currentNurseData?.shifts?.[dayIndex]?.trim() || ''

  Object.entries(tempScheduleWithGroups.value.scheduleByNurse).forEach(([otherId, otherData]) => {
    if (otherId === nurseId) return // 跳過自己

    const otherGroup = otherData.groups?.[dayIndex]
    const otherShift = otherData.shifts?.[dayIndex]?.trim() || ''

    // 檢查是否同組別
    if (otherGroup === newGroup) {
      // 判斷班別類型是否相同（白班 vs 夜班）
      const isCurrentDayShift = ['74', '75', '816', '74/L'].includes(currentShift)
      const isOtherDayShift = ['74', '75', '816', '74/L'].includes(otherShift)
      const isCurrentNightShift = currentShift.includes('311') || currentShift.includes('3-11')
      const isOtherNightShift = otherShift.includes('311') || otherShift.includes('3-11')

      // 同類型班別才算衝突（白班對白班，夜班對夜班）
      if ((isCurrentDayShift && isOtherDayShift) || (isCurrentNightShift && isOtherNightShift)) {
        conflictingNurses.push({
          name: otherData.nurseName || otherId,
          shift: otherShift,
        })
      }
    }
  })

  // 如果有衝突，顯示提示
  if (conflictingNurses.length > 0) {
    const conflictList = conflictingNurses.map((n) => `${n.name} (${n.shift}班)`).join('、')
    groupConflictMessage.value = `${conflictList} 已經是 ${newGroup} 組，與您的修改有衝突。\n\n請確認是否需要調整。`
    showGroupConflictAlert.value = true
  }
}

const getShiftClass = (shift) => {
  if (!shift) return ''
  const shiftStr = String(shift).trim()
  const EARLY_SHIFTS = ['74', '75', '84', '74/L', '816', '815']
  const LATE_SHIFTS = ['3-11', '311']
  if (EARLY_SHIFTS.some((s) => shiftStr.includes(s))) return 'shift-badge shift-早班'
  if (LATE_SHIFTS.some((s) => shiftStr.includes(s))) return 'shift-badge shift-晚班'
  if (shiftStr === '休' || shiftStr.includes('休息')) return 'shift-badge shift-休息'
  if (shiftStr === '例' || shiftStr.includes('例假')) return 'shift-badge shift-例假'
  if (shiftStr.includes('國定')) return 'shift-badge shift-國定'
  return 'shift-badge shift-其他'
}

// ✅ [最終修正] 包含標題列和儲存格合併的完整匯出函式
function exportWeeklyScheduleToExcel() {
  // 1. 防呆檢查 (不變)
  if (!monthlySchedule.value || activeWeekTab.value === 0) {
    alert(!monthlySchedule.value ? '沒有班表資料可供匯出。' : '請先選擇一個週次，再進行匯出。')
    return
  }

  // 2. 獲取當前週次資料 (不變)
  const currentWeekIndex = activeWeekTab.value - 1
  const currentWeek = weeklyData.value[currentWeekIndex]
  const nursesToExport = filteredSortedSchedule.value

  if (!currentWeek || !nursesToExport) {
    alert('無法獲取週次資料，請稍後再試。')
    return
  }

  // 3. 建立 Excel 的資料主體
  // 表頭
  const headers = [
    '員工編號',
    '護理師',
    ...currentWeek.days.map((day) => `${day.displayText} (${day.weekday})`),
  ]

  // 資料列
  const dataRows = Object.entries(nursesToExport).map(([nurseId, nurseData]) => {
    const row = [nurseData.nurseUsername || '-', nurseData.nurseName]
    currentWeek.days.forEach((dayInfo) => {
      if (!dayInfo.isCurrentMonth) {
        row.push('-')
        return
      }
      const dayIndex = dayInfo.dayIndex
      const shift = nurseData.shifts?.[dayIndex] || ''
      const group = nurseData.groups?.[dayIndex] || ''
      const isStandby = isStandby75(nurseId, dayIndex)

      let cellText = shift
      if (group) cellText += ` ${group}組`
      if (isStandby) cellText += ' ⭐'

      row.push(cellText.trim() || '-')
    })
    return row
  })

  // ✅ [修正] 4. 建立標題列並組合最終的 Excel 資料
  // 動態生成標題文字
  const excelTitle = `${selectedMonth.value} 第${currentWeek.weekNumber}週 (${currentWeek.startDate} - ${currentWeek.endDate}) 護理班表`

  const titleRow = [excelTitle] // 標題列
  const emptyRow = [] // 空白列，用於間隔

  // 將標題、空白列、表頭、資料列組合在一起
  const dataForSheet = [titleRow, emptyRow, headers, ...dataRows]

  // ✅ [修正] 5. 使用 xlsx 函式庫生成 Excel，並加入儲存格合併
  try {
    const worksheet = XLSX.utils.aoa_to_sheet(dataForSheet)

    // 設定標題列的儲存格合併範圍
    const merge = {
      s: { r: 0, c: 0 }, // s = start, r = row, c = column (從 A1 開始)
      e: { r: 0, c: headers.length - 1 }, // e = end (到第一行的最後一欄結束)
    }
    if (!worksheet['!merges']) worksheet['!merges'] = []
    worksheet['!merges'].push(merge)

    // (可選) 讓標題置中
    if (worksheet['A1']) {
      worksheet['A1'].s = { alignment: { horizontal: 'center', vertical: 'center' } }
    }

    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, `第${currentWeek.weekNumber}週班表`)

    const filename = `護理週班表_${selectedMonth.value}_第${currentWeek.weekNumber}週.xlsx`
    XLSX.writeFile(workbook, filename)
  } catch (error) {
    console.error('匯出 Excel 失敗:', error)
    alert('匯出 Excel 時發生錯誤，請查看主控台訊息。')
  }
}

async function executeShiftSave() {
  isUploading.value = true
  uploadStatus.value = '正在儲存班別變更...'
  try {
    const documentId = selectedMonth.value
    const scheduleDataToSave = monthlySchedule.value.scheduleByNurse
    const adminName = auth.currentUser.value?.name || '未知管理員'

    const dataWithAdmin = {
      scheduleByNurse: scheduleDataToSave,
      lastModifiedBy: adminName,
      lastModifiedAt: new Date(),
    }

    await nursingSchedulesApi.update(documentId, dataWithAdmin)
    uploadStatus.value = `班別變更成功儲存！(由 ${adminName} 確認)`
    createGlobalNotification(`班別已成功更新 (管理員：${adminName})`, 'success')
    isShiftEditMode.value = false
    hasUnsavedShiftChanges.value = false
    await loadMonthlySchedule()
  } catch (error) {
    console.error('儲存護理班別失敗:', error)
    uploadStatus.value = `儲存失敗：${error.message}`
  } finally {
    isUploading.value = false
  }
}

async function executeWeekSave() {
  isUploading.value = true
  uploadStatus.value = `正在儲存第${activeWeekTab.value}週分組...`

  try {
    const weekData = weeklyData.value[activeWeekTab.value - 1]
    if (!weekData) throw new Error('無法取得週次資料')

    const weekDays = weekData.days.filter((d) => d.isCurrentMonth)
    const startIndex = weekDays[0]?.dayIndex
    const endIndex = weekDays[weekDays.length - 1]?.dayIndex

    if (startIndex === undefined || endIndex === undefined) {
      throw new Error('無法確定週次的日期範圍')
    }

    const partialUpdate = {}
    const totalDaysInMonth = monthlySchedule.value.maxDaysInMonth
    Object.entries(tempScheduleWithGroups.value.scheduleByNurse).forEach(([nurseId, nurseData]) => {
      const originalNurseData = monthlySchedule.value.scheduleByNurse[nurseId] || {}
      partialUpdate[nurseId] = { ...originalNurseData }

      const existingGroups = partialUpdate[nurseId].groups || []
      const denseGroups = Array.from(
        { length: totalDaysInMonth },
        (_, k) => existingGroups[k] || '',
      )

      const existingStandbyDays = partialUpdate[nurseId].standby75Days || []
      const denseStandbyDays = Array.from({ length: totalDaysInMonth }, (_, k) =>
        existingStandbyDays.includes(k) ? k : null,
      ).filter((v) => v !== null)

      partialUpdate[nurseId].groups = denseGroups
      partialUpdate[nurseId].standby75Days = denseStandbyDays

      for (let i = startIndex; i <= endIndex; i++) {
        partialUpdate[nurseId].groups[i] = nurseData.groups?.[i] || ''
        const idx = partialUpdate[nurseId].standby75Days.indexOf(i)
        if (idx > -1) {
          partialUpdate[nurseId].standby75Days.splice(idx, 1)
        }
        if (nurseData.standby75Days?.includes(i)) {
          partialUpdate[nurseId].standby75Days.push(i)
        }
      }
      partialUpdate[nurseId].standby75Days.sort((a, b) => a - b)
    })

    const documentId = selectedMonth.value
    const adminName = auth.currentUser.value?.name || '未知管理員'
    const dataToSave = {
      scheduleByNurse: partialUpdate,
      weekConfirmed: {
        ...(monthlySchedule.value.weekConfirmed || {}),
        [`week${activeWeekTab.value}`]: true,
      },
      lastModifiedBy: adminName,
      lastModifiedAt: new Date(),
    }

    await nursingSchedulesApi.update(documentId, dataToSave)

    if (!tempScheduleWithGroups.value.weekConfirmed) {
      tempScheduleWithGroups.value.weekConfirmed = {}
    }
    tempScheduleWithGroups.value.weekConfirmed[`week${activeWeekTab.value}`] = true

    uploadStatus.value = `第${activeWeekTab.value}週分組已儲存！(由 ${adminName} 確認)`
    createGlobalNotification(
      `第${activeWeekTab.value}週分組已成功儲存 (管理員：${adminName})`,
      'success',
    )

    monthlySchedule.value.scheduleByNurse = partialUpdate
    monthlySchedule.value.weekConfirmed = dataToSave.weekConfirmed
  } catch (error) {
    console.error('儲存週次分組失敗:', error)
    uploadStatus.value = `儲存失敗：${error.message}`
  } finally {
    isUploading.value = false
  }
}

async function executeMonthSave() {
  isUploading.value = true
  uploadStatus.value = '正在儲存分組結果...'
  try {
    const documentId = selectedMonth.value
    const adminName = auth.currentUser.value?.name || '未知管理員'
    const dataToSave = {
      scheduleByNurse: tempScheduleWithGroups.value.scheduleByNurse,
      weekConfirmed: tempScheduleWithGroups.value.weekConfirmed || {},
      lastModifiedBy: adminName,
      lastModifiedAt: new Date(),
    }
    await nursingSchedulesApi.update(documentId, dataToSave)
    uploadStatus.value = `分組成功儲存！(由 ${adminName} 確認)`
    createGlobalNotification(`整月分組已成功儲存 (管理員：${adminName})`, 'success')
    isGroupEditMode.value = false
    tempScheduleWithGroups.value = null
    await loadMonthlySchedule()
    activeWeekTab.value = 1
  } catch (error) {
    console.error('儲存護理分組失敗:', error)
    uploadStatus.value = `儲存失敗：${error.message}`
  } finally {
    isUploading.value = false
  }
}

// --- 班別與分組管理 ---
const toggleStandby75 = (nurseId, dayIndex) => {
  if (!isGroupEditMode.value || !tempScheduleWithGroups.value) return

  // 檢查日期是否已過去
  const weekData = weeklyData.value[activeWeekTab.value - 1]
  const dayInfo = weekData?.days.find((d) => d.dayIndex === dayIndex)
  if (dayInfo && isDateInPast(dayInfo.date)) {
    alert('無法修改過去日期的預備班設定')
    return
  }

  Object.values(tempScheduleWithGroups.value.scheduleByNurse).forEach((nurse) => {
    if (!nurse.standby75Days) {
      nurse.standby75Days = []
    }
  })
  const nurseData = tempScheduleWithGroups.value.scheduleByNurse[nurseId]
  const isCurrentStandby = nurseData.standby75Days.includes(dayIndex)
  Object.values(tempScheduleWithGroups.value.scheduleByNurse).forEach((nurse) => {
    const idx = nurse.standby75Days.indexOf(dayIndex)
    if (idx > -1) {
      nurse.standby75Days.splice(idx, 1)
    }
  })
  if (!isCurrentStandby) {
    nurseData.standby75Days.push(dayIndex)
    nurseData.standby75Days.sort((a, b) => a - b)
  }
}

async function saveCurrentWeek() {
  if (!tempScheduleWithGroups.value || activeWeekTab.value === 0) return

  // 檢查是否整週都是過去
  const weekData = weeklyData.value[activeWeekTab.value - 1]
  const hasAnyFutureDay = weekData.days.some((d) => d.isCurrentMonth && !isDateInPast(d.date))

  if (!hasAnyFutureDay) {
    alert('此週已完全過去，無法修改')
    return
  }

  await executeWeekSave()
}

async function saveShiftChanges() {
  if (!hasUnsavedShiftChanges.value) {
    alert('沒有偵測到任何變更。')
    return
  }
  await executeShiftSave()
}

async function saveGroupAssignments() {
  if (!tempScheduleWithGroups.value) return
  await executeMonthSave()
}

function redistributeRemainingWeeks() {
  if (!tempScheduleWithGroups.value || !confirm('這將重新分配所有未確認的週次，確定要繼續嗎？')) {
    return
  }
  uploadStatus.value = '正在重新分配剩餘週次...'
  try {
    const newSchedule = redistributeWeeks(tempScheduleWithGroups.value, weeklyData.value)
    if (newSchedule) {
      tempScheduleWithGroups.value = newSchedule
      uploadStatus.value = '已重新分配剩餘週次的組別'
    } else {
      uploadStatus.value = '重新分配失敗'
    }
  } catch (error) {
    console.error('重新分配失敗:', error)
    uploadStatus.value = `重新分配失敗：${error.message}`
  }
}

function enterShiftEditMode() {
  if (!monthlySchedule.value) {
    alert('請先載入月班表資料！')
    return
  }
  isShiftEditMode.value = true
  hasUnsavedShiftChanges.value = false
  uploadStatus.value = ''
}

function cancelShiftEditMode() {
  if (hasUnsavedShiftChanges.value) {
    if (confirm('您有未儲存的班別修改，確定要放棄嗎？')) {
      isShiftEditMode.value = false
      hasUnsavedShiftChanges.value = false
      loadMonthlySchedule()
    }
  } else {
    isShiftEditMode.value = false
  }
}

function enterGroupEditMode() {
  if (!monthlySchedule.value) {
    alert('請先載入月班表資料！')
    return
  }
  const hasGroups = Object.values(monthlySchedule.value.scheduleByNurse).some(
    (nurse) => nurse.groups && nurse.groups.some((g) => g),
  )
  if (!hasGroups) {
    tempScheduleWithGroups.value = generateGroupAssignments(monthlySchedule.value)
  } else {
    tempScheduleWithGroups.value = JSON.parse(JSON.stringify(monthlySchedule.value))
  }
  if (!tempScheduleWithGroups.value.weekConfirmed) {
    tempScheduleWithGroups.value.weekConfirmed = monthlySchedule.value.weekConfirmed || {
      week1: false,
      week2: false,
      week3: false,
      week4: false,
      week5: false,
    }
  }
  activeWeekTab.value = 0
  isGroupEditMode.value = true
}

function cancelGroupEditMode() {
  isGroupEditMode.value = false
  tempScheduleWithGroups.value = null
  uploadStatus.value = ''
  activeWeekTab.value = 1
}

// --- 檔案處理 ---
function handleFileUpload(event) {
  selectedFile.value = event.target.files[0]
  uploadStatus.value = ''
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = (error) => reject(error)
  })
}

async function processAndUpload() {
  if (!selectedFile.value) {
    uploadStatus.value = '請先選擇一個 Excel 檔案'
    return
  }

  isUploading.value = true
  uploadStatus.value = '正在上傳並解析班表...'

  try {
    // 將檔案轉換為 Base64
    const base64Data = await fileToBase64(selectedFile.value)
    const fileName = selectedFile.value.name

    // 呼叫本地 API 上傳
    const result = await nursingApi.uploadSchedule(base64Data, fileName)

    if (result.success) {
      uploadStatus.value = `班表上傳成功！(${result.title}, ${result.nurseCount} 位護理師)`
      // 重新載入班表
      selectedMonth.value = result.documentId
      await loadMonthlySchedule()
      selectedFile.value = null
    } else {
      uploadStatus.value = '上傳失敗：伺服器回應錯誤'
    }
  } catch (error) {
    console.error('上傳班表失敗:', error)
    uploadStatus.value = `上傳失敗：${error.message || '未知錯誤'}`
  } finally {
    isUploading.value = false
  }
}

// 計算相鄰月份的輔助函式
function getAdjacentMonths(yearMonth) {
  const [year, month] = yearMonth.split('-').map(Number)

  const prevYear = month === 1 ? year - 1 : year
  const prevMonth = month === 1 ? 12 : month - 1
  const prevYearMonth = `${prevYear}-${String(prevMonth).padStart(2, '0')}`

  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  const nextYearMonth = `${nextYear}-${String(nextMonth).padStart(2, '0')}`

  return { prevYearMonth, nextYearMonth }
}

async function loadMonthlySchedule() {
  isLoadingSchedule.value = true
  uploadStatus.value = ''
  cancelGroupEditMode()
  isShiftEditMode.value = false
  hasUnsavedShiftChanges.value = false
  try {
    const documentId = selectedMonth.value
    const schedule = await nursingSchedulesApi.fetchById(documentId)
    monthlySchedule.value = schedule || null
    activeWeekTab.value = 1

    // 非同步載入相鄰月份班表（不阻塞主流程）
    loadAdjacentMonthSchedules(documentId)
  } catch (error) {
    console.error('❌ 載入月班表失敗:', error)
    monthlySchedule.value = null
  } finally {
    isLoadingSchedule.value = false
  }
}

// 載入相鄰月份班表
async function loadAdjacentMonthSchedules(currentYearMonth) {
  adjacentMonthsLoading.value = true
  prevMonthSchedule.value = null
  nextMonthSchedule.value = null

  try {
    const { prevYearMonth, nextYearMonth } = getAdjacentMonths(currentYearMonth)

    // 並行載入上下月班表
    const [prevSchedule, nextSchedule] = await Promise.all([
      nursingSchedulesApi.fetchById(prevYearMonth).catch(() => null),
      nursingSchedulesApi.fetchById(nextYearMonth).catch(() => null),
    ])

    prevMonthSchedule.value = prevSchedule || null
    nextMonthSchedule.value = nextSchedule || null
  } catch (error) {
    console.error('❌ 載入相鄰月份班表失敗:', error)
  } finally {
    adjacentMonthsLoading.value = false
  }
}

// --- "工作職責" 頁籤相關函式 ---
const formatText = (text) => {
  if (!text) return ''
  let escapedText = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const groups = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'ICU']
  const qwGroups = ['QW1', 'QW2', 'QW3', 'QW4', 'QW5', 'QW6', 'QW7']
  const allGroups = [...groups, ...qwGroups]
  allGroups.forEach((group) => {
    const patterns = [
      new RegExp(`\\b${group}\\s*組[:：]?`, 'g'),
      new RegExp(`^${group}\\s*[:：]`, 'gm'),
      new RegExp(`(?<=[，,、]\\s*)${group}\\s*組`, 'g'),
    ]
    patterns.forEach((pattern) => {
      escapedText = escapedText.replace(
        pattern,
        (match) => `<span class="group-tag group-${group}">${match}</span>`,
      )
    })
  })
  escapedText = escapedText.replace(/^(※[^\n]*)/gm, '<span class="group-tag is-note">$1</span>')
  escapedText = escapedText.replace(
    /^(組長[:：][^\n]*)/gm,
    '<span class="group-tag is-leader">$1</span>',
  )
  escapedText = escapedText.replace(
    /^(互助小組長[:：][^\n]*)/gm,
    '<span class="group-tag is-leader">$1</span>',
  )
  escapedText = escapedText.replace(/^(\d+\.\s)/gm, '<span class="group-tag is-numeric">$1</span>')
  return escapedText
}

const setInputRef = (el) => {
  if (el) inputRef = el
}

const enterEditMode = async (type, rowIndex, field) => {
  if (!(auth && auth.isAdmin.value)) return
  editingCell.value = { type, rowIndex, field }
  await nextTick()
  if (inputRef) {
    inputRef.focus()
    inputRef.select()
  }
}

const exitEditMode = () => {
  editingCell.value = null
}

const isEditing = (type, rowIndex, field) => {
  return (
    editingCell.value?.type === type &&
    editingCell.value?.rowIndex === rowIndex &&
    editingCell.value?.field === field
  )
}

const loadData = async () => {
  // 模擬從後端載入資料
  announcementText.value =
    '一、班別規則：護病比為1:4為原則，採團隊分工方式執行，無法執行時主動告知與協助。\n二、休息時間：實際狀況依各組協調調整，給予30分鐘。務必配合以免影響他人，白班為11:00-11:30；11:30-12:00；13:20-13:50，晚班為18:00-18:30；18:30-19:00；19:00-19:30。\n三、各班組別工作內容'
  dayShiftData.value = {
    codes: '7-3*9\n8-4*1\n7-5*2',
    tasks:
      'A 組：預備機化消及測餘氯。\nB 組：點班(急救車、電擊器測試)。備 12-8，午班用物。\nQW3 血糖機測試並上傳測試數值。 (試劑沒有向檢驗科拿，試紙沒了請書記備)\nC 組：支援 ICU 組(含備機)，如 ICU 組被 P，接 ICU 組， ICU 機台化消及餘氯檢測，需 cover ICU 組吃飯時間 30 分鐘(要自行電話與 ICU 組約時間但要避開 OPD 上下針時間 11:30-13:00)。\nD 組：送消、點班(衛材、庫房溫溼度)、整理供應室衛材歸位， NO.1。\nE 組：點班(氧療、冰箱溫度、補充冰箱常備藥)。 NO.2。每月最後一周 W1 須執行氧氣桶鋼瓶 查核表(114.07.17)\nF 組：電訪關心病患， NO.3。\nG 組：協助準備醫師拔 D/L 備物及病人觀察。\nH 組： 住院組。\nI 組： 住院組。\nJ 組： W3 泡製 3 桶消毒液。 W6 幫忙協助收行動 RO 機(若 ICU 組無法收機時)\nK 組：擔任 Leader。\nICU 組：接 ICU 組， ICU 機台化消及餘氯檢測， W6 協助收行動 RO 機。\n※若放 P 一整天，則該組工作由 G 組負責。\n※若當日僅有十組組別，組長則併入 A 組， A 組負責工作由 G 組協助完成。\n※白班 12-8 組別由 Leader 安排。',
  }
  nightShiftDuties.value = [
    {
      code: '3-11*8or9',
      tasks:
        'A 組: 擔任 Leader，核對當日人數， 將當日護理日誌、排程，隔天分組匯出轉 PDF 黨並存檔 (114.09.01 更新) ， 下班前須到 PD 衛教室電腦開啟隔日診間叫號系統(114.09.22 更新)。\nB 組: 10PM 後核對隔日娃娃頭與電腦排程是否一致，並須製作隔日早班洗腎住院床 病人移動方式，排主護(排到中班收針列)及 Leader 牌。備隔日 B 組 AK。\nC 組: 接 ICU 組，協同 B 組核對隔日娃娃頭、 W4 補充 ICU 消毒液，備隔日 C+D 組 AK。若 G 組 放 P 時，備 K 組 AK。\nD 組: 點班(衛材)，備隔日 E+F 組 AK， NO.1。\nE 組: 點班(氧療、冰箱)、備隔日 I+J 組 AK， NO.2，若 H 組放 P，協助點班(急 救車)。\nF 組: 接 12-8，備隔日 G+H 組 AK。 (每月 1 號點消防箱物資，遇假日順延。 )， NO.3。\nG 組: 住院組、 備隔日 K 組 AK。\nH 組: 住院組、 點班(急救車) 。\nI 組: 備隔日 A 組 AK。關門前結束檢查(項目見背面)若 C 組去洗 ICU，則協同 B 組核對隔日 娃娃頭。\n※若當日僅有 8 組組別， I 組負責工作由 A 組協助完成。\nQW4 夜班倒酸。\n 若放 P3-8 班，放 P 人員須自行完成該組工作職責。\n 每個月雙週的 W5 需刷機器。\n 每週星期一夜班汙水管需倒漂白水(A 組倒 1-7 床； B 組倒 8-15； C 組倒 16-22 床； D 組 倒 23-29 床； E 組倒 35-41 床； F 組倒 42-48 床； G 組倒 49-55 床； H 組倒 31-33 床)(若 H 組放 P 則由 G 組協助倒漂白水)',
    },
  ]
  checklistItems.value = [
    '電視儀器電源，遙控器收回。',
    '周圍設備歸位，空桶補好，管路放好。',
    '1234 門及庫房門上鎖。',
    '護理車關機，物品確認補充否。',
    '儀器及病床周邊消毒無血漬。',
    '護理站餐桌維持整齊，無標示者丟棄。',
    '護理站關電腦及燈光。',
    '檢體送檢。',
  ]
  teamworkItems.value = [
    '組長: C. A. B. C. 一組。',
    '組長: F. D. E. F. 一組（夜班加 I 組）。',
    '組長: H. G. H. I. 一組。',
    '互助小組長: (現場至少要有三位巡視)',
    '1. 關懷分配同仁用餐。',
    '2. 用餐前確認工作並告知病人誰 COVER。',
    '3. COVER 者主動巡視病人或協助查房。',
  ]
  lastModifiedInfo.value = { date: '114.09.22', user: '系統預設' }
  await nextTick()
  hasChanges.value = false
}

const saveData = async () => {
  if (!hasChanges.value || !(auth && auth.isAdmin.value)) return
  try {
    const now = new Date()
    const formattedDate = `${now.getFullYear() - 1911}.${String(now.getMonth() + 1).padStart(
      2,
      '0',
    )}.${String(now.getDate()).padStart(2, '0')}`
    const currentUserFullName = auth.currentUser.value?.name || '未知使用者'
    const rawPayload = {
      announcement: announcementText.value,
      dayShift: dayShiftData.value,
      nightShift: nightShiftDuties.value,
      checklist: checklistItems.value,
      teamwork: teamworkItems.value,
      lastModified: { date: formattedDate, user: currentUserFullName },
    }
    const payload = JSON.parse(JSON.stringify(rawPayload))
    // 此處假設 saveDuties 是您的 API 呼叫
    // await saveDuties(payload)
    lastModifiedInfo.value = payload.lastModified
    hasChanges.value = false
    exitEditMode()
    createGlobalNotification('工作職責已成功儲存！', 'success')
  } catch (error) {
    createGlobalNotification(error.message || '儲存失敗，請稍後再試', 'error')
  }
}

// ========================================
// 8. 監聽器 (Watchers)
// ========================================
watch(
  monthlySchedule,
  (newValue, oldValue) => {
    if (isShiftEditMode.value && oldValue) {
      hasUnsavedShiftChanges.value = true
    }
  },
  { deep: true },
)

watch(activeTab, (newTab) => {
  if (newTab !== 'weekly') {
    shiftFilter.value = 'all'
  }
})

watch(
  [announcementText, dayShiftData, nightShiftDuties, checklistItems, teamworkItems],
  () => {
    hasChanges.value = true
  },
  { deep: true },
)

// ========================================
// 9. 生命週期 (Lifecycle Hooks)
// ========================================
// 載入護理組別配置
const loadGroupConfig = async () => {
  try {
    const result = await fetchNursingGroupConfig(selectedMonth.value)
    groupConfig.value = {
      ...getDefaultConfig(),
      ...result.config,
    }
    configSourceMonth.value = result.sourceMonth
    console.log(`✅ 護理組別配置已載入 (來源: ${result.sourceMonth || '預設值'})`)
  } catch (error) {
    console.error('❌ 載入護理組別配置失敗:', error)
    // 使用預設配置
    groupConfig.value = getDefaultConfig()
    configSourceMonth.value = null
  }
}

// 配置儲存後的回調
const onGroupConfigSaved = (newConfig) => {
  groupConfig.value = newConfig
  configSourceMonth.value = selectedMonth.value // 更新來源月份
  groupConfigKey.value++ // 強制刷新組別相關元件
  uploadStatus.value = `${selectedMonth.value} 組別配置已更新`
}

// 監聽月份變更，重新載入配置
watch(selectedMonth, async (newMonth, oldMonth) => {
  if (newMonth && newMonth !== oldMonth) {
    await loadGroupConfig()
  }
})

onMounted(() => {
  loadGroupConfig() // 載入組別配置
  loadMonthlySchedule()
  loadData()
})
</script>

<style scoped>
/* ===== 基礎容器樣式 ===== */
.nursing-schedule-container {
  padding: 10px;
  background-color: #f8f9fa;
  display: flex;
  flex-direction: column;
  height: calc(100vh - 100px);
}
.page-title {
  font-size: 32px;
  font-weight: bold;
  color: #2c3e50;
  margin: 0 0 1.2rem 0;
  flex-shrink: 0;
}
.page-description {
  font-size: 1rem;
  color: #6c757d;
}
.tab-content {
  flex-grow: 1;
  overflow-y: hidden;
  display: flex;
  flex-direction: column;
}
.tab-pane {
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.master-tab-layout {
  gap: 1rem;
}

/* ===== 【✨ 核心修復 ✨】: 為其他兩個頁籤的容器加上滾動 ===== */
.weekly-tab-layout,
.responsibilities-tab-layout {
  overflow-y: auto;
}
.weekly-tab-layout {
  display: flex;
  flex-direction: column;
}

/* ===== 頁籤導覽 ===== */
.tabs-nav {
  display: flex;
  border-bottom: 2px solid #dee2e6;
  margin-bottom: 1.5rem;
  flex-shrink: 0;
}
.tabs-nav button {
  padding: 0.8rem 1.5rem;
  font-size: 1rem;
  font-weight: 600;
  border: none;
  background-color: transparent;
  cursor: pointer;
  color: #495057;
  position: relative;
  transition: color 0.2s;
}
.tabs-nav button::after {
  content: '';
  position: absolute;
  bottom: -2px;
  left: 0;
  width: 100%;
  height: 2px;
  background-color: #1abc9c;
  transform: scaleX(0);
  transition: transform 0.3s ease;
}
.tabs-nav button.active {
  color: #1abc9c;
}
.tabs-nav button.active::after {
  transform: scaleX(1);
}
/* ===== 合併的控制區域 ===== */
/* 🔄 調整控制區域的佈局 */
.controls-section {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.8rem 1rem;
  background-color: #fff;
  border-radius: 6px;
  border: 1px solid #dee2e6;
  gap: 1rem;
  flex-shrink: 0;
  margin-bottom: 1rem;
  flex-wrap: wrap;
}
.controls-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

.controls-center {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  margin: 0 0.5rem;
}

.controls-right {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  justify-content: flex-end;
  flex: 1;
}
.controls-section label {
  font-weight: 500;
  color: #495057;
  font-size: 0.9rem;
}
.controls-section input[type='month'] {
  padding: 0.4rem 0.8rem;
  border: 1px solid #dee2e6;
  border-radius: 4px;
  font-size: 0.9rem;
}
/* 按鈕樣式 */
.btn-primary,
.btn-secondary,
.btn-edit,
.btn-config,
.btn-success,
.btn-warning {
  padding: 0.4rem 1rem;
  border: none;
  border-radius: 4px;
  font-size: 0.9rem;
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
.btn-secondary:hover {
  background-color: #f8f9fa;
  border-color: #adb5bd;
}
/* 編輯按鈕樣式 */
.btn-edit {
  background-color: #ffc107;
  color: #212529;
  border: 1px solid #ffc107;
}
.btn-edit:hover:not(:disabled) {
  background-color: #e0a800;
}
/* 配置按鈕樣式 */
.btn-config {
  background-color: #6c757d;
  color: white;
  border: 1px solid #6c757d;
}
.btn-config:hover:not(:disabled) {
  background-color: #5a6268;
}
/* 新增按鈕樣式 */
.btn-success {
  background-color: #28a745;
  color: white;
}
.btn-success:hover:not(:disabled) {
  background-color: #218838;
}
.btn-success:disabled {
  background-color: #6c757d;
  cursor: not-allowed;
  opacity: 0.65;
}
.btn-warning {
  background-color: #ffc107;
  color: #212529;
}
.btn-warning:hover:not(:disabled) {
  background-color: #e0a800;
}
.btn-warning:disabled {
  background-color: #e9ecef;
  color: #6c757d;
  cursor: not-allowed;
  opacity: 0.65;
}

/* 檔案上傳樣式 */
.file-upload-label {
  display: inline-block;
  cursor: pointer;
}
.file-input-hidden {
  display: none;
}
/* 狀態訊息 */
.status-message {
  padding: 0.5rem 1rem;
  border-radius: 4px;
  font-size: 0.9rem;
  animation: slideDown 0.3s ease;
  flex-shrink: 0;
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
@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
/* ===== Loading 和 Spinner ===== */
.loading-schedule,
.no-schedule {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem;
  color: #6c757d;
  background-color: #fff;
  border-radius: 8px;
  flex-grow: 1;
}
.no-schedule i {
  font-size: 3rem;
  margin-bottom: 1rem;
  opacity: 0.5;
}
.no-schedule .hint {
  font-size: 0.9rem;
  color: #868e96;
}
.spinner {
  width: 30px;
  height: 30px;
  border: 3px solid #f3f3f3;
  border-top: 3px solid #007bff;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 auto 1rem auto;
}
@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

/* ===== 總班表樣式 ===== */
.schedule-display-section {
  flex-grow: 1;
  min-height: 0;
  display: flex;
}

.schedule-table-wrapper {
  overflow: auto;
  border: 1px solid #dee2e6;
  border-radius: 8px;
  background: white;
  flex-grow: 1;
}

.schedule-table-wrapper h3 {
  text-align: center;
  padding: 1rem;
  margin: 0;
  background-color: #f8f9fa;
  border-bottom: 1px solid #dee2e6;
  font-size: 1.2rem;
  font-weight: 600;
  color: #2c3e50;
  position: sticky;
  top: 0;
  z-index: 12;
}

.schedule-table {
  width: 100%;
  min-width: 1200px;
  border-collapse: collapse;
  font-size: 0.85rem;
}
.schedule-table th,
.schedule-table td {
  border: 1px solid #dee2e6;
  padding: 0.4rem;
  text-align: center;
  vertical-align: middle;
}
.schedule-table thead {
  position: sticky;
  top: 58px;
  z-index: 11;
}
.schedule-table th {
  background-color: #f8f9fa;
  font-weight: 600;
}
.nurse-name-col {
  width: 100px;
  position: sticky;
  left: 0;
  z-index: 11;
  background-color: #f8f9fa !important;
}
.nurse-name {
  position: sticky;
  left: 0;
  z-index: 5;
  background-color: #fff;
  font-weight: 500;
  width: 100px;
  min-width: 100px;
  border-right: 1px solid #dee2e6;
}
.nurse-username {
  font-size: 0.7rem;
  color: #6c757d;
  font-style: italic;
  margin-left: 0.25rem;
}
.schedule-table tbody tr:hover td,
.schedule-table tbody tr:hover .nurse-name {
  background-color: #f5f5f5;
}
.schedule-table tbody tr:nth-child(even) .nurse-name {
  background-color: #f8f9fa;
}
.date-col {
  width: 60px;
  min-width: 60px;
}
.date-col.weekend {
  background-color: #fff5f5 !important;
}
.date-num {
  font-weight: 600;
}
.weekday {
  font-size: 0.75rem;
  color: #6c757d;
  margin-top: 2px;
}
.shift-cell {
  padding: 0.2rem;
}
.shift-cell.weekend {
  background-color: #fffafa;
}
.shift-badge {
  display: inline-block;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 600;
  font-size: 0.8rem;
  min-width: 35px;
}
.shift-早班 {
  background-color: #fff3cd;
  color: #856404;
}
.shift-晚班 {
  background-color: #cce5ff;
  color: #004085;
}
.shift-休息 {
  background-color: #f8d7da;
  color: #721c24;
}
.shift-例假 {
  background-color: #e2e3e5;
  color: #383d41;
}
.shift-國定 {
  background-color: #d4edda;
  color: #155724;
}
.shift-其他 {
  background-color: #e7e7e7;
  color: #495057;
}
.empty-cell {
  color: #dee2e6;
}
/* 週次頁籤導覽列 */
.weekly-tabs-nav {
  display: flex;
  flex-wrap: wrap;
  border-bottom: 2px solid #007bff;
  margin-bottom: 1.5rem;
  margin-top: 1rem;
}
.weekly-tabs-nav button {
  padding: 0.6rem 1.2rem;
  font-size: 0.95rem;
  font-weight: 600;
  border: none;
  background-color: transparent;
  cursor: pointer;
  color: #495057;
  border-radius: 6px 6px 0 0;
  margin-bottom: -2px;
  transition: all 0.2s ease-in-out;
}
.weekly-tabs-nav button:hover {
  background-color: #e9ecef;
}
.weekly-tabs-nav button.active {
  color: #0056b3;
  background-color: #fff;
  border: 2px solid #007bff;
  border-bottom: 2px solid #fff;
}
/* 已確認週次的樣式 */
.weekly-tabs-nav button.confirmed {
  background-color: #d4edda;
}
.confirmed-badge {
  color: #28a745;
  font-weight: bold;
  margin-left: 4px;
}
/* 未安排週次的樣式 */
.weekly-tabs-nav button.unscheduled {
  background-color: #fff3cd;
}
.unscheduled-badge {
  color: #856404;
  font-size: 0.8em;
  margin-left: 4px;
}
.week-confirmed-tag {
  display: inline-block;
  background-color: #28a745;
  color: white;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.85em;
  margin-left: 10px;
  font-weight: normal;
}

/* ===== 週班表樣式 ===== */
.weekly-content-wrapper {
  flex-grow: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.weekly-schedule-container,
.view-mode-container {
  margin-top: 1.5rem;
}
.week-section {
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  overflow: hidden;
  background-color: #fff;
  animation: fadeIn 0.5s;
}
@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
.week-title {
  background-color: #f8f9fa;
  padding: 0.8rem 1.2rem;
  margin: 0;
  font-size: 1.2rem;
  border-bottom: 1px solid #e0e0e0;
}
.week-table-wrapper {
  overflow-x: auto;
}
.week-table {
  width: 100%;
  border-collapse: collapse;
}
.week-table th,
.week-table td {
  border: 1px solid #e9ecef;
  padding: 0.6rem;
  text-align: center;
  min-width: 120px;
}
.week-table th {
  background-color: #f1f3f5;
  font-weight: 600;
}

.employee-id-col-weekly,
.employee-id-weekly {
  position: sticky;
  left: 0; /* ✅ [修正] 補上星號，變成正確的 CSS 註解 */
  background-color: #f8f9fa;
  font-weight: 500;
  z-index: 1;
  min-width: 80px;
  width: 80px;
  border-right: 1px solid #dee2e6;
}

.nurse-name-col-weekly,
.nurse-name-weekly {
  position: sticky;
  left: 80px; /* ✅ [修正] 改成正確的 CSS 註解語法 */
  background-color: #f8f9fa;
  font-weight: 500;
  z-index: 1;
  min-width: 100px;
  width: 100px;
}

.week-table .weekend {
  background-color: #fff5f5;
}
/* 讓週班表格子稍微調整以容納星號 */
.weekly-shift-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.3rem;
  min-height: 60px;
  justify-content: center;
}
.group-badge {
  font-weight: bold;
  padding: 2px 8px;
  border-radius: 12px;
  color: white;
  font-size: 0.85em;
}

.group-badge.group-A {
  background-color: #c0392b;
}
.group-badge.group-B {
  background-color: #27ae60;
}
.group-badge.group-C {
  background-color: #2980b9;
}
.group-badge.group-D {
  background-color: #8e44ad;
}
.group-badge.group-E {
  background-color: #f39c12;
}
.group-badge.group-F {
  background-color: #d35400;
}
.group-badge.group-G {
  background-color: #7f8c8d;
}
.group-badge.group-H {
  background-color: #34495e;
}
.group-badge.group-I {
  background-color: #16a085;
}
.group-badge.group-J {
  background-color: #2c3e50;
}
.group-badge.group-K {
  background-color: #95a5a6;
}
.group-badge.group-peripheral {
  background-color: #007bff;
}

/* ===== 分組儀表板樣式 ===== */
.dashboard-section {
  margin-top: 1rem;
  padding: 1rem;
  background-color: #fff;
  border-radius: 8px;
  border: 1px solid #dee2e6;
  animation: fadeIn 0.5s;
}
.dashboard-title {
  margin-top: 0;
  margin-bottom: 1rem;
}
.dashboard-table-wrapper {
  overflow-x: auto;
}
.dashboard-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9em;
  min-width: 800px;
}
.dashboard-table th,
.dashboard-table td {
  border: 1px solid #ced4da;
  padding: 0.5rem;
  text-align: center;
}
.dashboard-table th {
  background-color: #e9ecef;
  position: sticky;
  top: 0;
}
.dashboard-table td:first-child,
.dashboard-table th:first-child {
  font-weight: bold;
  background-color: #f1f3f5;
  position: sticky;
  left: 0;
  z-index: 1;
  min-width: 80px;
}
.dashboard-table th:first-child {
  z-index: 2;
}
.dashboard-table th.day-shift-header {
  background-color: #fff9e6 !important;
  color: #856404;
}

.dashboard-table th.night-shift-header {
  background-color: #e6f3ff !important;
  color: #004085;
}

.dashboard-table td.day-shift-data {
  background-color: #fffef9;
}

.dashboard-table td.night-shift-data {
  background-color: #f5f9ff;
}
/* ===== 編輯模式下拉選單樣式 ===== */
.group-select {
  margin-top: 0.3rem;
  padding: 2px 4px;
  border-radius: 4px;
  border: 1px solid #adb5bd;
  font-size: 0.85em;
  background-color: #fff;
  cursor: pointer;
}
/* 班別編輯下拉選單樣式 */
.shift-select {
  width: 100%;
  padding: 4px;
  border-radius: 4px;
  border: 1px solid #007bff;
  background-color: #e7f1ff;
  font-size: 0.9em;
  font-weight: 500;
  text-align: center;
  box-sizing: border-box;
}

.group-badge-fixed {
  font-weight: bold;
  padding: 2px 8px;
  border-radius: 12px;
  color: #343a40;
  background-color: #e9ecef;
  border: 1px solid #ced4da;
  font-size: 0.85em;
  margin-top: 0.3rem;
}

/* 過去日期的樣式 */
.shift-select.is-readonly,
.group-select:disabled {
  background-color: #e9ecef;
  color: #6c757d;
  cursor: not-allowed;
  border-color: #dee2e6;
  opacity: 0.7;
}

.group-badge-readonly {
  font-weight: bold;
  padding: 2px 8px;
  border-radius: 12px;
  background-color: #e9ecef;
  color: #6c757d;
  font-size: 0.85em;
  opacity: 0.7;
}

/* 過去的日期格子加上視覺提示 */
.week-table td.is-past {
  background-color: #f8f9fa;
  opacity: 0.9;
}

.week-table td.is-past .weekly-shift-cell {
  opacity: 0.8;
}

.week-table td.is-past .standby-75-marker.editable {
  cursor: not-allowed;
  opacity: 0.5;
}

/* ===== 工作職責頁籤樣式 ===== */
.pane-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}
.table-title,
.info-section h3 {
  font-size: 1.3rem;
  font-weight: 600;
  margin-bottom: 1rem;
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 1rem;
}
.revision-date {
  font-size: 0.9rem;
  color: #6c757d;
  font-style: italic;
  cursor: help;
}
.save-button {
  background-color: #1abc9c;
  color: white;
  border: none;
  padding: 0.5rem 1rem;
  border-radius: 5px;
  cursor: pointer;
  font-weight: bold;
  transition: background-color 0.2s;
}
.save-button:hover:not(:disabled) {
  background-color: #16a085;
}
.save-button:disabled {
  background-color: #bdc3c7;
  cursor: not-allowed;
}
.info-section {
  background-color: #f8f9fa;
  border: 1px solid #dee2e6;
  border-radius: 6px;
  padding: 1.5rem;
  margin-bottom: 2rem;
}
.editable-text {
  display: block;
  width: 100%;
  min-height: 24px;
  cursor: text;
  padding: 5px;
  border-radius: 4px;
  transition: background-color 0.2s;
  white-space: pre-wrap;
}
.announcement-text {
  line-height: 1.7;
}
.editable-text:hover {
  background-color: #ecf0f1;
}
.duties-table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 2rem;
}
.duties-table th,
.duties-table td {
  border: 1px solid #dee2e6;
  padding: 0.8rem;
  text-align: left;
  vertical-align: top;
}
.duties-table th {
  background-color: #f8f9fa;
}
.shift-type-col {
  width: 10%;
  text-align: center;
}
.shift-code-col {
  width: 15%;
}
.tasks-col {
  width: 75%;
}
.shift-type-cell {
  font-weight: bold;
  text-align: center;
  vertical-align: middle;
  background-color: #f8f9fa;
}
.task-text {
  white-space: pre-wrap;
  line-height: 1.7;
}
.edit-input,
.edit-input-inline {
  width: 100%;
  padding: 5px;
  border: 2px solid #1abc9c;
  border-radius: 4px;
  font-family: inherit;
  font-size: inherit;
  box-sizing: border-box;
}
.edit-input {
  resize: vertical;
  min-height: 100px;
}
.announcement-input {
  min-height: 120px;
}
.closing-section {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2rem;
  border-top: 2px solid #dee2e6;
  padding-top: 1.5rem;
}
.closing-column .table-title {
  border-bottom: 2px solid #dee2e6;
  padding-bottom: 0.5rem;
}
.checklist {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
}
.check-item {
  display: flex;
  align-items: center;
}
.checkbox {
  display: inline-block;
  width: 20px;
  height: 20px;
  border: 2px solid #adb5bd;
  border-radius: 4px;
  margin-right: 0.8rem;
  flex-shrink: 0;
}
.teamwork-list .editable-text {
  margin: 0 0 0.8rem 0;
}
:deep(.group-tag) {
  display: inline-block;
  color: white;
  padding: 1px 8px;
  border-radius: 12px;
  margin-right: 0.7em;
  font-family: 'Segoe UI', sans-serif;
  font-size: 0.9em;
  font-weight: bold;
  line-height: 1.5;
}
:deep(.group-tag.group-A) {
  background-color: #3498db;
}
:deep(.group-tag.group-B) {
  background-color: #2ecc71;
}
:deep(.group-tag.group-C) {
  background-color: #1abc9c;
}
:deep(.group-tag.group-D) {
  background-color: #9b59b6;
}
:deep(.group-tag.group-E) {
  background-color: #f1c40f;
}
:deep(.group-tag.group-F) {
  background-color: #e67e22;
}
:deep(.group-tag.group-G) {
  background-color: #e74c3c;
}
:deep(.group-tag.group-H) {
  background-color: #d35400;
}
:deep(.group-tag.group-I) {
  background-color: #34495e;
}
:deep(.group-tag.group-J) {
  background-color: #7f8c8d;
}
:deep(.group-tag.group-K) {
  background-color: #2c3e50;
  color: #f1c40f;
}
:deep(.group-tag.group-ICU) {
  background-color: #c0392b;
}
:deep(.group-tag.group-QW1),
:deep(.group-tag.group-QW2),
:deep(.group-tag.group-QW3),
:deep(.group-tag.group-QW4),
:deep(.group-tag.group-QW5),
:deep(.group-tag.group-QW6),
:deep(.group-tag.group-QW7) {
  background-color: #5d6d7e;
}
:deep(.group-tag.is-note) {
  background-color: #f8f9fa;
  color: #495057;
  border: 1px solid #dee2e6;
  padding: 2px 6px;
  border-radius: 4px;
}
:deep(.group-tag.is-leader),
:deep(.group-tag.is-numeric) {
  background-color: transparent;
  color: #2c3e50;
  padding: 0;
  margin: 0;
  border-radius: 0;
  font-weight: bold;
}

/* 非當月的樣式 */
.week-table th.other-month-header {
  background-color: #e8e8e8;
  color: #999;
  font-style: italic;
}

.week-table td.other-month {
  background-color: #f8f8f8;
  color: #ccc;
}

.week-table td.other-month.weekend {
  background-color: #f5f5f5;
}

.other-month-cell {
  color: #999;
  text-align: center;
  font-size: 0.85em;
}

.other-month-cell.adjacent-loading {
  color: #ccc;
}

.other-month-cell.adjacent-not-uploaded {
  color: #bbb;
}

.other-month-cell .loading-dot {
  color: #aaa;
  animation: blink 1s infinite;
}

@keyframes blink {
  0%,
  100% {
    opacity: 0.3;
  }
  50% {
    opacity: 1;
  }
}

.other-month-cell .not-uploaded-text {
  color: #bbb;
  font-size: 0.75em;
  font-style: italic;
}

.adjacent-shift-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.adjacent-shift {
  color: #888;
}

.standby-75-marker.adjacent {
  font-size: 0.7em;
  opacity: 0.7;
}

.group-badge.adjacent {
  font-size: 0.65em;
  padding: 1px 4px;
  opacity: 0.8;
}

/* 預備75班相關樣式 */
.shift-and-standby {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.standby-75-marker {
  color: #ffc107;
  font-size: 0.9em;
  cursor: default;
  vertical-align: super;
  margin-left: 2px;
}

.standby-75-marker.editable {
  cursor: pointer;
  transition: all 0.2s;
}

.standby-75-marker.editable:hover {
  color: #ff9800;
  transform: scale(1.2);
}

.add-standby-btn {
  background: none;
  border: none;
  color: #ccc;
  font-size: 0.8em;
  cursor: pointer;
  padding: 0;
  margin-left: 2px;
  transition: all 0.2s;
}

.add-standby-btn:hover {
  color: #ffc107;
  transform: scale(1.1);
}

/* 統計表的預備75欄位樣式 */
.dashboard-table th.standby-75-header {
  background-color: #fff3cd !important;
  color: #856404;
  font-weight: bold;
  border: 2px solid #ffc107;
}

.dashboard-table td.standby-75-data {
  background-color: #fffef5;
  font-weight: bold;
  color: #856404;
}

/* 🆕 新增：過濾按鈕群組樣式 */
.controls-center {
  display: flex;
  align-items: center;
  flex: 1;
  justify-content: center;
}

/* 過濾按鈕群組保持緊湊 */
.shift-filter-group {
  display: inline-flex;
  gap: 2px;
  background-color: #e9ecef;
  padding: 2px;
  border-radius: 6px;
  border: 1px solid #dee2e6;
}

.filter-btn {
  padding: 0.3rem 0.8rem;
  border: none;
  background-color: transparent;
  color: #495057;
  border-radius: 4px;
  font-size: 0.82rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.filter-btn:hover:not(.active) {
  background-color: #fff;
  color: #007bff;
}

.filter-btn.active {
  background-color: #007bff;
  color: white;
  box-shadow: 0 1px 3px rgba(0, 123, 255, 0.3);
}

/* 🔄 加強變灰的格子樣式，讓休假更明顯 */
.week-table td.dimmed {
  opacity: 0.2;
  background-color: #f8f9fa !important;
  position: relative;
}

.week-table td.dimmed::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: repeating-linear-gradient(
    45deg,
    transparent,
    transparent 10px,
    rgba(200, 200, 200, 0.05) 10px,
    rgba(200, 200, 200, 0.05) 20px
  );
  pointer-events: none;
}

.week-table td.dimmed .shift-badge,
.week-table td.dimmed .group-badge,
.week-table td.dimmed .weekly-shift-cell {
  filter: grayscale(100%);
  opacity: 0.3;
}

/* 休假班別在過濾模式下的特別樣式 */
.week-table td.dimmed .shift-休息,
.week-table td.dimmed .shift-例假,
.week-table td.dimmed .shift-國定 {
  opacity: 0.2;
}

.week-table td.dimmed .standby-75-marker {
  display: none;
}

.week-table td.dimmed .add-standby-btn {
  display: none;
}

/* 編輯模式下，變灰格子的下拉選單也要調整 */
.week-table td.dimmed .group-select,
.week-table td.dimmed .shift-select {
  opacity: 0.3;
  pointer-events: none;
}

/* 響應式處理 */
@media (max-width: 1400px) {
  .controls-section {
    flex-direction: column;
    align-items: stretch;
  }

  .controls-left,
  .controls-center,
  .controls-right {
    width: 100%;
    justify-content: center;
    margin: 0.25rem 0;
  }

  .shift-filter-group {
    width: fit-content;
    margin: 0 auto;
  }
}

@media (min-width: 1401px) and (max-width: 1600px) {
  /* 中等螢幕時，讓編輯按鈕可以換行 */
  .controls-right {
    max-width: 400px;
  }
}
@media (max-width: 1200px) {
  .controls-section {
    flex-wrap: wrap;
  }

  .controls-center {
    width: 100%;
    margin: 0.5rem 0;
  }
}

@media (max-width: 768px) {
  .controls-section {
    flex-direction: column;
    gap: 1rem;
  }
  .controls-left,
  .controls-right {
    width: 100%;
    justify-content: space-between;
  }
  .schedule-table {
    font-size: 0.75rem;
  }
  .date-col {
    width: 50px;
    min-width: 50px;
  }
  .shift-badge {
    font-size: 0.7rem;
    padding: 1px 4px;
  }
}
</style>
