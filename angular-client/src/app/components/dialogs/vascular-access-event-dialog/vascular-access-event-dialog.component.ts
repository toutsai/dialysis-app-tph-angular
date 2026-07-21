import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '@app/core/services/api.service';
import { getToday } from '@/utils/dateUtils';
import {
  type VascularAccessEvent,
  type VascularAccessType,
  type VascularEventType,
  VASCULAR_FAILURE_REASONS,
  VASCULAR_REPAIR_METHODS,
  VASCULAR_ACCESS_TYPES,
  VASCULAR_ACCESS_SIDES,
  VASCULAR_LOCATIONS,
  VASCULAR_EVENT_TYPE_LABELS,
  VASCULAR_EVENT_STATUS_LABELS,
  siteOptionsForType,
  describeVascularEvent,
} from '@app/core/constants/vascular-access-codes';

/** 表單模型（空字串＝未選；送出時轉 null） */
interface VascularEventForm {
  eventType: VascularEventType;
  eventDate: string;
  location: string;
  failureReason: string;
  repairMethod: string;
  repairMethodOther: string;
  newAccessType: VascularAccessType | '';
  newAccessSide: 'L' | 'R' | '';
  newAccessSite: string;
  updatePatientMaster: boolean;
  notes: string;
}

@Component({
  selector: 'app-vascular-access-event-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './vascular-access-event-dialog.component.html',
  styleUrl: './vascular-access-event-dialog.component.css',
})
export class VascularAccessEventDialogComponent implements OnInit {
  private readonly api = inject(ApiService);

  @Input() patientId = '';
  @Input() patientName = '';
  @Output() close = new EventEmitter<void>();

  // 代碼表（模板用）
  readonly failureReasons = VASCULAR_FAILURE_REASONS;
  readonly repairMethods = VASCULAR_REPAIR_METHODS;
  readonly accessTypes = VASCULAR_ACCESS_TYPES;
  readonly accessSides = VASCULAR_ACCESS_SIDES;
  readonly locations = VASCULAR_LOCATIONS;
  readonly typeLabels = VASCULAR_EVENT_TYPE_LABELS;
  readonly statusLabels = VASCULAR_EVENT_STATUS_LABELS;
  readonly describe = describeVascularEvent;

  readonly events = signal<VascularAccessEvent[]>([]);
  readonly isLoading = signal(false);
  readonly isSaving = signal(false);
  readonly errorMsg = signal('');
  /** 編輯中的事件 id（null = 新增模式） */
  readonly editingId = signal<string | null>(null);

  form: VascularEventForm = this.emptyForm();

  ngOnInit(): void {
    void this.loadEvents();
  }

  private emptyForm(): VascularEventForm {
    return {
      eventType: 'intervention',
      eventDate: getToday(),
      location: '本院',
      failureReason: '',
      repairMethod: '',
      repairMethodOther: '',
      newAccessType: '',
      newAccessSide: '',
      newAccessSite: '',
      updatePatientMaster: true,
      notes: '',
    };
  }

  async loadEvents(): Promise<void> {
    if (!this.patientId) return;
    this.isLoading.set(true);
    try {
      const resp = await firstValueFrom(
        this.api.get<{ success: boolean; events: VascularAccessEvent[] }>(
          '/vascular-access/events',
          { patientId: this.patientId },
        ),
      );
      // 新的在前（依事件日期）
      const list = (resp?.events || []).slice().sort((a, b) => String(b.eventDate).localeCompare(String(a.eventDate)));
      this.events.set(list);
    } catch (error) {
      console.error('載入血管通路事件失敗:', error);
      this.errorMsg.set('載入事件歷史失敗，請稍後再試。');
    } finally {
      this.isLoading.set(false);
    }
  }

  /** 事件類型切換：清掉另一型的專屬欄位（避免殘值誤送） */
  onEventTypeChange(): void {
    if (this.form.eventType === 'intervention') {
      this.form.newAccessType = '';
      this.form.newAccessSide = '';
      this.form.newAccessSite = '';
      this.form.updatePatientMaster = true;
    } else {
      this.form.repairMethod = '';
      this.form.repairMethodOther = '';
    }
  }

  /** 位置選項隨新通路型態切換（AVF/AVG=廔管位置，PERM/TEMP=導管位置） */
  siteOptions() {
    return siteOptionsForType(this.form.newAccessType || null);
  }

