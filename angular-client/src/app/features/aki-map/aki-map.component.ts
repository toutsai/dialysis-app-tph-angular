import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  AkiApiService,
  AkiCategory,
  AkiMapResponse,
  AkiPatient,
  AkiPatientDetail,
} from '@app/core/services/aki-api.service';

interface CategoryDef {
  key: AkiCategory;
  label: string;
  color: string;
}

// 分期顯示順序、標籤、色碼（與後端 AKI_CATEGORIES 對齊）
const CATEGORY_DEFS: CategoryDef[] = [
  { key: 'stage-3', label: 'Stage 3', color: '#d32f2f' },
  { key: 'stage-2', label: 'Stage 2', color: '#f57c00' },
  { key: 'stage-1', label: 'Stage 1', color: '#f9a825' },
  { key: 'esrd', label: '疑似 ESRD', color: '#7b1fa2' },
  { key: 'stage-0', label: '無 AKI', color: '#388e3c' },
  { key: 'single', label: '單筆無法判定', color: '#607d8b' },
  { key: 'no-data', label: '無 Cr 資料', color: '#b0bec5' },
];

interface WardGroup {
  ward: string;
  patients: AkiPatient[];
  counts: Partial<Record<AkiCategory, number>>;
}

// 護理站顯示規則（依院方要求）：
//   1) 第一/二/三加護病房最前  2) 5–7 樓 A–D 護理站  3) 其他(如 9A 急性精神科)  4) GC 最後
//   隱藏：單托嬰、嬰兒病床
function wardCode(ward: string): string {
  const i = ward.indexOf('_');
  return i >= 0 ? ward.slice(0, i) : ward;
}
function isHiddenWard(ward: string): boolean {
  const code = wardCode(ward);
  return code === 'DBBB' || code === 'DBBP' || ward.includes('單托嬰') || ward.includes('嬰兒病床');
}
function wardSortKey(ward: string): [number, number, number] {
  const code = wardCode(ward);
  const icu = code.match(/^DBI(\d)/); // 加護病房 DBI1/2/3
  if (icu) return [0, Number(icu[1]), 0];
  if (code.startsWith('GC')) return [3, 0, 0]; // 戒護病房最後
  const ns = code.match(/^D(\d)([A-Z])/); // 一般護理站 D<樓><區>
  if (ns) return [1, Number(ns[1]), ns[2].charCodeAt(0)];
  return [2, 0, 0];
}
function compareWard(a: string, b: string): number {
  const ka = wardSortKey(a);
  const kb = wardSortKey(b);
  return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2] || a.localeCompare(b);
}

@Component({
  selector: 'app-aki-map',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './aki-map.component.html',
  styleUrl: './aki-map.component.css',
})
export class AkiMapComponent implements OnInit {
  private readonly akiApi = inject(AkiApiService);

  readonly categoryDefs = CATEGORY_DEFS;

  readonly loading = signal(false);
  readonly message = signal<{ type: 'info' | 'error'; text: string } | null>(null);
  readonly data = signal<AkiMapResponse | null>(null);

  readonly selectedDate = signal<string>('');
  readonly filterCategory = signal<AkiCategory | 'all' | 'aki'>('all');
  readonly search = signal<string>('');

  readonly uploadingInpatients = signal(false);
  readonly uploadingLabs = signal(false);

  // 詳情面板
  readonly detail = signal<AkiPatientDetail | null>(null);
  readonly detailLoading = signal(false);

  private readonly colorMap = new Map(CATEGORY_DEFS.map((d) => [d.key, d]));

  // 隱藏病房(單托嬰/嬰兒病床)後的病人清單 —— 摘要與地圖皆以此為準，計數才一致
  readonly visiblePatients = computed(() =>
    (this.data()?.patients || []).filter((p) => !isHiddenWard(p.ward)),
  );

  // 摘要（含 0 的分類也顯示，方便一眼看全）
  readonly summaryRow = computed(() => {
    const counts: Partial<Record<AkiCategory, number>> = {};
    for (const p of this.visiblePatients()) {
      counts[p.category] = (counts[p.category] || 0) + 1;
    }
    return CATEGORY_DEFS.map((def) => ({
      ...def,
      count: counts[def.key] || 0,
    }));
  });

  readonly totalPatients = computed(() => this.visiblePatients().length);

