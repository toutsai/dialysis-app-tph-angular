<script setup>
import { ref, computed } from 'vue'
import ApiManager from '@/services/api_manager'
import { SHIFT_CODES, getShiftDisplayName } from '@/constants/scheduleConstants.js'
import * as XLSX from 'xlsx'
import { formatDateToYYYYMMDD, formatDateToYYYYMM } from '@/utils/dateUtils.js'

const schedulesApi = ApiManager('schedules')
const expiredSchedulesApi = ApiManager('expired_schedules')
const patientsApi = ApiManager('patients')
const dailyLogsApi = ApiManager('daily_logs')

const getTaipeiTodayString = () => {
  const today = new Date()
  const options = { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }
  const formatter = new Intl.DateTimeFormat('fr-CA', options)
  return formatter.format(today)
}

const reportType = ref('daily')
const selectedDate = ref(formatDateToYYYYMMDD(new Date()))
const selectedMonth = ref(formatDateToYYYYMM(new Date()))
const selectedYear = ref(new Date().getFullYear())

const isLoading = ref(false)
const reportDateRange = ref({ start: '', end: '' })

// 表格數據的響應式狀態
const dailyTableHeaders = ref([])
const dailyTableRows = ref([])
const monthlyTableHeaders = ref([])
const monthlyTableRows = ref([])
const yearlyTableHeaders = ref([])
const yearlyTableRows = ref([])
const staffingTableRows = ref([])

const reportTitle = computed(() => {
  if (reportDateRange.value.start === '') return '統計結果'
  if (reportType.value === 'daily') return `${reportDateRange.value.start} 人次日報表`
  if (reportType.value === 'monthly') return `${selectedMonth.value} 人次月報表`
  if (reportType.value === 'yearly') return `${selectedYear.value} 人次年度報表`
  if (reportType.value === 'staffing_monthly') return `${selectedMonth.value} 護理人力月報表`
  return '統計報表'
})

const noData = computed(() => {
  if (reportType.value === 'daily') return dailyTableRows.value.length === 0
  if (reportType.value === 'monthly') return monthlyTableRows.value.length === 0
  if (reportType.value === 'yearly') return yearlyTableRows.value.length === 0
  if (reportType.value === 'staffing_monthly') return staffingTableRows.value.length === 0
  return true
})

