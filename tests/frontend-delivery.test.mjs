import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, utimes, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import express from 'express'
import { frontendDelivery } from '../src/middleware/frontendDelivery.js'

let directory, server, baseUrl
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'dialysis-frontend-delivery-'))
  await Promise.all([
    writeFile(join(directory, 'index.html'), '<!doctype html><title>Synthetic application</title>'),
    writeFile(join(directory, 'main-ABCDEFGH.js'), '/* synthetic bundle */'),
    writeFile(join(directory, 'font-ABCDEFGH.woff2'), 'synthetic font'),
    writeFile(join(directory, 'config.json'), '{}'),
  ])
  const app = express()
  app.use(frontendDelivery(directory))
  server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve))
  if (directory) {
    const location = relative(tmpdir(), directory)
    assert(location && !location.startsWith('..') && !isAbsolute(location))
    await rm(directory, { recursive: true, force: true })
  }
})

test('Angular deep links and index pages are served without stale-cache reuse', async () => {
  for (const path of ['/', '/index.html', '/my-patients', '/patients/synthetic-id']) {
    const result = await fetch(`${baseUrl}${path}`, { headers: { Accept: 'text/html' } })
    assert.equal(result.status, 200)
    assert.match(result.headers.get('cache-control'), /no-store/)
    assert.match(await result.text(), /Synthetic application/)
  }
})

test('hashed assets are immutable; mutable configuration is revalidated', async () => {
  for (const path of ['/main-ABCDEFGH.js', '/font-ABCDEFGH.woff2']) {
    const result = await fetch(`${baseUrl}${path}`)
    assert.equal(result.status, 200)
    assert.equal(result.headers.get('cache-control'), 'public, max-age=31536000, immutable')
  }
  const config = await fetch(`${baseUrl}/config.json`)
  assert.equal(config.status, 200)
  assert(!config.headers.get('cache-control').includes('immutable'))
})

test('unknown APIs return JSON 404 for every method including the bare prefix', async () => {
  for (const path of ['/api', '/api/missing']) {
    for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
      const result = await fetch(`${baseUrl}${path}`, { method })
      assert.equal(result.status, 404)
      assert.deepEqual(await result.json(), { error: true, message: '找不到指定的 API' })
    }
  }
})

test('missing assets and non-HTML requests never receive Angular HTML', async () => {
  for (const [path, accept] of [['/chunk-DELETED1.js', '*/*'], ['/missing.css', 'text/html'], ['/missing-page', 'application/json']]) {
    const result = await fetch(`${baseUrl}${path}`, { headers: { Accept: accept } })
    assert.equal(result.status, 404)
    assert(!(await result.text()).includes('Synthetic application'))
  }
})

test('version reads frontend rebuilds without restart and never caches failures', async () => {
  const first = await fetch(`${baseUrl}/api/version`)
  const firstBuild = (await first.json()).build
  const updated = new Date(Number(firstBuild) + 60_000)
  await utimes(join(directory, 'index.html'), updated, updated)
  const second = await fetch(`${baseUrl}/api/version`)
  assert.equal((await second.json()).build, String(updated.getTime()))
  assert.match(second.headers.get('cache-control'), /no-store/)
  await rm(join(directory, 'index.html'))
  const missing = await fetch(`${baseUrl}/api/version`)
  assert.equal(missing.status, 503)
  assert.equal((await missing.json()).error, true)
  assert.match(missing.headers.get('cache-control'), /no-store/)
})
