// 透析排程系統 - 本地伺服器
import 'dotenv/config'   // 讀取 .env 檔案到 process.env（PM2 env_file 不可靠，改用 dotenv）
import express from 'express'
import cors from 'cors'
import { requestLogger } from './middleware/requestLogger.js'
import { existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// 路由
import authRoutes from './routes/auth.js'
import patientsRoutes from './routes/patients.js'
import schedulesRoutes from './routes/schedules.js'
import memosRoutes from './routes/memos.js'
import ordersRoutes from './routes/orders.js'
import medicationsRoutes from './routes/medications.js'
import nursingRoutes from './routes/nursing.js'
import vascularAccessRoutes from './routes/vascularAccess.js'
import systemRoutes from './routes/system.js'
import eventsRoutes from './routes/events.js'
import dashboardRoutes from './routes/dashboard.js'
import akiRoutes from './routes/aki.js'
import catastrophicIllnessRoutes from './routes/catastrophicIllness.js'
import researchRoutes from './routes/research.js'
import reservationsRoutes from './routes/reservations.js'
import ckdRoutes from './routes/ckd.js'

// 資料庫初始化
import { initDatabase, getDatabase, ensureDefaultAdmin, closeDatabase } from './db/init.js'
import { v4 as uuidv4 } from 'uuid'
import { apiRateLimit } from './middleware/rateLimit.js'
import { gzipJson } from './middleware/gzip.js'
import { frontendDelivery } from './middleware/frontendDelivery.js'

// 定時任務調度器
import { startScheduler } from './services/scheduler.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// 初始化資料庫並確保有預設管理員
initDatabase()
ensureDefaultAdmin().catch(err => {
  console.error('❌ 建立預設管理員失敗:', err)
})

const app = express()
const PORT = process.env.PORT || 3000
const BIND_HOST = process.env.BIND_HOST || '0.0.0.0'

// ========================================
// 中介軟體 (Middleware)
// ========================================

// CORS 白名單設定
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
  : null

app.use(cors({
  origin: (origin, callback) => {
    // 允許沒有 origin 的請求（同源、Postman、curl 等）
    if (!origin) return callback(null, true)

    // 若有設定白名單，嚴格比對
    if (ALLOWED_ORIGINS) {
      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true)
      console.warn(`[CORS] 拒絕來源: ${origin}`)
      return callback(new Error('Not allowed by CORS'))
    }

    // 開發模式：允許 localhost / 127.0.0.1 / 區域網路 IP 的任意 port
    try {
      const url = new URL(origin)
      const host = url.hostname
      if (host === 'localhost' || host === '127.0.0.1' || /^192\.168\.\d+\.\d+$/.test(host)) {
        return callback(null, true)
      }
    } catch {}

    console.warn(`[CORS] 拒絕來源: ${origin}`)
    callback(new Error('Not allowed by CORS'))
  },
  credentials: true
}))

// 請求日誌
app.use(requestLogger)

// JSON 解析
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

// ========================================
// API 路由
// ========================================

// 通用 API rate limit
app.use('/api/', apiRateLimit)

// API 回應 gzip 壓縮（重端點傳輸量大幅下降）
app.use('/api/', gzipJson)

// Angular 前端 update() 一律送 PATCH，後端統一以 PUT handler 處理：
// 全域將 PATCH 轉為 PUT（新端點一律寫 router.put，不要另寫 router.patch）
app.use('/api/', (req, res, next) => {
  if (req.method === 'PATCH') {
    req.method = 'PUT'
  }
  next()
})

app.use('/api/auth', authRoutes)
app.use('/api/patients', patientsRoutes)
app.use('/api/schedules', schedulesRoutes)
app.use('/api/memos', memosRoutes)
app.use('/api/orders', ordersRoutes)
app.use('/api/medications', medicationsRoutes)
app.use('/api/nursing', nursingRoutes)
app.use('/api/vascular-access', vascularAccessRoutes)
app.use('/api/system', systemRoutes)
app.use('/api/events', eventsRoutes)
app.use('/api/dashboard', dashboardRoutes)
app.use('/api/aki', akiRoutes)
app.use('/api/catastrophic-illness', catastrophicIllnessRoutes)
app.use('/api/research', researchRoutes)
app.use('/api/reservations', reservationsRoutes)
app.use('/api/ckd', ckdRoutes) // 門診 CKD 收案追蹤（admin/editor/contributor；2026-09-15 起分階段實作）

// ========================================
// Angular 前端路由別名（Firebase 遷移相容）
// ========================================

