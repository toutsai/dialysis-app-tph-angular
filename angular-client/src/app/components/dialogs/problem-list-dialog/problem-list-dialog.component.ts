import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '@app/core/services/api.service';
import { KIDIT_HISTORY_OPTIONS } from '@/utils/kiditHelpers';

interface ProblemRow {
  id: string;
  patientId: string;
  problem: string;
  startDate: string;
  treatment: string;
  resolvedDate: string;
  createdBy?: { uid?: string; name?: string };
  createdAt?: string;
  updatedAt?: string;
}

interface KiditSystemic {
  date: string;
  selectedSystemicDiseases: number[];
  otherSystemicDescription: string;
  dmType: string;
}

interface ProblemListResponse {
  kidit: KiditSystemic | null;
  manual: { systemicDiseases: number[]; otherDescription: string; updatedAt?: string } | null;
  problems: ProblemRow[];
}

const DM_TYPE_LABELS: Record<string, string> = {
  '1': 'IDDM (胰島素依賴)',
  '2': 'NDDM (非胰島素依賴)',
  '3': '未明',
};

@Component({
  selector: 'app-problem-list-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './problem-list-dialog.component.html',
  styleUrl: './problem-list-dialog.component.css',
})
export class ProblemListDialogComponent implements OnInit {
  @Input() patientId = '';
  @Input() patientName = '';
  @Input() patientMrn = '';
  @Input() canEdit = false;
  @Input() canDelete = false;
  @Output() close = new EventEmitter<void>();

  readonly systemicOptions = KIDIT_HISTORY_OPTIONS['systemicDiseases'] as { index: number; label: string }[];

  loading = false;
  saving = false;
  errorMsg = '';

  kidit: KiditSystemic | null = null;
  // 手動勾選工作副本（KiDit 無資料時可編輯）
  manualSelection: number[] = [];
  manualOther = '';
  manualDirty = false;

  // 問題列表（載入後拆兩組存欄位，模板勿用 getter 重算）
  activeProblems: ProblemRow[] = [];
  resolvedProblems: ProblemRow[] = [];

  // 新增表單
  newProblem = '';
  newStartDate = new Date().toLocaleDateString('sv-SE');
  newTreatment = '';

  // 列內編輯
  editingId: string | null = null;
  editProblem = '';
  editStartDate = '';
  editTreatment = '';
  editResolvedDate = '';

