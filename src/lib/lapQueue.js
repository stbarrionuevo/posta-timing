// Cola de pasadas del operador (evolución de offlineQueue.js de swim-timing).
// Todo toque entra primero a la cola y después se envía: con o sin conexión
// el camino es el mismo. El reenvío es seguro porque record_lap es idempotente
// por client_op_id.

const MAX_REJECTED = 50

export function isNetworkError(err) {
  if (!err) return false
  if (typeof TypeError !== 'undefined' && err instanceof TypeError) return true
  return /network|fetch|failed to fetch|load failed/i.test(err.message || '')
}

export function createLapQueue({ storage, key, send }) {
  const rejectedKey = `${key}:rejected`
  let flushing = null

  // La memoria manda; el storage es la copia que sobrevive a recargar la página.
  // Si el storage falla (lleno, bloqueado) la cola sigue viva mientras la pestaña esté abierta.
  const memory = new Map()
  const read = (k) => {
    if (memory.has(k)) return memory.get(k)
    let value = []
    try {
      const raw = storage.getItem(k)
      value = raw ? JSON.parse(raw) : []
    } catch {
      value = []
    }
    memory.set(k, value)
    return value
  }
  const write = (k, value) => {
    memory.set(k, value)
    try {
      storage.setItem(k, JSON.stringify(value))
    } catch {
      // Sin persistencia: queda la copia en memoria.
    }
  }

  const list = () => read(key)
  const rejected = () => read(rejectedKey)

  function enqueue(item) {
    write(key, [...list(), item])
  }

  // Quita un toque que todavía no salió (deshacer sin conexión).
  function remove(clientOpId) {
    const before = list()
    const after = before.filter((i) => i.clientOpId !== clientOpId)
    write(key, after)
    return after.length !== before.length
  }

  function clearRejected() {
    write(rejectedKey, [])
  }

  // Envía en orden. Corta en el primer error de red (se reintenta después).
  // Un error del servidor (fuera de tiempo, sin permiso...) saca el toque de
  // la cola y lo guarda en "rechazadas" para que el operador lo vea.
  function reject(item, err) {
    remove(item.clientOpId)
    const entry = { ...item, error: err.message, rejectedAt: new Date().toISOString() }
    write(rejectedKey, [...rejected(), entry].slice(-MAX_REJECTED))
    return { item, outcome: 'rejected', error: err }
  }

  async function runFlush() {
    const results = []
    for (const item of list()) {
      try {
        const response = await send(item)
        // record_lap devuelve los rechazos de regla (fuera de tiempo...) como
        // resultado, no como error: así el servidor los deja auditados.
        if (response.result === 'rejected') {
          results.push(reject(item, new Error(response.error)))
          continue
        }
        remove(item.clientOpId)
        results.push({ item, outcome: response.result, lapId: response.lap_id })
      } catch (err) {
        if (isNetworkError(err)) break
        results.push(reject(item, err))
      }
    }
    return results
  }

  // Un solo envío a la vez: dos flush simultáneos mandarían el mismo toque dos veces.
  function flush() {
    if (!flushing) {
      flushing = runFlush().finally(() => {
        flushing = null
      })
    }
    return flushing
  }

  return { list, rejected, enqueue, remove, clearRejected, flush }
}
