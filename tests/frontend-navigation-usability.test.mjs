import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(new URL('../angular-client/package.json',import.meta.url));
const ts=require('typescript');
const base=new URL('../angular-client/src/app/',import.meta.url);
const signal=value=>Object.assign(()=>value,{set:x=>value=x,update:f=>value=f(value)});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function load(path,deps={},globals={}) {
 const module={exports:{}};
 const output=ts.transpileModule(readFileSync(new URL(path,base),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true}}).outputText;
 vm.runInNewContext(output,{module,exports:module.exports,Date,URLSearchParams,structuredClone,queueMicrotask,setTimeout:()=>0,console:{error(){},warn(){}},require:name=>deps[name]||(name==='@angular/core'?{Component:()=>x=>x,ViewChild:()=>()=>{},Input:()=>()=>{},Output:()=>()=>{},HostListener:()=>()=>{},ChangeDetectionStrategy:{}}:{}),...globals});return module.exports;
}
const nav=load('features/inventory/inventory-navigation.ts');
const location=x=>nav.inventoryLocation(x);
test('canonical URLs preserve count date, calendar category/item/mode, reports and administrative destinations',()=>{
 for(const input of [
  {section:'inventory',view:'calendar',tab:'counts',date:'2026-09-14',category:'artificialKidney',item:'AK 1.5',mode:'month'},
  {section:'inventory',view:'reports',report:'monthly'},
  {section:'inventory',view:'calendar',tab:'consumption',report:'theoretical'},
  {section:'catastrophic'}, {section:'register'},
 ]) { const before=location(input);const url=nav.inventoryUrl(before);const after=location(Object.fromEntries(new URL('https://example.test'+url).searchParams));assert.equal(nav.inventoryUrl(after),url); }
 const invalid=location({section:'inventory',view:'__proto__',tab:'delete',date:'2026-02-30',category:'unknown'});
 assert.equal(invalid.view,'overview');assert.equal(invalid.tab,'dashboard');assert.equal(invalid.date,'');assert.equal(invalid.category,'');
});
test('query/back cancellation never commits and its rollback does not ask a second time',()=>{
 const coordinator=new nav.InventoryNavigation();const counts=location({section:'inventory',view:'calendar',tab:'counts',date:'2026-09-14'});let prompts=0,commits=0,restored;
 coordinator.accept(counts,()=>{throw Error('initial load must not prompt');},()=>commits++,()=>{});
 const accepted=coordinator.accept(location({section:'inventory',view:'overview'}),()=>{prompts++;return false;},()=>{throw Error('cancel must not commit');},url=>restored=url);
 assert.equal(accepted,false);assert.equal(restored,nav.inventoryUrl(counts));assert.equal(commits,1);
 coordinator.accept(counts,()=>{prompts++;return false;},()=>commits++,()=>{});assert.equal(prompts,1);assert.equal(commits,1);
});
test('accepted navigation commits once; failed draft persistence rolls the URL back',()=>{
 const coordinator=new nav.InventoryNavigation();const a=location({section:'inventory'}),b=location({section:'inventory',view:'calendar'});coordinator.accept(a,()=>true,()=>{},()=>{});let prompts=0,restored='';
 assert.equal(coordinator.accept(b,()=>{prompts++;return true;},()=>false,url=>restored=url),false);assert.equal(coordinator.accepted,a);assert.equal(restored,nav.inventoryUrl(a));
 let commits=0;assert.equal(coordinator.accept(b,()=>{prompts++;return true;},()=>{commits++;},()=>{}),true);assert.equal(prompts,2);assert.equal(commits,1);
});
function inventory(globals={}) {
 const {InventoryComponent}=load('features/inventory/inventory.component.ts',{'./inventory-navigation':nav},globals);return Object.create(InventoryComponent.prototype);
}
test('real inventory query handler preserves count snapshot and form when the user cancels',async()=>{
 const p=inventory();const a=location({section:'inventory',view:'calendar',tab:'counts',date:'2026-09-14'});let prompts=0;const urls=[];
 Object.assign(p,{navigation:new nav.InventoryNavigation(),checkCanLeave:()=>{prompts++;return false;},countSnapshot:'server-baseline',countNotes:'draft',destroyed:false,router:{navigateByUrl:async url=>urls.push(url)},applyLocation(){throw Error('must not apply');},saveCountDraft(){throw Error('must not persist on cancel');}});p.navigation.accepted=a;
 p.acceptLocation({section:'inventory',view:'overview'});await Promise.resolve();assert.equal(p.countSnapshot,'server-baseline');assert.equal(p.countNotes,'draft');assert.equal(prompts,1);assert.equal(urls[0],nav.inventoryUrl(a));
});
test('real leave check remains pure, and storage failure blocks accepted route exit',()=>{
 let confirmations=0;const p=inventory({confirm:()=>{confirmations++;return true;}});
 Object.assign(p,{applicationEditor:null,calendar:null,countsLoading:()=>false,countsSaving:()=>false,isUploading:()=>false,orderCreating:()=>false,showOrderPreview:()=>false,hasUnsavedChanges:()=>true,countSnapshot:'saved',saveCountDraft:()=>false});
 assert.equal(p.checkCanLeave(),true);assert.equal(p.countSnapshot,'saved');assert.equal(confirmations,1);assert.equal(p.canLeave(),false);assert.equal(p.countSnapshot,'saved');
});
test('accepted query persists draft once before changing view without double leave confirmation',()=>{
 const p=inventory();let prompts=0,saves=0,commits=0;
 Object.assign(p,{navigation:new nav.InventoryNavigation(),checkCanLeave:()=>{prompts++;return true;},hasUnsavedChanges:()=>true,saveCountDraft:()=>{saves++;return true;},draftSnapshot:()=> 'local-draft',countSnapshot:'server',saveScroll(){},applyLocation(){commits++;},router:{navigateByUrl:async()=>true}});
 p.navigation.accepted=location({section:'inventory',view:'calendar',tab:'counts'});p.acceptLocation({section:'inventory',view:'reports'});
 assert.equal(prompts,1);assert.equal(saves,1);assert.equal(commits,1);assert.equal(p.countSnapshot,'local-draft');
});
test('calendar requests selection without changing date before parent approval',async()=>{
 const {PurchaseCalendarComponent}=load('features/inventory/purchase-calendar.component.ts');const p=Object.create(PurchaseCalendarComponent.prototype);let target;
 Object.assign(p,{selectedDate:signal('2026-09-14'),filterCategory:()=> 'artificialKidney',filterItem:()=> 'AK',mode:()=> 'month',dateSelected:{emit:value=>target=value}});
 await p.selectDay('2026-09-15');assert.equal(p.selectedDate(),'2026-09-14');assert.equal(target.date,'2026-09-15');assert.equal(target.item,'AK');assert.equal(target.mode,'month');
});
test('HIS late response cannot reopen closed dialog or replace newer same-source request',async()=>{
 const {PurchaseCalendarComponent}=load('features/inventory/purchase-calendar.component.ts');const p=Object.create(PurchaseCalendarComponent.prototype);const a=deferred(),b=deferred();let calls=0;
 Object.assign(p,{sourceRequest:0,selectedSource:signal(null),stock:{ensureActualRanges:()=>++calls===1?a.promise:b.promise}});
 const source={rangeKey:'x',category:'artificialKidney',startDate:'2026-09-14',endDate:'2026-09-14'};const first=p.openSource(source);p.closeSource();const second=p.openSource(source);
 b.resolve([{start:source.startDate,end:source.endDate,grouped:{artificialKidney:{AK:3}}}]);await second;a.resolve([{start:source.startDate,end:source.endDate,grouped:{artificialKidney:{AK:99}}}]);await first;
 assert.equal(p.selectedSource().items[0].quantity,3);p.closeSource();assert.equal(p.selectedSource(),null);
});
test('central inventory authorization remains admin/viewer and other pages keep their original roles',()=>{
 const {canAccessPage}=load('core/config/page-access.ts');assert.equal(canAccessPage('inventory','admin'),true);assert.equal(canAccessPage('inventory','viewer'),true);assert.equal(canAccessPage('inventory','editor'),false);assert.equal(canAccessPage('inventory','contributor'),false);assert.equal(canAccessPage('accountSettings','viewer'),true);
});

