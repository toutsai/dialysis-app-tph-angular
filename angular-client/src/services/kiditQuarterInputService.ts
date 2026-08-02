// 季度病人 KiDit 輸入（透析紀錄 HDRECORD / 醫療狀況評估 DIAGNOSE / 合併症）：
// 表單欄位定義、選項代碼、預帶邏輯、儲存 API 與三支官方 CSV 匯出。
// 官方格式依「Kidit資料匯入格式說明.xls」與 D:\KiDit匯入 樣本檔：
// - 透析紀錄/合併症表頭逐字複製官方樣本檔；醫療狀況評估無樣本，逐字複製格式說明檔（含苜次/迥診/副甲狀線原文勿正規化）
// - 合併症複選字串以樣本檔為準＝33 碼（格式說明檔寫 S25 是舊版）
// - 日期民國 7 碼；UTF-8 BOM + CRLF
import { localApi } from '@/services/localApiClient';
import { toRocDate7 } from '@/services/kiditVascularCsvService';

// ---------------------------------------------------------------------------
// 型別
// ---------------------------------------------------------------------------

export interface KiditQuarterData {
  hdrecord?: Record<string, any>;
  diagnose?: Record<string, any>;
  comorbid?: { date?: string; codes?: string[]; note1?: string; note2?: string };
  completed?: { hdrecord?: boolean; diagnose?: boolean; comorbid?: boolean };
  nurse?: { uid: string; name: string };
}

