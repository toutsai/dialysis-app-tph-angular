import { Component, inject, effect } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthService } from '@services/auth.service';
import { PatientService } from '@services/patient.service';
import { UserDirectoryService } from '@services/user-directory.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  readonly authService = inject(AuthService);
  private readonly patientService = inject(PatientService);
  private readonly userDirectory = inject(UserDirectoryService);

  constructor() {
    // When a user logs in, trigger data preloading
    effect(() => {
      const user = this.authService.currentUser();
      if (user) {
        this.patientService.fetchPatients();
        this.userDirectory.fetchUsersIfNeeded();
      }
    });
    this.installDragClickGuard();
  }

  /**
   * 全站「拖曳滑出不關窗」守門（2026-08-30）：
   * 瀏覽器在 mousedown 與 mouseup 落在不同元素時，會把 click 派發到兩者的共同祖先——
   * 在彈窗/浮動面板內按住（選字、拉日期、按到一半）再放開到外面，click 會落到遮罩或頁面容器，
   * 觸發「點遮罩關閉」或 document click 的關閉邏輯。這裡在 document 捕獲階段攔下這類「合成祖先 click」：
   *   1. click 目標是遮罩/背板（class 含 overlay/backdrop）但 mousedown 不在它身上；
   *   2. mousedown 發生在浮動容器（popover/panel/modal/dialog）內，而 click 目標不在同一容器內。
   * 其餘 click 不受影響（同元素按放、控制項內部的細微位移都照常）。
   */
  private installDragClickGuard(): void {
    if (typeof document === 'undefined') return;
    const FLOATING = '[class*="popover"],[class*="panel"],[class*="modal"],[class*="dialog"]';
    let downTarget: Element | null = null;
    document.addEventListener(
      'mousedown',
      (e) => { downTarget = e.target instanceof Element ? e.target : null; },
      true,
    );
    document.addEventListener(
      'click',
      (e) => {
        const target = e.target instanceof Element ? e.target : null;
        const down = downTarget;
        downTarget = null;
        if (!target || !down || target === down) return;
        // 目標是自己祖先才可能是合成 click；否則（例如程式觸發或鍵盤）放行
        if (!target.contains(down)) return;
        const cls = (target.getAttribute('class') || '').toLowerCase();
        const isOverlay = /overlay|backdrop/.test(cls);
        const downFloating = down.closest(FLOATING);
        const escapedFloating = !!downFloating && !target.closest(FLOATING)?.contains(down);
        if (isOverlay || escapedFloating) {
          e.stopPropagation();
        }
      },
      true,
    );
  }
}
