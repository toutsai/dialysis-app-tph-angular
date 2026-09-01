// 日期/月份/週次字串的上一個、下一個（給 <input type="month|date|week"> 旁的導航按鈕用）
// 全部以字串運算、不經 UTC，避免時區位移。

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 'YYYY-MM' ± delta 個月 */
export function shiftMonthString(ym: string, delta: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ym || '');
  const base = m ? new Date(Number(m[1]), Number(m[2]) - 1, 1) : new Date();
  base.setDate(1);
  base.setMonth(base.getMonth() + delta);
  return `${base.getFullYear()}-${pad2(base.getMonth() + 1)}`;
}

/** 'YYYY-MM-DD' ± delta 天 */
export function shiftDateString(ymd: string, delta: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
  const base = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date();
  base.setDate(base.getDate() + delta);
  return `${base.getFullYear()}-${pad2(base.getMonth() + 1)}-${pad2(base.getDate())}`;
}

/** ISO 週次 'YYYY-Www' 的週一（本地日期） */
function isoWeekMonday(year: number, week: number): Date {
  // ISO 8601：1 月 4 日所在的週為第 1 週
  const jan4 = new Date(year, 0, 4);
  const jan4Dow = jan4.getDay() || 7; // 週日=7
  const week1Monday = new Date(year, 0, 4 - (jan4Dow - 1));
  week1Monday.setDate(week1Monday.getDate() + (week - 1) * 7);
  return week1Monday;
}

/** 本地日期 → ISO 週次 'YYYY-Www' */
export function toISOWeekString(date: Date): string {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dow = d.getDay() || 7;
  d.setDate(d.getDate() + 4 - dow); // 移到該週的週四，決定 ISO 年
  const isoYear = d.getFullYear();
  const yearStart = new Date(isoYear, 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${isoYear}-W${pad2(week)}`;
}

/** 'YYYY-Www' ± delta 週 */
export function shiftWeekString(yw: string, delta: number): string {
  const m = /^(\d{4})-W(\d{2})$/.exec(yw || '');
  const monday = m ? isoWeekMonday(Number(m[1]), Number(m[2])) : new Date();
  monday.setDate(monday.getDate() + delta * 7);
  return toISOWeekString(monday);
}

export type DateStepKind = 'month' | 'date' | 'week';

/** 依 input 類型位移字串 */
export function shiftDateLike(value: string, delta: number, kind: DateStepKind): string {
  if (kind === 'month') return shiftMonthString(value, delta);
  if (kind === 'week') return shiftWeekString(value, delta);
  return shiftDateString(value, delta);
}
