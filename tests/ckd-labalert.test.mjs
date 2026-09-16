// 門診 CKD：近日異常檢驗（buildLabAlerts / loadAlertDone / setAlertDone）回歸測試（合成資料；規則照 labalert.js 逐字）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { makeCfg } from '../src/services/ckd/engine.js'
import { buildLabAlerts, ALERT_KEY_RE, loadAlertDone, setAlertDone } from '../src/services/ckd/labalert.js'

const d = (s) => new Date(s + 'T00:00:00')
const TODAY = '2026-09-16'
const C = makeCfg({}, TODAY)

const lab = (o) => ({ mrn: '1', name: '甲', date: null, spec: 'B', kind: '生化', no: '', v: {}, flag: {}, q: {}, src: 'lab', ...o })
const kase = (o) => ({ src: 'case', mrn: '1', visit: null, egfr: null, ...o })
const audr = (o) => ({ mrn: '1', p: { name: '甲' }, last: null, ...o })

test('單值規則：K≥6.0(crit)與Hb<10(warn)命中；定性符號(<,>)一律略過；done Map 反映在輸出', () => {
  const data = {
    labs: [lab({ mrn: '1', date: d('2026-09-10'), v: { k: 6.2, hb: 9.0, na: 155 }, q: { na: '>' } })],
    cases: [],
  }
  const R = { AUD: [audr({ mrn: '1' })], B: [] }
  const done = new Map([['1|2026-09-10|k6', { done: '2026-09-11', doneBy: { uid: 'u1', name: '甲' } }]])
  const hits = buildLabAlerts(data, R, C, done, {})
  assert.equal(hits.length, 2, '應為 k6 + hb10，na 因定性符號略過')
  const byId = Object.fromEntries(hits.map((h) => [h.id, h]))
  assert.equal(byId.k6.sev, 'crit'); assert.equal(byId.k6.m, 'K 6.2 mmol/L,請立即通知醫師並聯絡病人')
  assert.equal(byId.hb10.sev, 'warn'); assert.ok(!byId.na, '定性符號略過,不出現 na 規則')
  assert.equal(byId.k6.done, '2026-09-11'); assert.deepEqual(byId.k6.doneBy, { uid: 'u1', name: '甲' })
  assert.equal(byId.hb10.done, null, '未標記者 done 為 null')
  assert.equal(ALERT_KEY_RE.test('1|2026-09-10|k6'), true)
  assert.equal(ALERT_KEY_RE.test('壞key'), false)
})

test('eGFR 變化：急降≥25%(且降幅≥5)→crit；15~25%且≤120天→warn；彼此互斥(if/else if)', () => {
  const data1 = {
    cases: [kase({ mrn: '2', visit: d('2026-06-01'), egfr: 40 })],
    labs: [lab({ mrn: '2', date: d('2026-09-10'), v: { egfr: 25 } })],
  }
  const hits1 = buildLabAlerts(data1, { AUD: [audr({ mrn: '2' })], B: [] }, C, new Map(), {})
  const drop = hits1.find((h) => h.id === 'egfrdrop')
  assert.ok(drop, '40→25 降 37.5% 應觸發急降'); assert.equal(drop.sev, 'crit')
  assert.match(drop.m, /eGFR 40\.0 → 25\.0/)

  const data2 = {
    cases: [kase({ mrn: '3', visit: d('2026-07-01'), egfr: 40 })],
    labs: [lab({ mrn: '3', date: d('2026-09-10'), v: { egfr: 32 } })],
  }
  const hits2 = buildLabAlerts(data2, { AUD: [audr({ mrn: '3' })], B: [] }, C, new Map(), {})
  const fast = hits2.find((h) => h.id === 'egfrfast')
  assert.ok(fast, '40→32 降 20%、71 天內 應觸發下降警示'); assert.equal(fast.sev, 'warn')
  assert.ok(!hits2.some((h) => h.id === 'egfrdrop'), '未達 25% 不觸發急降')
})

