// 門診 CKD 收案追蹤（Angular 重寫版，2026-09-15 起分階段實作；計畫見 docs/2026-09-15-ckd-clinic-tab-plan.md）
// 權限：admin / editor / contributor（使用者拍板；本站階層 admin > editor > contributor > viewer → contributor 門檻）
// 刻意不掛在 aki router（專師限定）底下。
import express, { Router } from 'express'
import crypto from 'node:crypto'
import { getDatabase } from '../db/init.js'
import { isContributor, logAuditWithRequest } from '../middleware/auth.js'
import { getSettings, saveSettings, DEFAULT_SETTINGS } from '../services/ckd/settings.js'
import { KIND_LABEL } from '../services/ckd/parsers.js'
import { parseFileInChild, UPLOAD_MAX_BYTES } from '../services/ckd/parseFile.js'
import { ingestPayload, sourceSummary, listBatches } from '../services/ckd/ingest.js'
import { plain } from '../services/ckd/rows.js'
import { loadDataset } from '../services/ckd/dataset.js'
import { analyze, makeCfg, sessionGroups, verdictA, verdictB, OTHER_SESSION } from '../services/ckd/engine.js'

const router = Router()
router.use(...isContributor)

/** 階段進度（給前端「開發中」頁顯示；改完一階段就更新） */
const PHASES = [
  { no: 0, title: '骨架：頁面、路由、資料表、解析器搬移＋測試', status: 'done' },
  { no: 1, title: '匯入與設定：四種 HIS 報表上傳、辨識、合併、批次紀錄、判定參數', status: 'done' },
  { no: 2, title: '明日追蹤＋收案評估（判定引擎搬後端）', status: 'done' },
  { no: 3, title: '個案紀錄七類、VPN 他院查核、不予收案、P 碼補登更正', status: 'todo' },
  { no: 4, title: '全名單稽核、檢驗總表、XLSX／CSV 匯出', status: 'todo' },
  { no: 5, title: '召回清單、異常檢驗、透析準備管線、月報、檢核 P 碼', status: 'todo' },
  { no: 6, title: '與病人清單／預約洗腎登記打通', status: 'todo' },
]

// ---------- 狀態：四種來源現況、最近批次、判定參數 ----------
router.get('/status', (req, res) => {
  try {
    const db = getDatabase()
    const counts = {
      cases: db.prepare(`SELECT COUNT(*) AS n FROM ckd_cases`).get().n,
      clinicVisits: db.prepare(`SELECT COUNT(*) AS n FROM ckd_clinic_visits`).get().n,
      labs: db.prepare(`SELECT COUNT(*) AS n FROM ckd_labs`).get().n,
      billing: db.prepare(`SELECT COUNT(*) AS n FROM ckd_billing`).get().n,
      records: db.prepare(`SELECT COUNT(*) AS n FROM ckd_records WHERE deleted_at IS NULL`).get().n,
    }
    const { settings, updatedBy, updatedAt } = getSettings()
    res.json({
      phases: PHASES,
      counts,
      sources: sourceSummary(db),
      batches: listBatches(db, 10),
      settings,
      settingsUpdatedBy: safeJson(updatedBy),
      settingsUpdatedAt: updatedAt,
      supportedKinds: Object.entries(KIND_LABEL).map(([kind, label]) => ({ kind, label })),
      uploadMaxBytes: UPLOAD_MAX_BYTES,
    })
  } catch (error) {
    console.error('❌ GET /ckd/status:', error)
    res.status(500).json({ error: true, message: '讀取門診 CKD 收案狀態失敗' })
  }
})

router.get('/batches', (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 200)
    res.json({ batches: listBatches(getDatabase(), limit) })
  } catch (error) {
    console.error('❌ GET /ckd/batches:', error)
    res.status(500).json({ error: true, message: '讀取上傳紀錄失敗' })
  }
})

