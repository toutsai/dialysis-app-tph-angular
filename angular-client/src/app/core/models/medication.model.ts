// src/app/core/models/medication.model.ts
// 藥物訂單相關型別定義

import { BaseEntity, UserRef } from './common.model';

/** 藥物訂單項目 */
export interface MedicationOrderItem {
  name?: string;
  dose?: string;
  frequency?: string;
  route?: string;
  note?: string;
  [key: string]: unknown;
}

/** 藥物訂單 */
export interface MedicationOrder extends BaseEntity {
  patientId?: string;
  patientName?: string;
  medications?: MedicationOrderItem[];
  status?: string;
  orderDate?: string;
  createdBy?: UserRef;
}

/** 針劑藥囑訂單 (Excel 匯入) */
export interface InjectionOrder extends BaseEntity {
  patientId?: string;
  patientName?: string;
  medicalRecordNumber?: string;
  orderCode?: string;
  orderName?: string;
  changeDate?: string;
  uploadMonth?: string;
  dose?: string;
  frequency?: string;
  note?: string;
  action?: string;
  orderType?: string;
  sourceFile?: string;
}

/** 藥物草稿 */
export interface MedicationDraft extends BaseEntity {
  authorId: string;
  patientId?: string;
  draftData?: Record<string, unknown>;
}
