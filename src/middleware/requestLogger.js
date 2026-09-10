import morgan from 'morgan'

// Queries can contain JWTs, identifiers and search terms. Log only the path.
export function requestPathForLog(req) {
  return String(req.originalUrl || req.url || '').split(/[?#]/, 1)[0]
}
export function createRequestLogger(options) {
  return morgan((tokens, req, res) => [
    tokens.method(req, res), requestPathForLog(req), tokens.status(req, res),
    tokens['response-time'](req, res), 'ms -', tokens.res(req, res, 'content-length') || '-',
  ].join(' '), options)
}
export const requestLogger = createRequestLogger()
