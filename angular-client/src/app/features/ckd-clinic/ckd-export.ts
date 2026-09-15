// 門診 CKD：匯出（原版 app.js csv()/exportDayEnrollXlsx/btnCsvA/B/C/E、wideSheets）
// 欄位標題、取值規則、檔名逐字照原版；日期民國 yyy/mm/dd、檔名 ISO；CSV 全欄雙引號＋BOM＋CRLF。
// 與原版差異：不做去識別遮蔽（本站有登入與 RBAC）；xlsx 以動態 import 載入（與週排班表匯出相同慣例）。
import type { CkdAuditRow, CkdRecTypeDef, CkdRecord, CkdRowA, CkdRowB } from '@app/core/services/ckd-api.service';

type Cell = string | number | null | undefined;

/** 'YYYY-MM-DD' → 'yyy/mm/dd'（原版 roc；空 → —） */
export function roc(s: string | null | undefined): string {
  if (!s) return '—';
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${String(+m[1] - 1911).padStart(3, '0')}/${m[2]}/${m[3]}` : String(s);
}

export const STL: Record<string, string> = { ok: '可申報追蹤', over: '逾期應追蹤', cap: '年度已達上限', wait: '未滿間隔', none: '資料不足' };
export const VTL: Record<string, string> = { pre: '符合Pre-ESRD', early: '符合Early-CKD', check: '待補檢驗', nodata: '無檢驗資料', no: '目前不符' };
const PROG_NAME: Record<string, string> = { pre: 'Pre-ESRD', early: 'Early-CKD' };

export function downloadCsv(rows: Cell[][], name: string): void {
  const body = rows.map((r) => r.map((c) => '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"').join(',')).join('\r\n');
  const blob = new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export interface XlsxSheet { name: string; rows: Cell[][]; cols?: number[]; autofilter?: boolean }

export async function downloadXlsx(sheets: XlsxSheet[], name: string): Promise<void> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows as any[][]);
    if (s.cols) ws['!cols'] = s.cols.map((wch) => ({ wch }));
    if (s.autofilter && s.rows.length) ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: s.rows[0].length - 1, r: s.rows.length - 1 } }) };
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  }
  XLSX.writeFile(wb, name);
}

const f1 = (n: number | null | undefined) => (n == null ? '' : n.toFixed(1));
const nz = (n: number | string | null | undefined) => (n == null ? '' : n);

/** A 區 CSV（btnCsvA） */
export function exportACsv(A: CkdRowA[], date: string): void {
  const head: Cell[][] = [['診號', '午別', '病歷號', '姓名', '年齡', 'DM', '方案', '追蹤醫令', 'eGFR', '分期', 'UPCR', '上次照護', '收案日', '間隔天數', '門檻', '今年次數', '近12月', '明日判定', '年度評估', '須開單缺項', '診間登錄缺項', '待檢驗單核對', '說明']];
  downloadCsv(head
    .concat(A.map((r): Cell[] => [r.p?.no ?? '', r.p?.half ?? '', r.mrn, r.name, nz(r.age), r.isDM ? 'Y' : '', PROG_NAME[r.prog] || r.prog, r.code ?? '',
      f1(r.egfr), r.stage || '', nz(r.upcr), roc(r.last?.visit), roc(r.last?.enroll),
      nz(r.gap), nz(r.need), r.nYear, r.n12, STL[r.status] ?? '', r.ann.ok ? r.ann.code ?? '' : '',
      (r.ord || []).join('、'), (r.bed || []).join('、'), (r.unk || []).join('、'),
      r.why.concat(r.alerts.map((a) => '[' + a.t + ']' + a.m)).join(';')])),
    `已收案_明日追蹤_${date}.csv`);
}

/** B 區 CSV（btnCsvB）：含不予收案與他院收案者（原版未排除） */
export function exportBCsv(B: CkdRowB[], date: string): void {
  const head: Cell[][] = [['診號', '午別', '病歷號', '姓名', '年齡', 'DM', 'eGFR', '分期', 'eGFR來源', 'UPCR', 'UACR', 'Cr', '檢驗日', '收案判定', '醫令', '個管提醒', '須開單缺項', '診間登錄缺項', '待核對', '說明']];
  downloadCsv(head
    .concat(B.map((r): Cell[] => [r.p.no, r.p.half, r.mrn, r.name, nz(r.age), r.p.pDM ? 'Y' : '',
      f1(r.egfr), r.stage || '', r.egfr != null ? r.from : '', nz(r.upcr), nz(r.uacr),
      r.lab && r.lab.v['cr'] != null ? r.lab.v['cr'] : '', r.lab?.date ? roc(r.lab.date) : '', VTL[r.verdict] ?? '', r.code || '',
      r.ext && r.ext.result === '已於他院收案' ? '已外院收案' + (r.ext.hospital ? '(' + r.ext.hospital + ')' : '')
        : r.ext && r.ext.result === '未於他院收案' ? '已查VPN無他院收案'
        : (r.verdict === 'pre' || r.verdict === 'early') ? '先查健保VPN他院收案' : '',
      (r.ord || []).join('、'), (r.bed || []).join('、'), (r.unk || []).join('、'), r.why.join(';')])),
    `未收案_收案評估_${date}.csv`);
}

/** 當日可收案名單 XLSX（exportDayEnrollXlsx）：B 區符合者，排除不予收案與他院收案；回傳列數（0 = 沒有可匯出） */
export async function exportDayEnrollXlsx(B: CkdRowB[], date: string): Promise<number> {
  const rows = B.filter((r) => (r.verdict === 'pre' || r.verdict === 'early') && !r.noEn && !(r.ext && r.ext.result === '已於他院收案'));
  if (!rows.length) return 0;
  const head = ['看診醫師', '看診日期', '診號', '病歷號', '病人姓名', '收案別', '本次收案階段(P碼)', 'eGFR', '分期', 'UPCR', 'UACR', '健保VPN查核', '備註'];
  const body = rows.map((r) => [r.p.doctor || '', roc(r.p.date || date), r.p.no || '', r.mrn, r.name,
    r.verdict === 'pre' ? 'Pre-ESRD' : 'Early-CKD', r.code || '',
    r.egfr != null ? Number(r.egfr.toFixed(1)) : '', r.stage || '',
    nz(r.upcr), nz(r.uacr),
    r.ext ? r.ext.result + (r.ext.at ? '(' + r.ext.at + ')' : '') : '尚未查核',
    (r.ord || []).length ? '須先開單:' + r.ord.join('、') : '']);
  await downloadXlsx([{ name: '可收案名單', rows: [head, ...body], cols: [10, 11, 6, 11, 11, 11, 18, 7, 8, 8, 8, 20, 24], autofilter: true }], `當日可收案名單_${date}.xlsx`);
  return rows.length;
}

/** 稽核 CSV（btnCsvC）：全部列，不吃畫面篩選／排序 */
export function exportAuditCsv(rows: CkdAuditRow[], date: string): void {
  const head: Cell[][] = [['病歷號', '姓名', '年齡', 'DM', '方案', '追蹤醫令', 'eGFR', '分期', 'UPCR', 'UACR', '上次照護', '收案日', '收案年資', '間隔天數', '門檻', '狀態', '今年次數', '近12月', '年度評估', 'eGFR年變化', '必要檢驗缺項', '待檢驗單核對', '對帳錨點', '漏帳次數', '入帳間隔異常', '提醒']];
  downloadCsv(head
    .concat(rows.map((r): Cell[] => [r.mrn, r.name, nz(r.age), r.isDM ? 'Y' : '', PROG_NAME[r.prog] || r.prog, r.code ?? '',
      f1(r.egfr), r.stage || '', nz(r.upcr), nz(r.uacr),
      roc(r.last?.visit), roc(r.last?.enroll), r.tenure != null ? (r.tenure / 365).toFixed(1) : '', nz(r.gap), nz(r.need),
      STL[r.status] ?? '', r.nYear, r.n12, r.ann.ok ? r.ann.code ?? '' : '', r.slope ? r.slope.v.toFixed(1) : '', r.miss.join('、'), r.unk.join('、'),
      r.recon ? (r.recon.anchor === 'bill' ? '入帳' : r.recon.anchor === 'unbilled' ? '登錄未入帳' : '') : '',
      r.recon && r.recon.misses.length ? r.recon.misses.length + '(' + r.recon.misses.slice(0, 3).map((m) => roc(m.visit)).join('、') + (r.recon.misses.length > 3 ? '…' : '') + ')' : '',
      r.recon && r.recon.shortBilled.length ? r.recon.shortBilled.map((x) => roc(x.at) + ' 距前次' + x.gap + '天(需' + x.need + ')').join('、') : '',
      r.alerts.map((a) => '[' + a.t + ']' + a.m).join(';')])),
    `全名單_收案稽核_${date}.csv`);
}

/** 個案紀錄 CSV（btnCsvE）：八類欄位聯集攤平，標題取第一個定義該欄位的類型 */
export function exportRecordsCsv(records: CkdRecord[], types: CkdRecTypeDef[], date: string): void {
  const keys: string[] = [];
  types.forEach((t) => t.fields.forEach((f) => { if (keys.indexOf(f.k) < 0) keys.push(f.k); }));
  const head = ['病歷號', '姓名', '類型'].concat(keys.map((k) => { for (const t of types) { const f = t.fields.find((x) => x.k === k); if (f) return f.t; } return k; })).concat(['建立時間', '最後修改']);
  const label = (type: string) => types.find((t) => t.key === type)?.label || type;
  const rows: Cell[][] = [head];
  downloadCsv(rows.concat(records.map((r): Cell[] => [r.mrn, r.name || '', label(r.type)]
    .concat(keys.map((k) => Array.isArray(r[k]) ? r[k].join('、') : (r[k] == null ? '' : r[k])))
    .concat([String(r.created || '').slice(0, 16).replace('T', ' '), String(r.updated || '').slice(0, 16).replace('T', ' ')]))),
    `個案紀錄_${date}.csv`);
}
