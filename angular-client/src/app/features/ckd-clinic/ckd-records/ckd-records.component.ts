import { Component, ElementRef, EventEmitter, OnInit, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  CkdApiService,
  CkdPatientSummary,
  CkdRecField,
  CkdRecType,
  CkdRecTypeDef,
  CkdRecord,
  CkdRecordStats,
} from '@app/core/services/ckd-api.service';
import { ConfirmDialogComponent } from '@app/components/dialogs/confirm-dialog/confirm-dialog.component';

const ALL_LIMIT = 40;

interface PendingConfirm {
  title: string;
  message: string;
  confirmText: string;
  onOk: () => void;
}

/**
 * 門診 CKD：個案紀錄（原版第五區 #secE 的 Angular 版）
 * 八類紀錄（血管通路／RRT SDM／聯絡／外院收案查核／P 碼補登更正／收案狀態更正／不予收案／追蹤紀錄）。
 * 定位：個管師的工作備忘與判定更正，不是病歷；正式紀錄仍寫 HIS。
 * 欄位定義由後端 REC_TYPES 提供（GET /ckd/records/types），表單動態生成；判定更正三類與外院查核會即時改變 A／B 區判讀（父元件收 changed 後重判讀）。
 */
@Component({
  selector: 'app-ckd-records',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmDialogComponent],
  templateUrl: './ckd-records.component.html',
  styleUrl: './ckd-records.component.css',
})
export class CkdRecordsComponent implements OnInit {
  private readonly ckdApi = inject(CkdApiService);
  private readonly host = inject(ElementRef<HTMLElement>);

  /** 任何紀錄新增／修改／刪除後通知父元件重判讀 */
  @Output() changed = new EventEmitter<void>();

  readonly types = signal<CkdRecTypeDef[]>([]);
  readonly typeMap = computed(() => Object.fromEntries(this.types().map((t) => [t.key, t])) as Record<string, CkdRecTypeDef>);
  readonly stats = signal<CkdRecordStats | null>(null);
  readonly error = signal<string | null>(null);
  readonly loading = signal(false);
  readonly flash = signal(false);

  // ---------- 病人 ----------
  readonly mrn = signal('');
  readonly summary = signal<CkdPatientSummary | null>(null);
  readonly allRecords = signal<CkdRecord[]>([]);
  readonly allTotal = computed(() => this.stats()?.total || 0);
  readonly query = signal('');
  readonly results = signal<{ mrn: string; name: string }[]>([]);
  readonly showResults = signal(false);
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private searchSeq = 0;

  // ---------- 表單 ----------
  readonly formType = signal<CkdRecType | null>(null);
  readonly editing = signal<CkdRecord | null>(null);
  readonly form = signal<Record<string, any>>({});
  readonly formError = signal<string | null>(null);
  readonly saving = signal(false);
  readonly formDef = computed(() => { const t = this.formType(); return t ? this.typeMap()[t] || null : null; });

  readonly confirmBox = signal<PendingConfirm | null>(null);

  /** 統計條（原版 #tallyE） */
  readonly tally = computed(() => {
    const s = this.stats();
    if (!s) return [];
    const n = (k: CkdRecType) => s.byType[k] || 0;
    return [
      { k: '紀錄總數', v: s.total, c: '' },
      { k: '血管通路', v: n('access'), c: 'g1' },
      { k: 'SDM', v: n('sdm'), c: 'g2' },
      { k: '追蹤紀錄', v: n('note'), c: 'g4' },
      { k: '有通路紀錄人數', v: s.accessPersons, c: 'g1' },
      { k: 'SDM 待追事項', v: s.sdmFollow, c: s.sdmFollow ? 'wait' : '' },
    ];
  });

  ngOnInit(): void {
    void this.init();
  }

  private async init(): Promise<void> {
    try {
      const [t] = await Promise.all([this.ckdApi.getRecordTypes(), this.refreshLists()]);
      this.types.set(t.types);
    } catch (e: any) {
      this.error.set(e?.error?.message || e?.message || '載入個案紀錄失敗');
    }
  }

  /** 重新抓統計＋（未選病人）全部紀錄／（已選）病人摘要 */
  async refreshLists(): Promise<void> {
    this.loading.set(true);
    try {
      const mrn = this.mrn();
      const [st, list, sum] = await Promise.all([
        this.ckdApi.getRecordStats(),
        mrn ? Promise.resolve(null) : this.ckdApi.listRecords({ limit: ALL_LIMIT }),
        mrn ? this.ckdApi.getPatientSummary(mrn) : Promise.resolve(null),
      ]);
      this.stats.set(st);
      if (list) this.allRecords.set(list.records);
      if (sum) this.summary.set(sum);
    } catch (e: any) {
      this.error.set(e?.error?.message || e?.message || '載入個案紀錄失敗');
    } finally {
      this.loading.set(false);
    }
  }

