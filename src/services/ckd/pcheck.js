/* ============================================================
   門診 CKD — 檢核 P 碼輸入（交接包 src/workbench_layer.html:570-628 buildPcheck 搬 ESM；階段 5）
   隔天匯入前一天的醫令明細後，把「前一天個管師看到的判定」×「當天實際入的 P 碼」逐人比對，
   抓漏 key、誤 key、可收未收。

   ⚠️ 規則零改動：A／B 兩區的 if 鏈與說明文字、DKD 覆寫、名單外入帳、pri 排序、issues 與 A/B 統計 皆照原版。
   修正兩處原版死碼／反模式：
     1. 原版暫時改寫 S.billing 再 analyze（鐵律 1）→ 改成傳一份「濾掉當日入帳」的 data 給 analyze，不 mutate
     2. 原版 `(extOf(mrn) || {}).st === "pos"` 永遠不成立（extEnrollOf 回的是紀錄物件，沒有 st 欄位）
        → 改成 hooks.extEnrollOf(mrn)?.result === '已於他院收案'
   ⚠️ data 是 loadDataset 的共用快取物件 —— 本檔只讀不改。
   ============================================================ */
import { iso, PCODE } from './parsers.js'
import { analyze, makeCfg } from './engine.js'

/** 未收案區的「前日判定」文字（workbench_layer.html:302 逐字） */
export const VLBL = { pre: '符合 Pre-ESRD', early: '符合 Early-CKD', check: '待補檢驗', nodata: '無檢驗資料', no: '目前不符' }
/** 檢核標籤 [文字, css class]（workbench_layer.html:628 逐字） */
export const PC_LBL = {
  ok: ['已 key', 'pc-ok'],
  miss: ['漏 key', 'pc-bad'],
  early: ['未到期即 key', 'pc-warn'],
  none: ['不需 key', 'pc-dim'],
  new: ['新收案已 key', 'pc-ok'],
  unexp: ['未收案卻 key 追蹤', 'pc-bad'],
  cand: ['可收未收', 'pc-warn'],
  extra: ['名單外入帳', 'pc-warn'],
  nobill: ['待入帳資料', 'pc-dim'],
}

const slimBill = (b) => ({ code: b.code, codeName: b.codeName || '', doctor: b.doctor || '', price: b.price == null ? null : b.price, n: b.n || 1 })

/**
 * @param {object} data     loadDataset() 結果（只讀）
 * @param {object} settings getSettings().settings
 * @param {object} opts     { date: 'YYYY-MM-DD'（診次日）, doctorSel, hooks }
 */
