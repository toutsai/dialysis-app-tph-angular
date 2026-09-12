import { Component, OnInit, computed, inject, signal, ChangeDetectionStrategy } from '@angular/core';

import { FormsModule } from '@angular/forms';
import {
  AkiApiService,
  IcuDialysisPatient,
  IcuDialysisUnit,
  IcuStatusSavePayload,
  IcuYesNo,
} from '@app/core/services/aki-api.service';
import { ORDERED_SHIFT_CODES, getShiftDisplayName } from '@/constants/scheduleConstants';

type YesNoField = 'vasopressor' | 'ecmo' | 'ufDifficulty' | 'vasoHigh' | 'mapLow' | 'lactateHigh' | 'brainInjury';
type DetailField = 'vasopressorDetail' | 'ecmoDetail' | 'oxygenDetail' | 'ufDetail';

// 是/否欄位 → 對應的細節欄位（改為「無」時一併清空，避免留下過期的藥物/劑量）
const DETAIL_OF: Partial<Record<YesNoField, DetailField>> = {
  vasopressor: 'vasopressorDetail',
  ecmo: 'ecmoDetail',
  ufDifficulty: 'ufDetail',
};

// CRRT 風險檢核：人工勾選項（自動項＝升壓劑 +2、脫水困難 +2、呼吸器 +1、ECMO +1，由後端算）
interface CrrtCheckItem {
  field: 'vasoHigh' | 'mapLow' | 'lactateHigh' | 'brainInjury';
  label: string;
  pts: string;
  hint: string;
  /** 只在升壓劑「有」時顯示 */
  needsVaso?: boolean;
}
const CRRT_CHECK_ITEMS: CrrtCheckItem[] = [
  { field: 'vasoHigh', label: 'NE ≥0.3／24h 加量', pts: '+1', hint: 'Norepinephrine ≥0.3 µg/kg/min，或 24 小時內加量／加第二種升壓劑（外推，無切點證據）', needsVaso: true },
  { field: 'mapLow', label: 'MAP <65', pts: '+1', hint: '透析前平均動脈壓 <65 mmHg（Bitker 2016、Passos 2019：MAP 每低 1 mmHg OR 0.93–0.96）' },
  { field: 'lactateHigh', label: '乳酸 >2／CRT ≥3s', pts: '+1', hint: '乳酸 >2 mmol/L 或微血管再充填 ≥3 秒（SOCRATE，Bigé 2020）' },
  { field: 'brainInjury', label: '腦損傷／肝衰竭', pts: '直接', hint: '急性腦損傷／顱內壓升高／急性肝衰竭：KDIGO 2012 建議 CRRT（2B），不計分直接建議' },
];

// AKI 分期徽章色（與 aki-map.component 的 CATEGORY_DEFS 對齊）
const AKI_BADGE: Record<string, { label: string; bg: string; fg: string }> = {
  'stage-3': { label: 'AKI S3', bg: '#d32f2f', fg: '#fff' },
  'stage-2': { label: 'AKI S2', bg: '#f57c00', fg: '#fff' },
  'stage-1': { label: 'AKI S1', bg: '#fdd835', fg: '#424242' },
  esrd: { label: '疑似 ESRD', bg: '#7b1fa2', fg: '#fff' },
};

type StatusFilter = 'all' | 'crrt' | 'unassessed' | 'vaso' | 'ecmo' | 'vent' | 'uf' | 'first';

/** 篩選後的分區：patients 為顯示用子集，all 為原始名單（標題統計） */
interface FilteredUnit extends IcuDialysisUnit {
  all: IcuDialysisPatient[];
}

/**
 * 腎臟病地圖 → ICU 透析病人頁籤
 * 依 ICUA / ICUB / ICUD 三區顯示目前在 ICU 的透析病人（HD / SLED / CVVHDF），
 * 每張卡片可直接登錄：升壓劑（藥物/劑量）、ECMO、氧氣使用、HD/SLED 脫水困難。
 * 資料來源＝病人清單住院狀態＋病房號（護理師即時維護），不是 AKI 上傳快照。
 */
@Component({
  selector: 'app-icu-dialysis-panel',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './icu-dialysis-panel.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './icu-dialysis-panel.component.css',
})
export class IcuDialysisPanelComponent implements OnInit {
  private readonly akiApi = inject(AkiApiService);

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly units = signal<IcuDialysisUnit[]>([]);
  readonly total = signal(0);
  readonly loadedAt = signal<Date | null>(null);

  /** 剛存檔成功的病人（卡片閃綠） */
  readonly savedId = signal<string | null>(null);
  readonly savingId = signal<string | null>(null);

