// 重大傷病申請：官方附表列印版面（HTML 重製，瀏覽器列印成 PDF）
// 版面依 D:\05.洗腎重大傷病申請附表-初次.pdf / D:\06.洗腎重大傷病申請附表-再次.pdf 正面重製
import {
  CatastrophicFormData,
  RESTART_REASON_OPTIONS,
  toRocParts,
} from './catastrophic-illness.constants';

function esc(v: string | undefined | null): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** 勾選框：checked 用實心方塊 */
function box(checked: boolean): string {
  return `<span class="bx">${checked ? '■' : '□'}</span>`;
}

/** 底線填值欄：內容置中、固定最小寬 */
function fill(value: string | undefined | null, width: number): string {
  return `<span class="fl" style="min-width:${width}px">${esc(value)}</span>`;
}

/** 民國 年/月/日 三格 */
function rocDate(iso: string, yw = 34, mw = 26, dw = 26): string {
  const p = toRocParts(iso);
  return `${fill(p.y, yw)}年${fill(p.m, mw)}月${fill(p.d, dw)}日`;
}

const PRINT_STYLE = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  @page { size: A4 portrait; margin: 8mm 10mm; }
  body {
    font-family: 'DFKai-SB', '標楷體', 'BiauKai', serif;
    font-size: 12px; line-height: 1.5; color: #000;
  }
  .sheet { width: 100%; }
  h1 { font-size: 16px; text-align: center; font-weight: 700; margin-bottom: 2px; }
  .subtitle { font-size: 10.5px; margin-bottom: 4px; }
  .row { margin: 1px 0; }
  .indent { padding-left: 24px; }
  .fl { display: inline-block; border-bottom: 1px solid #000; text-align: center; padding: 0 2px; min-height: 14px; vertical-align: bottom; }
  .bx { font-family: 'MingLiU', serif; }
  .ck { display: inline-block; margin-right: 14px; white-space: nowrap; }
  .sec { margin-top: 3px; }
  .divider { text-align: center; margin: 4px 0 2px; letter-spacing: 1px; }
  .reason-line { border-bottom: 1px solid #000; min-height: 18px; padding: 0 4px; margin: 2px 0; }
  .small { font-size: 11px; }
  .review { margin-top: 2px; }
  .review .indent2 { padding-left: 60px; }
  @media print { body { -webkit-print-color-adjust: exact; } }
`;

function wrapDoc(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>${PRINT_STYLE}</style>
</head>
<body><div class="sheet">${body}</div></body>
</html>`;
}

/** 共同表頭（姓名～原發病因） */
function headerSection(f: CatastrophicFormData, primaryDiseaseHint: string): string {
  return `
  <div class="row">姓名：${fill(f.name, 110)}　性別：${box(f.gender === '男')}男 ${box(f.gender === '女')}女　身分證字號：${fill(f.idNumber, 130)}</div>
  <div class="row">出生：民國${rocDate(f.birthDate)}　初次透析治療日期：${rocDate(f.firstDialysisDate)}</div>
  <div class="row">居住地址：${fill(f.address, 300)}　電話：${fill(f.phone, 120)}</div>
  <div class="row">透析院所：${fill(f.facilityName, 220)}　（代號：${fill(f.facilityCode, 120)}）</div>
  <div class="row">透析方式：${box(f.dialysisType === 'hd')} 血液透析（永久性血管通路完成日期 ：${rocDate(f.vascularAccessDate)}）</div>
  <div class="row indent">　　　${box(f.dialysisType === 'pd')} 腹膜透析：（腹膜透析導管植入日期：${rocDate(f.pdCatheterDate)}）</div>
  <div class="row indent">　原發病因：${fill(f.primaryDisease, 110)}（${primaryDiseaseHint}）</div>`;
}

/** 伴隨症狀勾選區（兩表共用，僅標題編號不同） */
function symptomSection(f: CatastrophicFormData, title: string): string {
  const s = f.symptoms || [];
  return `
  <div class="sec">${title}</div>
  <div class="row indent">
    <span class="ck">${box(s.includes('s1'))} 1.心臟衰竭或肺水腫</span>
    <span class="ck">${box(s.includes('s2'))} 2.心包膜炎</span>
    <span class="ck">${box(s.includes('s3'))} 3.出血傾向</span><br>
    <span class="ck">${box(s.includes('s4'))} 4.神經症狀：意識障礙，抽搐或末稍神經病變</span>
    <span class="ck">${box(s.includes('s5'))} 5.高血鉀（藥物難以控制）</span><br>
    <span class="ck">${box(s.includes('s6'))} 6.嚴重酸血症(藥物難以控制)</span>
    <span class="ck">${box(s.includes('s7'))} 7.噁心、嘔吐(藥物難以控制)</span><br>
    <span class="ck">${box(s.includes('s8'))} 8.惡病體質(cachexia)</span>
    <span class="ck">${box(s.includes('s9'))} 9.重度氮血症 (BUN &gt; 100 mg/dl)</span><br>
    <span class="ck">${box(s.includes('s10'))} 10.其他 （請說明）：${fill(f.symptomsOther, 200)}</span>
  </div>`;
}

/** 相關疾病勾選區（兩表共用） */
function comorbiditySection(f: CatastrophicFormData, title: string): string {
  const c = f.comorbidities || [];
  return `
  <div class="sec">${title}</div>
  <div class="row indent">
    <span class="ck">${box(c.includes('c1'))} 1.糖尿病</span>
    <span class="ck">${box(c.includes('c2'))} 2.高血壓</span>
    <span class="ck">${box(c.includes('c3'))} 3.鬱血性心臟衰竭</span>
    <span class="ck">${box(c.includes('c4'))} 4.缺血性心臟病</span><br>
    <span class="ck">${box(c.includes('c5'))} 5.腦血管病變</span>
    <span class="ck">${box(c.includes('c6'))} 6.慢性肝病/肝硬化</span>
    <span class="ck">${box(c.includes('c7'))} 7.惡性腫瘤</span>
    <span class="ck">${box(c.includes('c8'))} 8.結核</span><br>
    <span class="ck">${box(c.includes('c9'))} 9.其他 （請說明）：${fill(f.comorbidityOther, 200)}</span>
  </div>`;
}

/** 負責醫師簽章列 + 審核醫師空白區（兩表共用） */
function footerSection(f: CatastrophicFormData): string {
  return `
  <div class="sec">負責醫師姓名：${fill(f.physicianName, 100)}（簽章）　中腎專醫字${fill(f.physicianLicense, 90)}號　日期：${rocDate(f.physicianDate)}</div>
  <div class="row small" style="text-align:right">(以上相關資料如有造假，負責醫師願付一切法律責任)</div>
  <div class="divider">-----------------------------（以下由審核醫師填寫）-------------------------------</div>
  <div class="row review">敬送${fill('', 110)}醫師</div>
  <div class="row review">審核意見：　1.${box(false)} 同意發給重大傷病證明。有效期間永久。</div>
  <div class="row review indent2" style="padding-left:64px">2.${box(false)} 無法確定為不可逆性尿毒症，發給有效期限三個月之重大傷病證明，三個月後申請</div>
  <div class="row review" style="padding-left:88px">再次評估，請嘗試停止透析並仔細照護與評估是否必須永久透析，若病患無法免除</div>
  <div class="row review" style="padding-left:88px">透析，請收集相關資料佐證，並於下次再申請時仔細說明。</div>
  <div class="row review" style="padding-left:64px">3.${box(false)} 不符申請條件，不同意。理由：</div>
  <div class="row review" style="padding-left:88px">A資料不全，請補足資料：</div>
  <div class="row review" style="padding-left:88px">B其他：</div>
  <div class="sec"><b>審核醫師姓名：</b>${fill('', 100)}（簽章）　中腎專醫字__ __ __號　日期：____年____月____日</div>`;
}

/** 初次申請附表 */
export function buildInitialPrintHtml(f: CatastrophicFormData): string {
  const u = f.ultrasoundFindings || [];
  const body = `
  <h1>全民健康保險慢性腎衰竭需定期透析治療患者重大傷病證明申請附表-初次申請</h1>
  <div class="subtitle"><b>初次</b>：第一次申請透析治療者（含從未申請或前次申請未獲核定同意透析治療）請填寫全部欄位，否則不予收件</div>
  ${headerSection(f, '請參考本表背面說明')}
  <div class="sec">一、定期透析適應症(Indication)：：（請勾選）（請參考本表背面說明）</div>
  <div class="row indent"><span class="ck">${box(f.indication === 'absolute')}（一）絕對適應症</span><span class="ck" style="margin-left:40px">${box(f.indication === 'relative')}（二）相對適應症</span></div>
  ${symptomSection(f, '二、伴隨症狀(Symptoms and Signs)：( 請務必勾選)')}
  ${comorbiditySection(f, '三、相關疾病(Comorbidity)：(請務必勾選)')}
  <div class="sec">四、生化檢驗值(Laboratory data)：（檢驗日期：${rocDate(f.labDate)}）</div>
  <div class="row indent">Albumin：${fill(f.albumin, 56)} g/dl　Hct：${fill(f.hct, 56)} %　Hb：${fill(f.hb, 56)} gm%　K ：${fill(f.k, 56)} mEq/L</div>
  <div class="row indent">BUN：${fill(f.bun, 62)} mg/dl　Cr：${fill(f.cr, 62)} mg/dl　eGFR (MDRD-S)：${fill(f.egfr, 70)} ml/min/1.73m<sup>2</sup></div>
  <div class="row indent">Daily urine amount：${fill(f.dailyUrine, 70)} ml</div>
  <div class="sec">五、其他相關檢查資料與說明：（病史、腎臟超音波等）</div>
  <div class="row indent">${box(f.histKnownCkd)} 過去病史及檢查已知為慢性腎衰竭　　　　　　　　日期：${rocDate(f.histKnownCkdDate)}</div>
  <div class="row indent">${box(f.histAbnormal)} 異常BUN：${fill(f.histAbnBun, 70)} mg/dl或Cr：${fill(f.histAbnCr, 70)} mg/dl.日期：${rocDate(f.histAbnDate)}</div>
  <div class="row indent">${box(f.histUltrasound)} 腎臟超音波檢查異常 (下列原因可複選)　　　　　日期：${rocDate(f.histUltrasoundDate)}</div>
  <div class="row indent" style="padding-left:44px">
    <span class="ck">${box(u.includes('u1'))}左腎臟剩餘 8-10cm</span><span class="ck">${box(u.includes('u2'))}右腎臟剩餘 8-10cm</span><br>
    <span class="ck">${box(u.includes('u3'))}左腎臟剩餘 6-8cm</span><span class="ck">${box(u.includes('u4'))}右腎臟剩餘6-8cm</span><br>
    <span class="ck">${box(u.includes('u5'))}左側水腎</span><span class="ck">${box(u.includes('u6'))}右側水腎</span><span class="ck">${box(u.includes('u7'))}慢性腎實質病變</span>
    <span class="ck">${box(!!(f.ultrasoundOther || '').trim())}其他說明：${fill(f.ultrasoundOther, 130)}</span>
  </div>
  <div class="sec">六、未符合上述條件但因其他嚴重或危及生命之臨床狀況必須進入定期透析之理由</div>
  <div class="reason-line">${esc(f.reason6)}</div>
  ${footerSection(f)}`;
  return wrapDoc('重大傷病申請附表-初次申請', body);
}

/** 再次申請附表 */
export function buildRenewalPrintHtml(f: CatastrophicFormData): string {
  const r = f.restartReasons || [];
  const body = `
  <h1>全民健康保險慢性腎衰竭需定期透析治療患者重大傷病證明申請附表-再次申請</h1>
  <div class="subtitle"><b>再次</b>：曾申請獲發定期透析重大傷病證明，本次再提出申請者；請填寫全部欄位，否則不予收件</div>
  ${headerSection(f, '請參考初次申請之附表背面說明')}
  <div class="sec">一、上次申請結果　　　　　　　　　　　　此次申請為第${fill(f.applicationNo, 40)}次申請</div>
  <div class="row indent">${box(f.lastResultThreeMonth)} 無法確定為不可逆性尿毒症，發給<u>有效期限三個月</u>之重大傷病證明。</div>
  <div class="row indent">${box(f.lastResultRejected)} 不符申請條件，不同意。理由：${fill('', 90)}　${box(f.lastRejectIncomplete)} 資料<u>不</u>全　${box(!!(f.lastRejectOther || '').trim())} 其他：${fill(f.lastRejectOther, 110)}</div>
  <div class="row indent">初次申請之定期透析適應症(Indication)：${box(f.initialIndication === 'absolute')}絕對適應症　${box(f.initialIndication === 'relative')}相對適應症</div>
  <div class="sec">二、目前之透析情況與生化檢驗值(Laboratory data)：（檢驗日期：${rocDate(f.labDate)}）</div>
  <div class="row indent">每週血液透析次數：${fill(f.weeklyHdCount, 40)} 次　每次透析時間：${fill(f.hoursPerSession, 70)} 小時 （每日腹膜換液：${fill(f.pdExchangesPerDay, 40)}次）</div>
  <div class="row indent">Albumin：${fill(f.albumin, 56)} g/dl　Hct：${fill(f.hct, 56)} %　Hb：${fill(f.hb, 56)} gm%　K ：${fill(f.k, 56)} mEq/L</div>
  <div class="row indent">BUN：${fill(f.bun, 62)} mg/dl　　Cr：${fill(f.cr, 62)} mg/dl</div>
  <div class="row indent">Daily urine amount：${fill(f.dailyUrine, 70)} ml　最長不透析日之24小時CCr：${fill(f.longestCcr, 80)} ml/min</div>
  <div class="row indent"><u>（請參考本表背面CCr計算公式）</u></div>
  <div class="sec">三、相關檢查資料與說明：（是否嘗試停止透析、停止透析後之臨床狀況）( 請務必勾選)</div>
  <div class="row indent">${box(f.triedStop === 'yes')}有${box(f.triedStop === 'no')}無 嘗試停止透析治療　　　　　　　　日期：${rocDate(f.triedStopDate)}</div>
  <div class="row indent">最長停止透析之日數：${fill(f.longestStopDays, 34)}日；當時之BUN：${fill(f.stopBun, 80)} mg/dl　Cr：${fill(f.stopCr, 80)} mg/dl</div>
  <div class="row indent">必須再開始透析或持續定期透析之理由：</div>
  <div class="row indent" style="padding-left:36px">${RESTART_REASON_OPTIONS.map((o) => `<span class="ck">${box(r.includes(o.key))}${o.label}</span>`).join('')}</div>
  ${symptomSection(f, '四、目前之伴隨症狀(Symptoms and Signs)：(請務必勾選)')}
  ${comorbiditySection(f, '五、目前之相關疾病(Comorbidity)：(請務必勾選)')}
  <div class="sec">六、未符合上述條件但因其他嚴重或危及生命之臨床狀況必須進入定期透析之理由</div>
  <div class="reason-line">${esc(f.reason6)}</div>
  ${footerSection(f)}`;
  return wrapDoc('重大傷病申請附表-再次申請', body);
}

/** 開新視窗列印（使用者於列印對話框選「另存為 PDF」即得檔案） */
export function openPrintWindow(html: string): void {
  const win = window.open('', '_blank', 'width=900,height=1100');
  if (!win) return;
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  // 等字型/版面就緒再觸發列印
  setTimeout(() => win.print(), 300);
}
