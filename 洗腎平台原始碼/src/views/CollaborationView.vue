<!--檔案路徑: src/views/CollaborationView.vue ✨ 完整修正版 ✨-->
<template>
  <div class="page-container collaboration-view">
    <header class="page-header">
      <div class="header-toolbar">
        <div class="toolbar-left">
          <h1 class="page-title">訊息中心</h1>
          <button class="btn btn-primary" :disabled="isPageLocked" @click="openCreateModal(null)">
            <i class="fas fa-plus"></i> 新增交辦/留言
          </button>
        </div>
      </div>
      <p class="page-description">顯示日期: {{ displayDate }} ({{ weekdayDisplay }})</p>
    </header>

    <!-- ================== -->
    <!--    桌面版容器      -->
    <!-- ================== -->
    <div class="collaboration-container desktop-only">
      <!-- 左欄 -->
      <div class="patient-list-panel">
        <div class="left-panel-main-tabs">
          <button
            :class="{ active: mainPatientViewTab === 'my' }"
            @click="mainPatientViewTab = 'my'"
          >
            今日負責病人
          </button>
          <button
            :class="{ active: mainPatientViewTab === 'all' }"
            @click="mainPatientViewTab = 'all'"
          >
            全部病人
          </button>
        </div>

        <div v-if="mainPatientViewTab === 'my'" class="left-panel-shift-tabs">
          <button :class="{ active: shiftFilterTab === 'all' }" @click="shiftFilterTab = 'all'">
            全部
          </button>
          <button :class="{ active: shiftFilterTab === 'early' }" @click="shiftFilterTab = 'early'">
            早班
          </button>
          <button :class="{ active: shiftFilterTab === 'noon' }" @click="shiftFilterTab = 'noon'">
            午班
          </button>
          <button :class="{ active: shiftFilterTab === 'late' }" @click="shiftFilterTab = 'late'">
            晚班
          </button>
        </div>

        <div v-if="isLoading.patients" class="panel-loading">
          <div class="loading-spinner"></div>
          <span>載入病人列表...</span>
        </div>
        <div v-else class="patient-list-scroll-area">
          <div
            v-for="(shiftPatients, shiftName) in groupedPatients"
            :key="shiftName"
            class="shift-group"
          >
            <h3 class="shift-title">{{ shiftName }} ({{ shiftPatients.length }}人)</h3>
            <ul class="patient-list">
              <li
                v-for="patient in shiftPatients"
                :key="patient.id"
                class="patient-item"
                :class="{ active: selectedPatient?.id === patient.id }"
                @click="selectPatient(patient)"
              >
                <div class="patient-info">
                  <span v-if="mainPatientViewTab === 'my'" class="patient-bed">{{
                    patient.bed > 999 ? `外${patient.bed - 1000}` : patient.bed
                  }}</span>
                  <span class="patient-name">{{ patient.name }}</span>
                </div>
                <span class="patient-mrn">{{ patient.medicalRecordNumber }}</span>
              </li>
            </ul>
          </div>
          <div
            v-if="Object.keys(groupedPatients).length === 0 && !isLoading.patients"
            class="panel-empty"
          >
            <p>此條件下無病人資料。</p>
          </div>
        </div>
      </div>

      <!-- 中欄 -->
      <div class="message-panel">
        <div class="message-section bulletin-board-section">
          <h2 class="panel-title"><i class="fas fa-bullhorn"></i> 每日公告</h2>
          <div v-if="isLoading.bulletin" class="panel-loading small">
            <div class="loading-spinner"></div>
          </div>
          <div v-else class="bulletin-content">
            <div v-if="yesterdaysLogItems.length > 0" class="bulletin-group">
              <h3 class="bulletin-group-title">昨日工作日誌同步事項</h3>
              <ul class="bulletin-list">
                <li
                  v-for="(item, index) in yesterdaysLogItems"
                  :key="`log-${index}`"
                  class="log-item"
                >
                  {{ item }}
                </li>
              </ul>
            </div>

            <div v-if="false" class="bulletin-group">
              <h3 class="bulletin-group-title">本日新增公告</h3>
              <ul v-if="todaysAnnouncements.length > 0" class="bulletin-list">
                <li v-for="item in todaysAnnouncements" :key="item.id" class="announcement-item">
                  <p class="item-content">{{ item.content }}</p>
                  <div class="item-footer">
                    <div class="item-meta">
                      <small class="creator-info"
                        ><i class="fas fa-user-edit"></i> {{ item.creator?.name || '未知來源' }} 於
                        {{ formatTimestamp(item.createdAt) }}</small
                      >
                    </div>
                  </div>
                </li>
              </ul>
              <div v-else class="panel-empty small" style="padding: 1rem 0">
                <p>尚無本日公告</p>
              </div>
            </div>

            <!-- ✨ [核心修正] 將兩個 v-if 合併為一個 ✨ -->
            <div v-if="false && canPostAnnouncement" class="announcement-input-area">
              <textarea
                v-model="newAnnouncementText"
                placeholder="在此輸入想公布的事情..."
                rows="3"
              ></textarea>
              <button @click="handleSaveAnnouncement" :disabled="!newAnnouncementText.trim()">
                發布公告
              </button>
            </div>
          </div>
        </div>
        <div class="message-section feed-messages">
          <div class="panel-header-with-filter">
            <h2 class="panel-title"><i class="fas fa-stream"></i> 病人留言板</h2>

            <!-- ✨ 新增一個 div 來包裹篩選器 -->
            <div class="filter-controls">
              <!-- 篩選器 1: 顯示系統訊息的核取方塊 -->
              <div class="filter-toggle">
                <input type="checkbox" id="show-system-messages" v-model="showSystemMessages" />
                <label for="show-system-messages">顯示系統訊息</label>
              </div>

              <!-- 篩選器 2: 病人下拉選單 (維持不變) -->
              <select v-model="selectedMessagePatientId" class="patient-filter-select">
                <option value="all">顯示全部病人</option>
                <option v-for="p in messagePatientOptions" :key="p.id" :value="p.id">
                  {{ p.name }}
                </option>
              </select>
            </div>
          </div>

          <div v-if="taskStore.isLoading" class="panel-loading small">
            <div class="loading-spinner"></div>
          </div>
          <ul v-else-if="filteredFeedMessages.length > 0" class="message-list">
            <li
              v-for="msg in filteredFeedMessages"
              :key="msg.id"
              class="message-item"
              :class="{
                'is-completed': msg.status === 'completed',
                'is-expired': msg.status === 'expired',
                'is-future-message': msg.status === 'pending' && msg.targetDate > displayDate,
              }"
            >
              <div class="item-header-actions" v-if="canModify(msg)">
                <button @click="openCreateModal(msg)" class="btn-action-icon" title="編輯">
                  <i class="fas fa-edit"></i>
                </button>
                <button @click="confirmDeleteTask(msg)" class="btn-action-icon" title="刪除">
                  <i class="fas fa-trash"></i>
                </button>
              </div>

              <p class="item-content">
                <span class="message-type-icon" :title="msg.type || '一般交班'">
                  {{ getMessageTypeIcon(msg.type) }}
                </span>
                <strong>{{ msg.patientName }}:</strong> {{ msg.content }}
              </p>
              <div class="item-footer">
                <div class="item-meta">
                  <small v-if="msg.targetDate" class="target-date-info">
                    <i class="fas fa-calendar-alt"></i>
                    <span v-if="msg.status === 'expired'" class="expired-tag">逾</span>
                    <span v-else-if="msg.targetDate > displayDate" class="future-tag">預</span>
                    關聯 {{ msg.targetDate.slice(5).replace('-', '/') }}
                  </small>
                  <small class="creator-info"
                    ><i class="fas fa-user-edit"></i> {{ msg.creator?.name || '未知來源' }} 於
                    {{ formatTimestamp(msg.createdAt) }}</small
                  >
                </div>
                <div v-if="msg.status === 'pending' && msg.type !== '衛教'" class="item-actions">
                  <button
                    class="btn-action btn-complete"
                    @click="updateTaskStatus(msg.id, 'completed')"
                    :disabled="displayDate < msg.targetDate"
                    :title="
                      displayDate < msg.targetDate
                        ? `此留言需在 ${msg.targetDate} 才能標示已讀`
                        : '標示為已讀'
                    "
                  >
                    <i class="fas fa-check"></i> 已讀
                  </button>
                </div>

                <!-- ✨ 新增：如果 type 是 '衛教'，顯示一個不同的提示或不顯示任何按鈕 -->
                <div
                  v-else-if="msg.status === 'pending' && msg.type === '衛教'"
                  class="item-actions"
                >
                  <span class="education-task-tag">
                    <i class="fas fa-chalkboard-teacher"></i> 衛教事項
                  </span>
                </div>
                <div v-else-if="msg.status === 'expired'" class="item-actions">
                  <button
                    class="btn-action btn-revert"
                    @click="updateTaskStatus(msg.id, 'pending')"
                    title="將此事項移回待辦清單"
                  >
                    <i class="fas fa-undo"></i> 移回待辦
                  </button>
                </div>
                <div v-else class="completed-info">
                  <i class="fas fa-check-double"></i> 由
                  {{ msg.resolvedBy?.name || '未知使用者' }} 於
                  {{ formatTimestamp(msg.resolvedAt) }} 標示
                </div>
              </div>
            </li>
          </ul>
          <div v-else class="panel-empty small">
            <p><i class="fas fa-inbox"></i> 您的病人資訊流中沒有新留言</p>
          </div>
        </div>
      </div>

      <!-- 右欄 -->
      <div class="task-panel">
        <div class="task-section inbox-tasks">
          <h2 class="panel-title"><i class="fas fa-inbox"></i> 收件匣(給我的交辦事項)</h2>
          <div v-if="taskStore.isLoading" class="panel-loading small">
            <div class="loading-spinner"></div>
          </div>
          <ul v-else-if="sortedMyTasks.length > 0" class="task-list">
            <li
              v-for="task in sortedMyTasks"
              :key="task.id"
              class="task-item"
              :class="{ 'is-completed': task.status === 'completed' }"
            >
              <div class="item-header-actions" v-if="canModify(task)">
                <button @click="openCreateModal(task)" class="btn-action-icon" title="編輯">
                  <i class="fas fa-edit"></i>
                </button>
                <button @click="confirmDeleteTask(task)" class="btn-action-icon" title="刪除">
                  <i class="fas fa-trash"></i>
                </button>
              </div>

              <p class="item-content">
                <!-- ✨✨✨ 核心修改點在這裡 ✨✨✨ -->
                <strong>
                  <!-- 【修改】判斷病人是否有住院床號，並顯示它 -->
                  <span
                    v-if="patientWardNumberMap.has(task.patientId)"
                    class="task-patient-ward-number"
                  >
                    [{{ patientWardNumberMap.get(task.patientId) }}]
                  </span>
                  {{ task.patientName }}
                  <span v-if="patientMap.get(task.patientId)" class="task-patient-mrn">
                    ({{ patientMap.get(task.patientId).medicalRecordNumber }}) </span
                  >:
                </strong>
                {{ task.content }}
              </p>
              <div class="item-footer">
                <small class="creator-info"
                  ><i class="fas fa-user-edit"></i> from {{ task.creator?.name || '未知來源' }} at
                  {{ formatTimestamp(task.createdAt) }}</small
                >
                <div v-if="task.status === 'pending'" class="item-actions">
                  <button
                    class="btn-action btn-complete-task"
                    @click="updateTaskStatus(task.id, 'completed')"
                  >
                    <i class="fas fa-check"></i> 完成
                  </button>
                </div>
                <div v-else class="completed-info task">
                  <i class="fas fa-check-double"></i> 由
                  {{ task.resolvedBy?.name || '未知使用者' }} 於
                  {{ formatTimestamp(task.resolvedAt) }} 完成
                </div>
              </div>
            </li>
          </ul>
          <div v-else class="panel-empty small">
            <p><i class="fas fa-check-circle"></i> 沒有待處理的交辦事項</p>
          </div>
        </div>
        <div class="task-section sent-tasks">
          <h2 class="panel-title"><i class="fas fa-paper-plane"></i> 寄件匣(我的追蹤事項)</h2>
          <div v-if="taskStore.isLoading" class="panel-loading small">
            <div class="loading-spinner"></div>
          </div>
          <ul v-else-if="sortedMySentTasks.length > 0" class="task-list">
            <li
              v-for="task in sortedMySentTasks"
              :key="task.id"
              class="task-item sent"
              :class="{ 'is-completed': task.status === 'completed' }"
            >
              <div class="item-header-actions" v-if="canModify(task)">
                <button @click="openCreateModal(task)" class="btn-action-icon" title="編輯">
                  <i class="fas fa-edit"></i>
                </button>
                <button @click="confirmDeleteTask(task)" class="btn-action-icon" title="刪除">
                  <i class="fas fa-trash"></i>
                </button>
              </div>

              <p class="item-content">
                <strong>To {{ getAssigneeName(task.assignee) }}:</strong> {{ task.content }}
              </p>
              <div class="item-footer">
                <!-- ✨ 修改這裡：加入時間顯示 -->
                <small class="creator-info">
                  <i class="fas fa-user"></i> patient: {{ task.patientName || 'N/A' }}
                  <!-- 新增這行 -->
                  <span style="margin-left: 8px; color: #9ca3af">
                    at {{ formatTimestamp(task.createdAt) }}
                  </span>
                </small>
                <div class="item-actions">
                  <span v-if="task.status === 'pending'" class="sent-status">
                    <i class="far fa-clock"></i> 處理中...
                  </span>
                  <div v-else class="completed-info">
                    <i class="fas fa-check-double"></i> 由
                    {{ task.resolvedBy?.name || '未知使用者' }} 完成
                  </div>
                </div>
              </div>
            </li>
          </ul>
          <div v-else class="panel-empty small">
            <p><i class="fas fa-check-circle"></i> 沒有追蹤中的事項</p>
          </div>
        </div>
      </div>
    </div>

    <!-- ================== -->
    <!--    行動版容器      -->
    <!-- ================== -->
    <div class="mobile-container mobile-only">
      <div class="mobile-tabs">
        <button
          class="mobile-tab-btn"
          :class="{ active: activeMobileTab === 'patients' }"
          @click="activeMobileTab = 'patients'"
        >
          <i class="fas fa-user-friends"></i> 病人列表
        </button>
        <button
          class="mobile-tab-btn"
          :class="{ active: activeMobileTab === 'messages' }"
          @click="activeMobileTab = 'messages'"
        >
          <i class="fas fa-comment-dots"></i> 病人訊息
        </button>
        <button
          class="mobile-tab-btn"
          :class="{ active: activeMobileTab === 'tasks' }"
          @click="activeMobileTab = 'tasks'"
        >
          <i class="fas fa-clipboard-list"></i> 交辦事項
        </button>
      </div>

      <div class="mobile-content-area">
        <div v-show="activeMobileTab === 'patients'" class="patient-list-panel">
          <div class="left-panel-main-tabs">
            <button
              :class="{ active: mainPatientViewTab === 'my' }"
              @click="mainPatientViewTab = 'my'"
            >
              今日負責病人
            </button>
            <button
              :class="{ active: mainPatientViewTab === 'all' }"
              @click="mainPatientViewTab = 'all'"
            >
              全部病人
            </button>
          </div>
          <div v-if="mainPatientViewTab === 'my'" class="left-panel-shift-tabs">
            <button :class="{ active: shiftFilterTab === 'all' }" @click="shiftFilterTab = 'all'">
              全部
            </button>
            <button
              :class="{ active: shiftFilterTab === 'early' }"
              @click="shiftFilterTab = 'early'"
            >
              早班
            </button>
            <button :class="{ active: shiftFilterTab === 'noon' }" @click="shiftFilterTab = 'noon'">
              午班
            </button>
            <button :class="{ active: shiftFilterTab === 'late' }" @click="shiftFilterTab = 'late'">
              晚班
            </button>
          </div>
          <div v-if="isLoading.patients" class="panel-loading">
            <div class="loading-spinner"></div>
            <span>載入病人列表...</span>
          </div>
          <div v-else class="patient-list-scroll-area">
            <div
              v-for="(shiftPatients, shiftName) in groupedPatients"
              :key="shiftName"
              class="shift-group"
            >
              <h3 class="shift-title">{{ shiftName }} ({{ shiftPatients.length }}人)</h3>
              <ul class="patient-list">
                <li
                  v-for="patient in shiftPatients"
                  :key="patient.id"
                  class="patient-item"
                  :class="{ active: selectedPatient?.id === patient.id }"
                  @click="selectPatient(patient)"
                >
                  <div class="patient-info">
                    <span v-if="mainPatientViewTab === 'my'" class="patient-bed">{{
                      patient.bed > 999 ? `外${patient.bed - 1000}` : patient.bed
                    }}</span>
                    <span class="patient-name">{{ patient.name }}</span>
                  </div>
                  <span class="patient-mrn">{{ patient.medicalRecordNumber }}</span>
                </li>
              </ul>
            </div>
            <div
              v-if="Object.keys(groupedPatients).length === 0 && !isLoading.patients"
              class="panel-empty"
            >
              <p>此條件下無病人資料。</p>
            </div>
          </div>
        </div>
        <div v-show="activeMobileTab === 'messages'" class="message-panel">
          <div class="message-section bulletin-board-section">
            <h2 class="panel-title"><i class="fas fa-bullhorn"></i> 每日公告</h2>
            <div v-if="isLoading.bulletin" class="panel-loading small">
              <div class="loading-spinner"></div>
            </div>
            <div v-else class="bulletin-content">
              <div v-if="yesterdaysLogItems.length > 0" class="bulletin-group">
                <h3 class="bulletin-group-title">昨日工作日誌同步事項</h3>
                <ul class="bulletin-list">
                  <li
                    v-for="(item, index) in yesterdaysLogItems"
                    :key="`log-mobile-${index}`"
                    class="log-item"
                  >
                    {{ item }}
                  </li>
                </ul>
              </div>

              <div v-if="false" class="bulletin-group">
                <h3 class="bulletin-group-title">本日新增公告</h3>
                <ul v-if="todaysAnnouncements.length > 0" class="bulletin-list">
                  <li v-for="item in todaysAnnouncements" :key="item.id" class="announcement-item">
                    <p class="item-content">{{ item.content }}</p>
                    <div class="item-footer">
                      <div class="item-meta">
                        <small class="creator-info"
                          ><i class="fas fa-user-edit"></i>
                          {{ item.creator?.name || '未知來源' }} 於
                          {{ formatTimestamp(item.createdAt) }}</small
                        >
                      </div>
                    </div>
                  </li>
                </ul>
                <div v-else class="panel-empty small" style="padding: 1rem 0">
                  <p>尚無本日公告</p>
                </div>
              </div>

              <!-- ✨ [核心修正] 將兩個 v-if 合併為一個 ✨ -->
              <div v-if="false && canPostAnnouncement" class="announcement-input-area">
                <textarea
                  v-model="newAnnouncementText"
                  placeholder="在此輸入想公布的事情..."
                  rows="3"
                ></textarea>
                <button @click="handleSaveAnnouncement" :disabled="!newAnnouncementText.trim()">
                  發布公告
                </button>
              </div>
            </div>
          </div>
          <div class="message-section feed-messages">
            <div class="panel-header-with-filter">
              <h2 class="panel-title"><i class="fas fa-stream"></i> 病人留言板</h2>
              <select v-model="selectedMessagePatientId" class="patient-filter-select">
                <option value="all">全部病人</option>
                <option v-for="p in messagePatientOptions" :key="p.id" :value="p.id">
                  {{ p.name }}
                </option>
              </select>
            </div>
            <div v-if="taskStore.isLoading" class="panel-loading small">
              <div class="loading-spinner"></div>
            </div>
            <ul v-else-if="filteredFeedMessages.length > 0" class="message-list">
              <li
                v-for="msg in filteredFeedMessages"
                :key="msg.id"
                class="message-item"
                :class="{
                  'is-completed': msg.status === 'completed',
                  'is-expired': msg.status === 'expired',
                  'is-future-message': msg.status === 'pending' && msg.targetDate > displayDate,
                }"
              >
                <p class="item-content">
                  <span class="message-type-icon" :title="msg.type || '一般交班'">
                    {{ getMessageTypeIcon(msg.type) }}
                  </span>
                  <strong>{{ msg.patientName }}:</strong> {{ msg.content }}
                </p>
                <div class="item-footer">
                  <div class="item-meta">
                    <small v-if="msg.targetDate" class="target-date-info">
                      <i class="fas fa-calendar-alt"></i>
                      <span v-if="msg.status === 'expired'" class="expired-tag">逾</span>
                      <span v-else-if="msg.targetDate > displayDate" class="future-tag">預</span>
                      關聯 {{ msg.targetDate.slice(5).replace('-', '/') }}
                    </small>
                    <small class="creator-info"
                      ><i class="fas fa-user-edit"></i> {{ msg.creator?.name || '未知來源' }} 於
                      {{ formatTimestamp(msg.createdAt) }}</small
                    >
                  </div>
                  <div v-if="msg.status === 'pending'" class="item-actions">
                    <button
                      class="btn-action btn-complete"
                      @click="updateTaskStatus(msg.id, 'completed')"
                      :disabled="displayDate < msg.targetDate"
                      :title="
                        displayDate < msg.targetDate
                          ? `此留言需在 ${msg.targetDate} 才能標示已讀`
                          : '標示為已讀'
                      "
                    >
                      <i class="fas fa-check"></i> 已讀
                    </button>
                  </div>
                  <div v-else-if="msg.status === 'expired'" class="item-actions">
                    <button
                      class="btn-action btn-revert"
                      @click="updateTaskStatus(msg.id, 'pending')"
                      title="將此事項移回待辦清單"
                    >
                      <i class="fas fa-undo"></i> 移回待辦
                    </button>
                  </div>
                  <div v-else class="completed-info">
                    <i class="fas fa-check-double"></i> 由 {{ msg.resolvedBy?.name }} 於
                    {{ formatTimestamp(msg.resolvedAt) }} 標示
                  </div>
                </div>
              </li>
            </ul>
            <div v-else class="panel-empty small">
              <p><i class="fas fa-inbox"></i> 您的病人資訊流中沒有新留言</p>
            </div>
          </div>
        </div>
        <div v-show="activeMobileTab === 'tasks'" class="task-panel">
          <div class="task-section inbox-tasks">
            <h2 class="panel-title"><i class="fas fa-inbox"></i> 我的交辦事項 (收件匣)</h2>
            <div v-if="taskStore.isLoading" class="panel-loading small">
              <div class="loading-spinner"></div>
            </div>
            <ul v-else-if="sortedMyTasks.length > 0" class="task-list">
              <li
                v-for="task in sortedMyTasks"
                :key="task.id"
                class="task-item"
                :class="{ 'is-completed': task.status === 'completed' }"
              >
                <p class="item-content">
                  <strong>{{ task.patientName || '無關聯病人' }}:</strong>
                  {{ task.content }}
                </p>
                <div class="item-footer">
                  <small class="creator-info"
                    ><i class="fas fa-user-edit"></i> from {{ task.creator?.name || '未知來源' }} at
                    {{ formatTimestamp(task.createdAt) }}</small
                  >
                  <div v-if="task.status === 'pending'" class="item-actions">
                    <button
                      class="btn-action btn-complete-task"
                      @click="updateTaskStatus(task.id, 'completed')"
                    >
                      <i class="fas fa-check"></i> 完成
                    </button>
                  </div>
                  <div v-else class="completed-info task">
                    <i class="fas fa-check-double"></i> 由 {{ task.resolvedBy?.name }} 於
                    {{ formatTimestamp(task.resolvedAt) }} 完成
                  </div>
                </div>
              </li>
            </ul>
            <div v-else class="panel-empty small">
              <p><i class="fas fa-check-circle"></i> 沒有待處理的交辦事項</p>
            </div>
          </div>
          <div class="task-section sent-tasks">
            <h2 class="panel-title"><i class="fas fa-paper-plane"></i> 我的追蹤事項 (寄件匣)</h2>
            <div v-if="taskStore.isLoading" class="panel-loading small">
              <div class="loading-spinner"></div>
            </div>
            <ul v-else-if="sortedMySentTasks.length > 0" class="task-list">
              <li
                v-for="task in sortedMySentTasks"
                :key="task.id"
                class="task-item sent"
                :class="{ 'is-completed': task.status === 'completed' }"
              >
                <p class="item-content">
                  <strong>To {{ getAssigneeName(task.assignee) }}:</strong> {{ task.content }}
                </p>
                <div class="item-footer">
                  <small class="creator-info"
                    ><i class="fas fa-user-edit"></i> from {{ task.creator?.name || '未知來源' }} at
                    {{ formatTimestamp(task.createdAt) }}</small
                  >
                  <div class="item-actions">
                    <span v-if="task.status === 'pending'" class="sent-status">
                      <i class="far fa-clock"></i> 處理中...
                    </span>
                    <div v-else class="completed-info">
                      <i class="fas fa-check-double"></i> 由 {{ task.resolvedBy?.name }} 完成
                    </div>
                  </div>
                </div>
              </li>
            </ul>
            <div v-else class="panel-empty small">
              <p><i class="fas fa-check-circle"></i> 沒有追蹤中的事項</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <TaskCreateDialog
      :is-visible="isCreateModalVisible"
      :all-patients="patientStore.allPatients"
      :preselected-patient="selectedPatient"
      :initial-data="editingItem"
      @close="closeCreateModal"
      @submit="handleTaskSubmit"
    />

    <ConfirmDialog
      :is-visible="isConfirmDeleteVisible"
      title="確認刪除"
      message="您確定要永久刪除此項目嗎？此操作無法復原。"
      confirm-text="刪除"
      cancel-text="取消"
      confirm-class="btn-danger"
      @confirm="executeDeleteTask"
      @cancel="isConfirmDeleteVisible = false"
    />

    <button class="fab-mobile mobile-only" @click="openCreateModal(null)" :disabled="isPageLocked">
      <i class="fas fa-plus"></i>
    </button>
  </div>
