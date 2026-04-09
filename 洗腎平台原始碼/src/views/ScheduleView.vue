<!-- 檔案路徑: src/views/ScheduleView.vue (修正版) -->
<template>
  <div class="page-container" :class="{ 'is-locked': isPageLocked }">
    <div v-if="isLoading" class="loading-overlay">
      <div class="loading-spinner"></div>
      <span>正在載入 {{ formatDate(currentDate) }} 的資料...</span>
    </div>

    <header class="page-header">
      <!-- 第一列：主工具列 -->
      <div class="header-toolbar">
        <div class="toolbar-left">
          <h1 class="page-title">每日排程</h1>
          <!-- 行動版ICU醫囑按鈕 -->
          <button
            class="btn-secondary mobile-only"
            @click="isIcuOrdersDialogVisible = true"
            :disabled="!auth.canEditClinicalNotesAndOrders"
            title="顯示外圍病房當日透析醫囑單"
          >
            <i class="fas fa-notes-medical"></i>
            <span class="mobile-btn-text">ICU醫囑</span>
          </button>
          <div class="date-navigator">
            <button class="btn" @click="changeDate(-1)">&lt; 上一天</button>
            <span class="current-date-text">{{ currentDateDisplay }}</span>
            <span class="weekday-display">{{ weekdayDisplay }}</span>
            <button class="btn" @click="changeDate(1)">下一天 &gt;</button>
            <button class="btn" @click="goToToday">回到今日</button>
          </div>
          <!-- 以下按鈕僅在桌面版顯示 -->
          <button class="btn btn-warning desktop-only" @click="runScheduleCheck">排程檢視</button>
          <button
            class="btn btn-info desktop-only"
            @click="isAssignmentDialogVisible = true"
            :disabled="isPageLocked"
          >
            智慧排床
          </button>
          <button
            class="btn desktop-only"
            @click="autoAssignNurseTeams"
            :disabled="isPageLocked"
            style="background-color: #007bff; color: white; border-color: #007bff"
          >
            自動分組
          </button>
        </div>
        <div class="toolbar-right">
          <StatsToolbar
            :stats-data="statsToolbarData"
            :weekdays="statsToolbarWeekdays"
            :show-patient-numbers="true"
            size="compact"
            class="mobile-and-print-only"
          />
          <span class="status-indicator">{{ statusIndicator }}</span>
          <button
            class="btn btn-success desktop-only"
            @click="saveDataToCloud"
            :disabled="!hasUnsavedChanges || isPageLocked"
          >
            儲存
          </button>
          <button class="btn btn-secondary desktop-only" @click="exportScheduleToExcel">
            匯出Excel
          </button>
        </div>
      </div>

      <!-- 第二列：控制面板 -->
      <div class="controls-panel desktop-only">
        <div class="controls-left">
          <button
            class="view-toggle-btn desktop-only"
            @click="isSimplifiedViewVisible = !isSimplifiedViewVisible"
          >
            <span class="toggle-icon">{{ isSimplifiedViewVisible ? '▼' : '▶' }}</span>
            {{ isSimplifiedViewVisible ? '收合臨床查閱' : '展開臨床查閱' }}
          </button>
          <button
            class="btn-secondary desktop-only"
            @click="isInpatientRoundsDialogVisible = true"
            :disabled="todayInpatients.length === 0"
            title="顯示今日住院病人總覽"
          >
            <i class="fas fa-walking"></i> 住院趴趴走 ({{ todayInpatients.length }})
          </button>
          <button
            class="btn-secondary desktop-only"
            @click="isIcuOrdersDialogVisible = true"
            :disabled="!auth.canEditClinicalNotesAndOrders"
            title="顯示外圍病房當日透析醫囑單"
          >
            <i class="fas fa-notes-medical"></i> ICU醫囑單
          </button>
        </div>
        <div class="controls-right">
          <DailyStaffDisplay
            :daily-physicians="dailyPhysicians"
            :daily-consult-physicians="dailyConsultPhysicians"
          />
          <StatsToolbar
            :stats-data="statsToolbarData"
            :weekdays="statsToolbarWeekdays"
            :show-patient-numbers="true"
          />
        </div>
      </div>
    </header>

    <main class="page-main-content" :class="{ 'is-locked': isPageLocked }">
      <!-- (A) 臨床查閱模式 (桌面覆蓋層) -->
      <div v-if="isSimplifiedViewVisible" class="simplified-view-wrapper desktop-only">
        <div class="simplified-view">
          <table class="simplified-table">
            <thead>
              <tr>
                <th class="col-bed">床號</th>
                <th v-for="shiftCode in ORDERED_SHIFT_CODES" :key="shiftCode">
                  <div class="shift-header-content">
                    <span>{{ getShiftDisplayName(shiftCode) }}</span>
                    <button
                      @click="showShiftInjections(shiftCode)"
                      class="summary-icon-btn-table"
                      title="查看此班針劑"
                    >
                      💉
                    </button>
                    <button
                      @click="showShiftMedicationDrafts(shiftCode)"
                      class="summary-icon-btn-table"
                      title="查看此班藥囑草稿"
                    >
                      <i class="fas fa-file-prescription"></i>
                    </button>
                    <button
                      @click="showShiftRecordsSummary(shiftCode)"
                      class="summary-icon-btn-table"
                      title="查看此班紀錄"
                    >
                      📋
                    </button>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="bedNum in sortedBedNumbers" :key="bedNum">
                <td class="col-bed">{{ bedNum }}</td>
                <td
                  v-for="shiftCode in ORDERED_SHIFT_CODES"
                  :key="shiftCode"
                  :class="getPatientCellStyle(`bed-${bedNum}-${shiftCode}`)"
                >
                  <div
                    v-if="currentRecord.schedule[`bed-${bedNum}-${shiftCode}`]"
                    class="patient-info-cell"
                  >
                    <div class="patient-mrn-name">
                      <span
                        class="medical-record-number"
                        @click.stop="
                          copyMedicalRecordNumber(
                            patientMap.get(
                              currentRecord.schedule[`bed-${bedNum}-${shiftCode}`].patientId,
                            )?.medicalRecordNumber,
                          )
                        "
                        title="點擊以複製病歷號"
                      >
                        {{
                          patientMap.get(
                            currentRecord.schedule[`bed-${bedNum}-${shiftCode}`].patientId,
                          )?.medicalRecordNumber
                        }}
                      </span>
                      <div
                        class="patient-name-wrapper"
                        @click="handleSimplifiedCellClick(`bed-${bedNum}-${shiftCode}`)"
                        title="點擊查看詳細資料"
                      >
                        <PatientMessagesIcon
                          :patient-id="
                            currentRecord.schedule[`bed-${bedNum}-${shiftCode}`].patientId
                          "
                          context="detail"
                        />
                        <span>{{ getPatientName(`bed-${bedNum}-${shiftCode}`) }}</span>
                        <span
                          v-if="
                            getPatientMode(`bed-${bedNum}-${shiftCode}`) &&
                            getPatientMode(`bed-${bedNum}-${shiftCode}`) !== 'HD'
                          "
                          class="stats-special-mode"
                        >
                          ({{ getPatientMode(`bed-${bedNum}-${shiftCode}`) }})
                        </span>
                      </div>
                    </div>
                    <div class="patient-note">
                      <span
                        v-if="
                          getPatientWardNumber(
                            currentRecord.schedule[`bed-${bedNum}-${shiftCode}`]?.patientId,
                          )
                        "
                        class="ward-number-display"
                      >
                        [{{
                          getPatientWardNumber(
                            currentRecord.schedule[`bed-${bedNum}-${shiftCode}`]?.patientId,
                          )
                        }}]
                      </span>
                      {{ getCombinedNote(`bed-${bedNum}-${shiftCode}`) }}
                    </div>
                  </div>
                </td>
              </tr>
              <tr v-for="i in peripheralBedCount" :key="`p-${i}`">
                <td class="col-bed">外圍 {{ i }}</td>
                <td
                  v-for="shiftCode in ORDERED_SHIFT_CODES"
                  :key="shiftCode"
                  :class="getPatientCellStyle(`peripheral-${i}-${shiftCode}`)"
                >
                  <div
                    v-if="currentRecord.schedule[`peripheral-${i}-${shiftCode}`]"
                    class="patient-info-cell"
                  >
                    <div class="patient-mrn-name">
                      <span
                        class="medical-record-number"
                        @click.stop="
                          copyMedicalRecordNumber(
                            patientMap.get(
                              currentRecord.schedule[`peripheral-${i}-${shiftCode}`].patientId,
                            )?.medicalRecordNumber,
                          )
                        "
                        title="點擊以複製病歷號"
                      >
                        {{
                          patientMap.get(
                            currentRecord.schedule[`peripheral-${i}-${shiftCode}`].patientId,
                          )?.medicalRecordNumber
                        }}
                      </span>
                      <div
                        class="patient-name-wrapper"
                        :class="[
                          getPatientCellStyle(`peripheral-${i}-${shiftCode}`),
                          { 'non-clickable': !auth.canEditClinicalNotesAndOrders },
                        ]"
                        @click="handleSimplifiedCellClick(`peripheral-${i}-${shiftCode}`)"
                        title="點擊查看詳細資料"
                      >
                        <PatientMessagesIcon
                          :patient-id="
                            currentRecord.schedule[`peripheral-${i}-${shiftCode}`].patientId
                          "
                          context="detail"
                        />
                        <span>{{ getPatientName(`peripheral-${i}-${shiftCode}`) }}</span>
                        <span
                          v-if="
                            getPatientMode(`peripheral-${i}-${shiftCode}`) &&
                            getPatientMode(`peripheral-${i}-${shiftCode}`) !== 'HD'
                          "
                          class="stats-special-mode"
                        >
                          ({{ getPatientMode(`peripheral-${i}-${shiftCode}`) }})
                        </span>
                      </div>
                    </div>
                    <div class="patient-ward-note">
                      <span class="ward-number">{{
                        getPatientWardNumber(
                          currentRecord.schedule[`peripheral-${i}-${shiftCode}`]?.patientId,
                        )
                      }}</span>
                      <span class="patient-note">{{
                        getCombinedNote(`peripheral-${i}-${shiftCode}`)
                      }}</span>
                    </div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- (B) 排班操作模式 -->
      <div v-show="!isSimplifiedViewVisible" class="schedule-content desktop-only">
        <div class="dialysis-unit">
          <template
            v-for="(wing, wingName) in {
              left: layoutData.leftWingRows,
              right: layoutData.rightWingRows,
            }"
            :key="wingName"
          >
            <div :class="`${wingName}-wing`">
              <div v-for="(row, rowIndex) in wing" :key="`${wingName}-${rowIndex}`" class="bed-row">
                <div
                  v-for="bedNum in row"
                  :key="`bed-${wingName}-${bedNum}`"
                  class="bed"
                  :class="{
                    unassigned: bedNum === '空',
                    hepatitis: hepatitisBeds.includes(bedNum),
                    'aisle-side': aisleSideBeds.includes(bedNum),
                    [`${wingName}-wing-bed`]: true,
                  }"
                >
                  <div class="bed-header">
                    {{ bedNum === '空' ? '未排床' : `床號 ${bedNum}` }}
                    <span v-if="hepatitisBeds.includes(bedNum) && bedNum !== '空'">(BC肝炎)</span>
                  </div>
                  <template v-if="bedNum !== '空'">
                    <div
                      v-for="shiftCode in ORDERED_SHIFT_CODES"
                      :key="shiftCode"
                      class="shift-row"
                      :class="[
                        getPatientCellStyle(`bed-${bedNum}-${shiftCode}`),
                        { 'split-shift': shiftCode === SHIFT_CODES.NOON },
                      ]"
                    >
                      <div class="shift-label">{{ getShiftDisplayName(shiftCode) }}</div>
                      <div v-if="shiftCode === SHIFT_CODES.NOON" class="nurse-split-column">
                        <select
                          class="nurse-team-select nurse-in"
                          :value="getNurseTeam(`bed-${bedNum}-${shiftCode}`, 'in')"
                          @change="updateNurseTeam($event, `bed-${bedNum}-${shiftCode}`, 'in')"
                          :disabled="isPageLocked"
                        >
                          <option value="">上針</option>
                          <option v-for="team in earlyTeams" :key="team" :value="team">
                            {{ team }}組
                          </option>
                        </select>
                        <select
                          class="nurse-team-select nurse-out"
                          :value="getNurseTeam(`bed-${bedNum}-${shiftCode}`, 'out')"
                          @change="updateNurseTeam($event, `bed-${bedNum}-${shiftCode}`, 'out')"
                          :disabled="isPageLocked"
                        >
                          <option value="">收針</option>
                          <option v-for="team in allTeams" :key="team" :value="team">
                            {{ team }}組
                          </option>
                        </select>
                      </div>
                      <select
                        v-else
                        class="nurse-team-select"
                        :value="getNurseTeam(`bed-${bedNum}-${shiftCode}`, 'single')"
                        @change="updateNurseTeam($event, `bed-${bedNum}-${shiftCode}`, 'single')"
                        :disabled="isPageLocked"
                      >
                        <option value="">-</option>
                        <option
                          v-for="team in shiftCode === SHIFT_CODES.EARLY ? earlyTeams : lateTeams"
                          :key="team"
                          :value="team"
                        >
                          {{ team }}組
                        </option>
                      </select>
                      <div
                        class="patient-name"
                        :draggable="!isPageLocked && !!getPatientName(`bed-${bedNum}-${shiftCode}`)"
                        @click="handleSlotClick(`bed-${bedNum}-${shiftCode}`)"
                        @drop="!isPageLocked && onDrop($event, `bed-${bedNum}-${shiftCode}`)"
                        @dragover.prevent="!isPageLocked && onDragOver($event)"
                        @dragleave="onDragLeave"
                        @dragstart="
                          !isPageLocked && onBedDragStart($event, `bed-${bedNum}-${shiftCode}`)
                        "
                      >
                        <div
                          v-if="getPatientName(`bed-${bedNum}-${shiftCode}`)"
                          class="patient-cell-layout"
                        >
                          <div class="patient-name-text">
                            <span>{{ getPatientName(`bed-${bedNum}-${shiftCode}`) }}</span>
                            <span
                              v-if="
                                getPatientMode(`bed-${bedNum}-${shiftCode}`) &&
                                getPatientMode(`bed-${bedNum}-${shiftCode}`) !== 'HD'
                              "
                              class="stats-special-mode-inline"
                              >({{ getPatientMode(`bed-${bedNum}-${shiftCode}`) }})</span
                            >
                          </div>
                          <div class="patient-icons-row">
                            <span
                              v-if="
                                getPatientWardNumber(
                                  currentRecord.schedule[`bed-${bedNum}-${shiftCode}`]?.patientId,
                                )
                              "
                              class="ward-badge-inline"
                              @click.stop="promptWardNumber(`bed-${bedNum}-${shiftCode}`)"
                              :title="
                                '床號：' +
                                getPatientWardNumber(
                                  currentRecord.schedule[`bed-${bedNum}-${shiftCode}`]?.patientId,
                                ) +
                                '（點擊編輯）'
                              "
                              >{{
                                getPatientWardNumber(
                                  currentRecord.schedule[`bed-${bedNum}-${shiftCode}`]?.patientId,
                                )
                              }}</span
                            >
                            <button
                              v-else-if="isInpatientOrER(`bed-${bedNum}-${shiftCode}`)"
                              class="ward-icon-inline"
                              @click.stop="promptWardNumber(`bed-${bedNum}-${shiftCode}`)"
                              :disabled="isPageLocked"
                              title="設定床號"
                            >
                              🛏️
                            </button>
                            <PatientMessagesIcon
                              :patient-id="
                                currentRecord.schedule[`bed-${bedNum}-${shiftCode}`]?.patientId
                              "
                              context="quick-view"
                            />
                          </div>
                        </div>
                        <span v-else class="empty-slot-placeholder">+</span>
                      </div>
                      <div
                        class="patient-tag"
                        :contenteditable="!isPageLocked"
                        @blur="updateNote($event, `bed-${bedNum}-${shiftCode}`)"
                      >
                        {{ getCombinedNote(`bed-${bedNum}-${shiftCode}`) }}
                      </div>
                    </div>
                  </template>
                </div>
              </div>
              <div v-if="wingName === 'left'" class="bed-row">
                <div class="nursing-station">護理站</div>
              </div>
            </div>
            <div v-if="wingName === 'left'" class="aisle">中 央 走 道</div>
          </template>
        </div>
        <div class="extra-sections">
          <div class="peripheral-section">
            <div class="peripheral-bed-container">
              <div v-for="i in peripheralBedCount" :key="`p-bed-${i}`" class="peripheral-bed">
                <div class="peripheral-header">外圍床位 {{ i }}</div>
                <div
                  v-for="shiftCode in ORDERED_SHIFT_CODES"
                  :key="shiftCode"
                  class="peripheral-shift-row"
                  :class="[getPatientCellStyle(`peripheral-${i}-${shiftCode}`)]"
                >
                  <div class="shift-label">{{ getShiftDisplayName(shiftCode) }}</div>
                  <select
                    class="nurse-team-select"
                    :value="
                      getNurseTeam(
                        `peripheral-${i}-${shiftCode}`,
                        shiftCode === SHIFT_CODES.NOON ? 'in' : 'single',
                      )
                    "
                    @change="
                      updateNurseTeam(
                        $event,
                        `peripheral-${i}-${shiftCode}`,
                        shiftCode === SHIFT_CODES.NOON ? 'in' : 'single',
                      )
                    "
                    :disabled="isPageLocked"
                  >
                    <option value="">-</option>
                    <option
                      v-for="team in shiftCode === SHIFT_CODES.EARLY
                        ? earlyTeams
                        : shiftCode === SHIFT_CODES.LATE
                          ? lateTeams
                          : allTeams"
                      :key="team"
                      :value="team"
                    >
                      {{ team }}組
                    </option>
                  </select>
                  <div
                    class="peripheral-bed-number"
                    @click="
                      isInpatientOrER(`peripheral-${i}-${shiftCode}`) &&
                      promptWardNumber(`peripheral-${i}-${shiftCode}`)
                    "
                    :style="{
                      cursor:
                        isPageLocked || !isInpatientOrER(`peripheral-${i}-${shiftCode}`)
                          ? 'default'
                          : 'pointer',
                    }"
                  >
                    <span
                      v-if="
                        getPatientWardNumber(
                          currentRecord.schedule[`peripheral-${i}-${shiftCode}`]?.patientId,
                        )
                      "
                      class="ward-number-badge"
                      :title="
                        '床號：' +
                        getPatientWardNumber(
                          currentRecord.schedule[`peripheral-${i}-${shiftCode}`]?.patientId,
                        ) +
                        '（點擊編輯）'
                      "
                      >{{
                        getPatientWardNumber(
                          currentRecord.schedule[`peripheral-${i}-${shiftCode}`]?.patientId,
                        )
                      }}</span
                    >
                    <button
                      v-else-if="
                        getPatientName(`peripheral-${i}-${shiftCode}`) &&
                        isInpatientOrER(`peripheral-${i}-${shiftCode}`)
                      "
                      class="ward-edit-icon"
                      :disabled="isPageLocked"
                      title="設定床號"
                    >
                      🛏️
                    </button>
                    <span v-else>-</span>
                  </div>
                  <div
                    class="peripheral-patient-name"
                    :draggable="!isPageLocked && !!getPatientName(`peripheral-${i}-${shiftCode}`)"
                    @click="handleSlotClick(`peripheral-${i}-${shiftCode}`)"
                    @drop="!isPageLocked && onDrop($event, `peripheral-${i}-${shiftCode}`)"
                    @dragover.prevent="!isPageLocked && onDragOver($event)"
                    @dragleave="onDragLeave"
                    @dragstart="
                      !isPageLocked && onBedDragStart($event, `peripheral-${i}-${shiftCode}`)
                    "
                  >
                    <div
                      v-if="getPatientName(`peripheral-${i}-${shiftCode}`)"
                      class="patient-cell-layout"
                    >
                      <div class="patient-name-text">
                        <span>{{ getPatientName(`peripheral-${i}-${shiftCode}`) }}</span>
                        <span
                          v-if="
                            getPatientMode(`peripheral-${i}-${shiftCode}`) &&
                            getPatientMode(`peripheral-${i}-${shiftCode}`) !== 'HD'
                          "
                          class="stats-special-mode-inline"
                          >({{ getPatientMode(`peripheral-${i}-${shiftCode}`) }})</span
                        >
                      </div>
                      <div class="patient-icons-row">
                        <PatientMessagesIcon
                          :patient-id="
                            currentRecord.schedule[`peripheral-${i}-${shiftCode}`]?.patientId
                          "
                          context="quick-view"
                        />
                      </div>
                    </div>
                    <span v-else class="empty-slot-placeholder">+</span>
                  </div>
                  <div
                    class="patient-tag"
                    :contenteditable="!isPageLocked"
                    @blur="updateNote($event, `peripheral-${i}-${shiftCode}`)"
                  >
                    {{ getCombinedNote(`peripheral-${i}-${shiftCode}`) }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- (C) 行動版專用視圖 -->
      <div class="simplified-view mobile-and-print-only">
        <table class="simplified-table">
          <thead>
            <tr>
              <th class="col-bed">床號</th>
              <th v-for="shiftCode in ORDERED_SHIFT_CODES" :key="`mobile-header-${shiftCode}`">
                <div class="shift-header-content">
                  <span>{{ getShiftDisplayName(shiftCode) }}</span>
                  <button
                    @click="showShiftInjections(shiftCode)"
                    class="summary-icon-btn-table"
                    title="查看此班針劑"
                  >
                    💉
                  </button>
                  <button
                    @click="showShiftMedicationDrafts(shiftCode)"
                    class="summary-icon-btn-table"
                    title="查看此班藥囑草稿"
                  >
                    <i class="fas fa-file-prescription"></i>
                  </button>
                  <button
                    @click="showShiftRecordsSummary(shiftCode)"
                    class="summary-icon-btn-table"
                    title="查看此班紀錄"
                  >
                    📋
                  </button>
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="bedNum in sortedBedNumbers" :key="bedNum">
              <td class="col-bed">{{ bedNum }}</td>
              <td
                v-for="shiftCode in ORDERED_SHIFT_CODES"
                :key="shiftCode"
                :class="getPatientCellStyle(`bed-${bedNum}-${shiftCode}`)"
                @click="handleSimplifiedCellClick(`bed-${bedNum}-${shiftCode}`)"
              >
                <div
                  v-if="currentRecord.schedule[`bed-${bedNum}-${shiftCode}`]"
                  class="patient-info-cell"
                >
                  <div class="patient-mrn-name">
                    <span>{{
                      patientMap.get(currentRecord.schedule[`bed-${bedNum}-${shiftCode}`].patientId)
                        ?.medicalRecordNumber
                    }}</span>
                    <div class="patient-name-wrapper">
                      <PatientMessagesIcon
                        :patient-id="currentRecord.schedule[`bed-${bedNum}-${shiftCode}`].patientId"
                        context="detail"
                      />
                      <span>{{ getPatientName(`bed-${bedNum}-${shiftCode}`) }}</span>
                      <span
                        v-if="
                          getPatientMode(`bed-${bedNum}-${shiftCode}`) &&
                          getPatientMode(`bed-${bedNum}-${shiftCode}`) !== 'HD'
                        "
                        class="stats-special-mode"
                        >({{ getPatientMode(`bed-${bedNum}-${shiftCode}`) }})</span
                      >
                    </div>
                  </div>
                  <div class="patient-note">
                    <span
                      v-if="
                        getPatientWardNumber(
                          currentRecord.schedule[`bed-${bedNum}-${shiftCode}`]?.patientId,
                        )
                      "
                      class="ward-number-display"
                      >[{{
                        getPatientWardNumber(
                          currentRecord.schedule[`bed-${bedNum}-${shiftCode}`]?.patientId,
                        )
                      }}]</span
                    >
                    {{ getCombinedNote(`bed-${bedNum}-${shiftCode}`) }}
                  </div>
                </div>
              </td>
            </tr>
            <tr v-for="i in peripheralBedCount" :key="`p-${i}`">
              <td class="col-bed">外圍 {{ i }}</td>
              <td
                v-for="shiftCode in ORDERED_SHIFT_CODES"
                :key="shiftCode"
                :class="getPatientCellStyle(`peripheral-${i}-${shiftCode}`)"
                @click="handleSimplifiedCellClick(`peripheral-${i}-${shiftCode}`)"
              >
                <div
                  v-if="currentRecord.schedule[`peripheral-${i}-${shiftCode}`]"
                  class="patient-info-cell"
                >
                  <div class="patient-mrn-name">
                    <span>{{
                      patientMap.get(
                        currentRecord.schedule[`peripheral-${i}-${shiftCode}`].patientId,
                      )?.medicalRecordNumber
                    }}</span>
                    <div class="patient-name-wrapper">
                      <PatientMessagesIcon
                        :patient-id="
                          currentRecord.schedule[`peripheral-${i}-${shiftCode}`].patientId
                        "
                        context="detail"
                      />
                      <span>{{ getPatientName(`peripheral-${i}-${shiftCode}`) }}</span>
                      <span
                        v-if="
                          getPatientMode(`peripheral-${i}-${shiftCode}`) &&
                          getPatientMode(`peripheral-${i}-${shiftCode}`) !== 'HD'
                        "
                        class="stats-special-mode"
                        >({{ getPatientMode(`peripheral-${i}-${shiftCode}`) }})</span
                      >
                    </div>
                  </div>
                  <div class="patient-ward-note">
                    <span class="ward-number">{{
                      getPatientWardNumber(
                        currentRecord.schedule[`peripheral-${i}-${shiftCode}`]?.patientId,
                      )
                    }}</span>
                    <span class="patient-note">{{
                      getCombinedNote(`peripheral-${i}-${shiftCode}`)
                    }}</span>
                  </div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <InpatientSidebar
        :patients="allPatients"
        :scheduled-ids="scheduledPatientIds"
        @drag-start="onSidebarDragStart"
        class="desktop-only"
        :class="{ 'sidebar-locked': isPageLocked }"
        :use-daily-filter="true"
        :day-of-week="dayOfWeek"
      />
    </main>

    <!-- Modal 組件 -->
    <MemoDisplayDialog
      :is-visible="isMemoDialogVisible"
      :patient-id="patientIdForDialog"
      :patient-name="patientNameForDialog"
      @close="isMemoDialogVisible = false"
    />
    <ConditionRecordDisplayDialog
      :is-visible="isConditionRecordDialogVisible"
      :patient-id="patientIdForDialog"
      :patient-name="patientNameForDialog"
      :target-date="formatDate(currentDate)"
      @close="isConditionRecordDialogVisible = false"
    />
    <BedAssignmentDialog
      :is-visible="isAssignmentDialogVisible"
      :all-patients="allPatients"
      :bed-layout="allBedNumbers"
      :schedule-data="currentRecord.schedule"
      :shifts="ORDERED_SHIFT_CODES"
      :freq-map="freqToDays"
      assignment-mode="singleDay"
      :day-of-week="dayOfWeek"
      :predefined-patient-groups="patientGroupsForDialog"
      :is-page-locked="isPageLocked"
      @close="isAssignmentDialogVisible = false"
      @assign-bed="handleAssignBed"
    />
    <PatientSelectDialog
      :is-visible="isPatientSelectDialogVisible"
      title="選擇病人 (單次排班)"
      :patients="allPatients"
      :show-fill-options="false"
      :is-page-locked="isPageLocked"
      @confirm="handlePatientSelect"
      @cancel="isPatientSelectDialogVisible = false"
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
    <PatientDetailModal
      :is-visible="isDetailModalVisible"
      :patient="selectedPatientForDetail"
      :current-date="currentDate"
      :slot-list="sortedSlotsForModal"
      :current-index="currentPatientIndexForModal"
      @switch-patient="handleSwitchPatientInModal"
      @close="isDetailModalVisible = false"
      @record-updated="fetchRecentRecords"
    />
    <WardNumberDialog
      :is-visible="isWardDialogVisible"
      :current-value="currentWardNumber"
      @confirm="handleWardNumberConfirm"
      @cancel="isWardDialogVisible = false"
    />
    <InpatientRoundsDialog
      :is-visible="isInpatientRoundsDialogVisible"
      :patients-on-schedule="todayInpatients"
      :target-date="formatDate(currentDate)"
      @close="isInpatientRoundsDialogVisible = false"
      @save="handleInpatientTransportUpdate"
    />
    <DailyRecordsSummaryDialog
      :is-visible="isRecordsSummaryDialogVisible"
      :target-date="formatDate(currentDate)"
      :shift-code="shiftCodeForDialog"
      :patient-ids="patientIdsForDialog"
      :patient-info-map="patientInfoMapForDialog"
      @close="closeRecordsSummaryDialog"
    />
    <DailyInjectionListDialog
      :is-visible="isInjectionDialogVisible"
      :is-loading="isInjectionLoading"
      :injections="filteredDailyInjections"
      :target-date="injectionDialogDate"
      v-model:filter-active="filterSpecificInjections"
      :show-filter="true"
      @close="isInjectionDialogVisible = false"
    />
    <DailyDraftListDialog
      :is-visible="isDraftDialogVisible"
      :is-loading="isDraftLoading"
      :drafts="dailyDrafts"
      :patients-in-shift="patientsForDraftDialog"
      :target-date="draftDialogDate"
      @close="isDraftDialogVisible = false"
    />

    <IcuOrdersDialog
      :is-visible="isIcuOrdersDialogVisible"
      :target-date="formatDate(currentDate)"
      :schedule="currentRecord.schedule"
      :patient-map="patientMap"
      @close="isIcuOrdersDialogVisible = false"
      @open-order-modal="openOrderModalFromIcuDialog"
      @open-crrt-order-modal="openCRRTOrderModalFromIcuDialog"
      @save-and-print="handleSaveAndPrintIcuOrders"
      @change-date="changeDate"
    />

    <DialysisOrderModal
      :is-visible="isOrderModalVisible"
      :patient-data="editingPatientForOrder"
      @close="isOrderModalVisible = false"
      @save="handleSaveOrder"
    />

    <CRRTOrderModal
      :is-visible="isCRRTOrderModalVisible"
      :patient-data="editingPatientForCRRT"
      :order-history="crrtOrderHistory"
      @close="isCRRTOrderModalVisible = false"
      @save="handleSaveCRRTOrder"
    />
  </div>
</template>

<script setup>
import { ref, onMounted, computed, reactive, watch, nextTick, provide, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  fetchAllSchedules as optimizedFetchAllSchedules,
  saveSchedule as optimizedSaveSchedule,
  updateSchedule as optimizedUpdateSchedule,
  updatePatient as optimizedUpdatePatient,
  createDialysisOrderAndUpdatePatient,
} from '@/services/optimizedApiService.js'
import {
  ordersApi,
  authApi,
  systemApi,
  schedulesApi as localSchedulesApi,
} from '@/services/localApiClient'
import { useAuth } from '@/composables/useAuth'
import { useGlobalNotifier } from '@/composables/useGlobalNotifier.js'
import { useTeamAssigner } from '@/composables/useTeamAssigner.js'
import { fetchTeamsByDate, saveTeams, updateTeams } from '@/services/nurseAssignmentsService.js'
import { useNurseGroupSync } from '@/composables/useNurseGroupSync.js'
import * as XLSX from 'xlsx'
import { formatDateToYYYYMMDD } from '@/utils/dateUtils.js'

// Constants
import {
  SHIFT_CODES,
  ORDERED_SHIFT_CODES,
  getShiftDisplayName,
  earlyTeams,
  lateTeams,
  allTeams,
} from '@/constants/scheduleConstants.js'
import {
  createEmptySlotData,
  generateAutoNote,
  getUnifiedCellStyle,
} from '@/utils/scheduleUtils.js'

// Components
import InpatientSidebar from '@/components/InpatientSidebar.vue'
import StatsToolbar from '@/components/StatsToolbar.vue'
import AlertDialog from '@/components/AlertDialog.vue'
import BedAssignmentDialog from '@/components/BedAssignmentDialog.vue'
import PatientSelectDialog from '@/components/PatientSelectDialog.vue'
import PatientMessagesIcon from '@/components/PatientMessagesIcon.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import PatientDetailModal from '@/components/PatientDetailModal.vue'
import WardNumberDialog from '@/components/WardNumberDialog.vue'
import InpatientRoundsDialog from '@/components/InpatientRoundsDialog.vue'
import DailyRecordsSummaryDialog from '@/components/DailyRecordsSummaryDialog.vue'
import MemoDisplayDialog from '@/components/MemoDisplayDialog.vue'
import ConditionRecordDisplayDialog from '@/components/ConditionRecordDisplayDialog.vue'
import DailyInjectionListDialog from '@/components/DailyInjectionListDialog.vue'
import DailyStaffDisplay from '@/components/DailyStaffDisplay.vue'
import DailyDraftListDialog from '@/components/DailyDraftListDialog.vue'
import IcuOrdersDialog from '@/components/IcuOrdersDialog.vue'
import DialysisOrderModal from '@/components/DialysisOrderModal.vue'
import CRRTOrderModal from '@/components/CRRTOrderModal.vue'
import { useRealtimeNotifications } from '@/composables/useRealtimeNotifications.js'

// Pinia Stores
import { usePatientStore } from '@/stores/patientStore'
import { useTaskStore } from '@/stores/taskStore'
import { useArchiveStore } from '@/stores/archiveStore'
import { storeToRefs } from 'pinia'
import { useScheduleAnalysis } from '@/composables/useScheduleAnalysis.js'
import { useMedicationStore } from '@/stores/medicationStore'

// Store & Hook Instantiation
const patientStore = usePatientStore()
const taskStore = useTaskStore()
const archiveStore = useArchiveStore()
const medicationStore = useMedicationStore()
const { allPatients, patientMap } = storeToRefs(patientStore)
const auth = useAuth()
const { createGlobalNotification } = useGlobalNotifier()
const router = useRouter()
const { distributePatients } = useTeamAssigner()
const { autoFillNurseNames } = useNurseGroupSync()

// Helper Functions
function getSafeDate(timestamp) {
  if (!timestamp) return new Date(0)
  if (typeof timestamp.toDate === 'function') {
    return timestamp.toDate()
  }
  const date = new Date(timestamp)
  return isNaN(date.getTime()) ? new Date(0) : date
}

// Constants
const layoutData = {
  leftWingRows: [
    ['空', 32, 31],
    [33, 35, 36],
    [39, 38, 37],
    [51, 52, 53],
    [57, 56, 55],
    [58, 59, 61],
    [65, 63, 62],
  ],
  rightWingRows: [
    [29, 28, 27],
    [23, 25, 26],
    [22, 21, 19],
    [16, 17, 18],
    [15, 13, 12],
    [8, 9, 11],
    [7, 6, 5],
    [1, 2, 3],
  ],
}
const allBedNumbers = [
  ...layoutData.leftWingRows.flat(),
  ...layoutData.rightWingRows.flat(),
].filter((b) => b !== '空')
const hepatitisBeds = ['空', 31, 32, 33, 35, 36]
const aisleSideBeds = [1, 7, 8, 15, 16, 22, 23, 29, 31, 36, 37, 53, 55, 61, 62, 65]
const peripheralBedCount = 6
const freqToDays = {
  一三五: [1, 3, 5],
  二四六: [2, 4, 6],
  一四: [1, 4],
  二五: [2, 5],
  三六: [3, 6],
  一五: [1, 5],
  二六: [2, 6],
  每周一次: [0, 1, 2, 3, 4, 5, 6],
  臨時: [],
}
const baseTeams = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']

// Reactive State
const currentDate = ref(new Date())
const recentConditionRecords = ref([])
const hasUnsavedChanges = ref(false)
const statusIndicator = ref('')
const currentRecord = reactive({ id: null, date: '', schedule: {}, names: {} })
const currentTeamsRecord = ref({ id: null, date: '', teams: {} })
const hasUnsavedTeamChanges = ref(false)
const isLoading = ref(true)
const isAlertDialogVisible = ref(false)
const alertDialogTitle = ref('')
const alertDialogMessage = ref('')
const isAssignmentDialogVisible = ref(false)
const isPatientSelectDialogVisible = ref(false)
const isConfirmDialogVisible = ref(false)
const confirmDialogMessage = ref('')
const isSimplifiedViewVisible = ref(false)
const isMemoDialogVisible = ref(false)
const isConditionRecordDialogVisible = ref(false)
const isDetailModalVisible = ref(false)
const isWardDialogVisible = ref(false)
const isInpatientRoundsDialogVisible = ref(false)
const isRecordsSummaryDialogVisible = ref(false)
const onConfirmAction = ref(null)
const currentSlotId = ref(null)
const selectedPatientForDetail = ref(null)
const shiftForDetailModal = ref(null)
const patientIdForDialog = ref(null)
const patientNameForDialog = ref('')
const currentWardNumber = ref('')
const currentEditingShiftId = ref(null)
const shiftCodeForDialog = ref(null)
const patientIdsForDialog = ref([])
const patientInfoMapForDialog = ref({}) // { patientId: { bedNum, medicalRecordNumber } }
const isInjectionDialogVisible = ref(false)
const isInjectionLoading = ref(false)
const allDailyInjections = ref([])
const injectionDialogDate = ref('')
const filterSpecificInjections = ref(false)
const isDraftDialogVisible = ref(false)
const isDraftLoading = ref(false)
const dailyDrafts = ref([])
const draftDialogDate = ref('')
const patientsForDraftDialog = ref([])
const isIcuOrdersDialogVisible = ref(false)
const sortedSlotsForModal = ref([])
const currentPatientIndexForModal = ref(0)
const isOrderModalVisible = ref(false)
const editingPatientForOrder = ref(null)
const isCRRTOrderModalVisible = ref(false)
const editingPatientForCRRT = ref(null)
const crrtOrderHistory = ref([])
// ✨ 【錯誤修正】宣告缺少的 ref ✨
const noonTakeoffVisibility = ref({ early: false, late: false })

const dailyPhysicians = ref({ early: null, noon: null, late: null })
const dailyConsultPhysicians = ref({ morning: null, afternoon: null, night: null })

provide('viewingDate', currentDate)

// Computed Properties
const isPageLocked = computed(() => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const currentDay = new Date(currentDate.value)
  currentDay.setHours(0, 0, 0, 0)
  return currentDay < today
})

