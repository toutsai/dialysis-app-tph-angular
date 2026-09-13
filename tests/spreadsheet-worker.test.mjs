import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import XLSX from '../src/utils/spreadsheet.js'
import { createSpreadsheetParser, parseFirstSheet } from '../src/services/spreadsheetParser.js'
import { parseInpatients, parseInpatientsRows, parseLabs, parseLabsRows } from '../src/services/akiService.js'

const parser = createSpreadsheetParser()
const makeBook = (rows, bookType = 'xlsx') => {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), '第一張')
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['ignored second sheet']]), '第二張')
  return XLSX.write(book, { type: 'buffer', bookType, compression: true })
}
const syncParse = (buffer, options) => {
  const book = XLSX.read(buffer, { type: 'buffer' })
  return XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], options)
}
const optionsList = [{ header: 1 }, { header: 1, defval: '', raw: false }, { header: 1, defval: '', raw: false, dateNF: 'YYYY-MM-DD' }]
try {
  for (const type of ['xlsx', 'xls']) {
    const buffer = makeBook([['病歷號', '日期', '數字', '空欄'], ['0000123', new Date('2026-09-01T00:00:00Z'), 12.3], [], ['中文', null, false, '尾欄']], type)
    const original = Buffer.from(buffer)
    for (const options of optionsList) assert.deepEqual(await parser.parse(buffer, options), syncParse(buffer, options), type + JSON.stringify(options))
    assert.deepEqual(Buffer.from(buffer), original, 'caller buffer bytes must not be detached or changed')
  }
  // AKI's domain adapters retain the existing synchronous parser output exactly.
  const inpatientRows = [['護理站','住院號','切帳號','留院日','科別碼','科別','醫師','床號','病歷號','姓名','年齡','性別','入院日','出院日','主診斷碼','診斷名稱','轉歸'], ['W','A','','','','腎臟','D','1','0000123','合成','60','男','20260901','','N18','CKD','']]
  const longLabRows = [['來源','病歷號','姓名','報告日','醫令','細項名稱','結果'], ['住院','0000123','合成','20260901','CR','Creatinine','2.3'], ['住院','0000123','合成','20260901','EGFR','腎絲球過濾率','24']]
  const wideLabRows = [['病歷號','姓名','性別','年齡','主治醫師','病床號','住院日期','門診檢驗日期','門診醫令','門診檢驗數值','急診檢驗日期','急診醫令','急診檢驗數值','住院檢驗日期','住院醫令','住院檢驗數值'], ['0000123','合成','男',60,'D','1','20260901','20260901','CR','2.3','','','','20260903','CR','3.2']]
  for (const [rows, oldParse, newParse] of [[inpatientRows,parseInpatients,parseInpatientsRows],[longLabRows,parseLabs,parseLabsRows],[wideLabRows,parseLabs,parseLabsRows]]) {
    const buffer=makeBook(rows)
    assert.deepEqual(newParse(await parser.parse(buffer, optionsList[1])), oldParse(buffer))
  }
  const malformed=Buffer.from([0x50,0x4b,0x03,0x04,0,0,0,0])
  let synchronousError
  try { syncParse(malformed, optionsList[0]) } catch (error) { synchronousError=error.message }
  assert.ok(synchronousError)
  await assert.rejects(parser.parse(malformed), error=>error.message===synchronousError)
  assert.deepEqual(await parser.parse(makeBook([['recovered']])), [['recovered']])

  // Controlled worker proves queue limit, crash/timeout replacement, and idle cleanup.
  const workerUrl=new URL('data:text/javascript,'+encodeURIComponent(`
    import {parentPort,threadId} from 'node:worker_threads';
    parentPort.on('message', ({id,bytes}) => {
      if(bytes[0]===1) process.exit(1);
      if(bytes[0]===2) return;
      setTimeout(()=>parentPort.postMessage({id,rows:[[bytes[0],threadId]]}), bytes[0]===3?100:0);
    });`))
  const controlled=createSpreadsheetParser({workerUrl,maxQueued:2,timeoutMs:500,idleMs:25})
  try {
    const accepted=[controlled.parse(Buffer.from([3])),controlled.parse(Buffer.from([4])),controlled.parse(Buffer.from([5]))]
    await assert.rejects(controlled.parse(Buffer.from([6])),error=>error.status===503)
    const results=await Promise.all(accepted)
    assert.deepEqual(results.map(r=>r[0][0]),[3,4,5]); assert.equal(new Set(results.map(r=>r[0][1])).size,1)
    const crash=controlled.parse(Buffer.from([1])); const afterCrash=controlled.parse(Buffer.from([4]))
    await assert.rejects(crash,error=>error.status===503)
    assert.equal((await afterCrash)[0][0],4)
    const hang=controlled.parse(Buffer.from([2])); const afterTimeout=controlled.parse(Buffer.from([5]))
    await assert.rejects(hang,error=>error.status===503)
    const recovered=await afterTimeout; assert.equal(recovered[0][0],5)
    await delay(100)
    assert.notEqual((await controlled.parse(Buffer.from([4])))[0][1],recovered[0][1],'idle parser must be replaced')
  } finally { controlled.close() }
  await assert.rejects(controlled.parse(Buffer.from([4])),error=>error.status===503)

  const measurements=[]
  for (const count of [10000,50000]) {
    const buffer=makeBook(Array.from({length:count},(_,i)=>[i,'Synthetic '+i,'x'.repeat(30),'2026-01-01',12.3,'A']))
    const expected=syncParse(buffer,optionsList[0]); await parser.parse(buffer,optionsList[0])
    for (const mode of ['sync','worker']) {
      const times=[],lags=[]
      for(let i=0;i<5;i++) {
        const started=performance.now()
        const timer=new Promise(resolve=>setTimeout(()=>resolve(performance.now()-started),0))
        const rows=mode==='sync'?syncParse(buffer,optionsList[0]):await parser.parse(buffer,optionsList[0])
        times.push(performance.now()-started); lags.push(await timer)
        assert.deepEqual(rows,expected)
      }
      const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1]
      measurements.push({rows:count,mode,fileBytes:buffer.length,responseBytes:Buffer.byteLength(JSON.stringify(expected)),runs:5,p50Ms:+percentile(times,.5).toFixed(2),p95Ms:+percentile(times,.95).toFixed(2),timerP50Ms:+percentile(lags,.5).toFixed(2),timerP95Ms:+percentile(lags,.95).toFixed(2)})
    }
  }
  console.log('SPREADSHEET WORKER PASS '+JSON.stringify(measurements))
  // Actual upload routers must return recoverable 503, with no database writes when the shared queue is full.
  process.env.DB_PATH=':memory:';process.env.NODE_ENV='test';process.env.JWT_SECRET='synthetic-worker-http-only';process.env.LOCAL_AUTH_BYPASS='1'
  const {initDatabase,closeDatabase}=await import('../src/db/init.js')
  const db=initDatabase()
  const auth=await import('../src/middleware/auth.js')
  const express=(await import('express')).default
  const app=express();app.use(express.json({limit:'20mb'}))
  app.use('/api/orders',(await import('../src/routes/orders.js')).default)
  app.use('/api/nursing',(await import('../src/routes/nursing.js')).default)
  app.use('/api/aki',(await import('../src/routes/aki.js')).default)
  app.get('/probe',(_,res)=>res.json({ok:true}))
  const user={id:'synthetic-worker-admin',username:'worker',name:'Synthetic',role:'admin',title:'管理員'}
  db.prepare('INSERT INTO users(id,username,password_hash,name,role,title) VALUES(?,?,?,?,?,?)').run(user.id,user.username,'synthetic',user.name,user.role,user.title)
  const token=auth.generateToken(user)
  await auth.registerSession(user.id,token,{headers:{'user-agent':'synthetic'},socket:{remoteAddress:'127.0.0.1'}})
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))})
  try {
    const url='http://127.0.0.1:'+server.address().port
    const large=makeBook(Array.from({length:50000},(_,i)=>[i,'Synthetic','x'.repeat(30),'2026-09-01',12.3,'A']))
    const blockers=[parseFirstSheet(large),parseFirstSheet(large),parseFirstSheet(large)]
    const data=makeBook([['synthetic']]).toString('base64')
    const routes=['/orders/lab-reports/upload','/orders/medications/upload','/orders/dialysis-orders/upload','/nursing/schedules/upload','/aki/upload/inpatients','/aki/upload/labs']
    const before=db.prepare('SELECT COUNT(*) n FROM patients').get().n
    const start=performance.now()
    const responses=await Promise.all(routes.map(route=>fetch(url+'/api'+route,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({fileName:'synthetic.xlsx',fileContent:data,fileContentBase64:data})})))
    for(let i=0;i<responses.length;i++){assert.equal(responses[i].status,503,routes[i]);assert.equal((await responses[i].json()).error,true)}
    assert.deepEqual(await (await fetch(url+'/probe')).json(),{ok:true})
    const responsiveMs=performance.now()-start
    assert.equal(db.prepare('SELECT COUNT(*) n FROM patients').get().n,before)
    await Promise.all(blockers)
    // Valid queue recovery reaches existing domain validation instead of remaining unavailable.
    const recovered=await fetch(url+'/api/orders/dialysis-orders/upload',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({fileName:'synthetic.xlsx',fileContent:data})})
    assert.equal(recovered.status,400)
    console.log('SPREADSHEET HTTP PASS '+JSON.stringify({recoverable503Routes:routes.length,probeAndOverloadResponsesMs:+responsiveMs.toFixed(2)}))
  } finally {await new Promise(resolve=>server.close(resolve));closeDatabase()}
} finally { parser.close() }
