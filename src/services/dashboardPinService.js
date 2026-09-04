import { createHmac } from 'crypto'
import { MAIN_BED_NUMBERS } from '../utils/scheduleUtils.js'

const MS_PER_DAY = 24 * 60 * 60 * 1000

function getPositiveInt(value, fallback) {
  const numeric = Number.parseInt(value, 10)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback
}

export const DASHBOARD_PIN_ROTATION_DAYS = getPositiveInt(process.env.DASHBOARD_PIN_ROTATION_DAYS, 30)
export const DASHBOARD_PIN_LENGTH = getPositiveInt(process.env.DASHBOARD_PIN_LENGTH, 4)
// 預設床位清單改用 MAIN_BED_NUMBERS（2026-09-04）：舊環境變數 DASHBOARD_DEFAULT_BED_COUNT 不再使用
const MAIN_BED_NUMBER_SET = new Set(MAIN_BED_NUMBERS)

function getPinSecret() {
  return (
    process.env.DASHBOARD_PIN_SECRET ||
    process.env.JWT_SECRET ||
    'dialysis-dashboard-pin-local-secret'
  )
}

function toDateString(date) {
  return date.toISOString().slice(0, 10)
}

function getPinWindow(now = new Date()) {
  const dayIndex = Math.floor(now.getTime() / MS_PER_DAY)
  const windowStartDay = Math.floor(dayIndex / DASHBOARD_PIN_ROTATION_DAYS) * DASHBOARD_PIN_ROTATION_DAYS
  const validFromDate = new Date(windowStartDay * MS_PER_DAY)
  const validUntilDate = new Date((windowStartDay + DASHBOARD_PIN_ROTATION_DAYS) * MS_PER_DAY)
  const daysRemaining = Math.max(
    0,
    Math.ceil((validUntilDate.getTime() - now.getTime()) / MS_PER_DAY),
  )

  return {
    validFrom: toDateString(validFromDate),
    validUntil: toDateString(validUntilDate),
    daysRemaining,
  }
}

function bedSortValue(bedKey) {
  const match = String(bedKey || '').match(/^bed-(\d+)$/i)
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER
}

function defaultBedLabel(bedKey) {
  const match = String(bedKey || '').match(/^bed-(\d+)$/i)
  return match ? `床位 ${Number(match[1])}` : String(bedKey || '')
}

export function isDefaultDashboardBedKey(bedKey) {
  const match = String(bedKey || '').match(/^bed-(\d+)$/i)
  if (!match) return false
  const bedNumber = Number(match[1])
  return MAIN_BED_NUMBER_SET.has(bedNumber)
}

export function getDefaultDashboardBedKeys() {
  return MAIN_BED_NUMBERS.map((bedNumber) => `bed-${bedNumber}`)
}

export function deriveDashboardPin(bedKey, now = new Date()) {
  const normalizedBedKey = String(bedKey || '').toLowerCase()
  const window = getPinWindow(now)
  const minValue = 10 ** Math.max(DASHBOARD_PIN_LENGTH - 1, 0)
  const range = 9 * minValue
  const digest = createHmac('sha256', getPinSecret())
    .update(`${normalizedBedKey}:${window.validFrom}:${window.validUntil}:${DASHBOARD_PIN_LENGTH}`)
    .digest()
  const numeric = minValue + (digest.readUInt32BE(0) % range)

  return {
    pin: String(numeric).padStart(DASHBOARD_PIN_LENGTH, '0'),
    pinLength: DASHBOARD_PIN_LENGTH,
    rotationDays: DASHBOARD_PIN_ROTATION_DAYS,
    ...window,
  }
}

export function isDerivedDashboardPinValid(bedKey, pin) {
  const expected = deriveDashboardPin(bedKey).pin
  return String(pin || '').trim() === expected
}

export function buildDashboardPinList(deviceRows = []) {
  const rowsByBedKey = new Map(deviceRows.map((row) => [row.bed_key, row]))
  const defaultBedKeys = getDefaultDashboardBedKeys()
  const defaultBedKeySet = new Set(defaultBedKeys)
  const allBedKeys = [
    ...defaultBedKeys,
    ...deviceRows
      .map((row) => row.bed_key)
      .filter((bedKey) => bedKey && !defaultBedKeySet.has(bedKey)),
  ]

  return allBedKeys
    .map((bedKey) => {
      const row = rowsByBedKey.get(bedKey)
      const pinInfo = deriveDashboardPin(bedKey)
      return {
        bedKey,
        displayName: row?.display_name || defaultBedLabel(bedKey),
        pin: pinInfo.pin,
        pinLength: pinInfo.pinLength,
        validFrom: pinInfo.validFrom,
        validUntil: pinInfo.validUntil,
        daysRemaining: pinInfo.daysRemaining,
        rotationDays: pinInfo.rotationDays,
        isActive: row ? row.is_active === 1 : true,
        lastLoginAt: row?.last_login_at || null,
        deviceId: row?.id || null,
        status: row ? (row.is_active === 1 ? 'active' : 'disabled') : 'auto',
      }
    })
    .sort((a, b) => {
      const bedDiff = bedSortValue(a.bedKey) - bedSortValue(b.bedKey)
      return bedDiff !== 0 ? bedDiff : a.bedKey.localeCompare(b.bedKey)
    })
}
