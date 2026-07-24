import { Component, EventEmitter, OnDestroy, OnInit, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PatientStoreService } from '@services/patient-store.service';
import { localApi } from '@/services/localApiClient';
import {
  VascularAccessEvent,
  VASCULAR_FAILURE_REASONS,
  VASCULAR_REPAIR_METHODS,
  VASCULAR_FISTULA_SITES,
  VASCULAR_CATHETER_SITES,
} from '@app/core/constants/vascular-access-codes';
import {
  KIDIT_VASCULAR_FIELD_KEYS,
  quarterRange,
  currentQuarter,
  toRocDate7,
  downloadKiditVascularCsv,
} from '@/services/kiditVascularCsvService';

/**
 * 季度造管 CSV 工作檯（KiDit「病患血液透析造管CSV檔」）
 * - 病人範圍＝常規門診 ∪ 該季有 confirmed 事件的病人
 * - 全欄位可編輯；使用者改過的值與人工欄存 overrides（PUT /vascular-access/quarter-exports）
 * - 匯出前檢查必填欄（本季最佳 pump blood flow；預填自透析醫囑血流量，可改）
 */

/** overrides JSON 形狀（前端自定，後端只存不解讀）：
 *  { excluded?: boolean, values?: Record<fieldKey, string> }
 *  values 只存「與預填值不同」的欄位（含人工欄），鍵 ∈ KIDIT_VASCULAR_FIELD_KEYS。 */
interface QuarterOverrides {
  excluded?: boolean;
  values?: Record<string, string>;
}

interface ColDef {
  key: string;
  label: string;
  /** datalist id（無=自由文字） */
  list: string | null;
  /** 欄寬類型 class */
  kind: 'id' | 'mrn' | 'date' | 'code' | 'num' | 'text';
  required?: boolean;
}

interface QRow {
  patientId: string;
  name: string;
  /** 本季有已確認血管通路事件（預設清單只列這些人） */
  hasEvents: boolean;
  /** 已不符常規門診條件時的現況標示（'' = 正常常規門診） */
  statusNote: string;
  excluded: boolean;
  warnings: string[];
  /** 系統預填值（依規則計算） */
  prefill: Record<string, string>;
  /** 使用者覆寫（僅存與 prefill 不同者），即 overrides.values */
  overrideValues: Record<string, string>;
  /** 顯示/匯出用的合併結果 = prefill ⊕ overrideValues */
  values: Record<string, string>;
}

const ACCESS_TYPE_TO_GROUP: Record<string, string> = {
  AVF: 'Avf', AVG: 'Avg', PERM: 'Perm', TEMP: 'Temp',
};

/** 欄位群組頁籤（純顯示層：只控制右側顯示哪些欄，資料/儲存/匯出不受影響） */
interface FieldTab {
  key: string;
  label: string;
  cols: ColDef[];
  groups: { label: string; cols: number }[];
}

@Component({
  selector: 'app-kidit-vascular-quarterly',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './kidit-vascular-quarterly.component.html',
  styleUrl: './kidit-vascular-quarterly.component.css',
})
export class KiditVascularQuarterlyComponent implements OnInit, OnDestroy {
  private readonly patientStore = inject(PatientStoreService);

  @Output() closeEvent = new EventEmitter<void>();

  readonly year = signal(currentQuarter().year);
  readonly q = signal(currentQuarter().q);
  readonly isLoading = signal(false);
  readonly rows = signal<QRow[]>([]);
  readonly saveState = signal<'idle' | 'saving' | 'saved' | 'error'>('idle');
  /** 預設只顯示本季有已確認事件的病人；「全部」= 常規門診 ∪ 有事件（匯出不受此篩選影響） */
  readonly showAll = signal(false);
  readonly visibleRows = computed(() =>
    this.showAll() ? this.rows() : this.rows().filter((r) => r.hasEvents),
  );

  private readonly saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // 代碼選項（datalist 用）
  readonly failureReasons = VASCULAR_FAILURE_REASONS;
  readonly repairMethods = VASCULAR_REPAIR_METHODS;
  readonly fistulaSites = VASCULAR_FISTULA_SITES;
  readonly catheterSites = VASCULAR_CATHETER_SITES;

