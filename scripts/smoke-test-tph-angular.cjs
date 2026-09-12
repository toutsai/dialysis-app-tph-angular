const { spawn } = require('child_process');
const crypto = require('crypto');
const { existsSync, mkdtempSync, readFileSync, rmSync } = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const ROOT = path.resolve(__dirname, '..');
const PRODUCTION_DB_PATH = path.resolve(ROOT, 'data', 'dialysis.db');
const STATIC_PATH =
  process.env.STATIC_PATH || path.join(ROOT, 'dist', 'browser');
const TEST_PASSWORD = crypto.randomBytes(24).toString('base64url');
const TEST_JWT_SECRET = crypto.randomBytes(48).toString('base64url');
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const prefix = `codex_smoke_${stamp}_${crypto.randomBytes(4).toString('hex')}`;

const results = [];
let server = null;
let serverStartError = null;
let serverOutput = '';
let tempDir = null;
let DB_PATH = null;
let BACKUP_DIR = null;
let PORT = null;
let BASE_URL = null;

function pass(name, detail = '') {
  results.push({ ok: true, name, detail });
  console.log(`PASS ${name}${detail ? ` - ${detail}` : ''}`);
}

function fail(name, detail = '') {
  results.push({ ok: false, name, detail });
  console.error(`FAIL ${name}${detail ? ` - ${detail}` : ''}`);
}

function isServerStopped() {
  return (
    !server ||
    !server.pid ||
    server.exitCode !== null ||
    server.signalCode !== null
  );
}

function isPathInside(parentPath, candidatePath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function assertTemporaryDatabasePath() {
  if (!tempDir || !DB_PATH) {
    throw new Error('Smoke test temporary database has not been initialized');
  }

  const resolvedTempDir = path.resolve(tempDir);
  const resolvedDbPath = path.resolve(DB_PATH);
  const expectedDbPath = path.join(resolvedTempDir, 'dialysis-smoke.db');
  const temporaryRoot = path.resolve(os.tmpdir());

  if (!isPathInside(temporaryRoot, resolvedTempDir)) {
    throw new Error(`Refusing smoke directory outside OS temp: ${resolvedTempDir}`);
  }
  if (resolvedDbPath.toLowerCase() === PRODUCTION_DB_PATH.toLowerCase()) {
    throw new Error(`Refusing production database path: ${resolvedDbPath}`);
  }
  if (resolvedDbPath.toLowerCase() !== expectedDbPath.toLowerCase()) {
    throw new Error(`Refusing unexpected smoke database path: ${resolvedDbPath}`);
  }
}

function createTemporaryWorkspace() {
  tempDir = mkdtempSync(path.join(os.tmpdir(), 'dialysis-smoke-'));
  DB_PATH = path.join(tempDir, 'dialysis-smoke.db');
  BACKUP_DIR = path.join(tempDir, 'backups');
  assertTemporaryDatabasePath();
}

async function initializeTemporaryDatabase() {
  assertTemporaryDatabasePath();

  const schema = readFileSync(path.join(ROOT, 'src', 'db', 'schema.sql'), 'utf8');
  const db = new Database(DB_PATH);
  try {
    db.exec(schema);
  } finally {
    db.close();
  }

  // schema.sql is the baseline; migrations contain newer additive structures.
  // Run both against the isolated database so a smoke run never needs production data.
  const previousDbPath = process.env.DB_PATH;
  process.env.DB_PATH = DB_PATH;
  try {
    const migrationUrl = pathToFileURL(path.join(ROOT, 'src', 'db', 'migrate.js')).href;
    const { runMigrations } = await import(`${migrationUrl}?smoke=${Date.now()}`);
    runMigrations();
  } finally {
    if (previousDbPath === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = previousDbPath;
  }

  const verifyDb = new Database(DB_PATH, { readonly: true });
  try {
    const integrity = verifyDb.pragma('quick_check', { simple: true });
    if (integrity !== 'ok') {
      throw new Error(`Temporary database quick_check failed: ${integrity}`);
    }
  } finally {
    verifyDb.close();
  }
}

function allocatePort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.unref();
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const address = listener.address();
      const port = typeof address === 'object' && address ? address.port : null;
      listener.close((error) => {
        if (error) reject(error);
        else if (!port) reject(new Error('Failed to allocate a smoke-test port'));
        else resolve(port);
      });
    });
  });
}

async function request(method, urlPath, body, token) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${urlPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });

  const text = await res.text();
  let data = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}

  return { res, data, text };
}

