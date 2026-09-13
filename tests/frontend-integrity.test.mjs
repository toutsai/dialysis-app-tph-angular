import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(new URL('../angular-client/package.json', import.meta.url));
const ts = require('typescript');
const sourceRoot = new URL('../angular-client/src/', import.meta.url);
const formatDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const signal = (initial) => {
  let value = initial;
  const getter = () => value;
  getter.set = (next) => { value = next; };
  getter.update = (fn) => { value = fn(value); };
  return getter;
};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

// Compile complete production modules. Only Angular rendering and external I/O are mocked;
// the page methods and their imported draft/conflict helpers execute unchanged.
function loadModule(path, dependencies = {}, globals = {}) {
  const module = { exports: {} };
  const output = ts.transpileModule(readFileSync(new URL(path, sourceRoot), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true },
    reportDiagnostics: true,
  });
  assert.equal((output.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error).length, 0);
  vm.runInNewContext(output.outputText, {
    module, exports: module.exports, structuredClone, Date, setTimeout, clearTimeout,
    console: { log() {}, warn() {}, error() {} },
    require(name) {
      if (name in dependencies) return dependencies[name];
      if (name === '@angular/core') return {
        Component: () => (target) => target, ViewChild: () => () => {}, ChangeDetectionStrategy: { OnPush: 0 },
      };
      if (name === '@/utils/scheduleDraft') return integrity;
      if (name === '@/utils/versionConflict') return conflicts;
      if (name === '@/utils/dateUtils') return { formatDateToYYYYMMDD: formatDate };
      return {};
    },
    ...globals,
  }, { filename: path });
  return module.exports;
}

const integrity = loadModule('utils/scheduleDraft.ts');
const conflicts = loadModule('utils/versionConflict.ts');

function dailyFixture(api = {}, globals = {}) {
  const { ScheduleComponent } = loadModule('app/features/schedule/schedule.component.ts', {
    '@/services/optimizedApiService': api,
    '@/services/nurseAssignmentsService': { fetchTeamsByDate: async () => null, ...api },
  }, globals);
  const page = Object.create(ScheduleComponent.prototype);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  Object.assign(page, {
    draft: new integrity.ScheduleDraft(), staffRequests: new integrity.ScheduleDraft(),
    currentDate: signal(today), currentDateDisplay: () => formatDate(page.currentDate()), formatDate,
    currentRecord: { id: formatDate(today), date: formatDate(today), version: 4, names: {}, schedule: {
      'bed-1-early': { patientId: 'synthetic-p1', shiftId: 'bed-1-early', manualNote: 'before' },
    } },
    currentTeamsRecord: signal({ id: formatDate(today), date: formatDate(today), version: 3, teams: {}, takeoffEnabled: true }),
    hasUnsavedChanges: signal(false), hasUnsavedTeamChanges: signal(false), scheduleRevision: signal(0),
    isSaving: signal(false), isLoading: signal(false), statusIndicator: signal(''),
    versionConflictMessage: signal(''), isVersionConflictDialogVisible: signal(false),
    isPageLocked: () => false, isTeamEditLocked: () => false,
    patientStore: { fetchPatientsIfNeeded: async () => {} },
    loadConflictExceptions() {}, showAlert(title, message) { page.alert = { title, message }; },
  });
  return page;
}

function weeklyFixture(api = {}) {
  const { WeeklyComponent } = loadModule('app/features/weekly/weekly.component.ts', {
    '@/services/optimizedApiService': api,
  });
  const page = Object.create(WeeklyComponent.prototype);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const date = formatDate(today);
  Object.assign(page, {
    draft: new integrity.ScheduleDraft(), currentWeekStartDate: signal(today),
    weekDates: () => [{ queryDate: date }, { queryDate: '2099-01-01' }], isDateEditable: (i) => i === 0,
    weekScheduleRecords: signal(new Map([[date, { id: date, date, version: 7, schedule: {
      'bed-1-early': { patientId: 'synthetic-p1', shiftId: 'bed-1-early', manualNote: 'before',
        modeOverride: 'HDF', transportMethod: '輪椅', archivedPatientInfo: { status: 'ipd' } },
    } }], ['2099-01-01', { id: '2099-01-01', date: '2099-01-01', version: 9, schedule: {} }]])),
    isSaving: signal(false), hasUnsavedChanges: signal(true), statusText: signal(''), isPageLocked: () => false,
    showAlert(title, message) { page.alert = { title, message }; },
  });
  return page;
}

