// 預約洗腎登記（原名登記本，2026-09-05 改名）：本院既有病人 / 他院待排病人 兩頁籤，
// 登記後依「預約頻率（星期多選）＋預約班別＋B/C 肝」比對床位總表的長期空床（後端 /reservations/match）。
// 權限：admin/editor。他院病人刻意不進病人清單（排定後另行建檔）。
import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '@services/api.service';
import { PatientStoreService, type Patient } from '@services/patient-store.service';

type Kind = 'existing' | 'external';
type ShiftCode = 'early' | 'noon' | 'late';
type ReservationStatus = 'pending' | 'scheduled' | 'cancelled';
type StatusFilter = ReservationStatus | 'all';
type HepValue = 'Y' | 'N' | 'O' | 'F' | '';

interface Reservation {
  id: string;
  kind: Kind;
  patientId: string | null;
  patientDeleted?: boolean;
  name: string;
  medicalRecordNumber: string;
  registeredDate: string;
  freqDays: number[];
  freq: string | null;
  shift: ShiftCode | '';
  originClinic: string;
  hbsag: HepValue;
  antihcv: HepValue;
  contactName: string;
  contactRelation: string;
  contactPhone: string;
  status: ReservationStatus;
  matchedBed: string;
  note: string;
  createdBy?: { name?: string };
  updatedBy?: { name?: string };
  createdAt?: string;
  updatedAt?: string;
}

interface MatchConflict {
  patientId: string;
  patientName: string;
  freq?: string;
  days?: string;
  date?: string;
}

interface MatchBed {
  bedNum: number;
  isolation: boolean;
  available: boolean;
  recommended: boolean;
  masterConflicts: MatchConflict[];
  scheduleConflicts: MatchConflict[];
}

interface MatchResult {
  shift: ShiftCode;
  freqDays: number[];
  freq: string | null;
  freqLabel: string;
  isolationRequired: boolean;
  hepatitisUnknown: boolean;
  horizonStart: string;
  horizonEnd: string;
  beds: MatchBed[];
}

interface ReservationForm {
  kind: Kind;
  patientId: string;
  name: string;
  registeredDate: string;
  freqDays: number[];
  shift: ShiftCode | '';
  originClinic: string;
  hbsag: HepValue;
  antihcv: HepValue;
  contactName: string;
  contactRelation: string;
  contactPhone: string;
  note: string;
}

const DAY_OPTIONS: { idx: number; label: string }[] = [
  { idx: 0, label: '一' },
  { idx: 1, label: '二' },
  { idx: 2, label: '三' },
  { idx: 3, label: '四' },
  { idx: 4, label: '五' },
  { idx: 5, label: '六' },
];

const SHIFT_OPTIONS: { code: ShiftCode; label: string }[] = [
  { code: 'early', label: '早班' },
  { code: 'noon', label: '午班' },
  { code: 'late', label: '晚班' },
];

/** 他院病人手填 B/C 肝（與病人清單四態同碼） */
const HEP_OPTIONS: { value: HepValue; label: string }[] = [
  { value: '', label: '未填' },
  { value: 'Y', label: '陽性(+)' },
  { value: 'N', label: '陰性(-)' },
  { value: 'O', label: '未做' },
  { value: 'F', label: '待追蹤' },
];

const STATUS_LABELS: Record<ReservationStatus, string> = {
  pending: '待排',
  scheduled: '已排定',
  cancelled: '已取消',
};

const RELATION_SUGGESTIONS = ['本人', '配偶', '子女', '父母', '兄弟姊妹', '看護', '其他'];

function todayLocal(): string {
  return new Date().toLocaleDateString('sv-SE');
}

function emptyForm(kind: Kind): ReservationForm {
  return {
    kind,
    patientId: '',
    name: '',
    registeredDate: todayLocal(),
    freqDays: [],
    shift: '',
    originClinic: '',
    hbsag: '',
    antihcv: '',
    contactName: '',
    contactRelation: '',
    contactPhone: '',
    note: '',
  };
}

@Component({
  selector: 'app-dialysis-reservation',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './dialysis-reservation.component.html',
  styleUrls: ['./dialysis-reservation.component.css'],
})
export class DialysisReservationComponent implements OnInit {
  readonly DAY_OPTIONS = DAY_OPTIONS;
  readonly SHIFT_OPTIONS = SHIFT_OPTIONS;
  readonly HEP_OPTIONS = HEP_OPTIONS;
  readonly RELATION_SUGGESTIONS = RELATION_SUGGESTIONS;

  // 清單
  activeTab = signal<Kind>('existing');
  statusFilter: StatusFilter = 'pending';
  searchText = '';
  private rows: Reservation[] = [];
  visibleRows: Reservation[] = []; // 模板勿用 getter 重算
  pendingCounts: Record<Kind, number> = { existing: 0, external: 0 };
  loading = false;
  loadError = '';

