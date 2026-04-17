// 護理相關路由
import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import XLSX from 'xlsx'
import { getDatabase } from '../db/init.js'
import { authenticate, isEditor, isAdmin, logAudit } from '../middleware/auth.js'
import {
  syncEventsToKiditLogbook,
  getKiditLogbook,
  updateKiditEvent,
  updateKiditEvents,
  listKiditLogbooks,
} from '../services/kiditSync.js'

const router = Router()

// Angular 前端使用 PATCH 做部分更新，TPH 後端使用 PUT
router.use((req, res, next) => {
  if (req.method === 'PATCH') {
    req.method = 'PUT'
  }
  next()
})

// ========================================
// 護理工作職責 API
// ========================================

/**
 * GET /api/nursing/duties
 * 取得護理工作職責
 */
router.get('/duties', authenticate, (req, res) => {
  try {
    const db = getDatabase()

    const duties = db.prepare(`SELECT * FROM nursing_duties WHERE id = 'main'`).get()

    if (!duties) {
      return res.json({
        id: 'main',
        duties: {},
      })
    }

    res.json({
      id: duties.id,
      ...JSON.parse(duties.duties || '{}'),
      createdAt: duties.created_at,
      updatedAt: duties.updated_at,
    })
  } catch (error) {
    console.error('取得護理職責錯誤:', error)
    res.status(500).json({
      error: true,
      message: '取得護理職責失敗',
    })
  }
})

/**
 * PUT /api/nursing/duties
 * 更新護理工作職責
 */
router.put('/duties', ...isAdmin, async (req, res) => {
  try {
    const data = req.body
    const db = getDatabase()

    db.prepare(
      `
      INSERT INTO nursing_duties (id, duties, updated_at)
      VALUES ('main', ?, datetime('now', 'localtime'))
      ON CONFLICT(id) DO UPDATE SET
        duties = excluded.duties,
        updated_at = datetime('now', 'localtime')
    `,
    ).run(JSON.stringify(data))


    res.json({
      success: true,
      message: '護理職責已更新',
    })
  } catch (error) {
    console.error('更新護理職責錯誤:', error)
    res.status(500).json({
      error: true,
      message: '更新護理職責失敗',
    })
  }
})

// ========================================
// 護理排班 API
// ========================================

/**
 * GET /api/nursing/schedules
 * 取得護理排班
 */
router.get('/schedules', ...isEditor, (req, res) => {
  try {
    const { id } = req.query
    const db = getDatabase()

    if (id) {
      const schedule = db.prepare(`SELECT * FROM nursing_schedules WHERE id = ?`).get(id)

      if (!schedule) {
        // 返回 null 而不是 404，避免前端出現錯誤訊息
        return res.json(null)
      }

      const scheduleData = JSON.parse(schedule.schedule_data || '{}')
      return res.json({
        id: schedule.id,
        ...scheduleData,
        createdAt: schedule.created_at,
        updatedAt: schedule.updated_at,
      })
    }

    const schedules = db.prepare(`SELECT * FROM nursing_schedules ORDER BY id DESC`).all()

    res.json(
      schedules.map((s) => {
        const scheduleData = JSON.parse(s.schedule_data || '{}')
        return {
          id: s.id,
          ...scheduleData,
          createdAt: s.created_at,
          updatedAt: s.updated_at,
        }
      }),
    )
  } catch (error) {
    console.error('取得護理排班錯誤:', error)
    res.status(500).json({
      error: true,
      message: '取得護理排班失敗',
    })
  }
})

/**
 * PUT /api/nursing/schedules/:id
 * 更新護理排班，並同步護理師姓名到 nurse_assignments
 */
