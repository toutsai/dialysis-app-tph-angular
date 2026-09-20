// 醫師專師專用（2026-09-05，原名「醫師專用」同日改名）：醫師班表 / 醫囑藥囑管理 / 醫師藥物調整 / 重大傷病申請 / 研究專用
// 五頁整合為主頁籤，比照書記專用（features/inventory）：h1 與主頁籤同一列，內容區 .tab-host 內嵌既有元件（embedded 模式隱藏各自標題）。
// 舊路由 /physician-schedule、/orders、/med-adjustment、/catastrophic-illness、/research 保留為別名：載入本頁並帶對應頁籤（app.routes.ts data.tab）。
// 權限：頁面 DOCTOR_VIEW_ROLES（含書記 viewer：看醫師班表與重大傷病申請）；醫囑/調藥/研究三頁籤只給 admin/contributor。
// 重大傷病申請同時也掛在書記專用（features/inventory）頁籤，同一元件兩處內嵌。
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '@services/auth.service';
import { PhysicianScheduleComponent } from '../physician-schedule/physician-schedule.component';
import { OrdersComponent } from '../orders/orders.component';
import { MedAdjustmentComponent } from '../med-adjustment/med-adjustment.component';
import { CatastrophicIllnessComponent } from '../catastrophic-illness/catastrophic-illness.component';
import { ResearchComponent } from '../research/research.component';

export type PhysicianHubTab = 'schedule' | 'orders' | 'med' | 'ci' | 'research';

interface HubTab {
  key: PhysicianHubTab;
  label: string;
  /** 可看到這個頁籤的角色（刻意列舉、不用階層：editor 階層高於 contributor，但這裡多數頁籤不給護理師） */
  roles: readonly string[];
}

const DOCTOR_ROLES = ['admin', 'contributor'];
/**
 * 醫師班表：2026-09-21 使用者裁定「admin／contributor 可編輯，viewer／editor 可看」→ 四種角色都看得到（編輯權限在 AuthService.canManagePhysicianSchedule）。
 * 重大傷病申請：刻意排除 editor（2026-07-24 起的既有規則，勿順手加進去）。
 */
const TABS: HubTab[] = [
  { key: 'schedule', label: '醫師班表', roles: ['admin', 'contributor', 'viewer', 'editor'] },
  { key: 'orders', label: '醫囑藥囑管理', roles: DOCTOR_ROLES },
  { key: 'med', label: '醫師藥物調整', roles: DOCTOR_ROLES },
  { key: 'ci', label: '重大傷病申請', roles: ['admin', 'contributor', 'viewer'] },
  { key: 'research', label: '研究專用', roles: DOCTOR_ROLES },
];

@Component({
  selector: 'app-physician-hub',
  standalone: true,
  imports: [CommonModule, PhysicianScheduleComponent, OrdersComponent, MedAdjustmentComponent, CatastrophicIllnessComponent, ResearchComponent],
  templateUrl: './physician-hub.component.html',
  styleUrls: ['./physician-hub.component.css'],
})
export class PhysicianHubComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  readonly tabs = computed(() => {
    const role = this.auth.currentUser()?.role || '';
    return TABS.filter((t) => t.roles.includes(role));
  });
  /** 只看得到醫師班表一個頁籤的人（護理師）：標題直接叫「醫師班表」，不顯示只有一顆的頁籤列 */
  readonly scheduleOnly = computed(() => this.tabs().length === 1 && this.tabs()[0].key === 'schedule');
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
