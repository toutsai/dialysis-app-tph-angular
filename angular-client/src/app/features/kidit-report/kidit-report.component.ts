import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiConfigService } from '@services/api-config.service';
import { PatientStoreService } from '@services/patient-store.service';
import { kiditService } from '@/services/kiditService';
import { exportKiDitExcel } from '@/services/kiditExportService';
import { exportVascularAccessExcel, VascularAccessRow } from '@/services/vascularAccessExportService';
import { exportFirstDialysisExcel, FirstDialysisRow } from '@/services/firstDialysisExportService';
import { localApi } from '@/services/localApiClient';
import { KiditDetailModalComponent } from '@app/components/kidit/kidit-detail-modal.component';

interface DayData {
  dateStr: string;
  dayNum: number;
  events: any[];
  unregistered: number;
}

@Component({
  selector: 'app-kidit-report',
  standalone: true,
  imports: [CommonModule, FormsModule, KiditDetailModalComponent],
  templateUrl: './kidit-report.component.html',
  styleUrl: './kidit-report.component.css',
})
export class KiditReportComponent implements OnInit {
  private readonly patientStore = inject(PatientStoreService);

  readonly currentYear = signal(new Date().getFullYear());
  readonly currentMonth = signal(new Date().getMonth() + 1);
  readonly daysData = signal<DayData[]>([]);
  readonly isLoading = signal(false);
  // 血管通路事件清單彈窗
  readonly showVascularModal = signal(false);
  readonly isLoadingVascular = signal(false);
  readonly vascularRows = signal<VascularAccessRow[]>([]);
  // 初次透析名單彈窗
  readonly showFirstDialysisModal = signal(false);
  readonly isLoadingFirstDialysis = signal(false);
  readonly firstDialysisRows = signal<FirstDialysisRow[]>([]);
  readonly weekDays = ['日', '一', '二', '三', '四', '五', '六'];

  // Modal state
  readonly showModal = signal(false);
  readonly selectedDate = signal('');
  readonly selectedEvents = signal<any[]>([]);

  readonly firstDayOffset = computed(() =>
    new Date(this.currentYear(), this.currentMonth() - 1, 1).getDay()
  );

  readonly emptySlots = computed(() => Array(this.firstDayOffset()));

  ngOnInit(): void {
    this.fetchData();
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
        tempDays.push({
          dateStr,
          dayNum: d,
          events,
          unregistered: events.filter((e: any) => !e.isRegistered).length,
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
  }

  openModal(day: DayData): void {
    this.selectedDate.set(day.dateStr);
    this.selectedEvents.set(day.events);
    this.showModal.set(true);
  }

  closeModal(): void {
    this.showModal.set(false);
  }

  onModalRefresh(): void {
    this.fetchData();
  }

  exportToExcel(): void {
    const days = this.daysData();
    if (!days.length) { alert('目前無資料可匯出'); return; }

    const allEvents = days.flatMap(day => day.events);
    if (allEvents.length === 0) { alert('本月份尚無任何事件紀錄。'); return; }

    const filename = `KiDit_Export_${this.currentYear()}_${String(this.currentMonth()).padStart(2, '0')}.xlsx`;
    try {
      exportKiDitExcel(allEvents, filename);
    } catch (error) {
      console.error('匯出失敗:', error);
      alert('匯出失敗，請檢查資料格式');
    }
  }

  /**
   * 開啟「當月血管通路事件清單」彈窗：點擊時即時彙整當月每日工作日誌的 vascularAccessLog。
   * 每次點開才查詢（月量不大），不在每日工作日誌新增時同步，避免維護同步副本。
   */
  async openVascularList(): Promise<void> {
    const year = this.currentYear();
    const month = this.currentMonth();
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const next = new Date(year, month, 1);
    const endDate = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`;

    this.showVascularModal.set(true);
    this.isLoadingVascular.set(true);
    this.vascularRows.set([]);
    try {
      const logs = await localApi.get(
        `/nursing/daily-logs?startDate=${startDate}&endDate=${endDate}`,
      );
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
          });
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

  closeVascularModal(): void {
    this.showVascularModal.set(false);
  }

  /** 匯出彈窗內已彙整的清單 */
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
   * 開啟「當月初次透析名單」彈窗：來源為病人資料庫的 firstDialysisDate（含已刪除病人）。
   * 點擊時即時過濾（已載入的 allPatients），不需後端。
   */
  async openFirstDialysisList(): Promise<void> {
    const year = this.currentYear();
    const month = this.currentMonth();
    const ym = `${year}-${String(month).padStart(2, '0')}`;

    this.showFirstDialysisModal.set(true);
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

  closeFirstDialysisModal(): void {
    this.showFirstDialysisModal.set(false);
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
}
