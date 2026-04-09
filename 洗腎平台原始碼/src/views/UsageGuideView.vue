<script setup>
import { ref } from 'vue'
// 從自動生成的 JSON 檔案讀取版本記錄（每次構建時自動更新）
import changelogData from '@/data/changelog.json'

const activeSection = ref('overview')
const expandedPages = ref({})

// 版本更新記錄（從 JSON 動態載入，構建時自動從 git log 生成）
const changelog = ref(changelogData)

const sections = [
  { id: 'overview', name: '平台總覽', icon: 'fa-home' },
  { id: 'common', name: '共用功能', icon: 'fa-users' },
  { id: 'admin-editor', name: '排班管理', icon: 'fa-calendar-alt' },
  { id: 'backend', name: '後臺管理', icon: 'fa-cog' },
  { id: 'changelog', name: '版本更新', icon: 'fa-history' },
]

const pageGuides = {
  // 共用功能
  schedule: {
    name: '每日排程',
    path: '/schedule',
    roles: '所有使用者',
    icon: 'fa-calendar-day',
    description: '查看與管理當日透析病人的排班安排',
    features: [
      { title: '拖曳排床', desc: '將病人卡片拖曳到目標床位即可完成排床' },
      { title: '智慧排床', desc: '點擊工具列的「智慧排床」按鈕，系統自動為未排床病人安排適合床位' },
      { title: '自動分組', desc: '根據護理班表自動分配護理分組' },
      { title: 'ICU 醫囑查詢', desc: '點擊住院/急診病人可查看 ICU 系統的最新醫囑' },
      { title: '臨床查閱模式', desc: '切換至簡潔的臨床查閱介面，顯示病歷號和床號' },
      { title: 'Excel 匯出', desc: '將當日排程表匯出為 Excel 檔案' },
    ],
  },
  stats: {
    name: '護理分組',
    path: '/stats',
    roles: '所有使用者',
    icon: 'fa-users-cog',
    description: '查看每日護理分組分配情況，進行交辦與調班申請',
    features: [
      { title: '分組檢視', desc: '依班別（早/中/晚）查看護理師分組與負責病人' },
      { title: '新增交辦', desc: '為特定病人建立待辦事項，交班提醒' },
      { title: '調班申請', desc: '快速建立調班或換床申請' },
      { title: '預約變更', desc: '預約病人屬性或排班規則的未來變更' },
      { title: '夜班收針分組', desc: '顯示 311 夜班的收針分組安排' },
      { title: '自動分組', desc: '一鍵自動分配當日護理分組' },
    ],
  },
  myPatients: {
    name: '我的今日病人',
    path: '/my-patients',
    roles: '所有使用者（護理師專用）',
    icon: 'fa-user-nurse',
    description: '護理師專屬頁面，顯示當日分配給自己的病人清單',
    features: [
      { title: '病人清單', desc: '顯示今日分配給您負責的所有病人' },
      { title: '交班備忘查詢', desc: '快速查看每位病人的待處理交班事項' },
      { title: '用戶篩選', desc: '管理者可切換查看其他護理師的病人' },
      { title: '日期篩選', desc: '查看歷史日期的分配記錄' },
      { title: '快速整理', desc: '一鍵整理顯示格式' },
    ],
  },
  collaboration: {
    name: '訊息中心',
    path: '/collaboration',
    roles: '所有使用者',
    icon: 'fa-comments',
    description: '協作訊息中心，查看和管理病人相關的交辦與留言',
    features: [
      { title: '全部病人', desc: '查看所有病人的訊息與待辦事項' },
      { title: '今日負責', desc: '只顯示今日分配給您的病人' },
      { title: '班別篩選', desc: '依早/中/晚班篩選病人' },
      { title: '新增交辦', desc: '為病人建立新的待辦交辦事項' },
      { title: '新增留言', desc: '在病人頁面留下備註或訊息' },
      { title: '實時更新', desc: '訊息會即時同步，無需手動刷新' },
    ],
  },
  // 排班管理（Admin/Editor）
  weekly: {
    name: '週排班',
    path: '/weekly',
    roles: '管理員、編輯者',
    icon: 'fa-calendar-week',
    description: '管理一週的透析排班總覽',
    features: [
      { title: '七天總覽', desc: '一次查看週一到週六的完整排班' },
      { title: '患者搜尋', desc: '快速搜尋特定病人的排班位置' },
      { title: '智慧排床', desc: '自動為病人安排一週的床位' },
      { title: '排程檢視', desc: '切換不同的檢視模式' },
      { title: '變更保存', desc: '批次保存所有排班變更' },
      { title: 'Excel 匯出', desc: '匯出週排班表' },
    ],
  },
  baseSchedule: {
    name: '床位總表',
    path: '/base-schedule',
    roles: '管理員、編輯者',
    icon: 'fa-th',
    description: '門急住床位的完整總表視圖',
    features: [
      { title: '總表視圖', desc: '顯示所有床位的排班狀態' },
      { title: '患者搜尋', desc: '依病人姓名或病歷號搜尋' },
      { title: '智慧排床', desc: '自動安排未排床病人' },
      { title: '排程檢視', desc: '多種檢視模式切換' },
      { title: 'Excel 匯出', desc: '匯出床位總表' },
    ],
  },
  exceptionManager: {
    name: '調班換床',
    path: '/exception-manager',
    roles: '管理員、編輯者',
    icon: 'fa-exchange-alt',
    description: '管理臨時調班、區間暫停透析、臨時加洗等例外情況',
    features: [
      { title: '日曆視圖', desc: '以月曆或週曆形式查看所有調班記錄' },
      { title: '月/週切換', desc: '在月視圖和週視圖間切換' },
      { title: '新增調班', desc: '建立新的調班或換床申請' },
      { title: '區間暫停', desc: '設定病人在特定期間暫停透析' },
      { title: '臨時加洗', desc: '為病人安排臨時加洗' },
      { title: '衝突提示', desc: '側邊欄紅點提醒有待解決的衝突' },
      { title: '批次整併', desc: '支援一次整併多筆調班申請' },
    ],
  },
  updateScheduler: {
    name: '預約變更',
    path: '/update-scheduler',
    roles: '管理員、編輯者',
    icon: 'fa-clock',
    description: '預約病人屬性或排班規則的未來變更，到期自動生效',
    features: [
      { title: '變更總覽', desc: '查看所有待生效的預約變更' },
      { title: '新增變更', desc: '建立新的預約變更項目' },
      { title: '編輯變更', desc: '修改尚未生效的變更內容' },
      { title: '刪除變更', desc: '取消不需要的預約變更' },
      { title: '自動執行', desc: '系統會在生效日自動套用變更' },
    ],
  },
  patients: {
    name: '病人清單',
    path: '/patients',
    roles: '管理員、編輯者、貢獻者',
    icon: 'fa-hospital-user',
    description: '管理所有透析病人的基本資料',
    features: [
      { title: '分類頁籤', desc: '依 OPD（門診）、IPD（住院）、ER（急診）分類查看' },
      { title: '新增病人', desc: '建立新的病人資料' },
      { title: '編輯病人', desc: '修改病人的基本資料與排班設定' },
      { title: '刪除病人', desc: '將病人標記為已刪除（可還原）' },
      { title: '醫囑管理', desc: '查看與管理病人的透析醫囑' },
      { title: '病人歷史', desc: '查詢病人的歷史變更記錄' },
      { title: 'Excel 導入', desc: '批次匯入病人資料' },
      { title: 'Excel 導出', desc: '匯出病人清單' },
    ],
  },
  // 後臺管理
  dailyLog: {
    name: '工作日誌',
    path: '/daily-log',
    roles: '管理員、編輯者、查看者',
    icon: 'fa-book',
    description: '記錄每日營運統計、病人異常事件與醫療事項',
    features: [
      { title: '每日統計', desc: '記錄當日透析人次、異常狀況統計' },
      { title: '病人異常', desc: '記錄病人的特殊狀況或事件' },
      { title: '醫療事項', desc: '記錄重要的醫療處置或通知' },
      { title: '組長交班', desc: '護理組長的交班備註' },
      { title: '公告設定', desc: '設定跑馬燈公告內容' },
      { title: 'PDF 導出', desc: '將工作日誌匯出為 PDF 檔案' },
    ],
  },
  nursingSchedule: {
    name: '護理班表與職責',
    path: '/nursing-schedule',
    roles: '管理員、編輯者',
    icon: 'fa-user-clock',
    description: '管理護理師的班表與工作職責分配',
    features: [
      { title: '當月總班表', desc: '查看當月所有護理師的完整班表' },
      { title: '當月週班表', desc: '以週為單位查看班表' },
      { title: '護理工作職責', desc: '查看各護理師的職責分配' },
      { title: '月份選擇', desc: '切換不同月份的班表' },
      { title: 'Excel 上傳', desc: '透過 Excel 匯入班表資料' },
      { title: '組別配置', desc: '設定護理分組的配置規則' },
    ],
  },
  kiditReport: {
    name: 'KiDit 申報',
    path: '/kidit-report',
    roles: '管理員、編輯者',
    icon: 'fa-file-invoice',
    description: 'KiDit 申報工作站，管理透析申報記錄',
    features: [
      { title: '月曆視圖', desc: '以月曆形式查看申報記錄' },
      { title: '月份導航', desc: '切換不同月份查看' },
      { title: '新增記錄', desc: '建立新的申報記錄' },
      { title: '編輯記錄', desc: '修改現有的申報內容' },
      { title: 'CSV 導出', desc: '匯出申報資料為 CSV 格式' },
    ],
  },
  physicianSchedule: {
    name: '醫師班表',
    path: '/physician-schedule',
    roles: '管理員、貢獻者、查看者',
    icon: 'fa-user-md',
    description: '管理醫師的查房、會診與緊急出勤班表',
    features: [
      { title: '查房班表', desc: '查看醫師的例行查房排班' },
      { title: '會診班表', desc: '查看會診醫師的排班' },
      { title: '緊急出勤', desc: '查看緊急情況的值班醫師' },
      { title: '月份導航', desc: '切換不同月份查看' },
      { title: '行動版支援', desc: '支援手機和平板查看' },
    ],
  },
  labReports: {
    name: '檢驗報告',
    path: '/lab-reports',
    roles: '管理員、貢獻者',
    icon: 'fa-flask',
    description: '管理病人的檢驗報告資料',
    features: [
      { title: '頻率查詢', desc: '依檢驗頻率篩選報告' },
      { title: '班別查詢', desc: '依透析班別篩選' },
      { title: '個人查詢', desc: '查詢特定病人的所有報告' },
      { title: '警示報告', desc: '異常數值會特別標示' },
      { title: 'Excel 上傳', desc: '批次匯入檢驗報告' },
      { title: 'Excel 下載', desc: '匯出檢驗報告資料' },
    ],
  },
  consumables: {
    name: '每月耗材',
    path: '/consumables',
    roles: '管理員、查看者',
    icon: 'fa-boxes',
    description: '查看每月透析耗材的使用統計',
    features: [
      { title: '分組查詢', desc: '依護理分組查看耗材使用' },
      { title: '病患查詢', desc: '查詢特定病人的耗材使用' },
      { title: '耗材上傳', desc: '上傳耗材使用記錄' },
      { title: 'Excel 導出', desc: '匯出耗材統計報表' },
    ],
  },
  orders: {
    name: '藥囑管理',
    path: '/orders',
    roles: '管理員、貢獻者',
    icon: 'fa-pills',
    description: '管理病人的口服藥與針劑藥囑',
    features: [
      { title: '群組搜尋', desc: '依分組查看所有病人藥囑' },
      { title: '個人搜尋', desc: '查詢特定病人的藥囑' },
      { title: '年份選擇', desc: '切換不同年份查看' },
      { title: 'Excel 上傳', desc: '批次匯入藥囑資料' },
      { title: 'Excel 導出', desc: '匯出藥囑清單' },
    ],
  },
  reporting: {
    name: '統計報表',
    path: '/reporting',
    roles: '管理員、編輯者、貢獻者',
    icon: 'fa-chart-bar',
    description: '生成各類統計報表',
    features: [
      { title: '日報表', desc: '每日透析人次統計' },
      { title: '月報表', desc: '月度透析人次統計' },
      { title: '年報表', desc: '年度統計數據' },
      { title: '護理人力月報', desc: '護理師工作量統計' },
      { title: 'Excel 導出', desc: '匯出各類報表' },
    ],
  },
  userManagement: {
    name: '使用者管理',
    path: '/user-management',
    roles: '僅管理員',
    icon: 'fa-users-cog',
    description: '管理平台使用者帳號與權限',
    features: [
      { title: '新增使用者', desc: '建立新的使用者帳號' },
      { title: '編輯使用者', desc: '修改使用者資料與權限' },
      { title: '刪除使用者', desc: '停用或刪除使用者帳號' },
      { title: '角色分配', desc: '設定使用者的角色權限' },
      { title: '過期帳戶', desc: '管理過期或停用的帳戶' },
      { title: '強制同步', desc: '強制同步使用者資料' },
      { title: 'Google Drive', desc: '上傳資料至 Google Drive 備份' },
    ],
  },
}

