import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { localApi } from '@/services/localApiClient';
import { AuthService } from '@app/core/services/auth.service';
import { EducationRecordDialogComponent } from '@app/components/dialogs/education-record-dialog/education-record-dialog.component';

interface UneducatedDate {
  date: string;
  shift: string; // early / noon / late / ''（凍結日期無班別）
  team: string;
  nurse: string;
}

interface EducationListItem {
  patientId: string;
  patientName: string;
  medicalRecordNumber: string;
  status: string;
  wardNumber: string;
  firstDialysisActive: boolean;
  firstDialysisDate: string;
  admissionDate: string;
  /** 主護（來源：使用者管理的護理師分配病人照護清單；null = 尚未分配） */
  primaryNurse: { nurseId: string; nurseName: string } | null;
  hasRecord: boolean;
  educatedCount: number;
  returnDemoCount: number;
  passedCount: number;
  total: number;
  /** 已紙本衛教（衛教以紙本進行，不列入電子未衛教判定） */
  paperEducation: boolean;
  /** 紙本衛教已完成（視為全數通過） */
  paperCompleted: boolean;
  /** 全數通過（回示教通過 12 次，或紙本已完成） */
  completed: boolean;
  /** 主護總查驗簽章（全數通過後由主護簽）；null = 尚未查驗 */
  finalReview: { name: string; date: string } | null;
  lastUpdated: string;
  expectedCount: number;
  uneducatedCount: number;
  uneducatedDates: UneducatedDate[];
}

const SHIFT_LABELS: Record<string, string> = {
  early: '早班',
  noon: '午班',
  late: '晚班',
};

/**
 * 後台「初透衛教進度」總覽。
 * 列出目前首透中或已有衛教進度的病人，顯示已衛教 / 回示教通過 進度，
 * 可直接點開現有的初透衛教紀錄視窗檢視或編輯。
 */
@Component({
  selector: 'app-education-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, EducationRecordDialogComponent],
  templateUrl: './education-dashboard.component.html',
  styleUrl: './education-dashboard.component.css',
})
export class EducationDashboardComponent implements OnInit {
  private readonly authService = inject(AuthService);

  readonly rows = signal<EducationListItem[]>([]);
  readonly loading = signal(true);
  readonly errorMsg = signal('');
  readonly search = signal('');
  readonly incompleteOnly = signal(false);

  readonly dialogPatient = signal<EducationListItem | null>(null);

  // 未衛教整合彈窗：null = 全部病人；有值 = 只看該病人
  readonly showUneducated = signal(false);
  readonly uneducatedFilterId = signal<string | null>(null);
  /** 未衛教整合頁籤：electronic = 電子紀錄未完成、paper = 紙本紀錄未完成 */
  readonly ueTab = signal<'electronic' | 'paper'>('electronic');

  readonly canEdit = computed(() => !this.authService.isViewer());

  /** 未衛教整合清單：有未衛教日的病人，未衛教天數多者在前 */
  readonly uneducatedPatients = computed(() => {
    const filterId = this.uneducatedFilterId();
    return this.rows()
      .filter((r) => r.uneducatedCount > 0 && (!filterId || r.patientId === filterId))
      .sort(
        (a, b) =>
          b.uneducatedCount - a.uneducatedCount ||
          String(a.patientName).localeCompare(b.patientName),
      );
  });

  readonly uneducatedTotal = computed(() =>
    this.rows().reduce((sum, r) => sum + (r.uneducatedCount || 0), 0),
  );

  /** 紙本未完成清單：已紙本衛教但尚未勾「紙本衛教已完成」的病人 */
  readonly paperPendingPatients = computed(() => {
    const filterId = this.uneducatedFilterId();
    return this.rows()
      .filter((r) => r.paperEducation && !r.paperCompleted && (!filterId || r.patientId === filterId))
      .sort((a, b) => String(a.patientName).localeCompare(b.patientName));
  });

  readonly paperPendingTotal = computed(
    () => this.rows().filter((r) => r.paperEducation && !r.paperCompleted).length,
  );

  readonly filteredRows = computed(() => {
    const term = this.search().trim().toLowerCase();
    const inc = this.incompleteOnly();
    const list = this.rows().filter((r) => {
      if (inc && r.completed) return false;
      if (!term) return true;
      return (
        (r.patientName || '').toLowerCase().includes(term) ||
        (r.medicalRecordNumber || '').toLowerCase().includes(term)
      );
    });
    // 依初透日「近→遠」（新到舊）排序，無初透日者排最後
    return [...list].sort((a, b) => {
      const da = a.firstDialysisDate || '';
      const db = b.firstDialysisDate || '';
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return db.localeCompare(da);
    });
  });

