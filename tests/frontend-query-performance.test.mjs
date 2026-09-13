import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'
process.env.DB_PATH = ':memory:'
process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'synthetic-frontend-query-test-secret'
process.env.TZ = 'Asia/Taipei'
const { initDatabase } = await import('../src/db/init.js')
const db = initDatabase()
const auth = await import('../src/middleware/auth.js')
const { default: express } = await import('express')
const app = express(); app.use('/orders', (await import('../src/routes/orders.js')).default)
const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
const user = { id: 'perf-admin', username: 'perf-admin', name: 'Synthetic', role: 'admin', title: '管理員' }
db.prepare('INSERT INTO users(id,username,password_hash,name,role,title) VALUES(?,?,?,?,?,?)').run(user.id,user.username,'unused',user.name,user.role,user.title)
const token = auth.generateToken(user)
await auth.registerSession(user.id, token, { headers: {}, socket: { remoteAddress: '127.0.0.1' } })
const base = `http://127.0.0.1:${server.address().port}/orders`
const requireAngular = createRequire(new URL('../angular-client/package.json', import.meta.url))
const ts = requireAngular('typescript')
const signal = initial => { let value = initial; const fn = () => value; fn.set = v => { value = v }; fn.update = f => { value = f(value) }; return fn }
const plain = value => JSON.parse(JSON.stringify(value))
function methods(relative, names, globals = {}) {
  const filename = new URL('../angular-client/src/app/' + relative, import.meta.url)
  const source = readFileSync(filename, 'utf8')
  const ast = ts.createSourceFile(filename.pathname, source, ts.ScriptTarget.ES2022, true)
  const cls = ast.statements.find(ts.isClassDeclaration)
  const members = names.map(name => { const m = cls.members.find(m => m.name?.getText(ast) === name); assert.ok(m, name); return m.getText(ast) })
  const out = ts.transpileModule(`class Subject { ${members.join('\n')} }; module.exports=Subject`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } })
  const module = { exports: {} }
  vm.runInNewContext(out.outputText, { module, console, Date, JSON, Map, WeakMap, Set, Object, ...globals })
  return new module.exports()
}
const metrics = { scope: 'Synthetic in-memory DB; actual Express HTTP response body bytes, uncompressed. Angular IterableDiffer identity proxy, not browser DOM/FPS/INP.', history: {}, labs: {}, identity: {} }
async function get(path, params = {}) {
  const res = await fetch(base + path + '?' + new URLSearchParams(params), { headers: { Authorization: `Bearer ${token}` } })
  assert.equal(res.status, 200)
  const text = await res.text()
  return { rows: JSON.parse(text), bytes: Buffer.byteLength(text) }
}
let checks = 0
try {
  const insertPatient = db.prepare('INSERT INTO patients(id,name,medical_record_number) VALUES(?,?,?)')
  const insertHistory = db.prepare('INSERT INTO dialysis_orders_history(id,patient_id,orders,created_at,updated_at) VALUES(?,?,?,?,?)')
  const insertLab = db.prepare('INSERT INTO lab_reports(id,patient_id,report_date,results) VALUES(?,?,?,?)')
  const order = JSON.stringify({ mode: 'HD', description: 'synthetic '.repeat(100) })
  const labs = JSON.stringify({ Hb: 8, Albumin: 3, Ca: 10, P: 7, BUN: 80, PostBUN: 40, note: 'synthetic '.repeat(70) })
  const patients = Array.from({ length: 300 }, (_, i) => ({ id: 'p' + i, name: 'Synthetic ' + i }))
  db.transaction(() => {
    for (const p of patients) {
      insertPatient.run(p.id, p.name, p.id)
      for (let month = 0; month < 36; month++) {
        const date = new Date(Date.UTC(2023, month, 15)).toISOString().slice(0, 10)
        const stamp = date + ' 12:00:00'
        insertHistory.run(p.id + '-' + month, p.id, order, stamp, month === 0 ? '2099-01-01 12:00:00' : stamp)
        insertLab.run(p.id + '-' + month, p.id, date, labs)
      }
    }
    for (const date of ['2024-11-30','2024-12-01','2025-02-28','2025-03-01','2024-02-29','2024-03-01']) insertLab.run('edge-' + date,'p0',date,labs)
  })()
  const allHistory = await get('/history')
  const scopedHistory = await get('/history', { patientId: 'p1' })
  const modal = methods('components/dialogs/dialysis-order-modal/dialysis-order-modal.component.ts', ['fetchOrderHistory'])
  let historyCalls = 0
  Object.assign(modal, { historyRequest: 0, ordersHistoryApi: { fetchWhere: async params => { historyCalls++; assert.deepEqual(plain(params), { patientId: 'p1' }); return scopedHistory.rows } } })
  await modal.fetchOrderHistory('p1')
  const beforeHistory = allHistory.rows.filter(r => r.patientId === 'p1').sort((a,b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')).slice(0,20)
  assert.deepEqual(plain(modal.orderHistory), beforeHistory)
  assert.equal(modal.orderHistory[0].id, 'p1-0', 'recently edited older-created record must remain visible')
  assert.equal(historyCalls, 1)
  metrics.history = { totalRows: allHistory.rows.length, scopedRows: scopedHistory.rows.length, beforeBytes: allHistory.bytes, afterBytes: scopedHistory.bytes, visibleRows: modal.orderHistory.length, requests: historyCalls }; checks++
  let resolveOld
  modal.ordersHistoryApi.fetchWhere = ({ patientId }) => patientId === 'old' ? new Promise(resolve => { resolveOld = resolve }) : Promise.resolve([{patientId:'new',id:'new',updatedAt:'2026'}])
  const old = modal.fetchOrderHistory('old'); await modal.fetchOrderHistory('new'); resolveOld([{patientId:'old',id:'old'}]); await old
  assert.equal(modal.orderHistory[0].patientId, 'new'); checks++

  const allLabs = await get('/lab-reports')
  const scopedLabs = await get('/lab-reports', { startDate: '2024-12-01', endDate: '2025-02-28' })
  assert.deepEqual(scopedLabs.rows, allLabs.rows.filter(r => r.reportDate >= '2024-12-01' && r.reportDate < '2025-03-01'))
  metrics.labs = { totalRows: allLabs.rows.length, scopedRows: scopedLabs.rows.length, beforeBytes: allLabs.bytes, afterBytes: scopedLabs.bytes }; checks++
  const makeLab = query => {
    const p = methods('features/lab-reports/lab-reports.component.ts', ['generateAlertReport','processReports','findAbnormalities','CONSECUTIVE_ABNORMAL_CRITERIA'], { queryWithInChunks: async () => [], alert: () => {} })
    Object.assign(p, { alertRequest: 0, isLoadingAlerts: signal(false), alertList: signal([]), alertMonthRange: () => ({start:'2024-12',end:'2025-02'}), patientStore: {fetchPatientsIfNeeded:async()=>{},opdPatients:()=>patients}, baseSchedulesApi:{fetchById:async()=>({schedule:{}})}, labReportsApi:{fetchWhere:query} })
    return p
  }
  const beforeLab = makeLab(async () => allLabs.rows)
  const afterLab = makeLab(async params => { assert.deepEqual(plain(params), { startDate:'2024-12-01',endDate:'2025-02-28' }); return scopedLabs.rows })
  await beforeLab.generateAlertReport(); await afterLab.generateAlertReport()
  assert.deepEqual(plain(afterLab.alertList()), plain(beforeLab.alertList()))
  assert.equal(afterLab.alertList().length, 300); checks++
  for (const [range, expectedEnd] of [[{start:'2023-12',end:'2024-02'},'2024-02-29'],[{start:'2024-02',end:'2024-04'},'2024-04-30'],[{start:'2024-10',end:'2024-12'},'2024-12-31']]) {
    const p = makeLab(async params => { assert.equal(params.startDate,range.start+'-01'); assert.equal(params.endDate,expectedEnd); return [] })
    p.alertMonthRange = () => range; await p.generateAlertReport()
  }; checks++
  let releasePatient
  const capture = makeLab(async params => { assert.equal(params.startDate,'2024-12-01'); return [] })
  capture.patientStore.fetchPatientsIfNeeded = () => new Promise(resolve => { releasePatient = resolve })
  const started = capture.generateAlertReport(); capture.alertMonthRange = () => ({start:'2025-01',end:'2025-03'}); releasePatient(); await started; checks++
  let releaseOldLab
  const race = makeLab(({startDate}) => startDate === '2024-12-01' ? new Promise(resolve => { releaseOldLab = resolve }) : Promise.resolve([]))
  const pendingLab = race.generateAlertReport(); await new Promise(resolve=>setImmediate(resolve))
  race.alertMonthRange = () => ({start:'2025-01',end:'2025-03'}); await race.generateAlertReport()
  releaseOldLab(scopedLabs.rows); await pendingLab; assert.equal(race.alertList().length,0); checks++

  const n = methods('features/nursing-schedule/nursing-schedule.component.ts', ['monthDays','objectEntries','trackByDay','trackByNurseId','filteredSortedSchedule'])
  Object.assign(n, { monthDaysKey:'',cachedMonthDays:[],entriesCache:new WeakMap(),isGroupEditMode:()=>false,selectedMonth:'2024-02',monthlySchedule:{yearMonth:'2024-02'},shiftFilter:signal('all'),activeWeekTab:()=>1 })
  const days = n.monthDays; assert.equal(days.length,29); assert.equal(n.monthDays,days)
  n.monthlySchedule.maxDaysInMonth=28; assert.equal(n.monthDays.length,28)
  delete n.monthlySchedule.maxDaysInMonth; n.monthlySchedule.yearMonth='2025-02'; assert.equal(n.monthDays.length,28); assert.notEqual(n.monthDays,days)
  const nurses = Object.fromEntries(Array.from({length:40},(_,i)=>['n'+i,{shifts:['day'],nurseName:'Synthetic'+i}]))
  const entries = n.objectEntries(nurses); assert.equal(n.objectEntries(nurses),entries)
  nurses.n0.shifts[0]='night'; assert.equal(n.objectEntries(nurses),entries); assert.equal(entries[0][1].shifts[0],'night')
  nurses.n0 = {shifts:['day']}; assert.notEqual(n.objectEntries(nurses),entries)
  n.sortedSchedule=nurses; n.weeklyData=[{days:[{isCurrentMonth:true,dayIndex:0}]}]; n.isDayShift=s=>s==='day'; n.isNightShift=s=>s==='night'; n.is128Shift=s=>s==='12-8'
  n.shiftFilter.set('night'); assert.equal(Object.keys(n.filteredSortedSchedule).length,0)
  nurses.n0.shifts[0]='night'; assert.equal(Object.keys(n.filteredSortedSchedule).length,1)
  nurses.n0.shifts[0]='12-8'; n.shiftFilter.set('day'); assert.equal(Object.keys(n.filteredSortedSchedule).length,40); checks++
  const { DefaultIterableDiffer } = await import(pathToFileURL(requireAngular.resolve('@angular/core')).href)
  const added = differ => { let count=0; differ.forEachAddedItem(()=>count++); return count }
  const oldRows = new DefaultIterableDiffer(); oldRows.diff(Object.entries(nurses)); oldRows.diff(Object.entries(nurses))
  const newRows = new DefaultIterableDiffer(n.trackByNurseId); newRows.diff(n.objectEntries(nurses)); newRows.diff(n.objectEntries(nurses))
  const oldDays = new DefaultIterableDiffer(); oldDays.diff(days.map(x=>({...x}))); oldDays.diff(days.map(x=>({...x})))
  const newDays = new DefaultIterableDiffer(n.trackByDay); newDays.diff(n.monthDays); newDays.diff(n.monthDays)
  metrics.identity = { fixtureNurses:40, beforeRowAdditions:added(oldRows), afterRowAdditions:added(newRows), beforeDayAdditions:added(oldDays), afterDayAdditions:added(newDays), method:'Actual Angular DefaultIterableDiffer; stable-node reuse proxy, no browser rendering' }
  assert.equal(metrics.identity.beforeRowAdditions,40); assert.equal(metrics.identity.afterRowAdditions,0); assert.equal(metrics.identity.afterDayAdditions,0); checks++
  const html=readFileSync(new URL('../angular-client/src/app/features/nursing-schedule/nursing-schedule.component.html',import.meta.url),'utf8')
  assert.match(html,/@for\s*\(entry of objectEntries\(sortedSchedule\); track trackByNurseId\(\$index, entry\)\)/)
  assert.equal((html.match(/track trackByDay\((?:\$index|i|dayIdx), dayInfo\)/g)||[]).length,4)
  assert.match(html,/@for\s*\(dayInfo of monthDays; track trackByDay\(i, dayInfo\); let i = \$index\)/)
  assert.equal((html.match(/@for\s*\(dayInfo of weekData\.days; track trackByDay\(dayIdx, dayInfo\); let dayIdx = \$index\)/g)||[]).length,2)
  assert.ok(metrics.history.afterBytes < metrics.history.beforeBytes/100)
  assert.ok(metrics.labs.afterBytes < metrics.labs.beforeBytes/5)
  if(process.env.PERFORMANCE_OUTPUT) writeFileSync(process.env.PERFORMANCE_OUTPUT,JSON.stringify(metrics,null,2))
  console.log('METRICS',JSON.stringify(metrics))
  console.log(`PASS frontend-query-performance: ${checks} parity/ownership/identity scenarios`)
} finally { await new Promise(resolve => server.close(resolve)) }