  // 篩選後依護理站分組
  readonly wardGroups = computed<WardGroup[]>(() => {
    const cat = this.filterCategory();
    const q = this.search().trim().toLowerCase();
    const groups = new Map<string, WardGroup>();

    for (const p of this.visiblePatients()) {
      if (cat === 'aki') {
        if (!(p.stage != null && p.stage >= 1)) continue;
      } else if (cat !== 'all' && p.category !== cat) {
        continue;
      }
      if (q) {
        const hay = `${p.name} ${p.mrn} ${p.bed} ${p.physician} ${p.dept}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      let g = groups.get(p.ward);
      if (!g) {
        g = { ward: p.ward, patients: [], counts: {} };
        groups.set(p.ward, g);
      }
      g.patients.push(p);
      g.counts[p.category] = (g.counts[p.category] || 0) + 1;
    }

    const arr = [...groups.values()];
    // 卡片內依床號順序排列（numeric-aware：5A02 在 5A10 之前）
    for (const g of arr) {
      g.patients.sort((a, b) =>
        (a.bed || '').localeCompare(b.bed || '', undefined, { numeric: true, sensitivity: 'base' }),
      );
    }
    // 護理站固定順序：加護 → 5–7樓A–D → 其他 → GC
    arr.sort((a, b) => compareWard(a.ward, b.ward));
    return arr;
  });

  readonly watchList = computed(() => this.data()?.watchList || []);

  ngOnInit(): void {
    this.load();
  }

  color(cat: AkiCategory): string {
    return this.colorMap.get(cat)?.color || '#b0bec5';
  }

  label(cat: AkiCategory): string {
    return this.colorMap.get(cat)?.label || cat;
  }

  wardLabel(ward: string): string {
    // "D5A_5A護理站" → "5A護理站"
    const idx = ward.indexOf('_');
    return idx >= 0 ? ward.slice(idx + 1) : ward;
  }

  async load(date?: string): Promise<void> {
    this.loading.set(true);
    this.message.set(null);
    try {
      const res = await this.akiApi.getMap(date || this.selectedDate() || undefined);
      this.data.set(res);
      if (res.snapshotDate && !this.selectedDate()) this.selectedDate.set(res.snapshotDate);
    } catch (e: any) {
      this.message.set({ type: 'error', text: e?.error?.message || e?.message || '載入失敗' });
    } finally {
      this.loading.set(false);
    }
  }

  onDateChange(date: string): void {
    this.selectedDate.set(date);
    this.load(date);
  }

  setFilter(cat: AkiCategory | 'all' | 'aki'): void {
    this.filterCategory.set(cat);
  }

  private fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        const comma = result.indexOf(',');
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  async onPickInpatients(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.uploadingInpatients.set(true);
    this.message.set(null);
    try {
      const b64 = await this.fileToBase64(file);
      const res = await this.akiApi.uploadInpatients(file.name, b64);
      this.message.set({ type: 'info', text: `留院清單匯入成功：${res.patients} 位病人（快照 ${res.snapshotDate}）` });
      this.selectedDate.set(res.snapshotDate);
      await this.load(res.snapshotDate);
    } catch (e: any) {
      this.message.set({ type: 'error', text: e?.error?.message || e?.message || '匯入失敗' });
    } finally {
      this.uploadingInpatients.set(false);
      input.value = '';
    }
  }

  async onPickLabs(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.uploadingLabs.set(true);
    this.message.set(null);
    try {
      const b64 = await this.fileToBase64(file);
      const res = await this.akiApi.uploadLabs(file.name, b64);
      this.message.set({
        type: 'info',
        text: `CKD-AKI 明細匯入成功：新增 ${res.imported} 筆（共 ${res.total} 筆，${res.range.start}~${res.range.end}）`,
      });
      await this.load();
    } catch (e: any) {
      this.message.set({ type: 'error', text: e?.error?.message || e?.message || '匯入失敗' });
    } finally {
      this.uploadingLabs.set(false);
      input.value = '';
    }
  }

  async openDetail(mrn: string): Promise<void> {
    this.detailLoading.set(true);
    this.detail.set(null);
    try {
      const res = await this.akiApi.getPatient(mrn);
      this.detail.set(res);
    } catch (e: any) {
      this.message.set({ type: 'error', text: e?.error?.message || e?.message || '載入病人明細失敗' });
    } finally {
      this.detailLoading.set(false);
    }
  }

  closeDetail(): void {
    this.detail.set(null);
  }

  sourceLabel(src: string): string {
    return src === 'OPD' ? '門診' : src === 'ER' ? '急診' : src === 'IPD' ? '住院' : src;
  }

  // 詳情頁 Cr 趨勢折線圖的座標點
  readonly trendChart = computed(() => {
    const d = this.detail();
    const pts = d?.staging.points || [];
    if (pts.length === 0) return null;
    const W = 520, H = 160, padX = 44, padY = 20;
    const values = pts.map((p) => p.value);
    const minV = Math.min(...values);
    const maxV = Math.max(...values);
    const span = maxV - minV || 1;
    const n = pts.length;
    const x = (i: number) => (n === 1 ? W / 2 : padX + (i * (W - padX - 12)) / (n - 1));
    const y = (v: number) => H - padY - ((v - minV) / span) * (H - padY * 2);
    const dots = pts.map((p, i) => ({
      cx: x(i), cy: y(p.value), value: p.value, date: p.date, source: p.source,
      color: p.source === 'OPD' ? '#1976d2' : p.source === 'ER' ? '#7b1fa2' : '#d32f2f',
    }));
    const polyline = dots.map((dt) => `${dt.cx.toFixed(1)},${dt.cy.toFixed(1)}`).join(' ');
    return { W, H, dots, polyline, minV, maxV };
  });
}
