// src/app/core/services/consumption-engine.service.ts
// Standalone 版：已移除 Firebase，改用 REST API
import { Injectable, inject } from '@angular/core';
import { ApiConfigService } from './api-config.service';
import { PatientStoreService } from './patient-store.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConsumptionItem {
  category: 'artificialKidney' | 'dialysateCa' | 'bicarbonateType';
  itemName: string;
  count: number;
}

export interface ConsumptionResult {
  period: { start: string; end: string };
  items: ConsumptionItem[];
  /** Grouped by category → itemName → count */
  grouped: Record<string, Record<string, number>>;
  /** Total number of schedule slots processed */
  totalSlots: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable({ providedIn: 'root' })
export class ConsumptionEngineService {
  private readonly firebaseService = inject(ApiConfigService);
  private readonly patientStore = inject(PatientStoreService);

  /**
   * Calculate theoretical consumption for a date range.
   */
  async calculateTheoreticalConsumption(
    startDate: string,
    endDate: string,
  ): Promise<ConsumptionResult> {
    // 1. Load patients if not yet loaded
    await this.patientStore.fetchPatientsIfNeeded();
    const patientMap = this.patientStore.patientMap();

    // 2. Load bed inventory settings via REST API
    const bedSettingsMap = new Map<string, { machineType: string; defaultBicarbonate: string }>();
    try {
      const bedRes = await fetch(`${this.firebaseService.apiBaseUrl}/orders/bed-settings`, {
        headers: this.firebaseService.getHeaders(),
      });
      if (bedRes.ok) {
        const bedData = await bedRes.json();
        const items = Array.isArray(bedData) ? bedData : (bedData.data || []);
        for (const item of items) {
          bedSettingsMap.set(item.id || item.bedId, {
            machineType: item.machineType || '',
            defaultBicarbonate: item.defaultBicarbonate || '',
          });
        }
      }
    } catch (error) {
      console.warn('[ConsumptionEngine] 無法載入 bed_inventory_settings:', error);
    }

    // 3. Fetch schedule documents in the date range via REST API
    const schedulesDocs = await this.fetchSchedulesInRange(startDate, endDate);

    // 4. Process each schedule
    const grouped: Record<string, Record<string, number>> = {
      artificialKidney: {},
      dialysateCa: {},
      bicarbonateType: {},
    };
    let totalSlots = 0;

    for (const scheduleDoc of schedulesDocs) {
      const schedule = (scheduleDoc['schedule'] as Record<string, Record<string, unknown>>) || {};

      for (const [slotKey, slotData] of Object.entries(schedule)) {
        const patientId = slotData?.['patientId'] as string;
        if (!patientId) continue;

        totalSlots++;
        const patient = patientMap.get(patientId);
        if (!patient) continue;

        const orders = (patient.dialysisOrders || {}) as Record<string, unknown>;

        // --- AK (人工腎臟) ---
        const akRaw = orders['ak'] as string;
        if (akRaw) {
          const akTypes = akRaw.split('/').map((s) => s.trim()).filter(Boolean);
          for (const ak of akTypes) {
            grouped['artificialKidney'][ak] = (grouped['artificialKidney'][ak] || 0) + 1;
          }
        }

        // --- A液 (透析藥水CA) ---
        const dialysateCa = orders['dialysateCa'] as string;
        if (dialysateCa) {
          grouped['dialysateCa'][dialysateCa] = (grouped['dialysateCa'][dialysateCa] || 0) + 1;
        }

        // --- B液 (from bed settings) ---
        const bedId = this.extractBedIdFromSlotKey(slotKey);
        const bedSetting = bedSettingsMap.get(bedId);
        if (bedSetting?.defaultBicarbonate) {
          const bType = bedSetting.defaultBicarbonate;
          grouped['bicarbonateType'][bType] = (grouped['bicarbonateType'][bType] || 0) + 1;
        }
      }
    }

    // 5. Flatten to items list
    const items: ConsumptionItem[] = [];
    for (const [category, itemMap] of Object.entries(grouped)) {
      for (const [itemName, count] of Object.entries(itemMap)) {
        items.push({
          category: category as ConsumptionItem['category'],
          itemName,
          count,
        });
      }
    }

    return { period: { start: startDate, end: endDate }, items, grouped, totalSlots };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private extractBedIdFromSlotKey(slotKey: string): string {
    const lastDash = slotKey.lastIndexOf('-');
    if (lastDash === -1) return slotKey;
    const prefix = slotKey.substring(0, lastDash);

    if (prefix.startsWith('bed-')) {
      return prefix.substring(4);
    }
    if (prefix.startsWith('peripheral-')) {
      return '外' + prefix.substring(11);
    }
    return prefix;
  }

  /**
   * Fetch all schedule documents for dates within [startDate, endDate]
   * via REST API.
   */
  private async fetchSchedulesInRange(
    startDate: string,
    endDate: string,
  ): Promise<Record<string, unknown>[]> {
    const results: Record<string, unknown>[] = [];

    try {
      const params = new URLSearchParams({ start: startDate, end: endDate });
      const res = await fetch(
        `${this.firebaseService.apiBaseUrl}/schedules/range?${params}`,
        { headers: this.firebaseService.getHeaders() },
      );

      if (res.ok) {
        const data = await res.json();
        const items = Array.isArray(data) ? data : (data.data || []);
        results.push(...items);
        console.log(`[ConsumptionEngine] 從 REST API 取得 ${items.length} 筆排程 (${startDate} ~ ${endDate})`);
      }
    } catch (error) {
      console.error('[ConsumptionEngine] 查詢排程失敗:', error);
    }

    return results;
  }

  /**
   * Generate all dates between two YYYY-MM-DD strings (inclusive).
   */
  generateDateRange(startDate: string, endDate: string): string[] {
    const dates: string[] = [];
    const current = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T00:00:00');
    while (current <= end) {
      dates.push(current.toISOString().split('T')[0]);
      current.setDate(current.getDate() + 1);
    }
    return dates;
  }
}
