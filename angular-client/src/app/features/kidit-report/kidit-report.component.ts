import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ApiConfigService } from '@services/api-config.service';
import { PatientStoreService } from '@services/patient-store.service';
import { kiditService } from '@/services/kiditService';
import {
  buildInitialRegistrationRows,
  downloadPatientCsv,
  downloadHistoryCsv,
} from '@/services/kiditInitialCsvService';
import { quarterRange, currentQuarter } from '@/services/kiditVascularCsvService';
import {
  KiditQuarterRecord,
  QuarterExportRow,
  fetchQuarterRecords,
  downloadHdrecordCsv,
  downloadDiagnoseCsv,
  downloadComorbidCsv,
} from '@/services/kiditQuarterInputService';
import { exportVascularAccessExcel, VascularAccessRow } from '@/services/vascularAccessExportService';
import { exportFirstDialysisExcel, FirstDialysisRow } from '@/services/firstDialysisExportService';
import {
  downloadMonthlyBasicDataCsv,
  basicDataStatusText,
  MonthlyBasicDataRow,
} from '@/services/kiditBasicDataCsvService';
import { localApi } from '@/services/localApiClient';
import { KiditDetailModalComponent } from '@app/components/kidit/kidit-detail-modal.component';
import { KiditVascularQuarterlyComponent } from './kidit-vascular-quarterly.component';
import { KiditQuarterlyMovementsComponent } from './kidit-quarterly-movements.component';
import { KiditHdrxQuarterlyComponent } from './kidit-hdrx-quarterly.component';
import { KiditHospQuarterlyComponent } from './kidit-hosp-quarterly.component';
import { describeVascularEvent, VascularAccessEvent } from '@app/core/constants/vascular-access-codes';

interface DayData {
  dateStr: string;
  dayNum: number;
  events: any[];
  /** 月曆格顯示的事件數：排除血管通路事件(ACCESS)，與詳情彈窗當日動態列表一致 */
  displayCount: number;
  unregistered: number;
}

/** 主頁籤：依 KiDit 申報項目分區；hdrx/qinput/hosp 為後續批次的建置中佔位 */
type MainTab = 'overview' | 'initial' | 'vascular' | 'movement' | 'hdrx' | 'qinput' | 'hosp';
type InitialSubTab = 'pending' | 'basic' | 'first';

@Component({
  selector: 'app-kidit-report',
  standalone: true,
  imports: [CommonModule, FormsModule, KiditDetailModalComponent, KiditVascularQuarterlyComponent, KiditQuarterlyMovementsComponent, KiditHdrxQuarterlyComponent, KiditHospQuarterlyComponent],
  templateUrl: './kidit-report.component.html',
  styleUrl: './kidit-report.component.css',
})
export class KiditReportComponent implements OnInit {
  private readonly patientStore = inject(PatientStoreService);
  private readonly route = inject(ActivatedRoute);

  readonly mainTabs: { key: MainTab; label: string; icon: string; wip?: boolean }[] = [
    { key: 'overview', label: '申報總覽', icon: 'fa-clipboard-check' },
    { key: 'initial', label: '初次建檔', icon: 'fa-id-card' },
    { key: 'vascular', label: '季度造管', icon: 'fa-file-csv' },
    { key: 'movement', label: '病人動態', icon: 'fa-calendar-alt' },
    { key: 'hdrx', label: 'HD處方', icon: 'fa-prescription' },
    { key: 'qinput', label: '季度輸入', icon: 'fa-notes-medical' },
    { key: 'hosp', label: '住出院', icon: 'fa-hospital' },
  ];

  readonly activeTab = signal<MainTab>('overview');
  readonly initialSubTab = signal<InitialSubTab>('pending');
  /** 月份導覽只在月份相關頁籤顯示（總覽與季度制頁籤用不到） */
  readonly showMonthNav = computed(() => ['initial', 'vascular', 'movement'].includes(this.activeTab()));

