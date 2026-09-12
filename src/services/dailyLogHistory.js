import { randomUUID } from 'node:crypto'
import { dailyLogVersion, preserveMovementMetadata } from './dailyLogVersion.js'
import { syncEventsToKiditLogbookSync } from './kiditSync.js'

export const DAILY_LOG_FIELDS = {
  patientMovements: 'patient_movements', vascularAccessLog: 'vascular_access_log',
  announcements: 'announcements', stats: 'stats', leader: 'leader', notes: 'notes', otherNotes: 'other_notes',
}
const arrays = new Set(['patientMovements','vascularAccessLog','announcements'])
const textFields = new Set(['notes','otherNotes'])
export function revisionError(message, status = 400) { return Object.assign(new Error(message), {status}) }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]))
  return value
}
export function sameContent(a,b) { return JSON.stringify(stable(a)) === JSON.stringify(stable(b)) }
export function fieldValue(row,key) {
  const value = row?.[DAILY_LOG_FIELDS[key]]
  return textFields.has(key) ? value ?? null : JSON.parse(value || (arrays.has(key) ? '[]' : '{}'))
}
export function dailyLogNoOp(existing, body) {
  return existing && Object.keys(DAILY_LOG_FIELDS).every(key=>body[key]===undefined || sameContent(fieldValue(existing,key), textFields.has(key) ? (body[key]==null ? null : typeof body[key]==='string' ? body[key] : JSON.stringify(body[key])) : body[key]))
}
export function archiveDailyLogRevision(db, log, user, revisionReason='before_update') {
  const id = randomUUID()
  db.prepare(`INSERT INTO daily_log_revisions (id,daily_log_id,date,patient_movements,vascular_access_log,announcements,notes,other_notes,stats,leader,revision_reason,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,log.id,log.date,log.patient_movements||'[]',log.vascular_access_log||'[]',log.announcements||'[]',log.notes,log.other_notes,log.stats||'{}',log.leader||'{}',revisionReason,JSON.stringify({uid:user.id,name:user.name}))
  return id
}
export function revisionMetadata(row) {
  return {id:row.id,dailyLogId:row.daily_log_id,date:row.date,revisionReason:row.revision_reason,createdBy:JSON.parse(row.created_by||'{}'),createdAt:row.created_at}
}
export function revisionDetail(row,current) {
  const blocks = Object.keys(DAILY_LOG_FIELDS).map(key=>({key,current:fieldValue(current,key),historical:fieldValue(row,key),changed:!sameContent(fieldValue(current,key),fieldValue(row,key))}))
  const currentMap = new Map(fieldValue(current,'patientMovements').map(item=>[String(item.id),item]))
  const historicalMap = new Map(fieldValue(row,'patientMovements').map(item=>[String(item.id),item]))
  const movements = [...new Set([...currentMap.keys(),...historicalMap.keys()])].flatMap(id=>{
    const current = currentMap.get(id), historical = historicalMap.get(id)
    return sameContent(current,historical) ? [] : [{id,action:!current?'add':!historical?'remove':'replace',current:current||null,historical:historical||null}]
  })
  return {...revisionMetadata(row),...Object.fromEntries(Object.keys(DAILY_LOG_FIELDS).map(key=>[key,fieldValue(row,key)])),currentVersion:dailyLogVersion(current),diff:{blocks,movements}}
}
export function restoreDailyLogRevision(db,date,id,body,user) {
  return db.transaction(()=>{
    const current = db.prepare('SELECT * FROM daily_logs WHERE date=?').get(date)
    const historical = db.prepare('SELECT * FROM daily_log_revisions WHERE id=? AND date=?').get(id,date)
    if (!historical) throw revisionError('找不到指定版本',404)
    if (!current) throw revisionError('目前日誌不存在，請重新載入核對',409)
    if (body.expectedVersion !== dailyLogVersion(current)) throw revisionError('日誌已更新，請核對最新內容再復原',409)
    const blocks = body.blocks
    if (!Array.isArray(blocks) || !blocks.length || new Set(blocks).size!==blocks.length || blocks.some(key=>!Object.hasOwn(DAILY_LOG_FIELDS,key))) throw revisionError('請選擇有效且不重複的復原區塊')
    const values = Object.fromEntries(blocks.map(key=>[key,fieldValue(historical,key)]))
    const movementIds = body.movementIds || []
    if (blocks.includes('patientMovements')) {
      const differences = revisionDetail(historical,current).diff.movements
      if (!Array.isArray(movementIds) || !movementIds.length || new Set(movementIds.map(String)).size!==movementIds.length || movementIds.some(id=>!differences.some(diff=>diff.id===String(id)))) throw revisionError('病人動態需逐筆選擇有效的差異ID，未選動態保留現況')
      const merged = new Map(fieldValue(current,'patientMovements').map(item=>[String(item.id),item]))
      for (const id of movementIds.map(String)) {
        const difference = differences.find(diff=>diff.id===id)
        if (difference.historical) merged.set(id,difference.historical)
        else merged.delete(id)
      }
      const currentMetadata = new Map(fieldValue(current,'patientMovements').map(item=>[String(item.id),item]))
      values.patientMovements = preserveMovementMetadata([...merged.values()],fieldValue(current,'patientMovements')).map(item=>{
        const present=currentMetadata.get(String(item.id))
        return present && Object.hasOwn(present,'completedKiDit') ? {...item,completedKiDit:present.completedKiDit} : item
      })
    } else if (movementIds.length) throw revisionError('選擇動態ID時需同時選擇病人動態區塊')
    if (dailyLogNoOp(current,values)) return {success:true,noOp:true,version:dailyLogVersion(current),restoredBlocks:blocks,restoredMovementIds:movementIds}
    const beforeKidit = db.prepare('SELECT * FROM kidit_logbook WHERE id=?').get(date) || null
    const beforeRemoved = db.prepare('SELECT config_data FROM site_config WHERE id=?').get('kidit_removed_events_'+date)?.config_data || null
    const beforeRevisionId = archiveDailyLogRevision(db,current,user,'before_restore:'+id)
    const columns=blocks.map(key=>DAILY_LOG_FIELDS[key]+'=?')
    const params=blocks.map(key=>textFields.has(key)?values[key]:JSON.stringify(values[key]))
    db.prepare(`UPDATE daily_logs SET ${columns.join(',')}, updated_at=datetime('now','localtime') WHERE date=?`).run(...params,date)
    const saved=db.prepare('SELECT * FROM daily_logs WHERE date=?').get(date)
    if (blocks.includes('patientMovements') || blocks.includes('vascularAccessLog')) syncEventsToKiditLogbookSync(date,{patientMovements:fieldValue(saved,'patientMovements'),vascularAccessLog:fieldValue(saved,'vascularAccessLog'),createdAt:saved.created_at})
    const afterRevisionId = archiveDailyLogRevision(db,saved,user,'after_restore:'+id)
    db.prepare(`INSERT INTO audit_logs (id,action,user_id,user_name,collection_name,document_id,details,success,created_at) VALUES (?,?,?,?,?,?,?,1,datetime('now','localtime'))`).run(randomUUID(),'DAILY_LOG_RESTORE',user.id,user.name,'daily_logs',date,JSON.stringify({sourceRevisionId:id,beforeRevisionId,afterRevisionId,blocks,movementIds,beforeKidit,beforeRemoved,afterKidit:db.prepare('SELECT * FROM kidit_logbook WHERE id=?').get(date)||null}))
    return {success:true,version:dailyLogVersion(saved),restoredBlocks:blocks,restoredMovementIds:movementIds,beforeRevisionId,afterRevisionId}
  })()
}
