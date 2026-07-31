// KiDit「每月基本資料」CSV 彙整：該月本院初透病人 × 建檔基本資料（kidit_profile），
// 含未建檔者的建檔狀態欄，供比對病人清單標記本院初透者是否已儲存基本資料。
// 欄位順序比照 KiDit 匯出 Excel 的病患資料 sheet（kidit-api.service.ts）；
// 日期維持西元 YYYY-MM-DD（內部彙整用，非 KiDit 官方匯入格式）。
// UTF-8 BOM 前綴供 Excel 正確辨識編碼（同 kiditVascularCsvService）。

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

const CSV_COLUMNS: { header: string; value: (row: MonthlyBasicDataRow) => string }[] = [
  { header: '本院初透日', value: (r) => r.hospitalFirstDialysisDate || (r.dateMissing ? `未填(依${r.effectiveDate}歸月)` : '') },
  { header: '建檔狀態', value: (r) => basicDataStatusText(r) },
  { header: '基本資料儲存日', value: (r) => r.profileDate || '' },
  { header: '病史儲存日', value: (r) => r.historyDate || '' },
  { header: '姓名', value: (r) => r.profile?.['name'] || r.name || '' },
  { header: '病歷號', value: (r) => r.profile?.['medicalRecordNumber'] || r.medicalRecordNumber || '' },
  { header: '身分證號', value: (r) => r.profile?.['idNumber'] || '' },
  { header: '病患類別', value: (r) => r.profile?.['patientCategory'] || '' },
  { header: '生日', value: (r) => r.profile?.['birthDate'] || '' },
  { header: '性別', value: (r) => r.profile?.['gender'] || '' },
  { header: '血型', value: (r) => r.profile?.['bloodType'] || '' },
  { header: '婚姻', value: (r) => r.profile?.['maritalStatus'] || '' },
  { header: '電話', value: (r) => r.profile?.['phone'] || '' },
  { header: '地址', value: (r) => r.profile?.['address'] || '' },
  { header: '教育程度', value: (r) => r.profile?.['education'] || '' },
  { header: '職業', value: (r) => r.profile?.['occupation'] || '' },
  { header: '連絡人', value: (r) => r.profile?.['contactPerson'] || '' },
  { header: '關係', value: (r) => r.profile?.['relationship'] || '' },
  { header: '透析代號', value: (r) => r.profile?.['dialysisCode'] || '' },
  { header: '重大傷病卡號', value: (r) => r.profile?.['catastrophicCardNo'] || '' },
  { header: '是否為原住民', value: (r) => r.profile?.['isIndigenous'] || '' },
  { header: '是否具福保身分', value: (r) => r.profile?.['isWelfare'] || '' },
  { header: '狀態', value: (r) => r.profile?.['status'] || '' },
  { header: '首次治療日期', value: (r) => r.profile?.['firstDialysisDate'] || '' },
  { header: '本院開始治療日期', value: (r) => r.profile?.['hospitalStartDate'] || '' },
  { header: '原發病大類', value: (r) => r.profile?.['diagnosisCategory'] || '' },
  { header: '原發病細類', value: (r) => r.profile?.['diagnosisSubcategory'] || '' },
  { header: '已刪除', value: (r) => (r.isDeleted ? '是' : '') },
];

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
  lines.push(CSV_COLUMNS.map((c) => escapeCsvValue(c.header)).join(','));
  for (const row of rows) {
    lines.push(CSV_COLUMNS.map((c) => escapeCsvValue(c.value(row))).join(','));
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
