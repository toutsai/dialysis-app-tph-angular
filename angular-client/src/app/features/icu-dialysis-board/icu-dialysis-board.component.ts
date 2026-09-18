import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { IcuDialysisPanelComponent } from '../aki-map/icu-dialysis-panel/icu-dialysis-panel.component';

/**
 * ICU 透析病人獨立展示頁（免登入、唯讀，掛在 main layout 之外；2026-09-18 使用者拍板）。
 * 用途：把網址分享給 ICU 專師／護理長看，不建帳號。
 * 個資：後端 /api/dashboard/icu-dialysis-board 已遮罩姓名（林○南）與病歷號（****124），前端不再另遮。
 * 畫面直接重用腎臟病地圖的 ICU 面板（publicBoard + readOnly），每分鐘自動更新。
 */
@Component({
  selector: 'app-icu-dialysis-board',
  standalone: true,
  imports: [CommonModule, IcuDialysisPanelComponent],
  templateUrl: './icu-dialysis-board.component.html',
  styleUrl: './icu-dialysis-board.component.css',
})
export class IcuDialysisBoardComponent implements OnInit, OnDestroy {
  @ViewChild(IcuDialysisPanelComponent) panel?: IcuDialysisPanelComponent;

  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    document.title = 'ICU 透析病人總覽';
    this.refreshTimer = setInterval(() => {
      if (!document.hidden && this.panel && !this.panel.loading()) void this.panel.load();
    }, 60_000);
  }

  ngOnDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }
}
