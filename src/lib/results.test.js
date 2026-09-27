import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildResults, searchSwimmers } from './results.js'
import { formatMeters, formatRaceTime, formatSplit } from './format.js'

const teams = [
  { id: 't1', name: 'Tiburones', lane_number: 1 },
  { id: 't2', name: 'Delfines', lane_number: 2 },
  { id: 't3', name: 'Sin datos', lane_number: 3 },
]
const swimmers = [
  { id: 'ana', team_id: 't1', name: 'Ana Pérez', relay_order: 1, created_at: 'a', is_active: true, bib_number: '12' },
  { id: 'beto', team_id: 't1', name: 'Beto', relay_order: 2, created_at: 'b', is_active: true },
  { id: 'caro', team_id: 't2', name: 'Caro', relay_order: 1, created_at: 'c', is_active: true },
]
const standings = [
  { team_id: 't2', position: 1, total_meters: 75 },
  { team_id: 't1', position: 2, total_meters: 50 },
]
const stats = [
  { swimmer_id: 'ana', laps: 1, meters: 25, best_split_seconds: '20.5', avg_split_seconds: '20.5' },
  { swimmer_id: 'beto', laps: 1, meters: 25, best_split_seconds: '25', avg_split_seconds: '25' },
]
const splits = [
  { lap_id: 'l2', team_id: 't1', swimmer_id: 'beto', lap_number: 2, split_seconds: '25', cumulative_meters: 50, source: 'judge' },
  { lap_id: 'l1', team_id: 't1', swimmer_id: 'ana', lap_number: 1, split_seconds: '20.5', cumulative_meters: 25, source: 'device' },
]

const results = buildResults({ teams, swimmers, standings, stats, splits })

test('ordena por posición y deja al final los equipos sin datos', () => {
  assert.deepEqual(results.map((r) => r.team.id), ['t2', 't1', 't3'])
})

test('pasadas en orden con nadador y marca de manual', () => {
  const t1 = results.find((r) => r.team.id === 't1')
  assert.deepEqual(t1.laps.map((l) => [l.number, l.swimmerName, l.manual]), [[1, 'Ana Pérez', false], [2, 'Beto', true]])
})

test('resumen por nadador con números', () => {
  const ana = results.find((r) => r.team.id === 't1').swimmers[0]
  assert.equal(ana.bestSplit, 20.5)
  assert.equal(results.find((r) => r.team.id === 't2').swimmers[0].bestSplit, null)
})

test('búsqueda sin acentos ni mayúsculas, y por número', () => {
  assert.equal(searchSwimmers(results, 'PEREZ')[0].swimmer.id, 'ana')
  assert.equal(searchSwimmers(results, '12')[0].swimmer.id, 'ana')
  assert.equal(searchSwimmers(results, '  ').length, 0)
})

test('formatos', () => {
  assert.equal(formatSplit(24.34), '24.3 s')
  assert.equal(formatSplit(64.3), '1:04.3')
  assert.equal(formatSplit(null), '—')
  assert.equal(formatMeters('75'), '75 m')
  assert.equal(formatMeters(12.5), '12.5 m')
  assert.equal(formatRaceTime('2026-10-10T15:12:04.300Z', '2026-10-10T15:00:00Z'), '12:04.3')
})