  // ---------- 對外：從 A／B 區跳進來（原版 gotoRecords） ----------

  /** 切到某病人；newType 有值時直接開該類型的新增表單 */
  open(mrn: string, newType: CkdRecType | null = null): void {
    const go = () => {
      void this.selectPatient(mrn).then(() => { if (newType) this.startAdd(newType); });
      this.host.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
      this.flash.set(true);
      setTimeout(() => this.flash.set(false), 1200);
    };
    this.guardUnsaved(mrn, go);
  }

  /** 表單開著又要切病人 → 先問（原版 syncRec 的 confirm） */
  private guardUnsaved(targetMrn: string, go: () => void): void {
    if (this.formType() && this.mrn() && this.mrn() !== targetMrn) {
      this.confirmBox.set({
        title: '尚未儲存的紀錄表單', message: '下方有一筆尚未儲存的紀錄表單。切換到其他病人會放棄它，要繼續嗎？', confirmText: '放棄並切換',
        onOk: () => { this.cancelForm(); go(); },
      });
      return;
    }
    go();
  }

  async selectPatient(mrn: string): Promise<void> {
    const m = String(mrn || '').trim().replace(/^0+/, '');
    this.showResults.set(false);
    this.error.set(null);
    if (!m) { this.clearPatient(); return; }
    if (m !== this.mrn()) this.cancelForm();
    this.mrn.set(m);
    this.query.set(m);
    this.loading.set(true);
    try {
      const sum = await this.ckdApi.getPatientSummary(m);
      this.summary.set(sum);
      this.query.set(sum.name ? `${m} ${sum.name}` : m);
    } catch (e: any) {
      this.error.set(e?.error?.message || e?.message || '讀取病人摘要失敗');
    } finally {
      this.loading.set(false);
    }
  }

  clearPatient(): void {
    this.guardUnsaved('', () => {
      this.mrn.set('');
      this.summary.set(null);
      this.query.set('');
      this.results.set([]);
      this.showResults.set(false);
      void this.refreshLists();
    });
  }

  // ---------- 病人搜尋（病歷號前綴或姓名子字串） ----------

  onQueryInput(value: string): void {
    this.query.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    const q = value.trim();
    if (!q) { this.results.set([]); this.showResults.set(false); return; }
    const seq = ++this.searchSeq;
    this.searchTimer = setTimeout(async () => {
      try {
        const r = await this.ckdApi.searchPatients(q);
        if (seq !== this.searchSeq) return;
        this.results.set(r.patients);
        this.showResults.set(true);
      } catch { /* 搜尋失敗不擋輸入 */ }
    }, 220);
  }

  onQueryEnter(): void {
    const q = this.query().trim();
    const hit = this.results()[0];
    if (hit) { this.pick(hit.mrn); return; }
    const m = q.split(/\s+/)[0];
    if (/^[0-9A-Za-z-]{1,15}$/.test(m)) this.guardUnsaved(m, () => { void this.selectPatient(m); });
  }

  pick(mrn: string): void {
    this.guardUnsaved(mrn, () => { void this.selectPatient(mrn); });
  }

  hideResultsSoon(): void {
    setTimeout(() => this.showResults.set(false), 180);
  }

  // ---------- 表單 ----------

  startAdd(type: CkdRecType): void {
    if (!this.mrn()) { this.error.set('請先輸入病歷號或姓名選擇病人，再新增紀錄。'); return; }
    this.error.set(null);
    this.editing.set(null);
    this.formType.set(type);
    const def = this.typeMap()[type];
    const init: Record<string, any> = {};
    for (const f of def?.fields || []) init[f.k] = f.type === 'checks' ? [] : '';
    this.form.set(init);
    this.formError.set(null);
  }

  startEdit(r: CkdRecord): void {
    this.error.set(null);
    this.editing.set(r);
    this.formType.set(r.type);
    const def = this.typeMap()[r.type];
    const init: Record<string, any> = {};
    for (const f of def?.fields || []) {
      const v = r[f.k];
      init[f.k] = f.type === 'checks' ? (Array.isArray(v) ? [...v] : v ? String(v).split('、') : []) : (v == null ? '' : String(v));
    }
    this.form.set(init);
    this.formError.set(null);
  }

  cancelForm(): void {
    this.formType.set(null);
    this.editing.set(null);
    this.form.set({});
    this.formError.set(null);
  }

  setField(key: string, value: any): void {
    this.form.set({ ...this.form(), [key]: value });
  }

