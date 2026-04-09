// 檔案路徑: src/router/index.ts (修改後版本)

import { createRouter, createWebHistory } from 'vue-router'
import { useAuth } from '@/composables/useAuth'
import MainLayout from '@/layouts/MainLayout.vue'

// ✨ 1. 在頂部引入醫師排班相關的元件 (此處保持不變)
import PhysicianScheduleView from '@/views/PhysicianScheduleView.vue'

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/LoginView.vue'),
    meta: { requiresAuth: false },
  },
  {
    path: '/',
    component: MainLayout,
    meta: { requiresAuth: true },
    children: [
      { path: '', name: 'Home', redirect: '/collaboration' },
      {
        path: 'schedule',
        name: 'Schedule',
        component: () => import('@/views/ScheduleView.vue'),
        meta: { title: '每日排程表' },
      },
      {
        path: 'weekly',
        name: 'Weekly',
        component: () => import('@/views/WeeklyView.vue'),
        meta: { title: '週排班表' },
      },
      {
        path: 'base-schedule',
        name: 'BaseSchedule',
        component: () => import('@/views/BaseScheduleView.vue'),
        meta: { title: '門急住床位總表' },
      },
      {
        path: 'physician-schedule',
        component: PhysicianScheduleView,
        redirect: '/physician-schedule/rounding',
        meta: { title: '醫師排班', roles: ['admin', 'contributor', 'viewer'] },
        children: [
          {
            path: 'rounding',
            name: 'PhysicianRoundingSchedule',
            component: PhysicianScheduleView,
            meta: { title: '查房班表', roles: ['admin', 'contributor', 'viewer'] },
          },
        ],
      },
      {
        path: 'exception-manager',
        name: 'ExceptionManager',
        component: () => import('@/views/ExceptionManagerView.vue'),
        meta: { title: '調班管理', requiresAuth: true },
      },
      {
        path: 'update-scheduler',
        name: 'UpdateScheduler',
        component: () => import('@/views/UpdateSchedulerView.vue'),
        meta: {
          title: '預約變更總覽',
          requiresAuth: true,
        },
      },
      {
        path: 'patients',
        name: 'Patients',
        component: () => import('@/views/PatientsView.vue'),
        meta: { title: '病人管理' },
      },
      {
        path: 'stats',
        name: 'Stats',
        component: () => import('@/views/StatsView.vue'),
        meta: { title: '護理分組檢視' },
      },
      {
        path: 'reporting',
        name: 'Reporting',
        component: () => import('@/views/ReportingView.vue'),
        meta: { title: '統計報表' },
      },
      {
        path: 'user-management',
        name: 'UserManagement',
        component: () => import('@/views/UserManagementView.vue'),
        meta: { title: '使用者管理', requiresAdmin: true },
      },
      {
        path: 'lab-reports',
        name: 'LabReports',
        component: () => import('@/views/LabReportView.vue'),
        meta: { title: '檢驗報告管理', requiresAuth: true },
      },
      {
        path: 'inventory',
        name: 'Inventory',
        component: () => import('@/views/InventoryView.vue'),
        meta: { title: '庫存管理', requiresAuth: true },
      },
      {
        path: 'account-settings',
        name: 'AccountSettings',
        component: () => import('@/views/AccountSettingsView.vue'),
        meta: { title: '帳號設定' },
      },
      {
        path: '/daily-log',
        name: 'DailyLog',
        component: () => import('../views/DailyLogView.vue'),
        meta: {
          title: '工作日誌',
          requiresAuth: true,
          // ✨ 修改點：加上 'viewer'，允許所有人進入查看
          roles: ['admin', 'editor', 'viewer'],
        },
      },
      {
        path: 'collaboration',
        name: 'Collaboration',
        component: () => import('@/views/CollaborationView.vue'),
        meta: { title: '協作訊息中心', requiresAuth: true },
      },
      {
        path: '/orders',
        name: 'Orders',
        component: () => import('@/views/OrdersView.vue'),
        meta: { title: '藥囑管理', requiredAuth: true, roles: ['contributor', 'editor', 'admin'] },
      },
      {
        path: 'my-patients',
        name: 'MyPatients',
        component: () => import('@/views/MyPatientsView.vue'),
        meta: {
          title: '我的今日病人',
          requiresAuth: true,
        },
      },
      {
        path: 'nursing-schedule',
        name: 'NursingSchedule',
        component: () => import('@/views/NursingScheduleView.vue'),
        meta: {
          title: '護理班表與職責',
          requiresAuth: true,
        },
      },
      // ✨✨✨【新增這段】✨✨✨
      {
        path: 'kidit-report',
        name: 'KiDitReport',
        component: () => import('@/views/PatientMovementReportView.vue'),
        meta: {
          title: 'KiDit 申報工作站',
          requiresAuth: true,
          // 如果您原本的路由有在使用 roles 陣列控制，請加上下面這行
          // roles: ['admin', 'editor']
        },
      },
      {
        path: 'usage-guide',
        name: 'UsageGuide',
        component: () => import('@/views/UsageGuideView.vue'),
        meta: {
          title: '平台使用說明',
          requiresAuth: true,
        },
      },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

// ==========================================================
// ✨✨✨【核心修改處】✨✨✨
// 在路由守衛中加入職稱判斷邏輯
// ==========================================================
router.beforeEach(async (to, from, next) => {
  const { isLoggedIn, isAdmin, waitForAuthInit, currentUser } = useAuth()
  await waitForAuthInit()

  const requiresAuth = to.matched.some((record) => record.meta.requiresAuth)
  const requiresAdmin = to.matched.some((record) => record.meta.requiresAdmin)
  const requiredRoles = to.matched.flatMap((record) => record.meta.roles || [])

  // 1. 如果目標頁面需要登入，但使用者未登入 -> 導向登入頁
  if (requiresAuth && !isLoggedIn.value) {
    next({ name: 'Login', query: { redirect: to.fullPath } })

    // 2. 如果使用者已登入，但又試圖訪問登入頁 -> 根據職稱決定導向何處
  } else if (to.name === 'Login' && isLoggedIn.value) {
    const userTitle = currentUser.value?.title // 獲取當前使用者的職稱

    // ✨ 新增的判斷邏輯
    if (userTitle === '護理師' || userTitle === '護理師組長') {
      // 如果是護理師或組長，導向「我的今日病人」
      next({ name: 'MyPatients' })
    } else {
      // 其他所有角色，維持原樣，導向「協作訊息中心」
      next({ name: 'Collaboration' })
    }

    // 3. 如果目標頁面需要管理員權限，但使用者不是管理員 -> 導向預設頁面
  } else if (requiresAdmin && !isAdmin.value) {
    console.warn(`權限不足：用戶角色 (${currentUser.value?.role}) 無法訪問管理員頁面。`)
    next({ name: 'Schedule' })

    // 4. 如果目標頁面需要特定角色，但使用者角色不符 -> 導向預設頁面
  } else if (requiredRoles.length > 0 && !requiredRoles.includes(currentUser.value?.role ?? '')) {
    console.warn(`權限不足：用戶角色 (${currentUser.value?.role}) 無法訪問此頁面。`)
    next({ name: 'Schedule' })

    // 5. 所有檢查都通過 -> 允許導航
  } else {
    next()
  }
})

export default router
