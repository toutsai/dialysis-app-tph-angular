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
    const token = localStorage.getItem('auth_token');
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
        // Token 過期或無效，清除 token 並導向登入頁
        localStorage.removeItem('auth_token');
        router.navigate(['/login']);
      }
      return throwError(() => error);
    }),
  );
};
