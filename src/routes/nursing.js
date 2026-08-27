// 護理相關路由
import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import XLSX from 'xlsx'
import { getDatabase } from '../db/init.js'
import { authenticate, isEditor, isAdmin, isContributor, logAudit } from '../middleware/auth.js'
import { getTaipeiTodayString } from '../utils/dateUtils.js'
import {
  syncEventsToKiditLogbook,
  getKiditLogbook,
  updateKiditEvent,
  updateKiditEvents,
  listKiditLogbooks,
} from '../services/kiditSync.js'
import { normalizeDialysisMode } from '../utils/dialysisMode.js'
import {
  upsertPatientBasicProfile,
  mapKiditProfileToBasic,
  mapKiditProfileToKidit,
} from '../services/patientBasicProfile.js'

const router = Router()

function isPastDailyLogDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date < getTaipeiTodayString()
}

function canEditPastDailyLog(user) {
  return user?.role === 'admin'
}

function isDailyLogLockedForUser(date, user) {
  return isPastDailyLogDate(date) && !canEditPastDailyLog(user)
}

function formatDailyLog(log, user = null) {
  return {
    id: log.id,
    date: log.date,
    patientMovements: JSON.parse(log.patient_movements || '[]'),
    vascularAccessLog: JSON.parse(log.vascular_access_log || '[]'),
    announcements: JSON.parse(log.announcements || '[]'),
    stats: JSON.parse(log.stats || '{}'),
    leader: JSON.parse(log.leader || '{}'),
    otherNotes: log.other_notes,
    notes: log.notes,
    isLocked: isDailyLogLockedForUser(log.date, user),
    createdAt: log.created_at,
    updatedAt: log.updated_at,
  }
}

function archiveDailyLogRevision(db, log, user, revisionReason = 'before_update') {
  const id = `dlr_${log.date}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  db.prepare(`
    INSERT INTO daily_log_revisions (
      id, daily_log_id, date, patient_movements, vascular_access_log,
      announcements, notes, other_notes, stats, leader, revision_reason, created_by
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    log.id,
    log.date,
    log.patient_movements || '[]',
    log.vascular_access_log || '[]',
    log.announcements || '[]',
    log.notes,
    log.other_notes,
    log.stats || '{}',
    log.leader || '{}',
    revisionReason,
    JSON.stringify({ uid: user.id, name: user.name }),
  )
}

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
 * GET /api/nursing/schedules/:id
 * 取得單一月份護理排班 (path-style，配合前端 fetchById)
 */
