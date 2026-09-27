// Estado del reloj del evento. Replica event_ends_at() de schema.sql:
// el reloj lo definen started_at / paused_at / paused_seconds / finished_at
// escritos por el servidor; el cliente solo necesita la hora del servidor
// (ver serverClock.js) para dibujarlo.

// Postgres devuelve microsegundos; Date.parse no está garantizado con más de 3 decimales.
export function parseTs(value) {
  if (!value) return null
  if (value instanceof Date) return value.getTime()
  return Date.parse(String(value).replace(/(\.\d{3})\d+/, '$1'))
}

export function getClockState(event, serverNowMs) {
  const durationMs = event.duration_seconds * 1000
  const startedMs = parseTs(event.started_at)

  if (startedMs === null) {
    return { status: event.status, elapsedMs: 0, remainingMs: durationMs, durationMs, timeUp: false }
  }

  const pausedMs = Number(event.paused_seconds || 0) * 1000
  let refMs = serverNowMs
  if (event.status === 'finished') refMs = parseTs(event.finished_at)
  else if (event.status === 'paused') refMs = parseTs(event.paused_at)

  const elapsedMs = Math.min(Math.max(refMs - startedMs - pausedMs, 0), durationMs)
  const remainingMs = durationMs - elapsedMs

  return {
    status: event.status,
    elapsedMs,
    remainingMs,
    durationMs,
    timeUp: event.status === 'running' && remainingMs <= 0,
  }
}

// Cuenta regresiva: redondea hacia arriba para que "00:00" signifique terminado.
export function formatClock(ms, { roundUp = true } = {}) {
  const totalSeconds = Math.max(0, roundUp ? Math.ceil(ms / 1000) : Math.floor(ms / 1000))
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}
