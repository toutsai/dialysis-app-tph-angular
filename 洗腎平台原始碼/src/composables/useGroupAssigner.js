// 檔案路徑: src/composables/useGroupAssigner.js

import { computed } from 'vue'
import {
  getDefaultConfig,
  generateDayShiftGroups,
  generateNightShiftGroups,
  calculate74Groups,
} from '@/services/nursingGroupConfigService'

/**
 * 護理師組別分配 Composable
 * @param {Ref} scheduleSource - 班表資料來源
 * @param {Ref} groupConfigSource - 組別配置來源 (可選，預設使用內建預設值)
 * @param {Ref} adjacentSchedulesSource - 相鄰月份班表 { prev: schedule, next: schedule }
 */
export function useGroupAssigner(scheduleSource, groupConfigSource = null, adjacentSchedulesSource = null) {
  // 使用傳入的配置或預設配置
  const getConfig = () => {
    if (groupConfigSource && groupConfigSource.value) {
      return groupConfigSource.value
    }
    return getDefaultConfig()
  }

  // 取得相鄰月份班表
  const getAdjacentSchedules = () => {
    if (adjacentSchedulesSource && adjacentSchedulesSource.value) {
      return adjacentSchedulesSource.value
    }
    return { prev: null, next: null }
  }

  // 分組統計儀表板 - 根據配置顯示完整欄位
  const groupCountsDashboard = computed(() => {
    const schedule = scheduleSource.value
    if (!schedule || !schedule.scheduleByNurse) {
      return { header: ['護理師'], nurses: [] }
    }

    const config = getConfig()
    const groupCounts = config.groupCounts || {}

    // 取得一三五和二四六的組數，使用最大值來顯示完整欄位
    const dayCount135 = groupCounts['135']?.dayShiftCount || 8
    const dayCount246 = groupCounts['246']?.dayShiftCount || 9
    const nightCount135 = groupCounts['135']?.nightShiftCount || 9
    const nightCount246 = groupCounts['246']?.nightShiftCount || 8

    const maxDayCount = Math.max(dayCount135, dayCount246)
    const maxNightCount = Math.max(nightCount135, nightCount246)

    // 根據最大組數產生固定的欄位
    const fixedDayGroups = generateDayShiftGroups(maxDayCount)
    const fixedNightGroups = generateNightShiftGroups(maxNightCount)

    // 加入固定分配的組別（A組給74/L，外圍給816）
    const allDayGroups = ['A', ...fixedDayGroups, '外圍']

    const nurses = {}

    // 收集所有護理師和組別資料
    Object.entries(schedule.scheduleByNurse).forEach(([nurseId, nurseData]) => {
      if (!nurses[nurseId]) {
        nurses[nurseId] = {
          id: nurseId,
          name: nurseData.nurseName,
          dayCounts: {},
          nightCounts: {},
          standby75Count: 0,
        }
      }

      // 統計組別
      if (nurseData.groups && nurseData.shifts) {
        nurseData.groups.forEach((group, index) => {
          if (group) {
            const shift = nurseData.shifts[index]
            if (shift && isDayShift(shift)) {
              nurses[nurseId].dayCounts[group] = (nurses[nurseId].dayCounts[group] || 0) + 1
            } else if (shift && isNightShift(shift)) {
              nurses[nurseId].nightCounts[group] = (nurses[nurseId].nightCounts[group] || 0) + 1
            }
          }
        })
      }

      // 統計預備75班
      if (nurseData.standby75Days && nurseData.standby75Days.length > 0) {
        nurses[nurseId].standby75Count = nurseData.standby75Days.length
      }
    })

    // 建立表頭（使用固定欄位）
    const header = ['護理師']
    allDayGroups.forEach((group) => header.push(`白${group}`))
    fixedNightGroups.forEach((group) => header.push(`晚${group}`))
    header.push('預備75')

    // 整理資料 - 保持原始的護理師物件陣列
    const nursesList = Object.entries(nurses).map(([id, nurseData]) => {
      const nurse = {
        id: id,
        name: nurseData.name,
        dayCounts: nurseData.dayCounts,
        nightCounts: nurseData.nightCounts,
        standby75Count: nurseData.standby75Count,
        counts: {},
      }

      // 建立 counts 物件供表格顯示（使用固定欄位）
      allDayGroups.forEach((group) => {
        nurse.counts[`白${group}`] = nurseData.dayCounts[group] || 0
      })
      fixedNightGroups.forEach((group) => {
        nurse.counts[`晚${group}`] = nurseData.nightCounts[group] || 0
      })
      nurse.counts['預備75'] = nurseData.standby75Count || 0

      return nurse
    })

    // 使用與 sortedSchedule 相同的排序邏輯
    if (schedule.processingOrder && schedule.processingOrder.length > 0) {
      const orderMap = new Map(schedule.processingOrder.map((id, index) => [id, index]))
      nursesList.sort((a, b) => {
        const orderA = orderMap.get(a.id) ?? 999
        const orderB = orderMap.get(b.id) ?? 999
        return orderA - orderB
      })
    } else {
      // 按照 nurseId (員工編號) 排序
      nursesList.sort((a, b) => {
        // 嘗試提取數字進行排序
        const numA = parseInt(a.id) || 999
        const numB = parseInt(b.id) || 999
        if (numA !== numB) {
          return numA - numB
        }
        // 如果數字相同或都不是數字，按字串排序
        return a.id.localeCompare(b.id)
      })
    }

    return { header, nurses: nursesList }
  })

  // 判斷函式
  const isDayShift = (shift) => {
    const s = (shift || '').trim()
    return ['74', '74/L', '75', '816'].includes(s)
  }

  const isNightShift = (shift) => {
    const s = (shift || '').trim()
    return ['311', '3-11', '311C'].some((ns) => s.includes(ns))
  }

  // 檢查是否為住院組
  const isHospitalGroup = (group, shiftType, hospitalGroups) => {
    if (shiftType === 'day') {
      return (hospitalGroups?.dayShift || ['H', 'I']).includes(group)
    } else if (shiftType === 'night') {
      return (hospitalGroups?.nightShift || ['G', 'H']).includes(group)
    }
    return false
  }

  // 主要的分組分配函式（支援所有天數，考慮週次限制）
  const assignGroupsForDays = (
    schedule,
    dayIndices,
    groupCounts = null,
    standby75Counts = null,
    weeklyContext = null // 新增：週次上下文，用於追蹤週內限制
  ) => {
    const config = getConfig()
    const yearMonth = schedule.yearMonth
    const [year, month] = yearMonth.split('-').map(Number)

    // 從配置取得各種限制
    const cannotBeNightLeaderIds = config.cannotBeNightLeader || []
    const configGroupCounts = config.groupCounts || {}
    const dayRules = config.dayShiftRules || {}
    const fixedAssignments = config.fixedAssignments || {}
    const hospitalGroups = config.hospitalGroups || { dayShift: ['H', 'I'], nightShift: ['G', 'H'] }
    const nightShiftRestrictions = config.nightShiftRestrictions || {}
    const excludedNurses = new Set(config.excludedNurses || [])

    // 取得星期別設定的輔助函式
    const getDayShiftGroups = (dayOfWeek) => {
      let weekdayKey = '246'
      if ([1, 3, 5].includes(dayOfWeek)) {
        weekdayKey = '135'
      } else if ([2, 4, 6].includes(dayOfWeek)) {
        weekdayKey = '246'
      }

      const dayShiftCount = configGroupCounts[weekdayKey]?.dayShiftCount || 8
      const dayShiftAvailable = generateDayShiftGroups(dayShiftCount)
      const shift75Groups = dayRules[weekdayKey]?.shift75Groups || ['F']
      const shift74Groups = calculate74Groups(dayShiftAvailable, shift75Groups)

      return {
        groups74: shift74Groups,
        groups75: shift75Groups,
      }
    }

    // 取得晚班組別的輔助函式
    const getNightShiftGroups = (dayOfWeek) => {
      let weekdayKey = '246'
      if ([1, 3, 5].includes(dayOfWeek)) {
        weekdayKey = '135'
      } else if ([2, 4, 6].includes(dayOfWeek)) {
        weekdayKey = '246'
      }

      const nightShiftCount = configGroupCounts[weekdayKey]?.nightShiftCount || 9
      return generateNightShiftGroups(nightShiftCount)
    }

    // 收集所有可能的75班組別
    const all75Groups = new Set()
    ;(dayRules['135']?.shift75Groups || ['F']).forEach((g) => all75Groups.add(g))
    ;(dayRules['246']?.shift75Groups || ['F', 'J']).forEach((g) => all75Groups.add(g))
    const baseAvailable75Groups = Array.from(all75Groups)

    // 初始化計數器
    if (!groupCounts) {
      groupCounts = {}
      Object.keys(schedule.scheduleByNurse).forEach((nurseId) => {
        const init75Counts = {}
        baseAvailable75Groups.forEach((g) => {
          init75Counts[g] = 0
        })
        groupCounts[nurseId] = {
          74: {},
          75: init75Counts,
          311: {},
        }
      })
    }

    if (!standby75Counts) {
      standby75Counts = {}
      Object.keys(schedule.scheduleByNurse).forEach((nurseId) => {
        standby75Counts[nurseId] = schedule.scheduleByNurse[nurseId].standby75Days?.length || 0
      })
    }

    // 週次追蹤上下文（用於追蹤週內限制）
    if (!weeklyContext) {
      weeklyContext = {
        nurses816: new Set(), // 本週有816的護理師
        nurseHospitalDays: {}, // 護理師住院組天數: { nurseId: [dayIndex, ...] }
        nurse75Days: {}, // 護理師75班天數: { nurseId: [dayIndex, ...] }
        nurseStandby75Days: {}, // 護理師預備75天數: { nurseId: [dayIndex, ...] }
      }

      // 只在 weeklyContext 為空時掃描（避免重複掃描）
      dayIndices.forEach((dayIndex) => {
        Object.entries(schedule.scheduleByNurse).forEach(([nurseId, nurseData]) => {
          const shift = nurseData.shifts?.[dayIndex]
          if (!shift) return
          const s = shift.trim()

          if (s === '816') {
            weeklyContext.nurses816.add(nurseId)
          }
          if (s === '75') {
            if (!weeklyContext.nurse75Days[nurseId]) {
              weeklyContext.nurse75Days[nurseId] = []
            }
            weeklyContext.nurse75Days[nurseId].push(dayIndex)
          }
        })
      })
    }

    // 用於追蹤75班組的輪流
    let next75GroupIndex = 0

    // 檢查最近的75班使用的組別
    if (baseAvailable75Groups.length > 0) {
      for (let i = dayIndices[0] - 1; i >= 0; i--) {
        let found75 = false
        Object.values(schedule.scheduleByNurse).forEach((nurseData) => {
          if (nurseData.shifts?.[i] === '75' && nurseData.groups?.[i]) {
            const usedGroup = nurseData.groups[i]
            const usedIndex = baseAvailable75Groups.indexOf(usedGroup)
            if (usedIndex >= 0) {
              next75GroupIndex = (usedIndex + 1) % baseAvailable75Groups.length
              found75 = true
            }
          }
        })
        if (found75) break
      }
    }

    // 處理每一天
    dayIndices.forEach((dayIndex) => {
      const date = new Date(year, month - 1, dayIndex + 1)
      const dayOfWeek = date.getDay()

      const dayShiftGroups = getDayShiftGroups(dayOfWeek)
      const available74Groups = dayShiftGroups.groups74
      const available75Groups = dayShiftGroups.groups75
      const nightGroups = getNightShiftGroups(dayOfWeek)

      // 收集當天各班別的護理師
      const nurses74 = []
      const nurses75 = []
      const nurses74L = []
      const nurses816 = []
      const nurses311 = []
      const nurses311C = []
      const eligibleFor75Standby = []

      Object.entries(schedule.scheduleByNurse).forEach(([nurseId, nurseData]) => {
        const shift = nurseData.shifts?.[dayIndex]
        if (!shift) return

        // 跳過暫不分組的護理師
        if (excludedNurses.has(nurseId)) return

        const s = shift.trim()

        // 跳過休假
        if (s.includes('休') || s.includes('例') || s.includes('國定')) return

        // 依班別分類
        if (s === '74') {
          nurses74.push(nurseId)
          eligibleFor75Standby.push(nurseId)
        } else if (s === '75') {
          nurses75.push(nurseId)
        } else if (s === '74/L') {
          nurses74L.push(nurseId)
        } else if (s === '816') {
          nurses816.push(nurseId)
        } else if (s === '311C') {
          nurses311C.push(nurseId)
        } else if (isNightShift(s)) {
          nurses311.push(nurseId)
        }
      })

      // === 分配白班組別 ===

      // 74/L 固定 A 組
      nurses74L.forEach((nurseId) => {
        schedule.scheduleByNurse[nurseId].groups[dayIndex] = fixedAssignments['74/L'] || 'A'
      })

      // 816 固定外圍組
      nurses816.forEach((nurseId) => {
        schedule.scheduleByNurse[nurseId].groups[dayIndex] = fixedAssignments['816'] || '外圍'
      })

      // 75班分配組別
      if (nurses75.length > 0 && available75Groups.length > 0) {
        if (nurses75.length === 1) {
          const nurseId = nurses75[0]
          const group = available75Groups[next75GroupIndex % available75Groups.length]
          schedule.scheduleByNurse[nurseId].groups[dayIndex] = group
          groupCounts[nurseId]['75'][group] = (groupCounts[nurseId]['75'][group] || 0) + 1
          next75GroupIndex = (next75GroupIndex + 1) % baseAvailable75Groups.length
        } else {
          const allNurses75 = [...nurses75]
          const assignedNurses = new Set()

          available75Groups.forEach((group) => {
            let bestNurse = null
            let minCount = Infinity

            allNurses75.forEach((nurseId) => {
              if (!assignedNurses.has(nurseId)) {
                const count = groupCounts[nurseId]['75'][group] || 0
                if (count < minCount) {
                  minCount = count
                  bestNurse = nurseId
                }
              }
            })

            if (bestNurse) {
              schedule.scheduleByNurse[bestNurse].groups[dayIndex] = group
              groupCounts[bestNurse]['75'][group] = (groupCounts[bestNurse]['75'][group] || 0) + 1
              assignedNurses.add(bestNurse)
            }
          })

          allNurses75.forEach((nurseId) => {
            if (!assignedNurses.has(nurseId)) {
              let minCount = Infinity
              let minGroup = available75Groups[0]

              available75Groups.forEach((group) => {
                const count = groupCounts[nurseId]['75'][group] || 0
                if (count < minCount) {
                  minCount = count
                  minGroup = group
                }
              })

              schedule.scheduleByNurse[nurseId].groups[dayIndex] = minGroup
              groupCounts[nurseId]['75'][minGroup] = (groupCounts[nurseId]['75'][minGroup] || 0) + 1
              assignedNurses.add(nurseId)
            }
          })

          next75GroupIndex = (next75GroupIndex + 1) % baseAvailable75Groups.length
        }
      }

      // 74班分配組別（考慮住院組限制）
      if (nurses74.length > 0 && available74Groups.length > 0) {
        // 分離住院組和非住院組
        const hospitalGroupsToday = available74Groups.filter(g => isHospitalGroup(g, 'day', hospitalGroups))
        const nonHospitalGroupsToday = available74Groups.filter(g => !isHospitalGroup(g, 'day', hospitalGroups))

        const usedGroups = new Set()
        const assignedNurses = new Set()

        // === 第一步：分配住院組（優先分配給本週住院次數少且非連續的護理師）===
        if (hospitalGroupsToday.length > 0) {
          // 計算護理師的整月住院組次數（白班 H、I）
          const getMonthlyHospitalCount74 = (nurseId) => {
            const hCount = groupCounts[nurseId]?.['74']?.['H'] || 0
            const iCount = groupCounts[nurseId]?.['74']?.['I'] || 0
            return hCount + iCount
          }

          // 評估每位護理師的住院組優先順序
          const hospitalCandidates = nurses74
            .filter(nurseId => {
              // 排除 816 護理師
              if (weeklyContext.nurses816.has(nurseId)) return false
              // 排除已達 2 次住院組的護理師
              const hospitalDays = weeklyContext.nurseHospitalDays[nurseId] || []
              if (hospitalDays.length >= 2) return false
              return true
            })
            .map(nurseId => {
              const hospitalDays = weeklyContext.nurseHospitalDays[nurseId] || []
              const hadYesterday = hospitalDays.includes(dayIndex - 1)
              const monthlyCount = getMonthlyHospitalCount74(nurseId)
              return {
                nurseId,
                hospitalCount: hospitalDays.length,
                monthlyCount,
                hadYesterday,
                // 排序分數：整月次數最重要，當週次數次之，連續最後
                // 整月0次+當週0次+非連續=0, 整月1次+當週0次+非連續=100
                score: monthlyCount * 100 + hospitalDays.length * 10 + (hadYesterday ? 5 : 0)
              }
            })
            .sort((a, b) => a.score - b.score)

          // 分配住院組
          hospitalGroupsToday.forEach(group => {
            const candidate = hospitalCandidates.find(c => !assignedNurses.has(c.nurseId))
            if (candidate) {
              const nurseId = candidate.nurseId
              schedule.scheduleByNurse[nurseId].groups[dayIndex] = group
              groupCounts[nurseId]['74'][group] = (groupCounts[nurseId]['74'][group] || 0) + 1
              usedGroups.add(group)
              assignedNurses.add(nurseId)

              // 追蹤住院組
              if (!weeklyContext.nurseHospitalDays[nurseId]) {
                weeklyContext.nurseHospitalDays[nurseId] = []
              }
              weeklyContext.nurseHospitalDays[nurseId].push(dayIndex)
            }
          })
        }

        // === 第二步：分配非住院組給剩餘護理師（考慮全體平衡）===
        const remainingNurses = nurses74.filter(id => !assignedNurses.has(id))
        const remainingGroups = available74Groups.filter(g => !usedGroups.has(g))

        if (remainingNurses.length > 0 && remainingGroups.length > 0) {
          // 建立所有可能的 (護理師, 組別, 使用次數) 配對
          const assignments = []
          remainingNurses.forEach(nurseId => {
            remainingGroups.forEach(group => {
              const count = groupCounts[nurseId]['74'][group] || 0
              assignments.push({ nurseId, group, count })
            })
          })

          // 按使用次數排序（少的優先），確保全體平均
          assignments.sort((a, b) => a.count - b.count)

          // 貪婪分配：優先滿足使用次數最少的配對
          assignments.forEach(({ nurseId, group, count }) => {
            if (!assignedNurses.has(nurseId) && !usedGroups.has(group)) {
              schedule.scheduleByNurse[nurseId].groups[dayIndex] = group
              groupCounts[nurseId]['74'][group] = (groupCounts[nurseId]['74'][group] || 0) + 1
              usedGroups.add(group)
              assignedNurses.add(nurseId)
            }
          })
        }
      }

      // === 分配夜班組別 ===

      // 311C 固定 C 組
      nurses311C.forEach((nurseId) => {
        schedule.scheduleByNurse[nurseId].groups[dayIndex] = fixedAssignments['311C'] || 'C'
        groupCounts[nurseId]['311']['C'] = (groupCounts[nurseId]['311']['C'] || 0) + 1
      })

      // 分配夜班組別 (311)
      if (nurses311.length > 0 && nightGroups.length > 0) {
        const canBeLeader = []
        const cannotBeLeader = []

        nurses311.forEach((nurseId) => {
          if (cannotBeNightLeaderIds.includes(nurseId)) {
            cannotBeLeader.push(nurseId)
          } else {
            canBeLeader.push(nurseId)
          }
        })

        // 取得護理師可用的夜班組別（考慮各種限制）
        const getAvailableNightGroups = (nurseId, groups, excludeHospital = false) => {
          let available = [...groups]

          // 規則1: 816護理師不能有住院組
          if (weeklyContext.nurses816.has(nurseId)) {
            available = available.filter(g => !isHospitalGroup(g, 'night', hospitalGroups))
          }

          // 規則6: 當週住院組最多2次
          const nurseHospitalDays = weeklyContext.nurseHospitalDays[nurseId] || []
          if (nurseHospitalDays.length >= 2) {
            available = available.filter(g => !isHospitalGroup(g, 'night', hospitalGroups))
          }

          // 規則6b: 避免連續住院組（如果昨天有住院組，今天盡量不排）
          if (excludeHospital || nurseHospitalDays.includes(dayIndex - 1)) {
            available = available.filter(g => !isHospitalGroup(g, 'night', hospitalGroups))
          }

          // 規則7: 特定護理師夜班組別限制
          const restrictions = nightShiftRestrictions[nurseId] || []
          if (restrictions.length > 0) {
            available = available.filter(g => !restrictions.includes(g))
          }

          return available
        }

        // 計算護理師的整月夜班住院組次數（G、H）
        const getMonthlyHospitalCount311 = (nurseId) => {
          const gCount = groupCounts[nurseId]?.['311']?.['G'] || 0
          const hCount = groupCounts[nurseId]?.['311']?.['H'] || 0
          return gCount + hCount
        }

        // 計算護理師的住院組優先分數（用於平均分配）
        const getHospitalPriorityScore = (nurseId) => {
          const hospitalDays = weeklyContext.nurseHospitalDays[nurseId] || []
          const hadYesterday = hospitalDays.includes(dayIndex - 1)
          const monthlyCount = getMonthlyHospitalCount311(nurseId)
          // 排序分數：整月次數最重要，當週次數次之，連續最後
          return monthlyCount * 100 + hospitalDays.length * 10 + (hadYesterday ? 5 : 0)
        }

        canBeLeader.sort((a, b) => {
          const aCount = Object.values(groupCounts[a]['311'] || {}).reduce((sum, c) => sum + c, 0)
          const bCount = Object.values(groupCounts[b]['311'] || {}).reduce((sum, c) => sum + c, 0)
          return aCount - bCount
        })

        cannotBeLeader.sort((a, b) => {
          const aCount = Object.values(groupCounts[a]['311'] || {}).reduce((sum, c) => sum + c, 0)
          const bCount = Object.values(groupCounts[b]['311'] || {}).reduce((sum, c) => sum + c, 0)
          return aCount - bCount
        })

        let groupIndex = 0

        // 先分配A組給可以當Leader的護理師
        if (nightGroups[0] === 'A' && canBeLeader.length > 0) {
          // 找出可以當A組且沒有限制的護理師
          let selectedLeader = null
          let minACount = Infinity

          canBeLeader.forEach((nurseId) => {
            const available = getAvailableNightGroups(nurseId, nightGroups)
            if (available.includes('A')) {
              const aCount = groupCounts[nurseId]['311']['A'] || 0
              if (aCount < minACount) {
                selectedLeader = nurseId
                minACount = aCount
              }
            }
          })

          if (selectedLeader) {
            schedule.scheduleByNurse[selectedLeader].groups[dayIndex] = 'A'
            groupCounts[selectedLeader]['311']['A'] = (groupCounts[selectedLeader]['311']['A'] || 0) + 1
            canBeLeader.splice(canBeLeader.indexOf(selectedLeader), 1)
            groupIndex = 1
          }
        }

        // 分配剩餘的組別
        const remainingNurses = [...canBeLeader, ...cannotBeLeader]
        let remainingGroups = nightGroups.slice(groupIndex)

        // ✨ 修正：如果已有 311C 護理師佔用 C 組，則 311 不可再分配 C 組
        if (nurses311C.length > 0) {
          remainingGroups = remainingGroups.filter(g => g !== 'C')
        }

        if (remainingNurses.length > 0 && remainingGroups.length > 0) {
          // 分離住院組和非住院組
          const hospitalNightGroups = remainingGroups.filter(g => isHospitalGroup(g, 'night', hospitalGroups))
          const nonHospitalNightGroups = remainingGroups.filter(g => !isHospitalGroup(g, 'night', hospitalGroups))

          const assignedNurses = new Set()
          const assignedGroups = new Set()

          // === 第一步：優先分配夜班住院組（G、H）給本週住院次數少的護理師 ===
          if (hospitalNightGroups.length > 0) {
            // 找出可以接住院組的護理師，按優先分數排序
            const hospitalCandidates = remainingNurses
              .filter(nurseId => {
                const available = getAvailableNightGroups(nurseId, hospitalNightGroups)
                return available.length > 0
              })
              .map(nurseId => ({
                nurseId,
                score: getHospitalPriorityScore(nurseId),
                available: getAvailableNightGroups(nurseId, hospitalNightGroups)
              }))
              .sort((a, b) => a.score - b.score)

            // 分配住院組
            hospitalNightGroups.forEach(group => {
              const candidate = hospitalCandidates.find(c =>
                !assignedNurses.has(c.nurseId) && c.available.includes(group)
              )
              if (candidate) {
                const nurseId = candidate.nurseId
                schedule.scheduleByNurse[nurseId].groups[dayIndex] = group
                groupCounts[nurseId]['311'][group] = (groupCounts[nurseId]['311'][group] || 0) + 1
                assignedNurses.add(nurseId)
                assignedGroups.add(group)

                // 追蹤住院組
                if (!weeklyContext.nurseHospitalDays[nurseId]) {
                  weeklyContext.nurseHospitalDays[nurseId] = []
                }
                weeklyContext.nurseHospitalDays[nurseId].push(dayIndex)
              }
            })
          }

          // === 第二步：分配非住院組給剩餘護理師 ===
          const stillRemainingNurses = remainingNurses.filter(id => !assignedNurses.has(id))
          const stillRemainingGroups = remainingGroups.filter(g => !assignedGroups.has(g))

          if (stillRemainingNurses.length > 0 && stillRemainingGroups.length > 0) {
            const assignments = []
            stillRemainingNurses.forEach((nurseId) => {
              const available = getAvailableNightGroups(nurseId, stillRemainingGroups, true) // excludeHospital=true
              available.forEach((group) => {
                const count = groupCounts[nurseId]['311'][group] || 0
                assignments.push({ nurseId, group, count })
              })
            })

            assignments.sort((a, b) => a.count - b.count)

            assignments.forEach(({ nurseId, group }) => {
              if (!assignedNurses.has(nurseId) && !assignedGroups.has(group)) {
                schedule.scheduleByNurse[nurseId].groups[dayIndex] = group
                groupCounts[nurseId]['311'][group] = (groupCounts[nurseId]['311'][group] || 0) + 1
                assignedNurses.add(nurseId)
                assignedGroups.add(group)
              }
            })
          }
        }
      }

      // === 分配預備75班 ===
      if (eligibleFor75Standby.length > 0) {
        // 過濾符合條件的護理師
        const validCandidates = eligibleFor75Standby.filter((nurseId) => {
          // 規則4: 白班住院組不排預備75
          const todayGroup = schedule.scheduleByNurse[nurseId].groups[dayIndex]
          if (isHospitalGroup(todayGroup, 'day', hospitalGroups)) {
            return false
          }

          // 規則2: 預備75前後不能有75班
          const nurse75Days = weeklyContext.nurse75Days[nurseId] || []
          const hasAdjacentShift75 = nurse75Days.some((day75) => Math.abs(dayIndex - day75) <= 1)
          if (hasAdjacentShift75) {
            return false
          }

          // 規則2b: 預備75前後不能有另一個預備75
          const nurseStandby75Days = weeklyContext.nurseStandby75Days[nurseId] || []
          const hasAdjacentStandby75 = nurseStandby75Days.some((day) => Math.abs(dayIndex - day) <= 1)
          if (hasAdjacentStandby75) {
            return false
          }

          // 規則3: 當週 (75+預備75) 最多2天
          const nurse75Count = nurse75Days.length
          const nurseStandby75Count = nurseStandby75Days.length
          if (nurse75Count + nurseStandby75Count >= 2) {
            return false
          }

          return true
        })

        if (validCandidates.length > 0) {
          // 根據已分配次數排序，選擇最少的
          validCandidates.sort((a, b) => standby75Counts[a] - standby75Counts[b])

          const minCount = standby75Counts[validCandidates[0]]
          const candidates = validCandidates.filter((id) => standby75Counts[id] === minCount)
          const selectedNurseId = candidates[Math.floor(Math.random() * candidates.length)]

          // 記錄預備75班
          if (!schedule.scheduleByNurse[selectedNurseId].standby75Days) {
            schedule.scheduleByNurse[selectedNurseId].standby75Days = []
          }
          schedule.scheduleByNurse[selectedNurseId].standby75Days.push(dayIndex)
          standby75Counts[selectedNurseId]++

          // 追蹤週次上下文
          if (!weeklyContext.nurseStandby75Days[selectedNurseId]) {
            weeklyContext.nurseStandby75Days[selectedNurseId] = []
          }
          weeklyContext.nurseStandby75Days[selectedNurseId].push(dayIndex)
        }
      }
    })

    return { groupCounts, standby75Counts, weeklyContext }
  }

  // 自動分組並分配預備75班（初始分配）
  const generateGroupAssignments = (originalSchedule) => {
    if (!originalSchedule) return null

    const schedule = JSON.parse(JSON.stringify(originalSchedule))

    // 初始化
    Object.values(schedule.scheduleByNurse).forEach((nurseData) => {
      if (!nurseData.groups) {
        nurseData.groups = new Array(nurseData.shifts?.length || 0).fill('')
      }
      if (!nurseData.standby75Days) {
        nurseData.standby75Days = []
      }
    })

    // 初始化週次確認狀態
    if (!schedule.weekConfirmed) {
      schedule.weekConfirmed = {
        week1: false,
        week2: false,
        week3: false,
        week4: false,
        week5: false,
        week6: false, // 可能會有第6週
      }
    }

    const yearMonth = schedule.yearMonth
    const [year, month] = yearMonth.split('-').map(Number)
    const daysInMonth = schedule.maxDaysInMonth || new Date(year, month, 0).getDate()

    // 取得相鄰月份班表
    const adjacentSchedules = getAdjacentSchedules()
    const prevMonthSchedule = adjacentSchedules.prev
    const nextMonthSchedule = adjacentSchedules.next
    const prevMonthDays = new Date(year, month - 1, 0).getDate()

    // 按新的週邏輯計算週（週一到週六，完整週）
    const firstDayOfMonth = new Date(year, month - 1, 1)
    const lastDayOfMonth = new Date(year, month, 0)
    const firstDayWeekday = firstDayOfMonth.getDay()
    const lastDayWeekday = lastDayOfMonth.getDay()

    // 找到包含1號的週的週一
    let firstWeekMondayOffset // 相對於1號的偏移量（負數表示上個月）
    if (firstDayWeekday === 0) {
      // 1號是週日，第一週從2號(週一)開始
      firstWeekMondayOffset = 1
    } else if (firstDayWeekday === 1) {
      // 1號是週一
      firstWeekMondayOffset = 0
    } else {
      // 1號是週二到週六，往前找週一（可能在上個月）
      firstWeekMondayOffset = -(firstDayWeekday - 1)
    }

    // 找到包含最後一天的週的週六
    // 注意：週日不在班表中，所以如果最後一天是週日，最後一週結束於前一天（週六）
    let lastWeekSaturdayOffset // 相對於最後一天的偏移量（正數表示下個月，負數表示當月往前）
    if (lastDayWeekday === 6) {
      lastWeekSaturdayOffset = 0
    } else if (lastDayWeekday === 0) {
      // 最後一天是週日，最後一週結束於前一天（週六）
      lastWeekSaturdayOffset = -1
    } else {
      lastWeekSaturdayOffset = 6 - lastDayWeekday
    }

    // 建立完整週的資料結構
    // 每個元素: { dayIndex, isCurrentMonth, isPrevMonth, isNextMonth, actualDayIndex }
    const allWeekDays = []
    let currentDay = 1 + firstWeekMondayOffset // 可能是負數（上個月）
    const lastDay = daysInMonth + lastWeekSaturdayOffset

    while (currentDay <= lastDay) {
      const actualDate = new Date(year, month - 1, currentDay)
      const dayOfWeek = actualDate.getDay()

      // 只包含週一(1)到週六(6)，跳過週日(0)
      if (dayOfWeek !== 0) {
        let dayInfo
        if (currentDay < 1) {
          // 上個月
          const prevDayIndex = prevMonthDays + currentDay - 1 // 0-based
          dayInfo = {
            dayIndex: prevDayIndex,
            isCurrentMonth: false,
            isPrevMonth: true,
            isNextMonth: false,
            displayDay: currentDay, // 用於排序和定位
          }
        } else if (currentDay > daysInMonth) {
          // 下個月
          const nextDayIndex = currentDay - daysInMonth - 1 // 0-based
          dayInfo = {
            dayIndex: nextDayIndex,
            isCurrentMonth: false,
            isPrevMonth: false,
            isNextMonth: true,
            displayDay: currentDay,
          }
        } else {
          // 當月
          dayInfo = {
            dayIndex: currentDay - 1, // 0-based
            isCurrentMonth: true,
            isPrevMonth: false,
            isNextMonth: false,
            displayDay: currentDay,
          }
        }
        allWeekDays.push(dayInfo)
      }

      currentDay++
    }

    // 按每6天分組成週
    const weeks = []
    for (let i = 0; i < allWeekDays.length; i += 6) {
      weeks.push(allWeekDays.slice(i, i + 6))
    }

    // 按週分配
    let groupCounts = null
    let standby75Counts = null

    weeks.forEach((weekDays) => {
      const weeklyContext = {
        nurses816: new Set(),
        nurseHospitalDays: {},
        nurse75Days: {},
        nurseStandby75Days: {},
      }

      // 掃描整週的班表（包含跨月天數）建立 weeklyContext
      weekDays.forEach((dayInfo) => {
        let scheduleToScan = null
        if (dayInfo.isCurrentMonth) {
          scheduleToScan = schedule
        } else if (dayInfo.isPrevMonth) {
          scheduleToScan = prevMonthSchedule
        } else if (dayInfo.isNextMonth) {
          scheduleToScan = nextMonthSchedule
        }

        if (!scheduleToScan?.scheduleByNurse) return

        Object.entries(scheduleToScan.scheduleByNurse).forEach(([nurseId, nurseData]) => {
          const shift = nurseData.shifts?.[dayInfo.dayIndex]
          if (!shift) return
          const s = shift.trim()

          if (s === '816') {
            weeklyContext.nurses816.add(nurseId)
          }
          if (s === '75') {
            if (!weeklyContext.nurse75Days[nurseId]) {
              weeklyContext.nurse75Days[nurseId] = []
            }
            // 使用 displayDay 作為統一的日期索引
            weeklyContext.nurse75Days[nurseId].push(dayInfo.displayDay)
          }
          // 檢查預備75
          if (nurseData.standby75Days?.includes(dayInfo.dayIndex)) {
            if (!weeklyContext.nurseStandby75Days[nurseId]) {
              weeklyContext.nurseStandby75Days[nurseId] = []
            }
            weeklyContext.nurseStandby75Days[nurseId].push(dayInfo.displayDay)
          }
        })
      })

      // 只分配當月的天數
      const currentMonthDays = weekDays
        .filter((d) => d.isCurrentMonth)
        .map((d) => d.dayIndex)

      if (currentMonthDays.length > 0) {
        // 將 weeklyContext 中的 displayDay 轉換為統一的座標系統
        // displayDay - 1 可以直接與 dayIndex 比較
        // 例如: 當月 displayDay=1 -> 0, displayDay=31 -> 30
        //       上月 displayDay=0 -> -1, displayDay=-1 -> -2
        //       下月 displayDay=32 -> 31
        const adjustedContext = {
          ...weeklyContext,
          nurse75Days: {},
          nurseStandby75Days: {},
        }

        // 將所有 displayDay 轉換為與 dayIndex 相容的座標
        Object.entries(weeklyContext.nurse75Days).forEach(([nurseId, days]) => {
          adjustedContext.nurse75Days[nurseId] = days.map((displayDay) => displayDay - 1)
        })

        Object.entries(weeklyContext.nurseStandby75Days).forEach(([nurseId, days]) => {
          adjustedContext.nurseStandby75Days[nurseId] = days.map((displayDay) => displayDay - 1)
        })

        const result = assignGroupsForDays(
          schedule,
          currentMonthDays,
          groupCounts,
          standby75Counts,
          adjustedContext
        )
        groupCounts = result.groupCounts
        standby75Counts = result.standby75Counts
      }
    })

    return schedule
  }

  // 基於已確認週次重新分配剩餘週次
  const redistributeRemainingWeeks = (schedule, weeklyData) => {
    if (!schedule || !weeklyData) return schedule

    const config = getConfig()
    const adjacentSchedules = getAdjacentSchedules()
    const prevMonthSchedule = adjacentSchedules.prev
    const nextMonthSchedule = adjacentSchedules.next

    // 收集所有可能的75班組別
    const all75Groups = new Set()
    const dayRules = config.dayShiftRules || {}
    ;(dayRules['135']?.shift75Groups || ['F']).forEach((g) => all75Groups.add(g))
    ;(dayRules['246']?.shift75Groups || ['F', 'J']).forEach((g) => all75Groups.add(g))
    const baseAvailable75Groups = Array.from(all75Groups)

    // 收集已確認週次的統計（只計算當月日期）
    const groupCounts = {}
    const standby75Counts = {}

    Object.keys(schedule.scheduleByNurse).forEach((nurseId) => {
      const init75Counts = {}
      baseAvailable75Groups.forEach((g) => {
        init75Counts[g] = 0
      })
      groupCounts[nurseId] = {
        74: {},
        75: init75Counts,
        311: {},
      }
      standby75Counts[nurseId] = 0
    })

    // 統計已確認週次的分組情況（只計算當月日期）
    weeklyData.forEach((week, weekIndex) => {
      if (schedule.weekConfirmed?.[`week${weekIndex + 1}`]) {
        week.days.forEach((day) => {
          if (day.isCurrentMonth) {
            Object.entries(schedule.scheduleByNurse).forEach(([nurseId, nurseData]) => {
              const group = nurseData.groups?.[day.dayIndex]
              const shift = nurseData.shifts?.[day.dayIndex]

              if (group && shift) {
                if (shift === '74') {
                  groupCounts[nurseId]['74'][group] = (groupCounts[nurseId]['74'][group] || 0) + 1
                } else if (shift === '75') {
                  groupCounts[nurseId]['75'][group] = (groupCounts[nurseId]['75'][group] || 0) + 1
                } else if (isNightShift(shift)) {
                  groupCounts[nurseId]['311'][group] = (groupCounts[nurseId]['311'][group] || 0) + 1
                }
              }

              if (nurseData.standby75Days?.includes(day.dayIndex)) {
                standby75Counts[nurseId]++
              }
            })
          }
        })
      }
    })

    // 清除並重新分配未確認週次
    weeklyData.forEach((week, weekIndex) => {
      if (!schedule.weekConfirmed?.[`week${weekIndex + 1}`]) {
        const weekDayIndices = []
        week.days.forEach((day) => {
          if (day.isCurrentMonth) {
            weekDayIndices.push(day.dayIndex)

            // 清除原有的分組和預備75班
            Object.entries(schedule.scheduleByNurse).forEach(([nurseId, nurseData]) => {
              if (nurseData.groups) {
                nurseData.groups[day.dayIndex] = ''
              }
              if (nurseData.standby75Days) {
                const idx = nurseData.standby75Days.indexOf(day.dayIndex)
                if (idx > -1) {
                  nurseData.standby75Days.splice(idx, 1)
                }
              }
            })
          }
        })

        // 建立週次上下文（包含跨月天數）
        if (weekDayIndices.length > 0) {
          const weeklyContext = {
            nurses816: new Set(),
            nurseHospitalDays: {},
            nurse75Days: {},
            nurseStandby75Days: {},
          }

          // 掃描整週的班表（包含跨月天數）
          week.days.forEach((day) => {
            let scheduleToScan = null
            if (day.isCurrentMonth) {
              scheduleToScan = schedule
            } else if (day.isPrevMonth) {
              scheduleToScan = prevMonthSchedule
            } else if (day.isNextMonth) {
              scheduleToScan = nextMonthSchedule
            }

            if (!scheduleToScan?.scheduleByNurse) return

            Object.entries(scheduleToScan.scheduleByNurse).forEach(([nurseId, nurseData]) => {
              const shift = nurseData.shifts?.[day.dayIndex]
              if (!shift) return
              const s = shift.trim()

              if (s === '816') {
                weeklyContext.nurses816.add(nurseId)
              }
              if (s === '75') {
                if (!weeklyContext.nurse75Days[nurseId]) {
                  weeklyContext.nurse75Days[nurseId] = []
                }
                // 計算統一的日期座標（unifiedDay）
                // 當月: day.day (1 to daysInMonth)
                // 上月: 負數
                // 下月: > daysInMonth
                const [currentYear, currentMonth] = schedule.yearMonth.split('-').map(Number)
                const daysInCurrentMonth = new Date(currentYear, currentMonth, 0).getDate()
                let unifiedDay
                if (day.isCurrentMonth) {
                  unifiedDay = day.day
                } else if (day.isPrevMonth) {
                  const prevMonthDays = new Date(day.year, day.month, 0).getDate()
                  unifiedDay = day.day - prevMonthDays - 1
                } else {
                  unifiedDay = daysInCurrentMonth + day.day
                }
                weeklyContext.nurse75Days[nurseId].push(unifiedDay)
              }
              // 檢查預備75
              if (nurseData.standby75Days?.includes(day.dayIndex)) {
                if (!weeklyContext.nurseStandby75Days[nurseId]) {
                  weeklyContext.nurseStandby75Days[nurseId] = []
                }
                const [currentYear, currentMonth] = schedule.yearMonth.split('-').map(Number)
                const daysInCurrentMonth = new Date(currentYear, currentMonth, 0).getDate()
                let unifiedDay
                if (day.isCurrentMonth) {
                  unifiedDay = day.day
                } else if (day.isPrevMonth) {
                  const prevMonthDays = new Date(day.year, day.month, 0).getDate()
                  unifiedDay = day.day - prevMonthDays - 1
                } else {
                  unifiedDay = daysInCurrentMonth + day.day
                }
                weeklyContext.nurseStandby75Days[nurseId].push(unifiedDay)
              }
            })
          })

          // 將 unifiedDay 轉換為與 dayIndex 相容的座標 (unifiedDay - 1)
          const adjustedContext = {
            ...weeklyContext,
            nurse75Days: {},
            nurseStandby75Days: {},
          }

          Object.entries(weeklyContext.nurse75Days).forEach(([nurseId, days]) => {
            adjustedContext.nurse75Days[nurseId] = days.map((unifiedDay) => unifiedDay - 1)
          })

          Object.entries(weeklyContext.nurseStandby75Days).forEach(([nurseId, days]) => {
            adjustedContext.nurseStandby75Days[nurseId] = days.map((unifiedDay) => unifiedDay - 1)
          })

          const result = assignGroupsForDays(schedule, weekDayIndices, groupCounts, standby75Counts, adjustedContext)
          Object.assign(groupCounts, result.groupCounts)
          Object.assign(standby75Counts, result.standby75Counts)
        }
      }
    })

    return schedule
  }

  // 取得目前配置（供外部參考）
  const currentConfig = computed(() => getConfig())

  return {
    groupCountsDashboard,
    generateGroupAssignments,
    redistributeRemainingWeeks,
    currentConfig,
  }
}
