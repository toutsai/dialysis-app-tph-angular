// src/services/firstDialysisExportService.ts
// 當月初次透析名單匯出（來源：病人資料庫 first_dialysis_date）
import * as XLSX from 'xlsx';

export interface FirstDialysisRow {
  name: string;
  medicalRecordNumber: string;
  firstDialysisDate: string;
  mode: string;
  statusLabel: string;
  physician: string;
  isDeleted: boolean;
  deleteReason: string;
  deletedDate: string;
}

export function exportFirstDialysisExcel(
  rows: FirstDialysisRow[],
  filename: string = 'FirstDialysis_Export.xlsx',
): void {
  const sheetData = rows.map((r) => ({
    姓名: r.name || '',
    病歷號: r.medicalRecordNumber || '',
    首透日期: r.firstDialysisDate || '',
    透析模式: r.mode || '',
    狀態: r.isDeleted ? `${r.statusLabel}（已刪除）` : r.statusLabel,
    主治醫師: r.physician || '',
    刪除原因: r.isDeleted ? (r.deleteReason || '') : '',
    刪除日期: r.isDeleted ? (r.deletedDate || '') : '',
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(sheetData);
  ws['!cols'] = [
    { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 },
    { wch: 14 }, { wch: 12 }, { wch: 20 }, { wch: 12 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, '初次透析名單');
  XLSX.writeFile(wb, filename);
}
