/**
 * 密碼重設腳本
 * 將所有使用者密碼重設為預設密碼
 *
 * 使用方式: cd server && node scripts/reset-passwords.cjs
 */

const bcrypt = require('bcryptjs')
const Database = require('better-sqlite3')
const path = require('path')

const DB_PATH = path.resolve(__dirname, '../data/dialysis.db')
const NEW_PASSWORD = '!#%246qsc'

try {
  const db = new Database(DB_PATH)

  // 生成 bcrypt hash
  const hash = bcrypt.hashSync(NEW_PASSWORD, 10)
  console.log('生成的密碼 hash:', hash)

  // 更新所有使用者密碼
  const result = db.prepare('UPDATE users SET password_hash = ?').run(hash)
  console.log(`✅ 已更新 ${result.changes} 位使用者的密碼為 "${NEW_PASSWORD}"`)

  // 顯示使用者列表
  const users = db.prepare('SELECT id, username, name, role FROM users').all()
  console.log('\n使用者列表:')
  users.forEach(u => {
    console.log(`  - ${u.username} (${u.name}) - ${u.role}`)
  })

  db.close()
  console.log(`\n🎉 完成！現在可以使用任何帳號搭配密碼 "${NEW_PASSWORD}" 登入`)
} catch (error) {
  console.error('❌ 錯誤:', error.message)
  process.exit(1)
}
