import { AfterViewInit, Component, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, OnInit, Output, SimpleChanges, ViewChild, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '@app/core/services/api.service';
import { firstValueFrom } from 'rxjs';

export interface DailyLogRevisionMeta {
  id: string;
  date: string;
  dailyLogId: string;
  revisionReason: string;
  createdBy: { uid?: string; name?: string } | null;
  createdAt: string;
}
export interface DailyLogBlockDiff { key: string; changed: boolean; current: unknown; historical: unknown; }
export interface DailyLogMovementDiff { id: string; action: 'add' | 'remove' | 'replace'; current?: unknown; historical?: unknown; }
export interface DailyLogRevisionDetail extends DailyLogRevisionMeta {
  currentVersion: string | number;
  diff: { blocks: DailyLogBlockDiff[]; movements: DailyLogMovementDiff[] };
}
export interface DailyLogRestoreResult { success: boolean; version: string | number; noOp?: boolean; restoredBlocks: string[]; restoredMovementIds: string[]; }

const BLOCK_LABELS: Record<string, string> = {
  patientMovements: '病人動態', vascularAccessLog: '日誌手填血管通路', announcements: '公告',
  stats: '營運統計與人力', leader: '各班簽名', notes: '備註', otherNotes: '其他事項',
};
const FIELD_LABELS: Record<string, string> = {
  patientName: '姓名', name: '姓名', medicalRecordNumber: '病歷號', movementType: '動態', type: '類型',
  reason: '原因', remarks: '說明', note: '備註', notes: '備註', content: '內容', date: '日期',
  admissionDate: '入院日', dischargeDate: '出院日', physician: '醫師', wardNumber: '病房', bed: '床位',
  early: '第一班', noon: '第二班', late: '第三班', main_beds: '洗腎中心', peripheral_beds: '外圍床位',
  staffing: '護理人力', total: '合計', opd: '門診', ipd: '住院', er: '急診', adjustments: '調整',
  deductions: '扣除', shift1: '第一班', shift2: '第二班', shift3: '第三班', timestamp: '時間',
};

@Component({
  selector: 'app-daily-log-history', standalone: true, imports: [CommonModule],
  templateUrl: './daily-log-history.component.html', changeDetection: ChangeDetectionStrategy.Eager,
 styleUrl: './daily-log-history.component.css',
})
export class DailyLogHistoryComponent implements OnInit, OnChanges, AfterViewInit, OnDestroy {
  private readonly api = inject(ApiService);
  @Input({ required: true }) date = '';
  @Input() currentVersion: string | number | null = null;
  @Input() hasDraft = false;
  @Input() busy = false;
  @Input() draftMessage = "";
  @Input() canRestore = false;
  @Output() closed = new EventEmitter<void>();
  @Output() saveDraftRequested = new EventEmitter<void>();
  @Output() discardDraftRequested = new EventEmitter<void>();
  @Output() restored = new EventEmitter<DailyLogRestoreResult>();
  @Output() restoringChange = new EventEmitter<boolean>();
  @ViewChild('historyDialog', { static: true }) dialog!: ElementRef<HTMLDialogElement>;

  readonly revisions = signal<DailyLogRevisionMeta[]>([]);
  readonly loadingList = signal(false);
  readonly loadingDetail = signal(false);
  readonly restoring = signal(false);
  readonly hasMore = signal(false);
  readonly selected = signal<DailyLogRevisionMeta | null>(null);
  readonly detail = signal<DailyLogRevisionDetail | null>(null);
  readonly selectedBlocks = signal<string[]>([]);
  readonly selectedMovements = signal<string[]>([]);
  readonly error = signal('');
  readonly message = signal('');
  readonly conflict = signal(false);
  readonly confirmation = signal<'restore' | 'discard' | null>(null);
  private listRequest = 0;
  private detailRequest = 0;
  private restoreRequest = 0;
  private destroyed = false;
  private readonly pageSize = 20;

  ngOnInit(): void { void this.loadRevisions(); }
  ngAfterViewInit(): void { this.dialog.nativeElement.showModal(); }
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['date'] && !changes['date'].firstChange) {
      ++this.detailRequest; this.loadingDetail.set(false); this.selected.set(null); this.detail.set(null); this.clearSelection();
      this.confirmation.set(null); this.message.set(''); this.error.set(''); void this.loadRevisions();
    } else if (changes['busy'] && !changes['busy'].firstChange && !this.busy) {
      void this.loadRevisions();
      if (this.selected()) void this.selectRevision(this.selected()!);
    } else if (changes['currentVersion'] && !changes['currentVersion'].firstChange && this.selected() && !this.restoring()) {
      void this.selectRevision(this.selected()!);
    }
  }
  ngOnDestroy(): void {
    this.destroyed = true; ++this.listRequest; ++this.detailRequest; ++this.restoreRequest;
    this.dialog.nativeElement.close();
  }
  get locked(): boolean { return this.busy || this.restoring(); }
  get canSubmit(): boolean {
    return this.canRestore && !this.hasDraft && !this.locked && !this.loadingDetail() && !this.conflict()
      && !!this.detail() && this.selectedBlocks().length > 0
      && (!this.selectedBlocks().includes('patientMovements') || this.selectedMovements().length > 0);
  }
  versionLabel(version: string | number | null): string { return version == null ? '尚未儲存' : String(version).slice(0, 12); }
  label(key: string): string { return BLOCK_LABELS[key] || FIELD_LABELS[key] || key; }
  reasonLabel(reason: string): string {
    if (reason === 'before_restore' || reason?.startsWith('before_restore:')) return '復原前保留版本';
    if (reason === 'after_restore' || reason?.startsWith('after_restore:')) return '復原後版本';
    if ((reason || '').includes('movement')) return '病人動態更新前';
    if (reason === 'before_update') return '儲存前保留版本';
    return '日誌修訂';
  }
  actionLabel(action: DailyLogMovementDiff['action']): string {
    return { add: '加回此列', remove: '移除此列', replace: '換回此列內容' }[action];
  }
  formatValue(value: unknown, depth = 0): string {
    if (value == null || value === '') return '（空白）';
    if (Array.isArray(value)) return value.length ? value.map((entry, i) => `${i + 1}. ${this.formatValue(entry, depth + 1)}`).join('\n') : '（無資料）';
    if (typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>).filter(([key]) => !['id', 'patientId', 'userId', 'uid', 'isEdited'].includes(key));
      return entries.length ? entries.map(([key, val]) => `${'  '.repeat(depth)}${this.label(key)}：${this.formatValue(val, depth + 1)}`).join('\n') : '（無資料）';
    }
    return String(value);
  }
  async loadRevisions(append = false): Promise<void> {
    if (this.locked || (append && this.loadingList())) return;
    const date = this.date, request = ++this.listRequest;
    const offset = append ? this.revisions().length : 0;
    this.loadingList.set(true); this.error.set('');
    if (!append) { this.revisions.set([]); this.hasMore.set(false); }
    try {
      const rows = await firstValueFrom(this.api.get<DailyLogRevisionMeta[]>(`/nursing/daily-logs/${encodeURIComponent(date)}/revisions`, { limit: String(this.pageSize), offset: String(offset) }));
      if (this.destroyed || request !== this.listRequest || date !== this.date) return;
      this.revisions.set(append ? [...this.revisions(), ...rows] : rows);
      this.hasMore.set(rows.length === this.pageSize);
    } catch (error: any) {
      if (request === this.listRequest && date === this.date) this.error.set(error?.error?.message || '歷史清單載入失敗，請重試。');
    } finally { if (request === this.listRequest && date === this.date) this.loadingList.set(false); }
  }
  async selectRevision(revision: DailyLogRevisionMeta): Promise<void> {
    if (this.locked) return;
    const date = this.date, request = ++this.detailRequest;
    this.selected.set(revision); this.detail.set(null); this.clearSelection(); this.confirmation.set(null);
    this.loadingDetail.set(true); this.error.set(''); this.conflict.set(false);
    try {
      const result = await firstValueFrom(this.api.get<DailyLogRevisionDetail>(`/nursing/daily-logs/${encodeURIComponent(date)}/revisions/${encodeURIComponent(revision.id)}`));
      if (this.destroyed || request !== this.detailRequest || date !== this.date || this.selected()?.id !== revision.id) return;
      this.detail.set(result);
    } catch (error: any) {
      if (request === this.detailRequest && date === this.date) this.error.set(error?.error?.message || '無法讀取此版本，請重試。');
    } finally { if (request === this.detailRequest && date === this.date) this.loadingDetail.set(false); }
  }
  toggleBlock(key: string): void {
    if (this.locked || this.conflict()) return;
    const values = this.selectedBlocks();
    this.selectedBlocks.set(values.includes(key) ? values.filter(value => value !== key) : [...values, key]);
    if (key === 'patientMovements' && !this.selectedBlocks().includes(key)) this.selectedMovements.set([]);
    this.confirmation.set(null);
  }
  toggleMovement(id: string): void {
    if (this.locked || this.conflict()) return;
    const values = this.selectedMovements();
    this.selectedMovements.set(values.includes(id) ? values.filter(value => value !== id) : [...values, id]);
    this.confirmation.set(null);
  }
  private clearSelection(): void { this.selectedBlocks.set([]); this.selectedMovements.set([]); }
  requestRestore(): void { if (this.canSubmit) this.confirmation.set('restore'); }
  requestDiscard(): void { if (this.hasDraft && !this.locked) this.confirmation.set('discard'); }
  confirmDiscard(): void {
    if (this.confirmation() !== 'discard' || this.locked) return;
    this.confirmation.set(null); this.discardDraftRequested.emit();
  }
  close(): void { if (!this.locked) this.closed.emit(); }
  cancel(event: Event): void { event.preventDefault(); this.close(); }
  async confirmRestore(): Promise<void> {
    if (!this.canSubmit || this.confirmation() !== 'restore') return;
    const date = this.date, revision = this.selected()!, detail = this.detail()!, request = ++this.restoreRequest;
    const payload = { expectedVersion: detail.currentVersion, blocks: [...this.selectedBlocks()], movementIds: [...this.selectedMovements()] };
    this.restoring.set(true); this.restoringChange.emit(true); this.confirmation.set(null); this.error.set('');
    try {
      const result = await firstValueFrom(this.api.post<DailyLogRestoreResult>(`/nursing/daily-logs/${encodeURIComponent(date)}/revisions/${encodeURIComponent(revision.id)}/restore`, payload));
      if (this.destroyed || request !== this.restoreRequest || date !== this.date || this.selected()?.id !== revision.id) return;
      this.message.set(result.noOp ? '內容已相同，未另外建立版本。' : `已復原所選內容，目前版本 ${result.version}。`);
      this.clearSelection(); this.detail.set(null); this.selected.set(null); this.restored.emit(result);
    } catch (error: any) {
      if (request !== this.restoreRequest || date !== this.date || this.destroyed) return;
      const conflict = error?.status === 409;
      this.conflict.set(conflict);
      this.error.set(conflict ? '目前日誌已被其他人更新。您的草稿與復原選擇保留，未覆蓋；請重新核對版本差異後再操作。' : error?.error?.message || '復原未完成，請確認連線及目前版本後重試。');
    } finally {
      if (request === this.restoreRequest && !this.destroyed) {
        this.restoring.set(false); this.restoringChange.emit(false);
        if (date === this.date && !this.error()) void this.loadRevisions();
      }
    }
  }
}
