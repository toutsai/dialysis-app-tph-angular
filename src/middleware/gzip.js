// 零依賴 gzip 中介層
// 攔截 res.json：當用戶端支援 gzip 且 payload 夠大時，以 Node 內建 zlib 壓縮。
// 重端點（檢驗報告 / 藥囑 9000+ 筆）JSON 壓縮率約 5~10x，大幅縮短傳輸與解析時間。
import { gzip } from 'zlib'

const THRESHOLD = 1024 // 小於 1KB 不壓縮（壓縮成本 > 效益）

export function gzipJson(req, res, next) {
  const acceptEncoding = req.headers['accept-encoding'] || ''
  if (!/\bgzip\b/.test(acceptEncoding)) return next()

  const sendJson = (body) => {
    let buf
    try {
      buf = Buffer.from(JSON.stringify(body))
    } catch {
      // 序列化失敗 → 交回 Express 原生處理
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      return res.end()
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8')

    if (buf.length < THRESHOLD || res.getHeader('Content-Encoding')) {
      return res.end(buf)
    }

    gzip(buf, (err, zipped) => {
      if (err) return res.end(buf) // 壓縮失敗 → 退回未壓縮
      res.setHeader('Content-Encoding', 'gzip')
      res.setHeader('Vary', 'Accept-Encoding')
      res.removeHeader('Content-Length')
      res.end(zipped)
    })
    return res
  }

  res.json = sendJson
  next()
}
