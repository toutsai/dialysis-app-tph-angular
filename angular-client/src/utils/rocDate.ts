// src/utils/rocDate.ts
// 民國 ↔ 西元 生日欄換算（KiDit 建檔表單與病人基本資料頁籤共用）。
// 儲存一律西元 YYYY-MM-DD；民國僅為顯示/輸入格式。匯出端 toRocDate（kiditHelpers）不受影響。

/** 西元 YYYY-MM-DD → 民國顯示（45/08/15）；無法解析回空字串 */
export function isoToRocDisplay(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return '';
  const y = Number(m[1]) - 1911;
  if (y <= 0) return '';
  return `${y}/${m[2]}/${m[3]}`;
}

/**
 * 民國年輸入 → 西元 YYYY-MM-DD。接受「45/08/15」「45.8.15」「45-8-15」「45年8月15日」或連碼「450815」「0450815」。
 * 回傳 null 表示無法辨識（呼叫端保留原值並標錯）；空字串輸入回 ''（＝清空）。
 */
export function rocInputToIso(value: string | null | undefined): string | null {
  const t = String(value || '').trim();
  if (!t) return '';
  let y = 0, mo = 0, d = 0;
  const sep = /^(\d{1,3})[\/.\-年](\d{1,2})[\/.\-月](\d{1,2})日?$/.exec(t);
  if (sep) {
    y = Number(sep[1]); mo = Number(sep[2]); d = Number(sep[3]);
  } else if (/^\d{6,7}$/.test(t)) {
    y = Number(t.slice(0, t.length - 4));
    mo = Number(t.slice(t.length - 4, t.length - 2));
    d = Number(t.slice(t.length - 2));
  }
  if (y >= 1 && y <= 200 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
    const p2 = (n: number) => String(n).padStart(2, '0');
    return `${y + 1911}-${p2(mo)}-${p2(d)}`;
  }
  return null;
}
