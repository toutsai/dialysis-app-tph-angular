import express from 'express'
import { stat } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'

function preventCaching(res) {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate')
  res.set('Pragma', 'no-cache')
  res.set('Expires', '0')
}

export function frontendDelivery(directory) {
  const router = express.Router()
  const staticPath = resolve(directory)
  const indexPath = join(staticPath, 'index.html')

  router.get('/api/version', async (_req, res) => {
    preventCaching(res)
    try {
      // Read every time so a frontend-only rebuild is detected without restarting PM2.
      const info = await stat(indexPath)
      res.json({ build: String(Math.floor(info.mtimeMs)) })
    } catch {
      res.status(503).json({ error: true, message: 'index.html 不存在' })
    }
  })

  // Unknown APIs must never fall through to static files or the Angular application.
  router.use('/api', (_req, res) => {
    res.status(404).json({ error: true, message: '找不到指定的 API' })
  })

  router.use(express.static(staticPath, {
    setHeaders(res, filePath) {
      if (basename(filePath) === 'index.html') {
        preventCaching(res)
      } else if (/-[0-9A-Za-z]{8,}\.(?:js|css|woff2?|ttf|otf|svg|png|webp|avif)$/.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      }
    },
  }))

  router.get('*', (req, res, next) => {
    // A removed lazy chunk must be a real 404; serving HTML hides stale deployment errors.
    if (extname(req.path) || !req.accepts('html')) return next()
    preventCaching(res)
    res.sendFile(indexPath)
  })

  return router
}
