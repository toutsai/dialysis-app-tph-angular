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

// ---- 月趨勢 API 型別（/research/monthly-trends） ----
interface TrendDrugPoint { month: string; users: number; meanWeekly: number | null }
interface TrendLabPoint { month: string; n: number; mean: number | null }
interface TrendDrug { key: string; label: string; unit: string; points: TrendDrugPoint[] }
interface TrendLab { key: string; label: string; unit: string; quarterly?: boolean; points: TrendLabPoint[] }
interface TrendBlockData { key: string; title: string; drugs: TrendDrug[]; labs: TrendLab[] }
interface TrendsResponse { generatedAt: string | null; months: string[]; blocks: TrendBlockData[] }

// ---- 本院快照 API 型別（/research/unit-snapshot） ----
interface UnitSnapshot {
  date: string;
  drugs: { esa: number; vafseo: number; both: number; iron: number; parsabiv: number; cacare: number; uca: number };
  labs: {
    hbN: number; hbMean: number | null; hbInRange: number | null; hbOver12: number | null; hbUnder9: number | null;
    caMean: number | null; caOver102: number | null; pMean: number | null; pOver55: number | null;
    ipthN: number; ipthMedian: number | null; ipthOver585: number | null; ipthOver800: number | null; ipthUnder130: number | null;
    ferritinN: number; ferritinMedian: number | null; ferritinUnder200: number | null; ferritinOver700: number | null;
    tsatN: number; tsatMedian: number | null; tsatUnder20: number | null; tsatOver40: number | null;
  };
}

// ---- 圖表模型 ----
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

interface MiniChart {
  W: number;
  H: number;
  color: string;
  bars: { x: number; y: number; w: number; h: number; count: number; month: string }[];
  dots: { cx: number; cy: number; value: number; month: string }[];
  polyline: string;
  xTicks: { x: number; label: string }[];
  yTicks: { y: number; label: string }[];
  maxBar: number;
}

interface TrendChartCard { label: string; unit: string; quarterly?: boolean; chart: MiniChart | null }
interface TrendBlockView { key: string; title: string; drugCharts: TrendChartCard[]; labCharts: TrendChartCard[] }

const CHART_W = 680;
const CHART_H = 210;
const PAD_X = 46;
const PAD_Y = 22;

const MINI_W = 460;
const MINI_H = 180;

type BlockTab = 'anemia' | 'mineral' | 'vafseo' | 'evidence';

@Component({
  selector: 'app-research',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './research.component.html',
  styleUrls: ['./research.component.css'],
})
export class ResearchComponent implements OnInit {
  readonly data = signal<StudyResponse | null>(null);
  readonly trends = signal<TrendsResponse | null>(null);
  readonly snapshot = signal<UnitSnapshot | null>(null);
  activeBlock: BlockTab = 'anemia';
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
  // 展開時算一次存欄位，模板勿直接呼叫重算（CD 週期效能）
  expandedMonths: ({ offset: number } & MonthMetrics)[] = [];

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

  // ---- 月趨勢圖（兩大區塊，小倍數圖：淡色柱=人數/筆數、實線=平均） ----
  readonly trendBlocks = computed<TrendBlockView[]>(() => {
    const t = this.trends();
    if (!t) return [];
    return t.blocks.map((b) => ({
      key: b.key,
      title: b.title,
      drugCharts: b.drugs.map((d) => ({
        label: d.label,
        unit: d.unit,
        chart: this.buildMiniChart(
          d.points.map((p) => ({ month: p.month, value: p.meanWeekly, count: p.users })),
          '#1565c0',
        ),
      })),
      labCharts: b.labs.map((l) => ({
        label: l.label,
        unit: l.unit,
        quarterly: l.quarterly,
        chart: this.buildMiniChart(
          l.points.map((p) => ({ month: p.month, value: p.mean, count: p.n })),
          '#c62828',
          l.quarterly,
        ),
      })),
    }));
  });

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

  setBlock(tab: BlockTab): void {
    this.activeBlock = tab;
  }