async function generateReport() {
  isLoading.value = true
  // 先清空舊資料
  ;[
    dailyTableRows,
    monthlyTableRows,
    yearlyTableRows,
    staffingTableRows,
    dailyTableHeaders,
    monthlyTableHeaders,
    yearlyTableHeaders,
  ].forEach((arr) => (arr.value = []))

  try {
    // ✨ ========================================================== ✨
    // ✨           第一階段：計算並驗證日期 (最核心的修正)        ✨
    // ✨ ========================================================== ✨
    let startDate = null
    let endDate = null

    if (reportType.value === 'daily') {
      if (!selectedDate.value) throw new Error('請選擇一個有效的日期。')
      startDate = selectedDate.value
      endDate = selectedDate.value
    } else if (reportType.value === 'monthly' || reportType.value === 'staffing_monthly') {
      if (!selectedMonth.value || selectedMonth.value.indexOf('-') === -1) {
        throw new Error('請選擇一個有效的月份。')
      }
      const [year, month] = selectedMonth.value.split('-').map(Number)
      if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
        throw new Error('您選擇的月份格式不正確。')
      }
      const firstDay = new Date(year, month - 1, 1)
      const lastDay = new Date(year, month, 0)
      if (isNaN(firstDay.getTime()) || isNaN(lastDay.getTime())) {
        throw new Error('無法根據您的選擇建立有效的日期。')
      }
      startDate = formatDateToYYYYMMDD(firstDay)
      endDate = formatDateToYYYYMMDD(lastDay)
    } else if (reportType.value === 'yearly') {
      const year = Number(selectedYear.value)
      if (!year || isNaN(year) || year < 1900 || year > 2100) {
        throw new Error('請選擇一個有效的年份。')
      }
      startDate = formatDateToYYYYMMDD(new Date(year, 0, 1))
      endDate = formatDateToYYYYMMDD(new Date(year, 11, 31))
    }

    // ✨ 最終守門員：在執行任何查詢之前，做最後一次檢查
    if (!startDate || !endDate) {
      throw new Error('無法計算出有效的開始或結束日期，程式中止。')
    }

    reportDateRange.value = { start: startDate, end: endDate }

    // ✨ ========================================================== ✨
    // ✨           第二階段：執行資料庫查詢                     ✨
    // ✨ ========================================================== ✨

    if (reportType.value === 'staffing_monthly') {
      const dailyLogsData = await dailyLogsApi.fetchAll({ startDate, endDate })
      processStaffingReport(dailyLogsData)
    } else {
      // 人次報表的查詢邏輯
      const todayStr = getTaipeiTodayString()
      let schedulesData = []
      let expiredSchedulesData = []
      const fetchPromises = []

      if (endDate < todayStr) {
        fetchPromises.push(
          expiredSchedulesApi
            .fetchAll({ startDate, endDate })
            .then((data) => (expiredSchedulesData = data)),
        )
      } else if (startDate >= todayStr) {
        fetchPromises.push(
          schedulesApi
            .fetchAll({ startDate, endDate })
            .then((data) => (schedulesData = data)),
        )
      } else {
        fetchPromises.push(
          expiredSchedulesApi
            .fetchAll({ startDate, endDate: todayStr })
            .then((data) => (expiredSchedulesData = data)),
        )
        fetchPromises.push(
          schedulesApi
            .fetchAll({ startDate: todayStr, endDate })
            .then((data) => (schedulesData = data)),
        )
      }

      const patientsData = await patientsApi.fetchAll()
      const patientMap = new Map(patientsData.map((p) => [p.id, p]))
      await Promise.all(fetchPromises)
      const allSchedules = [...schedulesData, ...expiredSchedulesData]

      if (reportType.value === 'daily') {
        processDailyReport(allSchedules, patientMap)
      } else if (reportType.value === 'monthly') {
        processMonthlyReport(allSchedules, patientMap, startDate)
      } else if (reportType.value === 'yearly') {
        processYearlyReport(allSchedules, patientMap)
      }
    }
  } catch (error) {
    console.error('生成報表失敗:', error)
    alert(`生成報表時發生錯誤: ${error.message}`)
  } finally {
    isLoading.value = false
  }
}

// ✨ ========================================================== ✨
// ✨           核心修改：升級護理人力報表處理函式             ✨
// ✨ ========================================================== ✨
function processStaffingReport(dailyLogsData) {
  const reportData = dailyLogsData
    .map((log) => {
      // 使用可選串聯和空值合併運算符，確保程式在資料不完整時的穩定性
      const staffing = log.stats?.staffing
      const ratios = log.nursePatientRatios

      return {
        date: log.date,
        // 讀取計算好的各班總人力
        earlyStaff: staffing?.early?.toFixed(3) ?? 'N/A',
        noonStaff: staffing?.noon?.toFixed(3) ?? 'N/A',
        lateStaff: staffing?.late?.toFixed(3) ?? 'N/A',
        // 讀取護病比
        earlyRatio: ratios?.early ?? 'N/A',
        noonRatio: ratios?.noon ?? 'N/A',
        lateRatio: ratios?.late ?? 'N/A',
      }
    })
    .sort((a, b) => a.date.localeCompare(b.date)) // 按日期排序

  staffingTableRows.value = reportData
}

