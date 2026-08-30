import { Directive, ElementRef, OnDestroy, AfterViewInit, inject, NgZone } from '@angular/core';

/**
 * 浮動彈窗（popover / 浮動面板）留在視窗內：
 * 渲染後與內容尺寸變動時量測，超出右緣/下緣就用 transform 往視窗中央推回；
 * 高度比視窗還高則限制 max-height 並內部捲動。適用 position: absolute / fixed 的元素。
 *
 * 用法：<div class="stats-popover" appKeepInViewport>…</div>
 */
@Directive({
  selector: '[appKeepInViewport]',
  standalone: true,
})
export class KeepInViewportDirective implements AfterViewInit, OnDestroy {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly zone = inject(NgZone);
  private ro: ResizeObserver | null = null;
  private readonly margin = 8;
  private readonly onResize = () => this.clamp();

  ngAfterViewInit(): void {
    this.zone.runOutsideAngular(() => {
      // 兩個 frame 後再量：等 Angular 把子內容渲染完
      requestAnimationFrame(() => requestAnimationFrame(() => this.clamp()));
      if (typeof ResizeObserver !== 'undefined') {
        this.ro = new ResizeObserver(() => this.clamp());
        this.ro.observe(this.el.nativeElement);
      }
      window.addEventListener('resize', this.onResize);
    });
  }

  ngOnDestroy(): void {
    this.ro?.disconnect();
    window.removeEventListener('resize', this.onResize);
  }

  private clamp(): void {
    const node = this.el.nativeElement;
    if (!node.isConnected) return;
    // 先還原上次位移再量測，避免累積
    node.style.transform = '';
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const maxH = vh - this.margin * 2;
    if (node.offsetHeight > maxH) {
      node.style.maxHeight = `${maxH}px`;
      node.style.overflowY = 'auto';
    }
    const rect = node.getBoundingClientRect();
    let dx = 0;
    let dy = 0;
    if (rect.right > vw - this.margin) dx = vw - this.margin - rect.right;
    if (rect.left + dx < this.margin) dx = this.margin - rect.left;
    if (rect.bottom > vh - this.margin) dy = vh - this.margin - rect.bottom;
    if (rect.top + dy < this.margin) dy = this.margin - rect.top;
    if (dx || dy) node.style.transform = `translate(${Math.round(dx)}px, ${Math.round(dy)}px)`;
  }
}
