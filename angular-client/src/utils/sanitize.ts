/**
 * HTML 消毒工具
 * 用於防止 XSS 攻擊，確保使用者輸入的內容安全
 */
import DOMPurify from 'dompurify'

/**
 * 消毒 HTML 字串，移除潛在的惡意程式碼
 * @param dirty - 未經處理的 HTML 字串
 * @returns 消毒後的安全 HTML 字串
 */
export function sanitizeHtml(dirty: string | null | undefined): string {
  if (!dirty) return ''
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: ['span', 'strong', 'em', 'b', 'i', 'br', 'div', 'p'],
    ALLOWED_ATTR: ['class', 'style'],
  })
}

/**
 * 消毒純文字，轉義所有 HTML 特殊字符
 * @param text - 未經處理的文字
 * @returns 轉義後的安全文字
 */
export function escapeHtml(text: string | null | undefined): string {
  if (!text) return ''
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

/**
 * 建立安全的 HTML 標籤
 * @param tag - 標籤名稱
 * @param content - 內容（會被轉義）
 * @param className - CSS class 名稱
 * @returns 安全的 HTML 字串
 */
export function createSafeTag(tag: string, content: string, className: string = ''): string {
  const escapedContent = escapeHtml(content)
  const classAttr = className ? ` class="${escapeHtml(className)}"` : ''
  return `<${tag}${classAttr}>${escapedContent}</${tag}>`
}
