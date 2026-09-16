// src/app/core/services/medication-store.service.ts
// Standalone 版：已移除 Firebase，改用 REST API
import { Injectable, inject, signal } from '@angular/core';
import { ApiConfigService } from './api-config.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InjectionRecord {
  id: string;
  patientId: string;
  patientName?: string;
  orderCode?: string;
  orderName?: string;
  dose?: string;
  unit?: string;
  note?: string;
  frequency?: string;
  orderType?: string;
  changeDate?: string;
  uploadMonth?: string;
  [key: string]: unknown;
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_ENTRIES = 100;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable({ providedIn: 'root' })
export class MedicationStoreService {
  private readonly firebaseService = inject(ApiConfigService);

  readonly isLoading = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  // Cache keyed by "date|sortedPatientIds"
  private readonly cache = new Map<string, CacheEntry<InjectionRecord[]>>();
  private readonly inFlight = new Map<string, Promise<InjectionRecord[]>>();
  private cacheGeneration = 0;

  /**
   * Fetch daily injection records for a set of patients.
   * 過濾 / 頻率判讀（QW / MMDD / Q2W+日期）由後端 dailyInjectionService 處理,
   * 前端僅做快取與顯示。
   */
  async fetchDailyInjections(
    date: string,
    patientIds: string[],
  ): Promise<InjectionRecord[]> {
    if (!date || !patientIds || patientIds.length === 0) {
      return [];
    }

    const cacheKey = this.buildCacheKey(date, patientIds);
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;
    const existing = this.inFlight.get(cacheKey);
    if (existing) return existing;

    const generation = this.cacheGeneration;
    const pending = this.loadDailyInjections(date, patientIds, cacheKey, generation).finally(() => {
      if (this.inFlight.get(cacheKey) === pending) {
        this.inFlight.delete(cacheKey);
        this.isLoading.set(this.inFlight.size > 0);
      }
    });
    this.inFlight.set(cacheKey, pending);
    return pending;
  }

  private async loadDailyInjections(
    date: string,
    patientIds: string[],
    cacheKey: string,
    generation: number,
  ): Promise<InjectionRecord[]> {
    try {
      this.isLoading.set(true);
      this.error.set(null);

      const res = await fetch(`${this.firebaseService.apiBaseUrl}/medications/daily-injections`, {
        method: 'POST',
        headers: this.firebaseService.getHeaders(),
        body: JSON.stringify({ targetDate: date, patientIds }),
      });

      if (!res.ok) {
        throw new Error('Failed to fetch daily injections');
      }

      const backendData = await res.json();
      const backendRecords = (Array.isArray(backendData) ? backendData : (backendData.data || [])) as InjectionRecord[];
      if (generation === this.cacheGeneration) this.setCache(cacheKey, backendRecords);
      return backendRecords;
    } catch (error) {
      if (generation !== this.cacheGeneration) return [];
      const message =
        error instanceof Error ? error.message : 'Failed to fetch injections';
      this.error.set(message);
      console.error('[MedicationStoreService] fetchDailyInjections error:', error);
      throw error;
    }
  }

  clearCache(): void {
    ++this.cacheGeneration;
    this.cache.clear();
    this.inFlight.clear();
    this.isLoading.set(false);
    this.error.set(null);
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private buildCacheKey(date: string, patientIds: string[]): string {
    const sorted = [...new Set(patientIds)].sort();
    return `${date}|${sorted.join(',')}`;
  }

  private getFromCache(key: string): InjectionRecord[] | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (this.isExpired(entry)) {
      this.cache.delete(key);
      return null;
    }
    return entry.data;
  }

  private setCache(key: string, data: InjectionRecord[]): void {
    // Evict expired entries even when their keys are never requested again.
    for (const [cachedKey, entry] of this.cache) {
      if (this.isExpired(entry)) this.cache.delete(cachedKey);
    }
    this.cache.delete(key);
    this.cache.set(key, { data, timestamp: Date.now() });
    while (this.cache.size > MAX_CACHE_ENTRIES) {
      this.cache.delete(this.cache.keys().next().value!);
    }
  }

  private isExpired(entry: CacheEntry<unknown>): boolean {
    return Date.now() - entry.timestamp > CACHE_TTL;
  }
}