router.put('/schedules/:id', ...isAdmin, async (req, res) => {
  try {
    const { id } = req.params // id 格式: YYYY-MM
    const scheduleData = req.body

    const db = getDatabase()

    // ✅ [修正] 先讀取現有資料，確保 yearMonth、title 等必要欄位不會丟失
    const existingRecord = db.prepare(`SELECT * FROM nursing_schedules WHERE id = ?`).get(id)
    let existingData = {}
    if (existingRecord && existingRecord.schedule_data) {
      existingData = JSON.parse(existingRecord.schedule_data)
    }

    // 合併資料：新資料覆蓋舊資料，但保留舊資料中的必要欄位
    const mergedData = {
      // 保留原有的重要欄位（如果存在的話）
      yearMonth: existingData.yearMonth || id,
      title: existingData.title,
      maxDaysInMonth: existingData.maxDaysInMonth,
      processingOrder: existingData.processingOrder,
      scheduleByWeek: existingData.scheduleByWeek,
      // 合併新資料（會覆蓋上面的欄位如果新資料有提供的話）
      ...scheduleData,
    }

    // 如果 scheduleByNurse 已存在，需要深度合併而不是完全覆蓋
    if (existingData.scheduleByNurse && scheduleData.scheduleByNurse) {
      const mergedScheduleByNurse = { ...existingData.scheduleByNurse }
      for (const nurseId in scheduleData.scheduleByNurse) {
        if (mergedScheduleByNurse[nurseId]) {
          // 合併護理師資料，保留原有的 nurseName、nurseUsername 等
          mergedScheduleByNurse[nurseId] = {
            ...mergedScheduleByNurse[nurseId],
            ...scheduleData.scheduleByNurse[nurseId],
          }
        } else {
          mergedScheduleByNurse[nurseId] = scheduleData.scheduleByNurse[nurseId]
        }
      }
      mergedData.scheduleByNurse = mergedScheduleByNurse
    }

    // 儲存護理班表
    db.prepare(
      `
      INSERT INTO nursing_schedules (id, schedule_data, updated_at)
      VALUES (?, ?, datetime('now', 'localtime'))
      ON CONFLICT(id) DO UPDATE SET
        schedule_data = excluded.schedule_data,
        updated_at = datetime('now', 'localtime')
    `,
    ).run(id, JSON.stringify(mergedData))

    // 🔄 同步護理師姓名到 nurse_assignments
    if (mergedData.scheduleByNurse) {
      console.log(`🔄 [NursingSync] 開始同步護理師姓名到 nurse_assignments...`)
      const syncResult = syncNurseNamesToAssignments(db, id, mergedData.scheduleByNurse)
      console.log(
        `✅ [NursingSync] 同步完成: 更新 ${syncResult.updatedCount} 天，創建 ${syncResult.createdCount} 天`,
      )
    }


    res.json({
      success: true,
      message: '護理排班已更新',
    })
  } catch (error) {
    console.error('更新護理排班錯誤:', error)
    res.status(500).json({
      error: true,
      message: '更新護理排班失敗',
    })
  }
})

/**
 * 同步護理師姓名從 nursing_schedules 到 nurse_assignments
 * @param {Database} db - 資料庫連線
 * @param {string} yearMonth - 年月 (YYYY-MM)
 * @param {Object} scheduleByNurse - 護理師班表資料
 * @returns {Object} - { updatedCount, createdCount }
 */