function exportToExcel() {
  if (noData.value) {
    alert('沒有可匯出的數據！')
    return
  }
  let headers, dataRows, filename
  const excelTitle = reportTitle.value

  // ... (日、月、年人次報表的匯出邏輯不變)
  if (reportType.value === 'daily') {
    headers = ['透析模式', '類別', ...dailyTableHeaders.value, '當日總計']
    dataRows = dailyTableRows.value.map((row) => [
      row.mode,
      row.status,
      ...row.shiftCounts,
      row.dailyTotal,
    ])
    filename = `日報表_${selectedDate.value}.xlsx`
  } else if (reportType.value === 'monthly') {
    headers = ['透析模式', '類別', ...monthlyTableHeaders.value, '月總計']
    dataRows = monthlyTableRows.value.map((row) => [
      row.mode,
      row.status,
      ...row.dailyCounts,
      row.monthlyTotal,
    ])
    filename = `月報表_${selectedMonth.value}.xlsx`
  } else if (reportType.value === 'yearly') {
    headers = ['透析模式', '類別', ...yearlyTableHeaders.value, '年總計']
    dataRows = yearlyTableRows.value.map((row) => [
      row.mode,
      row.status,
      ...row.monthlyCounts,
      row.yearlyTotal,
    ])
    filename = `年度報表_${selectedYear.value}.xlsx`
  }
  // ✨ 更新護理人力報表的 Excel 匯出邏輯
  else if (reportType.value === 'staffing_monthly') {
    headers = [
      '日期',
      '第一班人力',
      '第一班護病比',
      '第二班人力',
      '第二班護病比',
      '第三班人力',
      '第三班護病比',
    ]
    dataRows = staffingTableRows.value.map((row) => [
      row.date,
      row.earlyStaff,
      row.earlyRatio,
      row.noonStaff,
      row.noonRatio,
      row.lateStaff,
      row.lateRatio,
    ])
    filename = `護理人力月報表_${selectedMonth.value}.xlsx`
  }

  const titleRow = [excelTitle]
  const emptyRow = []
  const data = [titleRow, emptyRow, headers, ...dataRows]
  const workbook = XLSX.utils.book_new()
  const worksheet = XLSX.utils.aoa_to_sheet(data)
  const merge = { s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } }
  if (!worksheet['!merges']) worksheet['!merges'] = []
  worksheet['!merges'].push(merge)
  if (worksheet['A1']) {
    worksheet['A1'].s = { alignment: { horizontal: 'center', vertical: 'center' } }
  }
  XLSX.utils.book_append_sheet(workbook, worksheet, '報表')
  XLSX.writeFile(workbook, filename)
}