test('首次 eGFR<15(Stage5,crit) 與 <20(warn)：需先前值不低於門檻；久遠舊值(逾400天)不干擾降幅規則', () => {
  const data1 = {
    cases: [kase({ mrn: '4', visit: d('2024-01-01'), egfr: 25 })],
    labs: [lab({ mrn: '4', date: d('2026-09-10'), v: { egfr: 12 } })],
  }
  const hits1 = buildLabAlerts(data1, { AUD: [audr({ mrn: '4' })], B: [] }, C, new Map(), {})
  assert.ok(hits1.some((h) => h.id === 'stage5' && h.sev === 'crit'))
  assert.ok(!hits1.some((h) => h.id === 'egfrdrop' || h.id === 'egfrfast'), '舊值超出 30~400 天窗,不觸發降幅規則')

  const data2 = {
    cases: [kase({ mrn: '5', visit: d('2024-01-01'), egfr: 22 })],
    labs: [lab({ mrn: '5', date: d('2026-09-10'), v: { egfr: 18 } })],
  }
  const hits2 = buildLabAlerts(data2, { AUD: [audr({ mrn: '5' })], B: [] }, C, new Map(), {})
  assert.ok(hits2.some((h) => h.id === 'egfr20' && h.sev === 'warn'))
  assert.ok(!hits2.some((h) => h.id === 'stage5'))
})

test('蛋白尿惡化：UPCR 較前次升≥50% 且絕對值升≥500 且 ≥1000 三條件同時成立才觸發', () => {
  const hit = buildLabAlerts({ cases: [], labs: [
    lab({ mrn: '6', date: d('2026-08-01'), v: { upcr: 500 } }),
    lab({ mrn: '6', date: d('2026-09-10'), v: { upcr: 1000 } }),
  ] }, { AUD: [audr({ mrn: '6' })], B: [] }, C, new Map(), {})
  assert.ok(hit.some((h) => h.id === 'upcrup'), '500→1000 三條件皆滿足')
  const miss = buildLabAlerts({ cases: [], labs: [
    lab({ mrn: '7', date: d('2026-08-01'), v: { upcr: 600 } }),
    lab({ mrn: '7', date: d('2026-09-10'), v: { upcr: 1000 } }),
  ] }, { AUD: [audr({ mrn: '7' })], B: [] }, C, new Map(), {})
  assert.ok(!miss.some((h) => h.id === 'upcrup'), '600→1000 漲幅達 67%≥50% 但差值僅 400<500,不觸發')
})

test('去重：同人同規則只留近日內最新一筆；排序：crit 優先→同級距日期新到舊→病歷號字典序', () => {
  const dedupe = buildLabAlerts({ cases: [], labs: [
    lab({ mrn: '8', date: d('2026-09-05'), v: { k: 5.6 } }),
    lab({ mrn: '8', date: d('2026-09-12'), v: { k: 5.7 } }),
  ] }, { AUD: [audr({ mrn: '8' })], B: [] }, C, new Map(), {})
  const k55hits = dedupe.filter((h) => h.id === 'k55')
  assert.equal(k55hits.length, 1, '同人同規則僅留一筆'); assert.equal(k55hits[0].v, 5.7, '只留最新一筆')

  const data = {
    cases: [], labs: [
      lab({ mrn: '5', date: d('2026-09-05'), v: { k: 5.6 } }),   // warn
      lab({ mrn: '2', date: d('2026-09-02'), v: { k: 6.5 } }),   // crit（在 14 天窗邊界內：since = 09-02）
      lab({ mrn: '3', date: d('2026-09-10'), v: { k: 7.0 } }),   // crit(同日)
      lab({ mrn: '4', date: d('2026-09-10'), v: { k: 6.8 } }),   // crit(同日)
    ],
  }
  const hits = buildLabAlerts(data, { AUD: ['5', '2', '3', '4'].map((mrn) => audr({ mrn })), B: [] }, C, new Map(), {})
  assert.deepEqual(hits.map((h) => h.mrn), ['3', '4', '2', '5'], 'crit(日期新→舊,同日病歷號小到大)在前,warn在後')
})

test('已處理狀態（DB）：壞 key 丟 400；done=true 寫入 done_at/done_by；done=false 刪除該列', () => {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE ckd_alert_done (
    key TEXT PRIMARY KEY,
    mrn TEXT NOT NULL,
    report_date TEXT NOT NULL,
    rule_id TEXT NOT NULL,
    done_at TEXT NOT NULL,
    done_by TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`)
  assert.throws(() => setAlertDone(db, '不合法key', true, { uid: 'u1' }), (e) => e.status === 400)
  const key = '1|2026-09-10|k6'
  const r = setAlertDone(db, key, true, { uid: 'u1', name: '個管師' })
  assert.ok(r.done); assert.deepEqual(r.doneBy, { uid: 'u1', name: '個管師' })
  let map = loadAlertDone(db)
  assert.ok(map.get(key).done); assert.deepEqual(map.get(key).doneBy, { uid: 'u1', name: '個管師' })
  const r2 = setAlertDone(db, key, false)
  assert.equal(r2.done, null)
  map = loadAlertDone(db)
  assert.equal(map.has(key), false, 'done=false 應刪除該列')
})
