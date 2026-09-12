import { parentPort, workerData } from 'node:worker_threads'
import Database from 'better-sqlite3'
let db
try {
  db = new Database(workerData.path, {readonly:true,fileMustExist:true})
  const result = db.pragma('quick_check')
  if (result.length !== 1 || result[0].quick_check !== 'ok') throw new Error('SQLite quick_check failed')
  db.prepare('SELECT name FROM sqlite_master LIMIT 1').get()
  parentPort.postMessage({ok:true})
} catch(error) { parentPort.postMessage({ok:false,message:error.message}) }
finally {db?.close()}
