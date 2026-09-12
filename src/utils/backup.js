// Online backup uses the application's singleton; isolated verification owns only a read-only copy.
import { mkdirSync, existsSync, statSync, lstatSync, realpathSync, unlinkSync, openSync, closeSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve, basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import { getDatabase, initDatabase } from '../db/init.js'
import { verifyBackupFile } from '../services/backupVerification.js'
const moduleDir=dirname(fileURLToPath(import.meta.url))
const DB_PATH=resolve(process.env.DB_PATH || join(moduleDir,'../../data/dialysis.db'))
const BACKUP_DIR=resolve(process.env.BACKUP_DIR || join(dirname(DB_PATH),'backups'))
let active=false,waiting=0,tail=Promise.resolve()
const at=()=>new Date().toLocaleString('sv-SE')
function readStatus(){const row=getDatabase().prepare("SELECT status_data FROM backup_status WHERE id='latest'").get();return row?JSON.parse(row.status_data):{}}
function updateStatus(patch){const db=getDatabase();db.prepare("INSERT INTO backup_status (id,status_data,updated_at) VALUES ('latest',?,datetime('now','localtime')) ON CONFLICT(id) DO UPDATE SET status_data=excluded.status_data,updated_at=excluded.updated_at").run(JSON.stringify({...readStatus(),...patch}))}
function directorySafe(){return existsSync(BACKUP_DIR) && lstatSync(BACKUP_DIR).isDirectory() && !lstatSync(BACKUP_DIR).isSymbolicLink()}
export function backupFileState(file){
  if(typeof file!=='string'||!file||basename(file)!==file||file.includes('\\')||file.includes('/')||file==='.'||file==='..'||!directorySafe())return {pathSafe:false,fileExists:false,path:null}
  const path=resolve(BACKUP_DIR,file)
  if(dirname(path)!==BACKUP_DIR)return {pathSafe:false,fileExists:false,path:null}
  try {
    const stat=lstatSync(path)
    if(stat.isSymbolicLink()||!stat.isFile()||dirname(realpathSync(path))!==realpathSync(BACKUP_DIR))return {pathSafe:false,fileExists:false,path:null}
    return {pathSafe:true,fileExists:true,path,sizeBytes:stat.size}
  }catch(error){if(error.code==='ENOENT')return {pathSafe:true,fileExists:false,path};throw error}
}
export function listBackups(){return getDatabase().prepare('SELECT * FROM backup_history ORDER BY created_at DESC,rowid DESC').all().map(row=>{const state=backupFileState(row.backup_file);return {...row,fileExists:state.fileExists,pathSafe:state.pathSafe}})}
export function cleanupOldBackups(type){
  const db=getDatabase();const limit=type==='auto'?30:10
  const rows=db.prepare('SELECT * FROM backup_history WHERE backup_type=? ORDER BY created_at DESC,rowid DESC').all(type)
  const warnings=[]
  let validCopies=0
  for(const row of rows){
    const state=backupFileState(row.backup_file)
    if(!state.pathSafe||!state.fileExists){warnings.push({id:row.id,message:'備份路徑異常或檔案不存在，保留紀錄'});continue}
    validCopies++
    if(validCopies<=limit)continue
    try {unlinkSync(state.path);db.prepare('DELETE FROM backup_history WHERE id=?').run(row.id)}
    catch(error){warnings.push({id:row.id,message:error.message})}
  }
  return warnings
}
async function performBackup(type){
  const attempt={at:at(),type};updateStatus({lastAttempt:attempt})
  let backupFileName
  try {
    if(!existsSync(BACKUP_DIR))mkdirSync(BACKUP_DIR,{recursive:true})
    if(!directorySafe())throw new Error('備份目錄不可為連結或非目錄')
    backupFileName='dialysis_'+type+'_'+at().replaceAll(':','-').replace(' ','T')+'_'+randomUUID()+'.db'
    const backupPath=join(BACKUP_DIR,backupFileName)
    // Exclusive reservation ensures even an unexpected name collision cannot overwrite a file.
    const descriptor=openSync(backupPath,'wx');closeSync(descriptor)
    await getDatabase().backup(backupPath)
    const verification=await verifyBackupFile(backupPath)
    const sizeBytes=statSync(backupPath).size
    getDatabase().transaction(()=>{
      getDatabase().prepare("INSERT INTO backup_history (id,backup_file,backup_type,file_size,created_at) VALUES (?,?,?,?,datetime('now','localtime'))").run(randomUUID(),backupFileName,type,sizeBytes)
      updateStatus({lastSuccess:{...attempt,backupFile:backupFileName,sizeBytes,verifiedAt:verification.checkedAt},verification:{...verification,backupFile:backupFileName}})
    })()
    updateStatus({retentionWarnings:cleanupOldBackups(type)})
    return backupFileName
  }catch(error){updateStatus({lastFailure:{...attempt,backupFile:backupFileName||null,message:error.message},verification:{checkedAt:at(),result:'failed',backupFile:backupFileName||null}});throw error}
}
export function createBackup(type='auto'){
  if(!['auto','manual'].includes(type))return Promise.reject(Object.assign(new Error('備份類型不正確'),{status:400}))
  if(waiting+(active?1:0)>=3){const error=Object.assign(new Error('備份忙碌中，請稍後重試'),{status:503});updateStatus({lastAttempt:{at:at(),type},lastFailure:{at:at(),type,message:error.message}});return Promise.reject(error)}
  waiting++
  const request=tail.then(async()=>{waiting--;active=true;try{return await performBackup(type)}finally{active=false}})
  tail=request.catch(()=>{})
  return request
}
export async function getBackupHealth(){
  const status=readStatus();const rows=listBackups();const latest=status.lastSuccess?.backupFile || rows[0]?.backup_file
  let verification=status.verification||null
  if(latest){const state=backupFileState(latest);if(!state.pathSafe||!state.fileExists)verification={checkedAt:at(),result:state.pathSafe?'missing':'unsafe',backupFile:latest};else{try{verification={...await verifyBackupFile(state.path),backupFile:latest}}catch(error){verification={checkedAt:at(),result:'failed',backupFile:latest,message:error.message}}}updateStatus({verification})}
  const size=path=>{try{return statSync(path).size}catch{return null}}
  return {lastAttempt:status.lastAttempt||null,lastSuccess:status.lastSuccess||null,lastFailure:status.lastFailure||null,database:{sizeBytes:size(DB_PATH),walBytes:size(DB_PATH+'-wal')||0},backups:{directoryAvailable:directorySafe(),trackedCount:rows.length,availableCount:rows.filter(row=>row.fileExists).length,missingCount:rows.filter(row=>row.pathSafe&&!row.fileExists).length,unsafeCount:rows.filter(row=>!row.pathSafe).length,totalBytes:rows.filter(row=>row.fileExists).reduce((sum,row)=>sum+(backupFileState(row.backup_file).sizeBytes||0),0)},verification,queue:{active,waiting},retentionWarnings:status.retentionWarnings||[]}
}
export async function restoreBackup(){throw new Error('禁止覆蓋運行中的資料庫；請執行 node scripts/restore-backup.mjs --source <SQLite檔案> --target-dir <全新目錄>')}
export function scheduleAutoBackup(){
  const now=new Date();const night=new Date(now.getFullYear(),now.getMonth(),now.getDate()+1)
  const run=()=>createBackup('auto').catch(error=>console.error('自動備份失敗:',error.message))
  setTimeout(()=>{void run();setInterval(()=>{void run()},86400000)},night.getTime()-now.getTime())
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){initDatabase();createBackup('manual').then(()=>{console.log('手動備份完成');process.exit(0)}).catch(error=>{console.error('備份失敗:',error.message);process.exit(1)})}
