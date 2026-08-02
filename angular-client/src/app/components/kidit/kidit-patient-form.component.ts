import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { KIDIT_OPTIONS, KiditOption } from '@/utils/kiditHelpers';
import { kiditService } from '@/services/kiditService';

@Component({
  selector: 'app-kidit-patient-form',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './kidit-patient-form.component.html',
  styleUrl: './kidit-patient-form.component.css'
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
      const p = this.masterPatient;
      const k = p.kiditProfile || {};
      this.formData = {
        name: p.name || '',
        idNumber: k.idNumber || p.idNumber || '',
        medicalRecordNumber: k.medicalRecordNumber || p.medicalRecordNumber || '',
        patientCategory: k.patientCategory || '00',
        birthDate: k.birthDate || p.birthDate || '',
        gender: k.gender || (p.gender === '男' ? '1' : '2'),
        bloodType: k.bloodType || '',
        isIndigenous: k.isIndigenous || 'N',
        isWelfare: k.isWelfare || 'N',
        catastrophicCardNo: k.catastrophicCardNo || '',
        address: k.address || '',
        phone: k.phone || '',
        maritalStatus: k.maritalStatus || '',
        education: k.education || '',
        occupation: k.occupation || '',
        contactPerson: k.contactPerson || '',
        relationship: k.relationship || '',
        dialysisCode: k.dialysisCode || '',
        status: k.status || '1',
        firstDialysisDate: k.firstDialysisDate || '',
        hospitalStartDate: k.hospitalStartDate || '',
        diagnosisCategory: k.diagnosisCategory || '',
        diagnosisSubcategory: k.diagnosisSubcategory || '',
      };
    } else {
      this.formData = {};
    }
    this.rocBirthInput = this.isoToRocDisplay(this.formData?.birthDate || '');
    this.rocBirthError = false;
  }

  /** 西元 YYYY-MM-DD → 民國顯示（45/08/15）；無法解析回空字串 */
  private isoToRocDisplay(iso: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return '';
    const y = Number(m[1]) - 1911;
    if (y <= 0) return '';
    return `${y}/${m[2]}/${m[3]}`;
  }

  /**
   * 民國年輸入 → 西元存檔。接受「45/08/15」「45.8.15」「45-8-15」或連碼「450815」「0450815」。
   * 解析成功才更新 birthDate；清空輸入＝清空生日。
   */
  onRocBirthChange(value: string): void {
    this.rocBirthInput = value;
    const t = String(value || '').trim();
    if (!t) {
      this.formData.birthDate = '';
      this.rocBirthError = false;
      return;
    }
    let y = 0, mo = 0, d = 0;
    const sep = /^(\d{1,3})[\/.\-年](\d{1,2})[\/.\-月](\d{1,2})日?$/.exec(t);
    if (sep) {
      y = Number(sep[1]); mo = Number(sep[2]); d = Number(sep[3]);
    } else if (/^\d{6,7}$/.test(t)) {
      y = Number(t.slice(0, t.length - 4));
      mo = Number(t.slice(t.length - 4, t.length - 2));
      d = Number(t.slice(t.length - 2));
    }
    if (y >= 1 && y <= 200 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      const p2 = (n: number) => String(n).padStart(2, '0');
      this.formData.birthDate = `${y + 1911}-${p2(mo)}-${p2(d)}`;
      this.rocBirthError = false;
    } else {
      this.rocBirthError = true;
    }
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
