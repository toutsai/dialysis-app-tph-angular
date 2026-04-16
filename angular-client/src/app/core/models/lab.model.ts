// src/app/core/models/lab.model.ts
// 檢驗報告相關型別定義

import { BaseEntity, UserRef } from './common.model';

/** 檢驗結果項目 */
export interface LabResult {
  itemName?: string;
  value?: string | number;
  unit?: string;
  referenceRange?: string;
  isAbnormal?: boolean;
  [key: string]: unknown;
}

/** 檢驗報告 */
export interface LabReport extends BaseEntity {
  patientId?: string;
  reportDate?: string;
  reportType?: string;
  results?: Record<string, unknown>;
  filePath?: string;
  uploadedBy?: UserRef;
}

/** 檢驗異常分析 (AI 輔助) */
export interface LabAlertAnalysis extends BaseEntity {
  patientId?: string;
  monthRange?: string;
  abnormalityKey?: string;
  analysis?: string;
  suggestion?: string;
  analysisData?: Record<string, unknown>;
}
