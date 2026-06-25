// src/app/core/services/nurse-assignment-api.service.ts
// 護理分組 API 服務

import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';

// ---------------------------------------------------------------------------
// 型別定義
// ---------------------------------------------------------------------------

export interface NurseTeamsData {
  id?: string;
  date: string;
  teams: Record<string, unknown>;
  names?: Record<string, unknown>;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable({ providedIn: 'root' })
export class NurseAssignmentApiService {
  private readonly api = inject(ApiService);
  private readonly route = '/schedules/nurse-assignments';

  // -----------------------------------------------------------------------
  // Observable 方法
  // -----------------------------------------------------------------------

  /** 根據日期獲取護理分組 (Observable) */
  fetchTeamsByDate$(dateStr: string): Observable<NurseTeamsData | null> {
    return this.api.get<NurseTeamsData>(`${this.route}/${dateStr}`);
  }

  /** 儲存新的護理分組 (Observable) */
  saveTeams$(data: NurseTeamsData): Observable<unknown> {
    const saveData: NurseTeamsData = {
      date: data.date,
      teams: data.teams || {},
      names: data.names || {},
    };
    return this.api.put(`${this.route}/${data.date}`, saveData);
  }

  /** 更新現有的護理分組 (Observable) */
  updateTeams$(docId: string, data: Partial<NurseTeamsData>): Observable<unknown> {
    return this.api.patch(`${this.route}/${docId}`, data);
  }

  /** 批量獲取日期範圍內的護理分組 (Observable) */
  fetchTeamsInRange$(startDate: string, endDate: string): Observable<NurseTeamsData[]> {
    return this.api.get<NurseTeamsData[] | { data: NurseTeamsData[] }>(
      `${this.route}?startDate=${startDate}&endDate=${endDate}`,
    ).pipe(
      map((response) => {
        if (Array.isArray(response)) return response;
        return (response as { data?: NurseTeamsData[] })?.data || [];
      }),
    );
  }

  /** 刪除特定日期的護理分組 (Observable) */
  deleteTeamsByDate$(dateStr: string): Observable<unknown> {
    return this.api.delete(`${this.route}/${dateStr}`);
  }

  // -----------------------------------------------------------------------
  // Promise 方法 (向後相容)
  // -----------------------------------------------------------------------

  /** 根據日期獲取護理分組 */
  async fetchTeamsByDate(dateStr: string): Promise<NurseTeamsData | null> {
    try {
      return await firstValueFrom(this.fetchTeamsByDate$(dateStr));
    } catch (error) {
      console.error('獲取護理分組失敗:', error);
      throw error;
    }
  }

  /** 儲存新的護理分組 */
  async saveTeams(data: NurseTeamsData): Promise<unknown> {
    try {
      return await firstValueFrom(this.saveTeams$(data));
    } catch (error) {
      console.error('儲存護理師分組失敗:', error);
      throw error;
    }
  }

  /** 更新現有的護理分組 */
  async updateTeams(docId: string, data: Partial<NurseTeamsData>): Promise<{ success: boolean }> {
    try {
      await firstValueFrom(this.updateTeams$(docId, data));
      return { success: true };
    } catch (error) {
      console.error('更新護理師分組失敗:', error);
      throw error;
    }
  }

  /** 批量獲取日期範圍內的護理分組 */
  async fetchTeamsInRange(startDate: string, endDate: string): Promise<NurseTeamsData[]> {
    try {
      return await firstValueFrom(this.fetchTeamsInRange$(startDate, endDate));
    } catch (error) {
      console.error('批量獲取護理分組失敗:', error);
      throw error;
    }
  }

  /** 複製某一天的護理分組到另一天 */
  async copyTeamsToDate(sourceDate: string, targetDate: string): Promise<unknown> {
    try {
      const sourceData = await this.fetchTeamsByDate(sourceDate);
      if (!sourceData) {
        throw new Error(`找不到 ${sourceDate} 的護理分組資料`);
      }

      const existingData = await this.fetchTeamsByDate(targetDate);
      if (existingData) {
        return await this.updateTeams(existingData.id || targetDate, {
          teams: sourceData.teams,
          date: targetDate,
        });
      } else {
        return await this.saveTeams({
          date: targetDate,
          teams: sourceData.teams,
        });
      }
    } catch (error) {
      console.error('複製護理分組失敗:', error);
      throw error;
    }
  }

  /** 刪除特定日期的護理分組 */
  async deleteTeamsByDate(dateStr: string): Promise<boolean> {
    try {
      await firstValueFrom(this.deleteTeamsByDate$(dateStr));
      return true;
    } catch (error) {
      console.error('刪除護理分組失敗:', error);
      throw error;
    }
  }

  /** 清空特定日期的所有護理分組（但保留記錄） */
  async clearTeamsByDate(dateStr: string): Promise<void> {
    try {
      await this.updateTeams(dateStr, {
        teams: {},
        date: dateStr,
      });
    } catch (error) {
      console.error('清空護理分組失敗:', error);
      throw error;
    }
  }
}
