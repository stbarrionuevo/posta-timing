import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getClockState, formatClock, parseTs } from './eventClock.js'
import { getLaneAlerts } from './laneAlerts.js'

const T0 = Date.parse('2026-10-10T15:00:00.000Z')
const iso = (ms) => new Date(ms).toISOString()
const base = { duration_seconds: 1800, paused_seconds: 0 }

test('parseTs tolera microsegundos de Postgres', () => {
  assert.equal(parseTs('2026-10-10T15:00:00.123456+00:00'), T0 + 123)
})

test('antes de iniciar muestra la duración completa', () => {
  const c = getClockState({ ...base, status: 'ready', started_at: null }, T0)
  assert.equal(c.remainingMs, 1_800_000)
  assert.equal(formatClock(c.remainingMs), '30:00')
})

test('corriendo descuenta desde started_at', () => {
  const c = getClockState({ ...base, status: 'running', started_at: iso(T0) }, T0 + 61_500)
  assert.equal(c.elapsedMs, 61_500)
  assert.equal(formatClock(c.remainingMs), '28:59')
})

test('en pausa el reloj queda congelado en paused_at', () => {
  const ev = { ...base, status: 'paused', started_at: iso(T0), paused_at: iso(T0 + 100_000) }
  assert.equal(getClockState(ev, T0 + 500_000).elapsedMs, 100_000)
})

test('las pausas anteriores corren el final', () => {
  const ev = { ...base, status: 'running', started_at: iso(T0), paused_seconds: '30.5' }
  assert.equal(getClockState(ev, T0 + 130_500).elapsedMs, 100_000)
})

test('al cumplirse el tiempo marca timeUp y no baja de cero', () => {
  const c = getClockState({ ...base, status: 'running', started_at: iso(T0) }, T0 + 2_000_000)
  assert.equal(c.remainingMs, 0)
  assert.equal(c.timeUp, true)
  assert.equal(formatClock(c.remainingMs), '00:00')
})

test('finalizado usa finished_at', () => {
  const ev = { ...base, status: 'finished', started_at: iso(T0), finished_at: iso(T0 + 1_800_000), paused_seconds: 0 }
  const c = getClockState(ev, T0 + 9_999_999)
  assert.equal(c.remainingMs, 0)
  assert.equal(c.timeUp, false)
})

test('formatClock con horas', () => {
  assert.equal(formatClock(3_725_000), '1:02:05')
})

test('alertas: carril sin dispositivo y sin confirmar en ready', () => {
  const codes = getLaneAlerts('ready', { sessions: [], laps: 0 }, {}, T0).map((a) => a.code)
  assert.deepEqual(codes, ['NO_DEVICE', 'NOT_READY'])
})

test('alertas: dispositivo sin señal', () => {
  const lane = { sessions: [{ last_seen_at: iso(T0 - 30_000), ready_at: iso(T0 - 60_000) }], laps: 3, lastLapAt: iso(T0 - 10_000) }
  const codes = getLaneAlerts('running', lane, { elapsedMs: 200_000 }, T0).map((a) => a.code)
  assert.deepEqual(codes, ['NO_SIGNAL'])
})

test('alertas: sin primera pasada al minuto (el caso "no me tomó el tiempo")', () => {
  const lane = { sessions: [{ last_seen_at: iso(T0), ready_at: iso(T0) }], laps: 0 }
  assert.deepEqual(getLaneAlerts('running', lane, { elapsedMs: 30_000 }, T0), [])
  const codes = getLaneAlerts('running', lane, { elapsedMs: 75_000 }, T0).map((a) => a.code)
  assert.deepEqual(codes, ['NO_FIRST_LAP'])
})

test('alertas: carril trabado', () => {
  const lane = { sessions: [{ last_seen_at: iso(T0), ready_at: iso(T0) }], laps: 4, lastLapAt: iso(T0 - 150_000) }
  const codes = getLaneAlerts('running', lane, { elapsedMs: 400_000 }, T0).map((a) => a.code)
  assert.deepEqual(codes, ['STALLED'])
})
