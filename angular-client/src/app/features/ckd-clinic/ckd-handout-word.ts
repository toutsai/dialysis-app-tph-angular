// 門診 CKD：檢驗報告衛教單 Word (.doc) 匯出（HTML＋Word Section 版面，A4 直式；做法同 core/utils/physician-rounding-word.ts）
// 內容（本次／前次值、注意事項用語、分期說明）全部來自後端 GET /ckd/patients/:mrn/handout；這裡只排版，不做任何判斷。
import { CkdHandout, CkdHandoutItem } from '@app/core/services/ckd-api.service';

/** HTML 跳脫：姓名、留言等自由文字會進 Word 檔 */
const esc = (s: unknown): string => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const roc = (s: string | null | undefined): string => {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${+m[1] - 1911}/${m[2]}/${m[3]}` : '';
};

const valText = (v: number | string, q: string): string => `${q || ''}${v}`;

/** 與前次比較的箭頭（只比數值；帶定性符號或非數值不比） */
function trend(it: CkdHandoutItem): string {
  if (!it.prev || typeof it.v !== 'number' || typeof it.prev.v !== 'number') return '';
  return it.v > it.prev.v ? '↑' : it.v < it.prev.v ? '↓' : '＝';
}

export interface HandoutDocOptions {
  /** 個管師留言（可空） */
  message: string;
  /** 衛教人員（頁尾署名，可空） */
  educator: string;
  /** 列印日期 YYYY-MM-DD */
  today: string;
}

/** 組出衛教單 HTML（匯出與畫面預覽共用同一份，預覽看到的就是印出來的） */
export function buildHandoutBodyHtml(d: CkdHandout, o: HandoutDocOptions): string {
  const h = d.handout;
  if (!h) return '<p>這位病人沒有可用的檢驗報告。</p>';
  const dirText = (x: 'H' | 'L' | '') => (x === 'H' ? '偏高' : x === 'L' ? '偏低' : '');

  // 檢驗值表：依群組分段
  let rows = '';
  let lastGroup = '';
  for (const it of h.items) {
    if (it.group !== lastGroup) {
      rows += `<tr class="grp"><td colspan="5">${esc(it.groupLabel)}</td></tr>`;
      lastGroup = it.group;
    }
    const dateNote = it.date !== h.reportDate ? `<span class="sm">（${roc(it.date)}）</span>` : '';
    rows +=
      `<tr><td class="nm">${esc(it.name)}<span class="sm"> ${esc(it.label)}</span></td>` +
      `<td class="num${it.dir ? ' ab' : ''}">${esc(valText(it.v, it.q))} <span class="sm">${esc(it.unit)}</span>${dateNote}</td>` +
      `<td class="c${it.dir ? ' ab' : ''}">${dirText(it.dir)}</td>` +
      `<td class="num">${it.prev ? esc(valText(it.prev.v, it.prev.q)) + ` <span class="sm">（${roc(it.prev.date)}）</span>` : '—'}</td>` +
      `<td class="c">${trend(it)}</td></tr>`;
  }

  const cautions = h.cautions.length
    ? h.cautions.map((c) => `<tr><td class="ct">${esc(c.title)}<br><span class="ab">${dirText(c.dir)}</span></td><td>${esc(c.text)}</td></tr>`).join('')
    : `<tr><td colspan="2">本次檢驗沒有需要特別注意的項目，請繼續保持並規律回診。</td></tr>`;

  const stage = h.stage
    ? `<p class="stage">您目前的腎功能分數（eGFR）為 <b>${esc(h.stage.egfr)}</b>，屬於慢性腎臟病 <b>${esc(h.stage.label)}</b>：${esc(h.stage.text)}。</p>`
    : '';

  const next: string[] = [];
  if (d.nextVisit) next.push(`下次回診：<b>${roc(d.nextVisit.date)}</b> ${esc(d.nextVisit.half)} ${esc(d.nextVisit.dept)} ${esc(d.nextVisit.doctor)}醫師`);
  else next.push('下次回診：＿＿＿年＿＿月＿＿日');
  if (d.enroll?.nextDue) next.push(`下次照護評估日：<b>${roc(d.enroll.nextDue)}</b>`);

  const info: string[] = [`姓名：<b>${esc(d.name)}</b>`, `病歷號：${esc(d.mrn)}`, `報告日期：${roc(h.reportDate)}`];
  if (d.enroll?.cat) info.push(`照護方案：${esc(d.enroll.cat)}`);
  if (d.enroll?.doctor) info.push(`收案醫師：${esc(d.enroll.doctor)}`);

  const msg = o.message.trim()
    ? `<div class="box"><div class="bt">個管師的話</div><div class="msg">${esc(o.message.trim()).replace(/\n/g, '<br>')}</div></div>`
    : `<div class="box"><div class="bt">個管師的話</div><div class="msg blank">&nbsp;<br>&nbsp;<br>&nbsp;</div></div>`;

  return (
    `<div class="hd"><div class="hosp">${esc(d.hospital)}</div><h1>${esc(d.title)}</h1></div>` +
    `<p class="info">${info.join('　｜　')}</p>` +
    stage +
    `<h2>本次檢驗結果</h2>` +
    `<table class="lab"><thead><tr><th>項目</th><th>本次</th><th>判讀</th><th>前次</th><th>變化</th></tr></thead><tbody>${rows}</tbody></table>` +
    `<h2>需要注意的項目</h2>` +
    `<table class="cau"><tbody>${cautions}</tbody></table>` +
    `<p class="next">${next.join('　　')}</p>` +
    msg +
    `<p class="ft">${esc(d.footer)}<br>聯絡電話：${d.phone ? esc(d.phone) : '＿＿＿＿＿＿＿＿＿＿'}` +
    `${o.educator ? '　　衛教人員：' + esc(o.educator) : ''}　　列印日期：${roc(o.today)}</p>`
  );
}

/** 預覽與 Word 共用的樣式（Word 只吃得懂簡單 CSS：不用 flex／grid） */
export const HANDOUT_CSS =
  `.hd{text-align:center;margin-bottom:6pt;}` +
  `.hosp{font-size:12pt;}` +
  `h1{font-size:18pt;font-weight:bold;margin:2pt 0 6pt;}` +
  `h2{font-size:13pt;font-weight:bold;margin:10pt 0 4pt;border-bottom:1.5pt solid #000;padding-bottom:2pt;}` +
  `p{margin:4pt 0;font-size:11.5pt;line-height:1.5;}` +
  `.info{font-size:11.5pt;}` +
  `.stage{font-size:12.5pt;background:#f2f2f2;padding:4pt 6pt;}` +
  `table{border-collapse:collapse;width:100%;}` +
  `th,td{border:1px solid #666;padding:3pt 5pt;font-size:11.5pt;vertical-align:top;line-height:1.45;}` +
  `th{background:#e8e8e8;text-align:center;}` +
  `.lab .grp td{background:#f2f2f2;font-weight:bold;font-size:10.5pt;}` +
  `.lab .nm{width:40%;}` +
  `.num{text-align:right;white-space:nowrap;}` +
  `.c{text-align:center;white-space:nowrap;}` +
  `.ab{font-weight:bold;color:#c00000;}` +
  `.sm{font-size:9.5pt;color:#555;font-weight:normal;}` +
  `.cau .ct{width:24%;font-weight:bold;}` +
  `.next{font-size:12.5pt;margin-top:10pt;}` +
  `.box{border:1px solid #666;margin-top:8pt;padding:4pt 6pt;}` +
  `.bt{font-weight:bold;font-size:11.5pt;}` +
  `.msg{font-size:12pt;line-height:1.6;}` +
  `.ft{font-size:10.5pt;color:#333;margin-top:10pt;border-top:1px solid #999;padding-top:4pt;}`;

export function exportHandoutWordDoc(d: CkdHandout, o: HandoutDocOptions): void {
  // Word 專用 XML＋Section：單純 @page CSS 會被 Word 忽略而改用預設 2.54cm 邊界
  const html =
    `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" ` +
    `xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8">` +
    `<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml><![endif]-->` +
    `<style>@page Section1{size:21.0cm 29.7cm;margin:1.5cm 1.6cm 1.4cm 1.6cm;mso-page-orientation:portrait;}` +
    `div.Section1{page:Section1;}body{font-family:'Microsoft JhengHei','微軟正黑體',sans-serif;}${HANDOUT_CSS}</style></head>` +
    `<body><div class="Section1">${buildHandoutBodyHtml(d, o)}</div></body></html>`;
  const blob = new Blob(['﻿' + html], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `檢驗報告衛教單_${d.mrn}_${d.handout?.reportDate || o.today}.doc`;
  a.click();
  URL.revokeObjectURL(url);
}
