import { Component, EventEmitter, HostListener, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  AkiApiService, IcuCandidate, IcuCandidateLookupItem, IcuCandidateMode, IcuCandidatePayload,
  IcuCandidateRiskItem, IcuCandidateStatus,
} from '@app/core/services/aki-api.service';
import { AuthService } from '@app/core/services/auth.service';

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * ICU 待透析評估：新增／編輯視窗（2026-09-19）。
 * 新增時可用病歷號／姓名從最新住院快照帶入基本資料；查不到也能手動填。範圍只限 ICU → 必選 ICUA／ICUB／ICUD。
 * 血行動力學勾選沿用 ICU 透析卡片的 CRRT 風險配分，只作「傾向哪種模式」的提示（非驗證分數）。
 */
@Component({
  selector: 'app-icu-candidate-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './icu-candidate-dialog.component.html',
  styleUrl: './icu-candidate-dialog.component.css',
})
export class IcuCandidateDialogComponent implements OnInit {
  private readonly akiApi = inject(AkiApiService);
  private readonly auth = inject(AuthService);

  /** null＝新增 */
  @Input() candidate: IcuCandidate | null = null;
  @Output() closed = new EventEmitter<void>();
  /** 有寫入（新增／更新／刪除）→ 父層重新載入名單 */
  @Output() changed = new EventEmitter<void>();

  readonly units = ['ICUA', 'ICUB', 'ICUD'];
  readonly modes: { key: IcuCandidateMode; label: string }[] = [
    { key: '', label: '未定' }, { key: 'HD', label: 'HD' }, { key: 'SLED', label: 'SLED' }, { key: 'CVVHDF', label: 'CVVHDF' },
  ];
  readonly urgencies = ['今日', '24 小時內', '觀察中'];
  readonly accessOptions = ['無', '待放', '已放'];
  readonly activeStatuses: IcuCandidateStatus[] = ['觀察中', '已排定'];
  readonly closeStatuses: IcuCandidateStatus[] = ['已開始透析', '不需透析', '轉出／死亡'];

  readonly indicationOptions = signal<string[]>([]);
  readonly riskItems = signal<IcuCandidateRiskItem[]>([]);

  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  // 帶入查詢
  lookupQuery = '';
  readonly lookupItems = signal<IcuCandidateLookupItem[]>([]);
  readonly lookupDone = signal(false);
  readonly lookupSnapshot = signal<string | null>(null);
  private lookupTimer: ReturnType<typeof setTimeout> | null = null;

  form: IcuCandidatePayload = this.blankForm();
  /** 勾選項用 signal 鏡射，模式提示才會即時重算 */
  readonly riskFlags = signal<ReadonlySet<string>>(new Set());

  readonly suggestion = computed(() => {
    const flags = this.riskFlags();
    let score = 0;
    for (const item of this.riskItems()) {
      if (!flags.has(item.key) || (item.needs && !flags.has(item.needs))) continue;
      score += item.pts;
    }
    const direct = flags.has('brainInjury');
    const mode = direct || score >= 4 ? 'CVVHDF' : score >= 2 ? 'SLED' : 'HD';
    return { mode, score, direct, any: flags.size > 0 };
  });

  get isEdit(): boolean {
    return !!this.candidate;
  }

  ngOnInit(): void {
    void this.akiApi.getIcuCandidateOptions().then((o) => {
      this.indicationOptions.set(o.indications);
      this.riskItems.set(o.riskItems);
    }).catch(() => this.error.set('載入表單選項失敗，請關閉後重試'));

    const c = this.candidate;
    if (c) {
      this.form = {
        mrn: c.mrn, name: c.name, unit: c.unit, bedNo: c.bedNo, physician: c.physician,
        consultPhysician: c.consultPhysician, consultDate: c.consultDate, plannedMode: c.plannedMode,
        indications: [...c.indications], riskFlags: [...c.riskFlags], urgency: c.urgency,
        vascularAccess: c.vascularAccess, note: c.note, status: c.status,
      };
      this.riskFlags.set(new Set(c.riskFlags));
    } else {
      const user = this.auth.currentUser() as { name?: string; title?: string } | null;
      if (user?.title?.includes('醫師')) this.form.consultPhysician = user.name || '';
    }
  }

  private blankForm(): IcuCandidatePayload {
    const now = new Date();
    return {
      mrn: '', name: '', unit: '', bedNo: '', physician: '', consultPhysician: '',
      consultDate: `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`,
      plannedMode: '', indications: [], riskFlags: [], urgency: '', vascularAccess: '', note: '', status: '觀察中',
    };
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closed.emit();
  }