const props = defineProps({
  patients: Array,
})

const { addLocalNotification } = useRealtimeNotifications()

const sortedBedNumbers = computed(() => {
  const numericBeds = allBedNumbers.filter((b) => typeof b === 'number')
  return [...numericBeds].sort((a, b) => a - b)
})

const currentDateDisplay = computed(() => formatDate(currentDate.value))
const weekdayDisplay = computed(
  () => ['日', '一', '二', '三', '四', '五', '六'][currentDate.value.getDay()],
)
const dayOfWeek = computed(() => {
  const day = currentDate.value.getDay()
  return day === 0 ? 7 : day
})
const { scheduledPatientIds, getDailyUnassignedPatients, getDailyTemporaryPatients } =
  useScheduleAnalysis(
    allPatients,
    computed(() => currentRecord.schedule),
    freqToDays,
  )
const patientGroupsForDialog = computed(() => {
  const groups = {
    '今日應排 - 急診': [],
    '今日應排 - 住院': [],
    '今日應排 - 門診': [],
    '今日非排 (臨洗) - 急診': [],
    '今日非排 (臨洗) - 住院': [],
    '今日非排 (臨洗) - 門診': [],
  }
  getDailyUnassignedPatients(dayOfWeek).value.forEach((p) => {
    if (p.status === 'er') groups['今日應排 - 急診'].push(p)
    else if (p.status === 'ipd') groups['今日應排 - 住院'].push(p)
    else if (p.status === 'opd') groups['今日應排 - 門診'].push(p)
  })
  getDailyTemporaryPatients(dayOfWeek).value.forEach((p) => {
    if (p.status === 'er') groups['今日非排 (臨洗) - 急診'].push(p)
    else if (p.status === 'ipd') groups['今日非排 (臨洗) - 住院'].push(p)
    else if (p.status === 'opd') groups['今日非排 (臨洗) - 門診'].push(p)
  })
  return groups
})
const statsToolbarData = computed(() => {
  const counts = {}
  ORDERED_SHIFT_CODES.forEach((shiftCode) => {
    counts[shiftCode] = { total: 0, opd: 0, ipd: 0, er: 0 }
  })
  const dailyData = { counts: counts, total: 0 }
  if (currentRecord.schedule) {
    for (const [shiftKey, slotData] of Object.entries(currentRecord.schedule)) {
      if (slotData && slotData.patientId) {
        const patient = patientMap.value.get(slotData.patientId)
        if (!patient) continue
        const shiftCode = shiftKey.split('-').pop()
        if (shiftCode && dailyData.counts[shiftCode]) {
          const shiftStats = dailyData.counts[shiftCode]
          shiftStats.total++
          dailyData.total++
          if (patient.status === 'opd') shiftStats.opd++
          else if (patient.status === 'ipd') shiftStats.ipd++
          else if (patient.status === 'er') shiftStats.er++
        }
      }
    }
  }
  return [dailyData]
})
const statsToolbarWeekdays = computed(() => ['本日'])
const todayInpatients = computed(() => {
  const inpatientsMap = new Map()
  if (currentRecord && currentRecord.schedule) {
    for (const shiftId in currentRecord.schedule) {
      const slot = currentRecord.schedule[shiftId]
      if (slot && slot.patientId && !shiftId.startsWith('peripheral')) {
        const patientInfo = getArchivedOrLivePatientInfo(slot)
        const patientDetails = patientMap.value.get(slot.patientId)
        if (
          patientInfo &&
          patientDetails &&
          (patientInfo.status === 'ipd' || patientInfo.status === 'er')
        ) {
          const shiftCode = shiftId.split('-')[2]
          const dialysisBed = String(shiftId.split('-')[1] || 'N/A')
          if (!inpatientsMap.has(patientDetails.id)) {
            inpatientsMap.set(patientDetails.id, {
              id: `${patientDetails.id}-${shiftId}`,
              shiftId: shiftId,
              dialysisBed,
              medicalRecordNumber: patientDetails.medicalRecordNumber,
              name: patientDetails.name,
              wardNumber: patientInfo.wardNumber || '未登錄',
              shift: shiftCode,
              transportMethod: slot.transportMethod,
            })
          }
        }
      }
    }
  }
  const unassignedInpatients = getDailyUnassignedPatients(dayOfWeek).value.filter(
    (p) => p.status === 'ipd' || p.status === 'er',
  )
  unassignedInpatients.forEach((patient) => {
    if (!inpatientsMap.has(patient.id)) {
      inpatientsMap.set(patient.id, {
        id: `${patient.id}-unassigned`,
        shiftId: null,
        dialysisBed: '未排床',
        medicalRecordNumber: patient.medicalRecordNumber,
        name: patient.name,
        wardNumber: patient.wardNumber || '未登錄',
        shift: 'unknown',
        transportMethod: null,
      })
    }
  })
  const inpatients = Array.from(inpatientsMap.values())
  inpatients.sort((a, b) => {
    const shiftOrder = { early: 1, noon: 2, late: 3, unknown: 4 }
    if (a.shift !== b.shift) return shiftOrder[a.shift] - shiftOrder[b.shift]
    const bedA = a.dialysisBed === '未排床' ? 1000 : parseInt(a.dialysisBed)
    const bedB = b.dialysisBed === '未排床' ? 1000 : parseInt(b.dialysisBed)
    return bedA - bedB
  })
  return inpatients
})
const filteredDailyInjections = computed(() => {
  if (!filterSpecificInjections.value) return allDailyInjections.value
  const specificMedCodes = ['ICAC', 'IFER2', 'IPAR1']
  return allDailyInjections.value.filter((injection) =>
    specificMedCodes.includes(injection.orderCode),
  )
})
const sortedScheduleSlots = computed(() => {
  if (!currentRecord.schedule) return []
  const getSortKey = (shiftId) => {
    const parts = shiftId.split('-')
    const shiftOrder = { early: 1, noon: 2, late: 3 }
    const shift = shiftOrder[parts[2]] || 99
    const isPeripheral = parts[0] === 'peripheral'
    const bedNum = parseInt(parts[1], 10)
    return shift * 10000 + (isPeripheral ? 1000 : 0) + bedNum
  }
  return Object.entries(currentRecord.schedule)
    .filter(([, slot]) => slot?.patientId)
    .map(([shiftId, slot]) => ({
      shiftId,
      patientId: slot.patientId,
      patient: patientMap.value.get(slot.patientId),
      sortKey: getSortKey(shiftId),
    }))
    .filter((item) => item.patient)
    .sort((a, b) => a.sortKey - b.sortKey)
})

