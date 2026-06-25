import { Injectable, inject, signal, computed } from '@angular/core';
// Standalone 版：已移除 Firebase
import { ApiManagerService, type ApiManager, type FirestoreRecord } from './api-manager.service';

export interface Patient {
  id: string;
  name: string;
  medicalRecordNumber: string;
  dialysisId: string;
  gender: string;
  birthDate: string;
  diseases: string[];
  status: string;
  [key: string]: unknown;
}

@Injectable({ providedIn: 'root' })
export class PatientService {
  private readonly apiManagerService = inject(ApiManagerService);
  private readonly patientsApi: ApiManager<FirestoreRecord>;

  /** Internal writable signals */
  private readonly _patients = signal<Patient[]>([]);
  private readonly _isLoading = signal(false);
  private readonly _error = signal<string | null>(null);
  private _hasFetched = false;

  /** Public read-only signals */
  readonly patients = this._patients.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly patientCount = computed(() => this._patients().length);

  constructor() {
    this.patientsApi = this.apiManagerService.create<FirestoreRecord>('patients');
  }

  /**
   * Fetch all patients from API.
   */
  async fetchPatients(): Promise<void> {
    if (this._isLoading() || this._hasFetched) {
      return;
    }

    this._isLoading.set(true);
    this._error.set(null);

    try {
      const allPatients = await this.patientsApi.fetchAll();
      const patients: Patient[] = (allPatients as Patient[]).sort((a, b) =>
        (a.name || '').localeCompare(b.name || '', 'zh-TW')
      );

      this._patients.set(patients);
      this._hasFetched = true;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to fetch patients';
      this._error.set(message);
      console.error('[PatientService] Error fetching patients:', error);
    } finally {
      this._isLoading.set(false);
    }
  }

  /**
   * Get a patient by ID from the cached list.
   */
  getPatientById(id: string): Patient | undefined {
    return this._patients().find((p) => p.id === id);
  }

  /**
   * Clear the patient list and reset state.
   */
  clear(): void {
    this._patients.set([]);
    this._error.set(null);
  }
}

