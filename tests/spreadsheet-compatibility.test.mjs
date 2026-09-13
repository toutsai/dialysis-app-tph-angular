import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import XLSX from '../src/utils/spreadsheet.js'

const fixtures = new URL('./fixtures/spreadsheets/', import.meta.url)
const expected = JSON.parse(readFileSync(new URL('expected.json', fixtures), 'utf8'))
const browserRequire = createRequire(new URL('../angular-client/package.json', import.meta.url))
const browserPackage = dirname(browserRequire.resolve('xlsx'))
const browser = await import(pathToFileURL(join(browserPackage, 'xlsx.mjs')).href)
const codepages = await import(pathToFileURL(join(browserPackage, 'dist/cpexcel.full.mjs')).href)
browser.set_cptable(codepages)

test('server and browser use the patched SheetJS release', () => {
  assert.equal(XLSX.version, '0.20.3')
  assert.equal(browser.version, XLSX.version)
})

for (const [name, library] of [['server', XLSX], ['browser', browser]]) {
  for (const ext of ['xlsx', 'xls']) {
    test(`${name} reads legacy ${ext} including Chinese, leading zeros, numbers and sheets`, () => {
      const bytes = readFileSync(new URL(`legacy.${ext}`, fixtures))
      const workbook = library.read(new Uint8Array(bytes), { type: 'array' })
      assert.deepEqual(workbook.SheetNames, ['合成資料', '排程'])
      assert.deepEqual(library.utils.sheet_to_json(workbook.Sheets['合成資料'], { header: 1 }), expected)
    })
  }
  test(`${name} reads Big5 legacy CSV without corrupting Chinese`, () => {
    const bytes = readFileSync(new URL('legacy-big5.csv', fixtures))
    // SheetJS applies a CSV codepage to binary input (array input assumes Latin-1).
    const workbook = library.read(bytes.toString('latin1'), { type: 'binary', codepage: 950, raw: true })
    assert.deepEqual(library.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1 }), [
      ['病歷號', '姓名', '備註'], ['00001234', '測試甲', '僅為合成資料'],
    ])
  })
  test(`${name} exported workbook remains readable with the opposite entry point`, () => {
    const workbook = library.utils.book_new()
    library.utils.book_append_sheet(workbook, library.utils.aoa_to_sheet(expected), '合成資料')
    const exported = library.write(workbook, { bookType: 'xlsx', type: 'array' })
    const other = name === 'server' ? browser : XLSX
    const loaded = other.read(exported, { type: 'array' })
    assert.deepEqual(other.utils.sheet_to_json(loaded.Sheets['合成資料'], { header: 1 }), expected)
  })
}
