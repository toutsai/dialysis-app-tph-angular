// 門診 CKD：解析子程序入口（獨立 node 程序，記憶體不計入 PM2 的 max_memory_restart）
// 用法：node --max-old-space-size=1024 parseChild.js <inputFile> <outputJson> [forcedKind]
// 輸出 JSON：{ kind, rows, extraLabs, aoaRows }；退出碼 0 成功 / 2 讀檔或解析失敗 / 3 認不出報表種類
import fs from 'node:fs'
import { toAoa, detectKind, parseByKind, KIND_LABEL } from './parsers.js'
import { toPayload } from './rows.js'

const [inPath, outPath, forcedKind] = process.argv.slice(2)

function fail(code, message) {
  process.stderr.write(JSON.stringify({ message }))
  process.exit(code)
}

try {
  const buf = fs.readFileSync(inPath)
  let aoa
  try { aoa = toAoa(buf) } catch (e) { fail(2, '不是可讀的試算表：' + e.message) }
  const kind = detectKind(aoa) || (forcedKind && KIND_LABEL[forcedKind] ? forcedKind : null)
  if (!kind) fail(3, '認不出報表種類（需為 追蹤清冊／CKD-病患清單查詢／0204 檢驗結果病患明細／醫令明細清單）')
  let parsed
  try { parsed = parseByKind(aoa, kind) } catch (e) { fail(2, '解析失敗：' + e.message) }
  const payload = toPayload(kind, parsed.rows)
  payload.aoaRows = aoa.length
  fs.writeFileSync(outPath, JSON.stringify(payload))
  process.exit(0)
} catch (e) {
  fail(2, e.message || String(e))
}
