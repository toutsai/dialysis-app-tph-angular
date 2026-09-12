import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(new URL('../angular-client/package.json', import.meta.url));
const ts = require('typescript');
const read = path => readFileSync(new URL('../angular-client/src/app/' + path, import.meta.url), 'utf8');
const signal = value => Object.assign(() => value, { set: v => { value = v; }, update: f => { value = f(value); } });
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function run(code, globals = {}) {
  const module = { exports: {} };
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true } }).outputText;
  vm.runInNewContext(js, { module, exports: module.exports, console: { error(){}, warn(){}, log(){} }, Date, Set, ...globals });
  return module.exports;
}
const { LatestRequest } = run(read('core/utils/latest-request.ts'));
const dateKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
function subject(feature, names, globals = {}) {
  const path = feature.startsWith('components/') ? feature : `features/${feature}/${feature}.component.ts`;
  const text = read(path), ast = ts.createSourceFile(path, text, ts.ScriptTarget.ES2022, true);
  const cls = ast.statements.find(ts.isClassDeclaration);
  const methods = names.map(name => { const m = cls.members.find(x => x.name?.getText(ast) === name); assert(m, name); return m.getText(ast); });
  return new (run('export class Subject {' + methods.join('\n') + '}', { HostListener: () => () => {}, ...globals }).Subject)();
}
function nurse(names) {
  const p = subject('nursing-schedule', names);
  Object.assign(p, { selectedMonth: '2026-09', loadedMonth: '', monthRequest: new LatestRequest(), adjacentRequest: new LatestRequest(),
    isLoadingSchedule: signal(false), adjacentMonthsLoading: signal(false), scheduleLoadError: signal(''), adjacentLoadError: signal(''),
    uploadStatus: signal(''), isGroupEditMode: signal(false), isShiftEditMode: signal(false), hasUnsavedShiftChanges: signal(false), _scheduleVersion: signal(0),
    activeWeekTab: signal(1), weeklyData: [], isUploading: signal(false), isSavingDuties: signal(false), cancelGroupEditMode(){},
    getAdjacentMonths: month => ({prevYearMonth: month + '-previous', nextYearMonth: month + '-next'}) });
  return p;
}
test('nursing month responses and finally belong to latest requested month, including old failure', async () => {
  const p = nurse(['loadMonthlySchedule']), a = deferred(), b = deferred();
  p.nursingSchedulesApi = { fetchById: month => month === '2026-09' ? a.promise : b.promise };
  const adjacent = []; p.loadAdjacentMonthSchedules = month => adjacent.push(month);
  const first = p.loadMonthlySchedule(); p.selectedMonth = '2026-10'; const second = p.loadMonthlySchedule();
  b.resolve({ title: 'October', scheduleByNurse: {} }); await second;
  a.resolve({ title: 'September' }); await first;
  assert.equal(p.monthlySchedule.title, 'October'); assert.equal(p.loadedMonth, '2026-10');
  assert.deepEqual(adjacent, ['2026-10']); assert.equal(p.isLoadingSchedule(), false);
  const c = deferred(), d = deferred(); let index = 0; p.nursingSchedulesApi.fetchById = () => [c,d][index++].promise;
  const old = p.loadMonthlySchedule(); p.selectedMonth = '2026-11'; const fresh = p.loadMonthlySchedule();
  c.reject(Error('old request failed')); await old;
  assert.equal(p.isLoadingSchedule(), true); assert.equal(p.scheduleLoadError(), '');
  d.resolve(null); await fresh; assert.equal(p.loadedMonth, '2026-11'); assert.equal(p.monthlySchedule, null);
});
test('adjacent month results cannot cross the active month and failure is explicit', async () => {
  const p = nurse(['loadAdjacentMonthSchedules']), gates = Array.from({length:4}, deferred); let index = 0;
  p.nursingSchedulesApi = { fetchById: () => gates[index++].promise };
  const old = p.loadAdjacentMonthSchedules('2026-09'); p.selectedMonth = '2026-10'; const fresh = p.loadAdjacentMonthSchedules('2026-10');
  gates[2].resolve({title:'current previous'}); gates[3].resolve({title:'current next'}); await fresh;
  gates[0].resolve({title:'stale previous'}); gates[1].resolve({title:'stale next'}); await old;
  assert.equal(p.prevMonthSchedule.title, 'current previous'); assert.equal(p.nextMonthSchedule.title, 'current next');
  p.nursingSchedulesApi.fetchById = async () => { throw Error('offline'); };
  await p.loadAdjacentMonthSchedules('2026-10'); assert(p.adjacentLoadError()); assert.equal(p.prevMonthSchedule, null);
});
test('late nursing group configuration cannot replace a later month configuration', async () => {
  const old=deferred(),fresh=deferred();
  const p=subject('nursing-schedule',['loadGroupConfig'],{fetchNursingGroupConfig:month=>month==='2026-09'?old.promise:fresh.promise,getDefaultConfig:()=>({})});
  Object.assign(p,{groupConfigRequest:new LatestRequest(),selectedMonth:'2026-09'});
  const a=p.loadGroupConfig();p.selectedMonth='2026-10';const b=p.loadGroupConfig();
  fresh.resolve({config:{label:'October'},sourceMonth:'2026-10'});await b;old.resolve({config:{label:'September'},sourceMonth:'2026-09'});await a;
  assert.equal(p.groupConfig.label,'October');assert.equal(p.configSourceMonth,'2026-10');
});
test('all nursing schedule saves reject data belonging to another month without writes', async () => {
  for (const method of ['executeShiftSave','executeWeekSave','executeMonthSave']) {
    const p = nurse(['canSaveLoadedMonth', method]); p.loadedMonth = '2026-08'; p.monthlySchedule = {scheduleByNurse:{}};
    p.nursingSchedulesApi = { update(){ assert.fail('wrong-month write'); } };
    await p[method](); assert(p.uploadStatus()); assert.equal(p.isUploading(), false);
  }
});
for (const feature of ['weekly','stats']) test(`${feature} guards dirty navigation, in-flight saves and closing the tab`, () => {
  let prompts = 0; const p = subject(feature, ['canLeave','onBeforeUnload'], { window: {confirm(){ prompts++; return false; }} });
  Object.assign(p, feature === 'weekly' ? {hasUnsavedChanges:signal(true),isSaving:signal(false)} : {hasUnsavedChanges:true,isSavingUi:false});
  assert.equal(p.canLeave(), false); assert.equal(prompts, 1);
  let prevented = false; p.onBeforeUnload({preventDefault(){prevented=true;},returnValue:undefined}); assert(prevented);
  if(feature==='weekly'){p.hasUnsavedChanges.set(false);p.isSaving.set(true);}else{p.hasUnsavedChanges=false;p.isSavingUi=true;}
  assert.equal(p.canLeave(), false); assert.equal(prompts, 1);
});
test('collaboration read failure keeps prior local status and concurrent retry is single-flight', async () => {
  const p = subject('collaboration', ['updateTaskStatus'], {alert(){}}), gate = deferred(); let writes=0, local=0;
  Object.assign(p,{ auth:{currentUser:()=>({uid:'synthetic'})},pendingStatus:new Set(),
    tasksApi:{update:()=>{writes++;return gate.promise;}},taskStore:{updateItemLocally(){local++;}},notificationService:{show(){}} });
  const first=p.updateTaskStatus('task','completed'); await p.updateTaskStatus('task','completed');
  assert.equal(writes,1); assert.equal(local,0); gate.reject(Error('offline')); await first;
  assert.equal(local,0); assert.equal(p.pendingStatus.size,0);
  p.tasksApi.update=async()=>{}; await p.updateTaskStatus('task','completed'); assert.equal(local,1);
});
test('collaboration edit failure preserves dialog and exposes error, then retry closes only on success',async()=>{
  const p=subject('collaboration',['handleTaskSubmit','updateTask','closeCreateModal']);let calls=0;const gate=deferred();
  Object.assign(p,{editBusy:signal(false),editError:signal(''),editingItem:signal({id:'task'}),isCreateModalVisible:signal(true),tasksApi:{update(){calls++;return gate.promise;}}});
  const first=p.handleTaskSubmit({id:'task',content:'kept draft'});await p.handleTaskSubmit({id:'task',content:'duplicate'});
  assert.equal(calls,1);p.closeCreateModal();assert.equal(p.isCreateModalVisible(),true);
  gate.reject(Error('offline'));await first;assert.equal(p.isCreateModalVisible(),true);assert.equal(p.editError(),'offline');
  p.tasksApi.update=async()=>{};await p.handleTaskSubmit({id:'task',content:'kept draft'});assert.equal(p.isCreateModalVisible(),false);
});
test('new task dialog retains draft and actionable error on failed write without duplicate submission',async()=>{
  const p=subject('components/dialogs/task-create-dialog/task-create-dialog.component.ts',['handleSubmit','handleClose','busy']);const gate=deferred();let writes=0,closed=0;
  Object.assign(p,{isSubmitting:false,externalBusy:false,isClerkSupplyTask:false,isFormValid:true,isEditMode:false,
    authService:{currentUser:()=>({uid:'synthetic'})},formData:{category:'message',content:'draft',targetDate:'2026-09-14',messageType:'regular'},
    tasksApi:{save(){writes++;return gate.promise;}},close:{emit(){closed++;}}});
  const first=p.handleSubmit();await p.handleSubmit();p.handleClose();assert.equal(writes,1);assert.equal(closed,0);
  gate.reject(Error('offline'));await first;assert.equal(p.formData.content,'draft');assert(p.submitError);assert.equal(p.isSubmitting,false);
});
test('failed scheduled changes load has explicit error and can retry to legitimate empty',async()=>{
  const p=subject('update-scheduler',['fetchScheduledUpdates']);Object.assign(p,{isFetchingUpdates:false,isLoading:signal(true),loadError:signal(''),scheduledUpdates:signal([]),scheduledUpdatesApi:{fetchAll:async()=>{throw Error('offline');}}});
  await p.fetchScheduledUpdates();assert(p.loadError());assert.equal(p.isLoading(),false);
  p.scheduledUpdatesApi.fetchAll=async()=>[];await p.fetchScheduledUpdates();assert.equal(p.loadError(),'');assert.equal(p.scheduledUpdates().length,0);
});
test('failed base schedule load never manufactures a writable empty master record',async()=>{
  const p=subject('base-schedule',['loadAllData']);Object.assign(p,{loadingBase:signal(false),loadError:signal(''),statusText:signal(''),masterRecord:signal(null),patientStore:{fetchPatientsIfNeeded:async()=>{}},baseSchedulesApi:{fetchById:async()=>{throw Error('offline');}}});
  await p.loadAllData();assert.equal(p.masterRecord(),null);assert(p.loadError());assert.equal(p.loadingBase(),false);
});
test('failed exception load remains distinguishable from no exceptions and retry subscribes only after success',async()=>{
  const p=subject('exception-manager',['initializePageData']);let subscribed=0;
  Object.assign(p,{sseSubscriptions:[],loadError:signal(''),isLoading:signal(false),exceptions:signal([]),patientStore:{fetchPatientsIfNeeded:async()=>{}},exceptionsListApi:{fetchAll:async()=>{throw Error('offline');}},startExceptionEventStream(){subscribed++;}});
  await p.initializePageData();assert(p.loadError());assert.equal(subscribed,0);
  p.exceptionsListApi.fetchAll=async()=>[];await p.initializePageData();assert.equal(p.loadError(),'');assert.equal(subscribed,1);
});
test('base schedule partial success names the failed nursing step without repeating the completed bed move',async()=>{
  let moves=0,alerts=[];
  const p=subject('base-schedule',['applyRuleToTodayCurrentShift'],{
    getCurrentShiftCode:()=> 'early',ORDERED_SHIFT_CODES:['early','noon','late'],isShiftEndedToday:()=>false,
    getShiftDisplayName:code=>code,getShiftCodeFromSlotKey:()=> 'early',buildScheduleKey:()=> 'new-noon',
    fetchTeamsByDate:async()=>({teams:{'patient-early':'A'},version:1}),updateTeams:async()=>{throw Error('offline');}
  });
  Object.assign(p,{patientStore:{patientMap:()=>new Map([['patient',{name:'Synthetic'}]])},schedulesApi:{fetchWhere:async()=>[{id:'day',schedule:{'old-early':{patientId:'patient'}},version:1}],update:async()=>{moves++;}},partialSuccessDate:signal(null),statusText:signal(''),showAlert:(...args)=>alerts.push(args)});
  await p.applyRuleToTodayCurrentShift('patient',2,1);assert.equal(moves,1);assert.match(p.statusText(),/尚未同步/);assert.equal(alerts[0][0],'部分完成，需核對分組');
});
test('failed deletion retains confirmation and original selected message with single-flight protection',async()=>{
  const p=subject('collaboration',['executeDeleteTask','cancelDelete']);const gate=deferred();let writes=0;
  Object.assign(p,{deleteBusy:signal(false),deleteError:signal(''),itemToDelete:signal({id:'task'}),isConfirmDeleteVisible:signal(true),tasksApi:{delete(){writes++;return gate.promise;}}});
  const first=p.executeDeleteTask();await p.executeDeleteTask();p.cancelDelete();assert.equal(writes,1);assert.equal(p.isConfirmDeleteVisible(),true);
  gate.reject(Error('offline'));await first;assert.equal(p.itemToDelete().id,'task');assert(p.deleteError());assert.equal(p.deleteBusy(),false);
});

