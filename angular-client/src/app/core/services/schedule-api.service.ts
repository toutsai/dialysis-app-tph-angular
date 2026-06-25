// src/app/core/services/schedule-api.service.ts
// 排程相關 API 服務 (合併 scheduleService + baseScheduleService)

import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';
import { generateAutoNote } from '../../../utils/scheduleUtils';
import { formatDateToYYYYMMDD, addMonths } from '../../../utils/dateUtils';

// ---------------------------------------------------------------------------
// 型別定義
// ---------------------------------------------------------------------------

export interface ScheduleDocData {
  id: string;
  date: string;
  schedule: Record<string, ScheduleSlotData>;
  version?: string;
  createdAt?: string;
  updatedAt?: string;
  lastModifiedBy?: string;
  [key: string]: unknown;
}

export interface ScheduleSlotData {
  shiftId?: string;
  patientId?: string | null;
  autoNote?: string;
  manualNote?: string;
  nurseTeam?: string | null;
  nurseTeamIn?: string | null;
  nurseTeamOut?: string | null;
  wardNumber?: string | null;
  freq?: string;
  [key: string]: unknown;
}

export interface ClearScheduleResult {
  success: boolean;
  message: string;
  affectedDates: number;
  failedDates?: number;
  processedDocuments: number;
  details?: {
    totalSlotsRemoved: number;
    successfulUpdates: number;
    failedUpdates: number;
  };
}

export interface CleanTemporaryDataResult {
  success: boolean;
  message: string;
  affectedDates: number;
  failedDates?: number;
  processedDocuments: number;
}

export interface CleanTemporaryDataOptions {
  cleanFields?: string[];
}

// ---------------------------------------------------------------------------
// 快取
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// 常數
// ---------------------------------------------------------------------------