export function buildPcheck(data, settings, { date = '', doctorSel = '', hooks } = {}) {
  const C = makeCfg(settings, date)
  const dIso = iso(C.date)
  /* 「前日判定」= 個管師前一天看到的判讀：當日的入帳要先拿掉再判讀，否則當日 P 碼會變成「最近照護」，
     可追蹤者全變未到期、新收案者直接變已收案，比對就失去意義 */
  const billing = (data.billing || []).filter((b) => !(b.visit && iso(b.visit) === dIso))
  const dataPrev = billing.length === (data.billing || []).length ? data : { ...data, billing }
  const R = analyze(dataPrev, C, { doctorSel, withAudit: false, hooks })
  /* 當日入帳索引（用完整的 data.billing） */
  const byMrn = {}
  ;(data.billing || []).forEach((b) => { if (b.visit && iso(b.visit) === dIso) (byMrn[b.mrn] = byMrn[b.mrn] || []).push(b) })
  const ct = (b) => b.ctype || (PCODE[b.code] ? PCODE[b.code].ctype : '其他')
  const billed = Object.keys(byMrn).length > 0          // 此日尚無任何入帳：不要把「可追蹤」全判成漏 key
  const rows = [], seen = {}
  ;(R.A || []).forEach((x) => {
    if (!x.p || seen[x.mrn]) return
    seen[x.mrn] = 1
    const bs = byMrn[x.mrn] || [], types = bs.map(ct)
    const care = types.some((t) => t === '追蹤' || t === '年度' || t === '新收案')
    const expect = x.status === 'ok' || x.status === 'over'
    let res, note = ''
    if (expect && care) res = 'ok'
    else if (expect && !billed) { res = 'nobill'; note = '此日入帳資料尚未匯入' }
    else if (expect && !care) { res = 'miss'; note = x.ord && x.ord.length ? '當時缺 ' + x.ord.length + ' 項檢驗' : (x.p.state ? x.p.state : '可追蹤但當日無入帳') }
    else if (!expect && care) { res = 'early'; note = x.status === 'wait' ? '未到期(尚差 ' + Math.max(0, (x.need || 0) - (x.gap || 0)) + ' 天)即入帳,留意核刪' : x.status === 'cap' ? '年度次數已達上限仍入帳' : '入帳' }
    else { res = 'none'; note = x.status === 'wait' ? '未到期,不需入帳' : x.status === 'cap' ? '年度上限' : x.status === 'dkd' ? 'DKD 收案,不 key Early-CKD 碼' : '' }
    if (x.status === 'dkd' && care) { res = 'early'; note = 'DKD 收案卻入帳 Early-CKD/追蹤碼:核對是否誤 key' }
    const verdict = x.status === 'ok' ? '可追蹤 ' + (x.code || '')
      : x.status === 'over' ? '逾期可追蹤 ' + (x.code || '')
        : x.status === 'wait' ? '未到期'
          : x.status === 'cap' ? '年度上限'
            : x.status === 'dkd' ? 'DKD 收案' : x.status
    rows.push({ kind: 'A', mrn: x.mrn, name: x.p.name || '', no: x.p.no, half: x.p.half, dr: x.p.doctor || '', bills: bs.map(slimBill), res, note, verdict })
  })
  ;(R.B || []).forEach((r) => {
    const p = r.p
    if (!p || seen[p.mrn]) return
    seen[p.mrn] = 1
    const bs = byMrn[p.mrn] || [], types = bs.map(ct)
    const newk = types.indexOf('新收案') >= 0
    const track = types.some((t) => t === '追蹤' || t === '年度')
    const qual = (r.verdict === 'pre' || r.verdict === 'early') && !r.noEn && r.closeKind !== 'dialysis' && r.closeKind !== 'dead'
    let res, note = ''
    if (newk) { res = 'new'; note = '新收案已入帳;追蹤清冊重匯後會轉為已收案' }
    else if (track) { res = 'unexp'; note = '登錄簿未收案卻入帳追蹤碼:核對登錄簿是否漏建收案段' }
    else if (qual && !billed) { res = 'nobill'; note = '此日入帳資料尚未匯入' }
    else if (qual) {
      const ext = hooks && hooks.extEnrollOf ? hooks.extEnrollOf(p.mrn) : null
      res = 'cand'
      note = r.closed ? '曾收案已結案,可重收未收' : (ext && ext.result === '已於他院收案') ? '他院收案,不可收' : '符合條件未收案:確認 VPN 查核與醫師意願'
    } else { res = 'none'; note = r.noEn ? '不予收案' : r.verdict === 'check' ? '檢驗不足' : r.verdict === 'nodata' ? '無檢驗' : '不符條件' }
    rows.push({ kind: 'B', mrn: p.mrn, name: p.name || '', no: p.no, half: p.half, dr: p.doctor || '', bills: bs.map(slimBill), res, note, verdict: VLBL[r.verdict] || r.verdict })
  })
  /* 當日有入帳、卻不在這個診次名單的人（掛在別的醫師／別科，或手動加入） */
  const extra = []
  Object.keys(byMrn).forEach((m) => {
    if (seen[m]) return
    extra.push({ kind: 'X', mrn: m, name: byMrn[m][0].name || '', no: null, half: null, dr: null, bills: byMrn[m].map(slimBill), res: 'extra', note: '不在此診次名單(別的診/他科)', verdict: '' })
  })
  const pri = { miss: 0, unexp: 0, early: 1, cand: 2, extra: 3, new: 4, ok: 5, nobill: 6, none: 7 }
  rows.sort((a, b) => (pri[a.res] - pri[b.res]) || (a.kind === b.kind ? 0 : a.kind === 'A' ? -1 : 1) || String(a.no).localeCompare(String(b.no), 'zh-Hant', { numeric: true }))
  const cnt = (k) => rows.filter((r) => r.res === k).length
  return {
    date: dIso, billed, rows, extra,
    issues: cnt('miss') + cnt('unexp') + cnt('early') + cnt('cand'),
    A: { total: rows.filter((r) => r.kind === 'A').length, ok: cnt('ok'), miss: cnt('miss'), early: cnt('early'), none: rows.filter((r) => r.kind === 'A' && r.res === 'none').length },
    B: { total: rows.filter((r) => r.kind === 'B').length, new: cnt('new'), cand: cnt('cand'), unexp: cnt('unexp') },
  }
}
