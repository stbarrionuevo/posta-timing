import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeAudit } from './auditFormat.js'

const names = { ana: 'Ana', beto: 'Beto' }
const ctx = {
  swimmerName: (id) => names[id] ?? '—',
  teamLabel: (id) => (id === 't1' ? 'Carril 1 · Tiburones' : '—'),
}
const d = (entry) => describeAudit(entry, ctx)

test('toques rechazados por código', () => {
  const r = d({ action: 'lap_rejected', entity: 'laps', reason: 'AFTER_END: ...', after: { team_id: 't1', swimmer_id: 'ana' } })
  assert.equal(r.category, 'rejects')
  assert.match(r.title, /después del final/)
  assert.equal(r.detail, 'Carril 1 · Tiburones · Ana')
  assert.equal(d({ action: 'lap_rejected', entity: 'laps', reason: 'TOO_SOON: doble', after: {} }).title, 'Doble toque rechazado')
})

test('cambios de estado del evento', () => {
  const r = d({ action: 'update', entity: 'events', before: { status: 'running' }, after: { status: 'paused' } })
  assert.equal(r.title, 'Evento: En curso → En pausa')
  assert.equal(r.tone, 'warn')
})

test('cambio de configuración lista los campos', () => {
  const r = d({
    action: 'update',
    entity: 'events',
    before: { status: 'running', auto_rotate: true, is_public: false },
    after: { status: 'running', auto_rotate: false, is_public: true },
  })
  assert.equal(r.detail, 'marcador público, rotación automática')
})

test('correcciones de pasadas', () => {
  assert.equal(d({ action: 'insert', entity: 'laps', after: { source: 'judge', team_id: 't1', swimmer_id: 'ana' } }).title, 'Pasada agregada por el juez')
  assert.equal(d({ action: 'insert', entity: 'laps', after: { source: 'device', team_id: 't1', swimmer_id: 'ana' } }).category, 'laps')
  assert.equal(d({ action: 'update', entity: 'laps', before: { status: 'valid' }, after: { status: 'void', team_id: 't1', swimmer_id: 'ana' } }).title, 'Pasada anulada')
  const re = d({ action: 'update', entity: 'laps', before: { status: 'valid', swimmer_id: 'ana' }, after: { status: 'valid', swimmer_id: 'beto', team_id: 't1' } })
  assert.equal(re.title, 'Pasada reasignada')
  assert.match(re.detail, /Ana → Beto/)
})

test('ajustes y su eliminación', () => {
  assert.equal(d({ action: 'insert', entity: 'team_adjustments', after: { kind: 'penalty', meters: '-25', team_id: 't1' } }).title, 'Penalización -25 m')
  assert.equal(d({ action: 'delete', entity: 'team_adjustments', before: { kind: 'penalty', meters: -25, team_id: 't1' } }).title, 'Se quitó: Penalización -25 m')
  assert.equal(d({ action: 'insert', entity: 'team_adjustments', after: { kind: 'partial_lap', meters: 12.5 } }).title, 'Pasada incompleta +12.5 m')
})

test('roster: alta tardía, baja y cambio manual de nadador', () => {
  assert.equal(d({ action: 'insert', entity: 'swimmers', after: { name: 'Fede', added_after_lock: true } }).title, 'Alta tardía: Fede')
  assert.equal(d({ action: 'update', entity: 'swimmers', before: { is_active: true }, after: { is_active: false, name: 'Fede' } }).title, 'Baja: Fede')
  const sw = d({ action: 'update', entity: 'teams', before: { active_swimmer_id: 'ana' }, after: { id: 't1', active_swimmer_id: 'beto' } })
  assert.equal(sw.detail, 'Ana → Beto')
})
