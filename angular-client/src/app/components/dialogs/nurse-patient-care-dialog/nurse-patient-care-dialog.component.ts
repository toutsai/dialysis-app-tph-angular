// src/app/components/dialogs/nurse-patient-care-dialog/nurse-patient-care-dialog.component.ts
// 護理師分配病人照護清單：全部護理師 + 未分配門診病人，點選病人→點選護理師卡指派
// 儲存於 nurse_patient_care 單一 JSON 文件（與每日護理分組無關）

import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '@app/core/services/auth.service';
import { Patient, PatientStoreService } from '@app/core/services/patient-store.service';
import { UserDirectoryService } from '@app/core/services/user-directory.service';
import {
  NurseCareAssignment,
  NursePatientCareApiService,
} from '@app/core/services/nurse-patient-care-api.service';

interface NurseCard {
  nurseId: string;
  nurseName: string;
  patients: Patient[];
  excluded: boolean;
}

@Component({
  selector: 'app-nurse-patient-care-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './nurse-patient-care-dialog.component.html',
  styleUrl: './nurse-patient-care-dialog.component.css',
})
export class NursePatientCareDialogComponent implements OnChanges {
  @Input() isVisible = false;
  @Output() closed = new EventEmitter<void>();

  private readonly authService = inject(AuthService);
  private readonly patientStore = inject(PatientStoreService);
  private readonly userDirectory = inject(UserDirectoryService);
  private readonly careApi = inject(NursePatientCareApiService);

  // --- State ---
  isLoading = signal(false);
  isSaving = signal(false);
  loadError = signal('');
  searchTerm = signal('');
  selectedPatientId = signal<string | null>(null);
  isDirty = signal(false);
  /** 排除不列入照護分配的護理師 id */
  excludedIds = signal<Set<string>>(new Set());
  /** 排除名單設定模式：點護理師卡片=切換排除 */
  isExclusionMode = signal(false);
  updatedInfo = signal<{ updatedAt: string | null; updatedByName: string }>({
    updatedAt: null,
    updatedByName: '',
  });
  /** nurseId -> patientIds（含暫時不在門診的病人 id，顯示時才過濾） */
  private assignmentMap = signal<Record<string, string[]>>({});

  get isAdmin(): boolean {
    return this.authService.isAdmin();
  }

  /** 照護清單顯示對象：常規門診病人（未刪除；分類未設定視為常規，同病人表單預設） */
  private isRegularOpd(p: Patient): boolean {
    return (
      p.status === 'opd' &&
      !p['isDeleted'] &&
      (p['patientCategory'] == null || p['patientCategory'] === 'opd_regular')
    );
  }

  /**
   * 從門診被刪除、仍在保留期（刪除日+1個月）內的病人：
   * 護理師卡片上暫留一個月才退場（2026-08-13 使用者需求），加「已刪除」標記。
   * 只影響卡片顯示；未分配池維持嚴格條件，避免已刪除病人被重新指派。
   * 即時刪除 status 仍是 opd、預約刪除 cron 會改成 deleted+originalStatus，兩種都涵蓋。
   */
  isRetainedDeleted(p: Patient): boolean {
    if (!p['isDeleted']) return false;
    const wasOpd = p.status === 'opd' || p['originalStatus'] === 'opd';
    if (!wasOpd) return false;
    if (!(p['patientCategory'] == null || p['patientCategory'] === 'opd_regular')) return false;
    const deletedAt = p['deletedAt'] as string | null | undefined;
    if (!deletedAt) return false;
    const deleted = new Date(deletedAt);
    if (isNaN(deleted.getTime())) return false;
    const expiry = new Date(deleted);
    expiry.setMonth(expiry.getMonth() + 1);
    return new Date() < expiry;
  }

  // --- Computed ---
  readonly nurses = computed(() => {
    const list = this.userDirectory
      .allUsers()
      .filter((u) => u.title === '護理師' && u.isActive !== false);
    return [...list].sort((a, b) => {
      const na = parseInt(a.username || '', 10);
      const nb = parseInt(b.username || '', 10);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return (a.name || '').localeCompare(b.name || '', 'zh-Hant');
    });
  });

  private readonly assignedIdSet = computed(() => {
    const set = new Set<string>();
    for (const ids of Object.values(this.assignmentMap())) {
      for (const id of ids) set.add(id);
    }
    return set;
  });

  /** 未分配的門診病人（可搜尋） */
  readonly unassignedPatients = computed(() => {
    const assigned = this.assignedIdSet();
    const search = this.searchTerm().trim().toLowerCase();
    let result = this.patientStore
      .allPatients()
      .filter((p) => p.id && this.isRegularOpd(p) && !assigned.has(p.id));
    if (search) {
      result = result.filter(
        (p) =>
          p.name?.toLowerCase().includes(search) ||
          p.medicalRecordNumber?.toLowerCase().includes(search),
      );
    }
    return [...result].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh-Hant'));
  });

  readonly unassignedTotal = computed(() => {
    const assigned = this.assignedIdSet();
    return this.patientStore
      .allPatients()
      .filter((p) => p.id && this.isRegularOpd(p) && !assigned.has(p.id)).length;
  });

  /** 每位護理師的卡片（常規門診者＋刪除未滿一個月的保留病人） */
  readonly nurseCards = computed<NurseCard[]>(() => {
    const map = this.assignmentMap();
    const patientMap = this.patientStore.patientMap();
    const excluded = this.excludedIds();
    return this.nurses().map((n) => {
      const patients = (map[n.id] || [])
        .map((id) => patientMap.get(id))
        .filter((p): p is Patient => !!p && (this.isRegularOpd(p) || this.isRetainedDeleted(p)));
      return { nurseId: n.id, nurseName: n.name || '', patients, excluded: excluded.has(n.id) };
    });
  });

