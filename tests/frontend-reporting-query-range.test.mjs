import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fork } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import Database from 'better-sqlite3';
const root=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(new URL('../angular-client/package.json',import.meta.url)),ts=require('typescript'),rx=require('rxjs');
const source=path=>readFileSync(join(root,'angular-client/src',path),'utf8');
const signal=initial=>{let value=initial;return Object.assign(()=>value,{set:v=>value=v,update:f=>value=f(value)});};
const cache=new Map();let origin,token,server,folder;const responses=[];
function load(path,override){
  if(!override&&cache.has(path))return cache.get(path);
  const mod={exports:{}};
  vm.runInNewContext(ts.transpileModule(override||source(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true}}).outputText,{
    module:mod,exports:mod.exports,Date,Map,Set,structuredClone,console:{error(){},warn(){}},setTimeout(){},
    require(name){
      if(name==='@angular/core')return {Component:()=>x=>x,Injectable:()=>x=>x,ViewChild:()=>()=>{},ChangeDetectionStrategy:{}};
      if(name==='rxjs'||name==='rxjs/operators')return require(name);
      if(name==='chart.js')return {Chart:class {static register(){}},registerables:[]};
      if(name==='./api.service')return load('app/core/services/api.service.ts');
      if(name.includes('api-query-contract'))return load('services/api-query-contract.ts');
      if(name==='@app/core/utils/latest-request')return load('app/core/utils/latest-request.ts');
      if(name==='@/utils/dateUtils')return load('utils/dateUtils.ts');
      if(name==='@/constants/scheduleConstants')return load('constants/scheduleConstants.js');
      if(name==='@/services/localApiClient')return {localApi:{get:path=>http(path)}};
      return {};
    },
  });
  if(!override)cache.set(path,mod.exports);return mod.exports;
}
async function http(path,params){
  const url=new URL('/api'+path,origin);for(const [key,value]of Object.entries(params||{}))url.searchParams.set(key,String(value));
  const res=await fetch(url,{headers:{Authorization:`Bearer ${token}`}}),text=await res.text();assert.equal(res.status,200,`${url.pathname}: ${text.slice(0,200)}`);
  const data=JSON.parse(text);responses.push({path:url.pathname,query:Object.fromEntries(url.searchParams),rows:Array.isArray(data)?data.length:0,bytes:Buffer.byteLength(text)});return data;
}
before(async()=>{
  folder=mkdtempSync(join(tmpdir(),'report-query-regression-'));const dbPath=join(folder,'synthetic.db'),db=new Database(dbPath);
  db.exec(readFileSync(join(root,'src/db/schema.sql'),'utf8'));
  db.prepare('INSERT INTO patients(id,medical_record_number,name,status,dialysis_orders) VALUES (?,?,?,?,?)').run('synthetic','SYNTHETIC','Synthetic','opd',JSON.stringify({mode:'HD'}));
  const live=db.prepare('INSERT INTO schedules(id,date,schedule) VALUES (?,?,?)'),archived=db.prepare('INSERT INTO archived_schedules(id,date,schedule) VALUES (?,?,?)'),logs=db.prepare('INSERT INTO daily_logs(id,date,stats) VALUES (?,?,?)');
  db.transaction(()=>{
    let index=0;for(let d=new Date('2023-01-01T00:00:00Z');d<new Date('2026-01-01T00:00:00Z');d.setUTCDate(d.getUTCDate()+1)){
      const date=d.toISOString().slice(0,10);index++;
      const slot={patientId:'synthetic',archivedPatientInfo:{status:'opd',mode:'HD'}};
      if(index%3!==0)live.run('live-'+date,date,JSON.stringify({'bed-1-early':slot}));
      if(index%3!==1)archived.run('archive-'+date,date,JSON.stringify({'bed-1-early':slot,'bed-2-noon':{patientId:'historical-deleted',archivedPatientInfo:{status:'ipd',mode:'SLED'}}}));
      logs.run('log-'+date,date,JSON.stringify({main_beds:{early:{total:index%9+1},noon:{total:2},late:{total:3}},staffing:{details:[{count:2,ratio1:1,ratio2:.5,ratio3:1}],adjustments:{shift1:-1,shift2:0,shift3:1}}}));
    }
  })();db.close();
  server=fork(join(root,'tests/helpers/backend-test-server.mjs'),[],{execArgv:[],windowsHide:true,stdio:['ignore','ignore','ignore','ipc'],env:{...process.env,NODE_ENV:'test',DB_PATH:dbPath,LOCAL_AUTH_BYPASS:'1',JWT_SECRET:randomBytes(48).toString('hex'),TEST_PASSWORD:randomBytes(24).toString('base64url'),DISABLE_SCHEDULER:'1'}});
  const ready=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('synthetic server timeout')),30000);server.once('error',reject);server.on('message',message=>{if(message.type==='ready'){clearTimeout(timer);resolve(message);}});});origin=`http://127.0.0.1:${ready.port}`;token=ready.tokens.admin;
});
after(async()=>{if(server?.exitCode===null)await new Promise(resolve=>{server.once('exit',resolve);server.send({type:'shutdown'});});if(folder){const path=relative(realpathSync(tmpdir()),realpathSync(folder));assert(path&&!path.startsWith('..')&&!isAbsolute(path));rmSync(folder,{recursive:true,force:true});}});
const reportingSource=source('app/features/reporting/reporting.component.ts');
const legacySource=reportingSource.replace('this.dailyLogsApi.fetchWhere({ startDate, endDate })','this.dailyLogsApi.fetchAll()').replace('this.schedulesApi.fetchWhere({ startDate, endDate })','this.schedulesApi.fetchAll()').replace('this.expiredSchedulesApi.fetchWhere({ start: startDate, end: endDate })','this.expiredSchedulesApi.fetchAll()');
function report(type,date,legacy=false){
  const {ApiManagerService}=load('app/core/services/api-manager.service.ts');const manager=Object.create(ApiManagerService.prototype);
  manager.api={get:(path,params)=>rx.from(http(path,params)),unwrapList:()=>rx.map(value=>value)};
  const {ReportingComponent}=load('app/features/reporting/reporting.component.ts',legacy?legacySource:undefined);const p=Object.create(ReportingComponent.prototype);
  const {LatestRequest}=load('app/core/utils/latest-request.ts');
  Object.assign(p,{reportRequests:new LatestRequest(),reportError:signal(''),reportWarning:signal(''),isLoading:signal(false),hasGenerated:signal(false),reportType:signal(type),selectedDate:signal(date),selectedMonth:signal(date.slice(0,7)),selectedYear:signal(Number(date.slice(0,4))),reportDateRange:signal({}),renderChart(){},
    schedulesApi:manager.create('schedules'),expiredSchedulesApi:manager.create('expired_schedules'),dailyLogsApi:manager.create('daily_logs'),patientsApi:manager.create('patients'),REPORT_MODE_ORDER:['HD','SLED','PE','PP','DFPP','Lipid'],REPORT_STATUS_ORDER:['門診','住院','急診','未知']});
  for(const key of ['dailyTableRows','monthlyTableRows','yearlyTableRows','staffingTableRows','dailyTableHeaders','monthlyTableHeaders','yearlyTableHeaders'])p[key]=signal([]);return p;
}
const output=p=>JSON.parse(JSON.stringify(Object.fromEntries(['reportDateRange','dailyTableRows','monthlyTableRows','yearlyTableRows','staffingTableRows','dailyTableHeaders','monthlyTableHeaders','yearlyTableHeaders','reportWarning','reportError'].map(key=>[key,p[key]()] ))));
for(const [type,date,start,end]of [
  ['daily','2024-02-29','2024-02-29','2024-02-29'],['daily','2024-01-01','2024-01-01','2024-01-01'],['daily','2024-01-02','2024-01-02','2024-01-02'],['daily','2024-12-31','2024-12-31','2024-12-31'],
  ['monthly','2024-02-01','2024-02-01','2024-02-29'],['monthly','2023-12-01','2023-12-01','2023-12-31'],['monthly','2024-01-01','2024-01-01','2024-01-31'],
  ['yearly','2024-01-01','2024-01-01','2024-12-31'],['staffing_monthly','2024-02-01','2024-02-01','2024-02-29'],
])test(`${type} ${date}: actual HTTP range and complete output equal legacy all-history report`,async t=>{
  responses.length=0;const before=report(type,date,true);await before.generateReport();assert.equal(before.reportError(),'');const full=responses.splice(0);
  const after=report(type,date);await after.generateReport();assert.equal(after.reportError(),'');const bounded=responses.splice(0);
  assert.deepEqual(output(after),output(before));
  const paths=type==='staffing_monthly'?['/api/nursing/daily-logs']:['/api/schedules','/api/schedules/expired'];
  for(const path of paths){const entry=bounded.find(r=>r.path===path);assert(entry);assert.deepEqual(entry.query,path.endsWith('/expired')?{start,end}:{startDate:start,endDate:end});assert(entry.rows>=0);assert(entry.rows<full.find(r=>r.path===path).rows);}
  if(type!=='staffing_monthly')assert.deepEqual(bounded.find(r=>r.path==='/api/patients').query,{});
  const count=list=>list.filter(r=>paths.includes(r.path)).reduce((a,r)=>({rows:a.rows+r.rows,bytes:a.bytes+r.bytes}),{rows:0,bytes:0});const all=count(full),range=count(bounded);assert(range.bytes<all.bytes);
  assert(range.rows>0);t.diagnostic(JSON.stringify({type,date,full:all,bounded:range}));
  if(type==='staffing_monthly'){assert.equal(after.staffingTableRows()[0].date,start);assert.equal(after.staffingTableRows().at(-1).date,end);assert.equal(after.staffingTableRows().length,29);}
  if(type==='monthly'&&date==='2024-02-01')assert.equal(after.monthlyTableHeaders().length,29);
});
