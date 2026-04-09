// 檔案路徑: src/composables/useMyPatientList.js
// ✨ Standalone 版本

import { ref, watch, computed } from 'vue'
import { useTaskStore } from '@/stores/taskStore'
import { usePatientStore } from '@/stores/patientStore'
import { useMedicationStore } from '@/stores/medicationStore'
import { schedulesApi } from '@/services/localApiClient'
import { useUserDirectory } from '@/composables/useUserDirectory.js'

export function useMyPatientList(userIdRef, dateRef) {
  const taskStore = useTaskStore()
  const patientStore = usePatientStore()
  const medicationStore = useMedicationStore()
  const { ensureUsersLoaded, userMap } = useUserDirectory()
  const isLoading = ref(true)
  const patientListByShift = ref({})
  const patientMap = computed(() => new Map(patientStore.allPatients.map((p) => [p.id, p])))

  const processAndBuildList = async () => {
    if (!userIdRef.value || !dateRef.value || patientStore.isLoading) {
      patientListByShift.value = {}
      isLoading.value = false
      return
    }

    isLoading.value = true

    try {
      const targetDate = dateRef.value
      const targetUserId = userIdRef.value
      await ensureUsersLoaded()
      const targetUser = userMap.value.get(targetUserId)

      if (!targetUser) {
        console.warn(`找不到 UID 為 ${targetUserId} 的使用者資料。`)
        patientListByShift.value = {}
        isLoading.value = false
        return
      }
      const targetUserName = targetUser.name

      // 🖥️ 使用本地 API 取得護理分配與排班資料
      const [assignmentsData, scheduleData] = await Promise.all([
        schedulesApi.fetchNurseAssignments(targetDate),
        schedulesApi.fetchByDate(targetDate),
      ])

      const myAssignedIds = new Set()
      const myAssignments = new Map()
      if (assignmentsData) {
        const { names, teams } = assignmentsData
        if (names && teams) {
          const myTeamCodes = Object.keys(names).filter(
            (teamCode) => names[teamCode]?.trim() === targetUserName,
          )
          if (myTeamCodes.length > 0) {
            for (const teamKey in teams) {
              const [pId] = teamKey.split('-')
              // ✨✨✨ 錯誤修正處：將 teams[key] 改為 teams[teamKey] ✨✨✨
              const teamAssignment = teams[teamKey]
              const roles = []
              if (myTeamCodes.includes(teamAssignment.nurseTeam)) roles.push('main')
              if (myTeamCodes.includes(teamAssignment.nurseTeamIn)) roles.push('noonOn')
              if (myTeamCodes.includes(teamAssignment.nurseTeamOut)) roles.push('noonOff')
              if (myTeamCodes.includes(teamAssignment.nurseTeamTakeOff)) roles.push('lateOff')
              if (roles.length > 0) {
                myAssignedIds.add(pId)
                if (!myAssignments.has(pId)) myAssignments.set(pId, new Set())
                roles.forEach((role) => myAssignments.get(pId).add(role))
              }
            }
          }
        }
      }

      if (myAssignedIds.size === 0) {
        patientListByShift.value = {}
        isLoading.value = false
        return
      }

      const myFinalListWithBedInfo = []
      if (scheduleData?.schedule) {
        const schedule = scheduleData.schedule
        for (const shiftKey in schedule) {
          const slot = schedule[shiftKey]
          if (slot?.patientId && myAssignedIds.has(slot.patientId)) {
            myFinalListWithBedInfo.push({ patientId: slot.patientId, shiftKey: shiftKey })
          }
        }
      }

      const allMyPatientIds = Array.from(myAssignedIds)
      if (allMyPatientIds.length > 0) {
        await medicationStore.fetchDailyInjections(targetDate, allMyPatientIds)
      }

      const groupedResults = { early: [], noonOn: [], noonOff: [], late: [] }
      const allInjections = medicationStore.getInjectionsForDate(targetDate) || []

      const injectionsMap = allInjections.reduce((map, injection) => {
        if (!map.has(injection.patientId)) map.set(injection.patientId, [])
        map.get(injection.patientId).push(injection)
        return map
      }, new Map())

      const pendingMemos = (taskStore.feedMessages || []).filter(
        (msg) => msg.status === 'pending' && (!msg.targetDate || msg.targetDate >= targetDate),
      )
      const memosMap = pendingMemos.reduce((map, memo) => {
        if (memo.patientId) {
          if (!map.has(memo.patientId)) map.set(memo.patientId, [])
          map.get(memo.patientId).push(memo)
        }
        return map
      }, new Map())

      myFinalListWithBedInfo.forEach((slot) => {
        const patientFromStore = patientMap.value.get(slot.patientId)
        if (!patientFromStore) return

        const shiftCode = slot.shiftKey.split('-').pop()
        const patientRoles = myAssignments.get(slot.patientId) || new Set()

        const createPatientObject = (roleOverride = null) => {
          const dailyBedNum = getBedNumberFromKey(slot.shiftKey)
          const finalBedNum = !isNaN(dailyBedNum) ? dailyBedNum : patientFromStore.bed || 'N/A'
          const pOrders = patientFromStore.dialysisOrders || {}
          let vascAccessString = pOrders.vascAccess || '–'
          if (pOrders.arterialNeedle && pOrders.venousNeedle) {
            vascAccessString += ` (${pOrders.arterialNeedle}/${pOrders.venousNeedle})`
          }

          const preparationInfo = {
            ak: pOrders.ak || '–',
            dialysateCa: pOrders.dialysateCa || '–',
            heparin: `${pOrders.heparinInitial ?? '–'}/${pOrders.heparinMaintenance ?? '–'}`,
            bloodFlow: pOrders.bloodFlow ?? '–',
            vascAccess: vascAccessString,
          }

          const injectionsForPatient = injectionsMap.get(slot.patientId) || []
          const memos = memosMap.get(slot.patientId) || []

          return {
            id: `${slot.patientId}-${roleOverride || shiftCode}`,
            patientId: slot.patientId,
            shift: translateShift(roleOverride || shiftCode),
            shiftCode: roleOverride || shiftCode,
            bedNum: finalBedNum,
            name: patientFromStore.name,
            preparation: preparationInfo,
            injections: injectionsForPatient,
            memos: memos,
          }
        }

        if (patientRoles.has('main') && shiftCode === 'early')
          groupedResults.early.push(createPatientObject())
        if (patientRoles.has('main') && shiftCode === 'late')
          groupedResults.late.push(createPatientObject())
        if (patientRoles.has('noonOn') && shiftCode === 'noon')
          groupedResults.noonOn.push(createPatientObject('noonOn'))
        if (patientRoles.has('noonOff') && shiftCode === 'noon')
          groupedResults.noonOff.push(createPatientObject('noonOff'))
      })

      for (const shift in groupedResults) {
        groupedResults[shift].sort((a, b) => {
          if (a.bedNum === 'N/A') return 1
          if (b.bedNum === 'N/A') return -1
          return a.bedNum - b.bedNum
        })
      }
      patientListByShift.value = groupedResults
    } catch (error) {
      console.error('[useMyPatientList] 錯誤:', error)
      patientListByShift.value = {}
    } finally {
      isLoading.value = false
    }
  }

  const triggerRebuild = () => {
    if (!userIdRef.value) {
      isLoading.value = false
      patientListByShift.value = {}
      return
    }

    if (!dateRef.value) {
      return
    }

    if (!patientStore.hasFetched || patientStore.isLoading || taskStore.isLoading) {
      isLoading.value = true
      return
    }

    processAndBuildList()
  }

  watch(
    [
      () => userIdRef.value,
      () => dateRef.value,
      () => patientStore.hasFetched,
      () => patientStore.isLoading,
      () => patientStore.patientsVersion,
      () => taskStore.feedMessagesVersion,
      () => taskStore.isLoading,
    ],
    triggerRebuild,
    { immediate: true },
  )

  const getBedNumberFromKey = (shiftId) => {
    if (!shiftId) return NaN
    const parts = shiftId.split('-')
    if (parts.length < 2) return NaN
    if (parts[0] === 'peripheral') {
      return 1000 + parseInt(parts[1], 10)
    }
    return parseInt(parts[1], 10)
  }

  const translateShift = (shiftKey) => {
    const map = {
      early: '早班 (主責)',
      noon: '午班 (主責)',
      late: '晚班 (主責)',
      noonOn: '午班 (上針)',
      noonOff: '午班 (收針)',
    }
    return map[shiftKey] || shiftKey
  }

  const refreshData = (targetDate = dateRef.value) => {
    if (targetDate) {
      medicationStore.clearCache(targetDate)
    }
    if (!isLoading.value) {
      processAndBuildList()
    }
  }

  return { isLoading, patientListByShift, fetchMyPatientData: refreshData }
}
