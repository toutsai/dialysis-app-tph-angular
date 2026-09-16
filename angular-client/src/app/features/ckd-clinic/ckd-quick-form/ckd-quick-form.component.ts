import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CkdApiService, CkdRecField, CkdRecType, CkdRecTypeDef, CkdRecord } from '@app/core/services/ckd-api.service';

/**
 * 欄位定義的模組層級快取。
 * 召回／異常／管線三個清單每一列都可能展開一張表單，不能每列都打 GET /ckd/records/types。
 * 失敗時清掉快取，讓下一次展開重試。
 */
let typesCache: Promise<CkdRecTypeDef[]> | null = null;
export function loadCkdRecTypes(api: CkdApiService): Promise<CkdRecTypeDef[]> {
  if (!typesCache) {
    typesCache = api.getRecordTypes().then((r) => r.types).catch((e) => { typesCache = null; throw e; });
  }
  return typesCache;
}

/**
 * 門診 CKD：列內快速紀錄表單（原版 recall.js 的 quickFormHtml／quickFormRead／quickFormSave）
 * 召回（contact）、異常（contact）、透析準備管線（sdm／access）三處共用。
 * 欄位定義來自後端 REC_TYPES；渲染規則照原版：5 欄 grid、select 第一個 option 空值、
 * textarea 刻意渲染成 <input type="text">（欄位窄）、checks 多勾選、必填 label 加 *。
 * 與原版差異：驗證訊息顯示在表單內，不用 alert（比照階段 3 的決策）。
 */
@Component({
  selector: 'app-ckd-quick-form',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ckd-quick-form.component.html',
  styleUrl: './ckd-quick-form.component.css',
})
export class CkdQuickFormComponent implements OnChanges {
  private readonly ckdApi = inject(CkdApiService);

  @Input() type: CkdRecType = 'contact';
  @Input() mrn = '';
  /** 預帶值，例如 { at: 今天, note: '標題 · 說明' } */
  @Input() defaults: Record<string, unknown> = {};

  @Output() saved = new EventEmitter<CkdRecord>();
  @Output() cancelled = new EventEmitter<void>();

  readonly def = signal<CkdRecTypeDef | null>(null);
  readonly form = signal<Record<string, any>>({});
  readonly formError = signal<string | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  /** 原版按鈕文字：聯絡紀錄「儲存聯絡紀錄」，其餘「儲存」 */
  readonly saveText = signal('儲存');

  private initSeq = 0;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['type'] || changes['mrn'] || changes['defaults']) void this.init();
  }

  private async init(): Promise<void> {
    const seq = ++this.initSeq;
    this.saveText.set(this.type === 'contact' ? '儲存聯絡紀錄' : '儲存');
    this.formError.set(null);
    this.loading.set(true);
    try {
      const types = await loadCkdRecTypes(this.ckdApi);
      if (seq !== this.initSeq) return;
      const def = types.find((t) => t.key === this.type) || null;
      this.def.set(def);
      const d = this.defaults || {};
      const init: Record<string, any> = {};
      for (const f of def?.fields || []) {
        const v = d[f.k];
        init[f.k] = f.type === 'checks' ? (Array.isArray(v) ? [...v] : []) : (v == null ? '' : String(v));
      }
      this.form.set(init);
    } catch (e: any) {
      if (seq !== this.initSeq) return;
      this.formError.set(e?.error?.message || e?.message || '載入表單欄位失敗');
    } finally {
      if (seq === this.initSeq) this.loading.set(false);
    }
  }

  setField(key: string, value: any): void {
    this.form.set({ ...this.form(), [key]: value });
  }

  isChecked(key: string, opt: string): boolean {
    const v = this.form()[key];
    return Array.isArray(v) && v.indexOf(opt) >= 0;
  }

  toggleCheck(key: string, opt: string, on: boolean): void {
    const cur: string[] = Array.isArray(this.form()[key]) ? [...this.form()[key]] : [];
    const i = cur.indexOf(opt);
    if (on && i < 0) cur.push(opt);
    if (!on && i >= 0) cur.splice(i, 1);
    this.setField(key, cur);
  }

  isWide(f: CkdRecField): boolean {
    return f.type === 'textarea' || f.type === 'checks';
  }

  async save(): Promise<void> {
    const def = this.def();
    if (!def || this.saving()) return;
    const data = this.form();
    const missing = def.fields
      .filter((f) => f.req && (f.type === 'checks' ? !(data[f.k] || []).length : !String(data[f.k] ?? '').trim()))
      .map((f) => f.t);
    if (missing.length) { this.formError.set('請填：' + missing.join('、')); return; }
    this.saving.set(true);
    this.formError.set(null);
    try {
      const r = await this.ckdApi.createRecord(this.mrn, def.key, data);
      this.saved.emit(r.record);
    } catch (e: any) {
      this.formError.set(e?.error?.message || e?.message || '儲存失敗');
    } finally {
      this.saving.set(false);
    }
  }
}
