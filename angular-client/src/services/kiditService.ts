// src/services/kiditService.ts
// Backward-compatible bridge file (Phase 5 migration)
// Re-exports kiditService that components still import from '@/services/kiditService'
import { localApi } from '@/services/localApiClient';

const ROUTE = '/nursing/kidit-logbook';

export const kiditService = {
  async fetchMonthLogs(year: number, month: number): Promise<any[]> {
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const nextDate = new Date(year, month, 1);
    const endDate = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-01`;

    const data = await localApi.get(`${ROUTE}?startDate=${startDate}&endDate=${endDate}`);
    return Array.isArray(data) ? data : (data?.data || []);
  },

  async updateLogEvents(dateStr: string, events: any[]): Promise<void> {
    await localApi.patch(`${ROUTE}/${dateStr}`, { events });
  },

  async fetchPatientMasterRecord(patientId: string): Promise<any> {
    try {
      return await localApi.get(`/patients/${patientId}`);
    } catch (error) {
      console.error('Fetch master patient record failed:', error);
      return null;
    }
  },

  async updateEventKiDitData(dateStr: string, eventId: string, fieldKey: string, data: any): Promise<boolean> {
    try {
      const logDoc = await localApi.get(`${ROUTE}/${dateStr}`);
      if (!logDoc) {
        throw new Error('Document does not exist!');
      }

      const events = logDoc.events || [];
      const eventIndex = events.findIndex((e: any) => e.id === eventId);
      if (eventIndex === -1) {
        throw new Error('Event not found!');
      }

      events[eventIndex][fieldKey] = data;

      await localApi.patch(`${ROUTE}/${dateStr}`, { events });
      return true;
    } catch (e) {
      console.error('Update event KiDit data failed: ', e);
      throw e;
    }
  },
};
