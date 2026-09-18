import { Injectable, inject } from '@angular/core';
import { ApiConfigService } from './api-config.service';
import { AuthService } from './auth.service';

export type DashboardShift = 'auto' | 'early' | 'noon' | 'late';

export interface DashboardMedication {
  id?: string;
  patientId: string;
  patientName?: string;
  orderCode?: string;
  orderName?: string;
  dose?: string;
  unit?: string;
  note?: string;
  /** 後端解讀層：判讀後規則與來源（note / frequency / override） */
  effectiveRule?: string;
  ruleSource?: string;
}

export interface DashboardHandoverItem {
  id: string;
  source: string;
  type?: string;
  title?: string;
  content: string;
  status?: string;
  targetDate?: string;
  recordDate?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface DashboardData {
  context: {
    bedKey: string;
    bedLabel: string;
    date: string;
    requestedShift: string;
    selectedShift: 'early' | 'noon' | 'late';
    selectedShiftLabel: string;
    autoShift: 'early' | 'noon' | 'late';
    autoShiftLabel: string;
    slotKey: string;
    scheduleSource: string;
  };
  dashboardStatus: {
    status: 'scheduled' | 'empty' | 'missing_patient';
    message: string;
  };
  shiftCandidates: {
    shift: 'early' | 'noon' | 'late';
    label: string;
    slotKey: string;
    hasPatient: boolean;
    patientId: string | null;
    patientName: string;
    isSelected: boolean;
    isAuto: boolean;
  }[];
  patient: {
    id: string;
    name: string;
    medicalRecordNumber: string;
    age?: number | null;
    gender?: string;
    status?: string;
    wardNumber?: string;
    bedNumber?: string;
    physician?: string;
    vascAccess?: string;
    notes?: string;
  } | null;
  dialysisOrder: {
    mode?: string;
    ak?: string;
    /** 依日期星期與頻率解析出的當次 AK（AK 含 / 輪替時才與 ak 不同） */
    akToday?: string;
    akIsRotation?: boolean;
    freq?: string;
    dialysateCa?: string;
    bicarbonate?: string;
    heparin?: string;
    heparinRinse?: string;
    heparinLoading?: string | number;
    heparinMaintain?: string | number;
    vascAccess?: string;
    bloodFlow?: string;
    dialysateFlow?: string;
    dialysisHours?: string;
    dialysisTimeHours?: number | null;
    dialysisTimeMinutes?: number | null;
    dryWeight?: number | string | null;
    dehydration?: number | string | null;
    effectiveDate?: string | null;
    source?: string;
  } | null;
  weightAssessment: {
    todayWeight: number | null;
    dryWeight: number | string | null;
    targetUf: number | string | null;
    source: string;
    note: string;
  } | null;
  medicationsToday: DashboardMedication[];
  handoverItems: DashboardHandoverItem[];
  risk: {
    hypotensionProbability: number | null;
    modelStatus: string;
  };
  updatedAt: string;
}

@Injectable({ providedIn: 'root' })
export class DashboardService {
  private readonly apiConfig = inject(ApiConfigService);
  private readonly auth = inject(AuthService);

  /** 是否以員工帳號登入（床邊裝置 PIN-only 沒有 staff token）。 */
  hasStaffToken(): boolean {
    return !!this.apiConfig.getToken();
  }

  /**
   * 將交班留言（tasks, category=message）標記為完成/已讀。
   * 僅限員工帳號操作；完成後該筆會從交班事項清單消失。
   */
  async completeHandoverTask(taskId: string): Promise<void> {
    const staffToken = this.apiConfig.getToken();
    if (!staffToken) throw new Error('需要員工登入才能標記完成');

    const user = this.auth.currentUser();
    const body: Record<string, unknown> = {
      status: 'completed',
      resolvedAt: new Date().toISOString(),
    };
    if (user) body['resolvedBy'] = { uid: user.uid, name: user.name };

    const res = await fetch(
      `${this.apiConfig.apiBaseUrl}/system/tasks/${encodeURIComponent(taskId)}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${staffToken}`,
        },
        body: JSON.stringify(body),
      },
    );

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || '標記完成失敗');
    }
  }

  /**
   * 讀取床邊儀表板資料。2026-09-18 起端點免登入（比照 ICU 分享頁），不帶任何 token；
   * 姓名／病歷號已在後端遮罩。刻意用 raw fetch：ApiService 的 401 攔截會導回登入頁。
   */
  async getBedDashboard(
    bedKey: string,
    date: string,
    shift: DashboardShift,
  ): Promise<DashboardData> {
    const params = new URLSearchParams();
    if (date) params.set('date', date);
    if (shift) params.set('shift', shift);

    const res = await fetch(
      `${this.apiConfig.apiBaseUrl}/dashboard/bed/${encodeURIComponent(bedKey)}?${params}`,
    );
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.message || '讀取床邊儀表板失敗');
    }

    return data as DashboardData;
  }
}
