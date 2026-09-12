export interface PdfBand { top: number; bottom: number; }
export interface PdfSlice { start: number; end: number; }

/** Pixel ranges are half-open: adjacent pages never repeat or omit source pixels. */
export function planPdfSlices(height: number, pageHeight: number, protectedBands: PdfBand[]): PdfSlice[] {
  const total = Math.ceil(height), capacity = Math.floor(pageHeight);
  if (total <= 0 || capacity <= 0) return [];
  const bands = protectedBands.filter(band => band.bottom > band.top && band.bottom - band.top < capacity);
  const pages: PdfSlice[] = [];
  let start = 0;
  while (start < total) {
    let end = Math.min(total, start + capacity);
    if (end < total) {
      let previous: number;
      do {
        previous = end;
        for (const band of bands) {
          if (band.top < end && band.bottom > end && band.top > start) end = Math.min(end, Math.floor(band.top));
        }
      } while (end !== previous);
    }
    // Oversize content can span pages; smaller text-line bands still protect its text.
    if (end <= start) end = Math.min(total, start + capacity);
    pages.push({ start, end }); start = end;
  }
  return pages;
}

export function collectPdfBands(root: HTMLElement, scale: number, capacity: number): PdfBand[] {
  const origin = root.getBoundingClientRect().top;
  const bands: PdfBand[] = [];
  const add = (rect: DOMRect, padding = 1) => {
    if (rect.width > 0 && rect.height > 0) bands.push({ top: (rect.top - origin - padding) * scale, bottom: (rect.bottom - origin + padding) * scale });
  };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (!node.textContent?.trim()) continue;
    const range = document.createRange(); range.selectNodeContents(node);
    for (const rect of Array.from(range.getClientRects())) add(rect);
  }
  for (const element of root.querySelectorAll('tr, .leader-signature-grid, .page-header')) {
    const rect = element.getBoundingClientRect();
    if (rect.height * scale < capacity * .7) add(rect, 2);
  }
  // Use rendered content rather than a guessed gap: a title stays with the
  // first text line, or with the table header and first visible data row.
  for (const element of root.querySelectorAll('h2')) {
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    const section = element.closest('section') || element.parentElement;
    if (!section) continue;
    const content = document.createTreeWalker(section, NodeFilter.SHOW_TEXT);
    let first: Node | null;
    while ((first = content.nextNode())) {
      if (!first.textContent?.trim() || element.contains(first)) continue;
      const range = document.createRange(); range.selectNodeContents(first);
      const line = Array.from(range.getClientRects()).find(candidate => candidate.width > 0 && candidate.height > 0 && candidate.top >= rect.bottom);
      if (!line) continue;
      let bottom = line.bottom;
      const table = first.parentElement?.closest('table');
      if (table) {
        const firstRow = Array.from(table.querySelectorAll('tbody tr')).find(row => {
          const bounds = row.getBoundingClientRect(); return bounds.width > 0 && bounds.height > 0;
        });
        const header = table.querySelector('thead');
        bottom = Math.max(bottom, header?.getBoundingClientRect().bottom || bottom, firstRow?.getBoundingClientRect().bottom || bottom);
      }
      // planPdfSlices intentionally ignores a band taller than a page, while
      // individual line bands above still permit a very tall section to split.
      bands.push({ top: (rect.top - origin - 2) * scale, bottom: (bottom - origin + 2) * scale });
      break;
    }
  }
  return bands;
}
