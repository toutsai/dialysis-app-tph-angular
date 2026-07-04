import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { localApi } from '@/services/localApiClient';
import { AuthService } from '@app/core/services/auth.service';
import { EducationRecordDialogComponent } from '@app/components/dialogs/education-record-dialog/education-record-dialog.component';

interface EducationListItem {
  patientId: string;
  patientName: string;
  medicalRecordNumber: string;
  status: string;
  wardNumber: string;
  firstDialysisActive: boolean;
  firstDialysisDate: string;
  admissionDate: string;
  hasRecord: boolean;
  educatedCount: number;
  returnDemoCount: number;
  passedCount: number;
  total: number;
  completed: boolean;
  lastUpdated: string;
}

/**
 * 後台「初透衛教進度」總覽。
 * 列出目前首透中或已有衛教進度的病人，顯示已衛教 / 回示教通過 進度，
 * 可直接點開現有的初透衛教紀錄視窗檢視或編輯。
 */
@Component({
  selector: 'app-education-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, EducationRecordDialogComponent],
  templateUrl: './education-dashboard.component.html',
  styleUrl: './education-dashboard.component.css',
})
export class EducationDashboardComponent implements OnInit {
  private readonly authService = inject(AuthService);

  readonly rows = signal<EducationListItem[]>([]);
  readonly loading = signal(true);
  readonly errorMsg = signal('');
  readonly search = signal('');
  readonly incompleteOnly = signal(false);

  readonly dialogPatient = signal<EducationListItem | null>(null);

  readonly canEdit = computed(() => !this.authService.isViewer());

  readonly filteredRows = computed(() => {
    const term = this.search().trim().toLowerCase();
    const inc = this.incompleteOnly();
    const list = this.rows().filter((r) => {
      if (inc && r.passedCount >= r.total) return false;
      if (!term) return true;
      return (
        (r.patientName || '').toLowerCase().includes(term) ||
        (r.medicalRecordNumber || '').toLowerCase().includes(term)
      );
    });
    // 依初透日「近→遠」（新到舊）排序，無初透日者排最後
    return [...list].sort((a, b) => {
      const da = a.firstDialysisDate || '';
      const db = b.firstDialysisDate || '';
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return db.localeCompare(da);
    });
  });

  readonly summary = computed(() => {
    const rows = this.rows();
    const total = rows.length;
    const passed = rows.filter((r) => r.passedCount >= r.total).length;
    const notStarted = rows.filter((r) => r.educatedCount === 0).length;
    return { total, passed, inProgress: total - passed - notStarted, notStarted };
  });

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.errorMsg.set('');
    try {
      const data: any = await localApi.get('/patients/education-list');
      this.rows.set(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('載入衛教進度失敗:', e);
      this.errorMsg.set('載入衛教進度清單失敗');
      this.rows.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  statusLabel(s: string): string {
    return s === 'ipd' ? '住院' : s === 'er' ? '急診' : '門診';
  }

  pct(count: number, total: number): number {
    if (!total) return 0;
    return Math.round((count / total) * 100);
  }

  formatDate(d: string): string {
    return d ? String(d).slice(0, 10) : '—';
  }

  openRecord(row: EducationListItem): void {
    this.dialogPatient.set(row);
  }

  async closeRecord(): Promise<void> {
    this.dialogPatient.set(null);
    await this.load();
  }
}
