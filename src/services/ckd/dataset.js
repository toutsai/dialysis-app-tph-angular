// 門診 CKD：從 SQLite 載入判定引擎要的資料集（日期字串 → Date），並以「各表筆數＋最後異動時間」為簽章快取。
// 真實量：追蹤清冊 2.5 萬列、檢驗 7 萬份、門診 3.5 千列、入帳 1.5 千列 → 全載約 1 秒、記憶體數十 MB；
// 簽章不變就直接重用，上傳／匯入／個案紀錄異動後簽章改變才重載。
const D = (s) => { if (!s) return null; const d = new Date(String(s).slice(0, 10) + 'T00:00:00'); return isNaN(d) ? null : d }
const J = (s) => { try { return s ? JSON.parse(s) : {} } catch { return {} } }

let cache = null

function signature(db) {
  const q = (t, col, extra = '') => db.prepare(`SELECT COUNT(*) AS n, MAX(${col}) AS m FROM ${t}${extra}`).get()
  const a = q('ckd_cases', 'updated_at'), b = q('ckd_clinic_visits', 'updated_at'), c = q('ckd_labs', 'updated_at'), d = q('ckd_billing', 'created_at'), e = q('ckd_records', 'updated_at')
  return [a.n, a.m, b.n, b.m, c.n, c.m, d.n, d.m, e.n, e.m].join('|')
}

/** 載入（或取快取）：{ cases, clinic, labs, billing, records, manual: [], loadedAt, sig, loadMs } */
export function loadDataset(db) {
  const sig = signature(db)
  if (cache && cache.sig === sig) return cache
  const t0 = Date.now()
  const cases = db.prepare(`SELECT mrn, visit_date, code, ctype, name, prog, cat, dm, enroll_date, egfr, egfr_mdrd, stage, doctor, next_due, reenroll, serial, gap_days, closed, close_date, reason FROM ckd_cases`).all()
    .map((r) => ({
      src: 'case', mrn: r.mrn, visit: D(r.visit_date), code: r.code || '', ctype: r.ctype, name: r.name || '', prog: r.prog || '', cat: r.cat || '',
      dm: !!r.dm, enroll: D(r.enroll_date), egfr: r.egfr, egfrMdrd: r.egfr_mdrd, stage: r.stage || null, doctor: r.doctor || '', nextDue: D(r.next_due),
      reenroll: !!r.reenroll, serial: r.serial || '', gapDays: r.gap_days, closed: !!r.closed, closeDate: D(r.close_date), reason: r.reason || '',
      price: null, sex: '', id: '', age: null, cr: null, upcr: null, uacr: null,
    }))
  const clinic = db.prepare(`SELECT mrn, visit_date, no, name, sex, birth, age, half, dept, room, doctor, acr_date, acr, pcr_date, pcr, egfr_mdrd_date, egfr_mdrd, egfr_date, egfr FROM ckd_clinic_visits`).all()
    .map((r) => ({
      mrn: r.mrn, name: r.name || '', id: '', sex: r.sex || '', birth: D(r.birth), age: r.age, date: D(r.visit_date),
      half: r.half || '', dept: r.dept || '', room: r.room || '', doctor: r.doctor || '', no: r.no || '', state: '', revisit: '',
      pCKD: '', pPRE: '', pDM: '', manual: false,
      acrDate: D(r.acr_date), acr: r.acr, pcrDate: D(r.pcr_date), pcr: r.pcr, egfrMdrdDate: D(r.egfr_mdrd_date), egfrMdrd: r.egfr_mdrd, egfrDate: D(r.egfr_date), egfr: r.egfr,
    }))
  const labs = db.prepare(`SELECT no, mrn, name, report_date, spec, kind, src, values_json, flags_json, quals_json FROM ckd_labs`).all()
    .map((r) => ({ mrn: r.mrn, name: r.name || '', date: D(r.report_date), spec: r.spec, kind: r.kind || '', no: r.no, v: J(r.values_json), flag: J(r.flags_json), q: J(r.quals_json), src: r.src || 'lab' }))
  const billing = db.prepare(`SELECT mrn, visit_date, code, code_name, prog, ctype, name, doctor, dept, sex, birth, price, n FROM ckd_billing`).all()
    .map((r) => ({ src: 'bill', mrn: r.mrn, visit: D(r.visit_date), code: r.code, codeName: r.code_name || '', prog: r.prog || '', ctype: r.ctype || '', name: r.name || '', doctor: r.doctor || '', dept: r.dept || '', sex: r.sex || '', birth: D(r.birth), price: r.price, n: r.n || 1 }))
  /* 個案紀錄（未刪除）：展開成原版 S.records 的形狀 { id, type, mrn, name, created, updated, deleted:false, ...欄位 } */
  const records = db.prepare(`SELECT id, mrn, name, rec_type, payload_json, created_at, updated_at FROM ckd_records WHERE deleted_at IS NULL`).all()
    .map((r) => ({ id: r.id, type: r.rec_type, mrn: r.mrn, name: r.name || '', created: r.created_at, updated: r.updated_at, deleted: false, ...J(r.payload_json) }))
  cache = { sig, cases, clinic, labs, billing, records, manual: [], loadedAt: new Date(), loadMs: Date.now() - t0 }
  return cache
}

export function invalidateDataset() { cache = null }
