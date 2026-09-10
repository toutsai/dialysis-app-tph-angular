import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = fileURLToPath(new URL('../', import.meta.url))
function scriptsIn(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filename = join(directory, entry.name)
    return entry.isDirectory() ? scriptsIn(filename) : /\.(?:js|mjs|cjs)$/.test(entry.name) ? [filename] : []
  })
}
const files = ['src', 'scripts', 'tests'].flatMap(dir => scriptsIn(join(root, dir)))
let failed = 0
for (const filename of files) {
  const result = spawnSync(process.execPath, ['--check', filename], { encoding: 'utf8', windowsHide: true })
  if (result.error || result.status !== 0) {
    failed++
    console.error(relative(root, filename), result.error?.message || result.stderr)
  }
}
console.log(`Syntax check: ${files.length - failed}/${files.length} passed`)
process.exitCode = failed ? 1 : 0
