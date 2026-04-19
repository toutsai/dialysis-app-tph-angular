// src/services/nurseAssignmentsService.ts
// Backward-compatible bridge file (Phase 5 migration)
// Re-exports functions that components still import from '@/services/nurseAssignmentsService'
import { localApi } from '@/services/localApiClient';

const ROUTE = '/schedules/nurse-assignments';

export async function fetchTeamsByDate(dateStr: string): Promise<any> {
  try {
    return await localApi.get(`${ROUTE}/${dateStr}`);
  } catch (error) {
    console.error('Failed to fetch nurse teams:', error);
    throw error;
  }
}

export async function saveTeams(data: { date: string; teams?: any; names?: any }): Promise<any> {
  try {
    const saveData = {
      date: data.date,
      teams: data.teams || {},
      names: data.names || {},
    };
    return await localApi.put(`${ROUTE}/${data.date}`, saveData);
  } catch (error) {
    console.error('Failed to save nurse teams:', error);
    throw error;
  }
}

export async function updateTeams(docId: string, data: any): Promise<{ success: boolean }> {
  try {
    await localApi.patch(`${ROUTE}/${docId}`, data);
    return { success: true };
  } catch (error) {
    console.error('Failed to update nurse teams:', error);
    throw error;
  }
}

export async function fetchTeamsInRange(startDate: string, endDate: string): Promise<any[]> {
  try {
    const data = await localApi.get(`${ROUTE}?startDate=${startDate}&endDate=${endDate}`);
    return Array.isArray(data) ? data : (data?.data || []);
  } catch (error) {
    console.error('Failed to fetch nurse teams in range:', error);
    throw error;
  }
}

export async function copyTeamsToDate(sourceDate: string, targetDate: string): Promise<any> {
  try {
    const sourceData = await fetchTeamsByDate(sourceDate);
    if (!sourceData) {
      throw new Error(`No nurse teams data found for ${sourceDate}`);
    }

    const existingData = await fetchTeamsByDate(targetDate);
    if (existingData) {
      return await updateTeams(existingData.id || targetDate, {
        teams: sourceData.teams,
        date: targetDate,
      });
    } else {
      return await saveTeams({
        date: targetDate,
        teams: sourceData.teams,
      });
    }
  } catch (error) {
    console.error('Failed to copy nurse teams:', error);
    throw error;
  }
}

export async function deleteTeamsByDate(dateStr: string): Promise<boolean> {
  try {
    await localApi.delete(`${ROUTE}/${dateStr}`);
    return true;
  } catch (error) {
    console.error('Failed to delete nurse teams:', error);
    throw error;
  }
}

export async function clearTeamsByDate(dateStr: string): Promise<void> {
  try {
    await updateTeams(dateStr, {
      teams: {},
      date: dateStr,
    });
  } catch (error) {
    console.error('Failed to clear nurse teams:', error);
    throw error;
  }
}

/**
 * 原子性儲存：同時更新當日 schedule 與 nurse_assignments。
 * 後端在單一 DB transaction 內完成，避免兩次獨立請求造成 UI/DB 不同步。
 *
 * 使用場景：Schedule.saveDataToCloud / Stats.saveChangesToCloud
 */
export interface SaveScheduleWithTeamsPayload {
  schedule?: Record<string, unknown>;
  names?: Record<string, string>;
  teams?: Record<string, unknown>;
  takeoffEnabled?: boolean;
}

export interface SaveScheduleWithTeamsResult {
  schedule: {
    id: string;
    date: string;
    schedule: Record<string, unknown>;
    lastModifiedBy?: Record<string, unknown>;
    updatedAt?: string;
  } | null;
  teams: {
    date: string;
    teams: Record<string, unknown>;
    names: Record<string, string>;
    takeoffEnabled: boolean;
  } | null;
}

export async function saveScheduleWithTeams(
  date: string,
  payload: SaveScheduleWithTeamsPayload,
): Promise<SaveScheduleWithTeamsResult> {
  try {
    const res = (await localApi.put(
      `/schedules/${date}/with-teams`,
      payload,
    )) as SaveScheduleWithTeamsResult;
    return res;
  } catch (error) {
    console.error('Failed to atomically save schedule + teams:', error);
    throw error;
  }
}
