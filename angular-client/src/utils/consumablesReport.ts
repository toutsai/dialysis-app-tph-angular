// 耗材月報表（consumables_reports）查詢共用邏輯
// 後端：src/routes/orders.js GET /consumables（每筆 = 某月某病人；data 為三類耗材聚合 + ranges 各區間明細）
// 使用端：書記專用 > 庫存管理 > 病人耗材查詢（inventory.component）、每月耗材總表頁（consumables.component）

export const CONSUMABLE_CATEGORIES = ['artificialKidney', 'dialysateCa', 'bicarbonateType'] as const;
export type ConsumableCategory = (typeof CONSUMABLE_CATEGORIES)[number];

export const CONSUMABLE_CATEGORY_NAMES: Record<ConsumableCategory, string> = {
  artificialKidney: '人工腎臟',
  dialysateCa: '透析藥水CA',
  bicarbonateType: 'B液種類',
};

export const CONSUMABLE_SHIFT_MAP: Record<string, number> = { early: 0, noon: 1, late: 2 };
export const CONSUMABLE_SHIFT_INDEX_MAP: Record<number, string> = { 0: '早班', 1: '午班', 2: '晚班' };

export interface ConsumableItemCount {
  item: string;
  count: number;
}

export interface ConsumableReport {
  id: string;
  patientId: string;
  patientName?: string;
  medicalRecordNumber?: string;
  reportDate?: string;
  reportMonth?: string;
  data?: Record<string, unknown>;
  /** 已上傳的區間 key（`YYYYMMDD-YYYYMMDD`；'legacy' = 改制前、區間不明） */
  ranges?: string[];
  patientDeleted?: boolean;
  patientDeletedAt?: string | null;
  createdAt?: string;
}

export interface PatientConsumptionRow {
  patientId: string;
  patientName: string;
  medicalRecordNumber: string;
  bedNum: string;
  freq: string;
  shiftIndex?: number;
  isDeleted: boolean;
  /** YYYY-MM-DD，已刪除者才有 */
  deletedAt: string;
  statusLabel: string;
  consumableCounts: Record<string, number>;
  ranges: string[];
}

export interface ConsumptionSearchFilters {
  /** '一三五' | '二四六' | 'other' | 'all' */
  freq: string;
  /** 'early' | 'noon' | 'late' | 'all' */
  shift: string;
  /** 病歷號 / 姓名 關鍵字（可空） */
  keyword?: string;
}

export interface UploadedRangeSummary {
  key: string;
  label: string;
  categories: string[];
  /** 該區間有資料的病人數 */
  patientCount: number;
}

const REGULAR_FREQS = ['一三五', '二四六'];

/** '20260824-20260828' → '08/24～08/28'；'legacy' → '改制前資料(區間不明)' */
export function formatRangeKey(key: string): string {
  if (!key || key === 'legacy') return '改制前資料(區間不明)';
  const [start, end] = key.split('-');
  const md = (d: string) => (d && d.length === 8 ? `${d.substring(4, 6)}/${d.substring(6, 8)}` : '?');
  return `${md(start)}～${md(end)}`;
}

/** 'YYYY-MM-DD HH:mm:ss'（本地）或 ISO（含 Z，UTC）→ 本地 'YYYY-MM-DD' */
export function formatDeletedAt(value: string | null | undefined): string {
  if (!value) return '';
  const s = String(value);
  if (/T.*(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }
  }
  return s.substring(0, 10);
}

/** 三類耗材的欄位（品項）清單，依報表資料動態產生 */
export function buildDynamicHeaders(reports: ConsumableReport[]): Record<ConsumableCategory, string[]> {
  const sets: Record<ConsumableCategory, Set<string>> = {
    artificialKidney: new Set(),
    dialysateCa: new Set(),
    bicarbonateType: new Set(),
  };
  for (const report of reports) {
    const data = (report.data || {}) as Record<string, unknown>;
    for (const category of CONSUMABLE_CATEGORIES) {
      const list = data[category];
      if (Array.isArray(list)) {
        for (const it of list as ConsumableItemCount[]) {
          if (it && it.item !== undefined && it.item !== null) sets[category].add(String(it.item));
        }
      }
    }
  }
  return {
    artificialKidney: [...sets.artificialKidney].sort(),
    dialysateCa: [...sets.dialysateCa].sort(),
    bicarbonateType: [...sets.bicarbonateType].sort(),
  };
}

