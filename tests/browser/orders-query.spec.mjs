import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { test, expect } from './fixtures.mjs';

async function patient(app, name) {
  const result = await app.api('POST', '/patients', { name, medicalRecordNumber: 'ORD' + randomUUID().slice(0, 8), status: 'opd', gender: 'M', physician: '合成醫師', birthDate: '1970-01-01', patientCategory: 'opd_regular', dialysisOrders: { mode: 'HD', freq: '一三五' } });
  expect(result.status).toBe(201); return result.data;
}
async function upload(app, rows) {
  const sheet = XLSX.utils.aoa_to_sheet([['病歷號', '醫令碼', '名稱', '次劑量', '開始日', '結束日', '頻率服法', '備註'], ...rows]);
  const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, sheet, '合成資料');
  const result = await app.api('POST', '/orders/medications/upload', { fileName: 'synthetic-orders.xlsx', fileContent: XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' }) });
  expect(result.status).toBe(200); expect(result.data.errorCount).toBe(0); expect(result.data.processedCount).toBe(rows.length);
}
const panel = page => page.locator('app-orders .query-panel').first();
async function open(page, app) {
  await app.authenticate(page); await page.goto(app.url + '/orders');
  await expect(panel(page).getByRole('button', { name: /查詢$/ })).toBeVisible();
}

test('orders exact patient, 12 months, views, preserved failure, submitted export and narrow layout', async ({ page, app }) => {
  const a = await patient(app, '藥囑合成同名患者完整甲');
  const b = await patient(app, '藥囑合成同名患者完整乙');
  await upload(app, [
    [a.medicalRecordNumber, 'INES2', 'NESP', '40', '2026-09-15', '2026-10-05', 'QW4', 'QW4'],
    [a.medicalRecordNumber, 'INES2', 'NESP', '20', '2026-09-01', '', 'QW2', 'QW2'],
    [a.medicalRecordNumber, 'OCAL1', 'A-Cal', '', '2026-09-01', '2026-09-30', 'BID', ''],
    [a.medicalRecordNumber, 'UTEST', '合成未知藥', '3', '2026-09-01', '', 'TID', ''],
    [a.medicalRecordNumber, 'XX88', '自備藥', '1', '2026-09-01', '', 'QD', '合成自備品'],
    [a.medicalRecordNumber, 'PAST', '過去年限定藥', '1', '2025-01-01', '2025-12-31', 'QD', ''],
  ]);
  const readback = await app.api('GET', '/orders/medications?patientId=' + a.id);
  expect(readback.status).toBe(200); expect(Array.isArray(readback.data) ? readback.data : readback.data.data).toHaveLength(6);
  let orderReads = 0;
  page.on('request', request => { if (/\/api\/orders\/(medications|injection-orders)\?/.test(request.url())) orderReads++; });
  await page.setViewportSize({ width: 1280, height: 720 }); await open(page, app);
  const p = panel(page); await p.getByRole('button', { name: '個人搜尋', exact: true }).click();
  await p.getByLabel('患者姓名或病歷號').fill('藥囑合成同名'); await p.getByRole('button', { name: /查詢$/ }).click();
  await expect(p.locator('.patient-choices button')).toHaveCount(2); expect(orderReads).toBe(0);
  await p.locator('.patient-choices').getByRole('button', { name: new RegExp(a.medicalRecordNumber) }).click();
  await expect(p.locator('.order-result-heading h2')).toContainText(a.medicalRecordNumber);
  await expect(p.locator('.order-card')).toHaveCount(12);
  const september = p.locator('.order-card').filter({ has: page.getByRole('heading', { name: '2026-09', exact: true }) });
  await expect(september).toContainText('20 mcg (QW2)'); await expect(september).toContainText('40 mcg (QW4)');
  await expect(september).toContainText('2026-10-05'); await expect(september).toContainText('劑量欄顯示：－');
  await expect(september).toContainText('合成自備品'); await expect(september).toContainText('UTEST');
  const afterQuery = orderReads;
  await page.screenshot({ path: '../ui-orders-desktop-list.png' });
  await p.getByRole('button', { name: '月份對照', exact: true }).click();
  await expect(p.locator('.order-comparison tbody tr')).toHaveCount(12);
  await expect(p.locator('.order-comparison thead th')).toHaveCount(5);
  const sepRow = p.locator('.order-comparison tbody tr').filter({ hasText: '2026-09' });
  await expect(sepRow).toContainText('20 mcg (QW2)；40 mcg (QW4)');
  const october = p.locator('.order-comparison tbody tr').filter({ hasText: '2026-10' });
  await expect(october).toContainText('40 mcg (QW4，至10/5止)');
  await p.getByRole('button', { name: '所有品項', exact: true }).click();
  await expect(p.locator('.order-comparison thead th')).toHaveCount(16);
  await expect(p.locator('.order-comparison thead')).toContainText('PAST');
  await expect(sepRow).toContainText('20 mcg (QW2)；40 mcg (QW4)');
  await p.getByRole('button', { name: '有資料品項', exact: true }).click(); expect(orderReads).toBe(afterQuery);
  await expect(p.locator('.order-comparison thead th')).toHaveCount(5);
  await page.screenshot({ path: '../ui-orders-desktop-comparison.png' });
  // Controls no longer name the accepted result or its exported file.
  await p.getByLabel('患者姓名或病歷號').fill(b.medicalRecordNumber);
  const downloadPromise = page.waitForEvent('download'); await p.getByRole('button', { name: /匯出 Excel/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain(a.name);
  const book = XLSX.read(readFileSync(await download.path()), { type: 'buffer' });
  const exported = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1, defval: '' });
  expect(exported[2]).toHaveLength(16); expect(exported[2]).toContain('Recormon'); expect(exported[2]).toContain('PAST'); expect(exported).toHaveLength(15);
  expect(exported.find(row => row[0] === '2026-09')[1]).toBe('20 mcg (QW2)；40 mcg (QW4)');
  const unavailable = route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: true, message: '合成失敗' }) });
  await page.route('**/api/orders/medications?**', unavailable);
  await p.getByRole('button', { name: /查詢$/ }).click();
  await expect(p.getByRole('alert')).toBeVisible(); await expect(p.locator('.order-result-heading h2')).toContainText(a.medicalRecordNumber);
  await expect(p.locator('.order-result-heading')).toContainText('保留上次成功'); await expect(p.locator('.order-comparison tbody tr')).toHaveCount(12);
  await page.unroute('**/api/orders/medications?**', unavailable);
  await p.getByRole('button', { name: '重試', exact: true }).click(); await expect(p.getByRole('alert')).toBeHidden();
  await expect(p.locator('.order-result-heading h2')).toContainText(b.medicalRecordNumber);
  await p.getByLabel('患者姓名或病歷號').fill(a.medicalRecordNumber.toLowerCase()); await p.getByRole('button', { name: /查詢$/ }).click();
  await expect(p.locator('.order-result-heading h2')).toContainText(a.medicalRecordNumber);
  await page.setViewportSize({ width: 390, height: 844 }); await p.getByRole('button', { name: '清單', exact: true }).click();
  await expect(p.locator('.order-result-heading h2')).toBeVisible(); await expect(p.locator('.order-card').first()).toBeVisible();
  await expect(p.getByRole('button', { name: '更改查詢條件', exact: true })).toBeVisible();
  await expect(p.locator('#order-query-filters')).toBeHidden();
  await expect(p.getByRole('button', { name: '匯出 Excel', exact: true })).toBeEnabled();
  const listHeight = await p.locator('.order-list').evaluate(el => el.getBoundingClientRect().height);
  expect(listHeight).toBeGreaterThanOrEqual(280);
  await p.getByRole('button', { name: '更改查詢條件', exact: true }).click();
  await expect(p.getByLabel('患者姓名或病歷號')).toBeFocused();
  await p.getByLabel('患者姓名或病歷號').fill(b.medicalRecordNumber);
  await expect(p.locator('.order-result-heading h2')).toContainText(a.medicalRecordNumber);
  await p.getByRole('button', { name: /查詢$/ }).click();
  await expect(p.locator('.order-result-heading h2')).toContainText(b.medicalRecordNumber);
  await expect(p.getByRole('button', { name: '更改查詢條件', exact: true })).toBeFocused();
  await expect(p.locator('#order-query-filters')).toBeHidden();
  await p.getByRole('button', { name: '更改查詢條件', exact: true }).click();
  await p.getByLabel('患者姓名或病歷號').fill(a.medicalRecordNumber);
  await p.getByRole('button', { name: /查詢$/ }).click();
  await expect(p.locator('.order-result-heading h2')).toContainText(a.medicalRecordNumber);
  await expect(p.getByRole('button', { name: '更改查詢條件', exact: true })).toBeFocused();
  await p.locator('.order-list').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(p.locator('.order-result-heading h2')).toBeInViewport();
  await p.locator('.order-list').evaluate(el => { el.scrollTop = 0; });
  const overflow = await p.evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth })); expect(overflow.scroll).toBeLessThanOrEqual(overflow.width + 1);
  await page.screenshot({ path: '../ui-orders-mobile-list.png' });
  await p.getByRole('button', { name: '月份對照', exact: true }).click();
  await expect(p.locator('.order-comparison tbody tr')).toHaveCount(12);
  const comparisonHeight = await p.locator('.order-comparison').evaluate(el => el.getBoundingClientRect().height);
  expect(comparisonHeight).toBeGreaterThanOrEqual(280);
  await page.screenshot({ path: '../ui-orders-mobile-comparison.png' });
  writeFileSync('../ui-orders-mobile-after.json', JSON.stringify({ viewport: { width: 390, height: 844 }, listHeight, comparisonHeight, collapsedAfterSuccess: true, keyboardFocusVerified: true, identityRemainsVisibleDuringScroll: true }, null, 2));
});

