import { AfterViewInit, Directive, ElementRef, EventEmitter, Input, OnDestroy, Output, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';

/** Keyboard behavior for existing modal surfaces, including nested editors. */
@Directive({
  selector: '[appModalFocus]',
  standalone: true,
  host: { role: 'dialog', 'aria-modal': 'true', tabindex: '-1', '[attr.aria-label]': 'appModalFocus' },
})
export class ModalFocusDirective implements AfterViewInit, OnDestroy {
  @Input() appModalFocus = '對話框';
  @Input() modalEscapeDisabled = false;
  @Output() modalEscape = new EventEmitter<void>();

  private static active: ModalFocusDirective[] = [];
  private readonly document = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private previous: HTMLElement | null = null;
  private destroyed = false;

  ngAfterViewInit(): void {
    this.previous = this.document.activeElement as HTMLElement | null;
    ModalFocusDirective.active.push(this);
    this.document.addEventListener('keydown', this.onKeydown, true);
    this.document.addEventListener('focusin', this.onFocus, true);
    queueMicrotask(() => { if (!this.destroyed && this.isTop()) this.focusFirst(); });
  }

  ngOnDestroy(): void {
    const wasTop = this.isTop();
    this.destroyed = true;
    ModalFocusDirective.active = ModalFocusDirective.active.filter(item => item !== this);
    this.document.removeEventListener('keydown', this.onKeydown, true);
    this.document.removeEventListener('focusin', this.onFocus, true);
    if (!wasTop) return;
    const previous = this.previous;
    queueMicrotask(() => {
      const top = ModalFocusDirective.active.at(-1);
      if (previous?.isConnected && (!top || top.host.contains(previous))) previous.focus({ preventScroll: true });
      else top?.focusFirst();
    });
  }

  private isTop(): boolean {
    const nativeModal = this.document.querySelector('dialog:modal');
    return ModalFocusDirective.active.at(-1) === this && (!nativeModal || nativeModal.contains(this.host));
  }

  private focusable(): HTMLElement[] {
    return Array.from(this.host.querySelectorAll<HTMLElement>(
      'button, input, select, textarea, a[href], [tabindex], [contenteditable="true"]',
    )).filter(element => !element.matches(':disabled, [hidden], [tabindex="-1"]') &&
      !element.closest('[inert]') && element.getClientRects().length > 0 &&
      this.document.defaultView?.getComputedStyle(element).visibility !== 'hidden');
  }

  private focusFirst(): void {
    const candidates = this.focusable();
    (candidates.find(element => element.hasAttribute('autofocus')) || candidates[0] || this.host)
      .focus({ preventScroll: true });
  }

  private onFocus = (event: FocusEvent): void => {
    if (this.isTop() && !this.host.contains(event.target as Node)) this.focusFirst();
  };

  private onKeydown = (event: KeyboardEvent): void => {
    if (!this.isTop()) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!this.modalEscapeDisabled) this.modalEscape.emit();
      return;
    }
    if (event.key !== 'Tab' || event.ctrlKey || event.altKey || event.metaKey) return;
    const candidates = this.focusable();
    const current = this.document.activeElement;
    const first = candidates[0];
    const last = candidates.at(-1);
    if (!first || (event.shiftKey ? current === first || current === this.host : current === last || current === this.host) ||
      !this.host.contains(current)) {
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus();
      if (!first) this.host.focus();
    }
  };
}
