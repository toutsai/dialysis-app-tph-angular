// 資料庫備份工具
import { copyFileSync, mkdirSync, existsSync, statSync, readdirSync, unlinkSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { v4 as uuidv4 } from 'uuid'
import { getDatabase } from '../db/init.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// 優先使用環境變數（Electron 打包後會傳入）
const DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/dialysis.db')
// 備份目錄放在資料庫同目錄下的 backups 子目錄
const BACKUP_DIR = process.env.BACKUP_DIR || join(dirname(DB_PATH), 'backups')

// 備份保留數量
const MAX_AUTO_BACKUPS = 30  // 自動備份保留 30 份
const MAX_MANUAL_BACKUPS = 10 // 手動備份保留 10 份

/**
 * 建立資料庫備份
 * @param {string} type - 備份類型: 'auto' 或 'manual'
 * @returns {Promise<string>} - 備份檔案名稱
 */
export async function createBackup(type = 'auto') {
  // 確保備份目錄存在
  if (!existsSync(BACKUP_DIR)) {
    mkdirSync(BACKUP_DIR, { recursive: true })
  }

  // 產生備份檔名
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const backupFileName = `dialysis_${type}_${timestamp}.db`
  const backupPath = join(BACKUP_DIR, backupFileName)

  // 複製資料庫檔案
  copyFileSync(DB_PATH, backupPath)

  // 取得檔案大小
  const stats = statSync(backupPath)

  // 記錄備份歷史
  const db = getDatabase()
  db.prepare(`
    INSERT INTO backup_history (id, backup_file, backup_type, file_size, created_at)
    VALUES (?, ?, ?, ?, datetime('now', 'localtime'))
  `).run(uuidv4(), backupFileName, type, stats.size)

  // 清理舊備份
  await cleanupOldBackups(type)

  console.log(`✅ 備份完成: ${backupFileName}`)
  return backupFileName
}

/**
 * 清理舊備份
 * @param {string} type - 備份類型
 */
async function cleanupOldBackups(type) {
  const maxBackups = type === 'auto' ? MAX_AUTO_BACKUPS : MAX_MANUAL_BACKUPS

  const db = getDatabase()

  // 取得此類型的所有備份，按時間排序
  const backups = db.prepare(`
    SELECT * FROM backup_history
    WHERE backup_type = ?
    ORDER BY created_at DESC
  `).all(type)

  // 刪除超過限制的舊備份
  if (backups.length > maxBackups) {
    const toDelete = backups.slice(maxBackups)

    for (const backup of toDelete) {
      const backupPath = join(BACKUP_DIR, backup.backup_file)

      // 刪除檔案
      if (existsSync(backupPath)) {
        unlinkSync(backupPath)
      }

      // 刪除記錄
      db.prepare(`DELETE FROM backup_history WHERE id = ?`).run(backup.id)

      console.log(`🗑️ 已刪除舊備份: ${backup.backup_file}`)
    }
  }
}

/**
 * 還原備份
 * @param {string} backupFileName - 備份檔案名稱
 */
export async function restoreBackup(backupFileName) {
  const backupPath = join(BACKUP_DIR, backupFileName)

  if (!existsSync(backupPath)) {
    throw new Error(`備份檔案不存在: ${backupFileName}`)
  }

  // 先建立當前資料庫的備份
  await createBackup('auto')

  // 還原備份
  copyFileSync(backupPath, DB_PATH)

  console.log(`✅ 已還原備份: ${backupFileName}`)
}

/**
 * 取得備份列表
 */
export function listBackups() {
  const db = getDatabase()

  const backups = db.prepare(`
    SELECT * FROM backup_history
    ORDER BY created_at DESC
  `).all()

  return backups
}

/**
 * 定時備份排程 (每日自動備份)
 */
export function scheduleAutoBackup() {
  // 計算到午夜的時間
  const now = new Date()
  const night = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0, 0, 0 // 午夜 00:00:00
  )
  const msToMidnight = night.getTime() - now.getTime()

  // 設定午夜執行備份
  setTimeout(async () => {
    await createBackup('auto')
    // 設定每 24 小時執行一次
    setInterval(() => createBackup('auto'), 24 * 60 * 60 * 1000)
  }, msToMidnight)

  console.log(`📅 自動備份排程已設定，下次備份時間: ${night.toLocaleString()}`)
}

// 如果直接執行此檔案，執行手動備份
if (import.meta.url === `file://${process.argv[1]}`) {
  createBackup('manual').then(() => {
    console.log('手動備份完成')
  }).catch(err => {
    console.error('備份失敗:', err)
    process.exit(1)
  })
}
