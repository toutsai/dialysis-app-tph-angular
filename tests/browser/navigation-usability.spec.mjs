import { test, expect } from './fixtures.mjs';

test('viewer retains direct inventory navigation and all clerk entry points at narrow width', async ({ page, app }) => {
  await app.authenticate(page, 'viewer');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(app.url + '/inventory?section=inventory&view=calendar');
  await expect(page.getByRole('heading', { name: '庫存管理', exact: true })).toBeVisible();
  const primary = page.getByRole('navigation', { name: '庫存功能', exact: true });
  await expect(primary.getByRole('button')).toHaveCount(3);
  await expect(page.getByRole('navigation', { name: '書記專用功能' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '庫存設定', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '2 實體盤點', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回書記作業', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '書記專用功能' }).getByRole('button')).toHaveCount(6);
  await page.getByRole('button', { name: '庫存管理', exact: true }).click();
  await expect(primary).toBeVisible();
});

for (const role of ['editor', 'contributor']) test(`${role} does not gain inventory route or sidebar rights`, async ({ page, app }) => {
  await app.authenticate(page, role);
  await page.goto(app.url + '/inventory?section=inventory&view=overview');
  await expect(page).not.toHaveURL(/\/inventory(?:\?|$)/);
  await expect(page.getByRole('link', { name: '庫存總覽', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '庫存作業', exact: true })).toHaveCount(0);
});

test('dirty count query and browser Back cancellation preserve URL and draft; accepted exit can restore it', async ({ page, app }) => {
  await app.authenticate(page);
  const baseline = await app.api('GET', `/system/inventory/counts/${app.today}`);
  await page.goto(app.url + '/inventory?section=inventory&view=overview');
  const primary = page.getByRole('navigation', { name: '庫存功能', exact: true });
  await primary.getByRole('button', { name: '作業行事曆', exact: true }).click();
  await page.getByRole('button', { name: '2 實體盤點', exact: true }).click();
  await expect(page.getByRole('button', { name: '儲存盤點', exact: true })).toBeEnabled();
  const notes = page.getByPlaceholder('例如：每週訂單盤點 / 月底盤點');
  const draft = 'Browser navigation draft must survive cancellation';
  await notes.fill(draft);
  const acceptedUrl = page.url();
  let prompts = 0;
  const dismiss = async dialog => { prompts++; await dialog.dismiss(); };
  page.on('dialog', dismiss);
  await page.goBack();
  await expect(page).toHaveURL(acceptedUrl);
  await expect(notes).toHaveValue(draft);
  await expect.poll(() => prompts).toBe(1);
  await primary.getByRole('button', { name: '庫存總覽', exact: true }).click();
  await expect(page).toHaveURL(acceptedUrl);
  await expect(notes).toHaveValue(draft);
  await expect.poll(() => prompts).toBe(2);
  page.off('dialog', dismiss);
  page.once('dialog', dialog => dialog.accept());
  await primary.getByRole('button', { name: '庫存總覽', exact: true }).click();
  await expect(page).toHaveURL(/view=overview/);
  const key = `inventory-count-draft:synthetic-admin:${app.today}`;
  expect(await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)).notes, key)).toBe(draft);
  await page.goBack();
  await expect(page.getByRole('button', { name: '儲存盤點', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '還原草稿', exact: true }).click();
  await expect(notes).toHaveValue(draft);
  expect((await app.api('GET', `/system/inventory/counts/${app.today}`)).data).toEqual(baseline.data);
});

test('calendar source Space opens a native modal without selecting a day; Escape restores focus', async ({ page, app }) => {
  await app.authenticate(page);
  await page.route('**/api/orders/consumables/coverage', route => route.fulfill({ json: [{
    rangeKey: 'browser-his', category: 'artificialKidney', startDate: app.today, endDate: app.today,
    complete: true, sourceFile: 'browser-source.xlsx', uploadedAt: '2026-09-14 09:00:00',
  }] }));
  await page.goto(app.url + '/inventory?section=inventory&view=calendar');
  const source = page.locator('.pc-entries .pc-source-chip').first();
  await expect(source).toBeVisible();
  const before = page.url();
  await source.focus();
  await page.keyboard.press('Space');
  const modal = page.getByRole('dialog', { name: 'HIS來源區間', exact: true });
  await expect(modal).toBeVisible();
  expect(await modal.evaluate(element => element.matches(':modal'))).toBe(true);
  await expect(page).toHaveURL(before);
  for (let step = 0; step < 5; step++) {
    await page.keyboard.press('Tab');
    expect(await modal.evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
  await expect(source).toBeFocused();
  const nextDay = page.locator('.pc-day-button[aria-pressed="false"]').first();
  const selectedDate = (await nextDay.getAttribute('aria-label')).split(' ')[0];
  const day = page.getByRole('button', { name: selectedDate + ' 作業明細', exact: true });
  await day.focus();
  await page.keyboard.press('Space');
  await expect(day).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => new URL(page.url()).searchParams.get('date')).toBe(selectedDate);
});

test('count next-day 503 restores the displayed owner date and keeps the unsaved notes', async ({ page, app }) => {
  await app.authenticate(page);
  let release, received;
  const held = new Promise(resolve => { release = resolve; });
  const requested = new Promise(resolve => { received = resolve; });
  await page.route('**/api/patients', async route => {
    const response = await route.fetch();
    received();
    await held;
    await route.fulfill({ response });
  });
  try {
    await page.goto(app.url + `/inventory?section=inventory&view=calendar&tab=counts&date=${app.today}`);
    await requested;
    await expect(page.getByRole('button', { name: '儲存盤點', exact: true })).toBeDisabled();
    await expect(page.getByPlaceholder('例如：每週訂單盤點 / 月底盤點')).toHaveCount(0);
  } finally { release(); }
  await expect(page.getByRole('button', { name: '儲存盤點', exact: true })).toBeEnabled();
  const notes = page.getByPlaceholder('例如：每週訂單盤點 / 月底盤點');
  await notes.fill('Keep this draft after failed date loading');
  await page.route('**/api/system/inventory/counts/2026-09-15', route => route.fulfill({ status: 503, json: { message: 'Synthetic count load failure' } }));
  page.once('dialog', dialog => dialog.accept());
  await page.getByTitle('後一天', { exact: true }).click();
  await expect(page.getByRole('dialog').filter({ hasText: 'Synthetic count load failure' })).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get('date')).toBe(app.today);
  await expect(page.getByLabel('作業日期', { exact: true })).toHaveValue(app.today);
  await expect(notes).toHaveValue('Keep this draft after failed date loading');
});

test('account visibility, guide sections, and skip link work with the keyboard', async ({ page, app }) => {
  await app.authenticate(page);
  await page.goto(app.url + '/account-settings');
  await page.getByRole('button', { name: '顯示舊密碼', exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#old-password')).toHaveAttribute('type', 'text');
  await expect(page.getByRole('button', { name: '隱藏舊密碼', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#password-requirements')).toContainText('@$!%*?&');
  await page.goto(app.url + '/usage-guide');
  const section = page.locator('.guide-section-button').filter({ hasText: '共用功能' });
  await section.focus();
  await page.keyboard.press('Enter');
  await expect(section).toHaveAttribute('aria-current', 'page');
  const card = page.locator('.page-card button').first();
  await card.focus();
  await page.keyboard.press('Space');
  await expect(card).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('link', { name: '跳到主要內容', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
});

test('sidebar navigation can scroll while account and logout remain inside desktop and mobile viewports', async ({ page, app }) => {
  await app.authenticate(page);
  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto(app.url + '/inventory?section=inventory&view=overview');
    if (viewport.width < 993) await page.getByRole('button', { name: '切換主選單', exact: true }).click();
    const sidebar = page.locator('#main-sidebar');
    await expect(sidebar.getByRole('button', { name: '登出', exact: true })).toBeVisible();
    for (const selector of ['.btn-logout', '.bottom-fixed-section .btn-secondary']) {
      await expect.poll(async () => {
        const box = await sidebar.locator(selector).boundingBox();
        return !!box && box.y >= 0 && box.y + box.height <= viewport.height && box.x >= 0 && box.x + box.width <= viewport.width;
      }).toBe(true);
    }
    const navigation = sidebar.locator('.sidebar-scroll-area');
    expect(await navigation.evaluate(element => getComputedStyle(element).overflowY)).toBe('auto');
    await navigation.evaluate(element => { element.scrollTop = element.scrollHeight; });
    const footer = await sidebar.locator('.btn-logout').boundingBox();
    expect(footer.y + footer.height).toBeLessThanOrEqual(viewport.height);
  }
});
