import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { kiditService } from '@/services/kiditService';
import { PatientStoreService } from '@services/patient-store.service';
import {
  KIDIT_GROUP_LABELS,
  KIDIT_GROUP_ORDER,
  KiditPatientGroup,
  classifyKiditPatient,
  externalHospitalName,
} from '@/app/core/utils/kidit-patient-groups';
import { KiditPatientFormComponent } from './kidit-patient-form.component';
import { KiditHistoryFormComponent } from './kidit-history-form.component';
import { KiditVascularFormComponent } from './kidit-vascular-form.component';

type TabKey = 'movement' | 'vascular' | 'registration';

interface EventGroup {
  key: KiditPatientGroup;
  label: string;
  events: any[];
}

interface Tab {
  key: TabKey;
  label: string;
  requiresSelection: boolean;
}

@Component({
  selector: 'app-kidit-detail-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, KiditPatientFormComponent, KiditHistoryFormComponent, KiditVascularFormComponent],
  templateUrl: './kidit-detail-modal.component.html',
  styleUrl: './kidit-detail-modal.component.css',
})
export class KiditDetailModalComponent implements OnChanges {
  @Input() date = '';
  @Input() events: any[] = [];
  /** 開窗時自動選定的病人（例如從待建檔清單點入），null=不預選 */
  @Input() initialPatientId: string | null = null;
  /** 開窗時直接切到的分頁（配合 initialPatientId 直達建檔），null=預設當日動態 */
  @Input() initialTab: TabKey | null = null;
  @Output() closeEvent = new EventEmitter<void>();

  private readonly patientStore = inject(PatientStoreService);

  activeTab: TabKey = 'movement';
  subTab: 'current' | 'unused' = 'current';
  localEvents: any[] = [];
  /** 當日動態列表顯示用：血管通路事件(ACCESS)不顯示（使用者決策：動態只看病人動態；
   *  事件仍留在 localEvents 作為建檔/造管手填資料的載體，儲存時整包寫回不會弄丟） */
  visibleEvents: any[] = [];
  /** 三區分組（本院常規HD／新病患／外院），空區不顯示 */
  groupedEvents: EventGroup[] = [];
  selectedPatientId: string | null = null;
  selectedPatientName = '';
  selectedPatientData: any = null;

  // Confirm delete
  pendingDeleteIndex = -1;
  showConfirmDelete = false;
  confirmMessage = '';

  // 病患資料＋病史合併為單一「KiDit 建檔」分頁（一頁填完、一鍵儲存兩份）
  readonly tabs: Tab[] = [
    { key: 'movement', label: '當日病患動態', requiresSelection: false },
    { key: 'vascular', label: '血管通路處置', requiresSelection: true },
    { key: 'registration', label: 'KiDit 建檔', requiresSelection: true },
  ];

