// KiDit「初次建檔」官方匯入格式 CSV：病患資料 + 病史原發病（取代舊三合一 Excel）。
// 欄位順序與代碼值依「Kidit資料匯入格式說明.xls」；日期為民國 7 碼（toRocDate）。
// 病患資料表頭逐字複製官方樣本 Patient_YYYYMMDD.csv；病史原發病無官方樣本，
// 表頭逐字複製格式說明檔「欄位內容」（含 4.7 版新增欄位之插入位置，勿正規化）。
// UTF-8 BOM 前綴 + CRLF 換行，同 kiditVascularCsvService 慣例。
import { toRocDate } from '@/utils/kiditHelpers';

/** 官方病患資料 CSV 表頭（23 欄，逐字複製官方樣本檔）；每月基本資料 CSV 亦重用此格式 */
export const PATIENT_CSV_HEADERS = [
  '姓名', '病患類別', '生日', '身份證號', '性別', '婚姻', '電話', '病歷號', '透析代號', '地址',
  '教育程度', '職業', '連絡人', '關係', '血型', '重大傷病卡號', '是否為原住民', '是否具福保身分',
  '狀態', '首次治療日期', '本院開始治療日期', '原發病大類', '原發病細類',
];

/** 官方病史原發病 CSV 表頭（54 欄，逐字複製格式說明檔，含 4.7 版新增欄） */
const HISTORY_CSV_HEADERS = [
  '身份證號', '病歷號', '轉入院所名稱', '轉入院所醫事代號', '開始血液透析日期',
  '是否本院開始血液透析', '開始血液透析院所', '腹膜透析開始日期', '是否本院開始腹膜透析',
  '腹膜透析開始院所', '腎移植日期', '是否本院腎移植', '腎移植院所', '是否知為慢性腎衰竭',
  'BUN或Creatinine異常', 'BUN/Creatinine 檢驗日期', 'BUN (mg/dl)', 'Cretinine (mg/dl)',
  '腎臟超音波檢查異常', '腎臟超音波檢查異常說明', '腎臟超音波檢查異常其他說明',
  '腎臟超音波檢驗日期日期', '其他系統性疾病', '其他', 'DM型式', '檢驗日期', 'Hct (%)',
  'Hb(g/dl)', 'BUN(mg/dl)', 'Creatinine(mg/dl)', 'K(meq/l)', 'CCr(ml/min)', 'Albumin(gm/dl)',
  '體重(kg)', '身高(cm)', 'eGFR(ml/min)', 'HBsAg', 'Anti-HCV', '適應症種類', '其他症狀',
  '其他症狀(其他)', '緊急透析原因', '緊急透析原因(其他)', '檢驗日期', 'Hct (%)', 'Hb (g/dl)',
  'BUN (mg/dl)', 'Creatinine (mg/dl)', 'CCr (ml/min)', 'Na (mg/dl)', 'K (meq/l)',
  'HCO3 (meq/l)', 'Albumin(gm/dl)', '是否初次申請重大傷病',
];

/** 複選題索引陣列 → 官方 0/1 字串（同舊 Excel 匯出邏輯） */
function mapCheckboxes(selectedIndices: number[] | undefined, totalBits: number): string {
  const result = Array(totalBits).fill('0');
  if (Array.isArray(selectedIndices)) {
    selectedIndices.forEach((idx) => {
      if (idx < totalBits) result[idx] = '1';
    });
  }
  return result.join('');
}

/** 物件是否有任何非空自有值（過濾未建檔的空事件，避免匯出空白列） */
function hasAnyValue(obj: any): boolean {
  if (!obj || typeof obj !== 'object') return false;
  return Object.values(obj).some((v) => {
    if (v == null || v === '') return false;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'object') return hasAnyValue(v);
    return true;
  });
}

/** 值順序對應 PATIENT_CSV_HEADERS（同舊 Excel 病患資料 sheet 的欄位對應）；每月基本資料 CSV 亦重用 */
export function buildPatientRow(p: any): string[] {
  return [
    p.name || '', p.patientCategory || '', toRocDate(p.birthDate), p.idNumber || '',
    p.gender || '', p.maritalStatus || '', p.phone || '', p.medicalRecordNumber || '',
    p.dialysisCode || '', p.address || '', p.education || '', p.occupation || '',
    p.contactPerson || '', p.relationship || '', p.bloodType || '', p.catastrophicCardNo || '',
    p.isIndigenous || '', p.isWelfare || '', p.status || '', toRocDate(p.firstDialysisDate),
    toRocDate(p.hospitalStartDate), p.diagnosisCategory || '', p.diagnosisSubcategory || '',
  ].map((v) => String(v ?? ''));
}

