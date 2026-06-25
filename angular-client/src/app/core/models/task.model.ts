// src/app/core/models/task.model.ts
// 任務與通知相關型別定義

import { BaseEntity, UserRef } from './common.model';

/** 任務/留言 */
export interface Task extends BaseEntity {
  title?: string;
  description?: string;
  content?: string;
  status?: string;
  priority?: string;
  /** task 或 message */
  category?: string;
  /** 常規, 抽血, 衛教 等 */
  type?: string;
  patientId?: string;
  patientName?: string;
  targetDate?: string;
  assignedTo?: string;
  assignee?: { type?: string; value?: string; name?: string; title?: string; role?: string };
  creator?: UserRef;
  createdBy?: UserRef;
  resolvedBy?: UserRef;
  resolvedAt?: string;
  dueDate?: string;
  completedAt?: string;
}

/** 通知 */
export interface Notification extends BaseEntity {
  type: string;
  title?: string;
  message?: string;
  recipientId?: string;
  isRead?: boolean;
  data?: Record<string, unknown>;
}
