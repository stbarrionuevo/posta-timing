import { useEffect, useState } from 'react'
import { laneHeartbeat } from '../services/lanesService'
import { getDeviceId } from '../lib/ids'

const HEARTBEAT_MS = 5_000
const LIVE_STATUSES = ['ready', 'running', 'paused']

// Latido del dispositivo hacia el panel del juez. La primera vez registra el
// dispositivo en el carril (también sirve para sumar un celular de respaldo).
export function useLaneDevice(teamId, eventStatus) {
  const [deviceId] = useState(getDeviceId)
  const [state, setState] = useState({ lastOkAt: null, error: null })
  const live = LIVE_STATUSES.includes(eventStatus)

  useEffect(() => {
    if (!live) return
    let cancelled = false
    async function beat() {
      try {
        await laneHeartbeat(teamId, deviceId)
        if (!cancelled) setState({ lastOkAt: Date.now(), error: null })
      } catch (err) {
        if (!cancelled) setState((prev) => ({ ...prev, error: err }))
      }
    }
    beat()
    const id = setInterval(beat, HEARTBEAT_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [teamId, deviceId, live])

  return { deviceId, ...state }
}

// Mantiene la pantalla encendida mientras el operador está en el carril.
export function useWakeLock(active) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return
    let lock = null
    let released = false
    const request = async () => {
      try {
        lock = await navigator.wakeLock.request('screen')
      } catch {
        // Sin permiso o sin contexto seguro: el operador tendrá que tocar la pantalla.
      }
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !released) request()
    }
    request()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      released = true
      document.removeEventListener('visibilitychange', onVisible)
      lock?.release().catch(() => {})
    }
  }, [active])
}
