import { Component, Input } from '@angular/core';

/**
 * 平台署名「Designed by Dr.蔡亨政」（2026-10-25 使用者裁定字樣）。
 * 放在：登入頁、側欄底部、三個免登入展示頁（住院趴趴走板／ICU 透析板／床邊儀表板）。
 * 刻意不放進列印／Word 匯出（那些會進病歷或送出院外）。
 * tone：light = 淺底頁面用灰字；dark = 深色側欄用半透明白字。
 */
@Component({
  selector: 'app-credit-mark',
  standalone: true,
  template: `<span class="credit-mark" [class.dark]="tone === 'dark'">Designed by Dr.蔡亨政</span>`,
  styles: [
    `
      :host {
        display: block;
        text-align: center;
      }
      .credit-mark {
        font-size: 11px;
        letter-spacing: 0.04em;
        color: #9aa3ad;
        user-select: none;
        white-space: nowrap;
      }
      .credit-mark.dark {
        color: rgba(255, 255, 255, 0.45);
      }
    `,
  ],
})
export class CreditMarkComponent {
  @Input() tone: 'light' | 'dark' = 'light';
}