// ---------- 上傳（raw 二進位，不走 base64＋全域 10mb JSON 限制）----------
// 檔名放 header X-File-Name（encodeURIComponent），可選 X-Force-Kind 指定種類（標題辨識失敗時才用）
router.post('/upload', express.raw({ type: () => true, limit: UPLOAD_MAX_BYTES + 1024 }), async (req, res) => {
  const fileName = decodeURIComponent(String(req.get('x-file-name') || 'upload')).slice(0, 200)
  const forcedKind = String(req.get('x-force-kind') || '')
  try {
    const buffer = req.body
    if (!Buffer.isBuffer(buffer) || !buffer.length) {
      return res.status(400).json({ error: true, message: '缺少檔案內容' })
    }
    if (buffer.length > UPLOAD_MAX_BYTES) {
      return res.status(413).json({ error: true, message: `檔案超過 ${Math.round(UPLOAD_MAX_BYTES / 1048576)}MB 上限，請縮短匯出區間或分檔（首次大批匯入請聯絡系統管理員用命令列匯入）` })
    }
    const fileHash = crypto.createHash('sha1').update(buffer).digest('hex')
    const db = getDatabase()
    const prev = db.prepare(`SELECT file_name, created_at FROM ckd_upload_batches WHERE file_hash = ? ORDER BY created_at DESC LIMIT 1`).get(fileHash)
    if (prev) {
      return res.json({ dup: true, fileName, message: `內容與 ${prev.created_at} 匯入的「${prev.file_name}」相同，已略過` })
    }
    const payload = await parseFileInChild(buffer, { fileName, forcedKind })
    const result = ingestPayload(db, payload, { fileName, fileHash, user: req.user })
    await logAuditWithRequest(req, 'ckd_upload', 'ckd_upload_batches', result.batchId, { fileName, kind: result.kind, stats: result.stats })
    res.json({
      dup: false,
      fileName,
      kind: result.kind,
      kindLabel: result.kindLabel,
      batchId: result.batchId,
      aoaRows: payload.aoaRows,
      stats: result.stats,
      labStats: result.labStats,
      range: result.range,
      sources: sourceSummary(db),
    })
  } catch (error) {
    const status = error.status || 500
    if (status >= 500) console.error('❌ POST /ckd/upload:', error)
    res.status(status).json({ error: true, fileName, message: error.message || '上傳失敗' })
  }
})

// 上傳體積超限時 express.raw 會丟 413，統一回 JSON
router.use((err, req, res, next) => {
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    return res.status(413).json({ error: true, message: `檔案超過 ${Math.round(UPLOAD_MAX_BYTES / 1048576)}MB 上限，請縮短匯出區間或分檔` })
  }
  next(err)
})

// ---------- 判定參數 ----------
router.get('/settings', (req, res) => {
  try {
    const { settings, updatedBy, updatedAt } = getSettings()
    res.json({ settings, defaults: DEFAULT_SETTINGS, updatedBy: safeJson(updatedBy), updatedAt })
  } catch (error) {
    console.error('❌ GET /ckd/settings:', error)
    res.status(500).json({ error: true, message: '讀取判定參數失敗' })
  }
})

router.put('/settings', async (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object' || !Object.keys(req.body).length) {
      return res.status(400).json({ error: true, message: '缺少要更新的參數' })
    }
    const { settings, updatedBy, updatedAt } = saveSettings(req.body, req.user)
    await logAuditWithRequest(req, 'ckd_settings_update', 'ckd_settings', 'main', { patch: req.body })
    res.json({ settings, defaults: DEFAULT_SETTINGS, updatedBy: safeJson(updatedBy), updatedAt })
  } catch (error) {
    console.error('❌ PUT /ckd/settings:', error)
    res.status(500).json({ error: true, message: '儲存判定參數失敗' })
  }
})

