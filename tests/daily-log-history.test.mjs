import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import XLSX from '../src/utils/spreadsheet.js'

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
  db.exec('DROP TRIGGER daily_logs_content_revision; ALTER TABLE daily_logs DROP COLUMN revision')
  db.prepare('INSERT INTO daily_logs (id,date,notes,updated_at) VALUES (?,?,?,?)').run('legacy','2026-01-01','legacy-preserved','2026-01-01 09:00:00')
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

const date='2026-09-14';
const path='/api/nursing/daily-logs/'+date;
const movement={id:'first',patientId:'p',name:'Synthetic',type:'住院',remarks:'old'};
let oldId;
test('no-op content does not archive, change version or update timestamps',async()=>{
  db.prepare('INSERT INTO patients (id,name,medical_record_number) VALUES (?,?,?)').run('p','Synthetic','123');
  let result=await api('PUT',path,{version:'new',notes:'old',stats:{a:1,b:2},patientMovements:[movement]});
  assert.equal(result.status,200);
  const before=db.prepare('SELECT * FROM daily_logs WHERE date=?').get(date);
  result=await api('PUT',path,{version:result.data.version,notes:'old',stats:{b:2,a:1}});
  assert.equal(result.data.noOp,true);
  assert.deepEqual(db.prepare('SELECT * FROM daily_logs WHERE date=?').get(date),before);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM daily_log_revisions').get().n,0);
  assert.equal((await api('PUT',path,{version:result.data.version,notes:'new'})).status,200);
  oldId=db.prepare('SELECT id FROM daily_log_revisions WHERE date=?').get(date).id;
});

test('metadata pagination has no full content; exact detail is date-bound',async()=>{
  const listing=await api('GET',path+'/revisions?limit=1&offset=0');
  assert.equal(listing.status,200);assert.equal(listing.data.length,1);
  for(const field of ['notes','stats','patientMovements','vascularAccessLog']) assert.equal(Object.hasOwn(listing.data[0],field),false);
  assert.deepEqual((await api('GET',path+'/revisions?limit=1&offset=1')).data,[]);
  assert.equal((await api('GET',path+'/revisions?limit=1000')).status,400);
  const detail=await api('GET',path+'/revisions/'+oldId);
  assert.equal(detail.data.notes,'old');assert(detail.data.diff.blocks.find(x=>x.key==='notes').changed);
  assert.equal((await api('GET','/api/nursing/daily-logs/2026-09-13/revisions/'+oldId)).status,404);
});

test('selected block restore is version checked and does not roll back patient state or other fields',async()=>{
  const current=(await api('GET',path)).data;
  const restore=path+'/revisions/'+oldId+'/restore';
  assert.equal((await api('POST',restore,{expectedVersion:'stale',blocks:['notes']})).status,409);
  const result=await api('POST',restore,{expectedVersion:current.version,blocks:['notes']});
  assert.equal(result.status,200,JSON.stringify(result.data));
  assert.equal((await api('GET',path)).data.notes,'old');
  assert.notEqual(result.data.version,current.version);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_logs WHERE action=?').get('DAILY_LOG_RESTORE').n,1);
  assert.equal((await api('POST',restore,{expectedVersion:current.version,blocks:['notes']})).status,409);
  assert.equal((await api('POST',restore,{expectedVersion:result.data.version,blocks:['notes']})).data.noOp,true);
});

