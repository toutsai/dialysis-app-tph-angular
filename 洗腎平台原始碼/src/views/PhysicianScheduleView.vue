<!-- 檔案路徑: src/views/PhysicianScheduleView.vue -->
<template>
  <div class="page-container">
    <div v-if="isLoading" class="loading-overlay">
      <div class="loading-spinner"></div>
      <p>正在載入醫師與排班資料...</p>
    </div>

    <header class="page-header">
      <div class="header-left">
        <h1 class="page-main-title">醫師班表</h1>
        <div class="month-navigator">
          <button @click="goToPreviousMonth" title="上一個月">❮</button>
          <span class="month-display">{{ selectedYear }} 年 {{ selectedMonth }} 月</span>
          <button @click="goToNextMonth" title="下一個月">❯</button>
        </div>
      </div>
      <!-- ✨ 修改：只有有權限的人才看得到儲存按鈕與狀態提示 -->
      <div class="header-right hide-on-mobile" v-if="canManagePhysicianSchedule">
        <span class="status-indicator" :class="{ 'has-changes': hasUnsavedChanges }">
          {{ statusText }}
        </span>
        <button @click="saveAllChanges" class="save-btn" :disabled="!hasUnsavedChanges">
          <i class="fas fa-save"></i> 儲存所有變更
        </button>
      </div>
    </header>

    <div class="tabs-container">
      <div class="tabs-left">
        <a
          class="tab-link"
          :class="{ active: activeTab === 'dialysis' }"
          @click="activeTab = 'dialysis'"
          >查房</a
        >
        <a
          class="tab-link"
          :class="{ active: activeTab === 'consultation' }"
          @click="activeTab = 'consultation'"
          >會診</a
        >
        <a
          class="tab-link"
          :class="{ active: activeTab === 'emergency' }"
          @click="activeTab = 'emergency'"
          >緊急出勤</a
        >
      </div>
      <div class="mobile-view-toggle">
        <button :class="{ active: mobileDisplayMode === 'day' }" @click="mobileDisplayMode = 'day'">
          <i class="fas fa-list"></i> 日曆
        </button>
        <button
          :class="{ active: mobileDisplayMode === 'week' }"
          @click="mobileDisplayMode = 'week'"
        >
          <i class="fas fa-calendar-week"></i> 週曆
        </button>
      </div>
    </div>

    <main class="schedule-content new-layout">
      <!-- 左欄：班表 -->
      <div class="schedule-grid-container">
        <!-- ========================== -->
        <!--   洗腎室/ICU 查房班表      -->
        <!-- ========================== -->
        <div v-if="activeTab === 'dialysis'">
          <div class="desktop-view" :class="{ 'mobile-week-view': mobileDisplayMode === 'week' }">
            <table v-if="!isLoading" class="schedule-table weekly-grid">
              <thead>
                <tr>
                  <th class="shift-header-cell"></th>
                  <th>一</th>
                  <th>二</th>
                  <th>三</th>
                  <th>四</th>
                  <th>五</th>
                  <th class="weekend">六</th>
                  <th class="weekend">日</th>
                </tr>
              </thead>
              <tbody v-for="(week, weekIndex) in weeklyData" :key="`dialysis-week-${weekIndex}`">
                <tr class="date-row">
                  <td class="shift-header-cell">日期</td>
                  <td
                    v-for="(day, dayIndex) in week"
                    :key="day.fullDate || `dialysis-empty-${weekIndex}-${dayIndex}`"
                    :class="getDayClass(day)"
                    class="cell-day"
                  >
                    <span v-if="day.day">{{ selectedMonth }}/{{ day.day }}</span>
                  </td>
                </tr>
                <tr class="shift-row">
                  <td class="shift-header-cell">早班</td>
                  <td
                    v-for="(day, dayIndex) in week"
                    :key="day.fullDate || `dialysis-empty-early-${weekIndex}-${dayIndex}`"
                    :class="[getPhysicianClass(day, 'early', 'dialysis'), getShiftCellClass(day)]"
                  >
                    <select
                      :disabled="!canManagePhysicianSchedule"
                      v-if="day.day && scheduleData[day.day]"
                      v-model="scheduleData[day.day].early.physicianId"
                      @change="checkClinicConflict($event, day, 'early')"
                      class="physician-select"
                    >
                      <option :value="null">--</option>
                      <option v-for="doc in availablePhysicians" :key="doc.id" :value="doc.id">
                        {{ getDisplayName(doc) }}
                      </option>
                    </select>
                    <span class="mobile-readonly-text">{{
                      getPhysicianDisplayName(day, 'early', 'dialysis')
                    }}</span>
                  </td>
                </tr>
                <tr class="shift-row">
                  <td class="shift-header-cell">午班</td>
                  <td
                    v-for="(day, dayIndex) in week"
                    :key="day.fullDate || `dialysis-empty-noon-${weekIndex}-${dayIndex}`"
                    :class="[getPhysicianClass(day, 'noon', 'dialysis'), getShiftCellClass(day)]"
                  >
                    <select
                      :disabled="!canManagePhysicianSchedule"
                      v-if="day.day && scheduleData[day.day]"
                      v-model="scheduleData[day.day].noon.physicianId"
                      @change="checkClinicConflict($event, day, 'noon')"
                      class="physician-select"
                    >
                      <option :value="null">--</option>
                      <option v-for="doc in availablePhysicians" :key="doc.id" :value="doc.id">
                        {{ getDisplayName(doc) }}
                      </option>
                    </select>
                    <span class="mobile-readonly-text">{{
                      getPhysicianDisplayName(day, 'noon', 'dialysis')
                    }}</span>
                  </td>
                </tr>
                <tr class="shift-row">
                  <td class="shift-header-cell">夜班</td>
                  <td
                    v-for="(day, dayIndex) in week"
                    :key="day.fullDate || `dialysis-empty-late-${weekIndex}-${dayIndex}`"
                    :class="[getPhysicianClass(day, 'late', 'dialysis'), getShiftCellClass(day)]"
                  >
                    <select
                      :disabled="!canManagePhysicianSchedule"
                      v-if="day.day && scheduleData[day.day]"
                      v-model="scheduleData[day.day].late.physicianId"
                      @change="checkClinicConflict($event, day, 'late')"
                      class="physician-select"
                    >
                      <option :value="null">--</option>
                      <option v-for="doc in availablePhysicians" :key="doc.id" :value="doc.id">
                        {{ getDisplayName(doc) }}
                      </option>
                    </select>
                    <span class="mobile-readonly-text">{{
                      getPhysicianDisplayName(day, 'late', 'dialysis')
                    }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="mobile-day-view" v-if="mobileDisplayMode === 'day'">
            <div
              v-for="day in dailyData"
              :key="`dialysis-day-${day.fullDate}`"
              class="mobile-day-card"
              :class="getDayClass(day)"
            >
              <div class="mobile-day-header">
                <span class="date">{{ selectedMonth }}/{{ day.day }}</span>
                <span class="weekday">{{ getWeekday(day.fullDate) }}</span>
              </div>
              <div class="mobile-day-shifts">
                <div class="mobile-shift-row" :class="getPhysicianClass(day, 'early', 'dialysis')">
                  <span class="mobile-shift-label">早</span
                  ><span class="mobile-physician-name">{{
                    getPhysicianDisplayName(day, 'early', 'dialysis')
                  }}</span>
                </div>
                <div class="mobile-shift-row" :class="getPhysicianClass(day, 'noon', 'dialysis')">
                  <span class="mobile-shift-label">午</span
                  ><span class="mobile-physician-name">{{
                    getPhysicianDisplayName(day, 'noon', 'dialysis')
                  }}</span>
                </div>
                <div class="mobile-shift-row" :class="getPhysicianClass(day, 'late', 'dialysis')">
                  <span class="mobile-shift-label">晚</span
                  ><span class="mobile-physician-name">{{
                    getPhysicianDisplayName(day, 'late', 'dialysis')
                  }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- ========================== -->
        <!--     腎臟科會診班表         -->
        <!-- ========================== -->
        <div v-if="activeTab === 'consultation'">
          <div class="desktop-view" :class="{ 'mobile-week-view': mobileDisplayMode === 'week' }">
            <table v-if="!isLoading" class="schedule-table weekly-grid">
              <thead>
                <tr>
                  <th class="shift-header-cell"></th>
                  <th>一</th>
                  <th>二</th>
                  <th>三</th>
                  <th>四</th>
                  <th>五</th>
                  <th class="weekend">六</th>
                  <th class="weekend">日</th>
                </tr>
              </thead>
              <tbody v-for="(week, weekIndex) in weeklyData" :key="`consult-week-${weekIndex}`">
                <tr class="date-row">
                  <td class="shift-header-cell">日期</td>
                  <td
                    v-for="(day, dayIndex) in week"
                    :key="day.fullDate || `consult-empty-${weekIndex}-${dayIndex}`"
                    :class="getDayClass(day)"
                    class="cell-day"
                  >
                    <span v-if="day.day">{{ selectedMonth }}/{{ day.day }}</span>
                  </td>
                </tr>
                <tr class="shift-row">
                  <td class="shift-header-cell">上午</td>
                  <td
                    v-for="(day, dayIndex) in week"
                    :key="day.fullDate || `consult-empty-morning-${weekIndex}-${dayIndex}`"
                    :class="[
                      getPhysicianClass(day, 'morning', 'consultation'),
                      getShiftCellClass(day),
                    ]"
                  >
                    <select
                      :disabled="!canManagePhysicianSchedule"
                      v-if="day.day && consultationScheduleData[day.day]"
                      v-model="consultationScheduleData[day.day].morning.physicianId"
                      @change="checkClinicConflict($event, day, 'morning')"
                      class="physician-select"
                    >
                      <option :value="null">--</option>
                      <option v-for="doc in availablePhysicians" :key="doc.id" :value="doc.id">
                        {{ getDisplayName(doc) }}
                      </option>
                    </select>
                    <span class="mobile-readonly-text">{{
                      getPhysicianDisplayName(day, 'morning', 'consultation')
                    }}</span>
                  </td>
                </tr>
                <tr class="shift-row">
                  <td class="shift-header-cell">下午</td>
                  <td
                    v-for="(day, dayIndex) in week"
                    :key="day.fullDate || `consult-empty-afternoon-${weekIndex}-${dayIndex}`"
                    :class="[
                      getPhysicianClass(day, 'afternoon', 'consultation'),
                      getShiftCellClass(day),
                    ]"
                  >
                    <select
                      :disabled="!canManagePhysicianSchedule"
                      v-if="day.day && consultationScheduleData[day.day]"
                      v-model="consultationScheduleData[day.day].afternoon.physicianId"
                      @change="checkClinicConflict($event, day, 'afternoon')"
                      class="physician-select"
                    >
                      <option :value="null">--</option>
                      <option v-for="doc in availablePhysicians" :key="doc.id" :value="doc.id">
                        {{ getDisplayName(doc) }}
                      </option>
                    </select>
                    <span class="mobile-readonly-text">{{
                      getPhysicianDisplayName(day, 'afternoon', 'consultation')
                    }}</span>
                  </td>
                </tr>
                <tr class="shift-row">
                  <td class="shift-header-cell">夜間(5pm~)</td>
                  <td
                    v-for="(day, dayIndex) in week"
                    :key="day.fullDate || `consult-empty-night-${weekIndex}-${dayIndex}`"
                    :class="[
                      getPhysicianClass(day, 'night', 'consultation'),
                      getShiftCellClass(day),
                    ]"
                  >
                    <select
                      :disabled="!canManagePhysicianSchedule"
                      v-if="day.day && consultationScheduleData[day.day]"
                      v-model="consultationScheduleData[day.day].night.physicianId"
                      @change="checkClinicConflict($event, day, 'night')"
                      class="physician-select"
                    >
                      <option :value="null">--</option>
                      <option v-for="doc in availablePhysicians" :key="doc.id" :value="doc.id">
                        {{ getDisplayName(doc) }}
                      </option>
                    </select>
                    <span class="mobile-readonly-text">{{
                      getPhysicianDisplayName(day, 'night', 'consultation')
                    }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="mobile-day-view" v-if="mobileDisplayMode === 'day'">
            <div
              v-for="day in dailyData"
              :key="`consult-day-${day.fullDate}`"
              class="mobile-day-card"
              :class="getDayClass(day)"
            >
              <div class="mobile-day-header">
                <span class="date">{{ selectedMonth }}/{{ day.day }}</span>
                <span class="weekday">{{ getWeekday(day.fullDate) }}</span>
              </div>
              <div class="mobile-day-shifts">
                <div
                  class="mobile-shift-row"
                  :class="getPhysicianClass(day, 'morning', 'consultation')"
                >
                  <span class="mobile-shift-label">上</span
                  ><span class="mobile-physician-name">{{
                    getPhysicianDisplayName(day, 'morning', 'consultation')
                  }}</span>
                </div>
                <div
                  class="mobile-shift-row"
                  :class="getPhysicianClass(day, 'afternoon', 'consultation')"
                >
                  <span class="mobile-shift-label">下</span
                  ><span class="mobile-physician-name">{{
                    getPhysicianDisplayName(day, 'afternoon', 'consultation')
                  }}</span>
                </div>
                <div
                  class="mobile-shift-row"
                  :class="getPhysicianClass(day, 'night', 'consultation')"
                >
                  <span class="mobile-shift-label">夜</span
                  ><span class="mobile-physician-name">{{
                    getPhysicianDisplayName(day, 'night', 'consultation')
                  }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- ========================== -->
        <!--     緊急出勤紀錄           -->
        <!-- ========================== -->
        <div v-if="activeTab === 'emergency'">
          <!-- 桌面版檢視 -->
          <div class="desktop-view">
            <div class="emergency-container">
              <div class="emergency-toolbar">
                <p class="emergency-description">
                  此處紀錄的為**本月**發生的緊急出勤事件。此資料將會與查房、會診班表一同儲存。
                </p>
                <!-- ✨ 2. [核心修改] 新增匯出按鈕 -->
                <button @click="exportEmergencyRecords" class="btn btn-secondary">
                  <i class="fas fa-file-excel"></i> 匯出 Excel
                </button>
              </div>
              <div class="emergency-table-wrapper">
                <table class="emergency-table">
                  <thead>
                    <tr>
                      <th class="col-emergency-date">日期</th>
                      <th class="col-emergency-name">病人姓名</th>
                      <th class="col-emergency-mrn">病歷號</th>
                      <th class="col-emergency-reason">出勤原因</th>
                      <th class="col-emergency-time">起 (時:分)</th>
                      <th class="col-emergency-time">迄 (時:分)</th>
                      <th class="col-emergency-physician">出勤醫師</th>
                      <th class="col-emergency-actions">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(record, index) in emergencyRecords" :key="index">
                      <td><input type="date" v-model="record.date" class="emergency-input" /></td>
                      <td>
                        <div class="autocomplete-wrapper">
                          <input
                            type="text"
                            v-model="record.patientName"
                            @input="handlePatientSearch(index, 'emergency')"
                            @focus="showAutocomplete($event, index, 'emergency')"
                            @blur="hideAutocomplete"
                            placeholder="搜尋或手動輸入..."
                            class="emergency-input"
                          />
                        </div>
                      </td>
                      <td>
                        <input
                          type="text"
                          v-model="record.medicalRecordNumber"
                          placeholder="選填"
                          class="emergency-input"
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          v-model="record.reason"
                          required
                          class="emergency-input"
                        />
                      </td>
                      <td>
                        <input
                          type="time"
                          v-model="record.startTime"
                          required
                          class="emergency-input"
                        />
                      </td>
                      <td>
                        <input
                          type="time"
                          v-model="record.endTime"
                          required
                          class="emergency-input"
                        />
                      </td>
                      <td>
                        <select
                          :disabled="!canManagePhysicianSchedule"
                          v-model="record.physicianId"
                          required
                          class="emergency-input"
                        >
                          <option :value="null">請選擇</option>
                          <option v-for="doc in availablePhysicians" :key="doc.id" :value="doc.id">
                            {{ doc.name }}
                          </option>
                        </select>
                      </td>
                      <td>
                        <button
                          @click="removeEmergencyRecord(index)"
                          class="btn-icon btn-delete"
                          title="刪除此行"
                        >
                          <i class="fas fa-trash-alt"></i>
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <button @click="addEmergencyRecord" class="btn-add-row">
                <i class="fas fa-plus"></i> 新增一筆紀錄
              </button>
            </div>
          </div>
          <!-- ✨ 3. [核心修改] 新增行動版檢視 -->
          <div class="mobile-day-view">
            <div class="emergency-toolbar-mobile">
              <button @click="addEmergencyRecord" class="btn btn-primary">
                <i class="fas fa-plus"></i> 新增紀錄
              </button>
              <button @click="exportEmergencyRecords" class="btn btn-secondary">
                <i class="fas fa-file-excel"></i> 匯出
              </button>
            </div>
            <div
              v-if="emergencyRecords.length > 0"
              v-for="(record, index) in emergencyRecords"
              :key="`mobile-${index}`"
              class="mobile-emergency-card"
            >
              <div class="card-header">
                <div class="header-info">
                  <span class="card-date">{{ record.date }}</span>
                  <span class="card-physician">{{ getPhysicianNameById(record.physicianId) }}</span>
                </div>
                <button
                  @click="removeEmergencyRecord(index)"
                  class="btn-icon btn-delete"
                  title="刪除此行"
                >
                  <i class="fas fa-trash-alt"></i>
                </button>
              </div>
              <div class="card-body">
                <div class="info-row">
                  <strong class="label">病患:</strong>
                  <span
                    >{{ record.patientName || 'N/A' }} ({{
                      record.medicalRecordNumber || 'N/A'
                    }})</span
                  >
                </div>
                <div class="info-row">
                  <strong class="label">時間:</strong>
                  <span>{{ record.startTime }} - {{ record.endTime }}</span>
                </div>
                <div class="info-row reason">
                  <strong class="label">原因:</strong>
                  <p>{{ record.reason }}</p>
                </div>
              </div>
            </div>
            <p v-else class="no-data-text">本月尚無緊急出勤紀錄</p>
          </div>
        </div>
      </div>

      <!-- 右欄：所有輔助面板 (完全共用) -->
      <div class="panels-container">
        <div class="desktop-panels">
          <div class="physician-legend-panel">
            <h2>醫師資訊與門診設定</h2>
            <div class="legend-table-wrapper">
              <table class="legend-table styled-legend">
                <thead>
                  <tr>
                    <th>醫師</th>
                    <th>員編</th>
                    <th>電話</th>
                  </tr>
                </thead>
                <tbody>
                  <template v-for="doc in availablePhysicians" :key="doc.id">
                    <tr class="physician-info-row" :class="getPhysicianClassById(doc.id)">
                      <td class="physician-name-cell">
                        <span class="legend-char">{{ getDisplayName(doc) }}</span
                        >{{ doc.name }}
                      </td>
                      <td>{{ doc.staffId || 'N/A' }}</td>
                      <td>{{ doc.phone || 'N/A' }}</td>
                    </tr>
                    <tr class="clinic-schedule-row" :class="getPhysicianClassById(doc.id)">
                      <td colspan="3">
                        <div class="clinic-select-container">
                          <select
                            :disabled="!canManagePhysicianSchedule"
                            v-if="physicianClinicSelections[doc.id]"
                            v-model="physicianClinicSelections[doc.id][0]"
                            class="clinic-select"
                          >
                            <option value="">門診一</option>
                            <option
                              v-for="option in clinicOptions"
                              :key="option.value"
                              :value="option.value"
                            >
                              {{ option.text }}
                            </option>
                          </select>
                          <select
                            :disabled="!canManagePhysicianSchedule"
                            v-if="physicianClinicSelections[doc.id]"
                            v-model="physicianClinicSelections[doc.id][1]"
                            class="clinic-select"
                          >
                            <option value="">門診二</option>
                            <option
                              v-for="option in clinicOptions"
                              :key="option.value"
                              :value="option.value"
                            >
                              {{ option.text }}
                            </option>
                          </select>
                          <select
                            :disabled="!canManagePhysicianSchedule"
                            v-if="physicianClinicSelections[doc.id]"
                            v-model="physicianClinicSelections[doc.id][2]"
                            class="clinic-select"
                          >
                            <option value="">門診三</option>
                            <option
                              v-for="option in clinicOptions"
                              :key="option.value"
                              :value="option.value"
                            >
                              {{ option.text }}
                            </option>
                          </select>
                          <select
                            :disabled="!canManagePhysicianSchedule"
                            v-if="physicianClinicSelections[doc.id]"
                            v-model="physicianClinicSelections[doc.id][3]"
                            class="clinic-select"
                          >
                            <option value="">門診四</option>
                            <option
                              v-for="option in clinicOptions"
                              :key="option.value"
                              :value="option.value"
                            >
                              {{ option.text }}
                            </option>
                          </select>
                        </div>
                      </td>
                    </tr>
                  </template>
                </tbody>
              </table>
            </div>
          </div>
          <div class="pd-clinic-panel">
            <h2>腹膜透析(PD)門診</h2>
            <div class="pd-clinic-grid">
              <div v-for="doc in availablePhysicians" :key="`pd-${doc.id}`" class="pd-clinic-row">
                <span class="pd-doctor-name">{{ doc.name }}</span>
                <div class="pd-input-group">
                  <input
                    type="date"
                    v-if="monthlyPdClinicSelections[doc.id]"
                    v-model="monthlyPdClinicSelections[doc.id][0].date"
                  /><select
                    :disabled="!canManagePhysicianSchedule"
                    v-if="monthlyPdClinicSelections[doc.id]"
                    v-model="monthlyPdClinicSelections[doc.id][0].shift"
                  >
                    <option value="">班別</option>
                    <option value="AM">上午</option>
                    <option value="PM">下午</option>
                    <option value="NT">晚上</option>
                  </select>
                </div>
                <div class="pd-input-group">
                  <input
                    type="date"
                    v-if="monthlyPdClinicSelections[doc.id]"
                    v-model="monthlyPdClinicSelections[doc.id][1].date"
                  /><select
                    :disabled="!canManagePhysicianSchedule"
                    v-if="monthlyPdClinicSelections[doc.id]"
                    v-model="monthlyPdClinicSelections[doc.id][1].shift"
                  >
                    <option value="">班別</option>
                    <option value="AM">上午</option>
                    <option value="PM">下午</option>
                    <option value="NT">晚上</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
          <div class="statistics-panel">
            <div class="stats-header">
              <h2>排班統計</h2>
              <div class="stats-mode-toggle">
                <button
                  :class="{ active: statsViewMode === 'monthly' }"
                  @click="statsViewMode = 'monthly'"
                >
                  本月</button
                ><button
                  :class="{ active: statsViewMode === 'ytd' }"
                  @click="statsViewMode = 'ytd'"
                >
                  今年累計
                </button>
              </div>
            </div>
            <table class="stats-table">
              <thead v-if="statsViewMode === 'monthly'">
                <tr>
                  <th>醫師姓名</th>
                  <th>本月平日(含國定假日)班</th>
                  <th>本月週末班</th>
                </tr>
              </thead>
              <tbody v-if="statsViewMode === 'monthly'">
                <tr v-for="stat in scheduleStats" :key="stat.name">
                  <td>{{ stat.name }}</td>
                  <td>{{ stat.monthlyWeekday }}</td>
                  <td :class="{ 'has-multiple-weekends': stat.monthlyWeekend > 1 }">
                    {{ stat.monthlyWeekend }}
                  </td>
                </tr>
              </tbody>
              <thead v-if="statsViewMode === 'ytd'">
                <tr>
                  <th>醫師姓名</th>
                  <th>累計總班數</th>
                  <th>累計平日假日班</th>
                  <th>累計週末班</th>
                </tr>
              </thead>
              <tbody v-if="statsViewMode === 'ytd'">
                <tr v-for="stat in scheduleStats" :key="stat.name">
                  <td>{{ stat.name }}</td>
                  <td>{{ stat.ytdTotal }}</td>
                  <td>{{ stat.ytdHolidays }}</td>
                  <td>{{ stat.ytdWeekends }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="special-dates-panel">
            <h2>註記日期</h2>
            <div class="date-input-group">
              <label>月抽血日：</label><input type="date" v-model="bloodDrawDate1" /><input
                type="date"
                v-model="bloodDrawDate2"
              />
            </div>
            <div class="date-input-group">
              <label>解釋報告日：</label><input type="date" v-model="reportDate1" /><input
                type="date"
                v-model="reportDate2"
              />
            </div>
          </div>
          <div class="notes-panel">
            <h2>排班規則與備註</h2>
            <textarea
              v-model="scheduleNotes"
              class="notes-textarea"
              rows="5"
              placeholder="請在此輸入排班規則、醫師預約不值班等備註事項..."
            ></textarea>
          </div>
          <div class="notes-panel">
            <h2>國定假日管理 (本月)</h2>
            <div class="holiday-manager">
              <div class="holiday-add-form">
                <select
                  :disabled="!canManagePhysicianSchedule"
                  v-model="holidayForm.name"
                  class="holiday-input"
                >
                  <option disabled value="">選擇或自訂假日</option>
                  <option
                    v-for="holiday in currentYearHolidays"
                    :key="holiday.date"
                    :value="holiday.name"
                  >
                    {{ holiday.name }} ({{ holiday.date }})
                  </option>
                  <option value="custom">-- 自訂假日 --</option></select
                ><input
                  v-if="holidayForm.name === 'custom'"
                  type="text"
                  v-model="holidayForm.customName"
                  placeholder="輸入假日名稱"
                  class="holiday-input"
                /><input type="date" v-model="holidayForm.date" class="holiday-input" /><button
                  @click="addHoliday"
                  class="add-holiday-btn"
                >
                  新增
                </button>
              </div>
              <ul v-if="managedHolidays.length > 0" class="holiday-list">
                <li v-for="(holiday, index) in managedHolidays" :key="index">
                  <span>{{ holiday.name }} ({{ holiday.date }})</span
                  ><button @click="removeHoliday(index)" class="remove-holiday-btn">×</button>
                </li>
              </ul>
              <p v-else class="no-holidays-text">本月沒有設定國定假日。</p>
            </div>
          </div>
        </div>
        <div class="mobile-panels">
          <div class="panel-group">
            <div class="panel physician-legend-panel">
              <button class="panel-toggle" @click="toggleMobilePanel('physicians')">
                <h2>醫師資訊與門診設定</h2>
                <i class="fas fa-chevron-down"></i>
              </button>
              <div class="panel-content" v-show="activeMobilePanel === 'physicians'">
                <div class="legend-table-wrapper">
                  <table class="legend-table styled-legend">
                    <thead>
                      <tr>
                        <th>醫師</th>
                        <th>員編</th>
                        <th>電話</th>
                      </tr>
                    </thead>
                    <tbody>
                      <template v-for="doc in availablePhysicians" :key="doc.id">
                        <tr class="physician-info-row" :class="getPhysicianClassById(doc.id)">
                          <td class="physician-name-cell">
                            <span class="legend-char">{{ getDisplayName(doc) }}</span
                            >{{ doc.name }}
                          </td>
                          <td>{{ doc.staffId || 'N/A' }}</td>
                          <td>{{ doc.phone || 'N/A' }}</td>
                        </tr>
                        <tr class="clinic-schedule-row" :class="getPhysicianClassById(doc.id)">
                          <td colspan="3">
                            <div class="clinic-select-container">
                              <select
                                :disabled="!canManagePhysicianSchedule"
                                v-if="physicianClinicSelections[doc.id]"
                                v-model="physicianClinicSelections[doc.id][0]"
                                class="clinic-select"
                              >
                                <option value="">門診一</option>
                                <option
                                  v-for="option in clinicOptions"
                                  :key="option.value"
                                  :value="option.value"
                                >
                                  {{ option.text }}
                                </option>
                              </select>
                              <select
                                :disabled="!canManagePhysicianSchedule"
                                v-if="physicianClinicSelections[doc.id]"
                                v-model="physicianClinicSelections[doc.id][1]"
                                class="clinic-select"
                              >
                                <option value="">門診二</option>
                                <option
                                  v-for="option in clinicOptions"
                                  :key="option.value"
                                  :value="option.value"
                                >
                                  {{ option.text }}
                                </option>
                              </select>
                              <select
                                :disabled="!canManagePhysicianSchedule"
                                v-if="physicianClinicSelections[doc.id]"
                                v-model="physicianClinicSelections[doc.id][2]"
                                class="clinic-select"
                              >
                                <option value="">門診三</option>
                                <option
                                  v-for="option in clinicOptions"
                                  :key="option.value"
                                  :value="option.value"
                                >
                                  {{ option.text }}
                                </option>
                              </select>
                              <select
                                :disabled="!canManagePhysicianSchedule"
                                v-if="physicianClinicSelections[doc.id]"
                                v-model="physicianClinicSelections[doc.id][3]"
                                class="clinic-select"
                              >
                                <option value="">門診四</option>
                                <option
                                  v-for="option in clinicOptions"
                                  :key="option.value"
                                  :value="option.value"
                                >
                                  {{ option.text }}
                                </option>
                              </select>
                            </div>
                          </td>
                        </tr>
                      </template>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            <div class="panel pd-clinic-panel">
              <button class="panel-toggle" @click="toggleMobilePanel('pd')">
                <h2>腹膜透析(PD)門診</h2>
                <i class="fas fa-chevron-down"></i>
              </button>
              <div class="panel-content" v-show="activeMobilePanel === 'pd'">
                <div class="pd-clinic-grid">
                  <div
                    v-for="doc in availablePhysicians"
                    :key="`pd-mobile-${doc.id}`"
                    class="pd-clinic-row"
                  >
                    <span class="pd-doctor-name">{{ doc.name }}</span>
                    <div class="pd-input-group">
                      <input
                        type="date"
                        v-if="monthlyPdClinicSelections[doc.id]"
                        v-model="monthlyPdClinicSelections[doc.id][0].date"
                      /><select
                        :disabled="!canManagePhysicianSchedule"
                        v-if="monthlyPdClinicSelections[doc.id]"
                        v-model="monthlyPdClinicSelections[doc.id][0].shift"
                      >
                        <option value="">班別</option>
                        <option value="AM">上午</option>
                        <option value="PM">下午</option>
                        <option value="NT">晚上</option>
                      </select>
                    </div>
                    <div class="pd-input-group">
                      <input
                        type="date"
                        v-if="monthlyPdClinicSelections[doc.id]"
                        v-model="monthlyPdClinicSelections[doc.id][1].date"
                      /><select
                        :disabled="!canManagePhysicianSchedule"
                        v-if="monthlyPdClinicSelections[doc.id]"
                        v-model="monthlyPdClinicSelections[doc.id][1].shift"
                      >
                        <option value="">班別</option>
                        <option value="AM">上午</option>
                        <option value="PM">下午</option>
                        <option value="NT">晚上</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div class="panel statistics-panel">
              <button class="panel-toggle" @click="toggleMobilePanel('stats')">
                <h2>排班統計</h2>
                <i class="fas fa-chevron-down"></i>
              </button>
              <div class="panel-content" v-show="activeMobilePanel === 'stats'">
                <div class="stats-header">
                  <div class="stats-mode-toggle">
                    <button
                      :class="{ active: statsViewMode === 'monthly' }"
                      @click="statsViewMode = 'monthly'"
                    >
                      本月</button
                    ><button
                      :class="{ active: statsViewMode === 'ytd' }"
                      @click="statsViewMode = 'ytd'"
                    >
                      今年累計
                    </button>
                  </div>
                </div>
                <table class="stats-table">
                  <thead v-if="statsViewMode === 'monthly'">
                    <tr>
                      <th>醫師</th>
                      <th>平日班</th>
                      <th>週末班</th>
                    </tr>
                  </thead>
                  <tbody v-if="statsViewMode === 'monthly'">
                    <tr v-for="stat in scheduleStats" :key="stat.name + '-mobile'">
                      <td>{{ stat.name }}</td>
                      <td>{{ stat.monthlyWeekday }}</td>
                      <td :class="{ 'has-multiple-weekends': stat.monthlyWeekend > 1 }">
                        {{ stat.monthlyWeekend }}
                      </td>
                    </tr>
                  </tbody>
                  <thead v-if="statsViewMode === 'ytd'">
                    <tr>
                      <th>醫師</th>
                      <th>總班數</th>
                      <th>假日班</th>
                      <th>週末班</th>
                    </tr>
                  </thead>
                  <tbody v-if="statsViewMode === 'ytd'">
                    <tr v-for="stat in scheduleStats" :key="stat.name + '-mobile-ytd'">
                      <td>{{ stat.name }}</td>
                      <td>{{ stat.ytdTotal }}</td>
                      <td>{{ stat.ytdHolidays }}</td>
                      <td>{{ stat.ytdWeekends }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div class="panel special-dates-panel">
              <button class="panel-toggle" @click="toggleMobilePanel('specialDates')">
                <h2>註記日期</h2>
                <i class="fas fa-chevron-down"></i>
              </button>
              <div class="panel-content" v-show="activeMobilePanel === 'specialDates'">
                <div class="date-input-group">
                  <label>月抽血日：</label><input type="date" v-model="bloodDrawDate1" /><input
                    type="date"
                    v-model="bloodDrawDate2"
                  />
                </div>
                <div class="date-input-group">
                  <label>解釋報告日：</label><input type="date" v-model="reportDate1" /><input
                    type="date"
                    v-model="reportDate2"
                  />
                </div>
              </div>
            </div>
            <div class="panel notes-panel">
              <button class="panel-toggle" @click="toggleMobilePanel('notes')">
                <h2>排班規則與備註</h2>
                <i class="fas fa-chevron-down"></i>
              </button>
              <div class="panel-content" v-show="activeMobilePanel === 'notes'">
                <textarea
                  v-model="scheduleNotes"
                  class="notes-textarea"
                  rows="5"
                  placeholder="請在此輸入排班規則..."
                ></textarea>
              </div>
            </div>
            <div class="panel notes-panel">
              <button class="panel-toggle" @click="toggleMobilePanel('holidays')">
                <h2>國定假日管理 (本月)</h2>
                <i class="fas fa-chevron-down"></i>
              </button>
              <div class="panel-content" v-show="activeMobilePanel === 'holidays'">
                <div class="holiday-manager">
                  <div class="holiday-add-form">
                    <select
                      :disabled="!canManagePhysicianSchedule"
                      v-model="holidayForm.name"
                      class="holiday-input"
                    >
                      <option disabled value="">選擇或自訂假日</option>
                      <option
                        v-for="holiday in currentYearHolidays"
                        :key="holiday.date"
                        :value="holiday.name"
                      >
                        {{ holiday.name }} ({{ holiday.date }})
                      </option>
                      <option value="custom">-- 自訂假日 --</option></select
                    ><input
                      v-if="holidayForm.name === 'custom'"
                      type="text"
                      v-model="holidayForm.customName"
                      placeholder="輸入假日名稱"
                      class="holiday-input"
                    /><input type="date" v-model="holidayForm.date" class="holiday-input" /><button
                      @click="addHoliday"
                      class="add-holiday-btn"
                    >
                      新增
                    </button>
                  </div>
                  <ul v-if="managedHolidays.length > 0" class="holiday-list">
                    <li v-for="(holiday, index) in managedHolidays" :key="index + '-mobile'">
                      <span>{{ holiday.name }} ({{ holiday.date }})</span
                      ><button @click="removeHoliday(index)" class="remove-holiday-btn">×</button>
                    </li>
                  </ul>
                  <p v-else class="no-holidays-text">本月沒有設定國定假日。</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>

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

    <AlertDialog
      :is-visible="isAlertDialogVisible"
      :title="alertDialogTitle"
      :message="alertDialogMessage"
      @confirm="isAlertDialogVisible = false"
    />
    <ConfirmDialog
      :is-visible="isConfirmDialogVisible"
      :title="confirmDialogTitle"
      :message="confirmDialogMessage"
      @confirm="handleConfirm"
      @cancel="handleCancel"
    />
  </div>
</template>

<script setup>
// ✨ Standalone 版本
import { ref, reactive, computed, onMounted, watch, nextTick } from 'vue'
import { useAuth } from '@/composables/useAuth' // ✨ 1. 引入 useAuth
import ApiManager from '@/services/api_manager'
import { systemApi } from '@/services/localApiClient'
import AlertDialog from '@/components/AlertDialog.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { usePatientStore } from '@/stores/patientStore'
import { storeToRefs } from 'pinia'
import * as XLSX from 'xlsx' // ✨ 2. [核心修改] 引入 xlsx 函式庫

// 初始化 Pinia Store
const patientStore = usePatientStore()
const { allPatients } = storeToRefs(patientStore)

// --- API 管理器 ---
const usersApi = ApiManager('users')
const physicianSchedulesApi = ApiManager('physician_schedules')

// --- 頁面狀態 (Refs) ---
const isLoading = ref(true)
const selectedDate = ref(new Date())
const availablePhysicians = ref([])
const scheduleData = ref({}) // 查房班表
const scheduleNotes = ref('')
const hasUnsavedChanges = ref(false)
const physicianClinicSelections = ref({})
const monthlyPdClinicSelections = ref({})
const statsViewMode = ref('monthly')
const yearScheduleData = ref({})
const mobileDisplayMode = ref('day')
const activeMobilePanel = ref('physicians')

const activeTab = ref('dialysis')
const consultationScheduleData = ref({}) // 會診班表
const emergencyRecords = ref([]) // 緊急出勤紀錄
const { canManagePhysicianSchedule } = useAuth()

// 病人搜尋相關狀態
const activeSearch = ref({ type: null, index: -1 })
const patientSearchResults = ref([])
const isAutocompleteVisible = ref(false)
const autocompleteStyle = reactive({ top: '0px', left: '0px', width: '0px' })

// --- 面板資料 (Refs) ---
const bloodDrawDate1 = ref('')
const bloodDrawDate2 = ref('')
const reportDate1 = ref('')
const reportDate2 = ref('')
const managedHolidays = ref([])
const holidayForm = ref({ name: '', customName: '', date: '' })

// --- 對話框狀態 (Refs) ---
const isAlertDialogVisible = ref(false)
const alertDialogTitle = ref('')
const alertDialogMessage = ref('')
const isConfirmDialogVisible = ref(false)
const confirmDialogTitle = ref('')
const confirmDialogMessage = ref('')
const confirmAction = ref(null)
const cancelAction = ref(null)

// --- 假日資料定義 ---
const holidays2025 = [
  { name: '中華民國開國紀念日', date: '2025-01-01' },
  { name: '農曆除夕', date: '2025-01-28' },
  { name: '農曆春節', date: '2025-01-29' },
  { name: '農曆春節', date: '2025-01-30' },
  { name: '農曆春節', date: '2025-01-31' },
  { name: '和平紀念日', date: '2025-02-28' },
  { name: '兒童節', date: '2025-04-04' },
  { name: '民族掃墓節(清明節)', date: '2025-04-05' },
  { name: '端午節', date: '2025-05-31' },
  { name: '中秋節', date: '2025-10-06' },
  { name: '國慶日', date: '2025-10-10' },
]

const holidays2026 = [
  { name: '中華民國開國紀念日', date: '2026-01-01' },
  { name: '農曆除夕', date: '2026-02-16' },
  { name: '農曆春節', date: '2026-02-17' },
  { name: '農曆春節', date: '2026-02-18' },
  { name: '農曆春節', date: '2026-02-19' },
  { name: '農曆春節', date: '2026-02-20' },
  { name: '農曆春節', date: '2026-02-21' },
  { name: '和平紀念日', date: '2026-02-28' },
  { name: '兒童節', date: '2026-04-04' },
  { name: '民族掃墓節(清明節)', date: '2026-04-05' },
  { name: '端午節', date: '2026-06-19' },
  { name: '中秋節', date: '2026-09-25' },
  { name: '國慶日', date: '2026-10-10' },
]

const physicianColorClasses = [
  'physician-color-1',
  'physician-color-2',
  'physician-color-3',
  'physician-color-4',
  'physician-color-5',
]

// ... Computed 屬性 ...
const statusText = computed(() => (hasUnsavedChanges.value ? '有未儲存的變更' : '所有變更已儲存'))
const selectedYear = computed(() => selectedDate.value.getFullYear())
const selectedMonth = computed(() => selectedDate.value.getMonth() + 1)
const selectedYearMonth = computed(
  () => `${selectedYear.value}-${String(selectedMonth.value).padStart(2, '0')}`,
)
const clinicOptions = computed(() => {
  const weekdays = ['一', '二', '三', '四', '五', '六']
  const shifts = { AM: '上', PM: '下', NT: '晚' }
  const options = []
  for (let i = 1; i <= 6; i++) {
    if (i === 6) {
      options.push({ value: `${i}-AM`, text: `週${weekdays[i - 1]}上` })
    } else {
      for (const shiftCode in shifts) {
        options.push({
          value: `${i}-${shiftCode}`,
          text: `週${weekdays[i - 1]}${shifts[shiftCode]}`,
        })
      }
    }
  }
  return options
})
const specialDatesSet = computed(() => {
  const dates = new Set()
  if (bloodDrawDate1.value) dates.add(bloodDrawDate1.value)
  if (bloodDrawDate2.value) dates.add(bloodDrawDate2.value)
  if (reportDate1.value) dates.add(reportDate1.value)
  if (reportDate2.value) dates.add(reportDate2.value)
  return dates
})
const daysInMonth = computed(() => {
  const year = selectedYear.value
  const month = selectedMonth.value - 1
  const date = new Date(year, month, 1)
  const days = []
  while (date.getMonth() === month) {
    const dayOfWeek = date.getDay()
    days.push({ day: date.getDate(), isWeekend: dayOfWeek === 0 || dayOfWeek === 6 })
    date.setDate(date.getDate() + 1)
  }
  return days
})
const weeklyData = computed(() => {
  if (daysInMonth.value.length === 0) return []
  const weeks = []
  const firstDayOfMonth = new Date(selectedYear.value, selectedMonth.value - 1, 1).getDay()
  const startDayOfWeek = (firstDayOfMonth + 6) % 7
  let currentWeek = Array.from({ length: startDayOfWeek }, (_, i) => ({
    day: null,
    placeholderIndex: i,
  }))
  daysInMonth.value.forEach((dayInfo, index) => {
    currentWeek.push({
      ...dayInfo,
      fullDate: `${selectedYear.value}-${String(selectedMonth.value).padStart(2, '0')}-${String(
        dayInfo.day,
      ).padStart(2, '0')}`,
    })
    if (currentWeek.length === 7 || index === daysInMonth.value.length - 1) {
      while (currentWeek.length < 7) {
        currentWeek.push({ day: null, placeholderIndex: currentWeek.length })
      }
      weeks.push(currentWeek)
      currentWeek = []
    }
  })
  return weeks
})
const dailyData = computed(() => weeklyData.value.flat().filter((day) => day.day !== null))
const scheduleStats = computed(() => {
  return availablePhysicians.value.map((doc) => {
    const stats = {
      name: doc.name,
      monthlyWeekday: 0,
      monthlyWeekend: 0,
      ytdTotal: 0,
      ytdHolidays: 0,
      ytdWeekends: 0,
    }
    const currentMonthData = scheduleData.value
    if (Object.keys(currentMonthData).length > 0) {
      daysInMonth.value.forEach((dayInfo) => {
        ;['early', 'noon', 'late'].forEach((shift) => {
          if (currentMonthData[dayInfo.day]?.[shift]?.physicianId === doc.id) {
            if (dayInfo.isWeekend) {
              stats.monthlyWeekend++
            } else {
              stats.monthlyWeekday++
            }
          }
        })
      })
    }
    for (const monthKey in yearScheduleData.value) {
      const monthScheduleData = yearScheduleData.value[monthKey]
      if (!monthScheduleData || !monthScheduleData.schedule) continue
      const {
        schedule: monthSchedule,
        managedHolidays: holidays = [],
        year,
        month: monthNum,
      } = monthScheduleData
      const monthHolidays = new Set(holidays.map((h) => h.date))
      const daysInThisMonth = new Date(year, monthNum, 0).getDate()
      for (let day = 1; day <= daysInThisMonth; day++) {
        const date = new Date(year, monthNum - 1, day)
        const dayOfWeek = date.getDay()
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6
        const dateStr = `${year}-${String(monthNum).padStart(2, '0')}-${String(day).padStart(
          2,
          '0',
        )}`
        const isHoliday = monthHolidays.has(dateStr)
        ;['early', 'noon', 'late'].forEach((shift) => {
          if (monthSchedule[day]?.[shift]?.physicianId === doc.id) {
            stats.ytdTotal++
            if (isHoliday && !isWeekend) {
              stats.ytdHolidays++
            }
            if (isWeekend) {
              stats.ytdWeekends++
            }
          }
        })
      }
    }
    return stats
  })
})
const physicianClassMap = computed(() => {
  const map = new Map()
  availablePhysicians.value.forEach((doc, index) => {
    map.set(doc.id, physicianColorClasses[index % physicianColorClasses.length])
  })
  return map
})

const currentYearHolidays = computed(() => {
  switch (selectedYear.value) {
    case 2025:
      return holidays2025
    case 2026:
      return holidays2026
    default:
      return []
  }
})

// --- Methods (方法) ---
function handlePatientSearch(index, type) {
  if (type !== 'emergency') return
  const query = emergencyRecords.value[index].patientName.toLowerCase()
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
  if (type === 'emergency') {
    const record = emergencyRecords.value[index]
    record.patientId = patient.id
    record.patientName = patient.name
    record.medicalRecordNumber = patient.medicalRecordNumber
  }
  isAutocompleteVisible.value = false
}

async function loadScheduleForDate(date) {
  isLoading.value = true
  hasUnsavedChanges.value = false
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const yearMonth = `${year}-${String(month).padStart(2, '0')}`

  try {
    await fetchAllYearSchedules(year, month)
    const existingSchedule = await physicianSchedulesApi.fetchById(yearMonth)

    scheduleData.value = generateBlankSchedule(year, month, availablePhysicians.value)
    consultationScheduleData.value = generateBlankConsultationSchedule(
      year,
      month,
      availablePhysicians.value,
    )
    emergencyRecords.value = []

    const pdSelections = {}
    availablePhysicians.value.forEach((doc) => {
      pdSelections[doc.id] = [
        { date: '', shift: '' },
        { date: '', shift: '' },
      ]
    })

    if (existingSchedule) {
      if (existingSchedule.schedule) {
        for (const day in existingSchedule.schedule) {
          if (scheduleData.value[day]) {
            Object.assign(scheduleData.value[day], existingSchedule.schedule[day])
          }
        }
      }
      if (existingSchedule.consultationSchedule) {
        for (const day in existingSchedule.consultationSchedule) {
          if (consultationScheduleData.value[day]) {
            Object.assign(
              consultationScheduleData.value[day],
              existingSchedule.consultationSchedule[day],
            )
          }
        }
      }
      if (Array.isArray(existingSchedule.emergencyRecords)) {
        emergencyRecords.value = existingSchedule.emergencyRecords
      }
      scheduleNotes.value = existingSchedule.notes || ''
      const dates = existingSchedule.specialDates || {}
      bloodDrawDate1.value = dates.bloodDraw1 || ''
      bloodDrawDate2.value = dates.bloodDraw2 || ''
      reportDate1.value = dates.report1 || ''
      reportDate2.value = dates.report2 || ''
      managedHolidays.value = existingSchedule.managedHolidays || []
      if (existingSchedule.pdClinicHours) {
        for (const docId in existingSchedule.pdClinicHours) {
          if (pdSelections[docId]) {
            const savedPd = existingSchedule.pdClinicHours[docId]
            pdSelections[docId] = [
              savedPd[0] || { date: '', shift: '' },
              savedPd[1] || { date: '', shift: '' },
            ]
          }
        }
      }
    } else {
      scheduleNotes.value = ''
      bloodDrawDate1.value = ''
      bloodDrawDate2.value = ''
      reportDate1.value = ''
      reportDate2.value = ''
      managedHolidays.value = []
    }
    monthlyPdClinicSelections.value = pdSelections
  } catch (error) {
    console.error(`讀取 ${yearMonth} 班表失敗:`, error)
    showAlert('讀取失敗', `讀取 ${yearMonth} 班表時發生錯誤。`)
    scheduleData.value = {}
    consultationScheduleData.value = {}
    emergencyRecords.value = []
  } finally {
    isLoading.value = false
    nextTick(() => {
      hasUnsavedChanges.value = false
    })
  }
}

function addEmergencyRecord() {
  const today = new Date()
  const year = selectedYear.value
  const month = selectedMonth.value - 1
  const defaultDate =
    today.getFullYear() === year && today.getMonth() === month
      ? today.toISOString().slice(0, 10)
      : new Date(year, month, 1).toISOString().slice(0, 10)

  emergencyRecords.value.push({
    patientId: null,
    date: defaultDate,
    patientName: '',
    medicalRecordNumber: '',
    reason: '緊急透析',
    startTime: '00:00',
    endTime: '00:00',
    physicianId: null,
  })
}

function removeEmergencyRecord(index) {
  emergencyRecords.value.splice(index, 1)
}

function saveScheduleOnly() {
  const physicianMap = new Map(availablePhysicians.value.map((p) => [p.id, p.name]))
  const dataToSave = {
    year: selectedYear.value,
    month: selectedMonth.value,
    schedule: {},
    consultationSchedule: {},
    emergencyRecords: emergencyRecords.value.filter(
      (r) => r.date && r.reason && r.startTime && r.endTime && r.physicianId,
    ),
    notes: scheduleNotes.value,
    specialDates: {
      bloodDraw1: bloodDrawDate1.value,
      bloodDraw2: bloodDrawDate2.value,
      report1: reportDate1.value,
      report2: reportDate2.value,
    },
    pdClinicHours: {},
    managedHolidays: managedHolidays.value,
  }
  for (const docId in monthlyPdClinicSelections.value) {
    const validPdHours = monthlyPdClinicSelections.value[docId].filter((pd) => pd.date && pd.shift)
    if (validPdHours.length > 0) {
      dataToSave.pdClinicHours[docId] = validPdHours
    }
  }
  for (const day in scheduleData.value) {
    if (typeof scheduleData.value[day] !== 'object' || scheduleData.value[day] === null) continue
    dataToSave.schedule[day] = {}
    for (const shift of ['early', 'noon', 'late']) {
      const physicianId = scheduleData.value[day][shift]?.physicianId || null
      dataToSave.schedule[day][shift] = {
        physicianId: physicianId,
        name: physicianMap.get(physicianId) || null,
      }
    }
  }
  for (const day in consultationScheduleData.value) {
    if (
      typeof consultationScheduleData.value[day] !== 'object' ||
      consultationScheduleData.value[day] === null
    )
      continue
    dataToSave.consultationSchedule[day] = {}
    for (const shift of ['morning', 'afternoon', 'night']) {
      const physicianId = consultationScheduleData.value[day][shift]?.physicianId || null
      dataToSave.consultationSchedule[day][shift] = {
        physicianId: physicianId,
        name: physicianMap.get(physicianId) || null,
      }
    }
  }
  return physicianSchedulesApi.save(selectedYearMonth.value, dataToSave)
}

async function fetchPhysicians() {
  try {
    // 使用 systemApi.fetchPhysicians() 從 physicians 表讀取
    const physicians = await systemApi.fetchPhysicians()
    console.log('[PhysicianSchedule] 從 API 取得的醫師資料:', physicians.map(p => ({
      id: p.id,
      name: p.name,
      defaultSchedules: p.defaultSchedules,
      defaultConsultationSchedules: p.defaultConsultationSchedules
    })))
    const desiredOrder = ['廖丁瑩', '蔡宜潔', '蘇哲弘', '蔡亨政', '林天佑']
    physicians.sort((a, b) => {
      const indexA = desiredOrder.indexOf(a.name)
      const indexB = desiredOrder.indexOf(b.name)
      if (indexA !== -1 && indexB !== -1) return indexA - indexB
      if (indexA !== -1) return -1
      if (indexB !== -1) return 1
      return a.name.localeCompare(b.name, 'zh-Hant')
    })
    const clinicSelections = {}
    physicians.forEach((doc) => {
      const hours = Array.isArray(doc.clinicHours) ? doc.clinicHours : []
      clinicSelections[doc.id] = [hours[0] || '', hours[1] || '', hours[2] || '', hours[3] || '']
    })
    physicianClinicSelections.value = clinicSelections
    availablePhysicians.value = physicians
  } catch (error) {
    console.error('讀取主治醫師列表失敗:', error)
    showAlert('錯誤', '無法讀取主治醫師資料。')
  }
}

function generateBlankSchedule(year, month, physicians) {
  console.log('[PhysicianSchedule] generateBlankSchedule 收到的醫師:', physicians.map(p => ({
    name: p.name,
    defaultSchedules: p.defaultSchedules
  })))
  const blankSchedule = {}
  const daysCount = new Date(year, month, 0).getDate()
  for (let i = 1; i <= daysCount; i++) {
    blankSchedule[i] = {
      early: { physicianId: null, name: null },
      noon: { physicianId: null, name: null },
      late: { physicianId: null, name: null },
    }
  }
  physicians.forEach((physician) => {
    if (Array.isArray(physician.defaultSchedules) && physician.defaultSchedules.length > 0) {
      console.log(`[PhysicianSchedule] 套用 ${physician.name} 的預設班表:`, physician.defaultSchedules)
      physician.defaultSchedules.forEach((rule) => {
        const [ruleDayOfWeek, ruleShift] = rule.split('-')
        for (let day = 1; day <= daysCount; day++) {
          const date = new Date(year, month - 1, day)
          if (date.getDay() == ruleDayOfWeek) {
            if (blankSchedule[day] && blankSchedule[day][ruleShift]) {
              blankSchedule[day][ruleShift] = { physicianId: physician.id, name: physician.name }
            }
          }
        }
      })
    }
  })
  return blankSchedule
}

function generateBlankConsultationSchedule(year, month, physicians) {
  const blankSchedule = {}
  const daysCount = new Date(year, month, 0).getDate()
  for (let i = 1; i <= daysCount; i++) {
    blankSchedule[i] = {
      morning: { physicianId: null, name: null },
      afternoon: { physicianId: null, name: null },
      night: { physicianId: null, name: null },
    }
  }
  physicians.forEach((physician) => {
    if (
      Array.isArray(physician.defaultConsultationSchedules) &&
      physician.defaultConsultationSchedules.length > 0
    ) {
      physician.defaultConsultationSchedules.forEach((rule) => {
        const [ruleDayOfWeek, ruleShift] = rule.split('-')
        for (let day = 1; day <= daysCount; day++) {
          const date = new Date(year, month - 1, day)
          if (date.getDay() == ruleDayOfWeek) {
            if (blankSchedule[day] && blankSchedule[day][ruleShift]) {
              blankSchedule[day][ruleShift] = { physicianId: physician.id, name: physician.name }
            }
          }
        }
      })
    }
  })
  return blankSchedule
}

async function saveAllChanges() {
  isLoading.value = true
  const schedulePromise = saveScheduleOnly()
  const clinicUpdatePromises = availablePhysicians.value.map((doc) => {
    const selectedHours = physicianClinicSelections.value[doc.id] || []
    const newClinicHours = selectedHours.filter((hour) => hour)
    if ((doc.clinicHours || []).sort().join(',') !== [...newClinicHours].sort().join(',')) {
      return usersApi.update(doc.id, { clinicHours: newClinicHours })
    }
    return Promise.resolve()
  })
  try {
    await Promise.all([...clinicUpdatePromises, schedulePromise])
    await fetchPhysicians()
    await loadScheduleForDate(selectedDate.value)
    hasUnsavedChanges.value = false
    showAlert('儲存成功', `所有變更已成功儲存！`)
  } catch (error) {
    console.error('儲存所有變更失敗:', error)
    showAlert('儲存失敗', '儲存時發生錯誤。')
  } finally {
    isLoading.value = false
  }
}

function addHoliday() {
  const name =
    holidayForm.value.name === 'custom' ? holidayForm.value.customName : holidayForm.value.name
  const date = holidayForm.value.date
  if (!name || !date) {
    showAlert('輸入不完整', '請提供完整的假日名稱和日期。')
    return
  }
  if (managedHolidays.value.some((h) => h.date === date)) {
    showAlert('日期重複', '這個日期已經被設定為假日了。')
    return
  }
  managedHolidays.value.push({ name, date })
  managedHolidays.value.sort((a, b) => a.date.localeCompare(b.date))
  holidayForm.value = { name: '', customName: '', date: '' }
}

function removeHoliday(index) {
  managedHolidays.value.splice(index, 1)
}

function checkClinicConflict(event, day, shift) {
  const newPhysicianId = event.target.value
  if (!newPhysicianId) return
  const physician = availablePhysicians.value.find((p) => p.id === newPhysicianId)
  if (!physician) return
  const date = new Date(selectedYear.value, selectedMonth.value - 1, day.day)
  const dayOfWeek = date.getDay()
  const dateStr = `${selectedYear.value}-${String(selectedMonth.value).padStart(2, '0')}-${String(
    day.day,
  ).padStart(2, '0')}`
  const shiftToCodeMapping = {
    early: 'AM',
    noon: 'PM',
    late: 'NT',
    morning: 'AM',
    afternoon: 'PM',
    night: 'NT',
  }
  const currentShiftCode = shiftToCodeMapping[shift]
  let conflictType = null
  const regularConflictCode = `${dayOfWeek === 0 ? 7 : dayOfWeek}-${currentShiftCode}`
  if ((physicianClinicSelections.value[newPhysicianId] || []).includes(regularConflictCode)) {
    conflictType = '常規門診'
  }
  if (
    (monthlyPdClinicSelections.value[newPhysicianId] || []).some(
      (pd) => pd.date === dateStr && pd.shift === currentShiftCode,
    )
  ) {
    conflictType = 'PD 門診'
  }
  if (conflictType) {
    const targetSchedule =
      activeTab.value === 'dialysis' ? scheduleData.value : consultationScheduleData.value
    const originalPhysicianId = targetSchedule[day.day][shift].physicianId
    confirmDialogTitle.value = '門診時間衝突'
    confirmDialogMessage.value = `提醒：${physician.name} 醫師在該時段有${conflictType}，您確定要排此班嗎？`
    confirmAction.value = () => {
      isConfirmDialogVisible.value = false
    }
    cancelAction.value = () => {
      targetSchedule[day.day][shift].physicianId = originalPhysicianId
      event.target.value = originalPhysicianId
      isConfirmDialogVisible.value = false
    }
    isConfirmDialogVisible.value = true
  }
}

function getDisplayName(physician) {
  return physician.name === '蔡亨政' ? '政' : physician.name.charAt(0)
}

function getPhysicianClassById(physicianId) {
  return physicianId ? physicianClassMap.value.get(physicianId) : ''
}

function getPhysicianClass(day, shift, scheduleType = 'dialysis') {
  if (!day || !day.day) return ''
  const targetSchedule =
    scheduleType === 'dialysis' ? scheduleData.value : consultationScheduleData.value
  const physicianId = targetSchedule[day.day]?.[shift]?.physicianId
  return getPhysicianClassById(physicianId)
}

function getDayClass(day) {
  if (!day || !day.day) return 'is-empty'
  const dateStr = `${selectedYear.value}-${String(selectedMonth.value).padStart(2, '0')}-${String(
    day.day,
  ).padStart(2, '0')}`
  if (specialDatesSet.value.has(dateStr)) return 'is-special-date'
  if (managedHolidays.value.some((h) => h.date === dateStr)) return 'is-holiday'
  if (day.isWeekend) return 'is-weekend'
  return 'is-weekday'
}

function getShiftCellClass(day) {
  if (!day || !day.day) return 'is-empty'
  const dateStr = `${selectedYear.value}-${String(selectedMonth.value).padStart(2, '0')}-${String(
    day.day,
  ).padStart(2, '0')}`
  if (managedHolidays.value.some((h) => h.date === dateStr)) return 'is-holiday-text-only'
  if (day.isWeekend) return 'is-weekend-text-only'
  return ''
}

async function fetchAllYearSchedules(year, endMonth) {
  try {
    // Standalone 模式：取得所有排班後在前端過濾
    const allSchedules = await physicianSchedulesApi.fetchAll()
    const data = {}
    allSchedules.forEach((doc) => {
      // 從 id 解析 year 和 month (格式: YYYY-MM)
      const [docYear, docMonth] = doc.id.split('-').map(Number)
      if (docYear === year && docMonth <= endMonth) {
        data[doc.id] = doc
      }
    })
    yearScheduleData.value = data
  } catch (error) {
    console.error(`獲取 ${year} 年排班資料失敗:`, error)
    throw new Error(`獲取 ${year} 年的年度排班資料時發生錯誤。`)
  }
}

async function loadAllData() {
  isLoading.value = true
  try {
    await fetchPhysicians()
    await loadScheduleForDate(selectedDate.value)
  } catch (error) {
    console.error('初始化載入失敗:', error)
    showAlert('初始化失敗', '載入頁面所需資料時發生錯誤，請重新整理。')
  } finally {
    isLoading.value = false
  }
}

function goToPreviousMonth() {
  const performNavigation = () => {
    selectedDate.value = new Date(selectedDate.value.setMonth(selectedDate.value.getMonth() - 1))
  }
  if (hasUnsavedChanges.value) {
    confirmDialogTitle.value = '未儲存的變更'
    confirmDialogMessage.value = '您有未儲存的變更，確定要離開嗎？'
    confirmAction.value = performNavigation
    cancelAction.value = null
    isConfirmDialogVisible.value = true
  } else {
    performNavigation()
  }
}

function goToNextMonth() {
  const performNavigation = () => {
    selectedDate.value = new Date(selectedDate.value.setMonth(selectedDate.value.getMonth() + 1))
  }
  if (hasUnsavedChanges.value) {
    confirmDialogTitle.value = '未儲存的變更'
    confirmDialogMessage.value = '您有未儲存的變更，確定要離開嗎？'
    confirmAction.value = performNavigation
    cancelAction.value = null
    isConfirmDialogVisible.value = true
  } else {
    performNavigation()
  }
}

function handleConfirm() {
  if (typeof confirmAction.value === 'function') {
    confirmAction.value()
  }
  resetConfirmDialog()
}

function handleCancel() {
  if (typeof cancelAction.value === 'function') {
    cancelAction.value()
  }
  resetConfirmDialog()
}

function resetConfirmDialog() {
  isConfirmDialogVisible.value = false
  confirmDialogTitle.value = ''
  confirmDialogMessage.value = ''
  confirmAction.value = null
  cancelAction.value = null
}

function showAlert(title, message) {
  alertDialogTitle.value = title
  alertDialogMessage.value = message
  isAlertDialogVisible.value = true
}

function getWeekday(dateString) {
  const date = new Date(dateString)
  return new Intl.DateTimeFormat('zh-TW', { weekday: 'long' }).format(date)
}

function getPhysicianDisplayName(day, shift, scheduleType = 'dialysis') {
  if (!day || !day.day) return '--'
  const targetSchedule =
    scheduleType === 'dialysis' ? scheduleData.value : consultationScheduleData.value
  const physicianId = targetSchedule[day.day]?.[shift]?.physicianId
  if (physicianId) {
    const physician = availablePhysicians.value.find((doc) => doc.id === physicianId)
    return physician ? getDisplayName(physician) : '--'
  }
  return '--'
}

function toggleMobilePanel(panelName) {
  if (activeMobilePanel.value === panelName) {
    activeMobilePanel.value = null
  } else {
    activeMobilePanel.value = panelName
  }
}

// ✨ 2. [核心修改] 新增 Excel 匯出函式
function exportEmergencyRecords() {
  if (emergencyRecords.value.length === 0) {
    showAlert('提示', '沒有緊急出勤紀錄可供匯出。')
    return
  }

  // --- 1. 準備資料 ---
  const aoa = []
  const title = `${selectedMonth.value}月 腎臟科醫師緊急出勤名單`
  const headerRow = ['日期', '病人姓名', '病歷號', '出勤原因', '起(時分)', '迄(時分)', '出勤醫師']

  aoa.push([title])
  aoa.push(headerRow)

  const sortedRecords = [...emergencyRecords.value].sort((a, b) => a.date.localeCompare(b.date))
  sortedRecords.forEach((r) => {
    aoa.push([
      r.date,
      r.patientName,
      r.medicalRecordNumber,
      r.reason,
      r.startTime,
      r.endTime,
      getPhysicianNameById(r.physicianId),
    ])
  })

  // --- 2. 建立工作表 ---
  const ws = XLSX.utils.aoa_to_sheet(aoa)

  // --- 3. (✨ 核心修正 ✨) 定義樣式物件 ---
  const titleStyle = {
    font: { sz: 16, bold: true },
    alignment: { horizontal: 'center', vertical: 'center' },
  }
  const headerStyle = {
    font: { bold: true },
    alignment: { horizontal: 'center', vertical: 'center' },
    fill: { fgColor: { rgb: 'F0F0F0' } }, // 淺灰色背景
  }
  const centerCellStyle = {
    alignment: { horizontal: 'center', vertical: 'center' },
  }
  const reasonCellStyle = {
    // 為"出勤原因"欄位特別設定
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  }

  // --- 4. (✨ 核心修正 ✨) 遍歷並套用樣式 ---
  const range = XLSX.utils.decode_range(ws['!ref'])
  for (let R = range.s.r; R <= range.e.r; ++R) {
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const cell_ref = XLSX.utils.encode_cell({ c: C, r: R })
      if (!ws[cell_ref]) continue

      if (R === 0) {
        // 標題列
        ws[cell_ref].s = titleStyle
      } else if (R === 1) {
        // 標頭列
        ws[cell_ref].s = headerStyle
      } else {
        // 資料列
        // 判斷是否為 "出勤原因" 欄 (索引為 3)
        if (C === 3) {
          ws[cell_ref].s = reasonCellStyle
        } else {
          ws[cell_ref].s = centerCellStyle
        }
      }
    }
  }

  // --- 5. 合併標題列儲存格 ---
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: headerRow.length - 1 } }]

  // --- 6. 設定欄位寬度 ---
  ws['!cols'] = [
    { wch: 15 }, // 日期
    { wch: 15 }, // 病人姓名
    { wch: 12 }, // 病歷號
    { wch: 35 }, // 出勤原因 (加寬)
    { wch: 15 }, // 起始時間
    { wch: 15 }, // 結束時間
    { wch: 15 }, // 出勤醫師
  ]

  // --- 7. 建立工作簿並下載 ---
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '緊急出勤紀錄')
  XLSX.writeFile(wb, `醫師緊急出勤紀錄_${selectedYear.value}-${selectedMonth.value}.xlsx`)
}

