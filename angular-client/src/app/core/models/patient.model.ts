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
  dialysisOrigin?: DialysisOrigin;
  [key: string]: unknown;
}

/** 透析來源身分（永久履歷）：first=本院首透、transfer=外院轉入本院初透、repeat=反覆住院 */
export type DialysisOriginType = 'first' | 'transfer' | 'repeat';

export interface DialysisOrigin {
  type: DialysisOriginType | null;
  /** 人生首透日（type=first 才有） */
  firstDialysisDate?: string | null;
  /** 本院第一次透析日 */
  hospitalFirstDate?: string | null;
  setBy?: string;
  setAt?: string;
  [key: string]: unknown;
}

/**
 * 依目前旗標同步透析來源履歷（存檔前呼叫）。
 * 規則（2026-07-19 使用者拍板）：組長明確判定（勾首透/本院初透/反覆住院）→ 履歷跟著最新判定走；
 * 旗標全關（衛教完成取消凍結、建檔完成、復原等）→ 履歷不動，永久保留最後判定。
 */
export function syncDialysisOrigin(patientStatus: any, setBy: string): void {
  if (!patientStatus) return;
  const prev: DialysisOrigin = patientStatus.dialysisOrigin || { type: null };
  let type: DialysisOriginType | null = null;
  if (patientStatus.isFirstDialysis?.active) type = 'first';
  else if (patientStatus.hospitalFirstDialysis?.active) type = 'transfer';
  else if (prev.type === 'repeat') type = 'repeat';
  if (!type) return; // 無明確判定 → 保留既有履歷
  const next: DialysisOrigin = {
    ...prev,
    type,
    firstDialysisDate:
      type === 'first'
        ? patientStatus.isFirstDialysis?.date || prev.firstDialysisDate || null
        : prev.firstDialysisDate || null,
    hospitalFirstDate:
      type === 'repeat'
        ? prev.hospitalFirstDate || null
        : patientStatus.hospitalFirstDialysis?.date ||
          patientStatus.isFirstDialysis?.date ||
          prev.hospitalFirstDate ||
          null,
  };
  const changed =
    prev.type !== next.type ||
    (prev.firstDialysisDate || null) !== (next.firstDialysisDate || null) ||
    (prev.hospitalFirstDate || null) !== (next.hospitalFirstDate || null);
  if (changed) {
    next.setBy = setBy;
    next.setAt = new Date().toLocaleString('sv-SE');
    patientStatus.dialysisOrigin = next;
  } else if (!patientStatus.dialysisOrigin) {
    patientStatus.dialysisOrigin = next;
  }
}

/** 病人主檔 */
export interface Patient extends BaseEntity {
  medicalRecordNumber: string;
  name: string;
  status?: PatientStatus;
  originalStatus?: PatientStatus;
  isDeleted?: boolean;
  deleteReason?: string;
  deletedAt?: string | null;

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