  // -------------------------------------------------------------------------
  // 欄位定義（82 欄，順序與 KIDIT_VASCULAR_FIELD_KEYS 相同）
  // -------------------------------------------------------------------------
  readonly columns: ColDef[] = this.buildColumns();
  /** 欄位群組頁籤；「血流量／熱療」放第一位＝唯一必須人工填的區塊。姓名等病人 4 欄每頁固定。 */
  readonly fieldTabs: FieldTab[] = this.buildFieldTabs();
  readonly activeTabKey = signal<string>('flow');
  readonly activeFieldTab = computed(
    () => this.fieldTabs.find((t) => t.key === this.activeTabKey()) || this.fieldTabs[0],
  );
  /** 「血流量／熱療」頁籤紅字：未排除且必填 bestPumpFlow 未填的人數（＝匯出會擋的名單） */
  readonly missingFlowCount = signal(0);

  private buildFieldTabs(): FieldTab[] {
    // 依 buildColumns 的固定順序切段（該處已有與 KIDIT_VASCULAR_FIELD_KEYS 的對齊防呆）
    const c = this.columns;
    const basic = c.slice(0, 3);
    const cur = c.slice(3, 15);
    const flow = c.slice(15, 17);
    const fir = c.slice(17, 20);
    const heat = c.slice(20, 23);
    const coexist = c.slice(23, 36);
    const problem = c.slice(36, 37);
    const itv = c.slice(37, 49);
    const rec = c.slice(49, 82);
    const patient = { label: '病人', cols: 4 };
    return [
      {
        key: 'flow', label: '血流量／熱療', cols: [...flow, ...fir, ...heat],
        groups: [patient, { label: '血流量', cols: 2 }, { label: '遠紅外線', cols: 3 }, { label: '其他熱療', cols: 3 }],
      },
      {
        key: 'snapshot', label: '通路快照', cols: [...basic, ...cur],
        groups: [patient, { label: '基本', cols: 3 }, { label: '目前通路快照', cols: 12 }],
      },
      {
        key: 'coexist', label: '並存通路', cols: coexist,
        groups: [patient, { label: '並存通路', cols: 13 }],
      },
      {
        key: 'itv', label: '介入治療', cols: [...problem, ...itv],
        groups: [patient, { label: '問題', cols: 1 }, { label: '介入治療 1', cols: 4 }, { label: '介入治療 2', cols: 4 }, { label: '介入治療 3', cols: 4 }],
      },
      {
        key: 'rec', label: '血管重建', cols: rec,
        groups: [patient, { label: '血管重建 1', cols: 11 }, { label: '血管重建 2', cols: 11 }, { label: '血管重建 3', cols: 11 }],
      },
    ];
  }

