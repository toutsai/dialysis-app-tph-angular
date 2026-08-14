// src/services/firstDialysisExportService.ts
// 院內首透名單匯出（來源：病人狀態標記「本院初透」，2026-08-15 起）

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

export async function exportFirstDialysisExcel(
  rows: FirstDialysisRow[],
  filename: string = 'FirstDialysis_Export.xlsx',
): Promise<void> {
  const XLSX = await import('xlsx');
  const sheetData = rows.map((r) => ({
    姓名: r.name || '',
    病歷號: r.medicalRecordNumber || '',
    本院初透日: r.firstDialysisDate || '',
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
  XLSX.utils.book_append_sheet(wb, ws, '院內首透名單');
  XLSX.writeFile(wb, filename);
}