// ✨ 3. [核心修改] 新增一個輔助函式，用於在行動版卡片上顯示醫師姓名
function getPhysicianNameById(physicianId) {
  if (!physicianId) return '未指定'
  const physician = availablePhysicians.value.find((p) => p.id === physicianId)
  return physician ? physician.name : '未知醫師'
}

onMounted(async () => {
  isLoading.value = true
  try {
    // 確保病人資料先被載入
    await patientStore.fetchPatientsIfNeeded()
    // 然後再載入所有班表相關資料
    await loadAllData()
  } catch (error) {
    console.error('頁面初始化失敗:', error)
    showAlert('初始化失敗', '載入頁面所需資料時發生錯誤，請重新整理。')
  } finally {
    isLoading.value = false
  }
})

watch(selectedYearMonth, (newVal, oldVal) => {
  if (newVal !== oldVal) {
    loadScheduleForDate(selectedDate.value)
  }
})

watch(
  () => holidayForm.value.name,
  (newName) => {
    if (newName && newName !== 'custom') {
      const found = currentYearHolidays.value.find((h) => h.name === newName)
      if (found) {
        holidayForm.value.date = found.date
      }
    }
  },
)

watch(
  emergencyRecords,
  () => {
    if (!isLoading.value) hasUnsavedChanges.value = true
  },
  { deep: true },
)
watch(
  scheduleData,
  (newValue, oldValue) => {
    if (!isLoading.value && Object.keys(oldValue).length > 0) hasUnsavedChanges.value = true
  },
  { deep: true },
)
watch(
  consultationScheduleData,
  (newValue, oldValue) => {
    if (!isLoading.value && Object.keys(oldValue).length > 0) hasUnsavedChanges.value = true
  },
  { deep: true },
)
watch(scheduleNotes, () => {
  if (!isLoading.value) hasUnsavedChanges.value = true
})
watch(bloodDrawDate1, () => {
  if (!isLoading.value) hasUnsavedChanges.value = true
})
watch(bloodDrawDate2, () => {
  if (!isLoading.value) hasUnsavedChanges.value = true
})
watch(reportDate1, () => {
  if (!isLoading.value) hasUnsavedChanges.value = true
})
watch(reportDate2, () => {
  if (!isLoading.value) hasUnsavedChanges.value = true
})
watch(
  physicianClinicSelections,
  () => {
    if (!isLoading.value) hasUnsavedChanges.value = true
  },
  { deep: true },
)
watch(
  monthlyPdClinicSelections,
  () => {
    if (!isLoading.value) hasUnsavedChanges.value = true
  },
  { deep: true },
)
watch(
  managedHolidays,
  () => {
    if (!isLoading.value) hasUnsavedChanges.value = true
  },
  { deep: true },
)
</script>