test('stats delayed save locks drop/date/reload, submits immutable data and preserves a later external draft', async()=>{
  const gate=deferred();let calls=0,payload;
  const p=subject('stats',['attemptSaveChangesToCloud','isPageLocked','onDrop','changeDate','goToToday','loadData','buildCleanScheduleForSave']);
  Object.assign(p,{isSavingUi:false,orderSaving:false,isLoading:false,cachedIsPageLocked:false,currentDate:new Date('2026-09-14T00:00:00'),formatDate:dateKey,dayRequest:new LatestRequest(),
    currentRecord:{id:'day',date:'2026-09-14',version:2,schedule:{bed:{patientId:'synthetic',note:'submitted'}}},currentTeamsRecord:{date:'2026-09-14',teams:{},names:{}},hasUnsavedScheduleChanges:true,hasUnsavedTeamChanges:false,
    schedulesApi:{update:async(id,data)=>{calls++;payload=data;return gate.promise;}},showAlert(){},updateStatsCache(){},notificationService:{createGlobalNotification(){}}});
  const pending=p.attemptSaveChangesToCloud(false);assert.equal(p.isPageLocked,true);
  p.onDrop({preventDefault(){throw Error('drop must not start');}},'bed','A','early');p.changeDate(1);p.goToToday();await p.loadData(new Date('2026-09-15'));await p.attemptSaveChangesToCloud(false);
  assert.equal(dateKey(p.currentDate),'2026-09-14');assert.equal(calls,1);
  p.currentRecord.schedule.bed.note='external later draft';assert.equal(payload.schedule.bed.note,'submitted');
  gate.resolve({version:3});await pending;assert.equal(p.currentRecord.schedule.bed.note,'external later draft');assert.equal(p.hasUnsavedScheduleChanges,true);assert.equal(p.currentRecord.version,3);assert.equal(p.isSavingUi,false);
});

