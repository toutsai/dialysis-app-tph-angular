import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiConfigService } from '@services/api-config.service';
import {
  ConsumableItemMappingDialogComponent,
  type ConsumableItemMappingRequest,
  type ConsumableItemMappings,
} from '@app/components/dialogs/consumable-item-mapping-dialog/consumable-item-mapping-dialog.component';

/**
 * 庫存管理「上傳消耗 Excel」modal（原 inventory.component 消耗紀錄/上傳子頁籤搬出）。
 * 上傳成功（含品項對照確認後成功）→ 發出 uploaded；父元件負責
 * stock.invalidateActualRanges() 並重載 uploadRanges，本元件不直接碰 InventoryStockService。
 */
@Component({
  selector: 'app-inventory-upload',
  standalone: true,
  imports: [CommonModule, FormsModule, ConsumableItemMappingDialogComponent],
  templateUrl: './inventory-upload.component.html',
  styleUrl: './inventory-upload.component.css',
})
export class InventoryUploadComponent {
  private readonly firebaseService = inject(ApiConfigService);

  /** 品項對照確認視窗需要（後端 needsItemMapping 回應本身也帶 inventoryItems，此 Input 依契約保留） */
  @Input() inventoryItems: any[] = [];

  @Output() uploaded = new EventEmitter<void>();
  @Output() alert = new EventEmitter<{ title: string; message: string }>();
  @Output() close = new EventEmitter<void>();

  selectedFile = signal<File | null>(null);
  isUploading = signal(false);
  uploadResult = signal<any>(null);
  isDragOver = signal(false);
  itemMappingRequest = signal<ConsumableItemMappingRequest | null>(null);

  onOverlayClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.close.emit();
    }
  }

  onFileSelect(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      this.selectedFile.set(input.files[0]);
      this.uploadResult.set(null);
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(false);
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      this.selectedFile.set(files[0]);
      this.uploadResult.set(null);
    }
  }

  private toBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve((reader.result as string).replace(/^data:(.*,)?/, ''));
      reader.onerror = (error) => reject(error);
    });
  }

  async handleUpload(): Promise<void> {
    const file = this.selectedFile();
    if (!file) {
      this.alert.emit({ title: '提示', message: '請先選擇一個檔案！' });
      return;
    }
    await this.postConsumablesUpload(file);
  }

  /**
   * 送後端解析；品名對不上「品項設定」時後端回 needsItemMapping 且不寫入，
   * 這裡開對照確認視窗，使用者確認後帶 itemMappings 重送同一檔
   */
  private async postConsumablesUpload(file: File, itemMappings?: ConsumableItemMappings): Promise<void> {
    this.isUploading.set(true);
    this.uploadResult.set(null);
    this.itemMappingRequest.set(null);
    try {
      const fileContentBase64 = await this.toBase64(file);
      const res = await fetch(`${this.firebaseService.apiBaseUrl}/consumables/process`, {
        method: 'POST',
        headers: this.firebaseService.getHeaders(),
        body: JSON.stringify({
          fileName: file.name,
          fileContent: fileContentBase64,
          ...(itemMappings ? { itemMappings } : {}),
        }),
      });
      const resultData = await res.json();
      if (resultData?.needsItemMapping) {
        this.itemMappingRequest.set(resultData as ConsumableItemMappingRequest);
        return;
      }
      this.uploadResult.set(resultData);
      if (resultData?.success) {
        this.uploaded.emit();
      }
    } catch (error: any) {
      console.error('上傳處理失敗:', error);
      this.uploadResult.set({ message: `上傳失敗: ${error.message}`, errorCount: 1 });
    } finally {
      this.isUploading.set(false);
    }
  }

  async onItemMappingConfirm(mappings: ConsumableItemMappings): Promise<void> {
    const file = this.selectedFile();
    this.itemMappingRequest.set(null);
    if (!file) {
      this.alert.emit({ title: '提示', message: '找不到原始檔案，請重新選擇檔案再上傳。' });
      return;
    }
    await this.postConsumablesUpload(file, mappings);
  }

  onItemMappingCancel(): void {
    this.itemMappingRequest.set(null);
    this.uploadResult.set({
      message: '已取消上傳：品項對照未確認，未寫入任何資料。',
      errorCount: 0,
      cancelled: true,
    });
  }
}
