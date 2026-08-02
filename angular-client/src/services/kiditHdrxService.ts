// KiDit「HD處方」季度申報：由病人透析醫囑（patients.dialysis_orders JSON）自動產生季度快照，
// 專師於工作站逐欄核對修改後匯出官方 17 欄 CSV。
// - 表頭逐字複製官方樣本 病患血液透析處方CSV檔_*.csv
// - 透析器型號依格式說明填「AK 透析器型號對應」的對應代碼（ak-dialyzer-map.ts，402 筆）
// - 申報日期＝當季最後一次透析日；預帶為季度最後一天，可逐列修改
// - 人工覆寫存 kidit_quarter_records.data.hdrx = { excluded, values }（後端頂層鍵淺合併）
import { toRocDate7 } from '@/services/kiditVascularCsvService';
import { resolveAkCode } from '@app/core/constants/ak-dialyzer-map';

/** 官方 HD處方 CSV 表頭（17 欄，逐字複製官方樣本檔） */
const HDRX_CSV_HEADERS = [
  '身份證號', '病歷號', '日期', '透析方式', '血液流速(ml/min)', '透析液流速(ml/min)', '每週次數',
  'Hemodiafiltration 每月次數', '每次透析時間(hr)', '透析器表面積(m^2)', '抗凝劑', '初劑量(U)',
  '維持劑量(U/小時)', '透析器型號', '鹼基', '鈣離子濃度(meq/L)', '鉀離子濃度(meq/L)',
];

/** 欄位鍵（對齊 HDRX_CSV_HEADERS 第 3 欄起；前兩欄為病人身分） */
export const HDRX_FIELD_KEYS = [
  'date', 'mode', 'bloodFlow', 'dialysateFlow', 'weeklyFreq', 'hdfMonthly', 'hours',
  'surfaceArea', 'anticoag', 'initDose', 'maintDose', 'dialyzerCode', 'base', 'ca', 'k',
] as const;

export const HDRX_MODE_OPTIONS = [
  { value: '1', label: '1 Conventional HD' },
  { value: '2', label: '2 High efficient HD' },
  { value: '3', label: '3 High flux HD' },
  { value: '4', label: '4 Hemodiafiltration' },
  { value: '5', label: '5 CWH' },
  { value: '6', label: '6 DFPP' },
  { value: '7', label: '7 SLEF' },
  { value: '8', label: '8 PE' },
];

export const HDRX_ANTICOAG_OPTIONS = [
  { value: '1', label: '1 肝素' },
  { value: '2', label: '2 低分子量肝素' },
  { value: '3', label: '3 檸檬酸鈉' },
  { value: '0', label: '0 不使用抗凝劑' },
];

export const HDRX_BASE_OPTIONS = [
  { value: '1', label: '1 Acetate' },
  { value: '2', label: '2 Bicarbonate' },
  { value: '3', label: '3 Lactate' },
];

/** 系統透析模式 → 官方透析方式代碼（本院 HD 以 high flux 為預設，可逐列改） */
const MODE_TO_OFFICIAL: Record<string, string> = {
  HD: '3',
  SLED: '7',
  CVVHDF: '5',
  DFPP: '6',
  PP: '8',
};

/** freq 字串（如「一三五」）→ 每週次數 */
function weeklyFreqFromRule(freq: string): string {
  const days = String(freq || '').match(/[一二三四五六日]/g);
  return days && days.length ? String(days.length) : '';
}

/** 透析時間：優先時/分兩欄（X.Y 小時），fallback 舊 dialysisHours（同 DialysisOrderModal 解析優先序） */
function dialysisHoursFrom(o: any): string {
  const h = o?.dialysisTimeHours;
  const m = o?.dialysisTimeMinutes;
  if (h !== undefined && h !== null && h !== '') {
    const hours = Number(h) + (Number(m) || 0) / 60;
    return Number.isFinite(hours) ? String(Math.round(hours * 100) / 100) : '';
  }
  if (o?.dialysisHours !== undefined && o?.dialysisHours !== null && o?.dialysisHours !== '') {
    return String(o.dialysisHours);
  }
  return '';
}

