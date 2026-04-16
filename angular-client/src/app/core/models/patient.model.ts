// src/app/core/models/patient.model.ts
// 病人相關型別定義

import { BaseEntity, UserRef } from './common.model';

/** 病人狀態 */
export type PatientStatus = 'opd' | 'ipd' | 'er' | 'deleted';

/** 病人分類 */
export type PatientCategory = 'opd_regular' | 'non_regular';

/** 須注意疾病 */
export interface PatientDisease {
  name: string;
  [key: string]: unknown;
}

/** 排程規則 (嵌入 JSON) */
export interface PatientScheduleRule {
  dayOfWeek?: number[];
  shift?: string;
  bed?: string;
  freq?: string;
  bedNum?: string;
  shiftCode?: string;
  [key: string]: unknown;
}

/** 院所資訊 (嵌入 JSON) */
export interface HospitalInfo {
  source?: string;
  transferOut?: string;
  [key: string]: unknown;
}

/** 病人狀態旗標 (嵌入 JSON) */
export interface PatientStatusFlags {
  isFirstDialysis?: boolean;
  isPaused?: boolean;
  hasBloodDraw?: boolean;
  [key: string]: unknown;
}

/** 病人主檔 */
export interface Patient extends BaseEntity {
  medicalRecordNumber: string;
  name: string;
  status?: PatientStatus;
  isDeleted?: boolean;
  deleteReason?: string;

  // 透析相關
  dialysisOrders?: Record<string, unknown>;

  // 基本資料
  birthDate?: string;
  gender?: string;
  idNumber?: string;
  phone?: string;
  address?: string;
  emergencyContact?: string;
  emergencyPhone?: string;

  // 醫療資訊
  physician?: string;
  firstDialysisDate?: string;
  vascAccess?: string;
  accessCreationDate?: string;
  wardNumber?: string;
  bedNumber?: string;

  // 附加資訊
  hospitalInfo?: HospitalInfo;
  inpatientReason?: string;
  dialysisReason?: string;
  notes?: string;

  // 分類與狀態
  patientCategory?: PatientCategory;
  diseases?: PatientDisease[] | string[];
  patientStatus?: PatientStatusFlags;
  isHepatitis?: boolean;

  // 排程規則
  scheduleRule?: PatientScheduleRule | null;

  // 追蹤
  lastModifiedBy?: UserRef;

  // 允許額外欄位 (向後相容)
  [key: string]: unknown;
}
