// Offline recovery creates a new destination; it never overwrites the application's database.
import Database from 'better-sqlite3'
import { lstatSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
export async function restoreToNewDirectory(source,targetDirectory){
  const sourcePath=resolve(source),target=resolve(targetDirectory)
  if(existsSync(target))throw new Error('目的目錄已存在；請指定全新目錄')
  const info=lstatSync(sourcePath)
  if(!info.isFile()||info.isSymbolicLink())throw new Error('來源必須是一般 SQLite 檔案，不可為連結')
  let input,output
  try {
    input=new Database(sourcePath,{readonly:true,fileMustExist:true})
    if(input.pragma('quick_check',{simple:true})!=='ok')throw new Error('來源 SQLite 驗證失敗')
    mkdirSync(target) // Atomic exclusive directory creation; existing target races fail.
    const destination=join(target,'dialysis.db')
    await input.backup(destination) // SQLite reads committed WAL contents too.
    output=new Database(destination,{readonly:true,fileMustExist:true})
    if(output.pragma('quick_check',{simple:true})!=='ok')throw new Error('還原副本驗證失敗')
    const tableCount=output.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get().n
    return {destination,quickCheck:'ok',tableCount}
  } finally {output?.close();input?.close()}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const args=process.argv.slice(2);const source=args[args.indexOf('--source')+1],target=args[args.indexOf('--target-dir')+1]
  if(!args.includes('--source')||!args.includes('--target-dir')||!source||!target){console.error('使用方式：node scripts/restore-backup.mjs --source <SQLite檔案> --target-dir <全新目錄>');process.exitCode=1}
  else try{console.log(JSON.stringify(await restoreToNewDirectory(source,target)))}catch(error){console.error(error.message);process.exitCode=1}
}