// ==================================================
// 以下的人次報表處理函式 (processDailyReport, etc.) 保持不變
// ==================================================
function processDailyReport(allSchedules, patientMap) {
  const shiftBreakdown = {}
  const dailyRecord = allSchedules[0]
  if (dailyRecord && dailyRecord.schedule) {
    for (const [shiftKey, slotData] of Object.entries(dailyRecord.schedule)) {
      if (!slotData?.patientId) continue
      let patientStatus, patientMode
      if (slotData.archivedPatientInfo) {
        patientStatus = slotData.archivedPatientInfo.status || 'unknown'
        patientMode = slotData.archivedPatientInfo.mode || 'HD'
      } else {
        const patient = patientMap.get(slotData.patientId)
        patientStatus = patient ? patient.status || 'unknown' : 'unknown'
        patientMode = patient ? patient.mode || 'HD' : 'HD'
      }
      const shiftCode = shiftKey.split('-').pop()
      if (!shiftCode) continue
      if (!shiftBreakdown[shiftCode]) shiftBreakdown[shiftCode] = {}
      const comboKey = `${patientMode}-${patientStatus}`
      if (!shiftBreakdown[shiftCode][comboKey]) shiftBreakdown[shiftCode][comboKey] = 0
      shiftBreakdown[shiftCode][comboKey]++
    }
  }
  const shiftOrder = [SHIFT_CODES.EARLY, SHIFT_CODES.NOON, SHIFT_CODES.LATE]
  dailyTableHeaders.value = shiftOrder.map((code) => getShiftDisplayName(code))
  const reportMatrix = {}
  const statusDisplay = { opd: '門診', ipd: '住院', er: '急診', unknown: '未知' }
  shiftOrder.forEach((shiftCode, shiftIndex) => {
    const shiftData = shiftBreakdown[shiftCode] || {}
    for (const comboKey in shiftData) {
      if (!reportMatrix[comboKey]) {
        const [mode, status] = comboKey.split('-')
        reportMatrix[comboKey] = {
          mode: mode,
          status: statusDisplay[status] || status,
          shiftCounts: Array(shiftOrder.length).fill(0),
          dailyTotal: 0,
        }
      }
      const count = shiftData[comboKey]
      reportMatrix[comboKey].shiftCounts[shiftIndex] = count
      reportMatrix[comboKey].dailyTotal += count
    }
  })
  const shiftTotalsRow = {
    mode: '每班總計',
    status: '',
    shiftCounts: Array(shiftOrder.length).fill(0),
    dailyTotal: 0,
  }
  const sortedRows = Object.values(reportMatrix).sort(
    (a, b) => a.mode.localeCompare(b.mode) || a.status.localeCompare(b.status),
  )
  sortedRows.forEach((row) => {
    row.shiftCounts.forEach((count, index) => {
      shiftTotalsRow.shiftCounts[index] += count
    })
  })
  shiftTotalsRow.dailyTotal = shiftTotalsRow.shiftCounts.reduce((sum, count) => sum + count, 0)
  dailyTableRows.value = [...sortedRows, shiftTotalsRow]
}
function processMonthlyReport(allSchedules, patientMap, monthStartDate) {
  const dailyBreakdown = {}
  for (const dailyRecord of allSchedules) {
    if (!dailyRecord.schedule) continue
    const dateKey = dailyRecord.date
    if (!dailyBreakdown[dateKey]) dailyBreakdown[dateKey] = {}
    for (const slotData of Object.values(dailyRecord.schedule)) {
      if (!slotData?.patientId) continue
      let patientStatus, patientMode
      if (slotData.archivedPatientInfo) {
        patientStatus = slotData.archivedPatientInfo.status || 'unknown'
        patientMode = slotData.archivedPatientInfo.mode || 'HD'
      } else {
        const patient = patientMap.get(slotData.patientId)
        patientStatus = patient ? patient.status || 'unknown' : 'unknown'
        patientMode = patient ? patient.mode || 'HD' : 'HD'
      }
      const comboKey = `${patientMode}-${patientStatus}`
      if (!dailyBreakdown[dateKey][comboKey]) dailyBreakdown[dateKey][comboKey] = 0
      dailyBreakdown[dateKey][comboKey]++
    }
  }
  const month = new Date(monthStartDate).getMonth()
  const year = new Date(monthStartDate).getFullYear()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  monthlyTableHeaders.value = Array.from({ length: daysInMonth }, (_, i) => i + 1)
  const reportMatrix = {}
  const statusDisplay = { opd: '門診', ipd: '住院', er: '急診', unknown: '未知' }
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = formatDateToYYYYMMDD(new Date(year, month, day))
    const dayData = dailyBreakdown[dateStr] || {}
    for (const comboKey in dayData) {
      if (!reportMatrix[comboKey]) {
        const [mode, status] = comboKey.split('-')
        reportMatrix[comboKey] = {
          mode: mode,
          status: statusDisplay[status] || status,
          dailyCounts: Array(daysInMonth).fill(0),
          monthlyTotal: 0,
        }
      }
      const count = dayData[comboKey]
      reportMatrix[comboKey].dailyCounts[day - 1] = count
      reportMatrix[comboKey].monthlyTotal += count
    }
  }
  const dailyTotalsRow = {
    mode: '每日總計',
    status: '',
    dailyCounts: Array(daysInMonth).fill(0),
    monthlyTotal: 0,
  }
  const sortedRows = Object.values(reportMatrix).sort(
    (a, b) => a.mode.localeCompare(b.mode) || a.status.localeCompare(b.status),
  )
  sortedRows.forEach((row) => {
    row.dailyCounts.forEach((count, index) => {
      dailyTotalsRow.dailyCounts[index] += count
    })
  })
  dailyTotalsRow.monthlyTotal = dailyTotalsRow.dailyCounts.reduce((sum, count) => sum + count, 0)
  monthlyTableRows.value = [...sortedRows, dailyTotalsRow]
}
function processYearlyReport(allSchedules, patientMap) {
  const monthlyBreakdown = {}
  for (const dailyRecord of allSchedules) {
    if (!dailyRecord.schedule) continue
    const recordDate = new Date(dailyRecord.date + 'T00:00:00')
    const monthIndex = recordDate.getMonth()
    for (const slotData of Object.values(dailyRecord.schedule)) {
      if (!slotData?.patientId) continue
      let patientStatus, patientMode
      if (slotData.archivedPatientInfo) {
        patientStatus = slotData.archivedPatientInfo.status || 'unknown'
        patientMode = slotData.archivedPatientInfo.mode || 'HD'
      } else {
        const patient = patientMap.get(slotData.patientId)
        patientStatus = patient ? patient.status || 'unknown' : 'unknown'
        patientMode = patient ? patient.mode || 'HD' : 'HD'
      }
      const comboKey = `${patientMode}-${patientStatus}`
      if (!monthlyBreakdown[comboKey]) monthlyBreakdown[comboKey] = Array(12).fill(0)
      monthlyBreakdown[comboKey][monthIndex]++
    }
  }
  yearlyTableHeaders.value = Array.from({ length: 12 }, (_, i) => `${i + 1}月`)
  const reportMatrix = {}
  const statusDisplay = { opd: '門診', ipd: '住院', er: '急診', unknown: '未知' }
  for (const comboKey in monthlyBreakdown) {
    const [mode, status] = comboKey.split('-')
    const monthlyCounts = monthlyBreakdown[comboKey]
    reportMatrix[comboKey] = {
      mode: mode,
      status: statusDisplay[status] || status,
      monthlyCounts: monthlyCounts,
      yearlyTotal: monthlyCounts.reduce((sum, count) => sum + count, 0),
    }
  }
  const monthlyTotalsRow = {
    mode: '每月總計',
    status: '',
    monthlyCounts: Array(12).fill(0),
    yearlyTotal: 0,
  }
  const sortedRows = Object.values(reportMatrix).sort(
    (a, b) => a.mode.localeCompare(b.mode) || a.status.localeCompare(b.status),
  )
  sortedRows.forEach((row) => {
    row.monthlyCounts.forEach((count, index) => {
      monthlyTotalsRow.monthlyCounts[index] += count
    })
  })
  monthlyTotalsRow.yearlyTotal = monthlyTotalsRow.monthlyCounts.reduce(
    (sum, count) => sum + count,
    0,
  )
  yearlyTableRows.value = [...sortedRows, monthlyTotalsRow]
}
</script>

