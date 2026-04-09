<!-- 檔案路徑: src/views/StatsView.vue (整合 Pinia Store 更新版) -->
<template>
  <div class="page-container">
    <!-- 1. 固定的頂部，此區塊不滾動 -->
    <div class="page-header-content">
      <!-- 頂部主要工具列 -->
      <div class="header-toolbar">
        <div class="toolbar-left">
          <h1 class="page-title">護理分組</h1>
          <div class="date-navigator">
            <button @click="changeDate(-1)">&lt; 上一天</button>
            <div class="date-display-wrapper">
              <span class="current-date-text">{{ formatDate(currentDate) }}</span>
              <span class="weekday-display">{{ weekdayDisplay }}</span>
            </div>
            <button @click="changeDate(1)">下一天 &gt;</button>
          </div>

          <button @click="goToToday">回到今日</button>
          <!-- ✨ 新增：按鈕群組 -->
          <div class="action-buttons-group">
            <!-- 現有的交辦按鈕 -->
            <button
              class="btn-primary"
              @click="isCreateTaskModalVisible = true"
              :disabled="!hasPermission('viewer')"
            >
              <i class="fas fa-plus"></i> 新增交辦
            </button>

            <!-- ✨ 新增：調班申請按鈕 -->
            <button
              class="btn-info"
              @click="isExceptionDialogVisible = true"
              :disabled="isPageLocked"
            >
              <i class="fas fa-exchange-alt"></i> 調班申請
            </button>

            <!-- ✨ 新增：預約變更按鈕 -->
            <button
              class="btn-warning"
              @click="isNewUpdateTypeDialogVisible = true"
              :disabled="isPageLocked"
            >
              <i class="fas fa-calendar-plus"></i> 預約變更
            </button>
          </div>
          <button
            v-if="!lateShiftTakeOffExists"
            @click="promptDuplicateLateShift"
            class="duplicate-shift-btn desktop-only"
            title="為晚班建立獨立的收針分組"
            :disabled="isPageLocked"
          >
            <i class="fas fa-copy"></i> 新增夜班收針分組
          </button>
        </div>
        <div class="toolbar-right desktop-only-flex">
          <span class="status-indicator">{{ statusIndicator }}</span>
          <button
            id="save-changes-btn"
            :disabled="!hasUnsavedChanges || isPageLocked"
            @click="saveChangesToCloud"
          >
            儲存變更
          </button>
          <button @click="exportAssignmentsToExcel" class="btn-secondary">
            <i class="fas fa-file-excel"></i> 匯出Excel
          </button>
        </div>
      </div>

      <!-- 【核心修改 1】: 將醫師資訊和消防編組並排 -->
      <div class="info-row-wrapper desktop-only">
        <!-- (左側) 使用 DailyStaffDisplay 元件 -->
        <DailyStaffDisplay
          :daily-physicians="dailyPhysicians"
          :daily-consult-physicians="dailyConsultPhysicians"
        />

        <!-- 【核心修改 1】: 重構消防編組的 HTML 結構 -->
        <div class="duty-command-bar">
          <div class="fire-duty-panel">
            <span class="duty-title">消防編組:</span>
            <div class="duty-grid">
              <!-- Grid Item 1: 總指揮官 -->
              <div class="duty-item-pair">
                <span class="duty-role-tag role-commander">總指揮官</span>
                <span class="duty-person">廖丁瑩主任</span>
              </div>
              <!-- Grid Item 2: 現場指揮官 -->
              <div class="duty-item-pair">
                <span class="duty-role-tag role-field-commander">現場指揮官</span>
                <span class="duty-person">莊明月護理長</span>
              </div>
              <!-- Grid Item 3: 通報班 -->
              <div class="duty-item-pair">
                <span class="duty-role-tag role-reporter">通報班</span>
                <span class="duty-person">謝淑琴書記</span>
              </div>
              <!-- Grid Item 4: 引導救護班 -->
              <div class="duty-item-pair">
                <span class="duty-role-tag role-guide">引導救護班</span>
                <span class="duty-person">工友</span>
              </div>
            </div>
          </div>

          <div class="duty-dropdown-wrapper">
            <button
              class="duty-dropdown-trigger"
              @click="isFireDutyDropdownVisible = !isFireDutyDropdownVisible"
            >
              <span>勤務分組詳情</span>
              <span class="toggle-arrow" :class="{ 'is-rotated': isFireDutyDropdownVisible }"
                >▼</span
              >
            </button>
            <transition name="slide-fade">
              <div v-if="isFireDutyDropdownVisible" class="duty-dropdown-menu">
                <div
                  v-for="(duties, shift) in dutyAssignments"
                  :key="shift"
                  class="duty-shift-group"
                >
                  <h4 class="duty-shift-header">
                    {{ shift === 'early' ? '早班' : shift === 'late' ? '午/晚班' : '夜班' }}
                  </h4>
                  <div class="duty-item" v-for="(teams, dutyName) in duties" :key="dutyName">
                    <div class="duty-name" :class="getDutyTagClass(dutyName)">{{ dutyName }}</div>
                    <div class="duty-teams">
                      <span
                        v-if="Array.isArray(teams)"
                        v-for="team in teams"
                        :key="team"
                        class="duty-team-tag"
                        >{{ team }}</span
                      >
                      <span v-else class="duty-team-tag">{{ teams }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </transition>
          </div>
        </div>
      </div>
    </div>

    <!-- 2. 可滾動的主要內容區 -->
    <div class="scrollable-main-content">
      <div v-if="isLoading" class="loading-overlay">
        <div class="loading-spinner"></div>
        <span>正在載入 {{ formatDate(currentDate) }} 的資料...</span>
      </div>

      <!-- (A) 桌面版大表格 -->
      <div class="stats-sections-wrapper desktop-only">
        <!-- 早班區塊 -->
        <div class="stats-section" :class="{ 'is-locked': isPageLocked }">
          <div
            class="grid-container"
            :style="{ gridTemplateColumns: `90px repeat(${sortedEarlyTeams.length}, 1fr)` }"
          >
            <div class="grid-header">
              <div class="row-header section-title-cell">早班</div>
              <div
                v-for="teamName in sortedEarlyTeams"
                :key="teamName"
                class="team-header-cell"
                :class="{ 'unassigned-header': teamName.includes('未分組') }"
              >
                {{ teamName.includes('未分組') ? '未分組' : teamName.replace('早', '') + '組' }}
              </div>
            </div>
            <div class="grid-body">
              <div class="grid-row">
                <div class="row-header">姓名</div>
                <!-- ✨✨✨ 核心修改 #1: 早班姓名改為唯讀 ✨✨✨ -->
                <div
                  v-for="teamName in sortedEarlyTeams"
                  :key="teamName"
                  class="grid-cell name-cell-readonly"
                >
                  <span
                    v-if="effectiveStatsData.early[teamName]?.nurseName"
                    class="nurse-name-display"
                  >
                    {{ effectiveStatsData.early[teamName]?.nurseName }}
                  </span>
                  <span v-else class="unassigned-name-display"> -- 未指派 -- </span>
                </div>
              </div>
              <div class="grid-row">
                <div class="row-header">早班</div>
                <div
                  v-for="teamName in sortedEarlyTeams"
                  :key="teamName"
                  class="grid-cell patient-list-cell"
                  :class="{ 'unassigned-cell': teamName.includes('未分組') }"
                  @drop="!isPageLocked && onDrop($event, teamName, 'earlyShift')"
                  @dragover.prevent="!isPageLocked && onDragOver($event)"
                  @dragleave="onDragLeave"
                >
                  <div class="patient-wrapper">
                    <div
                      v-for="patient in effectiveStatsData.early[teamName]?.earlyShift.patients"
                      :key="patient.shiftId"
                      :class="patient.classes"
                      :draggable="!isPageLocked"
                      @dragstart="!isPageLocked && onDragStart($event, patient, 'earlyShift')"
                    >
                      <div
                        class="patient-main-info"
                        @click="!isPageLocked && openBedChangeDialog(patient)"
                        title="點擊換床"
                      >
                        <div class="patient-line-one">
                          {{ patient.dialysisBed }} - {{ patient.name }}
                        </div>
                        <div class="patient-line-two">
                          <span v-if="patient.wardNumber" class="ward-number-display">{{
                            patient.wardNumber
                          }}</span>
                          <span
                            v-if="patient.mode && patient.mode !== 'HD'"
                            class="stats-special-mode"
                            >({{ patient.mode }})</span
                          >
                          <span v-if="patient.finalTags" class="note-display">{{
                            patient.finalTags
                          }}</span>
                        </div>
                      </div>
                      <PatientMessagesIcon :patient-id="patient.id" context="dialog" />
                    </div>
                  </div>
                  <div class="cell-actions-container">
                    <div
                      class="prep-list-trigger"
                      v-if="effectiveStatsData.early[teamName]?.earlyShift.patients.length > 0"
                      @click="
                        showPrepPopover($event, effectiveStatsData.early[teamName], 'earlyShift')
                      "
                      title="顯示備物清單"
                    >
                      📋
                    </div>
                    <div
                      class="injection-list-trigger"
                      v-if="effectiveStatsData.early[teamName]?.earlyShift.patients.length > 0"
                      @click="showInjectionList(effectiveStatsData.early[teamName], 'earlyShift')"
                      title="顯示本日應打針劑"
                    >
                      💉
                    </div>
                  </div>
                </div>
              </div>
              <div class="grid-row">
                <div class="row-header">午班(上針)</div>
                <div
                  v-for="teamName in sortedEarlyTeams"
                  :key="teamName"
                  class="grid-cell patient-list-cell"
                  :class="{ 'unassigned-cell': teamName.includes('未分組') }"
                  @drop="!isPageLocked && onDrop($event, teamName, 'noonShiftOn')"
                  @dragover.prevent="!isPageLocked && onDragOver($event)"
                  @dragleave="onDragLeave"
                >
                  <div class="patient-wrapper">
                    <div
                      v-for="patient in effectiveStatsData.early[teamName]?.noonShiftOn.patients"
                      :key="patient.shiftId"
                      :class="patient.classes"
                      :draggable="!isPageLocked"
                      @dragstart="!isPageLocked && onDragStart($event, patient, 'noonShiftOn')"
                    >
                      <div
                        class="patient-main-info"
                        @click="!isPageLocked && openBedChangeDialog(patient)"
                        title="點擊換床"
                      >
                        <div class="patient-line-one">
                          {{ patient.dialysisBed }} - {{ patient.name }}
                        </div>
                        <div class="patient-line-two">
                          <span v-if="patient.wardNumber" class="ward-number-display">{{
                            patient.wardNumber
                          }}</span>
                          <span
                            v-if="patient.mode && patient.mode !== 'HD'"
                            class="stats-special-mode"
                            >({{ patient.mode }})</span
                          >
                          <span v-if="patient.finalTags" class="note-display">{{
                            patient.finalTags
                          }}</span>
                        </div>
                      </div>
                      <PatientMessagesIcon :patient-id="patient.id" context="dialog" />
                    </div>
                  </div>
                  <div class="cell-actions-container">
                    <div
                      class="prep-list-trigger"
                      v-if="effectiveStatsData.early[teamName]?.noonShiftOn.patients.length > 0"
                      @click="
                        showPrepPopover($event, effectiveStatsData.early[teamName], 'noonShiftOn')
                      "
                      title="顯示備物清單"
                    >
                      📋
                    </div>
                    <div
                      class="injection-list-trigger"
                      v-if="effectiveStatsData.early[teamName]?.noonShiftOn.patients.length > 0"
                      @click="showInjectionList(effectiveStatsData.early[teamName], 'noonShiftOn')"
                      title="顯示本日應打針劑"
                    >
                      💉
                    </div>
                  </div>
                </div>
              </div>
              <div class="grid-row">
                <div class="row-header collapsible-header" @click="toggleNoonTakeoff('early')">
                  <span>午班(收針)</span>
                  <span
                    class="collapse-icon"
                    :class="{ 'is-expanded': noonTakeoffVisibility.early }"
                    >►</span
                  >
                </div>
              </div>
              <transition name="grid-row-fade">
                <div class="grid-row" v-if="noonTakeoffVisibility.early">
                  <div class="row-header">午班(收針)</div>
                  <div
                    v-for="teamName in sortedEarlyTeams"
                    :key="teamName"
                    class="grid-cell patient-list-cell"
                    :class="{ 'unassigned-cell': teamName.includes('未分組') }"
                    @drop="!isPageLocked && onDrop($event, teamName, 'noonShiftOff')"
                    @dragover.prevent="!isPageLocked && onDragOver($event)"
                    @dragleave="onDragLeave"
                  >
                    <div class="patient-wrapper">
                      <div
                        v-for="patient in effectiveStatsData.early[teamName]?.noonShiftOff.patients"
                        :key="patient.shiftId"
                        :class="patient.classes"
                        :draggable="!isPageLocked"
                        @dragstart="!isPageLocked && onDragStart($event, patient, 'noonShiftOff')"
                      >
                        <div
                          class="patient-main-info"
                          @click="!isPageLocked && openBedChangeDialog(patient)"
                          title="點擊換床"
                        >
                          <div class="patient-line-one">
                            {{ patient.dialysisBed }} - {{ patient.name }}
                          </div>
                          <div class="patient-line-two">
                            <span v-if="patient.wardNumber" class="ward-number-display">{{
                              patient.wardNumber
                            }}</span>
                            <span
                              v-if="patient.mode && patient.mode !== 'HD'"
                              class="stats-special-mode"
                              >({{ patient.mode }})</span
                            >
                            <span v-if="patient.finalTags" class="note-display">{{
                              patient.finalTags
                            }}</span>
                          </div>
                        </div>
                        <PatientMessagesIcon :patient-id="patient.id" context="dialog" />
                      </div>
                    </div>
                    <div class="cell-actions-container">
                      <div
                        class="prep-list-trigger"
                        v-if="effectiveStatsData.early[teamName]?.noonShiftOff.patients.length > 0"
                        @click="
                          showPrepPopover(
                            $event,
                            effectiveStatsData.early[teamName],
                            'noonShiftOff',
                          )
                        "
                        title="顯示備物清單"
                      >
                        📋
                      </div>
                      <div
                        class="injection-list-trigger"
                        v-if="effectiveStatsData.early[teamName]?.noonShiftOff.patients.length > 0"
                        @click="
                          showInjectionList(effectiveStatsData.early[teamName], 'noonShiftOff')
                        "
                        title="顯示本日應打針劑"
                      >
                        💉
                      </div>
                    </div>
                  </div>
                </div>
              </transition>
            </div>
            <div class="grid-footer">
              <div class="row-header">照護人數</div>
              <div v-for="teamName in sortedEarlyTeams" :key="teamName" class="total-count-summary">
                門{{ effectiveStatsData.early[teamName]?.totalOpdCount || 0 }} 住{{
                  effectiveStatsData.early[teamName]?.totalIpdCount || 0
                }}
                急{{ effectiveStatsData.early[teamName]?.totalErCount || 0 }}
              </div>
            </div>
          </div>
        </div>

        <!-- 晚班區塊 -->
        <div class="stats-section" :class="{ 'is-locked': isPageLocked }">
          <div
            class="grid-container"
            :style="{ gridTemplateColumns: `90px repeat(${sortedLateTeams.length}, 1fr)` }"
          >
            <div class="grid-header">
              <div class="row-header section-title-cell">晚班</div>
              <div
                v-for="teamName in sortedLateTeams"
                :key="teamName"
                class="team-header-cell"
                :class="{ 'unassigned-header': teamName.includes('未分組') }"
              >
                {{ teamName.includes('未分組') ? '未分組' : teamName.replace('晚', '') + '組' }}
              </div>
            </div>
            <div class="grid-body">
              <div class="grid-row">
                <div class="row-header">姓名</div>
                <!-- ✨✨✨ 核心修改 #2: 晚班姓名改為唯讀 ✨✨✨ -->
                <div
                  v-for="teamName in sortedLateTeams"
                  :key="teamName"
                  class="grid-cell name-cell-readonly"
                >
                  <span
                    v-if="effectiveStatsData.late[teamName]?.nurseName"
                    class="nurse-name-display"
                  >
                    {{ effectiveStatsData.late[teamName]?.nurseName }}
                  </span>
                  <span v-else class="unassigned-name-display"> -- 未指派 -- </span>
                </div>
              </div>
              <div class="grid-row">
                <div class="row-header collapsible-header" @click="toggleNoonTakeoff('late')">
                  <span>午班(收針)</span>
                  <span class="collapse-icon" :class="{ 'is-expanded': noonTakeoffVisibility.late }"
                    >►</span
                  >
                </div>
              </div>
              <transition name="grid-row-fade">
                <div class="grid-row" v-if="noonTakeoffVisibility.late">
                  <div class="row-header">午班(收針)</div>
                  <div
                    v-for="teamName in sortedLateTeams"
                    :key="teamName"
                    class="grid-cell patient-list-cell"
                    :class="{ 'unassigned-cell': teamName.includes('未分組') }"
                    @drop="!isPageLocked && onDrop($event, teamName, 'noonShiftOff')"
                    @dragover.prevent="!isPageLocked && onDragOver($event)"
                    @dragleave="onDragLeave"
                  >
                    <div class="patient-wrapper">
                      <div
                        v-for="patient in effectiveStatsData.late[teamName]?.noonShiftOff.patients"
                        :key="patient.shiftId"
                        :class="patient.classes"
                        :draggable="!isPageLocked"
                        @dragstart="!isPageLocked && onDragStart($event, patient, 'noonShiftOff')"
                      >
                        <div
                          class="patient-main-info"
                          @click="!isPageLocked && openBedChangeDialog(patient)"
                          title="點擊換床"
                        >
                          <div class="patient-line-one">
                            {{ patient.dialysisBed }} - {{ patient.name }}
                          </div>
                          <div class="patient-line-two">
                            <span v-if="patient.wardNumber" class="ward-number-display">{{
                              patient.wardNumber
                            }}</span>
                            <span
                              v-if="patient.mode && patient.mode !== 'HD'"
                              class="stats-special-mode"
                              >({{ patient.mode }})</span
                            >
                            <span v-if="patient.finalTags" class="note-display">{{
                              patient.finalTags
                            }}</span>
                          </div>
                        </div>
                        <PatientMessagesIcon :patient-id="patient.id" context="dialog" />
                      </div>
                    </div>
                    <div class="cell-actions-container">
                      <div
                        class="prep-list-trigger"
                        v-if="effectiveStatsData.late[teamName]?.noonShiftOff.patients.length > 0"
                        @click="
                          showPrepPopover($event, effectiveStatsData.late[teamName], 'noonShiftOff')
                        "
                        title="顯示備物清單"
                      >
                        📋
                      </div>
                      <div
                        class="injection-list-trigger"
                        v-if="effectiveStatsData.late[teamName]?.noonShiftOff.patients.length > 0"
                        @click="
                          showInjectionList(effectiveStatsData.late[teamName], 'noonShiftOff')
                        "
                        title="顯示本日應打針劑"
                      >
                        💉
                      </div>
                    </div>
                  </div>
                </div>
              </transition>
              <div class="grid-row">
                <div class="row-header">晚班</div>
                <div
                  v-for="teamName in sortedLateTeams"
                  :key="teamName"
                  class="grid-cell patient-list-cell"
                  :class="{ 'unassigned-cell': teamName.includes('未分組') }"
                  @drop="!isPageLocked && onDrop($event, teamName, 'lateShift')"
                  @dragover.prevent="!isPageLocked && onDragOver($event)"
                  @dragleave="onDragLeave"
                >
                  <div class="patient-wrapper">
                    <div
                      v-for="patient in effectiveStatsData.late[teamName]?.lateShift.patients"
                      :key="patient.shiftId"
                      :class="patient.classes"
                      :draggable="!isPageLocked"
                      @dragstart="!isPageLocked && onDragStart($event, patient, 'lateShift')"
                    >
                      <div
                        class="patient-main-info"
                        @click="!isPageLocked && openBedChangeDialog(patient)"
                        title="點擊換床"
                      >
                        <div class="patient-line-one">
                          {{ patient.dialysisBed }} - {{ patient.name }}
                        </div>
                        <div class="patient-line-two">
                          <span v-if="patient.wardNumber" class="ward-number-display">{{
                            patient.wardNumber
                          }}</span>
                          <span
                            v-if="patient.mode && patient.mode !== 'HD'"
                            class="stats-special-mode"
                            >({{ patient.mode }})</span
                          >
                          <span v-if="patient.finalTags" class="note-display">{{
                            patient.finalTags
                          }}</span>
                        </div>
                      </div>
                      <PatientMessagesIcon :patient-id="patient.id" context="dialog" />
                    </div>
                  </div>
                  <div class="cell-actions-container">
                    <div
                      class="prep-list-trigger"
                      v-if="effectiveStatsData.late[teamName]?.lateShift.patients.length > 0"
                      @click="
                        showPrepPopover($event, effectiveStatsData.late[teamName], 'lateShift')
                      "
                      title="顯示備物清單"
                    >
                      📋
                    </div>
                    <div
                      class="injection-list-trigger"
                      v-if="effectiveStatsData.late[teamName]?.lateShift.patients.length > 0"
                      @click="showInjectionList(effectiveStatsData.late[teamName], 'lateShift')"
                      title="顯示本日應打針劑"
                    >
                      💉
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div class="grid-footer">
              <div class="row-header">照護人數</div>
              <div v-for="teamName in sortedLateTeams" :key="teamName" class="total-count-summary">
                門{{ effectiveStatsData.late[teamName]?.totalOpdCount || 0 }} 住{{
                  effectiveStatsData.late[teamName]?.totalIpdCount || 0
                }}
                急{{ effectiveStatsData.late[teamName]?.totalErCount || 0 }}
              </div>
            </div>
          </div>
        </div>

        <!-- 【✨ 新增修改 ✨】: 夜班收針區塊 -->
        <div
          v-if="lateShiftTakeOffExists"
          class="stats-section late-takeoff-section"
          :class="{ 'is-locked': isPageLocked }"
        >
          <div
            class="grid-container"
            :style="{ gridTemplateColumns: `90px repeat(${sortedLateTakeOffTeams.length}, 1fr)` }"
          >
            <div class="grid-header">
              <div class="row-header section-title-cell">
                <div class="takeoff-header-content">
                  <span>夜班收針</span>
                  <!-- 【✨ 新增修改 ✨】: 移除按鈕 -->
                  <button
                    @click="promptRemoveLateShiftTakeOff"
                    class="remove-takeoff-btn"
                    title="移除夜班收針分組"
                  >
                    <i class="fas fa-times"></i>
                  </button>
                </div>
              </div>
              <div
                v-for="teamName in sortedLateTakeOffTeams"
                :key="teamName"
                class="team-header-cell"
                :class="{ 'unassigned-header': teamName.includes('未分組') }"
              >
                {{
                  teamName.includes('未分組') ? '未分組' : teamName.replace('夜間收針', '') + '組'
                }}
              </div>
            </div>
            <div class="grid-body">
              <div class="grid-row">
                <div class="row-header">姓名</div>
                <!-- ✨✨✨ 核心修改 #3: 夜班收針姓名改為唯讀 ✨✨✨ -->
                <div
                  v-for="teamName in sortedLateTakeOffTeams"
                  :key="teamName"
                  class="grid-cell name-cell-readonly"
                >
                  <span
                    v-if="effectiveStatsData.lateTakeOff[teamName]?.nurseName"
                    class="nurse-name-display"
                  >
                    {{ effectiveStatsData.lateTakeOff[teamName]?.nurseName }}
                  </span>
                  <span v-else class="unassigned-name-display"> -- 未指派 -- </span>
                </div>
              </div>
              <div class="grid-row">
                <div class="row-header">夜班收針</div>
                <div
                  v-for="teamName in sortedLateTakeOffTeams"
                  :key="teamName"
                  class="grid-cell patient-list-cell"
                  :class="{ 'unassigned-cell': teamName.includes('未分組') }"
                  @drop="!isPageLocked && onDrop($event, teamName, 'lateShiftTakeOff')"
                  @dragover.prevent="!isPageLocked && onDragOver($event)"
                  @dragleave="onDragLeave"
                >
                  <div class="patient-wrapper">
                    <div
                      v-for="patient in effectiveStatsData.lateTakeOff[teamName]?.lateShiftTakeOff
                        .patients"
                      :key="patient.shiftId"
                      :class="patient.classes"
                      :draggable="!isPageLocked"
                      @dragstart="!isPageLocked && onDragStart($event, patient, 'lateShiftTakeOff')"
                    >
                      <div
                        class="patient-main-info"
                        @click="!isPageLocked && openBedChangeDialog(patient)"
                        title="點擊換床"
                      >
                        <div class="patient-line-one">
                          {{ patient.dialysisBed }} - {{ patient.name }}
                        </div>
                        <div class="patient-line-two">
                          <span v-if="patient.wardNumber" class="ward-number-display">{{
                            patient.wardNumber
                          }}</span>
                          <span
                            v-if="patient.mode && patient.mode !== 'HD'"
                            class="stats-special-mode"
                            >({{ patient.mode }})</span
                          >
                          <span v-if="patient.finalTags" class="note-display">{{
                            patient.finalTags
                          }}</span>
                        </div>
                      </div>
                      <PatientMessagesIcon :patient-id="patient.id" context="dialog" />
                    </div>
                  </div>
                  <div class="cell-actions-container">
                    <div
                      class="prep-list-trigger"
                      v-if="
                        effectiveStatsData.lateTakeOff[teamName]?.lateShiftTakeOff.patients.length >
                        0
                      "
                      @click="
                        showPrepPopover(
                          $event,
                          effectiveStatsData.lateTakeOff[teamName],
                          'lateShiftTakeOff',
                        )
                      "
                      title="顯示備物清單"
                    >
                      📋
                    </div>
                    <div
                      class="injection-list-trigger"
                      v-if="
                        effectiveStatsData.lateTakeOff[teamName]?.lateShiftTakeOff.patients.length >
                        0
                      "
                      @click="
                        showInjectionList(
                          effectiveStatsData.lateTakeOff[teamName],
                          'lateShiftTakeOff',
                        )
                      "
                      title="顯示本日應打針劑"
                    >
                      💉
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div class="grid-footer">
              <div class="row-header">照護人數</div>
              <div
                v-for="teamName in sortedLateTakeOffTeams"
                :key="teamName"
                class="total-count-summary"
              >
                門{{ effectiveStatsData.lateTakeOff[teamName]?.totalOpdCount || 0 }} 住{{
                  effectiveStatsData.lateTakeOff[teamName]?.totalIpdCount || 0
                }}
                急{{ effectiveStatsData.lateTakeOff[teamName]?.totalErCount || 0 }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- (B) 行動版卡片列表 -->
      <div class="mobile-only" :class="{ 'is-locked': isPageLocked }">
        <!-- 早班 -->
        <div class="mobile-shift-section">
          <h2 class="mobile-shift-title">早班</h2>
          <div
            v-for="teamName in sortedEarlyTeams"
            :key="`mobile-early-${teamName}`"
            class="mobile-team-card"
          >
            <div class="mobile-team-header">
              <h3>
                {{ teamName.includes('未分組') ? '未分組' : teamName.replace('早', '') + '組' }}
              </h3>
              <!-- ✨✨✨ 核心修改 #4: 行動版早班姓名改為唯讀 ✨✨✨ -->
              <span class="nurse-name-display-mobile">
                {{ effectiveStatsData.early[teamName]?.nurseName || '-- 未指派 --' }}
              </span>
            </div>
            <div class="mobile-patient-lists">
              <div
                class="mobile-patient-list"
                v-if="effectiveStatsData.early[teamName]?.earlyShift.patients.length > 0"
              >
                <h4>早班</h4>
                <div
                  v-for="patient in effectiveStatsData.early[teamName]?.earlyShift.patients"
                  :key="patient.shiftId"
                  :class="patient.classes"
                >
                  <div class="patient-main-info">
                    <div class="patient-line-one">
                      {{ patient.dialysisBed }} - {{ patient.name }}
                    </div>
                    <div class="patient-line-two">
                      <span v-if="patient.wardNumber" class="ward-number-display">{{
                        patient.wardNumber
                      }}</span>
                      <span v-if="patient.mode && patient.mode !== 'HD'" class="stats-special-mode"
                        >({{ patient.mode }})</span
                      >
                      <span v-if="patient.finalTags" class="note-display">{{
                        patient.finalTags
                      }}</span>
                    </div>
                  </div>
                  <PatientMessagesIcon :patient-id="patient.id" context="dialog" />
                </div>
              </div>
              <div
                class="mobile-patient-list"
                v-if="effectiveStatsData.early[teamName]?.noonShiftOn.patients.length > 0"
              >
                <h4>午班(上針)</h4>
                <div
                  v-for="patient in effectiveStatsData.early[teamName]?.noonShiftOn.patients"
                  :key="patient.shiftId"
                  :class="patient.classes"
                >
                  <div class="patient-main-info">
                    <div class="patient-line-one">
                      {{ patient.dialysisBed }} - {{ patient.name }}
                    </div>
                    <div class="patient-line-two">
                      <span v-if="patient.wardNumber" class="ward-number-display">{{
                        patient.wardNumber
                      }}</span>
                      <span v-if="patient.mode && patient.mode !== 'HD'" class="stats-special-mode"
                        >({{ patient.mode }})</span
                      >
                      <span v-if="patient.finalTags" class="note-display">{{
                        patient.finalTags
                      }}</span>
                    </div>
                  </div>
                  <PatientMessagesIcon :patient-id="patient.id" context="dialog" />
                </div>
              </div>
              <div
                class="mobile-patient-list collapsible"
                v-if="effectiveStatsData.early[teamName]?.noonShiftOff.patients.length > 0"
              >
                <h4 @click="toggleNoonTakeoff('early')">
                  <span>午班(收針)</span>
                  <span
                    class="collapse-icon"
                    :class="{ 'is-expanded': noonTakeoffVisibility.early }"
                    >►</span
                  >
                </h4>
                <div v-if="noonTakeoffVisibility.early" class="collapsible-content">
                  <div
                    v-for="patient in effectiveStatsData.early[teamName]?.noonShiftOff.patients"
                    :key="patient.shiftId"
                    :class="patient.classes"
                  >
                    <div class="patient-main-info">
                      <div class="patient-line-one">
                        {{ patient.dialysisBed }} - {{ patient.name }}
                      </div>
                      <div class="patient-line-two">
                        <span v-if="patient.wardNumber" class="ward-number-display">{{
                          patient.wardNumber
                        }}</span>
                        <span
                          v-if="patient.mode && patient.mode !== 'HD'"
                          class="stats-special-mode"
                          >({{ patient.mode }})</span
                        >
                        <span v-if="patient.finalTags" class="note-display">{{
                          patient.finalTags
                        }}</span>
                      </div>
                    </div>
                    <PatientMessagesIcon :patient-id="patient.id" context="dialog" />
                  </div>
                </div>
              </div>
            </div>
            <div class="mobile-team-footer">
              門{{ effectiveStatsData.early[teamName]?.totalOpdCount || 0 }} 住{{
                effectiveStatsData.early[teamName]?.totalIpdCount || 0
              }}
              急{{ effectiveStatsData.early[teamName]?.totalErCount || 0 }}
            </div>
          </div>
        </div>

        <!-- 晚班 -->
        <div class="mobile-shift-section">
          <h2 class="mobile-shift-title">晚班</h2>
          <div
            v-for="teamName in sortedLateTeams"
            :key="`mobile-late-${teamName}`"
            class="mobile-team-card"
          >
            <div class="mobile-team-header">
              <h3>
                {{ teamName.includes('未分組') ? '未分組' : teamName.replace('晚', '') + '組' }}
              </h3>
              <!-- ✨✨✨ 核心修改 #5: 行動版晚班姓名改為唯讀 ✨✨✨ -->
              <span class="nurse-name-display-mobile">
                {{ effectiveStatsData.late[teamName]?.nurseName || '-- 未指派 --' }}
              </span>
            </div>
            <div class="mobile-patient-lists">
              <div
                class="mobile-patient-list collapsible"
                v-if="effectiveStatsData.late[teamName]?.noonShiftOff.patients.length > 0"
              >
                <h4 @click="toggleNoonTakeoff('late')">
                  <span>午班(收針)</span>
                  <span class="collapse-icon" :class="{ 'is-expanded': noonTakeoffVisibility.late }"
                    >►</span
                  >
                </h4>
                <div v-if="noonTakeoffVisibility.late" class="collapsible-content">
                  <div
                    v-for="patient in effectiveStatsData.late[teamName]?.noonShiftOff.patients"
                    :key="patient.shiftId"
                    :class="patient.classes"
                  >
                    <div class="patient-main-info">
                      <div class="patient-line-one">
                        {{ patient.dialysisBed }} - {{ patient.name }}
                      </div>
                      <div class="patient-line-two">
                        <span v-if="patient.wardNumber" class="ward-number-display">{{
                          patient.wardNumber
                        }}</span>
                        <span
                          v-if="patient.mode && patient.mode !== 'HD'"
                          class="stats-special-mode"
                          >({{ patient.mode }})</span
                        >
                        <span v-if="patient.finalTags" class="note-display">{{
                          patient.finalTags
                        }}</span>
                      </div>
                    </div>
                    <PatientMessagesIcon :patient-id="patient.id" context="dialog" />
                  </div>
                </div>
              </div>
              <div
                class="mobile-patient-list"
                v-if="effectiveStatsData.late[teamName]?.lateShift.patients.length > 0"
              >
                <h4>晚班</h4>
                <div
                  v-for="patient in effectiveStatsData.late[teamName]?.lateShift.patients"
                  :key="patient.shiftId"
                  :class="patient.classes"
                >
                  <div class="patient-main-info">
                    <div class="patient-line-one">
                      {{ patient.dialysisBed }} - {{ patient.name }}
                    </div>
                    <div class="patient-line-two">
                      <span v-if="patient.wardNumber" class="ward-number-display">{{
                        patient.wardNumber
                      }}</span>
                      <span v-if="patient.mode && patient.mode !== 'HD'" class="stats-special-mode"
                        >({{ patient.mode }})</span
                      >
                      <span v-if="patient.finalTags" class="note-display">{{
                        patient.finalTags
                      }}</span>
                    </div>
                  </div>
                  <PatientMessagesIcon :patient-id="patient.id" context="dialog" />
                </div>
              </div>
            </div>
            <div class="mobile-team-footer">
              門{{ effectiveStatsData.late[teamName]?.totalOpdCount || 0 }} 住{{
                effectiveStatsData.late[teamName]?.totalIpdCount || 0
              }}
              急{{ effectiveStatsData.late[teamName]?.totalErCount || 0 }}
            </div>
          </div>
        </div>

        <!-- 夜班收針 -->
        <div v-if="lateShiftTakeOffExists" class="mobile-shift-section">
          <h2 class="mobile-shift-title">夜班收針</h2>
          <div
            v-for="teamName in sortedLateTakeOffTeams"
            :key="`mobile-takeoff-${teamName}`"
            class="mobile-team-card"
          >
            <div class="mobile-team-header">
              <h3>
                {{ teamName.includes('未分組') ? '未分組' : teamName.replace('晚', '') + '組' }}
              </h3>
              <!-- ✨✨✨ 核心修改 #5: 行動版晚班姓名改為唯讀 ✨✨✨ -->
              <span class="nurse-name-display-mobile">
                {{ effectiveStatsData.late[teamName]?.nurseName || '-- 未指派 --' }}
              </span>
            </div>
            <div class="mobile-patient-lists">
              <div
                class="mobile-patient-list"
                v-if="
                  effectiveStatsData.lateTakeOff[teamName]?.lateShiftTakeOff.patients.length > 0
                "
              >
                <h4>夜班收針</h4>
                <div
                  v-for="patient in effectiveStatsData.lateTakeOff[teamName]?.lateShiftTakeOff
                    .patients"
                  :key="patient.shiftId"
                  :class="patient.classes"
                >
                  <div class="patient-main-info">
                    <div class="patient-line-one">
                      {{ patient.dialysisBed }} - {{ patient.name }}
                    </div>
                    <div class="patient-line-two">
                      <span v-if="patient.wardNumber" class="ward-number-display">{{
                        patient.wardNumber
                      }}</span>
                      <span v-if="patient.mode && patient.mode !== 'HD'" class="stats-special-mode"
                        >({{ patient.mode }})</span
                      >
                      <span v-if="patient.finalTags" class="note-display">{{
                        patient.finalTags
                      }}</span>
                    </div>
                  </div>
                  <PatientMessagesIcon :patient-id="patient.id" context="dialog" />
                </div>
              </div>
            </div>
            <div class="mobile-team-footer">
              門{{ effectiveStatsData.lateTakeOff[teamName]?.totalOpdCount || 0 }} 住{{
                effectiveStatsData.lateTakeOff[teamName]?.totalIpdCount || 0
              }}
              急{{ effectiveStatsData.lateTakeOff[teamName]?.totalErCount || 0 }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Modals -->
    <TaskCreateDialog
      :is-visible="isCreateTaskModalVisible"
      :all-patients="patientStore.allPatients"
      :preselected-patient="null"
      @close="isCreateTaskModalVisible = false"
      @submit="handleTaskCreated"
    />
    <BedChangeDialog
      :is-visible="isBedChangeDialogVisible"
      :patient-info="editingPatientInfo"
      :current-schedule="currentRecord.schedule"
      :target-shift-filter="bedChangeTargetShift"
      @confirm="handleBedChange"
      @cancel="handleDialogCancel"
    />
    <MemoDisplayDialog
      :is-visible="isMemoDialogVisible"
      :patient-id="selectedPatientForDialog?.id"
      :patient-name="selectedPatientForDialog?.name"
      @close=";(isMemoDialogVisible = false), (selectedPatientForDialog = null)"
    />
    <ConditionRecordDisplayDialog
      :is-visible="isConditionRecordDialogVisible"
      :patient-id="selectedPatientForDialog?.id"
      :patient-name="selectedPatientForDialog?.name"
      :target-date="formatDate(currentDate)"
      @close=";(isConditionRecordDialogVisible = false), (selectedPatientForDialog = null)"
    />
    <AlertDialog
      :is-visible="isAlertDialogVisible"
      :title="alertDialogTitle"
      :message="alertDialogMessage"
      @confirm="isAlertDialogVisible = false"
    />
    <ConfirmDialog
      :is-visible="isConfirmDialogVisible"
      title="請確認"
      :message="confirmDialogMessage"
      @confirm="handleConfirm"
      @cancel="handleCancel"
    />
    <PreparationPopover
      :is-visible="isPrepPopoverVisible"
      :patients="prepPopoverData.patients"
      :target-element="prepPopoverData.targetElement"
      @close="onPrepPopoverClose"
      @open-order-modal="openOrderModalFromPopover"
    />
    <DailyInjectionListDialog
      :is-visible="isInjectionDialogVisible"
      :is-loading="isInjectionLoading"
      :injections="dailyInjections"
      :target-date="formatDate(currentDate)"
      @close="isInjectionDialogVisible = false"
      :show-filter="false"
    />
    <DialysisOrderModal
      :is-visible="isOrderModalVisible"
      :patient-data="editingPatientForOrder"
      @close="isOrderModalVisible = false"
      @save="handleSaveOrder"
    />
    <button
      class="fab-mobile mobile-only"
      @click="isCreateTaskModalVisible = true"
      :disabled="!hasPermission('viewer')"
    >
      <i class="fas fa-plus"></i>
    </button>
    <!-- ✨ 新增：調班申請 Dialog -->
    <ExceptionCreateDialog
      :is-visible="isExceptionDialogVisible"
      :all-patients="allPatients"
      :is-page-locked="isPageLocked"
      :initial-data="exceptionToEdit"
      @close="isExceptionDialogVisible = false"
      @submit="handleCreateException"
    />

    <!-- ✨ 新增：預約變更類型選擇 Dialog -->
    <NewUpdateTypeDialog
      :is-visible="isNewUpdateTypeDialogVisible"
      :all-patients="allPatients"
      @close="isNewUpdateTypeDialogVisible = false"
      @continue="handleNewUpdateTypeSelected"
    />

    <!-- ✨ 新增：預約變更詳細設定 Dialog -->
    <PatientUpdateSchedulerDialog
      :is-visible="isSchedulerDialogVisible"
      :patient="patientForScheduler"
      :change-type="changeTypeForScheduler"
      :all-patients="allPatients"
      :is-editing="false"
      @close="isSchedulerDialogVisible = false"
      @submit="handleScheduledUpdate"
    />
  </div>
</template>

<script setup>
import { ref, onMounted, computed, reactive, watch, onUnmounted, provide } from 'vue'
import {
  schedulesApi as localSchedulesApi,
  ordersApi,
  authApi,
  systemApi,
} from '@/services/localApiClient'
import { SHIFT_CODES } from '@/constants/scheduleConstants.js'
import { generateAutoNote, getUnifiedCellStyle } from '@/utils/scheduleUtils.js'
import { useAuth } from '@/composables/useAuth'
import { useGlobalNotifier } from '@/composables/useGlobalNotifier.js'
import { fetchTeamsByDate, saveTeams, updateTeams } from '@/services/nurseAssignmentsService.js'
import { createDialysisOrderAndUpdatePatient } from '@/services/optimizedApiService.js'
import BedChangeDialog from '@/components/BedChangeDialog.vue'
import MemoDisplayDialog from '@/components/MemoDisplayDialog.vue'
import ConditionRecordDisplayDialog from '@/components/ConditionRecordDisplayDialog.vue'
import PatientMessagesIcon from '@/components/PatientMessagesIcon.vue'
import AlertDialog from '@/components/AlertDialog.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import PreparationPopover from '@/components/PreparationPopover.vue'
import TaskCreateDialog from '@/components/TaskCreateDialog.vue'
import { usePatientStore } from '@/stores/patientStore'
import { useTaskStore } from '@/stores/taskStore'
import { useMedicationStore } from '@/stores/medicationStore'
import { useArchiveStore } from '@/stores/archiveStore'
import { storeToRefs } from 'pinia'
import DailyInjectionListDialog from '@/components/DailyInjectionListDialog.vue'
import DialysisOrderModal from '@/components/DialysisOrderModal.vue'
import * as XLSX from 'xlsx'
import DailyStaffDisplay from '@/components/DailyStaffDisplay.vue'
// ✨ 新增：引入調班和預約變更相關元件
import ExceptionCreateDialog from '@/components/ExceptionCreateDialog.vue'
import NewUpdateTypeDialog from '@/components/NewUpdateTypeDialog.vue'
import PatientUpdateSchedulerDialog from '@/components/PatientUpdateSchedulerDialog.vue'

// --- Store 和 Composables 初始化 ---
const patientStore = usePatientStore()
const taskStore = useTaskStore()
const archiveStore = useArchiveStore()
const medicationStore = useMedicationStore()
const { patientMap, allPatients } = storeToRefs(patientStore)
const { currentUser, hasPermission, canEditSchedules } = useAuth()
const { createGlobalNotification } = useGlobalNotifier()

const nurseNameList = [
  '陳素秋',
  '古孟麗',
  '謝常菁',
  '林玉麗',
  '陳聖柔',
  '田姿瑛',
  '陳韋吟',
  '劉姿秀',
  '劉舒婷',
  '李慈賢',
  '黃羿寧',
  '高佩鳳',
  '林沛儀',
  '陳芃諭',
  '葛孟萍',
  '蘇愛玲',
  '郭芳君',
  '林馨如',
  '胡國暄',
  '施艾利',
  '陳淑玲',
  '謝慶諭',
  '林佩佳',
  '吳思婷',
  '吳幸美',
  '林芳羽',
  '蔡靜怡',
  '莊明月',
]
const earlyBaseTeams = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', '外圍', '未分組']
const lateBaseTeams = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', '外圍', '未分組']
const earlyTeams = earlyBaseTeams.map((t) => `早${t}`)
const lateTeams = lateBaseTeams.map((t) => `晚${t}`)
const dutyAssignments = {
  early: {
    現場指揮官: 'K',
    安全防護班: ['A', 'B', 'J-75'],
    引導救護班: ['C', 'D', 'E', 'G', 'H-1', 'I-2'],
    滅火班: 'F-75',
  },
  late: {
    現場指揮官: 'K',
    安全防護班: ['A', 'B', 'J-75'],
    引導救護班: ['C', 'D', 'E', 'G', 'H-1', 'I-2'],
    滅火班: 'F-75',
  },
  night: {
    現場指揮官: 'A',
    '安全防護班/通報班': 'B',
    引導救護班: ['C', 'D', 'E', 'G', 'H'],
    滅火班: 'F-128',
  },
}

// --- 輔助函式 ---
async function getEffectiveOrdersForDate(patientId, targetDate) {
  if (!patientId || !targetDate) return {}
  const dateStr = targetDate.toISOString().slice(0, 10)
  try {
    const results = await ordersApi.fetchHistory({
      patientId,
      effectiveDateBefore: dateStr,
      limit: 1
    })
    return results.length > 0 ? results[0].orders : {}
  } catch (error) {
    console.error(`獲取病人 ${patientId} 的醫囑失敗:`, error)
    return {}
  }
}

// --- Vue Refs and Reactives (大部分保持不變) ---
const isFireDutyDropdownVisible = ref(false)
const currentDate = ref(new Date())
const statusIndicator = ref('')
const isLoading = ref(false)
const currentRecord = reactive({ id: null, date: '', schedule: {} })
const currentTeamsRecord = ref({ id: null, date: '', teams: {}, names: {} })
const hasUnsavedScheduleChanges = ref(false)
const hasUnsavedTeamChanges = ref(false)
const isBedChangeDialogVisible = ref(false)
const editingPatientInfo = ref(null)
const isMemoDialogVisible = ref(false)
const isConditionRecordDialogVisible = ref(false)
const selectedPatientForDialog = ref(null)
const isAlertDialogVisible = ref(false)
const alertDialogTitle = ref('')
const alertDialogMessage = ref('')
const isConfirmDialogVisible = ref(false)
const confirmDialogMessage = ref('')
const onConfirmAction = ref(null)
const pendingChangeInfo = ref(null)
const bedChangeTargetShift = ref(null)
const isPrepPopoverVisible = ref(false)
const prepPopoverData = reactive({ patients: [], targetElement: null })
const isCreateTaskModalVisible = ref(false)
const dailyPhysicians = ref({ early: null, noon: null, late: null })
const dailyConsultPhysicians = ref({ morning: null, afternoon: null, night: null })
const isInjectionDialogVisible = ref(false)
const dailyInjections = ref([])
const isInjectionLoading = ref(false)
const noonTakeoffVisibility = ref({ early: false, late: false })
const isOrderModalVisible = ref(false)
const editingPatientForOrder = ref(null)

provide('viewingDate', currentDate)

// ✨ 新增：調班申請相關 refs
const isExceptionDialogVisible = ref(false)
const exceptionToEdit = ref(null)

// ✨ 新增：預約變更相關 refs
const isNewUpdateTypeDialogVisible = ref(false)
const isSchedulerDialogVisible = ref(false)
const patientForScheduler = ref(null)
const changeTypeForScheduler = ref('')

// --- Computed Properties (大部分保持不變) ---
const hasUnsavedChanges = computed(
  () => hasUnsavedScheduleChanges.value || hasUnsavedTeamChanges.value,
)
const isPageLocked = computed(() => {
  if (!canEditSchedules.value) return true
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const currentDay = new Date(currentDate.value)
  currentDay.setHours(0, 0, 0, 0)
  return currentDay < today
})
const weekdayDisplay = computed(
  () => ['日', '一', '二', '三', '四', '五', '六'][new Date(currentDate.value).getDay()],
)
const lateShiftTakeOffExists = computed(() => {
  // 檢查是否有啟用標記或任何已分配的收針分組
  if (currentTeamsRecord.value.takeoffEnabled) return true
  return Object.values(currentTeamsRecord.value.teams || {}).some(
    (team) => team && typeof team.nurseTeamTakeOff !== 'undefined',
  )
})
const sortedEarlyTeams = computed(() => {
  if (!effectiveStatsData.value || !effectiveStatsData.value.early) return []
  const teams = Object.keys(effectiveStatsData.value.early)
  return teams.sort((a, b) => {
    if (a.includes('未分組')) return 1
    if (b.includes('未分組')) return -1
    if (a.includes('外圍')) return 1
    if (b.includes('外圍')) return -1
    return a.localeCompare(b)
  })
})
const sortedLateTeams = computed(() => {
  if (!effectiveStatsData.value || !effectiveStatsData.value.late) return []
  const teams = Object.keys(effectiveStatsData.value.late)
  return teams.sort((a, b) => {
    if (a.includes('未分組')) return 1
    if (b.includes('未分組')) return -1
    if (a.includes('外圍')) return 1
    if (b.includes('外圍')) return -1
    return a.localeCompare(b)
  })
})
const sortedLateTakeOffTeams = computed(() => {
  if (!effectiveStatsData.value || !effectiveStatsData.value.lateTakeOff) return []
  const teams = Object.keys(effectiveStatsData.value.lateTakeOff)
  return teams.sort((a, b) => {
    if (a.includes('未分組')) return 1
    if (b.includes('未分組')) return -1
    if (a.includes('外圍')) return 1
    if (b.includes('外圍')) return -1
    return a.localeCompare(b)
  })
})

const effectiveStatsData = computed(() => {
  const createTeamStats = (teams, shiftType) => {
    const stats = {}
    teams.forEach((team) => {
      stats[team] = {
        nurseName: currentTeamsRecord.value.names?.[team] || '',
        totalOpdCount: 0,
        totalIpdCount: 0,
        totalErCount: 0,
      }
      if (shiftType === 'early') {
        stats[team].earlyShift = { patients: [], opdCount: 0, ipdCount: 0, erCount: 0 }
        stats[team].noonShiftOn = { patients: [], opdCount: 0, ipdCount: 0, erCount: 0 }
        stats[team].noonShiftOff = { patients: [], opdCount: 0, ipdCount: 0, erCount: 0 }
      } else if (shiftType === 'late') {
        stats[team].noonShiftOff = { patients: [], opdCount: 0, ipdCount: 0, erCount: 0 }
        stats[team].lateShift = { patients: [], opdCount: 0, ipdCount: 0, erCount: 0 }
      } else if (shiftType === 'lateTakeOff') {
        stats[team].lateShiftTakeOff = { patients: [], opdCount: 0, ipdCount: 0, erCount: 0 }
      }
    })
    return stats
  }

  const lateTakeOffTeams = lateBaseTeams.map((t) => `夜間收針${t}`)
  const earlyShiftStats = createTeamStats(earlyTeams, 'early')
  const lateShiftStats = createTeamStats(lateTeams, 'late')
  const lateTakeOffStats = createTeamStats(lateTakeOffTeams, 'lateTakeOff')

  if (!currentRecord.schedule) {
    return { early: earlyShiftStats, late: lateShiftStats, lateTakeOff: lateTakeOffStats }
  }

  const messagesMap = taskStore.getPatientMessageTypesMapForDate(currentDate.value)

  for (const shiftId in currentRecord.schedule) {
    const shiftDetails = currentRecord.schedule[shiftId]
    if (!shiftDetails || !shiftDetails.patientId) continue

    const patientInfo = getArchivedOrLivePatientInfo(shiftDetails)
    const patientDetails = patientMap.value.get(shiftDetails.patientId)
    if (!patientInfo || !patientDetails) continue

    const messageTypesForPatient = messagesMap.get(patientDetails.id) || []
    const cellStyles = getUnifiedCellStyle(shiftDetails, patientInfo, null, messageTypesForPatient)

    const detail = {
      id: patientDetails.id,
      shiftId,
      name: patientDetails.name,
      medicalRecordNumber: patientDetails.medicalRecordNumber,
      status: patientInfo.status,
      mode: patientInfo.mode,
      wardNumber: patientInfo.wardNumber || '',
      dialysisBed: shiftId.startsWith('peripheral') ? '外圍' : shiftId.split('-')[1] || '',
      finalTags: [
        ...new Set([
          ...(shiftDetails.autoNote || '').split(' '),
          ...(shiftDetails.manualNote || '').split(' '),
        ]),
      ]
        .filter((tag) => tag && !['住', '急'].includes(tag))
        .join(' '),
      classes:
        'patient-item ' +
        Object.entries(cellStyles)
          .filter(([, v]) => v)
          .map(([k]) => k)
          .join(' '),
      dialysisOrders: patientDetails.dialysisOrders || {},
    }

    const assignAndCount = (group, pDetail) => {
      if (!group) return
      group.patients.push(pDetail)
      if (pDetail.status === 'ipd') group.ipdCount++
      else if (pDetail.status === 'er') group.erCount++
      else group.opdCount++
    }

    const shiftCode = shiftId.split('-')[2]
    const { nurseTeam, nurseTeamIn, nurseTeamOut, nurseTeamTakeOff } = shiftDetails

    if (shiftCode === SHIFT_CODES.EARLY) {
      const targetTeam = nurseTeam || '早未分組'
      if (earlyShiftStats[targetTeam]) {
        assignAndCount(earlyShiftStats[targetTeam].earlyShift, detail)
      }
    } else if (shiftCode === SHIFT_CODES.LATE) {
      const targetTeam = nurseTeam || '晚未分組'
      if (lateShiftStats[targetTeam]) {
        assignAndCount(lateShiftStats[targetTeam].lateShift, detail)
      }
      const targetTakeOffTeam = nurseTeamTakeOff || '夜間收針未分組'
      if (lateTakeOffStats[targetTakeOffTeam]) {
        assignAndCount(lateTakeOffStats[targetTakeOffTeam].lateShiftTakeOff, detail)
      }
    } else if (shiftCode === SHIFT_CODES.NOON) {
      const targetInTeam = nurseTeamIn || '早未分組'
      if (earlyShiftStats[targetInTeam]) {
        assignAndCount(earlyShiftStats[targetInTeam].noonShiftOn, detail)
      }
      if (nurseTeamOut) {
        if (lateShiftStats[nurseTeamOut])
          assignAndCount(lateShiftStats[nurseTeamOut].noonShiftOff, detail)
        else if (earlyShiftStats[nurseTeamOut])
          assignAndCount(earlyShiftStats[nurseTeamOut].noonShiftOff, detail)
      } else {
        if (lateShiftStats['晚未分組']) {
          assignAndCount(lateShiftStats['晚未分組'].noonShiftOff, detail)
        }
      }
    }
  }

  const sortPatientsByBed = (a, b) =>
    (a.dialysisBed === '外圍' ? 100 : parseInt(a.dialysisBed, 10)) -
    (b.dialysisBed === '外圍' ? 100 : parseInt(b.dialysisBed, 10))

  ;[earlyShiftStats, lateShiftStats, lateTakeOffStats].forEach((stats, index) => {
    for (const team in stats) {
      const teamData = stats[team]
      if (!teamData) continue
      Object.values(teamData).forEach((group) => {
        if (group && Array.isArray(group.patients)) {
          group.patients.sort(sortPatientsByBed)
        }
      })
      if (index === 0) {
        teamData.totalOpdCount =
          (teamData.earlyShift?.opdCount || 0) + (teamData.noonShiftOn?.opdCount || 0)
        teamData.totalIpdCount =
          (teamData.earlyShift?.ipdCount || 0) + (teamData.noonShiftOn?.ipdCount || 0)
        teamData.totalErCount =
          (teamData.earlyShift?.erCount || 0) + (teamData.noonShiftOn?.erCount || 0)
      } else if (index === 1) {
        teamData.totalOpdCount = teamData.lateShift?.opdCount || 0
        teamData.totalIpdCount = teamData.lateShift?.ipdCount || 0
        teamData.totalErCount = teamData.lateShift?.erCount || 0
      } else {
        teamData.totalOpdCount = teamData.lateShiftTakeOff?.opdCount || 0
        teamData.totalIpdCount = teamData.lateShiftTakeOff?.ipdCount || 0
        teamData.totalErCount = teamData.lateShiftTakeOff?.erCount || 0
      }
    }
  })

  return { early: earlyShiftStats, late: lateShiftStats, lateTakeOff: lateTakeOffStats }
})

// --- 方法 (Methods) ---
const formatDate = (date) => {
  if (!date) return ''
  const d = new Date(date)
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`
}
function toggleNoonTakeoff(shiftType) {
  if (shiftType === 'early' || shiftType === 'late') {
    noonTakeoffVisibility.value[shiftType] = !noonTakeoffVisibility.value[shiftType]
  }
}
function setScheduleChange() {
  if (isPageLocked.value) return
  hasUnsavedScheduleChanges.value = true
  statusIndicator.value = '有未儲存的變更'
}
function setTeamChange() {
  if (isPageLocked.value) return
  hasUnsavedTeamChanges.value = true
  statusIndicator.value = '有未儲存的變更'
}
async function loadDailyStaffInfo(date) {
  try {
    const dateStr = formatDate(date).substring(0, 7)
    const [monthScheduleDoc, allUsers] = await Promise.all([
      systemApi.fetchPhysicianSchedule(dateStr),
      authApi.getUsers(),
    ])
    // 過濾出醫師和專科護理師
    const physicians = allUsers.filter(u =>
      u.title === '主治醫師' || u.title === '專科護理師'
    )
    const userMap = new Map(physicians.map((u) => [u.id, u]))

    const dialysisPhysiciansData = { early: null, noon: null, late: null }
    const consultPhysiciansData = { morning: null, afternoon: null, night: null }

    if (monthScheduleDoc?.scheduleData) {
      const dayOfMonth = date.getDate()

      // 獲取查房醫師 (在 scheduleData.schedule 內)
      const daySchedule = monthScheduleDoc.scheduleData?.schedule?.[dayOfMonth]
      if (daySchedule) {
        dialysisPhysiciansData.early = userMap.get(daySchedule.early?.physicianId) || null
        dialysisPhysiciansData.noon = userMap.get(daySchedule.noon?.physicianId) || null
        dialysisPhysiciansData.late = userMap.get(daySchedule.late?.physicianId) || null
      }

      // 獲取會診醫師 (在 scheduleData.consultationSchedule 內)
      const consultationDaySchedule = monthScheduleDoc.scheduleData?.consultationSchedule?.[dayOfMonth]
      if (consultationDaySchedule) {
        consultPhysiciansData.morning =
          userMap.get(consultationDaySchedule.morning?.physicianId) || null
        consultPhysiciansData.afternoon =
          userMap.get(consultationDaySchedule.afternoon?.physicianId) || null
        consultPhysiciansData.night =
          userMap.get(consultationDaySchedule.night?.physicianId) || null
      }
    }

    dailyPhysicians.value = dialysisPhysiciansData
    dailyConsultPhysicians.value = consultPhysiciansData
  } catch (error) {
    console.error('載入每日負責人資訊失敗:', error)
    dailyPhysicians.value = { early: null, noon: null, late: null }
    dailyConsultPhysicians.value = { morning: null, afternoon: null, night: null }
  }
}

async function fetchArchivedSchedule(dateStr) {
  return await archiveStore.fetchScheduleByDate(dateStr)
}

async function fetchLiveSchedule(dateStr) {
  const record = await localSchedulesApi.fetchByDate(dateStr)
  if (!record || !record.schedule) {
    return { date: dateStr, schedule: {} }
  }

  if (record.schedule) {
    for (const shiftId in record.schedule) {
      const slot = record.schedule[shiftId]
      if (slot?.patientId && patientMap.value.has(slot.patientId)) {
        const patient = patientMap.value.get(slot.patientId)
        slot.autoNote = patient ? generateAutoNote(patient) : ''
      }
    }
  }
  return record
}

// ===================================================================
// ✨✨✨【`loadData` 函式的最終簡化版】✨✨✨
// ===================================================================
async function loadData(date) {
  // 1. 重置狀態
  hasUnsavedScheduleChanges.value = false
  hasUnsavedTeamChanges.value = false
  statusIndicator.value = '讀取中...'
  isLoading.value = true
  const dateStr = formatDate(date)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const targetDate = new Date(date)
  targetDate.setHours(0, 0, 0, 0)

  try {
    // 2. 根據是否為過去日期，決定是否需要獲取最新的病人列表
    const isPastDate = targetDate < today
    if (!isPastDate) {
      // 只有在查詢今天或未來時，才需要最新的病人資料
      await patientStore.fetchPatientsIfNeeded()
    }

    // 3. 根據日期，從 "歸檔" 或 "即時" 集合中獲取排班資料
    const scheduleRecord = isPastDate
      ? await fetchArchivedSchedule(dateStr)
      : await fetchLiveSchedule(dateStr)

    // ✨ 核心簡化：直接獲取每日分組文件，不再執行任何前端同步邏輯
    const teamsData = await fetchTeamsByDate(dateStr)

    // 4. 將獲取到的資料賦值給本地狀態
    Object.assign(currentRecord, scheduleRecord)
    currentTeamsRecord.value = teamsData || { id: null, date: dateStr, teams: {}, names: {} }

    // 5. 為當天排班上的病人，批次獲取其有效的透析醫囑 (優化 N+1 問題)
    const patientIdsInSchedule = [
      ...new Set(
        Object.values(currentRecord.schedule)
          .map((slot) => slot.patientId)
          .filter(Boolean),
      ),
    ]

    if (patientIdsInSchedule.length > 0) {
      try {
        // 使用批次 API 取得所有病人的醫囑
        // 由於後端限制單次查詢最多 100 位病人，需分批處理
        const BATCH_SIZE = 100
        const chunks = []
        for (let i = 0; i < patientIdsInSchedule.length; i += BATCH_SIZE) {
          chunks.push(patientIdsInSchedule.slice(i, i + BATCH_SIZE))
        }

        // 並行查詢所有批次
        const batchPromises = chunks.map((chunk) =>
          ordersApi.fetchHistoryBatch({
            patientIds: chunk,
            effectiveDateBefore: dateStr,
          })
        )
        const batchResultsArray = await Promise.all(batchPromises)

        // 合併所有批次結果
        const batchResults = batchResultsArray.reduce((acc, result) => {
          return { ...acc, ...result }
        }, {})

        // 將批次結果分配到各病人
        for (const patientId of patientIdsInSchedule) {
          const patientInStore = patientMap.value.get(patientId)
          if (patientInStore) {
            const orderData = batchResults[patientId]
            patientInStore.dialysisOrders = orderData?.orders || {}
          }
        }
      } catch (error) {
        console.error('批次獲取醫囑失敗:', error)
        // 降級為逐一獲取
        const ordersPromises = patientIdsInSchedule.map(async (patientId) => {
          const orders = await getEffectiveOrdersForDate(patientId, date)
          const patientInStore = patientMap.value.get(patientId)
          if (patientInStore) {
            patientInStore.dialysisOrders = orders
          }
        })
        await Promise.all(ordersPromises)
      }
    }

    // 6. 將分組資訊 (teams) 合併到排班資料 (schedule) 中，以便 UI 顯示
    if (currentRecord.schedule) {
      for (const shiftId in currentRecord.schedule) {
        const slot = currentRecord.schedule[shiftId]
        if (!slot || !slot.patientId) continue
        const shiftCode = shiftId.split('-')[2]
        const teamKey = `${slot.patientId}-${shiftCode}`
        const teamInfo = currentTeamsRecord.value.teams[teamKey]
        if (teamInfo) {
          Object.assign(slot, teamInfo)
        }
      }
    }

    // 7. 設置最終的狀態指示文字
    statusIndicator.value = currentRecord.id ? '資料已載入' : '本日無排班資料'
  } catch (error) {
    console.error('讀取報表資料失敗:', error)
    statusIndicator.value = '讀取失敗'
  } finally {
    isLoading.value = false
  }
}

function getArchivedOrLivePatientInfo(slotData) {
  if (!slotData || !slotData.patientId) return null
  if (slotData.archivedPatientInfo) {
    return slotData.archivedPatientInfo
  }
  return patientMap.value.get(slotData.patientId) || null
}

async function saveChangesToCloud() {
  if (isPageLocked.value || !hasUnsavedChanges.value) return
  statusIndicator.value = '儲存中...'
  const promises = []
  try {
    if (hasUnsavedScheduleChanges.value) {
      const scheduleToSave = JSON.parse(JSON.stringify(currentRecord.schedule))
      for (const key in scheduleToSave) {
        delete scheduleToSave[key].nurseTeam
        delete scheduleToSave[key].nurseTeamIn
        delete scheduleToSave[key].nurseTeamOut
        delete scheduleToSave[key].nurseTeamTakeOff
        delete scheduleToSave[key].autoNote
      }
      // 使用本地 API 更新排程
      promises.push(
        localSchedulesApi.updateByDate(currentRecord.date, scheduleToSave)
          .then((saved) => {
            if (saved?.id) currentRecord.id = saved.id
          })
      )
    }
    if (hasUnsavedTeamChanges.value) {
      const teamsData = {
        date: currentTeamsRecord.value.date,
        teams: currentTeamsRecord.value.teams || {},
        names: currentTeamsRecord.value.names || {},
        takeoffEnabled: currentTeamsRecord.value.takeoffEnabled || false,
      }
      if (currentTeamsRecord.value.id) {
        promises.push(updateTeams(currentTeamsRecord.value.id, teamsData))
      } else {
        promises.push(
          saveTeams(teamsData).then((saved) => (currentTeamsRecord.value.id = saved.id)),
        )
      }
    }
    await Promise.all(promises)
    hasUnsavedScheduleChanges.value = false
    hasUnsavedTeamChanges.value = false
    statusIndicator.value = '變更已儲存！'
    const message = `修改護理分組: ${currentRecord.date}`
    createGlobalNotification(message, 'team', { routePath: `/stats?date=${currentRecord.date}` })
    showAlert('操作成功', '變更儲存成功！')
    await loadData(currentDate.value)
  } catch (error) {
    console.error('儲存變更失敗:', error)
    statusIndicator.value = '儲存失敗'
    showAlert('儲存失敗', `儲存失敗: ${error.message}`)
  }
}

function getDutyTagClass(dutyName) {
  if (dutyName.includes('指揮官')) return 'role-field-commander'
  if (dutyName.includes('安全')) return 'role-safety'
  if (dutyName.includes('引導')) return 'role-guide'
  if (dutyName.includes('滅火')) return 'role-fire'
  if (dutyName.includes('通報')) return 'role-reporter'
  return 'role-default'
}
function applyTeamAndScheduleChange(
  patientDetail,
  oldShiftId,
  newShiftId,
  newTeam,
  newResponsibility,
) {
  const movingSlotData = { ...currentRecord.schedule[oldShiftId] }
  delete currentRecord.schedule[oldShiftId]
  currentRecord.schedule[newShiftId] = movingSlotData
  setScheduleChange()
  const patientId = patientDetail.id
  const oldShiftCode = oldShiftId.split('-')[2]
  const oldTeamKey = `${patientId}-${oldShiftCode}`
  if (currentTeamsRecord.value.teams && currentTeamsRecord.value.teams[oldTeamKey]) {
    const sourceResp = patientDetail.sourceResponsibility
    if (sourceResp === 'earlyShift' || sourceResp === 'lateShift')
      delete currentTeamsRecord.value.teams[oldTeamKey].nurseTeam
    if (sourceResp === 'noonShiftOn') delete currentTeamsRecord.value.teams[oldTeamKey].nurseTeamIn
    if (sourceResp === 'noonShiftOff')
      delete currentTeamsRecord.value.teams[oldTeamKey].nurseTeamOut
    if (sourceResp === 'lateShiftTakeOff')
      delete currentTeamsRecord.value.teams[oldTeamKey].nurseTeamTakeOff
    if (Object.keys(currentTeamsRecord.value.teams[oldTeamKey]).length === 0) {
      delete currentTeamsRecord.value.teams[oldTeamKey]
    }
  }
  const newShiftCode = newShiftId.split('-')[2]
  const newTeamKey = `${patientId}-${newShiftCode}`
  if (!currentTeamsRecord.value.teams) currentTeamsRecord.value.teams = {}
  if (!currentTeamsRecord.value.teams[newTeamKey]) {
    currentTeamsRecord.value.teams[newTeamKey] = {}
  }
  performTeamChange({ ...patientDetail, shiftId: newShiftId }, newTeam, newResponsibility)
}
function onDrop(event, newTeam, newResponsibility) {
  if (isPageLocked.value) return
  event.preventDefault()
  event.currentTarget.classList.remove('drag-over-active')
  const patientDetail = JSON.parse(event.dataTransfer.getData('application/json'))
  const oldShiftId = patientDetail.shiftId
  if (!oldShiftId || !currentRecord.schedule[oldShiftId]) return
  const oldShiftCode = oldShiftId.split('-')[2]
  const newShiftCode =
    newResponsibility === 'earlyShift'
      ? SHIFT_CODES.EARLY
      : newResponsibility === 'lateShift' || newResponsibility === 'lateShiftTakeOff'
        ? SHIFT_CODES.LATE
        : SHIFT_CODES.NOON
  if (newShiftCode !== oldShiftCode) {
    const shiftIdParts = oldShiftId.split('-')
    const newShiftId = `${shiftIdParts[0]}-${shiftIdParts[1]}-${newShiftCode}`
    if (currentRecord.schedule[newShiftId]) {
      pendingChangeInfo.value = { patientDetail, newTeam, newResponsibility }
      bedChangeTargetShift.value = newShiftCode
      openBedChangeDialog(patientDetail)
    } else {
      applyTeamAndScheduleChange(patientDetail, oldShiftId, newShiftId, newTeam, newResponsibility)
    }
  } else {
    performTeamChange(patientDetail, newTeam, newResponsibility)
  }
}
function performTeamChange(patientDetail, newTeam, newResponsibility) {
  const patientId = patientDetail.id
  const shiftId = patientDetail.shiftId
  const shiftCode = shiftId.split('-')[2]
  const teamKey = `${patientId}-${shiftCode}`
  if (!currentTeamsRecord.value.teams) currentTeamsRecord.value.teams = {}
  if (!currentTeamsRecord.value.teams[teamKey]) {
    currentTeamsRecord.value.teams[teamKey] = {}
  }
  const teamInfo = currentTeamsRecord.value.teams[teamKey]
  const slotInfo = currentRecord.schedule[shiftId]
  if (!slotInfo) return
  const isUnassigned = newTeam.includes('未分組')
  const finalTeamValue = isUnassigned ? null : newTeam
  if (newResponsibility === 'earlyShift' || newResponsibility === 'lateShift') {
    teamInfo.nurseTeam = finalTeamValue
    slotInfo.nurseTeam = finalTeamValue
  } else if (newResponsibility === 'noonShiftOn') {
    teamInfo.nurseTeamIn = finalTeamValue
    slotInfo.nurseTeamIn = finalTeamValue
  } else if (newResponsibility === 'noonShiftOff') {
    teamInfo.nurseTeamOut = finalTeamValue
    slotInfo.nurseTeamOut = finalTeamValue
  } else if (newResponsibility === 'lateShiftTakeOff') {
    teamInfo.nurseTeamTakeOff = finalTeamValue
    slotInfo.nurseTeamTakeOff = finalTeamValue
  }
  if (
    !teamInfo.nurseTeam &&
    !teamInfo.nurseTeamIn &&
    !teamInfo.nurseTeamOut &&
    !teamInfo.nurseTeamTakeOff
  ) {
    delete currentTeamsRecord.value.teams[teamKey]
  }
  setTeamChange()
}
function onDragStart(event, patientDetail, responsibility) {
  if (isPageLocked.value) {
    event.preventDefault()
    return
  }
  const detailWithSource = { ...patientDetail, sourceResponsibility: responsibility }
  event.dataTransfer.setData('application/json', JSON.stringify(detailWithSource))
  event.dataTransfer.effectAllowed = 'move'
}
function openBedChangeDialog(patientDetail) {
  if (isPageLocked.value) return
  if (!bedChangeTargetShift.value) {
    const currentShiftCode = patientDetail.shiftId.split('-')[2]
    bedChangeTargetShift.value = currentShiftCode
  }
  editingPatientInfo.value = patientDetail
  isBedChangeDialogVisible.value = true
}
function handleBedChange({ oldShiftId, newShiftId }) {
  if (isPageLocked.value || !oldShiftId || !newShiftId || !currentRecord.schedule[oldShiftId]) {
    isBedChangeDialogVisible.value = false
    return
  }
  if (pendingChangeInfo.value) {
    const { patientDetail, newTeam, newResponsibility } = pendingChangeInfo.value
    applyTeamAndScheduleChange(patientDetail, oldShiftId, newShiftId, newTeam, newResponsibility)
  } else {
    const movingSlotData = { ...currentRecord.schedule[oldShiftId] }
    delete currentRecord.schedule[oldShiftId]
    currentRecord.schedule[newShiftId] = movingSlotData
    setScheduleChange()
  }
  isBedChangeDialogVisible.value = false
  pendingChangeInfo.value = null
  bedChangeTargetShift.value = null
}
function handleDialogCancel() {
  isBedChangeDialogVisible.value = false
  pendingChangeInfo.value = null
  bedChangeTargetShift.value = null
}
function onDragOver(event) {
  if (isPageLocked.value) return
  event.preventDefault()
  event.currentTarget.classList.add('drag-over-active')
}
function onDragLeave(event) {
  event.currentTarget.classList.remove('drag-over-active')
}
function showPrepPopover(event, teamData, shiftType) {
  const patientsInShift = teamData[shiftType]?.patients || []
  if (patientsInShift.length === 0) return
  prepPopoverData.patients = patientsInShift
  prepPopoverData.targetElement = event.currentTarget
  isPrepPopoverVisible.value = true
}
function onPrepPopoverClose() {
  isPrepPopoverVisible.value = false
}

function changeDate(days) {
  const performChange = () => {
    const newDate = new Date(currentDate.value)
    newDate.setDate(newDate.getDate() + days)
    currentDate.value = newDate
  }
  if (hasUnsavedChanges.value && !isPageLocked.value) {
    confirmDialogMessage.value = '您有未儲存的變更，確定要切換日期嗎？'
    onConfirmAction.value = performChange
    isConfirmDialogVisible.value = true
  } else {
    performChange()
  }
}
function goToToday() {
  const performChange = () => {
    currentDate.value = new Date()
  }
  if (hasUnsavedChanges.value && !isPageLocked.value) {
    confirmDialogMessage.value = '您有未儲存的變更，確定要切換到今天嗎？'
    onConfirmAction.value = performChange
    isConfirmDialogVisible.value = true
  } else {
    performChange()
  }
}
function handleConfirm() {
  if (onConfirmAction.value) onConfirmAction.value()
  isConfirmDialogVisible.value = false
  onConfirmAction.value = null
}
function handleCancel() {
  isConfirmDialogVisible.value = false
  onConfirmAction.value = null
}
function showAlert(title, message) {
  alertDialogTitle.value = title
  alertDialogMessage.value = message
  isAlertDialogVisible.value = true
}
async function handleTaskCreated() {
  showAlert('操作成功', '交辦/留言已成功新增！')
  isCreateTaskModalVisible.value = false
  // 立即刷新任務列表，讓新任務馬上顯示
  await taskStore.refreshTasks()
}

async function showInjectionList(teamData, shiftType = null) {
  const patientIdsToFetch = new Set()
  if (shiftType && teamData[shiftType] && Array.isArray(teamData[shiftType].patients)) {
    teamData[shiftType].patients.forEach((p) => patientIdsToFetch.add(p.id))
  } else {
    for (const key in teamData) {
      if (teamData[key] && Array.isArray(teamData[key].patients)) {
        teamData[key].patients.forEach((p) => patientIdsToFetch.add(p.id))
      }
    }
  }

  const patientIdArray = Array.from(patientIdsToFetch)

  // --- 📍 日誌點 A (StatsView): 檢查要查詢的病人 ---
  console.log(
    `[StatsView] 準備查詢針劑，組別/班別: ${shiftType || '全部'}, 病人數: ${patientIdArray.length}`,
    patientIdArray,
  )

  isInjectionDialogVisible.value = true
  isInjectionLoading.value = true
  dailyInjections.value = []

  if (patientIdArray.length === 0) {
    isInjectionLoading.value = false
    return
  }

  const targetDate = formatDate(currentDate.value)

  try {
    const injectionsForGroup = await medicationStore.fetchDailyInjections(
      targetDate,
      patientIdArray,
    )

    // --- 📍 日誌點 B (StatsView): 檢查從 Store 返回的結果 ---
    console.log(
      `[StatsView] 從 Store 收到 ${injectionsForGroup.length} 筆針劑資料。`,
      injectionsForGroup,
    )

    dailyInjections.value = injectionsForGroup
  } catch (error) {
    console.error('[StatsView] 獲取應打針劑失敗:', error)
    showAlert('查詢失敗', `獲取應打針劑清單時發生錯誤: ${error.message}`)
    isInjectionDialogVisible.value = false
  } finally {
    isInjectionLoading.value = medicationStore.isLoading
  }
}

function exportAssignmentsToExcel() {
  if (isLoading.value) {
    showAlert('提示', '資料仍在載入中，請稍後再試。')
    return
  }
  const aoa = []
  const formatPatientCell = (patients) => {
    if (!patients || patients.length === 0) return ''
    return patients
      .map((p) => {
        const parts = [`${p.dialysisBed} - ${p.name}`]
        if (p.finalTags) {
          parts.push(`(${p.finalTags})`)
        }
        return parts.join(' ')
      })
      .join('\n')
  }
  const formatCountCell = (teamData) => {
    return `門${teamData?.totalOpdCount || 0} 住${teamData?.totalIpdCount || 0} 急${teamData?.totalErCount || 0}`
  }
  const earlyHeaders = [
    '早班',
    ...sortedEarlyTeams.value.map((name) =>
      name.includes('未分組') ? '未分組' : name.replace('早', '') + '組',
    ),
  ]
  aoa.push(earlyHeaders)
  const earlyNames = [
    '姓名',
    ...sortedEarlyTeams.value.map(
      (name) => effectiveStatsData.value.early[name]?.nurseName || '-- 未指派 --',
    ),
  ]
  aoa.push(earlyNames)
  const earlyShiftRow = [
    '早班',
    ...sortedEarlyTeams.value.map((name) =>
      formatPatientCell(effectiveStatsData.value.early[name]?.earlyShift.patients),
    ),
  ]
  aoa.push(earlyShiftRow)
  const noonOnShiftRow = [
    '午班(上針)',
    ...sortedEarlyTeams.value.map((name) =>
      formatPatientCell(effectiveStatsData.value.early[name]?.noonShiftOn.patients),
    ),
  ]
  aoa.push(noonOnShiftRow)
  const noonOffShiftRowEarly = [
    '午班(收針)',
    ...sortedEarlyTeams.value.map((name) =>
      formatPatientCell(effectiveStatsData.value.early[name]?.noonShiftOff.patients),
    ),
  ]
  aoa.push(noonOffShiftRowEarly)
  const earlyCounts = [
    '照護人數',
    ...sortedEarlyTeams.value.map((name) => formatCountCell(effectiveStatsData.value.early[name])),
  ]
  aoa.push(earlyCounts)
  aoa.push([])
  const lateHeaders = [
    '晚班',
    ...sortedLateTeams.value.map((name) =>
      name.includes('未分組') ? '未分組' : name.replace('晚', '') + '組',
    ),
  ]
  aoa.push(lateHeaders)
  const lateNames = [
    '姓名',
    ...sortedLateTeams.value.map(
      (name) => effectiveStatsData.value.late[name]?.nurseName || '-- 未指派 --',
    ),
  ]
  aoa.push(lateNames)
  const noonOffShiftRowLate = [
    '午班(收針)',
    ...sortedLateTeams.value.map((name) =>
      formatPatientCell(effectiveStatsData.value.late[name]?.noonShiftOff.patients),
    ),
  ]
  aoa.push(noonOffShiftRowLate)
  const lateShiftRow = [
    '晚班',
    ...sortedLateTeams.value.map((name) =>
      formatPatientCell(effectiveStatsData.value.late[name]?.lateShift.patients),
    ),
  ]
  aoa.push(lateShiftRow)
  const lateCounts = [
    '照護人數',
    ...sortedLateTeams.value.map((name) => formatCountCell(effectiveStatsData.value.late[name])),
  ]
  aoa.push(lateCounts)
  if (lateShiftTakeOffExists.value) {
    aoa.push([])
    const lateTakeoffHeaders = [
      '夜班收針',
      ...sortedLateTakeOffTeams.value.map((name) =>
        name.includes('未分組') ? '未分組' : name.replace('夜間收針', '') + '組',
      ),
    ]
    aoa.push(lateTakeoffHeaders)
    const lateTakeoffNames = [
      '姓名',
      ...sortedLateTakeOffTeams.value.map(
        (name) => effectiveStatsData.value.lateTakeOff[name]?.nurseName || '-- 未指派 --',
      ),
    ]
    aoa.push(lateTakeoffNames)
    const lateTakeoffShiftRow = [
      '夜班收針',
      ...sortedLateTakeOffTeams.value.map((name) =>
        formatPatientCell(effectiveStatsData.value.lateTakeOff[name]?.lateShiftTakeOff.patients),
      ),
    ]
    aoa.push(lateTakeoffShiftRow)
    const lateTakeoffCounts = [
      '照護人數',
      ...sortedLateTakeOffTeams.value.map((name) =>
        formatCountCell(effectiveStatsData.value.lateTakeOff[name]),
      ),
    ]
    aoa.push(lateTakeoffCounts)
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const colWidths = [{ wch: 12 }]
  for (let i = 1; i < earlyHeaders.length; i++) {
    colWidths.push({ wch: 25 })
  }
  ws['!cols'] = colWidths
  const rowHeights = []
  const range = XLSX.utils.decode_range(ws['!ref'])
  for (let R = range.s.r; R <= range.e.r; ++R) {
    let maxLines = 1
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const cell_address = { c: C, r: R }
      const cell_ref = XLSX.utils.encode_cell(cell_address)
      if (ws[cell_ref] && ws[cell_ref].v) {
        const cellValue = String(ws[cell_ref].v)
        const lines = cellValue.split('\n').length
        if (lines > maxLines) {
          maxLines = lines
        }
        ws[cell_ref].s = { alignment: { wrapText: true, vertical: 'top' } }
      }
    }
    if (maxLines > 1) {
      rowHeights.push({ hpt: maxLines * 15 })
    } else {
      rowHeights.push({ hpt: 20 })
    }
  }
  ws['!rows'] = rowHeights
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '護理分組表')
  const fileName = `護理分組表_${formatDate(currentDate.value)}.xlsx`
  XLSX.writeFile(wb, fileName)
}
function promptDuplicateLateShift() {
  if (isPageLocked.value) return
  confirmDialogMessage.value =
    '您確定要為夜班建立一個獨立的「收針」分組嗎？\n這將會複製目前的夜班病人分配，讓您可以單獨調整。'
  onConfirmAction.value = duplicateLateShiftForTakeOff
  isConfirmDialogVisible.value = true
}
function duplicateLateShiftForTakeOff() {
  if (isPageLocked.value) return

  // 設定啟用標記，即使晚班沒有病人也會顯示收針區塊
  currentTeamsRecord.value.takeoffEnabled = true

  for (const shiftId in currentRecord.schedule) {
    const slot = currentRecord.schedule[shiftId]
    if (!slot) continue
    const shiftCode = shiftId.split('-')[2]
    if (shiftCode === SHIFT_CODES.LATE && slot.patientId) {
      const teamKey = `${slot.patientId}-${shiftCode}`
      if (!currentTeamsRecord.value.teams) currentTeamsRecord.value.teams = {}
      const teamInfo = currentTeamsRecord.value.teams[teamKey] || {}
      if (teamInfo.nurseTeam) {
        const newTeamName = teamInfo.nurseTeam.replace('晚', '夜間收針')
        teamInfo.nurseTeamTakeOff = newTeamName
        slot.nurseTeamTakeOff = newTeamName
      }
      currentTeamsRecord.value.teams[teamKey] = teamInfo
    }
  }
  if (currentTeamsRecord.value.names) {
    for (const teamName in currentTeamsRecord.value.names) {
      if (teamName.startsWith('晚')) {
        const nurseName = currentTeamsRecord.value.names[teamName]
        if (nurseName) {
          const newTakeOffTeamName = teamName.replace('晚', '夜間收針')
          currentTeamsRecord.value.names[newTakeOffTeamName] = nurseName
        }
      }
    }
  }
  setTeamChange()
  showAlert('操作成功', '夜班收針分組已建立，您可以開始調整。')
}

// 【✨ 新增修改 ✨】: 提示移除的方法
function promptRemoveLateShiftTakeOff() {
  if (isPageLocked.value) return
  confirmDialogMessage.value =
    '您確定要移除「夜班收針」分組嗎？\n所有相關的收針分配將會被永久刪除，此操作無法復原。'
  onConfirmAction.value = removeLateShiftTakeOff
  isConfirmDialogVisible.value = true
}

// 【✨ 新增修改 ✨】: 實際執行移除的方法
function removeLateShiftTakeOff() {
  if (isPageLocked.value) return

  // 0. 移除啟用標記
  delete currentTeamsRecord.value.takeoffEnabled

  // 1. 移除 schedule 中的 nurseTeamTakeOff 屬性
  for (const shiftId in currentRecord.schedule) {
    const slot = currentRecord.schedule[shiftId]
    if (slot && typeof slot.nurseTeamTakeOff !== 'undefined') {
      delete slot.nurseTeamTakeOff
    }
  }

  // 2. 移除 teams 中的 nurseTeamTakeOff 屬性
  if (currentTeamsRecord.value.teams) {
    for (const teamKey in currentTeamsRecord.value.teams) {
      const teamInfo = currentTeamsRecord.value.teams[teamKey]
      if (teamInfo && typeof teamInfo.nurseTeamTakeOff !== 'undefined') {
        delete teamInfo.nurseTeamTakeOff
        // 如果這個 teamInfo 物件變空了，就整個刪除
        if (Object.keys(teamInfo).length === 0) {
          delete currentTeamsRecord.value.teams[teamKey]
        }
      }
    }
  }

  // 3. 移除 names 中所有 '夜間收針' 開頭的護理師指派
  if (currentTeamsRecord.value.names) {
    for (const teamName in currentTeamsRecord.value.names) {
      if (teamName.startsWith('夜間收針')) {
        delete currentTeamsRecord.value.names[teamName]
      }
    }
  }

  setTeamChange() // 標記為有變更
  showAlert('操作成功', '夜班收針分組已移除。請記得儲存變更。')
}

const handleIconClick = (patientId, context, type) => {
  if (context === 'dialog') {
    const patient = patientMap.value.get(patientId)
    if (patient) {
      selectedPatientForDialog.value = { id: patientId, name: patient.name }
      // 根據類型決定打開哪個 dialog
      if (type === 'record') {
        isConditionRecordDialogVisible.value = true
      } else {
        isMemoDialogVisible.value = true
      }
    }
  }
}
provide('handleIconClick', handleIconClick)

async function handleSaveOrder(orderData) {
  if (isPageLocked.value) {
    showAlert('操作失敗', '操作被鎖定：權限不足。')
    return
  }
  if (!editingPatientForOrder.value?.id) {
    showAlert('儲存失敗', '找不到有效的病人資訊。')
    return
  }
  const patientId = editingPatientForOrder.value.id
  const patientName = editingPatientForOrder.value.name
  try {
    await createDialysisOrderAndUpdatePatient(patientId, patientName, orderData)
    await loadData(currentDate.value)
    isOrderModalVisible.value = false
    createGlobalNotification(`更新醫囑：${patientName}`, 'team')
    showAlert('儲存成功', `已成功更新 ${patientName} 的透析醫囑。`)
  } catch (error) {
    console.error('儲存醫囑失敗:', error)
    showAlert('操作失敗', `儲存醫囑時發生錯誤: ${error.message}`)
  }
}

const openOrderModalFromPopover = (patient) => {
  if (patient && patient.id) {
    editingPatientForOrder.value = patient
    isOrderModalVisible.value = true
  }
}

// ✨ 處理調班申請
async function handleCreateException(formData) {
  try {
    const dataToSave = {
      patientId: formData.patientId,
      patientName: formData.patientName,
      type: formData.type,
      reason: formData.reason,
      startDate: formData.startDate,
      endDate: formData.endDate,
      from: formData.from,
      to: formData.to,
      status: 'pending',
    }

    if (formData.type === 'SWAP') {
      dataToSave.date = formData.date
      dataToSave.patient1 = formData.patient1
      dataToSave.patient2 = formData.patient2
    }

    await localSchedulesApi.createException(dataToSave)
    isExceptionDialogVisible.value = false
    createGlobalNotification(`成功新增調班申請: ${formData.patientName}`, 'success')
  } catch (error) {
    console.error('提交調班申請失敗:', error)
    showAlert('提交失敗', `無法儲存調班申請: ${error.message}`)
  }
}

// ✨ 新增：處理預約變更選擇
function handleNewUpdateTypeSelected({ patient, changeType }) {
  patientForScheduler.value = patient
  changeTypeForScheduler.value = changeType
  isNewUpdateTypeDialogVisible.value = false
  setTimeout(() => {
    isSchedulerDialogVisible.value = true
  }, 150)
}

// ✨ 處理預約變更提交
async function handleScheduledUpdate(dataToSubmit) {
  isSchedulerDialogVisible.value = false
  try {
    await systemApi.createScheduledUpdate(dataToSubmit)
    createGlobalNotification('預約成功！變更將在指定日期自動生效。', 'success')
  } catch (error) {
    console.error('提交預約失敗:', error)
    showAlert('提交失敗', `無法儲存預約變更: ${error.message}`)
  }
}

// 2.5 watch 和 watchEffect (放在這裡)
watch(hasUnsavedChanges, (newValue) => {
  if (newValue && !statusIndicator.value.includes('儲存')) {
    statusIndicator.value = '⚠️ 有未儲存的變更'
  } else if (!newValue && statusIndicator.value.includes('儲存')) {
    statusIndicator.value = '資料已載入'
  }
})

watch(currentDate, (newDate) => {
  medicationStore.clearCache()
  noonTakeoffVisibility.value = { early: false, late: false }
  loadData(newDate)
  loadDailyStaffInfo(newDate)
})

// --- Lifecycle Hooks (保持不變) ---
onMounted(() => {
  Promise.all([loadData(currentDate.value), loadDailyStaffInfo(currentDate.value)])
})

onUnmounted(() => {
  // cleanup if needed
})
</script>

<style scoped>
/* ✨✨✨ 核心修改 #8: 新增唯讀姓名的樣式 ✨✨✨ */
.name-cell-readonly {
  background-color: #fffde7;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 500;
  font-size: 1em;
  padding: 8px;
  height: 100%;
  box-sizing: border-box;
}

.nurse-name-display {
  color: #333;
}

.unassigned-name-display {
  color: #999;
  font-style: italic;
}

.nurse-name-display-mobile {
  font-weight: 500;
  padding: 6px 10px;
  background-color: #f1f3f5;
  border-radius: 4px;
  border: 1px solid #dee2e6;
  font-size: 1em;
}
/* 【✨ 新增修改 ✨】: 移除按鈕的樣式 */
.takeoff-header-content {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  width: 100%;
}
.remove-takeoff-btn {
  background-color: #ffebee;
  color: #c62828;
  border: 1px solid #ef9a9a;
  border-radius: 50%;
  width: 28px;
  height: 28px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.9rem;
  cursor: pointer;
  transition: all 0.2s;
}
.remove-takeoff-btn:hover {
  background-color: #ef9a9a;
  color: white;
}

/* ================================== */
/* === 1. 頁面佈局 (核心修改) === */
/* ================================== */
.page-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding: 10px;
  box-sizing: border-box;
  overflow: hidden; /* 保持 hidden，控制權交給子元素 */
  background-color: #f8f9fa;
}

.page-header-content {
  flex-shrink: 0;
  padding-bottom: 10px;
}

/* ✨ [這就是關鍵的修復！] ✨ */
/* 將滾動功能直接賦予這個 flex-grow 的容器 */
.scrollable-main-content {
  flex-grow: 1;
  min-height: 0; /* 確保在 flex 容器中可以正確計算高度 */
  overflow-y: auto; /* ✨ 加上這一行，讓這個區塊自己負責垂直滾動 */
  position: relative;
}

/* 您原先為桌面版做的滾動層可以移除 overflow，或保留也無妨，
   因為現在它的父層已經可以滾動了。
   為了架構清晰，建議將滾動職責統一交給 .scrollable-main-content */
.stats-sections-wrapper {
  display: flex;
  flex-direction: column;
  gap: 20px;
  /* overflow-y: auto; <-- 這行可以移除，因為父層已有滾動功能 */
  padding-bottom: 10px;
}

/* ================================== */
/* === 2. 按鈕樣式 (統一基礎) === */
/* ================================== */
button,
.btn {
  padding: 8px 15px;
  font-size: 1em;
  cursor: pointer;
  border-radius: 5px;
  border: 1px solid #ccc;
  background-color: #fff;
  transition: all 0.2s;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

button:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

/* 按鈕變體 */
#save-changes-btn {
  background-color: #4caf50;
  color: white;
  border-color: #4caf50;
}
#save-changes-btn:hover:not(:disabled) {
  background-color: #45a049;
}

.btn-primary {
  background-color: #007bff;
  color: white;
  border-color: #007bff;
}
.btn-primary:hover:not(:disabled) {
  background-color: #0069d9;
}

.btn-secondary {
  background-color: #6c757d;
  color: white;
  border-color: #6c757d;
}
.btn-secondary:hover:not(:disabled) {
  background-color: #5a6268;
}

.duplicate-shift-btn {
  border-color: #6f42c1;
  color: #6f42c1;
}

/* ================================== */
/* === 3. 頂部工具列 === */
/* ================================== */
.header-toolbar {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
  margin-bottom: 15px;
}

.toolbar-left,
.toolbar-right {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 15px;
}

.page-title {
  font-size: 32px; /* 稍微調整大小以平衡視覺 */
  color: #333;
  margin: 0;
  white-space: nowrap;
}

/* ✨ [這是對應的樣式修改] ✨ */
.date-navigator {
  display: flex; /* 關鍵：讓內部元素水平排列 */
  align-items: center; /* 垂直居中對齊 */
  gap: 12px; /* 設定元素之間的間距 */
}

/* 新增一個包裝容器，讓日期和星期能更好地對齊 */
.date-display-wrapper {
  display: flex;
  align-items: baseline; /* 讓不同大小的文字基線對齊，更美觀 */
  gap: 8px;
}

.current-date-text {
  font-size: 26px;
  font-weight: bold;
  color: #333;
  padding: 0; /* 移除舊的 padding */
}

.weekday-display {
  font-size: 26px;
  font-weight: bold;
  color: #007bff;
}

/* 確保按鈕不會因為空間不足而被壓縮 */
.date-navigator button {
  flex-shrink: 0;
}
/* ✨ [樣式修改結束] ✨ */

.status-indicator {
  font-size: 0.9em;
  font-weight: bold;
  color: #757575;
  font-style: italic;
  white-space: nowrap;
}

/* ================================================= */
/* === 【核心修改 4】: 全新的醫師與消防並排佈局樣式 === */
/* ================================================= */
.info-row-wrapper {
  display: flex !important;
  justify-content: space-between;
  align-items: center;
  gap: 1.5rem;
  margin-bottom: 15px;
}

/* (右側) 消防編組整體容器 */
.duty-command-bar {
  display: flex;
  align-items: center;
  gap: 1.5rem;
}

/* 消防編組的水平佈局容器 (標題 + 網格) */
.fire-duty-panel {
  display: flex;
  align-items: center; /* 讓標題和網格垂直居中對齊 */
  gap: 12px; /* 標題和網格之間的間距 */
}

/* 消防編組標題 */
.duty-title {
  font-weight: 600;
  font-size: 0.95em;
  color: #b45309;
}

/* 2x2 網格容器 */
.duty-grid {
  display: grid;
  grid-template-columns: repeat(2, auto); /* 兩列，寬度自適應 */
  gap: 4px 20px; /* 上下間距 4px, 左右間距 20px */
}

/* 每一對"標籤+姓名"的容器 */
.duty-item-pair {
  display: flex;
  align-items: center;
  gap: 8px; /* 標籤和姓名之間的間距 */
  white-space: nowrap; /* 防止姓名換行 */
}

/* 標籤樣式 (保持不變) */
.duty-role-tag {
  font-size: 0.8em;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 12px;
  color: #fff;
}
.duty-role-tag.role-commander {
  background-color: #be185d;
}
.duty-role-tag.role-reporter {
  background-color: #059669;
}
.duty-role-tag.role-field-commander {
  background-color: #d97706;
}
.duty-role-tag.role-guide {
  background-color: #0d9488;
}

/* 人員姓名樣式 (從舊版繼承，保持不變) */
.duty-person {
  font-weight: 500;
  color: #1e293b;
  font-size: 0.9em;
}

/* 消防下拉選單 (保持不變) */
.duty-dropdown-wrapper {
  position: relative;
}
.duty-dropdown-trigger {
  background-color: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 6px 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 500;
  height: 40px;
}
.duty-dropdown-trigger:hover {
  background-color: #e2e8f0;
}
.toggle-arrow {
  transition: transform 0.2s ease-in-out;
  font-size: 0.8em;
}
.toggle-arrow.is-rotated {
  transform: rotate(180deg);
}
.duty-dropdown-menu {
  position: absolute;
  top: calc(100% + 5px);
  right: 0;
  background-color: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  width: 600px;
  z-index: 100;
  padding: 12px;
}
.duty-shift-group {
  margin-bottom: 12px;
}
.duty-shift-group:last-child {
  margin-bottom: 0;
}
.duty-shift-header {
  font-size: 1.1em;
  font-weight: bold;
  color: #005a9c;
  padding-bottom: 8px;
  margin-bottom: 8px;
  border-bottom: 2px solid #e2e8f0;
}
.duty-item {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 8px;
  align-items: center;
  padding: 4px 0;
  font-size: 0.95em;
}
.duty-name {
  font-size: 0.9em;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 12px;
  color: #fff;
  text-align: center;
  justify-self: end;
}
.duty-name.role-field-commander {
  background-color: #d97706;
}
.duty-name.role-safety {
  background-color: #2563eb;
}
.duty-name.role-guide {
  background-color: #0d9488;
}
.duty-name.role-fire {
  background-color: #be185d;
}
.duty-name.role-reporter,
.duty-name[class*='通報班'] {
  background-color: #059669;
}
.duty-name.role-default {
  background-color: #475569;
}
.duty-teams {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.duty-team-tag {
  background-color: #e0e7ff;
  color: #3730a3;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 500;
}

/* ================================== */
/* === 5. 主表格樣式 === */
/* ================================== */
.loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(255, 255, 255, 0.85);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 999;
  font-size: 1.5rem;
  color: #333;
  gap: 20px;
  backdrop-filter: blur(2px);
}

.loading-spinner {
  border: 8px solid #f3f3f3;
  border-top: 8px solid #3498db;
  border-radius: 50%;
  width: 60px;
  height: 60px;
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

.stats-section {
  overflow-x: auto;
  padding-bottom: 10px;
  scrollbar-width: thin;
  scrollbar-color: #aab7c4 #f1f1f1;
}

.stats-section::-webkit-scrollbar {
  height: 8px;
}
.stats-section::-webkit-scrollbar-track {
  background: #f1f1f1;
  border-radius: 4px;
}
.stats-section::-webkit-scrollbar-thumb {
  background: #aab7c4;
  border-radius: 4px;
}
.stats-section::-webkit-scrollbar-thumb:hover {
  background: #888;
}

/* Grid 佈局 */
.grid-container {
  min-width: 1800px;
  display: grid;
  border: 1px solid #ddd;
  border-radius: 8px;
  background-color: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.grid-header,
.grid-body,
.grid-footer,
.grid-row {
  display: contents;
}

/* Grid 儲存格共同樣式 */
.row-header,
.team-header-cell,
.grid-cell,
.total-count-summary {
  border-right: 1px solid #ddd;
  border-bottom: 1px solid #ddd;
  padding: 8px;
  word-wrap: break-word;
}

/* 移除最後一欄右邊框 */
.grid-container > * > *:last-child {
  border-right: none;
}

/* 移除最後一列下邊框 */
.grid-footer > * {
  border-bottom: none;
}

/* 標題儲存格 */
.row-header {
  background-color: #f2f2f2;
  font-weight: bold;
  text-align: center;
  position: sticky;
  left: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
}

.team-header-cell {
  background-color: #e3f2fd;
  font-weight: bold;
  text-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
  position: sticky;
  top: 0;
  z-index: 1;
}

.section-title-cell {
  font-size: 1.5em;
  color: #005a9c;
  background-color: #e3f2fd;
  position: sticky;
  top: 0;
  left: 0;
  z-index: 3;
}

/* 姓名選擇器 */
.name-cell {
  padding: 0 !important;
}

.name-select {
  width: 100%;
  height: 100%;
  border: none;
  background-color: #fffde7;
  text-align: center;
  font-size: 1em;
  cursor: pointer;
  -webkit-appearance: none;
  appearance: none;
  padding: 8px;
}

/* 病人儲存格 */
.patient-list-cell {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  text-align: left;
  vertical-align: top;
  min-height: 120px;
  transition: background-color 0.2s;
}

.patient-list-cell.drag-over-active {
  background-color: #e8f5e9;
  border: 2px dashed #4caf50;
}

.patient-wrapper {
  flex-grow: 1;
}

/* 病人項目 */
.patient-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  position: relative;
  padding: 6px 8px;
  margin-bottom: 5px;
  border-radius: 4px;
  border: 1px solid #b0bec5;
  background-color: #f5f5f5;
  font-size: 0.95em;
  line-height: 1.4;
  user-select: none;
}

.patient-item:active {
  cursor: grabbing;
  background-color: #e0e0e0;
  opacity: 0.8;
  transform: scale(1.02);
}

.patient-main-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex-grow: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}

.patient-line-one {
  font-weight: bold;
  font-size: 1em;
  white-space: nowrap;
}

.patient-line-two {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.9em;
  white-space: nowrap;
}

/* 病人狀態顏色 */
.patient-item.status-opd {
  background-color: #e8f5e9;
  border-color: #a5d6a7;
}
.patient-item.status-ipd {
  background-color: #ffebee;
  border-color: #ef9a9a;
}
.patient-item.status-er {
  background-color: #f3e5f5;
  border-color: #ce93d8;
}
.patient-item.status-biweekly {
  background-color: #ffcc80;
  border-color: #ffb74d;
}

/* 特殊標籤 */
.patient-item.tag-chou {
  background-color: #658ee0 !important;
  color: white !important;
  border-color: #3949ab !important;
}
.patient-item.tag-chou * {
  color: white !important;
}
.patient-item.tag-new {
  background-color: #f5ec8e;
  border-color: #e0d567;
}
.patient-item.tag-huan {
  background-color: #e0f7fa;
  border-color: #b2ebf2;
}
.patient-item.tag-liang {
  background-color: #fff3e0;
  border-color: #ffe0b2;
}
.patient-item.tag-b {
  background-color: #fff9c4;
  border-color: #fff59d;
}

/* 顯示元素 */
.note-display {
  color: #c62828;
  font-weight: bold;
}

.stats-special-mode {
  display: inline-block;
  vertical-align: middle;
  padding: 1px 5px;
  color: #c62828;
  border: 1px solid #ef9a9a;
  border-radius: 4px;
  font-weight: bold;
  font-size: 0.9em;
  line-height: 1.2;
}

.ward-number-display {
  display: inline-block;
  background-color: #4a90e2;
  color: white;
  padding: 2px 7px;
  border-radius: 10px;
  font-size: 0.9em;
  font-weight: 500;
  margin-right: 4px;
  vertical-align: middle;
}

/* 統計摘要 */
.total-count-summary {
  background-color: #f8f9fa;
  font-weight: bold;
  text-align: center;
  color: #333;
  padding: 10px 8px;
}

/* 收合功能 */
.collapsible-header {
  cursor: pointer;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  transition: background-color 0.2s;
  grid-column: 1 / -1;
  padding: 8px;
}

.collapsible-header:hover {
  background-color: #e9ecef;
}

.collapse-icon {
  font-size: 0.8em;
  transition: transform 0.3s ease-in-out;
}

.collapse-icon.is-expanded {
  transform: rotate(90deg);
}

/* 動畫效果 */
.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: all 0.2s ease-out;
}

.slide-fade-enter-from,
.slide-fade-leave-to {
  transform: translateY(-5px);
  opacity: 0;
}

.grid-row-fade-enter-active,
.grid-row-fade-leave-active {
  transition: all 0.3s ease-out;
}

.grid-row-fade-enter-from .grid-cell,
.grid-row-fade-leave-to .grid-cell {
  opacity: 0;
  transform: translateY(-10px);
}

/* 未分組樣式 */
.unassigned-header {
  background-color: #ffe0b2 !important;
  color: #8d6e63 !important;
}

.unassigned-cell {
  background-color: #fff8e1 !important;
  border-left: 2px solid #ffb74d;
}

.unassigned-placeholder {
  width: 100%;
  height: 100%;
  background-color: #fffde7;
}

/* 夜班收針區塊 */
.late-takeoff-section {
  border-top: 4px solid #007bff;
  margin-top: 1.5rem;
}

/* 操作按鈕 */
.cell-actions-container {
  position: absolute;
  bottom: 4px;
  right: 6px;
  display: flex;
  gap: 8px;
}

.prep-list-trigger,
.injection-list-trigger {
  cursor: pointer;
  font-size: 1.2rem;
  padding: 2px;
  border-radius: 4px;
  transition: background-color 0.2s;
  user-select: none;
}

.prep-list-trigger:hover,
.injection-list-trigger:hover {
  background-color: #e0e0e0;
}

/* 鎖定狀態 */
.is-locked .stats-section {
  cursor: not-allowed;
}

.is-locked .patient-list-cell {
  background-color: #f5f5f5;
}

.is-locked .name-select {
  pointer-events: none;
  background-color: #eeeeee;
}

.is-locked .patient-main-info {
  cursor: not-allowed;
}

.is-locked .patient-item {
  pointer-events: none;
}

.is-locked :deep(.memo-icon-wrapper),
.is-locked .prep-list-trigger,
.is-locked .injection-list-trigger {
  pointer-events: auto;
  cursor: pointer;
}

/* Deep 選擇器 */
:deep(.memo-icon-wrapper) {
  flex-shrink: 0;
  margin-left: auto;
  padding-left: 8px;
  align-self: center;
}

/* 新增按鈕群組樣式 */
.action-buttons-group {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.btn-info {
  background-color: #17a2b8;
  color: white;
  border-color: #17a2b8;
}
.btn-info:hover:not(:disabled) {
  background-color: #138496;
}

.btn-warning {
  background-color: #ffc107;
  color: #212529;
  border-color: #ffc107;
}
.btn-warning:hover:not(:disabled) {
  background-color: #e0a800;
}

/* ================================== */
/* === 6. 響應式設計 === */
/* ================================== */
.mobile-only {
  display: none;
}
.desktop-only {
  display: block;
}
.desktop-only-flex {
  display: flex;
}

@media screen and (max-width: 1200px) {
  .toolbar-left {
    gap: 1rem;
  }
}

@media screen and (max-width: 992px) {
  .desktop-only,
  .desktop-only-flex {
    display: none !important;
  }

  .mobile-only {
    display: block !important;
  }

  .page-container {
    padding: 0;
  }

  .page-header-content {
    padding: 10px;
  }

  .scrollable-main-content {
    padding: 0 10px 80px 10px;
  }

  .header-toolbar,
  .toolbar-left {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }

  .page-title {
    text-align: center;
    font-size: 1.5rem;
  }

  .date-navigator {
    display: grid;
    grid-template-columns: auto 1fr auto;
    width: 100%;
  }

  .current-date-text,
  .weekday-display {
    font-size: 1.25rem;
    text-align: center;
  }

  .toolbar-left > button {
    width: 100%;
    box-sizing: border-box;
    justify-content: center;
  }
  .action-buttons-group {
    width: 100%;
    flex-direction: column;
  }

  .action-buttons-group button {
    width: 100%;
    justify-content: center;
  }

  /* 行動版卡片樣式 */
  .mobile-shift-section {
    border: 1px solid #ddd;
    border-radius: 8px;
    margin-bottom: 20px;
    background-color: #fff;
    overflow: hidden;
  }

  .mobile-shift-title {
    background-color: #e3f2fd;
    color: #005a9c;
    font-size: 1.5em;
    padding: 12px;
    margin: 0;
    border-bottom: 1px solid #ddd;
  }

  .mobile-team-card {
    padding: 12px;
    border-top: 1px solid #eee;
  }

  .mobile-team-card:first-of-type {
    border-top: none;
  }

  .mobile-team-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }

  .mobile-team-header h3 {
    margin: 0;
    font-size: 1.3em;
    color: #333;
  }

  .mobile-team-header .name-select {
    width: 150px;
    height: auto;
    font-size: 1em;
    padding: 6px;
    border: 1px solid #ccc;
    border-radius: 4px;
  }

  .mobile-patient-lists {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .mobile-patient-list h4 {
    margin: 0 0 8px 0;
    font-size: 1.1em;
    color: #555;
    border-bottom: 2px solid #f0f0f0;
    padding-bottom: 4px;
  }

  .mobile-patient-list.collapsible h4 {
    cursor: pointer;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .collapsible-content {
    padding-top: 8px;
  }

  .mobile-team-footer {
    margin-top: 12px;
    padding-top: 8px;
    border-top: 1px solid #eee;
    text-align: right;
    font-weight: bold;
    color: #333;
  }

  .mobile-only .name-select:disabled {
    background-color: #f5f5f5;
    border-color: #ddd;
    color: #555;
    -webkit-appearance: none;
    appearance: none;
    cursor: default;
  }

  .mobile-only .patient-main-info {
    cursor: default;
  }

  /* FAB 按鈕 */
  .fab-mobile {
    position: fixed;
    bottom: 1.5rem;
    right: 1.5rem;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background-color: #007bff;
    color: white;
    border: none;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    font-size: 1.5rem;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
  }
}
</style>
