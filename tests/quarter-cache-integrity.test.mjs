import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const require = createRequire(new URL('../angular-client/package.json', import.meta.url));
const ts = require('typescript');
const signal = (value) => Object.assign(() => value, { set: v => value = v, update: fn => value = fn(value) });
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;});return {promise,resolve,reject}; };
function storage() { const map = new Map([['auth_token','session-a'],['auth_user','{"id":"user-a"}']]);return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k),clear:()=>map.clear()}; }
function execute(source, globals = {}) {
 const module = {exports:{}};
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,experimentalDecorators:true}}).outputText,
 {module,exports:module.exports,console:{log(){},error(){}},structuredClone,setTimeout:()=>1,clearTimeout(){},...globals});return module.exports;
}
function source(rel) {return readFileSync(new URL('../angular-client/src/'+rel, import.meta.url),'utf8');}
function methods(rel,names,globals={}) {
 const text=source(rel), ast=ts.createSourceFile(rel,text,ts.ScriptTarget.ES2022,true), cls=ast.statements.find(ts.isClassDeclaration);
 return new (execute('export class Subject { '+names.map(n=>{const member=cls.members.find(m=>m.name?.getText(ast)===n);assert(member,n);return member.getText(ast);}).join('\n')+'}',globals).Subject)();
}
function queueType(sessionStorage) {return execute(source('services/quarterSaveQueue.ts').replace(/^import .*;$/m,''),{sessionStorage,saveQuarterRecord:async()=>{}}).QuarterSaveQueue;}
for (const verb of ['get', 'post', 'put', 'patch', 'delete']) test(`Promise client ${verb}: an old-session 401 cannot log out a new login`, async () => {
 const store = storage(), gate = deferred(), calls = [];
 const api = execute(source('services/localApiClient.ts'), { sessionStorage: store, fetch: () => gate.promise, URLSearchParams });
 api.setUnauthorizedHandler(reason => calls.push(reason));
 const request = api.localApi[verb]('/synthetic', {});
 const rejected = assert.rejects(request);
 store.setItem('auth_token', 'session-b');
 gate.resolve(new Response(JSON.stringify({code:'TOKEN_BLACKLISTED'}), {status:401}));
 await rejected;
 assert.equal(calls.length, 0);
});
test('Promise 401 rechecks session after parsing, and still notifies a current session', async () => {
 const store = storage(), body = deferred(), calls = [];
 const response = {ok:false,status:401,statusText:'Unauthorized',clone:()=>({json:()=>body.promise})};
 const api = execute(source('services/localApiClient.ts'), {sessionStorage:store,fetch:async()=>response,URLSearchParams});
 api.setUnauthorizedHandler(reason => calls.push(reason));
 const rejected = assert.rejects(api.localApi.get('/synthetic'));
 await new Promise(resolve => setImmediate(resolve));
 store.setItem('auth_token','session-b'); body.resolve({code:'TOKEN_BLACKLISTED'});
 await rejected; assert.equal(calls.length,0);
 await assert.rejects(api.localApi.get('/synthetic'));
 assert.deepEqual(calls,['another_device']);
});
for (const kind of ['hdrx','hosp','nurse']) for (const startQuarter of [3,4]) test(`${kind}: Q${startQuarter} edits retain immutable patient/quarter revisions across navigation and in-flight save`, async()=>{
 const store=storage(), Queue=queueType(store), gate=deferred(), writes=[];
 const queue=new Queue(kind,async(q,id,data)=>{writes.push({q,id,data});if(writes.length===1)await gate.promise;});
 const rel=kind==='nurse'?'app/features/kidit-quarterly-input/kidit-quarterly-input.component.ts':`app/features/kidit-report/kidit-${kind}-quarterly.component.ts`;
 const method=kind==='nurse'?'onFieldChange':'scheduleSave';
 const p=methods(rel,[method,'changeQuarter','flushPendingSaves']);
 const rows=[{patientId:'a',excluded:false,overrideValues:{field:'old'},episodeKey:'e',autoAdmit:'2026-10-01',admitDate:'2026-10-02',autoDischarge:'',dischargeDate:'',cat:'01',sub:'01-1'}, {patientId:'b',excluded:false,overrideValues:{field:'old-b'},episodeKey:'e',autoAdmit:'',admitDate:'',autoDischarge:'',dischargeDate:'',cat:'02',sub:'02-1'}];
 Object.assign(p,{q:signal(startQuarter),year:signal(2026),quarter:()=>`${p.year()}Q${p.q()}`,rows:()=>rows,saveQueue:queue,isLoading:signal(false),authService:{currentUser:()=>({id:'nurse'})},dataByPatient:{a:{hdrecord:{field:'old'}},b:{hdrecord:{field:'old-b'}}},load(){},loadQuarterData:async()=>{}});
 p[method]('a');p[method]('b');const saving=queue.flush();
 // User edits A again before acknowledgement; the second revision must remain pending.
 rows[0].overrideValues.field='new';rows[0].cat='03';p.dataByPatient.a.hdrecord.field='new';p[method]('a');
 await p.changeQuarter(1);assert.equal(p.quarter(),startQuarter===4?'2027Q1':'2026Q4');
 gate.resolve();await saving;
 assert.equal(writes.length,3);assert(writes.every(w=>w.q===`2026Q${startQuarter}`));
 const value = data => kind==='hdrx'?data.hdrx.values.field:kind==='hosp'?data.hosp.e.cat:data.hdrecord.field;
 assert.equal(value(writes[0].data),kind==='hosp'?'01':'old');
 assert.equal(value(writes.filter(w=>w.id==='a').at(-1).data),kind==='hosp'?'03':'new');
 assert.equal(queue.hasPending(),false);
});
test('failed revision stays recoverable per quarter/user; retry persists newest edits',async()=>{
 const store=storage(),Queue=queueType(store);let fails=true;const writes=[];
 const queue=new Queue('hdrx',async(q,id,data)=>{writes.push({q,id,data});if(fails)throw Error('offline');});
 const draft={hdrx:{values:{field:'draft'}}};queue.enqueue('2026Q3','a',draft);draft.hdrx.values.field='mutated';await queue.flush();assert.equal(queue.hasPending(),true);
 const restored=new Queue('hdrx');assert.equal(restored.get('2026Q3','a').hdrx.values.field,'draft');assert.equal(restored.get('2026Q4','a'),undefined);
 fails=false;await queue.flush();assert.equal(queue.hasPending(),false);
 store.setItem('auth_user','{"id":"user-b"}');assert.equal(new Queue('hdrx').hasPending(),false);
});
test('session change stops queued writes and cannot repopulate cleared browser drafts',async()=>{
 const store=storage(),Queue=queueType(store),gate=deferred(),writes=[];const queue=new Queue('hdrx',async(q,id)=>{writes.push(id);await gate.promise;});
 queue.enqueue('2026Q3','a',{});queue.enqueue('2026Q3','b',{});const save=queue.flush();store.clear();gate.resolve();await save;assert.deepEqual(writes,['a']);assert.equal(store.getItem('kidit-drafts:user-a:hdrx'),null);
});
function patientStore() {
 const p=methods('app/core/services/patient-store.service.ts',['loadPatients','doLoadPatients','reset','invalidateLoad','bumpVersion','addPatientInStore','updatePatientInStore','removePatientInStore']);
 const responses=[];
 Object.assign(p,{inFlightLoad:null,loadGeneration:0,sessionGeneration:0,allPatients:signal([]),masterScheduleRules:signal({}),isLoading:signal(false),error:signal(null),hasFetched:signal(false),patientsVersion:signal(0),patientApi:{fetchWhere:()=>{const g=deferred();responses.push(g);return g.promise;}},baseScheduleApi:{fetchById:async()=>null}});
 return {p,responses};
}
test('reset invalidates old success/finally while a replacement read remains in flight',async()=>{
 const {p,responses}=patientStore();const old=p.loadPatients();p.reset();const next=p.loadPatients();responses[0].resolve([{id:'old'}]);await old;assert.equal(p.allPatients().length,0);assert.equal(p.hasFetched(),false);assert.equal(p.isLoading(),true);assert.equal(p.inFlightLoad,next);responses[1].resolve([{id:'new'}]);await next;assert.equal(p.allPatients()[0].id,'new');
});
for(const mutation of ['add','update','remove'])test(`local ${mutation} invalidates an older patient read`,async()=>{
 const {p,responses}=patientStore();p.allPatients.set([{id:'a',name:'before'}]);const read=p.loadPatients();
 if(mutation==='add')p.addPatientInStore({id:'b',name:'added'});if(mutation==='update')p.updatePatientInStore('a',{name:'updated'});if(mutation==='remove')p.removePatientInStore('a');
 responses[0].resolve([{id:'a',name:'old-server'}]);await read;
 assert.equal(p.allPatients().some(x=>x.name==='old-server'),false);assert.equal(p.allPatients().length,mutation==='add'?2:mutation==='remove'?0:1);
});
test('late failure after reset cannot restore cache error/loading flags',async()=>{const {p,responses}=patientStore();const old=p.loadPatients();p.reset();responses[0].reject(Error('old request'));await old;assert.equal(p.error(),null);assert.equal(p.hasFetched(),false);});
test('Angular 401 invokes the registered central handler only for the current API session',()=>{
 const store=storage(),calls=[];let error={status:401,error:{code:'TOKEN_BLACKLISTED'}};
 const {authInterceptor}=execute(source('app/core/interceptors/auth.interceptor.ts').replace(/^import .*;\r?\n/gm,''),{sessionStorage:store,notifyUnauthorized:r=>calls.push(r),catchError:fn=>fn,throwError:fn=>fn()});
 const req=url=>({url,clone(){return this;}});
 const next=()=>({pipe:handler=>handler(error)});
 authInterceptor(req('/api/patients'),next);assert.deepEqual(calls,['another_device']);
 authInterceptor(req('/external'),next);assert.equal(calls.length,1);
 authInterceptor(req('/api/patients'),()=>({pipe:handler=>{store.setItem('auth_token','new');return handler(error);}}));assert.equal(calls.length,1);
});
test('logout clears store and credentials immediately even if server logout never finishes',async()=>{
 const store=storage(),gate=deferred(),counts={reset:0,navigate:0};
 const p=methods('app/core/services/auth.service.ts',['logout','clearInMemoryCaches','clearBrowserStorage'],{sessionStorage:store,localStorage:storage(),window:{},clearAllCache(){},fetch:()=>gate.promise});
 Object.assign(p,{sessionEnding:false,firebase:{apiBaseUrl:'/api',getHeaders:()=>({Authorization:'old'}),removeToken:()=>store.removeItem('auth_token')},currentUser:signal({id:'a'}),claims:signal({role:'admin'}),patientStore:{reset:()=>counts.reset++},medicationStore:{clearCache(){}},userDirectory:{clearCache(){}},archiveStore:{clearCache(){}},dateState:{clear(){}},refreshTimer:null,stopSessionTimeoutCheck(){},router:{navigate:async()=>counts.navigate++}});
 const logout=p.logout('expired');assert.equal(counts.reset,1);assert.equal(p.currentUser(),null);assert.equal(store.getItem('auth_token'),null);await logout;assert.equal(counts.navigate,1);gate.resolve({});
});
for(const kind of ['hdrx','hosp'])test(`${kind}: superseded quarter load cannot apply rows or clear new loading state`,async()=>{
 const gates=new Map(), rel=`app/features/kidit-report/kidit-${kind}-quarterly.component.ts`;
 const p=methods(rel,['load'],{quarterRange:()=>({startDate:'2026-07-01',endDate:'2026-09-30'}),fetchQuarterRecords:q=>{const g=deferred();gates.set(q,g);return g.promise;},localApi:{get:async()=>[]}});
 let rowWrites=0;
 Object.assign(p,{loadGeneration:0,q:signal(3),year:()=>2026,quarter:()=>`2026Q${p.q()}`,isLoading:signal(false),rows:{set(){rowWrites++;}},saveQueue:{flush:async()=>{}},patientStore:{fetchPatientsIfNeeded:async()=>{},allPatients:()=>[],patientMap:()=>new Map()},nurseNames:signal([]),nurseFilter:signal('existing')});
 const first=p.load();await new Promise(r=>setImmediate(r));p.q.set(4);const second=p.load();await new Promise(r=>setImmediate(r));const before=rowWrites;gates.get('2026Q3').resolve([]);await first;assert.equal(rowWrites,before);assert.equal(p.isLoading(),true);gates.get('2026Q4').resolve([]);await second;assert.equal(rowWrites,before+1);assert.equal(p.isLoading(),false);
});
