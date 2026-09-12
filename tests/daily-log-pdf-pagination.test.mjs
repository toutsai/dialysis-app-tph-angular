import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const ts = createRequire(new URL('../angular-client/package.json', import.meta.url))('typescript');
const source = readFileSync(new URL('../angular-client/src/app/features/daily-log/pdf-pagination.ts', import.meta.url), 'utf8');
const exports = {};
new Function('exports', ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)(exports);
const { planPdfSlices } = exports;

test('every source pixel belongs to exactly one page with no repeated strips', () => {
  const pages = planPdfSlices(5019, 1603.7, [{ top: 1592, bottom: 1628 }, { top: 3120, bottom: 3260 }]);
  const counts = new Uint8Array(5019);
  for (const page of pages) {
    assert(page.end - page.start <= 1603);
    for (let y = page.start; y < page.end; y++) counts[y]++;
  }
  assert(counts.every(count => count === 1), 'No original image row can be omitted or repeated');
  assert.equal(pages[0].end, 1592);
  assert.equal(pages[1].end, 3120);
});

test('page cuts avoid Chinese text line bands and complete table rows', () => {
  const bands = Array.from({ length: 70 }, (_, index) => ({ top: 100 + index * 31, bottom: 124 + index * 31 }));
  bands.push({ top: 880, bottom: 1040 });
  const pages = planPdfSlices(2420, 950, bands);
  for (const page of pages.slice(0, -1)) {
    assert(!bands.some(band => band.top < page.end && band.bottom > page.end));
  }
  assert.equal(pages[0].end, 875, 'Move above both the table row and overlapping text line');
});

test('an oversized block still progresses and retains the complete last line', () => {
  const pages = planPdfSlices(2401, 1000, [{ top: 0, bottom: 2200 }, { top: 985, bottom: 1015 }]);
  assert.equal(pages[0].end, 985);
  assert.equal(pages.at(-1).end, 2401);
  for (let i = 1; i < pages.length; i++) assert.equal(pages[i].start, pages[i - 1].end);
});