test('100-patient group keeps no-order row and full export while visible matrix is smaller', async ({ page, app }) => {
  test.setTimeout(180_000);
  const patients = [];
  for (let i = 0; i < 100; i++) patients.push(await patient(app, `群組合成完整患者${String(i + 1).padStart(3, '0')}`));
  const schedule = Object.fromEntries(patients.map((patient, index) => [patient.id, { bedNum: String(index + 1), freq: '二四六', shiftIndex: 0 }]));
  expect((await app.api('PUT', '/schedules/base/MASTER_SCHEDULE', { schedule })).status).toBe(200);
  await upload(app, patients.slice(0, 99).map(patient => [patient.medicalRecordNumber, 'INES2', 'NESP', '20', '2026-09-01', '', 'QW2', 'QW2']));
  await page.setViewportSize({ width: 1280, height: 720 }); await open(page, app);
  const p = panel(page); await p.getByLabel('查詢頻率').selectOption('二四六'); await p.getByLabel('查詢月份').fill('2026-09');
  let orderReads = 0; page.on('request', request => { if (request.url().includes('/orders/injection-orders?')) orderReads++; });
  await p.getByRole('button', { name: /查詢$/ }).click();
  await expect(p.locator('.order-card')).toHaveCount(100);
  await expect(p.locator('.order-card').last()).toContainText('此患者本月無藥囑資料');
  await expect(p.locator('.order-card').first()).toContainText(patients[0].medicalRecordNumber);
  await p.getByRole('button', { name: '表格對照', exact: true }).click();
  await expect(p.locator('.order-comparison tbody tr')).toHaveCount(100);
  await expect(p.locator('.order-comparison tbody td')).toHaveCount(100);
  const visible = await p.locator('.order-comparison').evaluate(el => ({ rows: el.querySelectorAll('tbody tr').length, cells: el.querySelectorAll('tbody td').length, headers: el.querySelectorAll('thead th').length, width: el.clientWidth, scrollWidth: el.scrollWidth, text: el.querySelector('tbody').textContent }));
  expect(visible.cells).toBe(100);
  await p.getByRole('button', { name: '所有品項', exact: true }).click();
  await expect(p.locator('.order-comparison tbody td')).toHaveCount(1200);
  const all = await p.locator('.order-comparison').evaluate(el => ({ rows: el.querySelectorAll('tbody tr').length, cells: el.querySelectorAll('tbody td').length, headers: el.querySelectorAll('thead th').length, width: el.clientWidth, scrollWidth: el.scrollWidth, text: el.querySelector('tbody').textContent }));
  expect(all.cells).toBe(1200); expect(orderReads).toBe(1);
  await p.getByRole('button', { name: '有資料品項', exact: true }).click();
  const downloadPromise = page.waitForEvent('download'); await p.getByRole('button', { name: /匯出 Excel/ }).click();
  const download = await downloadPromise; const workbook = XLSX.read(readFileSync(await download.path()), { type: 'buffer' });
  const exported = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: '' });
  expect(exported).toHaveLength(103); expect(exported[2]).toHaveLength(16); expect(exported[102][3]).toBe(patients[99].name);
  await p.getByLabel('查詢月份').fill('2026-10'); await expect(p.locator('.order-result-heading h2')).toContainText('2026-09');
  const unavailable = route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":true}' });
  await page.route('**/api/orders/injection-orders?**', unavailable); await p.getByRole('button', { name: /查詢$/ }).click();
  await expect(p.getByRole('alert')).toBeVisible(); await expect(p.locator('.order-comparison tbody tr')).toHaveCount(100); await expect(p.locator('.order-result-heading h2')).toContainText('2026-09');
  await page.unroute('**/api/orders/injection-orders?**', unavailable);
  const hash = text => createHash('sha256').update(text).digest('hex');
  writeFileSync('../ui-orders-browser-after.json', JSON.stringify({ scope: 'Actual isolated Chromium DOM counts, synthetic 100-patient group. No previous-build browser timing or hospital performance claim.', viewport: { width: 1280, height: 720 }, visible: { ...visible, text: undefined, textHash: hash(visible.text) }, all: { ...all, text: undefined, textHash: hash(all.text) }, orderReadsBeforeFailure: 1, exportedRows: exported.length - 3, exportedColumns: exported[2].length }, null, 2));
});
