// Compress large JSON responses without bypassing Express serialization or HTTP semantics.
import { gzip } from 'node:zlib'

const THRESHOLD = 1024

export function gzipJson(req, res, next) {
  // Every representation varies, including uncompressed responses. Keep CORS' Vary: Origin.
  res.vary('Accept-Encoding')
  if (!req.headers['accept-encoding'] || req.acceptsEncodings('gzip', 'identity') !== 'gzip') {
    return next()
  }

  const originalJson = res.json
  res.json = function (...args) {
    const originalSend = this.send
    // Let Express honor json replacer/spaces/escape and propagate serialization errors.
    this.send = function (body) {
      this.send = originalSend
      if (typeof body !== 'string' || Buffer.byteLength(body) < THRESHOLD ||
          this.statusCode === 204 || this.statusCode === 205 || this.statusCode === 304 ||
          this.getHeader('Content-Encoding') || /\bno-transform\b/i.test(this.getHeader('Cache-Control') || '')) {
        return originalSend.call(this, body)
      }

      gzip(body, (err, zipped) => {
        if (this.destroyed || this.writableEnded) return
        try {
          if (err) return originalSend.call(this, body)
          this.setHeader('Content-Encoding', 'gzip')
          // Express computes the correct length/ETag and handles HEAD/conditional requests.
          originalSend.call(this, zipped)
        } catch (error) {
          next(error)
        }
      })
      return this
    }
    try {
      return originalJson.apply(this, args)
    } finally {
      this.send = originalSend
    }
  }
  next()
}
