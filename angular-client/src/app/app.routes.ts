import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { roleGuard } from './core/guards/role.guard';
import { PAGE_ACCESS } from './core/config/page-access';

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
        path: 'physician-schedule',
        loadComponent: () =>
          import(
            './features/physician-schedule/physician-schedule.component'
          ).then((m) => m.PhysicianScheduleComponent),
        canActivate: [roleGuard],
        data: {
          title: PAGE_ACCESS.physicianSchedule.title,
          roles: PAGE_ACCESS.physicianSchedule.roles,
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
        path: 'orders',
        loadComponent: () =>
          import('./features/orders/orders.component').then(
            (m) => m.OrdersComponent
          ),
        canActivate: [roleGuard],
        data: { title: PAGE_ACCESS.orders.title, roles: PAGE_ACCESS.orders.roles },
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
