import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
// Standalone 版：已移除 Firebase
import { AuthService } from '@services/auth.service';
import { NotificationService, type NotificationType } from '@services/notification.service';
import { UserDirectoryService, DirectoryUser } from '@services/user-directory.service';
import ApiManager from '@/services/api_manager';
import { getToday } from '@/utils/dateUtils';
import { AkCatalogService } from '@services/ak-catalog.service';
import { InventoryCatalogService } from '@services/inventory-catalog.service';
import { PatientSelectDialogComponent } from '../patient-select-dialog/patient-select-dialog.component';

interface SupplyItem {
  id: number;
  type: string;
  spec: string;
  quantity: number;
}

@Component({
  selector: 'app-task-create-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, PatientSelectDialogComponent],
  templateUrl: './task-create-dialog.component.html',
  styleUrl: './task-create-dialog.component.css'
})
export class TaskCreateDialogComponent implements OnChanges, OnInit {
  @Input() isVisible = false;
  @Input() preselectedPatient: any = null;
  @Input() allPatients: any[] = [];
  @Input() initialData: any = null;
  @Output() close = new EventEmitter<void>();
  @Output() submit = new EventEmitter<any>();

  private authService = inject(AuthService);
  private notificationService = inject(NotificationService);
  private userDirectoryService = inject(UserDirectoryService);
  /** AK 規格下拉來源：庫存「品項設定」為唯一權威，不再寫死清單（2026-09-15 AK 品名統一） */
  private akCatalog = inject(AkCatalogService);
  /** A液 / 其他耗材 下拉同樣讀品項設定（2026-09-15：交辦耗材選項改讀品項設定） */
  private inventoryCatalog = inject(InventoryCatalogService);
  private tasksApi = ApiManager('tasks');

  isSubmitting = false;
  isPatientDialogVisible = false;
  selectedPatient: any = null;

  formData = {
    id: null as string | null,
    category: 'message',
    assigneeRole: '',
    assigneeUserId: '',
    targetDate: getToday(),
    content: '',
    messageType: '常規'
  };

  readonly messageTypeOptions = [
    { value: '常規', label: '一般交班', icon: '📝' },
    { value: '抽血', label: '抽血提醒', icon: '🩸' },
    { value: '衛教', label: '衛教事項', icon: '📢' },
  ];

  readonly assigneeOptions = [
    { value: 'clerk', label: '書記' },
    { value: 'doctor', label: '醫師' },
    { value: 'np', label: '專科護理師' },
    { value: 'nurse_individual', label: '護理師 (指定)' },
    { value: 'nurse_leader', label: '護理師組長' },
  ];

  private readonly titleToRoleValue: Record<string, string> = {
    '書記': 'clerk',
    '主治醫師': 'doctor',
    '專科護理師': 'np',
    '護理師': 'nurse_individual',
    '護理長': 'nurse_individual',
  };

  /** 品項設定的 AK 品名（視窗開啟時載入；memoize 成欄位，模板勿用 getter 重算） */
  akOptions: string[] = [];
  /** 品項設定「透析藥水CA」品名；目錄載入失敗/空白時退回舊固定值，避免視窗卡住 */
  aLiquidOptions: string[] = ['2.5', '3.0', '3.5'];
  /** B液維持交辦慣用名稱（品項設定的 B液 品名是盤點/HIS 用的長名，不適合寫進交辦內容） */
  readonly bLiquidOptions = ['5L B液', '罐裝B粉', '袋裝B粉'];
  /** 品項設定「其他耗材」品名（Tubing、NS、傷口照護包…由書記在品項設定維護） */
  otherSupplyOptions: string[] = [];

  /** 類型只剩四類：AK / A液 / B液 各自規格，其餘耗材一律走「其他耗材」＋品項設定的品名 */
  supplyTypeOptions = [
    { value: 'AK', label: 'AK' },
    { value: 'A液', label: 'A液' },
    { value: 'B液', label: 'B液' },
    { value: '其他耗材', label: '其他耗材' },
  ];
  /** 需要選規格的類型（四類皆是） */
  private readonly SPEC_REQUIRED_TYPES = ['AK', 'A液', 'B液', '其他耗材'];

  dynamicSupplyItems: SupplyItem[] = [];
  otherSupplyInfo = '';

  get isEditMode(): boolean {
    // 只有帶 id 的既有項目才算編輯；帶 {patientId, patientName} 的預選種子屬於「新增」
    return !!this.initialData?.id;
  }

  get isClerkSupplyTask(): boolean {
    return this.formData.category === 'task' && this.formData.assigneeRole === 'clerk' && !this.isEditMode;
  }

  get filteredAssigneeUsers(): DirectoryUser[] {
    // clerk 與 nurse_leader 走職務廣播，不選個人
    if (!this.formData.assigneeRole || this.formData.assigneeRole === 'nurse_leader' || this.formData.assigneeRole === 'clerk') return [];
    return this.userDirectoryService.users()
      .filter((user: DirectoryUser) => this.titleToRoleValue[user.title] === this.formData.assigneeRole)
      .sort((a: DirectoryUser, b: DirectoryUser) => (a.name || '').localeCompare(b.name || ''));
  }

