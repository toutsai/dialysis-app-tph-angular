import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const ts=createRequire(new URL('../angular-client/package.json',import.meta.url))('typescript');
function load(name,deps={}) { const exports={}; const code=ts.transpileModule(readFileSync(new URL(`../angular-client/src/app/features/inventory/${name}.ts`,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,experimentalDecorators:true}}).outputText; new Function('exports','require',code)(exports,n=>deps[n] || {}); return exports; }
const pure=load('inventory-calculation');
const { consumptionPlan,itemAnchor,projectBalances,addLocalDays,anchorStart,receiptQuantity }=pure;
const category='dialysateCa';
const make=(start,end,complete=true,qty=12)=>({key:`${start}/${end}`,start,end,grouped:{[category]:{A:qty}},categoryCoverage:{[category]:{complete}}});
test('single-day actual replaces only the complete category and exact date',()=>{const rs=[make('2026-09-01','2026-09-01')]; assert.equal(consumptionPlan('2026-09-01','2026-09-02',rs,category).actualDays,1); assert.equal(consumptionPlan('2026-09-01','2026-09-02',rs,'bicarbonateType').actualDays,0);});
test('partial and legacy import do not supply false zero actual',()=>{const r=make('2026-09-01','2026-09-01',false,0);assert.equal(consumptionPlan(r.start,r.end,[r],category).estimatedDays,1);delete r.categoryCoverage;assert.equal(consumptionPlan(r.start,r.end,[r],category).estimatedDays,1);});
test('complete empty category explicitly supplies zero',()=>{const r=make('2026-09-01','2026-09-01',true,0);assert.equal(consumptionPlan(r.start,r.end,[r],category).actualDays,1);});
test('interval accepted once whole, never split across query or count boundary',()=>{const r=make('2026-09-01','2026-09-07');assert.equal(consumptionPlan(r.start,r.end,[r],category).accepted.length,1);assert.equal(consumptionPlan('2026-09-02',r.end,[r],category).accepted.length,0);assert.equal(consumptionPlan(r.start,r.start,[r],category).accepted.length,0);});
test('exact reupload replaces, overlapping distinct ranges both fall back',()=>{const a=make('2026-09-01','2026-09-07');const b=make(a.start,a.end,true,14);assert.equal(consumptionPlan(a.start,a.end,[a,b],category).accepted[0].grouped[category].A,14);assert.equal(consumptionPlan(a.start,'2026-09-10',[a,make('2026-09-05','2026-09-10')],category).accepted.length,0);});
test('latest per-item anchor ignores missing entries and future counts, retains explicit zero',()=>{const docs=[{countDate:'2026-09-01',counts:{[category]:{A:9}}},{countDate:'2026-09-02',counts:{[category]:{B:0}}},{countDate:'2026-09-04',counts:{[category]:{A:20}}}];assert.equal(itemAnchor(docs,category,'A','2026-09-03').countDate,'2026-09-01');assert.equal(itemAnchor(docs,category,'B','2026-09-03').counts[category].B,0);assert.equal(itemAnchor(docs,category,'C','2026-09-03'),null);});
test('late receipt never erases earlier deficit and unknown stays unknown',()=>{const days=[{date:'2026-09-01',need:7,arrivals:0},{date:'2026-09-02',need:1,arrivals:10}];assert.deepEqual(projectBalances(5,days).map(r=>r.projectedBalance),[-2,7]);assert.deepEqual(projectBalances(null,days).map(r=>r.projectedBalance),[null,null]);});
test('local date rollover respects calendar boundaries',()=>{assert.equal(addLocalDays('2026-09-30',1),'2026-10-01');assert.equal(addLocalDays('2026-01-01',-1),'2025-12-31');});

test('physical counts inside a daily timeline reset at the correct cutoff, including zero', () => {
  const rows = [
    { date: '2026-09-01', need: 7, arrivals: 2, closingCount: 20 },
    { date: '2026-09-02', need: 3, arrivals: 1 },
    { date: '2026-09-03', need: 4, arrivals: 1, openingCount: 0 },
  ];
  assert.deepEqual(projectBalances(null, rows).map(row => row.projectedBalance), [20, 18, -3]);
});

test('unknown B settings do not invalidate complete AK forecast or invent B zero', async () => {
  const stock = stockWithEngine({ calculateTheoreticalConsumption: async () => ({
    grouped: { artificialKidney: { AK: 2 } }, unknownCategories: ['bicarbonateType'],
  }) });
  const docs = [{ countDate: '2026-09-01', counts: { artificialKidney: { AK: 10 }, bicarbonateType: { B: 10 } } }];
  assert.equal((await stock.itemTimeline('artificialKidney', 'AK', '2026-09-02', '2026-09-03', docs, [])).current, 8);
  assert.equal((await stock.itemTimeline('bicarbonateType', 'B', '2026-09-02', '2026-09-03', docs, [])).current, null);
});

