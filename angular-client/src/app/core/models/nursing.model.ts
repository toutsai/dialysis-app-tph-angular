// src/app/core/models/nursing.model.ts
// 護理相關型別定義

import { BaseEntity, UserRef } from './common.model';

/** 護理人員分配 */
export interface NurseAssignment extends BaseEntity {
  date: string;
  /** JSON map: {patientId-shift: nurseId} */
  teams?: Record<string, string>;
}

/** 護理工作職責 */
export interface NursingDuty extends BaseEntity {
  duties?: Record<string, unknown>;
}

/** 護理組別配置 */
export interface NursingGroupConfig extends BaseEntity {
  config?: Record<string, unknown>;
}

/** 每日工作日誌 */
export interface DailyLog extends BaseEntity {
  date: string;
  patientMovements?: unknown[];
  vascularAccessLog?: unknown[];
  announcements?: unknown[];
  notes?: string;
  otherNotes?: string;
  /** 統計資料 (main_beds, peripheral_beds, patient_care, staffing) */
  stats?: Record<string, unknown>;
  /** 簽核資訊 (early, noon, late) */
  leader?: Record<string, unknown>;
}

/** 交班日誌 */
export interface HandoverLog extends BaseEntity {
  date: string;
  shift?: string;
  content?: string;
  items?: unknown[];
  createdBy?: UserRef;
}
