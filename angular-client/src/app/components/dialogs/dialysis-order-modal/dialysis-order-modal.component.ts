import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiManagerService, type ApiManager, type FirestoreRecord } from '@services/api-manager.service';
import { ConfirmDialogComponent } from '../confirm-dialog/confirm-dialog.component';
import { getToday, formatDateToYYYYMMDD } from '@/utils/dateUtils';
// Standalone 版：已移除 Firebase

@Component({
  selector: 'app-dialysis-order-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmDialogComponent],
  templateUrl: './dialysis-order-modal.component.html',
  styleUrl: './dialysis-order-modal.component.css'
})
export class DialysisOrderModalComponent implements OnInit, OnDestroy {
  private readonly apiManagerService = inject(ApiManagerService);
  private readonly ordersHistoryApi: ApiManager<FirestoreRecord>;

  @Input() patient: any = null;
  @Input() patientData: any = null;
  @Output() close = new EventEmitter<void>();
  @Output() save = new EventEmitter<any>();

  orderHistory: any[] = [];
  isLoadingHistory = false;
  isConfirmDeleteVisible = false;
  orderToDelete: any = null;

  readonly akOptions = ['13M', '15S', '17UX', '17HX', 'FX80', 'BG-1.8U', 'Pro-19H', '21S', 'Hi23', '25H', '25S', 'CTA2000'];
  readonly caOptions = ['2.5', '3.0', '3.5'];
  readonly vascAccessOptions = ['D/L', 'Perm', 'AVF', 'AVG'];
  readonly needleSizeOptions = ['15G', '16G', '17G'];

  localOrderData: any = this.createFormState();

  constructor() {
    this.ordersHistoryApi = this.apiManagerService.create<FirestoreRecord>('dialysis_orders_history');
  }

  private createFormState(): any {
    return {
      effectiveDate: getToday(),
      aks: [''],
      dialysateCa: '',
      dryWeight: '',
      bloodFlow: '',
      vascAccess: '',
      arterialNeedle: '',
      venousNeedle: '',
      heparinInitial: '',
      heparinMaintenance: '',
      heparinRinse: '不可',
      mode: '',
      freq: '',
      dialysisTimeHours: null,
      dialysisTimeMinutes: null,
      dialysateFlow: null,
      replacementFlow: null,
      dehydration: '',
      mannitol: '不用',
    };
  }

  ngOnInit(): void {
    document.body.classList.add('modal-open');

    // Parent passes [patient], map to patientData for internal use
    if (this.patient && !this.patientData) {
      this.patientData = this.patient;
    }

    if (this.patientData) {
      const orders = this.patientData.dialysisOrders || {};
      const patient = this.patientData;

      const akValue = orders.ak || '';
      this.localOrderData.aks = akValue && typeof akValue === 'string' ? akValue.split('/') : [''];

      const heparinLM = orders.heparinLM
        ? String(orders.heparinLM).split('/')
        : [orders.heparinInitial || '', orders.heparinMaintenance || ''];
      const dialysisTime = this.parseDialysisTime(orders);

      Object.assign(this.localOrderData, {
        effectiveDate: orders.effectiveDate || getToday(),
        vascAccess: orders.vascAccess || '',
        arterialNeedle: orders.arterialNeedle || '',
        venousNeedle: orders.venousNeedle || '',
        dialysateCa: orders.dialysateCa || orders.dialysate || '',
        dryWeight: orders.dryWeight || '',
        bloodFlow: this.firstPresent(orders.bloodFlow, orders.blood_flow, ''),
        heparinInitial: heparinLM[0] || '',
        heparinMaintenance: heparinLM[1] || '',
        mode: orders.mode || patient.mode || '',
        freq: orders.freq || patient.freq || '',
        dialysisTimeHours: dialysisTime.hours,
        dialysisTimeMinutes: dialysisTime.minutes,
        dialysateFlow: this.firstPresent(orders.dialysateFlow, orders.dialysateFlowRate, orders.dialysisFlow, null),
        replacementFlow: this.firstPresent(orders.replacementFlow, orders.replacementFlowRate, null),
        dehydration: orders.dehydration || '',
        heparinRinse: orders.heparinRinse || '不可',
        mannitol: orders.mannitol || '不用',
      });

      this.fetchOrderHistory(this.patientData.id);
    }
  }

  ngOnDestroy(): void {
    document.body.classList.remove('modal-open');
  }

  get shouldShowNeedleSize(): boolean {
    return this.localOrderData.vascAccess === 'AVF' || this.localOrderData.vascAccess === 'AVG';
  }

  get todayStr(): string {
    return getToday();
  }

  private firstPresent(...values: any[]): any {
    return values.find((value) => value !== null && value !== undefined && value !== '');
  }

  private parseWholeNumber(value: any): number | null {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    return Math.max(0, Math.trunc(numeric));
  }