test('start and legacy anchors include count day; end anchor excludes it',()=>{assert.equal(anchorStart({countDate:'2026-09-01'}),'2026-09-01');assert.equal(anchorStart({countDate:'2026-09-01',cutoff:'start-of-day'}),'2026-09-01');assert.equal(anchorStart({countDate:'2026-09-01',cutoff:'end-of-day'}),'2026-09-02');});
test('pending and future receipts never become current stock; cutoff prevents same-day double receipt',()=>{const rows=[{category,item:'A',status:'ordered',date:'2026-09-01',quantity:100},{category,item:'A',status:'arrived',date:'2026-09-02',quantity:8},{category,item:'A',status:'arrived',date:'2026-09-01',quantity:3}];assert.equal(receiptQuantity(rows,category,'A','2026-09-01','2026-09-01'),3);assert.equal(receiptQuantity(rows,category,'A',anchorStart({countDate:'2026-09-01',cutoff:'end-of-day'}),'2026-09-02'),8);});

function stockWithEngine(engine) {
 class Engine {} class Api {} class Manager {}
 const {InventoryStockService}=load('inventory-stock.service',{'./inventory-calculation':pure,'@services/consumption-engine.service':{ConsumptionEngineService:Engine},'@services/api.service':{ApiService:Api},'@services/api-manager.service':{ApiManagerService:Manager},'@angular/core':{Injectable:()=>x=>x,inject:t=>t===Engine?engine:t===Manager?{create:()=>({fetchAll:async()=>[]})}:{} }});
 const stock=new InventoryStockService();stock.ensureActualRanges=async()=>[];return stock;
}
test('whole service propagates forecast failure as unknown and excludes missing count',async()=>{
 const stock=stockWithEngine({calculateTheoreticalConsumption:async()=>{throw Error('offline')}});
 const docs=[{countDate:'2026-09-01',counts:{[category]:{A:10}},countBoxes:{}}];
 const timeline=await stock.itemTimeline(category,'A','2026-09-02','2026-09-03',docs,[]);
 assert.equal(timeline.current,null);assert.equal(timeline.days[0].projectedBalance,null);
 assert.equal((await stock.itemTimeline(category,'B','2026-09-02','2026-09-02',docs,[])).current,null);
});
test('whole service end count is new anchor and interval actual is deducted exactly once',async()=>{
 const stock=stockWithEngine({calculateTheoreticalConsumption:async()=>({grouped:{[category]:{A:2}}})});
 stock.ensureActualRanges=async()=>[make('2026-09-01','2026-09-07',true,21)];
 const docs=[{countDate:'2026-09-07',cutoff:'end-of-day',counts:{[category]:{A:10}},countBoxes:{}}];
 assert.equal((await stock.itemTimeline(category,'A','2026-09-07','2026-09-07',docs,[])).current,10);
 const used=await stock.consumptionBetween('2026-09-01','2026-09-07'); assert.equal(used.grouped[category].A,21);
 const sliced=await stock.consumptionBetween('2026-09-07','2026-09-07'); assert.equal(sliced.grouped[category].A,2);
});

test('registry-only complete empty upload uses compact backend dates as a single actual day', async () => {
  class Engine {} class Api {} class Manager {}
  const source = { rangeKey: '20260901-20260901', startDate: '20260901', endDate: '20260901', category, complete: true };
  const engine = { calculateTheoreticalConsumption: async () => ({ grouped: { [category]: { A: 9 } } }) };
  const { InventoryStockService } = load('inventory-stock.service', {
    './inventory-calculation': pure,
    '@services/consumption-engine.service': { ConsumptionEngineService: Engine },
    '@services/api.service': { ApiService: Api },
    '@services/api-manager.service': { ApiManagerService: Manager },
    'rxjs': { firstValueFrom: async value => value },
    '@angular/core': {
      Injectable: () => x => x,
      inject: type => type === Engine ? engine : type === Manager
        ? { create: () => ({ fetchAll: async () => [] }) }
        : { get: () => ({ reports: [], coverage: [source] }) },
    },
  });
  const stock = new InventoryStockService();
  const result = await stock.consumptionBetween('2026-09-01', '2026-09-01');
  assert.equal(result.categorySources[category].actualDays, 1);
  assert.equal(result.categorySources[category].estimatedDays, 0);
  assert.equal(stock.value(result.grouped, category, 'A'), 0);
});

test('multi-day total reconciles at interval end without claiming daily actual, matching stock at the same date', async () => {
  const stock = stockWithEngine({ calculateTheoreticalConsumption: async (start, end) => ({
    grouped: { [category]: { A: 2 * pure.enumerateLocalDays(start, end).length } },
  }) });
  stock.ensureActualRanges = async () => [make('2026-09-01', '2026-09-02', true, 10)];
  const docs = [{ countDate: '2026-08-31', cutoff: 'end-of-day', counts: { [category]: { A: 20 } } }];
  const timeline = await stock.itemTimeline(category, 'A', '2026-08-31', '2026-09-03', docs, []);
  assert.deepEqual(timeline.days.map(day => day.projectedBalance), [18, 10, 8]);
  assert.deepEqual(timeline.days.map(day => day.actual), [null, null, null]);
  assert.equal(timeline.days[1].intervalAdjustment, -6);
  assert.equal((await stock.itemTimeline(category, 'A', '2026-09-02', '2026-09-02', docs, [])).current, 10);
  const fromInside = await stock.itemTimeline(category, 'A', '2026-09-01', '2026-09-02', docs, []);
  assert.equal(fromInside.days[0].projectedBalance, 10);
  const midCount = [...docs, { countDate: '2026-09-01', cutoff: 'end-of-day', counts: { [category]: { A: 30 } } }];
  assert.equal((await stock.itemTimeline(category, 'A', '2026-08-31', '2026-09-02', midCount, [])).days[1].projectedBalance, 28);
});