test('occupied slot copy preserves metadata, detaches nested data, and validates before saving', () => {
  const original = { a: { patientId: 'p', shiftId: 'a', modeOverride: 'HDF', extra: { memo: 'retain' } }, empty: {} };
  const copy = integrity.copyOccupiedScheduleSlots(original);
  assert.deepEqual(structuredClone(copy), { a: original.a });
  copy.a.extra.memo = 'changed';
  assert.equal(original.a.extra.memo, 'retain');
  assert.throws(() => integrity.copyOccupiedScheduleSlots({ a: { patientId: 'p' } }), /shiftId/);
});

test('weekly save sends the full occupied slot and version, and writes only today', async () => {
  const calls = [];
  const page = weeklyFixture({ updateSchedule: async (id, payload) => { calls.push({ id, payload }); return { id, version: 8 }; } });
  await page.saveChangesToCloud();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.expectedVersion, 7);
  const slot = calls[0].payload.schedule['bed-1-early'];
  assert.equal(slot.modeOverride, 'HDF');
  assert.equal(slot.transportMethod, '輪椅');
  assert.equal(slot.archivedPatientInfo.status, 'ipd');
  assert.equal(page.hasUnsavedChanges(), false);
  assert.equal(page.weekScheduleRecords().get(calls[0].id).version, 8);
});

for (const source of ['missing range result', 'missing-day API response']) {
  test(`weekly first save uses the absent-row version from ${source}`, async () => {
    const calls = [];
    const page = weeklyFixture({ updateSchedule: async (id, payload) => { calls.push({ id, payload }); return { id, version: 0 }; } });
    const date = page.weekDates()[0].queryDate;
    page.patientStore = { fetchPatientsIfNeeded: async () => {} };
    page.apiManagerService = { create: () => ({ fetchWhere: async () => source === 'missing range result'
      ? [] : [{ id: date, date, version: -1, schedule: {}, createdAt: null, updatedAt: null }] }) };
    await page.loadDataForWeek();
    assert.equal(page.hasUnsavedChanges(), false);
    const record = page.weekScheduleRecords().get(date);
    assert.equal(record.version, -1);
    record.schedule['bed-1-early'] = { patientId: 'synthetic-new', shiftId: 'early', manualNote: 'first draft' };
    page.setChange();
    await page.saveChangesToCloud();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].id, date);
    assert.equal(calls[0].payload.expectedVersion, -1);
    assert.equal(calls[0].payload.schedule['bed-1-early'].manualNote, 'first draft');
    assert.equal(page.weekScheduleRecords().get(date).version, 0);
    assert.equal(page.hasUnsavedChanges(), false);
    assert.equal(page.isSaving(), false);
  });
}

test('weekly concurrent first save preserves the absent-row draft on conflict', async () => {
  let payload;
  const page = weeklyFixture({ updateSchedule: async (_id, data) => {
    payload = data;
    throw { status: 409, body: { code: 'VERSION_CONFLICT', currentVersion: 0 } };
  } });
  const date = page.weekDates()[0].queryDate;
  page.weekScheduleRecords().get(date).version = -1;
  const before = structuredClone(page.weekScheduleRecords());
  await page.saveChangesToCloud();
  assert.equal(payload.expectedVersion, -1);
  assert.deepEqual(page.weekScheduleRecords(), before);
  assert.equal(page.hasUnsavedChanges(), true);
  assert.match(page.statusText(), /衝突/);
  assert.equal(page.isSaving(), false);
});

