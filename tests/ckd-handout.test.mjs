// 門診 CKD：檢驗報告衛教單的內容組裝（純函式）。用語本身由使用者審定，這裡測的是「哪些項目會被列出、怎麼併、本次／前次怎麼取」。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildHandout, handoutReportDates, HANDOUT_ITEMS, STAGE_TEXT, HANDOUT_WINDOW_DAYS } from '../src/services/ckd/handout.js'
import { WIDE_LABS } from '../src/services/ckd/wide.js'

const d = (s) => new Date(s + 'T00:00:00')
const row = (date, vals, src = '生化') => ({ date: d(date), src, ...vals })

test('用語表涵蓋檢驗總表全部 21 項；分期六級都有說明', () => {
  for (const [key] of WIDE_LABS) assert.ok(HANDOUT_ITEMS[key] && HANDOUT_ITEMS[key].name, key)
  assert.deepEqual(Object.keys(STAGE_TEXT), ['G1', 'G2', 'G3a', 'G3b', 'G4', 'G5'])
})

test('報告日清單：新→舊、排除只有登錄簿值的列與沒有任何檢驗值的列', () => {
  const rows = [
    row('2026-03-01', { egfr: 40 }),
    row('2026-05-01', { egfr: 38 }, '追蹤表'),
    row('2026-06-01', { bp: '130/80' }),
    row('2026-07-20', { upcr: 233.5 }, '尿液'),
  ]
  assert.deepEqual(handoutReportDates(rows), ['2026-07-20', '2026-03-01'])
  assert.equal(buildHandout([], ''), null)
  assert.equal(buildHandout([row('2026-05-01', { egfr: 38 }, '追蹤表')], ''), null)
})

test('本次＝報告日往前 7 天內最近一次有值；前次＝再往前一次；預設取最近報告日', () => {
  assert.equal(HANDOUT_WINDOW_DAYS, 7)
  const rows = [
    row('2026-03-01', { egfr: 50.2, k: 4.1, hb: 11 }),
    row('2026-07-15', { egfr: 42.1, k: 4.8 }),                 // 血液單（報告日前 5 天）
    row('2026-07-20', { upcr: 233.5, upcr_f: 'H' }, '尿液'),    // 尿液單
  ]
  const h = buildHandout(rows, '')
  assert.equal(h.reportDate, '2026-07-20'); assert.equal(h.windowFrom, '2026-07-13')
  const by = Object.fromEntries(h.items.map((i) => [i.key, i]))
  assert.deepEqual([by.egfr.v, by.egfr.date, by.egfr.prev.v, by.egfr.prev.date], [42.1, '2026-07-15', 50.2, '2026-03-01'])
  assert.deepEqual([by.upcr.v, by.upcr.date, by.upcr.prev], [233.5, '2026-07-20', null])
  assert.ok(!by.hb, 'Hb 只有 3 月那次，超出 7 天視窗 → 不算本次')
  // 指定較早的報告日：看不到之後的報告
  const old = buildHandout(rows, '2026-03-01')
  assert.deepEqual(old.items.map((i) => i.key).sort(), ['egfr', 'hb', 'k'])
  assert.equal(old.items.find((i) => i.key === 'egfr').prev, null)
  // 不存在的報告日 → 回到最近報告日
  assert.equal(buildHandout(rows, '2020-01-01').reportDate, '2026-07-20')
})

test('異常來源：HIS 的 H／L 優先；沒有標記才套 9 條門檻；帶 <／> 的值不套門檻', () => {
  const h = buildHandout([row('2026-07-20', {
    k: 5.7,                       // 門檻 K ≥5.5 → 偏高
    hb: 9.2,                      // 門檻 Hb <10 → 偏低
    na: 128,                      // 門檻 Na <130 → 偏低
    phos: 6.1, phos_f: 'H',       // HIS 標 H
    ca: 8.0, ca_f: 'L',           // HIS 標 L（不在 9 條門檻內）
    upcr: 3500, upcr_q: '>',      // 帶 > → 不套門檻、也沒有 HIS 標記 → 不列
    alb: 4.2,                     // 正常
  })], '')
  const by = Object.fromEntries(h.items.map((i) => [i.key, [i.dir, i.by]]))
  assert.deepEqual(by.k, ['H', 'rule']); assert.deepEqual(by.hb, ['L', 'rule']); assert.deepEqual(by.na, ['L', 'rule'])
  assert.deepEqual(by.phos, ['H', 'his']); assert.deepEqual(by.ca, ['L', 'his'])
  assert.deepEqual(by.upcr, ['', '']); assert.deepEqual(by.alb, ['', ''])
  assert.deepEqual(h.cautions.map((c) => [c.title, c.dir]), [
    ['血色素（貧血指標）', 'L'], ['鈉', 'L'], ['鉀', 'H'], ['鈣', 'L'], ['磷', 'H'],
  ])
  assert.ok(h.cautions.find((c) => c.title === '鉀').text.includes('血鉀偏高可能影響心跳'))
  assert.ok(!JSON.stringify(h).includes('危急'), '紙本不標危急字樣')
  // Na >150 → 偏高
  assert.equal(buildHandout([row('2026-07-20', { na: 152 })], '').items[0].dir, 'H')
})

