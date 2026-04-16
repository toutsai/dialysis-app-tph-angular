import {
  Component,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiConfigService } from '@services/api-config.service';
import {
  ApiManagerService,
  type ApiManager,
  type FirestoreRecord,
} from '@services/api-manager.service';
// Standalone 版：已移除 Firebase
import { formatDateTimeToLocal, parseFirestoreTimestamp } from '@/utils/dateUtils';

interface MedicationDraft extends FirestoreRecord {
  patientId: string;
  patientName: string;
  medicalRecordNumber: string;
  targetMonth: string;
  orderName: string;
  dose: string;
  frequency?: string;
  note?: string;
  authorName: string;
  createdAt: unknown;
  status: string;
}

interface DraftGroup {
  patientId: string;
  patientName: string;
  medicalRecordNumber: string;
  targetMonth: string;
  isConfirming: boolean;
  drafts: MedicationDraft[];
}

@Component({
  selector: 'app-draft-orders',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './draft-orders.component.html',
  styleUrl: './draft-orders.component.css',
})
export class DraftOrdersComponent implements OnInit {
  private readonly firebaseService = inject(ApiConfigService);
  private readonly apiManagerService = inject(ApiManagerService);
  private readonly draftOrdersApi: ApiManager<MedicationDraft>;

  readonly isLoading = signal(true);
  readonly drafts = signal<MedicationDraft[]>([]);
  readonly confirmingState = signal<Record<string, boolean>>({});

  readonly groupedDrafts = computed<DraftGroup[]>(() => {
    const groups: Record<string, DraftGroup> = {};
    const currentConfirming = this.confirmingState();

    this.drafts().forEach((draft) => {
      const key = `${draft.patientId}_${draft.targetMonth}`;
      if (!groups[key]) {
        groups[key] = {
          patientId: draft.patientId,
          patientName: draft.patientName,
          medicalRecordNumber: draft.medicalRecordNumber,
          targetMonth: draft.targetMonth,
          isConfirming: currentConfirming[key] || false,
          drafts: [],
        };
      }
      groups[key].drafts.push(draft);
    });

    return Object.values(groups);
  });

  constructor() {
    this.draftOrdersApi =
      this.apiManagerService.create<MedicationDraft>('medication_drafts');
  }

  ngOnInit(): void {
    this.fetchDrafts();
  }

  async fetchDrafts(): Promise<void> {
    this.isLoading.set(true);
    try {
      const allDrafts = await this.draftOrdersApi.fetchAll();
      const pendingDrafts = (allDrafts as MedicationDraft[]).filter(
        (d) => d.status === 'pending'
      ).sort((a: any, b: any) => {
        const aDate = typeof a.createdAt === 'string' ? a.createdAt : '';
        const bDate = typeof b.createdAt === 'string' ? b.createdAt : '';
        return bDate.localeCompare(aDate);
      });
      this.drafts.set(pendingDrafts);
    } catch (error) {
      console.error('讀取藥囑草稿失敗:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  async confirmDrafts(group: DraftGroup): Promise<void> {
    if (
      !confirm(
        `確定要將 ${group.patientName} (${group.targetMonth}) 的所有藥囑草稿歸檔嗎？`
      )
    ) {
      return;
    }

    const key = `${group.patientId}_${group.targetMonth}`;
    this.confirmingState.update((state) => ({ ...state, [key]: true }));

    try {
      // Update each draft status to completed via REST API
      const updatePromises = group.drafts.map((draft) =>
        this.draftOrdersApi.update(draft.id!, { status: 'completed' } as any)
      );
      await Promise.all(updatePromises);
      await this.fetchDrafts();
    } catch (error) {
      console.error('歸檔藥囑失敗:', error);
      alert('歸檔失敗，請稍後再試。');
    } finally {
      this.confirmingState.update((state) => ({ ...state, [key]: false }));
    }
  }

  formatDateTime(timestamp: unknown): string {
    if (!timestamp) return '';
    const date = parseFirestoreTimestamp(timestamp as string | number | Date);
    return formatDateTimeToLocal(date);
  }
}