  // 登記表單
  formOpen = false;
  editingId: string | null = null;
  form: ReservationForm = emptyForm('existing');
  formError = '';
  saving = false;

  // 本院病人選取（自動完成）
  pickerText = '';
  pickerOpen = false;
  filteredPatients: Patient[] = [];
  selectedPatient: Patient | null = null;

  // 空床比對
  matchOpen = false;
  matchTarget: Reservation | null = null;
  matchResult: MatchResult | null = null;
  matchLoading = false;
  matchError = '';
  showOccupied = false;
  assigning = false;
  recommendedBeds: MatchBed[] = [];
  otherAvailableBeds: MatchBed[] = [];
  occupiedBeds: MatchBed[] = [];

  constructor(
    private api: ApiService,
    private patientStore: PatientStoreService,
  ) {}

  async ngOnInit(): Promise<void> {
    await Promise.all([this.patientStore.fetchPatientsIfNeeded(), this.load()]);
  }

  // ---------------------------------------------------------------
  // 清單
  // ---------------------------------------------------------------

  async load(): Promise<void> {
    this.loading = true;
    this.loadError = '';
    try {
      this.rows = await firstValueFrom(this.api.get<Reservation[]>('/reservations', { status: 'all' }));
      this.refreshVisible();
    } catch (err) {
      console.error('載入預約洗腎登記失敗:', err);
      this.loadError = '載入失敗，請重新整理';
    } finally {
      this.loading = false;
    }
  }

  setTab(kind: Kind): void {
    this.activeTab.set(kind);
    this.refreshVisible();
  }

  setStatusFilter(filter: StatusFilter): void {
    this.statusFilter = filter;
    this.refreshVisible();
  }

  refreshVisible(): void {
    const kind = this.activeTab();
    const kw = this.searchText.trim().toLowerCase();
    this.pendingCounts = {
      existing: this.rows.filter((r) => r.kind === 'existing' && r.status === 'pending').length,
      external: this.rows.filter((r) => r.kind === 'external' && r.status === 'pending').length,
    };
    this.visibleRows = this.rows.filter((r) => {
      if (r.kind !== kind) return false;
      if (this.statusFilter !== 'all' && r.status !== this.statusFilter) return false;
      if (!kw) return true;
      const hay = [r.name, r.medicalRecordNumber, r.originClinic, r.contactName, r.contactPhone, r.note]
        .map((v) => String(v || '').toLowerCase());
      return hay.some((v) => v.includes(kw));
    });
  }

  // ---------------------------------------------------------------
  // 顯示用
  // ---------------------------------------------------------------

  freqLabel(row: { freqDays: number[]; freq: string | null }): string {
    if (row.freq) return row.freq;
    if (!row.freqDays?.length) return '—';
    return row.freqDays.map((d) => DAY_OPTIONS[d]?.label ?? '').join('') + '（非標準）';
  }

  shiftLabel(code: ShiftCode | ''): string {
    return SHIFT_OPTIONS.find((s) => s.code === code)?.label || '—';
  }

  hepLabel(v: HepValue): string {
    switch (v) {
      case 'Y': return '＋';
      case 'N': return '－';
      case 'O': return '未做';
      case 'F': return '待追蹤';
      default: return '—';
    }
  }

  hepClass(v: HepValue): string {
    if (v === 'Y') return 'hep-pos';
    if (v === 'N') return 'hep-neg';
    if (v === 'F') return 'hep-pending';
    return 'hep-none';
  }

  statusLabel(status: ReservationStatus): string {
    return STATUS_LABELS[status] || status;
  }

  isolationNeeded(row: { hbsag: HepValue; antihcv: HepValue }): boolean {
    return row.hbsag === 'Y' || row.antihcv === 'Y';
  }

  canMatch(row: Reservation): boolean {
    return row.freqDays.length > 0 && !!row.shift;
  }

  // ---------------------------------------------------------------
  // 登記表單
  // ---------------------------------------------------------------

  openCreate(): void {
    this.editingId = null;
    this.form = emptyForm(this.activeTab());
    this.resetPicker();
    this.formError = '';
    this.formOpen = true;
  }

  openEdit(row: Reservation): void {
    this.editingId = row.id;
    this.form = {
      kind: row.kind,
      patientId: row.patientId || '',
      name: row.name,
      registeredDate: row.registeredDate,
      freqDays: [...row.freqDays],
      shift: row.shift,
      originClinic: row.originClinic,
      hbsag: row.hbsag,
      antihcv: row.antihcv,
      contactName: row.contactName,
      contactRelation: row.contactRelation,
      contactPhone: row.contactPhone,
      note: row.note,
    };
    this.resetPicker();
    if (row.kind === 'existing') {
      this.selectedPatient =
        this.patientStore.allPatients().find((p) => String(p['id']) === row.patientId) || null;
      this.pickerText = row.medicalRecordNumber ? `${row.name}（${row.medicalRecordNumber}）` : row.name;
    }
    this.formError = '';
    this.formOpen = true;
  }

