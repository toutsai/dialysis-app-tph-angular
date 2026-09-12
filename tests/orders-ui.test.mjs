import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const ts = createRequire(new URL('../angular-client/package.json', import.meta.url))('typescript');
const root = '../angular-client/src/app/features/orders/';
function compile(name, require = () => ({})) {
  const source = readFileSync(new URL(root + name + '.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true } }).outputText;
  const exports = {}; new Function('exports', 'require', code)(exports, require); return exports;
}
const vm = compile('orders-view-model');
const signal = value => { const fn = () => value; fn.set = next => value = next; fn.update = change => value = change(value); return fn; };
const angular = { Component: () => x => x, Input: () => () => {}, HostBinding: () => () => {}, ChangeDetectionStrategy: { Eager: 1 }, signal, computed: fn => fn };
let xlsxLoader;
const { OrdersComponent } = compile('orders.component', name => name === '@angular/core' ? angular : name === './orders-view-model' ? vm : name === '@/utils/xlsxLoader' ? { loadXlsx: () => xlsxLoader() } : {});
const meds = [{ code: 'A', tradeName: 'first', unit: 'mg' }, { code: 'A', tradeName: 'duplicate', unit: 'wrong' }, { code: 'EMPTY', tradeName: 'empty', unit: 'tab' }];
const order = (fields = {}) => ({ patientId: 'p1', orderCode: 'A', dose: '2', orderType: 'oral', frequency: 'QW2', startDate: '2026-01-10', ...fields });

test('first duplicate metadata, unknown codes, numeric zero and blank dose preserve legacy cell text and presence', () => {
  const metadata = vm.medicationMetadataMap(meds);
  assert.equal(metadata.get('A').tradeName, 'first');
  assert.equal(vm.medicationCell('A', [order()], metadata, '2026-01').text, '2 mg (QW2)');
  assert.equal(vm.medicationCell('U', [order({ orderCode: 'U' })], metadata).text, '2 (QW2)');
  for (const dose of ['', 0]) {
    const cell = vm.medicationCell('A', [order({ dose })], metadata);
    assert.equal(cell.text, '-'); assert.equal(cell.hasRecords, true); assert.equal(cell.entries.length, 1);
  }
  assert.equal(vm.medicationCell('A', [order({ dose: '0' })], metadata).text, '0 mg (QW2)');
  assert.equal(vm.medicationCell('A', [], metadata).hasRecords, false);
});

test('every frequency, note, start and stop survives sorting; metadata and month changes recompute', () => {
  const input = [order({ startDate: '2026-02-15', frequency: 'QW4', endDate: '2026-03-02' }), order({ frequency: 'QW2' })];
  const original = JSON.stringify(input);
  const feb = vm.medicationCell('A', input, vm.medicationMetadataMap(meds), '2026-02');
  assert.equal(feb.text, '2 mg (QW2)；2 mg (QW4)');
  assert.deepEqual(feb.entries.map(entry => entry.startDate), ['2026-01-10', '2026-02-15']);
  assert.equal(vm.medicationCell('A', input, vm.medicationMetadataMap([{ ...meds[0], unit: 'mcg' }]), '2026-03').text, '2 mcg (QW2)；2 mcg (QW4，至3/2止)');
  assert.equal(vm.medicationCell('XX88', [order({ orderCode: 'XX88', note: '自備品', frequency: 'BID' })], new Map()).text, '2 (自備品，BID)');
  assert.equal(vm.medicationCell('A', [order({ orderType: 'injection', note: 'QW4' })], vm.medicationMetadataMap(meds)).text, '2 mg (QW4)');
  assert.equal(JSON.stringify(input), original);
});

test('twelve months retain interval overlap separately from legacy upload snapshots', () => {
  const rows = vm.individualOrderMonths([order({ startDate: '2025-12-30', endDate: '2026-02-01' }), order({ startDate: '', uploadMonth: '2026-05' }), order({ startDate: '2027-01-01' })], 2026);
  assert.equal(rows.length, 12); assert.equal(rows[0].month, '2026-12'); assert.equal(rows[11].month, '2026-01');
  assert.deepEqual(rows.filter(row => Object.keys(row.orders).length).map(row => row.month), ['2026-05', '2026-02', '2026-01']);
  assert.equal(rows.find(row => row.month === '2026-02').orders.A.length, 1);
});

function fixture(patients = [{ id: 'p1', name: '合成人甲', medicalRecordNumber: 'AbC123' }]) {
  const p = Object.create(OrdersComponent.prototype);
  Object.assign(p, { searchRequest: 0, lastAttempt: null, isLoading: signal(false), searchError: signal(''), searchNotice: signal(''), patientChoices: signal([]), selectedOrderPatient: signal(null),
    hostElement: { nativeElement: { querySelector: () => null } },
    searchType: signal('individual'), individualSearchTerm: signal('abc123'), individualSearchYear: signal(2026), groupSearchParams: { month: '2026-01', freq: '一三五', shift: 'early' },
    searchResult: signal([]), resultQuery: signal(null), searchPerformed: signal(false), extraMeds: signal([]), queryFiltersExpanded: signal(true),
    INJECTION_MEDS_MASTER: [], ORAL_MEDS_MASTER: meds, EXTRA_MED_NAMES: { XX88: '自備藥' },
    patientStore: { fetchPatientsIfNeeded: async () => {}, opdPatients: () => patients }, ordersApi: { fetchWhere: async () => [order()] },
    SHIFT_MAP: { early: 0, noon: 1, late: 2 }, SHIFT_INDEX_MAP: { 0: '早班', 1: '午班', 2: '晚班' } });
  return p;
}

test('ambiguous patient search makes no order request until an explicit exact patient selection', async () => {
  const p = fixture([{ id: 'p1', name: '同名患者', medicalRecordNumber: 'AbC1' }, { id: 'p2', name: '同名患者', medicalRecordNumber: 'AbC2' }]);
  let requested; p.ordersApi.fetchWhere = async params => { requested = params.patientId; return [order({ patientId: params.patientId })]; };
  p.individualSearchTerm.set('同名'); await p.handleSearch();
  assert.equal(requested, undefined); assert.equal(p.patientChoices().length, 2); assert.match(p.searchNotice(), /多位/);
  p.selectedOrderPatient.set(p.patientChoices()[1]); await p.handleSearch();
  assert.equal(requested, 'p2'); assert.equal(p.resultQuery().patientId, 'p2');
  assert.equal(vm.matchingOrderPatients(p.patientStore.opdPatients(), 'abc2')[0].id, 'p2');
});

test('latest response owns results, metadata and loading; prior failure cannot replace success', async () => {
  const p = fixture(); const pending = [];
  p.ordersApi.fetchWhere = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
  const a = p.handleSearch(); await Promise.resolve(); p.individualSearchYear.set(2027);
  const b = p.handleSearch(); await Promise.resolve();
  pending[1].resolve([order({ orderCode: 'NEW', startDate: '2027-01-01' })]); await b;
  pending[0].reject(Error('old request fails')); await a;
  assert.equal(p.resultQuery().year, 2027); assert.equal(p.extraMeds()[0].code, 'NEW'); assert.equal(p.searchError(), ''); assert.equal(p.isLoading(), false);
});

test('failed query keeps accepted result and retry uses failed submitted year, not edited controls', async () => {
  const p = fixture(); await p.handleSearch(); const accepted = p.searchResult();
  p.individualSearchYear.set(2027); p.ordersApi.fetchWhere = async () => { throw Error('unavailable'); }; await p.handleSearch();
  assert.equal(p.searchResult(), accepted); assert.equal(p.resultQuery().year, 2026); assert.match(p.searchError(), /失敗/);
  p.individualSearchYear.set(2028); p.ordersApi.fetchWhere = async () => [order({ startDate: '2027-02-01' })];
  await p.handleSearch(p.lastAttempt); assert.equal(p.resultQuery().year, 2027); assert.equal(p.searchError(), '');
});

test('individual all-item metadata retains codes found only outside the displayed year', async () => {
  const p = fixture();
  p.ordersApi.fetchWhere = async () => [order(), order({ orderCode: 'PAST', startDate: '2025-01-01', endDate: '2025-12-31' })];
  await p.handleSearch();
  assert.deepEqual(p.extraMeds().map(med => med.code), ['PAST']);
  assert.equal(p.searchResult().some(row => row.orders.PAST), false);
});

test('group preserves bed order and no-order patients; HTTP errors never become empty successful results', async () => {
  const p = fixture([{ id: 'p1', name: '甲', medicalRecordNumber: 'A' }, { id: 'p2', name: '乙', medicalRecordNumber: 'B' }]);
  p.searchType.set('group'); p.baseSchedulesApi = { fetchById: async () => ({ schedule: { p1: { bedNum: '10', freq: '一三五', shiftIndex: 0 }, p2: { bedNum: '2', freq: '一三五', shiftIndex: 0 } } }) };
  p.firebaseService = { apiBaseUrl: 'http://synthetic.invalid/api', getHeaders: () => ({}) };
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: true, json: async () => [order()] }); await p.handleSearch();
    assert.deepEqual(p.searchResult().map(row => row.patientId), ['p2', 'p1']); assert.deepEqual(Object.keys(p.searchResult()[0].orders), []);
    const accepted = p.searchResult(); p.groupSearchParams.month = '2026-02';
    globalThis.fetch = async () => ({ ok: false, status: 503 }); await p.handleSearch();
    assert.equal(p.searchResult(), accepted); assert.equal(p.resultQuery().month, '2026-01'); assert.match(p.searchError(), /失敗/);
  } finally { globalThis.fetch = original; }
});

