import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '@app/core/services/api.service';

// ---- API 回應型別（對應 src/services/vafseoStudyService.js 輸出） ----
interface StudyConfig {
  darbeRatio: number;
  baselineFrom: number;
  baselineTo: number;
  postFrom: number;
  postTo: number;
  offsetMin: number;
  offsetMax: number;
  excludedPatientIds: string[];
  notes: string;
}

interface MonthMetrics {
  hb: number | null;
  ca: number | null;
  p: number | null;
  ipth: number | null;
  esaEq: number | null;
  vafseoMgWk: number | null;
}

interface StudyPatient {
  patientId: string;
  name: string;
  mrn: string;
  indexDate: string;
  excluded: boolean;
  baselineHb: number | null;
  postHb: number | null;
  baselineEsaEq: number | null;
  postEsaEq: number | null;
  baselineIpth: number | null;
  postIpth: number | null;
  baselineCa: number | null;
  postCa: number | null;
  baselineP: number | null;
  postP: number | null;
  months: Record<string, MonthMetrics>;
}

interface EventTimePoint {
  offset: number;
  hb: { n: number; mean: number | null; sd: number | null };
  hbInRange115Pct: number | null;
  hbInRange12Pct: number | null;
  esaEq: { n: number; mean: number | null; sd: number | null };
  esaUserPct: number | null;
  vafseoMgWk: { n: number; mean: number | null };
  ca: { n: number; mean: number | null; sd: number | null };
  p: { n: number; mean: number | null; sd: number | null };
  ipth: { n: number; mean: number | null; sd: number | null };
}

interface PairedOutcome {
  n: number;
  baselineMean: number | null;
  baselineSd?: number | null;
  postMean: number | null;
  postSd?: number | null;
  meanDiff: number | null;
  ci95: [number, number] | null;
  tP: number | null;
  wilcoxonP: number | null;
}

interface StudyResponse {
  generatedAt: string | null;
  config: StudyConfig;
  warnings: { unparsedFreqRows: number };
  cohort: {
    total: number;
    included: number;
    excluded: number;
    startByMonth: { month: string; n: number }[];
  };
  eventTime: EventTimePoint[];
  outcomes: {
    hb?: PairedOutcome;
    esaEq?: PairedOutcome;
    esaDiscontinuation?: { baselineUsers: number; stopped: number; pct: number | null };
    ipth?: PairedOutcome;
    ca?: PairedOutcome;
    p?: PairedOutcome;
  };
  patients: StudyPatient[];
}

interface ChartDot {
  cx: number;
  cy: number;
  value: number;
  offset: number;
}

interface LineChart {
  W: number;
  H: number;
  series: { dots: ChartDot[]; polyline: string; color: string; label: string }[];
  xTicks: { x: number; label: string }[];
  yTicks: { y: number; label: string }[];
  zeroX: number | null;
  band: { y: number; h: number } | null;
}

const CHART_W = 680;
const CHART_H = 210;
const PAD_X = 46;
const PAD_Y = 22;

@Component({
  selector: 'app-research',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './research.component.html',
  styleUrls: ['./research.component.css'],
})
export class ResearchComponent implements OnInit {
  readonly data = signal<StudyResponse | null>(null);
  loading = false;
  saving = false;
  errorMessage = '';

  // 設定表單（ngModel 綁定，儲存時 PUT 回 config）
  cfgDarbeRatio = 200;
  cfgBaselineFrom = -3;
  cfgBaselineTo = -1;
  cfgPostFrom = 3;
  cfgPostTo = 6;
  cfgOffsetMin = -6;
  cfgOffsetMax = 12;
  cfgNotes = '';

  showExcluded = true;
  expandedPatientId: string | null = null;

  readonly outcomeRows = computed(() => {
    const d = this.data();
    if (!d) return [];
    const o = d.outcomes;
    const rows: { label: string; unit: string; oc: PairedOutcome | undefined }[] = [
      { label: 'Hb', unit: 'g/dL', oc: o.hb },
      { label: 'ESA 週劑量', unit: 'IU/wk (epoetin 當量)', oc: o.esaEq },
      { label: 'iPTH', unit: 'pg/mL', oc: o.ipth },
      { label: 'Ca', unit: 'mg/dL', oc: o.ca },
      { label: 'P', unit: 'mg/dL', oc: o.p },
    ];
    return rows.filter((r) => r.oc);
  });