test('stats old load cannot overwrite a new date or saving owner',async()=>{
  const first=deferred(),second=deferred();let fetches=0;
  const p=subject('stats',['loadData'],{fetchTeamsByDate:async()=>({teams:{},names:{}})});
  Object.assign(p,{isSavingUi:false,currentDate:new Date('2000-01-01T00:00:00'),dayRequest:new LatestRequest(),formatDate:dateKey,currentRecord:{schedule:{}},loadConflictExceptions(){},fetchArchivedSchedule:()=>++fetches===1?first.promise:second.promise,rebuildEmptyBeds(){},updateStatsCache(){}});
  const old=p.loadData(new Date(p.currentDate));p.currentDate=new Date('2000-01-02T00:00:00');const fresh=p.loadData(new Date(p.currentDate));
  second.resolve({id:'new',date:'2000-01-02',schedule:{}});await fresh;first.resolve({id:'old',date:'2000-01-01',schedule:{}});await old;
  assert.equal(p.currentRecord.id,'new');assert.equal(p.isLoading,false);
});

test('partial bed move link passes its date and stats actually consumes a valid query date',()=>{
  let navigation;const base=subject('base-schedule',['reviewNursingGroups']);Object.assign(base,{partialSuccessDate:signal('2026-09-14'),router:{navigate:(...args)=>navigation=args}});base.reviewNursingGroups();
  assert.equal(navigation[0][0],'/stats');assert.equal(navigation[1].queryParams.date,'2026-09-14');
  const stats=subject('stats',['initDateFromSharedState']);Object.assign(stats,{route:{snapshot:{queryParamMap:{get:()=>navigation[1].queryParams.date}}},dateState:{selectedDate:'2000-01-01',setDate(){}},formatDate:dateKey});stats.initDateFromSharedState();assert.equal(dateKey(stats.currentDate),'2026-09-14');
});

