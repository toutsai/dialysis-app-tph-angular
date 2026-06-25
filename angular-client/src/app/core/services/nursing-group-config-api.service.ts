// src/app/core/services/nursing-group-config-api.service.ts
// 護理組別配置 API 服務

import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';

// ---------------------------------------------------------------------------
// 型別定義
// ---------------------------------------------------------------------------

export interface GroupCountConfig {
  dayShiftCount: number;
  nightShiftCount: number;
}

export interface DayShiftRule {
  shift75Groups: string[];
}

export interface HospitalGroups {
  dayShift: string[];
  nightShift: string[];
}

export interface NursingGroupConfigData {
  id?: string;
  yearMonth?: string;
  fixedAssignments: Record<string, string>;
  hospitalGroups: HospitalGroups;
  groupCounts: Record<string, GroupCountConfig>;
  dayShiftRules: Record<string, DayShiftRule>;
  cannotBeNightLeader: string[];
  nightShiftRestrictions: Record<string, unknown>;
  excludedNurses: string[];
  lastModified: {
    date: string | null;
    userId: string | null;
    userName: string | null;
  };
  [key: string]: unknown;
}

export interface ConfigFetchResult {
  config: NursingGroupConfigData;
  sourceMonth: string | null;
}

export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
}

export interface CurrentUserRef {
  uid?: string;
  displayName?: string;
  name?: string;
}

// ---------------------------------------------------------------------------
// 常數
// ---------------------------------------------------------------------------

