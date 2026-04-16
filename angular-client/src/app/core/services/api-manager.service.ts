// src/app/core/services/api-manager.service.ts
// Standalone 版：使用 HttpClient (via ApiService) 進行 REST API CRUD 操作
import { Injectable, inject } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { firstValueFrom } from 'rxjs';

import { ApiService, COLLECTION_ROUTE_MAP } from './api.service';
import { BaseEntity } from '../models/common.model';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * @deprecated Use `BaseEntity` from `../models/common.model` instead.
 * Kept for backward compatibility with existing consumers.
 */
export type FirestoreRecord = { id?: string; [key: string]: unknown };

/** Observable-based CRUD interface (new) */
export interface ApiManager$<T> {
  fetchAll$: (queryConstraints?: unknown[]) => Observable<T[]>;
  fetchById$: (id: string) => Observable<T | null>;
  save$: (idOrData: string | T, data?: T) => Observable<T>;
  update$: (id: string, data: Partial<T>) => Observable<T>;
  delete$: (id: string) => Observable<{ id: string }>;
  create$: (data: T) => Observable<T>;
}

/** Promise-based CRUD interface (backward compatible) */
export interface ApiManager<T extends FirestoreRecord> {
  fetchAll: (queryConstraints?: unknown[]) => Promise<T[]>;
  fetchById: (id: string) => Promise<T | null>;
  save: (idOrData: string | T, data?: T) => Promise<T>;
  update: (id: string, data: Partial<T>) => Promise<T>;
  delete: (id: string) => Promise<{ id: string }>;
  create: (data: T) => Promise<T>;
}

/** Combined interface: Promise methods + Observable methods ($ suffix) */
export type ApiManagerCrud<T extends FirestoreRecord> = ApiManager<T> & ApiManager$<T>;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable({ providedIn: 'root' })
export class ApiManagerService {
  private readonly api = inject(ApiService);

  /**
   * Create a typed REST CRUD manager for a given collection.
   * Returns both Promise-based methods (backward compatible) and
   * Observable-based methods with `$` suffix.
   *
   * Usage (Promise - existing code):
   * ```ts
   * private patientApi = this.apiManager.create<Patient>('patients');
   * const all = await this.patientApi.fetchAll();
   * ```
   *
   * Usage (Observable - new code):
   * ```ts
   * private patientApi = this.apiManager.create<Patient>('patients');
   * this.patientApi.fetchAll$().subscribe(patients => ...);
   * ```
   */
  create<T extends FirestoreRecord>(resourceType: string): ApiManagerCrud<T> {
    const route = COLLECTION_ROUTE_MAP[resourceType] || `/${resourceType}`;

    // -----------------------------------------------------------------
    // Observable methods ($ suffix)
    // -----------------------------------------------------------------

    const fetchAll$ = (_queryConstraints: unknown[] = []): Observable<T[]> => {
      return this.api.get<unknown>(route).pipe(
        this.api.unwrapList<T>(),
        catchError((error) => {
          console.error(
            `[ApiManagerService] Error fetching ${resourceType}:`,
            error,
          );
          return throwError(() => error);
        }),
      );
    };

    const fetchById$ = (id: string): Observable<T | null> => {
      if (!id || typeof id !== 'string') {
        console.warn(
          `[ApiManagerService] fetchById called with invalid ID in ${resourceType}. Returning null.`,
        );
        return of(null);
      }

      return this.api.get<T>(`${route}/${id}`).pipe(
        catchError((error: any) => {
          if (error?.status === 404) {
            return of(null);
          }
          console.error(
            `[ApiManagerService] Error fetching document ${id}:`,
            error,
          );
          return throwError(() => error);
        }),
      );
    };

    const save$ = (idOrData: string | T, data?: T): Observable<T> => {
      // Case 1: auto-generated ID (POST)
      if (typeof idOrData === 'object' && data === undefined) {
        return this.api.post<T>(route, idOrData).pipe(
          catchError((error) => {
            console.error(
              `[ApiManagerService] Error saving to ${resourceType}:`,
              error,
            );
            return throwError(() => error);
          }),
        );
      }
      // Case 2: explicit ID (PUT with merge)
      if (typeof idOrData === 'string' && typeof data === 'object') {
        return this.api.put<T>(`${route}/${idOrData}`, data).pipe(
          catchError((error) => {
            console.error(
              `[ApiManagerService] Error saving to ${resourceType}:`,
              error,
            );
            return throwError(() => error);
          }),
        );
      }

      return throwError(
        () =>
          new Error(
            'Invalid arguments for save function. Use save(data) or save(id, data).',
          ),
      );
    };

    const update$ = (id: string, data: Partial<T>): Observable<T> => {
      if (!id || typeof id !== 'string') {
        const msg = `[ApiManagerService] Invalid or missing ID for update in ${resourceType}.`;
        console.error(msg);
        return throwError(() => new Error(msg));
      }

      return this.api.patch<T>(`${route}/${id}`, data).pipe(
        catchError((error) => {
          console.error(
            `[ApiManagerService] Error updating document ${id}:`,
            error,
          );
          return throwError(() => error);
        }),
      );
    };

    const delete$ = (id: string): Observable<{ id: string }> => {
      if (!id || typeof id !== 'string') {
        const msg = `[ApiManagerService] Invalid or missing ID for deletion in ${resourceType}.`;
        console.error(msg);
        return throwError(() => new Error(msg));
      }

      return this.api.delete<unknown>(`${route}/${id}`).pipe(
        map(() => ({ id })),
        catchError((error) => {
          console.error(
            `[ApiManagerService] Error deleting document ${id}:`,
            error,
          );
          return throwError(() => error);
        }),
      );
    };

    const create$ = (data: T): Observable<T> => {
      return save$(data);
    };

    // -----------------------------------------------------------------
    // Promise methods (backward compatible, delegate to Observable)
    // -----------------------------------------------------------------

    const fetchAll = (queryConstraints: unknown[] = []): Promise<T[]> =>
      firstValueFrom(fetchAll$(queryConstraints));

    const fetchById = (id: string): Promise<T | null> =>
      firstValueFrom(fetchById$(id));

    const save = (idOrData: string | T, data?: T): Promise<T> =>
      firstValueFrom(save$(idOrData, data));

    const update = (id: string, data: Partial<T>): Promise<T> =>
      firstValueFrom(update$(id, data));

    const deleteDocument = (id: string): Promise<{ id: string }> =>
      firstValueFrom(delete$(id));

    const createDocument = (data: T): Promise<T> =>
      firstValueFrom(create$(data));

    return {
      // Promise-based (backward compatible)
      fetchAll,
      fetchById,
      save,
      update,
      delete: deleteDocument,
      create: createDocument,
      // Observable-based (new)
      fetchAll$,
      fetchById$,
      save$,
      update$,
      delete$,
      create$,
    };
  }
}
