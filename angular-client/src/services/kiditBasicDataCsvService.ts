// KiDit「每月基本資料」CSV：該月本院初透病人的建檔基本資料（kidit_profile）。
// 2026-08-04 起完全比照官方 Patient_YYYYMMDD 格式（23 欄、民國日期，重用 kiditInitialCsvService
// 的表頭與列建構），可直接匯入 KiDit；只匯出已填基本資料者，建檔狀態等比對資訊看畫面清單。
// UTF-8 BOM 前綴供 Excel 正確辨識編碼（同 kiditVascularCsvService）。
import { PATIENT_CSV_HEADERS, buildPatientRow } from './kiditInitialCsvService';

export interface MonthlyBasicDataRow {
  patientId: string;
  name: string;
  medicalRecordNumber: string;
  hospitalFirstDialysisDate: string;
  /** 歸月日期：本院初透日，未填時退建檔資料的本院開始治療日期/建檔儲存日 */
  effectiveDate: string;
  /** 病人清單的本院初透標記沒填日期（用 effectiveDate 歸月） */
  dateMissing: boolean;
  isDeleted: boolean;
  hasProfile: boolean;
  hasHistory: boolean;
  complete: boolean;
  profileDate: string | null;
  historyDate: string | null;
  /** 建檔者/建檔時間：儲存基本資料表單時後端蓋章（2026-08-08 起），舊資料為 null */
  profileSavedBy?: string | null;
  profileSavedAt?: string | null;
  profile: Record<string, string> | null;
  history: Record<string, unknown> | null;
}

/** 建檔狀態文字（清單顯示與 CSV 共用） */
export function basicDataStatusText(row: MonthlyBasicDataRow): string {
  if (row.complete) return '已建檔';
  if (row.hasProfile && !row.hasHistory) return '缺病史原發病';
  if (!row.hasProfile && row.hasHistory) return '缺基本資料';
  return '未建檔';
}

/** 值含逗號/雙引號/換行時以雙引號包裹並跳脫 */
function escapeCsvValue(value: string): string {
  const s = value == null ? '' : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function buildMonthlyBasicDataCsv(rows: MonthlyBasicDataRow[]): string {
  const lines: string[] = [];
  lines.push(PATIENT_CSV_HEADERS.map(escapeCsvValue).join(','));
  for (const row of rows) {
    if (!row.profile) continue; // 未建檔者不匯出（比對資訊看畫面清單）
    // 姓名/病歷號建檔資料未填時以病人清單值補（官方樣本兩欄皆有值）
    const p = {
      ...row.profile,
      name: row.profile['name'] || row.name || '',
      medicalRecordNumber: row.profile['medicalRecordNumber'] || row.medicalRecordNumber || '',
    };
    lines.push(buildPatientRow(p).map(escapeCsvValue).join(','));
  }
  return lines.join('\r\n');
}

/** 下載每月基本資料 CSV，檔名：本院初透基本資料_YYYY_MM.csv */
export function downloadMonthlyBasicDataCsv(rows: MonthlyBasicDataRow[], year: number, month: number): void {
  const csv = buildMonthlyBasicDataCsv(rows);
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const filename = `本院初透基本資料_${year}_${String(month).padStart(2, '0')}.csv`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