function countLoader() {
 const {InventoryComponent}=load('features/inventory/inventory.component.ts',{'./inventory-navigation':nav,rxjs:{firstValueFrom:value=>value}});
 const p=Object.create(InventoryComponent.prototype);const urls=[];
 Object.assign(p,{countFilter:{date:'2026-09-15'},countOwnerDate:'2026-09-14',countRevision:7,countNotes:'unsaved draft',countSnapshot:'temporarily accepted draft',countRequest:0,countsLoading:signal(false),destroyed:false,hasUnsavedChanges:()=>true,navigation:new nav.InventoryNavigation(),workDate:signal('2026-09-15'),activeTab:signal('counts'),inventoryView:signal('calendar'),showAlert(){},router:{navigateByUrl:async url=>{urls.push(url);return true;}}});
 p.navigation.accepted=location({section:'inventory',view:'calendar',tab:'counts',date:'2026-09-15'});return {p,urls};
}
test('failed count date load rolls URL/work date back without erasing original draft, owner or revision',async()=>{
 const {p,urls}=countLoader();p.api={get:async()=>{throw Error('503');}};
 await p.loadCountDoc(true,'original server snapshot');
 assert.equal(p.countOwnerDate,'2026-09-14');assert.equal(p.countRevision,7);assert.equal(p.countNotes,'unsaved draft');assert.equal(p.countSnapshot,'original server snapshot');assert.equal(p.workDate(),'2026-09-14');assert.equal(p.navigation.accepted.date,'2026-09-14');assert.match(urls[0],/date=2026-09-14/);assert.equal(p.countsLoading(),false);
});
test('stale failed count request cannot roll back a later successful owner or its URL',async()=>{
 const {p,urls}=countLoader();const old=deferred();p.api={get:()=>old.promise};const pending=p.loadCountDoc(true,'old snapshot');
 p.countRequest++;p.countOwnerDate='2026-09-16';p.countFilter.date='2026-09-16';p.countRevision=8;p.countSnapshot='new snapshot';p.workDate.set('2026-09-16');p.navigation.accepted=location({section:'inventory',view:'calendar',tab:'counts',date:'2026-09-16'});old.reject(Error('late 503'));await pending;
 assert.equal(p.countOwnerDate,'2026-09-16');assert.equal(p.countRevision,8);assert.equal(p.countSnapshot,'new snapshot');assert.equal(p.navigation.accepted.date,'2026-09-16');assert.equal(urls.length,0);
});
test('count day arrows use central date navigation without mutating the editable date',()=>{
 const {InventoryComponent}=load('features/inventory/inventory.component.ts',{'./inventory-navigation':nav,'@/utils/dateStep':load('../utils/dateStep.ts')});
 const p=Object.create(InventoryComponent.prototype);let target;p.countFilter={date:'2026-09-14'};p.openCountDate=value=>target=value;p.stepCountDate(1);assert.equal(target,'2026-09-15');assert.equal(p.countFilter.date,'2026-09-14');p.stepCountDate(-1);assert.equal(target,'2026-09-13');assert.equal(p.countFilter.date,'2026-09-14');
 // The source template must wire both arrows through the tested central entry point.
 const html=readFileSync(new URL('features/inventory/inventory.component.html',base),'utf8');assert.match(html,/stepCountDate\(-1\)/);assert.match(html,/stepCountDate\(1\)/);assert.doesNotMatch(html,/stepDate\(countFilter/);
});

test('direct count URL locks editing during shared initialization before the count request starts',()=>{
 const p=inventory();Object.assign(p,{inventoryReady:false,countsLoading:signal(false),mainTab:signal(''),inventoryView:signal(''),activeTab:signal(''),consumptionSubTab:signal(''),workDate:signal(''),stock:{todayString:()=> '2026-09-14'}});
 p.applyLocation(location({section:'inventory',view:'calendar',tab:'counts',date:'2026-09-14'}));assert.equal(p.countsLoading(),true);assert.equal(p.activeTab(),'counts');
 const html=readFileSync(new URL('features/inventory/inventory.component.html',base),'utf8');assert.match(html,/<fieldset[^>]+\[disabled\]="countsSaving\(\) \|\| countsLoading\(\)"/);
});

test('all CI section links prevent base-href navigation and focus the local section',()=>{
 const {CatastrophicIllnessComponent}=load('features/catastrophic-illness/catastrophic-illness.component.ts',{'@angular/core':{Component:()=>x=>x,Input:()=>()=>{},HostBinding:()=>()=>{},HostListener:()=>()=>{},ChangeDetectionStrategy:{}}});
 const p=Object.create(CatastrophicIllnessComponent.prototype);const events=[];const section={scrollIntoView:options=>events.push(['scroll',options.block]),focus:options=>events.push(['focus',options.preventScroll])};
 p.navigateSection({preventDefault:()=>events.push(['prevent']),currentTarget:{closest:selector=>{assert.equal(selector,'.ci-page');return {querySelector:selector=>{assert.equal(selector,'#ci-labs');return section;}};}}},'ci-labs');assert.equal(JSON.stringify(events),JSON.stringify([['prevent'],['scroll','start'],['focus',true]]));
 const html=readFileSync(new URL('features/catastrophic-illness/catastrophic-illness.component.html',base),'utf8');const anchors=[...html.matchAll(/<a[^>]+href="#(ci-[a-z-]+)"[^>]*>/g)];assert.equal(anchors.length,10);for(const [tag,id] of anchors){assert.ok(tag.includes('navigateSection($event, '+"'"+id+"'"+')'));assert.ok(html.includes('id="'+id+'" tabindex="-1"'));}
});
