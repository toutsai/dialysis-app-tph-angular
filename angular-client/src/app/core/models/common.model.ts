// src/app/core/models/common.model.ts
// 共用基礎型別定義

/** 所有實體的基礎欄位 */
export interface BaseEntity {
  id: string;
  createdAt?: string;
  updatedAt?: string;
}

/** 分頁回應包裝 */
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** API 錯誤回應 */
export interface ApiError {
  status: number;
  message: string;
  code?: string;
  details?: unknown;
}

/** 使用者參考 (嵌入式) */
export interface UserRef {
  uid?: string;
  name?: string;
  title?: string;
  role?: string;
}