function syncNurseNamesToAssignments(db, yearMonth, scheduleByNurse) {
  const [year, month] = yearMonth.split('-').map(Number)
  const daysInMonth = new Date(year, month, 0).getDate()

  // 取得今天日期（只同步今天及以後）
  const today = new Date()
  const todayStr = today.toISOString().split('T')[0]

  let updatedCount = 0
  let createdCount = 0

  // 早班班別
  const EARLY_SHIFTS = ['74', '75', '816', '74/L', '84', '815', '7-3', '8-4', '7-5']
  // 晚班班別
  const LATE_SHIFTS = ['311', '3-11', '311C']
  // 非工作班別
  const NON_WORK_SHIFTS = ['休', '例', '國定', '休息', '例假', '']

  // 對每一天進行處理
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${yearMonth}-${String(day).padStart(2, '0')}`
    const dateIndex = day - 1

    // 跳過過去的日期
    if (dateStr < todayStr) {
      continue
    }

    // 產生新的 names 對應
    const newNames = {}
    for (const nurseId in scheduleByNurse) {
      const nurseData = scheduleByNurse[nurseId]
      const shift = String(nurseData.shifts?.[dateIndex] || '').trim()
      const group = String(nurseData.groups?.[dateIndex] || '').trim()

      // 跳過非工作班別或沒有組別
      if (!shift || NON_WORK_SHIFTS.includes(shift) || !group) {
        continue
      }

      // 判斷班別前綴
      let prefix = '早' // 預設早班
      if (LATE_SHIFTS.includes(shift)) {
        prefix = '晚'
      }

      const teamName = `${prefix}${group}`
      newNames[teamName] = nurseData.nurseName
    }

    // 如果沒有任何護理師分配，跳過
    if (Object.keys(newNames).length === 0) {
      continue
    }

    // 檢查是否已存在 nurse_assignments 記錄
    const existing = db
      .prepare(
        `
      SELECT * FROM nurse_assignments WHERE date = ?
    `,
      )
      .get(dateStr)

    if (existing) {
      // 更新現有記錄的 names，保留 teams
      const existingData = JSON.parse(existing.teams || '{}')
      const existingTeams = existingData.teams || existingData // 兼容舊格式
      const existingTakeoffEnabled = existingData.takeoffEnabled || false

      const updatedData = {
        teams: existingTeams,
        names: newNames,
        takeoffEnabled: existingTakeoffEnabled,
      }

      db.prepare(
        `
        UPDATE nurse_assignments
        SET teams = ?, updated_at = datetime('now', 'localtime')
        WHERE date = ?
      `,
      ).run(JSON.stringify(updatedData), dateStr)

      updatedCount++
    } else {
      // 創建新記錄
      const newData = {
        teams: {},
        names: newNames,
        takeoffEnabled: false,
      }

      db.prepare(
        `
        INSERT INTO nurse_assignments (id, date, teams, created_at, updated_at)
        VALUES (?, ?, ?, datetime('now', 'localtime'), datetime('now', 'localtime'))
      `,
      ).run(dateStr, dateStr, JSON.stringify(newData))

      createdCount++
    }
  }

  return { updatedCount, createdCount }
}

/**
 * POST /api/nursing/schedules/upload (或 /save-schedule)
 * 上傳並解析護理班表 Excel
 */
async function handleNursingScheduleUpload(req, res) {
  try {
    const { fileContentBase64, fileName } = req.body

    if (!fileContentBase64 || !fileName) {
      return res.status(400).json({
        error: true,
        message: '缺少檔案內容或檔名',
      })
    }

    console.log(`📤 開始處理班表檔案: ${fileName}`)

    // 1. 解析 Excel
    const fileBuffer = Buffer.from(fileContentBase64, 'base64')
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' })
    const worksheet = workbook.Sheets[workbook.SheetNames[0]]
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 })

    console.log(`📊 Excel 解析完成，共 ${jsonData.length} 行資料`)

    if (!jsonData || jsonData.length < 1) {
      return res.status(400).json({
        error: true,
        message: 'Excel 檔案內容不足，請確認檔案格式正確',
      })
    }

    // 2. 提取年月標題
    let title = ''
    let year, month, yearMonth
    let titleFound = false

    for (let rowIndex = 0; rowIndex < Math.min(jsonData.length, 10); rowIndex++) {
      const row = jsonData[rowIndex]
      if (!row) continue

      for (let cellIndex = 0; cellIndex < Math.min(row.length, 10); cellIndex++) {
        const cell = row[cellIndex]

        if (cell && typeof cell === 'string') {
          const match = cell.match(/(\d{3,4})\s*年\s*(\d{1,2})\s*月(份)?/)
          if (match) {
            title = cell.trim()
            let rawYear = parseInt(match[1], 10)
            year = rawYear < 1911 ? rawYear + 1911 : rawYear
            month = String(match[2]).padStart(2, '0')
            yearMonth = `${year}-${month}`
            console.log(`📅 找到年月標題: ${title} => ${yearMonth}`)
            titleFound = true
            break
          }
        }
      }
      if (titleFound) break
    }

    if (!yearMonth) {
      return res.status(400).json({
        error: true,
        message:
          '無法在 Excel 檔案的前 10 行中找到有效的年月標題 (格式應包含 "XXX年YY月" 或 "XXX年YY月份")',
      })
    }

    const maxDaysInMonth = new Date(year, parseInt(month, 10), 0).getDate()
    console.log(`📆 ${yearMonth} 共有 ${maxDaysInMonth} 天`)

    // 3. 取得護理師列表
    const db = getDatabase()
    const users = db.prepare(`SELECT * FROM users WHERE title = '護理師'`).all()

    const nurseMap = new Map()
    const nurseDataMap = new Map()

    users.forEach((user) => {
      nurseMap.set(user.name, user.id)
      nurseDataMap.set(user.id, {
        name: user.name,
        username: user.username || '',
      })
    })
    console.log(`👩‍⚕️ 資料庫中有 ${nurseMap.size} 位護理師`)

    // 4. 找到護理師資料起始行
    let nurseStartRow = -1
    for (let i = 2; i < Math.min(jsonData.length, 20); i++) {
      const firstCell = String(jsonData[i]?.[0] || '').trim()
      if (!firstCell) continue
      for (const fullName of nurseMap.keys()) {
        if (fullName.endsWith(firstCell)) {
          nurseStartRow = i
          console.log(`📍 找到第一位護理師 "${firstCell}" 在第 ${i} 行`)
          break
        }
      }
      if (nurseStartRow !== -1) break
    }

    if (nurseStartRow === -1) {
      return res.status(400).json({
        error: true,
        message: '找不到護理師資料，請確認 Excel 格式或確認資料庫中有護理師資料',
      })
    }

    // 5. 解析班表資料
    const scheduleByNurse = {}
    const scheduleByWeek = {}
    const processedNurses = new Set()
    const processingOrder = []
    const EARLY_SHIFTS = ['74', '75', '84', '74/L', '816', '815', '7-3', '8-4', '7-5']
    const LATE_SHIFTS = ['3-11', '311']

    for (let rowIndex = nurseStartRow; rowIndex < jsonData.length; rowIndex++) {
      const row = jsonData[rowIndex]
      if (!row || !row[0]) continue

      const nurseFirstName = String(row[0]).trim()
      if (
        !nurseFirstName ||
        ['COUNT', '合計', '總計', '例假', '備註'].some((kw) => nurseFirstName.includes(kw))
      ) {
        continue
      }

      let matchedFullName = null,
        matchedId = null
      for (const [fullName, id] of nurseMap.entries()) {
        if (fullName && fullName.endsWith(nurseFirstName)) {
          matchedFullName = fullName
          matchedId = id
          break
        }
      }

      if (!matchedFullName) {
        console.log(`⚠️ 第 ${rowIndex} 行: 未匹配的名字 "${nurseFirstName}"`)
        continue
      }

      if (processedNurses.has(matchedId)) {
        console.log(`⚠️ 第 ${rowIndex} 行: 護理師 "${matchedFullName}" 已處理過，跳過`)
        continue
      }

      const shifts = new Array(maxDaysInMonth).fill('')
      for (let day = 1; day <= maxDaysInMonth; day++) {
        const columnIndex = day
        if (columnIndex < row.length) {
          const shift = String(row[columnIndex] || '').trim()
          if (shift) shifts[day - 1] = shift
        }
      }

      const nurseData = nurseDataMap.get(matchedId)
      scheduleByNurse[matchedId] = {
        nurseName: matchedFullName,
        nurseUsername: nurseData?.username || '',
        orderIndex: processingOrder.length,
        shifts: shifts,
      }
      processingOrder.push(matchedId)
      processedNurses.add(matchedId)

      // 建立按週分組的資料
      shifts.forEach((shift, index) => {
        if (!shift) return
        const day = index + 1
        let type = null
        if (EARLY_SHIFTS.some((s) => shift.includes(s))) type = 'early'
        else if (LATE_SHIFTS.some((s) => shift.includes(s))) type = 'late'

        if (type) {
          const date = new Date(year, parseInt(month, 10) - 1, day)
          const dayOfWeek = (date.getDay() + 6) % 7
          const weekNumber = Math.ceil(day / 7)
          if (!scheduleByWeek[weekNumber]) scheduleByWeek[weekNumber] = {}
          if (!scheduleByWeek[weekNumber][dayOfWeek]) {
            scheduleByWeek[weekNumber][dayOfWeek] = { early: [], late: [] }
          }
          scheduleByWeek[weekNumber][dayOfWeek][type].push({
            id: matchedId,
            name: matchedFullName,
            username: nurseData?.username || '',
            shift: shift,
          })
        }
      })
    }

    if (processedNurses.size === 0) {
      return res.status(400).json({
        error: true,
        message: '沒有找到任何可處理的護理師資料',
      })
    }

    // 6. 儲存到資料庫
    const dataToSave = {
      title,
      yearMonth,
      maxDaysInMonth,
      scheduleByNurse,
      scheduleByWeek,
      processingOrder,
      lastUpdatedAt: new Date().toISOString(),
      updatedBy: { uid: req.user.id, name: req.user.name },
    }

    db.prepare(
      `
      INSERT INTO nursing_schedules (id, schedule_data, updated_at)
      VALUES (?, ?, datetime('now', 'localtime'))
      ON CONFLICT(id) DO UPDATE SET
        schedule_data = excluded.schedule_data,
        updated_at = datetime('now', 'localtime')
    `,
    ).run(yearMonth, JSON.stringify(dataToSave))

    // 🔄 同步護理師姓名到 nurse_assignments
    console.log(`🔄 [NursingSync] 開始同步護理師姓名到 nurse_assignments...`)
    const syncResult = syncNurseNamesToAssignments(db, yearMonth, scheduleByNurse)
    console.log(
      `✅ [NursingSync] 同步完成: 更新 ${syncResult.updatedCount} 天，創建 ${syncResult.createdCount} 天`,
    )


    const nurseList = Object.values(scheduleByNurse)
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((n) => n.nurseName)
      .join(', ')

    console.log(`✅ 班表 ${yearMonth} 已成功儲存，共 ${processedNurses.size} 位護理師`)

    await logAudit(
      'NURSING_SCHEDULE_UPLOAD',
      req.user.id,
      req.user.name,
      'nursing_schedules',
      yearMonth,
      {
        fileName,
        nurseCount: processedNurses.size,
      },
    )

    res.json({
      success: true,
      documentId: yearMonth,
      title: title,
      nurseCount: processedNurses.size,
      message: `班表 ${yearMonth} 已成功儲存，包含 ${processedNurses.size} 位護理師的完整資料。`,
      stats: {
        month: yearMonth,
        nurseCount: processedNurses.size,
        daysInMonth: maxDaysInMonth,
        nurses: nurseList,
      },
    })
  } catch (error) {
    console.error('上傳護理班表錯誤:', error)
    res.status(500).json({
      error: true,
      message: error.message || '上傳班表時發生錯誤',
    })
  }
}
router.post('/schedules/upload', ...isAdmin, handleNursingScheduleUpload)
router.post('/save-schedule', ...isAdmin, handleNursingScheduleUpload)

/**
 * POST /api/nursing/schedules/sync-names
 * 手動同步所有護理班表的護理師姓名到 nurse_assignments
 * 用於初始化或修復同步
 */
router.post('/schedules/sync-names', ...isAdmin, async (req, res) => {
  try {
    const db = getDatabase()

    // 取得所有護理班表
    const schedules = db.prepare(`SELECT * FROM nursing_schedules`).all()

    if (schedules.length === 0) {
      return res.json({
        success: true,
        message: '沒有護理班表需要同步',
        totalUpdated: 0,
        totalCreated: 0,
      })
    }

    let totalUpdated = 0
    let totalCreated = 0

    for (const schedule of schedules) {
      const scheduleData = JSON.parse(schedule.schedule_data || '{}')
      if (scheduleData.scheduleByNurse) {
        console.log(`🔄 [NursingSync] 同步 ${schedule.id} 的護理師姓名...`)
        const result = syncNurseNamesToAssignments(db, schedule.id, scheduleData.scheduleByNurse)
        totalUpdated += result.updatedCount
        totalCreated += result.createdCount
      }
    }


    console.log(`✅ [NursingSync] 全部同步完成: 更新 ${totalUpdated} 天，創建 ${totalCreated} 天`)

    await logAudit(
      'NURSING_SCHEDULE_SYNC',
      req.user.id,
      req.user.name,
      'nursing_schedules',
      'all',
      {
        schedulesCount: schedules.length,
        totalUpdated,
        totalCreated,
      },
    )

    res.json({
      success: true,
      message: `已同步 ${schedules.length} 份護理班表`,
      schedulesCount: schedules.length,
      totalUpdated,
      totalCreated,
    })
  } catch (error) {
    console.error('同步護理師姓名錯誤:', error)
    res.status(500).json({
      error: true,
      message: error.message || '同步失敗',
    })
  }
})

// ========================================
// 護理組別配置 API
// ========================================

/**
 * GET /api/nursing/group-config
 * 取得護理組別配置
 */
router.get('/group-config', authenticate, (req, res) => {
  try {
    const db = getDatabase()

    const configs = db.prepare(`SELECT * FROM nursing_group_config`).all()

    // 回傳格式：將 config 內容展開到頂層，保留 id 和時間戳記
    res.json(
      configs.map((c) => {
        const configData = JSON.parse(c.config || '{}')
        return {
          id: c.id,
          ...configData, // 展開配置內容到頂層
          createdAt: c.created_at,
          updatedAt: c.updated_at,
        }
      }),
    )
  } catch (error) {
    console.error('取得組別配置錯誤:', error)
    res.status(500).json({
      error: true,
      message: '取得組別配置失敗',
    })
  }
})

/**
 * PUT /api/nursing/group-config/:id
 * 更新護理組別配置
 */
router.put('/group-config/:id', ...isAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const config = req.body

    console.log(`📝 [GroupConfig] 收到更新請求: ${id}`)

    const db = getDatabase()

    db.prepare(
      `
      INSERT INTO nursing_group_config (id, config, updated_at)
      VALUES (?, ?, datetime('now', 'localtime'))
      ON CONFLICT(id) DO UPDATE SET
        config = excluded.config,
        updated_at = datetime('now', 'localtime')
    `,
    ).run(id, JSON.stringify(config))


    console.log(`✅ [GroupConfig] 已儲存配置: ${id}`)

    res.json({
      success: true,
      message: '組別配置已更新',
    })
  } catch (error) {
    console.error('更新組別配置錯誤:', error)
    res.status(500).json({
      error: true,
      message: '更新組別配置失敗',
    })
  }
})

// ========================================
// 交班日誌 API
// ========================================

/**
 * GET /api/nursing/handover-logs
 * 取得交班日誌 (返回最新一筆或指定條件)
 */
router.get('/handover-logs', authenticate, (req, res) => {
  try {
    const { limit } = req.query
    const db = getDatabase()

    let query = 'SELECT * FROM handover_logs ORDER BY updated_at DESC, created_at DESC'
    if (limit) {
      query += ` LIMIT ${parseInt(limit, 10)}`
    }

    const logs = db.prepare(query).all()

    res.json(
      logs.map((l) => ({
        id: l.id,
        content: l.content,
        updatedBy: JSON.parse(l.updated_by || '{}'),
        updatedAt: l.updated_at,
        sourceDate: l.source_date,
        createdAt: l.created_at,
      })),
    )
  } catch (error) {
    console.error('取得交班日誌錯誤:', error)
    res.status(500).json({
      error: true,
      message: '取得交班日誌失敗',
    })
  }
})

/**
 * POST /api/nursing/handover-logs
 * 儲存交班日誌 (使用 upsert 邏輯 - 只保留最新一筆)
 */
router.post('/handover-logs', ...isEditor, async (req, res) => {
  try {
    const { content, updatedBy, updatedAt, sourceDate } = req.body

    const db = getDatabase()

    // 使用固定 ID 'latest' 來實現只保留一筆最新記錄
    const existingLog = db.prepare(`SELECT id FROM handover_logs LIMIT 1`).get()

    if (existingLog) {
      // 更新現有記錄
      db.prepare(
        `
        UPDATE handover_logs
        SET content = ?, updated_by = ?, updated_at = ?, source_date = ?
        WHERE id = ?
      `,
      ).run(
        content,
        JSON.stringify(updatedBy || { uid: req.user.id, name: req.user.name }),
        updatedAt || new Date().toISOString(),
        sourceDate,
        existingLog.id,
      )
    } else {
      // 新增記錄
      const id = uuidv4()
      db.prepare(
        `
        INSERT INTO handover_logs (id, content, updated_by, updated_at, source_date)
        VALUES (?, ?, ?, ?, ?)
      `,
      ).run(
        id,
        content,
        JSON.stringify(updatedBy || { uid: req.user.id, name: req.user.name }),
        updatedAt || new Date().toISOString(),
        sourceDate,
      )
    }


    res.status(201).json({
      success: true,
    })
  } catch (error) {
    console.error('儲存交班日誌錯誤:', error)
    res.status(500).json({
      error: true,
      message: '儲存交班日誌失敗',
    })
  }
})

/**
 * GET /api/nursing/handover-logs/latest
 * 取得最新交班日誌 (對應 Firebase 的 handover_logs/latest)
 */
router.get('/handover-logs/latest', authenticate, (req, res) => {
  try {
    const db = getDatabase()

    const log = db.prepare(`SELECT * FROM handover_logs WHERE id = 'latest'`).get()

    if (!log) {
      return res.json({
        id: 'latest',
        content: '',
        updatedBy: null,
        updatedAt: null,
        sourceDate: null,
      })
    }

    res.json({
      id: log.id,
      content: log.content,
      updatedBy: JSON.parse(log.created_by || '{}'), // 使用 created_by 欄位儲存 updatedBy
      updatedAt: log.updated_at,
      sourceDate: log.date, // 使用 date 欄位儲存 sourceDate
    })
  } catch (error) {
    console.error('取得最新交班日誌錯誤:', error)
    res.status(500).json({
      error: true,
      message: '取得最新交班日誌失敗',
    })
  }
})

/**
 * PUT /api/nursing/handover-logs/latest
 * 儲存/更新最新交班日誌 (對應 Firebase 的 handover_logs/latest)
 */
router.put('/handover-logs/latest', ...isEditor, async (req, res) => {
  try {
    const { content, updatedBy, updatedAt, sourceDate } = req.body

    const db = getDatabase()

    // 使用現有欄位：created_by 存 updatedBy，date 存 sourceDate
    db.prepare(
      `
      INSERT INTO handover_logs (id, date, content, created_by, updated_at)
      VALUES ('latest', ?, ?, ?, datetime('now', 'localtime'))
      ON CONFLICT(id) DO UPDATE SET
        date = excluded.date,
        content = excluded.content,
        created_by = excluded.created_by,
        updated_at = datetime('now', 'localtime')
    `,
    ).run(
      sourceDate || new Date().toISOString().split('T')[0],
      content || '',
      JSON.stringify(updatedBy || {}),
    )


    res.json({
      success: true,
      message: '交班日誌已儲存',
    })
  } catch (error) {
    console.error('儲存最新交班日誌錯誤:', error)
    res.status(500).json({
      error: true,
      message: '儲存最新交班日誌失敗',
    })
  }
})

/**
 * PUT /api/nursing/handover-logs/:id
 * 更新交班日誌
 */
router.put('/handover-logs/:id', ...isEditor, async (req, res) => {
  try {
    const { id } = req.params
    const { content, items } = req.body

    const db = getDatabase()

    db.prepare(
      `
      UPDATE handover_logs
      SET content = ?, items = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `,
    ).run(content, JSON.stringify(items || []), id)


    res.json({
      success: true,
      message: '交班日誌已更新',
    })
  } catch (error) {
    console.error('更新交班日誌錯誤:', error)
    res.status(500).json({
      error: true,
      message: '更新交班日誌失敗',
    })
  }
})

// ========================================
// 每日工作日誌 API
// ========================================

/**
 * GET /api/nursing/daily-logs/:date
 * 取得特定日期的工作日誌
 */
router.get('/daily-logs/:date', authenticate, (req, res) => {
  try {
    const { date } = req.params
    const db = getDatabase()

    const log = db.prepare(`SELECT * FROM daily_logs WHERE date = ?`).get(date)

    if (!log) {
      // 返回預設結構，標記為新建
      return res.json({
        id: date,
        date,
        isNew: true, // 標記這是新的日誌，前端應該從排程計算統計
        patientMovements: [],
        vascularAccessLog: [],
        announcements: [],
        stats: {},
        leader: {},
        otherNotes: null,
        notes: null,
      })
    }

    res.json({
      id: log.id,
      date: log.date,
      patientMovements: JSON.parse(log.patient_movements || '[]'),
      vascularAccessLog: JSON.parse(log.vascular_access_log || '[]'),
      announcements: JSON.parse(log.announcements || '[]'),
      stats: JSON.parse(log.stats || '{}'),
      leader: JSON.parse(log.leader || '{}'),
      otherNotes: log.other_notes,
      notes: log.notes,
      createdAt: log.created_at,
      updatedAt: log.updated_at,
    })
  } catch (error) {
    console.error('取得工作日誌錯誤:', error)
    res.status(500).json({
      error: true,
      message: '取得工作日誌失敗',
    })
  }
})

/**
 * PUT /api/nursing/daily-logs/:date
 * 更新每日工作日誌
 */
router.put('/daily-logs/:date', ...isEditor, async (req, res) => {
  try {
    const { date } = req.params
    const { patientMovements, announcements, notes, vascularAccessLog, stats, leader, otherNotes } =
      req.body

    const db = getDatabase()

    // 先查詢是否已有該日紀錄
    const existing = db.prepare('SELECT * FROM daily_logs WHERE date = ?').get(date)

    if (existing) {
      // 已有紀錄：只更新前端有傳送的欄位，未傳送的保留原值
      const setClauses = []
      const params = []

      if (patientMovements !== undefined) {
        setClauses.push('patient_movements = ?')
        params.push(JSON.stringify(patientMovements))
      }
      if (announcements !== undefined) {
        setClauses.push('announcements = ?')
        params.push(JSON.stringify(announcements))
      }
      if (notes !== undefined) {
        setClauses.push('notes = ?')
        const safeNotes = notes == null ? null : typeof notes === 'string' ? notes : JSON.stringify(notes)
        params.push(safeNotes)
      }
      if (vascularAccessLog !== undefined) {
        setClauses.push('vascular_access_log = ?')
        params.push(JSON.stringify(vascularAccessLog))
      }
      if (stats !== undefined) {
        setClauses.push('stats = ?')
        params.push(JSON.stringify(stats))
      }
      if (leader !== undefined) {
        setClauses.push('leader = ?')
        params.push(JSON.stringify(leader))
      }
      if (otherNotes !== undefined) {
        setClauses.push('other_notes = ?')
        const safeOtherNotes = otherNotes == null ? null : typeof otherNotes === 'string' ? otherNotes : JSON.stringify(otherNotes)
        params.push(safeOtherNotes)
      }

      if (setClauses.length > 0) {
        setClauses.push("updated_at = datetime('now', 'localtime')")
        params.push(date)
        db.prepare(`UPDATE daily_logs SET ${setClauses.join(', ')} WHERE date = ?`).run(...params)
      }
    } else {
      // 新紀錄：INSERT，未傳送的欄位使用預設空值
      const safeNotes = notes == null ? null : typeof notes === 'string' ? notes : JSON.stringify(notes)
      const safeOtherNotes = otherNotes == null ? null : typeof otherNotes === 'string' ? otherNotes : JSON.stringify(otherNotes)

      db.prepare(
        `INSERT INTO daily_logs (id, date, patient_movements, announcements, notes, vascular_access_log, stats, leader, other_notes, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))`,
      ).run(
        date,
        date,
        JSON.stringify(patientMovements || []),
        JSON.stringify(announcements || []),
        safeNotes,
        JSON.stringify(vascularAccessLog || []),
        JSON.stringify(stats || {}),
        JSON.stringify(leader || {}),
        safeOtherNotes,
      )
    }

    // 同步到 Kidit 日誌本
    try {
      await syncEventsToKiditLogbook(date, {
        patientMovements: patientMovements || [],
        vascularAccessLog: vascularAccessLog || [],
        createdAt: new Date().toISOString(),
      })
    } catch (syncError) {
      console.error('Kidit 同步失敗 (非致命錯誤):', syncError)
      // 不阻擋主要操作
    }

    res.json({
      success: true,
      message: '工作日誌已更新',
    })
  } catch (error) {
    console.error('更新工作日誌錯誤:', error)
    res.status(500).json({
      error: true,
      message: '更新工作日誌失敗',
    })
  }
})

// ========================================
// Kidit 日誌本 API
// ========================================

/**
 * GET /api/nursing/kidit-logbook/:date
 * 取得特定日期的 Kidit 日誌本
 */
router.get('/kidit-logbook', authenticate, (req, res) => {
  try {
    const { year, month, startDate, endDate } = req.query

    let rangeStart = startDate
    let rangeEnd = endDate

    if (year && month) {
      const start = `${year}-${String(month).padStart(2, '0')}-01`
      const nextDate = new Date(Number(year), Number(month), 1)
      const end = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-01`
      rangeStart = start
      rangeEnd = end
    }

    if (!rangeStart || !rangeEnd) {
      return res
        .status(400)
        .json({ error: true, message: '請提供 year/month 或 startDate 與 endDate' })
    }

    const logbooks = listKiditLogbooks({ startDate: rangeStart, endDate: rangeEnd })
    res.json(logbooks)
  } catch (error) {
    console.error('取得 Kidit 日誌本列表錯誤:', error)
    res.status(500).json({
      error: true,
      message: '取得 Kidit 日誌本列表失敗',
    })
  }
})

