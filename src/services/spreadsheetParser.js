import { Worker } from 'node:worker_threads'

const unavailable = message => Object.assign(new Error(message), { status: 503 })

/** One parser and at most two waiting uploads per process; never opens a DB connection. */
export function createSpreadsheetParser({
  workerUrl = new URL('./spreadsheetParserWorker.js', import.meta.url),
  maxQueued = 2,
  timeoutMs = 60_000,
  idleMs = 30_000,
} = {}) {
  let worker = null
  let active = null
  let stopping = false
  let closed = false
  let nextId = 0
  let idleTimer = null
  const queue = []

  function stopWorker(error) {
    const previous = worker
    if (!previous || stopping) return
    stopping = true
    worker = null
    clearTimeout(idleTimer)
    if (active) {
      clearTimeout(active.timer)
      active.reject(error || unavailable('Excel 解析服務已停止，請重新上傳。'))
      active = null
    }
    // Start the next parser only after termination; a timed-out job cannot run beside it.
    previous.terminate().finally(() => {
      stopping = false
      pump()
    })
  }

  function pump() {
    if (closed || stopping || active) return
    clearTimeout(idleTimer)
    if (!queue.length) {
      worker?.unref()
      if (worker) {
        idleTimer = setTimeout(() => stopWorker(), idleMs)
        idleTimer.unref()
      }
      return
    }
    const job = queue.shift()
    active = job
    try {
      if (!worker) {
        const current = new Worker(workerUrl)
        worker = current
        current.on('message', message => {
          if (worker !== current || !active || message.id !== active.id) return
          const finished = active
          active = null
          clearTimeout(finished.timer)
          if (message.error) finished.reject(new Error(message.error))
          else finished.resolve(message.rows)
          pump()
        })
        current.on('error', () => {
          if (worker === current) stopWorker(unavailable('Excel 解析服務中斷，請重新上傳。'))
        })
        current.on('exit', () => {
          if (worker === current) stopWorker(unavailable('Excel 解析服務中斷，請重新上傳。'))
        })
      }
      worker.ref()
      job.timer = setTimeout(() => stopWorker(unavailable('Excel 解析逾時，請稍後重新上傳。')), timeoutMs)
      worker.postMessage({ id: job.id, bytes: job.bytes, options: job.options }, [job.bytes.buffer])
    } catch (error) {
      if (worker) stopWorker(unavailable('Excel 解析服務無法啟動，請重新上傳。'))
      else {
        active = null
        job.reject(error)
        pump()
      }
    }
  }

  return {
    parse(buffer, options = { header: 1 }) {
      if (closed) return Promise.reject(unavailable('Excel 解析服務已停止，請重新上傳。'))
      if ((active || stopping) && queue.length >= maxQueued) {
        return Promise.reject(unavailable('目前 Excel 匯入忙碌中，請稍後重新上傳。'))
      }
      // Copy only accepted jobs into transferable storage; never detach the caller's Buffer.
      return new Promise((resolve, reject) => {
        queue.push({ id: ++nextId, bytes: Uint8Array.from(buffer), options, resolve, reject })
        pump()
      })
    },
    close() {
      closed = true
      clearTimeout(idleTimer)
      for (const job of queue.splice(0)) job.reject(unavailable('Excel 解析服務已停止，請重新上傳。'))
      stopWorker()
    },
  }
}

const parser = createSpreadsheetParser()
export const parseFirstSheet = (buffer, options) => parser.parse(buffer, options)
