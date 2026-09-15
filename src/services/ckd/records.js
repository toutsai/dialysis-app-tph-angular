/* ============================================================
   門診 CKD — 個案紀錄（交接包 records.js + app.js pcodeTimeline 搬 ESM）
   八類：血管通路 access / RRT SDM sdm / 聯絡紀錄 contact / 外院收案查核 extEnroll /
        P 碼補登更正 claimFix / 收案狀態更正 enrollFix / 不予收案 noEnroll / 追蹤紀錄 note
   定位：個管師的工作備忘與判定更正，不是病歷；正式紀錄仍應寫入 HIS。
   判定更正三類（claimFix / enrollFix / noEnroll）與 extEnroll 直接參與判讀（engine.js hooks）。
   存放：ckd_records（payload_json 存欄位值；軟刪除 deleted_at）。
   ============================================================ */
import { v4 as uuidv4 } from 'uuid'
import { iso, dGap, PCODE } from './parsers.js'

/* ---------- 欄位定義（給前端動態表單；opts 與原版逐字相同） ---------- */
export const REC_TYPES = {
  access: {
    label: '血管通路', tag: 'ACCESS', color: 'g1',
    fields: [
      { k: 'accessType', t: '通路類型', type: 'select', req: 1, opts: ['AVF 自體動靜脈廔管', 'AVG 人工血管', 'TCC 長期導管', 'NCC 暫時性導管', 'PD 腹膜透析導管'] },
      { k: 'side', t: '側別', type: 'select', opts: ['左', '右', '不適用'] },
      { k: 'site', t: '位置', type: 'text', ph: '前臂 / 上臂 / 右頸內靜脈' },
      { k: 'status', t: '目前狀態', type: 'select', req: 1, opts: ['規劃中', '已轉介手術', '已建立未使用', '使用中', '功能不良', '已廢棄'] },
      { k: 'planDate', t: '轉介/安排日', type: 'date' },
      { k: 'createDate', t: '建立日', type: 'date' },
      { k: 'matureDate', t: '成熟評估日', type: 'date' },
      { k: 'firstUseDate', t: '首次使用日', type: 'date' },
      { k: 'surgeon', t: '術者/院所', type: 'text' },
      { k: 'note', t: '備註', type: 'textarea' },
    ],
    whenKeys: ['createDate', 'planDate', 'at'],
  },
  sdm: {
    label: 'RRT SDM', tag: 'SDM', color: 'g2',
    fields: [
      { k: 'at', t: '談話日期', type: 'date', req: 1 },
      { k: 'who', t: '參與者', type: 'text', ph: '病人、配偶、長子、個管師' },
      { k: 'options', t: '討論選項', type: 'checks', opts: ['血液透析 HD', '腹膜透析 PD', '腎臟移植', '保守療法 CKM'] },
      { k: 'leaning', t: '目前傾向', type: 'select', req: 1, opts: ['尚未決定', '血液透析 HD', '腹膜透析 PD', '腎臟移植', '保守療法 CKM'] },
      { k: 'decided', t: '是否已決定', type: 'select', opts: ['否,持續討論', '是,已決定'] },
      { k: 'tool', t: '使用工具', type: 'text', ph: '決策輔助表、衛教影片' },
      { k: 'followUp', t: '待追事項', type: 'textarea', ph: '下次門診要確認的問題' },
      { k: 'note', t: '談話重點', type: 'textarea' },
    ],
    whenKeys: ['at'],
  },
  contact: {
    label: '聯絡紀錄', tag: 'CALL', color: 'g3',
    fields: [
      { k: 'at', t: '聯絡日期', type: 'date', req: 1 },
      { k: 'how', t: '方式', type: 'select', opts: ['電話', '簡訊/LINE', '家屬', '門診面談', '其他'] },
      { k: 'result', t: '結果', type: 'select', req: 1, opts: ['已約回診', '未接/再試', '改期再聯絡', '拒絕/暫不回診', '失聯(電話錯誤)', '已於他院照護', '已轉透析', '往生', '其他'] },
      { k: 'apptDate', t: '約定回診日', type: 'date' },
      { k: 'until', t: '暫緩召回至', type: 'date' },
      { k: 'note', t: '備註', type: 'textarea', ph: '談話重點、家屬聯絡方式、下次要確認的事' },
    ],
    whenKeys: ['at'],
  },
  extEnroll: {
    label: '外院收案查核', tag: 'VPN', color: 'g3',
    fields: [
      { k: 'at', t: 'VPN 查詢日', type: 'date', req: 1 },
      { k: 'result', t: '查詢結果', type: 'select', req: 1, opts: ['已於他院收案', '未於他院收案', '查詢中/待確認'] },
      { k: 'hospital', t: '他院名稱', type: 'text', ph: '已於他院收案時填寫' },
      { k: 'extProg', t: '他院方案', type: 'select', opts: ['Pre-ESRD', 'Early-CKD', '不確定'] },
      { k: 'checker', t: '查詢者', type: 'text' },
      { k: 'note', t: '備註', type: 'textarea' },
    ],
    whenKeys: ['at'],
  },
  claimFix: {
    label: 'P 碼補登/更正', tag: 'PCODE', color: 'g1',
    fields: [
      { k: 'at', t: '看診日期', type: 'date', req: 1 },
      { k: 'action', t: '處理方式', type: 'select', req: 1, opts: ['補登(確實有申報,檔案沒抓到)', '註銷(這筆不算,誤登或已核刪)'] },
      { k: 'code', t: 'P 碼', type: 'select', req: 1, opts: [
        'P3402C Pre-ESRD 新收案', 'P3403C Pre-ESRD 追蹤', 'P3404C Pre-ESRD 年度評估', 'P3405C Pre-ESRD 結案',
        'P3406C 獎勵(eGFR 斜率)', 'P3407C 獎勵(G5 斜率)', 'P3408C 獎勵(蛋白尿緩解)', 'P3409C 獎勵(持續照護)',
        'P4301C Early-CKD 新收案', 'P4302C Early-CKD 追蹤', 'P4303C Early-CKD 轉出',
        'P7001C 糖尿病合併追蹤', 'P7002C 糖尿病合併年度', 'P7003C 糖尿病合併轉出'] },
      { k: 'doctor', t: '看診醫師', type: 'text' },
      { k: 'author', t: '更正者', type: 'text' },
      { k: 'note', t: '原因/備註', type: 'textarea', ph: '為什麼要補登或註銷這筆' },
    ],
    whenKeys: ['at'],
  },
  enrollFix: {
    label: '收案狀態更正', tag: 'ENROLL', color: 'g2',
    fields: [
      { k: 'at', t: '更正日期', type: 'date', req: 1 },
      { k: 'state', t: '實際狀態', type: 'select', req: 1, opts: ['已收案 — 檔案未反映,請納入追蹤', '未收案 — 取消收案或誤判,請退回評估'] },
      { k: 'prog', t: '方案', type: 'select', opts: ['Pre-ESRD', 'Early-CKD'] },
      { k: 'enrollDate', t: '實際收案日', type: 'date' },
      { k: 'lastVisit', t: '最近一次照護日', type: 'date', ph: '標記為已收案時填,用來算追蹤間隔' },
      { k: 'author', t: '更正者', type: 'text' },
      { k: 'reason', t: '更正原因', type: 'textarea' },
    ],
    whenKeys: ['at'],
  },
  noEnroll: {
    label: '不予收案', tag: 'NOCASE', color: 'g3',
    fields: [
      { k: 'at', t: '決定日期', type: 'date', req: 1 },
      { k: 'doctor', t: '看診醫師', type: 'text' },
      { k: 'reason', t: '不予收案原因', type: 'select', req: 1, opts: [
        '檢驗收集困難', '住在機構難以追蹤', '長期由家屬代為看診', '病人/家屬拒絕參與',
        '已於他院收案', '生命有限/安寧照護', '不適合參與收案計畫', '其他(見特殊註記)'] },
      { k: 'until', t: '暫緩至', type: 'date', ph: '留空 = 長期排除;填日期則到期後恢復提示' },
      { k: 'author', t: '紀錄者', type: 'text' },
      { k: 'note', t: '特殊註記', type: 'textarea' },
    ],
    whenKeys: ['at'],
  },
  note: {
    label: '追蹤紀錄', tag: 'NOTE', color: 'g4',
    fields: [
      { k: 'at', t: '日期', type: 'date', req: 1 },
      { k: 'cat', t: '類別', type: 'select', req: 1, opts: ['衛教', '電話追蹤', '門診觀察', '檢驗追蹤', '轉介', '其他'] },
      { k: 'content', t: '內容', type: 'textarea', req: 1 },
      { k: 'author', t: '紀錄者', type: 'text' },
    ],
    whenKeys: ['at'],
  },
}
export const REC_TYPE_KEYS = Object.keys(REC_TYPES)

