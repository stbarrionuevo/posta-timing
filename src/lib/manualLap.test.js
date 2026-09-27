import { test } from 'node:test'
import assert from 'node:assert/strict'
import { suggestLapTime } from './manualLap.js'

const T0 = Date.parse('2026-10-10T15:00:00Z')
const laps = [20, 45, 70].map((s) => ({ occurred_at: new Date(T0 + s * 1000).toISOString() }))

test('entre dos pasadas: punto medio', () => {
  assert.equal(suggestLapTime(laps, 1, T0, T0 + 600_000), T0 + 32_500)
})

test('antes de la primera: entre el inicio y la primera', () => {
  assert.equal(suggestLapTime(laps, 0, T0, T0 + 600_000), T0 + 10_000)
})

test('después de la última: entre la última y el límite', () => {
  assert.equal(suggestLapTime(laps, 3, T0, T0 + 90_000), T0 + 80_000)
})
