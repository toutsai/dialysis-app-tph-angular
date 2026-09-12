import { randomUUID } from 'node:crypto';
import { test, expect } from './fixtures.mjs';

async function patient(app, name) {
  const response = await app.api('POST', '/patients', {
    name, medicalRecordNumber: 'UX' + randomUUID().slice(0, 8), status: 'opd', gender: 'M',
    physician: '模擬醫師', birthDate: '1970-01-01', patientCategory: 'opd_regular',
    dialysisOrders: { mode: 'HD', freq: '一三五' }, notes: '介面回歸模擬資料',
  });
  expect(response.status).toBe(201);
  return response.data;
}

test('patient summary ignores a real earlier response after selecting another patient', async ({ page, app }) => {
  const a = await patient(app, '介面回歸甲');
  const b = await patient(app, '介面回歸乙');
  await app.authenticate(page);
  let release, arrived;
  const held = new Promise(resolve => { release = resolve; });
  const received = new Promise(resolve => { arrived = resolve; });
  await page.route(`**/api/patients/${a.id}`, async route => {
    const response = await route.fetch();
    arrived();
    await held;
    await route.fulfill({ response });
  });
  try {
    await page.goto(app.url + '/patients');
    await page.getByRole('button', { name: '病歷查詢', exact: true }).click();
    const search = page.getByPlaceholder('輸入姓名或病歷號查詢病人...');
    await search.fill(a.medicalRecordNumber);
    await page.getByRole('button', { name: new RegExp(a.name) }).click();
    await received;
    await search.fill(b.medicalRecordNumber);
    await page.getByRole('button', { name: new RegExp(b.name) }).click();
    await expect(page.locator('.summary-card .ch-name')).toHaveText(b.name);
    await page.getByRole('button', { name: '基本資料', exact: true }).click();
    await expect(page.locator('app-patient-basic-profile')).toBeVisible();
    const oldResponse = page.waitForResponse(response => response.url().endsWith('/patients/' + a.id));
    release();
    await oldResponse;
    // Wait for Angular's render turn after the delivered response, without a fixed sleep.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.locator('.summary-card .ch-name')).toHaveText(b.name);
    await expect(page.locator('.summary-card .ch-mrn')).toContainText(b.medicalRecordNumber);
  } finally { release(); }
});

test('failed report reads show a retry and never claim that the period has no data', async ({ page, app }) => {
  await app.authenticate(page);
  const unavailable = route => route.fulfill({ status: 503, contentType: 'application/json',
    body: JSON.stringify({ error: true, message: '模擬資料來源暫時無法讀取' }) });
  await page.route('**/api/schedules**', unavailable);
  await page.goto(app.url + '/reporting');
  await page.getByRole('button', { name: /日報表/ }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByText('此期間無資料', { exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: /匯出 Excel/ })).toBeDisabled();
  await page.unroute('**/api/schedules**', unavailable);
  await page.getByRole('button', { name: '重試', exact: true }).click();
  await expect(page.getByRole('alert')).toBeHidden();
  await expect(page.getByRole('button', { name: /匯出 Excel/ })).toBeEnabled();
  await page.getByRole('button', { name: /顯示明細表/ }).click();
  await expect(page.getByRole('columnheader', { name: '當日總計', exact: true })).toBeVisible();
});