test('weekly 409 retains the draft and original version', async () => {
  const page = weeklyFixture({ updateSchedule: async () => { throw { status: 409, body: { code: 'VERSION_CONFLICT', currentVersion: 8 } }; } });
  const before = structuredClone(page.weekScheduleRecords());
  await page.saveChangesToCloud();
  assert.deepEqual(page.weekScheduleRecords(), before);
  assert.equal(page.hasUnsavedChanges(), true);
  assert.match(page.statusText(), /衝突/);
  assert.equal(page.isSaving(), false);
});

test('weekly save keeps edits made in flight and rejects duplicate submission', async () => {
  const pending = deferred(); let calls = 0;
  const page = weeklyFixture({ updateSchedule: () => { calls++; return pending.promise; } });
  const save = page.saveChangesToCloud();
  const date = page.weekDates()[0].queryDate;
  page.weekScheduleRecords().get(date).schedule['bed-1-early'].manualNote = 'new';
  page.setChange();
  await page.saveChangesToCloud();
  pending.resolve({ id: date, version: 8 });
  await save;
  assert.equal(calls, 1);
  assert.equal(page.hasUnsavedChanges(), true);
  assert.equal(page.weekScheduleRecords().get(date).schedule['bed-1-early'].manualNote, 'new');
  assert.equal(page.weekScheduleRecords().get(date).version, 8);
});

test('delayed exception refresh rechecks edits made during its 800 ms delay', async () => {
  let callback, delay, loads = 0;
  const page = dailyFixture({}, { setTimeout: (fn, ms) => { callback = fn; delay = ms; return 1; } });
  page.exceptionAffectsDate = () => true;
  page.loadDataForDay = async () => { loads++; };
  page.loadDailyStaffInfo = async () => {};
  page.handleExceptionScheduleRefresh({});
  page.setChange();
  callback();
  assert.equal(delay, 800);
  assert.equal(loads, 0);
  assert.equal(page.hasUnsavedChanges(), true);
});

test('late daily response cannot replace a newer date or request', async () => {
  const old = deferred(), next = deferred();
  const page = dailyFixture();
  const firstDate = page.currentDateDisplay();
  page.fetchLiveSchedule = (date) => date === firstDate ? old.promise : next.promise;
  const firstLoad = page.loadDataForDay(page.currentDate());
  const tomorrow = new Date(page.currentDate()); tomorrow.setDate(tomorrow.getDate() + 1);
  page.currentDate.set(tomorrow);
  const secondDate = page.currentDateDisplay();
  const secondLoad = page.loadDataForDay(tomorrow);
  next.resolve({ id: secondDate, schedule: { next: { patientId: 'synthetic-next' } }, version: 2 });
  await secondLoad;
  old.resolve({ id: firstDate, schedule: { old: { patientId: 'synthetic-old' } }, version: 1 });
  await firstLoad;
  assert.equal(page.currentRecord.date, secondDate);
  assert.equal(page.currentRecord.schedule.next.patientId, 'synthetic-next');
  assert.equal(page.isLoading(), false);
});

test('daily response arriving after a new edit keeps the local draft dirty', async () => {
  const pending = deferred();
  const page = dailyFixture();
  page.fetchLiveSchedule = () => pending.promise;
  const loading = page.loadDataForDay(page.currentDate());
  page.currentRecord.schedule['bed-1-early'].manualNote = 'new draft';
  page.setChange();
  pending.resolve({ id: page.currentRecord.id, schedule: {}, version: 10 });
  await loading;
  assert.equal(page.currentRecord.schedule['bed-1-early'].manualNote, 'new draft');
  assert.equal(page.hasUnsavedChanges(), true);
  assert.equal(page.isLoading(), false);
});

