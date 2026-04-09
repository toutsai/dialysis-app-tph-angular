// 透析排程系統 - 本地伺服器
import express from 'express'
import cors from 'cors'
import morgan from 'morgan'
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
import systemRoutes from './routes/system.js'

// 資料庫初始化
import { initDatabase, getDatabase, ensureDefaultAdmin } from './db/init.js'
import { v4 as uuidv4 } from 'uuid'

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

// CORS 設定 - 允許同一區域網路的所有連線
app.use(cors({
  origin: true, // 允許所有來源 (內網使用)
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

app.use('/api/auth', authRoutes)
app.use('/api/patients', patientsRoutes)
app.use('/api/schedules', schedulesRoutes)
app.use('/api/memos', memosRoutes)
app.use('/api/orders', ordersRoutes)
app.use('/api/medications', medicationsRoutes)
app.use('/api/nursing', nursingRoutes)
app.use('/api/system', systemRoutes)

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
// - 開發模式：使用相對路徑 ../../dist
const staticPath = process.env.STATIC_PATH || join(__dirname, '../../dist')
console.log(`📂 靜態檔案路徑: ${staticPath}`)
app.use(express.static(staticPath))

// SPA 路由支援 - 所有未匹配的路由返回 index.html
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return next()
  }
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

    db.close()
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