export interface KiditQuarterRecord {
  patientId: string;
  data: KiditQuarterData;
  updatedBy: { uid?: string; name?: string };
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// 選項代碼（依格式說明檔）
// ---------------------------------------------------------------------------

export const YN_OPTIONS = [
  { value: 'Y', label: '是' },
  { value: 'N', label: '否' },
];

export const EPO_TYPE_OPTIONS = [
  { value: '1', label: '1 Epoetin-a (Eprex)' },
  { value: '2', label: '2 Epoetin-b (Recormon)' },
  { value: '3', label: '3 Darbepoetin-a (Nesp)' },
  { value: '4', label: '4 Glycol-epoetin-b (Mircera)' },
  { value: '9', label: '9 其它 EPO' },
];

export const IS_LIVING_OPTIONS = [
  { value: '1', label: '1 門診' },
  { value: '2', label: '2 住院' },
];

export const FE_METHOD_OPTIONS = [
  { value: '1', label: '1 口服' },
  { value: '2', label: '2 IV' },
  { value: '3', label: '3 兩者皆有' },
];

export const LIFE_EVALU_OPTIONS = [
  { value: '10', label: '10 彌留狀態，病情急速惡化' },
  { value: '20', label: '20 病重，須住院及積極性醫療輔助' },
  { value: '30', label: '30 嚴重之殘疾狀態，須住院但無死亡之立即危險' },
  { value: '40', label: '40 殘疾狀態，須特別照顧' },
  { value: '50', label: '50 須相當程度地依靠他人幫助，及經常的醫療照顧' },
  { value: '60', label: '60 有時須人幫助，但能作大部分個人生活所需之工作' },
  { value: '70', label: '70 能照顧自己，但無法從事正常活動或輕勞力之工作' },
  { value: '80', label: '80 勞力工作時，出現疾病之症狀' },
  { value: '90', label: '90 能從事正常活動，只有輕微之疾病症狀' },
  { value: '100', label: '100 無任何不適，無疾病之任何症狀' },
];

export const GENE_EVALU_OPTIONS = [
  { value: '1', label: '1 全職工作' },
  { value: '2', label: '2 兼職工作' },
  { value: '3', label: '3 家管' },
  { value: '4', label: '4 在學中' },
  { value: '5', label: '5 可工作但失業' },
  { value: '6', label: '6 依賴但可照顧自己' },
  { value: '7', label: '7 須人照顧' },
  { value: '8', label: '8 退休' },
  { value: '9', label: '9 因病暫時休業' },
];

/** 合併症 33 項（複選；匯出為 33 碼 0/1 字串，以官方樣本檔為準） */
export const COMORBID_OPTIONS = [
  { code: '01', label: '鬱血性心臟衰竭' },
  { code: '02', label: '心肌梗塞' },
  { code: '03', label: '左心室肥大' },
  { code: '04', label: '腦血管病變（梗塞、出血）' },
  { code: '05', label: '副甲狀腺切除' },
  { code: '06', label: '慢性活動性肝炎' },
  { code: '07', label: '肝硬化' },
  { code: '08', label: '惡性腫瘤' },
  { code: '09', label: '肺結核' },
  { code: '10', label: '消化道出血' },
  { code: '11', label: '神經病變' },
  { code: '12', label: '腎性骨失養' },
  { code: '13', label: '腕溝症候群' },
  { code: '14', label: '氣喘' },
  { code: '15', label: '尿毒性皮膚病變' },
  { code: '16', label: '頑固性肋膜積水' },
  { code: '17', label: '頑固性腹水' },
  { code: '18', label: '惡病質' },
  { code: '19', label: '高血壓' },
  { code: '20', label: '冠狀動脈疾病' },
  { code: '21', label: '心肌病變' },
  { code: '22', label: '糖尿病' },
  { code: '23', label: 'COPD' },
  { code: '24', label: 'GERD' },
  { code: '25', label: '其他' },
  { code: '26', label: '半癱，側癱' },
  { code: '27', label: 'AIDS' },
  { code: '28', label: '腫瘤轉移' },
  { code: '29', label: 'Gout' },
  { code: '30', label: '高血脂' },
  { code: '31', label: 'DEMENTIA' },
  { code: '32', label: '癌症接受化學治療' },
  { code: '33', label: '非腎性貧血' },
];

/** 病人疾病標籤 → 合併症代碼（保守對照：只映射無歧義者，其餘由主護勾選） */
const COMORBID_PREFILL_RULES: { pattern: RegExp; code: string }[] = [
  { pattern: /糖尿病|DM/i, code: '22' },
  { pattern: /高血壓|HTN/i, code: '19' },
  { pattern: /痛風|GOUT/i, code: '29' },
  { pattern: /高血脂/, code: '30' },
  { pattern: /GERD|胃食道逆流/i, code: '24' },
  { pattern: /COPD/i, code: '23' },
  { pattern: /氣喘/, code: '14' },
  { pattern: /失智|DEMENTIA/i, code: '31' },
];

// EPO/鐵劑/活性維他命藥碼（injection_orders.order_code，對照 dailyInjectionService INJECTION_MEDS）
const EPO_CODE_TO_TYPE: Record<string, string> = {
  INES2: '3', // NESP (Darbepoetin alfa)
  IREC1: '2', // Recormon (Epoetin beta)
};
const IRON_CODES = new Set(['IFER2']); // Fe-back（IV 鐵劑）
const VITD_CODES = new Set(['ICAC']); // Cacare（Calcitriol 活性維他命 D）

// ---------------------------------------------------------------------------
// 儲存 API（kidit_quarter_records，比照 vascular quarter_exports 模式）
// ---------------------------------------------------------------------------

export async function fetchQuarterRecords(quarter: string): Promise<KiditQuarterRecord[]> {
  const res = await localApi.get(`/nursing/kidit-quarter-records/${quarter}`);
  return (res as any)?.records || [];
}

export async function saveQuarterRecord(
  quarter: string,
  patientId: string,
  data: KiditQuarterData,
): Promise<void> {
  await localApi.put(`/nursing/kidit-quarter-records/${quarter}/${patientId}`, { data });
}

// ---------------------------------------------------------------------------
// 預帶（只在該欄位尚未填寫時套用；來源＝藥囑區間/檢驗/病人狀態/疾病標籤）
// ---------------------------------------------------------------------------

export interface PrefillSources {
  patient: any; // PatientStore 病人物件（status/diseases）
  injectionOrders: any[]; // 該病人的 injection_orders（camelCase，含 startDate/endDate）
  labReports: any[]; // 該病人的 lab_reports（reportDate DESC）
  quarterStart: string;
  quarterEnd: string;
}

/** 藥囑在季度內有效（區間模型：startDate<=季末 且 (無 endDate 或 endDate>=季初)） */
function activeInQuarter(o: any, quarterStart: string, quarterEnd: string): boolean {
  const start = String(o.startDate || '');
  const end = String(o.endDate || '');
  if (!start) return false;
  return start <= quarterEnd && (!end || end >= quarterStart);
}

export function buildPrefill(src: PrefillSources): KiditQuarterData {
  const { patient, injectionOrders, labReports, quarterStart, quarterEnd } = src;

  const active = (injectionOrders || []).filter((o) => activeInQuarter(o, quarterStart, quarterEnd));
  const epoOrder = active.find((o) => EPO_CODE_TO_TYPE[o.orderCode]);
  const hasIron = active.some((o) => IRON_CODES.has(o.orderCode));
  const hasVitD = active.some((o) => VITD_CODES.has(o.orderCode));

  // 檢驗：日期＝當季最後一次抽血日（季內最新報告）；Hb/Hct 值取季末前最新一筆有值者
  const reports = (labReports || [])
    .filter((r) => String(r.reportDate || '') <= quarterEnd)
    .sort((a, b) => String(b.reportDate).localeCompare(String(a.reportDate)));
  const inQuarter = reports.find((r) => String(r.reportDate) >= quarterStart);
  const labDate = inQuarter ? String(inQuarter.reportDate).slice(0, 10) : '';
  const pick = (key: string): string => {
    for (const r of reports) {
      const v = r?.data?.[key];
      if (v !== undefined && v !== null && v !== '') return String(v);
    }
    return '';
  };

  const isLiving = patient?.status === 'opd' ? '1' : patient?.status ? '2' : '';

  const diseases: string[] = Array.isArray(patient?.diseases) ? patient.diseases : [];
  const comorbidCodes = new Set<string>();
  for (const d of diseases) {
    for (const rule of COMORBID_PREFILL_RULES) {
      if (rule.pattern.test(String(d))) comorbidCodes.add(rule.code);
    }
  }

  return {
    hdrecord: {
      date: labDate,
      isLiving,
      isIVFe: hasIron ? 'Y' : 'N',
      epoType: epoOrder ? EPO_CODE_TO_TYPE[epoOrder.orderCode] : '',
      // NESP 劑量單位 mcg → 劑UG；Recormon 為 KIU → 劑U（原值帶入，請主護核對換算）
      epoUG: epoOrder && epoOrder.orderCode === 'INES2' ? String(epoOrder.dose || '') : '',
      epoU: epoOrder && epoOrder.orderCode === 'IREC1' ? String(epoOrder.dose || '') : '',
      hct: pick('Hct'),
      hbc: pick('Hb'),
    },
    diagnose: {
      date: labDate,
      isEPO: epoOrder ? 'Y' : 'N',
      epoType: epoOrder ? EPO_CODE_TO_TYPE[epoOrder.orderCode] : '',
      isVITD: hasVitD ? 'Y' : 'N',
      isFE: hasIron ? 'Y' : 'N',
      feMethod: hasIron ? '2' : '',
    },
    comorbid: {
      date: labDate,
      codes: [...comorbidCodes].sort(),
    },
  };
}

/** 合併 saved 與 prefill：已填值優先，空值用預帶補 */
export function mergeWithPrefill(saved: KiditQuarterData, prefill: KiditQuarterData): KiditQuarterData {
  const mergeSection = (s: Record<string, any> = {}, p: Record<string, any> = {}) => {
    const out: Record<string, any> = { ...s };
    for (const [k, v] of Object.entries(p)) {
      const cur = out[k];
      const isEmpty = cur === undefined || cur === null || cur === '' || (Array.isArray(cur) && cur.length === 0);
      if (isEmpty && v !== undefined && v !== null && v !== '') out[k] = v;
    }
    return out;
  };
  return {
    hdrecord: mergeSection(saved.hdrecord, prefill.hdrecord),
    diagnose: mergeSection(saved.diagnose, prefill.diagnose),
    comorbid: mergeSection(saved.comorbid || {}, prefill.comorbid || {}) as KiditQuarterData['comorbid'],
    completed: { ...(saved.completed || {}) },
    nurse: saved.nurse,
  };
}

// ---------------------------------------------------------------------------
// 官方 CSV 匯出（工作站季度輸入頁籤用）
// ---------------------------------------------------------------------------

/** 透析紀錄 20 欄（表頭逐字複製官方樣本 病患透析紀錄CSV檔_*.csv） */
const HDRECORD_CSV_HEADERS = [
  '身份證號', '病歷號', '日期', '上次透析後體重', '透析前體重', '透析後體重', '理想乾體重',
  '透析前收縮壓', '透析後收縮壓', '透析前舒張壓', '透析後舒張壓', '門診／住院', '是否使用IV鐵劑',
  '輸血量', 'EPO種類', 'EPO劑U', 'EPO劑UG', 'HCT', 'HBC', '特殊狀況',
];

/** 醫療狀況評估 18 欄（表頭逐字複製格式說明檔，含原文異體字勿正規化） */
const DIAGNOSE_CSV_HEADERS = [
  '身份證號', '病歷號', '日期', '是否使用', 'EPO類型', '是否使用活性維他命', '是否使用降血壓劑',
  '是否使用鐵劑', '鐵劑型式', '生活活動評估', '一般狀況評估', '副甲狀線切除', '副甲狀線切除日期',
  '登錄等待換腎院所代號', '苜次登錄日期', '最近一次迥診日期', 'EPO用量(U)', 'EPO用量(ug)',
];

/** 合併症 6 欄（表頭逐字複製官方樣本 病患合併症CSV檔_*.csv；合併症＝33 碼 0/1） */
const COMORBID_CSV_HEADERS = ['身份證號', '病歷號', '日期', '合併症', '附註一', '附註二'];

export interface QuarterExportRow {
  idNumber: string;
  medicalRecordNumber: string;
  data: KiditQuarterData;
}

const s = (v: any): string => (v === undefined || v === null ? '' : String(v));

function buildHdrecordRow(r: QuarterExportRow): string[] {
  const f = r.data.hdrecord || {};
  return [
    r.idNumber, r.medicalRecordNumber, toRocDate7(f['date']),
    s(f['heavyLast']), s(f['heavyBHD']), s(f['heavyAHD']), s(f['dryHeavy']),
    s(f['paBHD']), s(f['paAHD']), s(f['pbBHD']), s(f['pbAHD']),
    s(f['isLiving']), s(f['isIVFe']), s(f['blood']),
    s(f['epoType']), s(f['epoU']), s(f['epoUG']), s(f['hct']), s(f['hbc']), s(f['memo']),
  ];
}

function buildDiagnoseRow(r: QuarterExportRow): string[] {
  const f = r.data.diagnose || {};
  return [
    r.idNumber, r.medicalRecordNumber, toRocDate7(f['date']),
    s(f['isEPO']), s(f['epoType']), s(f['isVITD']), s(f['isDOWNPA']),
    s(f['isFE']), s(f['feMethod']), s(f['lifeEvalu']), s(f['geneEvalu']),
    s(f['isPTX']), toRocDate7(f['ptxDate']),
    s(f['nephHosp']), toRocDate7(f['nephStartDate']), toRocDate7(f['nephLastDate']),
    // EPO用量兩欄：官方說明「當月累計量，轉入自動計算」→ 匯出留空
    '', '',
  ];
}

function buildComorbidRow(r: QuarterExportRow): string[] {
  const f = r.data.comorbid || {};
  const codes = new Set(f.codes || []);
  const bits = COMORBID_OPTIONS.map((o) => (codes.has(o.code) ? '1' : '0')).join('');
  return [r.idNumber, r.medicalRecordNumber, toRocDate7(f.date), bits, s(f.note1), s(f.note2)];
}

function escapeCsvValue(value: string): string {
  const str = value == null ? '' : String(value);
  if (/[",\r\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function downloadCsv(headers: string[], rows: string[][], filename: string): void {
  const lines = [headers.map(escapeCsvValue).join(',')];
  for (const row of rows) lines.push(row.map(escapeCsvValue).join(','));
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** 檔名季度區間西元 8 碼（官方樣本慣例：病患透析紀錄CSV檔_20260624-20260630.csv） */
function rangeStamp(quarterStart: string, quarterEnd: string): string {
  return `${quarterStart.replace(/-/g, '')}-${quarterEnd.replace(/-/g, '')}`;
}

export function downloadHdrecordCsv(rows: QuarterExportRow[], quarterStart: string, quarterEnd: string): void {
  downloadCsv(HDRECORD_CSV_HEADERS, rows.map(buildHdrecordRow), `病患透析紀錄CSV檔_${rangeStamp(quarterStart, quarterEnd)}.csv`);
}

export function downloadDiagnoseCsv(rows: QuarterExportRow[], quarterStart: string, quarterEnd: string): void {
  downloadCsv(DIAGNOSE_CSV_HEADERS, rows.map(buildDiagnoseRow), `病患醫療狀況評估CSV檔_${rangeStamp(quarterStart, quarterEnd)}.csv`);
}

export function downloadComorbidCsv(rows: QuarterExportRow[], quarterStart: string, quarterEnd: string): void {
  downloadCsv(COMORBID_CSV_HEADERS, rows.map(buildComorbidRow), `病患合併症CSV檔_${rangeStamp(quarterStart, quarterEnd)}.csv`);
}