/** 該月已上傳的區間 × 類別摘要（顯示在查詢結果上方） */
export function summarizeUploadedRanges(reports: ConsumableReport[]): UploadedRangeSummary[] {
  const map = new Map<string, { categories: Set<string>; patients: Set<string> }>();
  for (const report of reports) {
    const ranges = ((report.data || {}) as Record<string, unknown>)['ranges'];
    if (!ranges || typeof ranges !== 'object') continue;
    for (const [key, entry] of Object.entries(ranges as Record<string, Record<string, unknown>>)) {
      if (!map.has(key)) map.set(key, { categories: new Set(), patients: new Set() });
      const bucket = map.get(key)!;
      bucket.patients.add(report.patientId);
      for (const category of CONSUMABLE_CATEGORIES) {
        const list = entry?.[category];
        if (Array.isArray(list) && list.length > 0) bucket.categories.add(CONSUMABLE_CATEGORY_NAMES[category]);
      }
    }
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, bucket]) => ({
      key,
      label: formatRangeKey(key),
      categories: [...bucket.categories],
      patientCount: bucket.patients.size,
    }));
}

/**
 * 以「該月有上傳紀錄的病人」為主體組出查詢列（含已刪除病人，標示刪除日）。
 * 頻率/班別篩選以病人目前的 scheduleRule 為準；'all' 不篩。已刪除病人（無在籍資料）只在 'all' 時顯示。
 */
export function buildPatientConsumptionRows(
  reports: ConsumableReport[],
  patientMap: Map<string, any>,
  filters: ConsumptionSearchFilters,
  flattenedHeaders: string[],
): PatientConsumptionRow[] {
  const keyword = (filters.keyword || '').trim().toLowerCase();
  const wantShiftIndex = filters.shift && filters.shift !== 'all' ? CONSUMABLE_SHIFT_MAP[filters.shift] : undefined;
  const rows: PatientConsumptionRow[] = [];

  for (const report of reports) {
    const patient = patientMap.get(report.patientId);
    const rule = patient?.scheduleRule || null;
    const isDeleted = !!report.patientDeleted || (!patient && !!report.patientDeletedAt);

    if (filters.freq && filters.freq !== 'all') {
      if (!rule) continue;
      if (filters.freq === 'other' ? REGULAR_FREQS.includes(rule.freq) : rule.freq !== filters.freq) continue;
    }
    if (wantShiftIndex !== undefined) {
      if (!rule || rule.shiftIndex !== wantShiftIndex) continue;
    }

    const patientName = patient?.name || report.patientName || '未知病人';
    const mrn = patient?.medicalRecordNumber || report.medicalRecordNumber || '';
    if (keyword) {
      const mrnNorm = String(mrn).replace(/^0+/, '').toLowerCase();
      const kwNorm = keyword.replace(/^0+/, '');
      if (!patientName.toLowerCase().includes(keyword) && !(kwNorm && mrnNorm.includes(kwNorm))) continue;
    }

    const data = (report.data || {}) as Record<string, unknown>;
    const consumableCounts: Record<string, number> = {};
    for (const category of CONSUMABLE_CATEGORIES) {
      const list = data[category];
      if (!Array.isArray(list)) continue;
      for (const it of list as ConsumableItemCount[]) {
        const key = String(it.item);
        if (flattenedHeaders.includes(key)) consumableCounts[key] = (consumableCounts[key] || 0) + (Number(it.count) || 0);
      }
    }

    const deletedAt = isDeleted ? formatDeletedAt(report.patientDeletedAt) : '';
    rows.push({
      patientId: report.patientId,
      patientName,
      medicalRecordNumber: mrn || 'N/A',
      bedNum: rule?.bedNum || (isDeleted ? '' : 'N/A'),
      freq: rule?.freq || (isDeleted ? '' : 'N/A'),
      shiftIndex: rule?.shiftIndex,
      isDeleted,
      deletedAt,
      statusLabel: isDeleted ? `已刪除${deletedAt ? ' ' + deletedAt : ''}` : '',
      consumableCounts,
      ranges: report.ranges || [],
    });
  }

  return rows.sort((a, b) => {
    if (a.isDeleted !== b.isDeleted) return a.isDeleted ? 1 : -1;
    return String(a.bedNum).localeCompare(String(b.bedNum), undefined, { numeric: true });
  });
}
