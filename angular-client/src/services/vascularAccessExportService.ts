// src/services/vascularAccessExportService.ts
// 當月血管通路事件清單匯出（彙整自每日工作日誌的 vascularAccessLog）
import * as XLSX from 'xlsx';

export interface VascularAccessRow {
  name: string;
  medicalRecordNumber: string;
  date: string;
  interventions: string;
  location: string;
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
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(sheetData);
  ws['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 28 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws, '血管通路事件');
  XLSX.writeFile(wb, filename);
}