/** 值順序對應 HISTORY_CSV_HEADERS（同舊 Excel 病史原發病 sheet 的欄位對應，含 28/29 舊資料 fallback） */
export function buildHistoryRow(p: any, h: any): string[] {
  return [
    p.idNumber || '', p.medicalRecordNumber || '', h.transferFromName || '', h.transferFromCode || '',
    toRocDate(h.startHDDate), h.isStartHDHere || '', h.startHDHospital || '',
    toRocDate(h.startPDDate), h.isStartPDHere || '', h.startPDHospital || '',
    toRocDate(h.transplantDate), h.isTransplantHere || '', h.transplantHospital || '',
    h.isKnownCKD || '', h.isBUNCreatAbnormal || '', toRocDate(h.abnormalLabDate),
    h.initialBUN || '', h.initialCr || '', h.renalUltrasoundAbnormal || '',
    h.renalUltrasoundDesc || '', h.renalUltrasoundOtherDesc || '', toRocDate(h.renalUltrasoundDate),
    mapCheckboxes(h.selectedSystemicDiseases, 15), h.otherSystemicDescription || '', h.dmType || '',
    toRocDate(h.initialLabDate), h.initialHct || '', h.initialHb || '',
    // 28/29 舊資料未填專屬欄位時，沿用 17/18 異常值（維持既往匯出行為）
    h.initialLabBUN || h.initialBUN || '', h.initialLabCr || h.initialCr || '',
    h.initialK || '', h.initialCCr || '', h.initialAlb || '',
    h.initialWeight || '', h.initialHeight || '', h.initialEGFR || '',
    h.hbsag || '', h.antihcv || '', h.indicationType || '',
    mapCheckboxes(h.selectedSymptoms, 15), h.symptomsOtherDescription || '',
    mapCheckboxes(h.selectedEmergencyReasons, 20), h.emergencyReasonsOtherDescription || '',
    toRocDate(h.emergencyLabDate), h.emergencyHct || '', h.emergencyHb || '',
    h.emergencyBUN || '', h.emergencyCr || '', h.emergencyCCr || '', h.emergencyNa || '',
    h.emergencyK || '', h.emergencyHCO3 || '', h.emergencyAlb || '', h.isFirstCatastrophic || '',
  ].map((v) => String(v ?? ''));
}

/** 值含逗號/雙引號/換行時以雙引號包裹並跳脫 */
function escapeCsvValue(value: string): string {
  const s = value == null ? '' : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildCsv(headers: string[], rows: string[][]): string {
  const lines: string[] = [];
  lines.push(headers.map(escapeCsvValue).join(','));
  for (const row of rows) {
    lines.push(row.map(escapeCsvValue).join(','));
  }
  return lines.join('\r\n');
}

function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** 匯出當日西元 8 碼（官方樣本檔名慣例：Patient_20260711.csv） */
function todayStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 由整月 KiDit 日誌本事件萃取建檔資料（同病人取第一筆「有建檔資料」的事件），
 * 只保留實際填過建檔資料的病人（profile/history 有內容才各自成列）。
 * ⚠️ 空事件不佔位（2026-08-04 修正）：同月先有一筆未填建檔的事件（如住院「新增」）、
 * 建檔資料在後面的事件時，舊邏輯「取第一筆事件」會讓該病人整個從 CSV 消失（黃才芳案）。
 */
export function buildInitialRegistrationRows(logbookEvents: any[]): {
  patientRows: string[][];
  historyRows: string[][];
} {
  const patientRows: string[][] = [];
  const historyRows: string[][] = [];

  // 依病人分組（Map 保留首次出現順序，列序與舊版一致）
  const byPatient = new Map<string, any[]>();
  logbookEvents.forEach((event) => {
    if (!event?.patientId) return;
    const list = byPatient.get(event.patientId) || [];
    list.push(event);
    byPatient.set(event.patientId, list);
  });

  byPatient.forEach((events) => {
    const withData = events.filter(
      (e) => hasAnyValue(e.kidit_profile || {}) || hasAnyValue(e.kidit_history || {}),
    );
    if (withData.length === 0) return;
    // 優先取「身分證已填」的事件（完整建檔），其次第一筆有資料的事件（部分填寫仍呈現）
    const best = withData.find((e) => e.kidit_profile?.idNumber) || withData[0];
    const p = best.kidit_profile || {};
    const h = best.kidit_history || {};
    if (hasAnyValue(p)) patientRows.push(buildPatientRow(p));
    if (hasAnyValue(h)) historyRows.push(buildHistoryRow(p, h));
  });

  return { patientRows, historyRows };
}

/** 下載官方病患資料 CSV（Patient_YYYYMMDD.csv） */
export function downloadPatientCsv(patientRows: string[][]): void {
  downloadCsv(buildCsv(PATIENT_CSV_HEADERS, patientRows), `Patient_${todayStamp()}.csv`);
}

/** 下載官方病史原發病 CSV（病史原發病CSV檔_YYYYMMDD.csv） */
export function downloadHistoryCsv(historyRows: string[][]): void {
  downloadCsv(buildCsv(HISTORY_CSV_HEADERS, historyRows), `病史原發病CSV檔_${todayStamp()}.csv`);
}
