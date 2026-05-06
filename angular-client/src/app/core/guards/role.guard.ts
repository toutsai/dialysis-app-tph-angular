import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '@services/auth.service';

/**
 * 路由 RBAC 守門員。route.data.roles 是允許的角色陣列。
 * 沒設定 roles → 視為 ALL_ROLES（任何已登入使用者皆可）。
 *
 * 配合 sidebar 視覺隱藏使用：sidebar 控制顯示，guard 控制直接 URL 進入。
 */
export const roleGuard: CanActivateFn = async (route, state) => {
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

  const allowedRoles =
    (route.data?.['roles'] as readonly string[] | undefined) ?? null;
  if (!allowedRoles || allowedRoles.includes(user.role)) {
    return true;
  }

  // 沒權限時回到所有角色都可進入的安全頁，避免根路由重導循環。
  return router.createUrlTree(['/schedule']);
};