// POST /api/orders/process → orders 路由的 /medications/upload
app.use('/api/orders/process', (req, res, next) => {
  req.url = '/medications/upload'
  ordersRoutes(req, res, next)
})

// POST /api/dialysis-orders/process → orders 路由的 /dialysis-orders/upload（透析醫囑 Excel）
app.use('/api/dialysis-orders/process', (req, res, next) => {
  req.url = '/dialysis-orders/upload'
  ordersRoutes(req, res, next)
})

// POST /api/lab-reports/process → orders 路由的 /lab-reports/upload
app.use('/api/lab-reports/process', (req, res, next) => {
  req.url = '/lab-reports/upload'
  ordersRoutes(req, res, next)
})

// POST /api/consumables/process → orders 路由的 /consumables/upload
app.use('/api/consumables/process', (req, res, next) => {
  req.url = '/consumables/upload'
  ordersRoutes(req, res, next)
})

// GET /api/system/scheduled-changes → system 路由的 /scheduled-updates
app.use('/api/system/scheduled-changes', (req, res, next) => {
  req.url = '/scheduled-updates'
  systemRoutes(req, res, next)
})

// GET /api/lab_reports → orders 路由的 /lab-reports
// （Angular localApiClient 的 COLLECTION_ROUTE_MAP 無 lab_reports，
//   fallback 成 /lab_reports；PatientLabSummaryPanel 等元件走此路徑）
app.use('/api/lab_reports', (req, res, next) => {
  const q = req.url.indexOf('?')
  req.url = '/lab-reports' + (q >= 0 ? req.url.slice(q) : '')
  ordersRoutes(req, res, next)
})

// ========================================
// 健康檢查端點
// ========================================

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    mode: 'standalone',
    ...(process.env.NODE_ENV === 'test' && process.env.SMOKE_RUN_ID
      ? { smokeRunId: process.env.SMOKE_RUN_ID }
      : {})
  })
})

// ========================================
// 靜態檔案服務 (前端)
// ========================================

// 判斷靜態檔案路徑
// - Electron 打包後：透過環境變數 STATIC_PATH 傳入
// - Angular application builder 輸出到 dist/browser
// - 舊版/其他 build 可能直接輸出到 dist
const angularDistPath = join(__dirname, '../dist/browser')
const legacyDistPath = join(__dirname, '../dist')
const staticPath =
  process.env.STATIC_PATH ||
  (existsSync(join(angularDistPath, 'index.html'))
    ? angularDistPath
    : legacyDistPath)
console.log(`📂 靜態檔案路徑: ${staticPath}`)

app.use(frontendDelivery(staticPath))

// ========================================
// 錯誤處理
// ========================================

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err)
  console.error('❌ 伺服器錯誤:', err)

  // 記錄錯誤到稽核日誌
  try {
    const db = getDatabase()

    db.prepare(`
      INSERT INTO audit_logs (id, action, user_id, details, success, created_at)
      VALUES (?, 'SERVER_ERROR', ?, ?, 0, datetime('now', 'localtime'))
    `).run(
      uuidv4(),
      req.user?.id || 'anonymous',
      JSON.stringify({ path: req.path, error: err.message })
    )
  } catch (logError) {
    console.error('無法記錄錯誤日誌:', logError)
  }

  res.status(err.status || 500).json({
    error: true,
    message: err.message || '伺服器內部錯誤',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  })
})

// ========================================
// Graceful shutdown
// ========================================

function gracefulShutdown(signal) {
  console.log(`\n${signal} received. Shutting down gracefully...`)
  closeDatabase()
  process.exit(0)
}
process.on('SIGINT', () => gracefulShutdown('SIGINT'))
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))

// ========================================
// 啟動伺服器
// ========================================

app.listen(PORT, BIND_HOST, () => {
  console.log('\n========================================')
  console.log('  透析排程系統 - 本地伺服器')
  console.log('========================================')
  console.log(`✅ 伺服器已啟動`)
  console.log(`📍 本機網址: http://localhost:${PORT}`)

  // 顯示區域網路 IP
  import('os').then(os => {
    if (BIND_HOST === '0.0.0.0') {
      const interfaces = os.networkInterfaces()
      for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
          if (iface.family === 'IPv4' && !iface.internal) {
            console.log(`📍 區域網路: http://${iface.address}:${PORT}`)
          }
        }
      }
    }
    console.log('========================================\n')

    if (process.env.NODE_ENV === 'test' && process.env.DISABLE_SCHEDULER === '1') {
      console.log('⏭️ 已停用定時任務調度器')
    } else {
      // 啟動定時任務調度器
      startScheduler()
    }
  })
})

export default app