  readonly yesNoOptions: IcuYesNo[] = ['有', '無'];
  readonly oxygenOptions = ['室內空氣', '鼻導管', '面罩', 'HFNC', 'NIV', '呼吸器'];
  readonly crrtCheckItems = CRRT_CHECK_ITEMS;
  /** CRRT 風險檢核說明（摺疊） */
  readonly showCrrtHelp = signal(false);

  // ---------- 篩選（純前端，不打 API） ----------
  /** 分區：all = 三區並排；單一分區 = 整寬多欄 */
  readonly unitFilter = signal<string>('all');
  /** 模式多選；空集合 = 全部 */
  readonly modeFilter = signal<ReadonlySet<string>>(new Set());
  /** 狀態單選 */
  readonly statusFilter = signal<StatusFilter>('all');
  readonly search = signal('');
  readonly modeOptions = ['HD', 'SLED', 'CVVHDF'];
  readonly statusOptions: { key: StatusFilter; label: string; cls?: string }[] = [
    { key: 'all', label: '全部' },
    { key: 'crrt', label: '疑需 CRRT', cls: 'crrt' },
    { key: 'unassessed', label: '未評估', cls: 'pending' },
    { key: 'vaso', label: '升壓劑' },
    { key: 'ecmo', label: 'ECMO' },
    { key: 'vent', label: '呼吸器' },
    { key: 'uf', label: '脫水困難' },
    { key: 'first', label: '首次透析' },
  ];

  readonly hasFilter = computed(() =>
    this.unitFilter() !== 'all' || this.modeFilter().size > 0 || this.statusFilter() !== 'all' || !!this.search().trim(),
  );

  /** 篩選後的分區：patients = 顯示用；all = 原始（標題統計用原始人數） */
  readonly filteredUnits = computed<FilteredUnit[]>(() => {
    const unit = this.unitFilter();
    const modes = this.modeFilter();
    const status = this.statusFilter();
    const q = this.search().trim().toLowerCase();
    return this.units()
      .filter((u) => unit === 'all' || u.key === unit)
      .map((u) => ({
        ...u,
        all: u.patients,
        patients: u.patients.filter((p) => {
          if (modes.size && !modes.has(String(p.mode || '').toUpperCase())) return false;
          if (!this.matchStatus(p, status)) return false;
          if (q) {
            const hay = `${p.name} ${p.mrn} ${p.bedNo} ${p.physician} ${p.inpatientReason} ${p.vasopressorDetail}`.toLowerCase();
            if (!hay.includes(q)) return false;
          }
          return true;
        }),
      }));
  });
  readonly shownCount = computed(() => this.filteredUnits().reduce((s, u) => s + u.patients.length, 0));

  private matchStatus(p: IcuDialysisPatient, s: StatusFilter): boolean {
    switch (s) {
      case 'crrt': return p.crrtFlag;
      case 'unassessed': return this.isUnassessed(p);
      case 'vaso': return p.vasopressor === '有';
      case 'ecmo': return p.ecmo === '有';
      case 'vent': return p.oxygen === '呼吸器';
      case 'uf': return p.ufDifficulty === '有';
      case 'first': return p.firstDialysis;
      default: return true;
    }
  }

  toggleMode(m: string): void {
    const next = new Set(this.modeFilter());
    if (next.has(m)) next.delete(m);
    else next.add(m);
    this.modeFilter.set(next);
  }

  clearFilters(): void {
    this.unitFilter.set('all');
    this.modeFilter.set(new Set());
    this.statusFilter.set('all');
    this.search.set('');
  }

  /** 篩選列各狀態的人數（依原始名單，供 chip 顯示） */
  statusCount(s: StatusFilter): number {
    return this.units().reduce((n, u) => n + u.patients.filter((p) => this.matchStatus(p, s)).length, 0);
  }

