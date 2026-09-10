// Review-only probes: real route handlers, synthetic SQLite :memory:, no dotenv/HIS/outbound calls.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mock } from 'node:test'
import { writeFileSync } from 'node:fs'
process.env.DB_PATH = ':memory:'
process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'synthetic-review-only-not-a-real-secret'
process.env.LOCAL_AUTH_BYPASS = '1'
process.env.TZ = 'Asia/Taipei'
mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-14T04:00:00Z') })
const require = createRequire(new URL('../package.json', import.meta.url))
const express = require('express')
const XLSX = require('xlsx')
const { initDatabase, closeDatabase } = await import('../src/db/init.js')
const db = initDatabase()
const auth = await import('../src/middleware/auth.js')
const patientRouter = (await import('../src/routes/patients.js')).default

const ordersRouter = (await import('../src/routes/orders.js')).default
const { applyScheduledPatientUpdates } = await import('../src/services/scheduler.js')
const users = ['alpha', 'beta'].map(name => ({ id: `synthetic-review-${name}`, username: name, name: `Synthetic ${name}`, role: 'admin', title: '管理員' }))
const tokens = await Promise.all(users.map(async user => {
  db.prepare('INSERT INTO users(id,username,password_hash,name,role,title) VALUES(?,?,?,?,?,?)').run(user.id,user.username,'synthetic-never-login',user.name,user.role,user.title)
  const token = auth.generateToken(user)
  await auth.registerSession(user.id, token, { headers: { 'user-agent': 'Review synthetic test' }, socket: { remoteAddress: '127.0.0.1' } })
  return token
}))
if (db.prepare('SELECT COUNT(*) AS n FROM active_sessions').get().n !== 2) throw new Error('Expected two registered synthetic sessions')
const app = express()
app.use(express.json({ limit: '10mb' }))
app.use('/api/patients', patientRouter)