async function expectStatus(name, method, urlPath, expected, body, token) {
  try {
    const { res, data, text } = await request(method, urlPath, body, token);
    const expectedList = Array.isArray(expected) ? expected : [expected];
    if (expectedList.includes(res.status)) {
      pass(name, `${method} ${urlPath} -> ${res.status}`);
    } else {
      fail(
        name,
        `${method} ${urlPath} -> ${res.status}; body=${String(text).slice(0, 180)}`,
      );
    }
    return { res, data, text };
  } catch (error) {
    fail(name, `${method} ${urlPath} threw ${error.message}`);
    return { res: { status: 0 }, data: null, text: '' };
  }
}

async function waitForHealth(timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (serverStartError) throw serverStartError;
    if (isServerStopped()) {
      const tail = serverOutput.slice(-1000).trim();
      throw new Error(
        `Smoke server exited before becoming healthy${tail ? `: ${tail}` : ''}`,
      );
    }

    try {
      const { res, data } = await request('GET', '/api/health');
      if (
        res.status === 200 &&
        data?.smokeRunId === prefix &&
        !isServerStopped()
      ) {
        return true;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function prepareAdmin() {
  assertTemporaryDatabasePath();
  const db = new Database(DB_PATH);
  try {
    const existing = db
      .prepare('SELECT * FROM users WHERE username = ?')
      .get('admin');
    const passwordHash = bcrypt.hashSync(TEST_PASSWORD, 10);
    if (existing) {
      db.prepare(
        `UPDATE users
         SET password_hash = ?, is_active = 1, updated_at = datetime('now', 'localtime')
         WHERE username = 'admin'`,
      ).run(passwordHash);
    } else {
      db.prepare(
        `INSERT INTO users (id, username, password_hash, name, title, role, is_active)
         VALUES (?, 'admin', ?, 'Codex Smoke Admin', 'Smoke Test', 'admin', 1)`,
      ).run(uuidv4(), passwordHash);
    }
  } finally {
    db.close();
  }
}

function startServer() {
  assertTemporaryDatabasePath();
  server = spawn(process.execPath, ['src/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      DB_PATH,
      BACKUP_DIR,
      PORT: String(PORT),
      BIND_HOST: '127.0.0.1',
      STATIC_PATH,
      NODE_ENV: 'test',
      LOCAL_AUTH_BYPASS: '0',
      JWT_SECRET: TEST_JWT_SECRET,
      DASHBOARD_PIN_SECRET: crypto.randomBytes(48).toString('base64url'),
      DISABLE_SCHEDULER: '1',
      SMOKE_RUN_ID: prefix,
      ALLOWED_ORIGINS: 'http://127.0.0.1:5173,http://localhost:5173',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  server.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    serverOutput = `${serverOutput}${text}`.slice(-10000);
    if (/error|EADDRINUSE/i.test(text)) process.stdout.write(text);
  });
  server.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    serverOutput = `${serverOutput}${text}`.slice(-10000);
    process.stderr.write(chunk);
  });
  server.once('error', (error) => {
    serverStartError = error;
  });
}

function waitForServerExit(timeoutMs) {
  if (isServerStopped()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      server.off('exit', onExit);
      resolve(false);
    }, timeoutMs);
    server.once('exit', onExit);
  });
}

async function stopServer() {
  if (isServerStopped()) return;

  server.kill('SIGTERM');
  if (await waitForServerExit(5000)) return;

  server.kill('SIGKILL');
  if (!(await waitForServerExit(5000))) {
    throw new Error(`Unable to stop smoke server process ${server.pid}`);
  }
}

function removeTemporaryWorkspace() {
  if (!tempDir) return;
  assertTemporaryDatabasePath();
  rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  tempDir = null;
  DB_PATH = null;
  BACKUP_DIR = null;
}

async function testStaticRoutes() {
  const legacy = await fetch(`${BASE_URL}/consumables`, { redirect: 'manual' });
  const expectedLocation = '/inventory?section=inventory&view=reports&report=monthly';
  if (legacy.status === 302 && legacy.headers.get('location') === expectedLocation) {
    pass('legacy consumables redirects to monthly inventory report', expectedLocation);
  } else {
    fail('legacy consumables redirects to monthly inventory report', `${legacy.status} ${legacy.headers.get('location')}`);
  }
  if (!existsSync(path.join(STATIC_PATH, 'index.html'))) {
    fail('production dist exists', `missing ${path.join(STATIC_PATH, 'index.html')}`);
    return;
  }
  pass('production dist exists', STATIC_PATH);

  for (const route of [
    '/',
    '/login',
    '/schedule',
    '/patients',
    '/orders',
    '/nursing-schedule',
    '/inventory',
    '/daily-log',
    '/kidit-report',
    '/user-management',
  ]) {
    const { res, text } = await expectStatus(`route ${route}`, 'GET', route, 200);
    if (res.status === 200 && !text.includes('<app-root')) {
      fail(`route ${route} app-root`, 'HTML did not contain <app-root>');
    }
  }
}