/** 摘要列（原版 REC_TYPES[type].line） */
export function recLine(r) {
  const s = (v) => v || ''
  switch (r.type) {
    case 'access': return [r.accessType, r.side && r.side !== '不適用' ? r.side : '', r.site].filter(Boolean).join(' ')
    case 'sdm': return [r.leaning, r.decided].filter(Boolean).join(' · ')
    case 'contact': return [r.how, r.result, r.apptDate ? '約 ' + r.apptDate : '', r.until ? '暫緩至 ' + r.until : ''].filter(Boolean).join(' · ')
    case 'extEnroll': return [r.result, r.hospital].filter(Boolean).join(' · ')
    case 'claimFix': return [/註銷/.test(s(r.action)) ? '註銷' : '補登', s(r.code).split(' ')[0]].filter(Boolean).join(' · ')
    case 'enrollFix': return [r.state, r.prog].filter(Boolean).join(' · ')
    case 'noEnroll': return [r.reason, r.until ? '暫緩至 ' + r.until : '長期排除'].filter(Boolean).join(' · ')
    case 'note': return s(r.cat)
    default: return ''
  }
}
/** 排序用日期（原版 when） */
export function recWhen(r) {
  const T = REC_TYPES[r.type]
  if (!T) return r.at || ''
  for (const k of T.whenKeys) if (r[k]) return r[k]
  return ''
}
/** 原版 byWhen：日期新→舊，再建立時間新→舊 */
export const byWhen = (a, b) => String(recWhen(b)).localeCompare(String(recWhen(a))) || String(b.created || '').localeCompare(String(a.created || ''))

