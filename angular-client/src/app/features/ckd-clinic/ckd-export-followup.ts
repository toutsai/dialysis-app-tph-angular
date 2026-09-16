// 門診 CKD 階段 5 匯出：召回工作清單／近日異常檢驗／透析準備管線／一位病人的累積報告
// 標題列、取值規則、檔名逐字照原版（spec-stage5 §1.6／§2.6／§3.6）；
// CSV 格式沿用 ckd-export 的 downloadCsv（BOM ＋ CRLF ＋ 全欄雙引號），否則 Excel 中文會亂碼。
import type {
  CkdAlertRow,
  CkdPatientLabs,
  CkdRecallBucket,
  CkdRecallRow,
  CkdRrtRow,
  CkdRrtStation,
} from '@app/core/services/ckd-api.service';
import { downloadCsv, roc } from './ckd-export';

type Cell = string | number | null | undefined;

const progName = (p: string) => (p === 'pre' ? 'Pre-ESRD' : 'Early-CKD');
const str = (v: unknown) => (v == null ? '' : String(v));

/** 桶中文（原版 recall.js:53） */
export const RECALL_BUCKET_TW: Record<CkdRecallBucket, string> = {
  call: '待聯絡', grace: '剛到期', appt: '已預約', hold: '暫緩/暫停', close: '應結案',
};

/**
 * 召回工作清單 CSV（原版 btnCsvR）
 * ⚠ 範圍＝目前篩選的桶；filter 傳 'all' 才是全部（原版 recall.js:48）。
 */
export function exportRecallCsv(rows: CkdRecallRow[], filter: CkdRecallBucket | 'all', date: string): void {
  const list = filter === 'all' ? rows : rows.filter((r) => r.bucket === filter);
  const head: Cell[][] = [['病歷號', '姓名', '方案', '分期', '上次照護', '逾期天數', '分類', '未來掛號', '上次聯絡日', '聯絡結果', '約定回診', '暫緩至', '備註']];
  downloadCsv(head.concat(list.map((r): Cell[] => [
    r.mrn, r.name, progName(r.prog), r.stage || '', r.lastVisit || '', r.gap == null ? '' : r.gap,
    RECALL_BUCKET_TW[r.bucket] || '',
    r.appt ? `${r.appt.date} ${r.appt.dept} ${r.appt.doctor}` : '',
    str(r.ct?.['at']), str(r.ct?.['result']), str(r.ct?.['apptDate']), str(r.ct?.['until']), str(r.ct?.['note']),
  ])), `召回工作清單_${date}.csv`);
}

/** 近日異常檢驗 CSV（原版 btnCsvL）：全部，不吃畫面篩選 */
export function exportAlertsCsv(rows: CkdAlertRow[], date: string): void {
  const head: Cell[][] = [['病歷號', '姓名', '嚴重度', '異常', '報告日', '說明', '方案', '收案醫師', '上次照護', '已處理']];
  downloadCsv(head.concat(rows.map((a): Cell[] => [
    a.mrn, a.name, a.sev === 'crit' ? '危急' : '警示', a.t, a.date, a.m,
    a.aud ? progName(a.aud.prog) : '', a.aud?.caseDoctor || '', a.aud?.lastVisit || '', a.done || '',
  ])), `近日異常檢驗_${date}.csv`);
}

/** 透析準備管線 CSV（原版 btnCsvP）：全部，不吃畫面篩選 */
export function exportRrtCsv(rows: CkdRrtRow[], stations: Record<CkdRrtStation, string>, date: string): void {
  const head: Cell[][] = [['病歷號', '姓名', '方案', 'eGFR', '分期', '站別', 'SDM 傾向', 'SDM 已決定', 'SDM 日期', '通路類型', '通路狀態', '建立日', '成熟評估日', '首次使用日', '下一步']];
  downloadCsv(head.concat(rows.map((r): Cell[] => [
    r.mrn, r.name, progName(r.prog), r.egfr == null ? '' : r.egfr.toFixed(1), r.stage || '',
    (stations && stations[r.station]) || r.station,
    r.leaning, r.decided ? '是' : '', str(r.sdm?.['at']),
    str(r.acc?.['accessType']), r.accStatus,
    str(r.acc?.['createDate']), str(r.acc?.['matureDate']), str(r.acc?.['firstUseDate']), r.next,
  ])), `透析準備管線_${date}.csv`);
}

/** 一位病人的累積報告 CSV（原版 wbFlowCsv）：欄＝21 檢驗項、列＝報告日新→舊 */
export function exportPatientLabsCsv(data: CkdPatientLabs): void {
  const head: Cell[] = ['報告日'].concat(data.labs.map((x) => (x[2] ? `${x[1]}(${x[2]})` : x[1])));
  const body: Cell[][] = data.rows.map((row): Cell[] => ([roc(row.date)] as Cell[]).concat(
    data.labs.map((x) => (row[x[0]] == null ? '' : `${row[x[0] + '_q'] || ''}${row[x[0]]}`)),
  ));
  downloadCsv(([head] as Cell[][]).concat(body), `累積報告_${data.mrn}.csv`);
}
