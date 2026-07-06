// src/app/core/interceptors/auth.interceptor.ts
// HTTP 攔截器：自動附加 JWT token 並處理 401 回應

import { HttpInterceptorFn, HttpHandlerFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';

/**
 * Angular 19 functional HTTP interceptor.
 * - 為所有 /api 請求自動附加 Bearer token
 * - 處理 401 回應 → 導向登入頁
 */
export const authInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
) => {
  const router = inject(Router);

  // 只攔截 /api 相關請求
  if (req.url.includes('/api')) {
    const token = sessionStorage.getItem('auth_token');
    if (token) {
      req = req.clone({
        setHeaders: {
          Authorization: `Bearer ${token}`,
        },
      });
    }
  }

  return next(req).pipe(
    catchError((error) => {
      if (error.status === 401) {
        // Token 過期或無效，清除 token 並導向登入頁（帶上原因供登入頁顯示提示）
        sessionStorage.removeItem('auth_token');
        const code = (error.error as { code?: string } | null)?.code;
        const reason = code === 'TOKEN_BLACKLISTED' ? 'another_device' : 'expired';
        router.navigate(['/login'], { queryParams: { reason } });
      }
      return throwError(() => error);
    }),
  );
};
