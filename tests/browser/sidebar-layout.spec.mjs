import { test, expect } from './fixtures.mjs';
import { writeFileSync } from 'node:fs';

const notifications = Array.from({ length: 20 }, (_, i) => ({
  id: `sidebar-synthetic-${i}`, type: 'info',
  title: `合成操作通知 ${i + 1}：排程與資料已更新，請核對後續作業`,
  createdByName: '模擬操作員', createdAt: '2026-09-14 11:00:00',
}));

async function settleSidebar(page) {
  await page.locator('#main-sidebar').evaluate(async element => {
    await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {})));
  });
}

async function expectFixedEnds(page) {
  for (const selector of ['.platform-title', '.user-info', '.btn-logout', '.bottom-fixed-section .btn-secondary']) {
    await expect(page.locator('#main-sidebar').locator(selector)).toBeInViewport({ ratio: 1 });
  }
}

async function openFixture(page, app, items = notifications) {
  await app.authenticate(page);
  await page.route('**/api/system/notifications?*', route => route.fulfill({ json: items }));
  await page.goto(app.url + '/patients');
  await expect(page.locator('.notification-item')).toHaveCount(items.length);
}

for (const viewport of [{ width: 1280, height: 720 }, { width: 1366, height: 768 }, { width: 1280, height: 600 }]) {
  test(`notifications and expanded management preserve usable navigation at ${viewport.width}x${viewport.height}`, async ({ page, app }, testInfo) => {
    await page.setViewportSize(viewport);
    await openFixture(page, app);
    const sidebar = page.locator('#main-sidebar');
    const scrollArea = sidebar.locator('.sidebar-scroll-area');
    const navigation = sidebar.locator('.main-nav-section');
    const navBefore = await navigation.boundingBox();
    await sidebar.getByRole('button', { name: /後臺管理/ }).click();
    await expect(sidebar.locator('#management-links')).toBeVisible();
    const navAfter = await navigation.boundingBox();
    expect(navAfter.height).toBeCloseTo(navBefore.height, 1);
    // The full common navigation retains its content height, even on a short screen.
    expect(await navigation.evaluate(element => element.clientHeight >= element.scrollHeight)).toBe(true);
    await scrollArea.evaluate(element => { element.scrollTop = 0; });
    await expect(sidebar.getByRole('link', { name: '每日排程', exact: true })).toBeInViewport({ ratio: 1 });
    await expectFixedEnds(page);
    await page.screenshot({ path: testInfo.outputPath('desktop-expanded.png') });

    const lastManagementLink = sidebar.locator('#management-links a').last();
    await lastManagementLink.scrollIntoViewIfNeeded();
    await expect(lastManagementLink).toBeInViewport({ ratio: 1 });
    await scrollArea.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(sidebar.locator('.notification-item').last()).toBeInViewport({ ratio: 1 });
    await expectFixedEnds(page);
    await page.screenshot({ path: testInfo.outputPath('desktop-last-notification.png') });
    expect(await sidebar.evaluate(element => [...element.querySelectorAll('*')].filter(child => {
      const style = getComputedStyle(child);
      return /auto|scroll/.test(style.overflowY) && child.scrollHeight > child.clientHeight;
    }).map(child => child.className))).toEqual(['sidebar-scroll-area']);
    const measurementsPath = testInfo.outputPath('sidebar-measurements.json');
    writeFileSync(measurementsPath, JSON.stringify({
      viewport, navBefore: navBefore.height, navAfter: navAfter.height,
      scrolling: await scrollArea.evaluate(element => ({ height: element.clientHeight, contentHeight: element.scrollHeight, bottom: element.scrollTop })),
    }, null, 2));
    await testInfo.attach('sidebar-measurements', { contentType: 'application/json', path: measurementsPath });
    await scrollArea.evaluate(element => { element.scrollTop = 0; });
    await expect(sidebar.getByRole('link', { name: '每日排程', exact: true })).toBeInViewport({ ratio: 1 });
  });
}

test('closed drawer skips keyboard focus and remains usable across responsive resizing', async ({ page, app }, testInfo) => {
  await page.setViewportSize({ width: 993, height: 650 });
  await openFixture(page, app);
  const sidebar = page.locator('#main-sidebar');
  const toggle = page.getByRole('button', { name: '切換主選單', exact: true });
  await expect(sidebar).toBeVisible();
  expect((await sidebar.boundingBox()).width).toBe(210);
  for (const width of [992, 600, 390]) {
    await page.setViewportSize({ width, height: 650 });
    await settleSidebar(page);
    await expect(sidebar).toBeHidden();
    await toggle.focus();
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => !!document.activeElement.closest('#main-sidebar'))).toBe(false);
    await toggle.focus();
    for (let i = 0; i < 16; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement.closest('#main-sidebar'))).toBe(false);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    if (width === 390) await page.screenshot({ path: testInfo.outputPath('mobile-closed.png') });
    await toggle.click();
    await settleSidebar(page);
    await expect(sidebar).toBeVisible();
    expect((await sidebar.boundingBox()).width).toBe(width <= 768 ? 260 : 210);
    await expectFixedEnds(page);
    const management = sidebar.getByRole('button', { name: /後臺管理/ });
    if (await management.getAttribute('aria-expanded') !== 'true') await management.click();
    await sidebar.locator('.sidebar-scroll-area').evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(sidebar.locator('.notification-item').last()).toBeInViewport({ ratio: 1 });
    await sidebar.getByRole('button', { name: '登出', exact: true }).focus();
    await expect(sidebar.getByRole('button', { name: '登出', exact: true })).toBeFocused();
    await expectFixedEnds(page);
    await sidebar.locator('.sidebar-scroll-area').evaluate(element => { element.scrollTop = 0; });
    if (width === 390) await page.screenshot({ path: testInfo.outputPath('mobile-open.png') });
    await page.locator('.sidebar-overlay').click({ position: { x: width - 10, y: 100 } });
    await settleSidebar(page);
    await expect(sidebar).toBeHidden();
  }
  await page.setViewportSize({ width: 993, height: 650 });
  await settleSidebar(page);
  await expect(sidebar).toBeVisible();
  await expectFixedEnds(page);
  await expect(page.locator('.sidebar-overlay')).toHaveCount(0);
});

test('empty notifications leave no blank notification panel', async ({ page, app }) => {
  await openFixture(page, app, []);
  await expect(page.locator('.notification-area')).toHaveCount(0);
  await expectFixedEnds(page);
});
