// 研究專用路由（Vafseo 真實世界分析）
// 限 admin/contributor（醫師與專師）——刻意排除 editor/viewer，比照 catastrophicIllness.js，勿改成階層式 requireRole
import { Router } from 'express'
import { getDatabase } from '../db/init.js'
import { authenticate, requireAnyRole } from '../middleware/auth.js'
import { buildVafseoStudy, buildMonthlyTrends, buildUnitSnapshot, DEFAULT_CONFIG } from '../services/vafseoStudyService.js'

const router = Router()
const isResearchRole = [authenticate, requireAnyRole('admin', 'contributor')]

const CONFIG_ID = 'vafseo_study_config'

function loadConfig() {
  const db = getDatabase()
  const row = db.prepare(`SELECT config_data FROM site_config WHERE id = ?`).get(CONFIG_ID)
  if (!row) return { ...DEFAULT_CONFIG }
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(row.config_data || '{}') }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

/**
 * GET /api/research/vafseo-study
 * 完整分析結果（世代、事件時間序列、成對比較、逐病人資料）
 */
router.get('/vafseo-study', ...isResearchRole, (req, res) => {
  try {
    const config = loadConfig()
    res.json(buildVafseoStudy(config))
  } catch (error) {
    console.error('Vafseo 研究分析失敗:', error)
    res.status(500).json({ error: true, message: '分析計算失敗' })
  }
})

/**
 * GET /api/research/monthly-trends
 * 全中心日曆月趨勢（貧血/鈣磷兩大區塊：各藥使用人數+平均週劑量 vs 檢驗月平均）
 */
router.get('/monthly-trends', ...isResearchRole, (req, res) => {
  try {
    const config = loadConfig()
    res.json(buildMonthlyTrends(config))
  } catch (error) {
    console.error('月趨勢分析失敗:', error)
    res.status(500).json({ error: true, message: '分析計算失敗' })
  }
})

/**
 * GET /api/research/unit-snapshot
 * 本院現況快照（實證與給付頁籤：活躍用藥人數＋檢驗分布即時計算）
 */
router.get('/unit-snapshot', ...isResearchRole, (req, res) => {
  try {
    res.json(buildUnitSnapshot())
  } catch (error) {
    console.error('本院快照計算失敗:', error)
    res.status(500).json({ error: true, message: '分析計算失敗' })
  }
})

/**
 * PUT /api/research/vafseo-study/config
 * 儲存分析設定（換算比/時間窗/排除名單/研究筆記）——欄位白名單，防寫入垃圾
 */
router.put('/vafseo-study/config', ...isResearchRole, (req, res) => {
  try {
    const body = req.body || {}
    const current = loadConfig()
    const next = { ...current }

    if (body.darbeRatio !== undefined) {
      const v = Number(body.darbeRatio)
      if (![200, 250, 300, 350].includes(v)) return res.status(400).json({ error: true, message: 'darbeRatio 僅接受 200/250/300/350' })
      next.darbeRatio = v
    }
    const intField = (key, min, max) => {
      if (body[key] === undefined) return true
      const v = Number(body[key])
      if (!Number.isInteger(v) || v < min || v > max) return false
      next[key] = v
      return true
    }
    if (!intField('baselineFrom', -12, -1) || !intField('baselineTo', -12, -1) ||
        !intField('postFrom', 1, 24) || !intField('postTo', 1, 24) ||
        !intField('offsetMin', -12, -1) || !intField('offsetMax', 1, 24)) {
      return res.status(400).json({ error: true, message: '時間窗參數不合法' })
    }
    if (next.baselineFrom > next.baselineTo || next.postFrom > next.postTo) {
      return res.status(400).json({ error: true, message: '時間窗起訖顛倒' })
    }
    if (body.excludedPatientIds !== undefined) {
      if (!Array.isArray(body.excludedPatientIds) || body.excludedPatientIds.some((x) => typeof x !== 'string')) {
        return res.status(400).json({ error: true, message: 'excludedPatientIds 需為字串陣列' })
      }
      next.excludedPatientIds = body.excludedPatientIds
    }
    if (body.notes !== undefined) {
      if (typeof body.notes !== 'string' || body.notes.length > 20000) {
        return res.status(400).json({ error: true, message: 'notes 需為 ≤20000 字的字串' })
      }
      next.notes = body.notes
    }

    const db = getDatabase()
    db.prepare(`
      INSERT INTO site_config (id, config_data, updated_at)
      VALUES (?, ?, datetime('now','localtime'))
      ON CONFLICT(id) DO UPDATE SET config_data = excluded.config_data, updated_at = excluded.updated_at
    `).run(CONFIG_ID, JSON.stringify(next))

    res.json({ success: true, config: next })
  } catch (error) {
    console.error('Vafseo 研究設定儲存失敗:', error)
    res.status(500).json({ error: true, message: '設定儲存失敗' })
  }
})

export default router
