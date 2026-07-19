// 簡易事件匯流排：供 SSE 端點訂閱各類後端事件（topic 化）
// 純記憶體、單進程。若未來轉 PM2 cluster 需改用 Redis pub/sub 或類似方案。
import { EventEmitter } from 'events'

const bus = new EventEmitter()
// 訂閱者量可能不小（多分頁、多使用者），解除上限以避免 MaxListenersExceeded
bus.setMaxListeners(0)

// 通用 topic 廣播用的內部頻道名稱（供 subscribeEvents 的萬用訂閱使用）
const ANY_TOPIC_CHANNEL = '__any__'

/**
 * 廣播任意 topic 事件（通用機制）
 * @param {string} topic - 事件主題，如 'exception'、'schedule-saved'
 * @param {object} payload - 事件內容
 */
export function emitEvent(topic, payload) {
  bus.emit(topic, payload)
  bus.emit(ANY_TOPIC_CHANNEL, topic, payload)
}

/**
 * 訂閱所有 topic 事件，listener 收 (topic, payload)
 * @returns {Function} 取消訂閱函式
 */
export function subscribeEvents(listener) {
  bus.on(ANY_TOPIC_CHANNEL, listener)
  return () => bus.off(ANY_TOPIC_CHANNEL, listener)
}

/**
 * 廣播排程例外變更事件（既有 API，保留為包裝層，簽名與行為不變）
 * @param {'created'|'updated'|'deleted'} action
 * @param {object} exception - 例外記錄（含 id、patientId 等）
 */
export function emitExceptionChange(action, exception) {
  emitEvent('exception', { action, exception, ts: new Date().toISOString() })
}

/** 訂閱 exception 事件，回傳取消訂閱函式（既有 API，行為不變） */
export function subscribeExceptions(listener) {
  bus.on('exception', listener)
  return () => bus.off('exception', listener)
}

/**
 * 廣播排程/護理分組存檔事件
 * @param {object} payload - 見 events.js 的 schedule-saved 契約
 */
export function emitScheduleSaved(payload) {
  emitEvent('schedule-saved', payload)
}
