// src/app/core/services/nurse-patient-care-api.service.ts
// 護理師固定照護病人分配 API 服務（與每日護理分組 nurse-assignment-api 無關）

import { Injectable, inject } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';

// ---------------------------------------------------------------------------
// 型別定義
// ---------------------------------------------------------------------------

export interface NurseCareAssignment {
  nurseId: string;
  nurseName: string;
  patientIds: string[];
}

export interface NursePatientCareDoc {
  assignments: NurseCareAssignment[];
  updatedAt?: string | null;
  updatedBy?: { uid?: string; name?: string } | null;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable({ providedIn: 'root' })
export class NursePatientCareApiService {
  private readonly api = inject(ApiService);
  private readonly route = '/nursing/patient-care';

  /** 取得照護分配 (Observable) */
  fetch$(): Observable<NursePatientCareDoc> {
    return this.api.get<NursePatientCareDoc>(this.route);
  }

  /** 儲存照護分配 (Observable) */
  save$(assignments: NurseCareAssignment[]): Observable<unknown> {
    return this.api.put(this.route, { assignments });
  }

  /** 取得照護分配 */
  async fetch(): Promise<NursePatientCareDoc> {
    try {
      return await firstValueFrom(this.fetch$());
    } catch (error) {
      console.error('取得照護分配失敗:', error);
      throw error;
    }
  }

  /** 儲存照護分配 */
  async save(assignments: NurseCareAssignment[]): Promise<unknown> {
    try {
      return await firstValueFrom(this.save$(assignments));
    } catch (error) {
      console.error('儲存照護分配失敗:', error);
      throw error;
    }
  }
}
