// src/services/kiditVascularCsvService.ts
// KiDit「病患血液透析造管CSV檔」季度匯出：82 欄、UTF-8 BOM、每季一檔每病人一列。
// ⚠️ KIDIT_VASCULAR_CSV_HEADERS 逐字複製自官方範例檔
//    D:\KiDit匯入\病患血液透析造管CSV檔_20260701-20260930.csv 的表頭列，
//    含雙空格 / 行尾空格 / 「1」前有無空格等不一致，勿「修正」它們——欄名必須與官方檔完全相同。

/** 官方 82 欄表頭（單一事實來源，欄序即 CSV 欄序） */
export const KIDIT_VASCULAR_CSV_HEADERS: string[] = [
  '身份證號',
  '病歷號',
  '日期',
  // 欄 4-15：目前通路快照（自體/人工/PermCath/短期 × 是否/左右/位置）
  '自體動靜脈廔管',
  '左右',
  '自體動靜脈廔管位置',
  '人工動靜脈廔管',
  '左右',
  '人工動靜脈廔管位置',
  'PermCath或其他長期導管',
  '左右',
  'PermCath或其他長期導管位置',
  '其他短期導管',
  '左右',
  '其他短期導管位置',
  '本季透析時最佳pump blood flow  ml/min', // 官方檔即為雙空格
  'vascular access flow  ml/min ',         // 官方檔即為雙空格＋行尾空格
  '是否使用遠紅外線治療',
  '每周幾次',
  '平均每周總治療時間（分鐘）',
  '是否使用其他熱治療法',
  '治療方法',
  '平均每周總治療時間（分鐘）',
  '是否並存其他血管通路方式',
  // 欄 25-36：並存通路（同快照 12 欄）
  '自體動靜脈廔管',
  '左右',
  '自體動靜脈廔管位置',
  '人工動靜脈廔管',
  '左右',
  '人工動靜脈廔管位置',
  'PermCath或其他長期導管',
  '左右',
  'PermCath或其他長期導管位置',
  '其他短期導管',
  '左右',
  '其他短期導管位置',
  '是否有血管通路問題',
  // 欄 38-49：介入治療 ×3
  '介入治療日期 1',
  '血管通\uF937失敗原因 1', // 官方檔此欄的「路」是相容表意字 U+F937（非一般 U+8DEF），逐字照抄勿改
  '原有血管重建方式 1',
  '原有血管重建其他方式 1',
  '介入治療日期 2',
  '血管通\uF937失敗原因 2', // 官方檔此欄的「路」是相容表意字 U+F937（非一般 U+8DEF），逐字照抄勿改
  '原有血管重建方式 2',
  '原有血管重建其他方式 2',
  '介入治療日期 3',
  '血管通\uF937失敗原因 3', // 官方檔此欄的「路」是相容表意字 U+F937（非一般 U+8DEF），逐字照抄勿改
  '原有血管重建方式 3',
  '原有血管重建其他方式 3',
  // 欄 50-82：血管重建 ×3（官方檔第 1 組「1」前無空格、第 2 組部分欄有空格，照抄）
  '血管重建日期 1',
  '前次血管通路失敗原因 1',
  '是否是自體動靜脈廔管1',
  '左右1',
  '自體動靜脈廔管位置1',
  '是否是人工動靜脈廔管1',
  '左右1',
  '人工動靜脈廔管位置1',
  '是否是PermCath或其他長期導管1',
  '左右1',
  'PermCath或其他長期導管位置1',
  '血管重建日期 2',
  '前次血管通路失敗原因 2',
  '是否是自體動靜脈廔管2',
  '左右 2',
  '自體動靜脈廔管位置 2',
  '是否是人工動靜脈廔管 2',
  '左右 2',
  '人工動靜脈廔管位置 2',
  '是否是PermCath或其他長期導管 2',
  '左右 2',
  'PermCath或其他長期導管位置 2',
  '血管重建日期 3',
  '前次血管通路失敗原因 3',
  '是否是自體動靜脈廔管 3',
  '左右 3',
  '自體動靜脈廔管位置 3',
  '是否是人工動靜脈廔管 3',
  '左右 3',
  '人工動靜脈廔管位置 3',
  '是否是PermCath或其他長期導管 3',
  '左右 3',
  'PermCath或其他長期導管位置 3',
];

