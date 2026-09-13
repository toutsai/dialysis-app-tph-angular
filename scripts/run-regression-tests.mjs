import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = fileURLToPath(new URL('../', import.meta.url))
const tests = readdirSync(join(root, 'tests'))
  .filter(name => /\.test\.mjs$/.test(name))
  .sort()
  .map(name => join(root, 'tests', name))

if (!tests.length) throw new Error('No regression tests found')
const result = spawnSync(process.execPath, ['--test', ...tests], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, TZ: 'Asia/Taipei', NODE_ENV: 'test' },
  windowsHide: true,
})
if (result.error) throw result.error
process.exitCode = result.status ?? 1
