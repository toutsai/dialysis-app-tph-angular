import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const ts = createRequire(new URL('../angular-client/package.json', import.meta.url))('typescript');
const source = readFileSync(new URL('../angular-client/src/app/core/services/consumption-engine.service.ts',import.meta.url),'utf8');
function engine({ patients = new Map([['p1',{dialysisOrders:{ak:'AK1/AK2',dialysateCa:'A'}}]]), patientError = null, loaded = true, patientLoad = async()=>{} } = {}) {
  class Api {} class Patients {}
  const dependencies = {
    '@angular/core': { Injectable:()=>type=>type, inject:type=>type===Api ? {apiBaseUrl:'/api',getHeaders:()=>({})} : {fetchPatientsIfNeeded:patientLoad,patientMap:()=>patients,hasFetched:()=>loaded,error:()=>patientError} },
    './api-config.service': {ApiConfigService:Api}, './patient-store.service':{PatientStoreService:Patients},
  };
  const exports = {};
  const compiled = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true}}).outputText;
  new Function('exports','require',compiled)(exports,id=>dependencies[id]);
  return new exports.ConsumptionEngineService();
}
const schedule = [{schedule:{'bed-1-early':{patientId:'p1'}}}];
const beds = [{id:'1',defaultBicarbonate:'B'}];
function mockedFetch(t,{scheduleData=schedule,bedData=beds,scheduleStatus=200,bedStatus=200}={}) {
  t.mock.method(globalThis,'fetch',async url=> {
    const isBed = url.includes('bed-settings');
    return {ok:(isBed?bedStatus:scheduleStatus)===200,json:async()=>isBed?bedData:scheduleData};
  });
}

test('real engine propagates schedule HTTP and malformed payload failures', async t=>{
  for (const options of [{scheduleStatus:503},{scheduleData:{error:true}},{scheduleData:[{schedule:[]}]},{scheduleData:[{schedule:{slot:null}}]}]) {
    mockedFetch(t,options);
    await assert.rejects(engine().calculateTheoreticalConsumption('2026-09-01','2026-09-01'));
    t.mock.restoreAll();
  }
});

test('real engine rejects patient-load failure and swallowed loading error state', async t=>{
  mockedFetch(t);
  await assert.rejects(engine({patientLoad:async()=>{throw Error('offline')}}).calculateTheoreticalConsumption('2026-09-01','2026-09-01'));
  await assert.rejects(engine({patientError:'offline',loaded:false}).calculateTheoreticalConsumption('2026-09-01','2026-09-01'));
});

test('missing patient leaves AK/A unknown but known bed B still counts', async t=>{
  mockedFetch(t);
  const result = await engine({patients:new Map()}).calculateTheoreticalConsumption('2026-09-01','2026-09-01');
  assert.deepEqual(result.unknownCategories.sort(),['artificialKidney','dialysateCa']);
  assert.equal(result.grouped.bicarbonateType.B,1);
  assert.equal(result.totalSlots,1);
});

test('bed HTTP failure or missing B mapping marks only B unknown', async t=>{
  for (const options of [{bedStatus:503},{bedData:[]},{bedData:{invalid:true}}]) {
    mockedFetch(t,options);
    const result = await engine().calculateTheoreticalConsumption('2026-09-01','2026-09-01');
    assert.deepEqual(result.unknownCategories,['bicarbonateType']);
    assert.equal(result.grouped.artificialKidney.AK1,1);
    assert.equal(result.grouped.artificialKidney.AK2,1);
    assert.equal(result.grouped.dialysateCa.A,1);
    t.mock.restoreAll();
  }
});

test('known empty schedule is zero, missing patient orders unknown, local date rollover correct', async t=>{
  mockedFetch(t,{scheduleData:[]});
  const empty = await engine().calculateTheoreticalConsumption('2026-09-01','2026-09-01');
  assert.equal(empty.totalSlots,0);
  assert.deepEqual(empty.unknownCategories,[]);
  t.mock.restoreAll();mockedFetch(t);
  const missing = await engine({patients:new Map([['p1',{}]])}).calculateTheoreticalConsumption('2026-09-01','2026-09-01');
  assert.deepEqual(missing.unknownCategories.sort(),['artificialKidney','dialysateCa']);
  const originalTZ=process.env.TZ;
  try { process.env.TZ='Asia/Taipei';assert.deepEqual(engine().generateDateRange('2026-09-30','2026-10-02'),['2026-09-30','2026-10-01','2026-10-02']); }
  finally {if(originalTZ===undefined)delete process.env.TZ;else process.env.TZ=originalTZ;}
});
