import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateChecklist, MANUAL_ITEMS } from './checklist.js'

const NOW = Date.parse('2026-10-10T15:00:00Z')
const iso = (ms) => new Date(ms).toISOString()
const teams = [
  { id: 't1', lane_number: 1 },
  { id: 't2', lane_number: 2 },
]
const swimmers = [
  { id: 'a', team_id: 't1', is_active: true, relay_order: 1 },
  { id: 'b', team_id: 't2', is_active: true, relay_order: 1 },
]
const members = [{ role: 'operator' }, { role: 'operator' }, { role: 'judge' }]
const sync = { synced: true, rtt: 80, error: null }
const base = { event: { status: 'ready', auto_rotate: true, is_public: true }, teams, swimmers, members, sync, nowMs: NOW }
const byId = (items) => Object.fromEntries(items.map((i) => [i.id, i]))

test('todo listo', () => {
  const laneSessions = teams.map((t) => ({ team_id: t.id, last_seen_at: iso(NOW - 3000), ready_at: iso(NOW - 60000) }))
  const items = evaluateChecklist({ ...base, laneSessions })
  assert.deepEqual(items.filter((i) => i.status !== 'ok').map((i) => i.id), [])
})

test('carril sin celular y sin listo', () => {
  const laneSessions = [{ team_id: 't1', last_seen_at: iso(NOW - 3000), ready_at: iso(NOW) }]
  const r = byId(evaluateChecklist({ ...base, laneSessions }))
  assert.equal(r.devices.status, 'fail')
  assert.match(r.devices.detail, /carril 2/)
  assert.equal(r.ready.status, 'warn')
})

test('celular que dejó de mandar señal', () => {
  const laneSessions = teams.map((t) => ({ team_id: t.id, last_seen_at: iso(NOW - 60000), ready_at: iso(NOW) }))
  assert.equal(byId(evaluateChecklist({ ...base, laneSessions })).devices.status, 'fail')
})

test('en borrador los dispositivos quedan pendientes y el roster en aviso', () => {
  const r = byId(evaluateChecklist({ ...base, event: { ...base.event, status: 'draft' }, laneSessions: [] }))
  assert.equal(r.roster.status, 'warn')
  assert.equal(r.devices.status, 'pending')
})

test('equipo vacío, nadador sin orden, pocos operadores, red lenta', () => {
  const r = byId(
    evaluateChecklist({
      ...base,
      swimmers: [{ id: 'a', team_id: 't1', is_active: true, relay_order: null }],
      members: [{ role: 'operator' }],
      sync: { synced: true, rtt: 900 },
      laneSessions: [],
    })
  )
  assert.equal(r.swimmers.status, 'fail')
  assert.match(r.swimmers.detail, /carril 2/)
  assert.equal(r.relay_order.status, 'warn')
  assert.equal(r.operators.status, 'warn')
  assert.equal(r.clock.status, 'warn')
})

test('los ítems manuales tienen ids únicos', () => {
  const ids = MANUAL_ITEMS.flatMap((g) => g.items.map(([id]) => id))
  assert.equal(new Set(ids).size, ids.length)
})

test('casillas de la planilla según duración y pileta', async () => {
  const { sheetBoxes } = await import('./checklist.js')
  assert.equal(sheetBoxes({ duration_seconds: 1800, pool_length_m: 25 }), 120)
  assert.equal(sheetBoxes({ duration_seconds: 1800, pool_length_m: 50 }), 60)
  assert.equal(sheetBoxes({ duration_seconds: 300, pool_length_m: 25 }), 40)
  assert.equal(sheetBoxes({ duration_seconds: 7200, pool_length_m: 25 }), 300)
})