  private buildColumns(): ColDef[] {
    const accessSub = (prefix: string, fsList: string, csList: string): ColDef[] => [
      { key: `${prefix}AvfYn`, label: '自體', list: 'qv-dl-yn', kind: 'code' },
      { key: `${prefix}AvfSide`, label: '左右', list: 'qv-dl-side', kind: 'code' },
      { key: `${prefix}AvfSite`, label: '位置', list: fsList, kind: 'code' },
      { key: `${prefix}AvgYn`, label: '人工', list: 'qv-dl-yn', kind: 'code' },
      { key: `${prefix}AvgSide`, label: '左右', list: 'qv-dl-side', kind: 'code' },
      { key: `${prefix}AvgSite`, label: '位置', list: fsList, kind: 'code' },
      { key: `${prefix}PermYn`, label: 'Perm', list: 'qv-dl-yn', kind: 'code' },
      { key: `${prefix}PermSide`, label: '左右', list: 'qv-dl-side', kind: 'code' },
      { key: `${prefix}PermSite`, label: '位置', list: csList, kind: 'code' },
      { key: `${prefix}TempYn`, label: '短期', list: 'qv-dl-yn', kind: 'code' },
      { key: `${prefix}TempSide`, label: '左右', list: 'qv-dl-side', kind: 'code' },
      { key: `${prefix}TempSite`, label: '位置', list: csList, kind: 'code' },
    ];
    const itvSub = (n: number): ColDef[] => [
      { key: `itv${n}Date`, label: '日期(民國)', list: null, kind: 'date' },
      { key: `itv${n}Reason`, label: '失敗原因', list: 'qv-dl-reason', kind: 'code' },
      { key: `itv${n}Method`, label: '重建方式', list: 'qv-dl-method', kind: 'code' },
      { key: `itv${n}MethodOther`, label: '其他方式', list: null, kind: 'text' },
    ];
    const recSub = (n: number): ColDef[] => [
      { key: `rec${n}Date`, label: '日期(民國)', list: null, kind: 'date' },
      { key: `rec${n}PrevReason`, label: '前次原因', list: 'qv-dl-reason', kind: 'code' },
      { key: `rec${n}AvfYn`, label: '自體', list: 'qv-dl-yn', kind: 'code' },
      { key: `rec${n}AvfSide`, label: '左右', list: 'qv-dl-side', kind: 'code' },
      { key: `rec${n}AvfSite`, label: '位置', list: 'qv-dl-fsite', kind: 'code' },
      { key: `rec${n}AvgYn`, label: '人工', list: 'qv-dl-yn', kind: 'code' },
      { key: `rec${n}AvgSide`, label: '左右', list: 'qv-dl-side', kind: 'code' },
      { key: `rec${n}AvgSite`, label: '位置', list: 'qv-dl-fsite', kind: 'code' },
      { key: `rec${n}PermYn`, label: 'Perm', list: 'qv-dl-yn', kind: 'code' },
      { key: `rec${n}PermSide`, label: '左右', list: 'qv-dl-side', kind: 'code' },
      { key: `rec${n}PermSite`, label: '位置', list: 'qv-dl-csite', kind: 'code' },
    ];
    const cols: ColDef[] = [
      { key: 'idNumber', label: '身分證號', list: null, kind: 'id' },
      { key: 'medicalRecordNumber', label: '病歷號', list: null, kind: 'mrn' },
      { key: 'reportDate', label: '日期(民國)', list: null, kind: 'date' },
      ...accessSub('cur', 'qv-dl-fsite', 'qv-dl-csite'),
      { key: 'bestPumpFlow', label: '最佳pump flow★', list: null, kind: 'num', required: true },
      { key: 'accessFlow', label: 'access flow', list: null, kind: 'num' },
      { key: 'firYn', label: '使用', list: 'qv-dl-yn', kind: 'code' },
      { key: 'firPerWeek', label: '每週次數', list: null, kind: 'num' },
      { key: 'firWeeklyMinutes', label: '週總分鐘', list: null, kind: 'num' },
      { key: 'otherHeatYn', label: '使用', list: 'qv-dl-yn', kind: 'code' },
      { key: 'otherHeatMethod', label: '方法', list: null, kind: 'text' },
      { key: 'otherHeatMinutes', label: '週總分鐘', list: null, kind: 'num' },
      { key: 'coexistYn', label: '是否並存', list: 'qv-dl-yn', kind: 'code' },
      ...accessSub('co', 'qv-dl-fsite', 'qv-dl-csite'),
      { key: 'hasProblem', label: '有問題', list: 'qv-dl-yn', kind: 'code' },
      ...itvSub(1), ...itvSub(2), ...itvSub(3),
      ...recSub(1), ...recSub(2), ...recSub(3),
    ];
    // 防呆：欄位定義必須與 CSV 欄位鍵完全對齊
    if (cols.length !== KIDIT_VASCULAR_FIELD_KEYS.length ||
        cols.some((c, i) => c.key !== KIDIT_VASCULAR_FIELD_KEYS[i])) {
      throw new Error('[kidit-vascular-quarterly] 欄位定義與 KIDIT_VASCULAR_FIELD_KEYS 不對齊');
    }
    return cols;
  }

