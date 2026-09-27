import { parseTs } from './eventClock.js'

// Hora sugerida para una pasada olvidada "después de la pasada N":
// el punto medio entre la pasada N y la N+1 (o el inicio / el límite).
//   validLaps: pasadas válidas del equipo, ordenadas por occurred_at.
//   afterNumber: 0 = antes de la primera; N = después de la pasada N.
//   limitMs: hasta dónde puede caer (min(ahora, final del evento)).
export function suggestLapTime(validLaps, afterNumber, startedAtMs, limitMs) {
  const prev = afterNumber === 0 ? startedAtMs : parseTs(validLaps[afterNumber - 1].occurred_at)
  const next = afterNumber < validLaps.length ? parseTs(validLaps[afterNumber].occurred_at) : limitMs
  return Math.round(prev + (next - prev) / 2)
}