  isChecked(key: string, opt: string): boolean {
    const v = this.form()[key];
    return Array.isArray(v) && v.includes(opt);
  }

  toggleCheck(key: string, opt: string, on: boolean): void {
    const cur: string[] = Array.isArray(this.form()[key]) ? [...this.form()[key]] : [];
    const i = cur.indexOf(opt);
    if (on && i < 0) cur.push(opt);
    if (!on && i >= 0) cur.splice(i, 1);
    this.setField(key, cur);
  }

  async saveForm(): Promise<void> {
    const def = this.formDef();
    if (!def) return;
    const data = this.form();
    const missing = def.fields.filter((f) => f.req && (f.type === 'checks' ? !(data[f.k] || []).length : !String(data[f.k] ?? '').trim())).map((f) => f.t);
    if (missing.length) { this.formError.set('請填寫：' + missing.join('、')); return; }
    this.saving.set(true);
    this.formError.set(null);
    try {
      const ed = this.editing();
      if (ed) await this.ckdApi.updateRecord(ed.id, data);
      else await this.ckdApi.createRecord(this.mrn(), def.key, data);
      this.cancelForm();
      await this.refreshLists();
      this.changed.emit();
    } catch (e: any) {
      this.formError.set(e?.error?.message || e?.message || '儲存失敗');
    } finally {
      this.saving.set(false);
    }
  }

  askDelete(r: CkdRecord): void {
    const label = this.typeMap()[r.type]?.label || r.type;
    this.confirmBox.set({
      title: '刪除紀錄', message: `刪除這筆「${label}」紀錄？\n\n${r.when || ''} ${r.line || ''}`.trim(), confirmText: '刪除',
      onOk: () => { void this.doDelete(r); },
    });
  }

  private async doDelete(r: CkdRecord): Promise<void> {
    this.error.set(null);
    try {
      await this.ckdApi.deleteRecord(r.id);
      if (this.editing()?.id === r.id) this.cancelForm();
      await this.refreshLists();
      this.changed.emit();
    } catch (e: any) {
      this.error.set(e?.error?.message || e?.message || '刪除失敗');
    }
  }

  confirmOk(): void {
    const c = this.confirmBox();
    this.confirmBox.set(null);
    c?.onOk();
  }

  confirmCancel(): void {
    this.confirmBox.set(null);
  }

  // ---------- 顯示輔助（原版 recLine 卡片） ----------

  /** 卡片 chips：非 textarea、非 at 且有值的欄位 */
  chipFields(r: CkdRecord): { t: string; v: string }[] {
    const def = this.typeMap()[r.type];
    if (!def) return [];
    return def.fields
      .filter((f) => f.type !== 'textarea' && f.k !== 'at')
      .map((f) => ({ t: f.t, v: Array.isArray(r[f.k]) ? r[f.k].join('、') : (r[f.k] == null ? '' : String(r[f.k])) }))
      .filter((x) => x.v);
  }

  /** 卡片長文：有值的 textarea 欄位 */
  noteFields(r: CkdRecord): { t: string; v: string }[] {
    const def = this.typeMap()[r.type];
    if (!def) return [];
    return def.fields.filter((f) => f.type === 'textarea' && r[f.k]).map((f) => ({ t: f.t, v: String(r[f.k]) }));
  }

  isWide(f: CkdRecField): boolean {
    return f.type === 'textarea' || f.type === 'checks';
  }

  colorOf(type: string): string {
    return this.typeMap()[type]?.color || 'g4';
  }

  labelOf(type: string): string {
    return this.typeMap()[type]?.label || type;
  }

  roc(s: string | null | undefined): string {
    if (!s) return '—';
    const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${String(+m[1] - 1911).padStart(3, '0')}/${m[2]}/${m[3]}` : String(s);
  }

  /** 'YYYY-MM-DD HH:MM:SS' → 'YYYY-MM-DD HH:MM' */
  fmtTime(s: string | null | undefined): string {
    return s ? String(s).slice(0, 16) : '';
  }

  /** VPN 三態說明（原版待辦列的副標） */
  vpnLine(sum: CkdPatientSummary): { cls: string; text: string } {
    const e = sum.ext;
    if (!e) return { cls: 'v-none', text: '尚未查核 — 收案前必要動作' };
    if (e['result'] === '已於他院收案') return { cls: 'v-ext', text: `已於 ${e['hospital'] || '他院'} 收案（查於 ${e['at'] || ''}）— 本院不得重複收案` };
    if (e['result'] === '未於他院收案') return { cls: 'v-ok', text: `已查核 ${e['at'] || ''}，無他院收案，可收案` };
    return { cls: 'v-pend', text: `查詢中／待確認（${e['at'] || ''}）— 請補上結果` };
  }
}