<style scoped>
@import url('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.4/css/all.min.css');
:root {
  --panel-border-color: #dee2e6;
}

/* =================================== */
/*        緊急出勤頁籤專屬樣式         */
/* =================================== */

/* 1. 調整桌面版表格欄位寬度 */
.emergency-table .col-emergency-date {
  width: 12%;
  min-width: 140px;
}
.emergency-table .col-emergency-name {
  width: 12%;
  min-width: 130px;
}
.emergency-table .col-emergency-mrn {
  width: 10%;
  min-width: 100px;
}
.emergency-table .col-emergency-reason {
  width: auto;
  min-width: 180px;
} /* 自動擴展 */
.emergency-table .col-emergency-time {
  width: 10%;
  min-width: 110px;
}
.emergency-table .col-emergency-physician {
  width: 12%;
  min-width: 120px;
}
.emergency-table .col-emergency-actions {
  width: 8%;
  min-width: 60px;
}

/* 2. 緊急出勤頁籤的 Toolbar (桌面版與行動版) */
.emergency-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 1rem;
}
.emergency-toolbar-mobile {
  display: flex;
  justify-content: space-between;
  margin-bottom: 1rem;
}

/* 通用按鈕樣式 (給匯出、新增按鈕使用) */
.btn {
  padding: 0.5rem 1rem;
  border-radius: 5px;
  border: 1px solid transparent;
  cursor: pointer;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  transition: background-color 0.2s;
}
.btn-primary {
  background-color: #007bff;
  color: white;
  border-color: #007bff;
}
.btn-primary:hover {
  background-color: #0056b3;
}
.btn-secondary {
  background-color: #6c757d;
  color: white;
  border-color: #6c757d;
}
.btn-secondary:hover {
  background-color: #5a6268;
}