  readonly visiblePatients = computed(() => {
    const d = this.data();
    if (!d) return [];
    const list = this.showExcludedSig() ? d.patients : d.patients.filter((p) => !p.excluded);
    return [...list].sort((a, b) => a.indexDate.localeCompare(b.indexDate));
  });
  // showExcluded 需要 signal 版本讓 computed 追蹤
  private readonly showExcludedSig = signal(true);

  readonly hbChart = computed<LineChart | null>(() =>
    this.buildChart(
      [{ key: 'hb', color: '#c62828', label: 'Hb 平均' }],
      (pt, key) => (key === 'hb' && pt.hb.n > 0 ? pt.hb.mean : null),
      { yMinHint: 9, yMaxHint: 12.5, band: [10, 12], decimals: 1 },
    ),
  );

  readonly esaChart = computed<LineChart | null>(() =>
    this.buildChart(
      [{ key: 'esaEq', color: '#1565c0', label: 'ESA 週劑量平均' }],
      (pt, key) => (key === 'esaEq' && pt.esaEq.n > 0 ? pt.esaEq.mean : null),
      { yMinHint: 0, decimals: 0 },
    ),
  );

  readonly pctChart = computed<LineChart | null>(() =>
    this.buildChart(
      [
        { key: 'esaUserPct', color: '#6a1b9a', label: 'ESA 使用率 %' },
        { key: 'hbInRange12Pct', color: '#2e7d32', label: 'Hb 10–12 達標率 %' },
      ],
      (pt, key) => (key === 'esaUserPct' ? pt.esaUserPct : pt.hbInRange12Pct),
      { yMinHint: 0, yMaxHint: 100, decimals: 0 },
    ),
  );

  readonly startByMonthChart = computed(() => {
    const d = this.data();
    if (!d || !d.cohort.startByMonth.length) return null;
    const items = d.cohort.startByMonth;
    const maxN = Math.max(...items.map((i) => i.n));
    return items.map((i) => ({
      month: i.month,
      n: i.n,
      pct: maxN > 0 ? Math.round((i.n / maxN) * 100) : 0,
    }));
  });