  readonly currentYear = signal(new Date().getFullYear());
  readonly currentMonth = signal(new Date().getMonth() + 1);
  readonly daysData = signal<DayData[]>([]);
  readonly isLoading = signal(false);
  // 血管通路事件清單（季度造管頁籤內嵌）
  readonly isLoadingVascular = signal(false);
  readonly vascularRows = signal<VascularAccessRow[]>([]);
  // 初次透析名單（初次建檔頁籤內嵌）
  readonly isLoadingFirstDialysis = signal(false);
  readonly firstDialysisRows = signal<FirstDialysisRow[]>([]);
  // 季度造管 CSV 工作檯彈窗
  readonly showQuarterlyModal = signal(false);
  // 季度病人動態彙整彈窗（本院常規HD／新病患／外院）
  readonly showMovementsQuarterly = signal(false);
  // KiDit 待建檔清單（初次建檔頁籤內嵌；本院初透/首透且基本資料未完整）
  readonly isLoadingPendingReg = signal(false);
  readonly pendingRegRows = signal<any[]>([]);
  // 每月基本資料（初次建檔頁籤內嵌；本院初透 × 建檔基本資料，含未建檔比對）
  readonly isLoadingBasicData = signal(false);
  readonly basicDataRows = signal<MonthlyBasicDataRow[]>([]);
  readonly weekDays = ['日', '一', '二', '三', '四', '五', '六'];

  // Modal state
  readonly showModal = signal(false);
  readonly selectedDate = signal('');
  readonly selectedEvents = signal<any[]>([]);
  /** 從待建檔清單點入時要預選的病人；月曆正常開窗為 null */
  readonly modalInitialPatientId = signal<string | null>(null);
  /** 從待建檔清單點入時直達的分頁（registration=KiDit 建檔）；正常開窗為 null */
  readonly modalInitialTab = signal<'movement' | 'vascular' | 'registration' | null>(null);

  readonly firstDayOffset = computed(() =>
    new Date(this.currentYear(), this.currentMonth() - 1, 1).getDay()
  );

  readonly emptySlots = computed(() => Array(this.firstDayOffset()));

  ngOnInit(): void {
    // 從「我的今日病人・本院初透建檔」點入：?openPatient=<id>&eventDate=<YYYY-MM-DD>
    // 切到事件日所在月份並自動開啟該病人的建檔視窗（背景停在初次建檔頁籤）
    const qp = this.route.snapshot.queryParamMap;
    const openPatient = qp.get('openPatient');
    const eventDate = qp.get('eventDate');
    if (openPatient && eventDate) {
      const [y, m] = eventDate.split('-').map(Number);
      if (y && m >= 1 && m <= 12) {
        this.currentYear.set(y);
        this.currentMonth.set(m);
      }
      this.activeTab.set('initial');
      this.fetchData();
      this.loadPendingRegList();
      this.openPendingRegTarget({ patientId: openPatient, lastEventDate: eventDate });
      return;
    }
    this.fetchData();
  }

  setTab(tab: MainTab): void {
    if (this.activeTab() === tab) return;
    this.activeTab.set(tab);
    if (tab === 'initial') this.loadInitialSubTab();
    else if (tab === 'vascular') this.loadVascularList();
    else if (tab === 'qinput') this.loadQuarterInput();
  }

  setInitialSubTab(sub: InitialSubTab): void {
    if (this.initialSubTab() === sub) return;
    this.initialSubTab.set(sub);
    this.loadInitialSubTab();
  }

  /** 載入初次建檔頁籤目前子頁籤的清單（切頁籤/切月份時呼叫） */
  private loadInitialSubTab(): void {
    const sub = this.initialSubTab();
    if (sub === 'pending') this.loadPendingRegList();
    else if (sub === 'basic') this.loadBasicDataList();
    else this.loadFirstDialysisList();
  }

  trackByDate(_index: number, day: DayData): string {
    return day.dateStr;
  }

  isToday(dateStr: string): boolean {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    return dateStr === `${y}-${m}-${d}`;
  }

  async fetchData(): Promise<void> {
    this.isLoading.set(true);
    try {
      await this.patientStore.fetchPatientsIfNeeded();

      const logs = await kiditService.fetchMonthLogs(this.currentYear(), this.currentMonth());
      const daysInMonth = new Date(this.currentYear(), this.currentMonth(), 0).getDate();
      const logMap: Record<string, any[]> = {};
      logs.forEach((l: any) => (logMap[l.date] = l.events || []));

      const tempDays: DayData[] = [];
      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${this.currentYear()}-${String(this.currentMonth()).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const events = logMap[dateStr] || [];
        // 計數排除 ACCESS：通路事件不顯示於當日動態，也不該掛在「未登錄」提醒上
        const countable = events.filter((e: any) => e.type !== 'ACCESS');
        tempDays.push({
          dateStr,
          dayNum: d,
          events,
          displayCount: countable.length,
          unregistered: countable.filter((e: any) => !e.isRegistered).length,
        });
      }
      this.daysData.set(tempDays);
    } catch (e) {
      console.error('載入 KiDit 資料失敗:', e);
    } finally {
      this.isLoading.set(false);
    }
  }