/* 3. 新增緊急出勤行動版卡片樣式 */
.mobile-emergency-card {
  background-color: #fff;
  border: 1px solid #dee2e6;
  border-radius: 6px;
  margin-bottom: 0.75rem;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}
.mobile-emergency-card .card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 0.75rem;
  background-color: #f8f9fa;
  border-bottom: 1px solid #e9ecef;
}
.mobile-emergency-card .header-info {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.mobile-emergency-card .card-date {
  font-weight: bold;
}
.mobile-emergency-card .card-physician {
  font-size: 0.9rem;
  font-weight: 500;
  color: #007bff;
}
.mobile-emergency-card .card-body {
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.mobile-emergency-card .info-row {
  display: flex;
  gap: 0.5rem;
  font-size: 0.95rem;
}
.mobile-emergency-card .info-row .label {
  font-weight: 500;
  color: #6c757d;
  flex-shrink: 0;
}
.mobile-emergency-card .info-row.reason {
  flex-direction: column;
  align-items: flex-start;
  gap: 0.25rem;
}
.mobile-emergency-card .info-row.reason p {
  margin: 0;
  padding-left: 0.5rem;
  border-left: 2px solid #e9ecef;
  word-break: break-all;
}
.no-data-text {
  color: #6c757d;
  font-style: italic;
  padding: 2rem 0;
  text-align: center;
}
.emergency-container {
  padding: 1.5rem;
}
.emergency-description {
  margin-top: 0;
  margin-bottom: 1.5rem;
  font-size: 1rem;
  color: #6c757d;
  background-color: #f8f9fa;
  border-left: 4px solid #17a2b8;
  padding: 1rem;
  border-radius: 4px;
}
.emergency-table-wrapper {
  overflow-x: auto;
  margin-bottom: 1rem;
}
.emergency-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 950px; /* 確保在小螢幕上可以滾動 */
}
.emergency-table th,
.emergency-table td {
  border: 1px solid #dee2e6;
  padding: 0.5rem;
  text-align: center;
  vertical-align: middle;
}
.emergency-table th {
  background-color: #e9ecef;
}
.emergency-input {
  width: 100%;
  padding: 0.375rem 0.75rem;
  font-size: 1rem;
  border: 1px solid #ced4da;
  border-radius: 4px;
  box-sizing: border-box;
}
.emergency-table select.emergency-input {
  text-align: center;
}
.btn-add-row {
  padding: 0.5rem 1rem;
  background-color: #007bff;
  color: white;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}
.btn-add-row:hover {
  background-color: #0056b3;
}
.btn-icon.btn-delete {
  color: #dc3545;
}

/* 自動完成選單的樣式 */
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
.emergency-table .autocomplete-wrapper .emergency-input {
  width: 100%;
}

/* =================================== */
/*             通用佈局與元件             */
/* =================================== */
.page-container {
  padding: 0.5rem;
  background-color: #f8f9fa;
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
  padding-bottom: 1rem;
  border-bottom: 2px solid #dee2e6;
  flex-shrink: 0;
}
.header-left,
.header-right {
  display: flex;
  align-items: center;
  gap: 1.5rem;
}
.page-main-title {
  font-size: 2rem;
  margin: 0;
  color: #343a40;
}
.month-navigator {
  display: flex;
  align-items: center;
  gap: 1rem;
}
.month-navigator button {
  background: none;
  border: 1px solid #ced4da;
  border-radius: 50%;
  width: 36px;
  height: 36px;
  cursor: pointer;
  font-size: 1.2rem;
  transition: background-color 0.2s;
}
.month-navigator button:hover {
  background-color: #e9ecef;
}
.month-display {
  font-size: 1.5rem;
  font-weight: bold;
  color: #495057;
}
.status-indicator {
  font-style: italic;
  font-weight: 500;
  color: #28a745;
  transition: color 0.3s ease;
}
.status-indicator.has-changes {
  color: #dc3545;
}
.save-btn {
  padding: 0.6rem 1.2rem;
  background-color: #28a745;
  color: white;
  border: 1px solid #28a745;
  border-radius: 6px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 500;
  transition: all 0.2s;
}
.save-btn:hover:not(:disabled) {
  background-color: #218838;
  border-color: #1e7e34;
}
.save-btn:disabled {
  background-color: #6c757d;
  border-color: #6c757d;
  cursor: not-allowed;
  opacity: 0.7;
}
.tabs-container {
  display: flex;
  align-items: flex-end;
  gap: 0.25rem;
  margin-bottom: -1px;
  padding-left: 1rem;
  flex-shrink: 0;
}
.tabs-left {
  display: flex;
}
.tab-link {
  padding: 0.75rem 1.5rem;
  font-size: 1.1rem;
  font-weight: 500;
  cursor: pointer;
  text-decoration: none;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: 8px 8px 0 0;
  transition: all 0.2s ease-in-out;
  background-color: #e9ecef;
  color: #6c757d;
  border-color: #dee2e6;
}
.tab-link:hover {
  background-color: #f8f9fa;
  color: #0056b3;
}
.tab-link.active {
  background-color: #fff;
  color: #0056b3;
  font-weight: 600;
  border-color: #dee2e6;
  border-bottom: 1px solid #fff;
  z-index: 2;
}
.schedule-content.new-layout {
  flex-grow: 1;
  min-height: 0;
  display: flex;
  gap: 1.5rem;
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
.schedule-grid-container {
  flex: 2.5;
  min-width: 0;
  background-color: #fff;
  border: 1px solid #dee2e6;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  overflow: auto;
  border-top-left-radius: 0;
}
.panels-container {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  padding-right: 8px;
}
.schedule-table.weekly-grid {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
.schedule-table th,
.schedule-table td {
  border: 1px solid #dee2e6;
  text-align: center;
  vertical-align: middle;
  height: 50px;
}
.schedule-table thead th {
  background-color: #f8f9fa;
  font-size: 1.1rem;
  padding: 0.75rem 0.5rem;
  position: sticky;
  top: 0;
  z-index: 10;
  width: 12.5%;
}
.schedule-table thead th.weekend {
  color: #dc3545;
}
.schedule-table thead th:not(.shift-header-cell) {
  min-width: 80px;
}
.shift-header-cell {
  background-color: #f8f9fa;
  font-weight: bold;
  width: 80px !important;
  position: sticky;
  left: 0;
  z-index: 5;
}
tbody {
  border-top: 3px solid #007bff;
}
tbody:first-of-type {
  border-top: none;
}
tr.date-row {
  background-color: #e9ecef;
}
.cell-day {
  font-weight: bold;
  font-size: 1.2rem;
}
.cell-day span {
  display: inline-block;
  min-width: 50px;
}
.physician-select {
  width: 100%;
  height: 100%;
  border: none;
  background: transparent;
  text-align: center;
  font-size: 1.5rem;
  font-weight: bold;
  -webkit-appearance: none;
  -moz-appearance: none;
  appearance: none;
  cursor: pointer;
  color: inherit;
}
.physician-select:focus {
  outline: none;
  box-shadow: none;
}
.physician-select:focus-within {
  background-color: rgba(0, 123, 255, 0.05);
}
.desktop-panels {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}
.desktop-panels > div {
  background-color: #fff;
  padding: 1rem;
  border-radius: 8px;
  border: 1px solid #dee2e6;
  flex-shrink: 0;
}
.desktop-panels h2 {
  margin-top: 0;
  font-size: 1.2rem;
  margin-bottom: 1rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid #e9ecef;
}
.legend-table-wrapper {
  overflow-x: auto;
}
.legend-table.styled-legend {
  border-spacing: 0;
  border-collapse: separate;
  border: 1px solid #dee2e6;
  border-radius: 6px;
  width: 100%;
}
.legend-table.styled-legend thead th {
  border-bottom-width: 2px;
}
.legend-table.styled-legend tbody tr:not(:last-child) td {
  border-bottom: 1px solid #e9ecef;
}
.legend-table.styled-legend td,
.legend-table.styled-legend th {
  border: none;
  vertical-align: middle;
  padding: 0.75rem;
  text-align: center;
}
.legend-table.styled-legend td:not(:last-child),
.legend-table.styled-legend th:not(:last-child) {
  border-right: 1px solid #e9ecef;
}
.legend-table.styled-legend th {
  background-color: #f8f9fa;
}
.physician-info-row td {
  background-color: #fdfdff;
}
.physician-name-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: bold;
}
.legend-char {
  font-size: 1.5rem;
}
.clinic-schedule-row td {
  padding: 8px !important;
}
.clinic-select-container {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  align-items: center;
}
.clinic-select {
  flex: 1;
  min-width: 90px;
  padding: 6px 4px;
  border: 1px solid #ced4da;
  border-radius: 4px;
  background-color: #fff;
  font-size: 0.85rem;
  cursor: pointer;
}
.clinic-select:focus {
  border-color: #80bdff;
  outline: 0;
  box-shadow: 0 0 0 0.2rem rgba(0, 123, 255, 0.25);
}
.stats-table {
  width: 100%;
  border-collapse: collapse;
}
.stats-table th,
.stats-table td {
  border: 1px solid #e9ecef;
  padding: 0.75rem;
  text-align: center;
}
.stats-table th {
  background-color: #f8f9fa;
}
.stats-table .has-multiple-weekends {
  font-weight: bold;
  color: #dc3545;
  font-size: 1.2em;
}
.stats-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.stats-mode-toggle {
  display: flex;
  border: 1px solid #ced4da;
  border-radius: 6px;
  overflow: hidden;
}
.stats-mode-toggle button {
  background-color: #fff;
  border: none;
  padding: 4px 12px;
  cursor: pointer;
  transition: background-color 0.2s;
}
.stats-mode-toggle button.active {
  background-color: #007bff;
  color: white;
}
.notes-textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 0.75rem;
  border: 1px solid #ced4da;
  border-radius: 6px;
  font-size: 1rem;
  line-height: 1.6;
  resize: vertical;
}
.special-dates-panel .date-input-group {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}
.special-dates-panel label {
  font-weight: 500;
  white-space: nowrap;
}
.special-dates-panel input[type='date'] {
  padding: 0.5rem;
  border: 1px solid #ced4da;
  border-radius: 4px;
  flex-grow: 1;
}
.pd-clinic-grid {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.pd-clinic-row {
  display: grid;
  grid-template-columns: 80px 1fr 1fr;
  gap: 8px;
  align-items: center;
}
.pd-doctor-name {
  font-weight: 500;
  font-size: 0.9rem;
}
.pd-input-group {
  display: flex;
  gap: 4px;
}
.pd-input-group input[type='date'],
.pd-input-group select {
  width: 100%;
  padding: 4px;
  border: 1px solid #ced4da;
  border-radius: 4px;
  font-size: 0.85rem;
}
.holiday-add-form {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 1rem;
}
.holiday-input {
  padding: 6px;
  border: 1px solid #ced4da;
  border-radius: 4px;
  flex: 1;
  min-width: 120px;
}
.add-holiday-btn {
  padding: 6px 12px;
  background-color: #007bff;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}
.add-holiday-btn:hover {
  background-color: #0056b3;
}
.holiday-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.holiday-list li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px;
  background-color: #f8f9fa;
  border-radius: 4px;
}
.remove-holiday-btn {
  background: none;
  border: none;
  color: #dc3545;
  font-size: 1.2rem;
  font-weight: bold;
  cursor: pointer;
}
.no-holidays-text {
  color: #6c757d;
  font-style: italic;
}
.is-weekend {
  background-color: #fff0f1;
  color: #dc3545;
}
.is-holiday {
  background-color: #ffe8e6;
  color: #d90429;
  font-weight: bold;
}
.is-empty {
  background-color: #fafafa;
}
.is-special-date {
  background-color: #fffbe3;
  color: #b45309;
  font-weight: bold;
}
.is-holiday-text-only,
.is-weekend-text-only {
  color: #dc3545;
}
.physician-info-row.physician-color-1 .legend-char {
  color: #4a148c;
}
.physician-color-1 {
  background-color: #f3e5f5;
}
.physician-info-row.physician-color-2 .legend-char {
  color: #880e4f;
}
.physician-color-2 {
  background-color: #fce4ec;
}
.physician-info-row.physician-color-3 .legend-char {
  color: #0d47a1;
}
.physician-color-3 {
  background-color: #e3f2fd;
}
.physician-info-row.physician-color-4 .legend-char {
  color: #1b5e20;
}
.physician-color-4 {
  background-color: #e8f5e9;
}
.physician-info-row.physician-color-5 .legend-char {
  color: #ff6f00;
}
.physician-color-5 {
  background-color: #fff8e1;
}
.mobile-view-toggle,
.mobile-day-view,
.mobile-readonly-text,
.mobile-panels {
  display: none;
}
@media (max-width: 992px) {
  .hide-on-mobile,
  .desktop-panels {
    display: none !important;
  }
  .mobile-panels {
    display: block;
  }
  .page-container {
    height: auto;
    overflow: visible;
  }
  .page-header {
    flex-wrap: wrap;
    gap: 1rem;
  }
  .header-left {
    flex-basis: 100%;
    justify-content: center;
  }
  .page-main-title {
    display: none;
  }
  .month-display {
    font-size: 1.2rem;
  }
  .schedule-content.new-layout {
    flex-direction: column;
  }
  .schedule-grid-container {
    border: none;
    box-shadow: none;
    background-color: transparent;
  }
  .panels-container {
    padding-right: 0;
    overflow-y: visible;
  }
  .mobile-view-toggle {
    display: flex;
    border: 1px solid #007bff;
    border-radius: 6px;
    overflow: hidden;
  }
  .mobile-view-toggle button {
    background-color: #fff;
    color: #007bff;
    border: none;
    padding: 4px 10px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .mobile-view-toggle button.active {
    background-color: #007bff;
    color: white;
  }
  .mobile-day-view,
  .desktop-view.mobile-week-view {
    display: block;
  }
  .desktop-view:not(.mobile-week-view) {
    display: none;
  }
  .desktop-view.mobile-week-view {
    overflow-x: auto;
  }
  .mobile-week-view .physician-select {
    display: none;
  }
  .mobile-week-view .mobile-readonly-text {
    display: block;
    font-size: 1.5rem;
    font-weight: bold;
  }
  .mobile-day-card {
    background-color: #fff;
    border: 1px solid #dee2e6;
    border-left: 5px solid #007bff;
    border-radius: 6px;
    margin-bottom: 0.75rem;
  }
  .mobile-day-card.is-weekend {
    border-left-color: #dc3545;
  }
  .mobile-day-card.is-holiday {
    border-left-color: #d90429;
    background-color: #fff5f5;
  }
  .mobile-day-card.is-special-date {
    border-left-color: #b45309;
    background-color: #fffbe3;
  }
  .mobile-day-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem 0.75rem;
    background-color: #f8f9fa;
    border-bottom: 1px solid #e9ecef;
  }
  .mobile-day-header .date {
    font-weight: bold;
    font-size: 1.1rem;
  }
  .mobile-day-shifts {
    display: flex;
    flex-direction: column;
  }
  .mobile-shift-row {
    display: flex;
    align-items: center;
    border-bottom: 1px solid #f1f3f5;
  }
  .mobile-shift-row:last-child {
    border-bottom: none;
  }
  .mobile-shift-label {
    font-weight: bold;
    padding: 0.75rem;
    background-color: #f8f9fa;
    width: 40px;
    text-align: center;
  }
  .mobile-physician-name {
    flex-grow: 1;
    text-align: center;
    font-size: 1.5rem;
    font-weight: bold;
    padding: 0.5rem;
  }
  .panel-group {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .panel {
    padding: 0;
    overflow: hidden;
    border-radius: 8px;
    border: 1px solid #dee2e6;
  }
  .panel-toggle {
    display: flex;
    width: 100%;
    background-color: #f8f9fa;
    border: none;
    padding: 0.75rem 1rem;
    text-align: left;
    cursor: pointer;
    justify-content: space-between;
    align-items: center;
  }
  .panel-toggle h2 {
    font-size: 1.1rem;
    margin: 0;
    padding: 0;
    border: none;
  }
  .panel-toggle .fa-chevron-down {
    transition: transform 0.2s;
  }
  .panel-content[style*='display: none;'] + .panel-toggle .fa-chevron-down {
    transform: rotate(-90deg);
  }
  .panel-content {
    padding: 1rem;
    border-top: 1px solid #dee2e6;
  }
  .stats-header {
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .pd-clinic-row {
    grid-template-columns: 60px 1fr;
    grid-template-rows: auto auto;
  }
  .pd-clinic-row .pd-doctor-name {
    grid-row: 1 / 3;
  }
  .clinic-select-container {
    flex-direction: column;
    align-items: stretch;
  }
  .clinic-select {
    min-width: 100%;
  }
}
</style>