function togglePage(pageKey) {
  expandedPages.value[pageKey] = !expandedPages.value[pageKey]
}

const getTypeColor = (type) => {
  switch (type) {
    case 'feat':
      return '#10b981'
    case 'fix':
      return '#f59e0b'
    case 'docs':
      return '#3b82f6'
    case 'refactor':
      return '#8b5cf6'
    default:
      return '#6b7280'
  }
}

const getTypeLabel = (type) => {
  switch (type) {
    case 'feat':
      return '新增'
    case 'fix':
      return '修正'
    case 'docs':
      return '文件'
    case 'refactor':
      return '重構'
    default:
      return '其他'
  }
}
</script>

<template>
  <div class="usage-guide-container">
    <!-- 頂部標題 -->
    <header class="guide-header">
      <h1><i class="fas fa-book-open"></i> 平台使用說明</h1>
      <p class="subtitle">部北透析管理平台完整操作指南</p>
    </header>

    <div class="guide-content">
      <!-- 側邊導覽 -->
      <nav class="guide-nav">
        <ul>
          <li
            v-for="section in sections"
            :key="section.id"
            :class="{ active: activeSection === section.id }"
            @click="activeSection = section.id"
          >
            <i :class="['fas', section.icon]"></i>
            <span>{{ section.name }}</span>
          </li>
        </ul>
      </nav>

      <!-- 主要內容區 -->
      <main class="guide-main">
        <!-- 平台總覽 -->
        <section v-if="activeSection === 'overview'" class="guide-section">
          <h2><i class="fas fa-home"></i> 平台總覽</h2>

          <div class="overview-card">
            <h3>關於本平台</h3>
            <p>
              部北透析管理平台是專為透析室設計的完整管理系統，提供排班管理、護理分組、病人管理、
              工作協作等功能，協助團隊提升工作效率與照護品質。
            </p>
          </div>

          <div class="overview-card">
            <h3>角色與權限</h3>
            <div class="role-grid">
              <div class="role-item">
                <div class="role-badge admin">管理員</div>
                <p>完整存取所有功能，包含使用者管理</p>
              </div>
              <div class="role-item">
                <div class="role-badge editor">編輯者</div>
                <p>護理師角色，管理排班、分組、工作日誌</p>
              </div>
              <div class="role-item">
                <div class="role-badge contributor">貢獻者</div>
                <p>醫師角色，管理醫囑、檢驗報告、醫師班表</p>
              </div>
              <div class="role-item">
                <div class="role-badge viewer">查看者</div>
                <p>查閱權限，檢視日誌、耗材、醫師班表</p>
              </div>
            </div>
          </div>

          <div class="overview-card">
            <h3>側邊欄結構</h3>
            <div class="sidebar-structure">
              <div class="structure-group">
                <h4>共用功能區</h4>
                <ul>
                  <li>每日排程 - 當日透析排班</li>
                  <li>護理分組 - 護理師分組分配</li>
                  <li>我的今日病人 - 個人負責病人</li>
                  <li>訊息中心 - 協作與通知</li>
                </ul>
              </div>
              <div class="structure-group">
                <h4>排班管理（管理員/編輯者）</h4>
                <ul>
                  <li>週排班 - 一週排班總覽</li>
                  <li>床位總表 - 完整床位管理</li>
                  <li>調班換床 - 例外排班管理</li>
                  <li>預約變更 - 未來變更排程</li>
                </ul>
              </div>
              <div class="structure-group">
                <h4>後臺管理</h4>
                <ul>
                  <li>工作日誌、護理班表、KiDit 申報</li>
                  <li>醫師班表、檢驗報告、藥囑管理</li>
                  <li>每月耗材、統計報表、使用者管理</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        <!-- 共用功能 -->
        <section v-if="activeSection === 'common'" class="guide-section">
          <h2><i class="fas fa-users"></i> 共用功能</h2>
          <p class="section-desc">所有使用者皆可使用的核心功能</p>

          <div
            v-for="(page, key) in {
              schedule: pageGuides.schedule,
              stats: pageGuides.stats,
              myPatients: pageGuides.myPatients,
              collaboration: pageGuides.collaboration,
            }"
            :key="key"
            class="page-card"
          >
            <div class="page-header" @click="togglePage(key)">
              <div class="page-title">
                <i :class="['fas', page.icon]"></i>
                <h3>{{ page.name }}</h3>
                <span class="page-path">{{ page.path }}</span>
              </div>
              <div class="page-meta">
                <span class="role-tag">{{ page.roles }}</span>
                <i :class="['fas', expandedPages[key] ? 'fa-chevron-up' : 'fa-chevron-down']"></i>
              </div>
            </div>
            <div v-if="expandedPages[key]" class="page-content">
              <p class="page-desc">{{ page.description }}</p>
              <div class="feature-list">
                <div v-for="(feature, idx) in page.features" :key="idx" class="feature-item">
                  <span class="feature-title">{{ feature.title }}</span>
                  <span class="feature-desc">{{ feature.desc }}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- 排班管理 -->
        <section v-if="activeSection === 'admin-editor'" class="guide-section">
          <h2><i class="fas fa-calendar-alt"></i> 排班管理</h2>
          <p class="section-desc">管理員與編輯者專用的排班管理功能</p>

          <div
            v-for="(page, key) in {
              weekly: pageGuides.weekly,
              baseSchedule: pageGuides.baseSchedule,
              exceptionManager: pageGuides.exceptionManager,
              updateScheduler: pageGuides.updateScheduler,
              patients: pageGuides.patients,
            }"
            :key="key"
            class="page-card"
          >
            <div class="page-header" @click="togglePage(key)">
              <div class="page-title">
                <i :class="['fas', page.icon]"></i>
                <h3>{{ page.name }}</h3>
                <span class="page-path">{{ page.path }}</span>
              </div>
              <div class="page-meta">
                <span class="role-tag">{{ page.roles }}</span>
                <i :class="['fas', expandedPages[key] ? 'fa-chevron-up' : 'fa-chevron-down']"></i>
              </div>
            </div>
            <div v-if="expandedPages[key]" class="page-content">
              <p class="page-desc">{{ page.description }}</p>
              <div class="feature-list">
                <div v-for="(feature, idx) in page.features" :key="idx" class="feature-item">
                  <span class="feature-title">{{ feature.title }}</span>
                  <span class="feature-desc">{{ feature.desc }}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- 後臺管理 -->
        <section v-if="activeSection === 'backend'" class="guide-section">
          <h2><i class="fas fa-cog"></i> 後臺管理</h2>
          <p class="section-desc">依角色權限提供的後臺管理功能</p>

          <div
            v-for="(page, key) in {
              dailyLog: pageGuides.dailyLog,
              nursingSchedule: pageGuides.nursingSchedule,
              kiditReport: pageGuides.kiditReport,
              physicianSchedule: pageGuides.physicianSchedule,
              labReports: pageGuides.labReports,
              consumables: pageGuides.consumables,
              orders: pageGuides.orders,
              reporting: pageGuides.reporting,
              userManagement: pageGuides.userManagement,
            }"
            :key="key"
            class="page-card"
          >
            <div class="page-header" @click="togglePage(key)">
              <div class="page-title">
                <i :class="['fas', page.icon]"></i>
                <h3>{{ page.name }}</h3>
                <span class="page-path">{{ page.path }}</span>
              </div>
              <div class="page-meta">
                <span class="role-tag">{{ page.roles }}</span>
                <i :class="['fas', expandedPages[key] ? 'fa-chevron-up' : 'fa-chevron-down']"></i>
              </div>
            </div>
            <div v-if="expandedPages[key]" class="page-content">
              <p class="page-desc">{{ page.description }}</p>
              <div class="feature-list">
                <div v-for="(feature, idx) in page.features" :key="idx" class="feature-item">
                  <span class="feature-title">{{ feature.title }}</span>
                  <span class="feature-desc">{{ feature.desc }}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- 版本更新 -->
        <section v-if="activeSection === 'changelog'" class="guide-section">
          <h2><i class="fas fa-history"></i> 版本更新記錄</h2>
          <p class="section-desc">平台功能更新與修正歷史</p>

          <div class="changelog-timeline">
            <div v-for="(release, idx) in changelog" :key="idx" class="changelog-item">
              <div class="changelog-header">
                <span class="changelog-version">{{ release.version }}</span>
                <h3 class="changelog-title">{{ release.title }}</h3>
              </div>
              <ul class="changelog-list">
                <li v-for="(change, cIdx) in release.changes" :key="cIdx">
                  <span class="change-type" :style="{ backgroundColor: getTypeColor(change.type) }">
                    {{ getTypeLabel(change.type) }}
                  </span>
                  <span class="change-text">{{ change.text }}</span>
                </li>
              </ul>
            </div>
          </div>
        </section>
      </main>
    </div>
  </div>