  changeMonth(offset: number): void {
    let m = this.currentMonth() + offset;
    let y = this.currentYear();
    if (m > 12) { m = 1; y++; }
    else if (m < 1) { m = 12; y--; }
    this.currentMonth.set(m);
    this.currentYear.set(y);
    this.fetchData();
    // 月份相關的內嵌清單跟著換月重載
    if (this.activeTab() === 'initial') this.loadInitialSubTab();
    else if (this.activeTab() === 'vascular') this.loadVascularList();
  }

  openModal(day: DayData): void {
    this.modalInitialPatientId.set(null);
    this.modalInitialTab.set(null);
    this.selectedDate.set(day.dateStr);
    this.selectedEvents.set(day.events);
    this.showModal.set(true);
  }

  closeModal(): void {
    this.showModal.set(false);
    this.modalInitialPatientId.set(null);
    // 彈窗內儲存不再逐次重抓整月，改為關窗時更新一次月曆彙總
    this.fetchData();
    // 建檔完成會退出待建檔清單：停在初次建檔頁籤時同步刷新內嵌清單
    if (this.activeTab() === 'initial') this.loadInitialSubTab();
  }

  /** 官方病患資料 CSV：本月事件中已填寫建檔「病患資料」的病人（民國日期、官方欄序） */
  exportOfficialPatientCsv(): void {
    const allEvents = this.daysData().flatMap(day => day.events);
    const { patientRows } = buildInitialRegistrationRows(allEvents);
    if (!patientRows.length) { alert('本月份尚無已填寫的「病患資料」建檔。'); return; }
    try {
      downloadPatientCsv(patientRows);
    } catch (error) {
      console.error('匯出失敗:', error);
      alert('匯出失敗，請稍後再試。');
    }
  }

  /** 官方病史原發病 CSV：本月事件中已填寫建檔「病史原發病」的病人 */
  exportOfficialHistoryCsv(): void {
    const allEvents = this.daysData().flatMap(day => day.events);
    const { historyRows } = buildInitialRegistrationRows(allEvents);
    if (!historyRows.length) { alert('本月份尚無已填寫的「病史原發病」建檔。'); return; }
    try {
      downloadHistoryCsv(historyRows);
    } catch (error) {
      console.error('匯出失敗:', error);
      alert('匯出失敗，請稍後再試。');
    }
  }

  /**
   * 載入「當月血管通路事件清單」（季度造管頁籤內嵌）：
   * ① 當月每日工作日誌的 vascularAccessLog（來源=工作日誌）
   * ② 新表 vascular_access_events 的 confirmed 事件（來源=事件填寫：主護填寫經確認或組長補登）
   * 每次進入頁籤才查詢（月量不大），不在每日工作日誌新增時同步，避免維護同步副本。
   */
  async loadVascularList(): Promise<void> {
    const year = this.currentYear();
    const month = this.currentMonth();
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const next = new Date(year, month, 1);
    const endDate = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    this.isLoadingVascular.set(true);
    this.vascularRows.set([]);
    try {
      const [logs, evRes] = await Promise.all([
        localApi.get(`/nursing/daily-logs?startDate=${startDate}&endDate=${endDate}`),
        localApi.get(`/vascular-access/events?startDate=${startDate}&endDate=${monthEnd}&status=confirmed`),
      ]);
      const logList: any[] = Array.isArray(logs) ? logs : (logs?.data || []);

      const rows: VascularAccessRow[] = [];
      logList.forEach((log: any) => {
        // endDate 為次月 1 日（含），排除避免把次月第一天的紀錄帶進來
        if (log.date >= endDate) return;
        (log.vascularAccessLog || []).forEach((ev: any) => {
          rows.push({
            name: ev.name || '',
            medicalRecordNumber: ev.medicalRecordNumber || '',
            date: ev.date || log.date || '',
            interventions: Array.isArray(ev.interventions)
              ? ev.interventions.join('、')
              : (ev.interventions || ''),
            location: ev.location || '',
            source: '工作日誌',
          });
        });
      });

      // 新表 confirmed 事件（主護填寫→組長確認，或組長於工作日誌直接補登）
      const events: VascularAccessEvent[] = evRes?.events || [];
      events.forEach((ev) => {
        rows.push({
          name: ev.patientName || '',
          medicalRecordNumber: ev.medicalRecordNumber || '',
          date: (ev.eventDate || '').slice(0, 10),
          interventions: describeVascularEvent(ev),
          location: ev.location || '',
          source: '事件填寫',
        });
      });

      rows.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      this.vascularRows.set(rows);
    } catch (error) {
      console.error('彙整血管通路事件失敗:', error);
      alert('彙整血管通路事件失敗，請稍後再試。');
    } finally {
      this.isLoadingVascular.set(false);
    }
  }

