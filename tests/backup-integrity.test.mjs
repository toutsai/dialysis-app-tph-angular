import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { fork, spawnSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { writeFileSync, renameSync, mkdirSync, existsSync, symlinkSync, unlinkSync } from 'node:fs'
import { restoreToNewDirectory } from '../scripts/restore-backup.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const password = randomBytes(24).toString('base64url')
let folder, db, server, baseUrl, tokens, today
let serverOutput = ''
const events = []

before(async () => {
  folder = mkdtempSync(join(tmpdir(), 'dialysis-integrity-'))
  const dbPath = join(folder, 'synthetic.db')
  db = new Database(dbPath)
  db.exec(readFileSync(join(root, 'src/db/schema.sql'), 'utf8'))
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 5000')
  server = fork(join(root, 'tests/helpers/backend-test-server.mjs'), [], {
    execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, NODE_ENV: 'test', DB_PATH: dbPath, LOCAL_AUTH_BYPASS: '1', JWT_SECRET: randomBytes(48).toString('hex'), TEST_PASSWORD: password },
  })
  server.stdout.on('data', data => { serverOutput += data.toString() })
  server.stderr.on('data', data => { serverOutput += data.toString() })
  const ready = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Test server did not start:\n${serverOutput}`)), 30_000)
    server.on('message', message => {
      if (message.type === 'event') events.push(message)
      if (message.type === 'ready') { clearTimeout(timeout); resolve(message) }
    })
    server.once('error', reject)
    server.once('exit', code => { clearTimeout(timeout); reject(new Error(`Test server exited ${code}:\n${serverOutput}`)) })
  })
  tokens = ready.tokens
  today = ready.today
  baseUrl = `http://127.0.0.1:${ready.port}`
})

after(async () => {
  if (server && server.exitCode === null) {
    await new Promise(resolve => {
      const timeout = setTimeout(() => server.kill(), 5_000)
      server.once('exit', () => { clearTimeout(timeout); resolve() })
      server.send({ type: 'shutdown' })
    })
  }
  db?.close()
  if (folder) {
    const location = relative(tmpdir(), folder)
    assert(location && !location.startsWith('..') && !isAbsolute(location))
    rmSync(folder, { recursive: true, force: true })
  }
})

