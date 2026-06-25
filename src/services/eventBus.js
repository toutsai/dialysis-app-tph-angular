// 簡易事件匯流排：供 SSE 端點訂閱排程例外 (schedule_exceptions) 變更
// 純記憶體、單進程。若未來轉 PM2 cluster 需改用 Redis pub/sub 或類似方案。
import { EventEmitter } from 'events'

const bus = new EventEmitter()
// 訂閱者量可能不小（多分頁、多使用者），解除上限以避免 MaxListenersExceeded
bus.setMaxListeners(0)

/**
 * 廣播排程例外變更事件
 * @param {'created'|'updated'|'deleted'} action
 * @param {object} exception - 例外記錄（含 id、patientId 等）
 */
export function emitExceptionChange(action, exception) {
  bus.emit('exception', { action, exception, ts: new Date().toISOString() })
}

/** 訂閱 exception 事件，回傳取消訂閱函式 */
export function subscribeExceptions(listener) {
  bus.on('exception', listener)
  return () => bus.off('exception', listener)
}