async function testReadApis(token) {
  const apiTests = [
    '/api/auth/me',
    '/api/patients',
    '/api/patients/with-rules',
    '/api/patients/history',
    '/api/schedules',
    '/api/schedules/base/master',
    '/api/schedules/exceptions/list',
    '/api/schedules/exception-tasks',
    '/api/schedules/range?start=2026-04-01&end=2026-04-30',
    '/api/nursing/duties',
    '/api/nursing/schedules',
    '/api/nursing/group-config',
    '/api/nursing/handover-logs',
    '/api/nursing/handover-logs/latest',
    '/api/nursing/daily-logs/2026-04-26',
    '/api/nursing/kidit-logbook?year=2026&month=4',
    '/api/orders/history',
    '/api/orders/medications',
    '/api/orders/medication-drafts',
    '/api/orders/lab-reports',
    '/api/orders/lab-alert-analyses',
    '/api/orders/condition-records',
    '/api/orders/consumables',
    '/api/orders/injection-orders',
    '/api/orders/bed-settings',
    '/api/orders/machine-bicarbonate-config',
    '/api/medications/injections',
    '/api/medications/patient/codex-test-patient',
    '/api/system/tasks',
    '/api/system/notifications',
    '/api/system/inventory',
    '/api/system/inventory/purchases',
    '/api/system/inventory/counts',
    '/api/system/inventory/counts?from=2026-04-01&to=2026-04-30',
    '/api/system/site-config/marquee',
    '/api/system/auto-assign-config/current',
    '/api/system/scheduled-updates',
    '/api/system/physicians',
    '/api/system/physician-schedules/2026-04-26',
    '/api/system/audit-logs',
  ];

  for (const urlPath of apiTests) {
    await expectStatus(`api ${urlPath}`, 'GET', urlPath, 200, undefined, token);
  }
}

async function testCrud(token) {
  const today = '2026-04-26';

  const memo = await expectStatus(
    'memo create',
    'POST',
    '/api/memos',
    201,
    { date: today, content: `${prefix} memo` },
    token,
  );
  const memoId = memo.data?.id;
  if (memoId) {
    await expectStatus(
      'memo update',
      'PUT',
      `/api/memos/${memoId}`,
      200,
      { content: `${prefix} memo updated` },
      token,
    );
    await expectStatus('memo delete', 'DELETE', `/api/memos/${memoId}`, 200, undefined, token);
  }

  const taskId = `${prefix}_task`;
  await expectStatus(
    'task create',
    'POST',
    '/api/system/tasks',
    201,
    { id: taskId, title: `${prefix} task`, category: 'task', priority: 'normal' },
    token,
  );
  await expectStatus(
    'task update',
    'PUT',
    `/api/system/tasks/${taskId}`,
    200,
    { status: 'completed' },
    token,
  );
  await expectStatus('task delete', 'DELETE', `/api/system/tasks/${taskId}`, 200, undefined, token);

  const inv = await expectStatus(
    'inventory create',
    'POST',
    '/api/system/inventory',
    201,
    {
      name: `${prefix} item`,
      category: 'artificialKidney',
      unit: '個',
      unitsPerBox: 1,
      currentQuantity: 3,
      minQuantity: 1,
      location: 'smoke',
      notes: 'smoke test',
    },
    token,
  );
  const itemId = inv.data?.id;
  if (itemId) {
    await expectStatus(
      'inventory update',
      'PUT',
      `/api/system/inventory/${itemId}`,
      200,
      {
        name: `${prefix} item`,
        category: 'artificialKidney',
        unit: '個',
        unitsPerBox: 1,
        currentQuantity: 4,
        minQuantity: 1,
        location: 'smoke',
        notes: 'smoke updated',
      },
      token,
    );
    // 盤點文件：PUT upsert → GET by date → latest → DELETE
    const countDate = '2026-04-21';
    const countDoc = await expectStatus(
      'inventory count upsert',
      'PUT',
      `/api/system/inventory/counts/${countDate}`,
      200,
      {
        counts: { artificialKidney: { [`${prefix} item`]: 42 } },
        countBoxes: { artificialKidney: { [`${prefix} item`]: 42 } },
        notes: 'smoke count',
      },
      token,
    );
    if (countDoc.data?.counts?.artificialKidney?.[`${prefix} item`] !== 42) {
      fail('inventory count upsert 回應 counts 不正確', JSON.stringify(countDoc.data));
    }
    const countGet = await expectStatus(
      'inventory count get',
      'GET',
      `/api/system/inventory/counts/${countDate}`,
      200,
      undefined,
      token,
    );
    if (countGet.data?.countDate !== countDate) {
      fail('inventory count get 回應 countDate 不正確', JSON.stringify(countGet.data));
    }
    await expectStatus(
      'inventory count latest',
      'GET',
      `/api/system/inventory/counts/latest?before=${countDate}`,
      200,
      undefined,
      token,
    );
    await expectStatus(
      'inventory count invalid date',
      'PUT',
      '/api/system/inventory/counts/2026-4-1',
      400,
      { counts: {} },
      token,
    );
    await expectStatus(
      'inventory count delete',
      'DELETE',
      `/api/system/inventory/counts/${countDate}`,
      200,
      { expectedRevision: countDoc.data.revision },
      token,
    );
    await expectStatus(
      'inventory count get after delete',
      'GET',
      `/api/system/inventory/counts/${countDate}`,
      404,
      undefined,
      token,
    );
    await expectStatus(
      'inventory delete',
      'DELETE',
      `/api/system/inventory/${itemId}`,
      200,
      undefined,
      token,
    );
  }

  const patientId = `${prefix}_patient`;
  const patient = await expectStatus(
    'patient create',
    'POST',
    '/api/patients',
    201,
    {
      id: patientId,
      medicalRecordNumber: `${stamp}99`,
      name: `${prefix} patient`,
      status: 'opd',
      physician: 'smoke',
    },
    token,
  );
  if (patient.res.status === 201) {
    await expectStatus('patient read', 'GET', `/api/patients/${patientId}`, 200, undefined, token);
    await expectStatus(
      'patient update',
      'PUT',
      `/api/patients/${patientId}`,
      200,
      {
        medicalRecordNumber: `${stamp}99`,
        name: `${prefix} patient updated`,
        status: 'opd',
        physician: 'smoke',
      },
      token,
    );
    await expectStatus('patient delete', 'DELETE', `/api/patients/${patientId}`, 200, undefined, token);
  }
}

