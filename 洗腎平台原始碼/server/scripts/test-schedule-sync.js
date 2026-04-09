/**
 * 測試排程同步 + 調班整合流程
 * 執行: node --experimental-vm-modules server/scripts/test-schedule-sync.js
 */

import Database from 'better-sqlite3'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { v4 as uuidv4 } from 'uuid'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const DB_PATH = join(__dirname, '../data/dialysis.db')

// 引入排程同步服務
import { syncMasterScheduleToFuture, mergeExceptionsIntoSchedules, initializeFutureSchedules } from '../src/services/scheduleSync.js'

// 輔助函式
function getTaipeiTodayString() {
  return new Date().toLocaleDateString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).replace(/\//g, '-')
}

function formatDateToYYYYMMDD(date) {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getFutureDate(daysFromNow) {
  const todayStr = getTaipeiTodayString()
  const date = new Date(todayStr + 'T00:00:00Z')
  date.setUTCDate(date.getUTCDate() + daysFromNow)
  return formatDateToYYYYMMDD(date)
}

async function runTest() {
  console.log('=' .repeat(60))
  console.log('🧪 開始測試排程同步 + 調班整合流程')
  console.log('=' .repeat(60))

  const db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')

  try {
    // ========================================
    // 步驟 0: 建立測試資料 (如果需要)
    // ========================================
    console.log('\n📊 步驟 0: 檢查並建立測試資料')

    let patientCount = db.prepare('SELECT COUNT(*) as count FROM patients').get()

    if (patientCount.count === 0) {
      console.log('  ⚠️  資料庫是空的，正在建立測試資料...')

      // 建立測試病人
      const testPatients = [
        { id: 'TEST-P001', name: '王小明', status: 'opd', diseases: '[]', mrn: 'MRN001' },
        { id: 'TEST-P002', name: '李小華', status: 'opd', diseases: '["HBV"]', mrn: 'MRN002' },
        { id: 'TEST-P003', name: '張大中', status: 'opd', diseases: '[]', mrn: 'MRN003' },
        { id: 'TEST-P004', name: '陳美麗', status: 'ipd', diseases: '[]', mrn: 'MRN004' },
        { id: 'TEST-P005', name: '林志強', status: 'opd', diseases: '["HCV"]', mrn: 'MRN005' },
      ]

      const insertPatient = db.prepare(`
        INSERT OR IGNORE INTO patients (id, medical_record_number, name, status, diseases, is_deleted, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 0, datetime('now', 'localtime'), datetime('now', 'localtime'))
      `)

      testPatients.forEach(p => {
        insertPatient.run(p.id, p.mrn, p.name, p.status, p.diseases)
      })
      console.log(`  ✅ 已建立 ${testPatients.length} 位測試病人`)

      // 建立總表規則
      const masterRules = {
        'TEST-P001': { patientName: '王小明', freq: '一三五', bedNum: 1, shiftIndex: 0, autoNote: '' },
        'TEST-P002': { patientName: '李小華', freq: '一三五', bedNum: 2, shiftIndex: 0, autoNote: 'B' },
        'TEST-P003': { patientName: '張大中', freq: '二四六', bedNum: 1, shiftIndex: 0, autoNote: '' },
        'TEST-P004': { patientName: '陳美麗', freq: '一四', bedNum: 3, shiftIndex: 1, autoNote: '住 14' },
        'TEST-P005': { patientName: '林志強', freq: '二五', bedNum: 4, shiftIndex: 1, autoNote: 'C 25' },
      }

      db.prepare(`
        INSERT OR REPLACE INTO base_schedules (id, schedule, updated_at)
        VALUES ('MASTER_SCHEDULE', ?, datetime('now', 'localtime'))
      `).run(JSON.stringify(masterRules))
      console.log(`  ✅ 已建立總表規則 (${Object.keys(masterRules).length} 條規則)`)
    }

    // ========================================
    // 步驟 1: 檢查現有資料
    // ========================================
    console.log('\n📊 步驟 1: 檢查現有資料')

    patientCount = db.prepare('SELECT COUNT(*) as count FROM patients').get()
    console.log(`  - 病人數量: ${patientCount.count}`)

    const masterSchedule = db.prepare(`
      SELECT schedule FROM base_schedules WHERE id = 'MASTER_SCHEDULE'
    `).get()

    const masterRules = masterSchedule ? JSON.parse(masterSchedule.schedule || '{}') : {}
    const ruleCount = Object.keys(masterRules).length
    console.log(`  - 總表規則數量: ${ruleCount}`)

    const exceptionCount = db.prepare('SELECT COUNT(*) as count FROM schedule_exceptions').get()
    console.log(`  - 調班申請數量: ${exceptionCount.count}`)

    const scheduleCount = db.prepare('SELECT COUNT(*) as count FROM schedules').get()
    console.log(`  - 每日排程數量: ${scheduleCount.count}`)

    if (ruleCount === 0) {
      console.log('\n⚠️  總表沒有任何規則，無法進行完整測試')
      console.log('   請先在前端設定床位總表後再執行此測試')
      db.close()
      return
    }

    // ========================================
    // 步驟 2: 初始化未來排程 (如果需要)
    // ========================================
    console.log('\n📊 步驟 2: 初始化/同步未來 60 天排程')

    // 挑選一個病人來測試
    const testPatientId = Object.keys(masterRules)[0]
    const testRule = masterRules[testPatientId]
    console.log(`  - 測試病人: ${testRule.patientName} (${testPatientId})`)
    console.log(`    頻率: ${testRule.freq}, 床號: ${testRule.bedNum}, 班別: ${testRule.shiftIndex}`)

    // 先檢查是否有排程
    const existingScheduleCount = db.prepare('SELECT COUNT(*) as count FROM schedules').get()

    if (existingScheduleCount.count === 0) {
      console.log('\n  📦 未找到排程，執行初始化...')
      const initResult = await initializeFutureSchedules({ uid: 'test', name: '測試腳本' })
      console.log(`  ✅ 初始化結果:`)
      console.log(`     - 成功: ${initResult.success}`)
      console.log(`     - 創建: ${initResult.createdCount} 份排程`)
    } else {
      console.log(`  ✅ 已有 ${existingScheduleCount.count} 份排程，跳過初始化`)
    }

    // 測試同步變更 (模擬總表變更)
    console.log('\n  🔄 測試總表變更同步...')
    const beforeRules = { ...masterRules }
    // 模擬變更：修改一位病人的床號
    const afterRules = { ...masterRules }
    afterRules[testPatientId] = {
      ...afterRules[testPatientId],
      manualNote: '(測試變更)'  // 加一個小變更以觸發同步
    }

    const syncResult = await syncMasterScheduleToFuture(
      beforeRules,
      afterRules,
      { uid: 'test', name: '測試腳本' }
    )

    console.log(`  ✅ 同步結果:`)
    console.log(`     - 成功: ${syncResult.success}`)
    console.log(`     - 訊息: ${syncResult.message}`)
    if (syncResult.createdCount !== undefined) {
      console.log(`     - 創建: ${syncResult.createdCount} 份排程`)
    }
    if (syncResult.updatedCount !== undefined) {
      console.log(`     - 更新: ${syncResult.updatedCount} 份排程`)
    }
    if (syncResult.mergedCount !== undefined) {
      console.log(`     - 整合調班: ${syncResult.mergedCount} 天`)
    }

    // ========================================
    // 步驟 3: 檢查未來排程是否正確產生
    // ========================================
    console.log('\n📊 步驟 3: 驗證未來排程')

    const tomorrow = getFutureDate(1)
    const nextWeek = getFutureDate(7)
    const next30Days = getFutureDate(30)

    const checkSchedule = (dateStr) => {
      const row = db.prepare('SELECT schedule FROM schedules WHERE date = ?').get(dateStr)
      if (!row) return null
      return JSON.parse(row.schedule || '{}')
    }

    const tomorrowSchedule = checkSchedule(tomorrow)
    const nextWeekSchedule = checkSchedule(nextWeek)
    const next30Schedule = checkSchedule(next30Days)

    console.log(`  - 明天 (${tomorrow}): ${tomorrowSchedule ? Object.keys(tomorrowSchedule).length + ' 個床位' : '無排程'}`)
    console.log(`  - 下週 (${nextWeek}): ${nextWeekSchedule ? Object.keys(nextWeekSchedule).length + ' 個床位' : '無排程'}`)
    console.log(`  - 30天後 (${next30Days}): ${next30Schedule ? Object.keys(next30Schedule).length + ' 個床位' : '無排程'}`)

    // ========================================
    // 步驟 4: 建立測試調班申請
    // ========================================
    console.log('\n📊 步驟 4: 建立測試調班申請')

    const existingExceptions = db.prepare('SELECT COUNT(*) as count FROM schedule_exceptions').get()

    if (existingExceptions.count === 0) {
      console.log('  ⚠️  沒有調班申請，正在建立測試調班...')

      const moveDate = getFutureDate(3) // 3 天後
      const suspendStart = getFutureDate(5) // 5 天後開始
      const suspendEnd = getFutureDate(7) // 7 天後結束

      // 測試 MOVE 調班
      const moveException = {
        id: uuidv4(),
        type: 'MOVE',
        patientId: 'TEST-P001',
        patientName: '王小明',
        from: { sourceDate: getFutureDate(3), bedNum: 1, shiftCode: 'early' },
        to: { goalDate: getFutureDate(4), bedNum: 5, shiftCode: 'noon' },
        status: 'applied',
      }

      db.prepare(`
        INSERT INTO schedule_exceptions (id, type, patient_id, patient_name, from_data, to_data, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'), datetime('now', 'localtime'))
      `).run(
        moveException.id,
        moveException.type,
        moveException.patientId,
        moveException.patientName,
        JSON.stringify(moveException.from),
        JSON.stringify(moveException.to),
        moveException.status
      )
      console.log(`  ✅ 已建立 MOVE 調班: ${moveException.patientName} 從 ${moveException.from.sourceDate} 移到 ${moveException.to.goalDate}`)

      // 測試 SUSPEND 暫停
      const suspendException = {
        id: uuidv4(),
        type: 'SUSPEND',
        patientId: 'TEST-P002',
        patientName: '李小華',
        startDate: suspendStart,
        endDate: suspendEnd,
        status: 'applied',
      }

      db.prepare(`
        INSERT INTO schedule_exceptions (id, type, patient_id, patient_name, start_date, end_date, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'), datetime('now', 'localtime'))
      `).run(
        suspendException.id,
        suspendException.type,
        suspendException.patientId,
        suspendException.patientName,
        suspendException.startDate,
        suspendException.endDate,
        suspendException.status
      )
      console.log(`  ✅ 已建立 SUSPEND 暫停: ${suspendException.patientName} 從 ${suspendStart} 到 ${suspendEnd}`)

      // 測試 ADD_SESSION 臨時加洗
      const addSessionException = {
        id: uuidv4(),
        type: 'ADD_SESSION',
        patientId: 'TEST-P004',
        patientName: '陳美麗',
        to: { goalDate: getFutureDate(2), bedNum: 6, shiftCode: 'late' },
        status: 'applied',
      }

      db.prepare(`
        INSERT INTO schedule_exceptions (id, type, patient_id, patient_name, to_data, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime'), datetime('now', 'localtime'))
      `).run(
        addSessionException.id,
        addSessionException.type,
        addSessionException.patientId,
        addSessionException.patientName,
        JSON.stringify(addSessionException.to),
        addSessionException.status
      )
      console.log(`  ✅ 已建立 ADD_SESSION 臨時加洗: ${addSessionException.patientName} 在 ${addSessionException.to.goalDate}`)
    }

    // ========================================
    // 步驟 5: 檢查調班申請狀態
    // ========================================
    console.log('\n📊 步驟 5: 檢查調班申請狀態')

    const exceptions = db.prepare(`
      SELECT id, type, status, patient_name,
             from_data, to_data, start_date, end_date, date
      FROM schedule_exceptions
      ORDER BY created_at DESC
      LIMIT 10
    `).all()

    if (exceptions.length === 0) {
      console.log('  ⚠️  目前沒有任何調班申請')
      console.log('     建議：在前端建立一些調班申請後再測試整合功能')
    } else {
      console.log(`  找到 ${exceptions.length} 筆調班申請:`)
      exceptions.forEach((ex, i) => {
        console.log(`  ${i + 1}. [${ex.status}] ${ex.type}: ${ex.patient_name}`)
        if (ex.type === 'MOVE' || ex.type === 'ADD_SESSION') {
          const to = JSON.parse(ex.to_data || '{}')
          console.log(`      目標日期: ${to.goalDate || '未設定'}`)
        } else if (ex.type === 'SUSPEND') {
          console.log(`      期間: ${ex.start_date} ~ ${ex.end_date}`)
        } else if (ex.type === 'SWAP') {
          console.log(`      日期: ${ex.date}`)
        }
      })
    }

    // ========================================
    // 步驟 6: 驗證調班是否整合到排程中
    // ========================================
    console.log('\n📊 步驟 6: 驗證調班整合')

    const appliedExceptions = db.prepare(`
      SELECT id, type, patient_id, patient_name,
             from_data, to_data, start_date, end_date, date
      FROM schedule_exceptions
      WHERE status = 'applied'
    `).all()

    if (appliedExceptions.length === 0) {
      console.log('  ⚠️  沒有已生效的調班申請可供驗證')
    } else {
      console.log(`  驗證 ${appliedExceptions.length} 筆已生效的調班:`)

      for (const ex of appliedExceptions) {
        let targetDate = null
        let expectedKey = null

        if (ex.type === 'MOVE' || ex.type === 'ADD_SESSION') {
          const to = JSON.parse(ex.to_data || '{}')
          targetDate = to.goalDate
          if (to.bedNum && to.shiftCode) {
            const prefix = String(to.bedNum).startsWith('peripheral') ? '' : 'bed-'
            expectedKey = `${prefix}${to.bedNum}-${to.shiftCode}`
          }
        } else if (ex.type === 'SWAP') {
          targetDate = ex.date
        }

        if (targetDate && targetDate >= tomorrow) {
          const schedule = checkSchedule(targetDate)
          if (schedule) {
            if (expectedKey && schedule[expectedKey]) {
              const slot = schedule[expectedKey]
              if (slot.patientId === ex.patient_id || slot.exceptionId === ex.id) {
                console.log(`  ✅ ${ex.patient_name} 的 ${ex.type} 已正確整合到 ${targetDate}`)
              } else {
                console.log(`  ⚠️  ${ex.patient_name} 的 ${ex.type} 在 ${targetDate} 的 ${expectedKey} 位置有其他病人`)
              }
            } else if (ex.type === 'SWAP') {
              // SWAP 類型需要特別檢查
              const hasExceptionId = Object.values(schedule).some(s => s.exceptionId === ex.id)
              if (hasExceptionId) {
                console.log(`  ✅ SWAP ${ex.id} 已正確整合到 ${targetDate}`)
              }
            }
          } else {
            console.log(`  ⚠️  ${targetDate} 沒有排程資料`)
          }
        }
      }
    }

    // ========================================
    // 步驟 7: 測試強制重新整合
    // ========================================
    if (appliedExceptions.length > 0) {
      console.log('\n📊 步驟 7: 測試強制重新整合調班')

      // 載入病人資料
      const patients = db.prepare(`SELECT * FROM patients WHERE is_deleted = 0`).all()
      const patientsMap = new Map()
      patients.forEach(p => patientsMap.set(p.id, p))

      // 計算未來日期
      const futureDates = Array.from({ length: 60 }, (_, i) => getFutureDate(i + 1))

      console.log('  🔄 強制重新整合調班申請...')

      // 這裡需要重新連接資料庫，因為 mergeExceptionsIntoSchedules 內部會開新連線
      db.close()

      const mergeResult = await mergeExceptionsIntoSchedules(
        masterRules,
        futureDates,
        patientsMap,
        { uid: 'test', name: '測試腳本' }
      )

      console.log(`  ✅ 整合結果:`)
      console.log(`     - 成功: ${mergeResult.success}`)
      console.log(`     - 整合天數: ${mergeResult.mergedCount}`)

      // 重新開啟資料庫進行最後檢查
      const db2 = new Database(DB_PATH)

      // 最終驗證
      console.log('\n📊 最終驗證:')
      const finalScheduleCount = db2.prepare('SELECT COUNT(*) as count FROM schedules').get()
      console.log(`  - 總排程數量: ${finalScheduleCount.count}`)

      db2.close()
    } else {
      db.close()
    }

    console.log('\n' + '=' .repeat(60))
    console.log('🎉 測試完成!')
    console.log('=' .repeat(60))

  } catch (error) {
    console.error('\n❌ 測試過程發生錯誤:', error)
    db.close()
    process.exit(1)
  }
}

// 執行測試
runTest().catch(console.error)
