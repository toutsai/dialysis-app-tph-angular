// src/app/features/patients/patient-basic-profile/patient-basic-profile.component.ts
// 病歷查詢「基本資料」頁籤：病人層級人口學欄位 + KiDit 獨有六欄（patient_kidit_profile）的編輯入口。
// 權威＝patients 表（2026-08-27 期 1「一份資料、多個入口」）；KiDit 建檔存檔會由後端 hook 回寫此處。
// 存檔走 PUT /patients/:id/basic-profile（editor 以上），viewer 唯讀且身分證遮罩。
import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '@services/api.service';
import { AuthService } from '@services/auth.service';
import { PatientStoreService } from '@services/patient-store.service';
import type { Patient, PatientKiditProfile } from '@app/core/models/patient.model';
import { KIDIT_OPTIONS, type KiditOption } from '@/utils/kiditHelpers';
import { isoToRocDisplay, rocInputToIso } from '@/utils/rocDate';

/** 表單暫存（平面欄位 + KiDit 六欄），全部字串，存檔時原樣送出 */
interface BasicProfileForm {
  idNumber: string;
  isForeign: boolean;
  birthDate: string;
  gender: string; // '男' | '女' | ''
  // KiDit 專用
  dialysisCode: string;
  kiditStatus: string;
  hospitalStartDate: string;
  diagnosisCategory: string;
  diagnosisSubcategory: string;
  // 其他
  kiditPatientCategory: string;
  maritalStatus: string;
  bloodType: string;
  education: string;
  occupation: string;
  isIndigenous: string;
  isWelfare: string;
  catastrophicCardNo: string;
  emergencyContact: string;
  emergencyPhone: string;
  contactRelationship: string;
  // 住址
  phone: string;
  mobile: string;
  postalCode: string;
  address: string;
  registeredCity: string;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

@Component({
  selector: 'app-patient-basic-profile',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './patient-basic-profile.component.html',
  styleUrl: './patient-basic-profile.component.css',
})
export class PatientBasicProfileComponent implements OnChanges {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly patientStore = inject(PatientStoreService);

  @Input() patient: Patient | null = null;
  /** 存檔成功後帶回後端回應的完整病人（含 kiditProfile） */
  @Output() saved = new EventEmitter<Patient>();

  readonly opts = KIDIT_OPTIONS;
  readonly readOnly = computed(() => !this.auth.canEditPatients());

  readonly form = signal<BasicProfileForm>(this.emptyForm());
  readonly rocBirthInput = signal('');
  readonly rocBirthError = signal(false);
  readonly saveState = signal<SaveState>('idle');
  readonly saveMessage = signal('');

  /** 原發病細類依大類過濾（computed 而非 getter，模板每輪 CD 不重算） */
  readonly filteredSubcategories = computed<KiditOption[]>(() => {
    const cat = this.form().diagnosisCategory || '';
    const all = this.opts['diagnosisSubcategory'];
    return cat ? all.filter((o) => o.value === cat || o.value.startsWith(cat + '-')) : all;
  });

  /** viewer 看到的身分證遮罩：A12****789 */
  readonly maskedIdNumber = computed(() => {
    const id = this.form().idNumber || '';
    if (!id) return '—';
    if (id.length <= 6) return id.slice(0, 1) + '*'.repeat(Math.max(0, id.length - 1));
    return id.slice(0, 3) + '*'.repeat(id.length - 6) + id.slice(-3);
  });

  /** @Input 的 signal 鏡像（computed 只追蹤 signal，plain input 不會觸發重算） */
  private readonly patientSig = signal<Patient | null>(null);

  readonly sourceLabel = computed(() => {
    const p = this.patientSig();
    const src = (p?.basicSource as string) || '';
    const map: Record<string, string> = {
      manual: '手動',
      kidit: 'KiDit 建檔回寫',
      kidit_backfill: 'KiDit 回填',
      his: 'HIS',
    };
    const at = p?.kiditProfile?.updatedAt || '';
    return (map[src] || src) + (at ? `　最後更新 ${String(at).slice(0, 16)}` : '');
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['patient']) {
      this.loadFromPatient();
      this.saveState.set('idle');
      this.saveMessage.set('');
    }
  }

  private emptyForm(): BasicProfileForm {
    return {
      idNumber: '',
      isForeign: false,
      birthDate: '',
      gender: '',
      dialysisCode: '',
      kiditStatus: '',
      hospitalStartDate: '',
      diagnosisCategory: '',
      diagnosisSubcategory: '',
      kiditPatientCategory: '',
      maritalStatus: '',
      bloodType: '',
      education: '',
      occupation: '',
      isIndigenous: '',
      isWelfare: '',
      catastrophicCardNo: '',
      emergencyContact: '',
      emergencyPhone: '',
      contactRelationship: '',
      phone: '',
      mobile: '',
      postalCode: '',
      address: '',
      registeredCity: '',
    };
  }

