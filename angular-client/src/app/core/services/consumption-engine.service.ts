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
  unknownCategories?: string[];
  warnings?: string[];
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
    if (!this.patientStore.hasFetched() || this.patientStore.error()) {
      throw new Error(this.patientStore.error() || '病人資料尚未載入，無法推估耗用');
    }
    const patientMap = this.patientStore.patientMap();
    const unknownCategories = new Set<string>();
    const warnings = new Set<string>();
    const unknown = (category: string, message: string) => {
      unknownCategories.add(category);
      warnings.add(message);
    };

    // 2. Load bed inventory settings via REST API
    const bedSettingsMap = new Map<string, { machineType: string; defaultBicarbonate: string }>();
    try {
      const bedRes = await fetch(`${this.firebaseService.apiBaseUrl}/orders/bed-settings`, {
        headers: this.firebaseService.getHeaders(),
      });
      if (!bedRes.ok) throw new Error('床位耗材設定讀取失敗');
      const bedData = await bedRes.json();
      const items = Array.isArray(bedData) ? bedData : bedData?.data;
      if (!Array.isArray(items)) throw new Error('床位耗材設定格式不正確');
      for (const item of items) {
        if (!item || typeof item !== 'object' || !(item.id || item.bedId)) throw new Error('床位耗材設定格式不正確');
        bedSettingsMap.set(String(item.id || item.bedId), {
          machineType: item.machineType || '',
          defaultBicarbonate: typeof item.defaultBicarbonate === 'string' ? item.defaultBicarbonate : '',
        });
      }
    } catch {
      unknown('bicarbonateType', '床位耗材設定讀取失敗，B 液耗用未知');
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
      const schedule = scheduleDoc['schedule'] as Record<string, Record<string, unknown>>;

      for (const [slotKey, slotData] of Object.entries(schedule)) {
        const patientId = slotData?.['patientId'] as string;
        if (!patientId) continue;

        totalSlots++;
        const patient = patientMap.get(patientId);
        if (!patient) {
          unknown('artificialKidney', '排程病人資料缺漏，人工腎耗用未知');
          unknown('dialysateCa', '排程病人資料缺漏，A 液耗用未知');
        }

        const orders = (patient?.dialysisOrders || {}) as Record<string, unknown>;

        // --- AK (人工腎臟) ---
        const akRaw = orders['ak'] as string;
        if (typeof akRaw === 'string' && akRaw.trim()) {
          const akTypes = akRaw.split('/').map((s) => s.trim()).filter(Boolean);
          for (const ak of akTypes) {
            grouped['artificialKidney'][ak] = (grouped['artificialKidney'][ak] || 0) + 1;
          }
        }

        else unknown('artificialKidney', '排程病人缺少人工腎設定，耗用未知');

        // --- A液 (透析藥水CA) ---
        const dialysateCa = orders['dialysateCa'] as string;
        if (typeof dialysateCa === 'string' && dialysateCa.trim()) {
          grouped['dialysateCa'][dialysateCa] = (grouped['dialysateCa'][dialysateCa] || 0) + 1;
        }

        else unknown('dialysateCa', '排程病人缺少 A 液設定，耗用未知');

        // --- B液 (from bed settings) ---
        const bedId = this.extractBedIdFromSlotKey(slotKey);
        const bedSetting = bedSettingsMap.get(bedId);
        if (bedSetting?.defaultBicarbonate?.trim()) {
          const bType = bedSetting.defaultBicarbonate;
          grouped['bicarbonateType'][bType] = (grouped['bicarbonateType'][bType] || 0) + 1;
        } else unknown('bicarbonateType', '排程床位缺少 B 液設定，耗用未知');
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

    return { period: { start: startDate, end: endDate }, items, grouped, totalSlots, unknownCategories: [...unknownCategories], warnings: [...warnings] };
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
    const params = new URLSearchParams({ start: startDate, end: endDate });
    const res = await fetch(`${this.firebaseService.apiBaseUrl}/schedules/range?${params}`, {
      headers: this.firebaseService.getHeaders(),
    });
    if (!res.ok) throw new Error('排程讀取失敗，無法推估耗用');
    const data = await res.json();
    const items = Array.isArray(data) ? data : data?.data;
    if (!Array.isArray(items)) throw new Error('排程格式不正確，無法推估耗用');
    for (const doc of items) {
      if (!doc || typeof doc !== 'object' || !doc.schedule || typeof doc.schedule !== 'object' || Array.isArray(doc.schedule)) throw new Error('排程格式不正確，無法推估耗用');
      for (const slot of Object.values(doc.schedule)) {
        if (!slot || typeof slot !== 'object' || Array.isArray(slot)) throw new Error('排程欄位格式不正確，無法推估耗用');
      }
    }
    return items;
  }

  /**
   * Generate all dates between two YYYY-MM-DD strings (inclusive).
   */
  generateDateRange(startDate: string, endDate: string): string[] {
    const dates: string[] = [];
    const current = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T00:00:00');
    while (current <= end) {
      dates.push(`${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`);
      current.setDate(current.getDate() + 1);
    }
    return dates;
  }
}