for(const method of ['executeShiftSave','executeMonthSave','executeWeekSave'])test(`nursing ${method} deferred save has immutable payload, blocks edits/navigation and keeps an external later draft`,async()=>{
  const p=nurse([method,'canSaveLoadedMonth','markShiftUnsaved','onWeekTabClick','shiftMonth','handleGroupChange']);const gate=deferred();let calls=0,payload;
  Object.assign(p,{loadedMonth:'2026-09',monthlySchedule:{maxDaysInMonth:2,scheduleByNurse:{n:{shifts:['D','D'],groups:['A','A']}}},tempScheduleWithGroups:{scheduleByNurse:{n:{shifts:['D','D'],groups:['B','B']}},weekConfirmed:{}},weeklyData:[{days:[{isCurrentMonth:true,dayIndex:0},{isCurrentMonth:true,dayIndex:1}]}],groupConfigRequest:new LatestRequest(),auth:{currentUser:()=>({name:'Synthetic'})},notificationService:{createGlobalNotification(){}},nursingSchedulesApi:{update:async(id,data)=>{calls++;payload=data;return gate.promise;}}});
  const pending=p[method]();p.shiftMonth(1);p.onWeekTabClick(2);p.handleGroupChange('n',0,{});await p[method]();assert.equal(calls,1);assert.equal(p.selectedMonth,'2026-09');assert.equal(p.activeWeekTab(),1);
  if(method==='executeShiftSave')p.monthlySchedule.scheduleByNurse.n.shifts[0]='later';else p.tempScheduleWithGroups.scheduleByNurse.n.groups[0]='later';
  assert.notEqual(payload.scheduleByNurse.n.groups[0],'later');assert.notEqual(payload.scheduleByNurse.n.shifts[0],'later');gate.resolve({});await pending;
  assert.match(p.uploadStatus(),/後續變更/);assert.equal(p.isUploading(),false);
});

