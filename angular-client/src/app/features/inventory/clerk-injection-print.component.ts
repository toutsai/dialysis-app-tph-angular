// 書記專用 > 針劑發放名單
// 書記每天每班要協助把 Good-Fe / Cacare 發給各組護理師。
// 資料源：當日排程（今天/未來走 live、過去走歸檔）＋ 當日護理分組（nurse_assignments）
//        ＋ 每日應施打針劑（POST /medications/daily-injections，與臨床查閱/護理分組同一支）。
// 依組別 A~K/外圍/未分組 分段列出 負責護理師、床號、姓名、藥名、劑量，可列印單班或整天（三班三頁）。
import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiManagerService, type FirestoreRecord } from '@services/api-manager.service';
import { ArchiveStoreService } from '@services/archive-store.service';
import { MedicationStoreService, type InjectionRecord } from '@services/medication-store.service';
import { fetchTeamsByDate } from '@/services/nurseAssignmentsService';
import { SHIFT_CODES, ORDERED_SHIFT_CODES, getShiftDisplayName, baseTeams } from '@/constants/scheduleConstants';

type ShiftCode = 'early' | 'noon' | 'late';

/** 書記預設發放的針劑代碼（Good-Fe＝IFER2、Cacare＝ICAC） */
const DEFAULT_DISPENSE_CODES = new Set(['IFER2', 'ICAC']);

interface DispenseRow {
  patientId: string;
  bedLabel: string;
  bedSortKey: number;
  patientName: string;
  orderCode: string;
  orderName: string;
  dose: string;
  unit: string;
}

interface DispenseGroup {
  /** 組別顯示名（A、B…外圍、未分組） */
  team: string;
  nurseName: string;
  rows: DispenseRow[];
}

interface ShiftView {
  shift: ShiftCode;
  label: string;
  groups: DispenseGroup[];
  /** 藥名 → 總量（含單位）供備藥 */
  totals: { name: string; count: number; doseSum: number; unit: string }[];
  rowCount: number;
}

@Component({
  selector: 'app-clerk-injection-print',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './clerk-injection-print.component.html',
  styleUrl: './clerk-injection-print.component.css',
})
export class ClerkInjectionPrintComponent implements OnInit {
  private readonly apiManagerService = inject(ApiManagerService);
  private readonly archiveStore = inject(ArchiveStoreService);
  private readonly medicationStore = inject(MedicationStoreService);

  readonly SHIFT_OPTIONS: { code: ShiftCode; label: string }[] = ORDERED_SHIFT_CODES.map(
    (code: string) => ({ code: code as ShiftCode, label: getShiftDisplayName(code) }),
  );

  selectedDate = signal(this.formatDate(new Date()));
  selectedShift = signal<ShiftCode>(this.defaultShift());
  /** false＝只列 Good-Fe / Cacare；true＝所有應打針劑 */
  showAllMeds = signal(false);
  isLoading = signal(false);
  loadError = signal('');

  private schedule = signal<Record<string, any>>({});
  private teamsRecord = signal<{ teams: Record<string, any>; names: Record<string, string> }>({ teams: {}, names: {} });
  private injections = signal<InjectionRecord[]>([]);
  private loadedDate = signal('');

  /** 三班各自的分組檢視（一次算好，列印整天直接用） */
  readonly shiftViews = computed<ShiftView[]>(() =>
    this.SHIFT_OPTIONS.map((opt) => this.buildShiftView(opt.code, opt.label)),
  );

  readonly currentView = computed<ShiftView>(() => {
    const shift = this.selectedShift();
    return this.shiftViews().find((v) => v.shift === shift) || this.shiftViews()[0];
  });

