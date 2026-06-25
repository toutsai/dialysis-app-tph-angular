// src/app/core/models/schedule.model.ts
// 排程相關型別定義

import { BaseEntity, UserRef } from './common.model';

/** 排程時段資料 (嵌入 JSON) */
export interface ScheduleSlot {
  patientId?: string;
  patientName?: string;
  [key: string]: unknown;
}

/** 每日排程表 */
export interface Schedule extends BaseEntity {
  date: string;
  /** JSON map: {bedNum-shift: ScheduleSlot} */
  schedule?: Record<string, ScheduleSlot>;
  syncMethod?: string;
  lastModifiedBy?: UserRef;
}

/** 歸檔排程表 */
export interface ArchivedSchedule extends BaseEntity {
  date: string;
  schedule?: Record<string, ScheduleSlot>;
  lastModifiedBy?: UserRef;
  archivedAt?: string;
  archiveMethod?: string;
  patientCount?: number;
  missingPatientCount?: number;
}

/** 基礎排班總表 */
export interface BaseSchedule extends BaseEntity {
  /** JSON map: {patientId: {freq, bedNum, shiftCode, ...}} */
  schedule?: Record<string, unknown>;
}

/** 排程例外類型 */
export type ScheduleExceptionType = 'MOVE' | 'ADD_SESSION' | 'SWAP' | 'SUSPEND';

/** 排程例外狀態 */
export type ScheduleExceptionStatus =
  | 'pending'
  | 'applied'
  | 'cancelled'
  | 'conflict_requires_resolution'
  | 'processing'
  | 'expired';

/** 排程例外 (調班申請) */
export interface ScheduleException extends BaseEntity {
  type: ScheduleExceptionType;
  status?: ScheduleExceptionStatus;

  patientId?: string;
  patientName?: string;

  // MOVE/ADD_SESSION 用
  fromData?: { sourceDate?: string; bedNum?: string; shiftCode?: string };
  toData?: { goalDate?: string; bedNum?: string; shiftCode?: string };

  // SWAP 用
  patient1?: { patientId?: string; patientName?: string; fromBedNum?: string; fromShiftCode?: string };
  patient2?: { patientId?: string; patientName?: string; fromBedNum?: string; fromShiftCode?: string };

  // SUSPEND 用
  startDate?: string;
  endDate?: string;

  // 通用
  date?: string;
  reason?: string;
  cancelReason?: string;
  errorMessage?: string;
  createdBy?: UserRef;
  cancelledAt?: string;
}