// Methods
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
    await patientStore.forceRefreshPatients()
    await loadDataForDay(currentDate.value)
    isOrderModalVisible.value = false
    showAlert('儲存成功', `已成功更新 ${patientName} 的透析醫囑。`)
  } catch (error) {
    console.error('儲存醫囑失敗:', error)
    showAlert('操作失敗', `儲存醫囑時發生錯誤: ${error.message}`)
  }
}

async function handleSaveIcuNote({ patientId, note }) {
  if (!patientId) {
    console.error('[ScheduleView] Save note failed: Invalid patientId')
    return
  }

  try {
    const patientName = patientMap.value.get(patientId)?.name || '該病人'

    const updatePayload = {
      'dialysisOrders.icuNote': note || '',
    }

    await optimizedUpdatePatient(patientId, updatePayload)
    await patientStore.forceRefreshPatients()

    createGlobalNotification(`${patientName} 的備註已儲存`, 'success')
  } catch (error) {
    console.error('儲存 ICU 備註失敗:', error)
    showAlert('儲存失敗', `儲存備註時發生錯誤: ${error.message}`)
  }
}

function openOrderModalFromIcuDialog(patient) {
  if (patient && patient.id) {
    editingPatientForOrder.value = JSON.parse(JSON.stringify(patient))
    isOrderModalVisible.value = true
  }
}

