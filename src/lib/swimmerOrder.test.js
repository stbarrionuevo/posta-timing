import { test } from 'node:test'
import assert from 'node:assert/strict'
import { displayedActiveId, nextSwimmerId, sortByRelayOrder } from './swimmerOrder.js'

const s = (id, relay_order, created_at, is_active = true) => ({ id, relay_order, created_at, is_active })
const team = [
  s('eva', 3, '2026-10-10T10:00:03Z'),
  s('ana', 1, '2026-10-10T10:00:01Z'),
  s('fede', null, '2026-10-10T10:30:00Z'),
  s('beto', 2, '2026-10-10T10:00:02Z'),
  s('gus', 4, '2026-10-10T10:00:04Z', false),
]

test('orden de relevo: sin número al final', () => {
  assert.deepEqual(sortByRelayOrder(team).map((x) => x.id), ['ana', 'beto', 'eva', 'gus', 'fede'])
})

test('siguiente nadador salta los inactivos y vuelve al primero', () => {
  assert.equal(nextSwimmerId(team, 'ana'), 'beto')
  assert.equal(nextSwimmerId(team, 'eva'), 'fede')
  assert.equal(nextSwimmerId(team, 'fede'), 'ana')
})

test('si el actual no está activo arranca por el primero', () => {
  assert.equal(nextSwimmerId(team, 'gus'), 'ana')
  assert.equal(nextSwimmerId(team, null), 'ana')
})

test('sin nadadores activos no hay siguiente', () => {
  assert.equal(nextSwimmerId([s('x', 1, 'a', false)], 'x'), null)
})

test('el cursor local manda mientras hay toques pendientes', () => {
  const cursor = { swimmerId: 'beto', at: 100 }
  assert.equal(displayedActiveId({ serverActiveId: 'ana', cursor, loadedFrom: 200, hasPending: true }), 'beto')
})

test('el cursor local manda si es más nuevo que la última lectura', () => {
  const cursor = { swimmerId: 'beto', at: 300 }
  assert.equal(displayedActiveId({ serverActiveId: 'ana', cursor, loadedFrom: 200, hasPending: false }), 'beto')
})

test('una lectura posterior al cursor devuelve el control al servidor', () => {
  const cursor = { swimmerId: 'beto', at: 100 }
  assert.equal(displayedActiveId({ serverActiveId: 'eva', cursor, loadedFrom: 200, hasPending: false }), 'eva')
  assert.equal(displayedActiveId({ serverActiveId: 'eva', cursor: null, loadedFrom: 200, hasPending: false }), 'eva')
})
