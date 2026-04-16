// src/app/core/services/archive-store.service.ts
// Standalone 版：已移除 Firebase，改用 REST API
import { Injectable, inject, signal } from '@angular/core';
import { ApiConfigService } from './api-config.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScheduleSlot {
  patientId: string;
  patientName?: string;
  medicalRecordNumber?: string;
  bed?: string;
  shift?: string;
  nurseTeam?: string | null;
  nurseTeamIn?: string | null;
  nurseTeamOut?: string | null;
  manualNote?: string;
  autoNote?: string;
  [key: string]: unknown;
}

export interface ArchivedSchedule {
  id: string;
  date: string;
  schedule: Record<string, ScheduleSlot>;
  createdAt?: unknown;
  updatedAt?: unknown;
  [key: string]: unknown;
}

interface CacheEntry {
  data: ArchivedSchedule | null;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable({ providedIn: 'root' })
export class ArchiveStoreService {
  private readonly firebaseService = inject(ApiConfigService);

  // -----------------------------------------------------------------------
  // State signals
  // -----------------------------------------------------------------------
  readonly isLoading = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  // -----------------------------------------------------------------------
  // Cache (keyed by date string YYYY-MM-DD)
  // -----------------------------------------------------------------------
  private readonly cache = new Map<string, CacheEntry>();

  // -----------------------------------------------------------------------
  // Public methods
  // -----------------------------------------------------------------------

  /**
   * Fetch the schedule document for a given date.
   * Returns the cached result if available and not expired.
   */
  async fetchScheduleByDate(dateStr: string): Promise<ArchivedSchedule | null> {
    if (!dateStr) return null;

    // Check cache
    const cached = this.getFromCache(dateStr);
    if (cached !== undefined) {
      return cached;
    }

    try {
      this.isLoading.set(true);
      this.error.set(null);

      const res = await fetch(
        `${this.firebaseService.apiBaseUrl}/schedules/archived?date=${encodeURIComponent(dateStr)}`,
        { headers: this.firebaseService.getHeaders() },
      );

      if (!res.ok) {
        if (res.status === 404) {
          this.setCache(dateStr, null);
          return null;
        }
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const data = await res.json();

      // API may return { data: schedule } or directly the schedule object
      // Handle array responses (query by date may return array)
      let schedule: ArchivedSchedule | null = null;
      if (Array.isArray(data)) {
        schedule = data.length > 0 ? data[0] as ArchivedSchedule : null;
      } else if (data.data && Array.isArray(data.data)) {
        schedule = data.data.length > 0 ? data.data[0] as ArchivedSchedule : null;
      } else if (data.id) {
        schedule = data as ArchivedSchedule;
      } else if (data.data?.id) {
        schedule = data.data as ArchivedSchedule;
      }

      this.setCache(dateStr, schedule);

      if (schedule) {
        console.log(
          `[ArchiveStoreService] Fetched schedule for ${dateStr} (${
            Object.keys(schedule.schedule || {}).length
          } slots)`,
        );
      }

      return schedule;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to fetch archived schedule';
      this.error.set(message);
      console.error(
        '[ArchiveStoreService] fetchScheduleByDate error:',
        error,
      );
      throw error;
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Batch-fetch archived schedules for multiple dates.
   */
  async fetchSchedulesByDates(dateStrings: string[]): Promise<Map<string, ArchivedSchedule | null>> {
    const results = new Map<string, ArchivedSchedule | null>();
    const uncachedDates: string[] = [];

    // Check cache first for each date
    for (const dateStr of dateStrings) {
      const cached = this.getFromCache(dateStr);
      if (cached !== undefined) {
        results.set(dateStr, cached);
      } else {
        uncachedDates.push(dateStr);
      }
    }

    if (uncachedDates.length === 0) return results;

    try {
      this.isLoading.set(true);
      this.error.set(null);

      // POST batch request with array of dates
      const res = await fetch(
        `${this.firebaseService.apiBaseUrl}/schedules/archived/batch`,
        {
          method: 'POST',
          headers: this.firebaseService.getHeaders(),
          body: JSON.stringify({ dates: uncachedDates }),
        },
      );

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const data = await res.json();
      const items: ArchivedSchedule[] = Array.isArray(data) ? data : (data.data || []);

      // Map returned docs by date
      const fetchedByDate = new Map<string, ArchivedSchedule>();
      for (const schedule of items) {
        if (schedule.date) {
          fetchedByDate.set(schedule.date, schedule);
        }
      }

      // Cache all results (including nulls for dates with no data)
      for (const dateStr of uncachedDates) {
        const schedule = fetchedByDate.get(dateStr) || null;
        this.setCache(dateStr, schedule);
        results.set(dateStr, schedule);
      }

      console.log(
        `[ArchiveStoreService] Batch-fetched ${items.length} schedules for ${uncachedDates.length} dates`,
      );

      return results;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to batch-fetch archived schedules';
      this.error.set(message);
      console.error('[ArchiveStoreService] fetchSchedulesByDates error:', error);
      throw error;
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Clear all cached schedule data.
   */
  clearCache(): void {
    this.cache.clear();
    console.log('[ArchiveStoreService] Cache cleared');
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private getFromCache(key: string): ArchivedSchedule | null | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.timestamp > CACHE_TTL) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.data;
  }

  private setCache(key: string, data: ArchivedSchedule | null): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }
}
