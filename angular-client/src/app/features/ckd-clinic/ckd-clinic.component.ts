import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CkdApiService, CkdStatus } from '@app/core/services/ckd-api.service';

/**
 * 門診 CKD 收案追蹤（Angular 重寫版）
 * 2026-09-15 階段 0：頁面骨架＋後端狀態卡（資料表筆數、判定參數、階段進度）。
 * 功能邏輯照「CKD 收案追蹤工作台·部北版」單機版，分階段搬入；計畫見 docs/2026-09-15-ckd-clinic-tab-plan.md。
 */
@Component({
  selector: 'app-ckd-clinic',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './ckd-clinic.component.html',
  styleUrl: './ckd-clinic.component.css',
})
export class CkdClinicComponent implements OnInit {
  private readonly ckdApi = inject(CkdApiService);

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly status = signal<CkdStatus | null>(null);

  /** 判定參數顯示用標籤 */
  readonly settingLabels: { key: keyof CkdStatus['settings']; label: string; unit?: string }[] = [
    { key: 'preGap', label: 'Pre-ESRD 追蹤間隔', unit: '天' },
    { key: 'earlyNew', label: 'Early-CKD 新收案→首次追蹤', unit: '天' },
    { key: 'earlyGap', label: 'Early-CKD 追蹤間隔', unit: '天' },
    { key: 'dmGap', label: 'DKD 追蹤間隔', unit: '天' },
    { key: 'over', label: '逾期門檻', unit: '天' },
    { key: 'labWin', label: '檢驗回溯視窗', unit: '±天' },
    { key: 'dept', label: '門診科別' },
    { key: 'recallGrace', label: '召回寬限', unit: '天' },
    { key: 'alertWin', label: '異常檢驗掃描', unit: '天' },
    { key: 'rrtEgfr', label: '透析準備 eGFR 門檻' },
  ];

  ngOnInit(): void {
    this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.status.set(await this.ckdApi.getStatus());
    } catch (e: any) {
      this.error.set(e?.error?.message || e?.message || '載入門診 CKD 收案狀態失敗');
    } finally {
      this.loading.set(false);
    }
  }

  settingValue(key: keyof CkdStatus['settings']): string {
    const s = this.status()?.settings;
    if (!s) return '';
    const v = s[key];
    if (typeof v === 'boolean') return v ? '是' : '否';
    return String(v ?? '');
  }

  phaseClass(status: string): string {
    return status === 'done' ? 'done' : status === 'wip' ? 'wip' : 'todo';
  }

  phaseLabel(status: string): string {
    return status === 'done' ? '完成' : status === 'wip' ? '進行中' : '待做';
  }

  /** 'YYYY-MM-DD HH:MM:SS' → 'MM/DD HH:MM' */
  fmtTime(s: string | null | undefined): string {
    if (!s) return '';
    const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
    return m ? `${m[2]}/${m[3]} ${m[4]}:${m[5]}` : String(s);
  }
}
