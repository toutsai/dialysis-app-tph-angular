import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import XLSX from '../src/utils/spreadsheet.js'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const password = randomBytes(24).toString('base64url')
let folder, db, server, baseUrl, tokens, today
let serverOutput = ''
const events = []

before(async () => {
  folder = mkdtempSync(join(tmpdir(), 'dialysis-integrity-'))
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
    server.on('message', message => {
      if (message.type === 'event') events.push(message)
      if (message.type === 'ready') { clearTimeout(timeout); resolve(message) }
    })
    server.once('error', reject)
    server.once('exit', code => { clearTimeout(timeout); reject(new Error(`Test server exited ${code}:\n${serverOutput}`)) })
  })
  tokens = ready.tokens
  today = ready.today
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

test('count cutoff, validation, revisions, immutable versions and tombstone', async () => {
  const path = '/api/system/inventory/counts/2026-08-20'
  assert.equal((await api('PUT',path,{counts:{artificialKidney:{A:''}}})).status,400)
  assert.equal((await api('PUT',path,{counts:{artificialKidney:{A:-1}}})).status,400)
  let result = await api('PUT',path,{counts:{artificialKidney:{A:0}},cutoff:'end-of-day',countType:'both',expectedRevision:0})
  assert.equal(result.status,200)
  assert.equal(result.data.cutoff,'end-of-day')
  assert.equal(result.data.countType,'both')
  assert.equal(result.data.revision,1)
  assert.equal((await api('PUT',path,{counts:{}})).status,409)
  assert.equal((await api('DELETE',path)).status,409)
  assert.equal((await api('PUT',path,{counts:{},expectedRevision:0})).status,409)
  assert.equal((await api('DELETE',path,{expectedRevision:0})).status,409)
  assert.equal((await api('DELETE',path,{expectedRevision:1})).status,200)
  assert.equal((await api('PUT',path,{counts:{},expectedRevision:0})).status,409)
  assert.equal((await api('GET',path)).data.revision,2)
  result = await api('PUT',path,{counts:{artificialKidney:{A:3}},expectedRevision:2})
  assert.equal(result.status,200)
  assert.equal(result.data.revision,3)
  assert.equal(result.data.cutoff,'start-of-day')
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM inventory_count_versions WHERE count_date=?').get('2026-08-20').n,3)
})

test('purchase batch retries replay IDs, payload collision rejects, failed batch rolls back', async () => {
  const body = {idempotencyKey:'order-1',entries:[{item:'A',category:'artificialKidney',quantity:10,expectedDate:'2026-09-20'}]}
  const first = await api('POST','/api/system/inventory/purchases/batch',body)
  assert.equal(first.status,201)
  assert.deepEqual((await api('POST','/api/system/inventory/purchases/batch',body)).data,first.data)
  assert.equal((await api('POST','/api/system/inventory/purchases/batch',{...body,entries:[{...body.entries[0],quantity:11}]})).status,409)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM inventory_purchases').get().n,1)
  assert.equal((await api('POST','/api/system/inventory/purchases/batch',{entries:[body.entries[0],{item:'B'}]})).status,400)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM inventory_purchases').get().n,1)
})

function upload(start,end,rows,extra={}) {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['HIS'],[`&起日${start}&迄日${end}`],['病歷號','人工腎臟','COUNT(*)'],...rows]),'Sheet1')
  return api('POST','/api/orders/consumables/upload',{fileName:'test.xlsx',fileContent:XLSX.write(workbook,{type:'base64',bookType:'xlsx'}),...extra})
}

test('HIS exact source replacement removes missing patients; partial overlap rejects; empty requires explicit confirmation', async () => {
  for (const id of ['p1','p2']) db.prepare('INSERT INTO patients (id,name,medical_record_number) VALUES (?,?,?)').run(id,id,id)
  let result = await upload('20260801','20260801',[['p1','A',2],['p2','A',3]],{completeCategory:true})
  assert.equal(result.status,200,JSON.stringify(result.data))
  result = await upload('20260801','20260801',[['p1','A',1]],{completeCategory:true})
  assert.equal(result.status,200)
  const removed = JSON.parse(db.prepare("SELECT report_data FROM consumables_reports WHERE patient_id='p2'").get().report_data)
  assert.deepEqual(removed.ranges['20260801-20260801'].artificialKidney,[])
  assert.equal((await upload('20260801','20260803',[['p1','A',4]])).status,409)
  assert.equal((await upload('20260230','20260230',[['p1','A',4]])).status,400)
  assert.equal((await upload('20260802','20260802',[['p1','A',-2]])).status,400)
  assert.equal((await upload('20260801','20260801',[],{completeCategory:true})).status,400)
  assert.equal((await upload('20260801','20260801',[],{completeCategory:true,confirmEmptyCategory:true})).status,200)
  const coverage = await api('GET','/api/orders/consumables/coverage')
  assert.equal(coverage.data[0].complete,true)
  assert.equal(coverage.data[0].startDate,'20260801')
  assert.equal((await upload('20260804','20260804',[['missing','A',3]],{completeCategory:true,confirmEmptyCategory:true})).status,200)
  const incomplete = (await api('GET','/api/orders/consumables/coverage')).data.find(x=>x.startDate==='20260804')
  assert.equal(incomplete.complete,false)
})


