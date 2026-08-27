// 書記專用 > Gentamycin 開立清單
// 來源：透析醫囑的血管通路（patient.dialysisOrders.vascAccess）為 Perm 或 D/L 的未刪除病人。
// 依 頻率 → 班別 → 床號 排序；班別/床號取自床位總表 rule，無總表 rule 者排最後（班別/床號空白）。
import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PatientStoreService } from '@services/patient-store.service';
import { ORDERED_SHIFT_CODES, getShiftDisplayName } from '@/constants/scheduleConstants';

const FREQ_ORDER: Record<string, number> = {
  '每日': 0, '一三五': 1, '二四六': 2, '一四': 3, '二五': 4, '三六': 5, '一五': 6, '二六': 7,
  '每周一': 8, '每周二': 9, '每周三': 10, '每周四': 11, '每周五': 12, '每周六': 13,
};
const STATUS_LABELS: Record<string, string> = { opd: '門診', ipd: '住院', er: '急診' };

/** Perm-cath / Double lumen 的寬鬆辨識（醫囑選單值為 'Perm' / 'D/L'，舊資料可能有其他寫法） */
export function isPermOrDualLumen(vascAccess: unknown): boolean {
  const v = String(vascAccess ?? '').trim().toLowerCase();
  if (!v) return false;
  return /^perm/.test(v) || v === 'd/l' || v === 'dl' || /^double/.test(v);
}

interface GentaRow {
  patientId: string;
  name: string;
  medicalRecordNumber: string;
  freq: string;
  freqOrder: number;
  shiftIndex: number;
  shiftLabel: string;
  bedLabel: string;
  bedSortKey: number;
  vascAccess: string;
  status: string;
  statusBadge: string;
}

@Component({
  selector: 'app-clerk-gentamycin-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './clerk-gentamycin-list.component.html',
  styleUrl: './clerk-gentamycin-list.component.css',
})
export class ClerkGentamycinListComponent implements OnInit {
  protected readonly patientStore = inject(PatientStoreService);

  readonly searchTerm = signal('');
  /** 只列門診（預設）；關閉則含住院/急診 */
  readonly opdOnly = signal(true);

  readonly rows = computed<GentaRow[]>(() => {
    const pMap = this.patientStore.patientMap();
    const rules = this.patientStore.masterScheduleRules() as Record<string, any>;
    const out: GentaRow[] = [];
    for (const [patientId, p] of pMap.entries()) {
      const patient = p as any;
      if (!patient || patient.isDeleted) continue;
      const vascAccess = String(patient.dialysisOrders?.vascAccess ?? '').trim();
      // 未輸入血管通路者也列出（提醒補登），以便確認是否為 Perm/D/L
      if (vascAccess && !isPermOrDualLumen(vascAccess)) continue;
      const status = String(patient.status || '');
      if (this.opdOnly() && status !== 'opd') continue;
      const rule = rules[patientId];
      // 頻率認定與病人清單一致：patient.freq（總表 rule freq 優先，缺時退回頂層）
      const freq = String(patient.freq || rule?.freq || '');
      const shiftIndex = Number(rule?.shiftIndex);
      const hasShift = Number.isInteger(shiftIndex) && !!ORDERED_SHIFT_CODES[shiftIndex];
      const bed = rule ? this.parseBed(rule.bedNum) : { label: '', sortKey: 9999 };
      const ward = String(patient.wardNumber || '');
      out.push({
        patientId,
        name: patient.name || '',
        medicalRecordNumber: patient.medicalRecordNumber || '',
        freq,
        freqOrder: freq in FREQ_ORDER ? FREQ_ORDER[freq] : 99,
        shiftIndex: hasShift ? shiftIndex : 99,
        shiftLabel: hasShift ? getShiftDisplayName(ORDERED_SHIFT_CODES[shiftIndex]) : '',
        bedLabel: bed.label,
        bedSortKey: bed.sortKey,
        vascAccess,
        status,
        statusBadge: status === 'ipd' || status === 'er' ? `${STATUS_LABELS[status]}${ward ? `(${ward})` : ''}` : '',
      });
    }
    out.sort((a, b) =>
      a.freqOrder - b.freqOrder ||
      a.shiftIndex - b.shiftIndex ||
      a.bedSortKey - b.bedSortKey ||
      a.medicalRecordNumber.localeCompare(b.medicalRecordNumber));
    return out;
  });

