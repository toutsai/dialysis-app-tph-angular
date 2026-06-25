// src/app/core/models/physician.model.ts
// 醫師相關型別定義

import { BaseEntity } from './common.model';

/** 醫師 */
export interface Physician extends BaseEntity {
  name: string;
  specialty?: string;
  staffId?: string;
  phone?: string;
  clinicHours?: unknown[];
  defaultSchedules?: unknown[];
  defaultConsultationSchedules?: unknown[];
  isActive?: boolean;
}

/** 醫師排班表 */
export interface PhysicianSchedule extends BaseEntity {
  scheduleData?: Record<string, unknown>;
}
