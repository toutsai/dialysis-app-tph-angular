// 檔案路徑: src/composables/useTeamAssigner.js (基於您的 v4 修正版)

/**
 * 根據複雜的臨床規則分配病人到護理組別。
 * @returns {{ distributePatients: function }}
 */
export function useTeamAssigner() {
  /**
   * 核心分配引擎
   * @param {Array<Object>} allPatients - 所有待分配的病人 (已預先排序)
   * @param {Array<string>} teams - 本次分配可用的組別
   * @param {Object} rules - 本次分配的規則
   * @returns {Object} 分配結果
   */
  const distributePatients = (allPatients, teams, rules) => {
    console.log('--- 🚀 正在運行【v4 - 優先病人輪流分配版】的分配引擎！---')
    const assignments = {}
    teams.forEach((t) => {
      assignments[t] = []
    })

    const assignedPatientIds = new Set()
    const addPatient = (team, patient) => {
      if (team && team.includes('K')) {
        console.warn(`⚠️ 偵測到K組分配嘗試，已阻止: ${patient?.id} -> ${team}`)
        return false
      }
      if (patient && assignments[team] && !assignedPatientIds.has(patient.id)) {
        assignments[team].push(patient)
        assignedPatientIds.add(patient.id)
        return true
      }
      return false
    }

    const isOpd = (p) => p.status === 'opd'
    const isInPatientOrER = (p) => p.status === 'ipd' || p.status === 'er'

    // --- 步驟一：優先分配 ---
    console.log('--- 步驟一：執行優先分配 (G, H, I, J)...')
    const { hepatitis, inPatientTeams, inPatientCapacity } = rules.priorityTeams

    // B肝病人優先分配
    if (hepatitis) {
      allPatients.filter((p) => p.isHepatitis).forEach((p) => addPatient(hepatitis, p))
    }

    // 住院/急診病人輪流分配
    if (inPatientTeams && inPatientCapacity) {
      // 關鍵修正：只從尚未被分配的病人中篩選
      const unassignedInPatients = allPatients.filter(
        (p) => isInPatientOrER(p) && !assignedPatientIds.has(p.id),
      )

      let priorityTeamIndex = 0
      unassignedInPatients.forEach((patient) => {
        for (let i = 0; i < inPatientTeams.length; i++) {
          const teamIndex = (priorityTeamIndex + i) % inPatientTeams.length
          const team = inPatientTeams[teamIndex]

          if (assignments[team].length < inPatientCapacity[team]) {
            if (addPatient(team, patient)) {
              priorityTeamIndex = (teamIndex + 1) % inPatientTeams.length
              break
            }
          }
        }
      })
    }

    // --- 步驟二：處理特殊組 (A組) ---
    console.log('--- 步驟二：處理特殊A組...')
    const { specialTeam, regularTeams } = rules.mainDistribution
    if (specialTeam) {
      const availableOpdPatients = allPatients.filter(
        (p) => !assignedPatientIds.has(p.id) && isOpd(p) && !p.isHepatitis,
      )
      const patientsForSpecialTeam = availableOpdPatients.slice(0, specialTeam.capacity)
      patientsForSpecialTeam.forEach((p) => addPatient(specialTeam.name, p))
    }

    // --- 步驟三：為常規組計算最終目標人數並填充 ---
    const participatingTeams = regularTeams.filter((team) => !team.includes('K'))
    const remainingPatientsForRegularTeams = allPatients.filter(
      (p) => !assignedPatientIds.has(p.id),
    )

    let totalWorkload = remainingPatientsForRegularTeams.length
    participatingTeams.forEach((team) => {
      totalWorkload += assignments[team]?.length || 0
    })

    if (totalWorkload > 0 && participatingTeams.length > 0) {
      const baseSize = Math.floor(totalWorkload / participatingTeams.length)
      const remainder = totalWorkload % participatingTeams.length

      const finalTargetSize = {}
      participatingTeams.forEach((team, index) => {
        finalTargetSize[team] = baseSize + (index < remainder ? 1 : 0)
      })

      const neededCounts = {}
      participatingTeams.forEach((team) => {
        const currentCount = assignments[team]?.length || 0
        const target = finalTargetSize[team]
        neededCounts[team] = Math.max(0, target - currentCount)
      })

      let patientIndex = 0
      for (const team of participatingTeams) {
        const needed = neededCounts[team]
        if (needed > 0) {
          const patientsToFill = remainingPatientsForRegularTeams.slice(
            patientIndex,
            patientIndex + needed,
          )
          patientsToFill.forEach((p) => addPatient(team, p))
          patientIndex += needed
        }
      }
    }

    console.log(
      '✅ 分配完成!',
      Object.fromEntries(Object.entries(assignments).map(([team, p]) => [team, p.length])),
    )
    return assignments
  }

  return { distributePatients }
}
