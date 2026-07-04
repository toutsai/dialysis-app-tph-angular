import type { UserRole } from '@services/auth.service';

export const ALL_ROLES = ['admin', 'editor', 'contributor', 'viewer'] as const;
export const STAFF_ROLES = ['admin', 'editor'] as const;
export const CLINICAL_ROLES = ['admin', 'editor', 'contributor'] as const;
export const DOCTOR_ROLES = ['admin', 'contributor'] as const;
export const DOCTOR_VIEW_ROLES = ['admin', 'contributor', 'viewer'] as const;
export const INVENTORY_ROLES = ['admin', 'viewer'] as const;
export const ADMIN_ROLES = ['admin'] as const;

type RoleList = readonly UserRole[];

export const PAGE_ACCESS = {
  schedule: {
    path: '/schedule',
    title: '每日排程表',
    roles: ALL_ROLES,
    roleLabel: '所有使用者',
  },
  stats: {
    path: '/stats',
    title: '護理分組檢視',
    roles: ALL_ROLES,
    roleLabel: '所有使用者',
  },
  collaboration: {
    path: '/collaboration',
    title: '協作訊息中心',
    roles: ALL_ROLES,
    roleLabel: '所有使用者',
  },
  dailyLog: {
    path: '/daily-log',
    title: '工作日誌',
    roles: ALL_ROLES,
    roleLabel: '所有使用者',
  },
  accountSettings: {
    path: '/account-settings',
    title: '帳號設定',
    roles: ALL_ROLES,
    roleLabel: '所有使用者',
  },
  usageGuide: {
    path: '/usage-guide',
    title: '平台使用說明',
    roles: ALL_ROLES,
    roleLabel: '所有使用者',
  },
  educationDashboard: {
    path: '/education-dashboard',
    title: '初透衛教進度',
    roles: STAFF_ROLES,
    roleLabel: '管理員、編輯者',
  },
  myPatients: {
    path: '/my-patients',
    title: '我的今日病人',
    roles: STAFF_ROLES,
    roleLabel: '管理員、編輯者',
  },
  weekly: {
    path: '/weekly',
    title: '週排班表',
    roles: STAFF_ROLES,
    roleLabel: '管理員、編輯者',
  },
  baseSchedule: {
    path: '/base-schedule',
    title: '門急住床位總表',
    roles: STAFF_ROLES,
    roleLabel: '管理員、編輯者',
  },
  exceptionManager: {
    path: '/exception-manager',
    title: '調班管理',
    roles: STAFF_ROLES,
    roleLabel: '管理員、編輯者',
  },
  updateScheduler: {
    path: '/update-scheduler',
    title: '預約變更總覽',
    roles: STAFF_ROLES,
    roleLabel: '管理員、編輯者',
  },
  nursingSchedule: {
    path: '/nursing-schedule',
    title: '護理班表與職責',
    roles: STAFF_ROLES,
    roleLabel: '管理員、編輯者',
  },
  kiditReport: {
    path: '/kidit-report',
    title: 'KiDit 申報工作站',
    roles: STAFF_ROLES,
    roleLabel: '管理員、編輯者',
  },
  patients: {
    path: '/patients',
    title: '病人管理',
    roles: CLINICAL_ROLES,
    roleLabel: '管理員、編輯者、貢獻者',
  },
  reporting: {
    path: '/reporting',
    title: '統計報表',
    roles: CLINICAL_ROLES,
    roleLabel: '管理員、編輯者、貢獻者',
  },
  physicianSchedule: {
    path: '/physician-schedule',
    title: '醫師排班',
    roles: DOCTOR_VIEW_ROLES,
    roleLabel: '管理員、貢獻者、查看者',
  },
  labReports: {
    path: '/lab-reports',
    title: '檢驗報告管理',
    roles: CLINICAL_ROLES,
    roleLabel: '管理員、編輯者、貢獻者',
  },
  orders: {
    path: '/orders',
    title: '藥囑管理',
    roles: DOCTOR_ROLES,
    roleLabel: '管理員、貢獻者',
  },
  inventory: {
    path: '/inventory',
    title: '庫存管理',
    roles: INVENTORY_ROLES,
    roleLabel: '管理員、查看者',
  },
  consumables: {
    path: '/consumables',
    title: '每月耗材總表',
    roles: INVENTORY_ROLES,
    roleLabel: '管理員、查看者',
  },
  userManagement: {
    path: '/user-management',
    title: '使用者管理',
    roles: ADMIN_ROLES,
    roleLabel: '僅管理員',
  },
} as const satisfies Record<
  string,
  { path: string; title: string; roles: RoleList; roleLabel: string }
>;

export type PageKey = keyof typeof PAGE_ACCESS;

export function canAccessPage(
  pageKey: PageKey,
  role: UserRole | null | undefined,
): boolean {
  return !!role && (PAGE_ACCESS[pageKey].roles as RoleList).includes(role);
}
