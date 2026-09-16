import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const ts = createRequire(new URL('../angular-client/package.json', import.meta.url))('typescript');
const plain = value => JSON.parse(JSON.stringify(value));
const signal = initial => {
  let value = initial;
  const get = () => value;
  get.set = next => { value = next; };
  return get;
};
const response = (data, status = 200, headers = {}) => ({
  ok: status >= 200 && status < 300, status, statusText: 'Synthetic response',
  json: async () => data, headers: { get: name => headers[name] ?? null },
});

// Execute entire production services with real Promise ordering; only Angular's
// dependency injection/signals, time, and HTTP I/O are replaced.
function fixture(filename, exportedName) {
  const calls = [];
  let now = Date.now();
  const source = readFileSync(new URL(`../angular-client/src/app/core/services/${filename}`, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true },
    reportDiagnostics: true,
  });
  assert.equal(output.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  const module = { exports: {} };
  const config = { apiBaseUrl: '/api', getHeaders: () => ({ Authorization: 'Bearer synthetic' }) };
  vm.runInNewContext(output.outputText, {
    module, exports: module.exports,
    console: { log() {}, warn() {}, error() {} },
    Date: class extends Date { static now() { return now; } },
    require(name) {
      if (name === '@angular/core') return {
        Injectable: () => target => target, signal, computed: fn => fn, inject: () => config,
      };
      if (name === './api-config.service') return { ApiConfigService: class {} };
      throw Error(`Unexpected dependency: ${name}`);
    },
    fetch(url, options) {
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      calls.push({ url, options, resolve, reject });
      return promise;
    },
  });
  return { store: new module.exports[exportedName](), calls, advance: ms => { now += ms; } };
}
const medication = () => fixture('medication-store.service.ts', 'MedicationStoreService');
const archive = () => fixture('archive-store.service.ts', 'ArchiveStoreService');
const directory = () => fixture('user-directory.service.ts', 'UserDirectoryService');

test('medication coalesces simultaneous reads of the same patient set and caches empty results', async () => {
  const { store, calls } = medication();
  const ids = ['p2', 'p1'];
  const first = store.fetchDailyInjections('2026-09-17', ids);
  const duplicate = store.fetchDailyInjections('2026-09-17', ['p1', 'p2', 'p1']);
  assert.equal(calls.length, 1);
  assert.deepEqual(ids, ['p2', 'p1']);
  assert.deepEqual(JSON.parse(calls[0].options.body), { targetDate: '2026-09-17', patientIds: ids });
  assert.equal(store.isLoading(), true);
  calls[0].resolve(response({ data: [] }));
  assert.deepEqual(plain(await first), []);
  assert.deepEqual(plain(await duplicate), []);
  assert.equal(store.isLoading(), false);
  await store.fetchDailyInjections('2026-09-17', ['p1', 'p2']);
  await store.fetchDailyInjections('', ids);
  await store.fetchDailyInjections('2026-09-17', []);
  assert.equal(calls.length, 1);
});

test('medication loading remains true until independent requests have both settled', async () => {
  const { store, calls } = medication();
  const first = store.fetchDailyInjections('2026-09-17', ['p1']);
  const second = store.fetchDailyInjections('2026-09-18', ['p1']);
  calls[0].resolve(response([{ id: 'first' }]));
  await first;
  assert.equal(store.isLoading(), true);
  calls[1].resolve(response([{ id: 'second' }]));
  await second;
  assert.equal(store.isLoading(), false);
});

test('medication clear detaches old requests without allowing late cache or loading writes', async () => {
  const { store, calls } = medication();
  const old = store.fetchDailyInjections('2026-09-17', ['p1']);
  store.clearCache();
  assert.equal(store.isLoading(), false);
  const next = store.fetchDailyInjections('2026-09-17', ['p1']);
  calls[0].resolve(response([{ id: 'old' }]));
  await old;
  assert.equal(store.isLoading(), true);
  const duplicate = store.fetchDailyInjections('2026-09-17', ['p1']);
  assert.equal(calls.length, 2);
  calls[1].resolve(response([{ id: 'new' }]));
  const resolved = await Promise.all([next, duplicate]);
  assert.deepEqual(plain(resolved), [[{ id: 'new' }], [{ id: 'new' }]]);
  assert.deepEqual(plain(await store.fetchDailyInjections('2026-09-17', ['p1'])), [{ id: 'new' }]);
  assert.equal(calls.length, 2);
});

