// 盤點文件樂觀鎖 + 版本歷史（2026-09-14）：
//   PUT 帶 expectedRevision 不符 → 409；沒帶 = 舊行為直接覆寫；每次儲存/刪除留一版可查、可帶回。
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const password = randomBytes(24).toString('base64url')
let folder, db, server, baseUrl, tokens
let serverOutput = ''

before(async () => {
  folder = mkdtempSync(join(tmpdir(), 'dialysis-count-lock-'))
  const dbPath = join(folder, 'synthetic.db')
  db = new Database(dbPath)
  db.exec(readFileSync(join(root, 'src/db/schema.sql'), 'utf8'))
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 5000')
  server = fork(join(root, 'tests/helpers/backend-test-server.mjs'), [], {
    execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, NODE_ENV: 'test', DB_PATH: dbPath, LOCAL_AUTH_BYPASS: '1', JWT_SECRET: randomBytes(48).toString('hex'), TEST_PASSWORD: password },
  })
  server.stdout.on('data', data => { serverOutput += data.toString() })
  server.stderr.on('data', data => { serverOutput += data.toString() })
  const ready = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Test server did not start:\n${serverOutput}`)), 30_000)
    server.on('message', message => { if (message.type === 'ready') { clearTimeout(timeout); resolve(message) } })
    server.once('error', reject)
    server.once('exit', code => { clearTimeout(timeout); reject(new Error(`Test server exited ${code}:\n${serverOutput}`)) })
  })
  tokens = ready.tokens
  baseUrl = `http://127.0.0.1:${ready.port}`
})

after(async () => {
  if (server && server.exitCode === null) {
    await new Promise(resolve => {
      const timeout = setTimeout(() => server.kill(), 5_000)
      server.once('exit', () => { clearTimeout(timeout); resolve() })
      server.send({ type: 'shutdown' })
    })
  }
  db?.close()
  if (folder) {
    const location = relative(tmpdir(), folder)
    assert(location && !location.startsWith('..') && !isAbsolute(location))
    rmSync(folder, { recursive: true, force: true })
  }
})

async function api(method, path, body, token = tokens.admin) {
  const response = await fetch(`${baseUrl}${path}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: response.status, data: await response.json() }
}

const DATE = '2026-09-10'
const doc = (ak) => ({ counts: { artificialKidney: { '15S': ak }, otherSupplies: { 'IV set': 5 } }, countBoxes: { artificialKidney: { '15S': ak / 12 } }, notes: `n${ak}` })

test('first save creates revision 1 and returns it on GET', async () => {
  const put = await api('PUT', `/api/system/inventory/counts/${DATE}`, doc(120))
  assert.equal(put.status, 200)
  assert.equal(put.data.revision, 1)
  const get = await api('GET', `/api/system/inventory/counts/${DATE}`)
  assert.equal(get.data.revision, 1)
  assert.equal(get.data.counts.otherSupplies['IV set'], 5, 'otherSupplies survives the count whitelist')
})

test('save with matching expectedRevision bumps to 2; stale expectedRevision is rejected with 409', async () => {
  const ok = await api('PUT', `/api/system/inventory/counts/${DATE}`, { ...doc(132), expectedRevision: 1 })
  assert.equal(ok.status, 200)
  assert.equal(ok.data.revision, 2)

  const stale = await api('PUT', `/api/system/inventory/counts/${DATE}`, { ...doc(999), expectedRevision: 1 })
  assert.equal(stale.status, 409)
  assert.equal(stale.data.code, 'COUNT_REVISION_CONFLICT')
  assert.equal(stale.data.currentRevision, 2)
  assert.equal(stale.data.updatedBy.name, 'Synthetic admin')
  const get = await api('GET', `/api/system/inventory/counts/${DATE}`)
  assert.equal(get.data.counts.artificialKidney['15S'], 132, 'stale write did not overwrite')
  assert.equal(get.data.revision, 2)
})

test('save without expectedRevision keeps the old overwrite behaviour', async () => {
  const put = await api('PUT', `/api/system/inventory/counts/${DATE}`, doc(144))
  assert.equal(put.status, 200)
  assert.equal(put.data.revision, 3)
})

test('history lists every save newest first with actor and content', async () => {
  const h = await api('GET', `/api/system/inventory/counts/${DATE}/history`)
  assert.equal(h.status, 200)
  assert.deepEqual(h.data.map(v => [v.revision, v.action, v.counts.artificialKidney['15S']]), [[3, 'save', 144], [2, 'save', 132], [1, 'save', 120]])
  assert.equal(h.data[0].actor.name, 'Synthetic admin')
  assert.ok(h.data[0].createdAt)
})

test('delete honours expectedRevision and records a delete version with the last content', async () => {
  const stale = await api('DELETE', `/api/system/inventory/counts/${DATE}?expectedRevision=2`)
  assert.equal(stale.status, 409)
  assert.equal((await api('GET', `/api/system/inventory/counts/${DATE}`)).status, 200, 'stale delete did nothing')

  const del = await api('DELETE', `/api/system/inventory/counts/${DATE}?expectedRevision=3`)
  assert.equal(del.status, 200)
  assert.equal((await api('GET', `/api/system/inventory/counts/${DATE}`)).status, 404)
  const h = await api('GET', `/api/system/inventory/counts/${DATE}/history`)
  assert.equal(h.data[0].action, 'delete')
  assert.equal(h.data[0].revision, 4)
  assert.equal(h.data[0].counts.artificialKidney['15S'], 144, 'delete version keeps the content for restore')
  assert.equal(h.data.length, 4)
})

test('re-creating after delete starts again at revision 1 while history is kept', async () => {
  const put = await api('PUT', `/api/system/inventory/counts/${DATE}`, doc(100))
  assert.equal(put.data.revision, 1)
  assert.equal((await api('GET', `/api/system/inventory/counts/${DATE}/history`)).data.length, 5)
})

test('invalid expectedRevision values are ignored (treated as not provided)', async () => {
  for (const bad of ['abc', -1, 0, 1.5]) {
    const put = await api('PUT', `/api/system/inventory/counts/${DATE}`, { ...doc(101), expectedRevision: bad })
    assert.equal(put.status, 200, `expectedRevision=${bad}`)
  }
})

test('viewer (書記) can save; contributor is rejected by the inventory role guard', async () => {
  assert.equal((await api('PUT', `/api/system/inventory/counts/2026-09-11`, doc(10), tokens.viewer)).status, 200)
  assert.equal((await api('PUT', `/api/system/inventory/counts/2026-09-12`, doc(10), tokens.contributor)).status, 403)
})
