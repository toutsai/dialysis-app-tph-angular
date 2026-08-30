import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { KIDIT_HISTORY_OPTIONS } from '@/utils/kiditHelpers';
import { kiditService } from '@/services/kiditService';
import {
  VASCULAR_ACCESS_TYPES,
  VASCULAR_ACCESS_SIDES,
  siteOptionsForType,
} from '@app/core/constants/vascular-access-codes';

@Component({
  selector: 'app-kidit-history-form',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './kidit-history-form.component.html',
  styleUrls: ['./kidit-form-official.css', './kidit-history-form.component.css']
})
export class KiditHistoryFormComponent implements OnChanges {
  @Input() date = '';
  @Input() eventId = '';
  @Input() initialData: any = null;
  @Input() masterPatient: any = null;
  /** true=隱藏表單自身的儲存鈕（由外層「KiDit 建檔」分頁的單一儲存鈕呼叫 saveData） */
  @Input() hideSave = false;
  @Output() updated = new EventEmitter<any>();

  isSaving = false;
  formData: any = {};

  readonly opts = KIDIT_HISTORY_OPTIONS;

  // 首次瘻管建立（比照官方病史頁；站內欄位，沿用造管官方代碼表）
  readonly ffTypes = VASCULAR_ACCESS_TYPES;
  readonly ffSides = VASCULAR_ACCESS_SIDES;
  get ffSiteOptions() {
    return siteOptionsForType(this.formData?.firstFistulaType || null);
  }
  onFirstFistulaTypeChange(): void {
    const site = this.formData?.firstFistulaSite;
    if (site && !this.ffSiteOptions.some((o) => o.code === site)) {
      this.formData.firstFistulaSite = '';
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
      const h = this.masterPatient.kiditProfile?.history || {};
      this.formData = {
        isTransferFromOther: h.isTransferFromOther || '',
        transferFromName: h.transferFromName || '',
        transferFromCode: h.transferFromCode || '',
        startHDDate: h.startHDDate || '',
        isStartHDHere: h.isStartHDHere || 'N',
        startHDHospital: h.startHDHospital || '',
        startPDDate: h.startPDDate || '',
        isStartPDHere: h.isStartPDHere || 'N',
        startPDHospital: h.startPDHospital || '',
        transplantDate: h.transplantDate || '',
        isTransplantHere: h.isTransplantHere || 'N',
        transplantHospital: h.transplantHospital || '',
        isKnownCKD: h.isKnownCKD || 'N',
        isBUNCreatAbnormal: h.isBUNCreatAbnormal || 'N',
        abnormalLabDate: h.abnormalLabDate || '',
        initialBUN: h.initialBUN || '',
        initialCr: h.initialCr || '',
        renalUltrasoundAbnormal: h.renalUltrasoundAbnormal || 'N',
        renalUltrasoundDesc: h.renalUltrasoundDesc || '',
        renalUltrasoundOtherDesc: h.renalUltrasoundOtherDesc || '',
        renalUltrasoundDate: h.renalUltrasoundDate || '',
        selectedSystemicDiseases: h.selectedSystemicDiseases || [],
        otherSystemicDescription: h.otherSystemicDescription || '',
        dmType: h.dmType || '3',
        initialLabDate: h.initialLabDate || '',
        initialHct: h.initialHct || '',
        initialHb: h.initialHb || '',
        initialLabBUN: h.initialLabBUN || '',
        initialLabCr: h.initialLabCr || '',
        initialK: h.initialK || '',
        initialCCr: h.initialCCr || '',
        initialAlb: h.initialAlb || '',
        initialWeight: h.initialWeight || '',
        initialHeight: h.initialHeight || '',
        initialEGFR: h.initialEGFR || '',
        // 33/34：病人清單 B/C 肝四態（組長建檔確認、同碼）為權威帶入；舊 kiditProfile 病史值次之
        hbsag: this.listHepatitis?.hbsag || h.hbsag || 'O',
        antihcv: this.listHepatitis?.antihcv || h.antihcv || 'O',
        // 站內欄：33/34 選「已作待追蹤(F)」時的追蹤日期（不匯出）；病人清單自 2026-08-30 改存 *Date（檢驗日期）
        hbsagFollowDate: this.listHepatitis?.hbsagDate || h.hbsagFollowDate || '',
        antihcvFollowDate: this.listHepatitis?.antihcvDate || h.antihcvFollowDate || '',
        indicationType: h.indicationType || '1',
        selectedSymptoms: h.selectedSymptoms || [],
        symptomsOtherDescription: h.symptomsOtherDescription || '',
        selectedEmergencyReasons: h.selectedEmergencyReasons || [],
        emergencyReasonsOtherDescription: h.emergencyReasonsOtherDescription || '',
        emergencyLabDate: h.emergencyLabDate || '',
        emergencyHct: h.emergencyHct || '',
        emergencyHb: h.emergencyHb || '',
        emergencyBUN: h.emergencyBUN || '',
        emergencyCr: h.emergencyCr || '',
        emergencyCCr: h.emergencyCCr || '',
        emergencyNa: h.emergencyNa || '',
        emergencyK: h.emergencyK || '',
        emergencyHCO3: h.emergencyHCO3 || '',
        emergencyAlb: h.emergencyAlb || '',
        isFirstCatastrophic: h.isFirstCatastrophic || 'N',
        firstFistulaDate: h.firstFistulaDate || '',
        firstFistulaType: h.firstFistulaType || '',
        firstFistulaSide: h.firstFistulaSide || '',
        firstFistulaSite: h.firstFistulaSite || '',
      };
    } else {
      this.formData = {};
    }
    // 站內欄位：舊資料沒有他院轉入旗標時，依既有轉入院所欄位推導
    if (Object.keys(this.formData).length && !this.formData.isTransferFromOther) {
      this.formData.isTransferFromOther =
        this.formData.transferFromName || this.formData.transferFromCode ? 'Y' : 'N';
    }
  }

