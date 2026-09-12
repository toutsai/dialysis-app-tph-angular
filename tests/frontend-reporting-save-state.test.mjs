import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(new URL('../angular-client/package.json', import.meta.url));
const ts = require('typescript');
const base = new URL('../angular-client/src/app/', import.meta.url);
const signal = initial => { let value = initial; const fn = () => value; fn.set = x => { value = x; }; fn.update = f => { value = f(value); }; return fn; };
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
function moduleAt(path, deps = {}, globals = {}) {
  const mod = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL(path, base), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true } }).outputText;
  vm.runInNewContext(code, { module:mod, exports:mod.exports, structuredClone, Date, console:{error(){},warn(){}}, setTimeout:()=>0, clearTimeout(){},
    require(name) {
      if (deps[name]) return deps[name];
      if (name==='@angular/core') return { Component:()=>x=>x, Input:()=>()=>{}, Output:()=>()=>{}, ViewChild:()=>()=>{}, HostListener:()=>()=>{}, ChangeDetectionStrategy:{} };
      if (name==='chart.js') return {Chart:class {static register(){}},registerables:[]};
      if (name==='@app/core/utils/latest-request') return latest;
      if (name==='@/utils/dateUtils') return {formatDateToYYYYMMDD:d=>d.toLocaleDateString('sv-SE')};
      return {};
    }, ...globals });
  return mod.exports;
}
const latest = moduleAt('core/utils/latest-request.ts');
function reporting(api = {}, deps = {}) {
  const {ReportingComponent} = moduleAt('features/reporting/reporting.component.ts', deps);
  const p = Object.create(ReportingComponent.prototype);
  Object.assign(p, {reportRequests:new latest.LatestRequest(), reportError:signal(''),reportWarning:signal(''),isLoading:signal(false),hasGenerated:signal(false),
    reportType:signal('monthly'),selectedDate:signal('2026-01-01'),selectedMonth:signal('2026-01'),selectedYear:signal(2026),reportDateRange:signal({}),
    schedulesApi:{fetchWhere:async()=>[]},expiredSchedulesApi:{fetchWhere:async()=>[]},patientsApi:{fetchAll:async()=>[]},dailyLogsApi:{fetchWhere:async()=>[]},
    processMonthlyReport(rows){this.monthlyTableRows.set(rows);},processDailyReport(rows){this.dailyTableRows.set(rows);},processYearlyReport(rows){this.yearlyTableRows.set(rows);},renderChart(){},
    noData(){return this.monthlyTableRows().length===0;},reportTitle(){return this.selectedMonth();},...api});
  for(const key of ['dailyTableRows','monthlyTableRows','yearlyTableRows','staffingTableRows','dailyTableHeaders','monthlyTableHeaders','yearlyTableHeaders']) p[key]=signal([]);
  for(const name of ['schedulesApi','expiredSchedulesApi','dailyLogsApi']) {
    const run=p[name].fetchWhere;
    p[name].fetchWhere=params=>{
      const type=p.reportType(),[year,month]=p.selectedMonth().split('-').map(Number);
      const start=type==='daily'?p.selectedDate():type==='yearly'?`${p.selectedYear()}-01-01`:`${p.selectedMonth()}-01`;
      const end=type==='daily'?start:type==='yearly'?`${p.selectedYear()}-12-31`:`${p.selectedMonth()}-${new Date(year,month,0).getDate()}`;
      assert.deepEqual(JSON.parse(JSON.stringify(params)),name==='expiredSchedulesApi'?{start,end}:{startDate:start,endDate:end});
      return run(params);
    };
  }
  return p;
}
test('report late old month cannot replace current rows, error or busy state', async()=>{
  const a=deferred(),b=deferred();let n=0;
  const p=reporting({schedulesApi:{fetchWhere:()=>++n===1?a.promise:b.promise}});
  const first=p.generateReport();p.selectedMonth.set('2026-02');const second=p.generateReport();
  a.reject(new Error('old failed'));await first;assert.equal(p.isLoading(),true);assert.equal(p.reportError(),'');
  b.resolve([{date:'2026-02-01',id:'feb'}]);await second;assert.equal(p.monthlyTableRows()[0].id,'feb');assert.equal(p.isLoading(),false);
});
test('report type switching ignores old successful response', async()=>{
  const a=deferred(),b=deferred();let n=0;const p=reporting({schedulesApi:{fetchWhere:()=>++n===1?a.promise:b.promise}});
  const first=p.generateReport();p.reportType.set('daily');const second=p.generateReport();b.resolve([{date:'2026-01-01',id:'day'}]);await second;
  a.resolve([{date:'2026-01-02',id:'old'}]);await first;assert.equal(p.dailyTableRows()[0].id,'day');assert.equal(p.monthlyTableRows().length,0);
});
test('current failure is explicit and retry clears the error',async()=>{
  let fail=true;const p=reporting({schedulesApi:{fetchWhere:async()=>{if(fail)throw Error();return [];}}});
  await p.generateReport();assert.ok(p.reportError());fail=false;await p.generateReport();assert.equal(p.reportError(),'');
});
test('annual census failure preserves attendance and marks partial source',async()=>{
  const p=reporting({}, {'@/services/localApiClient':{localApi:{get:async()=>{throw Error('unavailable');}}}});p.reportType.set('yearly');
  await p.generateReport();assert.ok(p.reportWarning());assert.equal(p.reportError(),'');
});
test('export snapshots rows and period before lazy XLSX resolves',async()=>{
  const ready=deferred();let output;
  const xlsx={utils:{book_new:()=>({}),aoa_to_sheet:data=>({data}),book_append_sheet:(book,sheet)=>{book.sheet=sheet;}},writeFile:(book,name)=>{output={book,name};}};
  const p=reporting({}, {'@/utils/xlsxLoader':{loadXlsx:()=>ready.promise}});
  p.monthlyTableHeaders.set([1]);p.monthlyTableRows.set([{mode:'HD',status:'opd',dailyCounts:[7],monthlyTotal:7}]);
  const exp=p.exportToExcel();p.selectedMonth.set('2026-02');p.monthlyTableRows()[0].dailyCounts[0]=99;ready.resolve(xlsx);await exp;
  assert.equal(output.name,'月報表_2026-01.xlsx');assert.equal(output.book.sheet.data[3][2],7);
});
function lab(save) {
  const {LabReportsComponent}=moduleAt('features/lab-reports/lab-reports.component.ts');const p=Object.create(LabReportsComponent.prototype);
  Object.assign(p,{alertSaving:signal(false),alertSaveError:signal(''),alertDetailError:signal(''),failedAlertSaves:signal([]),savedAlertSignatures:new Map(),
    alertResultMonthRange:'2026-01_2026-03',isLoadingAlerts:signal(false),labAnalysesApi:{save},alertList:signal([]),selectedAlertItem:signal(null),isAlertDetailModalVisible:signal(true),showAlertSaveToast(m){this.toast=m;}});return p;
}
test('batch settles all writes then retries failed rows only with original identity',async()=>{
  const calls=[];let fail=true;const wait=deferred();const p=lab(async(id,data)=>{calls.push([id,data]);if(id==='a')await wait.promise;else if(fail)throw Error();});
  const pending=p.persistAlertJobs([{id:'a',data:{analysis:'A',suggestion:''}},{id:'b',data:{analysis:'B',suggestion:''}}]);
  await Promise.resolve();assert.equal(p.alertSaving(),true);wait.resolve();await pending;
  assert.equal(p.failedAlertSaves().length,1);assert.equal(p.failedAlertSaves()[0].id,'b');assert.ok(p.alertSaveError());fail=false;await p.retryFailedAlertSaves();
  assert.equal(calls.filter(([id])=>id==='a').length,1);assert.equal(calls.filter(([id])=>id==='b').length,2);assert.equal(p.failedAlertSaves().length,0);
});
test('single confirmation preserves modal and failed payload, suppresses double submit',async()=>{
  const wait=deferred();let calls=0;const p=lab(()=>{calls++;return wait.promise;});
  const item={patient:{id:'p',name:'Test'},analysisTexts:{},suggestionTexts:{},abnormalities:[{key:'Hb'}]};p.alertList.set([item]);p.selectedAlertItem.set({...item,key:'Hb'});
  const a=p.handleAlertUpdate({analysisText:'draft',suggestionText:''});await p.handleAlertUpdate({analysisText:'duplicate',suggestionText:''});assert.equal(calls,1);
  wait.reject(Error('failed'));await a;assert.equal(p.isAlertDetailModalVisible(),true);assert.ok(p.alertDetailError());assert.equal(p.failedAlertSaves()[0].data.analysis,'draft');
  p.labAnalysesApi.save=async()=>{};await p.handleAlertUpdate({analysisText:'corrected',suggestionText:''});assert.equal(p.isAlertDetailModalVisible(),false);assert.equal(p.failedAlertSaves().length,0);
  await p.saveAlertAnalyses();assert.equal(p.toast,'目前沒有尚待儲存的分析');
});
test('lab modal emits confirmation without closing and blocks while saving',()=>{
  const {LabAlertDetailModalComponent}=moduleAt('components/dialogs/lab-alert-detail-modal/lab-alert-detail-modal.component.ts');const p=Object.create(LabAlertDetailModalComponent.prototype);let confirms=0,closes=0;
  Object.assign(p,{selectedCauses:[],selectedSuggestions:[],otherCauseText:'draft',otherSuggestionText:'',saving:false,confirm:{emit(){confirms++;}},close:{emit(){closes++;}}});p.handleConfirm();assert.equal(confirms,1);assert.equal(closes,0);p.saving=true;p.handleConfirm();p.handleClose();assert.equal(confirms,1);assert.equal(closes,0);
});
test('HDRX pending draft export can be cancelled without losing draft',()=>{
  let prompts=0;const {KiditHdrxQuarterlyComponent}=moduleAt('features/kidit-report/kidit-hdrx-quarterly.component.ts',{}, {confirm:()=>{prompts++;return false;}});
  const p=Object.create(KiditHdrxQuarterlyComponent.prototype);Object.assign(p,{isLoading:signal(false),loadError:signal(''),saveQueue:{hasPending:()=>true},rows:()=>{throw Error('export must stop before reading rows');}});p.exportCsv();assert.equal(prompts,1);
});
test('user list failure keeps prior users, exposes retry and clears error on success',async()=>{
  const {UserManagementComponent}=moduleAt('features/user-management/user-management.component.ts');const p=Object.create(UserManagementComponent.prototype);
  Object.assign(p,{usersError:signal(''),isLoading:signal(false),users:signal([{id:'existing'}]),usersApi:{fetchAll:async()=>{throw Error();}}});
  await p.fetchUsers();assert.ok(p.usersError());assert.equal(p.users()[0].id,'existing');assert.equal(p.isLoading(),false);
  p.usersApi.fetchAll=async()=>[{id:'fresh'}];await p.fetchUsers();assert.equal(p.usersError(),'');assert.equal(p.users()[0].id,'fresh');
});
test('HDRX current load failure exposes inline error and keeps queue ownership',async()=>{
  const {KiditHdrxQuarterlyComponent}=moduleAt('features/kidit-report/kidit-hdrx-quarterly.component.ts',{'@/services/kiditVascularCsvService':{quarterRange:()=>({endDate:'2026-03-31'})}});
  const p=Object.create(KiditHdrxQuarterlyComponent.prototype);let flushes=0;
  Object.assign(p,{loadGeneration:0,loadError:signal(''),quarter:()=> '2026Q1',year:()=>2026,q:()=>1,isLoading:signal(false),rows:signal([]),saveQueue:{flush:async()=>{flushes++;throw Error();}}});
  await p.load();assert.ok(p.loadError());assert.equal(p.isLoading(),false);
  // Failure must be rendered inline rather than alerting or replacing the save queue.
  assert.equal(p.loadGeneration,1);
  assert.equal(flushes,1);
});
