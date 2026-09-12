import { test, expect } from './fixtures.mjs';

async function evidence(target, testInfo, name) {
  const path = testInfo.outputPath(`${name}.png`);
  await target.screenshot({ path });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

test('daily log blocks keyboard edits while the real initial response is delayed, then preserves a saved edit', async ({ page, app }) => {
  await app.authenticate(page);
  let release, received;
  const held = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { received = resolve; });
  let intercepted = false;
  await page.route(`**/api/nursing/daily-logs/${app.today}`, async route => {
    if (intercepted || route.request().method() !== 'GET') return route.fallback();
    intercepted = true;
    // Only delay delivery: keep the real authenticated server response and business data.
    const response = await route.fetch();
    received();
    await held;
    await route.fulfill({ response });
  });
  try {
    await page.goto(app.url + '/daily-log');
    await ready;
    const notes = page.getByLabel('其他事項', { exact: true });
    await expect(notes).toBeVisible();
    const locked = () => notes.evaluate(element => element.matches(':disabled') || !!element.closest('[inert]'));
    await expect.poll(locked, 'Loading must disable or make the editing container inert').toBe(true);
    const before = await notes.inputValue();
    await notes.focus();
    await page.keyboard.type('Synthetic text must not enter while loading');
    await expect(notes).not.toBeFocused();
    await expect(notes).toHaveValue(before);
    release();
    await expect.poll(locked).toBe(false);
    await notes.fill('Synthetic edit after real load completes');
    await expect(notes).toHaveValue('Synthetic edit after real load completes');
    await page.getByRole('button', { name: '歷史版本', exact: true }).click();
    const saved = page.waitForResponse(response => response.url().endsWith(`/nursing/daily-logs/${app.today}`) && response.request().method() === 'PUT');
    await page.getByRole('button', { name: '先儲存目前內容', exact: true }).click();
    expect((await saved).ok()).toBeTruthy();
    await expect(page.getByRole('button', { name: '先儲存目前內容', exact: true })).toBeHidden();
    await page.getByRole('button', { name: '關閉歷史版本' }).click();
    await page.reload();
    await expect(notes).toHaveValue('Synthetic edit after real load completes');
  } finally { release(); }
});

test('daily log saves notes, lazily compares history, restores only selected notes and survives reload', async ({ page, app }, testInfo) => {
  await app.authenticate(page);
  await page.goto(app.url + '/daily-log');
  const notes = page.getByRole('textbox', { name: '其他事項', exact: true });
  await expect(notes).toBeVisible();
  await expect(page.getByRole('button', { name: '歷史版本', exact: true })).toBeEnabled();
  async function save(value) {
    await notes.fill(value);
    await expect(notes).toHaveValue(value);
    await page.getByRole('button', { name: '歷史版本', exact: true }).click();
    await expect(notes).toHaveValue(value);
    const response = page.waitForResponse(r => r.url().includes(`/nursing/daily-logs/${app.today}`) && ['PUT', 'PATCH'].includes(r.request().method()));
    await page.getByRole('button', { name: '先儲存目前內容' }).click();
    expect((await response).ok()).toBeTruthy();
    await expect(page.getByRole('button', { name: '先儲存目前內容' })).toBeHidden();
    await page.getByRole('button', { name: '關閉歷史版本' }).click();
    await expect(page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: '日誌歷史版本', exact: true }) })).toBeHidden();
  }
  await save('Synthetic first nursing note');
  await save('Synthetic revised nursing note');
  const details = [];
  page.on('request', request => { if (/\/revisions\/[^/?]+(?:\?|$)/.test(request.url())) details.push(request.url()); });
  const listing = page.waitForResponse(r => /\/revisions\?/.test(r.url()) && r.request().method() === 'GET');
  await page.getByRole('button', { name: '歷史版本', exact: true }).click();
  const metadata = await (await listing).json();
  expect(metadata.length).toBeGreaterThan(0);
  for (const revision of metadata) {
    expect(revision).not.toHaveProperty('otherNotes');
    expect(revision).not.toHaveProperty('patientMovements');
  }
  expect(details).toHaveLength(0);
  const history = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: '日誌歷史版本', exact: true }) });
  await history.getByRole('complementary', { name: '版本清單' }).getByRole('button', { name: /儲存前保留版本/ }).first().click();
  await expect(history.getByText('Synthetic first nursing note', { exact: true })).toBeVisible();
  expect(details).toHaveLength(1);
  await history.getByRole('checkbox', { name: /其他事項.*有差異/ }).check();
  await evidence(history, testInfo, 'daily-log-history-selected-difference');
  await history.getByRole('button', { name: '復原所選內容…', exact: true }).click();
  const restored = page.waitForResponse(r => r.url().endsWith('/restore') && r.request().method() === 'POST');
  await history.getByRole('button', { name: '確認復原', exact: true }).click();
  expect((await restored).ok()).toBeTruthy();
  await history.getByRole('button', { name: '關閉歷史版本' }).click();
  await expect(notes).toHaveValue('Synthetic first nursing note');
  await page.reload();
  await expect(notes).toHaveValue('Synthetic first nursing note');
});

test('administrator sees health and creates a verified backup', async ({ page, app }, testInfo) => {
  await app.authenticate(page);
  await page.goto(app.url + '/backup');
  await expect(page.getByRole('heading', { name: '備份狀態', exact: true })).toBeVisible();
  const saved = page.waitForResponse(r => r.url().endsWith('/system/backup') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '立即備份', exact: true }).click();
  const response = await saved;
  expect(response.status()).toBe(200);
  const result = await response.json();
  await expect(page.getByText(result.backupFile, { exact: true }).first()).toBeVisible();
  const health = await app.api('GET', '/system/backup-health');
  expect(health.data.verification.result).toBe('ok');
  expect(health.data.lastSuccess.sizeBytes).toBeGreaterThan(0);
  await evidence(page, testInfo, 'backup-health-success');
});

test('non-administrator cannot view backup page or create a backup', async ({ page, app }) => {
  await app.authenticate(page, 'viewer');
  await page.goto(app.url + '/backup');
  await expect(page).not.toHaveURL(/\/backup(?:\?|$)/);
  expect((await app.api('GET', '/system/backup-health', undefined, 'viewer')).status).toBe(403);
  expect((await app.api('POST', '/system/backup', {}, 'viewer')).status).toBe(403);
});

test('item detail uses end-of-day physical count without double-counting same-day receipt and closes with Escape', async ({ page, app }, testInfo) => {
  await app.authenticate(page);
  await page.goto(app.url + '/inventory?section=inventory&view=overview');
  const item = page.getByRole('button', { name: /Browser AK/ }).first();
  await item.click();
  const dialog = page.getByRole('dialog', { name: 'Browser AK', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('10 個', { exact: true }).first()).toBeVisible();
  const current = dialog.locator('section').filter({ has: page.getByRole('heading', { name: '目前推估可用量' }) });
  await expect(current.getByText('10 個', { exact: true })).toBeVisible();
  await expect(dialog.getByText(/日終/).first()).toBeVisible();
  await evidence(dialog, testInfo, 'inventory-item-end-of-day');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(item).toBeFocused();
});
