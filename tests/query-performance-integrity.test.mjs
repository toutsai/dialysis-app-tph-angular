import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { mock } from 'node:test'
import express from 'express'
process.env.DB_PATH=':memory:'
process.env.NODE_ENV='test'
process.env.JWT_SECRET='synthetic-query-test-only'
process.env.LOCAL_AUTH_BYPASS='1'
process.env.TZ='Asia/Taipei'
mock.timers.enable({apis:['Date'],now:Date.parse('2026-09-20T04:00:00Z')})
const {initDatabase,closeDatabase}=await import('../src/db/init.js')
const db=initDatabase()
// Migrations use a separate connection, so :memory: fixtures also need these production DDL blocks.
const migrations=readFileSync(new URL('../src/db/migrate.js',import.meta.url),'utf8')
for(const table of ['patient_problems','patient_problem_profiles']) {
  db.exec(migrations.match(new RegExp('CREATE TABLE IF NOT EXISTS '+table+' \\([\\s\\S]*?\\n        \\)'))[0])
}
const auth=await import('../src/middleware/auth.js')
const routeUrl=new URL('../src/routes/patients.js',import.meta.url)
const source=readFileSync(routeUrl,'utf8')
// Differential oracle restores the three original query expressions, leaving domain logic identical.
let original=source.replace('CASE WHEN p.is_deleted = 1 THEN (','(').replace(') ELSE NULL END AS history_deleted_at',') AS history_deleted_at')
original=original.replace('const educationDates = getEducationDialysisDatesBatch(db, educationRequests, todayStr)','const educationDates = new Map()')
original=original.replace('(educationDates.get(r.id) || []).slice(0, total)','getEducationDialysisDates(db, r.id, firstDate, todayStr).slice(0, total)')
original=original.replace("db.prepare('SELECT date, events FROM kidit_logbook ORDER BY date DESC').iterate()","db.prepare('SELECT date, events FROM kidit_logbook ORDER BY date DESC').all()")
original=original.replace(/from (['"])([^'"]+)\1/g,(_,q,spec)=>'from '+q+(spec.startsWith('.')?new URL(spec,routeUrl).href:import.meta.resolve(spec))+q)
const baseline=(await import('data:text/javascript;base64,'+Buffer.from(original).toString('base64'))).default
const candidate=(await import(routeUrl)).default
const {getEducationDialysisDatesBatch}=await import('../src/services/patientEducationDates.js')
const getOriginalDates=new Function(source.slice(source.indexOf('function getEducationDialysisDates('),source.indexOf('// 主護反查：'))+'; return getEducationDialysisDates')()
const user={id:'synthetic-query-admin',username:'query',name:'Synthetic',role:'admin',title:'管理員'}
db.prepare('INSERT INTO users(id,username,password_hash,name,role,title) VALUES(?,?,?,?,?,?)').run(user.id,user.username,'synthetic',user.name,user.role,user.title)
const token=auth.generateToken(user)
await auth.registerSession(user.id,token,{headers:{'user-agent':'synthetic'},socket:{remoteAddress:'127.0.0.1'}})
const app=express();app.use(express.json());app.use('/baseline',baseline);app.use('/candidate',candidate)
const server=await new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server))})
const url='http://127.0.0.1:'+server.address().port
const get=async(prefix,endpoint)=>{const r=await fetch(url+'/'+prefix+endpoint,{headers:{Authorization:'Bearer '+token}});assert.equal(r.status,200);return r.json()}
const compare=async endpoint=>assert.deepEqual(await get('candidate',endpoint),await get('baseline',endpoint),endpoint)
const measure=fn=>{fn();const times=[];for(let i=0;i<5;i++){const t=performance.now();fn();times.push(performance.now()-t)}times.sort((a,b)=>a-b);return {p50Ms:+times[2].toFixed(3),p95Ms:+times[4].toFixed(3)}}
const bench=[]
try {
  const insertPatient=db.prepare('INSERT INTO patients(id,name,status,first_dialysis_date,patient_status,dialysis_orders,is_deleted,deleted_at,updated_at,medical_record_number) VALUES(?,?,?,?,?,?,?,?,?,?)')
  for(let i=0;i<16;i++) {
    const first=i===4?'invalid':i===5?'2026-10-01':i===3?'2026-09-02':'2026-09-'+String(1+i%3).padStart(2,'0')
    insertPatient.run('p'+i,'Synthetic '+i,'ipd',first,JSON.stringify({isFirstDialysis:{active:i!==6&&i!==7,date:first}}),JSON.stringify({mode:i===8?'CVVHDF':'HD',freq:'一三五'}),i===15?1:0,i===15?'2026-09-03 12:00:00':null,'2026-09-04 12:00:00','SYN-'+i)
    db.prepare('INSERT INTO patient_history(id,patient_id,event_type,timestamp) VALUES(?,?,?,?)').run('h'+i,'p'+i,'DELETE','2026-09-05T04:00:00Z')
  }
  const addSessions=(id,sessions,paper=0,done=0)=>db.prepare('INSERT INTO education_records(id,patient_id,sessions,paper_education,paper_completed) VALUES(?,?,?,?,?)').run(id,id,JSON.stringify(sessions),paper,done)
  addSessions('p0',[{dialysisDate:'2026-09-01',educatorSign:{name:'N',date:'2026-09-01'}},{dialysisDate:'2026-08-01',educatorSign:{name:'N'}},{educatorSign:{name:'N'},returnDemoSign:{name:'N'},passSign:{name:'N'}}])
  addSessions('p6',[{dialysisDate:'2026-09-03',educatorSign:{name:'N'}},{dialysisDate:'2026-09-07'},{dialysisDate:'2026-10-01'}])
  addSessions('p7',[],1,1)
  addSessions('p10',Array.from({length:12},(_,i)=>({dialysisDate:'2026-09-'+String(i+1).padStart(2,'0'),educatorSign:{name:'N'},passSign:{name:'N'}})))
  for(let day=1;day<=20;day++) {
    const date='2026-09-'+String(day).padStart(2,'0'),slots={}
    for(let p=0;p<15;p++) {
      if(p===2&&day===3) continue // missing first-day anchor
      const key=p===3&&day===2?'peripheral-1-early':'bed-'+p+'-early'
      slots[key]={patientId:'p'+p}
      if(p===1)slots['bed-99-late']={patientId:'p'+p}
    }
    db.prepare('INSERT INTO archived_schedules(id,date,schedule) VALUES(?,?,?)').run(date,date,JSON.stringify(slots))
    if(day>10)db.prepare('INSERT INTO schedules(id,date,schedule) VALUES(?,?,?)').run(date,date,JSON.stringify(slots))
    db.prepare('INSERT INTO nurse_assignments(id,date,teams) VALUES(?,?,?)').run(date,date,JSON.stringify({teams:{'p0-early':{nurseTeam:'A'},'p6-early':{nurseTeam:'B'}},names:{A:'Synthetic A',B:'Synthetic B'}}))
  }
  for(const endpoint of ['/','/?includeDeleted=true','/with-rules','/p0','/p15'])await compare(endpoint)
  db.prepare('UPDATE patients SET patient_status=? WHERE id=?').run('{malformed','p9')
  await compare('/education-list')
  const education=await get('candidate','/education-list')
  assert.equal(education.find(p=>p.patientId==='p0').expectedCount,12)
  assert.equal(education.find(p=>p.patientId==='p3').uneducatedDates.some(d=>d.date==='2026-09-02'),false)
  assert.equal(education.find(p=>p.patientId==='p2').uneducatedDates[0].date,'2026-09-03')
  assert.equal(education.find(p=>p.patientId==='p7').completed,true)
  db.prepare('INSERT INTO kidit_logbook(id,date,events) VALUES(?,?,?)').run('old','2026-09-01',JSON.stringify([{patientId:'p1',kidit_history:{selectedSystemicDiseases:['old'],dmType:'1'}}]))
  db.prepare('INSERT INTO kidit_logbook(id,date,events) VALUES(?,?,?)').run('bad','2026-09-19','{malformed')
  db.prepare('INSERT INTO kidit_logbook(id,date,events) VALUES(?,?,?)').run('new','2026-09-20',JSON.stringify([{patientId:'p0',kidit_history:{selectedSystemicDiseases:[]}},{patientId:'p0',kidit_history:{selectedSystemicDiseases:['new'],otherSystemicDescription:'first'}},{patientId:'p0',kidit_history:{selectedSystemicDiseases:['later-same-day']}}]))
  for(const id of ['p0','p1','p14'])await compare('/'+id+'/problem-list')

  // Real route behavior compared above; query timing uses synthetic history without adding indexes/statistics.
  const candidateColumns=source.match(/const PATIENT_SELECT_COLUMNS = `([\s\S]*?)`/)[1]
  const baselineColumns=candidateColumns.replace('CASE WHEN p.is_deleted = 1 THEN (','(').replace(') ELSE NULL END',')')
  for(const [patients,history] of [[300,36],[1000,120]]) {
    db.exec('DELETE FROM patient_history; DELETE FROM education_records; DELETE FROM patients')
    const ins=db.prepare('INSERT INTO patients(id,name,medical_record_number) VALUES(?,?,?)'),hist=db.prepare('INSERT INTO patient_history(id,patient_id,event_type,timestamp) VALUES(?,?,?,?)')
    db.transaction(()=>{for(let i=0;i<patients;i++){ins.run('p'+i,'Synthetic '+i,'SYN-'+i);for(let h=0;h<history;h++)hist.run(i+'-'+h,'p'+i,h%10?'UPDATE':'DELETE','2026-09-01 12:00:00')}})()
    const old=db.prepare('SELECT '+baselineColumns+' FROM patients p WHERE p.is_deleted=0 ORDER BY p.name')
    const next=db.prepare('SELECT '+candidateColumns+' FROM patients p WHERE p.is_deleted=0 ORDER BY p.name')
    assert.deepEqual(next.all(),old.all().map(r=>({...r,history_deleted_at:null})))
    bench.push({name:'active patients',patients,historyRows:patients*history,baseline:measure(()=>old.all()),candidate:measure(()=>next.all())})
  }
  db.exec('DELETE FROM schedules; DELETE FROM archived_schedules')
  const archived=db.prepare('INSERT INTO archived_schedules(id,date,schedule) VALUES(?,?,?)')
  const dateOf=d=>new Date(Date.UTC(2025,0,1+d)).toISOString().slice(0,10)
  db.transaction(()=>{for(let d=0;d<365;d++){const slots={};for(let n=0;n<132;n++)slots['bed-'+n+'-early']={patientId:'p'+((d*11+n)%300)};archived.run(dateOf(d),dateOf(d),JSON.stringify(slots))}})()
  const requests=Array.from({length:24},(_,i)=>({patientId:'p'+i,firstDate:dateOf(i*3)}))
  const oldDates=()=>new Map(requests.map(r=>[r.patientId,getOriginalDates(db,r.patientId,r.firstDate,dateOf(364))]))
  const newDates=()=>getEducationDialysisDatesBatch(db,requests,dateOf(364))
  assert.deepEqual(newDates(),oldDates())
  for(const request of requests) assert.deepEqual(getEducationDialysisDatesBatch(db,[request],dateOf(364)).get(request.patientId),getOriginalDates(db,request.patientId,request.firstDate,dateOf(364)))
  assert.deepEqual(getEducationDialysisDatesBatch(db,[],dateOf(364)),new Map())
  bench.push({name:'education individual start dates',patients:24,days:365,slotsPerDay:132,baseline:measure(oldDates),candidate:measure(newDates)})
  db.exec('DELETE FROM kidit_logbook')
  const insertLog=db.prepare('INSERT INTO kidit_logbook(id,date,events) VALUES(?,?,?)')
  db.transaction(()=>{for(let d=0;d<3650;d++)insertLog.run(dateOf(d),dateOf(d),JSON.stringify(Array.from({length:20},(_,i)=>({patientId:'p'+i,kidit_history:{selectedSystemicDiseases:['synthetic'],otherSystemicDescription:'x'.repeat(500)}}))))})()
  const stmt=db.prepare('SELECT date,events FROM kidit_logbook ORDER BY date DESC')
  const hit=rows=>{for(const row of rows)for(const event of JSON.parse(row.events))if(event.patientId==='p1')return event}
  assert.deepEqual(hit(stmt.all()),hit(stmt.iterate()))
  bench.push({name:'latest KiDit match',days:3650,baseline:measure(()=>hit(stmt.all())),candidate:measure(()=>hit(stmt.iterate()))})
  console.log('QUERY PERFORMANCE INTEGRITY PASS '+JSON.stringify(bench))
} finally {await new Promise(resolve=>server.close(resolve));closeDatabase();mock.timers.reset()}