test('explicit movement selection preserves other automatic events and full KiDit forms; sync failure rolls back',async()=>{
  const eventId='move_'+date+'_first';
  let events=JSON.parse(db.prepare('SELECT events FROM kidit_logbook WHERE id=?').get(date).events);
  events=events.map(event=>event.id===eventId?{...event,isRegistered:true,kidit_profile:{name:'kept'},kidit_history:{selectedSystemicDiseases:[1]},kidit_vascular:{test:'kept'},transferOutHospital:'kept'}:event);
  db.prepare('UPDATE kidit_logbook SET events=? WHERE id=?').run(JSON.stringify(events),date);
  let current=(await api('GET',path)).data;
  assert.equal((await api('PUT',path,{version:current.version,patientMovements:[{...movement,remarks:'changed',completedKiDit:true},{id:'auto-new',patientId:'p',name:'Synthetic',type:'更改模式'}]})).status,200);
  current=(await api('GET',path)).data;
  const restore=path+'/revisions/'+oldId+'/restore';
  assert.equal((await api('POST',restore,{expectedVersion:current.version,blocks:['patientMovements']})).status,400);
  const before=db.prepare('SELECT * FROM daily_logs WHERE date=?').get(date);
  const snapshots=db.prepare('SELECT COUNT(*) AS n FROM daily_log_revisions').get().n;
  db.exec("CREATE TRIGGER fail_restore BEFORE UPDATE ON kidit_logbook BEGIN SELECT RAISE(ABORT,'injected'); END");
  assert.equal((await api('POST',restore,{expectedVersion:current.version,blocks:['patientMovements'],movementIds:['first']})).status,500);
  assert.deepEqual(db.prepare('SELECT * FROM daily_logs WHERE date=?').get(date),before);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM daily_log_revisions').get().n,snapshots);
  db.exec('DROP TRIGGER fail_restore');
  assert.equal((await api('POST',restore,{expectedVersion:current.version,blocks:['patientMovements'],movementIds:['first']})).status,200);
  const after=(await api('GET',path)).data.patientMovements;
  assert(after.some(x=>x.id==='auto-new'));assert.equal(after.find(x=>x.id==='first').remarks,'old');assert.equal(after.find(x=>x.id==='first').completedKiDit,true);
  const finalEvents=JSON.parse(db.prepare('SELECT events FROM kidit_logbook WHERE id=?').get(date).events);
  const event=finalEvents.find(x=>x.id===eventId);
  assert.equal(event.isRegistered,true);assert.deepEqual(event.kidit_profile,{name:'kept'});assert.deepEqual(event.kidit_history,{selectedSystemicDiseases:[1]});assert.deepEqual(event.kidit_vascular,{test:'kept'});assert.equal(event.transferOutHospital,'kept');
  assert(!finalEvents.some(x=>x.type==='更改模式'));
});

test('all SQL writers advance content revision on A-B-A; timestamp-only and exact no-op do not',async()=>{
  const before=(await api('GET',path)).data;
  const row=db.prepare('SELECT * FROM daily_logs WHERE date=?').get(date);
  db.prepare('UPDATE daily_logs SET notes=? WHERE date=?').run('B',date);
  db.prepare('UPDATE daily_logs SET notes=? WHERE date=?').run(row.notes,date);
  const after=(await api('GET',path)).data;
  assert.notEqual(after.version,before.version);
  assert.equal(db.prepare('SELECT revision FROM daily_logs WHERE date=?').get(date).revision,row.revision+2);
  db.prepare("UPDATE daily_logs SET notes=notes,updated_at='2026-09-14 13:00:00' WHERE date=?").run(date);
  assert.equal((await api('GET',path)).data.version,after.version);
});


test('old database upgrade preserves historical values and fresh schema has revision protection',()=>{
  const legacy=db.prepare("SELECT notes,updated_at,revision FROM daily_logs WHERE id='legacy'").get();
  assert.deepEqual(legacy,{notes:'legacy-preserved',updated_at:'2026-01-01 09:00:00',revision:0});
  const fresh=new Database(':memory:');
  try {
    fresh.exec(readFileSync(join(root,'src/db/schema.sql'),'utf8'));
    fresh.prepare('INSERT INTO daily_logs (id,date,notes) VALUES (?,?,?)').run('new','2026-09-14','A');
    fresh.exec("UPDATE daily_logs SET notes='B'");
    assert.equal(fresh.prepare('SELECT revision FROM daily_logs').get().revision,1);
    assert(fresh.prepare("SELECT name FROM sqlite_master WHERE name='backup_status'").get());
  } finally {fresh.close();}
});

test('restore authorization and no-op stale version remain enforced',async()=>{
  const restore=path+'/revisions/'+oldId+'/restore';
  const current=(await api('GET',path)).data;
  assert.equal((await api('POST',restore,{expectedVersion:current.version,blocks:['notes']},tokens.viewer)).status,403);
  assert.equal((await api('PUT',path,{version:'stale',notes:current.notes})).status,409);
  assert.equal((await api('POST',restore,{expectedVersion:current.version,blocks:['unknown']})).status,400);
});
