export type Grouped = Record<string, Record<string, number>>;
export const STOCK_CATEGORIES = ['artificialKidney', 'dialysateCa', 'bicarbonateType'] as const;
export interface Coverage { complete: boolean; sourceFile?: string; uploadedAt?: string }
export interface ActualRange { key: string; start: string; end: string; grouped: Grouped; categoryCoverage?: Record<string, Coverage> }
export function localDay(d: Date): string { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
export function addLocalDays(day: string, delta: number): string { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate()+delta); return localDay(d); }
export function enumerateLocalDays(start: string, end: string): string[] { const days: string[]=[]; for(let d=start; d && d<=end && days.length<4000; d=addLocalDays(d,1)) days.push(d); return days; }
export function consumptionPlan(start: string,end: string,ranges: ActualRange[],category: string) {
  // Exact keys are replacements, never additional consumption. Backend aggregates patients first.
  const unique = [...new Map(ranges.map(r=>[r.key,r])).values()];
  const relevant = unique.filter(r=>r.start<=end && r.end>=start);
  const warnings: string[]=[];
  const accepted = relevant.filter(r=> {
    if (!r.categoryCoverage?.[category]?.complete) { warnings.push(`${category} ${r.start}–${r.end}：HIS 未完整核對，採排程推估`); return false; }
    if(r.start<start || r.end>end) { warnings.push(`${category} ${r.start}–${r.end}：跨查詢或盤點截止，不拆分區間`); return false; }
    if(unique.some(other=>other.key!==r.key && other.categoryCoverage?.[category]?.complete && other.start<=r.end && other.end>=r.start)) { warnings.push(`${category} ${r.start}–${r.end}：HIS 區間重疊，採排程推估`); return false; }
    return true;
  });
  const days=enumerateLocalDays(start,end);
  const forecastDays=days.filter(day=>!accepted.some(r=>r.start<=day && r.end>=day));
  return {accepted,forecastDays,warnings,actualDays:days.length-forecastDays.length,estimatedDays:forecastDays.length};
}
export function itemAnchor<T extends {countDate:string;counts:Grouped}>(docs:T[],category:string,item:string,asOf:string):T|null {
  return [...docs].filter(d=>d.countDate<=asOf && typeof d.counts?.[category]?.[item]==='number' && Number.isFinite(d.counts[category][item])).sort((a,b)=>b.countDate.localeCompare(a.countDate))[0]??null;
}
export function projectBalances(current:number|null,days:{date:string;need:number|null;arrivals:number;openingCount?:number;closingCount?:number;reconciledBalance?:number|null}[]) {
  let balance=current;
  return days.map(day => {
    if (day.openingCount !== undefined) balance = day.openingCount;
    balance = balance === null || day.need === null ? null : balance + day.arrivals - day.need;
    const intervalAdjustment = day.reconciledBalance !== undefined && day.reconciledBalance !== null && balance !== null
      ? day.reconciledBalance - balance : null;
    if (day.reconciledBalance !== undefined) balance = day.reconciledBalance;
    if (day.closingCount !== undefined) balance = day.closingCount;
    return { ...day, intervalAdjustment, projectedBalance: balance };
  });
}
export function anchorStart(doc:{countDate:string;cutoff?:string}):string { return doc.cutoff==='end-of-day' ? addLocalDays(doc.countDate,1) : doc.countDate; }
export function receiptQuantity(purchases:Record<string,unknown>[],category:string,item:string,start:string,end:string):number {
  return purchases.filter(p=>(p['status']==='arrived' || !p['status']) && p['category']===category && p['item']===item && String(p['date'] || '').slice(0,10)>=start && String(p['date'] || '').slice(0,10)<=end).reduce((sum,p)=>sum+(Number(p['quantity']) || 0),0);
}