for(const feature of ['stats','schedule'])test(`${feature} dialysis order waits once, locks owner and keeps failed modal draft`,async()=>{
  const gate=deferred();let calls=0,sent;const p=subject(feature,['handleSaveOrder','closeOrderModal',feature==='stats'?'openOrderModalFromPopover':'openOrderModalFromIcu'],{createDialysisOrderAndUpdatePatient:async(id,name,data)=>{calls++;sent=data;return gate.promise;}});
  const patient={id:'synthetic',name:'Synthetic'},data={note:'submitted'};
  Object.assign(p,feature==='stats'?{orderSaving:false,isSavingUi:false,isPageLocked:false,editingPatientForOrder:patient,isOrderModalVisible:true}:{orderSaving:signal(false),isSaving:signal(false),isHistoryView:()=>false,editingPatientForOrder:signal(patient),isOrderModalVisible:signal(true)});p.showAlert=()=>{};
  const pending=p.handleSaveOrder(data);await p.handleSaveOrder(data);p.closeOrderModal();p[feature==='stats'?'openOrderModalFromPopover':'openOrderModalFromIcu']({id:'other'});data.note='later';assert.equal(calls,1);assert.equal(sent.note,'submitted');
  assert.equal(feature==='stats'?p.editingPatientForOrder.id:p.editingPatientForOrder().id,'synthetic');gate.reject(Error('offline'));await pending;assert.equal(feature==='stats'?p.orderSaving:p.orderSaving(),false);assert.equal(feature==='stats'?p.isOrderModalVisible:p.isOrderModalVisible(),true);
});

