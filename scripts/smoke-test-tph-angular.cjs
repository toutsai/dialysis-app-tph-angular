const { spawn } = require('child_process');
const { existsSync } = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'data', 'dialysis.db');
const STATIC_PATH =
  process.env.STATIC_PATH || path.join(ROOT, 'dist', 'browser');
const BASE_URL = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3000';
const TEST_PASSWORD = 'CodexSmoke123!';
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const prefix = `codex_smoke_${stamp}`;

const results = [];
let server = null;
let adminBackup = null;

function pass(name, detail = '') {
  results.push({ ok: true, name, detail });
  console.log(`PASS ${name}${detail ? ` - ${detail}` : ''}`);
}

function fail(name, detail = '') {
  results.push({ ok: false, name, detail });
  console.error(`FAIL ${name}${detail ? ` - ${detail}` : ''}`);
}

async function request(method, urlPath, body, token) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${urlPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
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
    try {
      const { res } = await request('GET', '/api/health');
      if (res.status === 200) return true;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function prepareAdmin() {
  const db = new Database(DB_PATH);
  try {
    const existing = db
      .prepare('SELECT * FROM users WHERE username = ?')
      .get('admin');
    adminBackup = existing
      ? {
          id: existing.id,
          password_hash: existing.password_hash,
          is_active: existing.is_active,
        }
      : null;

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

function cleanupDailyLogMovements(db) {
  const rows = db
    .prepare(
      `SELECT date, patient_movements FROM daily_logs WHERE patient_movements LIKE ?`,
    )
    .all(`%${prefix}%`);

  const update = db.prepare(
    `UPDATE daily_logs
     SET patient_movements = ?, updated_at = datetime('now', 'localtime')
     WHERE date = ?`,
  );

  for (const row of rows) {
    let movements = [];
    try {
      movements = JSON.parse(row.patient_movements || '[]');
    } catch {
      continue;
    }

    const cleaned = movements.filter((movement) => {
      return !JSON.stringify(movement).includes(prefix);
    });

    if (cleaned.length !== movements.length) {
      update.run(JSON.stringify(cleaned), row.date);
    }
  }
}

function cleanupKiditLogbookEvents(db) {
  const rows = db
    .prepare(
      `SELECT date, events FROM kidit_logbook WHERE events LIKE ?`,
    )
    .all(`%${prefix}%`);

  const update = db.prepare(
    `UPDATE kidit_logbook
     SET events = ?, updated_at = datetime('now', 'localtime')
     WHERE date = ?`,
  );

  for (const row of rows) {
    let events = [];
    try {
      events = JSON.parse(row.events || '[]');
    } catch {
      continue;
    }

    const cleaned = events.filter((event) => {
      return !JSON.stringify(event).includes(prefix);
    });

    if (cleaned.length !== events.length) {
      update.run(JSON.stringify(cleaned), row.date);
    }
  }
}

function restoreAdminAndCleanup() {
  const db = new Database(DB_PATH);
  try {
    if (adminBackup) {
      db.prepare(
        `UPDATE users
         SET password_hash = ?, is_active = ?, updated_at = datetime('now', 'localtime')
         WHERE username = 'admin'`,
      ).run(adminBackup.password_hash, adminBackup.is_active);
    }

    db.prepare(`DELETE FROM memos WHERE content LIKE ?`).run(`${prefix}%`);
    db.prepare(`DELETE FROM tasks WHERE id LIKE ? OR title LIKE ?`).run(
      `${prefix}%`,
      `${prefix}%`,
    );
    db.prepare(`DELETE FROM inventory_items WHERE name LIKE ?`).run(`${prefix}%`);
    db.prepare(`DELETE FROM patient_history WHERE patient_id LIKE ?`).run(
      `${prefix}%`,
    );
    cleanupDailyLogMovements(db);
    cleanupKiditLogbookEvents(db);
    db.prepare(`DELETE FROM patients WHERE id LIKE ? OR name LIKE ?`).run(
      `${prefix}%`,
      `${prefix}%`,
    );
  } finally {
    db.close();
  }
}

function startServer() {
  server = spawn(process.execPath, ['src/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      DB_PATH,
      STATIC_PATH,
      ALLOWED_ORIGINS: 'http://127.0.0.1:5173,http://localhost:5173',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  server.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    if (/error|EADDRINUSE/i.test(text)) process.stdout.write(text);
  });
  server.stderr.on('data', (chunk) => process.stderr.write(chunk));
}

async function testStaticRoutes() {
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
    '/api/system/inventory/monthly/calculation?month=2026-04',
    '/api/system/inventory/weekly/data?date=2026-04-26',
    '/api/system/inventory/consumables/query',
    '/api/system/inventory/consumption/monthly-summary?month=2026-04',
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
    await expectStatus(
      'inventory monthly summary after CRUD',
      'GET',
      '/api/system/inventory/consumption/monthly-summary?month=2026-04',
      200,
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

async function main() {
  console.log(`Using DB_PATH=${DB_PATH}`);
  console.log(`Using STATIC_PATH=${STATIC_PATH}`);
  prepareAdmin();
  startServer();

  try {
    if (!(await waitForHealth())) {
      throw new Error('Server did not become healthy on port 3000');
    }
    pass('backend health');

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
  } finally {
    if (server && !server.killed) {
      server.kill('SIGTERM');
      await new Promise((resolve) => setTimeout(resolve, 600));
      if (!server.killed) server.kill('SIGKILL');
    }
    restoreAdminAndCleanup();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nSmoke test complete: ${results.length - failed.length}/${results.length} passed.`);
  if (failed.length > 0) {
    console.error('\nFailures:');
    failed.forEach((r) => console.error(`- ${r.name}: ${r.detail}`));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  fail('fatal', error.stack || error.message);
  try {
    if (server && !server.killed) server.kill('SIGTERM');
    restoreAdminAndCleanup();
  } catch {}
  process.exitCode = 1;
});
