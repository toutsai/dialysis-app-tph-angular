import { Component, HostListener, OnDestroy, OnInit, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '@app/core/services/api.service';
import { AuthService } from '@app/core/services/auth.service';
interface BackupEvent { at: string; type: string; backupFile?: string; message?: string; sizeBytes?: number; verifiedAt?: string; }
export interface BackupHealth {
  lastAttempt: BackupEvent | null; lastSuccess: BackupEvent | null; lastFailure: BackupEvent | null;
  database: { sizeBytes: number | null; walBytes: number | null };
  backups: { directoryAvailable: boolean; trackedCount: number; availableCount: number; missingCount: number; unsafeCount: number; totalBytes: number };
  verification: { checkedAt: string; result: string; backupFile?: string; message?: string } | null;
  queue: { active: boolean; waiting: number }; retentionWarnings?: { id: string; message: string }[];
}
@Component({ selector: 'app-backup', standalone: true, imports: [CommonModule], templateUrl: './backup.component.html', changeDetection: ChangeDetectionStrategy.Eager,
 styleUrl: './backup.component.css' })
export class BackupComponent implements OnInit, OnDestroy {
  readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  readonly health = signal<BackupHealth | null>(null);
  readonly loading = signal(false);
  readonly creating = signal(false);
  readonly error = signal('');
  readonly message = signal('');
  readonly checkedAt = signal<Date | null>(null);
  private request = 0;
  private destroyed = false;
  get busy(): boolean { return this.loading() || this.creating(); }
  ngOnInit(): void { void this.refresh(); }
  ngOnDestroy(): void { this.destroyed = true; ++this.request; }
  canLeave(): boolean { return !this.creating(); }
  @HostListener('window:beforeunload', ['$event']) beforeUnload(event: BeforeUnloadEvent): void {
    if (this.creating()) { event.preventDefault(); event.returnValue = ''; }
  }
  bytes(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value)) return '未知';
    if (value < 1024) return `${value} B`;
    const units = ['KB', 'MB', 'GB', 'TB']; let amount = value / 1024, index = 0;
    while (amount >= 1024 && index < units.length - 1) { amount /= 1024; ++index; }
    return `${amount.toFixed(1)} ${units[index]}`;
  }
  verificationLabel(result: string | undefined): string {
    return ({ ok: '驗證通過', failed: '驗證失敗', missing: '備份檔案缺失', unsafe: '備份路徑異常' } as Record<string, string>)[result || ''] || '尚無驗證結果';
  }
  typeLabel(type: string): string { return type === 'manual' ? '手動備份' : type === 'auto' ? '自動備份' : type; }
  async refresh(): Promise<void> {
    if (this.busy) return;
    if (!this.auth.isAdmin()) { this.error.set('僅管理員可檢視備份狀態。'); return; }
    await this.loadHealth();
  }
  private async loadHealth(): Promise<void> {
    const request = ++this.request; this.loading.set(true); this.error.set('');
    try {
      const result = await firstValueFrom(this.api.get<BackupHealth>('/system/backup-health'));
      if (this.destroyed || request !== this.request) return;
      this.health.set(result); this.checkedAt.set(new Date());
    } catch (error: any) {
      if (!this.destroyed && request === this.request) this.error.set(error?.error?.message || '無法讀取備份狀態，請重新整理。');
    } finally { if (!this.destroyed && request === this.request) this.loading.set(false); }
  }
  async createBackup(): Promise<void> {
    if (this.busy || !this.auth.isAdmin()) return;
    this.creating.set(true); this.error.set(''); this.message.set('');
    try {
      const result = await firstValueFrom(this.api.post<{ success: boolean; backupFile: string }>('/system/backup', {}));
      if (this.destroyed) return;
      if (!result.success) throw new Error('備份未完成');
      this.message.set(`備份已完成：${result.backupFile}`);
      await this.loadHealth();
    } catch (error: any) {
      if (!this.destroyed) this.error.set(error?.error?.message || '本次備份結果未確認，請重新整理狀態；確認後可再試一次。');
    } finally { if (!this.destroyed) this.creating.set(false); }
  }
}
