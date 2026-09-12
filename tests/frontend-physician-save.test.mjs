import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(new URL('../angular-client/package.json',import.meta.url));
const ts=require('typescript');
const signal=value=>Object.assign(()=>value,{set:v=>value=v,update:f=>value=f(value)});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function page(apis={}) {
 const source=readFileSync(process.env.PHYSICIAN_SAVE_SOURCE || new URL('../angular-client/src/app/features/physician-schedule/physician-schedule.component.ts',import.meta.url),'utf8');
 const module={exports:{}};const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,experimentalDecorators:true}}).outputText;
 vm.runInNewContext(compiled,{module,exports:module.exports,structuredClone,Date,console:{error(){}},setTimeout:()=>0,confirm:()=>false,require:name=>name==='@angular/core'?{Component:()=>x=>x,Input:()=>()=>{},HostListener:()=>()=>{},HostBinding:()=>()=>{},ChangeDetectionStrategy:{}}:{}});
 const p=Object.create(module.exports.PhysicianScheduleComponent.prototype);
 const date=signal(new Date(2026,8,1));
 Object.assign(p,{isLoading:signal(false),isSaving:signal(false),isSyncingHolidays:signal(false),isImportingHolidayCsv:signal(false),failedSaveJobs:signal([]),saveResults:signal([]),saveError:signal(''),saveSnapshot:'',hasUnsavedChanges:signal(true),selectedDate:date,selectedYear:()=>date().getFullYear(),selectedMonth:()=>date().getMonth()+1,selectedYearMonth:()=>`${date().getFullYear()}-${String(date().getMonth()+1).padStart(2,'0')}`,availablePhysicians:signal([{id:'doc',name:'Doctor',clinicHours:['old']}]),physicianClinicSelections:{doc:['new']},monthlyPdClinicSelections:{},scheduleData:{1:{early:{physicianId:'doc'}}},consultationScheduleData:{},emergencyRecords:[],scheduleNotes:'submitted',managedHolidays:[],bloodDrawDate1:'',bloodDrawDate2:'',reportDate1:'',reportDate2:'',physicianSchedulesApi:{save:async()=>{}},usersApi:{update:async()=>{}},isAutocompleteVisible:signal(false),showAlert(){},authService:{canManagePhysicianSchedule:()=>true},...apis});return p;
}
test('saving suppresses duplicate PUT and blocks month navigation',async()=>{
 const gate=deferred();let writes=0;const p=page({physicianSchedulesApi:{save:()=>{writes++;return gate.promise;}}});
 const first=p.saveAllChanges();const second=p.saveAllChanges();await Promise.resolve();const count=writes;const busy=p.isSaving();gate.resolve();await Promise.all([first,second]);
 assert.equal(count,1);assert.equal(busy,true);
});
test('a failed PUT does not unlock while another PUT is still in flight',async()=>{
 const gate=deferred();const p=page({physicianSchedulesApi:{save:()=>gate.promise},usersApi:{update:async()=>{throw Error('503');}}});
 const pending=p.saveAllChanges();await new Promise(r=>setImmediate(r));const busy=p.isSaving();gate.resolve();await pending;
 assert.equal(busy,true);assert.equal(p.isSaving(),false);assert.equal(p.hasUnsavedChanges(),true);
});
test('retry sends only failed original snapshot and never repeats successful month PUT',async()=>{
 let fail=true;const calls=[];const p=page({physicianSchedulesApi:{save:async(id,data)=>{calls.push({kind:'schedule',id,data});}},usersApi:{update:async(id,data)=>{calls.push({kind:'clinic',id,data});if(fail)throw Error('503');}}});
 await p.saveAllChanges();assert.equal(p.failedSaveJobs().length,1);assert.equal(p.saveResults().filter(r=>r.success).length,1);
 p.physicianClinicSelections.doc=['newer draft'];p.scheduleNotes='later edit';fail=false;await p.retryFailedSaves();
 assert.equal(calls.filter(c=>c.kind==='schedule').length,1);const clinic=calls.filter(c=>c.kind==='clinic');assert.equal(clinic.length,2);assert.deepEqual(Array.from(clinic[1].data.clinicHours),['new']);
 assert.equal(p.availablePhysicians()[0].clinicHours[0],'new');assert.equal(p.hasUnsavedChanges(),true);assert.equal(p.failedSaveJobs().length,0);
});
test('submitted nested month payload is detached and successful later edits stay dirty',async()=>{
 const gate=deferred();let submitted;const p=page({physicianSchedulesApi:{save:async(id,data)=>{submitted={id,data};await gate.promise;}}});
 p.emergencyRecords=[{date:'2026-09-01',reason:'original',startTime:'08:00',endTime:'09:00',physicianId:'doc'}];p.managedHolidays=[{date:'2026-09-28',name:'original'}];
 const pending=p.saveAllChanges();await Promise.resolve();p.emergencyRecords[0].reason='changed';p.managedHolidays[0].name='changed';p.selectedDate.set(new Date(2026,9,1));
 gate.resolve();await pending;assert.equal(submitted.id,'2026-09');assert.equal(submitted.data.emergencyRecords[0].reason,'original');assert.equal(submitted.data.managedHolidays[0].name,'original');assert.equal(p.hasUnsavedChanges(),true);
});
test('saving rejects direct date, mutation and confirm-close callbacks, and beforeunload',()=>{
 const p=page();p.isSaving.set(true);p.confirmAction=signal(()=>{throw Error('must not close/navigate');});p.cancelAction=p.confirmAction;
 const before=p.selectedYearMonth();p.goToNextMonth();p.goToPreviousMonth();p.addEmergencyRecord();p.handleConfirm();p.handleCancel();assert.equal(p.selectedYearMonth(),before);assert.equal(p.emergencyRecords.length,0);assert.equal(p.canLeave(),false);
 let prevented=false;const event={preventDefault(){prevented=true;},returnValue:undefined};p.beforeUnload(event);assert.equal(prevented,true);assert.equal(event.returnValue,'');
});
test('unchanged complete save clears dirty and role remains enforced',async()=>{
 const p=page();await p.saveAllChanges();assert.equal(p.hasUnsavedChanges(),false);assert.equal(p.saveResults().every(r=>r.success),true);
 const denied=page({authService:{canManagePhysicianSchedule:()=>false},physicianSchedulesApi:{save:()=>{throw Error('unauthorized write');}}});await denied.saveAllChanges();assert.equal(denied.saveResults().length,0);
});