<template>
  <div class="reporting-view-container">
    <h1 class="page-title">統計報表生成</h1>

    <div class="report-controls">
      <!-- 控制項 UI 不變 -->
      <div class="control-group">
        <label for="report-type">報表類型：</label>
        <select id="report-type" v-model="reportType">
          <option value="daily">人次日報表</option>
          <option value="monthly">人次月報表</option>
          <option value="yearly">人次年度報表</option>
          <option value="staffing_monthly">護理人力月報表</option>
        </select>
      </div>
      <div class="control-group">
        <template v-if="reportType === 'daily'">
          <label for="report-date">選擇日期：</label>
          <input id="report-date" type="date" v-model="selectedDate" />
        </template>
        <template v-if="reportType === 'monthly' || reportType === 'staffing_monthly'">
          <label for="report-month">選擇月份：</label>
          <input id="report-month" type="month" v-model="selectedMonth" />
        </template>
        <template v-if="reportType === 'yearly'">
          <label for="report-year">選擇年份：</label>
          <input id="report-year" type="number" v-model="selectedYear" />
        </template>
      </div>
      <button class="generate-btn" @click="generateReport" :disabled="isLoading">
        {{ isLoading ? '生成中...' : '生成報表' }}
      </button>
      <button class="export-btn" @click="exportToExcel" :disabled="isLoading || noData">
        匯出 Excel
      </button>
    </div>

    <div class="report-results">
      <div v-if="isLoading" class="loading-state">
        <p>報表生成中，請稍候...</p>
      </div>

      <!-- 人次報表顯示區 (不變) -->
      <div v-else-if="reportType === 'daily' && !noData" class="results-table-container">
        <h2>{{ reportTitle }}</h2>
        <table class="results-table daily-table">
          <thead>
            <tr>
              <th>透析模式</th>
              <th>類別</th>
              <th v-for="header in dailyTableHeaders" :key="header">{{ header }}</th>
              <th>當日總計</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, rowIndex) in dailyTableRows"
              :key="rowIndex"
              :class="{ 'total-row': row.mode === '每班總計' }"
            >
              <td>{{ row.mode }}</td>
              <td>{{ row.status }}</td>
              <td v-for="(count, shiftIndex) in row.shiftCounts" :key="shiftIndex">
                {{ count > 0 ? count : '' }}
              </td>
              <td class="total-col">{{ row.dailyTotal }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div
        v-else-if="reportType === 'monthly' && !noData"
        class="results-table-container monthly-report"
      >
        <h2>{{ reportTitle }}</h2>
        <table class="results-table monthly-table">
          <thead>
            <tr>
              <th class="sticky-col first-col">透析模式</th>
              <th class="sticky-col second-col">類別</th>
              <th v-for="day in monthlyTableHeaders" :key="day" class="day-col">{{ day }}</th>
              <th class="total-col">月總計</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, rowIndex) in monthlyTableRows"
              :key="rowIndex"
              :class="{ 'total-row': row.mode === '每日總計' }"
            >
              <td class="sticky-col first-col">{{ row.mode }}</td>
              <td class="sticky-col second-col">{{ row.status }}</td>
              <td v-for="(count, dayIndex) in row.dailyCounts" :key="dayIndex" class="day-col">
                {{ count > 0 ? count : '' }}
              </td>
              <td class="total-col">{{ row.monthlyTotal }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div
        v-else-if="reportType === 'yearly' && !noData"
        class="results-table-container yearly-report"
      >
        <h2>{{ reportTitle }}</h2>
        <table class="results-table yearly-table">
          <thead>
            <tr>
              <th>透析模式</th>
              <th>類別</th>
              <th v-for="header in yearlyTableHeaders" :key="header">{{ header }}</th>
              <th>年總計</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, rowIndex) in yearlyTableRows"
              :key="rowIndex"
              :class="{ 'total-row': row.mode === '每月總計' }"
            >
              <td>{{ row.mode }}</td>
              <td>{{ row.status }}</td>
              <td v-for="(count, monthIndex) in row.monthlyCounts" :key="monthIndex">
                {{ count > 0 ? count : '' }}
              </td>
              <td class="total-col">{{ row.yearlyTotal }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <!-- ✨ ============================================= ✨ -->
      <!-- ✨         核心修改：升級護理人力報表表格        ✨ -->
      <!-- ✨ ============================================= ✨ -->
      <div v-else-if="reportType === 'staffing_monthly' && !noData" class="results-table-container">
        <h2>{{ reportTitle }}</h2>
        <table class="results-table">
          <thead>
            <tr>
              <th rowspan="2">日期</th>
              <th colspan="2">第一班 (7-12)</th>
              <th colspan="2">第二班 (12-3)</th>
              <th colspan="2">第三班 (3-11)</th>
            </tr>
            <tr>
              <th>護理人力</th>
              <th>護病比</th>
              <th>護理人力</th>
              <th>護病比</th>
              <th>護理人力</th>
              <th>護病比</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in staffingTableRows" :key="index">
              <td>{{ row.date }}</td>
              <!-- 第一班 -->
              <td>{{ row.earlyStaff }}</td>
              <td>{{ row.earlyRatio }}</td>
              <!-- 第二班 -->
              <td>{{ row.noonStaff }}</td>
              <td>{{ row.noonRatio }}</td>
              <!-- 第三班 -->
              <td>{{ row.lateStaff }}</td>
              <td>{{ row.lateRatio }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-else class="initial-state">
        <p>請選擇報表類型和日期，然後點擊「生成報表」。</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 樣式 (CSS) 維持不變 */
.reporting-view-container {
  padding: 10px;
  background-color: #f8f9fa;
  min-height: 100vh;
  box-sizing: border-box;
}
.page-title {
  font-size: 32px;
  font-weight: 600;
  color: #343a40;
  margin-bottom: 2rem;
  border-bottom: 2px solid #dee2e6;
  padding-bottom: 1rem;
}
.report-controls {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  padding: 1.5rem;
  background-color: #ffffff;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
  margin-bottom: 2rem;
  flex-wrap: wrap;
}
.control-group {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}
.control-group label {
  font-size: 1.1rem;
  font-weight: 500;
  color: #495057;
  white-space: nowrap;
}
.control-group select,
.control-group input {
  padding: 0.5rem 0.75rem;
  font-size: 1rem;
  border: 1px solid #ced4da;
  border-radius: 6px;
}
.generate-btn,
.export-btn {
  padding: 0.6rem 1.5rem;
  font-size: 1.1rem;
  font-weight: 500;
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.2s;
}
.generate-btn {
  background-color: var(--primary-color, #007bff);
}
.export-btn {
  background-color: #28a745;
}
.generate-btn:hover:not(:disabled) {
  background-color: var(--primary-color-dark, #0056b3);
}
.export-btn:hover:not(:disabled) {
  background-color: #218838;
}
.generate-btn:disabled,
.export-btn:disabled {
  background-color: #6c757d;
  cursor: not-allowed;
  opacity: 0.7;
}
.report-results {
  background-color: #ffffff;
  padding: 2rem;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
  min-height: 400px;
}
.report-results h2 {
  font-size: 1.8rem;
  margin-top: 0;
  margin-bottom: 1.5rem;
  color: #495057;
}
.loading-state,
.initial-state {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 300px;
  color: #6c757d;
  font-size: 1.2rem;
  text-align: center;
}
.results-table-container {
  max-width: 100%;
  overflow-x: auto;
}
.results-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 600px;
}
.results-table th,
.results-table td {
  border: 1px solid #dee2e6;
  padding: 0.8rem 0.5rem;
  text-align: center;
  white-space: nowrap;
  vertical-align: middle; /* ✨ 確保垂直置中 */
}
.results-table th {
  background-color: #f8f9fa;
  font-weight: 600;
  font-size: 1rem;
}
.results-table tbody tr:nth-child(even) {
  background-color: #f8f9fa;
}
.results-table .total-col {
  font-weight: bold;
}
.results-table .total-row {
  font-weight: bold;
  background-color: #e9ecef;
}
.daily-table th:first-child,
.daily-table td:first-child,
.yearly-table th:first-child,
.yearly-table td:first-child,
.monthly-table .first-col {
  position: sticky;
  left: 0;
  z-index: 10;
  min-width: 90px;
  border-right: 2px solid #ced4da;
}
.daily-table th:nth-child(2),
.daily-table td:nth-child(2),
.yearly-table th:nth-child(2),
.yearly-table td:nth-child(2),
.monthly-table .second-col {
  position: sticky;
  left: 90px;
  z-index: 10;
  min-width: 80px;
  border-right: 2px solid #ced4da;
}
.results-table th.sticky-col,
.results-table thead th:first-child,
.results-table thead th:nth-child(2) {
  background-color: #f8f9fa;
  z-index: 20;
}
.results-table tbody tr:nth-child(odd) td:first-child,
.results-table tbody tr:nth-child(odd) td:nth-child(2) {
  background-color: #ffffff;
}
.results-table tbody tr:nth-child(even) td:first-child,
.results-table tbody tr:nth-child(even) td:nth-child(2) {
  background-color: #f0f3f5;
}
.results-table .total-row td:first-child,
.results-table .total-row td:nth-child(2),
.results-table .total-row .sticky-col {
  background-color: #e9ecef;
}
.monthly-table {
  min-width: 1200px;
}
.monthly-table .day-col {
  min-width: 35px;
}
.monthly-table .total-col {
  min-width: 60px;
}
@media (max-width: 768px) {
  .reporting-view-container {
    padding: 1rem;
  }
  .page-title {
    font-size: 24px;
    margin-bottom: 1.5rem;
  }
  .report-controls {
    flex-direction: column;
    align-items: stretch;
    gap: 1rem;
    padding: 1rem;
  }
  .control-group {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
    width: 100%;
  }
  .control-group label {
    font-size: 1rem;
  }
  .control-group select,
  .control-group input {
    width: 100%;
    box-sizing: border-box;
  }
  .generate-btn,
  .export-btn {
    width: 100%;
    font-size: 1.2rem;
    padding: 0.8rem;
  }
  .report-results {
    padding: 1rem;
  }
  .report-results h2 {
    font-size: 1.5rem;
  }
  .results-table {
    font-size: 0.9rem;
  }
  .results-table th,
  .results-table td {
    padding: 0.6rem 0.4rem;
  }
}
</style>