  async load(): Promise<void> {
    this.loading = true;
    this.errorMessage = '';
    try {
      const [study, trends, snapshot] = await Promise.all([
        firstValueFrom(this.api.get<StudyResponse>('/research/vafseo-study')),
        firstValueFrom(this.api.get<TrendsResponse>('/research/monthly-trends')),
        firstValueFrom(this.api.get<UnitSnapshot>('/research/unit-snapshot')),
      ]);
      this.data.set(study);
      this.trends.set(trends);
      this.snapshot.set(snapshot);
      const c = study.config;
      this.cfgDarbeRatio = c.darbeRatio;
      this.cfgBaselineFrom = c.baselineFrom;
      this.cfgBaselineTo = c.baselineTo;
      this.cfgPostFrom = c.postFrom;
      this.cfgPostTo = c.postTo;
      this.cfgOffsetMin = c.offsetMin;
      this.cfgOffsetMax = c.offsetMax;
      this.cfgNotes = c.notes || '';
    } catch (err) {
      console.error('載入研究分析失敗:', err);
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

  // ---- 月趨勢小圖組裝（淡色柱=人數/筆數自成比例，實線=平均值） ----
  private buildMiniChart(
    points: { month: string; value: number | null; count: number }[],
    color: string,
    quarterlyOnly = false,
  ): MiniChart | null {
    // 季抽項目（Ferritin/TSAT/iPTH，抽 3/6/9/12 月）x 軸只留季月，空月不佔位
    if (quarterlyOnly) {
      points = points.filter((p) => [3, 6, 9, 12].includes(Number(p.month.slice(5, 7))));
    }
    const withValue = points.filter((p) => p.value !== null);
    if (!withValue.length) return null;
    const n = points.length;
    const padL = 46;
    const padR = 8;
    const padT = 12;
    const padB = 18;
    const plotW = MINI_W - padL - padR;
    const plotH = MINI_H - padT - padB;
    const step = plotW / n;
    const xAt = (i: number) => padL + step * (i + 0.5);

    const values = withValue.map((p) => p.value as number);
    let minV = Math.min(...values);
    let maxV = Math.max(...values);
    if (minV === maxV) { minV -= 1; maxV += 1; }
    const span = maxV - minV;
    // 上下各留 8% 邊距避免點貼邊
    const yAt = (v: number) => padT + plotH - ((v - minV) / span) * plotH * 0.84 - plotH * 0.08;

    const maxBar = Math.max(...points.map((p) => p.count), 1);
    const bars = points
      .filter((p) => p.count > 0)
      .map((p) => {
        const i = points.indexOf(p);
        const h = (p.count / maxBar) * plotH;
        return { x: padL + step * i + step * 0.22, y: padT + plotH - h, w: step * 0.56, h, count: p.count, month: p.month };
      });

    const dots = points
      .map((p, i) => (p.value === null ? null : { cx: xAt(i), cy: yAt(p.value), value: p.value, month: p.month }))
      .filter((d): d is { cx: number; cy: number; value: number; month: string } => d !== null);

    const every = Math.max(1, Math.ceil(n / 8));
    const xTicks = points
      .map((p, i) => ({ i, p }))
      .filter(({ i }) => i % every === 0)
      .map(({ i, p }) => ({ x: xAt(i), label: p.month.slice(2) }));
    const fmtTick = (v: number) => (Math.abs(v) >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10));
    const yTicks = [0, 0.5, 1].map((f) => {
      const v = minV + span * f;
      return { y: yAt(v), label: fmtTick(v) };
    });

    return {
      W: MINI_W,
      H: MINI_H,
      color,
      bars,
      dots,
      polyline: dots.map((d) => `${d.cx.toFixed(1)},${d.cy.toFixed(1)}`).join(' '),
      xTicks,
      yTicks,
      maxBar,
    };
  }

  // ---- 事件時間折線圖組裝（照 aki-map 手刻 SVG 模式，不用 chart.js 省 canvas 生命週期） ----
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