function openCRRTOrderModalFromIcuDialog(patient) {
  if (patient && patient.id) {
    editingPatientForCRRT.value = JSON.parse(JSON.stringify(patient))
    isCRRTOrderModalVisible.value = true
  }
}

async function handleSaveCRRTOrder(orderData) {
  if (!editingPatientForCRRT.value?.id) {
    showAlert('儲存失敗', '找不到有效的病人資訊。')
    return
  }
  const patientId = editingPatientForCRRT.value.id
  const patientName = editingPatientForCRRT.value.name

  try {
    const updatePayload = {
      crrtOrders: orderData,
    }
    await optimizedUpdatePatient(patientId, updatePayload)
    await patientStore.forceRefreshPatients()
    isCRRTOrderModalVisible.value = false
    showAlert('儲存成功', `已成功更新 ${patientName} 的 CRRT 醫囑。`)
  } catch (error) {
    console.error('儲存 CRRT 醫囑失敗:', error)
    showAlert('操作失敗', `儲存 CRRT 醫囑時發生錯誤: ${error.message}`)
  }
}

async function showShiftInjections(shiftCode) {
  if (!shiftCode) return

  const patientIds = Object.entries(currentRecord.schedule)
    .filter(([shiftId, slot]) => slot?.patientId && shiftId.endsWith(`-${shiftCode}`))
    .map(([, slot]) => slot.patientId)

  // --- 📍 日誌點 C (ScheduleView): 檢查要查詢的病人 ---
  console.log(
    `[ScheduleView] 準備查詢針劑，班別: ${shiftCode}, 病人數: ${patientIds.length}`,
    patientIds,
  )

  injectionDialogDate.value = formatDate(currentDate.value)
  isInjectionDialogVisible.value = true
  isInjectionLoading.value = true
  allDailyInjections.value = []
  filterSpecificInjections.value = false

  try {
    const injectionsForShift = await medicationStore.fetchDailyInjections(
      injectionDialogDate.value,
      patientIds,
    )

    // --- 📍 日誌點 D (ScheduleView): 檢查從 Store 返回的結果 ---
    console.log(
      `[ScheduleView] 從 Store 收到 ${injectionsForShift.length} 筆針劑資料。`,
      injectionsForShift,
    )

    allDailyInjections.value = injectionsForShift
  } catch (error) {
    console.error('[ScheduleView] 獲取應打針劑失敗:', error)
    showAlert('查詢失敗', `獲取應打針劑清單時發生錯誤: ${error.message}`)
    isInjectionDialogVisible.value = false
  } finally {
    isInjectionLoading.value = medicationStore.isLoading
  }
}