test('medication failures are retryable and an obsolete failure cannot set the new session error', async () => {
  const { store, calls } = medication();
  const old = store.fetchDailyInjections('2026-09-17', ['p1']);
  store.clearCache();
  const next = store.fetchDailyInjections('2026-09-17', ['p1']);
  calls[0].reject(Error('obsolete'));
  await old;
  assert.equal(store.error(), null);
  assert.equal(store.isLoading(), true);
  const failed = assert.rejects(next, /Failed to fetch/);
  calls[1].resolve(response(null, 503));
  await failed;
  assert.equal(store.isLoading(), false);
  const retry = store.fetchDailyInjections('2026-09-17', ['p1']);
  calls[2].resolve(response([]));
  await retry;
  assert.equal(store.error(), null);
});

test('archive single reads and overlapping batches request each uncached date only once', async () => {
  const { store, calls } = archive();
  const day = '2026-09-15', nextDay = '2026-09-16', thirdDay = '2026-09-17';
  const first = store.fetchScheduleByDate(day);
  const batch = store.fetchSchedulesByDates([day, nextDay, nextDay, '']);
  const overlap = store.fetchSchedulesByDates([nextDay, thirdDay]);
  const singleOverlap = store.fetchScheduleByDate(thirdDay);
  assert.equal(calls.length, 3);
  assert.match(calls[0].url, /archived\?date=2026-09-15$/);
  assert.deepEqual(JSON.parse(calls[1].options.body), { dates: [nextDay] });
  assert.deepEqual(JSON.parse(calls[2].options.body), { dates: [thirdDay] });
  calls[0].resolve(response({ data: { id: day, date: day, schedule: {} } }));
  await first;
  assert.equal(store.isLoading(), true);
  calls[1].resolve(response([{ id: nextDay, date: nextDay, schedule: {} }]));
  assert.equal((await batch).size, 2);
  assert.equal(store.isLoading(), true);
  calls[2].resolve(response({ data: [{ id: thirdDay, date: thirdDay, schedule: {} }] }));
  assert.equal((await overlap).get(thirdDay).id, thirdDay);
  assert.equal((await singleOverlap).id, thirdDay);
  assert.equal(store.isLoading(), false);
  const cached = await store.fetchSchedulesByDates([day, nextDay, thirdDay]);
  assert.equal(cached.size, 3);
  assert.equal(calls.length, 3);
});

test('archive caches absent dates from both 404 and missing batch records', async () => {
  const { store, calls } = archive();
  const first = store.fetchScheduleByDate('2026-09-15');
  calls[0].resolve(response(null, 404));
  assert.equal(await first, null);
  const batch = store.fetchSchedulesByDates(['2026-09-15', '2026-09-16']);
  assert.deepEqual(JSON.parse(calls[1].options.body), { dates: ['2026-09-16'] });
  calls[1].resolve(response([]));
  const result = await batch;
  assert.equal(result.size, 2);
  assert.equal(result.get('2026-09-16'), null);
  assert.equal(await store.fetchScheduleByDate('2026-09-16'), null);
  assert.equal(calls.length, 2);
});

for (const oldKind of ['single', 'batch']) {
  test(`archive clear isolates a late ${oldKind} response from new requests`, async () => {
    const { store, calls } = archive();
    const date = '2026-09-15';
    const old = oldKind === 'single' ? store.fetchScheduleByDate(date) : store.fetchSchedulesByDates([date]);
    store.clearCache();
    assert.equal(store.isLoading(), false);
    const next = store.fetchScheduleByDate(date);
    calls[0].resolve(response([{ id: 'old', date, schedule: {} }]));
    await old;
    assert.equal(store.isLoading(), true);
    const duplicate = store.fetchSchedulesByDates([date]);
    assert.equal(calls.length, 2);
    calls[1].resolve(response({ id: 'new', date, schedule: {} }));
    await next;
    assert.equal((await duplicate).get(date).id, 'new');
    assert.equal((await store.fetchScheduleByDate(date)).id, 'new');
    assert.equal(calls.length, 2);
  });
}

