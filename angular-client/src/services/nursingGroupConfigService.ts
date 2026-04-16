// src/services/nursingGroupConfigService.ts
// Backward-compatible bridge file (Phase 5 migration)
// Re-exports functions that components still import from '@/services/nursingGroupConfigService'
import { localApi } from '@/services/localApiClient';

const ROUTE = '/nursing/group-config';

const DAY_SHIFT_LETTERS = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];
const NIGHT_SHIFT_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

export const generateDayShiftGroups = (count: number): string[] => {
  const validCount = Math.min(Math.max(count || 0, 0), DAY_SHIFT_LETTERS.length);
  return DAY_SHIFT_LETTERS.slice(0, validCount);
};

export const generateNightShiftGroups = (count: number): string[] => {
  const validCount = Math.min(Math.max(count || 0, 0), NIGHT_SHIFT_LETTERS.length);
  return NIGHT_SHIFT_LETTERS.slice(0, validCount);
};

export const calculate74Groups = (dayShiftGroups: string[], shift75Groups: string[]): string[] => {
  const shift75Set = new Set(shift75Groups || []);
  return (dayShiftGroups || []).filter((g) => !shift75Set.has(g));
};

export const MAX_DAY_SHIFT_GROUPS = DAY_SHIFT_LETTERS.length;
export const MAX_NIGHT_SHIFT_GROUPS = NIGHT_SHIFT_LETTERS.length;

export const getDefaultConfig = (): any => ({
  fixedAssignments: {
    '74/L': 'A',
    '816': '外圍',
    '311C': 'C',
  },
  hospitalGroups: {
    dayShift: ['H', 'I'],
    nightShift: ['G', 'H'],
  },
  groupCounts: {
    '135': { dayShiftCount: 8, nightShiftCount: 9 },
    '246': { dayShiftCount: 9, nightShiftCount: 8 },
  },
  dayShiftRules: {
    '135': { shift75Groups: ['F'] },
    '246': { shift75Groups: ['F', 'J'] },
  },
  cannotBeNightLeader: [],
  nightShiftRestrictions: {},
  excludedNurses: [],
  lastModified: { date: null, userId: null, userName: null },
});

function getPreviousMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split('-').map(Number);
  if (month === 1) return `${year - 1}-12`;
  return `${year}-${String(month - 1).padStart(2, '0')}`;
}

export async function fetchNursingGroupConfig(yearMonth: string): Promise<{ config: any; sourceMonth: string | null }> {
  try {
    if (yearMonth) {
      const data = await localApi.get(`${ROUTE}/${yearMonth}`);
      if (data) {
        return { config: data, sourceMonth: yearMonth };
      }
    }

    if (yearMonth) {
      let searchMonth = getPreviousMonth(yearMonth);
      for (let i = 0; i < 12; i++) {
        const data = await localApi.get(`${ROUTE}/${searchMonth}`);
        if (data) {
          return { config: data, sourceMonth: searchMonth };
        }
        searchMonth = getPreviousMonth(searchMonth);
      }
    }

    const defaultData = await localApi.get(`${ROUTE}/default`);
    if (defaultData) {
      return { config: defaultData, sourceMonth: 'default' };
    }

    return { config: getDefaultConfig(), sourceMonth: null };
  } catch (error) {
    console.error('Failed to fetch nursing group config:', error);
    throw new Error('無法從資料庫獲取護理組別配置。');
  }
}

export async function saveNursingGroupConfig(config: any, yearMonth: string, currentUser?: any): Promise<void> {
  if (!yearMonth) throw new Error('儲存配置時必須指定月份');

  try {
    const dataToSave = {
      ...config,
      yearMonth,
      lastModified: {
        date: new Date().toISOString(),
        userId: currentUser?.uid || null,
        userName: currentUser?.displayName || currentUser?.name || '未知',
      },
    };

    await localApi.put(`${ROUTE}/${yearMonth}`, dataToSave);
  } catch (error) {
    console.error('Failed to save nursing group config:', error);
    throw new Error('儲存護理組別配置到資料庫時發生錯誤。');
  }
}

export function validateConfig(config: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const groupCounts = config.groupCounts || {};
  const dayRules = config.dayShiftRules || {};

  const counts135 = groupCounts['135'] || {};
  const dayCount135 = counts135.dayShiftCount || 0;
  const nightCount135 = counts135.nightShiftCount || 0;
  const dayGroups135 = generateDayShiftGroups(dayCount135);
  const shift75Groups135 = dayRules['135']?.shift75Groups || [];

  if (dayCount135 < 1) errors.push('一三五早班至少需要1組');
  if (nightCount135 < 1) errors.push('一三五晚班至少需要1組');
  if (shift75Groups135.length === 0) errors.push('一三五 75班至少需要選擇一個組別');
  const invalid75_135 = shift75Groups135.filter((g: string) => !dayGroups135.includes(g));
  if (invalid75_135.length > 0) {
    errors.push(`一三五 75班組別 ${invalid75_135.join(', ')} 超出早班可用範圍 (${dayGroups135.join(', ')})`);
  }

  const counts246 = groupCounts['246'] || {};
  const dayCount246 = counts246.dayShiftCount || 0;
  const nightCount246 = counts246.nightShiftCount || 0;
  const dayGroups246 = generateDayShiftGroups(dayCount246);
  const shift75Groups246 = dayRules['246']?.shift75Groups || [];

  if (dayCount246 < 1) errors.push('二四六早班至少需要1組');
  if (nightCount246 < 1) errors.push('二四六晚班至少需要1組');
  if (shift75Groups246.length === 0) errors.push('二四六 75班至少需要選擇一個組別');
  const invalid75_246 = shift75Groups246.filter((g: string) => !dayGroups246.includes(g));
  if (invalid75_246.length > 0) {
    errors.push(`二四六 75班組別 ${invalid75_246.join(', ')} 超出早班可用範圍 (${dayGroups246.join(', ')})`);
  }

  return { valid: errors.length === 0, errors };
}
