import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
process.env.DB_PATH = ':memory:'
process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'synthetic-nursing-save-test-only'
process.env.LOCAL_AUTH_BYPASS = '1'
const { initDatabase } = await import('../src/db/init.js')
const db = initDatabase()
const auth = await import('../src/middleware/auth.js')
const { default: express } = await import('express')
const { default: router } = await import('../src/routes/nursing.js')
const { addAutoMovementToDailyLog, removeAutoMovementFromDailyLog } = await import('../src/services/dailyLogMovementSync.js')
const { dailyLogVersion } = await import('../src/services/dailyLogVersion.js')
const app = express(); app.use(express.json()); app.use('/nursing', router)
const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
const base = `http://127.0.0.1:${server.address().port}`
const tokens = {}
for (const role of ['admin', 'editor', 'viewer']) {
  const user = { id: `test-${role}`, username: role, name: role, role, title: '管理員' }
  db.prepare('INSERT INTO users(id,username,password_hash,name,role,title) VALUES(?,?,?,?,?,?)').run(user.id, role, 'unused', role, role, user.title)
  tokens[role] = auth.generateToken(user)
  await auth.registerSession(user.id, tokens[role], { headers: {}, socket: { remoteAddress: '127.0.0.1' } })
}
async function api(method, path, body, role = 'admin') {
  const res = await fetch(base + '/nursing' + path, { method, headers: { Authorization: `Bearer ${tokens[role]}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: res.status, body: await res.json() }
}
const date = '2099-01-01'
const movement = { id: 'm1', patientId: 'p1', name: 'Synthetic', type: '新增', completedKiDit: true }
const events = () => JSON.parse(db.prepare('SELECT events FROM kidit_logbook WHERE date=?').get(date)?.events || '[]')
let checks = 0
try {
  assert.equal((await api('GET', `/daily-logs/${date}`)).body.version, 'new')
  const first = await api('PUT', `/daily-logs/${date}`, { patientMovements: [movement], notes: 'original' })
  assert.equal(first.status, 200); assert.ok(first.body.version); checks++
  const stale = (await api('GET', `/daily-logs/${date}`)).body
  addAutoMovementToDailyLog(db, date, { id: 'm2', patientId: 'p2', name: 'Concurrent', type: '轉住院' })
  const eventId = events().find(e => e.patientId === 'p2').id
  assert.equal((await api('PUT', `/kidit-logbook/${date}/events/${eventId}`, { isRegistered: true, kidit_history: { note: 'must survive' } })).status, 200)
  const rejected = await api('PUT', `/daily-logs/${date}`, { ...stale, notes: 'stale draft' })
  assert.equal(rejected.status, 409)
  assert.equal(events().find(e => e.id === eventId).kidit_history.note, 'must survive')
  assert.equal((await api('PUT', `/daily-logs/${date}`, { patientMovements: [] })).status, 409); checks++
  let current = (await api('GET', `/daily-logs/${date}`)).body
  const patched = await api('PUT', `/daily-logs/${date}`, { version: current.version, movementUpdates: [{ id: 'm1', remarks: 'edited' }] })
  assert.equal(patched.status, 200)
  current = (await api('GET', `/daily-logs/${date}`)).body
  assert.equal(current.patientMovements.length, 2)
  assert.equal(current.patientMovements[0].completedKiDit, true)
  assert.equal(current.patientMovements[0].id, 'm1')
  assert.equal(current.notes, 'original'); checks++
  const noMetadata = current.patientMovements.map(({ completedKiDit, ...row }) => row)
  assert.equal((await api('PUT', `/daily-logs/${date}`, { version: current.version, patientMovements: noMetadata })).status, 200)
  assert.equal((await api('GET', `/daily-logs/${date}`)).body.patientMovements[0].completedKiDit, true); checks++
  current = (await api('GET', `/daily-logs/${date}`)).body
  assert.equal((await api('PUT', `/daily-logs/${date}`, { version: current.version, patientMovements: [movement] })).status, 200)
  assert.ok(!events().some(e => e.id === eventId))
  const archive = (await api('GET', `/kidit-logbook/${date}/removed-events`)).body
  assert.equal(archive.find(entry => entry.event.id === eventId).event.kidit_history.note, 'must survive')
  assert.ok(db.prepare('SELECT COUNT(*) n FROM daily_log_revisions WHERE date=?').get(date).n > 0)
  addAutoMovementToDailyLog(db, date, { id: 'm2', patientId: 'p2', name: 'Concurrent', type: '轉住院' })
  assert.equal(events().find(e => e.id === eventId).kidit_history.note, 'must survive'); checks++
  assert.equal((await api('PUT', `/kidit-logbook/${date}/events/${eventId}`, { kidit_history: { note: 'NEWER CURRENT FORM' } })).status, 200)
  addAutoMovementToDailyLog(db, date, { id: 'm2', patientId: 'p2', name: 'Concurrent', type: '轉住院', remarks: 'resync active' })
  assert.equal(events().find(e => e.id === eventId).kidit_history.note, 'NEWER CURRENT FORM'); checks++
  const beforeRemove = (await api('GET', `/daily-logs/${date}`)).body.version
  removeAutoMovementFromDailyLog(db, date, 'm2')
  assert.notEqual((await api('GET', `/daily-logs/${date}`)).body.version, beforeRemove)
  const row = db.prepare('SELECT * FROM daily_logs WHERE date=?').get(date)
  for (const field of ['patient_movements','vascular_access_log','announcements','stats','leader','other_notes','notes']) {
    assert.notEqual(dailyLogVersion(row), dailyLogVersion({ ...row, [field]: 'changed' }), field)
  }; checks++
  const duties = { version: 'new', announcement: 'rules', dayShift: { codes: '7-3', tasks: 'day' }, shift128: { codes: '12-8', tasks: 'middle' }, nightShift: [{ code: '3-11', tasks: 'night' }], checklist: ['check'], teamwork: ['team'] }
  assert.equal((await api('PUT', '/duties', duties, 'viewer')).status, 403)
  assert.equal((await api('PUT', '/duties', duties, 'editor')).status, 403)
  assert.equal((await api('PUT', '/duties', { ...duties, shift128: null })).status, 400)
  duties.version = (await api('GET', '/duties')).body.version
  assert.equal((await api('PUT', '/duties', duties)).status, 200)
  const loaded = (await api('GET', '/duties')).body
  for (const key of ['announcement','dayShift','shift128','nightShift','checklist','teamwork']) assert.deepEqual(loaded[key], duties[key])
  assert.equal(loaded.lastModified.user, 'admin')
  assert.equal((await api('PUT', '/duties', duties)).status, 409); checks++

  // Execute the real TypeScript method bodies with controlled I/O and signals.
  // This catches draft/status and navigation timing bugs without mirroring them.
  const ts = createRequire(new URL('../angular-client/package.json', import.meta.url))('typescript')
  const signal = initial => { let v = initial; const fn = () => v; fn.set = value => { v = value }; return fn }
  const methods = (feature, names, globals = {}) => {
    const filename = new URL(`../angular-client/src/app/features/${feature}`, import.meta.url)
    const source = readFileSync(filename, 'utf8')
    const ast = ts.createSourceFile(filename.pathname, source, ts.ScriptTarget.ES2022, true)
    const cls = ast.statements.find(ts.isClassDeclaration)
    const members = names.map(name => {
      const node = cls.members.find(m => m.name?.getText(ast) === name)
      assert.ok(node, name)
      return node.getText(ast).replace(/@HostListener\([^\n]*\)\s*/g, '')
    })
    const code = ts.transpileModule(`class Subject { ${members.join('\n')} }; module.exports=Subject`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
    const module = { exports: {} }
    vm.runInNewContext(code, { module, console, Date, JSON, Map, Set, Object, setTimeout: () => 0, window: { confirm: () => false }, ...globals })
    return new module.exports()
  }
  const p = methods('daily-log/daily-log.component.ts', ['snapshot','hasPendingDraft','saveJustMovements','canLeave','onDateChange','beforeUnload','saveMovement'])
  Object.assign(p, { savedFields: ['patientMovements','otherNotes'], dailyLog: { id: date, version: 'v1', patientMovements: [{ id: 'm', name: 'draft' }], otherNotes: 'old' }, isLoading: signal(false), isPageLocked: false, selectedDate: signal(date), hasUnsavedChanges: signal(false), dailyLogCache: new Map(), showAlert() {} })
  p.loadedSnapshot = p.snapshot(); p.dailyLog.otherNotes = 'UNSAVED NOTES'
  p.dailyLogsApi = { save: async (_, body) => { assert.ok(!('otherNotes' in body)); return { version: 'v2' } } }
  assert.equal(await p.saveJustMovements(p.dailyLog.patientMovements[0]), true)
  assert.equal(p.hasUnsavedChanges(), true)
  assert.equal(p.canLeave(), false)
  p.onDateChange('2099-02-01'); assert.equal(p.selectedDate(), date)
  let prevented = false; p.beforeUnload({ preventDefault() { prevented = true } }); assert.equal(prevented, true); checks++
  p.dailyLog.patientMovements[0].isEdited = true
  p.dailyLogsApi.save = async () => { throw { error: { message: 'conflict' } } }
  await p.saveMovement(p.dailyLog.patientMovements[0])
  assert.equal(p.dailyLog.patientMovements[0].isEdited, true)
  assert.equal(p.dailyLog.otherNotes, 'UNSAVED NOTES')
  assert.equal(p.hasUnsavedChanges(), true); checks++
  let resolveSave
  const pending = new Promise(resolve => { resolveSave = resolve })
  p.dailyLogsApi.save = () => pending
  const inFlight = p.saveJustMovements(p.dailyLog.patientMovements[0])
  p.dailyLog.patientMovements[0].name = 'edit while saving'
  resolveSave({ version: 'v3' }); await inFlight
  assert.equal(p.hasPendingDraft(), true); checks++
  let savedDuties
  const n = methods('nursing-schedule/nursing-schedule.component.ts', ['loadData','saveData','canLeave','beforeUnload','reloadMonthlySchedule','confirmDiscardEditsForNav'], { firstValueFrom: value => value, confirm: () => false })
  Object.assign(n, { isLoadingDuties: signal(true), isSavingDuties: signal(false), isUploading: signal(false), hasChanges: signal(false), hasUnsavedShiftChanges: signal(false), isGroupEditMode: signal(false), auth: { isAdmin: () => true, currentUser: () => ({ name: 'admin' }) }, notificationService: { createGlobalNotification() {} }, exitEditMode() {}, api: { get: async () => savedDuties || { version: 'new' }, put: async (_, body) => { savedDuties = JSON.parse(JSON.stringify(body)); return { version: 'saved', lastModified: body.lastModified } } } })
  await n.loadData(); n.shift128Data.tasks = 'custom 128'; n.checklistItems = ['custom']; n.hasChanges.set(true)
  await n.saveData(); assert.equal(n.hasChanges(), false)
  await n.loadData(); assert.equal(n.shift128Data.tasks, 'custom 128'); assert.deepEqual([...n.checklistItems], ['custom'])
  n.hasChanges.set(true); n.api.put = async () => { throw new Error('offline') }; await n.saveData()
  assert.equal(n.hasChanges(), true); assert.equal(n.canLeave(), false); checks++
  let reloads = 0
  n.loadMonthlySchedule = () => { reloads++ }
  n.hasUnsavedShiftChanges.set(true); n.isShiftEditMode = () => true
  n.reloadMonthlySchedule(); assert.equal(reloads, 0); assert.equal(n.hasUnsavedShiftChanges(), true)
  const nursingHtml = readFileSync(new URL('../angular-client/src/app/features/nursing-schedule/nursing-schedule.component.html', import.meta.url), 'utf8')
  assert.ok(nursingHtml.includes('(click)="reloadMonthlySchedule()"'))
  assert.ok(!nursingHtml.includes('(click)="loadMonthlySchedule()"')); checks++
  console.log(`PASS nursing-save-integrity: ${checks} API/frontend scenarios`)
} finally {
  await new Promise(resolve => server.close(resolve))
}