  // ---------- 從住院快照帶入 ----------

  onLookupInput(): void {
    if (this.lookupTimer) clearTimeout(this.lookupTimer);
    const q = this.lookupQuery.trim();
    if (q.length < 2) {
      this.lookupItems.set([]);
      this.lookupDone.set(false);
      return;
    }
    this.lookupTimer = setTimeout(() => void this.runLookup(q), 300);
  }

  private async runLookup(q: string): Promise<void> {
    try {
      const res = await this.akiApi.lookupIcuCandidate(q);
      if (q !== this.lookupQuery.trim()) return; // 使用者已經又打了別的字
      this.lookupItems.set(res.items);
      this.lookupSnapshot.set(res.snapshotDate || null);
      this.lookupDone.set(true);
    } catch {
      this.lookupItems.set([]);
      this.lookupDone.set(true);
    }
  }

  applyLookup(item: IcuCandidateLookupItem): void {
    if (item.alreadyListed) return;
    this.form.mrn = item.mrn;
    this.form.name = item.name;
    this.form.physician = item.physician || '';
    this.form.unit = item.unit;
    this.form.bedNo = item.unit ? item.bedNo : '';
    this.lookupItems.set([]);
    this.lookupDone.set(false);
    this.lookupQuery = '';
    // 快照顯示不在 ICU：本名單只收 ICU → 請使用者自己確認床位
    this.error.set(item.unit ? null : `住院資料顯示 ${item.name} 在「${[item.ward, item.bed].filter(Boolean).join(' ')}」，不在 ICU。若已轉入 ICU，請自行選擇加護單位與床號。`);
  }

  // ---------- 勾選 ----------

  toggleIndication(value: string): void {
    const i = this.form.indications.indexOf(value);
    if (i >= 0) this.form.indications.splice(i, 1);
    else this.form.indications.push(value);
  }

  hasIndication(value: string): boolean {
    return this.form.indications.includes(value);
  }

  riskDisabled(item: IcuCandidateRiskItem): boolean {
    return !!item.needs && !this.riskFlags().has(item.needs);
  }

  toggleRisk(item: IcuCandidateRiskItem): void {
    if (this.riskDisabled(item)) return;
    const next = new Set(this.riskFlags());
    if (next.has(item.key)) {
      next.delete(item.key);
      // 取消「使用升壓劑」→ 一併取消依附它的「NE 高劑量」
      for (const other of this.riskItems()) if (other.needs === item.key) next.delete(other.key);
    } else {
      next.add(item.key);
    }
    this.riskFlags.set(next);
    this.form.riskFlags = [...next];
  }

  riskPts(item: IcuCandidateRiskItem): string {
    return item.direct ? '直接' : `+${item.pts}`;
  }

  // ---------- 存檔／結案／刪除 ----------

  async save(statusOverride?: IcuCandidateStatus): Promise<void> {
    if (!this.form.mrn.trim() || !this.form.name.trim()) { this.error.set('請填病歷號與姓名'); return; }
    if (!this.form.unit) { this.error.set('請選擇加護單位（本名單只收 ICU 病人）'); return; }
    this.saving.set(true);
    this.error.set(null);
    try {
      const payload = { ...this.form, status: statusOverride ?? this.form.status };
      if (this.candidate) {
        const { mrn: _mrn, ...patch } = payload; // 病歷號建立後不改（換病人請另建一筆）
        await this.akiApi.updateIcuCandidate(this.candidate.id, patch);
      } else {
        await this.akiApi.createIcuCandidate(payload);
      }
      this.changed.emit();
      this.closed.emit();
    } catch (e: any) {
      this.error.set(e?.error?.message || e?.message || '儲存失敗');
    } finally {
      this.saving.set(false);
    }
  }

  closeCase(status: IcuCandidateStatus): void {
    if (!window.confirm(`確定把 ${this.form.name} 結案為「${status}」嗎？結案後會從待透析評估名單移除。`)) return;
    void this.save(status);
  }

  async remove(): Promise<void> {
    if (!this.candidate) return;
    if (!window.confirm(`確定刪除 ${this.candidate.name} 這筆紀錄嗎？\n刪除只用於誤建；病人不需透析或已開始透析請改用「結案」。`)) return;
    this.saving.set(true);
    try {
      await this.akiApi.deleteIcuCandidate(this.candidate.id);
      this.changed.emit();
      this.closed.emit();
    } catch (e: any) {
      this.error.set(e?.error?.message || e?.message || '刪除失敗');
    } finally {
      this.saving.set(false);
    }
  }
}