test('不列的方向不進注意事項（但表格仍標示）；同一句話只講一次；UPCR＋UACR 併成一段', () => {
  const h = buildHandout([row('2026-07-20', {
    hb: 18, hb_f: 'H',            // Hb 偏高：草案不列
    cr: 0.4, cr_f: 'L',           // Cr 偏低：不列
    a1c: 9.5, a1c_f: 'H', glu: 210, glu_f: 'H',   // 有 HbA1c → 血糖那段不重複
    ldl: 160, ldl_f: 'H', chol: 260, chol_f: 'H', // 有 LDL → 總膽固醇那段不重複
    upcr: 900, upcr_f: 'H', uacr: 600, uacr_f: 'H',
  })], '')
  assert.equal(h.items.find((i) => i.key === 'hb').dir, 'H')
  assert.deepEqual(h.cautions.map((c) => c.title), ['尿蛋白', '糖化血色素（近三個月血糖平均）', '低密度膽固醇（壞膽固醇）'])
  assert.deepEqual(h.cautions[0].keys, ['upcr', 'uacr'])
  // 血糖偏低一律列
  assert.deepEqual(buildHandout([row('2026-07-20', { a1c: 9.5, a1c_f: 'H', glu: 55, glu_f: 'L' })], '').cautions.map((c) => [c.title, c.dir]), [['糖化血色素（近三個月血糖平均）', 'H'], ['血糖', 'L']])
})

test('使用者 2026-09-21 裁定：HbA1c ≥7 才列（不看 HIS 的 H）、血糖只看偏低；表格標示與注意事項一致', () => {
  const one = (vals) => buildHandout([row('2026-07-20', vals)], '')
  const a1c = (h) => h.items.find((i) => i.key === 'a1c')
  // HIS 標 H 但 <7 → 不標、不列
  for (const v of [5.8, 6.4, 6.9]) {
    const h = one({ a1c: v, a1c_f: 'H' })
    assert.deepEqual([a1c(h).dir, a1c(h).by], ['', ''], String(v)); assert.deepEqual(h.cautions, [], String(v))
  }
  // ≥7 → 列，不管 HIS 有沒有標
  for (const vals of [{ a1c: 7 }, { a1c: 7.0, a1c_f: 'H' }, { a1c: 8.3 }, { a1c: 14, a1c_q: '>' }]) {
    const h = one(vals)
    assert.deepEqual([a1c(h).dir, a1c(h).by], ['H', 'rule'], JSON.stringify(vals))
    assert.deepEqual(h.cautions.map((c) => c.title), ['糖化血色素（近三個月血糖平均）'])
  }
  assert.equal(a1c(one({ a1c: 7.5, a1c_q: '<' })).dir, '', '帶 < 的值不算 ≥7')
  // 血糖偏高：再高、HIS 有標 H 都不標不列；偏低照列
  for (const vals of [{ glu: 130, glu_f: 'H' }, { glu: 320, glu_f: 'H' }, { glu: 400 }]) {
    const h = one(vals)
    assert.equal(h.items.find((i) => i.key === 'glu').dir, '', JSON.stringify(vals)); assert.deepEqual(h.cautions, [])
  }
  const low = one({ glu: 52, glu_f: 'L' })
  assert.deepEqual(low.cautions.map((c) => [c.title, c.dir]), [['血糖', 'L']])
  assert.ok(low.cautions[0].text.includes('低血糖'))
})

test('分期說明：依本次 eGFR；沒有 eGFR 就不寫', () => {
  const h = buildHandout([row('2026-07-20', { egfr: 42.13 })], '')
  assert.deepEqual([h.stage.code, h.stage.label, h.stage.egfr], ['G3b', '第 3b 期', 42.13])
  assert.equal(buildHandout([row('2026-07-20', { egfr: 12 })], '').stage.text, STAGE_TEXT.G5[1])
  assert.equal(buildHandout([row('2026-07-20', { k: 4.0 })], '').stage, null)
})
