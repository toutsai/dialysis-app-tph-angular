import { kiditApi, patientsApi } from '@/services/localApiClient'

export const kiditService = {
  /**
   * 取得指定月份的 Kidit 日誌本
   */
  async fetchMonthLogs(year, month) {
    return kiditApi.fetchLogbooks({ year, month })
  },

  /**
   * 儲存整個事件列表
   */
  async updateLogEvents(dateStr, events) {
    return kiditApi.replaceEvents(dateStr, events)
  },

  /**
   * 取得病人主檔資料
   */
  async fetchPatientMasterRecord(patientId) {
    try {
      return await patientsApi.fetchById(patientId)
    } catch (error) {
      console.error('Fetch master patient record failed:', error)
      return null
    }
  },

  /**
   * 更新 Kidit 事件的指定欄位
   */
  async updateEventKiDitData(dateStr, eventId, fieldKey, data) {
    return kiditApi.updateEvent(dateStr, eventId, { [fieldKey]: data })
  },
}