  get selectedAssigneeLabel(): string {
    const matched = this.assigneeOptions.find(opt => opt.value === this.formData.assigneeRole);
    return matched?.label || '指定職務';
  }

  get selectedAssigneeUser(): DirectoryUser | null {
    return this.userDirectoryService.users().find((user: DirectoryUser) => user.uid === this.formData.assigneeUserId) || null;
  }

  get isFormValid(): boolean {
    if (this.isEditMode) return true;
    if (this.isClerkSupplyTask) {
      const allItemsValid = this.dynamicSupplyItems.every(item => {
        if (this.SPEC_REQUIRED_TYPES.includes(item.type)) {
          return item.type && item.spec && item.quantity > 0;
        }
        return item.type && item.quantity > 0;
      });
      if (this.dynamicSupplyItems.length === 0) return this.otherSupplyInfo.trim() !== '';
      return allItemsValid;
    }
    if (this.formData.category === 'task') {
      if (this.formData.assigneeRole === 'nurse_leader' || this.formData.assigneeRole === 'clerk') return true;
      if (!this.formData.assigneeRole || !this.formData.assigneeUserId) return false;
    }
    return true;
  }

  ngOnInit() {
    this.userDirectoryService.ensureUsersLoaded().catch(err => console.error('Failed to load user directory', err));
    this.loadAkOptions();
  }