for (const draftKind of ['schedule', 'teams']) {
  test(`returning to an unsaved ${draftKind} draft cancels the other date's loading state`, async () => {
    const pending = deferred();
    let payload, confirmations = 0, loads = 0;
    const page = dailyFixture({
      updateSchedule: async (_id, data) => { payload = data; return { version: 5 }; },
      updateTeams: async (_id, data) => { payload = data; return { version: 4 }; },
    });
    const originalDate = new Date(page.currentDate());
    page.dateState = { setDate() {} };
    page.showConfirm = (_title, _message, confirm) => { confirmations++; confirm(); };
    page.fetchLiveSchedule = () => { loads++; return pending.promise; };
    if (draftKind === 'schedule') {
      page.currentRecord.schedule['bed-1-early'].manualNote = 'keep my schedule';
      page.setChange();
    } else {
      page.isPageLocked = () => true;
      page.currentTeamsRecord().teams = { A: ['synthetic-nurse'] };
      page.setTeamChange();
    }
    const originalRecord = structuredClone(page.currentRecord);
    const originalTeams = structuredClone(page.currentTeamsRecord());
    page.changeDate(1);
    const otherDate = page.currentDateDisplay();
    const loadingOtherDay = page.loadDataForDay(page.currentDate());
    assert.equal(page.isLoading(), true);
    page.changeDate(-1);
    await page.loadDataForDay(page.currentDate());
    assert.equal(formatDate(page.currentDate()), formatDate(originalDate));
    assert.equal(confirmations, 2);
    assert.equal(loads, 1);
    assert.equal(page.isLoading(), false);
    assert.equal(page.statusIndicator(), '有未儲存的變更');
    if (draftKind === 'schedule') pending.resolve({ id: otherDate, date: otherDate, schedule: {}, version: 9 });
    else pending.reject(new Error('obsolete date failed'));
    await loadingOtherDay;
    assert.deepEqual(page.currentRecord, originalRecord);
    assert.deepEqual(page.currentTeamsRecord(), originalTeams);
    assert.equal(page.hasUnsavedChanges(), draftKind === 'schedule');
    assert.equal(page.hasUnsavedTeamChanges(), draftKind === 'teams');
    assert.equal(page.isLoading(), false);
    assert.equal(page.statusIndicator(), '有未儲存的變更');
    await page.saveDataToCloud();
    assert.equal(payload.expectedVersion, draftKind === 'schedule' ? 4 : 3);
    if (draftKind === 'schedule') assert.equal(payload.schedule['bed-1-early'].manualNote, 'keep my schedule');
    else assert.deepEqual(payload.teams, { A: ['synthetic-nurse'] });
    assert.equal(page.hasUnsavedChanges(), false);
    assert.equal(page.hasUnsavedTeamChanges(), false);
  });
}

test('same-day requests apply only the latest response', async () => {
  const older = deferred(), newer = deferred(); let calls = 0;
  const page = dailyFixture();
  page.fetchLiveSchedule = () => ++calls === 1 ? older.promise : newer.promise;
  const first = page.loadDataForDay(page.currentDate());
  const second = page.loadDataForDay(page.currentDate());
  older.resolve({ id: page.currentRecord.id, schedule: {}, version: 5 });
  await first;
  assert.equal(page.currentRecord.version, 4);
  assert.equal(page.isLoading(), true);
  newer.resolve({ id: page.currentRecord.id, schedule: {}, version: 6 });
  await second;
  assert.equal(page.currentRecord.version, 6);
  assert.equal(page.isLoading(), false);
});

test('daily save snapshots data, rejects duplicates, and keeps later edits dirty', async () => {
  const pending = deferred(); let calls = 0, payload;
  const page = dailyFixture({ updateSchedule: (_id, data) => { calls++; payload = data; return pending.promise; } });
  page.setChange();
  const saving = page.saveDataToCloud();
  page.currentRecord.schedule['bed-1-early'].manualNote = 'later';
  page.setChange();
  await page.saveDataToCloud();
  pending.resolve({ version: 5 });
  await saving;
  assert.equal(calls, 1);
  assert.equal(payload.schedule['bed-1-early'].manualNote, 'before');
  assert.equal(payload.expectedVersion, 4);
  assert.equal(page.currentRecord.version, 5);
  assert.equal(page.hasUnsavedChanges(), true);
  assert.equal(page.isSaving(), false);
});