function openDetailModalForPatient(patientId) {
  const patientList = sortedScheduleSlots.value
  const targetIndex = patientList.findIndex((p) => p.patientId === patientId)
  if (targetIndex === -1) {
    console.error('在排班清單中找不到此病人:', patientId)
    selectedPatientForDetail.value = patientMap.value.get(patientId)
    sortedSlotsForModal.value = []
    currentPatientIndexForModal.value = 0
  } else {
    sortedSlotsForModal.value = patientList
    currentPatientIndexForModal.value = targetIndex
    selectedPatientForDetail.value = patientList[targetIndex].patient
  }
  isDetailModalVisible.value = true
}
function formatDate(date) {
  if (!date) return ''
  return formatDateToYYYYMMDD(date)
}
provide('handleIconClick', (patientId, context, type) => {
  const patient = patientMap.value.get(patientId)
  if (!patient) return
  if (context === 'quick-view') {
    patientIdForDialog.value = patient.id
    patientNameForDialog.value = patient.name
    // 根據類型決定打開哪個 dialog
    if (type === 'record') {
      isConditionRecordDialogVisible.value = true
    } else {
      isMemoDialogVisible.value = true
    }
  } else {
    openDetailModalForPatient(patientId)
  }
})
function handleSwitchPatientInModal(newIndex) {
  if (newIndex >= 0 && newIndex < sortedSlotsForModal.value.length) {
    currentPatientIndexForModal.value = newIndex
    selectedPatientForDetail.value = sortedSlotsForModal.value[newIndex].patient
  }
}
async function fetchArchivedSchedule(dateStr) {
  return await archiveStore.fetchScheduleByDate(dateStr)
}
async function fetchLiveSchedule(dateStr) {
  const record = await localSchedulesApi.fetchByDate(dateStr)
  if (!record || !record.schedule || Object.keys(record.schedule).length === 0) {
    return { date: dateStr, schedule: {} }
  }
  const finalSchedule = {}
  if (record.schedule) {
    for (const shiftId in record.schedule) {
      const dbSlotData = record.schedule[shiftId]
      if (dbSlotData?.patientId && patientMap.value.has(dbSlotData.patientId)) {
        const patient = patientMap.value.get(dbSlotData.patientId)
        const mergedSlot = { ...createEmptySlotData(shiftId), ...dbSlotData }
        if (patient) mergedSlot.autoNote = generateAutoNote(patient)
        finalSchedule[shiftId] = mergedSlot
      }
    }
  }
  record.schedule = finalSchedule
  return record
}
async function loadDataForDay(date) {
  hasUnsavedChanges.value = false
  hasUnsavedTeamChanges.value = false
  statusIndicator.value = '讀取中...'
  isLoading.value = true
  const dateStr = formatDate(date)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const targetDate = new Date(date)
  targetDate.setHours(0, 0, 0, 0)
  try {
    const isPastDate = targetDate < today

    // 優化：使用 Promise.all 並行發送獨立的 API 請求
    let scheduleRecord, teamsData

    if (isPastDate) {
      // 過去日期：所有請求可以完全並行
      const [archived, teams] = await Promise.all([
        fetchArchivedSchedule(dateStr),
        fetchTeamsByDate(dateStr),
        fetchRecentRecords(), // 不需要結果，但需要執行
      ])
      scheduleRecord = archived
      teamsData = teams
    } else {
      // 當日或未來：先獲取病人資料，其餘請求並行
      await patientStore.fetchPatientsIfNeeded()
      const [live, teams] = await Promise.all([
        fetchLiveSchedule(dateStr),
        fetchTeamsByDate(dateStr),
        fetchRecentRecords(), // 不需要結果，但需要執行
      ])
      scheduleRecord = live
      teamsData = teams
    }

    Object.assign(currentRecord, {
      id: scheduleRecord.id || null,
      date: dateStr,
      schedule: scheduleRecord.schedule || {},
      names: scheduleRecord.names || {},
    })
    currentTeamsRecord.value = teamsData || { id: null, date: dateStr, teams: {} }
    statusIndicator.value = scheduleRecord.id ? '資料已載入' : '本日無排程資料'
  } catch (error) {
    console.error(`載入 ${dateStr} 資料失敗:`, error)
    statusIndicator.value = '讀取失敗'
  } finally {
    isLoading.value = false
  }
}
function getArchivedOrLivePatientInfo(slotData) {
  if (!slotData || !slotData.patientId) return null
  if (slotData.archivedPatientInfo) return slotData.archivedPatientInfo
  return patientMap.value.get(slotData.patientId) || null
}
async function saveDataToCloud() {
  if (isPageLocked.value) {
    showAlert('操作失敗', '操作被鎖定：權限不足或日期已過。')
    return
  }
  statusIndicator.value = '儲存中...'
  try {
    const promises = []
    if (hasUnsavedChanges.value) {
      const dataToSave = {
        date: currentRecord.date,
        schedule: currentRecord.schedule || {},
        names: currentRecord.names || {},
      }
      if (currentRecord.id) {
        promises.push(optimizedUpdateSchedule(currentRecord.id, dataToSave))
      } else if (Object.keys(dataToSave.schedule).length > 0) {
        promises.push(
          optimizedSaveSchedule(dataToSave).then((savedRecord) => {
            currentRecord.id = savedRecord.id
          }),
        )
      }
    }
    if (hasUnsavedTeamChanges.value && Object.keys(currentTeamsRecord.value.teams).length > 0) {
      const teamsToSave = {
        date: currentTeamsRecord.value.date,
        teams: currentTeamsRecord.value.teams,
        names: currentTeamsRecord.value.names,
      }
      if (currentTeamsRecord.value.id) {
        promises.push(updateTeams(currentTeamsRecord.value.id, teamsToSave))
      } else {
        promises.push(
          saveTeams(teamsToSave).then((savedRecord) => {
            currentTeamsRecord.value.id = savedRecord.id
          }),
        )
      }
    }
    await Promise.all(promises)
    hasUnsavedChanges.value = false
    hasUnsavedTeamChanges.value = false
    statusIndicator.value = '儲存成功！'
    showAlert('操作成功', '排程已成功儲存！')
  } catch (error) {
    console.error('儲存失敗:', error)
    statusIndicator.value = '儲存失敗'
    showAlert('操作失敗', `儲存失敗: ${error.message}`)
  }
}
async function loadDailyStaffInfo(date) {
  try {
    const dateStr = formatDate(date).substring(0, 7)
    const [monthScheduleDoc, allUsers] = await Promise.all([
      systemApi.fetchPhysicianSchedule(dateStr),
      authApi.getUsers(),
    ])
    // 過濾出醫師和專科護理師
    const physicians = allUsers.filter((u) => u.title === '主治醫師' || u.title === '專科護理師')
    const userMap = new Map(physicians.map((u) => [u.id, u]))
    const dialysisPhysiciansData = { early: null, noon: null, late: null }
    const consultPhysiciansData = { morning: null, afternoon: null, night: null }
    if (monthScheduleDoc?.scheduleData) {
      const dayOfMonth = date.getDate()
      // 查房班表在 scheduleData.schedule 內
      const daySchedule = monthScheduleDoc.scheduleData?.schedule?.[dayOfMonth]
      if (daySchedule) {
        dialysisPhysiciansData.early = userMap.get(daySchedule.early?.physicianId) || null
        dialysisPhysiciansData.noon = userMap.get(daySchedule.noon?.physicianId) || null
        dialysisPhysiciansData.late = userMap.get(daySchedule.late?.physicianId) || null
      }
      // 會診班表在 scheduleData.consultationSchedule 內
      const consultationDaySchedule =
        monthScheduleDoc.scheduleData?.consultationSchedule?.[dayOfMonth]
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
async function showShiftMedicationDrafts(shiftCode) {
  // 🖥️ 單機版本：此功能需要連接醫療資訊系統，離線模式不支援
  showAlert('功能提示', '藥囑草稿查詢功能需要連接醫療資訊系統，單機離線版本暫不支援此功能。')
}
function updateTaskStoreWithRecords() {
  const recentRecordsPatientIds = new Set()
  if (recentConditionRecords.value && recentConditionRecords.value.length > 0) {
    const viewingDate = new Date(currentDate.value)
    viewingDate.setHours(0, 0, 0, 0)
    const viewingDateTime = viewingDate.getTime()
    recentConditionRecords.value.forEach((record) => {
      if (record.recordDate) {
        const recordDate = new Date(
          record.recordDate.toDate ? record.recordDate.toDate() : record.recordDate,
        )
        recordDate.setHours(0, 0, 0, 0)
        if (recordDate.getTime() === viewingDateTime) {
          recentRecordsPatientIds.add(record.patientId)
        }
      }
    })
  }
  taskStore.updateTasksFromConditionRecords(recentRecordsPatientIds)
}
async function fetchRecentRecords() {
  try {
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const startDate = sevenDaysAgo.toISOString()
    const records = await ordersApi.fetchConditionRecords({ startDate })
    recentConditionRecords.value = records || []
    updateTaskStoreWithRecords()
    return records
  } catch (error) {
    console.error('獲取近期病情紀錄失敗:', error)
    return []
  }
}
function getPatientCellStyle(shiftId) {
  const slotData = currentRecord.schedule[shiftId]
  const patientForStyle = getArchivedOrLivePatientInfo(slotData)
  if (!patientForStyle) return {}
  const patientId = slotData?.patientId
  if (!patientId) return getUnifiedCellStyle(slotData, patientForStyle, null, [])
  const messageTypesForPatient =
    taskStore.getPatientMessageTypesMapForDate(currentDate.value).get(patientId) || []
  return getUnifiedCellStyle(slotData, patientForStyle, null, messageTypesForPatient)
}
function getPatientWardNumber(patientId) {
  if (!patientId) return ''
  const patient = patientMap.value.get(patientId)
  return patient?.wardNumber || ''
}
function isInpatientOrER(shiftId) {
  const slotData = currentRecord.schedule[shiftId]
  const patientInfo = getArchivedOrLivePatientInfo(slotData)
  return patientInfo?.status === 'ipd' || patientInfo?.status === 'er'
}
function promptWardNumber(shiftId) {
  if (isPageLocked.value) return
  const slot = currentRecord.schedule[shiftId]
  if (!slot?.patientId) return
  const patient = patientMap.value.get(slot.patientId)
  const patientInfo = getArchivedOrLivePatientInfo(slot)
  if (!patient || !patientInfo || (patientInfo.status !== 'ipd' && patientInfo.status !== 'er')) {
    showAlert('提示', '只有住院或急診病人才能設定床號')
    return
  }
  currentEditingShiftId.value = shiftId
  currentWardNumber.value = patient.wardNumber || ''
  isWardDialogVisible.value = true
}
async function handleWardNumberConfirm(value) {
  if (!currentEditingShiftId.value) return
  const slot = currentRecord.schedule[currentEditingShiftId.value]
  if (!slot?.patientId) return
  try {
    await optimizedUpdatePatient(slot.patientId, { wardNumber: value })
    await patientStore.forceRefreshPatients()
    showAlert('操作成功', '床號已更新')
  } catch (error) {
    console.error('更新床號失敗:', error)
    showAlert('操作失敗', '更新床號失敗')
  }
  isWardDialogVisible.value = false
  currentEditingShiftId.value = null
  currentWardNumber.value = ''
}
function getNurseTeam(shiftId, type) {
  const slot = currentRecord.schedule[shiftId]
  if (!slot?.patientId) return ''
  const shiftCode = shiftId.split('-').pop()
  const key = `${slot.patientId}-${shiftCode}`
  const teamData = currentTeamsRecord.value.teams[key]
  if (!teamData) return ''
  if (type === 'single') return teamData.nurseTeam || ''
  else if (type === 'in') return teamData.nurseTeamIn || ''
  else if (type === 'out') return teamData.nurseTeamOut || ''
  return ''
}
function changeDate(days) {
  const performChange = () => {
    const newDate = new Date(currentDate.value)
    newDate.setDate(newDate.getDate() + days)
    currentDate.value = newDate
  }
  if ((hasUnsavedChanges.value || hasUnsavedTeamChanges.value) && !isPageLocked.value) {
    showConfirm('注意', '您有未儲存的變更，確定要切換日期嗎？', performChange)
  } else {
    performChange()
  }
}
function goToToday() {
  const performChange = () => (currentDate.value = new Date())
  if ((hasUnsavedChanges.value || hasUnsavedTeamChanges.value) && !isPageLocked.value) {
    showConfirm('注意', '您有未儲存的變更，確定要切換到今天嗎？', performChange)
  } else {
    performChange()
  }
}
function handleSlotClick(shiftId) {
  const slotData = currentRecord.schedule[shiftId]
  if (isPageLocked.value) return
  if (!slotData?.patientId) {
    currentSlotId.value = shiftId
    isPatientSelectDialogVisible.value = true
    return
  }
  const patient = patientMap.value.get(slotData.patientId)
  showConfirm(`確認移除`, `確定要將「${patient?.name}」從此班次中移除嗎？`, () => {
    handleSlotUpdate(shiftId, null)
  })
}

function handleSimplifiedCellClick(shiftId) {
  const patientId = currentRecord.schedule[shiftId]?.patientId
  if (patientId) {
    openDetailModalForPatient(patientId)
  }
}

function onDrop(event, targetShiftId) {
  if (isPageLocked.value) return
  event.preventDefault()
  document.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'))
  event.target.closest('.patient-name, .peripheral-patient-name')?.classList.remove('drag-over')
  const sourceShiftId = event.dataTransfer.getData('sourceShiftId')
  const droppedSlotData = JSON.parse(event.dataTransfer.getData('application/json'))
  if (!droppedSlotData || !droppedSlotData.patientId) return
  const patient = patientMap.value.get(droppedSlotData.patientId)
  if (!patient) return
  const targetSlotData = currentRecord.schedule[targetShiftId]
  if (sourceShiftId === 'sidebar' && scheduledPatientIds.value.has(patient.id)) {
    showConfirm('重複排班警告', `病人 ${patient.name} 在本日已有排班，您確定要重複排班嗎？`, () => {
      if (targetSlotData?.patientId) {
        showAlert('操作失敗', '目標床位已被佔用，無法放置！')
        return
      }
      handleSlotUpdate(targetShiftId, droppedSlotData.patientId, droppedSlotData)
    })
    return
  }
  if (targetSlotData && targetSlotData.patientId) {
    if (sourceShiftId === 'sidebar') {
      showAlert('操作失敗', '目標床位已被佔用，無法從側邊欄拖曳至此。')
      return
    }
    handleSlotUpdate(targetShiftId, droppedSlotData.patientId, droppedSlotData)
    handleSlotUpdate(sourceShiftId, targetSlotData.patientId, targetSlotData)
  } else {
    handleSlotUpdate(targetShiftId, droppedSlotData.patientId, droppedSlotData)
    if (sourceShiftId && sourceShiftId !== 'sidebar') {
      handleSlotUpdate(sourceShiftId, null)
    }
  }
}
function onBedDragStart(event, sourceShiftId) {
  if (isPageLocked.value) {
    event.preventDefault()
    return
  }
  const slotData = currentRecord.schedule[sourceShiftId]
  if (!slotData || !slotData.patientId) {
    event.preventDefault()
    return
  }
  event.dataTransfer.setData('sourceShiftId', sourceShiftId)
  event.dataTransfer.setData('application/json', JSON.stringify(slotData))
  event.dataTransfer.effectAllowed = 'move'
}
function onSidebarDragStart(event, patient) {
  if (isPageLocked.value) {
    event.preventDefault()
    return
  }
  const slotData = {
    patientId: patient.id,
    autoNote: generateAutoNote(patient),
    manualNote: patient.status === 'ipd' ? '住' : '',
  }
  event.dataTransfer.setData('sourceShiftId', 'sidebar')
  event.dataTransfer.setData('application/json', JSON.stringify(slotData))
  event.dataTransfer.effectAllowed = 'move'
}
function onDragOver(event) {
  if (isPageLocked.value) return
  event.preventDefault()
  const targetCell = event.target.closest('.patient-name, .peripheral-patient-name')
  if (targetCell) targetCell.classList.add('drag-over')
}
function onDragLeave(event) {
  event.target.closest('.patient-name, .peripheral-patient-name')?.classList.remove('drag-over')
}
function handleSlotUpdate(shiftId, patientId, fullSlotData = null) {
  if (isPageLocked.value) return
  if (patientId) {
    const patient = patientMap.value.get(patientId)
    if (!patient) return
    const correctShiftCode = shiftId.split('-').pop()
    let newSlotData
    if (fullSlotData) {
      newSlotData = { ...fullSlotData, patientId: patientId }
    } else {
      newSlotData = { patientId: patientId, manualNote: patient.status === 'ipd' ? '住' : '' }
    }
    newSlotData.autoNote = generateAutoNote(patient)
    newSlotData.shiftId = correctShiftCode
    currentRecord.schedule[shiftId] = newSlotData
  } else {
    delete currentRecord.schedule[shiftId]
  }
  setChange()
}
async function handleInpatientTransportUpdate(updatedPatients) {
  if (isPageLocked.value || !updatedPatients || updatedPatients.length === 0) {
    return
  }
  let changesMade = false
  updatedPatients.forEach((patient) => {
    const originalShiftId = patient.shiftId
    if (originalShiftId && currentRecord.schedule[originalShiftId]) {
      const existingMethod = currentRecord.schedule[originalShiftId].transportMethod || '推床'
      if (existingMethod !== patient.transportMethod) {
        currentRecord.schedule[originalShiftId].transportMethod = patient.transportMethod
        changesMade = true
      }
    }
  })
  if (changesMade) {
    statusIndicator.value = '儲存中...'
    const dataToSave = {
      date: currentRecord.date,
      schedule: currentRecord.schedule,
      names: currentRecord.names || {},
    }
    try {
      if (currentRecord.id) {
        await optimizedUpdateSchedule(currentRecord.id, dataToSave)
      } else if (Object.keys(dataToSave.schedule).length > 0) {
        const savedRecord = await optimizedSaveSchedule(dataToSave)
        currentRecord.id = savedRecord.id
      }
      statusIndicator.value = '儲存成功！'
      hasUnsavedChanges.value = false
    } catch (error) {
      console.error('儲存住院病人運送方式失敗:', error)
      statusIndicator.value = '儲存失敗'
      showAlert('儲存失敗', `儲存病人運送方式時發生錯誤: ${error.message}`)
      throw error
    }
  }
}
function handlePatientSelect({ patientId }) {
  if (!patientId || !currentSlotId.value) return
  isPatientSelectDialogVisible.value = false
  if (scheduledPatientIds.value.has(patientId)) {
    const patient = patientMap.value.get(patientId)
    showAlert('重複排班警告', `病人 ${patient.name} 在本日已有排班，無法重複排入。`)
    currentSlotId.value = null
    return
  }
  handleSlotUpdate(currentSlotId.value, patientId)
  currentSlotId.value = null
}
function handleAssignBed({ patientId, shiftId }) {
  if (!patientId || !shiftId || isPageLocked.value) return
  if (scheduledPatientIds.value.has(patientId)) {
    const patient = patientMap.value.get(patientId)
    showConfirm('重複排班警告', `病人 ${patient.name} 在本日已有排班，您確定要重複排班嗎？`, () => {
      if (currentRecord.schedule[shiftId]?.patientId) {
        showAlert('錯誤', '目標床位已被佔用！')
        return
      }
      handleSlotUpdate(shiftId, patientId)
    })
    return
  }
  handleSlotUpdate(shiftId, patientId)
}
function updateNurseTeam(event, shiftId, type) {
  if (isPageLocked.value) {
    event.target.value = getNurseTeam(shiftId, type)
    return
  }
  const slot = currentRecord.schedule[shiftId]
  if (!slot?.patientId) {
    event.target.value = ''
    return
  }
  const value = event.target.value
  const shiftCode = shiftId.split('-').pop()
  const key = `${slot.patientId}-${shiftCode}`
  if (!currentTeamsRecord.value.teams[key]) {
    currentTeamsRecord.value.teams[key] = {}
  }
  const teamData = currentTeamsRecord.value.teams[key]
  const isPeripheralNoon = shiftId.startsWith('peripheral') && shiftId.endsWith(SHIFT_CODES.NOON)
  if (type === 'single' && isPeripheralNoon) {
    teamData.nurseTeamIn = value || null
    teamData.nurseTeamOut = value || null
    teamData.nurseTeam = null
  } else if (type === 'single') {
    teamData.nurseTeam = value || null
  } else if (type === 'in') {
    teamData.nurseTeamIn = value || null
  } else if (type === 'out') {
    teamData.nurseTeamOut = value || null
  }
  if (!teamData.nurseTeam && !teamData.nurseTeamIn && !teamData.nurseTeamOut) {
    delete currentTeamsRecord.value.teams[key]
  }
  currentTeamsRecord.value = { ...currentTeamsRecord.value }
  setTeamChange()
}
function updateNote(event, shiftId) {
  if (isPageLocked.value) {
    event.target.textContent = getCombinedNote(shiftId)
    return
  }
  if (!currentRecord.schedule[shiftId]) {
    currentRecord.schedule[shiftId] = createEmptySlotData(shiftId)
  }
  currentRecord.schedule[shiftId].manualNote = event.target.textContent.trim()
  setChange()
}
function runScheduleCheck() {
  const warnings = []
  const duplicateNames = new Set()
  let tempScheduled = {}
  Object.values(currentRecord.schedule).forEach((slot) => {
    if (slot && slot.patientId) {
      if (tempScheduled[slot.patientId]) {
        const patientName = patientMap.value.get(slot.patientId)?.name
        if (patientName) duplicateNames.add(patientName)
      }
      tempScheduled[slot.patientId] = true
    }
  })
  if (duplicateNames.size > 0) {
    warnings.push(
      `【重複排班】:\n- 病人 ${Array.from(duplicateNames).join(', ')} 在本日出現超過一次。`,
    )
  }
  const missingPatients = getDailyUnassignedPatients(dayOfWeek).value
  if (missingPatients.length > 0) {
    const missingPatientNames = missingPatients
      .map((p) => `${p.name} (${p.status === 'ipd' ? '住院' : '門診'})`)
      .join('\n- ')
    warnings.push(`【未排床病人】:\n- ${missingPatientNames}`)
  }
  if (warnings.length > 0) {
    showAlert('排班檢視警告', warnings.join('\n\n'))
  } else {
    showAlert('排班檢視完畢', '未發現明顯的排班或遺漏問題。')
  }
}
function getPatientName(shiftId) {
  const patientId = currentRecord.schedule[shiftId]?.patientId
  return patientMap.value.get(patientId)?.name || ''
}
function getCombinedNote(shiftId) {
  const slotData = currentRecord.schedule[shiftId]
  if (!slotData) return ''
  const autoTags = (slotData.autoNote || '').split(' ').filter(Boolean)
  const manualTags = (slotData.manualNote || '').split(' ').filter(Boolean)
  const combinedTags = [...new Set([...autoTags, ...manualTags])]
  const finalTags = combinedTags.filter((tag) => !['住', '急'].includes(tag))
  return finalTags.join(' ')
}
function handleConfirm() {
  if (typeof onConfirmAction.value === 'function') onConfirmAction.value()
  isConfirmDialogVisible.value = false
  onConfirmAction.value = null
}
function handleCancel() {
  isConfirmDialogVisible.value = false
  onConfirmAction.value = null
}
function autoAssignNurseTeams() {
  if (isPageLocked.value) {
    showAlert('操作失敗', '頁面已鎖定，無法執行自動分組。')
    return
  }
  showConfirm('確認操作', '此操作將會覆蓋現有的護理師分組，您確定要繼續嗎？', () => {
    executeAutoAssignment()
  })
}
async function executeAutoAssignment() {
  currentTeamsRecord.value.teams = {}
  const getRichPatientList = (shiftCode) => {
    return Object.entries(currentRecord.schedule)
      .filter(([shiftId, slot]) => slot?.patientId && shiftId.endsWith(shiftCode))
      .map(([shiftId, slot]) => {
        const patientData = patientMap.value.get(slot.patientId)
        if (!patientData) return null
        const bedNumberStr = shiftId.split('-')[1]
        const bedNumber = parseInt(bedNumberStr, 10)
        return {
          id: slot.patientId,
          shiftId,
          shiftCode,
          status: patientData.status,
          isHepatitis: !isNaN(bedNumber) && hepatitisBeds.includes(bedNumber),
          isPeripheral: shiftId.startsWith('peripheral'),
        }
      })
      .filter(Boolean)
  }
  const mainArea = (list) => list.filter((p) => !p.isPeripheral)
  const peripheral = (list) => list.filter((p) => p.isPeripheral)
  const sort = (list) => {
    const getSortKey = (shiftId) => {
      if (!shiftId || typeof shiftId !== 'string') return 999
      const parts = shiftId.split('-')
      if (parts[0] === 'peripheral') return 100 + parseInt(parts[1], 10)
      const num = parseInt(parts[1], 10)
      return isNaN(num) ? 999 : num
    }
    return [...list].sort((a, b) => getSortKey(a.shiftId) - getSortKey(b.shiftId))
  }
  const allEarlyPatients = getRichPatientList(SHIFT_CODES.EARLY)
  const allNoonPatients = getRichPatientList(SHIFT_CODES.NOON)
  const allLatePatients = getRichPatientList(SHIFT_CODES.LATE)
  const earlyMain = mainArea(allEarlyPatients)
  const useEarlyTeamA = earlyMain.length > 36
  const earlyTeamsToUse = baseTeams.filter((t) => t !== 'L' && t !== '外圍').map((t) => `早${t}`)
  const earlyRegularTeams = baseTeams
    .filter((t) => !['A', 'K', 'L', '外圍'].includes(t))
    .map((t) => `早${t}`)
  const earlyRules = {
    priorityTeams: {
      hepatitis: '早G',
      inPatientTeams: ['早H', '早I', '早J'],
      inPatientCapacity: { 早H: 2, 早I: 2, 早J: 2 },
    },
    mainDistribution: {
      specialTeam: useEarlyTeamA ? { name: '早A', capacity: 2 } : null,
      regularTeams: earlyRegularTeams,
    },
  }
  const earlyAssignments = distributePatients(sort(earlyMain), earlyTeamsToUse, earlyRules)
  earlyAssignments['早外圍'] = peripheral(allEarlyPatients)
  const noonMain = mainArea(allNoonPatients)
  const useNoonTeamA = noonMain.length > 36
  const noonOnRules = {
    ...earlyRules,
    mainDistribution: {
      specialTeam: useNoonTeamA ? { name: '早A', capacity: 2 } : null,
      regularTeams: earlyRegularTeams,
    },
  }
  const noonOnAssignments = distributePatients(sort(noonMain), earlyTeamsToUse, noonOnRules)
  noonOnAssignments['早外圍'] = peripheral(allNoonPatients)
  const lateTeamsToUse = baseTeams.filter((t) => t <= 'H').map((t) => `晚${t}`)
  const lateRules = {
    priorityTeams: { hepatitis: '晚F', inPatientTeams: ['晚H'], inPatientCapacity: { 晚H: 2 } },
    mainDistribution: { specialTeam: null, regularTeams: lateTeamsToUse },
  }
  const noonOffAssignments = distributePatients(sort(noonMain), lateTeamsToUse, lateRules)
  noonOffAssignments['晚外圍'] = peripheral(allNoonPatients)
  const lateMain = mainArea(allLatePatients)
  const lateAssignments = distributePatients(sort(lateMain), lateTeamsToUse, lateRules)
  lateAssignments['晚外圍'] = peripheral(allLatePatients)
  for (const team in earlyAssignments) {
    for (const patient of earlyAssignments[team]) {
      const key = `${patient.id}-${SHIFT_CODES.EARLY}`
      if (!currentTeamsRecord.value.teams[key]) {
        currentTeamsRecord.value.teams[key] = {}
      }
      currentTeamsRecord.value.teams[key].nurseTeam = team
    }
  }
  for (const team in noonOnAssignments) {
    for (const patient of noonOnAssignments[team]) {
      const key = `${patient.id}-${SHIFT_CODES.NOON}`
      if (!currentTeamsRecord.value.teams[key]) {
        currentTeamsRecord.value.teams[key] = {}
      }
      currentTeamsRecord.value.teams[key].nurseTeamIn = team
    }
  }
  for (const team in noonOffAssignments) {
    for (const patient of noonOffAssignments[team]) {
      const key = `${patient.id}-${SHIFT_CODES.NOON}`
      if (!currentTeamsRecord.value.teams[key]) {
        currentTeamsRecord.value.teams[key] = {}
      }
      currentTeamsRecord.value.teams[key].nurseTeamOut = team
    }
  }
  for (const team in lateAssignments) {
    for (const patient of lateAssignments[team]) {
      const key = `${patient.id}-${SHIFT_CODES.LATE}`
      if (!currentTeamsRecord.value.teams[key]) {
        currentTeamsRecord.value.teams[key] = {}
      }
      currentTeamsRecord.value.teams[key].nurseTeam = team
    }
  }

  // 從護理班表自動填入護理師姓名
  const dateStr = currentRecord.date
  const updatedRecord = await autoFillNurseNames(dateStr, currentTeamsRecord.value)
  currentTeamsRecord.value.names = updatedRecord.names || {}

  setTeamChange()
  hasUnsavedChanges.value = true
  statusIndicator.value = '自動分組完成，請確認並儲存'
  showAlert('操作成功', '四個班次的自動分組已全部完成！請檢視結果並點擊「儲存」。')
}
function showShiftRecordsSummary(shiftCode) {
  const patientIds = new Set()
  const patientInfoMap = {}
  for (const shiftId in currentRecord.schedule) {
    if (shiftId.endsWith(`-${shiftCode}`)) {
      const slot = currentRecord.schedule[shiftId]
      if (slot && slot.patientId) {
        patientIds.add(slot.patientId)
        // 解析床號：bed-{bedNum}-{shiftCode} 或 peripheral-{i}-{shiftCode}
        const parts = shiftId.split('-')
        const bedNum = parts[0] === 'peripheral' ? `外${parts[1]}` : parts[1]
        const patient = patientMap.value.get(slot.patientId)
        patientInfoMap[slot.patientId] = {
          bedNum,
          medicalRecordNumber: patient?.medicalRecordNumber || '',
        }
      }
    }
  }
  shiftCodeForDialog.value = shiftCode
  patientIdsForDialog.value = Array.from(patientIds)
  patientInfoMapForDialog.value = patientInfoMap
  isRecordsSummaryDialogVisible.value = true
}
function closeRecordsSummaryDialog() {
  isRecordsSummaryDialogVisible.value = false
  shiftCodeForDialog.value = null
  patientIdsForDialog.value = []
  patientInfoMapForDialog.value = {}
}
function getPatientMode(shiftId) {
  const patientId = currentRecord.schedule[shiftId]?.patientId
  if (!patientId) return null
  const patient = patientMap.value.get(patientId)
  return patient?.mode || null
}
async function copyMedicalRecordNumber(mrn) {
  if (!mrn) return
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(mrn)
    } else {
      // HTTP 環境 fallback
      const textArea = document.createElement('textarea')
      textArea.value = mrn
      textArea.style.position = 'fixed'
      textArea.style.left = '-9999px'
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
    }
  } catch (err) {
    console.error('複製失敗:', err)
    showAlert('複製失敗', '無法將病歷號複製到剪貼簿，您的瀏覽器可能不支援或未授予權限。')
  }
}
function showAlert(title, message) {
  alertDialogTitle.value = title
  alertDialogMessage.value = message
  isAlertDialogVisible.value = true
}
function showConfirm(title, message, onConfirm) {
  confirmDialogMessage.value = message
  onConfirmAction.value = onConfirm
  isConfirmDialogVisible.value = true
}
function setChange() {
  if (isPageLocked.value) return
  hasUnsavedChanges.value = true
  statusIndicator.value = '有未儲存的變更'
}
function setTeamChange() {
  if (isPageLocked.value) return
  hasUnsavedTeamChanges.value = true
  hasUnsavedChanges.value = true
  statusIndicator.value = '有未儲存的變更'
}
function exportScheduleToExcel() {
  if (isLoading.value) {
    showAlert('提示', '資料正在載入中，請稍後再試。')
    return
  }
  const data = []
  const stats = statsToolbarData.value[0]
  const statsString = `總計: ${stats.total}人 (早: ${stats.counts.early.total}, 午: ${stats.counts.noon.total}, 晚: ${stats.counts.late.total})`
  data.push(['部立台北醫院 每日排程表'])
  data.push(['日期:', currentDateDisplay.value])
  data.push(['人數統計:', statsString])
  data.push([])
  const headers = [
    '床號',
    getShiftDisplayName('early'),
    getShiftDisplayName('noon'),
    getShiftDisplayName('late'),
  ]
  data.push(headers)
  const allBedsToExport = [...sortedBedNumbers.value]
  for (let i = 1; i <= peripheralBedCount; i++) {
    allBedsToExport.push(`外圍 ${i}`)
  }
  allBedsToExport.forEach((bedKey) => {
    const row = [bedKey]
    ORDERED_SHIFT_CODES.forEach((shiftCode) => {
      const bedNum = String(bedKey).replace('外圍 ', '')
      const shiftId = String(bedKey).startsWith('外圍')
        ? `peripheral-${bedNum}-${shiftCode}`
        : `bed-${bedNum}-${shiftCode}`
      const slot = currentRecord.schedule[shiftId]
      if (slot && slot.patientId) {
        const patient = patientMap.value.get(slot.patientId)
        const tags = []
        if (patient?.status === 'ipd') {
          tags.push(`住院${patient?.wardNumber ? ' ' + patient.wardNumber : ''}`)
        } else if (patient?.status === 'er') {
          tags.push(`急診${patient?.wardNumber ? ' ' + patient.wardNumber : ''}`)
        }
        const mode = patient?.mode
        if (mode && mode !== 'HD') {
          tags.push(mode)
        }
        const tagLine = tags.length > 0 ? `[${tags.join(' | ')}]` : ''
        const note = getCombinedNote(shiftId)
        const cellText = `${patient?.name || '未知'} (${
          patient?.medicalRecordNumber || 'N/A'
        })${tagLine ? '\n' + tagLine : ''}${note ? '\n' + note : ''}`
        row.push(cellText)
      } else {
        row.push('')
      }
    })
    data.push(row)
  })
  const worksheet = XLSX.utils.aoa_to_sheet(data)
  worksheet['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 3 } },
    { s: { r: 1, c: 1 }, e: { r: 1, c: 3 } },
    { s: { r: 2, c: 1 }, e: { r: 2, c: 3 } },
  ]
  worksheet['!cols'] = [{ wch: 10 }, { wch: 30 }, { wch: 30 }, { wch: 30 }]
  const dataRowsHeight = 55
  worksheet['!rows'] = [{ hpt: 25 }]
  worksheet['!rows'][1] = { hpt: 20 }
  worksheet['!rows'][2] = { hpt: 20 }
  worksheet['!rows'][3] = { hpt: 10 }
  worksheet['!rows'][4] = { hpt: 20 }
  for (let i = 0; i < data.length; i++) {
    if (i >= 5) {
      worksheet['!rows'][i] = { hpt: dataRowsHeight }
    }
    for (let j = 0; j < data[i].length; j++) {
      const cellAddress = XLSX.utils.encode_cell({ r: i, c: j })
      if (!worksheet[cellAddress]) continue
      worksheet[cellAddress].s = {
        alignment: { vertical: 'center', horizontal: 'center', wrapText: true },
      }
    }
  }
  worksheet['A1'].s.alignment.horizontal = 'left'
  worksheet['A2'].s.alignment.horizontal = 'right'
  worksheet['B2'].s.alignment.horizontal = 'left'
  worksheet['A3'].s.alignment.horizontal = 'right'
  worksheet['B3'].s.alignment.horizontal = 'left'
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, '每日排程')
  XLSX.writeFile(workbook, `每日排程表_${formatDate(currentDate.value)}.xlsx`)
}