  /** 三個下拉的來源都是品項設定；各自載入完成才覆蓋欄位，載入失敗保留現值 */
  private loadAkOptions(): void {
    void this.akCatalog.ensureLoaded().then(() => {
      this.akOptions = this.akCatalog.names();
    });
    void this.inventoryCatalog.ensureLoaded('dialysateCa').then(() => {
      const names = this.inventoryCatalog.names('dialysateCa');
      if (names.length > 0) this.aLiquidOptions = names;
    });
    void this.inventoryCatalog.ensureLoaded('otherSupplies').then(() => {
      this.otherSupplyOptions = this.inventoryCatalog.names('otherSupplies');
    });
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['isVisible'] && this.isVisible) {
      this.userDirectoryService.ensureUsersLoaded().catch(err => console.error('Failed to load user directory', err));
      this.loadAkOptions();
      if (this.isEditMode) {
        const item = this.initialData;
        this.formData.id = item.id;
        this.formData.category = item.assignee ? 'task' : 'message';
        if (item.assignee) {
          if (item.assignee.type === 'role') {
            // 職務廣播：editor=護理師組長，其餘（如 clerk）直接對應職務值
            this.formData.assigneeRole = item.assignee.role === 'editor' ? 'nurse_leader' : (item.assignee.role || '');
            this.formData.assigneeUserId = '';
          } else if (item.assignee.type === 'user' && item.assignee.role === 'editor') {
            this.formData.assigneeRole = 'nurse_individual';
            this.formData.assigneeUserId = item.assignee.value;
          } else {
            this.formData.assigneeRole = item.assignee.role || item.assignee.value || '';
            this.formData.assigneeUserId = item.assignee.value;
          }
        }
        this.formData.targetDate = item.targetDate || getToday();
        this.formData.content = item.content;
        this.formData.messageType = item.type || '常規';
        if (item.patientId) {
          this.selectedPatient = this.allPatients.find(p => p.id === item.patientId) || null;
        } else {
          this.selectedPatient = null;
        }
      } else {
        this.resetForm();
        // 新增模式若帶有預選病人種子（如從 MyPatientsView 對特定病人新增留言），預選該病人
        const seed = this.initialData;
        if (seed?.patientId) {
          this.selectedPatient =
            this.allPatients.find(p => p.id === seed.patientId) ||
            { id: seed.patientId, name: seed.patientName };
        }
      }
    }
  }

  addSupplyItem() {
    this.dynamicSupplyItems.push({ id: Date.now(), type: '', spec: '', quantity: 1 });
  }

  removeSupplyItem(index: number) {
    this.dynamicSupplyItems.splice(index, 1);
  }

  onItemTypeChange(item: SupplyItem) {
    item.spec = '';
  }

  selectAssigneeRole(role: string) {
    this.formData.assigneeRole = role;
    this.formData.assigneeUserId = '';
    const candidates = this.filteredAssigneeUsers;
    if (candidates.length === 1) {
      this.formData.assigneeUserId = candidates[0].uid;
    }
  }

  resetForm() {
    this.formData = {
      id: null,
      category: 'message',
      assigneeRole: '',
      assigneeUserId: '',
      targetDate: getToday(),
      content: '',
      messageType: '常規'
    };
    this.selectedPatient = this.preselectedPatient || null;
    this.dynamicSupplyItems = [];
    this.otherSupplyInfo = '';
  }

  handlePatientSelected(event: any) {
    const patientId = event.patientId || event;
    this.selectedPatient = this.allPatients.find(p => p.id === patientId) || null;
    this.isPatientDialogVisible = false;
  }

  clearPatient() {
    this.selectedPatient = null;
  }

  decrementQuantity(item: SupplyItem) {
    if (item.quantity > 0) item.quantity--;
  }

  incrementQuantity(item: SupplyItem) {
    item.quantity++;
  }

  async handleSubmit() {
    if (this.isClerkSupplyTask) {
      const parts = this.dynamicSupplyItems
        .filter(item => item.type && item.quantity > 0)
        .map(item => {
          // 其他耗材：品名本身就是項目（Tubing、鼻導管…），不再套「其他耗材 (…)」
          if (item.type === '其他耗材' && item.spec) return `${item.spec} x${item.quantity}`;
          let itemName = this.supplyTypeOptions.find(opt => opt.value === item.type)?.label || item.type;
          if (item.spec) itemName += ` (${item.spec})`;
          return `${itemName} x${item.quantity}`;
        });
      let generatedContent = parts.length > 0 ? `補帳：${parts.join('、')}` : '';
      if (this.otherSupplyInfo.trim()) {
        generatedContent += `${generatedContent ? '。' : ''}其他：${this.otherSupplyInfo.trim()}`;
      }
      this.formData.content = generatedContent;
    }

    if (!this.isFormValid) return;
    this.isSubmitting = true;
    const currentUser = this.authService.currentUser();

    if (!this.isEditMode) {
      const expireAtDate = new Date();
      expireAtDate.setMonth(expireAtDate.getMonth() + 2);

      const dataToSave: any = {
        category: this.formData.category,
        content: this.formData.content.trim(),
        status: 'pending',
        creator: {
          uid: currentUser?.uid,
          name: currentUser?.name,
          title: currentUser?.title,
        },
        patientId: this.selectedPatient?.id || null,
        patientName: this.selectedPatient?.name || null,
        createdAt: new Date().toISOString(),
        expireAt: expireAtDate,
      };

      if (dataToSave.category === 'task') {
        if (this.formData.assigneeRole === 'nurse_leader') {
          dataToSave.assignee = { type: 'role', role: 'editor', value: 'editor', name: '護理師組長', title: '職務指派' };
        } else if (this.formData.assigneeRole === 'clerk') {
          dataToSave.assignee = { type: 'role', role: 'clerk', value: 'clerk', name: '書記', title: '職務指派' };
        } else if (this.formData.assigneeRole === 'nurse_individual') {
          dataToSave.assignee = { type: 'user', role: 'editor', value: this.formData.assigneeUserId, name: this.selectedAssigneeUser?.name || '', title: this.selectedAssigneeUser?.title || '' };
        } else {
          dataToSave.assignee = { type: 'user', role: this.formData.assigneeRole, value: this.formData.assigneeUserId, name: this.selectedAssigneeUser?.name || '', title: this.selectedAssigneeUser?.title || '' };
        }
        dataToSave.targetDate = getToday();
      } else {
        dataToSave.type = this.formData.messageType;
        dataToSave.targetDate = this.formData.targetDate;
        dataToSave.assignee = null;
      }

      try {
        const savedDoc = await this.tasksApi.save(dataToSave);
        let notifMessage = '';
        let notifType: NotificationType = 'info';
        if (dataToSave.category === 'message') {
          const typeLabel = this.messageTypeOptions.find(opt => opt.value === dataToSave.type)?.label || '新留言';
          const patientPart = dataToSave.patientName ? `給 ${dataToSave.patientName}` : '';
          const contentPart = dataToSave.content.substring(0, 15) + (dataToSave.content.length > 15 ? '...' : '');
          notifMessage = `${typeLabel}: ${patientPart} - ${contentPart}`;
          notifType = 'message';
        } else {
          const assigneeLabel = dataToSave.assignee.name || '指定人員';
          notifMessage = `新交辦: 給 ${assigneeLabel} - ${dataToSave.content.substring(0, 20)}...`;
          notifType = 'task';
        }
        this.notificationService.createGlobalNotification(notifMessage, notifType);
        this.submit.emit({ ...dataToSave, id: savedDoc.id });
        this.handleClose();
      } catch (error) {
        console.error('Failed to create:', error);
      } finally {
        this.isSubmitting = false;
      }
    } else {
      const dataToUpdate: any = {
        content: this.formData.content.trim(),
        lastEditedBy: { uid: currentUser?.uid, name: currentUser?.name },
        lastEditedAt: new Date().toISOString(),
      };
      if (this.formData.category === 'message') {
        dataToUpdate.type = this.formData.messageType;
        dataToUpdate.targetDate = this.formData.targetDate;
      }
      this.submit.emit({ id: this.formData.id, ...dataToUpdate });
      this.isSubmitting = false;
    }
  }

  handleClose(): void {
    this.close.emit();
  }
}