  constructor(private api: ApiService) {}

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    this.loading = true;
    this.errorMessage = '';
    try {
      const res = await firstValueFrom(this.api.get<StudyResponse>('/research/vafseo-study'));
      this.data.set(res);
      const c = res.config;
      this.cfgDarbeRatio = c.darbeRatio;
      this.cfgBaselineFrom = c.baselineFrom;
      this.cfgBaselineTo = c.baselineTo;
      this.cfgPostFrom = c.postFrom;
      this.cfgPostTo = c.postTo;
      this.cfgOffsetMin = c.offsetMin;
      this.cfgOffsetMax = c.offsetMax;
      this.cfgNotes = c.notes || '';
    } catch (err) {
      console.error('載入 Vafseo 研究分析失敗:', err);
      this.errorMessage = '載入分析失敗，請稍後重試';
    } finally {
      this.loading = false;
    }
  }

  async saveConfig(extra: Partial<StudyConfig> = {}): Promise<void> {
    this.saving = true;
    this.errorMessage = '';
    try {
      await firstValueFrom(
        this.api.put('/research/vafseo-study/config', {
          darbeRatio: Number(this.cfgDarbeRatio),
          baselineFrom: Number(this.cfgBaselineFrom),
          baselineTo: Number(this.cfgBaselineTo),
          postFrom: Number(this.cfgPostFrom),
          postTo: Number(this.cfgPostTo),
          offsetMin: Number(this.cfgOffsetMin),
          offsetMax: Number(this.cfgOffsetMax),
          notes: this.cfgNotes,
          ...extra,
        }),
      );
      await this.load();
    } catch (err: unknown) {
      console.error('儲存研究設定失敗:', err);
      const msg = (err as { error?: { message?: string } })?.error?.message;
      this.errorMessage = msg || '設定儲存失敗，請檢查參數';
    } finally {
      this.saving = false;
    }
  }

  async toggleExclude(p: StudyPatient): Promise<void> {
    const d = this.data();
    if (!d || this.saving) return;
    const current = new Set(d.config.excludedPatientIds || []);
    if (current.has(p.patientId)) current.delete(p.patientId);
    else current.add(p.patientId);
    await this.saveConfig({ excludedPatientIds: [...current] });
  }

  toggleShowExcluded(): void {
    this.showExcluded = !this.showExcluded;
    this.showExcludedSig.set(this.showExcluded);
  }

  // 展開時算一次存欄位，模板勿直接呼叫重算（CD 週期效能）
  expandedMonths: ({ offset: number } & MonthMetrics)[] = [];

  toggleExpand(p: StudyPatient): void {
    if (this.expandedPatientId === p.patientId) {
      this.expandedPatientId = null;
      this.expandedMonths = [];
      return;
    }
    this.expandedPatientId = p.patientId;
    this.expandedMonths = Object.entries(p.months)
      .map(([o, m]) => ({ offset: Number(o), ...m }))
      .sort((a, b) => a.offset - b.offset);
  }

  fmt(v: number | null | undefined, suffix = ''): string {
    return v === null || v === undefined ? '—' : `${v}${suffix}`;
  }

  fmtP(p: number | null | undefined): string {
    if (p === null || p === undefined) return '—';
    return p < 0.0001 ? '<0.0001' : String(p);
  }

  fmtCi(ci: [number, number] | null | undefined): string {
    return ci ? `${ci[0]} ~ ${ci[1]}` : '—';
  }

  // ---- SVG 折線圖組裝（照 aki-map 手刻 SVG 模式，不用 chart.js 省 canvas 生命週期） ----
  private buildChart(
    seriesDefs: { key: string; color: string; label: string }[],
    valueOf: (pt: EventTimePoint, key: string) => number | null,
    opts: { yMinHint?: number; yMaxHint?: number; band?: [number, number]; decimals?: number },
  ): LineChart | null {
    const d = this.data();
    if (!d || !d.eventTime.length) return null;

    const allValues: number[] = [];
    const perSeries = seriesDefs.map((s) => {
      const pts = d.eventTime
        .map((pt) => ({ offset: pt.offset, value: valueOf(pt, s.key) }))
        .filter((x): x is { offset: number; value: number } => x.value !== null && x.value !== undefined);
      pts.forEach((x) => allValues.push(x.value));
      return { def: s, pts };
    });
    if (!allValues.length) return null;

    const offsets = d.eventTime.map((pt) => pt.offset);
    const minO = Math.min(...offsets);
    const maxO = Math.max(...offsets);
    let minV = Math.min(...allValues);
    let maxV = Math.max(...allValues);
    if (opts.yMinHint !== undefined) minV = Math.min(minV, opts.yMinHint);
    if (opts.yMaxHint !== undefined) maxV = Math.max(maxV, opts.yMaxHint);
    const span = maxV - minV || 1;

    const x = (o: number) =>
      maxO === minO ? CHART_W / 2 : PAD_X + ((o - minO) * (CHART_W - PAD_X - 14)) / (maxO - minO);
    const y = (v: number) => CHART_H - PAD_Y - ((v - minV) / span) * (CHART_H - PAD_Y * 2);

    const series = perSeries.map(({ def, pts }) => {
      const dots = pts.map((p) => ({ cx: x(p.offset), cy: y(p.value), value: p.value, offset: p.offset }));
      return {
        dots,
        polyline: dots.map((dt) => `${dt.cx.toFixed(1)},${dt.cy.toFixed(1)}`).join(' '),
        color: def.color,
        label: def.label,
      };
    });

    const xTicks: { x: number; label: string }[] = [];
    for (let o = minO; o <= maxO; o++) {
      if ((maxO - minO) > 12 && o % 2 !== 0) continue;
      xTicks.push({ x: x(o), label: o > 0 ? `+${o}` : String(o) });
    }
    const dec = opts.decimals ?? 1;
    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => {
      const v = minV + span * f;
      return { y: y(v), label: v.toFixed(dec) };
    });

    return {
      W: CHART_W,
      H: CHART_H,
      series,
      xTicks,
      yTicks,
      zeroX: minO <= 0 && maxO >= 0 ? x(0) : null,
      band: opts.band ? { y: y(opts.band[1]), h: Math.abs(y(opts.band[0]) - y(opts.band[1])) } : null,
    };
  }
}
