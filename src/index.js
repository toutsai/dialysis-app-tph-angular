// 透析排程系統 - 本地伺服器
import 'dotenv/config'   // 讀取 .env 檔案到 process.env（PM2 env_file 不可靠，改用 dotenv）
import express from 'express'
import cors from 'cors'
import morgan from 'morgan'
import { existsSync, statSync } from 'fs'
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

// 資料庫初始化
import { initDatabase, getDatabase, ensureDefaultAdmin, closeDatabase } from './db/init.js'
import { v4 as uuidv4 } from 'uuid'
import { apiRateLimit } from './middleware/rateLimit.js'
import { gzipJson } from './middleware/gzip.js'

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
app.use(morgan('dev'))

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

// ========================================
// Angular 前端路由別名（Firebase 遷移相容）
// ========================================

// POST /api/orders/process → orders 路由的 /medications/upload
app.use('/api/orders/process', (req, res, next) => {
  req.url = '/medications/upload'
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

// GET/PUT /api/system/marquee → system 路由的 /site-config/marquee
app.use('/api/system/marquee', (req, res, next) => {
  req.url = '/site-config/marquee'
  systemRoutes(req, res, next)
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
    mode: 'standalone'
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

// 前端部署版本識別：即時讀 index.html mtime（每次 ng build 會變）。
// ⚠️ 必須每次請求即時讀取，不可在啟動時快取——前端改動只 build 不 pm2 restart，
//    若啟動時算一次，端點會回舊值偵測不到更新。免認證、不含敏感資料。
app.get('/api/version', (req, res) => {
  try {
    const stat = statSync(join(staticPath, 'index.html'))
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
    res.json({ build: String(Math.floor(stat.mtimeMs)) })
  } catch (e) {
    res.status(503).json({ error: true, message: 'index.html 不存在' })
  }
})

app.use(
  express.static(staticPath, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) {
        // index.html 永不快取：確保使用者重整一定拿到「指向最新 bundle」的版本，
        // 否則瀏覽器會用舊 index.html → 載入舊 JS → 看不到更新
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
        res.setHeader('Pragma', 'no-cache')
        res.setHeader('Expires', '0')
      } else if (/-[0-9A-Za-z]{8,}\.(js|css)$/.test(filePath)) {
        // 帶內容雜湊的 JS/CSS (如 main-3Z35MFZM.js) 內容變動必換檔名，可安全長期快取
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      }
    },
  }),
)

// SPA 路由支援 - 所有未匹配的路由返回 index.html
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return next()
  }
  // 同樣禁止快取 index.html，避免深層連結載入到舊版
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')
  res.sendFile(join(staticPath, 'index.html'))
})

// ========================================
// 錯誤處理
// ========================================

app.use((err, req, res, next) => {
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

app.listen(PORT, '0.0.0.0', () => {
  console.log('\n========================================')
  console.log('  透析排程系統 - 本地伺服器')
  console.log('========================================')
  console.log(`✅ 伺服器已啟動`)
  console.log(`📍 本機網址: http://localhost:${PORT}`)

  // 顯示區域網路 IP
  import('os').then(os => {
    const interfaces = os.networkInterfaces()
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          console.log(`📍 區域網路: http://${iface.address}:${PORT}`)
        }
      }
    }
    console.log('========================================\n')

    // 啟動定時任務調度器
    startScheduler()
  })
})

export default app
