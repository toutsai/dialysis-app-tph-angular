import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { request } from 'node:http'
import { gunzipSync } from 'node:zlib'
import express from 'express'
import { gzipJson } from '../src/middleware/gzip.js'

const payload = { text: '透析排程 <資料> & '.repeat(300), hidden: 'private' }
let server, baseUrl

before(async () => {
  const app = express()
  app.set('json spaces', 2)
  app.set('json escape', true)
  app.set('json replacer', (key, value) => key === 'hidden' ? undefined : value)
  app.use((_req, res, next) => { res.vary('Origin'); next() })
  app.use(gzipJson)
  app.get('/large', (_req, res) => res.json(payload))
  app.get('/small', (_req, res) => res.json({ ok: true }))
  app.get('/no-transform', (_req, res) => res.set('Cache-Control', 'private, no-transform').json(payload))
  app.get('/empty/:status', (req, res) => res.status(Number(req.params.status)).json(payload))
  app.get('/undefined', (_req, res) => res.json(undefined))
  app.get('/circular', (_req, res) => { const value = {}; value.self = value; res.json(value) })
  app.use((err, _req, res, _next) => res.status(500).json({ error: true, message: err.message }))
  server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})
after(async () => { await new Promise(resolve => server.close(resolve)) })

function raw(path, encoding = 'gzip', extra = {}) {
  return new Promise((resolve, reject) => {
    const req = request(`${baseUrl}${path}`, {
      method: extra.method || 'GET',
      headers: { ...(encoding ? { 'Accept-Encoding': encoding } : {}), ...extra.headers },
    }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.end()
  })
}

test('gzip preserves Express serialization and merges CORS Vary; length and ETag stay valid', async () => {
  const plain = await raw('/large', 'identity')
  const zipped = await raw('/large')
  assert.equal(zipped.headers['content-encoding'], 'gzip')
  assert.deepEqual(gunzipSync(zipped.body), plain.body)
  assert.equal(zipped.headers['content-type'], 'application/json; charset=utf-8')
  assert.equal(Number(zipped.headers['content-length']), zipped.body.length)
  assert(zipped.body.length < plain.body.length / 4)
  assert.match(plain.body.toString(), /\\u003c/)
  assert(!plain.body.toString().includes('private'))
  for (const result of [plain, zipped]) {
    assert.match(result.headers.vary, /Origin/)
    assert.match(result.headers.vary, /Accept-Encoding/)
    assert(result.headers.etag)
  }
})

test('encoding negotiation respects q=0, preference and absent Accept-Encoding', async () => {
  for (const encoding of ['gzip;q=0', 'gzip;q=0, *;q=1', 'gzip;q=0.1, identity;q=1', 'br', '']) {
    const result = await raw('/large', encoding)
    assert.equal(result.headers['content-encoding'], undefined, encoding)
    assert.equal(JSON.parse(result.body).text, payload.text)
  }
  assert.equal((await raw('/large', 'br, gzip;q=0.5, identity;q=0')).headers['content-encoding'], 'gzip')
})

test('small JSON and no-transform retain original response body', async () => {
  for (const path of ['/small', '/no-transform']) {
    const result = await raw(path)
    assert.equal(result.headers['content-encoding'], undefined)
    assert.equal(Number(result.headers['content-length']), result.body.length)
    assert.doesNotThrow(() => JSON.parse(result.body))
  }
})

test('HEAD and conditional GET preserve HTTP body and caching semantics', async () => {
  const get = await raw('/large')
  const head = await raw('/large', 'gzip', { method: 'HEAD' })
  assert.equal(head.body.length, 0)
  assert.equal(head.headers['content-length'], get.headers['content-length'])
  assert.equal(head.headers.etag, get.headers.etag)
  const fresh = await raw('/large', 'gzip', { headers: { 'If-None-Match': get.headers.etag } })
  assert.equal(fresh.status, 304)
  assert.equal(fresh.body.length, 0)
  assert.equal(fresh.headers['content-length'], undefined)
})

test('bodyless statuses, undefined and serialization failures use Express handling', async () => {
  for (const status of [204, 205, 304]) {
    const result = await raw(`/empty/${status}`)
    assert.equal(result.status, status)
    assert.equal(result.body.length, 0)
    assert.equal(result.headers['content-encoding'], undefined)
  }
  assert.equal((await raw('/undefined')).body.length, 0)
  const error = await raw('/circular')
  assert.equal(error.status, 500)
  assert.equal(JSON.parse(error.body).error, true)
})