const CACHE_TTL = 2 * 60 * 1000; // 2 minutes
const QUERY_LIMITS = {
  FUTURE_SCHEDULES: 100,
  MAX_DATE_RANGE_MONTHS: 6,
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable({ providedIn: 'root' })
export class ScheduleApiService {
  private readonly api = inject(ApiService);
  private readonly cache = new Map<string, CacheEntry<unknown>>();

  // -----------------------------------------------------------------------
  // 快取輔助
  // -----------------------------------------------------------------------

  private getCached<T>(key: string): T | null {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;
    if (Date.now() - entry.timestamp > CACHE_TTL) {
      this.cache.delete(key);
      return null;
    }
    return entry.data;
  }

  private setCache<T>(key: string, data: T): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  private invalidateCache(pattern: string): void {
    for (const k of this.cache.keys()) {
      if (k.includes(pattern)) this.cache.delete(k);
    }
  }

  // -----------------------------------------------------------------------
  // 日期範圍輔助
  // -----------------------------------------------------------------------

  private createDateRange(startDate: Date | string, maxMonths: number = QUERY_LIMITS.MAX_DATE_RANGE_MONTHS): { startStr: string; endStr: string } {
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = addMonths(start, maxMonths);
    return {
      startStr: formatDateToYYYYMMDD(start),
      endStr: formatDateToYYYYMMDD(end),
    };
  }

  // -----------------------------------------------------------------------
  // Observable 方法
  // -----------------------------------------------------------------------

  /** 取得排程文件 (Observable) */
  fetchScheduleDocuments$(startDate: string, endDate: string): Observable<ScheduleDocData[]> {
    return this.api.get<ScheduleDocData[] | { data: ScheduleDocData[] }>(
      `/schedules?startDate=${startDate}&endDate=${endDate}&limit=${QUERY_LIMITS.FUTURE_SCHEDULES}`,
    ).pipe(
      map((response) => {
        if (Array.isArray(response)) return response;
        return (response as { data?: ScheduleDocData[] })?.data || [];
      }),
    );
  }

  /** 更新排程 (Observable) */
  patchSchedule$(scheduleId: string, data: Record<string, unknown>): Observable<unknown> {
    return this.api.patch(`/schedules/${scheduleId}`, data);
  }

  // -----------------------------------------------------------------------
  // Promise 方法 (向後相容)
  // -----------------------------------------------------------------------

  /** 取得排程文件 (Promise) */
  async fetchScheduleDocuments(startDate: string, endDate: string): Promise<ScheduleDocData[]> {
    return firstValueFrom(this.fetchScheduleDocuments$(startDate, endDate));
  }

  /** 取得帶快取的未來排程 */
  private async getFutureSchedulesCached(startDate: string, endDate: string): Promise<ScheduleDocData[]> {
    const cacheKey = `future-schedules-${startDate}-${endDate}`;
    const cached = this.getCached<ScheduleDocData[]>(cacheKey);
    if (cached) return cached;

    console.log(`📅 Fetching schedules from ${startDate} to ${endDate}`);
    const schedules = await this.fetchScheduleDocuments(startDate, endDate);
    console.log(`📊 Found ${schedules.length} schedule documents`);
    this.setCache(cacheKey, schedules);
    return schedules;
  }

  /**
   * 徹底刪除指定病人從某個日期（含）開始的所有未來排程
   */
  async clearFutureSchedulesForPatient(
    patientId: string,
    startDate: Date | string = new Date(),
  ): Promise<ClearScheduleResult> {
    if (!patientId) throw new Error('病人ID為必填');

    const { startStr, endStr } = this.createDateRange(startDate);

    console.log(`🗑️ [clearFutureSchedules] 開始清除病人 ${patientId} 從 ${startStr} 的排程`);

    const futureScheduleDocs = await this.getFutureSchedulesCached(startStr, endStr);

    if (futureScheduleDocs.length === 0) {
      return { success: true, message: '沒有需要清除的排程', affectedDates: 0, processedDocuments: 0 };
    }

    const documentsToUpdate: { docData: ScheduleDocData; slotsToRemove: string[]; newScheduleMap: Record<string, ScheduleSlotData> }[] = [];
    let totalSlotsToRemove = 0;

    for (const docData of futureScheduleDocs) {
      const scheduleMap = docData.schedule || {};
      const slotsToRemove: string[] = [];

      for (const [slotId, slot] of Object.entries(scheduleMap)) {
        if (slot?.patientId === patientId) slotsToRemove.push(slotId);
      }

      if (slotsToRemove.length > 0) {
        documentsToUpdate.push({ docData, slotsToRemove, newScheduleMap: { ...scheduleMap } });
        totalSlotsToRemove += slotsToRemove.length;
      }
    }

    if (documentsToUpdate.length === 0) {
      return { success: true, message: `病人 ${patientId} 沒有未來排程需要清除`, affectedDates: 0, processedDocuments: 0 };
    }

    let successCount = 0;
    let failureCount = 0;

    for (const { docData, slotsToRemove, newScheduleMap } of documentsToUpdate) {
      for (const slotId of slotsToRemove) {
        delete newScheduleMap[slotId];
      }

      try {
        await firstValueFrom(this.patchSchedule$(docData.id, {
          schedule: newScheduleMap,
          updatedAt: new Date().toISOString(),
          lastModifiedBy: 'clearFutureSchedules',
        }));
        successCount++;
      } catch (error) {
        failureCount++;
        console.error(`❌ 更新 ${docData.date} 失敗:`, error);
      }
    }

    this.invalidateCache('future-schedules');
    this.invalidateCache(`patient-schedules-${patientId}`);

    return {
      success: successCount > 0,
      message: `成功清除 ${successCount} 個日期的排程${failureCount > 0 ? `，${failureCount} 個失敗` : ''}`,
      affectedDates: successCount,
      failedDates: failureCount,
      processedDocuments: documentsToUpdate.length,
      details: { totalSlotsRemoved: totalSlotsToRemove, successfulUpdates: successCount, failedUpdates: failureCount },
    };
  }

  /**
   * 清理未來排程中的臨時數據（保留排程）
   */
  async cleanTemporaryDataInFutureSchedules(
    patientId: string,
    updatedPatientData: Record<string, unknown>,
    startDate: Date | string = new Date(),
    options: CleanTemporaryDataOptions = {},
  ): Promise<CleanTemporaryDataResult> {
    if (!patientId) throw new Error('病人ID為必填');
    const { cleanFields = ['manualNote', 'nurseTeam', 'nurseTeamIn', 'nurseTeamOut'] } = options;

    const { startStr, endStr } = this.createDateRange(startDate, 3);
    const futureScheduleDocs = await this.getFutureSchedulesCached(startStr, endStr);

    if (futureScheduleDocs.length === 0) {
      return { success: true, message: '沒有找到需要清理的排程資料', affectedDates: 0, processedDocuments: 0 };
    }

    let successCount = 0;
    let failureCount = 0;

    for (const docData of futureScheduleDocs) {
      const scheduleMap: Record<string, ScheduleSlotData> = { ...(docData.schedule || {}) };
      let hasChanges = false;

      for (const [, slot] of Object.entries(scheduleMap)) {
        if (slot?.patientId !== patientId) continue;

        for (const field of cleanFields) {
          const value = slot[field];
          if (value !== undefined && value !== null && value !== '') {
            (slot as Record<string, unknown>)[field] = field.includes('Team') ? null : '';
            hasChanges = true;
          }
        }

        const newAutoNote = generateAutoNote(updatedPatientData as Record<string, unknown>);
        if (slot.autoNote !== newAutoNote) {
          slot.autoNote = newAutoNote;
          hasChanges = true;
        }
      }

      if (hasChanges) {
        try {
          await firstValueFrom(this.patchSchedule$(docData.id, {
            schedule: scheduleMap,
            updatedAt: new Date().toISOString(),
            lastModifiedBy: 'cleanTemporaryData',
          }));
          successCount++;
        } catch (error) {
          failureCount++;
          console.error(`❌ 清理 ${docData.date} 失敗:`, error);
        }
      }
    }

    this.invalidateCache('future-schedules');

    return {
      success: successCount > 0 || (successCount === 0 && failureCount === 0),
      message: successCount === 0 && failureCount === 0
        ? '沒有需要清理的臨時資料'
        : `成功清理 ${successCount} 個日期的臨時資料${failureCount > 0 ? `，${failureCount} 個失敗` : ''}`,
      affectedDates: successCount,
      failedDates: failureCount,
      processedDocuments: successCount + failureCount,
    };
  }

  /**
   * 獲取病人的排程資料
   */
  async getPatientSchedules(
    patientId: string,
    startDate: string,
    endDate: string,
  ): Promise<ScheduleDocData[]> {
    if (!patientId) throw new Error('病人ID為必填');

    const cacheKey = `patient-schedules-${patientId}-${startDate}-${endDate}`;
    const cached = this.getCached<ScheduleDocData[]>(cacheKey);
    if (cached) return cached;

    const schedules = await this.fetchScheduleDocuments(startDate, endDate);
    const result = schedules.filter((schedule) => {
      const scheduleMap = schedule.schedule || {};
      return Object.values(scheduleMap).some((slot) => slot?.patientId === patientId);
    });

    this.setCache(cacheKey, result);
    return result;
  }

  // -----------------------------------------------------------------------
  // 快取管理
  // -----------------------------------------------------------------------

  clearPatientCache(patientId: string): void {
    this.invalidateCache(`patient-schedules-${patientId}`);
  }

  clearAllScheduleCache(): void {
    this.cache.clear();
  }

  getCacheStats(): { totalItems: number } {
    return { totalItems: this.cache.size };
  }

  // -----------------------------------------------------------------------
  // 基礎排班 (原 baseScheduleService)
  // -----------------------------------------------------------------------

  /** 從總床位表中移除指定病人的所有規則 (Observable) */
  removePatientFromBaseSchedule$(patientId: string): Observable<boolean> {
    return new Observable<boolean>((subscriber) => {
      this.removePatientFromBaseSchedule(patientId)
        .then((result) => { subscriber.next(result); subscriber.complete(); })
        .catch((err) => subscriber.error(err));
    });
  }

  /** 從總床位表中移除指定病人的所有規則 */
  async removePatientFromBaseSchedule(patientId: string): Promise<boolean> {
    console.log(`🗑️ [BaseScheduleService] 開始從總床位表移除病人: ${patientId}`);

    try {
      const masterDoc = await firstValueFrom(
        this.api.get<ScheduleDocData>('/schedules/base/MASTER_SCHEDULE'),
      );
      if (masterDoc) {
        const schedule = { ...(masterDoc.schedule || {}) };
        delete schedule[patientId];
        await firstValueFrom(this.api.patch('/schedules/base/MASTER_SCHEDULE', {
          schedule,
          updatedAt: new Date().toISOString(),
          lastModifiedBy: 'system_remove_rule',
        }));
      }

      console.log(`✅ [BaseScheduleService] 已移除病人 ${patientId} 的規則。`);
      return true;
    } catch (error) {
      console.error(`❌ [BaseScheduleService] 移除病人 ${patientId} 規則失敗:`, error);
      throw new Error(`移除病人規則失敗: ${(error as Error).message}`);
    }
  }

  /** 更新總床位表中指定病人的頻率 */
  async updatePatientFreqInBaseSchedule(
    patientId: string,
    newFreq: string,
    patientData: Record<string, unknown>,
  ): Promise<void> {
    console.log(`🔄 [BaseScheduleService] 開始更新病人頻率: ${patientId} → ${newFreq}`);

    try {
      const masterDoc = await firstValueFrom(
        this.api.get<ScheduleDocData>('/schedules/base/MASTER_SCHEDULE'),
      );
      if (!masterDoc || !masterDoc.schedule?.[patientId]) {
        console.log(`ℹ️ [BaseScheduleService] 病人 ${patientId} 在總表中沒有規則，無需更新頻率。`);
        return;
      }

      const schedule: Record<string, unknown> = { ...masterDoc.schedule };
      schedule[patientId] = {
        ...(schedule[patientId] as Record<string, unknown>),
        freq: newFreq,
        autoNote: generateAutoNote(patientData as Record<string, unknown>),
      };

      await firstValueFrom(this.api.patch('/schedules/base/MASTER_SCHEDULE', {
        schedule,
        updatedAt: new Date().toISOString(),
        lastModifiedBy: 'system_freq_update',
      }));

      console.log(`✅ [BaseScheduleService] 成功更新病人 ${patientId} 的頻率為 ${newFreq}`);
    } catch (error) {
      console.error(`❌ [BaseScheduleService] 更新病人 ${patientId} 頻率失敗:`, error);
      throw new Error(`更新病人頻率失敗: ${(error as Error).message}`);
    }
  }

  /** 檢查總床位表中是否存在指定病人的規則 */
  async hasPatientInBaseSchedule(patientId: string): Promise<boolean> {
    try {
      const masterDoc = await firstValueFrom(
        this.api.get<ScheduleDocData>('/schedules/base/MASTER_SCHEDULE'),
      );
      if (!masterDoc || !masterDoc.schedule?.[patientId]) {
        return false;
      }
      return true;
    } catch (error) {
      console.error(`❌ [BaseScheduleService] 檢查病人 ${patientId} 規則失敗:`, error);
      return false;
    }
  }
}
