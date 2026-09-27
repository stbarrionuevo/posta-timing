import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLapQueue } from './lapQueue.js'
import { uuid } from './ids.js'

function memoryStorage() {
  const data = new Map()
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
  }
}

const item = (n) => ({ clientOpId: `op-${n}`, teamId: 't1', swimmerId: 's1', occurredAt: `2026-10-10T15:00:${10 + n}.000Z` })

test('envía en orden y vacía la cola', async () => {
  const sent = []
  const q = createLapQueue({
    storage: memoryStorage(),
    key: 'q',
    send: async (i) => (sent.push(i.clientOpId), { result: 'recorded', lap_id: `lap-${i.clientOpId}` }),
  })
  q.enqueue(item(1))
  q.enqueue(item(2))
  const results = await q.flush()
  assert.deepEqual(sent, ['op-1', 'op-2'])
  assert.deepEqual(results.map((r) => r.outcome), ['recorded', 'recorded'])
  assert.equal(q.list().length, 0)
})

test('sin conexión conserva todo y reintenta después', async () => {
  let online = false
  const q = createLapQueue({
    storage: memoryStorage(),
    key: 'q',
    send: async () => {
      if (!online) throw new TypeError('Failed to fetch')
      return { result: 'recorded', lap_id: 'x' }
    },
  })
  q.enqueue(item(1))
  q.enqueue(item(2))
  assert.deepEqual(await q.flush(), [])
  assert.equal(q.list().length, 2)
  online = true
  assert.equal((await q.flush()).length, 2)
  assert.equal(q.list().length, 0)
})

test('corta en el primer error de red sin saltear toques', async () => {
  let calls = 0
  const q = createLapQueue({
    storage: memoryStorage(),
    key: 'q',
    send: async () => {
      calls++
      if (calls === 2) throw new Error('network error')
      return { result: 'recorded', lap_id: 'x' }
    },
  })
  q.enqueue(item(1))
  q.enqueue(item(2))
  q.enqueue(item(3))
  await q.flush()
  assert.deepEqual(q.list().map((i) => i.clientOpId), ['op-2', 'op-3'])
})

test('un rechazo del servidor pasa a "rechazadas" y sigue con el resto', async () => {
  const q = createLapQueue({
    storage: memoryStorage(),
    key: 'q',
    send: async (i) => {
      if (i.clientOpId === 'op-1') throw new Error('AFTER_END: la pasada es posterior al final del evento')
      return { result: 'recorded', lap_id: 'x' }
    },
  })
  q.enqueue(item(1))
  q.enqueue(item(2))
  const results = await q.flush()
  assert.deepEqual(results.map((r) => r.outcome), ['rejected', 'recorded'])
  assert.equal(q.list().length, 0)
  assert.equal(q.rejected()[0].clientOpId, 'op-1')
  assert.match(q.rejected()[0].error, /AFTER_END/)
})

test('flush concurrente no duplica envíos', async () => {
  const sent = []
  const q = createLapQueue({
    storage: memoryStorage(),
    key: 'q',
    send: async (i) => {
      sent.push(i.clientOpId)
      await new Promise((r) => setTimeout(r, 5))
      return { result: 'recorded', lap_id: 'x' }
    },
  })
  q.enqueue(item(1))
  await Promise.all([q.flush(), q.flush(), q.flush()])
  assert.deepEqual(sent, ['op-1'])
})

test('deshacer un toque que todavía no salió', () => {
  const q = createLapQueue({ storage: memoryStorage(), key: 'q', send: async () => ({}) })
  q.enqueue(item(1))
  assert.equal(q.remove('op-1'), true)
  assert.equal(q.remove('op-1'), false)
  assert.equal(q.list().length, 0)
})

test('uuid tiene formato v4', () => {
  assert.match(uuid(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})

test('si el storage falla la cola sigue en memoria', async () => {
  const broken = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError') } }
  const q = createLapQueue({ storage: broken, key: 'q', send: async () => ({ result: 'recorded', lap_id: 'x' }) })
  q.enqueue(item(1))
  assert.equal(q.list().length, 1)
  assert.equal((await q.flush()).length, 1)
})

test('recupera la cola guardada al recargar', () => {
  const storage = memoryStorage()
  createLapQueue({ storage, key: 'q', send: async () => ({}) }).enqueue(item(1))
  const reloaded = createLapQueue({ storage, key: 'q', send: async () => ({}) })
  assert.equal(reloaded.list()[0].clientOpId, 'op-1')
})

test('un rechazo devuelto como resultado (auditado en el servidor) también va a "rechazadas"', async () => {
  const q = createLapQueue({
    storage: memoryStorage(),
    key: 'q',
    send: async () => ({ result: 'rejected', error: 'AFTER_END: la pasada es posterior al final del evento' }),
  })
  q.enqueue(item(1))
  const [res] = await q.flush()
  assert.equal(res.outcome, 'rejected')
  assert.match(res.error.message, /AFTER_END/)
  assert.equal(q.list().length, 0)
  assert.match(q.rejected()[0].error, /AFTER_END/)
})