  /** 畫面上顯示的卡片：一般模式隱藏已排除者，排除設定模式顯示全部 */
  readonly displayedCards = computed<NurseCard[]>(() =>
    this.isExclusionMode() ? this.nurseCards() : this.nurseCards().filter((c) => !c.excluded),
  );

  readonly excludedCount = computed(
    () => this.nurseCards().filter((c) => c.excluded).length,
  );

  readonly selectedPatient = computed<Patient | null>(() => {
    const id = this.selectedPatientId();
    if (!id) return null;
    return this.patientStore.patientMap().get(id) || null;
  });

  // --- Lifecycle ---
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isVisible'] && this.isVisible) {
      this.open();
    }
  }

  // --- Data loading ---
  private async open(): Promise<void> {
    this.selectedPatientId.set(null);
    this.searchTerm.set('');
    this.isDirty.set(false);
    this.isExclusionMode.set(false);
    this.loadError.set('');
    this.isLoading.set(true);
    try {
      const [, , doc] = await Promise.all([
        this.userDirectory.fetchUsersIfNeeded(),
        this.patientStore.fetchPatientsIfNeeded(),
        this.careApi.fetch(),
      ]);

      const excluded = new Set(doc?.excludedNurseIds || []);
      this.excludedIds.set(excluded);

      // 只保留目前仍在職且未被排除護理師的分配；其餘病人自動回到未分配
      const nurseIds = new Set(this.nurses().map((n) => n.id));
      const map: Record<string, string[]> = {};
      for (const entry of doc?.assignments || []) {
        if (entry?.nurseId && nurseIds.has(entry.nurseId) && !excluded.has(entry.nurseId)) {
          map[entry.nurseId] = Array.isArray(entry.patientIds) ? [...entry.patientIds] : [];
        }
      }
      this.assignmentMap.set(map);
      this.updatedInfo.set({
        updatedAt: doc?.updatedAt || null,
        updatedByName: doc?.updatedBy?.name || '',
      });
    } catch (error) {
      console.error('載入照護分配失敗:', error);
      this.loadError.set('載入照護分配失敗，請稍後再試。');
    } finally {
      this.isLoading.set(false);
    }
  }

  // --- Interactions ---
  toggleExclusionMode(): void {
    if (!this.isAdmin) return;
    this.selectedPatientId.set(null);
    this.isExclusionMode.set(!this.isExclusionMode());
  }

  onNurseCardClick(card: NurseCard): void {
    if (this.isExclusionMode()) {
      this.toggleNurseExcluded(card);
    } else {
      this.moveSelectedTo(card.nurseId);
    }
  }

  private toggleNurseExcluded(card: NurseCard): void {
    if (!this.isAdmin) return;
    const excluding = !card.excluded;
    if (excluding && card.patients.length > 0) {
      const ok = confirm(
        `${card.nurseName} 已分配 ${card.patients.length} 位病人，排除後將移回未分配。確定排除？`,
      );
      if (!ok) return;
    }
    this.excludedIds.update((current) => {
      const next = new Set(current);
      if (excluding) {
        next.add(card.nurseId);
      } else {
        next.delete(card.nurseId);
      }
      return next;
    });
    if (excluding) {
      // 排除者的分配清空，病人回到未分配
      this.assignmentMap.update((current) => {
        const next = { ...current };
        delete next[card.nurseId];
        return next;
      });
    }
    this.isDirty.set(true);
  }

  togglePatient(patient: Patient): void {
    if (!this.isAdmin || !patient.id) return;
    this.selectedPatientId.set(this.selectedPatientId() === patient.id ? null : patient.id);
  }

  /** 把選取的病人指派給護理師；nurseId 為 null 表示移回未分配 */
  moveSelectedTo(nurseId: string | null): void {
    if (!this.isAdmin) return;
    const patientId = this.selectedPatientId();
    if (!patientId) return;

    this.assignmentMap.update((current) => {
      const next: Record<string, string[]> = {};
      for (const [key, ids] of Object.entries(current)) {
        next[key] = ids.filter((id) => id !== patientId);
      }
      if (nurseId) {
        next[nurseId] = [...(next[nurseId] || []), patientId];
      }
      return next;
    });
    this.selectedPatientId.set(null);
    this.isDirty.set(true);
  }

  async save(): Promise<void> {
    if (!this.isAdmin || this.isSaving()) return;
    this.isSaving.set(true);
    try {
      const nameById = new Map(this.nurses().map((n) => [n.id, n.name || '']));
      const assignments: NurseCareAssignment[] = Object.entries(this.assignmentMap())
        .filter(([, ids]) => ids.length > 0)
        .map(([nurseId, patientIds]) => ({
          nurseId,
          nurseName: nameById.get(nurseId) || '',
          patientIds,
        }));
      await this.careApi.save(assignments, Array.from(this.excludedIds()));
      this.isDirty.set(false);
      this.updatedInfo.set({
        updatedAt: new Date().toLocaleString('sv-SE'),
        updatedByName: this.authService.currentUser()?.name || '',
      });
    } catch (error) {
      console.error('儲存照護分配失敗:', error);
      alert('儲存失敗，請稍後再試。');
    } finally {
      this.isSaving.set(false);
    }
  }

  close(): void {
    if (this.isDirty() && !confirm('尚有未儲存的變更，確定要關閉嗎？')) {
      return;
    }
    this.selectedPatientId.set(null);
    this.closed.emit();
  }

  onOverlayClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.close();
    }
  }
}