// ---------- 階段 2：判讀日 × 醫師 的 A（已收案可否追蹤）／B（未收案可否收案） ----------
// GET /daily?date=YYYY-MM-DD&doctor=<醫師|空=全部|__other__[|科別|醫師]>
// 沒帶 date → 本科別最近的門診日（原版 app.js:180-184 的預設）
router.get('/daily', (req, res) => {
  try {
    const db = getDatabase()
    const { settings } = getSettings()
    const data = loadDataset(db)
    const dateQ = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? String(req.query.date) : ''
    const doctorQ = String(req.query.doctor || '')
    const sessions = sessionGroups(data, makeCfg(settings, dateQ), doctorQ, dateQ)
    const C = makeCfg(settings, sessions.cur)
    const t0 = Date.now()
    const R = analyze(data, C, { doctorSel: sessions.doctorSel, withAudit: false })
    const A = R.A.map((r) => slimA(r, C))
    const B = R.B.map((r) => slimB(r))
    res.json({
      date: sessions.cur,
      doctorSel: sessions.doctorSel,
      otherSession: OTHER_SESSION,
      sessions: { groups: sessions.groups, others: sessions.others, otherGroups: sessions.otherGroups },
      deptInfo: R.deptInfo,
      cfg: { preGap: C.preGap, earlyNew: C.earlyNew, earlyGap: C.earlyGap, dmGap: C.dmGap, over: C.over, labWin: C.labWin, dept: C.dept, allA: C.allA },
      hasCases: data.cases.length > 0,
      hasClinic: data.clinic.length > 0,
      A, B,
      timing: { loadMs: data.loadMs, analyzeMs: Date.now() - t0 },
    })
  } catch (error) {
    console.error('❌ GET /ckd/daily:', error)
    res.status(500).json({ error: true, message: '判讀失敗' })
  }
})

/** 門診列去識別（身分證不送前端）＋ 日期字串化 */
function slimClinic(p) {
  if (!p) return null
  return plain({ mrn: p.mrn, name: p.name, sex: p.sex, age: p.age, date: p.date, half: p.half, dept: p.dept, room: p.room, doctor: p.doctor, no: p.no, pDM: p.pDM, manual: !!p.manual })
}
function slimLab(lab) {
  if (!lab) return null
  return plain({ date: lab.date, v: lab.v, flag: lab.flag, q: lab.q, dateOf: lab.dateOf, src: lab.src, kinds: lab.kinds, calcUpcr: !!lab.calcUpcr })
}
function slimA(r, C) {
  const box = verdictA(r, C)
  return plain({
    mrn: r.mrn, p: slimClinic(r.p), name: (r.p && r.p.name) || (r.last && r.last.name) || '',
    prog: r.prog, dkd: !!r.dkd, isDM: r.isDM, isNew: r.isNew, otherDept: !!r.otherDept,
    egfr: r.egfr, src: r.src, mdrd: r.mdrd, stage: r.stage, upcr: r.upcr, uacr: r.uacr,
    lab: slimLab(r.lab), labOk: r.labOk, labGap: r.labGap,
    last: r.last ? { visit: r.last.visit, enroll: r.last.enroll, code: r.last.code, ctype: r.last.ctype, doctor: r.last.doctor, src: r.last.src } : null,
    timeline: (r.recs || []).map((x) => ({ visit: x.visit, code: x.code, ctype: x.ctype, src: x.src, doctor: x.doctor, price: x.price })),
    nextDue: r.nextDue, nextApp: r.nextApp, caseDoctor: r.caseDoctor,
    gap: r.gap, need: r.need, code: r.code, status: r.status, why: r.why, nYear: r.nYear, n12: r.n12, tenure: r.tenure, enroll: r.enroll,
    ann: r.ann, alerts: r.alerts, slope: r.slope,
    recon: r.recon ? { anchor: r.recon.anchor, misses: r.recon.misses.map((m) => ({ visit: m.visit, code: m.code })), shortBilled: r.recon.shortBilled } : null,
    miss: r.miss, unk: r.unk, bed: r.bed, ord: r.ord, inds: r.inds, age: r.age,
    box,
  })
}
function slimB(r) {
  const box = verdictB(r, null)   // 外院查核紀錄：階段 3
  return plain({
    mrn: r.p.mrn, p: slimClinic(r.p), name: r.p.name || '',
    lab: slimLab(r.lab), egfr: r.egfr, from: r.from, upcr: r.upcr, uacr: r.uacr, stage: r.stage,
    verdict: r.verdict, code: r.code, why: r.why, age: r.age,
    closed: r.closed, closeKind: r.closeKind, closeInfo: r.closeInfo, noEn: r.noEn,
    miss: r.miss, unk: r.unk, bed: r.bed, ord: r.ord,
    box,
  })
}

function safeJson(s) {
  if (!s) return null
  try { return typeof s === 'string' ? JSON.parse(s) : s } catch { return null }
}

export default router