  private parseDialysisTime(orders: any): { hours: number | null; minutes: number | null } {
    const explicitHours = this.parseWholeNumber(
      this.firstPresent(orders?.dialysisTimeHours, orders?.dialysisHour, orders?.dialysisHoursHour),
    );
    const explicitMinutes = this.parseWholeNumber(
      this.firstPresent(orders?.dialysisTimeMinutes, orders?.dialysisMinute, orders?.dialysisMinutes),
    );

    if (explicitHours !== null || explicitMinutes !== null) {
      return this.normalizeDialysisTimeParts(explicitHours, explicitMinutes);
    }

    const rawTime = this.firstPresent(orders?.dialysisTimeText, orders?.dialysisHours, orders?.hours, orders?.duration);
    if (rawTime === null || rawTime === undefined || rawTime === '') {
      return { hours: null, minutes: null };
    }

    const text = String(rawTime);
    const hourMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:時|小時|h|hr|hour)/i);
    const minuteMatch = text.match(/(\d+)\s*(?:分|分鐘|m|min|minute)/i);

    if (hourMatch || minuteMatch) {
      return this.normalizeDialysisTimeParts(
        hourMatch ? this.parseWholeNumber(hourMatch[1]) : null,
        minuteMatch ? this.parseWholeNumber(minuteMatch[1]) : null,
      );
    }

    const decimalHours = Number(rawTime);
    if (!Number.isFinite(decimalHours)) return { hours: null, minutes: null };

    const hours = Math.floor(decimalHours);
    const minutes = Math.round((decimalHours - hours) * 60);
    return this.normalizeDialysisTimeParts(hours, minutes);
  }

  private normalizeDialysisTimeParts(hours: number | null, minutes: number | null): { hours: number | null; minutes: number | null } {
    if (hours === null && minutes === null) return { hours: null, minutes: null };

    const totalMinutes = (hours || 0) * 60 + (minutes || 0);
    return {
      hours: Math.floor(totalMinutes / 60),
      minutes: totalMinutes % 60,
    };
  }

  formatDialysisTime(orders: any): string {
    const time = this.parseDialysisTime(orders);
    if (time.hours === null && time.minutes === null) return '–';
    return `${time.hours || 0}時${time.minutes || 0}分`;
  }

  private buildDialysisTimeForSave(): {
    hours: number | null;
    minutes: number | null;
    decimalHours: number | null;
    text: string | null;
  } {
    const normalized = this.normalizeDialysisTimeParts(
      this.parseWholeNumber(this.localOrderData.dialysisTimeHours),
      this.parseWholeNumber(this.localOrderData.dialysisTimeMinutes),
    );

    if (normalized.hours === null && normalized.minutes === null) {
      return { hours: null, minutes: null, decimalHours: null, text: null };
    }

    const hours = normalized.hours || 0;
    const minutes = normalized.minutes || 0;
    return {
      hours,
      minutes,
      decimalHours: Number((hours + minutes / 60).toFixed(2)),
      text: `${hours}時${minutes}分`,
    };
  }

  orderValue(orders: any, ...keys: string[]): string {
    if (!orders) return '–';

    for (const key of keys) {
      const value = orders[key];
      if (value !== null && value !== undefined && value !== '') {
        return String(value);
      }
    }

    return '–';
  }

  flowTriple(orders: any): string {
    return [
      this.orderValue(orders, 'bloodFlow', 'blood_flow'),
      this.orderValue(orders, 'dialysateFlow', 'dialysateFlowRate', 'dialysisFlow'),
      this.orderValue(orders, 'replacementFlow', 'replacementFlowRate'),
    ].join('/');
  }

  get activeOrder(): any {
    const effectiveOrders = this.orderHistory
      .filter((o: any) => o.orders?.effectiveDate <= this.todayStr)
      .sort((a: any, b: any) => {
        const dateA = this.getDate(b.updatedAt);
        const dateB = this.getDate(a.updatedAt);
        return (dateA?.getTime() || 0) - (dateB?.getTime() || 0);
      });
    return effectiveOrders.length > 0 ? effectiveOrders[0] : null;
  }

  get pendingOrders(): any[] {
    return this.orderHistory
      .filter((o: any) => o.orders?.effectiveDate > this.todayStr)
      .sort((a: any, b: any) => {
        const dateA = this.getDate(a.orders?.effectiveDate);
        const dateB = this.getDate(b.orders?.effectiveDate);
        return (dateA?.getTime() || 0) - (dateB?.getTime() || 0);
      });
  }

  get archivedOrders(): any[] {
    const activeId = this.activeOrder?.id;
    const pendingIds = new Set(this.pendingOrders.map((p: any) => p.id));
    return this.orderHistory
      .filter((o: any) => o.id !== activeId && !pendingIds.has(o.id))
      .sort((a: any, b: any) => {
        const dateA = this.getDate(b.updatedAt);
        const dateB = this.getDate(a.updatedAt);
        return (dateA?.getTime() || 0) - (dateB?.getTime() || 0);
      });
  }

  addAkSelect(): void {
    if (this.localOrderData.aks.length < 3) {
      this.localOrderData.aks.push('');
    }
  }

  removeAkSelect(index: number): void {
    if (this.localOrderData.aks.length > 1) {
      this.localOrderData.aks.splice(index, 1);
    }
  }

  onVascAccessChange(): void {
    if (this.localOrderData.vascAccess !== 'AVF' && this.localOrderData.vascAccess !== 'AVG') {
      this.localOrderData.arterialNeedle = '';
      this.localOrderData.venousNeedle = '';
    }
  }

  handleSave(): void {
    const formattedAk = this.localOrderData.aks.filter((ak: string) => ak).join('/');
    const formattedHeparinLM = `${this.localOrderData.heparinInitial || '0'}/${this.localOrderData.heparinMaintenance || '0'}`;
    const dialysisTime = this.buildDialysisTimeForSave();

    const dataToSave: any = {
      effectiveDate: this.localOrderData.effectiveDate,
      ak: formattedAk,
      artificialKidney: formattedAk,
      dialysateCa: this.localOrderData.dialysateCa,
      dialysate: this.localOrderData.dialysateCa,
      dryWeight: this.localOrderData.dryWeight,
      bloodFlow: this.localOrderData.bloodFlow,
      vascAccess: this.localOrderData.vascAccess,
      arterialNeedle: this.localOrderData.arterialNeedle,
      venousNeedle: this.localOrderData.venousNeedle,
      heparinLM: formattedHeparinLM,
      heparinInitial: this.localOrderData.heparinInitial,
      heparinMaintenance: this.localOrderData.heparinMaintenance,
      heparinRinse: this.localOrderData.heparinRinse,
      mode: this.localOrderData.mode,
      // 不傳 freq：頻率僅能透過病人清單或床位總表修改
      dialysisHours: dialysisTime.decimalHours,
      dialysisTimeHours: dialysisTime.hours,
      dialysisTimeMinutes: dialysisTime.minutes,
      dialysisTimeText: dialysisTime.text,
      dialysateFlow: this.localOrderData.dialysateFlow,
      replacementFlow: this.localOrderData.replacementFlow,
      dehydration: this.localOrderData.dehydration,
      mannitol: this.localOrderData.mannitol,
    };

    Object.keys(dataToSave).forEach((key) => {
      if (dataToSave[key] === null || dataToSave[key] === undefined || dataToSave[key] === '') {
        delete dataToSave[key];
      }
    });

    this.save.emit(dataToSave);
  }

  handleClose(): void {
    document.body.classList.remove('modal-open');
    this.close.emit();
  }

  requestDeleteOrder(record: any): void {
    if (!record || !record.id) {
      alert('錯誤：無法識別要刪除的記錄');
      return;
    }
    this.orderToDelete = record;
    this.isConfirmDeleteVisible = true;
  }

  async confirmDelete(): Promise<void> {
    if (!this.orderToDelete?.id) return;
    const recordId = this.orderToDelete.id;
    try {
      await this.ordersHistoryApi.delete(recordId);
      this.orderHistory = this.orderHistory.filter((item: any) => item.id !== recordId);
      alert('刪除成功');
    } catch (error) {
      console.error('刪除醫囑歷史失敗:', error);
      alert(`刪除失敗`);
    } finally {
      this.isConfirmDeleteVisible = false;
      this.orderToDelete = null;
    }
  }

  formatDate(isoString: any): string {
    if (!isoString) return 'N/A';
    const date = this.getDate(isoString);
    if (!date) return 'N/A';
    return formatDateToYYYYMMDD(date);
  }

  private getDate(dateValue: any): Date | null {
    if (!dateValue) return null;
    if (dateValue.toDate) return dateValue.toDate();
    if (typeof dateValue === 'string') return new Date(dateValue);
    return new Date(dateValue);
  }

  private async fetchOrderHistory(patientId: string): Promise<void> {
    if (!patientId) return;
    this.isLoadingHistory = true;
    this.orderHistory = [];
    try {
      const allOrders = await this.ordersHistoryApi.fetchAll();
      this.orderHistory = (allOrders as any[]).filter(
        (o: any) => o.patientId === patientId
      ).sort((a: any, b: any) => {
        const dateA = typeof a.updatedAt === 'string' ? a.updatedAt : '';
        const dateB = typeof b.updatedAt === 'string' ? b.updatedAt : '';
        return dateB.localeCompare(dateA);
      }).slice(0, 20);
    } catch (error) {
      console.error('讀取醫囑歷史失敗:', error);
    } finally {
      this.isLoadingHistory = false;
    }
  }
}
