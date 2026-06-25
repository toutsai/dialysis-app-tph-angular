import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiManagerService, type ApiManager, type FirestoreRecord } from '@services/api-manager.service';
// Standalone 版：已移除 Firebase

@Component({
  selector: 'app-marquee-banner',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './marquee-banner.component.html',
  styleUrl: './marquee-banner.component.css'
})
export class MarqueeBannerComponent implements OnInit, OnDestroy {
  private readonly apiManagerService = inject(ApiManagerService);
  private readonly marqueeApi: ApiManager<FirestoreRecord>;
  private pollingTimer: any = null;

  marqueeContent = '';

  constructor() {
    this.marqueeApi = this.apiManagerService.create<FirestoreRecord>('marquee_settings');
  }

  async ngOnInit(): Promise<void> {
    await this.fetchMarquee();
    // Poll every 30 seconds for updates
    this.pollingTimer = setInterval(() => this.fetchMarquee(), 30000);
  }

  private async fetchMarquee(): Promise<void> {
    try {
      const all = await this.marqueeApi.fetchAll();
      const sorted = (all as any[]).sort((a: any, b: any) => {
        const aDate = typeof a.updatedAt === 'string' ? a.updatedAt : '';
        const bDate = typeof b.updatedAt === 'string' ? b.updatedAt : '';
        return bDate.localeCompare(aDate);
      });
      if (sorted.length > 0) {
        this.marqueeContent = sorted[0].content || '';
      }
    } catch (err) {
      console.error('載入跑馬燈失敗:', err);
    }
  }

  ngOnDestroy(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }
}

