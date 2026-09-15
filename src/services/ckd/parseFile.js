// 門診 CKD：在獨立子程序解析上傳檔（保護主程序：PM2 max_memory_restart 500M、0204 大檔解析要吃 GB 級 heap）
// 一次只跑一個子程序（序列化），逾時就殺掉。
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const CHILD = fileURLToPath(new URL('./parseChild.js', import.meta.url))

/** 網頁上傳上限（bytes）。0204 每日／每週匯出約 0.1～1MB；首次八個月 31MB 走 scripts/ckd-import.mjs */
export const UPLOAD_MAX_BYTES = 8 * 1024 * 1024
/** 子程序 heap 上限：8MB xlsx 約 20 萬列，實測 31MB/76 萬列吃 1.3GB → 按比例約 350MB，留餘裕 */
const CHILD_HEAP_MB = 1024
const TIMEOUT_MS = 180_000

let chain = Promise.resolve()

/**
 * @param {Buffer} buffer 上傳內容
 * @param {{ fileName?: string, forcedKind?: string }} opts
 * @returns {Promise<{ kind, rows, extraLabs, aoaRows }>}
 */
export function parseFileInChild(buffer, opts = {}) {
  const run = () => runChild(buffer, opts)
  const p = chain.then(run, run)
  chain = p.catch(() => {})
  return p
}

async function runChild(buffer, { fileName = 'upload', forcedKind = '' }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ckd-'))
  const ext = path.extname(fileName) || '.bin'
  const inPath = path.join(dir, 'in' + ext)
  const outPath = path.join(dir, 'out.json')
  try {
    await fs.writeFile(inPath, buffer)
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [`--max-old-space-size=${CHILD_HEAP_MB}`, CHILD, inPath, outPath, forcedKind || ''], {
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
      })
      let stderr = ''
      child.stderr.on('data', (d) => { stderr += d })
      const timer = setTimeout(() => { child.kill(); reject(status(504, '解析逾時（超過 3 分鐘），請縮短匯出區間或分檔')) }, TIMEOUT_MS)
      child.on('error', (e) => { clearTimeout(timer); reject(status(500, '無法啟動解析子程序：' + e.message)) })
      child.on('exit', (code) => {
        clearTimeout(timer)
        if (code === 0) return resolve()
        let msg = ''
        try { msg = JSON.parse(stderr).message } catch { msg = stderr.trim() }
        if (code === 3) return reject(status(422, msg || '認不出報表種類'))
        if (code === 2) return reject(status(422, msg || '解析失敗'))
        reject(status(500, msg || `解析子程序異常結束（code ${code}）；檔案可能太大，請縮短匯出區間`))
      })
    })
    void result
    const json = await fs.readFile(outPath, 'utf8')
    return JSON.parse(json)
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

function status(code, message) {
  const e = new Error(message)
  e.status = code
  return e
}