test('legacy monthly totals do not block unrelated future daily imports', async () => {
  db.prepare('INSERT INTO consumables_reports (id,patient_id,report_date,report_data) VALUES (?,?,?,?)').run('legacy-june','p1','2026-06-01',JSON.stringify({artificialKidney:[{item:'A',count:7}]}))
  assert.equal((await upload('20260910','20260910',[['p1','A',2]])).status,200)
  assert.equal((await upload('20260610','20260610',[['p1','A',2]])).status,409)
})


test('purchase input validates finite quantities and real dates for create, batch and update', async () => {
  const path = '/api/system/inventory/purchases'
  const valid = {item:'A',category:'artificialKidney',quantity:4,date:'2026-09-14'}
  for (const patch of [{quantity:-8},{quantity:true},{quantity:null},{quantity:''},{quantity:'NaN'},{boxQuantity:-1},{boxQuantity:true},{date:'2026-02-30'},{date:null},{orderDate:'2026-13-01'}]) {
    assert.equal((await api('POST',path,{...valid,...patch})).status,400,JSON.stringify(patch))
  }
  const created = await api('POST',path,valid)
  assert.equal(created.status,201)
  for (const patch of [{quantity:-1},{boxQuantity:false},{date:'2026-02-30'},{date:null},{expectedDate:'invalid'}]) {
    assert.equal((await api('PUT',`${path}/${created.data.id}`,patch)).status,400,JSON.stringify(patch))
  }
  assert.equal((await api('PUT',`${path}/${created.data.id}`,{quantity:0})).status,200)
  const ordered = await api('POST',path,{...valid,status:'ordered',date:null,expectedDate:'2026-09-20'})
  assert.equal(ordered.status,201)
  assert.equal((await api('PUT',`${path}/${ordered.data.id}`,{status:'arrived'})).status,400)
  assert.equal((await api('PUT',`${path}/${ordered.data.id}`,{status:'arrived',date:'2026-09-20'})).status,200)
  const before = db.prepare('SELECT COUNT(*) AS n FROM inventory_purchases').get().n
  assert.equal((await api('POST',`${path}/batch`,{entries:[{...valid,status:'arrived'},{...valid,status:'arrived',quantity:-1}]})).status,400)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM inventory_purchases').get().n,before)
})

test('boolean HIS count is rejected without creating complete coverage', async () => {
  assert.equal((await upload('20260911','20260911',[['p1','A',true]],{completeCategory:true})).status,400)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM consumables_import_sources WHERE range_key='20260911-20260911'").get().n,0)
})


test('atomic stock source snapshot preserves report and coverage shapes including legacy reports', async () => {
  const snapshot = await api('GET','/api/orders/consumables/stock-sources')
  assert.equal(snapshot.status,200)
  assert.deepEqual(snapshot.data.reports,(await api('GET','/api/orders/consumables')).data)
  assert.deepEqual(snapshot.data.coverage,(await api('GET','/api/orders/consumables/coverage')).data)
  assert(snapshot.data.reports.some(row => row.id === 'legacy-june'))
  assert(!snapshot.data.coverage.some(row => row.startDate.startsWith('202606')))
  assert.equal((await api('GET','/api/orders/consumables/stock-sources',undefined,tokens.contributor)).status,403)
})


test('notes-only purchase update preserves unchanged legacy ISO date', async () => {
  const id = randomUUID()
  const itemId = db.prepare('SELECT id FROM inventory_items LIMIT 1').get().id
  db.prepare('INSERT INTO inventory_purchases (id,item_id,quantity,purchase_date,status) VALUES (?,?,?,?,?)').run(id,itemId,3,'2026-09-01T00:00:00Z','arrived')
  assert.equal((await api('PUT',`/api/system/inventory/purchases/${id}`,{notes:'checked'})).status,200)
  assert.equal((await api('PUT',`/api/system/inventory/purchases/${id}`,{date:'2026-09-01T00:00:00Z'})).status,400)
})
