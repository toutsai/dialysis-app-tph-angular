/**
 * 病人歷史與快照共用服務
 * 供 routes/patients.js 與 services/scheduler.js 共用，確保「即時操作」與
 * 「預約變更生效」產生一致的歷史紀錄。
 */

/**
 * 記錄一筆病人歷史事件 (patient_history)。
 * 內建 try/catch，失敗只記 log 不拋出，避免影響主要流程。
 */
export function recordPatientHistory(db, patientId, patientName, eventType, eventDetails, snapshot = {}) {
  const id = `ph_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  const now = new Date().toISOString()

  try {
    db.prepare(`
      INSERT INTO patient_history (id, patient_id, patient_name, event_type, event_details, snapshot, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      patientId,
      patientName,
      eventType,
      JSON.stringify(eventDetails),
      JSON.stringify(snapshot),
      now,
    )
    console.log(`[PatientHistory] 記錄 ${eventType} 事件: ${patientName}`)
  } catch (error) {
    console.error('[PatientHistory] 記錄失敗:', error)
  }
}

/**
 * 由病人資料列 (snake_case) 建立歷史快照。
 */
export function createPatientSnapshot(patient) {
  let hospitalInfo = {}
  try {
    hospitalInfo = JSON.parse(patient.hospital_info || '{}')
  } catch {
    hospitalInfo = {}
  }
  return {
    medicalRecordNumber: patient.medical_record_number || null,
    status: patient.status || null,
    firstDialysisDate: patient.first_dialysis_date || null,
    vascAccess: patient.vasc_access || null,
    accessCreationDate: patient.access_creation_date || null,
    hospitalInfo,
    inpatientReason: patient.inpatient_reason || null,
    dialysisReason: patient.dialysis_reason || null,
  }
}