test('archive failed batches release all dates for retry; obsolete failures leave current state alone', async () => {
  const { store, calls } = archive();
  const dates = ['2026-09-15', '2026-09-16'];
  const old = store.fetchSchedulesByDates(dates);
  store.clearCache();
  const next = store.fetchSchedulesByDates(dates);
  calls[0].reject(Error('obsolete'));
  await old;
  assert.equal(store.error(), null);
  assert.equal(store.isLoading(), true);
  const rejected = assert.rejects(next, /HTTP 503/);
  calls[1].resolve(response(null, 503));
  await rejected;
  assert.equal(store.isLoading(), false);
  const retry = store.fetchSchedulesByDates(dates);
  calls[2].resolve(response([]));
  await retry;
  assert.equal(store.error(), null);
});

for (const kind of ['archive', 'medication']) {
  test(`${kind} obsolete success arriving last cannot replace a completed refresh`, async () => {
    const { store, calls } = kind === 'archive' ? archive() : medication();
    const date = '2026-09-17';
    const read = () => kind === 'archive' ? store.fetchScheduleByDate(date) : store.fetchDailyInjections(date, ['p1']);
    const data = id => kind === 'archive' ? { id, date, schedule: {} } : [{ id }];
    const old = read();
    store.clearCache();
    const next = read();
    calls[1].resolve(response(data('new')));
    await next;
    calls[0].resolve(response(data('old')));
    await old;
    assert.deepEqual(plain(await read()), data('new'));
    assert.equal(calls.length, 2);
    assert.equal(store.isLoading(), false);
    assert.equal(store.error(), null);
  });

  test(`${kind} cache evicts oldest entries and expires previously visited keys`, async () => {
    const { store, calls, advance } = kind === 'archive' ? archive() : medication();
    const limit = kind === 'archive' ? 366 : 100;
    const key = index => new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10);
    const read = index => kind === 'archive' ? store.fetchScheduleByDate(key(index)) : store.fetchDailyInjections('2026-09-17', ['p' + index]);
    const data = index => kind === 'archive' ? { id: key(index), date: key(index), schedule: {} } : [{ id: 'record-' + index }];
    for (let i = 0; i <= limit; i++) {
      const loading = read(i);
      calls.at(-1).resolve(response(data(i)));
      await loading;
    }
    await read(limit);
    assert.equal(calls.length, limit + 1);
    const evicted = read(0);
    assert.equal(calls.length, limit + 2);
    calls.at(-1).resolve(response(data(0)));
    await evicted;
    advance(10 * 60 * 1000 + 1);
    const expired = read(0);
    assert.equal(calls.length, limit + 3);
    calls.at(-1).resolve(response(data(0)));
    await expired;
  });
}

test('directory shares loading and treats a successful empty result as loaded', async () => {
  const { store, calls } = directory();
  const first = store.fetchUsersIfNeeded();
  const second = store.fetchUsersIfNeeded();
  assert.equal(calls.length, 1);
  calls[0].resolve(response({ users: [] }));
  await Promise.all([first, second]);
  await store.fetchUsersIfNeeded();
  assert.equal(calls.length, 1);
  const refresh = store.refresh();
  calls[1].resolve(response([{ id: 'u1', name: 'Synthetic user' }]));
  await refresh;
  assert.equal(store.getDisplayName('u1'), 'Synthetic user');
});

test('directory late success cannot restore previous users or detach a fresh request', async () => {
  const { store, calls } = directory();
  const old = store.fetchUsersIfNeeded();
  await store.clearCache();
  const next = store.fetchUsersIfNeeded();
  calls[0].resolve(response([{ id: 'old' }]));
  await old;
  assert.equal(store.allUsers().length, 0);
  assert.equal(store.isLoading(), true);
  const joined = store.fetchUsersIfNeeded();
  assert.equal(calls.length, 2);
  calls[1].resolve(response([{ id: 'new' }]));
  await Promise.all([next, joined]);
  assert.equal(store.allUsers()[0].id, 'new');
  assert.equal(store.isLoading(), false);
});

test('directory obsolete failure cannot install retry cooldown; active Retry-After is respected', async () => {
  const { store, calls, advance } = directory();
  const old = store.fetchUsersIfNeeded();
  await store.clearCache();
  calls[0].reject(Error('obsolete'));
  await old;
  const next = store.fetchUsersIfNeeded();
  assert.equal(calls.length, 2);
  calls[1].resolve(response(null, 429, { 'Retry-After': '60' }));
  await next;
  await store.fetchUsersIfNeeded();
  advance(59_000);
  await store.fetchUsersIfNeeded();
  assert.equal(calls.length, 2);
  advance(1_001);
  const retry = store.fetchUsersIfNeeded();
  assert.equal(calls.length, 3);
  calls[2].resolve(response([]));
  await retry;
});
