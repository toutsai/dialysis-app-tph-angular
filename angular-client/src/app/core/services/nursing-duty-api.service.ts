// src/app/core/services/nursing-duty-api.service.ts
// 護理工作職責 API 服務

import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';

// ---------------------------------------------------------------------------
// 型別定義
// ---------------------------------------------------------------------------

export interface ShiftData {
  codes: string;
  tasks: string;
}

export interface LastModifiedInfo {
  date: string;
  user: string;
}

export interface NursingDutyData {
  id?: string;
  announcement: string;
  dayShift: ShiftData;
  nightShift: unknown[];
  checklist: unknown[];
  teamwork: unknown[];
  lastModified: LastModifiedInfo;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

const DUTY_DOC_ID = 'main';

@Injectable({ providedIn: 'root' })
export class NursingDutyApiService {
  private readonly api = inject(ApiService);

  // -----------------------------------------------------------------------
  // 預設值
  // -----------------------------------------------------------------------

  private getDefaultData(): NursingDutyData {
    return {
      announcement: '請在此輸入班別規則說明...',
      dayShift: { codes: '', tasks: '' },
      nightShift: [],
      checklist: [],
      teamwork: [],
      lastModified: { date: '', user: '系統' },
    };
  }

  // -----------------------------------------------------------------------
  // Observable 方法
  // -----------------------------------------------------------------------

  /** 獲取護理工作職責 (Observable) */
  fetchDuties$(): Observable<NursingDutyData> {
    return this.api.get<NursingDutyData>('/nursing/duties');
  }

  /** 儲存護理工作職責 (Observable) */
  saveDuties$(data: NursingDutyData): Observable<unknown> {
    return this.api.put('/nursing/duties', data);
  }

  // -----------------------------------------------------------------------
  // Promise 方法 (向後相容)
  // -----------------------------------------------------------------------

  /** 獲取護理工作職責 */
  async fetchDuties(): Promise<NursingDutyData> {
    try {
      const data = await firstValueFrom(this.fetchDuties$());
      if (data) {
        console.log('✅ 從 REST API 成功獲取護理職責資料');
        return data;
      } else {
        console.log('⚠️ 找不到護理職責文件，回傳預設值。');
        return this.getDefaultData();
      }
    } catch (error) {
      console.error('❌ 獲取護理職責失敗:', error);
      throw new Error('無法從資料庫獲取護理職責資料。');
    }
  }

  /** 儲存護理工作職責 */
  async saveDuties(data: NursingDutyData): Promise<void> {
    try {
      await firstValueFrom(this.saveDuties$(data));
      console.log('✅ 護理職責資料已成功儲存');
    } catch (error) {
      console.error('❌ 儲存護理職責失敗:', error);
      throw new Error('儲存護理職責到資料庫時發生錯誤。');
    }
  }
}