  /** 病人清單的 B/C 肝四態（GET /patients/:id 的 hepatitisStatus；未回填的舊列後端已由標籤推導） */
  get listHepatitis(): { hbsag?: string; antihcv?: string; hbsagDate?: string; antihcvDate?: string } | null {
    const s = this.masterPatient?.hepatitisStatus;
    return s && (s.hbsag || s.antihcv) ? s : null;
  }

  /** 既有病史值與病人清單不符時的提示文字（單向：清單為權威，不自動覆寫已存的病史） */
  hepatitisMismatch(key: 'hbsag' | 'antihcv'): string {
    const listVal = this.listHepatitis?.[key];
    if (!listVal || !this.formData?.[key] || this.formData[key] === listVal) return '';
    const label = this.opts.hepatitis.find((o: any) => o.value === listVal)?.label || listVal;
    return `與病人清單不符（清單：${label}）`;
  }

  /** 一鍵改為病人清單的值 */
  applyListHepatitis(key: 'hbsag' | 'antihcv'): void {
    const s = this.listHepatitis;
    if (!s?.[key]) return;
    this.formData[key] = s[key];
    const dateKey = key === 'hbsag' ? 'hbsagFollowDate' : 'antihcvFollowDate';
    const listDate = key === 'hbsag' ? s.hbsagDate : s.antihcvDate;
    this.formData[dateKey] = s[key] === 'F' ? listDate || '' : '';
  }

  onTransferFromOtherChange(val: string): void {
    this.formData.isTransferFromOther = val;
    if (val === 'N') {
      this.formData.transferFromName = '';
      this.formData.transferFromCode = '';
    }
  }

  // Checkbox array toggle helpers
  isSystemicDiseaseChecked(idx: number): boolean {
    return (this.formData.selectedSystemicDiseases || []).includes(idx);
  }
  toggleSystemicDisease(idx: number): void {
    const arr = this.formData.selectedSystemicDiseases || [];
    const i = arr.indexOf(idx);
    if (i > -1) arr.splice(i, 1); else arr.push(idx);
    this.formData.selectedSystemicDiseases = [...arr];
  }

  isSymptomChecked(idx: number): boolean {
    return (this.formData.selectedSymptoms || []).includes(idx);
  }
  toggleSymptom(idx: number): void {
    const arr = this.formData.selectedSymptoms || [];
    const i = arr.indexOf(idx);
    if (i > -1) arr.splice(i, 1); else arr.push(idx);
    this.formData.selectedSymptoms = [...arr];
  }

  async saveData(): Promise<void> {
    this.isSaving = true;
    try {
      await kiditService.updateEventKiDitData(this.date, this.eventId, 'kidit_history', this.formData);
      this.updated.emit(this.formData);
    } catch (error) {
      console.error('儲存失敗:', error);
      alert('儲存失敗');
    } finally {
      this.isSaving = false;
    }
  }
}