async function handleSaveAndPrintIcuOrders(payload, printCallback) {
  if (isPageLocked.value || !auth.canEditClinicalNotesAndOrders.value) {
    showAlert('權限不足', '您沒有儲存 ICU 醫囑單的權限，或正在編輯過去的日期。')
    return
  }
  const { notes, crrtEmergency } = payload
  const updatePromises = []
  for (const patientId in notes) {
    const note = notes[patientId]
    const patient = patientMap.value.get(patientId)
    if (patient) {
      const newDialysisOrders = { ...(patient.dialysisOrders || {}) }
      newDialysisOrders.icuNote = note || ''
      updatePromises.push(optimizedUpdatePatient(patientId, { dialysisOrders: newDialysisOrders }))
    }
  }
  for (const patientId in crrtEmergency) {
    const { withdraw, note } = crrtEmergency[patientId]
    updatePromises.push(
      optimizedUpdatePatient(patientId, {
        emergencyWithdraw: withdraw,
        emergencyWithdrawNote: note || '',
      }),
    )
  }

  try {
    if (updatePromises.length > 0) {
      await Promise.all(updatePromises)
      await patientStore.forceRefreshPatients()
    }

    addLocalNotification('醫囑單資料已儲存', 'patient')

    if (typeof printCallback === 'function') {
      nextTick(() => {
        printCallback()
      })
    }
  } catch (error) {
    console.error('儲存 ICU 醫囑單備註失敗:', error)
    addLocalNotification('醫囑單儲存失敗', 'exception') // 'exception' 類型會顯示為紅色
  }
}