/**
 * GET /api/nursing/kidit-logbook/:date
 * 取得特定日期的 Kidit 日誌本
 */
router.get('/kidit-logbook/:date', authenticate, (req, res) => {
  try {
    const { date } = req.params
    const logbook = getKiditLogbook(date)

    res.json(logbook)
  } catch (error) {
    console.error('取得 Kidit 日誌本錯誤:', error)
    res.status(500).json({
      error: true,
      message: '取得 Kidit 日誌本失敗',
    })
  }
})

/**
 * PUT /api/nursing/kidit-logbook/:date/events/:eventId
 * 更新 Kidit 事件狀態 (勾選登記/轉出院所)
 */
router.put('/kidit-logbook/:date/events/:eventId', ...isEditor, async (req, res) => {
  try {
    const { date, eventId } = req.params
    const updates = req.body || {}

    const result = updateKiditEvent(date, eventId, updates)

    res.json({
      success: true,
      message: '事件狀態已更新',
    })
  } catch (error) {
    console.error('更新 Kidit 事件錯誤:', error)
    res.status(500).json({
      error: true,
      message: error.message || '更新 Kidit 事件失敗',
    })
  }
})

/**
 * PUT /api/nursing/kidit-logbook/:date/events
 * 取代整日的 Kidit 事件列表
 */
