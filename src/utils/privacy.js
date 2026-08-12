/**
 * 個資遮罩工具
 * 免登入的公開展示端點回傳前必須先在後端遮罩，勿在前端遮（Network 面板看得到原文）。
 */

/**
 * 姓名模糊化：保留首末字、中間以「○」遮罩。
 * 王小明 → 王○明、陳明 → 陳○、歐陽小花 → 歐○○花
 */
export function maskName(name) {
  const value = String(name ?? '').trim()
  if (!value) return ''
  const chars = Array.from(value)
  if (chars.length === 1) return '○'
  if (chars.length === 2) return `${chars[0]}○`
  return `${chars[0]}${'○'.repeat(chars.length - 2)}${chars[chars.length - 1]}`
}
