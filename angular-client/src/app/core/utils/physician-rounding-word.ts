// 醫師查房班表 Word (.doc) 匯出與週曆格建構。
// 由「醫師班表」頁與「書記專用」頁共用，改版面時兩頁同步生效。

export interface RoundingWeekDay {
  day: number | null;
  isWeekend?: boolean;
}

export interface RoundingExportOptions {
  year: number;
  month: number;
  /** 週曆格（每週 7 格、週一起算；day 為 null 表示月外空格） */
  weeks: RoundingWeekDay[][];
  /** 回傳該日該班別要顯示的醫師簡稱（無資料回 '--'） */
  resolveName: (day: number, shift: 'early' | 'noon' | 'late') => string;
}

/** 建立某年某月的週曆格（週一起算，每週補滿 7 格）。 */
export function buildRoundingWeeks(year: number, month: number): RoundingWeekDay[][] {
  const m = month - 1;
  const date = new Date(year, m, 1);
  const days: RoundingWeekDay[] = [];
  while (date.getMonth() === m) {
    const dayOfWeek = date.getDay();
    days.push({ day: date.getDate(), isWeekend: dayOfWeek === 0 || dayOfWeek === 6 });
    date.setDate(date.getDate() + 1);
  }
  const weeks: RoundingWeekDay[][] = [];
  const firstDayOfMonth = new Date(year, m, 1).getDay();
  const startDayOfWeek = (firstDayOfMonth + 6) % 7;
  let currentWeek: RoundingWeekDay[] = Array.from({ length: startDayOfWeek }, () => ({ day: null }));
  days.forEach((dayInfo, index) => {
    currentWeek.push(dayInfo);
    if (currentWeek.length === 7 || index === days.length - 1) {
      while (currentWeek.length < 7) currentWeek.push({ day: null });
      weeks.push(currentWeek);
      currentWeek = [];
    }
  });
  return weeks;
}

/** 匯出整月查房班表為 Word (.doc，HTML+Word 版面，A4 直式 0.5cm 邊界、大字) */
export function exportRoundingWordDoc({ year, month, weeks, resolveName }: RoundingExportOptions): void {
  // 查房班表（同網頁週曆格：日期 / 早班 / 午班 / 夜班）
  // 不含星期日：每週取前 6 格（一~六）
  const headTh = ['', '一', '二', '三', '四', '五', '六']
    .map((t, i) => `<th class="${i === 6 ? 'wk' : ''}">${t}</th>`)
    .join('');
  let body = '';
  for (const week of weeks) {
    const days = week.slice(0, 6);
    const dateCells = days
      .map((d) => `<td>${d.day ? month + '/' + d.day : ''}</td>`)
      .join('');
    const shiftRow = (label: string, shift: 'early' | 'noon' | 'late') =>
      `<tr><td class="lbl">${label}</td>` +
      days
        .map((d) => `<td>${d.day ? resolveName(d.day, shift) : ''}</td>`)
        .join('') +
      '</tr>';
    body +=
      `<tr class="dt"><td class="lbl">日期</td>${dateCells}</tr>` +
      shiftRow('早班', 'early') +
      shiftRow('午班', 'noon') +
      shiftRow('夜班', 'late');
  }
  const scheduleTable = `<table class="sch"><thead><tr>${headTh}</tr></thead><tbody>${body}</tbody></table>`;

  // 用 Word 專用 XML + Section 版面，讓 Word 真正套 A4 直式 0.5cm 邊界
  // （單純 @page CSS 會被 Word 忽略而改用預設 2.54cm 邊界 → 撐成 2 頁）
  const html =
    `<html xmlns:o="urn:schemas-microsoft-com:office:office" ` +
    `xmlns:w="urn:schemas-microsoft-com:office:word" ` +
    `xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8">` +
    `<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View>` +
    `<w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml><![endif]-->` +
    `<style>` +
    `@page Section1{size:21.0cm 29.7cm;margin:0.5cm 0.5cm 0.5cm 0.5cm;mso-page-orientation:portrait;}` +
    `div.Section1{page:Section1;}` +
    `*{margin:0;padding:0;}` +
    `body{font-family:'Microsoft JhengHei','微軟正黑體',sans-serif;}` +
    `h2{text-align:center;font-size:20pt;font-weight:bold;margin:0 0 4pt;line-height:1.1;}` +
    `table{border-collapse:collapse;width:100%;table-layout:fixed;}` +
    `.sch th,.sch td{border:1px solid #000;text-align:center;font-size:20pt;font-weight:bold;` +
    `height:22pt;padding:0 2pt;line-height:1.0;word-break:break-all;}` +
    `.sch .lbl{width:1.6cm;background:#f0f0f0;}` +
    `.sch .dt td{background:#f7f7f7;}` +
    `.sch th.wk{color:#c00000;}` +
    `</style></head><body><div class="Section1">` +
    `<h2>${month} 月醫師查房</h2>` +
    `${scheduleTable}` +
    `</div></body></html>`;

  const blob = new Blob(['﻿' + html], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${year}年${month}月醫師查房.doc`;
  a.click();
  URL.revokeObjectURL(url);
}
