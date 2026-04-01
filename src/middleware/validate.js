// Input Validation 中介軟體

/**
 * 簡易 input validation middleware
 * @param {Object} schema - { fieldName: { required?, type?, pattern?, maxLength?, enum? } }
 */
export function validate(schema) {
  return (req, res, next) => {
    const errors = []

    for (const [field, rules] of Object.entries(schema)) {
      const value = req.body[field]

      if (rules.required && (value === undefined || value === null || value === '')) {
        errors.push(`${field} 為必填`)
        continue
      }

      if (value === undefined || value === null) continue

      if (rules.type && typeof value !== rules.type) {
        errors.push(`${field} 型別錯誤，預期 ${rules.type}`)
      }

      if (rules.pattern && typeof value === 'string' && !rules.pattern.test(value)) {
        errors.push(`${field} 格式錯誤`)
      }

      if (rules.maxLength && typeof value === 'string' && value.length > rules.maxLength) {
        errors.push(`${field} 超過最大長度 ${rules.maxLength}`)
      }

      if (rules.enum && !rules.enum.includes(value)) {
        errors.push(`${field} 的值不在允許範圍內`)
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        error: true,
        message: errors.join('; '),
        validationErrors: errors,
      })
    }

    next()
  }
}

// 常用的日期格式驗證 pattern
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
export const MONTH_PATTERN = /^\d{4}-\d{2}$/