  ngOnInit(): void {
    this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const res = await this.akiApi.getIcuDialysis();
      this.units.set(res.units || []);
      this.total.set(res.total || 0);
      this.loadedAt.set(new Date());
    } catch (e: any) {
      this.error.set(e?.error?.message || e?.message || '載入 ICU 透析病人失敗');
    } finally {
      this.loading.set(false);
    }
  }

  // ---------- 顯示輔助 ----------

  modeClass(mode: string): string {
    const m = String(mode || '').toUpperCase();
    if (m === 'CVVHDF') return 'mode-cvvhdf';
    if (m === 'SLED') return 'mode-sled';
    if (m === 'HD') return 'mode-hd';
    return 'mode-other';
  }

  showUfRow(p: IcuDialysisPatient): boolean {
    // 脫水困難是 HD / SLED 的議題；CVVHDF 連續脫水不適用
    return String(p.mode || '').toUpperCase() !== 'CVVHDF';
  }

  akiBadge(p: IcuDialysisPatient): { label: string; bg: string; fg: string } | null {
    return (p.akiCategory && AKI_BADGE[p.akiCategory]) || null;
  }

  /** 排程位置：外2 早 / 床61 晚；未排 → '' */
  scheduleLabel(p: IcuDialysisPatient): string {
    if (p.bedNum == null || p.bedNum === '') return '';
    const s = String(p.bedNum);
    const bed = s.startsWith('peripheral-') ? `外${s.replace('peripheral-', '')}` : s.startsWith('外') ? s : `床${s}`;
    const code = p.shiftIndex != null ? ORDERED_SHIFT_CODES[p.shiftIndex] : null;
    const shift = code ? getShiftDisplayName(code) : '';
    return [bed, shift].filter(Boolean).join(' ');
  }

  /** 尚未評估 = 四項都空白（脫水困難不適用者只看三項） */
  isUnassessed(p: IcuDialysisPatient): boolean {
    // 不適用脫水困難（CVVHDF）者，該項視為已滿足，只看其餘三項
    const ufPending = this.showUfRow(p) ? !p.ufDifficulty : true;
    return !p.vasopressor && !p.ecmo && !p.oxygen && ufPending;
  }

  pendingCount(list: IcuDialysisPatient[]): number {
    return list.filter((p) => this.isUnassessed(p)).length;
  }

  /** 該區「疑需 CRRT」人數（HD/SLED 達門檻或直接考慮者） */
  crrtFlagCount(list: IcuDialysisPatient[]): number {
    return list.filter((p) => p.crrtFlag).length;
  }

  /** 全院疑需 CRRT 人數（借第 6 台的依據） */
  crrtFlagTotal(): number {
    return this.units().reduce((s, u) => s + this.crrtFlagCount(u.patients), 0);
  }

  crrtLevel(p: IcuDialysisPatient): 'hi' | 'mid' | 'lo' {
    if (p.crrtFlag) return 'hi';
    return p.crrtScore >= 2 ? 'mid' : 'lo';
  }

  /** 區塊統計列：HD n / SLED n / CVVHDF n（固定順序，0 的模式仍顯示；其他模式併入「其他」） */
  modeCounts(list: IcuDialysisPatient[]): { mode: string; n: number }[] {
    const counts: Record<string, number> = { HD: 0, SLED: 0, CVVHDF: 0 };
    let other = 0;
    for (const p of list) {
      const m = String(p.mode || '').toUpperCase();
      if (m in counts) counts[m] += 1;
      else other += 1;
    }
    const out = Object.entries(counts).map(([mode, n]) => ({ mode, n }));
    if (other) out.push({ mode: '其他', n: other });
    return out;
  }

  /** 'YYYY-MM-DD HH:MM:SS'（本地時間字串）→ 'MM/DD HH:MM' */
  fmtTime(s: string | null): string {
    if (!s) return '';
    const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
    return m ? `${m[2]}/${m[3]} ${m[4]}:${m[5]}` : String(s);
  }

  fmtLoaded(): string {
    const d = this.loadedAt();
    if (!d) return '';
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // ---------- 編輯 / 存檔 ----------

  /** 是/否切換；再點同一個值 = 取消評估（回空白） */
  setYesNo(p: IcuDialysisPatient, field: YesNoField, value: IcuYesNo): void {
    const next: IcuYesNo = p[field] === value ? '' : value;
    const payload: IcuStatusSavePayload = {};
    payload[field] = next;
    p[field] = next;
    if (next !== '有') {
      const detail = DETAIL_OF[field];
      if (detail) {
        p[detail] = '';
        payload[detail] = '';
      }
      // 升壓劑取消／無 → 高劑量勾選一併清空（該項只在有升壓劑時計分）
      if (field === 'vasopressor' && p.vasoHigh) {
        p.vasoHigh = '';
        payload.vasoHigh = '';
      }
    }
    this.save(p, payload);
  }

  setOxygen(p: IcuDialysisPatient): void {
    const payload: IcuStatusSavePayload = { oxygen: p.oxygen };
    if (!p.oxygen) {
      p.oxygenDetail = '';
      payload.oxygenDetail = '';
    }
    this.save(p, payload);
  }

  saveDetail(p: IcuDialysisPatient, field: DetailField): void {
    const payload: IcuStatusSavePayload = {};
    payload[field] = String(p[field] || '').trim();
    this.save(p, payload);
  }

  private async save(p: IcuDialysisPatient, payload: IcuStatusSavePayload): Promise<void> {
    this.savingId.set(p.id);
    this.error.set(null);
    try {
      const res = await this.akiApi.saveIcuStatus(p.id, payload);
      if (res?.status) Object.assign(p, res.status);
      this.savedId.set(p.id);
      setTimeout(() => {
        if (this.savedId() === p.id) this.savedId.set(null);
      }, 1200);
    } catch (e: any) {
      this.error.set(e?.error?.message || e?.message || '儲存失敗，請重新整理後再試');
    } finally {
      if (this.savingId() === p.id) this.savingId.set(null);
    }
  }
}
