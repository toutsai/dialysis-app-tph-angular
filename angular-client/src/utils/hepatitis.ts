// 血液傳染病四項四態（病人清單）：HBsAg / Anti-HCV / HIV / RPR（梅毒），後端對應 src/utils/hepatitis.js（規則須一致）
// 每項值：Y 陽性、N 陰性、O 未做、F 已作待追蹤；每項另有「檢驗日期」（Y/N/F 皆應填，O 不填）
// B/C 肝兩項與 KiDit 病史表單 33/34 同碼（HIV/RPR 不進 KiDit）。
// 病人清單為權威；diseases 標籤由四態衍生（Y→HBV/HCV/HIV/RPR；F→「HBV待追蹤」等；N/O 不出標籤）。
// 2026-08-30：由 B/C 兩項＋F 才有追蹤日期，擴為四項＋檢驗日期；舊 *FollowDate 鍵相容讀取。

export type HepatitisValue = 'Y' | 'N' | 'O' | 'F' | '';
export type InfectionKey = 'hbsag' | 'antihcv' | 'hiv' | 'rpr';
export type InfectionDateKey = 'hbsagDate' | 'antihcvDate' | 'hivDate' | 'rprDate';

export interface HepatitisStatus {
  hbsag: HepatitisValue;
  antihcv: HepatitisValue;
  hiv: HepatitisValue;
  rpr: HepatitisValue;
  hbsagDate: string;
  antihcvDate: string;
  hivDate: string;
  rprDate: string;
  /** C 肝已治癒（治癒後 Anti-HCV 仍陽性）：'Y' | ''；標籤 C肝治癒 由此衍生 */
  antihcvCured: 'Y' | '';
  antihcvCuredDate: string;
}

export const CURED_TAG = 'C肝治癒';
/** 其他隔離疾病（diseases 自由標籤，非四態）：COVID／疥瘡／多重抗藥菌／其他（存 `其他:文字`） */
export const ISOLATION_OPTIONS = ['COVID', '疥瘡', '多重抗藥菌'];
export const ISOLATION_OTHER_PREFIX = '其他:';
const ISOLATION_ABBR: Record<string, string> = { COVID: '冠', 疥瘡: '疥', 多重抗藥菌: 'MDR', 隔離: '隔' };
export const isIsolationTag = (t: string): boolean => !!ISOLATION_ABBR[t] || t.startsWith(ISOLATION_OTHER_PREFIX);
/** 清單顯示用：其他:xxx → xxx */
export const displayDiseaseTag = (t: string): string => (t.startsWith(ISOLATION_OTHER_PREFIX) ? t.slice(ISOLATION_OTHER_PREFIX.length) : t);

export const INFECTION_KEYS: InfectionKey[] = ['hbsag', 'antihcv', 'hiv', 'rpr'];
export const INFECTION_META: Record<InfectionKey, { tag: string; abbr: string; label: string; short: string }> = {
  hbsag: { tag: 'HBV', abbr: 'B', label: 'HBsAg（B 肝）', short: 'B肝' },
  antihcv: { tag: 'HCV', abbr: 'C', label: 'Anti-HCV（C 肝）', short: 'C肝' },
  hiv: { tag: 'HIV', abbr: 'H', label: 'HIV', short: 'HIV' },
  rpr: { tag: 'RPR', abbr: 'R', label: 'RPR（梅毒）', short: 'RPR' },
};
export const PENDING_SUFFIX = '待追蹤';
export const dateKeyOf = (key: InfectionKey): InfectionDateKey => `${key}Date` as InfectionDateKey;
export const pendingTagOf = (key: InfectionKey): string => `${INFECTION_META[key].tag}${PENDING_SUFFIX}`;
/** 所有由四態衍生的標籤（含舊 BC肝?） */
export const INFECTION_MANAGED_TAGS: string[] = [
  ...INFECTION_KEYS.map((k) => INFECTION_META[k].tag),
  ...INFECTION_KEYS.map(pendingTagOf),
  'BC肝?',
  CURED_TAG,
];
export const isPendingTag = (tag: string): boolean => tag.endsWith(PENDING_SUFFIX) || tag === 'BC肝?';

export const HEPATITIS_OPTIONS: { value: HepatitisValue; label: string }[] = [
  { value: 'Y', label: '陽性(+)' },
  { value: 'N', label: '陰性(-)' },
  { value: 'O', label: '未做' },
  { value: 'F', label: '待追蹤' },
];

