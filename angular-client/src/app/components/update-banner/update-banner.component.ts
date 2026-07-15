// 前端版本更新橫幅
// 輪詢後端 /api/version（讀 index.html mtime，每次 ng build 會變），
// 偵測到新部署 → 倒數後自動 location.reload()；若有彈窗/表單開著則暫停倒數，待關閉再續。
import { Component, OnInit, OnDestroy, inject, signal, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-update-banner',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (visible()) {
      <div class="update-banner" role="alert">
        <i class="fas fa-arrow-rotate-right spin-slow"></i>
        @if (paused()) {
          <span class="msg">系統已更新新版本，偵測到視窗開啟中，將於關閉後自動套用。</span>
        } @else {
          <span class="msg">系統已更新新版本，將於 <b>{{ countdown() }}</b> 秒後自動套用。</span>
        }
        <button class="btn btn-now" (click)="reloadNow()">立即更新</button>
        <button class="btn btn-later" (click)="snooze()">稍後</button>
      </div>
    }
  `,
  styles: [`
    .update-banner {
      position: fixed; top: 0; left: 0; right: 0; z-index: 100000;
      display: flex; align-items: center; justify-content: center; gap: 12px;
      padding: 10px 16px; background: #1e3a5f; color: #fff;
      font-size: 14px; box-shadow: 0 2px 8px rgba(0,0,0,.25);
    }
    .update-banner .msg b { font-size: 16px; }
    .update-banner .btn {
      border: none; border-radius: 4px; padding: 6px 14px; cursor: pointer;
      font-size: 13px; font-weight: 600;
    }
    .btn-now { background: #ffb703; color: #1e3a5f; }
    .btn-later { background: transparent; color: #cfe0f5; border: 1px solid #5a7aa0; }
    .spin-slow { animation: ub-spin 2.5s linear infinite; }
    @keyframes ub-spin { to { transform: rotate(360deg); } }
  `],
})
export class UpdateBannerComponent implements OnInit, OnDestroy {
  private readonly zone = inject(NgZone);

  readonly visible = signal(false);
  readonly countdown = signal(60);
  readonly paused = signal(false);

  private readonly POLL_INTERVAL = 180_000; // 3 分鐘輪詢
  private readonly COUNTDOWN_START = 60;     // 偵測後倒數秒數
  private readonly SNOOZE_MS = 600_000;      // 「稍後」延後 10 分鐘

  private bootBuild: string | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private snoozeTimer: ReturnType<typeof setTimeout> | null = null;
  private triggered = false;

  async ngOnInit(): Promise<void> {
    this.bootBuild = await this.fetchBuild();
    // 取不到版本（端點未部署/離線）時靜默停用，不影響使用
    if (!this.bootBuild) return;
    this.zone.runOutsideAngular(() => {
      this.pollTimer = setInterval(() => this.poll(), this.POLL_INTERVAL);
    });
  }

  ngOnDestroy(): void {
    this.clearTimer(this.pollTimer);
    this.clearTimer(this.tickTimer);
    if (this.snoozeTimer) clearTimeout(this.snoozeTimer);
  }

  private async fetchBuild(): Promise<string | null> {
    try {
      const res = await fetch('/api/version', { cache: 'no-store' });
      if (!res.ok) return null;
      const data = await res.json();
      return data?.build != null ? String(data.build) : null;
    } catch {
      return null;
    }
  }

  private async poll(): Promise<void> {
    if (this.triggered) return;
    const build = await this.fetchBuild();
    if (build && this.bootBuild && build !== this.bootBuild) {
      this.zone.run(() => this.startCountdown());
    }
  }

  private startCountdown(): void {
    this.triggered = true;
    this.clearTimer(this.pollTimer);
    this.countdown.set(this.COUNTDOWN_START);
    this.visible.set(true);
    this.zone.runOutsideAngular(() => {
      this.tickTimer = setInterval(() => this.tick(), 1000);
    });
  }

  // 整個 tick 在 zone 外跑，只有畫面真的要變（暫停狀態翻轉/倒數數字）才進 zone。
  // 勿改回每秒 zone.run：彈窗開著時每秒強制全站變更偵測，弱 GPU 電腦會讓開啟中的視窗閃爍。
  private tick(): void {
    // 有彈窗/表單開著 → 暫停倒數，避免清掉未存資料
    if (this.isModalOpen()) {
      if (!this.paused()) this.zone.run(() => this.paused.set(true));
      return;
    }
    this.zone.run(() => {
      this.paused.set(false);
      const next = this.countdown() - 1;
      if (next <= 0) {
        this.reloadNow();
      } else {
        this.countdown.set(next);
      }
    });
  }

  private isModalOpen(): boolean {
    return !!document.querySelector('.modal-overlay, .dialog-overlay');
  }

  reloadNow(): void {
    this.clearTimer(this.tickTimer);
    // index.html 為 no-cache，reload 必取最新版 → 載入新 bundle
    location.reload();
  }

  snooze(): void {
    this.visible.set(false);
    this.paused.set(false);
    this.clearTimer(this.tickTimer);
    this.triggered = false;
    if (this.snoozeTimer) clearTimeout(this.snoozeTimer);
    // 延後後再次確認是否仍為舊版，是則重新倒數
    this.snoozeTimer = setTimeout(async () => {
      const build = await this.fetchBuild();
      if (build && this.bootBuild && build !== this.bootBuild) {
        this.zone.run(() => this.startCountdown());
      }
    }, this.SNOOZE_MS);
  }

  private clearTimer(t: ReturnType<typeof setInterval> | null): void {
    if (t) clearInterval(t);
  }
}
