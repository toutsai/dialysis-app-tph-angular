import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CkdApiService, CkdHandout } from '@app/core/services/ckd-api.service';
import { AuthService } from '@app/core/services/auth.service';
import { HANDOUT_CSS, buildHandoutBodyHtml, exportHandoutWordDoc } from '../ckd-handout-word';

const PREVIEW_STYLE_ID = 'ckd-handout-preview-style';

/**
 * 門診 CKD：檢驗報告衛教單匯出面板（病人彙整視窗第二階段，2026-09-20）
 * 選報告日 → 預覽（與 Word 同一份 HTML）→ 下載 Word；個管師留言可同時存成一筆「追蹤紀錄·衛教」，
 * 衛教紀錄時間軸就會留下「哪天給了哪張衛教單」。
 * 衛教單上的文字與異常判定都在後端（services/ckd/handout.js，使用者審定的草案），本元件不做任何臨床判斷。
 */
@Component({
  selector: 'app-ckd-handout-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ckd-handout-panel.component.html',
  styleUrl: './ckd-handout-panel.component.css',
})
export class CkdHandoutPanelComponent implements OnChanges {
  private readonly ckdApi = inject(CkdApiService);
  private readonly auth = inject(AuthService);

  @Input() mrn = '';
  @Output() closed = new EventEmitter<void>();
  /** 已存成一筆衛教紀錄（外層要重抓紀錄與衛教時間軸） */
  @Output() recorded = new EventEmitter<void>();

  readonly today = new Date().toLocaleDateString('sv-SE');
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly data = signal<CkdHandout | null>(null);
  readonly report = signal('');
  readonly message = signal('');
  readonly saveRecord = signal(true);
  readonly busy = signal(false);
  readonly done = signal<string | null>(null);

  private seq = 0;

  readonly educator = computed(() => this.auth.currentUser()?.name || '');
  /** 預覽 = 匯出的同一份 HTML（Angular 會清洗 innerHTML；內容只有表格與 class，不受影響） */
  readonly previewHtml = computed(() => {
    const d = this.data();
    return d ? buildHandoutBodyHtml(d, { message: this.message(), educator: this.educator(), today: this.today }) : '';
  });

  constructor() {
    // 預覽內容是 innerHTML，吃不到元件的封裝樣式 → 把同一份衛教單 CSS 加上 .ho-preview 前綴後掛到 head（只掛一次）
    if (typeof document !== 'undefined' && !document.getElementById(PREVIEW_STYLE_ID)) {
      const el = document.createElement('style');
      el.id = PREVIEW_STYLE_ID;
      el.textContent = HANDOUT_CSS.split('}').filter((r) => r.trim()).map((r) => `.ho-preview ${r}}`).join('');
      document.head.appendChild(el);
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['mrn']) {
      this.report.set(''); this.message.set(''); this.saveRecord.set(true); this.done.set(null);
      void this.load();
    }
  }

  async load(report = ''): Promise<void> {
    if (!this.mrn) return;
    const seq = ++this.seq;
    this.loading.set(true);
    this.error.set(null);
    try {
      const d = await this.ckdApi.getPatientHandout(this.mrn, report || undefined);
      if (seq !== this.seq) return;
      this.data.set(d);
      this.report.set(d.handout?.reportDate || '');
    } catch (e: any) {
      if (seq !== this.seq) return;
      this.error.set(e?.error?.message || e?.message || '產生衛教單內容失敗');
    } finally {
      if (seq === this.seq) this.loading.set(false);
    }
  }

  onReportChange(v: string): void {
    this.done.set(null);
    void this.load(v);
  }

  roc(s: string | null | undefined): string {
    const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${String(+m[1] - 1911).padStart(3, '0')}/${m[2]}/${m[3]}` : '—';
  }

  /** 存進衛教紀錄的內容：哪一天的報告、提醒了哪些項目、留言 */
  private recordContent(d: CkdHandout): string {
    const h = d.handout!;
    const items = h.cautions.map((c) => `${c.title}${c.dir === 'H' ? '偏高' : '偏低'}`);
    const msg = this.message().trim();
    return `給予檢驗報告衛教單（報告日 ${this.roc(h.reportDate)}）。注意項目：${items.length ? items.join('、') : '無'}。` + (msg ? `留言：${msg}` : '');
  }

  async download(): Promise<void> {
    const d = this.data();
    if (!d || !d.handout || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      exportHandoutWordDoc(d, { message: this.message(), educator: this.educator(), today: this.today });
      if (this.saveRecord()) {
        await this.ckdApi.createRecord(this.mrn, 'note', { at: this.today, cat: '衛教', content: this.recordContent(d), author: this.educator() });
        // 同一張單再下載一次不要重複存：存過就自動取消勾選，要再存請自己勾回來
        this.saveRecord.set(false);
        this.done.set('已下載，並存成一筆衛教紀錄。');
        this.recorded.emit();
      } else {
        this.done.set('已下載。');
      }
    } catch (e: any) {
      this.error.set('Word 已下載，但衛教紀錄沒有存成功：' + (e?.error?.message || e?.message || '未知錯誤'));
    } finally {
      this.busy.set(false);
    }
  }
}
