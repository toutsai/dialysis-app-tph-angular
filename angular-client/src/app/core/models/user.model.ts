// src/app/core/models/user.model.ts
// 使用者相關型別定義

import { BaseEntity } from './common.model';

/** 使用者角色 */
export type UserRole = 'admin' | 'editor' | 'contributor' | 'viewer';

/** 使用者 */
export interface User extends BaseEntity {
  username: string;
  name: string;
  title?: string;
  role: UserRole;
  email?: string;
  isActive?: boolean;
  lastLogin?: string;
  /** 登入失敗鎖定相關 (B級資安合規) */
  failedLoginCount?: number;
  lockedUntil?: string | null;
}

/** JWT 驗證聲明 */
export interface AuthClaims {
  uid: string;
  username: string;
  name: string;
  role: UserRole;
  title?: string;
  iat?: number;
  exp?: number;
}