app.use('/api/orders', ordersRouter)
const server = await new Promise(resolve => { const s = app.listen(0,'127.0.0.1', () => resolve(s)) })
const url = `http://127.0.0.1:${server.address().port}`
const realFetch = globalThis.fetch
globalThis.fetch = (...args) => { assert.ok(String(args[0]).startsWith(url + '/api/'), 'Outbound network forbidden'); return realFetch(...args) }
const api = async(method,path,body,actor=0) => {
  const response = await fetch(url + '/api' + path, { method, headers: { Authorization: `Bearer ${tokens[actor]}`, 'Content-Type':'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status:response.status, body:await response.json() }
}
const TODAY='2026-09-14', FUTURE='2026-09-15'
function patient(id, status='ipd') {
  db.prepare('INSERT INTO patients(id,medical_record_number,name,status,ward_number,dialysis_orders) VALUES(?,?,?,?,?,?)').run(id,`SYN-${id}`,`Synthetic ${id}`,status,'SYN-ward',JSON.stringify({mode:'HD',freq:'一三五',effectiveDate:'2026-09-01'}))
  return id
}
function schedule(date, id, bed=1) {
  db.prepare('INSERT INTO schedules(id,date,schedule) VALUES(?,?,?) ON CONFLICT(date) DO UPDATE SET schedule=excluded.schedule').run(date,date,JSON.stringify({[`bed-${bed}-early`]:{patientId:id,patientName:`Synthetic ${id}`}}))
}
const current = id => db.prepare('SELECT * FROM patients WHERE id=?').get(id)
const readSchedule = date => JSON.parse(db.prepare('SELECT schedule FROM schedules WHERE date=?').get(date)?.schedule || '{}')
const readEvents = () => JSON.parse(db.prepare('SELECT events FROM kidit_logbook WHERE date=?').get(TODAY)?.events || '[]')

const { subscribeEvents } = await import('../src/services/eventBus.js')
const events=[]
const unsubscribe=subscribeEvents((topic,payload)=>{ assert.equal(db.inTransaction,false,'notification must follow commit'); events.push({topic,payload}) })
const tableState=()=>Object.fromEntries(['patients','schedules','base_schedules','schedule_exceptions','nurse_assignments','daily_logs','kidit_logbook','patient_history','dialysis_orders_history','dialysis_order_uploads','tasks'].map(t=>[t,db.prepare('SELECT * FROM '+t+' ORDER BY rowid').all()]))
const exception=id=>db.prepare('INSERT INTO schedule_exceptions(id,type,status,patient_id,patient_name,to_data,date) VALUES(?,?,?,?,?,?,?)').run(id+'-exception','ADD_SESSION','applied',id,'Synthetic '+id,JSON.stringify({goalDate:FUTURE,bedNum:1,shiftCode:'early'}),FUTURE)
const failSchedule=(date)=>db.exec("CREATE TRIGGER fail_schedule BEFORE UPDATE OF schedule ON schedules WHEN OLD.date='"+date+"' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END")
const cases=[]
try {
  patient('snapshot'); schedule(TODAY,'snapshot')
  let before=tableState(); let eventCount=events.length
  failSchedule(TODAY)
  assert.equal((await api('PUT','/patients/snapshot',{status:'opd'})).status,500)
  assert.deepEqual(tableState(),before); assert.equal(events.length,eventCount)
  db.exec('DROP TRIGGER fail_schedule')
  assert.equal((await api('PUT','/patients/snapshot',{status:'opd'})).status,200)
  assert.equal(readSchedule(TODAY)['bed-1-early'].archivedPatientInfo.status,'ipd')
  cases.push('PUT snapshot rollback and retry')
  for(const method of ['DELETE','PUT']) {
    const id='delete-'+method; patient(id); schedule(TODAY,id); schedule(FUTURE,id); exception(id)
    before=tableState(); eventCount=events.length; failSchedule(FUTURE)
    const body=method==='DELETE'?{reason:'Synthetic'}:{isDeleted:true}
    assert.equal((await api(method,'/patients/'+id,body)).status,500)
    assert.deepEqual(tableState(),before); assert.equal(events.length,eventCount)
    db.exec('DROP TRIGGER fail_schedule')
    assert.equal((await api(method,'/patients/'+id,body)).status,200)
    assert.equal(current(id).is_deleted,1); assert.equal(db.prepare('SELECT id FROM schedule_exceptions WHERE id=?').get(id+'-exception'),undefined)
    assert.equal(readSchedule(TODAY)['bed-1-early'].archivedPatientInfo.status,'ipd')
    assert.equal(Object.values(readSchedule(FUTURE)).some(s=>s.patientId===id),false)
    cases.push(method+' delete rollback and retry')
  }
  patient('upload'); schedule(TODAY,'upload'); schedule(FUTURE,'upload'); exception('upload')
  const workbook=XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['病歷號','姓名','透析模式','醫囑日期'],['SYN-upload','Synthetic upload','CVVHDF','20260914']]),'Synthetic')
  const uploadBody={fileName:'synthetic-only.xlsx',fileContent:XLSX.write(workbook,{bookType:'xlsx',type:'base64'})}
  before=tableState(); eventCount=events.length; failSchedule(FUTURE)
  assert.equal((await api('POST','/orders/dialysis-orders/upload',uploadBody)).status,500)
  assert.deepEqual(tableState(),before); assert.equal(events.length,eventCount)
  db.exec('DROP TRIGGER fail_schedule')
  const upload=await api('POST','/orders/dialysis-orders/upload',uploadBody)
  assert.equal(upload.status,200); assert.equal(upload.body.writtenBackCount,1)
  assert.equal(JSON.parse(current('upload').dialysis_orders).mode,'CVVHDF')
  assert.equal(readSchedule(TODAY)['bed-1-early'].archivedPatientInfo.mode,'HD')
  assert.equal(db.prepare('SELECT id FROM schedule_exceptions WHERE id=?').get('upload-exception'),undefined)
  assert.equal(db.prepare("SELECT count(*) AS n FROM patient_history WHERE patient_id='upload' AND event_type='MODE_CHANGE'").get().n,1)
  assert.equal(readEvents().some(e=>e.patientId==='upload'),false)
  const repeat=await api('POST','/orders/dialysis-orders/upload',uploadBody)
  assert.equal(repeat.status,200); assert.equal(repeat.body.unchangedCount,1)
  db.prepare('UPDATE patients SET dialysis_orders=? WHERE id=?').run(JSON.stringify({mode:'SLED',effectiveDate:'2026-09-20'}),'upload')
  assert.equal((await api('POST','/orders/dialysis-orders/upload',uploadBody)).body.skippedNewerCount,1)
  cases.push('XLSX archive/current/history/snapshot/cleanup rollback; retry, dedup, newer-wins, KiDit exclusion')
  patient('normalize')
  db.prepare('UPDATE patients SET dialysis_orders=? WHERE id=?').run(JSON.stringify({mode:'HD',freq:'一三五',dryWeight:'63',memo:'preserve'}),'normalize')
  const normalizedBook=XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(normalizedBook,XLSX.utils.aoa_to_sheet([['病歷號','姓名','透析模式','醫囑日期','乾體重'],['SYN-normalize','Synthetic normalize','SLEDD','20260914','']]),'Synthetic')
  assert.equal((await api('POST','/orders/dialysis-orders/upload',{fileName:'normalize.xlsx',fileContent:XLSX.write(normalizedBook,{bookType:'xlsx',type:'base64'})})).status,200)
  const normalizedOrders=JSON.parse(current('normalize').dialysis_orders)
  assert.equal(normalizedOrders.mode,'SLED'); assert.equal(normalizedOrders.dryWeight,'63'); assert.equal(normalizedOrders.memo,'preserve')
  const countMovements=()=>JSON.parse(db.prepare('SELECT patient_movements FROM daily_logs WHERE date=?').get(TODAY).patient_movements).length
  const movementsBefore=countMovements()
  assert.equal((await api('PUT','/patients/normalize',{dialysisOrders:{freq:'二四六'}})).status,200)
  assert.equal(countMovements(),movementsBefore)
  cases.push('XLSX SLED normalization/empty fields preserved; frequency-only PUT has no movement')
  mock.timers.setTime(Date.parse('2026-09-13T17:00:00Z'))
  const scheduledCases=[['UPDATE_STATUS',{status:'opd'}],['UPDATE_MODE',{mode:'SLEDD'}],['UPDATE_FREQ',{freq:'二四六'}],['UPDATE_BASE_SCHEDULE_RULE',{bedNum:4,shiftIndex:1,freq:'二四六'}],['DELETE_PATIENT',{}],['RESTORE_PATIENT',{status:'opd'}]]
  for(const [type,payload] of scheduledCases) {
    const id='scheduled-'+type; patient(id); schedule(TODAY,id); schedule(FUTURE,id)
    if(type==='RESTORE_PATIENT') db.prepare('UPDATE patients SET is_deleted=1 WHERE id=?').run(id)
    db.prepare('INSERT INTO base_schedules(id,schedule) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET schedule=excluded.schedule').run('MASTER_SCHEDULE',JSON.stringify({[id]:{patientName:'Synthetic',bedNum:1,shiftIndex:0,freq:'一三五'}}))
    db.prepare('INSERT INTO scheduled_patient_updates(id,patient_id,patient_name,change_type,change_data,effective_date) VALUES(?,?,?,?,?,?)').run(id,id,'Synthetic',type,JSON.stringify(payload),TODAY)
    if(type==='DELETE_PATIENT') {
      const insertTeams=db.prepare('INSERT INTO nurse_assignments(id,date,teams) VALUES(?,?,?)')
      for(const date of ['2026-09-13',TODAY,FUTURE]) insertTeams.run(date,date,JSON.stringify({teams:{[id+'-early']:'A','unrelated-early':'B'},names:{A:'Nurse A',B:'Nurse B'},metadata:'keep'}))
      insertTeams.run('2026-09-16','2026-09-16',JSON.stringify({[id+'-early']:'A','unrelated-early':'B'}))
      exception(id)
      db.prepare('INSERT INTO schedule_exceptions(id,type,status,patient_id,date,to_data) VALUES(?,?,?,?,?,?)').run('past-scheduled','MOVE','applied',id,'2026-09-13',JSON.stringify({goalDate:'2026-09-13'}))
      db.prepare('INSERT INTO schedule_exceptions(id,type,status,patient1,patient2,date) VALUES(?,?,?,?,?,?)').run('future-swap','SWAP','pending',JSON.stringify({patientId:'unrelated'}),JSON.stringify({patientId:id}),FUTURE)
      const movementId='auto_add_session_'+id+'-exception'
      db.prepare('INSERT INTO daily_logs(id,date,patient_movements) VALUES(?,?,?)').run(FUTURE,FUTURE,JSON.stringify([{id:movementId,originalAutoId:movementId,patientId:id,type:'臨時加洗',remarks:'manual correction'}]))
    }
    before=tableState(); eventCount=events.length
    if(type==='DELETE_PATIENT') {
      failSchedule(FUTURE)
      await applyScheduledPatientUpdates()
      assert.deepEqual(tableState(),before,'scheduled later-date cleanup failure rolls back prior dates/master/patient')
      assert.equal(events.length,eventCount)
      db.exec('DROP TRIGGER fail_schedule')
      db.prepare("UPDATE scheduled_patient_updates SET status='pending' WHERE id=?").run(id)
    }
    db.exec("CREATE TRIGGER fail_processed BEFORE UPDATE OF status ON scheduled_patient_updates WHEN NEW.status='processed' BEGIN SELECT RAISE(ABORT,'synthetic processed failure'); END")
    await applyScheduledPatientUpdates()
    assert.equal(db.prepare('SELECT status FROM scheduled_patient_updates WHERE id=?').get(id).status,'failed',type)
    assert.deepEqual(tableState(),before,type+' must roll back all related tables'); assert.equal(events.length,eventCount)
    db.exec('DROP TRIGGER fail_processed')
    db.prepare("UPDATE scheduled_patient_updates SET status='pending' WHERE id=?").run(id)
    await applyScheduledPatientUpdates()
    const task=db.prepare('SELECT * FROM scheduled_patient_updates WHERE id=?').get(id)
    assert.equal(task.status,'processed',type); assert.equal(task.error_message,null)
    if(type==='UPDATE_MODE') assert.equal(JSON.parse(current(id).dialysis_orders).mode,'SLED')
    if(type==='UPDATE_FREQ'||type==='UPDATE_BASE_SCHEDULE_RULE') assert.equal(db.prepare('SELECT count(*) n FROM patient_history WHERE patient_id=?').get(id).n,0)
    if(type==='DELETE_PATIENT') {
      assert.equal(current(id).is_deleted,1); assert.equal(Object.values(readSchedule(TODAY)).some(s=>s.patientId===id),false)
      const teams=date=>JSON.parse(db.prepare('SELECT teams FROM nurse_assignments WHERE date=?').get(date).teams)
      assert.deepEqual(teams(FUTURE),{teams:{'unrelated-early':'B'},names:{A:'Nurse A',B:'Nurse B'},metadata:'keep'})
      assert.deepEqual(teams('2026-09-16'),{'unrelated-early':'B'})
      for(const date of ['2026-09-13',TODAY]) assert.equal(teams(date).teams[id+'-early'],'A')
      assert.equal(db.prepare('SELECT status FROM schedule_exceptions WHERE id=?').get('past-scheduled').status,'applied')
      assert.equal(db.prepare('SELECT id FROM schedule_exceptions WHERE id=?').get(id+'-exception'),undefined)
      assert.equal(db.prepare('SELECT id FROM schedule_exceptions WHERE id=?').get('future-swap'),undefined)
      assert.equal(JSON.parse(db.prepare('SELECT patient_movements FROM daily_logs WHERE date=?').get(FUTURE).patient_movements)[0].remarks,'manual correction')
    }
    cases.push(type+' full rollback on processed-marker failure and retry')
  }
  db.prepare('INSERT INTO scheduled_patient_updates(id,patient_id,change_type,change_data,effective_date) VALUES(?,?,?,?,?)').run('overdue','snapshot','UPDATE_MODE',JSON.stringify({mode:'CVVHDF'}),'2026-09-13')
  const prior=current('snapshot'); await applyScheduledPatientUpdates(); assert.deepEqual(current('snapshot'),prior)
  assert.equal(db.prepare('SELECT status FROM scheduled_patient_updates WHERE id=?').get('overdue').status,'failed')
  cases.push('overdue remains failed without catchup')
  patient('nonfatal-report')
  db.prepare('INSERT INTO scheduled_patient_updates(id,patient_id,change_type,change_data,effective_date) VALUES(?,?,?,?,?)').run('nonfatal-report','nonfatal-report','UPDATE_STATUS',JSON.stringify({status:'opd'}),TODAY)
  db.exec("CREATE TRIGGER fail_reporting BEFORE UPDATE ON daily_logs BEGIN SELECT RAISE(ABORT,'synthetic nonfatal reporting'); END")
  await applyScheduledPatientUpdates()
  db.exec('DROP TRIGGER fail_reporting')
  assert.equal(current('nonfatal-report').status,'opd')
  assert.equal(db.prepare('SELECT status FROM scheduled_patient_updates WHERE id=?').get('nonfatal-report').status,'processed')
  cases.push('scheduled reporting remains explicitly nonfatal after commit')
  console.log('PATIENT WRITE INTEGRITY PASS '+JSON.stringify(cases))
} finally { unsubscribe(); await new Promise(resolve=>server.close(resolve)); closeDatabase(); mock.timers.reset() }