  openQuarterlyModal(): void {
    this.showQuarterlyModal.set(true);
  }

  closeQuarterlyModal(): void {
    this.showQuarterlyModal.set(false);
  }

  openMovementsQuarterly(): void {
    this.showMovementsQuarterly.set(true);
  }

  closeMovementsQuarterly(): void {
    this.showMovementsQuarterly.set(false);
  }

  /** 匯出已彙整的血管通路事件清單 */
  exportVascularRows(): void {
    const rows = this.vascularRows();
    if (!rows.length) { alert('本月份尚無任何血管通路事件紀錄。'); return; }
    const filename = `血管通路事件清單_${this.currentYear()}_${String(this.currentMonth()).padStart(2, '0')}.xlsx`;
    try {
      exportVascularAccessExcel(rows, filename);
    } catch (error) {
      console.error('匯出失敗:', error);
      alert('匯出失敗，請稍後再試。');
    }
  }

  private readonly statusLabelMap: Record<string, string> = { opd: '門診', ipd: '住院', er: '急診' };

  /**
   * 載入「當月初次透析名單」（初次建檔頁籤內嵌）：來源為病人資料庫的 firstDialysisDate（含已刪除病人）。
   * 進入頁籤時即時過濾（已載入的 allPatients），不需後端。
   */
  async loadFirstDialysisList(): Promise<void> {
    const year = this.currentYear();
    const month = this.currentMonth();
    const ym = `${year}-${String(month).padStart(2, '0')}`;

    this.isLoadingFirstDialysis.set(true);
    this.firstDialysisRows.set([]);
    try {
      await this.patientStore.fetchPatientsIfNeeded();
      const patients = this.patientStore.allPatients();

      // 本院首次透析名單：來源為狀態標記「首透」(patientStatus.isFirstDialysis.date)。
      // 注意：頂層 firstDialysisDate 是「他院初次透析日期」(來自洗腎摘要)，語意不同，不可採用。
      const rows: FirstDialysisRow[] = patients
        .map((p: any) => ({ p, fd: p?.patientStatus?.isFirstDialysis?.date || '' }))
        .filter(({ fd }: any) => typeof fd === 'string' && fd.slice(0, 7) === ym)
        .map(({ p, fd }: any) => ({
          name: p.name || '',
          medicalRecordNumber: p.medicalRecordNumber || '',
          firstDialysisDate: String(fd).slice(0, 10),
          mode: p.mode || '',
          statusLabel: this.statusLabelMap[p.status] || p.status || '',
          physician: p.physician || '',
          isDeleted: !!p.isDeleted,
          deleteReason: p.deleteReason || '',
          deletedDate: p.deletedAt ? String(p.deletedAt).slice(0, 10) : '',
        }));

      rows.sort((a, b) => (a.firstDialysisDate || '').localeCompare(b.firstDialysisDate || ''));
      this.firstDialysisRows.set(rows);
    } catch (error) {
      console.error('彙整初次透析名單失敗:', error);
      alert('彙整初次透析名單失敗，請稍後再試。');
    } finally {
      this.isLoadingFirstDialysis.set(false);
    }
  }

  /** 載入「KiDit 待建檔清單」：本院初透/首透標記且 KiDit 基本資料未完整的病人（後端即時彙整） */
  async loadPendingRegList(): Promise<void> {
    this.isLoadingPendingReg.set(true);
    this.pendingRegRows.set([]);
    try {
      this.pendingRegRows.set(await kiditService.fetchPendingRegistrations());
    } catch (error) {
      console.error('載入 KiDit 待建檔清單失敗:', error);
      alert('載入待建檔清單失敗，請稍後再試。');
    } finally {
      this.isLoadingPendingReg.set(false);
    }
  }

  pendingRegFlagLabel(row: any): string {
    const parts: string[] = [];
    if (row.hospitalFirstDialysisDate != null) parts.push('本院初透');
    if (row.firstDialysisDate != null) parts.push('首透');
    return parts.join('＋') || '—';
  }

