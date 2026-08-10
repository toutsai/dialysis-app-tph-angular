// src/services/medAdjustmentExportService.ts
// 醫師藥物調整：匯出整班當月修正（列=床號/病歷號/姓名，欄=醫囑+貧血+鈣磷修改項目）

export async function exportMedAdjustmentExcel(
  rows: Array<Record<string, string>>,
  itemLabels: string[],
  filename: string = 'MedAdjustment_Export.xlsx',
): Promise<void> {
  const XLSX = await import('xlsx');
  const header = ['床號', '病歷號', '姓名', ...itemLabels];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows, { header });
  ws['!cols'] = [
    { wch: 7 },
    { wch: 12 },
    { wch: 10 },
    ...itemLabels.map(() => ({ wch: 16 })),
  ];
  XLSX.utils.book_append_sheet(wb, ws, '當月修正');
  XLSX.writeFile(wb, filename);
}
