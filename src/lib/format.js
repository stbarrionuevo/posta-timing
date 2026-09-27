import { parseTs } from './eventClock.js'

// Tiempo de carrera desde el inicio (incluye pausas), p. ej. "12:04.3".
export function formatRaceTime(occurredAt, startedAt) {
  const ms = Math.max(0, parseTs(occurredAt) - parseTs(startedAt))
  const m = Math.floor(ms / 60000)
  const s = ((ms % 60000) / 1000).toFixed(1).padStart(4, '0')
  return `${m}:${s}`
}

// Parcial en segundos, p. ej. "24.3 s" (o "1:04.3" si pasa el minuto).
export function formatSplit(seconds) {
  if (seconds == null || Number.isNaN(Number(seconds))) return '—'
  const n = Number(seconds)
  if (n < 60) return `${n.toFixed(1)} s`
  const m = Math.floor(n / 60)
  return `${m}:${(n - m * 60).toFixed(1).padStart(4, '0')}`
}

export function formatMeters(m) {
  const n = Number(m ?? 0)
  return `${Number.isInteger(n) ? n : n.toFixed(1)} m`
}

export function formatDate(isoDate) {
  if (!isoDate) return ''
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })
}