  /** 型態變更：若現值不在新型態的位置選項中則清空 */
  onAccessTypeChange(): void {
    const site = this.form.newAccessSite;
    if (site && !this.siteOptions().some((s) => s.code === site)) {
      this.form.newAccessSite = '';
    }
  }

  /** pending/rejected 可編輯/刪除；confirmed 唯讀（組長已於工作日誌確認） */
  canModify(ev: VascularAccessEvent): boolean {
    return ev.status === 'pending' || ev.status === 'rejected';
  }

  /** 帶回下方表單改為編輯模式（rejected 事件編輯儲存後，後端自動改回 pending 重審） */
  startEdit(ev: VascularAccessEvent): void {
    this.editingId.set(ev.id);
    this.errorMsg.set('');
    this.form = {
      eventType: ev.eventType,
      eventDate: ev.eventDate || getToday(),
      location: ev.location || '',
      failureReason: ev.failureReason || '',
      repairMethod: ev.repairMethod || '',
      repairMethodOther: ev.repairMethodOther || '',
      newAccessType: ev.newAccessType || '',
      newAccessSide: ev.newAccessSide || '',
      newAccessSite: ev.newAccessSite || '',
      updatePatientMaster: ev.updatePatientMaster !== false,
      notes: ev.notes || '',
    };
  }

  cancelEdit(): void {
    this.editingId.set(null);
    this.errorMsg.set('');
    this.form = this.emptyForm();
  }

  async deleteEvent(ev: VascularAccessEvent): Promise<void> {
    if (!this.canModify(ev)) return;
    const summary = `${ev.eventDate} ${this.typeLabels[ev.eventType]}`;
    if (!confirm(`確定要刪除這筆事件嗎？\n${summary}`)) return;
    try {
      await firstValueFrom(this.api.delete<{ success: boolean }>(`/vascular-access/events/${ev.id}`));
      if (this.editingId() === ev.id) this.cancelEdit();
      await this.loadEvents();
    } catch (error: any) {
      console.error('刪除血管通路事件失敗:', error);
      this.errorMsg.set(`刪除失敗：${error?.error?.message || error?.message || error}`);
    }
  }

  /** 送出前檢核（CSV 申報必要欄位） */
  private validate(): string {
    const f = this.form;
    if (!f.eventDate) return '請選擇事件日期。';
    if (f.eventType === 'intervention') {
      if (!f.failureReason) return '請選擇失敗原因。';
      if (!f.repairMethod) return '請選擇處置方式。';
      if (f.repairMethod === '9' && !f.repairMethodOther.trim()) return '處置方式為「其他」時，請填寫其他方式說明。';
    } else {
      if (!f.newAccessType) return '請選擇新通路型態。';
      if (!f.newAccessSide) return '請選擇左右側。';
      if (!f.newAccessSite) return '請選擇位置。';
    }
    return '';
  }

  async save(): Promise<void> {
    if (this.isSaving()) return;
    const err = this.validate();
    if (err) {
      this.errorMsg.set(err);
      return;
    }
    this.errorMsg.set('');
    this.isSaving.set(true);
    const f = this.form;
    const isIntervention = f.eventType === 'intervention';
    const body = {
      patientId: this.patientId,
      eventDate: f.eventDate,
      eventType: f.eventType,
      failureReason: f.failureReason || null,
      repairMethod: isIntervention ? f.repairMethod || null : null,
      repairMethodOther: isIntervention && f.repairMethod === '9' ? f.repairMethodOther.trim() : null,
      newAccessType: !isIntervention ? f.newAccessType || null : null,
      newAccessSide: !isIntervention ? f.newAccessSide || null : null,
      newAccessSite: !isIntervention ? f.newAccessSite || null : null,
      location: f.location || null,
      notes: f.notes.trim() || null,
      updatePatientMaster: !isIntervention && f.updatePatientMaster,
    };
    try {
      const id = this.editingId();
      if (id) {
        await firstValueFrom(this.api.put<{ success: boolean }>(`/vascular-access/events/${id}`, body));
      } else {
        await firstValueFrom(this.api.post<{ success: boolean }>('/vascular-access/events', body));
      }
      this.cancelEdit(); // 清空表單並回新增模式
      await this.loadEvents();
    } catch (error: any) {
      console.error('儲存血管通路事件失敗:', error);
      this.errorMsg.set(`儲存失敗：${error?.error?.message || error?.message || error}`);
    } finally {
      this.isSaving.set(false);
    }
  }

  onClose(): void {
    this.close.emit();
  }
}