  readonly displayDate = computed(() => {
    const d = new Date(this.selectedDate() + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return this.selectedDate();
    const weekday = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${weekday}）`;
  });

  readonly hasTeamsData = computed(() => Object.keys(this.teamsRecord().names || {}).length > 0);

  async ngOnInit(): Promise<void> {
    await this.loadDate();
  }

  // ==================== 操作 ====================

  onDateChange(value: string): void {
    if (!value) return;
    this.selectedDate.set(value);
    void this.loadDate();
  }

  shiftDate(days: number): void {
    const d = new Date(this.selectedDate() + 'T00:00:00');
    d.setDate(d.getDate() + days);
    this.onDateChange(this.formatDate(d));
  }

  goToday(): void {
    this.onDateChange(this.formatDate(new Date()));
  }

  async refresh(): Promise<void> {
    this.medicationStore.clearCache();
    await this.loadDate(true);
  }

  // ==================== 載入 ====================

  private async loadDate(force = false): Promise<void> {
    const dateStr = this.selectedDate();
    if (!force && this.loadedDate() === dateStr) return;
    this.isLoading.set(true);
    this.loadError.set('');
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const target = new Date(dateStr + 'T00:00:00');
      const isPast = target < today;

      const [scheduleRecord, teamsData] = await Promise.all([
        isPast
          ? this.archiveStore.fetchScheduleByDate(dateStr)
          : this.apiManagerService.create<FirestoreRecord>('schedules').fetchById(dateStr),
        fetchTeamsByDate(dateStr).catch(() => null),
      ]);
      const schedule: Record<string, any> = (scheduleRecord as any)?.schedule || {};
      this.schedule.set(schedule);
      this.teamsRecord.set({
        teams: (teamsData as any)?.teams || {},
        names: (teamsData as any)?.names || {},
      });

      const patientIds = [
        ...new Set(
          Object.values(schedule)
            .map((slot: any) => slot?.patientId)
            .filter((id: any): id is string => !!id),
        ),
      ];
      const injections = await this.medicationStore.fetchDailyInjections(dateStr, patientIds);
      this.injections.set(injections);
      this.loadedDate.set(dateStr);
    } catch (error) {
      console.error('[ClerkInjectionPrint] 載入失敗:', error);
      this.loadError.set('載入資料失敗，請重新整理再試。');
      this.schedule.set({});
      this.injections.set([]);
    } finally {
      this.isLoading.set(false);
    }
  }

  // ==================== 分組運算 ====================

  private buildShiftView(shift: ShiftCode, label: string): ShiftView {
    const schedule = this.schedule();
    const { teams, names } = this.teamsRecord();
    const showAll = this.showAllMeds();

    // 該班病人 → 床號 + 組別
    const patientSlot = new Map<string, { bedLabel: string; bedSortKey: number; teamKey: string }>();
    for (const [shiftId, slot] of Object.entries(schedule)) {
      if (!slot?.patientId || !shiftId.endsWith(`-${shift}`)) continue;
      const parts = shiftId.split('-');
      const isPeripheral = parts[0] === 'peripheral';
      const bedNum = parseInt(parts[1], 10);
      const teamInfo = teams[`${slot.patientId}-${shift}`] || slot;
      patientSlot.set(slot.patientId, {
        bedLabel: isPeripheral ? `外${parts[1]}` : parts[1],
        bedSortKey: isPeripheral ? 1000 + (bedNum || 0) : bedNum || 999,
        teamKey: this.resolveTeamKey(shift, teamInfo),
      });
    }

    // 組別 → 列
    const prefix = shift === SHIFT_CODES.LATE ? '晚' : '早';
    const groupMap = new Map<string, DispenseGroup>();
    const orderedTeams = [...baseTeams, '未分組'];
    for (const t of orderedTeams) {
      groupMap.set(`${prefix}${t}`, { team: t, nurseName: names[`${prefix}${t}`] || '', rows: [] });
    }

    for (const inj of this.injections()) {
      const info = patientSlot.get(inj.patientId);
      if (!info) continue;
      const code = String(inj.orderCode || '');
      if (!showAll && !DEFAULT_DISPENSE_CODES.has(code)) continue;
      const teamKey = info.teamKey || `${prefix}未分組`;
      let group = groupMap.get(teamKey);
      if (!group) {
        // 當日 names 內動態補的組（如 早L）
        group = { team: teamKey.replace(/^(早|晚)/, ''), nurseName: names[teamKey] || '', rows: [] };
        groupMap.set(teamKey, group);
      }
      group.rows.push({
        patientId: inj.patientId,
        bedLabel: info.bedLabel,
        bedSortKey: info.bedSortKey,
        patientName: inj.patientName || '',
        orderCode: code,
        orderName: inj.orderName || code,
        dose: String(inj.dose ?? ''),
        unit: inj.unit || '',
      });
    }

    const groups = [...groupMap.values()].filter((g) => g.rows.length > 0);
    for (const g of groups) {
      g.rows.sort((a, b) => a.bedSortKey - b.bedSortKey || a.orderName.localeCompare(b.orderName));
    }

    // 備藥總量
    const totalMap = new Map<string, { name: string; count: number; doseSum: number; unit: string }>();
    for (const g of groups) {
      for (const r of g.rows) {
        const t = totalMap.get(r.orderName) || { name: r.orderName, count: 0, doseSum: 0, unit: r.unit };
        t.count += 1;
        const d = parseFloat(r.dose);
        if (!Number.isNaN(d)) t.doseSum += d;
        totalMap.set(r.orderName, t);
      }
    }

    return {
      shift,
      label,
      groups,
      totals: [...totalMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
      rowCount: groups.reduce((n, g) => n + g.rows.length, 0),
    };
  }

  /** 早班/晚班看 nurseTeam；午班上機屬早班組（nurseTeamIn），沒填才退到收針組 */
  private resolveTeamKey(shift: ShiftCode, teamInfo: any): string {
    if (!teamInfo) return '';
    if (shift === SHIFT_CODES.NOON) return teamInfo.nurseTeamIn || teamInfo.nurseTeamOut || '';
    return teamInfo.nurseTeam || '';
  }

  // ==================== 列印 ====================

  printCurrentShift(): void {
    this.openPrint([this.currentView()]);
  }

  printWholeDay(): void {
    this.openPrint(this.shiftViews());
  }

  private openPrint(views: ShiftView[]): void {
    const pages = views
      .map((v, idx) => this.renderShiftHtml(v, idx < views.length - 1))
      .join('');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>針劑發放名單 ${this.selectedDate()}</title>
<style>
  @page { size: A4 portrait; margin: 1.2cm; }
  body { font-family: 'Microsoft JhengHei', 'Segoe UI', sans-serif; font-size: 12pt; margin: 0; color: #000; }
  .page { page-break-after: always; }
  .page:last-child { page-break-after: auto; }
  h2 { text-align: center; font-size: 17pt; margin: 0 0 0.3rem; }
  .meta { text-align: center; font-size: 10.5pt; margin-bottom: 0.6rem; color: #333; }
  .totals { font-size: 11pt; margin-bottom: 0.6rem; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #555; padding: 4px 6px; text-align: center; }
  th { background: #eee; }
  td.name { text-align: left; }
  tr.group-head td { background: #f5f5f5; font-weight: 700; text-align: left; }
  tr { page-break-inside: avoid; }
  .empty { text-align: center; padding: 2rem 0; color: #666; }
</style></head><body>${pages}</body></html>`;

    const iframe = document.createElement('iframe');
    iframe.style.position = 'absolute';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.setAttribute('title', 'Print Frame');
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow!.document;
    doc.open();
    doc.write(html);
    doc.close();
    iframe.onload = () => {
      try {
        iframe.contentWindow!.focus();
        iframe.contentWindow!.print();
      } catch (e) {
        console.error('列印失敗:', e);
      } finally {
        setTimeout(() => document.body.removeChild(iframe), 500);
      }
    };
  }

  private renderShiftHtml(view: ShiftView, breakAfter: boolean): string {
    const esc = (s: string) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    const scope = this.showAllMeds() ? '全部針劑' : 'Good-Fe / Cacare';
    const totals = view.totals.length
      ? `<div class="totals">備藥合計：${view.totals
          .map((t) => `${esc(t.name)} ${t.count} 人（${this.formatNumber(t.doseSum)} ${esc(t.unit)}）`)
          .join('；')}</div>`
      : '';
    let body = '';
    if (view.groups.length === 0) {
      body = `<div class="empty">本班沒有應發放的針劑。</div>`;
    } else {
      const rows = view.groups
        .map((g) => {
          const head = `<tr class="group-head"><td colspan="4">${esc(g.team)} 組　負責護理師：${esc(g.nurseName) || '—'}　（${g.rows.length} 筆）</td></tr>`;
          const items = g.rows
            .map(
              (r) =>
                `<tr><td>${esc(r.bedLabel)}</td><td class="name">${esc(r.patientName)}</td><td>${esc(r.orderName)}</td><td>${esc(r.dose)} ${esc(r.unit)}</td></tr>`,
            )
            .join('');
          return head + items;
        })
        .join('');
      body = `<table><thead><tr><th style="width:12%">床號</th><th style="width:34%">姓名</th><th style="width:30%">藥名</th><th style="width:24%">劑量</th></tr></thead><tbody>${rows}</tbody></table>`;
    }
    return `<div class="${breakAfter ? 'page' : ''}">
      <h2>${esc(this.displayDate())}　${esc(view.label)}　針劑發放名單</h2>
      <div class="meta">範圍：${scope}　共 ${view.rowCount} 筆　　發放人：＿＿＿＿＿＿</div>
      ${totals}${body}</div>`;
  }

  // ==================== 工具 ====================

  formatNumber(n: number): string {
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
  }

  private formatDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /** 依現在時刻預設班別：<11 早、<16 午、其餘晚 */
  private defaultShift(): ShiftCode {
    const h = new Date().getHours();
    if (h < 11) return SHIFT_CODES.EARLY as ShiftCode;
    if (h < 16) return SHIFT_CODES.NOON as ShiftCode;
    return SHIFT_CODES.LATE as ShiftCode;
  }
}
