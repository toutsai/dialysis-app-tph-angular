import { test, expect } from './fixtures.mjs';

test('nursing month and week views preserve nurse rows and day columns across month navigation', async ({ page, app }) => {
  for (const [month, days, name] of [['2026-09', 30, '九月合成護理師'], ['2026-10', 31, '十月合成護理師']]) {
    const result = await app.api('PUT', `/nursing/schedules/${month}`, {
      yearMonth: month, title: `${month} 合成護理班表`, maxDaysInMonth: days,
      scheduleByNurse: { 'synthetic-admin': { nurseName: name, shifts: Array(days).fill('白班'), groups: Array(days).fill('A') } },
    });
    expect(result.status).toBe(200);
  }
  await app.authenticate(page);
  await page.goto(app.url + '/nursing-schedule');
  await page.getByRole('button', { name: '當月總班表', exact: true }).click();
  await expect(page.getByLabel('月份：', { exact: true })).toHaveValue('2026-09');
  let row = page.getByRole('row').filter({ hasText: '九月合成護理師' });
  await expect(row).toHaveCount(1);
  await expect(row.getByRole('cell')).toHaveCount(31);
  await page.getByRole('button', { name: '當月週班表', exact: true }).click();
  await page.getByRole('button', { name: /^第 1 週/ }).click();
  await expect(page.getByRole('row').filter({ hasText: '九月合成護理師' })).toBeVisible();
  await page.getByTitle('下個月', { exact: true }).click();
  await expect(page.getByTitle('月份', { exact: true })).toHaveValue('2026-10');
  await page.getByRole('button', { name: /^第 1 週/ }).click();
  await expect(page.getByRole('row').filter({ hasText: '十月合成護理師' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: '九月合成護理師' })).toHaveCount(0);
  await page.getByRole('button', { name: '當月總班表', exact: true }).click();
  row = page.getByRole('row').filter({ hasText: '十月合成護理師' });
  await expect(row.getByRole('cell')).toHaveCount(32);
  await page.getByRole('button', { name: '當月週班表', exact: true }).click();
  await page.getByTitle('上個月', { exact: true }).click();
  await expect(page.getByTitle('月份', { exact: true })).toHaveValue('2026-09');
  await page.getByRole('button', { name: /^第 1 週/ }).click();
  await expect(page.getByRole('row').filter({ hasText: '九月合成護理師' })).toBeVisible();
});

test('daily log removes the middle of three manually added rows and saves the correct survivors', async ({ page, app }) => {
  await app.authenticate(page);
  await page.goto(app.url + '/daily-log');
  const section = page.locator('section').filter({ has: page.getByRole('heading', { name: '病人動態表', exact: true }) }).filter({ has: page.getByRole('button', { name: '新增手動動態', exact: true }) });
  for (const [index, name] of ['遷移合成甲', '遷移合成乙', '遷移合成丙'].entries()) {
    // Manual rows use Date.now IDs; keep the fixed test day but give each click a unique instant.
    await page.clock.setFixedTime(new Date(Date.parse('2026-09-14T04:00:00Z') + index * 1000));
    await section.getByRole('button', { name: '新增手動動態', exact: true }).click();
    const row = section.getByRole('row').filter({ has: page.getByRole('button', { name: '儲存', exact: true }) });
    const input = row.getByPlaceholder('搜尋病人...', { exact: true });
    await input.fill(name);
    const saved = page.waitForResponse(response => response.url().includes(`/nursing/daily-logs/${app.today}`) && ['PUT', 'PATCH'].includes(response.request().method()));
    await row.getByRole('button', { name: '儲存', exact: true }).click();
    expect((await saved).ok()).toBeTruthy();
    await page.getByRole('button', { name: '確定', exact: true }).click();
  }
  // Existing name inputs have a placeholder but no aria label; scope by their actual value.
  const nameInputs = section.getByPlaceholder('搜尋病人...', { exact: true });
  let middleIndex = -1;
  for (let index = 0; index < await nameInputs.count(); index++) if (await nameInputs.nth(index).inputValue() === '遷移合成乙') middleIndex = index;
  expect(middleIndex).toBeGreaterThanOrEqual(0);
  const rowToDelete = nameInputs.nth(middleIndex).locator('xpath=ancestor::tr');
  await rowToDelete.getByRole('button', { name: '編輯', exact: true }).click();
  await rowToDelete.getByRole('button', { name: '移除', exact: true }).click();
  await page.getByRole('button', { name: '確認', exact: true }).click();
  await page.getByRole('button', { name: '歷史版本', exact: true }).click();
  await page.getByRole('button', { name: '先儲存目前內容', exact: true }).click();
  await expect(page.getByRole('button', { name: '先儲存目前內容', exact: true })).toBeHidden();
  await page.getByRole('button', { name: '關閉歷史版本', exact: true }).click();
  await page.reload();
  await expect(section.getByRole('button', { name: '新增手動動態', exact: true })).toBeEnabled();
  const persisted = await app.api('GET', `/nursing/daily-logs/${app.today}`);
  const savedNames = persisted.data.patientMovements.filter(row => row.name.startsWith('遷移合成')).map(row => row.name);
  expect([...savedNames].sort()).toEqual(['遷移合成甲', '遷移合成丙'].sort());
  await expect.poll(async () => {
    const inputs = section.getByPlaceholder('搜尋病人...', { exact: true });
    const values = await Promise.all(Array.from({ length: await inputs.count() }, (_, index) => inputs.nth(index).inputValue()));
    return values.filter(value => value.startsWith('遷移合成'));
  }).toEqual(savedNames);
});