/* ---------- 驗證（原版 readForm：必填；select 需在選項內；checks 為陣列） ---------- */
export function validateRecord(type, data) {
  const T = REC_TYPES[type]
  if (!T) return { ok: false, message: '不支援的紀錄類型：' + type }
  const out = {}, missing = []
  for (const f of T.fields) {
    let v = data ? data[f.k] : undefined
    if (f.type === 'checks') {
      v = Array.isArray(v) ? v.filter((x) => f.opts.includes(x)) : (v ? String(v).split('、').filter((x) => f.opts.includes(x)) : [])
      if (f.req && !v.length) missing.push(f.t)
    } else {
      v = v == null ? '' : String(v).trim()
      if (f.type === 'select' && v && !f.opts.includes(v)) return { ok: false, message: `「${f.t}」不是有效選項：${v}` }
      if (f.type === 'date' && v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return { ok: false, message: `「${f.t}」日期格式須為 YYYY-MM-DD` }
      if (f.req && !v) missing.push(f.t)
    }
    out[f.k] = v
  }
  if (missing.length) return { ok: false, message: '請填寫：' + missing.join('、') }
  return { ok: true, data: out }
}

/* ---------- DB ---------- */
const toRow = (r) => {
  let p = {}
  try { p = r.payload_json ? JSON.parse(r.payload_json) : {} } catch { p = {} }
  return { id: r.id, type: r.rec_type, mrn: r.mrn, name: r.name || '', created: r.created_at, updated: r.updated_at, createdBy: safeJson(r.created_by), updatedBy: safeJson(r.updated_by), ...p }
}
function safeJson(s) { try { return s ? JSON.parse(s) : null } catch { return null } }
const actor = (user) => JSON.stringify(user ? { uid: user.uid || user.id || null, name: user.name || user.username || '' } : {})

export function listRecords(db, { mrn = '', type = '', limit = 200 } = {}) {
  const where = ['deleted_at IS NULL']
  const args = []
  if (mrn) { where.push('mrn = ?'); args.push(mrn) }
  if (type) { where.push('rec_type = ?'); args.push(type) }
  const rows = db.prepare(`SELECT id, mrn, name, rec_type, rec_date, payload_json, created_by, updated_by, created_at, updated_at FROM ckd_records WHERE ${where.join(' AND ')} ORDER BY rec_date DESC, created_at DESC LIMIT ?`).all(...args, limit)
  return rows.map(toRow)
}
export function getRecord(db, id) {
  const r = db.prepare(`SELECT id, mrn, name, rec_type, rec_date, payload_json, created_by, updated_by, created_at, updated_at, deleted_at FROM ckd_records WHERE id = ?`).get(id)
  return r && !r.deleted_at ? toRow(r) : null
}
export function createRecord(db, { mrn, name, type, data, user }) {
  const v = validateRecord(type, data)
  if (!v.ok) throw Object.assign(new Error(v.message), { status: 400 })
  const id = uuidv4()
  const when = recWhen({ type, ...v.data })
  db.prepare(`INSERT INTO ckd_records (id, mrn, name, rec_type, rec_date, payload_json, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, mrn, name || '', type, when || null, JSON.stringify(v.data), actor(user), actor(user))
  return getRecord(db, id)
}
export function updateRecord(db, id, { data, user }) {
  const cur = getRecord(db, id)
  if (!cur) return null
  const v = validateRecord(cur.type, data)
  if (!v.ok) throw Object.assign(new Error(v.message), { status: 400 })
  const when = recWhen({ type: cur.type, ...v.data })
  db.prepare(`UPDATE ckd_records SET rec_date = ?, payload_json = ?, updated_by = ?, updated_at = datetime('now','localtime') WHERE id = ?`)
    .run(when || null, JSON.stringify(v.data), actor(user), id)
  return getRecord(db, id)
}
export function deleteRecord(db, id, user) {
  const cur = getRecord(db, id)
  if (!cur) return null
  db.prepare(`UPDATE ckd_records SET deleted_at = datetime('now','localtime'), updated_by = ?, updated_at = datetime('now','localtime') WHERE id = ?`).run(actor(user), id)
  return cur
}

/** 紀錄區統計條（原版 #tallyE）：總數／各類筆數／有通路紀錄人數／SDM 待追事項（有 followUp 且尚未決定） */
export function recordStats(db) {
  const byType = {}
  for (const r of db.prepare(`SELECT rec_type AS t, COUNT(*) AS n FROM ckd_records WHERE deleted_at IS NULL GROUP BY rec_type`).all()) byType[r.t] = r.n
  const total = Object.values(byType).reduce((a, b) => a + b, 0)
  const accessPersons = db.prepare(`SELECT COUNT(DISTINCT mrn) AS n FROM ckd_records WHERE deleted_at IS NULL AND rec_type = 'access'`).get().n
  const sdmFollow = db.prepare(`SELECT COUNT(*) AS n FROM ckd_records WHERE deleted_at IS NULL AND rec_type = 'sdm'
    AND COALESCE(json_extract(payload_json, '$.followUp'), '') <> '' AND COALESCE(json_extract(payload_json, '$.decided'), '') <> '是,已決定'`).get().n
  return { total, byType, accessPersons, sdmFollow }
}

/* ---------- 判定掛鉤（原版 records.js:330-368；吃記憶體中的紀錄陣列） ---------- */
export function makeHooks(records) {
  const byMrn = new Map()
  for (const r of records || []) { if (r.deleted) continue; let a = byMrn.get(r.mrn); if (!a) byMrn.set(r.mrn, a = []); a.push(r) }
  const of = (mrn) => byMrn.get(mrn) || []
  return {
    /* P 碼補登/更正：[{at:Date, action:'add'|'void', code, prog, ctype, doctor}] */
    claimFixesOf(mrn) {
      return of(mrn).filter((r) => r.type === 'claimFix' && r.at && r.code).map((r) => {
        const code = (r.code || '').split(' ')[0]
        const map = PCODE[code] || { prog: /^P34/.test(code) ? 'pre' : 'early', ctype: '追蹤' }
        return { id: r.id, at: new Date(r.at + 'T00:00:00'), action: /註銷/.test(r.action || '') ? 'void' : 'add', code, prog: map.prog, ctype: map.ctype, doctor: r.doctor || '', note: r.note || '' }
      }).filter((x) => !isNaN(+x.at))
    },
    /* 收案狀態更正：最新一筆有效；用開頭比對（選項文字互相包含過） */
    enrollFixOf(mrn) {
      const rs = of(mrn).filter((r) => r.type === 'enrollFix').sort(byWhen)
      if (!rs.length) return null
      const r = rs[0]
      return { at: r.at, on: /^已收案/.test(r.state || ''), prog: r.prog === 'Early-CKD' ? 'early' : 'pre', enrollDate: r.enrollDate || '', lastVisit: r.lastVisit || '', reason: r.reason || '' }
    },
    /* 不予收案：最新一筆；「暫緩至」已過期則不再生效 */
    noEnrollOf(mrn, onDate) {
      const rs = of(mrn).filter((r) => r.type === 'noEnroll').sort(byWhen)
      if (!rs.length) return null
      const r = rs[0]
      if (r.until) {
        const u = new Date(r.until + 'T00:00:00'), d = onDate || new Date()
        if (!isNaN(+u) && u < d) return null
      }
      return { id: r.id, at: r.at, doctor: r.doctor || '', reason: r.reason || '', until: r.until || '', note: r.note || '', author: r.author || '' }
    },
    /* 外院收案查核：最新一筆 */
    extEnrollOf(mrn) {
      const rs = of(mrn).filter((r) => r.type === 'extEnroll').sort(byWhen)
      return rs.length ? rs[0] : null
    },
    /* 召回：最近一筆聯絡紀錄 */
    lastContactOf(mrn) {
      return of(mrn).filter((r) => r.type === 'contact').sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')) || String(b.created || '').localeCompare(String(a.created || '')))[0] || null
    },
    /* 第一、二區的小標記（原版 recChips） */
    chipsOf(mrn) {
      const rs = of(mrn)
      if (!rs.length) return null
      const acc = rs.filter((r) => r.type === 'access').sort(byWhen)[0]
      const sdm = rs.filter((r) => r.type === 'sdm').sort(byWhen)[0]
      const ext = rs.filter((r) => r.type === 'extEnroll').sort(byWhen)[0]
      const n = rs.filter((r) => r.type === 'note').length
      const out = { total: rs.length, access: acc ? { status: acc.status || '', type: acc.accessType || '' } : null, sdm: sdm ? { leaning: sdm.leaning || '', at: sdm.at || '' } : null, extPos: !!(ext && ext.result === '已於他院收案'), extHospital: ext ? ext.hospital || '' : '', notes: n }
      return out
    },
    recordsOf: of,
  }
}

/* ---------- P 碼總覽（app.js:1602-1637）：登錄／入帳／手動補登 三來源合併 ---------- */
export function pcodeTimeline(data, mrn, C, hooks) {
  const out = [], seen = {}
  const push = (o) => {
    const k = iso(o.visit) + '|' + (o.code || '')
    if (seen[k]) { Object.keys(o).forEach((x) => { if (o[x] != null && o[x] !== '' && seen[k][x] == null) seen[k][x] = o[x] }); seen[k].src = [...new Set((seen[k].src || []).concat(o.src))]; return }
    seen[k] = Object.assign({}, o, { src: [].concat(o.src) }); out.push(seen[k])
  }
  data.cases.filter((c) => c.mrn === mrn && c.visit).forEach((c) => push({ visit: c.visit, code: c.code || '', ctype: c.ctype || '', prog: c.prog, doctor: c.doctor || '', price: null, src: '登錄' }))
  data.billing.filter((b) => b.mrn === mrn && b.visit).forEach((b) => push({ visit: b.visit, code: b.code, ctype: b.ctype, prog: b.prog, doctor: b.doctor || '', price: b.price, src: '入帳' }))
  const fx = hooks ? hooks.claimFixesOf(mrn) : []
  fx.forEach((f) => { if (f.action === 'add') push({ visit: f.at, code: f.code, ctype: f.ctype, prog: f.prog, doctor: f.doctor, price: null, src: '手動補登' }) })
  const voided = {}
  fx.forEach((f) => { if (f.action === 'void') voided[iso(f.at) + '|' + f.code] = f })
  out.forEach((o2) => { if (voided[iso(o2.visit) + '|' + o2.code]) o2.voided = true })
  out.sort((a, b) => b.visit - a.visit)
  const care = out.filter((o2) => o2.ctype === '追蹤' && !o2.voided).slice().sort((a, b) => a.visit - b.visit)
  for (let i = 1; i < care.length; i++) {
    care[i].gapPrev = dGap(care[i - 1].visit, care[i].visit)
    care[i].needPrev = care[i].prog === 'pre' ? C.preGap : C.earlyGap
  }
  const yr = C.date.getFullYear()
  const stat = {
    total: out.filter((o2) => !o2.voided).length,
    billed: out.filter((o2) => !o2.voided && o2.src.indexOf('入帳') >= 0).length,
    unbilled: out.filter((o2) => !o2.voided && o2.src.indexOf('入帳') < 0 && o2.src.indexOf('手動補登') < 0).length,
    thisYear: out.filter((o2) => !o2.voided && o2.visit.getFullYear() === yr && o2.ctype === '追蹤').length,
    annThisYear: out.filter((o2) => !o2.voided && o2.visit.getFullYear() === yr && o2.ctype === '年度').length,
    points: out.filter((o2) => !o2.voided && o2.price).reduce((a, b) => a + (+b.price || 0), 0),
    short: care.filter((c) => c.gapPrev != null && c.gapPrev < c.needPrev).length,
  }
  return { rows: out, stat }
}

/** 病人姓名查找（原版 knownPatients/patientName：登錄簿 → 門診 → 檢驗 → 紀錄） */
export function lookupName(db, mrn) {
  const q = (sql) => db.prepare(sql).get(mrn)
  const r = q(`SELECT name FROM ckd_cases WHERE mrn = ? AND name <> '' LIMIT 1`) || q(`SELECT name FROM ckd_clinic_visits WHERE mrn = ? AND name <> '' LIMIT 1`) ||
    q(`SELECT name FROM ckd_labs WHERE mrn = ? AND name <> '' LIMIT 1`) || q(`SELECT name FROM ckd_records WHERE mrn = ? AND name <> '' LIMIT 1`)
  return r ? r.name : ''
}
/** 病人搜尋（病歷號前綴或姓名子字串；四來源聯集，最多 limit 筆） */
export function searchPatients(db, q, limit = 20) {
  const s = String(q || '').trim()
  if (!s) return []
  const like = `%${s}%`, pre = `${s}%`
  const rows = db.prepare(`
    SELECT mrn, name FROM (
      SELECT mrn, MAX(name) AS name FROM ckd_cases WHERE mrn LIKE ? OR name LIKE ? GROUP BY mrn
      UNION SELECT mrn, MAX(name) FROM ckd_clinic_visits WHERE mrn LIKE ? OR name LIKE ? GROUP BY mrn
      UNION SELECT mrn, MAX(name) FROM ckd_labs WHERE mrn LIKE ? OR name LIKE ? GROUP BY mrn
      UNION SELECT mrn, MAX(name) FROM ckd_records WHERE deleted_at IS NULL AND (mrn LIKE ? OR name LIKE ?) GROUP BY mrn
    ) GROUP BY mrn ORDER BY CASE WHEN mrn LIKE ? THEN 0 ELSE 1 END, mrn LIMIT ?
  `).all(pre, like, pre, like, pre, like, pre, like, pre, limit)
  return rows.map((r) => ({ mrn: r.mrn, name: r.name || '' }))
}
