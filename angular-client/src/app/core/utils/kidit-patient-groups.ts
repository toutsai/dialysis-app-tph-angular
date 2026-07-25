// KiDit 申報病人三區歸類（共用：日詳情彈窗、季度動態彙整）
// 規則（2026-07-26 使用者拍板，對應手動「病患異動狀態表」的三個區塊）：
// - 外院＝非常規門診且主檔「原透析院所」(hospitalInfo.source) 有填 → 外院診所病人來本院住院透析
// - 新病患＝非常規門診且無原透析院所 → 多為住院中初透的新病人
// - 其餘（patientCategory 空值視同常規）＝本院常規 HD 門診
export type KiditPatientGroup = 'regular' | 'newPatient' | 'external';

/** 歸類只需要的最小欄位（結構化型別：patient-store 與 model 的 Patient 皆可傳入） */
export interface KiditClassifiablePatient {
  patientCategory?: string | null;
  hospitalInfo?: { source?: string | null; [key: string]: unknown } | null;
}

export const KIDIT_GROUP_ORDER: KiditPatientGroup[] = ['regular', 'newPatient', 'external'];

export const KIDIT_GROUP_LABELS: Record<KiditPatientGroup, string> = {
  regular: '本院常規 HD',
  newPatient: '新病患',
  external: '外院病人',
};

export function classifyKiditPatient(patient: unknown): KiditPatientGroup {
  // 查無主檔（理論上不會發生：PatientStore 含軟刪除）歸新病患，避免誤入常規區
  const p = patient as KiditClassifiablePatient | undefined | null;
  if (!p) return 'newPatient';
  if (p.patientCategory == null || p.patientCategory === 'opd_regular') return 'regular';
  return externalHospitalName(p) ? 'external' : 'newPatient';
}

/** 外院區顯示的院所名稱（原透析院所） */
export function externalHospitalName(patient: unknown): string {
  const p = patient as KiditClassifiablePatient | undefined | null;
  return (p?.hospitalInfo?.source || '').trim();
}
