import { Worker } from 'node:worker_threads'
export function verifyBackupFile(path) {
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./backupVerificationWorker.js',import.meta.url),{workerData:{path}})
    const timer=setTimeout(()=>{worker.terminate();reject(new Error('備份驗證逾時'))},30000)
    const finish=(error)=>{clearTimeout(timer);worker.terminate();error?reject(error):resolve({result:'ok',checkedAt:new Date().toLocaleString('sv-SE')})}
    worker.once('message',message=>finish(message.ok?null:new Error(message.message)))
    worker.once('error',finish)
    worker.once('exit',code=>{if(code!==0)finish(new Error('備份驗證程序中斷'))})
  })
}