test('actual computed projections keep master order, blank records and metadata/result/month invalidation', () => {
  const source = readFileSync(new URL(root + 'orders.component.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('orders.ts', source, ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.find(ts.isClassDeclaration);
  const p = fixture(); p.allMedications = signal([...meds, { code: 'U', tradeName: 'Unknown', unit: '' }]);
  p.showAllItems = signal(false);
  for (const name of ['medicationByCode', 'orderRows', 'visibleMedications', 'displayedOrderRows']) {
    const arrow = declaration.members.find(member => member.name?.getText(ast) === name).initializer.arguments[0].getText(ast);
    const code = ts.transpileModule(`function project() { return (${arrow})(); }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const project = new Function(...Object.keys(vm), code + '; return project;')(...Object.values(vm));
    p[name] = () => project.call(p);
  }
  p.resultQuery.set({ type: 'group', month: '2026-01' });
  p.searchResult.set([{ patientId: 'p1', orders: { A: [order({ dose: '', endDate: '2026-02-02' })], U: [order({ orderCode: 'U' })] } }]);
  assert.deepEqual(p.visibleMedications().map(m => m.code), ['A', 'A', 'U']);
  assert.equal(p.displayedOrderRows()[0].cells[0].hasRecords, true);
  p.showAllItems.set(true); assert.equal(p.visibleMedications().length, 4);
  p.searchResult.set([{ patientId: 'p1', orders: { A: [order({ endDate: '2026-02-02' })] } }]);
  assert.equal(p.orderRows()[0].cells[0].text, '2 mg (QW2)');
  p.allMedications.set([{ code: 'A', tradeName: 'Updated', unit: 'mcg' }]);
  p.resultQuery.set({ type: 'group', month: '2026-02' });
  assert.equal(p.orderRows()[0].cells[0].text, '2 mcg (QW2，至2/2止)');
});

test('export keeps captured context, full headers and rows while lazy spreadsheet loading overlaps a new empty result', async () => {
  const p = fixture(); let release, sheetData, filename;
  p.resultQuery.set({ type: 'individual', year: 2026, patientId: 'p1', patientName: '原始患者', medicalRecordNumber: 'A' });
  p.orderRows = signal([{ month: '2026-01', cells: [{ text: '2 mg' }, { text: '-' }, { text: '-' }] }]);
  p.allMedications = signal(meds); xlsxLoader = () => new Promise(resolve => { release = resolve; });
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ click() { filename = this.download; } }), body: { appendChild() {}, removeChild() {} } };
  try {
    const exporting = p.exportOrdersToExcel();
    p.orderRows.set([]); p.searchResult.set([]); p.resultQuery.set({ type: 'group', month: '2027-02', freq: '一三五', shift: 'early' }); p.allMedications.set([]);
    release({ utils: { aoa_to_sheet: data => { sheetData = data; return {}; }, book_new: () => ({}), book_append_sheet() {} }, write: () => new Uint8Array([1]) });
    await exporting;
    assert.match(filename, /原始患者_2026/); assert.deepEqual(sheetData[2], ['月份', 'first', 'duplicate', 'empty']); assert.deepEqual(sheetData[3], ['2026-01', '2 mg', '-', '-']);
  } finally { globalThis.document = originalDocument; }
});
