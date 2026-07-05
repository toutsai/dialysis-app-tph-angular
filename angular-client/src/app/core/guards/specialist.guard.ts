import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '@services/auth.service';

/**
 * 專師專用守門：admin 或 職稱「專科護理師」可進入。
 * 用於後台管理中專師專屬頁面（如全院 AKI Map）。
 */
export const specialistGuard: CanActivateFn = async (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (!authService.isAuthReady()) {
    await authService.waitForAuthInit();
  }

  const user = authService.currentUser();
  if (!user) {
    return router.createUrlTree(['/login'], {
      queryParams: { returnUrl: state.url },
    });
  }

  if (authService.isSpecialist()) {
    return true;
  }

  // 非專師 → 回安全頁
  return router.createUrlTree(['/schedule']);
};
