import { test, expect } from './fixtures.mjs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

test('PDF title bands follow real table and text geometry across large spacing', async ({ page }) => {
  const require = createRequire(new URL('../../angular-client/package.json', import.meta.url));
  const ts = require('typescript');
  const source = await readFile(new URL('../../angular-client/src/app/features/daily-log/pdf-pagination.ts', import.meta.url), 'utf8');
  const helper = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  await page.setContent(`<style>body{margin:0}#paper{width:800px}h2{margin:0 0 90px;height:30px}table{border-collapse:collapse;width:100%}th,td{height:55px}p{margin:75px 0 0;line-height:28px}</style>
    <div id="paper"><div style="height:330px"></div><section><h2>病人動態表</h2><table><thead><tr><th>姓名</th></tr></thead><tbody><tr><td>合成甲</td></tr><tr><td>合成丙</td></tr></tbody></table></section>
    <section><h2>其他事項</h2><p>首行中文內容<br>第二行中文內容</p></section><div style="height:800px"></div></div>`);
  const result = await page.evaluate(code => {
    const exports = {}; new Function('exports', code)(exports);
    const root = document.getElementById('paper');
    const headings = [...root.querySelectorAll('h2')];
    const heading = headings[0].getBoundingClientRect();
    const capacity = heading.bottom + 40;
    const bands = exports.collectPdfBands(root, 1, capacity);
    const pages = exports.planPdfSlices(root.getBoundingClientRect().height, capacity, bands);
    const row = root.querySelector('tbody tr').getBoundingClientRect();
    const paragraph = root.querySelector('p');
    const range = document.createRange(); range.selectNodeContents(paragraph.firstChild);
    return { bands, pages, headingTop: heading.top, rowBottom: row.bottom, textHeadingTop: headings[1].getBoundingClientRect().top, firstLineBottom: range.getClientRects()[0].bottom };
  }, helper);
  expect(result.pages[0].end).toBeLessThanOrEqual(result.headingTop);
  expect(result.bands.some(band => band.top <= result.headingTop && band.bottom >= result.rowBottom)).toBeTruthy();
  expect(result.bands.some(band => band.top <= result.textHeadingTop && band.bottom >= result.firstLineBottom)).toBeTruthy();
  for (let index = 1; index < result.pages.length; index++) expect(result.pages[index].start).toBe(result.pages[index - 1].end);
});

// The application exports a canvas image, not a PDF text layer. Keep the actual
// PDF and source screenshot for visual Chinese glyph / page-boundary review.
test('daily log exports a dated, image-backed multipage PDF after saving Chinese notes', async ({ page, app }, testInfo) => {
  test.setTimeout(120_000);
  await app.authenticate(page);
  await page.goto(app.url + '/daily-log');
  const notes = page.getByRole('textbox', { name: '其他事項', exact: true });
  await expect(notes).toBeVisible();
  const text = [
    'PDF 中文驗收：血液透析中心工作日誌／合成資料，非真實病人。',
    ...Array.from({ length: 70 }, (_, index) => `第 ${String(index + 1).padStart(2, '0')} 列：護理交班、血管通路、營運統計；中文與數字 123，符號 ＋－％。`),
    '最後一列：跨頁內容應完整保留，無裁切或重複。',
  ].join('\n');
  await notes.fill(text);
  await expect(page.locator('.current-date-text')).toContainText('2026');

  const saved = page.waitForResponse(response => response.url().endsWith(`/nursing/daily-logs/${app.today}`)
    && response.request().method() === 'PUT');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '匯出 PDF', exact: true }).click();
  expect((await saved).ok(), 'Export saves the edited synthetic note first').toBeTruthy();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe(`血液透析中心工作日誌_${app.today}.pdf`);
  expect(await download.failure()).toBeNull();
  const pdfPath = testInfo.outputPath('daily-log-chinese-multipage.pdf');
  await download.saveAs(pdfPath);
  const bytes = await readFile(pdfPath);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  expect(bytes.length).toBeGreaterThan(20_000);
  const structure = bytes.toString('latin1');
  const pages = [...structure.matchAll(/\/Type\s*\/Page\b/g)];
  expect(pages.length, 'Long visible note must create multiple pages').toBeGreaterThan(1);
  expect(pages.length, 'Unexpectedly excessive pagination').toBeLessThan(20);
  expect([...structure.matchAll(/\/Subtype\s*\/Image\b/g)].length, 'Each page embeds its own non-overlapping slice, not the same tall image at negative offsets').toBe(pages.length);
  expect(structure).toMatch(/\/DCTDecode\b/);
  expect(structure).toMatch(/%%EOF\s*$/);

  await expect(page.getByRole('button', { name: '匯出 PDF', exact: true })).toBeEnabled();
  await expect(page.locator('#pdf-export-area')).not.toHaveClass(/pdf-export-mode/);
  expect((await app.api('GET', `/nursing/daily-logs/${app.today}`)).data.otherNotes).toBe(text);
  await testInfo.attach('actual-generated-pdf', { path: pdfPath, contentType: 'application/pdf' });
  await testInfo.attach('visible-chinese-source', {
    body: await page.locator('#pdf-export-area').screenshot(), contentType: 'image/png',
  });
});
