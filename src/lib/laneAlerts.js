import { parseTs } from './eventClock.js'

// Umbrales de alerta del panel del juez. El operador manda latido cada ~5 s.
export const SIGNAL_TIMEOUT_MS = 20_000
export const FIRST_LAP_TIMEOUT_MS = 60_000
export const STALLED_LAP_MS = 120_000

// Devuelve las alertas de un carril, de más a menos grave.
//   lane: { sessions: lane_sessions[], laps: number, lastLapAt }
//   clock: resultado de getClockState()
export function getLaneAlerts(eventStatus, lane, clock, serverNowMs) {
  const alerts = []
  const sessions = lane.sessions || []
  const live = eventStatus === 'ready' || eventStatus === 'running' || eventStatus === 'paused'

  if (live) {
    if (sessions.length === 0) {
      alerts.push({ code: 'NO_DEVICE', level: 'danger', text: 'Sin dispositivo conectado' })
    } else {
      const lastSeen = Math.max(...sessions.map((s) => parseTs(s.last_seen_at)))
      if (serverNowMs - lastSeen > SIGNAL_TIMEOUT_MS) {
        alerts.push({
          code: 'NO_SIGNAL',
          level: 'danger',
          text: `Sin señal hace ${Math.round((serverNowMs - lastSeen) / 1000)} s`,
        })
      }
    }
  }

  if (eventStatus === 'ready' && !sessions.some((s) => s.ready_at)) {
    alerts.push({ code: 'NOT_READY', level: 'warning', text: 'No confirmó "Carril listo"' })
  }

  if (eventStatus === 'running') {
    if (lane.laps === 0 && clock.elapsedMs > FIRST_LAP_TIMEOUT_MS) {
      alerts.push({
        code: 'NO_FIRST_LAP',
        level: 'danger',
        text: `Sin pasadas a ${Math.round(clock.elapsedMs / 1000)} s del inicio`,
      })
    } else if (lane.laps > 0) {
      const sinceLast = serverNowMs - parseTs(lane.lastLapAt)
      if (sinceLast > STALLED_LAP_MS) {
        alerts.push({
          code: 'STALLED',
          level: 'warning',
          text: `Última pasada hace ${Math.round(sinceLast / 1000)} s`,
        })
      }
    }
  }

  return alerts
}
