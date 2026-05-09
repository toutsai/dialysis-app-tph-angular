import { Injectable, inject } from '@angular/core';
import { ApiConfigService } from './api-config.service';

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

  private tokenKey(bedKey: string): string {
    return `bed_dashboard_token:${bedKey}`;
  }

  getStoredToken(bedKey: string): string | null {
    return localStorage.getItem(this.tokenKey(bedKey));
  }

  hasStoredToken(bedKey: string): boolean {
    return !!this.getStoredToken(bedKey);
  }

  clearStoredToken(bedKey: string): void {
    localStorage.removeItem(this.tokenKey(bedKey));
  }

  async loginBed(bedKey: string, pin: string): Promise<void> {
    const res = await fetch(`${this.apiConfig.apiBaseUrl}/dashboard/bed-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bedKey, pin }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.token) {
      throw new Error(data.message || '床位登入失敗');
    }

    localStorage.setItem(this.tokenKey(bedKey), data.token);
    if (data.device?.bedKey && data.device.bedKey !== bedKey) {
      localStorage.setItem(this.tokenKey(data.device.bedKey), data.token);
    }
  }

  async getBedDashboard(
    bedKey: string,
    date: string,
    shift: DashboardShift,
  ): Promise<DashboardData> {
    const params = new URLSearchParams();
    if (date) params.set('date', date);
    if (shift) params.set('shift', shift);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    const dashboardToken = this.getStoredToken(bedKey);
    const staffToken = this.apiConfig.getToken();
    const token = staffToken || dashboardToken;
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(
      `${this.apiConfig.apiBaseUrl}/dashboard/bed/${encodeURIComponent(bedKey)}?${params}`,
      { headers },
    );
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      if (res.status === 401) this.clearStoredToken(bedKey);
      throw new Error(data.message || '讀取床邊儀表板失敗');
    }

    return data as DashboardData;
  }
}
