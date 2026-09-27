import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { buildResultsPdf } from './exportResults.js'
import { buildResults } from './results.js'

const T0 = Date.parse('2026-10-10T15:00:00Z')
const iso = (s) => new Date(T0 + s * 1000).toISOString()
const event = {
  name: 'Postas Aniversario Club Náutico', event_date: '2026-10-10', venue: 'Pileta Olímpica',
  duration_seconds: 1800, pool_length_m: 25, status: 'finished', started_at: iso(0), partial_lap_policy: 'ignore',
}
const teams = Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, name: `Equipo ${i + 1}`, lane_number: i + 1 }))
const swimmers = teams.flatMap((t) =>
  [1, 2, 3, 4].map((n) => ({ id: `${t.id}s${n}`, team_id: t.id, name: `Nadador ${n} ${t.name}`, relay_order: n, created_at: 'x', is_active: true }))
)
const splits = teams.flatMap((t, ti) =>
  Array.from({ length: 70 - ti * 3 }, (_, k) => ({
    lap_id: `${t.id}l${k}`, team_id: t.id, swimmer_id: `${t.id}s${(k % 4) + 1}`, lap_number: k + 1,
    split_seconds: 24 + (k % 5), cumulative_meters: (k + 1) * 25, occurred_at: iso((k + 1) * 25), source: k === 3 ? 'judge' : 'device',
  }))
)
const standings = teams.map((t, i) => ({ team_id: t.id, position: i + 1, laps: 70 - i * 3, total_meters: (70 - i * 3) * 25, penalty_meters: i === 2 ? -25 : 0 }))
const stats = swimmers.map((s) => ({ swimmer_id: s.id, laps: 17, meters: 425, best_split_seconds: 24, avg_split_seconds: 26 }))

test('genera el PDF de un evento real (8 equipos, ~500 pasadas)', async () => {
  const results = buildResults({ teams, swimmers, standings, stats, splits })
  const doc = await buildResultsPdf(event, results)
  const pages = doc.getNumberOfPages()
  assert.ok(pages > 5, `páginas: ${pages}`)
  const bytes = Buffer.from(doc.output('arraybuffer'))
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-')
  if (process.env.PDF_OUT) writeFileSync(process.env.PDF_OUT, bytes)
})
