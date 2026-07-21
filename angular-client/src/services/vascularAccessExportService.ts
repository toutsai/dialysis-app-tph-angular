// src/services/vascularAccessExportService.ts
// 當月血管通路事件清單匯出（彙整自每日工作日誌的 vascularAccessLog ＋ 主護填寫的 confirmed 事件）
import * as XLSX from 'xlsx';

export interface VascularAccessRow {
  name: string;
  medicalRecordNumber: string;
  date: string;
  interventions: string;
  location: string;
  /** 來源：工作日誌（每日工作日誌 vascularAccessLog）/ 主護填寫（vascular_access_events confirmed） */
  source: string;
}

export function exportVascularAccessExcel(
  rows: VascularAccessRow[],
  filename: string = 'VascularAccess_Export.xlsx',
): void {
  const sheetData = rows.map((r) => ({
    姓名: r.name || '',
    病歷號: r.medicalRecordNumber || '',
    日期: r.date || '',
    處置: r.interventions || '',
    處置院所: r.location || '',
    來源: r.source || '',
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(sheetData);
  ws['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 28 }, { wch: 12 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, ws, '血管通路事件');
  XLSX.writeFile(wb, filename);
}
