import { CanDeactivateFn } from '@angular/router';

export const manualEditorGuard: CanDeactivateFn<{ canLeave?: () => boolean }> =
  component => component.canLeave?.() ?? true;
