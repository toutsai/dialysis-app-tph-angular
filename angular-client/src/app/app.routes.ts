import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { adminGuard } from './core/guards/admin.guard';
import { roleGuard } from './core/guards/role.guard';

// === 角色矩陣（與 Vue 端 STAFF_ROLES / CLINICAL_ROLES 等一致）===
const ALL_ROLES = ['admin', 'editor', 'contributor', 'viewer'];
const STAFF_ROLES = ['admin', 'editor']; // 組長專用
const CLINICAL_ROLES = ['admin', 'editor', 'contributor']; // 病人/檢驗類
const DOCTOR_ROLES = ['admin', 'contributor']; // 醫囑/醫師相關

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () =>
      import('./features/login/login.component').then(
        (m) => m.LoginComponent
      ),
  },
  {
    path: '',
    loadComponent: () =>
      import('./layouts/main-layout.component').then(
        (m) => m.MainLayoutComponent
      ),
    canActivate: [authGuard],
    children: [
      // 預設先導向「我的病人」；若該使用者無權看，會自動回退到「每日排程」
      { path: '', redirectTo: 'my-patients', pathMatch: 'full' },
      {
        path: 'schedule',
        loadComponent: () =>
          import('./features/schedule/schedule.component').then(
            (m) => m.ScheduleComponent
          ),
        canActivate: [roleGuard],
        data: { title: '每日排程表', roles: ALL_ROLES },
      },
      {
        path: 'weekly',
        loadComponent: () =>
          import('./features/weekly/weekly.component').then(
            (m) => m.WeeklyComponent
          ),
        canActivate: [roleGuard],
        data: { title: '週排班表', roles: STAFF_ROLES },
      },
      {
        path: 'base-schedule',
        loadComponent: () =>
          import('./features/base-schedule/base-schedule.component').then(
            (m) => m.BaseScheduleComponent
          ),
        canActivate: [roleGuard],
        data: { title: '門急住床位總表', roles: STAFF_ROLES },
      },
      {
        path: 'physician-schedule',
        loadComponent: () =>
          import(
            './features/physician-schedule/physician-schedule.component'
          ).then((m) => m.PhysicianScheduleComponent),
        canActivate: [roleGuard],
        data: { title: '醫師排班', roles: DOCTOR_ROLES },
      },
      {
        path: 'exception-manager',
        loadComponent: () =>
          import(
            './features/exception-manager/exception-manager.component'
          ).then((m) => m.ExceptionManagerComponent),
        canActivate: [roleGuard],
        data: { title: '調班管理', roles: STAFF_ROLES },
      },
      {
        path: 'update-scheduler',
        loadComponent: () =>
          import(
            './features/update-scheduler/update-scheduler.component'
          ).then((m) => m.UpdateSchedulerComponent),
        canActivate: [roleGuard],
        data: { title: '預約變更總覽', roles: STAFF_ROLES },
      },
      {
        path: 'patients',
        loadComponent: () =>
          import('./features/patients/patients.component').then(
            (m) => m.PatientsComponent
          ),
        canActivate: [roleGuard],
        data: { title: '病人管理', roles: CLINICAL_ROLES },
      },
      {
        path: 'stats',
        loadComponent: () =>
          import('./features/stats/stats.component').then(
            (m) => m.StatsComponent
          ),
        canActivate: [roleGuard],
        data: { title: '護理分組檢視', roles: ALL_ROLES },
      },
      {
        path: 'reporting',
        loadComponent: () =>
          import('./features/reporting/reporting.component').then(
            (m) => m.ReportingComponent
          ),
        canActivate: [roleGuard],
        data: { title: '統計報表', roles: STAFF_ROLES },
      },
      {
        path: 'user-management',
        loadComponent: () =>
          import(
            './features/user-management/user-management.component'
          ).then((m) => m.UserManagementComponent),
        canActivate: [adminGuard],
        data: { title: '使用者管理' },
      },
      {
        path: 'lab-reports',
        loadComponent: () =>
          import('./features/lab-reports/lab-reports.component').then(
            (m) => m.LabReportsComponent
          ),
        canActivate: [roleGuard],
        data: { title: '檢驗報告管理', roles: CLINICAL_ROLES },
      },
      {
        path: 'inventory',
        loadComponent: () =>
          import('./features/inventory/inventory.component').then(
            (m) => m.InventoryComponent
          ),
        canActivate: [roleGuard],
        data: { title: '庫存管理', roles: STAFF_ROLES },
      },
      {
        path: 'account-settings',
        loadComponent: () =>
          import(
            './features/account-settings/account-settings.component'
          ).then((m) => m.AccountSettingsComponent),
        data: { title: '帳號設定' },
      },
      {
        path: 'daily-log',
        loadComponent: () =>
          import('./features/daily-log/daily-log.component').then(
            (m) => m.DailyLogComponent
          ),
        canActivate: [roleGuard],
        data: { title: '工作日誌', roles: ALL_ROLES },
      },
      {
        path: 'collaboration',
        loadComponent: () =>
          import('./features/collaboration/collaboration.component').then(
            (m) => m.CollaborationComponent
          ),
        data: { title: '協作訊息中心' },
      },
      {
        path: 'orders',
        loadComponent: () =>
          import('./features/orders/orders.component').then(
            (m) => m.OrdersComponent
          ),
        canActivate: [roleGuard],
        // 藥囑：依新 RBAC，editor 不再有權限
        data: { title: '藥囑管理', roles: DOCTOR_ROLES },
      },
      {
        path: 'my-patients',
        loadComponent: () =>
          import('./features/my-patients/my-patients.component').then(
            (m) => m.MyPatientsComponent
          ),
        canActivate: [roleGuard],
        data: { title: '我的今日病人', roles: STAFF_ROLES },
      },
      {
        path: 'nursing-schedule',
        loadComponent: () =>
          import(
            './features/nursing-schedule/nursing-schedule.component'
          ).then((m) => m.NursingScheduleComponent),
        canActivate: [roleGuard],
        data: { title: '護理班表與職責', roles: STAFF_ROLES },
      },
      {
        path: 'kidit-report',
        loadComponent: () =>
          import('./features/kidit-report/kidit-report.component').then(
            (m) => m.KiditReportComponent
          ),
        canActivate: [roleGuard],
        data: { title: 'KiDit 申報工作站', roles: STAFF_ROLES },
      },
      {
        path: 'usage-guide',
        loadComponent: () =>
          import('./features/usage-guide/usage-guide.component').then(
            (m) => m.UsageGuideComponent
          ),
        data: { title: '平台使用說明' },
      },
      {
        path: 'consumables',
        loadComponent: () =>
          import('./features/consumables/consumables.component').then(
            (m) => m.ConsumablesComponent
          ),
        data: { title: '每月耗材總表' },
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
