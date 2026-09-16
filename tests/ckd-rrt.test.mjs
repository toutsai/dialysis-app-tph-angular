// 門診 CKD：透析準備管線（buildRrt）回歸測試（合成資料；規則照 rrt.js 逐字）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildRrt } from '../src/services/ckd/rrt.js'

const audr = (o) => ({ mrn: '1', egfr: null, ...o })
const sdmRec = (o) => ({ id: 's' + Math.random(), type: 'sdm', mrn: '1', at: '2026-09-01', leaning: '', decided: '', followUp: '', deleted: false, created: '2026-09-01 00:00:00', ...o })
const accRec = (o) => ({ id: 'a' + Math.random(), type: 'access', mrn: '1', status: '', planDate: '', matureDate: '', createDate: '', deleted: false, created: '2026-09-01 00:00:00', ...o })

test('母體：eGFR 嚴格 < 門檻；有 sdm/access 紀錄但未收案(不在 AUD)者不進；已刪除紀錄不進；egfr 恰等於門檻不進', () => {
  const AUD = [audr({ mrn: '1', egfr: 19.9 }), audr({ mrn: '9', egfr: 20 }), audr({ mrn: '10', egfr: 25 })]
  const records = [
    sdmRec({ mrn: '8', leaning: '血液透析 HD', decided: '是,已決定' }),                              // mrn8 不在 AUD(未收案)
    sdmRec({ mrn: '10', deleted: true, leaning: '血液透析 HD', decided: '是,已決定' }),                // 已刪除
  ]
  const { rows } = buildRrt({ records }, { AUD }, {}, 20)
  const mrns = rows.map((r) => r.mrn)
  assert.ok(mrns.includes('1'), 'eGFR 19.9 < 20 進母體')
  assert.ok(!mrns.includes('9'), 'eGFR 恰等於 20 不算嚴格小於')
  assert.ok(!mrns.includes('8'), '有紀錄但未收案(不在 AUD)不進')
  assert.ok(!mrns.includes('10'), '已刪除的 sdm 紀錄不算')
})

test('站別分類：s0(未談SDM)→s1(討論中)→s2(待建通路/功能不良重規劃)→s3(已轉介)→s4(使用中)→s5(CKM/移植)', () => {
  const AUD = [
    audr({ mrn: '1', egfr: 18 }),   // s0
    audr({ mrn: '2', egfr: 17 }),   // s1
    audr({ mrn: '3', egfr: 15 }),   // s2：已決定HD但未建通路
    audr({ mrn: '4', egfr: 10 }),   // s3：已轉介手術
    audr({ mrn: '5', egfr: 8 }),    // s4：使用中
    audr({ mrn: '6', egfr: 5 }),    // s5：CKM
    audr({ mrn: '7', egfr: 3 }),    // s5：移植(TX)
    audr({ mrn: '12', egfr: 9 }),   // s2：功能不良→重新規劃
  ]
  const records = [
    sdmRec({ mrn: '2', leaning: '尚未決定', decided: '' }),
    sdmRec({ mrn: '3', leaning: '血液透析 HD', decided: '是,已決定' }),
    sdmRec({ mrn: '4', leaning: '血液透析 HD', decided: '是,已決定' }),
    accRec({ mrn: '4', status: '已轉介手術' }),
    sdmRec({ mrn: '5', leaning: '血液透析 HD', decided: '是,已決定' }),
    accRec({ mrn: '5', status: '使用中' }),
    sdmRec({ mrn: '6', leaning: '保守療法 CKM', decided: '是,已決定' }),
    sdmRec({ mrn: '7', leaning: '腎臟移植', decided: '是,已決定' }),
    sdmRec({ mrn: '12', leaning: '血液透析 HD', decided: '是,已決定' }),
    accRec({ mrn: '12', status: '功能不良' }),
  ]
  const { rows, tally } = buildRrt({ records }, { AUD }, {}, 20)
  const by = Object.fromEntries(rows.map((r) => [r.mrn, r]))
  assert.equal(by['1'].stage, 's0'); assert.match(by['1'].next, /安排 RRT 共享決策/)
  assert.equal(by['2'].stage, 's1')
  assert.equal(by['3'].stage, 's2'); assert.match(by['3'].next, /轉介建立血管通路/)
  assert.equal(by['4'].stage, 's3'); assert.match(by['4'].next, /確認手術完成/)
  assert.equal(by['5'].stage, 's4'); assert.match(by['5'].next, /確認登錄簿結案/)
  assert.equal(by['6'].stage, 's5'); assert.match(by['6'].next, /保守療法照護/)
  assert.equal(by['7'].stage, 's5'); assert.match(by['7'].next, /腎移植評估/)
  assert.equal(by['12'].stage, 's2', '通路功能不良→重新規劃通路(s2)')
  assert.deepEqual(tally, { s0: 1, s1: 1, s2: 2, s3: 1, s4: 1, s5: 2 })
})

test('排序：eGFR 由小到大，null 視為 99 排最後；s0 時 eGFR<15 有不同的下一步提示文字', () => {
  const AUD = [
    audr({ mrn: 'z', egfr: null }),
    audr({ mrn: 'a', egfr: 12 }),   // s0 且 <15 → 特殊文字
    audr({ mrn: 'b', egfr: 18 }),   // s0 且 >=15 → 一般文字
  ]
  const records = [sdmRec({ mrn: 'z', leaning: '尚未決定', decided: '' })]   // 讓 eGFR=null 那位也進母體
  const { rows } = buildRrt({ records }, { AUD }, {}, 20)
  assert.deepEqual(rows.map((r) => r.mrn), ['a', 'b', 'z'], 'eGFR 小到大,null 排最後')
  assert.match(rows.find((r) => r.mrn === 'a').next, /eGFR 已 < 15/)
  assert.match(rows.find((r) => r.mrn === 'b').next, /安排 RRT 共享決策/)
})
