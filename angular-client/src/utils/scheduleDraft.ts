/** Tracks edits separately from requests so late responses cannot replace a newer draft. */
export interface DraftRequest {
  readonly key: string;
  readonly revision: number;
  readonly generation: number;
}

export class ScheduleDraft {
  private revision = 0;
  private generation = 0;
  private saving: DraftRequest | null = null;

  markEdited(): void {
    this.revision++;
  }

  invalidate(): void {
    this.generation++;
  }

  beginLoad(key: string): DraftRequest {
    this.invalidate();
    return this.capture(key);
  }

  isCurrent(request: DraftRequest, key: string): boolean {
    return request.key === key && request.generation === this.generation;
  }

  isUnchanged(request: DraftRequest, key: string): boolean {
    return this.isCurrent(request, key) && request.revision === this.revision;
  }

  canApplyLoad(request: DraftRequest, key: string): boolean {
    return (!this.saving || this.saving.key !== key) && this.isUnchanged(request, key);
  }

  beginSave(key: string): DraftRequest | null {
    if (this.saving) return null;
    // Any read that started before this write is now stale.
    this.invalidate();
    this.saving = this.capture(key);
    return this.saving;
  }

  finishSave(request: DraftRequest): void {
    if (this.saving === request) this.saving = null;
  }

  private capture(key: string): DraftRequest {
    return { key, revision: this.revision, generation: this.generation };
  }
}

/** Preserve every persisted field on occupied slots; detach the payload from the editable draft. */
export function copyOccupiedScheduleSlots<T extends { patientId?: unknown; shiftId?: unknown }>(
  schedule: Record<string, T>,
): Record<string, T> {
  const result: Record<string, T> = {};
  for (const [key, slot] of Object.entries(schedule)) {
    if (!slot?.patientId) continue;
    if (typeof slot.shiftId !== 'string' || !slot.shiftId) {
      throw new Error(`床位 ${key} 缺少有效的 shiftId，請重新載入排程後再試。`);
    }
    result[key] = structuredClone(slot);
  }
  return result;
}