router.put('/kidit-logbook/:date/events', ...isEditor, (req, res) => {
  try {
    const { date } = req.params
    const { events } = req.body

    const result = updateKiditEvents(date, events || [])

    res.json({
      success: true,
      ...result,
    })
  } catch (error) {
    console.error('更新 Kidit 事件列表錯誤:', error)
    res.status(500).json({
      error: true,
      message: error.message || '更新 Kidit 事件列表失敗',
    })
  }
})

/**
 * POST /api/nursing/kidit-logbook/:date/sync
 * 手動同步 Kidit 日誌本
 */
router.post('/kidit-logbook/:date/sync', ...isEditor, async (req, res) => {
  try {
    const { date } = req.params

    const db = getDatabase()
    const log = db.prepare(`SELECT * FROM daily_logs WHERE date = ?`).get(date)

    if (!log) {
      return res.status(404).json({
        error: true,
        message: '找不到該日期的工作日誌',
      })
    }

    const result = await syncEventsToKiditLogbook(date, {
      patientMovements: JSON.parse(log.patient_movements || '[]'),
      vascularAccessLog: JSON.parse(log.vascular_access_log || '[]'),
      createdAt: log.created_at,
    })

    res.json({
      success: true,
      ...result,
    })
  } catch (error) {
    console.error('同步 Kidit 日誌本錯誤:', error)
    res.status(500).json({
      error: true,
      message: '同步 Kidit 日誌本失敗',
    })
  }
})

export default router
