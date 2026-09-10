// Private process-local invalidation. Never forward token hashes to SSE clients.
import { EventEmitter } from 'node:events'
const sessions = new EventEmitter()
sessions.setMaxListeners(0)
export function notifySessionRevoked(userId, tokenHash) {
  sessions.emit('revoked', { userId, tokenHash })
}
export function subscribeSessionRevocations(listener) {
  sessions.on('revoked', listener)
  return () => sessions.off('revoked', listener)
}