// 早班組別字母（B-K，A組保留給74/L）
const DAY_SHIFT_LETTERS: string[] = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];
const NIGHT_SHIFT_LETTERS: string[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

// ---------------------------------------------------------------------------
// 公開常數與工具函數
// ---------------------------------------------------------------------------

export const MAX_DAY_SHIFT_GROUPS: number = DAY_SHIFT_LETTERS.length;
export const MAX_NIGHT_SHIFT_GROUPS: number = NIGHT_SHIFT_LETTERS.length;

export function generateDayShiftGroups(count: number): string[] {
  const validCount = Math.min(Math.max(count || 0, 0), DAY_SHIFT_LETTERS.length);
  return DAY_SHIFT_LETTERS.slice(0, validCount);
}

export function generateNightShiftGroups(count: number): string[] {
  const validCount = Math.min(Math.max(count || 0, 0), NIGHT_SHIFT_LETTERS.length);
  return NIGHT_SHIFT_LETTERS.slice(0, validCount);
}

export function calculate74Groups(dayShiftGroups: string[], shift75Groups: string[]): string[] {
  const shift75Set = new Set(shift75Groups || []);
  return (dayShiftGroups || []).filter((g) => !shift75Set.has(g));
}

export function getDefaultConfig(): NursingGroupConfigData {
  return {
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
  };
}

/**
 * 驗證配置是否合法
 */
export function validateConfig(config: NursingGroupConfigData): ConfigValidationResult {
  const errors: string[] = [];
  const groupCounts = config.groupCounts || {};
  const dayRules = config.dayShiftRules || {};

  const counts135 = groupCounts['135'] || { dayShiftCount: 0, nightShiftCount: 0 };
  const dayCount135 = counts135.dayShiftCount || 0;
  const nightCount135 = counts135.nightShiftCount || 0;
  const dayGroups135 = generateDayShiftGroups(dayCount135);
  const shift75Groups135 = dayRules['135']?.shift75Groups || [];

  if (dayCount135 < 1) errors.push('一三五早班至少需要1組');
  if (nightCount135 < 1) errors.push('一三五晚班至少需要1組');
  if (shift75Groups135.length === 0) errors.push('一三五 75班至少需要選擇一個組別');
  const invalid75_135 = shift75Groups135.filter((g) => !dayGroups135.includes(g));
  if (invalid75_135.length > 0) {
    errors.push(`一三五 75班組別 ${invalid75_135.join(', ')} 超出早班可用範圍 (${dayGroups135.join(', ')})`);
  }

  const counts246 = groupCounts['246'] || { dayShiftCount: 0, nightShiftCount: 0 };
  const dayCount246 = counts246.dayShiftCount || 0;
  const nightCount246 = counts246.nightShiftCount || 0;
  const dayGroups246 = generateDayShiftGroups(dayCount246);
  const shift75Groups246 = dayRules['246']?.shift75Groups || [];

  if (dayCount246 < 1) errors.push('二四六早班至少需要1組');
  if (nightCount246 < 1) errors.push('二四六晚班至少需要1組');
  if (shift75Groups246.length === 0) errors.push('二四六 75班至少需要選擇一個組別');
  const invalid75_246 = shift75Groups246.filter((g) => !dayGroups246.includes(g));
  if (invalid75_246.length > 0) {
    errors.push(`二四六 75班組別 ${invalid75_246.join(', ')} 超出早班可用範圍 (${dayGroups246.join(', ')})`);
  }

  // Suppress unused variable warnings
  void nightCount135;
  void nightCount246;

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable({ providedIn: 'root' })
export class NursingGroupConfigApiService {
  private readonly api = inject(ApiService);
  private readonly route = '/nursing/group-config';

  // -----------------------------------------------------------------------
  // Observable 方法
  // -----------------------------------------------------------------------

  /** 獲取指定月份的配置 (Observable) */
  fetchConfig$(yearMonth: string): Observable<NursingGroupConfigData | null> {
    return this.api.get<NursingGroupConfigData>(`${this.route}/${yearMonth}`);
  }

  /** 儲存配置 (Observable) */
  saveConfig$(yearMonth: string, data: NursingGroupConfigData): Observable<unknown> {
    return this.api.put(`${this.route}/${yearMonth}`, data);
  }

  // -----------------------------------------------------------------------
  // 輔助
  // -----------------------------------------------------------------------

  private getPreviousMonth(yearMonth: string): string {
    const [year, month] = yearMonth.split('-').map(Number);
    if (month === 1) return `${year - 1}-12`;
    return `${year}-${String(month - 1).padStart(2, '0')}`;
  }

  // -----------------------------------------------------------------------
  // Promise 方法 (向後相容)
  // -----------------------------------------------------------------------

  /**
   * 從 REST API 獲取指定月份的護理組別配置
   */
  async fetchNursingGroupConfig(yearMonth?: string): Promise<ConfigFetchResult> {
    try {
      // 1. 先嘗試載入指定月份的配置
      if (yearMonth) {
        try {
          const data = await firstValueFrom(this.fetchConfig$(yearMonth));
          if (data) {
            console.log(`✅ 從 REST API 成功獲取 ${yearMonth} 的護理組別配置`);
            return { config: data, sourceMonth: yearMonth };
          }
        } catch {
          // 指定月份不存在，繼續嘗試其他
        }
      }

      // 2. 如果指定月份不存在，嘗試載入上個月的配置
      if (yearMonth) {
        let searchMonth = this.getPreviousMonth(yearMonth);
        for (let i = 0; i < 12; i++) {
          try {
            const data = await firstValueFrom(this.fetchConfig$(searchMonth));
            if (data) {
              console.log(`⚠️ ${yearMonth} 無配置，使用 ${searchMonth} 的配置`);
              return { config: data, sourceMonth: searchMonth };
            }
          } catch {
            // 繼續搜尋
          }
          searchMonth = this.getPreviousMonth(searchMonth);
        }
      }

      // 3. 嘗試載入 'default' 配置
      try {
        const defaultData = await firstValueFrom(this.fetchConfig$('default'));
        if (defaultData) {
          console.log('⚠️ 使用 default 配置');
          return { config: defaultData, sourceMonth: 'default' };
        }
      } catch {
        // default 也不存在
      }

      // 4. 都找不到，回傳預設值
      console.log('⚠️ 找不到任何護理組別配置，回傳預設值。');
      return { config: getDefaultConfig(), sourceMonth: null };
    } catch (error) {
      console.error('❌ 獲取護理組別配置失敗:', error);
      throw new Error('無法從資料庫獲取護理組別配置。');
    }
  }

  /**
   * 將護理組別配置儲存到 REST API
   */
  async saveNursingGroupConfig(
    config: NursingGroupConfigData,
    yearMonth: string,
    currentUser?: CurrentUserRef | null,
  ): Promise<void> {
    if (!yearMonth) throw new Error('儲存配置時必須指定月份');

    try {
      const dataToSave: NursingGroupConfigData = {
        ...config,
        yearMonth,
        lastModified: {
          date: new Date().toISOString(),
          userId: currentUser?.uid || null,
          userName: currentUser?.displayName || currentUser?.name || '未知',
        },
      };

      await firstValueFrom(this.saveConfig$(yearMonth, dataToSave));
      console.log(`✅ 護理組別配置已成功儲存 (${yearMonth})`);
    } catch (error) {
      console.error('❌ 儲存護理組別配置失敗:', error);
      throw new Error('儲存護理組別配置到資料庫時發生錯誤。');
    }
  }
}