// Lifecycle Hooks
onMounted(async () => {
  isLoading.value = true
  await auth.waitForAuthInit()
  if (auth.currentUser.value) {
    taskStore.startRealtimeUpdates(auth.currentUser.value.uid)
  }
  await Promise.all([loadDataForDay(currentDate.value), loadDailyStaffInfo(currentDate.value)])
  isLoading.value = false
})

watch(currentDate, (newDate, oldDate) => {
  if (oldDate && formatDate(newDate) !== formatDate(oldDate)) {
    medicationStore.clearCache()
    noonTakeoffVisibility.value = { early: false, late: false }
    loadDataForDay(newDate)
    loadDailyStaffInfo(newDate)
  }
})

watch(
  () => auth.currentUser.value,
  (newUser) => {
    if (newUser) {
      taskStore.startRealtimeUpdates(newUser.uid)
    } else {
      taskStore.cleanupListeners()
    }
  },
  { immediate: true },
)
</script>

<style scoped>
/* =================================================================== */
/* === 1. 基礎與通用樣式 === */
/* =================================================================== */
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
.page-container.is-locked .btn,
.page-container.is-locked .add-btn,
.page-container.is-locked input[type='date'] {
  opacity: 0.65;
  cursor: not-allowed;
}
.page-container.is-locked button:disabled,
.page-container.is-locked .btn:disabled {
  pointer-events: none;
}
.page-container.is-locked .page-main-content {
  cursor: not-allowed;
}
.page-container.is-locked .schedule-content,
.page-container.is-locked .sidebar-locked {
  background-color: #f5f5f5;
}
.is-locked [draggable='true'],
.is-locked [contenteditable='true'],
.is-locked .nurse-team-select {
  cursor: not-allowed;
}
.is-locked .memo-icon-inline,
.is-locked :deep(.memo-icon-wrapper),
.is-locked :deep(.messages-icon-container) {
  pointer-events: auto;
  cursor: pointer;
}
.page-container {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  padding: 10px;
}
.page-header {
  flex-shrink: 0;
  border-bottom: 1px solid #e0e0e0;
  z-index: 10;
}
.page-main-content {
  flex-grow: 1;
  display: flex;
  min-height: 0;
  position: relative;
}
.schedule-content {
  flex-grow: 1;
  overflow-y: auto;
  min-width: 0;
}
.inpatient-sidebar {
  flex-shrink: 0;
  width: 240px;
  border-left: 1px solid #e0e0e0;
  display: flex;
  flex-direction: column;
  height: 100%;
}
.header-toolbar {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}
.toolbar-left,
.toolbar-right {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}
.page-title {
  font-size: 32px;
  margin: 0;
  white-space: nowrap;
}
.date-navigator {
  display: flex;
  align-items: center;
  gap: 10px;
}
.current-date-text,
.weekday-display {
  font-size: 26px;
  font-weight: bold;
}
.weekday-display {
  color: var(--primary-color, #007bff);
}
.status-indicator {
  font-weight: bold;
  color: #6c757d;
}
.controls-panel {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  margin-top: 1rem;
  padding: 0 0 0.3rem 0.3rem;
}
.controls-left,
.controls-right {
  display: flex;
  align-items: center;
}
.controls-left > button {
  margin-right: 12px;
}
.controls-left > button:last-child {
  margin-right: 0;
}
.btn,
button {
  padding: 8px 15px;
  font-size: 1em;
  border: 1px solid #ccc;
  border-radius: 5px;
  cursor: pointer;
  background-color: #fff;
  transition: all 0.2s ease-in-out;
}
.btn-success {
  background-color: #28a745;
  color: white;
  border-color: #28a745;
}
.btn-success:hover:not(:disabled) {
  background-color: #218838;
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
.btn-secondary {
  background-color: #6c757d;
  color: white;
  border-color: #6c757d;
}
.btn-secondary:hover:not(:disabled) {
  background-color: #545b62;
}
button:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.controls-right {
  display: flex;
  align-items: center;
  gap: 1.5rem;
}
/* =================================================================== */
/* === 2. 病人狀態與標籤顏色 === */
/* =================================================================== */
.shift-row.status-opd,
.peripheral-shift-row.status-opd,
.simplified-table td.status-opd {
  background-color: var(--green-bg, #e8f5e9);
}

.shift-row.status-ipd,
.peripheral-shift-row.status-ipd,
.simplified-table td.status-ipd {
  background-color: var(--red-bg, #ffebee);
}

.shift-row.status-er,
.peripheral-shift-row.status-er,
.simplified-table td.status-er {
  background-color: var(--purple-bg, #f3e5f5);
}

.shift-row.status-biweekly,
.peripheral-shift-row.status-biweekly,
.simplified-table td.status-biweekly {
  background-color: #ffcc80;
}

/* ✨ 已刪除病人樣式（預約刪除後的同步處理） */
.shift-row.status-deleted,
.peripheral-shift-row.status-deleted,
.simplified-table td.status-deleted {
  background-color: #e0e0e0;
  color: #9e9e9e;
  opacity: 0.5;
  text-decoration: line-through;
}

.shift-row.tag-chou,
.peripheral-shift-row.tag-chou,
.simplified-table td.tag-chou {
  background-color: #658ee0;
}

.shift-row.tag-new,
.peripheral-shift-row.tag-new,
.simplified-table td.tag-new {
  background-color: #f5ec8e;
}

.simplified-table td[class*='status-'] .patient-mrn-name,
.simplified-table td[class*='tag-'] .patient-mrn-name {
  color: #212529;
  font-weight: 600;
}

.simplified-table td[class*='status-'] .patient-note,
.simplified-table td[class*='tag-'] .patient-note {
  color: #dc3545;
}

/* =================================================================== */
/* === 3. 排班表 (Bed Grid) 樣式 === */
/* =================================================================== */
.dialysis-unit {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 20px;
}
.aisle {
  writing-mode: vertical-lr;
  text-align: center;
  padding: 20px 5px;
  background-color: #e9ecef;
  border-radius: 8px;
  font-size: 1.5em;
  letter-spacing: 0.5em;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #6c757d;
}
.left-wing,
.right-wing {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.bed-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.bed,
.nursing-station,
.peripheral-bed {
  border: 1px solid #ccc;
  border-radius: 8px;
  overflow: hidden;
  background-color: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  transition: all 0.3s ease-in-out;
}
.bed {
  min-height: 160px;
}
.nursing-station {
  background-color: #f0f4c3;
  border: 2px dashed #afb42b;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5em;
  font-weight: bold;
  color: #558b2f;
  grid-column: span 3;
  padding: 40px 0;
}
.bed-header,
.peripheral-header {
  background-color: #e3f2fd;
  color: #0d47a1;
  font-weight: bold;
  padding: 6px;
  text-align: center;
  font-size: 1em;
}
.shift-row,
.peripheral-shift-row {
  position: relative;
  display: grid;
  align-items: stretch;
  border-top: 1px solid #e0e0e0;
  transition: background-color 0.3s;
}
.shift-row {
  grid-template-columns: 28px 50px 1fr 40px;
}
.peripheral-shift-row {
  grid-template-columns: 28px 70px 80px 1fr 50px;
}
.shift-label {
  background-color: #f5f5f5;
  font-size: 0.8em;
  font-weight: bold;
  display: flex;
  align-items: center;
  justify-content: center;
  border-right: 1px solid #e0e0e0;
}
.shift-row > div,
.shift-row > select,
.peripheral-shift-row > div,
.peripheral-shift-row > select {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px 8px;
  min-height: 48px;
  border-left: 1px solid #e0e0e0;
  word-break: break-all;
  text-align: center;
}
.patient-tag {
  font-size: 0.9em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 4px 6px;
  color: #dc3545;
  font-weight: bold;
  min-height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ward-badge-inline {
  display: inline-block;
  background-color: #007bff;
  color: white;
  padding: 1px 6px;
  border-radius: 10px;
  font-size: 0.75em;
  font-weight: bold;
  margin-left: 4px;
  cursor: pointer;
  vertical-align: middle;
  transition: background-color 0.2s;
}
.ward-badge-inline:hover {
  background-color: #0056b3;
}
.ward-icon-inline {
  font-size: 0.85em;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
  opacity: 0.6;
  margin-left: 4px;
  line-height: 1;
  transition: opacity 0.2s;
}
.ward-icon-inline:hover:not(:disabled) {
  opacity: 1;
}
.ward-icon-inline:disabled {
  cursor: not-allowed;
  opacity: 0.3;
}
.nurse-team-select {
  padding: 4px;
  border: none;
  font-size: 0.8em;
  width: 100%;
  background: transparent;
  border-radius: 0;
  appearance: none;
  text-align: center;
}
.shift-row.split-shift .nurse-split-column {
  display: flex;
  flex-direction: column;
  padding: 0;
}
.nurse-split-column .nurse-team-select {
  flex-grow: 1;
  height: 50%;
}
.nurse-split-column .nurse-team-select:first-child {
  border-bottom: 1px solid #e0e0e0;
}
.bed.hepatitis .bed-header {
  background-color: var(--hepatitis-bg, #fffde7);
  color: #af8203;
}
.bed.unassigned .bed-header {
  background-color: #bdbdbd;
  color: #424242;
}
.bed.unassigned .shift-row {
  display: none;
}
.bed.aisle-side.right-wing-bed {
  border-left: 5px solid #4caf50;
}
.bed.aisle-side.left-wing-bed {
  border-right: 5px solid #4caf50;
}
.patient-name,
.peripheral-patient-name {
  font-size: 1.1em;
  font-weight: bold;
  padding: 4px 6px;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  cursor: pointer;
  gap: 4px;
}
.patient-name > span {
  display: flex;
  align-items: center;
  gap: 4px;
}
.empty-slot-placeholder {
  color: #adb5bd;
  font-size: 1.5rem;
  user-select: none;
  transition: color 0.2s;
}
.patient-name:hover .empty-slot-placeholder,
.peripheral-patient-name:hover .empty-slot-placeholder {
  color: #007bff;
}
.patient-name.drag-over,
.peripheral-patient-name.drag-over {
  background-color: #c8e6c9 !important;
  border: 2px dashed #4caf50;
}
.extra-sections {
  margin-top: 30px;
}
.peripheral-section {
  margin-bottom: 20px;
}
.peripheral-bed-container {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
  gap: 10px;
}
.peripheral-bed .peripheral-header {
  background-color: #fce4ec;
  color: #c2185b;
}
.patient-cell-layout {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  width: 100%;
  height: 100%;
  gap: 2px;
  line-height: 1.2;
}
.patient-name-text {
  font-weight: bold;
}
.patient-icons-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.patient-name,
.peripheral-patient-name {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2px;
}
.mobile-and-print-only {
  display: none;
}

/* =================================================================== */
/* === 4. 臨床查閱 & 簡化模式樣式 === */
/* =================================================================== */
.view-toggle-btn {
  background-color: #e9ecef;
  border-color: #adb5bd;
  padding: 8px 15px;
  font-weight: 500;
}
.view-toggle-btn:hover {
  background-color: #dee2e6;
}
.toggle-icon {
  transition: transform 0.2s ease-in-out;
}
.simplified-view-wrapper.desktop-only {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(248, 249, 250, 0.97);
  z-index: 20;
  padding: 1rem;
  overflow-y: auto;
  backdrop-filter: blur(4px);
  animation: fadeIn 0.3s ease;
}
@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
.simplified-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
  table-layout: fixed;
}
.simplified-table th,
.simplified-table td {
  border: 1px solid #ccc;
  padding: 0.5rem;
  text-align: center;
  vertical-align: top;
}
.simplified-table th {
  background-color: #e9ecef;
  font-weight: 600;
}
.simplified-table .col-bed {
  font-weight: bold;
  background-color: #f8f9fa;
  width: 80px;
}
.patient-info-cell {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  text-align: left;
  cursor: pointer;
}
.patient-mrn-name {
  font-weight: bold;
  display: flex;
  flex-direction: column;
  line-height: 1.3;
}
.patient-note {
  font-size: 0.85rem;
  color: #dc3545;
  font-weight: 500;
}
.patient-ward-note {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.ward-number {
  font-weight: bold;
  background-color: #ffc107;
  color: #333;
  padding: 0 4px;
  border-radius: 4px;
}
.patient-name-wrapper {
  display: flex;
  align-items: center;
  gap: 4px;
}
.shift-header-content {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.summary-icon-btn-table {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  font-size: 1.2rem;
  opacity: 0.6;
  transition: all 0.2s;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
}

.summary-icon-btn-table:hover {
  opacity: 1;
  transform: scale(1.15);
}

.summary-icon-btn-table i {
  color: #495057;
  transition: color 0.2s;
}

.summary-icon-btn-table:hover i {
  color: #000;
}
.stats-special-mode {
  display: inline-block;
  vertical-align: middle;
  padding: 1px 5px;
  background-color: var(--red-bg, #ffebee);
  color: #c62828;
  border: 1px solid #ef9a9a;
  border-radius: 4px;
  font-weight: bold;
  font-size: 0.9em;
  line-height: 1.2;
}
.stats-special-mode-inline {
  display: inline-block;
  vertical-align: baseline;
  margin-left: 4px;
  color: #c62828;
  font-weight: bold;
  font-size: 0.9em;
}
.patient-name-text {
  display: flex;
  align-items: baseline;
  justify-content: center;
  flex-wrap: nowrap;
}
.medical-record-number {
  cursor: copy;
  transition: color 0.2s;
  color: #6c757d;
}
.medical-record-number:hover {
  color: #007bff;
  text-decoration: underline;
}
.patient-name-wrapper {
  cursor: pointer;
  transition: background-color 0.2s;
  padding: 2px 4px;
  border-radius: 4px;
}
.patient-name-wrapper:hover {
  background-color: #e9ecef;
}
.ward-number-display {
  font-weight: bold;
  color: #007bff;
  margin-right: 8px;
}
.peripheral-bed-number {
  font-size: 0.9em;
  min-width: 80px;
  padding: 4px 8px;
  border-left: 1px solid #e0e0e0;
  text-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
}
.peripheral-bed-number:focus {
  outline: 2px solid #007bff;
  outline-offset: -2px;
  background-color: #f0f8ff;
}
.peripheral-bed-number[contenteditable='false'] {
  background-color: #f5f5f5;
}
.peripheral-bed-number .ward-number-badge {
  display: inline-block;
  background-color: #007bff;
  color: white;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 0.85em;
  font-weight: bold;
  cursor: pointer;
  transition: background-color 0.2s;
}
.peripheral-bed-number .ward-number-badge:hover {
  background-color: #0056b3;
}
.peripheral-bed-number .ward-edit-icon {
  font-size: 0.9em;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
  opacity: 0.6;
  line-height: 1;
}

/* =================================================================== */
/* === 5. 響應式 (Media Queries) === */
/* =================================================================== */

/* 行動版專用元素在桌面版必須隱藏 */
.mobile-only {
  display: none !important;
}

/* 桌面版樣式保持不變 */
@media screen and (min-width: 993px) {
  .desktop-only .simplified-table td {
    padding: 0.6rem;
    font-size: 1rem;
  }
  .desktop-only .simplified-table .patient-mrn-name {
    display: flex;
    flex-direction: row;
    align-items: baseline;
    gap: 0.5em;
    flex-wrap: nowrap;
  }
  .desktop-only .simplified-table .patient-ward-note {
    gap: 0.5em;
  }

  /* 確保行動版元素在桌面版不顯示 */
  .mobile-only {
    display: none !important;
  }
}

/* 行動版樣式 - 只在 992px 以下生效 */
@media screen and (max-width: 992px) {
  .desktop-only {
    display: none !important;
  }

  .mobile-and-print-only {
    display: block;
  }

  /* 行動版專用的 ICU 按鈕顯示 */
  .mobile-only {
    display: inline-flex !important;
    align-items: center;
  }

  /* 行動版的緊湊頂部 */
  .page-container {
    padding: 0;
  }

  .page-header {
    padding: 0.5rem 0.75rem;
    background-color: #fff;
  }

  .page-main-content {
    display: block;
    overflow-y: auto;
  }

  .schedule-content {
    padding: 0;
  }

  .simplified-view {
    padding: 0.5rem;
  }

  /* 行動版工具列緊湊化 */
  .header-toolbar {
    flex-direction: column;
    align-items: stretch;
    gap: 0.5rem;
  }

  /* 行動版標題和按鈕 */
  .toolbar-left {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .toolbar-left .page-title {
    font-size: 1.3rem;
    margin: 0;
    flex: 1;
  }

  /* ICU 醫囑按鈕（行動版） */
  .toolbar-left .mobile-only {
    padding: 0.4rem 0.6rem;
    font-size: 0.85rem;
    background-color: #6c757d;
    color: white;
    border-color: #6c757d;
    border-radius: 4px;
    white-space: nowrap;
  }

  .mobile-btn-text {
    font-size: 0.85rem;
    margin-left: 0.25rem;
  }

  .toolbar-right {
    flex-direction: column;
    align-items: stretch;
    gap: 0.25rem;
  }

  /* 日期導航緊湊化 */
  .date-navigator {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0;
  }

  .date-navigator .current-date-text,
  .date-navigator .weekday-display {
    font-size: 1.1rem;
  }

  .date-navigator .btn {
    padding: 0.4rem 0.6rem;
    font-size: 0.8rem;
  }

  .page-title {
    text-align: left;
  }

  /* 簡化表格行動版優化 */
  .simplified-table {
    font-size: 0.8rem;
  }

  .simplified-table th,
  .simplified-table td {
    padding: 0.3rem;
  }

  .simplified-table .col-bed {
    width: 55px;
    font-size: 0.75rem;
  }

  .patient-info-cell {
    font-size: 0.75rem;
  }

  .patient-note {
    font-size: 0.7rem;
  }

  /* 表格按鈕縮小 */
  .summary-icon-btn-table {
    width: 24px;
    height: 24px;
    font-size: 0.9rem;
  }

  .shift-header-content {
    gap: 4px;
  }
}

/* 超小螢幕（手機直向） */
@media screen and (max-width: 576px) {
  .page-header {
    padding: 0.4rem 0.5rem;
  }

  .toolbar-left .page-title {
    font-size: 1.1rem;
  }

  /* 超小螢幕只顯示圖標 */
  .mobile-btn-text {
    display: none;
  }

  .toolbar-left .mobile-only {
    padding: 0.35rem 0.5rem;
    min-width: 36px;
  }

  .date-navigator {
    font-size: 0.85rem;
  }

  .date-navigator .current-date-text,
  .date-navigator .weekday-display {
    font-size: 0.95rem;
  }

  .date-navigator .btn {
    padding: 0.35rem 0.5rem;
    font-size: 0.75rem;
  }
}
</style>