  // 非阻斷式儲存提示（取代 alert，避免每存一次就要按一次確定）
  toastMessage = '';
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  private showToast(message: string): void {
    this.toastMessage = message;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toastMessage = ''), 2500);
  }

  // memoize 成欄位：getter 每輪變更偵測重算並回傳新參照，會反覆觸發子表單重建（專案已知反模式）
  selectedPatient: { id: string; name: string } | null = null;
  selectedEvent: any = {};

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['events']) {
      this.localEvents = JSON.parse(JSON.stringify(this.events || []));
      this.syncSelectionRefs();
    }
    if (changes['events'] || changes['initialPatientId']) {
      this.applyInitialSelection();
    }
  }

  /** 依 initialPatientId 預選病人（僅在尚未手動選人時套用） */
  private applyInitialSelection(): void {
    if (!this.initialPatientId || this.selectedPatientId) return;
    const target = this.localEvents.find(e => e.patientId === this.initialPatientId);
    if (target) {
      this.selectPatient(target);
      if (this.initialTab) this.activeTab = this.initialTab;
    }
  }

  private syncSelectionRefs(): void {
    this.selectedPatient = this.selectedPatientId
      ? { id: this.selectedPatientId, name: this.selectedPatientName }
      : null;
    this.selectedEvent = this.localEvents.find(e => e.patientId === this.selectedPatientId) || {};
    this.visibleEvents = this.localEvents.filter(e => e.type !== 'ACCESS');
    this.groupedEvents = this.buildGroups(this.visibleEvents);
  }

  /** 依病人主檔把當日動態切成三區；主檔查不到時歸新病患（見 kidit-patient-groups.ts） */
  private buildGroups(events: any[]): EventGroup[] {
    const patientMap = this.patientStore.patientMap();
    const buckets: Record<KiditPatientGroup, any[]> = { regular: [], newPatient: [], external: [] };
    this.externalHospitalByEventId = new Map();
    for (const event of events) {
      const patient = patientMap.get(event.patientId);
      const group = classifyKiditPatient(patient);
      buckets[group].push(event);
      // 院所名存旁路 Map，不掛在 event 上（localEvents 會整包存回後端）
      if (group === 'external') {
        this.externalHospitalByEventId.set(event.id, externalHospitalName(patient));
      }
    }
    return KIDIT_GROUP_ORDER
      .filter(key => buckets[key].length > 0)
      .map(key => ({ key, label: KIDIT_GROUP_LABELS[key], events: buckets[key] }));
  }

  /** 外院區每列顯示的原透析院所（buildGroups 時預先算好，模板直接查） */
  externalHospitalByEventId = new Map<string, string>();

  getEventData(key: string) {
    return this.selectedEvent[key] || null;
  }

  trackByEventId(_index: number, event: any): string {
    return event.id;
  }

  translateType(type: string): string {
    const map: Record<string, string> = { MOVEMENT: '動態', ACCESS: '通路', TRANSFER: '轉移', CREATE: '新收', DELETE: '結案' };
    return map[type] || type;
  }

  getBadgeClass(type: string): string {
    const map: Record<string, string> = {
      MOVEMENT: 'badge-blue',
      ACCESS: 'badge-purple',
      TRANSFER: 'badge-yellow',
      CREATE: 'badge-green',
      DELETE: 'badge-red',
    };
    return map[type] || 'badge-gray';
  }

  selectPatient(event: any): void {
    this.selectedPatientId = event.patientId;
    this.selectedPatientName = event.patientName;
    this.syncSelectionRefs();
    this.loadPatientMasterData();
  }

  async loadPatientMasterData(): Promise<void> {
    if (this.selectedPatientId) {
      this.selectedPatientData = await kiditService.fetchPatientMasterRecord(this.selectedPatientId);
    } else {
      this.selectedPatientData = null;
    }
  }

  handleTabClick(key: TabKey): void {
    const tab = this.tabs.find(t => t.key === key);
    // 未選病人時分頁鈕已 disabled，此處靜默防護即可（勿再加 alert）
    if (tab?.requiresSelection && !this.selectedPatientId) return;
    this.activeTab = key;
  }

  /** 列表每列的直達鈕：一鍵選人＋切分頁 */
  openFormFor(event: any, tab: TabKey): void {
    this.selectPatient(event);
    this.activeTab = tab;
  }

  handleDataUpdated(key: string, newData: any): void {
    const targetEvent = this.localEvents.find(e => e.patientId === this.selectedPatientId);
    if (targetEvent && key) {
      targetEvent[key] = JSON.parse(JSON.stringify(newData));
    }
    // 月曆彙總改為關窗時由父層更新一次，儲存過程不再整月重抓
    this.showToast('已儲存 ✓');
  }

  /** 「KiDit 建檔」分頁的單一儲存鈕：依序存病患資料與病史（同一筆事件） */
  isSavingRegistration = false;
  async saveRegistration(profileForm: { saveData: () => Promise<void> }, historyForm: { saveData: () => Promise<void> }): Promise<void> {
    this.isSavingRegistration = true;
    try {
      await profileForm.saveData();
      await historyForm.saveData();
    } finally {
      this.isSavingRegistration = false;
    }
  }

  handleIncompleteClick(event: any): void {
    this.selectPatient(event);
    this.handleTabClick('registration');
  }

  isKiDitDataComplete(event: any): boolean {
    // 原發病(diagnosisCategory)存於 kidit_profile，病史表單無此欄——
    // 舊判定讀 kidit_history.diagnosisCategory 永遠 false（2026-08-04 修正；與後端兩處判定同步）
    const hasProfile = event.kidit_profile && event.kidit_profile.idNumber;
    const hasHistory = event.kidit_history && event.kidit_profile?.diagnosisCategory;
    return !!hasProfile && !!hasHistory;
  }

  // Delete flow（列表已過濾 ACCESS，索引不再與 localEvents 對齊，改以事件 id 反查）
  deleteEvent(event: any): void {
    const index = this.localEvents.findIndex(e => e.id === event.id);
    if (index === -1) return;
    this.pendingDeleteIndex = index;
    this.confirmMessage = `確定要移除 ${event.patientName} 的這筆紀錄嗎？`;
    this.showConfirmDelete = true;
  }

  executeDelete(): void {
    if (this.pendingDeleteIndex !== -1) {
      const deletedEvent = this.localEvents[this.pendingDeleteIndex];
      this.localEvents.splice(this.pendingDeleteIndex, 1);
      if (deletedEvent.patientId === this.selectedPatientId) {
        this.selectedPatientId = null;
        this.selectedPatientName = '';
      }
      this.syncSelectionRefs();
      this.pendingDeleteIndex = -1;
    }
    this.showConfirmDelete = false;
  }

  cancelDelete(): void {
    this.showConfirmDelete = false;
    this.pendingDeleteIndex = -1;
  }

  async saveAllEvents(): Promise<void> {
    try {
      await kiditService.updateLogEvents(this.date, this.localEvents);
      this.showToast('動態列表已儲存 ✓');
    } catch (e) {
      console.error(e);
      alert('儲存失敗，請稍後再試。');
    }
  }

  close(): void {
    this.closeEvent.emit();
    this.activeTab = 'movement';
    this.selectedPatientId = null;
    this.syncSelectionRefs();
  }
}