  pendingRegMissingLabel(row: any): string {
    const missing: string[] = [];
    if (!row.hasProfile) missing.push('病患資料');
    if (!row.hasHistory) missing.push('病史原發病');
    // 兩欄各自填在不同事件上：單一事件內不完整，仍列入名單
    if (missing.length === 0) return '資料分散於不同事件';
    return missing.join('、');
  }

  /** 點列直接開該病人最近 KiDit 事件所在日期的詳情視窗補建檔 */
  async openPendingRegTarget(row: any): Promise<void> {
    if (!row.lastEventDate) {
      alert('該病人尚無 KiDit 事件（工作日誌尚未有病人動態），請先於工作日誌新增動態後再建檔。');
      return;
    }
    try {
      const log = await kiditService.fetchDayLog(row.lastEventDate);
      this.modalInitialPatientId.set(row.patientId || null);
      this.modalInitialTab.set('registration');
      this.selectedDate.set(row.lastEventDate);
      this.selectedEvents.set(log?.events || []);
      this.showModal.set(true);
    } catch (error) {
      console.error('開啟 KiDit 日誌失敗:', error);
      alert('開啟該日 KiDit 日誌失敗，請稍後再試。');
    }
  }

  exportFirstDialysisRows(): void {
    const rows = this.firstDialysisRows();
    if (!rows.length) { alert('本月份尚無初次透析病人。'); return; }
    const filename = `初次透析名單_${this.currentYear()}_${String(this.currentMonth()).padStart(2, '0')}.xlsx`;
    try {
      exportFirstDialysisExcel(rows, filename);
    } catch (error) {
      console.error('匯出失敗:', error);
      alert('匯出失敗，請稍後再試。');
    }
  }

  /** 載入「當月基本資料」：該月本院初透病人 × KiDit 建檔基本資料（後端即時彙整，含未建檔比對） */
  async loadBasicDataList(): Promise<void> {
    this.isLoadingBasicData.set(true);
    this.basicDataRows.set([]);
    try {
      const month = `${this.currentYear()}-${String(this.currentMonth()).padStart(2, '0')}`;
      const rows = await localApi.get(`/nursing/kidit-monthly-basic-data?month=${month}`);
      this.basicDataRows.set(Array.isArray(rows) ? rows : []);
    } catch (error) {
      console.error('載入每月基本資料彙整失敗:', error);
      alert('載入每月基本資料彙整失敗，請稍後再試。');
    } finally {
      this.isLoadingBasicData.set(false);
    }
  }

  basicDataStatus(row: MonthlyBasicDataRow): string {
    return basicDataStatusText(row);
  }

