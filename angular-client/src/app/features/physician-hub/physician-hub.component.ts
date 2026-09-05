// 醫師專用（2026-09-05）：醫師班表 / 醫囑藥囑管理 / 醫師藥物調整 / 研究專用 四頁整合為主頁籤，
// 比照書記專用（features/inventory）：h1 與主頁籤同一列，內容區 .tab-host 內嵌既有元件（embedded 模式隱藏各自標題）。
// 舊路由 /physician-schedule、/orders、/med-adjustment、/research 保留為別名：載入本頁並帶對應頁籤（app.routes.ts data.tab）。
// 權限：頁面 DOCTOR_VIEW_ROLES（含書記 viewer，只看醫師班表）；醫囑/調藥/研究三頁籤只給 admin/contributor。
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '@services/auth.service';
import { PhysicianScheduleComponent } from '../physician-schedule/physician-schedule.component';
import { OrdersComponent } from '../orders/orders.component';
import { MedAdjustmentComponent } from '../med-adjustment/med-adjustment.component';
import { ResearchComponent } from '../research/research.component';

export type PhysicianHubTab = 'schedule' | 'orders' | 'med' | 'research';

interface HubTab {
  key: PhysicianHubTab;
  label: string;
  /** 只有 admin/contributor（醫師/專師）可用 */
  doctorOnly: boolean;
}

const TABS: HubTab[] = [
  { key: 'schedule', label: '醫師班表', doctorOnly: false },
  { key: 'orders', label: '醫囑藥囑管理', doctorOnly: true },
  { key: 'med', label: '醫師藥物調整', doctorOnly: true },
  { key: 'research', label: '研究專用', doctorOnly: true },
];

const DOCTOR_ROLES = ['admin', 'contributor'];

@Component({
  selector: 'app-physician-hub',
  standalone: true,
  imports: [CommonModule, PhysicianScheduleComponent, OrdersComponent, MedAdjustmentComponent, ResearchComponent],
  templateUrl: './physician-hub.component.html',
  styleUrls: ['./physician-hub.component.css'],
})
export class PhysicianHubComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  readonly isDoctor = computed(() => DOCTOR_ROLES.includes(this.auth.currentUser()?.role || ''));
  readonly tabs = computed(() => TABS.filter((t) => !t.doctorOnly || this.isDoctor()));
  readonly mainTab = signal<PhysicianHubTab>('schedule');

  ngOnInit(): void {
    // 頁籤來源優先序：網址 ?tab= → 別名路由的 data.tab → 醫師班表
    const fromQuery = this.route.snapshot.queryParamMap.get('tab') as PhysicianHubTab | null;
    const fromData = this.route.snapshot.data['tab'] as PhysicianHubTab | undefined;
    const wanted = fromQuery || fromData || 'schedule';
    this.mainTab.set(this.tabs().some((t) => t.key === wanted) ? wanted : 'schedule');
  }

  setTab(tab: PhysicianHubTab): void {
    if (this.mainTab() === tab) return;
    this.mainTab.set(tab);
    // 網址同步為 /physician?tab=…（可加書籤；別名路由切換頁籤後也收斂到同一網址）
    void this.router.navigate(['/physician'], { queryParams: { tab }, replaceUrl: true });
  }
}
