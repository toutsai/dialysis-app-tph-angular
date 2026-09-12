import { test as base, expect } from '@playwright/test';
import { fork } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export const test = base.extend({
  app: [async ({}, use) => {
    const tempRoot = realpathSync(tmpdir());
    const folder = mkdtempSync(join(tempRoot, 'dialysis-browser-'));
    const dbPath = join(folder, 'synthetic.db');
    const db = new Database(dbPath);
    db.exec(readFileSync(join(root, 'src/db/schema.sql'), 'utf8'));
    db.close();
    const child = fork(join(root, 'tests/browser/server.mjs'), [], {
      execArgv: [], windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: { ...process.env, NODE_ENV: 'test', DB_PATH: dbPath, BACKUP_DIR: join(folder, 'backups'),
        DISABLE_SCHEDULER: '1', LOCAL_AUTH_BYPASS: '1', JWT_SECRET: randomBytes(48).toString('hex'),
        TEST_PASSWORD: randomBytes(32).toString('base64url'), DOTENV_CONFIG_PATH: join(folder, 'no-env') },
    });
    try {
      const ready = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Isolated browser server startup timed out')), 30_000);
        child.once('error', reject);
        child.once('exit', code => { clearTimeout(timer); reject(new Error(`Isolated browser server exited ${code}`)); });
        child.on('message', value => { if (value.type === 'ready') { clearTimeout(timer); resolve(value); } });
      });
      const url = `http://127.0.0.1:${ready.port}`;
      const api = async (method, path, body, role = 'admin') => {
        const response = await fetch(url + '/api' + path, { method,
          headers: { Authorization: `Bearer ${ready.tokens[role]}`, 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body) });
        return { status: response.status, data: await response.json() };
      };
      assert.equal((await api('PUT', `/system/inventory/counts/${ready.today}`, {
        counts: { artificialKidney: { 'Browser AK': 10 } }, cutoff: 'end-of-day', countType: 'both', expectedRevision: 0,
      })).status, 200);
      assert.equal((await api('POST', '/system/inventory/purchases', {
        category: 'artificialKidney', item: 'Browser AK', quantity: 5, date: ready.today, status: 'arrived',
      })).status, 201);
      await use({ url, today: ready.today, api, authenticate: async (page, role = 'admin') => {
        await page.clock.setFixedTime(new Date('2026-09-14T04:00:00Z'));
        await page.addInitScript(({ token, role }) => {
          sessionStorage.setItem('auth_token', token);
          sessionStorage.setItem('auth_user', JSON.stringify({ id: `synthetic-${role}`, uid: `synthetic-${role}`, role,
            name: `Synthetic ${role}`, title: '護理師', email: '' }));
        }, { token: ready.tokens[role], role });
      } });
    } finally {
      if (child.exitCode === null) await new Promise(resolve => {
        const timer = setTimeout(() => child.kill(), 5000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
        child.send({ type: 'shutdown' });
      });
      const location = relative(tempRoot, realpathSync(folder));
      assert(location && !location.startsWith('..') && !isAbsolute(location));
      rmSync(folder, { recursive: true, force: true });
    }
  }, { scope: 'worker' }],
  page: async ({ page, app }, use) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      return url.origin === app.url || ['data:', 'blob:'].includes(url.protocol) ? route.continue() : route.abort();
    });
    await use(page);
    expect(errors, 'No uncaught browser errors, including missing template handlers').toEqual([]);
  },
});
export { expect };