  readonly filteredRows = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    if (!term) return this.rows();
    return this.rows().filter((r) =>
      r.name.toLowerCase().includes(term) ||
      r.medicalRecordNumber.toLowerCase().includes(term) ||
      r.bedLabel.toLowerCase().includes(term));
  });

  readonly permCount = computed(() => this.rows().filter((r) => /^perm/i.test(r.vascAccess)).length);
  readonly missingCount = computed(() => this.rows().filter((r) => !r.vascAccess).length);
  readonly dlCount = computed(() => this.rows().length - this.permCount() - this.missingCount());

  ngOnInit(): void {
    this.patientStore.fetchPatientsIfNeeded().catch((error) => {
      console.error('載入病人/總表資料失敗:', error);
    });
  }

  /** 列印（隱藏 iframe，與針劑發放名單同款） */
  print(): void {
    const rows = this.filteredRows();
    if (rows.length === 0) return;
    const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
    const today = new Date();
    const dateStr = `${today.getFullYear()}/${today.getMonth() + 1}/${today.getDate()}`;
    const body = rows.map((r) => `
      <tr>
        <td>${esc(r.freq)}</td><td>${esc(r.shiftLabel)}</td><td>${esc(r.bedLabel)}</td>
        <td>${esc(r.medicalRecordNumber)}</td><td>${esc(r.name)}${r.statusBadge ? ` <small>(${esc(r.statusBadge)})</small>` : ''}</td>
        <td>${r.vascAccess ? esc(r.vascAccess) : '未輸入'}</td><td class="chk"></td>
      </tr>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Gentamycin 開立清單</title>
      <style>
        @page { size: A4 portrait; margin: 1.2cm; }
        body { font-family: "Microsoft JhengHei", Arial, sans-serif; font-size: 12pt; color: #000; }
        h2 { margin: 0 0 4px; font-size: 15pt; }
        .meta { font-size: 10pt; color: #444; margin-bottom: 8px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #000; padding: 4px 6px; text-align: left; }
        th { background: #eee; }
        td.chk { width: 3.5em; }
        small { color: #555; }
      </style></head><body>
      <h2>Gentamycin 開立清單（血管通路 Perm / D/L）</h2>
      <div class="meta">列印日期 ${dateStr}｜共 ${rows.length} 人${this.opdOnly() ? '（僅門診）' : '（含住院/急診）'}</div>
      <table><thead><tr><th>頻率</th><th>班別</th><th>床號</th><th>病歷號</th><th>姓名</th><th>血管通路</th><th>已開</th></tr></thead>
      <tbody>${body}</tbody></table></body></html>`;
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow?.document;
    if (!doc) { document.body.removeChild(iframe); return; }
    doc.open();
    doc.write(html);
    doc.close();
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => { if (iframe.parentNode) document.body.removeChild(iframe); }, 500);
  }

  private parseBed(bedNum: unknown): { label: string; sortKey: number } {
    if (typeof bedNum === 'number' && !isNaN(bedNum)) return { label: String(bedNum), sortKey: bedNum };
    const str = String(bedNum ?? '');
    const peripheralMatch = str.match(/^peripheral-?(\d+)$/);
    if (peripheralMatch) {
      const n = Number(peripheralMatch[1]);
      return { label: `外${n}`, sortKey: 1000 + n };
    }
    const asNumber = Number(str);
    if (str && !isNaN(asNumber)) return { label: str, sortKey: asNumber };
    return { label: str || '', sortKey: 9999 };
  }
}
