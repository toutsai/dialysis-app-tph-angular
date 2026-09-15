// 門診 CKD 收案追蹤（Angular 重寫版，2026-09-15 起分階段實作；計畫見 docs/2026-09-15-ckd-clinic-tab-plan.md）
// 權限：admin / editor / contributor（使用者拍板；本站階層 admin > editor > contributor > viewer → contributor 門檻）
// 刻意不掛在 aki router（專師限定）底下。
import { Router } from 'express'
import { getDatabase } from '../db/init.js'
import { isContributor, logAuditWithRequest } from '../middleware/auth.js'
import { getSettings, saveSettings, DEFAULT_SETTINGS } from '../services/ckd/settings.js'
import { KIND_LABEL } from '../services/ckd/parsers.js'

const router = Router()
router.use(...isContributor)

/** 階段進度（給前端「開發中」頁顯示；改完一階段就更新） */
const PHASES = [
  { no: 0, title: '骨架：頁面、路由、資料表、解析器搬移＋測試', status: 'done' },
  { no: 1, title: '匯入與設定：四種 HIS 報表上傳、辨識、合併、批次紀錄、判定參數', status: 'todo' },
  { no: 2, title: '明日追蹤＋收案評估（判定引擎搬後端）', status: 'todo' },
  { no: 3, title: '個案紀錄七類、VPN 他院查核、不予收案、P 碼補登更正', status: 'todo' },
  { no: 4, title: '全名單稽核、檢驗總表、XLSX／CSV 匯出', status: 'todo' },
  { no: 5, title: '召回清單、異常檢驗、透析準備管線、月報、檢核 P 碼', status: 'todo' },
  { no: 6, title: '與病人清單／預約洗腎登記打通', status: 'todo' },
]

// ---------- 狀態：資料表筆數、最近批次、判定參數 ----------
router.get('/status', (req, res) => {
  try {
    const db = getDatabase()
    const count = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n
    const counts = {
      cases: count('ckd_cases'),
      clinicVisits: count('ckd_clinic_visits'),
      labs: count('ckd_labs'),
      billing: count('ckd_billing'),
      records: count('ckd_records'),
    }
    const batches = db.prepare(`
      SELECT id, kind, file_name, row_count, inserted, replaced, uploaded_by, created_at
      FROM ckd_upload_batches ORDER BY created_at DESC LIMIT 10
    `).all().map((b) => ({
      id: b.id,
      kind: b.kind,
      kindLabel: KIND_LABEL[b.kind] || b.kind,
      fileName: b.file_name,
      rowCount: b.row_count,
      inserted: b.inserted,
      replaced: b.replaced,
      uploadedBy: safeJson(b.uploaded_by),
      createdAt: b.created_at,
    }))
    const { settings, updatedBy, updatedAt } = getSettings()
    res.json({
      phases: PHASES,
      counts,
      batches,
      settings,
      settingsUpdatedBy: safeJson(updatedBy),
      settingsUpdatedAt: updatedAt,
      supportedKinds: Object.entries(KIND_LABEL).map(([kind, label]) => ({ kind, label })),
    })
  } catch (error) {
    console.error('❌ GET /ckd/status:', error)
    res.status(500).json({ error: true, message: '讀取門診 CKD 收案狀態失敗' })
  }
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

function safeJson(s) {
  if (!s) return null
  try { return typeof s === 'string' ? JSON.parse(s) : s } catch { return null }
}

export default router