  /** 西元 YYYY-MM-DD → 民國顯示（45/08/15），無法解析回空字串（生日欄顯示用，儲存/匯出不變） */
  rocDisplay(dateStr: string | undefined): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || ''));
    if (!m) return '';
    const y = Number(m[1]) - 1911;
    if (y <= 0) return '';
    return `${y}/${m[2]}/${m[3]}`;
  }

  /** 未建檔/不完整人數（比對結果提示用） */
  basicDataIncompleteCount(): number {
    return this.basicDataRows().filter((r) => !r.complete).length;
  }

  exportBasicDataCsv(): void {
    const rows = this.basicDataRows();
    if (!rows.length) { alert('本月份尚無標記本院初透的病人。'); return; }
    try {
      downloadMonthlyBasicDataCsv(rows, this.currentYear(), this.currentMonth());
    } catch (error) {
      console.error('匯出失敗:', error);
      alert('匯出失敗，請稍後再試。');
    }
  }

  // ========== 季度輸入彙整（透析紀錄／醫療狀況評估／合併症） ==========

  readonly qiYear = signal(currentQuarter().year);
  readonly qiQ = signal(currentQuarter().q);
  readonly qiQuarter = computed(() => `${this.qiYear()}Q${this.qiQ()}`);
  readonly isLoadingQi = signal(false);
  readonly qiRecords = signal<KiditQuarterRecord[]>([]);
  readonly qiAssignments = signal<{ nurseId: string; nurseName: string; patientIds: string[] }[]>([]);

  qiRangeLabel(): string {
    const r = quarterRange(this.qiYear(), this.qiQ());
    return `${r.startDate} ~ ${r.endDate}`;
  }

  async loadQuarterInput(): Promise<void> {
    this.isLoadingQi.set(true);
    try {
      await this.patientStore.fetchPatientsIfNeeded();
      const [records, care] = await Promise.all([
        fetchQuarterRecords(this.qiQuarter()),
        localApi.get('/nursing/patient-care'),
      ]);
      const excluded = new Set<string>((care as any)?.excludedNurseIds || []);
      this.qiAssignments.set(
        (((care as any)?.assignments || []) as any[]).filter(
          (a) => !excluded.has(a.nurseId) && (a.patientIds || []).length > 0,
        ),
      );
      this.qiRecords.set(records);
    } catch (error) {
      console.error('載入季度輸入彙整失敗:', error);
      alert('載入季度輸入彙整失敗，請稍後再試。');
    } finally {
      this.isLoadingQi.set(false);
    }
  }

  changeQiQuarter(offset: number): void {
    let q = this.qiQ() + offset;
    let y = this.qiYear();
    if (q > 4) { q = 1; y++; }
    else if (q < 1) { q = 4; y--; }
    this.qiQ.set(q);
    this.qiYear.set(y);
    this.loadQuarterInput();
  }

  /** 進度列：分配病人 ∪ 有填寫紀錄的病人，依主護分組排序 */
  qiProgressRows(): any[] {
    const byId = new Map<string, any>(this.patientStore.allPatients().map((p: any) => [p.id, p]));
    const recordByPatient = new Map(this.qiRecords().map((r) => [r.patientId, r]));
    const nurseByPatient = new Map<string, string>();
    for (const a of this.qiAssignments()) {
      for (const pid of a.patientIds || []) nurseByPatient.set(pid, a.nurseName);
    }

    const allIds = new Set<string>([...nurseByPatient.keys(), ...recordByPatient.keys()]);
    const rows: any[] = [];
    for (const pid of allIds) {
      const p = byId.get(pid);
      if (!p || p.isDeleted) continue;
      const rec = recordByPatient.get(pid);
      const c = rec?.data?.completed || {};
      rows.push({
        patientId: pid,
        nurseName: nurseByPatient.get(pid) || '（未分配）',
        name: p.name || '',
        medicalRecordNumber: p.medicalRecordNumber || '',
        hasIdNumber: !!p.idNumber,
        hdrecord: !!c.hdrecord,
        diagnose: !!c.diagnose,
        comorbid: !!c.comorbid,
        touched: !!rec,
        updatedAt: rec?.updatedAt || '',
        editorName: rec?.data?.nurse?.name || rec?.updatedBy?.name || '',
      });
    }
    rows.sort(
      (a, b) => a.nurseName.localeCompare(b.nurseName) || a.name.localeCompare(b.name),
    );
    return rows;
  }

  qiCompletedCount(kind: 'hdrecord' | 'diagnose' | 'comorbid'): number {
    return this.qiProgressRows().filter((r) => r[kind]).length;
  }

  /** 匯出範圍＝該表單勾選「完成」的病人（未完成不出列，避免半套資料進 KiDit） */
  private qiExportRows(kind: 'hdrecord' | 'diagnose' | 'comorbid'): QuarterExportRow[] {
    const byId = new Map<string, any>(this.patientStore.allPatients().map((p: any) => [p.id, p]));
    return this.qiRecords()
      .filter((r) => r.data?.completed?.[kind])
      .map((r) => {
        const p = byId.get(r.patientId) || {};
        return {
          idNumber: p.idNumber || '',
          medicalRecordNumber: p.medicalRecordNumber || '',
          data: r.data,
        };
      })
      .sort((a, b) => a.medicalRecordNumber.localeCompare(b.medicalRecordNumber));
  }

  exportQiCsv(kind: 'hdrecord' | 'diagnose' | 'comorbid'): void {
    const rows = this.qiExportRows(kind);
    if (!rows.length) { alert('本季尚無勾選「完成」的病人可匯出。'); return; }
    const missingId = rows.filter((r) => !r.idNumber).length;
    if (missingId > 0 && !confirm(`有 ${missingId} 位病人缺身份證號（病人管理未填），匯出後需人工補上。仍要匯出？`)) {
      return;
    }
    const { startDate, endDate } = quarterRange(this.qiYear(), this.qiQ());
    try {
      if (kind === 'hdrecord') downloadHdrecordCsv(rows, startDate, endDate);
      else if (kind === 'diagnose') downloadDiagnoseCsv(rows, startDate, endDate);
      else downloadComorbidCsv(rows, startDate, endDate);
    } catch (error) {
      console.error('匯出失敗:', error);
      alert('匯出失敗，請稍後再試。');
    }
  }
}
