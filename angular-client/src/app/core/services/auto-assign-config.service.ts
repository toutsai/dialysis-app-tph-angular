// src/app/core/services/auto-assign-config.service.ts
// Standalone 版：已移除 Firebase，改用 REST API
import { Injectable, inject, signal } from '@angular/core';
import { ApiConfigService } from './api-config.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ShiftConfig {
  hepatitisTeam: string;
  inpatientTeams: string[];
  inpatientCapacity: Record<string, number>;
  regularTeams: string[];
}

export interface EarlyShiftConfig extends ShiftConfig {
  leaderTeam: string;
  leaderThreshold: number;
  leaderCapacity: number;
}

export interface AutoAssignConfig {
  earlyShift: EarlyShiftConfig;
  lateShift: ShiftConfig;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export function getDefaultAutoAssignConfig(): AutoAssignConfig {
  return {
    earlyShift: {
      hepatitisTeam: 'G',
      inpatientTeams: ['H', 'I', 'J'],
      inpatientCapacity: { H: 2, I: 2, J: 2 },
      leaderTeam: 'A',
      leaderThreshold: 40,
      leaderCapacity: 2,
      regularTeams: ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'],
    },
    lateShift: {
      hepatitisTeam: 'F',
      inpatientTeams: ['H'],
      inpatientCapacity: { H: 2 },
      regularTeams: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
    },
  };
}

// ---------------------------------------------------------------------------
// All possible team letters
// ---------------------------------------------------------------------------

export const ALL_TEAM_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable({ providedIn: 'root' })
export class AutoAssignConfigService {
  private readonly firebase = inject(ApiConfigService);

  readonly config = signal<AutoAssignConfig>(getDefaultAutoAssignConfig());
  readonly isLoaded = signal(false);

  async fetchConfig(): Promise<AutoAssignConfig> {
    try {
      const res = await fetch(`${this.firebase.apiBaseUrl}/system/auto-assign-config/current`, {
        headers: this.firebase.getHeaders(),
      });

      if (res.ok) {
        const data = await res.json();
        const merged = this.mergeWithDefaults(data);
        this.config.set(merged);
        this.isLoaded.set(true);
        return merged;
      }
    } catch (err) {
      console.error('[AutoAssignConfig] Failed to fetch config:', err);
    }
    const defaults = getDefaultAutoAssignConfig();
    this.config.set(defaults);
    this.isLoaded.set(true);
    return defaults;
  }

  async saveConfig(config: AutoAssignConfig): Promise<void> {
    const res = await fetch(`${this.firebase.apiBaseUrl}/system/auto-assign-config/current`, {
      method: 'PUT',
      headers: this.firebase.getHeaders(),
      body: JSON.stringify({
        ...config,
        updatedAt: new Date().toISOString(),
      }),
    });

    if (!res.ok) {
      throw new Error(`Failed to save config: HTTP ${res.status}`);
    }

    this.config.set(config);
  }

  private mergeWithDefaults(data: any): AutoAssignConfig {
    const defaults = getDefaultAutoAssignConfig();
    return {
      earlyShift: {
        hepatitisTeam: data.earlyShift?.hepatitisTeam ?? defaults.earlyShift.hepatitisTeam,
        inpatientTeams: data.earlyShift?.inpatientTeams ?? defaults.earlyShift.inpatientTeams,
        inpatientCapacity: data.earlyShift?.inpatientCapacity ?? defaults.earlyShift.inpatientCapacity,
        leaderTeam: data.earlyShift?.leaderTeam ?? defaults.earlyShift.leaderTeam,
        leaderThreshold: data.earlyShift?.leaderThreshold ?? defaults.earlyShift.leaderThreshold,
        leaderCapacity: data.earlyShift?.leaderCapacity ?? defaults.earlyShift.leaderCapacity,
        regularTeams: data.earlyShift?.regularTeams ?? defaults.earlyShift.regularTeams,
      },
      lateShift: {
        hepatitisTeam: data.lateShift?.hepatitisTeam ?? defaults.lateShift.hepatitisTeam,
        inpatientTeams: data.lateShift?.inpatientTeams ?? defaults.lateShift.inpatientTeams,
        inpatientCapacity: data.lateShift?.inpatientCapacity ?? defaults.lateShift.inpatientCapacity,
        regularTeams: data.lateShift?.regularTeams ?? defaults.lateShift.regularTeams,
      },
    };
  }
}