</template>

<style scoped>
.usage-guide-container {
  min-height: 100%;
  background-color: #f8fafc;
}

.guide-header {
  background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%);
  color: white;
  padding: 2rem;
  text-align: center;
}

.guide-header h1 {
  margin: 0;
  font-size: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
}

.guide-header .subtitle {
  margin: 0.5rem 0 0;
  opacity: 0.9;
  font-size: 1.1rem;
}

.guide-content {
  display: flex;
  max-width: 1400px;
  margin: 0 auto;
  padding: 1.5rem;
  gap: 1.5rem;
}

/* 側邊導覽 */
.guide-nav {
  width: 200px;
  flex-shrink: 0;
  position: sticky;
  top: 1.5rem;
  height: fit-content;
}

.guide-nav ul {
  list-style: none;
  padding: 0;
  margin: 0;
  background: white;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  overflow: hidden;
}

.guide-nav li {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem 1.25rem;
  cursor: pointer;
  transition: all 0.2s;
  border-left: 3px solid transparent;
}

.guide-nav li:hover {
  background-color: #f1f5f9;
}

.guide-nav li.active {
  background-color: #e0f2fe;
  border-left-color: var(--primary-color, #0ea5e9);
  color: var(--primary-color, #0ea5e9);
  font-weight: 600;
}

.guide-nav li i {
  width: 20px;
  text-align: center;
}

/* 主要內容區 */
.guide-main {
  flex: 1;
  min-width: 0;
}

.guide-section h2 {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin: 0 0 0.5rem;
  color: #1e293b;
  font-size: 1.5rem;
}

.section-desc {
  color: #64748b;
  margin: 0 0 1.5rem;
}

/* 總覽卡片 */
.overview-card {
  background: white;
  border-radius: 12px;
  padding: 1.5rem;
  margin-bottom: 1rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.overview-card h3 {
  margin: 0 0 1rem;
  color: #334155;
  font-size: 1.1rem;
}

.overview-card p {
  margin: 0;
  color: #64748b;
  line-height: 1.7;
}

/* 角色網格 */
.role-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
}

.role-item {
  padding: 1rem;
  background: #f8fafc;
  border-radius: 8px;
}

.role-badge {
  display: inline-block;
  padding: 0.25rem 0.75rem;
  border-radius: 20px;
  font-size: 0.85rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
}

.role-badge.admin {
  background: #fef3c7;
  color: #92400e;
}
.role-badge.editor {
  background: #dbeafe;
  color: #1e40af;
}
.role-badge.contributor {
  background: #d1fae5;
  color: #065f46;
}
.role-badge.viewer {
  background: #f3e8ff;
  color: #6b21a8;
}

.role-item p {
  margin: 0;
  font-size: 0.9rem;
  color: #64748b;
}

/* 側邊欄結構 */
.sidebar-structure {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 1.5rem;
}

.structure-group h4 {
  margin: 0 0 0.75rem;
  color: #475569;
  font-size: 0.95rem;
}

.structure-group ul {
  margin: 0;
  padding-left: 1.25rem;
  color: #64748b;
  font-size: 0.9rem;
  line-height: 1.8;
}

/* 頁面卡片 */
.page-card {
  background: white;
  border-radius: 12px;
  margin-bottom: 1rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  overflow: hidden;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.25rem 1.5rem;
  cursor: pointer;
  transition: background-color 0.2s;
}

.page-header:hover {
  background-color: #f8fafc;
}

.page-title {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.page-title i {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #e0f2fe;
  color: var(--primary-color, #0ea5e9);
  border-radius: 6px;
  font-size: 0.85rem;
}

.page-title h3 {
  margin: 0;
  font-size: 1.1rem;
  color: #1e293b;
}

.page-path {
  font-size: 0.85rem;
  color: #94a3b8;
  font-family: monospace;
}

.page-meta {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.role-tag {
  font-size: 0.8rem;
  color: #64748b;
  background: #f1f5f9;
  padding: 0.25rem 0.75rem;
  border-radius: 20px;
}

.page-content {
  padding: 0 1.5rem 1.5rem;
  border-top: 1px solid #f1f5f9;
}

.page-desc {
  margin: 1rem 0;
  color: #64748b;
}

.feature-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 0.75rem;
}

.feature-item {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.75rem 1rem;
  background: #f8fafc;
  border-radius: 8px;
  border-left: 3px solid var(--primary-color, #0ea5e9);
}

.feature-title {
  font-weight: 600;
  color: #334155;
  font-size: 0.95rem;
}

.feature-desc {
  font-size: 0.85rem;
  color: #64748b;
}

/* 版本更新時間線 */
.changelog-timeline {
  position: relative;
}

.changelog-item {
  background: white;
  border-radius: 12px;
  padding: 1.5rem;
  margin-bottom: 1rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.changelog-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1rem;
}

.changelog-version {
  background: linear-gradient(135deg, #2c3e50, #34495e);
  color: white;
  padding: 0.35rem 0.85rem;
  border-radius: 20px;
  font-size: 0.85rem;
  font-weight: 600;
}

.changelog-title {
  margin: 0;
  font-size: 1.1rem;
  color: #1e293b;
}

.changelog-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.changelog-list li {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid #f1f5f9;
}

.changelog-list li:last-child {
  border-bottom: none;
}

.change-type {
  flex-shrink: 0;
  padding: 0.2rem 0.6rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  color: white;
}

.change-text {
  color: #475569;
  font-size: 0.95rem;
  line-height: 1.5;
}

/* 響應式設計 */
@media (max-width: 992px) {
  .guide-content {
    flex-direction: column;
  }

  .guide-nav {
    width: 100%;
    position: static;
  }

  .guide-nav ul {
    display: flex;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  .guide-nav li {
    flex-shrink: 0;
    border-left: none;
    border-bottom: 3px solid transparent;
  }

  .guide-nav li.active {
    border-left-color: transparent;
    border-bottom-color: var(--primary-color, #0ea5e9);
  }
}

@media (max-width: 768px) {
  .guide-header {
    padding: 1.5rem 1rem;
  }

  .guide-header h1 {
    font-size: 1.5rem;
  }

  .guide-content {
    padding: 1rem;
  }

  .page-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;
  }

  .page-meta {
    width: 100%;
    justify-content: space-between;
  }

  .feature-list {
    grid-template-columns: 1fr;
  }

  .changelog-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
  }
}
</style>