router.get('/schedules/:id', ...isEditor, (req, res) => {
  try {
    const { id } = req.params
    const db = getDatabase()
    const schedule = db.prepare(`SELECT * FROM nursing_schedules WHERE id = ?`).get(id)

    if (!schedule) {
      return res.json(null)
    }

    const scheduleData = JSON.parse(schedule.schedule_data || '{}')
    res.json({
      id: schedule.id,
      ...scheduleData,
      createdAt: schedule.created_at,
      updatedAt: schedule.updated_at,
    })
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
/**
 * 存檔時自動帶入固定組別（816=外圍、74/L=A）：這兩種班別在 UI 沒有組別下拉可手填，
 * 全手動排班（不跑自動分配）或已確認週會漏帶（2026-08 week3 實際發生，曾手動修補）。
 * 只補空白格、不動任何已有值；分組排除名單(excludedNurses)的人不補（與自動分配一致）。
 * 只補今天(台北)以後的日子——過去日期保持實況不改寫歷史，與 nurse_assignments 同步規則一致。
 * 刻意不含 311C：其固定組 C 與夜班字母池共用可能撞手動選的 C，且 UI 本來就可手填。
 * 固定值優先讀當月 nursing_group_config 的 fixedAssignments，查無用預設。
 */
function fillFixedShiftGroups(db, yearMonth, scheduleByNurse) {
  if (!scheduleByNurse) return 0
  let fixed = { '816': '外圍', '74/L': 'A' }
  let excluded = new Set()
  try {
    const cfgRow = db.prepare('SELECT config FROM nursing_group_config WHERE id = ?').get(yearMonth)
    const cfg = JSON.parse(cfgRow?.config || '{}')
    if (cfg?.fixedAssignments) {
      fixed = {
        '816': cfg.fixedAssignments['816'] || '外圍',
        '74/L': cfg.fixedAssignments['74/L'] || 'A',
      }
    }
    if (Array.isArray(cfg?.excludedNurses)) excluded = new Set(cfg.excludedNurses)
  } catch {}

  const today = getTaipeiTodayString() // YYYY-MM-DD
  const todayMonth = today.slice(0, 7)
  if (yearMonth < todayMonth) return 0
  const startIndex = yearMonth === todayMonth ? Number(today.slice(8, 10)) - 1 : 0

  let count = 0
  for (const [nurseId, n] of Object.entries(scheduleByNurse)) {
    if (excluded.has(nurseId) || !n || !Array.isArray(n.shifts)) continue
    if (!Array.isArray(n.groups)) n.groups = []
    for (let i = startIndex; i < n.shifts.length; i++) {
      const g = fixed[String(n.shifts[i] || '').trim()]
      if (!g) continue
      if (!String(n.groups[i] || '').trim()) {
        while (n.groups.length <= i) n.groups.push('')
        n.groups[i] = g
        count++
      }
    }
  }
  return count
}

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

    // 合併資料：以既有文件為底，新資料只覆蓋有帶的欄位（PUT 是部分更新語意）。
    // ⚠️ 2026-08-27 修正：原本只白名單保留 yearMonth/title/... 五欄，
    // 「班別編輯」存檔（只帶 scheduleByNurse）會把 weekConfirmed 整個洗掉，
    // 之後再存某一週就只剩該週「已確認」——前幾週的綠色標記全部消失（實際發生於 2026-08）。
    const mergedData = {
      ...existingData,
      yearMonth: existingData.yearMonth || id,
      ...scheduleData,
    }

    // weekConfirmed 逐鍵合併且只增不減：前端兩條分組存檔路徑會整包送出「頁面載入時」的 map，
    // 若另一位組長在此期間確認了別週（或整月存檔送了 `|| {}` 空物件），整包覆蓋會把它取消。
    // 目前沒有任何 UI 會「取消確認」，所以 true 一律保留。
    if (existingData.weekConfirmed || scheduleData.weekConfirmed) {
      const merged = { ...(existingData.weekConfirmed || {}) }
      for (const [k, v] of Object.entries(scheduleData.weekConfirmed || {})) {
        merged[k] = merged[k] === true || v === true
      }
      mergedData.weekConfirmed = merged
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

    // 自動帶入 816/74L 固定組別（只補空白，見 fillFixedShiftGroups 說明）
    const fixedFilled = fillFixedShiftGroups(db, id, mergedData.scheduleByNurse)
    if (fixedFilled > 0) console.log(`[NursingSchedule] 自動帶入固定組別 ${fixedFilled} 格 (${id})`)

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

  // 取得今天日期（只同步今天及以後；台北時區，勿用 toISOString 以免凌晨差一天）
  const todayStr = getTaipeiTodayString()

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
      // 128 (12:00-20:00) 半早半晚 → 同一人同時寫 早X 與 晚X（月班表分組規則保證字母不與白班/夜班重複；
      // 前端以「早X 與 晚X 同名」辨識 128 組，藉此排除早班病人分配與夜間收針）
      if (shift === '128') {
        newNames[`早${group}`] = nurseData.nurseName
        newNames[`晚${group}`] = nurseData.nurseName
        continue
      }
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
    const LATE_SHIFTS = ['3-11', '311', '128']

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

    // 5b. 重新上傳同月份：沿用既有分組與已確認標記（2026-08-27 使用者裁定選 (a)）
    //   - weekConfirmed 整個沿用（只增不減，與 PUT 合併規則一致）
    //   - 每位護理師「班別沒變」的日子沿用 groups[i] 與 standby75Days；班別變了的格子清空重排
    //   - 新班表沒有的護理師其分組自然消失；新加入的護理師沒有分組
    //   原本整份覆蓋會讓組長月中重傳修正班表後整月分組+綠色標記全部重來
    let existingSchedule = null
    try {
      const prev = db.prepare('SELECT schedule_data FROM nursing_schedules WHERE id = ?').get(yearMonth)
      if (prev?.schedule_data) existingSchedule = JSON.parse(prev.schedule_data)
    } catch (e) {
      console.warn(`[NursingSchedule] 讀取既有 ${yearMonth} 班表失敗，視為首次上傳:`, e.message)
    }
    let carriedGroups = 0
    if (existingSchedule?.scheduleByNurse) {
      for (const [nurseId, n] of Object.entries(scheduleByNurse)) {
        const old = existingSchedule.scheduleByNurse[nurseId]
        if (!old) continue
        const oldShifts = Array.isArray(old.shifts) ? old.shifts : []
        const oldGroups = Array.isArray(old.groups) ? old.groups : []
        const oldStandby = new Set(Array.isArray(old.standby75Days) ? old.standby75Days : [])
        const groups = new Array(maxDaysInMonth).fill('')
        const standby75Days = []
        for (let i = 0; i < maxDaysInMonth; i++) {
          const same = String(n.shifts[i] || '').trim() === String(oldShifts[i] || '').trim()
          if (!same) continue
          if (oldGroups[i]) {
            groups[i] = oldGroups[i]
            carriedGroups++
          }
          if (oldStandby.has(i)) standby75Days.push(i)
        }
        n.groups = groups
        n.standby75Days = standby75Days
      }
    }
    if (carriedGroups > 0) console.log(`[NursingSchedule] 重新上傳沿用既有分組 ${carriedGroups} 格 (${yearMonth})`)

    // 6. 儲存到資料庫
    const dataToSave = {
      title,
      yearMonth,
      maxDaysInMonth,
      scheduleByNurse,
      scheduleByWeek,
      processingOrder,
      ...(existingSchedule?.weekConfirmed ? { weekConfirmed: existingSchedule.weekConfirmed } : {}),
      lastUpdatedAt: new Date().toISOString(),
      updatedBy: { uid: req.user.id, name: req.user.name },
    }

    // 自動帶入 816/74L 固定組別（Excel 匯入通常只有班別沒有組別）
    const fixedFilled = fillFixedShiftGroups(db, yearMonth, scheduleByNurse)
    if (fixedFilled > 0) console.log(`[NursingSchedule] 自動帶入固定組別 ${fixedFilled} 格 (${yearMonth})`)

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
 * GET /api/nursing/group-config/:id
 * 取得單一月份的組別配置 (path-style，配合前端 fetchNursingGroupConfig)
 */
router.get('/group-config/:id', authenticate, (req, res) => {
  try {
    const { id } = req.params
    const db = getDatabase()
    const row = db.prepare(`SELECT * FROM nursing_group_config WHERE id = ?`).get(id)

    if (!row) {
      return res.json(null)
    }

    const configData = JSON.parse(row.config || '{}')
    res.json({
      id: row.id,
      ...configData,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })
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
// 護理師固定照護病人分配 API
// ========================================

/**
 * GET /api/nursing/patient-care
 * 取得護理師照護病人分配（單一 JSON 文件）
 */
router.get('/patient-care', authenticate, (req, res) => {
  try {
    const db = getDatabase()
    const row = db.prepare(`SELECT * FROM nurse_patient_care WHERE id = 'main'`).get()

    if (!row) {
      return res.json({ assignments: [], excludedNurseIds: [], updatedAt: null, updatedBy: null })
    }

    res.json({
      assignments: JSON.parse(row.assignments || '[]'),
      excludedNurseIds: JSON.parse(row.excluded_nurse_ids || '[]'),
      updatedBy: JSON.parse(row.updated_by || '{}'),
      updatedAt: row.updated_at,
    })
  } catch (error) {
    console.error('取得照護分配錯誤:', error)
    res.status(500).json({
      error: true,
      message: '取得照護分配失敗',
    })
  }
})

/**
 * PUT /api/nursing/patient-care
 * 儲存護理師照護病人分配（整份覆蓋）
 */
router.put('/patient-care', ...isAdmin, (req, res) => {
  try {
    const { assignments, excludedNurseIds = [] } = req.body || {}

    if (!Array.isArray(assignments)) {
      return res.status(400).json({ error: true, message: 'assignments 必須是陣列' })
    }
    const invalid = assignments.some(
      (a) => !a || typeof a.nurseId !== 'string' || !Array.isArray(a.patientIds),
    )
    if (invalid) {
      return res
        .status(400)
        .json({ error: true, message: 'assignments 格式錯誤（需含 nurseId 與 patientIds 陣列）' })
    }
    if (
      !Array.isArray(excludedNurseIds) ||
      excludedNurseIds.some((id) => typeof id !== 'string')
    ) {
      return res
        .status(400)
        .json({ error: true, message: 'excludedNurseIds 必須是字串陣列' })
    }

    const db = getDatabase()
    const updatedBy = JSON.stringify({
      uid: req.user?.id || '',
      name: req.user?.name || '',
    })

    db.prepare(
      `
      INSERT INTO nurse_patient_care (id, assignments, excluded_nurse_ids, updated_by, updated_at)
      VALUES ('main', ?, ?, ?, datetime('now', 'localtime'))
      ON CONFLICT(id) DO UPDATE SET
        assignments = excluded.assignments,
        excluded_nurse_ids = excluded.excluded_nurse_ids,
        updated_by = excluded.updated_by,
        updated_at = datetime('now', 'localtime')
    `,
    ).run(JSON.stringify(assignments), JSON.stringify(excludedNurseIds), updatedBy)

    res.json({ success: true, message: '照護分配已儲存' })
  } catch (error) {
    console.error('儲存照護分配錯誤:', error)
    res.status(500).json({
      error: true,
      message: '儲存照護分配失敗',
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
      sourceDate || getTaipeiTodayString(),
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
 * GET /api/nursing/daily-logs
 * 取得工作日誌列表 (供統計報表/護病比使用)，可選 ?startDate&endDate 篩選日期範圍
 */
router.get('/daily-logs', authenticate, (req, res) => {
  try {
    const { startDate, endDate } = req.query
    const db = getDatabase()

    let logs
    if (startDate && endDate) {
      logs = db
        .prepare(`SELECT * FROM daily_logs WHERE date >= ? AND date <= ? ORDER BY date ASC`)
        .all(startDate, endDate)
    } else {
      logs = db.prepare(`SELECT * FROM daily_logs ORDER BY date ASC`).all()
    }

    res.json(logs.map((log) => formatDailyLog(log, req.user)))
  } catch (error) {
    console.error('取得工作日誌列表錯誤:', error)
    res.status(500).json({
      error: true,
      message: '取得工作日誌列表失敗',
    })
  }
})

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
        isLocked: isDailyLogLockedForUser(date, req.user),
      })
    }

    res.json(formatDailyLog(log, req.user))
  } catch (error) {
    console.error('取得工作日誌錯誤:', error)
    res.status(500).json({
      error: true,
      message: '取得工作日誌失敗',
    })
  }
})

/**
 * GET /api/nursing/daily-logs/:date/revisions
 * 取得工作日誌修改快照
 */
router.get('/daily-logs/:date/revisions', authenticate, (req, res) => {
  try {
    const { date } = req.params
    const db = getDatabase()

    const revisions = db
      .prepare(`
        SELECT * FROM daily_log_revisions
        WHERE date = ?
        ORDER BY created_at DESC
      `)
      .all(date)

    res.json(
      revisions.map((revision) => ({
        id: revision.id,
        dailyLogId: revision.daily_log_id,
        date: revision.date,
        patientMovements: JSON.parse(revision.patient_movements || '[]'),
        vascularAccessLog: JSON.parse(revision.vascular_access_log || '[]'),
        announcements: JSON.parse(revision.announcements || '[]'),
        stats: JSON.parse(revision.stats || '{}'),
        leader: JSON.parse(revision.leader || '{}'),
        otherNotes: revision.other_notes,
        notes: revision.notes,
        revisionReason: revision.revision_reason,
        createdBy: JSON.parse(revision.created_by || '{}'),
        createdAt: revision.created_at,
      })),
    )
  } catch (error) {
    console.error('取得工作日誌快照錯誤:', error)
    res.status(500).json({
      error: true,
      message: '取得工作日誌快照失敗',
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

    if (isDailyLogLockedForUser(date, req.user)) {
      return res.status(423).json({
        error: true,
        code: 'DAILY_LOG_LOCKED',
        message: '歷史工作日誌已鎖定，無法修改',
      })
    }

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
        archiveDailyLogRevision(db, existing, req.user, 'before_update')
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

    const saved = db.prepare(`SELECT * FROM daily_logs WHERE date = ?`).get(date)
    const savedLog = formatDailyLog(saved, req.user)

    // 同步到 Kidit 日誌本
    try {
      await syncEventsToKiditLogbook(date, {
        patientMovements: savedLog.patientMovements,
        vascularAccessLog: savedLog.vascularAccessLog,
        createdAt: savedLog.createdAt || new Date().toISOString(),
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

// 待建檔清單排除名單：site_config 單筆 JSON map { patientId: { by, at } }
const KIDIT_PENDING_EXCLUSIONS_ID = 'kidit_pending_exclusions'

function readKiditPendingExclusions(db) {
  const row = db.prepare('SELECT config_data FROM site_config WHERE id = ?').get(KIDIT_PENDING_EXCLUSIONS_ID)
  try {
    const parsed = JSON.parse(row?.config_data || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * PUT /api/nursing/kidit-pending-exclusions/:patientId
 * 待建檔清單排除/復原。body: { excluded: boolean }
 * 排除者仍在清單回傳（excluded=true），由各消費端隱藏；工作站可檢視已排除並復原。
 */
router.put('/kidit-pending-exclusions/:patientId', ...isEditor, (req, res) => {
  try {
    const { patientId } = req.params
    const excluded = !!req.body?.excluded
    const db = getDatabase()
    const map = readKiditPendingExclusions(db)
    if (excluded) {
      map[patientId] = { by: req.user?.name || '', at: new Date().toLocaleString('sv-SE') }
    } else {
      delete map[patientId]
    }
    db.prepare(
      `INSERT INTO site_config (id, config_data, updated_at) VALUES (?, ?, datetime('now','localtime'))
       ON CONFLICT(id) DO UPDATE SET config_data = excluded.config_data, updated_at = datetime('now','localtime')`
    ).run(KIDIT_PENDING_EXCLUSIONS_ID, JSON.stringify(map))
    res.json({ success: true, excluded })
  } catch (error) {
    console.error('更新 KiDit 待建檔排除名單錯誤:', error)
    res.status(500).json({ error: true, message: '更新待建檔排除名單失敗' })
  }
})

/**
 * GET /api/nursing/kidit-pending-registrations
 * KiDit 待建檔清單：勾「本院初透」狀態標記、且 KiDit 基本資料未完整的病人。
 * ⚠️ 2026-08-22 起只認「本院初透」（使用者裁定）：只勾「首透」沒勾「本院初透」者不入列
 *   （首透＝人生第一次透析，正常會連動本院初透；純首透多為舊資料或外院已建檔，KiDit 建檔以本院初透為準）。
 *   舊規則「首透限近 3 個月入列」隨之移除。firstDialysisDate 仍回傳供標記欄顯示「本院初透＋首透」。
 * 完整定義＝任一 KiDit 事件已填 kidit_profile.idNumber、kidit_profile.diagnosisCategory（原發病存於病患資料）
 * 且同事件存過病史表單（kidit_history 物件存在；病史表單本身無原發病欄位）
 * （與前端 isKiDitDataComplete 一致）。回傳含標記日期、缺項、最近事件日期與標記日照顧護理師。
 */
router.get('/kidit-pending-registrations', authenticate, (req, res) => {
  try {
    const db = getDatabase()

    // 1. 找出有「本院初透」標記的病人（排除已刪除）
    const patientRows = db
      .prepare('SELECT id, name, medical_record_number, patient_status, dialysis_orders FROM patients WHERE is_deleted = 0')
      .all()

    const flagged = []
    for (const p of patientRows) {
      let ps
      try {
        ps = JSON.parse(p.patient_status || '{}')
      } catch {
        continue
      }
      const hfd = ps?.hospitalFirstDialysis
      const fd = ps?.isFirstDialysis
      if (!hfd?.active) continue
      let mode = ''
      try {
        const orders = JSON.parse(p.dialysis_orders || '{}')
        if (orders?.mode != null && String(orders.mode).trim()) mode = normalizeDialysisMode(String(orders.mode))
      } catch {}
      flagged.push({
        patientId: p.id,
        name: p.name,
        medicalRecordNumber: p.medical_record_number || '',
        hospitalFirstDialysisDate: hfd?.active ? hfd.date || '' : null,
        firstDialysisDate: fd?.active ? fd.date || '' : null,
        dialysisMode: mode,
      })
    }
    if (flagged.length === 0) return res.json([])

    // 2. 掃 kidit_logbook 彙整每位病人的建檔狀態與最近事件日期
    const logRows = db.prepare('SELECT date, events FROM kidit_logbook ORDER BY date').all()
    const kiditByPatient = new Map()
    for (const row of logRows) {
      let events
      try {
        events = JSON.parse(row.events || '[]')
      } catch {
        continue
      }
      for (const e of events) {
        if (!e?.patientId) continue
        const cur = kiditByPatient.get(e.patientId) || { hasProfile: false, hasHistory: false, complete: false, lastEventDate: null }
        // ⚠️ 原發病(diagnosisCategory)存於 kidit_profile，病史表單無此欄——
        // 舊判定讀 kidit_history.diagnosisCategory 永遠 false，全院從未有人「完成」(2026-08-04 修正)
        if (e.kidit_profile?.idNumber) cur.hasProfile = true
        if (e.kidit_history && e.kidit_profile?.diagnosisCategory) cur.hasHistory = true
        // 完成判定須與前端 isKiDitDataComplete 一致：同一事件內身分證+原發病+病史表單皆有
        if (e.kidit_profile?.idNumber && e.kidit_profile?.diagnosisCategory && e.kidit_history) cur.complete = true
        cur.lastEventDate = row.date
        kiditByPatient.set(e.patientId, cur)
      }
    }

    // 3. 留下未完整者（complete=任一單一事件同時有兩欄，與前端一致）
    const pending = flagged
      .map((f) => {
        const k = kiditByPatient.get(f.patientId)
        return {
          ...f,
          hasProfile: !!k?.hasProfile,
          hasHistory: !!k?.hasHistory,
          complete: !!k?.complete,
          lastEventDate: k?.lastEventDate || null,
        }
      })
      .filter((f) => !f.complete)

    // 4. 反查「第一次接病人的護理師」：標記日（本院初透優先）當天的護理分組，
    //    查無再退最近 KiDit 事件日；格式同 patients.js 未衛教反查（teams/names 巢狀）
    const lookupDates = [
      ...new Set(
        pending
          .flatMap((f) => [f.hospitalFirstDialysisDate || f.firstDialysisDate, f.lastEventDate])
          .filter(Boolean),
      ),
    ]
    const assignByDate = new Map()
    if (lookupDates.length > 0) {
      const placeholders = lookupDates.map(() => '?').join(',')
      const assignRows = db
        .prepare(`SELECT date, teams FROM nurse_assignments WHERE date IN (${placeholders})`)
        .all(...lookupDates)
      for (const a of assignRows) {
        try {
          const raw = JSON.parse(a.teams || '{}')
          assignByDate.set(a.date, { teams: raw.teams || raw, names: raw.names || {} })
        } catch {}
      }
    }
    const lookupNurse = (patientId, date) => {
      if (!date) return null
      const payload = assignByDate.get(date)
      if (!payload) return null
      for (const sh of ['early', 'noon', 'late']) {
        const t = payload.teams?.[`${patientId}-${sh}`]
        const team = t?.nurseTeam || t?.nurseTeamIn || t?.nurseTeamOut || ''
        if (team) return { team, nurse: payload.names?.[team] || '', date }
      }
      return null
    }
    for (const f of pending) {
      const flagDate = f.hospitalFirstDialysisDate || f.firstDialysisDate
      f.firstNurse = lookupNurse(f.patientId, flagDate) || lookupNurse(f.patientId, f.lastEventDate) || null
    }

    // 5. 附上排除旗標（不在後端過濾：工作站要能檢視已排除者並復原，其他消費端自行隱藏）
    const exclusions = readKiditPendingExclusions(db)
    for (const f of pending) {
      const ex = exclusions[f.patientId]
      f.excluded = !!ex
      f.excludedBy = ex?.by || null
      f.excludedAt = ex?.at || null
    }

    // 標記日期新 → 舊（使用者指定）
    pending.sort((a, b) =>
      String(b.hospitalFirstDialysisDate || b.firstDialysisDate || '').localeCompare(
        String(a.hospitalFirstDialysisDate || a.firstDialysisDate || ''),
      ),
    )
    res.json(pending)
  } catch (error) {
    console.error('取得 KiDit 待建檔清單錯誤:', error)
    res.status(500).json({ error: true, message: '取得 KiDit 待建檔清單失敗' })
  }
})

/**
 * GET /api/nursing/kidit-monthly-basic-data?month=YYYY-MM
 * 每月基本資料彙整：該月標記「本院初透」的病人（含已刪除，與初次透析名單同語意）
 * × KiDit 建檔基本資料（kidit_profile/kidit_history 各取最新一筆）。
 * 未建檔者也回傳（hasProfile/hasHistory/complete 皆 false），供比對是否漏存。
 */
router.get('/kidit-monthly-basic-data', authenticate, (req, res) => {
  try {
    const month = String(req.query.month || '')
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: true, message: 'month 需為 YYYY-MM 格式' })
    }
    const db = getDatabase()

    const patientRows = db
      .prepare('SELECT id, name, medical_record_number, patient_status, is_deleted FROM patients')
      .all()
    // 先收全部標記者（不分月），歸月要等建檔資料補上日期 fallback 後才能判斷
    const flagged = []
    for (const p of patientRows) {
      let ps
      try {
        ps = JSON.parse(p.patient_status || '{}')
      } catch {
        continue
      }
      const hfd = ps?.hospitalFirstDialysis
      if (!hfd?.active) continue
      flagged.push({
        patientId: p.id,
        name: p.name,
        medicalRecordNumber: p.medical_record_number || '',
        hospitalFirstDialysisDate: String(hfd.date || ''),
        isDeleted: !!p.is_deleted,
      })
    }
    if (flagged.length === 0) return res.json([])

    // 建檔可能發生在任何日期，掃全部 logbook（同 kidit-pending-registrations）
    const idSet = new Set(flagged.map((f) => f.patientId))
    const logRows = db.prepare('SELECT date, events FROM kidit_logbook ORDER BY date').all()
    const dataByPatient = new Map()
    for (const row of logRows) {
      let events
      try {
        events = JSON.parse(row.events || '[]')
      } catch {
        continue
      }
      for (const e of events) {
        if (!e?.patientId || !idSet.has(e.patientId)) continue
        const cur =
          dataByPatient.get(e.patientId) ||
          { profile: null, history: null, profileDate: null, historyDate: null, complete: false,
            profileSavedBy: null, profileSavedAt: null, lastEventDate: null }
        cur.lastEventDate = row.date
        if (e.kidit_profile?.idNumber) {
          cur.profile = e.kidit_profile
          cur.profileDate = row.date
          // 建檔者/建檔時間＝事件層戳記（PUT events 時後端比對蓋章）；舊資料無戳記回 null
          cur.profileSavedBy = e.kidit_profile_saved_by || null
          cur.profileSavedAt = e.kidit_profile_saved_at || null
        }
        // 原發病存於 kidit_profile（病史表單無此欄），病史以「存過病史表單且有內容」認定（2026-08-04 修正）
        if (e.kidit_history && Object.keys(e.kidit_history).length > 0) {
          cur.history = e.kidit_history
          cur.historyDate = row.date
        }
        // 完成判定與 kidit-pending-registrations／前端 isKiDitDataComplete 一致
        if (e.kidit_profile?.idNumber && e.kidit_profile?.diagnosisCategory && e.kidit_history) cur.complete = true
        dataByPatient.set(e.patientId, cur)
      }
    }

    // 歸月：本院初透日優先；未填日期者（曾實際發生：標記 active 但 date=null）
    // 退用建檔基本資料的「本院開始治療日期」，再退建檔儲存日，避免永遠不出現在任何月份
    const rows = flagged
      .map((f) => {
        const k = dataByPatient.get(f.patientId)
        const effectiveDate =
          f.hospitalFirstDialysisDate ||
          String(k?.profile?.hospitalStartDate || '') ||
          String(k?.profileDate || '')
        return {
          ...f,
          effectiveDate,
          dateMissing: !f.hospitalFirstDialysisDate,
          hasProfile: !!k?.profile,
          hasHistory: !!k?.history,
          complete: !!k?.complete,
          profileDate: k?.profileDate || null,
          historyDate: k?.historyDate || null,
          profileSavedBy: k?.profileSavedBy || null,
          profileSavedAt: k?.profileSavedAt || null,
          profile: k?.profile || null,
          history: k?.history || null,
          // 清單點擊直達建檔用：建檔事件日優先（編輯既有建檔），否則最近事件日（從頭建檔）
          lastEventDate: k?.profileDate || k?.historyDate || k?.lastEventDate || null,
        }
      })
      .filter((r) => r.effectiveDate.startsWith(month))
    rows.sort((a, b) => String(a.effectiveDate).localeCompare(String(b.effectiveDate)))
    res.json(rows)
  } catch (error) {
    console.error('取得每月基本資料彙整錯誤:', error)
    res.status(500).json({ error: true, message: '取得每月基本資料彙整失敗' })
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

    // 單事件更新若帶 kidit_profile，與 DB 現況比對後回寫病人基本資料（同整包路徑）
    let profileChanged = null
    if (updates.kidit_profile && typeof updates.kidit_profile === 'object') {
      try {
        const db = getDatabase()
        const row = db.prepare('SELECT events FROM kidit_logbook WHERE date = ?').get(date)
        const old = (JSON.parse(row?.events || '[]') || []).find((e) => e?.id === eventId)
        if (old?.patientId && JSON.stringify(updates.kidit_profile) !== JSON.stringify(old.kidit_profile ?? null)) {
          profileChanged = { patientId: old.patientId, profile: updates.kidit_profile }
        }
      } catch {}
    }

    const result = updateKiditEvent(date, eventId, updates)

    if (profileChanged) syncBasicProfileFromKidit([profileChanged], req.user)

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
 * 建檔者/建檔時間戳記：與 DB 現況逐事件比對，kidit_profile/kidit_history 有變動的事件
 * 蓋上事件層 `<欄位>_saved_by` / `<欄位>_saved_at`；未變動者沿用 DB 既有戳記
 * （前端是整包 events 覆寫，戳記不能信任 client 回傳）。鍵在事件層而非 kidit_profile 內，
 * 官方 CSV 匯出（逐欄取值）不受影響；kiditSync 重建以 {...existing, ...current} 合併會保留。
 */
function stampKiditSavedMeta(date, events, user) {
  const db = getDatabase()
  const row = db.prepare('SELECT events FROM kidit_logbook WHERE date = ?').get(date)
  let oldEvents = []
  try {
    oldEvents = JSON.parse(row?.events || '[]')
  } catch {}
  const oldById = new Map(oldEvents.filter((e) => e?.id).map((e) => [e.id, e]))
  const now = new Date().toLocaleString('sv-SE')
  const changedProfiles = []
  for (const e of events) {
    if (!e || !e.id) continue
    const old = oldById.get(e.id)
    for (const field of ['kidit_profile', 'kidit_history']) {
      const byKey = `${field}_saved_by`
      const atKey = `${field}_saved_at`
      if (e[field] && JSON.stringify(e[field]) !== JSON.stringify(old?.[field] ?? null)) {
        e[byKey] = user?.name || ''
        e[atKey] = now
        if (field === 'kidit_profile' && e.patientId) {
          changedProfiles.push({ patientId: e.patientId, profile: e.kidit_profile })
        }
      } else {
        if (old?.[byKey] != null) e[byKey] = old[byKey]
        if (old?.[atKey] != null) e[atKey] = old[atKey]
      }
    }
  }
  return { events, changedProfiles }
}

/**
 * KiDit 建檔存檔 → 回寫病人基本資料（單一權威，2026-08-27）
 * 護理師剛在 KiDit 編輯＝最新意圖，故覆寫 patients 人口學欄位與 patient_kidit_profile；
 * MRN/初透日只補空（服務層規則）。回寫失敗只 warn，絕不讓 KiDit 存檔失敗。
 * 事件上的 kidit_profile 快照不動；syncEventsToKiditLogbook 重建路徑不經此 hook。
 */
function syncBasicProfileFromKidit(changedProfiles, user) {
  if (!changedProfiles || changedProfiles.length === 0) return
  const db = getDatabase()
  for (const { patientId, profile } of changedProfiles) {
    try {
      upsertPatientBasicProfile(db, patientId, mapKiditProfileToBasic(profile), mapKiditProfileToKidit(profile), {
        source: 'kidit',
        user,
        skipEmpty: true, // KiDit 空白＝沒填，不清除病人層級既有值
      })
    } catch (error) {
      console.warn(`[KIDIT] 回寫病人基本資料失敗 patientId=${patientId}:`, error?.message || error)
    }
  }
}

/**
 * PUT /api/nursing/kidit-logbook/:date/events
 * 取代整日的 Kidit 事件列表
 */
router.put('/kidit-logbook/:date/events', ...isEditor, (req, res) => {
  try {
    const { date } = req.params
    const { events } = req.body

    const stamped = stampKiditSavedMeta(date, events || [], req.user)
    const result = updateKiditEvents(date, stamped.events)

    // 事件已存檔後才回寫病人基本資料；失敗不影響本次存檔
    syncBasicProfileFromKidit(stamped.changedProfiles, req.user)

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

/**
 * GET /api/nursing/kidit-quarter-records/:quarter
 * 季度病人 KiDit 輸入（透析紀錄/醫療狀況評估/合併症）：取整季所有病人的表單資料
 * 設計比照 vascular_quarter_exports：只存人工填寫/覆寫，預帶值由前端載入時即時計算
 */
router.get('/kidit-quarter-records/:quarter', authenticate, (req, res) => {
  try {
    const { quarter } = req.params
    if (!/^\d{4}Q[1-4]$/.test(quarter)) {
      return res.status(400).json({ error: true, message: '季度格式錯誤（例：2026Q3）' })
    }

    const db = getDatabase()
    const rows = db
      .prepare(`SELECT patient_id, data, updated_by, updated_at FROM kidit_quarter_records WHERE quarter = ?`)
      .all(quarter)

    const parseJsonSafe = (str, fallback) => {
      try {
        return JSON.parse(str || '') ?? fallback
      } catch {
        return fallback
      }
    }

    res.json({
      success: true,
      quarter,
      records: rows.map((r) => ({
        patientId: r.patient_id,
        data: parseJsonSafe(r.data, {}),
        updatedBy: parseJsonSafe(r.updated_by, {}),
        updatedAt: r.updated_at,
      })),
    })
  } catch (error) {
    console.error('讀取季度 KiDit 輸入失敗:', error)
    res.status(500).json({ error: true, message: '讀取季度 KiDit 輸入失敗' })
  }
})

/**
 * PUT /api/nursing/kidit-quarter-records/:quarter/:patientId
 * 儲存單一病人的季度表單（主護 contributor 以上可寫）
 * data 採「頂層鍵淺合併」：只覆寫請求帶到的鍵（hdrecord/diagnose/comorbid/completed/nurse/hdrx…），
 * 讓護理端表單與工作站 HD處方覆寫共存同一筆記錄不互相清掉
 */
router.put('/kidit-quarter-records/:quarter/:patientId', ...isContributor, (req, res) => {
  try {
    const { quarter, patientId } = req.params
    if (!/^\d{4}Q[1-4]$/.test(quarter)) {
      return res.status(400).json({ error: true, message: '季度格式錯誤（例：2026Q3）' })
    }
    const { data } = req.body || {}
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return res.status(400).json({ error: true, message: 'data 必須是物件' })
    }

    const db = getDatabase()
    const id = `${quarter}_${patientId}`
    const existing = db.prepare(`SELECT data FROM kidit_quarter_records WHERE id = ?`).get(id)
    let existingData = {}
    try {
      existingData = JSON.parse(existing?.data || '{}') || {}
    } catch {
      existingData = {}
    }
    const mergedData = { ...existingData, ...data }

    const updatedBy = JSON.stringify({ uid: req.user.id, name: req.user.name })
    db.prepare(
      `INSERT INTO kidit_quarter_records (id, quarter, patient_id, data, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now','localtime'))
       ON CONFLICT(id) DO UPDATE SET
         data = excluded.data,
         updated_by = excluded.updated_by,
         updated_at = datetime('now','localtime')`
    ).run(id, quarter, patientId, JSON.stringify(mergedData), updatedBy)

    res.json({ success: true })
  } catch (error) {
    console.error('儲存季度 KiDit 輸入失敗:', error)
    res.status(500).json({ error: true, message: '儲存季度 KiDit 輸入失敗' })
  }
})

export default router