  // -------------------------------------------------------------------------
  // 生命週期
  // -------------------------------------------------------------------------
  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    this.flushPendingSaves();
  }

  close(): void {
    this.flushPendingSaves();
    this.closeEvent.emit();
  }

  // -------------------------------------------------------------------------
  // 季度
  // -------------------------------------------------------------------------
  quarterStr(): string {
    return `${this.year()}Q${this.q()}`;
  }

  quarterRangeLabel(): string {
    const { startDate, endDate } = quarterRange(this.year(), this.q());
    return `${startDate} ~ ${endDate}`;
  }

  changeQuarter(offset: number): void {
    this.flushPendingSaves();
    let q = this.q() + offset;
    let y = this.year();
    if (q > 4) { q = 1; y++; }
    else if (q < 1) { q = 4; y--; }
    this.q.set(q);
    this.year.set(y);
    this.load();
  }

  // -------------------------------------------------------------------------
  // 載入與列建構
  // -------------------------------------------------------------------------
  async load(): Promise<void> {
    this.isLoading.set(true);
    this.rows.set([]);
    this.saveState.set('idle');
    try {
      const { startDate, endDate } = quarterRange(this.year(), this.q());
      const quarter = this.quarterStr();
      await this.patientStore.fetchPatientsIfNeeded();
      const [evRes, ovRes] = await Promise.all([
        localApi.get(`/vascular-access/events?startDate=${startDate}&endDate=${endDate}&status=confirmed`),
        localApi.get(`/vascular-access/quarter-exports/${quarter}`),
      ]);

      const events: VascularAccessEvent[] = (evRes?.events || [])
        .slice()
        .sort((a: VascularAccessEvent, b: VascularAccessEvent) =>
          (a.eventDate || '').localeCompare(b.eventDate || ''));
      const eventsByPatient = new Map<string, VascularAccessEvent[]>();
      for (const ev of events) {
        if (!ev.patientId) continue;
        const list = eventsByPatient.get(ev.patientId) || [];
        list.push(ev);
        eventsByPatient.set(ev.patientId, list);
      }

      const overridesMap = new Map<string, QuarterOverrides>();
      for (const o of (ovRes?.overrides || [])) {
        if (o?.patientId) overridesMap.set(o.patientId, o.overrides || {});
      }

      const patients = this.patientStore.allPatients() as any[];
      const byId = new Map<string, any>(patients.filter((p) => p.id).map((p) => [p.id, p]));
      const isRegularOpd = (p: any): boolean =>
        p.status === 'opd' && !p.isDeleted &&
        (p.patientCategory == null || p.patientCategory === 'opd_regular');

      const regulars = patients.filter(isRegularOpd);
      const regularIds = new Set(regulars.map((p) => p.id));
      // 聯集：該季有 confirmed 事件但已不符常規門診條件的病人（含已查無主檔者）
      const extraIds = [...eventsByPatient.keys()].filter((id) => !regularIds.has(id));

      const built: QRow[] = [];
      for (const p of regulars) {
        built.push(this.buildRow(p.id, p, eventsByPatient.get(p.id) || [], overridesMap.get(p.id), startDate, ''));
      }
      for (const id of extraIds) {
        const p = byId.get(id) || null;
        const evs = eventsByPatient.get(id) || [];
        built.push(this.buildRow(id, p, evs, overridesMap.get(id), startDate, this.statusNoteFor(p)));
      }

      built.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh-Hant'));
      this.rows.set(built);
      this.refreshMissingFlowCount();
    } catch (error) {
      console.error('載入季度造管資料失敗:', error);
      alert('載入季度造管資料失敗，請稍後再試。');
    } finally {
      this.isLoading.set(false);
    }
  }

  private statusNoteFor(p: any): string {
    if (!p) return '查無病人主檔';
    if (p.isDeleted) return '已刪除';
    if (p.status === 'ipd') return '已轉住院';
    if (p.status === 'er') return '已轉急診';
    if (p.patientCategory != null && p.patientCategory !== 'opd_regular') return '非常規門診';
    return '身分已變更';
  }

  private buildRow(
    patientId: string,
    p: any,
    evs: VascularAccessEvent[],
    overrides: QuarterOverrides | undefined,
    quarterStart: string,
    statusNote: string,
  ): QRow {
    const warnings: string[] = [];
    const prefill = this.buildPrefill(p, evs, quarterStart, warnings);
    const overrideValues = { ...(overrides?.values || {}) };
    const values: Record<string, string> = { ...prefill, ...overrideValues };
    const name = p?.name || evs[0]?.patientName || '';
    return {
      patientId,
      name,
      hasEvents: evs.length > 0,
      statusNote,
      excluded: !!overrides?.excluded,
      warnings,
      prefill,
      overrideValues,
      values,
    };
  }

  /**
   * 每週透析次數：freq 為中文星期字串（一三五 / 二四六 / 一四 / 每日…），
   * 依 utils/scheduleUtils.ts 的 FREQ_TO_DAYS_MAP 慣例（scheduleUtils.ts:80）
   * 「freq 字串的每個星期字＝每週一次」換算：計 一二三四五六日 字元數；每日=7。
   */
  private weeklySessionsFromFreq(freq: string | null | undefined): number | null {
    const s = String(freq || '').trim();
    if (!s) return null;
    if (s === '每日') return 7;
    const matches = s.match(/[一二三四五六日]/g);
    return matches && matches.length ? matches.length : null;
  }

  private buildPrefill(
    p: any,
    evs: VascularAccessEvent[],
    quarterStart: string,
    warnings: string[],
  ): Record<string, string> {
    const v: Record<string, string> = {};
    for (const k of KIDIT_VASCULAR_FIELD_KEYS) v[k] = '';

    // 欄 1-3
    v['idNumber'] = p?.idNumber || '';
    v['medicalRecordNumber'] = p?.medicalRecordNumber || evs[0]?.medicalRecordNumber || '';
    v['reportDate'] = toRocDate7(quarterStart);

    // 欄 4-15 目前通路快照：主檔 vascAccess 字串對映（null → 全 N）
    for (const g of ['Avf', 'Avg', 'Perm', 'Temp']) v[`cur${g}Yn`] = 'N';
    const s = String(p?.vascAccess || '');
    const upper = s.toUpperCase();
    const side = s.includes('左') ? 'L' : s.includes('右') ? 'R' : '';
    // 前臂（含「手」）→1；上臂（含「臂」）→2。「前臂」也含「臂」字，須先判斷。
    const fistulaSite = s.includes('前臂') ? '1' : s.includes('臂') ? '2' : s.includes('手') ? '1' : '';
    if (upper.includes('AVF')) { v['curAvfYn'] = 'Y'; v['curAvfSide'] = side; v['curAvfSite'] = fistulaSite; }
    if (upper.includes('AVG')) { v['curAvgYn'] = 'Y'; v['curAvgSide'] = side; v['curAvgSite'] = fistulaSite; }
    if (/PERM/i.test(s)) { v['curPermYn'] = 'Y'; v['curPermSide'] = side; v['curPermSite'] = '1'; }
    if (/DOUBLE\s*LUMEN/i.test(s)) { v['curTempYn'] = 'Y'; v['curTempSide'] = side; v['curTempSite'] = '1'; }

    // 該季最近一筆 confirmed reconstruction 覆蓋對應組（evs 已依日期升冪）
    const recs = evs.filter((e) => e.eventType === 'reconstruction');
    const latestRec = recs[recs.length - 1];
    if (latestRec?.newAccessType) {
      const g = ACCESS_TYPE_TO_GROUP[latestRec.newAccessType];
      if (g) {
        v[`cur${g}Yn`] = 'Y';
        v[`cur${g}Side`] = latestRec.newAccessSide || '';
        v[`cur${g}Site`] = latestRec.newAccessSite || '';
      }
    }

    // 欄 16-17：bestPumpFlow 預填自透析醫囑血流量（仍必填、可改）；accessFlow 人工選填
    const bfRaw = String((p?.dialysisOrders?.bloodFlow ?? p?.dialysisOrders?.blood_flow) ?? '');
    const bfNum = bfRaw.match(/\d+/);
    v['bestPumpFlow'] = bfNum ? bfNum[0] : '';
    // 欄 18-20 遠紅外線：預設 Y；次數=每週透析次數；分鐘=次數×40
    v['firYn'] = 'Y';
    const weekly = this.weeklySessionsFromFreq(p?.scheduleRule?.freq);
    v['firPerWeek'] = weekly != null ? String(weekly) : '';
    v['firWeeklyMinutes'] = weekly != null ? String(weekly * 40) : '';

    // 欄 21-23 其他熱療：N/空/空；欄 24-36 並存：N + 12 欄空（比照官方範例）
    v['otherHeatYn'] = 'N';
    v['coexistYn'] = 'N';

    // 欄 37：該季有 confirmed 事件 → Y
    v['hasProblem'] = evs.length > 0 ? 'Y' : 'N';

    // 欄 38-49 介入治療 ×3（日期升冪，>3 筆取最近 3 筆）
    const itvs = evs.filter((e) => e.eventType === 'intervention');
    const itvSel = itvs.length > 3 ? itvs.slice(-3) : itvs;
    if (itvs.length > 3) warnings.push(`本季介入治療 ${itvs.length} 筆僅匯出 3 筆`);
    itvSel.forEach((ev, i) => {
      const n = i + 1;
      v[`itv${n}Date`] = toRocDate7(ev.eventDate);
      v[`itv${n}Reason`] = ev.failureReason || '';
      v[`itv${n}Method`] = ev.repairMethod || '';
      v[`itv${n}MethodOther`] = ev.repairMethodOther || '';
    });

    // 欄 50-82 血管重建 ×3
    const recSel = recs.length > 3 ? recs.slice(-3) : recs;
    if (recs.length > 3) warnings.push(`本季血管重建 ${recs.length} 筆僅匯出 3 筆`);
    recSel.forEach((ev, i) => {
      const n = i + 1;
      v[`rec${n}Date`] = toRocDate7(ev.eventDate);
      v[`rec${n}PrevReason`] = ev.failureReason || '';
      for (const g of ['Avf', 'Avg', 'Perm']) v[`rec${n}${g}Yn`] = 'N';
      const g = ev.newAccessType ? ACCESS_TYPE_TO_GROUP[ev.newAccessType] : null;
      if (ev.newAccessType === 'TEMP') {
        // 官方重建區塊（欄50-82）沒有短期導管型態欄，三組型態全 N
        warnings.push(`${toRocDate7(ev.eventDate)} 重建為短期導管，官方欄位無對應（三型態均 N）`);
      } else if (g) {
        v[`rec${n}${g}Yn`] = 'Y';
        v[`rec${n}${g}Side`] = ev.newAccessSide || '';
        v[`rec${n}${g}Site`] = ev.newAccessSite || '';
      }
    });

    return v;
  }

  // -------------------------------------------------------------------------
  // 編輯與 overrides 儲存
  // -------------------------------------------------------------------------
  onFieldChange(row: QRow, key: string, value: string): void {
    row.values[key] = value;
    if ((value ?? '') === (row.prefill[key] ?? '')) {
      delete row.overrideValues[key];
    } else {
      row.overrideValues[key] = value ?? '';
    }
    this.queueSave(row);
    if (key === 'bestPumpFlow') this.refreshMissingFlowCount();
  }

  toggleExcluded(row: QRow): void {
    row.excluded = !row.excluded;
    this.queueSave(row);
    this.refreshMissingFlowCount();
  }

  /** rows 內容為就地變更（不重設 signal），計數用明確刷新而非 computed */
  private refreshMissingFlowCount(): void {
    this.missingFlowCount.set(
      this.rows().filter((r) => !r.excluded && !String(r.values['bestPumpFlow'] || '').trim()).length,
    );
  }

  private queueSave(row: QRow): void {
    const prev = this.saveTimers.get(row.patientId);
    if (prev) clearTimeout(prev);
    this.saveTimers.set(row.patientId, setTimeout(() => {
      this.saveTimers.delete(row.patientId);
      this.saveRow(row);
    }, 800));
  }

  /** 關窗/切季前立即送出尚未觸發的 debounce 儲存 */
  private flushPendingSaves(): void {
    const pending = [...this.saveTimers.entries()];
    this.saveTimers.clear();
    const rowById = new Map(this.rows().map((r) => [r.patientId, r]));
    for (const [patientId, timer] of pending) {
      clearTimeout(timer);
      const row = rowById.get(patientId);
      if (row) this.saveRow(row);
    }
  }

  private async saveRow(row: QRow): Promise<void> {
    const overrides: QuarterOverrides = {
      excluded: row.excluded,
      values: row.overrideValues,
    };
    this.saveState.set('saving');
    try {
      await localApi.put(
        `/vascular-access/quarter-exports/${this.quarterStr()}/${row.patientId}`,
        { overrides },
      );
      if (this.saveTimers.size === 0) this.saveState.set('saved');
    } catch (error) {
      console.error('儲存季度覆寫失敗:', error);
      this.saveState.set('error');
    }
  }

  // -------------------------------------------------------------------------
  // 匯出
  // -------------------------------------------------------------------------
  exportCsv(): void {
    const rows = this.rows().filter((r) => !r.excluded);
    if (!rows.length) { alert('本季無可匯出的病人。'); return; }

    const missing = rows.filter((r) => !String(r.values['bestPumpFlow'] || '').trim());
    if (missing.length) {
      alert(
        '以下病人尚未填寫「本季透析時最佳 pump blood flow」，請補齊後再匯出：\n' +
        missing.map((r) => r.name || r.patientId).join('、'),
      );
      return;
    }

    const { startDate, endDate } = quarterRange(this.year(), this.q());
    try {
      downloadKiditVascularCsv(rows.map((r) => r.values), startDate, endDate);
    } catch (error) {
      console.error('匯出季度造管 CSV 失敗:', error);
      alert('匯出失敗，請稍後再試。');
    }
  }

  trackByPatientId(_index: number, row: QRow): string {
    return row.patientId;
  }

  trackByKey(_index: number, col: ColDef): string {
    return col.key;
  }
}