  closeForm(): void {
    this.formOpen = false;
  }

  toggleDay(idx: number): void {
    const set = new Set(this.form.freqDays);
    if (set.has(idx)) set.delete(idx);
    else set.add(idx);
    this.form.freqDays = [...set].sort((a, b) => a - b);
  }

  isDaySelected(idx: number): boolean {
    return this.form.freqDays.includes(idx);
  }

  setShift(code: ShiftCode): void {
    this.form.shift = this.form.shift === code ? '' : code;
  }

  formFreqLabel(): string {
    return this.freqLabel({ freqDays: this.form.freqDays, freq: null }).replace('（非標準）', '');
  }

  async save(): Promise<void> {
    this.formError = '';
    const f = this.form;
    if (f.kind === 'existing' && !f.patientId) {
      this.formError = '請從病人清單選擇病人';
      return;
    }
    if (f.kind === 'external' && !f.name.trim()) {
      this.formError = '請輸入病人姓名';
      return;
    }
    if (!f.registeredDate) {
      this.formError = '請填登記日期';
      return;
    }
    this.saving = true;
    try {
      const body: Record<string, unknown> = {
        kind: f.kind,
        registeredDate: f.registeredDate,
        freqDays: f.freqDays,
        shift: f.shift,
        originClinic: f.originClinic,
        contactName: f.contactName,
        contactRelation: f.contactRelation,
        contactPhone: f.contactPhone,
        note: f.note,
      };
      if (f.kind === 'existing') {
        body['patientId'] = f.patientId;
      } else {
        body['name'] = f.name;
        body['hbsag'] = f.hbsag;
        body['antihcv'] = f.antihcv;
      }
      if (this.editingId) {
        await firstValueFrom(this.api.put<Reservation>(`/reservations/${this.editingId}`, body));
      } else {
        await firstValueFrom(this.api.post<Reservation>('/reservations', body));
      }
      this.formOpen = false;
      await this.load();
    } catch (err: unknown) {
      console.error('儲存預約洗腎登記失敗:', err);
      this.formError = this.errorMessage(err, '儲存失敗，請重試');
    } finally {
      this.saving = false;
    }
  }

  async remove(row: Reservation): Promise<void> {
    if (!confirm(`確定刪除 ${row.name} 的登記？此動作無法復原。`)) return;
    try {
      await firstValueFrom(this.api.delete(`/reservations/${row.id}`));
      await this.load();
    } catch (err) {
      console.error('刪除預約洗腎登記失敗:', err);
      alert(this.errorMessage(err, '刪除失敗，請重試'));
    }
  }

  async setStatus(row: Reservation, status: ReservationStatus): Promise<void> {
    const label = STATUS_LABELS[status];
    if (status === 'cancelled' && !confirm(`將 ${row.name} 的登記標為「${label}」？`)) return;
    try {
      const body: Record<string, unknown> = { status };
      if (status !== 'scheduled') body['matchedBed'] = '';
      await firstValueFrom(this.api.put(`/reservations/${row.id}`, body));
      await this.load();
    } catch (err) {
      console.error('更新登記狀態失敗:', err);
      alert(this.errorMessage(err, '更新失敗，請重試'));
    }
  }

  // ---------------------------------------------------------------
  // 本院病人選取
  // ---------------------------------------------------------------

  private resetPicker(): void {
    this.pickerText = '';
    this.pickerOpen = false;
    this.filteredPatients = [];
    this.selectedPatient = null;
  }

  onPickerFocus(): void {
    this.updatePickerFilter();
    this.pickerOpen = true;
  }

  onPickerBlur(): void {
    // mousedown 先於 blur 觸發，選取不受影響
    this.pickerOpen = false;
  }

  updatePickerFilter(): void {
    const kw = this.pickerText.trim().toLowerCase();
    const all = this.patientStore
      .allPatients()
      .filter((p) => !this.isDeletedPatient(p));
    this.filteredPatients = (
      !kw
        ? all
        : all.filter((p) => {
            const name = String(p['name'] || '').toLowerCase();
            const mrn = String(p['medicalRecordNumber'] || '').toLowerCase();
            return name.includes(kw) || mrn.includes(kw);
          })
    ).slice(0, 30);
  }

  isDeletedPatient(p: Patient): boolean {
    return !!p['isDeleted'] || p['status'] === 'deleted';
  }