test('a same-day reload during saving does not invalidate the save response', async () => {
  const pending = deferred();
  const page = dailyFixture({ updateSchedule: () => pending.promise });
  page.fetchLiveSchedule = () => { assert.fail('must keep the in-flight save'); };
  page.setChange();
  const saving = page.saveDataToCloud();
  await page.loadDataForDay(page.currentDate());
  assert.equal(page.statusIndicator(), '儲存中...');
  pending.resolve({ version: 5 });
  await saving;
  assert.equal(page.currentRecord.version, 5);
  assert.equal(page.hasUnsavedChanges(), false);
  assert.equal(page.isSaving(), false);
});

test('daily save clears unchanged revisions, but a 409 retains all draft state', async () => {
  const page = dailyFixture({ updateSchedule: async () => ({ version: 5 }) });
  page.setChange();
  await page.saveDataToCloud();
  assert.equal(page.hasUnsavedChanges(), false);
  const conflict = dailyFixture({ updateSchedule: async () => { throw { status: 409, error: { code: 'VERSION_CONFLICT' } }; } });
  conflict.setChange();
  await conflict.saveDataToCloud();
  assert.equal(conflict.hasUnsavedChanges(), true);
  assert.equal(conflict.currentRecord.version, 4);
  assert.equal(conflict.isVersionConflictDialogVisible(), true);
});

test('save completion after changing view cannot change the new record', async () => {
  const pending = deferred();
  const page = dailyFixture({ updateSchedule: () => pending.promise });
  page.setChange();
  const saving = page.saveDataToCloud();
  const next = new Date(page.currentDate()); next.setDate(next.getDate() + 1);
  page.currentDate.set(next);
  page.currentRecord = { id: formatDate(next), date: formatDate(next), version: 12, names: {}, schedule: {} };
  pending.resolve({ version: 5 });
  await saving;
  assert.equal(page.currentRecord.version, 12);
  assert.equal(page.hasUnsavedChanges(), true);
});

test('future schedule remains readonly while empty nurse assignments can be saved', async () => {
  let scheduleCalls = 0, teamsPayload;
  const page = dailyFixture({
    updateSchedule: async () => { scheduleCalls++; },
    updateTeams: async (_id, payload) => { teamsPayload = payload; return { version: 4 }; },
  });
  page.isPageLocked = () => true;
  page.hasUnsavedChanges.set(true);
  page.setTeamChange();
  await page.saveDataToCloud();
  assert.equal(scheduleCalls, 0);
  assert.equal(Object.keys(teamsPayload.teams).length, 0);
  assert.equal(teamsPayload.expectedVersion, 3);
  assert.equal(teamsPayload.takeoffEnabled, true);
  assert.equal(page.hasUnsavedTeamChanges(), false);
});

test('XLSX loader stays lazy, shares an in-flight promise, and sets code pages before returning', async () => {
  // These imports are ESM namespaces in the browser. Mark the mocks accordingly
  // so TypeScript's CommonJS interop does not wrap them as plain CommonJS exports.
  const codepages = Object.defineProperty({ utils: { decode() {} } }, '__esModule', { value: true }); let configured = 0;
  const xlsx = Object.defineProperty({ set_cptable: (value) => { assert.equal(value, codepages); configured++; } }, '__esModule', { value: true });
  const loader = loadModule('utils/xlsxLoader.ts', { xlsx, 'xlsx/dist/cpexcel.full.mjs': codepages });
  assert.equal(configured, 0);
  const first = loader.loadXlsx(), second = loader.loadXlsx();
  assert.equal(first, second);
  assert.equal(await first, xlsx);
  assert.equal(configured, 1);
  assert.equal(await loader.loadXlsx(), xlsx);
  assert.equal(configured, 1);
});

test('XLSX loader can retry after a failed code page initialization', async () => {
  let attempts = 0;
  const xlsx = Object.defineProperty({ set_cptable() { if (++attempts === 1) throw new Error('temporary load failure'); } }, '__esModule', { value: true });
  const loader = loadModule('utils/xlsxLoader.ts', { xlsx, 'xlsx/dist/cpexcel.full.mjs': {} });
  await assert.rejects(loader.loadXlsx(), /temporary load failure/);
  assert.equal(await loader.loadXlsx(), xlsx);
  assert.equal(attempts, 2);
});
