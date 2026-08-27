import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { KIDIT_OPTIONS, KiditOption } from '@/utils/kiditHelpers';
import { kiditService } from '@/services/kiditService';
import { isoToRocDisplay, rocInputToIso } from '@/utils/rocDate';

@Component({
  selector: 'app-kidit-patient-form',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './kidit-patient-form.component.html',
  styleUrls: ['./kidit-form-official.css', './kidit-patient-form.component.css']
})
export class KiditPatientFormComponent implements OnChanges {
  @Input() date = '';
  @Input() eventId = '';
  @Input() initialData: any = null;
  @Input() masterPatient: any = null;
  /** true=隱藏表單自身的儲存鈕（由外層「KiDit 建檔」分頁的單一儲存鈕呼叫 saveData） */
  @Input() hideSave = false;
  @Output() updated = new EventEmitter<any>();

  isSaving = false;
  formData: any = {};

  /** 生日民國年輸入框（顯示/輸入民國，儲存仍為西元 YYYY-MM-DD，匯出端 toRocDate 不受影響） */
  rocBirthInput = '';
  rocBirthError = false;

  readonly opts = KIDIT_OPTIONS;

  // 細類依所選大類過濾（memoize，模板每輪 CD 呼叫不重算）
  private subcatCache: { cat: string; list: KiditOption[] } | null = null;
  get filteredSubcategories(): KiditOption[] {
    const cat = this.formData?.diagnosisCategory || '';
    if (this.subcatCache?.cat === cat) return this.subcatCache.list;
    const all = this.opts['diagnosisSubcategory'] as KiditOption[];
    const list = cat ? all.filter(o => o.value === cat || o.value.startsWith(cat + '-')) : all;
    this.subcatCache = { cat, list };
    return list;
  }

  /** 換大類時，若已選細類不屬於新大類則清空 */
  handleCategoryChange(): void {
    const sub = this.formData?.diagnosisSubcategory;
    if (sub && !this.filteredSubcategories.some(o => o.value === sub)) {
      this.formData.diagnosisSubcategory = '';
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['initialData'] || changes['masterPatient']) {
      this.initData();
    }
  }

  private initData(): void {
    if (this.initialData) {
      this.formData = JSON.parse(JSON.stringify(this.initialData));
    } else if (this.masterPatient) {
      // 尚無事件快照 → 從病人層級權威帶入（2026-08-27 期 1）：
      // 平面人口學欄位在 patients（GET /patients/:id），KiDit 獨有六欄在 patient.kiditProfile（patient_kidit_profile）。
      const p = this.masterPatient;
      const k = p.kiditProfile || {};
      this.formData = {
        name: p.name || '',
        idNumber: p.idNumber || '',
        medicalRecordNumber: p.medicalRecordNumber || '',
        patientCategory: p.kiditPatientCategory || '00',
        birthDate: p.birthDate || '',
        gender: p.gender ? (p.gender === '男' ? '1' : '2') : '',
        bloodType: p.bloodType || '',
        isIndigenous: p.isIndigenous || 'N',
        isWelfare: p.isWelfare || 'N',
        catastrophicCardNo: k.catastrophicCardNo || '',
        address: p.address || '',
        phone: p.phone || '',
        maritalStatus: p.maritalStatus || '',
        education: p.education || '',
        occupation: p.occupation || '',
        contactPerson: p.emergencyContact || '',
        relationship: p.contactRelationship || '',
        dialysisCode: k.dialysisCode || '',
        status: k.kiditStatus || '1',
        firstDialysisDate: p.firstDialysisDate || '',
        hospitalStartDate: k.hospitalStartDate || '',
        diagnosisCategory: k.diagnosisCategory || '',
        diagnosisSubcategory: k.diagnosisSubcategory || '',
      };
    } else {
      this.formData = {};
    }
    this.rocBirthInput = isoToRocDisplay(this.formData?.birthDate || '');
    this.rocBirthError = false;
  }

  /** 西元日期欄輸入 → 同步民國顯示欄（官方版面兩欄並列，任填一欄自動換算） */
  onIsoBirthChange(value: string): void {
    this.formData.birthDate = value || '';
    this.rocBirthInput = isoToRocDisplay(this.formData.birthDate);
    this.rocBirthError = false;
  }

  /**
   * 民國年輸入 → 西元存檔（換算規則在 utils/rocDate.ts，與基本資料頁籤共用）。
   * 解析成功才更新 birthDate；清空輸入＝清空生日。
   */
  onRocBirthChange(value: string): void {
    this.rocBirthInput = value;
    const iso = rocInputToIso(value);
    if (iso === null) {
      this.rocBirthError = true;
      return;
    }
    this.formData.birthDate = iso;
    this.rocBirthError = false;
  }

  async saveData(): Promise<void> {
    this.isSaving = true;
    try {
      await kiditService.updateEventKiDitData(this.date, this.eventId, 'kidit_profile', this.formData);
      this.updated.emit(this.formData);
    } catch (error) {
      console.error('儲存失敗:', error);
      alert('儲存失敗');
    } finally {
      this.isSaving = false;
    }
  }
}