  patientStatusLabel(p: Patient): string {
    const s = p['status'];
    return s === 'opd' ? '門診' : s === 'ipd' ? '住院' : s === 'er' ? '急診' : '';
  }

  selectPatient(p: Patient): void {
    this.selectedPatient = p;
    this.form.patientId = String(p['id'] || '');
    this.form.name = String(p['name'] || '');
    const mrn = String(p['medicalRecordNumber'] || '');
    this.pickerText = mrn ? `${this.form.name}（${mrn}）` : this.form.name;
    const hep = (p['hepatitisStatus'] || {}) as Record<string, unknown>;
    this.form.hbsag = (String(hep['hbsag'] || '') as HepValue) || '';
    this.form.antihcv = (String(hep['antihcv'] || '') as HepValue) || '';
    if (!this.form.originClinic.trim()) {
      const info = (p['hospitalInfo'] || {}) as Record<string, unknown>;
      this.form.originClinic = String(info['source'] || '');
    }
    this.pickerOpen = false;
  }

  clearPatient(): void {
    this.selectedPatient = null;
    this.form.patientId = '';
    this.form.name = '';
    this.form.hbsag = '';
    this.form.antihcv = '';
    this.pickerText = '';
  }

  // ---------------------------------------------------------------
  // 空床比對
  // ---------------------------------------------------------------

  async openMatch(row: Reservation): Promise<void> {
    if (!this.canMatch(row)) {
      alert('請先在登記中填好「預約頻率」與「預約班別」再比對空床');
      return;
    }
    this.matchTarget = row;
    this.matchResult = null;
    this.matchError = '';
    this.showOccupied = false;
    this.recommendedBeds = [];
    this.otherAvailableBeds = [];
    this.occupiedBeds = [];
    this.matchOpen = true;
    this.matchLoading = true;
    try {
      const result = await firstValueFrom(
        this.api.post<MatchResult>('/reservations/match', {
          freqDays: row.freqDays,
          shift: row.shift,
          hbsag: row.hbsag,
          antihcv: row.antihcv,
          excludePatientId: row.patientId || '',
        }),
      );
      this.matchResult = result;
      this.recommendedBeds = result.beds.filter((b) => b.recommended);
      this.otherAvailableBeds = result.beds.filter((b) => b.available && !b.recommended);
      this.occupiedBeds = result.beds.filter((b) => !b.available);
    } catch (err) {
      console.error('空床比對失敗:', err);
      this.matchError = this.errorMessage(err, '比對失敗，請重試');
    } finally {
      this.matchLoading = false;
    }
  }

  closeMatch(): void {
    this.matchOpen = false;
    this.matchTarget = null;
  }

  conflictText(bed: MatchBed): string {
    const parts: string[] = [];
    for (const c of bed.masterConflicts) parts.push(`${c.patientName || '病人'}（${c.freq || ''}，衝突 ${c.days || ''}）`);
    for (const c of bed.scheduleConflicts) parts.push(`${c.date} ${c.patientName || '臨時佔用'}`);
    return parts.join('；');
  }

  scheduleWarning(bed: MatchBed): string {
    if (!bed.scheduleConflicts.length) return '';
    const dates = bed.scheduleConflicts.map((c) => c.date?.slice(5) || '').filter(Boolean);
    return `近期臨時佔用 ${dates.slice(0, 3).join('、')}${dates.length > 3 ? ` 等 ${dates.length} 天` : ''}`;
  }

  async assignBed(bed: MatchBed): Promise<void> {
    const row = this.matchTarget;
    const result = this.matchResult;
    if (!row || !result) return;
    const warn = bed.scheduleConflicts.length
      ? `\n注意：${this.scheduleWarning(bed)}，排入後需另行處理當日調班。`
      : '';
    const isoWarn = bed.isolation !== result.isolationRequired
      ? (bed.isolation ? '\n注意：此為隔離床，病人非 B/C 肝陽性。' : '\n注意：病人 B/C 肝陽性，此床非隔離床。')
      : '';
    if (!confirm(`將 ${row.name} 排定於 ${bed.bedNum} 床 ${this.shiftLabel(result.shift)}（${result.freqLabel}）？${isoWarn}${warn}`)) return;
    this.assigning = true;
    try {
      await firstValueFrom(
        this.api.put(`/reservations/${row.id}`, { status: 'scheduled', matchedBed: String(bed.bedNum) }),
      );
      this.closeMatch();
      await this.load();
    } catch (err) {
      console.error('排定床位失敗:', err);
      alert(this.errorMessage(err, '排定失敗，請重試'));
    } finally {
      this.assigning = false;
    }
  }

  private errorMessage(err: unknown, fallback: string): string {
    const e = err as { error?: { message?: string } };
    return e?.error?.message || fallback;
  }
}