const accessGroupKeys = (prefix: string): string[] => [
  `${prefix}AvfYn`, `${prefix}AvfSide`, `${prefix}AvfSite`,
  `${prefix}AvgYn`, `${prefix}AvgSide`, `${prefix}AvgSite`,
  `${prefix}PermYn`, `${prefix}PermSide`, `${prefix}PermSite`,
  `${prefix}TempYn`, `${prefix}TempSide`, `${prefix}TempSite`,
];
const itvGroupKeys = (n: number): string[] => [
  `itv${n}Date`, `itv${n}Reason`, `itv${n}Method`, `itv${n}MethodOther`,
];
const recGroupKeys = (n: number): string[] => [
  `rec${n}Date`, `rec${n}PrevReason`,
  `rec${n}AvfYn`, `rec${n}AvfSide`, `rec${n}AvfSite`,
  `rec${n}AvgYn`, `rec${n}AvgSide`, `rec${n}AvgSite`,
  `rec${n}PermYn`, `rec${n}PermSide`, `rec${n}PermSite`,
];

/** 82 個欄位鍵，與 KIDIT_VASCULAR_CSV_HEADERS 一一對應（同索引=同欄） */
export const KIDIT_VASCULAR_FIELD_KEYS: string[] = [
  'idNumber', 'medicalRecordNumber', 'reportDate',
  ...accessGroupKeys('cur'),
  'bestPumpFlow', 'accessFlow',
  'firYn', 'firPerWeek', 'firWeeklyMinutes',
  'otherHeatYn', 'otherHeatMethod', 'otherHeatMinutes',
  'coexistYn',
  ...accessGroupKeys('co'),
  'hasProblem',
  ...itvGroupKeys(1), ...itvGroupKeys(2), ...itvGroupKeys(3),
  ...recGroupKeys(1), ...recGroupKeys(2), ...recGroupKeys(3),
];

// 開發期防呆：兩個陣列必須同為 82 欄且互相對齊；不一致代表有人改壞了單一事實來源。
if (KIDIT_VASCULAR_CSV_HEADERS.length !== 82 || KIDIT_VASCULAR_FIELD_KEYS.length !== 82) {
  throw new Error(
    `[kiditVascularCsvService] 欄位數不符 82（headers=${KIDIT_VASCULAR_CSV_HEADERS.length}, keys=${KIDIT_VASCULAR_FIELD_KEYS.length}）`,
  );
}

// ---------------------------------------------------------------------------
// 季度 / 日期小工具
// ---------------------------------------------------------------------------

/** 季度起迄（Q1=01-01~03-31、Q2=04-01~06-30、Q3=07-01~09-30、Q4=10-01~12-31） */
export function quarterRange(year: number, q: number): { startDate: string; endDate: string } {
  const startMonth = (q - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  const lastDay = new Date(year, endMonth, 0).getDate();
  const p2 = (n: number) => String(n).padStart(2, '0');
  return {
    startDate: `${year}-${p2(startMonth)}-01`,
    endDate: `${year}-${p2(endMonth)}-${p2(lastDay)}`,
  };
}

/** 今天所屬季度 */
export function currentQuarter(today: Date = new Date()): { year: number; q: number } {
  return { year: today.getFullYear(), q: Math.floor(today.getMonth() / 3) + 1 };
}

/** YYYY-MM-DD → 民國 7 碼（2026-07-01 → 1150701）。無法解析回空字串。 */
export function toRocDate7(dateStr: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || ''));
  if (!m) return '';
  const rocYear = Number(m[1]) - 1911;
  if (rocYear <= 0) return '';
  return `${rocYear}${m[2]}${m[3]}`;
}

// ---------------------------------------------------------------------------
// CSV 產生與下載
// ---------------------------------------------------------------------------

/** 值含逗號/雙引號/換行時以雙引號包裹並跳脫 */
function escapeCsvValue(value: string): string {
  const s = value == null ? '' : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** rows：每列一個 Record，鍵為 KIDIT_VASCULAR_FIELD_KEYS；缺鍵補空字串 */
export function buildKiditVascularCsv(rows: Record<string, string>[]): string {
  const lines: string[] = [];
  lines.push(KIDIT_VASCULAR_CSV_HEADERS.map(escapeCsvValue).join(','));
  for (const row of rows) {
    lines.push(KIDIT_VASCULAR_FIELD_KEYS.map((k) => escapeCsvValue(row[k] ?? '')).join(','));
  }
  return lines.join('\r\n');
}

/**
 * 下載季度造管 CSV。
 * 檔名：病患血液透析造管CSV檔_YYYYMMDD-YYYYMMDD.csv（西元 8 碼季度起迄）
 * 內容前綴 UTF-8 BOM (U+FEFF)，供 KiDit / Excel 正確辨識編碼。
 */
export function downloadKiditVascularCsv(
  rows: Record<string, string>[],
  startDate: string,
  endDate: string,
): void {
  const csv = buildKiditVascularCsv(rows);
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const start8 = startDate.replace(/-/g, '');
  const end8 = endDate.replace(/-/g, '');
  const filename = `病患血液透析造管CSV檔_${start8}-${end8}.csv`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
