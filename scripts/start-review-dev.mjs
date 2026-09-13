// Dedicated manual review instance: its database, secrets and port are separate.
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import bcrypt from 'bcryptjs'

const root = realpathSync(fileURLToPath(new URL('../', import.meta.url)))
const devRoot = join(root, 'data-dev')
mkdirSync(devRoot, { recursive: true })
function assertInsideDev(filename) {
  const resolved = existsSync(filename) ? realpathSync(filename) : join(realpathSync(dirname(filename)), filename.split(/[\\/]/).pop())
  const rel = relative(root, realpathSync(devRoot))
  const child = relative(realpathSync(devRoot), resolved)
  if (rel.startsWith('..') || isAbsolute(rel) || child.startsWith('..') || isAbsolute(child)) {
    throw new Error('Review instance paths must stay inside this checkout/data-dev')
  }
}
const dbPath = join(devRoot, 'dialysis.db')
const secretsPath = join(devRoot, 'secrets.json')
assertInsideDev(dbPath)
assertInsideDev(secretsPath)
if (!existsSync(secretsPath)) {
  writeFileSync(secretsPath, JSON.stringify({
    jwt: randomBytes(48).toString('base64url'),
    pin: randomBytes(48).toString('base64url'),
  }), { flag: 'wx', mode: 0o600 })
}
const secrets = JSON.parse(readFileSync(secretsPath, 'utf8'))
if (typeof secrets.jwt !== 'string' || secrets.jwt.length < 32 || typeof secrets.pin !== 'string' || secrets.pin.length < 32) {
  throw new Error('Invalid review instance secrets')
}
const port = Number(process.env.REVIEW_PORT || 3003)
if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 3000 || port === 3001 || port === 3002) {
  throw new Error('REVIEW_PORT must be 1024-65535 and distinct from the existing 3000/3001/3002 sites')
}

// Set before dynamic imports: database modules capture DB_PATH at module load.
process.env.DB_PATH = dbPath
const { initDatabase, getDatabase, closeDatabase } = await import('../src/db/init.js')
const { runMigrations } = await import('../src/db/migrate.js')
try {
  initDatabase()
  closeDatabase()
  runMigrations()
  initDatabase()
  const db = getDatabase()
  if (db.prepare('SELECT count(*) AS count FROM users').get().count === 0) {
    const password = randomBytes(15).toString('base64url')
    db.prepare('INSERT INTO users (id, username, password_hash, name, title, role, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)')
      .run(randomUUID(), 'admin', bcrypt.hashSync(password, 10), '測試管理員', '管理員', 'admin')
    console.log(`首次測試登入：admin / ${password}`)
    console.log('請記下這組本機測試密碼；下次啟動沿用既有帳號。')
  }
} finally {
  closeDatabase()
}

if (!existsSync(join(root, 'dist/browser/index.html'))) {
  throw new Error('Run npm run build:angular before npm run start:review')
}
console.log(`測試站：http://127.0.0.1:${port} （按 Ctrl+C 停止）`)
console.log('使用 data-dev/dialysis.db；本地密碼驗證；定時排程停用。')
const child = spawn(process.execPath, ['src/index.js'], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
  env: {
    ...process.env,
    // dotenv/config must not inherit the checkout's production .env.
    DOTENV_CONFIG_PATH: join(devRoot, '.env-unused'),
    NODE_ENV: 'test',
    DB_PATH: dbPath,
    BACKUP_DIR: join(devRoot, 'backups'),
    STATIC_PATH: join(root, 'dist/browser'),
    PORT: String(port),
    BIND_HOST: '127.0.0.1',
    JWT_SECRET: secrets.jwt,
    DASHBOARD_PIN_SECRET: secrets.pin,
    LOCAL_AUTH_BYPASS: '1',
    DISABLE_SCHEDULER: '1',
    SMOKE_RUN_ID: '',
    ALLOWED_ORIGINS: `http://127.0.0.1:${port},http://localhost:${port}`,
  },
})
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { if (!child.killed) child.kill(signal) })
}
child.on('error', error => { console.error(error.message); process.exitCode = 1 })
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGINT' ? 0 : 1) })