let cleanupPromise = null;

function cleanupResources() {
  if (cleanupPromise) return cleanupPromise;

  cleanupPromise = (async () => {
    let serverStopped = true;
    try {
      await stopServer();
    } catch (error) {
      serverStopped = false;
      fail('server cleanup', error.message);
    }

    if (!serverStopped) {
      console.error(`Temporary smoke workspace retained for manual cleanup: ${tempDir}`);
      return;
    }

    try {
      removeTemporaryWorkspace();
    } catch (error) {
      fail('temporary workspace cleanup', error.message);
      console.error(`Temporary smoke workspace retained for manual cleanup: ${tempDir}`);
    }
  })();

  return cleanupPromise;
}

async function handleSignal(signal) {
  console.error(`\n${signal} received; cleaning up isolated smoke resources...`);
  await cleanupResources();
  process.exit(signal === 'SIGINT' ? 130 : 143);
}

process.once('SIGINT', () => void handleSignal('SIGINT'));
process.once('SIGTERM', () => void handleSignal('SIGTERM'));

async function main() {
  try {
    createTemporaryWorkspace();
    await initializeTemporaryDatabase();
    prepareAdmin();
    PORT = await allocatePort();
    BASE_URL = `http://127.0.0.1:${PORT}`;

    console.log('Smoke isolation enabled: external DB_PATH, PORT, and SMOKE_BASE_URL are ignored.');
    console.log(`Using temporary DB_PATH=${DB_PATH}`);
    console.log(`Using temporary BACKUP_DIR=${BACKUP_DIR}`);
    console.log(`Using BASE_URL=${BASE_URL}`);
    console.log(`Using STATIC_PATH=${STATIC_PATH}`);
    pass('temporary database isolation', DB_PATH);

    startServer();
    if (!(await waitForHealth())) {
      throw new Error(`Smoke server did not become healthy on port ${PORT}`);
    }
    pass('backend health', `pid=${server.pid}, ${BASE_URL}`);
    pass('server instance identity', prefix);

    await testStaticRoutes();

    const login = await expectStatus(
      'admin login',
      'POST',
      '/api/auth/login',
      200,
      { username: 'admin', password: TEST_PASSWORD },
    );
    const token = login.data?.token;
    if (!token) throw new Error('Login did not return a token');

    await testReadApis(token);
    await testCrud(token);
  } catch (error) {
    fail('fatal', error.stack || error.message);
  } finally {
    await cleanupResources();
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\nSmoke test complete: ${results.length - failed.length}/${results.length} passed.`);
  if (failed.length > 0) {
    console.error('\nFailures:');
    failed.forEach((result) => console.error(`- ${result.name}: ${result.detail}`));
    process.exitCode = 1;
  }
}

main().catch(async (error) => {
  fail('fatal', error.stack || error.message);
  await cleanupResources();
  process.exitCode = 1;
});
