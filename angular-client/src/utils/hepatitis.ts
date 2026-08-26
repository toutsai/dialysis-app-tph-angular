// B/C 肝四態（病人清單）：與 KiDit 病史表單 33/34 同碼，後端對應 src/utils/hepatitis.js（規則須一致）
// hbsag / antihcv：Y 陽性、N 陰性、O 未做、F 已作待追蹤（＋追蹤日期站內欄）
// 病人清單為權威；diseases 的 HBV/HCV/BC肝? 標籤由四態衍生，排程備註/分組/統計等消費端沿用標籤不改

export type HepatitisValue = 'Y' | 'N' | 'O' | 'F' | '';

export interface HepatitisStatus {
  hbsag: HepatitisValue;
  antihcv: HepatitisValue;
  hbsagFollowDate: string;
  antihcvFollowDate: string;
}

export const HEPATITIS_OPTIONS: { value: HepatitisValue; label: string }[] = [
  { value: 'Y', label: '陽性(+)' },
  { value: 'N', label: '陰性(-)' },
  { value: 'O', label: '未做' },
  { value: 'F', label: '已作待追蹤' },
];

export function hepatitisLabel(v: unknown): string {
  return HEPATITIS_OPTIONS.find((o) => o.value === v)?.label || '未填';
}

const HEP_TAGS = ['HBV', 'HCV', 'BC肝?'];

/** 由舊 diseases 標籤推導四態（沒勾＝陰性、BC肝?＝已作待追蹤，2026-08-27 使用者裁定） */
export function deriveHepatitisFromTags(diseases: unknown): HepatitisStatus {
  const tags = Array.isArray(diseases) ? diseases.map(String) : [];
  const pending = tags.includes('BC肝?');
  return {
    hbsag: tags.includes('HBV') ? 'Y' : pending ? 'F' : 'N',
    antihcv: tags.includes('HCV') || tags.includes('C肝治癒') ? 'Y' : pending ? 'F' : 'N',
    hbsagFollowDate: '',
    antihcvFollowDate: '',
  };
}

export function normalizeHepatitisStatus(input: unknown): HepatitisStatus {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const norm = (v: unknown): HepatitisValue => {
    const s = typeof v === 'string' ? v.trim().toUpperCase() : '';
    return (['Y', 'N', 'O', 'F'] as const).includes(s as 'Y') ? (s as HepatitisValue) : '';
  };
  const hbsag = norm(src['hbsag']);
  const antihcv = norm(src['antihcv']);
  return {
    hbsag,
    antihcv,
    hbsagFollowDate: hbsag === 'F' ? String(src['hbsagFollowDate'] || '') : '',
    antihcvFollowDate: antihcv === 'F' ? String(src['antihcvFollowDate'] || '') : '',
  };
}

/** 依四態同步標籤：Y→HBV/HCV；任一為 O/F→BC肝?；其他標籤原樣保留 */
export function syncTagsFromHepatitis(diseases: unknown, status: HepatitisStatus): string[] {
  const base = (Array.isArray(diseases) ? diseases.map(String) : []).filter((t) => !HEP_TAGS.includes(t));
  if (status.hbsag === 'Y') base.push('HBV');
  if (status.antihcv === 'Y') base.push('HCV');
  if (['O', 'F'].includes(status.hbsag) || ['O', 'F'].includes(status.antihcv)) base.push('BC肝?');
  return base;
}