  private loadFromPatient(): void {
    this.patientSig.set(this.patient);
    const p: any = this.patient || {};
    const k: PatientKiditProfile = p.kiditProfile || {};
    const s = (v: unknown) => (v == null ? '' : String(v));
    this.form.set({
      idNumber: s(p.idNumber),
      isForeign: p.isForeign === 'Y' || p.isForeign === true,
      birthDate: s(p.birthDate).slice(0, 10),
      gender: s(p.gender),
      dialysisCode: s(k.dialysisCode),
      kiditStatus: s(k.kiditStatus),
      hospitalStartDate: s(k.hospitalStartDate).slice(0, 10),
      diagnosisCategory: s(k.diagnosisCategory),
      diagnosisSubcategory: s(k.diagnosisSubcategory),
      kiditPatientCategory: s(p.kiditPatientCategory),
      maritalStatus: s(p.maritalStatus),
      bloodType: s(p.bloodType),
      education: s(p.education),
      occupation: s(p.occupation),
      isIndigenous: s(p.isIndigenous),
      isWelfare: s(p.isWelfare),
      catastrophicCardNo: s(k.catastrophicCardNo),
      emergencyContact: s(p.emergencyContact),
      emergencyPhone: s(p.emergencyPhone),
      contactRelationship: s(p.contactRelationship),
      phone: s(p.phone),
      mobile: s(p.mobile),
      postalCode: s(p.postalCode),
      address: s(p.address),
      registeredCity: s(p.registeredCity),
    });
    this.rocBirthInput.set(isoToRocDisplay(this.form().birthDate));
    this.rocBirthError.set(false);
  }

  /** 單欄更新（模板用 [ngModel]/(ngModelChange) 綁 signal） */
  patch<K extends keyof BasicProfileForm>(key: K, value: BasicProfileForm[K]): void {
    this.form.update((f) => ({ ...f, [key]: value }));
  }

  /** 換大類時，若已選細類不屬於新大類則清空 */
  onCategoryChange(cat: string): void {
    this.form.update((f) => {
      const sub = f.diagnosisSubcategory;
      const keep = !sub || sub === cat || sub.startsWith(cat + '-');
      return { ...f, diagnosisCategory: cat, diagnosisSubcategory: keep ? sub : '' };
    });
  }

  onIsoBirthChange(value: string): void {
    this.patch('birthDate', value || '');
    this.rocBirthInput.set(isoToRocDisplay(value || ''));
    this.rocBirthError.set(false);
  }

  onRocBirthChange(value: string): void {
    this.rocBirthInput.set(value);
    const iso = rocInputToIso(value);
    if (iso === null) {
      this.rocBirthError.set(true);
      return;
    }
    this.patch('birthDate', iso);
    this.rocBirthError.set(false);
  }

  async save(): Promise<void> {
    const id = this.patient?.id;
    if (!id || this.readOnly() || this.saveState() === 'saving') return;
    if (this.rocBirthError()) {
      this.saveState.set('error');
      this.saveMessage.set('出生民國年格式無法辨識');
      return;
    }
    const f = this.form();
    const body = {
      idNumber: f.idNumber.trim(),
      isForeign: f.isForeign ? 'Y' : 'N',
      birthDate: f.birthDate,
      gender: f.gender,
      kiditPatientCategory: f.kiditPatientCategory,
      maritalStatus: f.maritalStatus,
      bloodType: f.bloodType,
      education: f.education,
      occupation: f.occupation,
      isIndigenous: f.isIndigenous,
      isWelfare: f.isWelfare,
      emergencyContact: f.emergencyContact.trim(),
      emergencyPhone: f.emergencyPhone.trim(),
      contactRelationship: f.contactRelationship,
      phone: f.phone.trim(),
      mobile: f.mobile.trim(),
      postalCode: f.postalCode.trim(),
      address: f.address.trim(),
      registeredCity: f.registeredCity.trim(),
      kiditProfile: {
        dialysisCode: f.dialysisCode.trim(),
        kiditStatus: f.kiditStatus,
        hospitalStartDate: f.hospitalStartDate,
        diagnosisCategory: f.diagnosisCategory,
        diagnosisSubcategory: f.diagnosisSubcategory,
        catastrophicCardNo: f.catastrophicCardNo.trim(),
      },
    };
    this.saveState.set('saving');
    this.saveMessage.set('');
    try {
      const res = await firstValueFrom(
        this.api.put<Patient>(`/patients/${id}/basic-profile`, body),
      );
      this.saveState.set('saved');
      this.saveMessage.set('已儲存');
      if (res) {
        this.patient = res;
        this.loadFromPatient();
        this.saved.emit(res);
      }
      // 讓病人清單的 idNumber/phone 等同步
      this.patientStore.forceRefreshPatients().catch(() => {});
    } catch (err: any) {
      console.error('儲存基本資料失敗:', err);
      this.saveState.set('error');
      this.saveMessage.set(err?.error?.message || err?.message || '儲存失敗');
    }
  }
}