export interface HdrxPrefillResult {
  values: Record<string, string>;
  akName: string; // 醫囑原始 AK 名稱（含輪替全字串），供畫面對照
  warnings: string[];
}

/**
 * 由透析醫囑建 HD處方預帶值。
 * 常規預設（需專師核對）：透析方式 HD→3 high flux、透析液流速 500、鹼基 2 Bicarbonate、鉀 2。
 * AK 輪替（/ 分隔多顆）取第一顆對應官方代碼。
 */
export function buildHdrxPrefill(patient: any, quarterEnd: string): HdrxPrefillResult {
  const o = patient?.dialysisOrders || {};
  const warnings: string[] = [];
  const mode = String(patient?.mode || o.mode || '');

  const akFull = String(o.ak || o.artificialKidney || '').trim();
  const akFirst = akFull.split('/')[0]?.trim() || '';
  const dialyzerCode = resolveAkCode(akFirst);
  if (akFirst && !dialyzerCode) warnings.push(`AK「${akFirst}」查無官方對應代碼，請手動選擇`);

  const heparinInit = o.heparinInitial;
  const heparinMaint = o.heparinMaintenance;
  const hasHeparin =
    (heparinInit !== undefined && heparinInit !== null && String(heparinInit) !== '' && Number(heparinInit) > 0) ||
    (heparinMaint !== undefined && heparinMaint !== null && String(heparinMaint) !== '' && Number(heparinMaint) > 0);

  const values: Record<string, string> = {
    date: quarterEnd,
    mode: MODE_TO_OFFICIAL[mode] || '',
    bloodFlow: o.bloodFlow != null && o.bloodFlow !== '' ? String(o.bloodFlow) : '',
    dialysateFlow:
      o.dialysateFlow != null && o.dialysateFlow !== ''
        ? String(o.dialysateFlow)
        : mode === 'HD' ? '500' : '',
    weeklyFreq: weeklyFreqFromRule(patient?.scheduleRule?.freq || ''),
    hdfMonthly: '',
    hours: dialysisHoursFrom(o),
    surfaceArea: '',
    anticoag: hasHeparin ? '1' : '',
    initDose: heparinInit != null && heparinInit !== '' ? String(heparinInit) : '',
    maintDose: heparinMaint != null && heparinMaint !== '' ? String(heparinMaint) : '',
    dialyzerCode,
    base: mode === 'HD' || mode === 'SLED' ? '2' : '',
    ca: o.dialysateCa != null && o.dialysateCa !== '' ? String(o.dialysateCa) : '',
    k: mode === 'HD' ? '2' : '',
  };

  return { values, akName: akFull, warnings };
}

// ---------------------------------------------------------------------------
// CSV 匯出
// ---------------------------------------------------------------------------

export interface HdrxExportRow {
  idNumber: string;
  medicalRecordNumber: string;
  values: Record<string, string>;
}

function escapeCsvValue(value: string): string {
  const s = value == null ? '' : String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** 檔名比照官方樣本：病患血液透析處方CSV檔_YYYYMMDD.csv（匯出當日西元 8 碼） */
export function downloadHdrxCsv(rows: HdrxExportRow[]): void {
  const lines = [HDRX_CSV_HEADERS.map(escapeCsvValue).join(',')];
  for (const r of rows) {
    const v = r.values || {};
    lines.push(
      [
        r.idNumber,
        r.medicalRecordNumber,
        toRocDate7(v['date']),
        ...HDRX_FIELD_KEYS.slice(1).map((k) => String(v[k] ?? '')),
      ]
        .map(escapeCsvValue)
        .join(','),
    );
  }
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `病患血液透析處方CSV檔_${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
