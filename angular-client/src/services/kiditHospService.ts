// KiDit「住出院」季度申報：由病人動態（工作日誌）自動配對住院/出院日期，
// 專師補住院原因大類/細類代碼後匯出官方 6 欄 CSV。
// - 頻率表上住出院為「無須」，本院自行決定申報（2026-08-02 拍板）
// - 官方無樣本檔，表頭依格式說明檔「欄位內容」；日期民國 7 碼；UTF-8 BOM + CRLF
// - 人工欄（日期修正/原因碼/排除）存 kidit_quarter_records.data.hosp（頂層鍵淺合併）
import { toRocDate7 } from '@/services/kiditVascularCsvService';

/** 住出院 CSV 表頭（6 欄，依格式說明檔欄位內容） */
const HOSP_CSV_HEADERS = ['身份證號', '病歷號', '住院日期', '出院日期', '住院原因大類', '住院原因細類'];

/** 單段住院歷程的人工覆寫（episodeKey = `${住院日或段首動態日}`） */
export interface HospEpisodeOverride {
  admitDate?: string;
  dischargeDate?: string;
  cat?: string;
  sub?: string;
  excluded?: boolean;
}

export interface HospExportRow {
  idNumber: string;
  medicalRecordNumber: string;
  admitDate: string;
  dischargeDate: string;
  cat: string;
  sub: string;
}

function escapeCsvValue(value: string): string {
  const s = value == null ? '' : String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** 檔名：病患住出院CSV檔_YYYYMMDD-YYYYMMDD.csv（季度區間西元 8 碼） */
export function downloadHospCsv(rows: HospExportRow[], quarterStart: string, quarterEnd: string): void {
  const lines = [HOSP_CSV_HEADERS.map(escapeCsvValue).join(',')];
  for (const r of rows) {
    lines.push(
      [r.idNumber, r.medicalRecordNumber, toRocDate7(r.admitDate), toRocDate7(r.dischargeDate), r.cat, r.sub]
        .map(escapeCsvValue)
        .join(','),
    );
  }
  const stamp = `${quarterStart.replace(/-/g, '')}-${quarterEnd.replace(/-/g, '')}`;
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `病患住出院CSV檔_${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
