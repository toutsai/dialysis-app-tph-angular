// Compatibility entry point: the former script mutated data/dialysis.db.
// Its replacement only runs the isolated regression suite with synthetic data.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const testPath = fileURLToPath(new URL('../tests/schedule-integrity.test.mjs', import.meta.url))
const result = spawnSync(process.execPath, ['--test', testPath], {
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'test', TZ: 'Asia/Taipei' },
  windowsHide: true,
})
if (result.error) throw result.error
process.exitCode = result.status ?? 1
