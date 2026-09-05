import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { roleGuard } from './core/guards/role.guard';
import { specialistGuard } from './core/guards/specialist.guard';
import { PAGE_ACCESS } from './core/config/page-access';

/** 醫師專用（2026-09-05）：四頁整合為主頁籤；舊路由保留為別名（載入同一頁並以 data.tab 帶對應頁籤） */
const loadPhysicianHub = () =>
  import('./features/physician-hub/physician-hub.component').then((m) => m.PhysicianHubComponent);

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () =>
      import('./features/login/login.component').then(
        (m) => m.LoginComponent
      ),
  },
  {
    path: 'bed-dashboard/:bedKey',
    loadComponent: () =>
      import('./features/bed-dashboard/bed-dashboard.component').then(
        (m) => m.BedDashboardComponent
      ),
  },
  {
    // 住院趴趴走獨立展示頁：刻意免登入（資料已在後端遮罩姓名、去除病歷號）
    path: 'inpatient-rounds-board',
    loadComponent: () =>
      import('./features/inpatient-rounds-board/inpatient-rounds-board.component').then(
        (m) => m.InpatientRoundsBoardComponent
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
        data: {
          title: PAGE_ACCESS.schedule.title,
          roles: PAGE_ACCESS.schedule.roles,
        },
      },
      {
        path: 'weekly',
        loadComponent: () =>
          import('./features/weekly/weekly.component').then(
            (m) => m.WeeklyComponent
          ),
        canActivate: [roleGuard],
        data: { title: PAGE_ACCESS.weekly.title, roles: PAGE_ACCESS.weekly.roles },
      },
      {
        path: 'base-schedule',
        loadComponent: () =>
          import('./features/base-schedule/base-schedule.component').then(
            (m) => m.BaseScheduleComponent
          ),
        canActivate: [roleGuard],
        data: {
          title: PAGE_ACCESS.baseSchedule.title,
          roles: PAGE_ACCESS.baseSchedule.roles,
        },
      },
      {
        path: 'physician',
        loadComponent: loadPhysicianHub,
        canActivate: [roleGuard],
        data: {
          title: PAGE_ACCESS.physicianHub.title,
          roles: PAGE_ACCESS.physicianHub.roles,
        },
      },
      {
        // 別名：醫師專用 → 醫師班表
        path: 'physician-schedule',
        loadComponent: loadPhysicianHub,
        canActivate: [roleGuard],
        data: {
          title: PAGE_ACCESS.physicianHub.title,
          roles: PAGE_ACCESS.physicianSchedule.roles,
          tab: 'schedule',
        },
      },
      {
        path: 'exception-manager',
        loadComponent: () =>
          import(
            './features/exception-manager/exception-manager.component'
          ).then((m) => m.ExceptionManagerComponent),
        canActivate: [roleGuard],
        data: {
          title: PAGE_ACCESS.exceptionManager.title,
          roles: PAGE_ACCESS.exceptionManager.roles,
        },
      },
      {
        path: 'update-scheduler',
        loadComponent: () =>
          import(
            './features/update-scheduler/update-scheduler.component'
          ).then((m) => m.UpdateSchedulerComponent),
        canActivate: [roleGuard],
        data: {
          title: PAGE_ACCESS.updateScheduler.title,
          roles: PAGE_ACCESS.updateScheduler.roles,
        },
      },
      {
        path: 'patients',
        loadComponent: () =>
          import('./features/patients/patients.component').then(
            (m) => m.PatientsComponent
          ),
        canActivate: [roleGuard],
        data: { title: PAGE_ACCESS.patients.title, roles: PAGE_ACCESS.patients.roles },
      },
      {
        path: 'stats',
        loadComponent: () =>
          import('./features/stats/stats.component').then(
            (m) => m.StatsComponent
          ),
        canActivate: [roleGuard],
        data: { title: PAGE_ACCESS.stats.title, roles: PAGE_ACCESS.stats.roles },
      },
      {
        path: 'reporting',
        loadComponent: () =>
          import('./features/reporting/reporting.component').then(
            (m) => m.ReportingComponent
          ),
        canActivate: [roleGuard],
        data: {
          title: PAGE_ACCESS.reporting.title,
          roles: PAGE_ACCESS.reporting.roles,
        },
      },
      {
        path: 'aki-map',
        loadComponent: () =>
          import('./features/aki-map/aki-map.component').then(
            (m) => m.AkiMapComponent
          ),
        canActivate: [specialistGuard],
        data: { title: '腎臟病地圖' },
      },
      {
        path: 'user-management',
        loadComponent: () =>
          import(
            './features/user-management/user-management.component'
          ).then((m) => m.UserManagementComponent),
        canActivate: [roleGuard],
        data: {
          title: PAGE_ACCESS.userManagement.title,
          roles: PAGE_ACCESS.userManagement.roles,
        },
      },
      {
        path: 'education-dashboard',
        loadComponent: () =>
          import(
            './features/education-dashboard/education-dashboard.component'
          ).then((m) => m.EducationDashboardComponent),
        canActivate: [roleGuard],
        data: {
          title: PAGE_ACCESS.educationDashboard.title,
          roles: PAGE_ACCESS.educationDashboard.roles,
        },
      },
      {
        path: 'lab-reports',
        loadComponent: () =>
          import('./features/lab-reports/lab-reports.component').then(
            (m) => m.LabReportsComponent
          ),
        canActivate: [roleGuard],
        data: {
          title: PAGE_ACCESS.labReports.title,
          roles: PAGE_ACCESS.labReports.roles,
        },
      },
      {
        path: 'inventory',
        loadComponent: () =>
          import('./features/inventory/inventory.component').then(
            (m) => m.InventoryComponent
          ),
        canActivate: [roleGuard],
        data: {
          title: PAGE_ACCESS.inventory.title,
          roles: PAGE_ACCESS.inventory.roles,
        },
      },
      {
        path: 'account-settings',
        loadComponent: () =>
          import(
            './features/account-settings/account-settings.component'
          ).then((m) => m.AccountSettingsComponent),
        canActivate: [roleGuard],
        data: {
          title: PAGE_ACCESS.accountSettings.title,
          roles: PAGE_ACCESS.accountSettings.roles,
        },
      },
      {
        path: 'daily-log',
        loadComponent: () =>
          import('./features/daily-log/daily-log.component').then(
            (m) => m.DailyLogComponent
          ),
        canActivate: [roleGuard],
        data: {
          title: PAGE_ACCESS.dailyLog.title,
          roles: PAGE_ACCESS.dailyLog.roles,
        },
      },
      {
        path: 'collaboration',
        loadComponent: () =>
          import('./features/collaboration/collaboration.component').then(
            (m) => m.CollaborationComponent
          ),
        canActivate: [roleGuard],
        data: {
          title: PAGE_ACCESS.collaboration.title,
          roles: PAGE_ACCESS.collaboration.roles,
        },
      },
      {
        // 別名：醫師專用 → 醫囑藥囑管理
        path: 'orders',
        loadComponent: loadPhysicianHub,
        canActivate: [roleGuard],
        data: { title: PAGE_ACCESS.physicianHub.title, roles: PAGE_ACCESS.orders.roles, tab: 'orders' },
      },
      {
        // 別名：醫師專用 → 醫師藥物調整
        path: 'med-adjustment',
        loadComponent: loadPhysicianHub,
        canActivate: [roleGuard],
        data: { title: PAGE_ACCESS.physicianHub.title, roles: PAGE_ACCESS.medAdjustment.roles, tab: 'med' },
      },
      {
        path: 'catastrophic-illness',
        loadComponent: () =>
          import('./features/catastrophic-illness/catastrophic-illness.component').then(
            (m) => m.CatastrophicIllnessComponent
          ),
        canActivate: [roleGuard],
        data: { title: PAGE_ACCESS.catastrophicIllness.title, roles: PAGE_ACCESS.catastrophicIllness.roles },
      },
      {
        // 別名：醫師專用 → 研究專用
        path: 'research',
        loadComponent: loadPhysicianHub,
        canActivate: [roleGuard],
        data: { title: PAGE_ACCESS.physicianHub.title, roles: PAGE_ACCESS.research.roles, tab: 'research' },
      },
      {
        path: 'my-patients',
        loadComponent: () =>
          import('./features/my-patients/my-patients.component').then(
            (m) => m.MyPatientsComponent
          ),
        canActivate: [roleGuard],
        data: {
          title: PAGE_ACCESS.myPatients.title,
          roles: PAGE_ACCESS.myPatients.roles,
        },
      },
      {
        path: 'nursing-schedule',
        loadComponent: () =>
          import(
            './features/nursing-schedule/nursing-schedule.component'
          ).then((m) => m.NursingScheduleComponent),
        canActivate: [roleGuard],
        data: {
          title: PAGE_ACCESS.nursingSchedule.title,
          roles: PAGE_ACCESS.nursingSchedule.roles,
        },
      },
      {
        path: 'kidit-report',
        loadComponent: () =>
          import('./features/kidit-report/kidit-report.component').then(
            (m) => m.KiditReportComponent
          ),
        canActivate: [roleGuard],
        data: {
          title: PAGE_ACCESS.kiditReport.title,
          roles: PAGE_ACCESS.kiditReport.roles,
        },
      },
      {
        path: 'dialysis-reservation',
        loadComponent: () =>
          import('./features/dialysis-reservation/dialysis-reservation.component').then(
            (m) => m.DialysisReservationComponent
          ),
        canActivate: [roleGuard],
        data: {
          title: PAGE_ACCESS.dialysisReservation.title,
          roles: PAGE_ACCESS.dialysisReservation.roles,
        },
      },
      {
        path: 'kidit-quarterly-input',
        loadComponent: () =>
          import('./features/kidit-quarterly-input/kidit-quarterly-input.component').then(
            (m) => m.KiditQuarterlyInputComponent
          ),
        canActivate: [roleGuard],
        data: {
          title: PAGE_ACCESS.kiditQuarterlyInput.title,
          roles: PAGE_ACCESS.kiditQuarterlyInput.roles,
        },
      },
      {
        path: 'kidit-hdrx',
        loadComponent: () =>
          import('./features/kidit-report/kidit-hdrx-quarterly.component').then(
            (m) => m.KiditHdrxQuarterlyComponent
          ),
        canActivate: [roleGuard],
        data: {
          title: PAGE_ACCESS.kiditHdrx.title,
          roles: PAGE_ACCESS.kiditHdrx.roles,
        },
      },
      {
        path: 'usage-guide',
        loadComponent: () =>
          import('./features/usage-guide/usage-guide.component').then(
            (m) => m.UsageGuideComponent
          ),
        canActivate: [roleGuard],
        data: {
          title: PAGE_ACCESS.usageGuide.title,
          roles: PAGE_ACCESS.usageGuide.roles,
        },
      },
      {
        path: 'consumables',
        loadComponent: () =>
          import('./features/consumables/consumables.component').then(
            (m) => m.ConsumablesComponent
          ),
        canActivate: [roleGuard],
        data: {
          title: PAGE_ACCESS.consumables.title,
          roles: PAGE_ACCESS.consumables.roles,
        },
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