test('nursing upload success really reloads its returned month while public reload stays blocked',async()=>{
  const gate=deferred();let loads=0,uploads=0;
  const p=subject('nursing-schedule',['processAndUpload','loadMonthlySchedule'],{fetch:async()=>{uploads++;return {json:async()=>({success:true,message:'imported',stats:{month:'2026-10'}})};}});
  Object.assign(p,{selectedFile:{name:'synthetic.xlsx'},selectedMonth:'2026-09',loadedMonth:'2026-09',isUploading:signal(false),isSavingDuties:signal(false),uploadStatus:signal(''),fileToBase64:async()=> 'synthetic',firebase:{apiBaseUrl:'/api',getHeaders:()=>({})},monthRequest:new LatestRequest(),adjacentRequest:new LatestRequest(),scheduleLoadError:signal(''),adjacentLoadError:signal(''),adjacentMonthsLoading:signal(false),isLoadingSchedule:signal(false),isGroupEditMode:signal(true),tempScheduleWithGroups:{stale:true},isShiftEditMode:signal(true),hasUnsavedShiftChanges:signal(true),_scheduleVersion:signal(0),activeWeekTab:signal(1),weeklyData:[],loadAdjacentMonthSchedules(){},nursingSchedulesApi:{fetchById:async month=>{loads++;assert.equal(month,'2026-10');return gate.promise;}}});
  const pending=p.processAndUpload();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(p.isUploading(),true);assert.equal(loads,1);assert.equal(p.isGroupEditMode(),false);assert.equal(p.tempScheduleWithGroups,null);
  await p.loadMonthlySchedule();await p.processAndUpload();assert.equal(loads,1);assert.equal(uploads,1);
  gate.resolve({scheduleByNurse:{},title:'October'});await pending;
  assert.equal(p.loadedMonth,'2026-10');assert.equal(p.monthlySchedule.title,'October');assert.equal(p.isUploading(),false);assert.equal(p.isLoadingSchedule(),false);
});

for(const failure of ['patients','schedule'])test(`successful schedule order closes immediately and ${failure} refresh failure cannot become a duplicate retry`,async()=>{
  const {ScheduleDraft}=run(readFileSync(new URL('../angular-client/src/utils/scheduleDraft.ts',import.meta.url),'utf8'));
  const gate=deferred();let writes=0,alerts=[];
  const p=subject('schedule',['handleSaveOrder','loadDataForDay'],{createDialysisOrderAndUpdatePatient:async()=>{writes++;},fetchTeamsByDate:async()=>({teams:{}})});
  Object.assign(p,{orderSaving:signal(false),isSaving:signal(false),isLoading:signal(false),isHistoryView:()=>false,isOrderModalVisible:signal(true),editingPatientForOrder:signal({id:'synthetic',name:'Synthetic'}),currentDate:signal(new Date('2000-01-01T00:00:00')),currentDateDisplay:()=> '2000-01-01',formatDate:dateKey,currentRecord:{date:'2000-01-01'},hasUnsavedChanges:signal(false),hasUnsavedTeamChanges:signal(false),statusIndicator:signal(''),draft:new ScheduleDraft(),loadConflictExceptions(){},archiveStore:{fetchScheduleByDate:()=>gate.promise},patientStore:{forceRefreshPatients:()=>failure==='patients'?gate.promise:Promise.resolve()},showAlert:(...args)=>alerts.push(args)});
  const pending=p.handleSaveOrder({note:'submitted'});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(writes,1);assert.equal(p.isOrderModalVisible(),false);assert.equal(p.editingPatientForOrder(),null);
  gate.reject(Error('503 refresh'));await pending;
  assert.equal(p.orderSaving(),false);assert.equal(alerts[0][0],'已儲存，更新畫面失敗');assert.match(alerts[0][1],/勿重複新增/);
  await p.handleSaveOrder({note:'submitted'});assert.equal(writes,1);
});