  constructor(private api: ApiService) {}

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    if (!this.patientId) return;
    this.loading = true;
    this.errorMsg = '';
    try {
      const res = await firstValueFrom(
        this.api.get<ProblemListResponse>(`/patients/${this.patientId}/problem-list`),
      );
      this.kidit = res.kidit;
      this.manualSelection = [...(res.manual?.systemicDiseases || [])];
      this.manualOther = res.manual?.otherDescription || '';
      this.manualDirty = false;
      this.splitProblems(res.problems || []);
    } catch (err) {
      console.error('載入病史與問題列表失敗:', err);
      this.errorMsg = '載入失敗，請稍後重試';
    } finally {
      this.loading = false;
    }
  }

  private splitProblems(list: ProblemRow[]): void {
    this.activeProblems = list.filter((p) => !p.resolvedDate);
    this.resolvedProblems = list.filter((p) => !!p.resolvedDate);
  }

  private allProblems(): ProblemRow[] {
    return [...this.activeProblems, ...this.resolvedProblems];
  }

  // ---- 區塊一：相關性系統疾病 ----
  isKiditChecked(idx: number): boolean {
    return !!this.kidit && this.kidit.selectedSystemicDiseases.includes(idx);
  }

  kiditDmTypeLabel(): string {
    if (!this.kidit || !this.kidit.selectedSystemicDiseases.includes(0)) return '';
    return DM_TYPE_LABELS[this.kidit.dmType] || '';
  }

  isManualChecked(idx: number): boolean {
    return this.manualSelection.includes(idx);
  }

  toggleManual(idx: number): void {
    if (!this.canEdit) return;
    const i = this.manualSelection.indexOf(idx);
    if (i > -1) this.manualSelection.splice(i, 1);
    else this.manualSelection.push(idx);
    this.manualDirty = true;
  }

  onManualOtherChange(): void {
    this.manualDirty = true;
  }

  async saveManual(): Promise<void> {
    if (!this.canEdit || this.saving) return;
    this.saving = true;
    this.errorMsg = '';
    try {
      await firstValueFrom(
        this.api.put(`/patients/${this.patientId}/problem-profile`, {
          systemicDiseases: this.manualSelection,
          otherDescription: this.manualOther,
        }),
      );
      this.manualDirty = false;
    } catch (err) {
      console.error('儲存系統疾病勾選失敗:', err);
      this.errorMsg = '儲存勾選失敗';
    } finally {
      this.saving = false;
    }
  }

  // ---- 區塊二：問題列表 ----
  async addProblem(): Promise<void> {
    if (!this.canEdit || this.saving || !this.newProblem.trim()) return;
    this.saving = true;
    this.errorMsg = '';
    try {
      const created = await firstValueFrom(
        this.api.post<ProblemRow>(`/patients/${this.patientId}/problems`, {
          problem: this.newProblem.trim(),
          startDate: this.newStartDate || '',
          treatment: this.newTreatment || '',
        }),
      );
      this.splitProblems([created, ...this.allProblems()]);
      this.newProblem = '';
      this.newTreatment = '';
      this.newStartDate = new Date().toLocaleDateString('sv-SE');
    } catch (err) {
      console.error('新增問題失敗:', err);
      this.errorMsg = '新增問題失敗';
    } finally {
      this.saving = false;
    }
  }

  startEdit(p: ProblemRow): void {
    if (!this.canEdit) return;
    this.editingId = p.id;
    this.editProblem = p.problem;
    this.editStartDate = p.startDate;
    this.editTreatment = p.treatment;
    this.editResolvedDate = p.resolvedDate;
  }

  cancelEdit(): void {
    this.editingId = null;
  }

  async saveEdit(): Promise<void> {
    if (!this.editingId || this.saving || !this.editProblem.trim()) return;
    await this.updateProblem(this.editingId, {
      problem: this.editProblem.trim(),
      startDate: this.editStartDate || '',
      treatment: this.editTreatment,
      resolvedDate: this.editResolvedDate || '',
    });
    this.editingId = null;
  }

  async markResolved(p: ProblemRow): Promise<void> {
    if (!this.canEdit) return;
    await this.updateProblem(p.id, { resolvedDate: new Date().toLocaleDateString('sv-SE') });
  }

  async reopenProblem(p: ProblemRow): Promise<void> {
    if (!this.canEdit) return;
    await this.updateProblem(p.id, { resolvedDate: '' });
  }

  private async updateProblem(problemId: string, body: Partial<ProblemRow>): Promise<void> {
    this.saving = true;
    this.errorMsg = '';
    try {
      const updated = await firstValueFrom(
        this.api.put<ProblemRow>(`/patients/${this.patientId}/problems/${problemId}`, body),
      );
      this.splitProblems(this.allProblems().map((x) => (x.id === problemId ? updated : x)));
    } catch (err) {
      console.error('更新問題失敗:', err);
      this.errorMsg = '更新問題失敗';
    } finally {
      this.saving = false;
    }
  }

  async deleteProblem(p: ProblemRow): Promise<void> {
    if (!this.canDelete || this.saving) return;
    if (!confirm(`確定刪除問題「${p.problem}」？`)) return;
    this.saving = true;
    this.errorMsg = '';
    try {
      await firstValueFrom(this.api.delete(`/patients/${this.patientId}/problems/${p.id}`));
      this.splitProblems(this.allProblems().filter((x) => x.id !== p.id));
    } catch (err) {
      console.error('刪除問題失敗:', err);
      this.errorMsg = '刪除問題失敗';
    } finally {
      this.saving = false;
    }
  }

  onOverlayClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('pl-overlay')) {
      this.close.emit();
    }
  }
}
