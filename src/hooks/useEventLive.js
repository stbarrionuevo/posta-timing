import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchEventBundle, subscribeToEvent } from '../services/eventsService'
import { fetchTeamSplits } from '../services/lanesService'

// Espera mínima tras un cambio, para agrupar ráfagas en una sola lectura.
const BATCH_MS = 300
// Red de seguridad por si Realtime pierde un mensaje.
const SAFETY_RELOAD_MS = 15_000

// Con teamId suma los parciales de ese equipo (pantalla del operador).
// minIntervalMs limita cuántas veces por segundo relee cada pantalla: las
// públicas (muchos espectadores) usan un valor alto para no saturar la base.
export function useEventLive(eventId, { teamId, minIntervalMs = 0 } = {}) {
  const [bundle, setBundle] = useState(null)
  const [error, setError] = useState(null)
  const [liveStatus, setLiveStatus] = useState('connecting')
  const timer = useRef(null)
  const lastRun = useRef(0)
  const newest = useRef(0)

  // loadedFrom = cuándo ARRANCÓ la lectura: lo que pasó después puede no estar
  // incluido. Una respuesta más vieja que la última aplicada se descarta.
  const reload = useCallback(async () => {
    const startedAt = Date.now()
    lastRun.current = startedAt
    try {
      const [next, splits] = await Promise.all([
        fetchEventBundle(eventId),
        teamId ? fetchTeamSplits(teamId) : null,
      ])
      if (startedAt < newest.current) return
      newest.current = startedAt
      setBundle({ ...next, splits, loadedFrom: startedAt })
      setError(null)
    } catch (err) {
      setError(err)
    }
  }, [eventId, teamId])

  useEffect(() => {
    reload()
    // Si ya hay una lectura programada, esa traerá también este cambio: no se
    // reprograma (así una ráfaga continua de toques no posterga la lectura).
    const scheduleReload = () => {
      if (timer.current) return
      const wait = Math.max(BATCH_MS, lastRun.current + minIntervalMs - Date.now())
      timer.current = setTimeout(() => {
        timer.current = null
        reload()
      }, wait)
    }
    const unsubscribe = subscribeToEvent(eventId, scheduleReload, (status) => {
      setLiveStatus(status === 'SUBSCRIBED' ? 'connected' : status === 'CHANNEL_ERROR' ? 'error' : 'connecting')
      if (status === 'SUBSCRIBED') scheduleReload()
    })
    const safety = setInterval(reload, SAFETY_RELOAD_MS)
    return () => {
      clearTimeout(timer.current)
      timer.current = null
      clearInterval(safety)
      unsubscribe()
    }
  }, [eventId, reload, minIntervalMs])

  return { ...bundle, loaded: bundle !== null, error, liveStatus, reload }
}
