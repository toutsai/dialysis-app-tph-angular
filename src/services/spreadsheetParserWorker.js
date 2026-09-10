// Pure spreadsheet decoding. The database and application state stay on the main thread.
import { parentPort } from 'node:worker_threads'
import XLSX from '../utils/spreadsheet.js'

parentPort.on('message', ({ id, bytes, options }) => {
  try {
    const workbook = XLSX.read(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), { type: 'buffer' })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(sheet, options)
    parentPort.postMessage({ id, rows })
  } catch (error) {
    parentPort.postMessage({ id, error: error.message || 'Excel 解析失敗' })
  }
})