export function hepatitisLabel(v: unknown): string {
  return HEPATITIS_OPTIONS.find((o) => o.value === v)?.label || '未填';
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const normValue = (v: unknown): HepatitisValue => {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : '';
  return (['Y', 'N', 'O', 'F'] as const).includes(s as 'Y') ? (s as HepatitisValue) : '';
};
const normDate = (v: unknown): string => (typeof v === 'string' && DATE_RE.test(v.trim()) ? v.trim() : '');

export function normalizeHepatitisStatus(input: unknown): HepatitisStatus {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const key of INFECTION_KEYS) {
    const value = normValue(src[key]);
    out[key] = value;
    out[dateKeyOf(key)] =
      value && value !== 'O' ? normDate(src[dateKeyOf(key)]) || normDate(src[`${key}FollowDate`]) : '';
  }
  const cured = src['antihcvCured'] === 'Y' || src['antihcvCured'] === true;
  out['antihcvCured'] = cured ? 'Y' : '';
  out['antihcvCuredDate'] = cured ? normDate(src['antihcvCuredDate']) : '';
  return out as unknown as HepatitisStatus;
}

/** 由 diseases 標籤推導四態（沒標籤＝陰性、待追蹤標籤/舊 BC肝?＝F）；日期一律空 */
export function deriveHepatitisFromTags(diseases: unknown): HepatitisStatus {
  const tags = Array.isArray(diseases) ? diseases.map(String) : [];
  const legacyPending = tags.includes('BC肝?');
  const out: Record<string, string> = {};
  for (const key of INFECTION_KEYS) {
    const meta = INFECTION_META[key];
    const positive = tags.includes(meta.tag) || (key === 'antihcv' && tags.includes(CURED_TAG));
    const pending = tags.includes(pendingTagOf(key)) || (legacyPending && (key === 'hbsag' || key === 'antihcv'));
    out[key] = positive ? 'Y' : pending ? 'F' : 'N';
    out[dateKeyOf(key)] = '';
  }
  out['antihcvCured'] = tags.includes(CURED_TAG) ? 'Y' : '';
  out['antihcvCuredDate'] = '';
  return out as unknown as HepatitisStatus;
}

/** 既有四態缺項（舊格式）時由標籤補齊，其餘原樣（含 C 肝治癒：舊資料無鍵才由標籤補） */
export function upgradeHepatitisStatus(status: unknown, diseases: unknown): HepatitisStatus {
  const raw = (status && typeof status === 'object' ? status : {}) as Record<string, unknown>;
  const s = normalizeHepatitisStatus(raw);
  const derived = deriveHepatitisFromTags(diseases);
  for (const key of INFECTION_KEYS) if (!s[key]) s[key] = derived[key];
  if (raw['antihcvCured'] === undefined && derived.antihcvCured) s.antihcvCured = 'Y';
  return s;
}

/** 依四態同步標籤：Y→HBV/HCV/HIV/RPR；F→「X待追蹤」；N/O 無；其他標籤（C肝治癒/COVID/隔離）原樣保留 */
export function syncTagsFromHepatitis(diseases: unknown, status: HepatitisStatus): string[] {
  const base = (Array.isArray(diseases) ? diseases.map(String) : []).filter((t) => !INFECTION_MANAGED_TAGS.includes(t));
  for (const key of INFECTION_KEYS) {
    if (status[key] === 'Y') base.push(INFECTION_META[key].tag);
    else if (status[key] === 'F') base.push(pendingTagOf(key));
  }
  if (status.antihcvCured === 'Y') base.push(CURED_TAG);
  return base;
}

/** 其他隔離疾病縮寫：COVID→冠、疥瘡→疥、多重抗藥菌→MDR、其他:xxx／舊 隔離→隔 */
export function isolationAbbrFromTags(diseases: unknown): string[] {
  const tags = Array.isArray(diseases) ? diseases.map(String) : [];
  const out: string[] = [];
  for (const t of tags) {
    if (ISOLATION_ABBR[t]) out.push(ISOLATION_ABBR[t]);
    else if (t.startsWith(ISOLATION_OTHER_PREFIX)) out.push('隔');
  }
  return Array.from(new Set(out));
}

/** 排程備註縮寫：B/C/H/R、待追蹤 B?/C?/H?/R?（舊 BC肝? → BC?） */
export function infectionAbbrFromTags(diseases: unknown): string[] {
  const tags = Array.isArray(diseases) ? diseases.map(String) : [];
  const out: string[] = [];
  for (const key of INFECTION_KEYS) {
    const meta = INFECTION_META[key];
    if (tags.includes(meta.tag)) out.push(meta.abbr);
    else if (tags.includes(pendingTagOf(key))) out.push(`${meta.abbr}?`);
  }
  if (tags.includes('BC肝?')) out.push('BC?');
  return out;
}