</template>

<script setup>
import { ref, onMounted, computed, watch, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { useAuth } from '@/composables/useAuth'
import TaskCreateDialog from '@/components/TaskCreateDialog.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { usePatientStore } from '@/stores/patientStore'
import { useTaskStore } from '@/stores/taskStore'
import { storeToRefs } from 'pinia'
import { useGlobalNotifier } from '@/composables/useGlobalNotifier'
import {
  formatDateToYYYYMMDD,
  formatDateTimeToLocal,
  addDays,
  getDayOfWeek,
  parseFirestoreTimestamp,
} from '@/utils/dateUtils'
import { systemApi, nursingApi, schedulesApi } from '@/services/localApiClient'

const route = useRoute()
const { currentUser, isPageLocked, hasPermission } = useAuth()
const userTitle = computed(() => currentUser.value?.title)
const userRole = computed(() => currentUser.value?.role)

const patientStore = usePatientStore()
const taskStore = useTaskStore()
const { createGlobalNotification } = useGlobalNotifier()

const { myTasks, mySentTasks, sortedFeedMessages } = storeToRefs(taskStore)
const { allPatients: allPatientsFromStore } = storeToRefs(patientStore)
const patientMap = computed(() => patientStore.patientMap)

const isLoading = ref({
  patients: true,
  bulletin: true,
})
const allDailyPatients = ref([])
const myAssignedPatients = ref([])
const selectedPatient = ref(null)
const isCreateModalVisible = ref(false)
const yesterdaysLogItems = ref([])
const todaysAnnouncements = ref([])
const newAnnouncementText = ref('')
const mainPatientViewTab = ref('my')
const shiftFilterTab = ref('all')
const activeMobileTab = ref('patients')
let bulletinUnsubscribe = null

const selectedMessagePatientId = ref('all') // 用於病人留言板篩選
const editingItem = ref(null) // 存放正在編輯的項目資料
const isConfirmDeleteVisible = ref(false) // 控制刪除確認對話框
const itemToDelete = ref(null) // 存放準備刪除的項目資料
const showSystemMessages = ref(false)

const canPostAnnouncement = computed(() => {
  if (!currentUser.value) return false
  return ['admin', 'editor'].includes(currentUser.value.role)
})

const patientsForList = computed(() => {
  if (mainPatientViewTab.value === 'all') {
    return (allPatientsFromStore.value || []).filter((p) => !p.isDeleted && !p.isDiscontinued)
  }
  return myAssignedPatients.value
})

const filteredByShiftPatients = computed(() => {
  if (mainPatientViewTab.value === 'all') {
    return patientsForList.value
  }
  if (shiftFilterTab.value === 'all') {
    return patientsForList.value
  }
  return patientsForList.value.filter((p) => p.shift === shiftFilterTab.value)
})

const groupedPatients = computed(() => {
  const patientsToGroup = filteredByShiftPatients.value

  if (mainPatientViewTab.value === 'all') {
    if (!Array.isArray(patientsToGroup) || patientsToGroup.length === 0) return {}
    const sortedPatients = [...patientsToGroup].sort((a, b) =>
      a.name.localeCompare(b.name, 'zh-Hant'),
    )
    return { 所有病人: sortedPatients }
  }

  const groups = { 早班: [], 午班: [], 晚班: [] }
  if (!Array.isArray(patientsToGroup)) return {}
  for (const patient of patientsToGroup) {
    if (patient.shift === 'early') groups.早班.push(patient)
    else if (patient.shift === 'noon') groups.午班.push(patient)
    else if (patient.shift === 'late') groups.晚班.push(patient)
  }
  if (groups.早班.length === 0) delete groups.早班
  if (groups.午班.length === 0) delete groups.午班
  if (groups.晚班.length === 0) delete groups.晚班
  return groups
})

const displayDate = computed(() => route.query.date || formatDateToYYYYMMDD())
const weekdayDisplay = computed(() => {
  if (!displayDate.value) return ''
  try {
    return ['日', '一', '二', '三', '四', '五', '六'][getDayOfWeek(displayDate.value)]
  } catch {
    return ''
  }
})

// 【修正】將原本的 patientBedMapForToday 替換成以下內容
const patientWardNumberMap = computed(() => {
  const map = new Map()
  // 直接從 patientStore 的 allPatients 取得最完整的資料
  for (const patient of allPatientsFromStore.value) {
    // 檢查病人是否有 wardNumber 欄位且有值
    if (patient.id && patient.wardNumber) {
      map.set(patient.id, patient.wardNumber)
    }
  }
  return map
})

const sortItems = (items) => {
  if (!Array.isArray(items)) return []
  return [...items].sort((a, b) => {
    if (a.status === 'pending' && b.status !== 'pending') return -1
    if (a.status !== 'pending' && b.status === 'pending') return 1
    const getSafeDate = (timestamp) => {
      if (!timestamp) return new Date(0)
      return timestamp.toDate ? timestamp.toDate() : new Date(timestamp)
    }
    const dateA = getSafeDate(a.resolvedAt || a.createdAt)
    const dateB = getSafeDate(b.resolvedAt || b.createdAt)
    return dateB - dateA
  })
}
const sortedMyTasks = computed(() => sortItems(myTasks.value))
const sortedMySentTasks = computed(() => sortItems(mySentTasks.value))

// 首先，建立一個基礎的 computed 屬性，用來根據 "我的病人" / "全部病人" 頁籤篩選出相關的訊息
const baseMessages = computed(() => {
  if (mainPatientViewTab.value === 'all') {
    return sortedFeedMessages.value // sortedFeedMessages 來自 taskStore
  }
  // 如果是 "我的病人" 頁籤，則只篩選出與我負責的病人相關的訊息
  const myPatientIds = new Set(patientsForList.value.map((p) => p.id))
  return sortedFeedMessages.value.filter((msg) => myPatientIds.has(msg.patientId))
})

// 然後，修改 filteredFeedMessages，讓它基於 baseMessages 進行後續篩選
const filteredFeedMessages = computed(() => {
  let messagesToDisplay = baseMessages.value

  // (A) 根據新的核取方塊狀態，決定是否過濾系統訊息
  if (!showSystemMessages.value) {
    messagesToDisplay = messagesToDisplay.filter((msg) => msg.content && !msg.content.startsWith('【'))
  }

  // (B) 根據病人下拉選單進行篩選
  if (selectedMessagePatientId.value === 'all') {
    return messagesToDisplay
  } else {
    return messagesToDisplay.filter((msg) => msg.patientId === selectedMessagePatientId.value)
  }
})

// 最後，修改病人下拉選單的選項來源，確保它只顯示有「手動留言」的病人
const messagePatientOptions = computed(() => {
  const patientSet = new Map()
  // 這裡的關鍵是，不論篩選器狀態如何，下拉選單都只應顯示有 "非系統訊息" 的病人
  const userMessages = baseMessages.value.filter((msg) => msg.content && !msg.content.startsWith('【'))

  userMessages.forEach((msg) => {
    if (msg.patientId && msg.patientName && !patientSet.has(msg.patientId)) {
      patientSet.set(msg.patientId, { id: msg.patientId, name: msg.patientName })
    }
  })

  return Array.from(patientSet.values()).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
})

function getMessageTypeIcon(type) {
  switch (type) {
    case '抽血':
      return '🩸'
    case '衛教':
      return '📢'
    case '常規':
    default:
      return '📝'
  }
}

// ✨ --- START: 新增/修改函式 --- ✨
async function handleTaskSubmit(data) {
  // 如果 data.id 存在，表示是編輯模式
  if (data.id) {
    await updateTask(data)
  } else {
    // 否則為新增模式
    await handleTaskCreated()
  }
  closeCreateModal()
  // 立即刷新任務列表，讓新任務馬上顯示
  await taskStore.refreshTasks()
}

async function updateTask(data) {
  const { id, ...updateData } = data

  try {
    await systemApi.updateTask(id, updateData)
    console.log(`[CollaborationView] Task/Memo ${id} updated successfully.`)
  } catch (error) {
    console.error('更新項目失敗:', error)
    alert('更新失敗，請稍後再試。')
  }
}

function canModify(item) {
  if (!currentUser.value) return false
  if (['admin', 'editor'].includes(currentUser.value.role)) {
    return true
  }
  return item.creator?.uid === currentUser.value.uid
}

function confirmDeleteTask(item) {
  itemToDelete.value = item
  isConfirmDeleteVisible.value = true
}

async function executeDeleteTask() {
  if (!itemToDelete.value) return
  await deleteTask(itemToDelete.value.id)
  isConfirmDeleteVisible.value = false
  itemToDelete.value = null
}

function openCreateModal(itemToEdit = null) {
  if (!currentUser.value) return
  if (!hasPermission('viewer')) {
    console.warn('Permission denied.')
    return
  }
  editingItem.value = itemToEdit // 如果是 null 則為新增，否則為編輯
  isCreateModalVisible.value = true
}

function closeCreateModal() {
  isCreateModalVisible.value = false
  editingItem.value = null
}
// ✨ --- END: 新增/修改函式 --- ✨

async function updateTaskStatus(taskId, newStatus) {
  if (!currentUser.value) return
  try {
    const updateData = {
      status: newStatus,
      resolvedBy: { uid: currentUser.value.uid, name: currentUser.value.name },
      resolvedAt: new Date().toISOString(),
    }

    await systemApi.updateTask(taskId, updateData)
    createGlobalNotification(
      newStatus === 'completed' ? '狀態已更新為已讀' : '狀態已移回待辦',
      'success',
    )
    // 立即刷新任務列表
    await taskStore.refreshTasks()
  } catch (error) {
    console.error('更新任務狀態失敗:', error)
    alert('更新失敗，請稍後再試。')
  }
}

async function deleteTask(taskId) {
  try {
    await systemApi.deleteTask(taskId)
    createGlobalNotification('訊息已刪除', 'info')
    // 立即刷新任務列表
    await taskStore.refreshTasks()
  } catch (error) {
    console.error('刪除任務失敗:', error)
    alert('刪除失敗，請稍後再試。')
  }
}

function formatTimestamp(ts) {
  if (!ts) return ''
  const date = parseFirestoreTimestamp(ts)
  if (isNaN(date.getTime())) return ''
  return formatDateTimeToLocal(date, { year: undefined, second: undefined })
}

const roleDisplayNames = {
  clerk: '書記',
  doctor: '醫師',
  np: '專科護理師',
  editor: '護理師組長',
  admin: '管理員',
}

function getAssigneeName(assignee) {
  if (!assignee) return '未知'
  if (assignee.type === 'role') {
    return roleDisplayNames[assignee.value] || assignee.value
  }
  if (assignee.type === 'user') {
    const titleSuffix = assignee.title ? `（${assignee.title}）` : ''
    return `${assignee.name || '指定成員'}${titleSuffix}`
  }
  return '特定使用者'
}

function selectPatient(patient) {
  selectedPatient.value = patient
  if (window.innerWidth <= 992) {
    activeMobileTab.value = 'messages'
  }
}

function handleTaskCreated() {
  console.log('Task created successfully.')
}

function listenToBulletinData(dateStr) {
  if (bulletinUnsubscribe) bulletinUnsubscribe()
  isLoading.value.bulletin = true
  yesterdaysLogItems.value = []
  todaysAnnouncements.value = []

  const today = new Date(dateStr + 'T00:00:00')
  const yesterdayStr = formatDateToYYYYMMDD(addDays(today, -1))
  const dayBeforeYesterdayStr = formatDateToYYYYMMDD(addDays(today, -2))

  async function fetchLastWorkingDayLog() {
    try {
      // 嘗試獲取昨天的日誌
      let yesterdayLog = null
      try {
        yesterdayLog = await nursingApi.fetchDailyLog(yesterdayStr)
      } catch {
        yesterdayLog = null
      }

      if (yesterdayLog && yesterdayLog.otherNotes) {
        const notes = yesterdayLog.otherNotes
          .split('\n')
          .map((item) => item.trim())
          .filter((item) => item)

        yesterdaysLogItems.value = notes
        console.log(
          `[CollaborationView] Displaying log notes (otherNotes) from yesterday (${yesterdayStr})`,
        )
        return
      }

      // 嘗試獲取前天的日誌
      let dayBeforeLog = null
      try {
        dayBeforeLog = await nursingApi.fetchDailyLog(dayBeforeYesterdayStr)
      } catch {
        dayBeforeLog = null
      }

      if (dayBeforeLog && dayBeforeLog.otherNotes) {
        const notes = dayBeforeLog.otherNotes
          .split('\n')
          .map((item) => item.trim())
          .filter((item) => item)

        yesterdaysLogItems.value = notes
        console.log(
          `[CollaborationView] Displaying log notes (otherNotes) from the day before yesterday (${dayBeforeYesterdayStr})`,
        )
      }
    } catch (err) {
      console.error('獲取舊工作日誌失敗:', err)
    }
  }

  async function fetchTodayAnnouncements() {
    try {
      const todayLog = await nursingApi.fetchDailyLog(dateStr)
      if (todayLog && todayLog.announcements) {
        todaysAnnouncements.value = todayLog.announcements.sort((a, b) => {
          const dateA = new Date(a.createdAt).getTime()
          const dateB = new Date(b.createdAt).getTime()
          return dateB - dateA
        })
      } else {
        todaysAnnouncements.value = []
      }
    } catch (err) {
      console.error('獲取本日公告失敗:', err)
      todaysAnnouncements.value = []
    }
  }

  Promise.all([fetchLastWorkingDayLog(), fetchTodayAnnouncements()]).finally(() => {
    isLoading.value.bulletin = false
  })
}

async function handleSaveAnnouncement() {
  if (!newAnnouncementText.value.trim() || !currentUser.value) return
  const dateStr = displayDate.value
  const newAnnouncement = {
    id: Date.now().toString(),
    content: newAnnouncementText.value.trim(),
    creator: {
      uid: currentUser.value.uid,
      name: currentUser.value.name,
    },
    createdAt: new Date().toISOString(),
  }
  try {
    // 先獲取現有日誌
    let existingLog = null
    try {
      existingLog = await nursingApi.fetchDailyLog(dateStr)
    } catch {
      existingLog = null
    }

    const existingAnnouncements = existingLog?.announcements || []
    await nursingApi.updateDailyLog(dateStr, {
      ...existingLog,
      announcements: [...existingAnnouncements, newAnnouncement],
    })
    newAnnouncementText.value = ''
  } catch (error) {
    console.error('發布公告失敗:', error)
    alert('發布公告失敗，請檢查網路連線或聯繫管理員。')
  }
}

async function loadDailyPatientData(date) {
  isLoading.value.patients = true
  allDailyPatients.value = []
  myAssignedPatients.value = []

  if (!currentUser.value) {
    isLoading.value.patients = false
    return
  }

  try {
    await patientStore.fetchPatientsIfNeeded()

    // 使用本地 API 獲取排程
    const scheduleData = await schedulesApi.fetchByDate(date)
    if (!scheduleData || !scheduleData.schedule) {
      isLoading.value.patients = false
      return
    }

    const schedule = scheduleData.schedule
    // 使用本地 API 獲取護理分配
    let assignments = null
    try {
      assignments = await schedulesApi.fetchNurseAssignments(date)
    } catch {
      assignments = null
    }

    const localPatientMap = patientStore.patientMap

    const getBedNumber = (shiftId) => {
      const parts = shiftId.split('-')
      return parts[0] === 'peripheral' ? 1000 + parseInt(parts[1], 10) : parseInt(parts[1], 10)
    }

    const tempAllDaily = []
    for (const shiftId in schedule) {
      const slot = schedule[shiftId]
      if (slot?.patientId && localPatientMap.has(slot.patientId)) {
        const patientDetail = localPatientMap.get(slot.patientId)
        tempAllDaily.push({
          ...patientDetail,
          shift: shiftId.split('-').pop(),
          bed: getBedNumber(shiftId),
        })
      }
    }

    const sortLogic = (a, b) => {
      const shiftOrder = { early: 1, noon: 2, late: 3 }
      if (a.shift !== b.shift) return (shiftOrder[a.shift] || 99) - (shiftOrder[b.shift] || 99)
      return a.bed - b.bed
    }
    allDailyPatients.value = tempAllDaily.sort(sortLogic)

    if (assignments && assignments.teams) {
      const { names, teams } = assignments
      const myAssignedIds = new Set()
      if (names && teams) {
        for (const teamName in names) {
          if (names[teamName] === currentUser.value.name) {
            for (const key in teams) {
              const [patientId] = key.split('-')
              const teamAssignment = teams[key]
              if (
                teamAssignment.nurseTeam === teamName ||
                teamAssignment.nurseTeamIn === teamName ||
                teamAssignment.nurseTeamOut === teamName
              ) {
                myAssignedIds.add(patientId)
              }
            }
          }
        }
      }
      myAssignedPatients.value = allDailyPatients.value.filter((p) => myAssignedIds.has(p.id))
    }
  } catch (error) {
    console.error('獲取每日病人列表失敗:', error)
  } finally {
    isLoading.value.patients = false
  }
}

onMounted(async () => {
  await useAuth().waitForAuthInit()
  if (currentUser.value) {
    // 載入頁面其他資料 (不再管理 taskStore 監聽器)
    Promise.all([
      patientStore.fetchPatientsIfNeeded(),
      loadDailyPatientData(displayDate.value),
      listenToBulletinData(displayDate.value),
    ])
  }
})

onUnmounted(() => {
  if (bulletinUnsubscribe) bulletinUnsubscribe()
})

watch(
  () => route.query.date,
  async (newDate, oldDate) => {
    if (newDate && newDate !== oldDate) {
      await loadDailyPatientData(newDate)
      listenToBulletinData(newDate)
    }
  },
)

watch(
  () => currentUser.value,
  (newUser) => {
    if (newUser) {
      // 如果有新用戶登入，重新載入資料
      loadDailyPatientData(displayDate.value)
      listenToBulletinData(displayDate.value)
    } else {
      // 如果用戶登出，清理公告監聽器
      if (bulletinUnsubscribe) bulletinUnsubscribe()
    }
  },
)
</script>

<style scoped>
/* 引入 Font Awesome */
@import url('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.4/css/all.min.css');

/* ✨ --- START: 新增樣式 --- ✨ */
.panel-header-with-filter {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 1rem;
  border-bottom: 1px solid #e9ecef;
  background-color: #f8f9fa;
  flex-shrink: 0; /* 確保標題列不被壓縮 */
}
/* 在 .panel-header-with-filter 樣式下方加入以下新樣式 */
.filter-controls {
  display: flex;
  align-items: center;
  gap: 1.5rem; /* 在兩個篩選器之間增加間距 */
}

.filter-toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.filter-toggle label {
  font-size: 0.9rem;
  color: #495057;
  cursor: pointer;
  user-select: none; /* 讓文字無法被選取 */
}

.filter-toggle input[type='checkbox'] {
  width: 1rem;
  height: 1rem;
  cursor: pointer;
}

.panel-header-with-filter .panel-title {
  border-bottom: none;
  padding: 1rem 0;
}

.patient-filter-select {
  padding: 0.6rem 0.75rem;
  font-size: 0.9rem;
  border: 1px solid #ced4da;
  border-radius: 4px;
  background-color: white;
}

.message-item,
.task-item {
  position: relative; /* 為了讓絕對定位的按鈕有參考點 */
}

.item-header-actions {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  display: flex;
  gap: 0.25rem;
  background-color: rgba(248, 249, 250, 0.8); /* 半透明背景 */
  backdrop-filter: blur(2px);
  padding: 2px 4px;
  border-radius: 6px;
  opacity: 0; /* 預設隱藏 */
  transition: opacity 0.2s ease-in-out;
  z-index: 5;
}

.message-item:hover .item-header-actions,
.task-item:hover .item-header-actions {
  opacity: 1; /* 滑鼠懸停時顯示 */
}

.btn-action-icon {
  background: none;
  border: none;
  cursor: pointer;
  color: #6c757d;
  padding: 4px;
  border-radius: 50%;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.btn-action-icon:hover {
  background-color: #e9ecef;
  color: #212529;
}

.btn-action-icon .fa-trash:hover {
  color: #dc3545;
}
/* ✨ --- END: 新增樣式 --- ✨ */
/* ✨ --- 【修改後的新標頭樣式】 --- ✨ */
.page-header {
  border-bottom: 2px solid #dee2e6;
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  flex-shrink: 0; /* 確保 header 在 flex 佈局中不被壓縮 */
}

.header-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 1.5rem; /* 在標題和按鈕之間增加間距 */
}

.page-title {
  /* 取代了舊的 header-content h1 */
  font-size: 32px;
  font-weight: 700;
  color: #343a40;
  margin: 0;
}

.page-description {
  /* 取代了舊的 date-display */
  margin-top: 0.5rem;
  font-size: 1rem;
  color: #6c757d;
}

.btn {
  padding: 0.5rem 1rem;
  border-radius: 6px;
  border: 1px solid transparent;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s;
  font-size: 1rem;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.btn-primary {
  background-color: #007bff;
  color: white;
  border-color: #007bff;
}
.btn-primary:hover {
  background-color: #0069d9;
}

/* ================================== */
/*         通用基礎樣式 (保留部分)      */
/* ================================== */
.page-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 0.5rem;
  background-color: #f8f9fa;
  box-sizing: border-box;
}

.panel-title {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 1.25rem;
  padding: 1rem;
  margin: 0;
  border-bottom: 1px solid #e9ecef;
  flex-shrink: 0;
  background-color: #f8f9fa;
}

.panel-loading,
.panel-empty {
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 2rem;
  color: #6c757d;
}
.panel-empty i {
  font-size: 1.5rem;
  margin-bottom: 0.5rem;
  opacity: 0.7;
}
.panel-loading.small,
.panel-empty.small {
  padding: 1rem;
  font-size: 0.9rem;
}
.loading-spinner {
  width: 30px;
  height: 30px;
  border: 3px solid #f3f3f3;
  border-top: 3px solid #007bff;
  border-radius: 50%;
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
.item-content {
  margin: 0 0 0.5rem 0;
  white-space: pre-wrap;
  word-break: break-word;
}
.item-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.creator-info {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: #6c757d;
  font-size: 0.8rem;
}
.completed-info {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8rem;
  color: #15803d;
  font-style: italic;
  text-align: right;
}
.completed-info.task {
  color: #166534;
}
.item-actions {
  display: flex;
  gap: 0.5rem;
}
.item-actions .btn-action {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8rem;
  padding: 4px 10px;
  border: none;
  border-radius: 4px;
  color: white;
  cursor: pointer;
  transition: background-color 0.2s;
}
.btn-complete {
  background-color: #007bff;
}
.btn-complete-task {
  background-color: #f59e0b;
}
.message-item,
.task-item {
  padding: 0.75rem 1rem;
  margin-bottom: 0.75rem;
  border-radius: 6px;
  transition: opacity 0.3s;
  flex-shrink: 0;
}
.message-item {
  background-color: #f0f9ff;
  border-left: 4px solid #0ea5e9;
}
.task-item {
  background-color: #fffbeb;
  border-left: 4px solid #f59e0b;
}
.task-item.sent {
  background-color: #f1f5f9;
  border-left-color: #64748b;
}
.sent-status {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8rem;
  color: #475569;
  font-weight: 500;
  font-style: italic;
}
.is-completed {
  opacity: 0.7;
  background-color: #f8fafc;
}
.is-completed .item-content {
  text-decoration: line-through;
}
.task-patient-mrn {
  color: #6c757d;
  font-weight: normal;
  font-size: 0.9em;
  margin-left: 0.25em;
}
/* 【修改】床位號碼的樣式，改名並更新顏色以符合住院狀態 */
.task-patient-ward-number {
  color: #dc3545; /* 使用紅色以突顯住院狀態 */
  font-weight: bold;
  font-size: 0.9em;
  margin-right: 0.5em; /* 稍微增加間距 */
}
.desktop-only {
  display: block;
}
.mobile-only {
  display: none;
}
.patient-list-scroll-area {
  flex-grow: 1;
  overflow-y: auto;
}
.patient-list,
.message-list,
.task-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.shift-group {
  border-bottom: 1px solid #e9ecef;
}
.shift-group:last-child {
  border-bottom: none;
}
.shift-title {
  font-size: 1rem;
  font-weight: bold;
  color: #495057;
  padding: 0.75rem 1rem;
  background-color: #f8f9fa;
  margin: 0;
  position: sticky;
  top: 0;
  z-index: 1;
}
.patient-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid #f1f3f5;
  cursor: pointer;
  transition: background-color 0.2s;
}
.patient-item:last-child {
  border-bottom: none;
}
.patient-item:hover {
  background-color: #f8f9fa;
}
.patient-item.active {
  background-color: #e7f1ff;
  font-weight: bold;
  color: #0056b3;
}
.patient-info {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.patient-bed {
  font-size: 0.8rem;
  font-weight: bold;
  color: #007bff;
  background-color: #e7f1ff;
  border-radius: 4px;
  padding: 2px 6px;
  min-width: 30px;
  text-align: center;
}
.patient-name {
  font-size: 1rem;
}
.patient-mrn {
  font-size: 0.9rem;
  color: #6c757d;
}
.left-panel-main-tabs,
.left-panel-shift-tabs {
  display: flex;
  flex-shrink: 0;
}
.left-panel-main-tabs {
  border-bottom: 1px solid #dee2e6;
  padding: 0.5rem;
}
.left-panel-main-tabs button {
  flex: 1;
  padding: 0.6rem;
  border: 1px solid #007bff;
  color: #007bff;
  background: none;
  cursor: pointer;
  font-size: 1rem;
  font-weight: 600;
}
.left-panel-main-tabs button:first-child {
  border-radius: 6px 0 0 6px;
}
.left-panel-main-tabs button:last-child {
  border-radius: 0 6px 6px 0;
  border-left: none;
}
.left-panel-main-tabs button.active {
  background-color: #007bff;
  color: white;
}
.left-panel-shift-tabs {
  border-bottom: 1px solid #dee2e6;
  padding: 0.5rem 0.5rem 0;
  background-color: #ffffff;
}
.left-panel-shift-tabs button {
  flex: 1;
  padding: 0.5rem;
  border: none;
  background: none;
  font-size: 0.9rem;
  font-weight: 600;
  color: #6c757d;
  cursor: pointer;
  border-radius: 4px 4px 0 0;
  border-bottom: 3px solid transparent;
}
.left-panel-shift-tabs button.active {
  color: #007bff;
  background-color: #f8f9fa;
  border-bottom-color: #007bff;
}
.education-task-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8rem;
  padding: 4px 10px;
  border-radius: 4px;
  background-color: #f0fdf4; /* 淡綠色 */
  color: #15803d; /* 深綠色 */
  font-weight: 500;
}
/* ================================== */
/*       ✨ 桌面版樣式 ✨             */
/* ================================== */
@media (min-width: 993px) {
  .collaboration-container {
    display: grid;
    grid-template-columns: 280px 2fr 1.5fr;
    gap: 1.5rem;
    flex-grow: 1;
    min-height: 0;
  }
  .patient-list-panel,
  .message-panel,
  .task-panel {
    display: flex !important;
    flex-direction: column;
    overflow: hidden;
    background-color: #ffffff;
  }
  .message-list,
  .task-list {
    flex-grow: 1;
    overflow-y: auto;
  }
  .patient-list {
    padding: 0.5rem 0;
  }
  .message-panel {
    padding: 0;
    background-color: transparent;
    border: none;
  }
  .message-section {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background-color: #ffffff;
    border: 1px solid #dee2e6;
    border-radius: 8px;
  }
  .message-section.bulletin-board-section {
    height: 33.33%;
    margin-bottom: 1.5rem;
  }
  .message-section.feed-messages {
    height: calc(66.67% - 1.5rem);
  }
  .message-list {
    padding: 1rem;
  }

  .task-panel {
    padding: 0;
    background-color: transparent;
    border: none;
  }
  .task-section {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background-color: #ffffff;
    border: 1px solid #dee2e6;
    border-radius: 8px;
  }
  .task-section.inbox-tasks {
    height: 50%;
    margin-bottom: 1.5rem;
  }
  .task-section.sent-tasks {
    height: calc(50% - 1.5rem);
  }
  .task-list {
    padding: 1rem;
  }
}

/* ================================== */
/*       ✨ 行動版樣式 (已修正) ✨     */
/* ================================== */
@media (max-width: 992px) {
  .desktop-only {
    display: none !important;
  }
  .mobile-only {
    display: block;
  }
  .page-container {
    padding: 0;
    position: relative;
  }
  .page-header {
    padding: 1rem;
    margin-bottom: 0;
  }
  .page-title {
    font-size: 1.5rem;
  }
  .page-description {
    margin-top: 0.5rem;
    font-size: 0.9rem;
  }
  .toolbar-left .btn-primary {
    display: none;
  }

  .mobile-container {
    display: flex;
    flex-direction: column;
    flex-grow: 1;
    min-height: 0;
  }
  .mobile-tabs {
    display: flex;
    background-color: #ffffff;
    border-bottom: 1px solid #dee2e6;
    flex-shrink: 0;
  }
  .mobile-tab-btn {
    flex: 1;
    padding: 0.75rem 0.5rem;
    font-size: 1rem;
    font-weight: 600;
    text-align: center;
    border: none;
    background: none;
    color: #6c757d;
    cursor: pointer;
    border-bottom: 3px solid transparent;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }
  .mobile-tab-btn.active {
    color: #007bff;
    border-bottom-color: #007bff;
  }

  .mobile-content-area {
    padding: 1rem;
    overflow-y: auto;
    flex-grow: 1;
  }

  .mobile-content-area > div[style*='display: none;'] {
    display: none !important;
  }

  .patient-list-panel,
  .message-panel,
  .task-panel {
    border-radius: 8px;
    border: 1px solid #dee2e6;
    background-color: #ffffff;
    flex-grow: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .message-panel,
  .task-panel {
    gap: 1rem;
    padding: 0;
    background: transparent;
    border: none;
  }
  .message-section,
  .task-section {
    height: auto;
    flex: 1;
    min-height: 300px;
    margin: 0;
    border: 1px solid #dee2e6;
    border-radius: 8px;
    display: flex;
    flex-direction: column;
  }

  .fab-mobile {
    display: flex;
    align-items: center;
    justify-content: center;
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
  }
}
/* ================================== */
/*       ✨ 公告欄新增樣式 ✨         */
/* ================================== */
.bulletin-board-section .panel-title {
  background-color: #fffbe6;
  color: #b45309;
}
.bulletin-content {
  flex-grow: 1;
  overflow-y: auto;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}
.bulletin-group-title {
  font-size: 0.9rem;
  font-weight: bold;
  color: #4b5563;
  margin: 0 0 0.5rem 0;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid #e5e7eb;
}
.bulletin-list {
  list-style-type: decimal;
  padding-left: 1.5rem;
  margin: 0;
}
.log-item,
.announcement-item {
  margin-bottom: 0.5rem;
  font-size: 0.95rem;
}
.log-item {
  color: #374151;
}
.announcement-item .item-content {
  margin-bottom: 0.25rem;
}
.announcement-input-area {
  margin-top: auto;
  padding-top: 1rem;
  border-top: 1px solid #e5e7eb;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.announcement-input-area textarea {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 0.95rem;
  resize: vertical;
}
.announcement-input-area button {
  align-self: flex-end;
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 6px;
  background-color: #f97316;
  color: white;
  font-weight: bold;
  cursor: pointer;
}
.announcement-input-area button:disabled {
  background-color: #d1d5db;
  cursor: not-allowed;
}

/* ================================== */
/*   ✨ 病人留言板新增/修改樣式 ✨     */
/* ================================== */
.item-meta {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  align-items: flex-start;
}
.target-date-info {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8rem;
  font-weight: bold;
  color: #0d6efd;
  background-color: #e7f1ff;
  padding: 2px 6px;
  border-radius: 4px;
}
.message-item.is-future-message {
  background-color: #fefce8;
  border-left-color: #facc15;
}
.item-actions .btn-action:disabled {
  background-color: #adb5bd;
  cursor: not-allowed;
  opacity: 0.7;
}
.future-tag {
  display: inline-block;
  background-color: #fb923c;
  color: white;
  font-size: 0.7rem;
  font-weight: bold;
  padding: 1px 4px;
  border-radius: 4px;
  margin-right: 4px;
  vertical-align: middle;
}
.message-type-icon {
  display: inline-block;
  margin-right: 0.5rem;
  font-size: 1.2rem;
  vertical-align: middle;
}
.message-item.is-expired {
  background-color: #fffbeb; /* 淡黃色背景，表示警示 */
  border-left-color: #f59e0b; /* 橘黃色邊框 */
}
.expired-tag {
  display: inline-block;
  background-color: #ef4444; /* 紅色 */
  color: white;
  font-size: 0.7rem;
  font-weight: bold;
  padding: 1px 4px;
  border-radius: 4px;
  margin-right: 4px;
  vertical-align: middle;
}
.item-actions .btn-revert {
  background-color: #f97316; /* 橘色 */
}
.item-actions .btn-revert:hover {
  background-color: #ea580c;
}
</style>