  readonly summary = computed(() => {
    const rows = this.rows();
    const total = rows.length;
    // 全數通過含「紙本衛教已完成」；紙本進行中歸在進行中（非尚未開始）
    const passed = rows.filter((r) => r.completed).length;
    const notStarted = rows.filter((r) => !r.completed && r.educatedCount === 0 && !r.paperEducation).length;
    return { total, passed, inProgress: total - passed - notStarted, notStarted };
  });

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.errorMsg.set('');
    try {
      const data: any = await localApi.get('/patients/education-list');
      this.rows.set(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('載入衛教進度失敗:', e);
      this.errorMsg.set('載入衛教進度清單失敗');
      this.rows.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  statusLabel(s: string): string {
    return s === 'ipd' ? '住院' : s === 'er' ? '急診' : '門診';
  }

  pct(count: number, total: number): number {
    if (!total) return 0;
    return Math.round((count / total) * 100);
  }

  formatDate(d: string): string {
    return d ? String(d).slice(0, 10) : '—';
  }

  openRecord(row: EducationListItem): void {
    this.dialogPatient.set(row);
  }

  async closeRecord(): Promise<void> {
    this.dialogPatient.set(null);
    await this.load();
  }

  shiftLabel(shift: string): string {
    return SHIFT_LABELS[shift] || '—';
  }

  nurseLabel(d: UneducatedDate): string {
    if (!d.nurse && !d.team) return '—';
    return d.team && d.nurse ? `${d.team} ${d.nurse}` : d.nurse || d.team;
  }

  /** 主護姓名（照護清單反查；未分配顯示 —） */
  primaryNurseLabel(r: EducationListItem): string {
    return r.primaryNurse?.nurseName || '—';
  }

  /** 開啟未衛教整合彈窗；帶 row 時只看該病人（紙本進行中的病人直接切到紙本頁籤） */
  openUneducated(row?: EducationListItem): void {
    this.uneducatedFilterId.set(row ? row.patientId : null);
    this.ueTab.set(row?.paperEducation && !row.paperCompleted ? 'paper' : 'electronic');
    this.showUneducated.set(true);
  }

  closeUneducated(): void {
    this.showUneducated.set(false);
    this.uneducatedFilterId.set(null);
  }

  /** 列印未衛教整合清單（依目前頁籤：電子/紙本；同衛教紀錄視窗的 window.open 列印模式） */
  printUneducated(): void {
    const today = new Date().toLocaleDateString('zh-TW');
    const esc = (s: string) =>
      String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    let title: string;
    let meta: string;
    let blocks: string;
    if (this.ueTab() === 'paper') {
      const patients = this.paperPendingPatients();
      title = '初透衛教 — 紙本紀錄未完成清單';
      meta = `列印日期：${today}｜共 ${patients.length} 位病人（已紙本衛教、尚未完成）`;
      const rows = patients
        .map(
          (p) => `<tr>
            <td>${esc(p.patientName)}</td>
            <td>${esc(p.medicalRecordNumber)}</td>
            <td>${esc(p.firstDialysisDate || '—')}</td>
            <td>${esc(this.primaryNurseLabel(p))}</td>
          </tr>`,
        )
        .join('');
      blocks = rows
        ? `<table>
            <thead><tr><th>病人</th><th>病歷號</th><th>初透日</th><th>主護</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>`
        : '<p>目前沒有紙本未完成的病人。</p>';
    } else {
      const patients = this.uneducatedPatients();
      title = '初透衛教 — 電子紀錄未完成清單';
      meta = `列印日期：${today}｜共 ${patients.length} 位病人（應衛教日已排除外圍床排程）`;
      blocks =
        patients
          .map((p) => {
            const rows = p.uneducatedDates
              .map(
                (d) => `<tr>
                  <td>${esc(d.date)}</td>
                  <td>${esc(this.shiftLabel(d.shift))}</td>
                  <td>${esc(this.nurseLabel(d))}</td>
                </tr>`,
              )
              .join('');
            return `<h3>${esc(p.patientName)}（${esc(p.medicalRecordNumber)}）
                — 未衛教 ${p.uneducatedCount} 天／應衛教 ${p.expectedCount} 天，初透日 ${esc(p.firstDialysisDate || '—')}，主護 ${esc(this.primaryNurseLabel(p))}</h3>
              <table>
                <thead><tr><th>日期</th><th>班別</th><th>當天照顧護理師</th></tr></thead>
                <tbody>${rows}</tbody>
              </table>`;
          })
          .join('') || '<p>目前沒有未衛教的日期。</p>';
    }

    const html = `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="utf-8">
      <title>${esc(title)}</title>
      <style>
        body { font-family: "Microsoft JhengHei", sans-serif; padding: 24px; color: #1e293b; }
        h2 { margin: 0 0 4px; } .meta { color: #64748b; font-size: 13px; margin-bottom: 16px; }
        h3 { font-size: 15px; margin: 18px 0 6px; }
        table { border-collapse: collapse; width: 100%; font-size: 13px; }
        th, td { border: 1px solid #94a3b8; padding: 6px 10px; text-align: left; }
        th { background: #f1f5f9; }
      </style></head><body>
      <h2>${esc(title)}</h2>
      <div class="meta">${meta}</div>
      ${blocks}
      </body></html>`;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
  }
}