async function api(method, path, body, token = tokens.admin) {
  const response = await fetch(`${baseUrl}${path}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: response.status, data: await response.json() }
}

let firstSuccess;
test('same-second concurrent backups are unique, bounded and verified before success',async()=>{
  const responses=await Promise.all(Array.from({length:6},()=>api('POST','/api/system/backup',{})));
  const successes=responses.filter(response=>response.status===200);
  assert(successes.length>=1 && successes.length<=3);
  assert(responses.some(response=>response.status===503));
  assert.equal(new Set(successes.map(response=>response.data.backupFile)).size,successes.length);
  const health=await api('GET','/api/system/backup-health');
  assert.equal(health.status,200);assert.equal(health.data.verification.result,'ok');
  assert(health.data.lastSuccess.verifiedAt);assert(health.data.lastSuccess.sizeBytes>0);
  assert.equal(health.data.backups.availableCount,successes.length);
  firstSuccess=health.data.lastSuccess;
});

test('backup health is admin-only and failed attempt cannot replace last success',async()=>{
  for(const token of [tokens.editor,tokens.contributor,tokens.viewer]) assert.equal((await api('GET','/api/system/backup-health',undefined,token)).status,403);
  const backupDir=join(folder,'backups'),saved=join(folder,'saved-backups');
  renameSync(backupDir,saved);writeFileSync(backupDir,'not a directory');
  try {
    assert.equal((await api('POST','/api/system/backup',{})).status,500);
    const health=await api('GET','/api/system/backup-health');
    assert.equal(health.data.lastSuccess.backupFile,firstSuccess.backupFile);
    assert(health.data.lastFailure.message);
    assert.equal(health.data.backups.directoryAvailable,false);
  } finally {rmSync(backupDir);renameSync(saved,backupDir);}
});

test('health detects corrupt and missing copies, old unsafe retention records stay',async()=>{
  const newest=join(folder,'backups',firstSuccess.backupFile);
  const contents=readFileSync(newest);writeFileSync(newest,'corrupt backup');
  assert.equal((await api('GET','/api/system/backup-health')).data.verification.result,'failed');
  rmSync(newest);
  const missing=await api('GET','/api/system/backup-health');
  assert.equal(missing.data.verification.result,'missing');assert(missing.data.backups.missingCount>0);
  writeFileSync(newest,contents);
  db.prepare('INSERT INTO backup_history (id,backup_file,backup_type,file_size,created_at) VALUES (?,?,?,?,?)').run('traversal','../outside.db','manual',1,'1970-01-01');
  for(let i=0;i<12;i++) db.prepare('INSERT INTO backup_history (id,backup_file,backup_type,file_size,created_at) VALUES (?,?,?,?,?)').run('missing'+i,'missing'+i+'.db','manual',1,'1970-01-01');
  assert.equal((await api('POST','/api/system/backup',{})).status,200);
  assert(db.prepare("SELECT id FROM backup_history WHERE id='traversal'").get());
  const listing=(await api('GET','/api/system/backups')).data;
  assert.equal(listing.find(row=>row.id==='traversal').pathSafe,false);
});

test('offline restore reads committed WAL, refuses existing destination and corrupt sources',async()=>{
  const sourcePath=join(folder,'wal-source.db');const source=new Database(sourcePath);
  source.pragma('journal_mode=WAL');source.pragma('wal_autocheckpoint=0');
  source.exec("CREATE TABLE example (value TEXT); INSERT INTO example VALUES ('in WAL')");
  const destination=join(folder,'restored');
  try {
    assert(existsSync(sourcePath+'-wal'));
    const result=await restoreToNewDirectory(sourcePath,destination);
    assert.equal(result.quickCheck,'ok');
    const copy=new Database(result.destination,{readonly:true});
    try {assert.equal(copy.prepare('SELECT value FROM example').get().value,'in WAL')}finally{copy.close()}
    await assert.rejects(restoreToNewDirectory(sourcePath,destination),/已存在/);
    const corrupt=join(folder,'bad.db');writeFileSync(corrupt,'not sqlite');
    const badTarget=join(folder,'bad-target');await assert.rejects(restoreToNewDirectory(corrupt,badTarget));assert.equal(existsSync(badTarget),false);
    await assert.rejects(restoreToNewDirectory(join(folder,'missing.db'),join(folder,'missing-target')));
  } finally {source.close()}
});


test('retention keeps 10 manual; linked backup entries are never deleted',async()=>{
  const backupDir=join(folder,'backups');
  // Use synthetic regular files; only oldest excess files are eligible for removal.
  for(const [type,count] of [['manual',12]]) {
    for(let i=0;i<count;i++) {
      const name=`retention-${type}-${i}.db`;writeFileSync(join(backupDir,name),'test');
      db.prepare('INSERT INTO backup_history (id,backup_file,backup_type,file_size,created_at) VALUES (?,?,?,?,?)').run(name,name,type,4,'2000-01-01');
    }
  }
  const linked=join(backupDir,'linked.db'),target=join(folder,'keep-target');mkdirSync(target);writeFileSync(join(target,'sentinel'),'keep');
  symlinkSync(target,linked,'junction');
  db.prepare('INSERT INTO backup_history (id,backup_file,backup_type,file_size,created_at) VALUES (?,?,?,?,?)').run('linked','linked.db','manual',1,'1960-01-01');
  assert.equal((await api('POST','/api/system/backup',{})).status,200);
  assert.equal((await api('GET','/api/system/backups')).data.find(row=>row.id==='linked').pathSafe,false);
  assert.equal(readFileSync(join(target,'sentinel'),'utf8'),'keep');
  assert(db.prepare("SELECT id FROM backup_history WHERE id='linked'").get());
  // Invalid/missing records intentionally remain outside the removable safe set.
  const manual=db.prepare("SELECT * FROM backup_history WHERE backup_type='manual'").all().filter(row=>!row.id.startsWith('missing')&&!['linked','traversal'].includes(row.id));
  assert.equal(manual.length,10);
  unlinkSync(linked);
});


test('automatic retention retains exactly 30 safe backups; legacy in-place restore is disabled',async()=>{
  const backupDir=join(folder,'backups');
  for(let i=0;i<32;i++) {
    const name=`auto-policy-${i}.db`;writeFileSync(join(backupDir,name),'synthetic');
    db.prepare('INSERT INTO backup_history (id,backup_file,backup_type,file_size,created_at) VALUES (?,?,?,?,?)').run(name,name,'auto',9,'2000-01-01');
  }
  const script="const {initDatabase,closeDatabase}=await import('./src/db/init.js');initDatabase();const {cleanupOldBackups,restoreBackup}=await import('./src/utils/backup.js');cleanupOldBackups('auto');let rejected=false;try{await restoreBackup('anything')}catch{rejected=true}closeDatabase();if(!rejected)process.exitCode=1";
  const result=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:root,encoding:'utf8',windowsHide:true,env:{...process.env,NODE_ENV:'test',DB_PATH:join(folder,'synthetic.db'),BACKUP_DIR:backupDir}});
  assert.equal(result.status,0,result.stderr);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM backup_history WHERE backup_type='auto'").get().n,30);
});


test('newest missing and unsafe records do not consume the ten valid manual copy slots',async()=>{
  for(let i=0;i<12;i++) {
    db.prepare('INSERT INTO backup_history (id,backup_file,backup_type,file_size,created_at) VALUES (?,?,?,?,?)').run('newest-missing-'+i,'newest-missing-'+i+'.db','manual',0,'2099-01-01');
    db.prepare('INSERT INTO backup_history (id,backup_file,backup_type,file_size,created_at) VALUES (?,?,?,?,?)').run('newest-unsafe-'+i,'../outside-'+i+'.db','manual',0,'2099-01-01');
  }
  assert.equal((await api('POST','/api/system/backup',{})).status,200);
  const rows=db.prepare("SELECT backup_file FROM backup_history WHERE backup_type='manual'").all();
  assert.equal(rows.filter(row=>!row.backup_file.includes('/') && existsSync(join(folder,'backups',row.backup_file))).length,10);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM backup_history WHERE id LIKE 'newest-%'").get().n,24);
});
